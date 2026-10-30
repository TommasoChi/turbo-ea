"""cost_grouping: group cost cards by a single-valued field or an at-most-one linked card."""

from __future__ import annotations

import pytest

from app.services.card_read_scope import CardReadScope
from app.services.cost_grouping import OTHER_GROUP, GroupBy, assign_groups, parse_group_by
from tests.conftest import create_card, create_card_type, create_relation, create_relation_type


def _schema(*fields):
    return [{"section": "S", "fields": [{"key": k, "label": k, "type": t} for k, t in fields]}]


async def _app_type(db, **fields):
    fields = fields or {"tier": "single_select"}
    await create_card_type(db, key="Application", fields_schema=_schema(*fields.items()))


def _hide(*type_keys):
    return CardReadScope(
        role_key="r",
        wildcard=False,
        base_view=True,
        denied_types=frozenset(type_keys),
        allowed_types=frozenset(),
        stakeholder_card_ids=frozenset(),
    )


async def test_field_group_returns_raw_option_value(db):
    await _app_type(db)
    a = await create_card(db, name="a", attributes={"tier": "gold"})
    b = await create_card(db, name="b", attributes={"tier": "silver"})
    out = await assign_groups(db, CardReadScope.everything(), [a, b], GroupBy("field", "tier"))
    assert out == {a.id: "gold", b.id: "silver"}


async def test_boolean_field_is_true_false(db):
    await _app_type(db, flag="boolean")
    a = await create_card(db, name="a", attributes={"flag": True})
    b = await create_card(db, name="b", attributes={"flag": False})
    out = await assign_groups(db, CardReadScope.everything(), [a, b], GroupBy("field", "flag"))
    assert out == {a.id: "true", b.id: "false"}


async def test_missing_value_goes_to_other(db):
    await _app_type(db)
    a = await create_card(db, name="a", attributes={})
    b = await create_card(db, name="b", attributes={"tier": ""})
    out = await assign_groups(db, CardReadScope.everything(), [a, b], GroupBy("field", "tier"))
    assert out == {a.id: OTHER_GROUP, b.id: OTHER_GROUP}


async def test_multi_select_field_is_refused(db):
    await _app_type(db, tags="multiple_select")
    a = await create_card(db, name="a", attributes={"tags": ["x"]})
    with pytest.raises(ValueError):
        await assign_groups(db, CardReadScope.everything(), [a], GroupBy("field", "tags"))


async def test_unknown_field_is_refused(db):
    await _app_type(db)
    a = await create_card(db, name="a")
    with pytest.raises(ValueError):
        await assign_groups(db, CardReadScope.everything(), [a], GroupBy("field", "nope"))


async def _rel_world(db, cardinality):
    await _app_type(db)
    await create_card_type(db, key="Organization", label="Org")
    await create_relation_type(
        db,
        key="app_org",
        source_type_key="Application",
        target_type_key="Organization",
        cardinality=cardinality,
    )
    a = await create_card(db, name="a")
    b = await create_card(db, name="b")
    org = await create_card(db, card_type="Organization", name="Acme")
    return a, b, org


async def test_relation_1n_groups_by_linked_card_name(db):
    a, b, org = await _rel_world(db, "1:n")
    await create_relation(db, type_key="app_org", source_id=a.id, target_id=org.id)
    out = await assign_groups(db, CardReadScope.everything(), [a], GroupBy("relation", "app_org"))
    assert out == {a.id: "Acme"}


async def test_relation_1n_refused_from_the_target_end(db):
    a, _, org = await _rel_world(db, "1:n")
    with pytest.raises(ValueError):
        await assign_groups(db, CardReadScope.everything(), [org], GroupBy("relation", "app_org"))


async def test_relation_1to1_works_from_the_target_end(db):
    a, _, org = await _rel_world(db, "1:1")
    await create_relation(db, type_key="app_org", source_id=a.id, target_id=org.id)
    out = await assign_groups(db, CardReadScope.everything(), [org], GroupBy("relation", "app_org"))
    assert out == {org.id: "a"}


async def test_relation_nm_refused(db):
    a, _, _ = await _rel_world(db, "n:m")
    with pytest.raises(ValueError):
        await assign_groups(db, CardReadScope.everything(), [a], GroupBy("relation", "app_org"))


async def test_unknown_relation_refused(db):
    await _app_type(db)
    a = await create_card(db, name="a")
    with pytest.raises(ValueError):
        await assign_groups(db, CardReadScope.everything(), [a], GroupBy("relation", "zzz"))


async def test_relation_without_link_goes_to_other(db):
    a, b, org = await _rel_world(db, "1:n")
    await create_relation(db, type_key="app_org", source_id=a.id, target_id=org.id)
    out = await assign_groups(
        db, CardReadScope.everything(), [a, b], GroupBy("relation", "app_org")
    )
    assert out == {a.id: "Acme", b.id: OTHER_GROUP}


async def test_hidden_linked_card_counts_as_no_link(db):
    a, _, org = await _rel_world(db, "1:n")
    await create_relation(db, type_key="app_org", source_id=a.id, target_id=org.id)
    out = await assign_groups(db, _hide("Organization"), [a], GroupBy("relation", "app_org"))
    assert out == {a.id: OTHER_GROUP}


async def test_duplicate_link_takes_one_and_never_duplicates(db):
    a, _, org = await _rel_world(db, "1:n")
    org2 = await create_card(db, card_type="Organization", name="Zed")
    await create_relation(db, type_key="app_org", source_id=a.id, target_id=org.id)
    await create_relation(db, type_key="app_org", source_id=a.id, target_id=org2.id)
    out = await assign_groups(db, CardReadScope.everything(), [a], GroupBy("relation", "app_org"))
    assert list(out) == [a.id]


async def test_costs_never_duplicated(db):
    a, b, org = await _rel_world(db, "1:n")
    await create_relation(db, type_key="app_org", source_id=a.id, target_id=org.id)
    cards = [a, b]
    for gb in (GroupBy("relation", "app_org"), GroupBy("field", "tier"), None):
        out = await assign_groups(db, CardReadScope.everything(), cards, gb)
        assert sorted(out) == sorted(c.id for c in cards)


def test_old_linked_type_key_parses_to_none():
    assert parse_group_by("BusinessCapability", {"tier"}) is None


def test_bare_field_key_parses_as_field():
    assert parse_group_by("tier", {"tier"}) == GroupBy("field", "tier")


def test_prefixed_forms_and_empty():
    assert parse_group_by("field:tier", set()) == GroupBy("field", "tier")
    assert parse_group_by("rel:app_org", set()) == GroupBy("relation", "app_org")
    assert parse_group_by("", {"tier"}) is None
    assert parse_group_by(None, {"tier"}) is None
    assert parse_group_by("field:", set()) is None
