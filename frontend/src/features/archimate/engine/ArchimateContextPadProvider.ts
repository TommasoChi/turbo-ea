/**
 * The context pad: draw a relationship from a shape, link/create/open/unlink its card, delete it;
 * for a connection, its access type or direction, and delete.
 *
 * Mirrors the DrawIO editor: nothing here creates or deletes a card. `delete` removes the shape (or
 * connection) from the diagram only, and every card-side action goes through the bridge.
 */
import type ElementRegistry from "diagram-js/lib/core/ElementRegistry";
import type Connect from "diagram-js/lib/features/connect/Connect";
import type ContextPad from "diagram-js/lib/features/context-pad/ContextPad";
import type { ContextPadEntries } from "diagram-js/lib/features/context-pad/ContextPadProvider";
import type { Connection, Element, Shape } from "diagram-js/lib/model/Types";
import { getCardId, type ModelElement, type ModelRelationship } from "../exchange/exchangeModel";
import { ELEMENT_TYPES, type ElementType } from "../taxonomy/elements";
import { ACCESS_TYPES, isRelationshipAllowed, RELATIONSHIP_TYPES, type RelationshipType } from "../taxonomy/relationships";
import { relationshipSvg } from "./connectionStyle";
import type { EditorBridge } from "./EditorBridge";
import type ArchimateModeling from "./ArchimateModeling";
import type { RelationshipTool } from "./RelationshipTool";

const CONNECTORS: readonly ElementType[] = ["AndJunction", "OrJunction"];

/**
 * Whether the matrix allows `rel` from `type` to at least one element type. Junctions don't count as
 * targets: the matrix lets nearly everything reach one, which would make every entry always show.
 */
export function hasTargetFor(type: ElementType, rel: RelationshipType): boolean {
  return ELEMENT_TYPES.some((target) => !CONNECTORS.includes(target) && isRelationshipAllowed(type, target, rel));
}

const ENTRY = (inner: string) => `<div class="entry archimate-cp-entry">${inner}</div>`;
const SYMBOL = (name: string) => ENTRY(`<span class="material-symbols-outlined">${name}</span>`);

export default class ArchimateContextPadProvider {
  static $inject = ["contextPad", "connect", "modeling", "relationshipTool", "bridge", "elementRegistry"];

  constructor(
    contextPad: ContextPad,
    private readonly connect: Connect,
    private readonly modeling: ArchimateModeling,
    private readonly relationshipTool: RelationshipTool,
    private readonly bridge: EditorBridge,
    // Part of the declared injection list; the entries need no registry lookups.
    _elementRegistry: ElementRegistry,
  ) {
    contextPad.registerProvider(this);
  }

  getContextPadEntries(element: Element): ContextPadEntries {
    const bo = (element as { businessObject?: ModelElement | ModelRelationship }).businessObject;
    if (!bo) return {};
    return (element as Connection).waypoints
      ? this.connectionEntries(element as Connection, bo as ModelRelationship)
      : this.shapeEntries(element as Shape, bo as ModelElement);
  }

  private remove(element: Element): void {
    this.modeling.removeElements([element as Shape]);
  }

  private shapeEntries(shape: Shape, bo: ModelElement): ContextPadEntries {
    const { labels } = this.bridge;
    const entries: ContextPadEntries = {};
    for (const rel of RELATIONSHIP_TYPES) {
      if (!hasTargetFor(bo.type, rel)) continue;
      const start = (event: Event, el: unknown) => {
        this.relationshipTool.set(rel, rel === "Access" ? "Access" : undefined);
        this.connect.start(event as MouseEvent, el as Element);
      };
      entries[`connect.${rel}`] = {
        group: "connect",
        title: labels.connect(labels.relationships[rel]),
        // An Access with no access type is drawn with no arrow head: the sample shows the common one.
        html: ENTRY(relationshipSvg(rel, rel === "Access" ? "Write" : undefined)),
        action: { dragstart: start, click: start },
      };
    }
    if (this.bridge.cardTypesFor(bo.type).length > 0) {
      const cardId = getCardId(bo);
      if (cardId === null) {
        entries["link-card"] = {
          group: "card", title: labels.linkCard, html: SYMBOL("add_link"),
          action: { click: () => this.bridge.openLinkPicker(shape.id) },
        };
        entries["create-card"] = {
          group: "card", title: labels.createCard, html: SYMBOL("link"),
          action: { click: () => this.bridge.openCreateCard(shape.id) },
        };
      } else {
        entries["open-card"] = {
          group: "card", title: labels.openCard, html: SYMBOL("open_in_new"),
          action: { click: () => this.bridge.openCard(cardId) },
        };
        entries["unlink-card"] = {
          group: "card", title: labels.unlinkCard, html: SYMBOL("link_off"),
          action: { click: () => this.modeling.updateProperties(shape, { cardId: null }) },
        };
      }
    }
    entries["delete"] = this.deleteEntry(shape);
    return entries;
  }

  private connectionEntries(connection: Connection, rel: ModelRelationship): ContextPadEntries {
    const { labels } = this.bridge;
    const entries: ContextPadEntries = {};
    if (rel.type === "Access") {
      const current = rel.accessType ?? "Access";
      for (const accessType of ACCESS_TYPES) {
        entries[`access.${accessType}`] = {
          group: "access",
          title: labels.access[accessType],
          className: accessType === current ? "active" : undefined,
          html: ENTRY(relationshipSvg("Access", accessType)),
          action: { click: () => this.modeling.updateProperties(connection, { accessType }) },
        };
      }
    }
    if (rel.type === "Association") {
      entries["directed"] = {
        group: "access",
        title: `${labels.relationships.Association} →`,
        className: rel.isDirected ? "active" : undefined,
        html: SYMBOL("arrow_right_alt"),
        action: { click: () => this.modeling.updateProperties(connection, { isDirected: !rel.isDirected }) },
      };
    }
    entries["delete"] = this.deleteEntry(connection);
    return entries;
  }

  private deleteEntry(element: Element): ContextPadEntries[string] {
    return {
      group: "edit", title: this.bridge.labels.delete, html: SYMBOL("delete"),
      action: { click: () => this.remove(element) },
    };
  }
}
