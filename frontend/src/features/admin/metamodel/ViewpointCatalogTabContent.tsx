import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import Box from "@mui/material/Box";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import Typography from "@mui/material/Typography";
import Button from "@mui/material/Button";
import ButtonBase from "@mui/material/ButtonBase";
import IconButton from "@mui/material/IconButton";
import Chip from "@mui/material/Chip";
import Tooltip from "@mui/material/Tooltip";
import CircularProgress from "@mui/material/CircularProgress";
import Alert from "@mui/material/Alert";
import MaterialSymbol from "@/components/MaterialSymbol";
import { apiErrorMessage } from "@/api/client";
import { deleteViewpoint, listViewpoints, updateViewpoint } from "@/api/archimateViewpoints";
import { useOptionalAuthUser } from "@/hooks/AuthContext";
import { usePermissions } from "@/hooks/usePermissions";
import type { ArchimateViewpoint } from "@/types";
import ViewpointEditDialog from "./ViewpointEditDialog";

/** The 3 diagram-creation tabs (TAB_LAYERS, backend `api/v1/diagrams.py`) a viewpoint's `domains`
 *  can name, in table-column order. */
const DOMAIN_LABEL_KEY: Record<string, string> = {
  business: "metamodel.viewpoints.domainBusiness",
  application: "metamodel.viewpoints.domainApplication",
  technology: "metamodel.viewpoints.domainTechnology",
};

/**
 * Admin list for the ArchiMate Viewpoint catalog (Task 3's `/metamodel/viewpoints*`):
 * icon, name, layer badge, standard/custom + hidden/active status, allowed-object
 * count, and edit/visibility/delete actions. "+ New Viewpoint" and the row edit
 * action both open `ViewpointEditDialog`, which also owns the allowed-objects
 * tag-chip editor.
 *
 * `includeHidden: true` on the fetch, same posture as `CardMappingTabContent`'s
 * Enterprise Object list -- this admin screen is the one place a hidden row
 * stays visible.
 */
export default function ViewpointCatalogTabContent() {
  const { t } = useTranslation(["admin", "archimate", "common"]);
  const user = useOptionalAuthUser();
  const { can } = usePermissions(user);
  const canEdit = can("admin.metamodel");

  const [viewpoints, setViewpoints] = useState<ArchimateViewpoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<ArchimateViewpoint | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchViewpoints = useCallback(async () => {
    try {
      setViewpoints(await listViewpoints(true));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchViewpoints();
  }, [fetchViewpoints]);

  const openCreate = () => {
    setEditing(null);
    setDialogOpen(true);
  };
  const openEdit = (vp: ArchimateViewpoint) => {
    setEditing(vp);
    setDialogOpen(true);
  };
  const closeDialog = () => setDialogOpen(false);

  const toggleHidden = async (vp: ArchimateViewpoint) => {
    await updateViewpoint(vp.key, { is_hidden: !vp.is_hidden });
    fetchViewpoints();
  };

  const handleDelete = async (vp: ArchimateViewpoint) => {
    if (!window.confirm(t("metamodel.viewpoints.deleteConfirm", { name: vp.name }))) return;
    setError(null);
    try {
      await deleteViewpoint(vp.key);
      fetchViewpoints();
    } catch (e) {
      setError(apiErrorMessage(e, t("metamodel.viewpoints.deleteFailed")));
    }
  };

  if (loading) {
    return (
      <Box sx={{ display: "flex", justifyContent: "center", p: 4 }}>
        <CircularProgress size={28} />
      </Box>
    );
  }

  return (
    <Box>
      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      <Box sx={{ display: "flex", justifyContent: "flex-end", mb: 2 }}>
        <Button
          variant="contained"
          startIcon={<MaterialSymbol icon="add" size={18} />}
          onClick={openCreate}
        >
          {t("metamodel.viewpoints.newViewpoint")}
        </Button>
      </Box>

      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell padding="checkbox" />
            <TableCell>{t("metamodel.viewpoints.columnName")}</TableCell>
            <TableCell>{t("metamodel.viewpoints.columnLayer")}</TableCell>
            <TableCell>{t("metamodel.viewpoints.columnDomain")}</TableCell>
            <TableCell>{t("metamodel.viewpoints.columnStatus")}</TableCell>
            <TableCell align="right">{t("metamodel.viewpoints.columnObjects")}</TableCell>
            <TableCell padding="checkbox" />
            <TableCell padding="checkbox" />
          </TableRow>
        </TableHead>
        <TableBody>
          {viewpoints.map((vp) => (
            <TableRow key={vp.key} sx={{ opacity: vp.is_hidden ? 0.55 : 1 }}>
              <TableCell padding="checkbox">
                <MaterialSymbol icon={vp.icon} size={20} />
              </TableCell>
              <TableCell>
                <ButtonBase
                  onClick={() => openEdit(vp)}
                  sx={{ justifyContent: "flex-start", p: 0.5, borderRadius: 1, maxWidth: "100%" }}
                >
                  <Typography noWrap>{vp.name}</Typography>
                </ButtonBase>
              </TableCell>
              <TableCell>
                <Chip size="small" label={t(`layers.${vp.layer}`, { ns: "archimate" })} />
              </TableCell>
              <TableCell>
                <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5 }}>
                  {vp.domains.map((d) => (
                    <Chip key={d} size="small" variant="outlined" label={t(DOMAIN_LABEL_KEY[d] ?? d)} />
                  ))}
                </Box>
              </TableCell>
              <TableCell>
                <Chip
                  size="small"
                  variant={vp.is_standard ? "filled" : "outlined"}
                  label={vp.is_standard ? t("metamodel.builtIn") : t("metamodel.viewpoints.custom")}
                  sx={{ mr: 0.5 }}
                />
                {vp.is_hidden && <Chip size="small" color="warning" label={t("metamodel.hidden")} />}
              </TableCell>
              <TableCell align="right">
                <Typography variant="caption" color="text.secondary">
                  {t("metamodel.viewpoints.objectCount", { count: vp.objects.length })}
                </Typography>
              </TableCell>
              <TableCell padding="checkbox">
                <Tooltip title={vp.is_hidden ? t("common:actions.restore") : t("metamodel.hidden")}>
                  <IconButton
                    size="small"
                    aria-label={vp.is_hidden ? t("common:actions.restore") : t("metamodel.hidden")}
                    disabled={!canEdit}
                    onClick={() => toggleHidden(vp)}
                  >
                    <MaterialSymbol
                      icon={vp.is_hidden ? "visibility_off" : "visibility"}
                      size={18}
                      color={vp.is_hidden ? "#f57c00" : "#bbb"}
                    />
                  </IconButton>
                </Tooltip>
              </TableCell>
              <TableCell padding="checkbox">
                <IconButton
                  size="small"
                  aria-label={t("common:actions.delete")}
                  disabled={!canEdit}
                  onClick={() => handleDelete(vp)}
                >
                  <MaterialSymbol icon="delete" size={18} color="#bbb" />
                </IconButton>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      <ViewpointEditDialog
        open={dialogOpen}
        viewpoint={editing}
        onClose={closeDialog}
        onSaved={fetchViewpoints}
      />
    </Box>
  );
}
