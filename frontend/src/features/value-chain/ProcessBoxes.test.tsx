import { fireEvent, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import i18n from "@/i18n";
import { makeStreamRoot } from "@/test/fixtures/valueChain";
import type { ValueStreamRoot } from "@/types";
import ProcessBoxes, { ProcessColorByFields, ProcessLegend } from "./ProcessBoxes";
import type { StreamContextValue } from "./StreamContext";
import { renderWithStream, TEST_TYPES } from "@/test/valueStreamContext";
import { buildGeometry, planProcessPlacements } from "./valueStreamLayout";

const t = i18n.getFixedT("en", "valuechain");
const BAND = 6; // process rows start at BAND + 2 = 8

const SUPPORT = "rgb(142, 36, 170)"; // #8e24aa
const MANAGEMENT = "rgb(0, 121, 107)"; // #00796b
const CORE = "rgb(25, 118, 210)"; // #1976d2
const PROCESS = "rgb(46, 125, 50)"; // TEST_TYPES.businessProcess #2e7d32
const GREY = "rgb(158, 158, 158)"; // STATUS_COLORS.neutral
const APP = "rgb(1, 87, 155)"; // TEST_TYPES.application #01579b
const ORG = "rgb(78, 52, 46)"; // TEST_TYPES.organization #4e342e
const PALE_HEX = "#fff59d";
const PALE = "rgb(255, 245, 157)";
const WHITE = "rgb(255, 255, 255)";
const BLACK = "rgb(0, 0, 0)";
const GROUP_KEY = "a-row0:p-group"; // `${placement.key}:${item.id}`

function renderBoxes(
  root: ValueStreamRoot = makeStreamRoot(),
  overrides: Partial<StreamContextValue> = {},
  collapsedGroups: Record<string, boolean> = {},
) {
  const onToggleGroup = vi.fn();
  const placements = planProcessPlacements(root, buildGeometry(root.sequence));
  const utils = renderWithStream(
    <ProcessBoxes
      placements={placements}
      root={root}
      bandStartRow={BAND}
      collapsedGroups={collapsedGroups}
      onToggleGroup={onToggleGroup}
    />,
    overrides,
  );
  return { ...utils, onToggleGroup };
}

const button = (name: string) => screen.getByRole("button", { name });
const card = (id: string) => document.querySelector(`[data-process="${id}"]`) as HTMLElement;
/** The chip's own label (its textContent also holds the icon's ligature name). */
const chipLabel = (chip: HTMLElement) => chip.querySelector(".MuiChip-label");
/** Background of the element's last `.Mui-focusVisible` stylesheet rule (MUI's own, unless sx overrides it). */
function focusVisibleBackground(el: HTMLElement): string {
  const classes = Array.from(el.classList).filter((c) => c.startsWith("css-"));
  const rules = Array.from(document.styleSheets)
    .flatMap((sheet) => Array.from(sheet.cssRules))
    .filter((r): r is CSSStyleRule => "selectorText" in r)
    .filter(
      (r) =>
        classes.some((c) => r.selectorText.includes(`.${c}.Mui-focusVisible`)) &&
        r.style.getPropertyValue("background-color") !== "",
    );
  return rules.at(-1)?.style.getPropertyValue("background-color") ?? "";
}
const viewFlow = () => t("actions.viewFlow");
const paleProcessType = { ...TEST_TYPES, businessProcess: { ...TEST_TYPES.businessProcess, color: PALE_HEX } };

describe("ProcessBoxes", () => {
  it("(1) shows neither the steps chip nor View flow for a process without steps", () => {
    const root = makeStreamRoot();
    root.processes["p-span"].element_count = 1;
    renderBoxes(root);
    const solo = card("p-solo");
    expect(within(solo).queryByRole("button", { name: viewFlow() })).toBeNull();
    expect(solo.querySelector(".MuiChip-root")).toBeNull();
    expect(within(solo).getByText(t("stream.subtype.process"))).toBeInTheDocument();
    const span = card("p-span");
    expect(chipLabel(within(span).getByLabelText(t("stream.steps", { count: 1 })))).toHaveTextContent(/^1$/);
    expect(within(span).getByRole("button", { name: viewFlow() })).toBeInTheDocument();
  });

  it("(2) opens the process from its name and the flow from View flow only", async () => {
    const { user, ctx } = renderBoxes();
    await user.click(screen.getByText("Interview"));
    expect(ctx.openProcess).toHaveBeenCalledTimes(1);
    expect(ctx.openProcess).toHaveBeenLastCalledWith("p-span");
    await user.click(within(card("p-span")).getByRole("button", { name: viewFlow() }));
    expect(ctx.openFlow).toHaveBeenCalledTimes(1);
    expect(ctx.openFlow).toHaveBeenLastCalledWith("p-span");
    expect(ctx.openProcess).toHaveBeenCalledTimes(1);

    const group = card("p-group");
    expect(chipLabel(within(group).getByLabelText(t("stream.steps", { count: 9 })))).toHaveTextContent(/^9$/);
    await user.click(within(group).getAllByRole("button", { name: viewFlow() })[0]);
    expect(ctx.openFlow).toHaveBeenLastCalledWith("p-group");
    expect(ctx.openProcess).toHaveBeenCalledTimes(1);
    await user.click(button("Sourcing"));
    expect(ctx.openProcess).toHaveBeenLastCalledWith("p-group");
    expect(ctx.openProcess).toHaveBeenCalledTimes(2);
  });

  it("opens a process from the keyboard with Enter and Space, preventing the default", () => {
    const { ctx } = renderBoxes();
    for (const name of ["Interview", "Sourcing"]) {
      const el = button(name);
      expect(el).toHaveAttribute("tabindex", "0");
      expect(fireEvent.keyDown(el, { key: "Enter" })).toBe(false);
      expect(fireEvent.keyDown(el, { key: " " })).toBe(false);
      expect(fireEvent.keyDown(el, { key: "a" })).toBe(true);
    }
    expect(ctx.openProcess.mock.calls).toEqual([["p-span"], ["p-span"], ["p-group"], ["p-group"]]);
  });

  it("(3) keeps a collapsed container's own chips and hides its children", async () => {
    const root = makeStreamRoot();
    root.processes["p-child"].related = [{ id: "d1", name: "CV store" }];
    const { user, onToggleGroup } = renderBoxes(root, { related: "applications" }, { [GROUP_KEY]: true });
    expect(button("Workday")).toBeInTheDocument();
    expect(screen.queryByText("Screen CVs")).toBeNull();
    expect(screen.queryByText("CV store")).toBeNull();
    expect(within(card("p-group")).getByLabelText(t("stream.children", { count: 1 }))).toHaveTextContent(/^1$/);
    expect(within(card("p-group")).getByText(t("stream.subtype.group"))).toBeInTheDocument();
    await user.click(button(t("actions.expand")));
    expect(onToggleGroup).toHaveBeenCalledTimes(1);
    expect(onToggleGroup).toHaveBeenCalledWith(GROUP_KEY);
  });

  it("(3) shows an expanded container's children, each in its own colour", () => {
    const root = makeStreamRoot();
    root.processes["p-child"].related = [{ id: "d1", name: "CV store" }];
    renderBoxes(root, { related: "applications" });
    expect(button("Workday")).toBeInTheDocument();
    expect(button("CV store")).toBeInTheDocument();
    expect(button(t("actions.collapse"))).toBeInTheDocument();
    expect(button("Sourcing").parentElement).toHaveStyle({ backgroundColor: SUPPORT, color: WHITE });
    expect(button("Screen CVs")).toHaveStyle({ backgroundColor: MANAGEMENT, color: WHITE });
    expect(within(button("Screen CVs")).getByText("Screen CVs")).toHaveStyle({ WebkitLineClamp: "2" });
    expect(within(card("p-group")).getByText("Screen CVs")).toBeInTheDocument();
  });

  it("paints every box in the flat process colour in 'none' mode, with readable text on a pale fill", () => {
    const { unmount } = renderBoxes(makeStreamRoot(), { processColorBy: "none" });
    expect(button("Post job ad")).toHaveStyle({ backgroundColor: PROCESS, color: WHITE });
    expect(button("Sourcing").parentElement).toHaveStyle({ backgroundColor: PROCESS });
    unmount();
    renderBoxes(makeStreamRoot(), { processColorBy: "none", types: paleProcessType });
    expect(button("Sourcing").parentElement).toHaveStyle({ backgroundColor: PALE, color: BLACK });
    for (const name of ["Screen CVs", "Post job ad", "Interview", "Reporting"]) {
      expect(button(name)).toHaveStyle({ backgroundColor: PALE, color: BLACK });
    }
  });

  it("(4) paints an unknown or missing attribute value grey and never shows the raw key", () => {
    const root = makeStreamRoot();
    root.processes["p-cross"].color_attributes = { processType: "core" };
    const { container } = renderBoxes(root);
    expect(button("Post job ad")).toHaveStyle({ backgroundColor: GREY });
    expect(button("Interview")).toHaveStyle({ backgroundColor: GREY });
    expect(button("Reporting")).toHaveStyle({ backgroundColor: CORE });
    expect(container.innerHTML).not.toContain("zzz-unknown");
  });

  it("captions known subtypes and falls back to Process for unknown or null ones", () => {
    const root = makeStreamRoot();
    root.processes["p-solo"].subtype = "variant";
    root.processes["p-span"].subtype = "weird-subtype";
    root.processes["p-cross"].subtype = null;
    const { container } = renderBoxes(root);
    expect(within(card("p-solo")).getByText(t("stream.subtype.variant"))).toBeInTheDocument();
    expect(within(card("p-span")).getByText(t("stream.subtype.process"))).toBeInTheDocument();
    expect(within(card("p-cross")).getByText(t("stream.subtype.process"))).toBeInTheDocument();
    expect(container.innerHTML).not.toContain("weird-subtype");
  });

  it("(5) colours related chips by the related type and opens their card", async () => {
    const { user, ctx } = renderBoxes(makeStreamRoot(), { related: "applications" });
    expect(button("Workday")).toHaveStyle({ backgroundColor: APP, color: WHITE, height: "20px" });
    await user.click(button("Workday"));
    expect(ctx.openCard).toHaveBeenCalledWith("app1");
    expect(ctx.openProcess).not.toHaveBeenCalled();
  });

  it("(5) keeps a related chip's fill on keyboard focus", () => {
    renderBoxes(makeStreamRoot(), { related: "applications" });
    expect(focusVisibleBackground(button("Workday"))).toBe("#01579b");
  });

  it("(5) uses the organization and data-object colours, readable on a pale fill", () => {
    const { unmount } = renderBoxes(makeStreamRoot(), { related: "organization" });
    expect(button("Workday")).toHaveStyle({ backgroundColor: ORG, color: WHITE });
    unmount();
    renderBoxes(makeStreamRoot(), {
      related: "dataObjects",
      types: { ...TEST_TYPES, dataObject: { ...TEST_TYPES.dataObject, color: PALE_HEX } },
    });
    expect(button("Workday")).toHaveStyle({ backgroundColor: PALE, color: BLACK });
  });

  it("(5) shows no related chips in 'none' mode", () => {
    renderBoxes();
    expect(screen.queryByText("Workday")).toBeNull();
  });

  it("(6) draws the span process once and skips ids missing from root.processes", () => {
    const root = makeStreamRoot({
      leaf_processes: {
        a: [{ id: "p-group", children: ["p-child", "ghost"] }, { id: "ghost-top", children: [] }, { id: "p-solo", children: [] }],
        b: [],
        c: [],
      },
    });
    renderBoxes(root);
    expect(screen.getAllByText("Interview")).toHaveLength(1);
    expect(button("Screen CVs")).toBeInTheDocument();
    expect(button("Post job ad")).toBeInTheDocument();
    expect(within(card("p-group")).getByLabelText(t("stream.children", { count: 1 }))).toBeInTheDocument();
    expect(document.querySelectorAll("[data-process]")).toHaveLength(5);
  });

  it("(7) places each box on bandStartRow + 2 + its level row", () => {
    renderBoxes();
    const cell = (id: string) => card(id).closest("[data-placement]");
    expect(cell("p-group")).toHaveStyle({ gridRow: "8", gridColumn: "2" });
    expect(cell("p-solo")).toHaveStyle({ gridRow: "9", gridColumn: "2" });
    expect(cell("p-span")).toHaveStyle({ gridRow: "8", gridColumn: "3/5" });
    expect(cell("p-cross")).toHaveStyle({ gridRow: "9", gridColumn: "2/5" });
    expect(document.querySelectorAll("[data-placement]")).toHaveLength(4);
  });
});

describe("ProcessColorByFields", () => {
  it("lists the colour-by attributes and reports a new choice", async () => {
    const { user, ctx } = renderWithStream(<ProcessColorByFields />);
    expect(screen.getByLabelText(t("stream.colorBy"))).toHaveTextContent("Process kind");
    await user.click(screen.getByLabelText(t("stream.colorBy")));
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual([
      t("stream.colorBy.none"),
      "Process kind",
      t("stream.colorBy.maturity"),
      t("stream.colorBy.automationLevel"),
      t("stream.colorBy.riskLevel"),
    ]);
    await user.click(screen.getByRole("option", { name: t("stream.colorBy.riskLevel") }));
    expect(ctx.setProcessColorBy).toHaveBeenCalledTimes(1);
    expect(ctx.setProcessColorBy).toHaveBeenCalledWith("riskLevel");
    expect(ctx.setRelated).not.toHaveBeenCalled();
  });

  it("lists the related modes and reports a new choice", async () => {
    const { user, ctx } = renderWithStream(<ProcessColorByFields />);
    expect(screen.getByLabelText(t("stream.showRelated"))).toHaveTextContent(t("stream.related.none"));
    await user.click(screen.getByLabelText(t("stream.showRelated")));
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual([
      t("stream.related.none"),
      t("stream.related.applications"),
      t("stream.related.dataObjects"),
      t("stream.related.organization"),
    ]);
    await user.click(screen.getByRole("option", { name: t("stream.related.dataObjects") }));
    expect(ctx.setRelated).toHaveBeenCalledTimes(1);
    expect(ctx.setRelated).toHaveBeenCalledWith("dataObjects");
    expect(ctx.setProcessColorBy).not.toHaveBeenCalled();
  });
});

describe("ProcessLegend", () => {
  const dot = (label: string) => screen.getByText(label).previousElementSibling;
  const labels = () => screen.getAllByText(/./).map((n) => n.textContent);

  it("(8) lists the colour-by entries plus Not set", () => {
    renderWithStream(<ProcessLegend />);
    expect(labels()).toEqual(["Management", "Core", "Support", t("legend.notSet")]);
    expect(dot("Management")).toHaveStyle({ backgroundColor: MANAGEMENT });
    expect(dot(t("legend.notSet"))).toHaveStyle({ backgroundColor: GREY });
  });

  it("(8) adds the related type entry", () => {
    renderWithStream(<ProcessLegend />, { related: "applications" });
    const related = t("legend.related", { type: "Application" });
    expect(labels()).toEqual(["Management", "Core", "Support", t("legend.notSet"), related]);
    expect(dot(related)).toHaveStyle({ backgroundColor: APP });
  });

  it("(8) shows only the related entry without a colour-by attribute", () => {
    renderWithStream(<ProcessLegend />, { processColorBy: "none", related: "organization" });
    expect(labels()).toEqual([t("legend.related", { type: "Organization" })]);
  });

  it("(8) renders nothing when both are none", () => {
    const { container } = renderWithStream(<ProcessLegend />, { processColorBy: "none" });
    expect(container).toBeEmptyDOMElement();
  });
});
