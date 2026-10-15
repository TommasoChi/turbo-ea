import { renderHook, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { STATUS_COLORS } from "@/theme/tokens";
import { useStreamContext } from "./StreamContext";
import { makeStreamContext, renderWithStream } from "./StreamContext.test-utils";

function Probe() {
  const ctx = useStreamContext();
  return (
    <button type="button" onClick={() => ctx.openCard("c1")}>
      {ctx.types.objective.label}|{ctx.gateColorBy}|{ctx.bandOrder.join(",")}
    </button>
  );
}

describe("useStreamContext", () => {
  it("throws a clear error outside the provider", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => renderHook(() => useStreamContext())).toThrow(
      "useStreamContext must be used inside a StreamContext provider",
    );
    vi.restoreAllMocks();
  });

  it("returns the provided value inside renderWithStream", async () => {
    const { user, ctx } = renderWithStream(<Probe />);
    expect(screen.getByRole("button")).toHaveTextContent("Objective|none|gate,vs,process,cap");
    await user.click(screen.getByRole("button"));
    expect(ctx.openCard).toHaveBeenCalledTimes(1);
    expect(ctx.openCard).toHaveBeenCalledWith("c1");
  });

  it("applies overrides over the defaults", () => {
    const openCard = vi.fn();
    const { ctx } = renderWithStream(<Probe />, { gateColorBy: "objectiveType", bandOrder: ["cap", "gate", "vs", "process"], openCard });
    expect(screen.getByRole("button")).toHaveTextContent("Objective|objectiveType|cap,gate,vs,process");
    expect(ctx.openCard).toBe(openCard);
  });
});

describe("makeStreamContext", () => {
  it("builds the fixture colour scales and fresh spies per call", () => {
    const a = makeStreamContext();
    expect(a.objectiveScale.colorOf("strategic")).toBe("#c2185b");
    expect(a.objectiveScale.colorOf("tactical")).toBe("#7b1fa2");
    expect(a.objectiveScale.colorOf("nope")).toBe(STATUS_COLORS.neutral);
    expect(a.processScales.processType.entries.map((e) => [e.key, e.color])).toEqual([
      ["management", "#00796b"],
      ["core", "#1976d2"],
      ["support", "#8e24aa"],
    ]);
    expect(a.processScales.maturity.entries).toEqual([]);
    expect(makeStreamContext().openCard).not.toBe(a.openCard);
  });
});
