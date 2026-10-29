import { describe, it, expect } from "vitest";
import type { TFunction } from "i18next";
import { costFiscalYearName, costFiscalYearOptions, fiscalYearLabel } from "./fiscalYear";

// Echo the key and its values so the test pins which form is chosen.
const t = ((key: string, opts: Record<string, unknown>) =>
  `${key} ${JSON.stringify(opts)}`) as unknown as TFunction;

describe("fiscalYearLabel", () => {
  it("names a calendar fiscal year by its year alone", () => {
    expect(fiscalYearLabel(2026, 1, t)).toBe('common:fiscalYear.single {"year":2026}');
  });

  it("names a straddling fiscal year by both years", () => {
    expect(fiscalYearLabel(2026, 10, t)).toBe('common:fiscalYear.span {"from":2025,"to":2026}');
  });

  it.each([2, 7, 12])("names a year starting in month %i by both years", (start) => {
    expect(fiscalYearLabel(2026, start, t)).toBe('common:fiscalYear.span {"from":2025,"to":2026}');
  });

  it.each([0, 13, -1, 1.5, Number.NaN])(
    "falls back to the calendar form for an invalid start month (%s)",
    (start) => {
      expect(fiscalYearLabel(2026, start, t)).toBe('common:fiscalYear.single {"year":2026}');
    },
  );

  it("leaves fiscalYearLabel alone", () => {
    expect(fiscalYearLabel(2026, 10, t)).toBe('common:fiscalYear.span {"from":2025,"to":2026}');
  });
});

describe("costFiscalYearName", () => {
  it("names the current year with Current", () => {
    expect(costFiscalYearName(2026, 2026)).toBe("FY26 - Current");
  });

  it("names next year Forecast", () => {
    expect(costFiscalYearName(2027, 2026)).toBe("FY27 - Forecast");
  });

  it("names a past year bare", () => {
    expect(costFiscalYearName(2024, 2026)).toBe("FY24");
  });

  it("pads a single digit", () => {
    expect(costFiscalYearName(2005, 2005)).toBe("FY05 - Current");
  });
});

describe("costFiscalYearOptions", () => {
  it("lists forecast, current then four past years", () => {
    const options = costFiscalYearOptions(2026);
    expect(options.map((o) => o.label)).toEqual([
      "FY27 - Forecast",
      "FY26 - Current",
      "FY25",
      "FY24",
      "FY23",
      "FY22",
    ]);
    expect(options.map((o) => o.value)).toEqual([2027, null, 2025, 2024, 2023, 2022]);
  });
});
