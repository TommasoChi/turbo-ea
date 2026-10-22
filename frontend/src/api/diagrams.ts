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

/** One card type suggested for a viewpoint/tab, paired with the ArchiMate
 *  element type it resolves to -- `enterprise_object_key` is `null` only
 *  for an inconsistent admin override (a card type with no mapping to any
 *  object this viewpoint actually allows). */
export interface SuggestedCardType {
  card_type_key: string;
  enterprise_object_key: string | null;
}

/** Card types to suggest creating once the new diagram is open, for the
 *  given viewpoint on the given tab (the explicit per-tab override, or the
 *  viewpoint's whole card-mapping fallback). `tab: null` is the unscoped
 *  create-diagram entry point -- the override never applies there, but the
 *  fallback doesn't need a tab either. */
export function getSuggestedCards(
  viewpointKey: string,
  tab: ViewpointTab | null,
): Promise<SuggestedCardType[]> {
  const query = tab ? `?tab=${tab}` : "";
  return api.get<SuggestedCardType[]>(
    `/diagrams/viewpoints-for-tab/${viewpointKey}/suggested-cards${query}`,
  );
}

/** Full Exchange XML for one example, fetched lazily only when its card is clicked. */
export function getViewpointExampleXml(
  viewpointKey: string,
  exampleId: string,
): Promise<{ id: string; name: string; xml: string }> {
  return api.get(`/diagrams/viewpoints-for-tab/${viewpointKey}/examples/${exampleId}`);
}
