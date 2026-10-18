import { useState } from "react";
import { useTranslation } from "react-i18next";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import DialogActions from "@mui/material/DialogActions";
import TextField from "@mui/material/TextField";
import FormControl from "@mui/material/FormControl";
import InputLabel from "@mui/material/InputLabel";
import Select from "@mui/material/Select";
import MenuItem from "@mui/material/MenuItem";
import ColorPicker from "@/components/ColorPicker";
import IconPicker from "@/components/IconPicker";
import KeyInput, { isValidKey } from "@/components/KeyInput";
import { createEnterpriseObject } from "@/api/enterpriseObjects";
import { LAYER_ORDER, type ArchimateLayer } from "@/features/archimate/taxonomy/elements";

// The 7 standard ArchiMate layers a custom Enterprise Object can belong to --
// `LAYER_ORDER` minus its trailing "other" bucket, which only ever holds the
// four fixed connector/grouping rows (Grouping, Location, AndJunction,
// OrJunction) and is never a choice for a newly created object.
const SELECTABLE_LAYERS: ArchimateLayer[] = LAYER_ORDER.filter((layer) => layer !== "other");

const EMPTY_FORM = {
  key: "",
  name: "",
  layer: SELECTABLE_LAYERS[0],
  icon: "category",
  color: "#1976d2",
  description: "",
};

export interface NewArchitectureObjectDialogProps {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}

/**
 * "New Architecture Object" dialog -- mirrors MetamodelAdmin.tsx's "New Card
 * Type" dialog field-for-field, swapping Card Types' free-text "category" for
 * a closed select over the 7 standard ArchiMate layers. Creates a custom
 * Enterprise Object via Task 7's `createEnterpriseObject`; the backend always
 * forces `is_standard: false, is_locked: false` regardless of what is sent.
 */
export default function NewArchitectureObjectDialog({
  open,
  onClose,
  onCreated,
}: NewArchitectureObjectDialogProps) {
  const { t } = useTranslation(["admin", "archimate", "common"]);
  const [form, setForm] = useState(EMPTY_FORM);

  const handleClose = () => {
    setForm(EMPTY_FORM);
    onClose();
  };

  const handleCreate = async () => {
    await createEnterpriseObject({
      key: form.key,
      name: form.name,
      layer: form.layer,
      icon: form.icon,
      color: form.color,
      description: form.description,
    });
    onCreated();
    setForm(EMPTY_FORM);
    onClose();
  };

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="sm" fullWidth>
      <DialogTitle>{t("metamodel.createArchitectureObject")}</DialogTitle>
      <DialogContent>
        <KeyInput
          fullWidth
          label={t("metamodel.architectureObjectKeyLabel")}
          value={form.key}
          onChange={(v) => setForm({ ...form, key: v })}
          sx={{ mt: 1, mb: 2 }}
          size="small"
          required={!!form.name.trim()}
        />
        <TextField
          fullWidth
          label={t("common:labels.name")}
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
          sx={{ mb: 2 }}
          error={!form.name.trim()}
        />
        <TextField
          fullWidth
          label={t("common:labels.description")}
          value={form.description}
          onChange={(e) => setForm({ ...form, description: e.target.value })}
          sx={{ mb: 2 }}
        />
        <Box sx={{ mb: 2 }}>
          <Typography variant="caption" color="text.secondary" sx={{ mb: 0.5, display: "block" }}>
            {t("metamodel.iconLabel")}
          </Typography>
          <IconPicker
            value={form.icon}
            onChange={(v) => setForm({ ...form, icon: v })}
            color={form.color}
          />
        </Box>
        <Box sx={{ mb: 2 }}>
          <ColorPicker
            value={form.color}
            onChange={(c) => setForm({ ...form, color: c })}
            label={t("tags.color")}
          />
        </Box>
        <FormControl fullWidth sx={{ mb: 2 }}>
          <InputLabel>{t("metamodel.layerLabel")}</InputLabel>
          <Select
            value={form.layer}
            label={t("metamodel.layerLabel")}
            onChange={(e) => setForm({ ...form, layer: e.target.value as ArchimateLayer })}
          >
            {SELECTABLE_LAYERS.map((layer) => (
              <MenuItem key={layer} value={layer}>
                {t(`layers.${layer}`, { ns: "archimate" })}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
      </DialogContent>
      <DialogActions>
        <Button onClick={handleClose}>{t("common:actions.cancel")}</Button>
        <Button
          variant="contained"
          onClick={handleCreate}
          disabled={!form.key || !form.name || !isValidKey(form.key)}
        >
          {t("common:actions.create")}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
