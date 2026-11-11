import { orthogonalWaypoints } from "./connectorRouting";

it.each([
  [{ x: 300, y: 110, width: 90, height: 70 }],
  [{ x: 35, y: 240, width: 90, height: 70 }],
  [{ x: 35, y: 20, width: 90, height: 70 }],
])("routes each segment at a right angle, including overlapping node ranges", (target) => {
  const points = orthogonalWaypoints({ x: 0, y: 0, width: 100, height: 80 }, target);
  expect(points[0]).toEqual({ x: 50, y: 40 });
  expect(points.at(-1)).toEqual({ x: target.x + 45, y: target.y + 35 });
  expect(points.length).toBeGreaterThan(2);
  expect(points.slice(1).every((point, i) => point.x === points[i].x || point.y === points[i].y)).toBe(true);
});
