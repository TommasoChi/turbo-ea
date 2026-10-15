import { screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import i18n from "@/i18n";
import { makeChainResponse } from "@/test/fixtures/valueChain";
import { hookState } from "@/test/hooks";
import { renderWithProviders } from "@/test/render";
import type { ValueChainCoreHouse } from "@/types";
import CoreHouse from "./CoreHouse";
import { chevronClipPath, pentagonClipPath } from "./shapes";

vi.mock("@/hooks/useMetamodel", () => import("@/test/hooks").then((m) => m.useMetamodelModule()));
vi.mock("@/hooks/useIsRtl", () => import("@/test/hooks").then((m) => m.useIsRtlModule()));

const t = i18n.getFixedT("en", "valuechain");
const COLOR = "#00796b";

function renderHouse(house: ValueChainCoreHouse = makeChainResponse().core_house) {
  const onOpenCard = vi.fn();
  const onDrill = vi.fn();
  const utils = renderWithProviders(
    <CoreHouse house={house} color={COLOR} onOpenCard={onOpenCard} onDrill={onDrill} />,
  );
  return { ...utils, onOpenCard, onDrill };
}

const chevron = (name: string) => screen.getByText(name).parentElement!;

beforeEach(() => hookState.reset());

describe("CoreHouse", () => {
  it("lays out one chevron per level-one stream, its level-two boxes and its level-three category box", () => {
    renderHouse();
    expect(chevron("Sales")).toHaveStyle({ backgroundColor: COLOR, color: "#ffffff" });
    expect(chevron("Sales")).toHaveStyle({ gridColumn: "1", gridRow: "1" });
    expect(chevron("Delivery")).toHaveStyle({ gridColumn: "2", gridRow: "1" });

    const level2 = screen.getByText("Prospecting").closest("[data-level='2']")!;
    expect(level2).toHaveStyle({ gridColumn: "1", gridRow: "2" });
    expect(screen.getAllByText("Prospecting")).toHaveLength(1);

    const level3 = screen.getByText("Lead-to-Order").closest("[data-level='3']")!;
    expect(level3).toHaveStyle({ gridColumn: "1", gridRow: "3" });
    expect(within(level3 as HTMLElement).getByText(t("box.processGroup"))).toBeInTheDocument();
    expect(within(level3 as HTMLElement).getByText("Lead-to-Order").parentElement).toHaveStyle({
      backgroundColor: COLOR,
    });
    // Delivery has neither level-two nor level-three entries.
    expect(document.querySelectorAll("[data-level='2']")).toHaveLength(1);
    expect(document.querySelectorAll("[data-level='3']")).toHaveLength(1);
  });

  it("sizes the grid with one column per level-one stream and shows both bookends", () => {
    renderHouse();
    const grid = chevron("Sales").parentElement!;
    expect(grid).toHaveStyle({ display: "grid", gridTemplateColumns: "repeat(2, minmax(220px, 1fr))" });
    expect(screen.getByText(t("house.customerRequest"))).toBeInTheDocument();
    expect(screen.getByText(t("house.customerSatisfaction"))).toBeInTheDocument();
    expect(screen.getByText(t("house.customerRequest")).parentElement).toHaveStyle({ backgroundColor: COLOR });
    expect(screen.getByText(t("house.customerRequest"))).toHaveStyle({ writingMode: "vertical-rl" });
  });

  it("shows only the placeholder, with no bookends, when there is no level-one stream", () => {
    renderHouse({ level_one: [], level_two: {}, level_three: {} });
    expect(screen.getByText(t("house.empty"))).toBeInTheDocument();
    expect(screen.queryByText(t("house.customerRequest"))).not.toBeInTheDocument();
    expect(screen.queryByText(t("house.customerSatisfaction"))).not.toBeInTheDocument();
  });

  it("opens cards from the chevron, the level-two box and the level-three box, and drills from the +", async () => {
    const { user, onOpenCard, onDrill } = renderHouse();
    await user.click(screen.getByText("Delivery"));
    expect(onOpenCard).toHaveBeenLastCalledWith("l1b");
    await user.click(screen.getByText("Sales"));
    expect(onOpenCard).toHaveBeenLastCalledWith("l1a");
    await user.click(screen.getByText("Prospecting"));
    expect(onOpenCard).toHaveBeenLastCalledWith("l2a");
    await user.click(screen.getByText("Lead-to-Order"));
    expect(onOpenCard).toHaveBeenLastCalledWith("c1");
    expect(onOpenCard).toHaveBeenCalledTimes(4);

    await user.click(screen.getByRole("button", { name: t("box.drillDown", { name: "Lead-to-Order" }) }));
    expect(onDrill).toHaveBeenCalledTimes(1);
    expect(onDrill).toHaveBeenCalledWith("c1");
  });

  it("uses the left-to-right chevron and pentagon shapes by default", () => {
    renderHouse();
    expect(getComputedStyle(chevron("Sales")).clipPath).toBe(chevronClipPath(false));
    expect(getComputedStyle(chevron("Sales")).clipPath.startsWith("polygon(0 0")).toBe(true);
    const bar = screen.getByText(t("house.customerRequest")).parentElement!;
    expect(getComputedStyle(bar).clipPath).toBe(pentagonClipPath(false));
  });

  it("mirrors the chevrons and the pentagon bookends under RTL", () => {
    hookState.isRtl = true;
    renderHouse();
    expect(getComputedStyle(chevron("Sales")).clipPath).toBe(chevronClipPath(true));
    expect(getComputedStyle(chevron("Sales")).clipPath.startsWith("polygon(100% 0")).toBe(true);
    for (const label of [t("house.customerRequest"), t("house.customerSatisfaction")]) {
      expect(getComputedStyle(screen.getByText(label).parentElement!).clipPath).toBe(pentagonClipPath(true));
    }
  });
});
