from __future__ import annotations

from app.models.card_cost import CardCost
from app.services import yearly_rows as yr
from app.services.fiscal_year import current_fiscal_year
from tests.conftest import create_card

SM = 1
CUR = current_fiscal_year(SM)


def _carry(items: dict, years: int) -> dict:
    return {k: {**v, "carried": years} for k, v in items.items()}


def test_row_present_is_confirmed_even_empty():
    assert yr.resolve_year({}, (CUR - 1, {"a": {}}), CUR, CUR, _carry) == ({}, True, None)


def test_only_current_year_falls_back_with_carry():
    prev = (CUR - 2, {"a": {"x": 1}})
    assert yr.resolve_year(None, prev, CUR, CUR, _carry) == (
        {"a": {"x": 1, "carried": 2}},
        False,
        CUR - 2,
    )
    assert yr.resolve_year(None, prev, CUR + 1, CUR, _carry) == ({}, False, None)
    assert yr.resolve_year(None, prev, CUR - 1, CUR, _carry) == ({}, False, None)
    assert yr.resolve_year(None, None, CUR, CUR, _carry) == ({}, False, None)


def test_in_window_bounds():
    assert yr.in_window(CUR - 5, SM) and yr.in_window(CUR + 1, SM)
    assert not yr.in_window(CUR - 6, SM) and not yr.in_window(CUR + 2, SM)


def test_window_years_is_cur_minus_four_to_forecast():
    assert list(yr.window_years(CUR)) == list(range(CUR - 4, CUR + 2))


async def test_editable_materialises_the_carried_set(db):
    card = await create_card(db)
    db.add(CardCost(card_id=card.id, fiscal_year=CUR - 1, items={"a": {"v": 1}}))
    await db.flush()
    r = await yr.editable(db, CardCost, card.id, CUR, SM, _carry)
    assert r.fiscal_year == CUR and r.items == {"a": {"v": 1, "carried": 1}}
    again = await yr.editable(db, CardCost, card.id, CUR, SM, _carry)
    assert again is r
    assert (await yr.fallback_row(db, CardCost, card.id, CUR)).fiscal_year == CUR - 1
