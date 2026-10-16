import Diagram from "diagram-js";
import CroppingConnectionDocking from "diagram-js/lib/layout/CroppingConnectionDocking";
import { installSvgStubs } from "@/test/svgStubs";
import ArchimateElementFactory from "./ArchimateElementFactory";
import ArchimateModeling from "./ArchimateModeling";
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

  it("start the full engine from the base modules (later engine parts extend ARCHIMATE_MODULES)", () => {
    expect(ARCHIMATE_MODULES).toEqual(ARCHIMATE_BASE_MODULES);
  });
});
