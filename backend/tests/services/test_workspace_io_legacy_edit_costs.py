"""A bundle written before ``card.edit_costs`` keeps the cost-editing rights its roles had."""

from __future__ import annotations

import pytest
from sqlalchemy import delete, select

from app.models.role import Role
from app.models.stakeholder_role_definition import StakeholderRoleDefinition
from app.services.workspace_io import apply_bundle, build_bundle, parse_bundle, schema
from app.services.workspace_io import bundle as bundle_io
from tests.conftest import create_card_type, create_user
from tests.services.workspace_io_helpers import reimported_role_permissions

_ROLES = {
    "responsible": {"card.view": True, "card.edit": True},
    "observer": {"card.view": True},
}


@pytest.mark.parametrize(
    ("version", "fork", "expected"),
    [
        ("2.214.0", True, True),
        ("2.214.99", True, True),
        ("2.9.0", True, True),
        ("2.215.0", True, False),
        ("3.0.0", True, False),
        ("0.0.0-dev", True, False),
        ("2.214.0-dev", True, False),
        (None, True, False),
        ("2.230.0", False, True),
        ("2.215.0", False, True),
        (None, False, False),
        ("0.0.0-dev", False, False),
    ],
)
async def test_which_bundles_predate_the_edit_costs_key(version, fork, expected):
    from app.services.workspace_io.applier import _predates_edit_costs

    manifest = {"format_version": "1"}
    if version is not None:
        manifest["app_version"] = version
    sheets = {schema.SHEET_COST_ITEM_TYPES: []} if fork else {}
    assert (
        _predates_edit_costs(bundle_io.WorkspaceBundle(manifest=manifest, sheets=sheets))
        is expected
    )


@pytest.mark.parametrize(("version", "fork"), [("2.214.0", True), ("2.230.0", False)])
@pytest.mark.parametrize("wipe", [True, False])
async def test_an_older_bundle_gives_edit_costs_to_whoever_could_edit(db, version, fork, wipe):
    stored = await reimported_role_permissions(
        db, _ROLES, app_version=version, fork=fork, wipe=wipe, keep_edit_costs=True
    )
    assert stored["responsible"]["card.edit_costs"] is True
    assert stored["observer"]["card.edit_costs"] is False


@pytest.mark.parametrize("version", ["2.215.0", "0.0.0-dev", None])
async def test_a_current_fork_bundle_is_taken_at_its_word(db, version):
    stored = await reimported_role_permissions(
        db, _ROLES, app_version=version, fork=True, keep_edit_costs=True
    )
    assert all("card.edit_costs" not in perms for perms in stored.values())


async def test_an_explicit_edit_costs_value_wins(db):
    roles = {"responsible": {"card.edit": True, "card.edit_costs": False}}
    stored = await reimported_role_permissions(
        db, roles, app_version="2.214.0", fork=True, keep_edit_costs=True
    )
    assert stored["responsible"]["card.edit_costs"] is False


async def test_an_older_bundle_leaves_app_roles_as_carried_and_keeps_missing_roles(db):
    user = await create_user(db, email="edit-costs-ws@test.com", role="admin")
    db.add(Role(key="custom_ec", label="Custom", permissions={"inventory.view": True}))
    await create_card_type(db, key="Application", label="Application")
    db.add(
        StakeholderRoleDefinition(
            card_type_key="Application",
            key="costController",
            label="Cost Controller",
            permissions={"card.view": True},
        )
    )
    await db.flush()
    bundle = parse_bundle(await build_bundle(db))
    bundle.sheets.pop(schema.SHEET_COST_ITEM_TYPES, None)
    bundle.manifest["app_version"] = "2.214.0"
    bundle.sheets[schema.SHEET_STAKEHOLDER_ROLES] = [
        r for r in bundle.sheets[schema.SHEET_STAKEHOLDER_ROLES] if r.get("key") != "costController"
    ]
    await db.execute(delete(Role).where(Role.key == "custom_ec"))
    await db.flush()

    result = await apply_bundle(db, bundle, user)
    assert result.total_failed == 0, result.as_dict()

    role = (await db.execute(select(Role).where(Role.key == "custom_ec"))).scalar_one()
    assert "card.edit_costs" not in role.permissions
    kept = (
        await db.execute(
            select(StakeholderRoleDefinition.permissions).where(
                StakeholderRoleDefinition.key == "costController"
            )
        )
    ).scalar_one()
    assert kept == {"card.view": True}


@pytest.mark.parametrize("version", [None, "0.0.0-dev"])
async def test_a_bundle_with_no_sheet_and_no_usable_version_is_taken_at_its_word(db, version):
    # A content pack has neither the CostItemTypes sheet nor an app_version.
    stored = await reimported_role_permissions(
        db, _ROLES, app_version=version, fork=False, keep_edit_costs=True
    )
    assert stored == _ROLES


async def test_a_bundle_at_the_current_version_keeps_explicit_values(db):
    roles = {
        "a": {"card.edit": True, "card.edit_costs": True},
        "b": {"card.edit": True, "card.edit_costs": False},
        "c": {"card.edit": False, "card.edit_costs": True},
        "d": {"card.edit": False, "card.edit_costs": False},
    }
    stored = await reimported_role_permissions(
        db, roles, app_version="2.215.0", fork=True, keep_edit_costs=True
    )
    assert stored == roles
