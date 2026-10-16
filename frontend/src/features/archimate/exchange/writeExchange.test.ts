import { describe, it, expect } from "vitest";
import { MODEL } from "@/test/archimateModel";
import { isRelationshipAllowed } from "../taxonomy/relationships";
import { CARD_ID_DEFINITION, EXCHANGE_NS, emptyModel, type ArchimateModel } from "./exchangeModel";
import { writeExchange } from "./writeExchange";

const XSI = "http://www.w3.org/2001/XMLSchema-instance";
const parse = (xml: string) => new DOMParser().parseFromString(xml, "application/xml");
const all = (root: Document | Element, tag: string) => Array.from(root.getElementsByTagNameNS(EXCHANGE_NS, tag));
const childNames = (e: Element) => Array.from(e.children).map((c) => c.localName);
const byId = (root: Document | Element, tag: string, id: string) =>
  all(root, tag).find((e) => e.getAttribute("identifier") === id)!;

describe("writeExchange", () => {
  const xml = writeExchange(MODEL);
  const doc = parse(xml);
  const root = doc.documentElement;

  it("fixture is itself consistent with the ArchiMate table", () => {
    const type = (id: string) => MODEL.elements.find((e) => e.id === id)!.type;
    for (const r of MODEL.relationships)
      expect(isRelationshipAllowed(type(r.source), type(r.target), r.type)).toBe(true);
  });

  it("writes the root with namespace, identifier, schemaLocation and XSD child order", () => {
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n')).toBe(true);
    expect(xml.endsWith("\n")).toBe(true);
    expect(root.namespaceURI).toBe(EXCHANGE_NS);
    expect(root.localName).toBe("model");
    expect(root.getAttribute("identifier")).toBe("id-model");
    expect(root.getAttributeNS(XSI, "schemaLocation")).toBe(
      "http://www.opengroup.org/xsd/archimate/3.0/ http://www.opengroup.org/xsd/archimate/3.1/archimate3_Diagram.xsd",
    );
    expect(childNames(root)).toEqual(["name", "documentation", "elements", "relationships", "propertyDefinitions", "views"]);
    expect(root.querySelector("name")!.getAttribute("xml:lang")).toBe("en");
    expect(root.querySelector("documentation")!.getAttribute("xml:lang")).toBe("en");
  });

  it("escapes text and drops characters illegal in XML 1.0", () => {
    expect(root.firstElementChild!.textContent).toBe("A & B");
    expect(xml).toContain("A &amp; B");
    expect(xml).toContain("CRM &lt;core&gt;");
    expect(xml).not.toContain("<core>");
    const m: ArchimateModel = { ...MODEL, name: "x\u0001y\u000Bz" };
    expect(parse(writeExchange(m)).documentElement.firstElementChild!.textContent).toBe("xyz");
  });

  it("escapes attribute values", () => {
    const m: ArchimateModel = { ...MODEL, relationships: [{ ...MODEL.relationships[0], influenceModifier: '"<&>"' }] };
    expect(parse(writeExchange(m)).getElementsByTagName("parsererror")).toHaveLength(0);
  });

  it("writes xsi:type and the type-specific relationship attributes", () => {
    for (const e of all(doc, "element")) {
      const src = MODEL.elements.find((x) => x.id === e.getAttribute("identifier"))!;
      expect(e.getAttributeNS(XSI, "type")).toBe(src.type);
    }
    const rels = all(doc, "relationship");
    for (const r of rels) {
      const src = MODEL.relationships.find((x) => x.id === r.getAttribute("identifier"))!;
      expect(r.getAttributeNS(XSI, "type")).toBe(src.type);
    }
    expect(byId(doc, "relationship", "id-rel-access").getAttribute("accessType")).toBe("ReadWrite");
    expect(rels.filter((r) => r.hasAttribute("accessType"))).toHaveLength(1);
    expect(byId(doc, "relationship", "id-rel-assoc").getAttribute("isDirected")).toBe("true");
    expect(rels.filter((r) => r.hasAttribute("isDirected"))).toHaveLength(1);
    expect(byId(doc, "relationship", "id-rel-serving").hasAttribute("accessType")).toBe(false);
    expect(byId(doc, "relationship", "id-rel-access").getAttribute("source")).toBe("id-app");
  });

  it("writes modifier only on Influence and not isDirected=false", () => {
    const m: ArchimateModel = {
      ...MODEL,
      relationships: [
        { id: "id-i", type: "Influence", source: "id-app", target: "id-node", influenceModifier: "++", properties: [] },
        { id: "id-s", type: "Serving", source: "id-node", target: "id-app", influenceModifier: "++", accessType: "Read", properties: [] },
        { id: "id-a", type: "Association", source: "id-app", target: "id-node", isDirected: false, properties: [] },
      ],
    };
    const d = parse(writeExchange(m));
    expect(byId(d, "relationship", "id-i").getAttribute("modifier")).toBe("++");
    expect(byId(d, "relationship", "id-s").hasAttribute("modifier")).toBe(false);
    expect(byId(d, "relationship", "id-s").hasAttribute("accessType")).toBe(false);
    expect(byId(d, "relationship", "id-a").hasAttribute("isDirected")).toBe(false);
  });

  it("nests child nodes with parent-relative coordinates", () => {
    const view = all(doc, "view")[0];
    const g1 = byId(doc, "node", "id-g1");
    const n2 = byId(doc, "node", "id-n2");
    expect(n2.parentElement).toBe(g1);
    expect(n2.parentElement).not.toBe(view);
    expect([n2.getAttribute("x"), n2.getAttribute("y")]).toEqual(["30", "40"]);
    expect([g1.getAttribute("x"), g1.getAttribute("y")]).toEqual(["100", "100"]);
    expect(n2.getAttributeNS(XSI, "type")).toBe("Element");
    expect(n2.getAttribute("elementRef")).toBe("id-data");
    expect(Array.from(view.children).filter((c) => c.localName === "node").map((c) => c.getAttribute("identifier"))).toEqual(["id-n1", "id-g1"]);
  });

  it("writes bendpoints in order with absolute values", () => {
    const c = byId(doc, "connection", "id-c1");
    expect(c.getAttributeNS(XSI, "type")).toBe("Relationship");
    expect(c.getAttribute("relationshipRef")).toBe("id-rel-access");
    expect([c.getAttribute("source"), c.getAttribute("target")]).toEqual(["id-n1", "id-n2"]);
    expect(all(c, "bendpoint").map((b) => [b.getAttribute("x"), b.getAttribute("y")])).toEqual([["70", "150"], ["120", "160"]]);
  });

  it("writes the card link as a property plus its definition", () => {
    const app = byId(doc, "element", "id-app");
    const prop = all(app, "property")[0];
    expect(prop.getAttribute("propertyDefinitionRef")).toBe(CARD_ID_DEFINITION);
    expect(prop.querySelector("value")!.textContent).toBe("c1");
    expect(prop.querySelector("value")!.getAttribute("xml:lang")).toBe("en");
    expect(app.querySelector("properties")).not.toBeNull();
    expect(byId(doc, "element", "id-node").querySelector("properties")).toBeNull();
    const def = byId(doc, "propertyDefinition", CARD_ID_DEFINITION);
    expect(def.getAttribute("type")).toBe("string");
    expect(def.querySelector("name")!.textContent).toBe("turboea:cardId");
    expect(xml).toContain('<property propertyDefinitionRef="propid-turboea-cardId">');
  });

  it("is deterministic", () => expect(writeExchange(MODEL)).toBe(writeExchange(structuredClone(MODEL))));

  it("is well formed and every reference resolves", () => {
    expect(doc.getElementsByTagName("parsererror")).toHaveLength(0);
    const ids = new Set(all(doc, "element").map((e) => e.getAttribute("identifier")));
    const rels = new Set(all(doc, "relationship").map((e) => e.getAttribute("identifier")));
    const nodes = new Set(all(doc, "node").map((e) => e.getAttribute("identifier")));
    for (const r of all(doc, "relationship")) {
      expect(ids.has(r.getAttribute("source"))).toBe(true);
      expect(ids.has(r.getAttribute("target"))).toBe(true);
    }
    for (const n of all(doc, "node")) expect(ids.has(n.getAttribute("elementRef"))).toBe(true);
    for (const c of all(doc, "connection")) {
      expect(rels.has(c.getAttribute("relationshipRef"))).toBe(true);
      expect(nodes.has(c.getAttribute("source"))).toBe(true);
      expect(nodes.has(c.getAttribute("target"))).toBe(true);
    }
    const every = Array.from(doc.querySelectorAll("[identifier]")).map((e) => e.getAttribute("identifier"));
    expect(new Set(every).size).toBe(every.length);
  });

  it("writes numbers as integers", () => {
    const m = structuredClone(MODEL);
    m.views[0].nodes[0].x = 10.6;
    m.views[0].connections[0].bendpoints[0].y = 150.4;
    const d = parse(writeExchange(m));
    expect(byId(d, "node", "id-n1").getAttribute("x")).toBe("11");
    expect(all(d, "bendpoint")[0].getAttribute("y")).toBe("150");
  });

  it("writes node styles", () => {
    const m = structuredClone(MODEL);
    m.views[0].nodes[0].style = { fillColor: { r: 1, g: 2, b: 3 }, lineColor: { r: 4, g: 5, b: 6 } };
    const n = byId(parse(writeExchange(m)), "node", "id-n1");
    const style = all(n, "style")[0];
    expect(childNames(style)).toEqual(["fillColor", "lineColor"]);
    expect(all(style, "fillColor")[0].getAttribute("g")).toBe("2");
    expect(all(style, "lineColor")[0].getAttribute("b")).toBe("6");
  });

  it("an empty model has only name and views", () => {
    const d = parse(writeExchange(emptyModel("Empty", () => "x")));
    expect(childNames(d.documentElement)).toEqual(["name", "views"]);
    expect(all(d, "elements")).toHaveLength(0);
    expect(all(d, "view")).toHaveLength(1);
  });
});
