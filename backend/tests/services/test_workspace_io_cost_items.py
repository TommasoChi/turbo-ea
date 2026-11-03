"""Workspace transfer carries the cost-item catalogue and the per-card cost rows."""

from __future__ import annotations

from sqlalchemy import delete, select

from app.models.card_cost import CardCost
from app.models.cost_item_type import CostItemType
from app.services.workspace_io import apply_bundle, build_bundle, parse_bundle
from tests.conftest import create_card, create_card_type, create_user


async def test_cost_items_roundtrip(db):
    user = await create_user(db, email="cost-ws@test.com", role="admin")
    await create_card_type(db, key="Application", label="Application")
    card = await create_card(db, card_type="Application", name="Billing", user_id=user.id)
    db.add_all(
        [
            CostItemType(
                key="licences", label="Licences", sort_order=0, translations={"it": "Licenze"}
            ),
            CostItemType(key="old", label="Old", sort_order=1, archived=True),
            CardCost(
                card_id=card.id,
                fiscal_year=2026,
                items={"licences": {"amount": 120.5, "renewal_date": "2027-01-31"}},
            ),
        ]
    )
    await db.flush()

    raw = await build_bundle(db)

    await db.execute(delete(CardCost))
    await db.execute(delete(CostItemType))
    await db.flush()

    result = await apply_bundle(db, parse_bundle(raw), user)
    assert result.total_failed == 0, result.as_dict()

    types = {t.key: t for t in (await db.execute(select(CostItemType))).scalars().all()}
    assert types["licences"].translations == {"it": "Licenze"}
    assert types["old"].archived is True
    row = (await db.execute(select(CardCost).where(CardCost.card_id == card.id))).scalar_one()
    assert row.fiscal_year == 2026
    assert row.items == {"licences": {"amount": 120.5, "renewal_date": "2027-01-31"}}

    again = await apply_bundle(db, parse_bundle(raw), user)
    assert next(s for s in again.sections if s.sheet == "CardCosts").created == 0
