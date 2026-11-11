import { useCallback, useEffect, useImperativeHandle, useRef, useState, type Ref, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { Box, IconButton, Stack, Tooltip } from "@mui/material";
import { useTranslation } from "react-i18next";
import Diagram from "diagram-js";
import BaseRenderer from "diagram-js/lib/draw/BaseRenderer";
import type EventBus from "diagram-js/lib/core/EventBus";
import type Canvas from "diagram-js/lib/core/Canvas";
import type ElementFactory from "diagram-js/lib/core/ElementFactory";
import type ElementRegistry from "diagram-js/lib/core/ElementRegistry";
import type GraphicsFactory from "diagram-js/lib/core/GraphicsFactory";
import BendpointsModule from "diagram-js/lib/features/bendpoints";
import ConnectionPreviewModule from "diagram-js/lib/features/connection-preview";
import BaseLayouter from "diagram-js/lib/layout/BaseLayouter";
import CroppingConnectionDocking from "diagram-js/lib/layout/CroppingConnectionDocking";
import DraggingModule from "diagram-js/lib/features/dragging";
import type Dragging from "diagram-js/lib/features/dragging/Dragging";
import InteractionEventsModule from "diagram-js/lib/features/interaction-events";
import { hasModifier, isCmd, isCopy, isKey, isPaste, isRedo, isUndo } from "diagram-js/lib/features/keyboard/KeyboardUtil";
import MoveCanvasModule from "diagram-js/lib/navigation/movecanvas";
import ZoomScrollModule from "diagram-js/lib/navigation/zoomscroll";
import type ZoomScroll from "diagram-js/lib/navigation/zoomscroll/ZoomScroll";
import type { Element, Shape, Connection } from "diagram-js/lib/model/Types";
import type { Point } from "diagram-js/lib/util/Types";
import { append, attr, create } from "tiny-svg";
import MaterialSymbol from "@/components/MaterialSymbol";
import ConnectorRoutingMenu from "@/components/ConnectorRoutingMenu";
import type { ConnectorRouting } from "@/lib/connectorRouting";
import { bindBendpointContextMenu } from "@/lib/diagramBendpointContextMenu";
import { iconSize } from "@/theme/tokens";
import { downloadText } from "@/features/archimate/download";
import { anchorOffset, boEdgeWaypoints, crowFoot, type BoEdgeGeometry } from "./boConnectorGeometry";
import { BO_NODE_HEIGHT, BO_NODE_WIDTH } from "./boRelationshipLayout";
import type { BoNode, BoEdge } from "./BoRelationshipPage";
import "diagram-js/assets/diagram-js.css";

const panKeys: Partial<Record<string, readonly [number, number]>> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
};

export type BoCanvasAction = "undo" | "redo" | "copy" | "paste" | "delete" | "edit" | "selectAll";

function shortcutAction(event: KeyboardEvent): BoCanvasAction | undefined {
  if (isCmd(event)) {
    if (isUndo(event)) return "undo";
    if (isRedo(event)) return "redo";
    if (event.shiftKey) return;
    if (isCopy(event)) return "copy";
    if (isPaste(event)) return "paste";
    if (isKey(["a", "A"], event)) return "selectAll";
  }
  if (hasModifier(event)) return;
  if (isKey(["Delete", "Backspace"], event)) return "delete";
  if (isKey(["F2", "Enter"], event)) return "edit";
}

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
    const { width, height } = shape;
    const body = create("path");
    const fold = width - 16;
    const path = kind === "document"
      ? `M 3 0 H ${fold} L ${width} 16 V ${height - 3} Q ${width} ${height} ${width - 3} ${height} H 3 Q 0 ${height} 0 ${height - 3} V 3 Q 0 0 3 0 Z`
      : `M 8 0 H ${width - 8} Q ${width} 0 ${width} 8 V ${height - 8} Q ${width} ${height} ${width - 8} ${height} H 8 Q 0 ${height} 0 ${height - 8} V 8 Q 0 0 8 0 Z`;
    attr(body, { d: path, class: "bo-node-body", "data-kind": kind === "document" || kind === "data" ? kind : "legacy",
      "data-personal": String(node.isPersonalData), "data-payment": String(node.isPaymentData) });
    append(visuals, body);
    if (kind === "document") {
      const corner = create("path");
      attr(corner, { d: `M ${fold} 0 V 16 H ${width}`, class: "bo-node-fold" });
      append(visuals, corner);
    }
    const icon = create("text");
    attr(icon, { x: 12, y: 27, class: "bo-node-icon material-symbols-outlined", "font-size": 18 });
    icon.textContent = kind === "document" ? "description" : "database";
    append(visuals, icon);

    const text = create("text");
    attr(text, { x: 36, y: 27, class: "bo-node-title", "font-size": 13, "font-weight": 650 });
    text.textContent = node.name.length > 20 ? `${node.name.slice(0, 19)}…` : node.name;
    append(visuals, text);

    const type = create("text");
    attr(type, { x: 36, y: 46, class: "bo-node-meta", "font-size": 11 });
    type.textContent = shape.businessObject.typeLabel;
    append(visuals, type);
    const badges = [node.isPersonalData && "GDPR", node.isPaymentData && "PCI"].filter(Boolean);
    badges.forEach((badge, index) => {
      const x = 36 + index * 56;
      const chip = create("rect");
      attr(chip, { x, y: 57, width: badge === "GDPR" ? 49 : 34, height: 19, rx: 7, class: badge === "GDPR" ? "bo-badge-personal" : "bo-badge-payment" });
      append(visuals, chip);
      const label = create("text");
      attr(label, { x: x + 6, y: 70, class: badge === "GDPR" ? "bo-badge-personal-text" : "bo-badge-payment-text", "font-size": 11, "font-weight": 600 });
      label.textContent = String(badge);
      append(visuals, label);
    });
    return body;
  }

  drawConnection(visuals: SVGElement, connection: Connection) {
    const line = create("polyline");
    attr(line, {
      points: connection.waypoints.map(({ x, y }) => `${x},${y}`).join(" "),
      fill: "none",
      class: "bo-edge-line",
      "stroke-width": 2,
    });
    append(visuals, line);

    const cardinalities = String(connection.businessObject.cardinality ?? "").toLowerCase().split(":");
    const ends = ["source", "target"] as const;
    for (const [index, cardinality] of cardinalities.entries()) {
      if (cardinality !== "n" && cardinality !== "m") continue;
      const points = index === 0 ? connection.waypoints : [...connection.waypoints].reverse();
      const [end] = points;
      const toward = points.find(({ x, y }) => x !== end.x || y !== end.y);
      const path = toward && crowFoot(end, toward);
      if (path) {
        const marker = create("path");
        attr(marker, { d: path, "data-end": ends[index], class: "bo-edge-many", fill: "none", "stroke-width": 2 });
        append(visuals, marker);
      }
    }
    return line;
  }
}

export interface BoCanvasControls {
  zoom: (step: number) => void;
  fit: () => void;
  exportSvg: (name: string) => void;
}

interface Props {
  ref?: Ref<BoCanvasControls>;
  showGrid?: boolean;
  colorBy?: "default" | "subtype" | "personalData" | "paymentData";
  display?: { subtype: boolean; personalData: boolean; paymentData: boolean };
  selectedId?: string | null;
  selectedIds?: ReadonlySet<string>;
  nodes: BoNode[];
  edges: BoEdge[];
  positions: Record<string, { x: number; y: number }>;
  onActivate: (id: string) => void;
  onMove?: (id: string, position: { x: number; y: number }) => void;
  onRequestRemoveEdge?: (id: string) => void;
  onChangeGeometry?: (id: string, geometry: BoEdgeGeometry) => void;
  onChangeRouting?: (id: string, routing: ConnectorRouting) => void;
  onShortcut?: (action: BoCanvasAction, nodeId?: string) => boolean;
}

type Interaction = { element: Element; originalEvent: MouseEvent };
type BoDrag = { context: { shape: Shape; x: number; y: number }; dx: number; dy: number };
type AttachmentOffsets = Pick<BoEdgeGeometry, "source" | "target">;

export default function BoRelationshipDiagram({
  ref,
  showGrid = true,
  colorBy = "default",
  display,
  selectedId,
  selectedIds,
  nodes,
  edges,
  positions,
  onActivate,
  onMove,
  onRequestRemoveEdge,
  onChangeRouting,
  onChangeGeometry,
  onShortcut,
}: Props) {
  const { t } = useTranslation("reports");
  const container = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<Canvas | null>(null);
  const registryRef = useRef<ElementRegistry | null>(null);
  const zoomScrollRef = useRef<ZoomScroll | null>(null);
  const viewRef = useRef<{ x: number; y: number; width: number; height: number } | null>(null);
  const restoreCanvasFocus = useRef(false);
  const actions = useRef({ onActivate, onMove, onChangeGeometry });
  actions.current = { onActivate, onMove, onChangeGeometry };
  const [selectedRelation, setSelectedRelation] = useState<string | null>(null);
  const [routeMenu, setRouteMenu] = useState<{ id: string; left: number; top: number } | null>(null);
  const canMove = onMove !== undefined;
  const canRemove = onRequestRemoveEdge !== undefined;
  const canRoute = onChangeRouting !== undefined;
  const canReshape = onChangeGeometry !== undefined;
  const routeEdge = canRoute && routeMenu ? edges.find(({ id }) => id === routeMenu.id) : undefined;
  const activeRelation = (canRemove || canReshape) && edges.some((edge) => edge.id === selectedRelation)
    ? selectedRelation
    : null;
  const selectNode = useCallback((id: string) => {
    setSelectedRelation(null);
    actions.current.onActivate(id);
  }, []);

  useEffect(() => {
    if (!container.current) return;
    const setGeometry = (connection: Connection, bends: Point[], pinned: AttachmentOffsets) => {
      const geometry: BoEdgeGeometry = {
        ...connection.businessObject.geometry,
        bends: bends.map(({ x, y }) => ({ x, y })),
        ...pinned,
      };
      actions.current.onChangeGeometry?.(connection.id, geometry);
    };
    const diagram = new Diagram({
      canvas: { container: container.current },
      modules: [
        InteractionEventsModule,
        MoveCanvasModule,
        ZoomScrollModule,
        ...(canMove ? [DraggingModule] : []),
        ...(canReshape ? [BendpointsModule, ConnectionPreviewModule, {
          // Use the same interaction as ArchiMate, committing to the shared drawing draft.
          // Redocking can choose an anchor on the same object. Endpoints are inventory relations.
          modeling: ["value", {
            updateWaypoints(connection: Connection, points: Point[], hints?: { segmentMove?: unknown }) {
              const pinned: AttachmentOffsets = {};
              if (hints?.segmentMove) {
                // diagram-js restores the original waypoints before committing the cropped route.
                for (const end of ["source", "target"] as const) {
                  const shape = connection[end] as Shape;
                  const before = anchorOffset(shape, connection.waypoints[end === "source" ? 0 : connection.waypoints.length - 1]);
                  const after = anchorOffset(shape, points[end === "source" ? 0 : points.length - 1]);
                  if (before.x !== after.x || before.y !== after.y) pinned[end] = after;
                }
              }
              setGeometry(connection, points.slice(1, -1), pinned);
            },
            reconnect(connection: Connection, source: Shape, target: Shape, point: Point, hints: { docking: "source" | "target" }) {
              if (source !== connection.source || target !== connection.target) return;
              const end = hints.docking;
              setGeometry(connection, connection.waypoints.slice(1, -1), {
                [end]: anchorOffset(end === "source" ? source : target, point),
              });
            },
          }],
          rules: ["value", {
            allowed(action: string, { connection, source, target }: { connection: Connection; source: Element; target: Element }) {
              return action !== "connection.reconnect" || (source === connection.source && target === connection.target);
            },
          }],
          layouter: ["type", BaseLayouter],
          connectionDocking: ["type", CroppingConnectionDocking],
        }] : []),
        { __init__: ["boRenderer"], boRenderer: ["type", Renderer] },
      ],
    });
    const canvas = diagram.get<Canvas>("canvas");
    canvasRef.current = canvas;
    const factory = diagram.get<ElementFactory>("elementFactory");
    const registry = diagram.get<ElementRegistry>("elementRegistry");
    registryRef.current = registry;
    const zoomScroll = diagram.get<ZoomScroll>("zoomScroll");
    zoomScrollRef.current = zoomScroll;
    // Keep scrolling available after a rebuild under a stationary pointer.
    zoomScroll.toggle(true);
    const eventBus = diagram.get<EventBus>("eventBus");
    const root = canvas.getRootElement();
    const shapes = new Map<string, Shape>();
    // Use the interaction bus so diagram-js can suppress the click after a drag.
    eventBus.on("element.click", ({ element, originalEvent }: Interaction) => {
      if (originalEvent.button !== 0) return;
      if (element.businessObject?.node) selectNode(element.id);
      else setSelectedRelation((canRemove || canReshape) && element.businessObject?.boRelationship ? element.id : null);
    });
    for (const node of nodes) {
      const position = positions[node.id];
      if (!position) continue;
      const shape = factory.createShape({
        id: node.id,
        ...position,
        width: BO_NODE_WIDTH,
        height: BO_NODE_HEIGHT,
        businessObject: { boRelationship: true, node, typeLabel: t(`boRelationship.${["data", "document"].includes(node.subtype?.toLowerCase() ?? "") ? node.subtype!.toLowerCase() : "legacy"}`) },
      });
      canvas.addShape(shape, root);
      shapes.set(node.id, shape);
      const gfx = registry.getGraphics(shape) as SVGElement;
      // MoveCanvas leaves draggable elements to their own interactions.
      gfx.classList.add("djs-draggable");
      // diagram-js disables hit testing on visuals by default. BO shapes are
      // activatable even without its editing and selection modules.
      const visual = gfx.querySelector<SVGElement>(".djs-visual");
      if (visual) visual.style.pointerEvents = "all";
      gfx.setAttribute("role", "button");
      gfx.setAttribute("tabindex", "0");
      gfx.setAttribute("aria-label", node.name);
      gfx.setAttribute("aria-pressed", "false");
    }
    for (const edge of edges) {
      const source = shapes.get(edge.source);
      const target = shapes.get(edge.target);
      if (!source || !target) continue;
      const connection = factory.createConnection({
        id: edge.id,
        source,
        target,
        waypoints: boEdgeWaypoints(source, target, edge.routing, edge.geometry),
        businessObject: { boRelationship: true, cardinality: edge.cardinality, routing: edge.routing, geometry: edge.geometry },
      });
      canvas.addConnection(connection, root);
      const gfx = registry.getGraphics(connection) as SVGElement;
      gfx.classList.add("djs-draggable");
      if (canRemove || canRoute || canReshape) {
        gfx.setAttribute("role", "button");
        gfx.setAttribute("tabindex", "0");
        gfx.setAttribute("aria-label", t("boRelationship.relationLabel", {
          source: (source.businessObject.node as BoNode).name,
          target: (target.businessObject.node as BoNode).name,
        }));
        if (edge.cardinality) gfx.setAttribute("aria-description", t("boRelationship.cardinality") + " " + edge.cardinality);
      }
    }
    if (canRoute) {
      if (canReshape) bindBendpointContextMenu(diagram);
      eventBus.on("element.contextmenu", ({ element, originalEvent }: Interaction) => {
        if (!element.waypoints || !element.businessObject?.boRelationship) return;
        originalEvent.preventDefault();
        setRouteMenu({ id: element.id, left: originalEvent.clientX, top: originalEvent.clientY });
      });
    }
    if (canMove) {
      const dragging = diagram.get<Dragging>("dragging");
      const graphics = diagram.get<GraphicsFactory>("graphicsFactory");
      const previewMove = (shape: Shape, x: number, y: number) => {
        shape.x = x;
        shape.y = y;
        graphics.update("shape", shape, registry.getGraphics(shape) as SVGElement);
        for (const edge of [...shape.incoming, ...shape.outgoing]) {
          edge.waypoints = boEdgeWaypoints(edge.source as Shape, edge.target as Shape, edge.businessObject.routing, edge.businessObject.geometry);
          const gfx = registry.getGraphics(edge) as SVGElement;
          graphics.update("connection", edge, gfx);
          eventBus.fire("interactionEvents.updateHit", { element: edge, gfx });
          eventBus.fire("connection.changed", { element: edge, gfx });
        }
      };
      eventBus.on("element.mousedown", ({ element, originalEvent }: Interaction) => {
        if (originalEvent.button !== 0 || !element.businessObject?.node) return;
        const shape = element as Shape;
        dragging.init(originalEvent, "bo.move", {
          cursor: "grabbing",
          data: { context: { shape, x: shape.x, y: shape.y } },
        });
      });
      eventBus.on("bo.move.move", ({ context: { shape, x, y }, dx, dy }: BoDrag) => {
        previewMove(shape, x + dx, y + dy);
      });
      eventBus.on("bo.move.cancel", ({ context: { shape, x, y } }: BoDrag) => {
        previewMove(shape, x, y);
      });
      eventBus.on("bo.move.end", ({ context: { shape, x, y }, dx, dy }: BoDrag) => {
        if (dx || dy) actions.current.onMove?.(shape.id, { x: x + dx, y: y + dy });
      });
    }
    if (viewRef.current) canvas.viewbox(viewRef.current);
    if (restoreCanvasFocus.current && document.activeElement === document.body) canvas.focus();
    return () => {
      restoreCanvasFocus.current = canvas.getContainer().contains(document.activeElement);
      const view = canvas.viewbox();
      viewRef.current = { x: view.x, y: view.y, width: view.width, height: view.height };
      canvasRef.current = null;
      registryRef.current = null;
      zoomScrollRef.current = null;
      zoomScroll.toggle(false);
      diagram.destroy();
    };
  }, [nodes, edges, positions, canMove, canRemove, canRoute, canReshape, selectNode, t]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const registry = registryRef.current;
    if (!canvas || !registry) return;
    const selectedGraphics = new Map<string, SVGElement>();
    for (const id of selectedIds ?? (selectedId ? [selectedId] : [])) {
      const gfx = registry.getGraphics(id);
      if (!gfx?.classList.contains("djs-shape")) continue;
      canvas.addMarker(id, "bo-node-selected");
      gfx.setAttribute("aria-pressed", "true");
      selectedGraphics.set(id, gfx);
    }
    return () => {
      if (canvasRef.current !== canvas) return;
      for (const [id, gfx] of selectedGraphics) {
        canvas.removeMarker(id, "bo-node-selected");
        gfx.setAttribute("aria-pressed", "false");
      }
    };
  }, [selectedId, selectedIds, nodes, edges, positions, canMove, canRemove, t]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !activeRelation) return;
    canvas.addMarker(activeRelation, "bo-relation-selected");
    if (canReshape) canvas.addMarker(activeRelation, "selected");
    return () => {
      if (canvasRef.current !== canvas) return;
      canvas.removeMarker(activeRelation, "bo-relation-selected");
      if (canReshape) canvas.removeMarker(activeRelation, "selected");
    };
  }, [activeRelation, nodes, edges, positions, canMove, canReshape, t]);
  const zoom = (step: number) => {
    canvasRef.current?.resized();
    zoomScrollRef.current?.stepZoom(step);
  };

  const fit = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.resized();
    // The canvas accepts "auto" to center the fitted drawing.
    canvas.zoom("fit-viewport", "auto" as unknown as Point);
  };

  useImperativeHandle(ref, () => ({
    zoom,
    fit,
    exportSvg(name) {
      const layer = canvasRef.current?.getActiveLayer() as unknown as SVGGraphicsElement | undefined;
      if (!layer) return;
      const { x, y, width, height } = layer.getBBox();
      const svg = create("svg");
      attr(svg, { viewBox: `${x - 8} ${y - 8} ${width + 16} ${height + 16}` });
      layer.querySelectorAll<SVGGElement>(".djs-element > .djs-visual").forEach((visual) => {
        const copy = visual.cloneNode(false) as SVGGElement;
        const transform = visual.parentElement?.getAttribute("transform");
        if (transform) copy.setAttribute("transform", transform);
        for (const child of visual.children) {
          // Decorative ligatures need the app's icon font, which the standalone SVG cannot rely on.
          if (child.classList.contains("bo-node-icon")) continue;
          const styles = getComputedStyle(child);
          if (styles.display === "none") continue;
          const item = child.cloneNode(true) as SVGElement;
          for (const key of ["fill", "fill-opacity", "stroke", "stroke-width", "opacity", "font-family"]) {
            const value = styles.getPropertyValue(key);
            if (value) item.setAttribute(key, value);
          }
          append(copy, item);
        }
        append(svg, copy);
      });
      downloadText(`${name}.svg`, new XMLSerializer().serializeToString(svg), "image/svg+xml");
    },
  }));

  const handleCanvasKey = (event: ReactKeyboardEvent<HTMLDivElement>): boolean => {
    const { nativeEvent, target } = event;
    const canvas = canvasRef.current;
    if (!canvas || event.defaultPrevented || nativeEvent.isComposing || !(target instanceof SVGElement)
      || !canvas.getContainer().contains(target)) return false;

    if (isCmd(nativeEvent)) {
      if (isKey(["+", "="], nativeEvent)) {
        zoom(1);
        return true;
      }
      if (isKey("-", nativeEvent)) {
        zoom(-1);
        return true;
      }
      if (isKey("0", nativeEvent) && !event.shiftKey) {
        fit();
        return true;
      }
    }

    const hasKeyModifier = hasModifier(nativeEvent);
    const delta = panKeys[event.key];
    if (!hasKeyModifier && delta && target instanceof SVGSVGElement) {
      const { width, height } = canvas.getSize();
      canvas.scroll({ dx: -delta[0] * width / 4, dy: -delta[1] * height / 4 });
      return true;
    }

    const gfx = target.closest<SVGElement>(".djs-shape, .djs-connection");
    const element = gfx && registryRef.current?.get(gfx);
    if (gfx && element?.waypoints && canRoute && (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10"))) {
      const { left, bottom } = gfx.getBoundingClientRect();
      setRouteMenu({ id: element.id, left, top: bottom });
      return true;
    }
    const nodeId = element && element.businessObject?.node ? element.id : undefined;
    const edgeId = element && !nodeId && (canRemove || canReshape) ? element.id : undefined;
    if (!hasKeyModifier && (event.key === "Enter" || event.key === " ")) {
      if (nodeId) {
        const selected = selectedIds ? selectedIds.has(nodeId) : selectedId === nodeId;
        if (event.key === " " || !selected || !onShortcut?.("edit", nodeId)) selectNode(nodeId);
        return true;
      }
      if (edgeId) {
        setSelectedRelation(edgeId);
        return true;
      }
    }

    const action = shortcutAction(nativeEvent);
    if (!action) return false;
    const relationId = edgeId ?? (nodeId ? null : activeRelation);
    if (action === "delete" && relationId && onRequestRemoveEdge) {
      onRequestRemoveEdge(relationId);
      return true;
    }
    if (action === "edit" && edgeId) return false;
    if (nodeId && (action === "copy" || action === "delete" || action === "edit")) {
      return onShortcut?.(action, nodeId) ?? false;
    }
    if (!onShortcut?.(action)) return false;
    if (action === "selectAll" || action === "paste") {
      setSelectedRelation(null);
      if (edgeId) canvas.focus();
    }
    return true;
  };
  return (
    <Box role="region" aria-label={t("boRelationship.diagram")} sx={{ position: "relative", minWidth: 0, minHeight: 340, height: "100%" }}>
      <Box
        ref={container}
        dir="ltr"
        onKeyDown={(event) => {
          if (handleCanvasKey(event)) event.preventDefault();
        }}
        sx={{
          width: "100%", height: "100%", minHeight: 340, overflow: "hidden",
          bgcolor: "background.default",
          backgroundImage: (theme) => showGrid ? `radial-gradient(${theme.palette.divider} 0.85px, transparent 0.85px)` : "none",
          backgroundSize: "15px 15px",
          "& .djs-container > svg": { cursor: "grab" },
          "& .djs-shape": { cursor: canMove ? "move" : "pointer" },
          "& .djs-connection": { cursor: canReshape ? "grab" : canRemove ? "pointer" : "default" },
          "& .djs-parent": {
            "--bendpoint-fill-color": (theme) => theme.palette.primary.main,
            "--bendpoint-stroke-color": (theme) => theme.palette.background.default,
          },
          "& .bo-node-body": { fill: (theme) => theme.palette.background.paper, stroke: (theme) => theme.palette.divider, strokeWidth: 1 },
          ...(colorBy === "subtype" && {
            '& .bo-node-body[data-kind="data"]': { fill: (theme) => theme.palette.action.selected },
            '& .bo-node-body[data-kind="document"]': { fill: (theme) => theme.palette.info.main, fillOpacity: 0.2 },
          }),
          ...(colorBy === "personalData" && {
            '& .bo-node-body[data-personal="true"]': { fill: (theme) => theme.palette.warning.main, fillOpacity: 0.2 },
          }),
          ...(colorBy === "paymentData" && {
            '& .bo-node-body[data-payment="true"]': { fill: (theme) => theme.palette.primary.main, fillOpacity: 0.2 },
          }),
          ...(display?.subtype === false && { "& .bo-node-meta": { display: "none" } }),
          ...(display?.personalData === false && { "& .bo-badge-personal, & .bo-badge-personal-text": { display: "none" } }),
          ...(display?.paymentData === false && { "& .bo-badge-payment, & .bo-badge-payment-text": { display: "none" } }),
          "& .bo-node-fold": { fill: "none", stroke: (theme) => theme.palette.divider, strokeWidth: 1 },
          "& .bo-node-icon": { fill: (theme) => theme.palette.primary.main },
          "& .bo-node-title": { fill: (theme) => theme.palette.text.primary },
          "& .bo-node-meta": { fill: (theme) => theme.palette.text.secondary },
          "& .bo-badge-personal": { fill: (theme) => theme.palette.warning.main, opacity: 0.16 },
          "& .bo-badge-payment": { fill: (theme) => theme.palette.primary.main, opacity: 0.14 },
          "& .bo-badge-personal-text": { fill: (theme) => theme.palette.mode === "dark" ? theme.palette.warning.light : theme.palette.warning.dark },
          "& .bo-badge-payment-text": { fill: (theme) => theme.palette.primary.main },
          "& .bo-edge-line, & .bo-edge-many": { stroke: (theme) => theme.palette.text.secondary },
          "& .bo-node-selected .bo-node-body": { stroke: (theme) => theme.palette.primary.main, strokeWidth: 3 },
          "& .djs-shape:focus-visible .bo-node-body, & .djs-connection:focus-visible .bo-edge-line": { stroke: (theme) => theme.palette.primary.main, strokeWidth: 3 },
          "& .bo-relation-selected .bo-edge-line, & .bo-relation-selected .bo-edge-many": { stroke: (theme) => theme.palette.primary.main, strokeWidth: 4 },
        }}
      />
      {canRemove && <Stack direction="row" spacing={0.25} sx={{ position: "absolute", bottom: 8, right: 8, p: 0.25, border: 1, borderColor: "divider", borderRadius: 1, bgcolor: "background.paper" }}>
          <Tooltip title={t("boRelationship.removeSelectedRelation")}>
            <span><IconButton size="small" aria-label={t("boRelationship.removeSelectedRelation")} disabled={!activeRelation} onClick={() => { if (activeRelation) onRequestRemoveEdge(activeRelation); }}>
              <MaterialSymbol icon="delete" size={iconSize.sm} />
            </IconButton></span>
          </Tooltip>
      </Stack>}
      <ConnectorRoutingMenu anchor={routeEdge ? routeMenu : null}
        routing={routeEdge?.routing === "orthogonal" ? "orthogonal" : routeEdge?.geometry ? undefined : "straight"}
        onSelect={(routing) => { if (routeEdge) onChangeRouting?.(routeEdge.id, routing); }}
        onClose={() => setRouteMenu(null)} />
    </Box>
  );
}
