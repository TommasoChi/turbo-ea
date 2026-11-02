# Backlog

Things noticed while working on `fix/cost-report` that are out of scope for it. One entry each: what, why it matters, rough size.

## Extend relations to subtypes

**What.** Relation types are defined between card *types* only (for example Application → ITComponent), never between *subtypes*. Cardinality (`1:1`, `1:n`, `n:m`) is also set per relation type, so it cannot differ by subtype.

**Why it matters.** Found while specifying "Group by linked card" in the cost report (`2026-10-30-cost-report-types-sankey-fullscreen-design.md`): every relation on the instance is `n:m`, so no linked card can be offered as a group. Subtype-level relations and cardinality would let a relation be `n:1` for one subtype only.

**Size.** Believed very high: touches the metamodel, relation validation, every relation writer (`relation_orientation.py`), the metamodel editor, importers, workspace transfer and the UI pickers. Needs its own brainstorm and spec before any estimate.

## Cost report: load once, compute in the browser, with a Refresh button

**What.** Today every change of card type, cost field, group-by, fiscal year or view asks the server again (`CostReport.tsx`, the request effect). Instead, one request per card-type selection would return, per card, the cost of every cost field for every fiscal year (current − 4 … Forecast), the "does it count in that year" decision already applied by the server (`is_live_in_fiscal_year` stays the single definition), the attributes, and the names of the linked cards usable as a group (relations with at most one link per card). Year, cost field, group-by, view and scope then change in the browser with no request; only changing the card type reloads. A **Refresh** button in the report reloads the data (there is none in the cost report today).

**Why it matters.** The history chart on Forecast sends one full treemap request per year per cost field (4 fields = 24 requests, each with every card's attributes) and the Sankey rereads all cards once per cost item. With thousands of cards the report is slow and loads the backend. The same payload would also give the Sankey the true per-item values after the scope filter, which it estimates today.

**Size.** Medium: a new response shape, so a new route (OpenAPI regeneration, VAPT), then a frontend rewrite of how `CostReport.tsx`, `CostTrendChart.tsx` and the Sankey read their data. `GET /reports/cost-treemap` stays for the MCP tool. Estimated payload under 1 MB for 2,000 cards × 4 fields × 6 years (not measured). Needs its own spec and plan.
