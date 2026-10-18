/**
 * Moves one view between the model and the diagram: `importView` draws it (no commands, so no undo
 * entries), `extractEdited` reads back what the diagram now shows, for `reconcileModel`.
 */
import type Canvas from "diagram-js/lib/core/Canvas";
import type ElementRegistry from "diagram-js/lib/core/ElementRegistry";
import type CroppingConnectionDocking from "diagram-js/lib/layout/CroppingConnectionDocking";
import { getMid } from "diagram-js/lib/layout/LayoutUtil";
import type { Connection, Element, Shape } from "diagram-js/lib/model/Types";
import type {
  ArchimateModel,
  ModelElement,
  ModelRelationship,
  ModelView,
  NoteObject,
  ViewConnection,
  ViewNode,
  ViewNote,
} from "../exchange/exchangeModel";
import { isCustomEnterpriseObject, isNoteObject } from "../exchange/exchangeModel";
import type ArchimateElementFactory from "./ArchimateElementFactory";
import { cropConnection } from "./ModelSync";
import type { EditedView } from "./reconcile";

export interface ViewServices {
  canvas: Canvas;
  elementFactory: ArchimateElementFactory;
  elementRegistry: ElementRegistry;
  connectionDocking: CroppingConnectionDocking;
}

export function importView(services: ViewServices, model: ArchimateModel, view: ModelView): void {
  const { canvas, elementFactory, connectionDocking } = services;
  const root = canvas.getRootElement();
  const elements = new Map(model.elements.map((e) => [e.id, e]));
  const relationships = new Map(model.relationships.map((r) => [r.id, r]));
  const nodes = new Map(view.nodes.map((n) => [n.id, n]));
  const drawn = new Map<string, Shape | Connection>();
  const visiting = new Set<string>();

  // Parents first, whatever the order of the list. A node whose element is missing is skipped.
  const addNode = (node: ViewNode): Shape | undefined => {
    if (drawn.has(node.id)) return drawn.get(node.id) as Shape;
    const element = elements.get(node.elementRef);
    if (!element || visiting.has(node.id)) return undefined;
    visiting.add(node.id);
    const parentNode = node.parent ? nodes.get(node.parent) : undefined;
    const parent = (parentNode && addNode(parentNode)) || root;
    const { id, x, y, width, height, style } = node;
    // the style (a custom fill from the file) is read by the renderer
    const shape = elementFactory.createShape({
      id, businessObject: element, x, y, width, height, fromModel: true, ...(style ? { style } : {}),
    });
    canvas.addShape(shape, parent);
    drawn.set(id, shape);
    return shape;
  };
  view.nodes.forEach(addNode);

  // Notes nest only under an already-drawn element node (never under another note): a dangling or
  // note-to-note parent falls back to the canvas root, same as a dangling element-node parent.
  for (const note of view.notes) {
    const parent = (note.parent && drawn.get(note.parent) as Shape | undefined) || root;
    const bo: NoteObject = { id: note.id, isNote: true, name: note.text };
    const shape = elementFactory.createShape({
      id: note.id, businessObject: bo, x: note.x, y: note.y, width: note.width, height: note.height, fromModel: true,
    });
    canvas.addShape(shape, parent);
    drawn.set(note.id, shape);
  }

  // A connection may end on another connection: draw in passes until nothing more resolves.
  let pending = view.connections;
  for (let size = -1; size !== pending.length; ) {
    size = pending.length;
    pending = pending.filter((c) => {
      const rel = relationships.get(c.relationshipRef);
      const [source, target] = [drawn.get(c.source), drawn.get(c.target)];
      if (!rel || !source || !target) return true;
      const connection = elementFactory.createConnection({
        id: c.id, businessObject: rel, source, target,
        waypoints: [getMid(source), ...c.bendpoints.map(({ x, y }) => ({ x, y })), getMid(target)], fromModel: true,
      });
      cropConnection(connectionDocking, connection);
      canvas.addConnection(connection, root);
      drawn.set(c.id, connection);
      return false;
    });
  }
}

/** The drawn view, in the base view's order (new items last); the view's own fields and node styles kept. */
export function extractEdited(services: ViewServices, baseView: ModelView): EditedView {
  const root = services.canvas.getRootElement();
  const drawn = services.elementRegistry.filter((e) => e !== root && !e.labelTarget) as Element[];
  const order = new Map([...baseView.nodes, ...baseView.connections, ...baseView.notes].map((x, i) => [x.id, i]));
  drawn.sort((a, b) => (order.get(a.id) ?? Infinity) - (order.get(b.id) ?? Infinity));
  const styles = new Map(baseView.nodes.map((n) => [n.id, n.style]));

  const nodes: ViewNode[] = [];
  const notes: ViewNote[] = [];
  const connections: ViewConnection[] = [];
  const elements = new Map<string, ModelElement>();
  const relationships = new Map<string, ModelRelationship>();
  for (const e of drawn) {
    if (e.waypoints) {
      const c = e as Connection;
      relationships.set(c.businessObject.id, c.businessObject);
      connections.push({
        id: c.id, relationshipRef: c.businessObject.id, source: c.source!.id, target: c.target!.id,
        bendpoints: c.waypoints.slice(1, -1).map((p) => ({ x: Math.round(p.x), y: Math.round(p.y) })),
      });
    } else {
      const s = e as Shape;
      const parent = s.parent && s.parent !== root ? s.parent.id : null;
      if (isNoteObject(s.businessObject)) {
        notes.push({
          id: s.id, text: s.businessObject.name,
          x: Math.round(s.x), y: Math.round(s.y), width: Math.round(s.width), height: Math.round(s.height), parent,
        });
        continue;
      }
      // A custom (non-standard) Enterprise Object: true round-trip (re-importing it as the SAME
      // custom type) is out of scope for now (deferred follow-up), but it must not be silently
      // discarded -- that was real data loss. It degrades to a plain Note/Label on the next
      // load, same as the spec's Exchange Format anti-goals require, losing only its type
      // (icon/color), same shape as the real Note branch above.
      if (isCustomEnterpriseObject(s.businessObject)) {
        notes.push({
          id: s.id, text: s.businessObject.name,
          x: Math.round(s.x), y: Math.round(s.y), width: Math.round(s.width), height: Math.round(s.height), parent,
        });
        continue;
      }
      elements.set(s.businessObject.id, s.businessObject);
      const node: ViewNode = {
        id: s.id, elementRef: s.businessObject.id,
        x: Math.round(s.x), y: Math.round(s.y), width: Math.round(s.width), height: Math.round(s.height), parent,
      };
      const style = styles.get(s.id);
      if (style) node.style = style;
      nodes.push(node);
    }
  }
  return {
    view: { ...baseView, nodes, connections, notes },
    elements: [...elements.values()],
    relationships: [...relationships.values()],
  };
}
