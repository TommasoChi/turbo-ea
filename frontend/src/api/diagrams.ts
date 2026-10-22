import { api } from "@/api/client";
import { listViewpoints } from "@/api/archimateViewpoints";
import type { ArchimateViewpointForPicker } from "@/types";

export type ViewpointTab = "business" | "application" | "technology";

export interface DiagramCreateBody {
  name: string;
  description?: string;
  data?: { format: string; xml: string };
  card_ids?: string[];
  kind?: "drawio" | "archimate";
  viewpoint_key?: string;
}

export interface DiagramCreated {
  id: string;
  name: string;
  kind: string;
  card_ids: string[];
}

export function createDiagram(body: DiagramCreateBody): Promise<DiagramCreated> {
  return api.post<DiagramCreated>("/diagrams", body);
}

/** Viewpoints for the scoped diagram-creation dashboard. `tab: null` is the
 *  unscoped `Diagrams` entry point -- no layer filter, same list the
 *  Viewpoint Catalog admin UI already uses (`listViewpoints`, Task 3). */
export function listViewpointsForTab(
  tab: ViewpointTab | null,
): Promise<ArchimateViewpointForPicker[]> {
  if (tab === null) return listViewpoints();
  return api.get<ArchimateViewpointForPicker[]>(`/diagrams/viewpoints-for-tab?tab=${tab}`);
}

/** Card types to suggest creating once the new diagram is open, for the
 *  given viewpoint on the given tab (the explicit per-tab override, or the
 *  viewpoint's whole card-mapping fallback). */
export function getSuggestedCards(viewpointKey: string, tab: ViewpointTab): Promise<string[]> {
  return api.get<string[]>(
    `/diagrams/viewpoints-for-tab/${viewpointKey}/suggested-cards?tab=${tab}`,
  );
}

/** Full Exchange XML for one example, fetched lazily only when its card is clicked. */
export function getViewpointExampleXml(
  viewpointKey: string,
  exampleId: string,
): Promise<{ id: string; name: string; xml: string }> {
  return api.get(`/diagrams/viewpoints-for-tab/${viewpointKey}/examples/${exampleId}`);
}
