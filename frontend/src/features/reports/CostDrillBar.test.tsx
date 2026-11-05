import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import CostDrillBar from "./CostDrillBar";
import type { Crumb } from "./costDrill";

const root: Crumb = { kind: "root", label: "All", target: {} };
const group: Crumb = { kind: "group", label: "Finance", target: { group: "fin" } };
const card: Crumb = { kind: "card", label: "SAP", target: { group: "fin", cardId: "a" } };

describe("CostDrillBar", () => {
  it("shows the hint and no Back at the root", () => {
    render(<CostDrillBar crumbs={[root]} onSelect={vi.fn()} hint="Click: analyse" />);
    expect(screen.getByText("Click: analyse")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /back/i })).not.toBeInTheDocument();
  });

  it("Back selects the parent level", async () => {
    const onSelect = vi.fn();
    render(<CostDrillBar crumbs={[root, group, card]} onSelect={onSelect} hint="h" />);
    await userEvent.click(screen.getByRole("button", { name: /back/i }));
    expect(onSelect).toHaveBeenCalledWith({ group: "fin" });
  });

  it("clicking the root crumb resets, the current crumb is not a button", async () => {
    const onSelect = vi.fn();
    render(<CostDrillBar crumbs={[root, group, card]} onSelect={onSelect} hint="h" />);
    await userEvent.click(screen.getByRole("button", { name: "All" }));
    expect(onSelect).toHaveBeenCalledWith({});
    expect(screen.getByText("SAP")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "SAP" })).not.toBeInTheDocument();
  });
});
