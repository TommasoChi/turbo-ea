/**
 * Creates a card for an element. The ONLY place the ArchiMate feature creates a card, and only on
 * an explicit submit: a failure leaves the dialog open and the element unlinked.
 */
import { useState } from "react";
import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import MenuItem from "@mui/material/MenuItem";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import { useTranslation } from "react-i18next";
import { api } from "@/api/client";
import type { Card } from "@/types";
import type { CardTypeOption } from "./engine/EditorBridge";
import { describeApiError } from "./saveError";

interface Props {
  open: boolean;
  cardTypes: CardTypeOption[];
  initialName: string;
  onCreated: (card: { id: string; name: string }) => void;
  onClose: () => void;
}

export default function CreateCardDialog({ open, cardTypes, initialName, onCreated, onClose }: Props) {
  const { t } = useTranslation(["archimate", "common"]);
  const [type, setType] = useState<string | null>(null);
  const [name, setName] = useState(initialName);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const selected = type !== null && cardTypes.some((c) => c.key === type) ? type : (cardTypes[0]?.key ?? "");

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const created = await api.post<Card>("/cards", { type: selected, name: name.trim() });
      onCreated({ id: created.id, name: created.name ?? name.trim() });
    } catch (e) {
      const reason = describeApiError(e, t("common:errors.generic"));
      setError(t("archimate:createCardDialog.failed", { reason }));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onClose={busy ? undefined : onClose} maxWidth="xs" fullWidth disableRestoreFocus>
      <DialogTitle>{t("archimate:createCardDialog.title")}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          {error && <Alert severity="error">{error}</Alert>}
          <TextField
            select
            size="small"
            label={t("archimate:createCardDialog.type")}
            value={selected}
            onChange={(e) => setType(e.target.value)}
          >
            {cardTypes.map((c) => (
              <MenuItem key={c.key} value={c.key}>{c.label}</MenuItem>
            ))}
          </TextField>
          <TextField
            size="small"
            label={t("archimate:createCardDialog.name")}
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
          />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>{t("common:actions.cancel")}</Button>
        <Button variant="contained" onClick={submit} disabled={busy || !name.trim() || !selected}>
          {t("archimate:createCardDialog.submit")}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
