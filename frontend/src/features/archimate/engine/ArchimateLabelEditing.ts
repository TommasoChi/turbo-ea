/**
 * In-place name editing (diagram-js-direct-editing), as bpmn-js's LabelEditingProvider.
 *
 * Editing starts on a double-click, on F2 / Enter with one element selected (the `directEditing`
 * editor action) and on a fresh palette drop (mouse: `create.end`; keyboard: ELEMENT_CREATED_EVENT).
 * An import or a paste never starts it. The new name is one undoable `element.updateProperties`.
 */
import type Canvas from "diagram-js/lib/core/Canvas";
import type EventBus from "diagram-js/lib/core/EventBus";
import type EditorActions from "diagram-js/lib/features/editor-actions/EditorActions";
import { hasModifier, isKey } from "diagram-js/lib/features/keyboard/KeyboardUtil";
import type Selection from "diagram-js/lib/features/selection/Selection";
import type { Connection, Element, Shape } from "diagram-js/lib/model/Types";
import type { Rect } from "diagram-js/lib/util/Types";
import type DirectEditing from "diagram-js-direct-editing/lib/DirectEditing";
import { isNoteObject, type ModelElement, type ModelRelationship, type NoteObject } from "../exchange/exchangeModel";
import { isConnector } from "../taxonomy/elements";
import type ArchimateModeling from "./ArchimateModeling";
import { ELEMENT_CREATED_EVENT } from "./ArchimatePaletteProvider";

/** The edit box of a connection's name. */
const CONNECTION_BOX = { width: 120, height: 24 };

/** After Create's own create.end handler (default priority), which creates the shape. */
const AFTER_CREATE = 500;

/**
 * Where the edit box goes, in the canvas container's (viewport) coordinates: the shape's own bounds,
 * or a fixed box centred on a connection's middle (its middle waypoint, or its middle segment's midpoint).
 */
export function getLabelBounds(canvas: Canvas, element: Element): Rect {
  const wps = (element as Connection).waypoints;
  if (!wps) return canvas.getAbsoluteBBox(element as Shape);
  const a = wps[Math.floor((wps.length - 1) / 2)], b = wps[Math.ceil((wps.length - 1) / 2)];
  // A zero-size box: getAbsoluteBBox only reads x, y, width and height of a non-connection.
  const mid = canvas.getAbsoluteBBox({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, width: 0, height: 0 } as Shape);
  return { x: mid.x - CONNECTION_BOX.width / 2, y: mid.y - CONNECTION_BOX.height / 2, ...CONNECTION_BOX };
}

/** A shape or connection of ours (the root has no business object). */
const isModelled = (element: Element | undefined): element is Shape | Connection => !!element?.businessObject;

export default class ArchimateLabelEditing {
  // `canvas` places the box; `selection` scopes F2 / Enter to one selected element.
  static $inject = ["eventBus", "directEditing", "modeling", "canvas", "selection"];

  constructor(
    eventBus: EventBus,
    directEditing: DirectEditing,
    private readonly modeling: ArchimateModeling,
    private readonly canvas: Canvas,
    selection: Selection,
  ) {
    directEditing.registerProvider(this);

    eventBus.on("element.dblclick", ({ element }: { element: Element }) => { directEditing.activate(element); });

    eventBus.on("create.end", AFTER_CREATE, ({ context }: {
      context: { shape?: Element; canExecute?: unknown; hints?: { createElementsBehavior?: boolean } };
    }) => {
      if (!context.canExecute || context.hints?.createElementsBehavior === false) return; // false: a paste
      if (isModelled(context.shape)) directEditing.activate(context.shape);
    });

    eventBus.on(ELEMENT_CREATED_EVENT, ({ shape }: { shape: Shape }) => { directEditing.activate(shape); });

    // As KeyboardBindings: the key goes through the editor action, registered once all modules are loaded.
    eventBus.on("editorActions.init", ({ editorActions }: { editorActions: EditorActions }) => {
      editorActions.register({
        directEditing: () => {
          const selected = selection.get();
          return selected.length === 1 && directEditing.activate(selected[0]);
        },
      });
      eventBus.on("keyboard.keydown", ({ keyEvent }: { keyEvent: KeyboardEvent }) => {
        if (hasModifier(keyEvent) || !isKey(["F2", "Enter"], keyEvent)) return;
        return editorActions.trigger("directEditing", {}) ? true : undefined;
      });
    });
  }

  /** A junction has no name (and is a 15px circle): it never opens an edit box. A note always does. */
  activate(element: Element) {
    if (!isModelled(element)) return null;
    const bo = element.businessObject as ModelElement | ModelRelationship | NoteObject;
    if (!isNoteObject(bo) && isConnector(bo.type)) return null;
    return { text: bo.name ?? "", bounds: getLabelBounds(this.canvas, element), options: { autoResize: false } };
  }

  update(element: Element, newText: string): void {
    const name = newText.trim();
    const bo = element.businessObject as ModelElement | ModelRelationship | NoteObject;
    if (name === (bo.name ?? "")) return;
    if ((element as Connection).waypoints) this.modeling.updateProperties(element as Connection, { name });
    else this.modeling.updateProperties(element as Shape, { name });
  }
}
