import dagre from "@dagrejs/dagre";

export const BO_NODE_WIDTH = 200;
export const BO_NODE_HEIGHT = 100;
type Point = { x: number; y: number };

/** Place missing nodes with Dagre while preserving every saved coordinate. */
export function computeLayout(
  nodes: { id: string }[], edges: { source: string; target: string }[], existingPositions: Record<string, Point>,
): Record<string, Point> {
  const graph = new dagre.graphlib.Graph();
  graph.setGraph({ rankdir: "LR", nodesep: 70, ranksep: 100 });
  graph.setDefaultEdgeLabel(() => ({}));
  for (const node of nodes) graph.setNode(node.id, { width: BO_NODE_WIDTH, height: BO_NODE_HEIGHT });
  for (const edge of edges) {
    if (graph.hasNode(edge.source) && graph.hasNode(edge.target)) graph.setEdge(edge.source, edge.target);
  }
  dagre.layout(graph);
  const result = { ...existingPositions };
  const occupied = nodes.flatMap(({ id }) => result[id] ? [result[id]] : []);
  for (const { id } of nodes) {
    if (result[id]) continue;
    const placed = graph.node(id) as { x: number; y: number };
    const position = { x: placed.x - BO_NODE_WIDTH / 2, y: placed.y - BO_NODE_HEIGHT / 2 };
    while (occupied.some((other) => Math.abs(other.x - position.x) < BO_NODE_WIDTH + 30 && Math.abs(other.y - position.y) < BO_NODE_HEIGHT + 30)) {
      position.y += BO_NODE_HEIGHT + 70;
    }
    result[id] = position;
    occupied.push(position);
  }
  return result;
}
