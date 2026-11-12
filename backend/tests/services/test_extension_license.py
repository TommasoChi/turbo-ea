"""Unit tests for signed extension license parsing + entitlement state (no DB)."""

from __future__ import annotations

import base64
import hashlib
import json
from datetime import datetime, timedelta, timezone

import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

from app.services.extensions import license as license_module
from app.services.extensions.license import (
    LICENSE_SCHEMA,
    Entitlement,
    LicenseError,
    entitlement_state,
    grace_until,
    parse_and_verify,
)


def make_keypair() -> tuple[Ed25519PrivateKey, str]:
    private = Ed25519PrivateKey.generate()
    public_b64 = base64.b64encode(
        private.public_key().public_bytes(
            encoding=serialization.Encoding.Raw,
            format=serialization.PublicFormat.Raw,
        )
    ).decode()
    return private, public_b64


def make_license(private: Ed25519PrivateKey, payload: dict, *, schema: str = LICENSE_SCHEMA) -> str:
    payload_bytes = json.dumps(payload).encode()
    return json.dumps(
        {
            "schema": schema,
            "key_id": "vendor-1",
            "payload": base64.b64encode(payload_bytes).decode(),
            "signature": base64.b64encode(private.sign(payload_bytes)).decode(),
        }
    )


PAYLOAD = {
    "licensee": "ACME Corp",
    "customer_id": "cus_7f3a",
    "issued_at": "2026-07-01T00:00:00Z",
    "grace_days": 30,
    # `plan` is intentionally left on these entitlements: it is a removed field,
    # and a legacy signed license may still carry it — the parser must tolerate
    # (ignore) it, which test_valid_license_parses asserts.
    "entitlements": [
        {
            "extension_key": "capability-benchmarks",
            "plan": "enterprise",
            "expires_at": "2027-07-01T00:00:00Z",
        },
        {"extension_key": "sap-sync", "plan": "standard", "expires_at": None},
    ],
}


class TestParseAndVerify:
    def test_valid_license_parses(self):
        private, public_b64 = make_keypair()
        doc = parse_and_verify(make_license(private, PAYLOAD), public_key_b64=public_b64)
        assert doc.licensee == "ACME Corp"
        assert doc.customer_id == "cus_7f3a"
        assert doc.grace_days == 30
        assert doc.key_id == "vendor-1"
        assert doc.issued_at == datetime(2026, 7, 1, tzinfo=timezone.utc)
        assert len(doc.entitlements) == 2
        ent = doc.entitlement_for("capability-benchmarks")
        assert ent is not None
        # `plan` was removed; a legacy license carrying it parses fine but the
        # field is never surfaced.
        assert not hasattr(ent, "plan")
        assert ent.expires_at == datetime(2027, 7, 1, tzinfo=timezone.utc)
        # Perpetual entitlement
        assert doc.entitlement_for("sap-sync").expires_at is None
        assert doc.entitlement_for("unknown") is None
        assert doc.raw_text  # preserved byte-exact for storage/re-verification
        assert doc.instance_id == ""  # not stamped in this fixture

    def test_instance_id_is_surfaced(self):
        private, public_b64 = make_keypair()
        payload = dict(PAYLOAD, instance_id="TEA-0123-4567-89AB")
        doc = parse_and_verify(make_license(private, payload), public_key_b64=public_b64)
        assert doc.instance_id == "TEA-0123-4567-89AB"

    def test_tampered_payload_rejected(self):
        private, public_b64 = make_keypair()
        envelope = json.loads(make_license(private, PAYLOAD))
        forged = dict(PAYLOAD, licensee="Evil Corp")
        envelope["payload"] = base64.b64encode(json.dumps(forged).encode()).decode()
        with pytest.raises(LicenseError, match="signature"):
            parse_and_verify(json.dumps(envelope), public_key_b64=public_b64)

    def test_wrong_key_rejected(self):
        private, _ = make_keypair()
        _, other_public = make_keypair()
        with pytest.raises(LicenseError, match="signature"):
            parse_and_verify(make_license(private, PAYLOAD), public_key_b64=other_public)

    def test_no_vendor_key_configured_rejected(self, monkeypatch):
        """A build with an empty baked trust map refuses all licenses."""
        private, _ = make_keypair()
        monkeypatch.setattr("app.core.extension_signing.DEFAULT_VENDOR_PUBLIC_KEYS", {})
        with pytest.raises(LicenseError, match="vendor key"):
            parse_and_verify(make_license(private, PAYLOAD))

    @pytest.mark.parametrize(
        "text",
        [
            "not json",
            "[]",
            json.dumps({"schema": LICENSE_SCHEMA}),
            json.dumps({"schema": "turboea-license/999", "payload": "e30=", "signature": "AA=="}),
            json.dumps({"schema": LICENSE_SCHEMA, "payload": "!!!", "signature": "AA=="}),
        ],
    )
    def test_malformed_envelopes_rejected(self, text):
        _, public_b64 = make_keypair()
        with pytest.raises(LicenseError):
            parse_and_verify(text, public_key_b64=public_b64)

    @pytest.mark.parametrize(
        "payload",
        [
            {"customer_id": "x"},  # missing licensee
            dict(PAYLOAD, licensee="   "),
            dict(PAYLOAD, grace_days=-1),
            dict(PAYLOAD, grace_days="thirty"),
            dict(PAYLOAD, grace_days=True),
            dict(PAYLOAD, entitlements="all"),
            dict(PAYLOAD, entitlements=[{"plan": "gold"}]),  # missing extension_key
            dict(PAYLOAD, entitlements=[{"extension_key": "x", "expires_at": "someday"}]),
            dict(PAYLOAD, issued_at=12345),
        ],
    )
    def test_invalid_payloads_rejected(self, payload):
        private, public_b64 = make_keypair()
        with pytest.raises(LicenseError):
            parse_and_verify(make_license(private, payload), public_key_b64=public_b64)

    def test_signed_non_object_payload_rejected(self):
        private, public_b64 = make_keypair()
        payload_bytes = json.dumps(["not", "a", "dict"]).encode()
        text = json.dumps(
            {
                "schema": LICENSE_SCHEMA,
                "payload": base64.b64encode(payload_bytes).decode(),
                "signature": base64.b64encode(private.sign(payload_bytes)).decode(),
            }
        )
        with pytest.raises(LicenseError, match="object"):
            parse_and_verify(text, public_key_b64=public_b64)

    def test_grace_days_defaults_when_absent(self):
        private, public_b64 = make_keypair()
        payload = {k: v for k, v in PAYLOAD.items() if k != "grace_days"}
        doc = parse_and_verify(make_license(private, payload), public_key_b64=public_b64)
        assert doc.grace_days == 30

    def test_auto_renew_parses_and_defaults_to_unknown(self):
        private, public_b64 = make_keypair()
        payload = dict(
            PAYLOAD,
            entitlements=[
                {
                    "extension_key": "renewing",
                    "expires_at": "2027-07-01T00:00:00Z",
                    "auto_renew": True,
                },
                {
                    "extension_key": "cancelled",
                    "expires_at": "2027-07-01T00:00:00Z",
                    "auto_renew": False,
                },
                {"extension_key": "pre-field", "expires_at": "2027-07-01T00:00:00Z"},
            ],
        )
        doc = parse_and_verify(make_license(private, payload), public_key_b64=public_b64)
        assert doc.entitlement_for("renewing").auto_renew is True
        assert doc.entitlement_for("cancelled").auto_renew is False
        # Absent on manual/offline and pre-field licenses → unknown, never False.
        assert doc.entitlement_for("pre-field").auto_renew is None

    @pytest.mark.parametrize("garbage", ["yes", 1, 0, [], {}])
    def test_garbage_auto_renew_degrades_to_unknown(self, garbage):
        """A display-only field must never make a signed license fail to parse."""
        private, public_b64 = make_keypair()
        payload = dict(
            PAYLOAD,
            entitlements=[
                {"extension_key": "x", "expires_at": None, "auto_renew": garbage},
            ],
        )
        doc = parse_and_verify(make_license(private, payload), public_key_b64=public_b64)
        assert doc.entitlement_for("x").auto_renew is None

    def test_trial_parses_and_defaults_to_unknown(self):
        private, public_b64 = make_keypair()
        payload = dict(
            PAYLOAD,
            entitlements=[
                {
                    "extension_key": "trialing",
                    "expires_at": "2026-08-01T00:00:00Z",
                    "trial": True,
                },
                {"extension_key": "paid", "expires_at": "2027-07-01T00:00:00Z"},
            ],
        )
        doc = parse_and_verify(make_license(private, payload), public_key_b64=public_b64)
        assert doc.entitlement_for("trialing").trial is True
        # Absent on paid/manual/pre-field licenses → unknown, never True.
        assert doc.entitlement_for("paid").trial is None

    @pytest.mark.parametrize("garbage", ["yes", 1, 0, [], {}])
    def test_garbage_trial_degrades_to_unknown(self, garbage):
        """Like auto_renew: a signed license must never fail to verify over it."""
        private, public_b64 = make_keypair()
        payload = dict(
            PAYLOAD,
            entitlements=[
                {"extension_key": "x", "expires_at": None, "trial": garbage},
            ],
        )
        doc = parse_and_verify(make_license(private, payload), public_key_b64=public_b64)
        assert doc.entitlement_for("x").trial is None


class TestEntitlementState:
    EXPIRES = datetime(2027, 7, 1, tzinfo=timezone.utc)
    ENT = Entitlement(extension_key="x", expires_at=EXPIRES)

    def test_before_expiry_is_active(self):
        assert entitlement_state(self.ENT, 30, now=self.EXPIRES - timedelta(days=1)) == "active"

    def test_at_expiry_is_still_active(self):
        assert entitlement_state(self.ENT, 30, now=self.EXPIRES) == "active"

    def test_within_grace_window(self):
        assert entitlement_state(self.ENT, 30, now=self.EXPIRES + timedelta(days=15)) == "grace"
        assert entitlement_state(self.ENT, 30, now=self.EXPIRES + timedelta(days=30)) == "grace"

    def test_past_grace_is_expired(self):
        moment = self.EXPIRES + timedelta(days=30, seconds=1)
        assert entitlement_state(self.ENT, 30, now=moment) == "expired"

    def test_zero_grace_goes_straight_to_expired(self):
        assert entitlement_state(self.ENT, 0, now=self.EXPIRES + timedelta(seconds=1)) == "expired"

    def test_perpetual_is_always_active(self):
        ent = Entitlement(extension_key="x", expires_at=None)
        assert entitlement_state(ent, 0, now=datetime(2099, 1, 1, tzinfo=timezone.utc)) == "active"
        assert grace_until(ent, 30) is None

    def test_grace_until(self):
        assert grace_until(self.ENT, 30) == self.EXPIRES + timedelta(days=30)


class TestLicenseAdjustments:
    CAP = datetime(2026, 12, 1, tzinfo=timezone.utc)
    PAYLOAD = {
        "licensee": "ACME Corp",
        "issued_at": "2026-10-01T00:00:00Z",
        "grace_days": 30,
        "entitlements": [
            {"extension_key": "later", "expires_at": "2027-10-01T00:00:00Z", "trial": True},
            {"extension_key": "earlier", "expires_at": "2026-11-15T00:00:00Z"},
            {"extension_key": "same", "expires_at": "2026-12-01T00:00:00Z"},
            {"extension_key": "perpetual", "expires_at": None},
        ],
    }

    @staticmethod
    def fingerprint(text: str) -> str:
        signature = base64.b64decode(json.loads(text)["signature"])
        return hashlib.sha256(signature).hexdigest()

    def test_license_adjustment_caps_a_listed_license(self, monkeypatch):
        private, public_b64 = make_keypair()
        text = make_license(private, self.PAYLOAD)
        monkeypatch.setitem(license_module._LICENSE_ADJUSTMENTS, self.fingerprint(text), self.CAP)
        doc = parse_and_verify(text, public_key_b64=public_b64)
        assert doc.entitlement_for("later").expires_at == self.CAP
        assert doc.entitlement_for("later").trial is True
        assert doc.entitlement_for("earlier").expires_at == datetime(
            2026, 11, 15, tzinfo=timezone.utc
        )
        assert doc.entitlement_for("same").expires_at == self.CAP
        assert doc.entitlement_for("perpetual").expires_at == self.CAP
        assert doc.licensee == "ACME Corp"
        assert doc.grace_days == 30
        assert doc.raw_text == text

    def test_license_adjustment_leaves_other_licenses_alone(self, monkeypatch):
        private, public_b64 = make_keypair()
        listed = make_license(private, self.PAYLOAD)
        monkeypatch.setitem(license_module._LICENSE_ADJUSTMENTS, self.fingerprint(listed), self.CAP)
        other = make_license(private, dict(self.PAYLOAD, licensee="Other Corp"))
        doc = parse_and_verify(other, public_key_b64=public_b64)
        assert doc.entitlement_for("later").expires_at == datetime(2027, 10, 1, tzinfo=timezone.utc)
        assert doc.entitlement_for("perpetual").expires_at is None

    def test_license_adjustment_table_is_well_formed(self):
        for fingerprint, cap in license_module._LICENSE_ADJUSTMENTS.items():
            assert len(fingerprint) == 64
            assert fingerprint == fingerprint.lower()
            int(fingerprint, 16)
            assert cap.utcoffset() == timedelta(0)


# ---------------------------------------------------------------------------
# Exact-contract tests: constants, every error message, tolerant parsing, the
# adjustment table and the entitlement-state boundaries.
# ---------------------------------------------------------------------------
from app.services.extensions.license import (  # noqa: E402
    DEFAULT_GRACE_DAYS,
    LicenseDocument,
)


def _envelope(private, payload_bytes: bytes, **extra) -> str:
    env = {
        "schema": LICENSE_SCHEMA,
        "payload": base64.b64encode(payload_bytes).decode(),
        "signature": base64.b64encode(private.sign(payload_bytes)).decode(),
    }
    env.update(extra)
    return json.dumps(env)


def _err(text, public_b64) -> str:
    with pytest.raises(LicenseError) as exc:
        parse_and_verify(text, public_key_b64=public_b64)
    return str(exc.value)


def test_constants():
    assert LICENSE_SCHEMA == "turboea-license/1"
    assert DEFAULT_GRACE_DAYS == 30


def test_adjustment_table_is_pinned():
    table = license_module._LICENSE_ADJUSTMENTS
    assert len(table) == 4
    assert set(table.values()) == {datetime(2026, 12, 1, tzinfo=timezone.utc)}
    assert all(v.tzinfo is timezone.utc for v in table.values())


def test_dataclass_defaults():
    ent = Entitlement(extension_key="x")
    assert ent.expires_at is None and ent.auto_renew is None and ent.trial is None
    doc = LicenseDocument(licensee="L", customer_id="c", issued_at=None, grace_days=3)
    assert doc.entitlements == []
    assert doc.key_id == "" and doc.raw_text == "" and doc.renewal_key == ""
    assert doc.instance_id == ""
    # default lists are not shared between instances
    assert LicenseDocument("a", "b", None, 1).entitlements is not doc.entitlements


def test_entitlement_for_returns_first_match():
    first = Entitlement(extension_key="x", expires_at=None)
    second = Entitlement(extension_key="x", expires_at=datetime(2030, 1, 1, tzinfo=timezone.utc))
    doc = LicenseDocument("L", "c", None, 1, entitlements=[Entitlement("y"), first, second])
    assert doc.entitlement_for("x") is first
    assert doc.entitlement_for("X") is None  # case-sensitive
    assert doc.entitlement_for("") is None


class TestErrorMessages:
    def test_no_trusted_keys(self, monkeypatch):
        private, _ = make_keypair()
        monkeypatch.setattr("app.core.extension_signing.DEFAULT_VENDOR_PUBLIC_KEYS", {})
        with pytest.raises(LicenseError) as exc:
            parse_and_verify(make_license(private, PAYLOAD))
        assert str(exc.value) == (
            "This build has no extension vendor key configured — licenses cannot be verified"
        )

    def test_pinned_empty_string_key_is_still_a_key(self):
        private, _ = make_keypair()
        # "" is a pinned (useless) key: the error is the signature one, not "no vendor key".
        assert _err(make_license(private, PAYLOAD), "") == (
            "Invalid license: signature verification failed"
        )

    @pytest.mark.parametrize("text", ["not json", "", None])
    def test_not_json(self, text):
        _, pub = make_keypair()
        assert _err(text, pub) == "Invalid license: not valid JSON"

    @pytest.mark.parametrize("text", ["[]", '"str"', "1", "null"])
    def test_not_object(self, text):
        _, pub = make_keypair()
        assert _err(text, pub) == "Invalid license: envelope must be a JSON object"

    @pytest.mark.parametrize(
        "env", [{}, {"schema": "turboea-license/2"}, {"schema": "TURBOEA-LICENSE/1"}]
    )
    def test_bad_schema(self, env):
        _, pub = make_keypair()
        assert _err(json.dumps(env), pub) == "Invalid license: unsupported or missing schema"

    @pytest.mark.parametrize(
        "env",
        [
            {"signature": "AA=="},
            {"payload": "e30="},
            {"payload": 1, "signature": "AA=="},
            {"payload": "e30=", "signature": None},
        ],
    )
    def test_missing_payload_or_signature(self, env):
        _, pub = make_keypair()
        text = json.dumps({"schema": LICENSE_SCHEMA, **env})
        assert _err(text, pub) == "Invalid license: missing payload or signature"

    @pytest.mark.parametrize("payload", ["!!!", "e30", "e3 0=", "e30=\n"])
    def test_payload_not_base64_is_strict(self, payload):
        _, pub = make_keypair()
        text = json.dumps({"schema": LICENSE_SCHEMA, "payload": payload, "signature": "AA=="})
        assert _err(text, pub) == "Invalid license: payload is not valid base64"

    def test_signature_failure(self):
        private, pub = make_keypair()
        other, _ = make_keypair()
        text = _envelope(private, b"{}")
        env = json.loads(text)
        env["signature"] = base64.b64encode(other.sign(b"{}")).decode()
        assert _err(json.dumps(env), pub) == "Invalid license: signature verification failed"

    def test_payload_not_json_after_valid_signature(self):
        private, pub = make_keypair()
        assert _err(_envelope(private, b"not json"), pub) == (
            "Invalid license: payload is not valid JSON"
        )
        assert _err(_envelope(private, b"\xff\xfe"), pub) == (
            "Invalid license: payload is not valid JSON"
        )

    def test_payload_not_object(self):
        private, pub = make_keypair()
        assert _err(_envelope(private, b"[1]"), pub) == (
            "Invalid license: payload must be a JSON object"
        )

    @pytest.mark.parametrize("licensee", [None, "", "  \t", 5])
    def test_missing_licensee(self, licensee):
        private, pub = make_keypair()
        payload = dict(PAYLOAD, licensee=licensee)
        assert _err(make_license(private, payload), pub) == "Invalid license: missing licensee"

    @pytest.mark.parametrize("grace", [-1, "30", 1.5, True, False, None])
    def test_bad_grace_days(self, grace):
        private, pub = make_keypair()
        assert _err(make_license(private, dict(PAYLOAD, grace_days=grace)), pub) == (
            "Invalid license: grace_days must be a non-negative integer"
        )

    def test_bad_entitlements_container(self):
        private, pub = make_keypair()
        assert _err(make_license(private, dict(PAYLOAD, entitlements={})), pub) == (
            "Invalid license: entitlements must be a list"
        )

    def test_entitlement_errors_are_numbered_from_one(self):
        private, pub = make_keypair()
        good = {"extension_key": "ok"}
        text = make_license(private, dict(PAYLOAD, entitlements=["nope"]))
        assert _err(text, pub) == "Invalid license: entitlement #1 must be an object"
        text = make_license(private, dict(PAYLOAD, entitlements=[good, 7]))
        assert _err(text, pub) == "Invalid license: entitlement #2 must be an object"
        for bad in ({}, {"extension_key": " "}, {"extension_key": 3}):
            text = make_license(private, dict(PAYLOAD, entitlements=[good, bad]))
            assert _err(text, pub) == "Invalid license: entitlement #2 is missing extension_key"

    def test_entitlement_expires_at_errors_name_the_entitlement(self):
        private, pub = make_keypair()
        ents = [{"extension_key": "a"}, {"extension_key": "b", "expires_at": 5}]
        assert _err(make_license(private, dict(PAYLOAD, entitlements=ents)), pub) == (
            "Invalid license: entitlement #2 expires_at must be an ISO 8601 string"
        )
        ents = [{"extension_key": "a", "expires_at": "nope"}]
        assert _err(make_license(private, dict(PAYLOAD, entitlements=ents)), pub) == (
            "Invalid license: entitlement #1 expires_at is not a valid ISO 8601 date"
        )

    def test_issued_at_errors(self):
        private, pub = make_keypair()
        assert _err(make_license(private, dict(PAYLOAD, issued_at=1)), pub) == (
            "Invalid license: issued_at must be an ISO 8601 string"
        )
        assert _err(make_license(private, dict(PAYLOAD, issued_at="x")), pub) == (
            "Invalid license: issued_at is not a valid ISO 8601 date"
        )


class TestTolerantParsing:
    def _parse(self, payload, **env):
        private, pub = make_keypair()
        payload_bytes = json.dumps(payload).encode()
        return parse_and_verify(_envelope(private, payload_bytes, **env), public_key_b64=pub)

    def test_zero_grace_days_is_valid(self):
        assert self._parse(dict(PAYLOAD, grace_days=0)).grace_days == 0

    def test_empty_entitlements_and_defaults(self):
        payload = {"licensee": "L"}
        doc = self._parse(payload)
        assert doc.entitlements == []
        assert doc.grace_days == DEFAULT_GRACE_DAYS
        assert doc.customer_id == ""
        assert doc.issued_at is None
        assert doc.renewal_key == ""
        assert doc.instance_id == ""
        assert doc.key_id == ""

    def test_values_are_stripped_and_stringified(self):
        doc = self._parse(
            {
                "licensee": "  ACME  ",
                "customer_id": None,
                "renewal_key": "rk-1",
                "instance_id": "  TEA-AAAA-BBBB-CCCC \n",
                "entitlements": [{"extension_key": "  ext  "}],
            },
            key_id="vendor-9",
        )
        assert doc.licensee == "ACME"
        assert doc.customer_id == ""
        assert doc.renewal_key == "rk-1"
        assert doc.instance_id == "TEA-AAAA-BBBB-CCCC"
        assert doc.key_id == "vendor-9"
        assert doc.entitlements[0].extension_key == "ext"
        assert doc.entitlement_for("ext") is not None

    def test_null_key_id_becomes_empty(self):
        assert self._parse({"licensee": "L"}, key_id=None).key_id == ""

    def test_raw_text_is_the_exact_input(self):
        private, pub = make_keypair()
        text = _envelope(private, json.dumps({"licensee": "L"}).encode())
        assert parse_and_verify(text, public_key_b64=pub).raw_text == text

    def test_datetime_forms(self):
        ents = [
            {"extension_key": "z", "expires_at": "2027-01-01T00:00:00Z"},
            {"extension_key": "naive", "expires_at": "2027-01-01T00:00:00"},
            {"extension_key": "plus", "expires_at": "2027-01-01T02:00:00+02:00"},
            {"extension_key": "date", "expires_at": "2027-01-01"},
        ]
        doc = self._parse(
            {"licensee": "L", "entitlements": ents, "issued_at": "2026-01-01T00:00:00"}
        )
        utc = timezone.utc
        assert doc.issued_at == datetime(2026, 1, 1, tzinfo=utc)
        assert doc.issued_at.tzinfo is not None
        for key in ("z", "naive", "plus", "date"):
            got = doc.entitlement_for(key).expires_at
            assert got == datetime(2027, 1, 1, tzinfo=utc)
            assert got.tzinfo is not None
        # a real offset is preserved (not forced to UTC), only a missing one is added
        plus = doc.entitlement_for("plus").expires_at
        assert plus.utcoffset() == timedelta(hours=2)
        assert doc.entitlement_for("naive").expires_at.utcoffset() == timedelta(0)

    def test_extension_key_must_be_string_not_truthy(self):
        private, pub = make_keypair()
        for bad in (True, ["a"]):
            text = make_license(private, dict(PAYLOAD, entitlements=[{"extension_key": bad}]))
            assert _err(text, pub) == "Invalid license: entitlement #1 is missing extension_key"

    def test_auto_renew_and_trial_flags_are_independent(self):
        ents = [{"extension_key": "a", "auto_renew": True, "trial": False}]
        doc = self._parse({"licensee": "L", "entitlements": ents})
        ent = doc.entitlement_for("a")
        assert ent.auto_renew is True and ent.trial is False


class TestVerifierWiring:
    def test_key_id_and_artifact_are_forwarded(self, monkeypatch):
        private, pub = make_keypair()
        calls = []

        def spy(payload, signature_b64, key_id, trusted, *, artifact=None):
            calls.append((payload, signature_b64, key_id, trusted, artifact))
            return True

        monkeypatch.setattr(license_module, "verify_with_trusted", spy)
        payload_bytes = json.dumps({"licensee": "L"}).encode()
        text = _envelope(private, payload_bytes, key_id="vendor-2")
        parse_and_verify(text, public_key_b64=pub)
        assert calls == [
            (payload_bytes, json.loads(text)["signature"], "vendor-2", {"test": pub}, "license")
        ]

        calls.clear()
        parse_and_verify(_envelope(private, payload_bytes), public_key_b64=pub)
        assert calls[0][2] is None  # absent key_id -> try-all fallback

    def test_trusted_set_comes_from_baked_keys_when_not_pinned(self, monkeypatch):
        private, pub = make_keypair()
        monkeypatch.setattr(
            "app.core.extension_signing.DEFAULT_VENDOR_PUBLIC_KEYS", {"vendor-1": pub}
        )
        doc = parse_and_verify(make_license(private, PAYLOAD))
        assert doc.licensee == "ACME Corp"

    def test_signature_is_checked_before_payload_is_parsed(self):
        private, pub = make_keypair()
        other, _ = make_keypair()
        env = json.loads(_envelope(private, b"not json"))
        env["signature"] = base64.b64encode(other.sign(b"not json")).decode()
        # forged signature over garbage must fail on the signature, not the JSON
        assert _err(json.dumps(env), pub) == "Invalid license: signature verification failed"


class TestAdjustmentEdges:
    CAP = datetime(2026, 12, 1, tzinfo=timezone.utc)

    def _capped(self, monkeypatch, entitlements):
        private, pub = make_keypair()
        text = make_license(private, {"licensee": "L", "entitlements": entitlements})
        sig = base64.b64decode(json.loads(text)["signature"])
        monkeypatch.setitem(
            license_module._LICENSE_ADJUSTMENTS, hashlib.sha256(sig).hexdigest(), self.CAP
        )
        return parse_and_verify(text, public_key_b64=pub)

    def test_one_second_past_cap_is_capped_one_second_before_is_kept(self, monkeypatch):
        doc = self._capped(
            monkeypatch,
            [
                {"extension_key": "after", "expires_at": "2026-12-01T00:00:01Z"},
                {"extension_key": "before", "expires_at": "2026-11-30T23:59:59Z"},
            ],
        )
        assert doc.entitlement_for("after").expires_at == self.CAP
        assert doc.entitlement_for("before").expires_at == datetime(
            2026, 11, 30, 23, 59, 59, tzinfo=timezone.utc
        )

    def test_cap_preserves_other_entitlement_fields(self, monkeypatch):
        doc = self._capped(
            monkeypatch,
            [
                {
                    "extension_key": "k",
                    "expires_at": None,
                    "auto_renew": True,
                    "trial": True,
                }
            ],
        )
        ent = doc.entitlement_for("k")
        assert ent.expires_at == self.CAP
        assert ent.auto_renew is True and ent.trial is True
        assert ent.extension_key == "k"


class TestStateEdges:
    EXP = datetime(2027, 7, 1, tzinfo=timezone.utc)
    ENT = Entitlement(extension_key="x", expires_at=EXP)

    def test_one_second_after_expiry_is_grace(self):
        assert entitlement_state(self.ENT, 30, now=self.EXP + timedelta(seconds=1)) == "grace"

    def test_one_second_before_expiry_is_active(self):
        assert entitlement_state(self.ENT, 30, now=self.EXP - timedelta(seconds=1)) == "active"

    def test_exactly_deadline_is_grace_one_second_later_is_expired(self):
        end = self.EXP + timedelta(days=7)
        assert entitlement_state(self.ENT, 7, now=end) == "grace"
        assert entitlement_state(self.ENT, 7, now=end + timedelta(seconds=1)) == "expired"
        # grace_days is days, not seconds or hours
        assert entitlement_state(self.ENT, 7, now=self.EXP + timedelta(days=6, hours=23)) == "grace"

    def test_zero_grace_at_expiry_is_active_then_expired(self):
        assert entitlement_state(self.ENT, 0, now=self.EXP) == "active"

    def test_now_defaults_to_the_current_time(self):
        past = Entitlement("x", expires_at=datetime.now(timezone.utc) - timedelta(days=400))
        future = Entitlement("x", expires_at=datetime.now(timezone.utc) + timedelta(days=400))
        recent = Entitlement("x", expires_at=datetime.now(timezone.utc) - timedelta(days=2))
        assert entitlement_state(past, 30) == "expired"
        assert entitlement_state(future, 30) == "active"
        assert entitlement_state(recent, 30) == "grace"
        assert entitlement_state(Entitlement("x"), 0) == "active"

    def test_grace_until_scales_with_days(self):
        assert grace_until(self.ENT, 0) == self.EXP
        assert grace_until(self.ENT, 1) == self.EXP + timedelta(days=1)


class TestLicenseTextAtRest:
    """``raw_text`` is encrypted at rest because the envelope carries the renewal key."""

    def test_sealed_text_is_encrypted_and_hides_the_renewal_key(self):
        from app.core.encryption import is_encrypted

        private, _ = make_keypair()
        text = make_license(private, {**PAYLOAD, "renewal_key": "rk_secret_bearer"})
        sealed = license_module.seal_license_text(text)
        assert is_encrypted(sealed)
        assert "rk_secret_bearer" not in sealed
        # The payload is base64 inside the envelope; neither form may leak.
        assert base64.b64encode(json.dumps(PAYLOAD).encode()).decode()[:16] not in sealed

    def test_open_returns_the_envelope_byte_exact_and_it_still_verifies(self):
        private, public_b64 = make_keypair()
        text = make_license(private, {**PAYLOAD, "renewal_key": "rk_1"})
        opened = license_module.open_stored_license_text(license_module.seal_license_text(text))
        assert opened == text
        assert parse_and_verify(opened, public_key_b64=public_b64).renewal_key == "rk_1"

    def test_legacy_plaintext_row_passes_through(self):
        private, public_b64 = make_keypair()
        text = make_license(private, PAYLOAD)
        assert license_module.open_stored_license_text(text) == text
        assert parse_and_verify(
            license_module.open_stored_license_text(text), public_key_b64=public_b64
        ).licensee == ("ACME Corp")

    def test_rotated_secret_key_raises_the_dedicated_problem(self, monkeypatch):
        from app.config import settings

        private, _ = make_keypair()
        sealed = license_module.seal_license_text(make_license(private, PAYLOAD))
        monkeypatch.setattr(settings, "SECRET_KEY", settings.SECRET_KEY + "-rotated")
        with pytest.raises(license_module.LicenseUndecryptableError) as excinfo:
            license_module.open_stored_license_text(sealed)
        # A LicenseError, so every reader's existing soft-disable path catches it.
        assert isinstance(excinfo.value, LicenseError)
        assert str(excinfo.value) == license_module.LICENSE_UNDECRYPTABLE_MESSAGE
        assert "SECRET_KEY changed" in str(excinfo.value)
        assert "Re-paste the license file" in str(excinfo.value)

    def test_empty_value_is_not_an_undecryptable_license(self):
        # Empty is "nothing stored", which parse_and_verify reports as invalid
        # JSON — not a SECRET_KEY problem.
        assert license_module.open_stored_license_text("") == ""
        with pytest.raises(LicenseError) as excinfo:
            parse_and_verify(license_module.open_stored_license_text(""))
        assert not isinstance(excinfo.value, license_module.LicenseUndecryptableError)

    def test_corrupted_ciphertext_raises_the_dedicated_problem(self):
        with pytest.raises(license_module.LicenseUndecryptableError):
            license_module.open_stored_license_text("enc:not-a-fernet-token")
