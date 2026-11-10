import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert, Box, Button, Chip, CircularProgress, Dialog, DialogActions, DialogContent,
  DialogTitle, Stack, Typography,
} from "@mui/material";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";
import { api } from "@/api/client";
import CardDetailSidePanel from "@/components/CardDetailSidePanel";
import { FilterCheckboxList, FilterSectionHeader } from "@/components/FilterSidebarSection";
import { canReadType, hasPermission, hasTypePermission } from "@/components/RequirePermission";
import { useOptionalAuthUser } from "@/hooks/AuthContext";
import { useLatestRequest } from "@/hooks/useLatestRequest";
import { useApiQuery } from "@/hooks/useApiQuery";
import BoRelationshipDiagram from "./BoRelationshipDiagram";
import {
  BoApplicationLinkDialog, BoNewObjectDialog, BoObjectLinkDialog,
} from "./BoRelationshipEditDialogs";
import { useBoDrawing } from "./useBoDrawing";
import { useBoRecovery } from "./useBoRecovery";
import type { InventoryChange } from "./useBoDrawing";

export interface BoNode {
  id: string;
  name: string;
  subtype: string | null;
  isPersonalData: boolean;
  isPaymentData: boolean;
}
export interface BoEdge { id: string; source: string; target: string; cardinality: string | null }
export interface BoApplication { id: string; name: string }
export interface BoGroup {
  master: BoApplication | null;
  slaves: BoApplication[];
  unclassified: BoApplication[];
}
export interface BoGraph {
  nodes: BoNode[];
  edges: BoEdge[];
  positions: Record<string, { x: number; y: number }>;
  applications: Record<string, BoGroup>;
  capabilities: { can_manage_master: boolean };
  snapshot_revision: string | null;
}

export default function BoRelationshipPage() {
  const { t } = useTranslation("reports");
  const navigate = useNavigate();
  const user = useOptionalAuthUser();
  const canOpenApplications = hasTypePermission(user, "inventory.view", "Application");
  const canEdit = hasPermission(user?.permissions, "boRelationship.edit");
  const canEditRelations = canEdit && hasPermission(user?.permissions, "relations.manage");
  const canLinkApplications = canEditRelations && canReadType(user, "Application", "module");
  const canCreateObjects = canEdit && hasTypePermission(user, "inventory.create", "DataObject");
  const { data, error, loading, refetch } = useApiQuery<BoGraph>("/bo-relationship");
  const [selected, setSelected] = useState<string | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [personalData, setPersonalData] = useState(false);
  const [paymentData, setPaymentData] = useState(false);
  const [mutationError, setMutationError] = useState("");
  const [detailVersion, setDetailVersion] = useState(0);
  const [masterBusy, setMasterBusy] = useState(false);
  const [liveGroups, setLiveGroups] = useState<Record<string, BoGroup>>({});
  const [dialog, setDialog] = useState<"object" | "relation" | "application" | null>(null);
  const [confirmRemoval, setConfirmRemoval] = useState<BoEdge | null>(null);
  const [changes, setChanges] = useState<InventoryChange[]>([]);
  const [checkError, setCheckError] = useState("");
  const [checking, setChecking] = useState(false);
  const { run: runChangeCheck } = useLatestRequest();
  const graphLoaded = data !== undefined;
  const removedRef = useRef<string[]>([]);
  const checkChanges = useCallback(() => {
    setChecking(true);
    void runChangeCheck(async ({ signal, isCurrent }) => {
      try {
        const result = await api.get<{ changes: InventoryChange[] }>("/bo-relationship/changes", { signal });
        const removed = removedRef.current;
        const extra = removed.length ? await api.post<{ changes: InventoryChange[] }>("/bo-relationship/changes/draft", { removed_relation_ids: removed }) : { changes: [] };
        if (isCurrent()) { setChanges([...result.changes ?? [], ...extra.changes.filter((item) => !result.changes.some((change) => change.kind === item.kind && change.id === item.id))]); setRecoveryChanges([]); setCheckError(""); }
      } catch (error) {
        if (isCurrent()) setCheckError(error instanceof Error ? error.message : String(error));
      } finally {
        if (isCurrent()) setChecking(false);
      }
    });
  }, [runChangeCheck]);
  useEffect(() => {
    if (graphLoaded) checkChanges();
  }, [graphLoaded, checkChanges]);
  const masterLock = useRef(false);
  const latestQuery = useRef({ data, loading });
  latestQuery.current = { data, loading };
  const drawing = useBoDrawing(data, (aliases, savedLayout, updatedApplications) => {
    if (savedLayout) checkChanges();
    if (aliases.size) setSelected((id) => id ? aliases.get(id) ?? id : null);
    // A graph read already in flight may have started before this Save.
    if (savedLayout && (latestQuery.current.loading || latestQuery.current.data !== data)) refetch();
    if (updatedApplications.length) {
      setDetailVersion((n) => n + 1);
      if (savedLayout) {
        setLiveGroups((groups) => Object.fromEntries(
          Object.entries(groups).filter(([id]) => !updatedApplications.includes(id)),
        ));
      }
    }
  });
  removedRef.current = drawing.removedIds;
  const recovery = useBoRecovery(data, user?.id, canEdit, drawing.draft, drawing.accepted, drawing.restoreDraft, drawing.busy, { create: canCreateObjects, relations: canEditRelations, applications: canLinkApplications, scope: JSON.stringify(user?.permissions ?? {}) });
  const [recoveryChanges, setRecoveryChanges] = useState<InventoryChange[]>([]);
  const combinedChanges = [...changes, ...recoveryChanges.filter((item) => !changes.some((change) => change.kind === item.kind && change.id === item.id))];
  useEffect(() => {
    if (!drawing.removals.length && !drawing.draft.objects.length && !drawing.draft.relations.length && !drawing.draft.applications.length) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [drawing.removals.length, drawing.draft.objects.length, drawing.draft.relations.length, drawing.draft.applications.length]);
  const pendingChanges = combinedChanges.filter((change) =>
    !drawing.accepted.some((item) => item.kind === change.kind && item.id === change.id && item.revision === change.revision)
    && !(change.kind === "edge" && drawing.removals.some(({ edge }) => edge.id === change.id)));
  // Independent facets combine with AND, as in the approved diagram mockup.
  const visibleNodes = useMemo(() => drawing.nodes.filter((node) =>
    (!personalData || node.isPersonalData) && (!paymentData || node.isPaymentData),
  ), [drawing.nodes, personalData, paymentData]);
  const visibleIds = useMemo(() => new Set(visibleNodes.map((node) => node.id)), [visibleNodes]);
  const visibleEdges = useMemo(() => drawing.edges.filter((edge) =>
    visibleIds.has(edge.source) && visibleIds.has(edge.target),
  ), [drawing.edges, visibleIds]);
  const activeSelection = selected && visibleIds.has(selected) ? selected : null;
  const selectedNode = visibleNodes.find(({ id }) => id === activeSelection);
  const busy = drawing.busy || masterBusy || recovery.blocked;
  useEffect(() => {
    if (data && selected && !visibleIds.has(selected)) setSelected(null);
  }, [data, selected, visibleIds]);
  const canManageMaster = canEdit && (drawing.graph?.capabilities.can_manage_master ?? false);
  // Graph reloads keep the accepted drawing. The mutation returns live roles
  // for the panel without implicitly accepting inventory changes.
  const group = activeSelection
    ? (canManageMaster ? liveGroups[activeSelection] : undefined) ?? drawing.applications[activeSelection]
    : undefined;
  const pendingApplications = drawing.pendingApplications.filter(({ objectId }) => objectId === activeSelection);
  const unavailableTargets = new Set([activeSelection]);
  for (const { source, target } of [...drawing.edges, ...drawing.removals.map(({ edge }) => edge)]) {
    if (source === activeSelection) unavailableTargets.add(target);
    if (target === activeSelection) unavailableTargets.add(source);
  }
  const availableTargets = visibleNodes.filter(({ id }) => !unavailableTargets.has(id));
  const drawerSelection = activeSelection && !drawing.isDraftObject(activeSelection) ? activeSelection : null;
  const removalLabel = confirmRemoval ? t("boRelationship.relationEndpoints", {
    source: drawing.nodes.find(({ id }) => id === confirmRemoval.source)?.name,
    target: drawing.nodes.find(({ id }) => id === confirmRemoval.target)?.name,
  }) : "";

  const changeMaster = async (applicationId: string | null) => {
    if (!activeSelection || !canManageMaster || busy || masterLock.current) return;
    masterLock.current = true;
    setMasterBusy(true);
    try {
      const updated = await api.put<BoGroup>(
        `/bo-relationship/objects/${activeSelection}/master`,
        { application_id: applicationId },
      );
      setLiveGroups((groups) => ({ ...groups, [activeSelection]: updated }));
      setMutationError("");
      setDetailVersion((n) => n + 1);
      refetch();
      checkChanges();
    } catch (e) {
      setMutationError(e instanceof Error ? e.message : String(e));
    } finally {
      masterLock.current = false;
      setMasterBusy(false);
    }
  };

  const renderGroup = (label: string, entries: BoApplication[]) => (
    <Box>
      <Typography variant="subtitle2">{label}</Typography>
      {entries.map((app) => (
        <Stack direction="row" alignItems="center" key={app.id}>
          {canOpenApplications ? (
            <Typography component="a" href={`/cards/${app.id}`}>{app.name}</Typography>
          ) : (
            <Typography>{app.name}</Typography>
          )}
          {canManageMaster && app.id !== group?.master?.id && (
            <Button disabled={busy} onClick={() => void changeMaster(app.id)}>
              {t("boRelationship.setMaster")}
            </Button>
          )}
        </Stack>
      ))}
    </Box>
  );

  return (
    <Box sx={{ p: 2 }}>
      <Typography variant="h5">{t("boRelationship.title")}</Typography>
      {loading && !data && <CircularProgress />}
      {error && <Alert severity="error">{error.message}</Alert>}
      {mutationError && <Alert severity="error">{mutationError}</Alert>}
      {data && (
        <Stack direction="row" spacing={2} alignItems="stretch">
          <Box sx={{ width: 220, flexShrink: 0 }}>
            <Typography variant="h6">{t("boRelationship.applications")}</Typography>
            {!activeSelection && <Typography>{t("boRelationship.noSelection")}</Typography>}
            {activeSelection && (
              <Stack spacing={2}>
                {renderGroup(t("boRelationship.master"), group?.master ? [group.master] : [])}
                {group?.master && canManageMaster && (
                  <Button disabled={busy} onClick={() => void changeMaster(null)}>
                    {t("boRelationship.clearMaster")}
                  </Button>
                )}
                {renderGroup(t("boRelationship.slave"), group?.slaves ?? [])}
                {renderGroup(t("boRelationship.unclassified"), group?.unclassified ?? [])}
                {canEditRelations && pendingApplications.length > 0 && (
                  <Box>
                    <Typography variant="subtitle2">{t("boRelationship.pendingLinks")}</Typography>
                    {pendingApplications.map(({ application, role }) => (
                      <Typography key={application.id}>
                        {application.name} · {t(`boRelationship.${role}`)}
                      </Typography>
                    ))}
                  </Box>
                )}
              </Stack>
            )}
          </Box>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            {recovery.failed && <Alert severity="warning" action={<><Button onClick={recovery.retry}>{t("boRelationship.retryDraft")}</Button><Button onClick={recovery.discard}>{t("boRelationship.discardDraft")}</Button></>}>{t("boRelationship.draftValidationFailed")}</Alert>}
            {recovery.candidate && <Alert severity="info" action={<><Button onClick={() => { setRecoveryChanges(recovery.candidate?.changes ?? []); recovery.apply(); }}>{t("boRelationship.restoreDraft")}</Button><Button onClick={recovery.discard}>{t("boRelationship.discardDraft")}</Button></>}>{t("boRelationship.draftFound")}</Alert>}
            <Button disabled={checking} onClick={checkChanges}>{t("boRelationship.checkUpdates")}</Button>
            {checkError && <Alert severity="error">{t("boRelationship.checkFailed")} {checkError}</Alert>}
            {pendingChanges.length > 0 && (
              <Box>
                <Typography variant="subtitle2">{t("boRelationship.inventoryChanges")}</Typography>
                {pendingChanges.map((change) => {
                  const value = change.after ?? change.before;
                  const label = value && "name" in value ? value.name
                    : value && "application" in value ? value.application.name
                    : value && "source" in value
                      ? [value.source, value.target].map((id) => drawing.nodes.find((node) => node.id === id)?.name ?? id).join(" ↔ ")
                      : change.id;
                  return <Stack direction="row" spacing={1} key={`${change.kind}:${change.id}`}>
                    <Typography>{label} · {t(`boRelationship.change_${change.change}`)}</Typography>
                    {canEdit && <Button disabled={busy} onClick={() => {
                      if (change.kind === "application_link") setLiveGroups({});
                      drawing.acceptChanges([change]);
                    }}>
                      {t("boRelationship.acceptChange")}
                    </Button>}
                  </Stack>;
                })}
              </Box>
            )}
            {canEdit && (
              <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                {canCreateObjects && (
                  <Button disabled={busy} onClick={() => setDialog("object")}>{t("boRelationship.newObject")}</Button>
                )}
                {canEditRelations && (
                  <Button disabled={busy || availableTargets.length === 0 || !selectedNode} onClick={() => setDialog("relation")}>
                    {t("boRelationship.linkObjects")}
                  </Button>
                )}
                {canLinkApplications && (
                  <Button disabled={busy || !selectedNode} onClick={() => setDialog("application")}>
                    {t("boRelationship.linkApplication")}
                  </Button>
                )}
                <Button variant="contained" disabled={busy || !drawing.hasChanges} onClick={() => {
                  if (!masterLock.current) void drawing.save().then((ok) => { if (ok) recovery.clear(); });
                }}>
                  {t("common:actions.save")}
                </Button>
                <Button disabled={busy} onClick={() => void (async () => {
                  if (drawing.removals.length && !window.confirm(t("boRelationship.discardRemovalsWarning"))) return;
                  const ok = drawing.hasChanges ? await drawing.save() : true;
                  if (ok) { recovery.clear(); navigate("/"); }
                })()}>{t("boRelationship.saveAndExit")}</Button>
              </Stack>
            )}
            {canEdit && drawing.issues.length > 0 && (
              <Alert severity="warning">
                <Typography variant="subtitle2">{t("boRelationship.pendingSave")}</Typography>
                {drawing.issues.map(({ id, names, reason, detail, discardable }) => {
                  const name = names.filter(Boolean).join(" ↔ ");
                  return (
                    <Stack key={id} direction="row" spacing={1} alignItems="center">
                      <Typography variant="body2">
                        {[name, detail || t(`boRelationship.${reason}`)].filter(Boolean).join(" · ")}
                      </Typography>
                      {discardable && (
                        <Button
                          size="small"
                          disabled={busy}
                          aria-label={t("boRelationship.discardFailedDraft", { name })}
                          onClick={() => drawing.discardFailedDraft(id)}
                        >
                          {t("boRelationship.discardDraft")}
                        </Button>
                      )}
                    </Stack>
                  );
                })}
              </Alert>
            )}
            {canEditRelations && drawing.removals.length > 0 && (
              <Stack spacing={1} sx={{ my: 1 }}>
                <Stack direction="row" spacing={1} alignItems="center">
                  <Typography variant="subtitle2">{t("boRelationship.pendingRemovals")}</Typography>
                  <Button disabled={busy} onClick={() => void drawing.syncRemovals(drawing.removals)}>
                    {t("boRelationship.syncAll")}
                  </Button>
                </Stack>
                {drawing.removals.map((item) => (
                  <Box key={item.edge.id} role="group" aria-label={item.label}>
                    <Stack direction="row" spacing={1} alignItems="center">
                      <Typography variant="body2">{item.label}</Typography>
                      <Button disabled={busy} onClick={() => void drawing.syncRemovals([item])}>
                        {t("boRelationship.syncRemoval")}
                      </Button>
                      <Button disabled={busy} onClick={() => drawing.cancelRemoval(item.edge)}>
                        {t("boRelationship.cancelRemoval")}
                      </Button>
                    </Stack>
                    {item.error !== undefined && (
                      <Alert severity="error">{item.error || t("boRelationship.syncFailed")}</Alert>
                    )}
                  </Box>
                ))}
              </Stack>
            )}
            <Box
              role="button"
              tabIndex={0}
              aria-label={t("boRelationship.filters")}
              aria-expanded={filtersOpen}
              onClick={(event) => {
                if (event.target === event.currentTarget) setFiltersOpen((open) => !open);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  setFiltersOpen((open) => !open);
                }
              }}
            >
              <FilterSectionHeader
                label={t("boRelationship.filters")}
                icon="filter_list"
                expanded={filtersOpen}
                onToggle={() => setFiltersOpen((open) => !open)}
                count={Number(personalData) + Number(paymentData)}
              />
            </Box>
            {filtersOpen && <FilterCheckboxList nativeCheckboxes items={[
              { key: "personal", label: t("boRelationship.personalData"), checked: personalData, onToggle: () => setPersonalData((value) => !value) },
              { key: "payment", label: t("boRelationship.paymentData"), checked: paymentData, onToggle: () => setPaymentData((value) => !value) },
            ]} />}
            {(personalData || paymentData) && visibleNodes.length === 0 && (
              <Typography>{t("boRelationship.noFilterResults")}</Typography>
            )}
            <BoRelationshipDiagram
              nodes={visibleNodes}
              edges={visibleEdges}
              positions={drawing.positions}
              onActivate={setSelected}
              onMove={canEdit && !busy ? drawing.move : undefined}
              onRequestRemoveEdge={canEditRelations && !busy ? (id) => {
                if (drawing.discardDraftRelation(id)) return;
                const edge = visibleEdges.find((item) => item.id === id);
                if (edge) setConfirmRemoval(edge);
              } : undefined}
            />
            <Stack direction="row" spacing={1} flexWrap="wrap" sx={{ mt: 1 }}>
              {["data", "document", "legacy", "personalData", "paymentData"].map((key) => (
                <Chip key={key} size="small" label={t(`boRelationship.${key}`)} />
              ))}
            </Stack>
          </Box>
          <CardDetailSidePanel
            cardId={drawerSelection}
            open={drawerSelection !== null}
            onClose={() => setSelected(null)}
            docked
            boScoped
            refreshKey={detailVersion}
            onSaved={() => { refetch(); checkChanges(); }}
          />
        </Stack>
      )}
      {canCreateObjects && dialog === "object" && (
        <BoNewObjectDialog onClose={() => setDialog(null)} onStage={(input) => {
          setSelected(drawing.stageObject(input));
          setDialog(null);
        }} />
      )}
      {canEditRelations && dialog === "relation" && selectedNode && (
        <BoObjectLinkDialog source={selectedNode} targets={availableTargets} onClose={() => setDialog(null)} onStage={(input) => {
          drawing.stageRelation(input);
          setDialog(null);
        }} />
      )}
      {canLinkApplications && dialog === "application" && selectedNode && (
        <BoApplicationLinkDialog
          object={selectedNode}
          canManageMaster={canManageMaster}
          master={group?.master}
          pendingMaster={pendingApplications.find(({ role }) => role === "master")?.application}
          excludeIds={[
            ...(group?.master ? [group.master.id] : []),
            ...(group?.slaves ?? []).map(({ id }) => id),
            ...(group?.unclassified ?? []).map(({ id }) => id),
            ...pendingApplications.map(({ application }) => application.id),
          ]}
          onClose={() => setDialog(null)}
          onStage={(input) => {
            drawing.stageApplication(input);
            setDialog(null);
          }}
        />
      )}
      {canEditRelations && confirmRemoval && (
        <Dialog open onClose={() => setConfirmRemoval(null)} aria-labelledby="bo-remove-title">
          <DialogTitle id="bo-remove-title">{t("boRelationship.removeRelationTitle")}</DialogTitle>
          <DialogContent>
            <Typography variant="subtitle2">{removalLabel}</Typography>
            <Typography>{t("boRelationship.removeRelationDescription")}</Typography>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setConfirmRemoval(null)}>{t("boRelationship.keepLine")}</Button>
            <Button color="error" onClick={() => {
              drawing.queueRemoval(confirmRemoval, removalLabel);
              setConfirmRemoval(null);
            }}>{t("boRelationship.queueRemoval")}</Button>
          </DialogActions>
        </Dialog>
      )}
    </Box>
  );
}
