import { screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import i18n from "@/i18n";
import { renderWithProviders } from "@/test/render";
import GroupHeader from "./GroupHeader";

const t = i18n.getFixedT("en", "valuechain");

const LIGHT = "#f5f5f5";
const DARK = "#003399";

describe("GroupHeader", () => {
  it("opens the group when the name is clicked, once, without toggling", async () => {
    const onOpen = vi.fn();
    const onToggle = vi.fn();
    const { user } = renderWithProviders(
      <GroupHeader color={DARK} name="Order to cash" collapsed={false} onToggle={onToggle} onOpen={onOpen} />,
    );
    await user.click(screen.getByRole("button", { name: "Order to cash" }));
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onToggle).not.toHaveBeenCalled();
  });

  it("opens the group from the keyboard with Enter and Space", async () => {
    const onOpen = vi.fn();
    const { user } = renderWithProviders(
      <GroupHeader color={DARK} name="Order to cash" collapsed={false} onToggle={() => {}} onOpen={onOpen} />,
    );
    const name = screen.getByRole("button", { name: "Order to cash" });
    expect(name).toHaveAttribute("tabindex", "0");
    name.focus();
    await user.keyboard("{Enter}");
    expect(onOpen).toHaveBeenCalledTimes(1);
    await user.keyboard(" ");
    expect(onOpen).toHaveBeenCalledTimes(2);
  });

  it("has no button for the name without onOpen, only the toggle", () => {
    renderWithProviders(<GroupHeader color={DARK} name="Order to cash" collapsed={false} onToggle={() => {}} />);
    expect(screen.getAllByRole("button")).toHaveLength(1);
    expect(screen.getByRole("button")).toHaveAccessibleName(t("actions.collapse"));
    expect(screen.getByText("Order to cash")).not.toHaveAttribute("tabindex");
  });

  it("toggles via the collapse button, once, without opening", async () => {
    const onOpen = vi.fn();
    const onToggle = vi.fn();
    const { user } = renderWithProviders(
      <GroupHeader color={DARK} name="Order to cash" collapsed onToggle={onToggle} onOpen={onOpen} />,
    );
    await user.click(screen.getByRole("button", { name: t("actions.expand") }));
    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("puts extra at the end in place of the balancing spacer", () => {
    const { container, rerender } = renderWithProviders(
      <GroupHeader color={DARK} name="G" collapsed={false} onToggle={() => {}} />,
    );
    const root = container.firstElementChild as HTMLElement;
    expect(root.lastElementChild).toHaveStyle({ width: "24px", flexShrink: "0" });
    expect(root.childElementCount).toBe(3);

    rerender(
      <GroupHeader color={DARK} name="G" collapsed={false} onToggle={() => {}} extra={<span data-testid="x">3</span>} />,
    );
    const root2 = container.firstElementChild as HTMLElement;
    expect(root2.lastElementChild).toBe(screen.getByTestId("x"));
    expect(root2.childElementCount).toBe(3);
  });

  it("uses dark text on a light colour", () => {
    renderWithProviders(<GroupHeader color={LIGHT} name="Light" collapsed={false} onToggle={() => {}} />);
    expect(screen.getByText("Light")).toHaveStyle({ color: "rgb(0, 0, 0)" });
    expect(screen.getByRole("button", { name: t("actions.collapse") })).toHaveStyle({ color: "rgb(0, 0, 0)" });
  });

  it("uses white text on a dark colour and paints the bar with it", () => {
    const { container } = renderWithProviders(
      <GroupHeader color={DARK} name="Dark" collapsed={false} onToggle={() => {}} />,
    );
    expect(screen.getByText("Dark")).toHaveStyle({ color: "rgb(255, 255, 255)" });
    expect(container.firstElementChild).toHaveStyle({ backgroundColor: "rgb(0, 51, 153)" });
  });
});
