/**
 * The element glyphs: small line drawings of our own design, each in a 16x16 box, stroke only,
 * from at most six primitives. Paths use absolute commands only, so every number is a coordinate
 * (or an arc flag/radius) and stays inside the box.
 */
import { ARCHIMATE_TEXT_COLOR } from "@/theme/tokens";

export type GlyphId = string;
export type GlyphOp =
  | ["circle", number, number, number]
  | ["line", number, number, number, number]
  | ["rect", number, number, number, number]
  | ["polyline", number[]]
  | ["path", string];

const wave = "M2 3H14V11C11 9 8 14 2 11Z";
const pin = "M8 15C5 11 3 9 3 6.5A5 5 0 0 1 13 6.5C13 9 11 11 8 15Z";

export const GLYPHS: Record<GlyphId, GlyphOp[]> = {
  // active structure
  actor: [["circle", 8, 4, 2.5], ["line", 8, 6.5, 8, 11], ["line", 4, 8, 12, 8], ["polyline", [4, 15, 8, 11, 12, 15]]],
  role: [["path", "M5 4H11A3 4 0 0 1 11 12H5A3 4 0 0 1 5 4Z"], ["path", "M11 4A3 4 0 0 0 11 12"]],
  collaboration: [["circle", 6, 8, 4], ["circle", 10, 8, 4]],
  interface: [["line", 2, 8, 9, 8], ["circle", 11, 8, 3]],
  component: [["rect", 4, 2, 10, 12], ["rect", 2, 4, 4, 3], ["rect", 2, 9, 4, 3]],
  node: [["path", "M2 5L5 2H14V11L11 14H2Z"], ["path", "M2 5H11V14"], ["path", "M11 5L14 2"]],
  device: [["rect", 2, 2, 12, 8], ["line", 8, 10, 8, 13], ["line", 5, 14, 11, 14]],
  "system-software": [["circle", 9, 7, 5.5], ["circle", 5.5, 10.5, 3.5]],
  path: [["polyline", [5, 5, 2, 8, 5, 11]], ["polyline", [11, 5, 14, 8, 11, 11]], ["line", 2, 8, 14, 8]],
  network: [["circle", 3, 12, 1.5], ["circle", 8, 4, 1.5], ["circle", 13, 12, 1.5], ["polyline", [3, 12, 8, 4, 13, 12, 3, 12]]],
  equipment: [
    ["circle", 8, 8, 5], ["circle", 8, 8, 2], ["line", 8, 1, 8, 3], ["line", 8, 13, 8, 15], ["line", 1, 8, 3, 8], ["line", 13, 8, 15, 8],
  ],
  facility: [["path", "M2 14V7L6 10V7L10 10V4H13V14Z"], ["line", 2, 14, 14, 14]],
  distribution: [
    ["line", 2, 5, 14, 5], ["line", 2, 11, 14, 11], ["polyline", [11, 2, 14, 5, 11, 8]], ["polyline", [5, 8, 2, 11, 5, 14]],
  ],
  resource: [["rect", 2, 4, 11, 8], ["rect", 13, 6.5, 2, 3], ["line", 5, 6, 5, 10], ["line", 7.5, 6, 7.5, 10]],
  // behaviour
  process: [["path", "M2 5H9V2L14 8L9 14V11H2Z"]],
  function: [["polyline", [8, 2, 14, 5, 14, 14, 8, 11, 2, 14, 2, 5, 8, 2]]],
  interaction: [["path", "M7 2A6 6 0 0 0 7 14"], ["path", "M9 2A6 6 0 0 1 9 14"]],
  event: [["path", "M2 3H10A5 5 0 0 1 10 13H2A3 5 0 0 0 2 3Z"]],
  service: [["path", "M5 3H11A5 5 0 0 1 11 13H5A5 5 0 0 1 5 3Z"]],
  capability: [["polyline", [2, 14, 2, 11, 5, 11, 5, 8, 8, 8, 8, 5, 11, 5, 11, 2, 14, 2, 14, 14, 2, 14]]],
  "value-stream": [["path", "M2 3H10L14 8L10 13H2L6 8Z"]],
  "course-of-action": [["line", 4, 2, 4, 14], ["path", "M4 2H13L10 5.5L13 9H4Z"]],
  "work-package": [["path", "M13 8A5 5 0 1 1 8 3"], ["polyline", [8, 1, 10, 3, 8, 5]]],
  // passive structure
  object: [["rect", 2, 2, 12, 12], ["line", 2, 6, 14, 6]],
  contract: [["rect", 2, 2, 12, 12], ["line", 2, 5, 14, 5], ["line", 2, 10, 14, 10]],
  representation: [["path", wave]],
  deliverable: [["path", wave], ["line", 4, 6, 12, 6]],
  product: [["rect", 2, 5, 12, 9], ["rect", 2, 2, 6, 3]],
  artifact: [["path", "M3 2H10L13 5V14H3Z"], ["polyline", [10, 2, 10, 5, 13, 5]]],
  material: [["polyline", [5, 3, 11, 3, 14, 8, 11, 13, 5, 13, 2, 8, 5, 3]], ["line", 6, 6, 10, 6], ["line", 6, 10, 10, 10]],
  // motivation
  stakeholder: [["path", "M5 4H11A3 4 0 0 1 11 12H5A3 4 0 0 1 5 4Z"], ["path", "M11 4A3 4 0 0 0 11 12"]],
  driver: [["circle", 8, 8, 6], ["line", 8, 2, 8, 14], ["line", 2, 8, 14, 8], ["line", 3.8, 3.8, 12.2, 12.2], ["line", 12.2, 3.8, 3.8, 12.2]],
  assessment: [["circle", 6.5, 6.5, 4], ["line", 9.5, 9.5, 14, 14]],
  goal: [["circle", 8, 8, 6], ["circle", 8, 8, 3], ["circle", 8, 8, 1]],
  outcome: [["circle", 7, 9, 5], ["circle", 7, 9, 2], ["line", 7, 9, 14, 2], ["polyline", [11, 2, 14, 2, 14, 5]]],
  principle: [["rect", 2, 2, 12, 12], ["line", 8, 4, 8, 9], ["line", 8, 11, 8, 12]],
  requirement: [["path", "M5 3H14L11 13H2Z"]],
  constraint: [["path", "M5 3H14L11 13H2Z"], ["line", 7, 3, 4, 13]],
  meaning: [["path", "M4 12C1 12 1 7 4.5 7C4.5 3 10 3 11 6.5C14.5 6 15 12 11.5 12Z"]],
  value: [["path", "M2 8A6 4 0 0 1 14 8A6 4 0 0 1 2 8Z"]],
  // implementation and migration
  plateau: [["line", 2, 4, 14, 4], ["line", 4, 8, 12, 8], ["line", 6, 12, 10, 12]],
  gap: [["circle", 8, 8, 5], ["line", 2, 6, 14, 6], ["line", 2, 10, 14, 10]],
  // other
  location: [["path", pin], ["circle", 8, 6.5, 1.5]],
  junction: [["circle", 8, 8, 4], ["circle", 8, 8, 2.5], ["circle", 8, 8, 1]],
  "junction-or": [["circle", 8, 8, 5]],
};

const n = (v: number) => String(v);

function opMarkup(op: GlyphOp): string {
  switch (op[0]) {
    case "circle": return `<circle cx="${n(op[1])}" cy="${n(op[2])}" r="${n(op[3])}"/>`;
    case "line": return `<line x1="${n(op[1])}" y1="${n(op[2])}" x2="${n(op[3])}" y2="${n(op[4])}"/>`;
    case "rect": return `<rect x="${n(op[1])}" y="${n(op[2])}" width="${n(op[3])}" height="${n(op[4])}"/>`;
    case "polyline": return `<polyline points="${op[1].join(" ")}"/>`;
    case "path": return `<path d="${op[1]}"/>`;
  }
}

/** The glyph's drawing (no wrapper), for a parent that sets the stroke. */
export function glyphMarkup(id: GlyphId): string {
  const ops = GLYPHS[id];
  if (!ops) throw new Error(`unknown glyph ${id}`);
  return ops.map(opMarkup).join("");
}

/** Attributes the parent of a glyph needs: stroke only, round joins, the text colour. */
export const GLYPH_STROKE = {
  fill: "none", stroke: ARCHIMATE_TEXT_COLOR, "stroke-width": 1, "stroke-linecap": "round", "stroke-linejoin": "round",
} as const;

/** A standalone svg of the glyph, for the palette. */
export function glyphSvg(id: GlyphId, size = 16): string {
  const attrs = Object.entries(GLYPH_STROKE).map(([k, v]) => `${k}="${v}"`).join(" ");
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 16 16" ${attrs}>` +
    `${glyphMarkup(id)}</svg>`
  );
}
