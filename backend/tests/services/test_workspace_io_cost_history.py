"""Workspace transfer carries the past-year cost history of a card."""

from __future__ import annotations

from sqlalchemy import delete, select

from app.models.card_cost_history import CardCostHistory
from app.services.workspace_io import apply_bundle, build_bundle, parse_bundle
from tests.conftest import create_card, create_card_type, create_user


async def _seed(db, email):
    user = await create_user(db, email=email, role="admin")
    await create_card_type(db, key="Initiative", label="Initiative")
    card = await create_card(db, card_type="Initiative", name="Migrate", user_id=user.id)
    db.add_all(
        [
            CardCostHistory(card_id=card.id, fiscal_year=2024, field_key="costBudget", value=10.5),
            CardCostHistory(card_id=card.id, fiscal_year=2024, field_key="costActual", value=9),
            CardCostHistory(card_id=card.id, fiscal_year=2025, field_key="costBudget", value=12),
        ]
    )
    await db.flush()
    return user, card


async def test_round_trip_carries_the_past_year_costs(db):
    user, card = await _seed(db, "ch-ws@test.com")
    raw = await build_bundle(db)

    # Wipe the inventory so the card gets a NEW id on import.
    await db.execute(delete(CardCostHistory))
    await db.execute(delete(type(card)))
    await db.flush()

    result = await apply_bundle(db, parse_bundle(raw), user)
    assert result.total_failed == 0, result.as_dict()

    new_card = (
        await db.execute(select(type(card)).where(type(card).name == "Migrate"))
    ).scalar_one()
    rows = (
        await db.execute(select(CardCostHistory).where(CardCostHistory.card_id == new_card.id))
    ).scalars()
    assert {(r.fiscal_year, r.field_key, r.value) for r in rows} == {
        (2024, "costBudget", 10.5),
        (2024, "costActual", 9),
        (2025, "costBudget", 12),
    }


async def test_reimport_creates_no_duplicate_rows(db):
    user, _ = await _seed(db, "ch-ws2@test.com")
    raw = await build_bundle(db)
    again = await apply_bundle(db, parse_bundle(raw), user)
    assert again.total_failed == 0, again.as_dict()
    section = next(s for s in again.sections if s.sheet == "CardCostHistory")
    assert section.created == 0
