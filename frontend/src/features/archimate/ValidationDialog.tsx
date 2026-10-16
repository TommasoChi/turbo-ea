/** The result of POST /archimate/validate: the issues, or "no problems". */
import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import List from "@mui/material/List";
import ListItem from "@mui/material/ListItem";
import ListItemText from "@mui/material/ListItemText";
import { useTranslation } from "react-i18next";

export interface ValidationIssue { code: string; message: string; ref?: string | null }

interface Props {
  open: boolean;
  issues: ValidationIssue[];
  onClose: () => void;
}

export default function ValidationDialog({ open, issues, onClose }: Props) {
  const { t } = useTranslation(["archimate", "common"]);
  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{t("archimate:validation.title")}</DialogTitle>
      <DialogContent>
        {issues.length === 0 ? (
          <Alert severity="success">{t("archimate:validation.ok")}</Alert>
        ) : (
          <>
            <Alert severity="warning" sx={{ mb: 1 }}>
              {t("archimate:validation.issueCount", { count: issues.length })}
            </Alert>
            <List dense>
              {issues.map((issue, i) => (
                <ListItem key={`${issue.code}-${issue.ref ?? ""}-${i}`}>
                  <ListItemText
                    primary={t(`archimate:validation.codes.${issue.code}`, {
                      ref: issue.ref ?? "",
                      defaultValue: issue.message,
                    })}
                  />
                </ListItem>
              ))}
            </List>
          </>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t("common:actions.close")}</Button>
      </DialogActions>
    </Dialog>
  );
}
