"""A cookie-authenticated write from a foreign Origin is refused (VAPT 2026-10-29).

SameSite=lax already keeps the cookie off cross-site POSTs; this is the second
layer for the sibling-site and same-site-subdomain cases it does not cover.
"""

from __future__ import annotations

import pytest

from app.config import settings
from app.core.security import create_access_token
from tests.conftest import auth_headers, create_role, create_user

BODY = {"name": "origin-check"}
URL = "/api/v1/bookmarks"


async def _cookie(env):
    return {"access_token": create_access_token(env.id, env.role)}


@pytest.fixture
async def user(db):
    await create_role(db, key="admin", permissions={"*": True})
    return await create_user(db, email="origin@test.com", role="admin")


async def _post(client, user, *, origin=None, host=None, bearer=False):
    headers = dict(auth_headers(user)) if bearer else {}
    if origin is not None:
        headers["Origin"] = origin
    if host is not None:
        headers["Host"] = host
    cookies = None if bearer else await _cookie(user)
    return await client.post(URL, json=BODY, headers=headers, cookies=cookies)


async def test_foreign_origin_with_cookie_is_forbidden(client, user):
    resp = await _post(client, user, origin="https://evil.example", host="ea.corp.example")
    assert resp.status_code == 403


async def test_no_origin_header_with_cookie_is_allowed(client, user):
    resp = await _post(client, user, host="ea.corp.example")
    assert resp.status_code == 201


async def test_same_host_origin_is_allowed_whatever_the_port(client, user):
    # nginx forwards $host, which carries no port
    resp = await _post(client, user, origin="https://ea.corp.example:9443", host="ea.corp.example")
    assert resp.status_code == 201


async def test_allowed_origins_entry_is_allowed(client, user, monkeypatch):
    monkeypatch.setattr(settings, "ALLOWED_ORIGINS", ["https://portal.corp.example"])
    resp = await _post(client, user, origin="https://portal.corp.example", host="backend.internal")
    assert resp.status_code == 201


async def test_foreign_origin_with_bearer_token_is_allowed(client, user):
    resp = await _post(client, user, origin="https://evil.example", bearer=True)
    assert resp.status_code == 201


async def test_foreign_origin_on_a_read_is_allowed(client, user):
    resp = await client.get(
        URL, headers={"Origin": "https://evil.example"}, cookies=await _cookie(user)
    )
    assert resp.status_code == 200
