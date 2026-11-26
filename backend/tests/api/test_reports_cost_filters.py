"""card_filters on the cost treemap and Sankey, and GET /reports/cost-filter-options."""

from __future__ import annotations

import json
import uuid

import pytest
from sqlalchemy import select

from app.models.card_cost import CardCost
from app.models.card_type import CardType
from app.services import cost_item_types
from app.services.fiscal_year import current_fiscal_year
from tests.conftest import (
    auth_headers,
    create_card,
    create_card_type,
    create_relation,
    create_relation_type,
    create_role,
    create_user,
)

CUR = current_fiscal_year(1)
COST = {"section": "Cost", "fields": [{"key": "costTotalAnnual", "type": "cost", "weight": 0}]}
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
REL = "relProviderToApp"
EMPTY_KEY = "__empty__"
GOLD = {"attrFilters": {"tier": ["gold"]}}


async def _costs(db, card, amount, fy=CUR, provider=None):
    item = {"amount": amount, "renewal_date": None}
    if provider:
        item["provider_id"] = str(provider)
    db.add(CardCost(card_id=card.id, fiscal_year=fy, items={"lic": item}))
    await db.flush()


@pytest.fixture
async def env(db):
    await create_role(db, key="admin", permissions={"*": True})
    await create_role(db, key="reader", permissions={"costs.view": True})
    admin = await create_user(db, email="a@cf-api.com", role="admin")
    reader = await create_user(db, email="r@cf-api.com", role="reader")
    for key in ("Application", "ITComponent"):
        await create_card_type(db, key=key, fields_schema=[COST, TIER])
    await create_card_type(db, key="Provider", has_hierarchy=True)
    await create_relation_type(
        db, key=REL, source_type_key="Provider", target_type_key="Application"
    )
    await cost_item_types.create_item(db, "lic", "Licences")
    acme = await create_card(db, card_type="Provider", name="Acme")
    other = await create_card(db, card_type="Provider", name="Other")
    gold = await create_card(db, name="GoldApp", attributes={"tier": "gold"})
    tin = await create_card(db, name="TinApp", attributes={"tier": "tin"})
    comp = await create_card(
        db, card_type="ITComponent", name="GoldComp", attributes={"tier": "gold"}
    )
    tin_comp = await create_card(
        db, card_type="ITComponent", name="TinComp", attributes={"tier": "tin"}
    )
    # GoldApp is linked to Acme by relation but its item names Other; TinApp is the reverse
    await create_relation(db, type_key=REL, source_id=acme.id, target_id=gold.id)
    await _costs(db, gold, 100, provider=other.id)
    await _costs(db, tin, 40, provider=acme.id)
    await _costs(db, comp, 7)
    await _costs(db, tin_comp, 3)
    return {"admin": admin, "reader": reader, "acme": acme, "gold": gold, "tin": tin}


def _filters(**per_type) -> str:
    return json.dumps(per_type)


async def _get(client, user, report, expect=200, **params):
    resp = await client.get(f"/api/v1/reports/{report}", params=params, headers=auth_headers(user))
    assert resp.status_code == expect, resp.text
    return resp.json()


def _names(data):
    return {i["name"] for i in data["items"]}


async def test_treemap_attribute_filter_narrows_the_cards(client, env):
    data = await _get(
        client,
        env["admin"],
        "cost-treemap",
        type="Application",
        card_filters=_filters(Application=GOLD),
    )
    assert _names(data) == {"GoldApp"}
    assert data["total"] == 100


async def test_treemap_relation_filter_matches_cards_linked_to_the_provider_not_item_providers(
    client, env
):
    value = {"relationFilters": {REL: [str(env["acme"].id)]}}
    data = await _get(
        client,
        env["admin"],
        "cost-treemap",
        type="Application",
        card_filters=_filters(Application=value),
    )
    assert _names(data) == {"GoldApp"}  # TinApp's item names Acme, but the card is not linked


async def test_treemap_filter_applies_per_type_in_the_combined_view(client, env):
    data = await _get(
        client,
        env["admin"],
        "cost-treemap",
        type="Application,ITComponent",
        card_filters=_filters(Application=GOLD),
    )
    assert _names(data) == {"GoldApp", "GoldComp", "TinComp"}  # ITComponent has no filter


async def test_sankey_and_treemap_see_the_same_filtered_cards(client, env):
    params = {"type": "Application,ITComponent", "card_filters": _filters(Application=GOLD)}
    tree = await _get(client, env["admin"], "cost-treemap", **params)
    flow = await _get(client, env["admin"], "cost-sankey", **params)
    cards = {n["name"] for n in flow["nodes"] if n["type"] not in ("CostItem", "Group")}
    assert cards == _names(tree) == {"GoldApp", "GoldComp", "TinComp"}
    assert flow["total"] == tree["total"]


async def test_filter_combines_with_card_scope_and_fiscal_year(client, db, env):
    await _costs(db, env["gold"], 11, fy=CUR - 1)
    await _costs(db, env["tin"], 12, fy=CUR - 1)
    data = await _get(
        client,
        env["admin"],
        "cost-treemap",
        type="Application",
        fiscal_year=CUR - 1,
        card_filters=_filters(Application=GOLD),
    )
    assert _names(data) == {"GoldApp"}
    assert data["total"] == 11


async def test_filter_cannot_reveal_a_hidden_card(client, db, env):
    app_type = (
        await db.execute(select(CardType).where(CardType.key == "Application"))
    ).scalar_one()
    app_type.role_permissions = {
        "reader": {"inventory.view": {"value": False, "subtypes": ["web"]}}
    }
    secret = await create_card(db, name="SecretApp", subtype="web", attributes={"tier": "gold"})
    await _costs(db, secret, 500)
    params = {"type": "Application", "card_filters": _filters(Application=GOLD)}
    assert _names(await _get(client, env["reader"], "cost-treemap", **params)) == {"GoldApp"}
    assert _names(await _get(client, env["admin"], "cost-treemap", **params)) == {
        "GoldApp",
        "SecretApp",
    }


async def _hide_provider_subtype(db):
    ptype = (await db.execute(select(CardType).where(CardType.key == "Provider"))).scalar_one()
    ptype.role_permissions = {
        "reader": {"inventory.view": {"value": False, "subtypes": ["secret"]}}
    }
    await db.flush()


async def test_relation_filter_on_a_hidden_provider_equals_an_unknown_id(client, db, env):
    hidden = await create_card(db, card_type="Provider", name="Hid", subtype="secret")
    await create_relation(db, type_key=REL, source_id=hidden.id, target_id=env["tin"].id)
    await _hide_provider_subtype(db)

    def params(pick):
        value = {"relationFilters": {REL: [str(pick)]}}
        return {"type": "Application", "card_filters": _filters(Application=value)}

    as_admin = await _get(client, env["admin"], "cost-treemap", **params(hidden.id))
    assert _names(as_admin) == {"TinApp"}
    hidden_pick = await _get(client, env["reader"], "cost-treemap", **params(hidden.id))
    unknown = await _get(client, env["reader"], "cost-treemap", **params(uuid.uuid4()))
    assert hidden_pick == unknown
    assert hidden_pick["items"] == []


async def test_empty_relation_filter_ignores_a_hidden_provider(client, db, env):
    hidden = await create_card(db, card_type="Provider", name="Hid", subtype="secret")
    await create_relation(db, type_key=REL, source_id=hidden.id, target_id=env["tin"].id)
    await _hide_provider_subtype(db)
    value = {"relationFilters": {REL: [EMPTY_KEY]}}
    params = {"type": "Application", "card_filters": _filters(Application=value)}
    assert _names(await _get(client, env["admin"], "cost-treemap", **params)) == set()
    assert _names(await _get(client, env["reader"], "cost-treemap", **params)) == {"TinApp"}


async def test_relation_subtype_filter_does_not_match_through_a_hidden_provider(client, db, env):
    hidden = await create_card(db, card_type="Provider", name="Hid", subtype="secret")
    await create_relation(
        db, type_key=REL, source_id=hidden.id, target_id=env["tin"].id, attributes={"k": "x"}
    )
    await _hide_provider_subtype(db)
    value = {"relSubtypeFilters": {f"{REL}::k": ["x"]}}
    params = {"type": "Application", "card_filters": _filters(Application=value)}
    assert _names(await _get(client, env["admin"], "cost-treemap", **params)) == {"TinApp"}
    assert _names(await _get(client, env["reader"], "cost-treemap", **params)) == set()


async def test_include_sub_cards_does_not_reach_a_hidden_descendant(client, db, env):
    parent = await create_card(db, card_type="Provider", name="Parent")
    visible = await create_card(db, card_type="Provider", name="Kid", parent_id=parent.id)
    hidden = await create_card(
        db, card_type="Provider", name="HidKid", subtype="secret", parent_id=parent.id
    )
    await create_relation(db, type_key=REL, source_id=visible.id, target_id=env["gold"].id)
    await create_relation(db, type_key=REL, source_id=hidden.id, target_id=env["tin"].id)
    await _hide_provider_subtype(db)
    value = {"relationFilters": {REL: [str(parent.id)]}, "includeDescendants": True}
    params = {"type": "Application", "card_filters": _filters(Application=value)}
    assert _names(await _get(client, env["admin"], "cost-treemap", **params)) == {
        "GoldApp",
        "TinApp",
    }
    assert _names(await _get(client, env["reader"], "cost-treemap", **params)) == {"GoldApp"}


async def test_tag_filters_are_ignored(client, env):
    value = {**GOLD, "tagFilterIds": [str(uuid.uuid4())]}
    data = await _get(
        client,
        env["admin"],
        "cost-treemap",
        type="Application",
        card_filters=_filters(Application=value),
    )
    assert _names(data) == {"GoldApp"}


@pytest.mark.parametrize("report", ["cost-treemap", "cost-sankey"])
@pytest.mark.parametrize(
    "raw",
    ["{oops", "[]", '{"Application": 5}', "[" * 5000, "x" * 20001],
    ids=["malformed", "list", "non-object-value", "deep", "oversized"],
)
async def test_bad_card_filters_is_400(client, env, report, raw):
    await _get(client, env["admin"], report, 400, type="Application", card_filters=raw)


@pytest.mark.parametrize("report", ["cost-treemap", "cost-sankey"])
@pytest.mark.parametrize(
    "relation_filters",
    [
        {f"rel{k}": ["x"] for k in range(21)},
        {REL: [f"id{i}" for i in range(201)]},
        {f"rel{k}": [f"id{i}" for i in range(126)] for k in range(4)},
    ],
    ids=["keys", "ids-per-key", "ids-total"],
)
async def test_relation_filters_over_the_caps_are_400(client, env, report, relation_filters):
    raw = _filters(Application={"relationFilters": relation_filters})
    await _get(client, env["admin"], report, 400, type="Application", card_filters=raw)


@pytest.mark.parametrize("report", ["cost-treemap", "cost-sankey"])
@pytest.mark.parametrize("field", ["relSubtypeFilters", "attrFilters"])
async def test_field_and_subtype_filters_over_the_key_cap_are_400(client, env, report, field):
    raw = _filters(Application={field: {f"k{k}::f": ["x"] for k in range(21)}})
    await _get(client, env["admin"], report, 400, type="Application", card_filters=raw)


@pytest.mark.parametrize("report", ["cost-treemap", "cost-sankey"])
@pytest.mark.parametrize("field", ["relSubtypeFilters", "attrFilters"])
async def test_field_and_subtype_filters_at_the_key_cap_are_accepted(client, env, report, field):
    raw = _filters(Application={field: {f"k{k}::f": ["x"] for k in range(20)}})
    await _get(client, env["admin"], report, 200, type="Application", card_filters=raw)


async def test_a_filter_for_a_type_that_is_not_selected_is_ignored(client, env):
    data = await _get(
        client,
        env["admin"],
        "cost-treemap",
        type="Application",
        card_filters=_filters(ITComponent=GOLD, Nope={"subtypeFilters": ["x"]}),
    )
    assert _names(data) == {"GoldApp", "TinApp"}


async def test_cost_filter_options_requires_costs_view(client, db, env):
    await create_role(db, key="nocost", permissions={"inventory.view": True})
    user = await create_user(db, email="n@cf-api.com", role="nocost")
    await _get(client, user, "cost-filter-options", 403, type="Application")


async def test_cost_filter_options_returns_the_filter_vocabulary(client, env):
    data = await _get(client, env["reader"], "cost-filter-options", type="Application")
    assert set(data) == {"relation_types", "groupable_types"}
    assert [rt["key"] for rt in data["relation_types"]] == [REL]
    assert {m["name"] for m in data["groupable_types"]["Provider"]} == {"Acme"}


@pytest.mark.parametrize("type_key", ["Provider", "Nope"])
async def test_cost_filter_options_rejects_a_non_cost_type(client, env, type_key):
    await _get(client, env["admin"], "cost-filter-options", 400, type=type_key)


async def test_cost_filter_options_hides_cards_the_caller_cannot_read(client, db, env):
    hidden = await create_card(db, card_type="Provider", name="HidOpt", subtype="secret")
    await create_relation(db, type_key=REL, source_id=hidden.id, target_id=env["tin"].id)
    await _hide_provider_subtype(db)
    seen = json.dumps(await _get(client, env["reader"], "cost-filter-options", type="Application"))
    assert "HidOpt" not in seen and str(hidden.id) not in seen
    admin = json.dumps(await _get(client, env["admin"], "cost-filter-options", type="Application"))
    assert "HidOpt" in admin
