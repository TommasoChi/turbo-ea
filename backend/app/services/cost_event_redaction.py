"""Cost values in event feeds: one place that strips them for readers without cost access."""

from __future__ import annotations

from collections.abc import Sequence

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.card_type import CardType
from app.models.cost_item_type import CostItemType
from app.models.event import Event
from app.models.user import User
from app.services.audit_labels import cost_event_summaries, license_event_summaries
from app.services.card_costs import COST_EVENT, DERIVED_KEY
from app.services.card_licenses import LEGACY_KEYS, LICENSE_EVENT, LIST_KEY
from app.services.cost_field_filter import (
    COST_ITEMS_KEY,
    cost_field_keys_from_card_schema,
    strip_change_keys,
)
from app.services.cost_items_migration import LEGACY_ITEMS
from app.services.permission_service import PermissionService


async def all_cost_keys(db: AsyncSession) -> frozenset[str]:
    """``costTotalAnnual``, every cost-typed field key of any card type, and the keys migration
    175 moved out of the schema (legacy + catalogue): old ``card.updated`` diffs still name them."""
    schemas = (await db.execute(select(CardType.fields_schema))).scalars().all()
    catalogue = (await db.execute(select(CostItemType.key))).scalars().all()
    legacy = {k for k, _ in LEGACY_ITEMS}
    return frozenset({DERIVED_KEY, *legacy, *catalogue}).union(
        *(cost_field_keys_from_card_schema(fs) for fs in schemas)
    )


LICENSE_KEYS: frozenset[str] = frozenset({*LEGACY_KEYS, LIST_KEY})


def _touches(payload: dict | None, keys: frozenset[str]) -> bool:
    changes = payload.get("changes") if isinstance(payload, dict) else None
    if not isinstance(changes, dict):
        return False
    attrs = changes.get("attributes")
    sides = [v for v in attrs.values() if isinstance(v, dict)] if isinstance(attrs, dict) else []
    return any(k in keys for k in changes) or any(k in keys for side in sides for k in side)


async def redact_cost_events(
    db: AsyncSession, user: User, events: Sequence[Event], payloads: Sequence[dict | None]
) -> list[dict | None]:
    """``payloads`` (parallel to ``events``) minus the values ``user`` may not read.

    Cost values go from cards without cost access, license values from cards without license
    access. One access query per domain for the whole list (the license one only when a payload
    names a license key). The event stays; only the values go.
    """
    card_ids = {e.card_id for e in events if e.card_id is not None}
    cost_ok = await PermissionService.card_ids_with_cost_access(db, user, card_ids)
    lic_ok = card_ids
    if any(_touches(p, LICENSE_KEYS) for p in payloads):
        lic_ok = await PermissionService.card_ids_with_license_access(db, user, card_ids)
    if card_ids <= cost_ok and card_ids <= lic_ok:
        return list(payloads)
    cost_drop = (await all_cost_keys(db) | {COST_ITEMS_KEY}) if card_ids - cost_ok else frozenset()
    out: list[dict | None] = []
    for e, p in zip(events, payloads):
        drop: frozenset[str] = frozenset()
        if e.card_id is not None:
            if e.card_id not in cost_ok:
                drop |= cost_drop
            if e.card_id not in lic_ok:
                drop |= LICENSE_KEYS
        out.append(strip_change_keys(p, drop) if drop else p)
    return out


async def reader_drop_keys(db: AsyncSession, user: User) -> frozenset[str]:
    """The change keys a live stream drops for ``user``: landscape-wide grants only (a
    stakeholder-only reader is treated as without: no per-card lookup mid-stream)."""
    drop: frozenset[str] = frozenset()
    if not await PermissionService.has_app_permission(db, user, "costs.view"):
        drop |= await all_cost_keys(db) | {COST_ITEMS_KEY}
    if not await PermissionService.has_app_permission(db, user, "licenses.view"):
        drop |= LICENSE_KEYS
    return drop


async def add_cost_summaries(
    db: AsyncSession, card_name: str, events: Sequence[Event], payloads: Sequence[dict | None]
) -> list[dict | None]:
    """Copies of ``payloads`` with a person-readable ``summary`` on each cost / license event."""
    out = list(payloads)
    for event_type, summarise in (
        (COST_EVENT, cost_event_summaries),
        (LICENSE_EVENT, license_event_summaries),
    ):
        idx = [
            i
            for i, e in enumerate(events)
            if e.event_type == event_type and isinstance(payloads[i], dict)
        ]
        if not idx:
            continue
        for i, text in zip(idx, await summarise(db, card_name, [payloads[i] for i in idx])):
            out[i] = {**(payloads[i] or {}), "summary": text}
    return out
