import { api } from "@/api/client";
import type { EnterpriseObject, EnterpriseObjectCardMapping } from "@/types";

/** List the ArchiMate Enterprise Object registry. `includeHidden` also
 *  returns rows with `is_hidden` set (default: standard list view omits them). */
export function listEnterpriseObjects(includeHidden?: boolean): Promise<EnterpriseObject[]> {
  return api.get<EnterpriseObject[]>(
    `/metamodel/enterprise-objects${includeHidden ? "?include_hidden=true" : ""}`,
  );
}

/** Create a custom Enterprise Object. Always lands with `is_standard: false`
 *  and `is_locked: false` server-side regardless of what `body` sends. */
export function createEnterpriseObject(body: Partial<EnterpriseObject>): Promise<EnterpriseObject> {
  return api.post<EnterpriseObject>("/metamodel/enterprise-objects", body);
}

/** Update name/description/icon/color/layer/is_hidden/sort_order. 422s if the
 *  object is locked (standard registry rows). */
export function updateEnterpriseObject(
  key: string,
  body: Partial<EnterpriseObject>,
): Promise<EnterpriseObject> {
  return api.patch<EnterpriseObject>(`/metamodel/enterprise-objects/${key}`, body);
}

/** Add a card-type (optionally subtype-scoped) mapping row. */
export function addCardMapping(
  key: string,
  cardTypeKey: string,
  cardSubtypeKey?: string | null,
): Promise<EnterpriseObjectCardMapping> {
  return api.post<EnterpriseObjectCardMapping>(`/metamodel/enterprise-objects/${key}/card-mappings`, {
    card_type_key: cardTypeKey,
    card_subtype_key: cardSubtypeKey ?? null,
  });
}

/** Remove a card-mapping row. 204 No Content. */
export function removeCardMapping(key: string, mappingId: string): Promise<void> {
  return api.delete<void>(`/metamodel/enterprise-objects/${key}/card-mappings/${mappingId}`);
}
