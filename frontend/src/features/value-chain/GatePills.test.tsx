import { screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import i18n from "@/i18n";
import { makeStreamRoot } from "@/test/fixtures/valueChain";
import type { ValueStreamGate } from "@/types";
import GatePills, { GateColorByField, GateLegend } from "./GatePills";
import type { StreamContextValue } from "./StreamContext";
import { focusVisibleOutline, renderWithStream, RING_ON_FILL } from "@/test/valueStreamContext";
import { buildGeometry } from "./valueStreamLayout";

const t = i18n.getFixedT("en", "valuechain");

const OBJECTIVE = "rgb(13, 71, 161)"; // TEST_TYPES.objective #0d47a1
const STRATEGIC = "rgb(194, 24, 91)"; // #c2185b
const TACTICAL = "rgb(123, 31, 162)"; // #7b1fa2
const GREY = "rgb(158, 158, 158)"; // STATUS_COLORS.neutral
const WHITE = "rgb(255, 255, 255)";

function renderPills(gates: ValueStreamGate[] = makeStreamRoot().gates, overrides: Partial<StreamContextValue> = {}) {
  const root = makeStreamRoot();
  return renderWithStream(
    <GatePills
      gates={gates}
      geometry={buildGeometry(root.sequence)}
      row={3}
      crossLeafIds={new Set(root.cross.map((l) => l.id))}
    />,
    overrides,
  );
}

const pill = (name: string) => screen.getByRole("button", { name });
const gate = (id: string, leaf_id: string, objective_type: string | null): ValueStreamGate => ({
  id,
  name: `Gate ${id}`,
  leaf_id,
  objective_type,
});

describe("GatePills", () => {
  it("paints every pill in the flat Objective colour by default", () => {
    renderPills();
    for (const name of ["Budget approved", "Quarterly review"]) {
      expect(pill(name)).toHaveStyle({ backgroundColor: OBJECTIVE, color: WHITE, height: "44px", borderRadius: "50px" });
    }
    expect(within(pill("Budget approved")).getByText("Budget approved")).toHaveStyle({ WebkitLineClamp: "2" });
  });

  it("colours by objective type, with null and unknown keys grey and never shown as text", () => {
    const { container } = renderPills(
      [gate("s", "a", "strategic"), gate("t", "b", "tactical"), gate("n", "c", null), gate("u", "a", "zzz-unknown")],
      { gateColorBy: "objectiveType" },
    );
    expect(pill("Gate s")).toHaveStyle({ backgroundColor: STRATEGIC, color: WHITE });
    expect(pill("Gate t")).toHaveStyle({ backgroundColor: TACTICAL });
    expect(pill("Gate n")).toHaveStyle({ backgroundColor: GREY });
    expect(pill("Gate u")).toHaveStyle({ backgroundColor: GREY });
    expect(container.innerHTML).not.toContain("zzz-unknown");
    expect(container.innerHTML).not.toContain("strategic");
  });

  it("puts each sequence leaf's pills in its own column of the gate row", () => {
    renderPills([gate("1", "a", null), gate("2", "a", null), gate("3", "c", null)]);
    const wrapper = document.querySelector("[data-gates]")!;
    expect(wrapper).toHaveStyle({ gridRow: "3", gridColumn: "2/5", display: "grid", gridTemplateColumns: "subgrid" });
    const colA = pill("Gate 1").parentElement!;
    expect(colA).toHaveStyle({ gridColumn: "1", gridRow: "1" });
    expect(within(colA).getAllByRole("button").map((b) => b.textContent)).toEqual(["Gate 1", "Gate 2"]);
    expect(pill("Gate 3").parentElement).toHaveStyle({ gridColumn: "3", gridRow: "1" });
    expect(wrapper.childElementCount).toBe(2); // leaf b has no gate: no cell
    expect(document.querySelector("[data-cross]")).toBeNull();
  });

  it("renders gates of cross-cutting leaves in one full-width cell after the per-column ones", () => {
    renderPills([gate("x1", "x", null), gate("s", "a", null), gate("x2", "x", null)]);
    const cross = document.querySelector("[data-cross]") as HTMLElement;
    expect(cross).toHaveStyle({ gridColumn: "1/-1", gridRow: "2", display: "flex", flexWrap: "wrap" });
    expect(within(cross).getAllByRole("button").map((b) => b.textContent)).toEqual(["Gate x1", "Gate x2"]);
    expect(within(cross).queryByRole("button", { name: "Gate s" })).toBeNull();
    expect(pill("Gate x1")).toHaveStyle({ width: "210px" });
    expect(cross.parentElement!.lastElementChild).toBe(cross);
  });

  it("skips a gate whose leaf is neither in the sequence nor cross-cutting", () => {
    renderPills([gate("ok", "a", null), gate("lost", "zz", null)]);
    expect(pill("Gate ok")).toBeInTheDocument();
    expect(screen.queryByText("Gate lost")).toBeNull();
  });

  it("renders nothing without gates", () => {
    const { container } = renderPills([]);
    expect(container).toBeEmptyDOMElement();
  });

  it("opens the gate card on click and from the keyboard", async () => {
    const { user, ctx } = renderPills();
    await user.click(pill("Quarterly review"));
    expect(ctx.openCard).toHaveBeenLastCalledWith("g-x");
    pill("Budget approved").focus();
    await user.keyboard("{Enter}");
    expect(ctx.openCard).toHaveBeenLastCalledWith("g-a");
    expect(ctx.openCard).toHaveBeenCalledTimes(2);
  });

  it("draws a keyboard focus ring in the pill's text colour", () => {
    renderPills();
    expect(focusVisibleOutline(pill("Budget approved"))).toEqual(RING_ON_FILL);
  });
});

describe("GateColorByField", () => {
  it("shows the current choice and reports a new one", async () => {
    const { user, ctx } = renderWithStream(<GateColorByField />);
    expect(screen.getByLabelText(t("stream.colorBy"))).toHaveTextContent(t("stream.colorBy.none"));
    await user.click(screen.getByRole("combobox"));
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual([t("stream.colorBy.none"), "Objective kind"]);
    await user.click(screen.getByRole("option", { name: "Objective kind" }));
    expect(ctx.setGateColorBy).toHaveBeenCalledTimes(1);
    expect(ctx.setGateColorBy).toHaveBeenCalledWith("objectiveType");
  });

  it("falls back to the translated field name when the metamodel label is empty", async () => {
    const { user } = renderWithStream(<GateColorByField />, {
      gateColorBy: "objectiveType",
      fieldLabels: {
        objectiveType: "",
        processAttrs: { processType: "", maturity: "", automationLevel: "", riskLevel: "" },
      },
    });
    expect(screen.getByRole("combobox")).toHaveTextContent(t("stream.colorBy.objectiveType"));
    await user.click(screen.getByRole("combobox"));
    expect(screen.getByRole("option", { name: t("stream.colorBy.objectiveType") })).toBeInTheDocument();
  });
});

describe("GateLegend", () => {
  it("renders nothing in flat-colour mode", () => {
    const { container } = renderWithStream(<GateLegend />);
    expect(container).toBeEmptyDOMElement();
  });

  it("lists every objective type with its colour plus Not set in objective-type mode", () => {
    renderWithStream(<GateLegend />, { gateColorBy: "objectiveType" });
    const dot = (label: string) => screen.getByText(label).previousElementSibling;
    expect(dot("Strategic")).toHaveStyle({ backgroundColor: STRATEGIC });
    expect(dot("Tactical")).toHaveStyle({ backgroundColor: TACTICAL });
    expect(dot(t("legend.notSet"))).toHaveStyle({ backgroundColor: GREY });
    expect(screen.getAllByText(/./).map((n) => n.textContent)).toEqual(["Strategic", "Tactical", t("legend.notSet")]);
  });
});
