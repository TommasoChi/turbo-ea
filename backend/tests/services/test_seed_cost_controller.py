"""Seed of the Cost Controller stakeholder role and the PPM Manager application role."""

from __future__ import annotations

from sqlalchemy import delete, func, select

from app.core.permissions import (
    BPM_ADMIN_PERMISSIONS,
    COST_CONTROLLER_CARD_PERMISSIONS,
    MEMBER_PERMISSIONS,
    PPM_MANAGER_APP_PERMISSIONS,
)
from app.models.role import Role
from app.models.stakeholder_role_definition import StakeholderRoleDefinition
from app.services.seed import seed_metamodel

COST_TYPES = {"Initiative", "Application", "ITComponent"}


async def _cost_controller_rows(db):
    result = await db.execute(
        select(StakeholderRoleDefinition).where(StakeholderRoleDefinition.key == "costController")
    )
    return result.scalars().all()


async def test_cost_controller_exists_on_exactly_the_cost_bearing_types(db):
    await seed_metamodel(db)
    rows = await _cost_controller_rows(db)
    assert {r.card_type_key for r in rows} == COST_TYPES
    for r in rows:
        assert r.label == "Cost Controller"
        assert r.description
        assert r.counts_for_quality is True
        assert r.permissions == COST_CONTROLLER_CARD_PERMISSIONS


async def test_ppm_manager_application_role_is_seeded(db):
    await seed_metamodel(db)
    role = await db.scalar(select(Role).where(Role.key == "ppm_manager"))
    assert role is not None
    assert role.label == "PPM Manager"
    assert role.permissions == PPM_MANAGER_APP_PERMISSIONS
    assert role.is_default is False
    assert role.is_system is False


async def test_member_and_bpm_admin_are_seeded_with_the_new_maps(db):
    await seed_metamodel(db)
    member = await db.scalar(select(Role).where(Role.key == "member"))
    bpm_admin = await db.scalar(select(Role).where(Role.key == "bpm_admin"))
    assert member.permissions == MEMBER_PERMISSIONS
    assert bpm_admin.permissions == BPM_ADMIN_PERMISSIONS


async def test_a_second_run_adds_nothing(db):
    await seed_metamodel(db)
    await db.flush()
    srd = await db.scalar(select(func.count()).select_from(StakeholderRoleDefinition))
    roles = await db.scalar(select(func.count()).select_from(Role))
    await seed_metamodel(db)
    await db.flush()
    assert await db.scalar(select(func.count()).select_from(StakeholderRoleDefinition)) == srd
    assert await db.scalar(select(func.count()).select_from(Role)) == roles


async def test_an_install_seeded_before_the_change_receives_the_roles(db):
    await seed_metamodel(db)
    await db.flush()
    await db.execute(
        delete(StakeholderRoleDefinition).where(StakeholderRoleDefinition.key == "costController")
    )
    await db.execute(delete(Role).where(Role.key == "ppm_manager"))
    await db.flush()
    await seed_metamodel(db)
    await db.flush()
    assert {r.card_type_key for r in await _cost_controller_rows(db)} == COST_TYPES
    assert await db.scalar(select(Role).where(Role.key == "ppm_manager")) is not None


async def test_an_admin_edited_description_is_not_overwritten(db):
    await seed_metamodel(db)
    await db.flush()
    row = (await _cost_controller_rows(db))[0]
    row.description = "Written by an admin"
    await db.flush()
    await seed_metamodel(db)
    await db.flush()
    await db.refresh(row)
    assert row.description == "Written by an admin"
