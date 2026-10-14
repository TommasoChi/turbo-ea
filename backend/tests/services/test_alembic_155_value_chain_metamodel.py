"""Migration 155 adds what the Value Chain reads to an already-running
install, and must be safe to re-run and safe on a hand-customised metamodel."""

from __future__ import annotations

import importlib.util
from pathlib import Path

from app.services import seed

_MIG_PATH = (
    Path(__file__).resolve().parents[2]
    / "alembic"
    / "versions"
    / "155_add_value_chain_metamodel.py"
)
_spec = importlib.util.spec_from_file_location("mig155", _MIG_PATH)
mig = importlib.util.module_from_spec(_spec)
assert _spec and _spec.loader
_spec.loader.exec_module(mig)


def test_appends_a_value_chain_section_when_absent():
    schema = [{"section": "General", "fields": [{"key": "name"}]}]
    planned = mig.plan_fields(schema, mig.BIZCTX_FIELDS, mig.SECTION_DEF)
    assert [s["section"] for s in planned] == ["General", "Value Chain"]
    assert [f["key"] for f in planned[-1]["fields"]] == [
        "isCore",
        "isCross",
        "sortOrder",
        "levelOrder",
    ]
    assert planned[0]["fields"] == [{"key": "name"}]


def test_appends_into_an_existing_value_chain_section():
    schema = [{"section": "Value Chain", "fields": [{"key": "isCore", "label": "Mine"}]}]
    planned = mig.plan_fields(schema, mig.BIZCTX_FIELDS, mig.SECTION_DEF)
    assert len(planned) == 1
    assert [f["key"] for f in planned[0]["fields"]] == [
        "isCore",
        "isCross",
        "sortOrder",
        "levelOrder",
    ]


def test_leaves_an_existing_field_untouched():
    schema = [{"section": "Custom", "fields": [{"key": "isCore", "label": "Hand made"}]}]
    planned = mig.plan_fields(schema, mig.BIZCTX_FIELDS, mig.SECTION_DEF)
    hand_made = [f for s in planned for f in s["fields"] if f["key"] == "isCore"]
    assert hand_made == [{"key": "isCore", "label": "Hand made"}]
    # The three missing ones still land in a Value Chain section.
    assert [s["section"] for s in planned] == ["Custom", "Value Chain"]
    assert [f["key"] for f in planned[1]["fields"]] == ["isCross", "sortOrder", "levelOrder"]


def test_does_not_mutate_its_input():
    schema = [{"section": "General", "fields": []}]
    mig.plan_fields(schema, mig.BIZCTX_FIELDS, mig.SECTION_DEF)
    assert schema == [{"section": "General", "fields": []}]
    assert mig.SECTION_DEF["fields"] == []


def test_is_idempotent():
    schema = [{"section": "General", "fields": []}]
    once = mig.plan_fields(schema, mig.BIZCTX_FIELDS, mig.SECTION_DEF)
    assert mig.plan_fields(once, mig.BIZCTX_FIELDS, mig.SECTION_DEF) == once


def test_adds_missing_subtypes_only():
    existing = [{"key": "valueGate", "label": "Gate"}]
    planned = mig.plan_subtypes(existing, mig.OBJECTIVE_SUBTYPES)
    assert [s["key"] for s in planned] == ["valueGate", "businessGoal"]
    assert planned[0] == {"key": "valueGate", "label": "Gate"}
    assert mig.plan_subtypes(planned, mig.OBJECTIVE_SUBTYPES) == planned


def test_migration_literals_equal_the_seed():
    """Guards drift: the migration copies the seed's definitions verbatim."""
    types = {t["key"]: t for t in seed.TYPES}
    rels = {r["key"]: r for r in seed.RELATIONS}

    def vc_fields(type_key):
        sec = next(s for s in types[type_key]["fields_schema"] if s["section"] == "Value Chain")
        return sec

    bc_section = vc_fields("BusinessContext")
    assert mig.BIZCTX_FIELDS == bc_section["fields"]
    assert mig.SECTION_DEF == {**bc_section, "fields": []}
    bp_section = vc_fields("BusinessProcess")
    assert mig.PROCESS_FIELDS == bp_section["fields"]
    assert bp_section["section"] == mig.SECTION_DEF["section"]
    assert bp_section["translations"] == mig.SECTION_DEF["translations"]

    assert mig.OBJECTIVE_SUBTYPES == types["Objective"]["subtypes"]

    assert [r["key"] for r in mig.RELATION_TYPES] == [
        "relObjectiveToBizCtx",
        "relBusinessContextSuccessor",
    ]
    for rt in mig.RELATION_TYPES:
        assert rt == rels[rt["key"]]
    assert mig.RELATION_TYPES[0]["sort_order"] == 48
    succ = mig.RELATION_TYPES[1]
    assert (succ["label"], succ["reverse_label"], succ["sort_order"]) == (
        "succeeds",
        "is succeeded by",
        49,
    )
    assert succ["translations"] == seed.SUCCESSOR_TRANSLATIONS


async def test_relation_types_insert_runs_on_a_real_db_and_is_idempotent(db):
    conn = await db.connection()
    await conn.run_sync(mig._insert_relation_types)
    await conn.run_sync(mig._insert_relation_types)  # second run must be a no-op
    rows = (
        await conn.exec_driver_sql(
            "SELECT key, built_in, attributes_schema FROM relation_types "
            "WHERE key IN ('relObjectiveToBizCtx','relBusinessContextSuccessor') ORDER BY key"
        )
    ).all()
    assert [r[0] for r in rows] == ["relBusinessContextSuccessor", "relObjectiveToBizCtx"]
    assert all(r[1] is True for r in rows)
    assert all(r[2] == [] for r in rows)
