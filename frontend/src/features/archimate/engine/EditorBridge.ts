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
  /** Context-pad toggle title of an Association's `isDirected`. */
  directed: string;
  /** Palette tool titles, and the info badge's accessible label ("View details: {{name}}"). */
  tools: { hand: string; lasso: string; objectInfo: (name: string) => string };
  /** The "Other" layer's free-text annotation: its palette title and the panel's heading fallback. */
  note: string;
}

export interface EditorBridge {
  labels: EditorLabels;
  /** Card types whose mapping resolves to this element type (for the link/create entries). */
  cardTypesFor(type: ElementType): CardTypeOption[];
  openLinkPicker(shapeId: string): void;
  openCreateCard(shapeId: string): void;
  openCard(cardId: string): void;
  cardName(cardId: string): string | undefined;
  /** Opens the read-only Enterprise Object description popover for a palette entry (the palette
   *  never offers editing -- spec Anti-goals), anchored at the clicked tile. `key` is the
   *  Enterprise Object's registry key, which is the palette entry's `ElementType`. */
  openObjectInfo(key: string, anchorEl: HTMLElement): void;
}
