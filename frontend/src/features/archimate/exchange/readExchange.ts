/**
 * Parses Open Group ArchiMate Exchange 3.x XML into an ArchimateModel (the exact inverse of writeExchange).
 *
 * The input is hostile by default. The checks mirror the server validator
 * (backend/app/services/archimate/validate.py): size on UTF-8 bytes and DOCTYPE/ENTITY on the raw string
 * BEFORE the DOM parser sees anything, then wrong root, unknown types, unresolved references, connection
 * ends that do not match their relationship (reported as dangling_reference) and identifiers that are
 * missing or not unique across the WHOLE document (identifier is an xs:ID). Nothing but ExchangeParseError
 * ever escapes.
 *
 * NOT mirrored: the server's relationship_not_allowed (the ArchiMate relationship table, and a
 * relationship connected to itself), so a file read here can still be refused by the server on save.
 *
 * Limitations (by design): `<organizations>` folders, labels/containers without an elementRef, plain
 * connections without a relationshipRef, fonts and other styling are ignored, and every property
 * definition is read as a string.
 */
import {
  EXCHANGE_NS, type ArchimateModel, type ExchangeProperty, type ModelElement, type ModelRelationship,
  type ModelView, type NodeStyle, type PropertyDefinition, type Rgb, type ViewConnection, type ViewNode,
} from "./exchangeModel";
import { isElementType } from "../taxonomy/elements";
import { ACCESS_TYPES, isRelationshipType, type AccessType } from "../taxonomy/relationships";

export const EXCHANGE_ERROR_CODES = [
  "dtd_forbidden", "xml_invalid", "wrong_root", "too_large", "no_view", "unknown_element_type",
  "unknown_relationship_type", "dangling_reference", "duplicate_identifier", "missing_identifier",
] as const;
export type ExchangeErrorCode = (typeof EXCHANGE_ERROR_CODES)[number];

/** Same ceiling as the server. */
export const MAX_EXCHANGE_BYTES = 5 * 1024 * 1024;
/** Attacker-controlled values are echoed truncated, like the server does. */
const MAX_ECHO = 80;

export class ExchangeParseError extends Error {
  code: ExchangeErrorCode;
  ref?: string;
  constructor(code: ExchangeErrorCode, message: string, ref?: string) {
    super(message);
    this.name = "ExchangeParseError";
    this.code = code;
    this.ref = ref === undefined ? undefined : ref.slice(0, MAX_ECHO);
  }
}

const XSI_NS = "http://www.w3.org/2001/XMLSchema-instance";
const XML_NS = "http://www.w3.org/XML/1998/namespace";

const kids = (e: Element, local: string): Element[] =>
  Array.from(e.children).filter((c) => c.namespaceURI === EXCHANGE_NS && c.localName === local);
const at = (e: Element, ...names: string[]): Element[] =>
  names.reduce<Element[]>((acc, n) => acc.flatMap((x) => kids(x, n)), [e]);
const xsiType = (e: Element) => e.getAttributeNS(XSI_NS, "type");

/** Text of the xml:lang="en" child, else of the first one; undefined when there is none. */
function localized(parent: Element, tag: string): string | undefined {
  const items = kids(parent, tag);
  if (!items.length) return undefined;
  // "en", "en-US", "EN-gb": any English variant.
  const en = items.find((i) => (i.getAttributeNS(XML_NS, "lang") ?? "").toLowerCase().split("-")[0] === "en");
  return (en ?? items[0]).textContent ?? "";
}

function identifierOf(e: Element, what: string): string {
  const id = e.getAttribute("identifier");
  if (!id) throw new ExchangeParseError("missing_identifier", `${what} without an identifier`, xsiType(e) ?? undefined);
  return id;
}

function intAttr(e: Element, attr: string, owner: string): number {
  const raw = e.getAttribute(attr);
  // Plain decimal integers only: no whitespace, fraction, hex or exponent.
  if (raw === null || !/^-?\d+$/.test(raw)) {
    throw new ExchangeParseError("xml_invalid", `Attribute ${attr} of ${owner} is not an integer`, owner);
  }
  return Number(raw);
}

function parseRoot(xml: string): Element {
  if (typeof xml !== "string") throw new ExchangeParseError("xml_invalid", "The input is not a string");
  // UTF-16 length never exceeds the UTF-8 byte length: the cheap test avoids encoding a huge string.
  if (xml.length > MAX_EXCHANGE_BYTES || new TextEncoder().encode(xml).length > MAX_EXCHANGE_BYTES) {
    throw new ExchangeParseError("too_large", `XML exceeds ${MAX_EXCHANGE_BYTES} bytes`);
  }
  // Raw-string check: the DOM parser must never get to see a DTD or an entity declaration.
  if (/<!\s*(?:DOCTYPE|ENTITY)/i.test(xml)) {
    throw new ExchangeParseError("dtd_forbidden", "DTDs and entities are not allowed");
  }
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  if (doc.getElementsByTagName("parsererror").length > 0) {
    throw new ExchangeParseError("xml_invalid", "Malformed XML");
  }
  const root = doc.documentElement;
  if (!root || root.namespaceURI !== EXCHANGE_NS || root.localName !== "model") {
    throw new ExchangeParseError("wrong_root", "Root element must be the ArchiMate 3.x model");
  }
  return root;
}

/** identifier is xs:ID: unique across every element of the document, whatever its kind. */
function checkUnique(root: Element): void {
  const seen = new Set<string>();
  for (const e of [root, ...Array.from(root.getElementsByTagName("*"))]) {
    const id = e.getAttribute("identifier");
    if (!id) continue;
    if (seen.has(id)) throw new ExchangeParseError("duplicate_identifier", `Duplicate identifier ${id.slice(0, MAX_ECHO)}`, id);
    seen.add(id);
  }
}

function readProperties(e: Element): ExchangeProperty[] {
  return at(e, "properties", "property").flatMap((p) => {
    const ref = p.getAttribute("propertyDefinitionRef");
    return ref ? [{ ref, value: localized(p, "value") ?? "" }] : [];
  });
}

function readElements(root: Element): ModelElement[] {
  return at(root, "elements", "element").map((el) => {
    const id = identifierOf(el, "Element");
    const type = xsiType(el);
    if (!isElementType(type)) throw new ExchangeParseError("unknown_element_type", `Unknown element type ${String(type).slice(0, MAX_ECHO)}`, id);
    const out: ModelElement = { id, type, name: localized(el, "name") ?? "", properties: readProperties(el) };
    const documentation = localized(el, "documentation");
    if (documentation !== undefined) out.documentation = documentation;
    return out;
  });
}

function readRelationships(root: Element, endpoints: Set<string>): ModelRelationship[] {
  return at(root, "relationships", "relationship").map((r) => {
    const id = identifierOf(r, "Relationship");
    const type = xsiType(r);
    if (!isRelationshipType(type)) {
      throw new ExchangeParseError("unknown_relationship_type", `Unknown relationship type ${String(type).slice(0, MAX_ECHO)}`, id);
    }
    const source = r.getAttribute("source") ?? "";
    const target = r.getAttribute("target") ?? "";
    for (const end of [source, target]) {
      if (!endpoints.has(end)) throw new ExchangeParseError("dangling_reference", `Relationship endpoint ${end.slice(0, MAX_ECHO)} not found`, id);
    }
    const out: ModelRelationship = { id, type, source, target, properties: readProperties(r) };
    const name = localized(r, "name");
    if (name !== undefined) out.name = name;
    const documentation = localized(r, "documentation");
    if (documentation !== undefined) out.documentation = documentation;
    const access = r.getAttribute("accessType");
    if (access !== null && !(ACCESS_TYPES as readonly string[]).includes(access)) {
      throw new ExchangeParseError("xml_invalid", `Unknown accessType ${access.slice(0, MAX_ECHO)}`, id);
    }
    if (type === "Access" && access !== null) out.accessType = access as AccessType;
    const directed = r.getAttribute("isDirected");
    if (type === "Association" && (directed === "true" || directed === "1")) out.isDirected = true;
    const modifier = r.getAttribute("modifier");
    if (type === "Influence" && modifier !== null) out.influenceModifier = modifier;
    return out;
  });
}

function readPropertyDefinitions(root: Element): PropertyDefinition[] {
  return at(root, "propertyDefinitions", "propertyDefinition").map((d) => ({
    id: identifierOf(d, "Property definition"),
    name: localized(d, "name") ?? "",
    type: "string" as const,
  }));
}

function readColor(e: Element, owner: string): Rgb {
  const [r, g, b] = ["r", "g", "b"].map((c) => intAttr(e, c, owner));
  if ([r, g, b].some((v) => v < 0 || v > 255)) {
    throw new ExchangeParseError("xml_invalid", `Colour channel of ${owner} is outside 0..255`, owner);
  }
  return { r, g, b };
}

function readStyle(node: Element, owner: string): NodeStyle | undefined {
  const style = kids(node, "style")[0];
  if (!style) return undefined;
  const out: NodeStyle = {};
  const fill = kids(style, "fillColor")[0];
  if (fill) out.fillColor = readColor(fill, owner);
  const line = kids(style, "lineColor")[0];
  if (line) out.lineColor = readColor(line, owner);
  return out.fillColor || out.lineColor ? out : undefined;
}

/** Nested nodes are flattened with ABSOLUTE coordinates (iterative: nesting depth is attacker-controlled). */
function readNodes(view: Element, elementIds: Set<string>): ViewNode[] {
  const nodes: ViewNode[] = [];
  type Frame = { el: Element; ox: number; oy: number; parent: string | null };
  const stack: Frame[] = kids(view, "node").reverse().map((el) => ({ el, ox: 0, oy: 0, parent: null }));
  for (let f = stack.pop(); f; f = stack.pop()) {
    const id = identifierOf(f.el, "Node");
    const x = f.ox + intAttr(f.el, "x", id);
    const y = f.oy + intAttr(f.el, "y", id);
    const width = intAttr(f.el, "w", id);
    const height = intAttr(f.el, "h", id);
    const ref = f.el.getAttribute("elementRef");
    let parent = f.parent;
    // A node without elementRef (label, container) is not an element: skipped, its children are re-parented.
    if (ref !== null) {
      if (!elementIds.has(ref)) throw new ExchangeParseError("dangling_reference", `elementRef ${ref.slice(0, MAX_ECHO)} not found`, id);
      const node: ViewNode = { id, elementRef: ref, x, y, width, height, parent: f.parent };
      const style = readStyle(f.el, id);
      if (style) node.style = style;
      nodes.push(node);
      parent = id;
    }
    stack.push(...kids(f.el, "node").reverse().map((el) => ({ el, ox: x, oy: y, parent })));
  }
  return nodes;
}

function readConnections(
  view: Element, nodes: ViewNode[], relationshipEnds: Map<string, [string, string]>,
): ViewConnection[] {
  // Same as the server: connections are looked up anywhere inside the view.
  const raw = Array.from(view.getElementsByTagNameNS(EXCHANGE_NS, "connection"));
  const withRel = raw.filter((c) => c.getAttribute("relationshipRef") !== null);
  // What each diagram object shows (node -> its element, connection -> its relationship), like the server.
  const shows = new Map(nodes.map((n) => [n.id, n.elementRef]));
  for (const c of withRel) {
    const cid = c.getAttribute("identifier");
    if (cid) shows.set(cid, c.getAttribute("relationshipRef") as string);
  }
  return withRel.map((c) => {
    const id = identifierOf(c, "Connection");
    const relationshipRef = c.getAttribute("relationshipRef") as string;
    const ends = relationshipEnds.get(relationshipRef);
    if (!ends) {
      throw new ExchangeParseError("dangling_reference", `relationshipRef ${relationshipRef.slice(0, MAX_ECHO)} not found`, id);
    }
    const [source, target] = [c.getAttribute("source") ?? "", c.getAttribute("target") ?? ""];
    for (const end of [source, target]) {
      if (!shows.has(end)) {
        throw new ExchangeParseError("dangling_reference", `Connection endpoint ${end.slice(0, MAX_ECHO)} not found`, id);
      }
    }
    if (shows.get(source) !== ends[0] || shows.get(target) !== ends[1]) {
      throw new ExchangeParseError("dangling_reference", `Connection ends do not match relationship ${relationshipRef.slice(0, MAX_ECHO)}`, id);
    }
    const bendpoints = kids(c, "bendpoint").map((b) => ({ x: intAttr(b, "x", id), y: intAttr(b, "y", id) }));
    return { id, relationshipRef, source, target, bendpoints };
  });
}

function readViews(root: Element, elementIds: Set<string>, relationshipEnds: Map<string, [string, string]>): ModelView[] {
  return at(root, "views", "diagrams", "view").map((v) => {
    const id = identifierOf(v, "View");
    const nodes = readNodes(v, elementIds);
    const connections = readConnections(v, nodes, relationshipEnds);
    const out: ModelView = { id, name: localized(v, "name") ?? "", nodes, connections };
    const documentation = localized(v, "documentation");
    if (documentation !== undefined) out.documentation = documentation;
    return out;
  });
}

function read(xml: string): ArchimateModel {
  const root = parseRoot(xml);
  checkUnique(root);
  const id = identifierOf(root, "Model");
  const elements = readElements(root);
  const elementIds = new Set(elements.map((e) => e.id));
  const relationshipIds = new Set(
    at(root, "relationships", "relationship").map((r) => r.getAttribute("identifier")).filter((i): i is string => !!i),
  );
  const relationships = readRelationships(root, new Set([...elementIds, ...relationshipIds]));
  const model: ArchimateModel = {
    id,
    name: localized(root, "name") ?? "",
    propertyDefinitions: readPropertyDefinitions(root),
    elements,
    relationships,
    views: readViews(root, elementIds, new Map(relationships.map((r) => [r.id, [r.source, r.target]]))),
  };
  const documentation = localized(root, "documentation");
  if (documentation !== undefined) model.documentation = documentation;
  return model;
}

/** Anything unexpected (e.g. a parser or stack failure on hostile input) surfaces as xml_invalid. */
function guarded<T>(fn: () => T): T {
  try {
    return fn();
  } catch (e) {
    if (e instanceof ExchangeParseError) throw e;
    throw new ExchangeParseError("xml_invalid", "The XML could not be read");
  }
}

/** Throws ExchangeParseError, and nothing else. */
export function readExchange(xml: string): ArchimateModel {
  return guarded(() => read(xml));
}

/** Content the reader drops on purpose, for the editor to warn about: `["organizations"]` when present. */
export function exchangeWarnings(xml: string): string[] {
  return guarded(() => (kids(parseRoot(xml), "organizations").length ? ["organizations"] : []));
}

/** The view the editor works on (the first one); a model read from a file may have none. */
export function requireView(model: ArchimateModel): ModelView {
  if (!model.views.length) throw new ExchangeParseError("no_view", "The model has no view");
  return model.views[0];
}
