"""The response shapers and the invitation email text of ``app.api.v1.users``, pinned field by
field: what an admin sees, what every other caller sees, and the exact email copy."""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from types import SimpleNamespace

from app.api.v1.users import (
    _build_invite_email,
    _invitation_response,
    _labelled_role_change,
    _role_label,
    _user_response,
    _user_response_lite,
)
from app.models.user import DEFAULT_UI_PREFERENCES
from tests.conftest import create_role

WHEN = datetime(2026, 11, 3, 10, 30, tzinfo=timezone.utc)


def _user(**over):
    base = {
        "id": uuid.UUID("11111111-1111-1111-1111-111111111111"),
        "email": "a@x.com",
        "display_name": "Ada",
        "role": "member",
        "is_active": True,
        "locale": "it",
        "auth_provider": "sso",
        "password_hash": "h",
        "password_setup_token": "t",
        "ui_preferences": {"theme": "dark"},
        "created_at": WHEN,
        "last_login": WHEN,
        "locked_until": WHEN,
        "failed_login_attempts": 3,
    }
    base.update(over)
    return SimpleNamespace(**base)


def test_user_response_carries_every_admin_field_exactly():
    assert _user_response(_user()) == {
        "id": "11111111-1111-1111-1111-111111111111",
        "email": "a@x.com",
        "display_name": "Ada",
        "role": "member",
        "is_active": True,
        "locale": "it",
        "auth_provider": "sso",
        "has_password": True,
        "pending_setup": True,
        "ui_preferences": {"theme": "dark"},
        "created_at": WHEN.isoformat(),
        "last_login": WHEN.isoformat(),
        "locked_until": WHEN.isoformat(),
        "failed_login_attempts": 3,
    }


def test_user_response_defaults_for_a_bare_account():
    out = _user_response(
        _user(
            locale=None,
            auth_provider=None,
            password_hash=None,
            password_setup_token=None,
            ui_preferences=None,
            created_at=None,
            last_login=None,
            locked_until=None,
            failed_login_attempts=None,
            is_active=False,
        )
    )
    assert out["locale"] == "en"
    assert out["auth_provider"] == "local"
    assert out["has_password"] is False
    assert out["pending_setup"] is False
    assert out["ui_preferences"] == DEFAULT_UI_PREFERENCES
    assert out["created_at"] is None
    assert out["last_login"] is None
    assert out["locked_until"] is None
    assert out["failed_login_attempts"] == 0
    assert out["is_active"] is False


def test_user_response_never_leaks_the_secret_values():
    out = _user_response(_user())
    assert "h" not in out.values() and "t" not in out.values()
    assert "password_hash" not in out and "password_setup_token" not in out


def test_empty_string_secrets_read_as_absent():
    out = _user_response(_user(password_hash="", password_setup_token=""))
    assert out["has_password"] is False and out["pending_setup"] is False


def test_lite_response_is_exactly_the_picker_fields():
    assert _user_response_lite(_user()) == {
        "id": "11111111-1111-1111-1111-111111111111",
        "display_name": "Ada",
        "email": "a@x.com",
        "is_active": True,
    }
    assert _user_response_lite(_user(is_active=False))["is_active"] is False


def test_invitation_response_with_and_without_an_inviter():
    inviter = uuid.UUID("22222222-2222-2222-2222-222222222222")
    inv = SimpleNamespace(
        id=uuid.UUID("33333333-3333-3333-3333-333333333333"),
        email="n@x.com",
        role="viewer",
        invited_by=inviter,
        created_at=WHEN,
    )
    assert _invitation_response(inv) == {
        "id": "33333333-3333-3333-3333-333333333333",
        "email": "n@x.com",
        "role": "viewer",
        "invited_by": "22222222-2222-2222-2222-222222222222",
        "created_at": WHEN.isoformat(),
    }
    inv.invited_by = None
    inv.created_at = None
    out = _invitation_response(inv)
    assert out["invited_by"] is None and out["created_at"] is None


def test_labelled_role_change_maps_each_side_and_keeps_unknown_keys():
    labels = {"admin": "Administrator", "viewer": "Viewer"}
    assert _labelled_role_change({"old": "viewer", "new": "admin"}, labels) == {
        "old": "Viewer",
        "new": "Administrator",
    }
    assert _labelled_role_change({"old": "viewer", "new": "ghost"}, labels) == {
        "old": "Viewer",
        "new": "ghost",
    }
    assert _labelled_role_change({"old": "x", "new": "y", "extra": 1}, {}) == {
        "old": "x",
        "new": "y",
    }


async def test_role_label_is_the_label_the_key_or_none(db):
    await create_role(db, key="auditor", label="Security auditor", permissions={})
    assert await _role_label(db, "auditor") == "Security auditor"
    assert await _role_label(db, "gone") == "gone"
    assert await _role_label(db, None) is None
    assert await _role_label(db, "") == ""


def test_invite_email_with_a_setup_token_and_no_sso():
    title, message, link = _build_invite_email(
        app_title="Turbo", setup_token="tok", sso_enabled=False
    )
    assert title == "You've been invited to Turbo"
    assert message == (
        "You have been invited to join Turbo. "
        "Click the button below to set your password and get started."
    )
    assert link == "/auth/set-password?token=tok"


def test_invite_email_with_sso_ignores_the_token():
    title, message, link = _build_invite_email(
        app_title="Turbo", setup_token="tok", sso_enabled=True
    )
    assert title == "You've been invited to Turbo"
    assert message == "You have been invited to join Turbo. Click the button below to sign in."
    assert link == "/"
    assert _build_invite_email(app_title="Turbo", setup_token=None, sso_enabled=True)[1:] == (
        message,
        "/",
    )


def test_invite_email_with_a_preset_password():
    for token in (None, ""):
        title, message, link = _build_invite_email(
            app_title="Acme EA", setup_token=token, sso_enabled=False
        )
        assert title == "You've been invited to Acme EA"
        assert message == (
            "You have been invited to join Acme EA. "
            "A password has been set for your account. "
            "Click the button below to sign in."
        )
        assert link == "/"
