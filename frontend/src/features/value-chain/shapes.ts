const NOTCH_PX = 14;

/** Both-ended stage chevron; mirrored under RTL so the arrow points the way the flow reads. */
export function chevronClipPath(rtl: boolean): string {
  return rtl
    ? `polygon(100% 0, ${NOTCH_PX}px 0, 0 50%, ${NOTCH_PX}px 100%, 100% 100%, calc(100% - ${NOTCH_PX}px) 50%)`
    : `polygon(0 0, calc(100% - ${NOTCH_PX}px) 0, 100% 50%, calc(100% - ${NOTCH_PX}px) 100%, 0 100%, ${NOTCH_PX}px 50%)`;
}

/** "Home plate" bookend of the core house: a rectangle plus a 45 % arrow tip. */
export function pentagonClipPath(rtl: boolean): string {
  return rtl
    ? "polygon(100% 0, 45% 0, 0 50%, 45% 100%, 100% 100%)"
    : "polygon(0 0, 55% 0, 100% 50%, 55% 100%, 0 100%)";
}
