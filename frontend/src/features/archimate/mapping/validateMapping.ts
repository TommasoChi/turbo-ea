import type { CardType, RelationType } from "@/types";
import type { ElementType } from "../taxonomy/elements";
import {
  isRelationshipAllowed,
  type RelationshipType,
} from "../taxonomy/relationships";
import {
  elementTypesForCardType,
  orientedEnds,
  resolveRelation,
} from "./resolveMapping";

export type MappingIssueKind = "unmapped_end" | "not_allowed";

export interface MappingIssue {
  relationKey: string;
  kind: MappingIssueKind;
  relationship: RelationshipType;
  /** Element type on the source_type_key side (not the oriented source); null if unmapped. */
  source: ElementType | null;
  /** Element type on the target_type_key side (not the oriented target); null if unmapped. */
  target: ElementType | null;
  sourceCardType: string;
  targetCardType: string;
}

/** One issue per mapped relation type: an unmapped end, else the first pair the ArchiMate matrix forbids. */
export function validateMapping(
  cardTypes: CardType[],
  relationTypes: RelationType[],
): MappingIssue[] {
  const issues: MappingIssue[] = [];
  for (const rt of relationTypes) {
    const resolved = resolveRelation(rt);
    if (!resolved) continue;
    const find = (key: string) => cardTypes.find((t) => t.key === key);
    const sources = find(rt.source_type_key)
      ? elementTypesForCardType(find(rt.source_type_key)!)
      : [];
    const targets = find(rt.target_type_key)
      ? elementTypesForCardType(find(rt.target_type_key)!)
      : [];
    const base = {
      relationKey: rt.key,
      relationship: resolved.relationship,
      sourceCardType: rt.source_type_key,
      targetCardType: rt.target_type_key,
    };
    if (!sources.length || !targets.length) {
      issues.push({
        ...base,
        kind: "unmapped_end",
        source: sources[0] ?? null,
        target: targets[0] ?? null,
      });
      continue;
    }
    const bad = sources
      .flatMap((s) => targets.map((t) => [s, t] as const))
      .find(([s, t]) => {
        const [from, to] = orientedEnds(resolved, s, t);
        return !isRelationshipAllowed(from, to, resolved.relationship);
      });
    if (bad)
      issues.push({
        ...base,
        kind: "not_allowed",
        source: bad[0],
        target: bad[1],
      });
  }
  return issues;
}
