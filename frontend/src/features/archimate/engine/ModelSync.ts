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

export function archimateOrthogonalWaypoints(source: ConnectionEnd, target: ConnectionEnd) {
  const bounds = (element: typeof source) => element.waypoints
    ? { ...getMid(element), width: 0, height: 0 }
    : element as ShapeLike;
  // The docking service rounds intersections to integer pixels.
  return orthogonalWaypoints(bounds(source), bounds(target)).map(({ x, y }) => ({ x: Math.round(x), y: Math.round(y) }));
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
  connection.waypoints = docking.getCroppedWaypoints(connection, connection.source!, connection.target!);
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
      return archimateOrthogonalWaypoints(hints.source || connection.source!, hints.target || connection.target!);
    }
    // `||`, as BaseLayouter: MoveHelper passes `connectionStart: false` for the end that did not move.
    return [
      hints.connectionStart || getMid(hints.source || connection.source!),
      ...(connection.waypoints ?? []).slice(1, -1),
      hints.connectionEnd || getMid(hints.target || connection.target!),
    ];
  }
}
