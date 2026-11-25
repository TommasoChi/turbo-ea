"""cost_filters: the cost report's field / relation filters, parsed and turned into SQL."""

from __future__ import annotations

import json
import uuid

import pytest
from sqlalchemy import select

from app.models.card import Card
from app.services import portal_card_filters
from app.services.card_read_scope import CardReadScope
from app.services.cost_filters import MAX_FILTER_CHARS, filter_conditions, parse_card_filters
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
