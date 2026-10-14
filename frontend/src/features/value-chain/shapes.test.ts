import { describe, expect, it } from "vitest";
import { chevronClipPath, pentagonClipPath } from "./shapes";

// Verbatim from the extension (ValueStreamPage.mjs CHEVRON_CLIP, ValueChainReport.mjs SIDE_BAR_CLIP).
const EXT_CHEVRON_CLIP = "polygon(0 0, calc(100% - 14px) 0, 100% 50%, calc(100% - 14px) 100%, 0 100%, 14px 50%)";
const EXT_SIDE_BAR_CLIP = "polygon(0 0, 55% 0, 100% 50%, 55% 100%, 0 100%)";

describe("chevronClipPath", () => {
  it("matches the extension chevron for LTR", () => {
    expect(chevronClipPath(false)).toBe(EXT_CHEVRON_CLIP);
  });

  it("is mirrored for RTL", () => {
    const rtl = chevronClipPath(true);
    expect(rtl).not.toBe(chevronClipPath(false));
    expect(rtl.startsWith("polygon(100% 0")).toBe(true);
    expect(rtl).toBe("polygon(100% 0, 14px 0, 0 50%, 14px 100%, 100% 100%, calc(100% - 14px) 50%)");
  });
});

describe("pentagonClipPath", () => {
  it("matches the extension side bar for LTR", () => {
    expect(pentagonClipPath(false)).toBe(EXT_SIDE_BAR_CLIP);
  });

  it("mirrors every x coordinate for RTL", () => {
    const ltr = pentagonClipPath(false);
    const rtl = pentagonClipPath(true);
    expect(rtl).toBe("polygon(100% 0, 45% 0, 0 50%, 45% 100%, 100% 100%)");
    // first token of each "x y" point is its x coordinate
    const xs = (s: string) =>
      s
        .slice("polygon(".length, -1)
        .split(", ")
        .map((pt) => pt.split(" ")[0])
        .map((x) => Number.parseInt(x, 10));
    expect(xs(ltr)).toEqual([0, 55, 100, 55, 0]);
    expect(xs(rtl)).toEqual(xs(ltr).map((x) => 100 - x));
  });
});
