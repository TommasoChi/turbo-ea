"""Enabled cone authorization keeps module gates and the real actor."""

from sqlalchemy import select

from app.models.event import Event
from app.models.stakeholder import Stakeholder
from app.models.stakeholder_role_definition import StakeholderRoleDefinition
from app.services import organization_cones
from app.services.permission_service import PermissionService
from tests.conftest import auth_headers, create_card, create_card_type, create_role, create_user


async def _setup(db, monkeypatch, type_key, app_permissions):
    await create_role(db, key="module_cone", label="Manager", permissions=app_permissions)
    await create_card_type(db, key="Organization", has_hierarchy=True)
    await create_card_type(db, key=type_key)
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
                card_type_key=type_key,
                key="editor",
                label="Editor",
                permissions={"card.view": True, "card.edit": True},
            ),
        ]
    )
    manager = await create_user(db, email="module-cone-manager@example.com", role="module_cone")
    report = await create_user(db, email="module-cone-report@example.com", role="module_cone")
    root = await create_card(db, card_type="Organization", name="Root")
    child = await create_card(db, card_type="Organization", name="Child", parent_id=root.id)
    root.organization_cone_state = child.organization_cone_state = "connected"
    target = await create_card(db, card_type=type_key, name="Target")
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
    PermissionService.invalidate_role_cache("module_cone")
    return manager, target


async def test_ppm_requires_both_function_permissions_even_with_inherited_edit(
    client, db, monkeypatch
):
    manager, target = await _setup(db, monkeypatch, "Initiative", {"ppm.view": True})
    url = f"/api/v1/ppm/initiatives/{target.id}/tasks"
    denied = await client.post(url, json={"title": "Task"}, headers=auth_headers(manager))
    assert denied.status_code == 403
    from app.models.role import Role

    role = await db.scalar(select(Role).where(Role.key == "module_cone"))
    role.permissions = {"ppm.manage": True}
    await db.flush()
    PermissionService.invalidate_role_cache("module_cone")
    denied = await client.post(url, json={"title": "Task"}, headers=auth_headers(manager))
    assert denied.status_code == 403
    role.permissions = {"ppm.view": True, "ppm.manage": True}
    await db.flush()
    PermissionService.invalidate_role_cache("module_cone")
    allowed = await client.post(url, json={"title": "Task"}, headers=auth_headers(manager))
    assert allowed.status_code == 200


async def test_bpm_draft_and_card_audit_use_inherited_edit_and_real_actor(client, db, monkeypatch):
    manager, target = await _setup(db, monkeypatch, "BusinessProcess", {"bpm.view": True})
    response = await client.get(
        f"/api/v1/bpm/processes/{target.id}/flow/permissions", headers=auth_headers(manager)
    )
    assert response.status_code == 200
    assert response.json()["can_edit_draft"] is True
    updated = await client.patch(
        f"/api/v1/cards/{target.id}", json={"name": "Edited"}, headers=auth_headers(manager)
    )
    assert updated.status_code == 200
    event = await db.scalar(
        select(Event).where(Event.card_id == target.id, Event.event_type == "card.updated")
    )
    assert event.user_id == manager.id
    assert "holder" not in event.data
    assert "path" not in event.data
