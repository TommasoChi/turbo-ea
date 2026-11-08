import { describe, expect, it } from "vitest";
import type { TFunction } from "i18next";
import { STATUS_COLORS } from "@/theme/tokens";
import { isLicenseType, formatPct, statusColor, STATUS_ORDER } from "./licenses";

const t = ((key: string) => key) as unknown as TFunction;

describe("licenses helpers", () => {
  it("maps each status to its semantic token", () => {
    expect(statusColor("over")).toBe(STATUS_COLORS.error);
    expect(statusColor("approaching")).toBe(STATUS_COLORS.warning);
    expect(statusColor("compliant")).toBe(STATUS_COLORS.success);
    expect(statusColor("no_actual_data")).toBe(STATUS_COLORS.neutral);
    expect(statusColor("no_data")).toBe(STATUS_COLORS.neutral);
    expect(STATUS_ORDER).toEqual(["over", "approaching", "no_actual_data", "compliant"]);
  });

  it("formats pct, no license and missing", () => {
    expect(formatPct(120, false, t)).toBe("120 %");
    expect(formatPct(83.3, false, t)).toBe("83.3 %");
    expect(formatPct(null, true, t)).toBe("cards:licensing.noLicense");
    expect(formatPct(null, false, t)).toBe("—");
  });

  it("knows the license-bearing card types", () => {
    expect(isLicenseType("Application")).toBe(true);
    expect(isLicenseType("ITComponent")).toBe(true);
    expect(isLicenseType("Platform")).toBe(false);
  });
});
