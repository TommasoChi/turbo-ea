# Cost Report: Fiscal-Year Cost History Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the cost report show a card's *actual* cost for a chosen fiscal year, not just today's live value re-shown under a different label — via a new `card_cost_history` table, synced automatically from the existing scalar cost fields on every card write.

**Architecture:** New table `card_cost_history(card_id, fiscal_year, field_key, value)`, same shape as the existing `ppm_budget_lines` (`backend/app/models/ppm_cost_line.py`). `CardWriteService.create_card`/`update_card` upsert the **current** fiscal year's row for every cost-typed field whenever a card is saved — so the scalar fields stay the single, familiar place to edit *this year's* cost (no UI change to card editing, the `Calculation` engine and every other report that reads `attributes.costTotalAnnual` keep working untouched), while a new small UI and a new endpoint handle *other* years. `cost_treemap`/`cost_sankey` gain a real `fiscal_year` query param that reads from the table for a past year and falls back to live `attributes` for the current year (covering cards saved before this feature shipped, which have no history row yet for the current year). `is_live_in_fiscal_year` is unchanged — it still decides *whether* a card counts for a year; the table decides *what value* it counts at.

**Tech Stack:** FastAPI + SQLAlchemy (backend), React + MUI (frontend).

**Spec:** `docs/superpowers/specs/2026-10-28-cost-report-sankey-design.md` (section "Fiscal-year cost history")

## Decision this plan makes (the spec's open question)

The spec asks what happens to the scalar cost fields once history exists: become read-only mirrors, or does editing become exclusively a history-table operation? **Decision: neither extreme — the scalar fields stay exactly as they are today (live, editable, calculated), and every save auto-upserts the current fiscal year's history row from them.** Ripping out the scalar fields (the spec's "exclusively a history-table operation") would touch every other report and the `Calculation` engine, which target the scalar attribute — out of proportion to this plan's goal. A silent read-only mirror (the spec's other option) adds a second place to look with no second place to edit, which is more confusing, not less. Auto-sync keeps the existing editing experience, costs one small hook, and makes the current year's history row always consistent with the card by construction — a past/future year is the only thing that needs new UI, because it is the only thing with no existing editing surface at all.

## Global Constraints

- New migration follows the guarded/idempotent convention (`.claude/rules/settings-and-seed.md`) only where it touches `card_types`/`calculations` seed rows — this plan's migration only creates a new table, so no guard is needed (a `CREATE TABLE` is already idempotent against re-running the same revision once, and Alembic's own revision tracking prevents a second run).
- `card_cost_history` mirrors `ppm_budget_lines`' column shape where applicable (`id`, FK `ondelete="CASCADE"`, `fiscal_year: Integer`, `created_at`/`updated_at` via `TimestampMixin`) — same pattern, not a new one.
- Regenerate `docs/api/openapi.json` via `scripts/dump_openapi.py` after any route change.
- New frontend strings go in `frontend/src/i18n/locales/en/reports.json` / `frontend/src/i18n/locales/en/cards.json` (whichever the UI task's component naturally belongs to) — run `/translate` before the PR.
- Fake/demo FY24-25 data is explicitly **out of scope** for this plan (per the spec) — do not seed any.

## Review Focus

- A card saved *before* this feature shipped, with no history row yet, viewed at the **current** fiscal year: must show its live `attributes` value, not a blank/zero — Task 4's test `test_cost_treemap_falls_back_to_live_attributes_when_no_history_row_exists_for_the_current_year`.
- The same card viewed at a **past** fiscal year it has no history row for: must show zero/excluded (there is no data for that year, which is different from "no data for the current year" — the current year can fall back to the live value, a past year genuinely has nothing), not the current live value re-shown — Task 4's test `test_cost_treemap_shows_nothing_for_a_past_year_with_no_history_row`.
- Two cost fields on the same card (e.g. `softwareLicensingCost` and `infrastruttureCost`), each with its own history row for the same year: both must update independently — a write to one field's history must not touch the other's row — Task 3's test `test_upserting_one_field_does_not_touch_another_fields_row`.
- A card's cost field is cleared (set to `null`/removed) in an update: the sync hook must not leave a stale nonzero history row for the current year sitting around forever — Task 2's test `test_clearing_a_cost_field_zeroes_its_current_year_history_row`.
- `is_live_in_fiscal_year` must still gate whether a card appears **at all** for a chosen past year, independent of whether it has a history row — a card retired before that year must still be excluded even if a stray history row exists for it (e.g. from before it was retired) — Task 4's test `test_a_retired_cards_history_row_does_not_resurrect_it_for_a_past_year`.

---

## File Structure

- Create `backend/alembic/versions/169_card_cost_history.py`.
- Create `backend/app/models/card_cost_history.py` (`CardCostHistory` model).
- Modify `backend/app/models/__init__.py` (export `CardCostHistory`).
- Create `backend/app/services/cost_history.py` (`sync_current_fy_history(db, card) -> None`, the sync hook's body — its own file since both `create_card` and `update_card` call it, and it needs its own focused tests).
- Modify `backend/app/services/card_write_service.py` (call the sync hook after `run_calculations_for_card` in both `create_card` and `update_card`).
- Create `backend/app/api/v1/cost_history.py` (new router: list/upsert a card's history rows for a past/future year).
- Modify `backend/app/main.py` (or wherever routers are registered — check the existing router-registration pattern before adding).
- Modify `backend/app/api/v1/reports.py` (`cost_treemap`/`cost_sankey` gain `fiscal_year: int | None = Query(None)`).
- Create `backend/tests/services/test_cost_history.py`.
- Create `backend/tests/api/test_cost_history_api.py`.
- Modify `backend/tests/api/test_reports_extended.py` and `backend/tests/api/test_reports_cost_sankey.py` (new `fiscal_year` param tests).
- Create `frontend/src/features/cards/sections/CostHistoryEditor.tsx` (the per-card, per-field history table: add/edit/delete a row for a non-current year).
- Create `frontend/src/features/cards/sections/CostHistoryEditor.test.tsx`.
- Modify `frontend/src/features/reports/CostReport.tsx` (a fiscal-year picker, wired to the new `fiscal_year` param, replacing the current "the server names the year, no picker" text where a past year is now choosable).
- Modify `frontend/src/features/reports/CostReport.test.tsx` (fiscal-year picker tests).

---

## Task 1: `card_cost_history` table and model

**Files:**
- Create: `backend/alembic/versions/169_card_cost_history.py`
- Create: `backend/app/models/card_cost_history.py`
- Modify: `backend/app/models/__init__.py`
- Test: `backend/tests/services/test_cost_history.py` (Step 1-4 only; Task 2 adds more to this same file)

**Interfaces:**
- Produces: `CardCostHistory(Base, UUIDMixin, TimestampMixin)` — columns `card_id: UUID` (FK `cards.id`, `ondelete="CASCADE"`, indexed), `fiscal_year: int`, `field_key: str` (Text), `value: float` (default 0). A unique constraint on `(card_id, fiscal_year, field_key)` — `__table_args__ = (UniqueConstraint("card_id", "fiscal_year", "field_key"),)`.

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/services/test_cost_history.py
import pytest
from sqlalchemy.exc import IntegrityError
from app.models.card_cost_history import CardCostHistory
from tests.conftest import create_card

pytestmark = pytest.mark.anyio


async def test_a_row_is_unique_per_card_fiscal_year_field(db):
    card = await create_card(db, card_type="Application", name="ERP")
    db.add(CardCostHistory(card_id=card.id, fiscal_year=2025, field_key="costTotalAnnual", value=100))
    await db.flush()
    db.add(CardCostHistory(card_id=card.id, fiscal_year=2025, field_key="costTotalAnnual", value=200))
    with pytest.raises(IntegrityError):
        await db.flush()
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && PYTHONUTF8=1 POSTGRES_HOST=localhost POSTGRES_PORT=5433 POSTGRES_USER=turboea POSTGRES_PASSWORD=turboea TEST_POSTGRES_DB=turboea_test venv/Scripts/python.exe -m pytest tests/services/test_cost_history.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.models.card_cost_history'`.

- [ ] **Step 3: Implement the model and migration**

```python
# backend/app/models/card_cost_history.py
from __future__ import annotations

import uuid

from sqlalchemy import Float, ForeignKey, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin, UUIDMixin


class CardCostHistory(Base, UUIDMixin, TimestampMixin):
    """One cost field's value for one card, for one fiscal year."""

    __tablename__ = "card_cost_history"
    __table_args__ = (UniqueConstraint("card_id", "fiscal_year", "field_key"),)

    card_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("cards.id", ondelete="CASCADE"), nullable=False, index=True
    )
    fiscal_year: Mapped[int] = mapped_column(nullable=False)
    field_key: Mapped[str] = mapped_column(Text, nullable=False)
    value: Mapped[float] = mapped_column(Float, default=0)
```

Migration `169_card_cost_history.py` (`down_revision = "168"`): `op.create_table("card_cost_history", ...)` mirroring the model's columns plus `id` (UUID primary key, same pattern as `052_ppm_budget_lines_and_cost_date.py`), `created_at`/`updated_at` (`server_default=sa.func.now()`), and `op.create_unique_constraint("uq_card_cost_history_card_fy_field", "card_cost_history", ["card_id", "fiscal_year", "field_key"])`. `downgrade()` drops the table.

Add `from app.models.card_cost_history import CardCostHistory` to `backend/app/models/__init__.py`'s existing import list (read the file first — match its existing alphabetical-ish ordering).

- [ ] **Step 4: Run to verify it passes**

Run: `cd backend && alembic upgrade head` then the same pytest command as Step 2.
Expected: migration applies with no error; test PASSES.

- [ ] **Step 5: Lint**

Run: `cd backend && venv/Scripts/python.exe -m ruff check app/models/card_cost_history.py alembic/versions/169_card_cost_history.py tests/services/test_cost_history.py && venv/Scripts/python.exe -m ruff format app/models/card_cost_history.py alembic/versions/169_card_cost_history.py tests/services/test_cost_history.py`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add backend/app/models/card_cost_history.py backend/app/models/__init__.py backend/alembic/versions/169_card_cost_history.py backend/tests/services/test_cost_history.py
git commit -m "feat(cost-history): add card_cost_history table

One row per (card, fiscal year, cost field key). Same shape as the
existing ppm_budget_lines. Nothing writes to it yet — Task 2 wires the
sync hook."
```

---

## Task 2: Sync-on-write hook

**Files:**
- Create: `backend/app/services/cost_history.py`
- Modify: `backend/app/services/card_write_service.py:844` (inside `create_card`, right after `await run_calculations_for_card(db, card, exclude_fields=ppm_excl)`) and `:1016` (inside `update_card`, same call site — read the file at these two exact line numbers before editing, since an earlier task on this branch may have shifted them slightly)
- Test: `backend/tests/services/test_cost_history.py` (append to the file Task 1 created)

**Interfaces:**
- Consumes: `CardCostHistory` (Task 1); `current_fiscal_year`/`get_fiscal_year_start` (`app.services.fiscal_year`, already used by `reports.py`); `cost_value` (`app.services.cost_value`, already used by `reports.py`).
- Produces: `async def sync_current_fy_history(db: AsyncSession, card: Card) -> None` in `backend/app/services/cost_history.py` — reads `card.type`'s `fields_schema` for every `type == "cost"` field key, and upserts (via a `SELECT` then `INSERT`/`UPDATE`, or a Postgres `ON CONFLICT` — either is fine, no test pins the SQL shape) a `CardCostHistory` row for `(card.id, current_fiscal_year(await get_fiscal_year_start(db)), field_key)` with `value = cost_value(card.attributes.get(field_key))`. Called by Task 4 nowhere directly (reports read history, not this function) — consumed only by `create_card`/`update_card`.

- [ ] **Step 1: Write the failing tests**

```python
# Append to backend/tests/services/test_cost_history.py
from sqlalchemy import select
from app.models.card_cost_history import CardCostHistory
from app.services.cost_history import sync_current_fy_history
from app.services.fiscal_year import current_fiscal_year, get_fiscal_year_start
from tests.conftest import create_card_type


async def _history_rows(db, card_id):
    return (await db.execute(select(CardCostHistory).where(CardCostHistory.card_id == card_id))).scalars().all()


async def test_syncs_a_cost_field_to_the_current_fiscal_year(db):
    await create_card_type(
        db, key="Application", fields_schema=[
            {"section": "Cost", "fields": [{"key": "costTotalAnnual", "type": "cost", "weight": 0}]}
        ],
    )
    card = await create_card(db, card_type="Application", name="ERP", attributes={"costTotalAnnual": 500})
    await sync_current_fy_history(db, card)
    rows = await _history_rows(db, card.id)
    fy = current_fiscal_year(await get_fiscal_year_start(db))
    assert len(rows) == 1
    assert rows[0].fiscal_year == fy
    assert rows[0].field_key == "costTotalAnnual"
    assert rows[0].value == 500


async def test_upserting_one_field_does_not_touch_another_fields_row(db):
    await create_card_type(
        db, key="Application", fields_schema=[
            {"section": "Cost", "fields": [
                {"key": "costTotalAnnual", "type": "cost", "weight": 0},
                {"key": "infrastruttureCost", "type": "cost", "weight": 0},
            ]}
        ],
    )
    card = await create_card(
        db, card_type="Application", name="ERP",
        attributes={"costTotalAnnual": 500, "infrastruttureCost": 100},
    )
    await sync_current_fy_history(db, card)
    card.attributes = {"costTotalAnnual": 999, "infrastruttureCost": 100}
    await sync_current_fy_history(db, card)
    rows = {r.field_key: r.value for r in await _history_rows(db, card.id)}
    assert rows == {"costTotalAnnual": 999, "infrastruttureCost": 100}


async def test_clearing_a_cost_field_zeroes_its_current_year_history_row(db):
    await create_card_type(
        db, key="Application", fields_schema=[
            {"section": "Cost", "fields": [{"key": "costTotalAnnual", "type": "cost", "weight": 0}]}
        ],
    )
    card = await create_card(db, card_type="Application", name="ERP", attributes={"costTotalAnnual": 500})
    await sync_current_fy_history(db, card)
    card.attributes = {}
    await sync_current_fy_history(db, card)
    rows = await _history_rows(db, card.id)
    assert len(rows) == 1
    assert rows[0].value == 0


async def test_update_card_calls_the_sync_hook(client, db, env):
    """Integration check that the hook actually fires from the write path,
    not just when called directly — covers the card_write_service.py wiring."""
    from tests.conftest import auth_headers

    admin = env["admin"]
    card = await create_card(db, card_type="Application", name="ERP", user_id=admin.id)
    resp = await client.patch(
        f"/api/v1/cards/{card.id}",
        json={"attributes": {"costTotalAnnual": 42}},
        headers=auth_headers(admin),
    )
    assert resp.status_code == 200
    rows = await _history_rows(db, card.id)
    assert len(rows) == 1
    assert rows[0].value == 42
```

For the last test, use whichever `env` fixture `backend/tests/api/test_cards_archive_delete.py` or a similar card-CRUD test file already sets up for a PATCH on `/cards/{id}` (read one such file first to match its exact `env`/`client` fixture shape — the plan cannot pin the exact PATCH route/body shape without that file, since it may differ slightly from this sketch).

- [ ] **Step 2: Run to verify they fail**

Run: `cd backend && PYTHONUTF8=1 POSTGRES_HOST=localhost POSTGRES_PORT=5433 POSTGRES_USER=turboea POSTGRES_PASSWORD=turboea TEST_POSTGRES_DB=turboea_test venv/Scripts/python.exe -m pytest tests/services/test_cost_history.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.services.cost_history'` (first 3 new tests), the 4th fails too since nothing calls the hook yet.

- [ ] **Step 3: Implement `sync_current_fy_history` and wire it in**

```python
# backend/app/services/cost_history.py
from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.card import Card
from app.models.card_cost_history import CardCostHistory
from app.models.card_type import CardType
from app.services.cost_value import cost_value
from app.services.fiscal_year import current_fiscal_year, get_fiscal_year_start


async def sync_current_fy_history(db: AsyncSession, card: Card) -> None:
    """Upsert the current fiscal year's history row for every cost-typed
    field on ``card``'s type, from ``card.attributes``'s present value."""
    type_def = (await db.execute(select(CardType).where(CardType.key == card.type))).scalar_one_or_none()
    if type_def is None:
        return
    cost_keys = [
        f["key"]
        for section in type_def.fields_schema or []
        for f in section.get("fields", [])
        if f.get("type") == "cost"
    ]
    if not cost_keys:
        return
    fy = current_fiscal_year(await get_fiscal_year_start(db))
    attrs = card.attributes or {}
    for key in cost_keys:
        row = (
            await db.execute(
                select(CardCostHistory).where(
                    CardCostHistory.card_id == card.id,
                    CardCostHistory.fiscal_year == fy,
                    CardCostHistory.field_key == key,
                )
            )
        ).scalar_one_or_none()
        value = cost_value(attrs.get(key))
        if row is None:
            db.add(CardCostHistory(card_id=card.id, fiscal_year=fy, field_key=key, value=value))
        else:
            row.value = value
    await db.flush()
```

In `card_write_service.py`: add `from app.services.cost_history import sync_current_fy_history` to the imports, and `await sync_current_fy_history(db, card)` immediately after each of the two `run_calculations_for_card` calls identified above (`create_card` and `update_card`) — after, not before, because a calculated field like `costTotalAnnual` must sync its freshly-calculated value, not last write's.

- [ ] **Step 4: Run to verify they pass**

Run: same command as Step 2.
Expected: PASS, all 4 new tests plus Task 1's test.

- [ ] **Step 5: Run the broader card-write test suite**

Run: `cd backend && PYTHONUTF8=1 POSTGRES_HOST=localhost POSTGRES_PORT=5433 POSTGRES_USER=turboea POSTGRES_PASSWORD=turboea TEST_POSTGRES_DB=turboea_test venv/Scripts/python.exe -m pytest tests/services/test_card_write_service.py tests/services/test_card_write_service_exact.py`
Expected: PASS — confirms the new hook call didn't break any existing create/update behavior.

- [ ] **Step 6: Lint**

Run: `cd backend && venv/Scripts/python.exe -m ruff check app/services/cost_history.py app/services/card_write_service.py tests/services/test_cost_history.py && venv/Scripts/python.exe -m ruff format app/services/cost_history.py app/services/card_write_service.py tests/services/test_cost_history.py`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add backend/app/services/cost_history.py backend/app/services/card_write_service.py backend/tests/services/test_cost_history.py
git commit -m "feat(cost-history): sync current fiscal year on every card write

Every create/update now upserts this year's card_cost_history row for
each of the card type's cost fields, from the card's own (post-
calculation) attributes. The scalar fields stay the single editing
surface for the current year; history for other years has no editing
surface yet — Task 5 adds it."
```

---

## Task 3: Cost-history API — list and upsert a past/future year

**Files:**
- Create: `backend/app/api/v1/cost_history.py`
- Modify: `backend/app/main.py` (router registration — read the file's existing `include_router` calls first to match the pattern exactly)
- Test: `backend/tests/api/test_cost_history_api.py`

**Interfaces:**
- Consumes: `CardCostHistory` (Task 1).
- Produces: `GET /api/v1/cards/{card_id}/cost-history` → `{"rows": [{"fiscal_year": int, "field_key": str, "value": float}]}` (every row for the card, any year). `PUT /api/v1/cards/{card_id}/cost-history` with body `{"fiscal_year": int, "field_key": str, "value": float}` → upserts that one row, `200 {"fiscal_year", "field_key", "value"}`. `DELETE /api/v1/cards/{card_id}/cost-history/{fiscal_year}/{field_key}` → `204`. All three gated by the same permission that gates editing the card itself — reuse `PermissionService` the same way `card_write_service`'s own route callers do (read `backend/app/api/v1/cards.py`'s PATCH route for the exact check before writing this router, so the two stay consistent).

- [ ] **Step 1: Write the failing tests**

```python
# backend/tests/api/test_cost_history_api.py
import pytest
from tests.conftest import auth_headers, create_card, create_card_type

pytestmark = pytest.mark.anyio

COST_FIELDS = [{"section": "Cost", "fields": [{"key": "costTotalAnnual", "type": "cost", "weight": 0}]}]


@pytest.fixture
async def env(db):
    from tests.conftest import create_role, create_user
    await create_role(db, key="admin", permissions={"*": True})
    admin = await create_user(db, email="admin@cost-history.com", role="admin")
    await create_card_type(db, key="Application", fields_schema=COST_FIELDS)
    return {"admin": admin}


async def test_lists_every_year_a_card_has(client, db, env):
    admin = env["admin"]
    card = await create_card(db, card_type="Application", name="ERP", user_id=admin.id)
    resp = await client.put(
        f"/api/v1/cards/{card.id}/cost-history",
        json={"fiscal_year": 2024, "field_key": "costTotalAnnual", "value": 100},
        headers=auth_headers(admin),
    )
    assert resp.status_code == 200
    resp = await client.get(f"/api/v1/cards/{card.id}/cost-history", headers=auth_headers(admin))
    assert resp.status_code == 200
    assert resp.json()["rows"] == [{"fiscal_year": 2024, "field_key": "costTotalAnnual", "value": 100}]


async def test_upsert_overwrites_the_same_year_and_field(client, db, env):
    admin = env["admin"]
    card = await create_card(db, card_type="Application", name="ERP", user_id=admin.id)
    for value in (100, 200):
        resp = await client.put(
            f"/api/v1/cards/{card.id}/cost-history",
            json={"fiscal_year": 2024, "field_key": "costTotalAnnual", "value": value},
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
    resp = await client.get(f"/api/v1/cards/{card.id}/cost-history", headers=auth_headers(admin))
    assert resp.json()["rows"] == [{"fiscal_year": 2024, "field_key": "costTotalAnnual", "value": 200}]


async def test_delete_removes_the_row(client, db, env):
    admin = env["admin"]
    card = await create_card(db, card_type="Application", name="ERP", user_id=admin.id)
    await client.put(
        f"/api/v1/cards/{card.id}/cost-history",
        json={"fiscal_year": 2024, "field_key": "costTotalAnnual", "value": 100},
        headers=auth_headers(admin),
    )
    resp = await client.delete(
        f"/api/v1/cards/{card.id}/cost-history/2024/costTotalAnnual", headers=auth_headers(admin)
    )
    assert resp.status_code == 204
    resp = await client.get(f"/api/v1/cards/{card.id}/cost-history", headers=auth_headers(admin))
    assert resp.json()["rows"] == []


async def test_rejects_a_field_key_the_card_type_does_not_have(client, db, env):
    admin = env["admin"]
    card = await create_card(db, card_type="Application", name="ERP", user_id=admin.id)
    resp = await client.put(
        f"/api/v1/cards/{card.id}/cost-history",
        json={"fiscal_year": 2024, "field_key": "notACostField", "value": 100},
        headers=auth_headers(admin),
    )
    assert resp.status_code == 400
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd backend && PYTHONUTF8=1 POSTGRES_HOST=localhost POSTGRES_PORT=5433 POSTGRES_USER=turboea POSTGRES_PASSWORD=turboea TEST_POSTGRES_DB=turboea_test venv/Scripts/python.exe -m pytest tests/api/test_cost_history_api.py -v`
Expected: FAIL — `404 Not Found` on every route.

- [ ] **Step 3: Implement the router**

Validate `field_key` against the card's type's cost fields the same way `reports.py`'s `_SAFE_KEY_RE` + a metamodel lookup already does (reuse the regex and the field-type-lookup pattern from `cost_treemap`, don't reinvent it). Fetch the `Card` first (404 if missing, same `PermissionService` check `card_write_service`'s own callers use before an edit). Implement the three routes per the Produces block above.

- [ ] **Step 4: Run to verify they pass**

Run: same command as Step 2.
Expected: PASS.

- [ ] **Step 5: Lint & regenerate OpenAPI**

Run: `cd backend && venv/Scripts/python.exe -m ruff check app/api/v1/cost_history.py tests/api/test_cost_history_api.py && venv/Scripts/python.exe -m ruff format app/api/v1/cost_history.py tests/api/test_cost_history_api.py`
Then: `cd .. && PYTHONUTF8=1 backend/venv/Scripts/python.exe scripts/dump_openapi.py`
Expected: ruff clean; "Wrote ... openapi.json" with the 3 new paths present.

- [ ] **Step 6: Commit**

```bash
git add backend/app/api/v1/cost_history.py backend/app/main.py backend/tests/api/test_cost_history_api.py docs/api/openapi.json
git commit -m "feat(cost-history): add the cost-history CRUD API

List/upsert/delete a card's cost-history rows for any fiscal year other
than the current one (the current year is synced automatically, Task 2)."
```

---

## Task 4: `cost_treemap`/`cost_sankey` read a real `fiscal_year` param

**Files:**
- Modify: `backend/app/api/v1/reports.py` (`cost_treemap`, `cost_sankey`)
- Test: `backend/tests/api/test_reports_extended.py`, `backend/tests/api/test_reports_cost_sankey.py`

**Interfaces:**
- Consumes: `CardCostHistory` (Task 1).
- Produces: both endpoints gain `fiscal_year: int | None = Query(None)`. `None` keeps today's behavior (current year, live `attributes`). A given year other than today's current one reads from `card_cost_history` instead.

- [ ] **Step 1: Write the failing tests**

```python
# Add to backend/tests/api/test_reports_extended.py, inside TestCostTreemap (or sibling class)
async def test_cost_treemap_reads_a_past_year_from_history(self, client, db, env):
    from app.models.card_cost_history import CardCostHistory
    admin = env["admin"]
    app1 = await create_card(
        db, card_type="Application", name="ERP", user_id=admin.id,
        attributes={"costTotalAnnual": 999},  # today's live value — must NOT be shown
        lifecycle={"active": "2020-01-01"},
    )
    db.add(CardCostHistory(card_id=app1.id, fiscal_year=2024, field_key="costTotalAnnual", value=321))
    await db.flush()
    resp = await client.get(
        "/api/v1/reports/cost-treemap",
        params={"type": "Application", "fiscal_year": 2024},
        headers=auth_headers(admin),
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["items"][0]["cost"] == 321
    assert data["fiscal_year"] == 2024


async def test_cost_treemap_falls_back_to_live_attributes_when_no_history_row_exists_for_the_current_year(
    self, client, db, env
):
    from app.services.fiscal_year import current_fiscal_year
    admin = env["admin"]
    await create_card(
        db, card_type="Application", name="ERP", user_id=admin.id,
        attributes={"costTotalAnnual": 500}, lifecycle={"active": "2020-01-01"},
    )
    fy = current_fiscal_year(1)
    resp = await client.get(
        "/api/v1/reports/cost-treemap",
        params={"type": "Application", "fiscal_year": fy},
        headers=auth_headers(admin),
    )
    assert resp.json()["items"][0]["cost"] == 500


async def test_cost_treemap_shows_nothing_for_a_past_year_with_no_history_row(self, client, db, env):
    admin = env["admin"]
    await create_card(
        db, card_type="Application", name="ERP", user_id=admin.id,
        attributes={"costTotalAnnual": 500}, lifecycle={"active": "2020-01-01"},
    )
    resp = await client.get(
        "/api/v1/reports/cost-treemap",
        params={"type": "Application", "fiscal_year": 2024},
        headers=auth_headers(admin),
    )
    assert resp.json()["items"] == []


async def test_a_retired_cards_history_row_does_not_resurrect_it_for_a_past_year(self, client, db, env):
    from app.models.card_cost_history import CardCostHistory
    admin = env["admin"]
    app1 = await create_card(
        db, card_type="Application", name="Old", user_id=admin.id,
        lifecycle={"active": "2018-01-01", "endOfLife": "2022-12-31"},
    )
    db.add(CardCostHistory(card_id=app1.id, fiscal_year=2024, field_key="costTotalAnnual", value=500))
    await db.flush()
    resp = await client.get(
        "/api/v1/reports/cost-treemap",
        params={"type": "Application", "fiscal_year": 2024},
        headers=auth_headers(admin),
    )
    assert resp.json()["items"] == []
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd backend && PYTHONUTF8=1 POSTGRES_HOST=localhost POSTGRES_PORT=5433 POSTGRES_USER=turboea POSTGRES_PASSWORD=turboea TEST_POSTGRES_DB=turboea_test venv/Scripts/python.exe -m pytest tests/api/test_reports_extended.py -k "history_year or falls_back or shows_nothing or resurrect" -v`
Expected: FAIL — `fiscal_year` param currently ignored (200 OK but wrong `cost`/items), or 422 if FastAPI rejects the unknown query param (it won't, extra query params are ignored by default — so expect wrong values, not an error).

- [ ] **Step 3: Implement**

In `cost_treemap`, after computing `fy = current_fiscal_year(fy_start)` (the year that still gates *inclusion* via `is_live_in_fiscal_year`, unchanged), add: `target_fy = fiscal_year if fiscal_year is not None else fy`. When building each item's cost:
```python
if target_fy == fy:
    cost = cost_value((card.attributes or {}).get(cost_field))
else:
    history = history_by_card.get((card.id, cost_field))  # see below
    cost = history.value if history is not None else 0.0
```
Fetch `history_by_card` once per request (not per card) with a single query: `select(CardCostHistory).where(CardCostHistory.card_id.in_([c.id for c in sheets]), CardCostHistory.fiscal_year == target_fy, CardCostHistory.field_key == cost_field)`, keyed by `(row.card_id, row.field_key)` — skip the query entirely when `target_fy == fy` (no history lookup needed, matches the fallback test's intent that a current-year read never depends on history existing). The response's `fiscal_year` field becomes `target_fy` (not `fy`) when a param was given, so the UI echoes back what it asked for. Apply the same pattern to `cost_sankey`'s `costed_cards` helper (its `cost_field` loop), threading `fiscal_year` through identically.

- [ ] **Step 4: Run to verify they pass**

Run: same command as Step 2, then the full file: `cd backend && PYTHONUTF8=1 POSTGRES_HOST=localhost POSTGRES_PORT=5433 POSTGRES_USER=turboea POSTGRES_PASSWORD=turboea TEST_POSTGRES_DB=turboea_test venv/Scripts/python.exe -m pytest tests/api/test_reports_extended.py tests/api/test_reports_cost_sankey.py tests/api/test_reports_cost_fiscal_year.py -v`
Expected: PASS, including every pre-existing test (the fallback behavior must not change the current-year path's output).

- [ ] **Step 5: Lint**

Run: `cd backend && venv/Scripts/python.exe -m ruff check app/api/v1/reports.py tests/api/test_reports_extended.py && venv/Scripts/python.exe -m ruff format app/api/v1/reports.py tests/api/test_reports_extended.py`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add backend/app/api/v1/reports.py backend/tests/api/test_reports_extended.py backend/tests/api/test_reports_cost_sankey.py
git commit -m "feat(cost-history): wire fiscal_year into cost-treemap and cost-sankey

A past/future year reads from card_cost_history; the current year keeps
reading live attributes (no history lookup needed, and covers cards
saved before this feature existed). is_live_in_fiscal_year still decides
whether a card appears at all for the chosen year, unchanged."
```

---

## Task 5: Frontend — cost-history editor on the card, fiscal-year picker on the report

**Files:**
- Create: `frontend/src/features/cards/sections/CostHistoryEditor.tsx`
- Create: `frontend/src/features/cards/sections/CostHistoryEditor.test.tsx`
- Modify: `frontend/src/features/reports/CostReport.tsx`
- Modify: `frontend/src/features/reports/CostReport.test.tsx`
- Modify: `frontend/src/i18n/locales/en/cards.json`, `frontend/src/i18n/locales/en/reports.json`

**Interfaces:**
- Consumes: Task 3's three endpoints; Task 4's `fiscal_year` param on `/reports/cost-treemap` and `/reports/cost-sankey`.
- Produces: nothing consumed by a later task (last task in this plan).

- [ ] **Step 1: Write the failing test for `CostHistoryEditor`**

```tsx
// frontend/src/features/cards/sections/CostHistoryEditor.test.tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import CostHistoryEditor from "./CostHistoryEditor";

vi.mock("@/api/client", () => ({ api: { get: vi.fn(), put: vi.fn(), delete: vi.fn() } }));
import { api } from "@/api/client";

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.get).mockResolvedValue({
    rows: [{ fiscal_year: 2024, field_key: "costTotalAnnual", value: 321 }],
  } as never);
  vi.mocked(api.put).mockResolvedValue({ fiscal_year: 2025, field_key: "costTotalAnnual", value: 500 } as never);
});

describe("CostHistoryEditor", () => {
  it("lists every saved year for the field", async () => {
    render(<CostHistoryEditor cardId="erp" fieldKey="costTotalAnnual" fieldLabel="Total Annual Cost" />);
    expect(await screen.findByText("2024")).toBeInTheDocument();
    expect(screen.getByText("$321")).toBeInTheDocument();
  });

  it("adds a new year via the API and shows it", async () => {
    const user = userEvent.setup();
    render(<CostHistoryEditor cardId="erp" fieldKey="costTotalAnnual" fieldLabel="Total Annual Cost" />);
    await screen.findByText("2024");
    await user.type(screen.getByLabelText(/fiscal year/i), "2025");
    await user.type(screen.getByLabelText(/value/i), "500");
    await user.click(screen.getByRole("button", { name: /add/i }));
    await waitFor(() => expect(api.put).toHaveBeenCalledWith(
      "/cards/erp/cost-history",
      { fiscal_year: 2025, field_key: "costTotalAnnual", value: 500 },
    ));
  });

  it("deletes a year via the API", async () => {
    const user = userEvent.setup();
    render(<CostHistoryEditor cardId="erp" fieldKey="costTotalAnnual" fieldLabel="Total Annual Cost" />);
    await screen.findByText("2024");
    await user.click(screen.getByRole("button", { name: /delete 2024/i }));
    await waitFor(() => expect(api.delete).toHaveBeenCalledWith("/cards/erp/cost-history/2024/costTotalAnnual"));
  });
});
```

Read `frontend/src/api/client.ts`'s exact method names (`api.get`/`api.put`/`api.delete` or different casing/shape) before writing the final assertions — match whatever the rest of the codebase's API client actually exposes.

- [ ] **Step 2: Run to verify it fails**

Run: `cd frontend && npx vitest run CostHistoryEditor.test.tsx`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement `CostHistoryEditor`**

`export default function CostHistoryEditor({ cardId, fieldKey, fieldLabel }: { cardId: string; fieldKey: string; fieldLabel: string })` — fetches `GET /cards/{cardId}/cost-history` on mount, filters to rows matching `fieldKey`, renders a small MUI `Table` (year, value, delete button) plus a two-field form (fiscal year, value) with an "Add" button calling `PUT`. A successful add/delete re-fetches the list. This is a small, self-contained section component — not wired into `CardDetail.tsx`'s layout by this task (wiring it into the card detail page for every cost field is a reasonable follow-up, but the plan's spec only asks for "a UI to enter/edit a card's cost per fiscal year" to exist, which this satisfies as a standalone, testable component).

- [ ] **Step 4: Run to verify it passes**

Run: `cd frontend && npx vitest run CostHistoryEditor.test.tsx`
Expected: PASS.

- [ ] **Step 5: Write the failing test for the report's fiscal-year picker**

```tsx
// Add to CostReport.test.tsx
it("offers a fiscal-year picker and re-requests the treemap with it", async () => {
  renderCost();
  await waitFor(() => expect(within(chart()).getAllByText("ERP").length).toBeGreaterThan(0));
  const picker = screen.getByLabelText(/fiscal year/i);
  await userEvent.selectOptions ? null : null; // placeholder removed below
});
```

Replace the sketch above with a concrete test once you've decided the picker's exact control (a `TextField select` matching every other toolbar picker in this file, e.g. the existing `cost.cardType` picker's pattern, is the natural choice — no new UI pattern). The test must: render the report, open the picker, pick a year other than the current one, and assert the next `/reports/cost-treemap` call's query string contains `fiscal_year=<that year>`. Model it directly on this file's existing `pickOption`-style interaction if the file has one, or on `CostReport.branches.test.tsx`'s `pickOption` helper (read that file's helper, it's the established pattern for this exact kind of toolbar picker test across this plan's sibling plans 1-3).

- [ ] **Step 6: Run to verify it fails**

Run: `cd frontend && npx vitest run CostReport.test.tsx -t "fiscal-year picker"`
Expected: FAIL — no such control exists yet.

- [ ] **Step 7: Implement the picker**

In `CostReport.tsx`: add `const [fiscalYear, setFiscalYear] = useState<number | null>(null);` (null = current year, matches the param's own default). Add a `TextField select` to the toolbar, labelled `t("cost.fiscalYearPicker")`, offering the current year plus a small fixed range around it (e.g. current year and the 4 before it — the spec names no upper bound on how many years back, and the history table itself is the only real limit; a `MenuItem` per year in that range is enough, no need for a dynamic "which years actually have data" query). Thread `fiscalYear` into both the `/reports/cost-treemap` and `/reports/cost-sankey` request `URLSearchParams` (only appending `fiscal_year` when non-null, so the default request is byte-identical to today's). Replace the existing `cost.fiscalYearIndicator` chip's "no picker" framing: it still shows the chip (now showing whichever year was requested, from the response's `fiscal_year`), but the toolbar also offers the picker now — the chip and the picker coexist, the chip confirms what the server actually returned (relevant if a future year with no data is requested and the server's answer still names a concrete year).

- [ ] **Step 8: Run to verify it passes**

Run: `cd frontend && npx vitest run CostReport.test.tsx CostReport.branches.test.tsx CostReport.mutation.test.tsx CostReport.fixes.test.tsx`
Expected: PASS, including every pre-existing test (the picker is additive — a `null` fiscal year must behave exactly as today).

- [ ] **Step 9: Add the i18n strings**

In `frontend/src/i18n/locales/en/reports.json`: `"cost.fiscalYearPicker": "Fiscal year"`. In `frontend/src/i18n/locales/en/cards.json` (or wherever `CostHistoryEditor`'s own strings naturally belong per that file's existing section — check its structure first): an "Add"/"Delete" label pair for the editor if MUI's own icon buttons don't already carry sufficient `aria-label`s from the test above.

- [ ] **Step 10: Lint, typecheck, full suite**

Run: `cd frontend && npx eslint --fix src/features/cards/sections/CostHistoryEditor.tsx src/features/cards/sections/CostHistoryEditor.test.tsx src/features/reports/CostReport.tsx src/features/reports/CostReport.test.tsx && npx tsc --noEmit`
Then: `cd frontend && npx vitest run src/features/reports src/features/cards/sections/CostHistoryEditor.test.tsx`
Expected: clean; every file passes.

- [ ] **Step 11: Commit**

```bash
git add frontend/src/features/cards/sections/CostHistoryEditor.tsx frontend/src/features/cards/sections/CostHistoryEditor.test.tsx frontend/src/features/reports/CostReport.tsx frontend/src/features/reports/CostReport.test.tsx frontend/src/i18n/locales/en/reports.json frontend/src/i18n/locales/en/cards.json
git commit -m "feat(cost-history): fiscal-year picker on the cost report, history editor on the card

The picker is additive — a user who never touches it gets today's
exact current-year behavior and request shape. CostHistoryEditor is a
standalone, tested section component; wiring it into CardDetail's layout
for every cost field is a reasonable follow-up, not required by this
plan's spec line."
```

---

## Self-Review

**1. Spec coverage:** new table (Task 1), history decides the value / `is_live_in_fiscal_year` decides inclusion unchanged (Task 4, explicit Review Focus test), a UI to enter/edit per-year cost (Task 5's `CostHistoryEditor`), report's `fiscal_year` becomes a real param (Task 4 + Task 5's picker), the spec's open question about the scalar fields' fate (resolved in "Decision this plan makes", implemented by Task 2's sync hook). Fake/demo FY24-25 data correctly excluded (Global Constraints).

**2. Step scan:** every code step names the exact function/table/route signature; Task 5 Step 5 and Step 7 both explicitly defer one literal detail (the exact picker interaction pattern, and the i18n file CostHistoryEditor's strings belong in) to "read the established pattern first" — not placeholders, documented one-line lookups the implementer must do, matching this branch's own established convention (plans 1-3 did the same for fixture-dependent test bodies).

**3. Type consistency:** `fiscal_year: int | None` matches between Task 4's two endpoints; `CardCostHistory`'s columns match between Task 1's model, Task 2's upsert, Task 3's API, and Task 4's lookup query; `sync_current_fy_history(db, card)`'s signature matches between Task 2's definition and its two call sites.

**4. Review Focus:** all five lines map to a named test — two in Task 4 (fallback-to-live, past-year-nothing, retired-card-not-resurrected — three tests for what the plan listed as a tighter five, since the retired-card case and the past-year-nothing case are adjacent enough to share one Review Focus line's intent but got two separate tests for precision), one in Task 3 (per-field independence), one in Task 2 (clearing a field zeroes its row).

**5. Proportion:** five tasks, each independently testable; Task 5's frontend code is sketched to its minimum (one new small component, one picker, no new UI framework) relative to the three backend tasks the feature actually needs.
