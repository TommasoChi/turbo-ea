import type { KeyboardEvent } from "react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import { useTranslation } from "react-i18next";
import { useIsRtl } from "@/hooks/useIsRtl";
import { readableTextColor } from "@/lib/color";
import type { ValueStreamLeaf } from "@/types";
import GroupHeader from "./GroupHeader";
import { chevronClipPath } from "./shapes";
import { useStreamContext } from "./StreamContext";
import { CHEVRON_H, type LeafRun, type StreamGeometry } from "./valueStreamLayout";

/** Line from a chevron (or collapsed group) towards the next column; painted under the chevrons. */
function Connector() {
  return (
    <Box
      data-connector
      sx={{ position: "absolute", top: "50%", insetInlineEnd: -36, width: 44, height: 2, bgcolor: "text.primary", zIndex: 0 }}
    />
  );
}

/**
 * One value-stream leaf as a both-ended chevron (`role="button"`, Enter/Space/click -> `openCard(leaf.id)`).
 *
 * Props:
 * - `leaf`: the leaf to draw (its `name` is clamped to 2 lines).
 * - `connector`: draw the line to the next column (true unless the leaf sits in the last column).
 */
export function Chevron({ leaf, connector }: { leaf: ValueStreamLeaf; connector: boolean }) {
  const { types, openCard } = useStreamContext();
  const rtl = useIsRtl();
  const color = types.businessContext.color;
  const text = readableTextColor(color);
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      openCard(leaf.id);
    }
  };
  return (
    <Box sx={{ position: "relative", flex: 1, minWidth: 0, display: "flex", alignItems: "center" }}>
      {connector && <Connector />}
      <Box
        role="button"
        tabIndex={0}
        onClick={() => openCard(leaf.id)}
        onKeyDown={onKeyDown}
        sx={{
          flex: 1,
          minWidth: 0,
          clipPath: chevronClipPath(rtl),
          bgcolor: color,
          color: text,
          px: 2.5,
          height: CHEVRON_H,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          cursor: "pointer",
          zIndex: 1,
          "&:hover": { opacity: 0.85 },
        }}
      >
        <Typography
          variant="body2"
          fontWeight={700}
          sx={{
            color: "inherit",
            lineHeight: 1.2,
            textAlign: "center",
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
          }}
        >
          {leaf.name}
        </Typography>
      </Box>
    </Box>
  );
}

/**
 * One run of consecutive sequence leaves sharing a parent.
 * A parent-less run is one grid cell per leaf (`gridColumn: <its column>`); a run with a parent is
 * one bordered container spanning all its columns, titled by the parent (`GroupHeader`, title ->
 * `openCard(parentId)`), whose toggle hides only the chevrons - the container keeps its width.
 *
 * Props:
 * - `run`: from `buildGeometry(...).runs`.
 * - `row`: grid row of the sequence chevrons.
 * - `lastCol`: `geometry.lastCol`; no connector leaves the last column.
 * - `collapsedGroups`: parent id -> collapsed (absent = expanded); hides only that run's chevrons.
 * - `onToggleGroup(parentId)`: the group's collapse toggle was clicked.
 */
export function LeafRunView({
  run,
  row,
  lastCol,
  collapsedGroups,
  onToggleGroup,
}: {
  run: LeafRun;
  row: number;
  lastCol: number;
  collapsedGroups: Record<string, boolean>;
  onToggleGroup: (parentId: string) => void;
}) {
  const { t } = useTranslation("valuechain");
  const { types, openCard } = useStreamContext();
  const { parentId, startCol, leaves } = run;

  if (parentId === null) {
    return leaves.map((leaf, i) => (
      <Box
        key={leaf.id}
        sx={{ gridRow: row, gridColumn: startCol + i, display: "flex", alignItems: "center", py: 1.5, px: 0.5, zIndex: 1 }}
      >
        <Chevron leaf={leaf} connector={startCol + i < lastCol} />
      </Box>
    ));
  }

  const collapsed = !!collapsedGroups[parentId];
  const endCol = startCol + leaves.length - 1;
  return (
    <Box
      data-group
      sx={{
        gridRow: row,
        gridColumn: `${startCol} / ${endCol + 1}`,
        alignSelf: "center",
        position: "relative",
        display: "flex",
        flexDirection: "column",
        border: 1,
        borderColor: types.businessContext.color,
        borderRadius: 1.5,
        my: 1.5,
        mx: 0.5,
        zIndex: 1,
      }}
    >
      {collapsed && endCol < lastCol && <Connector />}
      <GroupHeader
        color={types.businessContext.color}
        name={run.parentName ?? t("stream.hiddenGroup")}
        collapsed={collapsed}
        onToggle={() => onToggleGroup(parentId)}
        onOpen={() => openCard(parentId)}
      />
      {!collapsed && (
        <Box sx={{ display: "flex", alignItems: "center", gap: 2, p: 1 }}>
          {leaves.map((leaf, i) => (
            <Chevron key={leaf.id} leaf={leaf} connector={startCol + i < lastCol} />
          ))}
        </Box>
      )}
    </Box>
  );
}

/**
 * Cross-cutting leaves stacked in one full-width cell (`gridColumn: 2 / lastCol+1`); nothing when empty.
 *
 * Props:
 * - `leaves`: `root.cross`.
 * - `row`: grid row of the cross-cutting chevrons.
 * - `lastCol`: `geometry.lastCol`.
 */
export function CrossChevrons({ leaves, row, lastCol }: { leaves: ValueStreamLeaf[]; row: number; lastCol: number }) {
  const { t } = useTranslation("valuechain");
  if (leaves.length === 0) return null;
  return (
    <Box
      title={t("stream.crossCutting")}
      sx={{
        gridRow: row,
        gridColumn: `2 / ${lastCol + 1}`,
        display: "flex",
        flexDirection: "column",
        gap: 0.5,
        p: 0.5,
        zIndex: 1,
      }}
    >
      {leaves.map((leaf) => (
        <Chevron key={leaf.id} leaf={leaf} connector={false} />
      ))}
    </Box>
  );
}

/**
 * The Value Stream band's chevrons: cross-cutting leaves on `bandStartRow + 2`, the sequence runs on
 * `bandStartRow + 3` (`bandStartRow` is the band header row, `+1` the root header).
 *
 * Props:
 * - `geometry`: `buildGeometry(root.sequence)`.
 * - `cross`: `root.cross`.
 * - `bandStartRow`: the Value Stream band's first grid row (`bandRowStarts(...).starts.vs`).
 * - `collapsedGroups`: parent id -> collapsed (absent = expanded).
 * - `onToggleGroup(parentId)`: a group's toggle was clicked.
 */
export default function StreamChevrons({
  geometry,
  cross,
  bandStartRow,
  collapsedGroups,
  onToggleGroup,
}: {
  geometry: StreamGeometry;
  cross: ValueStreamLeaf[];
  bandStartRow: number;
  collapsedGroups: Record<string, boolean>;
  onToggleGroup: (parentId: string) => void;
}) {
  return (
    <>
      <CrossChevrons leaves={cross} row={bandStartRow + 2} lastCol={geometry.lastCol} />
      {geometry.runs.map((run) => (
        <LeafRunView
          key={run.startCol}
          run={run}
          row={bandStartRow + 3}
          lastCol={geometry.lastCol}
          collapsedGroups={collapsedGroups}
          onToggleGroup={onToggleGroup}
        />
      ))}
    </>
  );
}
