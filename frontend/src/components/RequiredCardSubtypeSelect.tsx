import MenuItem from "@mui/material/MenuItem";
import TextField from "@mui/material/TextField";
import type { SxProps, Theme } from "@mui/material/styles";
import { useTranslation } from "react-i18next";
import { useSubtypeLabel } from "@/hooks/useResolveLabel";
import type { SubtypeDef } from "@/types";

export default function RequiredCardSubtypeSelect({ options, value, onChange, sx }: {
  options: SubtypeDef[];
  value: string;
  onChange: (value: string) => void;
  sx?: SxProps<Theme>;
}) {
  const { t } = useTranslation("common");
  const subtypeLabel = useSubtypeLabel();

  return (
    <TextField
      select
      required
      fullWidth
      size="small"
      label={t("labels.subtype")}
      value={value}
      disabled={options.length === 0}
      onChange={(e) => onChange(e.target.value)}
      sx={sx}
    >
      {options.map((option) => (
        <MenuItem key={option.key} value={option.key}>{subtypeLabel(option)}</MenuItem>
      ))}
    </TextField>
  );
}
