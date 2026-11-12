/**
 * What `useBoRecovery` keeps of a stored draft: the request it sends, and the rule for each
 * part of the draft (objects, relations, applications, moves, removals, routes, hidden nodes).
 */
import { act, renderHook, waitFor } from "@testing-library/react";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "@/api/client";
import type { BoGraph } from "./BoRelationshipPage";
import { useBoRecovery } from "./useBoRecovery";

vi.mock("@/api/client", () => ({ api: { get: vi.fn(), post: vi.fn() } }));

type Loose = Record<string, unknown>;

const LEGACY = "turbo-ea-bo-relationship-draft-v1-editor";
const ALL = { create: true, relations: true, applications: true, scope: "all" };
const EMPTY = { objects: [], relations: [], applications: [], moves: {}, removed: [], restored: [] };
const GRAPH = {
  positions: { a: { x: 0, y: 0 }, b: { x: 5, y: 5 } },
  edges: [{ id: "e-shared", source: "a", target: "b" }],
  nodes: [{ id: "a" }, { id: "b" }],
  capabilities: { can_manage_master: false },
  snapshot_revision: null,
} as unknown as BoGraph;
const APP = { id: "app-1", name: "CRM" };
const RESULT = { changes: [], draft_results: [], object_ids: ["a", "b"], applications: [APP] };

const store = (draft: Loose, accepted: Loose[] = [], key = LEGACY) =>
  localStorage.setItem(key, JSON.stringify({ version: 1, draft: { ...EMPTY, ...draft }, accepted }));

function mount(options: { graph?: BoGraph | undefined; permissions?: typeof ALL; user?: string | undefined; enabled?: boolean } = {}) {
  const restore = vi.fn();
  const graph = "graph" in options ? options.graph : GRAPH;
  const user = "user" in options ? options.user : "editor";
  const hook = renderHook(() =>
    useBoRecovery(graph, user, options.enabled ?? true, EMPTY as never, [], restore, false, options.permissions ?? ALL),
  );
  return { hook, restore };
}

/** As the page does it: the restored draft becomes the editor's own. */
async function recoveredIntoEditor() {
  const restore = vi.fn();
  const hook = renderHook(() => {
    const [draft, setDraft] = useState(EMPTY as never);
    return useBoRecovery(GRAPH, "editor", true, draft, [], (next) => { restore(next); setDraft(next as never); }, false, ALL);
  });
  await waitFor(() => expect(hook.result.current.candidate).not.toBeNull());
  return { hook, restore };
}

/** Mounts, waits for the offer and returns the recovered draft. */
async function recovered(options: Parameters<typeof mount>[0] = {}) {
  const { hook, restore } = mount(options);
  await waitFor(() => expect(hook.result.current.candidate).not.toBeNull());
  return { hook, restore, draft: hook.result.current.candidate!.draft as unknown as Loose, candidate: hook.result.current.candidate! };
}

/** Mounts and waits for the check to settle with nothing to offer. */
async function nothingOffered(options: Parameters<typeof mount>[0] = {}) {
  const { hook } = mount(options);
  await waitFor(() => expect(hook.result.current.blocked).toBe(false));
  expect(hook.result.current.candidate).toBeNull();
  return hook;
}

const post = (result: Loose) => vi.mocked(api.post).mockResolvedValue({ ...RESULT, ...result });
const op = (kind: string, id: string, status: string, value: Loose | null = null) => ({ kind, id, status, value });
const object = (id: string) => ({ id, input: { name: id, subtype: "data" } });
const relation = (id: string, source: string, target: string) => ({ id, input: { source, target, cardinality: null } });
const application = (id: string, objectId: string, role = "slave") => ({
  id,
  input: { objectId, application: { id: "app-1", name: "stale name" }, role },
});

beforeEach(() => {
  localStorage.clear();
  vi.mocked(api.get).mockReset().mockResolvedValue({ changes: [] });
  vi.mocked(api.post).mockReset().mockResolvedValue(RESULT);
});

describe("when recovery does not run", () => {
  it.each([
    ["disabled", { enabled: false }],
    ["without a user", { user: undefined }],
    ["without a drawing", { graph: undefined }],
  ])("asks nothing and blocks nothing %s", async (_label, options) => {
    store({ moves: { a: { x: 9, y: 9 } } });
    const { hook } = mount(options);
    await act(async () => {});
    expect(hook.result.current.blocked).toBe(false);
    expect(hook.result.current.candidate).toBeNull();
    expect(hook.result.current.failed).toBe(false);
    expect(api.post).not.toHaveBeenCalled();
    expect(localStorage.getItem(LEGACY)).not.toBeNull();
  });

  it("settles unblocked when nothing is stored", async () => {
    await nothingOffered();
    expect(api.post).not.toHaveBeenCalled();
    expect(api.get).not.toHaveBeenCalled();
  });

  it("reads only this user's entries", async () => {
    store({ moves: { a: { x: 9, y: 9 } } }, [], "turbo-ea-bo-relationship-draft-v2-someone-else:x");
    store({ moves: { a: { x: 9, y: 9 } } }, [], "turbo-ea-bo-relationship-draft-v1-other");
    await nothingOffered();
    expect(api.post).not.toHaveBeenCalled();
    expect(localStorage.length).toBe(2);
  });

  it("escapes the user id in the entry prefix", async () => {
    store({ moves: { a: { x: 9, y: 9 } } }, [], "turbo-ea-bo-relationship-draft-v2-a%2Fb:x");
    const { draft } = await recovered({ user: "a/b" });
    expect(draft.moves).toEqual({ a: { x: 9, y: 9 } });
  });
});

describe("a stored entry that is not a draft", () => {
  const malformed: [string, string][] = [
    ["not JSON", "{"],
    ["null", "null"],
    ["another version", JSON.stringify({ version: 2, draft: EMPTY, accepted: [] })],
    ["no draft", JSON.stringify({ version: 1, accepted: [] })],
    ["accepted not a list", JSON.stringify({ version: 1, draft: EMPTY, accepted: {} })],
    ["objects not a list", JSON.stringify({ version: 1, draft: { ...EMPTY, objects: {} }, accepted: [] })],
    ["relations not a list", JSON.stringify({ version: 1, draft: { ...EMPTY, relations: {} }, accepted: [] })],
    ["applications not a list", JSON.stringify({ version: 1, draft: { ...EMPTY, applications: {} }, accepted: [] })],
    ["removed not a list", JSON.stringify({ version: 1, draft: { ...EMPTY, removed: {} }, accepted: [] })],
    ["restored not a list", JSON.stringify({ version: 1, draft: { ...EMPTY, restored: {} }, accepted: [] })],
    ["no moves", JSON.stringify({ version: 1, draft: { ...EMPTY, moves: null }, accepted: [] })],
    ["removedNodes not a list", JSON.stringify({ version: 1, draft: { ...EMPTY, removedNodes: "a" }, accepted: [] })],
    ["removedNodes holding a number", JSON.stringify({ version: 1, draft: { ...EMPTY, removedNodes: ["a", 1] }, accepted: [] })],
  ];

  it.each(malformed)("is deleted and never sent: %s", async (_label, raw) => {
    localStorage.setItem(LEGACY, raw);
    await nothingOffered();
    expect(localStorage.getItem(LEGACY)).toBeNull();
    expect(api.post).not.toHaveBeenCalled();
  });

  it("is deleted when nothing in it can still be recovered", async () => {
    store({ moves: { a: { x: 0, y: 0 } } }); // the drawing already has it there
    await nothingOffered();
    expect(localStorage.getItem(LEGACY)).toBeNull();
    expect(api.post).toHaveBeenCalledTimes(1);
  });
});

describe("the request", () => {
  it("names every staged change, each id once", async () => {
    post({ draft_results: [op("node", "n1", "pending")] });
    store({
      objects: [object("n1")],
      relations: [relation("r1", "n1", "a"), relation("r2", "a", "b")],
      applications: [application("l1", "b"), application("l2", "n1")],
      moves: { a: { x: 1, y: 1 }, n1: { x: 2, y: 2 }, c: { x: 3, y: 3 } },
      removed: ["e1", "e2"],
      restored: [{ id: "e2" }, { id: "e3" }],
    });
    await recovered();
    expect(api.post).toHaveBeenCalledWith("/bo-relationship/changes/draft", {
      removed_relation_ids: ["e1", "e2", "e3"],
      draft_operations: [
        { kind: "node", id: "n1" },
        { kind: "edge", id: "r1" },
        { kind: "edge", id: "r2" },
        { kind: "application_link", id: "l1" },
        { kind: "application_link", id: "l2" },
      ],
      object_ids: ["a", "c", "b"],
      application_ids: ["app-1", "app-1"],
    });
    expect(api.get).toHaveBeenCalledWith("/bo-relationship/changes");
  });
});

describe("staged objects", () => {
  it("keeps a saved object with its value and a pending one without", async () => {
    const saved = { id: "card-1", name: "Saved" };
    post({
      draft_results: [
        op("node", "n-saved", "saved", saved),
        op("node", "n-pending", "pending"),
        op("node", "n-published", "published", { id: "card-2" }),
        op("node", "n-gone", "unavailable"),
        op("node", "n-saved-empty", "saved"),
        op("edge", "n-wrong-kind", "pending"),
      ],
    });
    store({
      objects: ["n-saved", "n-pending", "n-published", "n-gone", "n-saved-empty", "n-wrong-kind", "n-unknown"].map(object),
    });
    const { draft } = await recovered();
    expect(draft.objects).toEqual([
      { ...object("n-saved"), saved },
      object("n-pending"),
    ]);
  });

  it("drops a pending object when the user may no longer create", async () => {
    post({ draft_results: [op("node", "n1", "pending"), op("node", "n2", "saved", { id: "card-2" })] });
    store({ objects: [object("n1"), object("n2")] });
    const { draft } = await recovered({ permissions: { ...ALL, create: false } });
    expect(draft.objects).toEqual([{ ...object("n2"), saved: { id: "card-2" } }]);
  });
});

describe("staged relations", () => {
  it("keeps the ones whose both ends are still there, pointing at published objects by their card", async () => {
    const saved = { id: "edge-9", source: "a", target: "b" };
    post({
      draft_results: [
        op("node", "n-pub", "published", { id: "card-7" }),
        op("node", "n-kept", "pending"),
        op("edge", "r-pending", "pending"),
        op("edge", "r-saved", "saved", saved),
        op("edge", "r-alias", "pending"),
        op("edge", "r-local", "pending"),
        op("edge", "r-published", "published", saved),
        op("edge", "r-gone", "unavailable"),
        op("edge", "r-bad-source", "pending"),
        op("edge", "r-bad-target", "pending"),
        op("node", "r-wrong-kind", "pending"),
      ],
    });
    store({
      objects: [object("n-pub"), object("n-kept")],
      relations: [
        relation("r-pending", "a", "b"),
        relation("r-saved", "a", "b"),
        relation("r-alias", "n-pub", "a"),
        relation("r-local", "b", "n-kept"),
        relation("r-published", "a", "b"),
        relation("r-gone", "a", "b"),
        relation("r-bad-source", "ghost", "b"),
        relation("r-bad-target", "a", "ghost"),
        relation("r-wrong-kind", "a", "b"),
        relation("r-unknown", "a", "b"),
      ],
    });
    const { draft } = await recovered();
    expect(draft.relations).toEqual([
      relation("r-pending", "a", "b"),
      { ...relation("r-saved", "a", "b"), saved },
      relation("r-alias", "card-7", "a"),
      relation("r-local", "b", "n-kept"),
    ]);
  });

  it("drops a pending relation, but keeps a saved one, without the relations permission", async () => {
    const saved = { id: "edge-9", source: "a", target: "b" };
    post({ draft_results: [op("edge", "r1", "pending"), op("edge", "r2", "saved", saved)] });
    store({ relations: [relation("r1", "a", "b"), relation("r2", "a", "b")] });
    const { draft } = await recovered({ permissions: { ...ALL, relations: false } });
    expect(draft.relations).toEqual([{ ...relation("r2", "a", "b"), saved }]);
  });
});

describe("staged application links", () => {
  it("keeps the ones on a live object and a readable application, with the application as the server names it", async () => {
    const saved = { id: "link-9", object_id: "a", application: APP, is_master: false };
    post({
      draft_results: [
        op("node", "n-pub", "published", { id: "card-7" }),
        op("application_link", "l-pending", "pending"),
        op("application_link", "l-saved", "saved", saved),
        op("application_link", "l-alias", "pending"),
        op("application_link", "l-published", "published", saved),
        op("application_link", "l-gone", "unavailable"),
        op("application_link", "l-bad-object", "pending"),
        op("application_link", "l-no-app", "pending"),
        op("edge", "l-wrong-kind", "pending"),
      ],
    });
    const noApp = { id: "l-no-app", input: { objectId: "a", application: { id: "app-hidden", name: "x" }, role: "slave" } };
    store({
      objects: [object("n-pub")],
      applications: [
        application("l-pending", "a"),
        application("l-saved", "b"),
        application("l-alias", "n-pub"),
        application("l-published", "a"),
        application("l-gone", "a"),
        application("l-bad-object", "ghost"),
        noApp,
        application("l-wrong-kind", "a"),
        application("l-unknown", "a"),
      ],
    });
    const { draft } = await recovered();
    const kept = (id: string, objectId: string) => ({ id, input: { objectId, application: APP, role: "slave" } });
    expect(draft.applications).toEqual([
      kept("l-pending", "a"),
      { ...kept("l-saved", "b"), saved },
      kept("l-alias", "card-7"),
    ]);
  });

  it("drops a pending link without the applications permission", async () => {
    post({ draft_results: [op("application_link", "l1", "pending"), op("application_link", "l2", "saved", { id: "x" })] });
    store({ applications: [application("l1", "a"), application("l2", "a")] });
    const { draft } = await recovered({ permissions: { ...ALL, applications: false } });
    expect((draft.applications as Loose[]).map(({ id }) => id)).toEqual(["l2"]);
  });

  it("drops a pending Master link unless the user may manage the Master", async () => {
    post({
      draft_results: [
        op("application_link", "l-master", "pending"),
        op("application_link", "l-slave", "pending"),
        op("application_link", "l-saved-master", "saved", { id: "x" }),
      ],
    });
    const applications = [
      application("l-master", "a", "master"),
      application("l-slave", "a", "slave"),
      application("l-saved-master", "a", "master"),
    ];
    store({ applications });
    const { draft } = await recovered();
    expect((draft.applications as Loose[]).map(({ id }) => id)).toEqual(["l-slave", "l-saved-master"]);

    localStorage.clear();
    store({ applications });
    const manager = { ...GRAPH, capabilities: { can_manage_master: true } } as unknown as BoGraph;
    const second = await recovered({ graph: manager });
    expect((second.draft.applications as Loose[]).map(({ id }) => id)).toEqual([
      "l-master",
      "l-slave",
      "l-saved-master",
    ]);
  });
});

describe("moves", () => {
  it("keeps a move only for a live object, with finite coordinates, away from where it already is", async () => {
    store({
      moves: {
        a: { x: 0, y: 0 }, // unchanged
        b: { x: 5, y: 6 }, // y moved
        ghost: { x: 1, y: 1 },
      },
    });
    const { draft } = await recovered();
    expect(draft.moves).toEqual({ b: { x: 5, y: 6 } });
  });

  it("keeps a move in x alone", async () => {
    store({ moves: { b: { x: 6, y: 5 } } });
    expect((await recovered()).draft.moves).toEqual({ b: { x: 6, y: 5 } });
  });

  it.each([
    ["no point", null],
    ["an x that is not a number", { x: "1", y: 1 }],
    ["a missing y", { x: 1 }],
  ])("drops a move with %s", async (_label, point) => {
    store({ moves: { a: point, b: { x: 7, y: 7 } } });
    expect((await recovered()).draft.moves).toEqual({ b: { x: 7, y: 7 } });
  });

  it("files the move of a staged object under its card once it is saved or published", async () => {
    post({
      draft_results: [
        op("node", "n-saved", "saved", { id: "card-1" }),
        op("node", "n-pub", "published", { id: "card-2" }),
        op("node", "n-pending", "pending"),
      ],
    });
    store({
      objects: [object("n-saved"), object("n-pub"), object("n-pending")],
      moves: { "n-saved": { x: 1, y: 1 }, "n-pub": { x: 2, y: 2 }, "n-pending": { x: 3, y: 3 } },
    });
    const { draft } = await recovered();
    expect(draft.moves).toEqual({ "card-1": { x: 1, y: 1 }, "card-2": { x: 2, y: 2 }, "n-pending": { x: 3, y: 3 } });
  });

  it("compares a published object's move with the position of its card", async () => {
    post({ draft_results: [op("node", "n-pub", "published", { id: "b" })] });
    store({ objects: [object("n-pub")], moves: { "n-pub": { x: 5, y: 5 }, a: { x: 1, y: 0 } } });
    expect((await recovered()).draft.moves).toEqual({ a: { x: 1, y: 0 } });
  });
});

describe("removed and restored relations", () => {
  const after = { id: "e-old", source: "a", target: "b" };

  it("restores a relation the server still has, unless the drawing already shows it", async () => {
    post({
      changes: [
        { kind: "edge", id: "e-old", after },
        { kind: "edge", id: "e-deleted", after: null },
        { kind: "node", id: "e-node", after: { id: "e-node" } },
        { kind: "edge", id: "e-shared", after: { id: "e-shared" } },
      ],
    });
    store({ restored: [{ id: "e-old" }, { id: "e-deleted" }, { id: "e-node" }, { id: "e-shared" }, { id: "e-unknown" }] });
    const { draft } = await recovered();
    expect(draft.restored).toEqual([after]);
  });

  it("keeps a removal only for a relation the user can still see", async () => {
    const savedEdge = { id: "e-saved", source: "a", target: "b" };
    post({
      draft_results: [op("edge", "r1", "saved", savedEdge)],
      changes: [{ kind: "edge", id: "e-shared", note: "kept" }, { kind: "edge", id: "e-other" }],
    });
    vi.mocked(api.get).mockResolvedValue({
      changes: [
        { kind: "edge", id: "e-accepted", revision: "1", after: { id: "e-accepted" } },
        { kind: "edge", id: "e-accepted-gone", revision: "1", after: null },
        { kind: "node", id: "n-placed", revision: "1", after: { id: "n-placed" }, placement: { edges: [{ id: "e-placed" }] } },
        { kind: "edge", id: "e-unmatched", revision: "2", after: { id: "e-unmatched" } },
      ],
    });
    const accepted = [
      { kind: "edge", id: "e-accepted", revision: "1" },
      { kind: "edge", id: "e-accepted-gone", revision: "1" },
      { kind: "node", id: "n-placed", revision: "1" },
      { kind: "edge", id: "e-unmatched", revision: "1" },
    ];
    store(
      {
        relations: [relation("r1", "a", "b")],
        removed: ["e-shared", "e-saved", "e-accepted", "e-accepted-gone", "e-placed", "e-unmatched", "e-ghost"],
      },
      accepted,
    );
    const { draft, candidate } = await recovered();
    expect(draft.removed).toEqual(["e-shared", "e-saved", "e-accepted", "e-placed"]);
    expect(candidate.changes).toEqual([{ kind: "edge", id: "e-shared", note: "kept" }]);
    expect(candidate.accepted.map(({ id }) => id)).toEqual(["e-accepted", "e-accepted-gone", "n-placed"]);
  });

  it("matches an accepted change on kind, id and revision together", async () => {
    vi.mocked(api.get).mockResolvedValue({
      changes: [
        { kind: "edge", id: "x", revision: "1" },
        { kind: "node", id: "y", revision: "1" },
        { kind: "edge", id: "z", revision: "2" },
      ],
    });
    store({ moves: { b: { x: 9, y: 9 } } }, [
      { kind: "edge", id: "x", revision: "1" },
      { kind: "edge", id: "y", revision: "1" },
      { kind: "edge", id: "z", revision: "1" },
      { kind: "edge", id: "w", revision: "1" },
    ]);
    const { candidate } = await recovered();
    expect(candidate.accepted).toEqual([{ kind: "edge", id: "x", revision: "1" }]);
  });
});

describe("routes and geometry", () => {
  it("keeps them for a visible or a staged relation, and only in a valid form", async () => {
    post({ draft_results: [op("edge", "r1", "pending")] });
    store({
      relations: [relation("r1", "a", "b")],
      edgeRoutes: { "e-shared": "orthogonal", r1: "straight", "e-ghost": "straight", "e-bad": "curved" },
      edgeGeometry: {
        "e-shared": { bends: [{ x: 1, y: 2 }] },
        r1: null,
        "e-ghost": { bends: [] },
      },
    });
    const { draft } = await recovered();
    expect(draft.edgeRoutes).toEqual({ "e-shared": "orthogonal", r1: "straight" });
    expect(draft.edgeGeometry).toEqual({ "e-shared": { bends: [{ x: 1, y: 2 }] }, r1: null });
  });

  it("drops an invalid route or geometry of a visible relation", async () => {
    store({
      moves: { b: { x: 9, y: 9 } },
      edgeRoutes: { "e-shared": "curved" },
      edgeGeometry: { "e-shared": { bends: "x" } },
    });
    const { draft } = await recovered();
    expect(draft).toEqual({ ...EMPTY, moves: { b: { x: 9, y: 9 } } });
    expect("edgeRoutes" in draft).toBe(false);
    expect("edgeGeometry" in draft).toBe(false);
    expect("removedNodes" in draft).toBe(false);
  });

  it("offers a draft that holds nothing but a route, or nothing but a geometry", async () => {
    store({ edgeRoutes: { "e-shared": "straight" } });
    expect((await recovered()).draft).toEqual({ ...EMPTY, edgeRoutes: { "e-shared": "straight" } });
    localStorage.clear();
    store({ edgeGeometry: { "e-shared": { bends: [] } } });
    expect((await recovered()).draft).toEqual({ ...EMPTY, edgeGeometry: { "e-shared": { bends: [] } } });
  });
});

describe("hidden objects", () => {
  it("keeps a hidden object that is in the drawing, was accepted into it or was saved by this draft", async () => {
    post({ draft_results: [op("node", "n1", "saved", { id: "card-saved" })] });
    vi.mocked(api.get).mockResolvedValue({
      changes: [
        { kind: "node", id: "n-added", revision: "1", after: { id: "n-added" } },
        { kind: "node", id: "b", revision: "1", after: null },
        { kind: "edge", id: "a", revision: "1", after: null },
      ],
    });
    store({ objects: [object("n1")], removedNodes: ["a", "b", "n-added", "card-saved", "ghost"] }, [
      { kind: "node", id: "n-added", revision: "1" },
      { kind: "node", id: "b", revision: "1" },
      { kind: "edge", id: "a", revision: "1" },
    ]);
    const { draft } = await recovered();
    expect(draft.removedNodes).toEqual(["a", "n-added", "card-saved"]);
  });

  it("recovers on a drawing that lists no nodes", async () => {
    const bare = { ...GRAPH, nodes: undefined } as unknown as BoGraph;
    store({ moves: { b: { x: 9, y: 9 } }, removedNodes: ["a"] });
    const { draft } = await recovered({ graph: bare });
    expect(draft).toEqual({ ...EMPTY, moves: { b: { x: 9, y: 9 } } });
  });
});

describe("the offer", () => {
  it("blocks the editor until it is applied, then hands the draft over and moves the entry", async () => {
    store({ moves: { b: { x: 9, y: 9 } } });
    const { hook, restore } = await recoveredIntoEditor();
    expect(hook.result.current.blocked).toBe(true);
    act(() => hook.result.current.apply());
    expect(restore).toHaveBeenCalledTimes(1);
    expect(restore).toHaveBeenCalledWith({ ...EMPTY, moves: { b: { x: 9, y: 9 } } });
    expect(hook.result.current.candidate).toBeNull();
    expect(hook.result.current.blocked).toBe(false);
    expect(localStorage.getItem(LEGACY)).toBeNull();
    expect(localStorage.length).toBe(1);
    const moved = localStorage.key(0)!;
    expect(moved.startsWith("turbo-ea-bo-relationship-draft-v2-editor:")).toBe(true);
    expect(JSON.parse(localStorage.getItem(moved)!)).toEqual({
      version: 1,
      draft: { ...EMPTY, moves: { b: { x: 9, y: 9 } } },
      accepted: [],
    });
    // `clear` drops the entry this editor now owns.
    act(() => hook.result.current.clear());
    expect(localStorage.length).toBe(0);
  });

  it("stores a staged item without its saved value", async () => {
    post({ draft_results: [op("node", "n1", "saved", { id: "card-1" })] });
    store({ objects: [object("n1")] });
    const { hook } = await recoveredIntoEditor();
    act(() => hook.result.current.apply());
    const stored = JSON.parse(localStorage.getItem(localStorage.key(0)!)!);
    expect(stored.draft.objects).toEqual([object("n1")]);
  });

  it("hands the accepted changes over with the draft, and drops the entry of a draft left empty", async () => {
    vi.mocked(api.get).mockResolvedValue({ changes: [{ kind: "edge", id: "x", revision: "1" }] });
    store({}, [{ kind: "edge", id: "x", revision: "1" }]);
    const { hook, restore } = await recovered();
    act(() => hook.result.current.apply());
    expect(restore).toHaveBeenCalledWith(EMPTY, [{ kind: "edge", id: "x", revision: "1" }]);
    // The editor here never takes the draft, so it has nothing of its own to keep.
    expect(localStorage.length).toBe(0);
  });

  it("does nothing on apply when there is no offer", async () => {
    const hook = await nothingOffered();
    const { restore } = mount();
    act(() => hook.result.current.apply());
    expect(restore).not.toHaveBeenCalled();
    expect(localStorage.length).toBe(0);
  });

  it("deletes the entry on discard and unblocks", async () => {
    store({ moves: { b: { x: 9, y: 9 } } });
    const { hook, restore } = await recovered();
    act(() => hook.result.current.discard());
    await waitFor(() => expect(hook.result.current.blocked).toBe(false));
    expect(hook.result.current.candidate).toBeNull();
    expect(localStorage.length).toBe(0);
    expect(restore).not.toHaveBeenCalled();
  });

  it("reports a failed check, keeps the entry and checks again on retry", async () => {
    vi.mocked(api.post).mockRejectedValueOnce(new Error("offline"));
    store({ moves: { b: { x: 9, y: 9 } } });
    const { hook } = mount();
    await waitFor(() => expect(hook.result.current.failed).toBe(true));
    expect(hook.result.current.blocked).toBe(true);
    expect(hook.result.current.candidate).toBeNull();
    expect(localStorage.getItem(LEGACY)).not.toBeNull();
    act(() => hook.result.current.retry());
    await waitFor(() => expect(hook.result.current.candidate).not.toBeNull());
    expect(hook.result.current.failed).toBe(false);
    expect(api.post).toHaveBeenCalledTimes(2);
  });
});
