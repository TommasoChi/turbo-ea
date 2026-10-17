import Diagram from "diagram-js";
import type Canvas from "diagram-js/lib/core/Canvas";
import type ElementRegistry from "diagram-js/lib/core/ElementRegistry";
import type EventBus from "diagram-js/lib/core/EventBus";
import type Palette from "diagram-js/lib/features/palette/Palette";
import type Selection from "diagram-js/lib/features/selection/Selection";
import type { Shape } from "diagram-js/lib/model/Types";
import { makeBridge, withBridge } from "@/test/archimateBridge";
import { installSvgStubs } from "@/test/svgStubs";
import { getCardId, isNoteObject, type ModelElement } from "../exchange/exchangeModel";
import { ELEMENT_INFO, ELEMENT_TYPES, LAYER_ORDER, elementsOfLayer, type ElementType } from "../taxonomy/elements";
import ArchimateElementFactory from "./ArchimateElementFactory";
import type ArchimateModeling from "./ArchimateModeling";
import { ARCHIMATE_LAYER_COLORS } from "@/theme/tokens";
import ArchimatePaletteProvider from "./ArchimatePaletteProvider";

beforeAll(installSvgStubs);

type Action = Record<string, (event: Event) => void>;

function setup() {
  const bridge = makeBridge();
  const container = document.createElement("div");
  const diagram = new Diagram({ canvas: { container }, modules: withBridge(bridge) });
  const get = <T,>(name: string) => diagram.get<T>(name);
  const provider = get<ArchimatePaletteProvider>("archimatePalette");
  const entries = provider.getPaletteEntries();
  /** The palette's own DOM entry for a key, as a user (or a screen reader) meets it. */
  const entry = (key: string) => container.querySelector<HTMLElement>(`[data-action="${key}"]`)!;
  const shapesOf = (type: ElementType) =>
    get<ElementRegistry>("elementRegistry").filter((e) => (e.businessObject as ModelElement | undefined)?.type === type) as Shape[];
  const press = (target: HTMLElement, key: string) =>
    target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
  /** A second provider on the same diagram, with the tools and `create` replaced by spies. */
  const withFakes = (fakes: { create?: unknown; hand?: unknown; lasso?: unknown }) =>
    new ArchimatePaletteProvider(
      { registerProvider: vi.fn() } as never, (fakes.create ?? {}) as never, get("elementFactory"),
      (fakes.hand ?? {}) as never, (fakes.lasso ?? {}) as never, bridge,
      get("eventBus"), get("canvas"), get("modeling"), get("selection"),
    );
  return { bridge, container, get, entries, entry, shapesOf, press, withFakes };
}

describe("ArchimatePaletteProvider entries", () => {
  it("lists the two tools then every element plus the note: 2 + 62 + 1 = 65 entries, a separator and a name opening each layer", () => {
    const { entries } = setup();
    const keys = Object.keys(entries);
    expect(keys.filter((k) => /^(hand|lasso|create)/.test(k))).toHaveLength(65);
    expect(keys.slice(0, 2)).toEqual(["hand-tool", "lasso-tool"]);
    expect(keys.slice(2)).toEqual(
      LAYER_ORDER.flatMap((l) => [
        `separator.${l}`, `label.${l}`, ...elementsOfLayer(l).map((t) => `create.${t}`),
        ...(l === "other" ? ["create.note"] : []),
      ]),
    );
    expect(entries["hand-tool"].group).toBe("tools");
    expect(entries["lasso-tool"].group).toBe("tools");
  });

  it("gives the note its own entry, in the other layer, tiled like an element but not one of them", () => {
    const { entries, entry } = setup();
    const note = entries["create.note"];
    expect(note.group).toBe("other");
    expect(note.title).toBe("L:note");
    expect(note.html).toContain('data-archimate-type="Note"');
    expect(note.html).toContain(`--archimate-tile: ${ARCHIMATE_LAYER_COLORS.other.fill}`);
    const el = entry("create.note");
    expect(el.getAttribute("aria-label")).toBe("L:note");
  });

  it("groups the entries tools first, then by layer in LAYER_ORDER, each element in its own layer", () => {
    const { entries } = setup();
    const groups = [...new Set(Object.values(entries).map((e) => e.group))];
    expect(groups).toEqual(["tools", ...LAYER_ORDER]);
    expect(entries["create.BusinessActor"].group).toBe("business");
    for (const t of ELEMENT_TYPES) expect(entries[`create.${t}`].group).toBe(ELEMENT_INFO[t].layer);
  });

  it("takes each title from the bridge labels, not from elementLabel", () => {
    const { entries } = setup();
    for (const t of ELEMENT_TYPES) expect(entries[`create.${t}`].title).toBe(`L:${t}`);
  });

  it("draws the glyph in the entry html, tagged with the element type and reachable by keyboard", () => {
    const { entries } = setup();
    const html = entries["create.Node"].html!;
    expect(html).toContain("<svg");
    expect(html).toContain('data-archimate-type="Node"');
    expect(html).toContain('class="entry archimate-palette-entry"');
    expect(html).toContain('tabindex="0"');
    expect(html).toContain('role="button"');
    expect(html).toContain('draggable="true"');
  });

  it("puts every element on a tile in the colour of its layer, whatever its glyph is made of", () => {
    const { entries } = setup();
    for (const t of ELEMENT_TYPES)
      expect(entries[`create.${t}`].html).toContain(`--archimate-tile: ${ARCHIMATE_LAYER_COLORS[ELEMENT_INFO[t].layer].fill}`);
  });

  it("names each layer with a label that is not an entry (no title, no button role)", () => {
    const { entries } = setup();
    for (const l of LAYER_ORDER) {
      expect(entries[`label.${l}`].html).toContain(`L:${l}`);
      expect(entries[`label.${l}`].html).not.toContain("role=");
    }
  });

  it("gives every element a glyph, including the types with no glyph of their own (plain box)", () => {
    const { entries } = setup();
    for (const t of ELEMENT_TYPES) expect(entries[`create.${t}`].html).toMatch(/<svg[\s\S]*<\/svg>/);
  });

  it("renders as 65 diagram-js .entry elements, each labelled by its title", () => {
    const { container, entry } = setup();
    expect(container.querySelectorAll(".djs-palette .entry")).toHaveLength(65);
    const actor = entry("create.BusinessActor");
    expect(actor.classList.contains("entry")).toBe(true);
    expect(actor.getAttribute("aria-label")).toBe("L:BusinessActor");
    expect(actor.getAttribute("role")).toBe("button");
    expect(actor.getAttribute("tabindex")).toBe("0");
    expect(actor.getAttribute("data-archimate-type")).toBe("BusinessActor");
  });

  it("starts the hand and lasso tools from their entries", () => {
    const hand = { activateHand: vi.fn() };
    const lasso = { activateSelection: vi.fn() };
    const { withFakes } = setup();
    const e = withFakes({ hand, lasso }).getPaletteEntries();
    const event = new MouseEvent("click");
    (e["hand-tool"].action as Action).click(event);
    (e["lasso-tool"].action as Action).click(event);
    expect(hand.activateHand).toHaveBeenCalledWith(event);
    expect(lasso.activateSelection).toHaveBeenCalledWith(event);
  });

  it("titles the tools from the bridge labels", () => {
    const { entries } = setup();
    expect(entries["hand-tool"].title).toBe("L:hand");
    expect(entries["lasso-tool"].title).toBe("L:lasso");
  });
});

describe("palette mouse path (click / dragstart)", () => {
  it.each(["click", "dragstart"] as const)("%s starts creating a fresh element of the entry's type, with no card", (action) => {
    const { withFakes, bridge } = setup();
    const start = vi.fn();
    const entries = withFakes({ create: { start } }).getPaletteEntries();
    const event = new MouseEvent(action);
    (entries["create.ApplicationComponent"].action as Action)[action](event);
    expect(start).toHaveBeenCalledTimes(1);
    const [passedEvent, shape] = start.mock.calls[0];
    expect(passedEvent).toBe(event);
    const bo = shape.businessObject as ModelElement;
    expect(bo.type).toBe("ApplicationComponent");
    expect(bo.properties).toEqual([]);
    expect(getCardId(bo)).toBeNull();
    expect(bridge.openCreateCard).not.toHaveBeenCalled();
    expect(bridge.openLinkPicker).not.toHaveBeenCalled();
  });

  it("builds the shape with the engine's own element factory (size and identifiers come from it)", () => {
    const { withFakes, get } = setup();
    expect(get("elementFactory")).toBeInstanceOf(ArchimateElementFactory);
    const start = vi.fn();
    (withFakes({ create: { start } }).getPaletteEntries()["create.AndJunction"].action as Action).click(new MouseEvent("click"));
    const shape = start.mock.calls[0][1] as Shape;
    expect([shape.width, shape.height]).toEqual([15, 15]);
  });

  it("works through the palette's own trigger on the real create service (drag starts a creation)", () => {
    const { get } = setup();
    const palette = get<Palette>("palette");
    const create = get<{ start(...a: unknown[]): void }>("create");
    const spy = vi.spyOn(create, "start").mockImplementation(() => undefined);
    palette.triggerEntry("create.Goal", "click", new MouseEvent("click"));
    expect(spy).toHaveBeenCalledTimes(1);
  });
});

/** diagram-js rounds a created shape's top-left to whole pixels, so its centre is within half a pixel. */
function expectCentredOn(shape: Shape, cx: number, cy: number) {
  expect(Math.abs(shape.x + shape.width / 2 - cx)).toBeLessThanOrEqual(0.5);
  expect(Math.abs(shape.y + shape.height / 2 - cy)).toBeLessThanOrEqual(0.5);
}

describe("palette keyboard path", () => {
  it("Enter on an entry drops one element of that type at the viewport centre and selects it", () => {
    const { get, entry, shapesOf, press, bridge } = setup();
    const canvas = get<Canvas>("canvas");
    const { x, y, width, height } = canvas.viewbox();
    press(entry("create.BusinessActor"), "Enter");
    const shapes = shapesOf("BusinessActor");
    expect(shapes).toHaveLength(1);
    const [shape] = shapes;
    expectCentredOn(shape, x + width / 2, y + height / 2);
    expect(shape.parent).toBe(canvas.getRootElement());
    expect(get<Selection>("selection").get()).toEqual([shape]);
    expect(getCardId(shape.businessObject as ModelElement)).toBeNull();
    expect(bridge.openCreateCard).not.toHaveBeenCalled();
    expect(bridge.openLinkPicker).not.toHaveBeenCalled();
  });

  it("Space works too, and the drop is one undoable command", () => {
    const { get, entry, shapesOf, press } = setup();
    press(entry("create.Node"), " ");
    expect(shapesOf("Node")).toHaveLength(1);
    get<{ undo(): void }>("commandStack").undo();
    expect(shapesOf("Node")).toHaveLength(0);
  });

  it("Enter on the note entry drops a note, not an element, at the viewport centre", () => {
    const { get, entry, press } = setup();
    const canvas = get<Canvas>("canvas");
    const { x, y, width, height } = canvas.viewbox();
    press(entry("create.note"), "Enter");
    const notes = get<ElementRegistry>("elementRegistry").filter((e) => isNoteObject(e.businessObject)) as Shape[];
    expect(notes).toHaveLength(1);
    expectCentredOn(notes[0], x + width / 2, y + height / 2);
    expect(get<Selection>("selection").get()).toEqual(notes);
  });

  it("drops at the centre of the visible part after the canvas was scrolled", () => {
    const { get, entry, shapesOf, press } = setup();
    get<Canvas>("canvas").scroll({ dx: 120, dy: -60 });
    const { x, y, width, height } = get<Canvas>("canvas").viewbox();
    press(entry("create.DataObject"), "Enter");
    const [shape] = shapesOf("DataObject");
    expectCentredOn(shape, x + width / 2, y + height / 2);
  });

  it("ignores other keys, key repeat, the tool entries and the toggle", () => {
    const { container, entry, get, press } = setup();
    press(entry("create.BusinessActor"), "a");
    press(entry("create.BusinessActor"), "Tab");
    entry("create.BusinessActor").dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", repeat: true, bubbles: true }));
    press(entry("hand-tool"), "Enter");
    press(container.querySelector<HTMLElement>(".djs-palette-toggle")!, "Enter");
    expect(get<ElementRegistry>("elementRegistry").filter((e) => !!e.businessObject)).toHaveLength(0);
  });

  it("prevents the default of a handled key (Space would scroll the page)", () => {
    const { entry } = setup();
    const ev = new KeyboardEvent("keydown", { key: " ", bubbles: true, cancelable: true });
    entry("create.Goal").dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
  });

  it("announces the new shape on archimate.element.created for the label editor", () => {
    const { get, entry, press, shapesOf } = setup();
    const seen: Shape[] = [];
    get<EventBus>("eventBus").on("archimate.element.created", (e: { shape: Shape }) => { seen.push(e.shape); });
    press(entry("create.Capability"), "Enter");
    expect(seen).toHaveLength(1);
    expect(seen).toEqual(shapesOf("Capability"));
  });

  it("is attached once: a press makes exactly one shape even after the palette rebuilds its entries", () => {
    const { get, entry, press, shapesOf } = setup();
    const palette = get<Palette>("palette");
    palette.close();
    palette.open();
    (palette as unknown as { _update(): void })._update();
    press(entry("create.Goal"), "Enter");
    expect(shapesOf("Goal")).toHaveLength(1);
  });

  it("creates through modeling under the root, not around it", () => {
    const { get, entry, press } = setup();
    const spy = vi.spyOn(get<ArchimateModeling>("modeling"), "createShape");
    press(entry("create.Goal"), "Enter");
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][2]).toBe(get<Canvas>("canvas").getRootElement());
  });
});
