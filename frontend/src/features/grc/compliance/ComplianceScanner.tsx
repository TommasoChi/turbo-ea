/**
 * ComplianceScanner — on-demand compliance scan.
 *
 * Mirrors the Duplicates / Vendors pattern: trigger via POST, poll the
 * analysis run, then reload findings. Two inner sub-tabs: Overview
 * (scan trigger + heatmap), Compliance (grid).
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Chip from "@mui/material/Chip";
import CircularProgress from "@mui/material/CircularProgress";
import Grid from "@mui/material/Grid";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Tab from "@mui/material/Tab";
import Tabs from "@mui/material/Tabs";
import Typography from "@mui/material/Typography";
import CardDetailSidePanel from "@/components/CardDetailSidePanel";
import MetricCard from "@/features/reports/MetricCard";
import { api, ApiError } from "@/api/client";
import { useComplianceRegulations } from "@/hooks/useComplianceRegulations";
import type {
  ComplianceDecision,
  ComplianceRegulation,
  ComplianceStatus,
  RegulationKey,
  TurboLensComplianceBundle,
  TurboLensComplianceFinding,
  ComplianceOverview,
} from "@/types";
import ComplianceHeatmap from "./ComplianceHeatmap";
import ComplianceGrid from "@/features/grc/compliance/ComplianceGrid";
import type { ComplianceFilters } from "@/features/grc/compliance/ComplianceFilterSidebar";
import CreateComplianceFindingDialog from "@/features/grc/compliance/CreateComplianceFindingDialog";
import CreateRiskDialog from "@/features/grc/risk/CreateRiskDialog";
import {
  RiskDialogSeed,
  seedFromCompliance,
} from "@/features/grc/risk/riskDefaults";
import { useNavigate } from "react-router";
import { todayIsoDate } from "@/lib/dates";

/**
 * Resolve a regulation key to a display label. Order of precedence:
 *   1. The DB row's `label` (from the singleton hook), so admin edits show.
 *   2. The i18n key `compliance_regulation_<key>` if it exists
 *      (covers the 6 built-ins in non-English locales).
 *   3. The raw key, as a last-resort fallback for orphan findings whose
 *      regulation was deleted from the table.
 */
function resolveRegulationLabel(
  key: string,
  byKey: Record<string, ComplianceRegulation>,
  t: (k: string, opts?: { defaultValue?: string }) => string,
  fallbackLabel?: string | null,
): string {
  const reg = byKey[key];
  if (reg?.label) return reg.label;
  if (fallbackLabel) return fallbackLabel;
  const i18nKey = `compliance_regulation_${key}`;
  const translated = t(i18nKey, { defaultValue: key });
  return translated && translated !== i18nKey ? translated : key;
}

// ---------------------------------------------------------------------------

function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  const s = String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function exportComplianceToCsv(
  findings: TurboLensComplianceFinding[],
  t: (k: string) => string,
  tCards: (k: string) => string,
): void {
  const header = [
    tCards("compliance.grid.col.card"),
    tCards("compliance.grid.col.severity"),
    tCards("compliance.grid.col.status"),
    tCards("compliance.grid.col.article"),
    tCards("compliance.grid.col.requirement"),
    tCards("compliance.grid.col.lifecycle"),
    "AI detected",
    "Auto-resolved",
    "Regulation",
    "Gap",
    "Evidence",
    "Remediation",
    "Reviewer",
    "Reviewed at",
  ];
  const lines = [header.map(csvCell).join(",")];
  for (const f of findings) {
    lines.push(
      [
        f.card_name ?? "",
        t(`compliance_severity_${f.severity}`),
        t(`compliance_status_${f.status}`),
        f.regulation_article ?? "",
        f.requirement ?? "",
        t(`compliance_decision_${f.decision}`),
        f.ai_detected ? "Yes" : "No",
        f.auto_resolved ? "Yes" : "No",
        f.regulation,
        f.gap_description ?? "",
        f.evidence ?? "",
        f.remediation ?? "",
        f.reviewer_name ?? "",
        f.reviewed_at ?? "",
      ]
        .map(csvCell)
        .join(","),
    );
  }
  const blob = new Blob(["﻿" + lines.join("\r\n")], {
    type: "text/csv;charset=utf-8;",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  const stamp = todayIsoDate();
  a.download = `compliance-findings-${stamp}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export default function ComplianceScanner() {
  const { t } = useTranslation("admin");
  const { t: tCards } = useTranslation("cards");
  const navigate = useNavigate();

  // ── View state ─────────────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState(0);
  const [overview, setOverview] = useState<ComplianceOverview | null>(null);
  const [overviewLoading, setOverviewLoading] = useState(true);
  const [compliance, setCompliance] = useState<TurboLensComplianceBundle[]>([]);
  const [complianceLoading, setComplianceLoading] = useState(true);
  const [createFindingOpen, setCreateFindingOpen] = useState(false);

  // ── Compliance filter ──────────────────────────────────────────────
  const [activeRegulation, setActiveRegulation] = useState<RegulationKey>("eu_ai_act");

  // If the current activeRegulation doesn't match any returned bundle
  // (e.g. all built-ins were disabled, or the user is on a fresh
  // install with no compliance scan yet), pin it to the first bundle.
  // This avoids MUI Tabs "no matching value" console noise.
  const [highlightCell, setHighlightCell] = useState<{
    regulation: RegulationKey;
    status: ComplianceStatus | null;
  } | null>(null);
  // Compliance subtab filters. Status / severity / decision filters are
  // "all selected" by default so every finding is shown. Auto-resolved
  // findings are hidden by default to keep the active workload front and
  // centre; users opt in to see history.
  const [complianceStatusFilter, setComplianceStatusFilter] = useState<
    Set<ComplianceStatus>
  >(
    new Set<ComplianceStatus>([
      "compliant",
      "partial",
      "non_compliant",
      "not_applicable",
      "review_needed",
    ]),
  );
  const [complianceSeverityFilter, setComplianceSeverityFilter] = useState<
    Set<TurboLensComplianceFinding["severity"]>
  >(
    new Set<TurboLensComplianceFinding["severity"]>([
      "critical",
      "high",
      "medium",
      "low",
      "info",
    ]),
  );
  const [complianceDecisionFilter, setComplianceDecisionFilter] = useState<
    Set<ComplianceDecision>
  >(
    new Set<ComplianceDecision>([
      "new",
      "in_review",
      "mitigated",
      "verified",
      "risk_tracked",
      "accepted",
    ]),
  );
  const [complianceAiOnly, setComplianceAiOnly] = useState(false);
  const [complianceAiConfirmedOnly, setComplianceAiConfirmedOnly] =
    useState(false);
  const [complianceIncludeResolved, setComplianceIncludeResolved] =
    useState(false);
  const [complianceCardTypeFilter, setComplianceCardTypeFilter] = useState<
    Set<"Application" | "ITComponent">
  >(new Set<"Application" | "ITComponent">(["Application", "ITComponent"]));

  // Card side panel triggered from a finding's card-name click.
  const [cardPanelId, setCardPanelId] = useState<string | null>(null);

  // Finding being edited (status / severity / details). null = create mode.
  const [editFinding, setEditFinding] =
    useState<TurboLensComplianceFinding | null>(null);

  // Risk promotion dialog (used from compliance cards).
  const [riskSeed, setRiskSeed] = useState<RiskDialogSeed | null>(null);
  const openRisk = useCallback(
    (riskId: string) => navigate(`/grc/risks/${riskId}`),
    [navigate],
  );

  // ── Shared messaging ───────────────────────────────────────────────
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  // ── Admin-managed regulations + AI status ─────────────────────────
  const { enabled: enabledRegulations, byKey: regulationsByKey } =
    useComplianceRegulations();
  // ── Loaders ────────────────────────────────────────────────────────
  const loadOverview = useCallback(async () => {
    setOverviewLoading(true);
    try {
      const data = await api.get<ComplianceOverview>("/compliance/overview");
      setOverview(data);
    } catch (e) {
      setOverview(null);
      if (e instanceof ApiError && e.status !== 404) setError(e.message);
    } finally {
      setOverviewLoading(false);
    }
  }, []);

  const loadCompliance = useCallback(async () => {
    setComplianceLoading(true);
    try {
      const data = await api.get<TurboLensComplianceBundle[]>(
        "/compliance/compliance",
      );
      setCompliance(data);
    } catch {
      setCompliance([]);
    } finally {
      setComplianceLoading(false);
    }
  }, []);

  const reloadAll = useCallback(() => {
    loadOverview();
    loadCompliance();
  }, [loadOverview, loadCompliance]);

  useEffect(() => {
    reloadAll();
  }, [reloadAll]);

  // Pin activeRegulation to a valid bundle whenever the list changes.
  useEffect(() => {
    if (compliance.length === 0) return;
    if (!compliance.some((b) => b.regulation === activeRegulation)) {
      setActiveRegulation(compliance[0].regulation);
    }
  }, [compliance, activeRegulation]);

  // ── Compliance cell selection ──────────────────────────────────────
  const handleComplianceCellSelect = (
    regulation: RegulationKey,
    status: ComplianceStatus | null,
  ) => {
    setActiveTab(1);
    setActiveRegulation(regulation);
    setHighlightCell({ regulation, status });
  };

  const filteredComplianceFindings = useMemo(() => {
    const bundle = compliance.find((b) => b.regulation === activeRegulation);
    if (!bundle) return [];
    let items = bundle.findings;
    // Heatmap drill-through takes precedence as a transient pre-filter on
    // status; once the user changes the explicit status filter chips,
    // they win.
    if (
      highlightCell &&
      highlightCell.regulation === activeRegulation &&
      highlightCell.status
    ) {
      items = items.filter((f) => f.status === highlightCell.status);
    } else {
      items = items.filter((f) => complianceStatusFilter.has(f.status));
    }
    items = items.filter((f) =>
      complianceSeverityFilter.has(f.severity),
    );
    items = items.filter((f) =>
      complianceDecisionFilter.has(f.decision as ComplianceDecision),
    );
    if (complianceAiOnly) items = items.filter((f) => f.ai_detected);
    if (complianceAiConfirmedOnly)
      items = items.filter((f) => f.card_has_ai_features === true);
    if (!complianceIncludeResolved)
      items = items.filter((f) => !f.auto_resolved);
    // Card-type filter: landscape-scoped findings (no card_type) always
    // pass; otherwise drop findings whose card_type is not in the set.
    items = items.filter(
      (f) =>
        !f.card_type ||
        complianceCardTypeFilter.has(
          f.card_type as "Application" | "ITComponent",
        ),
    );
    return items;
  }, [
    compliance,
    activeRegulation,
    highlightCell,
    complianceStatusFilter,
    complianceSeverityFilter,
    complianceDecisionFilter,
    complianceAiOnly,
    complianceAiConfirmedOnly,
    complianceIncludeResolved,
    complianceCardTypeFilter,
  ]);


  // ── Render ────────────────────────────────────────────────────────
  return (
    <Box>
      <Box sx={{ mb: 2 }}>
        <Typography variant="h6" fontWeight={700}>
          {t("compliance_title")}
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 800 }}>
          {t("compliance_description")}
        </Typography>
      </Box>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}
      {info && (
        <Alert severity="info" sx={{ mb: 2 }} onClose={() => setInfo(null)}>
          {info}
        </Alert>
      )}

      <Tabs
        value={activeTab}
        onChange={(_, v) => setActiveTab(v)}
        sx={{ borderBottom: 1, borderColor: "divider", mb: 2 }}
      >
        <Tab label={t("compliance_tab_overview")} />
        <Tab label={t("compliance_tab_compliance")} />
      </Tabs>

      {activeTab === 0 && renderOverview()}
      {activeTab === 1 && renderCompliance()}

      <CardDetailSidePanel
        cardId={cardPanelId}
        open={Boolean(cardPanelId)}
        onClose={() => setCardPanelId(null)}
      />

      <CreateRiskDialog
        open={Boolean(riskSeed)}
        seed={riskSeed}
        onClose={() => setRiskSeed(null)}
        onCreated={(risk) => {
          setRiskSeed(null);
          // Refresh overview + compliance so the originating finding
          // flips to "Open risk R-xxxxxx" without a reload.
          loadOverview();
          loadCompliance();
          navigate(`/grc/risks/${risk.id}`);
        }}
      />

      <CreateComplianceFindingDialog
        open={createFindingOpen || Boolean(editFinding)}
        finding={editFinding}
        defaultRegulation={activeRegulation}
        onClose={() => {
          setCreateFindingOpen(false);
          setEditFinding(null);
        }}
        onSaved={() => {
          // Refresh the compliance bundle so the new/edited finding lands
          // on the active regulation tab with its updated status.
          loadCompliance();
        }}
      />
    </Box>
  );

  // -----------------------------------------------------------------
  // Overview tab
  // -----------------------------------------------------------------
  function renderOverview() {
    if (overviewLoading && !overview) {
      return (
        <Box sx={{ display: "flex", justifyContent: "center", py: 8 }}>
          <CircularProgress />
        </Box>
      );
    }
    const complianceScoresVals = Object.values(overview?.compliance_scores || {});
    const avgCompliance =
      complianceScoresVals.length === 0
        ? 100
        : Math.round(
            complianceScoresVals.reduce((a, b) => a + b, 0) /
              complianceScoresVals.length,
          );

    return (
      <Stack spacing={3}>
        {overview && renderKpisAndCharts(overview, avgCompliance)}
      </Stack>
    );
  }

  function renderKpisAndCharts(
    overview: ComplianceOverview,
    avgCompliance: number,
  ) {
    return (
      <Stack spacing={3}>
        <Grid container spacing={2}>
          <Grid item xs={12} md={4}>
            <MetricCard
              label={t("compliance_kpi_compliance_score")}
              value={`${avgCompliance}%`}
              icon="verified"
              color={
                avgCompliance >= 80
                  ? "#2e7d32"
                  : avgCompliance >= 60
                    ? "#f57c00"
                    : "#d32f2f"
              }
            />
          </Grid>
        </Grid>

        <Paper variant="outlined" sx={{ p: 2 }}>
          <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 1 }}>
            {t("compliance_summary")}
          </Typography>
          <ComplianceHeatmap
            regulations={enabledRegulations.map((r) => ({
              key: r.key,
              label: resolveRegulationLabel(r.key, regulationsByKey, t, r.label),
            }))}
            matrix={overview.compliance_by_status}
            scores={overview.compliance_scores}
            onSelect={handleComplianceCellSelect}
            highlight={highlightCell}
          />
        </Paper>
      </Stack>
    );
  }


  // -----------------------------------------------------------------
  // Compliance tab
  // -----------------------------------------------------------------
  function renderCompliance() {
    // Loading state is rendered as AG Grid's native overlay via the
    // ComplianceGrid `loading` prop; the regulation tabs and filter
    // sidebar stay visible during the initial fetch.
    return (
      <Stack spacing={2} sx={{ flex: 1, minHeight: 0, display: "flex" }}>
        <Tabs
          value={activeRegulation}
          onChange={(_, v) => {
            setActiveRegulation(v as RegulationKey);
            setHighlightCell(null);
          }}
          variant="scrollable"
          scrollButtons="auto"
        >
          {/* Tabs iterate the bundles returned by /security/compliance,
              which already include enabled regulations + any orphans
              that still have findings. Disabled/unknown regulations are
              rendered muted so historical findings remain auditable. */}
          {compliance.map((bundle) => {
            const reg = bundle.regulation;
            const label = resolveRegulationLabel(
              reg,
              regulationsByKey,
              t,
              bundle.label,
            );
            const muted =
              bundle.is_enabled === false || bundle.is_known === false;
            return (
              <Tab
                key={reg}
                value={reg}
                sx={muted ? { opacity: 0.55 } : undefined}
                label={
                  <Stack direction="row" spacing={1} alignItems="center">
                    <span>{label}</span>
                    {bundle.is_known === false && (
                      <Chip
                        size="small"
                        label={t("compliance_regulation_orphan")}
                        sx={{ height: 18, fontSize: 10 }}
                      />
                    )}
                    {bundle.is_known !== false && bundle.is_enabled === false && (
                      <Chip
                        size="small"
                        label={t("compliance_regulation_disabled")}
                        sx={{ height: 18, fontSize: 10 }}
                      />
                    )}
                    <Chip
                      size="small"
                      label={`${bundle.score}%`}
                      color={
                        bundle.score >= 80
                          ? "success"
                          : bundle.score >= 60
                            ? "warning"
                            : "error"
                      }
                    />
                  </Stack>
                }
              />
            );
          })}
        </Tabs>

        {highlightCell?.status && (
          <Alert
            severity="info"
            sx={{ py: 0 }}
            onClose={() => setHighlightCell(null)}
          >
            {t("compliance_filter_from_heatmap", {
              status: t(
                `compliance_status_${highlightCell.status}`,
              ),
            })}
          </Alert>
        )}

        <ComplianceGrid
          findings={filteredComplianceFindings}
          filters={{
            statuses: complianceStatusFilter,
            severities: complianceSeverityFilter,
            decisions: complianceDecisionFilter,
            cardTypes: complianceCardTypeFilter,
            aiOnly: complianceAiOnly,
            aiConfirmedOnly: complianceAiConfirmedOnly,
            includeResolved: complianceIncludeResolved,
          } as ComplianceFilters}
          onFiltersChange={(next) => {
            setComplianceStatusFilter(next.statuses);
            setComplianceSeverityFilter(next.severities);
            setComplianceDecisionFilter(next.decisions);
            setComplianceCardTypeFilter(next.cardTypes);
            setComplianceAiOnly(next.aiOnly);
            setComplianceAiConfirmedOnly(next.aiConfirmedOnly);
            setComplianceIncludeResolved(next.includeResolved);
          }}
          onFindingUpdated={(updated) => {
            setCompliance((prev) =>
              prev.map((b) =>
                b.regulation === updated.regulation
                  ? {
                      ...b,
                      findings: b.findings.map((f) =>
                        f.id === updated.id ? updated : f,
                      ),
                    }
                  : b,
              ),
            );
          }}
          onOpenCard={setCardPanelId}
          onPromoteToRisk={(f) => setRiskSeed(seedFromCompliance(f))}
          onOpenRisk={openRisk}
          onEdit={(f) => setEditFinding(f)}
          loading={complianceLoading}
          onCreate={() => setCreateFindingOpen(true)}
          onExport={() =>
            exportComplianceToCsv(filteredComplianceFindings, t, tCards)
          }
          onDelete={async (f) => {
            try {
              await api.delete(`/compliance/compliance-findings/${f.id}`);
              setCompliance((prev) =>
                prev.map((b) =>
                  b.regulation === f.regulation
                    ? {
                        ...b,
                        findings: b.findings.filter((x) => x.id !== f.id),
                      }
                    : b,
                ),
              );
            } catch (e) {
              if (e instanceof ApiError) setError(e.message);
            }
          }}
          onBulkDelete={async (ids) => {
            try {
              const result = await api.delete<{
                updated: number;
                skipped: { id: string; reason: string }[];
              }>("/compliance/compliance-findings/bulk", { ids });
              // Optimistic-but-safe: just reload — bulk ops can affect
              // many rows across regulations and the server's partial-success
              // contract means we can't easily compute the new state locally.
              await loadCompliance();
              return result;
            } catch (e) {
              if (e instanceof ApiError) setError(e.message);
              return { updated: 0, skipped: [] };
            }
          }}
          onBulkDecisionUpdate={async (ids, decision, reviewNote) => {
            try {
              const result = await api.patch<{
                updated: number;
                skipped: { id: string; reason: string }[];
              }>("/compliance/compliance-findings/bulk", {
                ids,
                decision,
                review_note: reviewNote,
              });
              await loadCompliance();
              return result;
            } catch (e) {
              if (e instanceof ApiError) setError(e.message);
              return { updated: 0, skipped: [] };
            }
          }}
        />
      </Stack>
    );
  }
}

