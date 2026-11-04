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
import { DateField } from "@/components/DateField";
import MaterialSymbol from "@/components/MaterialSymbol";
import { useCurrency } from "@/hooks/useCurrency";
import { shortFiscalYear } from "@/lib/costItems";
import type { CostItemType, CostLine } from "@/types";

interface Props {
  cardId: string;
  fiscalYear: number;
  forecastYear: number;
  /** The line being edited; `null` adds a new one (the item is then chosen). */
  line: CostLine | null;
  /** Add mode: the active catalogue items not yet set for this year. */
  options: CostItemType[];
  /** The label of a catalogue key (archived items included). */
  labelOf: (key: string) => string;
  onClose: () => void;
  /** After a save or delete went through; the section reloads. */
  onChanged: (opts?: { keepOpen?: boolean }) => void;
}

export default function CostItemDialog({
  cardId,
  fiscalYear,
  forecastYear,
  line,
  options,
  labelOf,
  onClose,
  onChanged,
}: Props) {
  const { t } = useTranslation("cards");
  const { t: tc } = useTranslation("common");
  const { symbol } = useCurrency();
  const [key, setKey] = useState(line?.key ?? "");
  const [amount, setAmount] = useState(line ? String(line.amount) : "");
  const [renewal, setRenewal] = useState(line?.renewal_date ?? "");
  const [copy, setCopy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copyError, setCopyError] = useState<string | null>(null);

  const editing = line !== null;
  const base = `/cards/${cardId}/costs/${fiscalYear}/items/${key}`;
  const amountNumber = amount.trim() === "" ? NaN : Number(amount);
  const amountValid = Number.isFinite(amountNumber) && amountNumber >= 0;
  const canSave = !busy && key !== "" && amountValid;

  const run = async (action: () => Promise<unknown>, failure: string) => {
    setBusy(true);
    setError(null);
    try {
      await action();
      onChanged();
    } catch (e) {
      setError(apiErrorMessage(e, failure));
      setBusy(false);
    }
  };

  const save = async () => {
    setBusy(true);
    setError(null);
    setCopyError(null);
    try {
      await api.put(base, { amount: amountNumber, renewal_date: renewal || null });
    } catch (e) {
      setError(apiErrorMessage(e, t("costs.dialog.saveFailed")));
      setBusy(false);
      return;
    }
    if (!copy) return onChanged();
    try {
      await api.post(`${base}/copy-to-forecast`);
      onChanged();
    } catch (e) {
      // The amount is stored: reload the section behind, keep the dialog to say the copy failed.
      onChanged({ keepOpen: true });
      setCopyError(apiErrorMessage(e, t("costs.dialog.copyFailed")));
      setBusy(false);
    }
  };

  const remove = () => run(() => api.delete(base), t("costs.dialog.deleteFailed"));

  return (
    <Dialog open onClose={busy ? undefined : onClose} maxWidth="xs" fullWidth>
      <DialogTitle>
        {t(editing ? "costs.dialog.editTitle" : "costs.dialog.addTitle", {
          year: shortFiscalYear(fiscalYear),
        })}
      </DialogTitle>
      <DialogContent sx={{ display: "flex", flexDirection: "column", gap: 2, pt: "8px !important" }}>
        {error && <Alert severity="error">{error}</Alert>}
        {copyError && (
          <Alert severity="warning">
            {t("costs.dialog.savedCopyFailed")} {copyError}
          </Alert>
        )}
        {editing ? (
          <TextField
            label={t("costs.dialog.item")}
            value={labelOf(line.key)}
            size="small"
            slotProps={{ input: { readOnly: true } }}
          />
        ) : (
          <TextField
            select
            label={t("costs.dialog.item")}
            value={key}
            onChange={(e) => setKey(e.target.value)}
            size="small"
            helperText={key === "" ? t("costs.dialog.itemPlaceholder") : undefined}
          >
            {options.map((o) => (
              <MenuItem key={o.key} value={o.key}>
                {labelOf(o.key)}
              </MenuItem>
            ))}
          </TextField>
        )}
        <TextField
          label={t("costs.dialog.amount", { currency: symbol })}
          type="number"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          size="small"
          autoFocus={editing}
          error={amount !== "" && !amountValid}
          helperText={amount !== "" && !amountValid ? t("costs.dialog.invalidAmount") : undefined}
          slotProps={{ htmlInput: { min: 0, step: "any" } }}
        />
        <DateField
          label={t("costs.dialog.renewalDate")}
          value={renewal}
          onChange={setRenewal}
          size="small"
        />
        {fiscalYear < forecastYear && (
          <FormControlLabel
            control={<Checkbox checked={copy} onChange={(e) => setCopy(e.target.checked)} />}
            label={t("costs.dialog.copyToForecast", { year: shortFiscalYear(forecastYear) })}
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
