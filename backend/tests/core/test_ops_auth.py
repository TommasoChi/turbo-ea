"""Unit tests for the ops request-signature primitives (no database needed)."""

from __future__ import annotations

import base64
import hashlib
import time

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

from app.core.ops_auth import _verify_signature, canonical_string


def make_keypair() -> tuple[Ed25519PrivateKey, str]:
    private = Ed25519PrivateKey.generate()
    public_b64 = base64.b64encode(
        private.public_key().public_bytes(
            encoding=serialization.Encoding.Raw,
            format=serialization.PublicFormat.Raw,
        )
    ).decode()
    return private, public_b64


def sign(private: Ed25519PrivateKey, method: str, path: str, body: bytes, ts: str, nonce: str):
    return base64.b64encode(private.sign(canonical_string(method, path, body, ts, nonce))).decode()


def test_canonical_string_binds_all_parts():
    body = b'{"a":1}'
    canonical = canonical_string("POST", "/api/v1/ops/rescue-access", body, "123", "n-1")
    assert canonical.decode().split("\n") == [
        "POST",
        "/api/v1/ops/rescue-access",
        hashlib.sha256(body).hexdigest(),
        "123",
        "n-1",
    ]


def test_signature_verifies_and_rejects_tampering():
    private, public_b64 = make_keypair()
    ts, nonce = str(int(time.time())), "nonce-1"
    signature = sign(private, "GET", "/api/v1/ops/info", b"", ts, nonce)

    assert _verify_signature(public_b64, "GET", "/api/v1/ops/info", b"", ts, nonce, signature)
    # Tampered path / body / nonce all fail
    assert not _verify_signature(public_b64, "GET", "/api/v1/ops/export", b"", ts, nonce, signature)
    assert not _verify_signature(public_b64, "GET", "/api/v1/ops/info", b"x", ts, nonce, signature)
    assert not _verify_signature(public_b64, "GET", "/api/v1/ops/info", b"", ts, "other", signature)


def test_signature_rejects_wrong_key_and_garbage():
    private, _ = make_keypair()
    _, other_public = make_keypair()
    ts = str(int(time.time()))
    signature = sign(private, "GET", "/api/v1/ops/info", b"", ts, "n")
    assert not _verify_signature(other_public, "GET", "/api/v1/ops/info", b"", ts, "n", signature)
    assert not _verify_signature(other_public, "GET", "/api/v1/ops/info", b"", ts, "n", "!!!")


# ---------------------------------------------------------------------------
# verify_ops_request: exercised directly with a stub request and a stub session,
# so every status code, detail string and boundary is pinned without a database.
# ---------------------------------------------------------------------------
from types import SimpleNamespace  # noqa: E402
from unittest.mock import AsyncMock, MagicMock  # noqa: E402

import pytest  # noqa: E402
from fastapi import HTTPException  # noqa: E402
from starlette.datastructures import Headers  # noqa: E402

from app.config import settings  # noqa: E402
from app.core import ops_auth  # noqa: E402
from app.core.ops_auth import (  # noqa: E402
    MAX_CLOCK_SKEW_SECONDS,
    NONCE_HEADER,
    SIGNATURE_HEADER,
    TIMESTAMP_HEADER,
    verify_ops_request,
)

NOW = 1_800_000_000


class _Req:
    def __init__(self, headers, method="GET", path="/api/v1/ops/info", query="", body=b""):
        self.headers = Headers(headers)
        self.method = method
        self.url = SimpleNamespace(path=path, query=query)
        self._body = body

    async def body(self):
        return self._body


def _db(existing=None):
    db = MagicMock()
    result = MagicMock()
    result.scalar_one_or_none.return_value = existing
    db.execute = AsyncMock(return_value=result)
    db.add = MagicMock()
    db.flush = AsyncMock()
    return db


@pytest.fixture
def keys(monkeypatch):
    private, public_b64 = make_keypair()
    monkeypatch.setattr(settings, "OPS_PUBLIC_KEY", public_b64)
    monkeypatch.setattr(ops_auth.time, "time", lambda: NOW)
    return private


def _signed(
    private, *, method="GET", path="/api/v1/ops/info", query="", body=b"", ts=None, nonce="n-1"
):
    ts = str(NOW if ts is None else ts)
    full = f"{path}?{query}" if query else path
    return _Req(
        {
            TIMESTAMP_HEADER: ts,
            NONCE_HEADER: nonce,
            SIGNATURE_HEADER: sign(private, method, full, body, ts, nonce),
        },
        method=method,
        path=path,
        query=query,
        body=body,
    )


async def _fails(request, db, status, detail):
    with pytest.raises(HTTPException) as exc:
        await verify_ops_request(request, db)
    assert exc.value.status_code == status
    assert exc.value.detail == detail


def test_header_names_and_skew_constant():
    assert SIGNATURE_HEADER == "X-Ops-Signature"
    assert TIMESTAMP_HEADER == "X-Ops-Timestamp"
    assert NONCE_HEADER == "X-Ops-Nonce"
    assert MAX_CLOCK_SKEW_SECONDS == 300


def test_canonical_string_is_exact_bytes_and_uppercases_method():
    body = b"hello"
    digest = hashlib.sha256(body).hexdigest()
    got = canonical_string("post", "/p?q=1", body, "99", "nn")
    assert got == f"POST\n/p?q=1\n{digest}\n99\nnn".encode()


def test_verify_signature_returns_exact_booleans():
    private, public_b64 = make_keypair()
    sig = sign(private, "POST", "/x", b"b", "1", "n")
    assert _verify_signature(public_b64, "POST", "/x", b"b", "1", "n", sig) is True
    assert _verify_signature(public_b64, "GET", "/x", b"b", "1", "n", sig) is False
    assert _verify_signature(public_b64, "POST", "/x", b"b", "2", "n", sig) is False
    # method is case-insensitive because canonical_string upper-cases it
    assert _verify_signature(public_b64, "post", "/x", b"b", "1", "n", sig) is True


def test_verify_signature_swallows_value_and_type_errors():
    private, public_b64 = make_keypair()
    sig = sign(private, "GET", "/x", b"", "1", "n")
    # wrong key length -> ValueError from from_public_bytes
    assert _verify_signature("AAAA", "GET", "/x", b"", "1", "n", sig) is False
    # bad padding -> binascii.Error (a ValueError)
    assert _verify_signature(public_b64, "GET", "/x", b"", "1", "n", "abc") is False
    # None -> TypeError from b64decode
    assert _verify_signature(None, "GET", "/x", b"", "1", "n", sig) is False  # type: ignore[arg-type]
    assert _verify_signature(public_b64, "GET", "/x", b"", "1", "n", None) is False  # type: ignore[arg-type]
    # well-formed but wrong-length signature -> InvalidSignature
    short = base64.b64encode(b"\x00" * 10).decode()
    assert _verify_signature(public_b64, "GET", "/x", b"", "1", "n", short) is False


async def test_feature_off_is_404_not_found(monkeypatch):
    monkeypatch.setattr(settings, "OPS_PUBLIC_KEY", "")
    db = _db()
    # Even fully missing headers answer 404, not 401: the surface does not exist.
    await _fails(_Req({}), db, 404, "Not Found")
    db.execute.assert_not_awaited()


@pytest.mark.parametrize("missing", [TIMESTAMP_HEADER, NONCE_HEADER, SIGNATURE_HEADER])
async def test_each_missing_header_is_401(keys, missing):
    request = _signed(keys)
    request.headers = Headers(
        {k: v for k, v in request.headers.items() if k.lower() != missing.lower()}
    )
    await _fails(request, _db(), 401, "Missing ops auth headers")


@pytest.mark.parametrize("empty", [TIMESTAMP_HEADER, NONCE_HEADER, SIGNATURE_HEADER])
async def test_each_empty_header_is_401(keys, empty):
    request = _signed(keys)
    headers = dict(request.headers.items())
    headers[empty.lower()] = ""
    request.headers = Headers(headers)
    await _fails(request, _db(), 401, "Missing ops auth headers")


async def test_nonce_length_boundary(keys):
    ok = _signed(keys, nonce="a" * 64)
    db = _db()
    assert await verify_ops_request(ok, db) is None
    assert db.add.call_args.args[0].nonce == "a" * 64

    await _fails(_signed(keys, nonce="a" * 65), _db(), 401, "Missing ops auth headers")


async def test_non_integer_timestamp_is_invalid(keys):
    request = _signed(keys)
    request.headers = Headers(
        {
            TIMESTAMP_HEADER: "12.5",
            NONCE_HEADER: "n-1",
            SIGNATURE_HEADER: request.headers[SIGNATURE_HEADER],
        }
    )
    await _fails(request, _db(), 401, "Invalid timestamp")


@pytest.mark.parametrize("offset", [0, 1, -1, 299, -299, 300, -300])
async def test_timestamp_inside_window_passes(keys, offset):
    assert await verify_ops_request(_signed(keys, ts=NOW + offset), _db()) is None


@pytest.mark.parametrize("offset", [301, -301, 3600, -3600])
async def test_timestamp_outside_window_is_expired(keys, offset):
    db = _db()
    await _fails(_signed(keys, ts=NOW + offset), db, 401, "Request expired")
    db.execute.assert_not_awaited()


async def test_bad_signature_is_401_and_nonce_not_consumed(keys):
    request = _signed(keys)
    other_private, _ = make_keypair()
    request.headers = Headers(
        {
            TIMESTAMP_HEADER: str(NOW),
            NONCE_HEADER: "n-1",
            SIGNATURE_HEADER: sign(other_private, "GET", "/api/v1/ops/info", b"", str(NOW), "n-1"),
        }
    )
    db = _db()
    await _fails(request, db, 401, "Invalid signature")
    db.add.assert_not_called()
    db.execute.assert_not_awaited()


async def test_signature_binds_method_path_query_and_body(keys):
    base = {"method": "POST", "path": "/api/v1/ops/x", "query": "a=1", "body": b"{}"}
    assert await verify_ops_request(_signed(keys, **base), _db()) is None

    for change in (
        {"method": "DELETE"},
        {"path": "/api/v1/ops/y"},
        {"query": "a=2"},
        {"query": ""},
        {"body": b"{ }"},
    ):
        req = _signed(keys, **base)
        if "method" in change:
            req.method = change["method"]
        if "path" in change:
            req.url = SimpleNamespace(path=change["path"], query=base["query"])
        if "query" in change:
            req.url = SimpleNamespace(path=base["path"], query=change["query"])
        if "body" in change:
            req._body = change["body"]
        await _fails(req, _db(), 401, "Invalid signature")


async def test_query_string_is_rejoined_with_question_mark(keys):
    assert await verify_ops_request(_signed(keys, query="x=1&y=2"), _db()) is None
    assert await verify_ops_request(_signed(keys), _db()) is None


async def test_replayed_nonce_is_401(keys):
    db = _db(existing=object())
    await _fails(_signed(keys), db, 401, "Replayed nonce")
    db.add.assert_not_called()
    db.flush.assert_not_awaited()


async def test_fresh_nonce_is_recorded_and_flushed(keys):
    db = _db(existing=None)
    assert await verify_ops_request(_signed(keys, nonce="fresh-nonce"), db) is None
    db.execute.assert_awaited_once()
    db.add.assert_called_once()
    assert db.add.call_args.args[0].nonce == "fresh-nonce"
    db.flush.assert_awaited_once()
    stmt = str(db.execute.call_args.args[0].compile(compile_kwargs={"literal_binds": True}))
    assert "fresh-nonce" in stmt
