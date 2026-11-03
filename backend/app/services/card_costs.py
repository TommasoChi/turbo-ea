"""Per-card cost items by fiscal year: TCO, current-year fallback, confirm, copy to Forecast.

Reads and writes ``card_costs``. Flushes, never commits; the route handler commits.
A fiscal year with a row (even an empty one) is confirmed. Only the *current* year
with no row falls back to the most recent earlier row; never the Forecast or a past year.
"""

from __future__ import annotations

import math
import uuid
from dataclasses import dataclass, field
from datetime import date

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.card import Card
from app.models.card_cost import CardCost
from app.models.cost_item_type import CostItemType
from app.services.cost_value import cost_value
from app.services.fiscal_year import (
    FISCAL_YEAR_LOOKAHEAD,
    FISCAL_YEAR_LOOKBACK,
    current_fiscal_year,
    get_fiscal_year_start,
)

COST_ITEM_TYPES: frozenset[str] = frozenset({"Application", "ITComponent"})
RENEWAL_NEAR_DAYS = 90
DERIVED_KEY = "costTotalAnnual"


class CostError(Exception):
    """``code``: archived_item, unknown_item, invalid_amount, year_out_of_range."""

    def __init__(self, code: str, message: str = "") -> None:
        super().__init__(message or code)
        self.code = code


@dataclass
class CostLine:
    key: str
    amount: float
    renewal_date: date | None
    archived: bool


@dataclass
class YearCosts:
    fiscal_year: int
    is_current: bool
    is_forecast: bool
    confirmed: bool
    fallback_from: int | None
    items: list[CostLine] = field(default_factory=list)
    tco: float = 0.0


def tco(items: list[CostLine]) -> float:
    return sum(i.amount for i in items)


def _shift(iso: str | None, years: int) -> str | None:
    if not iso:
        return None
    d = date.fromisoformat(iso)
    try:
        return d.replace(year=d.year + years).isoformat()
    except ValueError:  # Feb 29 into a non-leap year
        return d.replace(year=d.year + years, day=28).isoformat()


def _shifted(items: dict, years: int) -> dict:
    return {
        k: {"amount": v["amount"], "renewal_date": _shift(v.get("renewal_date"), years)}
        for k, v in items.items()
    }


async def _row(db: AsyncSession, card_id: uuid.UUID, fy: int) -> CardCost | None:
    return (
        await db.execute(
            select(CardCost).where(CardCost.card_id == card_id, CardCost.fiscal_year == fy)
        )
    ).scalar_one_or_none()


async def _fallback_row(db: AsyncSession, card_id: uuid.UUID, fy: int) -> CardCost | None:
    return (
        await db.execute(
            select(CardCost)
            .where(CardCost.card_id == card_id, CardCost.fiscal_year < fy)
            .order_by(CardCost.fiscal_year.desc())
            .limit(1)
        )
    ).scalar_one_or_none()


async def _archived_keys(db: AsyncSession) -> dict[str, bool]:
    rows = await db.execute(select(CostItemType.key, CostItemType.archived))
    return {k: a for k, a in rows.all()}


def _lines(items: dict, archived: dict[str, bool]) -> list[CostLine]:
    return [
        CostLine(
            key=k,
            amount=float(cost_value(v.get("amount"))),
            renewal_date=date.fromisoformat(v["renewal_date"]) if v.get("renewal_date") else None,
            archived=archived.get(k, False),
        )
        for k, v in items.items()
    ]


async def _resolve(
    db: AsyncSession, card_id: uuid.UUID, fy: int, start_month: int
) -> tuple[dict, bool, int | None]:
    """``(items, confirmed, fallback_from)`` for one year."""
    row = await _row(db, card_id, fy)
    if row is not None:
        return row.items or {}, True, None
    if fy == current_fiscal_year(start_month):
        prev = await _fallback_row(db, card_id, fy)
        if prev is not None:
            return _shifted(prev.items or {}, fy - prev.fiscal_year), False, prev.fiscal_year
    return {}, False, None


async def get_year_row(
    db: AsyncSession, card_id: uuid.UUID, fiscal_year: int, start_month: int
) -> YearCosts:
    """Any single year, no window limit."""
    items, confirmed, fb = await _resolve(db, card_id, fiscal_year, start_month)
    lines = _lines(items, await _archived_keys(db))
    cur = current_fiscal_year(start_month)
    return YearCosts(
        fiscal_year=fiscal_year,
        is_current=fiscal_year == cur,
        is_forecast=fiscal_year == cur + FISCAL_YEAR_LOOKAHEAD,
        confirmed=confirmed,
        fallback_from=fb,
        items=lines,
        tco=tco(lines),
    )


get_year_costs = get_year_row


async def get_window(db: AsyncSession, card_id: uuid.UUID, start_month: int) -> list[YearCosts]:
    cur = current_fiscal_year(start_month)
    return [
        await get_year_row(db, card_id, y, start_month)
        for y in range(cur - 4, cur + FISCAL_YEAR_LOOKAHEAD + 1)
    ]


def _check_window(fy: int, start_month: int) -> None:
    cur = current_fiscal_year(start_month)
    if not cur - FISCAL_YEAR_LOOKBACK <= fy <= cur + FISCAL_YEAR_LOOKAHEAD:
        raise CostError("year_out_of_range", f"Fiscal year {fy} is outside the editable window")


async def _editable(db: AsyncSession, card_id: uuid.UUID, fy: int, start_month: int) -> CardCost:
    """The year's row, created (with the fallback set materialised) if missing."""
    row = await _row(db, card_id, fy)
    if row is None:
        items, _, _ = await _resolve(db, card_id, fy, start_month)
        row = CardCost(card_id=card_id, fiscal_year=fy, items=items)
        db.add(row)
        await db.flush()
    return row


async def upsert_item(
    db: AsyncSession,
    card_id: uuid.UUID,
    fiscal_year: int,
    key: str,
    amount: float,
    renewal_date: date | None,
) -> YearCosts:
    sm = await get_fiscal_year_start(db)
    _check_window(fiscal_year, sm)
    if (
        isinstance(amount, bool)
        or not isinstance(amount, (int, float))
        or not math.isfinite(amount)
        or amount < 0
    ):
        raise CostError("invalid_amount", "Amount must be a non-negative number")
    archived = await _archived_keys(db)
    if key not in archived:
        raise CostError("unknown_item", f"Unknown cost item '{key}'")
    current, _, _ = await _resolve(db, card_id, fiscal_year, sm)
    if key not in current and archived[key]:
        raise CostError("archived_item", f"Cost item '{key}' is archived")
    row = await _editable(db, card_id, fiscal_year, sm)
    row.items = {
        **(row.items or {}),
        key: {"amount": amount, "renewal_date": renewal_date.isoformat() if renewal_date else None},
    }
    await db.flush()
    return await get_year_row(db, card_id, fiscal_year, sm)


async def delete_item(db: AsyncSession, card_id: uuid.UUID, fiscal_year: int, key: str) -> None:
    sm = await get_fiscal_year_start(db)
    _check_window(fiscal_year, sm)
    row = await _editable(db, card_id, fiscal_year, sm)
    row.items = {k: v for k, v in (row.items or {}).items() if k != key}
    await db.flush()


async def confirm_year(db: AsyncSession, card_id: uuid.UUID, fiscal_year: int) -> YearCosts:
    sm = await get_fiscal_year_start(db)
    _check_window(fiscal_year, sm)
    await _editable(db, card_id, fiscal_year, sm)
    return await get_year_row(db, card_id, fiscal_year, sm)


async def copy_to_forecast(
    db: AsyncSession, card_id: uuid.UUID, from_year: int, key: str
) -> YearCosts:
    sm = await get_fiscal_year_start(db)
    forecast = current_fiscal_year(sm) + FISCAL_YEAR_LOOKAHEAD
    if from_year >= forecast:
        raise CostError("year_out_of_range", "Source year must be before the Forecast year")
    items, _, _ = await _resolve(db, card_id, from_year, sm)
    src = items.get(key)
    if src is None:  # an archived item is fine here: it already has an amount, not a new addition
        raise CostError("unknown_item", f"'{key}' has no amount in FY{from_year}")
    row = await _editable(db, card_id, forecast, sm)
    row.items = {**(row.items or {}), key: _shifted({key: src}, forecast - from_year)[key]}
    await db.flush()
    return await get_year_row(db, card_id, forecast, sm)


async def recompute_derived(db: AsyncSession, card: Card) -> None:
    """Write the current-year TCO (fallback included) into ``attributes.costTotalAnnual``."""
    sm = await get_fiscal_year_start(db)
    yc = await get_year_row(db, card.id, current_fiscal_year(sm), sm)
    card.attributes = {**(card.attributes or {}), DERIVED_KEY: yc.tco}
