"""Which cards a cost report lists for a fiscal year, and what each costs.

One rule for every cost endpoint. The current fiscal year reads the live
attributes of the cards live in it (``is_live_in_fiscal_year``). Any other year
reads the recorded history: every readable, ACTIVE card with a non-zero value
for that year and field, whatever its lifecycle -- a card retired since, or not
live until next year, still has the cost that was (or will be) recorded for it.
"""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.card import Card
from app.models.card_cost_history import CardCostHistory
from app.services.card_read_scope import CardReadScope
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
