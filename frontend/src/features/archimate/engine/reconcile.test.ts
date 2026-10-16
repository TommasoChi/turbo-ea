import { MODEL } from "@/test/archimateModel";
import {
  CARD_ID_DEFINITION,
  type ArchimateModel,
  type ModelElement,
  type ModelRelationship,
  type ModelView,
} from "../exchange/exchangeModel";
import { reconcileModel, type EditedView } from "./reconcile";

const el = (id: string, cardId?: string): ModelElement => ({
  id, type: "BusinessActor", name: id, properties: cardId ? [{ ref: CARD_ID_DEFINITION, value: cardId }] : [],
});
const rel = (id: string, source: string, target: string): ModelRelationship => ({
  id, type: "Association", source, target, properties: [],
});
const view = (id: string, refs: string[], rels: [string, string, string][] = []): ModelView => ({
  id,
  name: id,
  nodes: refs.map((r) => ({ id: `${id}-${r}`, elementRef: r, x: 0, y: 0, width: 120, height: 55, parent: null })),
  connections: rels.map(([r, s, t]) => ({
    id: `${id}-${r}`, relationshipRef: r, source: `${id}-${s}`, target: `${id}-${t}`, bendpoints: [],
  })),
});
const m = (p: Partial<ArchimateModel>): ArchimateModel => ({
  id: "id-m", name: "M", propertyDefinitions: [], elements: [], relationships: [], views: [], ...p,
});
/** What the editor shows after editing: the given first view, with its elements and relationships. */
function edited(model: ArchimateModel, v: ModelView): EditedView {
  const refs = new Set(v.nodes.map((n) => n.elementRef));
  const rels = new Set(v.connections.map((c) => c.relationshipRef));
  return {
    view: v,
    elements: model.elements.filter((e) => refs.has(e.id)),
    relationships: model.relationships.filter((r) => rels.has(r.id)),
  };
}

describe("reconcileModel", () => {
  const a = el("a"), b = el("b"), c = el("c");

  it("drops an element removed from the first view and used nowhere else, with its relationships", () => {
    const base = m({ elements: [a, b], relationships: [rel("r", "a", "b")], views: [view("v1", ["a", "b"], [["r", "a", "b"]])] });
    const out = reconcileModel(base, edited(base, view("v1", ["a"])));
    expect(out.elements).toEqual([a]);
    expect(out.relationships).toEqual([]);
  });

  it("keeps an element removed from the first view but drawn on another view", () => {
    const base = m({ elements: [a, b], views: [view("v1", ["a", "b"]), view("v2", ["b"])] });
    expect(reconcileModel(base, edited(base, view("v1", ["a"]))).elements).toEqual([a, b]);
  });

  it("keeps an element the base defined but never drew on the first view", () => {
    const base = m({ elements: [a, b], views: [view("v1", ["a"])] });
    expect(reconcileModel(base, edited(base, view("v1", ["a"]))).elements).toEqual([a, b]);
  });

  it("drops a relationship whose connection was deleted while its endpoints stay drawn", () => {
    const base = m({ elements: [a, b], relationships: [rel("r", "a", "b")], views: [view("v1", ["a", "b"], [["r", "a", "b"]])] });
    const out = reconcileModel(base, edited(base, view("v1", ["a", "b"])));
    expect(out.elements).toEqual([a, b]);
    expect(out.relationships).toEqual([]);
  });

  it("keeps a never-drawn relationship only while both endpoints survive", () => {
    const base = m({
      elements: [a, b, c],
      relationships: [rel("r1", "a", "c"), rel("r2", "a", "b"), rel("r3", "r2", "c")],
      views: [view("v1", ["a", "b"])],
    });
    // c was never drawn (kept), b is deleted: r2 goes, and so does r3, which pointed at r2.
    const out = reconcileModel(base, edited(base, view("v1", ["a"])));
    expect(out.elements).toEqual([a, c]);
    expect(out.relationships).toEqual([rel("r1", "a", "c")]);
  });

  it("returns the other views unchanged and in order", () => {
    const v2 = view("v2", ["b"]), v3 = view("v3", ["c"]);
    const base = m({ elements: [a, b, c], views: [view("v1", ["a"]), v2, v3] });
    const v1 = view("v1", ["a", "b"]);
    const out = reconcileModel(base, edited(base, v1));
    expect(out.views).toEqual([v1, v2, v3]);
    expect(out.views[1]).toBe(v2);
  });

  it("adds the card definition exactly once when an element is linked, and only then", () => {
    const base = m({ elements: [a], views: [view("v1", ["a"])] });
    const linked = el("a", "c1");
    const out = reconcileModel(base, { view: view("v1", ["a"]), elements: [linked], relationships: [] });
    expect(out.elements).toEqual([linked]);
    expect(out.propertyDefinitions).toEqual([{ id: CARD_ID_DEFINITION, name: "turboea:cardId", type: "string" }]);
    expect(reconcileModel(out, edited(out, out.views[0])).propertyDefinitions).toHaveLength(1);
    expect(reconcileModel(base, edited(base, view("v1", ["a"]))).propertyDefinitions).toBe(base.propertyDefinitions);
  });

  it("adds a brand-new element and relationship with their ids", () => {
    const base = m({ elements: [a], views: [view("v1", ["a"])] });
    const fresh = el("id-new"), r = rel("id-r", "a", "id-new");
    const out = reconcileModel(base, {
      view: view("v1", ["a", "id-new"], [["id-r", "a", "id-new"]]), elements: [a, fresh], relationships: [r],
    });
    expect(out.elements).toEqual([a, fresh]);
    expect(out.relationships).toEqual([r]);
  });

  it("keeps the identity of the model, and is idempotent on the shared MODEL", () => {
    const out = reconcileModel(MODEL, edited(MODEL, MODEL.views[0]));
    expect(out).toEqual(MODEL);
    expect([out.id, out.name, out.documentation]).toEqual([MODEL.id, MODEL.name, MODEL.documentation]);
  });
});
