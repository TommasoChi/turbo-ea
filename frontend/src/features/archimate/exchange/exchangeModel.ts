/** In-memory ArchiMate model: the shape the Exchange writer/reader and the editor share. */
import type { ElementType } from "../taxonomy/elements";
import type { AccessType, RelationshipType } from "../taxonomy/relationships";

export const EXCHANGE_NS = "http://www.opengroup.org/xsd/archimate/3.0/";
/** `diagrams.data.format` of an ArchiMate diagram (backend ARCHIMATE_FORMAT). */
export const ARCHIMATE_FORMAT = "archimate-exchange-3.1";
export const CARD_ID_DEFINITION = "propid-turboea-cardId";
export const CARD_ID_PROPERTY_NAME = "turboea:cardId";

export interface ExchangeProperty { ref: string; value: string }
export interface PropertyDefinition { id: string; name: string; type: "string" }
export interface ModelElement {
  id: string; type: ElementType; name: string; documentation?: string; properties: ExchangeProperty[];
}
export interface ModelRelationship {
  id: string; type: RelationshipType; source: string; target: string; name?: string;
  documentation?: string; accessType?: AccessType; isDirected?: boolean; influenceModifier?: string;
  properties: ExchangeProperty[];
}
export interface Rgb { r: number; g: number; b: number }
export interface NodeStyle { fillColor?: Rgb; lineColor?: Rgb }
/** x, y are ABSOLUTE (the writer converts to parent-relative). */
export interface ViewNode {
  id: string; elementRef: string; x: number; y: number; width: number; height: number;
  parent: string | null; style?: NodeStyle;
}
/**
 * A free-text annotation: not part of the ArchiMate model (no card, no relationships, no element
 * type), written as a `Label` view node (Open Group Exchange Format, no `elementRef`). `parent` is
 * another node's id (an element it visually sits inside), never another note's.
 */
export interface ViewNote {
  id: string; text: string; x: number; y: number; width: number; height: number; parent: string | null;
}
export interface Point { x: number; y: number }
/** source/target are ViewNode ids. */
export interface ViewConnection {
  id: string; relationshipRef: string; source: string; target: string; bendpoints: Point[];
}
export interface ModelView {
  id: string; name: string; documentation?: string; nodes: ViewNode[]; connections: ViewConnection[];
  notes: ViewNote[];
}
export interface ArchimateModel {
  id: string; name: string; documentation?: string; propertyDefinitions: PropertyDefinition[];
  /** The model's own properties (the diagram's "parameters" in the properties panel). */
  properties: ExchangeProperty[];
  elements: ModelElement[]; relationships: ModelRelationship[]; views: ModelView[];
}

/** The business object of a Note shape: never a `ModelElement` (no ArchiMate type, no card, no properties). */
export interface NoteObject { id: string; isNote: true; name: string }

export function isNoteObject(bo: unknown): bo is NoteObject {
  return !!bo && typeof bo === "object" && (bo as { isNote?: unknown }).isNote === true;
}

/**
 * The business object of a custom (non-standard) Enterprise Object's shape: never a `ModelElement`
 * (no ArchiMate type, no card, no properties) -- `enterpriseObjectKey` resolves the matching
 * `EnterpriseObject` row (icon, color, name) for the palette and the renderer. Exchange Format
 * import/export of this shape is out of scope for now (deferred follow-up).
 */
export interface CustomEnterpriseObject { id: string; isCustomObject: true; enterpriseObjectKey: string; name: string }

export function isCustomEnterpriseObject(bo: unknown): bo is CustomEnterpriseObject {
  return !!bo && typeof bo === "object" && (bo as { isCustomObject?: unknown }).isCustomObject === true;
}

/** "id-" + uuid: always a valid XML ID (an xs:ID cannot start with a digit). */
export function newIdentifier(random: () => string = randomUuid): string {
  return `id-${random()}`;
}

/** crypto.randomUUID is missing on plain-HTTP non-localhost origins; getRandomValues is not. */
function randomUuid(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40; // version 4
  b[8] = (b[8] & 0x3f) | 0x80; // variant 10xx
  const h = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export function emptyModel(name: string, random?: () => string): ArchimateModel {
  return {
    id: newIdentifier(random),
    name,
    propertyDefinitions: [],
    properties: [],
    elements: [],
    relationships: [],
    views: [{ id: newIdentifier(random), name, nodes: [], connections: [], notes: [] }],
  };
}

export function getCardId(el: { properties: ExchangeProperty[] }): string | null {
  return el.properties.find((p) => p.ref === CARD_ID_DEFINITION)?.value ?? null;
}

export function withCardId<T extends { properties: ExchangeProperty[] }>(el: T, cardId: string | null): T {
  const others = el.properties.filter((p) => p.ref !== CARD_ID_DEFINITION);
  return { ...el, properties: cardId === null ? others : [...others, { ref: CARD_ID_DEFINITION, value: cardId }] };
}

export function linkedCardIds(model: ArchimateModel): string[] {
  const ids = new Set<string>();
  for (const el of model.elements) {
    const id = getCardId(el);
    if (id !== null) ids.add(id);
  }
  return [...ids];
}

/**
 * Add one element of `type`, named after the card, linked to `cardId`, as a
 * visual node in the model's first view -- placed to the right of whatever
 * nodes are already there. Used to materialize a card the user picked while
 * creating a new ArchiMate diagram (blank or from an example starter) as a
 * real node on the canvas, not just a metadata link.
 */
export function addCardNode(
  model: ArchimateModel,
  type: ElementType,
  name: string,
  cardId: string,
  random?: () => string,
): ArchimateModel {
  const element = withCardId(
    { id: newIdentifier(random), type, name, properties: [] },
    cardId,
  );
  const [view, ...rest] = model.views;
  const maxX = view.nodes.reduce((m, n) => Math.max(m, n.x + n.width), 0);
  const node: ViewNode = {
    id: newIdentifier(random), elementRef: element.id,
    x: maxX + 40, y: 40, width: 120, height: 55, parent: null,
  };
  return withCardDefinition({
    ...model,
    elements: [...model.elements, element],
    views: [{ ...view, nodes: [...view.nodes, node] }, ...rest],
  });
}

export function withCardDefinition(model: ArchimateModel): ArchimateModel {
  if (model.propertyDefinitions.some((d) => d.id === CARD_ID_DEFINITION)) return model;
  if (!model.elements.some((e) => getCardId(e) !== null)) return model;
  return {
    ...model,
    propertyDefinitions: [
      ...model.propertyDefinitions,
      { id: CARD_ID_DEFINITION, name: CARD_ID_PROPERTY_NAME, type: "string" },
    ],
  };
}
