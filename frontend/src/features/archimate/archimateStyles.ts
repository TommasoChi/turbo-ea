/**
 * Theme for the diagram-js chrome around the ArchiMate canvas (palette, context pad, canvas, selection).
 *
 * diagram-js 15 builds its stylesheet on CSS custom properties, which `diagram-js.css` declares on
 * `.bio-theme-parent` / `.djs-parent`; redefining them under the editor's own wrapper (more specific)
 * re-themes light AND dark from `theme.palette`. The palette and context-pad entries are our own
 * `html` strings (`.archimate-palette-entry`, `.archimate-cp-entry`), so they are styled directly.
 * Shapes are NOT styled here: tiny-svg writes inline styles on them (ArchimateRenderer owns that, and
 * keeps the text on ARCHIMATE_TEXT_COLOR).
 */
import type { SxProps, Theme } from "@mui/material/styles";
import { ARCHIMATE_TEXT_COLOR } from "@/theme/tokens";

export function archimateCanvasSx(theme: Theme): SxProps<Theme> {
  const { palette } = theme;
  const tokens = {
    "--canvas-fill-color": palette.background.default,
    "--palette-background-color": palette.background.paper,
    "--palette-border-color": palette.divider,
    "--palette-separator-color": palette.divider,
    "--palette-entry-color": palette.text.primary,
    "--palette-entry-hover-color": palette.primary.main,
    "--palette-entry-selected-color": palette.primary.main,
    "--palette-toggle-hover-background-color": palette.action.hover,
    "--context-pad-entry-background-color": palette.background.paper,
    "--context-pad-entry-hover-background-color": palette.action.hover,
    "--accent-color": palette.primary.main,
    "--element-selected-outline-stroke-color": palette.primary.main,
    "--element-selected-outline-secondary-stroke-color": palette.primary.light,
    "--bendpoint-fill-color": palette.primary.main,
    "--bendpoint-stroke-color": palette.background.default,
  };
  return {
    "& .bjs-powered-by": { display: "none" },
    "& .bio-theme-parent, & .djs-parent": tokens,
    "& .djs-container, & .djs-container svg": { backgroundColor: palette.background.default },
    // Compact palette: three columns of 22px entries, scrolling when the canvas is short.
    "& .djs-palette, & .djs-palette.two-column.open": { width: 100, maxHeight: "calc(100% - 40px)", overflowX: "hidden", overflowY: "auto" },
    "& .archimate-palette-label": {
      clear: "both",
      padding: "2px 4px 0",
      fontSize: 10,
      fontWeight: 600,
      lineHeight: 1.3,
      letterSpacing: 0.3,
      textTransform: "uppercase",
      color: palette.text.secondary,
    },
    "& .djs-palette .entry, & .archimate-palette-entry": {
      width: 22,
      height: 22,
      margin: "4px 0 0 4px",
      lineHeight: 0,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      borderRadius: "3px",
      color: palette.text.primary,
      "&:hover": { color: palette.primary.main, backgroundColor: palette.action.hover },
      "&:focus-visible": { outline: `2px solid ${palette.primary.main}`, outlineOffset: -2 },
    },
    // Every element entry sits on a tile in the colour of its layer (the inline `--archimate-tile`).
    "& .archimate-palette-entry": {
      position: "relative", // anchors the info badge, below
      backgroundColor: "var(--archimate-tile)",
      color: ARCHIMATE_TEXT_COLOR,
      border: `1px solid ${palette.divider}`,
      "&:hover": { color: ARCHIMATE_TEXT_COLOR, filter: "brightness(0.93)", backgroundColor: "var(--archimate-tile)" },
    },
    // The info badge: small and in the tile's own background/border so it reads as secondary to
    // the glyph whatever the tile's layer colour is. Its own click/keyboard target (see
    // ArchimatePaletteProvider) -- never the tile's create/drag gesture.
    "& .archimate-palette-info": {
      position: "absolute",
      right: -3,
      bottom: -3,
      width: 10,
      height: 10,
      padding: 0,
      border: "none",
      borderRadius: "50%",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      lineHeight: 0,
      color: palette.text.secondary,
      backgroundColor: palette.background.paper,
      boxShadow: `0 0 0 1px ${palette.divider}`,
      cursor: "pointer",
      "&:hover": { color: palette.primary.main },
      "&:focus-visible": { outline: `2px solid ${palette.primary.main}`, outlineOffset: 1 },
    },
    "& .djs-context-pad .entry, & .archimate-cp-entry": {
      color: palette.text.primary,
      backgroundColor: palette.background.paper,
      border: `1px solid ${palette.divider}`,
      "&:hover": { backgroundColor: palette.action.hover },
    },
    "& .archimate-cp-entry .material-symbols-outlined": { fontSize: 18, lineHeight: "inherit" },
    "& .djs-element.selected .djs-outline, & .djs-selection-outline": { stroke: palette.primary.main },
  };
}
