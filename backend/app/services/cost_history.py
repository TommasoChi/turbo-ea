"""Sync the current fiscal year's cost-history row on every card write."""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.card import Card
from app.models.card_cost_history import CardCostHistory
from app.models.card_type import CardType
from app.services.cost_value import cost_value
from app.services.fiscal_year import current_fiscal_year, get_fiscal_year_start


async def sync_current_fy_history(db: AsyncSession, card: Card) -> None:
    """Upsert the current fiscal year's history row for every cost-typed
    field on ``card``'s type, from ``card.attributes``'s present value."""
    type_def = (
        await db.execute(select(CardType).where(CardType.key == card.type))
    ).scalar_one_or_none()
    if type_def is None:
        return
    cost_keys = [
        f["key"]
        for section in type_def.fields_schema or []
        for f in section.get("fields", [])
        if f.get("type") == "cost"
    ]
    if not cost_keys:
        return
    fy = current_fiscal_year(await get_fiscal_year_start(db))
    attrs = card.attributes or {}
    for key in cost_keys:
        row = (
            await db.execute(
                select(CardCostHistory).where(
                    CardCostHistory.card_id == card.id,
                    CardCostHistory.fiscal_year == fy,
                    CardCostHistory.field_key == key,
                )
            )
        ).scalar_one_or_none()
        value = cost_value(attrs.get(key))
        if row is None:
            db.add(CardCostHistory(card_id=card.id, fiscal_year=fy, field_key=key, value=value))
        else:
            row.value = value
    await db.flush()
