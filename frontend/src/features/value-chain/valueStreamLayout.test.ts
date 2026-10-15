import { describe, expect, it } from "vitest";
import { makeStreamRoot } from "@/test/fixtures/valueChain";
import type { ValueStreamLeaf } from "@/types";
import {
  bandRowSpans,
  bandRowStarts,
  buildGeometry,
  CHEVRON_H,
  COL_W,
  GATE_H,
  GOAL_STRIP_W,
  groupByLeaf,
  GUTTER_PX,
  gridTemplateColumns,
  planProcessPlacements,
} from "./valueStreamLayout";

const leaf = (id: string, parent_id: string | null = null): ValueStreamLeaf => ({
  id,
  name: id.toUpperCase(),
  parent_id,
  parent_name: parent_id ? `parent-${parent_id}` : null,
});

describe("constants", () => {
  it("pins the layout metrics", () => {
    expect([COL_W, GUTTER_PX, GOAL_STRIP_W, CHEVRON_H, GATE_H]).toEqual([210, 12, 20, 56, 44]);
  });
});

describe("bandRowSpans", () => {
  it("reserves one level row minimum", () => {
    expect(bandRowSpans(0)).toEqual({ gate: 4, vs: 4, process: 4, cap: 2 });
    expect(bandRowSpans(1).process).toBe(4);
  });

  it("grows the process band with the row count", () => {
    expect(bandRowSpans(2).process).toBe(5);
    expect(bandRowSpans(3).process).toBe(6);
  });
});

describe("bandRowStarts", () => {
  it("stacks bands in the given order from grid line 1", () => {
    // spans: gate 4, vs 4, process 5, cap 2 => 15 rows
    expect(bandRowStarts(["gate", "vs", "process", "cap"], 2)).toEqual({
      starts: { gate: 1, vs: 5, process: 9, cap: 14 },
      total: 15,
    });
  });

  it("follows a reordered stack", () => {
    expect(bandRowStarts(["cap", "process", "vs", "gate"], 2)).toEqual({
      starts: { cap: 1, process: 3, vs: 8, gate: 12 },
      total: 15,
    });
  });

  it("uses the minimum process span for zero rows", () => {
    expect(bandRowStarts(["gate", "vs", "process", "cap"], 0)).toEqual({
      starts: { gate: 1, vs: 5, process: 9, cap: 13 },
      total: 14,
    });
  });
});

describe("buildGeometry", () => {
  it("groups the fixture sequence into runs by parent", () => {
    const geo = buildGeometry(makeStreamRoot().sequence);
    expect(geo.runs).toHaveLength(2);
    expect(geo.runs[0]).toMatchObject({ parentId: null, parentName: null, startCol: 2 });
    expect(geo.runs[0].leaves.map((l) => l.id)).toEqual(["a"]);
    expect(geo.runs[1]).toMatchObject({ parentId: "g1", parentName: "Recruit", startCol: 3 });
    expect(geo.runs[1].leaves.map((l) => l.id)).toEqual(["b", "c"]);
    expect(geo.colByLeafId).toEqual({ a: 2, b: 3, c: 4 });
    expect(geo.totalSlots).toBe(3);
    expect(geo.lastCol).toBe(4);
  });

  it("joins consecutive leaves that share a null parent into one run", () => {
    const geo = buildGeometry([leaf("a"), leaf("b")]);
    expect(geo.runs).toHaveLength(1);
    expect(geo.runs[0].leaves.map((l) => l.id)).toEqual(["a", "b"]);
    expect(geo.colByLeafId).toEqual({ a: 2, b: 3 });
  });

  it("starts a new run when the parent changes, even back to an earlier parent", () => {
    const geo = buildGeometry([leaf("a", "g1"), leaf("b", null), leaf("c", "g1")]);
    expect(geo.runs.map((r) => [r.parentId, r.startCol, r.leaves.length])).toEqual([
      ["g1", 2, 1],
      [null, 3, 1],
      ["g1", 4, 1],
    ]);
    expect(geo.totalSlots).toBe(3);
    expect(geo.lastCol).toBe(4);
  });

  it("handles a single leaf", () => {
    const geo = buildGeometry([leaf("a")]);
    expect(geo.totalSlots).toBe(1);
    expect(geo.lastCol).toBe(2);
    expect(geo.colByLeafId).toEqual({ a: 2 });
  });

  it("handles an empty sequence", () => {
    // The grid always reserves one slot track, so the last column is at least 2.
    expect(buildGeometry([])).toEqual({ runs: [], colByLeafId: {}, totalSlots: 0, lastCol: 2 });
  });
});

describe("gridTemplateColumns", () => {
  it("never emits repeat(0", () => {
    expect(gridTemplateColumns(0, false)).toBe("minmax(0, 1fr) repeat(1, 210px) minmax(0, 1fr)");
  });

  it("adds the goal strip and goal track when goals exist", () => {
    expect(gridTemplateColumns(3, true)).toBe("minmax(0, 1fr) repeat(3, 210px) 20px minmax(min-content, 1fr)");
  });

  it("omits the goal strip without goals", () => {
    expect(gridTemplateColumns(3, false)).toBe("minmax(0, 1fr) repeat(3, 210px) minmax(0, 1fr)");
  });

  it("falls back to one slot with goals and no leaves", () => {
    expect(gridTemplateColumns(0, true)).toBe("minmax(0, 1fr) repeat(1, 210px) 20px minmax(min-content, 1fr)");
  });
});

describe("groupByLeaf", () => {
  it("groups by leaf id keeping item order", () => {
    const items = [
      { leaf_id: "a", n: 1 },
      { leaf_id: "b", n: 2 },
      { leaf_id: "a", n: 3 },
    ];
    const out = groupByLeaf(items);
    expect([...out.keys()]).toEqual(["a", "b"]);
    expect(out.get("a")).toEqual([items[0], items[2]]);
    expect(out.get("b")).toEqual([items[1]]);
  });

  it("returns an empty map for no items", () => {
    expect(groupByLeaf([]).size).toBe(0);
  });
});

describe("planProcessPlacements", () => {
  const root = makeStreamRoot();
  const geometry = buildGeometry(root.sequence);
  const plan = planProcessPlacements(root, geometry);
  const byKey = (key: string) => plan.find((p) => p.key === key);

  it("emits exactly the expected placements in order: spans, cross, then leaves", () => {
    expect(plan.map((p) => p.key)).toEqual(["span-p-span", "cross-p-cross", "a-row0", "a-row1"]);
  });

  it("places a span from its first to its last leaf column", () => {
    expect(byKey("span-p-span")).toEqual({
      key: "span-p-span",
      items: [{ id: "p-span", children: [] }],
      gridColumn: "3 / 5",
      row: 0,
    });
  });

  it("stretches a cross-cutting process over every leaf column", () => {
    expect(byKey("cross-p-cross")).toEqual({
      key: "cross-p-cross",
      items: [{ id: "p-cross", children: [] }],
      gridColumn: "2 / 5",
      row: 1,
    });
  });

  it("splits a leaf's processes into one placement per level row", () => {
    expect(byKey("a-row0")).toEqual({
      key: "a-row0",
      items: [{ id: "p-group", children: ["p-child"] }],
      gridColumn: "2",
      row: 0,
    });
    expect(byKey("a-row1")).toEqual({
      key: "a-row1",
      items: [{ id: "p-solo", children: [] }],
      gridColumn: "2",
      row: 1,
    });
  });

  it("does not emit placements for leaves without processes, nor repeat the span there", () => {
    expect(plan.some((p) => p.key.startsWith("b-") || p.key.startsWith("c-"))).toBe(false);
    expect(plan.filter((p) => p.items.some((i) => i.id === "p-span"))).toHaveLength(1);
  });

  it("puts a process missing from row_of_process on row 0", () => {
    const r = makeStreamRoot({
      row_of_process: {},
      leaf_processes: { a: [{ id: "x1", children: [] }, { id: "x2", children: [] }], b: [], c: [] },
      spans: [],
      cross_processes: [],
    });
    const out = planProcessPlacements(r, buildGeometry(r.sequence));
    expect(out).toEqual([
      { key: "a-row0", items: [{ id: "x1", children: [] }, { id: "x2", children: [] }], gridColumn: "2", row: 0 },
    ]);
  });

  it("groups same-row items together in order, rows in first-seen order", () => {
    const r = makeStreamRoot({
      row_of_process: { p1: 2, p2: 0, p3: 2 },
      leaf_processes: {
        a: [
          { id: "p1", children: [] },
          { id: "p2", children: [] },
          { id: "p3", children: [] },
        ],
        b: [],
        c: [],
      },
      spans: [],
      cross_processes: [],
    });
    const out = planProcessPlacements(r, buildGeometry(r.sequence));
    expect(out.map((p) => [p.key, p.row, p.items.map((i) => i.id)])).toEqual([
      ["a-row2", 2, ["p1", "p3"]],
      ["a-row0", 0, ["p2"]],
    ]);
  });

  it("skips a span whose first or last leaf is unknown", () => {
    const geo = buildGeometry(root.sequence);
    const base = { process_id: "p-span", start_index: 1, end_index: 2 };
    for (const leaf_ids of [["zz", "c"], ["b", "zz"], []]) {
      const r = makeStreamRoot({ spans: [{ ...base, leaf_ids }], cross_processes: [], leaf_processes: {} });
      expect(planProcessPlacements(r, geo)).toEqual([]);
    }
  });

  it("places a one-leaf span on a single-column range", () => {
    const r = makeStreamRoot({
      spans: [{ process_id: "p-span", start_index: 1, end_index: 1, leaf_ids: ["b"] }],
      cross_processes: [],
      leaf_processes: {},
    });
    expect(planProcessPlacements(r, geometry)[0].gridColumn).toBe("3 / 4");
  });

  it("stretches a cross-cutting process over the one reserved slot of a cross-only root", () => {
    const r = makeStreamRoot({ sequence: [], spans: [], leaf_processes: {} });
    expect(planProcessPlacements(r, buildGeometry(r.sequence))).toEqual([
      { key: "cross-p-cross", items: [{ id: "p-cross", children: [] }], gridColumn: "2 / 3", row: 1 },
    ]);
  });

  it("returns nothing for a root with no processes", () => {
    const r = makeStreamRoot({ spans: [], cross_processes: [], leaf_processes: {} });
    expect(planProcessPlacements(r, geometry)).toEqual([]);
  });
});
