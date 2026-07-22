import { useState } from "react";
import { useTranslation } from "react-i18next";
import Box from "@mui/material/Box";
import Chip from "@mui/material/Chip";
import Popover from "@mui/material/Popover";
import Typography from "@mui/material/Typography";
import Button from "@mui/material/Button";
import CircularProgress from "@mui/material/CircularProgress";
import MaterialSymbol from "@/components/MaterialSymbol";
import CardPicker, { type CardOption } from "@/components/CardPicker";
import { api } from "@/api/client";

interface Props {
  processId: string;
  elementId: string;
  organizations: { id: string; name: string }[];
  /** Refetch the parent element list after add/remove. */
  onChanged: () => void;
}

/**
 * "Organization" cell for the Process Steps & Elements table. Unlike
 * Application/DataObject/ITComponent (single-value click-to-edit cells, see
 * renderEditableCell in ProcessFlowTab.tsx), a step can involve MORE THAN
 * ONE organizational actor — so this is a multi-value cell backed by the
 * process_element_organizations M:N junction table, one row per element
 * (not one row per element+organization). Same interaction pattern as
 * Inventory's own relation columns (RelationCellPopover.tsx): a compact
 * summary in the cell, a popover with a removable chip list + CardPicker to
 * add another.
 */
export default function ElementOrganizationsCell({ processId, elementId, organizations, onChanged }: Props) {
  const { t } = useTranslation(["bpm", "common"]);
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  const [selected, setSelected] = useState<CardOption | null>(null);
  const [busy, setBusy] = useState(false);
  const open = Boolean(anchorEl);

  const excludeIds = organizations.map((o) => o.id);

  const handleAdd = async () => {
    if (!selected) return;
    setBusy(true);
    try {
      await api.post(`/bpm/processes/${processId}/elements/${elementId}/organizations`, {
        organization_id: selected.id,
      });
      setSelected(null);
      onChanged();
    } finally {
      setBusy(false);
    }
  };

  const handleRemove = async (orgId: string) => {
    setBusy(true);
    try {
      await api.delete(`/bpm/processes/${processId}/elements/${elementId}/organizations/${orgId}`);
      onChanged();
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Box
        onClick={(e) => setAnchorEl(e.currentTarget)}
        sx={{
          cursor: "pointer",
          minHeight: 32,
          display: "flex",
          alignItems: "center",
          flexWrap: "wrap",
          gap: 0.5,
          borderRadius: 1,
          border: "1px dashed transparent",
          px: 0.5,
          py: 0.25,
          transition: "all 0.15s ease",
          "&:hover": { borderColor: "primary.light", bgcolor: "action.hover" },
        }}
      >
        {organizations.length === 0 ? (
          <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
            <MaterialSymbol icon="add_link" size={14} color="#bbb" />
            <Typography variant="caption" color="text.disabled">
              {t("flowTab.linkCardType", { type: "Organization" })}
            </Typography>
          </Box>
        ) : (
          organizations.map((org) => (
            <Chip key={org.id} label={org.name} size="small" color="default" sx={{ maxWidth: 140 }} />
          ))
        )}
      </Box>
      <Popover
        open={open}
        anchorEl={anchorEl}
        onClose={() => setAnchorEl(null)}
        anchorOrigin={{ vertical: "bottom", horizontal: "left" }}
      >
        <Box sx={{ p: 2, minWidth: 300 }}>
          <Typography variant="caption" color="text.secondary" fontWeight={600} sx={{ mb: 1, display: "block" }}>
            {t("flowTab.organizations")}
          </Typography>
          <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.75, mb: 2, minHeight: 28 }}>
            {organizations.length === 0 && (
              <Typography variant="body2" color="text.secondary" sx={{ fontStyle: "italic" }}>
                {t("flowTab.noOrganizationsYet")}
              </Typography>
            )}
            {organizations.map((org) => (
              <Chip key={org.id} label={org.name} size="small" onDelete={() => handleRemove(org.id)} disabled={busy} />
            ))}
          </Box>
          <Box sx={{ display: "flex", gap: 1, alignItems: "flex-start" }}>
            <CardPicker
              fullWidth
              types="Organization"
              value={selected}
              onChange={setSelected}
              excludeIds={excludeIds}
              enabled={open}
              placeholder={t("flowTab.searchCardType", { type: "Organization" })}
            />
            <Button
              variant="contained"
              size="small"
              onClick={handleAdd}
              disabled={!selected || busy}
              sx={{ textTransform: "none", whiteSpace: "nowrap", minWidth: 56, height: 40 }}
            >
              {busy ? <CircularProgress size={18} color="inherit" /> : t("common:actions.add")}
            </Button>
          </Box>
        </Box>
      </Popover>
    </>
  );
}
