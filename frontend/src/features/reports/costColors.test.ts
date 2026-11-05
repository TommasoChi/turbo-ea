import { describe, expect, it } from "vitest";
import { CHART_CATEGORICAL, CHART_LABEL_ON_DARK, CHART_LABEL_ON_LIGHT } from "@/theme/tokens";
import {
  MAX_GROUP_HUES,
  OTHERS_KEY,
  assignGroupColors,
  cardColor,
  drillGroupKey,
  inkOn,
  memberShade,
  shade,
} from "./costColors";

const cat = CHART_CATEGORICAL.light;
const opts = { categorical: cat, other: "#other", unspecified: "#unspec", unspecifiedKey: "__other__" };
const lum = (hex: string) => {
  const n = parseInt(hex.slice(1), 16);
  return (299 * (n >> 16) + 587 * ((n >> 8) & 255) + 114 * (n & 255)) / 1000;
};
const mk = (key: string, cost: number) => ({ key, label: key, cost, items: [{ cost }] });

describe("assignGroupColors", () => {
  it("gives 8 hues and folds the rest into one Others group", () => {
    const groups = Array.from({ length: 10 }, (_, i) => mk(`g${i}`, 100 - i));
    const { groups: out, foldedKeys } = assignGroupColors(groups, opts);
    expect(out).toHaveLength(MAX_GROUP_HUES + 1);
    expect(out.slice(0, 8).map((g) => g.hue)).toEqual([...cat]);
    const others = out[8];
    expect(others).toMatchObject({ key: OTHERS_KEY, hue: "#other", folded: true, cost: 92 + 91 });
    expect(others.items).toHaveLength(2);
    expect([...foldedKeys].sort()).toEqual(["g8", "g9"]);
  });

  it("keeps the unspecified bucket separate and never folds it", () => {
    const groups = [...Array.from({ length: 9 }, (_, i) => mk(`g${i}`, 50 - i)), mk("__other__", 1000)];
    const { groups: out, foldedKeys } = assignGroupColors(groups, opts);
    const un = out.find((g) => g.key === "__other__")!;
    expect(un.hue).toBe("#unspec");
    expect(un.folded).toBe(false);
    expect(foldedKeys.has("__other__")).toBe(false);
    expect(out.filter((g) => g.hue === cat[0])).toHaveLength(1);
    expect(out.find((g) => g.key === OTHERS_KEY)!.items).toHaveLength(1);
  });

  it("orders by cost descending", () => {
    const { groups } = assignGroupColors([mk("a", 1), mk("b", 5), mk("c", 3)], opts);
    expect(groups.map((g) => g.key)).toEqual(["b", "c", "a"]);
  });
});

describe("drillGroupKey", () => {
  it("maps folded keys to Others", () => {
    const f = new Set(["x"]);
    expect(drillGroupKey("x", f)).toBe(OTHERS_KEY);
    expect(drillGroupKey("y", f)).toBe("y");
  });
});

describe("shades", () => {
  it("memberShade darkens the costliest and returns hue for n<2", () => {
    expect(memberShade("#2a78d6", 0, 1)).toBe("#2a78d6");
    expect(lum(memberShade("#2a78d6", 0, 4))).toBeLessThan(lum(memberShade("#2a78d6", 3, 4)));
  });
  it("shade moves toward black and white", () => {
    expect(shade("#808080", -1)).toBe("#000000");
    expect(shade("#808080", 1)).toBe("#ffffff");
  });
});

describe("cardColor", () => {
  it("is stable and uses only hue x step combinations", () => {
    expect(cardColor("SAP", cat)).toBe(cardColor("SAP", cat));
    const all = new Set(cat.flatMap((h) => [-0.18, 0, 0.22].map((t) => shade(h, t))));
    expect(all.size).toBe(24);
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const c = cardColor(`app-${i}`, cat);
      expect(all.has(c)).toBe(true);
      seen.add(c);
    }
    expect(seen.size).toBeGreaterThanOrEqual(12);
  });
});

describe("inkOn", () => {
  it("picks dark on white and white on blue", () => {
    expect(inkOn("#ffffff")).toBe(CHART_LABEL_ON_LIGHT);
    expect(inkOn("#2a78d6")).toBe(CHART_LABEL_ON_DARK);
  });
});
