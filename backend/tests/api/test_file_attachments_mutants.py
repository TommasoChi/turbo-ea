"""Branch / boundary tests for ``app/api/v1/file_attachments.py`` aimed at mutants."""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone
from urllib.parse import quote

import pytest
from sqlalchemy import select

from app.core.permissions import MEMBER_PERMISSIONS, VIEWER_PERMISSIONS
from app.models.app_settings import AppSettings
from app.models.card_type import CardType
from app.models.event import Event
from app.models.file_attachment import FileAttachment
from app.models.stakeholder import Stakeholder
from app.services.attachment_validation import (
    MAX_ATTACHMENT_BYTES,
    InvalidAttachmentError,
    resolve_format,
    validate_content,
)
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
JPEG = b"\xff\xd8\xff\xe0\x00\x10JFIF\x00\x01"


@pytest.fixture
async def env(db):
    await create_role(db, key="admin", label="Admin", permissions={"*": True})
    await create_role(db, key="viewer", label="Viewer", permissions=VIEWER_PERMISSIONS)
    await create_role(db, key="member", label="Member", permissions=MEMBER_PERMISSIONS)
    await create_role(db, key="nodocs", label="NoDocs", permissions={"inventory.view": True})
    admin = await create_user(db, email="admin@test.com", role="admin", display_name="Ada Admin")
    viewer = await create_user(db, email="viewer@test.com", role="viewer")
    nodocs = await create_user(db, email="nodocs@test.com", role="nodocs")
    await create_card_type(db, key="Application", label="Application")
    card = await create_card(db, card_type="Application", name="Card", user_id=admin.id)
    return {"admin": admin, "viewer": viewer, "nodocs": nodocs, "card": card}


def _up(card):
    return f"/api/v1/cards/{card.id}/file-attachments"


async def _post(client, user, card, name="a.pdf", data=PDF, **form):
    return await client.post(
        _up(card),
        files={"file": (name, data, "application/octet-stream")},
        data=form or None,
        headers=auth_headers(user),
    )


async def _put(client, user, att_id, name="b.pdf", data=PDF2, **form):
    return await client.put(
        f"/api/v1/file-attachments/{att_id}/content",
        files={"file": (name, data, "application/octet-stream")},
        data=form or None,
        headers=auth_headers(user),
    )


async def _events(db, card_id, event_type):
    rows = await db.execute(
        select(Event).where(Event.card_id == card_id, Event.event_type == event_type)
    )
    return rows.scalars().all()


async def _set_uploads(db, enabled, *, general=True):
    row = AppSettings(
        id="default", general_settings={"fileUploadsEnabled": enabled} if general else None
    )
    db.add(row)
    await db.flush()


async def _hide_type(db, role="viewer"):
    ct = (await db.execute(select(CardType).where(CardType.key == "Application"))).scalar_one()
    ct.role_permissions = {role: {"inventory.view": False}}
    await db.flush()
    PermissionService.invalidate_type_permission_cache()


async def _stewardship(db, env, user):
    """Give ``user`` card.manage_documents on the env card via a stakeholder role."""
    await create_stakeholder_role_def(
        db,
        card_type_key="Application",
        key="steward",
        permissions={"card.manage_documents": True},
    )
    db.add(Stakeholder(card_id=env["card"].id, user_id=user.id, role="steward"))
    await db.flush()
    PermissionService.invalidate_srd_cache()


ROW_KEYS = {
    "id",
    "card_id",
    "name",
    "mime_type",
    "size",
    "category",
    "created_by",
    "creator_name",
    "created_at",
}


class TestUpload:
    async def test_response_shape(self, client, db, env):
        r = await _post(client, env["admin"], env["card"], category="docs")
        assert r.status_code == 201
        body = r.json()
        assert set(body) == ROW_KEYS
        assert body["card_id"] == str(env["card"].id)
        assert body["name"] == "a.pdf"
        assert body["mime_type"] == "application/pdf"
        assert body["size"] == len(PDF)
        assert body["category"] == "docs"
        assert body["created_by"] == str(env["admin"].id)
        assert body["creator_name"] == "Ada Admin"
        assert body["created_at"]

    async def test_category_defaults_to_none(self, client, db, env):
        r = await _post(client, env["admin"], env["card"])
        assert r.json()["category"] is None

    async def test_event_payload(self, client, db, env):
        r = await _post(client, env["admin"], env["card"], category="docs")
        [ev] = await _events(db, env["card"].id, "file.uploaded")
        assert ev.user_id == env["admin"].id
        assert ev.data["attachment_id"] == r.json()["id"]
        assert ev.data["name"] == "a.pdf"
        assert ev.data["mime_type"] == "application/pdf"
        assert ev.data["size"] == len(PDF)
        assert ev.data["category"] == "docs"
        assert ev.data["summary"] == "a.pdf"

    async def test_bytes_stored_whole(self, client, db, env):
        r = await _post(client, env["admin"], env["card"])
        row = (
            await db.execute(
                select(FileAttachment).where(FileAttachment.id == uuid.UUID(r.json()["id"]))
            )
        ).scalar_one()
        assert row.data == PDF and row.size == len(PDF)

    async def test_forbidden_detail_and_precedence_over_toggle(self, client, db, env):
        await _set_uploads(db, False)
        r = await _post(client, env["viewer"], env["card"])
        assert r.status_code == 403
        assert r.json()["detail"] == "Not enough permissions"

    async def test_uploads_disabled_detail(self, client, db, env):
        await _set_uploads(db, False)
        r = await _post(client, env["admin"], env["card"])
        assert r.status_code == 403
        assert r.json()["detail"] == "File uploads are disabled by the administrator"

    async def test_uploads_enabled_by_default_and_when_flag_missing(self, client, db, env):
        # No settings row at all.
        assert (await _post(client, env["admin"], env["card"])).status_code == 201
        # A row whose general settings are NULL.
        await _set_uploads(db, True, general=False)
        assert (await _post(client, env["admin"], env["card"], name="c.pdf")).status_code == 201

    async def test_explicitly_enabled(self, client, db, env):
        await _set_uploads(db, True)
        assert (await _post(client, env["admin"], env["card"])).status_code == 201

    async def test_stakeholder_with_card_permission_may_upload(self, client, db, env):
        assert (await _post(client, env["viewer"], env["card"])).status_code == 403
        await _stewardship(db, env, env["viewer"])
        assert (await _post(client, env["viewer"], env["card"])).status_code == 201

    async def test_no_documents_permission_is_refused(self, client, db, env):
        r = await _post(client, env["nodocs"], env["card"])
        assert r.status_code == 403

    async def test_bad_extension_detail_is_the_validators(self, client, db, env):
        with pytest.raises(InvalidAttachmentError) as exc:
            resolve_format("evil.exe")
        r = await _post(client, env["admin"], env["card"], name="evil.exe")
        assert r.status_code == 400
        assert r.json()["detail"] == str(exc.value)

    async def test_bad_bytes_detail_is_the_validators(self, client, db, env):
        fmt = resolve_format("a.pdf")
        with pytest.raises(InvalidAttachmentError) as exc:
            validate_content(fmt, b"MZ not a pdf")
        r = await _post(client, env["admin"], env["card"], data=b"MZ not a pdf")
        assert r.status_code == 400
        assert r.json()["detail"] == str(exc.value)

    async def test_oversize_message_exact_and_not_stored(self, client, db, env):
        big = PDF + b"\x00" * (MAX_ATTACHMENT_BYTES - len(PDF) + 1)
        r = await _post(client, env["admin"], env["card"], data=big)
        assert r.status_code == 400
        assert r.json()["detail"] == "File exceeds maximum size of 20 MB"
        rows = (await db.execute(select(FileAttachment))).scalars().all()
        assert rows == []

    async def test_one_under_cap_accepted(self, client, db, env):
        data = PDF + b"\x00" * (MAX_ATTACHMENT_BYTES - len(PDF) - 1)
        r = await _post(client, env["admin"], env["card"], data=data)
        assert r.status_code == 201
        assert r.json()["size"] == MAX_ATTACHMENT_BYTES - 1

    async def test_exactly_at_cap_accepted(self, client, db, env):
        data = PDF + b"\x00" * (MAX_ATTACHMENT_BYTES - len(PDF))
        r = await _post(client, env["admin"], env["card"], data=data)
        assert r.status_code == 201
        assert r.json()["size"] == MAX_ATTACHMENT_BYTES

    async def test_bad_upload_publishes_nothing(self, client, db, env):
        await _post(client, env["admin"], env["card"], name="evil.exe")
        assert await _events(db, env["card"].id, "file.uploaded") == []


class TestReplace:
    async def _base(self, client, env, category="old"):
        r = await _post(client, env["admin"], env["card"], category=category)
        return r.json()["id"]

    async def test_missing_attachment_404_detail(self, client, db, env):
        r = await _put(client, env["admin"], uuid.uuid4())
        assert (r.status_code, r.json()["detail"]) == (404, "File attachment not found")

    async def test_forbidden_detail(self, client, db, env):
        att = await self._base(client, env)
        r = await _put(client, env["viewer"], att)
        assert (r.status_code, r.json()["detail"]) == (403, "Not enough permissions")

    async def test_missing_is_reported_before_toggle(self, client, db, env):
        await _set_uploads(db, False)
        r = await _put(client, env["admin"], uuid.uuid4())
        assert r.status_code == 404

    async def test_toggle_detail(self, client, db, env):
        att = await self._base(client, env)
        await _set_uploads(db, False)
        r = await _put(client, env["admin"], att)
        assert (r.status_code, r.json()["detail"]) == (
            403,
            "File uploads are disabled by the administrator",
        )

    async def test_category_stripped_blank_and_absent(self, client, db, env):
        att = await self._base(client, env)
        r = await _put(client, env["admin"], att, category="  sec  ")
        assert r.json()["category"] == "sec"
        r = await _put(client, env["admin"], att, category="   ")
        assert r.json()["category"] is None
        r = await _put(client, env["admin"], att, category="x")
        r = await _put(client, env["admin"], att)
        assert r.json()["category"] is None

    async def test_response_and_event(self, client, db, env):
        att = await self._base(client, env)
        r = await _put(client, env["admin"], att, name="v2.pdf", data=PDF2, category="n")
        body = r.json()
        assert set(body) == ROW_KEYS
        assert body["creator_name"] == "Ada Admin"
        assert body["created_by"] == str(env["admin"].id)
        assert (body["name"], body["size"], body["mime_type"]) == (
            "v2.pdf",
            len(PDF2),
            "application/pdf",
        )
        [ev] = await _events(db, env["card"].id, "file.replaced")
        assert ev.user_id == env["admin"].id
        assert ev.data["attachment_id"] == att
        assert ev.data["category"] == "n"
        assert ev.data["summary"] == "v2.pdf"
        assert ev.data["mime_type"] == "application/pdf"
        assert ev.data["previous"]["name"] == "a.pdf"
        assert set(ev.data["previous"]) == {
            "name",
            "mime_type",
            "size",
            "created_by",
            "created_at",
        }

    async def test_previous_without_creator(self, client, db, env):
        att = await self._base(client, env)
        row = (
            await db.execute(select(FileAttachment).where(FileAttachment.id == uuid.UUID(att)))
        ).scalar_one()
        row.created_by = None
        await db.flush()
        await _put(client, env["admin"], att)
        [ev] = await _events(db, env["card"].id, "file.replaced")
        assert ev.data["previous"]["created_by"] is None

    async def test_created_by_is_the_replacer(self, client, db, env):
        att = await self._base(client, env)
        member = await create_user(db, email="rep@test.com", role="member", display_name="Rep")
        r = await _put(client, member, att)
        assert r.status_code == 200
        assert r.json()["created_by"] == str(member.id)
        assert r.json()["creator_name"] == "Rep"
        [ev] = await _events(db, env["card"].id, "file.replaced")
        assert ev.user_id == member.id
        assert ev.data["previous"]["created_by"] == str(env["admin"].id)

    async def test_created_at_is_reset_to_now(self, client, db, env):
        att = await self._base(client, env)
        row = (
            await db.execute(select(FileAttachment).where(FileAttachment.id == uuid.UUID(att)))
        ).scalar_one()
        row.created_at = datetime(2001, 1, 1, tzinfo=timezone.utc)
        await db.flush()
        r = await _put(client, env["admin"], att)
        created = datetime.fromisoformat(r.json()["created_at"])
        assert abs(datetime.now(timezone.utc) - created) < timedelta(minutes=5)

    async def test_rejects_bad_uploads_and_keeps_old_bytes(self, client, db, env):
        att = await self._base(client, env)
        assert (await _put(client, env["admin"], att, name="x.exe")).status_code == 400
        assert (await _put(client, env["admin"], att, data=b"nope")).status_code == 400
        big = PDF + b"\x00" * (MAX_ATTACHMENT_BYTES - len(PDF) + 1)
        r = await _put(client, env["admin"], att, data=big)
        assert (r.status_code, r.json()["detail"]) == (
            400,
            "File exceeds maximum size of 20 MB",
        )
        row = (
            await db.execute(select(FileAttachment).where(FileAttachment.id == uuid.UUID(att)))
        ).scalar_one()
        await db.refresh(row)
        assert row.data == PDF
        assert await _events(db, env["card"].id, "file.replaced") == []

    async def test_stakeholder_permission_allows_replace(self, client, db, env):
        att = await self._base(client, env)
        assert (await _put(client, env["viewer"], att)).status_code == 403
        await _stewardship(db, env, env["viewer"])
        assert (await _put(client, env["viewer"], att)).status_code == 200


class TestUpdate:
    async def _base(self, client, env, name="a.pdf", data=PDF, category=None):
        form = {"category": category} if category else {}
        r = await _post(client, env["admin"], env["card"], name=name, data=data, **form)
        return r.json()["id"]

    async def _patch(self, client, user, att, body):
        return await client.patch(
            f"/api/v1/file-attachments/{att}", json=body, headers=auth_headers(user)
        )

    async def test_missing_and_forbidden(self, client, db, env):
        r = await self._patch(client, env["admin"], uuid.uuid4(), {"category": "x"})
        assert (r.status_code, r.json()["detail"]) == (404, "File attachment not found")
        att = await self._base(client, env)
        r = await self._patch(client, env["viewer"], att, {"category": "x"})
        assert (r.status_code, r.json()["detail"]) == (403, "Not enough permissions")

    async def test_rename_event_and_response(self, client, db, env):
        att = await self._base(client, env)
        r = await self._patch(client, env["admin"], att, {"name": "renamed.pdf"})
        body = r.json()
        assert body["name"] == "renamed.pdf"
        assert body["creator_name"] is None
        assert set(body) == ROW_KEYS
        [ev] = await _events(db, env["card"].id, "file.updated")
        assert ev.user_id == env["admin"].id
        assert ev.data["changes"] == {"name": {"old": "a.pdf", "new": "renamed.pdf"}}
        assert ev.data["summary"] == "renamed.pdf"
        assert ev.data["attachment_id"] == att
        assert ev.data["size"] == len(PDF)
        assert ev.data["mime_type"] == "application/pdf"

    async def test_extension_message_is_exact(self, client, db, env):
        att = await self._base(client, env)
        r = await self._patch(client, env["admin"], att, {"name": "a.docx"})
        assert r.status_code == 400
        assert r.json()["detail"] == (
            "Keep the file's extension (.pdf); use Replace to store a different format."
        )

    async def test_extension_message_lists_sorted_family(self, client, db, env):
        att = await self._base(client, env, name="p.jpg", data=JPEG)
        r = await self._patch(client, env["admin"], att, {"name": "p.png"})
        assert r.json()["detail"] == (
            "Keep the file's extension (.jpeg, .jpg); use Replace to store a different format."
        )
        ok = await self._patch(client, env["admin"], att, {"name": "p.JPEG"})
        assert ok.status_code == 200

    async def test_unknown_mime_falls_back_to_current_extension(self, client, db, env):
        row = FileAttachment(
            card_id=env["card"].id,
            name="legacy.dat",
            mime_type="application/x-legacy",
            size=1,
            data=b"x",
        )
        db.add(row)
        await db.flush()
        ok = await self._patch(client, env["admin"], row.id, {"name": "other.dat"})
        assert ok.status_code == 200
        bad = await self._patch(client, env["admin"], row.id, {"name": "other.pdf"})
        assert bad.status_code == 400
        assert "(.dat)" in bad.json()["detail"]

    async def test_category_only_skips_extension_check(self, client, db, env):
        att = await self._base(client, env)
        r = await self._patch(client, env["admin"], att, {"category": "ops"})
        assert r.status_code == 200 and r.json()["category"] == "ops"
        [ev] = await _events(db, env["card"].id, "file.updated")
        assert ev.data["changes"] == {"category": {"old": None, "new": "ops"}}

    async def test_noop_patch_emits_nothing_and_returns_row(self, client, db, env):
        att = await self._base(client, env, category="ops")
        r = await self._patch(client, env["admin"], att, {"name": "a.pdf", "category": "ops"})
        assert r.status_code == 200
        assert r.json()["id"] == att
        assert await _events(db, env["card"].id, "file.updated") == []
        r = await self._patch(client, env["admin"], att, {})
        assert r.status_code == 200
        assert await _events(db, env["card"].id, "file.updated") == []

    async def test_both_fields_change_together(self, client, db, env):
        att = await self._base(client, env, category="ops")
        r = await self._patch(client, env["admin"], att, {"name": "n.pdf", "category": None})
        assert r.json()["category"] is None and r.json()["name"] == "n.pdf"
        [ev] = await _events(db, env["card"].id, "file.updated")
        assert ev.data["changes"] == {
            "name": {"old": "a.pdf", "new": "n.pdf"},
            "category": {"old": "ops", "new": None},
        }

    async def test_not_gated_by_upload_toggle(self, client, db, env):
        att = await self._base(client, env)
        await _set_uploads(db, False)
        r = await self._patch(client, env["admin"], att, {"category": "x"})
        assert r.status_code == 200

    async def test_stakeholder_permission_allows_update(self, client, db, env):
        att = await self._base(client, env)
        await _stewardship(db, env, env["viewer"])
        r = await self._patch(client, env["viewer"], att, {"category": "x"})
        assert r.status_code == 200


class TestList:
    async def test_permission_and_hidden_card(self, client, db, env):
        r = await client.get(_up(env["card"]), headers=auth_headers(env["nodocs"]))
        assert r.status_code == 403
        await _hide_type(db, "viewer")
        r = await client.get(_up(env["card"]), headers=auth_headers(env["viewer"]))
        assert (r.status_code, r.json()["detail"]) == (404, "Card not found")

    async def test_order_newest_first_and_creator_names(self, client, db, env):
        base = datetime(2024, 1, 1, tzinfo=timezone.utc)
        for i, (name, by) in enumerate((("old.pdf", env["admin"].id), ("new.pdf", None))):
            db.add(
                FileAttachment(
                    card_id=env["card"].id,
                    name=name,
                    mime_type="application/pdf",
                    size=1,
                    data=b"x",
                    created_by=by,
                    created_at=base + timedelta(days=i),
                )
            )
        await db.flush()
        r = await client.get(_up(env["card"]), headers=auth_headers(env["admin"]))
        rows = r.json()
        assert [x["name"] for x in rows] == ["new.pdf", "old.pdf"]
        assert rows[0]["creator_name"] is None and rows[0]["created_by"] is None
        assert rows[1]["creator_name"] == "Ada Admin"
        assert set(rows[0]) == ROW_KEYS

    async def test_only_this_cards_files(self, client, db, env):
        other = await create_card(
            db, card_type="Application", name="Other", user_id=env["admin"].id
        )
        await _post(client, env["admin"], other, name="other.pdf")
        r = await client.get(_up(env["card"]), headers=auth_headers(env["admin"]))
        assert r.json() == []


class TestDownload:
    async def _base(self, client, env, name="a.pdf", data=PDF):
        return (await _post(client, env["admin"], env["card"], name=name, data=data)).json()["id"]

    async def test_headers_and_body(self, client, db, env):
        att = await self._base(client, env)
        r = await client.get(
            f"/api/v1/file-attachments/{att}/download", headers=auth_headers(env["viewer"])
        )
        assert r.status_code == 200
        assert r.content == PDF
        assert r.headers["content-type"] == "application/pdf"
        assert r.headers["content-disposition"] == (
            "attachment; filename=\"a.pdf\"; filename*=UTF-8''a.pdf"
        )

    async def test_filename_escaping(self, client, db, env):
        # Inserted directly: a multipart client percent-encodes the quote itself.
        row = FileAttachment(
            card_id=env["card"].id,
            name='we"ird\\ naïve.pdf',
            mime_type="application/pdf",
            size=len(PDF),
            data=PDF,
        )
        db.add(row)
        await db.flush()
        att = str(row.id)
        r = await client.get(
            f"/api/v1/file-attachments/{att}/download", headers=auth_headers(env["admin"])
        )
        cd = r.headers["content-disposition"]
        assert cd.startswith('attachment; filename="we_ird_ na?ve.pdf"; ')
        assert cd.endswith(f"filename*=UTF-8''{quote('we"ird\\ naïve.pdf', safe='')}")
        assert "%20" in cd and "%22" in cd and "%5C" in cd

    async def test_permission_and_404s(self, client, db, env):
        att = await self._base(client, env)
        r = await client.get(
            f"/api/v1/file-attachments/{att}/download", headers=auth_headers(env["nodocs"])
        )
        assert r.status_code == 403
        r = await client.get(
            f"/api/v1/file-attachments/{uuid.uuid4()}/download", headers=auth_headers(env["admin"])
        )
        assert (r.status_code, r.json()["detail"]) == (404, "File attachment not found")

    async def test_hidden_card_is_404(self, client, db, env):
        att = await self._base(client, env)
        await _hide_type(db, "viewer")
        r = await client.get(
            f"/api/v1/file-attachments/{att}/download", headers=auth_headers(env["viewer"])
        )
        assert (r.status_code, r.json()["detail"]) == (404, "Card not found")

    async def test_entity_attachment_has_no_card_scope(self, client, db, env):
        row = FileAttachment(
            card_id=None,
            entity_type="adr",
            entity_id=uuid.uuid4(),
            name="e.pdf",
            mime_type="application/pdf",
            size=len(PDF),
            data=PDF,
        )
        db.add(row)
        await db.flush()
        await _hide_type(db, "viewer")
        r = await client.get(
            f"/api/v1/file-attachments/{row.id}/download", headers=auth_headers(env["viewer"])
        )
        assert r.status_code == 200 and r.content == PDF


class TestDelete:
    async def test_delete_event_and_row(self, client, db, env):
        att = (await _post(client, env["admin"], env["card"], category="c")).json()["id"]
        r = await client.delete(
            f"/api/v1/file-attachments/{att}", headers=auth_headers(env["admin"])
        )
        assert r.status_code == 204 and r.content == b""
        [ev] = await _events(db, env["card"].id, "file.deleted")
        assert ev.user_id == env["admin"].id
        assert ev.data == {
            "attachment_id": att,
            "name": "a.pdf",
            "mime_type": "application/pdf",
            "size": len(PDF),
            "summary": "a.pdf",
        } or {k: v for k, v in ev.data.items() if k != "origin"} == {
            "attachment_id": att,
            "name": "a.pdf",
            "mime_type": "application/pdf",
            "size": len(PDF),
            "summary": "a.pdf",
        }
        gone = (
            await db.execute(select(FileAttachment).where(FileAttachment.id == uuid.UUID(att)))
        ).scalar_one_or_none()
        assert gone is None

    async def test_delete_denials(self, client, db, env):
        att = (await _post(client, env["admin"], env["card"])).json()["id"]
        r = await client.delete(
            f"/api/v1/file-attachments/{att}", headers=auth_headers(env["viewer"])
        )
        assert (r.status_code, r.json()["detail"]) == (403, "Not enough permissions")
        r = await client.delete(
            f"/api/v1/file-attachments/{uuid.uuid4()}", headers=auth_headers(env["admin"])
        )
        assert (r.status_code, r.json()["detail"]) == (404, "File attachment not found")
        assert await _events(db, env["card"].id, "file.deleted") == []

    async def test_stakeholder_permission_allows_delete(self, client, db, env):
        att = (await _post(client, env["admin"], env["card"])).json()["id"]
        await _stewardship(db, env, env["viewer"])
        r = await client.delete(
            f"/api/v1/file-attachments/{att}", headers=auth_headers(env["viewer"])
        )
        assert r.status_code == 204
