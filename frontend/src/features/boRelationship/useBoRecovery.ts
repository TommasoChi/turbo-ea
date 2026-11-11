import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/api/client";
import { randomUuid } from "@/lib/randomUuid";
import type { BoApplication, BoEdge, BoGraph, BoNode } from "./BoRelationshipPage";
import { hasDrawingChanges, type DrawingDraft, type InventoryChange, type BoSavedApplication } from "./useBoDrawing";
import { validBoEdgeGeometry } from "./boConnectorGeometry";

type Recovery = {
  version: 1;
  revision: string | null;
  original: { positions: BoGraph["positions"]; edges: BoEdge[] };
  draft: DrawingDraft;
  accepted: InventoryChange[];
};
type Result = {
  changes: InventoryChange[];
  object_ids: string[];
  applications: BoApplication[];
  draft_results: {
    kind: "node" | "edge" | "application_link";
    id: string;
    status: "pending" | "saved" | "published" | "unavailable";
    value: BoNode | BoEdge | BoSavedApplication | null;
  }[];
};

type StoredEntry = { key: string; raw: string };

function removeStoredEntry(entry: StoredEntry | null) {
  try {
    if (entry && localStorage.getItem(entry.key) === entry.raw) localStorage.removeItem(entry.key);
  } catch { /* Local storage is optional. */ }
}

function projectRecovery(draft: DrawingDraft, accepted: InventoryChange[], graph: BoGraph): Recovery {
  return {
    version: 1,
    revision: graph.snapshot_revision,
    original: {
      positions: Object.fromEntries(Object.keys(draft.moves)
        .filter((id) => graph.positions[id]).map((id) => [id, graph.positions[id]])),
      edges: graph.edges.filter((edge) => draft.removed.includes(edge.id)),
    },
    draft: {
      ...draft,
      objects: draft.objects.map(({ id, input }) => ({ id, input })),
      relations: draft.relations.map(({ id, input }) => ({ id, input })),
      applications: draft.applications.map(({ id, input }) => ({ id, input })),
    },
    accepted,
  };
}

export function useBoRecovery(
  graph: BoGraph | undefined,
  userId: string | undefined,
  enabled: boolean,
  draft: DrawingDraft,
  accepted: InventoryChange[],
  restore: (draft: DrawingDraft, accepted: InventoryChange[]) => void,
  busy: boolean,
  permissions: { create: boolean; relations: boolean; applications: boolean; scope: string },
) {
  const legacyKey = enabled && userId ? `turbo-ea-bo-relationship-draft-v1-${userId}` : null;
  const prefix = enabled && userId ? `turbo-ea-bo-relationship-draft-v2-${encodeURIComponent(userId)}:` : null;
  const [editorId] = useState(randomUuid);
  const key = prefix ? `${prefix}${editorId}` : null;
  const token = `${key}:${permissions.scope}:${permissions.create}:${permissions.relations}:${permissions.applications}`;
  const [candidate, setCandidate] = useState<{ token: string; draft: DrawingDraft; accepted: InventoryChange[]; changes: InventoryChange[] } | null>(null);
  const [settledToken, setSettledToken] = useState<string | null>(null);
  const visibleCandidate = candidate?.token === token ? candidate : null;
  const [checkedKey, setCheckedKey] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  const checkedEntry = useRef<StoredEntry | null>(null);
  const ownedEntry = useRef<StoredEntry | null>(null);
  const current = useRef({ draft, accepted, graph });
  current.current = { draft, accepted, graph };
  const graphReady = !!graph;
  useEffect(() => {
    let active = true;
    setCandidate(null);
    setFailed(false);
    setCheckedKey(null);
    checkedEntry.current = null;
    const shared = current.current.graph;
    if (!key || !shared) return () => { active = false; };
    setChecking(true);
    const check = async () => {
      try {
        let raw: string | null;
        let entryKey: string | null;
        try {
          entryKey = legacyKey && localStorage.getItem(legacyKey) !== null ? legacyKey :
            Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i))
              .find((item): item is string => !!item && !!prefix && item.startsWith(prefix) && item !== key) ?? null;
          raw = entryKey ? localStorage.getItem(entryKey) : null;
        } catch { if (active) setCheckedKey(key); return; }
        if (!entryKey || raw === null) { if (active) setCheckedKey(key); return; }
        const entry = { key: entryKey, raw };
        checkedEntry.current = entry;
        let stored: Recovery;
        try { stored = JSON.parse(raw) as Recovery; } catch { removeStoredEntry(entry); if (active) setRetry((n) => n + 1); return; }
        if (!stored || stored.version !== 1 || !stored.draft || !Array.isArray(stored.accepted)) { removeStoredEntry(entry); if (active) setRetry((n) => n + 1); return; }
        const d = stored.draft;
        if (!Array.isArray(d.objects) || !Array.isArray(d.relations) || !Array.isArray(d.applications) || !Array.isArray(d.removed) || !Array.isArray(d.restored) || !d.moves) { removeStoredEntry(entry); if (active) setRetry((n) => n + 1); return; }
        if (d.removedNodes !== undefined && (!Array.isArray(d.removedNodes) || d.removedNodes.some((id) => typeof id !== "string"))) {
          removeStoredEntry(entry);
          if (active) setRetry((n) => n + 1);
          return;
        }
        const operations = [...d.objects.map(({ id }) => ({ kind: "node", id })), ...d.relations.map(({ id }) => ({ kind: "edge", id })), ...d.applications.map(({ id }) => ({ kind: "application_link", id }))];
        const objectIds = [...new Set([...Object.keys(d.moves), ...d.relations.flatMap(({ input }) => [input.source, input.target]), ...d.applications.map(({ input }) => input.objectId)].filter((id) => !d.objects.some((item) => item.id === id)))];
        const [result, inventory] = await Promise.all([
          api.post<Result>("/bo-relationship/changes/draft", { removed_relation_ids: [...new Set([...d.removed, ...d.restored.map(({ id }) => id)])], draft_operations: operations, object_ids: objectIds, application_ids: d.applications.map(({ input }) => input.application.id) }),
          api.get<{ changes: InventoryChange[] }>("/bo-relationship/changes"),
        ]);
        if (!active) return;
        const resultsByDraft = new Map(result.draft_results.map((item) =>
          [`${item.kind}:${item.id}`, item] as const));
        const status = (kind: Result["draft_results"][number]["kind"], id: string) =>
          resultsByDraft.get(`${kind}:${id}`);
        const aliases = new Map(d.objects.flatMap((item) => {
          const operation = status("node", item.id);
          return operation?.status === "published" && operation.value
            ? [[item.id, operation.value.id] as const] : [];
        }));
        const resolve = (id: string) => aliases.get(id) ?? id;
        const resolveMove = (id: string) => {
          const operation = status("node", id);
          return operation?.value && (operation.status === "saved" || operation.status === "published")
            ? operation.value.id : resolve(id);
        };
        const objects = d.objects.flatMap((item) => {
          const operation = status("node", item.id);
          if (!operation || !((operation.status === "saved" && operation.value)
            || (operation.status === "pending" && permissions.create))) return [];
          return [{ id: item.id, input: item.input,
            ...(operation.value ? { saved: operation.value as BoNode } : {}) }];
        });
        const validObject = (id: string) => objects.some((item) => item.id === id)
          || aliases.has(id) || result.object_ids.includes(id);
        const relations = d.relations.flatMap((item) => {
          const operation = status("edge", item.id);
          if (!operation || operation.status === "unavailable" || operation.status === "published"
            || (operation.status === "pending" && !permissions.relations)
            || !validObject(item.input.source) || !validObject(item.input.target)) return [];
          return [{ id: item.id,
            input: { ...item.input, source: resolve(item.input.source), target: resolve(item.input.target) },
            ...(operation.value ? { saved: operation.value as BoEdge } : {}) }];
        });
        const applications = d.applications.flatMap((item) => {
          const operation = status("application_link", item.id);
          const app = result.applications.find(({ id }) => id === item.input.application.id);
          const mayCreate = permissions.applications
            && (item.input.role !== "master" || shared.capabilities.can_manage_master);
          if (!operation || operation.status === "unavailable" || operation.status === "published"
            || (operation.status === "pending" && !mayCreate)
            || !validObject(item.input.objectId) || !app) return [];
          return [{ id: item.id, input: { ...item.input, objectId: resolve(item.input.objectId), application: app },
            ...(operation.value ? { saved: operation.value as BoSavedApplication } : {}) }];
        });
        const moves = Object.fromEntries(Object.entries(d.moves)
          .filter(([id, point]) => validObject(id) && point && Number.isFinite(point.x)
            && Number.isFinite(point.y) && (point.x !== shared.positions[resolveMove(id)]?.x
              || point.y !== shared.positions[resolveMove(id)]?.y))
          .map(([id, point]) => [resolveMove(id), point]));
        const restored = d.restored.filter((edge) => !shared.edges.some(({ id }) => id === edge.id))
          .flatMap((edge) => result.changes.filter((change) => change.kind === "edge"
            && change.id === edge.id && change.after).map((change) => change.after as BoEdge));
        const matched = stored.accepted.flatMap((item) => inventory.changes.filter((change) =>
          change.kind === item.kind && change.id === item.id && change.revision === item.revision));
        const readableEdgeIds = new Set(shared.edges.map(({ id }) => id));
        for (const { saved } of relations) {
          if (saved) readableEdgeIds.add(saved.id);
        }
        const localEdgeIds = new Set(relations.map(({ id }) => id));
        for (const change of matched) {
          if (change.kind === "edge" && change.after) readableEdgeIds.add(change.id);
          for (const edge of change.placement?.edges ?? []) readableEdgeIds.add(edge.id);
        }
        const removed = d.removed.filter((id) => readableEdgeIds.has(id));
        const edgeRoutes = Object.fromEntries(Object.entries(d.edgeRoutes ?? {}).filter(([id, route]) =>
          (readableEdgeIds.has(id) || localEdgeIds.has(id)) && (route === "straight" || route === "orthogonal")));
        const edgeGeometry = Object.fromEntries(Object.entries(d.edgeGeometry ?? {}).filter(([id, geometry]) =>
          (readableEdgeIds.has(id) || localEdgeIds.has(id)) && validBoEdgeGeometry(geometry)));
        const visibleNodeIds = new Set(shared.nodes?.map(({ id }) => id));
        for (const change of matched) {
          if (change.kind !== "node") continue;
          if (change.after) visibleNodeIds.add(change.id);
          else visibleNodeIds.delete(change.id);
        }
        for (const { saved } of objects) {
          if (saved) visibleNodeIds.add(saved.id);
        }
        const removedNodes = d.removedNodes?.filter((id) => visibleNodeIds.has(id));
        const recovered = {
          objects, relations, applications, moves, removed, restored,
          ...(removedNodes?.length ? { removedNodes } : {}),
          ...(Object.keys(edgeRoutes).length ? { edgeRoutes } : {}),
          ...(Object.keys(edgeGeometry).length ? { edgeGeometry } : {}),
        };
        if (hasDrawingChanges(recovered, matched)) {
          const changes = result.changes.filter(({ id }) => removed.includes(id));
          setCandidate({ token, draft: recovered, accepted: matched, changes });
        } else {
          removeStoredEntry(entry);
          checkedEntry.current = null;
          setRetry((n) => n + 1);
          return;
        }
        if (active) setCheckedKey(key);
      } catch { if (active) setFailed(true); /* Keep the candidate intact for retry. */ }
      finally { if (active) { setChecking(false); setSettledToken(token); } }
    };
    void check();
    return () => { active = false; };
  }, [key, legacyKey, prefix, graphReady, permissions.create, permissions.relations, permissions.applications, permissions.scope, retry, token]);
  const clear = useCallback(() => {
    const entry = ownedEntry.current;
    if (entry?.key === key) {
      removeStoredEntry(entry);
      ownedEntry.current = null;
    }
  }, [key]);
  const persist = useCallback(() => {
    if (!key || checkedKey !== key || candidate) return;
    const { draft: currentDraft, accepted: currentAccepted, graph: currentGraph } = current.current;
    if (!currentGraph) return;
    try {
      if (!hasDrawingChanges(currentDraft, currentAccepted)) {
        clear();
      } else {
        const raw = JSON.stringify(projectRecovery(currentDraft, currentAccepted, currentGraph));
        localStorage.setItem(key, raw);
        ownedEntry.current = { key, raw };
      }
    } catch { /* Local storage is optional. */ }
  }, [key, checkedKey, candidate, clear]);
  const hasLocalChanges = hasDrawingChanges(draft, accepted);
  useEffect(() => {
    if (!key || checkedKey !== key || candidate) return;
    if (!hasLocalChanges) {
      clear();
      return;
    }
    const timer = window.setInterval(persist, 5000);
    return () => window.clearInterval(timer);
  }, [key, checkedKey, candidate, hasLocalChanges, persist, clear]);
  const wasBusy = useRef(false);
  useEffect(() => {
    if (wasBusy.current && !busy) persist();
    wasBusy.current = busy;
  });
  return {
    candidate: visibleCandidate,
    failed,
    retry: () => setRetry((n) => n + 1),
    blocked: !!key && graphReady && (checking || settledToken !== token || !!visibleCandidate || failed),
    discard: () => {
      removeStoredEntry(checkedEntry.current);
      checkedEntry.current = null;
      setCandidate(null);
      setFailed(false);
      setCheckedKey(null);
      setRetry((n) => n + 1);
    },
    apply: () => {
      if (visibleCandidate) {
        const { draft, accepted } = visibleCandidate;
        const entry = checkedEntry.current;
        const shared = current.current.graph;
        try {
          if (key && entry && shared) {
            const raw = JSON.stringify(projectRecovery(draft, accepted, shared));
            localStorage.setItem(key, raw);
            ownedEntry.current = { key, raw };
            removeStoredEntry(entry);
          }
        } catch { /* Retain the original entry if the transfer fails. */ }
        restore(draft, accepted);
      }
      setCandidate(null);
    },
    clear,
  };
}
