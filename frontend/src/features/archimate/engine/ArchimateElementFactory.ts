/**
 * Creates diagram elements whose `businessObject` IS the model object (`ModelElement` for shapes,
 * `ModelRelationship` for connections); the shape id is the view node id.
 *
 * - `{ elementType }` / `{ relationship, accessType? }`: a fresh element/relationship, new identifiers
 *   for both the business object and the shape (size from ELEMENT_INFO). No card is created.
 * - `{ businessObject }` (copy-paste): cloned with new identifiers and its card link cleared.
 * - `{ businessObject, fromModel: true, id }` (import): kept as given, same instance.
 */
import ElementFactory from "diagram-js/lib/core/ElementFactory";
import type { Connection, Element, Label, Root, Shape } from "diagram-js/lib/model/Types";
import {
  isCustomEnterpriseObject,
  isNoteObject,
  newIdentifier,
  withCardId,
  type CustomEnterpriseObject,
  type ModelElement,
  type ModelRelationship,
  type NoteObject,
} from "../exchange/exchangeModel";
import { ELEMENT_INFO } from "../taxonomy/elements";

/** A note's or a custom Enterprise Object's default size: neither has an ELEMENT_INFO entry, since
 *  neither is an ArchiMate element type. */
const GENERIC_OBJECT_SIZE = { width: 140, height: 90 };

export default class ArchimateElementFactory extends ElementFactory {
  create(type: "root", attrs?: Partial<Root>): Root;
  create(type: "label", attrs?: Partial<Label>): Label;
  create(type: "shape", attrs?: Partial<Shape>): Shape;
  create(type: "connection", attrs?: Partial<Connection>): Connection;
  create(type: "root" | "label" | "shape" | "connection", attrs: Partial<Shape> = {}): Element {
    if (type !== "shape" && type !== "connection") return super.create(type as "root", attrs);
    const { elementType, relationship, accessType, name, fromModel, businessObject, id, isNote, enterpriseObjectKey, ...rest } = attrs;

    let bo: ModelElement | ModelRelationship | NoteObject | CustomEnterpriseObject;
    if (businessObject && fromModel) bo = businessObject;
    else if (businessObject && isNoteObject(businessObject)) {
      // Copy-paste of a note: a new identifier, same text; a note never carries a card.
      bo = { id: newIdentifier(), isNote: true, name: businessObject.name };
    } else if (businessObject && isCustomEnterpriseObject(businessObject)) {
      // Copy-paste of a custom object: a new identifier, same key and name; it never carries a
      // card either (and has no `properties` array for `withCardId`'s generic branch to read).
      bo = { id: newIdentifier(), isCustomObject: true, enterpriseObjectKey: businessObject.enterpriseObjectKey, name: businessObject.name };
    } else if (businessObject) {
      bo = { ...withCardId(structuredClone(businessObject), null), id: newIdentifier() };
    } else if (type === "shape" && isNote) {
      bo = { id: newIdentifier(), isNote: true, name: name ?? "" };
    } else if (type === "shape" && enterpriseObjectKey) {
      bo = { id: newIdentifier(), isCustomObject: true, enterpriseObjectKey, name: name ?? "" };
    } else if (type === "shape") {
      bo = { id: newIdentifier(), type: elementType, name: name ?? "", properties: [] };
    } else {
      bo = {
        id: newIdentifier(), type: relationship,
        source: rest.source?.businessObject?.id ?? "", target: rest.target?.businessObject?.id ?? "",
        properties: [], ...(accessType ? { accessType } : {}),
      };
    }

    const out: Partial<Shape> = { ...rest, id: fromModel && id ? id : newIdentifier(), businessObject: bo };
    if (type === "connection") return super.create("connection", out);
    const info =
      isNoteObject(bo) || isCustomEnterpriseObject(bo) ? GENERIC_OBJECT_SIZE : ELEMENT_INFO[(bo as ModelElement).type];
    return super.create("shape", { width: info.width, height: info.height, ...out });
  }
}
