"""Workspace transfer carries the cost-item catalogue and the per-card cost rows."""

from __future__ import annotations

from sqlalchemy import delete, select

from app.models.card import Card
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


async def test_import_matches_an_existing_row_on_card_and_year(db):
    """A target that already holds a row for the card/year (own primary key) takes the
    bundle's items instead of failing the whole apply on ``uq_card_costs_card_year``."""
    user = await create_user(db, email="cost-ws2@test.com", role="admin")
    await create_card_type(db, key="Application", label="Application")
    card = await create_card(db, card_type="Application", name="Billing", user_id=user.id)
    card_id = card.id
    db.add(CostItemType(key="licences", label="Licences"))
    db.add(CardCost(card_id=card_id, fiscal_year=2026, items={"licences": {"amount": 5}}))
    await db.flush()
    raw = await build_bundle(db)

    await db.execute(delete(CardCost))
    db.add(CardCost(card_id=card_id, fiscal_year=2026, items={"licences": {"amount": 1}}))
    await db.flush()

    result = await apply_bundle(db, parse_bundle(raw), user)
    assert result.total_failed == 0, result.as_dict()
    section = next(s for s in result.sections if s.sheet == "CardCosts")
    assert (section.created, section.updated) == (0, 1)

    db.expire_all()
    rows = (await db.execute(select(CardCost).where(CardCost.card_id == card_id))).scalars().all()
    assert [r.items for r in rows] == [{"licences": {"amount": 5}}]


async def test_cardcosts_only_import_recomputes_the_derived_total(db):
    from app.services.fiscal_year import current_fiscal_year
    from app.services.workspace_io import apply_selected

    user = await create_user(db, email="cost-ws3@test.com", role="admin")
    await create_card_type(
        db,
        key="Application",
        label="Application",
        fields_schema=[
            {"section": "Cost", "fields": [{"key": "costTotalAnnual", "type": "cost", "weight": 0}]}
        ],
    )
    card = await create_card(db, card_type="Application", name="Billing", user_id=user.id)
    card_id = card.id
    db.add(CostItemType(key="licences", label="Licences"))
    db.add(
        CardCost(
            card_id=card_id,
            fiscal_year=current_fiscal_year(1),
            items={"licences": {"amount": 5}},
        )
    )
    await db.flush()
    raw = await build_bundle(db)
    await db.execute(delete(CardCost))
    await db.flush()

    result = await apply_selected(db, parse_bundle(raw), user, sheets={"CardCosts"}, dry_run=False)
    assert result.total_failed == 0, result.as_dict()
    db.expire_all()
    stored = (await db.execute(select(Card.attributes).where(Card.id == card_id))).scalar_one()
    assert stored["costTotalAnnual"] == 5


async def test_cardcosts_only_import_keeps_a_live_provider_and_drops_a_missing_one(db):
    import uuid

    from app.services.workspace_io import apply_selected

    user = await create_user(db, email="cost-ws4@test.com", role="admin")
    await create_card_type(db, key="Application", label="Application")
    await create_card_type(db, key="Provider", label="Provider")
    card = await create_card(db, card_type="Application", name="Billing", user_id=user.id)
    provider = await create_card(db, card_type="Provider", name="Acme", user_id=user.id)
    card_id, provider_id, gone = card.id, str(provider.id), str(uuid.uuid4())
    db.add_all(
        [
            CostItemType(key="licences", label="Licences"),
            CostItemType(key="support", label="Support"),
            CardCost(
                card_id=card_id,
                fiscal_year=2026,
                items={
                    "licences": {"amount": 5, "provider_id": provider_id},
                    "support": {"amount": 7, "provider_id": gone},
                },
            ),
        ]
    )
    await db.flush()
    raw = await build_bundle(db)
    await db.execute(delete(CardCost))
    await db.flush()

    bundle = parse_bundle(raw)
    # the provider is on the target but nothing in the bundle maps it
    bundle.sheets["Cards"] = [r for r in bundle.sheets["Cards"] if r["type"] != "Provider"]
    result = await apply_selected(db, bundle, user, sheets={"CardCosts"}, dry_run=False)
    assert result.total_failed == 0, result.as_dict()
    db.expire_all()
    row = (await db.execute(select(CardCost).where(CardCost.card_id == card_id))).scalar_one()
    assert row.items["licences"]["provider_id"] == provider_id
    assert "provider_id" not in row.items["support"]
    assert row.items["support"]["amount"] == 7
