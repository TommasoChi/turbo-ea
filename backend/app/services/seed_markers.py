"""Persistent one-shot markers for the demo seeders.

``SEED_DEMO=true`` means *"populate this instance on first startup"*, not
*"re-assert the demo content on every boot"*. Without a durable marker each
seeder has to infer "have I run before?" from the data it created — and that
inference breaks the moment a user deletes that data. ``seed_demo_extras``
guarded on *comments*, which cascade-delete with their cards, so an install
that imported a real landscape and removed the NexaTech cards re-created the
demo diagrams, saved reports, surveys and bookmarks on **every** restart
(discussion #905).

The marker lives in the ``app_settings`` singleton's ``general_settings``
JSONB under ``demoSeeded`` as a ``{seeder_key: true}`` map, so:

* each seeder is tracked independently — adding ``SEED_BPM=true`` later to an
  existing demo environment still works;
* deleting seeded content never resurrects it;
* ``RESET_DB=true`` drops ``app_settings`` along with everything else, so a
  genuine reset re-seeds as expected;
* the marker travels with a workspace transfer, which is what you want — a
  cloned instance should not re-seed demo data over the clone.
"""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.app_settings import AppSettings

MARKER_KEY = "demoSeeded"


async def _get_or_create_settings(db: AsyncSession) -> AppSettings:
    result = await db.execute(select(AppSettings).where(AppSettings.id == "default"))
    row = result.scalar_one_or_none()
    if row is None:
        row = AppSettings(id="default")
        db.add(row)
        await db.flush()
    return row


async def demo_seed_completed(db: AsyncSession, seeder_key: str) -> bool:
    """True when ``seeder_key`` has already run to completion on this install."""
    result = await db.execute(select(AppSettings).where(AppSettings.id == "default"))
    row = result.scalar_one_or_none()
    general = (row.general_settings if row else None) or {}
    markers = general.get(MARKER_KEY) or {}
    return bool(markers.get(seeder_key))


async def mark_demo_seed_completed(db: AsyncSession, seeder_key: str) -> None:
    """Record that ``seeder_key`` has run, so it never runs again.

    Does **not** commit — the caller owns the transaction. Reassigns the JSONB
    column wholesale because SQLAlchemy does not track in-place mutation of a
    plain ``dict`` value.
    """
    row = await _get_or_create_settings(db)
    general = dict(row.general_settings or {})
    markers = dict(general.get(MARKER_KEY) or {})
    if markers.get(seeder_key):
        return
    markers[seeder_key] = True
    general[MARKER_KEY] = markers
    row.general_settings = general
    await db.flush()


# ── Enterprise Object card-mapping defaults ─────────────────────────────
#
# Same anti-pattern, one level down: ``seed_card_mappings`` (default_mapping.py
# -> EnterpriseObjectCardMapping) used to infer "has the one-time backfill run
# already?" from whether the bridge table held any rows. That inference breaks
# two ways: an admin removing every default mapping empties the table, so the
# next restart resurrects all of them (the exact Bug 1 regression, one level
# removed); and a future release's new default triple never lands on an
# existing install once the table is non-empty, since nothing re-checks it.
#
# ``CARD_MAPPING_DEFAULTS_KEY`` tracks *which triples have ever been applied*,
# not whether the table is currently empty, in the same ``app_settings``
# singleton as ``MARKER_KEY`` above:
#
# * a triple marked applied is never re-inserted, even after an admin deletes
#   it and the table goes back to empty;
# * a triple never marked applied -- including one added to
#   CARD_TYPE_DEFAULTS/SUBTYPE_DEFAULTS in a later release -- still lands on
#   an existing install, regardless of how many other rows already exist.

CARD_MAPPING_DEFAULTS_KEY = "cardMappingDefaultsApplied"

# (enterprise_object_key, card_type_key, card_subtype_key) -- the bridge
# table's three identifying columns.
MappingTriple = tuple[str, str, "str | None"]


async def applied_card_mapping_defaults(db: AsyncSession) -> set[MappingTriple]:
    """Every default mapping triple the one-time backfill has ever applied
    on this install, regardless of whether the row is still present."""
    result = await db.execute(select(AppSettings).where(AppSettings.id == "default"))
    row = result.scalar_one_or_none()
    general = (row.general_settings if row else None) or {}
    stored = general.get(CARD_MAPPING_DEFAULTS_KEY) or []
    return {tuple(item) for item in stored}


async def mark_card_mapping_defaults_applied(db: AsyncSession, triples: set[MappingTriple]) -> None:
    """Add ``triples`` to the durable "already applied" marker.

    Does **not** commit — the caller owns the transaction. Reassigns the
    JSONB column wholesale, same reason as ``mark_demo_seed_completed``.
    """
    if not triples:
        return
    row = await _get_or_create_settings(db)
    general = dict(row.general_settings or {})
    existing = {tuple(item) for item in (general.get(CARD_MAPPING_DEFAULTS_KEY) or [])}
    existing |= triples
    # Sorted for a stable diff in the stored JSON; `card_subtype_key` may be
    # None, which sorts fine against other None values but not against str
    # in Python 3 -- fall back to "" for the sort key only.
    general[CARD_MAPPING_DEFAULTS_KEY] = [
        list(t) for t in sorted(existing, key=lambda t: (t[0], t[1], t[2] or ""))
    ]
    row.general_settings = general
    await db.flush()
