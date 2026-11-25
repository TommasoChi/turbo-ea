"""Which cards a cost report lists for a fiscal year, and what each costs.

One rule for every cost endpoint. The current fiscal year reads the live
attributes of the cards live in it (``is_live_in_fiscal_year``). Any other year
reads the recorded history: every readable, ACTIVE card with a non-zero value
for that year and field, whatever its lifecycle -- a card retired since, or not
live until next year, still has the cost that was (or will be) recorded for it.
"""

from __future__ import annotations

import uuid
from collections.abc import Mapping, Sequence

from sqlalchemy import ColumnElement, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.card import Card
from app.models.card_cost import CardCost
from app.models.card_cost_history import CardCostHistory
from app.models.cost_item_type import CostItemType
from app.models.user import User
from app.services.card_costs import (
    COST_ITEM_TYPES,
    DERIVED_KEY,
    YearCosts,
    archived_keys,
    resolve_year,
    year_costs,
)
from app.services.card_logo_service import logo_updated_map
from app.services.card_read_scope import CardReadScope
from app.services.cost_components import cost_components
from app.services.cost_grouping import OTHER_GROUP, GroupBy, assign_groups
from app.services.cost_providers import provider_names
from app.services.cost_value import cost_value
from app.services.fiscal_year import current_fiscal_year
from app.services.lifecycle import is_live_in_fiscal_year
from app.services.permission_service import PermissionService

OTHER_ITEM = "__other__"  # cost items the components do not account for; the page translates it


def uses_items(type_key: str, cost_field: str) -> bool:
    """Whether a card type's cost for ``cost_field`` is the sum of its cost items."""
    return type_key in COST_ITEM_TYPES and cost_field == DERIVED_KEY


async def is_item_field(db: AsyncSession, type_key: str, cost_field: str) -> bool:
    """``cost_field`` is the item total or a catalogue item (archived too) on an item type."""
    if type_key not in COST_ITEM_TYPES:
        return False
    if cost_field == DERIVED_KEY:
        return True
    return (
        await db.execute(select(CostItemType.id).where(CostItemType.key == cost_field))
    ).first() is not None


async def item_labels(db: AsyncSession) -> dict[str, dict]:
    """``{key: {label, translations}}`` for the whole catalogue, archived items included."""
    rows = (await db.execute(select(CostItemType))).scalars().all()
    return {r.key: {"label": r.label, "translations": r.translations or {}} for r in rows}


async def item_costs_by_card(
    db: AsyncSession, card_ids: list[uuid.UUID], fiscal_year: int, start_month: int
) -> dict[uuid.UUID, YearCosts]:
    """Cost items of ``fiscal_year`` for many cards at once (two queries, whatever the count).

    Same rules as ``card_costs.get_year_row`` (they share ``resolve_year``): an empty row is
    confirmed, only the current year falls back to the latest earlier row.
    """
    cur = current_fiscal_year(start_month)
    cond = (
        CardCost.fiscal_year <= fiscal_year
        if fiscal_year == cur
        else CardCost.fiscal_year == fiscal_year
    )
    by_card: dict[uuid.UUID, dict[int, dict]] = {}
    if card_ids:
        rows = await db.execute(
            select(CardCost.card_id, CardCost.fiscal_year, CardCost.items).where(
                CardCost.card_id.in_(card_ids), cond
            )
        )
        for card_id, fy, items in rows.all():
            by_card.setdefault(card_id, {})[fy] = items or {}
    archived = await archived_keys(db)
    out: dict[uuid.UUID, YearCosts] = {}
    for card_id in card_ids:
        years = by_card.get(card_id, {})
        earlier = [y for y in years if y < fiscal_year]
        prev = (max(earlier), years[max(earlier)]) if earlier else None
        items, confirmed, fb = resolve_year(years.get(fiscal_year), prev, fiscal_year, cur)
        out[card_id] = year_costs(items, confirmed, fb, fiscal_year, cur, archived)
    return out


async def require_item_grouping(db: AsyncSession, type_keys: list[str], cost_field: str) -> None:
    """Grouping by provider splits cost items: each type must own them and ``cost_field`` be one."""
    for key in type_keys:
        if not await is_item_field(db, key, cost_field):
            raise ValueError(f"cannot group {key!r} / {cost_field!r} by provider: not a cost item")


async def provider_splits(
    db: AsyncSession,
    read_scope: CardReadScope,
    card_ids: list[uuid.UUID],
    cost_field: str,
    target_fy: int,
    fy_start: int,
) -> tuple[dict[uuid.UUID, dict[str, dict[str, float]]], dict[str, str]]:
    """``{card: {provider id: {item key: amount}}}`` and ``{provider id: name}``.

    A missing, deleted, unreadable or non-Provider id falls in ``OTHER_GROUP``; an archived
    provider keeps its own group.
    """
    costs = await item_costs_by_card(db, card_ids, target_fy, fy_start)
    lines: dict[uuid.UUID, list[tuple[str, float, uuid.UUID | None]]] = {}
    for card_id in card_ids:
        lines[card_id] = []
        for line in costs[card_id].items:
            if not line.amount or cost_field not in (DERIVED_KEY, line.key):
                continue
            try:
                pid = uuid.UUID(line.provider_id) if line.provider_id else None
            except ValueError:
                pid = None
            lines[card_id].append((line.key, line.amount, pid))
    known = await provider_names(
        db, read_scope, {pid for ls in lines.values() for _, _, pid in ls if pid}
    )
    splits: dict[uuid.UUID, dict[str, dict[str, float]]] = {}
    for card_id, ls in lines.items():
        groups = splits[card_id] = {}
        for key, amount, pid in ls:
            share = groups.setdefault(str(pid) if pid in known else OTHER_GROUP, {})
            share[key] = share.get(key, 0) + amount
    return splits, {str(i): n for i, n in known.items()}


async def _item_cards(
    db: AsyncSession,
    read_scope: CardReadScope,
    type_key: str,
    target_fy: int,
    current_fy: int,
    fy_start: int,
    line: str | None = None,
    extra: Sequence[ColumnElement[bool]] = (),
) -> list[tuple[Card, float]]:
    """Live/readable cards of the type with their TCO, or with one item's amount (``line``)."""
    cards = (
        (
            await db.execute(
                select(Card).where(
                    Card.type == type_key,
                    Card.status == "ACTIVE",
                    *read_scope.where(Card, mode="module"),
                    *extra,
                )
            )
        )
        .scalars()
        .all()
    )
    if target_fy == current_fy:
        cards = [c for c in cards if is_live_in_fiscal_year(c.lifecycle, current_fy, fy_start)]
    costs = await item_costs_by_card(db, [c.id for c in cards], target_fy, fy_start)
    amount = {
        c.id: costs[c.id].tco
        if line is None
        else sum(i.amount for i in costs[c.id].items if i.key == line)
        for c in cards
    }
    return [(c, amount[c.id]) for c in cards if amount[c.id]]


async def cards_with_cost(
    db: AsyncSession,
    read_scope: CardReadScope,
    type_key: str,
    cost_field: str,
    target_fy: int,
    current_fy: int,
    fy_start: int,
    extra: Sequence[ColumnElement[bool]] = (),
) -> list[tuple[Card, float]]:
    """The cards of ``type_key`` that count in ``target_fy``, each with its cost.

    ``extra`` are further where-clauses on ``Card`` (the report's card filters).
    """
    if await is_item_field(db, type_key, cost_field):
        return await _item_cards(
            db,
            read_scope,
            type_key,
            target_fy,
            current_fy,
            fy_start,
            None if cost_field == DERIVED_KEY else cost_field,
            extra,
        )
    if target_fy == current_fy:
        result = await db.execute(
            select(Card).where(
                Card.type == type_key,
                Card.status == "ACTIVE",
                *read_scope.where(Card, mode="module"),
                *extra,
            )
        )
        costed = (
            (c, cost_value((c.attributes or {}).get(cost_field)))
            for c in result.scalars().all()
            if is_live_in_fiscal_year(c.lifecycle, current_fy, fy_start)
        )
        return [(c, cost) for c, cost in costed if cost]

    history = await db.execute(
        select(Card, CardCostHistory.value)
        .join(CardCostHistory, CardCostHistory.card_id == Card.id)
        .where(
            Card.type == type_key,
            Card.status == "ACTIVE",
            CardCostHistory.fiscal_year == target_fy,
            CardCostHistory.field_key == cost_field,
            CardCostHistory.value != 0,
            *read_scope.where(Card, mode="module"),
            *extra,
        )
    )
    return [(card, value) for card, value in history.all()]


MAX_TYPE_KEYS = 5


def parse_type_keys(raw: str) -> list[str]:
    """Split a comma-separated ``types`` query value; empty, repeated or over-cap keys raise."""
    keys = [k.strip() for k in raw.split(",")]
    if not all(keys):
        raise ValueError("empty card type key")
    if len(set(keys)) != len(keys):
        raise ValueError("duplicate card type key")
    if len(keys) > MAX_TYPE_KEYS:
        raise ValueError(f"at most {MAX_TYPE_KEYS} card types per request")
    return keys


async def cards_with_cost_for_types(
    db: AsyncSession,
    read_scope: CardReadScope,
    type_keys: list[str],
    cost_field: str,
    target_fy: int,
    current_fy: int,
    fy_start: int,
    conditions: Mapping[str, Sequence[ColumnElement[bool]]] | None = None,
) -> list[tuple[Card, float]]:
    """``cards_with_cost`` over several types, in the order of ``type_keys``.

    ``conditions`` maps a type key to its filter clauses (``cost_filters``).
    """
    rows: list[tuple[Card, float]] = []
    for key in type_keys:
        rows += await cards_with_cost(
            db,
            read_scope,
            key,
            cost_field,
            target_fy,
            current_fy,
            fy_start,
            (conditions or {}).get(key, ()),
        )
    return rows


async def build_cost_sankey(
    db: AsyncSession,
    read_scope: CardReadScope,
    type_keys: list[str],
    cost_field: str,
    group_by: GroupBy | None,
    target_fy: int,
    current_fy: int,
    fy_start: int,
    user: User,
    conditions: Mapping[str, Sequence[ColumnElement[bool]]] | None = None,
) -> dict:
    """Cost items -> cards, or cost items -> groups -> cards when ``group_by`` is set.

    The cards and each card's total are the treemap's (``cost_field``). A cost item
    is one of the fields concurring to ``cost_field`` (the field itself when it has
    none); what the components leave of a card's total flows from the ``__other__``
    item. Components summing to more than the total are linked as they are, with no
    negative remainder. Each card node carries its ``cost`` and ``costs`` (item key ->
    value, the remainder under ``__other__``), so a page can re-sum the flows of the
    cards it keeps. Raises ``ValueError`` when the grouping is refused.
    """
    components = await cost_components(db, type_keys, cost_field)
    split = components != [cost_field] and bool(components)
    # every type sums cost items: the items are the components, nothing is left over
    item_mode = split and all(uses_items(k, cost_field) for k in type_keys)
    totals = await cards_with_cost_for_types(
        db, read_scope, type_keys, cost_field, target_fy, current_fy, fy_start, conditions
    )
    allowed = await PermissionService.card_ids_with_cost_access(
        db, user, (card.id for card, _ in totals)
    )
    totals = [(card, cost) for card, cost in totals if card.id in allowed]
    logos = await logo_updated_map(db, [card for card, _ in totals])
    per_card: dict[uuid.UUID, tuple[Card, float, dict[str, float]]] = {
        c.id: (c, cost, {} if split else {cost_field: cost}) for c, cost in totals
    }
    if item_mode:
        item_yc = await item_costs_by_card(db, list(per_card), target_fy, fy_start)
        for card_id, (_, _, costs) in per_card.items():
            costs.update(
                {
                    i.key: i.amount
                    for i in item_yc[card_id].items
                    if i.amount and i.key in components
                }
            )
    elif split and target_fy == current_fy:
        # `totals` already holds the live cards: read each item off their attributes
        for card, _, costs in per_card.values():
            for item in components:
                if value := cost_value((card.attributes or {}).get(item)):
                    costs[item] = value
    elif split:
        history = await db.execute(
            select(CardCostHistory.card_id, CardCostHistory.field_key, CardCostHistory.value).where(
                CardCostHistory.card_id.in_(per_card),
                CardCostHistory.fiscal_year == target_fy,
                CardCostHistory.field_key.in_(components),
                CardCostHistory.value != 0,
            )
        )
        for card_id, item, value in history.all():
            per_card[card_id][2][item] = value
    for _, card_total, costs in per_card.values():
        rest = card_total - sum(costs.values())
        if split and rest > 0:
            costs[OTHER_ITEM] = rest
    cards = sorted(per_card.values(), key=lambda cc: -cc[1])
    by_provider = group_by is not None and group_by.kind == "provider"
    splits: dict[uuid.UUID, dict[str, dict[str, float]]] = {}
    provider_label: dict[str, str] = {}
    groups: dict[uuid.UUID, str] = {}
    if by_provider:
        await require_item_grouping(db, type_keys, cost_field)
        splits, provider_label = await provider_splits(
            db, read_scope, [c.id for c, _, _ in cards], cost_field, target_fy, fy_start
        )
    elif group_by:
        groups = await assign_groups(db, read_scope, [c for c, _, _ in cards], group_by, type_keys)

    nodes: list[dict] = []
    index: dict[tuple[str, str], int] = {}

    def node(kind: str, key: str, name: str, type_key: str, **extra) -> int:
        if (kind, key) not in index:
            index[(kind, key)] = len(nodes)
            node_id = key if kind == "card" else f"{kind}:{key}"
            nodes.append({"id": node_id, "name": name, "type": type_key, **extra})
        return index[(kind, key)]

    used = {i for _, _, costs in cards for i in costs}
    for item in [*(components if split else [cost_field]), OTHER_ITEM]:
        if item in used:
            node("item", item, item, "CostItem")

    links: list[dict] = []
    flows: dict[tuple[str, str], float] = {}
    total = 0.0
    for card, card_total, costs in cards:
        total += card_total
        card_idx = node(
            "card",
            str(card.id),
            card.name,
            card.type,
            cost=card_total,
            costs=dict(costs),
            **({"logo_updated_at": logos[card.id].isoformat()} if card.id in logos else {}),
        )
        if not group_by:
            links += [
                {"source": index[("item", i)], "target": card_idx, "value": v}
                for i, v in costs.items()
            ]
            continue
        if by_provider:
            shares = {
                g: {(i if i in costs else OTHER_ITEM): v for i, v in share.items()}
                for g, share in splits[card.id].items()
            }
        else:
            shares = {groups[card.id]: costs}
        for g, share in shares.items():
            g_idx = node("group", g, provider_label.get(g, g), "Group")
            link = {"source": g_idx, "target": card_idx, "value": sum(share.values())}
            links.append({**link, "costs": dict(share)} if by_provider else link)
            for i, v in share.items():
                flows[(i, g)] = flows.get((i, g), 0) + v
    links += [
        {"source": index[("item", i)], "target": index[("group", g)], "value": v}
        for (i, g), v in flows.items()
    ]
    return {"nodes": nodes, "links": links, "total": total}
