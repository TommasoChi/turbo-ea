from datetime import datetime, timezone

import pytest

from app.models.card_cost import CardCost
from app.services import cost_item_types
from app.services.fiscal_year import current_fiscal_year
from tests.conftest import auth_headers, create_card, create_card_type, create_role, create_user

CUR = current_fiscal_year(1)
SCHEMA = [{"section": "Cost", "fields": [{"key": "costTotalAnnual", "type": "cost", "weight": 0}]}]
NO_COST = [{"section": "Cost", "fields": [{"key": "other", "type": "text", "weight": 0}]}]


@pytest.fixture
async def env(db):
    await create_role(db, key="admin", permissions={"*": True})
    admin = await create_user(db, email="a@cost-derived.com", role="admin")
    await create_card_type(db, key="Application", fields_schema=SCHEMA)
    await create_card_type(db, key="Provider", label="Provider", fields_schema=SCHEMA)
    await cost_item_types.create_item(db, "lic", "Licences")
    return {"admin": admin}


async def test_patch_derived_key_is_overwritten_on_the_same_save(client, db, env):
    card = await create_card(db, card_type="Application", name="A", user_id=env["admin"].id)
    db.add(CardCost(card_id=card.id, fiscal_year=CUR, items={"lic": {"amount": 30}}))
    await db.commit()
    r = await client.patch(
        f"/api/v1/cards/{card.id}",
        json={"attributes": {"costTotalAnnual": 999}},
        headers=auth_headers(env["admin"]),
    )
    assert r.status_code == 200, r.text
    assert r.json()["attributes"]["costTotalAnnual"] == 30


async def test_create_without_cost_lines_stores_no_total(client, env):
    r = await client.post(
        "/api/v1/cards",
        json={"type": "Application", "name": "N", "attributes": {"costTotalAnnual": 999}},
        headers=auth_headers(env["admin"]),
    )
    assert r.status_code == 201, r.text
    assert "costTotalAnnual" not in r.json()["attributes"]


async def test_provider_keeps_its_own_value(client, db, env):
    card = await create_card(db, card_type="Provider", name="P", user_id=env["admin"].id)
    r = await client.patch(
        f"/api/v1/cards/{card.id}",
        json={"attributes": {"costTotalAnnual": 999}},
        headers=auth_headers(env["admin"]),
    )
    assert r.json()["attributes"]["costTotalAnnual"] == 999


async def test_metamodel_cannot_remove_or_retype_derived_field_on_cost_item_types(client, env):
    h = auth_headers(env["admin"])
    r = await client.patch(
        "/api/v1/metamodel/types/Application", json={"fields_schema": NO_COST}, headers=h
    )
    assert r.status_code == 400 and r.json()["detail"] == "use_cost_items", r.text
    retyped = [{"section": "Cost", "fields": [{"key": "costTotalAnnual", "type": "text"}]}]
    r = await client.patch(
        "/api/v1/metamodel/types/Application", json={"fields_schema": retyped}, headers=h
    )
    assert r.status_code == 400, r.text
    r = await client.patch(
        "/api/v1/metamodel/types/Provider", json={"fields_schema": NO_COST}, headers=h
    )
    assert r.status_code == 200, r.text


async def test_metamodel_refuses_a_duplicate_of_the_derived_field(client, db, env):
    """Guard and cleanup must read the same field: two definitions are refused."""
    dup = [
        *SCHEMA,
        {"section": "Again", "fields": [{"key": "costTotalAnnual", "type": "text"}]},
    ]
    r = await client.patch(
        "/api/v1/metamodel/types/Application",
        json={"fields_schema": dup},
        headers=auth_headers(env["admin"]),
    )
    assert r.status_code == 400 and r.json()["detail"] == "use_cost_items", r.text


async def test_legacy_cost_history_writes_blocked_for_cost_item_types(client, db, env):
    h = auth_headers(env["admin"])
    body = {"fiscal_year": CUR - 1, "field_key": "costTotalAnnual", "value": 5}
    app = await create_card(db, card_type="Application", name="A", user_id=env["admin"].id)
    prov = await create_card(db, card_type="Provider", name="P", user_id=env["admin"].id)
    r = await client.put(f"/api/v1/cards/{app.id}/cost-history", json=body, headers=h)
    assert r.status_code == 409 and r.json()["detail"] == "use_cost_items"
    r = await client.delete(
        f"/api/v1/cards/{app.id}/cost-history/{CUR - 1}/costTotalAnnual", headers=h
    )
    assert r.status_code == 409
    assert (await client.get(f"/api/v1/cards/{app.id}/cost-history", headers=h)).status_code == 200
    r = await client.put(f"/api/v1/cards/{prov.id}/cost-history", json=body, headers=h)
    assert r.status_code == 200


async def test_fiscal_year_start_change_recomputes_fallback_cards(client, db, env):
    card = await create_card(
        db,
        card_type="Application",
        name="A",
        user_id=env["admin"].id,
        attributes={"costTotalAnnual": 7},
    )
    # Only an old row, 40; and a CUR-year row that becomes "next" if the FY start moves
    # past today. Moving the start to a month after today shifts the current FY back by one.
    # Forecast row 40, current row 7. From February on, a start month of 2 moves
    # "today" into the next fiscal year, so the derived value must flip to 40.
    db.add(CardCost(card_id=card.id, fiscal_year=CUR + 1, items={"lic": {"amount": 40}}))
    db.add(CardCost(card_id=card.id, fiscal_year=CUR, items={"lic": {"amount": 7}}))
    await db.commit()
    if datetime.now(timezone.utc).month < 2:
        pytest.skip("January stays in the same fiscal year whatever the start month")
    r = await client.patch(
        "/api/v1/settings/fiscal-year-start",
        json={"month": 2},
        headers=auth_headers(env["admin"]),
    )
    assert r.status_code == 200, r.text
    await db.refresh(card)
    assert card.attributes["costTotalAnnual"] == 40


async def test_history_records_the_stored_total_not_the_sent_one(client, db, env):
    card = await create_card(db, card_type="Application", name="A", user_id=env["admin"].id)
    db.add(CardCost(card_id=card.id, fiscal_year=CUR, items={"lic": {"amount": 30}}))
    await db.commit()
    r = await client.patch(
        f"/api/v1/cards/{card.id}",
        json={"attributes": {"costTotalAnnual": 999}},
        headers=auth_headers(env["admin"]),
    )
    assert r.status_code == 200, r.text
    from sqlalchemy import select

    from app.models.event import Event

    ev = (
        (
            await db.execute(
                select(Event).where(Event.card_id == card.id, Event.event_type == "card.updated")
            )
        )
        .scalars()
        .all()
    )
    assert ev and ev[-1].data["changes"]["attributes"]["new"]["costTotalAnnual"] == 30


async def test_calculation_targeting_the_derived_total_is_refused(client, env):
    h = auth_headers(env["admin"])
    body = {
        "name": "c",
        "target_type_key": "Application",
        "target_field_key": "costTotalAnnual",
        "formula": "1",
    }
    r = await client.post("/api/v1/calculations", json=body, headers=h)
    assert r.status_code == 400 and r.json()["detail"] == "cost_total_is_derived"
    ok = await client.post(
        "/api/v1/calculations", json={**body, "target_type_key": "Provider"}, headers=h
    )
    assert ok.status_code == 201, ok.text
    r = await client.patch(
        f"/api/v1/calculations/{ok.json()['id']}",
        json={"target_type_key": "Application"},
        headers=h,
    )
    assert r.status_code == 400 and r.json()["detail"] == "cost_total_is_derived"


async def _legacy_calc(db, active: bool):
    from app.models.calculation import Calculation

    calc = Calculation(
        name="legacy",
        target_type_key="Application",
        target_field_key="costTotalAnnual",
        formula="7",
        is_active=active,
    )
    db.add(calc)
    await db.commit()
    return calc


async def test_activating_a_legacy_calculation_on_the_derived_total_is_refused(client, db, env):
    calc = await _legacy_calc(db, active=False)
    r = await client.post(
        f"/api/v1/calculations/{calc.id}/activate", headers=auth_headers(env["admin"])
    )
    assert r.status_code == 400 and r.json()["detail"] == "cost_total_is_derived"


async def test_bulk_recalculate_does_not_overwrite_the_derived_total(client, db, env):
    await _legacy_calc(db, active=True)
    card = await create_card(db, card_type="Application", name="A", user_id=env["admin"].id)
    db.add(CardCost(card_id=card.id, fiscal_year=CUR, items={"lic": {"amount": 30}}))
    await db.commit()
    h = auth_headers(env["admin"])
    r = await client.patch(f"/api/v1/cards/{card.id}", json={"description": "x"}, headers=h)
    assert r.json()["attributes"]["costTotalAnnual"] == 30
    r = await client.post("/api/v1/calculations/recalculate/Application", headers=h)
    assert r.status_code == 200, r.text
    r = await client.get(f"/api/v1/cards/{card.id}", headers=h)
    assert r.json()["attributes"]["costTotalAnnual"] == 30


async def test_calculation_reads_the_fresh_derived_total_on_a_card_save(client, db, env):
    from app.models.calculation import Calculation

    db.add(
        Calculation(
            name="double",
            target_type_key="Application",
            target_field_key="doubleCost",
            formula="data.costTotalAnnual * 2",
            is_active=True,
        )
    )
    card = await create_card(db, card_type="Application", name="A", user_id=env["admin"].id)
    db.add(CardCost(card_id=card.id, fiscal_year=CUR, items={"lic": {"amount": 30}}))
    await db.commit()
    r = await client.patch(
        f"/api/v1/cards/{card.id}",
        json={"description": "x"},
        headers=auth_headers(env["admin"]),
    )
    assert r.status_code == 200, r.text
    assert r.json()["attributes"]["doubleCost"] == 60


async def test_cost_write_rescores_data_quality(client, db, env):
    from sqlalchemy import update

    from app.models.card_type import CardType

    weighted = [
        {"section": "Cost", "fields": [{"key": "costTotalAnnual", "type": "cost", "weight": 1}]}
    ]
    await db.execute(
        update(CardType).where(CardType.key == "Application").values(fields_schema=weighted)
    )
    card = await create_card(db, card_type="Application", name="A", user_id=env["admin"].id)
    card.data_quality = 0
    card_id = card.id
    await db.commit()
    h = auth_headers(env["admin"])
    r = await client.put(
        f"/api/v1/cards/{card_id}/costs/{CUR}/items/lic", json={"amount": 30}, headers=h
    )
    assert r.status_code == 200, r.text
    assert (await client.get(f"/api/v1/cards/{card_id}", headers=h)).json()["data_quality"] > 0
