# Initiative pages, PR A: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The card page and the PPM page of an Initiative show the same Health Summary and Risk Management, the card page gets the two-column Cost and Timeline layout and the Overview's cost bar, the status report text is limited to 250 characters, and the Plan Budget table gains FY, Category and Provider columns.

**Architecture:** Backend changes are two small ones in `backend/app/api/v1/ppm.py` and `backend/app/schemas/ppm.py` (a length limit, one payload key). Everything else is frontend: two shared components (`PpmHealthSummary` rewritten, `PpmRiskSummary` new) are used by the card page (through `CardDetailContent`) and by `PpmOverviewTab`; `PpmManageDialog` gains a `risks` tab; `PpmFinanceTree` changes columns. PR E already built the permission gates and the closed defaults: this plan builds on them.

**Tech Stack:** FastAPI + Pydantic, React 19 + MUI 6, ECharts through `components/charts/EChart.tsx`, Vitest + Testing Library, pytest.

**Spec:** `docs/superpowers/specs/2026-11-26-initiative-pages-design.md` (read it first: R1-R7, R10, R4, R17 and "Agent's calls" are what this plan implements; R8, R9, R20 are PR B).

## Global Constraints

- Branch `feat/initiative-pages-a`, from `main` after PR E (#94) merged; never commit to `main`. Author **English only**; the nine locales come from `/translate` before the PR. No new tables, no migration.
- Tests: each new or changed component, hook or helper gets a Vitest test next to the source (mock the API client with `vi.mock("@/api/client")`); a backend change gets an API test under `backend/tests/api/`. Run one test run at a time; never the whole suite; **never run mutation testing locally**. Backend test paths have no `backend/` prefix: `./scripts/test.sh tests/api/test_ppm.py -k <name>` from the repo root.
- Before every backend commit `cd backend && ruff format . && ruff check .`; before every frontend commit `cd frontend && npx tsc --noEmit -p . && npm run lint:biome`.
- No raw hex colours (tokens in `frontend/src/theme/tokens.ts`, chart colours through `useEChartsTheme`); all text through `useTranslation("ppm")`; MUI 6 only; filter-driven GETs through `useApiQuery`.
- Fail closed: a Manage button needs `ppm.manage` and `can_edit` (from `/cards/{id}/my-permissions`; `CLOSED_CARD_PERMISSIONS` until it answers); a cost visual, the Cost colour and any amount need `can_view_costs`.
- 250 characters, exactly: `summary`, `accomplishments`, `next_steps`. Active risk = status `open` or `mitigating`. Item column = today's label, no Description column. Health Summary and Risk Management only on the full card page and the PPM Overview.
- One version bump (`/VERSION`, minor) and one `CHANGELOG.md` entry; OpenAPI regenerated; user manual updated in English.

## Review Focus

- A user **without cost view** opens the card page and the Overview: no cost visual, no Cost colour, lock placeholders stay, Health Summary and Risk Management still render (Tasks 6, 8, 10).
- A **historical report longer than 250 characters**: changing only its date saves and sends no text; changing a text that stays over 250 is blocked (Tasks 1, 3).
- An Initiative with **no risks, no status report, or no work packages**: empty states, never `NaN`, a blank chart or a crash (Tasks 5, 6, 8).
- A budget line whose **Provider card the reader cannot see, or that has no Provider**: blank cell, no crash, totals unchanged; a cost without a budget can still be assigned (Task 11).
- **Legend click then redraw**: the donut total follows the visible series and the selection survives a re-render; hiding every series shows 0, not `NaN` (Task 5).

---

### Task 1: 250-character limit on status reports (backend)

**Files:**
- Modify: `backend/app/schemas/ppm.py` (`PpmStatusReportCreate`, `PpmStatusReportUpdate`)
- Modify: `docs/api/openapi.json` (regenerated)
- Test: `backend/tests/api/test_ppm.py`

**Interfaces:**
- Produces: `StatusText = Annotated[str | None, Field(max_length=250)]` in `schemas/ppm.py`, used by the three text fields of Create and Update. POST and PATCH answer 422 over 250; a field absent from a PATCH is not validated.

- [ ] **Step 1: Write the failing tests** in `test_ppm.py`: `test_create_report_rejects_a_text_over_250`, `test_create_report_accepts_exactly_250` (each of the three fields), `test_patch_report_rejects_a_changed_text_over_250`, `test_patch_report_without_texts_keeps_a_stored_text_over_250` (insert a report row with a 400-character `summary` through the factory, PATCH only `report_date`, assert 200 and the stored `summary` unchanged).
- [ ] **Step 2: Run** `./scripts/test.sh tests/api/test_ppm.py -k report`; expect the first and third to FAIL (200 instead of 422).
- [ ] **Step 3: Implement** `StatusText` and apply it to `summary`, `accomplishments`, `next_steps` of both schemas (`Annotated[str | None, Field(max_length=250)] = None`).
- [ ] **Step 4: Run** the same command; expect PASS, plus `tests/api/test_ppm_permission_matrix.py`.
- [ ] **Step 5: Regenerate OpenAPI** from `backend/`: `python scripts/dump_openapi.py ../docs/api/openapi.json`. The diff must contain only the `maxLength: 250` additions of these fields; if your local pydantic also adds `"pattern"` lines to Decimal fields, delete them (CI's pydantic does not emit them and its check fails otherwise).
- [ ] **Step 6: Commit** `feat(ppm): status report texts are limited to 250 characters`.

### Task 2: Budget `field_definitions` names the Provider field (backend)

**Files:**
- Modify: `backend/app/api/v1/ppm.py` (the `definitions[section]` builder, ~line 1213)
- Test: the existing API test file that asserts `field_definitions` (grep `field_definitions` under `backend/tests/api/`)

**Interfaces:**
- Produces: for `section == "budget"` the dict gains `"provider_field_key": str` (= `config.provider_source.budget_field_key`); the key is **omitted** when `provider_source` is `None`. Consumed by Task 11.

- [ ] **Step 1: Write the failing tests**: `test_budget_field_definitions_name_the_provider_field` (config with `provider_source`, assert the key equals the configured `budget_field_key`) and `test_budget_field_definitions_omit_the_key_without_a_provider_source`.
- [ ] **Step 2: Run** the file with `-k provider_field`; expect FAIL.
- [ ] **Step 3: Implement** in the builder, next to `"visible_columns"`; the cost_item section is unchanged.
- [ ] **Step 4: Run** it plus `tests/api/test_ppm_financials.py`; expect PASS. `field_definitions` is a free dict, so OpenAPI does not change.
- [ ] **Step 5: Commit** `feat(ppm): the budget field definitions name the Provider field`.

### Task 3: Status report editor counter and changed-fields PATCH (frontend)

**Files:**
- Modify: `frontend/src/features/ppm/StatusReportDialog.tsx`
- Test: `frontend/src/features/ppm/StatusReportDialog.test.tsx`
- Modify: `frontend/src/i18n/locales/en/ppm.json` (key `statusReportCounter`: `"{{label}} {{count}}/250"`)

**Interfaces:**
- Produces: exported `STATUS_TEXT_LIMIT = 250` from the dialog file (used by Task 6's tests). The three `TextField` labels read `Summary 120/250`; over 250 the counter takes the error colour (`error` prop) and a helper text; typing is never blocked.

- [ ] **Step 1: Write failing tests**: `shows the counter in each label`, `disables Save when a changed text exceeds 250`, `an untouched stored text over 250 does not block saving a new date and is not sent` (assert `api.patch` body has `report_date` and no `summary`), `sends only the changed fields in a PATCH`, `create sends all non-empty texts`.
- [ ] **Step 2: Run** `npx vitest run src/features/ppm/StatusReportDialog.test.tsx`; expect FAIL.
- [ ] **Step 3: Implement**: in edit mode compare each text with `report.*` and put only changed texts in the PATCH payload (the health fields and date keep today's rules); Save is disabled when a **changed** text is longer than 250; create mode is unchanged except for the limit.
- [ ] **Step 4: Run** the test file and `tsc`; expect PASS.
- [ ] **Step 5: Commit** `feat(ppm): status report editor counts to 250 and sends only what changed`.

### Task 4: Active-risk helpers, matrix size, legend event (frontend)

**Files:**
- Modify: `frontend/src/features/ppm/ppmRiskModel.ts`, `frontend/src/features/ppm/PpmRiskMatrix.tsx`, `frontend/src/components/charts/EChart.tsx`
- Test: `ppmRiskModel.test.ts`, `PpmRiskMatrix.test.tsx`, `frontend/src/components/charts/EChart.test.tsx`

**Interfaces:**
- Produces in `ppmRiskModel.ts`: `isActiveRisk(r: PpmRisk): boolean` (status `open` or `mitigating`); `activeRiskSummary(risks: readonly PpmRisk[]): { total: number; open: number; highOpen: number }` (`total` all risks, `open` active ones, `highOpen` active with `scoreBand === "high"`); `riskBandCounts(risks: readonly PpmRisk[]): Record<RiskScoreBand, number>` over the risks it is given; `riskStatusCounts(risks): { status: string; count: number }[]` for the five known statuses in order, zeros included. `riskSummary` is **not** changed.
- Produces: `PpmRiskMatrix` prop `size?: "default" | "compact"`; `EChart` prop `onLegendSelectChanged?: (params: { name: string; selected: Record<string, boolean> }) => void`, forwarded from ECharts' `legendselectchanged`.

- [ ] **Step 1: Write failing tests**: `activeRiskSummary counts open and mitigating, High open only among them`, `riskBandCounts and riskStatusCounts on an empty list are all zero`, `riskSummary still counts High in every status` (regression), `PpmRiskMatrix compact renders smaller cells`, `EChart forwards legendselectchanged to onLegendSelectChanged`.
- [ ] **Step 2: Run** the three files; expect FAIL.
- [ ] **Step 3: Implement** the helpers, the size prop (a smaller cell size, same colours) and the handler binding in the chart's event map.
- [ ] **Step 4: Run** the three files; expect PASS.
- [ ] **Step 5: Commit** `feat(ppm): active-risk helpers, compact risk matrix, chart legend event`.

### Task 5: `PpmRiskSummary` component (frontend)

**Files:**
- Create: `frontend/src/features/ppm/PpmRiskSummary.tsx`, `frontend/src/features/ppm/PpmRiskSummary.test.tsx`
- Modify: `frontend/src/i18n/locales/en/ppm.json` (keys for the titles Exposure, Status, Heat map and tiles Total, Open, High open)

**Interfaces:**
- Consumes: Task 4 helpers, `EChart`, `useEChartsTheme`, `PpmRiskMatrix`.
- Produces: `export default function PpmRiskSummary({ risks, onManage }: { risks: readonly PpmRisk[] | null | undefined; onManage?: () => void })`. Layout: a header row with the title "Risk Management" and, when `onManage` is given, a Manage button; the three tiles; three charts each under its question title. The donut option carries `legend.selected` kept in component state; the centre total is the sum of the visible bands. `null`/`undefined` shows a loading line; an empty list shows the empty state and no charts.

- [ ] **Step 1: Write failing tests** (mock `@/components/charts/EChart` to capture `option` and `onLegendSelectChanged`): `shows Total, Open and High open from the active risks`, `donut centre total is the active count`, `a legend click removes the band from the centre total and the selection survives a re-render`, `hiding every band shows 0`, `the status bars list the five statuses`, `Manage appears only with onManage and calls it`, `an empty list shows the empty state`.
- [ ] **Step 2: Run** `npx vitest run src/features/ppm/PpmRiskSummary.test.tsx`; expect FAIL (module missing).
- [ ] **Step 3: Implement** the component; band colours from `bandColor`, status colours from `riskStatusPaletteColor`.
- [ ] **Step 4: Run** the test and `tsc`; expect PASS.
- [ ] **Step 5: Commit** `feat(ppm): a shared Risk Management summary`.

### Task 6: `PpmHealthSummary` with report date and texts (frontend)

**Files:**
- Modify: `frontend/src/features/ppm/PpmHealthSummary.tsx`, `frontend/src/features/ppm/usePpmFinancials.ts`
- Test: `frontend/src/features/ppm/PpmHealthSummary.test.tsx` (new), `usePpmFinancials.test.ts`

**Interfaces:**
- Produces: `PpmHealthSummary({ report, costHealth, onManage }: { report: PpmStatusReport | null | undefined; costHealth?: string | null; onManage?: () => void })` showing: the three dots (Cost only when `costHealth` is non-null), the report date in the user's format (`useDateFormat().formatDate`), three read-only boxes Summary, Accomplishments, Next Steps (a box with no text shows an em dash), and a Manage button only when `onManage` is given. No report: the existing "No status reports yet" plus the Manage button.
- Produces: `usePpmLatestReport(initiativeId: string | null | undefined, refetchKey?: number)` in `usePpmFinancials.ts`: `GET /ppm/initiatives/{id}/reports`, returns `{ data: PpmStatusReport | null, loading, error }` with the report of the greatest `report_date`; same stale-id guard as `useInitiativeQuery`.

- [ ] **Step 1: Write failing tests**: `shows the report date and the three texts`, `omits the Cost dot without costHealth`, `shows the empty state and Manage with no report`, `Manage is absent without onManage`, `usePpmLatestReport returns the most recent report and ignores a previous initiative's answer`.
- [ ] **Step 2: Run** the two files; expect FAIL.
- [ ] **Step 3: Implement** both.
- [ ] **Step 4: Run** them and `tsc`; expect PASS.
- [ ] **Step 5: Commit** `feat(ppm): Health Summary shows the report date and texts`.

### Task 7: `risks` tab in `PpmManageDialog` (frontend)

**Files:**
- Modify: `frontend/src/features/ppm/PpmManageDialog.tsx`, `frontend/src/features/cards/CardDetailContent.tsx` (the `manageTab` type only)
- Test: `frontend/src/features/ppm/PpmManageDialog.test.tsx`

**Interfaces:**
- Produces: `tab: "cost" | "gantt" | "reports" | "risks"`; for `risks` the dialog fetches `GET /ppm/initiatives/{id}/risks` (`useApiQuery`, `keepPreviousData: false`) and renders the lazy `PpmRiskTab` with `{ initiativeId: card.id, risks, onRefresh: () => { refetch(); onChanged(); }, canEdit: true, initiativeName: card.name }`; title key `riskManagement` (add to `en/ppm.json` if missing; the PPM tab already uses one).

- [ ] **Step 1: Write failing tests**: `the risks tab fetches the risks and renders the risk tab`, `refreshing a risk refetches and calls onChanged`.
- [ ] **Step 2: Run** `npx vitest run src/features/ppm/PpmManageDialog.test.tsx`; expect FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** it and `tsc`; expect PASS.
- [ ] **Step 5: Commit** `feat(ppm): Manage popup has a Risk Management tab`.

### Task 8: Card page, Cost and Timeline groups (R1, R2, R6)

**Files:**
- Modify: `frontend/src/features/cards/sections/AttributeSection.tsx`, `frontend/src/features/cards/CardDetailContent.tsx`, `frontend/src/features/ppm/usePpmFinancials.ts`
- Delete: `frontend/src/features/ppm/PpmInitiativeFinancials.tsx` and its test
- Test: `AttributeSection` test file (grep `AttributeSection.test`), `CardDetailContent.test.tsx`

**Interfaces:**
- Produces on `AttributeSection`: `sideBySideGroups?: readonly string[]` (read mode: the fields of a listed group sit in two 50% columns, label above value; edit mode unchanged) and `renderGroupAside?: (fieldKeys: string[]) => ReactNode` (read mode: the group body becomes two columns, the fields stacked on the left, the returned node on the right).
- Produces: `usePpmCompletion(initiativeId, refetchKey?)` in `usePpmFinancials.ts`: `GET /ppm/initiatives/{id}/completion` returning `{ data: { completion: number; wbs_count: number } | undefined, loading, error }`.
- Consumes: `BudgetBar` from `ppmVisuals.tsx`; `card_comparison.derived` from `usePpmFinancials`.

- [ ] **Step 1: Write failing tests**: `a side-by-side group puts Budget and Actual Cost in two columns`, `a group aside renders on the right of the dates`, `edit mode keeps the standard grid`, in `CardDetailContent`: `the Cost group shows one Total budget bar for a user with cost view`, `shows no bar and keeps the lock placeholders without cost view`, `Completion shows next to the dates (the ring, or "no work packages")`.
- [ ] **Step 2: Run** the two files; expect FAIL.
- [ ] **Step 3: Implement** the two props; in `CardDetailContent` pass `sideBySideGroups={[t("ppm:summaryCost")]}` and a `renderGroupAside` for the Timeline group rendering `CompletionRing` (loading bar, error alert and the no-WBS text as the Overview does); replace `InitiativeFinancialSummary` with one `BudgetBar` Total (labels as today, the Overview's colours `theme.palette.primary.main` and `error.dark`, `derivedBudget`/`derivedActual` from `card_comparison`), rendered only with `perms.can_view_costs`; the `PpmInitiativeTimeline` bar stays under the dates; delete `PpmInitiativeFinancials` and its imports.
- [ ] **Step 4: Run** the two files, `PpmOverviewTab.test.tsx` and `tsc`; expect PASS.
- [ ] **Step 5: Commit** `feat(cards): Initiative card page shows Budget and Cost side by side, Completion by the dates, one cost bar`.

### Task 9: Health Summary and Risk Management on the card page (R3, R5)

**Files:**
- Modify: `frontend/src/features/cards/CardDetailContent.tsx`, `frontend/src/features/cards/CardDetail.tsx`, `frontend/src/components/CardDetailSidePanel.tsx` (only if it passes the new prop), `frontend/src/features/ppm/PpmProjectDetail.tsx` (Card Details tab: no new prop)
- Test: `CardDetailContent.test.tsx`, `CardDetail.test.tsx`

**Interfaces:**
- Produces: `CardDetailContent` prop `showPpmSummary?: boolean` (default `false`); `CardDetail.tsx` (the full card page) passes `true`; the side panel and the PPM Card Details tab do not. When true and `showInitiativeSummaries`, after the Cost group the content renders a **Health Summary** section (`PpmHealthSummary` with `usePpmLatestReport`, `costHealth` from `usePpmSchedule`, `onManage` only when `canManageCard`, opening `StatusReportDialog` for `initiativeId = card.id` in create mode) and a **Risk Management** section (`PpmRiskSummary` with a `usePpmRisks(card.id, revision)` fetch of `/ppm/initiatives/{id}/risks`, `onManage` only when `canManageCard`, opening `PpmManageDialog` with `tab: "risks"`). Health Summary leaves `InitiativeTimelineSummary`. All three fetches follow `scheduleRevision`; saving a report or closing the popup bumps it.

- [ ] **Step 1: Write failing tests**: `the full card page shows Health Summary and Risk Management for an Initiative`, `the side panel does not`, `Manage in Health Summary opens the status report editor and a save refreshes the summary`, `Manage in Risk Management opens the popup on the risks tab`, `both Manage buttons are absent without ppm.manage and can_edit`, `Risk Management renders for a user without cost view`.
- [ ] **Step 2: Run** the two files; expect FAIL.
- [ ] **Step 3: Implement**, with `usePpmRisks` in `usePpmFinancials.ts` (same shape and stale-id care as `usePpmLatestReport`).
- [ ] **Step 4: Run** the two files, `CardDetailSidePanel.test.tsx`, `PpmProjectDetail.permissions.test.tsx` and `tsc`; expect PASS.
- [ ] **Step 5: Commit** `feat(cards): Initiative card page shows Health Summary and Risk Management`.

### Task 10: PPM Overview layout (R7)

**Files:**
- Modify: `frontend/src/features/ppm/PpmOverviewTab.tsx`, `frontend/src/features/ppm/PpmProjectDetail.tsx`
- Test: `PpmOverviewTab.test.tsx`, `PpmProjectDetail.permissions.test.tsx`, `PpmProjectDetail.fixes.test.tsx`

**Interfaces:**
- Produces: `PpmOverviewTab` props `canEdit: boolean` and `onRefresh: () => void`. Single full-width column in the order Description (hidden when empty), Timeline with Completion to the right of the dates, Health Summary (`PpmHealthSummary` with `latestReport`, `onManage` only when `canEdit`, opening `StatusReportDialog`, `onRefresh` after save), Risk Management (`PpmRiskSummary` fed by the risks the page already loads, `onManage` only when `canEdit`, opening `PpmManageDialog` `risks`), then Financials as today (still hidden without `canViewCosts`). `PpmProjectDetail` passes `canEdit` (its own gate) and `onRefresh={loadData}` and sends the back arrow to `/ppm?tab=portfolio`.

- [ ] **Step 1: Write failing tests**: `the Overview renders Description, Timeline, Health Summary, Risk Management, Financials in that order`, `Manage buttons are absent when canEdit is false`, `saving a report calls onRefresh`, `the back arrow goes to /ppm?tab=portfolio`, `the Financials block is absent without cost view while Risk Management stays`.
- [ ] **Step 2: Run** the three files; expect FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the three files plus `PpmMobileLayout.test.tsx` and `tsc`; expect PASS.
- [ ] **Step 5: Commit** `feat(ppm): Overview layout with Health Summary and Risk Management`.

### Task 11: Plan Budget table (R10)

**Files:**
- Modify: `frontend/src/features/ppm/PpmFinanceTree.tsx`, `frontend/src/features/ppm/PpmFinancialRowForm.tsx` (only the `move` mode), `frontend/src/types/index.ts` (`provider_field_key?: string` on the budget definitions type)
- Test: `PpmFinanceTree.test.tsx`, `frontend/e2e/pml-financials.spec.ts`

**Interfaces:**
- Consumes: Task 2's `provider_field_key`; `budget.provider` (id, name, status) already in the payload.
- Produces: the budget table columns Item (label as today), FY, Category, Provider, Planned Budget, Cost Items, Remaining Budget, Invoiced, Remaining to invoice; Provider cell empty when `budget.provider` is null; the custom-field block skips the field named by `provider_field_key`; no `drive_file_move` on assigned cost items or invoices; the "Unassigned" cost items keep "Assign to budget" (`financeTree.assignCost`) through the `move` form; the "Initiative total invoiced" line is removed; `tableLayout` is no longer `fixed` and there is no `minWidth: 900`; the container scrolls horizontally (`overflowX: auto`), and with `expandAll` (print) it has no scroll container and the cells wrap.

- [ ] **Step 1: Write failing tests**: `the budget table shows FY, Category and Provider columns`, `the Provider cell is empty for a budget without a readable Provider`, `the custom field block skips the Provider field named by provider_field_key`, `assigned cost items and invoices have no move action`, `an unassigned cost item can still be assigned to a budget`, `no Initiative total invoiced line`, `expandAll renders without a scroll container`.
- [ ] **Step 2: Run** `npx vitest run src/features/ppm/PpmFinanceTree.test.tsx`; expect FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Update `frontend/e2e/pml-financials.spec.ts`**: the scenario that clicks `moveInvoice` moves the invoice through the API instead; keep its total assertions; scope row assertions to the owning table (the `financeTree.item` region). Do not run the e2e suite; run it only on an isolated demo stack if the owner asks.
- [ ] **Step 5: Run** the Vitest file, `PpmProjectReport.test.tsx`, `PpmCostTab.test.tsx` and `tsc`; expect PASS.
- [ ] **Step 6: Commit** `feat(ppm): Plan Budget table with FY, Category and Provider columns`.

### Task 12: Manual, translations, changelog, version

**Files:**
- Modify: `docs/guide/ppm.md`, `docs/guide/card-details.md` (English), `scripts/screenshots/pages.ts`, `CHANGELOG.md`, `VERSION`
- Then `/translate`.

**Interfaces:**
- Consumes: every task above.

- [ ] **Step 1: Update the English manual**: the Overview order and the Health Summary and Risk Management sections in `docs/guide/ppm.md` (Overview, card page and "initiative invoiced total" passages); the Initiative card page (side-by-side Budget and Actual Cost, Completion by the dates, Health Summary with the 250-character limit, Risk Management, one cost bar) in `docs/guide/card-details.md`; the Plan Budget columns and the removed move icon.
- [ ] **Step 2: Screenshots**: keep `41_ppm_overview`, `43_ppm_budget_costs`, `44_ppm_risk_management` valid; add a `pages.ts` entry for the Initiative card page (next sequential id, `filenames` for `en, de, fr, es, it, pt, zh, ru`) and reference it in the card-details page of every locale after `/translate`.
- [ ] **Step 3: Version and changelog**: `/VERSION` minor bump; `## [x.y.z] - <date>` in `CHANGELOG.md`: Added (Health Summary with report date and texts, Risk Management on the card page and the Overview, FY, Category and Provider columns), Changed (Budget and Actual Cost side by side, one cost bar on the card page, Completion by the dates, tables scroll with natural widths, the move icon is gone but unassigned costs can be assigned), Security (none).
- [ ] **Step 4: Run `/translate`**, then `scripts/docs/docker-docs.sh all` (the `docs-keeper` agent); expect exit 0 and 0 problems.
- [ ] **Step 5: Tests of the diff**: the touched backend files and the frontend files named in Tasks 1-11, one run at a time; then the review chain of `CLAUDE.md` (`code-simplifier`, `code-reviewer`, `security-reviewer`; VAPT not required: no route or table).
- [ ] **Step 6: Commit** `docs: Initiative pages manual, changelog and version`.
