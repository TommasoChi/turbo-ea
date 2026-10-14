"""Migration 156 renames the hand-made ObjectiveToBusinessContext relation
type to the core convention. relations.type is a denormalised string with no
FK (app/models/relation.py), and the key also sits inside several JSONB
payloads, so the rename is a sweep — not a single UPDATE."""

from __future__ import annotations

import importlib.util
import json
from pathlib import Path

from app.models.bookmark import Bookmark
from app.models.calculation import Calculation
from app.models.diagram import Diagram
from app.models.saved_report import SavedReport
from app.models.survey import Survey
from app.models.web_portal import WebPortal
from tests.conftest import create_card, create_relation, create_relation_type, create_user

_MIG_PATH = (
    Path(__file__).resolve().parents[2]
    / "alembic"
    / "versions"
    / "156_rename_objective_to_bizctx.py"
)
_spec = importlib.util.spec_from_file_location("mig156", _MIG_PATH)
mig = importlib.util.module_from_spec(_spec)
assert _spec and _spec.loader
_spec.loader.exec_module(mig)

OLD = "ObjectiveToBusinessContext"
NEW = "relObjectiveToBizCtx"


def test_renames_to_the_core_convention():
    assert mig.OLD_KEY == "ObjectiveToBusinessContext"
    assert mig.NEW_KEY == "relObjectiveToBizCtx"
    assert mig.revision == "156"
    assert mig.down_revision == "155"


def test_sweeps_every_table_that_can_embed_a_relation_key():
    assert mig.JSONB_TARGETS == [
        ("saved_reports", "config"),
        ("bookmarks", "filters"),
        ("surveys", "target_filters"),
        ("web_portals", "filters"),
        ("web_portals", "card_config"),
        ("diagrams", "data"),
    ]
    assert mig.TEXT_TARGETS == [("calculations", "formula")]


def test_old_key_is_not_a_substring_of_any_other_seeded_key():
    # A plain textual REPLACE is only safe because the old key collides with
    # nothing else; this test is what keeps that assumption honest.
    from app.services.seed import RELATIONS

    others = [r["key"] for r in RELATIONS if r["key"] != mig.NEW_KEY]
    assert others  # the guard below must not pass on an empty list
    assert not [k for k in others if mig.OLD_KEY in k]


# ---------------------------------------------------------------------------
# DB-backed: every branch of _sweep / _unsweep runs against a real Postgres.
# ---------------------------------------------------------------------------


def _payload(key: str, marker: str) -> dict:
    """A JSONB cell holding ``key`` as a value, as a dict key and in a list,
    next to content the sweep must leave alone."""
    return {
        "marker": marker,
        "relationType": key,
        "perType": {key: {"visible": True}, "relOther": {"visible": False}},
        "list": [key, "relOther", {"nested": key}],
        "n": 3,
    }


def _formula(key: str) -> str:
    return f"count(rel('{key}')) + count(rel('{key}')) + count(rel('relOther'))"


# (table, column) — hard-coded on purpose: independent of mig.JSONB_TARGETS, so
# dropping a target from the migration makes the DB tests fail.
_JSONB_CELLS = [
    ("saved_reports", "config"),
    ("bookmarks", "filters"),
    ("surveys", "target_filters"),
    ("web_portals", "filters"),
    ("web_portals", "card_config"),
    ("diagrams", "data"),
]


async def _clean_keys(conn):
    await conn.exec_driver_sql(f"DELETE FROM relation_types WHERE key IN ('{OLD}', '{NEW}')")


async def _populate(db, key: str):
    """One hit row + one decoy row per target."""
    user = await create_user(db)
    decoy = _payload("relOther", "decoy")
    db.add_all(
        [
            SavedReport(owner_id=user.id, name="hit", report_type="x", config=_payload(key, "hit")),
            SavedReport(owner_id=user.id, name="decoy", report_type="x", config=decoy),
            Bookmark(user_id=user.id, name="hit", filters=_payload(key, "hit")),
            Bookmark(user_id=user.id, name="decoy", filters=decoy),
            Survey(name="hit", target_type_key="Objective", target_filters=_payload(key, "hit")),
            Survey(name="decoy", target_type_key="Objective", target_filters=decoy),
            WebPortal(
                name="hit",
                slug="p-hit",
                card_type="Objective",
                filters=_payload(key, "hit"),
                card_config=_payload(key, "hit-cc"),
            ),
            WebPortal(
                name="decoy",
                slug="p-decoy",
                card_type="Objective",
                filters=decoy,
                card_config=_payload("relOther", "decoy-cc"),
            ),
            Diagram(name="hit", data=_payload(key, "hit")),
            Diagram(name="decoy", data=decoy),
            Calculation(
                name="hit",
                target_type_key="Objective",
                target_field_key="f",
                formula=_formula(key),
            ),
            Calculation(
                name="decoy",
                target_type_key="Objective",
                target_field_key="f",
                formula="count(rel('relOther'))",
            ),
        ]
    )
    await db.flush()


async def _read_cell(conn, table: str, column: str, name: str):
    return (
        await conn.exec_driver_sql(f"SELECT {column} FROM {table} WHERE name = '{name}'")
    ).scalar_one()


async def _snapshot(conn) -> dict:
    """Every swept cell plus the relation_types/relations state, read back
    with SQL, as plain comparable values."""
    snap: dict = {}
    for table, column in _JSONB_CELLS + [("calculations", "formula")]:
        for name in ("hit", "decoy"):
            snap[(table, column, name)] = await _read_cell(conn, table, column, name)
    snap["relation_types"] = [
        tuple(r)
        for r in (
            await conn.exec_driver_sql(
                "SELECT key, built_in, label FROM relation_types "
                f"WHERE key IN ('{OLD}', '{NEW}') ORDER BY key"
            )
        ).all()
    ]
    snap["relations"] = [
        tuple(r)
        for r in (
            await conn.exec_driver_sql(
                "SELECT type, source_id, target_id FROM relations "
                f"WHERE type IN ('{OLD}', '{NEW}') ORDER BY source_id, target_id"
            )
        ).all()
    ]
    return snap


async def _count(conn, table: str) -> int:
    return (await conn.exec_driver_sql(f"SELECT count(*) FROM {table}")).scalar()


async def _add_relation_pair(db):
    obj = await create_card(db, card_type="Objective", name="Gate")
    ctx = await create_card(db, card_type="BusinessContext", name="Stream")
    ctx2 = await create_card(db, card_type="BusinessContext", name="Stream2")
    await create_relation(db, type_key=OLD, source_id=obj.id, target_id=ctx.id)
    await create_relation(db, type_key=OLD, source_id=obj.id, target_id=ctx2.id)


async def _setup_old_install(db):
    conn = await db.connection()
    await _clean_keys(conn)
    await create_relation_type(
        db,
        key=OLD,
        label="is goal for",
        source_type_key="Objective",
        target_type_key="BusinessContext",
        built_in=False,
    )
    await _add_relation_pair(db)
    await _populate(db, OLD)
    return conn


async def test_sweep_rewrites_relation_type_relations_and_every_embedded_key(db):
    conn = await _setup_old_install(db)
    before = await _snapshot(conn)
    n_relations = await _count(conn, "relations")
    assert before["relation_types"] == [(OLD, False, "is goal for")]
    assert len(before["relations"]) == 2

    await conn.run_sync(lambda c: mig._sweep(c, OLD, NEW))
    after = await _snapshot(conn)

    # relation_types: renamed in place and promoted to built-in
    assert after["relation_types"] == [(NEW, True, "is goal for")]
    # relations: re-pointed, none lost or duplicated
    assert await _count(conn, "relations") == n_relations
    assert len(after["relations"]) == 2
    assert {r[0] for r in after["relations"]} == {NEW}
    # every JSONB target: old key gone everywhere, new key in, rest untouched
    for table, column in _JSONB_CELLS:
        marker = "hit-cc" if (table, column) == ("web_portals", "card_config") else "hit"
        hit = after[(table, column, "hit")]
        assert hit == _payload(NEW, marker), (table, column)
        assert OLD not in json.dumps(hit)
        assert after[(table, column, "decoy")] == before[(table, column, "decoy")]
    # text target: both occurrences replaced, remainder byte-equal
    assert after[("calculations", "formula", "hit")] == _formula(NEW)
    assert OLD not in after[("calculations", "formula", "hit")]
    decoy = ("calculations", "formula", "decoy")
    assert after[decoy] == before[decoy]


async def test_sweep_promotes_the_successor_relation_type_to_built_in(db):
    conn = await db.connection()
    await _clean_keys(conn)
    await conn.exec_driver_sql(
        "DELETE FROM relation_types WHERE key = 'relBusinessContextSuccessor'"
    )
    await create_relation_type(
        db,
        key="relBusinessContextSuccessor",
        source_type_key="BusinessContext",
        target_type_key="BusinessContext",
        built_in=False,
    )
    await conn.run_sync(lambda c: mig._sweep(c, OLD, NEW))
    built_in = (
        await conn.exec_driver_sql(
            "SELECT built_in FROM relation_types WHERE key = 'relBusinessContextSuccessor'"
        )
    ).scalar_one()
    assert built_in is True


async def test_sweep_when_the_new_key_already_exists_drops_the_hand_made_row(db):
    """State 155 leaves on a live instance: seeded NEW row + hand-made OLD row."""
    conn = await db.connection()
    await _clean_keys(conn)
    await create_relation_type(
        db,
        key=NEW,
        label="is goal for (seed)",
        source_type_key="Objective",
        target_type_key="BusinessContext",
        built_in=False,  # also proves the survivor is promoted
    )
    await create_relation_type(
        db,
        key=OLD,
        label="is goal for (hand made)",
        source_type_key="Objective",
        target_type_key="BusinessContext",
        built_in=False,
    )
    await _add_relation_pair(db)
    await _populate(db, OLD)
    n_relations = await _count(conn, "relations")

    await conn.run_sync(lambda c: mig._sweep(c, OLD, NEW))
    after = await _snapshot(conn)

    # old row removed, new row kept (its own label), promoted
    assert after["relation_types"] == [(NEW, True, "is goal for (seed)")]
    # relations re-pointed, count unchanged
    assert await _count(conn, "relations") == n_relations
    assert [r[0] for r in after["relations"]] == [NEW, NEW]
    assert after[("saved_reports", "config", "hit")] == _payload(NEW, "hit")
    assert after[("calculations", "formula", "hit")] == _formula(NEW)


async def test_sweep_is_a_no_op_on_a_clean_install(db):
    conn = await db.connection()
    await _clean_keys(conn)
    await _populate(db, "relOther")  # nothing mentions the old key
    before = await _snapshot(conn)
    n_types = await _count(conn, "relation_types")
    n_relations = await _count(conn, "relations")

    await conn.run_sync(lambda c: mig._sweep(c, OLD, NEW))

    assert await _snapshot(conn) == before
    assert before["relation_types"] == []  # no NEW row was conjured up
    assert await _count(conn, "relation_types") == n_types
    assert await _count(conn, "relations") == n_relations


async def test_sweep_is_idempotent(db):
    conn = await _setup_old_install(db)
    await conn.run_sync(lambda c: mig._sweep(c, OLD, NEW))
    once = await _snapshot(conn)
    await conn.run_sync(lambda c: mig._sweep(c, OLD, NEW))
    assert await _snapshot(conn) == once


async def test_unsweep_restores_the_original_state_exactly(db):
    conn = await _setup_old_install(db)
    before = await _snapshot(conn)
    n_relations = await _count(conn, "relations")

    await conn.run_sync(lambda c: mig._sweep(c, OLD, NEW))
    assert await _snapshot(conn) != before  # the sweep really changed something
    await conn.run_sync(lambda c: mig._unsweep(c, OLD, NEW))
    after = await _snapshot(conn)

    assert after["relation_types"] == [(OLD, False, "is goal for")]
    assert after["relations"] == before["relations"]
    assert await _count(conn, "relations") == n_relations
    assert after == before  # every JSONB/text cell and the key rows, exactly
