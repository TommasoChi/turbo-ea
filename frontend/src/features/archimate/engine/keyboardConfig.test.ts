import { EDITOR_SHORTCUTS } from "./keyboardConfig";

describe("EDITOR_SHORTCUTS", () => {
  it("documents the editor's keyboard shortcuts (the Modeler's help tooltip shows them)", () => {
    expect(EDITOR_SHORTCUTS).toEqual({
      undo: "Ctrl+Z", redo: "Ctrl+Y / Ctrl+Shift+Z", copy: "Ctrl+C", paste: "Ctrl+V", delete: "Delete / Backspace",
      edit: "F2 / Enter", selectAll: "Ctrl+A", zoomIn: "Ctrl++", zoomOut: "Ctrl+-", zoomFit: "Ctrl+0",
    });
  });
});
