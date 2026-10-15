import Box from "@mui/material/Box";
import ButtonBase from "@mui/material/ButtonBase";
import Typography from "@mui/material/Typography";
import type { ValueStreamCapability } from "@/types";
import { FOCUS_RING } from "./focusRing";
import GroupHeader from "./GroupHeader";
import { useStreamContext } from "./StreamContext";
import { COL_W, groupByLeaf, type StreamGeometry } from "./valueStreamLayout";

/** One linked capability as a rounded box (no icon, name clamped); click/Enter/Space -> `openCard`. */
function CapabilityBox({ cap, width }: { cap: ValueStreamCapability; width?: number }) {
  const { types, openCard } = useStreamContext();
  return (
    <ButtonBase
      onClick={() => openCard(cap.id)}
      sx={{
        width,
        minHeight: 36,
        px: 1.5,
        py: 0.75,
        border: 1,
        borderColor: types.businessCapability.color,
        borderRadius: 1.5,
        bgcolor: "background.paper",
        color: "text.primary",
        "&:hover": { bgcolor: "action.hover" },
        ...FOCUS_RING,
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
        {cap.name}
      </Typography>
    </ButtonBase>
  );
}

/**
 * One group of a leaf: a lone capability that is its own group is a single box; any other group is
 * a container titled by the group (`GroupHeader`, title -> `openCard(group_id)`) whose members
 * show only while expanded.
 */
function CapabilityGroup({
  members,
  expanded,
  onToggle,
  width,
}: {
  members: ValueStreamCapability[];
  expanded: boolean;
  onToggle: () => void;
  width?: number;
}) {
  const { types, openCard } = useStreamContext();
  const [first] = members;
  if (members.length === 1 && first.group_id === first.id) return <CapabilityBox cap={first} width={width} />;
  const color = types.businessCapability.color;
  return (
    <Box data-cap-group sx={{ width, border: 1, borderColor: color, borderRadius: 1.5, overflow: "hidden" }}>
      <GroupHeader
        color={color}
        name={first.group_name}
        collapsed={!expanded}
        onToggle={onToggle}
        onOpen={() => openCard(first.group_id)}
      />
      {expanded && (
        <Box sx={{ display: "flex", flexDirection: "column", gap: 0.75, p: 1 }}>
          {members.map((c) => (
            <CapabilityBox key={c.id} cap={c} />
          ))}
        </Box>
      )}
    </Box>
  );
}

/** A leaf's capabilities grouped by `group_id`, in first-seen order. */
function groupsOf(caps: ValueStreamCapability[]): ValueStreamCapability[][] {
  const out = new Map<string, ValueStreamCapability[]>();
  for (const c of caps) out.set(c.group_id, [...(out.get(c.group_id) ?? []), c]);
  return [...out.values()];
}

/**
 * The Business Capability band's content, in ONE grid item on `row` spanning the leaf columns
 * (`gridColumn: 2 / lastCol+1`) whose columns are a `subgrid` of the root grid - same pattern as
 * `GatePills`: each sequence leaf's groups stack in that leaf's column (subgrid row 1), the groups
 * of cross-cutting leaves wrap, `COL_W` wide, in one full-width cell after them (subgrid row 2).
 * Capabilities of a leaf neither in the sequence nor cross-cutting are skipped; nothing renders
 * without capabilities.
 *
 * Props:
 * - `capabilities`: `root.capabilities`.
 * - `geometry`: `buildGeometry(root.sequence)`.
 * - `row`: grid row of the band content (`starts.cap + 1`).
 * - `crossLeafIds`: ids of `root.cross`.
 * - `expandedGroups`: `${leaf_id}:${group_id}` -> expanded. Groups are DEFAULT COLLAPSED: only an
 *   explicit `true` expands one, so the same group under two leaves toggles independently.
 * - `onToggleGroup(key)`: a group's toggle was clicked, with the key above.
 */
export default function CapabilityGroups({
  capabilities,
  geometry,
  row,
  crossLeafIds,
  expandedGroups,
  onToggleGroup,
}: {
  capabilities: ValueStreamCapability[];
  geometry: StreamGeometry;
  row: number;
  crossLeafIds: Set<string>;
  expandedGroups: Record<string, boolean>;
  onToggleGroup: (key: string) => void;
}) {
  if (capabilities.length === 0) return null;
  const byLeaf = groupByLeaf(capabilities);
  const renderGroups = (caps: ValueStreamCapability[], width?: number) =>
    groupsOf(caps).map((members) => {
      const key = `${members[0].leaf_id}:${members[0].group_id}`;
      return (
        <CapabilityGroup
          key={key}
          members={members}
          expanded={expandedGroups[key] === true}
          onToggle={() => onToggleGroup(key)}
          width={width}
        />
      );
    });
  const crossGroups = [...byLeaf]
    .filter(([leafId]) => crossLeafIds.has(leafId))
    .flatMap(([, caps]) => renderGroups(caps, COL_W));

  return (
    <Box
      data-caps
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
        const caps = byLeaf.get(leafId);
        return (
          caps && (
            <Box key={leafId} sx={{ gridColumn: col - 1, gridRow: 1, display: "flex", flexDirection: "column", gap: 1 }}>
              {renderGroups(caps)}
            </Box>
          )
        );
      })}
      {crossGroups.length > 0 && (
        <Box data-cross sx={{ gridColumn: "1 / -1", gridRow: 2, display: "flex", flexWrap: "wrap", gap: 2 }}>
          {crossGroups}
        </Box>
      )}
    </Box>
  );
}
