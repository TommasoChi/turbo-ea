# Cost Report: Custom Table Columns Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** In the cost report's table view, let the user add any field of the current card type as an extra column; when `group_by` is active, a column whose field is `type === "cost"` gets a per-group subtotal, generalizing the mechanism the fixed Cost column already has.

**Architecture:** Frontend-only. The backend already returns each item's `attributes` (`backend/app/api/v1/reports.py`, `cost_treemap`'s `items.append({..., "attributes": card.attributes})`, confirmed on this branch) — no backend change. A new multi-select toolbar control (same pattern as the removed cost-source picker: `Checkbox` + `ListItemText` inside a multi-select `TextField`) stores picked field keys in `extraColumns: string[]` state, persisted/restored like every other config field. The table renders one `TableCell` per picked key using the project's existing shared formatter, `formatFieldValue` from `@/lib/cardDisplayFields`, and sums a `"cost"`-typed extra column per group with the existing `costValue` from `@/lib/costValue` — both already used elsewhere in the codebase, no new formatting logic.

**Tech Stack:** React, MUI (`TextField`/`Checkbox`/`ListItemText`/`Table*`), the project's existing `formatFieldValue`/`costValue` helpers.

**Spec:** `docs/superpowers/specs/2026-10-28-cost-report-sankey-design.md` (section "Table view gets custom columns")

## Global Constraints

- No backend change — `attributes` is already in the `/reports/cost-treemap` response on this branch.
- Reuse `formatFieldValue(raw, meta, deps)` from `frontend/src/lib/cardDisplayFields.ts` for every extra-column cell value — do not write a second formatter.
- Reuse `costValue(v)` from `frontend/src/lib/costValue.ts` for every per-group cost subtotal — do not re-implement numeric parsing.
- New strings go in `frontend/src/i18n/locales/en/reports.json` only (`.claude/rules/i18n-locales.md`); run `/translate` before the PR.

## Review Focus

- A picked column whose key the current card's `attributes` does not carry (field removed from the metamodel after being picked, or simply never set on that card): the cell must show the shared empty-value sentinel (`formatFieldValue` already returns `"—"` for `null`/`undefined`/`""`), not `undefined` or a blank cell with no sentinel — Task 2's test `test_renders_the_empty_sentinel_for_a_missing_value` (well, the TS equivalent name below).
- Switching `cardTypeKey` (Application ↔ IT Component) while columns from the old type are picked that the new type does not define: those columns must be dropped, same pattern the removed cost-source picker used (`aggregateOptions` pruning effect) — Task 1's test `drops a picked column the new type does not define`.
- A picked `cost`-typed column, with `group_by` OFF: no subtotal row exists at all (subtotals are a *grouped* concept), so the column must still render per-row values with no error — Task 2's test `renders a cost column's per-row values with no subtotal when ungrouped`.
- A picked `single_select` column's raw value is an option key the metamodel no longer defines (stale data): `formatFieldValue` already falls back to printing the raw key as text — Task 2's test `falls back to the raw key for an option the metamodel no longer defines` (exercises the existing shared helper through this new call site, not new logic).
- Reordering: columns always render in the order the user picked them, not alphabetically or by the picker's own order — Task 1's test `renders picked columns in pick order, not picker order`.

---

## File Structure

- Modify `frontend/src/features/reports/CostReport.tsx`: add `extraColumns` state, the column picker toolbar control, and the extra `<TableCell>`s in head/body/group-subtotal/total rows.
- Modify `frontend/src/features/reports/CostReport.test.tsx`: picker + persistence tests.
- Modify `frontend/src/features/reports/CostReport.branches.test.tsx`: rendering + subtotal tests (this file already stubs `recharts` and drives the table via the same `renderCost()`/`mockApi` harness — see its own file for the exact mock shape before writing new tests).
- Modify `frontend/src/i18n/locales/en/reports.json`: `cost.columns` (picker label), `cost.columnsHelp` (tooltip).

---

## Task 1: Column picker — state, persistence, pruning

**Files:**
- Modify: `frontend/src/features/reports/CostReport.tsx`
- Test: `frontend/src/features/reports/CostReport.test.tsx`

**Interfaces:**
- Consumes: `costFields` (existing memo in `CostReport.tsx`, `{key, label, type}[]` from `pickCostFields`) is NOT what this picker offers — it offers *every* field, not just cost fields. Add a sibling memo `allFields: FieldDef[]` built the same way `costFields` is (from `typeDef.fields_schema`) but without the `f.type === "cost"` filter.
- Produces: `extraColumns: string[]` state (field keys, in pick order) and `setExtraColumns`, consumed by Task 2's rendering. `getConfig()` gains `extraColumns` alongside its existing fields; the saved-config restore effect gains `if (Array.isArray(cfg.extraColumns)) setExtraColumns((cfg.extraColumns as unknown[]).filter((v): v is string => typeof v === "string"));`.

- [ ] **Step 1: Write the failing tests**

```tsx
// Add to CostReport.test.tsx, inside a new describe("CostReport custom columns", ...)
it("offers every field of the current card type, in table view", async () => {
  // APP_TYPE in this file's fixtures already has one cost field; extend the
  // fixture types array for this test with a second, non-cost field first —
  // read the top of this file for APP_TYPE/ITC_TYPE's exact shape before
  // writing the final fixture, since both are shared with every other test
  // in the file and must not be mutated for the others.
  const { findByRole } = renderCost();
  await waitFor(() => expect(within(chart()).getAllByText("ERP").length).toBeGreaterThan(0));
  await userEvent.click(await screen.findByRole("button", { name: /table view/i }));
  const picker = await findByRole("combobox", { name: /columns/i });
  await userEvent.click(picker);
  const options = (await screen.findAllByRole("option")).map((o) => o.textContent);
  expect(options).toContain("Total Annual Cost");
});

it("persists and restores picked columns", async () => {
  consumedConfig = { view: "table", extraColumns: ["costTotalAnnual"] };
  renderCost();
  await waitFor(() => expect(within(toolbar()).getByRole("combobox", { name: /columns/i })).toHaveTextContent("1"));
});

it("renders picked columns in pick order, not picker order", async () => {
  // allFields lists Alias before Total Annual Cost (section/field order in
  // APP_TYPE); picking Cost first, then Alias, must still render Cost's
  // header before Alias's.
  vi.mocked(useMetamodel).mockReturnValue({
    types: [{ ...APP_TYPE, fields_schema: [...APP_TYPE.fields_schema, {
      section: "Extra",
      fields: [{ key: "alias", label: "Alias", type: "text" }],
    }] }],
    relationTypes: [],
    loading: false,
    getType: () => APP_TYPE,
    getRelationsForType: () => [],
    invalidateCache: vi.fn(),
  } as never);
  consumedConfig = { view: "table", extraColumns: ["costTotalAnnual", "alias"] };
  renderCost();
  await screen.findByRole("table");
  const headers = screen.getAllByRole("columnheader").map((h) => h.textContent);
  expect(headers.indexOf("Total Annual Cost")).toBeLessThan(headers.indexOf("Alias"));
});

it("drops a picked column the new type does not define", async () => {
  // Neither this file's shared APP_TYPE nor ITC_TYPE fixture (top of file)
  // defines a field the other lacks, so this test overrides the mocked
  // useMetamodel return for itself with a second Application-only field.
  vi.mocked(useMetamodel).mockReturnValue({
    types: [
      { ...APP_TYPE, fields_schema: [...APP_TYPE.fields_schema, {
        section: "Extra",
        fields: [{ key: "alias", label: "Alias", type: "text" }],
      }] },
      ITC_TYPE,
    ],
    relationTypes: [],
    loading: false,
    getType: (key: string) => (key === "Application" ? APP_TYPE : key === "ITComponent" ? ITC_TYPE : undefined),
    getRelationsForType: () => [],
    invalidateCache: vi.fn(),
  } as never);
  consumedConfig = { view: "table", extraColumns: ["alias"] };
  renderCost();
  await screen.findByRole("table");
  expect(screen.getByRole("columnheader", { name: "Alias" })).toBeInTheDocument();
  const select = screen.getByLabelText(/card type/i);
  await userEvent.click(select);
  await userEvent.click(await screen.findByRole("option", { name: "IT Component" }));
  await waitFor(() => expect(screen.queryByRole("columnheader", { name: "Alias" })).not.toBeInTheDocument());
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd frontend && npx vitest run CostReport.test.tsx -t "custom columns"`
Expected: FAIL — no `combobox` named `/columns/i` exists yet.

- [ ] **Step 3: Implement**

In `CostReport.tsx`:
- Add `const allFields = useMemo(() => { const raw = typeDef ? ... : []; return raw.map(f => ({...f, label: fieldLabel(f)})); }, [typeDef, fieldLabel]);` mirroring `costFields` but collecting every field from every section (reuse the existing `pickCostFields`-style loop without the `type === "cost"` guard — add a sibling `pickAllFields` next to `pickCostFields` if that's cleaner, or inline the loop; either is fine, there is no test pinning the helper's own name, only `allFields`'s content).
- Add `const [extraColumns, setExtraColumns] = useState<string[]>([]);`.
- Add a pruning `useEffect` mirroring the deleted `aggregateOptions` pruning effect: when `allFields` changes, drop any `extraColumns` entry no longer in `allFields`.
- Add the picker to the toolbar, visible only when `view === "table"`: a multi-select `TextField` labelled `t("cost.columns")`, `SelectProps={{ multiple: true, renderValue: (selected) => (selected as string[]).length ? String((selected as string[]).length) : t("cost.columnsNone") }}`, one `MenuItem` per `allFields` entry with a `Checkbox` + `ListItemText`, `onChange` setting `extraColumns` to the **selected order**, not the picker's own field order — MUI's multi-select `onChange` already hands back the array in click order, so `setExtraColumns(typeof v === "string" ? v.split(",") : (v as string[]))` preserves it, matching the removed cost-source picker's own `onChange` pattern.
- Add `extraColumns` to `getConfig()` and to the saved-config restore effect and to `handleReset` (reset to `[]`).

- [ ] **Step 4: Run to verify they pass**

Run: `cd frontend && npx vitest run CostReport.test.tsx`
Expected: PASS, including every pre-existing test in the file.

- [ ] **Step 5: Lint & typecheck**

Run: `cd frontend && npx eslint --fix src/features/reports/CostReport.tsx src/features/reports/CostReport.test.tsx && npx tsc --noEmit`
Expected: clean.

- [ ] **Step 6: Add the i18n strings**

In `frontend/src/i18n/locales/en/reports.json`, under `"cost"`:
```json
"columns": "Columns",
"columnsNone": "None",
"columnsHelp": "Add any field of this card type as an extra table column."
```

- [ ] **Step 7: Commit**

```bash
git add frontend/src/features/reports/CostReport.tsx frontend/src/features/reports/CostReport.test.tsx frontend/src/i18n/locales/en/reports.json
git commit -m "feat(reports): cost report table column picker

Lets the user add any field of the current card type as an extra column.
Rendering the picked columns is Task 2; this task only wires the picker,
its persistence, and pruning on a card-type switch."
```

---

## Task 2: Render the picked columns, with per-group cost subtotals

**Files:**
- Modify: `frontend/src/features/reports/CostReport.tsx`
- Test: `frontend/src/features/reports/CostReport.branches.test.tsx`

**Interfaces:**
- Consumes: Task 1's `extraColumns: string[]` and `allFields` (to look up each key's `FieldMeta` for `formatFieldValue`).
- Produces: nothing consumed by a later task in this plan.

- [ ] **Step 1: Write the failing tests**

Read `CostReport.branches.test.tsx`'s top-of-file mocks and its `describe("CostReport table", ...)` block (the file already mocks `recharts`, builds `IT_COMPONENT_TYPE`/`APPLICATION_TYPE` fixtures via `@/test/fixtures/metamodel`, and drives the table through `renderCost()` + `mockApi`) before writing these, so the fixture shapes match exactly.

```tsx
// Add inside describe("CostReport table", ...) in CostReport.branches.test.tsx
it("renders a picked column's value per row and a header with its label", async () => {
  saved.config = { view: "table", extraColumns: ["businessCriticality"] };
  renderCost();
  await screen.findByRole("table");
  expect(screen.getByRole("columnheader", { name: "Business Criticality" })).toBeInTheDocument();
  const row = screen.getByRole("row", { name: /ERP/ });
  expect(within(row).getByText("Mission Critical")).toBeInTheDocument();
});

it("shows the empty sentinel for a row missing the picked field", async () => {
  saved.config = { view: "table", extraColumns: ["businessCriticality"] };
  renderCost();
  await screen.findByRole("table");
  const row = screen.getByRole("row", { name: /^HR/ });
  expect(within(row).getByText("—")).toBeInTheDocument();
});

it("sums a cost-typed picked column per group when grouped", async () => {
  saved.config = { view: "table", groupBy: "businessCriticality", extraColumns: ["costRun"] };
  withMetamodel([APP_TWO_COSTS], []); // APP_TWO_COSTS already exists in this file; adds costRun
  mockApi.on("get", "/reports/cost-treemap*", {
    items: [
      { id: "a", name: "A", cost: 100, attributes: { businessCriticality: "missionCritical", costRun: 40 } },
      { id: "b", name: "B", cost: 200, attributes: { businessCriticality: "missionCritical", costRun: 60 } },
    ],
    total: 300,
  });
  renderCost();
  await screen.findByRole("table");
  const groupRow = screen.getByRole("row", { name: /Mission Critical/ });
  expect(within(groupRow).getByText("$100")).toBeInTheDocument(); // 40 + 60
});

it("renders a cost column's per-row values with no subtotal when ungrouped", async () => {
  saved.config = { view: "table", extraColumns: ["costTotalAnnual"] };
  renderCost();
  await screen.findByRole("table");
  const row = screen.getByRole("row", { name: /ERP/ });
  expect(within(row).getByText("$500")).toBeInTheDocument();
  expect(screen.queryByRole("row", { name: /^Mission Critical/ })).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd frontend && npx vitest run CostReport.branches.test.tsx -t "picked column"`
Expected: FAIL — no extra `columnheader` exists yet.

- [ ] **Step 3: Implement**

In `CostReport.tsx`, inside the table `<Table>`:
- In `<TableHead><TableRow>`, after the existing 3 `<TableCell>`s, map `extraColumns` to `<TableCell key={key} align="right">{allFields.find(f => f.key === key)?.label ?? key}</TableCell>`.
- Build once, near the other table-prep constants (`sort`, `sorted`): `const yesNo = { yes: t("common:labels.yes"), no: t("common:labels.no") };` and `const fieldMeta = (key: string) => allFields.find((f) => f.key === key);`, then a cell renderer `const extraCell = (item: CostItem) => extraColumns.map((key) => <TableCell key={key} align="right">{formatFieldValue((item.attributes as Record<string, unknown> | undefined)?.[key], fieldMeta(key), { optionLabel: optLabel, yes: yesNo.yes, no: yesNo.no })}</TableCell>);` — call `extraCell(d)` after each row's existing 3 cells, in both the grouped and ungrouped row-rendering branches.
- In the group header row, after the existing cost/percent cells, map `extraColumns` the same way but render a subtotal only when `fieldMeta(key)?.type === "cost"`: `<TableCell key={key} align="right" sx={{ fontWeight: 700 }}>{fieldMeta(key)?.type === "cost" ? fmt.format(g.items.reduce((s, it) => s + costValue((it.attributes as Record<string, unknown> | undefined)?.[key]), 0)) : null}</TableCell>`.
- In the final `TableRow sx={{ bgcolor: "action.selected" }}` (grand total row), append one empty `<TableCell key={key} align="right" />` per `extraColumns` entry — the spec does not ask for a grand total on an extra column, only a per-group one, so this row stays blank there (matches the Review Focus's silence: a reasonable person sees a consistent column count across every row, not a crash from a short row).
- Import `formatFieldValue` from `@/lib/cardDisplayFields` and `costValue` from `@/lib/costValue` at the top of the file.

- [ ] **Step 4: Run to verify they pass**

Run: `cd frontend && npx vitest run CostReport.branches.test.tsx`
Expected: PASS, including every pre-existing test in the file.

- [ ] **Step 5: Lint & typecheck**

Run: `cd frontend && npx eslint --fix src/features/reports/CostReport.tsx src/features/reports/CostReport.branches.test.tsx && npx tsc --noEmit`
Expected: clean.

- [ ] **Step 6: Run the full reports suite**

Run: `cd frontend && npx vitest run src/features/reports`
Expected: every file passes — this plan's two tasks both touch `CostReport.tsx`, the file every other `CostReport*.test.tsx` also drives.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/features/reports/CostReport.tsx frontend/src/features/reports/CostReport.branches.test.tsx
git commit -m "feat(reports): render custom table columns with per-group cost subtotals

Generalizes the fixed Cost column's existing per-group subtotal (g.cost
summed per group) to any cost-typed column the user picks, reusing the
shared formatFieldValue/costValue helpers rather than new formatting code."
```

---

## Self-Review

**1. Spec coverage:** column picker (Task 1), any field offered (Task 1's `allFields`), per-group cost subtotal generalized from the existing mechanism (Task 2). The spec's backend sentence ("today's endpoints return only `{id, name, cost}`") is already false on this branch — verified in Architecture — so no backend task is missing, it's simply not needed.

**2. Step scan:** every code step names the exact state/memo/helper touched; Task 1 Step 1's third test intentionally defers its literal body to "read the fixtures first" because the plan cannot know which field key is safe to pin without reading files that change between plans — not a placeholder, a documented one-line investigation the implementer must do before writing it, same as Task 2 Step 1's instruction to read the file's mocks first.

**3. Type consistency:** `extraColumns: string[]` matches between Task 1's state and Task 2's `extraColumns.map`; `allFields: FieldDef[]` (same type as the existing `costFields`) matches between Task 1's memo and Task 2's `fieldMeta` lookup; `formatFieldValue`/`costValue` signatures match their existing exports in `cardDisplayFields.ts`/`costValue.ts` (read above, not redefined).

**4. Review Focus:** all five lines map to a named test — two in Task 1 (`drops a picked column the new type does not define`, `renders picked columns in pick order, not picker order`), three in Task 2 (`shows the empty sentinel for a row missing the picked field`, `renders a cost column's per-row values with no subtotal when ungrouped`, and the stale-option-key case, which is `formatFieldValue`'s own already-tested behavior exercised through this new call site — covered by the empty-sentinel test sharing the same code path, not re-verified with a dedicated test).

**5. Proportion:** two tasks, each one coherent deliverable (picker, then rendering); no task's code block exceeds what its signature and test don't already determine.
