"""The licensing demo seeder: once by marker, every status present, Forecast licensed only."""

from __future__ import annotations

from sqlalchemy import delete, select

from app.models.card import Card
from app.models.card_license import CardLicense
from app.models.license_type import LicenseType
from app.services import card_licenses
from app.services.fiscal_year import current_fiscal_year, get_fiscal_year_start
from app.services.seed_demo_licensing import SEEDER_KEY, seed_licensing_demo_data
from app.services.seed_markers import demo_seed_completed
from tests.conftest import create_card, create_card_type

APPS = ("SAP S/4HANA", "SAP Ariba", "SAP SuccessFactors", "Siemens Teamcenter")
ITCS = ("PostgreSQL 16", "Datadog")


async def _demo_cards(db):
    await create_card_type(db, key="Application", label="Application")
    await create_card_type(db, key="ITComponent", label="IT Component")
    for name in APPS:
        await create_card(db, card_type="Application", name=name, attributes={})
    for name in ITCS:
        await create_card(db, card_type="ITComponent", name=name, attributes={})


async def test_seeds_once_by_marker(db):
    await _demo_cards(db)
    first = await seed_licensing_demo_data(db)
    assert not first.get("skipped")
    assert await demo_seed_completed(db, SEEDER_KEY)
    types = (await db.execute(select(LicenseType.key))).scalars().all()
    assert {"admin", "end_user", "dev"} <= set(types)
    models = (
        (await db.execute(select(Card.attributes).where(Card.type.in_(["Application"]))))
        .scalars()
        .all()
    )
    assert sum(1 for a in models if a.get("licensingModel")) == 4

    rows = (await db.execute(select(CardLicense))).scalars().all()
    second = await seed_licensing_demo_data(db)
    assert second["skipped"] is True
    assert len((await db.execute(select(CardLicense))).scalars().all()) == len(rows)


async def test_marker_holds_after_data_deleted(db):
    await _demo_cards(db)
    await seed_licensing_demo_data(db)
    await db.execute(delete(CardLicense))
    await db.execute(delete(LicenseType))
    await db.flush()
    again = await seed_licensing_demo_data(db)
    assert again["skipped"] is True
    assert (await db.execute(select(CardLicense))).scalars().all() == []
    assert (await db.execute(select(LicenseType))).scalars().all() == []


async def test_every_status_is_present_in_current_year(db):
    await _demo_cards(db)
    await seed_licensing_demo_data(db)
    start = await get_fiscal_year_start(db)
    fy = current_fiscal_year(start)
    seen = set()
    for card in (await db.execute(select(Card))).scalars():
        if card.type not in card_licenses.LICENSE_TYPES:
            continue
        year = await card_licenses.get_year(db, card, fy, start)
        for result in year.metrics:
            seen.add(result.status)
    assert seen == {"over", "approaching", "no_actual_data", "compliant"}


async def test_forecast_rows_have_no_actual(db):
    await _demo_cards(db)
    await seed_licensing_demo_data(db)
    start = await get_fiscal_year_start(db)
    fy = current_fiscal_year(start)
    rows = (await db.execute(select(CardLicense))).scalars().all()
    assert {r.fiscal_year for r in rows} == {fy - 2, fy - 1, fy, fy + 1}
    forecast = [r for r in rows if r.fiscal_year == fy + 1]
    assert forecast
    for row in forecast:
        for types in row.items.values():
            assert all(cell["actual"] is None for cell in types.values())


async def test_skips_without_demo_cards(db):
    result = await seed_licensing_demo_data(db)
    assert result["skipped"] is True
    assert (await db.execute(select(LicenseType))).scalars().all() == []
    assert not await demo_seed_completed(db, SEEDER_KEY)


async def test_card_with_existing_license_row_is_left_alone(db):
    await create_card_type(db, key="Application", label="Application")
    erp = await create_card(db, card_type="Application", name="SAP S/4HANA", attributes={})
    await create_card(db, card_type="Application", name="SAP Ariba", attributes={})
    year = current_fiscal_year(await get_fiscal_year_start(db))
    db.add(CardLicense(card_id=erp.id, fiscal_year=year, items={"users": {"x": {"licensed": 1}}}))
    await db.flush()
    result = await seed_licensing_demo_data(db)  # no uq_card_licenses_card_year crash
    assert result["skipped"] is False
    mine = (
        (await db.execute(select(CardLicense).where(CardLicense.card_id == erp.id))).scalars().all()
    )
    assert [(r.fiscal_year, r.items) for r in mine] == [(year, {"users": {"x": {"licensed": 1}}})]
    await db.refresh(erp)
    assert "licensingModel" not in erp.attributes
