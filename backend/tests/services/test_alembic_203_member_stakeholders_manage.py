"""Tests for migration 203 (Member and BPM Admin lose ``stakeholders.manage``)."""

from __future__ import annotations

import importlib.util
from pathlib import Path

import pytest
from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy import select

from app.core.permissions import BPM_ADMIN_PERMISSIONS, MEMBER_PERMISSIONS
from app.models.role import Role

_MIG_PATH = (
    Path(__file__).resolve().parents[2]
    / "alembic"
    / "versions"
    / "203_member_loses_stakeholders_manage.py"
)
_spec = importlib.util.spec_from_file_location("mig203", _MIG_PATH)
assert _spec and _spec.loader
mig = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(mig)


def test_follows_202():
    assert mig.revision == "203"
    assert mig.down_revision == "202"


def test_the_defaults_no_longer_grant_it():
    assert MEMBER_PERMISSIONS["stakeholders.manage"] is False
    assert BPM_ADMIN_PERMISSIONS["stakeholders.manage"] is False


@pytest.mark.parametrize("role", ["member", "bpm_admin"])
def test_member_and_bpm_admin_lose_it(role):
    assert mig.plan_role_permissions(
        role, {"stakeholders.manage": True, "stakeholders.view": True}
    ) == {"stakeholders.manage": False, "stakeholders.view": True}


@pytest.mark.parametrize("role", ["admin", "viewer", "ppm_manager", "custom"])
def test_any_other_role_is_untouched(role):
    assert mig.plan_role_permissions(role, {"stakeholders.manage": True}) is None


@pytest.mark.parametrize("role", ["member", "bpm_admin"])
def test_a_role_already_without_it_is_untouched(role):
    assert mig.plan_role_permissions(role, {"stakeholders.manage": False}) is None
    assert mig.plan_role_permissions(role, {"stakeholders.view": True}) is None
    assert mig.plan_role_permissions(role, None) is None
    assert mig.plan_role_permissions(role, ["stakeholders.manage"]) is None


def test_the_input_is_not_mutated():
    stored = {"stakeholders.manage": True}
    mig.plan_role_permissions("member", stored)
    assert stored == {"stakeholders.manage": True}


async def _run(db, fn):
    connection = await db.connection()

    def go(sync_connection):
        original = mig.op
        mig.op = Operations(MigrationContext.configure(sync_connection))
        try:
            fn()
        finally:
            mig.op = original

    await connection.run_sync(go)


async def _role(db, key):
    return (await db.execute(select(Role).where(Role.key == key))).scalar_one_or_none()


async def test_upgrade_rewrites_the_two_built_in_roles_only_and_is_idempotent(db):
    for key, perms in (
        ("member", {"stakeholders.manage": True, "ppm.view": True}),
        ("bpm_admin", {"stakeholders.manage": True}),
        ("mig203_custom", {"stakeholders.manage": True}),
        ("admin", {"*": True}),
    ):
        role = await _role(db, key)
        if role is None:
            db.add(Role(key=key, label=key, permissions=perms))
        else:
            role.permissions = perms
    await db.flush()

    await _run(db, mig.upgrade)
    await _run(db, mig.upgrade)
    db.expire_all()

    assert (await _role(db, "member")).permissions == {
        "stakeholders.manage": False,
        "ppm.view": True,
    }
    assert (await _role(db, "bpm_admin")).permissions == {"stakeholders.manage": False}
    assert (await _role(db, "mig203_custom")).permissions == {"stakeholders.manage": True}
    assert (await _role(db, "admin")).permissions == {"*": True}

    await _run(db, mig.downgrade)
    db.expire_all()
    assert (await _role(db, "member")).permissions["stakeholders.manage"] is False
