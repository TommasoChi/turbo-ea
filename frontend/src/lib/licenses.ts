import type { TFunction } from "i18next";
import { STATUS_COLORS } from "@/theme/tokens";
import type { LicenseMetric, LicenseStatus, LicenseTypeStatus } from "@/types";

/** Card types that hold licenses (mirrors `LICENSE_TYPES` in the backend). */
export const LICENSE_TYPES: readonly string[] = ["Application", "ITComponent"];
export const LICENSE_METRICS: readonly LicenseMetric[] = ["users", "installations"];

export const isLicenseType = (typeKey: string): boolean => LICENSE_TYPES.includes(typeKey);

/** Highest priority first. */
export const STATUS_ORDER: readonly LicenseStatus[] = [
  "over",
  "approaching",
  "no_actual_data",
  "compliant",
];

export function statusColor(s: LicenseStatus | LicenseTypeStatus): string {
  if (s === "over") return STATUS_COLORS.error;
  if (s === "approaching") return STATUS_COLORS.warning;
  if (s === "compliant") return STATUS_COLORS.success;
  return STATUS_COLORS.neutral;
}

/** `120 %`, the "no license" text for licensed 0 with actual > 0, or a dash with nothing to show. */
export function formatPct(pct: number | null, noLicence: boolean, t: TFunction): string {
  if (noLicence) return t("cards:licensing.noLicense");
  return pct == null ? "—" : `${pct} %`;
}
