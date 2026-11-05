"""Tests for migration 178 (the ``licensing`` extension's data -> core licenses).

First block: the pure helpers in ``app.services.licensing_migration`` (no DB). Second block:
end to end on the test database, driving the revision's data step ``_data_body`` through
``AsyncConnection.run_sync`` (same pattern as the 175 test).
"""

from __future__ import annotations

import copy
import importlib.util
from pathlib import Path

from sqlalchemy import select

from app.models.app_settings import AppSettings
from app.models.calculation import Calculation
from app.models.card_license import CardLicense
from app.models.card_type import CardType
from app.models.extension import Extension
from app.models.license_type import LicenseType
from app.models.saved_report import SavedReport
from app.services import seed
from app.services.fiscal_year import current_fiscal_year
from app.services.licensing_migration import (
    GENERAL_SECTION,
    LICENSING_MODEL_FIELD,
    assign_keys,
    build_items,
    citing_calculations,
    move_model_field,
    slug,
)
from tests.conftest import create_card, create_card_type, create_user

_MIG_PATH = (
    Path(__file__).resolve().parents[2] / "alembic" / "versions" / "178_licensing_from_extension.py"
)
_spec = importlib.util.spec_from_file_location("mig178", _MIG_PATH)
mig = importlib.util.module_from_spec(_spec)
assert _spec and _spec.loader
_spec.loader.exec_module(mig)

KEYS = assign_keys(["Admin", "Dev"])


def test_slug_and_type_fallback():
    assert slug("End User") == "end_user"
    assert slug("  Prod-1 ") == "prod_1"
    assert slug("123") is None
    assert slug("—") is None
    assert len(slug("a" * 100)) == 64


def test_assign_keys_merges_case_and_falls_back():
    k = assign_keys(["Prod", "prod", "123", "End User"])
    assert k["prod"] == ("prod", "Prod")
    assert k["123"][0] == "type_1"
    assert k["end user"][0] == "end_user"
    assert len(k) == 3


def test_assign_keys_suffixes_slug_collisions():
    assert {v[0] for v in assign_keys(["a b", "a-b"]).values()} == {"a_b", "a_b_2"}


def test_build_items_sums_duplicates_and_reports_bad_values():
    items, problems = build_items(
        {
            "licensedUsers": [
                {"category": "Admin", "value": 2},
                {"category": "admin", "value": 3},
            ],
            "actualUsers": [
                {"category": "Admin", "value": "x"},
                {"category": "Dev", "value": -1},
                {"category": "Admin", "value": 1.6},
            ],
        },
        KEYS,
    )
    assert items == {"users": {"admin": {"licensed": 5, "actual": 2}}}
    assert {p["reason"] for p in problems} == {"not_numeric", "negative", "rounded"}


def test_build_items_accepts_numeric_text_and_skips_blank_category():
    items, problems = build_items(
        {
            "licensedInstallations": [
                {"category": "Dev", "value": " 7 "},
                {"category": "  ", "value": 4},
            ]
        },
        KEYS,
    )
    assert items == {"installations": {"dev": {"licensed": 7, "actual": None}}}
    assert [p["reason"] for p in problems] == ["no_category"]


def test_actual_without_licensed_gets_licensed_zero():
    items, _ = build_items({"actualUsers": [{"category": "Dev", "value": 3}]}, KEYS)
    assert items == {"users": {"dev": {"licensed": 0, "actual": 3}}}


def test_nothing_usable_gives_no_items():
    items, problems = build_items({"licensedUsers": "garbage", "actualUsers": [{"x": 1}]}, KEYS)
    assert items == {} and problems == []


def _ext_field(key, ftype="multiple_select"):
    return {"key": key, "label": key, "type": ftype, "ext": "licensing"}


def test_move_model_field_into_general_section_and_drop_ext_section():
    schema = [
        {"section": "Application Information", "fields": [{"key": "hostingType"}]},
        {"section": "Licensing", "ext": "licensing", "fields": [_ext_field("licensingModel")]},
    ]
    out = move_model_field("Application", schema)
    # the caller strips the extension first; here only the add is under test
    general = out[0]
    assert general["fields"][-1] == LICENSING_MODEL_FIELD
    assert general["fields"][-1] is not LICENSING_MODEL_FIELD


def test_move_model_field_adds_on_instance_without_extension():
    schema = [{"section": "Component Information", "fields": [{"key": "x"}]}]
    out = move_model_field("ITComponent", schema)
    assert [f["key"] for f in out[0]["fields"]] == ["x", "licensingModel"]
    assert [f["key"] for f in schema[0]["fields"]] == ["x"]  # input untouched
    assert move_model_field("ITComponent", out) is None  # second pass: no change


def test_move_model_field_creates_the_section_when_an_admin_renamed_it():
    out = move_model_field("Application", [{"section": "Renamed", "fields": []}])
    assert out[-1]["section"] == GENERAL_SECTION["Application"]
    assert out[-1]["fields"] == [LICENSING_MODEL_FIELD]


def test_move_model_field_keeps_an_admin_field_with_the_same_key():
    schema = [{"section": "Mine", "fields": [{"key": "licensingModel", "type": "text"}]}]
    assert move_model_field("Application", schema) is None


def test_move_model_field_ignores_other_types():
    assert move_model_field("Platform", []) is None


def test_seed_uses_the_one_field_definition():
    for type_key, section in GENERAL_SECTION.items():
        type_def = next(t for t in seed.TYPES if t["key"] == type_key)
        general = next(s for s in type_def["fields_schema"] if s["section"] == section)
        assert general["fields"][-1] == LICENSING_MODEL_FIELD


def test_citing_calculations_lists_formulas_naming_old_keys():
    rows = [
        ("1", "uses", "present = data.licensedUsers + 1"),
        ("2", "other", "present = data.licensedUsersExtra"),
        ("3", "none", "present = data.cost"),
        ("4", "two", "data.actualUsers / data.actualInstallations"),
    ]
    assert citing_calculations(rows) == [
        {"id": "1", "name": "uses", "keys": ["licensedUsers"]},
        {"id": "4", "name": "two", "keys": ["actualUsers", "actualInstallations"]},
    ]


# --- end to end -------------------------------------------------------------

CUR = current_fiscal_year(1)


def _multi(*pairs):
    return [{"category": c, "value": v} for c, v in pairs]


def _schema(with_ext: bool, general: str = "Application Information"):
    sections = [{"section": general, "fields": [{"key": "hostingType", "type": "text"}]}]
    if with_ext:
        sections.append(
            {
                "section": "Licensing",
                "ext": "licensing",
                "fields": [
                    _ext_field("licensingModel"),
                    _ext_field("licensedUsers", "ext.licensing.multivalue"),
                    _ext_field("licensedInstallations", "ext.licensing.multivalue"),
                    _ext_field("actualUsers", "ext.licensing.multivalue"),
                    _ext_field("actualInstallations", "ext.licensing.multivalue"),
                ],
            }
        )
    return sections


async def _run(db):
    conn = await db.connection()
    await conn.run_sync(mig._data_body)
    db.expire_all()


async def _types(db):
    app_t = await create_card_type(
        db, key="Application", label="Application", fields_schema=_schema(True)
    )
    itc_t = await create_card_type(
        db,
        key="ITComponent",
        label="IT Component",
        fields_schema=_schema(False, "Component Information")
        + [
            {
                "section": "Extra",
                "fields": [
                    {"key": "licenseType", "type": "text"},
                    {"key": "numberOfUsers", "type": "number"},
                ],
            }
        ],
    )
    return app_t, itc_t


async def test_migration_moves_values_strips_keys_and_leaves_the_extension_row(db):
    await _types(db)
    db.add(
        Extension(
            key="licensing", name="Licensing Analysis", version="1.0.2", manifest={}, enabled=True
        )
    )
    db.add(AppSettings(id="default", general_settings={"other": 1}))
    a = await create_card(
        db,
        card_type="Application",
        name="A",
        attributes={
            "licensingModel": ["users"],
            "licensedUsers": _multi(("Admin", 10), ("End User", 20)),
            "actualUsers": _multi(("Admin", 12), ("End User", "5")),
            "keep": 1,
        },
    )
    plain = await create_card(db, card_type="ITComponent", name="P", attributes={"x": 1})
    await db.flush()
    a_id, plain_id = a.id, plain.id

    await _run(db)

    rows = (await db.execute(select(CardLicense))).scalars().all()
    assert [(r.card_id, r.fiscal_year) for r in rows] == [(a_id, CUR)]
    assert rows[0].items == {
        "users": {
            "admin": {"licensed": 10, "actual": 12},
            "end_user": {"licensed": 20, "actual": 5},
        }
    }
    types = (await db.execute(select(LicenseType).order_by(LicenseType.sort_order))).scalars().all()
    assert [(t.key, t.label, t.archived) for t in types] == [
        ("admin", "Admin", False),
        ("end_user", "End User", False),
    ]
    from app.models.card import Card

    attrs = (await db.execute(select(Card.attributes).where(Card.id == a_id))).scalar_one()
    assert attrs == {"licensingModel": ["users"], "keep": 1}
    assert (await db.execute(select(Card.attributes).where(Card.id == plain_id))).scalar_one() == {
        "x": 1
    }
    ext = (await db.execute(select(Extension).where(Extension.key == "licensing"))).scalar_one()
    assert ext.enabled is True and ext.status == "installed"
    settings = (await db.execute(select(AppSettings))).scalar_one().general_settings
    assert settings["other"] == 1
    report = settings["licensing_migration_report"]
    assert report["total"] == 1 and report["entries"][0]["card_id"] == str(a_id)
    assert report["entries"][0]["cells"] == 2
    assert {t["key"] for t in report["license_types"]} == {"admin", "end_user"}

    app_t = (await db.execute(select(CardType).where(CardType.key == "Application"))).scalar_one()
    sections = {s["section"]: s for s in app_t.fields_schema}
    assert "Licensing" not in sections
    assert sections["Application Information"]["fields"][-1] == LICENSING_MODEL_FIELD
    itc_t = (await db.execute(select(CardType).where(CardType.key == "ITComponent"))).scalar_one()
    itc_fields = [f["key"] for s in itc_t.fields_schema for f in s["fields"]]
    assert itc_fields.count("licensingModel") == 1  # added on a type that never had the extension


async def test_migration_lists_ext_saved_reports_and_leaves_them(db):
    await _types(db)
    user = await create_user(db)
    db.add(AppSettings(id="default", general_settings={}))
    db.add(
        SavedReport(
            owner_id=user.id, name="Old", report_type="ext:licensing:chart", config={"a": 1}
        )
    )
    db.add(SavedReport(owner_id=user.id, name="Core", report_type="cost", config={}))
    db.add(
        Calculation(
            name="calc",
            target_type_key="Application",
            target_field_key="score",
            formula="present = data.licensedUsers",
            is_active=True,
        )
    )
    await create_card(
        db,
        card_type="Application",
        name="A",
        attributes={"licensedUsers": _multi(("Admin", 1))},
    )
    await db.flush()
    await _run(db)

    report = (
        (await db.execute(select(AppSettings)))
        .scalar_one()
        .general_settings["licensing_migration_report"]
    )
    assert [(r["name"], r["report_type"]) for r in report["saved_reports"]] == [
        ("Old", "ext:licensing:chart")
    ]
    assert [c["name"] for c in report["calculations"]] == ["calc"]
    kept = (await db.execute(select(SavedReport).order_by(SavedReport.name))).scalars().all()
    assert [(r.name, r.report_type, r.config) for r in kept] == [
        ("Core", "cost", {}),
        ("Old", "ext:licensing:chart", {"a": 1}),
    ]
    calc = (await db.execute(select(Calculation))).scalar_one()
    assert calc.is_active is True and calc.formula == "present = data.licensedUsers"


async def test_migration_leaves_license_type_and_number_of_users_fields(db):
    _, itc_t = await _types(db)
    before = copy.deepcopy(itc_t.fields_schema[-1])
    await _run(db)
    itc = (await db.execute(select(CardType).where(CardType.key == "ITComponent"))).scalar_one()
    assert itc.fields_schema[-1] == before


async def test_second_run_changes_nothing(db):
    await _types(db)
    db.add(AppSettings(id="default", general_settings={}))
    await create_card(
        db,
        card_type="Application",
        name="A",
        attributes={"licensedUsers": _multi(("Admin", 1))},
    )
    await db.flush()
    await _run(db)
    first = (await db.execute(select(AppSettings))).scalar_one().general_settings
    schema = (
        await db.execute(select(CardType.fields_schema).where(CardType.key == "Application"))
    ).scalar_one()
    await _run(db)
    assert (await db.execute(select(AppSettings))).scalar_one().general_settings == first
    assert (
        await db.execute(select(CardType.fields_schema).where(CardType.key == "Application"))
    ).scalar_one() == schema
    assert len((await db.execute(select(CardLicense))).scalars().all()) == 1
    assert len((await db.execute(select(LicenseType))).scalars().all()) == 1


async def test_report_is_capped_at_200(db):
    await _types(db)
    db.add(AppSettings(id="default", general_settings={}))
    for i in range(203):
        await create_card(
            db,
            card_type="Application",
            name=f"A{i}",
            attributes={"licensedUsers": _multi(("Admin", 1))},
        )
    await db.flush()
    await _run(db)
    report = (
        (await db.execute(select(AppSettings)))
        .scalar_one()
        .general_settings["licensing_migration_report"]
    )
    assert report["total"] == 203 and len(report["entries"]) == 200


async def test_values_go_to_the_current_year_of_an_april_fiscal_year(db):
    await _types(db)
    db.add(AppSettings(id="default", general_settings={"fiscalYearStart": 4}))
    await create_card(
        db,
        card_type="Application",
        name="A",
        attributes={"licensedUsers": _multi(("Admin", 1))},
    )
    await db.flush()
    await _run(db)
    row = (await db.execute(select(CardLicense))).scalar_one()
    assert row.fiscal_year == current_fiscal_year(4)


async def test_cards_with_only_unusable_values_get_no_row_but_lose_the_keys(db):
    await _types(db)
    db.add(AppSettings(id="default", general_settings={}))
    c = await create_card(
        db,
        card_type="Application",
        name="Bad",
        attributes={"licensedUsers": _multi(("Admin", "x"))},
    )
    await db.flush()
    cid = c.id
    await _run(db)
    from app.models.card import Card

    assert (await db.execute(select(CardLicense))).scalars().all() == []
    assert (await db.execute(select(Card.attributes).where(Card.id == cid))).scalar_one() == {}
    report = (
        (await db.execute(select(AppSettings)))
        .scalar_one()
        .general_settings["licensing_migration_report"]
    )
    assert report["entries"][0]["problems"][0]["reason"] == "not_numeric"
