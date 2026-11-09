import { useEffect, useMemo, useRef, useState } from "react";
import { Alert, Box, Button, Chip, CircularProgress, Stack, Typography } from "@mui/material";
import { useTranslation } from "react-i18next";
import { api } from "@/api/client";
import CardDetailSidePanel from "@/components/CardDetailSidePanel";
import { FilterCheckboxList, FilterSectionHeader } from "@/components/FilterSidebarSection";
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
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [personalData, setPersonalData] = useState(false);
  const [paymentData, setPaymentData] = useState(false);
  const [mutationError, setMutationError] = useState("");
  const [detailVersion, setDetailVersion] = useState(0);
  const [masterBusy, setMasterBusy] = useState(false);
  const [liveGroups, setLiveGroups] = useState<Record<string, BoGroup>>({});
  const masterLock = useRef(false);
  const positions = useMemo(
    () => data ? computeLayout(data.nodes, data.edges, data.positions) : {},
    [data],
  );
  // Independent facets combine with AND, as in the approved diagram mockup.
  const visibleNodes = useMemo(() => (data?.nodes ?? []).filter((node) =>
    (!personalData || node.isPersonalData) && (!paymentData || node.isPaymentData),
  ), [data, personalData, paymentData]);
  const visibleIds = useMemo(() => new Set(visibleNodes.map((node) => node.id)), [visibleNodes]);
  const visibleEdges = useMemo(() => (data?.edges ?? []).filter((edge) =>
    visibleIds.has(edge.source) && visibleIds.has(edge.target),
  ), [data, visibleIds]);
  const activeSelection = selected && visibleIds.has(selected) ? selected : null;
  useEffect(() => {
    if (data && selected && !visibleIds.has(selected)) setSelected(null);
  }, [data, selected, visibleIds]);
  const canManageMaster = data?.capabilities.can_manage_master ?? false;
  // Graph reloads keep the accepted drawing. The mutation returns live roles
  // for the panel without implicitly accepting inventory changes.
  const group = activeSelection && data?.applications[activeSelection]
    ? (canManageMaster ? liveGroups[activeSelection] : undefined) ?? data.applications[activeSelection]
    : undefined;

  const changeMaster = async (applicationId: string | null) => {
    if (!activeSelection || !canManageMaster || masterLock.current) return;
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
            {!activeSelection && <Typography>{t("boRelationship.noSelection")}</Typography>}
            {activeSelection && (
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
            cardId={activeSelection}
            open={activeSelection !== null}
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
