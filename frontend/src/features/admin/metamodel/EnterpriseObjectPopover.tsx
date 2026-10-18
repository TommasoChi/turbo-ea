import { useState } from "react";
import { useTranslation } from "react-i18next";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import IconButton from "@mui/material/IconButton";
import Popover from "@mui/material/Popover";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import MaterialSymbol from "@/components/MaterialSymbol";
import { updateEnterpriseObject } from "@/api/enterpriseObjects";
import type { EnterpriseObject } from "@/types";

interface Props {
  object: EnterpriseObject;
  anchorEl: HTMLElement | null;
  onClose: () => void;
  /** Gates the pencil/edit affordance. Always false in the drawing palette (spec Anti-goals). */
  canEdit: boolean;
}

/**
 * Click-triggered popover showing an Enterprise Object's icon/name/description, with an
 * inline-editable description for users with `admin.metamodel`. Used both by the Card Mapping
 * admin list and (read-only) by the Architecture Studio drawing palette.
 */
export default function EnterpriseObjectPopover({ object, anchorEl, onClose, canEdit }: Props) {
  const { t } = useTranslation(["admin", "common"]);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(object.description ?? "");
  // The description actually shown read-only: the object's own value until a save succeeds,
  // then the saved text -- the caller may not re-fetch and hand back a fresh `object` before the
  // popover is next opened.
  const [description, setDescription] = useState(object.description ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const startEdit = () => {
    setDraft(description);
    setError(null);
    setEditing(true);
  };
  const cancelEdit = () => {
    setEditing(false);
    setError(null);
  };
  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await updateEnterpriseObject(object.key, { description: draft });
      setDescription(draft);
      setEditing(false);
    } catch {
      setError(t("metamodel.typeDrawer.failedToSave"));
    } finally {
      setSaving(false);
    }
  };
  const handleClose = () => {
    setEditing(false);
    setError(null);
    onClose();
  };

  return (
    <Popover
      open={!!anchorEl}
      anchorEl={anchorEl}
      onClose={handleClose}
      anchorOrigin={{ vertical: "bottom", horizontal: "left" }}
      // MUI's default on close is to call .focus() back on whatever element was focused when the
      // popover opened. In the drawing palette that's the info badge the click opened it from --
      // a native click already focuses a <button> in Chrome/Firefox -- so without this, closing
      // (Escape, backdrop click, Save/Cancel) would hand focus straight back to the badge, and a
      // following Enter/Space would fall through to the palette tile's own drop handling and
      // silently place an element. The badge is deliberately not a Tab stop (read-only
      // convenience, same text reachable via the admin list); restoring focus to it on close
      // would undermine that by making it reachable via this back door instead.
      disableRestoreFocus
    >
      <Box sx={{ p: 2, width: 320 }}>
        <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1 }}>
          <MaterialSymbol icon={object.icon} size={20} color={object.color} />
          <Typography variant="subtitle2" sx={{ flex: 1 }}>
            {object.name}
          </Typography>
          {canEdit && !editing && (
            <IconButton size="small" aria-label={t("metamodel.editDescription")} onClick={startEdit}>
              <MaterialSymbol icon="edit" size={16} />
            </IconButton>
          )}
        </Stack>

        {error && (
          <Alert severity="error" sx={{ mb: 1 }} onClose={() => setError(null)}>
            {error}
          </Alert>
        )}

        {editing ? (
          <Stack spacing={1}>
            <TextField
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              multiline
              minRows={2}
              maxRows={6}
              fullWidth
              autoFocus
              disabled={saving}
            />
            <Stack direction="row" spacing={1} justifyContent="flex-end">
              <Button size="small" onClick={cancelEdit} disabled={saving}>
                {t("common:actions.cancel")}
              </Button>
              <Button size="small" variant="contained" onClick={() => void save()} disabled={saving}>
                {t("common:actions.save")}
              </Button>
            </Stack>
          </Stack>
        ) : (
          <Typography variant="body2" color="text.secondary">
            {description || t("metamodel.noDescription")}
          </Typography>
        )}
      </Box>
    </Popover>
  );
}
