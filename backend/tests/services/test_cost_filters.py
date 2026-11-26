"""cost_filters: the cost report's field / relation filters, parsed and turned into SQL."""

from __future__ import annotations

import json
import uuid

import pytest
from sqlalchemy import select

from app.models.card import Card
from app.services import portal_card_filters
from app.services.card_read_scope import CardReadScope
from app.services.cost_filters import (
    MAX_FILTER_CHARS,
    MAX_IDS_PER_KEY,
    MAX_IDS_TOTAL,
    MAX_RELATION_KEYS,
    filter_conditions,
    parse_card_filters,
)
from tests.conftest import (
    create_card,
    create_card_type,
    create_relation,
    create_relation_type,
    create_role,
    create_user,
)

TIER = {
    "section": "Main",
    "fields": [
        {
            "key": "tier",
            "type": "single_select",
            "options": [{"key": "gold", "label": "Gold"}, {"key": "tin", "label": "Tin"}],
        }
    ],
}


def _dump(**per_type) -> str:
    return json.dumps(per_type)


def test_parse_ignores_a_type_that_is_not_selected():
    raw = _dump(Application={"subtypeFilters": ["x"]}, ITComponent={"subtypeFilters": ["y"]})
    assert set(parse_card_filters(raw, ["Application"])) == {"Application"}


def test_parse_drops_an_inactive_filter():
    raw = _dump(Application={"includeDescendants": True}, ITComponent={"subtypeFilters": ["y"]})
    assert set(parse_card_filters(raw, ["Application", "ITComponent"])) == {"ITComponent"}


def test_parse_empties_the_tag_filters():
    raw = _dump(Application={"subtypeFilters": ["x"], "tagFilterIds": [str(uuid.uuid4())]})
    assert parse_card_filters(raw, ["Application"])["Application"]["tagFilterIds"] == []


def test_a_tag_only_filter_is_inactive():
    raw = _dump(Application={"tagFilterIds": [str(uuid.uuid4())]})
    assert parse_card_filters(raw, ["Application"]) == {}


@pytest.mark.parametrize("raw", [None, ""])
def test_parse_without_a_value_is_empty(raw):
    assert parse_card_filters(raw, ["Application"]) == {}


@pytest.mark.parametrize(
    "raw",
    [
        "{not json",
        "[]",
        '"text"',
        "3",
        '{"Application": "x"}',
        '{"Application": ["x"]}',
        "[" * 5000,
        json.dumps({"Application": {"subtypeFilters": ["a" * MAX_FILTER_CHARS]}}),
    ],
    ids=[
        "malformed",
        "list",
        "string",
        "number",
        "value-string",
        "value-list",
        "deep",
        "oversized",
    ],
)
def test_parse_rejects_malformed_json_non_object_and_oversized(raw):
    with pytest.raises(ValueError):
        parse_card_filters(raw, ["Application"])


async def _world(db):
    await create_role(db, key="admin", permissions={"*": True})
    admin = await create_user(db, email="a@cf.com", role="admin")
    await create_card_type(
        db, key="Application", fields_schema=[TIER], subtypes=[{"key": "web", "label": "Web"}]
    )
    await create_card_type(db, key="Provider")
    await create_relation_type(
        db, key="relProviderToApp", source_type_key="Provider", target_type_key="Application"
    )
    acme = await create_card(db, card_type="Provider", name="Acme")
    gold = await create_card(
        db, card_type="Application", name="Gold", attributes={"tier": "gold"}, subtype="web"
    )
    tin = await create_card(db, card_type="Application", name="Tin", attributes={"tier": "tin"})
    await create_relation(db, type_key="relProviderToApp", source_id=acme.id, target_id=gold.id)
    return admin, acme, gold, tin


async def _names(db, conditions):
    rows = await db.execute(select(Card.name).where(Card.type == "Application", *conditions))
    return set(rows.scalars().all())


FILTERS = {
    "attribute": {"attrFilters": {"tier": ["gold"]}},
    "subtype": {"subtypeFilters": ["web"]},
}


@pytest.mark.parametrize("kind", ["attribute", "subtype", "relation"])
async def test_conditions_match_the_portal_evaluator(db, kind):
    admin, acme, _, _ = await _world(db)
    value = (
        {"relationFilters": {"relProviderToApp": [str(acme.id)]}}
        if kind == "relation"
        else FILTERS[kind]
    )
    parsed = parse_card_filters(_dump(Application=value), ["Application"])
    scope = await CardReadScope.load(db, admin)
    got = await filter_conditions(db, scope, parsed)
    expected = await portal_card_filters.preset_conditions(
        db, "Application", {"card_filters": parsed["Application"]}
    )
    assert await _names(db, got["Application"]) == await _names(db, expected) == {"Gold"}


async def test_conditions_for_no_filters_is_empty(db):
    admin, *_ = await _world(db)
    scope = await CardReadScope.load(db, admin)
    assert await filter_conditions(db, scope, {}) == {}


def _picks(keys: int, ids_per_key: int) -> str:
    relation_filters = {f"rel{k}": [f"{k}-{i}" for i in range(ids_per_key)] for k in range(keys)}
    return _dump(Application={"relationFilters": relation_filters})


@pytest.mark.parametrize(
    "raw",
    [
        _picks(MAX_RELATION_KEYS + 1, 1),
        _picks(1, MAX_IDS_PER_KEY + 1),
        _picks(4, MAX_IDS_TOTAL // 4 + 1),
    ],
    ids=["keys", "ids-per-key", "ids-total"],
)
def test_parse_rejects_relation_filters_over_the_caps(raw):
    with pytest.raises(ValueError):
        parse_card_filters(raw, ["Application"])


def test_parse_accepts_relation_filters_at_the_caps():
    assert parse_card_filters(_picks(MAX_RELATION_KEYS, 1), ["Application"])
    assert parse_card_filters(_picks(1, MAX_IDS_PER_KEY), ["Application"])


@pytest.mark.parametrize("field", ["relSubtypeFilters", "attrFilters"])
def test_parse_caps_field_and_subtype_filters_like_relation_filters(field):
    def raw(keys: int, values_per_key: int) -> str:
        return _dump(
            Application={
                field: {f"k{k}::f": [f"v{i}" for i in range(values_per_key)] for k in range(keys)}
            }
        )

    for over in (
        raw(MAX_RELATION_KEYS + 1, 1),
        raw(1, MAX_IDS_PER_KEY + 1),
        raw(4, MAX_IDS_TOTAL // 4 + 1),
    ):
        with pytest.raises(ValueError):
            parse_card_filters(over, ["Application"])
    assert parse_card_filters(raw(MAX_RELATION_KEYS, 1), ["Application"])
    assert parse_card_filters(raw(1, MAX_IDS_PER_KEY), ["Application"])


async def test_a_relation_key_naming_neither_a_relation_nor_a_card_type_is_ignored(db):
    admin, acme, _, _ = await _world(db)
    scope = await CardReadScope.load(db, admin)
    value = {"relationFilters": {"nope": [str(acme.id)], "relProviderToApp": [str(acme.id)]}}
    parsed = parse_card_filters(_dump(Application=value), ["Application"])
    got = await filter_conditions(db, scope, parsed)
    assert await _names(db, got["Application"]) == {"Gold"}
    only_unknown = parse_card_filters(
        _dump(Application={"relationFilters": {"nope": [str(acme.id)]}}), ["Application"]
    )
    got = await filter_conditions(db, scope, only_unknown)
    assert await _names(db, got["Application"]) == {"Gold", "Tin"}


async def test_include_sub_cards_widens_each_key_by_its_own_picks(db):
    admin, acme, _, _ = await _world(db)
    await create_card_type(db, key="Org", has_hierarchy=True)
    await create_relation_type(
        db, key="relOrgToApp", source_type_key="Org", target_type_key="Application"
    )
    top1 = await create_card(db, card_type="Org", name="Top1")
    kid1 = await create_card(db, card_type="Org", name="Kid1", parent_id=top1.id)
    top2 = await create_card(db, card_type="Org", name="Top2")
    kid2 = await create_card(db, card_type="Org", name="Kid2", parent_id=top2.id)
    a1 = await create_card(db, card_type="Application", name="OfKid1")
    a2 = await create_card(db, card_type="Application", name="OfKid2")
    await create_relation(db, type_key="relOrgToApp", source_id=kid1.id, target_id=a1.id)
    await create_relation(db, type_key="relProviderToApp", source_id=kid2.id, target_id=a2.id)
    await create_relation(db, type_key="relOrgToApp", source_id=kid2.id, target_id=a2.id)
    scope = await CardReadScope.load(db, admin)
    value = {
        "includeDescendants": True,
        "relationFilters": {"relOrgToApp": [str(top1.id)], "relProviderToApp": [str(top2.id)]},
    }
    parsed = parse_card_filters(_dump(Application=value), ["Application"])
    got = await filter_conditions(db, scope, parsed)
    assert await _names(db, got["Application"]) == set()
    value["relationFilters"] = {"relOrgToApp": [str(top1.id)]}
    parsed = parse_card_filters(_dump(Application=value), ["Application"])
    got = await filter_conditions(db, scope, parsed)
    assert await _names(db, got["Application"]) == {"OfKid1"}
