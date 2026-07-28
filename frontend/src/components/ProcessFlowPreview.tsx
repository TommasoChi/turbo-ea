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
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "@/api/client";
import { FlowPreviewDialog } from "@/features/bpm/ProcessNavigator";

export interface ProcessFlowPreviewProps {
  processId: string | null;
  open: boolean;
  onClose: () => void;
}

export default function ProcessFlowPreview({ processId, open, onClose }: ProcessFlowPreviewProps) {
  const navigate = useNavigate();
  const [node, setNode] = useState<{ id: string; name: string } | null>(null);

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
    <FlowPreviewDialog
      node={node}
      onClose={onClose}
      onNavigate={(path) => {
        onClose();
        navigate(path);
      }}
    />
  );
}
