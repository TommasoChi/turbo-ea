import { describe, it, expect } from "vitest";
import type { CardType, RelationType } from "@/types";
import { validateMapping } from "./validateMapping";

const card = (
  key: string,
  archimate_type: string | null,
  subtypes: object[] = [],
) => ({ key, archimate_type, subtypes }) as CardType;

const types = [
  card("Application", "ApplicationComponent"),
  card("ITComponent", "Node"),
  card("DataObject", "BusinessObject"),
  card("BusinessProcess", "BusinessProcess"),
  card("Organization", "BusinessActor"),
];
const rel = (key: string, s: string, t: string, o: object) =>
  ({ key, source_type_key: s, target_type_key: t, ...o }) as RelationType;

describe("validateMapping", () => {
  it("accepts the seeded `uses` (relAppToITC: Serving, reversed)", () => {
    // "Application uses ITComponent": ArchiMate Node --Serving--> ApplicationComponent
    const uses = rel("relAppToITC", "Application", "ITComponent", {
      archimate_type: "Serving",
      archimate_reversed: true,
    });
    expect(validateMapping(types, [uses])).toEqual([]);
  });

  // The ArchiMate matrix allows Serving both ways between App and Node, so only a
  // direction-sensitive relationship can prove the flag is applied before the lookup.
  it("applies the direction flag before asking the matrix", () => {
    // relProcessToOrg: BusinessActor --Assignment--> BusinessProcess (matrix has no reverse)
    const ok = rel("relProcessToOrg", "BusinessProcess", "Organization", {
      archimate_type: "Assignment",
      archimate_reversed: true,
    });
    const wrong = rel("wrong", "BusinessProcess", "Organization", {
      archimate_type: "Assignment",
      archimate_reversed: false,
    });
    expect(validateMapping(types, [ok])).toEqual([]);
    expect(
      validateMapping(types, [wrong]).map((i) => [i.relationKey, i.kind]),
    ).toEqual([["wrong", "not_allowed"]]);
  });

  it("accepts the seeded business-context successor (Triggering, reversed)", () => {
    const succ = rel(
      "relBusinessContextSuccessor",
      "BusinessProcess",
      "BusinessProcess",
      {
        archimate_type: "Triggering",
        archimate_reversed: true,
      },
    );
    expect(validateMapping(types, [succ])).toEqual([]);
  });

  it("reports the offending element pair", () => {
    const bad = rel("x", "Application", "DataObject", {
      archimate_type: "Assignment",
    });
    const [issue] = validateMapping(types, [bad]);
    expect(issue).toMatchObject({
      relationKey: "x",
      kind: "not_allowed",
      relationship: "Assignment",
      source: "ApplicationComponent",
      target: "BusinessObject",
      sourceCardType: "Application",
      targetCardType: "DataObject",
    });
  });

  it("flags an end without a mapping and ignores relation types that are not mapped", () => {
    const unmapped = rel("y", "Application", "Ghost", {
      archimate_type: "Association",
    });
    const skipped = rel("z", "Application", "Ghost", {});
    expect(
      validateMapping(types, [unmapped, skipped]).map((i) => [
        i.relationKey,
        i.kind,
        i.target,
      ]),
    ).toEqual([["y", "unmapped_end", null]]);
  });

  it("checks subtype overrides too, one issue per relation type", () => {
    const itc = card("ITComponent", "Node", [
      { key: "software", label: "s", archimate_type: "Artifact" },
    ]);
    // Application -> Node is a valid Serving, Application -> Artifact is not.
    const r = rel("hosts", "Application", "ITComponent", {
      archimate_type: "Serving",
    });
    const issues = validateMapping([types[0], itc], [r]);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      source: "ApplicationComponent",
      target: "Artifact",
    });
  });
});
