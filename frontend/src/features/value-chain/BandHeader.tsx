import Box from "@mui/material/Box";
import IconButton from "@mui/material/IconButton";
import Typography from "@mui/material/Typography";
import { alpha } from "@mui/material/styles";
import { useTranslation } from "react-i18next";
import MaterialSymbol from "@/components/MaterialSymbol";
import { useThemeMode } from "@/hooks/useThemeMode";
import { readableTypeColor } from "@/lib/color";
import { iconSize } from "@/theme/tokens";
import CollapseToggle from "./CollapseToggle";

export interface BandReorder {
  canMoveUp: boolean;
  canMoveDown: boolean;
  onMove: (direction: "up" | "down") => void;
}

interface Props {
  color: string;
  icon: string;
  label: string;
  count: number;
  collapsed: boolean;
  onToggle: () => void;
  reorder?: BandReorder;
}

export default function BandHeader({ color, icon, label, count, collapsed, onToggle, reorder }: Props) {
  const { t } = useTranslation("valuechain");
  const { mode } = useThemeMode();
  const accent = readableTypeColor(color, mode === "dark");
  return (
    <Box sx={{ display: "flex", alignItems: "center", gap: 1, py: 1 }}>
      <CollapseToggle collapsed={collapsed} onToggle={onToggle} />
      <Box sx={{ width: 4, alignSelf: "stretch", borderRadius: 1, bgcolor: accent }} />
      <Box sx={{ display: "flex", p: 0.5, borderRadius: 2, bgcolor: alpha(accent, 0.1) }}>
        <MaterialSymbol icon={icon} size={iconSize.md} color={accent} />
      </Box>
      <Typography variant="subtitle2" sx={{ textTransform: "uppercase", letterSpacing: 0.5 }}>
        {label}
      </Typography>
      <Typography variant="caption" color="text.secondary">({count})</Typography>
      <Box sx={{ flex: 1 }} />
      {reorder && (
        <>
          <IconButton size="small" aria-label={t("actions.moveUp")} disabled={!reorder.canMoveUp} onClick={() => reorder.onMove("up")}>
            <MaterialSymbol icon="keyboard_arrow_up" size={iconSize.md} />
          </IconButton>
          <IconButton size="small" aria-label={t("actions.moveDown")} disabled={!reorder.canMoveDown} onClick={() => reorder.onMove("down")}>
            <MaterialSymbol icon="keyboard_arrow_down" size={iconSize.md} />
          </IconButton>
        </>
      )}
    </Box>
  );
}
