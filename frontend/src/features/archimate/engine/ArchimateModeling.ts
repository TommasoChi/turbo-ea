/** diagram-js modeling plus the 'element.updateProperties' command. */
import type CommandStack from "diagram-js/lib/command/CommandStack";
import type EventBus from "diagram-js/lib/core/EventBus";
import Modeling from "diagram-js/lib/features/modeling/Modeling";
import type { Connection, Element, Shape } from "diagram-js/lib/model/Types";
import type { NodeStyle, Rgb } from "../exchange/exchangeModel";
import type ArchimateElementFactory from "./ArchimateElementFactory";
import UpdatePropertiesHandler, { type ElementUpdate, type RelationshipUpdate } from "./UpdatePropertiesHandler";
import UpdateStyleHandler from "./UpdateStyleHandler";

export default class ArchimateModeling extends Modeling {
  static $inject = ["eventBus", "elementFactory", "commandStack"];

  constructor(eventBus: EventBus, elementFactory: ArchimateElementFactory, private readonly stack: CommandStack) {
    super(eventBus, elementFactory, stack);
  }

  // The d.ts says Map, but Modeling.js returns (and registerHandlers iterates) a plain object.
  getHandlers(): ReturnType<Modeling["getHandlers"]> {
    return {
      ...(super.getHandlers() as unknown as Record<string, unknown>),
      "element.updateProperties": UpdatePropertiesHandler,
      "element.updateStyle": UpdateStyleHandler,
    } as unknown as ReturnType<Modeling["getHandlers"]>;
  }

  /** One undoable command. A card link (`{ cardId }`) only goes on a shape. */
  updateProperties(element: Shape, properties: ElementUpdate): void;
  updateProperties(element: Connection, properties: RelationshipUpdate): void;
  updateProperties(element: Element, properties: ElementUpdate | RelationshipUpdate): void {
    this.stack.execute("element.updateProperties", { element, properties });
  }

  /** One undoable command for every shape at once, even across a multi-selection. */
  setStyle(elements: (Shape & { style?: NodeStyle })[], fillColor: Rgb | null): void {
    this.stack.execute("element.updateStyle", { elements, fillColor });
  }
}
