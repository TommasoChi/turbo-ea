/**
 * Keyboard focus rings (UI_GUIDELINES §5) for the Value Chain / Value Stream boxes. All are inset,
 * so an ancestor's `overflow: hidden` cannot clip them. Plus `onActivateKey`, the keyboard twin of
 * a `role="button"` click.
 */
import type { KeyboardEvent } from "react";

/** Enter/Space -> `fn`, default prevented (no page scroll on Space). */
export const onActivateKey = (fn: () => void) => (e: KeyboardEvent) => {
  if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    fn();
  }
};

/** For an element on a computed fill: `currentColor` is its `readableTextColor(fill)` text. */
export const FOCUS_RING_ON_FILL = {
  "&:focus-visible": { outline: "2px solid", outlineColor: "currentColor", outlineOffset: -2 },
} as const;

/**
 * For a chevron (`clip-path` on a computed fill): the clip cuts off anything at the edge, so the
 * ring sits deeper inside, where the clipped shape still shows it.
 */
export const FOCUS_RING_INSET = {
  "&:focus-visible": { outline: "2px solid", outlineColor: "currentColor", outlineOffset: -4 },
} as const;

/** For an element on the theme paper. */
export const FOCUS_RING = {
  "&:focus-visible": { outline: "2px solid", outlineColor: "primary.main", outlineOffset: -2 },
} as const;
