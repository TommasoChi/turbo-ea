import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import i18n from "@/i18n";
import type { ValueStreamGoal } from "@/types";
import GoalPanel from "./GoalPanel";
import type { StreamContextValue } from "./StreamContext";
import { renderWithStream, TEST_TYPES } from "@/test/valueStreamContext";

const t = i18n.getFixedT("en", "valuechain");
const OBJECTIVE = "rgb(13, 71, 161)"; // TEST_TYPES.objective #0d47a1
const PALE = "rgb(255, 245, 157)"; // #fff59d
const WHITE = "rgb(255, 255, 255)";
const BLACK = "rgb(0, 0, 0)";

const GOALS: ValueStreamGoal[] = [
  { id: "goal1", name: "Improve talent management", description: "Hire faster.\nKeep people." },
  { id: "goal2", name: "Cut costs", description: null },
  { id: "goal3", name: "Grow", description: "" },
];

function renderPanel(collapsed = false, overrides: Partial<StreamContextValue> = {}) {
  const onToggle = vi.fn();
  const utils = renderWithStream(
    <GoalPanel goals={GOALS} totalRows={15} lastCol={4} collapsed={collapsed} onToggle={onToggle} />,
    overrides,
  );
  return { ...utils, onToggle };
}

const button = (name: string) => screen.getByRole("button", { name });
const strip = () => document.querySelector("[data-goal-strip]") as HTMLElement;
const panel = () => document.querySelector("[data-goal-panel]") as HTMLElement;

describe("GoalPanel", () => {
  it("renders the separator strip and the full-height panel after the last leaf column", () => {
    renderPanel();
    expect(strip()).toHaveStyle({ gridRow: "1/16", gridColumn: "5", pointerEvents: "none" });
    expect(strip()).toBeEmptyDOMElement();
    expect(panel()).toHaveStyle({
      gridRow: "1/16",
      gridColumn: "6",
      borderColor: OBJECTIVE,
      minWidth: "200px",
      maxWidth: "260px",
    });
    expect(screen.getByText(t("stream.goal.title"))).toHaveStyle({ textTransform: "uppercase" });
    expect(screen.getByText("(3)")).toBeInTheDocument();
  });

  it("paints each goal in the Objective colour with readable text, dark and pale", () => {
    const { unmount } = renderPanel();
    expect(button("Cut costs").parentElement).toHaveStyle({ backgroundColor: OBJECTIVE, color: WHITE });
    unmount();
    renderPanel(false, { types: { ...TEST_TYPES, objective: { ...TEST_TYPES.objective, color: "#fff59d" } } });
    expect(button("Cut costs").parentElement).toHaveStyle({ backgroundColor: PALE, color: BLACK });
  });

  it("collapses to a narrow strip that hides the title and the goals", async () => {
    const { user, onToggle } = renderPanel(true);
    expect(panel()).toHaveStyle({ minWidth: "44px", maxWidth: "44px" });
    expect(screen.queryByText(t("stream.goal.title"))).toBeNull();
    expect(screen.queryByText("(3)")).toBeNull();
    expect(screen.queryByText("Cut costs")).toBeNull();
    await user.click(button(t("actions.expand")));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it("shows a description by default and toggles it without opening the card", async () => {
    const { user, ctx } = renderPanel();
    const description = screen.getByText(/Hire faster\./);
    expect(description).toHaveStyle({ whiteSpace: "pre-wrap" });
    expect(description.textContent).toBe("Hire faster.\nKeep people.");
    await user.click(button(t("actions.hideDescription")));
    expect(screen.queryByText(/Hire faster\./)).toBeNull();
    expect(button(t("actions.showDescription"))).toHaveAttribute("aria-expanded", "false");
    await user.click(button(t("actions.showDescription")));
    expect(screen.getByText(/Hire faster\./)).toBeInTheDocument();
    expect(ctx.openCard).not.toHaveBeenCalled();
  });

  it("offers no description toggle for a goal without a description", () => {
    renderPanel();
    expect(screen.getAllByRole("button", { name: t("actions.hideDescription") })).toHaveLength(1);
    expect(screen.queryByRole("button", { name: t("actions.showDescription") })).toBeNull();
  });

  it("opens the goal card by click, Enter and Space", async () => {
    const { user, ctx } = renderPanel();
    await user.click(button("Grow"));
    expect(ctx.openCard).toHaveBeenLastCalledWith("goal3");
    const name = button("Cut costs");
    expect(name).toHaveAttribute("tabindex", "0");
    expect(fireEvent.keyDown(name, { key: "Enter" })).toBe(false);
    expect(fireEvent.keyDown(name, { key: " " })).toBe(false);
    expect(fireEvent.keyDown(name, { key: "Tab" })).toBe(true);
    expect(ctx.openCard.mock.calls).toEqual([["goal3"], ["goal2"], ["goal2"]]);
  });
});
