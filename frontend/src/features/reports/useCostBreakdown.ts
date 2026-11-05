import { useState } from "react";
import { api } from "@/api/client";
import { useAbortableEffect } from "@/hooks/useLatestRequest";

export interface CardBreakdown {
  /** The card's whole TCO (includes the `__other__` residual, which has no column of its own). */
  total: number;
  items: Record<string, number>;
}

interface SankeyBreakdownResponse {
  nodes: { id: string; type: string; cost?: number; costs?: Record<string, number> }[];
}

/**
 * Per-card cost-item breakdown, from the Sankey endpoint (the only one that carries it).
 * `breakdown` is null while loading and while disabled.
 */
export function useCostBreakdown(args: {
  enabled: boolean;
  typeParam: string;
  groupBy: string;
  fiscalYear: number | null;
}): { breakdown: Map<string, CardBreakdown> | null } {
  const { enabled, typeParam, groupBy, fiscalYear } = args;
  const [breakdown, setBreakdown] = useState<Map<string, CardBreakdown> | null>(null);

  useAbortableEffect(
    async ({ signal, isCurrent }) => {
      setBreakdown(null);
      if (!enabled) return;
      const p = new URLSearchParams({ type: typeParam, cost_field: "costTotalAnnual" });
      if (groupBy) p.set("group_by", groupBy);
      if (fiscalYear != null) p.set("fiscal_year", String(fiscalYear));
      const r = await api.get<SankeyBreakdownResponse>(`/reports/cost-sankey?${p}`, { signal });
      if (!isCurrent()) return;
      const map = new Map<string, CardBreakdown>();
      for (const n of r.nodes) {
        if (n.type === "CostItem" || n.type === "Group") continue;
        map.set(n.id, { total: n.cost ?? 0, items: n.costs ?? {} });
      }
      setBreakdown(map);
    },
    [enabled, typeParam, groupBy, fiscalYear],
  );

  return { breakdown };
}
