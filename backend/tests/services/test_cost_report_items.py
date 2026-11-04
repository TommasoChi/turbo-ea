"""``item_costs_by_card``: the batched read agrees with ``card_costs.get_year_row``."""

from __future__ import annotations

from sqlalchemy import event

from app.models.card_cost import CardCost
from app.services import card_costs, cost_item_types
from app.services.cost_report import item_costs_by_card
from app.services.fiscal_year import current_fiscal_year
from tests.conftest import create_card, create_card_type

CUR = current_fiscal_year(1)


async def _setup(db):
    await create_card_type(db, key="Application")
    await cost_item_types.create_item(db, "lic", "Licences")
    await cost_item_types.create_item(db, "old", "Old")
    cards = [await create_card(db, card_type="Application", name=f"A{i}") for i in range(4)]
    rows = [
        (0, CUR, {"lic": {"amount": 10, "renewal_date": "2024-05-01"}}),
        (1, CUR - 2, {"lic": {"amount": 5, "renewal_date": "2024-05-01"}}),
        (2, CUR - 2, {"lic": {"amount": 5, "renewal_date": None}}),
        (2, CUR, {}),
    ]
    for i, fy, items in rows:
        db.add(CardCost(card_id=cards[i].id, fiscal_year=fy, items=items))
    await db.flush()
    await cost_item_types.update_item(db, "old", archived=True)
    return cards


async def test_batched_matches_per_card_for_every_year(db):
    cards = await _setup(db)
    ids = [c.id for c in cards]
    for fy in (CUR - 2, CUR - 1, CUR, CUR + 1):
        batched = await item_costs_by_card(db, ids, fy, 1)
        for c in cards:
            assert batched[c.id] == await card_costs.get_year_row(db, c.id, fy, 1)


async def test_query_count_does_not_grow_with_cards(db):
    cards = await _setup(db)
    count = 0

    def bump(*_):
        nonlocal count
        count += 1

    sync_engine = db.bind.sync_engine if hasattr(db.bind, "sync_engine") else db.bind
    event.listen(sync_engine, "before_cursor_execute", bump)
    try:
        await item_costs_by_card(db, [cards[0].id], CUR, 1)
        one = count
        count = 0
        await item_costs_by_card(db, [c.id for c in cards], CUR, 1)
        assert count == one
    finally:
        event.remove(sync_engine, "before_cursor_execute", bump)


async def test_item_types_components_are_the_catalogue_archived_included(db):
    from app.services.cost_components import cost_components

    await _setup(db)
    await create_card_type(db, key="ITComponent")
    assert await cost_components(db, ["Application"], "costTotalAnnual") == ["lic", "old"]
    assert await cost_components(db, ["Application", "ITComponent"], "costTotalAnnual") == [
        "lic",
        "old",
    ]
