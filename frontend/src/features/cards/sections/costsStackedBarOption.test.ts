import { describe, it, expect } from "vitest";
import { buildCostsStackedBarOption, type CostBarSegment } from "./costsStackedBarOption";
import type { EChartsChrome } from "@/components/charts/echartsTheme";

const chrome = {
  fontFamily: "x",
  textPrimary: "#000",
  textSecondary: "#111",
  divider: "#222",
  hover: "#333",
  tooltipBackground: "#fff",
} as unknown as EChartsChrome;

const segs: CostBarSegment[] = [
  { key: "lic", label: "Licences", amount: 100, color: "#aaa" },
  { key: "old", label: "Legacy", amount: 0, color: "#bbb" },
  { key: "sup", label: "Support", amount: 50, color: "#ccc" },
];
const opt = (faded = false, isRtl = false) =>
  buildCostsStackedBarOption(segs, { chrome, isRtl, format: (v) => `$${v}`, faded }) as {
    series: { name: string; stack: string; data: number[]; itemStyle: { color: string; opacity: number } }[];
    xAxis: { inverse: boolean };
    tooltip: { valueFormatter: (v: unknown) => string };
  };

describe("buildCostsStackedBarOption", () => {
  it("stacks one segment per non-zero line, in order, with its colour", () => {
    const o = opt();
    expect(o.series.map((s) => [s.name, s.data[0], s.itemStyle.color])).toEqual([
      ["Licences", 100, "#aaa"],
      ["Support", 50, "#ccc"],
    ]);
    expect(new Set(o.series.map((s) => s.stack)).size).toBe(1);
  });
  it("fades an unconfirmed year and mirrors in RTL", () => {
    expect(opt(false).series[0].itemStyle.opacity).toBe(1);
    expect(opt(true).series[0].itemStyle.opacity).toBeLessThan(1);
    expect(opt(false, true).xAxis.inverse).toBe(true);
  });
  it("formats tooltip values with the currency formatter", () => {
    expect(opt().tooltip.valueFormatter(150)).toBe("$150");
  });
});
