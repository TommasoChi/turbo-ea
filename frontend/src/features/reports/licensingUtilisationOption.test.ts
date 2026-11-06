import { describe, expect, it } from "vitest";
import { buildEChartsChrome } from "@/components/charts/echartsTheme";
import { STATUS_COLORS } from "@/theme/tokens";
import {
  buildUtilisationOption,
  utilisationHeight,
  type UtilisationBar,
} from "./licensingUtilisationOption";

/* eslint-disable @typescript-eslint/no-explicit-any -- option trees are plain JSON here */

const chrome = buildEChartsChrome({
  mode: "light",
  text: { primary: "#111111", secondary: "#555555" },
  divider: "#dddddd",
  background: { paper: "#ffffff" },
  action: { hover: "#eeeeee" },
});

const bar = (o: Partial<UtilisationBar> & { id: string }): UtilisationBar => ({
  name: o.id,
  pct: 50,
  noLicence: false,
  status: "compliant",
  ...o,
});

const build = (bars: UtilisationBar[], isRtl = false) =>
  buildUtilisationOption(bars, { chrome, isRtl, noData: "No data", noLicense: "No license" }) as any;

describe("buildUtilisationOption", () => {
  it("sorts by pct desc, no-license first, no-data last", () => {
    const o = build([
      bar({ id: "low", pct: 10 }),
      bar({ id: "nodata", pct: null, status: "no_actual_data" }),
      bar({ id: "high", pct: 130, status: "over" }),
      bar({ id: "nolic", pct: null, noLicence: true, status: "over" }),
    ]);
    expect(o.yAxis.data).toEqual(["nolic", "high", "low", "nodata"]);
    expect(o.series[0].data.map((d: any) => d.id)).toEqual(["nolic", "high", "low", "nodata"]);
  });

  it("colours by status token, markLine 80 and 100", () => {
    const o = build([
      bar({ id: "a", pct: 120, status: "over" }),
      bar({ id: "b", pct: 85, status: "approaching" }),
      bar({ id: "c", pct: 20, status: "compliant" }),
      bar({ id: "d", pct: null, status: "no_actual_data" }),
    ]);
    const colours = o.series[0].data.map((d: any) => d.itemStyle.color);
    expect(colours).toEqual([
      STATUS_COLORS.error,
      STATUS_COLORS.warning,
      STATUS_COLORS.success,
      STATUS_COLORS.neutral,
    ]);
    expect(o.series[0].markLine.data.map((d: any) => d.xAxis)).toEqual([80, 100]);
    expect(o.series[0].markArea.data).toHaveLength(3);
  });

  it("no-license bar at the axis max", () => {
    const o = build([bar({ id: "x", pct: 300, status: "over" }), bar({ id: "n", pct: null, noLicence: true, status: "over" })]);
    expect(o.xAxis.max).toBe(310);
    expect(o.series[0].data[0].value).toBe(310);
    expect(o.series[0].data[0].label.formatter()).toBe("No license");
  });

  it("keeps the axis at 120 for low values, draws no-data at 0 and labels it", () => {
    const o = build([bar({ id: "a", pct: 40 }), bar({ id: "d", pct: null, status: "no_actual_data" })]);
    expect(o.xAxis.max).toBe(120);
    const d = o.series[0].data[1];
    expect(d.value).toBe(0);
    expect(d.label.formatter()).toBe("No data");
  });

  it("grows the height with the rows and mirrors in RTL", () => {
    expect(utilisationHeight(40)).toBeGreaterThan(utilisationHeight(2));
    expect(build([bar({ id: "a" })], true).xAxis.inverse).toBe(true);
  });
});
