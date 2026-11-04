"""Card read scope on the attachment / document WRITE endpoints.

A user whose only access to a card is a stakeholder role granting
``card.manage_documents`` (no ``card.view``) on a card whose type is
View-denied for their app role must get 404 "Card not found" - the card does
not exist for them - never a success and never a 403.
"""

from __future__ import annotations

import uuid

import pytest
from sqlalchemy import func, select

from app.core.permissions import VIEWER_PERMISSIONS
from app.models.card_type import CardType
from app.models.document import Document
from app.models.event import Event
from app.models.file_attachment import FileAttachment
from app.models.stakeholder import Stakeholder
from app.services.permission_service import PermissionService
from tests.conftest import (
    auth_headers,
    create_card,
    create_card_type,
    create_role,
    create_stakeholder_role_def,
    create_user,
)

PDF = b"%PDF-1.7\n%\xe2\xe3\xcf\xd3\ncontent\n"
PDF2 = b"%PDF-1.4\n%second\n"


@pytest.fixture
async def env(db):
    await create_role(db, key="admin", label="Admin", permissions={"*": True})
    await create_role(db, key="viewer", label="Viewer", permissions=VIEWER_PERMISSIONS)
    admin = await create_user(db, email="admin@test.com", role="admin")
    viewer = await create_user(db, email="viewer@test.com", role="viewer")
    await create_card_type(db, key="Application", label="Application")
    card = await create_card(db, card_type="Application", name="Card", user_id=admin.id)
    att = FileAttachment(
        card_id=card.id,
        name="a.pdf",
        mime_type="application/pdf",
        size=len(PDF),
        data=PDF,
        category="spec",
        created_by=admin.id,
    )
    doc = Document(card_id=card.id, name="Doc", url="https://example.com", type="link")
    db.add_all([att, doc])
    await db.flush()
    return {"admin": admin, "viewer": viewer, "card": card, "att": att, "doc": doc}


async def _hide_type(db, role="viewer"):
    ct = (await db.execute(select(CardType).where(CardType.key == "Application"))).scalar_one()
    ct.role_permissions = {role: {"inventory.view": False}}
    await db.flush()
    PermissionService.invalidate_type_permission_cache()


async def _steward(db, env, *, can_view=False):
    perms = {"card.manage_documents": True}
    if can_view:
        perms["card.view"] = True
    await create_stakeholder_role_def(
        db, card_type_key="Application", key="steward", permissions=perms
    )
    db.add(Stakeholder(card_id=env["card"].id, user_id=env["viewer"].id, role="steward"))
    await db.flush()
    PermissionService.invalidate_srd_cache()


async def _event_count(db):
    return (await db.execute(select(func.count()).select_from(Event))).scalar_one()


def _replace(client, user, att_id):
    return client.put(
        f"/api/v1/file-attachments/{att_id}/content",
        files={"file": ("b.pdf", PDF2, "application/octet-stream")},
        headers=auth_headers(user),
    )


def _patch_att(client, user, att_id):
    return client.patch(
        f"/api/v1/file-attachments/{att_id}",
        json={"name": "renamed.pdf"},
        headers=auth_headers(user),
    )


def _delete_att(client, user, att_id):
    return client.delete(f"/api/v1/file-attachments/{att_id}", headers=auth_headers(user))


def _create_doc(client, user, card_id):
    return client.post(
        f"/api/v1/cards/{card_id}/documents",
        json={"name": "New", "url": "https://example.org"},
        headers=auth_headers(user),
    )


def _patch_doc(client, user, doc_id):
    return client.patch(
        f"/api/v1/documents/{doc_id}", json={"name": "Changed"}, headers=auth_headers(user)
    )


def _delete_doc(client, user, doc_id):
    return client.delete(f"/api/v1/documents/{doc_id}", headers=auth_headers(user))


def _assert_hidden(resp):
    assert resp.status_code == 404
    assert resp.json()["detail"] == "Card not found"


class TestHiddenCardAttachments:
    async def test_replace_is_404(self, client, db, env):
        await _hide_type(db)
        await _steward(db, env)
        before = await _event_count(db)
        _assert_hidden(await _replace(client, env["viewer"], env["att"].id))
        await db.refresh(env["att"])
        assert env["att"].name == "a.pdf" and env["att"].data == PDF
        assert await _event_count(db) == before

    async def test_patch_is_404(self, client, db, env):
        await _hide_type(db)
        await _steward(db, env)
        before = await _event_count(db)
        _assert_hidden(await _patch_att(client, env["viewer"], env["att"].id))
        await db.refresh(env["att"])
        assert env["att"].name == "a.pdf"
        assert await _event_count(db) == before

    async def test_delete_is_404(self, client, db, env):
        await _hide_type(db)
        await _steward(db, env)
        before = await _event_count(db)
        _assert_hidden(await _delete_att(client, env["viewer"], env["att"].id))
        assert await db.get(FileAttachment, env["att"].id) is not None
        assert await _event_count(db) == before

    async def test_no_manage_grant_is_still_403_first(self, client, db, env):
        await _hide_type(db)
        resp = await _patch_att(client, env["viewer"], env["att"].id)
        assert resp.status_code == 403


class TestReadableStewardAttachments:
    async def test_replace_patch_delete_work(self, client, db, env):
        await _hide_type(db)
        await _steward(db, env, can_view=True)
        v = env["viewer"]
        assert (await _replace(client, v, env["att"].id)).status_code == 200
        assert (await _patch_att(client, v, env["att"].id)).status_code == 200
        assert (await _delete_att(client, v, env["att"].id)).status_code == 204


class TestAdminAttachments:
    async def test_admin_replace_patch_delete_work(self, client, db, env):
        await _hide_type(db)
        a = env["admin"]
        assert (await _replace(client, a, env["att"].id)).status_code == 200
        assert (await _patch_att(client, a, env["att"].id)).status_code == 200
        assert (await _delete_att(client, a, env["att"].id)).status_code == 204

    async def test_entity_attachment_without_a_card_still_works(self, client, db, env):
        att = FileAttachment(
            card_id=None,
            entity_type="risk",
            entity_id=uuid.uuid4(),
            name="e.pdf",
            mime_type="application/pdf",
            size=len(PDF),
            data=PDF,
        )
        db.add(att)
        await db.flush()
        a = env["admin"]
        assert (await _replace(client, a, att.id)).status_code == 200
        assert (await _patch_att(client, a, att.id)).status_code == 200
        assert (await _delete_att(client, a, att.id)).status_code == 204


class TestHiddenCardDocuments:
    async def test_create_is_404(self, client, db, env):
        await _hide_type(db)
        await _steward(db, env)
        before = await _event_count(db)
        _assert_hidden(await _create_doc(client, env["viewer"], env["card"].id))
        count = (await db.execute(select(func.count()).select_from(Document))).scalar_one()
        assert count == 1
        assert await _event_count(db) == before

    async def test_update_is_404(self, client, db, env):
        await _hide_type(db)
        await _steward(db, env)
        before = await _event_count(db)
        _assert_hidden(await _patch_doc(client, env["viewer"], env["doc"].id))
        await db.refresh(env["doc"])
        assert env["doc"].name == "Doc"
        assert await _event_count(db) == before

    async def test_delete_is_404(self, client, db, env):
        await _hide_type(db)
        await _steward(db, env)
        before = await _event_count(db)
        _assert_hidden(await _delete_doc(client, env["viewer"], env["doc"].id))
        assert await db.get(Document, env["doc"].id) is not None
        assert await _event_count(db) == before


class TestReadableStewardDocuments:
    async def test_create_update_delete_work(self, client, db, env):
        await _hide_type(db)
        await _steward(db, env, can_view=True)
        v = env["viewer"]
        assert (await _create_doc(client, v, env["card"].id)).status_code == 201
        assert (await _patch_doc(client, v, env["doc"].id)).status_code == 200
        assert (await _delete_doc(client, v, env["doc"].id)).status_code == 204


class TestAdminDocuments:
    async def test_admin_create_update_delete_work(self, client, db, env):
        await _hide_type(db)
        a = env["admin"]
        assert (await _create_doc(client, a, env["card"].id)).status_code == 201
        assert (await _patch_doc(client, a, env["doc"].id)).status_code == 200
        assert (await _delete_doc(client, a, env["doc"].id)).status_code == 204

    async def test_create_on_missing_card_is_404_not_500(self, client, db, env):
        _assert_hidden(await _create_doc(client, env["admin"], uuid.uuid4()))

    async def test_entity_document_without_a_card_still_works(self, client, db, env):
        doc = Document(
            card_id=None,
            entity_type="risk",
            entity_id=uuid.uuid4(),
            name="entity doc",
            url="https://example.com/e",
        )
        db.add(doc)
        await db.flush()
        a = env["admin"]
        assert (await _patch_doc(client, a, doc.id)).status_code == 200
        assert (await _delete_doc(client, a, doc.id)).status_code == 204
