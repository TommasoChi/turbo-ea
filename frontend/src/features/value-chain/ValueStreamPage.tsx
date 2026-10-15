import { useRef, useState, type ReactNode } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { useTranslation } from "react-i18next";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import CircularProgress from "@mui/material/CircularProgress";
import IconButton from "@mui/material/IconButton";
import LinearProgress from "@mui/material/LinearProgress";
import { ApiError } from "@/api/client";
import CardDetailSidePanel from "@/components/CardDetailSidePanel";
import MaterialSymbol from "@/components/MaterialSymbol";
import ProcessDetailSidePanel from "@/components/ProcessDetailSidePanel";
import ProcessFlowPreview from "@/components/ProcessFlowPreview";
import ReportShell from "@/features/reports/ReportShell";
import { useApiQuery } from "@/hooks/useApiQuery";
import { useMetamodel } from "@/hooks/useMetamodel";
import { useFieldLabel, useOptionLabel, useSubtypeLabel } from "@/hooks/useResolveLabel";
import { iconSize } from "@/theme/tokens";
import type { StreamRelatedMode, ValueStreamResponse, ValueStreamRoot } from "@/types";
import { streamExportData } from "./exportData";
import { StreamContext, type StreamContextValue } from "./StreamContext";
import { useValueChainTypes } from "./useValueChainTypes";
import {
  buildColorScale,
  fieldOf,
  fieldOptionsOf,
  moveKey,
  PROCESS_COLOR_ATTRS,
  readStreamBandOrder,
  writeStreamBandOrder,
  type GateColorBy,
  type ProcessColorBy,
  type StreamBandKey,
} from "./valueChainModel";
import { exportValueStreamToWord, type WordExportInput, type WordLabels } from "./valueChainExport";
import ValueStreamRootView from "./ValueStreamRoot";

interface Props {
  /** Word export of one root; replaceable in tests. */
  exportWord?: (input: WordExportInput) => Promise<void>;
}

/** `/value-chain/value-stream?category=ID`: the Value Stream map of every root linked to a process category. */
export default function ValueStreamPage({ exportWord = exportValueStreamToWord }: Props) {
  const { t, i18n } = useTranslation("valuechain");
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const categoryId = params.get("category");
  const types = useValueChainTypes();
  const { types: metamodelTypes } = useMetamodel();
  const fieldLabel = useFieldLabel();
  const optionLabel = useOptionLabel();
  const subtypeLabel = useSubtypeLabel();
  const [related, setRelated] = useState<StreamRelatedMode>("none");
  const stream = useApiQuery<ValueStreamResponse>(
    categoryId ? `/reports/value-chain/${encodeURIComponent(categoryId)}?related=${related}` : null,
  );
  const [bandOrder, setBandOrder] = useState<StreamBandKey[]>(() => readStreamBandOrder());
  const [gateColorBy, setGateColorBy] = useState<GateColorBy>("none");
  const [processColorBy, setProcessColorBy] = useState<ProcessColorBy>("processType");
  const [cardId, setCardId] = useState<string | null>(null);
  const [processId, setProcessId] = useState<string | null>(null);
  const [flowId, setFlowId] = useState<string | null>(null);
  const [exportingRoot, setExportingRoot] = useState<string | null>(null);
  const [wordError, setWordError] = useState<string | null>(null);
  const chartRef = useRef<HTMLDivElement>(null);

  const objective = metamodelTypes.find((x) => x.key === "Objective");
  const businessProcess = metamodelTypes.find((x) => x.key === "BusinessProcess");
  const perAttr = <T,>(fn: (attr: (typeof PROCESS_COLOR_ATTRS)[number]) => T) =>
    Object.fromEntries(PROCESS_COLOR_ATTRS.map((attr) => [attr, fn(attr)])) as Record<
      (typeof PROCESS_COLOR_ATTRS)[number],
      T
    >;
  // The four seeded subtypes' translated defaults, overridden by the metamodel's own (renamed,
  // translated or added) BusinessProcess subtypes.
  const subtypeLabels: Record<string, string> = {
    category: t("stream.subtype.category"),
    group: t("stream.subtype.group"),
    process: t("stream.subtype.process"),
    variant: t("stream.subtype.variant"),
    ...Object.fromEntries((businessProcess?.subtypes ?? []).map((s) => [s.key, subtypeLabel(s)])),
  };

  const ctx: StreamContextValue = {
    types,
    bandOrder,
    onMoveBand: (key, direction) =>
      setBandOrder((prev) => {
        const next = moveKey(prev, key, direction);
        writeStreamBandOrder(next);
        return next;
      }),
    gateColorBy,
    setGateColorBy,
    processColorBy,
    setProcessColorBy,
    related,
    setRelated,
    objectiveScale: buildColorScale(fieldOptionsOf(objective, "objectiveType")),
    processScales: perAttr((attr) => buildColorScale(fieldOptionsOf(businessProcess, attr))),
    fieldLabels: {
      objectiveType: fieldLabel(fieldOf(objective, "objectiveType")),
      processAttrs: perAttr((attr) => fieldLabel(fieldOf(businessProcess, attr))),
    },
    subtypeLabels,
    openCard: setCardId,
    openProcess: setProcessId,
    openFlow: setFlowId,
  };

  const roots = stream.data?.roots ?? [];
  const notFound = stream.error instanceof ApiError && stream.error.status === 404;
  const loadFailed = !!stream.error && !notFound;
  const refetching = stream.loading && !!stream.data;

  const buildExportData = () =>
    streamExportData(
      roots,
      t("page.stream.title"),
      {
        streams: t("sheet.streams"),
        processes: t("sheet.processes"),
        gates: t("sheet.gates"),
        capabilities: t("sheet.capabilities"),
        goals: t("sheet.goals"),
        leaf: t("col.leaf"),
        parent: t("col.parent"),
        name: t("col.name"),
        subtype: t("col.subtype"),
        row: t("col.row"),
        steps: t("col.steps"),
        type: t("col.type"),
        group: t("col.group"),
        description: t("col.description"),
        subtypes: subtypeLabels,
        objectiveTypes: Object.fromEntries(
          fieldOptionsOf(objective, "objectiveType").map((o) => [o.key, optionLabel(o)]),
        ),
        notSet: t("legend.notSet"),
      },
      chartRef.current,
    );

  const wordLabels = (rootName: string): WordLabels => ({
    subtitle: t("export.subtitle", {
      date: new Intl.DateTimeFormat(i18n.language, { dateStyle: "long" }).format(new Date()),
    }),
    goalsHeading: t("export.goals"),
    processesHeading: t("export.processes"),
    noGoals: t("export.noGoals"),
    noProcesses: t("export.noProcesses"),
    imageDescription: t("export.imageDescription", { name: rootName }),
    snapshotFailed: t("export.snapshotFailed"),
    failed: t("export.failed"),
  });

  const onExportWord = async (root: ValueStreamRoot, node: HTMLElement) => {
    setExportingRoot(root.id);
    setWordError(null);
    try {
      await exportWord({
        node,
        rootName: root.name,
        goals: root.goals.map((g) => g.name),
        // Sorted, not de-duplicated: two processes sharing a name are two processes.
        processNames: Object.values(root.processes)
          .map((p) => p.name)
          .sort((a, b) => a.localeCompare(b)),
        labels: wordLabels(root.name),
      });
    } catch (e) {
      setWordError((e instanceof Error && e.message) || t("export.failed"));
    } finally {
      setExportingRoot(null);
    }
  };

  let content: ReactNode = null;
  if (!categoryId) content = <Alert severity="info">{t("stream.noCategory")}</Alert>;
  else if (notFound) content = <Alert severity="warning">{t("error.notFound")}</Alert>;
  else if (stream.loading && !stream.data)
    content = (
      <Box sx={{ display: "flex", justifyContent: "center", py: 6 }}>
        <CircularProgress />
      </Box>
    );
  else if (stream.data && roots.length === 0) content = <Alert severity="info">{t("stream.noRoots")}</Alert>;
  else if (stream.data)
    content = (
      <StreamContext.Provider value={ctx}>
        <Box sx={{ overflow: "auto", "@media print": { overflow: "visible" } }}>
          {roots.map((root) => (
            <ValueStreamRootView
              key={root.id}
              root={root}
              onExportWord={onExportWord}
              exporting={exportingRoot === root.id}
              exportDisabled={exportingRoot !== null}
            />
          ))}
        </Box>
      </StreamContext.Provider>
    );

  return (
    <ReportShell
      title={t("page.stream.title")}
      icon="conveyor_belt"
      iconColor={types.businessContext.color}
      hasTableToggle={false}
      chartRef={chartRef}
      maxWidth="100%"
      disableSavedReportsLink
      buildExportData={buildExportData}
      actions={
        <IconButton aria-label={t("actions.back")} onClick={() => navigate("/value-chain")}>
          <MaterialSymbol icon="arrow_back" size={iconSize.md} />
        </IconButton>
      }
      // Outside the chart area, so the PPTX/PNG capture never includes them.
      toolbar={
        (refetching || loadFailed || wordError) && (
          <Box sx={{ width: "100%", display: "flex", flexDirection: "column", gap: 1 }}>
            {refetching && <LinearProgress />}
            {loadFailed && <Alert severity="error">{t("error.load")}</Alert>}
            {wordError && (
              <Alert severity="error" onClose={() => setWordError(null)}>
                {wordError}
              </Alert>
            )}
          </Box>
        )
      }
    >
      {content}
      <CardDetailSidePanel cardId={cardId} open={!!cardId} onClose={() => setCardId(null)} />
      <ProcessDetailSidePanel processId={processId} open={!!processId} onClose={() => setProcessId(null)} />
      <ProcessFlowPreview processId={flowId} open={!!flowId} onClose={() => setFlowId(null)} />
    </ReportShell>
  );
}
