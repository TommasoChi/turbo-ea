import { describe, it, expect } from "vitest";
import type { CardType, RelationType } from "@/types";
import {
  accessFromCrud,
  elementTypeForCard,
  elementTypesForCardType,
  orientedEnds,
  resolveRelation,
} from "./resolveMapping";

const card = (
  key: string,
  archimate_type: string | null,
  subtypes: object[] = [],
) => ({ key, archimate_type, subtypes }) as CardType;

describe("resolveMapping", () => {
  it("a subtype override beats the type, and the type is the fallback", () => {
    const types = [
      card("ITComponent", "Node", [
        { key: "software", label: "s", archimate_type: "SystemSoftware" },
        { key: "service", label: "v" },
      ]),
    ];
    expect(elementTypeForCard(types, "ITComponent", "software")).toBe(
      "SystemSoftware",
    );
    expect(elementTypeForCard(types, "ITComponent", "service")).toBe("Node");
    expect(elementTypeForCard(types, "ITComponent", null)).toBe("Node");
    expect(elementTypeForCard(types, "ITComponent", "ghost")).toBe("Node");
  });

  it("an unknown or empty mapping resolves to null instead of throwing", () => {
    const types = [card("A", "Banana"), card("B", null)];
    expect(elementTypeForCard(types, "A")).toBeNull();
    expect(elementTypeForCard(types, "B")).toBeNull();
    expect(elementTypeForCard(types, "Missing")).toBeNull();
  });

  it("elementTypesForCardType lists the type then the distinct overrides", () => {
    const t = card("ITComponent", "Node", [
      { key: "a", label: "a", archimate_type: "Device" },
      { key: "b", label: "b", archimate_type: "Device" },
      { key: "c", label: "c", archimate_type: "Banana" },
    ]);
    expect(elementTypesForCardType(t)).toEqual(["Node", "Device"]);
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
