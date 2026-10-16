import Diagram from "diagram-js";
import type Canvas from "diagram-js/lib/core/Canvas";
import type ElementRegistry from "diagram-js/lib/core/ElementRegistry";
import type GraphicsFactory from "diagram-js/lib/core/GraphicsFactory";
import type { Connection, Shape } from "diagram-js/lib/model/Types";
import { ARCHIMATE_LAYER_COLORS, ARCHIMATE_TEXT_COLOR } from "@/theme/tokens";
import { installSvgStubs } from "@/test/svgStubs";
import { CARD_ID_DEFINITION, type ModelElement } from "../exchange/exchangeModel";
import type { ElementType } from "../taxonomy/elements";
import type ArchimateElementFactory from "./ArchimateElementFactory";
import type ArchimateModeling from "./ArchimateModeling";
import { attr as svgAttr } from "tiny-svg";
import { wrapText } from "./ArchimateRenderer";
import { ARCHIMATE_MODULES } from "./modules";

beforeAll(installSvgStubs);

function setup() {
  const container = document.createElement("div");
  const diagram = new Diagram({ canvas: { container }, modules: ARCHIMATE_MODULES });
  const factory = diagram.get<ArchimateElementFactory>("elementFactory");
  const modeling = diagram.get<ArchimateModeling>("modeling");
  const canvas = diagram.get<Canvas>("canvas");
  const registry = diagram.get<ElementRegistry>("elementRegistry");
  const root = canvas.getRootElement();
  let x = 100;
  const add = (type: ElementType, attrs: Record<string, unknown> = {}, name = "") => {
    const shape = modeling.createShape(factory.createShape({ elementType: type, name, ...attrs }), { x: (x += 300), y: 100 }, root);
    return shape as Shape;
  };
  const gfx = (e: Shape | Connection) => registry.getGraphics(e) as SVGGElement;
  return { diagram, container, factory, modeling, canvas, registry, root, add, gfx };
}

/** diagram-js's tiny-svg sets the CSS-property attributes (fill, stroke, markers...) as inline style. */
const css = (el: Element | null | undefined, name: string): string | undefined =>
  el ? (svgAttr(el as SVGElement, name) as string) || undefined : undefined;

const NAME_LINES = (g: Element) => [...g.querySelectorAll("text.archimate-name tspan")].map((t) => t.textContent);

describe("ArchimateRenderer: shapes", () => {
  it("draws the body in the layer colours, the name and the glyph", () => {
    const { add, gfx } = setup();
    const shape = add("BusinessActor", {}, "Customer");
    const g = gfx(shape);
    const body = g.querySelector("path.archimate-body") as SVGPathElement;
    expect(css(body, "fill")).toBe(ARCHIMATE_LAYER_COLORS.business.fill);
    expect(css(body, "stroke")).toBe(ARCHIMATE_LAYER_COLORS.business.stroke);
    expect(body.getAttribute("d")).toBe("M0 0H120V55H0Z");
    expect(g.querySelector("text.archimate-name")?.textContent).toBe("Customer");
    expect(css(g.querySelector("text.archimate-name"), "fill")).toBe(ARCHIMATE_TEXT_COLOR);
    const glyph = g.querySelector("g.archimate-glyph") as SVGGElement;
    expect(glyph.getAttribute("transform")).toBe("translate(100, 4)");
    expect(css(glyph, "stroke")).toBe(ARCHIMATE_TEXT_COLOR);
    expect([...glyph.children].map((c) => c.tagName)).toEqual(["circle", "line", "line", "polyline"]);
  });

  it("draws no text for an empty name", () => {
    const { add, gfx } = setup();
    expect(gfx(add("BusinessActor")).querySelector("text")).toBeNull();
  });

  it("uses the node's own fill colour over the layer fill", () => {
    const { add, gfx } = setup();
    const shape = add("BusinessActor", { style: { fillColor: { r: 10, g: 20, b: 30 } } });
    expect(css(gfx(shape).querySelector("path.archimate-body"), "fill")).toBe("rgb(10, 20, 30)");
  });

  it("draws a badge at the bottom-right corner of a linked element only", () => {
    const { add, gfx, factory, modeling, root } = setup();
    const linked: ModelElement = {
      id: "id-l", type: "ApplicationComponent", name: "CRM", properties: [{ ref: CARD_ID_DEFINITION, value: "c1" }],
    };
    const shape = modeling.createShape(
      factory.createShape({ businessObject: linked, fromModel: true, id: "id-ls" }), { x: 100, y: 500 }, root,
    ) as Shape;
    const badge = gfx(shape).querySelector("circle.archimate-linked-badge");
    expect(badge).not.toBeNull();
    expect(badge!.getAttribute("cx")).toBe("114"); // 120 - radius 4 - 2
    expect(badge!.getAttribute("cy")).toBe("49"); // 55 - radius 4 - 2
    expect(badge!.getAttribute("r")).toBe("4");
    expect(css(badge!, "fill")).toBe(ARCHIMATE_LAYER_COLORS.application.stroke);
    expect(gfx(add("ApplicationComponent")).querySelector("circle.archimate-linked-badge")).toBeNull();
  });

  it("wraps a long name into tspans of at most floor((width-16)/6) characters, three lines at most", () => {
    const { add, gfx } = setup();
    const max = Math.floor((120 - 16) / 6);
    const name = "Customer relationship management platform for the whole enterprise group worldwide";
    const lines = NAME_LINES(gfx(add("BusinessActor", {}, name)));
    expect(lines).toEqual(["Customer", "relationship", "management…"]);
    for (const line of lines) expect(line!.length).toBeLessThanOrEqual(max);
    expect(lines[2]!.endsWith("…")).toBe(true);
    expect(NAME_LINES(gfx(add("BusinessActor", {}, "Short name")))).toEqual(["Short name"]);
  });

  it("draws a named element too narrow for any text (a 15x15 junction) without hanging", () => {
    const { add, gfx } = setup();
    const lines = NAME_LINES(gfx(add("AndJunction", {}, "Join")));
    expect(lines).toEqual(["J", "o", "…"]);
  });

  it("keeps the glyph of an ellipse inside its curve and draws none on a junction", () => {
    const { add, gfx } = setup();
    expect(gfx(add("Goal")).querySelector("g.archimate-glyph")?.getAttribute("transform")).toBe("translate(74, 4)");
    const and = gfx(add("AndJunction"));
    expect(and.querySelector("g.archimate-glyph")).toBeNull();
    expect(css(and.querySelector("path.archimate-body"), "fill")).toBe(ARCHIMATE_TEXT_COLOR);
    expect(css(gfx(add("OrJunction")).querySelector("path.archimate-body"), "fill")).toBe("white");
  });

  it("dashes a Grouping and nothing else", () => {
    const { add, gfx } = setup();
    expect(css(gfx(add("Grouping")).querySelector("path.archimate-body"), "stroke-dasharray")).toBe("6 4");
    for (const type of ["BusinessActor", "Goal", "Node", "BusinessProcess"] as const)
      expect(css(gfx(add(type)).querySelector("path.archimate-body"), "stroke-dasharray")).toBeUndefined();
  });

  it("draws the header band of a passive object and starts the name below it", () => {
    const { add, gfx } = setup();
    const g = gfx(add("DataObject", {}, "Orders"));
    const band = g.querySelector("rect.archimate-header") as SVGRectElement;
    expect(band.getAttribute("height")).toBe("22");
    expect(Number(g.querySelector("text tspan")!.getAttribute("y"))).toBeGreaterThan(22);
    expect(gfx(add("BusinessActor", {}, "x")).querySelector("rect.archimate-header")).toBeNull();
  });

  it("draws the inner lines of a 3D box and puts a Grouping's name under its tab", () => {
    const { add, gfx } = setup();
    expect(gfx(add("Node")).querySelectorAll("path.archimate-detail").length).toBe(1);
    expect(gfx(add("BusinessActor")).querySelectorAll("path.archimate-detail").length).toBe(0);
    const group = gfx(add("Grouping", {}, "Domain"));
    expect(Number(group.querySelector("text tspan")!.getAttribute("y"))).toBeLessThan(40);
  });

  it("does not draw selection or hover itself", () => {
    const { add, gfx } = setup();
    const g = gfx(add("BusinessActor", {}, "A"));
    expect(g.querySelector(".djs-outline, .archimate-selected, .archimate-hover")).toBeNull();
  });

  it("supplies the real outline to connection cropping: an ellipse polygon, not its box", () => {
    const { add, diagram } = setup();
    const goal = add("Goal");
    const factory = diagram.get<GraphicsFactory>("graphicsFactory");
    const box = factory.getShapePath(goal);
    expect(box.startsWith("M")).toBe(true);
    expect(box.startsWith(`M${goal.x + goal.width / 2} ${goal.y}`)).toBe(true);
    expect(box).not.toMatch(/[CAHV]/);
  });

  it("returns the junction's circle as the shape path", () => {
    const { add, diagram } = setup();
    const junction = add("AndJunction");
    const path = diagram.get<GraphicsFactory>("graphicsFactory").getShapePath(junction);
    const v = (path.match(/\d+(\.\d+)?/g) ?? []).map(Number);
    const xs = v.filter((_, i) => i % 2 === 0);
    const ys = v.filter((_, i) => i % 2 === 1);
    expect(Math.min(...xs)).toBe(junction.x);
    expect(Math.max(...xs)).toBe(junction.x + 15);
    expect(Math.min(...ys)).toBe(junction.y);
    expect(Math.max(...ys)).toBe(junction.y + 15);
    // every point lies on the circle
    for (let i = 0; i < xs.length; i++)
      expect(Math.hypot(xs[i] - (junction.x + 7.5), ys[i] - (junction.y + 7.5))).toBeCloseTo(7.5, 0);
  });
});

describe("ArchimateRenderer: connections", () => {
  function twoElements() {
    const s = setup();
    const a = s.add("BusinessActor");
    const b = s.add("BusinessProcess");
    return { ...s, a, b };
  }

  it("draws Serving with an open arrow at the end and no dash", () => {
    const { modeling, a, b, gfx, container } = twoElements();
    const conn = modeling.connect(a, b, { relationship: "Serving" }) as Connection;
    const path = gfx(conn).querySelector("path.archimate-line") as SVGPathElement;
    expect(css(path, "stroke")).toBe(ARCHIMATE_TEXT_COLOR);
    expect(css(path, "stroke-dasharray")).toBeFalsy();
    expect(css(path, "marker-start")).toBeFalsy();
    const ref = /url\(["']?#(.+?)["']?\)/.exec(css(path, "marker-end")!)![1];
    expect(ref).toContain("arrow-open");
    expect(container.querySelector(`defs marker[id="${ref}"]`)).not.toBeNull();
  });

  it("dashes a Flow connection and gives Composition a start marker only", () => {
    const { modeling, a, b, gfx } = twoElements();
    const flow = modeling.connect(a, b, { relationship: "Flow" }) as Connection;
    expect(css(gfx(flow).querySelector("path.archimate-line"), "stroke-dasharray")).toBe("6 4");
    const comp = modeling.connect(a, b, { relationship: "Composition" }) as Connection;
    const p = gfx(comp).querySelector("path.archimate-line")!;
    expect(css(p, "marker-start")).toContain("diamond-filled");
    expect(css(p, "marker-end")).toBeFalsy();
  });

  it("draws an Access without accessType as Write (the XSD default), and keeps the data unchanged", () => {
    const { modeling, a, b, gfx } = twoElements();
    const conn = modeling.connect(a, b, { relationship: "Access" }) as Connection;
    const p = gfx(conn).querySelector("path.archimate-line")!;
    expect(css(p, "marker-start")).toContain("arrow-open");
    expect(css(p, "marker-end")).toBeFalsy();
    expect(conn.businessObject).not.toHaveProperty("accessType");
    const plain = modeling.connect(a, b, { relationship: "Access", accessType: "Access" }) as Connection;
    const q = gfx(plain).querySelector("path.archimate-line")!;
    expect(css(q, "marker-start")).toBeFalsy();
    expect(css(q, "marker-end")).toBeFalsy();
    const read = modeling.connect(a, b, { relationship: "Access", accessType: "Read" }) as Connection;
    const r = gfx(read).querySelector("path.archimate-line")!;
    expect(css(r, "marker-start")).toBeFalsy();
    expect(css(r, "marker-end")).toContain("arrow-open");
  });

  it("uses the access type of an Access connection", () => {
    const { modeling, a, b, gfx } = twoElements();
    const conn = modeling.connect(a, b, { relationship: "Access", accessType: "ReadWrite" }) as Connection;
    const p = gfx(conn).querySelector("path.archimate-line")!;
    expect(css(p, "stroke-dasharray")).toBe("2 3");
    expect(css(p, "marker-start")).toContain("arrow-open");
    expect(css(p, "marker-end")).toContain("arrow-open");
  });

  it("creates each marker once per diagram", () => {
    const { modeling, a, b, container } = twoElements();
    modeling.connect(a, b, { relationship: "Serving" });
    modeling.connect(a, b, { relationship: "Serving" });
    modeling.connect(b, a, { relationship: "Triggering" });
    modeling.connect(b, a, { relationship: "Flow" });
    const ids = [...container.querySelectorAll("marker")].map((m) => m.id);
    expect(ids.sort()).toEqual(["archimate-marker-arrow-filled", "archimate-marker-arrow-open"]);
    expect(container.querySelectorAll("defs.archimate-defs")).toHaveLength(1);
    expect(container.querySelector("marker")?.getAttribute("viewBox")).toBe("0 0 10 10");
  });

  it("draws the name at the midpoint of the waypoints", () => {
    const { modeling, a, b, gfx } = twoElements();
    const conn = modeling.connect(a, b, {
      relationship: "Serving", waypoints: [{ x: 100, y: 100 }, { x: 160, y: 100 }, { x: 160, y: 200 }, { x: 260, y: 200 }],
    }) as Connection;
    modeling.updateProperties(conn, { name: "uses" });
    const text = gfx(conn).querySelector("text.archimate-name") as SVGTextElement;
    expect(text.textContent).toBe("uses");
    // total length 60 + 100 + 100 = 260, half = 130: 70 along the second leg -> (160, 170)
    expect(text.getAttribute("x")).toBe("160");
    expect(text.getAttribute("y")).toBe("170");
  });

  it("draws no name text for an unnamed connection", () => {
    const { modeling, a, b, gfx } = twoElements();
    const conn = modeling.connect(a, b, { relationship: "Serving" }) as Connection;
    expect(gfx(conn).querySelector("text")).toBeNull();
  });
});

describe("wrapText", () => {
  it("wraps on words, splits a word longer than a line, and truncates after the last line", () => {
    expect(wrapText("a b c", 10)).toEqual(["a b c"]);
    expect(wrapText("aaa bbb ccc", 7)).toEqual(["aaa bbb", "ccc"]);
    expect(wrapText("abcdefghij", 4)).toEqual(["abcd", "efgh", "ij"]);
    expect(wrapText("aaaa bbbb cccc dddd", 4)).toEqual(["aaaa", "bbbb", "ccc…"]);
    expect(wrapText("aaaa bbbb cccc dd", 5, 2)).toEqual(["aaaa", "bbbb…"]);
    expect(wrapText("  ", 5)).toEqual([]);
    expect(wrapText("abc", 0)).toEqual(["a", "b", "c"]);
    expect(wrapText("abc", -3)).toEqual(["a", "b", "c"]);
    expect(wrapText("abcd", 0)).toEqual(["a", "b", "…"]); // one char per line leaves no room for the ellipsis
  });
});
