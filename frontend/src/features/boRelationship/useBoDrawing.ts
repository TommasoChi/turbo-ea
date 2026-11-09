import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/api/client";
import { randomUuid } from "@/lib/randomUuid";
import type { BoApplication, BoEdge, BoGraph, BoNode } from "./BoRelationshipPage";
import { computeLayout } from "./boRelationshipLayout";

type Position = { x: number; y: number };
type Positions = Record<string, Position>;
export type BoObjectInput = Omit<BoNode, "id"> & { subtype: string };
export const CARDINALITIES = ["1:1", "1:n", "n:1", "n:m"] as const;
type Cardinality = (typeof CARDINALITIES)[number];
export type BoLinkInput = { source: string; target: string; cardinality: Cardinality | null };
export type BoRole = "master" | "slave" | "unclassified";
export type BoApplicationInput = { objectId: string; application: BoApplication; role: BoRole };
type BoSavedApplication = { id: string; object_id: string; application: BoApplication; is_master: boolean };
type Draft<Input, Saved> = { id: string; input: Input; saved?: Saved };
type DrawingDraft = {
  objects: Draft<BoObjectInput, BoNode>[];
  relations: Draft<BoLinkInput, BoEdge>[];
  applications: Draft<BoApplicationInput, BoSavedApplication>[];
  moves: Positions;
  removed: string[];
  restored: BoEdge[];
};
type Removal = { edge: BoEdge; label: string; error?: string };
type SaveIssue = {
  id: string;
  names: string[];
  reason: "saveFailed" | "waitingForObject" | "waitingForMaster" | "draftUnavailable" | "visualChangeUnavailable";
  detail?: string;
};
type LayoutDraft = { kind: "node" | "edge" | "application_link"; id: string };
type LayoutResult = BoGraph & {
  unavailable_drafts?: LayoutDraft[];
  inventory_conflicts?: LayoutDraft[];
};
type OnSave = (aliases: Map<string, string>, savedLayout: BoGraph | undefined, updatedApplicationObjects: string[]) => void;

const emptyDraft: DrawingDraft = {
  objects: [], relations: [], applications: [], moves: {}, removed: [], restored: [],
};

function resolveId(draft: DrawingDraft, id: string) {
  const object = draft.objects.find((item) => item.id === id);
  return object ? object.saved?.id : id;
}

function failureDetail(error: unknown) {
  return error instanceof Error ? error.message : undefined;
}

export function useBoDrawing(initialGraph: BoGraph | undefined, onSaved: OnSave) {
  const [savedGraph, setSavedGraph] = useState<{ base: BoGraph | undefined; result: BoGraph }>();
  // Render the committed response immediately. The next scoped graph read
  // supersedes it so changes in scope are reflected in the open editor.
  const graph = savedGraph && savedGraph.base === initialGraph ? savedGraph.result : initialGraph;
  useEffect(() => {
    setSavedGraph((current) => current?.base === initialGraph ? current : undefined);
  }, [initialGraph]);
  const [draft, setDraft] = useState(emptyDraft);
  const [removals, setRemovals] = useState<Removal[]>([]);
  const [issues, setIssues] = useState<SaveIssue[]>([]);
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);

  const drawing = useMemo(() => {
    const allNodes = new Map(graph?.nodes.map((node) => [node.id, node]));
    for (const { id, input, saved } of draft.objects) {
      const node = saved ?? { id, ...input };
      allNodes.set(node.id, node);
    }
    const allEdges = new Map([...(graph?.edges ?? []), ...draft.restored].map((edge) => [edge.id, edge]));
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
    const edges = [...allEdges.values()].filter((edge) => !removedIds.has(edge.id));
    const positions = computeLayout(nodes, edges, { ...graph?.positions, ...draft.moves });
    return { nodes, edges, positions };
  }, [draft, graph, removals]);

  const stageObject = (input: BoObjectInput) => {
    const id = randomUuid();
    setDraft((current) => ({ ...current, objects: [...current.objects, { id, input }] }));
    return id;
  };
  const stageRelation = (input: BoLinkInput) => {
    const id = randomUuid();
    setDraft((current) => ({ ...current, relations: [...current.relations, { id, input }] }));
  };
  const stageApplication = (input: BoApplicationInput) => {
    const id = randomUuid();
    setDraft((current) => ({ ...current, applications: [...current.applications, { id, input }] }));
  };
  const move = (id: string, point: Position) => {
    if (lock.current) return;
    setDraft((current) => ({ ...current, moves: { ...current.moves, [id]: point } }));
  };
  const discardDraftRelation = (id: string) => {
    if (!draft.relations.some((item) => item.id === id && !item.saved)) return false;
    setDraft((current) => ({ ...current, relations: current.relations.filter((item) => item.id !== id) }));
    setIssues((current) => current.filter((issue) => issue.id !== id));
    return true;
  };
  const queueRemoval = (edge: BoEdge, label: string) => {
    setRemovals((current) => current.some((item) => item.edge.id === edge.id)
      ? current
      : [...current, { edge, label }]);
    setDraft((current) => ({
      ...current,
      removed: [...new Set([...current.removed, edge.id])],
      restored: current.restored.filter((item) => item.id !== edge.id),
    }));
  };
  const cancelRemoval = (edge: BoEdge) => {
    if (lock.current) return;
    setRemovals((current) => current.filter((item) => item.edge.id !== edge.id));
    setDraft((current) => ({
      ...current,
      removed: current.removed.filter((id) => id !== edge.id),
      restored: graph?.edges.some(({ id }) => id === edge.id)
        ? current.restored
        : [...current.restored, edge],
    }));
  };

  const syncRemovals = async (items: Removal[]) => {
    if (lock.current || items.length === 0) return;
    lock.current = true;
    setBusy(true);
    try {
      for (const { edge } of items) {
        try {
          await api.delete(`/bo-relationship/relations/${edge.id}`);
          setRemovals((current) => current.filter((item) => item.edge.id !== edge.id));
          setDraft((current) => ({
            ...current,
            // Keep the confirmed deletion's receipt available to the next
            // layout Save, even if an earlier Save already hid the line.
            removed: [...new Set([...current.removed, edge.id])],
            relations: current.relations.filter((item) => item.saved?.id !== edge.id),
          }));
        } catch (error) {
          setRemovals((current) => current.map((item) => item.edge.id === edge.id
            ? { ...item, error: failureDetail(error) ?? "" }
            : item));
        }
      }
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };

  const save = async () => {
    if (!graph || lock.current) return;
    lock.current = true;
    setBusy(true);
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
        failures.push({ id: item.id, names, reason: "saveFailed", detail: failureDetail(error) });
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
      for (const [id, point] of Object.entries(draft.moves)) {
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
      next.moves = { ...positions, ...unsavedMoves };
      if (savedDrafts.length || draft.removed.length || draft.restored.length
        || Object.keys(positions).length || Object.keys(autoPositions).length) {
        const result = await api.put<LayoutResult>("/bo-relationship/layout", {
          snapshot_revision: graph.snapshot_revision,
          saved_drafts: savedDrafts,
          positions,
          auto_positions: autoPositions,
          removed_relation_ids: draft.removed,
          restored_relation_ids: draft.restored.map(({ id }) => id),
          skip_unavailable_relations: true,
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
        const visualChanges = new Set([...draft.removed, ...draft.restored.map(({ id }) => id)]);
        if (result.inventory_conflicts?.some(({ kind, id }) => kind === "edge" && visualChanges.has(id))) {
          failures.push({ id: "visual", names: [], reason: "visualChangeUnavailable" });
        }
        setSavedGraph({ base: initialGraph, result });
        setDraft({
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
        });
      } else {
        setDraft(next);
      }
    } catch (error) {
      failures.push({ id: "layout", names: [], reason: "saveFailed", detail: failureDetail(error) });
      setDraft(next);
    } finally {
      onSaved(
        aliases, savedLayout,
        next.applications.flatMap(({ saved }) => saved ? [saved.object_id] : []),
      );
      setIssues(failures);
      lock.current = false;
      setBusy(false);
    }
  };

  return {
    graph, ...drawing, busy, issues, removals, save, syncRemovals,
    hasChanges: !!(draft.objects.length || draft.relations.length || draft.applications.length
      || draft.removed.length || draft.restored.length || Object.keys(draft.moves).length
      || drawing.nodes.some(({ id }) => !graph?.positions[id])),
    pendingApplications: draft.applications.map(({ input }) => ({
      ...input, objectId: resolveId(draft, input.objectId) ?? input.objectId,
    })),
    isDraftObject: (id: string) => draft.objects.some((item) => item.id === id && !item.saved),
    stageObject, stageRelation, stageApplication, move, discardDraftRelation, queueRemoval, cancelRemoval,
  };
}
