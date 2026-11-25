import type { KeyboardEvent, SyntheticEvent } from "react";

/** `onKeyDown` that runs `handler` on Enter or Space, for a non-native control with `role="button"`. */
export function onActivateKey<E extends HTMLElement | SVGElement>(
  handler: (e: SyntheticEvent<E>) => void,
) {
  return (e: KeyboardEvent<E>) => {
    if (e.target !== e.currentTarget) return;
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      handler(e);
    }
  };
}
