import { screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import i18n from "@/i18n";
import { renderWithProviders } from "@/test/render";
import CollapseToggle from "./CollapseToggle";

const t = i18n.getFixedT("en", "valuechain");

describe("CollapseToggle", () => {
  it("offers to expand when collapsed", () => {
    renderWithProviders(<CollapseToggle collapsed onToggle={() => {}} />);
    const btn = screen.getByRole("button", { name: t("actions.expand") });
    expect(btn).toHaveAttribute("aria-expanded", "false");
    expect(btn).toHaveTextContent("add");
    expect(screen.queryByRole("button", { name: t("actions.collapse") })).not.toBeInTheDocument();
  });

  it("offers to collapse when expanded", () => {
    renderWithProviders(<CollapseToggle collapsed={false} onToggle={() => {}} />);
    const btn = screen.getByRole("button", { name: t("actions.collapse") });
    expect(btn).toHaveAttribute("aria-expanded", "true");
    expect(btn).toHaveTextContent("remove");
  });

  it("calls onToggle exactly once per click and does not bubble to the parent", async () => {
    const onToggle = vi.fn();
    const onParentClick = vi.fn();
    const { user } = renderWithProviders(
      <div onClick={onParentClick}>
        <CollapseToggle collapsed={false} onToggle={onToggle} />
      </div>,
    );
    await user.click(screen.getByRole("button", { name: t("actions.collapse") }));
    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(onParentClick).not.toHaveBeenCalled();
  });

  it("applies the given colour to the icon and the border", () => {
    renderWithProviders(<CollapseToggle collapsed onToggle={() => {}} color="rgb(1, 2, 3)" />);
    expect(screen.getByRole("button", { name: t("actions.expand") })).toHaveStyle({
      color: "rgb(1, 2, 3)",
      borderColor: "rgb(1, 2, 3)",
    });
  });
});
