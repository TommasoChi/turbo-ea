import pytest

from tests.conftest import (
    auth_headers,
    create_card,
    create_card_type,
    create_relation,
    create_relation_type,
    create_role,
    create_user,
)


@pytest.fixture
async def chart_relations(db):
    await create_role(
        db,
        key="member",
        label="Member",
        permissions={"inventory.view": True, "relations.manage": True},
    )
    user = await create_user(db, email="relation-manager@example.com", role="member")
    for key in ("Organization", "Application"):
        await create_card_type(db, key=key)
    await create_relation_type(
        db, key="org_app", source_type_key="Organization", target_type_key="Application"
    )
    org = await create_card(db, card_type="Organization", name="Position")
    app = await create_card(db, card_type="Application", name="App")
    rel = await create_relation(db, type_key="org_app", source_id=org.id, target_id=app.id)
    return user, org, app, rel


@pytest.mark.parametrize("method", ["post", "patch", "delete"])
async def test_member_cannot_write_organization_relation(client, db, chart_relations, method):
    user, org, app, rel = chart_relations
    body = (
        {"type": "org_app", "source_id": str(org.id), "target_id": str(app.id)}
        if method == "post"
        else {"description": "changed"}
    )
    path = "/api/v1/relations" if method == "post" else f"/api/v1/relations/{rel.id}"
    kwargs = {"headers": auth_headers(user)}
    if method != "delete":
        kwargs["json"] = body
    response = await getattr(client, method)(path, **kwargs)
    assert response.status_code == 403
    await db.refresh(rel)
    assert rel.description is None


@pytest.mark.parametrize("action", ["upsert", "delete"])
async def test_bulk_refuses_organization_relation(client, db, chart_relations, action):
    user, org, app, rel = chart_relations
    await create_relation_type(
        db, key="app_app", source_type_key="Application", target_type_key="Application"
    )
    other = await create_card(db, card_type="Application", name="Other")
    response = await client.post(
        "/api/v1/relations/bulk",
        headers=auth_headers(user),
        json={
            "operations": [
                {
                    "row_index": 0,
                    "action": action,
                    "type": "org_app",
                    "source": {"id": str(org.id)},
                    "target": {"id": str(app.id)},
                    "description": "changed",
                },
                {
                    "row_index": 1,
                    "action": "upsert",
                    "type": "app_app",
                    "source": {"id": str(app.id)},
                    "target": {"id": str(other.id)},
                },
            ]
        },
    )
    assert response.status_code == 200
    assert response.json()["failed"] == 1
    assert response.json()["upserted"] == 1
    await db.refresh(rel)
    assert rel.description is None


async def test_rollback_refuses_organization_relation(client, db, chart_relations):
    from datetime import datetime, timezone

    from app.models.event import Event
    from app.services import mutation_batch_service

    user, org, app, rel = chart_relations
    batch = await mutation_batch_service.create_batch(
        db, tool_name="test", actor=user, origin="ext", dry_run=False
    )
    db.add(
        Event(
            card_id=org.id,
            user_id=user.id,
            event_type="relation.created",
            data={
                "id": str(rel.id),
                "type": rel.type,
                "source_id": str(org.id),
                "target_id": str(app.id),
            },
            batch_id=batch.id,
        )
    )
    batch.committed_at = datetime.now(timezone.utc)
    await db.flush()
    response = await client.post(
        f"/api/v1/mutation-batches/{batch.id}/rollback",
        headers=auth_headers(user),
        json={"dry_run": False},
    )
    assert response.status_code == 403
    await db.refresh(rel)


async def test_unattended_extension_refuses_organization_relation(db, chart_relations):
    from fastapi import HTTPException

    from app.services.card_write_service import WriteActor, upsert_relation

    _, org, app, _ = chart_relations
    with pytest.raises(HTTPException) as exc:
        await upsert_relation(
            db,
            WriteActor(user_id=None, display_name="Extension", ext_key="test"),
            type_key="org_app",
            source_id=org.id,
            target_id=app.id,
            description="changed",
        )
    assert exc.value.status_code == 403


async def test_admin_can_write_organization_relation(client, chart_relations, db):
    _, org, app, _ = chart_relations
    await create_role(db, key="admin", label="Admin", permissions={"*": True})
    admin = await create_user(db, email="org-relation-admin@example.com", role="admin")
    response = await client.post(
        "/api/v1/relations",
        headers=auth_headers(admin),
        json={
            "type": "org_app",
            "source_id": str(org.id),
            "target_id": str(app.id),
            "description": "Admin edit",
        },
    )
    assert response.status_code == 201
    assert response.json()["description"] == "Admin edit"


async def test_hidden_organization_relation_stays_missing(client, db, chart_relations):
    from sqlalchemy import select

    from app.models.card_type import CardType
    from app.services.permission_service import PermissionService

    user, org, app, _ = chart_relations
    org_type = await db.scalar(select(CardType).where(CardType.key == "Organization"))
    org_type.role_permissions = {"member": {"inventory.view": False}}
    await db.flush()
    PermissionService.invalidate_type_permission_cache()
    response = await client.post(
        "/api/v1/relations",
        headers=auth_headers(user),
        json={"type": "org_app", "source_id": str(org.id), "target_id": str(app.id)},
    )
    assert response.status_code == 404
