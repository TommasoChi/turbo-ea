import { afterEach, describe, it, expect, vi } from "vitest";
import {
  ARCHIMATE_FORMAT, CARD_ID_DEFINITION, addCardNode, emptyModel, getCardId, isNoteObject, linkedCardIds,
  newIdentifier, withCardDefinition, withCardId, type ModelElement,
} from "./exchangeModel";

const element = (id: string, cardId: string | null): ModelElement =>
  withCardId({ id, type: "ApplicationComponent", name: id, properties: [] }, cardId);

describe("exchange model helpers", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("names the format the server stores for an ArchiMate diagram", () => {
    expect(ARCHIMATE_FORMAT).toBe("archimate-exchange-3.1");
  });

  it("identifiers are valid XML IDs and unique", () => {
    const ids = Array.from({ length: 50 }, () => newIdentifier());
    expect(new Set(ids).size).toBe(50);
    for (const id of ids) expect(id).toMatch(/^id-[0-9a-f-]{36}$/);
  });

  it("newIdentifier falls back to getRandomValues when crypto.randomUUID is unavailable", () => {
    vi.stubGlobal("crypto", { getRandomValues: crypto.getRandomValues.bind(crypto) });
    const ids = Array.from({ length: 50 }, () => newIdentifier());
    expect(new Set(ids).size).toBe(50);
    for (const id of ids) expect(id).toMatch(/^id-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it("newIdentifier accepts an injected generator", () => expect(newIdentifier(() => "abc")).toBe("id-abc"));

  it("emptyModel has one empty view carrying the model name", () => {
    const m = emptyModel("Landscape", () => "x");
    expect(m).toMatchObject({ name: "Landscape", elements: [], relationships: [], propertyDefinitions: [], properties: [] });
    expect(m.views).toHaveLength(1);
    expect(m.views[0]).toMatchObject({ name: "Landscape", nodes: [], connections: [], notes: [] });
  });

  it("isNoteObject recognises only a note's business object", () => {
    expect(isNoteObject({ id: "n1", isNote: true, name: "x" })).toBe(true);
    expect(isNoteObject({ id: "e1", type: "BusinessActor", name: "x", properties: [] })).toBe(false);
    expect(isNoteObject({ isNote: false })).toBe(false);
    expect(isNoteObject(null)).toBe(false);
    expect(isNoteObject(undefined)).toBe(false);
    expect(isNoteObject("isNote")).toBe(false);
  });

  it("withCardId sets, replaces and clears the property without touching others", () => {
    const el = { properties: [{ ref: "other", value: "1" }] };
    const linked = withCardId(el, "c1");
    expect(getCardId(linked)).toBe("c1");
    expect(linked.properties).toContainEqual({ ref: "other", value: "1" });
    expect(getCardId(withCardId(linked, "c2"))).toBe("c2");
    expect(withCardId(linked, "c2").properties.filter((p) => p.ref === CARD_ID_DEFINITION)).toHaveLength(1);
    expect(getCardId(withCardId(linked, null))).toBeNull();
    expect(withCardId(linked, null).properties).toEqual([{ ref: "other", value: "1" }]);
  });

  it("linkedCardIds lists each card once, in element order", () => {
    const m = emptyModel("M");
    m.elements = [element("a", "c1"), element("b", "c2"), element("c", "c1"), element("d", null)];
    expect(linkedCardIds(m)).toEqual(["c1", "c2"]);
    expect(linkedCardIds(emptyModel("M"))).toEqual([]);
  });

  it("withCardDefinition adds the definition once and only when needed", () => {
    const plain = emptyModel("M");
    plain.elements = [element("a", null)];
    expect(withCardDefinition(plain)).toBe(plain);
    expect(withCardDefinition(plain).propertyDefinitions).toEqual([]);

    const linked = { ...plain, elements: [element("a", "c1")] };
    const once = withCardDefinition(linked);
    expect(once.propertyDefinitions).toEqual([
      { id: CARD_ID_DEFINITION, name: "turboea:cardId", type: "string" },
    ]);
    expect(withCardDefinition(once).propertyDefinitions).toHaveLength(1);
    expect(linked.propertyDefinitions).toEqual([]); // input not mutated
  });

  it("addCardNode adds one linked element and node to the first view, registering the card-id definition", () => {
    const m = emptyModel("M", () => "x");
    const withNode = addCardNode(m, "ApplicationComponent", "CRM", "c1", () => "y");
    expect(withNode.elements).toHaveLength(1);
    expect(withNode.elements[0]).toMatchObject({ type: "ApplicationComponent", name: "CRM" });
    expect(getCardId(withNode.elements[0])).toBe("c1");
    expect(withNode.views[0].nodes).toHaveLength(1);
    expect(withNode.views[0].nodes[0]).toMatchObject({
      elementRef: withNode.elements[0].id, width: 120, height: 55,
    });
    expect(withNode.propertyDefinitions).toEqual([
      { id: CARD_ID_DEFINITION, name: "turboea:cardId", type: "string" },
    ]);
    expect(m.elements).toEqual([]); // input not mutated
  });

  it("addCardNode places the new node clear of whatever nodes are already there", () => {
    const m = emptyModel("M");
    m.views[0].nodes = [{ id: "n1", elementRef: "e1", x: 100, y: 40, width: 120, height: 55, parent: null }];
    const withNode = addCardNode(m, "ApplicationComponent", "CRM", "c1");
    expect(withNode.views[0].nodes[1].x).toBe(100 + 120 + 40); // past the existing node, plus the gap
  });
});
