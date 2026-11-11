export const BO_ER_RELATION_TYPE = "relDataObjectToDataObject";

export function isBoOwnershipAttribute(relationTypeKey: string, fieldKey: string): boolean {
  return relationTypeKey === "relAppToDataObj" && fieldKey === "dataOwnership";
}
