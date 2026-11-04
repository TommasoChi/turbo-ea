"""Branch / boundary tests for the SMTP, Graph and runtime email backends.

No database and no network: smtplib and httpx are mocked.
"""

from __future__ import annotations

import email
import logging
import smtplib
from unittest.mock import AsyncMock, MagicMock, call, patch

import pytest

from app.config import DEFAULT_SMTP_FROM
from app.config import settings as real_settings
from app.core.encryption import encrypt_value
from app.services.email_backends import EmailConfig, graph, oauth, runtime, smtp
from app.services.email_backends.base import METHOD_GRAPH_API, METHOD_SMTP_BASIC, METHOD_SMTP_OAUTH
from app.services.email_backends.graph import GraphApiBackend
from app.services.email_backends.smtp import SmtpBasicBackend, SmtpXOAuth2Backend

SMTP = "app.services.email_backends.smtp.smtplib.SMTP"
SMTP_SSL = "app.services.email_backends.smtp.smtplib.SMTP_SSL"


@pytest.fixture(autouse=True)
def _clear_cache():
    oauth.reset_cache()
    yield
    oauth.reset_cache()


def _send_kwargs(**over):
    base = dict(
        to="to@x.com",
        subject="Subj",
        body_html="<p>Body</p>",
        body_text="Body",
        from_addr="from@x.com",
    )
    base.update(over)
    return base


# ---------------------------------------------------------------------------
# smtp: _build_message
# ---------------------------------------------------------------------------


class TestBuildMessage:
    def test_headers_and_parts(self):
        raw = smtp._build_message("to@x.com", "Subj", "<p>H</p>", "plain text", "from@x.com")
        msg = email.message_from_string(raw)
        assert msg["From"] == "from@x.com"
        assert msg["To"] == "to@x.com"
        assert msg["Subject"] == "Subj"
        assert msg.get_content_type() == "multipart/alternative"
        parts = msg.get_payload()
        assert [p.get_content_type() for p in parts] == ["text/plain", "text/html"]
        assert parts[0].get_payload(decode=True).decode() == "plain text"
        assert parts[1].get_payload(decode=True).decode() == "<p>H</p>"


# ---------------------------------------------------------------------------
# smtp: _send_sync
# ---------------------------------------------------------------------------


def _sync(cfg, authenticate=None, **over):
    kw = dict(
        to="to@x.com",
        subject="Subj",
        body_html="<p>H</p>",
        body_text="T",
        from_addr="from@x.com",
        cfg=cfg,
        key="smtp_basic",
        authenticate=authenticate or (lambda s: None),
    )
    kw.update(over)
    smtp._send_sync(**kw)


class TestSendSync:
    def test_constant(self):
        assert smtp.IMPLICIT_TLS_PORT == 465

    @pytest.mark.parametrize("port", [464, 466, 25, 587])
    def test_only_exactly_465_is_implicit_tls(self, port):
        cfg = EmailConfig(smtp_host="h", smtp_port=port)
        server = MagicMock()
        with patch(SMTP, return_value=server) as plain, patch(SMTP_SSL) as ssl:
            _sync(cfg)
        plain.assert_called_once_with("h", port)
        ssl.assert_not_called()

    def test_465_uses_ssl_with_host_and_port(self):
        cfg = EmailConfig(smtp_host="mail.h", smtp_port=465)
        server = MagicMock()
        with patch(SMTP_SSL, return_value=server) as ssl, patch(SMTP) as plain:
            _sync(cfg)
        ssl.assert_called_once_with("mail.h", 465)
        plain.assert_not_called()
        server.starttls.assert_not_called()

    def test_tls_flag_controls_starttls(self):
        for flag in (True, False):
            server = MagicMock()
            with patch(SMTP, return_value=server):
                _sync(EmailConfig(smtp_host="h", smtp_port=587, smtp_tls=flag))
            assert server.starttls.call_count == (1 if flag else 0)

    def test_call_order_and_send_args(self):
        cfg = EmailConfig(smtp_host="h", smtp_port=587, smtp_tls=True)
        server = MagicMock()
        order = []
        server.starttls.side_effect = lambda: order.append("starttls")
        server.ehlo.side_effect = lambda: order.append("ehlo")
        server.sendmail.side_effect = lambda *a: order.append("sendmail")
        server.quit.side_effect = lambda: order.append("quit")
        with patch(SMTP, return_value=server):
            _sync(cfg, authenticate=lambda s: order.append("auth"))
        assert order == ["starttls", "ehlo", "auth", "sendmail", "quit"]
        sender, rcpts, raw = server.sendmail.call_args.args
        assert sender == "from@x.com"
        assert rcpts == ["to@x.com"]
        assert "Subject: Subj" in raw and "To: to@x.com" in raw and "From: from@x.com" in raw

    def test_authenticate_receives_the_server(self):
        server = MagicMock()
        seen = []
        with patch(SMTP, return_value=server):
            _sync(EmailConfig(smtp_host="h"), authenticate=seen.append)
        assert seen == [server]

    def test_success_logged(self, caplog):
        with (
            patch(SMTP, return_value=MagicMock()),
            caplog.at_level(logging.INFO, logger=smtp.logger.name),
        ):
            _sync(EmailConfig(smtp_host="h"), key="smtp_oauth")
        assert "Email sent to to@x.com via smtp_oauth: Subj" in caplog.text

    def test_failure_is_logged_and_reraised_without_quit(self, caplog):
        server = MagicMock()
        server.sendmail.side_effect = smtplib.SMTPException("boom")
        with (
            patch(SMTP, return_value=server),
            caplog.at_level(logging.ERROR, logger=smtp.logger.name),
        ):
            with pytest.raises(smtplib.SMTPException, match="boom"):
                _sync(EmailConfig(smtp_host="h"), key="smtp_basic")
        assert "Failed to send email to to@x.com via smtp_basic" in caplog.text

    def test_connect_failure_propagates(self):
        with patch(SMTP, side_effect=OSError("refused")):
            with pytest.raises(OSError, match="refused"):
                _sync(EmailConfig(smtp_host="h"))


# ---------------------------------------------------------------------------
# SmtpBasicBackend
# ---------------------------------------------------------------------------


class TestSmtpBasicBackend:
    def test_key(self):
        assert SmtpBasicBackend.key == METHOD_SMTP_BASIC == "smtp_basic"

    def test_is_configured_needs_host_only(self):
        b = SmtpBasicBackend()
        assert b.is_configured(EmailConfig(smtp_host="h")) is True
        assert b.is_configured(EmailConfig(smtp_host="")) is False
        assert b.is_configured(EmailConfig(smtp_host="h", smtp_user="")) is True

    async def test_login_when_user_set(self):
        server = MagicMock()
        cfg = EmailConfig(smtp_host="h", smtp_port=587, smtp_user="u", smtp_password="p")
        with patch(SMTP, return_value=server):
            await SmtpBasicBackend().send(cfg=cfg, **_send_kwargs())
        server.login.assert_called_once_with("u", "p")
        server.sendmail.assert_called_once()
        assert server.method_calls.index(call.login("u", "p")) < [
            c[0] for c in server.method_calls
        ].index("sendmail")

    async def test_no_login_without_user(self):
        server = MagicMock()
        cfg = EmailConfig(smtp_host="h", smtp_port=587, smtp_user="", smtp_password="p")
        with patch(SMTP, return_value=server):
            await SmtpBasicBackend().send(cfg=cfg, **_send_kwargs())
        server.login.assert_not_called()
        server.sendmail.assert_called_once()

    async def test_passes_message_fields_and_key(self, caplog):
        server = MagicMock()
        cfg = EmailConfig(smtp_host="h", smtp_port=587)
        with (
            patch(SMTP, return_value=server),
            caplog.at_level(logging.INFO, logger=smtp.logger.name),
        ):
            await SmtpBasicBackend().send(cfg=cfg, **_send_kwargs(subject="Hello"))
        sender, rcpts, raw = server.sendmail.call_args.args
        assert (sender, rcpts) == ("from@x.com", ["to@x.com"])
        assert "Subject: Hello" in raw
        assert "via smtp_basic" in caplog.text


# ---------------------------------------------------------------------------
# SmtpXOAuth2Backend
# ---------------------------------------------------------------------------


def _ms_cfg(**over):
    base = dict(
        smtp_host="smtp.o365",
        smtp_port=587,
        smtp_user="box@x.com",
        oauth_provider="microsoft",
        oauth_tenant_id="t",
        oauth_client_id="c",
        oauth_client_secret="s",
    )
    base.update(over)
    return EmailConfig(**base)


class TestXOAuth2IsConfigured:
    def test_key(self):
        assert SmtpXOAuth2Backend.key == METHOD_SMTP_OAUTH == "smtp_oauth"

    def test_microsoft_requires_each_field(self):
        b = SmtpXOAuth2Backend()
        assert b.is_configured(_ms_cfg()) is True
        for field in (
            "smtp_host",
            "smtp_user",
            "oauth_tenant_id",
            "oauth_client_id",
            "oauth_client_secret",
        ):
            assert b.is_configured(_ms_cfg(**{field: ""})) is False, field

    def test_unknown_provider_is_treated_as_microsoft(self):
        b = SmtpXOAuth2Backend()
        assert b.is_configured(_ms_cfg(oauth_provider="other")) is True
        assert b.is_configured(_ms_cfg(oauth_provider="other", oauth_tenant_id="")) is False
        # A service-account key does not satisfy the microsoft branch.
        assert (
            b.is_configured(
                _ms_cfg(oauth_provider="other", oauth_client_id="", service_account_json="{}")
            )
            is False
        )

    def test_google_requires_service_account_only(self):
        b = SmtpXOAuth2Backend()
        g = _ms_cfg(
            oauth_provider="google",
            oauth_tenant_id="",
            oauth_client_id="",
            oauth_client_secret="",
            service_account_json="{}",
        )
        assert b.is_configured(g) is True
        g.service_account_json = ""
        assert b.is_configured(g) is False
        # Microsoft fields do not satisfy the google branch.
        assert b.is_configured(_ms_cfg(oauth_provider="google")) is False
        g2 = _ms_cfg(oauth_provider="google", service_account_json="{}", smtp_user="")
        assert b.is_configured(g2) is False
        g3 = _ms_cfg(oauth_provider="google", service_account_json="{}", smtp_host="")
        assert b.is_configured(g3) is False


class TestAcquireToken:
    async def test_google_default_scope(self):
        cfg = _ms_cfg(oauth_provider="google", service_account_json='{"k":1}')
        with patch.object(oauth, "get_service_account_token", AsyncMock(return_value="G")) as m:
            tok = await SmtpXOAuth2Backend()._acquire_token(cfg, "as@x.com")
        assert tok == "G"
        m.assert_awaited_once_with(
            service_account_json='{"k":1}', subject="as@x.com", scope="https://mail.google.com/"
        )

    async def test_google_custom_scope(self):
        cfg = _ms_cfg(oauth_provider="google", service_account_json="{}", oauth_scope="custom")
        with patch.object(oauth, "get_service_account_token", AsyncMock(return_value="G")) as m:
            await SmtpXOAuth2Backend()._acquire_token(cfg, "u")
        assert m.await_args.kwargs["scope"] == "custom"

    async def test_microsoft_default_scope_and_args(self):
        cfg = _ms_cfg(oauth_token_endpoint="https://tok/ep")
        with patch.object(oauth, "get_client_credentials_token", AsyncMock(return_value="M")) as m:
            tok = await SmtpXOAuth2Backend()._acquire_token(cfg, "u")
        assert tok == "M"
        m.assert_awaited_once_with(
            tenant_id="t",
            client_id="c",
            client_secret="s",
            scope="https://outlook.office365.com/.default",
            token_endpoint="https://tok/ep",
        )

    async def test_microsoft_custom_scope(self):
        cfg = _ms_cfg(oauth_scope="my/.default")
        with patch.object(oauth, "get_client_credentials_token", AsyncMock(return_value="M")) as m:
            await SmtpXOAuth2Backend()._acquire_token(cfg, "u")
        assert m.await_args.kwargs["scope"] == "my/.default"

    async def test_unknown_provider_uses_microsoft_flow(self):
        cfg = _ms_cfg(oauth_provider="weird")
        with (
            patch.object(oauth, "get_client_credentials_token", AsyncMock(return_value="M")) as m,
            patch.object(oauth, "get_service_account_token", AsyncMock()) as g,
        ):
            await SmtpXOAuth2Backend()._acquire_token(cfg, "u")
        m.assert_awaited_once()
        g.assert_not_awaited()


class TestXOAuth2Send:
    async def test_authenticates_as_smtp_user_with_raw_xoauth2(self):
        server = MagicMock()
        cfg = _ms_cfg()
        with (
            patch.object(oauth, "get_client_credentials_token", AsyncMock(return_value="TOK")),
            patch(SMTP, return_value=server),
        ):
            await SmtpXOAuth2Backend().send(cfg=cfg, **_send_kwargs())
        server.auth.assert_called_once()
        mech, authobj = server.auth.call_args.args
        assert mech == "XOAUTH2"
        expected = "user=box@x.com\x01auth=Bearer TOK\x01\x01"
        assert authobj() == expected
        assert authobj("challenge") == expected
        server.login.assert_not_called()
        server.starttls.assert_called_once()
        server.sendmail.assert_called_once()

    async def test_google_subject_is_smtp_user(self):
        server = MagicMock()
        cfg = _ms_cfg(oauth_provider="google", service_account_json="{}")
        with (
            patch.object(oauth, "get_service_account_token", AsyncMock(return_value="G")) as m,
            patch(SMTP, return_value=server),
        ):
            await SmtpXOAuth2Backend().send(cfg=cfg, **_send_kwargs())
        assert m.await_args.kwargs["subject"] == "box@x.com"

    async def test_token_failure_stops_before_connecting(self):
        with (
            patch.object(
                oauth, "get_client_credentials_token", AsyncMock(side_effect=RuntimeError("nope"))
            ),
            patch(SMTP) as ctor,
        ):
            with pytest.raises(RuntimeError, match="nope"):
                await SmtpXOAuth2Backend().send(cfg=_ms_cfg(), **_send_kwargs())
        ctor.assert_not_called()

    async def test_logs_key(self, caplog):
        with (
            patch.object(oauth, "get_client_credentials_token", AsyncMock(return_value="T")),
            patch(SMTP, return_value=MagicMock()),
            caplog.at_level(logging.INFO, logger=smtp.logger.name),
        ):
            await SmtpXOAuth2Backend().send(cfg=_ms_cfg(), **_send_kwargs())
        assert "via smtp_oauth" in caplog.text


# ---------------------------------------------------------------------------
# Graph
# ---------------------------------------------------------------------------


def _graph_cfg(**over):
    base = dict(
        oauth_tenant_id="t",
        oauth_client_id="c",
        oauth_client_secret="s",
        graph_sender="Mailbox@Company.com",
    )
    base.update(over)
    return EmailConfig(**base)


def _resp(status=202, body=None):
    r = MagicMock()
    r.status_code = status
    r.json.return_value = body if body is not None else {}
    r.text = "raw-text"
    return r


@pytest.fixture
def graph_post(monkeypatch):
    post = AsyncMock(return_value=_resp(202))
    client = MagicMock()
    client.post = post
    monkeypatch.setattr(graph, "_client", client)
    return post


class TestGraphConstantsAndClient:
    def test_constants(self):
        assert graph._GRAPH_BASE == "https://graph.microsoft.com/v1.0"
        assert graph._GRAPH_SCOPE == "https://graph.microsoft.com/.default"
        assert graph._HTTP_TIMEOUT == 30.0
        assert GraphApiBackend.key == METHOD_GRAPH_API == "graph_api"

    async def test_client_is_lazy_singleton_with_timeout(self, monkeypatch):
        monkeypatch.setattr(graph, "_client", None)
        created = []

        class Fake:
            def __init__(self, **kw):
                created.append(kw)

        monkeypatch.setattr(graph.httpx, "AsyncClient", Fake)
        a = graph._get_client()
        b = graph._get_client()
        assert a is b
        assert created == [{"timeout": 30.0}]


class TestGraphIsConfigured:
    def test_each_field_required(self):
        b = GraphApiBackend()
        assert b.is_configured(_graph_cfg()) is True
        for field in ("oauth_tenant_id", "oauth_client_id", "oauth_client_secret", "graph_sender"):
            assert b.is_configured(_graph_cfg(**{field: ""})) is False, field

    def test_smtp_fields_irrelevant(self):
        assert GraphApiBackend().is_configured(_graph_cfg(smtp_host="")) is True


class TestGraphSend:
    async def test_token_request_arguments(self, graph_post):
        cfg = _graph_cfg(oauth_token_endpoint="https://ep/token")
        with patch.object(oauth, "get_client_credentials_token", AsyncMock(return_value="T")) as m:
            await GraphApiBackend().send(cfg=cfg, **_send_kwargs())
        m.assert_awaited_once_with(
            tenant_id="t",
            client_id="c",
            client_secret="s",
            scope="https://graph.microsoft.com/.default",
            token_endpoint="https://ep/token",
        )

    async def test_scope_override(self, graph_post):
        cfg = _graph_cfg(oauth_scope="custom/.default")
        with patch.object(oauth, "get_client_credentials_token", AsyncMock(return_value="T")) as m:
            await GraphApiBackend().send(cfg=cfg, **_send_kwargs())
        assert m.await_args.kwargs["scope"] == "custom/.default"

    async def test_payload_shape(self, graph_post):
        with patch.object(oauth, "get_client_credentials_token", AsyncMock(return_value="T")):
            await GraphApiBackend().send(
                cfg=_graph_cfg(), **_send_kwargs(from_addr="brand@x.com", body_html="<b>hi</b>")
            )
        url = graph_post.await_args.args[0]
        assert url == "https://graph.microsoft.com/v1.0/users/Mailbox%40Company.com/sendMail"
        kw = graph_post.await_args.kwargs
        assert set(kw) == {"json", "headers"}
        assert kw["headers"] == {"Authorization": "Bearer T"}
        assert kw["json"] == {
            "message": {
                "subject": "Subj",
                "body": {"contentType": "HTML", "content": "<b>hi</b>"},
                "toRecipients": [{"emailAddress": {"address": "to@x.com"}}],
                "from": {"emailAddress": {"address": "brand@x.com"}},
            },
            "saveToSentItems": False,
        }

    @pytest.mark.parametrize(
        "from_addr,explicit",
        [
            ("", False),
            (DEFAULT_SMTP_FROM, False),
            ("mailbox@company.com", False),  # same as sender, different case
            ("MAILBOX@COMPANY.COM", False),
            ("Mailbox@Company.com", False),
            ("brand@x.com", True),
        ],
    )
    async def test_from_rules(self, graph_post, from_addr, explicit):
        with patch.object(oauth, "get_client_credentials_token", AsyncMock(return_value="T")):
            await GraphApiBackend().send(cfg=_graph_cfg(), **_send_kwargs(from_addr=from_addr))
        msg = graph_post.await_args.kwargs["json"]["message"]
        assert ("from" in msg) is explicit

    async def test_sender_is_percent_encoded(self, graph_post):
        cfg = _graph_cfg(graph_sender="a+b c@x.com")
        with patch.object(oauth, "get_client_credentials_token", AsyncMock(return_value="T")):
            await GraphApiBackend().send(cfg=cfg, **_send_kwargs())
        assert graph_post.await_args.args[0].endswith("/users/a%2Bb%20c%40x.com/sendMail")

    @pytest.mark.parametrize("status", [200, 202])
    async def test_success_statuses(self, graph_post, status, caplog):
        graph_post.return_value = _resp(status)
        with (
            patch.object(oauth, "get_client_credentials_token", AsyncMock(return_value="T")),
            caplog.at_level(logging.INFO, logger=graph.logger.name),
        ):
            await GraphApiBackend().send(cfg=_graph_cfg(), **_send_kwargs())
        assert "Email sent to to@x.com via graph_api: Subj" in caplog.text

    @pytest.mark.parametrize("status", [201, 204, 400, 401, 403, 429, 500])
    async def test_other_statuses_raise(self, graph_post, status, caplog):
        graph_post.return_value = _resp(status, {"error": {"message": "denied"}})
        with (
            patch.object(oauth, "get_client_credentials_token", AsyncMock(return_value="T")),
            caplog.at_level(logging.ERROR, logger=graph.logger.name),
        ):
            with pytest.raises(RuntimeError) as exc:
                await GraphApiBackend().send(cfg=_graph_cfg(), **_send_kwargs())
        assert str(exc.value) == f"Graph sendMail failed ({status}): denied"
        assert f"Graph sendMail failed ({status}): denied" in caplog.text

    async def test_token_failure_means_no_post(self, graph_post):
        with patch.object(
            oauth, "get_client_credentials_token", AsyncMock(side_effect=RuntimeError("tok"))
        ):
            with pytest.raises(RuntimeError, match="tok"):
                await GraphApiBackend().send(cfg=_graph_cfg(), **_send_kwargs())
        graph_post.assert_not_awaited()

    async def test_token_not_in_error_message(self, graph_post):
        graph_post.return_value = _resp(500, {"error": "x"})
        with patch.object(oauth, "get_client_credentials_token", AsyncMock(return_value="SECRET")):
            with pytest.raises(RuntimeError) as exc:
                await GraphApiBackend().send(cfg=_graph_cfg(), **_send_kwargs())
        assert "SECRET" not in str(exc.value)


# ---------------------------------------------------------------------------
# runtime.apply_email_settings_to_runtime
# ---------------------------------------------------------------------------

_ATTRS = [
    "EMAIL_METHOD",
    "SMTP_HOST",
    "SMTP_PORT",
    "SMTP_USER",
    "SMTP_PASSWORD",
    "SMTP_FROM",
    "SMTP_TLS",
    "_app_base_url",
    "EMAIL_OAUTH_PROVIDER",
    "EMAIL_OAUTH_TENANT_ID",
    "EMAIL_OAUTH_CLIENT_ID",
    "EMAIL_GRAPH_SENDER",
    "EMAIL_OAUTH_SCOPE",
    "EMAIL_OAUTH_TOKEN_ENDPOINT",
    "EMAIL_OAUTH_CLIENT_SECRET",
    "EMAIL_SERVICE_ACCOUNT_JSON",
]


@pytest.fixture
def cfg_sentinel(monkeypatch):
    """Every touched runtime attribute starts as a sentinel."""
    for attr in _ATTRS:
        monkeypatch.setattr(real_settings, attr, f"SENTINEL-{attr}", raising=False)
    monkeypatch.setattr(real_settings, "SMTP_PORT", 25, raising=False)
    monkeypatch.setattr(real_settings, "SMTP_TLS", None, raising=False)
    return real_settings


class TestApplyToRuntime:
    def test_legacy_fields_applied(self, cfg_sentinel):
        runtime.apply_email_settings_to_runtime(
            {
                "method": "smtp_oauth",
                "smtp_host": "h.example",
                "smtp_port": "2525",
                "smtp_user": "u",
                "smtp_password": encrypt_value("hunter2"),
                "smtp_from": "f@x.com",
                "smtp_tls": 0,
                "app_base_url": "https://app.example",
            }
        )
        s = cfg_sentinel
        assert s.EMAIL_METHOD == "smtp_oauth"
        assert s.SMTP_HOST == "h.example"
        assert s.SMTP_PORT == 2525 and isinstance(s.SMTP_PORT, int)
        assert s.SMTP_USER == "u"
        assert s.SMTP_PASSWORD == "hunter2"
        assert s.SMTP_FROM == "f@x.com"
        assert s.SMTP_TLS is False
        assert s._app_base_url == "https://app.example"

    def test_smtp_tls_true(self, cfg_sentinel):
        runtime.apply_email_settings_to_runtime({"smtp_tls": 1})
        assert cfg_sentinel.SMTP_TLS is True

    def test_legacy_falsy_values_leave_runtime_untouched(self, cfg_sentinel):
        runtime.apply_email_settings_to_runtime(
            {
                "method": "",
                "smtp_host": "",
                "smtp_port": 0,
                "smtp_user": "",
                "smtp_password": "",
                "smtp_from": "",
                "app_base_url": "",
            }
        )
        s = cfg_sentinel
        assert s.EMAIL_METHOD == "SENTINEL-EMAIL_METHOD"
        assert s.SMTP_HOST == "SENTINEL-SMTP_HOST"
        assert s.SMTP_PORT == 25
        assert s.SMTP_USER == "SENTINEL-SMTP_USER"
        assert s.SMTP_PASSWORD == "SENTINEL-SMTP_PASSWORD"
        assert s.SMTP_FROM == "SENTINEL-SMTP_FROM"
        assert s._app_base_url == "SENTINEL-_app_base_url"
        assert s.SMTP_TLS is None  # absent key -> not touched

    def test_empty_settings_change_nothing(self, cfg_sentinel):
        runtime.apply_email_settings_to_runtime({})
        for attr in _ATTRS:
            if attr not in ("SMTP_PORT", "SMTP_TLS"):
                assert getattr(cfg_sentinel, attr) == f"SENTINEL-{attr}"

    def test_presence_fields_mapping(self, cfg_sentinel):
        runtime.apply_email_settings_to_runtime(
            {
                "oauth_provider": "google",
                "oauth_tenant_id": "tn",
                "oauth_client_id": "cid",
                "graph_sender": "g@x.com",
                "oauth_scope": "sc",
                "oauth_token_endpoint": "https://t/ep",
            }
        )
        s = cfg_sentinel
        assert s.EMAIL_OAUTH_PROVIDER == "google"
        assert s.EMAIL_OAUTH_TENANT_ID == "tn"
        assert s.EMAIL_OAUTH_CLIENT_ID == "cid"
        assert s.EMAIL_GRAPH_SENDER == "g@x.com"
        assert s.EMAIL_OAUTH_SCOPE == "sc"
        assert s.EMAIL_OAUTH_TOKEN_ENDPOINT == "https://t/ep"
        # secrets untouched when their key is absent
        assert s.EMAIL_OAUTH_CLIENT_SECRET == "SENTINEL-EMAIL_OAUTH_CLIENT_SECRET"
        assert s.EMAIL_SERVICE_ACCOUNT_JSON == "SENTINEL-EMAIL_SERVICE_ACCOUNT_JSON"

    def test_presence_fields_cleared_by_falsy_values(self, cfg_sentinel):
        runtime.apply_email_settings_to_runtime(
            {
                "oauth_provider": None,
                "oauth_tenant_id": "",
                "oauth_client_id": None,
                "graph_sender": "",
                "oauth_scope": None,
                "oauth_token_endpoint": "",
            }
        )
        s = cfg_sentinel
        for attr in (
            "EMAIL_OAUTH_PROVIDER",
            "EMAIL_OAUTH_TENANT_ID",
            "EMAIL_OAUTH_CLIENT_ID",
            "EMAIL_GRAPH_SENDER",
            "EMAIL_OAUTH_SCOPE",
            "EMAIL_OAUTH_TOKEN_ENDPOINT",
        ):
            assert getattr(s, attr) == "", attr

    def test_secret_fields_decrypted(self, cfg_sentinel):
        runtime.apply_email_settings_to_runtime(
            {
                "oauth_client_secret": encrypt_value("cs-plain"),
                "service_account_json": encrypt_value('{"a": 1}'),
            }
        )
        assert cfg_sentinel.EMAIL_OAUTH_CLIENT_SECRET == "cs-plain"
        assert cfg_sentinel.EMAIL_SERVICE_ACCOUNT_JSON == '{"a": 1}'

    def test_secret_fields_cleared_by_falsy(self, cfg_sentinel):
        runtime.apply_email_settings_to_runtime(
            {"oauth_client_secret": "", "service_account_json": None}
        )
        assert cfg_sentinel.EMAIL_OAUTH_CLIENT_SECRET == ""
        assert cfg_sentinel.EMAIL_SERVICE_ACCOUNT_JSON == ""

    def test_legacy_plaintext_secret_passes_through(self, cfg_sentinel):
        runtime.apply_email_settings_to_runtime({"smtp_password": "plain-pw"})
        assert cfg_sentinel.SMTP_PASSWORD == "plain-pw"

    def test_token_cache_is_dropped(self, cfg_sentinel):
        oauth._cache_put("some-key", "tok", 3600)
        assert oauth._cache_get("some-key") == "tok"
        runtime.apply_email_settings_to_runtime({})
        assert oauth._cache_get("some-key") is None

    def test_reset_cache_called_once(self, cfg_sentinel, monkeypatch):
        spy = MagicMock()
        monkeypatch.setattr(oauth, "reset_cache", spy)
        runtime.apply_email_settings_to_runtime({"method": "graph_api"})
        spy.assert_called_once_with()
