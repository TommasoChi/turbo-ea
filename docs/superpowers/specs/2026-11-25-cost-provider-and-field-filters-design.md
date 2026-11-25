# Cost report: a Provider on each cost item, group by Provider, field and relation filters

Part 2 of 2. Part 1 is `2026-11-25-cost-report-legend-and-hint-design.md` (frontend only, ships first). This part adds a stored field, so it has a backend, a migration check and workspace transfer.

## Why

The cost of an Application or IT Component is a sum of items (Infrastructure, Application, …). Today nobody can say which supplier an item is paid to, so the report cannot answer "how much do we spend with provider X". Separately, the cost report cannot be narrowed by the card's own fields, while the PPM initiative board can.

## Goals

1. **Provider on a cost item.** In "Edit cost item" a new Provider field. One provider per item (a deliberate simplification: an item might in reality have several; not now).
2. **Group by Provider** in the cost report (treemap, Sankey, table): costs add up per provider.
3. **Field and relation filters** in the cost report: one filter group for Application and one for IT Component, shown according to the card-type toggle (Application, IT Component, or both). Same look as the PPM initiative filter, only the "Fields" section, which here also lists the relation facets (so Provider is filterable).

## Non-goals

- Several providers per item. A split of one item across providers.
- Provider on Initiative or Provider cards (they keep `cost` fields and `card_cost_history`).
- Provider column in the Excel cost import, an MCP tool for cost items, provider in the cost history chart.
- Changing the existing "Related by" block of other reports.

## Provider on a cost item

**Stored** in the item's JSONB: `card_costs.items[key] = {amount, renewal_date, provider_id}`, `provider_id` optional, a card id of type `Provider`. No new column, so no schema migration; the cost schemas (`CostItemWrite`, `CostLineOut`) and `card_costs.upsert_item` / `_lines` carry it. Copy-to-Forecast and the "latest earlier year" fallback copy it with the item.

**Candidates** for the picker: Provider cards linked to the card, to any of its ancestors, or to any of its descendants, through `relProviderToApp` (Application) or `relProviderToITC` (IT Component). A new read endpoint on the card returns them (`id`, `name`), scoped by `CardReadScope`: a provider the caller cannot read is not listed. Picking is optional and clearable. The dialog reuses the existing control style; the list is short, so a plain select, not `CardPicker`.

**Validation.** On write the server checks that `provider_id` is a readable Provider card that is among the candidates; otherwise 400. A provider archived or unlinked later stays on the item and still counts in the report (the stored id is the truth); the dialog shows it as is until changed.

**Visibility.** The provider is shown only to people who can see the amounts (the per-card cost rule in `cost-items.md`). A provider card the reader cannot read appears as no provider. **A write never drops a link the caller could not see**: saving an item with a provider the caller cannot read leaves it untouched.

**History and events.** `card.costs_updated` keeps carrying item keys only. Event redaction needs no new key.

**Workspace transfer.** `CardCosts` carries `items` JSONB, so the `provider_id` inside it must be remapped like any card id on import, and a provider absent from the target is dropped. This is a transfer change and follows `workspace-transfer.md`.

## Group by Provider

`group_by` gains a third form, `provider`, next to `field:<key>` and `rel:<key>`, on `/reports/cost-treemap`, `/reports/cost-sankey` and `/reports/cost`. It groups **items, not cards**: each item's amount goes to the group of its own provider. Items with no provider go to the existing `__other__` bucket ("Unspecified").

- **A cost is counted once.** The total of all groups equals the total without grouping.
- **Sankey.** Items → groups → cards, as today; the item amounts now land in provider groups.
- **Treemap and table.** A card whose items belong to two providers appears in both groups with each provider's share. Each tile shows that share. Opening a tile opens the card.
- The group-by selector lists "Provider" for Application, IT Component and the combined view.
- Colours, the 8-hue limit and "Others" follow the existing rules unchanged (`costColors.ts`).

## Field and relation filters

The cost report shows `CardFilterSection` (already shared by Lifecycle, Portfolio and the PPM board) once per selected type, with that type's `cardTypeKey`. Only the **Fields** section is shown: the single-select, multi-select and boolean fields of the type (`isFacetField`), plus the relation facets of the type (Provider among them). Both groups are active only when their type is selected; in the combined view each filter applies to its own type's cards.

A filter narrows which cards count. It applies to the treemap, the Sankey, the table and the yearly trend, combined with AND with the card-scope filter, and with the fiscal year. It is saved with the report config like the scope. Filtering by the Provider relation matches **cards linked to that provider**; it is independent of the item-level provider used for grouping.

## Agent's calls (check them)

- A card with items from two providers is split across the groups in treemap and table (the alternative, one tile per card under its largest provider, hides money).
- The Provider filter is the card-level relation facet, not the item-level provider.
- Items recorded before this feature have no provider and land in "Unspecified"; nothing is back-filled from the card's linked provider.
- The provider is stored in the JSONB, not in a new column.

## Left to the builder

Where the filter is evaluated (the server takes the filter value, or the client resolves it to card ids and passes them like the scope); the exact endpoint name for the candidates; the Excel import and MCP are out of scope.

## Acceptance

- Edit cost item shows Provider with the right candidates (card, parents, children); a hidden or unlinked provider is refused or untouched as described.
- Group by Provider sums to the ungrouped total, in all three views and in the Sankey.
- Application-only, IT-Component-only and combined modes show the right filter groups; a Provider relation filter narrows the report.
- Exported and re-imported workspace keeps `provider_id` on the right cards.
- Tests: service and API tests for write, read, redaction and candidates (success, 403/404, rejected provider); `group_by=provider` parity with the ungrouped total; transfer round trip; frontend tests for the dialog, the selector and the filter groups.
- Docs and translations (nine locales, via `/translate`); a changelog entry and a version bump.
