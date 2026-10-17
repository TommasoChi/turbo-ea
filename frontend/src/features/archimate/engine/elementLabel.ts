/** Display names: the English standard names ("BusinessActor" -> "Business Actor"). */
import type { ElementType } from "../taxonomy/elements";
import type { AccessType, RelationshipType } from "../taxonomy/relationships";

const split = (name: string) => name.split(/(?<=[a-z])(?=[A-Z])/).join(" ");

export const elementLabel = (type: ElementType): string => split(type);
export const relationshipLabel = (type: RelationshipType): string => split(type);
export const accessLabel = (type: AccessType): string => (type === "ReadWrite" ? "Read/Write" : type);
