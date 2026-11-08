"""The license-type catalogue (``license_types``). No reserved keys: a type key travels
inside a list value of the event, never as a diff key, so it cannot hide a diff."""

from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.license_type import LicenseType
from app.services import item_catalogue
from app.services.item_catalogue import CatalogueError, serialize

__all__ = [
    "CatalogueError",
    "archived_keys",
    "create_item",
    "get_item",
    "list_items",
    "serialize",
    "update_item",
]

NOUN = "License type"


async def get_item(db: AsyncSession, key: str) -> LicenseType | None:
    return await item_catalogue.get_item(db, LicenseType, key)


async def list_items(db: AsyncSession, include_archived: bool = True) -> list[LicenseType]:
    return await item_catalogue.list_items(db, LicenseType, include_archived)


async def archived_keys(db: AsyncSession) -> dict[str, bool]:
    return await item_catalogue.archived_keys(db, LicenseType)


async def create_item(
    db: AsyncSession, key: str, label: str, translations: dict | None = None
) -> LicenseType:
    return await item_catalogue.create_item(db, LicenseType, key, label, translations, noun=NOUN)


async def update_item(
    db: AsyncSession,
    key: str,
    label: str | None = None,
    translations: dict | None = None,
    archived: bool | None = None,
    sort_order: int | None = None,
) -> LicenseType:
    return await item_catalogue.update_item(
        db, LicenseType, key, label, translations, archived, sort_order, noun=NOUN
    )
