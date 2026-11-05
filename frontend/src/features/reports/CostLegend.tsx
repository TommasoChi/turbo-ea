import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";

export interface CostLegendEntry {
  key: string;
  label: string;
  color: string;
}

/** Swatch and label per group of the cost report; nothing when there is no group. */
export default function CostLegend({ entries }: { entries: CostLegendEntry[] }) {
  if (entries.length === 0) return null;
  return (
    <Box data-testid="cost-legend" sx={{ display: "flex", flexWrap: "wrap", gap: 2, mt: 1 }}>
      {entries.map((e) => (
        <Box key={e.key} sx={{ display: "flex", alignItems: "center", gap: 0.75 }}>
          <Box
            data-testid={`cost-legend-swatch-${e.key}`}
            sx={{ width: 12, height: 12, borderRadius: 0.5, bgcolor: e.color }}
          />
          <Typography variant="caption">{e.label}</Typography>
        </Box>
      ))}
    </Box>
  );
}
