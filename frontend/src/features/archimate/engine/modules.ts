/**
 * The diagram-js modules of the ArchiMate engine, assembled the way bpmn-js's Modeler does it.
 *
 * `ARCHIMATE_MODULES` is the one array the later engine parts (renderer, rules, palette, context
 * pad, labels, keyboard) extend.
 */
import type { ModuleDeclaration } from "didi";
import AutoScrollModule from "diagram-js/lib/features/auto-scroll";
import BendpointsModule from "diagram-js/lib/features/bendpoints";
import ConnectModule from "diagram-js/lib/features/connect";
import ConnectionPreviewModule from "diagram-js/lib/features/connection-preview";
import CreateModule from "diagram-js/lib/features/create";
import GridSnappingModule from "diagram-js/lib/features/grid-snapping";
import HandToolModule from "diagram-js/lib/features/hand-tool";
import HoverFixModule from "diagram-js/lib/features/hover-fix";
import InteractionEventsModule from "diagram-js/lib/features/interaction-events";
import LassoToolModule from "diagram-js/lib/features/lasso-tool";
import ModelingModule from "diagram-js/lib/features/modeling";
import MoveModule from "diagram-js/lib/features/move";
import OutlineModule from "diagram-js/lib/features/outline";
import OverlaysModule from "diagram-js/lib/features/overlays";
import ResizeModule from "diagram-js/lib/features/resize";
import SnappingModule from "diagram-js/lib/features/snapping";
import CroppingConnectionDocking from "diagram-js/lib/layout/CroppingConnectionDocking";
import MoveCanvasModule from "diagram-js/lib/navigation/movecanvas";
import ZoomScrollModule from "diagram-js/lib/navigation/zoomscroll";
import ArchimateElementFactory from "./ArchimateElementFactory";
import ArchimateModeling from "./ArchimateModeling";
import ArchimateRenderer from "./ArchimateRenderer";
import ModelSync, { ArchimateLayouter } from "./ModelSync";

/** Overrides diagram-js's own factory, modeling and layouter: it must load after ModelingModule. */
const ArchimateCoreModule: ModuleDeclaration = {
  __depends__: [ModelingModule],
  __init__: ["modelSync"],
  elementFactory: ["type", ArchimateElementFactory],
  modeling: ["type", ArchimateModeling],
  layouter: ["type", ArchimateLayouter],
  connectionDocking: ["type", CroppingConnectionDocking],
  modelSync: ["type", ModelSync],
};

/** Draws the notation; it also supplies the outlines connection cropping uses (priority above the default renderer). */
const ArchimateRendererModule: ModuleDeclaration = {
  __init__: ["archimateRenderer"],
  archimateRenderer: ["type", ArchimateRenderer],
};

export const ARCHIMATE_BASE_MODULES: ModuleDeclaration[] = [
  ModelingModule,
  ArchimateCoreModule,
  MoveModule,
  ResizeModule,
  BendpointsModule,
  ConnectModule,
  CreateModule,
  ConnectionPreviewModule,
  OverlaysModule,
  OutlineModule,
  HoverFixModule,
  InteractionEventsModule,
  MoveCanvasModule,
  ZoomScrollModule,
  AutoScrollModule,
  LassoToolModule,
  HandToolModule,
  SnappingModule,
  GridSnappingModule,
];

export const ARCHIMATE_MODULES: ModuleDeclaration[] = [...ARCHIMATE_BASE_MODULES, ArchimateRendererModule];
