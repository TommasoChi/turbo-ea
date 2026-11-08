"""The catalogue logic shared by cost items and license types."""

from __future__ import annotations

import pytest

from app.models.cost_item_type import CostItemType
from app.models.license_type import LicenseType
from app.services import item_catalogue, license_types
from app.services.item_catalogue import CatalogueError


async def test_create_appends_sort_order_and_refuses_duplicate(db):
    a = await license_types.create_item(db, "a", "A")
    b = await license_types.create_item(db, "b", "B")
    assert (a.sort_order, b.sort_order) == (0, 1)
    with pytest.raises(CatalogueError) as exc:
        await license_types.create_item(db, "a", "Again")
    assert exc.value.code == "duplicate_key"
    assert str(exc.value) == "License type 'a' already exists"


async def test_license_type_has_no_reserved_keys(db):
    row = await license_types.create_item(db, "name", "Name")
    assert row.key == "name"


async def test_reserved_callback_refuses_key(db):
    async def reserved(_db):
        return {"taken"}

    with pytest.raises(CatalogueError) as exc:
        await item_catalogue.create_item(
            db, LicenseType, "taken", "T", noun="License type", reserved=reserved
        )
    assert exc.value.code == "reserved_key"


async def test_invalid_key_message_uses_the_noun(db):
    with pytest.raises(CatalogueError) as exc:
        await license_types.create_item(db, "1abc", "X")
    assert (exc.value.code, str(exc.value)) == ("invalid_key", "Invalid license type key '1abc'")


async def test_license_and_cost_catalogues_are_independent(db):
    await license_types.create_item(db, "admin", "Admin")
    db.add(CostItemType(key="admin", label="Admin", sort_order=0, archived=False, translations={}))
    await db.flush()
    assert [r.key for r in await item_catalogue.list_items(db, LicenseType)] == ["admin"]
    assert [r.key for r in await item_catalogue.list_items(db, CostItemType)] == ["admin"]


async def test_archived_keys_maps_key_to_flag(db):
    await license_types.create_item(db, "a", "A")
    await license_types.create_item(db, "b", "B")
    await license_types.update_item(db, "b", archived=True)
    assert await license_types.archived_keys(db) == {"a": False, "b": True}
    assert [r.key for r in await license_types.list_items(db, include_archived=False)] == ["a"]


async def test_update_unknown_uses_the_noun(db):
    with pytest.raises(CatalogueError) as exc:
        await license_types.update_item(db, "nope", label="x")
    assert (exc.value.code, str(exc.value)) == ("not_found", "License type 'nope' not found")


async def test_update_changes_only_given_fields(db):
    await license_types.create_item(db, "a", "A", {"it": "Aa"})
    row = await license_types.update_item(db, "a", label="B", sort_order=5)
    assert (row.label, row.sort_order, row.archived, row.translations) == (
        "B",
        5,
        False,
        {"it": "Aa"},
    )
