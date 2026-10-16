/** In-memory ArchiMate model: the shape the Exchange writer/reader and the editor share. */
import type { ElementType } from "../taxonomy/elements";
import type { AccessType, RelationshipType } from "../taxonomy/relationships";

export const EXCHANGE_NS = "http://www.opengroup.org/xsd/archimate/3.0/";
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
export interface Point { x: number; y: number }
/** source/target are ViewNode ids. */
export interface ViewConnection {
  id: string; relationshipRef: string; source: string; target: string; bendpoints: Point[];
}
export interface ModelView {
  id: string; name: string; documentation?: string; nodes: ViewNode[]; connections: ViewConnection[];
}
export interface ArchimateModel {
  id: string; name: string; documentation?: string; propertyDefinitions: PropertyDefinition[];
  elements: ModelElement[]; relationships: ModelRelationship[]; views: ModelView[];
}

/** "id-" + uuid: always a valid XML ID (an xs:ID cannot start with a digit). */
export function newIdentifier(random: () => string = () => crypto.randomUUID()): string {
  return `id-${random()}`;
}

export function emptyModel(name: string, random?: () => string): ArchimateModel {
  return {
    id: newIdentifier(random),
    name,
    propertyDefinitions: [],
    elements: [],
    relationships: [],
    views: [{ id: newIdentifier(random), name, nodes: [], connections: [] }],
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
