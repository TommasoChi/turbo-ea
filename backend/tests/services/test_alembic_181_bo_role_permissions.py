"""BO navigation grants preserve explicit role overrides on upgrade."""

import importlib.util
from pathlib import Path

import pytest
from sqlalchemy import select, update

from app.models.role import Role
from tests.conftest import create_role

path = Path(__file__).resolve().parents[2] / "alembic/versions/181_bo_role_permissions.py"
spec = importlib.util.spec_from_file_location("mig181", path)
migration = importlib.util.module_from_spec(spec)
spec.loader.exec_module(migration)


async def test_upgrade_adds_only_missing_view_grants_for_seeded_roles(db):
    existing = {
        "admin": {"*": True},
        "member": {"inventory.edit": True},
        "viewer": {"boRelationship.view": False},
        "bpm_admin": {"boRelationship.edit": True},
        "custom": {"inventory.view": True},
    }
    for key, permissions in existing.items():
        await create_role(db, key=key, permissions=permissions)

    conn = await db.connection()
    await conn.run_sync(migration._upgrade_body)
    await conn.run_sync(migration._upgrade_body)

    expected = {
        **existing,
        "member": {"inventory.edit": True, "boRelationship.view": True},
        "bpm_admin": {"boRelationship.edit": True, "boRelationship.view": True},
    }
    rows = await db.execute(select(Role.key, Role.permissions).where(Role.key.in_(existing)))
    assert dict(rows.all()) == expected


@pytest.mark.parametrize("permissions", [{"*": True}, ["legacy"]])
async def test_upgrade_leaves_wildcard_or_non_object_permissions_as_stored(db, permissions):
    role = await create_role(db, key="member")
    await db.execute(update(Role).where(Role.id == role.id).values(permissions=permissions))

    conn = await db.connection()
    await conn.run_sync(migration._upgrade_body)

    stored = await db.scalar(select(Role.permissions).where(Role.key == "member"))
    assert stored == permissions
