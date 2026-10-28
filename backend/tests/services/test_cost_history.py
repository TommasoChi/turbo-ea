import pytest
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.models.card_cost_history import CardCostHistory
from app.services.cost_history import sync_current_fy_history
from app.services.fiscal_year import current_fiscal_year, get_fiscal_year_start
from tests.conftest import auth_headers, create_card, create_card_type, create_role, create_user

pytestmark = pytest.mark.anyio


async def test_a_row_is_unique_per_card_fiscal_year_field(db):
    card = await create_card(db, card_type="Application", name="ERP")
    db.add(
        CardCostHistory(card_id=card.id, fiscal_year=2025, field_key="costTotalAnnual", value=100)
    )
    await db.flush()
    db.add(
        CardCostHistory(card_id=card.id, fiscal_year=2025, field_key="costTotalAnnual", value=200)
    )
    with pytest.raises(IntegrityError):
        await db.flush()


async def _history_rows(db, card_id):
    return (
        (await db.execute(select(CardCostHistory).where(CardCostHistory.card_id == card_id)))
        .scalars()
        .all()
    )


async def test_syncs_a_cost_field_to_the_current_fiscal_year(db):
    await create_card_type(
        db,
        key="Application",
        fields_schema=[
            {"section": "Cost", "fields": [{"key": "costTotalAnnual", "type": "cost", "weight": 0}]}
        ],
    )
    card = await create_card(
        db, card_type="Application", name="ERP", attributes={"costTotalAnnual": 500}
    )
    await sync_current_fy_history(db, card)
    rows = await _history_rows(db, card.id)
    fy = current_fiscal_year(await get_fiscal_year_start(db))
    assert len(rows) == 1
    assert rows[0].fiscal_year == fy
    assert rows[0].field_key == "costTotalAnnual"
    assert rows[0].value == 500


async def test_upserting_one_field_does_not_touch_another_fields_row(db):
    await create_card_type(
        db,
        key="Application",
        fields_schema=[
            {
                "section": "Cost",
                "fields": [
                    {"key": "costTotalAnnual", "type": "cost", "weight": 0},
                    {"key": "infrastruttureCost", "type": "cost", "weight": 0},
                ],
            }
        ],
    )
    card = await create_card(
        db,
        card_type="Application",
        name="ERP",
        attributes={"costTotalAnnual": 500, "infrastruttureCost": 100},
    )
    await sync_current_fy_history(db, card)
    card.attributes = {"costTotalAnnual": 999, "infrastruttureCost": 100}
    await sync_current_fy_history(db, card)
    rows = {r.field_key: r.value for r in await _history_rows(db, card.id)}
    assert rows == {"costTotalAnnual": 999, "infrastruttureCost": 100}


async def test_clearing_a_cost_field_zeroes_its_current_year_history_row(db):
    await create_card_type(
        db,
        key="Application",
        fields_schema=[
            {"section": "Cost", "fields": [{"key": "costTotalAnnual", "type": "cost", "weight": 0}]}
        ],
    )
    card = await create_card(
        db, card_type="Application", name="ERP", attributes={"costTotalAnnual": 500}
    )
    await sync_current_fy_history(db, card)
    card.attributes = {}
    await sync_current_fy_history(db, card)
    rows = await _history_rows(db, card.id)
    assert len(rows) == 1
    assert rows[0].value == 0


@pytest.fixture
async def env(db):
    await create_role(db, key="admin", label="Admin", permissions={"*": True})
    admin = await create_user(db, email="admin@cost-history-sync.com", role="admin")
    await create_card_type(
        db,
        key="Application",
        fields_schema=[
            {"section": "Cost", "fields": [{"key": "costTotalAnnual", "type": "cost", "weight": 0}]}
        ],
    )
    return {"admin": admin}


async def test_update_card_calls_the_sync_hook(client, db, env):
    """Integration check that the hook actually fires from the write path,
    not just when called directly — covers the card_write_service.py wiring."""
    admin = env["admin"]
    card = await create_card(db, card_type="Application", name="ERP", user_id=admin.id)
    resp = await client.patch(
        f"/api/v1/cards/{card.id}",
        json={"attributes": {"costTotalAnnual": 42}},
        headers=auth_headers(admin),
    )
    assert resp.status_code == 200
    rows = await _history_rows(db, card.id)
    assert len(rows) == 1
    assert rows[0].value == 42
