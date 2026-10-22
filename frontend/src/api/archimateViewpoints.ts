import { api } from "@/api/client";
import type { ArchimateViewpoint, ArchimateViewpointExample } from "@/types";

/** List the ArchiMate Viewpoint catalog. `includeHidden` also returns rows
 *  with `is_hidden` set (default: standard list view omits them). */
export function listViewpoints(includeHidden?: boolean): Promise<ArchimateViewpoint[]> {
  return api.get<ArchimateViewpoint[]>(
    `/metamodel/viewpoints${includeHidden ? "?include_hidden=true" : ""}`,
  );
}

/** One Viewpoint, with its `objects` (allowed Enterprise Object keys) --
 *  the designer palette's filter (Task 9) fetches this once per diagram load. */
export function getViewpoint(key: string): Promise<ArchimateViewpoint> {
  return api.get<ArchimateViewpoint>(`/metamodel/viewpoints/${key}`);
}

/** Create a custom Viewpoint. Always lands with `is_standard: false`
 *  server-side regardless of what `body` sends. */
export function createViewpoint(body: Partial<ArchimateViewpoint>): Promise<ArchimateViewpoint> {
  return api.post<ArchimateViewpoint>("/metamodel/viewpoints", body);
}

/** Update name/icon/description/layer/is_hidden/sort_order. */
export function updateViewpoint(
  key: string,
  body: Partial<ArchimateViewpoint>,
): Promise<ArchimateViewpoint> {
  return api.patch<ArchimateViewpoint>(`/metamodel/viewpoints/${key}`, body);
}

/** Delete a custom Viewpoint, or hide a standard one (server decides which). */
export function deleteViewpoint(key: string): Promise<{ status: string; key: string }> {
  return api.delete<{ status: string; key: string }>(`/metamodel/viewpoints/${key}`);
}

/** Add one allowed Enterprise Object to a Viewpoint. 409 if already allowed. */
export function addViewpointObject(
  key: string,
  enterpriseObjectKey: string,
): Promise<{ id: string; viewpoint_key: string; enterprise_object_key: string }> {
  return api.post(`/metamodel/viewpoints/${key}/objects`, {
    enterprise_object_key: enterpriseObjectKey,
  });
}

/** Remove an allowed Enterprise Object from a Viewpoint. 204 No Content. */
export function removeViewpointObject(key: string, enterpriseObjectKey: string): Promise<void> {
  return api.delete<void>(`/metamodel/viewpoints/${key}/objects/${enterpriseObjectKey}`);
}

/** Upload an example diagram: `xml` is an Archi `.archimate` file or Exchange
 *  XML. 422 with `detail: {message, issues}` when it is not a valid model --
 *  nothing is saved then. */
export function uploadViewpointExample(
  key: string,
  name: string,
  xml: string,
): Promise<ArchimateViewpointExample> {
  return api.post<ArchimateViewpointExample>(`/metamodel/viewpoints/${key}/examples`, { name, xml });
}

/** Delete one example diagram from a Viewpoint. 204 No Content. */
export function deleteViewpointExample(key: string, exampleId: string): Promise<void> {
  return api.delete<void>(`/metamodel/viewpoints/${key}/examples/${exampleId}`);
}
