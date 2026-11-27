import Box from "@mui/material/Box";
import { useTheme } from "@mui/material/styles";
import { useTranslation } from "react-i18next";
import { useCurrency } from "@/hooks/useCurrency";
import { BudgetBar } from "./ppmVisuals";
import { usePpmFinancials } from "./usePpmFinancials";

/** The Initiative card's Cost group: one Total budget vs cost bar. */
export default function InitiativeFinancialSummary({ initiativeId, revision }: { initiativeId: string; revision: number }) {
  const { t } = useTranslation("ppm");
  const theme = useTheme();
  const { currency } = useCurrency();
  const { data } = usePpmFinancials(initiativeId, revision);
  const comparison = data?.card_comparison;
  if (!comparison) return null;
  return (
    <Box>
      <BudgetBar
        label={t("budgetBarTotal")}
        budget={Number(comparison.budget.total)}
        actual={Number(comparison.actual.total)}
        currency={currency}
        barColor={theme.palette.primary.main}
        overColor={theme.palette.error.dark}
        derivedBudget={comparison.budget.derived}
        derivedActual={comparison.actual.derived}
      />
    </Box>
  );
}
