import { useEffect, useState } from "react";
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
import Chip from "@mui/material/Chip";
import Alert from "@mui/material/Alert";
import IconPicker from "@/components/IconPicker";
import KeyInput, { isValidKey } from "@/components/KeyInput";
import MaterialSymbol from "@/components/MaterialSymbol";
import { ApiError } from "@/api/client";
import {
  addViewpointObject,
  createViewpoint,
  removeViewpointObject,
  updateViewpoint,
} from "@/api/archimateViewpoints";
import { listEnterpriseObjects } from "@/api/enterpriseObjects";
import { LAYER_ORDER, type ArchimateLayer } from "@/features/archimate/taxonomy/elements";
import type { ArchimateViewpoint, EnterpriseObject } from "@/types";

// Same 7 selectable layers as "New Architecture Object" -- `LAYER_ORDER` minus
// its trailing "other" bucket, which is never a choice here either. `layer`
// on a Viewpoint is an admin-facing classification only (viewpoint_seed.py);
// it never restricts which objects the allowed-objects editor below offers.
const SELECTABLE_LAYERS: ArchimateLayer[] = LAYER_ORDER.filter((layer) => layer !== "other");

export interface ViewpointEditDialogProps {
  open: boolean;
  /** null = create a new Viewpoint. A row = edit it in place. */
  viewpoint: ArchimateViewpoint | null;
  onClose: () => void;
  /** Called after every successful save/add/remove so the caller can refetch. */
  onSaved: () => void;
}

/**
 * Create/edit dialog for a Viewpoint Catalog row.
 *
 * The allowed-objects editor (add via `Select` + button, remove via a
 * deletable `Chip` each) mirrors `CardMappingRowEditor`'s add row and
 * `HierarchyLinkTypesSection`'s chip, pointed at `addViewpointObject` /
 * `removeViewpointObject` instead. It only works once the Viewpoint actually
 * exists server-side, so in create mode it stays hidden until the first Save
 * creates the row -- the dialog then switches in place to edit mode (without
 * closing) so an admin can immediately start allowing objects.
 */
export default function ViewpointEditDialog({ open, viewpoint, onClose, onSaved }: ViewpointEditDialogProps) {
  const { t } = useTranslation(["admin", "archimate", "common"]);

  const [key, setKey] = useState("");
  const [name, setName] = useState("");
  const [icon, setIcon] = useState("category");
  const [layer, setLayer] = useState<ArchimateLayer>(SELECTABLE_LAYERS[0]);
  const [description, setDescription] = useState("");
  const [objects, setObjects] = useState<string[]>([]);
  // Set once a create-mode Save succeeds, so the rest of this opening behaves
  // like edit mode (the objects editor unlocks) without a remount.
  const [createdKey, setCreatedKey] = useState<string | null>(null);
  const [enterpriseObjects, setEnterpriseObjects] = useState<EnterpriseObject[]>([]);
  const [addKey, setAddKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const activeKey = viewpoint?.key ?? createdKey;
  const isNew = !activeKey;

  useEffect(() => {
    if (!open) return;
    setKey(viewpoint?.key ?? "");
    setName(viewpoint?.name ?? "");
    setIcon(viewpoint?.icon ?? "category");
    setLayer((viewpoint?.layer as ArchimateLayer) ?? SELECTABLE_LAYERS[0]);
    setDescription(viewpoint?.description ?? "");
    setObjects(viewpoint?.objects ?? []);
    setCreatedKey(null);
    setAddKey("");
    setError(null);
  }, [open, viewpoint]);

  useEffect(() => {
    if (!open) return;
    listEnterpriseObjects(true)
      .then(setEnterpriseObjects)
      .catch(() => setEnterpriseObjects([]));
  }, [open]);

  const errorMessage = (e: unknown, fallback: string): string =>
    e instanceof ApiError && typeof e.detail === "string"
      ? e.detail
      : e instanceof Error
        ? e.message
        : fallback;

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      if (activeKey) {
        await updateViewpoint(activeKey, { name, icon, description, layer });
        onSaved();
        onClose();
      } else {
        const created = await createViewpoint({ key, name, icon, description, layer });
        setCreatedKey(created.key);
        onSaved();
      }
    } catch (e) {
      setError(errorMessage(e, t("metamodel.viewpoints.saveFailed")));
    } finally {
      setSaving(false);
    }
  };

  const handleAddObject = async () => {
    if (!activeKey || !addKey) return;
    try {
      await addViewpointObject(activeKey, addKey);
      setObjects((prev) => [...prev, addKey]);
      setAddKey("");
      onSaved();
    } catch (e) {
      setError(errorMessage(e, t("metamodel.viewpoints.saveFailed")));
    }
  };

  const handleRemoveObject = async (eoKey: string) => {
    if (!activeKey) return;
    try {
      await removeViewpointObject(activeKey, eoKey);
      setObjects((prev) => prev.filter((k) => k !== eoKey));
      onSaved();
    } catch (e) {
      setError(errorMessage(e, t("metamodel.viewpoints.saveFailed")));
    }
  };

  const objectName = (eoKey: string): string =>
    enterpriseObjects.find((eo) => eo.key === eoKey)?.name ?? eoKey;
  const addableObjects = enterpriseObjects.filter((eo) => !objects.includes(eo.key));

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>
        {viewpoint ? t("metamodel.viewpoints.editTitle") : t("metamodel.viewpoints.createTitle")}
      </DialogTitle>
      <DialogContent>
        {error && (
          <Alert severity="error" sx={{ mb: 2, mt: 1 }} onClose={() => setError(null)}>
            {error}
          </Alert>
        )}

        {isNew ? (
          <KeyInput
            fullWidth
            label={t("metamodel.viewpoints.keyLabel")}
            value={key}
            onChange={setKey}
            sx={{ mt: 1, mb: 2 }}
            size="small"
            required={!!name.trim()}
          />
        ) : (
          <TextField
            fullWidth
            disabled
            label={t("metamodel.viewpoints.keyLabel")}
            value={activeKey}
            sx={{ mt: 1, mb: 2 }}
            size="small"
          />
        )}

        <TextField
          fullWidth
          label={t("common:labels.name")}
          value={name}
          onChange={(e) => setName(e.target.value)}
          sx={{ mb: 2 }}
          error={!name.trim()}
        />
        <TextField
          fullWidth
          multiline
          minRows={2}
          label={t("common:labels.description")}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          sx={{ mb: 2 }}
        />
        <Box sx={{ mb: 2 }}>
          <Typography variant="caption" color="text.secondary" sx={{ mb: 0.5, display: "block" }}>
            {t("metamodel.iconLabel")}
          </Typography>
          <IconPicker value={icon} onChange={setIcon} />
        </Box>
        <FormControl fullWidth sx={{ mb: 2 }}>
          <InputLabel>{t("metamodel.layerLabel")}</InputLabel>
          <Select
            value={layer}
            label={t("metamodel.layerLabel")}
            onChange={(e) => setLayer(e.target.value as ArchimateLayer)}
          >
            {SELECTABLE_LAYERS.map((l) => (
              <MenuItem key={l} value={l}>
                {t(`layers.${l}`, { ns: "archimate" })}
              </MenuItem>
            ))}
          </Select>
        </FormControl>

        <Typography variant="subtitle2" sx={{ mb: 1 }}>
          {t("metamodel.viewpoints.allowedObjects")}
        </Typography>
        {isNew ? (
          <Typography variant="body2" color="text.secondary" sx={{ fontStyle: "italic", mb: 1 }}>
            {t("metamodel.viewpoints.allowedObjectsNeedsSave")}
          </Typography>
        ) : (
          <>
            <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5, mb: 1 }}>
              {objects.length === 0 && (
                <Typography variant="body2" color="text.secondary" sx={{ fontStyle: "italic" }}>
                  {t("metamodel.viewpoints.noAllowedObjects")}
                </Typography>
              )}
              {objects.map((eoKey) => (
                <Chip
                  key={eoKey}
                  size="small"
                  label={objectName(eoKey)}
                  onDelete={() => handleRemoveObject(eoKey)}
                />
              ))}
            </Box>
            <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
              <FormControl size="small" sx={{ minWidth: 220 }}>
                <InputLabel id="viewpoint-add-object-label">
                  {t("metamodel.viewpoints.addObjectLabel")}
                </InputLabel>
                <Select
                  labelId="viewpoint-add-object-label"
                  label={t("metamodel.viewpoints.addObjectLabel")}
                  value={addKey}
                  onChange={(e) => setAddKey(e.target.value)}
                >
                  {addableObjects.map((eo) => (
                    <MenuItem key={eo.key} value={eo.key}>
                      {eo.name}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
              <Button
                size="small"
                variant="outlined"
                startIcon={<MaterialSymbol icon="add" size={16} />}
                disabled={!addKey}
                onClick={handleAddObject}
              >
                {t("common:actions.add")}
              </Button>
            </Box>
          </>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t("common:actions.cancel")}</Button>
        <Button
          variant="contained"
          onClick={handleSave}
          disabled={saving || !name.trim() || (isNew && (!key || !isValidKey(key)))}
        >
          {t("common:actions.save")}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
