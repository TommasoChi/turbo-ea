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
  newIdentifier,
  withCardId,
  type ModelElement,
  type ModelRelationship,
} from "../exchange/exchangeModel";
import { ELEMENT_INFO } from "../taxonomy/elements";

export default class ArchimateElementFactory extends ElementFactory {
  create(type: "root", attrs?: Partial<Root>): Root;
  create(type: "label", attrs?: Partial<Label>): Label;
  create(type: "shape", attrs?: Partial<Shape>): Shape;
  create(type: "connection", attrs?: Partial<Connection>): Connection;
  create(type: "root" | "label" | "shape" | "connection", attrs: Partial<Shape> = {}): Element {
    if (type !== "shape" && type !== "connection") return super.create(type as "root", attrs);
    const { elementType, relationship, accessType, name, fromModel, businessObject, id, ...rest } = attrs;

    let bo: ModelElement | ModelRelationship;
    if (businessObject && fromModel) bo = businessObject;
    else if (businessObject) bo = { ...withCardId(structuredClone(businessObject), null), id: newIdentifier() };
    else if (type === "shape") bo = { id: newIdentifier(), type: elementType, name: name ?? "", properties: [] };
    else {
      bo = {
        id: newIdentifier(), type: relationship,
        source: rest.source?.businessObject?.id ?? "", target: rest.target?.businessObject?.id ?? "",
        properties: [], ...(accessType ? { accessType } : {}),
      };
    }

    const out: Partial<Shape> = { ...rest, id: fromModel && id ? id : newIdentifier(), businessObject: bo };
    if (type === "connection") return super.create("connection", out);
    const info = ELEMENT_INFO[(bo as ModelElement).type];
    return super.create("shape", { width: info.width, height: info.height, ...out });
  }
}
