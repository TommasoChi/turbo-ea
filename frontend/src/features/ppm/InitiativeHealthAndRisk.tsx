import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import PpmHealthSummary from "./PpmHealthSummary";
import PpmRiskSummary from "./PpmRiskSummary";
import StatusReportDialog from "./StatusReportDialog";
import { usePpmLatestReport, usePpmRisks } from "./usePpmFinancials";

interface Props {
  initiativeId: string;
  revision: number;
  /** ppm.manage with card edit: the Manage buttons exist only when true. */
  canManage?: boolean;
  onManageRisks: () => void;
  /** A status report was saved: the caller bumps `revision`. */
  onChanged: () => void;
}

/** The Initiative card page's Health Summary and Risk Management sections. */
export default function InitiativeHealthAndRisk({ initiativeId, revision, canManage, onManageRisks, onChanged }: Props) {
  const { t } = useTranslation("ppm");
  const [editing, setEditing] = useState(false);
  const { data: report, error: reportError } = usePpmLatestReport(initiativeId, revision);
  const { data: risks, error: risksError } = usePpmRisks(initiativeId, revision);
  return (
    <>
      <Box sx={{ mb: 2 }}>
        {reportError ? (
          <Alert severity="error">{reportError.message || t("common:errors.generic")}</Alert>
        ) : (
          <PpmHealthSummary
            report={report}
            costHealth={report?.cost_health}
            onManage={canManage ? () => setEditing(true) : undefined}
          />
        )}
      </Box>
      <Box sx={{ mb: 2 }}>
        {risksError ? (
          <Alert severity="error">{risksError.message || t("common:errors.generic")}</Alert>
        ) : (
          <PpmRiskSummary risks={risks} onManage={canManage ? onManageRisks : undefined} />
        )}
      </Box>
      {editing && (
        <StatusReportDialog
          initiativeId={initiativeId}
          onClose={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            onChanged();
          }}
        />
      )}
    </>
  );
}
