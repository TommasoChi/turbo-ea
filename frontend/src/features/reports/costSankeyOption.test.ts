import { describe, expect, it } from "vitest";
import { buildEChartsChrome } from "@/components/charts/echartsTheme";
import {
  buildCostSankeyOption,
  costSankeyNodeColor,
  shortenSankeyLabel,
  type CostSankeyLinkIn,
  type CostSankeyNodeIn,
} from "./costSankeyOption";

/* eslint-disable @typescript-eslint/no-explicit-any -- option trees are plain JSON here */

const chrome = buildEChartsChrome({
  mode: "light",
  text: { primary: "#111111", secondary: "#555555" },
  divider: "#dddddd",
  background: { paper: "#ffffff" },
  action: { hover: "#eeeeee" },
});

const NODES: CostSankeyNodeIn[] = [
  { id: "item:lic", name: "Licences", type: "CostItem" },
  { id: "group:EMEA", name: "EMEA", type: "Group" },
  { id: "crm", name: "CRM", type: "Application" },
];
const LINKS: CostSankeyLinkIn[] = [
  { source: 0, target: 1, value: 100 },
  { source: 1, target: 2, value: 100 },
];

const build = (nodes = NODES, links = LINKS, isRtl = false) =>
  buildCostSankeyOption(nodes, links, { chrome, isRtl, format: (v) => `$${v}` }) as any;

describe("costSankeyNodeColor", () => {
  it("colours a cost item, a group and a card differently", () => {
    const colours = new Set(["CostItem", "Group", "Application"].map(costSankeyNodeColor));
    expect(colours.size).toBe(3);
  });

  it("falls back to one colour for a card type it does not know", () => {
    expect(costSankeyNodeColor("NoSuchType")).toBe(costSankeyNodeColor("AlsoUnknown"));
  });
});

describe("shortenSankeyLabel", () => {
  it("keeps a name of 24 characters whole and ellipsises a longer one to 24", () => {
    const whole = "a".repeat(24);
    expect(shortenSankeyLabel(whole)).toBe(whole);
    expect(shortenSankeyLabel(`${whole}b`)).toBe(`${"a".repeat(23)}…`);
  });
});

describe("buildCostSankeyOption", () => {
  it("names each node by its id and links them by id, in the flow's order", () => {
    const s = build().series[0];
    expect(s.type).toBe("sankey");
    expect(s.data.map((d: any) => d.name)).toEqual(["item:lic", "group:EMEA", "crm"]);
    expect(s.links).toEqual([
      { source: "item:lic", target: "group:EMEA", value: 100 },
      { source: "group:EMEA", target: "crm", value: 100 },
    ]);
  });

  it("prints a node's own name, shortened, and not its id", () => {
    const s = build([{ id: "x", name: "N".repeat(30), type: "Application" }], []).series[0];
    expect(s.label.formatter({ name: "x" })).toBe(`${"N".repeat(23)}…`);
  });

  it("colours each node by its kind", () => {
    const s = build().series[0];
    expect(s.data.map((d: any) => d.itemStyle.color)).toEqual(NODES.map((n) => costSankeyNodeColor(n.type)));
  });

  it("keeps room right of the last column for its labels", () => {
    const long = build(NODES.map((n) => (n.id === "crm" ? { ...n, name: "A Very Long Application" } : n)));
    expect(long.series[0].right).toBeGreaterThan(build().series[0].right);
  });

  it("explains a flow as 'from -> to: cost' and a node as 'name: cost', escaped", () => {
    const tip = build([{ ...NODES[0], name: "<b>Lic</b>" }, NODES[1], NODES[2]]).tooltip.formatter;
    expect(tip({ dataType: "edge", value: 100, data: { source: "item:lic", target: "group:EMEA" } })).toBe(
      "&lt;b&gt;Lic&lt;/b&gt; → EMEA: $100",
    );
    expect(tip({ dataType: "node", name: "crm", value: 100 })).toBe("CRM: $100");
  });

  it("points the arrow the other way in a right-to-left locale", () => {
    const tip = build(NODES, LINKS, true).tooltip.formatter;
    expect(tip({ dataType: "edge", value: 1, data: { source: "item:lic", target: "group:EMEA" } })).toContain("←");
  });
});
