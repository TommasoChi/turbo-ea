from __future__ import annotations

from sqlalchemy import select

from app.models.card_cost import CardCost
from app.models.card_cost_history import CardCostHistory
from app.services import card_costs as svc
from app.services import cost_item_types as cat
from app.services.cost_history import sync_current_fy_history
from app.services.derived_writes import derived_maintenance
from app.services.fiscal_year import current_fiscal_year
from tests.conftest import create_card, create_card_type

COST_SCHEMA = [
    {"section": "Cost", "fields": [{"key": "costTotalAnnual", "type": "cost", "weight": 0}]}
]
CUR = current_fiscal_year(1)


async def _setup(db):
    await cat.create_item(db, "lic", "Licences", None)
    await create_card_type(db, key="Application", fields_schema=COST_SCHEMA)
    await create_card_type(db, key="Provider", label="Provider", fields_schema=COST_SCHEMA)


async def _history(db, card):
    q = select(CardCostHistory).where(CardCostHistory.card_id == card.id)
    return (await db.execute(q)).scalars().all()


async def test_history_sync_skips_cost_item_types_but_not_provider(db):
    await _setup(db)
    app = await create_card(db, card_type="Application", attributes={"costTotalAnnual": 50})
    prov = await create_card(db, card_type="Provider", attributes={"costTotalAnnual": 70})
    await sync_current_fy_history(db, app)
    await sync_current_fy_history(db, prov)
    assert await _history(db, app) == []
    assert [r.value for r in await _history(db, prov)] == [70]


async def test_recompute_all_follows_fiscal_year_start_and_counts_changes(db):
    await _setup(db)
    app = await create_card(db, card_type="Application", attributes={"costTotalAnnual": 0})
    # Only an older row: current year is a fallback, so the value follows the *current* FY.
    db.add(CardCost(card_id=app.id, fiscal_year=CUR - 1, items={"lic": {"amount": 40}}))
    await db.flush()
    assert await svc.recompute_all(db) == 1
    assert app.attributes["costTotalAnnual"] == 40
    assert await svc.recompute_all(db) == 0  # nothing differs: no write, count 0
    # A real FY row for CUR; shifting the start month so the current FY is CUR-1 (or CUR)
    # changes which row is "current".
    db.add(CardCost(card_id=app.id, fiscal_year=CUR, items={"lic": {"amount": 99}}))
    await db.flush()
    assert await svc.recompute_all(db) == 1
    assert app.attributes["costTotalAnnual"] == 99


async def test_recompute_all_ignores_other_types(db):
    await _setup(db)
    prov = await create_card(db, card_type="Provider", attributes={"costTotalAnnual": 70})
    assert await svc.recompute_all(db) == 0
    assert prov.attributes["costTotalAnnual"] == 70


async def test_recompute_all_in_derived_maintenance_does_not_bump_updated_at(db, card_update_sql):
    await _setup(db)
    app = await create_card(db, card_type="Application", attributes={"costTotalAnnual": 5})
    await db.commit()
    db.add(CardCost(card_id=app.id, fiscal_year=CUR, items={"lic": {"amount": 8}}))
    await db.commit()
    card_update_sql.clear()
    with derived_maintenance(db):
        assert await svc.recompute_all(db) == 1
        await db.flush()
    assert card_update_sql.statements, "no UPDATE: the assertion below would be vacuous"
    assert not card_update_sql.bumped()


async def test_direct_attribute_write_then_recompute_matches_section(db):
    """A ServiceNow-style assignment of the derived key is repaired by the writer's recompute."""
    await _setup(db)
    app = await create_card(db, card_type="Application", attributes={"costTotalAnnual": 0})
    db.add(CardCost(card_id=app.id, fiscal_year=CUR, items={"lic": {"amount": 12}}))
    await db.flush()
    app.attributes = {**app.attributes, "costTotalAnnual": 999}
    await svc.recompute_derived(db, app)
    assert app.attributes["costTotalAnnual"] == 12
