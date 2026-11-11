"""Exact behaviour of the auth dependencies: statuses, details, which header wins, and when the
Origin check runs. Called directly, so each branch is pinned on its own."""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

import pytest
from fastapi import HTTPException

from app.api import deps
from app.api.deps import _reject_foreign_origin, get_current_user, get_optional_user
from app.config import settings
from app.core.permissions import VIEWER_PERMISSIONS
from app.core.security import create_access_token
from tests.conftest import create_role, create_user


class _Req:
    def __init__(self, headers=None, cookies=None, method="POST"):
        self.method = method
        self.headers = headers or {}
        self.cookies = cookies or {}


def _refused(req):
    with pytest.raises(HTTPException) as exc:
        _reject_foreign_origin(req)
    assert exc.value.status_code == 403
    assert exc.value.detail == "Cross-origin request refused"


async def _fails(req, db, detail):
    with pytest.raises(HTTPException) as exc:
        await get_current_user(req, db)
    assert exc.value.status_code == 401
    assert exc.value.detail == detail


@pytest.fixture
async def member(db):
    await create_role(db, key="viewer", permissions=VIEWER_PERMISSIONS)
    return await create_user(db, email="deps-h@test.com", role="viewer")


def _token(user):
    return create_access_token(user.id, user.role)


# --- _reject_foreign_origin -------------------------------------------------


@pytest.mark.parametrize("method", ["POST", "PUT", "PATCH", "DELETE"])
def test_a_write_from_a_foreign_origin_is_refused(method):
    _refused(_Req({"Origin": "https://evil.example", "Host": "ea.corp"}, method=method))


@pytest.mark.parametrize("method", ["GET", "HEAD", "OPTIONS"])
def test_a_read_from_a_foreign_origin_passes(method):
    assert _reject_foreign_origin(_Req({"Origin": "https://evil.example"}, method=method)) is None


def test_no_origin_passes_and_an_empty_one_too():
    assert _reject_foreign_origin(_Req({"Host": "ea.corp"})) is None
    assert _reject_foreign_origin(_Req({"Origin": "", "Host": "ea.corp"})) is None


def test_allowed_origins_is_exact_match_only(monkeypatch):
    monkeypatch.setattr(settings, "ALLOWED_ORIGINS", ["https://portal.corp"])
    assert (
        _reject_foreign_origin(_Req({"Origin": "https://portal.corp", "Host": "backend"})) is None
    )
    _refused(_Req({"Origin": "https://portal.corp.evil.example", "Host": "backend"}))
    _refused(_Req({"Origin": "http://portal.corp", "Host": "backend"}))


def test_same_host_passes_whatever_the_port_on_either_side():
    ok = _reject_foreign_origin
    assert ok(_Req({"Origin": "https://ea.corp:9443", "Host": "ea.corp"})) is None
    assert ok(_Req({"Origin": "https://ea.corp", "Host": "ea.corp:8443"})) is None
    assert ok(_Req({"Origin": "https://ea.corp", "Host": "ea.corp"})) is None


def test_a_sibling_subdomain_or_a_missing_host_is_refused(monkeypatch):
    monkeypatch.setattr(settings, "ALLOWED_ORIGINS", [])
    _refused(_Req({"Origin": "https://other.corp", "Host": "ea.corp"}))
    _refused(_Req({"Origin": "https://ea.corp.evil.example", "Host": "ea.corp"}))
    _refused(_Req({"Origin": "https://ea.corp"}))  # no Host header: nothing to compare with
    _refused(_Req({"Origin": "https://ea.corp", "Host": ""}))


# --- get_current_user ---------------------------------------------------------


async def test_no_credentials_is_401_not_authenticated(db):
    await _fails(_Req(), db, "Not authenticated")
    await _fails(_Req({"Authorization": "Bearer "}), db, "Not authenticated")
    await _fails(_Req({"Authorization": "Bearer"}), db, "Not authenticated")
    await _fails(_Req({"Authorization": "bearer abc"}), db, "Not authenticated")  # case matters
    await _fails(_Req({"Authorization": "Basic abc"}), db, "Not authenticated")


async def test_bearer_token_is_everything_after_the_prefix(db, member):
    got = await get_current_user(_Req({"Authorization": f"Bearer {_token(member)}"}), db)
    assert got.id == member.id
    await _fails(_Req({"Authorization": "Bearer garbage"}), db, "Invalid or expired token")


async def test_bearer_wins_over_the_cookie_and_skips_the_origin_check(db, member):
    req = _Req(
        {"Authorization": f"Bearer {_token(member)}", "Origin": "https://evil.example"},
        cookies={"access_token": "garbage"},
    )
    assert (await get_current_user(req, db)).id == member.id


async def test_cookie_token_resolves_the_user(db, member):
    req = _Req(cookies={"access_token": _token(member)})
    assert (await get_current_user(req, db)).id == member.id


async def test_cookie_write_from_a_foreign_origin_is_403_before_the_token_is_read(db, member):
    req = _Req(
        {"Origin": "https://evil.example", "Host": "ea.corp"},
        cookies={"access_token": _token(member)},
    )
    with pytest.raises(HTTPException) as exc:
        await get_current_user(req, db)
    assert exc.value.status_code == 403


async def test_foreign_origin_without_any_cookie_is_401_not_403(db):
    req = _Req({"Origin": "https://evil.example", "Host": "ea.corp"})
    await _fails(req, db, "Not authenticated")


async def test_unknown_and_inactive_users_are_401(db, member):
    inactive = _token(member)
    member.is_active = False
    await db.flush()
    await _fails(_Req(cookies={"access_token": inactive}), db, "User not found or inactive")
    nobody = type("N", (), {"id": uuid.uuid4(), "role": "viewer"})()
    await _fails(_Req(cookies={"access_token": _token(nobody)}), db, "User not found or inactive")


async def test_access_expiry_is_enforced_only_when_set_and_past(db, member):
    req = _Req(cookies={"access_token": _token(member)})
    member.access_expires_at = datetime.now(timezone.utc) + timedelta(hours=1)
    await db.flush()
    assert (await get_current_user(req, db)).id == member.id
    member.access_expires_at = datetime.now(timezone.utc) - timedelta(seconds=5)
    await db.flush()
    await _fails(req, db, "Account access has expired")
    member.access_expires_at = None
    await db.flush()
    assert (await get_current_user(req, db)).id == member.id


# --- get_optional_user --------------------------------------------------------


async def test_optional_user_is_none_without_credentials_or_with_a_bad_scheme(db):
    assert await get_optional_user(_Req(), db) is None
    assert await get_optional_user(_Req({"Authorization": "Basic abc"}), db) is None


async def test_optional_user_resolves_a_header_or_a_cookie_and_swallows_bad_ones(db, member):
    by_header = await get_optional_user(_Req({"Authorization": f"Bearer {_token(member)}"}), db)
    assert by_header.id == member.id
    by_cookie = await get_optional_user(_Req(cookies={"access_token": _token(member)}), db)
    assert by_cookie.id == member.id
    assert await get_optional_user(_Req(cookies={"access_token": "garbage"}), db) is None
    assert await get_optional_user(_Req({"Authorization": "Bearer garbage"}), db) is None


# --- require_permission -------------------------------------------------------


async def test_require_permission_passes_the_key_and_card_type_through(db, member, monkeypatch):
    from app.services.permission_service import PermissionService

    seen = {}

    async def fake(db_, user_, key, card_type_key=None):
        seen.update(user=user_, key=key, card_type_key=card_type_key)

    monkeypatch.setattr(PermissionService, "require_permission", fake)
    check = deps.require_permission("inventory.create", card_type_key="Application")
    assert await check(member, db) is member
    assert seen == {"user": member, "key": "inventory.create", "card_type_key": "Application"}
    seen.clear()
    assert await deps.require_permission("inventory.view")(member, db) is member
    assert seen["card_type_key"] is None


async def test_require_permission_denies_a_role_without_it(db, member):
    with pytest.raises(HTTPException) as exc:
        await deps.require_permission("admin.metamodel")(member, db)
    assert exc.value.status_code == 403
