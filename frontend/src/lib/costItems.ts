import { parseIsoDate, todayIsoDate } from "@/lib/dates";

/** Card types whose cost is a list of cost items (mirrors `COST_ITEM_TYPES` in the backend). */
export const COST_ITEM_TYPES: readonly string[] = ["Application", "ITComponent"];

/** The derived total those types keep in `attributes`: read-only, the items are the source. */
export const DERIVED_COST_FIELD = "costTotalAnnual";

/** A renewal this many days away (or already past) is flagged on its tile. */
export const RENEWAL_NEAR_DAYS = 90;

export const isCostItemType = (typeKey: string): boolean => COST_ITEM_TYPES.includes(typeKey);

/** `FY26` for the fiscal year 2026 (named after the calendar year it ends in). */
export const shortFiscalYear = (fy: number): string => `FY${String(fy % 100).padStart(2, "0")}`;

/** Whether an ISO renewal date falls within `RENEWAL_NEAR_DAYS` of `today` (past dates included). */
export function isRenewalNear(date: string | null | undefined, today: string = todayIsoDate()): boolean {
  const d = parseIsoDate(date);
  const t = parseIsoDate(today);
  if (!d || !t) return false;
  const days = Math.round((d.getTime() - t.getTime()) / 86_400_000);
  return days <= RENEWAL_NEAR_DAYS;
}

/** A calculated-fields map with the derived cost total added for the cost-item types. */
export function withDerivedCostFields(map: Record<string, string[]>): Record<string, string[]> {
  const out = { ...map };
  for (const type of COST_ITEM_TYPES) {
    const keys = out[type] ?? [];
    if (!keys.includes(DERIVED_COST_FIELD)) out[type] = [...keys, DERIVED_COST_FIELD];
  }
  return out;
}

/** One entry of a cost report's `item_labels` (`translations` is `{locale: {label}}`). */
export interface ReportItemLabel {
  label: string;
  translations?: Record<string, { label?: string }>;
}

/** The report's label for a cost item key in `locale`, or `undefined` when the key is unknown. */
export function reportItemLabel(
  labels: Record<string, ReportItemLabel> | undefined,
  key: string,
  locale?: string,
): string | undefined {
  const entry = labels?.[key];
  if (!entry) return undefined;
  return (locale && entry.translations?.[locale]?.label) || entry.label;
}
