"""The base demo seeder records cost items; the total on the card is derived from them."""

from __future__ import annotations

from sqlalchemy import select

from app.models.card import Card
from app.models.card_cost import CardCost
from app.models.cost_item_type import CostItemType
from app.services.cost_item_types import seed_default_items
from app.services.fiscal_year import current_fiscal_year
from app.services.seed_demo import _demo_cost_items, _seed_demo_costs
from tests.conftest import create_card, create_card_type

SCHEMA = [{"section": "Cost", "fields": [{"key": "costTotalAnnual", "type": "cost"}]}]


def amounts_of(row):
    return {k: v["amount"] for k, v in row.items.items()}


def test_demo_split_adds_back_to_the_total():
    for total in (1200000, 4000, 18000, 7):
        items = _demo_cost_items(total)
        assert sum(i["amount"] for i in items.values()) == total


async def test_demo_costs_become_items_and_derived_total(db):
    await create_card_type(db, key="Application", fields_schema=SCHEMA)
    card = await create_card(db, card_type="Application", name="Erp", attributes={})
    card_id = card.id
    await _seed_demo_costs(db, {card_id: 1200000})
    db.expire_all()

    row = (await db.execute(select(CardCost).where(CardCost.card_id == card_id))).scalar_one()
    assert row.fiscal_year == current_fiscal_year(1)
    assert (await db.get(Card, card_id)).attributes["costTotalAnnual"] == 1200000
    assert amounts_of(row) == {
        "softwareLicensingCost": 600000,
        "applicationManagementServicesCost": 360000,
        "infrastruttureCost": 240000,
    }
    keys = {t.key for t in (await db.execute(select(CostItemType))).scalars()}
    assert keys == {
        "softwareLicensingCost",
        "applicationManagementServicesCost",
        "infrastruttureCost",
        "other",
    }


async def test_default_catalogue_is_insert_only_on_an_empty_table(db):
    assert await seed_default_items(db) == 4
    assert await seed_default_items(db) == 0


async def test_zero_cost_demo_application_has_no_total_key(db):
    await create_card_type(db, key="Application", fields_schema=SCHEMA)
    card = await create_card(db, card_type="Application", name="Free", attributes={})
    card_id = card.id
    await _seed_demo_costs(db, {})
    db.expire_all()
    assert "costTotalAnnual" not in (await db.get(Card, card_id)).attributes
    assert (await db.execute(select(CardCost))).scalars().all() == []
