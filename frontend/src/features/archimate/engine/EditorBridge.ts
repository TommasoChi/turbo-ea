/**
 * What the engine needs from the page around it. The engine never calls the API: everything that
 * touches cards goes through this bridge, so dropping a shape creates no card and deleting one never
 * deletes a card (the DrawIO editor's rule).
 */
import type { ArchimateLayer, ElementType } from "../taxonomy/elements";
import type { AccessType, RelationshipType } from "../taxonomy/relationships";

export interface CardTypeOption { key: string; label: string }

export interface EditorLabels {
  /** Display names (English standard names, from elementLabel). */
  elements: Record<ElementType, string>;
  relationships: Record<RelationshipType, string>;
  access: Record<AccessType, string>;
  layers: Record<ArchimateLayer, string>;
  linkCard: string; createCard: string; openCard: string; unlinkCard: string;
  delete: string;
  /** "Draw {{relationship}}" */
  connect: (relationship: string) => string;
  unlinked: string;
  /** Palette tool titles; the palette falls back to English when the bridge has none. */
  tools?: { hand: string; lasso: string };
}

export interface EditorBridge {
  labels: EditorLabels;
  /** Card types whose mapping resolves to this element type (for the link/create entries). */
  cardTypesFor(type: ElementType): CardTypeOption[];
  openLinkPicker(shapeId: string): void;
  openCreateCard(shapeId: string): void;
  openCard(cardId: string): void;
  cardName(cardId: string): string | undefined;
}
