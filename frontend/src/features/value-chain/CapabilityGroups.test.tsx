import { useState } from "react";
import { screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import i18n from "@/i18n";
import { makeStreamRoot } from "@/test/fixtures/valueChain";
import type { ValueStreamCapability } from "@/types";
import CapabilityGroups from "./CapabilityGroups";
import { renderWithStream } from "@/test/valueStreamContext";
import { buildGeometry } from "./valueStreamLayout";

const t = i18n.getFixedT("en", "valuechain");
const CAP = "rgb(106, 27, 154)"; // TEST_TYPES.businessCapability #6a1b9a
const WHITE = "rgb(255, 255, 255)";

const cap = (id: string, name: string, leaf_id: string, group_id: string, group_name: string): ValueStreamCapability => ({
  id,
  name,
  leaf_id,
  group_id,
  group_name,
});
const FIXTURE = makeStreamRoot().capabilities; // cap1 "Recruiting" + capg "Talent", both in group capg of leaf a

function renderCaps(capabilities: ValueStreamCapability[] = FIXTURE, expandedGroups: Record<string, boolean> = {}) {
  const root = makeStreamRoot();
  const onToggleGroup = vi.fn();
  const utils = renderWithStream(
    <CapabilityGroups
      capabilities={capabilities}
      geometry={buildGeometry(root.sequence)}
      row={11}
      crossLeafIds={new Set(root.cross.map((l) => l.id))}
      expandedGroups={expandedGroups}
      onToggleGroup={onToggleGroup}
    />,
  );
  return { ...utils, onToggleGroup };
}

/** The same groups with expand state kept like the page keeps it. */
function Stateful({ capabilities }: { capabilities: ValueStreamCapability[] }) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const root = makeStreamRoot();
  return (
    <CapabilityGroups
      capabilities={capabilities}
      geometry={buildGeometry(root.sequence)}
      row={11}
      crossLeafIds={new Set(["x"])}
      expandedGroups={expanded}
      onToggleGroup={(key) => setExpanded((prev) => ({ ...prev, [key]: !prev[key] }))}
    />
  );
}

const button = (name: string) => screen.getByRole("button", { name });
const group = (title: string) => button(title).closest("[data-cap-group]") as HTMLElement;

describe("CapabilityGroups", () => {
  it("renders a multi-capability group as a container, collapsed by default", () => {
    renderCaps();
    expect(group("Talent")).toHaveStyle({ borderColor: CAP });
    expect(button("Talent").parentElement).toHaveStyle({ backgroundColor: CAP, color: WHITE });
    expect(button(t("actions.expand"))).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("Recruiting")).toBeNull();
    expect(screen.getAllByText("Talent")).toHaveLength(1);
  });

  it("expands only on an explicit true and lists the members in order", () => {
    const { unmount } = renderCaps(FIXTURE, { "a:capg": false });
    expect(screen.queryByText("Recruiting")).toBeNull();
    unmount();
    renderCaps(FIXTURE, { "a:capg": true });
    const container = document.querySelector("[data-cap-group]") as HTMLElement;
    const members = within(container).getAllByRole("button").slice(2); // after toggle + title
    expect(members.map((b) => b.textContent)).toEqual(["Recruiting", "Talent"]);
    expect(button(t("actions.collapse"))).toHaveAttribute("aria-expanded", "true");
  });

  it("reports the toggle under the leaf + group key, and opens cards", async () => {
    const { user, onToggleGroup, ctx } = renderCaps(FIXTURE, { "a:capg": true });
    await user.click(button(t("actions.collapse")));
    expect(onToggleGroup).toHaveBeenCalledTimes(1);
    expect(onToggleGroup).toHaveBeenCalledWith("a:capg");
    await user.click(button("Recruiting"));
    expect(ctx.openCard).toHaveBeenLastCalledWith("cap1");
    await user.click(screen.getAllByRole("button", { name: "Talent" })[0]);
    expect(ctx.openCard).toHaveBeenLastCalledWith("capg");
    button("Recruiting").focus();
    await user.keyboard("{Enter}");
    expect(ctx.openCard).toHaveBeenLastCalledWith("cap1");
    expect(ctx.openCard).toHaveBeenCalledTimes(3);
  });

  it("toggles the same group id independently per leaf", async () => {
    const caps = [...FIXTURE, cap("cap3", "Onboarding", "c", "capg", "Talent")];
    const { user } = renderWithStream(<Stateful capabilities={caps} />);
    const toggles = screen.getAllByRole("button", { name: t("actions.expand") });
    expect(toggles).toHaveLength(2);
    await user.click(toggles[0]);
    expect(button("Recruiting")).toBeInTheDocument();
    expect(screen.queryByText("Onboarding")).toBeNull();
    await user.click(button(t("actions.expand")));
    expect(button("Onboarding")).toBeInTheDocument();
  });

  it("draws a capability that is its own group, alone, as a single box", async () => {
    const { user, ctx } = renderCaps([cap("solo", "Payroll", "b", "solo", "Payroll")]);
    expect(document.querySelector("[data-cap-group]")).toBeNull();
    expect(screen.queryByRole("button", { name: t("actions.expand") })).toBeNull();
    expect(button("Payroll")).toHaveStyle({ borderColor: CAP });
    expect(within(button("Payroll")).getByText("Payroll")).toHaveStyle({ WebkitLineClamp: "2" });
    await user.click(button("Payroll"));
    expect(ctx.openCard).toHaveBeenCalledWith("solo");
  });

  it("wraps a lone capability of another group in that group's container", () => {
    renderCaps([cap("kid", "Benefits", "b", "par", "Rewards")]);
    expect(group("Rewards")).toBeInTheDocument();
    expect(screen.queryByText("Benefits")).toBeNull();
  });

  it("puts each sequence leaf's groups in its own subgrid column of the band row", () => {
    renderCaps([...FIXTURE, cap("s", "Scheduling", "c", "s", "Scheduling")]);
    const wrapper = document.querySelector("[data-caps]")!;
    expect(wrapper).toHaveStyle({ gridRow: "11", gridColumn: "2/5", display: "grid", gridTemplateColumns: "subgrid" });
    expect(group("Talent").parentElement).toHaveStyle({ gridColumn: "1", gridRow: "1" });
    expect(button("Scheduling").parentElement).toHaveStyle({ gridColumn: "3", gridRow: "1" });
    expect(wrapper.childElementCount).toBe(2);
    expect(document.querySelector("[data-cross]")).toBeNull();
  });

  it("renders cross-cutting capabilities in one full-width cell, and skips unknown leaves", () => {
    renderCaps([
      cap("x1", "Reporting", "x", "x1", "Reporting"),
      ...FIXTURE,
      cap("x2", "Budgeting", "x", "fin", "Finance"),
      cap("lost", "Lost", "zz", "lost", "Lost"),
    ]);
    const cross = document.querySelector("[data-cross]") as HTMLElement;
    expect(cross).toHaveStyle({ gridColumn: "1/-1", gridRow: "2", display: "flex", flexWrap: "wrap" });
    expect(cross.parentElement!.lastElementChild).toBe(cross);
    expect(within(cross).getByRole("button", { name: "Reporting" })).toHaveStyle({ width: "210px" });
    expect(within(cross).getByRole("button", { name: "Finance" }).closest("[data-cap-group]")).toHaveStyle({
      width: "210px",
    });
    expect(within(cross).queryByText("Talent")).toBeNull();
    expect(screen.queryByText("Lost")).toBeNull();
  });

  it("renders nothing without capabilities", () => {
    const { container } = renderCaps([]);
    expect(container).toBeEmptyDOMElement();
  });
});
