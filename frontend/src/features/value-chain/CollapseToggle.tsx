import IconButton from "@mui/material/IconButton";
import { useTranslation } from "react-i18next";
import MaterialSymbol from "@/components/MaterialSymbol";
import { iconSize } from "@/theme/tokens";

interface Props {
  collapsed: boolean;
  onToggle: () => void;
  /** Border and icon colour; defaults to the theme divider / inherited text. */
  color?: string;
}

export default function CollapseToggle({ collapsed, onToggle, color }: Props) {
  const { t } = useTranslation("valuechain");
  return (
    <IconButton
      size="small"
      aria-label={collapsed ? t("actions.expand") : t("actions.collapse")}
      aria-expanded={!collapsed}
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
      sx={{ border: 1, borderColor: color ?? "divider", borderRadius: 0.5, color }}
    >
      <MaterialSymbol icon={collapsed ? "add" : "remove"} size={iconSize.xs} />
    </IconButton>
  );
}
