/**
 * Node drawn by the cost Sankey (passed to Recharts' `node`): a bar coloured by
 * kind (cost item, group, card) with its name beside it. Columns run item ->
 * group -> card, so the last column labels on the bar's left to stay inside
 * the chart. Recharts does not mirror the Sankey layout in RTL, so the sides stay
 * put and only the text direction changes.
 */
import { useTheme } from "@mui/material/styles";
import { brand, CARD_TYPE_COLORS, CATEGORICAL_COLORS, DEFAULT_LAYER_COLOR } from "@/theme";

const MAX_LABEL = 24;

function costSankeyNodeColor(type: string): string {
  if (type === "CostItem") return brand.primary;
  if (type === "Group") return CATEGORICAL_COLORS[7];
  return CARD_TYPE_COLORS[type as keyof typeof CARD_TYPE_COLORS] ?? DEFAULT_LAYER_COLOR;
}

interface Props {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  payload?: { name: string; type: string; sourceLinks?: unknown[] };
  isRtl?: boolean;
}

export default function CostSankeyNode({
  x = 0,
  y = 0,
  width = 0,
  height = 0,
  payload,
  isRtl,
}: Props) {
  const theme = useTheme();
  if (!payload) return null;
  const { name, type } = payload;
  const lastColumn = !payload.sourceLinks?.length;
  const label = name.length > MAX_LABEL ? `${name.slice(0, MAX_LABEL - 1)}…` : name;
  return (
    <g>
      <title>{name}</title>
      <rect x={x} y={y} width={width} height={height} fill={costSankeyNodeColor(type)} />
      <text
        x={lastColumn ? x - 6 : x + width + 6}
        y={y + height / 2}
        textAnchor={lastColumn ? "end" : "start"}
        dominantBaseline="middle"
        fontSize={12}
        fill={theme.palette.text.primary}
        stroke={theme.palette.background.paper}
        strokeWidth={3}
        paintOrder="stroke"
        direction={isRtl ? "rtl" : undefined}
        style={isRtl ? { unicodeBidi: "plaintext" } : undefined}
      >
        {label}
      </text>
    </g>
  );
}
