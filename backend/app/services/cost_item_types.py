"""The cost-item catalogue (``cost_item_types``). The key is fixed at create
time and a row is archived, never deleted. Flushes, never commits."""

from __future__ import annotations

import re

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.card import Card
from app.models.card_type import CardType
from app.models.cost_item_type import CostItemType
from app.services import cost_items_migration as cim

KEY_RE = re.compile(r"^[A-Za-z][A-Za-z0-9_]{0,63}$")


class CostItemError(Exception):
    """``code`` is one of ``invalid_key``, ``reserved_key``, ``duplicate_key``, ``not_found``."""

    def __init__(self, code: str, message: str = "") -> None:
        super().__init__(message or code)
        self.code = code


def serialize(row: CostItemType) -> dict:
    return {
        "id": str(row.id),
        "key": row.key,
        "label": row.label,
        "sort_order": row.sort_order,
        "archived": row.archived,
        "translations": row.translations or {},
    }


async def seed_default_items(db: AsyncSession) -> int:
    """Insert the four starter lines on a catalogue that has none (fresh install, where
    migration 175 never ran). Insert-only on an empty table: a catalogue an admin or an import
    has shaped is never topped up. Flushes, never commits; returns the rows inserted."""
    if (await db.execute(select(CostItemType.id).limit(1))).first() is not None:
        return 0
    lines = [*cim.LEGACY_ITEMS, (cim.OTHER_KEY, cim.OTHER_LABEL)]
    for order, (key, label) in enumerate(lines):
        db.add(
            CostItemType(key=key, label=label, sort_order=order, archived=False, translations={})
        )
    await db.flush()
    return len(lines)


async def get_item(db: AsyncSession, key: str) -> CostItemType | None:
    return (
        await db.execute(select(CostItemType).where(CostItemType.key == key))
    ).scalar_one_or_none()


async def list_items(db: AsyncSession, include_archived: bool = True) -> list[CostItemType]:
    stmt = select(CostItemType).order_by(CostItemType.sort_order, CostItemType.label)
    if not include_archived:
        stmt = stmt.where(CostItemType.archived.is_(False))
    return list((await db.execute(stmt)).scalars().all())


async def create_item(
    db: AsyncSession, key: str, label: str, translations: dict | None = None
) -> CostItemType:
    if not isinstance(key, str) or not KEY_RE.match(key):
        raise CostItemError("invalid_key", f"Invalid cost item key '{key}'")
    # Keys are permanent and the redactors drop a catalogue key from every event diff, so one
    # that equals a card column or a field key would hide that diff for everyone.
    reserved = {*Card.__table__.columns.keys(), "cost_items"}
    for schema in (await db.execute(select(CardType.fields_schema))).scalars():
        reserved.update(f.get("key") for sec in schema or [] for f in sec.get("fields", []))
    if key in reserved:
        raise CostItemError("reserved_key", f"'{key}' is a card column or field key")
    if await get_item(db, key) is not None:
        raise CostItemError("duplicate_key", f"Cost item '{key}' already exists")
    current = (await db.execute(select(func.max(CostItemType.sort_order)))).scalar()
    row = CostItemType(
        key=key,
        label=label,
        sort_order=(current if current is not None else -1) + 1,
        archived=False,
        translations=translations or {},
    )
    db.add(row)
    await db.flush()
    return row


async def update_item(
    db: AsyncSession,
    key: str,
    label: str | None = None,
    translations: dict | None = None,
    archived: bool | None = None,
    sort_order: int | None = None,
) -> CostItemType:
    row = await get_item(db, key)
    if row is None:
        raise CostItemError("not_found", f"Cost item '{key}' not found")
    if label is not None:
        row.label = label
    if translations is not None:
        row.translations = translations
    if archived is not None:
        row.archived = archived
    if sort_order is not None:
        row.sort_order = sort_order
    await db.flush()
    return row
