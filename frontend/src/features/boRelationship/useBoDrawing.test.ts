import { act, renderHook } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { api } from "@/api/client";
import type { BoGraph } from "./BoRelationshipPage";
import { useBoDrawing } from "./useBoDrawing";

vi.mock("@/api/client", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/api/client")>(),
  api: { put: vi.fn(), delete: vi.fn() },
}));

beforeEach(() => vi.resetAllMocks());

const graph: BoGraph = {
  nodes: [
    { id: "a", name: "Customer", subtype: "Data", isPersonalData: false, isPaymentData: false },
    { id: "b", name: "Order", subtype: "Document", isPersonalData: false, isPaymentData: false },
  ],
  edges: [{ id: "ab", source: "a", target: "b", cardinality: "1:n" }],
  positions: { a: { x: 0, y: 0 }, b: { x: 400, y: 0 } },
  applications: {},
  snapshot_revision: "original",
  capabilities: { can_manage_master: false },
};

it("saves an undoable route with the moved nodes and keeps it in the shared graph", async () => {
  const { result } = renderHook(() => useBoDrawing(graph, vi.fn()));
  const routed = { ...graph.edges[0], routing: "orthogonal" as const };
  const moved = { x: 15, y: 42 };
  vi.mocked(api.put).mockResolvedValue({ ...graph, edges: [routed], positions: { ...graph.positions, a: moved } });
  act(() => { result.current.setEdgeRouting("ab", "orthogonal"); });
  expect(result.current.edges).toEqual([routed]);
  act(() => { result.current.undo(); });
  expect(result.current.edges).toEqual(graph.edges);
  act(() => { result.current.redo(); result.current.move("a", moved); });
  expect(result.current.edges).toEqual([routed]);
  expect(api.put).not.toHaveBeenCalled();
  await act(async () => { expect(await result.current.save()).toBe(true); });
  expect(api.put).toHaveBeenCalledWith("/bo-relationship/layout", expect.objectContaining({
    edge_routes: { ab: "orthogonal" }, positions: { a: moved },
  }));
  expect(result.current.edges).toEqual([routed]);
  expect(result.current.hasChanges).toBe(false);
});

it("undoes a manual line edit and saves it as geometry independent of routing", async () => {
  const { result } = renderHook(() => useBoDrawing(graph, vi.fn()));
  const geometry = { bends: [{ x: 300, y: 90 }], target: { x: 20, y: 0 } };
  vi.mocked(api.put).mockResolvedValue({ ...graph, edges: [{ ...graph.edges[0], geometry }] });
  act(() => result.current.setEdgeGeometry("ab", geometry));
  expect(result.current.edges[0].geometry).toEqual(geometry);
  act(() => result.current.undo());
  expect(result.current.edges[0].geometry).toBeUndefined();
  act(() => result.current.redo());
  await act(async () => { expect(await result.current.save()).toBe(true); });
  expect(api.put).toHaveBeenCalledWith("/bo-relationship/layout", expect.objectContaining({ edge_geometry: { ab: geometry } }));
  expect(result.current.edges[0].geometry).toEqual(geometry);
});

it("restores a hidden BO with its saved position and visible links in the local drawing", () => {
  const published = { ...graph, nodes: [graph.nodes[1]], edges: [], positions: { b: graph.positions.b } };
  const { result } = renderHook(() => useBoDrawing(published, vi.fn()));
  const position = { x: 128, y: 260 };
  const applications = { master: { id: "crm", name: "CRM" }, slaves: [], unclassified: [] };
  act(() => result.current.acceptChanges([{
    id: "a", kind: "node", change: "added", revision: "restored", before: null, after: graph.nodes[0],
    placement: { position, edges: graph.edges, applications },
  }]));
  expect(result.current.positions.a).toEqual(position);
  expect(result.current.edges).toEqual(graph.edges);
  expect(result.current.applications.a).toEqual(applications);
  expect(api.put).not.toHaveBeenCalled();
  act(() => { expect(result.current.undo()).toBe(true); });
  expect(result.current.edges).toEqual([]);
  expect(result.current.applications.a).toBeUndefined();
});

it("undoes and redoes draft creation, movement, and rename in order", () => {
  const { result } = renderHook(() => useBoDrawing(graph, vi.fn()));
  let id!: string;
  act(() => { id = result.current.stageObject({ name: "Customer", subtype: "Data", isPersonalData: false, isPaymentData: false })!; });
  act(() => {
    result.current.move(id, { x: 20, y: 40 });
    expect(result.current.renameDraftObject(id, "Buyer")).toBe(true);
  });

  expect(result.current.nodes.at(-1)?.name).toBe("Buyer");
  act(() => { expect(result.current.undo()).toBe(true); });
  expect(result.current.nodes.at(-1)?.name).toBe("Customer");
  act(() => { expect(result.current.undo()).toBe(true); });
  expect(result.current.draft.moves).toEqual({});
  act(() => { expect(result.current.undo()).toBe(true); });
  expect(result.current.nodes.map((node) => node.id)).toEqual(["a", "b"]);
  act(() => {
    expect(result.current.undo()).toBe(false);
    expect(result.current.redo()).toBe(true);
    expect(result.current.redo()).toBe(true);
    expect(result.current.redo()).toBe(true);
  });
  expect(result.current.nodes.at(-1)).toMatchObject({ id, name: "Buyer" });
  expect(result.current.positions[id]).toEqual({ x: 20, y: 40 });

  act(() => {
    result.current.undo();
    result.current.move("a", { x: 40, y: 0 });
    expect(result.current.redo()).toBe(false);
  });
  expect(result.current.nodes.at(-1)?.name).toBe("Customer");
  expect(api.put).not.toHaveBeenCalled();
});

it("removes a draft object with its staged links and move as one undoable edit", () => {
  const { result } = renderHook(() => useBoDrawing(graph, vi.fn()));
  let id!: string;
  act(() => { id = result.current.stageObject({ name: "Address", subtype: "Data", isPersonalData: false, isPaymentData: false })!; });
  act(() => {
    result.current.stageRelation({ source: id, target: "a", cardinality: null });
    result.current.stageApplication({ objectId: id, application: { id: "app", name: "CRM" }, role: "unclassified" });
    result.current.move(id, { x: 20, y: 40 });
  });
  act(() => { expect(result.current.removeNodes([id])).toBe(true); });
  expect(result.current.hasChanges).toBe(false);
  expect(result.current.pendingApplications).toEqual([]);
  act(() => { expect(result.current.undo()).toBe(true); });
  expect(result.current.edges.at(-1)).toMatchObject({ source: id, target: "a" });
  expect(result.current.pendingApplications).toMatchObject([{ objectId: id }]);
  expect(result.current.positions[id]).toEqual({ x: 20, y: 40 });
  act(() => { expect(result.current.redo()).toBe(true); });
  expect(result.current.hasChanges).toBe(false);
});

it("saves hidden nodes as a visual change and clears undo history", async () => {
  vi.mocked(api.put).mockResolvedValue({ ...graph, nodes: [graph.nodes[1]], edges: [], positions: { b: graph.positions.b } });
  const { result } = renderHook(() => useBoDrawing(graph, vi.fn()));
  act(() => {
    result.current.move("a", { x: 20, y: 30 });
    expect(result.current.removeNodes(["a"])).toBe(true);
  });
  expect(result.current.nodes.map(({ id }) => id)).toEqual(["b"]);
  expect(result.current.edges).toEqual([]);
  expect(result.current.removals).toEqual([]);
  act(() => { expect(result.current.undo()).toBe(true); });
  expect(result.current.positions.a).toEqual({ x: 20, y: 30 });
  expect(result.current.edges).toEqual(graph.edges);
  act(() => { expect(result.current.redo()).toBe(true); });
  await act(async () => { expect(await result.current.save()).toBe(true); });
  expect(api.put).toHaveBeenCalledExactlyOnceWith("/bo-relationship/layout", expect.objectContaining({
    positions: {}, removed_node_ids: ["a"], removed_relation_ids: [],
  }));
  expect(api.delete).not.toHaveBeenCalled();
  act(() => { expect(result.current.undo()).toBe(false); });
  expect(result.current.hasChanges).toBe(false);
});

it("undoes the local line removal and its queue before Sync but cannot restore a synced line", async () => {
  const { result } = renderHook(() => useBoDrawing(graph, vi.fn()));
  act(() => result.current.queueRemoval(graph.edges[0], "Customer — Order"));
  expect(result.current.edges).toEqual([]);
  expect(result.current.removals).toHaveLength(1);
  act(() => { expect(result.current.undo()).toBe(true); });
  expect(result.current.edges).toEqual(graph.edges);
  expect(result.current.removals).toEqual([]);
  act(() => { expect(result.current.redo()).toBe(true); });
  await act(async () => { await result.current.syncRemovals(result.current.removals); });
  expect(api.delete).toHaveBeenCalledExactlyOnceWith("/bo-relationship/relations/ab");
  expect(result.current.removals).toEqual([]);
  act(() => { expect(result.current.undo()).toBe(false); });
  expect(result.current.edges).toEqual([]);
});

it("keeps successful draft writes available for layout retry after a Save fails", async () => {
  const input = { name: "Address", subtype: "Data", isPersonalData: false, isPaymentData: false };
  const savedObject = { ...input, id: "saved" };
  vi.mocked(api.put).mockResolvedValueOnce(savedObject).mockRejectedValueOnce(new Error("Layout failed"))
    .mockResolvedValueOnce({ ...graph, nodes: [...graph.nodes, savedObject], positions: { ...graph.positions, saved: { x: 20, y: 40 } } });
  const { result } = renderHook(() => useBoDrawing(graph, vi.fn()));
  act(() => { result.current.stageObject(input); });
  act(() => { result.current.move(result.current.nodes.at(-1)!.id, { x: 20, y: 40 }); });
  await act(async () => { expect(await result.current.save()).toBe(false); });
  act(() => { expect(result.current.undo()).toBe(false); });
  expect(result.current.nodes.at(-1)?.id).toBe("saved");
  await act(async () => { expect(await result.current.save()).toBe(true); });
  expect(vi.mocked(api.put).mock.calls.map(([path]) => path)).toEqual([
    expect.stringMatching(/^\/bo-relationship\/objects\//), "/bo-relationship/layout", "/bo-relationship/layout",
  ]);
});

it("starts a fresh history after recovery or a change in permission scope", () => {
  const { result, rerender } = renderHook(({ scope }) => useBoDrawing(graph, vi.fn(), scope), {
    initialProps: { scope: "all" },
  });
  act(() => { result.current.move("a", { x: 40, y: 50 }); });
  act(() => result.current.restoreDraft({ ...result.current.draft, moves: { a: { x: 80, y: 50 } } }, []));
  act(() => { expect(result.current.undo()).toBe(false); });
  act(() => { result.current.move("a", { x: 100, y: 50 }); });
  rerender({ scope: "restricted" });
  act(() => { expect(result.current.undo()).toBe(false); });
});

it("saves readable positions and drops moves the server had to skip", async () => {
  const graph: BoGraph = {
    nodes: [
      { id: "a", name: "Visible", subtype: "Data", isPersonalData: false, isPaymentData: false },
      { id: "b", name: "Later hidden", subtype: "Document", isPersonalData: false, isPaymentData: false },
    ],
    edges: [],
    positions: { a: { x: 0, y: 0 }, b: { x: 10, y: 10 } },
    applications: {},
    snapshot_revision: "original",
    capabilities: { can_manage_master: false },
  };
  const updated = { x: 40, y: 60 };
  vi.mocked(api.put).mockResolvedValue({
    ...graph,
    nodes: [graph.nodes[0]],
    positions: { a: updated },
    skipped_positions: 1,
  });
  const { result } = renderHook(() => useBoDrawing(graph, vi.fn()));
  act(() => {
    result.current.move("a", updated);
    result.current.move("b", { x: 50, y: 70 });
  });

  await act(async () => { expect(await result.current.save()).toBe(false); });
  expect(api.put).toHaveBeenCalledWith("/bo-relationship/layout", expect.objectContaining({
    skip_unavailable_positions: true,
    positions: { a: updated, b: { x: 50, y: 70 } },
  }));
  expect(result.current.issues).toEqual([
    expect.objectContaining({ reason: "positionUnavailable" }),
  ]);
  expect(result.current.positions).toEqual({ a: updated });
  expect(result.current.draft.moves).toEqual({});
  await act(async () => { expect(await result.current.save()).toBe(true); });
  expect(api.put).toHaveBeenCalledTimes(1);
});
