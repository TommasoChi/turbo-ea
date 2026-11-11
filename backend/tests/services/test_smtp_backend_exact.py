"""The SMTP transport pinned step by step: the MIME message, the port / TLS choice, the order
of the calls, and what each backend authenticates with."""

from __future__ import annotations

import email
import logging

import pytest

from app.services.email_backends import smtp
from app.services.email_backends.base import EmailConfig


def test_message_has_headers_and_a_plain_then_html_alternative():
    raw = smtp._build_message("to@x.com", "Hello there", "<b>hi</b>", "hi", "from@x.com")
    msg = email.message_from_string(raw)
    assert msg["From"] == "from@x.com"
    assert msg["To"] == "to@x.com"
    assert msg["Subject"] == "Hello there"
    assert msg.get_content_type() == "multipart/alternative"
    parts = msg.get_payload()
    assert [p.get_content_type() for p in parts] == ["text/plain", "text/html"]
    assert parts[0].get_payload(decode=True) == b"hi"
    assert parts[1].get_payload(decode=True) == b"<b>hi</b>"


class FakeSMTP:
    instances: list[FakeSMTP] = []

    def __init__(self, host, port):
        self.host, self.port = host, port
        self.calls: list[tuple] = []
        FakeSMTP.instances.append(self)

    def starttls(self):
        self.calls.append(("starttls",))

    def ehlo(self):
        self.calls.append(("ehlo",))

    def login(self, user, password):
        self.calls.append(("login", user, password))

    def auth(self, mech, authobject):
        self.calls.append(("auth", mech, authobject()))

    def sendmail(self, frm, to, msg):
        self.calls.append(("sendmail", frm, to, msg))

    def quit(self):
        self.calls.append(("quit",))


class FakeSMTPSSL(FakeSMTP):
    pass


@pytest.fixture(autouse=True)
def fake_smtp(monkeypatch):
    FakeSMTP.instances = []
    monkeypatch.setattr(smtp.smtplib, "SMTP", FakeSMTP)
    monkeypatch.setattr(smtp.smtplib, "SMTP_SSL", FakeSMTPSSL)


def _send(cfg, authenticate=lambda s: s.calls.append(("authenticate",))):
    smtp._send_sync(
        to="to@x.com",
        subject="S",
        body_html="<p>h</p>",
        body_text="t",
        from_addr="from@x.com",
        cfg=cfg,
        key="smtp_basic",
        authenticate=authenticate,
    )
    return FakeSMTP.instances[-1]


def test_plain_port_with_tls_upgrades_then_ehlos_authenticates_and_sends_in_order(caplog):
    caplog.set_level(logging.INFO, logger=smtp.logger.name)
    server = _send(EmailConfig(smtp_host="mail.x", smtp_port=587, smtp_tls=True))
    assert type(server) is FakeSMTP
    assert (server.host, server.port) == ("mail.x", 587)
    names = [c[0] for c in server.calls]
    assert names == ["starttls", "ehlo", "authenticate", "sendmail", "quit"]
    sent = next(c for c in server.calls if c[0] == "sendmail")
    assert sent[1] == "from@x.com" and sent[2] == ["to@x.com"]
    assert email.message_from_string(sent[3])["Subject"] == "S"
    assert "Email sent to to@x.com via smtp_basic: S" in caplog.text


def test_plain_port_without_tls_skips_starttls():
    server = _send(EmailConfig(smtp_host="mail.x", smtp_port=25, smtp_tls=False))
    assert [c[0] for c in server.calls] == ["ehlo", "authenticate", "sendmail", "quit"]


def test_port_465_is_implicit_tls_and_never_starttls_whatever_the_flag():
    for flag in (True, False):
        server = _send(EmailConfig(smtp_host="mail.x", smtp_port=465, smtp_tls=flag))
        assert type(server) is FakeSMTPSSL
        assert (server.host, server.port) == ("mail.x", 465)
        assert "starttls" not in [c[0] for c in server.calls]
        assert [c[0] for c in server.calls][0] == "ehlo"


def test_a_failure_is_logged_with_the_recipient_and_reraised(caplog):
    def boom(server):
        raise RuntimeError("auth refused")

    with pytest.raises(RuntimeError, match="auth refused"):
        _send(EmailConfig(smtp_host="mail.x", smtp_port=587), boom)
    assert "Failed to send email to to@x.com via smtp_basic" in caplog.text
    assert "quit" not in [c[0] for c in FakeSMTP.instances[-1].calls]


async def _run(backend, cfg):
    await backend.send(
        to="to@x.com",
        subject="S",
        body_html="<p>h</p>",
        body_text="t",
        from_addr="from@x.com",
        cfg=cfg,
    )
    return FakeSMTP.instances[-1]


async def test_basic_backend_logs_in_only_when_a_user_is_set():
    cfg = EmailConfig(smtp_host="mail.x", smtp_port=587, smtp_user="bob", smtp_password="pw")
    server = await _run(smtp.SmtpBasicBackend(), cfg)
    assert ("login", "bob", "pw") in server.calls
    anon = await _run(smtp.SmtpBasicBackend(), EmailConfig(smtp_host="mail.x", smtp_user=""))
    assert "login" not in [c[0] for c in anon.calls]


def test_basic_backend_is_configured_by_the_host_alone():
    backend = smtp.SmtpBasicBackend()
    assert backend.is_configured(EmailConfig(smtp_host="mail.x")) is True
    assert backend.is_configured(EmailConfig(smtp_host="")) is False
    assert backend.key == "smtp_basic"


async def test_xoauth2_backend_authenticates_as_the_mailbox_with_the_acquired_token(monkeypatch):
    seen = {}

    async def fake_token(self, cfg, auth_user):
        seen["user"] = auth_user
        return "tok-123"

    monkeypatch.setattr(smtp.SmtpXOAuth2Backend, "_acquire_token", fake_token)
    cfg = EmailConfig(smtp_host="mail.x", smtp_port=587, smtp_user="box@x.com", smtp_tls=True)
    server = await _run(smtp.SmtpXOAuth2Backend(), cfg)
    assert seen["user"] == "box@x.com"
    auth = next(c for c in server.calls if c[0] == "auth")
    assert auth[1] == "XOAUTH2"
    assert auth[2] == smtp.oauth.build_xoauth2_raw("box@x.com", "tok-123")
    assert [c[0] for c in server.calls] == ["starttls", "ehlo", "auth", "sendmail", "quit"]


def test_xoauth2_is_configured_per_provider():
    backend = smtp.SmtpXOAuth2Backend()
    ms = {"smtp_host": "h", "smtp_user": "u"}
    assert backend.is_configured(EmailConfig(**ms)) is False
    full = EmailConfig(**ms, oauth_tenant_id="t", oauth_client_id="c", oauth_client_secret="s")
    assert backend.is_configured(full) is True
    for missing in ("oauth_tenant_id", "oauth_client_id", "oauth_client_secret"):
        kw = {"oauth_tenant_id": "t", "oauth_client_id": "c", "oauth_client_secret": "s"}
        kw[missing] = ""
        assert backend.is_configured(EmailConfig(**ms, **kw)) is False
    assert backend.is_configured(EmailConfig(**ms, oauth_provider="google")) is False
    google = {"oauth_provider": "google", "service_account_json": "{}"}
    assert backend.is_configured(EmailConfig(**ms, **google)) is True
    assert backend.is_configured(EmailConfig(smtp_host="", smtp_user="u", **google)) is False
    assert backend.is_configured(EmailConfig(smtp_host="h", smtp_user="", **google)) is False


async def test_xoauth2_token_scope_and_endpoint_defaults(monkeypatch):
    calls = {}

    async def ms(**kw):
        calls["ms"] = kw
        return "t"

    async def goog(**kw):
        calls["google"] = kw
        return "t"

    monkeypatch.setattr(smtp.oauth, "get_client_credentials_token", ms)
    monkeypatch.setattr(smtp.oauth, "get_service_account_token", goog)
    backend = smtp.SmtpXOAuth2Backend()
    await backend._acquire_token(
        EmailConfig(oauth_tenant_id="t", oauth_client_id="c", oauth_client_secret="s"), "u"
    )
    assert calls["ms"] == {
        "tenant_id": "t",
        "client_id": "c",
        "client_secret": "s",
        "scope": "https://outlook.office365.com/.default",
        "token_endpoint": "",
    }
    await backend._acquire_token(
        EmailConfig(oauth_tenant_id="t", oauth_scope="custom/.default", oauth_token_endpoint="e"),
        "u",
    )
    assert calls["ms"]["scope"] == "custom/.default" and calls["ms"]["token_endpoint"] == "e"
    await backend._acquire_token(
        EmailConfig(oauth_provider="google", service_account_json="{sa}"), "box@x.com"
    )
    assert calls["google"] == {
        "service_account_json": "{sa}",
        "subject": "box@x.com",
        "scope": "https://mail.google.com/",
    }
    await backend._acquire_token(
        EmailConfig(oauth_provider="google", service_account_json="{sa}", oauth_scope="s2"), "u"
    )
    assert calls["google"]["scope"] == "s2"
