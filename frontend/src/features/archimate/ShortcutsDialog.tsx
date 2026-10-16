/** The editor's keyboard shortcuts (from EDITOR_SHORTCUTS, so the list cannot drift from the bindings). */
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableRow from "@mui/material/TableRow";
import { useTranslation } from "react-i18next";
import { EDITOR_SHORTCUTS } from "./engine/keyboardConfig";

interface Props { open: boolean; onClose: () => void }

export default function ShortcutsDialog({ open, onClose }: Props) {
  const { t } = useTranslation(["archimate", "common"]);
  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>{t("archimate:shortcuts.title")}</DialogTitle>
      <DialogContent>
        <Table size="small">
          <TableBody>
            {Object.entries(EDITOR_SHORTCUTS).map(([action, keys]) => (
              <TableRow key={action}>
                <TableCell>{t(`archimate:shortcuts.${action}`)}</TableCell>
                <TableCell sx={{ fontFamily: "monospace" }}>{keys}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t("common:actions.close")}</Button>
      </DialogActions>
    </Dialog>
  );
}
