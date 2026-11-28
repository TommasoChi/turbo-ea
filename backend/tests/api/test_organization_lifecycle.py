"""Organization branches remain suspended across lifecycle changes."""

from tests.conftest import auth_headers, create_card, create_card_type, create_role, create_user


async def test_archiving_parent_disconnects_and_suspends_child(client, db):
    await create_role(db, key="admin", label="Admin", permissions={"*": True})
    admin = await create_user(db, email="chart-admin@example.com", role="admin")
    await create_card_type(db, key="Organization", has_hierarchy=True)
    parent = await create_card(db, card_type="Organization", name="Parent")
    child = await create_card(db, card_type="Organization", name="Child", parent_id=parent.id)
    parent.organization_cone_state = child.organization_cone_state = "connected"
    await db.flush()
    response = await client.post(
        f"/api/v1/cards/{parent.id}/archive",
        headers=auth_headers(admin),
        json={"child_strategy": "disconnect"},
    )
    assert response.status_code == 200
    await db.refresh(child)
    assert child.parent_id is None
    assert child.organization_cone_state == "orphaned"


async def test_non_admin_cannot_change_organization_approval(client, db):
    await create_role(
        db,
        key="member",
        label="Member",
        permissions={"inventory.view": True, "inventory.approval_status": True},
    )
    member = await create_user(db, email="chart-approval@example.com", role="member")
    await create_card_type(db, key="Organization")
    card = await create_card(db, card_type="Organization", name="Position")
    response = await client.post(
        f"/api/v1/cards/{card.id}/approval-status?action=approve", headers=auth_headers(member)
    )
    assert response.status_code == 403
    await db.refresh(card)
    assert card.approval_status == "DRAFT"


async def test_delegated_metamodel_cannot_fix_organization_names(client, db):
    await create_role(
        db,
        key="delegated",
        label="Delegated",
        permissions={"admin.metamodel": True, "inventory.view": True},
    )
    user = await create_user(db, email="chart-fix@example.com", role="delegated")
    await create_card_type(db, key="Organization")
    parent = await create_card(db, card_type="Organization", name="Parent")
    child = await create_card(
        db, card_type="Organization", name="Parent / Child", parent_id=parent.id
    )
    response = await client.post("/api/v1/cards/fix-hierarchy-names", headers=auth_headers(user))
    assert response.status_code == 403
    await db.refresh(child)
    assert child.name == "Parent / Child"


async def test_admin_created_position_has_confirmed_chart_state(client, db):
    from uuid import UUID

    from app.models.card import Card

    await create_role(db, key="admin", label="Admin", permissions={"*": True})
    admin = await create_user(db, email="chart-create@example.com", role="admin")
    await create_card_type(db, key="Organization", has_hierarchy=True)
    response = await client.post(
        "/api/v1/cards", headers=auth_headers(admin), json={"type": "Organization", "name": "Root"}
    )
    assert response.status_code == 201
    card = await db.get(Card, UUID(response.json()["id"]))
    assert card.organization_cone_state == "connected"


async def test_bulk_tags_refuses_mixed_organization_mutation_atomically(client, db):
    from sqlalchemy import select

    from app.models.tag import CardTag
    from tests.conftest import create_tag, create_tag_group

    await create_role(
        db,
        key="member",
        label="Member",
        permissions={"inventory.view": True, "inventory.edit": True},
    )
    user = await create_user(db, email="chart-tag@example.com", role="member")
    await create_card_type(db, key="Organization")
    await create_card_type(db, key="Application")
    organization = await create_card(db, card_type="Organization", name="Position")
    application = await create_card(db, card_type="Application", name="Application")
    tag = await create_tag(db, group=await create_tag_group(db), name="Test")
    response = await client.post(
        "/api/v1/cards/tags/bulk",
        headers=auth_headers(user),
        json={
            "operations": [
                {"card_id": str(application.id), "tag_ids": [str(tag.id)], "mode": "add"},
                {"card_id": str(organization.id), "tag_ids": [str(tag.id)], "mode": "add"},
            ]
        },
    )
    assert response.status_code == 403
    assert (await db.scalars(select(CardTag).where(CardTag.tag_id == tag.id))).all() == []


async def test_explicit_reattachment_to_existing_parent_resumes_only_selected_branch(client, db):
    await create_role(db, key="admin", label="Admin", permissions={"*": True})
    admin = await create_user(db, email="chart-reattach@example.com", role="admin")
    await create_card_type(db, key="Organization", has_hierarchy=True)
    root = await create_card(db, card_type="Organization", name="Root")
    branch = await create_card(db, card_type="Organization", name="Branch", parent_id=root.id)
    nested = await create_card(db, card_type="Organization", name="Nested", parent_id=branch.id)
    root.organization_cone_state = "connected"
    branch.organization_cone_state = nested.organization_cone_state = "orphaned"
    await db.flush()
    response = await client.patch(
        f"/api/v1/cards/{branch.id}",
        headers=auth_headers(admin),
        json={"parent_id": str(root.id), "reattach_organization_branch": True},
    )
    assert response.status_code == 200
    await db.refresh(branch)
    await db.refresh(nested)
    assert branch.organization_cone_state == "connected"
    assert nested.organization_cone_state == "orphaned"


async def test_archived_child_is_suspended_even_without_child_strategy(client, db):
    await create_role(db, key="admin", label="Admin", permissions={"*": True})
    admin = await create_user(db, email="chart-archived@example.com", role="admin")
    await create_card_type(db, key="Organization", has_hierarchy=True)
    parent = await create_card(db, card_type="Organization", name="Parent")
    child = await create_card(
        db, card_type="Organization", name="Child", parent_id=parent.id, status="ARCHIVED"
    )
    parent.organization_cone_state = child.organization_cone_state = "connected"
    await db.flush()
    response = await client.post(f"/api/v1/cards/{parent.id}/archive", headers=auth_headers(admin))
    assert response.status_code == 200
    await db.refresh(child)
    assert child.parent_id == parent.id
    assert child.organization_cone_state == "orphaned"


async def test_reattachment_rejects_suspended_parent_without_changing_branch(client, db):
    await create_role(db, key="admin", label="Admin", permissions={"*": True})
    admin = await create_user(db, email="chart-invalid@example.com", role="admin")
    await create_card_type(db, key="Organization", has_hierarchy=True)
    parent = await create_card(db, card_type="Organization", name="Suspended parent")
    branch = await create_card(db, card_type="Organization", name="Branch")
    parent.organization_cone_state = branch.organization_cone_state = "orphaned"
    await db.flush()
    response = await client.patch(
        f"/api/v1/cards/{branch.id}",
        headers=auth_headers(admin),
        json={"parent_id": str(parent.id), "reattach_organization_branch": True},
    )
    assert response.status_code == 400
    await db.refresh(branch)
    assert branch.parent_id is None
    assert branch.organization_cone_state == "orphaned"


async def test_cascade_restore_keeps_child_suspended(client, db):
    await create_role(db, key="admin", label="Admin", permissions={"*": True})
    admin = await create_user(db, email="chart-cascade@example.com", role="admin")
    await create_card_type(db, key="Organization", has_hierarchy=True)
    parent = await create_card(db, card_type="Organization", name="Parent")
    child = await create_card(db, card_type="Organization", name="Child", parent_id=parent.id)
    parent.organization_cone_state = child.organization_cone_state = "connected"
    await db.flush()
    archived = await client.post(
        f"/api/v1/cards/{parent.id}/archive",
        headers=auth_headers(admin),
        json={"child_strategy": "cascade"},
    )
    assert archived.status_code == 200
    restored = await client.post(
        f"/api/v1/cards/{parent.id}/restore",
        headers=auth_headers(admin),
        json={"also_restore_card_ids": [str(child.id)]},
    )
    assert restored.status_code == 200
    await db.refresh(child)
    assert child.status == "ACTIVE"
    assert child.organization_cone_state == "orphaned"


async def test_hard_delete_detaches_and_suspends_archived_child(client, db):
    await create_role(db, key="admin", label="Admin", permissions={"*": True})
    admin = await create_user(db, email="chart-delete@example.com", role="admin")
    await create_card_type(db, key="Organization", has_hierarchy=True)
    parent = await create_card(db, card_type="Organization", name="Parent")
    child = await create_card(
        db, card_type="Organization", name="Child", parent_id=parent.id, status="ARCHIVED"
    )
    parent.organization_cone_state = child.organization_cone_state = "connected"
    await db.flush()
    response = await client.request(
        "DELETE", f"/api/v1/cards/{parent.id}", headers=auth_headers(admin), json={}
    )
    assert response.status_code == 200
    await db.refresh(child)
    assert child.parent_id is None
    assert child.organization_cone_state == "orphaned"
