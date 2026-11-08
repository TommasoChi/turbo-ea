/**
 * The Licensing report's "By license type" chart, as an ECharts option. Pure: one category per
 * license type, a faded "Licensed" bar and a solid "Actual" bar side by side in the type's hue.
 */
import type { EChartsCoreOption } from "echarts/core";
import type { EChartsChrome } from "@/components/charts/echartsTheme";
import {
  axisLabel,
  base,
  BAR_MAX_THICKNESS,
  grid,
  legend,
  splitLine,
  tooltip,
  valueLabel,
  type ChartChromeContext,
} from "@/components/charts/chrome";

export interface ByTypeBar {
  key: string;
  label: string;
  licensed: number;
  actual: number | null;
  color: string;
}

export interface ByTypeOptions {
  chrome: EChartsChrome;
  isRtl: boolean;
  licensedLabel: string;
  actualLabel: string;
}

const LICENSED_OPACITY = 0.35;

export function buildByTypeOption(bars: ByTypeBar[], o: ByTypeOptions): EChartsCoreOption {
  const ctx: ChartChromeContext = { theme: o.chrome, isRtl: o.isRtl };
  const series = (name: string, value: (b: ByTypeBar) => number | null, faded: boolean) => ({
    type: "bar",
    name,
    barMaxWidth: BAR_MAX_THICKNESS,
    emphasis: { focus: "series" },
    // Neutral series colour: it is what the legend swatch shows; each bar overrides it with its type hue.
    itemStyle: { color: o.chrome.textSecondary, ...(faded && { opacity: LICENSED_OPACITY }) },
    label: valueLabel(ctx, "top"),
    data: bars.map((b) => {
      const v = value(b);
      return {
        key: b.key,
        value: v ?? 0,
        itemStyle: { color: b.color, ...(faded && { opacity: LICENSED_OPACITY }) },
        ...(v == null && { label: { show: true, position: "top", formatter: () => "—" } }),
      };
    }),
  });
  return {
    ...base(ctx),
    grid: grid(ctx, 16, 40),
    tooltip: tooltip(ctx, { trigger: "axis", axisPointer: { type: "shadow", shadowStyle: { color: o.chrome.hover } } }),
    legend: legend(ctx, [o.licensedLabel, o.actualLabel], { selectedMode: false }),
    xAxis: {
      type: "category",
      inverse: o.isRtl,
      data: bars.map((b) => b.label),
      axisTick: { show: false },
      axisLine: { lineStyle: { color: o.chrome.divider } },
      axisLabel: axisLabel(ctx, { interval: 0, hideOverlap: true }),
    },
    yAxis: {
      type: "value",
      position: o.isRtl ? "right" : "left",
      axisLabel: axisLabel(ctx),
      splitLine: splitLine(ctx),
    },
    series: [series(o.licensedLabel, (b) => b.licensed, true), series(o.actualLabel, (b) => b.actual, false)],
  };
}
