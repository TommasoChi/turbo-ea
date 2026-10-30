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

    A cost item is one of the fields concurring to ``cost_field`` (the field itself
    when it has none); a card is counted once, whatever links to it. Raises
    ``ValueError`` when the grouping is refused.
    """
    items = await cost_components(db, type_keys, cost_field) or [cost_field]
    per_card: dict[uuid.UUID, tuple[Card, dict[str, float]]] = {}
    for item in items:
        for card, cost in await cards_with_cost_for_types(
            db, read_scope, type_keys, item, target_fy, current_fy, fy_start
        ):
            per_card.setdefault(card.id, (card, {}))[1][item] = cost
    cards = sorted(per_card.values(), key=lambda cc: -sum(cc[1].values()))
    groups = (
        await assign_groups(db, read_scope, [c for c, _ in cards], group_by) if group_by else {}
    )

    nodes: list[dict] = []
    index: dict[tuple[str, str], int] = {}

    def node(kind: str, key: str, name: str, type_key: str) -> int:
        if (kind, key) not in index:
            index[(kind, key)] = len(nodes)
            nodes.append({"id": key, "name": name, "type": type_key})
        return index[(kind, key)]

    item_totals: dict[str, float] = {}
    for _, costs in cards:
        for item, cost in costs.items():
            item_totals[item] = item_totals.get(item, 0) + cost
    for item in items:
        if item in item_totals:
            node("item", item, item, "CostItem")

    links: list[dict] = []
    flows: dict[tuple[str, str], float] = {}
    total = 0.0
    for card, costs in cards:
        card_total = sum(costs.values())
        total += card_total
        card_idx = node("card", str(card.id), card.name, card.type)
        if not group_by:
            links += [
                {"source": index[("item", i)], "target": card_idx, "value": v}
                for i, v in costs.items()
            ]
            continue
        g = groups[card.id]
        g_idx = node("group", g, g, "Group")
        links.append({"source": g_idx, "target": card_idx, "value": card_total})
        for i, v in costs.items():
            flows[(i, g)] = flows.get((i, g), 0) + v
    links += [
        {"source": index[("item", i)], "target": index[("group", g)], "value": v}
        for (i, g), v in flows.items()
    ]
    return {"nodes": nodes, "links": links, "total": total}
