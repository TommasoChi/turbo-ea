import { describe, expect, it } from "vitest";
import { makeChainResponse, makeStreamRoot } from "@/test/fixtures/valueChain";
import { chainExportData, streamExportData } from "./exportData";
import type { ChainExportLabels, StreamExportLabels } from "./exportData";

const chainLabels: ChainExportLabels = {
  categories: "Categories",
  band: "Band",
  category: "Category",
  processGroups: "Process groups",
  processes: "Processes",
  valueStreams: "Value streams",
  valueGates: "Value gates",
  bands: { management: "Management", core: "Core", support: "Support", not_set: "Not set" },
};

const streamLabels: StreamExportLabels = {
  streams: "Streams",
  processes: "Processes",
  gates: "Gates",
  capabilities: "Capabilities",
  goals: "Goals",
  leaf: "Leaf",
  parent: "Parent",
  name: "Name",
  subtype: "Subtype",
  row: "Row",
  steps: "Steps",
  type: "Type",
  group: "Group",
  description: "Description",
  subtypes: { group: "Process group", process: "Process" },
  objectiveTypes: { strategic: "Strategic objective", operational: "Operational objective" },
  notSet: "Not set",
};

describe("chainExportData", () => {
  const node = document.createElement("div");
  const bands = makeChainResponse().bands;
  const data = chainExportData(bands, "Value chain", chainLabels, node);

  it("passes title and chart node through", () => {
    expect(data.title).toBe("Value chain");
    expect(data.chartNode).toBe(node);
    expect(chainExportData(bands, "t", chainLabels, null).chartNode).toBeNull();
  });

  it("emits a single categories sheet with typed columns", () => {
    expect(data.sheets).toHaveLength(1);
    expect(data.sheets[0].name).toBe("Categories");
    expect(data.sheets[0].columns).toEqual([
      { key: "band", label: "Band", type: "text" },
      { key: "category", label: "Category", type: "text" },
      { key: "processGroups", label: "Process groups", type: "number" },
      { key: "processes", label: "Processes", type: "number" },
      { key: "valueStreams", label: "Value streams", type: "number" },
      { key: "valueGates", label: "Value gates", type: "number" },
    ]);
  });

  it("emits one row per box in band order with translated band labels", () => {
    expect(data.sheets[0].rows).toEqual([
      { band: "Management", category: "Plan-to-Report", processGroups: 2, processes: 5, valueStreams: 3, valueGates: 1 },
      { band: "Core", category: "Lead-to-Order", processGroups: 2, processes: 5, valueStreams: 3, valueGates: 1 },
      { band: "Support", category: "Hire-to-Retire", processGroups: 2, processes: 5, valueStreams: 3, valueGates: 1 },
      { band: "Support", category: "Procure-to-Pay", processGroups: 2, processes: 5, valueStreams: 3, valueGates: 1 },
    ]);
  });

  it("follows the order of the bands it is given", () => {
    const reversed = chainExportData([...bands].reverse(), "t", chainLabels, null);
    expect(reversed.sheets[0].rows.map((r) => r.band)).toEqual(["Support", "Support", "Core", "Management"]);
  });

  it("keeps the sheet name within 31 characters and free of forbidden characters", () => {
    const long = chainExportData(bands, "t", { ...chainLabels, categories: "A very long translated sheet/name: [x]" }, null);
    const name = long.sheets[0].name;
    expect(name.length).toBeLessThanOrEqual(31);
    expect(name).not.toMatch(/[\\/?*[\]:]/);
    expect(name).toBe("A very long translated sheet na");
  });

  it("falls back to a generic sheet name when the label is blank", () => {
    expect(chainExportData(bands, "t", { ...chainLabels, categories: "  " }, null).sheets[0].name).toBe("Sheet");
  });

  it("still emits the sheet, with no rows, for empty bands", () => {
    const empty = chainExportData([], "t", chainLabels, null);
    expect(empty.sheets).toHaveLength(1);
    expect(empty.sheets[0].rows).toEqual([]);
  });
});

describe("streamExportData", () => {
  const node = document.createElement("div");
  const root = makeStreamRoot();
  const data = streamExportData([root], "Value stream", streamLabels, node);
  const sheet = (name: string) => data.sheets.find((s) => s.name === name);

  it("passes title and chart node through", () => {
    expect(data.title).toBe("Value stream");
    expect(data.chartNode).toBe(node);
    expect(streamExportData([root], "t", streamLabels, null).chartNode).toBeNull();
  });

  it("emits one sheet per kind, prefixed with the root name", () => {
    expect(data.sheets.map((s) => s.name)).toEqual([
      "Hire-to-Retire - Streams",
      "Hire-to-Retire - Processes",
      "Hire-to-Retire - Gates",
      "Hire-to-Retire - Capabilities",
      "Hire-to-Retire - Goals",
    ]);
  });

  it("lists leaves with their parent", () => {
    const s = sheet("Hire-to-Retire - Streams")!;
    expect(s.columns).toEqual([
      { key: "leaf", label: "Leaf", type: "text" },
      { key: "parent", label: "Parent", type: "text" },
    ]);
    expect(s.rows).toEqual([
      { leaf: "Attract", parent: "" },
      { leaf: "Select", parent: "Recruit" },
      { leaf: "Onboard", parent: "Recruit" },
      { leaf: "Plan and monitor", parent: "" },
    ]);
  });

  it("lists processes with translated subtype, level row and step count", () => {
    const s = sheet("Hire-to-Retire - Processes")!;
    expect(s.columns).toEqual([
      { key: "name", label: "Name", type: "text" },
      { key: "subtype", label: "Subtype", type: "text" },
      { key: "row", label: "Row", type: "number" },
      { key: "steps", label: "Steps", type: "number" },
    ]);
    expect(s.rows).toEqual([
      { name: "Sourcing", subtype: "Process group", row: 1, steps: 9 },
      { name: "Screen CVs", subtype: "Process", row: "", steps: 3 },
      { name: "Post job ad", subtype: "Process", row: 2, steps: 0 },
      { name: "Interview", subtype: "Process", row: 1, steps: 2 },
      { name: "Reporting", subtype: "Process", row: 2, steps: 0 },
    ]);
  });

  it("shows the not-set label, never the raw key, for an unmapped, null or empty subtype", () => {
    const p = (id: string, subtype: string | null) => ({
      id,
      name: id,
      subtype,
      element_count: 1,
      color_attributes: {},
      related: [],
    });
    const r = makeStreamRoot({ processes: { p1: p("p1", "weird"), p2: p("p2", null), p3: p("p3", ""), p4: p("p4", "group") } });
    const rows = streamExportData([r], "t", streamLabels, null).sheets[1].rows;
    expect(rows.map((x) => x.subtype)).toEqual(["Not set", "Not set", "Not set", "Process group"]);
  });

  it("lists gates with leaf name and objective type, resolving cross leaves too", () => {
    const s = sheet("Hire-to-Retire - Gates")!;
    expect(s.columns.map((c) => [c.key, c.label])).toEqual([
      ["name", "Name"],
      ["leaf", "Leaf"],
      ["type", "Type"],
    ]);
    expect(s.rows).toEqual([
      { name: "Budget approved", leaf: "Attract", type: "Strategic objective" },
      { name: "Quarterly review", leaf: "Plan and monitor", type: "Not set" },
    ]);
  });

  it("shows the label for a known objective type and not-set for unknown, null or empty ones", () => {
    const g = (id: string, objective_type: string | null) => ({ id, name: id, leaf_id: "a", objective_type });
    const r = makeStreamRoot({
      gates: [g("known", "operational"), g("unknown", "mystery"), g("none", null), g("empty", "")],
    });
    const rows = streamExportData([r], "t", streamLabels, null).sheets.find((s) => s.name.endsWith("Gates"))!.rows;
    expect(rows.map((x) => x.type)).toEqual(["Operational objective", "Not set", "Not set", "Not set"]);
    expect(JSON.stringify(rows)).not.toContain("mystery");
  });

  it("leaves the leaf blank when a gate or capability points to an unknown leaf", () => {
    const r = makeStreamRoot({
      gates: [{ id: "g", name: "G", leaf_id: "nope", objective_type: null }],
      capabilities: [{ id: "c", name: "C", leaf_id: "nope", group_id: "x", group_name: "X" }],
    });
    const out = streamExportData([r], "t", streamLabels, null).sheets;
    expect(out.find((s) => s.name.endsWith("Gates"))!.rows).toEqual([{ name: "G", leaf: "", type: "Not set" }]);
    expect(out.find((s) => s.name.endsWith("Capabilities"))!.rows).toEqual([{ name: "C", group: "X", leaf: "" }]);
  });

  it("lists capabilities with group and leaf", () => {
    const s = sheet("Hire-to-Retire - Capabilities")!;
    expect(s.columns.map((c) => [c.key, c.label])).toEqual([
      ["name", "Name"],
      ["group", "Group"],
      ["leaf", "Leaf"],
    ]);
    expect(s.rows).toEqual([
      { name: "Recruiting", group: "Talent", leaf: "Attract" },
      { name: "Talent", group: "Talent", leaf: "Attract" },
    ]);
  });

  it("lists goals with description, blank when absent", () => {
    const s = sheet("Hire-to-Retire - Goals")!;
    expect(s.columns.map((c) => [c.key, c.label])).toEqual([
      ["name", "Name"],
      ["description", "Description"],
    ]);
    expect(s.rows).toEqual([{ name: "Improve talent management", description: "Hire faster." }]);
    const r = makeStreamRoot({ goals: [{ id: "g", name: "G", description: null }] });
    const rows = streamExportData([r], "t", streamLabels, null).sheets.find((x) => x.name.endsWith("Goals"))!.rows;
    expect(rows).toEqual([{ name: "G", description: "" }]);
  });

  it("skips sheets with no rows", () => {
    const r = makeStreamRoot({ gates: [], capabilities: [], goals: [], processes: {} });
    expect(streamExportData([r], "t", streamLabels, null).sheets.map((s) => s.name)).toEqual([
      "Hire-to-Retire - Streams",
    ]);
  });

  it("emits no sheets for no roots", () => {
    expect(streamExportData([], "t", streamLabels, null).sheets).toEqual([]);
  });

  it("does not throw when tree items reference processes missing from root.processes", () => {
    const r = makeStreamRoot({ processes: {} });
    expect(() => streamExportData([r], "t", streamLabels, null)).not.toThrow();
  });

  it("sanitises forbidden characters in the root name", () => {
    const r = makeStreamRoot({ name: "A/B: C?*[x]\\y" });
    const names = streamExportData([r], "t", streamLabels, null).sheets.map((s) => s.name);
    expect(names[0]).toBe("A B C x y - Streams");
    for (const n of names) expect(n).not.toMatch(/[\\/?*[\]:]/);
  });

  it("clips every sheet name to 31 characters and keeps kinds distinguishable", () => {
    const r = makeStreamRoot({ name: "An extremely long value stream root name indeed" });
    const names = streamExportData([r], "t", streamLabels, null).sheets.map((s) => s.name);
    for (const n of names) expect(n.length).toBeLessThanOrEqual(31);
    expect(names).toEqual([
      "An extremely long val - Streams",
      "An extremely long v - Processes",
      "An extremely long value - Gates",
      "An extremely lon - Capabilities",
      "An extremely long value - Goals",
    ]);
  });

  it("gives roots sharing a clipped prefix distinct sheet names within 31 characters", () => {
    const same = "Shared root name that is long enough";
    const roots = [makeStreamRoot({ id: "r1", name: same }), makeStreamRoot({ id: "r2", name: same }), makeStreamRoot({ id: "r3", name: same })];
    const names = streamExportData(roots, "t", streamLabels, null).sheets.map((s) => s.name);
    expect(names).toHaveLength(15);
    expect(new Set(names.map((n) => n.toLowerCase())).size).toBe(15);
    for (const n of names) expect(n.length).toBeLessThanOrEqual(31);
    expect(names.filter((n) => n.endsWith(" 2"))).toHaveLength(5);
    expect(names.filter((n) => n.endsWith(" 3"))).toHaveLength(5);
  });

  it("treats sheet names case-insensitively when de-duplicating", () => {
    const roots = [makeStreamRoot({ id: "r1", name: "Abc" }), makeStreamRoot({ id: "r2", name: "ABC" })];
    const names = streamExportData(roots, "t", streamLabels, null).sheets.map((s) => s.name);
    expect(names).toContain("Abc - Streams");
    expect(names).toContain("ABC - Streams 2");
  });
});
