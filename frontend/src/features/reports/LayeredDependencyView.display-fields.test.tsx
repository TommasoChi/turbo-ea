import { describe, expect, it } from "vitest";
import {
  declaredDisplayFieldKeys,
  pickSelectedDisplayAttributes,
  visibleCardDetailFieldKeys,
} from "./LayeredDependencyView";

describe("pickSelectedDisplayAttributes", () => {
  it("keeps only fields selected in Show on Card", () => {
    expect(
      pickSelectedDisplayAttributes(
        { hostType: "Managed", region: "IT", internalNote: "do not render" },
        ["hostType", "region"],
      ),
    ).toEqual({ hostType: "Managed", region: "IT" });
  });

  it("does not manufacture missing or unselected values", () => {
    expect(
      pickSelectedDisplayAttributes({ hostType: "Managed", internalNote: "private" }, ["region"]),
    ).toEqual({});
  });

  it("requests only selected fields declared by the current Card type", () => {
    const application = {
      key: "Application",
      fields_schema: [{ fields: [{ key: "businessCriticality" }] }],
    };

    expect(
      declaredDisplayFieldKeys(["hostingType", "businessCriticality"], application),
    ).toEqual(["businessCriticality"]);
  });

  it("reserves hosting type for its icon instead of a textual card-detail row", () => {
    expect(
      visibleCardDetailFieldKeys(["hostingType", "businessCriticality"]),
    ).toEqual(["businessCriticality"]);
  });
});
