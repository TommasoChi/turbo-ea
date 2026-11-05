import { useEffect, useState, useMemo, useCallback, useRef } from "react";
import { useTranslation } from "react-i18next";
import Box from "@mui/material/Box";
import TextField from "@mui/material/TextField";
import MenuItem from "@mui/material/MenuItem";
import Checkbox from "@mui/material/Checkbox";
import ListItemText from "@mui/material/ListItemText";
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
import type { ECharts, EChartsCoreOption } from "echarts/core";
import EChart, { EXPORT_DPR, type EChartClickParams } from "@/components/charts/EChart";
import { useEChartsTheme, type EChartsThemeValue } from "@/components/charts/echartsTheme";
import ReportShell from "./ReportShell";
import {
  buildCostTreemapOption,
  chartTileRect,
  type CostTreemapGroup,
  type CostTreemapItem,
} from "./costTreemapOption";
import { buildCostSankeyOption } from "./costSankeyOption";
import SaveReportDialog from "./SaveReportDialog";
import CostTrendChart, { type TrendSelection } from "./CostTrendChart";
import CostDrillBar from "./CostDrillBar";
import { crumbsOf, type Drill } from "./costDrill";
import { OTHERS_KEY } from "./costColors";
import MetricCard from "./MetricCard";
import FullscreenPanel from "./FullscreenPanel";
import { useMetamodel } from "@/hooks/useMetamodel";
import { useReadableCardTypes } from "@/hooks/useReadableCardTypes";
import { useSavedReport } from "@/hooks/useSavedReport";
import { applyScope, useCardScope } from "@/hooks/useCardScope";
import CardScopeFilter from "@/components/CardScopeFilter";
import { useThumbnailCapture } from "@/hooks/useThumbnailCapture";
import { useCurrency } from "@/hooks/useCurrency";
import { useAuth } from "@/hooks/useAuth";
import {
  useTypeLabel,
  useFieldLabel,
  useOptionLabel,
  useRelationLabel,
} from "@/hooks/useResolveLabel";
import CardDetailSidePanel from "@/components/CardDetailSidePanel";
import MaterialSymbol from "@/components/MaterialSymbol";
import { api } from "@/api/client";
import { useAbortableEffect } from "@/hooks/useLatestRequest";
import { resolveFacetField } from "@/lib/fieldFacets";
import {
  COMBINED_KEY,
  commonCostFields,
  costFieldChoices,
  commonGroupableFields,
  relationGroupOptions,
  typeKeysOf,
  typeParam,
} from "./costReportOptions";
import { costFiscalYearName, costFiscalYearOptions } from "@/lib/fiscalYear";
import { formatFieldValue, EMPTY_VALUE, type FieldMeta } from "@/lib/cardDisplayFields";
import { costValue } from "@/lib/costValue";
import { isCostItemType } from "@/lib/costItems";
import { useApiQuery } from "@/hooks/useApiQuery";
import type { CostItemType, FieldDef, TranslationMap } from "@/types";

const COST_REPORT_TYPE_KEYS = ["Application", "ITComponent"] as const;
/** The server's group for a card with no value (and for an ungrouped report). */
const OTHER_GROUP = "__other__";
type CostView = "chart" | "sankey" | "table";

interface CostItem {
  id: string;
  name: string;
  cost: number;
  attributes?: Record<string, unknown>;
  /** Raw group value, present when the request grouped. */
  group?: string;
}

interface CostTreemapResponse {
  items: CostItem[];
  total: number;
  /** Technical keys of the cost fields that add up to the total. */
  components?: string[];
  /** Catalogue cost items by key: the labels of the components that are cost items. */
  item_labels?: ReportItemLabels;
  /** The fiscal year the figures are for (the one requested). */
  fiscal_year?: number;
  /** The fiscal year that contains today, whatever year was requested. */
  current_fiscal_year?: number;
  /** Month (1-12) the workspace's fiscal year starts in. */
  fiscal_year_start?: number;
}

/** A catalogue cost item as the report sends it (`translations` is `{locale: label}`). */
type ReportItemLabels = Record<string, { label: string; translations?: TranslationMap }>;

const EMPTY_COMPONENTS: string[] = [];
const EMPTY_FOLDED: Set<string> = new Set();

interface SankeyNode {
  id: string;
  name: string;
  type: string;
  /** Card nodes only: the card's total and its value per cost item (incl. `__other__`). */
  cost?: number;
  costs?: Record<string, number>;
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
  item_labels?: ReportItemLabels;
  fiscal_year?: number;
  current_fiscal_year?: number;
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

function pickAllFields(schema: { fields: FieldDef[] }[]): FieldDef[] {
  const out: FieldDef[] = [];
  for (const s of schema) for (const f of s.fields) out.push(f);
  return out;
}

/* ------------------------------------------------------------------ */
/*  One treemap panel                                                  */
/* ------------------------------------------------------------------ */

interface CostTreemapPanelProps {
  /** The cards that cost anything, largest first, when the report is not grouped. */
  items: CostTreemapItem[];
  /** The groups, each holding its cards, when the report is grouped. */
  groups?: CostTreemapGroup[];
  /** The report's total, each tile's share is read against. */
  total: number;
  /** The panel fills the screen (fullscreen) instead of a fixed height. */
  fullscreen: boolean;
  /** The chart chrome, with the reading direction. */
  chrome: EChartsThemeValue;
  fmt: { format: (v: number) => string };
  onTileClick: (p: EChartClickParams) => void;
}

/**
 * The report's treemap: one tile per card sized by its cost, or one framed
 * block per group holding its cards. A tile prints what its rectangle fits (a
 * name, a name and a cost, or nothing — `tileLabelTier`), read from the
 * chart's own layout while ECharts renders it.
 */
function CostTreemapPanel({
  items,
  groups,
  total,
  fullscreen,
  chrome,
  fmt,
  onTileClick,
}: CostTreemapPanelProps) {
  const { t } = useTranslation(["reports", "common"]);
  const chartRef = useRef<ECharts | null>(null);
  const onInit = useCallback((chart: ECharts) => {
    chartRef.current = chart;
  }, []);
  // The label formatter calls this while ECharts renders each tile, after it
  // laid the tile out — so a resize re-reads the real rectangles with no React work.
  const tileRect = useCallback((dataIndex: number) => chartTileRect(chartRef.current, dataIndex), []);

  // Memoised: a new option replaces the chart's whole option and replays its
  // animation, so it is rebuilt only when the data or the theme change.
  const option = useMemo(
    () =>
      buildCostTreemapOption(items, {
        chrome,
        isRtl: chrome.isRtl,
        format: (v) => fmt.format(v),
        panelTotal: total,
        percentOfTotal: (pct) => t("cost.percentOfTotalValue", { pct }),
        clickable: true,
        tileRect,
        deltaNew: t("cost.deltaNew"),
        groups,
      }),
    [items, groups, chrome, fmt, total, t, tileRect],
  );

  return (
    <CostChartFrame
      option={option}
      fullscreen={fullscreen}
      ariaLabel={t("cost.title")}
      onClick={onTileClick}
      onInit={onInit}
    />
  );
}

/** The Paper around a cost chart: fixed height, or filling the fullscreen panel. */
function CostChartFrame({
  option,
  fullscreen,
  ariaLabel,
  testId,
  onClick,
  onContextMenu,
  onInit,
}: {
  option: EChartsCoreOption;
  fullscreen: boolean;
  ariaLabel: string;
  testId?: string;
  onClick?: (p: EChartClickParams) => void;
  onContextMenu?: (p: EChartClickParams) => void;
  onInit?: (chart: ECharts) => void;
}) {
  return (
    <Paper
      variant="outlined"
      sx={{ p: 1, ...(fullscreen && { flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }) }}
      data-testid={testId}
      onContextMenu={onContextMenu ? (e: React.MouseEvent) => e.preventDefault() : undefined}
    >
      {/* Drawn at the export's pixel ratio so the PPTX / PNG capture stays crisp. */}
      <EChart
        option={option}
        style={fullscreen ? { flex: 1, minHeight: 0 } : { height: 450 }}
        devicePixelRatio={EXPORT_DPR}
        ariaLabel={ariaLabel}
        onClick={onClick}
        onContextMenu={onContextMenu}
        onInit={onInit}
      />
    </Paper>
  );
}

interface CostSankeyPanelProps {
  nodes: SankeyNode[];
  links: SankeyLink[];
  /** The panel fills the screen (fullscreen) instead of a fixed height. */
  fullscreen: boolean;
  chrome: EChartsThemeValue;
  fmt: { format: (v: number) => string };
  onNodeClick?: (p: EChartClickParams) => void;
  onNodeContextMenu?: (p: EChartClickParams) => void;
}

/** The Sankey view: cost items -> groups -> cards. */
function CostSankeyPanel({
  nodes,
  links,
  fullscreen,
  chrome,
  fmt,
  onNodeClick,
  onNodeContextMenu,
}: CostSankeyPanelProps) {
  const { t } = useTranslation(["reports", "common"]);
  const option = useMemo(
    () =>
      buildCostSankeyOption(nodes, links, {
        chrome,
        isRtl: chrome.isRtl,
        format: (v) => fmt.format(v),
      }),
    [nodes, links, chrome, fmt],
  );
  return (
    <CostChartFrame
      option={option}
      fullscreen={fullscreen}
      ariaLabel={t("cost.sankeyChartView")}
      testId="cost-sankey-panel"
      onClick={onNodeClick}
      onContextMenu={onNodeContextMenu}
    />
  );
}

/* ------------------------------------------------------------------ */
/*  Main component                                                     */
/* ------------------------------------------------------------------ */

export default function CostReport() {
  const { t } = useTranslation(["reports", "common"]);
  const { types, relationTypes, loading: ml } = useMetamodel();
  // Report type pickers offer only the types the user may see.
  const readableTypes = useReadableCardTypes("module");
  const typeLabel = useTypeLabel();
  const relLabel = useRelationLabel();
  const fieldLabel = useFieldLabel();
  const optLabel = useOptionLabel();
  const { fmt } = useCurrency();
  const chartTheme = useEChartsTheme();
  const { user } = useAuth();
  const canViewCostsGlobally = !!(
    user?.permissions?.["*"] || user?.permissions?.["costs.view"]
  );
  const typeOptions = useMemo(() => {
    const byKey = new Map(readableTypes.map((tp) => [tp.key, tp]));
    const app = byKey.get("Application");
    const itc = byKey.get("ITComponent");
    const out: { key: string; label: string }[] = [];
    if (app) out.push({ key: app.key, label: typeLabel(app) });
    if (itc) out.push({ key: itc.key, label: typeLabel(itc) });
    if (app && itc)
      out.push({
        key: COMBINED_KEY,
        label: t("cost.combinedType", {
          first: typeLabel(app),
          second: typeLabel(itc),
        }),
      });
    return out;
  }, [readableTypes, typeLabel, t]);
  const saved = useSavedReport("cost");
  const { chartRef, thumbnail, captureAndSave } = useThumbnailCapture(() =>
    saved.setSaveDialogOpen(true),
  );
  // A type key, or COMBINED_KEY for Applications and IT Components together.
  const [cardTypeKey, setCardTypeKey] = useState("Application");
  const typeKeys = useMemo(() => typeKeysOf(cardTypeKey), [cardTypeKey]);
  const combined = typeKeys.length > 1;
  const [sidePanelCardId, setSidePanelCardId] = useState<string | null>(null);
  const [costField, setCostField] = useState("costTotalAnnual");
  const [groupBy, setGroupBy] = useState("");
  const [rawItems, setRawItems] = useState<CostItem[] | null>(null);
  // The cost field keys that add up to the total, from the treemap response.
  // Tagged with the type and field they answer, so a stale list never meets a new selection.
  const [componentsFor, setComponentsFor] = useState<{ key: string; list: string[] }>({
    key: "",
    list: [],
  });
  const components =
    componentsFor.key === `${cardTypeKey}|${costField}` ? componentsFor.list : EMPTY_COMPONENTS;
  // Current-year baseline, fetched only when a past fiscal year is selected —
  // the treemap delta badge diffs against it (id -> cost).
  const [baselineCosts, setBaselineCosts] = useState<Map<string, number>>(
    new Map(),
  );
  // Prior-year costs, fetched only when a past fiscal year is selected — the
  // table YoY% column diffs against it (id -> cost).
  const [priorYearCosts, setPriorYearCosts] = useState<Map<string, number>>(
    new Map(),
  );
  const [sankeyData, setSankeyData] = useState<CostSankeyResponse | null>(null);
  const [itemLabels, setItemLabels] = useState<ReportItemLabels>({});
  const [view, setView] = useState<CostView>("chart");
  const [sortK, setSortK] = useState("cost");
  const [sortD, setSortD] = useState<"asc" | "desc">("desc");
  // The server names the fiscal year the figures are for.
  const [fiscalYear, setFiscalYear] = useState<FiscalYear | null>(null);
  // null = current year (the param is omitted, matching today's default
  // request shape byte-for-byte); a picked value asks the server for a past
  // year's card_cost_history row instead of live attributes.
  const [fiscalYearParam, setFiscalYearParam] = useState<number | null>(null);
  // The fiscal year containing today, from the server. NOT `fiscalYear.year`,
  // which is the requested year: anchoring the picker on it re-centred the list
  // every time a past year was picked.
  const [currentFiscalYear, setCurrentFiscalYear] = useState(() =>
    new Date().getFullYear(),
  );
  const fiscalYearOptions = useMemo(
    () => costFiscalYearOptions(currentFiscalYear),
    [currentFiscalYear],
  );
  // The history chart shows on the Forecast year only: the four years before the current one,
  // the current one and the forecast, oldest first. Memoised: the chart refetches when the identity changes.
  const showForecast = fiscalYearParam === currentFiscalYear + 1;
  const trendYears = useMemo(
    () => Array.from({ length: 6 }, (_, i) => currentFiscalYear - 4 + i),
    [currentFiscalYear],
  );
  // Learn the current year from a response, and fall back to "Current" when the
  // requested year is that one or is not among the offered years (a saved
  // report from an earlier year).
  const adoptCurrentFiscalYear = useCallback((cy: number | undefined) => {
    if (cy == null) return;
    setCurrentFiscalYear(cy);
    setFiscalYearParam((p) =>
      p != null && !costFiscalYearOptions(cy).some((o) => o.value === p) ? null : p,
    );
  }, []);

  // Narrow the treemap to chosen cards and everything beneath them (#954).
  // A scope belongs to one type, so the combined option has none.
  const scope = useCardScope({ typeKey: combined ? null : cardTypeKey, enabled: true });
  const { scopeIds, setScopeIds, effectiveScopeIds } = scope;

  // One schema per selected type; empty until every one of them is known.
  const schemas = useMemo(() => {
    const defs = typeKeys.map((k) => types.find((tp) => tp.key === k));
    return defs.every(Boolean) ? defs.map((d) => d!.fields_schema) : [];
  }, [types, typeKeys]);
  const costFields = useMemo(
    () => commonCostFields(schemas).map((f) => ({ ...f, label: fieldLabel(f) })),
    [schemas, fieldLabel],
  );
  // Cost-item types pick TCO or one catalogue item; any signed-in user may read the catalogue.
  const { data: catalogue } = useApiQuery<CostItemType[]>("/metamodel/cost-item-types");
  const costChoices = useMemo(
    () =>
      costFieldChoices(
        typeKeys,
        Array.isArray(catalogue) ? catalogue : [],
        costFields,
        t("cost.tco"),
        (i) => fieldLabel({ key: i.key, label: i.label, translations: i.translations }),
      ),
    [typeKeys, catalogue, costFields, t, fieldLabel],
  );
  // Extra table columns come from one type's fields: none for the combined option.
  const allFields = useMemo(() => {
    const raw = schemas.length === 1 ? pickAllFields(schemas[0]) : [];
    return raw.map((f) => ({ ...f, label: fieldLabel(f) }));
  }, [schemas, fieldLabel]);
  const [extraColumns, setExtraColumns] = useState<string[]>([]);

  // Drop picked columns the current type no longer defines (card-type
  // switch) — mirrors the removed aggregateOptions pruning effect.
  useEffect(() => {
    setExtraColumns((prev) =>
      prev.filter((key) => allFields.some((f) => f.key === key)),
    );
  }, [allFields]);

  // Auto-select cost field when card type changes — only when the current one
  // is not on the type, so a restored field the type does carry is kept.
  // Declared before the restore below on purpose: effects run in declaration
  // order, so on mount this effect's pick (made from the starting type's
  // fields) is queued first and the restored type + field overwrite it.
  useEffect(() => {
    // A cost-item type's choices are incomplete until the catalogue is in: do not reset a restored item.
    if (catalogue === undefined && typeKeys.length > 0 && typeKeys.every(isCostItemType)) return;
    if (costChoices.length > 0 && !costChoices.some((f) => f.key === costField)) {
      setCostField(costChoices[0].key);
    }
  }, [costChoices, catalogue]); // eslint-disable-line react-hooks/exhaustive-deps

  // A selection the user may not read (a saved combined option whose IT
  // Component is hidden, an Initiative they cannot see) falls back.
  useEffect(() => {
    if (ml || typeOptions.length === 0) return;
    if (!typeOptions.some((o) => o.key === cardTypeKey))
      setCardTypeKey(
        typeOptions.some((o) => o.key === "Application") ? "Application" : typeOptions[0].key,
      );
  }, [ml, typeOptions, cardTypeKey]);

  // Load saved report config
  useEffect(() => {
    const cfg = saved.consumeConfig();
    if (cfg) {
      const restoredType =
        typeof cfg.cardTypeKey === "string" &&
        (cfg.cardTypeKey === COMBINED_KEY ||
          COST_REPORT_TYPE_KEYS.includes(cfg.cardTypeKey as never))
          ? cfg.cardTypeKey
          : undefined;
      if (restoredType) setCardTypeKey(restoredType);
      if (cfg.costField) setCostField(cfg.costField as string);
      if (cfg.groupBy !== undefined) setGroupBy(cfg.groupBy as string);
      if (cfg.view) setView(cfg.view as CostView);
      if (cfg.sortK) setSortK(cfg.sortK as string);
      if (cfg.sortD) setSortD(cfg.sortD as "asc" | "desc");
      if (typeof cfg.fiscalYearParam === "number")
        setFiscalYearParam(cfg.fiscalYearParam);
      if (Array.isArray(cfg.extraColumns))
        setExtraColumns(
          (cfg.extraColumns as unknown[]).filter(
            (v): v is string => typeof v === "string",
          ),
        );
      // Set for the restored type, so the scope is read as that type's from
      // the render the type lands on.
      if (Array.isArray(cfg.scopeIds) && restoredType !== COMBINED_KEY) {
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
    extraColumns,
    fiscalYearParam,
  });

  // Auto-persist config to localStorage
  useEffect(() => {
    saved.persistConfig(getConfig());
  }, [cardTypeKey, costField, groupBy, view, sortK, sortD, scopeIds, extraColumns, fiscalYearParam]); // eslint-disable-line react-hooks/exhaustive-deps

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
    setExtraColumns([]);
    setFiscalYearParam(null);
  }, [saved]); // eslint-disable-line react-hooks/exhaustive-deps

  // The table's group-by: single selects with options and yes/no fields (a
  // multi-select cannot put a card in exactly one group). A yes/no field is
  // given Yes / No options, so its groups are named rather than "true".
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

  // What the Group by selector offers: `field:<key>` and `rel:<key>` values.
  const groupOptions = useMemo(
    () => [
      ...groupableFields.map((f) => ({ value: `field:${f.key}`, label: f.label })),
      ...relationGroupOptions(relationTypes, typeKeys, relLabel),
    ],
    [groupableFields, relationTypes, typeKeys, relLabel],
  );
  // A saved bare field key becomes `field:<key>`; one that is not offered is dropped.
  const effectiveGroupBy = useMemo(() => {
    const offered = (v: string) => groupOptions.some((o) => o.value === v);
    if (offered(groupBy)) return groupBy;
    return groupBy && offered(`field:${groupBy}`) ? `field:${groupBy}` : "";
  }, [groupBy, groupOptions]);
  useEffect(() => {
    if (!ml && effectiveGroupBy !== groupBy) setGroupBy(effectiveGroupBy);
  }, [ml, effectiveGroupBy, groupBy]);

  useAbortableEffect(
    async ({ signal, isCurrent }) => {
      if (!canViewCostsGlobally) {
        // Nothing loaded: a later grant shows the spinner, not an empty report.
        setRawItems(null);
        setSankeyData(null);
        return;
      }
      if (view === "sankey") {
        const p = new URLSearchParams({
          type: typeParam(cardTypeKey),
          cost_field: costField,
        });
        if (effectiveGroupBy) p.set("group_by", effectiveGroupBy);
        if (fiscalYearParam != null) p.set("fiscal_year", String(fiscalYearParam));
        const r = await api.get<CostSankeyResponse>(
          `/reports/cost-sankey?${p}`,
          { signal },
        );
        if (!isCurrent()) return;
        setSankeyData(r);
        setItemLabels(r.item_labels ?? {});
        setRawItems(null);
        setFiscalYear((prev) => fiscalYearOf(r) ?? prev);
        adoptCurrentFiscalYear(r.current_fiscal_year);
      } else {
        const p = new URLSearchParams({
          type: typeParam(cardTypeKey),
          cost_field: costField,
        });
        if (effectiveGroupBy) p.set("group_by", effectiveGroupBy);
        if (fiscalYearParam != null) p.set("fiscal_year", String(fiscalYearParam));
        const r = await api.get<CostTreemapResponse>(
          `/reports/cost-treemap?${p}`,
          { signal },
        );
        if (!isCurrent()) return;
        setRawItems(r.items);
        setItemLabels(r.item_labels ?? {});
        setComponentsFor({ key: `${cardTypeKey}|${costField}`, list: r.components ?? [] });
        setSankeyData(null);
        setFiscalYear((prev) => fiscalYearOf(r) ?? prev);
        adoptCurrentFiscalYear(r.current_fiscal_year);
      }
    },
    [cardTypeKey, costField, effectiveGroupBy, view, canViewCostsGlobally, fiscalYearParam],
  );

  // Delta badge baseline: the current fiscal year's per-card costs, fetched
  // only when a past year is selected and the treemap is showing — nothing to
  // diff against when `fiscalYearParam` is null (the picked year already IS
  // the current year).
  useAbortableEffect(
    async ({ signal, isCurrent }) => {
      if (
        !canViewCostsGlobally ||
        view !== "chart" ||
        fiscalYearParam == null
      ) {
        setBaselineCosts(new Map());
        return;
      }
      const p = new URLSearchParams({
        type: typeParam(cardTypeKey),
        cost_field: costField,
      });
      const r = await api.get<CostTreemapResponse>(`/reports/cost-treemap?${p}`, {
        signal,
      });
      if (!isCurrent()) return;
      setBaselineCosts(new Map(r.items.map((it) => [it.id, it.cost])));
    },
    [cardTypeKey, costField, view, canViewCostsGlobally, fiscalYearParam],
  );

  // The earliest year the picker itself offers — a selected year at or below
  // it has no prior year to diff against, so the YoY fetch is skipped rather
  // than sent for a year outside the picker's own range.
  const minFiscalYearOption = useMemo(
    () =>
      Math.min(
        // "Current" (null) is not a requestable year: it is never the earliest.
        ...fiscalYearOptions.flatMap((o) => (o.value == null ? [] : [o.value])),
      ),
    [fiscalYearOptions],
  );

  // Table YoY%: the prior fiscal year's per-card costs, fetched only when a
  // past year is selected, the table is showing, and a prior year exists in
  // the picker's own range.
  useAbortableEffect(
    async ({ signal, isCurrent }) => {
      if (
        !canViewCostsGlobally ||
        view !== "table" ||
        fiscalYearParam == null ||
        fiscalYearParam <= minFiscalYearOption
      ) {
        setPriorYearCosts(new Map());
        return;
      }
      const p = new URLSearchParams({
        type: typeParam(cardTypeKey),
        cost_field: costField,
        fiscal_year: String(fiscalYearParam - 1),
      });
      const r = await api.get<CostTreemapResponse>(`/reports/cost-treemap?${p}`, {
        signal,
      });
      if (!isCurrent()) return;
      setPriorYearCosts(new Map(r.items.map((it) => [it.id, it.cost])));
    },
    [
      cardTypeKey,
      costField,
      view,
      canViewCostsGlobally,
      fiscalYearParam,
      minFiscalYearOption,
    ],
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

  // The page names a group: the server sends the raw value (an option key,
  // "true"/"false", a linked card's name, or "__other__").
  const groupLabel = useCallback(
    (raw: string | undefined) => {
      if (!raw || raw === OTHER_GROUP) return t("cost.unspecified");
      const key = effectiveGroupBy.startsWith("field:")
        ? effectiveGroupBy.slice(6)
        : null;
      const opt = groupableFields
        .find((f) => f.key === key)
        ?.options?.find((o) => o.key === raw);
      return opt?.label ?? raw;
    },
    [effectiveGroupBy, groupableFields, t],
  );

  const groups = useMemo(() => {
    if (!effectiveGroupBy) return null;
    // Keyed by the raw value: two raw values may share a label.
    const map = new Map<
      string,
      { key: string; label: string; items: CostItem[]; cost: number }
    >();
    for (const item of items) {
      const key = item.group ?? OTHER_GROUP;
      const g = map.get(key) || { key, label: groupLabel(key), items: [], cost: 0 };
      g.items.push(item);
      g.cost += item.cost;
      map.set(key, g);
    }
    return [...map.values()].sort((a, b) => b.cost - a.cost);
  }, [items, effectiveGroupBy, groupLabel]);

  // A cost item's label: the catalogue's (the report sends it, archived items
  // included), else the schema field's. Undefined when neither knows the key.
  const knownItemLabel = useCallback(
    (key: string) =>
      (itemLabels[key] ? fieldLabel({ key, ...itemLabels[key] }) : undefined) ??
      costFields.find((f) => f.key === key)?.label,
    [itemLabels, costFields, fieldLabel],
  );
  const trendLabelOf = useCallback(
    (key: string) => {
      const known = knownItemLabel(key);
      if (known) return known;
      const item = Array.isArray(catalogue) ? catalogue.find((c) => c.key === key) : undefined;
      return item ? fieldLabel({ key, label: item.label, translations: item.translations }) : key;
    },
    [knownItemLabel, catalogue, fieldLabel],
  );
  // A cost-item type stacks the catalogue's items (archived included) in sort order, so the trend
  // also renders in the Sankey view, where the treemap `components` are not loaded.
  const trendComponents = useMemo(() => {
    if (Array.isArray(catalogue) && catalogue.length > 0 && typeKeys.every(isCostItemType)) {
      return [...catalogue].sort((a, b) => a.sort_order - b.sort_order).map((c) => c.key);
    }
    return components;
  }, [catalogue, typeKeys, components]);
  const [drill, setDrill] = useState<Drill>({});
  // Until the colour assignment is wired, no group is folded.
  const foldedKeys = EMPTY_FOLDED;
  // A drill names ids that exist only under the current selection.
  useEffect(() => {
    setDrill((d) => (d.group === undefined && d.cardId === undefined ? d : {}));
  }, [cardTypeKey, costField, effectiveGroupBy, fiscalYearParam, scopeIds]);
  const trendSelection = useMemo<TrendSelection | undefined>(() => {
    if (drill.cardId !== undefined) return { kind: "card", id: drill.cardId };
    if (drill.group === undefined) return undefined;
    return { kind: "group", keys: drill.group === OTHERS_KEY ? [...foldedKeys] : [drill.group] };
  }, [drill, foldedKeys]);
  const crumbs = useMemo(
    () =>
      crumbsOf(drill, {
        root: t("cost.breadcrumbRoot"),
        group: (k) => (k === OTHERS_KEY ? t("cost.others") : groupLabel(k)),
        card: (id) => rawItems?.find((i) => i.id === id)?.name ?? id,
      }),
    [drill, t, groupLabel, rawItems],
  );
  const drillBar = (
    <CostDrillBar crumbs={crumbs} onSelect={setDrill} hint={t("cost.drillHint")} />
  );
  const trendChart =
    showForecast && trendComponents.length > 0 ? (
      <Box sx={{ mt: 2 }}>
        <CostTrendChart
          typeParam={typeParam(cardTypeKey)}
          costField={costField}
          components={trendComponents}
          labelOf={trendLabelOf}
          years={trendYears}
          currentFiscalYear={currentFiscalYear}
          groupBy={effectiveGroupBy}
          selection={trendSelection}
          scopeIds={scope.closure}
        />
      </Box>
    ) : null;
  // A cost-item node: the item's label, or "Other costs" for what the
  // components leave of a card's total.
  const itemLabel = useCallback(
    (key: string, fallback: string) =>
      key === OTHER_GROUP ? t("cost.otherCostItem") : (knownItemLabel(key) ?? fallback),
    [knownItemLabel, t],
  );

  // Scope applies to the Sankey here: hide the cards outside it, then every
  // cost-item and group node left without a card below it.
  const sankeyView = useMemo(() => {
    if (!sankeyData) return null;
    const closure = scope.closure;
    const isCard = (n: SankeyNode) => n.type !== "CostItem" && n.type !== "Group";
    const keep = sankeyData.nodes.map((n) => !isCard(n) || !closure || closure.has(n.id));
    // Scoped: an item -> group flow is the sum of the kept cards' own values for that item.
    const flowValue = (l: SankeyLink) => {
      if (!closure || sankeyData.nodes[l.target]?.type !== "Group") return l.value;
      const item = sankeyData.nodes[l.source].id.replace(/^item:/, "");
      return sankeyData.links
        .filter((c) => c.source === l.target && keep[c.target])
        .reduce((n, c) => n + (sankeyData.nodes[c.target].costs?.[item] ?? 0), 0);
    };
    const values = sankeyData.links.map(flowValue);
    if (closure) {
      // item -> group -> card: the first pass drops groups, the second items.
      for (let pass = 0; pass < 2; pass++)
        sankeyData.nodes.forEach((n, i) => {
          if (!isCard(n))
            keep[i] = sankeyData.links.some(
              (l, k) => l.source === i && keep[l.target] && values[k] > 0,
            );
        });
    }
    const index = new Map<number, number>();
    const nodes: SankeyNode[] = [];
    sankeyData.nodes.forEach((n, i) => {
      if (!keep[i]) return;
      index.set(i, nodes.length);
      nodes.push(
        n.type === "Group"
          ? { ...n, name: groupLabel(n.id.replace(/^group:/, "")) }
          : n.type === "CostItem"
            ? { ...n, name: itemLabel(n.id.replace(/^item:/, ""), n.name) }
            : n,
      );
    });
    const links = sankeyData.links.flatMap((l, k) =>
      keep[l.source] && keep[l.target] && (!closure || values[k] > 0)
        ? [{ ...l, value: values[k], source: index.get(l.source)!, target: index.get(l.target)! }]
        : [],
    );
    return { ...sankeyData, nodes, links };
  }, [sankeyData, scope.closure, groupLabel, itemLabel]);

  const printParams = useMemo(() => {
    const params: { label: string; value: string }[] = [];
    const tpLabel =
      typeOptions.find((o) => o.key === cardTypeKey)?.label || cardTypeKey;
    params.push({ label: t("common:labels.type"), value: tpLabel });
    // Always stated: every figure on the page is for this one fiscal year.
    if (fiscalYear) {
      params.push({
        label: t("cost.fiscalYear"),
        value: costFiscalYearName(fiscalYear.year, currentFiscalYear),
      });
    }
    if (costChoices.length > 1) {
      const cfLabel =
        costChoices.find((f) => f.key === costField)?.label || knownItemLabel(costField) || costField;
      params.push({ label: t("cost.costField"), value: cfLabel });
    }
    if (effectiveGroupBy) {
      const gLabel =
        groupOptions.find((o) => o.value === effectiveGroupBy)?.label ||
        effectiveGroupBy;
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
    typeOptions,
    costField,
    costChoices,
    knownItemLabel,
    effectiveGroupBy,
    groupOptions,
    view,
    effectiveScopeIds,
    fiscalYear,
    currentFiscalYear,
    t,
  ]);

  // A tile hands back the datum it was built from; a group frame has no card id and is inert.
  const handleTileClick = useCallback((p: EChartClickParams) => {
    const d = p.data as { id?: string } | undefined;
    if (d?.id) setSidePanelCardId(d.id);
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

  // The Sankey view loads no treemap items: its tiles read the card nodes it keeps.
  const summaryCards: { name: string; cost: number }[] =
    view === "sankey"
      ? (sankeyView?.nodes ?? [])
          .filter((n) => n.cost !== undefined)
          .map((n) => ({ name: n.name, cost: n.cost! }))
      : items;
  const summaryTotal = summaryCards.reduce((sum, c) => sum + c.cost, 0);
  const topDriver = summaryCards.reduce<{ name: string; cost: number } | null>(
    (top, c) => (!top || c.cost > top.cost ? c : top),
    null,
  );
  const avgCost = summaryCards.length > 0 ? summaryTotal / summaryCards.length : 0;

  const treemapLeaf = (d: CostItem, i: number): CostTreemapItem => {
    const baseline = baselineCosts.get(d.id);
    const deltaPct =
      fiscalYearParam == null
        ? undefined
        : baseline && baseline > 0
          ? (d.cost - baseline) / baseline
          : null;
    return { id: d.id, name: d.name, cost: d.cost, index: i, deltaPct };
  };
  // Grouped: each group is a frame holding its cards, which take the frame's colour.
  const treemapGroups: CostTreemapGroup[] | undefined = groups?.map((g, gi) => ({
    name: g.label,
    cost: g.cost,
    index: gi,
    items: [...g.items].sort((x, y) => y.cost - x.cost).map((d) => treemapLeaf(d, gi)),
  }));
  const treemapItems = [...items].sort((x, y) => y.cost - x.cost).map(treemapLeaf);

  const sort = (k: string) => {
    setSortD(sortK === k && sortD === "asc" ? "desc" : "asc");
    setSortK(k);
  };
  const sorted = [...items].sort((a, b) => {
    const d = sortD === "asc" ? 1 : -1;
    if (sortK === "cost") return (a.cost - b.cost) * d;
    return a.name.localeCompare(b.name) * d;
  });

  const yesNoLabels = {
    yes: t("common:labels.yes"),
    no: t("common:labels.no"),
  };
  const fieldMeta = (key: string): FieldMeta | undefined => {
    const f = allFields.find((fd) => fd.key === key);
    return f ? ({ ...f, typeKeys } as FieldMeta) : undefined;
  };
  const extraCell = (item: CostItem) =>
    extraColumns.map((key) => (
      <TableCell key={key} align="right">
        {formatFieldValue(
          (item.attributes as Record<string, unknown> | undefined)?.[key],
          fieldMeta(key),
          { optionLabel: optLabel, yes: yesNoLabels.yes, no: yesNoLabels.no },
        )}
      </TableCell>
    ));
  const yoyCell = (item: CostItem) => {
    const prior = priorYearCosts.get(item.id);
    const pct = prior && prior > 0 ? (item.cost - prior) / prior : null;
    return (
      <TableCell align="right">
        {pct == null ? EMPTY_VALUE : `${pct >= 0 ? "+" : ""}${(pct * 100).toFixed(1)}%`}
      </TableCell>
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
          <TextField
            select
            size="small"
            label={t("cost.cardType")}
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
          {!combined && (
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
          {costChoices.length > 1 && (
            <TextField
              select
              size="small"
              label={t("cost.costField")}
              value={costField}
              onChange={(e) => setCostField(e.target.value)}
              sx={{ minWidth: 160 }}
            >
              {costChoices.map((f) => (
                <MenuItem key={f.key} value={f.key}>
                  {f.label}
                </MenuItem>
              ))}
            </TextField>
          )}

          <TextField
            select
            size="small"
            label={t("cost.groupBy")}
            value={effectiveGroupBy}
            onChange={(e) => setGroupBy(e.target.value)}
            disabled={groupOptions.length === 0}
            helperText={
              groupOptions.length === 0 ? t("cost.groupByUnavailable") : undefined
            }
            sx={{ minWidth: 150 }}
          >
            <MenuItem value="">{t("cost.groupByNone")}</MenuItem>
            {groupOptions.map((o) => (
              <MenuItem key={o.value} value={o.value}>
                {o.label}
              </MenuItem>
            ))}
          </TextField>

          {view === "table" && allFields.length > 0 && (
            <TextField
              select
              size="small"
              label={t("cost.columns")}
              value={extraColumns}
              onChange={(e) => {
                const v = e.target.value;
                setExtraColumns(
                  typeof v === "string" ? v.split(",") : (v as string[]),
                );
              }}
              SelectProps={{
                multiple: true,
                renderValue: (selected) =>
                  (selected as string[]).length
                    ? String((selected as string[]).length)
                    : t("cost.columnsNone"),
              }}
              sx={{ minWidth: 150 }}
            >
              {allFields.map((f) => (
                <MenuItem key={f.key} value={f.key}>
                  <Checkbox checked={extraColumns.includes(f.key)} />
                  <ListItemText primary={f.label} />
                </MenuItem>
              ))}
            </TextField>
          )}

          <TextField
            select
            size="small"
            label={t("cost.fiscalYear")}
            value={fiscalYearParam ?? ""}
            // "" is the "Current" entry; without this MUI shows it as blank.
            slotProps={{ select: { displayEmpty: true } }}
            onChange={(e) =>
              setFiscalYearParam(
                e.target.value === "" ? null : Number(e.target.value),
              )
            }
            sx={{ minWidth: 130 }}
          >
            {fiscalYearOptions.map((o) => (
              <MenuItem key={o.label} value={o.value ?? ""}>
                {o.label}
              </MenuItem>
            ))}
          </TextField>

          {fiscalYear && (
            // The live-card rule only describes the current year; other years list every card with a recorded cost.
            <Tooltip
              title={fiscalYearParam == null ? t("cost.fiscalYearHelp") : ""}
              arrow
              placement="bottom"
            >
              <Chip
                variant="outlined"
                icon={<MaterialSymbol icon="calendar_month" size={18} />}
                label={t("cost.fiscalYearIndicator", {
                  fy: costFiscalYearName(fiscalYear.year, currentFiscalYear),
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
          value={fmt.format(summaryTotal)}
          icon="payments"
          iconColor="#2e7d32"
          color="#2e7d32"
        />
        <MetricCard
          label={t("cost.items")}
          value={summaryCards.length}
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
            subtitle={`${fmt.format(topDriver.cost)} (${summaryTotal > 0 ? ((topDriver.cost / summaryTotal) * 100).toFixed(0) : 0}%)`}
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
          <>
            {drillBar}
            <FullscreenPanel label={t("cost.fullscreen")}>
              {(isFullscreen) => (
                <CostTreemapPanel
                  items={treemapItems}
                  groups={treemapGroups}
                  total={total}
                  fullscreen={isFullscreen}
                  chrome={chartTheme}
                  fmt={fmt}
                  onTileClick={handleTileClick}
                />
              )}
            </FullscreenPanel>
            {trendChart}
          </>
        )
      ) : view === "sankey" ? (
        !sankeyView || sankeyView.nodes.length === 0 ? (
          <Box sx={{ py: 8, textAlign: "center" }}>
            <Typography color="text.secondary">
              {t("cost.noCostData")}
            </Typography>
          </Box>
        ) : (
          <>
            {drillBar}
            <FullscreenPanel label={t("cost.fullscreen")}>
              {(isFullscreen) => (
                <CostSankeyPanel
                  nodes={sankeyView.nodes}
                  links={sankeyView.links}
                  fullscreen={isFullscreen}
                  chrome={chartTheme}
                  fmt={fmt}
                />
              )}
            </FullscreenPanel>
            {trendChart}
          </>
        )
      ) : (
        <>
        {drillBar}
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
                {fiscalYearParam != null && (
                  <TableCell align="right">{t("cost.yoyPercent")}</TableCell>
                )}
                {extraColumns.map((key) => (
                  <TableCell key={key} align="right">
                    {allFields.find((f) => f.key === key)?.label ?? key}
                  </TableCell>
                ))}
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
                        key={`grp-${g.key}`}
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
                        {fiscalYearParam != null && (
                          <TableCell align="right" sx={{ fontWeight: 700 }} />
                        )}
                        {extraColumns.map((key) => (
                          <TableCell
                            key={key}
                            align="right"
                            sx={{ fontWeight: 700 }}
                          >
                            {fieldMeta(key)?.type === "cost"
                              ? fmt.format(
                                  g.items.reduce(
                                    (s, it) =>
                                      s +
                                      costValue(
                                        (
                                          it.attributes as
                                            | Record<string, unknown>
                                            | undefined
                                        )?.[key],
                                      ),
                                    0,
                                  ),
                                )
                              : null}
                          </TableCell>
                        ))}
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
                          {fiscalYearParam != null && yoyCell(d)}
                          {extraCell(d)}
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
                      {fiscalYearParam != null && yoyCell(d)}
                      {extraCell(d)}
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
                {fiscalYearParam != null && (
                  <TableCell align="right" sx={{ fontWeight: 700 }} />
                )}
                {extraColumns.map((key) => (
                  <TableCell key={key} align="right" />
                ))}
              </TableRow>
            </TableBody>
          </Table>
        </Paper>
        {trendChart}
        </>
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
