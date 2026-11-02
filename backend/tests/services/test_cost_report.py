"""cards_with_cost: the one selection rule behind the cost endpoints."""

from __future__ import annotations

import pytest
from sqlalchemy import select

from app.models.card_cost_history import CardCostHistory
from app.models.card_type import CardType
from app.models.user import User
from app.services.card_read_scope import CardReadScope
from app.services.cost_report import cards_with_cost, cards_with_cost_for_types, parse_type_keys
from app.services.fiscal_year import current_fiscal_year
from app.services.permission_service import PermissionService
from tests.conftest import create_card, create_card_type, create_role, create_user

FY = current_fiscal_year(1)
FIELD = "costTotalAnnual"


def _d(year: int, month: int = 6, day: int = 15) -> str:
    return f"{year:04d}-{month:02d}-{day:02d}"


async def _admin(db) -> User:
    await create_role(db, key="admin", permissions={"*": True})
    await create_card_type(db, key="Application")
    return await create_user(db, email="admin@test.com", role="admin")


async def _app(db, name, cost=None, lifecycle=None, status="ACTIVE"):
    attrs = {} if cost is None else {FIELD: cost}
    return await create_card(
        db, name=name, attributes=attrs, lifecycle=lifecycle or {}, status=status
    )


async def _hist(db, card, year, value, field=FIELD):
    db.add(CardCostHistory(card_id=card.id, fiscal_year=year, field_key=field, value=value))
    await db.flush()


async def _run(db, user, year, field=FIELD):
    scope = await CardReadScope.load(db, user)
    rows = await cards_with_cost(db, scope, "Application", field, year, FY, 1)
    return {c.name: v for c, v in rows}


async def test_current_year_uses_live_attributes_of_cards_live_now(db):
    admin = await _admin(db)
    await _app(db, "Running", 200)
    await _app(db, "No cost")
    stale = await _app(db, "History only")
    await _hist(db, stale, FY, 999)  # history is ignored for the current year

    assert await _run(db, admin, FY) == {"Running": 200}


async def test_current_year_leaves_out_a_card_retired_before_it(db):
    admin = await _admin(db)
    await _app(db, "Retired", 1000, {"endOfLife": _d(FY - 1)})
    await _app(db, "Running", 5)

    assert await _run(db, admin, FY) == {"Running": 5}


async def test_past_year_includes_a_card_retired_since_if_it_has_a_cost_for_that_year(db):
    admin = await _admin(db)
    retired = await _app(db, "Retired", 0, {"endOfLife": _d(FY - 1)})
    await _hist(db, retired, FY - 2, 700)

    assert await _run(db, admin, FY - 2) == {"Retired": 700}


async def test_forecast_year_includes_a_card_that_becomes_active_next_year(db):
    admin = await _admin(db)
    upcoming = await _app(db, "Upcoming", 0, {"active": _d(FY + 1, 1, 1)})
    await _hist(db, upcoming, FY + 1, 300)

    assert await _run(db, admin, FY + 1) == {"Upcoming": 300}


async def test_a_year_without_a_row_or_with_value_zero_lists_nothing(db):
    admin = await _admin(db)
    await _app(db, "No row", 50)
    zero = await _app(db, "Zero", 50)
    await _hist(db, zero, FY - 1, 0)

    assert await _run(db, admin, FY - 1) == {}


async def test_archived_cards_never_appear(db):
    admin = await _admin(db)
    gone = await _app(db, "Gone", 10, status="ARCHIVED")
    await _hist(db, gone, FY - 1, 10)
    await _hist(db, gone, FY, 10)

    assert await _run(db, admin, FY - 1) == {}
    assert await _run(db, admin, FY) == {}


async def test_a_card_the_reader_may_not_see_is_left_out(db):
    await _admin(db)
    await create_role(db, key="viewer", permissions={"inventory.view": True}, is_system=False)
    viewer = await create_user(db, email="viewer@test.com", role="viewer")
    card = await _app(db, "Secret", 10)
    await _hist(db, card, FY - 1, 10)

    assert await _run(db, viewer, FY - 1) == {"Secret": 10}

    ct = (await db.execute(select(CardType).where(CardType.key == "Application"))).scalar_one()
    ct.role_permissions = {"viewer": {"inventory.view": False}}
    await db.flush()
    PermissionService.invalidate_type_permission_cache()

    assert await _run(db, viewer, FY - 1) == {}
    assert await _run(db, viewer, FY) == {}


async def test_only_the_requested_field_counts(db):
    admin = await _admin(db)
    card = await _app(db, "Two fields", 10)
    await _hist(db, card, FY - 1, 40, field="costTotalAnnual")
    await _hist(db, card, FY - 1, 90, field="costLicense")

    assert await _run(db, admin, FY - 1, field="costLicense") == {"Two fields": 90}
    assert await _run(db, admin, FY - 1) == {"Two fields": 40}


async def _two_types(db):
    admin = await _admin(db)
    await create_card_type(db, key="ITComponent", label="IT Component")
    await _app(db, "App", 10)
    await create_card(
        db, card_type="ITComponent", name="Comp", attributes={FIELD: 20}, lifecycle={}
    )
    return admin


async def test_cards_with_cost_for_types_joins_two_types(db):
    admin = await _two_types(db)
    scope = await CardReadScope.load(db, admin)

    rows = await cards_with_cost_for_types(
        db, scope, ["Application", "ITComponent"], FIELD, FY, FY, 1
    )

    assert [(c.name, v) for c, v in rows] == [("App", 10), ("Comp", 20)]


async def test_hidden_type_is_omitted(db):
    await _two_types(db)
    await create_role(db, key="viewer", permissions={"inventory.view": True}, is_system=False)
    viewer = await create_user(db, email="viewer@test.com", role="viewer")
    ct = (await db.execute(select(CardType).where(CardType.key == "ITComponent"))).scalar_one()
    ct.role_permissions = {"viewer": {"inventory.view": False}}
    await db.flush()
    PermissionService.invalidate_type_permission_cache()
    scope = await CardReadScope.load(db, viewer)

    rows = await cards_with_cost_for_types(
        db, scope, ["Application", "ITComponent"], FIELD, FY, FY, 1
    )

    assert [c.name for c, _ in rows] == ["App"]


@pytest.mark.parametrize("raw", ["Application,", "", "Application,,ITComponent", " , "])
def test_parse_type_keys_rejects_empty_entry(raw):
    with pytest.raises(ValueError):
        parse_type_keys(raw)


def test_parse_type_keys_rejects_duplicate():
    with pytest.raises(ValueError):
        parse_type_keys("Application,Application")


def test_parse_type_keys_splits_and_strips():
    assert parse_type_keys("Application, ITComponent") == ["Application", "ITComponent"]


def test_parse_type_keys_accepts_the_cap():
    assert parse_type_keys("a,b,c,d,e") == ["a", "b", "c", "d", "e"]


def test_parse_type_keys_refuses_more_than_the_cap():
    with pytest.raises(ValueError, match="at most 5"):
        parse_type_keys("a,b,c,d,e,f")
