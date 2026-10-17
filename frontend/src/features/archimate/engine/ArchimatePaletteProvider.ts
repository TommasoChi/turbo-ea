/**
 * The palette: the hand and lasso tools, then one entry per element type grouped by layer.
 *
 * Dropping an entry creates a model element only; it never creates a card (the DrawIO editor's
 * rule: card links are explicit, through the context pad). Each entry is also a keyboard button:
 * Enter or Space drops the element at the centre of the visible viewport. Drawing a relationship
 * stays mouse-only.
 */
import type EventBus from "diagram-js/lib/core/EventBus";
import type Canvas from "diagram-js/lib/core/Canvas";
import type Create from "diagram-js/lib/features/create/Create";
import type HandTool from "diagram-js/lib/features/hand-tool/HandTool";
import type LassoTool from "diagram-js/lib/features/lasso-tool/LassoTool";
import type Modeling from "diagram-js/lib/features/modeling/Modeling";
import type Palette from "diagram-js/lib/features/palette/Palette";
import type { PaletteEntries } from "diagram-js/lib/features/palette/PaletteProvider";
import type Selection from "diagram-js/lib/features/selection/Selection";
import type { Root } from "diagram-js/lib/model/Types";
import { ARCHIMATE_LAYER_COLORS } from "@/theme/tokens";
import { elementsOfLayer, isElementType, LAYER_ORDER, layerOf, type ElementType } from "../taxonomy/elements";
import type ArchimateElementFactory from "./ArchimateElementFactory";
import type { EditorBridge } from "./EditorBridge";
import { GLYPH_STROKE, glyphSvg } from "./icons";
import { NOTATION } from "./notation";

const ENTRY_CLASS = "archimate-palette-entry";
const TYPE_ATTR = "data-archimate-type";

/** Fired after a keyboard drop, with `{ shape }` (the label editor starts editing it). */
export const ELEMENT_CREATED_EVENT = "archimate.element.created";

const ICON_SIZE = 18;

const svgOf = (size: number, inner: string, attrs: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 16 16" ${attrs}>${inner}</svg>`;

/** The tools' icons follow the palette's text colour. */
const TOOL_ATTRS = 'fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"';
const HAND_ICON = svgOf(
  ICON_SIZE, '<path d="M8 1V15M1 8H15M8 1L6 3M8 1L10 3M8 15L6 13M8 15L10 13M1 8L3 6M1 8L3 10M15 8L13 6M15 8L13 10"/>', TOOL_ATTRS,
);
const LASSO_ICON = svgOf(ICON_SIZE, '<rect x="2" y="3" width="12" height="10" stroke-dasharray="2 2"/>', TOOL_ATTRS);

/** The Grouping has no glyph of its own (it is a dashed frame): its palette icon is a dashed box. */
const groupingIcon = (fill: string) =>
  svgOf(
    ICON_SIZE, '<rect x="2" y="3" width="12" height="10" stroke-dasharray="2 1.5"/>',
    Object.entries({ ...GLYPH_STROKE, fill }).map(([k, v]) => `${k}="${v}"`).join(" "),
  );

/** The glyph, its closed shapes painted in the colour of the element's layer. */
function entryIcon(type: ElementType): string {
  const glyph = NOTATION[type].glyph;
  const { fill } = ARCHIMATE_LAYER_COLORS[layerOf(type)];
  return glyph ? glyphSvg(glyph, ICON_SIZE, fill) : groupingIcon(fill);
}

export default class ArchimatePaletteProvider {
  static $inject = [
    "palette", "create", "elementFactory", "handTool", "lassoTool", "bridge",
    "eventBus", "canvas", "modeling", "selection",
  ];

  constructor(
    palette: Palette,
    private readonly create: Create,
    private readonly elementFactory: ArchimateElementFactory,
    private readonly handTool: HandTool,
    private readonly lassoTool: LassoTool,
    private readonly bridge: EditorBridge,
    private readonly eventBus: EventBus,
    private readonly canvas: Canvas,
    private readonly modeling: Modeling,
    private readonly selection: Selection,
  ) {
    // The palette builds its container once, on diagram init: listen before registering so that a
    // provider created after init still sees the event of a (re)build.
    eventBus.on("palette.create", ({ container }: { container: HTMLElement }) => {
      container.addEventListener("keydown", this.onKeyDown);
    });
    palette.registerProvider(this);
  }

  getPaletteEntries(): PaletteEntries {
    const { elements, tools } = this.bridge.labels;
    const entries: PaletteEntries = {
      "hand-tool": {
        group: "tools", title: tools.hand, html: `<div class="entry" draggable="true">${HAND_ICON}</div>`,
        action: { click: (event) => this.handTool.activateHand(event as MouseEvent) },
      },
      "lasso-tool": {
        group: "tools", title: tools.lasso, html: `<div class="entry" draggable="true">${LASSO_ICON}</div>`,
        action: { click: (event) => this.lassoTool.activateSelection(event as MouseEvent) },
      },
    };
    for (const layer of LAYER_ORDER) {
      entries[`separator.${layer}`] = { group: layer, separator: true, action: {} };
      for (const type of elementsOfLayer(layer)) {
        const createShape = (event: Event) =>
          this.create.start(event, this.elementFactory.createShape({ elementType: type }));
        entries[`create.${type}`] = {
          group: layer,
          title: elements[type],
          html:
            `<div class="entry ${ENTRY_CLASS}" ${TYPE_ATTR}="${type}" tabindex="0" role="button" draggable="true">` +
            `${entryIcon(type)}</div>`,
          action: { dragstart: createShape, click: createShape },
        };
      }
    }
    return entries;
  }

  /** Delegated on the palette container, so it survives the palette rebuilding its entries. */
  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (event.repeat || (event.key !== "Enter" && event.key !== " ")) return;
    const entry = (event.target as Element | null)?.closest?.(`.${ENTRY_CLASS}`);
    const type = entry?.getAttribute(TYPE_ATTR);
    if (!isElementType(type)) return;
    event.preventDefault(); // Space would scroll the page
    this.dropAtCentre(type);
  };

  /** A keyboard drop: through modeling (one undoable command), then selected and announced. */
  private dropAtCentre(type: ElementType): void {
    const { x, y, width, height } = this.canvas.viewbox();
    const shape = this.modeling.createShape(
      this.elementFactory.createShape({ elementType: type }),
      { x: x + width / 2, y: y + height / 2 },
      this.canvas.getRootElement() as Root,
    );
    this.selection.select(shape);
    this.eventBus.fire(ELEMENT_CREATED_EVENT, { shape });
  }
}
