# Cost report refinements — drill-down, colours, cost-type selector

**Status:** approved by the user 2026-11-05, after a fresh Opus builder-check. **Branch:** `feat/cost-report-refinements` (off `main`, 2.188.3). Frontend only; no new route, no OpenAPI change.

## Intent

The cost report (`frontend/src/features/reports/CostReport.tsx`) lost its cost-type selector when the cost items landed (#50), draws treemap and Sankey in one light blue, shows the yearly trend only in the treemap view, and cannot zoom on one application or group. This work fixes the regression and makes the three views (treemap, Sankey, table) read as one report you can drill into.

## What the user sees

1. **Initiatives are gone** from the report: the type switch offers Application and IT Component only (`COST_REPORT_TYPE_KEYS`). A dedicated Initiative cost page comes later, out of scope. No saved report can carry the Initiative type (the feature exists only on the user's machine); the generic fallback at `CostReport.tsx:433-439` already covers it. Remove `Initiative` from `COST_REPORT_TYPE_KEYS` (`:66`) and from `typeOptions` (`:318-319`).
2. **Cost-type selector is back, in every view.** Options come from the cost item catalogue: **TCO** (all items) plus one option per item (including archived ones, which still count in TCO). Today the selector renders only when the schema has more than one cost field, and after #50 only `costTotalAnnual` remains, so it is hidden.
3. **TCO is always the sum of every catalogue item, archived ones included.** This is today's rule (`card_costs.year_costs`); nothing changes in the backend. The report must never show a TCO that differs from the card's.
4. **Table view:** one column per cost item plus a TCO column that is the sum of them. The selector stays in the table view; it decides the initial sort column and the highlighted column.
5. **Trend chart in all three views.** With Forecast selected, the yearly trend chart shows below the treemap, below the Sankey and below the table (today only under the treemap). Same chart, same data.
6. **Colours** (see below).
7. **Click behaviour, same in treemap, Sankey and table:** left click = analyse (drill-down); right click = open the card in the side panel. A hint line under the chart/table reads "Click: analyse · Right click: open card". The browser context menu is blocked only over the chart/table. Touch devices have no right click: accepted, the card stays reachable from the drill-down view.
8. **Drill-down:**
   - On one **Application / IT Component**: the view shows only that card, broken down by cost item (treemap tiles / Sankey links), and the yearly trend chart shows only that card's trend.
   - On a **group** (when "group by" is on): the view shows the group's members, and the trend shows the group's total per year.
   - A **breadcrumb with Back** climbs one level: `All › Finance › SAP` — Back from a card inside a group returns to the group; from the group to the full view. Each crumb is clickable.
   - Drill-down state resets when the type, cost-type, group-by or fiscal year changes.

## Colours (indicative mockup: [`palette-colori.html`](2026-11-05-cost-report-refinements-design-assets/palette-colori.html))

Chosen proposal: **darker = costlier**. Open the mockup in a browser; where it and this text differ, the text wins. It shows treemap, Sankey, legend and the ungrouped chips in light and dark.

- **Palette:** the 8 categorical hues of the dataviz default palette, in this fixed order, light and dark selected separately (validated colour-blind-safe for the default order; no other order passed in both modes):
  - light `#2a78d6 #eb6834 #1baf7a #eda100 #e87ba4 #008300 #6250d6 #e34948`
  - dark `#3987e5 #d95926 #199e70 #c98500 #d55181 #008300 #9085e9 #e66767`
  - "Other" grey: light `#b4b2a8`, dark `#4b4a45`.
- **Grouped:** each group takes the next hue by size (largest group first), a group's members are shades of that hue, the costliest member darkest. Lightness steps come from mixing the hue with black/white (mockup: members from −22% to +40%; that range is indicative, tune on screen). Groups beyond the 8th, the smallest, fold into one grey **Others** group (in colour and in legend), its members shades of grey. A **legend** lists group → colour.
- **Ungrouped:** each card gets a stable colour derived from its name (hash → one of the 8 hues × 3 lightness steps), so it does not change on reload or when a filter changes the count. No legend (names are on the tiles).
- **Type badge, always on** (icon + type name), also when the report shows only Applications or only IT Components; the user left the choice of diagrams to the agent. Colour stays per card; the type is never read from colour. Where: treemap tile second line (tiles too small for the text print nothing; the tooltip always names the type), Sankey card-node label, the table's name cell, and the tooltip of all three. Icon and label come from the card type's metamodel data (`useTypeLabel`, the type's icon), not hardcoded.
- **Sankey:** group node = group hue, card node = its shade, links take the source colour at ~45% opacity, cost-item nodes neutral grey.
- Because contrast between tile colour and text is not guaranteed for every hue, tile text colour is chosen black/white by luminance, and the table view always exists.
- Tokens: the 8 hues already exist as `CHART_CATEGORICAL` (`tokens.ts:344-347`, picked per theme by `chrome.categorical`, `echartsTheme.ts:54`): reuse them, add only the grey "Others" token. No hardcoded hex elsewhere.
- **Fold is real**, in all three views: groups beyond the 8th become one "Others" frame/node/row with their summed total (Sankey: remap nodes and links), and a click on it drills into the folded members. The existing no-group bucket (`__other__`, "Unspecified", `CostReport.tsx:68`) stays a separate entry in a lighter neutral grey (no hatching) with its own legend label, so there are never two identical "other"s.
- Group size for the hue order is computed on the scoped totals, in every view, so a group keeps its hue across treemap, Sankey and table.
- Delta badges (`COST_DELTA_UP/DOWN`, past years) follow the tile luminance like the text, so they stay readable on light shades.

## Trend data (no backend change)

Verified against the code: the treemap `items` are cards with ONE `cost` each, not a per-item breakdown (`reports.py:1505-1515`); the per-card breakdown exists only in `/reports/cost-sankey` (`nodes[].costs`, `cost_report.py:302-304`). So:

- **Trend:** `CostTrendChart` already calls the treemap route once per year × cost item (`cost_field=<item>`, `CostTrendChart.tsx:35-41`). A card's trend = its `cost` in each response, filtered by id. A group's trend = the sum of its members, so those calls also pass `group_by` (same route, no backend change). The trend respects the page's `CardScopeFilter` (computed client-side from the same items), so its total matches the page.
- **Per-item breakdown of a card (table columns, drill-down tiles/links):** from `/reports/cost-sankey?cost_field=costTotalAnnual` (`nodes[].costs`), not from N treemap calls.
- **Table rows:** the cards with a non-zero value of the selected cost (as the treemap); the per-item and TCO columns come from the breakdown.
- **Trend components (stack order, labels):** taken from the cost item catalogue ordered by `sort_order` (already needed for the selector), so the trend also renders in the Sankey view, where the treemap `components` are not loaded.
- No card-id filter is added to any route; no backend, schema or OpenAPI change.

## Non-goals

- No Initiative cost page; no backend, schema, permission or OpenAPI change.
- No change to TCO semantics (archived items still count; see [the cost items spec](2026-11-03-card-cost-items-design.md)).
- No new palette order; no per-user colour settings.

## Tests and docs owed

- Vitest next to each touched source file: selector options built from the catalogue; table columns and TCO sum; trend chart rendered in all three views; right click opens the card, left click drills; breadcrumb/Back; colour assignment (stable per name, group hue order, fold to Others at the 9th); option builders (`costTreemapOption`, `costSankeyOption`, `costTrendOption`) get the new colour input.
- English-only i18n keys (`reports` namespace), then `/translate`. User docs `docs/guide/reports.md` and screenshots per the two-way contract. Version bump (minor: new behaviour) and `CHANGELOG.md`.
- Chart changes get a render check in the browser pane before the PR (light and dark).

## Agent's calls (not decided by the user — check these)

- Group hue order is by group size (largest first) so the most important group gets the first, most separable hue; the user did not specify the order.
- Ungrouped colour = hash of the card name onto 8 hues × 3 lightness steps.
- Hint-line wording and breadcrumb look are the agent's.
- The drill-down state is kept in component state, not in the URL.
- Cost-item nodes in the Sankey stay neutral grey (the user asked colour for apps/groups only).
- Table sort column on selector change: the chosen cost's column, descending.
- The backend already accepts `cost_field=<item key>` (also archived ones), so the selector needs no backend change; `printParams` (`CostReport.tsx:786`, condition `costFields.length > 1`) is updated with it.
- Shared `components/charts/EChart.tsx` gets an `onContextMenu` prop (ECharts `contextmenu` with the same datum, `preventDefault` on the native event). The treemap group frame datum gets the raw group `key` (labels can collide).
- Sankey: left/right click on a cost-item node or a link does nothing; only group and card nodes react.
- Table drill-down: on a card, the table shows that one row (all item columns already visible); on a group, the group's rows. The row click that opened the side panel becomes drill; right click opens the card.
- Group-trend and "Others" are computed on the same scoped data as the page.
