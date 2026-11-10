export type ConnectorRouting = "straight" | "orthogonal";
type Bounds = { x: number; y: number; width: number; height: number };

export function orthogonalWaypoints(source: Bounds, target: Bounds) {
  const start = { x: source.x + source.width / 2, y: source.y + source.height / 2 };
  const end = { x: target.x + target.width / 2, y: target.y + target.height / 2 };
  const left = start.x < end.x ? source : target;
  const right = left === source ? target : source;
  const top = start.y < end.y ? source : target;
  const bottom = top === source ? target : source;
  if (left.x + left.width < right.x) {
    const x = (left.x + left.width + right.x) / 2;
    return [start, { x, y: start.y }, { x, y: end.y }, end];
  }
  if (top.y + top.height < bottom.y) {
    const y = (top.y + top.height + bottom.y) / 2;
    return [start, { x: start.x, y }, { x: end.x, y }, end];
  }
  if (start.x !== end.x) {
    const y = top.y - 16;
    return [start, { x: start.x, y }, { x: end.x, y }, end];
  }
  const x = Math.min(source.x, target.x) - 16;
  return [start, { x, y: start.y }, { x, y: end.y }, end];
}
