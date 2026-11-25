# Cost report legend and hint Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** In `/reports/cost` the legend follows the drill level, is clickable, stays inside the fullscreen panel, and the click hint no longer covers the fullscreen icon.

**Architecture:** Frontend only. `CostLegend` becomes interactive; `CostReport.tsx` builds its entries from the drill level and renders it inside each `FullscreenPanel`; `CostDrillBar` reserves room for the fullscreen icon.

**Tech Stack:** React 19, MUI 6, Vitest + Testing Library, i18n (no new keys).

**Spec:** `docs/superpowers/specs/2026-11-25-cost-report-legend-and-hint-design.md`

## Global Constraints

- Frontend files only; no backend, no migration, no new i18n key (the hint keeps `cost.drillHint`).
- Colours only from existing tokens (`costColors.ts`, `chartTheme`); never a raw hex.
- The drill stays component state (`drill` in `CostReport.tsx`); no URL state.
- No legend on the table view.
- Version bump (minor) and a `CHANGELOG.md` entry once for the PR; docs page `docs/guide/reports.md` updated.

## Review Focus

- A group-by with exactly one group: legend at All level shows it; click does nothing harmful.
- Drill into Others, then into a card of a folded group, then Back twice: the legend and breadcrumb stay in step.
- Fullscreen on and off while drilled to a card: legend present, no layout jump.
- Sankey at card level: the legend shows the card's group, and its colour is the group node's colour in the chart.
- Keyboard: Tab reaches each legend button, Enter and Space drill.

---

### Task 1: Hint clear of the fullscreen icon

**Files:**
- Modify: `frontend/src/features/reports/CostDrillBar.tsx`
- Test: `frontend/src/features/reports/CostDrillBar.test.tsx` (extend)

**Interfaces:**
- Consumes: `FullscreenPanel` places its icon `position: absolute; top: 4; right: 4` (about 32px wide).
- Produces: `CostDrillBar` props unchanged (`crumbs`, `onSelect`, `hint`).

- [ ] **Step 1: Write the failing test** `reserves room on the right for the fullscreen icon`: render the bar, assert the root element has `paddingRight: "40px"` (`toHaveStyle`; no `ThemeProvider` in this test, so `pr: 5` is 40px); jsdom has no layout, so the real overlap is checked by hand (Task 4).
- [ ] **Step 2: Run** `cd frontend && npx vitest run src/features/reports/CostDrillBar.test.tsx`. Expected: the new test FAILS.
- [ ] **Step 3: In `CostDrillBar.tsx` give the root `Box` a right padding that clears the icon (`pr: 5`)**; keep `ml: "auto"` and `flexWrap` so the hint drops to its own line on a narrow bar.
- [ ] **Step 4: Run the same command.** Expected: PASS.
- [ ] **Step 5: Commit** `fix(cost-report): keep the click hint clear of the fullscreen icon`.

### Task 2: A clickable legend

**Files:**
- Modify: `frontend/src/features/reports/CostLegend.tsx`
- Test: `frontend/src/features/reports/CostLegend.test.tsx` (extend)

**Interfaces:**
- Produces: `CostLegend({ entries, onSelect?, activeKey? }: { entries: CostLegendEntry[]; onSelect?: (key: string) => void; activeKey?: string })`. `CostLegendEntry` gains no field. With no `onSelect` the entries render as today (plain, not buttons).

- [ ] **Step 1: Write failing tests**: `calls onSelect with the entry key on click`; `entries are buttons reachable by keyboard and fire on Enter and Space`; `marks the active entry` (bold label and `aria-current="true"`); `renders plain entries without onSelect`.
- [ ] **Step 2: Run** `npx vitest run src/features/reports/CostLegend.test.tsx`. Expected: new tests FAIL.
- [ ] **Step 3: Implement**: when `onSelect` is set, each entry is a `ButtonBase` (`aria-label` = entry label, visible focus ring) wrapping the existing swatch and caption; the active one has `fontWeight: 600` and `aria-current`. Keep `data-testid="cost-legend"` and `cost-legend-swatch-<key>`.
- [ ] **Step 4: Run** the legend tests. Expected: PASS (the existing ones too).
- [ ] **Step 5: Commit** `feat(cost-report): make the legend entries clickable`.

### Task 3: The legend follows the drill, inside the panel

**Files:**
- Modify: `frontend/src/features/reports/CostReport.tsx` (the `legend` constant at ~1199 and the two render sites ~1523 and ~1551)
- Test: `frontend/src/features/reports/CostReport.test.tsx` (extend)

**Interfaces:**
- Consumes: `colorPlan.groups`, `drill`, `setDrill`, `cardItemTiles` (name, colour per item), `groupDisplayLabel`, `OTHERS_KEY`, `Drill = { group?, cardId? }`.
- Produces: `legendEntries`: All level → every group; drilled into a group (`drill.group`, no card) → that group only (`OTHERS_KEY` → the Others entry); drilled into a card → in the **treemap**, the card's cost items from `cardItemTiles` with the colours its tiles use; in the **Sankey**, the one entry of the group the card sits in (the Sankey keeps drawing that group node; its cost-item nodes are neutral grey in every mode and stay unlisted), the Unspecified entry when the card has no group. No group-by and no card drill → no legend.

- [ ] **Step 1: Write failing tests** in `CostReport.test.tsx`, grouped treemap and grouped Sankey: `legend lists every group at the root`; `inside a group the legend lists that group only and marks it`; `inside a card the legend lists the card's cost items` (treemap); `inside a card the Sankey legend shows the card's group with the group node's colour`; `Back restores the legend of the level above`; `clicking a legend entry drills into that group and the breadcrumb shows it`; `clicking Others drills into __others__ and the breadcrumb reads Others`; `clicking Unspecified drills into __other__`; `clicking the active entry changes nothing visible and refetches nothing` (the `k !== drill.group` guard was dropped: its effect is unobservable); `a single group: the legend shows it and the click is harmless`; `Others, then a card of a folded group, then Back twice keeps legend and breadcrumb in step`; `the legend is rendered inside the fullscreen panel, also when drilled to a card` (simulate `fullscreenchange` as `CostReport.test.tsx:1244` does); `no legend while the card's tiles are still loading`.
- [ ] **Step 2: Run** `npx vitest run src/features/reports/CostReport.test.tsx -t legend`. Expected: new tests FAIL.
- [ ] **Step 3: Implement**: the card-level entries are built in the same `useMemo` as `cardItemTiles`, each with the cost item's own key (`OTHER_GROUP` for the unspecified item, a fixed `__rest__` key for the merged "Other items" tile), label and colour, so the legend never re-derives them; `CostLegendEntry` still gains no field. Derive `legendEntries` by drill level as above; render `<CostLegend entries={legendEntries} onSelect={(k) => setDrill({ group: k })} activeKey={drill.group} />` in the child function of `FullscreenPanel`, after `CostTreemapPanel` / `CostSankeyPanel` and outside the chart's `Paper`; at card level pass no `onSelect` (items are not drillable). `onSelect` is `(k) => setDrill({ group: k })`, with no guard against re-selecting the active group. In the treemap the legend is rendered after the spinner / `CostTreemapPanel` ternary, so it is absent while the card tiles load. Remove the two old `{legend}` render sites.
- [ ] **Step 4: Run** the whole file. Expected: PASS, existing legend tests updated only where they asserted the old position.
- [ ] **Step 5: Commit** `feat(cost-report): the legend follows the drill and shows in fullscreen`.

### Task 4: Docs, changelog, version

**Files:**
- Modify: `docs/guide/reports.md` (legend and drill-down paragraphs, ~177-179), `CHANGELOG.md`, `VERSION`

- [ ] **Deferred by the owner (2026-11-25): the `reports.md` edit and its nine translations move to the next PR (Provider and filters), which rewrites the same page; only the changelog and the version ship here.** Original step, kept for that PR: in `reports.md` write that the legend follows the drill level, can be clicked to drill into a group, and shows in fullscreen: fix line 177 ("beside the chart" becomes "below the chart"), the drill-down paragraph (~179) and the Fullscreen paragraph (~185). English only; `/translate` fills the nine siblings later. No screenshot to retake: `34_report_cost` has no group-by, so no legend.
- [ ] **Step 2:** Bump `/VERSION` by a **minor** (a clickable legend is a new feature) and add a `## [x.y.z] - 2026-11-25` heading in `CHANGELOG.md` with one Added line (clickable legend that follows the drill) and one Fixed line (hint over the fullscreen icon, legend missing in fullscreen). Edit nothing else for the version.
- [ ] **Step 3: Run** `cd frontend && npm run lint && npx vitest run src/features/reports`. Expected: clean, PASS.
- [ ] **Step 4:** By hand at desktop width and at 375px, check that the hint never overlaps the fullscreen icon in treemap, Sankey and table, and that the legend shows in fullscreen; write the result in the PR's Test Plan, together with the mutation score the CI gives on the changed files and any survivor kept with its reason (never run mutation locally).
- [ ] **Step 5: Commit** `docs: cost report legend, changelog and version`.
