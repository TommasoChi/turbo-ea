import { act, renderHook } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { api } from "@/api/client";
import type { BoGraph } from "./BoRelationshipPage";
import { useBoDrawing } from "./useBoDrawing";

vi.mock("@/api/client", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/api/client")>(),
  api: { put: vi.fn() },
}));

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
