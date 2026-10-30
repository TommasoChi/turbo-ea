import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import CostSankeyNode from "./CostSankeyNode";

function draw(
  type: string,
  name = "Node",
  extra: { sourceLinks?: unknown[]; isRtl?: boolean } = {},
) {
  const { container } = render(
    <svg>
      <CostSankeyNode
        x={100}
        y={10}
        width={14}
        height={40}
        index={0}
        payload={{ name, type, sourceLinks: extra.sourceLinks ?? [{}] }}
        isRtl={extra.isRtl}
      />
    </svg>,
  );
  return {
    fill: container.querySelector("rect")!.getAttribute("fill"),
    text: container.querySelector("text")!,
  };
}

describe("CostSankeyNode", () => {
  it("fills cost items, groups and cards with three distinct colours", () => {
    const fills = [draw("CostItem").fill, draw("Group").fill, draw("Application").fill];
    expect(new Set(fills).size).toBe(3);
    expect(fills.every((f) => f && !f.startsWith("undefined"))).toBe(true);
  });

  it("labels a node on the right of its bar, and a last-column node on the left", () => {
    const first = draw("CostItem", "Licences");
    expect(first.text.textContent).toBe("Licences");
    expect(first.text.getAttribute("text-anchor")).toBe("start");
    expect(Number(first.text.getAttribute("x"))).toBeGreaterThan(114);
    const last = draw("Application", "CRM", { sourceLinks: [] });
    expect(last.text.getAttribute("text-anchor")).toBe("end");
    expect(Number(last.text.getAttribute("x"))).toBeLessThan(100);
  });

  it("mirrors the sides in RTL", () => {
    expect(draw("CostItem", "A", { isRtl: true }).text.getAttribute("text-anchor")).toBe("end");
  });

  it("truncates a long name and keeps the full one as a tooltip", () => {
    const long = "An extremely long application name that overflows";
    const { text } = draw("Application", long);
    expect(text.textContent!.length).toBeLessThan(long.length);
    expect(text.textContent!.endsWith("…")).toBe(true);
    expect(text.parentElement!.querySelector("title")?.textContent).toBe(long);
  });
});
