/**
 * Fiscal-year presentation helpers shared by every screen that shows one.
 *
 * A fiscal year is named after the calendar year it ENDS in — with an October
 * start, 1 October 2025 opens FY2026 — the convention the backend's
 * `app/services/fiscal_year.py` and the PPM charts' `costChartData.ts` use.
 * The workspace's start month comes from Admin → Settings (`fiscalYearStart`,
 * 1-12, January by default).
 */
import type { TFunction } from "i18next";

function validStart(startMonth: number): boolean {
  return Number.isInteger(startMonth) && startMonth >= 1 && startMonth <= 12;
}

/**
 * How a fiscal year is named on screen: "FY 2026" when it is the calendar
 * year, "FY 2025–2026" when it straddles two — naming only the end year there
 * would read as the calendar year to anyone who does not know the convention.
 */
export function fiscalYearLabel(fy: number, startMonth: number, t: TFunction): string {
  return !validStart(startMonth) || startMonth === 1
    ? t("common:fiscalYear.single", { year: fy })
    : t("common:fiscalYear.span", { from: fy - 1, to: fy });
}

/**
 * The cost report's year picker names a year "FY26", tagging the current one
 * "Current" and the next "Forecast". Plain English on purpose: these are
 * fixed report labels, not translated strings.
 */
export function costFiscalYearName(fy: number, currentFy: number): string {
  const name = `FY${String(fy % 100).padStart(2, "0")}`;
  if (fy === currentFy) return `${name} - Current`;
  return fy === currentFy + 1 ? `${name} - Forecast` : name;
}

/** Picker entries: forecast, current (`value: null` = no year sent), then four past years. */
export function costFiscalYearOptions(
  currentFy: number,
): { value: number | null; label: string }[] {
  const years = [currentFy + 1, currentFy, ...[1, 2, 3, 4].map((n) => currentFy - n)];
  return years.map((fy) => ({
    value: fy === currentFy ? null : fy,
    label: costFiscalYearName(fy, currentFy),
  }));
}
