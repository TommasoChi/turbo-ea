# Cost report refinements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cost report: catalogue-based cost-type selector in every view, trend chart in all views, per-card/group colours with legend, left-click drill-down with breadcrumb, right-click opens the card, table with one column per cost item.

**Architecture:** Frontend only. Pure helpers (colours, drill, options) next to the existing `features/reports/*Option.ts` files; `CostReport.tsx` keeps the state and wires them. Per-card item breakdown comes from `/reports/cost-sankey?cost_field=costTotalAnnual` (`nodes[].costs`); trend from per-year treemap calls (adds `group_by`). No backend, schema, permission or OpenAPI change.

**Tech Stack:** React 19, MUI 6, ECharts via `components/charts/EChart.tsx`, Vitest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-11-05-cost-report-refinements-design.md` (read it first; the mockup next to it is indicative).

## Global Constraints

- English-only i18n keys in `frontend/src/i18n/locales/en/reports.json`; no other locale file opened (`/translate` runs before the PR).
- No hardcoded hex outside `frontend/src/theme/tokens.ts`; palette = `CHART_CATEGORICAL[mode]` (8 hues, fixed order, never cycled) plus one new grey token.
- Fetches in effects go through `useAbortableEffect` / `useApiQuery`; guard every `setState` with `isCurrent()`.
- Card type labels via `useTypeLabel()`; never hardcode "Application".
- Tests next to source; `vi.mock("@/api/client")`; `clearMocks` is global.
- Run before each commit: `cd frontend && npx eslint <files> && npx tsc --noEmit`; test with `npx vitest run <file>`.
- Version bump 2.189.0 (minor) + `CHANGELOG.md` heading at the end (Task 10). No mutation testing locally.
- Commit trailer: `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.

## Review Focus

- A group beyond the 8th hue folds into "Others"; a drilled-in "Others" shows its folded members, and the Unspecified bucket (`__other__`) stays a separate entry. Test: 10 groups → 8 hues + one Others with the summed cost.
- Drill state must reset when type, cost field, group-by, fiscal year or scope changes, or the page shows an empty view for an id no longer present.
- Right click must not open the browser menu over a chart but must elsewhere (only the chart/table containers `preventDefault`).
- A card with cost in past years but none in the selected year: it must still appear in its group's trend (trend calls carry `group_by`, not the current view's members).
- A user without `costs.view` sees the existing permission-denied panel, unchanged (no breakdown fetch is fired).

## File Structure

- Create `frontend/src/features/reports/costColors.ts` (+test): pure colour assignment, shades, fold, ink.
- Create `frontend/src/features/reports/costDrill.ts` (+test): drill state type, filters, breadcrumb crumbs.
- Create `frontend/src/features/reports/CostDrillBar.tsx` (+test): breadcrumb + Back + hint line.
- Create `frontend/src/features/reports/useCostBreakdown.ts` (+test): per-card item breakdown from the Sankey endpoint.
- Modify `components/charts/EChart.tsx` (+test), `theme/tokens.ts`, `costReportOptions.ts`, `CostTrendChart.tsx`, `costTrendOption.ts`, `costTreemapOption.ts`, `costSankeyOption.ts`, `CostReport.tsx` (+existing tests), `docs/guide/reports.md`, `CHANGELOG.md`, `VERSION`.

---

### Task 1: `onContextMenu` on the shared chart

**Files:** Modify `frontend/src/components/charts/EChart.tsx`; Test `EChart.test.tsx` (extend, or create beside it if absent).

**Interfaces:**
- Produces: `EChart` prop `onContextMenu?: (params: EChartClickParams) => void`. ECharts emits `contextmenu` with the same datum; the wrapper calls `params.event?.event?.preventDefault()` then the prop. When the prop is absent nothing is registered (native menu stays).

- [ ] Step 1: failing test `calls onContextMenu with the datum and prevents the native menu`: render `EChart` with a stubbed `echarts.init` chart (follow the file's existing mock style), fire the registered `contextmenu` handler with `{data:{id:"a"}, event:{event:{preventDefault}}}`, assert prop called with the params and `preventDefault` called once. Second test `registers no contextmenu handler without the prop`.
- [ ] Step 2: run `npx vitest run src/components/charts/EChart.test.tsx` → FAIL.
- [ ] Step 3: implement: ref-mirror like `clickRef`; register/unregister `chart.on/off("contextmenu", …)` in the init effect only when the prop is present at mount.
- [ ] Step 4: run → PASS. Step 5: commit `feat(charts): EChart onContextMenu`.

### Task 2: Colour assignment

**Files:** Modify `frontend/src/theme/tokens.ts` (add `CHART_OTHER = { light: "#b4b2a8", dark: "#4b4a45" } as const`); Create `costColors.ts`, `costColors.test.ts`.

**Interfaces (produces):**
```ts
export const MAX_GROUP_HUES = 8;
export function shade(hex: string, t: number): string;        // t<0 toward black, t>0 toward white, |t|<=1
export function inkOn(bg: string): "#0b0b0b" | "#ffffff";     // luminance threshold 150, as the mockup
export interface ColoredGroup<T> { key: string; label: string; cost: number; items: T[]; hue: string; folded: boolean }
export function assignGroupColors<T extends { cost: number }>(
  groups: { key: string; label: string; cost: number; items: T[] }[],
  categorical: readonly string[], other: string, unspecifiedKey: string,
): ColoredGroup<T>[];   // by cost desc: first 8 real groups get hues; the rest merge into ONE folded group {key:"__others__"} with `other` hue and summed items/cost; the unspecifiedKey group is never folded and never takes a hue (hue = other)
export function memberShade(hue: string, rank: number, n: number): string; // rank 0 = costliest = darkest; t from -0.22 (rank 0) to +0.40 (rank n-1); n<2 → hue
export function cardColor(name: string, categorical: readonly string[]): string; // fnv1a(name) → hue (h % 8) × step [-0.18, 0, 0.22][(h>>4)%3]
```
- [ ] Tests (write first, watch fail): `assignGroupColors` with 10 groups → 8 hued, 1 folded with summed cost and 2 groups' items; unspecified group keeps its own entry and the `other` hue; stable order by cost; `memberShade` rank 0 darker than rank n-1 (compare luminance), n=1 returns hue; `cardColor` same name → same colour, different names usually differ, always one of 24 values; `inkOn("#ffffff")` is dark, `inkOn("#2a78d6")` is white.
- [ ] Implement; run; commit `feat(cost-report): colour assignment helpers`.

### Task 3: Selector from the catalogue, Initiative out

**Files:** Modify `costReportOptions.ts`, `CostReport.tsx`; Tests `costReportOptions.test.ts`, `CostReport.test.tsx`.

**Interfaces:**
- Produces in `costReportOptions.ts`: `export function costFieldChoices(typeKeys: string[], catalogue: CostItemType[], schemaFields: {key:string;label:string}[], tcoLabel: string, labelOf: (i: CostItemType) => string): {key:string;label:string}[]` — for cost-item types (`isCostItemType` for every key): `[{key:"costTotalAnnual", label:tcoLabel}, …catalogue sorted by sort_order (archived included) as {key,label}]`; otherwise `schemaFields` unchanged.
- Consumes: `useApiQuery<CostItemType[]>("/metamodel/cost-item-types")` (any signed-in user may read it), `isCostItemType` from `lib/costItems.ts`.

- [ ] Tests first: `costFieldChoices` for Application → TCO first then items in sort_order incl. an archived one; for a non-cost-item type returns schema fields; `CostReport.test.tsx`: `shows the cost-type selector with TCO and the catalogue items`, `offers no Initiative type`, `printParams lists the cost type` (print block shows the label for the chosen item even with one schema field).
- [ ] Implement: remove `"Initiative"` from `COST_REPORT_TYPE_KEYS` (`:66`) and the `ini` block in `typeOptions` (`:318-319`); replace `costFields` use for the selector with `costFieldChoices(...)`; render the selector when `choices.length > 1` (cost-item types always have ≥ 1 item+TCO); change `printParams` condition `costFields.length > 1` → `choices.length > 1`; keep the auto-select effect checking against the choices. Archived item chosen: backend already accepts it.
- [ ] Run both test files + `CostReport.fixes/branches/mutation.test.tsx` (existing tests that mock `/reports/*` need a `/metamodel/cost-item-types` mock — add to their shared mock). Commit `feat(cost-report): cost-type selector from the catalogue, Initiative removed`.

### Task 4: Trend chart in every view, per card/group

**Files:** Modify `CostTrendChart.tsx`, `costTrendOption.ts` (only if labels need it), `CostReport.tsx`; Tests `CostTrendChart.test.tsx`, `CostReport.test.tsx`.

**Interfaces:**
- `CostTrendChart` new props: `groupBy?: string` (passed through as `group_by`), `selection?: { kind: "card"; id: string } | { kind: "group"; key: string }`, `scopeIds?: Set<string> | null`. Row value for a component = `Σ response.items.cost` over items that pass: scope (`scopeIds` null = all) and selection (card → `item.id === id`; group → `item.group === key`; none → all). With no selection and no scope it equals the old `total`. Components come from the caller.
- In `CostReport.tsx`: `trendComponents` = catalogue keys in `sort_order` for cost-item types (else `components`); render the chart when `showForecast && trendComponents.length > 0` **below** the treemap panel, the Sankey panel and the table (all three branches), passing `selection` from the drill state (Task 5; until then `undefined`), `groupBy={effectiveGroupBy}`, `scopeIds={scope.closure}`.

- [ ] Tests first: `sums only the selected card across years`, `sums the group's members and sends group_by`, `respects the scope closure`, `total unchanged without selection or scope`; in `CostReport.test.tsx`: `shows the trend chart under the Sankey with Forecast`, `…under the table`.
- [ ] Implement; run; commit `feat(cost-report): trend chart in every view, per card or group`.

### Task 5: Drill state and breadcrumb

**Files:** Create `costDrill.ts`, `CostDrillBar.tsx` (+tests); Modify `CostReport.tsx`.

**Interfaces (produces):**
```ts
export interface Drill { group?: string; cardId?: string }   // group = raw group key (incl. "__others__"), cardId = card id
export type Crumb = { kind: "root" | "group" | "card"; label: string; target: Drill };
export function crumbsOf(drill: Drill, labels: { root: string; group: (k: string) => string; card: (id: string) => string }): Crumb[];
export function backOf(drill: Drill): Drill;       // card→(group if it had one else {}) ; group→{}
export function applyDrill<T extends { id: string; group?: string }>(items: T[], drill: Drill, foldedKeys: Set<string>): T[]; // group "__others__" matches any item whose group is in foldedKeys
```
`CostDrillBar` props: `{ crumbs: Crumb[]; onSelect: (d: Drill) => void; hint: string }` — shows `‹ Back` (when more than root) and clickable crumbs, plus the hint line (always shown).

- [ ] Tests first: `backOf` card-in-group → group, card without group → root; `applyDrill` for a group, for Others (folded keys), for a card; `CostDrillBar` renders crumbs, Back calls `onSelect(backOf)`, clicking root crumb resets, hint always present.
- [ ] Implement; in `CostReport.tsx` add `const [drill, setDrill] = useState<Drill>({})` and an effect resetting it when `cardTypeKey`, `costField`, `effectiveGroupBy`, `fiscalYearParam` or `scopeIds` change; pass `selection` to the trend chart (card → `{kind:"card"}`, group only → `{kind:"group"}`; Others → no single selection: sum of folded groups — add `keys?: string[]` to the group selection: `{kind:"group"; keys: string[]}`); render `CostDrillBar` above each of the three views.
- [ ] Tests in `CostReport.test.tsx`: `drill resets when the cost type changes`. Commit `feat(cost-report): drill state and breadcrumb`.

### Task 6: Per-card breakdown data

**Files:** Create `useCostBreakdown.ts` (+test); Modify `CostReport.tsx`.

**Interfaces:**
```ts
export function useCostBreakdown(args: { enabled: boolean; typeParam: string; groupBy: string; fiscalYear: number | null }):
  { breakdown: Map<string, Record<string, number>> | null };  // cardId → {itemKey: cost}; null while loading/disabled
```
Fetches `/reports/cost-sankey?type&cost_field=costTotalAnnual[&group_by][&fiscal_year]` via `useAbortableEffect`, reads `nodes[].id` (card nodes: `type` not `CostItem`/`Group`) and `nodes[].costs`. `enabled` = `canViewCostsGlobally && (view === "table" || drill.cardId)`; when the page is already on the Sankey view with TCO, reuse nothing — the hook fires its own call (simple, one extra request).

- [ ] Tests first: maps card nodes to costs, ignores group/item nodes, not called when `enabled=false`, drops a stale response (`isCurrent`).
- [ ] Implement; commit `feat(cost-report): per-card item breakdown`.

### Task 7: Treemap — colours, type badge, click/right-click, card drill

**Files:** Modify `costTreemapOption.ts`, `CostReport.tsx`; Tests `costTreemapOption.test.ts`, `CostReport.test.tsx`.

**Interfaces:**
- `CostTreemapItem` gains `color?: string`, `typeKey?: string`, `typeLabel?: string`, `typeIcon?: string`. `CostTreemapGroup` gains `key: string`, `color?: string`. Datums carry `key` (group frame) and `typeLabel`. `leaf()` uses `d.color ?? treemapColor(...)`; group frame uses `g.color`; label text colour from `inkOn(color)` (formatter receives the datum's colour via `data.itemStyle.color`); delta badge colours switch to `inkOn`-aware pair (dark text pair on light tiles: add tokens `COST_DELTA_UP_ON_LIGHT/DOWN_ON_LIGHT` darker greens/reds). Tile second line = `typeLabel` (icon only when tier is "name" and the rect is too small → keep `tileLabelTier`; add tier handling: type line printed only in "full").
- Tooltip adds `typeLabel`. Legend: `CostReport` renders `CostLegend` (below) from `assignGroupColors` output.
- `CostReport.tsx`: build colours with `chartTheme.categorical`, `CHART_OTHER[mode]`; grouped → `assignGroupColors` then `memberShade(hue, rank, n)` per member; ungrouped → `cardColor(name, categorical)`. `onTileClick` (left): datum with `id` → `setDrill({group: item.group, cardId: id})`; datum with `key` and no id (frame) → `setDrill({group:key})`. `onContextMenu`: datum with `id` → `setSidePanelCardId`. Drilled to a card: tiles = one per non-zero item of `breakdown.get(cardId)` (colour from `CHART_CATEGORICAL` by catalogue sort position, labels from `trendLabelOf`), clicks inert. Drilled to a group: `applyDrill` on `items`.
- `CostLegend` (small component in `CostReport.tsx` or own file): swatch + label per `ColoredGroup`, including "Others (N groups)"; not rendered when ungrouped.
- Type badge data: `typeKey` from the card — `CostItem` response items lack the type; add it by mapping `item.type` if present, else from the combined-view id lookup: **check `reports.py:1505-1515` returns `type`** (it does: id, name, type, cost…); extend the frontend `CostItem` interface with `type?: string`. Icon/label via `useMetamodel().types` + `useTypeLabel()`.

- [ ] Tests first (option): custom colours used; frame datum has `key`; label colour flips to dark ink on a light tile; type line shown only in `full` tier; (page): `left click on a tile drills into that card`, `right click on a tile opens the side panel`, `legend lists groups and Others at the 9th group`, `type badge shows Application / IT Component in the combined view`.
- [ ] Implement; commit `feat(cost-report): treemap colours, type badge, drill and right click`.

### Task 8: Sankey — colours, fold, clicks, drill

**Files:** Modify `costSankeyOption.ts`, `CostReport.tsx`; Tests `costSankeyOption.test.ts`, `CostReport.test.tsx`.

**Interfaces:**
- `CostSankeyNodeIn` gains `color?: string` (used instead of `costSankeyNodeColor` when present; cost-item nodes stay neutral grey via a new token reuse of `CHART_OTHER`-like neutral → use `STATUS_COLORS.neutral`), `typeLabel?: string` appended to the card label (`Name · Type`) and the tooltip, `kind: "group" | "card" | "item"` derived from `type`.
- `buildCostSankeyOption(nodes, links, o)` unchanged signature; `EChart` gets `onClick`/`onContextMenu` via `CostSankeyPanel` props `onNodeClick(p)` / `onNodeContextMenu(p)`; datum `name` = node id (`group:<key>`, card id, `item:<key>`): left click on `group:`/card → drill; on `item:` or an edge → ignored; right click on a card → side panel.
- Fold in `sankeyView`: after scope filtering, groups beyond the 8th (by summed value, `__other__` excluded) merge into one node `group:__others__` named "Others": remap links whose target is a folded group, summing values per (source,target); card nodes keep their ids; colours from `assignGroupColors` + `memberShade` as in Task 7 (shared helper `colorizeGroups` in `costColors.ts` if duplication appears — extract then).
- Drill filter in `sankeyView`: `keep` additionally restricts card nodes to `applyDrill`-selected ids (group → its member cards; card → that card), then the existing two-pass pruning drops empty groups/items.

- [ ] Tests first (option): node `color` wins; item nodes grey; label includes type; (page): `Sankey left click drills into a group`, `right click on a card opens the side panel`, `click on a cost-item node does nothing`, `groups beyond the 8th fold into Others with summed links`, `drilled card Sankey shows only that card and its items`.
- [ ] Implement; commit `feat(cost-report): Sankey colours, fold, drill and right click`.

### Task 9: Table — item columns, TCO, drill, right click

**Files:** Modify `CostReport.tsx`; Test `CostReport.test.tsx`.

- Columns (after Name): one per catalogue item (archived included, hidden when the column is all zero? **no** — show all, spec says one per item), then **TCO** (sum of the row's items = the row's `cost` when `costField` is TCO; always compute TCO from the breakdown so it never depends on the selector), then % of total, YoY, extra columns. Row cost cell for the selected `costField` is highlighted (`fontWeight: 700`); the initial `sortK` follows the selector (`useEffect` on `costField` sets `sortK` to that column key, `sortD` "desc").
- Rows: cards with TCO > 0 from the breakdown (table view fetches `useCostBreakdown`, and still the treemap call for `items`/attributes/YoY; rows join on id, a card missing from the breakdown shows `—` in item columns). Group header rows show item sums too.
- Row `onClick` → drill (card: `{group, cardId}`), `onContextMenu` (with `preventDefault`) → side panel; the type badge (icon + name) in the name cell; `CostDrillBar` above the table with the hint; drilled card → single row; drilled group → its rows.
- Footer total row gets item sums.

- [ ] Tests first: `table shows a column per cost item and a TCO column equal to their sum`, `selector change sorts by that column descending`, `row click drills, right click opens the card`, `drilled card shows a single row`.
- [ ] Implement; update the existing table tests whose row-click expectation changed (row click opened the side panel before → now right click). Commit `feat(cost-report): table per-item columns, TCO and drill`.

### Task 10: i18n, docs, version

**Files:** `frontend/src/i18n/locales/en/reports.json`, `docs/guide/reports.md` (English only), `CHANGELOG.md`, `VERSION`.

- Keys under `cost.*`: `drillHint` ("Click: analyse · Right click: open card"), `back`, `breadcrumbRoot`, `others` ("Others"), `othersCount` ("Others ({{count}} groups)"), `tco` ("TCO"), `typeBadge` if needed. Remove no keys.
- `docs/guide/reports.md`: cost report section — selector, trend in all views, colours + legend, drill-down + Back, left/right click, table columns. Screenshots: keep existing; no `pages.ts` change.
- `VERSION` → `2.189.0`; `CHANGELOG.md` `## [2.189.0] - 2026-11-05` with **Added** (drill-down, colours + legend, trend in all views, table per-item columns), **Changed** (Initiatives leave the cost report), **Fixed** (cost-type selector missing since 2.188.0).
- [ ] Run `cd frontend && npm run test:run` (whole suite) and `npx tsc --noEmit`, `npx eslint src/features/reports src/components/charts`; commit `docs(cost-report): guide, changelog, 2.189.0`.

### Task 11: Finish the branch (not code)

- [ ] Run `/translate`; run the review chain in order with fresh agents: `simplify` → rerun touched tests → `ponytail-review` → `security-review`; render check in the browser pane (light and dark, treemap/Sankey/table, drill and Back); then PR from `.github/pull_request_template.md` (the user opens it if the hook blocks `gh pr create`). Mutation score is read from CI, never run locally.
