import { useEffect, useState, useMemo, useCallback } from "react";
import { useTranslation } from "react-i18next";
import Box from "@mui/material/Box";
import TextField from "@mui/material/TextField";
import MenuItem from "@mui/material/MenuItem";
import CircularProgress from "@mui/material/CircularProgress";
import Typography from "@mui/material/Typography";
import Paper from "@mui/material/Paper";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import TableSortLabel from "@mui/material/TableSortLabel";
import Tooltip from "@mui/material/Tooltip";
import Chip from "@mui/material/Chip";
import {
  Treemap,
  Sankey,
  ResponsiveContainer,
  Tooltip as RTooltip,
} from "recharts";
import ReportShell from "./ReportShell";
import SaveReportDialog from "./SaveReportDialog";
import MetricCard from "./MetricCard";
import FullscreenPanel from "./FullscreenPanel";
import { useMetamodel } from "@/hooks/useMetamodel";
import { useReadableCardTypes } from "@/hooks/useReadableCardTypes";
import { useSavedReport } from "@/hooks/useSavedReport";
import { applyScope, useCardScope } from "@/hooks/useCardScope";
import CardScopeFilter from "@/components/CardScopeFilter";
import { useThumbnailCapture } from "@/hooks/useThumbnailCapture";
import { useCurrency, type CurrencyFormatter } from "@/hooks/useCurrency";
import { useIsRtl } from "@/hooks/useIsRtl";
import { useAuth } from "@/hooks/useAuth";
import {
  useTypeLabel,
  useFieldLabel,
  useOptionLabel,
} from "@/hooks/useResolveLabel";
import CardDetailSidePanel from "@/components/CardDetailSidePanel";
import MaterialSymbol from "@/components/MaterialSymbol";
import { api } from "@/api/client";
import { useAbortableEffect } from "@/hooks/useLatestRequest";
import {
  facetValues,
  pickGroupableFields,
  resolveFacetField,
} from "@/lib/fieldFacets";
import { fiscalYearLabel } from "@/lib/fiscalYear";
import type { FieldDef } from "@/types";

const COST_REPORT_TYPE_KEYS = ["Application", "ITComponent"] as const;
type CostView = "chart" | "sankey" | "table";

interface CostItem {
  id: string;
  name: string;
  cost: number;
  attributes?: Record<string, unknown>;
}

interface CostTreemapResponse {
  items: CostItem[];
  total: number;
  /** The current fiscal year — the only one the report shows. */
  fiscal_year?: number;
  /** Month (1-12) the workspace's fiscal year starts in. */
  fiscal_year_start?: number;
}

interface SankeyNode {
  id: string;
  name: string;
  type: string;
}

interface SankeyLink {
  source: number;
  target: number;
  value: number;
}

interface CostSankeyResponse {
  nodes: SankeyNode[];
  links: SankeyLink[];
  total: number;
  fiscal_year?: number;
  fiscal_year_start?: number;
}

/** The fiscal year the figures are for, as the server named it. */
interface FiscalYear {
  year: number;
  start: number;
}

function fiscalYearOf(r: {
  fiscal_year?: number;
  fiscal_year_start?: number;
}): FiscalYear | null {
  return r.fiscal_year != null && r.fiscal_year_start != null
    ? { year: r.fiscal_year, start: r.fiscal_year_start }
    : null;
}

function pickCostFields(schema: { fields: FieldDef[] }[]): FieldDef[] {
  const out: FieldDef[] = [];
  for (const s of schema)
    for (const f of s.fields) if (f.type === "cost") out.push(f);
  return out;
}

/* ------------------------------------------------------------------ */
/*  Treemap helpers                                                     */
/* ------------------------------------------------------------------ */

const COLORS = [
  "#1565c0",
  "#1976d2",
  "#1e88e5",
  "#2196f3",
  "#42a5f5",
  "#64b5f6",
  "#90caf9",
  "#bbdefb",
  "#0d47a1",
  "#1565c0",
];

function treemapColor(index: number): string {
  return COLORS[index % COLORS.length];
}

const TreemapContent = ({
  x,
  y,
  width,
  height,
  name,
  cost,
  index,
  id,
  costFmt,
  onCellClick,
  isRtl,
}: {
  x: number;
  y: number;
  width: number;
  height: number;
  name: string;
  cost: number;
  index: number;
  id?: string;
  costFmt: CurrencyFormatter;
  onCellClick?: (id: string) => void;
  isRtl?: boolean;
}) => {
  if (width < 4 || height < 4) return null;
  const showLabel = width > 50 && height > 30;
  const showCost = width > 70 && height > 45;
  const handleClick = id && onCellClick ? () => onCellClick(id) : undefined;
  // In RTL, anchor the cell labels at the top-right corner so they read correctly.
  const labelX = isRtl ? x + width - 6 : x + 6;
  const textDir = isRtl
    ? { textAnchor: "end" as const, direction: "rtl" as const }
    : {};
  return (
    <g
      onClick={handleClick}
      style={handleClick ? { cursor: "pointer" } : undefined}
    >
      <rect
        x={x}
        y={y}
        width={width}
        height={height}
        fill={treemapColor(index)}
        stroke="#fff"
        strokeWidth={2}
        rx={3}
      />
      {showLabel && (
        <text
          x={labelX}
          y={y + 16}
          fontSize={11}
          fontWeight={600}
          fill="#fff"
          style={{ pointerEvents: "none" }}
          {...textDir}
        >
          {name.length > Math.floor(width / 7)
            ? name.slice(0, Math.floor(width / 7) - 1) + "…"
            : name}
        </text>
      )}
      {showCost && (
        <text
          x={labelX}
          y={y + 30}
          fontSize={10}
          fill="rgba(255,255,255,0.8)"
          style={{ pointerEvents: "none" }}
          {...textDir}
        >
          {costFmt.format(cost)}
        </text>
      )}
    </g>
  );
};

/* ------------------------------------------------------------------ */
/*  Main component                                                     */
/* ------------------------------------------------------------------ */

export default function CostReport() {
  const { t } = useTranslation(["reports", "common"]);
  const { types, loading: ml } = useMetamodel();
  // Report type pickers offer only the types the user may see.
  const readableTypes = useReadableCardTypes("module");
  // Sankey connects exactly these two types; Treemap/Table also pick one at a
  // time from this same restricted list (no `aggregate` roll-up left to need
  // any other type).
  const costReportTypes = useMemo(
    () =>
      readableTypes.filter((tp) =>
        COST_REPORT_TYPE_KEYS.includes(tp.key as never),
      ),
    [readableTypes],
  );
  const typeLabel = useTypeLabel();
  const fieldLabel = useFieldLabel();
  const optLabel = useOptionLabel();
  const { fmt } = useCurrency();
  const isRtl = useIsRtl();
  const { user } = useAuth();
  const canViewCostsGlobally = !!(
    user?.permissions?.["*"] || user?.permissions?.["costs.view"]
  );
  const saved = useSavedReport("cost");
  const { chartRef, thumbnail, captureAndSave } = useThumbnailCapture(() =>
    saved.setSaveDialogOpen(true),
  );
  const [cardTypeKey, setCardTypeKey] = useState("Application");
  const [sidePanelCardId, setSidePanelCardId] = useState<string | null>(null);
  const [costField, setCostField] = useState("costTotalAnnual");
  const [groupBy, setGroupBy] = useState("");
  const [rawItems, setRawItems] = useState<CostItem[] | null>(null);
  const [sankeyData, setSankeyData] = useState<CostSankeyResponse | null>(null);
  const [view, setView] = useState<CostView>("chart");
  const [sortK, setSortK] = useState("cost");
  const [sortD, setSortD] = useState<"asc" | "desc">("desc");
  // The server decides the year: costs are annual and a card carries one
  // figure, so the report shows the current fiscal year and only names it.
  const [fiscalYear, setFiscalYear] = useState<FiscalYear | null>(null);

  // Narrow the treemap to chosen cards and everything beneath them (#954).
  const scope = useCardScope({ typeKey: cardTypeKey, enabled: true });
  const { scopeIds, setScopeIds, effectiveScopeIds } = scope;

  const typeDef = useMemo(
    () => types.find((t) => t.key === cardTypeKey),
    [types, cardTypeKey],
  );
  const costFields = useMemo(() => {
    const raw = typeDef ? pickCostFields(typeDef.fields_schema) : [];
    return raw.map((f) => ({ ...f, label: fieldLabel(f) }));
  }, [typeDef, fieldLabel]);

  // Auto-select cost field when card type changes — only when the current one
  // is not on the type, so a restored field the type does carry is kept.
  // Declared before the restore below on purpose: effects run in declaration
  // order, so on mount this effect's pick (made from the starting type's
  // fields) is queued first and the restored type + field overwrite it.
  useEffect(() => {
    if (costFields.length > 0 && !costFields.some((f) => f.key === costField)) {
      setCostField(costFields[0].key);
    }
  }, [costFields]); // eslint-disable-line react-hooks/exhaustive-deps

  // Load saved report config
  useEffect(() => {
    const cfg = saved.consumeConfig();
    if (cfg) {
      const restoredType =
        typeof cfg.cardTypeKey === "string" &&
        COST_REPORT_TYPE_KEYS.includes(cfg.cardTypeKey as never)
          ? cfg.cardTypeKey
          : undefined;
      if (restoredType) setCardTypeKey(restoredType);
      if (cfg.costField) setCostField(cfg.costField as string);
      if (cfg.groupBy !== undefined) setGroupBy(cfg.groupBy as string);
      if (cfg.view) setView(cfg.view as CostView);
      if (cfg.sortK) setSortK(cfg.sortK as string);
      if (cfg.sortD) setSortD(cfg.sortD as "asc" | "desc");
      // Set for the restored type, so the scope is read as that type's from
      // the render the type lands on.
      if (Array.isArray(cfg.scopeIds)) {
        setScopeIds(
          (cfg.scopeIds as unknown[]).filter(
            (v): v is string => typeof v === "string",
          ),
          restoredType,
        );
      }
    }
  }, [saved.loadedConfig]); // eslint-disable-line react-hooks/exhaustive-deps

  const getConfig = () => ({
    cardTypeKey,
    costField,
    groupBy,
    view,
    sortK,
    sortD,
    scopeIds,
  });

  // Auto-persist config to localStorage
  useEffect(() => {
    saved.persistConfig(getConfig());
  }, [cardTypeKey, costField, groupBy, view, sortK, sortD, scopeIds]); // eslint-disable-line react-hooks/exhaustive-deps

  // Reset all parameters to defaults
  const handleReset = useCallback(() => {
    saved.resetAll();
    setCardTypeKey("Application");
    setCostField("costTotalAnnual");
    setGroupBy("");
    setView("chart");
    setSortK("cost");
    setSortD("desc");
    setScopeIds([]);
  }, [saved]); // eslint-disable-line react-hooks/exhaustive-deps

  // The table's group-by: single selects with options and yes/no fields (a
  // multi-select cannot put a card in exactly one group). A yes/no field is
  // given Yes / No options, so its groups are named rather than "true".
  const groupableFields = useMemo<FieldDef[]>(() => {
    if (!typeDef) return [];
    const yesNo = { yes: t("common:labels.yes"), no: t("common:labels.no") };
    return pickGroupableFields(typeDef.fields_schema).map((f) =>
      resolveFacetField(
        {
          ...f,
          label: fieldLabel(f),
          options: f.options?.map((o) => ({ ...o, label: optLabel(o) })),
        },
        yesNo,
      ),
    );
  }, [typeDef, fieldLabel, optLabel, t]);

  useAbortableEffect(
    async ({ signal, isCurrent }) => {
      if (!canViewCostsGlobally) {
        // Nothing loaded: a later grant shows the spinner, not an empty report.
        setRawItems(null);
        setSankeyData(null);
        return;
      }
      if (view === "sankey") {
        const p = new URLSearchParams({ cost_field: costField });
        if (groupBy) p.set("group_by", groupBy);
        const r = await api.get<CostSankeyResponse>(
          `/reports/cost-sankey?${p}`,
          { signal },
        );
        if (!isCurrent()) return;
        setSankeyData(r);
        setRawItems(null);
        setFiscalYear((prev) => fiscalYearOf(r) ?? prev);
      } else {
        const p = new URLSearchParams({
          type: cardTypeKey,
          cost_field: costField,
        });
        const r = await api.get<CostTreemapResponse>(
          `/reports/cost-treemap?${p}`,
          { signal },
        );
        if (!isCurrent()) return;
        setRawItems(r.items);
        setSankeyData(null);
        setFiscalYear((prev) => fiscalYearOf(r) ?? prev);
      }
    },
    [cardTypeKey, costField, groupBy, view, canViewCostsGlobally],
  );

  // Scoped here and nowhere else, so the metric cards, treemap, groups and
  // the table footer total can never disagree with each other.
  const items = useMemo(
    () => (rawItems ? applyScope(rawItems, scope.closure) : []),
    [rawItems, scope.closure],
  );
  const total = useMemo(
    () => items.reduce((sum, item) => sum + item.cost, 0),
    [items],
  );

  const groupedField = useMemo(
    () => groupableFields.find((f) => f.key === groupBy),
    [groupableFields, groupBy],
  );

  const groups = useMemo(() => {
    if (!groupBy || !groupedField) return null;
    const optionMap = new Map<string, string>();
    for (const o of groupedField.options ?? []) optionMap.set(o.key, o.label);
    const map = new Map<
      string,
      { label: string; items: CostItem[]; cost: number }
    >();
    for (const item of items) {
      const raw = (item.attributes as Record<string, unknown> | undefined)?.[
        groupBy
      ];
      const val = facetValues(groupedField, raw)[0] ?? "";
      const label = optionMap.get(val) || val || t("cost.unspecified");
      const g = map.get(label) || { label, items: [], cost: 0 };
      g.items.push(item);
      g.cost += item.cost;
      map.set(label, g);
    }
    return [...map.values()].sort((a, b) => b.cost - a.cost);
  }, [items, groupBy, groupedField, t]);

  const printParams = useMemo(() => {
    const params: { label: string; value: string }[] = [];
    const tp = types.find((tp) => tp.key === cardTypeKey);
    const tpLabel = typeLabel(tp) || cardTypeKey;
    if (view !== "sankey")
      params.push({ label: t("common:labels.type"), value: tpLabel });
    // Always stated: every figure on the page is for this one fiscal year.
    if (fiscalYear) {
      params.push({
        label: t("cost.fiscalYear"),
        value: fiscalYearLabel(fiscalYear.year, fiscalYear.start, t),
      });
    }
    if (costFields.length > 1 && view !== "sankey") {
      const cfLabel =
        costFields.find((f) => f.key === costField)?.label || costField;
      params.push({ label: t("cost.costField"), value: cfLabel });
    }
    if (groupBy) {
      const gLabel =
        groupableFields.find((f) => f.key === groupBy)?.label || groupBy;
      params.push({ label: t("cost.groupBy"), value: gLabel });
    }
    if (view === "table")
      params.push({ label: t("common.view"), value: t("common.table") });
    if (effectiveScopeIds.length > 0) {
      params.push({
        label: t("common.scope"),
        value: t("cost.scopeCount", { count: effectiveScopeIds.length }),
      });
    }
    return params;
  }, [
    cardTypeKey,
    types,
    costField,
    costFields,
    groupBy,
    groupableFields,
    view,
    effectiveScopeIds,
    fiscalYear,
    t,
    typeLabel,
  ]);

  const handleRectClick = useCallback((id: string) => {
    setSidePanelCardId(id);
  }, []);

  if (!canViewCostsGlobally) {
    return (
      <ReportShell
        title={t("cost.title")}
        icon="payments"
        iconColor="#2e7d32"
        view={view}
        onViewChange={setView}
      >
        <Box
          sx={{
            py: 8,
            textAlign: "center",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 1,
          }}
        >
          <MaterialSymbol icon="lock" size={32} color="#9e9e9e" />
          <Typography variant="h6" color="text.secondary">
            {t("cost.permissionDeniedTitle")}
          </Typography>
          <Typography
            variant="body2"
            color="text.secondary"
            sx={{ maxWidth: 480 }}
          >
            {t("cost.permissionDeniedBody")}
          </Typography>
        </Box>
      </ReportShell>
    );
  }

  if (ml || (rawItems === null && sankeyData === null))
    return (
      <Box sx={{ display: "flex", justifyContent: "center", py: 8 }}>
        <CircularProgress />
      </Box>
    );

  const sortedAllItems = [...items].sort((a, b) => b.cost - a.cost);
  const topDriver = sortedAllItems.length > 0 ? sortedAllItems[0] : null;
  const avgCost = items.length > 0 ? total / items.length : 0;

  const treemapData = [...items]
    .sort((a, b) => b.cost - a.cost)
    .map((d, i) => ({
      name: d.name,
      size: d.cost,
      cost: d.cost,
      id: d.id,
      index: i,
    }));

  const sort = (k: string) => {
    setSortD(sortK === k && sortD === "asc" ? "desc" : "asc");
    setSortK(k);
  };
  const sorted = [...items].sort((a, b) => {
    const d = sortD === "asc" ? 1 : -1;
    if (sortK === "cost") return (a.cost - b.cost) * d;
    return a.name.localeCompare(b.name) * d;
  });

  const Tip = ({
    active,
    payload,
  }: {
    active?: boolean;
    payload?: { payload: { name: string; cost: number; size: number } }[];
  }) => {
    if (!active || !payload?.[0]) return null;
    const d = payload[0].payload;
    return (
      <Paper sx={{ p: 1.5 }} elevation={3}>
        <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
          {d.name}
        </Typography>
        <Typography variant="caption" display="block">
          {fmt.format(d.cost)}
        </Typography>
        <Typography variant="caption" color="text.secondary">
          {total > 0
            ? t("cost.percentOfTotalValue", {
                pct: ((d.cost / total) * 100).toFixed(1),
              })
            : ""}
        </Typography>
      </Paper>
    );
  };

  return (
    <ReportShell<CostView>
      title={t("cost.title")}
      icon="payments"
      iconColor="#2e7d32"
      view={view}
      onViewChange={setView}
      chartViewLabel={t("cost.treemapChartView")}
      extraViews={[
        {
          value: "sankey",
          icon: "waterfall_chart",
          label: t("cost.sankeyChartView"),
        },
      ]}
      chartRef={chartRef}
      onSaveReport={captureAndSave}
      savedReportName={saved.savedReportName ?? undefined}
      onResetSavedReport={saved.resetSavedReport}
      onReset={handleReset}
      printParams={printParams}
      toolbar={
        <>
          {view !== "sankey" && (
            <TextField
              select
              size="small"
              label={t("cost.cardType")}
              value={cardTypeKey}
              onChange={(e) => setCardTypeKey(e.target.value)}
              sx={{ minWidth: 150 }}
            >
              {costReportTypes.map((tp) => (
                <MenuItem key={tp.key} value={tp.key}>
                  {typeLabel(tp)}
                </MenuItem>
              ))}
            </TextField>
          )}
          {view !== "sankey" && (
            <CardScopeFilter
              types={cardTypeKey}
              value={effectiveScopeIds}
              onChange={setScopeIds}
              labelAll={t("cost.scopeAll")}
              labelCount={(count) => t("cost.scopeCount", { count })}
              dialogTitle={t("cost.scopeDialogTitle")}
              helperText={t("cost.scopeHelper")}
              tooltip={t("cost.scopeTooltip")}
            />
          )}
          {view !== "sankey" && costFields.length > 1 && (
            <TextField
              select
              size="small"
              label={t("cost.costField")}
              value={costField}
              onChange={(e) => setCostField(e.target.value)}
              sx={{ minWidth: 160 }}
            >
              {costFields.map((f) => (
                <MenuItem key={f.key} value={f.key}>
                  {f.label}
                </MenuItem>
              ))}
            </TextField>
          )}

          {(view === "table" || view === "sankey") &&
            groupableFields.length > 0 && (
              <TextField
                select
                size="small"
                label={t("cost.groupBy")}
                value={groupBy}
                onChange={(e) => setGroupBy(e.target.value)}
                sx={{ minWidth: 150 }}
              >
                <MenuItem value="">{t("common:labels.none")}</MenuItem>
                {groupableFields.map((f) => (
                  <MenuItem key={f.key} value={f.key}>
                    {f.label}
                  </MenuItem>
                ))}
              </TextField>
            )}

          {fiscalYear && (
            <Tooltip title={t("cost.fiscalYearHelp")} arrow placement="bottom">
              <Chip
                variant="outlined"
                icon={<MaterialSymbol icon="calendar_month" size={18} />}
                label={t("cost.fiscalYearIndicator", {
                  fy: fiscalYearLabel(fiscalYear.year, fiscalYear.start, t),
                })}
                data-testid="cost-fiscal-year"
              />
            </Tooltip>
          )}
        </>
      }
    >
      {/* Summary strip */}
      <Box sx={{ display: "flex", gap: 2, mb: 3, flexWrap: "wrap" }}>
        <MetricCard
          label={t("cost.totalCost")}
          value={fmt.format(total)}
          icon="payments"
          iconColor="#2e7d32"
          color="#2e7d32"
        />
        <MetricCard
          label={t("cost.items")}
          value={items.length}
          icon="inventory_2"
        />
        <MetricCard
          label={t("cost.average")}
          value={fmt.format(avgCost)}
          icon="calculate"
        />
        {topDriver && (
          <MetricCard
            label={t("cost.topCostDriver")}
            value={topDriver.name}
            subtitle={`${fmt.format(topDriver.cost)} (${total > 0 ? ((topDriver.cost / total) * 100).toFixed(0) : 0}%)`}
            icon="trending_up"
            iconColor="#e65100"
          />
        )}
      </Box>

      {view === "chart" ? (
        items.length === 0 ? (
          <Box sx={{ py: 8, textAlign: "center" }}>
            <Typography color="text.secondary">
              {t("cost.noCostData")}
            </Typography>
          </Box>
        ) : (
          <FullscreenPanel label={t("cost.fullscreen")}>
            <Paper variant="outlined" sx={{ p: 1 }}>
              <ResponsiveContainer width="100%" height={450}>
                <Treemap
                  data={treemapData}
                  dataKey="size"
                  stroke="#fff"
                  animationDuration={300}
                  content={
                    <TreemapContent
                      x={0}
                      y={0}
                      width={0}
                      height={0}
                      name=""
                      cost={0}
                      index={0}
                      costFmt={fmt}
                      onCellClick={handleRectClick}
                      isRtl={isRtl}
                    />
                  }
                >
                  <RTooltip content={<Tip />} />
                </Treemap>
              </ResponsiveContainer>
            </Paper>
          </FullscreenPanel>
        )
      ) : view === "sankey" ? (
        !sankeyData || sankeyData.nodes.length === 0 ? (
          <Box sx={{ py: 8, textAlign: "center" }}>
            <Typography color="text.secondary">
              {t("cost.noCostData")}
            </Typography>
          </Box>
        ) : (
          <FullscreenPanel label={t("cost.fullscreen")}>
            <Paper
              variant="outlined"
              sx={{ p: 1 }}
              data-testid="cost-sankey-panel"
            >
              <ResponsiveContainer width="100%" height={450}>
                <Sankey data={sankeyData} nodeWidth={14} nodePadding={20} />
              </ResponsiveContainer>
            </Paper>
          </FullscreenPanel>
        )
      ) : (
        <Paper variant="outlined" sx={{ overflow: "auto" }}>
          <Table size="small" stickyHeader>
            <TableHead>
              <TableRow>
                <TableCell>
                  <TableSortLabel
                    active={sortK === "name"}
                    direction={sortK === "name" ? sortD : "asc"}
                    onClick={() => sort("name")}
                  >
                    {t("common:labels.name")}
                  </TableSortLabel>
                </TableCell>
                <TableCell align="right">
                  <TableSortLabel
                    active={sortK === "cost"}
                    direction={sortK === "cost" ? sortD : "asc"}
                    onClick={() => sort("cost")}
                  >
                    {t("cost.cost")}
                  </TableSortLabel>
                </TableCell>
                <TableCell align="right">{t("cost.percentOfTotal")}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {groups
                ? groups.map((g) => {
                    const groupSorted = [...g.items].sort((a, b) => {
                      const d = sortD === "asc" ? 1 : -1;
                      if (sortK === "cost") return (a.cost - b.cost) * d;
                      return a.name.localeCompare(b.name) * d;
                    });
                    return [
                      <TableRow
                        key={`grp-${g.label}`}
                        sx={{ bgcolor: "action.hover" }}
                      >
                        <TableCell
                          sx={{ fontWeight: 700, fontSize: "0.85rem" }}
                        >
                          {g.label}
                          <Typography
                            component="span"
                            variant="caption"
                            color="text.secondary"
                            sx={{ ml: 1 }}
                          >
                            ({g.items.length})
                          </Typography>
                        </TableCell>
                        <TableCell align="right" sx={{ fontWeight: 700 }}>
                          {fmt.format(g.cost)}
                        </TableCell>
                        <TableCell
                          align="right"
                          sx={{ fontWeight: 600, color: "text.secondary" }}
                        >
                          {total > 0
                            ? `${((g.cost / total) * 100).toFixed(1)}%`
                            : "—"}
                        </TableCell>
                      </TableRow>,
                      ...groupSorted.map((d) => (
                        <TableRow
                          key={d.id}
                          hover
                          sx={{ cursor: "pointer" }}
                          onClick={() => setSidePanelCardId(d.id)}
                        >
                          <TableCell sx={{ fontWeight: 500, pl: 4 }}>
                            {d.name}
                          </TableCell>
                          <TableCell align="right">
                            {fmt.format(d.cost)}
                          </TableCell>
                          <TableCell align="right">
                            {total > 0
                              ? `${((d.cost / total) * 100).toFixed(1)}%`
                              : "—"}
                          </TableCell>
                        </TableRow>
                      )),
                    ];
                  })
                : sorted.map((d) => (
                    <TableRow
                      key={d.id}
                      hover
                      sx={{ cursor: "pointer" }}
                      onClick={() => setSidePanelCardId(d.id)}
                    >
                      <TableCell sx={{ fontWeight: 500 }}>{d.name}</TableCell>
                      <TableCell align="right">{fmt.format(d.cost)}</TableCell>
                      <TableCell align="right">
                        {total > 0
                          ? `${((d.cost / total) * 100).toFixed(1)}%`
                          : "—"}
                      </TableCell>
                    </TableRow>
                  ))}
              <TableRow sx={{ bgcolor: "action.selected" }}>
                <TableCell sx={{ fontWeight: 700 }}>
                  {t("cost.total")}
                </TableCell>
                <TableCell align="right" sx={{ fontWeight: 700 }}>
                  {fmt.format(total)}
                </TableCell>
                <TableCell align="right" sx={{ fontWeight: 700 }}>
                  100%
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </Paper>
      )}
      <CardDetailSidePanel
        cardId={sidePanelCardId}
        open={!!sidePanelCardId}
        onClose={() => setSidePanelCardId(null)}
      />
      <SaveReportDialog
        open={saved.saveDialogOpen}
        onClose={() => saved.setSaveDialogOpen(false)}
        reportType="cost"
        config={getConfig()}
        thumbnail={thumbnail}
      />
    </ReportShell>
  );
}
