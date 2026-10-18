/**
 * The ArchiMate editor engine: a diagram-js diagram editing the first view of an `ArchimateModel`.
 *
 * It only edits the model; it never creates, changes or deletes a card (links go through
 * `setCardId`, and the page decides what to do with them via the `EditorBridge`).
 */
import Diagram from "diagram-js";
import type CommandStack from "diagram-js/lib/command/CommandStack";
import type Canvas from "diagram-js/lib/core/Canvas";
import type ElementRegistry from "diagram-js/lib/core/ElementRegistry";
import type EventBus from "diagram-js/lib/core/EventBus";
import type Selection from "diagram-js/lib/features/selection/Selection";
import type { Element, Shape } from "diagram-js/lib/model/Types";
import type ZoomScroll from "diagram-js/lib/navigation/zoomscroll/ZoomScroll";
import type { Point } from "diagram-js/lib/util/Types";
import { innerSVG } from "tiny-svg";
import type { EnterpriseObject } from "@/types";
import {
  CARD_ID_DEFINITION, getCardId, isCustomEnterpriseObject, isNoteObject, newIdentifier,
  type ArchimateModel, type ExchangeProperty, type ModelElement,
} from "../exchange/exchangeModel";
import type { ElementType } from "../taxonomy/elements";
import type { RelationshipType } from "../taxonomy/relationships";
import type ArchimateModeling from "./ArchimateModeling";
import type { EditorBridge } from "./EditorBridge";
import { ARCHIMATE_MODULES } from "./modules";
import { reconcileModel } from "./reconcile";
import { extractEdited, importView, type ViewServices } from "./viewIO";

/** Neither carries an ArchiMate type, a card, documentation or properties: a Note's free text and
 *  a custom Enterprise Object's instance name are the only things either one has of its own. */
const isFreeText = (bo: unknown): boolean => isNoteObject(bo) || isCustomEnterpriseObject(bo);

export interface EngineOptions {
  container: HTMLElement; bridge: EditorBridge; enterpriseObjects: EnterpriseObject[]; onChange?: () => void;
  /** The selection changed (a click, a lasso, a delete). */
  onSelect?: () => void;
}

/** A property the user typed (the card link, stored as a property too, is not one of them). */
export interface UserProperty { name: string; value: string }

/**
 * What the properties panel shows and edits: an element (a shape), a relationship (a connection) or a
 * note (free text, no ArchiMate type — `type` is the literal `"Note"`, never a card, no documentation
 * or properties of its own).
 */
export interface ItemInfo {
  id: string;
  kind: "element" | "relationship" | "note";
  type: ElementType | RelationshipType | "Note";
  name: string;
  documentation: string;
  cardId: string | null;
  properties: UserProperty[];
}

export class ArchimateEngine {
  private readonly diagram: Diagram;
  private readonly container: HTMLElement;
  /** The last loaded model (a private copy): what `toModel` reconciles the edited view into. */
  private base: ArchimateModel | null = null;
  private destroyed = false;
  /** Also fired by `setModelProperties`, which bypasses the command stack (nothing to render). */
  private readonly onChange: (() => void) | undefined;

  constructor(opts: EngineOptions) {
    this.container = opts.container;
    this.onChange = opts.onChange;
    this.diagram = new Diagram({
      canvas: { container: opts.container },
      modules: [
        ...ARCHIMATE_MODULES,
        { bridge: ["value", opts.bridge] },
        { enterpriseObjects: ["value", opts.enterpriseObjects] },
      ],
    });
    // A clear (on load) is not a change; every executed, undone or redone command is.
    this.get<EventBus>("eventBus").on("commandStack.changed", (e: { trigger: string }) => {
      if (e.trigger !== "clear") this.onChange?.();
    });
    this.get<EventBus>("eventBus").on("selection.changed", () => opts.onSelect?.());
  }

  private get<T>(name: string): T {
    return this.diagram.get<T>(name);
  }

  private services(): ViewServices {
    return {
      canvas: this.get("canvas"),
      elementFactory: this.get("elementFactory"),
      elementRegistry: this.get("elementRegistry"),
      connectionDocking: this.get("connectionDocking"),
    };
  }

  /** Edits views[0]; adds an empty view (named after the model) when the model has none. */
  load(model: ArchimateModel): void {
    const base = structuredClone(model);
    if (!base.views.length) base.views.push({ id: newIdentifier(), name: base.name, nodes: [], connections: [], notes: [] });
    this.base = base;
    this.diagram.clear(); // also empties the command stack, without a change event
    importView(this.services(), base, base.views[0]);
  }

  toModel(): ArchimateModel {
    if (!this.base) throw new Error("ArchimateEngine.toModel() before load()");
    return structuredClone(reconcileModel(this.base, extractEdited(this.services(), this.base.views[0])));
  }

  private shape(shapeId: string): Shape | undefined {
    const element = this.get<ElementRegistry>("elementRegistry").get(shapeId) as Shape | undefined;
    return element && !element.waypoints && element.businessObject ? element : undefined;
  }

  setCardId(shapeId: string, cardId: string | null): void {
    const shape = this.shape(shapeId);
    if (!shape || getCardId(shape.businessObject) === cardId) return;
    this.get<ArchimateModeling>("modeling").updateProperties(shape, { cardId });
  }

  /** A shape (element) or a connection (relationship) that carries a model object. */
  private item(id: string): Element | undefined {
    const element = this.get<ElementRegistry>("elementRegistry").get(id) as Element | undefined;
    return element?.businessObject ? element : undefined;
  }

  private update(item: Element, fields: Record<string, unknown>): void {
    // one command, typed loosely: the fields are checked by the callers below
    (this.get<ArchimateModeling>("modeling") as { updateProperties(e: Element, p: unknown): void }).updateProperties(item, fields);
  }

  setName(id: string, name: string): void {
    const item = this.item(id);
    const trimmed = name.trim();
    if (!item) return;
    // an element always has a name (possibly empty); a relationship's name is optional
    const next = item.waypoints && trimmed === "" ? undefined : trimmed;
    if (item.businessObject.name === next) return;
    this.update(item, { name: next });
  }

  /** A note or a custom Enterprise Object has no documentation of its own (its text/name is all it
   *  carries): a no-op. */
  setDocumentation(id: string, text: string): void {
    const item = this.item(id);
    if (!item || isFreeText(item.businessObject)) return;
    const next = text.trim() === "" ? undefined : text;
    if (item.businessObject.documentation === next) return;
    this.update(item, { documentation: next });
  }

  /** Replaces the user's properties; the card link is kept. Names are the keys (a repeated one keeps the last value).
   *  A note or a custom Enterprise Object never carries properties: a no-op. */
  setUserProperties(id: string, props: UserProperty[]): void {
    const item = this.item(id);
    const base = this.base;
    if (!item || !base || isFreeText(item.businessObject)) return;
    const byName = new Map<string, string>();
    for (const { name, value } of props) if (name.trim()) byName.set(name.trim(), value);
    const wanted = [...byName].map(([name, value]) => ({ name, value }));
    if (JSON.stringify(wanted) === JSON.stringify(this.userProperties(item.businessObject))) return;
    const kept = (item.businessObject.properties as ExchangeProperty[]).filter((p) => p.ref === CARD_ID_DEFINITION);
    const next: ExchangeProperty[] = wanted.map(({ name, value }) => {
      let def = base.propertyDefinitions.find((d) => d.id !== CARD_ID_DEFINITION && d.name === name);
      if (!def) {
        def = { id: `propid-${newIdentifier().slice(3)}`, name, type: "string" };
        base.propertyDefinitions.push(def);
      }
      return { ref: def.id, value };
    });
    this.update(item, { properties: [...kept, ...next] });
  }

  private userProperties(bo: { properties: ExchangeProperty[] }): UserProperty[] {
    const defs = this.base?.propertyDefinitions ?? [];
    return bo.properties
      .filter((p) => p.ref !== CARD_ID_DEFINITION)
      .map((p) => ({ name: defs.find((d) => d.id === p.ref)?.name ?? p.ref, value: p.value }));
  }

  /** The single selected element or relationship, for the properties panel; null for none or several. */
  selectedItem(): ItemInfo | null {
    const [only, ...rest] = this.get<Selection>("selection").get();
    if (!only || rest.length) return null;
    return this.itemInfo(only.id);
  }

  itemInfo(id: string): ItemInfo | null {
    const item = this.item(id);
    if (!item) return null;
    // A custom Enterprise Object has no ArchiMate type, card or properties of its own -- same
    // shape as a Note for the properties panel's purposes (its own UI distinction, if any, is a
    // later task; this task's job is only that selecting one never throws).
    if (isFreeText(item.businessObject)) {
      return {
        id, kind: "note", type: "Note", name: item.businessObject.name,
        documentation: "", cardId: null, properties: [],
      };
    }
    const bo = item.businessObject as {
      type: ElementType | RelationshipType; name?: string; documentation?: string; properties: ExchangeProperty[];
    };
    return {
      id,
      kind: item.waypoints ? "relationship" : "element",
      type: bo.type,
      name: bo.name ?? "",
      documentation: bo.documentation ?? "",
      cardId: item.waypoints ? null : getCardId(bo),
      properties: this.userProperties(bo),
    };
  }

  /** The model's own custom properties — the diagram's "parameters" in the properties panel. */
  modelProperties(): UserProperty[] {
    return this.userProperties({ properties: this.base?.properties ?? [] });
  }

  /**
   * Replaces the model's own properties (not part of a view, so not a diagram-js command: no undo
   * entry, but it still marks the diagram dirty).
   */
  setModelProperties(props: UserProperty[]): void {
    const base = this.base;
    if (!base) return;
    const byName = new Map<string, string>();
    for (const { name, value } of props) if (name.trim()) byName.set(name.trim(), value);
    const wanted = [...byName].map(([name, value]) => ({ name, value }));
    if (JSON.stringify(wanted) === JSON.stringify(this.modelProperties())) return;
    base.properties = wanted.map(({ name, value }) => {
      let def = base.propertyDefinitions.find((d) => d.id !== CARD_ID_DEFINITION && d.name === name);
      if (!def) {
        def = { id: `propid-${newIdentifier().slice(3)}`, name, type: "string" };
        base.propertyDefinitions.push(def);
      }
      return { ref: def.id, value };
    });
    this.onChange?.();
  }

  /** `id` is the model element's id (the shape id is the view node's). Null for a Note or a custom
   *  Enterprise Object: neither is a `ModelElement` (no type, no card) -- unreachable through the
   *  page's own UI today (no link/create-card entry is ever offered for either), guarded anyway so
   *  this never throws if that ever changes. */
  elementInfo(shapeId: string): { id: string; type: ElementType; name: string; cardId: string | null } | null {
    const bo = this.shape(shapeId)?.businessObject;
    if (!bo || isFreeText(bo)) return null;
    const el = bo as ModelElement;
    return { id: el.id, type: el.type, name: el.name, cardId: getCardId(el) };
  }

  selection(): string[] {
    return this.get<Selection>("selection").get().map((e) => e.id);
  }

  undo(): void { this.get<CommandStack>("commandStack").undo(); }
  redo(): void { this.get<CommandStack>("commandStack").redo(); }
  canUndo(): boolean { return this.get<CommandStack>("commandStack").canUndo(); }
  canRedo(): boolean { return this.get<CommandStack>("commandStack").canRedo(); }

  zoomBy(step: number): void { this.get<ZoomScroll>("zoomScroll").stepZoom(step); }
  // "auto" centres the drawing (Canvas.js accepts it; the d.ts only knows a Point).
  zoomFit(): void { this.get<Canvas>("canvas").zoom("fit-viewport", "auto" as unknown as Point); }

  /** The drawing as a standalone SVG document (as bpmn-js's saveSVG builds it). */
  async exportSvg(): Promise<string> {
    // Canvas.js returns the layer's <g> here (bpmn-js's saveSVG relies on it); the d.ts says CanvasLayer.
    const layer = this.get<Canvas>("canvas").getActiveLayer() as unknown as SVGGraphicsElement;
    const defs = this.container.querySelector("svg > defs");
    const box = layer.getBBox();
    return (
      '<?xml version="1.0" encoding="utf-8"?>\n' +
      '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" ' +
      `width="${box.width}" height="${box.height}" viewBox="${box.x} ${box.y} ${box.width} ${box.height}" version="1.1">` +
      (defs ? `<defs>${innerSVG(defs as SVGElement)}</defs>` : "") +
      innerSVG(layer) +
      "</svg>"
    );
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.diagram.destroy();
  }
}
