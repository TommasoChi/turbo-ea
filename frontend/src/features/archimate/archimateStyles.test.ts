import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { itSourceScan } from "@/test/sourceScan";
import { createTheme } from "@mui/material/styles";
import { buildTheme } from "@/theme";
import { ARCHIMATE_LAYER_COLORS, ARCHIMATE_TEXT_COLOR } from "@/theme/tokens";
import { archimateCanvasSx } from "./archimateStyles";

const sx = (mode: "light" | "dark") => archimateCanvasSx(buildTheme(mode)) as Record<string, Record<string, unknown>>;

describe("archimateCanvasSx", () => {
  it("styles the palette, the context pad, the canvas and the selection outline", () => {
    const s = sx("light");
    const keys = Object.keys(s).join(" | ");
    expect(keys).toContain(".archimate-palette-entry");
    expect(keys).toContain(".archimate-cp-entry");
    expect(keys).toContain(".djs-palette .entry");
    expect(keys).toContain(".djs-context-pad .entry");
    expect(keys).toContain(".djs-container");
    expect(keys).toContain(".djs-selection-outline");
  });

  it("follows the theme: light and dark differ and come from the palette", () => {
    const light = sx("light");
    const dark = sx("dark");
    const tokenKey = "& .bio-theme-parent, & .djs-parent";
    const lt = buildTheme("light").palette;
    const dt = buildTheme("dark").palette;
    expect(light[tokenKey]["--palette-background-color"]).toBe(lt.background.paper);
    expect(dark[tokenKey]["--palette-background-color"]).toBe(dt.background.paper);
    expect(light[tokenKey]["--palette-entry-color"]).toBe(lt.text.primary);
    expect(dark[tokenKey]["--palette-entry-color"]).toBe(dt.text.primary);
    expect(light[tokenKey]["--palette-entry-color"]).not.toBe(dark[tokenKey]["--palette-entry-color"]);
  });

  it("holds no hex literal of its own: any hex found equals a layer token or the text colour", () => {
    const allowed = new Set(
      [...Object.values(ARCHIMATE_LAYER_COLORS).flatMap((c) => [c.fill, c.stroke]), ARCHIMATE_TEXT_COLOR].map((h) =>
        h.toLowerCase(),
      ),
    );
    for (const mode of ["light", "dark"] as const) {
      const found = JSON.stringify(sx(mode)).match(/#[0-9a-f]{3,6}\b/gi) ?? [];
      // Theme palette values (tokens.ts) are fine; only a literal typed in the module would be a bug.
      const theme = buildTheme(mode);
      const themeHexes = new Set(JSON.stringify(theme.palette).match(/#[0-9a-f]{3,8}\b/gi)?.map((h) => h.toLowerCase()));
      for (const hex of found) expect(allowed.has(hex.toLowerCase()) || themeHexes.has(hex.toLowerCase())).toBe(true);
    }
  });

  itSourceScan("source has no hex literal", () => {
    expect(readFileSync(resolve(__dirname, "archimateStyles.ts"), "utf8")).not.toMatch(/#[0-9a-fA-F]{3,6}\b/);
  });

  it("works with a plain MUI theme too", () => {
    expect(Object.keys(archimateCanvasSx(createTheme()) as object).length).toBeGreaterThan(5);
  });
});
