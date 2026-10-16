import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ELEMENT_INFO, ELEMENT_TYPES } from "./elements";
import {
  ACCESS_TYPES, RELATIONSHIP_TYPES, allowedRelationships, isRelationshipAllowed,
  isRelationshipType, relationshipOnRelationshipAllowed,
} from "./relationships";
import { RELATION_TABLE } from "./relationTable.generated";

// Mirrors backend/tests/services/test_archimate_taxonomy.py.
// The spec defines Contract as a specialization of BusinessObject and Constraint
// as a specialization of Requirement, so Specialization also holds across them.
// The 58 core elements; Grouping, Location and the junctions relate to anything
// and are excluded here exactly as in the backend test (taxonomy.ELEMENT_TYPES).
const CORE = ELEMENT_TYPES.filter((t) => ELEMENT_INFO[t].layer !== "other");

const SPECIALIZATION_CROSS_TYPE = [
  "BusinessObject>Contract", "Contract>BusinessObject",
  "Requirement>Constraint", "Constraint>Requirement",
];

describe("ArchiMate relationship taxonomy", () => {
  it("has the 11 XSD relationship names in the specification's order", () => {
    expect(RELATIONSHIP_TYPES).toEqual([
      "Composition","Aggregation","Assignment","Realization","Serving","Access",
      "Influence","Triggering","Flow","Specialization","Association",
    ]);
    expect(ACCESS_TYPES).toEqual(["Access","Read","Write","ReadWrite"]);
  });

  it("Association is allowed between every pair of elements", () => {
    for (const s of ELEMENT_TYPES) for (const t of ELEMENT_TYPES)
      expect(isRelationshipAllowed(s, t, "Association"), `${s}->${t}`).toBe(true);
  });

  it("Specialization holds on every element itself; the only cross-type pairs are the two spec ones", () => {
    const cross: string[] = [];
    for (const s of CORE) {
      expect(isRelationshipAllowed(s, s, "Specialization"), s).toBe(true);
      for (const t of CORE)
        if (s !== t && isRelationshipAllowed(s, t, "Specialization")) cross.push(`${s}>${t}`);
    }
    expect(cross.sort()).toEqual([...SPECIALIZATION_CROSS_TYPE].sort());
  });

  it("Access only targets passive structure elements", () => {
    // Deliverable is the passive element of Implementation & Migration.
    const passive = new Set([
      "BusinessObject","Contract","Representation","DataObject","Artifact","Material","Deliverable",
    ]);
    for (const s of CORE) for (const t of CORE)
      if (isRelationshipAllowed(s, t, "Access")) expect(passive.has(t), `${s}->${t}`).toBe(true);
  });

  it("answers well-known cases", () => {
    expect(isRelationshipAllowed("BusinessActor", "BusinessProcess", "Assignment")).toBe(true);
    expect(isRelationshipAllowed("ApplicationComponent", "BusinessProcess", "Serving")).toBe(true);
    expect(isRelationshipAllowed("BusinessProcess", "BusinessObject", "Access")).toBe(true);
    expect(isRelationshipAllowed("DataObject", "BusinessActor", "Assignment")).toBe(false);
  });

  it("allowedRelationships is ordered like RELATIONSHIP_TYPES and has Association last-but-never-empty", () => {
    const list = allowedRelationships("BusinessActor", "BusinessProcess");
    const idx = list.map((r) => RELATIONSHIP_TYPES.indexOf(r));
    expect(idx).toEqual([...idx].sort((a, b) => a - b));
    expect(list).toContain("Association");
  });

  it("an unknown pair allows nothing", () => {
    expect(allowedRelationships("Banana", "BusinessActor")).toEqual([]);
    expect(isRelationshipAllowed("BusinessActor", "Banana", "Association")).toBe(false);
  });

  it("relationship-to-relationship is limited to Association, Aggregation and Composition", () => {
    expect(RELATIONSHIP_TYPES.filter(relationshipOnRelationshipAllowed).sort()).toEqual(
      ["Aggregation", "Association", "Composition"],
    );
  });

  it("isRelationshipType is a strict guard", () => {
    expect(isRelationshipType("Serving")).toBe(true);
    expect(isRelationshipType("serving")).toBe(false);
    expect(isRelationshipType(null)).toBe(false);
  });
});

// Drift guard between the two generated files (backend JSON vs frontend TS).
const BACKEND_JSON = resolve(
  __dirname, "../../../../../backend/app/services/archimate/relation_table.json",
);
describe("relation table drift guard", () => {
  it.skipIf(!existsSync(BACKEND_JSON))("backend relation_table.json equals RELATION_TABLE", () => {
    const backend = JSON.parse(readFileSync(BACKEND_JSON, "utf-8")).table;
    expect(backend).toEqual(RELATION_TABLE);
  });
});
