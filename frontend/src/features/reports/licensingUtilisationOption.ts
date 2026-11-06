/**
 * The Licensing report's Utilisation chart, as an ECharts option. Pure: one horizontal bar per
 * card (or group), value = the worst license-type percentage, coloured by status, with the 80 %
 * and 100 % reference lines and the three shaded zones.
 */
import type { EChartsCoreOption } from "echarts/core";
import type { EChartsChrome } from "@/components/charts/echartsTheme";
import {
  axisLabel,
  base,
  BAR_MAX_THICKNESS,
  grid,
  splitLine,
  tooltip,
  type ChartChromeContext,
} from "@/components/charts/chrome";
import { statusColor } from "@/lib/licenses";
import { STATUS_COLORS } from "@/theme/tokens";
import type { LicenseStatus } from "@/types";

export interface UtilisationBar {
  id: string;
  name: string;
  pct: number | null;
  noLicence: boolean;
  status: LicenseStatus;
  /** The card type's label, shown in the tooltip when the bars mix types. */
  typeLabel?: string;
}

export interface UtilisationOptions {
  chrome: EChartsChrome;
  isRtl: boolean;
  noData: string;
  noLicense: string;
}

const APPROACHING = 80;
const FULL = 100;
const MIN_MAX = 120;
const ROW_HEIGHT = 30;
const ZONE_OPACITY = 0.08;

/** Plot height for `rows` bars; the page scrolls rather than squeezing them. */
export const utilisationHeight = (rows: number): number => Math.max(160, rows * ROW_HEIGHT + 60);

const rank = (b: UtilisationBar) => (b.noLicence ? 0 : b.pct == null ? 2 : 1);

export function buildUtilisationOption(
  bars: UtilisationBar[],
  o: UtilisationOptions,
): EChartsCoreOption {
  const ctx: ChartChromeContext = { theme: o.chrome, isRtl: o.isRtl };
  const sorted = [...bars].sort(
    (a, b) => rank(a) - rank(b) || (b.pct ?? 0) - (a.pct ?? 0) || a.name.localeCompare(b.name),
  );
  const highest = sorted.reduce((m, b) => (b.pct != null && b.pct > m ? b.pct : m), 0);
  const max = Math.max(MIN_MAX, Math.ceil(highest) + 10);
  const labelFor = (text: string) => ({
    show: true,
    position: "insideLeft",
    color: o.chrome.textPrimary,
    formatter: () => text,
  });
  const zone = (from: number, to: number, color: string) => [
    { xAxis: from, itemStyle: { color, opacity: ZONE_OPACITY } },
    { xAxis: to },
  ];
  return {
    ...base(ctx),
    grid: grid(ctx, 8, 8),
    tooltip: tooltip(ctx, {
      trigger: "item",
      formatter: (p: { data: { id: string } }) => {
        const b = sorted.find((x) => x.id === p.data.id);
        if (!b) return "";
        const value = b.noLicence ? o.noLicense : b.pct == null ? o.noData : `${b.pct} %`;
        return `${b.name}${b.typeLabel ? ` (${b.typeLabel})` : ""}: ${value}`;
      },
    }),
    xAxis: {
      type: "value",
      min: 0,
      max,
      inverse: o.isRtl,
      axisLabel: axisLabel(ctx, { formatter: (v: number) => `${v} %` }),
      splitLine: splitLine(ctx),
    },
    yAxis: {
      type: "category",
      inverse: true,
      position: o.isRtl ? "right" : "left",
      data: sorted.map((b) => b.name),
      axisTick: { show: false },
      axisLine: { lineStyle: { color: o.chrome.divider } },
      axisLabel: axisLabel(ctx, { width: 160, overflow: "truncate" }),
    },
    series: [
      {
        type: "bar",
        barMaxWidth: BAR_MAX_THICKNESS,
        cursor: "pointer",
        data: sorted.map((b) => ({
          id: b.id,
          value: b.noLicence ? max : (b.pct ?? 0),
          itemStyle: { color: statusColor(b.status) },
          ...(b.noLicence && { label: labelFor(o.noLicense) }),
          ...(!b.noLicence && b.pct == null && { label: labelFor(o.noData) }),
          ...(!b.noLicence && b.pct != null && {
            label: { show: true, position: "right", color: o.chrome.textSecondary, formatter: () => `${b.pct} %` },
          }),
        })),
        markLine: {
          silent: true,
          symbol: "none",
          lineStyle: { color: o.chrome.textSecondary, type: "dashed" },
          label: { color: o.chrome.textSecondary, formatter: "{c} %" },
          data: [{ xAxis: APPROACHING }, { xAxis: FULL }],
        },
        markArea: {
          silent: true,
          data: [
            zone(0, APPROACHING, STATUS_COLORS.success),
            zone(APPROACHING, FULL, STATUS_COLORS.warning),
            zone(FULL, max, STATUS_COLORS.error),
          ],
        },
      },
    ],
  };
}
