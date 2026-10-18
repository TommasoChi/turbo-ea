import type { EnterpriseObjectCardMapping, RelationType } from "@/types";
import { isElementType, type ElementType } from "../taxonomy/elements";
import {
  ACCESS_TYPES,
  isRelationshipType,
  type AccessType,
  type RelationshipType,
} from "../taxonomy/relationships";

export interface CrudFlags {
  create?: boolean;
  read?: boolean;
  update?: boolean;
  delete?: boolean;
}

export interface ResolvedRelation {
  relationship: RelationshipType;
  access: AccessType | null;
  reversed: boolean;
}

/** Every element type a card type can produce: every bridge-table row for that
 *  card type (subtype-scoped or not), deduped. */
export function elementTypesForCardType(
  cardTypeKey: string,
  mappings: EnterpriseObjectCardMapping[],
): ElementType[] {
  const keys = mappings
    .filter((m) => m.card_type_key === cardTypeKey)
    .map((m) => m.enterprise_object_key);
  return [...new Set(keys.filter(isElementType))];
}

export function accessFromCrud(flags: CrudFlags = {}): AccessType {
  const write = !!(flags.create || flags.update || flags.delete);
  const read = !!flags.read;
  if (read && write) return "ReadWrite";
  if (write) return "Write";
  return read ? "Read" : "Access";
}

export function resolveRelation(
  rt: RelationType,
  flags?: CrudFlags,
): ResolvedRelation | null {
  const relationship = rt.archimate_type;
  if (!isRelationshipType(relationship)) return null;
  if (relationship !== "Access") {
    return {
      relationship,
      access: null,
      reversed: rt.archimate_reversed === true,
    };
  }
  const fixed = rt.archimate_access;
  const access =
    fixed === "crud"
      ? accessFromCrud(flags)
      : (ACCESS_TYPES.find((a) => a === fixed) ?? "Access");
  // Access always runs active element -> passive object, whatever the flag says.
  return { relationship, access, reversed: false };
}

export function orientedEnds<T>(
  resolved: ResolvedRelation,
  source: T,
  target: T,
): [T, T] {
  return resolved.reversed ? [target, source] : [source, target];
}
