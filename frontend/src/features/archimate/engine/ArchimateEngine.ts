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
import type { Shape } from "diagram-js/lib/model/Types";
import type ZoomScroll from "diagram-js/lib/navigation/zoomscroll/ZoomScroll";
import type { Point } from "diagram-js/lib/util/Types";
import { innerSVG } from "tiny-svg";
import { getCardId, newIdentifier, type ArchimateModel, type ModelElement } from "../exchange/exchangeModel";
import type { ElementType } from "../taxonomy/elements";
import type ArchimateModeling from "./ArchimateModeling";
import type { EditorBridge } from "./EditorBridge";
import { ARCHIMATE_MODULES } from "./modules";
import { reconcileModel } from "./reconcile";
import { extractEdited, importView, type ViewServices } from "./viewIO";

export interface EngineOptions { container: HTMLElement; bridge: EditorBridge; onChange?: () => void }

export class ArchimateEngine {
  private readonly diagram: Diagram;
  private readonly container: HTMLElement;
  /** The last loaded model (a private copy): what `toModel` reconciles the edited view into. */
  private base: ArchimateModel | null = null;
  private destroyed = false;

  constructor(opts: EngineOptions) {
    this.container = opts.container;
    this.diagram = new Diagram({
      canvas: { container: opts.container },
      modules: [...ARCHIMATE_MODULES, { bridge: ["value", opts.bridge] }],
    });
    // A clear (on load) is not a change; every executed, undone or redone command is.
    this.get<EventBus>("eventBus").on("commandStack.changed", (e: { trigger: string }) => {
      if (e.trigger !== "clear") opts.onChange?.();
    });
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
    if (!base.views.length) base.views.push({ id: newIdentifier(), name: base.name, nodes: [], connections: [] });
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

  setName(shapeId: string, name: string): void {
    const shape = this.shape(shapeId);
    const trimmed = name.trim();
    if (!shape || shape.businessObject.name === trimmed) return;
    this.get<ArchimateModeling>("modeling").updateProperties(shape, { name: trimmed });
  }

  /** `id` is the model element's id (the shape id is the view node's). */
  elementInfo(shapeId: string): { id: string; type: ElementType; name: string; cardId: string | null } | null {
    const bo = this.shape(shapeId)?.businessObject as ModelElement | undefined;
    return bo ? { id: bo.id, type: bo.type, name: bo.name, cardId: getCardId(bo) } : null;
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
