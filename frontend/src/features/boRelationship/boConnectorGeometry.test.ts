import { describe, expect, it } from "vitest";
import {
  MAX_BO_BENDS,
  anchorOffset,
  boEdgeWaypoints,
  crowFoot,
  validBoEdgeGeometry,
} from "./boConnectorGeometry";

const box = (x: number, y: number) => ({ x, y, width: 200, height: 100 });
const A = box(0, 0); // centre (100, 50)
const RIGHT = box(400, 0); // centre (500, 50)
const BELOW = box(0, 300); // centre (100, 350)
const DIAGONAL = box(400, 300); // centre (500, 350)

describe("validBoEdgeGeometry", () => {
  it("accepts null and a well-formed geometry", () => {
    expect(validBoEdgeGeometry(null)).toBe(true);
    expect(validBoEdgeGeometry({ bends: [] })).toBe(true);
    expect(validBoEdgeGeometry({ bends: [{ x: 1, y: 2 }] })).toBe(true);
    expect(validBoEdgeGeometry({ bends: [], source: null, target: null })).toBe(true);
    expect(
      validBoEdgeGeometry({ bends: [], source: { x: 0, y: 5 }, target: { x: 200, y: 5 } }),
    ).toBe(true);
  });

  it.each([undefined, 0, 1, "", "bends", false, true])("refuses the non-object %s", (value) => {
    expect(validBoEdgeGeometry(value)).toBe(false);
  });

  it("refuses bends that are missing or not a list", () => {
    expect(validBoEdgeGeometry({})).toBe(false);
    expect(validBoEdgeGeometry({ bends: "x" })).toBe(false);
    expect(validBoEdgeGeometry({ bends: { length: 0 } })).toBe(false);
  });

  it("caps the bends at 64, inclusive", () => {
    expect(MAX_BO_BENDS).toBe(64);
    const bends = (n: number) => Array.from({ length: n }, (_, i) => ({ x: i, y: i }));
    expect(validBoEdgeGeometry({ bends: bends(64) })).toBe(true);
    expect(validBoEdgeGeometry({ bends: bends(65) })).toBe(false);
  });

  it.each([
    [{ x: Number.NaN, y: 0 }],
    [{ x: 0, y: Number.NaN }],
    [{ x: Number.POSITIVE_INFINITY, y: 0 }],
    [{ x: 0, y: Number.NEGATIVE_INFINITY }],
    [{ x: 0 }],
    [{ y: 0 }],
    [{ x: "1", y: 2 }],
    [null],
  ])("refuses the point %j as a bend, a source or a target", (point) => {
    const good = { x: 1, y: 2 };
    expect(validBoEdgeGeometry({ bends: [good, point] })).toBe(false);
    expect(validBoEdgeGeometry({ bends: [point, good] })).toBe(false);
    if (point !== null) {
      expect(validBoEdgeGeometry({ bends: [], source: point })).toBe(false);
      expect(validBoEdgeGeometry({ bends: [], target: point })).toBe(false);
      expect(validBoEdgeGeometry({ bends: [], source: good, target: point })).toBe(false);
      expect(validBoEdgeGeometry({ bends: [], source: point, target: good })).toBe(false);
    }
  });
});

describe("anchorOffset", () => {
  const shape = { x: 10, y: 20, width: 200, height: 100 };
  const at = (dx: number, dy: number) => anchorOffset(shape, { x: shape.x + dx, y: shape.y + dy });

  it("keeps a point already on an edge", () => {
    expect(at(0, 40)).toEqual({ x: 0, y: 40 });
    expect(at(50, 0)).toEqual({ x: 50, y: 0 });
    expect(at(200, 30)).toEqual({ x: 200, y: 30 });
    expect(at(100, 100)).toEqual({ x: 100, y: 100 });
  });

  it("snaps an inner point to its nearest edge", () => {
    expect(at(5, 50)).toEqual({ x: 0, y: 50 });
    expect(at(100, 10)).toEqual({ x: 100, y: 0 });
    expect(at(190, 50)).toEqual({ x: 200, y: 50 });
    expect(at(100, 95)).toEqual({ x: 100, y: 100 });
  });

  it("clamps a point outside the shape onto it", () => {
    expect(at(-60, 30)).toEqual({ x: 0, y: 30 });
    expect(at(490, 30)).toEqual({ x: 200, y: 30 });
    expect(at(50, -119)).toEqual({ x: 50, y: 0 });
    expect(at(50, 979)).toEqual({ x: 50, y: 100 });
  });

  it("measures from the shape's own origin", () => {
    expect(anchorOffset(shape, { x: 10, y: 60 })).toEqual({ x: 0, y: 40 });
    expect(anchorOffset({ ...shape, x: 0, y: 0 }, { x: 10, y: 60 })).toEqual({ x: 0, y: 60 });
  });
});

describe("boEdgeWaypoints — straight, no stored geometry", () => {
  it("docks each end on the edge facing the other shape", () => {
    expect(boEdgeWaypoints(A, RIGHT)).toEqual([{ x: 200, y: 50 }, { x: 400, y: 50 }]);
    expect(boEdgeWaypoints(RIGHT, A)).toEqual([{ x: 400, y: 50 }, { x: 200, y: 50 }]);
    expect(boEdgeWaypoints(A, BELOW)).toEqual([{ x: 100, y: 100 }, { x: 100, y: 300 }]);
    expect(boEdgeWaypoints(A, RIGHT, "straight")).toEqual([{ x: 200, y: 50 }, { x: 400, y: 50 }]);
    expect(boEdgeWaypoints(A, RIGHT, null, null)).toEqual([{ x: 200, y: 50 }, { x: 400, y: 50 }]);
  });

  it("docks a diagonal on the edge the line leaves through", () => {
    const [start, end] = boEdgeWaypoints(A, DIAGONAL);
    expect(start.x).toBeCloseTo(100 + 400 / 6, 9);
    expect(start.y).toBeCloseTo(100, 9);
    expect(end.x).toBeCloseTo(500 - 400 / 6, 9);
    expect(end.y).toBeCloseTo(300, 9);
  });

  it("stops overlapping shapes at the midpoint between the two centres", () => {
    expect(boEdgeWaypoints(A, box(100, 0))).toEqual([{ x: 150, y: 50 }, { x: 150, y: 50 }]);
  });

  it("returns the shared centre for two shapes on the same spot", () => {
    expect(boEdgeWaypoints(A, box(0, 0))).toEqual([{ x: 100, y: 50 }, { x: 100, y: 50 }]);
  });
});

describe("boEdgeWaypoints — straight, stored geometry", () => {
  it("runs through the stored bends between two docked ends", () => {
    expect(boEdgeWaypoints(A, RIGHT, "straight", { bends: [] })).toEqual([
      { x: 200, y: 50 },
      { x: 400, y: 50 },
    ]);
    // A bend inside the source: the dock is not pushed past the bend itself.
    expect(boEdgeWaypoints(A, RIGHT, undefined, { bends: [{ x: 150, y: 50 }] })).toEqual([
      { x: 150, y: 50 },
      { x: 150, y: 50 },
      { x: 400, y: 50 },
    ]);
  });

  it("aims each end at its nearest bend", () => {
    const bends = [{ x: 100, y: 250 }, { x: 500, y: 250 }];
    expect(boEdgeWaypoints(A, RIGHT, "straight", { bends })).toEqual([
      { x: 100, y: 100 },
      ...bends,
      { x: 500, y: 100 },
    ]);
  });

  it("uses a pinned end as an offset from the shape, snapped to its edge", () => {
    const geometry = {
      bends: [{ x: 300, y: 200 }],
      source: { x: 200, y: 20 },
      target: { x: 10, y: 0 },
    };
    expect(boEdgeWaypoints(A, RIGHT, "straight", geometry)).toEqual([
      { x: 200, y: 20 },
      { x: 300, y: 200 },
      { x: 410, y: 0 },
    ]);
    expect(
      boEdgeWaypoints(box(10, 20), RIGHT, "straight", { bends: [], source: { x: 50, y: 30 } })[0],
    ).toEqual({ x: 60, y: 20 });
    expect(
      boEdgeWaypoints(A, box(400, 10), "straight", { bends: [], target: { x: 190, y: 50 } })[1],
    ).toEqual({ x: 600, y: 60 });
  });

  it("docks an end whose pin is null", () => {
    expect(
      boEdgeWaypoints(A, RIGHT, "straight", { bends: [], source: null, target: null }),
    ).toEqual([{ x: 200, y: 50 }, { x: 400, y: 50 }]);
  });
});

describe("boEdgeWaypoints — orthogonal", () => {
  it("routes side by side shapes through the gap between them", () => {
    expect(boEdgeWaypoints(A, RIGHT, "orthogonal")).toEqual([
      { x: 200, y: 50 },
      { x: 300, y: 50 },
      { x: 400, y: 50 },
    ]);
    expect(boEdgeWaypoints(A, DIAGONAL, "orthogonal")).toEqual([
      { x: 200, y: 50 },
      { x: 300, y: 50 },
      { x: 300, y: 350 },
      { x: 400, y: 350 },
    ]);
  });

  it("routes stacked shapes through the gap between them", () => {
    expect(boEdgeWaypoints(A, BELOW, "orthogonal")).toEqual([
      { x: 100, y: 100 },
      { x: 100, y: 200 },
      { x: 100, y: 300 },
    ]);
  });

  it("leaves a top or bottom edge vertically before turning", () => {
    expect(boEdgeWaypoints(A, RIGHT, "orthogonal", { bends: [{ x: 300, y: 200 }] })).toEqual([
      { x: 100, y: 100 },
      { x: 100, y: 200 },
      { x: 300, y: 200 },
      { x: 500, y: 200 },
      { x: 500, y: 100 },
    ]);
    expect(boEdgeWaypoints(A, RIGHT, "orthogonal", { bends: [{ x: 300, y: -100 }] })).toEqual([
      { x: 100, y: 0 },
      { x: 100, y: -100 },
      { x: 300, y: -100 },
      { x: 500, y: -100 },
      { x: 500, y: 0 },
    ]);
  });

  it("leaves a side edge horizontally, and enters a side edge horizontally", () => {
    const bends = [{ x: 300, y: 60 }];
    expect(boEdgeWaypoints(A, RIGHT, "orthogonal", { bends })).toEqual([
      { x: 200, y: 50 },
      { x: 300, y: 50 },
      { x: 300, y: 60 },
      { x: 300, y: 50 },
      { x: 400, y: 50 },
    ]);
    // The target's right-hand edge counts as a side edge too.
    expect(boEdgeWaypoints(RIGHT, A, "orthogonal", { bends })).toEqual([
      { x: 400, y: 50 },
      { x: 300, y: 50 },
      { x: 300, y: 60 },
      { x: 300, y: 50 },
      { x: 200, y: 50 },
    ]);
  });

  it("turns horizontally first between two bends", () => {
    const bends = [{ x: 300, y: 50 }, { x: 350, y: 80 }, { x: 380, y: 50 }];
    expect(boEdgeWaypoints(A, RIGHT, "orthogonal", { bends })).toEqual([
      { x: 200, y: 50 },
      { x: 300, y: 50 },
      { x: 350, y: 50 },
      { x: 350, y: 80 },
      { x: 380, y: 80 },
      { x: 380, y: 50 },
      { x: 400, y: 50 },
    ]);
  });

  it("drops a bend that repeats the point before it", () => {
    const bends = [{ x: 300, y: 50 }, { x: 300, y: 50 }, { x: 300, y: 50 }];
    expect(boEdgeWaypoints(A, RIGHT, "orthogonal", { bends })).toEqual([
      { x: 200, y: 50 },
      { x: 300, y: 50 },
      { x: 400, y: 50 },
    ]);
  });

  it("keeps pinned ends and squares the path between them", () => {
    const geometry = { bends: [], source: { x: 200, y: 20 }, target: { x: 0, y: 80 } };
    expect(boEdgeWaypoints(A, RIGHT, "orthogonal", geometry)).toEqual([
      { x: 200, y: 20 },
      { x: 400, y: 20 },
      { x: 400, y: 80 },
    ]);
  });

  it("still returns two points when both ends fall on the same spot", () => {
    const pin = { x: 0, y: 50 };
    expect(boEdgeWaypoints(A, box(0, 0), "orthogonal", { bends: [], source: pin, target: pin })).toEqual([
      { x: 0, y: 50 },
      { x: 0, y: 50 },
    ]);
  });
});

describe("crowFoot", () => {
  it("has no foot when the line has no length", () => {
    expect(crowFoot({ x: 5, y: 5 }, { x: 5, y: 5 })).toBeUndefined();
  });

  it("opens 7 either side of the end and closes 13 back along the line", () => {
    expect(crowFoot({ x: 10, y: 0 }, { x: 0, y: 0 })).toBe("M 10 -7 L -3 0 L 10 7");
    expect(crowFoot({ x: 0, y: 0 }, { x: 10, y: 0 })).toBe("M 0 7 L 13 0 L 0 -7");
    expect(crowFoot({ x: 0, y: 10 }, { x: 0, y: 0 })).toBe("M 7 10 L 0 -3 L -7 10");
    expect(crowFoot({ x: 0, y: 0 }, { x: 0, y: 10 })).toBe("M -7 0 L 0 13 L 7 0");
  });

  it("scales by the line's length, not by its components", () => {
    const numbers = crowFoot({ x: 30, y: 40 }, { x: 0, y: 0 })!
      .split(" ")
      .filter((token) => token !== "M" && token !== "L")
      .map(Number);
    const expected = [35.6, 35.8, 22.2, 29.6, 24.4, 44.2];
    expect(numbers).toHaveLength(6);
    numbers.forEach((n, i) => expect(n).toBeCloseTo(expected[i], 9));
  });
});
