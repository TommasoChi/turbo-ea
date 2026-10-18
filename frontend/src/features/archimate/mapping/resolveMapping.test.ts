import { describe, it, expect } from "vitest";
import type { RelationType } from "@/types";
import {
  accessFromCrud,
  elementTypesForCardType,
  orientedEnds,
  resolveRelation,
} from "./resolveMapping";

describe("resolveMapping", () => {
  it("elementTypesForCardType returns the union of every bridge row for that card type, deduplicated", () => {
    const mappings = [
      { id: "1", enterprise_object_key: "BusinessObject", card_type_key: "DataObject", card_subtype_key: null },
      { id: "2", enterprise_object_key: "Artifact", card_type_key: "DataObject", card_subtype_key: "file" },
      { id: "3", enterprise_object_key: "BusinessObject", card_type_key: "DataObject", card_subtype_key: "file" },
    ];
    expect(elementTypesForCardType("DataObject", mappings)).toEqual(
      expect.arrayContaining(["BusinessObject", "Artifact"]),
    );
    expect(elementTypesForCardType("DataObject", mappings)).toHaveLength(2);
  });

  it("elementTypesForCardType returns an empty array for an unmapped card type", () => {
    expect(elementTypesForCardType("BusinessContext", [])).toEqual([]);
  });

  it("elementTypesForCardType filters out keys that are not standard ArchiMate element types", () => {
    const mappings = [
      { id: "1", enterprise_object_key: "CustomThing", card_type_key: "DataObject", card_subtype_key: null },
      { id: "2", enterprise_object_key: "BusinessObject", card_type_key: "DataObject", card_subtype_key: null },
    ];
    expect(elementTypesForCardType("DataObject", mappings)).toEqual(["BusinessObject"]);
  });

  it.each([
    [{ read: true }, "Read"],
    [{ create: true }, "Write"],
    [{ update: true }, "Write"],
    [{ delete: true }, "Write"],
    [{ read: true, update: true }, "ReadWrite"],
    [{}, "Access"],
    [undefined, "Access"],
  ])("accessFromCrud(%j) = %s", (flags, expected) =>
    expect(accessFromCrud(flags as never)).toBe(expected),
  );

  it("resolveRelation: Access takes its type from the CRUD flags or a fixed value", () => {
    const rt = (o: object) =>
      ({ key: "r", archimate_type: "Access", ...o }) as RelationType;
    expect(
      resolveRelation(rt({ archimate_access: "crud" }), { read: true }),
    ).toEqual({
      relationship: "Access",
      access: "Read",
      reversed: false,
    });
    expect(
      resolveRelation(rt({ archimate_access: "ReadWrite" }), { read: true }),
    ).toEqual({
      relationship: "Access",
      access: "ReadWrite",
      reversed: false,
    });
    expect(resolveRelation(rt({ archimate_access: null }))).toEqual({
      relationship: "Access",
      access: "Access",
      reversed: false,
    });
    expect(resolveRelation(rt({ archimate_access: "Banana" }), {})).toEqual({
      relationship: "Access",
      access: "Access",
      reversed: false,
    });
  });

  it("resolveRelation: direction flag is kept, except for Access", () => {
    expect(
      resolveRelation({
        key: "r",
        archimate_type: "Serving",
        archimate_reversed: true,
      } as RelationType),
    ).toEqual({ relationship: "Serving", access: null, reversed: true });
    expect(
      resolveRelation({
        key: "r",
        archimate_type: "Access",
        archimate_reversed: true,
      } as RelationType)?.reversed,
    ).toBe(false);
  });

  it("resolveRelation returns null without a usable relationship type", () => {
    expect(resolveRelation({ key: "r" } as RelationType)).toBeNull();
    expect(
      resolveRelation({ key: "r", archimate_type: "Wibble" } as RelationType),
    ).toBeNull();
  });

  it("orientedEnds swaps only when reversed", () => {
    expect(
      orientedEnds(
        { relationship: "Serving", access: null, reversed: true },
        "app",
        "itc",
      ),
    ).toEqual(["itc", "app"]);
    expect(
      orientedEnds(
        { relationship: "Serving", access: null, reversed: false },
        "app",
        "itc",
      ),
    ).toEqual(["app", "itc"]);
  });

  // Review Focus 2: seeded backend defaults must orient the same way here.
  it("seeded relAppToITC (Serving, reversed) orients ITComponent -> Application", () => {
    const uses = {
      key: "relAppToITC",
      archimate_type: "Serving",
      archimate_reversed: true,
    } as RelationType;
    const resolved = resolveRelation(uses)!;
    expect(resolved).toEqual({
      relationship: "Serving",
      access: null,
      reversed: true,
    });
    expect(orientedEnds(resolved, "Application", "ITComponent")).toEqual([
      "ITComponent",
      "Application",
    ]);
  });

  it("seeded relBusinessContextSuccessor (Triggering, reversed) orients target -> source", () => {
    const succ = {
      key: "relBusinessContextSuccessor",
      archimate_type: "Triggering",
      archimate_reversed: true,
    } as RelationType;
    const resolved = resolveRelation(succ)!;
    expect(resolved.reversed).toBe(true);
    expect(orientedEnds(resolved, "predecessor", "successor")).toEqual([
      "successor",
      "predecessor",
    ]);
  });
});
