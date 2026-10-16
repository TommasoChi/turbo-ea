import type CommandStack from "diagram-js/lib/command/CommandStack";
import type Canvas from "diagram-js/lib/core/Canvas";
import type ElementRegistry from "diagram-js/lib/core/ElementRegistry";
import type EventBus from "diagram-js/lib/core/EventBus";
import type CopyPaste from "diagram-js/lib/features/copy-paste/CopyPaste";
import type Create from "diagram-js/lib/features/create/Create";
import type Dragging from "diagram-js/lib/features/dragging/Dragging";
import type Keyboard from "diagram-js/lib/features/keyboard/Keyboard";
import type Selection from "diagram-js/lib/features/selection/Selection";
import type { Connection, Element, Shape } from "diagram-js/lib/model/Types";
import type DirectEditing from "diagram-js-direct-editing/lib/DirectEditing";
import { makeBridge } from "@/test/archimateBridge";
import { installSvgStubs } from "@/test/svgStubs";
import { CARD_ID_DEFINITION, getCardId, type ArchimateModel, type ModelElement } from "../exchange/exchangeModel";
import type { ElementType } from "../taxonomy/elements";
import type ArchimateElementFactory from "./ArchimateElementFactory";
import { ArchimateEngine } from "./ArchimateEngine";
import type ArchimateLabelEditing from "./ArchimateLabelEditing";
import { getLabelBounds } from "./ArchimateLabelEditing";
import type ArchimateModeling from "./ArchimateModeling";

beforeAll(() => {
  installSvgStubs();
  // jsdom has no hit testing; diagram-js's HoverFix asks for the element under the pointer while dragging.
  document.elementFromPoint = () => null;
});

const MODEL: ArchimateModel = {
  id: "m", name: "M",
  propertyDefinitions: [{ id: CARD_ID_DEFINITION, name: "turboea:cardId", type: "string" }],
  elements: [
    { id: "e-ceo", type: "BusinessActor", name: "CEO", properties: [{ ref: CARD_ID_DEFINITION, value: "c9" }] },
    { id: "e-role", type: "BusinessRole", name: "Chair", properties: [] },
  ],
  relationships: [{ id: "r1", type: "Assignment", source: "e-ceo", target: "e-role", properties: [] }],
  views: [{
    id: "v", name: "V",
    nodes: [
      { id: "n-ceo", elementRef: "e-ceo", x: 100, y: 100, width: 120, height: 55, parent: null },
      { id: "n-role", elementRef: "e-role", x: 400, y: 100, width: 120, height: 55, parent: null },
    ],
    connections: [{ id: "c-1", relationshipRef: "r1", source: "n-ceo", target: "n-role", bendpoints: [] }],
  }],
};

function setup() {
  const container = document.createElement("div");
  const engine = new ArchimateEngine({ container, bridge: makeBridge() });
  engine.load(MODEL);
  const get = <T,>(name: string) => (engine as unknown as { diagram: { get(n: string): T } }).diagram.get(name);
  const registry = get<ElementRegistry>("elementRegistry");
  const ceo = registry.get("n-ceo") as Shape;
  const stack = get<CommandStack>("commandStack") as unknown as { _stack: unknown[] };
  const provider = get<ArchimateLabelEditing>("archimateLabelEditing");
  const directEditing = get<DirectEditing>("directEditing");
  const activate = vi.spyOn(directEditing, "activate");
  /** A keydown on the node diagram-js's Keyboard listens on (the canvas <svg>, focusable). */
  const press = (key: string, init: KeyboardEventInit = {}) =>
    get<Keyboard>("keyboard").getBinding().dispatchEvent(
      new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init }),
    );
  const shapesOf = (type: string) =>
    registry.filter((e) => !(e as Connection).waypoints && (e.businessObject as ModelElement | undefined)?.type === type) as Shape[];
  const root = get<Canvas>("canvas").getRootElement();
  /** The real Create + Dragging gesture the palette's mouse path starts, released over `over`. */
  const drop = (elementType: ElementType, hints: object = {}, over: Element = root) => {
    const dragging = get<Dragging>("dragging");
    const shape = get<ArchimateElementFactory>("elementFactory").createShape({ elementType });
    get<Create>("create").start(new MouseEvent("mousedown", { clientX: 10, clientY: 10 }), shape, { hints });
    dragging.hover({ element: over, gfx: registry.getGraphics(over) });
    dragging.move(new MouseEvent("mousemove", { clientX: 600, clientY: 400 }));
    dragging.end(new MouseEvent("mouseup", { clientX: 600, clientY: 400 }));
  };
  /** Enter on a palette entry: the keyboard drop. */
  const keyboardDrop = (elementType: ElementType) =>
    container.querySelector<HTMLElement>(`[data-action="create.${elementType}"]`)!
      .dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
  const add = (elementType: ElementType) =>
    get<ArchimateModeling>("modeling").createShape(
      get<ArchimateElementFactory>("elementFactory").createShape({ elementType }), { x: 700, y: 300 }, root,
    ) as Shape;
  return {
    container, engine, get, registry, ceo, stack, provider, directEditing, activate, press, shapesOf, drop, keyboardDrop, add,
  };
}

describe("ArchimateLabelEditing provider", () => {
  it("activates on an element with its name and the shape's own bounds", () => {
    const { provider, ceo } = setup();
    expect(provider.activate(ceo)).toEqual({
      text: "CEO", bounds: { x: 100, y: 100, width: 120, height: 55 }, options: { autoResize: false },
    });
  });

  it("activates on a connection with a 120x24 box centred on its midpoint", () => {
    const { provider, registry } = setup();
    const connection = registry.get("c-1") as Connection;
    connection.waypoints = [{ x: 0, y: 0 }, { x: 200, y: 100 }];
    expect(provider.activate(connection)).toEqual({
      text: "", bounds: { x: 40, y: 38, width: 120, height: 24 }, options: { autoResize: false },
    });
  });

  it("places the box in viewport coordinates at zoom 2 with a scrolled canvas", () => {
    const { get, ceo, registry } = setup();
    const canvas = get<Canvas>("canvas");
    canvas.viewbox({ x: 50, y: 20, width: 400, height: 300 }); // the 800x600 container: scale 2
    expect(canvas.viewbox().scale).toBe(2);
    expect(getLabelBounds(canvas, ceo)).toEqual({ x: 100, y: 160, width: 240, height: 110 });
    const connection = registry.get("c-1") as Connection;
    // Odd count: the middle waypoint (100,60) -> viewport (100,80).
    connection.waypoints = [{ x: 0, y: 0 }, { x: 100, y: 60 }, { x: 300, y: 100 }];
    expect(getLabelBounds(canvas, connection)).toEqual({ x: 40, y: 68, width: 120, height: 24 });
    // Even count: the middle segment's midpoint (150,60) -> viewport (200,80).
    connection.waypoints = [{ x: 0, y: 0 }, { x: 100, y: 40 }, { x: 200, y: 80 }, { x: 300, y: 0 }];
    expect(getLabelBounds(canvas, connection)).toEqual({ x: 140, y: 68, width: 120, height: 24 });
  });

  it("names a connection through the command stack (undo restores it)", () => {
    const { provider, registry, engine } = setup();
    const connection = registry.get("c-1") as Connection;
    provider.update(connection, " holds ");
    expect(connection.businessObject.name).toBe("holds");
    engine.undo();
    expect(connection.businessObject.name).toBeUndefined();
  });

  it("does not activate on the root", () => {
    const { provider, get } = setup();
    expect(provider.activate(get<Canvas>("canvas").getRootElement())).toBeNull();
  });

  it("updates the trimmed name through the command stack (undo restores it)", () => {
    const { provider, ceo, engine } = setup();
    provider.update(ceo, "  Boss  ");
    expect(ceo.businessObject.name).toBe("Boss");
    engine.undo();
    expect(ceo.businessObject.name).toBe("CEO");
  });

  it("pushes no command when the trimmed text is unchanged", () => {
    const { provider, ceo, stack } = setup();
    const before = stack._stack.length;
    provider.update(ceo, "CEO");
    provider.update(ceo, " CEO ");
    expect(stack._stack.length).toBe(before);
  });

  it("clears the name with an empty text", () => {
    const { provider, ceo } = setup();
    provider.update(ceo, "");
    expect(ceo.businessObject.name).toBe("");
  });
});

describe("ArchimateLabelEditing wiring", () => {
  it("starts editing on a double-click", () => {
    const { get, ceo, activate, directEditing } = setup();
    get<EventBus>("eventBus").fire("element.dblclick", { element: ceo });
    expect(activate).toHaveBeenCalledTimes(1);
    expect(activate).toHaveBeenCalledWith(ceo);
    expect(directEditing.isActive(ceo)).toBe(true);
  });

  it("starts editing an element created from the palette (create.end), not a pasted one", () => {
    const { drop, activate, shapesOf } = setup();
    drop("Node");
    const [created] = shapesOf("Node");
    expect(created).toBeDefined();
    expect(activate).toHaveBeenCalledTimes(1);
    expect(activate).toHaveBeenCalledWith(created);
    drop("Node", { createElementsBehavior: false }); // what CopyPaste sets on a paste
    expect(shapesOf("Node")).toHaveLength(2);
    expect(activate).toHaveBeenCalledTimes(1);
  });

  it("does not start editing when the drop is refused (canExecute false: released over a junction)", () => {
    const { drop, add, activate, shapesOf, directEditing } = setup();
    const junction = add("AndJunction");
    drop("Node", {}, junction);
    expect(shapesOf("Node")).toHaveLength(0);
    expect(activate).not.toHaveBeenCalled();
    expect(directEditing.isActive()).toBe(false);
  });

  it("starts editing an element dropped with the palette keyboard", () => {
    const { keyboardDrop, activate, shapesOf, directEditing } = setup();
    keyboardDrop("Node");
    const [created] = shapesOf("Node");
    expect(activate).toHaveBeenCalledWith(created);
    expect(directEditing.isActive(created)).toBe(true);
  });

  it("never opens an edit box on a junction (palette drop, keyboard drop, double-click, Enter)", () => {
    const { provider, drop, keyboardDrop, shapesOf, get, press, directEditing } = setup();
    drop("AndJunction");
    expect(shapesOf("AndJunction")).toHaveLength(1);
    expect(directEditing.isActive()).toBe(false);
    keyboardDrop("OrJunction");
    const [junction] = shapesOf("OrJunction");
    expect(junction).toBeDefined();
    expect(directEditing.isActive()).toBe(false);
    expect(provider.activate(junction)).toBeNull();
    get<EventBus>("eventBus").fire("element.dblclick", { element: junction });
    expect(directEditing.isActive()).toBe(false);
    get<Selection>("selection").select(junction);
    press("Enter");
    expect(directEditing.isActive()).toBe(false);
  });

  it("never starts editing on an import", () => {
    const { engine, activate } = setup();
    engine.load(MODEL);
    expect(activate).not.toHaveBeenCalled();
  });

  it.each(["F2", "Enter"])("%s edits the single selected element", (key) => {
    const { get, ceo, registry, activate, press } = setup();
    get<Selection>("selection").select([ceo, registry.get("n-role")!]);
    press(key);
    expect(activate).not.toHaveBeenCalled();
    get<Selection>("selection").select(ceo);
    press(key);
    expect(activate).toHaveBeenCalledWith(ceo);
  });
});

describe("keyboard shortcuts (bound to the canvas)", () => {
  it("Delete removes the selected shape", () => {
    const { get, ceo, registry, press } = setup();
    get<Selection>("selection").select(ceo);
    press("Delete");
    expect(registry.get("n-ceo")).toBeUndefined();
  });

  it("Ctrl+Z after a name edit restores the name", () => {
    const { provider, ceo, press } = setup();
    provider.update(ceo, "Boss");
    press("z", { ctrlKey: true });
    expect(ceo.businessObject.name).toBe("CEO");
  });

  it("Ctrl+A selects every element and connection", () => {
    const { get, press } = setup();
    press("a", { ctrlKey: true });
    expect(get<Selection>("selection").get().map((e) => e.id).sort()).toEqual(["c-1", "n-ceo", "n-role"]);
  });

  it("Ctrl+0 fits the drawing in the viewport", () => {
    const { get, press } = setup();
    const zoom = vi.spyOn(get<Canvas>("canvas"), "zoom");
    press("0", { ctrlKey: true });
    expect(zoom).toHaveBeenCalledTimes(1);
    expect(zoom).toHaveBeenCalledWith("fit-viewport", "auto");
  });
});

describe("copy and paste", () => {
  it("pastes a new, unlinked element with new identifiers; the original keeps its card link", () => {
    const { get, ceo, shapesOf } = setup();
    const copyPaste = get<CopyPaste>("copyPaste");
    copyPaste.copy([ceo]);
    copyPaste.paste({ element: get<Canvas>("canvas").getRootElement() as Shape, point: { x: 600, y: 400 } });
    const actors = shapesOf("BusinessActor");
    expect(actors).toHaveLength(2);
    const pasted = actors.find((s) => s !== ceo)!;
    expect(pasted.id).not.toBe("n-ceo");
    expect(pasted.businessObject.id).not.toBe("e-ceo");
    expect(pasted.businessObject.name).toBe("CEO");
    expect(getCardId(pasted.businessObject)).toBeNull();
    expect(getCardId(ceo.businessObject)).toBe("c9");
  });
});
