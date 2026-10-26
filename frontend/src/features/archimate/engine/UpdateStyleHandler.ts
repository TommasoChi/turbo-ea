/**
 * The 'element.updateStyle' command: sets or clears a shape's own `style.fillColor` (not part of
 * the business object -- read directly by `ArchimateRenderer`, see `ArchimateEngine.setStyle`).
 */
import type CommandHandler from "diagram-js/lib/command/CommandHandler";
import type { Shape } from "diagram-js/lib/model/Types";
import type { NodeStyle, Rgb } from "../exchange/exchangeModel";

type StyledShape = Shape & { style?: NodeStyle };

export interface UpdateStyleContext {
  elements: StyledShape[];
  fillColor: Rgb | null;
  oldStyles?: (NodeStyle | undefined)[];
}

export default class UpdateStyleHandler implements CommandHandler {
  execute(context: UpdateStyleContext): Shape[] {
    const { elements, fillColor } = context;
    context.oldStyles = elements.map((e) => e.style);
    for (const e of elements) {
      const next: NodeStyle = { ...e.style, ...(fillColor ? { fillColor } : {}) };
      if (!fillColor) delete next.fillColor;
      e.style = next.fillColor || next.lineColor ? next : undefined;
    }
    return elements;
  }

  revert(context: UpdateStyleContext): Shape[] {
    const { elements, oldStyles = [] } = context;
    elements.forEach((e, i) => {
      e.style = oldStyles[i];
    });
    return elements;
  }
}
