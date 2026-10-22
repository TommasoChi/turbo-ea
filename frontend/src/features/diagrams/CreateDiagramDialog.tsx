import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import Alert from "@mui/material/Alert";
import Autocomplete from "@mui/material/Autocomplete";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Checkbox from "@mui/material/Checkbox";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import TextField from "@mui/material/TextField";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import MaterialSymbol from "@/components/MaterialSymbol";
import { api } from "@/api/client";
import { createDiagram } from "@/api/diagrams";
import { ARCHIMATE_FORMAT } from "@/features/archimate/exchange/exchangeModel";
import { useMetamodel } from "@/hooks/useMetamodel";
import { useTypeLabel } from "@/hooks/useResolveLabel";
import type { Card } from "@/types";
import ArchimateViewpointPicker from "./ArchimateViewpointPicker";

interface Props {
  open: boolean;
  onClose: () => void;
  /** Card IDs to pre-link the new diagram to (e.g., a selected initiative). */
  initialCardIds?: string[];
  /** Default `true` — navigate to `/diagrams/{id}/edit` after creation. */
  navigateOnCreate?: boolean;
  /** Called with the new diagram ID after successful creation. */
  onCreated?: (diagramId: string) => void;
}

export default function CreateDiagramDialog({
  open,
  onClose,
  initialCardIds,
  navigateOnCreate = true,
  onCreated,
}: Props) {
  const { t } = useTranslation(["diagrams", "common"]);
  const navigate = useNavigate();
  const { types: metamodelTypes } = useMetamodel();
  const typeLabel = useTypeLabel();

  const [allCards, setAllCards] = useState<Card[]>([]);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [cardIds, setCardIds] = useState<string[]>(initialCardIds ?? []);
  const [submitting, setSubmitting] = useState(false);
  const [kind, setKind] = useState<"drawio" | "archimate">("drawio");
  const [archimateError, setArchimateError] = useState<string | null>(null);

  // Reset form whenever the dialog (re)opens, seeded with `initialCardIds`.
  useEffect(() => {
    if (open) {
      setName("");
      setDescription("");
      setCardIds(initialCardIds ?? []);
      setKind("drawio");
      setArchimateError(null);
    }
  }, [open, initialCardIds]);

  // Lazy-load cards the first time the dialog opens.
  useEffect(() => {
    if (!open || allCards.length > 0) return;
    let cancelled = false;
    api
      .get<{ items: Card[] }>("/cards?page_size=500")
      .then((res) => {
        if (!cancelled) setAllCards(res.items);
      })
      .catch(() => {
        // Linking is optional — silent fall-through is acceptable.
      });
    return () => {
      cancelled = true;
    };
  }, [open, allCards.length]);

  const typeMap = useMemo(
    () => Object.fromEntries(metamodelTypes.map((mt) => [mt.key, mt])),
    [metamodelTypes],
  );

  const handleCreate = async () => {
    if (!name.trim() || submitting) return;
    setSubmitting(true);
    try {
      const created = await createDiagram({
        name: name.trim(),
        description: description.trim() || undefined,
        card_ids: cardIds.length > 0 ? cardIds : undefined,
      });
      onCreated?.(created.id);
      onClose();
      if (navigateOnCreate) {
        navigate(`/diagrams/${created.id}/edit`);
      }
    } finally {
      setSubmitting(false);
    }
  };

  // The ArchiMate branch skips the Description/Linked-cards form entirely: the
  // picker's own card click *is* the create action (same UX as the design doc's
  // "combo + grid, click creates" flow). `suggestedCardIds` are card TYPE keys
  // (not card instance ids) meant for the designer's own "suggested cards to
  // create" hint, so they ride along as navigation state rather than going into
  // the `card_ids` field, which is real-card-UUID-only server-side.
  const handleArchimateSelect = async (
    viewpointKey: string,
    startingXml: string | null,
    suggestedCardIds: string[],
  ) => {
    if (!name.trim() || submitting) return;
    if (startingXml === null) {
      setArchimateError(t("archimatePicker.exampleLoadFailed"));
      return;
    }
    setArchimateError(null);
    setSubmitting(true);
    try {
      const created = await createDiagram({
        name: name.trim(),
        description: description.trim() || undefined,
        kind: "archimate",
        viewpoint_key: viewpointKey,
        data: { format: ARCHIMATE_FORMAT, xml: startingXml },
      });
      onCreated?.(created.id);
      onClose();
      if (navigateOnCreate) {
        navigate(`/admin/architectureStudio/${created.id}`, {
          state: suggestedCardIds.length ? { suggestedCardTypes: suggestedCardIds } : undefined,
        });
      }
    } catch (e) {
      setArchimateError(e instanceof Error ? e.message : t("common:errors.generic"));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth={kind === "archimate" ? "md" : "xs"} fullWidth>
      <DialogTitle>{t("gallery.newDiagram")}</DialogTitle>
      <DialogContent>
        <TextField
          fullWidth
          label={t("common:labels.name")}
          value={name}
          onChange={(e) => setName(e.target.value)}
          sx={{ mt: 1, mb: 2 }}
          autoFocus
          onKeyDown={(e) => {
            if (e.key === "Enter" && name.trim() && kind === "drawio") handleCreate();
          }}
        />
        <ToggleButtonGroup
          exclusive
          size="small"
          color="primary"
          value={kind}
          onChange={(_, v) => {
            if (v) setKind(v);
          }}
          disabled={submitting}
          sx={{ mb: 2 }}
        >
          <ToggleButton value="drawio">{t("gallery.diagramTypeDrawio")}</ToggleButton>
          <ToggleButton value="archimate">{t("gallery.diagramTypeArchimate")}</ToggleButton>
        </ToggleButtonGroup>

        {kind === "drawio" ? (
          <>
            <TextField
              fullWidth
              label={t("common:labels.description")}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              multiline
              rows={2}
              sx={{ mb: 2 }}
            />
            <Autocomplete
              multiple
              options={allCards}
              getOptionLabel={(opt) => opt.name}
              groupBy={(opt) => typeLabel(typeMap[opt.type]) || opt.type}
              value={allCards.filter((c) => cardIds.includes(c.id))}
              onChange={(_, newVal) => setCardIds(newVal.map((v) => v.id))}
              disableCloseOnSelect
              renderOption={(props, option, { selected }) => (
                <li {...props} key={option.id}>
                  <Checkbox size="small" checked={selected} sx={{ mr: 1 }} />
                  <MaterialSymbol
                    icon={typeMap[option.type]?.icon || "apps"}
                    size={18}
                    color={typeMap[option.type]?.color}
                  />
                  <Box component="span" sx={{ ml: 0.5 }}>
                    {option.name}
                  </Box>
                </li>
              )}
              renderInput={(params) => (
                <TextField
                  {...params}
                  label={t("gallery.linkedCards")}
                  helperText={t("gallery.linkedCardsHelperText")}
                />
              )}
            />
          </>
        ) : (
          <>
            {archimateError && (
              <Alert severity="error" sx={{ mb: 2 }}>
                {archimateError}
              </Alert>
            )}
            {!name.trim() && (
              <Alert severity="info" sx={{ mb: 2 }}>
                {t("archimatePicker.nameRequired")}
              </Alert>
            )}
            <ArchimateViewpointPicker
              tab={null}
              onSelect={handleArchimateSelect}
              disabled={submitting}
            />
          </>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t("common:actions.cancel")}</Button>
        {kind === "drawio" && (
          <Button
            variant="contained"
            onClick={handleCreate}
            disabled={!name.trim() || submitting}
          >
            {t("common:actions.create")}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}
