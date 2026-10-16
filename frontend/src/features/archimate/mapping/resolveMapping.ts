import type { CardType, RelationType } from "@/types";
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

/** Element type of a card: the subtype's own mapping wins, then the type's.
 *  Unknown or empty mappings yield null (a stale mapping must not crash the editor). */
export function elementTypeForCard(
  types: CardType[],
  cardTypeKey: string,
  subtype?: string | null,
): ElementType | null {
  const type = types.find((t) => t.key === cardTypeKey);
  if (!type) return null;
  const sub = subtype
    ? type.subtypes?.find((s) => s.key === subtype)?.archimate_type
    : null;
  if (isElementType(sub)) return sub;
  return isElementType(type.archimate_type) ? type.archimate_type : null;
}

/** Every element type a card type can produce: type-level first, then distinct subtype overrides. */
export function elementTypesForCardType(type: CardType): ElementType[] {
  const all = [
    type.archimate_type,
    ...(type.subtypes ?? []).map((s) => s.archimate_type),
  ];
  return [...new Set(all.filter(isElementType))];
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
