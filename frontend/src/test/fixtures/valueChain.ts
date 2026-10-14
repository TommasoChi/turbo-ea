import type { ValueChainResponse, ValueStreamResponse, ValueStreamRoot } from "@/types";

export function makeChainResponse(): ValueChainResponse {
  const box = (id: string, name: string, process_type: "management" | "core" | "support" | "not_set", has_children = true) => ({
    id, name, has_children, process_type,
    group_count: 2, process_count: 5, value_stream_count: 3, value_gate_count: 1,
  });
  return {
    bands: [
      { key: "management", boxes: [box("m1", "Plan-to-Report", "management")] },
      { key: "core", boxes: [box("c1", "Lead-to-Order", "core")] },
      { key: "support", boxes: [box("s1", "Hire-to-Retire", "support"), box("s2", "Procure-to-Pay", "support", false)] },
      { key: "not_set", boxes: [] },
    ],
    core_house: {
      level_one: [{ id: "l1a", name: "Sales" }, { id: "l1b", name: "Delivery" }],
      level_two: { l1a: [{ id: "l2a", name: "Prospecting" }], l1b: [] },
      level_three: { l1a: [box("c1", "Lead-to-Order", "core")], l1b: [] },
    },
  };
}

/** One root, 3 sequence leaves (two share a parent), one cross leaf, a span, a container. */
export function makeStreamRoot(overrides: Partial<ValueStreamRoot> = {}): ValueStreamRoot {
  return {
    id: "r1",
    name: "Hire-to-Retire",
    sequence: [
      { id: "a", name: "Attract", parent_id: null, parent_name: null },
      { id: "b", name: "Select", parent_id: "g1", parent_name: "Recruit" },
      { id: "c", name: "Onboard", parent_id: "g1", parent_name: "Recruit" },
    ],
    cross: [{ id: "x", name: "Plan and monitor", parent_id: null, parent_name: null }],
    spans: [{ process_id: "p-span", start_index: 1, end_index: 2, leaf_ids: ["b", "c"] }],
    singles: [],
    leaf_processes: {
      a: [{ id: "p-group", children: ["p-child"] }, { id: "p-solo", children: [] }],
      b: [],
      c: [],
    },
    cross_processes: [{ id: "p-cross", children: [] }],
    row_count: 2,
    row_of_process: { "p-group": 0, "p-solo": 1, "p-span": 0, "p-cross": 1 },
    process_count: 4,
    processes: {
      "p-group": { id: "p-group", name: "Sourcing", subtype: "group", element_count: 9, color_attributes: { processType: "support", maturity: null }, related: [{ id: "app1", name: "Workday" }] },
      "p-child": { id: "p-child", name: "Screen CVs", subtype: "process", element_count: 3, color_attributes: { processType: "management" }, related: [] },
      "p-solo": { id: "p-solo", name: "Post job ad", subtype: "process", element_count: 0, color_attributes: { processType: "zzz-unknown" }, related: [] },
      "p-span": { id: "p-span", name: "Interview", subtype: "process", element_count: 2, color_attributes: {}, related: [] },
      "p-cross": { id: "p-cross", name: "Reporting", subtype: "process", element_count: 0, color_attributes: {}, related: [] },
    },
    gates: [
      { id: "g-a", name: "Budget approved", leaf_id: "a", objective_type: "strategic" },
      { id: "g-x", name: "Quarterly review", leaf_id: "x", objective_type: null },
    ],
    capabilities: [
      { id: "cap1", name: "Recruiting", leaf_id: "a", group_id: "capg", group_name: "Talent" },
      { id: "capg", name: "Talent", leaf_id: "a", group_id: "capg", group_name: "Talent" },
    ],
    goals: [{ id: "goal1", name: "Improve talent management", description: "Hire faster." }],
    ...overrides,
  };
}

export function makeStreamResponse(): ValueStreamResponse {
  return { roots: [makeStreamRoot()] };
}
