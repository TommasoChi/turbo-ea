import { describe, expect, it } from "vitest";

import { FOCUS_RING, FOCUS_RING_ON_FILL } from "./focusRing";

describe("focus rings", () => {
  it("draws the ring in the text colour on a computed fill", () => {
    expect(FOCUS_RING_ON_FILL).toEqual({
      "&:focus-visible": { outline: "2px solid", outlineColor: "currentColor", outlineOffset: -2 },
    });
  });

  it("draws the ring in the primary colour on the paper", () => {
    expect(FOCUS_RING).toEqual({
      "&:focus-visible": { outline: "2px solid", outlineColor: "primary.main", outlineOffset: -2 },
    });
  });
});
