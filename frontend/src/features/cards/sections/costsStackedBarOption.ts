/**
 * The Costs section's weight bar, as an ECharts option. Pure: one horizontal
 * stacked bar for the year, one segment per cost line, so the widths read as
 * each item's share of the TCO. An unconfirmed (carried-forward) year is faded.
 */
import type { EChartsCoreOption } from "echarts/core";
import type { EChartsChrome } from "@/components/charts/echartsTheme";
import { base, tooltip, type ChartChromeContext } from "@/components/charts/chrome";

export interface CostBarSegment {
  key: string;
  label: string;
  amount: number;
  color: string;
}

export interface CostsBarOptions {
  chrome: EChartsChrome;
  isRtl: boolean;
  /** A cost as the workspace's currency prints it. */
  format: (v: number) => string;
  /** The year is carried forward from an earlier one and not confirmed yet. */
  faded: boolean;
}

export function buildCostsStackedBarOption(
  segments: CostBarSegment[],
  o: CostsBarOptions,
): EChartsCoreOption {
  const ctx: ChartChromeContext = { theme: o.chrome, isRtl: o.isRtl, valueFormatter: o.format };
  return {
    ...base(ctx),
    animation: false,
    grid: { left: 0, right: 0, top: 0, bottom: 0 },
    tooltip: tooltip(ctx, {
      trigger: "item",
      valueFormatter: (v: unknown) => o.format(Number(v ?? 0)),
    }),
    xAxis: { type: "value", show: false, inverse: o.isRtl },
    yAxis: { type: "category", show: false, data: [""] },
    series: segments
      .filter((s) => s.amount > 0)
      .map((s) => ({
        type: "bar",
        name: s.label,
        stack: "tco",
        barWidth: "100%",
        itemStyle: { color: s.color, opacity: o.faded ? 0.55 : 1 },
        data: [s.amount],
      })),
  };
}
