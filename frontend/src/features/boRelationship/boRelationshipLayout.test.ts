import { describe, expect, it } from "vitest";
import { computeLayout } from "./boRelationshipLayout";

describe("computeLayout", () => {
  it("preserves saved positions and places new nodes clear of them", () => {
    const saved = { a: { x: 10, y: 20 } };
    const result = computeLayout([{ id: "a" }, { id: "b" }], [{ source: "a", target: "b" }], saved);
    expect(result.a).toEqual(saved.a);
    expect(result.b).toBeDefined();
    expect(Math.abs(result.b.x - saved.a.x) >= 200 || Math.abs(result.b.y - saved.a.y) >= 100).toBe(true);
  });
  it("lays out connected unsaved nodes separately", () => {
    const result = computeLayout([{ id: "a" }, { id: "b" }], [{ source: "a", target: "b" }], {});
    expect(result.a).not.toEqual(result.b);
  });
});
