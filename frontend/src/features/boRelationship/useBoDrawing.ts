import { useEffect, useMemo, useRef, useState } from "react";
import { api, ApiError } from "@/api/client";
import { randomUuid } from "@/lib/randomUuid";
import type { ConnectorRouting } from "@/lib/connectorRouting";
import type { BoApplication, BoEdge, BoGraph, BoGroup, BoNode } from "./BoRelationshipPage";
import { MAX_BO_BENDS, type BoEdgeGeometry } from "./boConnectorGeometry";
import { computeLayout } from "./boRelationshipLayout";

type Position = { x: number; y: number };
type Positions = Record<string, Position>;
export type BoObjectInput = Omit<BoNode, "id"> & { subtype: string };
export const CARDINALITIES = ["1:1", "1:n", "n:1", "n:m"] as const;
type Cardinality = (typeof CARDINALITIES)[number];
export type BoLinkInput = { source: string; target: string; cardinality: Cardinality | null };
export type BoRole = "master" | "slave" | "unclassified";
export type BoApplicationInput = { objectId: string; application: BoApplication; role: BoRole };
export type BoSavedApplication = { id: string; object_id: string; application: BoApplication; is_master: boolean };
type Draft<Input, Saved> = { id: string; input: Input; saved?: Saved };
export type DrawingDraft = {
  objects: Draft<BoObjectInput, BoNode>[];
  relations: Draft<BoLinkInput, BoEdge>[];
  applications: Draft<BoApplicationInput, BoSavedApplication>[];
  moves: Positions;
  removed: string[];
  restored: BoEdge[];
  removedNodes?: string[];
  edgeRoutes?: Record<string, ConnectorRouting>;
  edgeGeometry?: Record<string, BoEdgeGeometry | null>;
};
type Removal = { edge: BoEdge; label: string; error?: string };
type SaveIssue = {
  id: string;
  names: string[];
  reason: "saveFailed" | "waitingForObject" | "waitingForMaster" | "draftUnavailable"
    | "visualChangeUnavailable" | "inventoryConflict" | "positionUnavailable";
  detail?: string;
  discardable?: boolean;
};
export type InventoryChange = {
  kind: "node" | "edge" | "application_link";
  id: string;
  revision: string;
  change: "added" | "updated" | "removed";
  before: BoNode | BoEdge | BoSavedApplication | null;
  after: BoNode | BoEdge | BoSavedApplication | null;
  placement?: { position: Position; edges: BoEdge[]; applications: BoGroup } | null;
};
type LayoutDraft = { kind: "node" | "edge" | "application_link"; id: string };
type LayoutResult = BoGraph & {
  unavailable_drafts?: LayoutDraft[];
  inventory_conflicts?: LayoutDraft[];
  skipped_positions?: number;
};
type OnSave = (aliases: Map<string, string>, savedLayout: BoGraph | undefined, updatedApplicationObjects: string[]) => void;
type LocalDrawing = {
  draft: DrawingDraft;
  removals: Removal[];
  accepted: InventoryChange[];
  syncAnchors: Positions;
  issues: SaveIssue[];
};
const HISTORY_LIMIT = 50;

const emptyDraft: DrawingDraft = {
  objects: [], relations: [], applications: [], moves: {}, removed: [], restored: [],
};

function resolveId(draft: DrawingDraft, id: string) {
  const object = draft.objects.find((item) => item.id === id);
  return object ? object.saved?.id : id;
}

function orientGeometry(draft: DrawingDraft, item: DrawingDraft["relations"][number], geometry: BoEdgeGeometry | null) {
  if (!geometry || !item.saved || resolveId(draft, item.input.source) !== item.saved.target) return geometry;
  return { bends: [...geometry.bends].reverse(), source: geometry.target, target: geometry.source };
}

function failureDetail(error: unknown) {
  return error instanceof Error ? error.message : undefined;
}

function discardLocalDrafts(draft: DrawingDraft, objectIds: Set<string>, discarded: Set<string>) {
  const moves = { ...draft.moves };
  for (const id of objectIds) delete moves[id];
  for (const { id, input } of draft.relations) {
    if (objectIds.has(input.source) || objectIds.has(input.target)) discarded.add(id);
  }
  for (const { id, input } of draft.applications) {
    if (objectIds.has(input.objectId)) discarded.add(id);
  }
  return {
    ...draft,
    moves,
    ...(draft.edgeRoutes ? { edgeRoutes: Object.fromEntries(Object.entries(draft.edgeRoutes).filter(([id]) => !discarded.has(id))) } : {}),
    ...(draft.edgeGeometry ? { edgeGeometry: Object.fromEntries(Object.entries(draft.edgeGeometry).filter(([id]) => !discarded.has(id))) } : {}),
    objects: draft.objects.filter(({ id }) => !objectIds.has(id)),
    relations: draft.relations.filter(({ id }) => !discarded.has(id)),
    applications: draft.applications.filter(({ id }) => !discarded.has(id)),
  };
}

export function useBoDrawing(initialGraph: BoGraph | undefined, onSaved: OnSave, scope?: string) {
  const [savedGraph, setSavedGraph] = useState<{ base: BoGraph | undefined; result: BoGraph }>();
  // Render the committed response immediately. The next scoped graph read
  // supersedes it so changes in scope are reflected in the open editor.
  const graph = savedGraph && savedGraph.base === initialGraph ? savedGraph.result : initialGraph;
  useEffect(() => {
    setSavedGraph((current) => current?.base === initialGraph ? current : undefined);
  }, [initialGraph]);
  const [local, setLocal] = useState<LocalDrawing>({
    draft: emptyDraft, removals: [], accepted: [], syncAnchors: {}, issues: [],
  });
  const { accepted, syncAnchors, draft, removals, issues } = local;
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  // Each command reads the latest snapshot, even if several commands run
  // before React commits a render.
  const current = useRef(local);
  const history = useRef<{ undo: LocalDrawing[]; redo: LocalDrawing[] }>({ undo: [], redo: [] });

  useEffect(() => {
    history.current = { undo: [], redo: [] };
  }, [initialGraph, scope]);

  const updateLocal = (next: LocalDrawing) => {
    current.current = next;
    setLocal(next);
  };
  const edit = (change: (previous: LocalDrawing) => LocalDrawing) => {
    if (lock.current) return false;
    const previous = current.current;
    const next = change(previous);
    if (previous === next) return false;
    const { undo } = history.current;
    history.current = { undo: [...undo.slice(1 - HISTORY_LIMIT), previous], redo: [] };
    updateLocal(next);
    return true;
  };
  const stepHistory = (direction: "undo" | "redo") => {
    if (lock.current) return false;
    const snapshot = history.current[direction].pop();
    if (!snapshot) return false;
    history.current[direction === "undo" ? "redo" : "undo"].push(current.current);
    updateLocal(snapshot);
    return true;
  };

  const placements = useMemo(() => accepted.flatMap(({ kind, id, after, placement }) =>
    kind === "node" && after && placement ? [{ id, placement }] : []), [accepted]);

  const drawing = useMemo(() => {
    const allNodes = new Map(graph?.nodes.map((node) => [node.id, node]));
    for (const change of accepted.filter((item) => item.kind === "node")) {
      if (change.after) allNodes.set(change.id, change.after as BoNode);
      else allNodes.delete(change.id);
    }
    for (const { id, input, saved } of draft.objects) {
      const node = saved ?? { id, ...input };
      allNodes.set(node.id, node);
    }
    for (const id of draft.removedNodes ?? []) allNodes.delete(id);
    const allEdges = new Map(graph?.edges.map((edge) => [edge.id, edge]));
    for (const { placement } of placements) {
      for (const edge of placement.edges) {
        if (!allEdges.has(edge.id)) allEdges.set(edge.id, edge);
      }
    }
    for (const edge of draft.restored) allEdges.set(edge.id, edge);
    for (const change of accepted.filter((item) => item.kind === "edge")) {
      const before = allEdges.get(change.id);
      if (change.after) allEdges.set(change.id, { ...before, ...change.after as BoEdge });
      else allEdges.delete(change.id);
    }
    for (const { id, input, saved } of draft.relations) {
      const edge = saved ?? {
        id, ...input,
        source: resolveId(draft, input.source) ?? input.source,
        target: resolveId(draft, input.target) ?? input.target,
      };
      allEdges.set(edge.id, edge);
    }
    const removedIds = new Set([...draft.removed, ...removals.map(({ edge }) => edge.id)]);
    const nodes = [...allNodes.values()];
    const routes = new Map(Object.entries(draft.edgeRoutes ?? {}));
    const geometry = new Map(Object.entries(draft.edgeGeometry ?? {}));
    for (const relation of draft.relations) {
      const { id, saved } = relation;
      if (!saved) continue;
      const routing = routes.get(id);
      const shape = geometry.get(id);
      if (routing) routes.set(saved.id, routing);
      if (shape !== undefined && !geometry.has(saved.id)) geometry.set(saved.id, orientGeometry(draft, relation, shape));
    }
    const edges = [...allEdges.values()]
      .filter((edge) => !removedIds.has(edge.id) && allNodes.has(edge.source) && allNodes.has(edge.target))
      .map((edge) => ({
        ...edge,
        ...(routes.has(edge.id) ? { routing: routes.get(edge.id) } : {}),
        ...(geometry.has(edge.id) ? { geometry: geometry.get(edge.id) } : {}),
      }));
    const priorPositions = Object.fromEntries(placements.map(({ id, placement }) => [id, placement.position]));
    const positions = computeLayout(nodes, edges, { ...priorPositions, ...graph?.positions, ...syncAnchors, ...draft.moves });
    return { nodes, edges, positions };
  }, [accepted, draft, graph, placements, removals, syncAnchors]);

  const restoreDraft = (recovered: DrawingDraft, recoveredAccepted: InventoryChange[]) => {
    if (lock.current) return;
    history.current = { undo: [], redo: [] };
    updateLocal({ draft: recovered, accepted: recoveredAccepted, syncAnchors: {}, removals: [], issues: [] });
  };

  const acceptChanges = (changes: InventoryChange[]) => edit((previous) => {
    const outgoing = new Set(previous.removals.map(({ edge }) => edge.id));
    const allowed = changes.filter((item) => item.kind !== "edge" || !outgoing.has(item.id));
    if (!allowed.length) return previous;
    const restoredIds = new Set(allowed.filter((item) => item.kind === "edge" && item.after).map(({ id }) => id));
    const merged = new Map(previous.accepted.map((item) => [`${item.kind}:${item.id}`, item]));
    for (const item of allowed) merged.set(`${item.kind}:${item.id}`, item);
    return {
      ...previous,
      draft: { ...previous.draft, removed: previous.draft.removed.filter((id) => !restoredIds.has(id)) },
      syncAnchors: { ...previous.syncAnchors, ...drawing.positions },
      accepted: [...merged.values()],
    };
  });
  const applications = useMemo(() => {
    const priorGroups = Object.fromEntries(placements.map(({ id, placement }) => [id, placement.applications]));
    const groups = structuredClone({ ...priorGroups, ...graph?.applications });
    for (const change of accepted.filter((item) => item.kind === "application_link")) {
      const before = change.before as BoSavedApplication | null;
      const after = change.after as BoSavedApplication | null;
      if (before) {
        const group = groups[before.object_id];
        if (group) {
          if (group.master?.id === before.application.id) group.master = null;
          group.slaves = group.slaves.filter(({ id }) => id !== before.application.id);
          group.unclassified = group.unclassified.filter(({ id }) => id !== before.application.id);
        }
      }
      if (after) {
        const group = groups[after.object_id] ??= { master: null, slaves: [], unclassified: [] };
        if (after.is_master) {
          if (group.master && group.master.id !== after.application.id) group.slaves.push(group.master);
          group.master = after.application;
        } else if (group.master) group.slaves.push(after.application);
        else group.unclassified.push(after.application);
      }
    }
    for (const group of Object.values(groups)) {
      const others = new Map([...group.slaves, ...group.unclassified]
        .filter(({ id }) => id !== group.master?.id).map((app) => [app.id, app]));
      group.slaves = group.master ? [...others.values()] : [];
      group.unclassified = group.master ? [] : [...others.values()];
    }
    return groups;
  }, [accepted, graph, placements]);

  const stageObject = (input: BoObjectInput) => {
    const id = randomUuid();
    const staged = edit((previous) => ({
      ...previous, draft: { ...previous.draft, objects: [...previous.draft.objects, { id, input }] },
    }));
    return staged ? id : null;
  };
  const stageRelation = (input: BoLinkInput) => {
    const id = randomUuid();
    edit((previous) => ({
      ...previous, draft: { ...previous.draft, relations: [...previous.draft.relations, { id, input }] },
    }));
  };
  const stageApplication = (input: BoApplicationInput) => {
    const id = randomUuid();
    edit((previous) => ({
      ...previous, draft: { ...previous.draft, applications: [...previous.draft.applications, { id, input }] },
    }));
  };
  const move = (id: string, point: Position) => edit((previous) => {
    const start = previous.draft.moves[id] ?? drawing.positions[id];
    if (start?.x === point.x && start.y === point.y) return previous;
    return { ...previous, draft: { ...previous.draft, moves: { ...previous.draft.moves, [id]: point } } };
  });
  const setEdgeRouting = (id: string, routing: ConnectorRouting) => edit((previous) => {
    const edge = drawing.edges.find((item) => item.id === id);
    if (!edge || ((edge.routing ?? "straight") === routing && !edge.geometry)) return previous;
    return {
      ...previous,
      draft: {
        ...previous.draft,
        edgeRoutes: { ...previous.draft.edgeRoutes, [id]: routing },
        ...(edge.geometry ? { edgeGeometry: { ...previous.draft.edgeGeometry, [id]: null } } : {}),
      },
    };
  });

  const setEdgeGeometry = (id: string, geometry: BoEdgeGeometry) => edit((previous) => {
    if (geometry.bends.length > MAX_BO_BENDS || !drawing.edges.some((edge) => edge.id === id)) return previous;
    return { ...previous, draft: { ...previous.draft, edgeGeometry: { ...previous.draft.edgeGeometry, [id]: geometry } } };
  });
  const discardDraftRelation = (id: string) => edit((previous) => {
    if (!previous.draft.relations.some((item) => item.id === id && !item.saved)) return previous;
    return {
      ...previous,
      draft: discardLocalDrafts(previous.draft, new Set(), new Set([id])),
      issues: previous.issues.filter((issue) => issue.id !== id),
    };
  });

  const discardFailedDraft = (id: string) => edit((previous) => {
    if (!previous.issues.some((issue) => issue.id === id && issue.discardable)) return previous;
    const object = previous.draft.objects.some((item) => item.id === id && !item.saved);
    const application = previous.draft.applications.some((item) => item.id === id && !item.saved);
    if (!object && !application) return previous;
    const discarded = new Set([id]);
    const next = discardLocalDrafts(previous.draft, new Set(object ? [id] : []), discarded);
    return { ...previous, draft: next, issues: previous.issues.filter((issue) => !discarded.has(issue.id)) };
  });

  const removeNodes = (ids: readonly string[]) => edit((previous) => {
    const localObjects = new Map(previous.draft.objects.map((item) => [item.saved?.id ?? item.id, item]));
    const visibleIds = new Set(drawing.nodes.map(({ id }) => id));
    const objectIds = new Set<string>();
    const hiddenIds = new Set(previous.draft.removedNodes);
    const removedIds = new Set<string>();
    for (const id of ids) {
      if (hiddenIds.has(id)) continue;
      const object = localObjects.get(id);
      if (object && !object.saved) {
        // A missing response could mean the inventory write succeeded.
        if (previous.issues.some((issue) => issue.id === id && !issue.discardable)) continue;
        objectIds.add(id);
      } else if (visibleIds.has(id)) {
        hiddenIds.add(id);
      } else continue;
      removedIds.add(id);
    }
    if (!removedIds.size) return previous;
    const discarded = new Set(objectIds);
    const next = discardLocalDrafts(previous.draft, objectIds, discarded);
    for (const id of removedIds) delete next.moves[id];
    return {
      ...previous,
      draft: { ...next, ...(hiddenIds.size ? { removedNodes: [...hiddenIds] } : {}) },
      issues: previous.issues.filter((issue) => !discarded.has(issue.id)),
    };
  });
  const renameDraftObject = (id: string, name: string) => edit((previous) => {
    const object = previous.draft.objects.find((item) => item.id === id && !item.saved);
    const trimmed = name.trim();
    if (!object || !trimmed || trimmed === object.input.name
      || previous.issues.some((issue) => issue.id === id && !issue.discardable)) return previous;
    return {
      ...previous,
      draft: {
        ...previous.draft,
        objects: previous.draft.objects.map((item) => item === object
          ? { ...item, input: { ...item.input, name: trimmed } }
          : item),
      },
      issues: previous.issues.filter((issue) => issue.id !== id),
    };
  });
  const queueRemoval = (edge: BoEdge, label: string) => edit((previous) => {
    if (previous.removals.some((item) => item.edge.id === edge.id)) return previous;
    return {
      ...previous,
      removals: [...previous.removals, { edge, label }],
      draft: {
        ...previous.draft,
        removed: [...new Set([...previous.draft.removed, edge.id])],
        restored: previous.draft.restored.filter((item) => item.id !== edge.id),
      },
    };
  });
  const cancelRemoval = (edge: BoEdge) => edit((previous) => {
    if (!previous.removals.some((item) => item.edge.id === edge.id)) return previous;
    return {
      ...previous,
      removals: previous.removals.filter((item) => item.edge.id !== edge.id),
      draft: {
        ...previous.draft,
        removed: previous.draft.removed.filter((id) => id !== edge.id),
        restored: graph?.edges.some(({ id }) => id === edge.id)
          ? previous.draft.restored
          : [...previous.draft.restored, edge],
      },
    };
  });

  const syncRemovals = async (items: Removal[]) => {
    if (lock.current || items.length === 0) return;
    lock.current = true;
    history.current = { undo: [], redo: [] };
    setBusy(true);
    try {
      for (const { edge } of items) {
        try {
          await api.delete(`/bo-relationship/relations/${edge.id}`);
          const previous = current.current;
          updateLocal({
            ...previous,
            removals: previous.removals.filter((item) => item.edge.id !== edge.id),
            draft: {
              ...previous.draft,
              // Keep the confirmed deletion's receipt available to the next
              // layout Save, even if an earlier Save already hid the line.
              removed: [...new Set([...previous.draft.removed, edge.id])],
              relations: previous.draft.relations.filter((item) => item.saved?.id !== edge.id),
            },
          });
        } catch (error) {
          const previous = current.current;
          updateLocal({
            ...previous,
            removals: previous.removals.map((item) => item.edge.id === edge.id
              ? { ...item, error: failureDetail(error) ?? "" }
              : item),
          });
        }
      }
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };

  const save = async () => {
    if (!graph || lock.current) return false;
    lock.current = true;
    history.current = { undo: [], redo: [] };
    setBusy(true);
    const previous = current.current;
    const { draft, accepted } = previous;
    let pending: LocalDrawing = previous;
    const next = {
      ...draft,
      objects: draft.objects.map((item) => ({ ...item })),
      relations: draft.relations.map((item) => ({ ...item })),
      applications: draft.applications.map((item) => ({ ...item })),
    };
    let failures: SaveIssue[] = [];
    const savedDrafts: LayoutDraft[] = [];
    const attempt = async <Input, Saved,>(
      item: Draft<Input, Saved>,
      kind: LayoutDraft["kind"],
      names: string[],
      request: () => Promise<Saved>,
    ) => {
      try {
        item.saved ??= await request();
        savedDrafts.push({ kind, id: item.id });
      } catch (error) {
        // Only discard requests that the server definitively rejected. A lost
        // response can follow a successful write and needs the same-ID retry.
        const discardable = kind !== "edge" && error instanceof ApiError
          && [400, 403, 404, 409, 422].includes(error.status);
        failures.push({
          id: item.id, names, reason: "saveFailed", detail: failureDetail(error), discardable,
        });
      }
    };
    const nodeNames = new Map(drawing.nodes.map(({ id, name }) => [id, name]));
    const namesFor = (...ids: string[]) => ids.map((id) => nodeNames.get(id) ?? "");
    const aliases = new Map<string, string>();
    let savedLayout: BoGraph | undefined;
    try {
      for (const item of next.objects) {
        await attempt(item, "node", [item.input.name], () => api.put(
          `/bo-relationship/objects/${item.id}`, item.input,
        ));
        if (item.saved) aliases.set(item.id, item.saved.id);
      }
      for (const item of next.relations) {
        const { source, target, cardinality } = item.input;
        const sourceId = resolveId(next, source);
        const targetId = resolveId(next, target);
        const names = namesFor(source, target);
        if (!sourceId || !targetId) {
          failures.push({ id: item.id, names, reason: "waitingForObject" });
          continue;
        }
        await attempt(item, "edge", names, () => api.put(
          `/bo-relationship/relation-drafts/${item.id}`,
          { source_id: sourceId, target_id: targetId, ...(cardinality ? { cardinality } : {}) },
        ));
      }
      // Master operations run first so their dependent Slave links can use
      // the committed designation. Independent BOs continue after a failure.
      const failedMasters = new Set<string>();
      const masters = next.applications.filter((item) => item.input.role === "master");
      const otherLinks = next.applications.filter((item) => item.input.role !== "master");
      for (const item of [...masters, ...otherLinks]) {
        const { objectId, application, role } = item.input;
        const resolved = resolveId(next, objectId);
        const names = [...namesFor(objectId), application.name];
        if (!resolved) {
          failures.push({ id: item.id, names, reason: "waitingForObject" });
          continue;
        }
        if (!item.saved && role === "slave" && failedMasters.has(resolved)) {
          failures.push({ id: item.id, names, reason: "waitingForMaster" });
          continue;
        }
        await attempt(item, "application_link", names, () => api.put(
          `/bo-relationship/application-link-drafts/${item.id}`,
          { object_id: resolved, application_id: application.id, role },
        ));
        if (!item.saved && role === "master") failedMasters.add(resolved);
      }

      const positions: Positions = {};
      const autoPositions: Positions = {};
      const unsavedMoves: Positions = {};
      const suppressedMoves: Positions = {};
      const removedNodes = new Set(accepted.filter((item) => item.kind === "node" && !item.after).map(({ id }) => id));
      for (const [id, point] of Object.entries(draft.moves)) {
        if (removedNodes.has(id)) {
          suppressedMoves[id] = point;
          continue;
        }
        const resolved = resolveId(next, id);
        if (resolved) positions[resolved] = point;
        else unsavedMoves[id] = point;
      }
      for (const { id } of drawing.nodes) {
        const resolved = resolveId(next, id);
        if (resolved && !graph.positions[resolved] && !positions[resolved]) {
          autoPositions[resolved] = drawing.positions[id];
        }
      }
      next.moves = { ...positions, ...unsavedMoves, ...suppressedMoves };
      const resolveEdgeUpdates = <Value,>(updates: Record<string, Value> | undefined,
        orient?: (draft: DrawingDraft, item: DrawingDraft["relations"][number], value: Value) => Value) => {
        const savedUpdates: Record<string, Value> = {};
        const pendingUpdates: Record<string, Value> = {};
        for (const [id, value] of Object.entries(updates ?? {})) {
          const staged = next.relations.find((item) => item.id === id);
          const resolved = staged ? staged.saved?.id : id;
          if (!resolved) pendingUpdates[id] = value;
          else if (!draft.removed.includes(resolved)) savedUpdates[resolved] = staged && orient ? orient(next, staged, value) : value;
        }
        return [savedUpdates, pendingUpdates] as const;
      };
      const [edgeRoutes, pendingRoutes] = resolveEdgeUpdates(draft.edgeRoutes);
      const [edgeGeometry, pendingGeometry] = resolveEdgeUpdates(draft.edgeGeometry, orientGeometry);
      const visualEdgeIds = [...Object.keys(edgeRoutes), ...Object.keys(edgeGeometry)];
      if (accepted.length || savedDrafts.length || draft.removed.length || draft.restored.length || draft.removedNodes?.length
        || Object.keys(positions).length || Object.keys(autoPositions).length || visualEdgeIds.length) {
        const result = await api.put<LayoutResult>("/bo-relationship/layout", {
          snapshot_revision: graph.snapshot_revision,
          saved_drafts: savedDrafts,
          accepted_inventory_changes: accepted.map(({ kind, id, revision }) => ({ kind, id, revision })),
          positions,
          auto_positions: autoPositions,
          skip_unavailable_positions: true,
          removed_relation_ids: draft.removed,
          restored_relation_ids: draft.restored.map(({ id }) => id),
          skip_unavailable_relations: true,
          ...(draft.removedNodes?.length ? { removed_node_ids: draft.removedNodes } : {}),
          ...(Object.keys(edgeRoutes).length ? { edge_routes: edgeRoutes } : {}),
          ...(Object.keys(edgeGeometry).length ? { edge_geometry: edgeGeometry } : {}),
        });
        savedLayout = result;
        const unavailable = result.unavailable_drafts ?? [];
        const unavailableNodes = new Set(unavailable.flatMap(({ kind, id }) => {
          if (kind !== "node") return [];
          const resolved = aliases.get(id);
          return resolved ? [id, resolved] : [id];
        }));
        const pendingObjects = next.objects.filter((item) => !item.saved);
        const pendingRelations = next.relations.filter(({ saved, input }) =>
          !saved && !unavailableNodes.has(input.source) && !unavailableNodes.has(input.target));
        const pendingApplications = next.applications.filter(({ saved, input }) =>
          !saved && !unavailableNodes.has(input.objectId));
        if (unavailable.length) {
          const pendingIds = new Set(
            [...pendingObjects, ...pendingRelations, ...pendingApplications].map(({ id }) => id),
          );
          failures = failures.filter(({ id }) => pendingIds.has(id));
          failures.push({ id: "unavailable", names: [], reason: "draftUnavailable" });
        }
        if (result.skipped_positions) {
          failures.push({ id: "positions", names: [], reason: "positionUnavailable" });
        }
        const visualChanges = new Set([...draft.removed, ...draft.restored.map(({ id }) => id), ...visualEdgeIds]);
        if (result.inventory_conflicts?.some(({ kind, id }) =>
          (kind === "edge" && visualChanges.has(id)) || (kind === "node" && draft.removedNodes?.includes(id)))) {
          failures.push({ id: "visual", names: [], reason: "visualChangeUnavailable" });
        }
        const conflicts = new Set((result.inventory_conflicts ?? []).map(({ kind, id }) => `${kind}:${id}`));
        if (accepted.some(({ kind, id }) => conflicts.has(`${kind}:${id}`))) {
          failures.push({ id: "inventory", names: [], reason: "inventoryConflict" });
        }
        const visibleNodes = new Set(result.nodes.map(({ id }) => id));
        for (const [id, point] of Object.entries(suppressedMoves)) {
          if (visibleNodes.has(id) && conflicts.has(`node:${id}`)) unsavedMoves[id] = point;
        }
        setSavedGraph({ base: initialGraph, result });
        pending = {
          ...previous,
          accepted: [],
          syncAnchors: {},
          draft: {
            objects: pendingObjects,
            relations: pendingRelations.map((item) => ({
              ...item,
              input: {
                ...item.input,
                source: aliases.get(item.input.source) ?? item.input.source,
                target: aliases.get(item.input.target) ?? item.input.target,
              },
            })),
            applications: pendingApplications.map((item) => ({
              ...item,
              input: { ...item.input, objectId: aliases.get(item.input.objectId) ?? item.input.objectId },
            })),
            moves: unsavedMoves,
            removed: [],
            restored: [],
            ...(Object.keys(pendingRoutes).length ? { edgeRoutes: pendingRoutes } : {}),
            ...(Object.keys(pendingGeometry).length ? { edgeGeometry: pendingGeometry } : {}),
          },
        };
      } else {
        pending = { ...previous, draft: next };
      }
    } catch (error) {
      failures.push({ id: "layout", names: [], reason: "saveFailed", detail: failureDetail(error) });
      pending = { ...previous, draft: next };
    } finally {
      updateLocal({ ...pending, issues: failures });
      onSaved(
        aliases, savedLayout,
        next.applications.flatMap(({ saved }) => saved ? [saved.object_id] : []),
      );
      lock.current = false;
      setBusy(false);
    }
    return failures.length === 0;
  };

  return {
    graph, ...drawing, draft, restoreDraft, applications, accepted, acceptChanges, removedIds: draft.removed, busy, issues, removals, save, syncRemovals,
    hasChanges: !!(accepted.length || draft.objects.length || draft.relations.length || draft.applications.length
      || draft.removed.length || draft.restored.length || draft.removedNodes?.length || Object.keys(draft.moves).length
      || Object.keys(draft.edgeRoutes ?? {}).length || Object.keys(draft.edgeGeometry ?? {}).length
      || drawing.nodes.some(({ id }) => !graph?.positions[id])),
    pendingApplications: draft.applications.map(({ input }) => ({
      ...input, objectId: resolveId(draft, input.objectId) ?? input.objectId,
    })),
    isDraftObject: (id: string) => draft.objects.some((item) => item.id === id && !item.saved),
    stageObject, stageRelation, stageApplication, move, setEdgeRouting, setEdgeGeometry, discardDraftRelation, discardFailedDraft,
    queueRemoval, cancelRemoval, removeNodes, renameDraftObject,
    canUndo: history.current.undo.length > 0, canRedo: history.current.redo.length > 0,
    undo: () => stepHistory("undo"), redo: () => stepHistory("redo"),
  };
}
