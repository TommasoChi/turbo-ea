import Diagram from "diagram-js";
import type CommandStack from "diagram-js/lib/command/CommandStack";
import type Canvas from "diagram-js/lib/core/Canvas";
import type { Shape } from "diagram-js/lib/model/Types";
import { installSvgStubs } from "@/test/svgStubs";
import { getCardId } from "../exchange/exchangeModel";
import type ArchimateElementFactory from "./ArchimateElementFactory";
import type ArchimateModeling from "./ArchimateModeling";
import { ARCHIMATE_BASE_MODULES } from "./modules";

beforeAll(installSvgStubs);

function setup() {
  const container = document.createElement("div");
  const diagram = new Diagram({ canvas: { container }, modules: ARCHIMATE_BASE_MODULES });
  const modeling = diagram.get<ArchimateModeling>("modeling");
  const factory = diagram.get<ArchimateElementFactory>("elementFactory");
  const root = diagram.get<Canvas>("canvas").getRootElement();
  const shape = modeling.createShape(factory.createShape({ elementType: "BusinessActor" }), { x: 100, y: 100 }, root) as Shape;
  return { modeling, shape, commandStack: diagram.get<CommandStack>("commandStack") };
}

describe("ArchimateModeling.updateProperties", () => {
  it("changes the name as one undoable command", () => {
    const { modeling, shape, commandStack } = setup();
    modeling.updateProperties(shape, { name: "CEO" });
    expect(shape.businessObject.name).toBe("CEO");
    commandStack.undo();
    expect(shape.businessObject.name).toBe("");
    commandStack.redo();
    expect(shape.businessObject.name).toBe("CEO");
  });

  it("removes a property that did not exist before on undo", () => {
    const { modeling, shape, commandStack } = setup();
    modeling.updateProperties(shape, { documentation: "Doc" });
    expect(shape.businessObject.documentation).toBe("Doc");
    commandStack.undo();
    expect("documentation" in shape.businessObject).toBe(false);
  });

  it("links and unlinks a card through the card property", () => {
    const { modeling, shape, commandStack } = setup();
    modeling.updateProperties(shape, { cardId: "c1" });
    expect(getCardId(shape.businessObject)).toBe("c1");
    expect("cardId" in shape.businessObject).toBe(false);
    commandStack.undo();
    expect(getCardId(shape.businessObject)).toBeNull();
    commandStack.redo();
    modeling.updateProperties(shape, { cardId: null });
    expect(shape.businessObject.properties).toEqual([]);
  });
});
