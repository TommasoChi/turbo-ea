"""Migration 155 adds what the Value Chain reads to an already-running
install, and must be safe to re-run and safe on a hand-customised metamodel."""

from __future__ import annotations

import copy
import importlib.util
from collections import Counter
from pathlib import Path

from sqlalchemy import delete

from app.models.card_type import CardType
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


async def _seed_old_install(db, *, bizctx_schema, process_schema=None):
    """Replace the three card types with what an install before 155 holds."""
    if process_schema is None:
        process_schema = [{"section": "General", "fields": [{"key": "name"}]}]
    await db.execute(delete(CardType).where(CardType.key.in_(_TYPES)))
    for key, schema, subtypes in (
        ("BusinessContext", bizctx_schema, []),
        ("BusinessProcess", process_schema, []),
        ("Objective", [], [{"key": "valueGate", "label": "Gate"}]),
    ):
        db.add(
            CardType(
                key=key,
                label=key,
                fields_schema=schema,
                subtypes=subtypes,
                has_successors=False,
            )
        )
    await db.flush()


_TYPES = ("BusinessContext", "BusinessProcess", "Objective")


async def _read_card_types(conn):
    rows = (
        await conn.exec_driver_sql(
            "SELECT key, fields_schema, subtypes, has_successors FROM card_types "
            "WHERE key IN ('BusinessContext','BusinessProcess','Objective') ORDER BY key"
        )
    ).all()
    return {r[0]: (r[1], r[2], r[3]) for r in rows}


async def test_upgrade_body_applies_to_card_types_and_is_idempotent(db):
    await _seed_old_install(db, bizctx_schema=[{"section": "General", "fields": [{"key": "name"}]}])
    conn = await db.connection()
    await conn.run_sync(mig._apply)
    first = await _read_card_types(conn)
    await conn.run_sync(mig._apply)
    assert await _read_card_types(conn) == first

    bc_schema, bc_subtypes, bc_succ = first["BusinessContext"]
    assert [s["section"] for s in bc_schema] == ["General", "Value Chain"]
    assert bc_schema[0]["fields"] == [{"key": "name"}]
    assert bc_schema[1] == {**mig.SECTION_DEF, "fields": mig.BIZCTX_FIELDS}
    assert bc_succ is True

    bp_schema, _, bp_succ = first["BusinessProcess"]
    assert [s["section"] for s in bp_schema] == ["General", "Value Chain"]
    assert bp_schema[1]["fields"] == mig.PROCESS_FIELDS
    assert bp_succ is False  # only BusinessContext is switched on by 155

    _, obj_subtypes, _ = first["Objective"]
    assert [s["key"] for s in obj_subtypes] == ["valueGate", "businessGoal"]
    assert obj_subtypes[0] == {"key": "valueGate", "label": "Gate"}
    assert obj_subtypes[1] == mig.OBJECTIVE_SUBTYPES[1]

    keys = (
        await conn.exec_driver_sql(
            "SELECT key FROM relation_types "
            "WHERE key IN ('relObjectiveToBizCtx','relBusinessContextSuccessor') ORDER BY key"
        )
    ).all()
    assert [k[0] for k in keys] == ["relBusinessContextSuccessor", "relObjectiveToBizCtx"]


async def test_upgrade_body_keeps_a_hand_made_field_in_another_section(db):
    hand_made = {"key": "isCore", "label": "Hand made", "type": "text", "weight": 3}
    await _seed_old_install(db, bizctx_schema=[{"section": "Custom", "fields": [dict(hand_made)]}])
    conn = await db.connection()
    await conn.run_sync(mig._apply)
    first = await _read_card_types(conn)
    await conn.run_sync(mig._apply)
    assert await _read_card_types(conn) == first

    schema = first["BusinessContext"][0]
    assert [s["section"] for s in schema] == ["Custom", "Value Chain"]
    assert schema[0]["fields"] == [hand_made]
    assert [f["key"] for f in schema[1]["fields"]] == ["isCross", "sortOrder", "levelOrder"]
    assert sum(f["key"] == "isCore" for s in schema for f in s["fields"]) == 1


# The backend runs ``seed_metamodel`` on every start, right after the migrations.
# On an install whose Value Chain fields live in a section with another name,
# 155 adds nothing — and the seed must not then append its own "Value Chain"
# section, or every key would appear twice in ``fields_schema``.

_VC_KEYS = ("isCore", "isCross", "sortOrder", "levelOrder")
_HAND_MADE_BC = [
    {"key": "isCore", "label": "Core", "type": "text", "weight": 3},
    {"key": "isCross", "label": "Cross", "type": "boolean"},
    {"key": "sortOrder", "label": "Order", "type": "text"},
    {"key": "levelOrder", "label": "Level", "type": "number", "weight": 1},
]
_HAND_MADE_BP = [{"key": "levelOrder", "label": "Mine", "type": "text"}]


def _key_counts(schema):
    return Counter(f["key"] for s in schema for f in s.get("fields", []))


async def _migrate_then_start(db):
    conn = await db.connection()
    await conn.run_sync(mig._apply)
    db.expire_all()  # the migration wrote card_types behind the session's back
    await seed.seed_metamodel(db)
    await db.flush()
    rows = await _read_card_types(conn)
    return rows["BusinessContext"][0], rows["BusinessProcess"][0]


async def _install_with_hand_made_fields(db):
    await _seed_old_install(
        db,
        bizctx_schema=[{"section": "Custom", "fields": copy.deepcopy(_HAND_MADE_BC)}],
        process_schema=[{"section": "Custom", "fields": copy.deepcopy(_HAND_MADE_BP)}],
    )


async def test_startup_seed_keeps_each_key_once_when_they_live_in_another_section(db):
    await _install_with_hand_made_fields(db)
    bc_schema, bp_schema = await _migrate_then_start(db)

    bc_counts = _key_counts(bc_schema)
    assert [bc_counts[k] for k in _VC_KEYS] == [1, 1, 1, 1]
    assert _key_counts(bp_schema)["levelOrder"] == 1
    assert "Value Chain" not in [s["section"] for s in bc_schema]
    assert "Value Chain" not in [s["section"] for s in bp_schema]
    bc_custom = next(s for s in bc_schema if s["section"] == "Custom")
    bp_custom = next(s for s in bp_schema if s["section"] == "Custom")
    assert bc_custom["fields"] == _HAND_MADE_BC
    assert bp_custom["fields"] == _HAND_MADE_BP
    # Sections without overlap are still appended from the seed.
    assert "Business Context Information" in [s["section"] for s in bc_schema]
    assert "Process Classification" in [s["section"] for s in bp_schema]


async def test_startup_seed_still_adds_the_value_chain_section_when_keys_are_absent(db):
    await _seed_old_install(db, bizctx_schema=[{"section": "General", "fields": [{"key": "name"}]}])
    db.expire_all()
    await seed.seed_metamodel(db)
    await db.flush()
    rows = await _read_card_types(await db.connection())
    bc_schema, bp_schema = rows["BusinessContext"][0], rows["BusinessProcess"][0]

    bc_vc = next(s for s in bc_schema if s["section"] == "Value Chain")
    assert [f["key"] for f in bc_vc["fields"]] == list(_VC_KEYS)
    assert [f["type"] for f in bc_vc["fields"]] == ["boolean", "boolean", "number", "number"]
    assert [_key_counts(bc_schema)[k] for k in _VC_KEYS] == [1, 1, 1, 1]
    bp_vc = next(s for s in bp_schema if s["section"] == "Value Chain")
    assert [f["key"] for f in bp_vc["fields"]] == ["levelOrder"]


async def test_startup_seed_is_idempotent_on_a_hand_made_install(db):
    await _install_with_hand_made_fields(db)
    first = await _migrate_then_start(db)
    db.expire_all()
    await seed.seed_metamodel(db)
    await db.flush()
    rows = await _read_card_types(await db.connection())
    assert (rows["BusinessContext"][0], rows["BusinessProcess"][0]) == first
