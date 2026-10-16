/** Picks the card an element links to; closing without a pick changes nothing. */
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import Typography from "@mui/material/Typography";
import { useTranslation } from "react-i18next";
import CardPicker, { type CardOption } from "@/components/CardPicker";
import type { CardTypeOption } from "./engine/EditorBridge";

interface Props {
  open: boolean;
  cardTypes: CardTypeOption[];
  onPick: (card: CardOption) => void;
  onClose: () => void;
}

export default function LinkCardDialog({ open, cardTypes, onPick, onClose }: Props) {
  const { t } = useTranslation(["archimate", "common"]);
  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth disableRestoreFocus>
      <DialogTitle>{t("archimate:linkDialog.title")}</DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          {t("archimate:linkDialog.hint", { types: cardTypes.map((c) => c.label).join(", ") })}
        </Typography>
        <CardPicker
          types={cardTypes.map((c) => c.key)}
          value={null}
          onChange={(card) => card && onPick(card)}
          label={t("archimate:linkDialog.label")}
          autoFocus
          fullWidth
        />
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t("common:actions.cancel")}</Button>
      </DialogActions>
    </Dialog>
  );
}
