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
- Version bump (patch) and a `CHANGELOG.md` entry once for the PR; docs page `docs/guide/reports.md` updated.

## Review Focus

- A group-by with exactly one group: legend at All level shows it; click does nothing harmful.
- Drill into Others, then into a card of a folded group, then Back twice: the legend and breadcrumb stay in step.
- Fullscreen on and off while drilled to a card: legend present, no layout jump.
- Sankey at card level: the legend colours must match the Sankey's cost-item nodes, not only the treemap's.
- Keyboard: Tab reaches each legend button, Enter and Space drill.

---

### Task 1: Hint clear of the fullscreen icon

**Files:**
- Modify: `frontend/src/features/reports/CostDrillBar.tsx`
- Test: `frontend/src/features/reports/CostDrillBar.test.tsx` (extend)

**Interfaces:**
- Consumes: `FullscreenPanel` places its icon `position: absolute; top: 4; right: 4` (about 32px wide).
- Produces: `CostDrillBar` props unchanged (`crumbs`, `onSelect`, `hint`).

- [ ] **Step 1: Write the failing test** `reserves room on the right for the fullscreen icon`: render the bar, assert the root element has `paddingRight` of at least 5 spacing units (`toHaveStyle`); jsdom has no layout, so the real overlap is checked by hand later.
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
- Produces: `legendEntries`: All level → every group; drilled into a group (`drill.group`, no card) → that group only (`OTHERS_KEY` → the Others entry); drilled into a card → the card's cost items from `cardItemTiles` with the colours its tiles use (for the Sankey, the colours of its cost-item nodes, read from the node build at ~989). No group-by and no card drill → no legend.

- [ ] **Step 1: Write failing tests** in `CostReport.test.tsx`, grouped treemap and grouped Sankey: `legend lists every group at the root`; `inside a group the legend lists that group only and marks it`; `inside a card the legend lists the card's cost items`; `Back restores the legend of the level above`; `clicking a legend entry drills into that group and the breadcrumb shows it`; `clicking Others drills into __others__ and the breadcrumb reads Others`; `the legend is rendered inside the fullscreen panel`.
- [ ] **Step 2: Run** `npx vitest run src/features/reports/CostReport.test.tsx -t legend`. Expected: new tests FAIL.
- [ ] **Step 3: Implement**: derive `legendEntries` by drill level as above; render `<CostLegend entries={legendEntries} onSelect={(k) => setDrill({ group: k })} activeKey={drill.group} />` in the child function of `FullscreenPanel`, after `CostTreemapPanel` / `CostSankeyPanel` and outside the chart's `Paper`; at card level pass no `onSelect` (items are not drillable). Remove the two old `{legend}` render sites.
- [ ] **Step 4: Run** the whole file. Expected: PASS, existing legend tests updated only where they asserted the old position.
- [ ] **Step 5: Commit** `feat(cost-report): the legend follows the drill and shows in fullscreen`.

### Task 4: Docs, changelog, version

**Files:**
- Modify: `docs/guide/reports.md` (legend and drill-down paragraphs, ~177-179), `CHANGELOG.md`, `VERSION`

- [ ] **Step 1:** In `reports.md` write that the legend follows the drill level, can be clicked to drill into a group, and shows in fullscreen. English only; `/translate` fills the nine siblings later.
- [ ] **Step 2:** Bump `/VERSION` by a patch and add a `## [x.y.z] - 2026-11-25` heading in `CHANGELOG.md` with one Changed line and one Fixed line (legend, hint). Edit nothing else for the version.
- [ ] **Step 3: Run** `cd frontend && npm run lint && npx vitest run src/features/reports`. Expected: clean, PASS.
- [ ] **Step 4: Commit** `docs: cost report legend, changelog and version`.
