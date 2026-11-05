import { CHART_LABEL_ON_DARK, CHART_LABEL_ON_LIGHT } from "@/theme/tokens";

export const MAX_GROUP_HUES = 8;
export const OTHERS_KEY = "__others__";

const clamp = (n: number) => Math.max(0, Math.min(255, Math.round(n)));
const toRgb = (hex: string) => {
  const n = parseInt(hex.replace("#", ""), 16);
  return [n >> 16, (n >> 8) & 255, n & 255];
};

/** Mix toward black (t < 0) or white (t > 0); |t| <= 1. */
export function shade(hex: string, t: number): string {
  const target = t < 0 ? 0 : 255;
  const k = Math.abs(t);
  const [r, g, b] = toRgb(hex).map((c) => clamp(c + (target - c) * k));
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;
}

/** Label ink readable on the given fill. */
export function inkOn(bg: string): string {
  const [r, g, b] = toRgb(bg);
  return (299 * r + 587 * g + 114 * b) / 1000 > 150 ? CHART_LABEL_ON_LIGHT : CHART_LABEL_ON_DARK;
}

export interface ColoredGroup<T> {
  key: string;
  label: string;
  cost: number;
  items: T[];
  hue: string;
  folded: boolean;
}

export function assignGroupColors<T extends { cost: number }>(
  groups: { key: string; label: string; cost: number; items: T[] }[],
  o: { categorical: readonly string[]; other: string; unspecified: string; unspecifiedKey: string },
): { groups: ColoredGroup<T>[]; foldedKeys: Set<string> } {
  const sorted = [...groups].sort((a, b) => b.cost - a.cost);
  const real = sorted.filter((g) => g.key !== o.unspecifiedKey);
  const unspecified = sorted.find((g) => g.key === o.unspecifiedKey);
  const out: ColoredGroup<T>[] = real
    .slice(0, MAX_GROUP_HUES)
    .map((g, i) => ({ ...g, hue: o.categorical[i], folded: false }));
  const rest = real.slice(MAX_GROUP_HUES);
  const foldedKeys = new Set(rest.map((g) => g.key));
  if (rest.length > 0) {
    out.push({
      key: OTHERS_KEY,
      label: OTHERS_KEY,
      cost: rest.reduce((s, g) => s + g.cost, 0),
      items: rest.flatMap((g) => g.items),
      hue: o.other,
      folded: true,
    });
  }
  if (unspecified) out.push({ ...unspecified, hue: o.unspecified, folded: false });
  return { groups: out, foldedKeys };
}

export function drillGroupKey(rawKey: string, foldedKeys: Set<string>): string {
  return foldedKeys.has(rawKey) ? OTHERS_KEY : rawKey;
}

/** rank 0 = costliest = darkest; n < 2 keeps the hue. */
export function memberShade(hue: string, rank: number, n: number): string {
  if (n < 2) return hue;
  return shade(hue, -0.22 + (0.62 * rank) / (n - 1));
}

const STEPS = [-0.18, 0, 0.22];

/** Stable colour from a name: fnv1a -> hue x lightness step. */
export function cardColor(name: string, categorical: readonly string[]): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < name.length; i++) {
    h ^= name.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return shade(categorical[h % MAX_GROUP_HUES], STEPS[(h >>> 4) % 3]);
}
