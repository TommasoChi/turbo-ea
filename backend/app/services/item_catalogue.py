"""A key/label catalogue shared by cost items and license types (``cost_item_types``,
``license_types``): the key is fixed at create time and a row is archived, never
deleted. Generic over a model with ``key``, ``label``, ``sort_order``, ``archived`` and
``translations``. Flushes, never commits."""

from __future__ import annotations

import re
from collections.abc import Awaitable, Callable
from typing import Any, TypeVar, cast

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

T = TypeVar("T")
KEY_RE = re.compile(r"^[A-Za-z][A-Za-z0-9_]{0,63}$")


class CatalogueError(Exception):
    """``code`` is one of ``invalid_key``, ``reserved_key``, ``duplicate_key``, ``not_found``."""

    def __init__(self, code: str, message: str = "") -> None:
        super().__init__(message or code)
        self.code = code


def serialize(row) -> dict:
    return {
        "id": str(row.id),
        "key": row.key,
        "label": row.label,
        "sort_order": row.sort_order,
        "archived": row.archived,
        "translations": row.translations or {},
    }


async def get_item(db: AsyncSession, model: type[T], key: str) -> T | None:
    m: Any = model
    return cast("T | None", (await db.execute(select(m).where(m.key == key))).scalar_one_or_none())


async def list_items(db: AsyncSession, model: type[T], include_archived: bool = True) -> list[T]:
    m: Any = model
    stmt = select(m).order_by(m.sort_order, m.label)
    if not include_archived:
        stmt = stmt.where(m.archived.is_(False))
    return cast("list[T]", list((await db.execute(stmt)).scalars().all()))


async def archived_keys(db: AsyncSession, model) -> dict[str, bool]:
    rows = await db.execute(select(model.key, model.archived))
    return {k: a for k, a in rows.all()}


async def create_item(
    db: AsyncSession,
    model: type[T],
    key: str,
    label: str,
    translations: dict | None = None,
    *,
    noun: str,
    reserved: Callable[[AsyncSession], Awaitable[set[str]]] | None = None,
) -> T:
    if not isinstance(key, str) or not KEY_RE.match(key):
        raise CatalogueError("invalid_key", f"Invalid {noun.lower()} key '{key}'")
    if reserved is not None and key in await reserved(db):
        raise CatalogueError("reserved_key", f"'{key}' is a card column or field key")
    if await get_item(db, model, key) is not None:
        raise CatalogueError("duplicate_key", f"{noun} '{key}' already exists")
    m: Any = model
    current = (await db.execute(select(func.max(m.sort_order)))).scalar()
    row = m(
        key=key,
        label=label,
        sort_order=(current if current is not None else -1) + 1,
        archived=False,
        translations=translations or {},
    )
    db.add(row)
    await db.flush()
    return cast("T", row)


async def update_item(
    db: AsyncSession,
    model: type[T],
    key: str,
    label: str | None = None,
    translations: dict | None = None,
    archived: bool | None = None,
    sort_order: int | None = None,
    *,
    noun: str,
) -> T:
    row: Any = await get_item(db, model, key)
    if row is None:
        raise CatalogueError("not_found", f"{noun} '{key}' not found")
    if label is not None:
        row.label = label
    if translations is not None:
        row.translations = translations
    if archived is not None:
        row.archived = archived
    if sort_order is not None:
        row.sort_order = sort_order
    await db.flush()
    return cast("T", row)
