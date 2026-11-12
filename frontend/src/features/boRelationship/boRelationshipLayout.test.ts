import { describe, expect, it } from "vitest";
import { BO_NODE_HEIGHT, BO_NODE_WIDTH, computeLayout } from "./boRelationshipLayout";

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

  const nodes = (...ids: string[]) => ids.map((id) => ({ id }));

  it("sizes every node 200 by 100", () => {
    expect(BO_NODE_WIDTH).toBe(200);
    expect(BO_NODE_HEIGHT).toBe(100);
  });

  it("returns the top-left corner, not Dagre's centre", () => {
    expect(computeLayout(nodes("a"), [], {})).toEqual({ a: { x: 0, y: 0 } });
  });

  it("ranks left to right, 100 apart", () => {
    expect(computeLayout(nodes("a", "b"), [{ source: "a", target: "b" }], {})).toEqual({
      a: { x: 0, y: 0 },
      b: { x: 300, y: 0 },
    });
  });

  it("stacks unconnected nodes 70 apart", () => {
    expect(computeLayout(nodes("a", "b"), [], {})).toEqual({
      a: { x: 0, y: 0 },
      b: { x: 0, y: 170 },
    });
  });

  it("ignores an edge naming a node that is not in the drawing", () => {
    const edges = [{ source: "a", target: "zz" }, { source: "zz", target: "b" }];
    expect(computeLayout(nodes("a", "b"), edges, {})).toEqual({
      a: { x: 0, y: 0 },
      b: { x: 0, y: 170 },
    });
  });

  it("keeps a saved position of a node that is no longer drawn, and does not dodge it", () => {
    const saved = { gone: { x: 0, y: 0 } };
    expect(computeLayout(nodes("a"), [], saved)).toEqual({ gone: { x: 0, y: 0 }, a: { x: 0, y: 0 } });
    expect(saved).toEqual({ gone: { x: 0, y: 0 } });
  });

  it("moves a new node down a row at a time until it clears a saved one", () => {
    // Dagre puts b at (0, 170); a saved at (0, 100) is 70 away, so b drops by 170.
    expect(computeLayout(nodes("a", "b"), [], { a: { x: 0, y: 100 } })).toEqual({
      a: { x: 0, y: 100 },
      b: { x: 0, y: 340 },
    });
    // Still in the way after one row: it drops again.
    expect(computeLayout(nodes("a", "b"), [], { a: { x: 0, y: 255 } }).b).toEqual({ x: 0, y: 510 });
  });

  it("needs 30 clear on each axis: 230 across or 130 down is enough", () => {
    const placed = (a: { x: number; y: number }) => computeLayout(nodes("a", "b"), [], { a }).b;
    expect(placed({ x: 230, y: 170 })).toEqual({ x: 0, y: 170 });
    expect(placed({ x: 229, y: 170 })).toEqual({ x: 0, y: 340 });
    expect(placed({ x: -230, y: 170 })).toEqual({ x: 0, y: 170 });
    expect(placed({ x: -229, y: 170 })).toEqual({ x: 0, y: 340 });
    expect(placed({ x: 0, y: 40 })).toEqual({ x: 0, y: 170 });
    expect(placed({ x: 0, y: 41 })).toEqual({ x: 0, y: 340 });
    expect(placed({ x: 0, y: 300 })).toEqual({ x: 0, y: 170 });
    expect(placed({ x: 0, y: 299 })).toEqual({ x: 0, y: 510 });
  });

  it("dodges the nodes it has just placed as well", () => {
    expect(computeLayout(nodes("a", "b", "c"), [], { a: { x: 0, y: 170 } })).toEqual({
      a: { x: 0, y: 170 },
      b: { x: 0, y: 340 },
      c: { x: 0, y: 510 },
    });
  });
});
