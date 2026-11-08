"""The cost-item catalogue (``cost_item_types``). The key is fixed at create
time and a row is archived, never deleted. Flushes, never commits."""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.card import Card
from app.models.card_type import CardType
from app.models.cost_item_type import CostItemType
from app.services import cost_items_migration as cim
from app.services import item_catalogue
from app.services.item_catalogue import CatalogueError

NOUN = "Cost item"
CostItemError = CatalogueError
serialize = item_catalogue.serialize


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


async def _cost_reserved(db: AsyncSession) -> set[str]:
    """Keys the redactors drop from every event diff: a card column or a field key would hide
    that diff for everyone."""
    reserved = {*Card.__table__.columns.keys(), "cost_items"}
    for schema in (await db.execute(select(CardType.fields_schema))).scalars():
        reserved.update(f.get("key") for sec in schema or [] for f in sec.get("fields", []))
    return reserved


async def get_item(db: AsyncSession, key: str) -> CostItemType | None:
    return await item_catalogue.get_item(db, CostItemType, key)


async def list_items(db: AsyncSession, include_archived: bool = True) -> list[CostItemType]:
    return await item_catalogue.list_items(db, CostItemType, include_archived)


async def create_item(
    db: AsyncSession, key: str, label: str, translations: dict | None = None
) -> CostItemType:
    return await item_catalogue.create_item(
        db, CostItemType, key, label, translations, noun=NOUN, reserved=_cost_reserved
    )


async def update_item(
    db: AsyncSession,
    key: str,
    label: str | None = None,
    translations: dict | None = None,
    archived: bool | None = None,
    sort_order: int | None = None,
) -> CostItemType:
    return await item_catalogue.update_item(
        db, CostItemType, key, label, translations, archived, sort_order, noun=NOUN
    )
