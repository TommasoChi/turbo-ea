"""``app.main._cost_rollover_loop``: sleeps to the next 00:05 UTC, then refreshes the totals."""

from __future__ import annotations

import asyncio
import datetime as real_datetime
import logging
from contextlib import contextmanager

import pytest

import app.database
import app.main as main
from app.services import card_costs, derived_writes

UTC = real_datetime.timezone.utc


class _Harness:
    def __init__(self, monkeypatch, now, fail_first=False, sleeps_before_stop=2):
        self.sleeps: list[float] = []
        self.events: list[str] = []
        self.dbs: list[object] = []
        self.fail_first = fail_first
        self.limit = sleeps_before_stop
        harness = self

        class FakeDatetime(real_datetime.datetime):
            @classmethod
            def now(cls, tz=None):
                assert tz is UTC
                return now

        class FakeSession:
            async def __aenter__(self):
                harness.events.append("open")
                return self

            async def __aexit__(self, *exc):
                harness.events.append("close")

            async def commit(self):
                harness.events.append("commit")

        @contextmanager
        def maintenance(db):
            assert db is harness.dbs[-1]
            harness.events.append("maintenance-in")
            yield
            harness.events.append("maintenance-out")

        async def recompute_all(db):
            assert db is harness.dbs[-1]
            harness.events.append("recompute")
            if harness.fail_first:
                harness.fail_first = False
                raise RuntimeError("boom")
            return 7

        def factory():
            session = FakeSession()
            harness.dbs.append(session)
            return session

        async def sleep(seconds):
            harness.sleeps.append(seconds)
            if len(harness.sleeps) >= harness.limit:
                raise asyncio.CancelledError

        monkeypatch.setattr(real_datetime, "datetime", FakeDatetime)
        monkeypatch.setattr(app.database, "async_session", factory)
        monkeypatch.setattr(derived_writes, "derived_maintenance", maintenance)
        monkeypatch.setattr(card_costs, "recompute_all", recompute_all)
        monkeypatch.setattr(main.asyncio, "sleep", sleep)

    async def run(self):
        with pytest.raises(asyncio.CancelledError):
            await main._cost_rollover_loop()


@pytest.mark.parametrize(
    ("now", "expected"),
    [
        (real_datetime.datetime(2026, 3, 10, 0, 3, 0, tzinfo=UTC), 120.0),
        (real_datetime.datetime(2026, 3, 10, 0, 0, 0, tzinfo=UTC), 300.0),
        (
            real_datetime.datetime(2026, 3, 10, 0, 5, 0, tzinfo=UTC),
            86400.0,
        ),  # exactly due: next day
        (real_datetime.datetime(2026, 3, 10, 0, 5, 0, 500000, tzinfo=UTC), 86399.5),
        (real_datetime.datetime(2026, 3, 10, 10, 30, 15, 250000, tzinfo=UTC), 48884.75),
    ],
)
async def test_sleeps_until_the_next_0005_utc(monkeypatch, now, expected):
    h = _Harness(monkeypatch, now)
    await h.run()
    assert h.sleeps == [expected, expected]


async def test_after_waking_it_recomputes_inside_maintenance_then_commits(monkeypatch, caplog):
    h = _Harness(monkeypatch, real_datetime.datetime(2026, 3, 10, 0, 3, tzinfo=UTC))
    with caplog.at_level(logging.INFO, logger="app.main"):
        await h.run()
    assert h.events == ["open", "maintenance-in", "recompute", "maintenance-out", "commit", "close"]
    assert "Cost rollover refreshed 7 card(s)" in caplog.messages


async def test_a_failure_is_logged_and_retried_after_an_hour(monkeypatch, caplog):
    h = _Harness(
        monkeypatch,
        real_datetime.datetime(2026, 3, 10, 0, 3, tzinfo=UTC),
        fail_first=True,
        sleeps_before_stop=3,
    )
    with caplog.at_level(logging.INFO, logger="app.main"):
        await h.run()
    assert h.sleeps == [120.0, 3600, 120.0]
    assert "commit" not in h.events[: h.events.index("recompute") + 3]
    assert "Error in cost rollover loop" in caplog.messages
