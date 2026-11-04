"""Test helper: record cost items for a card (and make sure the catalogue has them)."""

from __future__ import annotations

from app.models.card_cost import CardCost
from app.services import cost_item_types
from app.services.fiscal_year import current_fiscal_year


async def add_costs(db, card, year: int | None = None, **amounts):
    """Create ``card``'s cost row for ``year`` (default: the current year) from ``key=amount``."""
    for key in amounts:
        if await cost_item_types.get_item(db, key) is None:
            await cost_item_types.create_item(db, key, key.title())
    db.add(
        CardCost(
            card_id=card.id,
            fiscal_year=year if year is not None else current_fiscal_year(1),
            items={k: {"amount": v, "renewal_date": None} for k, v in amounts.items()},
        )
    )
    await db.flush()
