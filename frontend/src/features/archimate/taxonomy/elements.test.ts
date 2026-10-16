import { describe, it, expect } from "vitest";
import {
  ELEMENT_INFO, ELEMENT_TYPES, LAYER_ORDER, elementsOfLayer, isElementType, layerOf,
} from "./elements";

const XSD = [
  "BusinessActor","BusinessRole","BusinessCollaboration","BusinessInterface","BusinessProcess",
  "BusinessFunction","BusinessInteraction","BusinessEvent","BusinessService","BusinessObject",
  "Contract","Representation","Product","ApplicationComponent","ApplicationCollaboration",
  "ApplicationInterface","ApplicationFunction","ApplicationInteraction","ApplicationProcess",
  "ApplicationEvent","ApplicationService","DataObject","Node","Device","SystemSoftware",
  "TechnologyCollaboration","TechnologyInterface","Path","CommunicationNetwork","TechnologyFunction",
  "TechnologyProcess","TechnologyInteraction","TechnologyEvent","TechnologyService","Artifact",
  "Equipment","Facility","DistributionNetwork","Material","Stakeholder","Driver","Assessment","Goal",
  "Outcome","Principle","Requirement","Constraint","Meaning","Value","Resource","Capability",
  "CourseOfAction","ValueStream","WorkPackage","Deliverable","ImplementationEvent","Plateau","Gap",
  "Grouping","Location","AndJunction","OrJunction",
];

describe("ArchiMate element taxonomy", () => {
  it("is exactly the 62 names of the Open Group Exchange XSD 3.1", () => {
    expect([...ELEMENT_TYPES].sort()).toEqual([...XSD].sort());
    expect(new Set(ELEMENT_TYPES).size).toBe(62);
  });

  it("describes every type, and the key matches", () => {
    for (const t of ELEMENT_TYPES) expect(ELEMENT_INFO[t].type).toBe(t);
  });

  it("splits the 58 core elements across the seven layers", () => {
    const counts = Object.fromEntries(LAYER_ORDER.map((l) => [l, elementsOfLayer(l).length]));
    expect(counts).toEqual({
      strategy: 4, business: 13, application: 9, technology: 13, physical: 4,
      motivation: 10, implementation: 5, other: 4,
    });
  });

  it("puts Grouping, Location and the junctions in 'other'", () => {
    expect(elementsOfLayer("other").sort()).toEqual(["AndJunction", "Grouping", "Location", "OrJunction"]);
  });

  it("knows the layer and aspect of well-known elements", () => {
    expect(layerOf("ApplicationComponent")).toBe("application");
    expect(layerOf("Capability")).toBe("strategy");
    expect(layerOf("WorkPackage")).toBe("implementation");
    expect(ELEMENT_INFO.BusinessActor.aspect).toBe("active");
    expect(ELEMENT_INFO.BusinessProcess.aspect).toBe("behavior");
    expect(ELEMENT_INFO.DataObject.aspect).toBe("passive");
    expect(ELEMENT_INFO.AndJunction.aspect).toBe("connector");
    expect(ELEMENT_INFO.Goal.aspect).toBe("motivation");
  });

  it("gives every element a positive size; junctions are small circles", () => {
    for (const t of ELEMENT_TYPES) {
      expect(ELEMENT_INFO[t].width).toBeGreaterThan(0);
      expect(ELEMENT_INFO[t].height).toBeGreaterThan(0);
    }
    expect(ELEMENT_INFO.AndJunction).toMatchObject({ width: 15, height: 15 });
    expect(ELEMENT_INFO.BusinessActor).toMatchObject({ width: 120, height: 55 });
  });

  it("palette order follows the specification's layering", () => {
    expect(LAYER_ORDER).toEqual([
      "strategy","business","application","technology","physical","motivation","implementation","other",
    ]);
  });

  it("isElementType is a strict guard", () => {
    expect(isElementType("Node")).toBe(true);
    expect(isElementType("node")).toBe(false);
    expect(isElementType(undefined)).toBe(false);
    expect(isElementType(7)).toBe(false);
  });
});
