/**
 * The 'element.updateProperties' command: changes fields of a shape's or connection's business
 * object (the model object itself). `{ cardId }` is stored as the card property via `withCardId`.
 */
import type CommandHandler from "diagram-js/lib/command/CommandHandler";
import type { Element } from "diagram-js/lib/model/Types";
import { withCardId, type ModelElement, type ModelRelationship } from "../exchange/exchangeModel";

/** For a shape: element fields, or the card link (elements only carry cards). */
export type ElementUpdate = Partial<Pick<ModelElement, "name" | "documentation" | "properties">> | { cardId: string | null };
/** For a connection. */
export type RelationshipUpdate = Partial<
  Pick<ModelRelationship, "name" | "documentation" | "properties" | "accessType" | "isDirected">
>;
export type PropertyUpdate = ElementUpdate | RelationshipUpdate;

export interface UpdatePropertiesContext {
  element: Element;
  properties: PropertyUpdate;
  oldProperties?: Record<string, unknown>;
}

/** Sets each field; `undefined` removes it, so an undo leaves no `key: undefined` behind. */
function assignFields(target: Record<string, unknown>, fields: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) delete target[key];
    else target[key] = value;
  }
}

export default class UpdatePropertiesHandler implements CommandHandler {
  execute(context: UpdatePropertiesContext): Element[] {
    const { element, properties } = context;
    const bo = element.businessObject as Record<string, unknown> & ModelElement;
    const fields: Record<string, unknown> = { ...properties };
    if ("cardId" in fields) {
      if (element.waypoints) throw new Error("A card can only be linked to an element, not a relationship");
      fields.properties = withCardId(bo, fields.cardId as string | null).properties;
      delete fields.cardId;
    }
    context.oldProperties = Object.fromEntries(Object.keys(fields).map((k) => [k, bo[k]]));
    assignFields(bo, fields);
    return [element];
  }

  revert(context: UpdatePropertiesContext): Element[] {
    assignFields(context.element.businessObject, context.oldProperties ?? {});
    return [context.element];
  }
}
