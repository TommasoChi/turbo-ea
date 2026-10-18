import { ARCHIMATE_TEXT_COLOR } from "@/theme/tokens";
import { connectionStyle, relationshipSvg, type ConnectionStyle } from "./connectionStyle";

const style = (dashArray: string | null, sourceMarker: ConnectionStyle["sourceMarker"], targetMarker: ConnectionStyle["targetMarker"]) =>
  ({ dashArray, sourceMarker, targetMarker });

describe("connectionStyle", () => {
  it.each([
    ["Composition", style(null, "diamond-filled", null)],
    ["Aggregation", style(null, "diamond-hollow", null)],
    ["Assignment", style(null, "dot", "arrow-filled")],
    ["Realization", style("6 4", null, "triangle-hollow")],
    ["Serving", style(null, null, "arrow-open")],
    ["Access", style("2 3", null, null)],
    ["Influence", style("6 4", null, "arrow-open")],
    ["Triggering", style(null, null, "arrow-filled")],
    ["Flow", style("6 4", null, "arrow-filled")],
    ["Specialization", style(null, null, "triangle-hollow")],
    ["Association", style(null, null, null)],
  ] as const)("%s", (type, expected) => {
    expect(connectionStyle(type)).toEqual(expected);
  });

  it.each([
    ["Access", style("2 3", null, null)],
    ["Read", style("2 3", null, "arrow-open")],
    ["Write", style("2 3", "arrow-open", null)],
    ["ReadWrite", style("2 3", "arrow-open", "arrow-open")],
  ] as const)("Access / %s", (accessType, expected) => {
    expect(connectionStyle("Access", { accessType })).toEqual(expected);
  });

  it("draws an arrow on a directed association only", () => {
    expect(connectionStyle("Association", { isDirected: true })).toEqual(style(null, null, "arrow-open"));
    expect(connectionStyle("Association", { isDirected: false })).toEqual(style(null, null, null));
  });
});

describe("relationshipSvg", () => {
  const ids = (svg: string) => [...svg.matchAll(/<marker id="([^"]+)"/g)].map((m) => m[1]);

  it("is a 28x16 svg with the sample line in the text colour", () => {
    const svg = relationshipSvg("Serving");
    expect(svg).toMatch(/^<svg [^>]*width="28" height="16" viewBox="0 0 28 16"/);
    expect(svg).toContain(`stroke="${ARCHIMATE_TEXT_COLOR}"`);
  });

  it("dashes Flow and Realization, not Serving", () => {
    expect(relationshipSvg("Flow")).toContain('stroke-dasharray="6 4"');
    expect(relationshipSvg("Access")).toContain('stroke-dasharray="2 3"');
    expect(relationshipSvg("Serving")).not.toContain("stroke-dasharray");
  });

  it("declares exactly the markers it references, with ids no other call shares", () => {
    const a = relationshipSvg("Assignment");
    const b = relationshipSvg("Assignment");
    expect(ids(a)).toHaveLength(2);
    for (const id of ids(a)) {
      expect(a).toContain(`url(#${id})`);
      expect(ids(b)).not.toContain(id);
    }
    expect(ids(relationshipSvg("Association"))).toEqual([]);
  });

  it("uses the access type for Access", () => {
    const both = relationshipSvg("Access", "ReadWrite"); // one shared marker, used at both ends
    expect(ids(both)).toHaveLength(1);
    expect(both).toContain("marker-start=");
    expect(both).toContain("marker-end=");
    expect(ids(relationshipSvg("Access", "Read"))).toHaveLength(1);
    expect(ids(relationshipSvg("Access"))).toHaveLength(0);
  });
});
