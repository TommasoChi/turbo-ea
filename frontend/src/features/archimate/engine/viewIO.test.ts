import Diagram from "diagram-js";
import type { Connection, Shape } from "diagram-js/lib/model/Types";
import { MODEL } from "@/test/archimateModel";
import { installSvgStubs } from "@/test/svgStubs";
import type { ArchimateModel } from "../exchange/exchangeModel";
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
      id: "id-m", name: "M", propertyDefinitions: [],
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
