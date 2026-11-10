import { act, renderHook, waitFor } from "@testing-library/react";
import { useState } from "react";
import { beforeEach, expect, it, vi } from "vitest";
import { api } from "@/api/client";
import type { BoGraph } from "./BoRelationshipPage";
import type { DrawingDraft } from "./useBoDrawing";
import { useBoRecovery } from "./useBoRecovery";

vi.mock("@/api/client", () => ({ api: { get: vi.fn(), post: vi.fn() } }));
const graph = { positions: { a: { x: 0, y: 0 } }, edges: [], capabilities: { can_manage_master: false }, snapshot_revision: null } as BoGraph;
const permissions = { create: true, relations: true, applications: true, scope: "all" };
const draft = (x: number): DrawingDraft => ({ objects: [], relations: [], applications: [], moves: { a: { x, y: 0 } }, removed: [], restored: [] });
const empty: DrawingDraft = { objects: [], relations: [], applications: [], moves: {}, removed: [], restored: [] };
beforeEach(() => {
  localStorage.clear();
  vi.mocked(api.get).mockResolvedValue({ changes: [] });
  vi.mocked(api.post).mockResolvedValue({ changes: [], draft_results: [], object_ids: ["a"], applications: [] });
});
it("recovers both independent writers after they close, discarding one at a time", async () => {
  vi.useFakeTimers();
  const first = renderHook(() => useBoRecovery(graph, "editor", true, draft(1), [], vi.fn(), false, permissions));
  const second = renderHook(() => useBoRecovery(graph, "editor", true, draft(2), [], vi.fn(), false, permissions));
  await act(async () => {});
  expect(first.result.current.blocked || second.result.current.blocked).toBe(false);
  act(() => vi.advanceTimersByTime(5000));
  expect(localStorage.length).toBe(2);
  first.unmount(); second.unmount();
  vi.useRealTimers();
  const recover = renderHook(() => useBoRecovery(graph, "editor", true, empty, [], vi.fn(), false, permissions));
  await waitFor(() => expect(recover.result.current.candidate).not.toBeNull());
  const firstValue = recover.result.current.candidate!.draft.moves.a.x;
  act(() => recover.result.current.discard());
  await waitFor(() => expect(recover.result.current.candidate).not.toBeNull());
  expect([firstValue, recover.result.current.candidate!.draft.moves.a.x].sort()).toEqual([1, 2]);
});
it("keeps a source draft that another editor updated during recovery", async () => {
  const raw = JSON.stringify({ version: 1, revision: null, original: { positions: {}, edges: [] }, draft: draft(3), accepted: [] });
  const legacy = "turbo-ea-bo-relationship-draft-v1-editor";
  localStorage.setItem(legacy, raw);
  const restore = vi.fn();
  const recover = renderHook(() => useBoRecovery(graph, "editor", true, empty, [], restore, false, permissions));
  await waitFor(() => expect(recover.result.current.candidate).not.toBeNull());
  const updated = JSON.stringify({ ...JSON.parse(raw), draft: draft(5) });
  localStorage.setItem(legacy, updated);
  act(() => recover.result.current.apply());
  expect(restore).toHaveBeenCalledWith(draft(3), []);
  act(() => recover.result.current.clear());
  expect(localStorage.getItem(legacy)).toBe(updated);
});

it("offers the next draft when the legacy entry is empty", async () => {
  const legacy = "turbo-ea-bo-relationship-draft-v1-editor";
  localStorage.setItem(legacy, "");
  localStorage.setItem("turbo-ea-bo-relationship-draft-v2-editor:other", JSON.stringify({
    version: 1, revision: null, original: { positions: {}, edges: [] }, draft: draft(4), accepted: [],
  }));
  const reopened = renderHook(() => useBoRecovery(graph, "editor", true, empty, [], vi.fn(), false, permissions));
  await waitFor(() => expect(reopened.result.current.candidate?.draft.moves.a.x).toBe(4));
  expect(localStorage.getItem(legacy)).toBeNull();
});

it("does not offer a stale source after restoring, editing and saving its draft", async () => {
  const entry = (x: number) => JSON.stringify({ version: 1, revision: null, original: { positions: {}, edges: [] }, draft: draft(x), accepted: [] });
  const legacy = "turbo-ea-bo-relationship-draft-v1-editor";
  localStorage.setItem(legacy, entry(3));
  localStorage.setItem("turbo-ea-bo-relationship-draft-v2-editor:other", entry(5));
  const recover = renderHook(() => {
    const [current, restore] = useState(empty);
    return useBoRecovery(graph, "editor", true, current, [], restore, false, permissions);
  });
  await waitFor(() => expect(recover.result.current.candidate?.draft.moves.a.x).toBe(3));
  act(() => recover.result.current.apply());
  expect(localStorage.getItem(legacy)).toBeNull();
  expect(localStorage.length).toBe(2);
  act(() => recover.result.current.clear());
  recover.unmount();
  const savedGraph = { ...graph, positions: { a: { x: 4, y: 0 } } };
  const reopened = renderHook(() => useBoRecovery(savedGraph, "editor", true, empty, [], vi.fn(), false, permissions));
  await waitFor(() => expect(reopened.result.current.candidate?.draft.moves.a.x).toBe(5));
});
