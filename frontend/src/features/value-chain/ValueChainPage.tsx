import { useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import CircularProgress from "@mui/material/CircularProgress";
import LinearProgress from "@mui/material/LinearProgress";
import Typography from "@mui/material/Typography";
import { api } from "@/api/client";
import CardDetailSidePanel from "@/components/CardDetailSidePanel";
import { hasPermission } from "@/components/RequirePermission";
import ReportShell from "@/features/reports/ReportShell";
import { useAuthContext } from "@/hooks/AuthContext";
import { useApiQuery } from "@/hooks/useApiQuery";
import { VALUE_CHAIN_BAND_COLORS } from "@/theme/tokens";
import type { ValueChainBandKey, ValueChainResponse } from "@/types";
import BandHeader from "./BandHeader";
import CoreHouse from "./CoreHouse";
import ProcessCategoryBox from "./ProcessCategoryBox";
import { chainExportData, type ChainExportLabels } from "./exportData";
import { useValueChainTypes } from "./useValueChainTypes";
import { DEFAULT_CHAIN_ROW_ORDER, moveKey, orderBands } from "./valueChainModel";

export default function ValueChainPage() {
  const { t } = useTranslation("valuechain");
  const navigate = useNavigate();
  const { user } = useAuthContext();
  const types = useValueChainTypes();
  const chain = useApiQuery<ValueChainResponse>("/reports/value-chain");
  const rowOrderQuery = useApiQuery<{ row_order: string[] }>("/settings/bpm-row-order");
  const [rowOrderOverride, setRowOrderOverride] = useState<string[] | null>(null);
  const [reorderFailed, setReorderFailed] = useState(false);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [panelCardId, setPanelCardId] = useState<string | null>(null);
  const chartRef = useRef<HTMLDivElement>(null);

  const rowOrder = rowOrderOverride ?? rowOrderQuery.data?.row_order ?? DEFAULT_CHAIN_ROW_ORDER;
  const canReorder = hasPermission(user?.permissions, "admin.settings");
  const bands = useMemo(() => orderBands(chain.data?.bands ?? [], rowOrder), [chain.data, rowOrder]);
  // The shown order, so a band the saved order does not mention is still movable.
  const movable: ValueChainBandKey[] = bands.map((b) => b.key).filter((k) => k !== "not_set");

  const moveBand = async (key: ValueChainBandKey, direction: "up" | "down") => {
    const next = moveKey<ValueChainBandKey>(movable, key, direction);
    if (next.join() === movable.join()) return;
    const previous = rowOrderOverride;
    setReorderFailed(false);
    setRowOrderOverride(next);
    try {
      await api.patch("/settings/bpm-row-order", { row_order: next });
    } catch {
      setRowOrderOverride(previous);
      setReorderFailed(true);
    }
  };
  const drill = (id: string) => navigate(`/value-chain/value-stream?category=${encodeURIComponent(id)}`);

  const buildExportData = () => {
    const labels: ChainExportLabels = {
      categories: t("sheet.categories"),
      band: t("col.band"),
      category: t("col.category"),
      processGroups: t("col.processGroups"),
      processes: t("col.processes"),
      valueStreams: t("col.valueStreams"),
      valueGates: t("col.valueGates"),
      bands: {
        management: t("band.management"),
        core: t("band.core"),
        support: t("band.support"),
        not_set: t("band.not_set"),
      },
    };
    return chainExportData(bands, t("page.chain.title"), labels, chartRef.current);
  };

  return (
    <ReportShell
      title={t("page.chain.title")}
      icon="conveyor_belt"
      iconColor={types.businessContext.color}
      hasTableToggle={false}
      chartRef={chartRef}
      maxWidth="100%"
      disableSavedReportsLink
      buildExportData={buildExportData}
    >
      {chain.loading && !chain.data && (
        <Box sx={{ display: "flex", justifyContent: "center", py: 6 }}>
          <CircularProgress />
        </Box>
      )}
      {chain.loading && chain.data && <LinearProgress sx={{ mb: 1 }} />}
      {chain.error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {t("error.load")}
        </Alert>
      )}
      {reorderFailed && (
        <Alert severity="warning" sx={{ mb: 2 }} onClose={() => setReorderFailed(false)}>
          {t("error.reorder")}
        </Alert>
      )}
      {bands.map((band) => {
        const color = VALUE_CHAIN_BAND_COLORS[band.key];
        const idx = movable.indexOf(band.key);
        const isCollapsed = !!collapsed[band.key];
        return (
          <Box key={band.key} sx={{ mb: 3 }}>
            <BandHeader
              color={color}
              icon={types.businessProcess.icon}
              label={t(`band.${band.key}`)}
              count={band.boxes.length}
              collapsed={isCollapsed}
              onToggle={() => setCollapsed((c) => ({ ...c, [band.key]: !c[band.key] }))}
              reorder={
                canReorder && band.key !== "not_set"
                  ? {
                      canMoveUp: idx > 0,
                      canMoveDown: idx < movable.length - 1,
                      onMove: (direction) => void moveBand(band.key, direction),
                    }
                  : undefined
              }
            />
            {!isCollapsed && (
              <Box sx={{ bgcolor: "action.hover", border: 1, borderColor: "divider", borderRadius: 2, p: 2 }}>
                {band.key === "core" && chain.data ? (
                  <CoreHouse house={chain.data.core_house} color={color} onOpenCard={setPanelCardId} onDrill={drill} />
                ) : band.boxes.length === 0 ? (
                  <Typography variant="body2" color="text.secondary" sx={{ textAlign: "center" }}>
                    {t("empty.band")}
                  </Typography>
                ) : (
                  <Box sx={{ display: "flex", flexWrap: "wrap", justifyContent: "center", gap: 1.5 }}>
                    {band.boxes.map((box) => (
                      <ProcessCategoryBox
                        key={box.id}
                        box={box}
                        headerColor={color}
                        onOpenCard={setPanelCardId}
                        onDrill={drill}
                      />
                    ))}
                  </Box>
                )}
              </Box>
            )}
          </Box>
        );
      })}
      <CardDetailSidePanel cardId={panelCardId} open={!!panelCardId} onClose={() => setPanelCardId(null)} />
    </ReportShell>
  );
}
