import { describe, it, expect } from "vitest";
import { ARCHIMATE_LAYER_COLORS, ARCHIMATE_TEXT_COLOR } from "./tokens";
import { LAYER_ORDER } from "@/features/archimate/taxonomy/elements";

describe("ArchiMate layer tokens", () => {
  it("covers every layer with a fill and a stroke hex", () => {
    for (const l of LAYER_ORDER) {
      expect(ARCHIMATE_LAYER_COLORS[l].fill).toMatch(/^#[0-9a-f]{6}$/i);
      expect(ARCHIMATE_LAYER_COLORS[l].stroke).toMatch(/^#[0-9a-f]{6}$/i);
    }
    expect(Object.keys(ARCHIMATE_LAYER_COLORS).sort()).toEqual([...LAYER_ORDER].sort());
  });
  it("uses the conventional layer hues", () => {
    expect(ARCHIMATE_LAYER_COLORS.business.fill).toBe("#ffffb5");
    expect(ARCHIMATE_LAYER_COLORS.application.fill).toBe("#b5ffff");
    expect(ARCHIMATE_LAYER_COLORS.technology.fill).toBe("#c9e7b7");
  });
  it("keeps text dark enough on every fill", () => {
    expect(ARCHIMATE_TEXT_COLOR).toBe("#1a1a1a");
  });
});
