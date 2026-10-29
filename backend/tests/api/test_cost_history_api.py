import pytest

from app.services.fiscal_year import current_fiscal_year
from tests.conftest import auth_headers, create_card, create_card_type, create_role, create_user

pytestmark = pytest.mark.anyio

# With the default January start the fiscal year is the calendar year.
THIS_YEAR = current_fiscal_year(1)
YEAR = THIS_YEAR - 1

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
        json={"fiscal_year": YEAR, "field_key": "costTotalAnnual", "value": 100},
        headers=auth_headers(admin),
    )
    assert resp.status_code == 200
    resp = await client.get(f"/api/v1/cards/{card.id}/cost-history", headers=auth_headers(admin))
    assert resp.status_code == 200
    assert resp.json()["rows"] == [
        {"fiscal_year": YEAR, "field_key": "costTotalAnnual", "value": 100}
    ]


async def test_upsert_overwrites_the_same_year_and_field(client, db, env):
    admin = env["admin"]
    card = await create_card(db, card_type="Application", name="ERP", user_id=admin.id)
    for value in (100, 200):
        resp = await client.put(
            f"/api/v1/cards/{card.id}/cost-history",
            json={"fiscal_year": YEAR, "field_key": "costTotalAnnual", "value": value},
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
    resp = await client.get(f"/api/v1/cards/{card.id}/cost-history", headers=auth_headers(admin))
    assert resp.json()["rows"] == [
        {"fiscal_year": YEAR, "field_key": "costTotalAnnual", "value": 200}
    ]


async def test_delete_removes_the_row(client, db, env):
    admin = env["admin"]
    card = await create_card(db, card_type="Application", name="ERP", user_id=admin.id)
    await client.put(
        f"/api/v1/cards/{card.id}/cost-history",
        json={"fiscal_year": YEAR, "field_key": "costTotalAnnual", "value": 100},
        headers=auth_headers(admin),
    )
    resp = await client.delete(
        f"/api/v1/cards/{card.id}/cost-history/{YEAR}/costTotalAnnual", headers=auth_headers(admin)
    )
    assert resp.status_code == 204
    resp = await client.get(f"/api/v1/cards/{card.id}/cost-history", headers=auth_headers(admin))
    assert resp.json()["rows"] == []


async def test_rejects_a_field_key_the_card_type_does_not_have(client, db, env):
    admin = env["admin"]
    card = await create_card(db, card_type="Application", name="ERP", user_id=admin.id)
    resp = await client.put(
        f"/api/v1/cards/{card.id}/cost-history",
        json={"fiscal_year": YEAR, "field_key": "notACostField", "value": 100},
        headers=auth_headers(admin),
    )
    assert resp.status_code == 400


async def _put(client, card, admin, **body):
    payload = {"fiscal_year": YEAR, "field_key": "costTotalAnnual", "value": 1, **body}
    return await client.put(
        f"/api/v1/cards/{card.id}/cost-history", json=payload, headers=auth_headers(admin)
    )


@pytest.mark.parametrize("year", [THIS_YEAR, THIS_YEAR - 5])
async def test_the_current_year_and_the_five_before_it_are_accepted(client, db, env, year):
    admin = env["admin"]
    card = await create_card(db, card_type="Application", name="ERP", user_id=admin.id)
    assert (await _put(client, card, admin, fiscal_year=year)).status_code == 200


@pytest.mark.parametrize("year", [THIS_YEAR + 1, THIS_YEAR - 6])
async def test_a_year_outside_the_five_year_window_is_rejected(client, db, env, year):
    admin = env["admin"]
    card = await create_card(db, card_type="Application", name="ERP", user_id=admin.id)
    resp = await _put(client, card, admin, fiscal_year=year)
    assert resp.status_code == 422
    assert str(THIS_YEAR - 5) in resp.json()["detail"]
    rows = await client.get(f"/api/v1/cards/{card.id}/cost-history", headers=auth_headers(admin))
    assert rows.json()["rows"] == []


@pytest.mark.parametrize("year", [2147483648, 99999999999, 0, -5, 1899, 2201])
async def test_an_absurd_year_is_a_422_never_a_500(client, db, env, year):
    admin = env["admin"]
    card = await create_card(db, card_type="Application", name="ERP", user_id=admin.id)
    assert (await _put(client, card, admin, fiscal_year=year)).status_code == 422
    resp = await client.delete(
        f"/api/v1/cards/{card.id}/cost-history/{year}/costTotalAnnual", headers=auth_headers(admin)
    )
    assert resp.status_code == 422


async def test_a_row_older_than_the_window_can_still_be_deleted(client, db, env):
    """Rows recorded before the window moved on must stay removable."""
    admin = env["admin"]
    card = await create_card(db, card_type="Application", name="ERP", user_id=admin.id)
    resp = await client.delete(
        f"/api/v1/cards/{card.id}/cost-history/{THIS_YEAR - 9}/costTotalAnnual",
        headers=auth_headers(admin),
    )
    assert resp.status_code == 204


@pytest.mark.parametrize("raw_value", ["1e999", "-1e999", "NaN", "Infinity", "-1", "-0.01"])
async def test_a_value_that_is_negative_or_not_finite_is_rejected(client, db, env, raw_value):
    """json.dumps cannot spell these, so send the body as text, the way a hostile client would."""
    admin = env["admin"]
    card = await create_card(db, card_type="Application", name="ERP", user_id=admin.id)
    body = '{"fiscal_year": %d, "field_key": "costTotalAnnual", "value": %s}' % (YEAR, raw_value)
    resp = await client.put(
        f"/api/v1/cards/{card.id}/cost-history",
        content=body,
        headers={**auth_headers(admin), "Content-Type": "application/json"},
    )
    assert resp.status_code == 422
    rows = await client.get(f"/api/v1/cards/{card.id}/cost-history", headers=auth_headers(admin))
    assert rows.json()["rows"] == []


async def test_a_cost_of_zero_is_accepted(client, db, env):
    admin = env["admin"]
    card = await create_card(db, card_type="Application", name="ERP", user_id=admin.id)
    assert (await _put(client, card, admin, value=0)).status_code == 200
