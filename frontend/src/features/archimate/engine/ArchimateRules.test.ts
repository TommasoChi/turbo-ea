import Diagram from "diagram-js";
import type Canvas from "diagram-js/lib/core/Canvas";
import type ElementRegistry from "diagram-js/lib/core/ElementRegistry";
import type EventBus from "diagram-js/lib/core/EventBus";
import type Connect from "diagram-js/lib/features/connect/Connect";
import type Dragging from "diagram-js/lib/features/dragging/Dragging";
import type Rules from "diagram-js/lib/features/rules/Rules";
import type { Connection, Shape } from "diagram-js/lib/model/Types";
import { installSvgStubs } from "@/test/svgStubs";
import type { ElementType } from "../taxonomy/elements";
import { isRelationshipAllowed } from "../taxonomy/relationships";
import type ArchimateElementFactory from "./ArchimateElementFactory";
import type ArchimateModeling from "./ArchimateModeling";
import { canNestIn, connectionAttrs, MIN_SIZE } from "./ArchimateRules";
import { ARCHIMATE_MODULES } from "./modules";
import type { RelationshipTool } from "./RelationshipTool";

beforeAll(() => {
  installSvgStubs();
  // jsdom has no hit testing; diagram-js's HoverFix asks for the element under the pointer while dragging.
  document.elementFromPoint = () => null;
});

const NO_TOOL = { current: null, accessType: null } as const;

describe("connectionAttrs", () => {
  it("returns the selected relationship when the matrix allows it", () => {
    expect(connectionAttrs("BusinessActor", "BusinessProcess", { current: "Assignment", accessType: null })).toEqual({
      relationship: "Assignment",
    });
  });

  it("carries the access type of an Access relationship, defaulting to Access", () => {
    expect(connectionAttrs("BusinessProcess", "DataObject", { current: "Access", accessType: "Read" })).toEqual({
      relationship: "Access", accessType: "Read",
    });
    expect(connectionAttrs("BusinessProcess", "DataObject", { current: "Access", accessType: null })).toEqual({
      relationship: "Access", accessType: "Access",
    });
  });

  it("never gives another relationship an access type", () => {
    const attrs = connectionAttrs("BusinessService", "BusinessActor", { current: "Serving", accessType: "Write" });
    expect(attrs).toEqual({ relationship: "Serving" });
    expect(attrs && "accessType" in attrs).toBe(false);
  });

  it("refuses without a selected relationship or when the matrix forbids the pair", () => {
    expect(connectionAttrs("BusinessActor", "BusinessProcess", NO_TOOL)).toBe(false);
    expect(connectionAttrs("DataObject", "BusinessActor", { current: "Assignment", accessType: null })).toBe(false);
  });
});

describe("canNestIn", () => {
  it("allows the canvas root and every element but a junction", () => {
    expect(canNestIn(null)).toBe(true);
    expect(canNestIn("Grouping")).toBe(true);
    expect(canNestIn("BusinessActor")).toBe(true);
    expect(canNestIn("AndJunction")).toBe(false);
    expect(canNestIn("OrJunction")).toBe(false);
  });
});

describe("MIN_SIZE", () => {
  it("is the minimum shape size resizing must keep", () => {
    expect(MIN_SIZE).toEqual({ width: 30, height: 20 });
  });
});

function setup() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const diagram = new Diagram({ canvas: { container }, modules: ARCHIMATE_MODULES });
  const get = <T,>(name: string) => diagram.get<T>(name);
  const modeling = get<ArchimateModeling>("modeling");
  const factory = get<ElementFactoryLike>("elementFactory");
  const root = get<Canvas>("canvas").getRootElement();
  const add = (elementType: ElementType, x: number, y = 100) =>
    modeling.createShape(factory.createShape({ elementType }), { x, y }, root) as Shape;
  return {
    add, root, modeling, factory, get,
    rules: get<Rules>("rules"),
    tool: get<RelationshipTool>("relationshipTool"),
    eventBus: get<EventBus>("eventBus"),
    registry: get<ElementRegistry>("elementRegistry"),
    connections: () => get<ElementRegistry>("elementRegistry").filter((e) => !!(e as Connection).waypoints) as Connection[],
  };
}
type ElementFactoryLike = ArchimateElementFactory;

/** Drives the real Connect + Dragging services: mouse down on `start`, hover `over`, release. */
function gesture(env: ReturnType<typeof setup>, start: Shape, over: Shape) {
  const connect = env.get<Connect>("connect");
  const dragging = env.get<Dragging>("dragging");
  const down = new MouseEvent("mousedown", { clientX: 10, clientY: 10 });
  connect.start(down, start, true);
  dragging.hover({ element: over, gfx: env.get<ElementRegistry>("elementRegistry").getGraphics(over) });
  dragging.move(new MouseEvent("mousemove", { clientX: 200, clientY: 200 }));
  dragging.end(new MouseEvent("mouseup", { clientX: 200, clientY: 200 }));
}

describe("the connect gesture", () => {
  it("allows a connection between an allowed pair and answers with the attrs", () => {
    const env = setup();
    const service = env.add("BusinessService", 100);
    const actor = env.add("BusinessActor", 400);
    env.tool.set("Serving");
    expect(env.rules.allowed("connection.create", { source: service, target: actor })).toEqual({ relationship: "Serving" });
    expect(env.rules.allowed("connection.create", { source: service, target: service })).toBe(false);
  });

  it("creates one connection of the tool's type, then clears the tool", () => {
    const env = setup();
    const service = env.add("BusinessService", 100);
    const actor = env.add("BusinessActor", 400);
    env.tool.set("Serving");
    gesture(env, service, actor);
    const [only, ...rest] = env.connections();
    expect(rest).toHaveLength(0);
    expect(only.businessObject.type).toBe("Serving");
    expect(only.source).toBe(service);
    expect(only.target).toBe(actor);
    expect(env.tool.current).toBeNull();
  });

  it("creates an Access with the tool's access type", () => {
    const env = setup();
    const process = env.add("BusinessProcess", 100);
    const data = env.add("DataObject", 400);
    env.tool.set("Access", "Write");
    gesture(env, process, data);
    expect(env.connections().map((c) => [c.businessObject.type, c.businessObject.accessType])).toEqual([["Access", "Write"]]);
  });

  it("creates nothing for a pair the matrix forbids (either way), nor for a self-connection", () => {
    const env = setup();
    const data = env.add("DataObject", 100);
    const goal = env.add("Goal", 400);
    expect(isRelationshipAllowed("DataObject", "Goal", "Serving")).toBe(false);
    expect(isRelationshipAllowed("Goal", "DataObject", "Serving")).toBe(false);
    env.tool.set("Serving");
    gesture(env, data, goal);
    expect(env.connections()).toHaveLength(0);
    env.tool.set("Serving");
    gesture(env, data, data);
    expect(env.connections()).toHaveLength(0);
  });

  it("creates nothing while no relationship is selected", () => {
    const env = setup();
    const service = env.add("BusinessService", 100);
    const actor = env.add("BusinessActor", 400);
    gesture(env, service, actor);
    expect(env.connections()).toHaveLength(0);
  });

  it("allows a second relationship of the same type between the same pair", () => {
    const env = setup();
    const service = env.add("BusinessService", 100);
    const actor = env.add("BusinessActor", 400);
    for (let i = 0; i < 2; i++) {
      env.tool.set("Serving");
      gesture(env, service, actor);
    }
    expect(env.connections()).toHaveLength(2);
  });
});

describe("other rules", () => {
  it("refuses a connection end that is not an element shape", () => {
    const env = setup();
    const actor = env.add("BusinessActor", 100);
    env.tool.set("Association");
    expect(env.rules.allowed("connection.create", { source: actor, target: env.root })).toBe(false);
    expect(env.rules.allowed("connection.create", { source: actor, target: actor })).toBe(false);
  });

  it("re-checks the existing relationship type on reconnect", () => {
    const env = setup();
    const service = env.add("BusinessService", 100);
    const actor = env.add("BusinessActor", 400);
    const goal = env.add("Goal", 700);
    const conn = env.modeling.connect(service, actor, { relationship: "Serving" }) as Connection;
    expect(env.rules.allowed("connection.reconnect", { connection: conn, source: service, target: goal })).toBe(
      isRelationshipAllowed("BusinessService", "Goal", "Serving"),
    );
    expect(env.rules.allowed("connection.reconnect", { connection: conn, source: service, target: actor })).toBe(true);
    expect(env.rules.allowed("connection.reconnect", { connection: conn, source: service, target: service })).toBe(false);
  });

  it("refuses to drop a palette shape on a junction, allows the root and a group", () => {
    const env = setup();
    const junction = env.add("AndJunction", 100);
    const group = env.add("Grouping", 400);
    const shape = env.factory.createShape({ elementType: "BusinessActor" });
    const at = { x: 0, y: 0 };
    expect(env.rules.allowed("shape.create", { shape, target: junction, position: at })).toBe(false);
    expect(env.rules.allowed("shape.create", { shape, target: group, position: at })).toBe(true);
    expect(env.rules.allowed("shape.create", { shape, target: env.root, position: at })).toBe(true);
    expect(env.rules.allowed("elements.create", { elements: [shape], target: junction, position: at })).toBe(false);
  });

  it("refuses to move shapes onto a junction", () => {
    const env = setup();
    const junction = env.add("AndJunction", 100);
    const group = env.add("Grouping", 400);
    const actor = env.add("BusinessActor", 700);
    const move = (target: Shape) => env.rules.allowed("elements.move", { shapes: [actor], delta: { x: 1, y: 1 }, target });
    expect(move(junction)).toBe(false);
    expect(move(group)).toBe(true);
    expect(move(env.root as unknown as Shape)).toBe(true);
  });

  it("refuses to resize a junction only", () => {
    const env = setup();
    const junction = env.add("OrJunction", 100);
    const actor = env.add("BusinessActor", 400);
    expect(env.rules.allowed("shape.resize", { shape: junction })).toBe(false);
    expect(env.rules.allowed("shape.resize", { shape: actor })).toBe(true);
  });

  it("allows deleting and starting a connection", () => {
    const env = setup();
    const actor = env.add("BusinessActor", 100);
    expect(env.rules.allowed("elements.delete", { elements: [actor] })).toBe(true);
    expect(env.rules.allowed("connection.start", { source: actor })).toBe(true);
  });
});

describe("RelationshipTool", () => {
  it("stores the relationship and access type, and clears both", () => {
    const { tool } = setup();
    expect(tool.current).toBeNull();
    tool.set("Access", "Write");
    expect([tool.current, tool.accessType]).toEqual(["Access", "Write"]);
    tool.set("Serving");
    expect([tool.current, tool.accessType]).toEqual(["Serving", null]);
    tool.clear();
    expect([tool.current, tool.accessType]).toEqual([null, null]);
  });

  it("clears itself on connect.cleanup and connect.end", () => {
    const { tool, eventBus } = setup();
    for (const type of ["connect.cleanup", "connect.end"]) {
      tool.set("Flow");
      eventBus.fire(type, { context: {} });
      expect(tool.current).toBeNull();
    }
  });
});
