import { countActiveFilters } from "./cardFilters";
import type { CardFilterValue } from "./cardFilters";

/** One filter value per card type key. */
export type CostCardFilters = Record<string, CardFilterValue>;

/** The `card_filters` query value: the active filter of each selected type, or undefined when none. */
export function costCardFiltersParam(
  filters: CostCardFilters,
  typeKeys: string[],
): string | undefined {
  const active: CostCardFilters = {};
  for (const key of typeKeys) {
    const v = filters[key];
    // The cost report offers no tag groups, so a tag pick never narrows it.
    if (v && countActiveFilters({ ...v, tagFilterIds: [] }) > 0) active[key] = v;
  }
  return Object.keys(active).length > 0 ? JSON.stringify(active) : undefined;
}
