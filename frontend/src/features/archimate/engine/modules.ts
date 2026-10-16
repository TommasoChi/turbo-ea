/**
 * The diagram-js modules of the ArchiMate engine, assembled the way bpmn-js's Modeler does it.
 *
 * `ARCHIMATE_MODULES` is the one array the later engine parts (renderer, rules, palette, context
 * pad, labels, keyboard) extend.
 */
import type { ModuleDeclaration } from "didi";
import type EventBus from "diagram-js/lib/core/EventBus";
import AutoScrollModule from "diagram-js/lib/features/auto-scroll";
import BendpointsModule from "diagram-js/lib/features/bendpoints";
import ContextPadModule from "diagram-js/lib/features/context-pad";
import ConnectModule from "diagram-js/lib/features/connect";
import ConnectionPreviewModule from "diagram-js/lib/features/connection-preview";
import CopyPasteModule from "diagram-js/lib/features/copy-paste";
import CreateModule from "diagram-js/lib/features/create";
import EditorActionsModule from "diagram-js/lib/features/editor-actions";
import GridSnappingModule from "diagram-js/lib/features/grid-snapping";
import HandToolModule from "diagram-js/lib/features/hand-tool";
import HoverFixModule from "diagram-js/lib/features/hover-fix";
import InteractionEventsModule from "diagram-js/lib/features/interaction-events";
import KeyboardModule from "diagram-js/lib/features/keyboard";
import KeyboardMoveSelectionModule from "diagram-js/lib/features/keyboard-move-selection";
import LassoToolModule from "diagram-js/lib/features/lasso-tool";
import ModelingModule from "diagram-js/lib/features/modeling";
import MoveModule from "diagram-js/lib/features/move";
import OutlineModule from "diagram-js/lib/features/outline";
import OverlaysModule from "diagram-js/lib/features/overlays";
import PaletteModule from "diagram-js/lib/features/palette";
import ResizeModule from "diagram-js/lib/features/resize";
import RulesModule from "diagram-js/lib/features/rules";
import SelectionModule from "diagram-js/lib/features/selection";
import SnappingModule from "diagram-js/lib/features/snapping";
import CroppingConnectionDocking from "diagram-js/lib/layout/CroppingConnectionDocking";
import MoveCanvasModule from "diagram-js/lib/navigation/movecanvas";
import ZoomScrollModule from "diagram-js/lib/navigation/zoomscroll";
import type { Element } from "diagram-js/lib/model/Types";
import DirectEditingModule from "diagram-js-direct-editing";
import ArchimateElementFactory from "./ArchimateElementFactory";
import ArchimateContextPadProvider from "./ArchimateContextPadProvider";
import ArchimateLabelEditing from "./ArchimateLabelEditing";
import ArchimateModeling from "./ArchimateModeling";
import ArchimatePaletteProvider from "./ArchimatePaletteProvider";
import ArchimateRenderer from "./ArchimateRenderer";
import ArchimateRules from "./ArchimateRules";
import ModelSync, { ArchimateLayouter } from "./ModelSync";
import { ArchimateKeyboardBindings } from "./keyboardConfig";
import { RelationshipTool } from "./RelationshipTool";

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

/** The relation-matrix and nesting rules, and the tool that says which relationship the next connect draws. */
const ArchimateRulesModule: ModuleDeclaration = {
  __depends__: [RulesModule],
  __init__: ["archimateRules"],
  relationshipTool: ["type", RelationshipTool],
  archimateRules: ["type", ArchimateRules],
};

/** The layered palette; it needs the engine's `bridge` value (titles come from the page's labels). */
const ArchimatePaletteModule: ModuleDeclaration = {
  __depends__: [PaletteModule, CreateModule, HandToolModule, LassoToolModule, SelectionModule],
  __init__: ["archimatePalette"],
  archimatePalette: ["type", ArchimatePaletteProvider],
};

/** The context pad: relationships, card link and delete; it needs the `bridge` value too. */
const ArchimateContextPadModule: ModuleDeclaration = {
  __depends__: [ContextPadModule, ConnectModule, ArchimateRulesModule],
  __init__: ["archimateContextPad"],
  archimateContextPad: ["type", ArchimateContextPadProvider],
};

/** A copied element carries a deep clone of its business object; the factory gives the paste new ids and no card. */
function copyBusinessObject(eventBus: EventBus): void {
  eventBus.on("copyPaste.copyElement", ({ descriptor, element }: { descriptor: Record<string, unknown>; element: Element }) => {
    if (element.businessObject) descriptor.businessObject = structuredClone(element.businessObject);
  });
}
copyBusinessObject.$inject = ["eventBus"];

/** Name editing, keyboard shortcuts (bound to the canvas) and copy/paste. */
const ArchimateEditingModule: ModuleDeclaration = {
  __depends__: [DirectEditingModule, CopyPasteModule, EditorActionsModule, KeyboardModule, KeyboardMoveSelectionModule],
  __init__: ["archimateLabelEditing", "archimateKeyboardBindings", copyBusinessObject],
  archimateLabelEditing: ["type", ArchimateLabelEditing],
  archimateKeyboardBindings: ["type", ArchimateKeyboardBindings],
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

export const ARCHIMATE_MODULES: ModuleDeclaration[] = [
  ...ARCHIMATE_BASE_MODULES,
  ArchimateRendererModule,
  ArchimateRulesModule,
  ArchimatePaletteModule,
  ArchimateContextPadModule,
  ArchimateEditingModule,
];
