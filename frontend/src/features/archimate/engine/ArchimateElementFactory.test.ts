import { CARD_ID_DEFINITION, getCardId, type ModelElement, type ModelRelationship } from "../exchange/exchangeModel";
import ArchimateElementFactory from "./ArchimateElementFactory";

describe("ArchimateElementFactory", () => {
  const factory = new ArchimateElementFactory();

  it("creates a fresh element with new ids and the standard size", () => {
    const shape = factory.createShape({ elementType: "BusinessActor" });
    expect(shape).toMatchObject({ width: 120, height: 55 });
    expect(shape.businessObject).toEqual({
      id: expect.stringMatching(/^id-/), type: "BusinessActor", name: "", properties: [],
    });
    expect(shape.id).toMatch(/^id-/);
    expect(shape.id).not.toBe(shape.businessObject.id);
    const other = factory.createShape({ elementType: "BusinessActor" });
    expect(other.id).not.toBe(shape.id);
    expect(other.businessObject.id).not.toBe(shape.businessObject.id);
    expect(factory.createShape({ elementType: "AndJunction" })).toMatchObject({ width: 15, height: 15 });
  });

  it("creates a fresh relationship carrying its access type", () => {
    const connection = factory.createConnection({ relationship: "Access", accessType: "Read" });
    expect(connection.id).toMatch(/^id-/);
    expect(connection.businessObject).toMatchObject({
      id: expect.stringMatching(/^id-/), type: "Access", accessType: "Read", properties: [],
    });
  });

  it("clones a pasted business object with new ids and no card link", () => {
    const bo: ModelElement = {
      id: "id-src", type: "ApplicationComponent", name: "CRM", properties: [{ ref: CARD_ID_DEFINITION, value: "c1" }],
    };
    const shape = factory.createShape({ id: "id-shape-src", businessObject: bo });
    expect(shape.id).not.toBe("id-shape-src");
    expect(shape.businessObject.id).not.toBe("id-src");
    expect(shape.businessObject).not.toBe(bo);
    expect(shape.businessObject.name).toBe("CRM");
    expect(getCardId(shape.businessObject)).toBeNull();
    expect(getCardId(bo)).toBe("c1");
  });

  it("keeps the ids of an imported element and relationship", () => {
    const bo: ModelElement = { id: "id-el", type: "Node", name: "N", properties: [] };
    const shape = factory.createShape({ id: "id-n", businessObject: bo, x: 1, y: 2, width: 30, height: 40, fromModel: true });
    expect(shape).toMatchObject({ id: "id-n", x: 1, y: 2, width: 30, height: 40 });
    expect(shape.businessObject).toBe(bo);
    expect(shape.fromModel).toBeUndefined();
    const rel: ModelRelationship = { id: "id-r", type: "Serving", source: "a", target: "b", properties: [] };
    const connection = factory.createConnection({ id: "id-c", businessObject: rel, waypoints: [], fromModel: true });
    expect(connection.id).toBe("id-c");
    expect(connection.businessObject).toBe(rel);
  });
});
