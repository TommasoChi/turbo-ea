/**
 * Draws the ArchiMate notation: element bodies, glyphs, names and the card-link badge, and the
 * relationship lines with their markers. Selection and hover are not drawn here (diagram-js's
 * outline does that). `getShapePath` gives connection cropping the real outline of each body.
 */
import type Canvas from "diagram-js/lib/core/Canvas";
import type EventBus from "diagram-js/lib/core/EventBus";
import BaseRenderer from "diagram-js/lib/draw/BaseRenderer";
import type { Connection, Element, Shape } from "diagram-js/lib/model/Types";
import { append as svgAppend, attr as svgAttr, create as svgCreate, innerSVG, prepend as svgPrepend } from "tiny-svg";
import { ARCHIMATE_LAYER_COLORS, ARCHIMATE_TEXT_COLOR } from "@/theme/tokens";
import { tint } from "@/lib/color";
import type { EnterpriseObject } from "@/types";
import {
  getCardId, isCustomEnterpriseObject, isNoteObject,
  type CustomEnterpriseObject, type ModelElement, type ModelRelationship, type NoteObject, type Rgb,
} from "../exchange/exchangeModel";
import { isElementType, layerOf } from "../taxonomy/elements";
import { isRelationshipType } from "../taxonomy/relationships";
import { connectionStyle, markerSvg, type MarkerId } from "./connectionStyle";
import { GLYPH_STROKE, glyphMarkup } from "./icons";
import { NOTATION, bodyDetail, bodyPath, noteBodyDetail, noteBodyPath, translatePath } from "./notation";

/** A note draws in the "other" layer's colour: it is explicitly not an ArchiMate element. */
const NOTE_COLORS = ARCHIMATE_LAYER_COLORS.other;
/** Google Fonts' family name for the Material Symbols ligature font (verbatim from the `<link>`
 *  in frontend/index.html) -- the same font `MaterialSymbol.tsx` and the context pad's `SYMBOL`
 *  helper render via the `material-symbols-outlined` CSS class, applied here directly as an SVG
 *  text attribute since SVG text doesn't reliably pick up page CSS classes. */
const MATERIAL_SYMBOLS_FONT = "Material Symbols Outlined";

const FONT_SIZE = 12;
const LINE_HEIGHT = 14;
const CHAR_WIDTH = 6; // average advance of the name font, for wrapping
const MAX_LINES = 3;
const HEADER_HEIGHT = 22;
const GROUPING_TAB_HEIGHT = 18;
const DASHED = "6 4";
const LINK_BADGE_RADIUS = 4;

/** Greedy word wrap into at most `maxLines` lines of `maxChars`; a longer word is cut, the overflow ends in "…". */
export function wrapText(text: string, maxChars: number, maxLines = MAX_LINES): string[] {
  maxChars = Math.max(1, maxChars); // a shape narrower than the padding (a junction) still gets one char per line
  const lines: string[] = [];
  let line = "";
  for (let word of text.split(/\s+/).filter(Boolean)) {
    while (word.length > maxChars) {
      if (line) lines.push(line);
      lines.push(word.slice(0, maxChars));
      line = "";
      word = word.slice(maxChars);
    }
    if (!line) line = word;
    else if (line.length + 1 + word.length <= maxChars) line += ` ${word}`;
    else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  if (lines.length <= maxLines) return lines;
  const last = lines[maxLines - 1];
  return [...lines.slice(0, maxLines - 1), last.length >= maxChars ? `${last.slice(0, maxChars - 1)}…` : `${last}…`];
}

const rgb = ({ r, g, b }: Rgb) => `rgb(${r}, ${g}, ${b})`;

/** Where the glyph sits: the top-right corner, pulled in on an ellipse or a cut corner so it stays inside. */
function glyphOrigin(body: string, width: number): { x: number; y: number } {
  if (body === "ellipse") return { x: width - 20 - Math.round(width * 0.22), y: 4 };
  if (body === "chamfer") return { x: width - 22, y: 5 };
  return { x: width - 20, y: 4 };
}

/** The shape of these bodies is their own symbol (a junction is also too small): no glyph on the canvas. */
const SHAPE_IS_THE_SYMBOL = new Set(["circle", "cloud", "wave"]);

export default class ArchimateRenderer extends BaseRenderer {
  static $inject = ["eventBus", "canvas", "enterpriseObjects"];

  constructor(eventBus: EventBus, private readonly canvas: Canvas, private readonly enterpriseObjects: EnterpriseObject[]) {
    super(eventBus, 1200);
  }

  canRender(element: Element): boolean {
    const bo = element.businessObject;
    if (element.waypoints) return isRelationshipType(bo?.type);
    return isElementType(bo?.type) || isNoteObject(bo) || isCustomEnterpriseObject(bo);
  }

  drawShape(visuals: SVGElement, shape: Shape): SVGElement {
    if (isNoteObject(shape.businessObject)) return this.drawNote(visuals, shape, shape.businessObject);
    if (isCustomEnterpriseObject(shape.businessObject)) return this.drawCustomObject(visuals, shape, shape.businessObject);
    const bo = shape.businessObject as ModelElement;
    const { width, height } = shape;
    const { body, header, glyph } = NOTATION[bo.type];
    // A standard element's EnterpriseObject row carries the same layer colour
    // by default (enterprise_object_seed.py's `_LAYER_COLORS`) -- only derive
    // fill/stroke from it when an admin actually changed it away from that
    // default, so an un-customized diagram still renders pixel-identical to
    // the hand-picked layer palette below.
    const defaultColors = ARCHIMATE_LAYER_COLORS[layerOf(bo.type)];
    const eo = this.enterpriseObjects.find((o) => o.key === bo.type);
    const colors =
      eo?.color && eo.color !== defaultColors.stroke
        ? { fill: tint(eo.color), stroke: eo.color }
        : defaultColors;
    const style = (shape as { style?: { fillColor?: Rgb } }).style;
    let fill = style?.fillColor ? rgb(style.fillColor) : colors.fill;
    if (bo.type === "AndJunction") fill = ARCHIMATE_TEXT_COLOR;
    else if (bo.type === "OrJunction") fill = "white";

    const bodyEl = svgCreate("path");
    svgAttr(bodyEl, { class: "archimate-body", d: bodyPath(body, width, height), fill, stroke: colors.stroke, "stroke-width": 1.5 });
    if (bo.type === "Grouping") svgAttr(bodyEl, { "stroke-dasharray": DASHED });
    svgAppend(visuals, bodyEl);

    const detail = bodyDetail(body, width, height);
    if (detail) {
      const el = svgCreate("path");
      svgAttr(el, { class: "archimate-detail", d: detail, fill: "none", stroke: colors.stroke, "stroke-width": 1.5 });
      svgAppend(visuals, el);
    }
    if (header) {
      const band = svgCreate("rect");
      svgAttr(band, {
        class: "archimate-header", x: 0, y: 0, width, height: HEADER_HEIGHT,
        fill: colors.stroke, "fill-opacity": 0.3, stroke: colors.stroke, "stroke-width": 1.5,
      });
      svgAppend(visuals, band);
    }
    // The palette shows the glyph of a junction, a cloud and a wave; the canvas shows their shape.
    if (glyph && !SHAPE_IS_THE_SYMBOL.has(body)) {
      const origin = glyphOrigin(body, width);
      const g = svgCreate("g");
      svgAttr(g, { class: "archimate-glyph", transform: `translate(${origin.x}, ${origin.y})`, ...GLYPH_STROKE });
      innerSVG(g, glyphMarkup(glyph));
      svgAppend(visuals, g);
    }
    if (bo.name) {
      const top = header ? HEADER_HEIGHT : body === "grouping" ? GROUPING_TAB_HEIGHT : 0;
      const lines = wrapText(bo.name, Math.floor((width - 16) / CHAR_WIDTH));
      // Anchored just below the header/tab, never centred across the full height: a composite
      // element (e.g. a BusinessProcess nesting other processes via Composition) can be much
      // taller than one text line, and centring would put the name right where its children are
      // drawn on top of it, hiding it completely.
      const first = top + (body === "grouping" ? 4 : 2) + FONT_SIZE - 1;
      svgAppend(visuals, this.text(lines, width / 2, first));
    }
    if (getCardId(bo) !== null) {
      const badge = svgCreate("circle");
      svgAttr(badge, {
        class: "archimate-linked-badge", cx: width - LINK_BADGE_RADIUS - 2, cy: height - LINK_BADGE_RADIUS - 2,
        r: LINK_BADGE_RADIUS, fill: colors.stroke, stroke: "white", "stroke-width": 1,
      });
      svgAppend(visuals, badge);
    }
    return bodyEl;
  }

  /** A sticky note: a folded-corner rectangle, its text left-aligned (names are centred, notes are not). */
  private drawNote(visuals: SVGElement, shape: Shape, bo: NoteObject): SVGElement {
    const { width, height } = shape;
    const bodyEl = svgCreate("path");
    svgAttr(bodyEl, {
      class: "archimate-body", d: noteBodyPath(width, height),
      fill: NOTE_COLORS.fill, stroke: NOTE_COLORS.stroke, "stroke-width": 1.5,
    });
    svgAppend(visuals, bodyEl);
    const fold = svgCreate("path");
    svgAttr(fold, { class: "archimate-detail", d: noteBodyDetail(width, height), fill: "none", stroke: NOTE_COLORS.stroke, "stroke-width": 1.5 });
    svgAppend(visuals, fold);
    if (bo.name) {
      const lines = wrapText(bo.name, Math.floor((width - 16) / CHAR_WIDTH));
      const text = svgCreate("text");
      svgAttr(text, {
        class: "archimate-name", x: 8, y: 8 + FONT_SIZE - 1, "text-anchor": "start", "font-size": FONT_SIZE,
        "font-family": "Arial, sans-serif", fill: ARCHIMATE_TEXT_COLOR,
      });
      lines.forEach((line, i) => {
        const span = svgCreate("tspan");
        svgAttr(span, { x: 8, y: 8 + FONT_SIZE - 1 + i * LINE_HEIGHT });
        span.textContent = line;
        svgAppend(text, span);
      });
      svgAppend(visuals, text);
    }
    return bodyEl;
  }

  /** A custom (non-standard) Enterprise Object: the same folded-corner body as a note, but coloured
   *  from its own registry row (falling back to the note palette for a key the registry no longer
   *  has -- deleted after the shape was drawn) and tagged with its own icon in the corner. */
  private drawCustomObject(visuals: SVGElement, shape: Shape, bo: CustomEnterpriseObject): SVGElement {
    const { width, height } = shape;
    const eo = this.enterpriseObjects.find((o) => o.key === bo.enterpriseObjectKey);
    const color = eo?.color ?? NOTE_COLORS.stroke;
    const bodyEl = svgCreate("path");
    svgAttr(bodyEl, {
      class: "archimate-body", d: noteBodyPath(width, height),
      fill: tint(color), stroke: color, "stroke-width": 1.5,
    });
    svgAppend(visuals, bodyEl);
    const fold = svgCreate("path");
    svgAttr(fold, { class: "archimate-detail", d: noteBodyDetail(width, height), fill: "none", stroke: color, "stroke-width": 1.5 });
    svgAppend(visuals, fold);
    if (eo?.icon) {
      const icon = svgCreate("text");
      svgAttr(icon, {
        class: "archimate-glyph", x: width - 20, y: 18, "text-anchor": "middle", "font-size": 16,
        "font-family": MATERIAL_SYMBOLS_FONT, fill: ARCHIMATE_TEXT_COLOR,
      });
      icon.textContent = eo.icon;
      svgAppend(visuals, icon);
    }
    if (bo.name) {
      const lines = wrapText(bo.name, Math.floor((width - 16) / CHAR_WIDTH));
      const text = svgCreate("text");
      svgAttr(text, {
        class: "archimate-name", x: 8, y: 8 + FONT_SIZE - 1, "text-anchor": "start", "font-size": FONT_SIZE,
        "font-family": "Arial, sans-serif", fill: ARCHIMATE_TEXT_COLOR,
      });
      lines.forEach((line, i) => {
        const span = svgCreate("tspan");
        svgAttr(span, { x: 8, y: 8 + FONT_SIZE - 1 + i * LINE_HEIGHT });
        span.textContent = line;
        svgAppend(text, span);
      });
      svgAppend(visuals, text);
    }
    return bodyEl;
  }

  drawConnection(visuals: SVGElement, connection: Connection): SVGElement {
    const bo = connection.businessObject as ModelRelationship;
    const { dashArray, sourceMarker, targetMarker } = connectionStyle(bo.type, {
      // the XSD default of a missing accessType is Write; drawing only, the model keeps it absent
      accessType: bo.accessType ?? (bo.type === "Access" ? "Write" : undefined), isDirected: bo.isDirected,
    });
    const line = svgCreate("path");
    svgAttr(line, {
      class: "archimate-line",
      d: connection.waypoints.map((p, i) => `${i ? "L" : "M"}${p.x} ${p.y}`).join(""),
      fill: "none", stroke: ARCHIMATE_TEXT_COLOR, "stroke-width": 1.5, "stroke-linejoin": "round",
    });
    if (dashArray) svgAttr(line, { "stroke-dasharray": dashArray });
    if (sourceMarker) svgAttr(line, { "marker-start": `url(#${this.marker(sourceMarker)})` });
    if (targetMarker) svgAttr(line, { "marker-end": `url(#${this.marker(targetMarker)})` });
    svgAppend(visuals, line);

    if (bo.name) {
      const mid = midpoint(connection.waypoints);
      const text = this.text([bo.name], mid.x, mid.y);
      svgAttr(text, { dy: -4 });
      svgAppend(visuals, text);
    }
    return line;
  }

  getShapePath(shape: Shape): string {
    if (isNoteObject(shape.businessObject) || isCustomEnterpriseObject(shape.businessObject))
      return translatePath(noteBodyPath(shape.width, shape.height), shape.x, shape.y);
    const { body } = NOTATION[(shape.businessObject as ModelElement).type];
    return translatePath(bodyPath(body, shape.width, shape.height), shape.x, shape.y);
  }

  private text(lines: string[], x: number, firstBaseline: number): SVGTextElement {
    const text = svgCreate("text");
    svgAttr(text, {
      class: "archimate-name", x, y: firstBaseline, "text-anchor": "middle", "font-size": FONT_SIZE,
      "font-family": "Arial, sans-serif", fill: ARCHIMATE_TEXT_COLOR,
    });
    lines.forEach((line, i) => {
      const span = svgCreate("tspan");
      svgAttr(span, { x, y: firstBaseline + i * LINE_HEIGHT });
      span.textContent = line;
      svgAppend(text, span);
    });
    return text;
  }

  /** The marker's id; the marker is added to the diagram's `<defs>` the first time it is used. */
  private marker(id: MarkerId): string {
    const domId = `archimate-marker-${id}`;
    const svg = (this.canvas as unknown as { _svg: SVGElement })._svg;
    let defs = svg.querySelector("defs.archimate-defs");
    if (!defs) {
      defs = svgCreate("defs");
      svgAttr(defs as SVGElement, { class: "archimate-defs" });
      svgPrepend(svg, defs as SVGElement);
    }
    if (!defs.querySelector(`[id="${domId}"]`)) {
      const holder = svgCreate("g");
      innerSVG(holder, markerSvg(id, domId));
      svgAppend(defs as SVGElement, holder.firstChild as SVGElement);
    }
    return domId;
  }
}

/** The point halfway along the polyline. */
function midpoint(points: { x: number; y: number }[]): { x: number; y: number } {
  const lengths = points.slice(1).map((p, i) => Math.hypot(p.x - points[i].x, p.y - points[i].y));
  let left = lengths.reduce((a, b) => a + b, 0) / 2;
  for (let i = 0; i < lengths.length; i++) {
    if (left <= lengths[i] || i === lengths.length - 1) {
      const t = lengths[i] ? left / lengths[i] : 0;
      return {
        x: Math.round((points[i].x + (points[i + 1].x - points[i].x) * t) * 100) / 100,
        y: Math.round((points[i].y + (points[i + 1].y - points[i].y) * t) * 100) / 100,
      };
    }
    left -= lengths[i];
  }
  return points[0];
}
