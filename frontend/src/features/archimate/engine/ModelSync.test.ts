import Diagram from "diagram-js";
import type CommandStack from "diagram-js/lib/command/CommandStack";
import type Canvas from "diagram-js/lib/core/Canvas";
import type ElementRegistry from "diagram-js/lib/core/ElementRegistry";
import type { Connection, Shape } from "diagram-js/lib/model/Types";
import type { ElementType } from "../taxonomy/elements";
import { withBridge } from "@/test/archimateBridge";
import { installSvgStubs } from "@/test/svgStubs";
import type ArchimateElementFactory from "./ArchimateElementFactory";
import type ArchimateModeling from "./ArchimateModeling";

beforeAll(installSvgStubs);

function setup() {
  const container = document.createElement("div");
  const diagram = new Diagram({ canvas: { container }, modules: withBridge() });
  const modeling = diagram.get<ArchimateModeling>("modeling");
  const factory = diagram.get<ArchimateElementFactory>("elementFactory");
  const root = diagram.get<Canvas>("canvas").getRootElement();
  const add = (x: number, elementType: ElementType = "BusinessActor") =>
    modeling.createShape(factory.createShape({ elementType }), { x, y: 100 }, root) as Shape;
  return {
    modeling, add, a: add(100), b: add(400), c: add(700),
    registry: diagram.get<ElementRegistry>("elementRegistry"),
    commandStack: diagram.get<CommandStack>("commandStack"),
  };
}

describe("ModelSync", () => {
  it("keeps the relationship endpoints equal to the connected elements", () => {
    const { modeling, a, b, c, commandStack } = setup();
    const conn = modeling.connect(a, b, { relationship: "Assignment" }) as Connection;
    expect(conn.businessObject).toMatchObject({ type: "Assignment", source: a.businessObject.id, target: b.businessObject.id });
    modeling.reconnectEnd(conn, c, { x: 760, y: 127 });
    expect(conn.businessObject.target).toBe(c.businessObject.id);
    commandStack.undo();
    expect(conn.businessObject.target).toBe(b.businessObject.id);
    commandStack.redo();
    expect(conn.businessObject.target).toBe(c.businessObject.id);
  });

  it("crops a new connection at the outlines and keeps its bendpoints when an end moves", () => {
    const { modeling, a, b } = setup();
    // a is centred on (100, 100): 120 x 55, so its bottom edge is y = 127.5.
    const conn = modeling.connect(a, b, {
      relationship: "Assignment", waypoints: [{ x: 100, y: 100 }, { x: 300, y: 300 }, { x: 400, y: 100 }],
    }) as Connection;
    // (the docking rounds the intersection to whole pixels)
    expect(conn.waypoints[0]).toMatchObject({ x: 127, y: 127 });
    expect(conn.waypoints[1]).toEqual({ x: 300, y: 300 });
    modeling.moveShape(a, { x: 0, y: -50 });
    expect(conn.waypoints).toHaveLength(3);
    expect(conn.waypoints[1]).toMatchObject({ x: 300, y: 300 });
    expect(conn.waypoints[0]).toMatchObject({ x: 122, y: 77 });
  });

  it("crops at the real outline of the shape: an ellipse is cut earlier than its box", () => {
    const { modeling, add, b } = setup();
    const value = add(1000, "Value"); // 120 x 55 around (1000, 100)
    const conn = modeling.connect(value, b, {
      relationship: "Influence", waypoints: [{ x: 1000, y: 100 }, { x: 1200, y: 300 }, { x: 400, y: 100 }],
    }) as Connection;
    // on the diagonal the ellipse x^2/60^2 + y^2/27.5^2 = 1 is met 25 px from the centre (the box would give 27.5)
    const [{ x, y }] = conn.waypoints;
    expect(x - 1000).toBeCloseTo(25, 0);
    expect(y - 100).toBeCloseTo(25, 0);
    expect(x - 1000).toBeLessThan(27);
  });

  it("removes the connections of a deleted shape", () => {
    const { modeling, a, b, registry } = setup();
    const conn = modeling.connect(a, b, { relationship: "Assignment" }) as Connection;
    modeling.removeElements([a]);
    expect(registry.get(conn.id)).toBeUndefined();
    expect(registry.get(b.id)).toBe(b);
  });
});
