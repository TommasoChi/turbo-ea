/**
 * The palette: the hand and lasso tools, then one entry per element type grouped by layer.
 *
 * Dropping an entry creates a model element only; it never creates a card (the DrawIO editor's
 * rule: card links are explicit, through the context pad). Each entry is also a keyboard button:
 * Enter or Space drops the element at the centre of the visible viewport. Drawing a relationship
 * stays mouse-only.
 *
 * Each element tile also carries a small info badge in its corner, a second click target nested
 * inside the same tile: it opens the Enterprise Object's read-only description popover (through
 * `EditorBridge.openObjectInfo`) and never starts placing the element -- the tile's own click/
 * drag is untouched by its presence. Pointer/click-only, deliberately: the same description is
 * already reachable through a fully keyboard-accessible route (the Card Mapping admin list), so
 * giving the badge its own Tab stop would double every keyboard user's palette-traversal length
 * for a read-only convenience. The tile itself keeps its one existing Tab stop and Enter/Space.
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
import type { EnterpriseObject } from "@/types";
import { elementsOfLayer, isElementType, LAYER_ORDER, type ArchimateLayer, type ElementType } from "../taxonomy/elements";
import type ArchimateElementFactory from "./ArchimateElementFactory";
import type { EditorBridge } from "./EditorBridge";
import { GLYPH_STROKE, glyphSvg } from "./icons";
import { NOTATION } from "./notation";

const ENTRY_CLASS = "archimate-palette-entry";
const LABEL_CLASS = "archimate-palette-label";
const TYPE_ATTR = "data-archimate-type";
/** The small "i" badge nested in a tile's corner -- its own click target, independent of the
 *  tile's create/drag gesture (see `getPaletteEntries`'s `onClick` below). Pointer/click-only:
 *  `tabindex="-1"` (not simply absent -- a bare `<button>` defaults to tabbable) keeps it out of
 *  sequential Tab navigation. */
const INFO_CLASS = "archimate-palette-info";

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

/** The info badge: a small "i" in a circle, sized down for the corner of a 22px tile. */
const INFO_ICON_SIZE = 9;
const INFO_ICON = svgOf(
  INFO_ICON_SIZE,
  '<circle cx="8" cy="8" r="6.5"/><line x1="8" y1="7" x2="8" y2="11.5"/><circle cx="8" cy="4.5" r="1" fill="currentColor" stroke="none"/>',
  TOOL_ATTRS,
);

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
/**
 * Prefix for a custom Enterprise Object's `data-archimate-type`: `EnterpriseObject.key` is
 * DB-unique, but with no prefix its bare value could collide with the `"Note"` sentinel (or, in
 * principle, a real `ElementType` string) and `onKeyDown` would then have no way to tell the two
 * tiles apart -- it only ever sees the attribute string, never which tile-building code produced
 * it. The prefix makes the three namespaces (standard `ElementType`, the Note sentinel, a custom
 * object's own key) disjoint by construction, not by hoping no admin ever picks a colliding key.
 */
const CUSTOM_TYPE_PREFIX = "custom:";

function entryIcon(type: ElementType): string {
  const glyph = NOTATION[type].glyph;
  return glyph ? glyphSvg(glyph, ICON_SIZE) : GROUPING_ICON;
}

/** A custom (non-standard) Enterprise Object's tile icon: the same Material Symbol ligature
 *  convention `ArchimateContextPadProvider`'s `SYMBOL` helper uses (a styled `<span>`, not SVG --
 *  this file's HTML-string tiles pick up page CSS, unlike the renderer's SVG canvas). */
const customEntryIcon = (icon: string) => `<span class="material-symbols-outlined" style="font-size:${ICON_SIZE}px">${escapeHtml(icon)}</span>`;

export default class ArchimatePaletteProvider {
  static $inject = [
    "palette", "create", "elementFactory", "handTool", "lassoTool", "bridge",
    "eventBus", "canvas", "modeling", "selection", "enterpriseObjects",
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
    private readonly enterpriseObjects: EnterpriseObject[],
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
        // A missing registry row (shouldn't happen once the seed has run) fails open: visible,
        // never hidden, so a gap in the registry never blanks a chunk of the palette.
        if (this.enterpriseObjects.find((o) => o.key === type)?.is_hidden === true) continue;
        const createShape = (event: Event) =>
          this.create.start(event, this.elementFactory.createShape({ elementType: type }));
        // The tile itself keeps its existing click/drag unchanged: it only ever starts placing
        // the element. The small info badge nested in its corner is a second, independent click
        // target (spec: "Clicking an Enterprise Object's name/icon ... opens a Popover"): asking
        // "what is this?" must never also start drawing. diagram-js delegates every click inside
        // the tile to this one handler regardless of which inner element was hit, so the two
        // gestures are told apart here, by the actual click target.
        const onClick = (event: Event) => {
          const infoEl = (event.target as Element | null)?.closest?.(`.${INFO_CLASS}`);
          if (infoEl) {
            const tile = infoEl.closest(`.${ENTRY_CLASS}`);
            if (tile) this.bridge.openObjectInfo(type, tile as HTMLElement);
            return;
          }
          createShape(event);
        };
        entries[`create.${type}`] = {
          group: layer,
          title: elements[type],
          html:
            `<div class="entry ${ENTRY_CLASS}" ${TYPE_ATTR}="${type}" tabindex="0" role="button" draggable="true" ` +
            `style="--archimate-tile: ${ARCHIMATE_LAYER_COLORS[layer].fill}">` +
            `${entryIcon(type)}` +
            `<button type="button" class="${INFO_CLASS}" tabindex="-1" draggable="false" ` +
            `aria-label="${escapeHtml(tools.objectInfo(elements[type]))}">${INFO_ICON}</button>` +
            `</div>`,
          action: { dragstart: createShape, click: onClick },
        };
      }
      // One tile per visible custom (non-standard) Enterprise Object in this layer, in the
      // admin's own sort order. No info badge (Task 11's feature is for the standard catalogue):
      // the icon/color are the object's own, not the layer's fixed tile color.
      for (const eo of this.customObjectsOfLayer(layer)) {
        const createCustomShape = (event: Event) =>
          this.create.start(event, this.elementFactory.createShape({ enterpriseObjectKey: eo.key }));
        entries[`create.${eo.key}`] = {
          group: layer,
          title: eo.name,
          html:
            `<div class="entry ${ENTRY_CLASS}" ${TYPE_ATTR}="${escapeHtml(CUSTOM_TYPE_PREFIX + eo.key)}" tabindex="0" role="button" draggable="true" ` +
            `style="--archimate-tile: ${escapeHtml(eo.color)}">${customEntryIcon(eo.icon)}</div>`,
          action: { dragstart: createCustomShape, click: createCustomShape },
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

  /** Visible custom Enterprise Objects whose own `layer` is this one, in the admin's sort order.
   *  A `null` layer (not yet solved where it would even go) is skipped, not crashed on. */
  private customObjectsOfLayer(layer: ArchimateLayer): EnterpriseObject[] {
    return this.enterpriseObjects
      .filter((o) => !o.is_standard && !o.is_hidden && o.layer === layer)
      .sort((a, b) => a.sort_order - b.sort_order);
  }

  /** Delegated on the palette container, so it survives the palette rebuilding its entries. The
   *  info badge (see `INFO_CLASS` above) takes no part here: it's `tabindex="-1"`, outside
   *  sequential Tab navigation, so it is never the target of a keyboard-driven keydown here. */
  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (event.repeat || (event.key !== "Enter" && event.key !== " ")) return;
    const entry = (event.target as Element | null)?.closest?.(`.${ENTRY_CLASS}`);
    const type = entry?.getAttribute(TYPE_ATTR);
    // The `custom:` prefix makes a custom object's attribute value structurally distinct from the
    // Note sentinel and every real ElementType (see CUSTOM_TYPE_PREFIX's own doc) -- so, unlike a
    // bare key, it can never be confused with the tile below even if an admin's own key happens to
    // be the literal string "Note".
    if (type?.startsWith(CUSTOM_TYPE_PREFIX)) {
      const key = type.slice(CUSTOM_TYPE_PREFIX.length);
      const eo = this.enterpriseObjects.find((o) => o.key === key && !o.is_standard);
      if (!eo) return;
      event.preventDefault();
      this.dropAtCentre(this.elementFactory.createShape({ enterpriseObjectKey: eo.key }));
      return;
    }
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
