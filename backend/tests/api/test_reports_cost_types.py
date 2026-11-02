"""GET /reports/cost-treemap across several card types, grouped by a field or a linked card."""

from __future__ import annotations

import pytest
from sqlalchemy import select

from app.models.calculation import Calculation
from app.models.card_type import CardType
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


def _schema(*fields):
    return [{"section": "S", "fields": [{"key": k, "label": k, "type": t} for k, t in fields]}]


APP_FIELDS = _schema((TOTAL, "cost"), ("tier", "single_select"), ("tags", "multiple_select"))
ITC_FIELDS = _schema((TOTAL, "cost"))
INIT_FIELDS = _schema(("costBudget", "cost"))


@pytest.fixture
async def env(db):
    await create_role(db, key="admin", permissions={"*": True})
    admin = await create_user(db, email="admin@test.com", role="admin")
    await create_card_type(db, key="Application", fields_schema=APP_FIELDS)
    await create_card_type(db, key="ITComponent", fields_schema=ITC_FIELDS)
    await create_card_type(db, key="Initiative", fields_schema=INIT_FIELDS)
    await create_card_type(db, key="Organization", fields_schema=[])
    await create_relation_type(
        db,
        key="relAppToOrg",
        source_type_key="Application",
        target_type_key="Organization",
        cardinality="1:n",
    )
    await create_relation_type(
        db,
        key="relAppToITC",
        source_type_key="Application",
        target_type_key="ITComponent",
        cardinality="n:m",
    )
    return {"admin": admin}


async def _get(client, env, expect=200, **params):
    resp = await client.get(
        "/api/v1/reports/cost-treemap",
        params={"type": "Application", **params},
        headers=auth_headers(env["admin"]),
    )
    assert resp.status_code == expect, resp.text
    return resp.json()


async def _app(db, name, cost, **attrs):
    return await create_card(
        db, card_type="Application", name=name, attributes={TOTAL: cost, **attrs}
    )


async def test_two_types_return_both_with_type(client, db, env):
    await _app(db, "App", 100)
    await create_card(db, card_type="ITComponent", name="Itc", attributes={TOTAL: 50})
    data = await _get(client, env, type="Application,ITComponent")
    assert {(i["name"], i["type"]) for i in data["items"]} == {
        ("App", "Application"),
        ("Itc", "ITComponent"),
    }
    assert data["total"] == 150
    assert data["groups"] is None


async def test_single_type_unchanged(client, db, env):
    await _app(db, "App", 100)
    data = await _get(client, env)
    assert [i["type"] for i in data["items"]] == ["Application"]
    assert data["components"] == [TOTAL]
    assert {"fiscal_year", "current_fiscal_year", "fiscal_year_start"} <= set(data)
    assert "group" not in data["items"][0]


@pytest.mark.parametrize("bad", ["Application,", "Application,Bogus", "Bogus", "Organization"])
async def test_bad_type_list_is_400(client, env, bad):
    await _get(client, env, expect=400, type=bad)


async def test_hidden_type_cards_omitted_for_restricted_reader(client, db, env):
    await create_role(db, key="reader", permissions={"costs.view": True}, is_system=False)
    reader = await create_user(db, email="r@test.com", role="reader")
    ct = (await db.execute(select(CardType).where(CardType.key == "ITComponent"))).scalar_one()
    ct.role_permissions = {"reader": {"inventory.view": False}}
    await db.flush()
    PermissionService.invalidate_type_permission_cache()
    await _app(db, "App", 100)
    await create_card(db, card_type="ITComponent", name="Itc", attributes={TOTAL: 50})
    resp = await client.get(
        "/api/v1/reports/cost-treemap",
        params={"type": "Application,ITComponent"},
        headers=auth_headers(reader),
    )
    assert resp.status_code == 200, resp.text
    assert [i["name"] for i in resp.json()["items"]] == ["App"]


async def test_group_by_field_other_bucket(client, db, env):
    await _app(db, "A", 100, tier="gold")
    await _app(db, "B", 40, tier="gold")
    await _app(db, "C", 10)
    data = await _get(client, env, group_by="field:tier")
    by_name = {i["name"]: i["group"] for i in data["items"]}
    assert by_name == {"A": "gold", "B": "gold", "C": "__other__"}
    assert data["groups"] == [{"name": "gold", "cost": 140}, {"name": "__other__", "cost": 10}]


async def test_group_by_bare_field_key_reads_as_field(client, db, env):
    await _app(db, "A", 100, tier="gold")
    data = await _get(client, env, group_by="tier")
    assert data["items"][0]["group"] == "gold"


async def test_group_by_relation_names_linked_card(client, db, env):
    org = await create_card(db, card_type="Organization", name="Acme")
    a = await _app(db, "A", 100)
    await _app(db, "B", 10)
    await create_relation(db, type_key="relAppToOrg", source_id=a.id, target_id=org.id)
    data = await _get(client, env, group_by="rel:relAppToOrg")
    assert {i["name"]: i["group"] for i in data["items"]} == {"A": "Acme", "B": "__other__"}


async def test_group_by_nm_relation_is_400(client, db, env):
    await _app(db, "A", 100)
    await _get(client, env, expect=400, group_by="rel:relAppToITC")


async def test_group_by_multi_select_field_is_400(client, db, env):
    await _app(db, "A", 100)
    await _get(client, env, expect=400, group_by="field:tags")


async def test_group_by_old_type_key_is_ignored(client, db, env):
    await _app(db, "A", 100)
    data = await _get(client, env, group_by="Organization")
    assert data["groups"] is None
    assert "group" not in data["items"][0]


async def test_initiative_type_accepted_with_cost_budget(client, db, env):
    await create_card(db, card_type="Initiative", name="Init", attributes={"costBudget": 70})
    data = await _get(client, env, type="Initiative", cost_field="costBudget")
    assert data["total"] == 70
    assert data["components"] == ["costBudget"]


async def test_components_follow_active_calculation(client, db, env):
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
    ct.fields_schema = _schema((TOTAL, "cost"), ("costA", "cost"), ("costB", "cost"))
    await db.flush()
    await _app(db, "A", 100)
    data = await _get(client, env)
    assert data["components"] == ["costA", "costB"]


async def test_no_cost_permission_is_403(client, db, env):
    await create_role(db, key="nocost", permissions={"inventory.view": True}, is_system=False)
    user = await create_user(db, email="n@test.com", role="nocost")
    resp = await client.get("/api/v1/reports/cost-treemap", headers=auth_headers(user))
    assert resp.status_code == 403


@pytest.mark.parametrize("report", ["cost-treemap", "cost-sankey"])
async def test_group_by_hidden_relation_or_type_is_400(client, db, env, report):
    from sqlalchemy import update

    from app.models.card_type import CardType
    from app.models.relation_type import RelationType

    await _app(db, "A", 100)
    await db.execute(
        update(RelationType).where(RelationType.key == "relAppToOrg").values(is_hidden=True)
    )
    await db.commit()
    for _ in range(2):
        resp = await client.get(
            f"/api/v1/reports/{report}",
            params={"type": "Application", "group_by": "rel:relAppToOrg"},
            headers=auth_headers(env["admin"]),
        )
        assert resp.status_code == 400, resp.text
        await db.execute(
            update(RelationType).where(RelationType.key == "relAppToOrg").values(is_hidden=False)
        )
        await db.execute(
            update(CardType).where(CardType.key == "Organization").values(is_hidden=True)
        )
        await db.commit()


@pytest.mark.parametrize("report", ["cost-treemap", "cost-sankey"])
async def test_six_types_is_400(client, env, report):
    resp = await client.get(
        f"/api/v1/reports/{report}",
        params={"type": "Application,ITComponent,Initiative,A,B,C"},
        headers=auth_headers(env["admin"]),
    )
    assert resp.status_code == 400, resp.text
    assert "at most" in resp.text
