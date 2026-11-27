"""Tests for migration 202 (card.edit_costs on stakeholder roles; Member and BPM Admin
leave the PPM and the costs).

The planning helpers are pure; one DB test runs ``upgrade()`` over real rows inside
the rolled-back ``db`` transaction.
"""

from __future__ import annotations

import importlib.util
from pathlib import Path

import pytest
from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy import select

from app.core.permissions import EDIT_COSTS_CARD_PERMISSION
from app.models.role import Role
from app.models.stakeholder_role_definition import StakeholderRoleDefinition
from tests.conftest import create_card_type

_MIG_PATH = (
    Path(__file__).resolve().parents[2] / "alembic" / "versions" / "202_edit_costs_permission.py"
)
_spec = importlib.util.spec_from_file_location("mig202", _MIG_PATH)
assert _spec and _spec.loader
mig = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(mig)


def test_follows_201():
    assert mig.revision == "202"
    assert mig.down_revision == "201"


def test_the_literal_matches_the_runtime():
    assert mig.EDIT_COSTS_KEY == EDIT_COSTS_CARD_PERMISSION == "card.edit_costs"


def test_a_stakeholder_role_takes_the_value_of_card_edit():
    assert mig.plan_stakeholder_permissions({"card.edit": True}) == {
        "card.edit": True,
        "card.edit_costs": True,
    }
    assert mig.plan_stakeholder_permissions({"card.edit": False})["card.edit_costs"] is False


def test_the_key_is_always_written_false_when_card_edit_is_absent():
    assert mig.plan_stakeholder_permissions({}) == {"card.edit_costs": False}
    assert mig.plan_stakeholder_permissions(None) == {"card.edit_costs": False}


@pytest.mark.parametrize("stored", [True, False])
def test_a_stakeholder_map_with_the_key_is_left_alone(stored):
    assert mig.plan_stakeholder_permissions({"card.edit": True, "card.edit_costs": stored}) is None


def test_a_broken_stakeholder_map_is_skipped():
    assert mig.plan_stakeholder_permissions(["card.edit"]) is None


def test_the_stakeholder_input_is_not_mutated():
    stored = {"card.edit": True}
    mig.plan_stakeholder_permissions(stored)
    assert stored == {"card.edit": True}


@pytest.mark.parametrize("role", ["member", "bpm_admin"])
def test_member_and_bpm_admin_lose_ppm_manage_and_costs_view(role):
    plan = mig.plan_role_permissions(
        role, {"ppm.manage": True, "costs.view": True, "ppm.view": True, "inventory.view": True}
    )
    assert plan == {
        "ppm.manage": False,
        "costs.view": False,
        "ppm.view": True,
        "inventory.view": True,
    }


def test_a_role_that_only_holds_one_of_the_two_loses_it_and_no_key_is_invented():
    assert mig.plan_role_permissions("member", {"ppm.manage": True}) == {"ppm.manage": False}
    assert "costs.edit" not in mig.plan_role_permissions("member", {"costs.view": True})


@pytest.mark.parametrize("role", ["admin", "viewer", "ppm_manager", "cost_controller", "custom"])
def test_any_other_role_is_untouched(role):
    assert mig.plan_role_permissions(role, {"ppm.manage": True, "costs.view": True}) is None


@pytest.mark.parametrize("role", ["member", "bpm_admin"])
def test_a_role_already_without_them_is_untouched(role):
    assert mig.plan_role_permissions(role, {"ppm.manage": False, "costs.view": False}) is None
    assert mig.plan_role_permissions(role, {"ppm.view": True}) is None
    assert mig.plan_role_permissions(role, None) is None
    assert mig.plan_role_permissions(role, ["ppm.manage"]) is None


def test_the_role_input_is_not_mutated():
    stored = {"ppm.manage": True}
    mig.plan_role_permissions("member", stored)
    assert stored == {"ppm.manage": True}


def test_downgrade_drops_the_key_and_nothing_else():
    assert mig.unplan_stakeholder_permissions({"card.edit": True, "card.edit_costs": True}) == {
        "card.edit": True
    }
    assert mig.unplan_stakeholder_permissions({"card.edit": True}) is None
    assert mig.unplan_stakeholder_permissions(None) is None


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


async def test_upgrade_rewrites_member_and_stakeholders_only_and_is_idempotent(db):
    for key, perms in (
        ("member", {"ppm.manage": True, "costs.view": True, "ppm.view": True}),
        ("bpm_admin", {"ppm.manage": True, "costs.view": True, "ppm.view": True}),
        ("mig202_custom", {"ppm.manage": True, "costs.view": True}),
        ("admin", {"*": True}),
    ):
        role = await _role(db, key)
        if role is None:
            db.add(Role(key=key, label=key, permissions=perms))
        else:
            role.permissions = perms
    card_type = await create_card_type(db, key="Mig202Type")
    definition = StakeholderRoleDefinition(
        card_type_key=card_type.key,
        key="mig202_editor",
        label="Editor",
        permissions={"card.edit": True},
    )
    db.add(definition)
    await db.flush()
    definition_id = definition.id

    await _run(db, mig.upgrade)
    db.expire_all()

    for key in ("member", "bpm_admin"):
        assert (await _role(db, key)).permissions == {
            "ppm.manage": False,
            "costs.view": False,
            "ppm.view": True,
        }
    assert (await _role(db, "mig202_custom")).permissions == {
        "ppm.manage": True,
        "costs.view": True,
    }
    assert (await _role(db, "admin")).permissions == {"*": True}
    stakeholder = (
        await db.execute(
            select(StakeholderRoleDefinition).where(StakeholderRoleDefinition.id == definition_id)
        )
    ).scalar_one()
    assert stakeholder.permissions == {"card.edit": True, "card.edit_costs": True}

    snapshot = {
        key: (await _role(db, key)).permissions
        for key in ("member", "bpm_admin", "mig202_custom", "admin")
    }
    await _run(db, mig.upgrade)
    db.expire_all()
    for key, permissions in snapshot.items():
        assert (await _role(db, key)).permissions == permissions
    stakeholder = (
        await db.execute(
            select(StakeholderRoleDefinition).where(StakeholderRoleDefinition.id == definition_id)
        )
    ).scalar_one()
    assert stakeholder.permissions == {"card.edit": True, "card.edit_costs": True}
