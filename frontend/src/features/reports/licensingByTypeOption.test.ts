import { describe, expect, it } from "vitest";
import { buildEChartsChrome } from "@/components/charts/echartsTheme";
import { buildByTypeOption, type ByTypeBar } from "./licensingByTypeOption";

/* eslint-disable @typescript-eslint/no-explicit-any -- option trees are plain JSON here */

const chrome = buildEChartsChrome({
  mode: "light",
  text: { primary: "#111111", secondary: "#555555" },
  divider: "#dddddd",
  background: { paper: "#ffffff" },
  action: { hover: "#eeeeee" },
});

const BARS: ByTypeBar[] = [
  { key: "admin", label: "Admin", licensed: 10, actual: 12, color: "c1" },
  { key: "dev", label: "Dev", licensed: 5, actual: null, color: "c2" },
];

const build = (isRtl = false) =>
  buildByTypeOption(BARS, { chrome, isRtl, licensedLabel: "Licensed", actualLabel: "Actual" }) as any;

describe("buildByTypeOption", () => {
  it("one licensed and one actual series per type, licensed faded", () => {
    const o = build();
    expect(o.xAxis.data).toEqual(["Admin", "Dev"]);
    const [licensed, actual] = o.series;
    expect(licensed.name).toBe("Licensed");
    expect(actual.name).toBe("Actual");
    expect(licensed.data.map((d: any) => d.value)).toEqual([10, 5]);
    expect(licensed.data[0].itemStyle).toMatchObject({ color: "c1", opacity: 0.35 });
    expect(actual.data[0].itemStyle.color).toBe("c1");
    expect(actual.data[0].itemStyle.opacity).toBeUndefined();
  });

  it("missing actual shows a dash label", () => {
    const o = build();
    const missing = o.series[1].data[1];
    expect(missing.value).toBe(0);
    expect(missing.label.formatter()).toBe("—");
    expect(o.series[1].data[0].label).toBeUndefined();
  });

  it("mirrors in RTL", () => {
    expect(build(true).xAxis.inverse).toBe(true);
    expect(build().xAxis.inverse).toBe(false);
  });
});
