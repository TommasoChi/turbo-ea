"""Organization role definitions require an effective administrator."""

from tests.conftest import auth_headers, create_card_type, create_role, create_user


async def test_delegated_metamodel_cannot_create_organization_role(client, db):
    await create_role(db, key="delegate", label="Delegate", permissions={"admin.metamodel": True})
    actor = await create_user(db, email="delegate-org@example.com", role="delegate")
    await create_card_type(db, key="Organization", label="Organization")
    response = await client.post(
        "/api/v1/metamodel/types/Organization/stakeholder-roles",
        json={"key": "manager", "label": "Manager"},
        headers=auth_headers(actor),
    )
    assert response.status_code == 403


async def test_admin_position_role_validation(client, db):
    await create_role(db, key="admin", label="Admin", permissions={"*": True})
    admin = await create_user(db, email="admin-org@example.com", role="admin")
    await create_card_type(db, key="Organization", label="Organization")
    await create_card_type(db, key="Application", label="Application")
    headers = auth_headers(admin)
    response = await client.post(
        "/api/v1/metamodel/types/Organization/stakeholder-roles",
        json={"key": "manager", "label": "Manager", "is_position_role": True},
        headers=headers,
    )
    assert response.status_code == 201
    assert response.json()["is_position_role"] is True
    for type_key, role_key in [("Organization", "observer"), ("Application", "manager")]:
        rejected = await client.post(
            f"/api/v1/metamodel/types/{type_key}/stakeholder-roles",
            json={"key": role_key, "label": role_key, "is_position_role": True},
            headers=headers,
        )
        assert rejected.status_code == 422


async def test_member_cannot_observe_organization_but_can_observe_application(client, db):
    from tests.conftest import create_card, create_stakeholder_role_def

    await create_role(db, key="member", label="Member", permissions={"inventory.view": True})
    member = await create_user(db, email="member-org@example.com", role="member")
    for type_key in ("Organization", "Application"):
        await create_card_type(db, key=type_key, label=type_key)
        await create_stakeholder_role_def(
            db, card_type_key=type_key, key="observer", label="Observer"
        )
    org = await create_card(db, card_type="Organization", name="Org", user_id=member.id)
    app = await create_card(db, card_type="Application", name="App", user_id=member.id)
    headers = auth_headers(member)
    for method in (client.get, client.post, client.delete):
        response = await method(f"/api/v1/cards/{org.id}/me/observe", headers=headers)
        assert response.status_code == 403
    response = await client.post(f"/api/v1/cards/{app.id}/me/observe", headers=headers)
    assert response.status_code == 201


async def test_member_cannot_assign_organization_stakeholder(client, db):
    from tests.conftest import create_card, create_stakeholder_role_def

    await create_role(
        db,
        key="member",
        label="Member",
        permissions={"inventory.view": True, "stakeholders.manage": True},
    )
    member = await create_user(db, email="member-assign@example.com", role="member")
    await create_card_type(db, key="Organization", label="Organization")
    await create_stakeholder_role_def(
        db, card_type_key="Organization", key="responsible", label="Responsible"
    )
    card = await create_card(db, card_type="Organization", name="Org", user_id=member.id)
    response = await client.post(
        f"/api/v1/cards/{card.id}/stakeholders",
        json={"user_id": str(member.id), "role": "responsible"},
        headers=auth_headers(member),
    )
    assert response.status_code == 403


async def test_delegated_metamodel_cannot_replace_organization_roles(client, db):
    await create_role(db, key="delegate", label="Delegate", permissions={"admin.metamodel": True})
    actor = await create_user(db, email="delegate-replace@example.com", role="delegate")
    await create_card_type(db, key="Organization", label="Organization")
    response = await client.patch(
        "/api/v1/metamodel/types/Organization",
        json={"stakeholder_roles": [{"key": "manager", "label": "Manager"}]},
        headers=auth_headers(actor),
    )
    assert response.status_code == 403


async def test_member_cannot_patch_organization_or_mixed_bulk(client, db):
    from tests.conftest import create_card

    await create_role(
        db,
        key="member",
        label="Member",
        permissions={"inventory.view": True, "inventory.edit": True, "inventory.bulk_edit": True},
    )
    member = await create_user(db, email="member-edit@example.com", role="member")
    for type_key in ("Organization", "Application"):
        await create_card_type(db, key=type_key, label=type_key)
    org = await create_card(db, card_type="Organization", name="Org", user_id=member.id)
    app = await create_card(db, card_type="Application", name="App", user_id=member.id)
    headers = auth_headers(member)
    response = await client.patch(
        "/api/v1/cards/bulk",
        json={"ids": [str(app.id), str(org.id)], "updates": {"description": "changed"}},
        headers=headers,
    )
    assert response.status_code == 403
    response = await client.patch(
        f"/api/v1/cards/{org.id}", json={"description": "changed"}, headers=headers
    )
    assert response.status_code == 403
    await db.refresh(app)
    await db.refresh(org)
    assert app.description is None
    assert org.description is None


async def test_archive_application_cannot_reparent_organization_child(client, db):
    from tests.conftest import create_card

    await create_role(
        db,
        key="member",
        label="Member",
        permissions={"inventory.view": True, "inventory.archive": True},
    )
    member = await create_user(db, email="member-cascade@example.com", role="member")
    for type_key in ("Organization", "Application"):
        await create_card_type(db, key=type_key, label=type_key)
    parent = await create_card(db, card_type="Application", name="App", user_id=member.id)
    child = await create_card(
        db, card_type="Organization", name="Org", user_id=member.id, parent_id=parent.id
    )
    response = await client.post(
        f"/api/v1/cards/{parent.id}/archive",
        json={"child_strategy": "disconnect"},
        headers=auth_headers(member),
    )
    assert response.status_code == 403
    await db.refresh(parent)
    await db.refresh(child)
    assert parent.status == "ACTIVE"
    assert child.parent_id == parent.id


async def test_admin_can_nominate_organization_responsible(client, db):
    import uuid

    from sqlalchemy import select

    from app.models.stakeholder import Stakeholder
    from tests.conftest import create_stakeholder_role_def

    await create_role(db, key="admin", label="Admin", permissions={"*": True})
    admin = await create_user(db, email="nominate-admin@example.com", role="admin")
    person = await create_user(db, email="nominate-person@example.com", role="admin")
    await create_card_type(db, key="Organization", label="Organization")
    await create_stakeholder_role_def(
        db, card_type_key="Organization", key="responsible", label="Responsible"
    )
    response = await client.post(
        "/api/v1/cards",
        json={
            "type": "Organization",
            "name": "Position",
            "position_responsible_user_id": str(person.id),
        },
        headers=auth_headers(admin),
    )
    assert response.status_code == 201
    rows = (
        await db.scalars(
            select(Stakeholder).where(Stakeholder.card_id == uuid.UUID(response.json()["id"]))
        )
    ).all()
    assert [(row.user_id, row.role) for row in rows] == [(person.id, "responsible")]


async def test_member_owned_rollback_cannot_change_organization(client, db):
    from datetime import datetime, timezone

    from app.models.event import Event
    from app.services import mutation_batch_service
    from tests.conftest import create_card

    await create_role(
        db,
        key="member",
        label="Member",
        permissions={"inventory.view": True, "inventory.edit": True},
    )
    member = await create_user(db, email="member-rollback@example.com", role="member")
    await create_card_type(db, key="Organization", label="Organization")
    card = await create_card(db, card_type="Organization", name="New", user_id=member.id)
    batch = await mutation_batch_service.create_batch(
        db, tool_name="test", actor=member, origin="ext", dry_run=False
    )
    db.add(
        Event(
            card_id=card.id,
            user_id=member.id,
            event_type="card.updated",
            data={"id": str(card.id), "changes": {"name": {"old": "Old", "new": "New"}}},
            batch_id=batch.id,
        )
    )
    batch.committed_at = datetime.now(timezone.utc)
    await db.flush()
    response = await client.post(
        f"/api/v1/mutation-batches/{batch.id}/rollback",
        json={"dry_run": False},
        headers=auth_headers(member),
    )
    assert response.status_code == 403
    await db.refresh(card)
    assert card.name == "New"


async def test_position_role_null_is_rejected_without_modifying_definition(client, db):
    from tests.conftest import create_stakeholder_role_def

    await create_role(db, key="admin", label="Admin", permissions={"*": True})
    admin = await create_user(db, email="role-null@example.com", role="admin")
    await create_card_type(db, key="Organization", label="Organization")
    role = await create_stakeholder_role_def(
        db, card_type_key="Organization", key="manager", label="Manager"
    )
    response = await client.patch(
        "/api/v1/metamodel/types/Organization/stakeholder-roles/manager",
        json={"is_position_role": None},
        headers=auth_headers(admin),
    )
    assert response.status_code == 422
    await db.refresh(role)
    assert role.is_position_role is False
