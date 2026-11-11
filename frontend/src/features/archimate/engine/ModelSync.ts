/**
 * Keeps connections and their relationships in step with the diagram.
 *
 * - A relationship's `source`/`target` always equal the ids of the business objects its connection
 *   joins (also after undo/redo, hence `executed` + `reverted`).
 * - A created or re-laid-out connection is cropped at the shapes' outlines, like bpmn-js's BpmnUpdater.
 * - `ArchimateLayouter` keeps a connection's bendpoints when an end moves (diagram-js's BaseLayouter
 *   would reduce it to a straight centre-to-centre line).
 */
import CommandInterceptor from "diagram-js/lib/command/CommandInterceptor";
import type EventBus from "diagram-js/lib/core/EventBus";
import BaseLayouter, { type LayoutConnectionHints } from "diagram-js/lib/layout/BaseLayouter";
import type CroppingConnectionDocking from "diagram-js/lib/layout/CroppingConnectionDocking";
import { getMid } from "diagram-js/lib/layout/LayoutUtil";
import type { Connection, ShapeLike } from "diagram-js/lib/model/Types";
import type { Point } from "diagram-js/lib/util/Types";
import type CommandHandler from "diagram-js/lib/command/CommandHandler";
import { orthogonalWaypoints, type ConnectorRouting } from "@/lib/connectorRouting";

interface ConnectionContext { connection: Connection; cropped?: boolean }
export type RoutedConnection = Connection & { orthogonal?: boolean };

type ConnectionEnd = NonNullable<LayoutConnectionHints["source"]>;
// Diagram-js can copy the array while retaining its points. Mark the manual bends themselves
// so rerouting can rebuild the endpoint elbows and undo can restore the previous route.
const manualBends = new WeakSet<Point>();
// A clipped docking point can move with its connection. Store covered bends as offsets from it.
const coveredBends = new WeakMap<Point, Point[]>();

function roundedPoint({ x, y }: Point): Point {
  return { x: Math.round(x), y: Math.round(y) };
}

function rememberBend(point: Point): Point {
  manualBends.add(point);
  return point;
}

export function archimateOrthogonalWaypoints(source: ConnectionEnd, target: ConnectionEnd) {
  const bounds = (element: typeof source) => element.waypoints
    ? { ...getMid(element), width: 0, height: 0 }
    : element as ShapeLike;
  // The docking service rounds intersections to integer pixels.
  return orthogonalWaypoints(bounds(source), bounds(target)).map(roundedPoint);
}

function isOrthogonal(points: readonly Point[]): boolean {
  return points.slice(1).every((point, i) => point.x === points[i].x || point.y === points[i].y);
}

export function connectionBends(connection: Connection, manualOnly = false): Point[] {
  const route = connection.waypoints;
  const bends = route.slice(1, -1);
  const coveredAt = (dock: Point) => (coveredBends.get(dock) ?? []).map(({ x, y }) => ({
    x: x + dock.x, y: y + dock.y,
  }));
  return [
    ...coveredAt(route[0]),
    ...(manualOnly ? bends.filter((point) => manualBends.has(point)) : bends),
    ...coveredAt(route[route.length - 1]),
  ];
}

function dockingTowards(element: ConnectionEnd, bend: Point, adjacent?: Point): Point {
  const center = roundedPoint(getMid(element));
  if (element.waypoints) return center;
  const { x, y, width, height } = element as ShapeLike;
  const vertical = x < bend.x && bend.x < x + width;
  const horizontal = y < bend.y && bend.y < y + height;
  // Use the bend's projection inside the shape to preserve an off-center docking.
  if (vertical && (!horizontal || adjacent?.x !== bend.x)) return { x: bend.x, y: center.y };
  if (horizontal) return { x: center.x, y: bend.y };
  return center;
}

function connectManualBends(source: ConnectionEnd, target: ConnectionEnd, bends: readonly Point[]): Point[] {
  const anchors = bends.map((point) => rememberBend(roundedPoint(point)));
  const start = dockingTowards(source, anchors[0], anchors[1]);
  const end = dockingTowards(target, anchors[anchors.length - 1], anchors[anchors.length - 2]);
  const points = [...anchors, end];
  const route = [start];
  for (const [i, point] of points.entries()) {
    const previous = route[route.length - 1];
    const next = points[i + 1];
    if (point.x !== previous.x && point.y !== previous.y) {
      // Join at a right angle to a neighboring leg, preserving the manual bend itself.
      const horizontalFirst = next && (point.x === next.x || point.y === next.y)
        ? point.y === next.y : !i || previous.x === route[route.length - 2]?.x;
      route.push(horizontalFirst ? { x: point.x, y: previous.y } : { x: previous.x, y: point.y });
    }
    route.push(point);
  }
  return route;
}

export function restoreOrthogonalWaypoints(source: ConnectionEnd, target: ConnectionEnd, bends: readonly Point[]): Point[] {
  const automatic = archimateOrthogonalWaypoints(source, target);
  const automaticBends = automatic.slice(1, -1);
  // The Exchange file stores both automatic and manual geometry as bendpoints.
  if (!bends.length || (bends.length === automaticBends.length &&
    bends.every((point, i) => point.x === automaticBends[i].x && point.y === automaticBends[i].y))) {
    return automatic;
  }
  return connectManualBends(source, target, bends);
}

type RoutingContext = {
  connection: RoutedConnection;
  routing: ConnectorRouting;
  waypoints: Point[];
  previous?: { orthogonal: boolean | undefined; waypoints: Connection["waypoints"] };
};

export class UpdateRoutingHandler implements CommandHandler {
  execute(context: RoutingContext) {
    const { connection, routing, waypoints } = context;
    context.previous = { orthogonal: connection.orthogonal, waypoints: connection.waypoints };
    connection.orthogonal = routing === "orthogonal";
    connection.waypoints = waypoints;
    return [connection];
  }

  revert({ connection, previous }: RoutingContext) {
    if (previous) Object.assign(connection, previous);
    return [connection];
  }
}

/** Crops the ends at the shapes' outlines. ponytail: a connection ending on a connection is left uncropped. */
export function cropConnection(docking: CroppingConnectionDocking, connection: Connection): void {
  if (connection.source?.waypoints || connection.target?.waypoints) return;
  const cropped = docking.getCroppedWaypoints(connection, connection.source!, connection.target!);
  if (!(connection as RoutedConnection).orthogonal) {
    connection.waypoints = cropped;
    return;
  }
  const route = connection.waypoints;
  const start = cropped[0];
  const end = cropped[cropped.length - 1];
  const segments = route.slice(1).map((point, i) => [route[i], point] as const);
  const contains = (point: Point) => ([a, b]: readonly [Point, Point]) =>
    (point.x - a.x) * (point.x - b.x) <= 0 && (point.y - a.y) * (point.y - b.y) <= 0;
  const first = segments.findIndex(contains(start));
  const fromEnd = segments.reverse().findIndex(contains(end));
  const last = segments.length - 1 - fromEnd;
  if (first < 0 || fromEnd < 0 || first > last) return;

  // Cropping can land beyond several bends. Keep only the outline-to-outline part on the canvas.
  const rememberCovered = (dock: Point, bends: Point[]) => {
    const offsets = bends.filter((point) => manualBends.has(point))
      .map(({ x, y }) => ({ x: x - dock.x, y: y - dock.y }));
    if (offsets.length) coveredBends.set(dock, offsets);
  };
  rememberCovered(start, route.slice(1, first + 1));
  rememberCovered(end, route.slice(last + 1, -1));
  connection.waypoints = [start, ...route.slice(first + 1, last + 1), end];
}

export default class ModelSync extends CommandInterceptor {
  static $inject = ["eventBus", "connectionDocking"];

  constructor(eventBus: EventBus, connectionDocking: CroppingConnectionDocking) {
    super(eventBus);

    const syncEnds = ({ connection }: ConnectionContext) => {
      if (!connection.source || !connection.target) return; // a reverted create
      connection.businessObject.source = connection.source.businessObject.id;
      connection.businessObject.target = connection.target.businessObject.id;
    };
    this.executed(["connection.create", "connection.reconnect"], syncEnds, true);
    this.reverted(["connection.create", "connection.reconnect"], syncEnds, true);

    this.executed("connection.updateWaypoints", ({ connection }: { connection: RoutedConnection }) => {
      if (!connection.orthogonal) return;
      const bends = connection.waypoints.slice(1, -1);
      if (!isOrthogonal(connection.waypoints)) {
        const { source, target } = connection;
        connection.waypoints = bends.length ? connectManualBends(source!, target!, bends) : archimateOrthogonalWaypoints(source!, target!);
        cropConnection(connectionDocking, connection);
      }
      if (bends.length) {
        const route = connection.waypoints;
        // A bendpoint edit may reuse points from the automatic route stored for undo.
        connection.waypoints = [
          route[0], ...route.slice(1, -1).map((point) => rememberBend({ ...point })), route[route.length - 1],
        ];
      }
    }, true);

    // Cropped once per execution; a redo re-runs the handler, which re-uses the cropped waypoints.
    this.executed(["connection.create", "connection.layout"], (context: ConnectionContext) => {
      if (context.cropped) return;
      cropConnection(connectionDocking, context.connection);
      context.cropped = true;
    }, true);
    this.reverted(["connection.layout"], (context: ConnectionContext) => { delete context.cropped; }, true);
  }
}

export class ArchimateLayouter extends BaseLayouter {
  layoutConnection(connection: RoutedConnection, hints: LayoutConnectionHints = {}): Point[] {
    if (connection.orthogonal) {
      const source = hints.source || connection.source!;
      const target = hints.target || connection.target!;
      const bends = connectionBends(connection, true);
      return bends.length ? connectManualBends(source, target, bends) : archimateOrthogonalWaypoints(source, target);
    }
    // `||`, as BaseLayouter: MoveHelper passes `connectionStart: false` for the end that did not move.
    return [
      hints.connectionStart || getMid(hints.source || connection.source!),
      ...(connection.waypoints ?? []).slice(1, -1),
      hints.connectionEnd || getMid(hints.target || connection.target!),
    ];
  }
}
