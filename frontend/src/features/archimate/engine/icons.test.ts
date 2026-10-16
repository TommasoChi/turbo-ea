import { ARCHIMATE_TEXT_COLOR } from "@/theme/tokens";
import { GLYPHS, glyphMarkup, glyphSvg, type GlyphOp } from "./icons";

const numbers = (op: GlyphOp): number[] => {
  if (op[0] === "polyline") return op[1];
  if (op[0] === "path") return (op[1].match(/\d+(\.\d+)?/g) ?? []).map(Number);
  return op.slice(1) as number[];
};

describe("GLYPHS", () => {
  it("has the glyph set", () => {
    expect(Object.keys(GLYPHS).length).toBeGreaterThanOrEqual(40);
  });

  it.each(Object.entries(GLYPHS))("%s uses 1-6 ops, every coordinate inside the 16x16 box", (_id, ops) => {
    expect(ops.length).toBeGreaterThanOrEqual(1);
    expect(ops.length).toBeLessThanOrEqual(6);
    for (const op of ops) {
      const values = numbers(op);
      expect(values.length).toBeGreaterThan(0);
      for (const v of values) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(16);
      }
      // absolute path commands only: a relative one would hide a coordinate from the check above
      if (op[0] === "path") expect(op[1]).not.toMatch(/[a-z-]/);
      if (op[0] === "polyline") expect(op[1].length % 2).toBe(0);
    }
  });
});

describe("glyphSvg", () => {
  it("is a standalone 16x16 svg by default and scales with the size", () => {
    const svg = glyphSvg("actor");
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg).toContain('viewBox="0 0 16 16"');
    expect(svg).toContain('width="16"');
    expect(svg).toContain('height="16"');
    expect(svg).toContain(`stroke="${ARCHIMATE_TEXT_COLOR}"`);
    expect(glyphSvg("actor", 24)).toContain('width="24"');
    expect(glyphSvg("actor", 24)).toContain('viewBox="0 0 16 16"');
  });

  it("draws every op kind", () => {
    expect(glyphMarkup("actor")).toBe(
      '<circle cx="8" cy="4" r="2.5"/><line x1="8" y1="6.5" x2="8" y2="11"/><line x1="4" y1="8" x2="12" y2="8"/>' +
        '<polyline points="4 15 8 11 12 15"/>',
    );
    expect(glyphMarkup("object")).toContain('<rect x="2" y="2" width="12" height="12"/>');
    expect(glyphMarkup("requirement")).toBe('<path d="M5 3H14L11 13H2Z"/>');
  });

  it("rejects an unknown glyph", () => {
    expect(() => glyphSvg("nope")).toThrow("unknown glyph nope");
  });
});
