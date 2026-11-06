"""The licensing report: which cards count in which fiscal year, and what they show.

One rule for the rows of a year, every trend bar, the Platform aggregate and a single picked
card (as ``cost_report`` is for costs): a candidate card is ACTIVE, readable (``CardReadScope``)
and tracks the metric in ``licensingModel``; it counts in the CURRENT year when it is live in it
(``is_live_in_fiscal_year``), in any other year (the Forecast included) when it has a stored row.
Two queries load the cards' rows over all six years; there is no per-card query.
"""

from __future__ import annotations

import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.card import Card
from app.models.relation import Relation
from app.services import license_types, yearly_rows
from app.services.card_licenses import LICENSE_TYPES, items_by_card
from app.services.card_read_scope import CardReadScope
from app.services.cost_grouping import GroupBy, assign_groups
from app.services.fiscal_year import (
    FISCAL_YEAR_LOOKAHEAD,
    current_fiscal_year,
    get_fiscal_year_start,
)
from app.services.license_status import metric_result
from app.services.lifecycle import is_live_in_fiscal_year

PLATFORM_RELATIONS = ("relPlatformToApp", "relPlatformToITC")
PLATFORM_TYPE = "Platform"


def counts_in_year(card: Card, has_row: bool, fy: int, cur: int, start_month: int) -> bool:
    """The current year: live in it. Any other year (Forecast included): a stored row."""
    if fy == cur:
        return is_live_in_fiscal_year(card.lifecycle, cur, start_month)
    return has_row


async def _platform_card_ids(db: AsyncSession, platform_id: uuid.UUID) -> set[uuid.UUID]:
    rels = await db.execute(
        select(Relation.source_id, Relation.target_id).where(
            Relation.type.in_(PLATFORM_RELATIONS),
            (Relation.source_id == platform_id) | (Relation.target_id == platform_id),
        )
    )
    return {t if s == platform_id else s for s, t in rels.all()}


async def candidate_cards(
    db: AsyncSession,
    read_scope: CardReadScope,
    metric: str,
    *,
    type_key: str | None = None,
    platform_id: uuid.UUID | None = None,
    card_id: uuid.UUID | None = None,
) -> list[Card]:
    """ACTIVE, readable cards whose ``licensingModel`` holds ``metric``: of a type, linked to a
    Platform (either direction, each card once) or the one card."""
    stmt = select(Card).where(
        Card.status == "ACTIVE",
        Card.type.in_(LICENSE_TYPES),
        Card.attributes.contains({"licensingModel": [metric]}),
        *read_scope.where(Card, mode="module"),
    )
    if card_id is not None:
        stmt = stmt.where(Card.id == card_id)
    elif platform_id is not None:
        stmt = stmt.where(Card.id.in_(await _platform_card_ids(db, platform_id)))
    else:
        stmt = stmt.where(Card.type == type_key)
    return list((await db.execute(stmt.order_by(Card.name, Card.id))).scalars().all())


def _by_type(result) -> dict[str, dict]:
    return {
        t.key: {
            "licensed": t.licensed,
            "actual": t.actual,
            "pct": t.pct,
            "no_licence": t.no_licence,
            "status": t.status,
        }
        for t in result.types
    }


async def build_report(
    db: AsyncSession,
    read_scope: CardReadScope,
    *,
    type_key: str,
    metric: str,
    fy: int,
    group_by: GroupBy | None,
    card_id: uuid.UUID | None,
    hidden_attribute_keys: dict[str, frozenset[str]] | None = None,
) -> dict:
    """Rows of ``fy`` plus the six-year trend. ``card_id`` is an Application / IT Component
    (the one card) or a Platform (the cards linked to it: no status, ``type_key`` and
    ``group_by`` ignored). Raises ``ValueError`` when the grouping is refused."""
    sm = await get_fiscal_year_start(db)
    cur = current_fiscal_year(sm)
    forecast = cur + FISCAL_YEAR_LOOKAHEAD
    years = list(yearly_rows.window_years(cur))

    aggregate = None
    if card_id is not None:
        picked = (await db.execute(select(Card).where(Card.id == card_id))).scalar_one()
        if picked.type == PLATFORM_TYPE:
            aggregate = {"id": str(picked.id), "name": picked.name, "type": PLATFORM_TYPE}
            cards = await candidate_cards(db, read_scope, metric, platform_id=picked.id)
        else:
            cards = await candidate_cards(db, read_scope, metric, card_id=picked.id)
    else:
        cards = await candidate_cards(db, read_scope, metric, type_key=type_key)

    data = await items_by_card(db, [c.id for c in cards], years, sm)
    catalogue = await license_types.list_items(db)
    order = [t.key for t in catalogue]

    def counted(card: Card, year: int) -> bool:
        _, confirmed, _ = data[card.id][year]
        return counts_in_year(card, confirmed, year, cur, sm)

    in_year = [c for c in cards if counted(c, fy)]
    groups = (
        await assign_groups(db, read_scope, in_year, group_by, [type_key])
        if group_by and card_id is None
        else {}
    )
    hidden = hidden_attribute_keys or {}
    rows = []
    for card in in_year:
        result = metric_result(metric, data[card.id][fy][0].get(metric) or {}, order)
        row = {
            "id": str(card.id),
            "name": card.name,
            "type": card.type,
            "attributes": {
                k: v
                for k, v in (card.attributes or {}).items()
                if k not in hidden.get(card.type, ())
            },
            "status": None if aggregate else result.status,
            "worst_pct": result.worst_pct,
            "worst_no_licence": result.worst_no_licence,
            "licensed_total": result.licensed_total,
            "actual_total": result.actual_total,
            "by_type": _by_type(result),
        }
        if card.id in groups:
            row["group"] = groups[card.id]
        rows.append(row)

    trend = []
    for year in years:
        per_card: dict[str, dict] = {}
        for card in cards:
            cells = data[card.id][year][0].get(metric) or {}
            if cells and counted(card, year):
                per_card[str(card.id)] = {
                    key: {
                        "licensed": cell.get("licensed") or 0,
                        "actual": None if year == forecast else cell.get("actual"),
                    }
                    for key, cell in cells.items()
                }
        trend.append({"fiscal_year": year, "cards": per_card})

    return {
        "fiscal_year": fy,
        "current_fiscal_year": cur,
        "fiscal_year_start": sm,
        "metric": metric,
        "years": years,
        "license_types": [license_types.serialize(t) for t in catalogue],
        "aggregate": aggregate,
        "rows": rows,
        "trend": trend,
    }
