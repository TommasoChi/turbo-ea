"""Contract tests for migration 128 (SDK 1.2 generic bridge ownership)."""

from __future__ import annotations

import importlib.util
import uuid
from pathlib import Path

import pytest
import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations

_MIG_PATH = (
    Path(__file__).resolve().parents[2]
    / "alembic"
    / "versions"
    / "128_extension_sdk_1_2_bridges.py"
)
_spec = importlib.util.spec_from_file_location("mig128", _MIG_PATH)
assert _spec and _spec.loader
mig = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(mig)


class _ScalarResult:
    def __init__(self, value: int) -> None:
        self._value = value

    def scalar_one(self) -> int:
        return self._value


class _Bind:
    def __init__(self, generic_owner_count: int) -> None:
        self.generic_owner_count = generic_owner_count

    def execute(self, _statement):
        return _ScalarResult(self.generic_owner_count)


class _RecordingOp:
    def __init__(self, generic_owner_count: int = 0) -> None:
        self.calls: list[tuple[str, tuple, dict]] = []
        self.bind = _Bind(generic_owner_count)

    def __getattr__(self, name: str):
        def record(*args, **kwargs):
            self.calls.append((name, args, kwargs))

        return record

    def get_bind(self):
        return self.bind


def test_upgrade_adds_generic_audit_and_exactly_one_resource_owner(monkeypatch):
    recorder = _RecordingOp()
    monkeypatch.setattr(mig, "op", recorder)

    mig.upgrade()

    add_columns = {
        (args[0], args[1].name): args[1]
        for name, args, _kwargs in recorder.calls
        if name == "add_column"
    }
    assert set(add_columns) == {
        ("events", "entity_type"),
        ("events", "entity_id"),
        ("documents", "entity_type"),
        ("documents", "entity_id"),
        ("file_attachments", "entity_type"),
        ("file_attachments", "entity_id"),
    }
    assert all(column.nullable for column in add_columns.values())

    nullable_card_tables = {
        args[0]
        for name, args, kwargs in recorder.calls
        if name == "alter_column" and args[1] == "card_id" and kwargs.get("nullable") is True
    }
    assert nullable_card_tables == {"documents", "file_attachments"}

    constraints = {
        args[0] for name, args, _kwargs in recorder.calls if name == "create_check_constraint"
    }
    assert constraints == {
        "ck_documents_exactly_one_owner",
        "ck_file_attachments_exactly_one_owner",
    }

    indexes = {args[0] for name, args, _kwargs in recorder.calls if name == "create_index"}
    assert indexes == {
        "ix_events_entity_type",
        "ix_events_entity_id",
        "ix_documents_entity_type",
        "ix_documents_entity_id",
        "ix_file_attachments_entity_type",
        "ix_file_attachments_entity_id",
    }


def test_downgrade_refuses_to_orphan_extension_resources(monkeypatch):
    recorder = _RecordingOp(generic_owner_count=1)
    monkeypatch.setattr(mig, "op", recorder)

    with pytest.raises(RuntimeError, match="generic extension resources"):
        mig.downgrade()

    assert recorder.calls == []


def test_downgrade_restores_card_only_schema_when_safe(monkeypatch):
    recorder = _RecordingOp(generic_owner_count=0)
    monkeypatch.setattr(mig, "op", recorder)

    mig.downgrade()

    non_nullable_card_tables = {
        args[0]
        for name, args, kwargs in recorder.calls
        if name == "alter_column" and args[1] == "card_id" and kwargs.get("nullable") is False
    }
    assert non_nullable_card_tables == {"documents", "file_attachments"}


async def test_upgrade_runs_on_postgres_and_enforces_owner_shape(db):
    schema = f"migration_128_{uuid.uuid4().hex}"
    connection = await db.connection()

    def run_upgrade(sync_connection):
        sync_connection.execute(sa.text(f'CREATE SCHEMA "{schema}"'))
        sync_connection.execute(sa.text(f'SET LOCAL search_path TO "{schema}", public'))
        for table_name in ("events", "documents", "file_attachments"):
            sync_connection.execute(
                sa.text(f'CREATE TABLE "{table_name}" (id UUID PRIMARY KEY, card_id UUID NOT NULL)')
            )

        original_op = mig.op
        mig.op = Operations(MigrationContext.configure(sync_connection))
        try:
            mig.upgrade()
        finally:
            mig.op = original_op

        inspector = sa.inspect(sync_connection)
        assert {column["name"]: column["nullable"] for column in inspector.get_columns("events")}[
            "entity_id"
        ]
        for table_name in ("documents", "file_attachments"):
            columns = {
                column["name"]: column["nullable"] for column in inspector.get_columns(table_name)
            }
            assert columns["card_id"] is True
            assert columns["entity_type"] is True
            assert columns["entity_id"] is True
            constraints = {item["name"] for item in inspector.get_check_constraints(table_name)}
            assert f"ck_{table_name}_exactly_one_owner" in constraints

            sync_connection.execute(
                sa.text(f'INSERT INTO "{table_name}" (id, card_id) VALUES (:id, :card_id)'),
                {"id": uuid.uuid4(), "card_id": uuid.uuid4()},
            )
            sync_connection.execute(
                sa.text(
                    f'INSERT INTO "{table_name}" '
                    "(id, entity_type, entity_id) "
                    "VALUES (:id, :entity_type, :entity_id)"
                ),
                {
                    "id": uuid.uuid4(),
                    "entity_type": "ext.swot-analysis.analysis",
                    "entity_id": uuid.uuid4(),
                },
            )
            with pytest.raises(sa.exc.IntegrityError):
                with sync_connection.begin_nested():
                    sync_connection.execute(
                        sa.text(f'INSERT INTO "{table_name}" (id) VALUES (:id)'),
                        {"id": uuid.uuid4()},
                    )

    await connection.run_sync(run_upgrade)
