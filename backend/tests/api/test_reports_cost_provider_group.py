"""group_by=provider on the cost treemap and Sankey: items are split by their own provider."""

from __future__ import annotations

import uuid

import pytest
from sqlalchemy import select

from app.models.card_cost import CardCost
from app.models.card_type import CardType
from app.models.stakeholder import Stakeholder
from app.services import cost_item_types
from app.services.fiscal_year import current_fiscal_year
from app.services.permission_service import PermissionService
from tests.conftest import (
    auth_headers,
    create_card,
    create_card_type,
    create_role,
    create_stakeholder_role_def,
    create_user,
)

CUR = current_fiscal_year(1)
OTHER = "__other__"
COST_FIELDS = [
    {"section": "Cost", "fields": [{"key": "costTotalAnnual", "type": "cost", "weight": 0}]}
]


@pytest.fixture
async def env(db):
    await create_role(db, key="admin", permissions={"*": True})
    admin = await create_user(db, email="a@prov-group.com", role="admin")
    await create_card_type(db, key="Application", fields_schema=COST_FIELDS)
    await create_card_type(db, key="Initiative", fields_schema=COST_FIELDS)
    await create_card_type(db, key="Provider")
    await cost_item_types.create_item(db, "lic", "Licences")
    await cost_item_types.create_item(db, "sup", "Support")
    p1 = await create_card(db, card_type="Provider", name="Acme")
    p2 = await create_card(db, card_type="Provider", name="Acme")  # same name, another card
    erp = await create_card(db, card_type="Application", name="ERP")
    crm = await create_card(db, card_type="Application", name="CRM")
    await _costs(db, erp, lic=(100, p1.id), sup=(50, p2.id), misc=(7, None))
    await _costs(db, crm, lic=(30, p1.id))
    return {"admin": admin, "p1": p1, "p2": p2, "erp": erp, "crm": crm}


async def _costs(db, card, **items):
    db.add(
        CardCost(
            card_id=card.id,
            fiscal_year=CUR,
            items={
                k: {"amount": a, "renewal_date": None, **({"provider_id": str(p)} if p else {})}
                for k, (a, p) in items.items()
            },
        )
    )
    await db.flush()


async def _get(client, user, report, expect=200, **params):
    resp = await client.get(f"/api/v1/reports/{report}", params=params, headers=auth_headers(user))
    assert resp.status_code == expect, resp.text
    return resp.json()


async def test_treemap_group_by_provider_returns_one_entry_per_card_and_provider(client, env):
    data = await _get(client, env["admin"], "cost-treemap", type="Application", group_by="provider")
    rows = {(i["name"], i["group"]): i for i in data["items"]}
    p1, p2 = str(env["p1"].id), str(env["p2"].id)
    assert set(rows) == {("ERP", p1), ("ERP", p2), ("ERP", OTHER), ("CRM", p1)}
    assert rows[("ERP", p1)]["id"] == str(env["erp"].id)
    assert rows[("ERP", p1)]["cost"] == 100
    assert rows[("ERP", p1)]["costs"] == {"lic": 100}
    assert rows[("ERP", OTHER)]["costs"] == {"misc": 7}
    assert data["group_names"] == {p1: "Acme", p2: "Acme"}
    assert {g["name"]: g["cost"] for g in data["groups"]} == {p1: 130, p2: 50, OTHER: 7}


async def test_treemap_provider_groups_sum_to_the_ungrouped_total(client, env):
    plain = await _get(client, env["admin"], "cost-treemap", type="Application")
    grouped = await _get(
        client, env["admin"], "cost-treemap", type="Application", group_by="provider"
    )
    assert "group_names" not in plain
    assert grouped["total"] == plain["total"] == 187
    assert sum(g["cost"] for g in grouped["groups"]) == 187
    assert sum(i["cost"] for i in grouped["items"]) == 187


async def test_treemap_group_by_provider_on_initiative_is_400(client, env):
    await _get(client, env["admin"], "cost-treemap", 400, type="Initiative", group_by="provider")
    await _get(
        client,
        env["admin"],
        "cost-treemap",
        400,
        type="Application,Initiative",
        group_by="provider",
    )


async def test_treemap_group_by_provider_with_a_plain_cost_field_is_400(client, env):
    await _get(
        client,
        env["admin"],
        "cost-treemap",
        400,
        type="Application",
        cost_field="costOther",
        group_by="provider",
    )


async def test_group_by_provider_single_item_counts_only_that_item(client, env):
    data = await _get(
        client,
        env["admin"],
        "cost-treemap",
        type="Application",
        cost_field="sup",
        group_by="provider",
    )
    assert [(i["name"], i["cost"]) for i in data["items"]] == [("ERP", 50)]


async def test_sankey_group_by_provider_parity_with_the_treemap(client, env):
    tree = await _get(client, env["admin"], "cost-treemap", type="Application", group_by="provider")
    sank = await _get(client, env["admin"], "cost-sankey", type="Application", group_by="provider")
    assert sank["total"] == tree["total"] == 187
    nodes = sank["nodes"]
    into_cards = sum(
        link["value"] for link in sank["links"] if nodes[link["source"]]["type"] == "Group"
    )
    from_items = sum(
        link["value"] for link in sank["links"] if nodes[link["source"]]["type"] == "CostItem"
    )
    assert into_cards == from_items == 187
    shares = {
        (nodes[link["source"]]["id"], nodes[link["target"]]["name"]): link["value"]
        for link in sank["links"]
        if nodes[link["source"]]["type"] == "Group"
    }
    assert shares == {(f"group:{i['group']}", i["name"]): i["cost"] for i in tree["items"]}


async def test_sankey_provider_group_nodes_are_named_by_provider(client, env):
    sank = await _get(client, env["admin"], "cost-sankey", type="Application", group_by="provider")
    groups = {n["id"]: n["name"] for n in sank["nodes"] if n["type"] == "Group"}
    assert groups == {
        f"group:{env['p1'].id}": "Acme",
        f"group:{env['p2'].id}": "Acme",
        f"group:{OTHER}": OTHER,
    }


async def test_sankey_group_by_provider_on_initiative_is_400(client, env):
    await _get(client, env["admin"], "cost-sankey", 400, type="Initiative", group_by="provider")


async def test_licensing_report_does_not_accept_provider_grouping(client, env):
    with_provider = await _get(client, env["admin"], "licensing", group_by="provider")
    ungrouped = await _get(client, env["admin"], "licensing")
    assert with_provider == ungrouped


@pytest.mark.parametrize("report", ["cost-treemap", "cost-sankey"])
async def test_provider_grouping_needs_cost_permission(client, db, env, report):
    await create_role(db, key="nocost", label="N", permissions={"inventory.view": True})
    user = await create_user(db, email="n@prov-group.com", role="nocost")
    await _get(client, user, report, 403, type="Application", group_by="provider")


async def test_cost_report_still_hides_costs_without_cost_access(client, db, env):
    await create_role(
        db, key="cost_reader", permissions={"inventory.view": True, "costs.view": True}
    )
    reader = await create_user(db, email="cr@prov-group.com", role="cost_reader")
    await create_stakeholder_role_def(
        db, card_type_key="Application", key="reader", permissions={"card.view": True}
    )
    db.add(Stakeholder(card_id=env["erp"].id, user_id=reader.id, role="reader"))
    ct = (await db.execute(select(CardType).where(CardType.key == "Application"))).scalar_one()
    ct.role_permissions = {"cost_reader": {"inventory.view": False}}
    await db.flush()
    PermissionService.invalidate_type_permission_cache()
    tree = await _get(client, reader, "cost-treemap", type="Application", group_by="provider")
    assert [i["name"] for i in tree["items"]] == []
    sank = await _get(client, reader, "cost-sankey", type="Application", group_by="provider")
    assert "ERP" not in {n["name"] for n in sank["nodes"]}


async def test_a_deleted_provider_falls_into_unspecified(client, db, env):
    solo = await create_card(db, card_type="Application", name="Solo")
    await _costs(db, solo, lic=(9, uuid.uuid4()))
    data = await _get(client, env["admin"], "cost-treemap", type="Application", group_by="provider")
    assert [(i["group"], i["cost"]) for i in data["items"] if i["name"] == "Solo"] == [(OTHER, 9)]
