import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { brand, CARD_TYPE_COLORS, CATEGORICAL_COLORS, DEFAULT_LAYER_COLOR } from "@/theme";
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
  it("fills each kind with its token and falls back for an unknown card type", () => {
    expect(draw("CostItem").fill).toBe(brand.primary);
    expect(draw("Group").fill).toBe(CATEGORICAL_COLORS[7]);
    expect(draw("Application").fill).toBe(CARD_TYPE_COLORS.Application);
    expect(draw("MyCustomType").fill).toBe(DEFAULT_LAYER_COLOR);
  });

  it("gives labels a background halo", () => {
    const { text } = draw("Application");
    expect(text.getAttribute("paint-order")).toBe("stroke");
    expect(text.getAttribute("stroke")).toBeTruthy();
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

  it("keeps the sides in RTL (the layout is not mirrored) and only sets text direction", () => {
    for (const sourceLinks of [[{}], []]) {
      const ltr = draw("CostItem", "A", { sourceLinks });
      const rtl = draw("CostItem", "A", { sourceLinks, isRtl: true });
      expect(rtl.text.getAttribute("text-anchor")).toBe(ltr.text.getAttribute("text-anchor"));
      expect(rtl.text.getAttribute("x")).toBe(ltr.text.getAttribute("x"));
      expect(rtl.text.getAttribute("direction")).toBe("rtl");
      expect(ltr.text.getAttribute("direction")).toBeNull();
    }
  });

  it("truncates a long name and keeps the full one as a tooltip", () => {
    const long = "An extremely long application name that overflows";
    const { text } = draw("Application", long);
    expect(text.textContent!.length).toBeLessThan(long.length);
    expect(text.textContent!.endsWith("…")).toBe(true);
    expect(text.parentElement!.querySelector("title")?.textContent).toBe(long);
  });
});
