/**
 * ArchimateSandboxPage — admin-only list of the ArchiMate diagrams (create / open / delete).
 * Route: /admin/archimate
 *
 * ArchiMate diagrams are hidden from the Diagrams menu in this release, so this page is the only
 * place they are listed. Every failure is shown, never swallowed.
 */
import { useCallback, useEffect, useState } from "react";
import { Link as RouterLink, useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogContentText from "@mui/material/DialogContentText";
import DialogTitle from "@mui/material/DialogTitle";
import List from "@mui/material/List";
import ListItem from "@mui/material/ListItem";
import ListItemText from "@mui/material/ListItemText";
import Snackbar from "@mui/material/Snackbar";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { api } from "@/api/client";
import { useDateFormat } from "@/hooks/useDateFormat";
import { ARCHIMATE_FORMAT, emptyModel } from "./exchange/exchangeModel";
import { writeExchange } from "./exchange/writeExchange";
import { describeApiError } from "./saveError";

interface DiagramRow {
  id: string;
  name: string;
  updated_at?: string | null;
}

export default function ArchimateSandboxPage() {
  const { t } = useTranslation(["archimate", "common"]);
  const navigate = useNavigate();
  const { formatDate } = useDateFormat();

  const [rows, setRows] = useState<DiagramRow[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [reloads, setReloads] = useState(0);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [toDelete, setToDelete] = useState<DiagramRow | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [snack, setSnack] = useState("");

  useEffect(() => {
    let current = true;
    api
      .get<DiagramRow[]>("/diagrams?kind=archimate")
      .then((r) => {
        if (!current) return;
        setRows(r);
        setLoadFailed(false);
      })
      .catch(() => {
        if (current) setLoadFailed(true);
      });
    return () => {
      current = false;
    };
  }, [reloads]);

  const closeCreate = () => {
    setCreating(false);
    setName("");
    setCreateError(null);
  };

  const create = useCallback(async () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    setBusy(true);
    setCreateError(null);
    try {
      const made = await api.post<{ id: string }>("/diagrams", {
        name: trimmed,
        kind: "archimate",
        data: { format: ARCHIMATE_FORMAT, xml: writeExchange(emptyModel(trimmed)) },
      });
      navigate(`/admin/archimate/${made.id}`);
    } catch (e) {
      setCreateError(
        t("archimate:sandbox.createFailed", { reason: describeApiError(e, t("common:errors.generic")) }),
      );
    } finally {
      setBusy(false);
    }
  }, [name, navigate, t]);

  const remove = async () => {
    if (!toDelete) return;
    setBusy(true);
    setDeleteError(null);
    try {
      await api.delete(`/diagrams/${toDelete.id}`);
      setToDelete(null);
      setSnack(t("archimate:sandbox.deleted"));
      setReloads((n) => n + 1);
    } catch (e) {
      setDeleteError(describeApiError(e, t("common:errors.generic")));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Box sx={{ maxWidth: 900, mx: "auto", p: 2 }}>
      <Typography variant="h5" fontWeight={600} gutterBottom>
        {t("archimate:sandbox.title")}
      </Typography>
      <Typography color="text.secondary" sx={{ mb: 2 }}>
        {t("archimate:sandbox.intro")}
      </Typography>
      <Button variant="contained" onClick={() => setCreating(true)} sx={{ mb: 2 }}>
        {t("archimate:sandbox.newDiagram")}
      </Button>

      {loadFailed && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {t("archimate:sandbox.loadFailed")}
        </Alert>
      )}
      {rows && rows.length === 0 && (
        <Typography color="text.secondary">{t("archimate:sandbox.empty")}</Typography>
      )}
      {rows && rows.length > 0 && (
        <List disablePadding>
          {rows.map((d) => (
            <ListItem
              key={d.id}
              divider
              secondaryAction={
                <Box sx={{ display: "flex", gap: 1 }}>
                  <Button size="small" component={RouterLink} to={`/admin/archimate/${d.id}`}>
                    {t("archimate:sandbox.open")}
                  </Button>
                  <Button size="small" color="error" onClick={() => setToDelete(d)}>
                    {t("archimate:sandbox.delete")}
                  </Button>
                </Box>
              }
            >
              <ListItemText
                primary={d.name}
                secondary={
                  d.updated_at ? t("archimate:sandbox.updated", { date: formatDate(d.updated_at) }) : undefined
                }
              />
            </ListItem>
          ))}
        </List>
      )}

      <Typography variant="caption" color="text.secondary" component="p" sx={{ mt: 4 }}>
        {t("archimate:trademark")}
      </Typography>

      <Dialog open={creating} onClose={busy ? undefined : closeCreate} fullWidth maxWidth="xs">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void create();
          }}
        >
          <DialogTitle>{t("archimate:sandbox.newDiagram")}</DialogTitle>
          <DialogContent>
            {createError && (
              <Alert severity="error" sx={{ mb: 2 }}>
                {createError}
              </Alert>
            )}
            <TextField
              autoFocus
              fullWidth
              margin="dense"
              label={t("archimate:sandbox.name")}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </DialogContent>
          <DialogActions>
            <Button onClick={closeCreate} disabled={busy}>
              {t("common:actions.cancel")}
            </Button>
            <Button type="submit" variant="contained" disabled={busy || !name.trim()}>
              {t("archimate:sandbox.create")}
            </Button>
          </DialogActions>
        </form>
      </Dialog>

      <Dialog open={!!toDelete} onClose={busy ? undefined : () => setToDelete(null)}>
        <DialogTitle>{t("archimate:sandbox.deleteTitle")}</DialogTitle>
        <DialogContent>
          {deleteError && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {deleteError}
            </Alert>
          )}
          <DialogContentText>
            {t("archimate:sandbox.deleteBody", { name: toDelete?.name ?? "" })}
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setToDelete(null)} disabled={busy}>
            {t("common:actions.cancel")}
          </Button>
          <Button color="error" variant="contained" onClick={() => void remove()} disabled={busy}>
            {t("archimate:sandbox.delete")}
          </Button>
        </DialogActions>
      </Dialog>

      <Snackbar open={!!snack} autoHideDuration={4000} onClose={() => setSnack("")} message={snack} />
    </Box>
  );
}
