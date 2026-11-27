import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import CircularProgress from "@mui/material/CircularProgress";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import { lazy, Suspense } from "react";
import { useTranslation } from "react-i18next";
import { useApiQuery } from "@/hooks/useApiQuery";
import type { Card, PpmRisk, PpmRollupOut, PpmStatusReport } from "@/types";

const PpmCostTab = lazy(() => import("./PpmCostTab"));
const PpmGanttTab = lazy(() => import("./PpmGanttTab"));
const PpmReportsTab = lazy(() => import("./PpmReportsTab"));
const PpmRiskTab = lazy(() => import("./PpmRiskTab"));

interface Props {
  card: Card;
  tab: "cost" | "gantt" | "reports" | "risks";
  onClose: () => void;
  onChanged: () => void;
}

export default function PpmManageDialog({ card, tab, onClose, onChanged }: Props) {
  const { t } = useTranslation(["ppm", "common"]);
  const rollup = useApiQuery<PpmRollupOut>(
    tab === "cost" ? "/ppm/initiatives/" + encodeURIComponent(card.id) + "/rollup" : null,
    { keepPreviousData: false },
  );
  const reports = useApiQuery<PpmStatusReport[]>(
    tab === "reports" ? "/ppm/initiatives/" + encodeURIComponent(card.id) + "/reports" : null,
    { keepPreviousData: false },
  );
  const risks = useApiQuery<PpmRisk[]>(
    tab === "risks" ? "/ppm/initiatives/" + encodeURIComponent(card.id) + "/risks" : null,
    { keepPreviousData: false },
  );
  const titles: Record<Props["tab"], string> = {
    cost: t("budgetAndCosts"),
    gantt: t("gantt"),
    reports: t("statusReports"),
    risks: t("riskManagement"),
  };
  const title = titles[tab];

  return (
    <Dialog
      open
      onClose={onClose}
      fullWidth
      maxWidth="xl"
      disableRestoreFocus
      aria-labelledby="ppm-manage-title"
    >
      <DialogTitle id="ppm-manage-title">{title}</DialogTitle>
      <DialogContent dividers>
        {rollup.error && <Alert severity="error">{rollup.error.message}</Alert>}
        {reports.error && <Alert severity="error">{reports.error.message}</Alert>}
        {risks.error && <Alert severity="error">{risks.error.message}</Alert>}
        <Suspense
          fallback={
            <Box display="flex" justifyContent="center">
              <CircularProgress />
            </Box>
          }
        >
          {tab === "cost" ? (
            <PpmCostTab
              initiativeId={card.id}
              costLines={[]}
              rollup={rollup.data ?? null}
              canEdit
              onRefresh={onChanged}
            />
          ) : tab === "reports" ? (
            reports.data ? (
              <PpmReportsTab
                initiativeId={card.id}
                reports={reports.data}
                canEdit
                onRefresh={() => {
                  reports.refetch();
                  onChanged();
                }}
              />
            ) : reports.loading ? (
              <CircularProgress />
            ) : null
          ) : tab === "risks" ? (
            risks.data ? (
              <PpmRiskTab
                initiativeId={card.id}
                risks={risks.data}
                canEdit
                initiativeName={card.name}
                onRefresh={() => {
                  risks.refetch();
                  onChanged();
                }}
              />
            ) : risks.loading ? (
              <CircularProgress />
            ) : null
          ) : (
            <PpmGanttTab initiativeId={card.id} card={card} canEdit />
          )}
        </Suspense>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t("common:actions.close")}</Button>
      </DialogActions>
    </Dialog>
  );
}
