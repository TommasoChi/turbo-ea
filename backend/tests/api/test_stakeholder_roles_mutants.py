"""Boundary / branch tests for ``app/api/v1/stakeholder_roles.py`` aimed at mutants."""

from __future__ import annotations

import pytest
from sqlalchemy import select

from app.api.v1 import stakeholder_roles as sr
from app.core.permissions import CARD_PERMISSIONS, MEMBER_PERMISSIONS, VIEWER_PERMISSIONS
from app.models.audit_log import AuditLogEntry
from app.models.card_type import CardType
from app.models.stakeholder import Stakeholder
from app.models.stakeholder_role_definition import StakeholderRoleDefinition
from app.models.survey import Survey
from app.services.permission_service import PermissionService
from tests.conftest import (
    auth_headers,
    create_card,
    create_card_type,
    create_role,
    create_stakeholder_role_def,
    create_user,
)

BASE = "/api/v1/metamodel/types/Application/stakeholder-roles"
KEY_RULE = (
    "Key must be 3-50 characters, start with a letter, and contain only letters and digits "
    "(camelCase)"
)


@pytest.fixture
async def env(db):
    await create_role(db, key="admin", label="Admin", permissions={"*": True})
    await create_role(db, key="viewer", label="Viewer", permissions=VIEWER_PERMISSIONS)
    admin = await create_user(db, email="admin@test.com", role="admin")
    viewer = await create_user(db, email="viewer@test.com", role="viewer")
    await create_card_type(db, key="Application", label="Application")
    await create_card_type(db, key="Other", label="Other")
    return {"admin": admin, "viewer": viewer, "h": auth_headers(admin), "vh": auth_headers(viewer)}


@pytest.fixture
def spies(monkeypatch):
    rescored: list = []
    cache: list = []

    async def fake_rescore(db, type_key):
        rescored.append(type_key)
        return 0

    monkeypatch.setattr(sr, "rescore_card_type", fake_rescore)
    monkeypatch.setattr(
        PermissionService,
        "invalidate_srd_cache",
        staticmethod(lambda t=None, k=None: cache.append((t, k))),
    )
    return {"rescored": rescored, "cache": cache}


async def _srd(db, key, type_key="Application", **kw):
    return await create_stakeholder_role_def(
        db, card_type_key=type_key, key=key, label=kw.pop("label", key.title()), **kw
    )


async def _assign(db, type_key, role, n=1, card=None):
    card = card or await create_card(db, card_type=type_key, name=f"c-{role}-{n}")
    for i in range(n):
        u = await create_user(db, role="viewer")
        db.add(Stakeholder(card_id=card.id, user_id=u.id, role=role))
    await db.flush()
    return card


async def _rows(db, action):
    await db.rollback()
    return (
        (
            await db.execute(
                select(AuditLogEntry).where(
                    AuditLogEntry.action == f"admin.stakeholder_role.{action}"
                )
            )
        )
        .scalars()
        .all()
    )


class TestKeyGrammar:
    @pytest.mark.parametrize(
        "key,ok",
        [
            ("abc", True),
            ("ab", False),
            ("a" * 50, True),
            ("a" * 51, False),
            ("Abc", True),
            ("1bc", False),
            ("ab_", False),
            ("a1c", True),
            ("ab-", False),
            ("ab c", False),
        ],
    )
    async def test_create_key(self, client, db, env, key, ok):
        r = await client.post(BASE, json={"key": key, "label": "L"}, headers=env["h"])
        assert r.status_code == (201 if ok else 422)

    async def test_error_message(self, client, db, env):
        r = await client.post(BASE, json={"key": "bad_key", "label": "L"}, headers=env["h"])
        assert r.json()["detail"][0]["msg"].endswith(KEY_RULE)

    async def test_update_key_message_and_none(self, client, db, env):
        await _srd(db, "roleOne")
        r = await client.patch(f"{BASE}/roleOne", json={"key": "bad_key"}, headers=env["h"])
        assert r.status_code == 422
        assert r.json()["detail"][0]["msg"].endswith(KEY_RULE)
        # Absent key is not validated, and a legacy key stays updatable.
        await _srd(db, "legacy_role")
        r = await client.patch(f"{BASE}/legacy_role", json={"label": "x"}, headers=env["h"])
        assert r.status_code == 200

    async def test_update_key_length_bounds(self, client, db, env):
        await _srd(db, "roleOne")
        for key in ("ab", "a" * 51):
            r = await client.patch(f"{BASE}/roleOne", json={"key": key}, headers=env["h"])
            assert r.status_code == 422
        r = await client.patch(f"{BASE}/roleOne", json={"key": "a" * 50}, headers=env["h"])
        assert r.status_code == 200

    async def test_label_bounds(self, client, db, env):
        for label, code in (("", 422), ("x" * 201, 422), ("x" * 200, 201)):
            r = await client.post(BASE, json={"key": "abc", "label": label}, headers=env["h"])
            assert r.status_code == code
            if code == 201:
                await client.delete(f"{BASE}/abc", headers=env["h"])

    async def test_permission_messages_sorted(self, client, db, env):
        body = {"zz.x": True, "aa.y": True}
        r = await client.post(
            BASE, json={"key": "abc", "label": "L", "permissions": body}, headers=env["h"]
        )
        assert "Unknown permission keys: aa.y, zz.x" in r.json()["detail"][0]["msg"]
        await _srd(db, "roleOne")
        r = await client.patch(f"{BASE}/roleOne", json={"permissions": body}, headers=env["h"])
        assert r.status_code == 422
        assert "Unknown permission keys: aa.y, zz.x" in r.json()["detail"][0]["msg"]


class TestCreate:
    async def test_defaults_response_and_side_effects(self, client, db, env, spies):
        r = await client.post(BASE, json={"key": "newRole", "label": "New"}, headers=env["h"])
        assert r.status_code == 201
        body = r.json()
        assert body["color"] == "#757575"
        assert body["counts_for_quality"] is True
        assert body["translations"] == {}
        assert body["permissions"] == {}
        assert body["description"] is None
        assert body["stakeholder_count"] == 0
        assert body["card_type_key"] == "Application"
        assert body["is_archived"] is False
        assert body["sort_order"] == 1
        assert spies["rescored"] == ["Application"]
        assert spies["cache"] == [("Application", "newRole")]

    async def test_non_counting_role_skips_rescore(self, client, db, env, spies):
        r = await client.post(
            BASE,
            json={
                "key": "watcher",
                "label": "W",
                "counts_for_quality": False,
                "color": "#123456",
                "description": "d",
                "translations": {"it": "x"},
                "permissions": {"card.view": True},
            },
            headers=env["h"],
        )
        body = r.json()
        assert r.status_code == 201
        assert spies["rescored"] == []
        assert body["counts_for_quality"] is False
        assert (body["color"], body["description"]) == ("#123456", "d")
        assert body["translations"] == {"it": "x"}
        assert body["permissions"] == {"card.view": True}

    async def test_sort_order_is_max_plus_one_scoped_to_type(self, client, db, env, spies):
        await _srd(db, "first", sort_order=5)
        await _srd(db, "arch", sort_order=9, is_archived=True)
        await _srd(db, "elsewhere", type_key="Other", sort_order=50)
        r = await client.post(BASE, json={"key": "next", "label": "N"}, headers=env["h"])
        assert r.json()["sort_order"] == 10

    async def test_permission_before_type_check(self, client, db, env):
        r = await client.post(
            "/api/v1/metamodel/types/Nope/stakeholder-roles",
            json={"key": "abc", "label": "L"},
            headers=env["vh"],
        )
        assert r.status_code == 403
        assert r.json()["detail"] == "Insufficient permissions"

    async def test_unknown_type_detail(self, client, db, env):
        r = await client.post(
            "/api/v1/metamodel/types/Nope/stakeholder-roles",
            json={"key": "abc", "label": "L"},
            headers=env["h"],
        )
        assert r.status_code == 404
        assert r.json()["detail"] == "Card type 'Nope' not found"

    async def test_duplicate_detail_and_cross_type_allowed(self, client, db, env):
        await _srd(db, "dupRole", type_key="Other")
        ok = await client.post(BASE, json={"key": "dupRole", "label": "L"}, headers=env["h"])
        assert ok.status_code == 201
        r = await client.post(BASE, json={"key": "dupRole", "label": "L"}, headers=env["h"])
        assert r.status_code == 409
        assert (
            r.json()["detail"] == "Stakeholder role 'dupRole' already exists for type 'Application'"
        )

    async def test_audit_context_and_items(self, client, db, env):
        await client.post(
            BASE,
            json={
                "key": "newRole",
                "label": "New",
                "color": "#0a0b0c",
                "counts_for_quality": False,
                "permissions": {"card.view": True, "card.edit": False},
            },
            headers=env["h"],
        )
        [row] = await _rows(db, "created")
        assert row.details["context"] == {
            "color": "#0a0b0c",
            "counts_for_quality": False,
            "card_type": "Application",
        }
        assert row.details["items"] == [{"kind": "permission.granted", "permission": "card.view"}]


class TestListGetUsage:
    async def test_list_order_filter_and_counts(self, client, db, env):
        await _srd(db, "zed", sort_order=1)
        await _srd(db, "bee", sort_order=2)
        await _srd(db, "ayy", sort_order=2)
        await _srd(db, "old", sort_order=0, is_archived=True)
        await _srd(db, "elsewhere", type_key="Other")
        await _assign(db, "Application", "bee", n=2)
        await _assign(db, "Other", "bee", n=3)
        r = await client.get(BASE, headers=env["h"])
        rows = r.json()
        assert [x["key"] for x in rows] == ["zed", "ayy", "bee"]
        assert [x["stakeholder_count"] for x in rows] == [0, 0, 2]
        r = await client.get(f"{BASE}?include_archived=true", headers=env["h"])
        assert [x["key"] for x in r.json()] == ["old", "zed", "ayy", "bee"]

    async def test_list_404_detail(self, client, db, env):
        r = await client.get("/api/v1/metamodel/types/Nope/stakeholder-roles", headers=env["h"])
        assert (r.status_code, r.json()["detail"]) == (404, "Card type 'Nope' not found")

    async def test_counts_hidden_when_type_unreadable(self, client, db, env):
        await create_role(db, key="member", label="Member", permissions=MEMBER_PERMISSIONS)
        member = await create_user(db, email="member@test.com", role="member")
        await _srd(db, "bee")
        await _assign(db, "Application", "bee", n=2)
        ct = (await db.execute(select(CardType).where(CardType.key == "Application"))).scalar_one()
        ct.role_permissions = {"member": {"inventory.view": False}}
        await db.flush()
        PermissionService.invalidate_type_permission_cache()
        hidden = await client.get(BASE, headers=auth_headers(member))
        assert hidden.json()[0]["stakeholder_count"] == 0
        one = await client.get(f"{BASE}/bee", headers=auth_headers(member))
        assert one.json()["stakeholder_count"] == 0
        shown = await client.get(f"{BASE}/bee", headers=env["h"])
        assert shown.json()["stakeholder_count"] == 2

    async def test_get_shapes_and_404s(self, client, db, env):
        s = await _srd(db, "bee", permissions={"card.view": True}, color="#abcdef")
        s.description = "desc"
        s.translations = None
        await db.flush()
        await _assign(db, "Application", "bee", n=1)
        r = await client.get(f"{BASE}/bee", headers=env["vh"])
        assert r.status_code == 200
        body = r.json()
        assert body["stakeholder_count"] == 1
        assert body["translations"] == {}
        assert body["description"] == "desc"
        assert body["permissions"] == {"card.view": True}
        assert body["archived_at"] is None and body["archived_by"] is None
        assert body["created_at"] is not None
        r = await client.get(f"{BASE}/ghost", headers=env["h"])
        assert (r.status_code, r.json()["detail"]) == (404, "Stakeholder role not found")
        r = await client.get("/api/v1/metamodel/types/Nope/stakeholder-roles/bee", headers=env["h"])
        assert r.json()["detail"] == "Card type 'Nope' not found"

    async def test_get_does_not_find_role_of_other_type(self, client, db, env):
        await _srd(db, "elsewhere", type_key="Other")
        r = await client.get(f"{BASE}/elsewhere", headers=env["h"])
        assert r.status_code == 404

    async def test_usage_requires_admin_metamodel(self, client, db, env):
        await _srd(db, "bee")
        r = await client.get(f"{BASE}/bee/usage", headers=env["vh"])
        assert r.status_code == 403

    async def test_usage_404(self, client, db, env):
        r = await client.get(f"{BASE}/ghost/usage", headers=env["h"])
        assert (r.status_code, r.json()["detail"]) == (404, "Stakeholder role not found")

    async def test_usage_counts_and_flags_free_role(self, client, db, env):
        await _srd(db, "bee")
        await _srd(db, "other")
        r = await client.get(f"{BASE}/bee/usage", headers=env["h"])
        assert r.json() == {
            "role_key": "bee",
            "stakeholder_count": 0,
            "card_count": 0,
            "survey_count": 0,
            "is_last_active": False,
            "can_delete": True,
            "can_rekey": True,
        }

    async def test_usage_assigned_blocks_both(self, client, db, env):
        await _srd(db, "bee")
        await _srd(db, "other")
        card = await _assign(db, "Application", "bee", n=2)
        await _assign(db, "Application", "bee", n=1)  # second card
        del card
        r = await client.get(f"{BASE}/bee/usage", headers=env["h"])
        body = r.json()
        assert body["stakeholder_count"] == 3
        assert body["card_count"] == 2
        assert body["can_delete"] is False
        assert body["can_rekey"] is False

    async def test_usage_survey_blocks_only_delete(self, client, db, env):
        await _srd(db, "bee")
        await _srd(db, "other")
        db.add(Survey(name="s", message="", target_type_key="Application", target_roles=["bee"]))
        db.add(Survey(name="s2", message="", target_type_key="Other", target_roles=["bee"]))
        db.add(Survey(name="s3", message="", target_type_key="Application", target_roles=["other"]))
        await db.flush()
        body = (await client.get(f"{BASE}/bee/usage", headers=env["h"])).json()
        assert body["survey_count"] == 1
        assert body["can_delete"] is False
        assert body["can_rekey"] is True

    async def test_usage_last_active_blocks_only_delete(self, client, db, env):
        await _srd(db, "bee")
        await _srd(db, "archived", is_archived=True)
        await _srd(db, "elsewhere", type_key="Other")
        body = (await client.get(f"{BASE}/bee/usage", headers=env["h"])).json()
        assert body["is_last_active"] is True
        assert body["can_delete"] is False
        assert body["can_rekey"] is True


class TestUpdate:
    async def test_permission_404_and_archived(self, client, db, env):
        await _srd(db, "bee")
        r = await client.patch(f"{BASE}/bee", json={"label": "x"}, headers=env["vh"])
        assert r.status_code == 403
        r = await client.patch(f"{BASE}/ghost", json={"label": "x"}, headers=env["h"])
        assert (r.status_code, r.json()["detail"]) == (404, "Stakeholder role not found")
        await _srd(db, "gone", is_archived=True)
        r = await client.patch(f"{BASE}/gone", json={"label": "x"}, headers=env["h"])
        assert r.status_code == 400
        assert r.json()["detail"] == "Cannot edit an archived stakeholder role. Restore it first."

    async def test_fields_applied_response_and_cache(self, client, db, env, spies):
        await _srd(db, "bee", permissions={"card.view": True})
        r = await client.patch(
            f"{BASE}/bee",
            json={
                "label": "Bee",
                "description": "d",
                "color": "#00ff00",
                "sort_order": 4,
                "permissions": {"card.edit": True},
                "translations": {"it": "Ape"},
            },
            headers=env["h"],
        )
        body = r.json()
        assert body["label"] == "Bee"
        assert body["description"] == "d"
        assert body["color"] == "#00ff00"
        assert body["sort_order"] == 4
        assert body["permissions"] == {"card.edit": True}
        assert body["translations"] == {"it": "Ape"}
        assert "stakeholder_count" not in body
        assert spies["cache"] == [("Application", "bee")]
        assert spies["rescored"] == []

    async def test_rekey_in_use_blocked_with_rename_message(self, client, db, env):
        await _srd(db, "bee")
        await _assign(db, "Application", "bee", n=2)
        r = await client.patch(f"{BASE}/bee", json={"key": "wasp"}, headers=env["h"])
        assert r.status_code == 409
        assert r.json()["detail"] == (
            "Cannot rename role 'bee': it is assigned to 2 stakeholder(s) on 1 card(s). "
            "Remove those assignments, or archive the role instead."
        )

    async def test_rekey_clash_detail(self, client, db, env):
        await _srd(db, "bee")
        await _srd(db, "wasp")
        r = await client.patch(f"{BASE}/bee", json={"key": "wasp"}, headers=env["h"])
        assert r.status_code == 409
        assert r.json()["detail"] == "Stakeholder role 'wasp' already exists for type 'Application'"

    async def test_rekey_same_key_is_not_a_rekey(self, client, db, env, spies):
        await _srd(db, "bee")
        await _assign(db, "Application", "bee", n=1)  # would block a real rename
        r = await client.patch(
            f"{BASE}/bee", json={"key": "bee", "label": "Renamed"}, headers=env["h"]
        )
        assert r.status_code == 200
        assert spies["cache"] == [("Application", "bee")]
        [row] = await _rows(db, "updated")
        assert "key" not in row.details["changes"]

    async def test_rekey_follows_into_surveys_jsonb_audit_and_cache(self, client, db, env, spies):
        ct = (await db.execute(select(CardType).where(CardType.key == "Application"))).scalar_one()
        ct.stakeholder_roles = [
            {"key": "bee", "label": "Bee", "color": "#111111"},
            {"key": "other", "label": "Other"},
        ]
        await _srd(db, "bee")
        await _srd(db, "other")
        svy = Survey(
            name="s", message="", target_type_key="Application", target_roles=["bee", "other"]
        )
        untouched = Survey(name="u", message="", target_type_key="Other", target_roles=["bee"])
        db.add_all([svy, untouched])
        await db.flush()
        r = await client.patch(f"{BASE}/bee", json={"key": "wasp"}, headers=env["h"])
        assert r.status_code == 200
        assert r.json()["key"] == "wasp"
        await db.refresh(ct)
        assert ct.stakeholder_roles == [
            {"key": "wasp", "label": "Bee", "color": "#111111"},
            {"key": "other", "label": "Other"},
        ]
        await db.refresh(svy)
        await db.refresh(untouched)
        assert svy.target_roles == ["wasp", "other"]
        assert untouched.target_roles == ["bee"]
        assert spies["cache"] == [("Application", "bee"), ("Application", "wasp")]
        [row] = await _rows(db, "updated")
        assert row.details["changes"]["key"] == {"old": "bee", "new": "wasp"}
        assert row.target_id == "Application:wasp"

    async def test_rekey_with_empty_jsonb_mirror(self, client, db, env):
        await _srd(db, "bee")
        r = await client.patch(f"{BASE}/bee", json={"key": "wasp"}, headers=env["h"])
        assert r.status_code == 200

    async def test_translations_null_becomes_empty(self, client, db, env):
        s = await _srd(db, "bee")
        s.translations = {"it": "x"}
        await db.flush()
        r = await client.patch(f"{BASE}/bee", json={"translations": None}, headers=env["h"])
        assert r.json()["translations"] == {}

    async def test_counts_toggle_rescores_only_on_change(self, client, db, env, spies):
        await _srd(db, "bee", counts_for_quality=True)
        r = await client.patch(
            f"{BASE}/bee", json={"counts_for_quality": True, "label": "x"}, headers=env["h"]
        )
        assert spies["rescored"] == []
        r = await client.patch(f"{BASE}/bee", json={"counts_for_quality": False}, headers=env["h"])
        assert r.json()["counts_for_quality"] is False
        assert spies["rescored"] == ["Application"]
        rows = await _rows(db, "updated")
        assert rows[-1].details["changes"] == {"counts_for_quality": {"old": True, "new": False}}

    async def test_audit_changes_and_permission_items(self, client, db, env):
        await _srd(db, "bee", permissions={"card.view": True, "card.edit": True})
        await client.patch(
            f"{BASE}/bee",
            json={"label": "New", "permissions": {"card.view": True}},
            headers=env["h"],
        )
        [row] = await _rows(db, "updated")
        assert row.details["changes"] == {"label": {"old": "Bee", "new": "New"}}
        assert row.details["items"] == [{"kind": "permission.revoked", "permission": "card.edit"}]
        assert row.details["context"] == {"card_type": "Application"}

    async def test_no_op_writes_no_audit(self, client, db, env):
        await _srd(db, "bee")
        await client.patch(f"{BASE}/bee", json={"label": "Bee"}, headers=env["h"])
        assert await _rows(db, "updated") == []


class TestDelete:
    async def test_permission_and_404(self, client, db, env):
        await _srd(db, "bee")
        await _srd(db, "other")
        assert (await client.delete(f"{BASE}/bee", headers=env["vh"])).status_code == 403
        r = await client.delete(f"{BASE}/ghost", headers=env["h"])
        assert (r.status_code, r.json()["detail"]) == (404, "Stakeholder role not found")

    async def test_delete_messages(self, client, db, env):
        await _srd(db, "bee")
        r = await client.delete(f"{BASE}/bee", headers=env["h"])
        assert r.status_code == 409
        assert r.json()["detail"] == "Cannot delete the last active stakeholder role for this type"
        await _srd(db, "other")
        db.add(Survey(name="s", message="", target_type_key="Application", target_roles=["bee"]))
        await db.flush()
        r = await client.delete(f"{BASE}/bee", headers=env["h"])
        assert (
            r.json()["detail"]
            == "Cannot delete role 'bee': 1 survey(s) target it. Update those surveys first."
        )
        await _assign(db, "Application", "other", n=2)
        r = await client.delete(f"{BASE}/other", headers=env["h"])
        assert r.json()["detail"] == (
            "Cannot delete role 'other': it is assigned to 2 stakeholder(s) on 1 card(s). "
            "Remove those assignments, or archive the role instead."
        )

    async def test_delete_rescoring_cache_and_audit(self, client, db, env, spies):
        await _srd(db, "bee", counts_for_quality=True)
        await _srd(db, "watch", counts_for_quality=False)
        r = await client.delete(f"{BASE}/bee", headers=env["h"])
        assert r.status_code == 204 and r.content == b""
        assert spies["rescored"] == ["Application"]
        assert spies["cache"] == [("Application", "bee")]
        r = await client.delete(f"{BASE}/watch", headers=env["h"])
        # watch is now the last active role -> refused; make another first
        assert r.status_code == 409
        [row] = await _rows(db, "deleted")
        assert row.target_id == "Application:bee"
        gone = (
            await db.execute(
                select(StakeholderRoleDefinition).where(StakeholderRoleDefinition.key == "bee")
            )
        ).scalar_one_or_none()
        assert gone is None

    async def test_delete_non_counting_skips_rescore(self, client, db, env, spies):
        await _srd(db, "bee")
        await _srd(db, "watch", counts_for_quality=False)
        r = await client.delete(f"{BASE}/watch", headers=env["h"])
        assert r.status_code == 204
        assert spies["rescored"] == []

    async def test_other_type_assignments_dont_block(self, client, db, env):
        await _srd(db, "bee")
        await _srd(db, "other")
        await _assign(db, "Other", "bee", n=2)
        r = await client.delete(f"{BASE}/bee", headers=env["h"])
        assert r.status_code == 204


class TestArchiveRestore:
    async def test_permission_and_404(self, client, db, env):
        await _srd(db, "bee")
        for action in ("archive", "restore"):
            assert (await client.post(f"{BASE}/bee/{action}", headers=env["vh"])).status_code == 403
            r = await client.post(f"{BASE}/ghost/{action}", headers=env["h"])
            assert (r.status_code, r.json()["detail"]) == (404, "Stakeholder role not found")

    async def test_archive_guards(self, client, db, env):
        await _srd(db, "bee")
        await _srd(db, "gone", is_archived=True)
        await _srd(db, "elsewhere", type_key="Other")
        r = await client.post(f"{BASE}/gone/archive", headers=env["h"])
        assert (r.status_code, r.json()["detail"]) == (400, "Stakeholder role is already archived")
        r = await client.post(f"{BASE}/bee/archive", headers=env["h"])
        assert r.status_code == 409
        assert r.json()["detail"] == "Cannot archive the last active stakeholder role for this type"

    async def test_archive_effects(self, client, db, env, spies):
        await _srd(db, "bee", counts_for_quality=True)
        await _srd(db, "other")
        await _assign(db, "Application", "bee", n=3)
        await _assign(db, "Other", "bee", n=2)
        r = await client.post(f"{BASE}/bee/archive", headers=env["h"])
        body = r.json()
        assert r.status_code == 200
        assert body["is_archived"] is True
        assert body["archived_by"] == str(env["admin"].id)
        assert body["archived_at"] is not None
        assert body["affected_stakeholders_count"] == 3
        assert "stakeholder_count" not in body
        assert spies["rescored"] == ["Application"]
        assert spies["cache"] == [("Application", "bee")]
        [row] = await _rows(db, "archived")
        assert row.details["context"] == {"affected_stakeholders": 3, "card_type": "Application"}

    async def test_archive_non_counting_skips_rescore(self, client, db, env, spies):
        await _srd(db, "bee", counts_for_quality=False)
        await _srd(db, "other")
        r = await client.post(f"{BASE}/bee/archive", headers=env["h"])
        assert r.status_code == 200
        assert r.json()["affected_stakeholders_count"] == 0
        assert spies["rescored"] == []

    async def test_restore_effects(self, client, db, env, spies):
        s = await _srd(db, "bee", counts_for_quality=True)
        s.is_archived = True
        s.archived_by = env["admin"].id
        await db.flush()
        r = await client.post(f"{BASE}/bee/restore", headers=env["h"])
        body = r.json()
        assert r.status_code == 200
        assert body["is_archived"] is False
        assert body["archived_at"] is None and body["archived_by"] is None
        assert spies["rescored"] == ["Application"]
        assert spies["cache"] == [("Application", "bee")]
        assert len(await _rows(db, "restored")) == 1

    async def test_restore_non_counting_skips_rescore(self, client, db, env, spies):
        await _srd(db, "bee", counts_for_quality=False, is_archived=True)
        r = await client.post(f"{BASE}/bee/restore", headers=env["h"])
        assert r.status_code == 200
        assert spies["rescored"] == []

    async def test_restore_not_archived(self, client, db, env):
        await _srd(db, "bee")
        r = await client.post(f"{BASE}/bee/restore", headers=env["h"])
        assert (r.status_code, r.json()["detail"]) == (400, "Stakeholder role is not archived")


class TestCardPermissionsSchema:
    async def test_payload_and_auth(self, client, db, env):
        r = await client.get("/api/v1/stakeholder-roles/permissions-schema", headers=env["vh"])
        assert r.status_code == 200
        assert r.json() == CARD_PERMISSIONS
        r = await client.get("/api/v1/stakeholder-roles/permissions-schema")
        assert r.status_code in (401, 403)


class TestHelpers:
    def test_srd_target_falls_back_to_key(self):
        srd = StakeholderRoleDefinition(card_type_key="T", key="k", label="")
        assert sr._srd_target("T", "Type", srd) == ("stakeholder_role", "T:k", "k (Type)")

    def test_usage_blocker_rename_ignores_surveys_and_last(self):
        usage = {
            "role_key": "r",
            "stakeholder_count": 0,
            "card_count": 0,
            "survey_count": 3,
            "is_last_active": True,
        }
        assert sr._usage_blocker(usage, "rename") is None
        assert sr._usage_blocker({**usage, "survey_count": 0}, "delete") == (
            "Cannot delete the last active stakeholder role for this type"
        )
        assert "3 survey(s) target it" in sr._usage_blocker(usage, "delete")
