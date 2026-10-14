"""Migration 157 switches the Value Chain module on for installs that already
hold a ``general_settings`` blob, without disturbing anything else in it."""

from __future__ import annotations

import importlib.util
import json
from pathlib import Path

from sqlalchemy import text

_MIG_PATH = (
    Path(__file__).resolve().parents[2]
    / "alembic"
    / "versions"
    / "157_add_value_chain_module_flag.py"
)
_spec = importlib.util.spec_from_file_location("mig157", _MIG_PATH)
mig = importlib.util.module_from_spec(_spec)
assert _spec and _spec.loader
_spec.loader.exec_module(mig)


async def _put_settings(conn, settings):
    await conn.exec_driver_sql("DELETE FROM app_settings")
    if settings is not None:
        await conn.execute(
            text(
                "INSERT INTO app_settings (id, general_settings) "
                "VALUES ('default', CAST(:s AS jsonb))"
            ),
            {"s": json.dumps(settings)},
        )


async def _read_settings(conn):
    rows = (await conn.exec_driver_sql("SELECT general_settings FROM app_settings")).all()
    return [r[0] for r in rows]


async def test_upgrade_adds_the_flag_and_keeps_every_other_key(db):
    conn = await db.connection()
    await _put_settings(conn, {"bpmEnabled": False, "currency": "EUR", "nested": {"a": [1, 2]}})
    await conn.run_sync(mig._apply)
    assert await _read_settings(conn) == [
        {"bpmEnabled": False, "currency": "EUR", "nested": {"a": [1, 2]}, "valueChainEnabled": True}
    ]


async def test_upgrade_leaves_an_explicit_off_alone(db):
    conn = await db.connection()
    await _put_settings(conn, {"valueChainEnabled": False})
    await conn.run_sync(mig._apply)
    assert await _read_settings(conn) == [{"valueChainEnabled": False}]


async def test_upgrade_is_idempotent(db):
    conn = await db.connection()
    await _put_settings(conn, {"currency": "EUR"})
    await conn.run_sync(mig._apply)
    first = await _read_settings(conn)
    await conn.run_sync(mig._apply)
    assert await _read_settings(conn) == first == [{"currency": "EUR", "valueChainEnabled": True}]


async def test_upgrade_creates_no_row_on_a_fresh_install(db):
    conn = await db.connection()
    await _put_settings(conn, None)
    await conn.run_sync(mig._apply)
    assert await _read_settings(conn) == []


async def test_upgrade_handles_a_null_blob(db):
    conn = await db.connection()
    await conn.exec_driver_sql("DELETE FROM app_settings")
    await conn.exec_driver_sql(
        "INSERT INTO app_settings (id, general_settings) VALUES ('default', NULL)"
    )
    await conn.run_sync(mig._apply)
    assert await _read_settings(conn) == [{"valueChainEnabled": True}]


async def test_downgrade_removes_only_the_flag(db):
    conn = await db.connection()
    await _put_settings(conn, {"currency": "EUR", "valueChainEnabled": False})
    await conn.run_sync(mig._remove)
    assert await _read_settings(conn) == [{"currency": "EUR"}]
    await conn.run_sync(mig._remove)  # nothing left to remove: no-op
    assert await _read_settings(conn) == [{"currency": "EUR"}]
