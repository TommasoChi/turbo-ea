import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import { GUTTER_PX } from "./valueStreamLayout";

/**
 * Decorative grey quadrant painted behind one band's content rows (render it
 * before the band's cells so it sits underneath; it never takes clicks).
 *
 * Props:
 * - `row`: first grid row of the band's content (the row after its header).
 * - `rows`: number of grid rows it spans.
 * - `hasGoals`: when true the frame stops at `goalBoundary` instead of the last line.
 * - `goalBoundary`: grid line the frame ends on when `hasGoals` (the goal strip's column).
 * - `empty`: dashed border and `emptyLabel` centred inside instead of a solid border.
 * - `emptyLabel`: translated "No … found" text shown when `empty`.
 */
interface Props {
  row: number;
  rows: number;
  hasGoals: boolean;
  goalBoundary: number;
  empty: boolean;
  emptyLabel: string;
}

export default function StreamBandFrame({ row, rows, hasGoals, goalBoundary, empty, emptyLabel }: Props) {
  return (
    <Box
      sx={{
        gridRow: `${row} / span ${rows}`,
        gridColumn: hasGoals ? `1 / ${goalBoundary}` : "1 / -1",
        // Cancel the grid's own gutter padding so the frame reaches the outer edge.
        ml: `-${GUTTER_PX}px`,
        mr: hasGoals ? 0 : `-${GUTTER_PX}px`,
        bgcolor: "action.hover",
        border: empty ? "1px dashed" : "1px solid",
        borderColor: "divider",
        borderRadius: 2,
        pointerEvents: "none",
        ...(empty && { display: "flex", alignItems: "center", justifyContent: "center" }),
      }}
    >
      {empty && (
        <Typography variant="body2" color="text.secondary">
          {emptyLabel}
        </Typography>
      )}
    </Box>
  );
}
