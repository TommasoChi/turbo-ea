from __future__ import annotations

import pytest

from app.services import cost_item_types as svc
from tests.conftest import create_card_type


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


async def test_reserved_card_column_and_cost_items(db):
    for key in ("description", "cost_items"):
        with pytest.raises(svc.CostItemError) as e:
            await svc.create_item(db, key, "X", None)
        assert e.value.code == "reserved_key"


async def test_reserved_field_key_of_a_card_type(db):
    await create_card_type(
        db,
        key="Application",
        fields_schema=[
            {"section": "S", "fields": [{"key": "businessCriticality", "type": "text"}]}
        ],
    )
    with pytest.raises(svc.CostItemError) as e:
        await svc.create_item(db, "businessCriticality", "X", None)
    assert e.value.code == "reserved_key"


# ── mutation hardening: messages, ordering and defaults ───────────────────────────────────────


def test_cost_item_error_str_is_the_message_or_else_the_code():
    assert str(svc.CostItemError("not_found")) == "not_found"
    assert str(svc.CostItemError("not_found", "gone")) == "gone"
    assert svc.CostItemError("not_found", "gone").code == "not_found"


async def test_serialize_has_the_row_id_and_every_field(db):
    row = await svc.create_item(db, "lic", "Licences", {"it": "Licenze"})
    assert svc.serialize(row) == {
        "id": str(row.id),
        "key": "lic",
        "label": "Licences",
        "sort_order": 0,
        "archived": False,
        "translations": {"it": "Licenze"},
    }


async def test_seed_default_items_inserts_the_starter_lines_once(db):
    from app.services import cost_items_migration as cim

    assert await svc.seed_default_items(db) == 4
    rows = await svc.list_items(db)
    assert [(r.key, r.label, r.sort_order, r.archived, r.translations) for r in rows] == [
        (key, label, order, False, {})
        for order, (key, label) in enumerate([*cim.LEGACY_ITEMS, (cim.OTHER_KEY, cim.OTHER_LABEL)])
    ]
    assert await svc.seed_default_items(db) == 0
    assert len(await svc.list_items(db)) == 4


async def test_seed_default_items_probe_reads_a_single_row(db, monkeypatch):
    seen = []
    real = db.execute

    async def spy(stmt, *a, **kw):
        seen.append(stmt)
        return await real(stmt, *a, **kw)

    monkeypatch.setattr(db, "execute", spy)
    await svc.seed_default_items(db)
    assert seen[0]._limit == 1


async def test_list_items_orders_by_sort_order_then_label(db):
    from app.models.cost_item_type import CostItemType

    for key, label, order in (("a", "Zed", 1), ("b", "Beta", 2), ("c", "Alpha", 2)):
        db.add(CostItemType(key=key, label=label, sort_order=order))
    await db.flush()
    assert [r.key for r in await svc.list_items(db)] == ["a", "c", "b"]


async def test_create_error_messages_name_the_key(db):
    with pytest.raises(svc.CostItemError) as e:
        await svc.create_item(db, "1x", "X", None)
    assert str(e.value) == "Invalid cost item key '1x'"
    with pytest.raises(svc.CostItemError) as e:
        await svc.create_item(db, "description", "X", None)
    assert str(e.value) == "'description' is a card column or field key"
    await svc.create_item(db, "lic", "L", None)
    with pytest.raises(svc.CostItemError) as e:
        await svc.create_item(db, "lic", "L", None)
    assert str(e.value) == "Cost item 'lic' already exists"


async def test_create_tolerates_a_schema_section_without_fields(db):
    await create_card_type(db, key="Application", fields_schema=[{"section": "Empty"}])
    row = await svc.create_item(db, "lic", "L", None)
    assert row.key == "lic"


async def test_first_item_gets_sort_order_zero_and_is_not_archived(db):
    first = await svc.create_item(db, "a", "A", None)
    assert (first.sort_order, first.archived) == (0, False)
    assert (await svc.create_item(db, "b", "B", None)).sort_order == 1


async def test_update_unknown_message(db):
    with pytest.raises(svc.CostItemError) as e:
        await svc.update_item(db, "nope", label="x")
    assert str(e.value) == "Cost item 'nope' not found"


async def test_update_translations_only_when_given(db):
    await svc.create_item(db, "a", "A", {"it": "Uno"})
    row = await svc.update_item(db, "a", label="A2")
    assert row.translations == {"it": "Uno"}
    row = await svc.update_item(db, "a", translations={"de": "Eins"})
    assert row.translations == {"de": "Eins"}
