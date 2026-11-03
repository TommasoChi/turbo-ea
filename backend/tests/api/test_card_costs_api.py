import pytest
from sqlalchemy import select, update

from app.core.permissions import VIEWER_PERMISSIONS
from app.models.card_cost import CardCost
from app.models.card_type import CardType
from app.models.event import Event
from app.services import cost_item_types
from app.services.fiscal_year import current_fiscal_year
from tests.conftest import auth_headers, create_card, create_card_type, create_role, create_user

CUR = current_fiscal_year(1)
FORECAST = CUR + 1


@pytest.fixture
async def env(db):
    await create_role(db, key="admin", permissions={"*": True})
    await create_role(db, key="viewer", label="Viewer", permissions=VIEWER_PERMISSIONS)
    await create_role(
        db,
        key="nocost",
        label="NoCost",
        permissions={"inventory.view": True, "inventory.edit": True},
    )
    admin = await create_user(db, email="a@costs-api.com", role="admin")
    viewer = await create_user(db, email="v@costs-api.com", role="viewer")
    nocost = await create_user(db, email="n@costs-api.com", role="nocost")
    await create_card_type(db, key="Application")
    await create_card_type(db, key="Process", label="Process")
    await cost_item_types.create_item(db, "lic", "Licences")
    await cost_item_types.create_item(db, "old", "Old")
    await cost_item_types.update_item(db, "old", archived=True)
    card = await create_card(db, card_type="Application", name="ERP", user_id=admin.id)
    return {"admin": admin, "viewer": viewer, "nocost": nocost, "card": card}


def url(card, tail=""):
    return f"/api/v1/cards/{card.id}/costs{tail}"


async def put(client, env, user="admin", fy=CUR, key="lic", amount=100, renewal_date=None):
    return await client.put(
        url(env["card"], f"/{fy}/items/{key}"),
        json={"amount": amount, "renewal_date": renewal_date},
        headers=auth_headers(env[user]),
    )


async def events(db, card):
    q = select(Event).where(Event.card_id == card.id).order_by(Event.created_at)
    return (await db.execute(q)).scalars().all()


async def test_get_six_years_and_catalogue(client, env):
    r = await client.get(url(env["card"]), headers=auth_headers(env["admin"]))
    assert r.status_code == 200
    body = r.json()
    assert len(body["years"]) == 6
    assert {c["key"] for c in body["catalogue"]} == {"lic", "old"}


async def test_get_needs_costs_view(client, env):
    r = await client.get(url(env["card"]), headers=auth_headers(env["nocost"]))
    assert r.status_code == 403
    assert "amount" not in r.text


async def test_get_404_wrong_type_and_missing_card(client, db, env):
    other = await create_card(db, card_type="Process", name="P", user_id=env["admin"].id)
    r = await client.get(url(other), headers=auth_headers(env["admin"]))
    assert r.status_code == 404
    r = await client.get(
        "/api/v1/cards/00000000-0000-0000-0000-000000000000/costs",
        headers=auth_headers(env["admin"]),
    )
    assert r.status_code == 404


async def test_hidden_card_is_404(client, db, env):
    await db.execute(
        update(CardType)
        .where(CardType.key == "Application")
        .values(role_permissions={"viewer": {"inventory.view": False}})
    )
    await db.flush()
    r = await client.get(url(env["card"]), headers=auth_headers(env["viewer"]))
    assert r.status_code == 404


async def test_put_updates_derived_total_and_writes_one_event(client, db, env):
    r = await put(client, env, amount=120.5, renewal_date="2030-01-31")
    assert r.status_code == 200
    assert r.json()["tco"] == 120.5
    await db.refresh(env["card"])
    assert env["card"].attributes["costTotalAnnual"] == 120.5
    evs = [e for e in await events(db, env["card"]) if e.data.get("source") == "card_costs"]
    assert len(evs) == 1
    ch = evs[0].data["changes"]
    assert ch["cost_items"] == {"old": [], "new": ["lic"]}
    assert "2030-01-31" not in str(ch["cost_items"])


async def test_put_403_without_edit_gate(client, env):
    assert (await put(client, env, user="viewer")).status_code == 403


async def test_put_403_without_costs_view(client, env):
    r = await put(client, env, user="nocost", amount=777)
    assert r.status_code == 403
    assert "777" not in r.text


async def test_put_422_negative_amount(client, env):
    assert (await put(client, env, amount=-1)).status_code == 422


async def test_put_422_unknown_item_and_year(client, env):
    assert (await put(client, env, key="nope")).status_code == 422
    assert (await put(client, env, fy=CUR - 9)).status_code == 422


async def test_put_409_archived_new_item(client, env):
    assert (await put(client, env, key="old")).status_code == 409


async def test_delete_item(client, db, env):
    await put(client, env, amount=50)
    path = url(env["card"], f"/{CUR}/items/lic")
    r = await client.delete(path, headers=auth_headers(env["viewer"]))
    assert r.status_code == 403
    r = await client.delete(path, headers=auth_headers(env["admin"]))
    assert r.status_code == 204
    await db.refresh(env["card"])
    assert env["card"].attributes["costTotalAnnual"] == 0


async def test_confirm_creates_row(client, db, env):
    r = await client.post(
        url(env["card"], f"/{CUR - 1}/confirm"), headers=auth_headers(env["admin"])
    )
    assert r.status_code == 200 and r.json()["confirmed"] is True
    rows = (await db.execute(select(CardCost).where(CardCost.card_id == env["card"].id))).all()
    assert len(rows) == 1


async def test_copy_to_forecast(client, env):
    await put(client, env, fy=CUR, amount=70)
    h = auth_headers(env["admin"])
    r = await client.post(url(env["card"], f"/{CUR}/items/lic/copy-to-forecast"), headers=h)
    assert r.status_code == 200
    assert r.json()["fiscal_year"] == FORECAST
    assert r.json()["items"][0]["amount"] == 70
    r = await client.post(url(env["card"], f"/{CUR}/items/nope/copy-to-forecast"), headers=h)
    assert r.status_code == 422


async def test_event_history_shows_keys_only(client, env):
    await put(client, env, amount=987.65, renewal_date="2031-02-03")
    r = await client.get(
        f"/api/v1/cards/{env['card'].id}/history", headers=auth_headers(env["viewer"])
    )
    assert r.status_code == 200
    ev = [e for e in r.json() if e["data"].get("source") == "card_costs"][0]
    assert ev["data"]["changes"]["cost_items"]["new"] == ["lic"]
    assert "987.65" not in str(ev["data"]["changes"]["cost_items"])
    assert "2031" not in str(ev["data"]["changes"]["cost_items"])


async def test_get_single_year(client, env):
    await put(client, env, amount=33)
    h = auth_headers(env["admin"])
    r = await client.get(url(env["card"], f"/{CUR - 5}"), headers=h)
    assert r.status_code == 200 and r.json()["items"] == []
    r = await client.get(url(env["card"], f"/{CUR}"), headers=h)
    assert r.json()["items"][0]["amount"] == 33
    r = await client.get(url(env["card"], f"/{CUR}"), headers=auth_headers(env["nocost"]))
    assert r.status_code == 403
