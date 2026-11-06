"""Per-card licenses by fiscal year: licensed / actual counts per metric and license type.

Reads and writes ``card_licenses``. Flushes, never commits; the route handler commits.
Year resolution is ``yearly_rows`` (shared with costs); the carry-forward and the copy to
the Forecast year carry ``licensed`` only, so a new year never inherits last year's use.
``merge_cell`` is the one write rule (PUT, copy-to-forecast, the import).
"""

from __future__ import annotations

import uuid
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Final

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.card import Card
from app.models.card_license import CardLicense
from app.services import license_types, yearly_rows
from app.services.event_bus import event_bus
from app.services.fiscal_year import (
    FISCAL_YEAR_LOOKAHEAD,
    current_fiscal_year,
    get_fiscal_year_start,
)
from app.services.license_status import (
    METRICS,
    MetricResult,
    MetricStatus,
    card_status,
    metric_result,
)

LICENSE_TYPES: frozenset[str] = frozenset({"Application", "ITComponent"})
# Not "card.updated": rollback would replay its changes as card fields and no-op.
LICENSE_EVENT = "card.licenses_updated"
LEGACY_KEYS = ("licensedUsers", "licensedInstallations", "actualUsers", "actualInstallations")
LIST_KEY = "license_types"  # the event's changes key
MAX_COUNT = 1_000_000_000
UNSET: Final = object()  # "leave this value as it is"


class LicenseError(Exception):
    """``code``: unknown_type, archived_type, invalid_metric, invalid_count, forecast_actual,
    year_out_of_range."""

    def __init__(self, code: str, message: str = "") -> None:
        super().__init__(message or code)
        self.code = code


@dataclass
class YearLicenses:
    fiscal_year: int
    is_current: bool
    is_forecast: bool
    confirmed: bool
    fallback_from: int | None
    metrics: list[MetricResult]
    status: MetricStatus | None  # None on the Forecast year
    type_keys: list[str]  # sorted license type keys present in any stored metric (event payload)


def licensed_only(items: dict, years: int) -> dict:
    """The carry: every cell keeps its licensed count, its actual is dropped."""
    return {
        metric: {k: {"licensed": c.get("licensed") or 0, "actual": None} for k, c in cells.items()}
        for metric, cells in items.items()
    }


def model_of(card: Card) -> list[str]:
    raw = (card.attributes or {}).get("licensingModel")
    chosen = set(raw) if isinstance(raw, list) else set()
    return [m for m in METRICS if m in chosen]


def year_licenses(
    items: dict,
    confirmed: bool,
    fallback_from: int | None,
    fy: int,
    cur: int,
    model: list[str],
    order: list[str],
) -> YearLicenses:
    metrics = [metric_result(m, items.get(m) or {}, order) for m in METRICS if m in model]
    is_forecast = fy == cur + FISCAL_YEAR_LOOKAHEAD
    return YearLicenses(
        fiscal_year=fy,
        is_current=fy == cur,
        is_forecast=is_forecast,
        confirmed=confirmed,
        fallback_from=fallback_from,
        metrics=metrics,
        status=None if is_forecast else card_status(metrics),
        type_keys=sorted({k for cells in items.values() for k in cells}),
    )


async def _resolve(
    db: AsyncSession, card_id: uuid.UUID, fy: int, start_month: int
) -> tuple[dict, bool, int | None]:
    return await yearly_rows.resolve(db, CardLicense, card_id, fy, start_month, licensed_only)


async def items_by_card(
    db: AsyncSession, card_ids: list[uuid.UUID], years: list[int], start_month: int
) -> dict[uuid.UUID, dict[int, tuple[dict, bool, int | None]]]:
    """``{card: {year: (items, confirmed, fallback_from)}}`` in one query.

    Same resolution as a single year (``yearly_rows.resolve_year``): ``confirmed`` means
    the year has a row; only the current year falls back, licensed counts only.
    """
    cur = current_fiscal_year(start_month)
    stored: dict[uuid.UUID, dict[int, dict]] = {}
    if card_ids:
        rows = await db.execute(
            select(CardLicense.card_id, CardLicense.fiscal_year, CardLicense.items).where(
                CardLicense.card_id.in_(card_ids), CardLicense.fiscal_year <= max(years)
            )
        )
        for card_id, fy, items in rows.all():
            stored.setdefault(card_id, {})[fy] = items or {}
    out: dict[uuid.UUID, dict[int, tuple[dict, bool, int | None]]] = {}
    for card_id in card_ids:
        mine = stored.get(card_id, {})
        out[card_id] = {}
        for fy in years:
            earlier = [y for y in mine if y < fy]
            prev = (max(earlier), mine[max(earlier)]) if earlier else None
            out[card_id][fy] = yearly_rows.resolve_year(mine.get(fy), prev, fy, cur, licensed_only)
    return out


async def type_order(db: AsyncSession) -> list[str]:
    return [r.key for r in await license_types.list_items(db)]  # sort_order, archived included


async def get_year(
    db: AsyncSession,
    card: Card,
    fiscal_year: int,
    start_month: int,
    order: list[str] | None = None,
) -> YearLicenses:
    """Any single year, no window limit; ``metrics`` = ``licensingModel`` ∩ ``METRICS``.
    ``order``: the catalogue key order, when the caller already holds it."""
    items, confirmed, fb = await _resolve(db, card.id, fiscal_year, start_month)
    return year_licenses(
        items,
        confirmed,
        fb,
        fiscal_year,
        current_fiscal_year(start_month),
        model_of(card),
        await type_order(db) if order is None else order,
    )


async def get_window(
    db: AsyncSession, card: Card, start_month: int, order: list[str] | None = None
) -> list[YearLicenses]:
    """The section's six years from one row query (not one per year)."""
    cur = current_fiscal_year(start_month)
    years = list(yearly_rows.window_years(cur))
    data = (await items_by_card(db, [card.id], years, start_month))[card.id]
    order = await type_order(db) if order is None else order
    model = model_of(card)
    return [year_licenses(*data[y], y, cur, model, order) for y in years]


def check_count(name: str, value: object) -> None:
    if isinstance(value, bool) or not isinstance(value, int) or not 0 <= value <= MAX_COUNT:
        raise LicenseError("invalid_count", f"{name} must be an integer from 0 to {MAX_COUNT}")


async def merge_cell(
    db: AsyncSession,
    card_id: uuid.UUID,
    fiscal_year: int,
    metric: str,
    key: str,
    *,
    licensed: object = UNSET,
    actual: object = UNSET,
    archived: dict[str, bool] | None = None,
    start_month: int | None = None,
) -> None:
    """The one write rule. ``UNSET`` leaves a value as it is, ``actual=None`` clears it."""
    sm = await get_fiscal_year_start(db) if start_month is None else start_month
    if not yearly_rows.in_window(fiscal_year, sm):
        raise LicenseError("year_out_of_range", f"Fiscal year {fiscal_year} is outside the window")
    if metric not in METRICS:
        raise LicenseError("invalid_metric", f"Unknown metric '{metric}'")
    if archived is None:
        archived = await license_types.archived_keys(db)
    if key not in archived:
        raise LicenseError("unknown_type", f"Unknown license type '{key}'")
    if licensed is not UNSET:
        check_count("licensed", licensed)
    if actual is not UNSET and actual is not None:
        check_count("actual", actual)
        if fiscal_year == current_fiscal_year(sm) + FISCAL_YEAR_LOOKAHEAD:
            raise LicenseError("forecast_actual", "The Forecast year takes licensed counts only")
    current, _, _ = await _resolve(db, card_id, fiscal_year, sm)
    if key not in (current.get(metric) or {}) and archived[key]:
        raise LicenseError("archived_type", f"License type '{key}' is archived")
    row = await yearly_rows.editable(db, CardLicense, card_id, fiscal_year, sm, licensed_only)
    cells = dict((row.items or {}).get(metric) or {})
    cell = dict(cells.get(key) or {"licensed": 0, "actual": None})
    if licensed is not UNSET:
        cell["licensed"] = licensed
    if actual is not UNSET:
        cell["actual"] = actual
    row.items = {**(row.items or {}), metric: {**cells, key: cell}}
    await db.flush()


async def delete_cell(
    db: AsyncSession, card_id: uuid.UUID, fiscal_year: int, metric: str, key: str
) -> bool:
    """``False`` (nothing written) when the year does not hold the cell; idempotent by design."""
    sm = await get_fiscal_year_start(db)
    if not yearly_rows.in_window(fiscal_year, sm):
        raise LicenseError("year_out_of_range", f"Fiscal year {fiscal_year} is outside the window")
    items, _, _ = await _resolve(db, card_id, fiscal_year, sm)
    if key not in (items.get(metric) or {}):
        return False
    row = await yearly_rows.editable(db, CardLicense, card_id, fiscal_year, sm, licensed_only)
    kept = {k: v for k, v in ((row.items or {}).get(metric) or {}).items() if k != key}
    rest = {m: c for m, c in (row.items or {}).items() if m != metric}
    row.items = {**rest, **({metric: kept} if kept else {})}
    await db.flush()
    return True


async def confirm_year(db: AsyncSession, card_id: uuid.UUID, fiscal_year: int) -> None:
    sm = await get_fiscal_year_start(db)
    if not yearly_rows.in_window(fiscal_year, sm):
        raise LicenseError("year_out_of_range", f"Fiscal year {fiscal_year} is outside the window")
    await yearly_rows.editable(db, CardLicense, card_id, fiscal_year, sm, licensed_only)


async def copy_to_forecast(
    db: AsyncSession, card_id: uuid.UUID, from_year: int, metric: str, key: str
) -> None:
    """Licensed count only, through ``merge_cell``."""
    sm = await get_fiscal_year_start(db)
    forecast = current_fiscal_year(sm) + FISCAL_YEAR_LOOKAHEAD
    if from_year >= forecast:
        raise LicenseError("year_out_of_range", "Source year must be before the Forecast year")
    items, _, _ = await _resolve(db, card_id, from_year, sm)
    src = (items.get(metric) or {}).get(key)
    if src is None:
        raise LicenseError("unknown_type", f"'{key}' has no count in FY{from_year}")
    # An archived type is fine here: it already has a count, it is not a new addition.
    archived = {**await license_types.archived_keys(db), key: False}
    await merge_cell(
        db,
        card_id,
        forecast,
        metric,
        key,
        licensed=src.get("licensed") or 0,
        archived=archived,
        start_month=sm,
    )


async def publish_change(
    db: AsyncSession,
    card: Card,
    user_id: uuid.UUID,
    fiscal_year: int,
    old: YearLicenses,
    *,
    start_month: int,
    order: list[str],
) -> YearLicenses:
    """Read the new year and publish the event. Flush only.

    The event carries license type keys, never counts: it is readable without licenses.view.
    """
    new = await get_year(db, card, fiscal_year, start_month, order)
    await event_bus.publish(
        LICENSE_EVENT,
        {
            "id": str(card.id),
            "source": "card_licenses",
            "fiscal_year": fiscal_year,
            "changes": {LIST_KEY: {"old": old.type_keys, "new": new.type_keys}},
        },
        db=db,
        card_id=card.id,
        user_id=user_id,
    )
    return new


async def apply_write(
    db: AsyncSession,
    card: Card,
    user_id: uuid.UUID,
    fiscal_year: int,
    op: Callable[[], Awaitable[object]],
) -> YearLicenses:
    """Run ``op`` and publish the event; a no-op write (``False``) publishes nothing."""
    sm = await get_fiscal_year_start(db)
    order = await type_order(db)
    old = await get_year(db, card, fiscal_year, sm, order)
    if await op() is False:
        return old
    # The catalogue order cannot change inside a license write, so it is read once.
    return await publish_change(db, card, user_id, fiscal_year, old, start_month=sm, order=order)
