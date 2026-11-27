import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { Link as RouterLink, useParams, useNavigate, useSearchParams } from "react-router";
import Box from "@mui/material/Box";
import Tabs from "@mui/material/Tabs";
import Tab from "@mui/material/Tab";
import Typography from "@mui/material/Typography";
import Alert from "@mui/material/Alert";
import Chip from "@mui/material/Chip";
import Button from "@mui/material/Button";
import Tooltip from "@mui/material/Tooltip";
import useMediaQuery from "@mui/material/useMediaQuery";
import { useTheme } from "@mui/material/styles";
import IconButton from "@mui/material/IconButton";
import CircularProgress from "@mui/material/CircularProgress";
import { useTranslation } from "react-i18next";
import MaterialSymbol from "@/components/MaterialSymbol";
import { api, ApiError } from "@/api/client";
import { useCardSubtypeLabel } from "@/hooks/useCardSubtypeLabel";
import { usePageSection, usePageSubject } from "@/hooks/usePageTitle";
import { useLatestRequest } from "@/hooks/useLatestRequest";
import { useOptionalAuthUser } from "@/hooks/AuthContext";
import { hasPermission } from "@/components/RequirePermission";
import PpmOverviewTab from "./PpmOverviewTab";
import PpmReportsTab from "./PpmReportsTab";
import PpmCostTab from "./PpmCostTab";
import PpmRiskTab from "./PpmRiskTab";
import PpmTaskBoard from "./PpmTaskBoard";
import PpmGanttTab from "./PpmGanttTab";
import CardDetailContent from "@/features/cards/CardDetailContent";
import { CLOSED_CARD_PERMISSIONS } from "@/features/cards/defaultPermissions";
import type {
  Card,
  CardEffectivePermissions,
  PpmStatusReport,
  PpmCostLine,
  PpmBudgetLine,
  PpmRisk,
  PpmRollupOut,
} from "@/types";

const TAB_KEYS = ["overview", "reports", "cost", "risks", "tasks", "gantt", "details"];
const COST_TAB = TAB_KEYS.indexOf("cost");
// The `ppm`-namespace key each tab renders its label from, in TAB_KEYS order.
const PPM_TAB_LABEL_KEYS = [
  "overview",
  "statusReports",
  "budgetAndCosts",
  "riskManagement",
  "tasks",
  "gantt",
  "cardDetails",
];

export default function PpmProjectDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { t } = useTranslation(["ppm", "common"]);
  const theme = useTheme();
  const compact = useMediaQuery(theme.breakpoints.down("sm"));

  const subtypeLabel = useCardSubtypeLabel();
  const initialTab = TAB_KEYS.indexOf(searchParams.get("tab") || "overview");
  const [tab, setTab] = useState(initialTab >= 0 ? initialTab : 0);

  const handleTabChange = useCallback(
    (_: unknown, v: number) => {
      setTab(v);
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        next.set("tab", TAB_KEYS[v]);
        return next;
      }, { replace: true });
    },
    [setSearchParams],
  );
  const [card, setCard] = useState<Card | null>(null);
  // «Apollo Migration · Budget & Costs | Turbo EA» — an initiative page is the
  // one place both slots are live at once.
  usePageSubject(card?.name);
  const [reports, setReports] = useState<PpmStatusReport[]>([]);
  const [costLines, setCostLines] = useState<PpmCostLine[]>([]);
  const [budgetLines, setBudgetLines] = useState<PpmBudgetLine[]>([]);
  const [risks, setRisks] = useState<PpmRisk[]>([]);
  // What the initiatives beneath this one add up to: shown on a side this
  // initiative has no lines of its own for. `null` when it could not be read.
  const [rollup, setRollup] = useState<PpmRollupOut | null>(null);
  const [perms, setPerms] = useState<CardEffectivePermissions["effective"]>(CLOSED_CARD_PERMISSIONS);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const user = useOptionalAuthUser();
  const canManage = hasPermission(user?.permissions, "ppm.manage");
  const canEdit = canManage && perms.can_edit;
  const canEditCosts = canManage && perms.can_edit_costs;
  // The Budget & Costs tab is not offered without cost access; the others keep
  // their index, so a `tab` parameter still lands where it did.
  const activeTab = tab === COST_TAB && !perms.can_view_costs ? 0 : tab;
  usePageSection(t(PPM_TAB_LABEL_KEYS[activeTab]));

  // Another initiative: nothing of the previous one stays on screen while the
  // next one loads. Reset during render, so not even one frame shows it.
  const [shownId, setShownId] = useState(id);
  if (shownId !== id) {
    setShownId(id);
    // Stryker disable all: cleared while the spinner shows; nothing renders them before the next load replaces them
    setCard(null);
    setReports([]);
    setCostLines([]);
    setBudgetLines([]);
    setRisks([]);
    setRollup(null);
    setPerms(CLOSED_CARD_PERMISSIONS);
    setError("");
    // Stryker restore all
    setLoading(true);
  }

  // Only the newest load may write the page: a reply for an initiative the
  // user has left must never overwrite the one they are on. Called again by
  // the tabs after a change, so the imperative primitive rather than an effect.
  const dataRequest = useLatestRequest();

  // A tab hands `loadData` to its own async work (a delete, a save), which can
  // answer after the user has switched initiative: the refresh must load the
  // initiative on screen then, never the one the tab was rendered for.
  const idRef = useRef(id);
  useEffect(() => {
    idRef.current = id;
  }, [id]);

  const loadData = useCallback(async () => {
    const id = idRef.current;
    if (!id) return;
    await dataRequest.run(async ({ signal, isCurrent }) => {
      setError("");
      try {
        // Stryker disable ObjectLiteral: the signal only cancels the request on the wire; the stale-reply guard, which is what the tests pin, is isCurrent()
        const [c, r, cl, bl, ri, ru, pm] = await Promise.all([
          api.get<Card>(`/cards/${id}`, { signal }),
          api.get<PpmStatusReport[]>(`/ppm/initiatives/${id}/reports`, { signal }),
          api.get<PpmCostLine[]>(`/ppm/initiatives/${id}/costs`, { signal }),
          api.get<PpmBudgetLine[]>(`/ppm/initiatives/${id}/budgets`, { signal }),
          api.get<PpmRisk[]>(`/ppm/initiatives/${id}/risks`, { signal }),
          // A secondary figure: a failure (a subtree too large to walk) leaves
          // the page on the initiative's own figures, never an error.
          api
            .get<PpmRollupOut>(`/ppm/initiatives/${id}/rollup`, { signal })
            .catch(() => null),
          api
            .get<CardEffectivePermissions>(`/cards/${id}/my-permissions`, { signal })
            .catch(() => null),
        ]);
        if (!isCurrent()) return;
        setCard(c);
        setReports(r);
        setCostLines(cl);
        setBudgetLines(bl);
        setRisks(ri);
        setRollup(ru);
        // Stryker restore ObjectLiteral
        setPerms(pm?.effective ?? CLOSED_CARD_PERMISSIONS);
      } catch (e) {
        // Superseded (or aborted because it was): the newer load owns the page.
        if (!isCurrent()) return;
        if (e instanceof ApiError && e.status === 403) {
          setError(t("common:errors.forbidden"));
        } else if (e instanceof ApiError && e.status === 404) {
          setError(t("common:errors.notFound"));
        } else {
          setError(e instanceof Error ? e.message : String(e));
        }
      } finally {
        if (isCurrent()) setLoading(false);
      }
    });
    // Stryker disable next-line ArrayDeclaration: dataRequest is identity-stable and t only words a failure; any list is equivalent
  }, [t, dataRequest]);

  useEffect(() => {
    loadData();
  }, [id, loadData]);

  // When PPM has budget/cost lines, mark card cost fields as auto-computed
  const ppmAutoFieldKeys = useMemo(() => {
    const keys: string[] = [];
    if (budgetLines.length > 0) keys.push("costBudget");
    if (costLines.length > 0) keys.push("costActual");
    return keys;
  }, [budgetLines.length, costLines.length]);

  if (loading) {
    return (
      <Box display="flex" justifyContent="center" mt={8}>
        <CircularProgress />
      </Box>
    );
  }

  if (error || !card) {
    return (
      <Box sx={{ p: { xs: 1.5, sm: 3 }, maxWidth: 1400, mx: "auto" }}>
        <Box display="flex" alignItems="center" gap={1} mb={2}>
          <IconButton sx={{ flexShrink: 0 }} onClick={() => navigate("/ppm?tab=portfolio")}>
            <MaterialSymbol icon="arrow_back" size={20} />
          </IconButton>
        </Box>
        <Alert severity="error">{error || t("common:errors.notFound")}</Alert>
      </Box>
    );
  }

  const latestReport = reports[0] || null;

  return (
    <Box sx={{ p: { xs: 1.5, sm: 3 }, maxWidth: 1400, mx: "auto" }}>
      {/* Header */}
      <Box display="flex" alignItems="center" gap={1} mb={2}>
        <IconButton sx={{ flexShrink: 0 }} onClick={() => navigate("/ppm?tab=portfolio")}>
          <MaterialSymbol icon="arrow_back" size={20} />
        </IconButton>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography
            variant="h5"
            fontWeight={700}
            noWrap
            sx={{ fontSize: { xs: "1.25rem", sm: "1.5rem" } }}
          >
            {card.name}
          </Typography>
        </Box>
        {card.subtype && (
          <Chip
            label={subtypeLabel(card.type, card.subtype)}
            size="small"
            variant="outlined"
            sx={{ marginInlineStart: 1, flexShrink: 0 }}
          />
        )}
        {compact ? (
          <Tooltip title={t("pdfDocumentTitle")}>
            <IconButton
              component={RouterLink}
              to={`/ppm/${card.id}/report`}
              aria-label={t("pdfDocumentTitle")}
              // Stryker disable next-line ObjectLiteral: equivalent: MUI's IconButton root already sets flex: 0 0 auto, so the button never shrinks either way
              sx={{ flexShrink: 0 }}
            >
              <MaterialSymbol icon="analytics" size={20} />
            </IconButton>
          </Tooltip>
        ) : (
          <Tooltip title={t("pdfDocumentTitle")}>
            <Button
              size="small"
              component={RouterLink}
              to={`/ppm/${card.id}/report`}
              startIcon={<MaterialSymbol icon="analytics" size={18} />}
              sx={{ textTransform: "none", flexShrink: 0 }}
            >
              {t("reportButton")}
            </Button>
          </Tooltip>
        )}
      </Box>

      {/* Tabs */}
      <Tabs
        value={activeTab}
        onChange={handleTabChange}
        variant="scrollable"
        scrollButtons="auto"
        allowScrollButtonsMobile
        sx={{ mb: 3 }}
      >
        {PPM_TAB_LABEL_KEYS.map(
          (labelKey, index) =>
            (index !== COST_TAB || perms.can_view_costs) && (
              <Tab key={labelKey} value={index} label={t(labelKey)} />
            ),
        )}
      </Tabs>

      {/* Tab Content */}
      {activeTab === 0 && (
        <PpmOverviewTab
          card={card}
          latestReport={latestReport}
          costLines={costLines}
          budgetLines={budgetLines}
          rollup={rollup}
          canViewCosts={perms.can_view_costs}
          canEdit={canEdit}
          onRefresh={loadData}
          risks={risks}
        />
      )}
      {activeTab === 1 && (
        <PpmReportsTab
          initiativeId={id!}
          reports={reports}
          canEdit={canEdit}
          onRefresh={loadData}
        />
      )}
      {activeTab === 2 && (
        <PpmCostTab
          key={id}
          initiativeId={id!}
          costLines={costLines}
          rollup={rollup}
          canEdit={canEditCosts}
          onRefresh={loadData}
        />
      )}
      {activeTab === 3 && (
        <PpmRiskTab
          initiativeId={id!}
          risks={risks}
          canEdit={canEdit}
          onRefresh={loadData}
          // Stryker disable next-line OptionalChaining: equivalent: card is non-null here, the page returned the error view above when it is null
          initiativeName={card?.name}
        />
      )}
      {activeTab === 4 && <PpmTaskBoard initiativeId={id!} canEdit={canEdit} />}
      {activeTab === 5 && <PpmGanttTab initiativeId={id!} card={card ?? undefined} canEdit={canEdit} />}
      {activeTab === 6 && (
        <CardDetailContent
          key={card.id}
          card={card}
          perms={perms}
          onCardUpdate={(updated) => setCard(updated)}
          showBpmTabs={false}
          showPpmTab={false}
          autoFieldKeys={ppmAutoFieldKeys}
        />
      )}
    </Box>
  );
}
