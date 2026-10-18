/**
 * The editor's keyboard shortcuts.
 *
 * diagram-js's KeyboardBindings bind undo, redo, copy, paste, delete and zoom in/out on the canvas
 * (diagram-js 15 binds the keyboard to the focusable canvas <svg> itself; `keyboard.bindTo` is no
 * longer supported). `ArchimateKeyboardBindings` adds the two it lacks: Ctrl+A selects everything and
 * Ctrl+0 fits the drawing (diagram-js's own Ctrl+0 resets to 100%). F2 / Enter are bound by the label
 * editor.
 */
import type Canvas from "diagram-js/lib/core/Canvas";
import type ElementRegistry from "diagram-js/lib/core/ElementRegistry";
import type Keyboard from "diagram-js/lib/features/keyboard/Keyboard";
import { isCmd, isKey } from "diagram-js/lib/features/keyboard/KeyboardUtil";
import type Selection from "diagram-js/lib/features/selection/Selection";
import type { Point } from "diagram-js/lib/util/Types";

/** The documented map, shown by the Modeler's help tooltip. */
export const EDITOR_SHORTCUTS = {
  undo: "Ctrl+Z", redo: "Ctrl+Y / Ctrl+Shift+Z", copy: "Ctrl+C", paste: "Ctrl+V", delete: "Delete / Backspace",
  edit: "F2 / Enter", selectAll: "Ctrl+A", zoomIn: "Ctrl++", zoomOut: "Ctrl+-", zoomFit: "Ctrl+0",
};

/** Above KeyboardBindings' default priority, so this Ctrl+0 wins over diagram-js's. */
const PRIORITY = 1500;

export class ArchimateKeyboardBindings {
  static $inject = ["keyboard", "selection", "elementRegistry", "canvas"];

  constructor(keyboard: Keyboard, selection: Selection, elementRegistry: ElementRegistry, canvas: Canvas) {
    keyboard.addListener(PRIORITY, ({ keyEvent }: { keyEvent: KeyboardEvent }) => {
      if (!isCmd(keyEvent)) return;
      if (isKey(["a", "A"], keyEvent)) {
        selection.select(elementRegistry.filter((e) => !!e.businessObject));
        return true;
      }
      if (isKey("0", keyEvent)) {
        // "auto" centres the drawing (Canvas.js accepts it; the d.ts only knows a Point), as ArchimateEngine.zoomFit.
        canvas.zoom("fit-viewport", "auto" as unknown as Point);
        return true;
      }
    });
  }
}
