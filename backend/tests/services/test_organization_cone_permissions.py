"""Per-card inherited authorization stays gated and respects target visibility."""

from app.models.stakeholder import Stakeholder
from app.models.stakeholder_role_definition import StakeholderRoleDefinition
from app.services import organization_cones
from app.services.permission_service import PermissionService
from tests.conftest import create_card, create_card_type, create_role, create_user


async def test_inherited_write_needs_a_read_grant_and_off_gate_blocks_inheritance(db, monkeypatch):
    await create_role(db, key="cone_member", label="Member", permissions={})
    await create_card_type(db, key="Organization")
    await create_card_type(db, key="Application")
    db.add_all(
        [
            StakeholderRoleDefinition(
                card_type_key="Organization",
                key="position",
                label="Position",
                permissions={},
                is_position_role=True,
            ),
            StakeholderRoleDefinition(
                card_type_key="Application",
                key="editor",
                label="Editor",
                permissions={"card.edit": True},
            ),
            StakeholderRoleDefinition(
                card_type_key="Application",
                key="reader",
                label="Reader",
                permissions={"card.view": True},
            ),
        ]
    )
    manager = await create_user(db, email="cone-manager@example.com", role="cone_member")
    report = await create_user(db, email="cone-report@example.com", role="cone_member")
    root = await create_card(db, card_type="Organization", name="Manager")
    child = await create_card(db, card_type="Organization", name="Report", parent_id=root.id)
    root.organization_cone_state = child.organization_cone_state = "connected"
    target = await create_card(db, card_type="Application", name="Target")
    db.add_all(
        [
            Stakeholder(card_id=root.id, user_id=manager.id, role="position"),
            Stakeholder(card_id=child.id, user_id=report.id, role="position"),
            Stakeholder(card_id=target.id, user_id=report.id, role="editor"),
        ]
    )
    await db.flush()
    assert not await PermissionService.has_card_permission(db, manager, target.id, "card.edit")

    async def enabled(_db):
        return True

    monkeypatch.setattr(organization_cones, "organization_cones_enabled", enabled)
    assert not await PermissionService.has_card_permission(db, manager, target.id, "card.edit")
    db.add(Stakeholder(card_id=target.id, user_id=report.id, role="reader"))
    await db.flush()
    assert await PermissionService.has_card_permission(db, manager, target.id, "card.view")
    assert await PermissionService.has_card_permission(db, manager, target.id, "card.edit")


async def test_organization_effective_flags_follow_effective_admin(db):
    await create_role(db, key="admin", label="Admin", permissions={"*": True})
    await create_role(
        db,
        key="member",
        label="Member",
        permissions={"inventory.view": True, "inventory.edit": True},
    )
    await create_card_type(db, key="Organization")
    db.add(
        StakeholderRoleDefinition(
            card_type_key="Organization",
            key="responsible",
            label="Responsible",
            permissions={"card.view": True, "card.edit": True, "card.manage_stakeholders": True},
        )
    )
    member = await create_user(db, email="flags-member@example.com", role="member")
    admin = await create_user(db, email="flags-admin@example.com", role="admin")
    target = await create_card(db, card_type="Organization", name="Position")
    db.add(Stakeholder(card_id=target.id, user_id=member.id, role="responsible"))
    await db.flush()
    member_flags = (await PermissionService.get_effective_card_permissions(db, member, target.id))[
        "effective"
    ]
    assert member_flags["can_view"] is True
    assert member_flags["can_edit"] is False
    assert member_flags["can_manage_stakeholders"] is False
    assert member_flags["can_self_observe"] is False
    admin_flags = (await PermissionService.get_effective_card_permissions(db, admin, target.id))[
        "effective"
    ]
    assert admin_flags["can_edit"] is True
    assert admin_flags["can_manage_stakeholders"] is True
    assert admin_flags["can_self_observe"] is True


async def test_inherited_cost_controller_applies_to_bulk_candidates(db, monkeypatch):
    await create_role(db, key="cost_cone_member", label="Member", permissions={})
    await create_card_type(db, key="Organization")
    await create_card_type(db, key="Application")
    db.add_all(
        [
            StakeholderRoleDefinition(
                card_type_key="Organization",
                key="position",
                label="Position",
                permissions={},
                is_position_role=True,
            ),
            StakeholderRoleDefinition(
                card_type_key="Application",
                key="costController",
                label="Cost Controller",
                permissions={"card.view": True, "card.view_costs": True, "card.edit_costs": True},
            ),
        ]
    )
    manager = await create_user(db, email="cost-cone-manager@example.com", role="cost_cone_member")
    report = await create_user(db, email="cost-cone-report@example.com", role="cost_cone_member")
    root = await create_card(db, card_type="Organization", name="Manager")
    child = await create_card(db, card_type="Organization", name="Report", parent_id=root.id)
    root.organization_cone_state = child.organization_cone_state = "connected"
    target = await create_card(db, card_type="Application", name="Target")
    unrelated = await create_card(db, card_type="Application", name="Unrelated")
    db.add_all(
        [
            Stakeholder(card_id=root.id, user_id=manager.id, role="position"),
            Stakeholder(card_id=child.id, user_id=report.id, role="position"),
            Stakeholder(card_id=target.id, user_id=report.id, role="costController"),
        ]
    )
    await db.flush()

    async def enabled(_db):
        return True

    monkeypatch.setattr(organization_cones, "organization_cones_enabled", enabled)
    assert await PermissionService.can_edit_costs(db, manager, target.id)
    assert not await PermissionService.has_card_permission(db, manager, target.id, "card.edit")
    assert await PermissionService.card_ids_with_cost_access(
        db, manager, [target.id, unrelated.id]
    ) == {target.id}
    assert await PermissionService.card_ids_with_cost_edit_access(
        db, manager, [target.id, unrelated.id]
    ) == {target.id}

    db.add(
        StakeholderRoleDefinition(
            card_type_key="Application",
            key="licenseEditor",
            label="License editor",
            permissions={"card.view_licenses": True, "card.edit": True},
        )
    )
    db.add(Stakeholder(card_id=target.id, user_id=report.id, role="licenseEditor"))
    await db.flush()
    assert await PermissionService.can_view_licenses(db, manager, target.id)
    assert await PermissionService.can_edit_licenses(db, manager, target.id)
    assert await PermissionService.card_ids_with_license_access(
        db, manager, [target.id, unrelated.id]
    ) == {target.id}


async def test_inherited_effective_flags_and_provenance_respect_source_visibility(db, monkeypatch):
    from sqlalchemy import select

    from app.models.role import Role

    await create_role(db, key="provenance_member", label="Member", permissions={})
    await create_card_type(db, key="Organization")
    await create_card_type(db, key="Application")
    db.add_all(
        [
            StakeholderRoleDefinition(
                card_type_key="Organization",
                key="position",
                label="Position",
                permissions={},
                is_position_role=True,
            ),
            StakeholderRoleDefinition(
                card_type_key="Application",
                key="editor",
                label="Editor",
                permissions={"card.view": True, "card.edit": True},
            ),
        ]
    )
    manager = await create_user(
        db, email="provenance-manager@example.com", role="provenance_member"
    )
    report = await create_user(
        db, email="provenance-report@example.com", role="provenance_member", display_name="Report"
    )
    root = await create_card(db, card_type="Organization", name="Manager")
    child = await create_card(
        db, card_type="Organization", name="Report position", parent_id=root.id
    )
    root.organization_cone_state = child.organization_cone_state = "connected"
    target = await create_card(db, card_type="Application", name="Target")
    db.add_all(
        [
            Stakeholder(card_id=root.id, user_id=manager.id, role="position"),
            Stakeholder(card_id=child.id, user_id=report.id, role="position"),
            Stakeholder(card_id=target.id, user_id=report.id, role="editor"),
        ]
    )
    await db.flush()

    async def enabled(_db):
        return True

    monkeypatch.setattr(organization_cones, "organization_cones_enabled", enabled)
    result = await PermissionService.get_effective_card_permissions(db, manager, target.id)
    assert result["effective"]["can_view"] is True
    assert result["effective"]["can_edit"] is True
    assert result["stakeholder_roles"] == []
    assert result["inherited_stakeholder_roles"] == [
        {"role_key": "editor", "source_kind": "generic"}
    ]

    role = await db.scalar(select(Role).where(Role.key == "provenance_member"))
    role.permissions = {"inventory.view": True}
    await db.flush()
    PermissionService.invalidate_role_cache("provenance_member")
    result = await PermissionService.get_effective_card_permissions(db, manager, target.id)
    assert result["inherited_stakeholder_roles"] == [
        {
            "role_key": "editor",
            "source_kind": "visible",
            "holder": {"id": report.id, "display_name": "Report"},
            "path": [
                {"id": root.id, "name": "Manager"},
                {"id": child.id, "name": "Report position"},
            ],
        }
    ]
