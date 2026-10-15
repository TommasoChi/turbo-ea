/**
 * Keyboard focus rings (UI_GUIDELINES §5) for the Value Stream boxes. Both are inset (`-2`), so an
 * ancestor's `overflow: hidden` cannot clip them.
 */

/** For an element on a computed fill: `currentColor` is its `readableTextColor(fill)` text. */
export const FOCUS_RING_ON_FILL = {
  "&:focus-visible": { outline: "2px solid", outlineColor: "currentColor", outlineOffset: -2 },
} as const;

/** For an element on the theme paper. */
export const FOCUS_RING = {
  "&:focus-visible": { outline: "2px solid", outlineColor: "primary.main", outlineOffset: -2 },
} as const;
