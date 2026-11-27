import { useEffect, useState } from "react";
import Alert from "@mui/material/Alert";
import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import DialogActions from "@mui/material/DialogActions";
import Button from "@mui/material/Button";
import TextField from "@mui/material/TextField";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import Typography from "@mui/material/Typography";
import Box from "@mui/material/Box";
import CircularProgress from "@mui/material/CircularProgress";
import { useTranslation } from "react-i18next";
import { DateField } from "@/components/DateField";
import { api } from "@/api/client";
import { todayIsoDate } from "@/lib/dates";
import { useFullScreenDialog } from "@/hooks/useFullScreenDialog";
import { useOptionalAuthUser } from "@/hooks/AuthContext";
import { usePermissions } from "@/hooks/usePermissions";
import { RAG_COLORS } from "@/theme/tokens";
import type { PpmStatusReport, PpmHealthValue } from "@/types";

interface Props {
  initiativeId: string;
  report?: PpmStatusReport;
  onClose: () => void;
  onSaved: () => void;
}

export const STATUS_TEXT_LIMIT = 250;

const HEALTH_FILL: Record<PpmHealthValue, string> = {
  onTrack: RAG_COLORS.green,
  atRisk: RAG_COLORS.amber,
  offTrack: RAG_COLORS.red,
};

/** One RAG picker. Module scope: defined inline it was a fresh component type
 * on every render, remounting all three groups on each keystroke. */
function HealthToggle({
  label,
  value,
  onChange,
}: {
  label: string;
  value: PpmHealthValue;
  onChange: (v: PpmHealthValue) => void;
}) {
  const { t } = useTranslation("ppm");
  return (
    <Box sx={{ minWidth: 0 }}>
      <Typography variant="caption" fontWeight={600} mb={0.5} display="block">
        {label}
      </Typography>
      <ToggleButtonGroup
        value={value}
        exclusive
        onChange={(_, v) => v && onChange(v)}
        size="small"
        sx={{ width: { xs: "100%", sm: "auto" } }}
      >
        {(["onTrack", "atRisk", "offTrack"] as const).map((v) => (
          <ToggleButton
            key={v}
            value={v}
            sx={{
              flex: { xs: 1, sm: "none" },
              px: { xs: 0.5, sm: 1.5 },
              fontSize: { xs: "0.7rem", sm: "0.8125rem" },
              lineHeight: 1.2,
              "&.Mui-selected": {
                bgcolor: HEALTH_FILL[v],
                // Stryker disable next-line StringLiteral: the ink is presentation
      color: "common.white",
                "&:hover": { bgcolor: HEALTH_FILL[v] },
              },
            }}
          >
            {t(`health_${v}`)}
          </ToggleButton>
        ))}
      </ToggleButtonGroup>
    </Box>
  );
}

export default function StatusReportDialog({
  initiativeId,
  report,
  onClose,
  onSaved,
}: Props) {
  const { t } = useTranslation("ppm");
  const fullScreen = useFullScreenDialog();
  const isEdit = !!report;
  const user = useOptionalAuthUser();
  const { loadCardPermissions, canOnCard } = usePermissions(user);
  useEffect(() => {
    if (!isEdit) void loadCardPermissions(initiativeId);
  }, [initiativeId, isEdit, loadCardPermissions]);
  const canShowCost = isEdit ? report.cost_health !== null : canOnCard(initiativeId, "can_view_costs");

  const [reportDate, setReportDate] = useState(
    report?.report_date || todayIsoDate(),
  );
  const [scheduleHealth, setScheduleHealth] = useState<PpmHealthValue>(
    (report?.schedule_health as PpmHealthValue) || "onTrack",
  );
  const [costHealth, setCostHealth] = useState<PpmHealthValue | null>(
    report ? report.cost_health as PpmHealthValue | null : "onTrack",
  );
  const [scopeHealth, setScopeHealth] = useState<PpmHealthValue>(
    (report?.scope_health as PpmHealthValue) || "onTrack",
  );
  const [summary, setSummary] = useState(report?.summary || "");
  const [accomplishments, setAccomplishments] = useState(
    report?.accomplishments || "",
  );
  const [nextSteps, setNextSteps] = useState(report?.next_steps || "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Edit sends only the texts the user changed, so a stored text over the limit never blocks a save.
  const texts = {
    summary: { value: summary, stored: report?.summary },
    accomplishments: { value: accomplishments, stored: report?.accomplishments },
    next_steps: { value: nextSteps, stored: report?.next_steps },
  };
  const sentTexts = Object.entries(texts).filter(
    ([, { value, stored }]) => !isEdit || value !== (stored ?? ""),
  );
  const tooLong = sentTexts.some(([, { value }]) => value.length > STATUS_TEXT_LIMIT);
  const counted = (label: string, value: string) => ({
    label: t("statusReportCounter", { label, count: value.length }),
    error: value.length > STATUS_TEXT_LIMIT,
    helperText:
      value.length > STATUS_TEXT_LIMIT
        ? t("statusReportTooLong", { limit: STATUS_TEXT_LIMIT })
        : undefined,
  });

  const handleSave = async () => {
    setSaving(true);
    try {
      const payload = {
        report_date: reportDate,
        schedule_health: scheduleHealth,
        ...(!canShowCost || costHealth === null ? {} : { cost_health: costHealth }),
        scope_health: scopeHealth,
        ...Object.fromEntries(sentTexts.map(([key, { value }]) => [key, value || null])),
      };
      if (isEdit) {
        await api.patch(`/ppm/reports/${report.id}`, payload);
      } else {
        await api.post(`/ppm/initiatives/${initiativeId}/reports`, payload);
      }
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("common:errors.generic"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open
      disableRestoreFocus
      onClose={onClose}
      maxWidth="md"
      fullWidth
      fullScreen={fullScreen}
    >
      <DialogTitle>{isEdit ? t("editReport") : t("addReport")}</DialogTitle>
      <DialogContent>
        {error && (
          // Stryker disable next-line ObjectLiteral: spacing is presentation
          <Alert severity="error" sx={{ mb: 1 }}>
            {error}
          </Alert>
        )}
        <Box display="flex" flexDirection="column" gap={2.5} mt={1}>
          <DateField
            label={t("reportDate")}
            value={reportDate}
            onChange={(v) => setReportDate(v)}
            size="small"
            sx={{ maxWidth: 200 }}
          />

          <Box
            display="flex"
            flexDirection={{ xs: "column", sm: "row" }}
            gap={{ xs: 1.5, sm: 3 }}
            flexWrap="wrap"
          >
            <HealthToggle
              label={t("health_schedule")}
              value={scheduleHealth}
              onChange={setScheduleHealth}
            />
            {canShowCost && costHealth !== null && (
              <HealthToggle
                label={t("health_cost")}
                value={costHealth}
                onChange={setCostHealth}
              />
            )}
            <HealthToggle
              label={t("health_scope")}
              value={scopeHealth}
              onChange={setScopeHealth}
            />
          </Box>

          <TextField
            {...counted(t("summary"), summary)}
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            multiline
            rows={3}
            fullWidth
          />

          <TextField
            {...counted(t("accomplishments"), accomplishments)}
            value={accomplishments}
            onChange={(e) => setAccomplishments(e.target.value)}
            multiline
            rows={3}
            fullWidth
          />

          <TextField
            {...counted(t("nextSteps"), nextSteps)}
            value={nextSteps}
            onChange={(e) => setNextSteps(e.target.value)}
            multiline
            rows={3}
            fullWidth
          />
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t("common:actions.cancel", "Cancel")}</Button>
        <Button
          variant="contained"
          onClick={handleSave}
          disabled={saving || tooLong}
          startIcon={saving ? <CircularProgress size={16} /> : undefined}
        >
          {isEdit ? t("common:actions.save", "Save") : t("addReport")}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
