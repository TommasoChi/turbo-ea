# Cost report fiscal-year picker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Plan status:** draft

**Goal:** The cost report's fiscal-year picker offers a Forecast year, names every fiscal year `FY26 - Current` / `FY27 - Forecast` / `FY25`…, and a non-current year lists every card with a cost recorded for it.

**Architecture:** The card-selection rule of the two cost endpoints moves into one plain service function that both call. The treemap and sankey responses also carry the *current* fiscal year, so the picker no longer anchors on the year that was requested. The frontend adds one naming helper beside `fiscalYearLabel` (which the PPM screens keep using) and rebuilds the picker and the trend chart around it.

**Tech Stack:** FastAPI + SQLAlchemy async + pytest (backend); React 19 + MUI 6 + Recharts + Vitest (frontend).

**Spec:** `docs/superpowers/specs/2026-10-29-cost-report-fiscal-year-picker-design.md` (approved 2026-10-29). Read it first.

**Agent types.** Each task names who runs it: `backend-dev`, `frontend-dev`, `docs-release` (all Sonnet implementers working in TDD), `translator` (the existing `/translate` agent), `verifier` (runs suites and reviews, one at a time because the test database is shared).

## Global Constraints

- Picker entries, top to bottom: `FY27 - Forecast`, `FY26 - Current`, `FY25`, `FY24`, `FY23`, `FY22` — six entries; "Current" keeps the empty value, so the current year is requested **without** `fiscal_year`.
- A fiscal year is written `FY` + the last two digits of the year it ends in, whatever the start month; the suffixes ` - Current` and ` - Forecast` are **not translated**.
- The new names apply everywhere the **cost report** names a fiscal year (picker, toolbar chip, parameters line, trend axis) and **nowhere in PPM**: `fiscalYearLabel` and `PpmCost*.tsx` stay untouched.
- `PUT /cards/{id}/cost-history` accepts `current - 5` … `current + 1`; same permission as today; no permission added.
- A year other than the current one lists every readable, `ACTIVE` card of the type with a **non-zero** history value for that year, whatever its lifecycle. The current year is unchanged (live attributes, cards live in the current fiscal year). Archived cards never appear.
- The trend chart shows when a year other than "Current" is selected; it covers the current year and the four before it, plus the forecast bar only while the forecast year is selected.
- PPM cost tab/charts, the card's cost-history editor and `sync_current_fy_history` are unchanged.
- Backend: `cd backend && ruff format . && ruff check .` before every commit. Frontend: `cd frontend && npx eslint <touched files>`; no hard-coded hex colours.
- English only in `en/*.json`, `docs/**/*.md` and specs; never open a non-English locale file (the `translator` task does that).
- **Test database:** `TEST_DB_REQUIRED=1 POSTGRES_PORT=5433` (the `turboea-test-test-db-1` container). One pytest process at a time — two at once deadlock.
- One commit per task; commit messages end with the `Co-Authored-By` line the session gives.

## Review Focus

1. A card retired two years ago with a recorded FY24 cost: it must be in the FY24 report and absent from the current-year report.
2. A card that only becomes Active next year, with a recorded FY27 cost: in the Forecast report, absent from the current one.
3. A history row with value `0` or no row: the card is not listed (no zero rows).
4. A saved report whose stored `fiscalYearParam` equals the current year, or a year outside the six offered: the page must open on "Current", not on a blank or shifted picker.
5. Selecting a past year used to re-centre the picker on that year (the options were derived from the *requested* year). The list must stay anchored on the current year whichever year is selected.

---

### Task 1: One selection rule for the cost endpoints

**Agent:** `backend-dev`

**Files:**
- Create: `backend/app/services/cost_report.py`
- Modify: `backend/app/api/v1/reports.py` (`cost_treemap`, `cost_sankey` / its inner `costed_cards`)
- Test: `backend/tests/services/test_cost_report.py` (new), `backend/tests/api/test_reports_cost_fiscal_year.py`

**Interfaces:**
- Produces: `async def cards_with_cost(db: AsyncSession, read_scope: CardReadScope, type_key: str, cost_field: str, target_fy: int, current_fy: int, fy_start: int) -> list[tuple[Card, float]]` — the cards of `type_key` that count in `target_fy`, each with its cost, in no particular order.
- Consumes: `CardReadScope.where(Card, mode="module")`, `is_live_in_fiscal_year(lifecycle, fy, fy_start)` (`app/services/lifecycle.py`), `cost_value` (`app/services/cost_value.py`), `CardCostHistory`.

- [ ] **Step 1: Write the failing service tests** in `tests/services/test_cost_report.py`, using the `create_card` / `create_card_type` helpers and `CardCostHistory(card_id, fiscal_year, field_key, value)` rows. Cases (names are the test names): `test_current_year_uses_live_attributes_of_cards_live_now`; `test_current_year_leaves_out_a_card_retired_before_it`; `test_past_year_includes_a_card_retired_since_if_it_has_a_cost_for_that_year`; `test_forecast_year_includes_a_card_that_becomes_active_next_year`; `test_a_year_without_a_row_or_with_value_zero_lists_nothing`; `test_archived_cards_never_appear`; `test_a_card_the_reader_may_not_see_is_left_out` (hide the type through `card_types.role_permissions` as in `tests/api/test_todos.py::TestCreateTodoOnACardTheCallerCannotRead._hide_from_viewer`, then `PermissionService.invalidate_type_permission_cache()`); `test_only_the_requested_field_counts`.
- [ ] **Step 2: Run** `cd backend && TEST_DB_REQUIRED=1 POSTGRES_PORT=5433 python -m pytest tests/services/test_cost_report.py -q -p no:warnings`. Expected: collection error / FAIL (module missing).
- [ ] **Step 3: Implement `cards_with_cost`** in `backend/app/services/cost_report.py`. For `target_fy == current_fy`: today's logic (ACTIVE + read scope, then `is_live_in_fiscal_year`, cost from `cost_value(attributes[cost_field])`, drop zero). For any other year: one query joining `Card` to `CardCostHistory` on `(card_id, target_fy, cost_field)` with `value != 0`, filtered `Card.type == type_key`, `Card.status == "ACTIVE"` and the read scope — **no lifecycle filter**. Plain function, no decorators.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Add API tests** to `tests/api/test_reports_cost_fiscal_year.py`, for both `/reports/cost-treemap` and `/reports/cost-sankey`: `test_a_retired_card_with_history_appears_in_that_past_year`, `test_a_card_active_from_next_year_appears_in_the_forecast_year`, `test_the_current_year_is_unchanged`. Run; expected FAIL for the first two.
- [ ] **Step 6: Switch `cost_treemap` and `cost_sankey`** to `cards_with_cost`; keep every response key as is (the treemap's group relations are built from the returned cards' ids). Run `tests/api/test_reports_cost_fiscal_year.py tests/api/test_reports_extended.py tests/services/test_cost_report.py`. Expected: PASS. Run `tests/api/test_card_read_scope_guard.py` too (the static scan must still pass).
- [ ] **Step 7: Commit** `fix(reports): a past or forecast year lists the cards with a cost recorded for it`.

### Task 2: The responses name the current fiscal year

**Agent:** `backend-dev`

**Files:**
- Modify: `backend/app/api/v1/reports.py` (the three `return` dicts of `cost_treemap` and `cost_sankey`)
- Test: `backend/tests/api/test_reports_cost_fiscal_year.py`

**Interfaces:**
- Produces: both responses gain `"current_fiscal_year": int` — the fiscal year containing today, independent of `fiscal_year`, which stays the *requested* year. Task 5 relies on this key.

- [ ] **Step 1: Write the failing tests** `test_the_response_names_the_current_year_even_when_another_is_requested` (treemap and sankey, with and without `?fiscal_year=`): `current_fiscal_year == current_fiscal_year(start)` while `fiscal_year` equals the requested year; include a `fiscalYearStart` of `10` case via `_set_fiscal_year_start`.
- [ ] **Step 2: Run** `tests/api/test_reports_cost_fiscal_year.py -k current_year`. Expected: FAIL (`KeyError`).
- [ ] **Step 3: Add** `"current_fiscal_year": fy` to every `return` of the two endpoints (including the sankey early return when there are no costed cards).
- [ ] **Step 4: Run** the file. Expected: PASS. Then `python scripts/dump_openapi.py` from the repo root; `git diff docs/api/openapi.json` should show no change (responses are untyped dicts) — if it does, commit it.
- [ ] **Step 5: Commit** `feat(reports): cost responses carry the current fiscal year`.

### Task 3: The history accepts the forecast year

**Agent:** `backend-dev`

**Files:**
- Modify: `backend/app/services/fiscal_year.py` (`fiscal_year_window`, new constant), `backend/app/api/v1/cost_history.py` (message only if it hard-codes the bounds)
- Test: `backend/tests/api/test_cost_history_api.py` (lines ~92–110), `backend/tests/services/test_fiscal_year.py`

**Interfaces:**
- Produces: `FISCAL_YEAR_LOOKAHEAD = 1`; `fiscal_year_window(start_month) -> (current - FISCAL_YEAR_LOOKBACK, current + FISCAL_YEAR_LOOKAHEAD)`.

- [ ] **Step 1: Update/write the failing tests:** `test_the_next_year_is_accepted` (`PUT` with `current + 1` → 200), `test_two_years_ahead_is_rejected` (`current + 2` → 422), and in `tests/services/test_fiscal_year.py` `test_the_window_runs_from_five_years_back_to_next_year`. Remove `current + 1` from the rejected parametrisation of `test_a_year_outside_the_five_year_window_is_rejected`.
- [ ] **Step 2: Run** `tests/api/test_cost_history_api.py tests/services/test_fiscal_year.py`. Expected: FAIL on the new tests.
- [ ] **Step 3: Implement** the constant and the window; update the comment above `FISCAL_YEAR_LOOKBACK`.
- [ ] **Step 4: Run** both files. Expected: PASS. Run `ruff format . && ruff check .`.
- [ ] **Step 5: Commit** `feat(cost-history): the history accepts next fiscal year (forecast)`.

### Task 4: The FY naming helper

**Agent:** `frontend-dev`

**Files:**
- Modify: `frontend/src/lib/fiscalYear.ts`
- Test: `frontend/src/lib/fiscalYear.test.ts` (create if absent)

**Interfaces:**
- Produces: `export function costFiscalYearName(fy: number, currentFy: number): string` → `"FY26 - Current"` when `fy === currentFy`, `"FY27 - Forecast"` when `fy === currentFy + 1`, otherwise `"FY25"`; two-digit, zero-padded (`2005` → `FY05`). Pure, no `t`. Also `export function costFiscalYearOptions(currentFy: number): { value: number | null; label: string }[]` → forecast, current (`value: null`), then `currentFy - 1 … currentFy - 4`.
- `fiscalYearLabel` is **not** changed.

- [ ] **Step 1: Write the failing tests:** `names the current year with Current` (`costFiscalYearName(2026, 2026)` = `"FY26 - Current"`), `names next year Forecast` (`2027, 2026` → `"FY27 - Forecast"`), `names a past year bare` (`2024, 2026` → `"FY24"`), `pads a single digit` (`2005, 2005` → `"FY05 - Current"`), `lists forecast, current then four past years` (`costFiscalYearOptions(2026)` labels = `["FY27 - Forecast","FY26 - Current","FY25","FY24","FY23","FY22"]`, values = `[2027, null, 2025, 2024, 2023, 2022]`), `leaves fiscalYearLabel alone` (`fiscalYearLabel(2026, 10, t)` still `"FY 2025–2026"`).
- [ ] **Step 2: Run** `cd frontend && npx vitest run src/lib/fiscalYear.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the two functions beside `fiscalYearLabel`.
- [ ] **Step 4: Run** the file. Expected: PASS.
- [ ] **Step 5: Commit** `feat(reports): FY naming helper for the cost report`.

### Task 5: Picker, chip and parameters line

**Agent:** `frontend-dev`

**Files:**
- Modify: `frontend/src/features/reports/CostReport.tsx` (types `CostTreemapResponse` / `CostSankeyResponse`; `fiscalYearOptions`; picker `MenuItem`s ~885–895; chip ~900–910; parameters line ~585–590; saved-config load ~363), `frontend/src/i18n/locales/en/reports.json` (`cost.fiscalYearIndicator`, `cost.fiscalYearPickerCurrent`)
- Test: `frontend/src/features/reports/CostReport.test.tsx`

**Interfaces:**
- Consumes: `current_fiscal_year` in both responses (Task 2); `costFiscalYearOptions`, `costFiscalYearName` (Task 4).
- Produces: `currentFiscalYear: number` state in `CostReport`, passed to the trend chart (Task 6).

- [ ] **Step 1: Write/adjust the failing tests** in `CostReport.test.tsx` (the mocked responses gain `current_fiscal_year: 2026`): `offers forecast, current and four past years in that order`; `selecting current requests no fiscal_year`; `selecting the forecast requests fiscal_year=2027`; `keeps the list anchored on the current year after picking a past year` (the options are the same after choosing FY24); `the chip and the parameters line use the new names` (chip reads `Fiscal year: FY26 - Current`; with year 2025 selected, `Fiscal year: FY25`); `a saved fiscalYearParam equal to the current year opens on Current`; `a saved fiscalYearParam outside the offered years opens on Current`. Replace the two old chip assertions (`"Current fiscal year: FY 2026"`, `"…FY 2025–2026"`) and the picker test that picks `option { name: "2025" }` (now `FY25`).
- [ ] **Step 2: Run** `cd frontend && npx vitest run src/features/reports/CostReport.test.tsx`. Expected: FAIL on the new/changed tests.
- [ ] **Step 3: Implement.** Add `current_fiscal_year?: number` to the two response interfaces and keep it in `currentFiscalYear` state (fallback `new Date().getFullYear()` until the first response). Build the picker from `costFiscalYearOptions(currentFiscalYear)`; the "Current" entry keeps value `""`; drop `cost.fiscalYearPickerCurrent`'s role as a separate entry. After the first response and when loading a saved config, set `fiscalYearParam` to `null` if it equals `currentFiscalYear` or is not among the offered values. `minFiscalYearOption` (the earliest year, which skips the year-over-year fetch) must ignore the `null` "Current" entry; the delta and year-over-year requests otherwise stay as they are (for the forecast year, FY27 against FY26). Chip and parameters line show `costFiscalYearName(fiscalYear.year, currentFiscalYear)`; change `cost.fiscalYearIndicator` to `"Fiscal year: {{fy}}"`.
- [ ] **Step 4: Run** the file. Expected: PASS. Run `npx eslint src/features/reports/CostReport.tsx src/features/reports/CostReport.test.tsx`.
- [ ] **Step 5: Commit** `feat(reports): fiscal-year picker with a forecast year and FY names`.

### Task 6: Trend chart

**Agent:** `frontend-dev`

**Files:**
- Modify: `frontend/src/features/reports/CostTrendChart.tsx`, `frontend/src/features/reports/CostReport.tsx` (the `<CostTrendChart>` call ~955)
- Test: `frontend/src/features/reports/CostTrendChart.test.tsx`, `frontend/src/features/reports/CostReport.test.tsx` (`CostReport trend chart` block)

**Interfaces:**
- Consumes: `costFiscalYearName` (Task 4), `currentFiscalYear` (Task 5).
- Produces: `CostTrendChart` props become `{ cardTypeKey: string; years: number[]; currentFiscalYear: number }`; `years` is ascending; the x axis shows `costFiscalYearName(year, currentFiscalYear)` (`tickFormatter`); each row's `fiscalYear` stays numeric.

- [ ] **Step 1: Write the failing tests:** in `CostTrendChart.test.tsx` `labels the axis with FY names` (a `XAxis` mock capturing `tickFormatter`; `tickFormatter(2027)` → `"FY27 - Forecast"`, `tickFormatter(2025)` → `"FY25"`), and keep the existing fetch/abort tests passing with the new prop. In `CostReport.test.tsx`: `trend shows the current year and four past years, oldest first` (picking FY25 → `CostTrendChart` rows for 2022…2026), `trend adds the forecast bar only when the forecast year is selected` (picking FY27 → rows 2022…2027), `trend is not shown on Current`.
- [ ] **Step 2: Run** both files. Expected: FAIL.
- [ ] **Step 3: Implement** the prop and `tickFormatter`; in `CostReport` pass `years` = `[current-4 … current]` plus `current+1` when `fiscalYearParam === current+1`.
- [ ] **Step 4: Run** both files and eslint on the touched files. Expected: PASS.
- [ ] **Step 5: Commit** `feat(reports): trend chart uses FY names and adds the forecast bar on demand`.

### Task 7: Docs, rule, changelog, version

**Agent:** `docs-release`

**Files:**
- Modify: `docs/guide/reports.md` (section "Fiscal year", ~167–177), `.claude/rules/card-flags-cost-eol.md` (the cost-report bullet that says there is "no year parameter"), `CHANGELOG.md`, `VERSION`
- No change: `scripts/screenshots/pages.ts` (entry `34_report_cost` already exists; re-capturing needs the demo instance and is **not** part of this plan).

- [ ] **Step 1: Rewrite the docs section** (English): the picker and its six entries; what Current and Forecast mean; that forecast figures are typed in the card's cost history (next fiscal year only); which cards appear in a past/forecast year; remove the stale "There is no picker for other years" sentence.
- [ ] **Step 2: Update the rule bullet** in `.claude/rules/card-flags-cost-eol.md`: the reports take an optional `fiscal_year`; the current year is live and live-gated, other years list cards by recorded cost (`services/cost_report.py`); both responses carry `current_fiscal_year`; guard tests `tests/services/test_cost_report.py`, `tests/api/test_reports_cost_fiscal_year.py`.
- [ ] **Step 3: Bump `VERSION` to `2.179.10`** and add `## [2.179.10] - 2026-10-29` to `CHANGELOG.md` (Added: forecast year in the picker, FY names; Changed: past-year reports list every card with a recorded cost; the history accepts next year).
- [ ] **Step 4: Run** `cd backend && python -m pytest tests/services/test_agent_instructions_budget.py -q -p no:warnings` (CLAUDE.md untouched; rules budget) and, if `mkdocs` is installed, `mkdocs build --strict`.
- [ ] **Step 5: Commit** `docs: cost-report fiscal-year picker, version 2.179.10`.

### Task 8: Translations, verification, review

**Agent:** `translator`, then `verifier`

- [ ] **Step 1 (`translator`):** run `/translate`. Gaps: `cost.fiscalYearIndicator` (changed English sentence — name it explicitly, the tool finds missing keys only) and the docs page siblings. Expected: parity tests pass.
- [ ] **Step 2 (`verifier`):** run `/graphify . --update --mode deep`, then, from `backend/`, `TEST_DB_REQUIRED=1 POSTGRES_PORT=5433 python -m pytest tests -q -p no:warnings --tb=short -rf` once, alone (not `./scripts/test.sh`: the test database already runs on this machine). Report every failure as "mine" or "environmental" (Windows: `time.tzset`, `libcst`/mutmut); fix "mine".
- [ ] **Step 3 (`verifier`):** `cd frontend && npx tsc --noEmit -p . && npx vitest run src/features/reports src/lib src/i18n`.
- [ ] **Step 4 (`verifier`):** `ponytail-review` on `git diff main...HEAD`, apply Must/Should (each with a test), then the `security-review` skill (a hook blocks `gh pr create` without it in the last 30 minutes).
- [ ] **Step 5:** stop and report to the user: what ran, what did not (no mutation run locally; screenshots not re-captured). **Push and PR only after the user says so.**
