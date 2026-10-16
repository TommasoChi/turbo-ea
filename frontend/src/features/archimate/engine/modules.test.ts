import Diagram from "diagram-js";
import CroppingConnectionDocking from "diagram-js/lib/layout/CroppingConnectionDocking";
import { installSvgStubs } from "@/test/svgStubs";
import ArchimateElementFactory from "./ArchimateElementFactory";
import ArchimateModeling from "./ArchimateModeling";
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

  it("extend the base modules with the renderer and the rules (later engine parts extend ARCHIMATE_MODULES)", () => {
    expect(ARCHIMATE_MODULES.slice(0, ARCHIMATE_BASE_MODULES.length)).toEqual(ARCHIMATE_BASE_MODULES);
    expect(ARCHIMATE_MODULES).toHaveLength(ARCHIMATE_BASE_MODULES.length + 2);
    const diagram = new Diagram({ canvas: { container: document.createElement("div") }, modules: ARCHIMATE_MODULES });
    expect(diagram.get("archimateRenderer")).toBeInstanceOf(ArchimateRenderer);
    expect(diagram.get("archimateRules")).toBeInstanceOf(ArchimateRules);
    expect(diagram.get("relationshipTool")).toBeInstanceOf(RelationshipTool);
  });
});
