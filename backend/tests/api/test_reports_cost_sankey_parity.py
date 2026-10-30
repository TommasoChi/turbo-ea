"""GET /reports/cost-sankey takes the treemap's parameters and counts each cost once."""

from __future__ import annotations

import pytest
from sqlalchemy import select

from app.models.calculation import Calculation
from app.models.card_cost_history import CardCostHistory
from app.models.card_type import CardType
from app.services.fiscal_year import current_fiscal_year
from app.services.permission_service import PermissionService
from tests.conftest import (
    auth_headers,
    create_card,
    create_card_type,
    create_relation,
    create_relation_type,
    create_role,
    create_user,
)

TOTAL = "costTotalAnnual"
THIS_YEAR = current_fiscal_year(1)


def _schema(*fields):
    return [{"section": "S", "fields": [{"key": k, "label": k, "type": t} for k, t in fields]}]


APP_FIELDS = _schema((TOTAL, "cost"), ("tier", "single_select"))


@pytest.fixture
async def env(db):
    await create_role(db, key="admin", permissions={"*": True})
    admin = await create_user(db, email="admin@test.com", role="admin")
    await create_card_type(db, key="Application", fields_schema=APP_FIELDS)
    await create_card_type(db, key="ITComponent", fields_schema=_schema((TOTAL, "cost")))
    await create_card_type(db, key="Organization", fields_schema=[])
    await create_relation_type(
        db,
        key="relAppToOrg",
        source_type_key="Application",
        target_type_key="Organization",
        cardinality="1:n",
    )
    await create_relation_type(
        db, key="relAppToITC", source_type_key="Application", target_type_key="ITComponent"
    )
    return {"admin": admin}


async def _call(client, env, report="cost-sankey", expect=200, **params):
    resp = await client.get(
        f"/api/v1/reports/{report}",
        params={"type": "Application", **params},
        headers=auth_headers(env["admin"]),
    )
    assert resp.status_code == expect, resp.text
    return resp.json()


async def _app(db, name, cost, **attrs):
    return await create_card(
        db, card_type="Application", name=name, attributes={TOTAL: cost, **attrs}
    )


async def _with_components(db):
    db.add(
        Calculation(
            name="c",
            target_type_key="Application",
            target_field_key=TOTAL,
            formula="present = data.costA + data.costB",
            is_active=True,
        )
    )
    ct = (await db.execute(select(CardType).where(CardType.key == "Application"))).scalar_one()
    ct.fields_schema = _schema(
        (TOTAL, "cost"), ("costA", "cost"), ("costB", "cost"), ("tier", "single_select")
    )
    await db.flush()


def _by_type(data, type_key):
    return {n["name"]: i for i, n in enumerate(data["nodes"]) if n["type"] == type_key}


def _link_values(data, src_type, tgt_type):
    out = {}
    for link in data["links"]:
        s, t = data["nodes"][link["source"]], data["nodes"][link["target"]]
        if s["type"] == src_type and t["type"] == tgt_type:
            out[(s["name"], t["name"])] = link["value"]
    return out


async def test_same_cards_as_treemap(client, db, env):
    await _app(db, "A", 100)
    await _app(db, "B", 40)
    await create_card(db, card_type="ITComponent", name="Itc", attributes={TOTAL: 5})
    params = {"type": "Application,ITComponent"}
    tree = await _call(client, env, "cost-treemap", **params)
    sank = await _call(client, env, **params)
    cards = {n["id"] for n in sank["nodes"] if n["type"] not in ("CostItem", "Group")}
    assert cards == {i["id"] for i in tree["items"]}


async def test_total_equals_treemap_total_for_a_plain_sum(client, db, env):
    await _app(db, "A", 100)
    await _app(db, "B", 40)
    tree = await _call(client, env, "cost-treemap")
    sank = await _call(client, env)
    assert sank["total"] == tree["total"] == 140
    assert {"fiscal_year", "current_fiscal_year", "fiscal_year_start"} <= set(sank)


async def test_itcomponent_used_by_three_apps_counted_once(client, db, env):
    itc = await create_card(db, card_type="ITComponent", name="Shared", attributes={TOTAL: 500})
    for n in "123":
        app = await _app(db, f"App{n}", 0)
        await create_relation(db, type_key="relAppToITC", source_id=app.id, target_id=itc.id)
    data = await _call(client, env, type="ITComponent")
    assert data["total"] == 500
    assert _link_values(data, "CostItem", "ITComponent") == {(TOTAL, "Shared"): 500}
    assert len(data["links"]) == 1


async def test_single_field_shows_one_cost_item(client, db, env):
    await _app(db, "A", 100)
    data = await _call(client, env)
    assert [n for n in data["nodes"] if n["type"] == "CostItem"] == [
        {"id": f"item:{TOTAL}", "name": TOTAL, "type": "CostItem"}
    ]
    assert _link_values(data, "CostItem", "Application") == {(TOTAL, "A"): 100}


async def test_total_field_shows_each_component_as_item(client, db, env):
    await _with_components(db)
    await _app(db, "A", 100, costA=30, costB=70)
    await _app(db, "B", 5, costA=5)
    data = await _call(client, env)
    assert set(_by_type(data, "CostItem")) == {"costA", "costB"}
    assert _link_values(data, "CostItem", "Application") == {
        ("costA", "A"): 30,
        ("costB", "A"): 70,
        ("costA", "B"): 5,
    }
    assert data["total"] == 105


async def test_grouped_puts_group_nodes_between_items_and_cards(client, db, env):
    await _with_components(db)
    await _app(db, "A", 100, costA=30, costB=70, tier="gold")
    await _app(db, "B", 5, costA=5, tier="gold")
    await _app(db, "C", 9, costB=9, tier="silver")
    data = await _call(client, env, group_by="field:tier")
    kinds = [data["nodes"][link["source"]]["type"] for link in data["links"]]
    assert "Application" not in kinds  # no link leaves a card
    item_group = _link_values(data, "CostItem", "Group")
    assert item_group == {
        ("costA", "gold"): 35,
        ("costB", "gold"): 70,
        ("costB", "silver"): 9,
    }
    group_card = _link_values(data, "Group", "Application")
    assert group_card == {("gold", "A"): 100, ("gold", "B"): 5, ("silver", "C"): 9}
    for g in ("gold", "silver"):
        into = sum(v for (_, gg), v in item_group.items() if gg == g)
        out = sum(v for (gg, _), v in group_card.items() if gg == g)
        assert into == out
    assert data["total"] == 114


async def test_grouped_other_bucket(client, db, env):
    await _app(db, "A", 10, tier="gold")
    await _app(db, "B", 4)
    data = await _call(client, env, group_by="field:tier")
    assert _link_values(data, "Group", "Application") == {
        ("gold", "A"): 10,
        ("__other__", "B"): 4,
    }


async def test_grouped_by_relation(client, db, env):
    org = await create_card(db, card_type="Organization", name="Acme")
    a = await _app(db, "A", 10)
    await create_relation(db, type_key="relAppToOrg", source_id=a.id, target_id=org.id)
    data = await _call(client, env, group_by="rel:relAppToOrg")
    assert _link_values(data, "Group", "Application") == {("Acme", "A"): 10}


async def test_year_and_forecast_use_history(client, db, env):
    past = await _app(db, "Past", 0)
    db.add(CardCostHistory(card_id=past.id, fiscal_year=THIS_YEAR - 2, field_key=TOTAL, value=40))
    await db.flush()
    data = await _call(client, env, fiscal_year=THIS_YEAR - 2)
    assert _link_values(data, "CostItem", "Application") == {(TOTAL, "Past"): 40}
    assert data["total"] == 40
    assert data["fiscal_year"] == THIS_YEAR - 2
    assert (await _call(client, env))["nodes"] == []


@pytest.mark.parametrize(
    "params",
    [
        {"group_by": "rel:relAppToITC"},
        {"group_by": "field:nope"},
        {"type": "Bogus"},
        {"type": "Application,"},
        {"type": "Organization"},
        {"cost_field": "bad;key"},
    ],
)
async def test_bad_request_is_400(client, db, env, params):
    await _app(db, "A", 10)
    await _call(client, env, expect=400, **params)


async def test_old_style_group_by_type_key_is_ignored(client, db, env):
    await _app(db, "A", 10)
    data = await _call(client, env, group_by="Organization")
    assert not _by_type(data, "Group")


async def test_no_cost_permission_is_403(client, db, env):
    await create_role(db, key="nocost", permissions={"inventory.view": True}, is_system=False)
    user = await create_user(db, email="n@test.com", role="nocost")
    resp = await client.get("/api/v1/reports/cost-sankey", headers=auth_headers(user))
    assert resp.status_code == 403


async def test_card_with_total_but_zero_components_still_appears(client, db, env):
    await _with_components(db)
    await _app(db, "A", 100, costA=30, costB=70)
    await _app(db, "Only total", 40)
    tree = await _call(client, env, "cost-treemap")
    sank = await _call(client, env)
    assert sank["total"] == tree["total"] == 140
    assert "Only total" in {n["name"] for n in sank["nodes"]}


async def test_remainder_goes_to_other_cost_item(client, db, env):
    await _with_components(db)
    await _app(db, "A", 100, costA=30, costB=50)
    await _app(db, "Only total", 40)
    data = await _call(client, env)
    assert _link_values(data, "CostItem", "Application") == {
        ("costA", "A"): 30,
        ("costB", "A"): 50,
        ("__other__", "A"): 20,
        ("__other__", "Only total"): 40,
    }
    assert data["total"] == 140


async def test_components_above_total_are_linked_as_they_are(client, db, env):
    await _with_components(db)
    await _app(db, "A", 50, costA=30, costB=50)
    data = await _call(client, env)
    assert "__other__" not in _by_type(data, "CostItem")
    assert _link_values(data, "CostItem", "Application") == {("costA", "A"): 30, ("costB", "A"): 50}


async def test_flows_conserve_with_remainder_and_groups(client, db, env):
    await _with_components(db)
    await _app(db, "A", 100, costA=30, tier="gold")
    await _app(db, "B", 40, tier="gold")
    data = await _call(client, env, group_by="field:tier")
    item_group = _link_values(data, "CostItem", "Group")
    assert item_group == {("costA", "gold"): 30, ("__other__", "gold"): 110}
    assert _link_values(data, "Group", "Application") == {("gold", "A"): 100, ("gold", "B"): 40}


async def test_ids_are_unique_across_kinds(client, db, env):
    await _app(db, "A", 10, tier=TOTAL)
    data = await _call(client, env, group_by="field:tier")
    ids = [n["id"] for n in data["nodes"]]
    assert len(ids) == len(set(ids))


async def test_hidden_type_cards_absent_for_restricted_reader(client, db, env):
    await create_role(db, key="reader", permissions={"costs.view": True}, is_system=False)
    reader = await create_user(db, email="r@test.com", role="reader")
    ct = (await db.execute(select(CardType).where(CardType.key == "ITComponent"))).scalar_one()
    ct.role_permissions = {"reader": {"inventory.view": False}}
    await db.flush()
    PermissionService.invalidate_type_permission_cache()
    await _app(db, "App", 100)
    await create_card(db, card_type="ITComponent", name="SecretItc", attributes={TOTAL: 50})
    resp = await client.get(
        "/api/v1/reports/cost-sankey",
        params={"type": "Application,ITComponent"},
        headers=auth_headers(reader),
    )
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert "SecretItc" not in {n["name"] for n in data["nodes"]}
    assert data["total"] == 100


async def test_multi_type_grouped_flows_conserve(client, db, env):
    ct = (await db.execute(select(CardType).where(CardType.key == "ITComponent"))).scalar_one()
    ct.fields_schema = _schema((TOTAL, "cost"), ("tier", "single_select"))
    await db.flush()
    await _app(db, "A", 100, tier="gold")
    await _app(db, "B", 10)
    await create_card(db, card_type="ITComponent", name="I", attributes={TOTAL: 50, "tier": "gold"})
    data = await _call(client, env, type="Application,ITComponent", group_by="field:tier")
    cards = [n["name"] for n in data["nodes"] if n["type"] not in ("CostItem", "Group")]
    assert sorted(cards) == ["A", "B", "I"]
    assert _link_values(data, "Group", "Application") == {
        ("gold", "A"): 100,
        ("__other__", "B"): 10,
    }
    assert _link_values(data, "Group", "ITComponent") == {("gold", "I"): 50}
    assert _link_values(data, "CostItem", "Group") == {
        (TOTAL, "gold"): 150,
        (TOTAL, "__other__"): 10,
    }
    assert data["total"] == 160
