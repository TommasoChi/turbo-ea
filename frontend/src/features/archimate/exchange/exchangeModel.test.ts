import { describe, it, expect } from "vitest";
import {
  CARD_ID_DEFINITION, emptyModel, getCardId, linkedCardIds, newIdentifier, withCardDefinition, withCardId,
  type ModelElement,
} from "./exchangeModel";

const element = (id: string, cardId: string | null): ModelElement =>
  withCardId({ id, type: "ApplicationComponent", name: id, properties: [] }, cardId);

describe("exchange model helpers", () => {
  it("identifiers are valid XML IDs and unique", () => {
    const ids = Array.from({ length: 50 }, () => newIdentifier());
    expect(new Set(ids).size).toBe(50);
    for (const id of ids) expect(id).toMatch(/^id-[0-9a-f-]{36}$/);
  });

  it("newIdentifier accepts an injected generator", () => expect(newIdentifier(() => "abc")).toBe("id-abc"));

  it("emptyModel has one empty view carrying the model name", () => {
    const m = emptyModel("Landscape", () => "x");
    expect(m).toMatchObject({ name: "Landscape", elements: [], relationships: [], propertyDefinitions: [] });
    expect(m.views).toHaveLength(1);
    expect(m.views[0]).toMatchObject({ name: "Landscape", nodes: [], connections: [] });
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
});
