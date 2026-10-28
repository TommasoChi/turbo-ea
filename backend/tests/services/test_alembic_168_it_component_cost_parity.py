"""Unit tests for migration 168 (IT Component cost-field and calculation parity).

Gives IT Component the same three cost-breakdown fields and calculated
``costTotalAnnual`` Application has today (as live admin data only, not in
any migration or seed.py), by migration — so both types are portable to a
fresh install. Also fixes a leading-space label typo found on Application's
``applicationManagementServicesCost`` while reading the live field data, and
renames Application's "Cost & Ownership" section to "Cost" (IT Component's
section name).

The first block exercises the pure ``_fix_application_cost_section`` /
``_add_itcomponent_cost_fields`` helpers — no DB. The second block runs the
migration's upgrade/downgrade logic against a real test database.
"""

from __future__ import annotations

import copy
import importlib.util
from pathlib import Path

_MIG_PATH = (
    Path(__file__).resolve().parents[2] / "alembic" / "versions" / "168_it_component_cost_parity.py"
)
_spec = importlib.util.spec_from_file_location("mig168", _MIG_PATH)
mig = importlib.util.module_from_spec(_spec)
assert _spec and _spec.loader
_spec.loader.exec_module(mig)


def _application_cost_section(label_has_leading_space: bool = True) -> list:
    return [
        {
            "section": "Cost & Ownership",
            "translations": {"en": "Cost & Ownership", "de": "Kosten & Eigentümerschaft"},
            "fields": [
                {"key": "costTotalAnnual", "label": "Total Annual Cost", "type": "cost"},
                {
                    "key": "applicationManagementServicesCost",
                    "label": " Application Management Services Cost"
                    if label_has_leading_space
                    else "Application Management Services Cost",
                    "type": "cost",
                },
            ],
        }
    ]


def test_renames_the_section_and_fixes_the_label():
    result = mig._fix_application_cost_section(_application_cost_section())
    assert result[0]["section"] == "Cost"
    assert result[0]["translations"] == mig.COST_SECTION_TRANSLATIONS
    fields_by_key = {f["key"]: f for f in result[0]["fields"]}
    assert (
        fields_by_key["applicationManagementServicesCost"]["label"]
        == "Application Management Services Cost"
    )


def test_is_a_noop_when_already_fixed():
    already_fixed = [
        {
            "section": "Cost",
            "translations": mig.COST_SECTION_TRANSLATIONS,
            "fields": [
                {"key": "costTotalAnnual", "label": "Total Annual Cost", "type": "cost"},
                {
                    "key": "applicationManagementServicesCost",
                    "label": "Application Management Services Cost",
                    "type": "cost",
                },
            ],
        }
    ]
    assert mig._fix_application_cost_section(already_fixed) is None


def test_does_not_mutate_its_input():
    original = _application_cost_section()
    snapshot = copy.deepcopy(original)
    mig._fix_application_cost_section(original)
    assert original == snapshot


def _itcomponent_cost_section(existing_keys: tuple[str, ...] = ("costTotalAnnual",)) -> list:
    return [
        {
            "section": "Cost",
            "translations": mig.COST_SECTION_TRANSLATIONS,
            "fields": [
                {"key": k, "label": "Total Annual Cost", "type": "cost"} for k in existing_keys
            ],
        }
    ]


def test_appends_the_missing_fields():
    result = mig._add_itcomponent_cost_fields(_itcomponent_cost_section())
    keys = {f["key"] for f in result[0]["fields"]}
    assert keys == {"costTotalAnnual"} | {f["key"] for f in mig.COST_FIELD_DEFS}


def test_is_idempotent_once_all_three_are_present():
    all_keys = ("costTotalAnnual", *[f["key"] for f in mig.COST_FIELD_DEFS])
    assert mig._add_itcomponent_cost_fields(_itcomponent_cost_section(all_keys)) is None


def test_adds_only_the_missing_subset():
    one_present = ("costTotalAnnual", mig.COST_FIELD_DEFS[0]["key"])
    result = mig._add_itcomponent_cost_fields(_itcomponent_cost_section(one_present))
    keys = {f["key"] for f in result[0]["fields"]}
    assert keys == {"costTotalAnnual"} | {f["key"] for f in mig.COST_FIELD_DEFS}


def test_is_none_when_the_cost_section_is_missing():
    no_cost_section = [{"section": "Other", "translations": {"en": "Other"}, "fields": []}]
    assert mig._add_itcomponent_cost_fields(no_cost_section) is None


# ---------------------------------------------------------------------------
# DB-backed: the `db` fixture builds an empty schema (no pre-seeded card
# types), so each test creates its own Application/ITComponent rows via
# `create_card_type`.
# ---------------------------------------------------------------------------

from sqlalchemy import select  # noqa: E402

from app.models.calculation import Calculation  # noqa: E402
from app.models.card_type import CardType  # noqa: E402
from tests.conftest import create_card, create_card_type  # noqa: E402


async def _fetch_fields_schema(db, key: str) -> list:
    db.expire_all()
    row = (await db.execute(select(CardType).where(CardType.key == key))).scalar_one()
    return row.fields_schema


async def test_upgrade_applies_to_a_fresh_db_and_is_idempotent(db):
    await create_card_type(
        db,
        key="Application",
        fields_schema=_application_cost_section(),
    )
    await create_card_type(
        db,
        key="ITComponent",
        fields_schema=_itcomponent_cost_section(),
    )
    conn = await db.connection()
    await conn.run_sync(mig._upgrade_body)
    await conn.run_sync(mig._upgrade_body)  # second run must be a no-op

    app_schema = await _fetch_fields_schema(db, "Application")
    assert app_schema[0]["section"] == "Cost"
    it_schema = await _fetch_fields_schema(db, "ITComponent")
    it_keys = {f["key"] for f in it_schema[0]["fields"]}
    assert it_keys == {"costTotalAnnual"} | {f["key"] for f in mig.COST_FIELD_DEFS}

    calcs = (
        (
            await db.execute(
                select(Calculation).where(
                    Calculation.target_type_key == "ITComponent",
                    Calculation.target_field_key == "costTotalAnnual",
                )
            )
        )
        .scalars()
        .all()
    )
    assert len(calcs) == 1
    assert calcs[0].formula == mig.CALCULATION_FORMULA


async def test_an_admin_renamed_section_is_left_alone(db):
    already_renamed = [
        {
            "section": "Cost",
            "translations": mig.COST_SECTION_TRANSLATIONS,
            "fields": [
                {
                    "key": "applicationManagementServicesCost",
                    "label": "Custom Admin Label",
                    "type": "cost",
                }
            ],
        }
    ]
    await create_card_type(db, key="Application", fields_schema=already_renamed)
    await create_card_type(db, key="ITComponent", fields_schema=_itcomponent_cost_section())
    conn = await db.connection()
    await conn.run_sync(mig._upgrade_body)

    app_schema = await _fetch_fields_schema(db, "Application")
    fields_by_key = {f["key"]: f for f in app_schema[0]["fields"]}
    # The admin's own label is untouched (it never started with a space).
    assert fields_by_key["applicationManagementServicesCost"]["label"] == "Custom Admin Label"

    it_schema = await _fetch_fields_schema(db, "ITComponent")
    it_keys = {f["key"] for f in it_schema[0]["fields"]}
    assert it_keys == {"costTotalAnnual"} | {f["key"] for f in mig.COST_FIELD_DEFS}


async def test_an_existing_calculation_on_the_same_target_is_not_duplicated(db):
    await create_card_type(db, key="Application", fields_schema=_application_cost_section())
    await create_card_type(db, key="ITComponent", fields_schema=_itcomponent_cost_section())
    db.add(
        Calculation(
            name="Hand-written",
            target_type_key="ITComponent",
            target_field_key="costTotalAnnual",
            formula="present = data.costTotalAnnual",
            is_active=True,
            blanks_as_zero=False,
        )
    )
    await db.flush()
    conn = await db.connection()
    await conn.run_sync(mig._upgrade_body)

    calcs = (
        (
            await db.execute(
                select(Calculation).where(
                    Calculation.target_type_key == "ITComponent",
                    Calculation.target_field_key == "costTotalAnnual",
                )
            )
        )
        .scalars()
        .all()
    )
    assert len(calcs) == 1
    assert calcs[0].name == "Hand-written"  # the admin's own row, untouched


async def test_downgrade_never_touches_card_attribute_values(db):
    await create_card_type(db, key="Application", fields_schema=_application_cost_section())
    await create_card_type(db, key="ITComponent", fields_schema=_itcomponent_cost_section())
    conn = await db.connection()
    await conn.run_sync(mig._upgrade_body)

    card = await create_card(db, card_type="ITComponent", name="Server 1")
    card.attributes = {"softwareLicensingCost": 500}
    await db.flush()

    await conn.run_sync(mig._downgrade_body)

    await db.refresh(card)
    assert card.attributes == {"softwareLicensingCost": 500}
