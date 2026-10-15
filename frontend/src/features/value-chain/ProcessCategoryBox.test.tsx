import { screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import i18n from "@/i18n";
import { renderWithProviders } from "@/test/render";
import { hookState } from "@/test/hooks";
import { CARD_TYPE_COLORS } from "@/theme/tokens";
import type { ValueChainBox } from "@/types";
import ProcessCategoryBox from "./ProcessCategoryBox";

vi.mock("@/hooks/useMetamodel", () => import("@/test/hooks").then((m) => m.useMetamodelModule()));

const t = i18n.getFixedT("en", "valuechain");

const BOX: ValueChainBox = {
  id: "b1",
  name: "Lead-to-Order",
  has_children: true,
  process_type: "core",
  group_count: 2,
  process_count: 5,
  value_stream_count: 3,
  value_gate_count: 1,
};

function renderBox(over: Partial<ValueChainBox> = {}, headerColor = "#00796b") {
  const onOpenCard = vi.fn();
  const onDrill = vi.fn();
  const utils = renderWithProviders(
    <ProcessCategoryBox box={{ ...BOX, ...over }} headerColor={headerColor} onOpenCard={onOpenCard} onDrill={onDrill} />,
  );
  return { ...utils, onOpenCard, onDrill };
}

beforeEach(() => hookState.reset());

describe("ProcessCategoryBox", () => {
  it("renders each count from the payload next to its translated label", () => {
    renderBox();
    for (const [label, count] of [
      [t("box.processGroup"), "2"],
      [t("box.process"), "5"],
      [t("box.valueStream"), "3"],
      [t("box.valueGate"), "1"],
    ]) {
      const row = screen.getByText(label).parentElement!.parentElement!;
      expect(within(row).getByText(count)).toBeInTheDocument();
    }
  });

  it("colours each pill with its card type and shows the type icon", () => {
    renderBox();
    const pill = (n: string) => screen.getByText(n).closest(".MuiChip-root");
    expect(pill("2")).toHaveStyle({ backgroundColor: CARD_TYPE_COLORS.BusinessProcess });
    expect(pill("5")).toHaveStyle({ backgroundColor: CARD_TYPE_COLORS.BusinessProcess });
    expect(pill("3")).toHaveStyle({ backgroundColor: CARD_TYPE_COLORS.BusinessContext });
    expect(pill("1")).toHaveStyle({ backgroundColor: CARD_TYPE_COLORS.Objective });
    expect(screen.getAllByText("route")).toHaveLength(2);
    expect(screen.getByText("conveyor_belt")).toBeInTheDocument();
    expect(screen.getByText("flag")).toBeInTheDocument();
  });

  it("opens the card from the name and from every count row", async () => {
    const { user, onOpenCard } = renderBox();
    await user.click(screen.getByText("Lead-to-Order"));
    expect(onOpenCard).toHaveBeenLastCalledWith("b1");
    for (const label of [t("box.processGroup"), t("box.process"), t("box.valueStream"), t("box.valueGate")]) {
      onOpenCard.mockClear();
      await user.click(screen.getByText(label));
      expect(onOpenCard).toHaveBeenCalledTimes(1);
      expect(onOpenCard).toHaveBeenCalledWith("b1");
    }
  });

  it("offers the drill-down button only with children, and drills without opening the card", async () => {
    const { user, onDrill, onOpenCard } = renderBox();
    const plus = screen.getByRole("button", { name: t("box.drillDown", { name: "Lead-to-Order" }) });
    expect(plus).toHaveTextContent("+");
    await user.click(plus);
    expect(onDrill).toHaveBeenCalledTimes(1);
    expect(onDrill).toHaveBeenCalledWith("b1");
    expect(onOpenCard).not.toHaveBeenCalled();
  });

  it("has no drill-down button for a leaf box", () => {
    renderBox({ has_children: false });
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("uses dark header text on a light header colour and light text on a dark one", () => {
    const { unmount } = renderBox({}, "#ffff00");
    expect(screen.getByText("Lead-to-Order").parentElement).toHaveStyle({
      backgroundColor: "#ffff00",
      color: "#000000",
    });
    unmount();
    renderBox({}, "#00796b");
    expect(screen.getByText("Lead-to-Order").parentElement).toHaveStyle({
      backgroundColor: "#00796b",
      color: "#ffffff",
    });
  });
});
