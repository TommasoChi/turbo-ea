import { afterEach, describe, it, expect, vi } from "vitest";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { MODEL } from "@/test/archimateModel";
import { describeSourceScan } from "@/test/sourceScan";
import { EXCHANGE_NS } from "./exchangeModel";
import { writeExchange } from "./writeExchange";
import {
  EXCHANGE_ERROR_CODES, ExchangeParseError, MAX_EXCHANGE_BYTES, exchangeWarnings, readExchange, requireView,
  type ExchangeErrorCode,
} from "./readExchange";

const fixture = (name: string) => readFileSync(resolve(__dirname, "fixtures", name), "utf-8");
const XSI = "http://www.w3.org/2001/XMLSchema-instance";

/** A well-formed Exchange document around `inner` (children of <model>). */
const doc = (inner: string, attrs = 'identifier="m"') =>
  `<?xml version="1.0" encoding="UTF-8"?><model xmlns="${EXCHANGE_NS}" xmlns:xsi="${XSI}" ${attrs}>${inner}</model>`;
const el = (id: string, type = "BusinessActor") => `<element identifier="${id}" xsi:type="${type}"/>`;
const elements = (...items: string[]) => `<elements>${items.join("")}</elements>`;
const rel = (id: string, source: string, target: string, type = "Serving") =>
  `<relationship identifier="${id}" xsi:type="${type}" source="${source}" target="${target}"/>`;
const relationships = (...items: string[]) => `<relationships>${items.join("")}</relationships>`;
const views = (...items: string[]) => `<views><diagrams>${items.join("")}</diagrams></views>`;
const view = (inner: string, id = "v") => `<view identifier="${id}" xsi:type="Diagram">${inner}</view>`;
const node = (id: string, ref: string, inner = "") =>
  `<node identifier="${id}" xsi:type="Element" elementRef="${ref}" x="10" y="10" w="100" h="50">${inner}</node>`;
const conn = (id: string, ref: string, source: string, target: string) =>
  `<connection identifier="${id}" xsi:type="Relationship" relationshipRef="${ref}" source="${source}" target="${target}"/>`;

function failure(xml: string): ExchangeParseError {
  try {
    readExchange(xml);
  } catch (e) {
    expect(e).toBeInstanceOf(ExchangeParseError);
    return e as ExchangeParseError;
  }
  throw new Error("readExchange did not throw");
}

afterEach(() => vi.restoreAllMocks());

describe("readExchange: round trip", () => {
  it("readExchange(writeExchange(MODEL)) equals MODEL", () => {
    expect(readExchange(writeExchange(MODEL))).toEqual(MODEL);
  });

  it("keeps absolute coordinates for a nested node and sets its parent", () => {
    const nested = readExchange(writeExchange(MODEL)).views[0].nodes.find((n) => n.id === "id-n2")!;
    expect(nested).toMatchObject({ x: 130, y: 140, parent: "id-g1" });
  });

  it("round-trips node styles, multi-line text and an empty model", () => {
    const styled = structuredClone(MODEL);
    styled.views[0].nodes[0].style = { fillColor: { r: 1, g: 2, b: 3 }, lineColor: { r: 4, g: 5, b: 6 } };
    styled.documentation = "line 1\nline 2\r\n  indented";
    expect(readExchange(writeExchange(styled))).toEqual(styled);
    const empty = { id: "m", name: "", propertyDefinitions: [], elements: [], relationships: [], views: [] };
    expect(readExchange(writeExchange(empty))).toEqual(empty);
  });

  it("round-trips Influence modifiers and relationships that target a relationship", () => {
    const m = structuredClone(MODEL);
    m.relationships.push(
      { id: "id-rel-infl", type: "Influence", source: "id-app", target: "id-data", influenceModifier: "++", properties: [] },
      { id: "id-rel-onrel", type: "Association", source: "id-app", target: "id-rel-serving", properties: [] },
    );
    expect(readExchange(writeExchange(m))).toEqual(m);
  });
});

describe("readExchange: fixtures", () => {
  it("minimal.xml: one element, no view, no throw", () => {
    const m = readExchange(fixture("minimal.xml"));
    expect(m.elements).toEqual([{ id: "id-min-app", type: "ApplicationComponent", name: "Only element", properties: [] }]);
    expect(m.views).toEqual([]);
    expect(m.relationships).toEqual([]);
  });

  it("multiview.xml: keeps both views, in order", () => {
    const m = readExchange(fixture("multiview.xml"));
    expect(m.views.map((v) => v.name)).toEqual(["First", "Second"]);
    expect(m.views[0].connections).toHaveLength(1);
    expect(m.views[1].documentation).toBe("Only the actor");
  });

  describe("archi-export.xml", () => {
    const xml = fixture("archi-export.xml");
    const m = readExchange(xml);

    it("ignores organizations but warns about them", () => {
      expect(exchangeWarnings(xml)).toEqual(["organizations"]);
      expect(exchangeWarnings(fixture("minimal.xml"))).toEqual([]);
      expect(m.elements).toHaveLength(5);
    });

    it("maps the junction to AndJunction (no name)", () => {
      expect(m.elements.find((e) => e.id === "id-archi-and")).toEqual({
        id: "id-archi-and", type: "AndJunction", name: "", properties: [],
      });
    });

    it("gives the nested node absolute coordinates and its parent", () => {
      const nested = m.views[0].nodes.find((n) => n.id === "id-archi-n5")!;
      expect(nested).toMatchObject({ x: 120, y: 130, width: 120, height: 55, parent: "id-archi-n4" });
    });

    it("reads <style> colours and keeps connection bendpoints", () => {
      const group = m.views[0].nodes.find((n) => n.id === "id-archi-n4")!;
      expect(group.style).toEqual({ fillColor: { r: 255, g: 0, b: 0 }, lineColor: { r: 92, g: 92, b: 92 } });
      expect(m.views[0].connections.find((c) => c.id === "id-archi-c2")!.bendpoints).toEqual([{ x: 190, y: 80 }]);
    });

    it("reads property definitions and element properties", () => {
      expect(m.propertyDefinitions).toEqual([{ id: "id-archi-propdef-owner", name: "owner", type: "string" }]);
      expect(m.elements.find((e) => e.id === "id-archi-process")!.properties).toEqual([
        { ref: "id-archi-propdef-owner", value: "Sales" },
      ]);
    });
  });

  it("everything it reads is written back to a document it reads identically", () => {
    for (const f of ["minimal.xml", "multiview.xml", "archi-export.xml"]) {
      const m = readExchange(fixture(f));
      expect(readExchange(writeExchange(m))).toEqual(m);
    }
  });
});

describe("readExchange: hostile and invalid input", () => {
  const billionLaughs =
    '<?xml version="1.0"?><!DOCTYPE lolz [<!ENTITY lol "lol"><!ENTITY lol2 "&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;">' +
    '<!ENTITY lol3 "&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;">]><lolz>&lol3;</lolz>';
  const cases: [string, string, ExchangeErrorCode, string?][] = [
    ["DOCTYPE with an external entity", `<?xml version="1.0"?><!DOCTYPE foo [<!ENTITY x SYSTEM "file:///etc/passwd">]>${doc("")}`, "dtd_forbidden"],
    ["billion laughs", billionLaughs, "dtd_forbidden"],
    ["lower-case doctype", `<!doctype foo>${doc("")}`, "dtd_forbidden"],
    ["ENTITY without DOCTYPE", `<!ENTITY x "y">${doc("")}`, "dtd_forbidden"],
    ["too large (ASCII)", "<a>" + "x".repeat(MAX_EXCHANGE_BYTES), "too_large"],
    ["too large (multi-byte: under the limit in characters, over it in UTF-8 bytes)", "€".repeat(Math.floor(MAX_EXCHANGE_BYTES / 3) + 1), "too_large"],
    ["truncated XML", "<model", "xml_invalid"],
    ["empty string", "", "xml_invalid"],
    ["undefined entity reference", doc("<name>&nope;</name>"), "xml_invalid"],
    ["foreign root", '<foo xmlns="http://example.com/x"/>', "wrong_root"],
    ["model without namespace", "<model/>", "wrong_root"],
    ["model in another namespace", '<model xmlns="http://example.com/x"/>', "wrong_root"],
    ["unknown element type", doc(elements(el("e1", "Banana"))), "unknown_element_type", "e1"],
    ["element without xsi:type", doc(elements('<element identifier="e1"/>')), "unknown_element_type", "e1"],
    ["unknown relationship type", doc(elements(el("e1"), el("e2")) + relationships(rel("r1", "e1", "e2", "Banana"))), "unknown_relationship_type", "r1"],
    ["relationship to a missing element", doc(elements(el("e1")) + relationships(rel("r1", "e1", "nope"))), "dangling_reference", "r1"],
    ["relationship without a source", doc(elements(el("e1")) + relationships('<relationship identifier="r1" xsi:type="Serving" target="e1"/>')), "dangling_reference", "r1"],
    ["two elements with the same identifier", doc(elements(el("e1"), el("e1"))), "duplicate_identifier", "e1"],
    ["an element and a relationship sharing an identifier", doc(elements(el("e1"), el("e2")) + relationships(rel("e1", "e1", "e2"))), "duplicate_identifier", "e1"],
    ["a view and an element sharing an identifier", doc(elements(el("e1")) + views(view("", "e1"))), "duplicate_identifier", "e1"],
    ["a node and a connection sharing an identifier", doc(
      elements(el("e1"), el("e2")) + relationships(rel("r1", "e1", "e2")) +
      views(view(node("n1", "e1") + node("n2", "e2") + conn("n1", "r1", "n1", "n2"))),
    ), "duplicate_identifier", "n1"],
    ["a property definition sharing the model identifier", doc('<propertyDefinitions><propertyDefinition identifier="m" type="string"/></propertyDefinitions>'), "duplicate_identifier", "m"],
    ["element without an identifier", doc(elements('<element xsi:type="BusinessActor"/>')), "missing_identifier", "BusinessActor"],
    ["empty identifier", doc(elements('<element identifier="" xsi:type="BusinessActor"/>')), "missing_identifier"],
    ["relationship without an identifier", doc(elements(el("e1"), el("e2")) + relationships('<relationship xsi:type="Serving" source="e1" target="e2"/>')), "missing_identifier", "Serving"],
    ["node without an identifier", doc(elements(el("e1")) + views(view('<node xsi:type="Element" elementRef="e1" x="1" y="1" w="1" h="1"/>'))), "missing_identifier", "Element"],
    ["connection without an identifier", doc(
      elements(el("e1"), el("e2")) + relationships(rel("r1", "e1", "e2")) +
      views(view(node("n1", "e1") + node("n2", "e2") + '<connection xsi:type="Relationship" relationshipRef="r1" source="n1" target="n2"/>')),
    ), "missing_identifier", "Relationship"],
    ["model without an identifier", doc("", 'xml:lang="en"'), "missing_identifier"],
    ["node pointing at a missing element", doc(elements(el("e1")) + views(view(node("n1", "nope")))), "dangling_reference", "n1"],
    ["connection whose relationshipRef does not exist", doc(
      elements(el("e1")) + views(view(node("n1", "e1") + node("n2", "e1") + conn("c1", "nope", "n1", "n2"))),
    ), "dangling_reference", "c1"],
    ["connection endpoint that is not a node", doc(
      elements(el("e1"), el("e2")) + relationships(rel("r1", "e1", "e2")) +
      views(view(node("n1", "e1") + conn("c1", "r1", "n1", "nope"))),
    ), "dangling_reference", "c1"],
    ["connection without source and target", doc(
      elements(el("e1"), el("e2")) + relationships(rel("r1", "e1", "e2")) +
      views(view(node("n1", "e1") + '<connection identifier="c1" xsi:type="Relationship" relationshipRef="r1"/>')),
    ), "dangling_reference", "c1"],
    ["connection to a node of another view", doc(
      elements(el("e1"), el("e2")) + relationships(rel("r1", "e1", "e2")) +
      views(view(node("n1", "e1") + node("n2", "e2"), "v1"), view(node("n3", "e1") + conn("c1", "r1", "n3", "n1"), "v2")),
    ), "dangling_reference", "c1"],
    ["connection whose source node shows the wrong element", doc(
      elements(el("e1"), el("e2"), el("e3")) + relationships(rel("r1", "e1", "e2")) +
      views(view(node("n1", "e3") + node("n2", "e2") + conn("c1", "r1", "n1", "n2"))),
    ), "dangling_reference", "c1"],
    ["connection whose target node shows the wrong element", doc(
      elements(el("e1"), el("e2"), el("e3")) + relationships(rel("r1", "e1", "e2")) +
      views(view(node("n1", "e1") + node("n2", "e3") + conn("c1", "r1", "n1", "n2"))),
    ), "dangling_reference", "c1"],
    ["connection reversed against its relationship", doc(
      elements(el("e1"), el("e2")) + relationships(rel("r1", "e1", "e2")) +
      views(view(node("n1", "e1") + node("n2", "e2") + conn("c1", "r1", "n2", "n1"))),
    ), "dangling_reference", "c1"],
    ["connection whose source node was skipped as a label", doc(
      elements(el("e1"), el("e2")) + relationships(rel("r1", "e1", "e2")) +
      views(view('<node identifier="lab" xsi:type="Label" x="1" y="1" w="1" h="1"/>' + node("n2", "e2") + conn("c1", "r1", "lab", "n2"))),
    ), "dangling_reference", "c1"],
    ["unknown accessType", doc(elements(el("e1"), el("e2")) + relationships('<relationship identifier="r1" xsi:type="Access" source="e1" target="e2" accessType="Banana"/>')), "xml_invalid", "r1"],
    ["non-numeric coordinates", doc(elements(el("e1")) + views(view('<node identifier="n1" xsi:type="Element" elementRef="e1" x="abc" y="1" w="1" h="1"/>'))), "xml_invalid", "n1"],
  ];

  const nodeWith = (attrs: string) =>
    doc(elements(el("e1")) + views(view(`<node identifier="n1" xsi:type="Element" elementRef="e1" ${attrs}/>`)));
  const bad = [" 5 ", "1.5", "0x1F", "1e3", "", "+5", "5px", "9".repeat(400), "9007199254740993"].map((v) => [
    `non-integer x ${JSON.stringify(v)}`, nodeWith(`x="${v}" y="1" w="1" h="1"`),
  ] as const);
  it.each(bad)("%s", (_label, xml) => {
    const error = failure(xml);
    expect([error.code, error.ref]).toEqual(["xml_invalid", "n1"]);
  });

  it("accepts negative integers and rejects a missing attribute", () => {
    expect(readExchange(nodeWith('x="-5" y="1" w="1" h="1"')).views[0].nodes[0].x).toBe(-5);
    expect(failure(nodeWith('y="1" w="1" h="1"')).code).toBe("xml_invalid");
  });

  it.each(["256", "-1", "1.5", "red"])("rejects the colour channel %s", (v) => {
    const xml = doc(elements(el("e1")) + views(view(node("n1", "e1", `<style><fillColor r="${v}" g="0" b="0"/></style>`))));
    const error = failure(xml);
    expect([error.code, error.ref]).toEqual(["xml_invalid", "n1"]);
  });

  it("accepts the colour channel bounds 0 and 255", () => {
    const xml = doc(elements(el("e1")) + views(view(node("n1", "e1", '<style><lineColor r="0" g="255" b="0"/></style>'))));
    expect(readExchange(xml).views[0].nodes[0].style).toEqual({ lineColor: { r: 0, g: 255, b: 0 } });
  });

  it.each(cases)("%s", (_label, xml, code, ref) => {
    const error = failure(xml);
    expect(error.code).toBe(code);
    if (ref !== undefined) expect(error.ref).toBe(ref);
  });

  it("covers every ExchangeErrorCode the reader can throw but no_view", () => {
    expect(new Set(cases.map((c) => c[2]))).toEqual(new Set(EXCHANGE_ERROR_CODES.filter((c) => c !== "no_view")));
  });

  it("EXCHANGE_ERROR_CODES lists the 10 codes, missing_identifier last", () => {
    expect(EXCHANGE_ERROR_CODES).toHaveLength(10);
    expect(EXCHANGE_ERROR_CODES[9]).toBe("missing_identifier");
    expect(new Set(EXCHANGE_ERROR_CODES).size).toBe(10);
  });

  it("checks size and DTD on the raw string, before the DOM parser is ever created", () => {
    const parse = vi.spyOn(DOMParser.prototype, "parseFromString");
    failure("<a>" + "x".repeat(MAX_EXCHANGE_BYTES));
    failure(`<!DOCTYPE foo [<!ENTITY x "y">]>${doc("")}`);
    failure("€".repeat(MAX_EXCHANGE_BYTES));
    expect(parse).not.toHaveBeenCalled();
    readExchange(doc(""));
    expect(parse).toHaveBeenCalledOnce();
  });

  it("accepts a document just under the size limit", () => {
    const padding = `<documentation>${"x".repeat(1024 * 1024)}</documentation>`;
    expect(readExchange(doc(padding)).documentation).toHaveLength(1024 * 1024);
  });

  it("never throws anything but ExchangeParseError (parser failure, non-string input)", () => {
    vi.spyOn(DOMParser.prototype, "parseFromString").mockImplementation(() => {
      throw new RangeError("Maximum call stack size exceeded");
    });
    expect(failure(doc("")).code).toBe("xml_invalid");
    vi.restoreAllMocks();
    expect(() => readExchange(undefined as unknown as string)).toThrow(ExchangeParseError);
    expect(() => readExchange(42 as unknown as string)).toThrow(ExchangeParseError);
    expect(() => exchangeWarnings(null as unknown as string)).toThrow(ExchangeParseError);
  });

  it("survives deeply nested nodes (iterative walk: no stack overflow)", () => {
    const depth = 1000;
    const nodes = Array.from({ length: depth }, (_, i) =>
      `<node identifier="n${i}" xsi:type="Element" elementRef="e1" x="1" y="1" w="10" h="10">`).join("");
    const xml = doc(elements(el("e1")) + views(view(nodes + "</node>".repeat(depth))));
    const m = readExchange(xml);
    expect(m.views[0].nodes).toHaveLength(depth);
    expect(m.views[0].nodes[depth - 1]).toMatchObject({ x: depth, y: depth, parent: `n${depth - 2}` });
  });

  it("truncates attacker-controlled identifiers echoed in errors", () => {
    const error = failure(doc(elements(el("x".repeat(500), "Banana"))));
    expect(error.ref).toHaveLength(80);
    expect(error.message.length).toBeLessThan(200);
  });
});

describe("readExchange: structure", () => {
  it("skips labels and plain connections, re-parenting a container's children", () => {
    const xml = doc(
      elements(el("e1"), el("e2")) + relationships(rel("r1", "e1", "e2")) +
      views(view(
        '<node identifier="lab" xsi:type="Label" x="100" y="100" w="200" h="100">' +
          node("n1", "e1") + "</node>" +
        node("n2", "e2") +
        '<connection identifier="plain" xsi:type="Line" source="lab" target="n2"/>' +
        conn("c1", "r1", "n1", "n2"),
      )),
    );
    const v = readExchange(xml).views[0];
    expect(v.nodes.map((n) => n.id)).toEqual(["n1", "n2"]);
    expect(v.nodes[0]).toMatchObject({ x: 110, y: 110, parent: null });
    expect(v.connections.map((c) => c.id)).toEqual(["c1"]);
  });

  it("lets a connection end on another connection (relationship to relationship)", () => {
    const xml = doc(
      elements(el("e1"), el("e2")) +
      relationships(rel("r1", "e1", "e2"), rel("r2", "e1", "r1", "Association")) +
      views(view(node("n1", "e1") + node("n2", "e2") + conn("c1", "r1", "n1", "n2") + conn("c2", "r2", "n1", "c1"))),
    );
    expect(readExchange(xml).views[0].connections.map((c) => c.target)).toEqual(["n2", "c1"]);
  });

  it("ignores unknown containers and attributes", () => {
    const xml = doc('<foo identifierRef="x"><bar/></foo>' + elements(el("e1")) + "<organizations/>");
    expect(readExchange(xml).elements).toHaveLength(1);
    expect(exchangeWarnings(xml)).toEqual(["organizations"]);
  });
});

describe("readExchange: language pick", () => {
  const named = (names: string) => readExchange(doc(`<name xml:lang="de">x</name>${elements(`<element identifier="e1" xsi:type="Node">${names}</element>`)}`));

  it("prefers xml:lang=en over an earlier language", () => {
    const m = named('<name xml:lang="it">ciao</name><name xml:lang="en">hello</name>');
    expect(m.elements[0].name).toBe("hello");
  });

  it.each(["en-US", "EN-gb", "En"])("treats %s as English", (tag) => {
    const m = named(`<name xml:lang="it">ciao</name><name xml:lang="${tag}">hello</name>`);
    expect(m.elements[0].name).toBe("hello");
  });

  it("does not take a language that only starts with en", () => {
    expect(named('<name xml:lang="it">ciao</name><name xml:lang="enx">no</name>').elements[0].name).toBe("ciao");
  });

  it("falls back to the first when there is no en", () => {
    expect(named('<name xml:lang="fr">salut</name><name xml:lang="it">ciao</name>').elements[0].name).toBe("salut");
  });

  it("picks the language for documentation and property values too", () => {
    const m = readExchange(
      doc(
        '<propertyDefinitions><propertyDefinition identifier="pd" type="string"><name xml:lang="it">uno</name><name xml:lang="en">one</name></propertyDefinition></propertyDefinitions>' +
        elements(
          '<element identifier="e1" xsi:type="Node"><documentation xml:lang="it">doc it</documentation><documentation xml:lang="en">doc en</documentation>' +
          '<properties><property propertyDefinitionRef="pd"><value xml:lang="it">v it</value><value xml:lang="en">v en</value></property></properties></element>',
        ),
      ),
    );
    expect(m.elements[0]).toMatchObject({ documentation: "doc en", properties: [{ ref: "pd", value: "v en" }] });
    expect(m.propertyDefinitions[0].name).toBe("one");
  });

  it("keeps the whitespace of a name exactly", () => {
    expect(named('<name xml:lang="en">  a  b\n</name>').elements[0].name).toBe("  a  b\n");
  });
});

describe("requireView", () => {
  it("returns the first view", () => {
    const m = readExchange(fixture("multiview.xml"));
    expect(requireView(m)).toBe(m.views[0]);
  });

  it("throws no_view on a model without views", () => {
    const error = (() => {
      try {
        requireView(readExchange(fixture("minimal.xml")));
      } catch (e) {
        return e as ExchangeParseError;
      }
    })();
    expect(error).toBeInstanceOf(ExchangeParseError);
    expect(error!.code).toBe("no_view");
  });
});

// Keeps this reader and backend/app/services/archimate/validate.py from drifting: what the server's
// fixtures call valid must be readable here. Skipped on a shallow checkout without the backend.
describeSourceScan("server parity", () => {
  const FIXTURES = resolve(__dirname, "../../../../../backend/tests/fixtures/archimate");
  const VALID_MODEL = resolve(FIXTURES, "valid_model.xml");
  const valid = existsSync(FIXTURES) ? readdirSync(FIXTURES).filter((f) => /^valid_.*\.xml$/.test(f)) : [];

  it.skipIf(!existsSync(VALID_MODEL))("reads backend valid_model.xml", () => {
    const m = readExchange(readFileSync(VALID_MODEL, "utf-8"));
    expect(m.elements).toHaveLength(3);
    expect(m.relationships).toHaveLength(2);
    expect(m.views[0].connections).toHaveLength(2);
  });

  it.skipIf(!valid.length)("reads every backend valid_* fixture", () => {
    for (const f of valid) expect(() => readExchange(readFileSync(resolve(FIXTURES, f), "utf-8")), f).not.toThrow();
  });

  it.skipIf(!existsSync(resolve(FIXTURES, "hostile_xxe.xml")))("refuses the backend hostile_xxe.xml the way the server does", () => {
    expect(failure(readFileSync(resolve(FIXTURES, "hostile_xxe.xml"), "utf-8")).code).toBe("dtd_forbidden");
  });
});
