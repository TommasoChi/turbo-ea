/**
 * How each element type looks: its body shape, whether it has a header band (passive objects) and
 * its glyph. The shapes are our own drawings of the standard's visual conventions.
 *
 * `bodyPath` emits only the commands M H V L Z (curves are polygons), so the same path draws the
 * body and serves connection cropping (`getShapePath`), and `translatePath` can move it.
 */
import type { ElementType } from "../taxonomy/elements";
import type { GlyphId } from "./icons";

export type BodyShape =
  | "rect" | "roundRect" | "pill" | "event" | "box3d" | "ellipse" | "hexagon"
  | "chamfer" | "cloud" | "wave" | "grouping" | "circle" | "plain";
export interface Notation { body: BodyShape; header: boolean /* passive objects: top band */; glyph: GlyphId | null }

const n = (body: BodyShape, glyph: GlyphId | null, header = false): Notation => ({ body, header, glyph });

export const NOTATION: Record<ElementType, Notation> = {
  // strategy
  Resource: n("rect", "resource"),
  Capability: n("roundRect", "capability"),
  ValueStream: n("pill", "value-stream"),
  CourseOfAction: n("roundRect", "course-of-action"),
  // business
  BusinessActor: n("rect", "actor"),
  BusinessRole: n("rect", "role"),
  BusinessCollaboration: n("rect", "collaboration"),
  BusinessInterface: n("rect", "interface"),
  BusinessProcess: n("roundRect", "process"),
  BusinessFunction: n("roundRect", "function"),
  BusinessInteraction: n("roundRect", "interaction"),
  BusinessEvent: n("event", "event"),
  BusinessService: n("pill", "service"),
  BusinessObject: n("rect", "object", true),
  Contract: n("rect", "contract", true),
  Representation: n("wave", "representation"),
  Product: n("rect", "product"),
  // application
  ApplicationComponent: n("rect", "component"),
  ApplicationCollaboration: n("rect", "collaboration"),
  ApplicationInterface: n("rect", "interface"),
  ApplicationFunction: n("roundRect", "function"),
  ApplicationInteraction: n("roundRect", "interaction"),
  ApplicationProcess: n("roundRect", "process"),
  ApplicationEvent: n("event", "event"),
  ApplicationService: n("pill", "service"),
  DataObject: n("rect", "object", true),
  // technology
  Node: n("box3d", "node"),
  Device: n("box3d", "device"),
  SystemSoftware: n("box3d", "system-software"),
  TechnologyCollaboration: n("rect", "collaboration"),
  TechnologyInterface: n("rect", "interface"),
  Path: n("box3d", "path"),
  CommunicationNetwork: n("box3d", "network"),
  TechnologyFunction: n("roundRect", "function"),
  TechnologyProcess: n("roundRect", "process"),
  TechnologyInteraction: n("roundRect", "interaction"),
  TechnologyEvent: n("event", "event"),
  TechnologyService: n("pill", "service"),
  Artifact: n("rect", "artifact", true),
  // physical
  Equipment: n("box3d", "equipment"),
  Facility: n("box3d", "facility"),
  DistributionNetwork: n("box3d", "distribution"),
  Material: n("rect", "material", true),
  // motivation
  Stakeholder: n("chamfer", "stakeholder"),
  Driver: n("chamfer", "driver"),
  Assessment: n("chamfer", "assessment"),
  Goal: n("chamfer", "goal"),
  Outcome: n("chamfer", "outcome"),
  Principle: n("chamfer", "principle"),
  Requirement: n("chamfer", "requirement"),
  Constraint: n("chamfer", "constraint"),
  Meaning: n("cloud", "meaning"),
  Value: n("ellipse", "value"),
  // implementation & migration
  WorkPackage: n("roundRect", "work-package"),
  Deliverable: n("wave", "deliverable"),
  ImplementationEvent: n("event", "event"),
  Plateau: n("rect", "plateau"),
  Gap: n("ellipse", "gap"),
  // other
  Grouping: n("grouping", null),
  Location: n("rect", "location"),
  AndJunction: n("circle", "junction"),
  OrJunction: n("circle", "junction-or"),
};

const r2 = (v: number) => Number(v.toFixed(2));

/** A closed polygon, every coordinate clamped to the box so a rounding error never leaves it. */
function polygon(points: [number, number][], w: number, h: number): string {
  const c = ([x, y]: [number, number]) => `${r2(Math.min(Math.max(x, 0), w))} ${r2(Math.min(Math.max(y, 0), h))}`;
  return `M${points.map(c).join("L")}Z`;
}

/** Points of an ellipse arc, from angle `from` to `to` (degrees, 0 = right, 90 = down), `steps` segments. */
function arc(cx: number, cy: number, rx: number, ry: number, from: number, to: number, steps: number): [number, number][] {
  return Array.from({ length: steps + 1 }, (_, i) => {
    const a = ((from + ((to - from) * i) / steps) * Math.PI) / 180;
    return [cx + rx * Math.cos(a), cy + ry * Math.sin(a)];
  });
}

function roundedRect(w: number, h: number, r: number): [number, number][] {
  const k = Math.min(r, w / 2, h / 2);
  return [
    ...arc(w - k, k, k, k, -90, 0, 6), ...arc(w - k, h - k, k, k, 0, 90, 6),
    ...arc(k, h - k, k, k, 90, 180, 6), ...arc(k, k, k, k, 180, 270, 6),
  ];
}

const BOX_DEPTH = 10;

/** SVG path `d` of a body shape in a width x height box with its origin at (0,0). Never empty. */
export function bodyPath(body: BodyShape, w: number, h: number): string {
  switch (body) {
    case "rect":
    case "plain":
      return `M0 0H${w}V${h}H0Z`;
    case "roundRect":
      return polygon(roundedRect(w, h, 10), w, h);
    case "pill":
      return polygon(roundedRect(w, h, h / 2), w, h);
    case "event": {
      // a rounded right end and a notch in the left side
      const k = Math.min(h / 2, w / 2);
      return polygon([[0, 0], ...arc(w - k, k, k, k, -90, 90, 12), [0, h], [Math.min(h / 3, w / 3), h / 2]], w, h);
    }
    case "box3d": {
      const d = Math.min(BOX_DEPTH, w / 4, h / 4);
      return polygon([[0, d], [d, 0], [w, 0], [w, h - d], [w - d, h], [0, h]], w, h);
    }
    case "ellipse":
    case "circle":
      return polygon(arc(w / 2, h / 2, w / 2, h / 2, -90, 270, 48), w, h);
    case "chamfer": {
      // a rectangle with its four corners cut off (the motivation elements)
      const s = Math.min(10, w / 4, h / 4);
      return polygon([[s, 0], [w - s, 0], [w, s], [w, h - s], [w - s, h], [s, h], [0, h - s], [0, s]], w, h);
    }
    case "cloud": {
      // an ellipse with a scalloped edge: ten lobes
      return polygon(
        Array.from({ length: 120 }, (_, i): [number, number] => {
          const a = (i / 120) * 2 * Math.PI;
          const k = 0.86 + 0.14 * Math.abs(Math.sin(5 * a));
          return [w / 2 + (w / 2) * k * Math.cos(a), h / 2 + (h / 2) * k * Math.sin(a)];
        }),
        w, h,
      );
    }
    case "wave": {
      // a rectangle whose bottom edge is a wave (representation, deliverable)
      const a = Math.min(6, h / 6);
      const bottom = Array.from({ length: 25 }, (_, i): [number, number] => {
        const x = w - (w * i) / 24;
        return [x, h - a + a * Math.sin((2 * Math.PI * x) / w)];
      });
      return polygon([[0, 0], [w, 0], ...bottom], w, h);
    }
    case "hexagon": {
      const s = Math.min(12, w / 4);
      return polygon([[s, 0], [w - s, 0], [w, h / 2], [w - s, h], [s, h], [0, h / 2]], w, h);
    }
    case "grouping": {
      const tw = Math.min(60, w / 2);
      const th = Math.min(18, h / 3);
      return polygon([[0, 0], [tw, 0], [tw, th], [w, th], [w, h], [0, h]], w, h);
    }
  }
}

/** The inner lines that make a body look solid (the box front); null for the others. Open path, not filled. */
export function bodyDetail(body: BodyShape, w: number, h: number): string | null {
  if (body === "box3d") {
    const d = Math.min(BOX_DEPTH, w / 4, h / 4);
    return `M0 ${d}H${w - d}V${h}M${w - d} ${d}L${w} 0`;
  }
  return null;
}

const NOTE_FOLD = 16;

/** A sticky note: a rectangle with its top-right corner folded down. Not part of `NOTATION` (not an ArchiMate type). */
export function noteBodyPath(w: number, h: number): string {
  const k = Math.min(NOTE_FOLD, w / 3, h / 3);
  return polygon([[0, 0], [w - k, 0], [w, k], [w, h], [0, h]], w, h);
}

/** The folded corner's crease, open lines only (matches `bodyDetail`'s box3d convention). */
export function noteBodyDetail(w: number, h: number): string {
  const k = Math.min(NOTE_FOLD, w / 3, h / 3);
  return `M${r2(w - k)} 0L${r2(w - k)} ${r2(k)}L${w} ${r2(k)}`;
}

/**
 * Moves a path made of M, H, V, L and Z (the commands `bodyPath` emits) by (dx, dy). Any other
 * command (relative ones, curves, arcs) throws, rather than being moved wrongly.
 */
export function translatePath(d: string, dx: number, dy: number): string {
  return d.replace(/([A-Za-z])([^A-Za-z]*)/g, (_, cmd: string, args: string) => {
    const v = args.trim().split(/[\s,]+/).filter(Boolean).map(Number);
    switch (cmd) {
      case "M":
      case "L":
        return cmd + v.map((x, i) => r2(x + (i % 2 ? dy : dx))).join(" ");
      case "H": return `H${v.map((x) => r2(x + dx)).join(" ")}`;
      case "V": return `V${v.map((y) => r2(y + dy)).join(" ")}`;
      case "Z": return "Z";
      default: throw new Error(`translatePath: unsupported command ${cmd}`);
    }
  });
}
