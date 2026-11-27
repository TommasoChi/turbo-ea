import { useState } from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Paper from "@mui/material/Paper";
import Typography from "@mui/material/Typography";
import LinkifiedText from "@/components/LinkifiedText";
import LinearProgress from "@mui/material/LinearProgress";
import { useTranslation } from "react-i18next";
import { useTheme } from "@mui/material/styles";
import { useCurrency } from "@/hooks/useCurrency";
import { useDateFormat } from "@/hooks/useDateFormat";
import PpmInitiativeTimeline from "./PpmInitiativeTimeline";
import { usePpmCompletion, usePpmSchedule } from "./usePpmFinancials";
import { KPI_VALUE_SX } from "./ppmStyles";
import DerivedValue from "./DerivedValue";
import { financialTotals } from "./derivedFinancials";
import { compactAmount } from "./ppmPortfolioFormat";
import { BudgetBar, CompletionRing } from "./ppmVisuals";
import PpmHealthSummary from "./PpmHealthSummary";
import PpmRiskSummary from "./PpmRiskSummary";
import PpmManageDialog from "./PpmManageDialog";
import StatusReportDialog from "./StatusReportDialog";
import type {
  Card,
  PpmStatusReport,
  PpmCostLine,
  PpmBudgetLine,
  PpmRollupOut,
  PpmRisk,
} from "@/types";

interface Props {
  card: Card;
  latestReport: PpmStatusReport | null;
  costLines: PpmCostLine[];
  budgetLines: PpmBudgetLine[];
  /** The initiatives beneath this one (`null` while unknown or unreadable). */
  rollup: PpmRollupOut | null;
  /** Without cost access the Financials panel is not shown. */
  canViewCosts: boolean;
  /** ppm.manage with card edit: the Manage buttons exist only when true. */
  canEdit: boolean;
  /** A status report or a risk changed: the page reloads. */
  onRefresh: () => void;
  risks: PpmRisk[];
}

/** The "beneath this initiative" block under the Financials bars. */
const BENEATH_SX = { mt: 2, pt: 1.5, borderTop: 1, borderColor: "divider" };

export default function PpmOverviewTab({
  card,
  latestReport,
  costLines,
  budgetLines,
  rollup,
  canViewCosts,
  canEdit,
  onRefresh,
  risks,
}: Props) {
  const [dialog, setDialog] = useState<"report" | "risks" | null>(null);
  const { t } = useTranslation("ppm");
  const theme = useTheme();
  const { fmt, currency } = useCurrency();
  // The KPI figures read in k / M so the derived glyph beside them cannot wrap them.
  const kpiAmount = (n: number) => compactAmount(n, currency, fmt.format);
  const { formatDate } = useDateFormat();
  const schedule = usePpmSchedule(card.id);
  const budgetBarColor = theme.palette.primary.main;
  const overBudgetColor = theme.palette.error.dark;

  // Initiative completion. Ordered per initiative, and never the previous
  // initiative's figure while the next one loads.
  const { data: completion, error: completionError } = usePpmCompletion(card.id);
  const completionPct = completion?.completion;
  // Stryker disable next-line ConditionalExpression,LogicalOperator: completionPct is read off completion, so the two are undefined together
  const completionLoading = completion === undefined || completionPct === undefined;

  // What the initiatives beneath this one add up to: read live by the page,
  // shown beside this initiative's own figures and in place of a side it has
  // no lines of its own for — never added to them. Absent while loading and
  // on failure: it is a secondary figure, not worth an error.
  const showBeneath = !!rollup && rollup.descendant_count > 0;
  const fmtSpanDate = (d: string | null) => (d ? formatDate(d) : "\u2014");

  // Each side is this initiative's own lines, or the initiatives' beneath it
  // when it has none of that kind (see derivedFinancials).
  const totals = financialTotals(budgetLines, costLines, rollup);
  const count = rollup?.descendant_count;
  const budgetTip = totals.budget.derived ? t("derivedBudgetTooltip", { count }) : undefined;
  const actualTip = totals.actual.derived ? t("derivedActualTooltip", { count }) : undefined;
  const varianceTip = [budgetTip, actualTip].filter(Boolean).join(" \u00b7 ") || undefined;
  const variance = totals.budget.total - totals.actual.total;

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
      {/* Description */}
      {card.description && (
        <Paper sx={{ p: 2.5 }}>
          <Typography variant="subtitle1" fontWeight={600} mb={1}>
            {t("common:labels.description")}
          </Typography>
          <Typography
            variant="body2"
            sx={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}
          >
            <LinkifiedText text={card.description} />
          </Typography>
        </Paper>
      )}

      {/* Timeline, with Completion beside the dates */}
      <Paper sx={{ p: 2.5 }}>
        <Typography variant="subtitle1" fontWeight={600} mb={1}>
          {t("timeline")}
        </Typography>
        <Box sx={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 3 }}>
          <Box sx={{ flex: "1 1 320px", minWidth: 0 }}>
            <PpmInitiativeTimeline schedule={schedule.data} name={card.name} />
          </Box>
          <Box sx={{ flex: "0 1 280px" }}>
            <Typography variant="body2" fontWeight={600} mb={1}>
              {t("completion")}
            </Typography>
            {completionError ? (
              <Alert severity="error">
                {completionError.message || t("common:errors.generic")}
              </Alert>
            ) : completionLoading ? (
              <LinearProgress />
            ) : completion.wbs_count === 0 ? (
              <Typography variant="body2" color="text.secondary">
                {t("noWbsItems")}
              </Typography>
            ) : (
              <Box display="flex" alignItems="center" gap={2}>
                <CompletionRing value={completionPct} />
                <Typography variant="body2" color="text.secondary">
                  {t("completionDesc")}
                </Typography>
              </Box>
            )}
          </Box>
        </Box>
      </Paper>

      <Paper sx={{ p: 2.5 }}>
        <PpmHealthSummary
          report={latestReport}
          costHealth={schedule.data?.cost_health}
          onManage={canEdit ? () => setDialog("report") : undefined}
        />
      </Paper>

      <Paper sx={{ p: 2.5 }}>
        <PpmRiskSummary
          risks={risks}
          onManage={canEdit ? () => setDialog("risks") : undefined}
        />
      </Paper>

      {/* Financials — KPIs + Budget Bars combined */}
      {canViewCosts && <Paper sx={{ p: 2.5 }}>
        <Typography variant="subtitle1" fontWeight={600} mb={2}>
          {t("financials")}
        </Typography>
        {/* auto-fit rather than a breakpoint: the KPI row's room follows the panel, not the viewport. */}
        <Box
          sx={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(112px, 1fr))",
            columnGap: 3,
            rowGap: 1.5,
            mb: 2.5,
          }}
        >
          <Box>
            <Typography variant="caption" color="text.secondary">
              {t("totalBudget")}
            </Typography>
            <Typography variant="h6" fontWeight={600} sx={KPI_VALUE_SX}>
              <DerivedValue tip={budgetTip}>{kpiAmount(totals.budget.total)}</DerivedValue>
            </Typography>
          </Box>
          <Box>
            <Typography variant="caption" color="text.secondary">
              {t("totalActual")}
            </Typography>
            <Typography variant="h6" fontWeight={600} sx={KPI_VALUE_SX}>
              <DerivedValue tip={actualTip}>{kpiAmount(totals.actual.total)}</DerivedValue>
            </Typography>
          </Box>
          <Box>
            <Typography variant="caption" color="text.secondary">
              {t("variance")}
            </Typography>
            <Typography
              variant="h6"
              fontWeight={600}
              color={variance < 0 ? "error" : "success.main"}
              sx={KPI_VALUE_SX}
            >
              <DerivedValue tip={varianceTip}>{kpiAmount(variance)}</DerivedValue>
            </Typography>
          </Box>
        </Box>
        <BudgetBar
          label={t("budgetBarTotal")}
          budget={totals.budget.total}
          actual={totals.actual.total}
          currency={currency}
          barColor={budgetBarColor}
          overColor={overBudgetColor}
          derivedBudget={totals.budget.derived}
          derivedActual={totals.actual.derived}
        />
        <BudgetBar
          label={t("capex")}
          budget={totals.budget.capex}
          actual={totals.actual.capex}
          currency={currency}
          barColor={budgetBarColor}
          overColor={overBudgetColor}
          derivedBudget={totals.budget.derived}
          derivedActual={totals.actual.derived}
        />
        <BudgetBar
          label={t("opex")}
          budget={totals.budget.opex}
          actual={totals.actual.opex}
          currency={currency}
          barColor={budgetBarColor}
          overColor={overBudgetColor}
          derivedBudget={totals.budget.derived}
          derivedActual={totals.actual.derived}
        />
        {showBeneath && (
          <Box data-testid="ppm-beneath" sx={BENEATH_SX}>
            <Typography variant="body2" fontWeight={600}>
              {t("beneathThisInitiative", { count: rollup.descendant_count })}
            </Typography>
            {/* When both sides are already the figures beneath, the KPIs say it. */}
            {rollup.total_planned != null && rollup.total_actual != null
              && !(totals.budget.derived && totals.actual.derived) && (
              <Typography variant="body2" color="text.secondary">
                {t("beneathFigures", {
                  budget: fmt.format(rollup.total_planned),
                  actual: fmt.format(rollup.total_actual),
                })}
              </Typography>
            )}
            {(rollup.start_date || rollup.end_date) && (
              <Typography variant="body2" color="text.secondary">
                {t("beneathSpan", {
                  from: fmtSpanDate(rollup.start_date),
                  to: fmtSpanDate(rollup.end_date),
                })}
              </Typography>
            )}
          </Box>
        )}
      </Paper>}

      {dialog === "report" && (
        <StatusReportDialog
          initiativeId={card.id}
          onClose={() => setDialog(null)}
          onSaved={() => {
            setDialog(null);
            onRefresh();
          }}
        />
      )}
      {dialog === "risks" && (
        <PpmManageDialog
          card={card}
          tab="risks"
          onClose={() => setDialog(null)}
          onChanged={onRefresh}
        />
      )}
    </Box>
  );
}
