/** Serialises an ArchimateModel to Open Group ArchiMate Exchange 3.1 XML (plain strings: no DOM needed). */
import {
  EXCHANGE_NS, type ArchimateModel, type ExchangeProperty, type ModelElement, type ModelRelationship,
  type ModelView, type NodeStyle, type PropertyDefinition, type Rgb, type ViewConnection, type ViewNode,
  type ViewNote,
} from "./exchangeModel";

const XSI_NS = "http://www.w3.org/2001/XMLSchema-instance";
const SCHEMA_LOCATION =
  "http://www.opengroup.org/xsd/archimate/3.0/ http://www.opengroup.org/xsd/archimate/3.1/archimate3_Diagram.xsd";

// XML 1.0 forbids these control characters and U+FFFE/U+FFFF, even escaped; a lone surrogate cannot be
// encoded as UTF-8. The second alternative matches a valid pair (kept by the replace callback), the third
// any surrogate left over, i.e. a lone one: no lookbehind (unsupported before Safari 16.4).
const ILLEGAL_XML =
  // eslint-disable-next-line no-control-regex
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]|[\uD800-\uDBFF][\uDC00-\uDFFF]|[\uD800-\uDFFF]/g;
const keepPairs = (m: string) => (m.length === 2 ? m : "");
const ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" };

/** Text content. A literal CR would be normalised to LF by parsers, so it is written as a character reference. */
export function escapeXml(text: string): string {
  return text.replace(ILLEGAL_XML, keepPairs).replace(/[&<>"']/g, (c) => ESCAPES[c]).replace(/\r/g, "&#13;");
}

// Attribute values also lose a literal tab/newline to whitespace normalisation.
const escapeAttr = (v: string) => escapeXml(v).replace(/\n/g, "&#10;").replace(/\t/g, "&#9;");

type Attrs = Record<string, string | number | undefined>;
interface Xml { name: string; attrs: Attrs; children: Xml[]; text?: string }

function el(name: string, attrs: Attrs = {}, children: Xml[] = [], text?: string): Xml {
  return { name, attrs, children, text };
}

/** Indents element lines by depth only, so the content of a text element is never altered. */
function render({ name, attrs, children, text }: Xml, depth = 0): string {
  const pad = "  ".repeat(depth);
  const a = Object.entries(attrs)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => ` ${k}="${escapeAttr(String(v))}"`)
    .join("");
  if (text !== undefined) return `${pad}<${name}${a}>${escapeXml(text)}</${name}>`;
  if (!children.length) return `${pad}<${name}${a}/>`;
  return `${pad}<${name}${a}>\n${children.map((c) => render(c, depth + 1)).join("\n")}\n${pad}</${name}>`;
}

const lang = { "xml:lang": "en" };
const int = (n: number) => Math.round(n);
const name = (text: string) => el("name", lang, [], text);
const doc = (text?: string) => (text ? [el("documentation", lang, [], text)] : []);

function properties(props: ExchangeProperty[]): Xml[] {
  if (!props.length) return [];
  return [
    el("properties", {}, props.map((p) => el("property", { propertyDefinitionRef: p.ref }, [el("value", lang, [], p.value)]))),
  ];
}

const element = (e: ModelElement) =>
  el("element", { identifier: e.id, "xsi:type": e.type }, [name(e.name), ...doc(e.documentation), ...properties(e.properties)]);

function relationship(r: ModelRelationship): Xml {
  const attrs: Attrs = {
    identifier: r.id, source: r.source, target: r.target, "xsi:type": r.type,
    accessType: r.type === "Access" ? r.accessType : undefined,
    isDirected: r.type === "Association" && r.isDirected ? "true" : undefined,
    modifier: r.type === "Influence" ? r.influenceModifier : undefined,
  };
  const label = r.name ? [name(r.name)] : [];
  return el("relationship", attrs, [...label, ...doc(r.documentation), ...properties(r.properties)]);
}

const propertyDefinition = (d: PropertyDefinition) =>
  el("propertyDefinition", { identifier: d.id, type: d.type }, [name(d.name)]);

const channel = (n: number) => Math.min(255, Math.max(0, int(n)));
const rgb = (tag: string, c: Rgb) => el(tag, { r: channel(c.r), g: channel(c.g), b: channel(c.b) });
function style(s?: NodeStyle): Xml[] {
  if (!s || (!s.fillColor && !s.lineColor)) return [];
  return [el("style", {}, [...(s.fillColor ? [rgb("fillColor", s.fillColor)] : []), ...(s.lineColor ? [rgb("lineColor", s.lineColor)] : [])])];
}

/** Effective parent of each node: null for top-level nodes, including ones whose parent is missing,
 *  is itself, or would close a parent cycle (written top-level rather than dropped). */
function effectiveParents(nodes: ViewNode[]): Map<string, string | null> {
  const known = new Set(nodes.map((n) => n.id));
  const parentOf = new Map<string, string | null>();
  for (const n of nodes) parentOf.set(n.id, n.parent !== null && known.has(n.parent) ? n.parent : null);
  const effective = new Map<string, string | null>();
  for (const n of nodes) {
    // Follow the chain as already resolved; reaching n again means n would close a cycle.
    let cur = parentOf.get(n.id) ?? null;
    let cyclic = false;
    for (let steps = 0; cur !== null && steps <= nodes.length; steps++) {
      if (cur === n.id) { cyclic = true; break; }
      cur = effective.has(cur) ? effective.get(cur)! : (parentOf.get(cur) ?? null);
    }
    effective.set(n.id, cyclic ? null : (parentOf.get(n.id) ?? null));
  }
  return effective;
}

/** A note as a `Label` node (Open Group Exchange Format): no `elementRef`, its text in a `<label>`. */
const labelNode = (n: ViewNote, origin: { x: number; y: number }): Xml =>
  el(
    "node",
    { identifier: n.id, "xsi:type": "Label", x: int(n.x - origin.x), y: int(n.y - origin.y), w: int(n.width), h: int(n.height) },
    [el("label", lang, [], n.text)],
  );

function view(v: ModelView): Xml {
  const parents = effectiveParents(v.nodes);
  const childrenOf = new Map<string | null, ViewNode[]>();
  for (const n of v.nodes) {
    const key = parents.get(n.id) ?? null;
    childrenOf.set(key, [...(childrenOf.get(key) ?? []), n]);
  }
  // A note nests only under a known element node (never under another note); else it is top-level.
  const nodeIds = new Set(v.nodes.map((n) => n.id));
  const notesOf = new Map<string | null, ViewNote[]>();
  for (const note of v.notes) {
    const key = note.parent && nodeIds.has(note.parent) ? note.parent : null;
    notesOf.set(key, [...(notesOf.get(key) ?? []), note]);
  }
  // Child coordinates are relative to the parent's absolute origin.
  const node = (n: ViewNode, origin: { x: number; y: number }): Xml =>
    el(
      "node",
      {
        identifier: n.id, "xsi:type": "Element", elementRef: n.elementRef,
        x: int(n.x - origin.x), y: int(n.y - origin.y), w: int(n.width), h: int(n.height),
      },
      [
        ...style(n.style),
        ...(childrenOf.get(n.id) ?? []).map((c) => node(c, n)),
        ...(notesOf.get(n.id) ?? []).map((note) => labelNode(note, n)),
      ],
    );
  const connection = (c: ViewConnection) =>
    el(
      "connection",
      { identifier: c.id, "xsi:type": "Relationship", relationshipRef: c.relationshipRef, source: c.source, target: c.target },
      c.bendpoints.map((p) => el("bendpoint", { x: int(p.x), y: int(p.y) })),
    );
  return el("view", { identifier: v.id, "xsi:type": "Diagram" }, [
    name(v.name),
    ...doc(v.documentation),
    ...(childrenOf.get(null) ?? []).map((n) => node(n, { x: 0, y: 0 })),
    ...(notesOf.get(null) ?? []).map((note) => labelNode(note, { x: 0, y: 0 })),
    ...v.connections.map(connection),
  ]);
}

export function writeExchange(model: ArchimateModel): string {
  const section = (tag: string, items: Xml[]) => (items.length ? [el(tag, {}, items)] : []);
  const root = el(
    "model",
    { xmlns: EXCHANGE_NS, "xmlns:xsi": XSI_NS, "xsi:schemaLocation": SCHEMA_LOCATION, identifier: model.id },
    [
      name(model.name),
      ...doc(model.documentation),
      ...properties(model.properties ?? []),
      ...section("elements", model.elements.map(element)),
      ...section("relationships", model.relationships.map(relationship)),
      ...section("propertyDefinitions", model.propertyDefinitions.map(propertyDefinition)),
      ...(model.views.length ? [el("views", {}, [el("diagrams", {}, model.views.map(view))])] : []),
    ],
  );
  return `<?xml version="1.0" encoding="UTF-8"?>\n${render(root)}\n`;
}
