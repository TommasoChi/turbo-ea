/**
 * The Risk Management summary the card page and the initiative Overview both
 * draw: three tiles, the exposure donut, the status bars and a compact heat
 * map, all over the ACTIVE risks (open or mitigating) except Total and Status.
 */
import { useId, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { useTheme } from "@mui/material/styles";
import EChart from "@/components/charts/EChart";
import { useEChartsTheme } from "@/components/charts/echartsTheme";
import { legend, tooltip } from "@/components/charts/chrome";
import type { PpmRisk } from "@/types";
import PpmRiskMatrix from "./PpmRiskMatrix";
import PpmSectionHeader from "./PpmSectionHeader";
import {
  RISK_SCORE_BANDS,
  activeRiskSummary,
  bandColor,
  isActiveRisk,
  paletteColor,
  riskBandCounts,
  riskStatusCounts,
  riskStatusLabel,
  riskStatusPaletteColor,
  scoreBandLabel,
} from "./ppmRiskModel";

const CHART_HEIGHT = 200;

export default function PpmRiskSummary({
  risks,
  onManage,
}: {
  risks: readonly PpmRisk[] | null | undefined;
  onManage?: () => void;
}) {
  const { t } = useTranslation("ppm");
  const theme = useTheme();
  const chartTheme = useEChartsTheme();
  const titleId = useId();
  const exposureId = useId();
  const statusId = useId();
  const heatMapId = useId();
  const [selected, setSelected] = useState<Record<string, boolean>>({});

  const model = useMemo(() => {
    if (!risks) return null;
    const active = risks.filter(isActiveRisk);
    return {
      active,
      summary: activeRiskSummary(risks),
      bands: riskBandCounts(active),
      statuses: riskStatusCounts(risks),
    };
  }, [risks]);

  // Memoised: EChart applies an option with notMerge, so a new object replays the animation.
  const donutOption = useMemo(() => {
    if (!model) return null;
    const ctx = { theme: chartTheme, isRtl: chartTheme.isRtl };
    const bandNames = RISK_SCORE_BANDS.map((b) => scoreBandLabel(b, t));
    const visibleTotal = RISK_SCORE_BANDS.reduce(
      (sum, b) => sum + (selected[scoreBandLabel(b, t)] === false ? 0 : model.bands[b]),
      0,
    );

    return {
      tooltip: tooltip(ctx, { trigger: "item" }),
      legend: legend(ctx, bandNames, { selected }),
      title: {
        text: String(visibleTotal),
        left: "center",
        top: "center",
        textStyle: { color: chartTheme.textPrimary, fontSize: 24, fontFamily: chartTheme.fontFamily },
      },
      series: [
        {
          type: "pie",
          radius: ["50%", "72%"],
          center: ["50%", "45%"],
          label: { show: false },
          data: RISK_SCORE_BANDS.map((b) => ({
            name: scoreBandLabel(b, t),
            value: model.bands[b],
            itemStyle: { color: bandColor(b) },
          })),
        },
      ],
    };
  }, [model, selected, t, chartTheme]);

  const statusOption = useMemo(() => {
    if (!model) return null;
    const ctx = { theme: chartTheme, isRtl: chartTheme.isRtl };
    const statusNames = model.statuses.map((s) => riskStatusLabel(s.status, t));
    return {
      tooltip: tooltip(ctx, { trigger: "axis", axisPointer: { type: "shadow" } }),
      grid: { left: 8, right: 24, top: 8, bottom: 8, containLabel: true },
      xAxis: { type: "value", minInterval: 1, splitLine: { lineStyle: { color: chartTheme.divider } } },
      yAxis: {
        type: "category",
        inverse: true,
        data: statusNames,
        axisLabel: { color: chartTheme.textPrimary },
      },
      series: [
        {
          type: "bar",
          barMaxWidth: 20,
          label: { show: true, position: "right", color: chartTheme.textPrimary },
          data: model.statuses.map((s) => ({
            value: s.count,
            itemStyle: {
              color: paletteColor(theme.palette, riskStatusPaletteColor(s.status)),
            },
          })),
        },
      ],
    };
  }, [model, t, theme, chartTheme]);

  const header = (
    <PpmSectionHeader
      title={t("riskManagement")}
      titleId={titleId}
      action={
        onManage && (
          <Button size="small" aria-label={t("riskSummaryManage")} onClick={onManage}>
            {t("manage")}
          </Button>
        )
      }
    />
  );

  if (!risks || !model || !donutOption || !statusOption) {
    return (
      <Box component="section" aria-labelledby={titleId}>
        {header}
        <Typography color="text.secondary">{t("riskSummaryLoading")}</Typography>
      </Box>
    );
  }
  if (risks.length === 0) {
    return (
      <Box component="section" aria-labelledby={titleId}>
        {header}
        <Typography color="text.secondary">{t("noRisks")}</Typography>
      </Box>
    );
  }

  const tiles: [string, number][] = [
    [t("riskSummaryTotal"), model.summary.total],
    [t("riskSummaryOpen"), model.summary.open],
    [t("riskSummaryHighOpen"), model.summary.highOpen],
  ];

  return (
    <Box component="section" aria-labelledby={titleId}>
      {header}
      <Stack direction="row" spacing={2} useFlexGap flexWrap="wrap" sx={{ mb: 2 }}>
        {tiles.map(([label, value]) => (
          <Paper key={label} variant="outlined" sx={{ px: 2, py: 1, minWidth: 96 }}>
            <Typography variant="caption" color="text.secondary" component="div">
              {label}
            </Typography>
            <Typography variant="h5" component="div">
              {value}
            </Typography>
          </Paper>
        ))}
      </Stack>
      <Stack direction={{ xs: "column", md: "row" }} spacing={2}>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="subtitle2" id={exposureId} sx={{ mb: 1 }}>
            {t("riskSummaryExposure")}
          </Typography>
          <EChart
            option={donutOption}
            labelledBy={exposureId}
            style={{ height: CHART_HEIGHT }}
            onLegendSelectChanged={(p) => setSelected(p.selected)}
          />
        </Box>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="subtitle2" id={statusId} sx={{ mb: 1 }}>
            {t("riskSummaryStatus")}
          </Typography>
          <EChart
            option={statusOption}
            labelledBy={statusId}
            style={{ height: CHART_HEIGHT }}
          />
        </Box>
        <Box role="group" aria-labelledby={heatMapId} sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="subtitle2" id={heatMapId} sx={{ mb: 1 }}>
            {t("riskSummaryHeatMap")}
          </Typography>
          <PpmRiskMatrix risks={model.active} size="compact" />
        </Box>
      </Stack>
    </Box>
  );
}
