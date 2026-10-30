"""Integration tests: the cost reports show the current fiscal year only.

A card's annual cost counts in full when the current fiscal year falls between
the one it goes ``active`` in and the one its ``endOfLife`` falls in, both
included — no pro-rating, and no way to ask for another year. Dates are built
relative to the current fiscal year so the tests do not rot as the calendar
moves on.
"""

from __future__ import annotations

import pytest

from app.models.app_settings import AppSettings
from app.models.card_cost_history import CardCostHistory
from app.services.fiscal_year import current_fiscal_year
from tests.conftest import (
    auth_headers,
    create_card,
    create_card_type,
    create_relation,
    create_relation_type,
    create_role,
    create_user,
)

COST_FIELDS = [
    {"section": "Cost", "fields": [{"key": "costTotalAnnual", "type": "cost", "weight": 0}]}
]

# With the default January start the fiscal year is the calendar year.
THIS_YEAR = current_fiscal_year(1)


def _d(year: int, month: int = 6, day: int = 15) -> str:
    return f"{year:04d}-{month:02d}-{day:02d}"


async def _set_fiscal_year_start(db, month: int) -> None:
    await db.merge(AppSettings(id="default", general_settings={"fiscalYearStart": month}))
    await db.flush()


@pytest.fixture
async def env(db):
    await create_role(db, key="admin", permissions={"*": True})
    admin = await create_user(db, email="admin@test.com", role="admin")
    await create_card_type(db, key="Application", fields_schema=COST_FIELDS)
    await create_card_type(db, key="ITComponent", fields_schema=COST_FIELDS)
    await create_card_type(db, key="Provider", fields_schema=[])
    await create_relation_type(
        db,
        key="relAppToITC",
        source_type_key="Application",
        target_type_key="ITComponent",
    )
    await create_relation_type(
        db,
        key="relProviderToITC",
        source_type_key="Provider",
        target_type_key="ITComponent",
    )
    return {"admin": admin}


async def _app(db, name, cost, lifecycle=None, card_type="Application"):
    return await create_card(
        db,
        card_type=card_type,
        name=name,
        attributes={"costTotalAnnual": cost},
        lifecycle=lifecycle or {},
    )


async def _treemap(client, env, **params):
    resp = await client.get(
        "/api/v1/reports/cost-treemap",
        params={"type": "Application", **params},
        headers=auth_headers(env["admin"]),
    )
    assert resp.status_code == 200, resp.text
    return resp.json()


def _names(data) -> list[str]:
    return sorted(i["name"] for i in data["items"])


class TestCostTreemapCurrentFiscalYear:
    async def test_retired_in_an_earlier_year_is_excluded(self, client, db, env):
        """The reported bug: an End of Life in the past still added its cost."""
        await _app(
            db,
            "Retired",
            1000,
            {"active": _d(THIS_YEAR - 5), "endOfLife": _d(THIS_YEAR - 1, 12, 31)},
        )
        await _app(db, "Running", 200, {"active": _d(THIS_YEAR - 5)})
        await _app(db, "No lifecycle", 30)

        data = await _treemap(client, env)
        assert _names(data) == ["No lifecycle", "Running"]
        assert data["total"] == 230
        assert data["fiscal_year"] == THIS_YEAR
        assert data["fiscal_year_start"] == 1

    async def test_retiring_this_year_counts_in_full(self, client, db, env):
        """No pro-rating: the year of End of Life carries the whole annual cost."""
        await _app(
            db, "Leaving", 1200, {"active": _d(THIS_YEAR - 3), "endOfLife": _d(THIS_YEAR, 1, 1)}
        )
        data = await _treemap(client, env)
        assert _names(data) == ["Leaving"]
        assert data["total"] == 1200

    async def test_going_live_this_year_counts_in_full(self, client, db, env):
        await _app(db, "Late arrival", 500, {"active": _d(THIS_YEAR, 12, 31)})
        data = await _treemap(client, env)
        assert data["total"] == 500

    async def test_going_live_next_year_is_excluded(self, client, db, env):
        await _app(
            db, "Upcoming", 500, {"phaseIn": _d(THIS_YEAR), "active": _d(THIS_YEAR + 1, 1, 1)}
        )
        assert (await _treemap(client, env))["items"] == []

    async def test_planned_without_an_active_date_is_excluded(self, client, db, env):
        await _app(db, "Idea", 700, {"plan": _d(THIS_YEAR - 1)})
        assert (await _treemap(client, env))["items"] == []

    async def test_fiscal_year_start_month_moves_the_boundary(self, client, db, env):
        await _set_fiscal_year_start(db, 10)
        fy = current_fiscal_year(10)
        # FY `fy` runs from 1 October of fy-1 through 30 September of fy.
        await _app(db, "Retired last FY", 10, {"endOfLife": _d(fy - 1, 9, 30)})
        await _app(db, "Retiring on day one", 20, {"endOfLife": _d(fy - 1, 10, 1)})
        await _app(db, "Live on the last day", 40, {"active": _d(fy, 9, 30)})
        await _app(db, "Live next FY", 80, {"active": _d(fy, 10, 1)})

        data = await _treemap(client, env)
        assert _names(data) == ["Live on the last day", "Retiring on day one"]
        assert data["fiscal_year"] == fy
        assert data["fiscal_year_start"] == 10

    async def test_a_past_year_is_now_a_real_param_echoed_back(self, client, db, env):
        """Superseded by the fiscal-year-history plan: `fiscal_year` is now a
        real query param (docs/superpowers/plans/2026-10-28-cost-report-fiscal-year-history.md,
        Task 4) — a card with no history row for the requested past year shows
        no items, but the response now echoes back the year actually asked for,
        not always the current one."""
        await _app(db, "Retired", 1000, {"endOfLife": _d(THIS_YEAR - 1)})
        data = await _treemap(client, env, fiscal_year=THIS_YEAR - 1)
        assert data["items"] == []
        assert data["fiscal_year"] == THIS_YEAR - 1


class TestCostEndpointCurrentFiscalYear:
    async def test_cost_report_applies_the_same_rule(self, client, db, env):
        await _app(db, "Retired", 1000, {"endOfLife": _d(THIS_YEAR - 1)})
        await _app(db, "Running", 200)

        resp = await client.get(
            "/api/v1/reports/cost",
            params={"type": "Application"},
            headers=auth_headers(env["admin"]),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert [i["name"] for i in data["items"]] == ["Running"]
        assert data["total"] == 200
        assert data["fiscal_year"] == THIS_YEAR
        assert data["fiscal_year_start"] == 1


async def _hist(db, card, year, value):
    db.add(
        CardCostHistory(card_id=card.id, fiscal_year=year, field_key="costTotalAnnual", value=value)
    )
    await db.flush()


async def _sankey(client, env, **params):
    resp = await client.get(
        "/api/v1/reports/cost-sankey",
        params={"type": "Application", **params},
        headers=auth_headers(env["admin"]),
    )
    assert resp.status_code == 200, resp.text
    return resp.json()


async def _app_itc_pair(db, app_lifecycle=None, itc_lifecycle=None):
    """An Application and an ITComponent linked by relAppToITC, both costed 100 now."""
    app = await _app(db, "App", 100, app_lifecycle)
    itc = await _app(db, "ITC", 100, itc_lifecycle, card_type="ITComponent")
    await create_relation(db, type_key="relAppToITC", source_id=app.id, target_id=itc.id)
    return app, itc


class TestPastAndForecastYearsListCardsWithARecordedCost:
    async def test_a_retired_card_with_history_appears_in_that_past_year_treemap(
        self, client, db, env
    ):
        retired = await _app(db, "Retired", 0, {"endOfLife": _d(THIS_YEAR - 1)})
        await _hist(db, retired, THIS_YEAR - 2, 700)

        data = await _treemap(client, env, fiscal_year=THIS_YEAR - 2)
        assert _names(data) == ["Retired"]
        assert data["total"] == 700
        assert data["fiscal_year"] == THIS_YEAR - 2
        assert (await _treemap(client, env))["items"] == []

    async def test_a_card_active_from_next_year_appears_in_the_forecast_year_treemap(
        self, client, db, env
    ):
        upcoming = await _app(db, "Upcoming", 0, {"active": _d(THIS_YEAR + 1, 1, 1)})
        await _hist(db, upcoming, THIS_YEAR + 1, 300)

        data = await _treemap(client, env, fiscal_year=THIS_YEAR + 1)
        assert _names(data) == ["Upcoming"]
        assert data["total"] == 300

    async def test_the_current_year_is_unchanged_treemap(self, client, db, env):
        await _app(db, "Retired", 1000, {"endOfLife": _d(THIS_YEAR - 1)})
        running = await _app(db, "Running", 200)
        await _hist(db, running, THIS_YEAR, 999)  # history is not read for the current year

        data = await _treemap(client, env, fiscal_year=THIS_YEAR)
        assert _names(data) == ["Running"]
        assert data["total"] == 200

    async def test_a_retired_card_with_history_appears_in_that_past_year_sankey(
        self, client, db, env
    ):
        app, itc = await _app_itc_pair(
            db, {"endOfLife": _d(THIS_YEAR - 1)}, {"endOfLife": _d(THIS_YEAR - 1)}
        )
        await _hist(db, app, THIS_YEAR - 2, 40)
        await _hist(db, itc, THIS_YEAR - 2, 60)

        data = await _sankey(client, env, fiscal_year=THIS_YEAR - 2)
        assert sorted(n["name"] for n in data["nodes"]) == ["App", "costTotalAnnual"]
        assert data["total"] == 40
        assert (await _sankey(client, env))["nodes"] == []

    async def test_a_card_active_from_next_year_appears_in_the_forecast_year_sankey(
        self, client, db, env
    ):
        later = {"active": _d(THIS_YEAR + 1, 1, 1)}
        app, itc = await _app_itc_pair(db, later, later)
        await _hist(db, app, THIS_YEAR + 1, 40)
        await _hist(db, itc, THIS_YEAR + 1, 60)

        data = await _sankey(client, env, fiscal_year=THIS_YEAR + 1)
        assert sorted(n["name"] for n in data["nodes"]) == ["App", "costTotalAnnual"]
        assert data["total"] == 40

    async def test_the_current_year_is_unchanged_sankey(self, client, db, env):
        await _app_itc_pair(db)
        await _app_itc_pair(db, {"endOfLife": _d(THIS_YEAR - 1)}, {"endOfLife": _d(THIS_YEAR - 1)})

        data = await _sankey(client, env, fiscal_year=THIS_YEAR)
        assert sorted(n["name"] for n in data["nodes"]) == ["App", "costTotalAnnual"]
        assert data["total"] == 100


@pytest.mark.parametrize("report", ["cost-treemap", "cost-sankey"])
@pytest.mark.parametrize("year", ["99999999999", "2147483648", "0", "-1", "1899", "2201"])
async def test_an_absurd_fiscal_year_is_422_not_a_500(client, db, env, report, year):
    resp = await client.get(
        f"/api/v1/reports/{report}?type=Application&fiscal_year={year}",
        headers=auth_headers(env["admin"]),
    )
    assert resp.status_code == 422


@pytest.mark.parametrize("report", ["cost-treemap", "cost-sankey"])
@pytest.mark.parametrize("year", [1900, 2200])
async def test_the_sanity_bounds_of_the_fiscal_year_are_accepted(client, db, env, report, year):
    """Reads have no five-year window: a saved report on an old year is empty, not an error."""
    resp = await client.get(
        f"/api/v1/reports/{report}?type=Application&fiscal_year={year}",
        headers=auth_headers(env["admin"]),
    )
    assert resp.status_code == 200


@pytest.mark.parametrize("start", [1, 10])
@pytest.mark.parametrize("offset", [None, -2, 1])
async def test_the_response_names_the_current_year_even_when_another_is_requested(
    client, db, env, start, offset
):
    """`fiscal_year` is the requested year; `current_fiscal_year` is always today's."""
    await _set_fiscal_year_start(db, start)
    today = current_fiscal_year(start)
    await _app_itc_pair(db)
    params = {} if offset is None else {"fiscal_year": today + offset}
    expected_requested = today if offset is None else today + offset

    treemap = await _treemap(client, env, **params)
    full_sankey = await _sankey(client, env, **params)
    # A past/forecast year with no recorded cost takes the sankey's early return.
    empty_sankey = await _sankey(client, env, fiscal_year=today - 3)

    for data in (treemap, full_sankey):
        assert data["current_fiscal_year"] == today
        assert data["fiscal_year"] == expected_requested
    assert empty_sankey["nodes"] == []
    assert empty_sankey["current_fiscal_year"] == today
    assert empty_sankey["fiscal_year"] == today - 3
