import { useEffect, useRef } from "react";
import { Box, Button, Stack } from "@mui/material";
import { useTranslation } from "react-i18next";
import Diagram from "diagram-js";
import BaseRenderer from "diagram-js/lib/draw/BaseRenderer";
import type EventBus from "diagram-js/lib/core/EventBus";
import type Canvas from "diagram-js/lib/core/Canvas";
import type ElementFactory from "diagram-js/lib/core/ElementFactory";
import type ElementRegistry from "diagram-js/lib/core/ElementRegistry";
import type { Element, Shape, Connection } from "diagram-js/lib/model/Types";
import { append, attr, create } from "tiny-svg";
import { ARCHIMATE_LAYER_COLORS, ARCHIMATE_TEXT_COLOR } from "@/theme/tokens";
import { BO_NODE_HEIGHT, BO_NODE_WIDTH } from "./boRelationshipLayout";
import type { BoNode, BoEdge } from "./BoRelationshipPage";
import "diagram-js/assets/diagram-js.css";

class Renderer extends BaseRenderer {
  static $inject = ["eventBus"];

  constructor(eventBus: EventBus) {
    super(eventBus, 1500);
  }

  canRender(element: Element) {
    return Boolean(element.businessObject?.boRelationship);
  }

  drawShape(visuals: SVGElement, shape: Shape) {
    const node = shape.businessObject.node as BoNode;
    const kind = node.subtype?.toLowerCase();
    const colors = kind === "data" || kind === "document"
      ? ARCHIMATE_LAYER_COLORS.application
      : ARCHIMATE_LAYER_COLORS.other;
    const { width, height } = shape;
    const body = create("path");
    let path = `M 0 0 H ${width} V ${height} H 0 Z`;
    if (kind === "document") {
      const fold = width - 18;
      path = `M 0 0 H ${fold} L ${width} 18 V ${height} H 0 Z M ${fold} 0 V 18 H ${width}`;
    } else if (kind === "data") {
      path = `M 10 0 H ${width - 10} Q ${width} 0 ${width} 10 V ${height - 10} `
        + `Q ${width} ${height} ${width - 10} ${height} H 10 Q 0 ${height} 0 ${height - 10} `
        + "V 10 Q 0 0 10 0 Z";
    }
    attr(body, { d: path, fill: colors.fill, stroke: colors.stroke, "stroke-width": 2 });
    append(visuals, body);

    const text = create("text");
    attr(text, { x: 10, y: 35, fill: ARCHIMATE_TEXT_COLOR, "font-size": 14 });
    text.textContent = node.name;
    append(visuals, text);

    const badges = create("text");
    attr(badges, { x: 10, y: 70, fill: ARCHIMATE_TEXT_COLOR, "font-size": 12 });
    badges.textContent = [node.isPersonalData && "GDPR", node.isPaymentData && "PAY"]
      .filter(Boolean).join("  ");
    append(visuals, badges);
    return body;
  }

  drawConnection(visuals: SVGElement, connection: Connection) {
    const line = create("polyline");
    attr(line, {
      points: connection.waypoints.map(({ x, y }) => `${x},${y}`).join(" "),
      fill: "none",
      stroke: ARCHIMATE_LAYER_COLORS.other.stroke,
      "stroke-width": 2,
    });
    append(visuals, line);

    if (connection.businessObject.cardinality) {
      const start = connection.waypoints[0];
      const end = connection.waypoints[connection.waypoints.length - 1];
      const label = create("text");
      attr(label, {
        x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 - 5,
        fill: ARCHIMATE_TEXT_COLOR, "font-size": 12, "text-anchor": "middle",
      });
      label.textContent = connection.businessObject.cardinality;
      append(visuals, label);
    }
    return line;
  }
}

interface Props {
  nodes: BoNode[];
  edges: BoEdge[];
  positions: Record<string, { x: number; y: number }>;
  onActivate: (id: string) => void;
}

export default function BoRelationshipDiagram({ nodes, edges, positions, onActivate }: Props) {
  const { t } = useTranslation("reports");
  const container = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<Canvas | null>(null);
  const viewRef = useRef<{ x: number; y: number; width: number; height: number } | null>(null);
  const activate = useRef(onActivate);
  activate.current = onActivate;
  useEffect(() => {
    if (!container.current) return;
    const diagram = new Diagram({
      canvas: { container: container.current },
      modules: [{ __init__: ["boRenderer"], boRenderer: ["type", Renderer] }],
    });
    const canvas = diagram.get<Canvas>("canvas");
    canvasRef.current = canvas;
    const factory = diagram.get<ElementFactory>("elementFactory");
    const registry = diagram.get<ElementRegistry>("elementRegistry");
    const root = canvas.getRootElement();
    const shapes = new Map<string, Shape>();
    for (const node of nodes) {
      const position = positions[node.id];
      if (!position) continue;
      const shape = factory.createShape({
        id: node.id,
        ...position,
        width: BO_NODE_WIDTH,
        height: BO_NODE_HEIGHT,
        businessObject: { boRelationship: true, node },
      });
      canvas.addShape(shape, root);
      shapes.set(node.id, shape);
      const gfx = registry.getGraphics(shape) as SVGElement;
      // diagram-js disables hit testing on visuals by default. BO shapes are
      // activatable even without its editing and selection modules.
      const visual = gfx.querySelector<SVGElement>(".djs-visual");
      if (visual) visual.style.pointerEvents = "all";
      gfx.setAttribute("role", "button");
      gfx.setAttribute("tabindex", "0");
      gfx.setAttribute("aria-label", node.name);
      gfx.addEventListener("click", (event) => {
        if ((event as MouseEvent).button === 0) activate.current(node.id);
      });
      gfx.addEventListener("keydown", (event) => {
        const { key } = event as KeyboardEvent;
        if (key === "Enter" || key === " ") {
          event.preventDefault();
          activate.current(node.id);
        }
      });
    }
    for (const edge of edges) {
      const source = shapes.get(edge.source);
      const target = shapes.get(edge.target);
      if (!source || !target) continue;
      const connection = factory.createConnection({
        id: edge.id,
        source,
        target,
        waypoints: [
          { x: source.x + BO_NODE_WIDTH / 2, y: source.y + BO_NODE_HEIGHT / 2 },
          { x: target.x + BO_NODE_WIDTH / 2, y: target.y + BO_NODE_HEIGHT / 2 },
        ],
        businessObject: { boRelationship: true, cardinality: edge.cardinality },
      });
      canvas.addConnection(connection, root);
    }
    if (viewRef.current) canvas.viewbox(viewRef.current);
    return () => {
      const view = canvas.viewbox();
      viewRef.current = { x: view.x, y: view.y, width: view.width, height: view.height };
      canvasRef.current = null;
      diagram.destroy();
    };
  }, [nodes, edges, positions]);
  const pan = (dx: number, dy: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const view = canvas.viewbox();
    canvas.viewbox({
      x: view.x + dx * view.width / 4, y: view.y + dy * view.height / 4,
      width: view.width, height: view.height,
    });
  };
  const zoom = (factor: number) => {
    const canvas = canvasRef.current;
    if (canvas) canvas.zoom(Math.max(0.2, Math.min(3, canvas.zoom() * factor)));
  };
  return (
    <Box role="region" aria-label={t("boRelationship.diagram")}>
      <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
        <Button onClick={() => zoom(1.25)}>{t("boRelationship.zoomIn")}</Button>
        <Button onClick={() => zoom(0.8)}>{t("boRelationship.zoomOut")}</Button>
        <Button onClick={() => pan(-1, 0)}>{t("boRelationship.panLeft")}</Button>
        <Button onClick={() => pan(1, 0)}>{t("boRelationship.panRight")}</Button>
        <Button onClick={() => pan(0, -1)}>{t("boRelationship.panUp")}</Button>
        <Button onClick={() => pan(0, 1)}>{t("boRelationship.panDown")}</Button>
      </Stack>
      <Box
        ref={container}
        sx={{ width: "100%", height: 600, border: 1, borderColor: "divider", overflow: "hidden" }}
      />
    </Box>
  );
}
