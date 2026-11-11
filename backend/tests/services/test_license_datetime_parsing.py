"""``_parse_datetime`` of the extension license, pinned: what it accepts, the UTC it assumes and
the exact error text, label included."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest

from app.services.extensions.license import LicenseError, _parse_datetime


def test_none_is_none():
    assert _parse_datetime(None, "issued_at") is None


@pytest.mark.parametrize("value", [5, 1.5, True, ["2026-01-01"], {"d": 1}, b"2026-01-01", 0])
def test_a_non_string_is_refused_with_the_label(value):
    with pytest.raises(LicenseError) as exc:
        _parse_datetime(value, "issued_at")
    assert str(exc.value) == "Invalid license: issued_at must be an ISO 8601 string"


@pytest.mark.parametrize("value", ["", "not a date", "2026-13-45", "yesterday"])
def test_an_unparseable_string_is_refused_with_the_label(value):
    with pytest.raises(LicenseError) as exc:
        _parse_datetime(value, "entitlement #2 expires_at")
    assert str(exc.value) == (
        "Invalid license: entitlement #2 expires_at is not a valid ISO 8601 date"
    )


def test_z_suffix_means_utc():
    got = _parse_datetime("2026-03-09T10:30:00Z", "x")
    assert got == datetime(2026, 3, 9, 10, 30, tzinfo=timezone.utc)
    assert got.utcoffset() == timedelta(0)


def test_a_naive_value_is_taken_as_utc():
    got = _parse_datetime("2026-03-09T10:30:00", "x")
    assert got == datetime(2026, 3, 9, 10, 30, tzinfo=timezone.utc)
    assert got.tzinfo is not None


def test_a_bare_date_is_midnight_utc():
    assert _parse_datetime("2026-03-09", "x") == datetime(2026, 3, 9, tzinfo=timezone.utc)


def test_an_explicit_offset_is_kept_not_replaced():
    got = _parse_datetime("2026-03-09T10:30:00+02:00", "x")
    assert got.utcoffset() == timedelta(hours=2)
    assert got == datetime(2026, 3, 9, 8, 30, tzinfo=timezone.utc)
    assert _parse_datetime("2026-03-09T10:30:00-05:00", "x").utcoffset() == timedelta(hours=-5)
