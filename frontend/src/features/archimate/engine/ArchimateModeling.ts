/** diagram-js modeling plus the 'element.updateProperties' command. */
import type CommandStack from "diagram-js/lib/command/CommandStack";
import type EventBus from "diagram-js/lib/core/EventBus";
import Modeling from "diagram-js/lib/features/modeling/Modeling";
import type { Element } from "diagram-js/lib/model/Types";
import type ArchimateElementFactory from "./ArchimateElementFactory";
import UpdatePropertiesHandler, { type PropertyUpdate } from "./UpdatePropertiesHandler";

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
    } as unknown as ReturnType<Modeling["getHandlers"]>;
  }

  /** One undoable command. */
  updateProperties(element: Element, properties: PropertyUpdate): void {
    this.stack.execute("element.updateProperties", { element, properties });
  }
}
