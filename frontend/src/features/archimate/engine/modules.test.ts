import Diagram from "diagram-js";
import CroppingConnectionDocking from "diagram-js/lib/layout/CroppingConnectionDocking";
import { installSvgStubs } from "@/test/svgStubs";
import ArchimateElementFactory from "./ArchimateElementFactory";
import ArchimateModeling from "./ArchimateModeling";
import ArchimateRenderer from "./ArchimateRenderer";
import { ArchimateLayouter } from "./ModelSync";
import { ARCHIMATE_BASE_MODULES, ARCHIMATE_MODULES } from "./modules";

beforeAll(installSvgStubs);

describe("engine modules", () => {
  it("override diagram-js's factory, modeling and layouter, and provide the cropping docking", () => {
    const diagram = new Diagram({ canvas: { container: document.createElement("div") }, modules: ARCHIMATE_BASE_MODULES });
    expect(diagram.get("elementFactory")).toBeInstanceOf(ArchimateElementFactory);
    expect(diagram.get("modeling")).toBeInstanceOf(ArchimateModeling);
    expect(diagram.get("layouter")).toBeInstanceOf(ArchimateLayouter);
    expect(diagram.get("connectionDocking")).toBeInstanceOf(CroppingConnectionDocking);
  });

  it("extend the base modules with the renderer (later engine parts extend ARCHIMATE_MODULES)", () => {
    expect(ARCHIMATE_MODULES.slice(0, ARCHIMATE_BASE_MODULES.length)).toEqual(ARCHIMATE_BASE_MODULES);
    expect(ARCHIMATE_MODULES).toHaveLength(ARCHIMATE_BASE_MODULES.length + 1);
    const diagram = new Diagram({ canvas: { container: document.createElement("div") }, modules: ARCHIMATE_MODULES });
    expect(diagram.get("archimateRenderer")).toBeInstanceOf(ArchimateRenderer);
  });
});
