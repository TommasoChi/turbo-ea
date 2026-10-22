/**
 * ScopedArchimateDiagramPage — the three new scoped diagram-entry routes from
 * the nav rework (Business/Application/Technology Architecture → "<Layer>
 * Diagram"). One parametrized page instead of three near-duplicate files: it
 * renders `ArchimateViewpointPicker` (Task 7) with `tab` fixed to its layer,
 * and on selection creates the diagram exactly the way
 * `CreateDiagramDialog.tsx`'s own ArchiMate branch does (`handleArchimateSelect`)
 * — same `createDiagram` call shape, same navigation to
 * `/admin/architectureStudio/{id}` with `suggestedCardTypes` in `location.state`
 * (NOT `card_ids`, which is real-card-UUID-only server-side; see that file's
 * comment on `suggestedCardIds`).
 *
 * Unlike the dialog, this is a full page (no name + cards-to-link dialog around
 * it) — just the name field this flow still needs before a viewpoint pick
 * becomes a create call, then the picker itself.
 */
import { useState } from "react";
import { useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { createDiagram } from "@/api/diagrams";
import type { ViewpointTab } from "@/api/diagrams";
import { ARCHIMATE_FORMAT } from "@/features/archimate/exchange/exchangeModel";
import ArchimateViewpointPicker from "./ArchimateViewpointPicker";

const TITLE_KEY: Record<ViewpointTab, string> = {
  business: "businessDiagram",
  application: "applicationDiagram",
  technology: "technologyDiagram",
};

interface Props {
  tab: ViewpointTab;
}

export default function ScopedArchimateDiagramPage({ tab }: Props) {
  const { t } = useTranslation(["diagrams", "common", "nav"]);
  const navigate = useNavigate();

  const [name, setName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSelect = async (
    viewpointKey: string,
    startingXml: string | null,
    suggestedCardIds: string[],
  ) => {
    if (!name.trim() || submitting) return;
    if (startingXml === null) {
      setError(t("diagrams:archimatePicker.exampleLoadFailed"));
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      const created = await createDiagram({
        name: name.trim(),
        kind: "archimate",
        viewpoint_key: viewpointKey,
        data: { format: ARCHIMATE_FORMAT, xml: startingXml },
      });
      navigate(`/admin/architectureStudio/${created.id}`, {
        state: suggestedCardIds.length ? { suggestedCardTypes: suggestedCardIds } : undefined,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : t("common:errors.generic"));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Box sx={{ maxWidth: 900, mx: "auto" }}>
      <Typography variant="h5" fontWeight={600} gutterBottom>
        {t(`nav:${TITLE_KEY[tab]}`)}
      </Typography>
      <TextField
        fullWidth
        label={t("common:labels.name")}
        value={name}
        onChange={(e) => setName(e.target.value)}
        sx={{ mt: 1, mb: 2 }}
        autoFocus
      />
      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}
      {!name.trim() && (
        <Alert severity="info" sx={{ mb: 2 }}>
          {t("diagrams:archimatePicker.nameRequired")}
        </Alert>
      )}
      <ArchimateViewpointPicker tab={tab} onSelect={handleSelect} disabled={submitting} />
    </Box>
  );
}
