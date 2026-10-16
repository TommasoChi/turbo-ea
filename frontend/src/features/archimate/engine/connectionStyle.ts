/** How each relationship type is drawn: dash pattern and end markers (our own drawings of the standard's conventions). */
import { ARCHIMATE_TEXT_COLOR } from "@/theme/tokens";
import type { AccessType, RelationshipType } from "../taxonomy/relationships";

export type MarkerId = "diamond-filled" | "diamond-hollow" | "dot" | "arrow-open" | "arrow-filled" | "triangle-hollow";
export interface ConnectionStyle { dashArray: string | null; sourceMarker: MarkerId | null; targetMarker: MarkerId | null }

const DASHED = "6 4";
const DOTTED = "2 3";

export function connectionStyle(
  type: RelationshipType,
  opts: { accessType?: AccessType; isDirected?: boolean } = {},
): ConnectionStyle {
  const s = (dashArray: string | null, sourceMarker: MarkerId | null, targetMarker: MarkerId | null) =>
    ({ dashArray, sourceMarker, targetMarker });
  switch (type) {
    case "Composition": return s(null, "diamond-filled", null);
    case "Aggregation": return s(null, "diamond-hollow", null);
    case "Assignment": return s(null, "dot", "arrow-filled");
    case "Realization": return s(DASHED, null, "triangle-hollow");
    case "Serving": return s(null, null, "arrow-open");
    case "Access": {
      const a = opts.accessType;
      return s(DOTTED, a === "Write" || a === "ReadWrite" ? "arrow-open" : null, a === "Read" || a === "ReadWrite" ? "arrow-open" : null);
    }
    case "Influence": return s(DASHED, null, "arrow-open");
    case "Triggering": return s(null, null, "arrow-filled");
    case "Flow": return s(DASHED, null, "arrow-filled");
    case "Specialization": return s(null, null, "triangle-hollow");
    case "Association": return s(null, null, opts.isDirected ? "arrow-open" : null);
  }
}

/**
 * The `<marker>` markup, in a 10x10 box whose outermost point sits at x = refX: with
 * `orient="auto-start-reverse"` the same marker works at the start and at the end of a line.
 */
export function markerSvg(id: MarkerId, domId: string): string {
  const stroke = `stroke="${ARCHIMATE_TEXT_COLOR}" stroke-width="1.2"`;
  const filled = `fill="${ARCHIMATE_TEXT_COLOR}" ${stroke}`;
  const hollow = `fill="white" ${stroke}`;
  const shapes: Record<MarkerId, [number, string]> = {
    "diamond-filled": [10, `<path d="M0 5L5 0L10 5L5 10Z" ${filled}/>`],
    "diamond-hollow": [10, `<path d="M0 5L5 0L10 5L5 10Z" ${hollow}/>`],
    dot: [5, `<circle cx="5" cy="5" r="3.5" ${filled}/>`],
    "arrow-open": [10, `<path d="M0 0L10 5L0 10" fill="none" ${stroke}/>`],
    "arrow-filled": [10, `<path d="M0 0L10 5L0 10Z" ${filled}/>`],
    "triangle-hollow": [10, `<path d="M0 0L10 5L0 10Z" ${hollow}/>`],
  };
  const [refX, body] = shapes[id];
  return (
    `<marker id="${domId}" viewBox="0 0 10 10" refX="${refX}" refY="5" markerWidth="10" markerHeight="10" ` +
    `markerUnits="userSpaceOnUse" orient="auto-start-reverse" overflow="visible">${body}</marker>`
  );
}

let sample = 0;

/** A 28x16 sample line with its markers, for the context pad. Marker ids are unique per call (ids are document-wide). */
export function relationshipSvg(type: RelationshipType, accessType?: AccessType): string {
  const { dashArray, sourceMarker, targetMarker } = connectionStyle(type, { accessType });
  const n = ++sample;
  const ref = (m: MarkerId | null, attr: string) => (m ? ` ${attr}="url(#archimate-sample-${n}-${m})"` : "");
  const defs = [sourceMarker, targetMarker]
    .filter((m): m is MarkerId => m !== null)
    .filter((m, i, all) => all.indexOf(m) === i)
    .map((m) => markerSvg(m, `archimate-sample-${n}-${m}`))
    .join("");
  const dash = dashArray ? ` stroke-dasharray="${dashArray}"` : "";
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="28" height="16" viewBox="0 0 28 16">` +
    (defs ? `<defs>${defs}</defs>` : "") +
    `<path d="M3 8H25" fill="none" stroke="${ARCHIMATE_TEXT_COLOR}" stroke-width="1.5"${dash}` +
    `${ref(sourceMarker, "marker-start")}${ref(targetMarker, "marker-end")}/></svg>`
  );
}
