import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { onActivateKey } from "./keyboardActivate";

function Target({ handler }: { handler: (e: React.SyntheticEvent<HTMLElement>) => void }) {
  return (
    // biome-ignore lint/a11y/useSemanticElements: the helper exists for elements that cannot be a native button, and a native one would also click on Enter
    <span role="button" tabIndex={0} onKeyDown={onActivateKey(handler)}>
      go
    </span>
  );
}

describe("onActivateKey", () => {
  it.each([["{Enter}"], [" "]])("fires the handler on %s", async (key) => {
    const handler = vi.fn();
    render(<Target handler={handler} />);
    await userEvent.tab();
    expect(screen.getByRole("button")).toHaveFocus();
    await userEvent.keyboard(key);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("ignores other keys", async () => {
    const handler = vi.fn();
    render(<Target handler={handler} />);
    await userEvent.tab();
    await userEvent.keyboard("a{Escape}{Tab}");
    expect(handler).not.toHaveBeenCalled();
  });

  it("ignores a key pressed on a descendant", async () => {
    const handler = vi.fn();
    render(
      // biome-ignore lint/a11y/useSemanticElements: fixture for a custom control wrapping a native input
      <div role="button" tabIndex={0} onKeyDown={onActivateKey(handler)}>
        <input aria-label="inner" />
      </div>,
    );
    await userEvent.type(screen.getByLabelText("inner"), " {Enter}");
    expect(handler).not.toHaveBeenCalled();
  });
});
