"""Security boundaries on Organization routes and indirect writes."""

import asyncio
import uuid

import pytest
from fastapi import HTTPException
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import async_sessionmaker

from app.api.v1 import tags
from app.models.audit_log import AuditLogEntry
from app.models.card import Card
from app.models.card_type import CardType
from app.models.event import Event
from app.models.role import Role
from app.models.tag import CardTag, Tag, TagGroup
from app.models.user import User
from tests.conftest import (
    auth_headers,
    create_card,
    create_card_type,
    create_role,
    create_stakeholder_role_def,
    create_tag,
    create_tag_group,
    create_user,
)


async def test_organization_nomination_history_never_falls_back_to_email(client, db):
    await create_role(db, key="admin", permissions={"*": True})
    await create_role(db, key="viewer", permissions={"inventory.view": True})
    admin = await create_user(db, role="admin")
    viewer = await create_user(db, role="viewer")
    await create_card_type(db, key="Organization")
    await create_stakeholder_role_def(
        db, card_type_key="Organization", key="responsible", label="Responsible"
    )
    email = "private-nominee@example.com"
    nominee = await client.post(
        "/api/v1/users",
        headers=auth_headers(admin),
        json={"email": email, "display_name": "", "role": "viewer", "send_email": False},
    )
    assert nominee.status_code == 201
    created = await client.post(
        "/api/v1/cards",
        headers=auth_headers(admin),
        json={
            "type": "Organization",
            "name": "Vacant-name position",
            "position_responsible_user_id": nominee.json()["id"],
        },
    )
    assert created.status_code == 201
    card_id = created.json()["id"]
    history = await client.get(f"/api/v1/cards/{card_id}/history", headers=auth_headers(viewer))
    assert history.status_code == 200
    nomination = next(item for item in history.json() if item["event_type"] == "stakeholder.added")
    assert email not in str(nomination)
    persisted = await db.scalar(
        select(Event).where(
            Event.card_id == uuid.UUID(card_id), Event.event_type == "stakeholder.added"
        )
    )
    assert persisted is not None
    assert email not in str(persisted.data)
    assert "Responsible" in persisted.data["summary"]


async def test_restore_hidden_secondary_organization_matches_missing_card(client, db):
    await create_role(
        db,
        key="restorer",
        permissions={"inventory.view": True, "inventory.archive": True},
    )
    restorer = await create_user(db, role="restorer")
    await create_card_type(db, key="Application")
    await create_card_type(
        db, key="Organization", role_permissions={"restorer": {"inventory.view": False}}
    )
    primary = await create_card(db, name="Archived app", status="ARCHIVED")
    hidden = await create_card(db, card_type="Organization", name="Hidden", status="ARCHIVED")
    headers = auth_headers(restorer)
    hidden_response = await client.post(
        f"/api/v1/cards/{primary.id}/restore",
        headers=headers,
        json={"also_restore_card_ids": [str(hidden.id)]},
    )
    missing_response = await client.post(
        f"/api/v1/cards/{primary.id}/restore",
        headers=headers,
        json={"also_restore_card_ids": [str(uuid.uuid4())]},
    )
    assert missing_response.status_code == hidden_response.status_code == 404
    assert missing_response.json() == hidden_response.json()
    await db.refresh(primary)
    await db.refresh(hidden)
    assert primary.status == hidden.status == "ARCHIVED"


@pytest.mark.parametrize("delete_group", [False, True])
async def test_tag_delete_waits_for_committed_organization_assignment(
    test_engine, monkeypatch, delete_group
):
    sessions = async_sessionmaker(test_engine, expire_on_commit=False)
    checked = asyncio.Event()
    committed = asyncio.Event()
    original_guard = tags._require_organization_tag_delete

    async def pause_after_guard(*args, **kwargs):
        await original_guard(*args, **kwargs)
        checked.set()
        await committed.wait()

    monkeypatch.setattr(tags, "_require_organization_tag_delete", pause_after_guard)
    async with sessions() as setup:
        await create_role(setup, key="tag_manager", permissions={"tags.manage": True})
        manager = await create_user(setup, role="tag_manager")
        await create_card_type(setup, key="Organization")
        organization = await create_card(setup, card_type="Organization", name="Position")
        group = await create_tag_group(setup, name="Concurrent group")
        tag = await create_tag(setup, group=group, name="Concurrent tag")
        await setup.commit()
        manager_id, card_id, group_id, tag_id = manager.id, organization.id, group.id, tag.id

    async with sessions() as assignment, sessions() as deletion, sessions() as observer:
        task = None
        try:
            assignment.add(CardTag(card_id=card_id, tag_id=tag_id))
            await assignment.flush()
            actor = await deletion.get(User, manager_id)
            deletion_pid = await deletion.scalar(select(func.pg_backend_pid()))

            async def delete_as_manager():
                try:
                    if delete_group:
                        await tags.delete_tag_group(str(group_id), db=deletion, user=actor)
                    else:
                        await tags.delete_tag(str(group_id), str(tag_id), db=deletion, user=actor)
                except HTTPException as exc:
                    return exc.status_code
                return 204

            task = asyncio.create_task(delete_as_manager())
            async with asyncio.timeout(5):
                while not checked.is_set():
                    if await observer.scalar(select(func.pg_blocking_pids(deletion_pid))):
                        break
                    await asyncio.sleep(0)
            await assignment.commit()
            committed.set()
            assert await asyncio.wait_for(task, timeout=5) == 403
            await deletion.rollback()
            assert await observer.get(Tag, tag_id) is not None
            assert await observer.get(TagGroup, group_id) is not None
            assert await observer.get(CardTag, (card_id, tag_id)) is not None
        finally:
            committed.set()
            if task is not None and not task.done():
                task.cancel()
                await asyncio.gather(task, return_exceptions=True)
            await deletion.rollback()
            await assignment.rollback()
            await observer.rollback()
            async with sessions() as cleanup:
                await cleanup.execute(delete(CardTag).where(CardTag.card_id == card_id))
                await cleanup.execute(delete(Tag).where(Tag.id == tag_id))
                await cleanup.execute(delete(TagGroup).where(TagGroup.id == group_id))
                await cleanup.execute(delete(Event).where(Event.user_id == manager_id))
                await cleanup.execute(
                    delete(AuditLogEntry).where(AuditLogEntry.actor_user_id == manager_id)
                )
                await cleanup.execute(delete(Card).where(Card.id == card_id))
                await cleanup.execute(delete(CardType).where(CardType.key == "Organization"))
                await cleanup.execute(delete(User).where(User.id == manager_id))
                await cleanup.execute(delete(Role).where(Role.key == "tag_manager"))
                await cleanup.commit()
