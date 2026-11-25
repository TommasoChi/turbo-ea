# Cost report: a Provider on each cost item, group by Provider, field and relation filters

Part 2 of 2. Part 1 is `2026-11-25-cost-report-legend-and-hint-design.md` (frontend only, ships first). This part adds a stored field, so it has a backend, a migration check and workspace transfer.

## Why

The cost of an Application or IT Component is a sum of items (Infrastructure, Application, …). Today nobody can say which supplier an item is paid to, so the report cannot answer "how much do we spend with provider X". Separately, the cost report cannot be narrowed by the card's own fields, while the PPM initiative board can.

## Goals

1. **Provider on a cost item.** In "Edit cost item" a new Provider field. One provider per item (a deliberate simplification: an item might in reality have several; not now).
2. **Group by Provider** in the cost report (treemap, Sankey, table): costs add up per provider.
3. **Field and relation filters** in the cost report: one filter group for Application and one for IT Component, shown according to the card-type toggle (Application, IT Component, or both). Same look as the PPM initiative filter; the relation facets are included, so Provider is filterable.

## Non-goals

- Several providers per item. A split of one item across providers.
- Provider on Initiative or Provider cards (they keep `cost` fields and `card_cost_history`).
- Provider column in the Excel cost import, an MCP tool for cost items, provider in the cost history chart.
- Changing the existing "Related by" block of other reports.

## Provider on a cost item

**Stored** in the item's JSONB: `card_costs.items[key] = {amount, renewal_date, provider_id}`, `provider_id` optional, a card id of type `Provider`. No new column, so no schema migration; `CostItemWrite` and `CostLineOut` carry it, and `CostLineOut` also carries `provider_name` (resolved under the reader's scope, null when unreadable). Copy-to-Forecast and the "latest earlier year" fallback copy it with the item: `_shifted` in `card_costs.py` adds `provider_id`; the generic `yearly_rows` is untouched, so licenses do not change.

**Write semantics.** A body without `provider_id` keeps the stored one (`model_fields_set`); an explicit `null` clears it. `upsert_item` therefore keeps `provider_id` unless it is told otherwise, so the Excel import (`cost_import.py`), which does not know the field, never wipes providers; a test pins it.

**Candidates** for the picker: ACTIVE Provider cards the caller can read, linked to the card, to any of its ancestors or to any of its descendants (the whole hierarchy is walked; an unreadable ancestor does not stop the walk, it only drops itself) through `relProviderToApp` (Application) or `relProviderToITC` (IT Component). A new read endpoint on the card returns `id` and `name`; it needs `can_edit_costs` (the rule of `_load_for_edit`): hidden card 404, no edit right 403. Picking is optional and clearable. A plain select, not `CardPicker`: the list is short.

**Validation.** On write a **new** `provider_id` must be among the candidates, otherwise 400 (`CostError("invalid_provider")` mapped to 400 in `_STATUS`). A `provider_id` equal to the one already stored is accepted without that check, so changing only an amount on an item whose provider was archived or unlinked later still saves; the same holds for copy-to-Forecast. The stored id stays the truth and the item still counts in the report; the dialog shows the stored provider by `provider_name`.

**Visibility.** The provider is shown only to people who can see the amounts (the per-card cost rule in `cost-items.md`). A provider card the reader cannot read appears as no provider (`provider_name` and `provider_id` both `null`). **A write never drops a link the caller could not see**: if the stored provider exists but is unreadable to the caller, a missing or `null` `provider_id` leaves it untouched; a stored provider whose card was deleted is not a hidden one and a `null` clears it. See "Agent's calls" for what happens when the caller picks a new one.

**History and events.** `card.costs_updated` keeps carrying item keys only. Event redaction needs no new key.

**Workspace transfer.** `CardCosts` carries `items` JSONB, so the `provider_id` inside it is remapped like any card id on import and a provider absent from the target is dropped. The section leaves `ID_FREE_COLUMNS` (`id_bearing_columns=("items",)` with a `rewrite` in `remap.py` through `IdMap`), joins `test_the_sections_that_hold_ids_are_the_known_ones`, and the round-trip test runs on an emptied inventory. Follows `workspace-transfer.md`.

## Group by Provider

`group_by` gains a third form, `provider`, next to `field:<key>` and `rel:<key>`, on `/reports/cost-treemap` and `/reports/cost-sankey` (the page uses only these two; `/reports/cost` is untouched). It groups **items, not cards**: each item's amount goes to the group of its own provider. Items with no provider, and providers whose card is deleted or unreadable, go to the existing `__other__` bucket ("Unspecified"). `group_by=provider` on a type that has no cost items answers 400.

- **Group key is the provider's card id**, with the name in the response, so two providers with the same name stay apart; archived providers keep their own group (unlike `rel:` grouping, which reads only ACTIVE cards).
- **A cost is counted once.** The total of all groups equals the total without grouping.
- **Sankey.** Items → groups → cards, as today; the item amounts now land in provider groups.
- **Treemap and table.** A card whose items belong to two providers is returned as one entry per (card, provider), same card `id`, each with its own share; opening a tile opens the card. Page-side maps that key on the card id (`baselineCosts`, `priorYearCosts`, `applyScope`, the drill, the colour shades, row keys) use a composite key `(card, group)`. The delta badge and the year-on-year % are computed per share: the baseline and prior-year fetches pass `group_by` too. A test pins both.
- The group-by selector lists "Provider" for Application, IT Component and the combined view.
- Colours, the 8-hue limit and "Others" follow the existing rules unchanged (`costColors.ts`).

## Field and relation filters

The cost report shows `CardFilterSection` (shared by Lifecycle, Portfolio, the PPM board and the portals admin) once per selected type, with that type's `cardTypeKey`. The look is the PPM initiative filter, the whole section, unchanged for the other reports: the **Related by** row (Provider among the relation facets, with its *Include sub-cards* switch) and the **Fields** row (the single-select, multi-select and boolean fields of the type, `isFacetField`, and the card sub-type). The cost report passes no tag groups. Both groups are active only when their type is selected; in the combined view each filter applies to its own type's cards.

A filter narrows which cards count. It is **evaluated on the server**: `cost-treemap` and `cost-sankey` take the filter value (field and relation filters, as the portals' filters do) and apply it under `CardReadScope`, so the treemap, Sankey, table and yearly trend all see the same cards; it combines with AND with the card-scope filter and the fiscal year, and is saved with the report config like the scope. The facet options come from a new `GET /reports/cost-filter-options` (gated on `costs.view`, scoped by `CardReadScope`, sharing its payload builder with the web-portal filter options, which need `web_portals.manage`). Filtering by the Provider relation matches **cards linked to that provider**; it is independent of the item-level provider used for grouping.

## Agent's calls (check them)

- A card with items from two providers is split across the groups in treemap and table (the alternative, one tile per card under its largest provider, hides money).
- The Provider filter is the card-level relation facet, not the item-level provider.
- Items recorded before this feature have no provider and land in "Unspecified"; nothing is back-filled from the card's linked provider.
- The provider is stored in the JSONB, not in a new column.

- Saving an item whose stored provider the caller cannot read: a missing or `null` `provider_id` leaves the hidden one untouched; a new valid pick **replaces** it. Confirmed by the owner.

## Left to the builder

The exact endpoint name for the candidates and the filter parameter shape; the Excel import and MCP are out of scope.

## Acceptance

- Edit cost item shows Provider with the right candidates (card, parents, children); a hidden or unlinked provider is refused or untouched as described.
- Group by Provider sums to the ungrouped total, in all three views and in the Sankey.
- Application-only, IT-Component-only and combined modes show the right filter groups; a Provider relation filter narrows the report.
- Exported and re-imported workspace keeps `provider_id` on the right cards.
- Tests: service and API tests for write, read, redaction and candidates (success, 403/404, rejected provider); `group_by=provider` parity with the ungrouped total; transfer round trip; frontend tests for the dialog, the selector and the filter groups.
- Docs and translations (nine locales, via `/translate`); a changelog entry and a version bump.
