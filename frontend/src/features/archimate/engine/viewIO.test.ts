import Diagram from "diagram-js";
import type { Connection, Shape } from "diagram-js/lib/model/Types";
import { MODEL } from "@/test/archimateModel";
import { installSvgStubs } from "@/test/svgStubs";
import { isNoteObject, type ArchimateModel } from "../exchange/exchangeModel";
import { ARCHIMATE_BASE_MODULES } from "./modules";
import { extractEdited, importView, type ViewServices } from "./viewIO";

beforeAll(installSvgStubs);

function services(): ViewServices {
  const diagram = new Diagram({ canvas: { container: document.createElement("div") }, modules: ARCHIMATE_BASE_MODULES });
  return {
    canvas: diagram.get("canvas"),
    elementFactory: diagram.get("elementFactory"),
    elementRegistry: diagram.get("elementRegistry"),
    connectionDocking: diagram.get("connectionDocking"),
  };
}

describe("importView", () => {
  it("draws one shape per node, nested in its parent, and the connections with their bendpoints", () => {
    const s = services();
    const model = structuredClone(MODEL);
    importView(s, model, model.views[0]);
    const get = (id: string) => s.elementRegistry.get(id) as Shape;
    expect(s.elementRegistry.filter((e) => !!e.businessObject && !e.waypoints)).toHaveLength(3);
    const group = get("id-g1"), data = get("id-n2");
    expect(data.parent).toBe(group);
    expect(data).toMatchObject({ x: 130, y: 140, width: 120, height: 55 });
    expect(data.businessObject).toBe(model.elements[2]);
    const conn = s.elementRegistry.get("id-c1") as Connection;
    expect(conn.source).toBe(get("id-n1"));
    expect(conn.target).toBe(data);
    expect(conn.businessObject).toBe(model.relationships[1]);
    expect(conn.waypoints.slice(1, -1).map(({ x, y }) => ({ x, y }))).toEqual([{ x: 70, y: 150 }, { x: 120, y: 160 }]);
  });

  it("skips a node whose element is missing, and draws a connection that ends on a connection", () => {
    const s = services();
    const model: ArchimateModel = {
      id: "id-m", name: "M", propertyDefinitions: [], properties: [],
      elements: ["a", "b", "c"].map((id) => ({ id, type: "BusinessActor", name: id, properties: [] })),
      relationships: [
        { id: "r1", type: "Association", source: "a", target: "b", properties: [] },
        { id: "r2", type: "Association", source: "c", target: "r1", properties: [] },
      ],
      views: [{
        id: "v", name: "V",
        nodes: [
          { id: "na", elementRef: "a", x: 0, y: 0, width: 120, height: 55, parent: null },
          { id: "nb", elementRef: "b", x: 300, y: 0, width: 120, height: 55, parent: null },
          { id: "nc", elementRef: "c", x: 150, y: 200, width: 120, height: 55, parent: null },
          { id: "ghost", elementRef: "missing", x: 0, y: 0, width: 10, height: 10, parent: null },
        ],
        // Listed before the connection it ends on.
        connections: [
          { id: "c2", relationshipRef: "r2", source: "nc", target: "c1", bendpoints: [] },
          { id: "c1", relationshipRef: "r1", source: "na", target: "nb", bendpoints: [] },
        ],
        notes: [],
      }],
    };
    importView(s, model, model.views[0]);
    expect(s.elementRegistry.get("ghost")).toBeUndefined();
    expect((s.elementRegistry.get("c2") as Connection).target).toBe(s.elementRegistry.get("c1"));
    const out = extractEdited(s, model.views[0]);
    expect(out.view.nodes.map((n) => n.id)).toEqual(["na", "nb", "nc"]);
    expect(out.view.connections).toEqual(model.views[0].connections);
    expect(out.relationships.map((r) => r.id)).toEqual(["r2", "r1"]);
  });
});

describe("extractEdited", () => {
  it("reads back the view, its elements and relationships, keeping the view's own fields and node styles", () => {
    const s = services();
    const model = structuredClone(MODEL);
    model.views[0].documentation = "View doc";
    model.views[0].nodes[0].style = { fillColor: { r: 1, g: 2, b: 3 } };
    importView(s, model, model.views[0]);
    expect((s.elementRegistry.get(model.views[0].nodes[0].id) as Shape & { style?: unknown }).style).toEqual({ fillColor: { r: 1, g: 2, b: 3 } });
    expect((s.elementRegistry.get(model.views[0].nodes[1].id) as Shape & { style?: unknown }).style).toBeUndefined();
    const out = extractEdited(s, model.views[0]);
    expect(out.view).toEqual(model.views[0]);
    expect(out.elements.map((e) => e.id)).toEqual(["id-app", "id-group", "id-data"]);
    expect(out.relationships).toEqual([model.relationships[1]]);
  });

  it("rounds geometry and reports a top-level node with a null parent", () => {
    const s = services();
    const model = structuredClone(MODEL);
    importView(s, model, model.views[0]);
    const shape = s.elementRegistry.get("id-n1") as Shape;
    shape.x = 10.4;
    shape.y = 19.6;
    expect(extractEdited(s, model.views[0]).view.nodes[0]).toMatchObject({ x: 10, y: 20, parent: null });
  });
});

describe("importView / extractEdited: notes", () => {
  it("draws a top-level note and one nested under an element, never as an element", () => {
    const s = services();
    const model = structuredClone(MODEL);
    model.views[0].notes = [
      { id: "id-note1", text: "Top level", x: 500, y: 20, width: 140, height: 90, parent: null },
      { id: "id-note2", text: "Inside the group", x: 150, y: 160, width: 100, height: 60, parent: "id-g1" },
    ];
    importView(s, model, model.views[0]);
    const top = s.elementRegistry.get("id-note1") as Shape;
    const nested = s.elementRegistry.get("id-note2") as Shape;
    expect(top.parent).toBe(s.canvas.getRootElement());
    expect(nested.parent).toBe(s.elementRegistry.get("id-g1"));
    expect(top.businessObject).toEqual({ id: "id-note1", isNote: true, name: "Top level" });
    expect(isNoteObject(top.businessObject)).toBe(true);
    expect(s.elementRegistry.filter((e) => !e.waypoints && e.businessObject?.type)).toHaveLength(3); // the 3 ModelElement shapes only
  });

  it("falls back to the canvas root for a dangling parent", () => {
    const s = services();
    const model = structuredClone(MODEL);
    model.views[0].notes = [{ id: "id-note1", text: "x", x: 0, y: 0, width: 10, height: 10, parent: "does-not-exist" }];
    importView(s, model, model.views[0]);
    expect((s.elementRegistry.get("id-note1") as Shape).parent).toBe(s.canvas.getRootElement());
  });

  it("extractEdited reads notes back, never into elements or nodes, geometry rounded", () => {
    const s = services();
    const model = structuredClone(MODEL);
    model.views[0].notes = [{ id: "id-note1", text: "x", x: 500, y: 20, width: 140, height: 90, parent: "id-g1" }];
    importView(s, model, model.views[0]);
    const note = s.elementRegistry.get("id-note1") as Shape;
    note.x = 500.4;
    note.y = 19.6;
    const out = extractEdited(s, model.views[0]);
    expect(out.view.notes).toEqual([{ id: "id-note1", text: "x", x: 500, y: 20, width: 140, height: 90, parent: "id-g1" }]);
    expect(out.elements.some((e) => e.id === "id-note1")).toBe(false);
    expect(out.view.nodes.some((n) => n.id === "id-note1")).toBe(false);
  });

  it("keeps an existing note's position stable across saves (the base view's order), new ones last", () => {
    const s = services();
    const model = structuredClone(MODEL);
    model.views[0].notes = [
      { id: "id-note1", text: "first", x: 500, y: 20, width: 140, height: 90, parent: null },
      { id: "id-note2", text: "second", x: 500, y: 200, width: 140, height: 90, parent: null },
    ];
    importView(s, model, model.views[0]);
    const extra = s.elementFactory.createShape({ isNote: true, x: 10, y: 10, width: 10, height: 10 });
    s.canvas.addShape(extra, s.canvas.getRootElement());
    const ids = extractEdited(s, model.views[0]).view.notes.map((n) => n.id);
    expect(ids).toEqual(["id-note1", "id-note2", extra.id]);
  });
});
