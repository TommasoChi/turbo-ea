"""costs.edit gate, can_edit flag, and cost redaction in card history."""

import pytest

from app.core.permissions import VIEWER_PERMISSIONS
from app.models.stakeholder import Stakeholder
from app.services import cost_item_types
from app.services.event_bus import event_bus
from app.services.fiscal_year import current_fiscal_year
from tests.conftest import (
    auth_headers,
    create_card,
    create_card_type,
    create_role,
    create_stakeholder_role_def,
    create_user,
)

CUR = current_fiscal_year(1)


@pytest.fixture
async def env(db):
    await create_role(db, key="admin", permissions={"*": True})
    await create_role(db, key="viewer", label="Viewer", permissions=VIEWER_PERMISSIONS)
    await create_role(
        db, key="inv", label="Inv", permissions={"inventory.view": True, "inventory.edit": True}
    )
    users = {
        "admin": await create_user(db, email="a@cp.com", role="admin"),
        "resp": await create_user(db, email="r@cp.com", role="viewer"),
        "obs": await create_user(db, email="o@cp.com", role="viewer"),
        "inv": await create_user(db, email="i@cp.com", role="inv"),
    }
    await create_card_type(
        db,
        key="Application",
        fields_schema=[
            {"section": "Cost", "fields": [{"key": "costTotalAnnual", "type": "cost", "weight": 0}]}
        ],
    )
    await cost_item_types.create_item(db, "lic", "Licences")
    for key, edit in (("responsible", True), ("observer", False)):
        await create_stakeholder_role_def(
            db, key=key, label=key, permissions={"card.view": True, "card.edit": edit}
        )
    card = await create_card(db, card_type="Application", name="ERP", user_id=users["admin"].id)
    db.add(Stakeholder(card_id=card.id, user_id=users["resp"].id, role="responsible"))
    db.add(Stakeholder(card_id=card.id, user_id=users["obs"].id, role="observer"))
    await db.flush()
    return {**users, "card": card}


def url(env, tail=""):
    return f"/api/v1/cards/{env['card'].id}/costs{tail}"


async def put(client, env, who, amount=4321):
    return await client.put(
        url(env, f"/{CUR}/items/lic"), json={"amount": amount}, headers=auth_headers(env[who])
    )


async def test_put_edit_stakeholder_200_observer_and_inventory_edit_403(client, env):
    assert (await put(client, env, "resp")).status_code == 200
    assert (await put(client, env, "obs")).status_code == 403
    assert (await put(client, env, "inv")).status_code == 403
    assert (await put(client, env, "admin")).status_code == 200


async def test_get_can_edit_flag(client, env):
    for who, expected in (("admin", True), ("resp", True), ("obs", False)):
        for tail in ("", f"/{CUR}"):
            r = await client.get(url(env, tail), headers=auth_headers(env[who]))
            assert r.status_code == 200
            assert r.json()["can_edit"] is expected


async def test_history_redacts_for_non_cost_reader_and_labels_event(client, db, env):
    await put(client, env, "admin")
    # "inv" holds inventory.view but neither costs.view nor a stakeholder role.
    h = f"/api/v1/cards/{env['card'].id}/history"
    r = await client.get(h, headers=auth_headers(env["inv"]))
    assert r.status_code == 200
    evs = [e for e in r.json() if e["event_type"] == "card.costs_updated"]
    assert len(evs) == 1
    assert evs[0]["data"]["changes"] == {}
    assert "4321" not in r.text and "lic" not in r.text
    assert evs[0]["data"]["summary"] == "Costs of ERP changed"
    r = await client.get(h, headers=auth_headers(env["resp"]))
    ev = [e for e in r.json() if e["event_type"] == "card.costs_updated"][0]
    assert ev["data"]["changes"]["costTotalAnnual"]["new"] == 4321
    assert ev["data"]["summary"] == "Costs of ERP changed (items: Licences)"


async def test_history_redacts_attribute_diff(client, db, env):
    card = env["card"]
    await event_bus.publish(
        "card.updated",
        {
            "id": str(card.id),
            "changes": {
                "attributes": {
                    "old": {"costTotalAnnual": 11, "note": "a"},
                    "new": {"costTotalAnnual": 22, "note": "b"},
                }
            },
        },
        db=db,
        card_id=card.id,
        user_id=env["admin"].id,
    )
    h = f"/api/v1/cards/{card.id}/history"
    r = await client.get(h, headers=auth_headers(env["inv"]))
    assert r.json()[0]["data"]["changes"]["attributes"] == {
        "old": {"note": "a"},
        "new": {"note": "b"},
    }
    r = await client.get(h, headers=auth_headers(env["obs"]))
    assert r.json()[0]["data"]["changes"]["attributes"]["new"]["costTotalAnnual"] == 22
    r = await client.get(h, headers=auth_headers(env["admin"]))
    assert r.json()[0]["data"]["changes"]["attributes"]["new"]["costTotalAnnual"] == 22
