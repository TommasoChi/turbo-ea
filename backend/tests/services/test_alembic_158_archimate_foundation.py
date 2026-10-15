from __future__ import annotations

import importlib.util
import json
from pathlib import Path

from sqlalchemy import text

_MIG = (
    Path(__file__).resolve().parents[2] / "alembic" / "versions" / "158_add_archimate_foundation.py"
)
_spec = importlib.util.spec_from_file_location("mig158", _MIG)
mig = importlib.util.module_from_spec(_spec)
assert _spec and _spec.loader
_spec.loader.exec_module(mig)

# NOT NULL columns without a server default: raw INSERTs must supply them.
_CT_COLS = (
    "icon, color, has_hierarchy, has_successors, allow_card_logo, "
    "fields_schema, is_hidden, sort_order"
)
_CT_VALS = "'category', '#000000', false, false, false, '[]'::jsonb, false, 0"
_RT_COLS = "cardinality, attributes_schema, is_hidden, sort_order"
_RT_VALS = "'n:m', '[]'::jsonb, false, 0"


async def _seed(conn):
    await conn.exec_driver_sql("DELETE FROM card_types")
    await conn.execute(
        text(
            "INSERT INTO card_types "
            f"(id, key, label, subtypes, built_in, archimate_type, {_CT_COLS}) VALUES "
            f"(gen_random_uuid(), 'Application', 'Application', CAST(:sa AS jsonb), "
            f"true, NULL, {_CT_VALS}), "
            f"(gen_random_uuid(), 'ITComponent', 'IT Component', CAST(:si AS jsonb), "
            f"true, 'Device', {_CT_VALS}), "
            f"(gen_random_uuid(), 'MyCustom', 'Custom', '[]'::jsonb, false, NULL, {_CT_VALS})"
        ),
        {
            "sa": json.dumps([{"key": "microservice", "label": "Microservice"}]),
            "si": json.dumps(
                [
                    {"key": "software", "label": "Software", "archimate_type": "Artifact"},
                    {"key": "hardware", "label": "Hardware"},
                ]
            ),
        },
    )


async def test_backfill_sets_defaults_and_keeps_admin_values(db):
    conn = await db.connection()
    await _seed(conn)
    await conn.run_sync(mig._backfill_card_types)
    rows = {
        r[0]: r[1]
        for r in (await conn.exec_driver_sql("SELECT key, archimate_type FROM card_types")).all()
    }
    assert rows == {
        "Application": "ApplicationComponent",
        "ITComponent": "Device",
        "MyCustom": None,
    }
    subs = (
        await conn.exec_driver_sql("SELECT subtypes FROM card_types WHERE key = 'ITComponent'")
    ).scalar_one()
    by_key = {s["key"]: s.get("archimate_type") for s in subs}
    # the admin's Artifact stays; the unmapped hardware subtype gets the default Device
    assert by_key == {"software": "Artifact", "hardware": "Device"}


async def test_backfill_is_idempotent(db):
    conn = await db.connection()
    await _seed(conn)
    await conn.run_sync(mig._backfill_card_types)
    first = (
        await conn.exec_driver_sql(
            "SELECT key, archimate_type, subtypes FROM card_types ORDER BY key"
        )
    ).all()
    await conn.run_sync(mig._backfill_card_types)
    second = (
        await conn.exec_driver_sql(
            "SELECT key, archimate_type, subtypes FROM card_types ORDER BY key"
        )
    ).all()
    assert first == second


async def test_relation_backfill_sets_type_reversed_and_access(db):
    conn = await db.connection()
    await conn.exec_driver_sql("DELETE FROM relation_types")
    await conn.execute(
        text(
            f"INSERT INTO relation_types (id, key, label, source_type_key, target_type_key, "
            f"built_in, {_RT_COLS}) VALUES "
            f"(gen_random_uuid(), 'relAppToITC', 'uses', 'Application', 'ITComponent', "
            f"true, {_RT_VALS}), "
            f"(gen_random_uuid(), 'relAppToDataObj', 'CRUD', 'Application', 'DataObject', "
            f"true, {_RT_VALS}), "
            f"(gen_random_uuid(), 'relCustom', 'x', 'A', 'B', false, {_RT_VALS})"
        )
    )
    await conn.run_sync(mig._backfill_relation_types)
    rows = {
        r[0]: r[1:]
        for r in (
            await conn.exec_driver_sql(
                "SELECT key, archimate_type, archimate_reversed, archimate_access "
                "FROM relation_types"
            )
        ).all()
    }
    assert rows["relAppToITC"] == ("Serving", True, None)
    assert rows["relAppToDataObj"] == ("Access", False, "crud")
    assert rows["relCustom"] == (None, False, None)


async def test_successor_relations_default_to_association(db):
    conn = await db.connection()
    await conn.exec_driver_sql("DELETE FROM relation_types")
    await conn.execute(
        text(
            f"INSERT INTO relation_types (id, key, label, source_type_key, target_type_key, "
            f"built_in, {_RT_COLS}) VALUES "
            f"(gen_random_uuid(), 'relAppSuccessor', 'succeeds', 'Application', "
            f"'Application', true, {_RT_VALS})"
        )
    )
    await conn.run_sync(mig._backfill_relation_types)
    row = (
        await conn.exec_driver_sql(
            "SELECT archimate_type FROM relation_types WHERE key='relAppSuccessor'"
        )
    ).scalar_one()
    assert row == "Association"


async def test_diagrams_default_to_the_drawio_kind(db):
    conn = await db.connection()
    await conn.exec_driver_sql("DELETE FROM diagrams")
    await conn.execute(
        text(
            "INSERT INTO diagrams (id, name, data, is_published, access_mode) "
            "VALUES (gen_random_uuid(), 'd', '{}'::jsonb, false, 'public')"
        )
    )
    assert (await conn.exec_driver_sql("SELECT kind FROM diagrams")).scalar_one() == "drawio"
