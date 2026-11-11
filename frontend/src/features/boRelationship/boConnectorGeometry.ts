import type { Point } from "diagram-js/lib/util/Types";
import { orthogonalWaypoints, type ConnectorRouting } from "@/lib/connectorRouting";

type Bounds = Point & { width: number; height: number };

export interface BoEdgeGeometry {
  bends: Point[];
  // Pinned endpoints are offsets from the top-left of the corresponding object.
  source?: Point | null;
  target?: Point | null;
}

export const MAX_BO_BENDS = 64;

export function validBoEdgeGeometry(value: unknown): value is BoEdgeGeometry | null {
  if (value === null) return true;
  if (!value || typeof value !== "object") return false;
  const { bends, source, target } = value as Partial<BoEdgeGeometry>;
  const validPoint = (p: Point) => p && Number.isFinite(p.x) && Number.isFinite(p.y);
  return Array.isArray(bends) && bends.length <= MAX_BO_BENDS && bends.every(validPoint)
    && (source == null || validPoint(source)) && (target == null || validPoint(target));
}

const center = ({ x, y, width, height }: Bounds): Point => ({ x: x + width / 2, y: y + height / 2 });

function dock(bounds: Bounds, toward: Point, orthogonal: boolean, limit = 1): Point {
  const mid = center(bounds);
  const dx = toward.x - mid.x;
  const dy = toward.y - mid.y;
  if (dx === 0 && dy === 0) return mid;
  if (orthogonal) {
    return Math.abs(dx) / bounds.width >= Math.abs(dy) / bounds.height
      ? { x: mid.x + Math.sign(dx) * bounds.width / 2, y: mid.y }
      : { x: mid.x, y: mid.y + Math.sign(dy) * bounds.height / 2 };
  }
  const scale = Math.min(bounds.width / (2 * Math.abs(dx)), bounds.height / (2 * Math.abs(dy)), limit);
  return { x: mid.x + dx * scale, y: mid.y + dy * scale };
}

export function anchorOffset(shape: Bounds, pointer: Point): Point {
  const x = Math.max(0, Math.min(shape.width, pointer.x - shape.x));
  const y = Math.max(0, Math.min(shape.height, pointer.y - shape.y));
  const nearest = Math.min(x, y, shape.width - x, shape.height - y);
  if (nearest === x) return { x: 0, y };
  if (nearest === y) return { x, y: 0 };
  if (nearest === shape.width - x) return { x: shape.width, y };
  return { x, y: shape.height };
}

export function boEdgeWaypoints(source: Bounds, target: Bounds, routing?: ConnectorRouting | null, geometry?: BoEdgeGeometry | null): Point[] {
  const orthogonal = routing === "orthogonal";
  if (!geometry && !orthogonal) return [dock(source, center(target), false, 0.5), dock(target, center(source), false, 0.5)];

  const bends = geometry?.bends ?? orthogonalWaypoints(source, target).slice(1, -1);
  const endpoint = (bounds: Bounds, pinned: Point | null | undefined, toward: Point) => {
    if (!pinned) return dock(bounds, toward, orthogonal);
    const offset = anchorOffset(bounds, { x: bounds.x + pinned.x, y: bounds.y + pinned.y });
    return { x: bounds.x + offset.x, y: bounds.y + offset.y };
  };
  const start = endpoint(source, geometry?.source, bends[0] ?? center(target));
  const end = endpoint(target, geometry?.target, bends[bends.length - 1] ?? center(source));
  if (!orthogonal) return [start, ...bends, end];

  const points = [start];
  for (const next of [...bends, end]) {
    const previous = points[points.length - 1];
    if (previous.x !== next.x && previous.y !== next.y) {
      const verticalFirst = previous === start
        ? start.y === source.y || start.y === source.y + source.height
        : next === end && (end.x === target.x || end.x === target.x + target.width);
      points.push(verticalFirst ? { x: previous.x, y: next.y } : { x: next.x, y: previous.y });
    }
    if (previous.x !== next.x || previous.y !== next.y) points.push(next);
  }
  return points.length > 1 ? points : [start, end];
}

export function crowFoot(end: Point, toward: Point): string | undefined {
  const dx = end.x - toward.x;
  const dy = end.y - toward.y;
  const length = Math.hypot(dx, dy);
  if (!length) return undefined;
  const spread = 7;
  const x = end.x - 13 * dx / length;
  const y = end.y - 13 * dy / length;
  const offsetX = spread * dy / length;
  const offsetY = spread * dx / length;
  return `M ${end.x + offsetX} ${end.y - offsetY} L ${x} ${y} L ${end.x - offsetX} ${end.y + offsetY}`;
}
