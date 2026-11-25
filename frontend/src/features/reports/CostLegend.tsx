import Box from "@mui/material/Box";
import ButtonBase from "@mui/material/ButtonBase";
import Typography from "@mui/material/Typography";

export interface CostLegendEntry {
  key: string;
  label: string;
  color: string;
}

interface Props {
  entries: CostLegendEntry[];
  onSelect?: (key: string) => void;
  activeKey?: string;
}

/** Swatch and label per group of the cost report; nothing when there is no group. */
export default function CostLegend({ entries, onSelect, activeKey }: Props) {
  if (entries.length === 0) return null;
  return (
    <Box data-testid="cost-legend" sx={{ display: "flex", flexWrap: "wrap", gap: 2, mt: 1 }}>
      {entries.map((e) => {
        const active = e.key === activeKey;
        const content = (
          <>
            <Box
              data-testid={`cost-legend-swatch-${e.key}`}
              sx={{ width: 12, height: 12, borderRadius: 0.5, bgcolor: e.color }}
            />
            <Typography variant="caption" sx={{ fontWeight: active ? 600 : undefined }}>
              {e.label}
            </Typography>
          </>
        );
        const layout = { display: "flex", alignItems: "center", gap: 0.75 };
        return onSelect ? (
          <ButtonBase
            key={e.key}
            aria-label={e.label}
            aria-current={active ? "true" : undefined}
            onClick={() => onSelect(e.key)}
            sx={{
              ...layout,
              borderRadius: 0.5,
              "&.Mui-focusVisible": { outline: "2px solid", outlineColor: "primary.main" },
            }}
          >
            {content}
          </ButtonBase>
        ) : (
          <Box key={e.key} sx={layout}>
            {content}
          </Box>
        );
      })}
    </Box>
  );
}
