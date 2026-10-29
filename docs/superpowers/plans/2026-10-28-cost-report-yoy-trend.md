# Cost Report: Year-over-Year Trend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Once a fiscal year is picked (the fiscal-year-history plan's picker), show the trend: a stacked bar chart by cost category, a delta badge on each Treemap rectangle against the current year, and a YoY% column in the table.

**Architecture:** Frontend-only — `GET /reports/cost-treemap` already accepts `fiscal_year`/`cost_field`/`type` and already returns an aggregate `total` (confirmed on this branch, fiscal-year-history plan). All three deliverables are built by calling that same endpoint a few more times with different parameters and combining the results client-side, not by adding a new backend aggregate: the stacked bar chart calls it once per (fiscal year × cost category field), the delta badge calls it once more for the current year to diff against, the YoY% column calls it once more for the previous year to diff against.

**Tech Stack:** React, Recharts (`BarChart`/`Bar`, already a project dependency alongside the existing `Treemap`/`Sankey`).

**Spec:** `docs/superpowers/specs/2026-10-28-cost-report-sankey-design.md` (section "Year-over-year trend, once fiscal-year history exists")

## Global Constraints

- No backend change — every data need is met by existing `/reports/cost-treemap` calls with different `fiscal_year`/`cost_field` values.
- The three cost-category fields are `softwareLicensingCost`, `applicationManagementServicesCost`, `infrastruttureCost` — the same three fields the IT Component cost-parity plan (plan 1) made identical between `Application` and `ITComponent`.
- All three deliverables apply only once a **past** fiscal year is selected (`fiscalYearParam != null` in `CostReport.tsx`'s existing state) — there is nothing to compare the current year against itself, so none of the three render anything extra when `fiscalYearParam` is `null`.
- New frontend strings go in `frontend/src/i18n/locales/en/reports.json` — run `/translate` before the PR.
- This is the last plan on `feature/sankey-diagram-cost-report` — invoke `superpowers:finishing-a-development-branch` once this plan's final review is clean.

## Review Focus

- A card type whose cost fields don't include all three categories (e.g. a future card type with just `costTotalAnnual` and none of the three category fields): the stacked bar chart must render an empty/zero series for that year rather than erroring on a field that doesn't exist — Task 1's test `test_stacked_bar_handles_a_type_with_no_category_fields`.
- The very first year in the picker's range (no earlier year exists to diff against): the YoY% column must show the existing empty-value sentinel for that one year's rows, not `NaN%`/`Infinity%` or a crash — Task 3's test `test_yoy_percent_shows_the_empty_sentinel_when_there_is_no_prior_year`.
- A card present in the selected year's treemap but **absent** from the current year's (e.g. created after the current year began — impossible by the lifecycle rule, but a card retired *before* the current year and only live in the selected past year is the real case): the delta badge must show "new" / 100% growth from a zero baseline, not divide by zero — Task 2's test `test_delta_badge_handles_a_card_with_no_current_year_baseline`.
- Previous-year total is zero but selected-year total is nonzero (a category with no spend last year, spend this year): the YoY% formula `selected/previous - 1` divides by zero — must show the same empty sentinel, not `Infinity%` — Task 3's test `test_yoy_percent_shows_the_empty_sentinel_when_the_prior_year_total_is_zero` (same guard as the no-prior-year case, one shared code path, two tests pinning two different ways to reach it).
- Switching `groupBy` while a past fiscal year is active: the stacked bar chart is a report-level aggregate (one bar per year, not per group) and must keep working unchanged — grouping is a table/treemap-only concept, confirmed by rereading `CostReport.tsx`'s existing `groups` memo, which the chart does not consume — Task 1's test `test_stacked_bar_is_unaffected_by_group_by`.

---

## File Structure

- Create: `frontend/src/features/reports/CostTrendChart.tsx` — the stacked bar chart, a small standalone component (own data-fetching effect) so `CostReport.tsx` stays uncluttered.
- Create: `frontend/src/features/reports/CostTrendChart.test.tsx`.
- Modify: `frontend/src/features/reports/CostReport.tsx` — renders `CostTrendChart` above the Treemap when `fiscalYearParam != null`; Treemap delta badge; table YoY% column.
- Modify: `frontend/src/features/reports/CostReport.test.tsx` and `CostReport.branches.test.tsx` — delta badge + YoY% column tests (`CostTrendChart` gets its own test file above).
- Modify: `frontend/src/i18n/locales/en/reports.json`.

---

## Task 1: `CostTrendChart` — stacked bar chart by cost category

**Files:**
- Create: `frontend/src/features/reports/CostTrendChart.tsx`
- Create: `frontend/src/features/reports/CostTrendChart.test.tsx`

**Interfaces:**
- Consumes: `GET /reports/cost-treemap?type=&cost_field=&fiscal_year=` (existing, `{items, total, fiscal_year, fiscal_year_start}`).
- Produces: `export default function CostTrendChart({ cardTypeKey, years }: { cardTypeKey: string; years: number[] })` — fetches, for each year in `years` × each of the three category fields, one `cost-treemap` call, and renders a Recharts `BarChart` with one `Bar` per category (`stackId="cost"`), x-axis = fiscal year. `years` is the caller's responsibility (Task 4 is not in this plan — `CostReport.tsx` passes the same range its own fiscal-year picker already offers, per Task 4 below).

- [ ] **Step 1: Write the failing tests**

```tsx
// CostTrendChart.test.tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import CostTrendChart from "./CostTrendChart";

vi.mock("@/api/client", () => ({ api: { get: vi.fn() } }));
import { api } from "@/api/client";

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.get).mockImplementation((path: string) => {
    const p = new URLSearchParams(path.split("?")[1]);
    const field = p.get("cost_field");
    const fy = p.get("fiscal_year");
    const totals: Record<string, number> = {
      "softwareLicensingCost:2025": 100,
      "applicationManagementServicesCost:2025": 50,
      "infrastruttureCost:2025": 20,
      "softwareLicensingCost:2026": 120,
      "applicationManagementServicesCost:2026": 60,
      "infrastruttureCost:2026": 25,
    };
    return Promise.resolve({ items: [], total: totals[`${field}:${fy}`] ?? 0 }) as never;
  });
});

describe("CostTrendChart", () => {
  it("fetches each category field for each year and renders a bar per year", async () => {
    render(<CostTrendChart cardTypeKey="Application" years={[2025, 2026]} />);
    await waitFor(() => expect(api.get).toHaveBeenCalledTimes(6)); // 2 years x 3 fields
    expect(screen.getByTestId("cost-trend-chart")).toBeInTheDocument();
  });

  it("handles a type with no category fields by rendering a zero series, not erroring", async () => {
    vi.mocked(api.get).mockResolvedValue({ items: [], total: 0 } as never);
    render(<CostTrendChart cardTypeKey="Team" years={[2025]} />);
    expect(await screen.findByTestId("cost-trend-chart")).toBeInTheDocument();
  });

  it("is unaffected by group_by — never sends a group_by param", async () => {
    render(<CostTrendChart cardTypeKey="Application" years={[2025]} />);
    await waitFor(() => expect(api.get).toHaveBeenCalled());
    const calls = vi.mocked(api.get).mock.calls.map(([p]) => String(p));
    for (const c of calls) expect(c).not.toContain("group_by");
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd frontend && npx vitest run CostTrendChart.test.tsx`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement `CostTrendChart`**

Fetch all `years.length * 3` requests in parallel (`Promise.all`), build one data row per year (`{fiscalYear, softwareLicensingCost, applicationManagementServicesCost, infrastruttureCost}`, each value the matching response's `total`), render:
```tsx
<ResponsiveContainer width="100%" height={300} data-testid="cost-trend-chart">
  <BarChart data={rows}>
    <XAxis dataKey="fiscalYear" />
    <YAxis />
    <Bar dataKey="softwareLicensingCost" stackId="cost" fill="#1976d2" />
    <Bar dataKey="applicationManagementServicesCost" stackId="cost" fill="#42a5f5" />
    <Bar dataKey="infrastruttureCost" stackId="cost" fill="#90caf9" />
    <RTooltip />
    <Legend />
  </BarChart>
</ResponsiveContainer>
```
(`data-testid="cost-trend-chart"` goes on the outer wrapping `Box`, not `ResponsiveContainer` itself, which doesn't forward unknown DOM props — check `CostReport.branches.test.tsx`'s own recharts mock for how this codebase's tests already handle that, and place the testid wherever that mock actually renders a container to find).

- [ ] **Step 4: Run to verify they pass**

Run: `cd frontend && npx vitest run CostTrendChart.test.tsx`
Expected: PASS.

- [ ] **Step 5: Lint & typecheck**

Run: `cd frontend && npx eslint --fix src/features/reports/CostTrendChart.tsx src/features/reports/CostTrendChart.test.tsx && npx tsc --noEmit`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/features/reports/CostTrendChart.tsx frontend/src/features/reports/CostTrendChart.test.tsx
git commit -m "feat(reports): add CostTrendChart — stacked bar by cost category per fiscal year

Not wired into CostReport.tsx yet (Task 4)."
```

---

## Task 2: Treemap delta badge

**Files:**
- Modify: `frontend/src/features/reports/CostReport.tsx`
- Modify: `frontend/src/features/reports/CostReport.branches.test.tsx`

**Interfaces:**
- Consumes: the existing `fiscalYearParam`/`cardTypeKey`/`costField` state and `TreemapContent` component in `CostReport.tsx`.
- Produces: `TreemapContent` gains an optional `deltaPct?: number` prop, rendered as a small colored badge (green ▲ for positive, red ▼ for negative) in the cell's top-right corner when present.

- [ ] **Step 1: Write the failing tests**

```tsx
// Add to CostReport.branches.test.tsx, inside describe("CostReport treemap", ...)
it("shows a delta badge comparing the selected past year to the current year", async () => {
  saved.config = { view: "chart", fiscalYearParam: 2024 };
  mockApi.on("get", "/reports/cost-treemap*", (path: string) => {
    const p = new URLSearchParams(path.split("?")[1]);
    return p.get("fiscal_year") === "2024"
      ? { items: [{ id: "erp", name: "ERP", cost: 600 }], total: 600, fiscal_year: 2024 }
      : { items: [{ id: "erp", name: "ERP", cost: 500 }], total: 500, fiscal_year: 2026 };
  });
  renderCost();
  await screen.findByTestId("treemap");
  expect(screen.getByText(/\+20%/)).toBeInTheDocument(); // (600-500)/500
});

it("handles a card with no current-year baseline as 100% growth from zero, not a crash", async () => {
  saved.config = { view: "chart", fiscalYearParam: 2024 };
  mockApi.on("get", "/reports/cost-treemap*", (path: string) => {
    const p = new URLSearchParams(path.split("?")[1]);
    return p.get("fiscal_year") === "2024"
      ? { items: [{ id: "old", name: "Old", cost: 300 }], total: 300, fiscal_year: 2024 }
      : { items: [], total: 0, fiscal_year: 2026 };
  });
  renderCost();
  await screen.findByTestId("treemap");
  expect(screen.getByText(/new/i)).toBeInTheDocument();
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd frontend && npx vitest run CostReport.branches.test.tsx -t "delta badge"`
Expected: FAIL — no badge rendered.

- [ ] **Step 3: Implement**

When `fiscalYearParam != null`, fetch a second `cost-treemap` call with the same `type`/`cost_field` and `fiscal_year` omitted (current year), building an `id -> cost` map from its `items`. Pass each treemap datum's `deltaPct = baseline > 0 ? (cost - baseline) / baseline : null` (null when the baseline is 0/missing, rendered as the literal string "new" per the second test, not a percentage) into `TreemapContent`.

- [ ] **Step 4: Run to verify they pass**

Run: `cd frontend && npx vitest run CostReport.branches.test.tsx`
Expected: PASS, including every pre-existing test in the file.

- [ ] **Step 5: Lint & typecheck**

Run: `cd frontend && npx eslint --fix src/features/reports/CostReport.tsx src/features/reports/CostReport.branches.test.tsx && npx tsc --noEmit`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/features/reports/CostReport.tsx frontend/src/features/reports/CostReport.branches.test.tsx
git commit -m "feat(reports): treemap delta badge against the current fiscal year"
```

---

## Task 3: Table YoY% column

**Files:**
- Modify: `frontend/src/features/reports/CostReport.tsx`
- Modify: `frontend/src/features/reports/CostReport.branches.test.tsx`

**Interfaces:**
- Consumes: the existing table-rendering block in `CostReport.tsx` (the one Task 3 of the custom-columns plan already extended with `extraColumns`).
- Produces: nothing consumed by a later task in this plan.

- [ ] **Step 1: Write the failing tests**

```tsx
// Add to CostReport.branches.test.tsx, inside describe("CostReport table", ...)
it("adds a YoY % column comparing the selected year to the prior year", async () => {
  saved.config = { view: "table", fiscalYearParam: 2025 };
  mockApi.on("get", "/reports/cost-treemap*", (path: string) => {
    const p = new URLSearchParams(path.split("?")[1]);
    return p.get("fiscal_year") === "2024"
      ? { items: [{ id: "erp", name: "ERP", cost: 500 }], total: 500 }
      : { items: [{ id: "erp", name: "ERP", cost: 600 }], total: 600 };
  });
  renderCost();
  await screen.findByRole("table");
  expect(screen.getByText("+20.0%")).toBeInTheDocument();
});

it("shows the empty sentinel for the earliest year with no prior-year data", async () => {
  saved.config = { view: "table", fiscalYearParam: 2020 }; // picker's own earliest offered year
  mockApi.on("get", "/reports/cost-treemap*", { items: [{ id: "erp", name: "ERP", cost: 500 }], total: 500 });
  renderCost();
  await screen.findByRole("table");
  expect(screen.getAllByText("—").length).toBeGreaterThan(0);
});

it("shows the empty sentinel instead of Infinity% when the prior year's total was zero", async () => {
  saved.config = { view: "table", fiscalYearParam: 2025 };
  mockApi.on("get", "/reports/cost-treemap*", (path: string) => {
    const p = new URLSearchParams(path.split("?")[1]);
    return p.get("fiscal_year") === "2024"
      ? { items: [], total: 0 }
      : { items: [{ id: "erp", name: "ERP", cost: 600 }], total: 600 };
  });
  renderCost();
  await screen.findByRole("table");
  expect(screen.queryByText(/Infinity/)).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd frontend && npx vitest run CostReport.branches.test.tsx -t "YoY"`
Expected: FAIL — no column rendered.

- [ ] **Step 3: Implement**

When `fiscalYearParam != null`, fetch a second `cost-treemap` call with `fiscal_year: fiscalYearParam - 1` (same `type`/`cost_field`), building an `id -> cost` map. Add a `TableCell` (header `t("cost.yoyPercent")`) after the existing "% of Total" column, present only when `fiscalYearParam != null`: `prior > 0 ? \`${pct >= 0 ? "+" : ""}${(pct * 100).toFixed(1)}%\` : EMPTY_VALUE` where `pct = (cost - prior) / prior`. Reuse `EMPTY_VALUE` ("—") from `@/lib/cardDisplayFields` — the same sentinel the custom-columns plan already imported into this file, don't invent a second one.

- [ ] **Step 4: Run to verify they pass**

Run: `cd frontend && npx vitest run CostReport.branches.test.tsx`
Expected: PASS, including every pre-existing test in the file.

- [ ] **Step 5: Lint & typecheck**

Run: `cd frontend && npx eslint --fix src/features/reports/CostReport.tsx src/features/reports/CostReport.branches.test.tsx && npx tsc --noEmit`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/features/reports/CostReport.tsx frontend/src/features/reports/CostReport.branches.test.tsx
git commit -m "feat(reports): table YoY%% column against the prior fiscal year"
```

---

## Task 4: Wire `CostTrendChart` into `CostReport`

**Files:**
- Modify: `frontend/src/features/reports/CostReport.tsx`
- Modify: `frontend/src/features/reports/CostReport.test.tsx`

**Interfaces:**
- Consumes: Task 1's `CostTrendChart`.
- Produces: nothing consumed by a later task (last task in this plan).

- [ ] **Step 1: Write the failing test**

```tsx
// Add to CostReport.test.tsx
it("shows the trend chart above the treemap once a past fiscal year is picked", async () => {
  renderCost();
  await waitFor(() => expect(within(chart()).getAllByText("ERP").length).toBeGreaterThan(0));
  expect(screen.queryByTestId("cost-trend-chart")).not.toBeInTheDocument();
  const picker = screen.getByLabelText(/fiscal year/i);
  await userEvent.click(picker);
  await userEvent.click(await screen.findByRole("option", { name: /2025/ }));
  expect(await screen.findByTestId("cost-trend-chart")).toBeInTheDocument();
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd frontend && npx vitest run CostReport.test.tsx -t "trend chart"`
Expected: FAIL — `CostTrendChart` not rendered.

- [ ] **Step 3: Implement**

In `CostReport.tsx`'s chart-view branch, render `<CostTrendChart cardTypeKey={cardTypeKey} years={fiscalYearOptions} />` above the existing `FullscreenPanel`-wrapped Treemap, only when `fiscalYearParam != null` — reuse the existing `fiscalYearOptions` memo (already built for the picker) as the `years` prop, so both controls offer/plot the same range without a second source of truth.

- [ ] **Step 4: Run to verify it passes**

Run: `cd frontend && npx vitest run CostReport.test.tsx`
Expected: PASS, including every pre-existing test in the file.

- [ ] **Step 5: Lint, typecheck, full suite**

Run: `cd frontend && npx eslint --fix src/features/reports/CostReport.tsx src/features/reports/CostReport.test.tsx && npx tsc --noEmit`
Then: `cd frontend && npx vitest run src/features/reports`
Expected: clean; every file passes.

- [ ] **Step 6: Add the i18n strings**

In `frontend/src/i18n/locales/en/reports.json`: `"cost.yoyPercent": "YoY %"`, `"cost.trendChartTitle": "Cost trend"` (if the chart gets its own heading — implementer's call whether one is needed above the chart, matching how other chart panels in this file are or aren't titled).

- [ ] **Step 7: Commit**

```bash
git add frontend/src/features/reports/CostReport.tsx frontend/src/features/reports/CostReport.test.tsx frontend/src/i18n/locales/en/reports.json
git commit -m "feat(reports): show the cost trend chart once a past fiscal year is selected"
```

---

## Self-Review

**1. Spec coverage:** stacked bar chart by category (Task 1), wired to show once a year is picked (Task 4), treemap delta badge against the current year (Task 2), table YoY% column against the prior year (Task 3).

**2. Step scan:** every step names the exact prop/field/endpoint-param touched; Task 1 Step 3's `data-testid` placement note is a one-line pointer to an existing mock pattern, not a placeholder.

**3. Type consistency:** `CostTrendChart`'s `{ cardTypeKey, years }` props match between Task 1 (defined) and Task 4 (consumed, `years={fiscalYearOptions}`); `TreemapContent`'s `deltaPct` prop matches between Task 2's definition and its one call site; `EMPTY_VALUE` import matches the one already used by the custom-columns plan's own `fieldMeta`/`formatFieldValue` call site in the same file.

**4. Review Focus:** all five lines map to a named test — two in Task 1 (no-category-fields, group-by independence), one in Task 2 (no current-year baseline), two in Task 3 (no prior year at all, prior-year total zero — two different zero-division paths, same guard, both pinned).

**5. Proportion:** four tasks, each independently testable; no task adds a new backend call shape beyond repeating the existing `cost-treemap` endpoint with different parameters, which is the entire point of not needing a backend task here.
