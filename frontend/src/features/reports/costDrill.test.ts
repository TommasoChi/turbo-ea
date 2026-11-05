import { describe, it, expect } from "vitest";
import { applyDrill, backOf, crumbsOf } from "./costDrill";
import { OTHERS_KEY } from "./costColors";

const items = [
  { id: "a", group: "fin" },
  { id: "b", group: "fin" },
  { id: "c", group: "ops" },
  { id: "d", group: "hr" },
  { id: "e" },
];
const none = new Set<string>();

describe("backOf", () => {
  it("returns the group from a card inside a group", () => {
    expect(backOf({ group: "fin", cardId: "a" })).toEqual({ group: "fin" });
  });
  it("returns the root from a card without a group", () => {
    expect(backOf({ cardId: "e" })).toEqual({});
  });
  it("returns the root from a group", () => {
    expect(backOf({ group: "fin" })).toEqual({});
  });
});

describe("applyDrill", () => {
  it("keeps everything at the root", () => {
    expect(applyDrill(items, {}, none)).toHaveLength(5);
  });
  it("keeps a group's members", () => {
    expect(applyDrill(items, { group: "fin" }, none).map((i) => i.id)).toEqual(["a", "b"]);
  });
  it("Others matches every folded raw key", () => {
    const folded = new Set(["ops", "hr"]);
    expect(applyDrill(items, { group: OTHERS_KEY }, folded).map((i) => i.id)).toEqual(["c", "d"]);
  });
  it("keeps one card", () => {
    expect(applyDrill(items, { cardId: "e" }, none).map((i) => i.id)).toEqual(["e"]);
  });
  it("requires both group and card", () => {
    expect(applyDrill(items, { group: "ops", cardId: "a" }, none)).toEqual([]);
    expect(applyDrill(items, { group: "fin", cardId: "a" }, none).map((i) => i.id)).toEqual(["a"]);
  });
});

describe("crumbsOf", () => {
  const labels = { root: "All", group: (k: string) => `G:${k}`, card: (id: string) => `C:${id}` };
  it("is just the root at the top", () => {
    expect(crumbsOf({}, labels)).toEqual([{ kind: "root", label: "All", target: {} }]);
  });
  it("lists root, group and card with the target each one resets to", () => {
    expect(crumbsOf({ group: "fin", cardId: "a" }, labels)).toEqual([
      { kind: "root", label: "All", target: {} },
      { kind: "group", label: "G:fin", target: { group: "fin" } },
      { kind: "card", label: "C:a", target: { group: "fin", cardId: "a" } },
    ]);
  });
  it("omits the group crumb for a card without a group", () => {
    expect(crumbsOf({ cardId: "e" }, labels).map((c) => c.kind)).toEqual(["root", "card"]);
  });
});
