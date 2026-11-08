"""Fiscal-year rows shared by card costs and card licenses.

Generic over a model with ``card_id``, ``fiscal_year`` and ``items`` (``CardCost``,
``CardLicense``). A year with a row (even an empty one) is confirmed; only the *current* year
with no row falls back to the latest earlier row, passed through the caller's ``carry``.
Flushes nothing itself but ``editable``'s insert; never commits.
"""

from __future__ import annotations

import uuid
from collections.abc import Awaitable, Callable
from typing import Any, TypeVar, cast

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.services.fiscal_year import (
    FISCAL_YEAR_LOOKAHEAD,
    FISCAL_YEAR_LOOKBACK,
    current_fiscal_year,
)

WINDOW_PAST = 4  # the card section shows current-4 .. current+1

T = TypeVar("T")
Carry = Callable[[dict, int], dict]
# Lookups a caller may substitute (card_costs keeps its own ``_row`` / ``_fallback_row`` names).
RowFn = Callable[..., Awaitable[Any]]


async def row(
    db: AsyncSession, model: type[T], card_id: uuid.UUID, fy: int, lock: bool = False
) -> T | None:
    m: Any = model
    stmt = select(m).where(m.card_id == card_id, m.fiscal_year == fy)
    if lock:
        stmt = stmt.with_for_update().execution_options(populate_existing=True)
    return cast("T | None", (await db.execute(stmt)).scalar_one_or_none())


async def fallback_row(db: AsyncSession, model: type[T], card_id: uuid.UUID, fy: int) -> T | None:
    m: Any = model
    return cast(
        "T | None",
        (
            await db.execute(
                select(m)
                .where(m.card_id == card_id, m.fiscal_year < fy)
                .order_by(m.fiscal_year.desc())
                .limit(1)
            )
        ).scalar_one_or_none(),
    )


def resolve_year(
    row_items: dict | None, prev: tuple[int, dict] | None, fy: int, cur: int, carry: Carry
) -> tuple[dict, bool, int | None]:
    """``(items, confirmed, fallback_from)`` from a year's row and the latest earlier one.

    A row (even an empty one) is confirmed; only the *current* year with no row falls back.
    """
    if row_items is not None:
        return row_items, True, None
    if fy == cur and prev is not None:
        return carry(prev[1], fy - prev[0]), False, prev[0]
    return {}, False, None


async def resolve(
    db: AsyncSession,
    model,
    card_id: uuid.UUID,
    fy: int,
    start_month: int,
    carry: Carry,
    *,
    row_fn: RowFn | None = None,
    fallback_fn: RowFn | None = None,
) -> tuple[dict, bool, int | None]:
    """``(items, confirmed, fallback_from)`` for one year."""
    r = await (row_fn(db, card_id, fy) if row_fn else row(db, model, card_id, fy))
    cur = current_fiscal_year(start_month)
    prev = None
    if r is None and fy == cur:
        p = await (
            fallback_fn(db, card_id, fy) if fallback_fn else fallback_row(db, model, card_id, fy)
        )
        prev = (p.fiscal_year, p.items or {}) if p is not None else None
    return resolve_year(None if r is None else r.items or {}, prev, fy, cur, carry)


def in_window(fy: int, start_month: int) -> bool:
    """Writes accept ``current-5 .. current+1``."""
    cur = current_fiscal_year(start_month)
    return cur - FISCAL_YEAR_LOOKBACK <= fy <= cur + FISCAL_YEAR_LOOKAHEAD


def window_years(cur: int) -> range:
    return range(cur - WINDOW_PAST, cur + FISCAL_YEAR_LOOKAHEAD + 1)


async def editable(
    db: AsyncSession,
    model: type[T],
    card_id: uuid.UUID,
    fy: int,
    start_month: int,
    carry: Carry,
    *,
    row_fn: RowFn | None = None,
    fallback_fn: RowFn | None = None,
) -> T:
    """The year's row, locked FOR UPDATE; created (fallback set materialised) if missing.

    The insert is ON CONFLICT DO NOTHING and the row is re-selected FOR UPDATE, so the
    loser of a concurrent first edit re-reads the winner's row instead of failing.
    """

    async def locked():
        return await (
            row_fn(db, card_id, fy, lock=True) if row_fn else row(db, model, card_id, fy, True)
        )

    r = await locked()
    if r is None:
        items, _, _ = await resolve(
            db, model, card_id, fy, start_month, carry, row_fn=row_fn, fallback_fn=fallback_fn
        )
        await db.execute(
            pg_insert(model)
            .values(card_id=card_id, fiscal_year=fy, items=items)
            .on_conflict_do_nothing(index_elements=["card_id", "fiscal_year"])
        )
        r = await locked()
    assert r is not None
    return cast("T", r)
