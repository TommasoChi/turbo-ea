import { ELEMENT_TYPES } from "../taxonomy/elements";
import { ACCESS_TYPES, RELATIONSHIP_TYPES } from "../taxonomy/relationships";
import { accessLabel, elementLabel, relationshipLabel } from "./elementLabel";

describe("elementLabel", () => {
  it.each([
    ["BusinessActor", "Business Actor"],
    ["ApplicationComponent", "Application Component"],
    ["AndJunction", "And Junction"],
    ["DataObject", "Data Object"],
    ["Grouping", "Grouping"],
  ] as const)("%s -> %s", (type, label) => {
    expect(elementLabel(type)).toBe(label);
  });

  it("gives every element type a non-empty, correctly split label", () => {
    for (const type of ELEMENT_TYPES) {
      const label = elementLabel(type);
      expect(label).not.toBe("");
      expect(label.replace(/ /g, "")).toBe(type);
      expect(label).not.toMatch(/[A-Z]{2}/);
    }
  });

  it("labels relationships and access types", () => {
    expect(relationshipLabel("Serving")).toBe("Serving");
    expect(RELATIONSHIP_TYPES.map(relationshipLabel)).toEqual([...RELATIONSHIP_TYPES]);
    expect(accessLabel("ReadWrite")).toBe("Read/Write");
    expect(ACCESS_TYPES.map(accessLabel)).toEqual(["Access", "Read", "Write", "Read/Write"]);
  });
});
