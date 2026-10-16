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
import type { Connection } from "diagram-js/lib/model/Types";
import type { Point } from "diagram-js/lib/util/Types";

interface ConnectionContext { connection: Connection; cropped?: boolean }

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
  layoutConnection(connection: Connection, hints: LayoutConnectionHints = {}): Point[] {
    // `||`, as BaseLayouter: MoveHelper passes `connectionStart: false` for the end that did not move.
    return [
      hints.connectionStart || getMid(hints.source || connection.source!),
      ...(connection.waypoints ?? []).slice(1, -1),
      hints.connectionEnd || getMid(hints.target || connection.target!),
    ];
  }
}
