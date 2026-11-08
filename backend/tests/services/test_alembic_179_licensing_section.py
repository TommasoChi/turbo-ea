"""Tests for migration 179 (``licensingModel`` moves to its own protected ``Licensing`` section).

Drives the revision's data step ``_data_body`` through ``AsyncConnection.run_sync`` (same
pattern as the 178 test).
"""

from __future__ import annotations

import copy
import importlib.util
from pathlib import Path

from sqlalchemy import select

from app.models.card import Card
from app.models.card_type import CardType
from app.services.licensing_migration import LICENSING_MODEL_FIELD, LICENSING_SECTION
from tests.conftest import create_card, create_card_type

_MIG_PATH = (
    Path(__file__).resolve().parents[2] / "alembic" / "versions" / "179_licensing_model_section.py"
)
_spec = importlib.util.spec_from_file_location("mig179", _MIG_PATH)
mig = importlib.util.module_from_spec(_spec)
assert _spec and _spec.loader
_spec.loader.exec_module(mig)


async def _run(db):
    conn = await db.connection()
    await conn.run_sync(mig._data_body)
    db.expire_all()


async def _schema(db, key):
    row = (await db.execute(select(CardType).where(CardType.key == key))).scalar_one()
    return row.fields_schema


def _keys(schema, section):
    return [f["key"] for s in schema if s["section"] == section for f in s["fields"]]


async def test_moves_the_field_out_of_the_general_section(db):
    await create_card_type(
        db,
        key="Application",
        fields_schema=[
            {
                "section": "Application Information",
                "fields": [
                    {"key": "hostingType", "type": "text"},
                    copy.deepcopy(LICENSING_MODEL_FIELD),
                ],
            }
        ],
    )
    await create_card_type(
        db,
        key="ITComponent",
        fields_schema=[
            {
                "section": "Component Information",
                "fields": [copy.deepcopy(LICENSING_MODEL_FIELD)],
            }
        ],
    )
    card = await create_card(
        db, card_type="Application", name="A", attributes={"licensingModel": ["users"]}
    )
    await db.flush()
    card_id = card.id

    await _run(db)

    app = await _schema(db, "Application")
    assert _keys(app, "Application Information") == ["hostingType"]
    assert _keys(app, LICENSING_SECTION) == ["licensingModel"]
    itc = await _schema(db, "ITComponent")
    assert _keys(itc, LICENSING_SECTION) == ["licensingModel"]
    assert _keys(itc, "Component Information") == []
    attrs = (await db.execute(select(Card.attributes).where(Card.id == card_id))).scalar_one()
    assert attrs == {"licensingModel": ["users"]}  # values are never touched


async def test_restores_a_field_an_admin_deleted_and_is_idempotent(db):
    await create_card_type(
        db,
        key="Application",
        fields_schema=[{"section": "Application Information", "fields": [{"key": "a"}]}],
    )
    await create_card_type(db, key="ITComponent", fields_schema=[])

    await _run(db)

    app = await _schema(db, "Application")
    section = next(s for s in app if s["section"] == LICENSING_SECTION)
    assert section["fields"] == [LICENSING_MODEL_FIELD]  # with its translations
    assert section["translations"]["it"]
    assert _keys(await _schema(db, "ITComponent"), LICENSING_SECTION) == ["licensingModel"]

    before = await _schema(db, "Application")
    await _run(db)
    assert await _schema(db, "Application") == before


async def test_leaves_other_types_alone(db):
    await create_card_type(db, key="Provider", fields_schema=[])
    await _run(db)
    assert await _schema(db, "Provider") == []
