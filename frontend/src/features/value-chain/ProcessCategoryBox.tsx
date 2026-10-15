import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Typography from "@mui/material/Typography";
import { useTheme } from "@mui/material/styles";
import { useTranslation } from "react-i18next";
import MaterialSymbol from "@/components/MaterialSymbol";
import { readableTextColor } from "@/lib/color";
import { iconSize } from "@/theme/tokens";
import type { ValueChainBox } from "@/types";
import { FOCUS_RING_ON_FILL, onActivateKey } from "./focusRing";
import { useValueChainTypes, type VcType } from "./useValueChainTypes";

interface Props {
  box: ValueChainBox;
  headerColor: string;
  onOpenCard: (id: string) => void;
  onDrill: (id: string) => void;
}

/**
 * Process category: coloured name header (`role="button"`, click/Enter/Space -> `onOpenCard`),
 * four count rows (mouse-only: they repeat the header action), optional drill-down.
 */
export default function ProcessCategoryBox({ box, headerColor, onOpenCard, onDrill }: Props) {
  const { t } = useTranslation("valuechain");
  const theme = useTheme();
  const types = useValueChainTypes();
  const open = () => onOpenCard(box.id);

  const row = (label: string, count: number, type: VcType) => (
    <Box
      onClick={open}
      sx={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        px: 1.5,
        py: 0.5,
        gap: 1,
        borderTop: 1,
        borderColor: "divider",
        cursor: "pointer",
      }}
    >
      <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
        <MaterialSymbol icon={type.icon} size={iconSize.xs} color={theme.palette.text.secondary} />
        <Typography variant="caption" color="text.secondary">
          {label}
        </Typography>
      </Box>
      <Chip
        size="small"
        label={count}
        sx={{ bgcolor: type.color, color: readableTextColor(type.color), fontWeight: 700 }}
      />
    </Box>
  );

  return (
    <Box
      sx={{
        border: 1,
        borderColor: "divider",
        borderRadius: 1,
        overflow: "hidden",
        bgcolor: "action.hover",
        minWidth: 220,
        display: "flex",
        flexDirection: "column",
        "&:hover": { boxShadow: 2 },
      }}
    >
      <Box
        role="button"
        tabIndex={0}
        onClick={open}
        onKeyDown={onActivateKey(open)}
        sx={{
          bgcolor: headerColor,
          color: readableTextColor(headerColor),
          px: 1.5,
          py: 1,
          textAlign: "center",
          cursor: "pointer",
          "&:hover": { opacity: 0.9 },
          ...FOCUS_RING_ON_FILL,
        }}
      >
        <Typography variant="body2" fontWeight={700}>
          {box.name}
        </Typography>
      </Box>
      {row(t("box.processGroup"), box.group_count, types.businessProcess)}
      {row(t("box.process"), box.process_count, types.businessProcess)}
      {row(t("box.valueStream"), box.value_stream_count, types.businessContext)}
      {row(t("box.valueGate"), box.value_gate_count, types.objective)}
      {box.has_children && (
        <Box sx={{ display: "flex", justifyContent: "center", py: 0.75, borderTop: 1, borderColor: "divider" }}>
          <Button
            size="small"
            variant="outlined"
            color="inherit"
            aria-label={t("box.drillDown", { name: box.name })}
            onClick={() => onDrill(box.id)}
            sx={{ fontWeight: 700 }}
          >
            +
          </Button>
        </Box>
      )}
    </Box>
  );
}
