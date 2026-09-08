/**
 * Standalone fullscreen BPMN flow preview — reuses the REAL BPM Process
 * House FlowPreviewDialog (features/bpm/ProcessNavigator.tsx) so a
 * process's flow diagram opened from outside the Navigator (e.g. an
 * extension) renders PIXEL-IDENTICAL to clicking the "schema" view-flow
 * icon on /bpm.
 *
 * Unlike ProcessDetailSidePanel (which needs a full ProcNode with deep-
 * aggregated apps/data counts, built via buildTree/findNode over the whole
 * process-map), FlowPreviewDialog only ever reads `node.id`/`node.name` —
 * so this fetches just the card itself (GET /cards/{id}) instead of the
 * heavier process-map fetch.
 *
 * Exposed on the extension SDK (see lib/extensionHost.tsx,
 * `ExtensionProcessFlowPreview` / `sdk.ProcessFlowPreview`).
 */
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { api } from "@/api/client";
import { useMetamodel } from "@/hooks/useMetamodel";
import { useAuth } from "@/hooks/useAuth";
import { FlowPreviewDialog } from "@/features/bpm/ProcessNavigator";
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

export interface ProcessFlowPreviewProps {
  processId: string | null;
  open: boolean;
  onClose: () => void;
}

export default function ProcessFlowPreview({ processId, open, onClose }: ProcessFlowPreviewProps) {
  const navigate = useNavigate();
  const { getType } = useMetamodel();
  const processTypes = useProcessTypeOptions();
  const { user } = useAuth();
  const [node, setNode] = useState<{ id: string; name: string } | null>(null);

  // FlowPreviewDialog (reused as-is from ProcessNavigator.tsx) reads its
  // data source and capability flags from ProcessNavigatorContext — same
  // gap as ProcessDetailSidePanel.tsx had ("must render inside a
  // ProcessNavigatorProvider"), same fix: supply the same authenticated
  // source/capabilities/meta shape the in-app ProcessNavigator container
  // builds.
  const bpType = getType("BusinessProcess");
  const source = useMemo<ProcessNavigatorSource>(
    () => ({
      loadMap: async () => {
        const [r, rowOrderRes] = await Promise.all([
          api.get<{ items: { id: string; name: string; parent_id: string | null }[]; organizations: { id: string; name: string }[] }>(
            "/reports/bpm/process-map",
          ),
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
      loadFlow: async (id): Promise<ProcessFlowPayload> => {
        const [pub, els, drafts] = await Promise.all([
          api.get<ProcessFlowVersion | null>(`/bpm/processes/${id}/flow/published`).catch(() => null),
          api.get<ProcessElement[]>(`/bpm/processes/${id}/elements`).catch(() => [] as ProcessElement[]),
          api.get<{ id: string }[]>(`/bpm/processes/${id}/flow/drafts`).catch(() => [] as { id: string }[]),
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

  useEffect(() => {
    if (!open || !processId) {
      setNode(null);
      return;
    }
    let cancelled = false;
    api.get<{ id: string; name: string }>(`/cards/${processId}`).then((card) => {
      if (!cancelled) setNode({ id: card.id, name: card.name });
    });
    return () => {
      cancelled = true;
    };
  }, [open, processId]);

  if (!open || !node) return null;

  return (
    <ProcessNavigatorProvider value={{ source, capabilities, meta }}>
      <FlowPreviewDialog
        node={node}
        onClose={onClose}
        onNavigate={(path) => {
          onClose();
          navigate(path);
        }}
      />
    </ProcessNavigatorProvider>
  );
}
