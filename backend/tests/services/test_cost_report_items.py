"""``item_costs_by_card``: the batched read agrees with ``card_costs.get_year_row``."""

from __future__ import annotations

from sqlalchemy import event

from app.models.card_cost import CardCost
from app.services import card_costs, cost_item_types
from app.services.cost_report import item_costs_by_card
from app.services.fiscal_year import current_fiscal_year
from tests.conftest import create_card, create_card_type, create_role, create_user

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


# ── mutation hardening: the selection rule of the item-based cost reports ─────────────────────


def test_uses_items_needs_an_item_type_and_the_derived_field():
    from app.services.cost_report import uses_items

    assert uses_items("Application", "costTotalAnnual") is True
    assert uses_items("ITComponent", "costTotalAnnual") is True
    assert uses_items("Application", "other") is False
    assert uses_items("Process", "costTotalAnnual") is False


async def test_is_item_field_is_the_total_or_a_catalogue_key_of_an_item_type(db):
    from app.services.cost_report import is_item_field

    await cost_item_types.create_item(db, "lic", "Licences")
    assert await is_item_field(db, "Application", "costTotalAnnual") is True
    assert await is_item_field(db, "Application", "lic") is True
    assert await is_item_field(db, "Application", "nope") is False
    assert await is_item_field(db, "Process", "lic") is False


async def test_item_costs_query_filters_on_the_cards_and_the_year(db, monkeypatch):
    from sqlalchemy.dialects import postgresql

    cards = await _setup(db)
    seen = []
    real = db.execute

    async def spy(stmt, *a, **kw):
        seen.append(str(stmt.compile(dialect=postgresql.dialect())))
        return await real(stmt, *a, **kw)

    monkeypatch.setattr(db, "execute", spy)
    await item_costs_by_card(db, [cards[0].id], CUR, 1)
    await item_costs_by_card(db, [cards[0].id], CUR - 2, 1)
    seen = [s for s in seen if "FROM card_costs" in s]
    current, past = seen[0], seen[-1]
    assert "card_costs.card_id IN" in current and "card_costs.fiscal_year <=" in current
    assert "card_costs.card_id IN" in past and "card_costs.fiscal_year =" in past
    assert "<=" not in past


async def _item_world(db):
    await create_card_type(db, key="Application")
    await create_card_type(db, key="Process")
    await cost_item_types.create_item(db, "lic", "Licences")
    await cost_item_types.create_item(db, "ams", "AMS")
    live = await create_card(db, card_type="Application", name="live")
    retired = await create_card(
        db,
        card_type="Application",
        name="retired",
        lifecycle={"active": "2000-01-01", "endOfLife": "2001-01-01"},
    )
    archived = await create_card(db, card_type="Application", name="archived", status="ARCHIVED")
    other_type = await create_card(db, card_type="Process", name="process")
    for c in (live, retired, archived, other_type):
        for fy in (CUR, CUR - 1):
            db.add(
                CardCost(
                    card_id=c.id,
                    fiscal_year=fy,
                    items={
                        "lic": {"amount": 10, "renewal_date": None},
                        "ams": {"amount": 3, "renewal_date": None},
                    },
                )
            )
    await db.flush()
    return live, retired, archived, other_type


async def test_item_cards_current_year_lists_live_active_cards_of_the_type(db):
    from app.services.card_read_scope import CardReadScope
    from app.services.cost_report import _item_cards

    live, *_ = await _item_world(db)
    scope = CardReadScope.everything()
    rows = await _item_cards(db, scope, "Application", CUR, CUR, 1)
    assert [(c.id, amount) for c, amount in rows] == [(live.id, 13)]
    rows = await _item_cards(db, scope, "Application", CUR, CUR, 1, line="ams")
    assert [(c.id, amount) for c, amount in rows] == [(live.id, 3)]


async def test_item_cards_other_year_ignores_the_lifecycle_but_not_status_or_type(db):
    from app.services.card_read_scope import CardReadScope
    from app.services.cost_report import _item_cards

    live, retired, *_ = await _item_world(db)
    rows = await _item_cards(db, CardReadScope.everything(), "Application", CUR - 1, CUR, 1)
    assert {c.id: amount for c, amount in rows} == {live.id: 13, retired.id: 13}


async def test_item_cards_follow_the_module_read_scope(db):
    from app.services.card_read_scope import CardReadScope
    from app.services.cost_report import _item_cards

    live, *_ = await _item_world(db)
    await create_role(db, key="costonly", label="Cost only", permissions={"costs.view": True})
    user = await create_user(db, email="costonly@test.com", role="costonly")
    scope = await CardReadScope.load(db, user)
    assert scope.base_view is False
    rows = await _item_cards(db, scope, "Application", CUR, CUR, 1)
    assert [c.id for c, _ in rows] == [live.id]
