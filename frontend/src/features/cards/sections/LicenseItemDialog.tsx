import { useState } from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Checkbox from "@mui/material/Checkbox";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import FormControlLabel from "@mui/material/FormControlLabel";
import MenuItem from "@mui/material/MenuItem";
import TextField from "@mui/material/TextField";
import { useTranslation } from "react-i18next";
import { api, apiErrorMessage } from "@/api/client";
import MaterialSymbol from "@/components/MaterialSymbol";
import { shortFiscalYear } from "@/lib/costItems";
import type { LicenseMetric, LicenseType } from "@/types";

export interface LicenseCell {
  metric: LicenseMetric;
  key: string;
  licensed: number;
  actual: number | null;
}

interface Props {
  cardId: string;
  fiscalYear: number;
  forecastYear: number;
  /** The metrics the card tracks (its `licensingModel`). */
  metrics: LicenseMetric[];
  /** The cell being edited; `null` adds a new one (metric and type are then chosen). */
  cell: LicenseCell | null;
  /** Add mode: the active license types. */
  options: LicenseType[];
  /** The label of a catalogue key (archived types included). */
  labelOf: (key: string) => string;
  onClose: () => void;
  /** After a save or delete went through; the section reloads. */
  onChanged: (opts?: { keepOpen?: boolean }) => void;
}

const MAX_COUNT = 1_000_000_000;
const ERROR_CODES = [
  "unknown_type",
  "archived_type",
  "invalid_metric",
  "invalid_count",
  "forecast_actual",
  "year_out_of_range",
];

const isCount = (s: string) => /^\d+$/.test(s) && Number(s) <= MAX_COUNT;

export default function LicenseItemDialog({
  cardId,
  fiscalYear,
  forecastYear,
  metrics,
  cell,
  options,
  labelOf,
  onClose,
  onChanged,
}: Props) {
  const { t } = useTranslation("cards");
  const { t: tc } = useTranslation("common");
  const [metric, setMetric] = useState<string>(cell?.metric ?? "");
  const [key, setKey] = useState(cell?.key ?? "");
  const [licensed, setLicensed] = useState(cell ? String(cell.licensed) : "");
  const [actual, setActual] = useState(cell?.actual != null ? String(cell.actual) : "");
  const [copy, setCopy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copyError, setCopyError] = useState<string | null>(null);

  const editing = cell !== null;
  const isForecast = fiscalYear === forecastYear;
  const base = `/cards/${cardId}/licenses/${fiscalYear}/items/${metric}/${key}`;
  const licensedValid = isCount(licensed.trim());
  const actualValid = isForecast || actual.trim() === "" || isCount(actual.trim());
  const canSave = !busy && metric !== "" && key !== "" && licensedValid && actualValid;

  const failure = (e: unknown, fallback: string): string => {
    const msg = apiErrorMessage(e, fallback);
    return ERROR_CODES.includes(msg) ? t(`licensing.errors.${msg}`) : msg;
  };

  const save = async () => {
    setBusy(true);
    setError(null);
    setCopyError(null);
    try {
      await api.put(base, {
        licensed: Number(licensed),
        actual: isForecast || actual.trim() === "" ? null : Number(actual),
      });
    } catch (e) {
      setError(failure(e, t("licensing.dialog.saveFailed")));
      setBusy(false);
      return;
    }
    if (!copy) return onChanged();
    try {
      await api.post(`${base}/copy-to-forecast`);
      onChanged();
    } catch (e) {
      // The counts are stored: reload the section behind, keep the dialog to say the copy failed.
      onChanged({ keepOpen: true });
      setCopyError(failure(e, t("licensing.dialog.copyFailed")));
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.delete(base);
      onChanged();
    } catch (e) {
      setError(failure(e, t("licensing.dialog.deleteFailed")));
      setBusy(false);
    }
  };

  return (
    <Dialog open onClose={busy ? undefined : onClose} maxWidth="xs" fullWidth>
      <DialogTitle>
        {t(editing ? "licensing.dialog.editTitle" : "licensing.dialog.addTitle", {
          year: shortFiscalYear(fiscalYear),
        })}
      </DialogTitle>
      <DialogContent sx={{ display: "flex", flexDirection: "column", gap: 2, pt: "8px !important" }}>
        {error && <Alert severity="error">{error}</Alert>}
        {copyError && (
          <Alert severity="warning">
            {t("licensing.dialog.savedCopyFailed")} {copyError}
          </Alert>
        )}
        {editing ? (
          <>
            <TextField
              label={t("licensing.dialog.metric")}
              value={t(`licensing.metrics.${cell.metric}`)}
              size="small"
              slotProps={{ input: { readOnly: true } }}
            />
            <TextField
              label={t("licensing.dialog.type")}
              value={labelOf(cell.key)}
              size="small"
              slotProps={{ input: { readOnly: true } }}
            />
          </>
        ) : (
          <>
            <TextField
              select
              label={t("licensing.dialog.metric")}
              value={metric}
              onChange={(e) => setMetric(e.target.value)}
              size="small"
            >
              {metrics.map((m) => (
                <MenuItem key={m} value={m}>
                  {t(`licensing.metrics.${m}`)}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              select
              label={t("licensing.dialog.type")}
              value={key}
              onChange={(e) => setKey(e.target.value)}
              size="small"
              helperText={key === "" ? t("licensing.dialog.typePlaceholder") : undefined}
            >
              {options.map((o) => (
                <MenuItem key={o.key} value={o.key}>
                  {labelOf(o.key)}
                </MenuItem>
              ))}
            </TextField>
          </>
        )}
        <TextField
          label={t("licensing.dialog.licensed")}
          type="number"
          value={licensed}
          onChange={(e) => setLicensed(e.target.value)}
          size="small"
          autoFocus={editing}
          error={licensed !== "" && !licensedValid}
          helperText={
            licensed !== "" && !licensedValid ? t("licensing.dialog.invalidCount") : undefined
          }
          slotProps={{ htmlInput: { min: 0, step: 1 } }}
        />
        <TextField
          label={t("licensing.dialog.actual")}
          type="number"
          value={isForecast ? "" : actual}
          onChange={(e) => setActual(e.target.value)}
          size="small"
          disabled={isForecast}
          error={!actualValid}
          helperText={
            isForecast
              ? t("licensing.dialog.forecastActualHint")
              : !actualValid
                ? t("licensing.dialog.invalidCount")
                : undefined
          }
          slotProps={{ htmlInput: { min: 0, step: 1 } }}
        />
        {!isForecast && (
          <FormControlLabel
            control={<Checkbox checked={copy} onChange={(e) => setCopy(e.target.checked)} />}
            label={t("licensing.dialog.copyToForecast", { year: shortFiscalYear(forecastYear) })}
          />
        )}
      </DialogContent>
      <DialogActions sx={{ justifyContent: "space-between", px: 3, pb: 2 }}>
        {editing ? (
          <Button
            color="error"
            onClick={remove}
            disabled={busy}
            startIcon={<MaterialSymbol icon="delete" size={18} />}
          >
            {tc("actions.delete")}
          </Button>
        ) : (
          <Box />
        )}
        <Box>
          <Button onClick={onClose} disabled={busy}>
            {tc("actions.cancel")}
          </Button>
          <Button variant="contained" onClick={save} disabled={!canSave}>
            {tc("actions.save")}
          </Button>
        </Box>
      </DialogActions>
    </Dialog>
  );
}
