import EventBus from "diagram-js/lib/core/EventBus";
import { RelationshipTool } from "./RelationshipTool";

function setup() {
  const eventBus = new EventBus();
  return { eventBus, tool: new RelationshipTool(eventBus) };
}

describe("RelationshipTool", () => {
  it("stores the relationship and access type, and clears both", () => {
    const { tool } = setup();
    expect([tool.current, tool.accessType]).toEqual([null, null]);
    tool.set("Access", "Write");
    expect([tool.current, tool.accessType]).toEqual(["Access", "Write"]);
    tool.clear();
    expect([tool.current, tool.accessType]).toEqual([null, null]);
  });

  it("nulls a previous access type when the next relationship has none", () => {
    const { tool } = setup();
    tool.set("Access", "ReadWrite");
    tool.set("Serving");
    expect([tool.current, tool.accessType]).toEqual(["Serving", null]);
  });

  it.each(["connect.cleanup", "connect.end"])("clears itself on %s", (type) => {
    const { tool, eventBus } = setup();
    tool.set("Flow");
    eventBus.fire(type, { context: {} });
    expect([tool.current, tool.accessType]).toEqual([null, null]);
  });
});
