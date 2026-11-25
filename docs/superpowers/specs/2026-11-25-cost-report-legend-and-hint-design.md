# Cost report: legend aligned and clickable, hint clear of the fullscreen icon

Part 1 of 2. Part 2 is `2026-11-25-cost-provider-and-field-filters-design.md`. This part ships first and changes the frontend only.

## Why

Three small defects in `/reports/cost`, seen while using the grouped treemap and Sankey:

1. With a group-by, the colour legend sits below the treemap or Sankey. When you navigate inside the diagram (drill into a group, then a card) the breadcrumb above it follows, but the legend keeps listing every group: it does not line up with the navigation level. It is also outside the fullscreen container, so in fullscreen it is not shown at all.
2. The legend is only a key. People read a group's colour, then have to right-click a tile to drill into the group. They expect to click the legend entry.
3. The hint "Click: open card · Right click: analyse" is right-aligned in the breadcrumb bar, exactly where the fullscreen icon sits, in all three views (treemap, Sankey, table).

## Goals

- The legend follows the navigation: it always describes the level the breadcrumb is at.
- The legend stays below its diagram, inside the fullscreen container, so it stays visible in fullscreen.
- A click on a legend entry drills into that group, exactly as a right click on a group tile does, and the breadcrumb updates.
- The hint and the fullscreen icon never overlap, at any width, in treemap, Sankey and table.

## Non-goals

- No legend on the table (it has group rows with swatches and already drills by right click). No new legend content, no change to colours or grouping rules.
- No new URL state for the drill: it stays in component state (`CostReport.tsx`, `drill`).
- No backend change.

## Behaviour

**Hint and icon.** `CostDrillBar` reserves space on its right for the fullscreen icon (`FullscreenPanel` places it absolute, top 4, right 4), so the hint ends before the icon. The bar is shared by the three views, so one change fixes all three. When the bar wraps on a narrow screen the hint drops to its own line, still clear of the icon.

**Legend follows the drill.** By breadcrumb level: *All* lists every group, as today. *Inside a group* lists that group only, marked as current (Others lists the Others entry). *Inside a card* the legend follows what the chart colours: in the treemap, the card's cost items with the colours its tiles use (today those reuse the group hues, which reads wrongly under a group legend); in the Sankey, the group the card sits in (the Sankey keeps its group node, and its cost-item nodes are neutral grey, so they are not listed). The legend never contradicts the chart. Going Back restores the level above. With no group-by the legend shows only at card level.

**Legend placement.** `CostLegend` moves into the child function of `FullscreenPanel`, right after `CostTreemapPanel` / `CostSankeyPanel`, outside the chart's `Paper` (inside it the legend would sit 8px in from the breadcrumb). Outside fullscreen nothing shifts: the breadcrumb and the legend already share a left edge. In fullscreen the `Paper` is `flex: 1, minHeight: 0`, so the legend takes its natural height below it.

**Legend click.** Each entry is a real button (keyboard focusable, visible focus ring, `aria-label` = the entry's label). Click is `setDrill({ group: entry.key })`. The legend already holds one `OTHERS_KEY` entry (`assignGroupColors`, `costColors.ts`) and never an entry per folded group, so no key mapping is needed; clicking Others drills into `{ group: "__others__" }` and the breadcrumb shows `cost.others`. The "Unspecified" bucket (`__other__`) is drillable too. The entry of the group currently drilled is marked (bold label, outline). Clicking it again does nothing; Back in the breadcrumb goes up as today. With no group-by there is no legend and nothing changes.

## Agent's calls (check them)

- Confirmed by the owner: the legend stays below its own diagram and must line up with the navigation tree while you navigate (it follows the drill level).
- Inside a group the legend lists that group only; inside a card it lists the card's cost items.
- Left click on the legend selects the group; there is no multi-select and no "click again to clear".

## Left to the builder

Exact spacing values, whether the marked entry uses an outline or a background, the narrow-width wrap rule.

## Acceptance

- In treemap and Sankey with a group-by, the legend is inside the panel and visible in fullscreen, and at each breadcrumb level (All, group, card) it lists what that level shows; Back restores the previous one.
- Clicking a legend entry drills into that group in all grouped views and the breadcrumb shows it; clicking Others drills into `{ group: "__others__" }` and the breadcrumb reads `cost.others`.
- The hint and the fullscreen icon do not overlap in treemap, Sankey and table, at desktop and phone width.
- Tests: `CostLegend.test.tsx` (click, keyboard, marked entry; the Others entry's label is "Others (N groups)" from `groupDisplayLabel`, the breadcrumb's is "Others"), `CostDrillBar.test.tsx` (jsdom has no layout, so assert the reserved right padding with `toHaveStyle`), `CostReport.test.tsx` (legend click updates the breadcrumb, in a grouped treemap and Sankey). The real overlap is checked by hand at desktop and 375px and written in the Test Plan. Translations: none new (the hint keeps `cost.drillHint`).
- Docs: `docs/guide/reports.md`, the legend and drill-down paragraphs (click on the legend, legend visible in fullscreen); retake the affected screenshot if one shows the legend.
