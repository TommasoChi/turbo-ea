import Box from "@mui/material/Box";
import ButtonBase from "@mui/material/ButtonBase";
import MenuItem from "@mui/material/MenuItem";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { useTranslation } from "react-i18next";
import { useOptionLabel } from "@/hooks/useResolveLabel";
import { readableTextColor } from "@/lib/color";
import { STATUS_COLORS } from "@/theme/tokens";
import type { ValueStreamGate } from "@/types";
import ReportLegend from "@/features/reports/ReportLegend";
import { useStreamContext } from "./StreamContext";
import type { GateColorBy } from "./valueChainModel";
import { COL_W, GATE_H, groupByLeaf, type StreamGeometry } from "./valueStreamLayout";

/** One fixed-height gate pill coloured by the page's `gateColorBy`; click/Enter/Space -> `openCard`. */
function GatePill({ gate, width }: { gate: ValueStreamGate; width?: number }) {
  const { types, gateColorBy, objectiveScale, openCard } = useStreamContext();
  const color = gateColorBy === "objectiveType" ? objectiveScale.colorOf(gate.objective_type) : types.objective.color;
  return (
    <ButtonBase
      onClick={() => openCard(gate.id)}
      sx={{
        width,
        height: GATE_H,
        px: 1.5,
        borderRadius: "50px",
        bgcolor: color,
        color: readableTextColor(color),
        "&:hover": { opacity: 0.85 },
      }}
    >
      <Typography
        component="span"
        variant="caption"
        sx={{
          fontWeight: 500,
          lineHeight: 1.2,
          textAlign: "center",
          display: "-webkit-box",
          WebkitLineClamp: 2,
          WebkitBoxOrient: "vertical",
          overflow: "hidden",
        }}
      >
        {gate.name}
      </Typography>
    </ButtonBase>
  );
}

/**
 * The Value Gate band's pills, in ONE grid item on `row` spanning the leaf columns
 * (`gridColumn: 2 / lastCol+1`) whose columns are a `subgrid` of the root grid: each sequence
 * leaf's pills stack in that leaf's column (subgrid row 1), the gates of cross-cutting leaves
 * wrap in one full-width cell after them (subgrid row 2) - so both fit in the band's single
 * content row without overlapping. Gates of a leaf that is neither in the sequence nor
 * cross-cutting are skipped; nothing renders without gates.
 *
 * Props:
 * - `gates`: `root.gates`.
 * - `geometry`: `buildGeometry(root.sequence)`.
 * - `row`: grid row of the pills (`starts.gate + 2`).
 * - `crossLeafIds`: ids of `root.cross`.
 */
export default function GatePills({
  gates,
  geometry,
  row,
  crossLeafIds,
}: {
  gates: ValueStreamGate[];
  geometry: StreamGeometry;
  row: number;
  crossLeafIds: Set<string>;
}) {
  if (gates.length === 0) return null;
  const byLeaf = groupByLeaf(gates);
  const cross = gates.filter((g) => crossLeafIds.has(g.leaf_id));
  return (
    <Box
      data-gates
      sx={{
        gridRow: row,
        gridColumn: `2 / ${geometry.lastCol + 1}`,
        display: "grid",
        gridTemplateColumns: "subgrid",
        rowGap: 1,
        alignContent: "start",
        py: 1,
      }}
    >
      {Object.entries(geometry.colByLeafId).map(([leafId, col]) => {
        const list = byLeaf.get(leafId);
        return (
          list && (
            <Box key={leafId} sx={{ gridColumn: col - 1, gridRow: 1, display: "flex", flexDirection: "column", gap: 0.75 }}>
              {list.map((g) => (
                <GatePill key={g.id} gate={g} />
              ))}
            </Box>
          )
        );
      })}
      {cross.length > 0 && (
        <Box data-cross sx={{ gridColumn: "1 / -1", gridRow: 2, display: "flex", flexWrap: "wrap", gap: 2 }}>
          {cross.map((g) => (
            <GatePill key={g.id} gate={g} width={COL_W} />
          ))}
        </Box>
      )}
    </Box>
  );
}

/** The Value Gate band's "Color by" select (flat Objective colour / objective type). No props. */
export function GateColorByField() {
  const { t } = useTranslation("valuechain");
  const { gateColorBy, setGateColorBy, fieldLabels } = useStreamContext();
  return (
    <TextField
      select
      size="small"
      label={t("stream.colorBy")}
      value={gateColorBy}
      onChange={(e) => setGateColorBy(e.target.value as GateColorBy)}
      sx={{ minWidth: 180 }}
    >
      <MenuItem value="none">{t("stream.colorBy.none")}</MenuItem>
      <MenuItem value="objectiveType">{fieldLabels.objectiveType || t("stream.colorBy.objectiveType")}</MenuItem>
    </TextField>
  );
}

/** Legend of the objective-type colours plus "Not set"; renders only in `objectiveType` mode. No props. */
export function GateLegend() {
  const { t } = useTranslation("valuechain");
  const optionLabel = useOptionLabel();
  const { gateColorBy, objectiveScale } = useStreamContext();
  if (gateColorBy !== "objectiveType") return null;
  return (
    <ReportLegend
      items={[
        ...objectiveScale.entries.map((e) => ({ label: optionLabel(e.option), color: e.color })),
        { label: t("legend.notSet"), color: STATUS_COLORS.neutral },
      ]}
    />
  );
}
