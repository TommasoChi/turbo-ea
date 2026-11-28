"""Regression coverage for visibility-cone schema upgrade and rollback."""

from __future__ import annotations

import importlib.util
from pathlib import Path

from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy import select

from app.models.stakeholder_role_definition import StakeholderRoleDefinition
from tests.conftest import create_card, create_card_type, create_role


def _migration():
    path = Path(__file__).resolve().parents[2] / "alembic/versions/204_visibility_cone_inputs.py"
    spec = importlib.util.spec_from_file_location("mig204", path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


async def _run(db, migration, operation):
    connection = await db.connection()

    def run(sync_connection):
        previous = migration.op
        migration.op = Operations(MigrationContext.configure(sync_connection))
        try:
            operation()
        finally:
            migration.op = previous

    await connection.run_sync(run)


async def test_upgrade_initializes_positions_chart_and_role_matrix(db):
    migration = _migration()
    assert migration.down_revision == "203"
    await create_role(db, key="admin", label="Admin", permissions={"*": True})
    await create_role(db, key="member", label="Member", permissions={})
    await create_role(db, key="custom", label="Custom", permissions={})
    organization = await create_card_type(
        db,
        key="Organization",
        role_permissions={"member": {"inventory.view": True, "inventory.edit": True}},
    )
    await create_card_type(db, key="Application")
    definitions = [
        StakeholderRoleDefinition(card_type_key=kind, key=key, label=key, permissions={})
        for kind, key in [
            ("Organization", "responsible"),
            ("Organization", "observer"),
            ("Application", "responsible"),
        ]
    ]
    db.add_all(definitions)
    root = await create_card(db, card_type="Organization", name="Root")
    child = await create_card(db, card_type="Organization", name="Child", parent_id=root.id)
    app = await create_card(db, card_type="Application", name="Application")
    await db.flush()
    root_id, child_id, app_id, organization_id = root.id, child.id, app.id, organization.id
    await _run(db, migration, migration.downgrade)
    await _run(db, migration, migration.upgrade)
    db.expire_all()
    from app.models.card import Card
    from app.models.card_type import CardType

    rows = (await db.execute(select(StakeholderRoleDefinition))).scalars().all()
    flags = {(row.card_type_key, row.key): row.is_position_role for row in rows}
    assert flags[("Organization", "responsible")] is True
    assert flags[("Organization", "observer")] is False
    assert flags[("Application", "responsible")] is False
    states = dict((await db.execute(select(Card.id, Card.organization_cone_state))).all())
    assert states[root_id] == "unconfirmed_root"
    assert states[child_id] == "connected"
    assert states[app_id] is None
    matrix = (
        await db.scalar(select(CardType).where(CardType.id == organization_id))
    ).role_permissions
    assert matrix["member"] == {
        "inventory.view": True,
        "inventory.create": False,
        "inventory.edit": False,
        "inventory.delete": False,
    }
    assert matrix["custom"] == {
        "inventory.create": False,
        "inventory.edit": False,
        "inventory.delete": False,
    }
    assert "admin" not in matrix
    await _run(db, migration, migration.downgrade)
    await _run(db, migration, migration.upgrade)
