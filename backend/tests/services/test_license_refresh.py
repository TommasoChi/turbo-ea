"""Unit tests for the automatic license-renewal decision logic (no DB).

The network + persistence path is exercised via the API/loop integration;
these cover the pure rules: when a refresh is due, and when a fetched
license actually counts as an extension of the current one.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

from app.services.extensions.license import Entitlement, LicenseDocument
from app.services.extensions.license_refresh import (
    REFRESH_WINDOW_DAYS,
    _extends,
    _should_apply,
    should_refresh,
)

NOW = datetime(2026, 7, 8, 12, 0, tzinfo=timezone.utc)


def make_doc(
    *,
    renewal_key: str = "rk_abc",
    customer_id: str = "cus_1",
    expires_in_days: float | None = 5,
    keys: tuple[str, ...] = ("esg-pack",),
    auto_renew: bool | None = None,
    trial: bool | None = None,
    licensee: str = "ACME Corp",
    grace_days: int = 30,
) -> LicenseDocument:
    expires = NOW + timedelta(days=expires_in_days) if expires_in_days is not None else None
    return LicenseDocument(
        licensee=licensee,
        customer_id=customer_id,
        issued_at=NOW - timedelta(days=30),
        grace_days=grace_days,
        entitlements=[
            Entitlement(extension_key=k, expires_at=expires, auto_renew=auto_renew, trial=trial)
            for k in keys
        ],
        renewal_key=renewal_key,
    )


class TestShouldRefresh:
    def test_due_inside_window(self):
        assert should_refresh(make_doc(expires_in_days=5), now=NOW) is True

    def test_already_expired_still_tries(self):
        """Expired-but-in-grace licenses keep retrying (payment may have resumed)."""
        assert should_refresh(make_doc(expires_in_days=-3), now=NOW) is True

    def test_not_due_outside_window(self):
        assert should_refresh(make_doc(expires_in_days=REFRESH_WINDOW_DAYS + 1), now=NOW) is False

    def test_manually_issued_license_never_refreshes(self):
        assert should_refresh(make_doc(renewal_key=""), now=NOW) is False

    def test_missing_customer_id_never_refreshes(self):
        assert should_refresh(make_doc(customer_id=""), now=NOW) is False

    def test_perpetual_license_never_refreshes(self):
        assert should_refresh(make_doc(expires_in_days=None), now=NOW) is False


class TestExtends:
    def test_later_expiry_extends(self):
        assert _extends(make_doc(expires_in_days=35), make_doc(expires_in_days=5)) is True

    def test_same_or_earlier_expiry_does_not(self):
        assert _extends(make_doc(expires_in_days=5), make_doc(expires_in_days=5)) is False
        assert _extends(make_doc(expires_in_days=2), make_doc(expires_in_days=5)) is False

    def test_cancelled_subscription_never_shrinks_the_license(self):
        """A reissued license with the entitlement gone must not be applied."""
        cancelled = make_doc(keys=(), expires_in_days=None)
        assert _extends(cancelled, make_doc(expires_in_days=5)) is False

    def test_new_extension_counts_as_extension(self):
        wider = make_doc(keys=("esg-pack", "other-pack"), expires_in_days=5)
        assert _extends(wider, make_doc(expires_in_days=5)) is True


class TestShouldApply:
    """_should_apply = _extends OR (identical coverage + renewal metadata change).

    The metadata arm is what lets a billing-portal cancellation reach a
    connected instance: the store re-issues the same coverage with
    auto_renew flipped, which the old must-extend rule rejected forever.
    """

    def test_extension_still_applies(self):
        assert _should_apply(make_doc(expires_in_days=35), make_doc(expires_in_days=5)) is True

    def test_identical_license_is_not_applied(self):
        assert (
            _should_apply(
                make_doc(expires_in_days=5, auto_renew=True),
                make_doc(expires_in_days=5, auto_renew=True),
            )
            is False
        )

    def test_auto_renew_flip_applies_at_identical_coverage(self):
        # Cancellation (true → false) and reactivation (false → true) both land.
        assert (
            _should_apply(
                make_doc(expires_in_days=5, auto_renew=False),
                make_doc(expires_in_days=5, auto_renew=True),
            )
            is True
        )
        assert (
            _should_apply(
                make_doc(expires_in_days=5, auto_renew=True),
                make_doc(expires_in_days=5, auto_renew=False),
            )
            is True
        )

    def test_flag_appearing_on_a_pre_field_license_applies(self):
        # Old license has auto_renew=None (pre-field); the store now stamps it.
        assert (
            _should_apply(
                make_doc(expires_in_days=5, auto_renew=True),
                make_doc(expires_in_days=5, auto_renew=None),
            )
            is True
        )

    def test_trial_flip_applies_at_identical_coverage(self):
        # Mid-trial conversion: the store re-issues the same coverage with the
        # trial flag cleared — connected instances must pick that up, or they
        # keep showing "Trial" (and enforcing zero grace) on a paid customer.
        # Only the trial flag differs — auto_renew held constant so this
        # asserts the trial comparison specifically.
        assert (
            _should_apply(
                make_doc(expires_in_days=5, trial=None),
                make_doc(expires_in_days=5, trial=True),
            )
            is True
        )
        assert (
            _should_apply(
                make_doc(expires_in_days=5, trial=True),
                make_doc(expires_in_days=5, trial=True),
            )
            is False
        )

    def test_metadata_change_cannot_shrink_coverage(self):
        # Flag flipped AND a key dropped: not same coverage, not an extension
        # → refused. A metadata refresh can never lose an entitlement.
        narrower = make_doc(keys=("esg-pack",), expires_in_days=5, auto_renew=False)
        current = make_doc(keys=("esg-pack", "other-pack"), expires_in_days=5, auto_renew=True)
        assert _should_apply(narrower, current) is False

    def test_metadata_change_cannot_shorten_expiry(self):
        shorter = make_doc(expires_in_days=2, auto_renew=False)
        assert _should_apply(shorter, make_doc(expires_in_days=5, auto_renew=True)) is False

    def test_licensee_or_grace_change_applies_at_identical_coverage(self):
        assert (
            _should_apply(
                make_doc(expires_in_days=5, licensee="ACME GmbH"),
                make_doc(expires_in_days=5),
            )
            is True
        )
        assert (
            _should_apply(
                make_doc(expires_in_days=5, grace_days=45),
                make_doc(expires_in_days=5),
            )
            is True
        )


# ---------------------------------------------------------------------------
# Exact-contract tests for the pure helpers and for the persistence + network
# path (``persist_license`` / ``refresh_license_if_due``). The network and the
# signature check are replaced by fakes; the database is real.
# ---------------------------------------------------------------------------
import logging  # noqa: E402

import httpx  # noqa: E402
import pytest  # noqa: E402
from sqlalchemy import select  # noqa: E402

from app.config import settings  # noqa: E402
from app.models.extension import ExtensionLicense  # noqa: E402
from app.services.extensions import license_refresh as lr  # noqa: E402
from app.services.extensions.instance_id import set_instance_id  # noqa: E402
from app.services.extensions.license import LicenseError  # noqa: E402
from app.services.extensions.license_refresh import (  # noqa: E402
    _earliest_expiry,
    _renewal_metadata_changed,
    _same_coverage,
    persist_license,
    refresh_license_if_due,
)

LOGGER = "app.services.extensions.license_refresh"
OURS = "TEA-0000-0000-0000"


def _dt(days: float) -> datetime:
    return NOW + timedelta(days=days)


def _doc(*ents: Entitlement, **kw) -> LicenseDocument:
    base = dict(
        licensee="ACME Corp",
        customer_id="cus_1",
        issued_at=NOW,
        grace_days=30,
        renewal_key="rk",
        raw_text="raw-current",
    )
    base.update(kw)
    return LicenseDocument(entitlements=list(ents), **base)


class TestConstants:
    def test_window_and_timeout(self):
        assert REFRESH_WINDOW_DAYS == 14
        assert lr._RENEW_TIMEOUT == 10.0


class TestEarliestExpiry:
    def test_min_of_non_null_expiries(self):
        doc = _doc(
            Entitlement("a", _dt(30)),
            Entitlement("b", _dt(10)),
            Entitlement("c", None),
            Entitlement("d", _dt(20)),
        )
        assert _earliest_expiry(doc) == _dt(10)

    def test_none_when_all_perpetual_or_empty(self):
        assert _earliest_expiry(_doc(Entitlement("a", None))) is None
        assert _earliest_expiry(_doc()) is None


class TestExtendsEdges:
    def test_later_expiry_is_asymmetric(self):
        later = _doc(Entitlement("a", _dt(30)))
        sooner = _doc(Entitlement("a", _dt(10)))
        assert _extends(later, sooner) is True
        assert _extends(sooner, later) is False

    def test_uses_earliest_expiry_of_each_side(self):
        new = _doc(Entitlement("a", _dt(50)), Entitlement("b", _dt(20)))
        cur = _doc(Entitlement("a", _dt(30)), Entitlement("b", _dt(10)))
        assert _extends(new, cur) is True
        # earliest equal even though another expiry is later: not an extension
        new2 = _doc(Entitlement("a", _dt(50)), Entitlement("b", _dt(10)))
        assert _extends(new2, cur) is False

    def test_perpetual_on_either_side_is_not_an_expiry_extension(self):
        assert _extends(_doc(Entitlement("a", None)), _doc(Entitlement("a", _dt(5)))) is False
        assert _extends(_doc(Entitlement("a", _dt(50))), _doc(Entitlement("a", None))) is False

    def test_only_new_keys_count_and_dropped_keys_do_not(self):
        cur = _doc(Entitlement("a", _dt(5)), Entitlement("b", _dt(5)))
        assert _extends(_doc(Entitlement("a", _dt(5))), cur) is False
        assert _extends(_doc(Entitlement("a", _dt(5)), Entitlement("c", _dt(5))), cur) is True
        # a new key plus one dropped is still a "new entitlement"
        assert _extends(_doc(Entitlement("a", _dt(5)), Entitlement("c", _dt(5))), cur) is True


class TestSameCoverage:
    def test_identical(self):
        a = _doc(Entitlement("a", _dt(5)), Entitlement("b", None))
        b = _doc(Entitlement("b", None), Entitlement("a", _dt(5)))
        assert _same_coverage(a, b) is True

    def test_different_expiry_key_or_size(self):
        base = _doc(Entitlement("a", _dt(5)))
        assert _same_coverage(_doc(Entitlement("a", _dt(6))), base) is False
        assert _same_coverage(_doc(Entitlement("b", _dt(5))), base) is False
        assert _same_coverage(_doc(Entitlement("a", _dt(5)), Entitlement("b", None)), base) is False
        assert _same_coverage(_doc(), base) is False


class TestRenewalMetadataChanged:
    def test_no_change(self):
        a = _doc(Entitlement("a", _dt(5), auto_renew=True, trial=False))
        assert _renewal_metadata_changed(a, a) is False

    def test_licensee_and_grace_each_trigger(self):
        base = _doc(Entitlement("a", _dt(5)))
        assert _renewal_metadata_changed(_doc(Entitlement("a", _dt(5)), licensee="Z"), base)
        assert _renewal_metadata_changed(_doc(Entitlement("a", _dt(5)), grace_days=31), base)

    def test_each_flag_triggers_independently(self):
        base = _doc(Entitlement("a", _dt(5), auto_renew=True, trial=True))
        assert _renewal_metadata_changed(
            _doc(Entitlement("a", _dt(5), auto_renew=False, trial=True)), base
        )
        assert _renewal_metadata_changed(
            _doc(Entitlement("a", _dt(5), auto_renew=True, trial=False)), base
        )

    def test_flag_change_on_a_key_the_current_license_lacks_is_ignored(self):
        base = _doc(Entitlement("a", _dt(5), auto_renew=True))
        new = _doc(Entitlement("a", _dt(5), auto_renew=True), Entitlement("b", _dt(5)))
        assert _renewal_metadata_changed(new, base) is False

    def test_any_changed_key_triggers(self):
        base = _doc(Entitlement("a", _dt(5), auto_renew=True), Entitlement("b", _dt(5)))
        new = _doc(Entitlement("a", _dt(5), auto_renew=True), Entitlement("b", _dt(5), trial=True))
        assert _renewal_metadata_changed(new, base) is True


class TestShouldRefreshBoundary:
    def test_exactly_at_window_edge_is_due_one_second_later_is_not(self):
        edge = NOW + timedelta(days=REFRESH_WINDOW_DAYS)
        due = _doc(Entitlement("a", edge))
        later = _doc(Entitlement("a", edge + timedelta(seconds=1)))
        assert should_refresh(due, now=NOW) is True
        assert should_refresh(later, now=NOW) is False

    def test_uses_the_earliest_entitlement(self):
        doc = _doc(Entitlement("a", _dt(90)), Entitlement("b", _dt(3)))
        assert should_refresh(doc, now=NOW) is True

    def test_now_defaults_to_the_clock(self):
        current = datetime.now(timezone.utc)
        assert should_refresh(_doc(Entitlement("a", current + timedelta(days=5)))) is True
        assert should_refresh(_doc(Entitlement("a", current + timedelta(days=40)))) is False

    def test_both_credentials_are_required(self):
        e = Entitlement("a", _dt(1))
        assert should_refresh(_doc(e, renewal_key="", customer_id=""), now=NOW) is False
        assert should_refresh(_doc(e, renewal_key="k", customer_id=""), now=NOW) is False
        assert should_refresh(_doc(e, renewal_key="", customer_id="c"), now=NOW) is False


class TestShouldApplyEdges:
    def test_same_coverage_without_metadata_change_is_refused(self):
        a = _doc(Entitlement("a", _dt(5)))
        assert _should_apply(a, _doc(Entitlement("a", _dt(5)))) is False

    def test_metadata_change_with_different_coverage_is_refused(self):
        new = _doc(Entitlement("a", _dt(5)), licensee="Z")
        cur = _doc(Entitlement("a", _dt(9)))
        assert _should_apply(new, cur) is False


# ── persistence + network path ─────────────────────────────────────────────


class _FakeResponse:
    def __init__(self, payload=None, status=200, json_error=None):
        self._payload = payload
        self.status_code = status
        self._json_error = json_error

    def raise_for_status(self):
        if self.status_code >= 400:
            request = httpx.Request("POST", "https://store.test/account/renew")
            raise httpx.HTTPStatusError(
                "boom", request=request, response=httpx.Response(self.status_code, request=request)
            )

    def json(self):
        if self._json_error:
            raise self._json_error
        return self._payload


class _FakeStore:
    """Replaces ``store_client``; records the call and answers ``response``."""

    def __init__(self, response=None, post_error=None):
        self.response = response
        self.post_error = post_error
        self.timeouts: list = []
        self.posts: list = []

    def __call__(self, timeout):
        self.timeouts.append(timeout)
        return self

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False

    async def post(self, url, json=None):
        self.posts.append((url, json))
        if self.post_error:
            raise self.post_error
        return self.response


@pytest.fixture
def renew_env(monkeypatch):
    """Store URL set, development binding rules, no instance id, text->doc table."""
    monkeypatch.setattr(settings, "EXTENSION_STORE_URL", "https://store.test")
    monkeypatch.setattr(settings, "ENVIRONMENT", "development")
    set_instance_id(None)
    docs: dict[str, LicenseDocument] = {}

    def fake_parse(text, **kw):
        if text not in docs:
            raise LicenseError("bad license text")
        return docs[text]

    monkeypatch.setattr(lr, "parse_and_verify", fake_parse)

    async def noop_refresh(db):
        return None

    monkeypatch.setattr(lr.extension_registry, "refresh_from_db", noop_refresh)
    yield docs
    set_instance_id(None)


async def _row(db, text="raw-current", *, active=True, created_at=None) -> ExtensionLicense:
    row = ExtensionLicense(
        raw_text=text, licensee="ACME Corp", customer_id="cus_1", grace_days=30, is_active=active
    )
    if created_at is not None:
        row.created_at = created_at
    db.add(row)
    await db.flush()
    return row


def _due_current(**kw) -> LicenseDocument:
    return _doc(Entitlement("pack", datetime.now(timezone.utc) + timedelta(days=3)), **kw)


def _fresh_for(current: LicenseDocument, **kw) -> LicenseDocument:
    ent = Entitlement("pack", datetime.now(timezone.utc) + timedelta(days=370))
    base = dict(raw_text="raw-fresh", customer_id=current.customer_id)
    base.update(kw)
    return _doc(ent, **base)


class TestPersistLicense:
    async def test_supersedes_active_rows_and_stores_every_field(self, db, renew_env):
        old1 = await _row(db, "old-1")
        old2 = await _row(db, "old-2")
        inactive = await _row(db, "old-3", active=False)
        doc = _doc(
            Entitlement("a", datetime(2027, 1, 2, 3, 4, 5, tzinfo=timezone.utc), True, False),
            Entitlement("b", None, None, True),
            key_id="vendor-1",
            raw_text="the-raw-text",
        )
        row = await persist_license(db, doc, created_by=None)

        assert row.is_active is True
        assert row.raw_text == "the-raw-text"
        assert row.key_id == "vendor-1"
        assert row.licensee == "ACME Corp"
        assert row.customer_id == "cus_1"
        assert row.issued_at == NOW
        assert row.grace_days == 30
        assert row.created_by is None
        assert row.entitlements == [
            {
                "extension_key": "a",
                "expires_at": "2027-01-02T03:04:05+00:00",
                "auto_renew": True,
                "trial": False,
            },
            {"extension_key": "b", "expires_at": None, "auto_renew": None, "trial": True},
        ]
        await db.refresh(old1)
        await db.refresh(old2)
        await db.refresh(inactive)
        assert old1.is_active is False and old2.is_active is False
        assert inactive.is_active is False
        actives = (
            (await db.execute(select(ExtensionLicense).where(ExtensionLicense.is_active)))
            .scalars()
            .all()
        )
        assert [r.id for r in actives] == [row.id]

    async def test_blank_key_id_and_customer_become_null_and_user_is_recorded(self, db, renew_env):
        doc = _doc(customer_id="", key_id="", raw_text="x")
        user_id = None
        from tests.conftest import create_role, create_user

        await create_role(db, key="admin")
        user = await create_user(db, role="admin")
        user_id = user.id
        row = await persist_license(db, doc, created_by=user_id)
        assert row.key_id is None
        assert row.customer_id is None
        assert row.created_by == user_id
        assert row.entitlements == []

    async def test_refreshes_the_registry_after_commit(self, db, renew_env, monkeypatch):
        seen = []

        async def spy(session):
            seen.append(session)

        monkeypatch.setattr(lr.extension_registry, "refresh_from_db", spy)
        await persist_license(db, _doc(raw_text="r"), created_by=None)
        assert seen == [db]


class TestRefreshGuards:
    async def test_blank_store_url_does_nothing(self, db, renew_env, monkeypatch):
        current = _due_current()
        renew_env["raw-current"] = current
        await _row(db)
        store = _FakeStore(_FakeResponse({"license": "raw-fresh"}))
        monkeypatch.setattr(lr, "store_client", store)
        for blank in ("", "   "):
            monkeypatch.setattr(settings, "EXTENSION_STORE_URL", blank)
            assert await refresh_license_if_due(db) is False
        assert store.posts == []

    async def test_no_active_row(self, db, renew_env, monkeypatch):
        store = _FakeStore(_FakeResponse({"license": "x"}))
        monkeypatch.setattr(lr, "store_client", store)
        await _row(db, active=False)
        assert await refresh_license_if_due(db) is False
        assert store.posts == []

    async def test_unverifiable_active_license_is_skipped_with_a_warning(
        self, db, renew_env, monkeypatch, caplog
    ):
        store = _FakeStore(_FakeResponse({"license": "x"}))
        monkeypatch.setattr(lr, "store_client", store)
        await _row(db, "unknown-text")
        with caplog.at_level(logging.DEBUG, logger=LOGGER):
            assert await refresh_license_if_due(db) is False
        assert store.posts == []
        assert any(
            r.levelno == logging.WARNING
            and r.getMessage() == "Active license no longer verifies — skipping auto-renewal"
            for r in caplog.records
        )

    async def test_license_bound_to_another_instance_is_skipped(
        self, db, renew_env, monkeypatch, caplog
    ):
        set_instance_id(OURS)
        renew_env["raw-current"] = _due_current(instance_id="TEA-1111-1111-1111")
        store = _FakeStore(_FakeResponse({"license": "x"}))
        monkeypatch.setattr(lr, "store_client", store)
        await _row(db)
        with caplog.at_level(logging.DEBUG, logger=LOGGER):
            assert await refresh_license_if_due(db) is False
        assert store.posts == []
        assert any(
            r.levelno == logging.WARNING
            and r.getMessage()
            == "Active license is bound to another instance — skipping auto-renewal"
            for r in caplog.records
        )

    async def test_newest_active_row_is_the_one_renewed(self, db, renew_env, monkeypatch):
        renew_env["raw-old"] = _doc(Entitlement("pack", NOW), renewal_key="", raw_text="raw-old")
        renew_env["raw-new"] = _due_current(raw_text="raw-new")
        await _row(db, "raw-old", created_at=NOW - timedelta(days=2))
        await _row(db, "raw-new", created_at=NOW - timedelta(days=1))
        store = _FakeStore(_FakeResponse({"license": "nothing"}))
        monkeypatch.setattr(lr, "store_client", store)
        await refresh_license_if_due(db)
        assert len(store.posts) == 1  # the newer, renewable row drove the attempt

    async def test_not_due_license_is_not_renewed_unless_forced(self, db, renew_env, monkeypatch):
        far = _doc(Entitlement("pack", datetime.now(timezone.utc) + timedelta(days=200)))
        renew_env["raw-current"] = far
        await _row(db)
        store = _FakeStore(_FakeResponse({"license": "unknown"}))
        monkeypatch.setattr(lr, "store_client", store)
        assert await refresh_license_if_due(db) is False
        assert store.posts == []
        assert await refresh_license_if_due(db, force=True) is False
        assert len(store.posts) == 1  # force skipped the expiry gate

    async def test_now_argument_drives_the_due_check(self, db, renew_env, monkeypatch):
        renew_env["raw-current"] = _doc(Entitlement("pack", _dt(100)))
        await _row(db)
        store = _FakeStore(_FakeResponse({"license": "unknown"}))
        monkeypatch.setattr(lr, "store_client", store)
        await refresh_license_if_due(db, now=NOW)
        assert store.posts == []
        await refresh_license_if_due(db, now=_dt(95))
        assert len(store.posts) == 1

    @pytest.mark.parametrize("missing", ["renewal_key", "customer_id"])
    async def test_force_still_needs_both_credentials(self, db, renew_env, monkeypatch, missing):
        renew_env["raw-current"] = _due_current(**{missing: ""})
        await _row(db)
        store = _FakeStore(_FakeResponse({"license": "unknown"}))
        monkeypatch.setattr(lr, "store_client", store)
        assert await refresh_license_if_due(db, force=True) is False
        assert store.posts == []


class TestRefreshRequest:
    async def test_url_body_and_timeout(self, db, renew_env, monkeypatch):
        renew_env["raw-current"] = _due_current(renewal_key="secret-rk", customer_id="cus_9")
        store = _FakeStore(_FakeResponse({"license": "unknown"}))
        monkeypatch.setattr(lr, "store_client", store)
        monkeypatch.setattr(settings, "EXTENSION_STORE_URL", "  https://store.test///  ")
        await _row(db)
        await refresh_license_if_due(db)
        assert store.timeouts == [10.0]
        assert store.posts == [
            ("https://store.test/account/renew", {"customer": "cus_9", "key": "secret-rk"})
        ]

    async def test_instance_id_is_added_when_known(self, db, renew_env, monkeypatch):
        set_instance_id(OURS)
        renew_env["raw-current"] = _due_current(instance_id=OURS)
        store = _FakeStore(_FakeResponse({"license": "unknown"}))
        monkeypatch.setattr(lr, "store_client", store)
        await _row(db)
        await refresh_license_if_due(db)
        assert store.posts[0][1] == {"customer": "cus_1", "key": "rk", "instance": OURS}

    @pytest.mark.parametrize(
        "error",
        [httpx.ConnectError("down"), httpx.ReadTimeout("slow")],
    )
    async def test_transport_failure_is_quiet(self, db, renew_env, monkeypatch, caplog, error):
        renew_env["raw-current"] = _due_current()
        monkeypatch.setattr(lr, "store_client", _FakeStore(post_error=error))
        await _row(db)
        with caplog.at_level(logging.DEBUG, logger=LOGGER):
            assert await refresh_license_if_due(db) is False
        records = [r for r in caplog.records if r.name == LOGGER]
        assert [r.levelno for r in records] == [logging.DEBUG]
        assert (
            records[0].getMessage().startswith("License auto-renewal skipped (store unreachable)")
        )

    async def test_refusal_by_the_store_warns_with_the_status(
        self, db, renew_env, monkeypatch, caplog
    ):
        renew_env["raw-current"] = _due_current()
        monkeypatch.setattr(lr, "store_client", _FakeStore(_FakeResponse(status=403)))
        await _row(db)
        with caplog.at_level(logging.DEBUG, logger=LOGGER):
            assert await refresh_license_if_due(db) is False
        records = [r for r in caplog.records if r.name == LOGGER]
        assert [r.levelno for r in records] == [logging.WARNING]
        assert records[0].getMessage() == (
            "License auto-renewal refused by the store (HTTP 403) — "
            "entitlements will lapse when the grace period ends"
        )

    @pytest.mark.parametrize("error", [ValueError("not json"), TypeError("odd")])
    async def test_garbage_body_is_quiet_and_false(self, db, renew_env, monkeypatch, caplog, error):
        renew_env["raw-current"] = _due_current()
        monkeypatch.setattr(lr, "store_client", _FakeStore(_FakeResponse(json_error=error)))
        await _row(db)
        with caplog.at_level(logging.DEBUG, logger=LOGGER):
            assert await refresh_license_if_due(db) is False
        records = [r for r in caplog.records if r.name == LOGGER]
        assert [r.levelno for r in records] == [logging.DEBUG]

    @pytest.mark.parametrize("payload", [["not", "a", "dict"], {}, {"license": ""}, None])
    async def test_non_dict_or_empty_license_field_is_rejected(
        self, db, renew_env, monkeypatch, caplog, payload
    ):
        renew_env["raw-current"] = _due_current()
        monkeypatch.setattr(lr, "store_client", _FakeStore(_FakeResponse(payload)))
        await _row(db)
        with caplog.at_level(logging.DEBUG, logger=LOGGER):
            assert await refresh_license_if_due(db) is False
        assert any(
            r.levelno == logging.WARNING
            and r.getMessage() == "Store returned a license that does not verify: bad license text"
            for r in caplog.records
        )


class TestRefreshOutcome:
    async def _run(self, db, renew_env, monkeypatch, fresh):
        current = _due_current()
        renew_env["raw-current"] = current
        renew_env["raw-fresh"] = fresh(current) if callable(fresh) else fresh
        monkeypatch.setattr(lr, "store_client", _FakeStore(_FakeResponse({"license": "raw-fresh"})))
        await _row(db)
        return await refresh_license_if_due(db)

    async def _active_texts(self, db):
        rows = (
            (await db.execute(select(ExtensionLicense).where(ExtensionLicense.is_active)))
            .scalars()
            .all()
        )
        return [r.raw_text for r in rows]

    async def test_extension_is_applied_and_persisted(self, db, renew_env, monkeypatch, caplog):
        with caplog.at_level(logging.INFO, logger=LOGGER):
            assert await self._run(db, renew_env, monkeypatch, _fresh_for) is True
        assert await self._active_texts(db) == ["raw-fresh"]
        row = (
            await db.execute(select(ExtensionLicense).where(ExtensionLicense.is_active))
        ).scalar_one()
        assert row.created_by is None
        info = [r for r in caplog.records if r.levelno == logging.INFO and r.name == LOGGER]
        assert len(info) == 1
        assert "licensee=ACME Corp" in info[0].getMessage()
        assert info[0].getMessage().startswith("License auto-renewed from the extension store")

    async def test_fresh_license_bound_to_another_instance_is_not_applied(
        self, db, renew_env, monkeypatch, caplog
    ):
        set_instance_id(OURS)
        renew_env["raw-current"] = _due_current(instance_id=OURS)
        renew_env["raw-fresh"] = _fresh_for(
            renew_env["raw-current"], instance_id="TEA-9999-9999-9999"
        )
        monkeypatch.setattr(lr, "store_client", _FakeStore(_FakeResponse({"license": "raw-fresh"})))
        await _row(db)
        with caplog.at_level(logging.DEBUG, logger=LOGGER):
            assert await refresh_license_if_due(db) is False
        assert await self._active_texts(db) == ["raw-current"]
        assert any(
            r.levelno == logging.WARNING
            and r.getMessage() == "Store returned a license bound to another instance — not applied"
            for r in caplog.records
        )

    async def test_other_customer_is_never_applied(self, db, renew_env, monkeypatch):
        assert (
            await self._run(
                db, renew_env, monkeypatch, lambda c: _fresh_for(c, customer_id="cus_other")
            )
            is False
        )
        assert await self._active_texts(db) == ["raw-current"]

    async def test_non_improving_license_is_not_applied(self, db, renew_env, monkeypatch):
        def same(current):
            return _doc(*current.entitlements, raw_text="raw-fresh")

        assert await self._run(db, renew_env, monkeypatch, same) is False
        assert await self._active_texts(db) == ["raw-current"]

    async def test_metadata_only_refresh_is_applied(self, db, renew_env, monkeypatch):
        def flipped(current):
            ent = current.entitlements[0]
            return _doc(
                Entitlement(ent.extension_key, ent.expires_at, auto_renew=False),
                raw_text="raw-fresh",
            )

        assert await self._run(db, renew_env, monkeypatch, flipped) is True
        assert await self._active_texts(db) == ["raw-fresh"]
