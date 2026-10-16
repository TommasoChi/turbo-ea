import Diagram from "diagram-js";
import type CommandStack from "diagram-js/lib/command/CommandStack";
import type Canvas from "diagram-js/lib/core/Canvas";
import type ElementRegistry from "diagram-js/lib/core/ElementRegistry";
import type { ContextPadEntries } from "diagram-js/lib/features/context-pad/ContextPadProvider";
import type { Connection, Shape } from "diagram-js/lib/model/Types";
import { makeBridge, withBridge } from "@/test/archimateBridge";
import { installSvgStubs } from "@/test/svgStubs";
import { getCardId, type ModelElement, type ModelRelationship } from "../exchange/exchangeModel";
import { ELEMENT_TYPES, type ElementType } from "../taxonomy/elements";
import { ACCESS_TYPES, RELATIONSHIP_TYPES, isRelationshipAllowed, type RelationshipType } from "../taxonomy/relationships";
import ArchimateContextPadProvider, { hasTargetFor } from "./ArchimateContextPadProvider";
import type ArchimateElementFactory from "./ArchimateElementFactory";
import type ArchimateModeling from "./ArchimateModeling";
import type { RelationshipTool } from "./RelationshipTool";

beforeAll(installSvgStubs);

type Action = Record<string, (event: Event, target: never, autoActivate: boolean) => void>;

function setup() {
  const bridge = makeBridge();
  const diagram = new Diagram({ canvas: { container: document.createElement("div") }, modules: withBridge(bridge) });
  const get = <T,>(name: string) => diagram.get<T>(name);
  const modeling = get<ArchimateModeling>("modeling");
  const factory = get<ArchimateElementFactory>("elementFactory");
  const root = get<Canvas>("canvas").getRootElement();
  const registry = get<ElementRegistry>("elementRegistry");
  const tool = get<RelationshipTool>("relationshipTool");
  const connect = { start: vi.fn() };
  const provider = new ArchimateContextPadProvider(
    { registerProvider: vi.fn() } as never, connect as never, modeling, tool, bridge, registry,
  );
  const add = (elementType: ElementType, x = 100) =>
    modeling.createShape(factory.createShape({ elementType }), { x, y: 100 }, root) as Shape;
  const entriesOf = (el: Shape | Connection) => provider.getContextPadEntries(el) as ContextPadEntries;
  const click = (entries: ContextPadEntries, key: string, el: Shape | Connection) =>
    (entries[key].action as Action).click(new MouseEvent("click"), el as never, false);
  return { bridge, get, modeling, registry, connect, add, entriesOf, click, tool };
}

describe("hasTargetFor", () => {
  it("scans the matrix for at least one allowed target", () => {
    expect(hasTargetFor("BusinessActor", "Assignment")).toBe(true);
    expect(hasTargetFor("DataObject", "Assignment")).toBe(false); // only a junction accepts it: junctions don't count
    expect(hasTargetFor("BusinessActor", "Access")).toBe(true);
    for (const t of ELEMENT_TYPES) expect(hasTargetFor(t, "Association")).toBe(true);
  });
});

describe("ArchimateContextPadProvider, element entries", () => {
  it("registers itself as a context pad provider", () => {
    const { get } = setup();
    const registerProvider = vi.fn();
    new ArchimateContextPadProvider(
      { registerProvider } as never, {} as never, get("modeling"), get("relationshipTool"), makeBridge(), get("elementRegistry"),
    );
    expect(registerProvider).toHaveBeenCalledTimes(1);
  });

  it("offers one connect entry per relationship the matrix allows, plus delete", () => {
    const { add, entriesOf } = setup();
    const entries = entriesOf(add("BusinessActor"));
    expect(entries["connect.Assignment"]).toBeDefined();
    expect(entries["connect.Association"]).toBeDefined();
    expect(entries["connect.Assignment"].group).toBe("connect");
    expect(entries["connect.Assignment"].title).toBe("L:connect L:Assignment");
    expect(entries["connect.Assignment"].html).toContain('class="entry archimate-cp-entry"');
    expect(entries["connect.Assignment"].html).toContain("<svg");
    expect(entries["delete"].group).toBe("edit");
    expect(entries["delete"].html).toContain('<span class="material-symbols-outlined">delete</span>');
    expect(entries["delete"].title).toBe("L:delete");
    expect(entriesOf(add("DataObject"))["connect.Assignment"]).toBeUndefined();
  });

  it("follows the matrix for a junction and offers no card entries for it", () => {
    const { add, entriesOf } = setup();
    const entries = entriesOf(add("AndJunction"));
    for (const rel of RELATIONSHIP_TYPES) {
      const expected = ELEMENT_TYPES.some((t) => !t.endsWith("Junction") && isRelationshipAllowed("AndJunction", t, rel));
      expect(Boolean(entries[`connect.${rel}`])).toBe(expected);
    }
    expect(Object.keys(entries).filter((k) => k.endsWith("-card"))).toEqual([]);
  });

  it("gives every entry a title and the entry html", () => {
    const { add, entriesOf, bridge } = setup();
    vi.mocked(bridge.cardTypesFor).mockReturnValue([{ key: "Application", label: "Application" }]);
    for (const e of Object.values(entriesOf(add("ApplicationComponent")))) {
      expect(e.title).toBeTruthy();
      expect(e.html).toContain('class="entry archimate-cp-entry"');
    }
  });

  it("offers link/create for an unlinked element and open/unlink once linked", () => {
    const { add, entriesOf, bridge, modeling } = setup();
    vi.mocked(bridge.cardTypesFor).mockReturnValue([{ key: "Application", label: "Application" }]);
    const shape = add("ApplicationComponent");
    const unlinked = entriesOf(shape);
    expect(unlinked["link-card"]).toBeDefined();
    expect(unlinked["create-card"]).toBeDefined();
    expect(unlinked["open-card"]).toBeUndefined();
    expect(unlinked["unlink-card"]).toBeUndefined();
    modeling.updateProperties(shape, { cardId: "c1" });
    const linked = entriesOf(shape);
    expect(linked["open-card"]).toBeDefined();
    expect(linked["unlink-card"]).toBeDefined();
    expect(linked["link-card"]).toBeUndefined();
    expect(linked["create-card"]).toBeUndefined();
    expect(bridge.cardTypesFor).toHaveBeenCalledWith("ApplicationComponent");
  });

  it("offers no card entries when no card type maps to the element", () => {
    const { add, entriesOf } = setup();
    expect(Object.keys(entriesOf(add("BusinessActor"))).filter((k) => k.endsWith("-card"))).toEqual([]);
  });

  it("click on a connect entry selects the relationship and starts connect from the element", () => {
    const { add, entriesOf, click, tool, connect } = setup();
    const service = add("BusinessService");
    click(entriesOf(service), "connect.Serving", service);
    expect(tool.current).toBe("Serving");
    expect(tool.accessType).toBeNull();
    expect(connect.start).toHaveBeenCalledWith(expect.any(MouseEvent), service);
    const process = add("BusinessProcess", 400);
    click(entriesOf(process), "connect.Access", process);
    expect(tool.current).toBe("Access");
    expect(tool.accessType).toBe("Access");
  });

  it("dragstart on a connect entry does the same", () => {
    const { add, entriesOf, tool, connect } = setup();
    const service = add("BusinessService");
    (entriesOf(service)["connect.Serving"].action as Action).dragstart(new MouseEvent("dragstart"), service as never, false);
    expect(tool.current).toBe("Serving");
    expect(connect.start).toHaveBeenCalledTimes(1);
  });
});

describe("ArchimateContextPadProvider, cards (the DrawIO rule: nothing deletes a card)", () => {
  it("the bridge stub has no function that could delete a card", () => {
    expect(Object.keys(setup().bridge).filter((k) => /delete|remove/i.test(k))).toEqual([]);
  });

  it("link-card, create-card and open-card go through the bridge", () => {
    const { add, entriesOf, click, bridge, modeling } = setup();
    vi.mocked(bridge.cardTypesFor).mockReturnValue([{ key: "Application", label: "Application" }]);
    const shape = add("ApplicationComponent");
    click(entriesOf(shape), "link-card", shape);
    expect(bridge.openLinkPicker).toHaveBeenCalledWith(shape.id);
    click(entriesOf(shape), "create-card", shape);
    expect(bridge.openCreateCard).toHaveBeenCalledWith(shape.id);
    modeling.updateProperties(shape, { cardId: "c1" });
    click(entriesOf(shape), "open-card", shape);
    expect(bridge.openCard).toHaveBeenCalledWith("c1");
  });

  it("delete removes the shape and touches no card", () => {
    const { add, entriesOf, click, registry, bridge, modeling } = setup();
    vi.mocked(bridge.cardTypesFor).mockReturnValue([{ key: "Application", label: "Application" }]);
    const shape = add("ApplicationComponent");
    modeling.updateProperties(shape, { cardId: "c1" });
    click(entriesOf(shape), "delete", shape);
    expect(registry.get(shape.id)).toBeUndefined();
    expect(bridge.openCreateCard).not.toHaveBeenCalled();
    expect(bridge.openLinkPicker).not.toHaveBeenCalled();
    expect(bridge.openCard).not.toHaveBeenCalled();
  });

  it("unlink-card clears the property (undoable) and calls no bridge function", () => {
    const { add, entriesOf, click, bridge, modeling, get } = setup();
    vi.mocked(bridge.cardTypesFor).mockReturnValue([{ key: "Application", label: "Application" }]);
    const shape = add("ApplicationComponent");
    modeling.updateProperties(shape, { cardId: "c1" });
    click(entriesOf(shape), "unlink-card", shape);
    expect(getCardId(shape.businessObject as ModelElement)).toBeNull();
    expect(bridge.openCreateCard).not.toHaveBeenCalled();
    expect(bridge.openLinkPicker).not.toHaveBeenCalled();
    expect(bridge.openCard).not.toHaveBeenCalled();
    get<CommandStack>("commandStack").undo();
    expect(getCardId(shape.businessObject as ModelElement)).toBe("c1");
  });
});

describe("ArchimateContextPadProvider, connection entries", () => {
  const PAIRS: Record<"Access" | "Serving" | "Association", [ElementType, ElementType]> = {
    Access: ["BusinessProcess", "DataObject"],
    Serving: ["BusinessService", "BusinessActor"],
    Association: ["BusinessProcess", "DataObject"],
  };
  const connectWith = (rel: RelationshipType & keyof typeof PAIRS) => {
    const env = setup();
    const connection = env.modeling.connect(env.add(PAIRS[rel][0]), env.add(PAIRS[rel][1], 400), { relationship: rel }) as Connection;
    return { ...env, connection, bo: connection.businessObject as ModelRelationship };
  };

  it("an Access connection offers delete and four access entries, the current one active", () => {
    const { connection, entriesOf, bo } = connectWith("Access");
    const entries = entriesOf(connection);
    expect(Object.keys(entries).filter((k) => k.startsWith("access."))).toEqual(ACCESS_TYPES.map((a) => `access.${a}`));
    for (const a of ACCESS_TYPES) {
      expect(entries[`access.${a}`].group).toBe("access");
      expect(entries[`access.${a}`].title).toBe(`L:${a}`);
      expect(entries[`access.${a}`].html).toContain("<svg");
      expect((entries[`access.${a}`].className ?? "").includes("active")).toBe(a === (bo.accessType ?? "Access"));
    }
    expect(entries["delete"]).toBeDefined();
  });

  it("clicking access.Write updates the access type, and undo restores it", () => {
    const { connection, entriesOf, click, bo, get } = connectWith("Access");
    const before = bo.accessType;
    click(entriesOf(connection), "access.Write", connection);
    expect(bo.accessType).toBe("Write");
    get<CommandStack>("commandStack").undo();
    expect(bo.accessType).toBe(before);
  });

  it("a Serving connection offers only delete", () => {
    const { connection, entriesOf, click, registry } = connectWith("Serving");
    expect(Object.keys(entriesOf(connection))).toEqual(["delete"]);
    click(entriesOf(connection), "delete", connection);
    expect(registry.get(connection.id)).toBeUndefined();
  });

  it("an Association offers directed and delete, and the toggle flips isDirected", () => {
    const { connection, entriesOf, click, bo, get } = connectWith("Association");
    expect(Object.keys(entriesOf(connection)).sort()).toEqual(["delete", "directed"]);
    expect((entriesOf(connection)["directed"].className ?? "").includes("active")).toBe(false);
    click(entriesOf(connection), "directed", connection);
    expect(bo.isDirected).toBe(true);
    expect((entriesOf(connection)["directed"].className ?? "").includes("active")).toBe(true);
    click(entriesOf(connection), "directed", connection);
    expect(bo.isDirected).toBe(false);
    get<CommandStack>("commandStack").undo();
    expect(bo.isDirected).toBe(true);
  });
});
