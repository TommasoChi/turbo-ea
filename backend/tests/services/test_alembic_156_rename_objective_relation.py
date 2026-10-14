"""Migration 156 renames the hand-made ObjectiveToBusinessContext relation
type to the core convention. relations.type is a denormalised string with no
FK (app/models/relation.py), and the key also sits inside several JSONB
payloads, so the rename is a sweep — not a single UPDATE.

After 155 every real install holds BOTH the seeded relObjectiveToBizCtx and the
hand-made ObjectiveToBusinessContext, so the path that matters is "drop the
hand-made row, re-point its relations" — guarded by compatibility checks. The
in-place rename only covers a DB where the seeded row is absent."""

from __future__ import annotations

import importlib.util
import json
from pathlib import Path

import pytest

from app.models.bookmark import Bookmark
from app.models.calculation import Calculation
from app.models.diagram import Diagram
from app.models.saved_report import SavedReport
from app.models.survey import Survey, SurveyResponse
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
        ("surveys", "fields"),
        ("survey_responses", "responses"),
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


def _survey_fields(key: str) -> list:
    """What SurveyBuilder stores for a relation question."""
    return [
        {"key": "name", "kind": "attribute", "label": "Name"},
        {
            "key": f"rel:{key}:outgoing",
            "kind": "relation",
            "relation_type_key": key,
            "label": "Goal for",
        },
    ]


def _survey_answers(key: str) -> dict:
    """A response, keyed by the very same field key as the question above."""
    return {
        "name": {"current_value": "x", "confirmed": True},
        f"rel:{key}:outgoing": {"current_value": ["a"], "new_value": ["a", "b"]},
    }


def _formula(key: str) -> str:
    return f"count(rel('{key}')) + count(rel('{key}')) + count(rel('relOther'))"


# (table, column) — hard-coded on purpose: independent of mig.JSONB_TARGETS, so
# dropping a target from the migration makes the DB tests fail.
_JSONB_CELLS = [
    ("saved_reports", "config"),
    ("bookmarks", "filters"),
    ("surveys", "target_filters"),
    ("surveys", "fields"),
    ("survey_responses", "responses"),
    ("web_portals", "filters"),
    ("web_portals", "card_config"),
    ("diagrams", "data"),
]
# Cells whose content is not the generic _payload() shape.
_CUSTOM_CELLS = {("surveys", "fields"), ("survey_responses", "responses")}


async def _clean_keys(conn):
    await conn.exec_driver_sql(f"DELETE FROM relation_types WHERE key IN ('{OLD}', '{NEW}')")


async def _populate(db, key: str):
    """One hit row + one decoy row per target."""
    user = await create_user(db)
    decoy = _payload("relOther", "decoy")
    hit_survey = Survey(
        name="hit",
        target_type_key="Objective",
        target_filters=_payload(key, "hit"),
        fields=_survey_fields(key),
    )
    decoy_survey = Survey(
        name="decoy",
        target_type_key="Objective",
        target_filters=decoy,
        fields=_survey_fields("relOther"),
    )
    card = await create_card(db, card_type="Objective", name="Surveyed")
    db.add_all([hit_survey, decoy_survey])
    await db.flush()  # survey ids for the responses below
    db.add_all(
        [
            SavedReport(owner_id=user.id, name="hit", report_type="x", config=_payload(key, "hit")),
            SavedReport(owner_id=user.id, name="decoy", report_type="x", config=decoy),
            Bookmark(user_id=user.id, name="hit", filters=_payload(key, "hit")),
            Bookmark(user_id=user.id, name="decoy", filters=decoy),
            SurveyResponse(
                survey_id=hit_survey.id,
                card_id=card.id,
                user_id=user.id,
                responses=_survey_answers(key),
            ),
            SurveyResponse(
                survey_id=decoy_survey.id,
                card_id=card.id,
                user_id=user.id,
                responses=_survey_answers("relOther"),
            ),
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
    if table == "survey_responses":  # no name of its own: go through the survey
        return (
            await conn.exec_driver_sql(
                f"SELECT r.{column} FROM survey_responses r "
                f"JOIN surveys s ON s.id = r.survey_id WHERE s.name = '{name}'"
            )
        ).scalar_one()
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
    snap["relation_types_full"] = [
        tuple(r)
        for r in (
            await conn.exec_driver_sql(
                "SELECT key, built_in, label, reverse_label, source_type_key, "
                "target_type_key, cardinality, attributes_schema, sort_order, translations, "
                "description, is_hidden FROM relation_types "
                f"WHERE key IN ('{OLD}', '{NEW}') ORDER BY key"
            )
        ).all()
    ]
    snap["relation_attributes"] = [
        r[0]
        for r in (
            await conn.exec_driver_sql(
                "SELECT attributes FROM relations "
                f"WHERE type IN ('{OLD}', '{NEW}') ORDER BY target_id"
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


async def _add_relation_pair(db, attributes=None):
    obj = await create_card(db, card_type="Objective", name="Gate")
    ctx = await create_card(db, card_type="BusinessContext", name="Stream")
    ctx2 = await create_card(db, card_type="BusinessContext", name="Stream2")
    kw = {"attributes": attributes} if attributes else {}
    await create_relation(db, type_key=OLD, source_id=obj.id, target_id=ctx.id, **kw)
    await create_relation(db, type_key=OLD, source_id=obj.id, target_id=ctx2.id, **kw)


async def _make_type(db, key, label, **overrides):
    """A relation type oriented Objective -> BusinessContext, not built-in."""
    kw = {
        "source_type_key": "Objective",
        "target_type_key": "BusinessContext",
        "built_in": False,
    }
    kw.update(overrides)
    return await create_relation_type(db, key=key, label=label, **kw)


async def _setup_old_install(db):
    """Only the hand-made row exists (no seeded row): the in-place rename
    branch, which the real upgrade path after 155 does not reach."""
    conn = await db.connection()
    await _clean_keys(conn)
    await _make_type(db, OLD, "is goal for")
    await _add_relation_pair(db)
    await _populate(db, OLD)
    return conn


async def _setup_real_path(db, *, hand_made=None, seeded=None, relation_attributes=None):
    """State 155 leaves on a live instance: seeded NEW row + hand-made OLD row
    (the only path a real upgrade takes: 155 never touches the old key)."""
    conn = await db.connection()
    await _clean_keys(conn)
    await _make_type(db, NEW, "is goal for (seed)", **(seeded or {}))
    await _make_type(db, OLD, "is goal for (hand made)", **(hand_made or {}))
    await _add_relation_pair(db, relation_attributes)
    await _populate(db, OLD)
    return conn


def _assert_swept(before: dict, after: dict):
    """Every embedded key rewritten, everything else in the cell preserved."""
    for table, column in _JSONB_CELLS:
        if (table, column) in _CUSTOM_CELLS:
            continue
        marker = "hit-cc" if (table, column) == ("web_portals", "card_config") else "hit"
        hit = after[(table, column, "hit")]
        assert hit == _payload(NEW, marker), (table, column)
        assert OLD not in json.dumps(hit)
    for table, column in _JSONB_CELLS:
        assert after[(table, column, "decoy")] == before[(table, column, "decoy")]
    assert after[("surveys", "fields", "hit")] == _survey_fields(NEW)
    assert after[("survey_responses", "responses", "hit")] == _survey_answers(NEW)
    # text target: both occurrences replaced, remainder byte-equal
    assert after[("calculations", "formula", "hit")] == _formula(NEW)
    assert OLD not in after[("calculations", "formula", "hit")]
    decoy = ("calculations", "formula", "decoy")
    assert after[decoy] == before[decoy]


async def test_sweep_renames_in_place_when_the_seeded_row_is_absent(db):
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
    _assert_swept(before, after)


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
    conn = await _setup_real_path(db)
    before = await _snapshot(conn)
    n_relations = await _count(conn, "relations")
    assert [r[0] for r in before["relation_types"]] == [OLD, NEW]

    await conn.run_sync(lambda c: mig._sweep(c, OLD, NEW))
    after = await _snapshot(conn)

    # old row removed, new row kept (its own label), promoted
    assert after["relation_types"] == [(NEW, True, "is goal for (seed)")]
    # relations re-pointed, count unchanged
    assert await _count(conn, "relations") == n_relations
    assert [r[0] for r in after["relations"]] == [NEW, NEW]
    _assert_swept(before, after)


async def test_sweep_keeps_survey_question_and_response_keys_in_sync(db):
    conn = await _setup_real_path(db)
    await conn.run_sync(lambda c: mig._sweep(c, OLD, NEW))
    after = await _snapshot(conn)

    fields = after[("surveys", "fields", "hit")]
    answers = after[("survey_responses", "responses", "hit")]
    assert fields == _survey_fields(NEW)
    assert answers == _survey_answers(NEW)
    # the question's key and the answer's key still match each other
    question = next(f for f in fields if f["kind"] == "relation")
    assert question["key"] == f"rel:{NEW}:outgoing"
    assert question["relation_type_key"] == NEW
    assert question["key"] in answers
    assert OLD not in json.dumps([fields, answers])
    # the decoy survey is untouched
    assert after[("surveys", "fields", "decoy")] == _survey_fields("relOther")
    assert after[("survey_responses", "responses", "decoy")] == _survey_answers("relOther")


async def test_sweep_refuses_a_hand_made_type_with_the_opposite_orientation(db):
    conn = await _setup_real_path(
        db,
        hand_made={"source_type_key": "BusinessContext", "target_type_key": "Objective"},
    )
    before = await _snapshot(conn)
    n_relations = await _count(conn, "relations")

    with pytest.raises(RuntimeError) as exc:
        await conn.run_sync(lambda c: mig._sweep(c, OLD, NEW))

    msg = str(exc.value)
    assert OLD in msg and NEW in msg
    assert "BusinessContext -> Objective" in msg  # the hand-made orientation
    assert "Objective -> BusinessContext" in msg  # the seeded orientation
    assert await _snapshot(conn) == before  # nothing written
    assert await _count(conn, "relations") == n_relations
    assert [r[0] for r in before["relations"]] == [OLD, OLD]


@pytest.mark.parametrize("field", ["source_type_key", "target_type_key"])
async def test_sweep_refuses_when_only_one_endpoint_differs(db, field):
    conn = await _setup_real_path(db, hand_made={field: "SomethingElse"})
    before = await _snapshot(conn)
    with pytest.raises(RuntimeError):
        await conn.run_sync(lambda c: mig._sweep(c, OLD, NEW))
    assert await _snapshot(conn) == before


_ATTRS = [{"key": "weight", "label": "Weight", "type": "number"}]


async def test_sweep_copies_the_hand_made_attributes_schema_onto_an_empty_seeded_row(db):
    conn = await _setup_real_path(
        db,
        hand_made={"attributes_schema": _ATTRS},
        relation_attributes={"weight": 3},
    )
    n_relations = await _count(conn, "relations")

    await conn.run_sync(lambda c: mig._sweep(c, OLD, NEW))
    after = await _snapshot(conn)

    [row] = after["relation_types_full"]
    assert row[0] == NEW
    assert row[7] == _ATTRS  # copied
    assert row[2] == "is goal for (seed)"  # seeded labels still win
    assert await _count(conn, "relations") == n_relations
    assert after["relation_attributes"] == [{"weight": 3}, {"weight": 3}]  # values kept


async def test_sweep_refuses_two_different_non_empty_attributes_schemas(db):
    other = [{"key": "colour", "label": "Colour", "type": "text"}]
    conn = await _setup_real_path(
        db, hand_made={"attributes_schema": _ATTRS}, seeded={"attributes_schema": other}
    )
    before = await _snapshot(conn)
    with pytest.raises(RuntimeError) as exc:
        await conn.run_sync(lambda c: mig._sweep(c, OLD, NEW))
    assert "attributes_schema" in str(exc.value)
    assert await _snapshot(conn) == before


async def test_sweep_proceeds_when_both_attributes_schemas_are_equal(db):
    conn = await _setup_real_path(
        db,
        hand_made={"attributes_schema": _ATTRS},
        seeded={"attributes_schema": _ATTRS},
    )
    await conn.run_sync(lambda c: mig._sweep(c, OLD, NEW))
    after = await _snapshot(conn)
    assert [r[0] for r in after["relation_types_full"]] == [NEW]
    assert after["relation_types_full"][0][7] == _ATTRS
    assert [r[0] for r in after["relations"]] == [NEW, NEW]


async def test_sweep_ignores_an_empty_hand_made_schema_when_the_seeded_row_has_one(db):
    conn = await _setup_real_path(db, seeded={"attributes_schema": _ATTRS})
    await conn.run_sync(lambda c: mig._sweep(c, OLD, NEW))
    after = await _snapshot(conn)
    assert after["relation_types_full"][0][7] == _ATTRS


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
    conn = await _setup_real_path(db)
    await conn.run_sync(lambda c: mig._sweep(c, OLD, NEW))
    once = await _snapshot(conn)
    await conn.run_sync(lambda c: mig._sweep(c, OLD, NEW))
    assert await _snapshot(conn) == once


async def test_unsweep_restores_the_original_state_exactly_after_the_in_place_rename(db):
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


async def test_unsweep_after_the_real_path_restores_keys_and_relations(db):
    """Documented limit: the dropped hand-made row's metadata is gone, so the
    seeded row comes back under the old key (custom, not built-in)."""
    conn = await _setup_real_path(db)
    before = await _snapshot(conn)
    n_relations = await _count(conn, "relations")

    await conn.run_sync(lambda c: mig._sweep(c, OLD, NEW))
    await conn.run_sync(lambda c: mig._unsweep(c, OLD, NEW))
    after = await _snapshot(conn)

    assert after["relation_types"] == [(OLD, False, "is goal for (seed)")]
    assert after["relations"] == before["relations"]
    assert await _count(conn, "relations") == n_relations
    for table, column in _JSONB_CELLS:
        for name in ("hit", "decoy"):
            assert after[(table, column, name)] == before[(table, column, name)]
    assert after[("calculations", "formula", "hit")] == _formula(OLD)
