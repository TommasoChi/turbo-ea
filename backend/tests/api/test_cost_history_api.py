import pytest

from tests.conftest import auth_headers, create_card, create_card_type, create_role, create_user

pytestmark = pytest.mark.anyio

COST_FIELDS = [
    {"section": "Cost", "fields": [{"key": "costTotalAnnual", "type": "cost", "weight": 0}]}
]


@pytest.fixture
async def env(db):
    await create_role(db, key="admin", permissions={"*": True})
    admin = await create_user(db, email="admin@cost-history.com", role="admin")
    await create_card_type(db, key="Application", fields_schema=COST_FIELDS)
    return {"admin": admin}


async def test_lists_every_year_a_card_has(client, db, env):
    admin = env["admin"]
    card = await create_card(db, card_type="Application", name="ERP", user_id=admin.id)
    resp = await client.put(
        f"/api/v1/cards/{card.id}/cost-history",
        json={"fiscal_year": 2024, "field_key": "costTotalAnnual", "value": 100},
        headers=auth_headers(admin),
    )
    assert resp.status_code == 200
    resp = await client.get(f"/api/v1/cards/{card.id}/cost-history", headers=auth_headers(admin))
    assert resp.status_code == 200
    assert resp.json()["rows"] == [
        {"fiscal_year": 2024, "field_key": "costTotalAnnual", "value": 100}
    ]


async def test_upsert_overwrites_the_same_year_and_field(client, db, env):
    admin = env["admin"]
    card = await create_card(db, card_type="Application", name="ERP", user_id=admin.id)
    for value in (100, 200):
        resp = await client.put(
            f"/api/v1/cards/{card.id}/cost-history",
            json={"fiscal_year": 2024, "field_key": "costTotalAnnual", "value": value},
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
    resp = await client.get(f"/api/v1/cards/{card.id}/cost-history", headers=auth_headers(admin))
    assert resp.json()["rows"] == [
        {"fiscal_year": 2024, "field_key": "costTotalAnnual", "value": 200}
    ]


async def test_delete_removes_the_row(client, db, env):
    admin = env["admin"]
    card = await create_card(db, card_type="Application", name="ERP", user_id=admin.id)
    await client.put(
        f"/api/v1/cards/{card.id}/cost-history",
        json={"fiscal_year": 2024, "field_key": "costTotalAnnual", "value": 100},
        headers=auth_headers(admin),
    )
    resp = await client.delete(
        f"/api/v1/cards/{card.id}/cost-history/2024/costTotalAnnual", headers=auth_headers(admin)
    )
    assert resp.status_code == 204
    resp = await client.get(f"/api/v1/cards/{card.id}/cost-history", headers=auth_headers(admin))
    assert resp.json()["rows"] == []


async def test_rejects_a_field_key_the_card_type_does_not_have(client, db, env):
    admin = env["admin"]
    card = await create_card(db, card_type="Application", name="ERP", user_id=admin.id)
    resp = await client.put(
        f"/api/v1/cards/{card.id}/cost-history",
        json={"fiscal_year": 2024, "field_key": "notACostField", "value": 100},
        headers=auth_headers(admin),
    )
    assert resp.status_code == 400
