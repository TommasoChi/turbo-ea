import { useMemo, useRef, useState } from "react";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import { useTranslation } from "react-i18next";
import MaterialSymbol from "@/components/MaterialSymbol";
import { iconSize } from "@/theme/tokens";
import type { ValueStreamRoot } from "@/types";
import BandHeader from "./BandHeader";
import CapabilityGroups from "./CapabilityGroups";
import { FOCUS_RING_ON_FILL } from "./focusRing";
import GatePills, { GateColorByField, GateLegend } from "./GatePills";
import GoalPanel from "./GoalPanel";
import GroupHeader from "./GroupHeader";
import ProcessBoxes, { ProcessColorByFields, ProcessLegend } from "./ProcessBoxes";
import StreamBandFrame from "./StreamBandFrame";
import StreamChevrons from "./StreamChevrons";
import { useStreamContext } from "./StreamContext";
import type { ValueChainTypes } from "./useValueChainTypes";
import { STREAM_BAND_KEYS, type StreamBandKey } from "./valueChainModel";
import {
  bandRowSpans,
  bandRowStarts,
  buildGeometry,
  gridTemplateColumns,
  GUTTER_PX,
  planProcessPlacements,
} from "./valueStreamLayout";

const BAND_TYPE: Record<StreamBandKey, keyof ValueChainTypes> = {
  gate: "objective",
  vs: "businessContext",
  process: "businessProcess",
  cap: "businessCapability",
};

type Toggles = Record<string, boolean>;
const flip = (key: string) => (prev: Toggles) => ({ ...prev, [key]: !prev[key] });

export interface ValueStreamRootViewProps {
  root: ValueStreamRoot;
  /** "Save as Word" clicked: the root and its wrapper node (the area to snapshot). No button when absent. */
  onExportWord?: (root: ValueStreamRoot, node: HTMLElement) => void;
  /** This root's export is running: the button says so and is disabled. */
  exporting: boolean;
  /** Another root's export is running: the button is disabled. */
  exportDisabled: boolean;
}

/**
 * One Value Stream root as ONE CSS grid: the four bands (in `bandOrder`), each a header row plus
 * its content rows, a decorative frame behind every open band, and the goal panel beside them.
 * Gate and capability bands start collapsed, stream and process bands expanded (local state).
 */
export default function ValueStreamRootView({ root, onExportWord, exporting, exportDisabled }: ValueStreamRootViewProps) {
  const { t } = useTranslation("valuechain");
  const { types, bandOrder, onMoveBand, openCard } = useStreamContext();
  const nodeRef = useRef<HTMLDivElement>(null);
  const geometry = useMemo(() => buildGeometry(root.sequence), [root.sequence]);
  const placements = useMemo(() => planProcessPlacements(root, geometry), [root, geometry]);
  const crossLeafIds = useMemo(() => new Set(root.cross.map((l) => l.id)), [root.cross]);
  const { starts, total } = useMemo(() => bandRowStarts(bandOrder, root.row_count), [bandOrder, root.row_count]);
  const spans = bandRowSpans(root.row_count);
  const [rootCollapsed, setRootCollapsed] = useState(false);
  const [goalsCollapsed, setGoalsCollapsed] = useState(false);
  // Band key -> collapsed. Gate + cap default COLLAPSED (only an explicit false expands).
  const [bands, setBands] = useState<Partial<Record<StreamBandKey, boolean>>>({});
  const [vsGroups, setVsGroups] = useState<Toggles>({});
  const [processGroups, setProcessGroups] = useState<Toggles>({});
  const [capGroups, setCapGroups] = useState<Toggles>({});

  const isCollapsed = (k: StreamBandKey) => (k === "gate" || k === "cap" ? bands[k] !== false : !!bands[k]);
  const showStreams = !isCollapsed("vs") && !rootCollapsed;
  const hasGoals = showStreams && root.goals.length > 0;
  const goalBoundary = geometry.lastCol + 1;
  const fullWidth = hasGoals ? `1 / ${goalBoundary}` : "1 / -1";
  // Cancel the grid's gutter padding so the root border reaches the frames' edges.
  const bleed = { ml: `-${GUTTER_PX}px`, mr: hasGoals ? 0 : `-${GUTTER_PX}px` };
  const counts: Record<StreamBandKey, number> = {
    gate: root.gates.length,
    vs: root.sequence.length,
    process: root.process_count,
    cap: root.capabilities.length,
  };
  // The stream band always has the root's own leaves; only a payload with none at all is empty.
  const empty: Record<StreamBandKey, boolean> = {
    gate: counts.gate === 0,
    vs: root.sequence.length + root.cross.length === 0,
    process: counts.process === 0,
    cap: counts.cap === 0,
  };

  const wordButton = onExportWord && (
    <Box data-export-ignore="true">
      <Button
        size="small"
        color="inherit"
        startIcon={<MaterialSymbol icon="description" size={iconSize.sm} />}
        disabled={exporting || exportDisabled}
        onClick={() => nodeRef.current && onExportWord(root, nodeRef.current)}
        sx={FOCUS_RING_ON_FILL}
      >
        {exporting ? t("actions.savingWord") : t("actions.saveWord")}
      </Button>
    </Box>
  );

  return (
    <Box ref={nodeRef} sx={{ mb: 4 }}>
      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: gridTemplateColumns(geometry.totalSlots, hasGoals),
          minWidth: "100%",
          // GatePills / CapabilityGroups cross cells assume this gap.
          columnGap: 2,
          alignItems: "stretch",
          px: `${GUTTER_PX}px`,
        }}
      >
        {/* Frames first so they paint behind the band content. */}
        {STREAM_BAND_KEYS.map(
          (k) =>
            !isCollapsed(k) && (
              <StreamBandFrame
                key={`frame-${k}`}
                row={starts[k] + 1}
                rows={spans[k] - 1}
                hasGoals={hasGoals}
                goalBoundary={goalBoundary}
                empty={empty[k]}
                emptyLabel={t(`stream.empty.${k}`)}
              />
            ),
        )}

        {bandOrder.map((k, i) => (
          <Box key={`header-${k}`} sx={{ gridRow: starts[k], gridColumn: fullWidth, mt: i === 0 ? 0 : 2 }}>
            <BandHeader
              color={types[BAND_TYPE[k]].color}
              icon={types[BAND_TYPE[k]].icon}
              label={t(`stream.band.${k}`)}
              count={counts[k]}
              collapsed={isCollapsed(k)}
              onToggle={() => setBands((prev) => ({ ...prev, [k]: !isCollapsed(k) }))}
              reorder={{
                canMoveUp: i > 0,
                canMoveDown: i < bandOrder.length - 1,
                onMove: (direction) => onMoveBand(k, direction),
              }}
            />
          </Box>
        ))}

        {!isCollapsed("gate") && (
          <>
            <Box sx={{ gridRow: starts.gate + 1, gridColumn: fullWidth, pt: 1.25, mb: 1 }}>
              <GateColorByField />
            </Box>
            <GatePills gates={root.gates} geometry={geometry} row={starts.gate + 2} crossLeafIds={crossLeafIds} />
            <Box sx={{ gridRow: starts.gate + 3, gridColumn: fullWidth, pb: 1 }}>
              <GateLegend />
            </Box>
          </>
        )}

        {!isCollapsed("vs") && (
          <>
            <Box
              data-root-border
              sx={{
                gridRow: rootCollapsed ? `${starts.vs + 1} / ${starts.vs + 2}` : `${starts.vs + 1} / ${starts.vs + 4}`,
                gridColumn: fullWidth,
                ...bleed,
                border: 1,
                borderColor: types.businessContext.color,
                borderRadius: 1.5,
              }}
            />
            <Box
              sx={{
                gridRow: starts.vs + 1,
                gridColumn: fullWidth,
                ...bleed,
                zIndex: 1,
                borderRadius: 1.5,
                overflow: "hidden",
              }}
            >
              <GroupHeader
                color={types.businessContext.color}
                name={root.name}
                collapsed={rootCollapsed}
                onToggle={() => setRootCollapsed((c) => !c)}
                onOpen={() => openCard(root.id)}
                extra={wordButton}
              />
            </Box>
            {showStreams && (
              <StreamChevrons
                geometry={geometry}
                cross={root.cross}
                bandStartRow={starts.vs}
                collapsedGroups={vsGroups}
                onToggleGroup={(id) => setVsGroups(flip(id))}
              />
            )}
            {hasGoals && (
              <GoalPanel
                goals={root.goals}
                totalRows={total}
                lastCol={geometry.lastCol}
                collapsed={goalsCollapsed}
                onToggle={() => setGoalsCollapsed((c) => !c)}
              />
            )}
          </>
        )}

        {!isCollapsed("process") && (
          <>
            <Box sx={{ gridRow: starts.process + 1, gridColumn: fullWidth, pt: 1.25, mb: 1 }}>
              <ProcessColorByFields />
            </Box>
            <ProcessBoxes
              placements={placements}
              root={root}
              bandStartRow={starts.process}
              collapsedGroups={processGroups}
              onToggleGroup={(key) => setProcessGroups(flip(key))}
            />
            <Box sx={{ gridRow: starts.process + 2 + Math.max(1, root.row_count), gridColumn: fullWidth, pb: 1 }}>
              <ProcessLegend />
            </Box>
          </>
        )}

        {!isCollapsed("cap") && (
          <CapabilityGroups
            capabilities={root.capabilities}
            geometry={geometry}
            row={starts.cap + 1}
            crossLeafIds={crossLeafIds}
            expandedGroups={capGroups}
            onToggleGroup={(key) => setCapGroups(flip(key))}
          />
        )}
      </Box>
    </Box>
  );
}
