/** Serialises an ArchimateModel to Open Group ArchiMate Exchange 3.1 XML (plain strings: no DOM needed). */
import {
  EXCHANGE_NS, type ArchimateModel, type ExchangeProperty, type ModelElement, type ModelRelationship,
  type ModelView, type NodeStyle, type PropertyDefinition, type Rgb, type ViewConnection, type ViewNode,
} from "./exchangeModel";

const XSI_NS = "http://www.w3.org/2001/XMLSchema-instance";
const SCHEMA_LOCATION =
  "http://www.opengroup.org/xsd/archimate/3.0/ http://www.opengroup.org/xsd/archimate/3.1/archimate3_Diagram.xsd";

// XML 1.0 forbids these control characters and U+FFFE/U+FFFF, even escaped.
// eslint-disable-next-line no-control-regex
const ILLEGAL_XML =/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g;
const ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" };

export function escapeXml(text: string): string {
  return text.replace(ILLEGAL_XML, "").replace(/[&<>"']/g, (c) => ESCAPES[c]);
}

type Attrs = Record<string, string | number | undefined>;

/** `<name attrs>` with nested children indented by two spaces; `text` makes a leaf with content. */
function el(name: string, attrs: Attrs = {}, children: string[] = [], text?: string): string {
  const a = Object.entries(attrs)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => ` ${k}="${escapeXml(String(v))}"`)
    .join("");
  if (text !== undefined) return `<${name}${a}>${escapeXml(text)}</${name}>`;
  if (!children.length) return `<${name}${a}/>`;
  const body = children.map((c) => c.replace(/^/gm, "  ")).join("\n");
  return `<${name}${a}>\n${body}\n</${name}>`;
}

const lang = { "xml:lang": "en" };
const int = (n: number) => Math.round(n);
const name = (text: string) => el("name", lang, [], text);
const doc = (text?: string) => (text ? [el("documentation", lang, [], text)] : []);

function properties(props: ExchangeProperty[]): string[] {
  if (!props.length) return [];
  return [
    el("properties", {}, props.map((p) => el("property", { propertyDefinitionRef: p.ref }, [el("value", lang, [], p.value)]))),
  ];
}

const element = (e: ModelElement) =>
  el("element", { identifier: e.id, "xsi:type": e.type }, [name(e.name), ...doc(e.documentation), ...properties(e.properties)]);

function relationship(r: ModelRelationship): string {
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

const rgb = (tag: string, c: Rgb) => el(tag, { r: int(c.r), g: int(c.g), b: int(c.b) });
function style(s?: NodeStyle): string[] {
  if (!s || (!s.fillColor && !s.lineColor)) return [];
  return [el("style", {}, [...(s.fillColor ? [rgb("fillColor", s.fillColor)] : []), ...(s.lineColor ? [rgb("lineColor", s.lineColor)] : [])])];
}

function view(v: ModelView): string {
  const byParent = new Map<string | null, ViewNode[]>();
  const known = new Set(v.nodes.map((n) => n.id));
  for (const n of v.nodes) {
    // A dangling parent is written as a top-level node (absolute coordinates).
    const key = n.parent !== null && known.has(n.parent) ? n.parent : null;
    byParent.set(key, [...(byParent.get(key) ?? []), n]);
  }
  const node = (n: ViewNode, origin: { x: number; y: number }): string =>
    el(
      "node",
      {
        identifier: n.id, "xsi:type": "Element", elementRef: n.elementRef,
        x: int(n.x - origin.x), y: int(n.y - origin.y), w: int(n.width), h: int(n.height),
      },
      [...style(n.style), ...(byParent.get(n.id) ?? []).map((c) => node(c, n))],
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
    ...(byParent.get(null) ?? []).map((n) => node(n, { x: 0, y: 0 })),
    ...v.connections.map(connection),
  ]);
}

export function writeExchange(model: ArchimateModel): string {
  const section = (tag: string, items: string[]) => (items.length ? [el(tag, {}, items)] : []);
  const root = el(
    "model",
    { xmlns: EXCHANGE_NS, "xmlns:xsi": XSI_NS, "xsi:schemaLocation": SCHEMA_LOCATION, identifier: model.id },
    [
      name(model.name),
      ...doc(model.documentation),
      ...section("elements", model.elements.map(element)),
      ...section("relationships", model.relationships.map(relationship)),
      ...section("propertyDefinitions", model.propertyDefinitions.map(propertyDefinition)),
      ...(model.views.length ? [el("views", {}, [el("diagrams", {}, model.views.map(view))])] : []),
    ],
  );
  return `<?xml version="1.0" encoding="UTF-8"?>\n${root}\n`;
}
