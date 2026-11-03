from __future__ import annotations

import pytest

from app.services import cost_item_types as svc


async def test_create_ok(db):
    row = await svc.create_item(db, "licences", "Licences", {"it": "Licenze"})
    assert row.key == "licences"
    assert row.archived is False
    assert svc.serialize(row)["translations"] == {"it": "Licenze"}


async def test_duplicate_key(db):
    await svc.create_item(db, "licences", "Licences", None)
    with pytest.raises(svc.CostItemError) as e:
        await svc.create_item(db, "licences", "Other", None)
    assert e.value.code == "duplicate_key"


@pytest.mark.parametrize("key", ["1x", "a b", "", "x" * 65])
async def test_bad_key(db, key):
    with pytest.raises(svc.CostItemError) as e:
        await svc.create_item(db, key, "X", None)
    assert e.value.code == "invalid_key"


async def test_archive_hides_but_keeps_row_and_key(db):
    await svc.create_item(db, "a", "A", None)
    await svc.create_item(db, "b", "B", None)
    row = await svc.update_item(db, "a", label="A2", archived=True)
    assert row.key == "a" and row.label == "A2"
    assert [r.key for r in await svc.list_items(db, include_archived=False)] == ["b"]
    assert {r.key for r in await svc.list_items(db)} == {"a", "b"}


async def test_update_unknown(db):
    with pytest.raises(svc.CostItemError) as e:
        await svc.update_item(db, "nope", label="x")
    assert e.value.code == "not_found"


async def test_sort_order_appends(db):
    a = await svc.create_item(db, "a", "A", None)
    b = await svc.create_item(db, "b", "B", None)
    assert b.sort_order == a.sort_order + 1
