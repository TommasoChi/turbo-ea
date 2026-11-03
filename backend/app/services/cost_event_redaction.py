"""Cost values in event feeds: one place that strips them for readers without cost access."""

from __future__ import annotations

from collections.abc import Sequence

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.card_type import CardType
from app.models.event import Event
from app.models.user import User
from app.services.audit_labels import cost_event_summaries
from app.services.card_costs import COST_EVENT, DERIVED_KEY
from app.services.cost_field_filter import cost_field_keys_from_card_schema, redact_event_costs
from app.services.permission_service import PermissionService


async def all_cost_keys(db: AsyncSession) -> frozenset[str]:
    """``costTotalAnnual`` plus every cost-typed field key of any card type."""
    schemas = (await db.execute(select(CardType.fields_schema))).scalars().all()
    return frozenset({DERIVED_KEY}).union(*(cost_field_keys_from_card_schema(fs) for fs in schemas))


async def redact_cost_events(
    db: AsyncSession, user: User, events: Sequence[Event], payloads: Sequence[dict | None]
) -> list[dict | None]:
    """``payloads`` (parallel to ``events``) minus cost values on cards ``user`` cannot cost-read.

    One access query for the whole list. The event stays; only the values go.
    """
    card_ids = {e.card_id for e in events if e.card_id is not None}
    allowed = await PermissionService.card_ids_with_cost_access(db, user, card_ids)
    if card_ids <= allowed:
        return list(payloads)
    keys = await all_cost_keys(db)
    return [
        redact_event_costs(p, keys) if e.card_id is not None and e.card_id not in allowed else p
        for e, p in zip(events, payloads)
    ]


async def add_cost_summaries(
    db: AsyncSession, card_name: str, events: Sequence[Event], payloads: Sequence[dict | None]
) -> list[dict | None]:
    """Copies of ``payloads`` with a person-readable ``summary`` on each cost event."""
    idx = [
        i
        for i, e in enumerate(events)
        if e.event_type == COST_EVENT and isinstance(payloads[i], dict)
    ]
    out = list(payloads)
    summaries = await cost_event_summaries(db, card_name, [payloads[i] for i in idx])
    for i, text in zip(idx, summaries):
        out[i] = {**payloads[i], "summary": text}
    return out
