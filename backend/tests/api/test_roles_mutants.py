"""Boundary / branch tests for ``app/api/v1/roles.py`` aimed at mutants."""

from __future__ import annotations

import pytest
from sqlalchemy import select

from app.core.permissions import APP_PERMISSIONS, VIEWER_PERMISSIONS
from app.models.audit_log import AuditLogEntry
from app.models.role import Role
from app.services.permission_service import PermissionService
from tests.conftest import auth_headers, create_role, create_user


async def _admin(db):
    await create_role(db, key="admin", label="Admin", permissions={"*": True})
    admin = await create_user(db, email="admin@test.com", role="admin")
    return admin, auth_headers(admin)


async def _viewer(db):
    await create_role(db, key="viewer", label="Viewer", permissions=VIEWER_PERMISSIONS)
    viewer = await create_user(db, email="viewer@test.com", role="viewer")
    return viewer, auth_headers(viewer)


async def _audit(db, action):
    await db.rollback()
    return (
        (await db.execute(select(AuditLogEntry).where(AuditLogEntry.action == action)))
        .scalars()
        .all()
    )


@pytest.fixture
def cache_spy(monkeypatch):
    calls: list = []
    monkeypatch.setattr(
        PermissionService, "invalidate_role_cache", staticmethod(lambda k=None: calls.append(k))
    )
    return calls


class TestKeyValidation:
    @pytest.mark.parametrize(
        "key,ok",
        [
            ("abc", True),
            ("a_b", True),
            ("a" + "b" * 48 + "c", True),  # 50 chars
            ("a" + "b" * 49 + "c", False),  # 51 chars
            ("ab", False),
            ("1bc", False),
            ("_bc", False),
            ("abc_", False),
            ("aBc", False),
            ("a-c", False),
            ("ab1", True),
            ("a12", True),
        ],
    )
    async def test_key_pattern(self, client, db, key, ok):
        _, headers = await _admin(db)
        resp = await client.post("/api/v1/roles", json={"key": key, "label": "L"}, headers=headers)
        assert resp.status_code == (201 if ok else 422)

    async def test_key_error_message(self, client, db):
        _, headers = await _admin(db)
        resp = await client.post(
            "/api/v1/roles", json={"key": "Bad Key", "label": "L"}, headers=headers
        )
        assert resp.status_code == 422
        msg = resp.json()["detail"][0]["msg"]
        assert "Key must match ^[a-z][a-z0-9_]{1,48}[a-z0-9]$" in msg
        assert "lowercase letters, digits, underscores, 3-50 chars" in msg

    async def test_label_bounds(self, client, db):
        _, headers = await _admin(db)
        r = await client.post("/api/v1/roles", json={"key": "abc", "label": ""}, headers=headers)
        assert r.status_code == 422
        r = await client.post(
            "/api/v1/roles", json={"key": "abc", "label": "x" * 201}, headers=headers
        )
        assert r.status_code == 422
        r = await client.post(
            "/api/v1/roles", json={"key": "abc", "label": "x" * 200}, headers=headers
        )
        assert r.status_code == 201

    async def test_unknown_permissions_message_is_sorted(self, client, db):
        _, headers = await _admin(db)
        resp = await client.post(
            "/api/v1/roles",
            json={"key": "abc", "label": "L", "permissions": {"zzz.x": True, "aaa.y": True}},
            headers=headers,
        )
        assert resp.status_code == 422
        assert "Unknown permission keys: aaa.y, zzz.x" in resp.json()["detail"][0]["msg"]

    async def test_update_unknown_permissions_message(self, client, db):
        _, headers = await _admin(db)
        await create_role(db, key="member", label="M", is_system=False, permissions={})
        resp = await client.patch(
            "/api/v1/roles/member",
            json={"permissions": {"zzz.x": True, "aaa.y": False}},
            headers=headers,
        )
        assert resp.status_code == 422
        assert "Unknown permission keys: aaa.y, zzz.x" in resp.json()["detail"][0]["msg"]

    async def test_wildcard_key_accepted_in_create_and_update(self, client, db):
        _, headers = await _admin(db)
        r = await client.post(
            "/api/v1/roles",
            json={"key": "root_like", "label": "R", "permissions": {"*": True}},
            headers=headers,
        )
        assert r.status_code == 201
        r = await client.patch(
            "/api/v1/roles/root_like", json={"permissions": {"*": False}}, headers=headers
        )
        assert r.status_code == 200
        assert r.json()["permissions"] == {"*": False}


class TestCreate:
    async def test_defaults_and_response_shape(self, client, db, cache_spy):
        _, headers = await _admin(db)
        resp = await client.post(
            "/api/v1/roles", json={"key": "auditor", "label": "Auditor"}, headers=headers
        )
        assert resp.status_code == 201
        body = resp.json()
        assert body["color"] == "#757575"
        assert body["permissions"] == {}
        assert body["is_default"] is False
        assert body["is_system"] is False
        assert body["is_archived"] is False
        assert body["description"] is None
        assert body["user_count"] == 0
        assert body["archived_at"] is None and body["archived_by"] is None
        assert body["created_at"] is not None
        assert cache_spy == ["auditor"]

    async def test_custom_fields_persisted(self, client, db):
        _, headers = await _admin(db)
        resp = await client.post(
            "/api/v1/roles",
            json={
                "key": "auditor",
                "label": "Auditor",
                "description": "desc",
                "color": "#112233",
                "permissions": {"inventory.view": True},
            },
            headers=headers,
        )
        body = resp.json()
        assert (body["description"], body["color"]) == ("desc", "#112233")
        row = (await db.execute(select(Role).where(Role.key == "auditor"))).scalar_one()
        assert row.permissions == {"inventory.view": True}
        assert row.label == "Auditor" and row.is_system is False

    async def test_requires_permission(self, client, db):
        _, headers = await _viewer(db)
        resp = await client.post(
            "/api/v1/roles", json={"key": "abc", "label": "L"}, headers=headers
        )
        assert resp.status_code == 403
        assert resp.json()["detail"] == "Insufficient permissions"

    async def test_unauthenticated(self, client, db):
        resp = await client.post("/api/v1/roles", json={"key": "abc", "label": "L"})
        assert resp.status_code in (401, 403)

    async def test_duplicate_detail(self, client, db):
        _, headers = await _admin(db)
        resp = await client.post(
            "/api/v1/roles", json={"key": "admin", "label": "L"}, headers=headers
        )
        assert resp.status_code == 409
        assert resp.json()["detail"] == "A role with key 'admin' already exists"

    async def test_default_clears_previous_default_only_when_requested(self, client, db):
        _, headers = await _admin(db)
        old = await create_role(db, key="old_def", label="O", is_system=False, is_default=True)
        r = await client.post("/api/v1/roles", json={"key": "plain", "label": "P"}, headers=headers)
        assert r.status_code == 201
        await db.refresh(old)
        assert old.is_default is True
        r = await client.post(
            "/api/v1/roles",
            json={"key": "newdef", "label": "N", "is_default": True},
            headers=headers,
        )
        assert r.json()["is_default"] is True
        await db.refresh(old)
        assert old.is_default is False

    async def test_default_audit_context(self, client, db):
        _, headers = await _admin(db)
        await client.post(
            "/api/v1/roles",
            json={"key": "newdef", "label": "N", "is_default": True, "color": "#010203"},
            headers=headers,
        )
        [row] = await _audit(db, "admin.role.created")
        assert row.details["context"] == {"color": "#010203", "is_default": True}


class TestListAndGet:
    async def test_order_by_sort_order_then_key(self, client, db):
        _, headers = await _admin(db)
        for key, so in (("zeta", 1), ("beta", 2), ("alpha", 2), ("first", 0)):
            r = await create_role(db, key=key, label=key, is_system=False, permissions={})
            r.sort_order = so
        await db.flush()
        resp = await client.get("/api/v1/roles", headers=headers)
        keys = [r["key"] for r in resp.json()]
        # admin and first share sort_order 0 -> key order breaks the tie.
        assert keys == ["admin", "first", "zeta", "alpha", "beta"]

    async def test_counts_only_active_users(self, client, db):
        _, headers = await _admin(db)
        await create_role(db, key="member", label="M", is_system=False, permissions={})
        await create_user(db, email="m1@test.com", role="member")
        gone = await create_user(db, email="m2@test.com", role="member")
        gone.is_active = False
        await db.flush()
        resp = await client.get("/api/v1/roles", headers=headers)
        by = {r["key"]: r for r in resp.json()}
        assert by["member"]["user_count"] == 1
        assert by["admin"]["user_count"] == 1
        one = await client.get("/api/v1/roles/member", headers=headers)
        assert one.json()["user_count"] == 1
        assert one.json()["permissions"] == {}

    async def test_zero_count_for_empty_role(self, client, db):
        _, headers = await _admin(db)
        await create_role(db, key="empty", label="E", is_system=False, permissions={})
        resp = await client.get("/api/v1/roles", headers=headers)
        assert next(r for r in resp.json() if r["key"] == "empty")["user_count"] == 0
        one = await client.get("/api/v1/roles/empty", headers=headers)
        assert one.json()["user_count"] == 0

    async def test_archived_flag_filter(self, client, db):
        _, headers = await _admin(db)
        r = await create_role(db, key="old_one", label="O", is_system=False, permissions={})
        r.is_archived = True
        await db.flush()
        shown = await client.get("/api/v1/roles?include_archived=true", headers=headers)
        assert "old_one" in [x["key"] for x in shown.json()]
        hidden = await client.get("/api/v1/roles?include_archived=false", headers=headers)
        assert "old_one" not in [x["key"] for x in hidden.json()]

    async def test_non_admin_list_exact_keys(self, client, db):
        _, vh = await _viewer(db)
        resp = await client.get("/api/v1/roles", headers=vh)
        assert set(resp.json()[0]) == {
            "id",
            "key",
            "label",
            "description",
            "is_system",
            "is_default",
            "is_archived",
            "color",
            "sort_order",
            "created_at",
            "updated_at",
            "archived_at",
            "archived_by",
        }

    async def test_get_missing_404(self, client, db):
        _, headers = await _admin(db)
        resp = await client.get("/api/v1/roles/nope", headers=headers)
        assert resp.status_code == 404
        assert resp.json()["detail"] == "Role not found"

    async def test_get_archived_role_returned_with_archive_fields(self, client, db):
        admin, headers = await _admin(db)
        r = await create_role(db, key="old_one", label="O", is_system=False, permissions={})
        r.is_archived = True
        r.archived_by = admin.id
        await db.flush()
        body = (await client.get("/api/v1/roles/old_one", headers=headers)).json()
        assert body["is_archived"] is True
        assert body["archived_by"] == str(admin.id)

    async def test_list_and_get_require_auth(self, client, db):
        for path in ("/api/v1/roles", "/api/v1/roles/admin", "/api/v1/roles/permissions-schema"):
            assert (await client.get(path)).status_code in (401, 403)

    async def test_permissions_schema_payload(self, client, db):
        _, vh = await _viewer(db)
        resp = await client.get("/api/v1/roles/permissions-schema", headers=vh)
        assert resp.status_code == 200
        assert resp.json() == APP_PERMISSIONS


class TestUpdate:
    async def test_requires_permission_before_lookup(self, client, db):
        _, vh = await _viewer(db)
        resp = await client.patch("/api/v1/roles/missing", json={"label": "x"}, headers=vh)
        assert resp.status_code == 403

    async def test_404_detail(self, client, db):
        _, headers = await _admin(db)
        resp = await client.patch("/api/v1/roles/missing", json={"label": "x"}, headers=headers)
        assert resp.status_code == 404
        assert resp.json()["detail"] == "Role not found"

    async def test_archived_detail(self, client, db):
        _, headers = await _admin(db)
        r = await create_role(db, key="old_one", label="O", is_system=False, permissions={})
        r.is_archived = True
        await db.flush()
        resp = await client.patch("/api/v1/roles/old_one", json={"label": "x"}, headers=headers)
        assert resp.status_code == 400
        assert resp.json()["detail"] == "Cannot edit an archived role. Restore it first."

    async def test_admin_wildcard_protection(self, client, db):
        _, headers = await _admin(db)
        for perms in ({}, {"*": False}, {"inventory.view": True}):
            resp = await client.patch(
                "/api/v1/roles/admin", json={"permissions": perms}, headers=headers
            )
            assert resp.status_code == 400
            assert resp.json()["detail"] == "Cannot remove wildcard permission from admin role"
        ok = await client.patch(
            "/api/v1/roles/admin",
            json={"permissions": {"*": True, "inventory.view": True}},
            headers=headers,
        )
        assert ok.status_code == 200

    async def test_admin_non_permission_edit_allowed(self, client, db):
        _, headers = await _admin(db)
        resp = await client.patch(
            "/api/v1/roles/admin", json={"label": "Boss", "color": "#000001"}, headers=headers
        )
        assert resp.status_code == 200
        assert resp.json()["label"] == "Boss"
        assert resp.json()["permissions"] == {"*": True}

    async def test_non_system_role_named_admin_may_drop_wildcard(self, client, db):
        await create_role(db, key="root", label="Root", permissions={"*": True})
        root = await create_user(db, email="root@test.com", role="root")
        await create_role(db, key="admin", label="Fake", permissions={"*": True}, is_system=False)
        resp = await client.patch(
            "/api/v1/roles/admin", json={"permissions": {}}, headers=auth_headers(root)
        )
        assert resp.status_code == 200

    async def test_other_system_role_may_change_permissions(self, client, db):
        _, headers = await _admin(db)
        await create_role(db, key="viewer", label="V", permissions={}, is_system=True)
        resp = await client.patch("/api/v1/roles/viewer", json={"permissions": {}}, headers=headers)
        assert resp.status_code == 200

    async def test_wildcard_role_cannot_be_default(self, client, db):
        _, headers = await _admin(db)
        await create_role(db, key="super", label="S", permissions={"*": True}, is_system=False)
        resp = await client.patch("/api/v1/roles/super", json={"is_default": True}, headers=headers)
        assert resp.status_code == 400
        assert resp.json()["detail"] == (
            "A role with full administrative access cannot be the default role: "
            "new accounts are created with it automatically."
        )
        row = (await db.execute(select(Role).where(Role.key == "super"))).scalar_one()
        assert row.is_default is False

    async def test_wildcard_role_may_unset_default(self, client, db):
        _, headers = await _admin(db)
        await create_role(
            db, key="super", label="S", permissions={"*": True}, is_system=False, is_default=True
        )
        resp = await client.patch(
            "/api/v1/roles/super", json={"is_default": False}, headers=headers
        )
        assert resp.status_code == 200
        assert resp.json()["is_default"] is False

    async def test_default_switch_demotes_others_and_not_self(self, client, db):
        _, headers = await _admin(db)
        await create_role(db, key="a_role", label="A", permissions={}, is_system=False)
        await create_role(
            db, key="b_role", label="B", permissions={}, is_system=False, is_default=True
        )
        # Re-affirming the current default changes nothing and audits nothing.
        r = await client.patch("/api/v1/roles/b_role", json={"is_default": True}, headers=headers)
        assert r.status_code == 200 and r.json()["is_default"] is True
        assert await _audit(db, "admin.role.updated") == []
        # Switching to another demotes this one.
        r = await client.patch("/api/v1/roles/a_role", json={"is_default": True}, headers=headers)
        assert r.json()["is_default"] is True
        b = (await db.execute(select(Role).where(Role.key == "b_role"))).scalar_one()
        await db.refresh(b)
        assert b.is_default is False

    async def test_false_is_default_does_not_demote_others(self, client, db):
        _, headers = await _admin(db)
        await create_role(
            db, key="b_role", label="B", permissions={}, is_system=False, is_default=True
        )
        await create_role(db, key="a_role", label="A", permissions={}, is_system=False)
        r = await client.patch("/api/v1/roles/a_role", json={"is_default": False}, headers=headers)
        assert r.status_code == 200
        b = (await db.execute(select(Role).where(Role.key == "b_role"))).scalar_one()
        await db.refresh(b)
        assert b.is_default is True

    async def test_all_fields_applied_and_response_has_no_user_count(self, client, db, cache_spy):
        _, headers = await _admin(db)
        await create_role(db, key="member", label="M", permissions={}, is_system=False)
        resp = await client.patch(
            "/api/v1/roles/member",
            json={
                "label": "New",
                "description": "d",
                "color": "#abcdef",
                "permissions": {"inventory.view": True},
                "sort_order": 7,
            },
            headers=headers,
        )
        body = resp.json()
        assert body["label"] == "New"
        assert body["description"] == "d"
        assert body["color"] == "#abcdef"
        assert body["permissions"] == {"inventory.view": True}
        assert body["sort_order"] == 7
        assert "user_count" not in body
        assert cache_spy == ["member"]

    async def test_only_sent_fields_change(self, client, db):
        _, headers = await _admin(db)
        r = await create_role(
            db, key="member", label="M", permissions={"a.b": True}, is_system=False
        )
        r.description = "keep"
        await db.flush()
        resp = await client.patch("/api/v1/roles/member", json={"label": "N"}, headers=headers)
        body = resp.json()
        assert body["description"] == "keep"
        assert body["color"] == "#757575"
        assert body["permissions"] == {"a.b": True}

    async def test_update_audit_target_and_changes(self, client, db):
        _, headers = await _admin(db)
        await create_role(db, key="member", label="M", permissions={}, is_system=False)
        await client.patch(
            "/api/v1/roles/member",
            json={"label": "N", "color": "#000002", "sort_order": 3},
            headers=headers,
        )
        [row] = await _audit(db, "admin.role.updated")
        assert row.category == "admin"
        assert row.details["changes"]["label"] == {"old": "M", "new": "N"}
        assert row.details["changes"]["sort_order"] == {"old": 0, "new": 3}
        assert "items" not in row.details


class TestArchiveRestore:
    async def test_requires_permission(self, client, db):
        _, vh = await _viewer(db)
        resp = await client.post("/api/v1/roles/x/archive", headers=vh)
        assert resp.status_code == 403
        resp = await client.post("/api/v1/roles/x/restore", headers=vh)
        assert resp.status_code == 403

    async def test_404s(self, client, db):
        _, headers = await _admin(db)
        for action in ("archive", "restore"):
            r = await client.post(f"/api/v1/roles/nope/{action}", headers=headers)
            assert r.status_code == 404
            assert r.json()["detail"] == "Role not found"

    async def test_check_order_and_details(self, client, db):
        _, headers = await _admin(db)
        await create_role(db, key="sys_def", label="S", is_system=True, is_default=True)
        r = await client.post("/api/v1/roles/sys_def/archive", headers=headers)
        assert (r.status_code, r.json()["detail"]) == (403, "Cannot archive a system role")
        d = await create_role(db, key="def_arch", label="D", is_system=False, is_default=True)
        d.is_archived = True
        await db.flush()
        r = await client.post("/api/v1/roles/def_arch/archive", headers=headers)
        assert r.status_code == 409
        assert r.json()["detail"] == "Cannot archive the default role. Reassign default first."
        a = await create_role(db, key="arch", label="A", is_system=False)
        a.is_archived = True
        await db.flush()
        r = await client.post("/api/v1/roles/arch/archive", headers=headers)
        assert (r.status_code, r.json()["detail"]) == (400, "Role is already archived")

    async def test_archive_sets_fields_and_counts_all_users(self, client, db, cache_spy):
        admin, headers = await _admin(db)
        await create_role(db, key="member", label="M", is_system=False, permissions={})
        await create_user(db, email="m1@test.com", role="member")
        off = await create_user(db, email="m2@test.com", role="member")
        off.is_active = False
        await db.flush()
        r = await client.post("/api/v1/roles/member/archive", headers=headers)
        body = r.json()
        assert r.status_code == 200
        assert body["is_archived"] is True
        assert body["archived_by"] == str(admin.id)
        assert body["archived_at"] is not None
        assert body["affected_users_count"] == 2
        assert "user_count" not in body
        assert cache_spy == ["member"]

    async def test_archive_zero_users(self, client, db):
        _, headers = await _admin(db)
        await create_role(db, key="member", label="M", is_system=False, permissions={})
        r = await client.post("/api/v1/roles/member/archive", headers=headers)
        assert r.json()["affected_users_count"] == 0

    async def test_restore_clears_fields(self, client, db, cache_spy):
        _, headers = await _admin(db)
        await create_role(db, key="member", label="M", is_system=False, permissions={})
        await client.post("/api/v1/roles/member/archive", headers=headers)
        cache_spy.clear()
        resp = await client.post("/api/v1/roles/member/restore", headers=headers)
        body = resp.json()
        assert resp.status_code == 200
        assert body["is_archived"] is False
        assert body["archived_at"] is None
        assert body["archived_by"] is None
        assert cache_spy == ["member"]

    async def test_restore_not_archived_detail(self, client, db):
        _, headers = await _admin(db)
        await create_role(db, key="member", label="M", is_system=False, permissions={})
        r = await client.post("/api/v1/roles/member/restore", headers=headers)
        assert (r.status_code, r.json()["detail"]) == (400, "Role is not archived")
