"""The cost fields that concur to a total, read from the calculation that fills it."""

from __future__ import annotations

import re

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.calculation import Calculation
from app.models.card_type import CardType
from app.models.cost_item_type import CostItemType
from app.services.card_costs import COST_ITEM_TYPES, DERIVED_KEY

_DATA_REF = re.compile(r"\bdata\.([A-Za-z_]\w*)")


def formula_field_refs(formula: str) -> list[str]:
    """Every ``data.<key>`` in ``formula``, in order of first appearance, no duplicates."""
    return list(dict.fromkeys(_DATA_REF.findall(formula)))


async def _type_components(db: AsyncSession, type_key: str, cost_field: str) -> list[str]:
    if type_key in COST_ITEM_TYPES and cost_field == DERIVED_KEY:
        # the catalogue, archived items included: their recorded amounts still add up
        rows = await db.execute(
            select(CostItemType.key).order_by(CostItemType.sort_order, CostItemType.label)
        )
        return list(rows.scalars().all())
    calc = (
        (
            await db.execute(
                select(Calculation)
                .where(
                    Calculation.target_type_key == type_key,
                    Calculation.target_field_key == cost_field,
                    Calculation.is_active.is_(True),
                )
                .order_by(Calculation.execution_order, Calculation.created_at)
            )
        )
        .scalars()
        .first()
    )
    if calc is None:
        return [cost_field]
    card_type = (
        await db.execute(select(CardType).where(CardType.key == type_key))
    ).scalar_one_or_none()
    cost_keys = {
        f["key"]
        for section in (card_type.fields_schema if card_type else None) or []
        for f in section.get("fields", [])
        if f.get("type") == "cost"
    }
    return [k for k in formula_field_refs(calc.formula) if k in cost_keys]


async def cost_components(db: AsyncSession, type_keys: list[str], cost_field: str) -> list[str]:
    """The cost fields concurring to ``cost_field``; across types, those they all share."""
    per_type = [await _type_components(db, key, cost_field) for key in type_keys]
    shared = set.intersection(*map(set, per_type)) if per_type else set()
    return [k for k in per_type[0] if k in shared] if per_type else []
