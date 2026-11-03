import { describe, it, expect } from "vitest";
import {
  COST_ITEM_TYPES,
  RENEWAL_NEAR_DAYS,
  isCostItemType,
  isRenewalNear,
  reportItemLabel,
  shortFiscalYear,
  withDerivedCostFields,
} from "./costItems";

describe("isRenewalNear", () => {
  const today = "2026-01-01";
  it("is near at 89 and 90 days, not at 91", () => {
    expect(RENEWAL_NEAR_DAYS).toBe(90);
    expect(isRenewalNear("2026-03-31", today)).toBe(true); // 89
    expect(isRenewalNear("2026-04-01", today)).toBe(true); // 90
    expect(isRenewalNear("2026-04-02", today)).toBe(false); // 91
  });
  it("flags a renewal already past, ignores a missing or malformed date", () => {
    expect(isRenewalNear("2025-12-01", today)).toBe(true);
    expect(isRenewalNear(null, today)).toBe(false);
    expect(isRenewalNear("nope", today)).toBe(false);
  });
});

describe("cost item types", () => {
  it("mirrors the backend list", () => {
    expect(COST_ITEM_TYPES).toEqual(["Application", "ITComponent"]);
    expect(isCostItemType("ITComponent")).toBe(true);
    expect(isCostItemType("Initiative")).toBe(false);
  });
  it("names a fiscal year FYnn", () => {
    expect(shortFiscalYear(2026)).toBe("FY26");
    expect(shortFiscalYear(2005)).toBe("FY05");
  });
  it("adds the derived total to the cost-item types only, once", () => {
    const m = withDerivedCostFields({ Application: ["riskScore"], Initiative: ["x"] });
    expect(m.Application).toEqual(["riskScore", "costTotalAnnual"]);
    expect(m.ITComponent).toEqual(["costTotalAnnual"]);
    expect(m.Initiative).toEqual(["x"]);
    expect(withDerivedCostFields(m).Application).toEqual(["riskScore", "costTotalAnnual"]);
  });
});

describe("reportItemLabel", () => {
  const labels = { lic: { label: "Licences", translations: { it: { label: "Licenze" } } } };
  it("prefers the locale translation, then the label", () => {
    expect(reportItemLabel(labels, "lic", "it")).toBe("Licenze");
    expect(reportItemLabel(labels, "lic", "de")).toBe("Licences");
  });
  it("is undefined for a key the report does not know", () => {
    expect(reportItemLabel(labels, "zzz", "it")).toBeUndefined();
    expect(reportItemLabel(undefined, "lic")).toBeUndefined();
  });
});
