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
import type { Root, Shape } from "diagram-js/lib/model/Types";
import { ARCHIMATE_LAYER_COLORS } from "@/theme/tokens";
import { elementsOfLayer, isElementType, LAYER_ORDER, type ElementType } from "../taxonomy/elements";
import type ArchimateElementFactory from "./ArchimateElementFactory";
import type { EditorBridge } from "./EditorBridge";
import { GLYPH_STROKE, glyphSvg } from "./icons";
import { NOTATION } from "./notation";

const ENTRY_CLASS = "archimate-palette-entry";
const LABEL_CLASS = "archimate-palette-label";
const TYPE_ATTR = "data-archimate-type";

const escapeHtml = (text: string) =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

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

const GLYPH_ATTRS = Object.entries(GLYPH_STROKE).map(([k, v]) => `${k}="${v}"`).join(" ");

/** The Grouping has no glyph of its own (it is a dashed frame): its palette icon is a dashed box. */
const GROUPING_ICON = svgOf(ICON_SIZE, '<rect x="2" y="3" width="12" height="10" stroke-dasharray="2 1.5"/>', GLYPH_ATTRS);

/** Not an ArchiMate element (no `NOTATION` entry): a folded-corner sticky note with two text lines. */
const NOTE_ICON = svgOf(
  ICON_SIZE, '<path d="M2 2H11L14 5V14H2Z"/><path d="M11 2V5H14"/><line x1="4" y1="8" x2="10" y2="8"/><line x1="4" y1="11" x2="9" y2="11"/>',
  GLYPH_ATTRS,
);
/** `data-archimate-type` of the Note entry: a sentinel, never a real `ElementType`. */
const NOTE_TYPE = "Note";

function entryIcon(type: ElementType): string {
  const glyph = NOTATION[type].glyph;
  return glyph ? glyphSvg(glyph, ICON_SIZE) : GROUPING_ICON;
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
    const { elements, tools, layers, note } = this.bridge.labels;
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
      entries[`label.${layer}`] = {
        group: layer,
        html: `<div class="${LABEL_CLASS}" aria-hidden="true">${escapeHtml(layers[layer])}</div>`,
        action: {},
      };
      for (const type of elementsOfLayer(layer)) {
        const createShape = (event: Event) =>
          this.create.start(event, this.elementFactory.createShape({ elementType: type }));
        entries[`create.${type}`] = {
          group: layer,
          title: elements[type],
          html:
            `<div class="entry ${ENTRY_CLASS}" ${TYPE_ATTR}="${type}" tabindex="0" role="button" draggable="true" ` +
            `style="--archimate-tile: ${ARCHIMATE_LAYER_COLORS[layer].fill}">` +
            `${entryIcon(type)}</div>`,
          action: { dragstart: createShape, click: createShape },
        };
      }
      if (layer === "other") {
        const createNote = (event: Event) => this.create.start(event, this.elementFactory.createShape({ isNote: true }));
        entries["create.note"] = {
          group: layer,
          title: note,
          html:
            `<div class="entry ${ENTRY_CLASS}" ${TYPE_ATTR}="${NOTE_TYPE}" tabindex="0" role="button" draggable="true" ` +
            `style="--archimate-tile: ${ARCHIMATE_LAYER_COLORS.other.fill}">${NOTE_ICON}</div>`,
          action: { dragstart: createNote, click: createNote },
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
    if (type === NOTE_TYPE) {
      event.preventDefault(); // Space would scroll the page
      this.dropAtCentre(this.elementFactory.createShape({ isNote: true }));
      return;
    }
    if (!isElementType(type)) return;
    event.preventDefault();
    this.dropAtCentre(this.elementFactory.createShape({ elementType: type }));
  };

  /** A keyboard drop: through modeling (one undoable command), then selected and announced. */
  private dropAtCentre(template: Shape): void {
    const { x, y, width, height } = this.canvas.viewbox();
    const shape = this.modeling.createShape(
      template,
      { x: x + width / 2, y: y + height / 2 },
      this.canvas.getRootElement() as Root,
    );
    this.selection.select(shape);
    this.eventBus.fire(ELEMENT_CREATED_EVENT, { shape });
  }
}
