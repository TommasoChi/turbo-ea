import { screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import i18n from "@/i18n";
import { makeStreamRoot } from "@/test/fixtures/valueChain";
import { hookState } from "@/test/hooks";
import type { ValueStreamRoot } from "@/types";
import type { StreamContextValue } from "./StreamContext";
import { renderWithStream } from "./StreamContext.test-utils";
import type { StreamBandKey } from "./valueChainModel";
import ValueStreamRootView, { type ValueStreamRootViewProps } from "./ValueStreamRoot";

vi.mock("@/hooks/useIsRtl", () => import("@/test/hooks").then((m) => m.useIsRtlModule()));

const t = i18n.getFixedT("en", "valuechain");
const KEYS: StreamBandKey[] = ["gate", "vs", "process", "cap"];
const BAND_LABEL_RE = new RegExp(`^(${KEYS.map((k) => t(`stream.band.${k}`)).join("|")})$`);
const VS_COLOR = "rgb(255, 245, 157)"; // TEST_TYPES.businessContext #fff59d
const NO_GOALS_TEMPLATE = "minmax(0, 1fr) repeat(3, 210px) minmax(0, 1fr)";

// Default order + row_count 2: gate 1-4, vs 5-8, process 9-13, cap 14-15 (total 15).
// Emotion minifies grid shorthands ("6 / span 3" is served as "6/span 3").

function renderRoot(
  root: ValueStreamRoot = makeStreamRoot(),
  ctx: Partial<StreamContextValue> = {},
  props: Partial<ValueStreamRootViewProps> = {},
) {
  const onExportWord = vi.fn();
  const utils = renderWithStream(
    <ValueStreamRootView root={root} onExportWord={onExportWord} exporting={false} exportDisabled={false} {...props} />,
    ctx,
  );
  const wrapper = utils.container.firstElementChild as HTMLElement;
  const grid = wrapper.firstElementChild as HTMLElement;
  /** The grid item (direct child of the root grid) holding `el`. */
  const cell = (el: Element) => {
    let n = el as HTMLElement;
    while (n.parentElement !== grid) n = n.parentElement!;
    return n;
  };
  /** Grid items whose computed `grid-row` is exactly `row`. */
  const cellsAt = (row: string) =>
    [...grid.children].filter((el) => getComputedStyle(el).gridRow === row) as HTMLElement[];
  return { ...utils, onExportWord, wrapper, grid, cell, cellsAt };
}

const bandLabel = (k: StreamBandKey) => screen.getByText(t(`stream.band.${k}`));
const bandToggle = (k: StreamBandKey) =>
  within(bandLabel(k).parentElement!).getByRole("button", { name: /^(Collapse|Expand)$/ });
const rootHeader = () => screen.getByRole("button", { name: "Hire-to-Retire" }).parentElement!;
/** The Word button's accessible name: its icon's ligature text, then the label. */
const wordName = (key: string) => new RegExp(`^description ${t(`actions.${key}`)}$`);
const emptyLabels =() => screen.queryAllByText(/^No .* found$/).map((el) => el.textContent);

beforeEach(() => hookState.reset());

describe("ValueStreamRootView", () => {
  it("(a) starts with the gate and capability bands collapsed and the stream and process bands open", () => {
    const { grid, cell } = renderRoot();
    expect(bandToggle("gate")).toHaveAttribute("aria-expanded", "false");
    expect(bandToggle("cap")).toHaveAttribute("aria-expanded", "false");
    expect(bandToggle("vs")).toHaveAttribute("aria-expanded", "true");
    expect(bandToggle("process")).toHaveAttribute("aria-expanded", "true");
    // Counts: gates, sequence leaves, process_count, capabilities.
    expect(bandLabel("gate").nextElementSibling).toHaveTextContent("(2)");
    expect(bandLabel("vs").nextElementSibling).toHaveTextContent("(3)");
    expect(bandLabel("process").nextElementSibling).toHaveTextContent("(4)");
    expect(bandLabel("cap").nextElementSibling).toHaveTextContent("(2)");
    expect(screen.queryByText("Budget approved")).toBeNull();
    expect(screen.queryByText("Recruiting")).toBeNull();
    expect(document.querySelector("[data-gates]")).toBeNull();
    expect(document.querySelector("[data-caps]")).toBeNull();
    // Open bands render their content on their own rows.
    expect(cell(screen.getByRole("button", { name: "Attract" }))).toHaveStyle({ gridRow: "8", gridColumn: "2" });
    expect(cell(screen.getByRole("button", { name: "Plan and monitor" }))).toHaveStyle({ gridRow: "7" });
    expect(document.querySelector('[data-placement="a-row0"]')).toHaveStyle({ gridRow: "11" });
    expect(document.querySelector('[data-placement="a-row1"]')).toHaveStyle({ gridRow: "12" });
    expect(cell(screen.getByRole("combobox", { name: new RegExp(`^${t("stream.showRelated")}`) }))).toHaveStyle({
      gridRow: "10",
      gridColumn: "1/5",
      paddingTop: "10px", // room for the selects' floating labels inside the frame
      marginBottom: "8px",
    });
    expect(cell(screen.getByText("Management"))).toHaveStyle({ gridRow: "13", gridColumn: "1/5", paddingBottom: "8px" });
    expect(screen.getAllByRole("combobox")).toHaveLength(2); // the process band's two selects only
    expect(grid).toHaveStyle({
      display: "grid",
      minWidth: "100%",
      columnGap: "16px",
      alignItems: "stretch",
      paddingLeft: "12px",
      paddingRight: "12px",
    });
  });

  it("(a) draws a frame behind each open band only, and the band headers on their start rows", () => {
    const { cellsAt } = renderRoot();
    expect(cellsAt("2/span 3")).toHaveLength(0); // gate collapsed
    expect(cellsAt("6/span 3")).toHaveLength(1);
    expect(cellsAt("10/span 4")).toHaveLength(1);
    expect(cellsAt("15/span 1")).toHaveLength(0); // cap collapsed
    expect(cellsAt("1")[0]).toHaveTextContent(t("stream.band.gate"));
    expect(cellsAt("5")[0]).toHaveTextContent(t("stream.band.vs"));
    expect(cellsAt("9")[0]).toHaveTextContent(t("stream.band.process"));
    expect(cellsAt("14")[0]).toHaveTextContent(t("stream.band.cap"));
    expect(cellsAt("1")[0]).toHaveStyle({ marginTop: "0px", gridColumn: "1/5" });
    expect(cellsAt("5")[0]).toHaveStyle({ marginTop: "16px" });
  });

  it("(b) expanding the gate band shows the pills, its colour-by select and frame", async () => {
    const { user, cell, cellsAt } = renderRoot();
    await user.click(bandToggle("gate"));
    expect(bandToggle("gate")).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("Budget approved")).toBeInTheDocument();
    expect(screen.getByText("Quarterly review")).toBeInTheDocument();
    expect(document.querySelector("[data-gates]")).toHaveStyle({ gridRow: "3" });
    expect(screen.getAllByRole("combobox")).toHaveLength(3);
    expect(cell(screen.getAllByRole("combobox")[0])).toHaveStyle({
      gridRow: "2",
      gridColumn: "1/5",
      paddingTop: "10px",
      marginBottom: "8px",
    });
    expect(cellsAt("2/span 3")).toHaveLength(1);
    await user.click(bandToggle("gate"));
    expect(screen.queryByText("Budget approved")).toBeNull();
  });

  it("(b) puts the objective-type legend on the gate band's last row", async () => {
    const { user, cell } = renderRoot(makeStreamRoot(), { gateColorBy: "objectiveType" });
    expect(screen.queryByText("Strategic")).toBeNull();
    await user.click(bandToggle("gate"));
    expect(cell(screen.getByText("Strategic"))).toHaveStyle({ gridRow: "4" });
  });

  it("expanding the capability band shows its groups on its content row", async () => {
    const { user, cellsAt } = renderRoot();
    await user.click(bandToggle("cap"));
    expect(screen.getByText("Talent")).toBeInTheDocument();
    expect(document.querySelector("[data-caps]")).toHaveStyle({ gridRow: "15" });
    expect(cellsAt("15/span 1")).toHaveLength(1);
  });

  it("toggles stream groups, process containers and capability groups independently, both ways", async () => {
    const { user } = renderRoot();
    const toggleIn = (title: string) =>
      // [0]: the group header precedes any member of the same name.
      within(screen.getAllByRole("button", { name: title })[0].parentElement!).getByRole("button", {
        name: /^(Collapse|Expand)$/,
      });

    await user.click(toggleIn("Recruit"));
    expect(screen.queryByRole("button", { name: "Select" })).toBeNull();
    expect(screen.getByText("Screen CVs")).toBeInTheDocument();
    await user.click(toggleIn("Recruit"));
    expect(screen.getByRole("button", { name: "Select" })).toBeInTheDocument();

    const sourcing = within(screen.getByText("Sourcing").parentElement!.parentElement!);
    await user.click(sourcing.getByRole("button", { name: t("actions.collapse") }));
    expect(screen.queryByText("Screen CVs")).toBeNull();
    expect(screen.getByRole("button", { name: "Select" })).toBeInTheDocument();
    await user.click(sourcing.getByRole("button", { name: t("actions.expand") }));
    expect(screen.getByText("Screen CVs")).toBeInTheDocument();

    await user.click(bandToggle("cap"));
    expect(screen.queryByText("Recruiting")).toBeNull(); // capability groups start collapsed
    await user.click(toggleIn("Talent"));
    expect(screen.getByText("Recruiting")).toBeInTheDocument();
    await user.click(toggleIn("Talent"));
    expect(screen.queryByText("Recruiting")).toBeNull();
  });

  it("collapsing the process band hides its boxes, selects and legend", async () => {
    const { user, cellsAt } = renderRoot();
    await user.click(bandToggle("process"));
    expect(screen.queryByText("Sourcing")).toBeNull();
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(screen.queryByText("Management")).toBeNull();
    expect(cellsAt("10/span 4")).toHaveLength(0);
  });

  it("collapsing the stream band hides the root header, chevrons and goal panel", async () => {
    const { user } = renderRoot();
    await user.click(bandToggle("vs"));
    expect(screen.queryByRole("button", { name: "Hire-to-Retire" })).toBeNull();
    expect(screen.queryByText("Attract")).toBeNull();
    expect(document.querySelector("[data-root-border]")).toBeNull();
    expect(document.querySelector("[data-goal-panel]")).toBeNull();
    expect(screen.getByText("Sourcing")).toBeInTheDocument();
  });

  it("(c) collapsing the root hides the chevrons and goals but keeps the header and the process band", async () => {
    const { user, ctx, grid } = renderRoot();
    const border = document.querySelector("[data-root-border]") as HTMLElement;
    expect(border).toHaveStyle({
      gridRow: "6/9",
      gridColumn: "1/5",
      borderStyle: "solid",
      borderColor: VS_COLOR,
      borderRadius: "6px",
      marginLeft: "-12px",
      marginRight: "0px",
    });
    expect(rootHeader().parentElement).toHaveStyle({
      gridRow: "6",
      gridColumn: "1/5",
      marginLeft: "-12px",
      marginRight: "0px",
      zIndex: "1",
      overflow: "hidden",
      borderRadius: "6px",
    });

    await user.click(within(rootHeader()).getByRole("button", { name: t("actions.collapse") }));
    expect(screen.queryByText("Attract")).toBeNull();
    expect(screen.queryByText("Plan and monitor")).toBeNull();
    expect(screen.queryByText("Recruit")).toBeNull();
    expect(document.querySelector("[data-goal-panel]")).toBeNull();
    expect(border).toHaveStyle({ gridRow: "6/7", gridColumn: "1/-1", marginRight: "-12px" });
    expect(rootHeader().parentElement).toHaveStyle({ marginRight: "-12px" });
    expect(getComputedStyle(grid).gridTemplateColumns).toBe(NO_GOALS_TEMPLATE);
    expect(screen.getByText("Sourcing")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Hire-to-Retire" }));
    expect(ctx.openCard).toHaveBeenCalledWith("r1");
  });

  it("(d) shows the goal panel beside every band when the root has goals", () => {
    const { grid, cellsAt } = renderRoot();
    expect(document.querySelector("[data-goal-panel]")).toHaveStyle({ gridRow: "1/16", gridColumn: "6" });
    expect(screen.getByText("Improve talent management")).toBeInTheDocument();
    expect(cellsAt("6/span 3")[0]).toHaveStyle({ gridColumn: "1/5", marginRight: "0px" });
    expect(getComputedStyle(grid).gridTemplateColumns).toBe(
      "minmax(0, 1fr) repeat(3, 210px) 20px minmax(min-content, 1fr)",
    );
  });

  it("(d) has no goal panel and full-width frames without goals", () => {
    const { grid, cellsAt } = renderRoot(makeStreamRoot({ goals: [] }));
    expect(document.querySelector("[data-goal-panel]")).toBeNull();
    expect(document.querySelector("[data-goal-strip]")).toBeNull();
    expect(cellsAt("6/span 3")[0]).toHaveStyle({ gridColumn: "1/-1", marginRight: "-12px" });
    expect(getComputedStyle(grid).gridTemplateColumns).toBe(NO_GOALS_TEMPLATE);
  });

  it("(d) the goal panel collapses on its own toggle", async () => {
    const { user } = renderRoot();
    const panel = document.querySelector("[data-goal-panel]") as HTMLElement;
    await user.click(within(panel).getByRole("button", { name: t("actions.collapse") }));
    expect(panel).toHaveStyle({ maxWidth: "44px" });
    expect(screen.queryByText("Improve talent management")).toBeNull();
  });

  it("(e) renders a cross-only root with no level rows on a one-slot grid", () => {
    const root = makeStreamRoot({
      sequence: [],
      leaf_processes: {},
      spans: [],
      row_count: 0,
      row_of_process: { "p-cross": 0 },
    });
    const { grid } = renderRoot(root);
    expect(getComputedStyle(grid).gridTemplateColumns).toContain("repeat(1,");
    expect(screen.getByRole("button", { name: "Plan and monitor" })).toBeInTheDocument();
    expect(bandLabel("vs").nextElementSibling).toHaveTextContent("(0)");
    expect(emptyLabels()).toEqual([]);
    // process band spans 3 + max(1, 0) rows: total 14.
    expect(document.querySelector("[data-goal-panel]")).toHaveStyle({ gridRow: "1/15" });
  });

  it("(f) orders the band headers and rows by bandOrder and moves a band through the context", async () => {
    const { user, ctx, cellsAt } = renderRoot(makeStreamRoot(), { bandOrder: ["cap", "process", "vs", "gate"] });
    expect(screen.getAllByText(BAND_LABEL_RE).map((el) => el.textContent)).toEqual(
      ["cap", "process", "vs", "gate"].map((k) => t(`stream.band.${k}`)),
    );
    // cap 1-2, process 3-7, vs 8-11, gate 12-15.
    expect(cellsAt("1")[0]).toHaveTextContent(t("stream.band.cap"));
    expect(cellsAt("3")[0]).toHaveTextContent(t("stream.band.process"));
    expect(cellsAt("8")[0]).toHaveTextContent(t("stream.band.vs"));
    expect(cellsAt("12")[0]).toHaveTextContent(t("stream.band.gate"));
    expect(rootHeader().parentElement).toHaveStyle({ gridRow: "9" });

    const header = (k: StreamBandKey) => within(bandLabel(k).parentElement!);
    expect(header("cap").getByRole("button", { name: t("actions.moveUp") })).toBeDisabled();
    expect(header("cap").getByRole("button", { name: t("actions.moveDown") })).toBeEnabled();
    expect(header("gate").getByRole("button", { name: t("actions.moveUp") })).toBeEnabled();
    expect(header("gate").getByRole("button", { name: t("actions.moveDown") })).toBeDisabled();
    await user.click(header("cap").getByRole("button", { name: t("actions.moveDown") }));
    await user.click(header("vs").getByRole("button", { name: t("actions.moveUp") }));
    expect(ctx.onMoveBand.mock.calls).toEqual([
      ["cap", "down"],
      ["vs", "up"],
    ]);
  });

  it("(g) a root with all four bands empty shows the four empty labels once each band is open", async () => {
    const root = makeStreamRoot({
      sequence: [],
      cross: [],
      spans: [],
      leaf_processes: {},
      cross_processes: [],
      row_count: 0,
      row_of_process: {},
      process_count: 0,
      processes: {},
      gates: [],
      capabilities: [],
      goals: [],
    });
    const { user } = renderRoot(root);
    expect(emptyLabels()).toEqual([t("stream.empty.vs"), t("stream.empty.process")]);
    await user.click(bandToggle("gate"));
    await user.click(bandToggle("cap"));
    expect(emptyLabels()).toEqual(["gate", "vs", "process", "cap"].map((k) => t(`stream.empty.${k}`)));
    for (const label of emptyLabels()) {
      expect(screen.getByText(label!).parentElement).toHaveStyle({ borderStyle: "dashed" });
    }
  });

  it("(g) no empty label for bands that have content", async () => {
    const { user } = renderRoot();
    await user.click(bandToggle("gate"));
    await user.click(bandToggle("cap"));
    expect(emptyLabels()).toEqual([]);
  });

  it("(h) the Save as Word button exports the root and its wrapper node, outside the snapshot", async () => {
    const root = makeStreamRoot();
    const { user, onExportWord, wrapper } = renderRoot(root);
    const button = within(rootHeader()).getByRole("button", { name: wordName("saveWord") });
    expect(button.parentElement).toHaveAttribute("data-export-ignore", "true");
    expect(button).toBeEnabled();
    await user.click(button);
    expect(onExportWord).toHaveBeenCalledTimes(1);
    expect(onExportWord).toHaveBeenCalledWith(root, wrapper);
    expect(wrapper).toHaveStyle({ marginBottom: "32px" });
  });

  it("(h) the button is disabled while another export runs and says so while its own runs", () => {
    const { unmount } = renderRoot(makeStreamRoot(), {}, { exportDisabled: true });
    expect(screen.getByRole("button", { name: wordName("saveWord") })).toBeDisabled();
    unmount();
    renderRoot(makeStreamRoot(), {}, { exporting: true });
    expect(screen.queryByRole("button", { name: wordName("saveWord") })).toBeNull();
    expect(screen.getByRole("button", { name: wordName("savingWord") })).toBeDisabled();
  });

  it("(h) renders no Word button without an export handler", () => {
    renderRoot(makeStreamRoot(), {}, { onExportWord: undefined });
    expect(screen.queryByRole("button", { name: wordName("saveWord") })).toBeNull();
    expect(document.querySelector("[data-export-ignore]")).toBeNull();
    expect(screen.getByRole("button", { name: "Hire-to-Retire" })).toBeInTheDocument();
  });
});
