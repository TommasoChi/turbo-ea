import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { EDITOR_SHORTCUTS } from "./engine/keyboardConfig";
import ShortcutsDialog from "./ShortcutsDialog";

describe("ShortcutsDialog", () => {
  it("lists every shortcut of EDITOR_SHORTCUTS with a translated action", () => {
    render(<ShortcutsDialog open onClose={vi.fn()} />);
    expect(screen.getByRole("dialog", { name: "Keyboard shortcuts" })).toBeInTheDocument();
    expect(screen.getAllByRole("row")).toHaveLength(Object.keys(EDITOR_SHORTCUTS).length);
    expect(screen.getByRole("row", { name: "Undo Ctrl+Z" })).toBeInTheDocument();
    expect(screen.getByRole("row", { name: "Rename F2 / Enter" })).toBeInTheDocument();
    expect(screen.getByRole("row", { name: "Fit to screen Ctrl+0" })).toBeInTheDocument();
  });

  it("closes", async () => {
    const onClose = vi.fn();
    render(<ShortcutsDialog open onClose={onClose} />);
    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
