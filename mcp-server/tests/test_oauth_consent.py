"""The consent step of /oauth/authorize.

Registration is open, so any site can name itself an OAuth client and link a signed-in user to
``/oauth/authorize``. Without a consent page that user's sign-in is carried to the site's own
redirect URI with no click. The page must show who asks, the answer must come from the browser
that was shown the page, and the SSO callback must refuse a request that skipped either.
"""

from __future__ import annotations

from unittest.mock import AsyncMock

import pytest
from starlette.applications import Starlette
from starlette.routing import Route
from starlette.testclient import TestClient

from turbo_ea_mcp import api_client, oauth
from turbo_ea_mcp.oauth import OAuthStore, PendingAuth, RegisteredClient

PUBLIC = "https://mcp.example.com"
CB = "https://attacker.example/cb"
SSO = {
    "enabled": True,
    "client_id": "sso-cid",
    "authorization_endpoint": "https://sso.example.com/authorize",
}


@pytest.fixture
def store(monkeypatch):
    fresh = OAuthStore()
    monkeypatch.setattr(oauth, "store", fresh)
    monkeypatch.setattr(oauth, "MCP_PUBLIC_URL", PUBLIC + "/")
    monkeypatch.setattr(oauth, "MCP_OAUTH_ALLOWED_REDIRECT_URIS", [])
    monkeypatch.setattr(oauth, "_get_sso_config", AsyncMock(return_value=SSO))
    fresh.clients["c"] = RegisteredClient(
        client_id="c", redirect_uris=[CB], client_name="<script>alert(1)</script>"
    )
    return fresh


def _browser() -> TestClient:
    client = TestClient(
        Starlette(
            routes=[
                Route("/oauth/authorize", oauth.authorize),
                Route("/oauth/authorize/consent", oauth.authorize_consent, methods=["POST"]),
                Route("/oauth/callback", oauth.sso_callback),
            ]
        )
    )
    client.base_url = PUBLIC  # the Secure consent cookie only travels over https
    return client


@pytest.fixture
def victim(store):
    return _browser()


def _start(browser: TestClient):
    return browser.get(
        "/oauth/authorize",
        params={
            "response_type": "code",
            "client_id": "c",
            "redirect_uri": CB,
            "scope": "mcp:read",
            "state": "s",
            "code_challenge": "chal",
            "code_challenge_method": "S256",
        },
        follow_redirects=False,
    )


def _answer(browser: TestClient, state: str, decision: str = "approve"):
    return browser.post(
        "/oauth/authorize/consent",
        data={"state": state, "decision": decision},
        follow_redirects=False,
    )


def test_authorize_shows_who_asks_and_does_not_redirect(victim, store):
    resp = _start(victim)
    assert resp.status_code == 200
    assert "location" not in resp.headers
    assert "attacker.example" in resp.text  # where the sign-in will be sent
    assert "<script>" not in resp.text and "&lt;script&gt;" in resp.text  # the name, escaped
    [state] = store.pending
    assert store.pending[state].consented is False


def test_the_consent_page_cannot_be_framed_or_cached(victim):
    resp = _start(victim)
    assert resp.headers["x-frame-options"] == "DENY"
    assert "frame-ancestors 'none'" in resp.headers["content-security-policy"]
    assert resp.headers["cache-control"] == "no-store"


def test_the_consent_cookie_is_private_to_the_browser(victim, store):
    set_cookie = _start(victim).headers["set-cookie"]
    [state] = store.pending
    assert f"{oauth.CONSENT_COOKIE}={state}" in set_cookie
    for attribute in ("HttpOnly", "Secure", "SameSite=lax"):
        assert attribute.lower() in set_cookie.lower()


def test_approving_from_the_same_browser_goes_to_the_identity_provider(victim, store):
    _start(victim)
    [state] = store.pending
    resp = _answer(victim, state)
    assert resp.status_code == 302
    assert resp.headers["location"].startswith(SSO["authorization_endpoint"] + "?")
    assert store.pending[state].consented is True


def test_cancelling_gives_nothing_and_forgets_the_request(victim, store):
    _start(victim)
    [state] = store.pending
    resp = _answer(victim, state, "deny")
    assert resp.status_code == 200 and "location" not in resp.headers
    assert store.pending == {}


def test_an_answer_from_another_browser_is_refused(victim, store):
    """An attacker who obtained a state in their own browser cannot answer for the victim."""
    _start(_browser())
    [state] = store.pending
    resp = _answer(victim, state)  # the victim's browser carries no cookie for this state
    assert resp.status_code == 400
    assert "location" not in resp.headers
    assert store.pending[state].consented is False


@pytest.mark.parametrize("state", ["", "unknown"])
def test_an_unknown_state_is_refused(victim, store, state):
    assert _answer(victim, state).status_code == 400


def test_the_callback_refuses_a_request_nobody_approved(victim, store, monkeypatch):
    """A link that goes straight to the identity provider, skipping the consent page."""
    exchange = AsyncMock(return_value={"access_token": "jwt"})
    monkeypatch.setattr(api_client, "exchange_sso_code", exchange)
    victim.cookies.set(oauth.CONSENT_COOKIE, "st")
    store.pending["st"] = PendingAuth("c", CB, "mcp:read", "s", "chal", "S256")
    resp = victim.get(
        "/oauth/callback", params={"code": "x", "state": "st"}, follow_redirects=False
    )
    assert resp.status_code == 400
    exchange.assert_not_awaited()
    assert store.codes == {}


def test_the_callback_refuses_a_request_approved_in_another_browser(victim, store, monkeypatch):
    """The attacker approves in their browser, then sends the victim the identity-provider URL:
    the victim's browser has no matching cookie, so no code is issued to the attacker."""
    exchange = AsyncMock(return_value={"access_token": "jwt"})
    monkeypatch.setattr(api_client, "exchange_sso_code", exchange)
    attacker = _browser()
    _start(attacker)
    [state] = store.pending
    assert _answer(attacker, state).status_code == 302
    resp = victim.get(
        "/oauth/callback", params={"code": "x", "state": state}, follow_redirects=False
    )
    assert resp.status_code == 400
    exchange.assert_not_awaited()
    assert store.codes == {}


def test_the_whole_flow_from_one_browser_issues_a_code(victim, store, monkeypatch):
    monkeypatch.setattr(
        api_client, "exchange_sso_code", AsyncMock(return_value={"access_token": "jwt"})
    )
    _start(victim)
    [state] = store.pending
    assert _answer(victim, state).status_code == 302
    resp = victim.get(
        "/oauth/callback", params={"code": "x", "state": state}, follow_redirects=False
    )
    assert resp.status_code == 302
    assert resp.headers["location"].startswith(CB + "?code=")
    assert len(store.codes) == 1
