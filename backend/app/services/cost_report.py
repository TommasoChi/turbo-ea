"""Which cards a cost report lists for a fiscal year, and what each costs.

One rule for every cost endpoint. The current fiscal year reads the live
attributes of the cards live in it (``is_live_in_fiscal_year``). Any other year
reads the recorded history: every readable, ACTIVE card with a non-zero value
for that year and field, whatever its lifecycle -- a card retired since, or not
live until next year, still has the cost that was (or will be) recorded for it.
"""

from __future__ import annotations

import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.card import Card
from app.models.card_cost_history import CardCostHistory
from app.services.card_read_scope import CardReadScope
from app.services.cost_components import cost_components
from app.services.cost_grouping import GroupBy, assign_groups
from app.services.cost_value import cost_value
from app.services.lifecycle import is_live_in_fiscal_year

OTHER_ITEM = "__other__"  # cost items the components do not account for; the page translates it


async def cards_with_cost(
    db: AsyncSession,
    read_scope: CardReadScope,
    type_key: str,
    cost_field: str,
    target_fy: int,
    current_fy: int,
    fy_start: int,
) -> list[tuple[Card, float]]:
    """The cards of ``type_key`` that count in ``target_fy``, each with its cost."""
    if target_fy == current_fy:
        result = await db.execute(
            select(Card).where(
                Card.type == type_key,
                Card.status == "ACTIVE",
                *read_scope.where(Card, mode="module"),
            )
        )
        costed = (
            (c, cost_value((c.attributes or {}).get(cost_field)))
            for c in result.scalars().all()
            if is_live_in_fiscal_year(c.lifecycle, current_fy, fy_start)
        )
        return [(c, cost) for c, cost in costed if cost]

    result = await db.execute(
        select(Card, CardCostHistory.value)
        .join(CardCostHistory, CardCostHistory.card_id == Card.id)
        .where(
            Card.type == type_key,
            Card.status == "ACTIVE",
            CardCostHistory.fiscal_year == target_fy,
            CardCostHistory.field_key == cost_field,
            CardCostHistory.value != 0,
            *read_scope.where(Card, mode="module"),
        )
    )
    return [(card, value) for card, value in result.all()]


def parse_type_keys(raw: str) -> list[str]:
    """Split a comma-separated ``types`` query value; empty or repeated keys raise."""
    keys = [k.strip() for k in raw.split(",")]
    if not all(keys):
        raise ValueError("empty card type key")
    if len(set(keys)) != len(keys):
        raise ValueError("duplicate card type key")
    return keys


async def cards_with_cost_for_types(
    db: AsyncSession,
    read_scope: CardReadScope,
    type_keys: list[str],
    cost_field: str,
    target_fy: int,
    current_fy: int,
    fy_start: int,
) -> list[tuple[Card, float]]:
    """``cards_with_cost`` over several types, in the order of ``type_keys``."""
    rows: list[tuple[Card, float]] = []
    for key in type_keys:
        rows += await cards_with_cost(
            db, read_scope, key, cost_field, target_fy, current_fy, fy_start
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
) -> dict:
    """Cost items -> cards, or cost items -> groups -> cards when ``group_by`` is set.

    The cards and each card's total are the treemap's (``cost_field``). A cost item
    is one of the fields concurring to ``cost_field`` (the field itself when it has
    none); what the components leave of a card's total flows from the ``__other__``
    item. Components summing to more than the total are linked as they are, with no
    negative remainder. Raises ``ValueError`` when the grouping is refused.
    """
    components = await cost_components(db, type_keys, cost_field)
    split = components != [cost_field] and bool(components)
    totals = await cards_with_cost_for_types(
        db, read_scope, type_keys, cost_field, target_fy, current_fy, fy_start
    )
    per_card: dict[uuid.UUID, tuple[Card, float, dict[str, float]]] = {
        c.id: (c, cost, {} if split else {cost_field: cost}) for c, cost in totals
    }
    for item in components if split else []:
        for card, cost in await cards_with_cost_for_types(
            db, read_scope, type_keys, item, target_fy, current_fy, fy_start
        ):
            if card.id in per_card:
                per_card[card.id][2][item] = cost
    for _, card_total, costs in per_card.values():
        rest = card_total - sum(costs.values())
        if split and rest > 0:
            costs[OTHER_ITEM] = rest
    cards = sorted(per_card.values(), key=lambda cc: -cc[1])
    groups = (
        await assign_groups(db, read_scope, [c for c, _, _ in cards], group_by) if group_by else {}
    )

    nodes: list[dict] = []
    index: dict[tuple[str, str], int] = {}

    def node(kind: str, key: str, name: str, type_key: str) -> int:
        if (kind, key) not in index:
            index[(kind, key)] = len(nodes)
            node_id = key if kind == "card" else f"{kind}:{key}"
            nodes.append({"id": node_id, "name": name, "type": type_key})
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
        link_total = sum(costs.values())
        card_idx = node("card", str(card.id), card.name, card.type)
        if not group_by:
            links += [
                {"source": index[("item", i)], "target": card_idx, "value": v}
                for i, v in costs.items()
            ]
            continue
        g = groups[card.id]
        g_idx = node("group", g, g, "Group")
        links.append({"source": g_idx, "target": card_idx, "value": link_total})
        for i, v in costs.items():
            flows[(i, g)] = flows.get((i, g), 0) + v
    links += [
        {"source": index[("item", i)], "target": index[("group", g)], "value": v}
        for (i, g), v in flows.items()
    ]
    return {"nodes": nodes, "links": links, "total": total}
