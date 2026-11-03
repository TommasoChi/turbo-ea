"""Tests for migration 175's data move (cost fields and history -> cost items).

First block: the pure helpers in ``app.services.cost_items_migration`` (no DB). Second
block: end to end on the test database. ``upgrade()`` itself also creates the tables
(which ``create_all`` already built), so the test drives the revision's data step
``_data_body`` through ``AsyncConnection.run_sync`` -- the same pattern as the 168 test.
"""

from __future__ import annotations

import importlib.util
from pathlib import Path

from sqlalchemy import select

from app.models.app_settings import AppSettings
from app.models.calculation import Calculation
from app.models.card import Card
from app.models.card_cost import CardCost
from app.models.card_cost_history import CardCostHistory
from app.models.card_type import CardType
from app.models.cost_item_type import CostItemType
from app.services import cost_items_migration as cim
from app.services.fiscal_year import current_fiscal_year
from tests.conftest import create_card, create_card_type

_MIG_PATH = Path(__file__).resolve().parents[2] / "alembic" / "versions" / "175_card_cost_items.py"
_spec = importlib.util.spec_from_file_location("mig175", _MIG_PATH)
mig = importlib.util.module_from_spec(_spec)
assert _spec and _spec.loader
_spec.loader.exec_module(mig)

KEYS = ["softwareLicensingCost", "applicationManagementServicesCost", "infrastruttureCost"]


def amounts(items):
    return {k: v["amount"] for k, v in items.items()}


def test_current_residual_goes_to_other():
    attrs = {
        "softwareLicensingCost": 100,
        "applicationManagementServicesCost": 40,
        "infrastruttureCost": 20,
        "costTotalAnnual": 200,
    }
    assert amounts(cim.build_current_year_items(attrs, KEYS)) == {
        "softwareLicensingCost": 100,
        "applicationManagementServicesCost": 40,
        "infrastruttureCost": 20,
        "other": 40,
    }


def test_current_details_above_total_have_no_other():
    attrs = {"softwareLicensingCost": 120, "costTotalAnnual": 100}
    assert amounts(cim.build_current_year_items(attrs, KEYS)) == {"softwareLicensingCost": 120}


def test_current_only_total_goes_to_other():
    assert amounts(cim.build_current_year_items({"costTotalAnnual": 90}, KEYS)) == {"other": 90}


def test_current_nothing_or_zero_gives_no_items():
    assert cim.build_current_year_items({}, KEYS) == {}
    assert (
        cim.build_current_year_items({"softwareLicensingCost": 0, "costTotalAnnual": 0}, KEYS) == {}
    )


def test_past_consistent_year_is_unchanged():
    items, tco, changed = cim.build_past_year_items(
        {"softwareLicensingCost": 60, "costTotalAnnual": 100}, KEYS
    )
    assert amounts(items) == {"softwareLicensingCost": 60, "other": 40}
    assert (tco, changed) == (100, False)


def test_past_details_above_total_changes():
    items, tco, changed = cim.build_past_year_items(
        {"softwareLicensingCost": 80, "infrastruttureCost": 40, "costTotalAnnual": 100}, KEYS
    )
    assert "other" not in items
    assert (tco, changed) == (120, True)


def test_past_only_details_changes():
    _, tco, changed = cim.build_past_year_items({"infrastruttureCost": 30}, KEYS)
    assert (tco, changed) == (30, True)


def test_past_only_total_and_empty():
    items, tco, changed = cim.build_past_year_items({"costTotalAnnual": 90}, KEYS)
    assert (amounts(items), tco, changed) == ({"other": 90}, 90, False)
    assert cim.build_past_year_items({}, KEYS) == ({}, 0, False)


def test_formula_only_references_the_item_keys():
    f = "present = data.softwareLicensingCost+data.infrastruttureCost"
    assert cim.formula_sums_only(f, KEYS)
    assert not cim.formula_sums_only(f + "+data.mystery", KEYS)
    assert not cim.formula_sums_only("data.softwareLicensingCost*relations.x", KEYS)
    assert not cim.formula_sums_only("1+1", KEYS)


def test_strip_item_fields():
    schema = [{"section": "Cost", "fields": [{"key": "costTotalAnnual"}, {"key": KEYS[0]}]}]
    out = cim.strip_item_fields(schema, KEYS)
    assert [f["key"] for f in out[0]["fields"]] == ["costTotalAnnual"]
    assert cim.strip_item_fields(out, KEYS) is None


# --- end to end -------------------------------------------------------------


def _schema(with_breakdown: bool):
    fields = [{"key": "costTotalAnnual", "label": "Total", "type": "cost"}]
    if with_breakdown:
        fields += [{"key": k, "label": k, "type": "cost"} for k in KEYS]
        fields.append({"key": "extraCost", "label": "Extra", "type": "cost"})
    return [{"section": "Cost", "fields": fields}]


async def _run(db):
    conn = await db.connection()
    await conn.run_sync(mig._data_body)
    db.expire_all()


async def test_migration_moves_fields_and_history(db):
    cur = current_fiscal_year(1)
    await create_card_type(db, key="Application", fields_schema=_schema(True))
    await create_card_type(db, key="ITComponent", fields_schema=_schema(False))
    db.add(
        Calculation(
            name="sum",
            target_type_key="Application",
            target_field_key="costTotalAnnual",
            formula="present = data.softwareLicensingCost+data.infrastruttureCost",
            is_active=True,
        )
    )
    app = await create_card(
        db,
        card_type="Application",
        name="A",
        attributes={"softwareLicensingCost": 100, "extraCost": 5, "costTotalAnnual": 200},
    )
    empty = await create_card(db, card_type="ITComponent", name="Empty", attributes={})
    itc = await create_card(
        db, card_type="ITComponent", name="Itc", attributes={"costTotalAnnual": 90}
    )
    db.add_all(
        [
            CardCostHistory(
                card_id=app.id, fiscal_year=cur - 1, field_key="costTotalAnnual", value=50
            ),
            CardCostHistory(
                card_id=app.id, fiscal_year=cur - 1, field_key="infrastruttureCost", value=70
            ),
            CardCostHistory(
                card_id=app.id, fiscal_year=cur, field_key="costTotalAnnual", value=999
            ),
            CardCostHistory(
                card_id=itc.id, fiscal_year=cur + 1, field_key="costTotalAnnual", value=10
            ),
        ]
    )
    db.add(AppSettings(id="default", general_settings={"other": 1}))
    await db.flush()

    app_id, empty_id, itc_id = app.id, empty.id, itc.id
    await _run(db)

    rows = {
        (r.card_id, r.fiscal_year): amounts(r.items)
        for r in (await db.execute(select(CardCost))).scalars()
    }
    assert rows[(app_id, cur)] == {"softwareLicensingCost": 100, "extraCost": 5, "other": 95}
    assert rows[(app_id, cur - 1)] == {"infrastruttureCost": 70}  # details exceed total
    assert rows[(empty_id, cur)] == {}
    assert rows[(itc_id, cur)] == {"other": 90}
    assert rows[(itc_id, cur + 1)] == {"other": 10}
    assert len(rows) == 5  # the current-year history row is discarded

    assert (await db.get(Card, app_id)).attributes["costTotalAnnual"] == 200
    assert (await db.get(Card, empty_id)).attributes["costTotalAnnual"] == 0

    keys = {c.key for c in (await db.execute(select(CostItemType))).scalars()}
    assert keys == {*KEYS, "extraCost", "other"}

    schema = (await db.execute(select(CardType).where(CardType.key == "Application"))).scalar_one()
    assert [f["key"] for f in schema.fields_schema[0]["fields"]] == ["costTotalAnnual"]
    assert (await db.execute(select(Calculation))).scalars().all() == []

    settings = (await db.execute(select(AppSettings))).scalar_one()
    assert settings.general_settings["other"] == 1
    report = settings.general_settings["cost_items_migration_report"]
    assert report == [
        {"card_id": str(app_id), "fiscal_year": cur - 1, "old_total": 50, "new_tco": 70}
    ]


async def test_second_run_changes_nothing(db):
    await create_card_type(db, key="Application", fields_schema=_schema(False))
    card = await create_card(db, card_type="Application", attributes={"costTotalAnnual": 40})
    card_id = card.id
    await _run(db)
    await db.execute(CardCost.__table__.update().values(items={"other": {"amount": 1}}))
    await _run(db)
    row = (await db.execute(select(CardCost).where(CardCost.card_id == card_id))).scalar_one()
    assert row.items == {"other": {"amount": 1}}
