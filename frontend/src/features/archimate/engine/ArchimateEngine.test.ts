import type Modeling from "diagram-js/lib/features/modeling/Modeling";
import type Selection from "diagram-js/lib/features/selection/Selection";
import type ElementRegistry from "diagram-js/lib/core/ElementRegistry";
import type { Shape } from "diagram-js/lib/model/Types";
import type { EnterpriseObject } from "@/types";
import { MODEL } from "@/test/archimateModel";
import { makeBridge } from "@/test/archimateBridge";
import { installSvgStubs } from "@/test/svgStubs";
import { CARD_ID_DEFINITION, getCardId, type ArchimateModel } from "../exchange/exchangeModel";
import { readExchange } from "../exchange/readExchange";
import { writeExchange } from "../exchange/writeExchange";
import { ArchimateEngine } from "./ArchimateEngine";

beforeAll(installSvgStubs);

const bridge = makeBridge();
const enterpriseObjects: EnterpriseObject[] = [];
/** load() works on a copy: no edit may reach the shared fixture. */
const PRISTINE = structuredClone(MODEL);

function setup() {
  const container = document.createElement("div");
  const onChange = vi.fn();
  const engine = new ArchimateEngine({ container, bridge, enterpriseObjects, onChange });
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
    const engine = new ArchimateEngine({ container: document.createElement("div"), bridge, enterpriseObjects });
    const empty: ArchimateModel = { ...structuredClone(MODEL), views: [] };
    engine.load(empty);
    const out = engine.toModel();
    expect(out.views).toEqual([{ id: expect.stringMatching(/^id-/), name: "A & B", nodes: [], connections: [], notes: [] }]);
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

  it("destroy clears a pending HoverTooltip timer before the canvas container goes away", () => {
    // diagram-js's palette wires a HoverTooltip with a 300ms debounce on every palette-tile
    // `mouseover` (PaletteTooltip.js); the library never clears it on diagram teardown. Left
    // alone, the timer fires later against a canvas container already removed from the DOM and
    // throws (`Cannot read properties of undefined (reading 'appendChild')`) -- the exact
    // "Unhandled Error" CI caught in ArchimateModeler.test.tsx. Reproduced here at the service
    // level: start a hover (as a real `mouseover` would), destroy, and prove the timer is dead.
    const { engine, get } = setup();
    const hoverTooltip = get<{
      _show: (target: object, config: { getContent: () => string }, delay: number) => void;
      _showTimer?: ReturnType<typeof setTimeout>;
    }>("hoverTooltip");
    hoverTooltip._show({}, { getContent: () => "tip" }, 10_000);
    const pendingTimer = hoverTooltip._showTimer;
    expect(pendingTimer).toBeDefined();
    const clearSpy = vi.spyOn(global, "clearTimeout");
    engine.destroy();
    expect(clearSpy).toHaveBeenCalledWith(pendingTimer);
    clearSpy.mockRestore();
  });
});

describe("ArchimateEngine: the properties panel's view of the selection", () => {
  it("describes an element and a relationship, and nothing for an unknown id", () => {
    const { engine } = setup();
    expect(engine.itemInfo("id-n1")).toEqual({
      id: "id-n1", kind: "element", type: "ApplicationComponent", name: "CRM <core>", documentation: "The CRM",
      cardId: "c1", properties: [],
    });
    expect(engine.itemInfo("id-c1")).toEqual({
      id: "id-c1", kind: "relationship", type: "Access", name: "uses", documentation: "", cardId: null, properties: [],
    });
    expect(engine.itemInfo("nope")).toBeNull();
  });

  it("reports the single selected item, and nothing for none or several; the page hears every change", () => {
    const container = document.createElement("div");
    const onSelect = vi.fn();
    const engine = new ArchimateEngine({ container, bridge, enterpriseObjects, onSelect });
    engine.load(MODEL);
    const selection = (engine as unknown as { diagram: { get(n: string): Selection } }).diagram.get("selection");
    const registry = (engine as unknown as { diagram: { get(n: string): ElementRegistry } }).diagram.get("elementRegistry");
    expect(engine.selectedItem()).toBeNull();
    onSelect.mockClear(); // loading clears the selection
    selection.select(registry.get("id-n1") as Shape);
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(engine.selectedItem()?.id).toBe("id-n1");
    selection.select([registry.get("id-n1"), registry.get("id-n2")] as Shape[]);
    expect(engine.selectedItem()).toBeNull();
    expect(engine.selection()).toHaveLength(2);
  });

  it("edits the documentation as one undoable change, and an empty text removes it", () => {
    const { engine, onChange } = setup();
    engine.setDocumentation("id-n1", "The CRM"); // unchanged
    expect(onChange).not.toHaveBeenCalled();
    engine.setDocumentation("id-n2", "Customers");
    expect(engine.toModel().elements.find((e) => e.id === "id-data")!.documentation).toBe("Customers");
    engine.setDocumentation("id-n2", "   ");
    expect(engine.toModel().elements.find((e) => e.id === "id-data")!.documentation).toBeUndefined();
    expect(onChange).toHaveBeenCalledTimes(2);
    engine.undo();
    expect(engine.itemInfo("id-n2")!.documentation).toBe("Customers");
    expect(engine.setDocumentation("nope", "x")).toBeUndefined();
  });

  it("names a relationship, and an empty name removes it (only an element always has one)", () => {
    const { engine } = setup();
    engine.setName("id-c1", " reads ");
    expect(engine.toModel().relationships.find((r) => r.id === "id-rel-access")!.name).toBe("reads");
    engine.setName("id-c1", "");
    expect("name" in engine.toModel().relationships.find((r) => r.id === "id-rel-access")!).toBe(false);
    engine.setName("id-n1", "");
    expect(engine.toModel().elements.find((e) => e.id === "id-app")!.name).toBe("");
  });

  it("sets the user's properties: new names get a definition, the card link is kept, blank names are dropped", () => {
    const { engine, onChange } = setup();
    engine.setUserProperties("id-n1", [{ name: " owner ", value: "Ann" }, { name: "", value: "ignored" }, { name: "tier", value: "1" }]);
    expect(engine.itemInfo("id-n1")!.properties).toEqual([{ name: "owner", value: "Ann" }, { name: "tier", value: "1" }]);
    expect(engine.itemInfo("id-n1")!.cardId).toBe("c1");
    let model = engine.toModel();
    expect(model.propertyDefinitions.map((d) => d.name)).toEqual(["turboea:cardId", "owner", "tier"]);
    expect(model.propertyDefinitions.every((d) => /^[A-Za-z][\w.-]*$/.test(d.id))).toBe(true);

    // the same names reuse the definitions; a repeated name keeps the last value
    engine.setUserProperties("id-n2", [{ name: "owner", value: "A" }, { name: "owner", value: "B" }]);
    model = engine.toModel();
    expect(model.propertyDefinitions).toHaveLength(3);
    expect(engine.itemInfo("id-n2")!.properties).toEqual([{ name: "owner", value: "B" }]);
    expect(onChange).toHaveBeenCalledTimes(2);

    // unchanged: no command
    engine.setUserProperties("id-n2", [{ name: "owner", value: "B" }]);
    expect(onChange).toHaveBeenCalledTimes(2);
    engine.undo();
    expect(engine.itemInfo("id-n2")!.properties).toEqual([]);

    // a relationship takes properties too, and none removes them
    engine.setUserProperties("id-c1", [{ name: "since", value: "2020" }]);
    expect(engine.itemInfo("id-c1")!.properties).toEqual([{ name: "since", value: "2020" }]);
    engine.setUserProperties("id-c1", []);
    expect(engine.itemInfo("id-c1")!.properties).toEqual([]);
    expect(engine.setUserProperties("nope", [])).toBeUndefined();
  });

  it("round-trips the user's properties through the Exchange writer and reader", () => {
    const { engine } = setup();
    engine.setUserProperties("id-n1", [{ name: "owner", value: "Ann & Bob" }]);
    const again = new ArchimateEngine({ container: document.createElement("div"), bridge, enterpriseObjects });
    again.load(readExchange(writeExchange(engine.toModel())));
    expect(again.itemInfo("id-n1")!.properties).toEqual([{ name: "owner", value: "Ann & Bob" }]);
    expect(again.itemInfo("id-n1")!.cardId).toBe("c1");
  });
});

describe("ArchimateEngine: a note", () => {
  /** Drops a fresh note onto the canvas, for `get`'s own engine. */
  function addNote(env: ReturnType<typeof setup>): Shape {
    const modeling = env.get<Modeling>("modeling");
    const factory = env.get<{ createShape(attrs: unknown): Shape }>("elementFactory");
    const root = env.get<{ getRootElement(): unknown }>("canvas").getRootElement();
    return modeling.createShape(factory.createShape({ isNote: true }), { x: 700, y: 300 }, root) as Shape;
  }

  it("itemInfo reports kind note, type Note, its text as name, no documentation, no card, no properties", () => {
    const env = setup();
    const note = addNote(env);
    const info = env.engine.itemInfo(note.id)!;
    expect(info).toEqual({ id: note.id, kind: "note", type: "Note", name: "", documentation: "", cardId: null, properties: [] });
    env.engine.setName(note.id, "Ask the team");
    expect(env.engine.itemInfo(note.id)!.name).toBe("Ask the team");
    expect(env.engine.selectedItem()).toBeNull(); // nothing selected yet
  });

  it("setDocumentation and setUserProperties are a no-op on a note", () => {
    const env = setup();
    const note = addNote(env);
    env.onChange.mockClear();
    env.engine.setDocumentation(note.id, "Some text");
    env.engine.setUserProperties(note.id, [{ name: "a", value: "b" }]);
    expect(env.engine.itemInfo(note.id)).toMatchObject({ documentation: "", properties: [] });
    expect(env.onChange).not.toHaveBeenCalled();
  });

  it("round-trips through the Exchange writer and reader, never written as an element", () => {
    const env = setup();
    const note = addNote(env);
    env.engine.setName(note.id, "Ask the team");
    const model = env.engine.toModel();
    expect(model.elements.some((e) => e.id === note.id)).toBe(false);
    expect(model.views[0].notes).toEqual([
      expect.objectContaining({ id: note.id, text: "Ask the team" }),
    ]);
    const again = new ArchimateEngine({ container: document.createElement("div"), bridge, enterpriseObjects });
    again.load(readExchange(writeExchange(model)));
    expect(again.itemInfo(note.id)).toEqual({
      id: note.id, kind: "note", type: "Note", name: "Ask the team", documentation: "", cardId: null, properties: [],
    });
  });
});

describe("ArchimateEngine: a custom Enterprise Object", () => {
  const AI_MODEL: EnterpriseObject = {
    key: "AIModel", name: "AI Model", description: null, icon: "smart_toy", color: "#ab12cd",
    layer: "application", is_standard: false, is_locked: false, is_hidden: false, sort_order: 0, card_mappings: [],
  };

  /** Its own engine (not the shared `setup()`, since it needs the registry row), with one custom
   *  object already on the canvas alongside the regular fixture elements. */
  function setupCustom() {
    const container = document.createElement("div");
    const onChange = vi.fn();
    const engine = new ArchimateEngine({ container, bridge, enterpriseObjects: [AI_MODEL], onChange });
    engine.load(MODEL);
    const get = <T,>(name: string) => (engine as unknown as { diagram: { get(n: string): T } }).diagram.get(name);
    const modeling = get<Modeling>("modeling");
    const factory = get<{ createShape(attrs: unknown): Shape }>("elementFactory");
    const root = get<{ getRootElement(): unknown }>("canvas").getRootElement();
    const shape = modeling.createShape(factory.createShape({ enterpriseObjectKey: "AIModel" }), { x: 700, y: 300 }, root) as Shape;
    return { container, engine, onChange, get, shape };
  }

  it("selecting it (what every drop does automatically) never throws -- itemInfo degrades like a note's: no card, no properties", () => {
    const { engine, get, shape } = setupCustom();
    // This is exactly what a palette drop does next (dropAtCentre selects the new shape, which
    // fires onSelect -> the page calls selectedItem() -> itemInfo()): regression coverage for a
    // crash that only showed up once a custom object went through the real engine, not just the
    // palette/factory/renderer in isolation.
    expect(() => get<Selection>("selection").select(shape)).not.toThrow();
    expect(() => engine.selectedItem()).not.toThrow();
    const info = engine.itemInfo(shape.id);
    expect(info).toEqual({ id: shape.id, kind: "note", type: "Note", name: "", documentation: "", cardId: null, properties: [] });
    engine.setName(shape.id, "Fraud Detector");
    expect(engine.itemInfo(shape.id)!.name).toBe("Fraud Detector");
  });

  it("setDocumentation and setUserProperties are a no-op, same as a note's", () => {
    const { engine, onChange, shape } = setupCustom();
    onChange.mockClear();
    expect(() => engine.setDocumentation(shape.id, "Some text")).not.toThrow();
    expect(() => engine.setUserProperties(shape.id, [{ name: "a", value: "b" }])).not.toThrow();
    expect(engine.itemInfo(shape.id)).toMatchObject({ documentation: "", properties: [] });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("elementInfo returns null for it rather than throwing (no type, no card to report)", () => {
    const { engine, shape } = setupCustom();
    expect(() => engine.elementInfo(shape.id)).not.toThrow();
    expect(engine.elementInfo(shape.id)).toBeNull();
  });

  it("toModel() does not throw with a custom object on the canvas, and saves it as a note -- the rest of the diagram still round-trips", () => {
    const { engine, shape } = setupCustom();
    engine.setName(shape.id, "Fraud Detector");
    expect(() => engine.toModel()).not.toThrow();
    const model = engine.toModel();
    // True round-trip (re-importing it as the SAME custom type) is still out of scope: it
    // degrades to a plain note, same shape/text as a real Note, instead of being silently
    // dropped (which was real data loss).
    expect(model.elements.some((e) => e.id === shape.businessObject.id)).toBe(false);
    expect(model.views[0].notes.find((n) => n.id === shape.id)).toMatchObject({ text: "Fraud Detector" });
    expect(model.views[0].nodes.some((n) => n.id === shape.id)).toBe(false);
    // the fixture's own elements are untouched by the custom object's presence
    expect(model.elements.find((e) => e.id === "id-app")).toBeDefined();
    expect(model).toEqual(engine.toModel()); // stable, not crashing on repeat either
  });
});

describe("ArchimateEngine: the model's own properties", () => {
  it("reads [] when the model has none, and resolves names from propertyDefinitions", () => {
    const { engine } = setup();
    expect(engine.modelProperties()).toEqual([]);
  });

  it("sets, reuses definitions for repeated names and marks the diagram changed without a command", () => {
    const { engine, onChange } = setup();
    engine.setModelProperties([{ name: " owner ", value: "Team A" }, { name: "", value: "ignored" }]);
    expect(engine.modelProperties()).toEqual([{ name: "owner", value: "Team A" }]);
    expect(onChange).toHaveBeenCalledTimes(1);
    const model = engine.toModel();
    expect(model.properties).toHaveLength(1);
    const def = model.propertyDefinitions.find((d) => d.name === "owner")!;
    expect(def).toBeDefined();
    expect(model.properties[0]).toEqual({ ref: def.id, value: "Team A" });

    // unchanged: no further onChange
    engine.setModelProperties([{ name: "owner", value: "Team A" }]);
    expect(onChange).toHaveBeenCalledTimes(1);

    // a second property reuses no definition name clash and both are kept
    engine.setModelProperties([{ name: "owner", value: "Team A" }, { name: "tier", value: "1" }]);
    expect(engine.toModel().propertyDefinitions.filter((d) => d.name === "owner")).toHaveLength(1);
    expect(engine.modelProperties()).toEqual([{ name: "owner", value: "Team A" }, { name: "tier", value: "1" }]);
  });

  it("is not a diagram-js command: no undo entry, but toModel() reflects it", () => {
    const { engine } = setup();
    expect(engine.canUndo()).toBe(false);
    engine.setModelProperties([{ name: "owner", value: "Team A" }]);
    expect(engine.canUndo()).toBe(false);
    expect(engine.toModel().properties).toEqual([{ ref: expect.stringMatching(/^propid-/), value: "Team A" }]);
  });

  it("round-trips through the Exchange writer and reader", () => {
    const { engine } = setup();
    engine.setModelProperties([{ name: "owner", value: "Team A & B" }]);
    const again = new ArchimateEngine({ container: document.createElement("div"), bridge, enterpriseObjects });
    again.load(readExchange(writeExchange(engine.toModel())));
    expect(again.modelProperties()).toEqual([{ name: "owner", value: "Team A & B" }]);
  });
});
