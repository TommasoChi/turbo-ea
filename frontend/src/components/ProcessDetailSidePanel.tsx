/**
 * Standalone process-detail drawer — reuses the REAL BPM Process House
 * drawer components (Overview/Steps/Flow/Apps/Data — DrawerOverview,
 * DrawerSteps, DrawerFlow, DrawerApps, DrawerData, all exported from
 * features/bpm/ProcessNavigator.tsx) so a process opened from outside the
 * Navigator (e.g. an extension) renders PIXEL-IDENTICAL to clicking that
 * same process on /bpm — attribute chips (subtype, processType/maturity/
 * automationLevel/riskLevel), completion + approval status, sub-processes
 * list, tags, and the deep (recursive-across-descendants) Apps/Data
 * counts, not just this card's own.
 *
 * The catch: those Drawer* components take a `ProcNode` — a card
 * decorated with `children`, `level`, and deep-aggregated
 * `deepAppCount`/`deepUniqueApps`/`deepDataObjects` — built by
 * `buildTree()` over the WHOLE BusinessProcess forest fetched from
 * `GET /reports/bpm/process-map` (the same endpoint ProcessNavigator
 * itself loads once; deep aggregation is a recursive union across
 * descendants, meaningless for a single card in isolation). So this panel
 * fetches that same report once per externally-opened processId,
 * `buildTree`s it, and `findNode`s the target — from then on Overview's
 * "Sub-Processes" list / "Drill down" chip just call `setCurrentId`
 * locally (no navigation to a Process House view exists in a side panel,
 * so both are aliased to "show that node's own Overview here").
 *
 * Exposed on the extension SDK (see lib/extensionHost.tsx,
 * `ExtensionProcessDetailSidePanel` / `sdk.ProcessDetailSidePanel`).
 */
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router";
import Box from "@mui/material/Box";
import Drawer from "@mui/material/Drawer";
import Typography from "@mui/material/Typography";
import IconButton from "@mui/material/IconButton";
import Tooltip from "@mui/material/Tooltip";
import Tabs from "@mui/material/Tabs";
import Tab from "@mui/material/Tab";
import CircularProgress from "@mui/material/CircularProgress";
import { useTranslation } from "react-i18next";
import MaterialSymbol from "@/components/MaterialSymbol";
import { api } from "@/api/client";
import { useMetamodel } from "@/hooks/useMetamodel";
import { useAuth } from "@/hooks/useAuth";
import {
  buildTree,
  findNode,
  DrawerOverview,
  DrawerSteps,
  DrawerFlow,
  DrawerApps,
  DrawerData,
  type ProcItem,
  type ProcNode,
} from "@/features/bpm/ProcessNavigator";
import { useProcessTypeOptions } from "@/features/bpm/useProcessTypeOptions";
import {
  FULL_CAPABILITIES,
  ProcessNavigatorProvider,
} from "@/features/bpm/ProcessNavigatorContext";
import type {
  NavigatorCapabilities,
  NavigatorMeta,
  ProcessFlowPayload,
  ProcessNavigatorSource,
} from "@/features/bpm/ProcessNavigatorContext";
import type { ProcessElement, ProcessFlowVersion } from "@/types";

export interface ProcessDetailSidePanelProps {
  processId: string | null;
  open: boolean;
  onClose: () => void;
}

// Fixed "Type" overlay — same default ProcessNavigator opens with. This
// panel has no overlay switcher (no house grid to recolor), so it's not a
// prop; DrawerOverview's attribute-chip row still reads whichever of the
// four (processType/maturity/automationLevel/riskLevel) the card actually
// has set, this only picks which one gets the "type" badge treatment.
const OVERLAY = "processType" as const;

export default function ProcessDetailSidePanel({ processId, open, onClose }: ProcessDetailSidePanelProps) {
  const { t } = useTranslation(["bpm", "common"]);
  const navigate = useNavigate();
  const { getType } = useMetamodel();
  const processTypes = useProcessTypeOptions();
  const { user } = useAuth();
  const [tab, setTab] = useState(0);
  const [roots, setRoots] = useState<ProcNode[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [currentId, setCurrentId] = useState<string | null>(null);

  // DrawerOverview/DrawerSteps/DrawerFlow/DrawerApps/DrawerData (reused as-is
  // from ProcessNavigator.tsx) read their data source, capability flags and
  // metamodel facts from ProcessNavigatorContext, not from props — this
  // panel is the ONE caller of those components outside ProcessNavigator
  // itself, so it must supply that context exactly like the authenticated
  // `ProcessNavigator` container does (same shape as
  // `features/web-portals/PortalProcessNavigator.tsx`'s portal twin), or
  // every tab throws "must render inside a ProcessNavigatorProvider".
  const bpType = getType("BusinessProcess");
  const source = useMemo<ProcessNavigatorSource>(
    () => ({
      loadMap: async () => {
        const [r, rowOrderRes] = await Promise.all([
          api.get<{ items: ProcItem[]; organizations: { id: string; name: string }[] }>("/reports/bpm/process-map"),
          api
            .get<{ row_order: string[] }>("/settings/bpm-row-order")
            .catch(() => ({ row_order: ["management", "core", "support"] })),
        ]);
        return {
          items: r.items,
          organizations: r.organizations ?? [],
          rowOrder: rowOrderRes.row_order ?? [],
        };
      },
      loadFlow: async (processId): Promise<ProcessFlowPayload> => {
        const [pub, els, drafts] = await Promise.all([
          api
            .get<ProcessFlowVersion | null>(`/bpm/processes/${processId}/flow/published`)
            .catch(() => null),
          api
            .get<ProcessElement[]>(`/bpm/processes/${processId}/elements`)
            .catch(() => [] as ProcessElement[]),
          api
            .get<{ id: string }[]>(`/bpm/processes/${processId}/flow/drafts`)
            .catch(() => [] as { id: string }[]),
        ]);
        return {
          bpmnXml: pub?.bpmn_xml ?? null,
          svgThumbnail: pub?.svg_thumbnail ?? null,
          steps: (els ?? []) as ProcessFlowPayload["steps"],
          hasDrafts: (drafts?.length ?? 0) > 0,
        };
      },
      loadCard: (id) => api.get<Record<string, unknown>>(`/cards/${id}`),
      reorderCards: async (updates) => {
        await Promise.all(
          updates.map((u) => api.patch(`/cards/${u.id}`, { attributes: { sortOrder: u.sortOrder } })),
        );
      },
      saveRowOrder: async (order) => {
        await api.patch("/settings/bpm-row-order", { row_order: order });
      },
    }),
    [],
  );
  const capabilities = useMemo<NavigatorCapabilities>(
    () => ({ ...FULL_CAPABILITIES, canReorder: user?.role === "admin" }),
    [user?.role],
  );
  const meta = useMemo<NavigatorMeta>(
    () => ({
      typeIcon: bpType?.icon ?? "route",
      typeColor: bpType?.color ?? "#028f00",
      subtypes: bpType?.subtypes ?? [],
      processTypes,
    }),
    [bpType, processTypes],
  );

  // A NEW externally-opened process: (re)load the whole tree and jump to
  // it. Internal navigation (Sub-Processes list, Drill down) only changes
  // `currentId` via setCurrentNode below — no refetch, same `roots`.
  useEffect(() => {
    if (!processId) return;
    setCurrentId(processId);
    setTab(0);
    setRoots(null);
    setLoadError(false);
    api
      .get<{ items: ProcItem[] }>("/reports/bpm/process-map")
      .then((r) => setRoots(buildTree(r.items)))
      .catch(() => setLoadError(true));
  }, [processId]);

  const node = roots && currentId ? findNode(roots, currentId) : null;

  // Reset to the Overview tab whenever the displayed node changes — same
  // as ProcessDrawer's own `useEffect(() => setTab(0), [node.id])`.
  useEffect(() => {
    if (currentId) setTab(0);
  }, [currentId]);

  // Same disambiguation as ProcessNavigator's handleNavigate: a bare id
  // opens that card, a path starting with "/" (e.g. "/cards/x?tab=1" from
  // DrawerFlow's openFlowTab) navigates there directly.
  const onNavigate = (idOrPath: string) => {
    navigate(idOrPath.startsWith("/") ? idOrPath : `/cards/${idOrPath}`);
  };
  // No Process House grid exists in a side panel to drill INTO, so both
  // "switch to this sub-process" and "drill down" just re-point the panel
  // at that node's own Overview.
  const setCurrentNode = (n: ProcNode) => setCurrentId(n.id);
  const onDrill = (id: string) => setCurrentId(id);

  if (!processId) return null;

  const typeColor = bpType?.color || "#028f00";
  const typeIcon = bpType?.icon || "route";

  return (
    <ProcessNavigatorProvider value={{ source, capabilities, meta }}>
    <Drawer anchor="right" open={open} onClose={onClose} PaperProps={{ sx: { width: { xs: "100%", sm: 520 } } }}>
      <Box sx={{ height: "100%", display: "flex", flexDirection: "column" }}>
        <Box sx={{ px: 2.5, pt: 2, pb: 1, bgcolor: typeColor, color: "#fff" }}>
          <Box sx={{ display: "flex", alignItems: "center", gap: 1.5 }}>
            <Box
              sx={{
                width: 36,
                height: 36,
                borderRadius: 1.5,
                bgcolor: "rgba(255,255,255,0.2)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
              }}
            >
              <MaterialSymbol icon={typeIcon} size={22} color="#fff" />
            </Box>
            <Typography variant="h6" sx={{ fontWeight: 700, flex: 1, fontSize: "1.1rem" }} noWrap>
              {node?.name || ""}
            </Typography>
            <Tooltip title={t("navigator.openCard")}>
              <IconButton
                onClick={() => currentId && onNavigate(currentId)}
                size="small"
                sx={{ color: "#fff" }}
                aria-label={t("navigator.openCard")}
              >
                <MaterialSymbol icon="open_in_new" size={20} />
              </IconButton>
            </Tooltip>
            <IconButton onClick={onClose} size="small" sx={{ color: "#fff" }} aria-label={t("common:actions.close")}>
              <MaterialSymbol icon="close" size={20} />
            </IconButton>
          </Box>
        </Box>

        <Tabs
          value={tab}
          onChange={(_, v) => setTab(v)}
          variant="scrollable"
          scrollButtons="auto"
          sx={{
            borderBottom: 1,
            borderColor: "divider",
            minHeight: 36,
            "& .MuiTab-root": { minHeight: 36, py: 0, fontSize: "0.8rem" },
          }}
        >
          <Tab label={t("navigator.overview")} icon={<MaterialSymbol icon="info" size={16} />} iconPosition="start" />
          <Tab
            label={`${t("navigator.steps")}${node?.element_count ? ` (${node.element_count})` : ""}`}
            icon={<MaterialSymbol icon="checklist" size={16} />}
            iconPosition="start"
          />
          <Tab label={t("navigator.flow")} icon={<MaterialSymbol icon="schema" size={16} />} iconPosition="start" />
          <Tab
            label={`${t("navigator.apps")} (${node?.deepAppCount ?? 0})`}
            icon={<MaterialSymbol icon="apps" size={16} />}
            iconPosition="start"
          />
          <Tab
            label={`${t("navigator.data")} (${node?.deepDataObjects.size ?? 0})`}
            icon={<MaterialSymbol icon="database" size={16} />}
            iconPosition="start"
          />
        </Tabs>

        <Box sx={{ flex: 1, overflowY: "auto", p: 2 }}>
          {loadError && (
            <Typography color="text.secondary" sx={{ py: 4, textAlign: "center" }}>
              {t("common:errors.generic")}
            </Typography>
          )}
          {!loadError && !node && (
            <Box sx={{ display: "flex", justifyContent: "center", py: 6 }}>
              <CircularProgress size={28} />
            </Box>
          )}
          {node && tab === 0 && (
            <DrawerOverview
              node={node}
              overlay={OVERLAY}
              onNavigate={onNavigate}
              onSwitchNode={setCurrentNode}
              onDrill={onDrill}
            />
          )}
          {currentId && tab === 1 && <DrawerSteps processId={currentId} onNavigate={onNavigate} />}
          {currentId && tab === 2 && <DrawerFlow processId={currentId} onNavigate={onNavigate} />}
          {node && tab === 3 && <DrawerApps node={node} onNavigate={onNavigate} />}
          {node && tab === 4 && <DrawerData node={node} onNavigate={onNavigate} />}
        </Box>
      </Box>
    </Drawer>
    </ProcessNavigatorProvider>
  );
}
