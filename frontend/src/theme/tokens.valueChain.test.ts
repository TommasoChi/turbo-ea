import { describe, it, expect } from "vitest";
import { contrastRatio, readableTextColor, readableTypeColor } from "@/lib/color";
import { surface, VALUE_CHAIN_BAND_COLORS } from "./tokens";

// surface.light.paper is the 3-digit literal "#fff"; contrastRatio takes #rrggbb only.
const LIGHT_PAPER = "#ffffff";

// MUI lighten()/darken() return "rgb(r, g, b)", which contrastRatio rejects (returns 1).
function toHex(color: string): string {
  const m = /^rgb\((\d+),\s*(\d+),\s*(\d+)\)$/.exec(color);
  if (!m) return color;
  return `#${[m[1], m[2], m[3]].map((n) => Number(n).toString(16).padStart(2, "0")).join("")}`;
}

describe("VALUE_CHAIN_BAND_COLORS", () => {
  it("defines exactly the four bands", () => {
    expect(Object.keys(VALUE_CHAIN_BAND_COLORS)).toEqual(["management", "core", "support", "not_set"]);
  });

  it("uses a literal that matches the light paper normalisation", () => {
    expect(surface.light.paper).toBe("#fff");
  });

  for (const [band, color] of Object.entries(VALUE_CHAIN_BAND_COLORS)) {
    describe(band, () => {
      it("carries white text at AA contrast", () => {
        expect(readableTextColor(color)).toBe("#ffffff");
        expect(contrastRatio("#ffffff", color)).toBeGreaterThanOrEqual(4.5);
      });
      it("reads as an accent on the light paper", () => {
        expect(contrastRatio(toHex(readableTypeColor(color, false)), LIGHT_PAPER)).toBeGreaterThanOrEqual(3);
      });
      it("reads as an accent on the dark paper", () => {
        expect(contrastRatio(toHex(readableTypeColor(color, true)), surface.dark.paper)).toBeGreaterThanOrEqual(3);
      });
    });
  }
});
