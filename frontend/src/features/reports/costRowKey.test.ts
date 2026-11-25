import { describe, it, expect } from "vitest";
import { costRowKey } from "./costRowKey";
import { OTHER_GROUP } from "./costColors";

describe("costRowKey", () => {
  it("is the card id when the report is not grouped by provider", () => {
    expect(costRowKey("c1", "p1", false)).toBe("c1");
  });
  it("pairs the card with its provider group when grouped by provider", () => {
    expect(costRowKey("c1", "p1", true)).toBe("c1|p1");
    expect(costRowKey("c1", "p2", true)).not.toBe(costRowKey("c1", "p1", true));
  });
  it("falls back to the unspecified group when the share has none", () => {
    expect(costRowKey("c1", undefined, true)).toBe(`c1|${OTHER_GROUP}`);
  });
});
