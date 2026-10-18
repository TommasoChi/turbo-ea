import {
  CARD_ID_DEFINITION, getCardId, isCustomEnterpriseObject,
  type CustomEnterpriseObject, type ModelElement, type ModelRelationship, type NoteObject,
} from "../exchange/exchangeModel";
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

  it("creates a fresh note with its own default size, no ArchiMate type", () => {
    const shape = factory.createShape({ isNote: true });
    expect(shape).toMatchObject({ width: 140, height: 90 });
    expect(shape.businessObject).toEqual({ id: expect.stringMatching(/^id-/), isNote: true, name: "" });
    expect(shape.id).not.toBe(shape.businessObject.id);
    const other = factory.createShape({ isNote: true });
    expect(other.businessObject.id).not.toBe(shape.businessObject.id);
  });

  it("clones a pasted note with a new id and the same text, never a card concept", () => {
    const bo: NoteObject = { id: "id-note-src", isNote: true, name: "Ask the team" };
    const shape = factory.createShape({ id: "id-shape-src", businessObject: bo });
    expect(shape.id).not.toBe("id-shape-src");
    expect(shape.businessObject).toEqual({ id: expect.stringMatching(/^id-/), isNote: true, name: "Ask the team" });
    expect(shape.businessObject.id).not.toBe("id-note-src");
    expect(shape).toMatchObject({ width: 140, height: 90 });
  });

  it("keeps the id of an imported note", () => {
    const bo: NoteObject = { id: "id-note", isNote: true, name: "x" };
    const shape = factory.createShape({ id: "id-note", businessObject: bo, x: 5, y: 6, width: 140, height: 90, fromModel: true });
    expect(shape).toMatchObject({ id: "id-note", x: 5, y: 6 });
    expect(shape.businessObject).toBe(bo);
  });

  it("creates a fresh custom Enterprise Object shape, same default size as a note, unnamed by default", () => {
    const shape = factory.createShape({ enterpriseObjectKey: "AIModel" });
    expect(shape).toMatchObject({ width: 140, height: 90 });
    expect(isCustomEnterpriseObject(shape.businessObject)).toBe(true);
    expect(shape.businessObject).toEqual({
      id: expect.stringMatching(/^id-/), isCustomObject: true, enterpriseObjectKey: "AIModel", name: "",
    });
    expect(shape.id).not.toBe(shape.businessObject.id);
    const other = factory.createShape({ enterpriseObjectKey: "AIModel" });
    expect(other.businessObject.id).not.toBe(shape.businessObject.id);
    expect(other.id).not.toBe(shape.id);
  });

  it("names a custom object when a name is passed", () => {
    const shape = factory.createShape({ enterpriseObjectKey: "AIModel", name: "My Model" });
    expect(shape.businessObject).toMatchObject({ enterpriseObjectKey: "AIModel", name: "My Model" });
  });

  it("clones a pasted custom object with a new id, same key and text, never a card concept", () => {
    const bo: CustomEnterpriseObject = {
      id: "id-custom-src", isCustomObject: true, enterpriseObjectKey: "AIModel", name: "Fraud Detector",
    };
    // Regression: the generic `businessObject`-copy branch calls `withCardId`, which reads
    // `properties` -- a field a CustomEnterpriseObject does not have. This must not reach it.
    expect(() => factory.createShape({ id: "id-shape-src", businessObject: bo })).not.toThrow();
    const shape = factory.createShape({ id: "id-shape-src", businessObject: bo });
    expect(shape.id).not.toBe("id-shape-src");
    expect(isCustomEnterpriseObject(shape.businessObject)).toBe(true);
    expect(shape.businessObject).toEqual({
      id: expect.stringMatching(/^id-/), isCustomObject: true, enterpriseObjectKey: "AIModel", name: "Fraud Detector",
    });
    expect(shape.businessObject.id).not.toBe("id-custom-src");
    expect(shape).toMatchObject({ width: 140, height: 90 });
  });
});
