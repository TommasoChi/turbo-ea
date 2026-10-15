import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import i18n from "@/i18n";
import { readableTypeColor } from "@/lib/color";
import { renderWithProviders } from "@/test/render";
import BandHeader, { type BandReorder } from "./BandHeader";

const t = i18n.getFixedT("en", "valuechain");

function props(over: Partial<React.ComponentProps<typeof BandHeader>> = {}) {
  return {
    color: "#00796b",
    icon: "route",
    label: "Core processes",
    count: 3,
    collapsed: false,
    onToggle: () => {},
    ...over,
  };
}

function reorder(over: Partial<BandReorder> = {}): BandReorder {
  return { canMoveUp: true, canMoveDown: true, onMove: vi.fn(), ...over };
}

describe("BandHeader", () => {
  it("shows the uppercase-styled label, the count and the icon", () => {
    renderWithProviders(<BandHeader {...props()} />);
    expect(screen.getByText("Core processes")).toHaveStyle({ textTransform: "uppercase" });
    expect(screen.getByText("(3)")).toBeInTheDocument();
    expect(screen.getByText("route")).toBeInTheDocument();
  });

  it("toggles once from the collapse button and flips its label with collapsed", async () => {
    const onToggle = vi.fn();
    const { user, rerender } = renderWithProviders(<BandHeader {...props({ onToggle })} />);
    await user.click(screen.getByRole("button", { name: t("actions.collapse") }));
    expect(onToggle).toHaveBeenCalledTimes(1);

    rerender(<BandHeader {...props({ onToggle, collapsed: true })} />);
    expect(screen.getByRole("button", { name: t("actions.expand") })).toBeInTheDocument();
  });

  it("has no reorder arrows without reorder", () => {
    renderWithProviders(<BandHeader {...props()} />);
    expect(screen.queryByRole("button", { name: t("actions.moveUp") })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: t("actions.moveDown") })).not.toBeInTheDocument();
    expect(screen.getAllByRole("button")).toHaveLength(1);
  });

  it("shows both arrows, disables up when canMoveUp is false, and moves down once", async () => {
    const r = reorder({ canMoveUp: false });
    const { user } = renderWithProviders(<BandHeader {...props({ reorder: r })} />);
    const up = screen.getByRole("button", { name: t("actions.moveUp") });
    const down = screen.getByRole("button", { name: t("actions.moveDown") });
    expect(up).toBeDisabled();
    expect(down).toBeEnabled();

    // userEvent refuses to click a pointer-events:none button; fireEvent hits the handler path directly.
    fireEvent.click(up);
    expect(r.onMove).not.toHaveBeenCalled();

    await user.click(down);
    expect(r.onMove).toHaveBeenCalledTimes(1);
    expect(r.onMove).toHaveBeenCalledWith("down");
  });

  it("disables down when canMoveDown is false and moves up once", async () => {
    const r = reorder({ canMoveDown: false });
    const { user } = renderWithProviders(<BandHeader {...props({ reorder: r })} />);
    expect(screen.getByRole("button", { name: t("actions.moveDown") })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: t("actions.moveUp") }));
    expect(r.onMove).toHaveBeenCalledTimes(1);
    expect(r.onMove).toHaveBeenCalledWith("up");
  });

  it("darkens a near-white band colour for the icon accent on the light theme", () => {
    const pale = "#ffffe0";
    renderWithProviders(<BandHeader {...props({ color: pale })} />);
    const accent = readableTypeColor(pale, false);
    expect(accent).not.toBe(pale);
    expect(screen.getByText("route")).toHaveStyle({ color: accent });
  });
});
