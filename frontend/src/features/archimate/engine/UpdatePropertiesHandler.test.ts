import type { Element } from "diagram-js/lib/model/Types";
import { CARD_ID_DEFINITION, type ModelElement, type ModelRelationship } from "../exchange/exchangeModel";
import UpdatePropertiesHandler, { type PropertyUpdate, type UpdatePropertiesContext } from "./UpdatePropertiesHandler";

const handler = new UpdatePropertiesHandler();

/** Runs execute, checks the result, reverts, and returns the business object as it was after execute. */
function roundTrip(element: Element, properties: PropertyUpdate) {
  const before = structuredClone(element.businessObject);
  const context: UpdatePropertiesContext = { element, properties };
  expect(handler.execute(context)).toEqual([element]);
  const after = structuredClone(element.businessObject);
  expect(handler.revert(context)).toEqual([element]);
  expect(element.businessObject).toStrictEqual(before); // no `key: undefined` left behind
  return after;
}

const shape = (bo: Partial<ModelElement> = {}) =>
  ({ id: "s", businessObject: { id: "e", type: "BusinessActor", name: "A", properties: [], ...bo } }) as unknown as Element;
const connection = (bo: Partial<ModelRelationship> = {}) =>
  ({
    id: "c", waypoints: [],
    businessObject: { id: "r", type: "Access", source: "a", target: "b", properties: [], ...bo },
  }) as unknown as Element;

describe("UpdatePropertiesHandler", () => {
  it("sets and restores an element's name and documentation", () => {
    expect(roundTrip(shape(), { name: "CEO" }).name).toBe("CEO");
    expect(roundTrip(shape(), { documentation: "Doc" }).documentation).toBe("Doc");
    expect(roundTrip(shape({ documentation: "Old" }), { documentation: "New" }).documentation).toBe("New");
  });

  it("sets and restores a relationship's access type and direction", () => {
    expect(roundTrip(connection(), { accessType: "Write" }).accessType).toBe("Write");
    expect(roundTrip(connection({ accessType: "Read" }), { accessType: "ReadWrite" }).accessType).toBe("ReadWrite");
    expect(roundTrip(connection({ type: "Association" }), { isDirected: true }).isDirected).toBe(true);
  });

  it("sets, replaces and clears the card link, keeping the other properties", () => {
    const other = { ref: "propid-other", value: "x" };
    const card = (value: string) => ({ ref: CARD_ID_DEFINITION, value });
    expect(roundTrip(shape({ properties: [other] }), { cardId: "c1" }).properties).toEqual([other, card("c1")]);
    expect(roundTrip(shape({ properties: [card("c1"), other] }), { cardId: "c2" }).properties).toEqual([other, card("c2")]);
    expect(roundTrip(shape({ properties: [card("c1"), other] }), { cardId: null }).properties).toEqual([other]);
  });

  it("refuses a card link on a relationship", () => {
    const c = connection();
    expect(() => handler.execute({ element: c, properties: { cardId: "c1" } })).toThrow();
    expect(c.businessObject.properties).toEqual([]);
  });
});
