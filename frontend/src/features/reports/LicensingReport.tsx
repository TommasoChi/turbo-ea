import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Chip from "@mui/material/Chip";
import CircularProgress from "@mui/material/CircularProgress";
import MenuItem from "@mui/material/MenuItem";
import TextField from "@mui/material/TextField";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import EChart, { type EChartClickParams } from "@/components/charts/EChart";
import { useEChartsTheme } from "@/components/charts/echartsTheme";
import CardDetailSidePanel from "@/components/CardDetailSidePanel";
import CardPicker, { type CardOption } from "@/components/CardPicker";
import CardScopeFilter from "@/components/CardScopeFilter";
import MaterialSymbol from "@/components/MaterialSymbol";
import { useApiQuery } from "@/hooks/useApiQuery";
import { applyScope, useCardScope } from "@/hooks/useCardScope";
import { useMetamodel } from "@/hooks/useMetamodel";
import { useReadableCardTypes } from "@/hooks/useReadableCardTypes";
import {
  useFieldLabel,
  useOptionLabel,
  useRelationLabel,
  useTypeLabel,
} from "@/hooks/useResolveLabel";
import { resolveFacetField } from "@/lib/fieldFacets";
import { costFiscalYearName, costFiscalYearOptions } from "@/lib/fiscalYear";
import { isLicenseType, LICENSE_METRICS, statusColor, STATUS_ORDER } from "@/lib/licenses";
import { CHART_OTHER, STATUS_COLORS } from "@/theme/tokens";
import type {
  FieldDef,
  LicenseMetric,
  LicenseReportCell,
  LicenseReportResponse,
  LicenseReportRow,
  LicenseStatus,
  LicenseTypeStatus,
} from "@/types";
import CostDrillBar from "./CostDrillBar";
import CostLegend from "./CostLegend";
import { catalogueHues } from "./costColors";
import { applyDrill, crumbsOf, type Drill } from "./costDrill";
import { commonGroupableFields, relationGroupOptions } from "./costReportOptions";
import { buildCostTrendOption, type CostTrendRow } from "./costTrendOption";
import { buildByTypeOption, type ByTypeBar } from "./licensingByTypeOption";
import {
  buildUtilisationOption,
  utilisationHeight,
  type UtilisationBar,
} from "./licensingUtilisationOption";
import MetricCard from "./MetricCard";
import ReportShell from "./ReportShell";

export type LicensingView = "chart" | "bytype" | "table";

const OTHER_GROUP = "__other__";
const GROUP_PREFIX = "group:";
const NO_FOLDED: Set<string> = new Set();
const PICKABLE_TYPES = ["Application", "ITComponent", "Platform"];

const cellStatus = (s: LicenseTypeStatus): LicenseStatus => (s === "no_data" ? "no_actual_data" : s);

/** The highest-priority status of the list (`over` first), `compliant` when empty. */
function worstStatus(statuses: LicenseStatus[]): LicenseStatus {
  return STATUS_ORDER.find((s) => statuses.includes(s)) ?? "compliant";
}

/** A report row with what the page needs for the current license type filter. */
interface ViewRow {
  id: string;
  name: string;
  type: string;
  group?: string;
  pct: number | null;
  noLicence: boolean;
  status: LicenseStatus;
  raw: LicenseReportRow;
}

export default function LicensingReport() {
  const { t } = useTranslation(["reports", "common"]);
  const { types, relationTypes, loading: ml } = useMetamodel();
  const readableTypes = useReadableCardTypes("module");
  const typeLabel = useTypeLabel();
  const relLabel = useRelationLabel();
  const fieldLabel = useFieldLabel();
  const optLabel = useOptionLabel();
  const chrome = useEChartsTheme();
  const chartRef = useRef<HTMLDivElement | null>(null);

  const [cardTypeKey, setCardTypeKey] = useState("Application");
  const [metric, setMetric] = useState<LicenseMetric>("users");
  const [licenseType, setLicenseType] = useState(""); // "" = all
  const [groupBy, setGroupBy] = useState("");
  const [view, setView] = useState<LicensingView>("chart");
  // null = the current year (the param is omitted); the Forecast year is never offered.
  const [fiscalYearParam, setFiscalYearParam] = useState<number | null>(null);
  const [picked, setPicked] = useState<CardOption | null>(null);
  const [drill, setDrill] = useState<Drill>({});
  const [sidePanelCardId, setSidePanelCardId] = useState<string | null>(null);

  const typeOptions = useMemo(
    () =>
      readableTypes
        .filter((tp) => isLicenseType(tp.key))
        .map((tp) => ({ key: tp.key, label: typeLabel(tp) })),
    [readableTypes, typeLabel],
  );
  // A type the user may not read falls back to one they may.
  useEffect(() => {
    if (ml || typeOptions.length === 0) return;
    if (!typeOptions.some((o) => o.key === cardTypeKey)) setCardTypeKey(typeOptions[0].key);
  }, [ml, typeOptions, cardTypeKey]);

  const scope = useCardScope({ typeKey: cardTypeKey, enabled: true });
  const { setScopeIds, effectiveScopeIds, scopeIds } = scope;

  // Group by: single selects and yes/no fields, plus relations the card sits on the "one" end of.
  const schemas = useMemo(() => {
    const def = types.find((tp) => tp.key === cardTypeKey);
    return def ? [def.fields_schema] : [];
  }, [types, cardTypeKey]);
  const groupableFields = useMemo<FieldDef[]>(() => {
    const yesNo = { yes: t("common:labels.yes"), no: t("common:labels.no") };
    return commonGroupableFields(schemas).map((f) =>
      resolveFacetField(
        {
          ...f,
          label: fieldLabel(f),
          options: f.options?.map((o) => ({ ...o, label: optLabel(o) })),
        },
        yesNo,
      ),
    );
  }, [schemas, fieldLabel, optLabel, t]);
  const groupOptions = useMemo(
    () => [
      ...groupableFields.map((f) => ({ value: `field:${f.key}`, label: f.label })),
      ...relationGroupOptions(relationTypes, [cardTypeKey], relLabel),
    ],
    [groupableFields, relationTypes, cardTypeKey, relLabel],
  );
  const effectiveGroupBy = groupOptions.some((o) => o.value === groupBy) ? groupBy : "";
  const groupLabel = useCallback(
    (raw: string | undefined) => {
      if (!raw || raw === OTHER_GROUP) return t("cost.unspecified");
      const key = effectiveGroupBy.startsWith("field:") ? effectiveGroupBy.slice(6) : null;
      const opt = groupableFields.find((f) => f.key === key)?.options?.find((o) => o.key === raw);
      return opt?.label ?? raw;
    },
    [effectiveGroupBy, groupableFields, t],
  );

  // The picker works in the By-license-type view; elsewhere the pick is kept but not sent.
  const cardIdParam = view === "bytype" && picked ? picked.id : null;
  const path = useMemo(() => {
    const p = new URLSearchParams({ type: cardTypeKey, metric });
    if (fiscalYearParam != null) p.set("fiscal_year", String(fiscalYearParam));
    if (effectiveGroupBy && !cardIdParam) p.set("group_by", effectiveGroupBy);
    if (cardIdParam) p.set("card_id", cardIdParam);
    return `/reports/licensing?${p.toString()}`;
  }, [cardTypeKey, metric, fiscalYearParam, effectiveGroupBy, cardIdParam]);
  const { data, loading, error } = useApiQuery<LicenseReportResponse>(path);
  const aggregate = data?.aggregate ?? null;

  // Ids named by a drill exist only under the current selection.
  useEffect(() => {
    setDrill((d) => (d.group === undefined && d.cardId === undefined ? d : {}));
  }, [cardTypeKey, metric, effectiveGroupBy, fiscalYearParam, picked?.id]);

  const currentFiscalYear = data?.current_fiscal_year ?? new Date().getFullYear();
  const yearOptions = useMemo(
    () => costFiscalYearOptions(currentFiscalYear).filter((o) => o.value !== currentFiscalYear + 1),
    [currentFiscalYear],
  );

  // ── license types: label, order, hue (stable across filters and years) ────────────────────
  const sortedTypes = useMemo(
    () => [...(data?.license_types ?? [])].sort((a, b) => a.sort_order - b.sort_order),
    [data],
  );
  const hues = useMemo(
    () => catalogueHues(sortedTypes.map((x) => x.key), chrome.categorical, CHART_OTHER[chrome.mode]),
    [sortedTypes, chrome.categorical, chrome.mode],
  );
  const labelOfType = useCallback(
    (key: string) => {
      const lt = sortedTypes.find((x) => x.key === key);
      return lt ? fieldLabel({ key, label: lt.label, translations: lt.translations }) : key;
    },
    [sortedTypes, fieldLabel],
  );

  // ── rows for the current license type filter ──────────────────────────────────────────────
  const viewRows = useMemo<ViewRow[]>(() => {
    if (!data) return [];
    return data.rows.flatMap((raw): ViewRow[] => {
      const base = {
        id: raw.id,
        name: raw.name,
        type: raw.type,
        group: effectiveGroupBy && !aggregate ? (raw.group ?? OTHER_GROUP) : undefined,
        raw,
      };
      if (licenseType) {
        const c: LicenseReportCell | undefined = raw.by_type[licenseType];
        // A card holding nothing of the picked type has nothing to show for it.
        if (!c) return [];
        return [{ ...base, pct: c.pct, noLicence: c.no_licence, status: cellStatus(c.status) }];
      }
      const status =
        raw.status ?? worstStatus(Object.values(raw.by_type).map((c) => cellStatus(c.status)));
      return [{ ...base, pct: raw.worst_pct, noLicence: raw.worst_no_licence, status }];
    });
  }, [data, licenseType, effectiveGroupBy, aggregate]);
  // A Platform (or one picked card) is not narrowed by the scope.
  const closure = cardIdParam ? null : scope.closure;
  const scopedRows = useMemo(() => applyScope(viewRows, closure), [viewRows, closure]);

  const counts = useMemo(() => {
    const c: Record<LicenseStatus, number> = { compliant: 0, approaching: 0, over: 0, no_actual_data: 0 };
    for (const r of scopedRows) c[r.status] += 1;
    return c;
  }, [scopedRows]);

  // ── trend: summed from the response, re-derived (never refetched) by scope and drill ──────
  const trendIds = useMemo<Set<string> | null>(() => {
    if (drill.cardId !== undefined) return new Set([drill.cardId]);
    if (drill.group !== undefined)
      return new Set(applyDrill(viewRows, drill, NO_FOLDED).map((r) => r.id));
    return null;
  }, [drill, viewRows]);
  const trend = useMemo(() => {
    const totals = (data?.trend ?? []).map((y) => {
      const actual: Record<string, number> = {};
      let licensed = 0;
      for (const [cardId, cells] of Object.entries(y.cards)) {
        if (closure && !closure.has(cardId)) continue;
        if (trendIds && !trendIds.has(cardId)) continue;
        for (const [key, c] of Object.entries(cells)) {
          if (licenseType && key !== licenseType) continue;
          licensed += c.licensed;
          actual[key] = (actual[key] ?? 0) + (c.actual ?? 0);
        }
      }
      return { fiscalYear: y.fiscal_year, actual, licensed };
    });
    const components = sortedTypes
      .map((x) => x.key)
      .filter((k) =>
        (data?.trend ?? []).some((y) =>
          Object.entries(y.cards).some(
            ([id, cells]) =>
              cells[k] !== undefined &&
              (!closure || closure.has(id)) &&
              (!trendIds || trendIds.has(id)),
          ),
        ),
      );
    return { totals, components };
  }, [data, closure, trendIds, licenseType, sortedTypes]);
  const trendOption = useMemo(() => {
    const rows: CostTrendRow[] = trend.totals.map((y) => ({
      fiscalYear: y.fiscalYear,
      ...Object.fromEntries(trend.components.map((k) => [k, y.actual[k] ?? 0])),
    }));
    return buildCostTrendOption(rows, trend.components, {
      chrome,
      isRtl: chrome.isRtl,
      format: String,
      yearLabel: (y) => costFiscalYearName(y, currentFiscalYear),
      componentLabel: labelOfType,
      colorOf: (k) => hues.get(k) ?? CHART_OTHER[chrome.mode],
      extraSeries: [
        {
          type: "scatter",
          name: t("licensing.licensed"),
          symbol: "rect",
          symbolSize: [32, 3],
          z: 5,
          itemStyle: { color: chrome.textPrimary },
          data: trend.totals.map((y) => y.licensed),
        },
      ],
    });
  }, [trend, chrome, currentFiscalYear, labelOfType, hues, t]);

  const typeLabelOf = useCallback(
    (key: string) => {
      const tp = types.find((x) => x.key === key);
      return tp ? typeLabel(tp) : key;
    },
    [types, typeLabel],
  );

  // ── Utilisation ───────────────────────────────────────────────────────────────────────────
  const drilledRows = useMemo(() => applyDrill(scopedRows, drill, NO_FOLDED), [scopedRows, drill]);
  const groupedBars = effectiveGroupBy && !aggregate && drill.group === undefined && drill.cardId === undefined;
  const utilisationBars = useMemo<UtilisationBar[]>(() => {
    if (!groupedBars) {
      return drilledRows.map((r) => ({
        id: r.id,
        name: r.name,
        pct: r.pct,
        noLicence: r.noLicence,
        status: r.status,
        ...(aggregate && { typeLabel: typeLabelOf(r.type) }),
      }));
    }
    const byGroup = new Map<string, ViewRow[]>();
    for (const r of drilledRows) byGroup.set(r.group ?? OTHER_GROUP, [...(byGroup.get(r.group ?? OTHER_GROUP) ?? []), r]);
    return [...byGroup].map(([key, members]) => {
      const pcts = members.flatMap((m) => (m.pct == null ? [] : [m.pct]));
      return {
        id: `${GROUP_PREFIX}${key}`,
        name: groupLabel(key),
        pct: pcts.length ? Math.max(...pcts) : null,
        noLicence: members.some((m) => m.noLicence),
        status: worstStatus(members.map((m) => m.status)),
      };
    });
  }, [groupedBars, drilledRows, aggregate, groupLabel, typeLabelOf]);
  const utilisationOption = useMemo(
    () =>
      buildUtilisationOption(utilisationBars, {
        chrome,
        isRtl: chrome.isRtl,
        noData: t("licensing.noActual"),
        noLicense: t("licensing.noLicense"),
      }),
    [utilisationBars, chrome, t],
  );

  const idOf = (p: EChartClickParams) => (p.data as { id?: string } | undefined)?.id;
  const handleOpen = useCallback((p: EChartClickParams) => {
    const id = idOf(p);
    if (id && !id.startsWith(GROUP_PREFIX)) setSidePanelCardId(id);
  }, []);
  const handleDrill = useCallback(
    (p: EChartClickParams) => {
      const id = idOf(p);
      if (!id) return;
      if (id.startsWith(GROUP_PREFIX)) {
        setDrill({ group: id.slice(GROUP_PREFIX.length) });
        return;
      }
      const row = viewRows.find((r) => r.id === id);
      setDrill({ ...(row?.group !== undefined && { group: row.group }), cardId: id });
    },
    [viewRows],
  );
  const crumbs = useMemo(
    () =>
      crumbsOf(drill, {
        root: t("cost.breadcrumbRoot"),
        group: groupLabel,
        card: (id) => viewRows.find((r) => r.id === id)?.name ?? id,
      }),
    [drill, t, groupLabel, viewRows],
  );

  // ── By license type: the scope's (or the picked card's) totals per type ───────────────────
  const byTypeBars = useMemo<ByTypeBar[]>(() => {
    const rows = closure ? data?.rows.filter((r) => closure.has(r.id)) : data?.rows;
    return sortedTypes
      .filter((x) => !licenseType || x.key === licenseType)
      .flatMap((x) => {
        let licensed = 0;
        let actual: number | null = null;
        for (const r of rows ?? []) {
          const c = r.by_type[x.key];
          if (!c) continue;
          licensed += c.licensed;
          if (c.actual != null) actual = (actual ?? 0) + c.actual;
        }
        return licensed > 0 || actual != null
          ? [{ key: x.key, label: labelOfType(x.key), licensed, actual, color: hues.get(x.key) ?? "" }]
          : [];
      });
  }, [data, closure, sortedTypes, licenseType, labelOfType, hues]);
  const byTypeOption = useMemo(
    () =>
      buildByTypeOption(byTypeBars, {
        chrome,
        isRtl: chrome.isRtl,
        licensedLabel: t("licensing.licensed"),
        actualLabel: t("licensing.actual"),
      }),
    [byTypeBars, chrome, t],
  );

  const legendEntries = useMemo(
    () =>
      trend.components.map((k) => ({
        key: k,
        label: labelOfType(k),
        color: hues.get(k) ?? CHART_OTHER[chrome.mode],
      })),
    [trend.components, labelOfType, hues, chrome.mode],
  );

  const handleReset = useCallback(() => {
    setCardTypeKey("Application");
    setMetric("users");
    setLicenseType("");
    setGroupBy("");
    setView("chart");
    setFiscalYearParam(null);
    setPicked(null);
    setScopeIds([]);
  }, [setScopeIds]);

  const statusCards: { status: LicenseStatus; label: string; icon: string }[] = [
    { status: "compliant", label: t("licensing.statusCompliant"), icon: "check_circle" },
    { status: "approaching", label: t("licensing.statusApproaching"), icon: "warning" },
    { status: "over", label: t("licensing.statusOver"), icon: "error" },
    { status: "no_actual_data", label: t("licensing.statusNoActualData"), icon: "help" },
  ];

  const empty = data && data.rows.length === 0;

  return (
    <ReportShell<LicensingView>
      title={t("licensing.title")}
      icon="badge"
      iconColor={STATUS_COLORS.info}
      view={view}
      onViewChange={setView}
      chartViewLabel={t("licensing.viewUtilisation")}
      extraViews={[{ value: "bytype", icon: "bar_chart", label: t("licensing.viewByType") }]}
      chartRef={chartRef}
      onReset={handleReset}
      legend={view === "table" ? undefined : <CostLegend entries={legendEntries} />}
      toolbar={
        <>
          <TextField
            select
            size="small"
            label={t("licensing.cardType")}
            value={cardTypeKey}
            onChange={(e) => setCardTypeKey(e.target.value)}
            sx={{ minWidth: 150 }}
          >
            {typeOptions.map((o) => (
              <MenuItem key={o.key} value={o.key}>
                {o.label}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            select
            size="small"
            label={t("licensing.metric")}
            value={metric}
            onChange={(e) => setMetric(e.target.value as LicenseMetric)}
            sx={{ minWidth: 140 }}
          >
            {LICENSE_METRICS.map((m) => (
              <MenuItem key={m} value={m}>
                {t(`licensing.metric_${m}`)}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            select
            size="small"
            label={t("licensing.licenseType")}
            value={licenseType}
            slotProps={{ select: { displayEmpty: true } }}
            onChange={(e) => setLicenseType(e.target.value)}
            sx={{ minWidth: 170 }}
          >
            <MenuItem value="">{t("licensing.allLicenseTypes")}</MenuItem>
            {sortedTypes.map((x) => (
              <MenuItem key={x.key} value={x.key}>
                {labelOfType(x.key)}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            select
            size="small"
            label={t("cost.groupBy")}
            value={effectiveGroupBy}
            onChange={(e) => setGroupBy(e.target.value)}
            disabled={groupOptions.length === 0}
            helperText={groupOptions.length === 0 ? t("cost.groupByUnavailable") : undefined}
            sx={{ minWidth: 150 }}
          >
            <MenuItem value="">{t("cost.groupByNone")}</MenuItem>
            {groupOptions.map((o) => (
              <MenuItem key={o.value} value={o.value}>
                {o.label}
              </MenuItem>
            ))}
          </TextField>
          <CardScopeFilter
            types={cardTypeKey}
            value={effectiveScopeIds.length ? effectiveScopeIds : scopeIds}
            onChange={setScopeIds}
            labelAll={t("cost.scopeAll")}
            labelCount={(count) => t("cost.scopeCount", { count })}
            dialogTitle={t("cost.scopeDialogTitle")}
            helperText={t("cost.scopeHelper")}
            tooltip={t("cost.scopeTooltip")}
          />
          {view === "bytype" && (
            <CardPicker
              types={PICKABLE_TYPES}
              value={picked}
              onChange={setPicked}
              label={t("licensing.pickCard")}
              helperText={t("licensing.pickCardHelper")}
              size="small"
              sx={{ minWidth: 220 }}
            />
          )}
          <TextField
            select
            size="small"
            label={t("cost.fiscalYear")}
            value={fiscalYearParam ?? ""}
            slotProps={{ select: { displayEmpty: true } }}
            onChange={(e) => setFiscalYearParam(e.target.value === "" ? null : Number(e.target.value))}
            sx={{ minWidth: 130 }}
          >
            {yearOptions.map((o) => (
              <MenuItem key={o.label} value={o.value ?? ""}>
                {o.label}
              </MenuItem>
            ))}
          </TextField>
          {data && (
            <Tooltip title="" arrow>
              <Chip
                variant="outlined"
                icon={<MaterialSymbol icon="calendar_month" size={18} />}
                label={t("licensing.fiscalYearIndicator", {
                  fy: costFiscalYearName(data.fiscal_year, currentFiscalYear),
                })}
                data-testid="licensing-fiscal-year"
              />
            </Tooltip>
          )}
        </>
      }
    >
      {error && <Alert severity="error">{t("licensing.loadFailed")}</Alert>}
      {loading && !data && (
        <Box sx={{ py: 8, textAlign: "center" }}>
          <CircularProgress />
        </Box>
      )}
      {data && (
        <>
          {aggregate ? (
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              {t("licensing.platformNote", { name: aggregate.name })}
            </Typography>
          ) : (
            <Box sx={{ display: "flex", gap: 2, mb: 3, flexWrap: "wrap" }}>
              {statusCards.map((c) => (
                <MetricCard
                  key={c.status}
                  label={c.label}
                  value={counts[c.status]}
                  icon={c.icon}
                  iconColor={statusColor(c.status)}
                  color={statusColor(c.status)}
                />
              ))}
            </Box>
          )}

          <Box sx={{ mb: 3 }} data-testid="licensing-trend">
            <EChart option={trendOption} style={{ height: 300 }} ariaLabel={t("licensing.trendAria")} />
          </Box>

          {view === "chart" &&
            (utilisationBars.length === 0 ? (
              <Box sx={{ py: 8, textAlign: "center" }}>
                <Typography color="text.secondary">{t("licensing.noData")}</Typography>
              </Box>
            ) : (
              <>
                <CostDrillBar crumbs={crumbs} onSelect={setDrill} hint={t("licensing.drillHint")} />
                <EChart
                  option={utilisationOption}
                  style={{ height: utilisationHeight(utilisationBars.length) }}
                  ariaLabel={t("licensing.utilisationAria")}
                  onClick={handleOpen}
                  onContextMenu={handleDrill}
                />
              </>
            ))}

          {view === "bytype" &&
            (empty || byTypeBars.length === 0 ? (
              <Box sx={{ py: 8, textAlign: "center" }}>
                <Typography color="text.secondary">{t("licensing.noData")}</Typography>
              </Box>
            ) : (
              <EChart option={byTypeOption} style={{ height: 360 }} ariaLabel={t("licensing.byTypeAria")} />
            ))}

          {/* The Table view comes with the table (next task). */}
        </>
      )}
      <CardDetailSidePanel
        cardId={sidePanelCardId}
        open={sidePanelCardId !== null}
        onClose={() => setSidePanelCardId(null)}
      />
    </ReportShell>
  );
}
