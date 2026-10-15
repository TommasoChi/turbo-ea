import { useState } from "react";
import { screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import i18n from "@/i18n";
import { makeStreamRoot } from "@/test/fixtures/valueChain";
import { hookState } from "@/test/hooks";
import type { ValueStreamLeaf } from "@/types";
import { chevronClipPath } from "./shapes";
import { renderWithStream } from "./StreamContext.test-utils";
import StreamChevrons from "./StreamChevrons";
import { buildGeometry } from "./valueStreamLayout";

vi.mock("@/hooks/useIsRtl", () => import("@/test/hooks").then((m) => m.useIsRtlModule()));

const t = i18n.getFixedT("en", "valuechain");
const BAND = 5; // cross chevrons land on row 7, the sequence on row 8

function renderChevrons({
  sequence = makeStreamRoot().sequence,
  cross = makeStreamRoot().cross,
  collapsedGroups = {},
}: { sequence?: ValueStreamLeaf[]; cross?: ValueStreamLeaf[]; collapsedGroups?: Record<string, boolean> } = {}) {
  const onToggleGroup = vi.fn();
  const utils = renderWithStream(
    <StreamChevrons
      geometry={buildGeometry(sequence)}
      cross={cross}
      bandStartRow={BAND}
      collapsedGroups={collapsedGroups}
      onToggleGroup={onToggleGroup}
    />,
  );
  return { ...utils, onToggleGroup };
}

/** The same chevrons, with collapse state kept like the page keeps it. */
function Stateful() {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const root = makeStreamRoot();
  return (
    <StreamChevrons
      geometry={buildGeometry(root.sequence)}
      cross={root.cross}
      bandStartRow={BAND}
      collapsedGroups={collapsed}
      onToggleGroup={(id) => setCollapsed((prev) => ({ ...prev, [id]: !prev[id] }))}
    />
  );
}

const chevron = (name: string) => screen.getByRole("button", { name });
/** Grid cell of a parent-less chevron: button -> wrapper -> cell. */
const soloCell = (name: string) => chevron(name).parentElement!.parentElement!;
const groupCell = (title: string) => screen.getByText(title).closest("[data-group]") as HTMLElement;
const connectors = () => document.querySelectorAll("[data-connector]");

beforeEach(() => hookState.reset());

describe("StreamChevrons", () => {
  it("renders a parent-less leaf as a plain chevron in its own column on the sequence row", () => {
    renderChevrons();
    expect(soloCell("Attract")).toHaveStyle({ gridColumn: "2", gridRow: "8" });
    expect(soloCell("Attract").closest("[data-group]")).toBeNull();
    expect(chevron("Attract")).toHaveStyle({
      backgroundColor: "rgb(255, 245, 157)",
      color: "rgb(0, 0, 0)",
      height: "56px",
    });
    expect(chevron("Attract")).toHaveAttribute("tabindex", "0");
    expect(within(chevron("Attract")).getByText("Attract")).toHaveStyle({ WebkitLineClamp: "2" });
  });

  it("puts two leaves under the same parent inside one titled container spanning their columns", () => {
    renderChevrons();
    const group = groupCell("Recruit");
    expect(group).toHaveStyle({ gridColumn: "3/5", gridRow: "8", borderColor: "rgb(255, 245, 157)" });
    expect(within(group).getByRole("button", { name: "Select" })).toBeInTheDocument();
    expect(within(group).getByRole("button", { name: "Onboard" })).toBeInTheDocument();
    expect(within(group).queryByRole("button", { name: "Attract" })).toBeNull();
    expect(document.querySelectorAll("[data-group]")).toHaveLength(1);
  });

  it("chains every chevron to its successor column, not the last one", () => {
    renderChevrons();
    expect(connectors()).toHaveLength(2);
    expect(chevron("Attract").parentElement!.querySelector("[data-connector]")).toHaveStyle({
      height: "2px",
      backgroundColor: "rgba(0, 0, 0, 0.87)",
    });
    expect(chevron("Select").parentElement!.querySelector("[data-connector]")).not.toBeNull();
    expect(chevron("Onboard").parentElement!.querySelector("[data-connector]")).toBeNull();
  });

  it("collapsing a group hides only its chevrons, keeps its title and width, and leaves the other run alone", async () => {
    const { user } = renderWithStream(<Stateful />);
    await user.click(within(groupCell("Recruit")).getByRole("button", { name: t("actions.collapse") }));
    expect(screen.queryByRole("button", { name: "Select" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Onboard" })).toBeNull();
    expect(groupCell("Recruit")).toHaveStyle({ gridColumn: "3/5" });
    expect(chevron("Attract")).toBeInTheDocument();

    await user.click(within(groupCell("Recruit")).getByRole("button", { name: t("actions.expand") }));
    expect(chevron("Select")).toBeInTheDocument();
    expect(chevron("Onboard")).toBeInTheDocument();
  });

  it("reports the toggled parent id", async () => {
    const { user, onToggleGroup } = renderChevrons();
    await user.click(screen.getByRole("button", { name: t("actions.collapse") }));
    expect(onToggleGroup).toHaveBeenCalledTimes(1);
    expect(onToggleGroup).toHaveBeenCalledWith("g1");
  });

  it("keeps the connector on a collapsed group only when a column follows it", () => {
    const [a, b, c] = makeStreamRoot().sequence;
    renderChevrons({ sequence: [b, c, a], collapsedGroups: { g1: true } });
    expect(groupCell("Recruit")).toHaveStyle({ gridColumn: "2/4" });
    expect(groupCell("Recruit").querySelector("[data-connector]")).not.toBeNull();
    expect(connectors()).toHaveLength(1);
  });

  it("draws no connector on a collapsed group in the last columns", () => {
    renderChevrons({ collapsedGroups: { g1: true } });
    expect(groupCell("Recruit").querySelector("[data-connector]")).toBeNull();
    expect(connectors()).toHaveLength(1); // Attract -> Recruit
  });

  it("titles a group whose parent name is withheld with the translated fallback", () => {
    const hidden = { parent_id: "g9", parent_name: null };
    renderChevrons({
      sequence: [
        { id: "a", name: "Attract", ...hidden },
        { id: "b", name: "Select", ...hidden },
      ],
    });
    expect(groupCell(t("stream.hiddenGroup"))).toHaveStyle({ gridColumn: "2/4" });
  });

  it("opens the leaf card on click, Enter and Space, and the parent card from the group title", async () => {
    const { user, ctx } = renderChevrons();
    await user.click(chevron("Onboard"));
    expect(ctx.openCard).toHaveBeenLastCalledWith("c");
    chevron("Attract").focus();
    await user.keyboard("{Enter}");
    expect(ctx.openCard).toHaveBeenLastCalledWith("a");
    chevron("Select").focus();
    await user.keyboard(" ");
    expect(ctx.openCard).toHaveBeenLastCalledWith("b");
    await user.keyboard("x");
    expect(ctx.openCard).toHaveBeenCalledTimes(3);
    await user.click(screen.getByRole("button", { name: "Recruit" }));
    expect(ctx.openCard).toHaveBeenLastCalledWith("g1");
    expect(ctx.openCard).toHaveBeenCalledTimes(4);
  });

  it("stacks the cross-cutting leaves full width on the row above the sequence", () => {
    renderChevrons();
    const cross = screen.getByTitle(t("stream.crossCutting"));
    expect(cross).toHaveStyle({ gridColumn: "2/5", gridRow: "7" });
    expect(within(cross).getByRole("button", { name: "Plan and monitor" })).toBeInTheDocument();
    expect(within(cross).queryByRole("button", { name: "Attract" })).toBeNull();
    expect(cross.querySelector("[data-connector]")).toBeNull();
  });

  it("renders no cross-cutting cell when there is no cross leaf", () => {
    renderChevrons({ cross: [] });
    expect(screen.queryByTitle(t("stream.crossCutting"))).toBeNull();
    expect(screen.getAllByRole("button", { name: /Attract|Select|Onboard/ })).toHaveLength(3);
  });

  it("uses the left-to-right chevron by default and mirrors it under RTL", () => {
    const { unmount } = renderChevrons();
    expect(getComputedStyle(chevron("Attract")).clipPath).toBe(chevronClipPath(false));
    unmount();
    hookState.isRtl = true;
    renderChevrons();
    expect(getComputedStyle(chevron("Attract")).clipPath).toBe(chevronClipPath(true));
    expect(getComputedStyle(chevron("Plan and monitor")).clipPath.startsWith("polygon(100% 0")).toBe(true);
  });
});
