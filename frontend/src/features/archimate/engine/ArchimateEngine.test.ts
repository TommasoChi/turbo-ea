import type Modeling from "diagram-js/lib/features/modeling/Modeling";
import type Selection from "diagram-js/lib/features/selection/Selection";
import type ElementRegistry from "diagram-js/lib/core/ElementRegistry";
import type { Shape } from "diagram-js/lib/model/Types";
import { MODEL } from "@/test/archimateModel";
import { installSvgStubs } from "@/test/svgStubs";
import { CARD_ID_DEFINITION, getCardId, type ArchimateModel } from "../exchange/exchangeModel";
import { ArchimateEngine } from "./ArchimateEngine";
import type { EditorBridge } from "./EditorBridge";

beforeAll(installSvgStubs);

const bridge = {} as EditorBridge;
/** load() works on a copy: no edit may reach the shared fixture. */
const PRISTINE = structuredClone(MODEL);

function setup() {
  const container = document.createElement("div");
  const onChange = vi.fn();
  const engine = new ArchimateEngine({ container, bridge, onChange });
  engine.load(MODEL);
  // The services behind the facade, for driving the diagram the way a user would.
  const get = <T,>(name: string) => (engine as unknown as { diagram: { get(n: string): T } }).diagram.get(name);
  return { container, engine, onChange, get };
}

describe("ArchimateEngine", () => {
  it("round-trips the loaded model unchanged, without touching the caller's object", () => {
    const { engine, onChange } = setup();
    expect(engine.toModel()).toEqual(MODEL);
    expect(MODEL).toEqual(PRISTINE);
    expect(onChange).not.toHaveBeenCalled();
    expect(engine.canUndo()).toBe(false);
  });

  it("moves a node, and a parent's nested children, by the dragged delta", () => {
    const { engine, get } = setup();
    const shape = (id: string) => get<ElementRegistry>("elementRegistry").get(id) as Shape;
    get<Modeling>("modeling").moveShape(shape("id-g1"), { x: 10, y: 20 });
    const nodes = engine.toModel().views[0].nodes;
    expect(nodes.map((n) => [n.id, n.x, n.y])).toEqual([["id-n1", 10, 20], ["id-g1", 110, 120], ["id-n2", 140, 160]]);
    get<Modeling>("modeling").moveShape(shape("id-n1"), { x: 10, y: 20 });
    expect(engine.toModel().views[0].nodes[0]).toMatchObject({ x: 20, y: 40 });
    expect(MODEL).toEqual(PRISTINE);
  });

  it("links a card and renames as undoable commands, notifying once per command", () => {
    const { engine, onChange } = setup();
    engine.setCardId("id-n2", "c9");
    let model = engine.toModel();
    expect(getCardId(model.elements.find((e) => e.id === "id-data")!)).toBe("c9");
    expect(model.propertyDefinitions.filter((d) => d.id === CARD_ID_DEFINITION)).toHaveLength(1);
    expect(onChange).toHaveBeenCalledTimes(1);
    engine.undo();
    expect(getCardId(engine.toModel().elements.find((e) => e.id === "id-data")!)).toBeNull();
    expect(engine.canRedo()).toBe(true);
    engine.redo();
    expect(engine.elementInfo("id-n2")).toEqual({ id: "id-data", type: "DataObject", name: "Customer", cardId: "c9" });

    onChange.mockClear();
    engine.setName("id-n2", "  X  ");
    engine.setName("id-n2", "X");
    model = engine.toModel();
    expect(model.elements.find((e) => e.id === "id-data")!.name).toBe("X");
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(MODEL).toEqual(PRISTINE);
    engine.undo();
    expect(engine.elementInfo("id-n2")!.name).toBe("Customer");
  });

  it("answers null for an unknown shape and reports the selected shape ids", () => {
    const { engine, get } = setup();
    expect(engine.elementInfo("missing")).toBeNull();
    expect(engine.selection()).toEqual([]);
    const registry = get<ElementRegistry>("elementRegistry");
    get<Selection>("selection").select([registry.get("id-n1")!, registry.get("id-g1")!]);
    expect(engine.selection()).toEqual(["id-n1", "id-g1"]);
  });

  it("adds a view named after the model when the model has none", () => {
    const engine = new ArchimateEngine({ container: document.createElement("div"), bridge });
    const empty: ArchimateModel = { ...structuredClone(MODEL), views: [] };
    engine.load(empty);
    const out = engine.toModel();
    expect(out.views).toEqual([{ id: expect.stringMatching(/^id-/), name: "A & B", nodes: [], connections: [] }]);
    // Never drawn, so never deleted.
    expect(out.elements).toEqual(MODEL.elements);
  });

  it("zooms and exports the drawing as SVG", async () => {
    const { engine } = setup();
    engine.zoomFit();
    engine.zoomBy(1);
    const svg = await engine.exportSvg();
    expect(svg).toMatch(/^<\?xml/);
    expect(svg).toContain('data-element-id="id-n1"');
  });

  it("destroys the diagram once, emptying the container", () => {
    const { container, engine } = setup();
    expect(container.children).toHaveLength(1); // diagram-js's own .djs-container
    engine.destroy();
    expect(container.children).toHaveLength(0);
    expect(() => engine.destroy()).not.toThrow();
  });
});
