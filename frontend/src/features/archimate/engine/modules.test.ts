import Diagram from "diagram-js";
import CroppingConnectionDocking from "diagram-js/lib/layout/CroppingConnectionDocking";
import { withBridge } from "@/test/archimateBridge";
import { installSvgStubs } from "@/test/svgStubs";
import ArchimateContextPadProvider from "./ArchimateContextPadProvider";
import ArchimateElementFactory from "./ArchimateElementFactory";
import ArchimateLabelEditing from "./ArchimateLabelEditing";
import { ArchimateKeyboardBindings } from "./keyboardConfig";
import ArchimateModeling from "./ArchimateModeling";
import ArchimatePaletteProvider from "./ArchimatePaletteProvider";
import ArchimateRenderer from "./ArchimateRenderer";
import ArchimateRules from "./ArchimateRules";
import { ArchimateLayouter } from "./ModelSync";
import { ARCHIMATE_BASE_MODULES, ARCHIMATE_MODULES } from "./modules";
import { RelationshipTool } from "./RelationshipTool";

beforeAll(installSvgStubs);

describe("engine modules", () => {
  it("override diagram-js's factory, modeling and layouter, and provide the cropping docking", () => {
    const diagram = new Diagram({ canvas: { container: document.createElement("div") }, modules: ARCHIMATE_BASE_MODULES });
    expect(diagram.get("elementFactory")).toBeInstanceOf(ArchimateElementFactory);
    expect(diagram.get("modeling")).toBeInstanceOf(ArchimateModeling);
    expect(diagram.get("layouter")).toBeInstanceOf(ArchimateLayouter);
    expect(diagram.get("connectionDocking")).toBeInstanceOf(CroppingConnectionDocking);
  });

  it("extend the base modules with the renderer, the rules, the palette, the context pad and the editing module (later engine parts extend ARCHIMATE_MODULES)", () => {
    expect(ARCHIMATE_MODULES.slice(0, ARCHIMATE_BASE_MODULES.length)).toEqual(ARCHIMATE_BASE_MODULES);
    expect(ARCHIMATE_MODULES).toHaveLength(ARCHIMATE_BASE_MODULES.length + 5);
    const diagram = new Diagram({ canvas: { container: document.createElement("div") }, modules: withBridge() });
    expect(diagram.get("archimateRenderer")).toBeInstanceOf(ArchimateRenderer);
    expect(diagram.get("archimateRules")).toBeInstanceOf(ArchimateRules);
    expect(diagram.get("relationshipTool")).toBeInstanceOf(RelationshipTool);
    expect(diagram.get("archimatePalette")).toBeInstanceOf(ArchimatePaletteProvider);
    expect(diagram.get("archimateContextPad")).toBeInstanceOf(ArchimateContextPadProvider);
    expect(diagram.get("archimateLabelEditing")).toBeInstanceOf(ArchimateLabelEditing);
    expect(diagram.get("archimateKeyboardBindings")).toBeInstanceOf(ArchimateKeyboardBindings);
    for (const service of ["directEditing", "copyPaste", "clipboard", "editorActions", "keyboard", "keyboardMoveSelection"]) {
      expect(diagram.get(service, false)).toBeTruthy();
    }
  });
});
