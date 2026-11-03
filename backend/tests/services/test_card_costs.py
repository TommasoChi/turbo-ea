from __future__ import annotations

from datetime import date

import pytest

from app.models.card_cost import CardCost
from app.services import card_costs as svc
from app.services import cost_item_types as cat
from app.services.fiscal_year import current_fiscal_year
from tests.conftest import create_card, create_card_type

SM = 1
CUR = current_fiscal_year(SM)


async def _setup(db, archived=()):
    for key in ("lic", "ams", "old"):
        await cat.create_item(db, key, key.upper(), None)
    for key in archived:
        await cat.update_item(db, key, archived=True)
    await create_card_type(
        db,
        key="Application",
        fields_schema=[
            {"section": "Cost", "fields": [{"key": "costTotalAnnual", "type": "cost", "weight": 0}]}
        ],
    )
    return await create_card(db)


async def _row(db, card, year, items):
    db.add(CardCost(card_id=card.id, fiscal_year=year, items=items))
    await db.flush()


def _it(amount, renewal=None):
    return {"amount": amount, "renewal_date": renewal}


async def test_tco_counts_archived(db):
    card = await _setup(db, archived=("old",))
    await _row(db, card, CUR, {"lic": _it(10), "old": _it(5)})
    yc = await svc.get_year_costs(db, card.id, CUR, SM)
    assert yc.tco == 15
    assert {line.key: line.archived for line in yc.items} == {"lic": False, "old": True}
    assert yc.confirmed and yc.is_current and not yc.is_forecast


async def test_empty_row_does_not_fall_back_but_missing_row_does(db):
    card = await _setup(db)
    await _row(db, card, CUR - 1, {"lic": _it(10)})
    missing = await svc.get_year_costs(db, card.id, CUR, SM)
    assert (missing.tco, missing.confirmed, missing.fallback_from) == (10, False, CUR - 1)
    await _row(db, card, CUR, {})
    empty = await svc.get_year_costs(db, card.id, CUR, SM)
    assert (empty.tco, empty.confirmed, empty.fallback_from, empty.items) == (0, True, None, [])


async def test_forecast_and_past_without_row_stay_empty(db):
    card = await _setup(db)
    await _row(db, card, CUR, {"lic": _it(10)})
    await _row(db, card, CUR - 3, {"lic": _it(1)})
    fc = await svc.get_year_costs(db, card.id, CUR + 1, SM)
    assert fc.is_forecast and fc.tco == 0 and fc.fallback_from is None
    past = await svc.get_year_costs(db, card.id, CUR - 2, SM)
    assert past.tco == 0 and past.fallback_from is None


async def test_no_earlier_row_is_empty(db):
    card = await _setup(db)
    yc = await svc.get_year_costs(db, card.id, CUR, SM)
    assert yc.tco == 0 and yc.items == [] and yc.fallback_from is None and not yc.confirmed


async def test_fallback_renewal_shifted_by_skipped_years(db):
    card = await _setup(db)
    await _row(db, card, CUR - 1, {"lic": _it(10, "2026-12-31")})
    yc = await svc.get_year_costs(db, card.id, CUR, SM)
    assert yc.items[0].renewal_date == date(2027, 12, 31)
    await db.delete(await db.get(CardCost, (await _id(db, card, CUR - 1))))
    await db.flush()
    await _row(db, card, CUR - 2, {"lic": _it(10, "2026-12-31")})
    yc = await svc.get_year_costs(db, card.id, CUR, SM)
    assert yc.items[0].renewal_date == date(2028, 12, 31) and yc.fallback_from == CUR - 2


async def _id(db, card, year):
    from sqlalchemy import select

    return (
        await db.execute(
            select(CardCost.id).where(CardCost.card_id == card.id, CardCost.fiscal_year == year)
        )
    ).scalar_one()


async def test_window_six_years(db):
    card = await _setup(db)
    w = await svc.get_window(db, card.id, SM)
    assert [y.fiscal_year for y in w] == list(range(CUR - 4, CUR + 2))


async def test_upsert_in_fallback_materialises_set_then_applies(db):
    card = await _setup(db)
    await _row(db, card, CUR - 1, {"lic": _it(10), "ams": _it(4)})
    yc = await svc.upsert_item(db, card.id, CUR, "lic", 12, None)
    assert yc.confirmed and yc.fallback_from is None
    assert {line.key: line.amount for line in yc.items} == {"lic": 12, "ams": 4}
    assert yc.tco == 16


async def test_confirm_year_stores_unchanged(db):
    card = await _setup(db)
    await _row(db, card, CUR - 1, {"lic": _it(10)})
    yc = await svc.confirm_year(db, card.id, CUR)
    assert yc.confirmed and yc.tco == 10
    again = await svc.get_year_costs(db, card.id, CUR, SM)
    assert again.confirmed and again.tco == 10


async def test_archived_new_item_refused_existing_editable(db):
    card = await _setup(db, archived=("old",))
    with pytest.raises(svc.CostError) as e:
        await svc.upsert_item(db, card.id, CUR, "old", 5, None)
    assert e.value.code == "archived_item"
    await _row(db, card, CUR, {"old": _it(5)})
    yc = await svc.upsert_item(db, card.id, CUR, "old", 7, None)
    assert yc.tco == 7


async def test_unknown_item_and_negative_amount(db):
    card = await _setup(db)
    with pytest.raises(svc.CostError) as e:
        await svc.upsert_item(db, card.id, CUR, "zzz", 5, None)
    assert e.value.code == "unknown_item"
    with pytest.raises(svc.CostError) as e:
        await svc.upsert_item(db, card.id, CUR, "lic", -1, None)
    assert e.value.code == "invalid_amount"


async def test_put_window(db):
    card = await _setup(db)
    for year in (CUR - 6, CUR + 2):
        with pytest.raises(svc.CostError) as e:
            await svc.upsert_item(db, card.id, year, "lic", 1, None)
        assert e.value.code == "year_out_of_range"
    await svc.upsert_item(db, card.id, CUR - 5, "lic", 1, None)
    await svc.upsert_item(db, card.id, CUR + 1, "lic", 1, date(2030, 1, 1))


async def test_get_year_row_outside_window(db):
    card = await _setup(db)
    await _row(db, card, CUR - 5, {"lic": _it(3)})
    assert (await svc.get_year_row(db, card.id, CUR - 5, SM)).tco == 3
    assert (await svc.get_year_row(db, card.id, CUR - 9, SM)).tco == 0


async def test_delete_item(db):
    card = await _setup(db)
    await _row(db, card, CUR, {"lic": _it(3), "ams": _it(2)})
    await svc.delete_item(db, card.id, CUR, "lic")
    assert (await svc.get_year_costs(db, card.id, CUR, SM)).tco == 2


async def test_copy_to_forecast_overwrites_and_shifts(db):
    card = await _setup(db, archived=("old",))
    await _row(db, card, CUR, {"lic": _it(10, "2026-06-30"), "old": _it(5)})
    await _row(db, card, CUR + 1, {"lic": _it(99)})
    yc = await svc.copy_to_forecast(db, card.id, CUR, "lic")
    assert yc.is_forecast and yc.items[0].amount == 10
    assert yc.items[0].renewal_date == date(2027, 6, 30)
    yc = await svc.copy_to_forecast(db, card.id, CUR, "old")
    assert yc.tco == 15


async def test_copy_to_forecast_feb29(db):
    card = await _setup(db)
    await _row(db, card, CUR, {"lic": _it(1, "2028-02-29")})
    yc = await svc.copy_to_forecast(db, card.id, CUR, "lic")
    assert yc.items[0].renewal_date == date(2029, 2, 28)


async def test_copy_to_forecast_missing_source(db):
    card = await _setup(db)
    with pytest.raises(svc.CostError) as e:
        await svc.copy_to_forecast(db, card.id, CUR, "lic")
    assert e.value.code == "unknown_item"


async def test_recompute_derived_uses_fallback_tco(db):
    card = await _setup(db)
    card.attributes = {"x": 1, "costTotalAnnual": 999}
    await _row(db, card, CUR - 1, {"lic": _it(10), "ams": _it(4)})
    await svc.recompute_derived(db, card)
    assert card.attributes == {"x": 1, "costTotalAnnual": 14}


async def test_delete_item_outside_put_window(db):
    card = await _setup(db)
    await _row(db, card, CUR - 8, {"lic": _it(3), "ams": _it(2)})
    await svc.delete_item(db, card.id, CUR - 8, "lic")
    assert (await svc.get_year_row(db, card.id, CUR - 8, SM)).tco == 2


async def test_editable_is_get_or_create_and_keeps_existing_items(db):
    from sqlalchemy import func, select

    card = await _setup(db)
    await _row(db, card, CUR - 1, {"lic": _it(10)})
    first = await svc._editable(db, card.id, CUR, SM)
    assert first.items["lic"]["amount"] == 10
    first.items = {**first.items, "ams": _it(4)}
    await db.flush()
    second = await svc._editable(db, card.id, CUR, SM)
    assert second.id == first.id and set(second.items) == {"lic", "ams"}
    n = await db.scalar(
        select(func.count())
        .select_from(CardCost)
        .where(CardCost.card_id == card.id, CardCost.fiscal_year == CUR)
    )
    assert n == 1
