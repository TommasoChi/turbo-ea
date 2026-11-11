import type Diagram from "diagram-js";
import type Canvas from "diagram-js/lib/core/Canvas";
import type ElementRegistry from "diagram-js/lib/core/ElementRegistry";
import type EventBus from "diagram-js/lib/core/EventBus";

export function bindBendpointContextMenu(diagram: Diagram): void {
  const container = diagram.get<Canvas>("canvas").getContainer();
  const registry = diagram.get<ElementRegistry>("elementRegistry");
  const eventBus = diagram.get<EventBus>("eventBus");

  // diagram-js forwards clicks from its handles but omits contextmenu.
  const onContextMenu = (event: MouseEvent) => {
    const id = event.target instanceof Element
      ? event.target.closest(".djs-bendpoints")?.getAttribute("data-element-id")
      : null;
    if (!id) return;
    const element = registry.get(id);
    if (!element?.waypoints) return;
    eventBus.fire("element.contextmenu", { element, originalEvent: event });
  };

  container.addEventListener("contextmenu", onContextMenu);
  eventBus.once("diagram.destroy", () => container.removeEventListener("contextmenu", onContextMenu));
}
