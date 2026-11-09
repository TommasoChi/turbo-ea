import { useMemo, useRef, useState } from "react";
import { Alert, Box, Button, Chip, CircularProgress, Stack, Typography } from "@mui/material";
import { useTranslation } from "react-i18next";
import { api } from "@/api/client";
import CardDetailSidePanel from "@/components/CardDetailSidePanel";
import { hasTypePermission } from "@/components/RequirePermission";
import { useOptionalAuthUser } from "@/hooks/AuthContext";
import { useApiQuery } from "@/hooks/useApiQuery";
import BoRelationshipDiagram from "./BoRelationshipDiagram";
import { computeLayout } from "./boRelationshipLayout";

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
interface BoGraph {
  nodes: BoNode[];
  edges: BoEdge[];
  positions: Record<string, { x: number; y: number }>;
  applications: Record<string, BoGroup>;
  capabilities: { can_manage_master: boolean };
  snapshot_revision: string | null;
}

export default function BoRelationshipPage() {
  const { t } = useTranslation("reports");
  const user = useOptionalAuthUser();
  const canOpenApplications = hasTypePermission(user, "inventory.view", "Application");
  const { data, error, loading, refetch } = useApiQuery<BoGraph>("/bo-relationship");
  const [selected, setSelected] = useState<string | null>(null);
  const [mutationError, setMutationError] = useState("");
  const [detailVersion, setDetailVersion] = useState(0);
  const [masterBusy, setMasterBusy] = useState(false);
  const [liveGroups, setLiveGroups] = useState<Record<string, BoGroup>>({});
  const masterLock = useRef(false);
  const positions = useMemo(
    () => data ? computeLayout(data.nodes, data.edges, data.positions) : {},
    [data],
  );
  const canManageMaster = data?.capabilities.can_manage_master ?? false;
  // Graph reloads keep the accepted drawing. The mutation returns live roles
  // for the panel without implicitly accepting inventory changes.
  const group = selected && data?.applications[selected]
    ? (canManageMaster ? liveGroups[selected] : undefined) ?? data.applications[selected]
    : undefined;

  const changeMaster = async (applicationId: string | null) => {
    if (!selected || !canManageMaster || masterLock.current) return;
    masterLock.current = true;
    setMasterBusy(true);
    try {
      const updated = await api.put<BoGroup>(
        `/bo-relationship/objects/${selected}/master`,
        { application_id: applicationId },
      );
      setLiveGroups((groups) => ({ ...groups, [selected]: updated }));
      setMutationError("");
      setDetailVersion((n) => n + 1);
      refetch();
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
            <Button disabled={masterBusy} onClick={() => void changeMaster(app.id)}>
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
            {!selected && <Typography>{t("boRelationship.noSelection")}</Typography>}
            {selected && (
              <Stack spacing={2}>
                {renderGroup(t("boRelationship.master"), group?.master ? [group.master] : [])}
                {group?.master && canManageMaster && (
                  <Button disabled={masterBusy} onClick={() => void changeMaster(null)}>
                    {t("boRelationship.clearMaster")}
                  </Button>
                )}
                {renderGroup(t("boRelationship.slave"), group?.slaves ?? [])}
                {renderGroup(t("boRelationship.unclassified"), group?.unclassified ?? [])}
              </Stack>
            )}
          </Box>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <BoRelationshipDiagram
              nodes={data.nodes}
              edges={data.edges}
              positions={positions}
              onActivate={setSelected}
            />
            <Stack direction="row" spacing={1} flexWrap="wrap" sx={{ mt: 1 }}>
              {["data", "document", "legacy", "personalData", "paymentData"].map((key) => (
                <Chip key={key} size="small" label={t(`boRelationship.${key}`)} />
              ))}
            </Stack>
          </Box>
          <CardDetailSidePanel
            cardId={selected}
            open={selected !== null}
            onClose={() => setSelected(null)}
            docked
            boScoped
            refreshKey={detailVersion}
            onSaved={refetch}
          />
        </Stack>
      )}
    </Box>
  );
}
