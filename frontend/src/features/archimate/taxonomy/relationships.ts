import { RELATION_TABLE } from "./relationTable.generated";

export const RELATIONSHIP_TYPES = [
  "Composition", "Aggregation", "Assignment", "Realization", "Serving", "Access",
  "Influence", "Triggering", "Flow", "Specialization", "Association",
] as const;
export type RelationshipType = (typeof RELATIONSHIP_TYPES)[number];
export const ACCESS_TYPES = ["Access", "Read", "Write", "ReadWrite"] as const;
export type AccessType = (typeof ACCESS_TYPES)[number];

const LETTER: Record<string, RelationshipType> = {
  a: "Access", c: "Composition", f: "Flow", g: "Aggregation", i: "Assignment", n: "Influence",
  o: "Association", r: "Realization", s: "Specialization", t: "Triggering", v: "Serving",
};

const TYPE_SET = new Set<string>(RELATIONSHIP_TYPES);
export function isRelationshipType(v: unknown): v is RelationshipType {
  return typeof v === "string" && TYPE_SET.has(v);
}

export function allowedRelationships(source: string, target: string): RelationshipType[] {
  const letters = RELATION_TABLE[source]?.[target] ?? "";
  const set = new Set<RelationshipType>([...letters].map((c) => LETTER[c]).filter(Boolean));
  return RELATIONSHIP_TYPES.filter((r) => set.has(r));
}

export function isRelationshipAllowed(source: string, target: string, rel: RelationshipType): boolean {
  return allowedRelationships(source, target).includes(rel);
}

export const RELATIONSHIP_TARGETS_RELATIONSHIP: readonly RelationshipType[] = [
  "Association", "Aggregation", "Composition",
];
export function relationshipOnRelationshipAllowed(rel: RelationshipType): boolean {
  return RELATIONSHIP_TARGETS_RELATIONSHIP.includes(rel);
}
