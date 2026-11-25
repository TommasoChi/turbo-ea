import { describe, it, expect } from "vitest";
import { EMPTY_CARD_FILTERS } from "./cardFilters";
import { costCardFiltersParam } from "./costCardFilters";

const withAttr = { ...EMPTY_CARD_FILTERS, attrFilters: { status: ["active"] } };

describe("costCardFiltersParam", () => {
  it("returns undefined when no filter is active", () => {
    expect(costCardFiltersParam({}, ["Application"])).toBeUndefined();
    expect(
      costCardFiltersParam({ Application: EMPTY_CARD_FILTERS }, ["Application"]),
    ).toBeUndefined();
  });

  it("only includes selected types", () => {
    const param = costCardFiltersParam({ Application: withAttr, ITComponent: withAttr }, [
      "Application",
    ]);
    expect(Object.keys(JSON.parse(param!))).toEqual(["Application"]);
    expect(JSON.parse(param!).Application.attrFilters).toEqual({ status: ["active"] });
  });

  it("drops include-sub-cards alone", () => {
    const only = { ...EMPTY_CARD_FILTERS, includeDescendants: true };
    expect(costCardFiltersParam({ Application: only }, ["Application"])).toBeUndefined();
  });

  it("ignores tag picks, which the cost report does not offer", () => {
    const tags = { ...EMPTY_CARD_FILTERS, tagFilterIds: ["t1"] };
    expect(costCardFiltersParam({ Application: tags }, ["Application"])).toBeUndefined();
  });
});
