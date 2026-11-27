import Box from "@mui/material/Box";
import { useState } from "react";
import PpmHealthSummary from "./PpmHealthSummary";
import PpmRiskSummary from "./PpmRiskSummary";
import StatusReportDialog from "./StatusReportDialog";
import { usePpmLatestReport, usePpmRisks, usePpmSchedule } from "./usePpmFinancials";

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
  const [editing, setEditing] = useState(false);
  const { data: report } = usePpmLatestReport(initiativeId, revision);
  const { data: schedule } = usePpmSchedule(initiativeId, revision);
  const { data: risks } = usePpmRisks(initiativeId, revision);
  return (
    <>
      <Box sx={{ mb: 2 }}>
        <PpmHealthSummary
          report={report}
          costHealth={schedule?.cost_health}
          onManage={canManage ? () => setEditing(true) : undefined}
        />
      </Box>
      <Box sx={{ mb: 2 }}>
        <PpmRiskSummary risks={risks} onManage={canManage ? onManageRisks : undefined} />
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
