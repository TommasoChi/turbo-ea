/**
 * The Business Process band of one Value Stream root: process boxes, related chips, the
 * band's two selects and its legend. Every component reads the page state from `useStreamContext()`.
 *
 * Contracts (Task 9 wires these):
 * - default `ProcessBoxes({ placements, root, bandStartRow, collapsedGroups, onToggleGroup })`
 *   - `placements`: `planProcessPlacements(root, geometry)`; one grid cell per placement,
 *     `gridColumn: placement.gridColumn`, `gridRow: bandStartRow + 2 + placement.row`
 *     (`bandStartRow` = `starts.process`: `+0` band header, `+1` the selects row).
 *   - `root`: the `ValueStreamRoot`; ids missing from `root.processes` are skipped silently.
 *   - `collapsedGroups`: container key -> collapsed (absent = expanded). Key is
 *     `${placement.key}:${item.id}`, so the same group in two cells collapses independently.
 *   - `onToggleGroup(key)`: a container's collapse toggle was clicked.
 *   - Colour per box: `processColorBy === "none"` -> `types.businessProcess.color`, else
 *     `processScales[attr].colorOf(process.color_attributes[attr])` (each child its own value).
 *   - Subtype caption per box: `subtypeLabels[process.subtype]`; no caption for a null or
 *     unknown subtype (never the raw key).
 * - `ProcessLeafBox({ process, color })`: a single process card (click/Enter/Space ->
 *   `openProcess`; steps chip + "View flow" -> `openFlow` only when `element_count > 0`).
 * - `ProcessContainerBox({ process, color, collapsed, onToggle, ownChips, children })`: a process
 *   with children; `ownChips` (its own related chips) always shown, `children` (box nodes)
 *   only while expanded. The brief's `item` prop is dropped: `process.id` is the same id.
 * - `RelatedChips({ items, related })`: chips coloured by the related card type -> `openCard`;
 *   nothing when `related === "none"` or `items` is empty.
 * - `ProcessColorByFields()`: no props; the "Color by" and "Show related" selects. No grid
 *   placement of its own: the page wraps it in a full-width cell (`gridColumn: "1 / -1"`) on
 *   `gridRow: starts.process + 1`, with some padding-top for the selects' floating labels.
 * - `ProcessLegend()`: no props; colour-by entries + "Not set", plus the related type; nothing
 *   when both selects are "none". No grid placement of its own: the page wraps it in a full-width
 *   cell (`gridColumn: "1 / -1"`) on `gridRow: starts.process + 2 + Math.max(1, root.row_count)`,
 *   right after the last level row.
 * - While the process band is collapsed the page renders none of these (boxes, selects, legend).
 */
import type { ReactNode } from "react";
import Box from "@mui/material/Box";
import Chip from "@mui/material/Chip";
import IconButton from "@mui/material/IconButton";
import MenuItem from "@mui/material/MenuItem";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { useTranslation } from "react-i18next";
import MaterialSymbol from "@/components/MaterialSymbol";
import ReportLegend from "@/features/reports/ReportLegend";
import { useOptionLabel } from "@/hooks/useResolveLabel";
import { readableTextColor } from "@/lib/color";
import { iconSize, STATUS_COLORS } from "@/theme/tokens";
import type { StreamRelatedMode, ValueStreamProcess, ValueStreamRelatedItem, ValueStreamRoot } from "@/types";
import CollapseToggle from "./CollapseToggle";
import { FOCUS_RING_ON_FILL, onActivateKey } from "./focusRing";
import { useStreamContext } from "./StreamContext";
import { PROCESS_COLOR_ATTRS, type ProcessColorBy } from "./valueChainModel";
import type { ProcessPlacement } from "./valueStreamLayout";

const RELATED_MODES: StreamRelatedMode[] = ["none", "applications", "dataObjects", "organization"];
const RELATED_TYPE = { applications: "application", dataObjects: "dataObject", organization: "organization" } as const;

const CLAMP_2 = { display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" } as const;
const SMALL_CHIP = { height: 20, color: "inherit", borderColor: "currentColor", "& .MuiChip-icon": { color: "inherit" } };

/** The label of a known subtype; "" for a null or unknown one (never the raw key). */
const captionOf = (labels: Record<string, string>, subtype: string | null) =>
  subtype && Object.prototype.hasOwnProperty.call(labels, subtype) ? labels[subtype] : "";

/** Step count + "View flow" (stops propagation so the box does not open too); nothing without steps. */
function FlowControls({ process }: { process: ValueStreamProcess }) {
  const { t } = useTranslation("valuechain");
  const { openFlow } = useStreamContext();
  const count = process.element_count;
  if (count <= 0) return null;
  return (
    <>
      <Chip
        size="small"
        variant="outlined"
        icon={<MaterialSymbol icon="checklist" size={iconSize.xs} />}
        label={count}
        role="img"
        aria-label={t("stream.steps", { count })}
        sx={SMALL_CHIP}
      />
      <IconButton
        size="small"
        aria-label={t("actions.viewFlow")}
        onClick={(e) => {
          e.stopPropagation();
          openFlow(process.id);
        }}
        sx={{ p: 0.25, color: "inherit", ...FOCUS_RING_ON_FILL }}
      >
        <MaterialSymbol icon="schema" size={iconSize.xs} />
      </IconButton>
    </>
  );
}

export function ProcessLeafBox({ process, color }: { process: ValueStreamProcess; color: string }) {
  const { openProcess, subtypeLabels } = useStreamContext();
  const open = () => openProcess(process.id);
  const caption = captionOf(subtypeLabels, process.subtype);
  return (
    <Box
      data-process={process.id}
      onClick={open}
      sx={{
        border: 1,
        borderColor: "divider",
        borderRadius: 2,
        overflow: "hidden",
        bgcolor: "background.paper",
        cursor: "pointer",
        "&:hover": { boxShadow: 2 },
      }}
    >
      <Box
        role="button"
        tabIndex={0}
        onKeyDown={onActivateKey(open)}
        sx={{
          px: 1.5,
          py: 0.75,
          minHeight: 38,
          display: "flex",
          alignItems: "center",
          bgcolor: color,
          color: readableTextColor(color),
          ...FOCUS_RING_ON_FILL,
        }}
      >
        <Typography variant="body2" sx={{ fontWeight: 600, lineHeight: 1.3, ...CLAMP_2 }}>
          {process.name}
        </Typography>
      </Box>
      <Box
        sx={{
          px: 1,
          py: 0.5,
          display: "flex",
          alignItems: "center",
          gap: 0.75,
          bgcolor: "action.hover",
          borderTop: 1,
          borderColor: "divider",
          color: "text.secondary",
        }}
      >
        {caption && <Typography variant="caption">{caption}</Typography>}
        <Box sx={{ flex: 1 }} />
        <FlowControls process={process} />
      </Box>
    </Box>
  );
}

export function ProcessContainerBox({
  process,
  color,
  collapsed,
  onToggle,
  ownChips,
  children,
}: {
  process: ValueStreamProcess;
  color: string;
  collapsed: boolean;
  onToggle: () => void;
  ownChips: ReactNode;
  children: ReactNode[];
}) {
  const { t } = useTranslation("valuechain");
  const { openProcess, subtypeLabels } = useStreamContext();
  const open = () => openProcess(process.id);
  const text = readableTextColor(color);
  const caption = captionOf(subtypeLabels, process.subtype);
  return (
    <Box
      data-process={process.id}
      sx={{ border: 1, borderColor: "divider", borderRadius: 2, overflow: "hidden", bgcolor: "background.paper" }}
    >
      <Box
        onClick={open}
        sx={{
          px: 1.5,
          py: 0.75,
          bgcolor: color,
          color: text,
          display: "flex",
          flexDirection: "column",
          gap: 0.5,
          cursor: "pointer",
          "&:hover": { opacity: 0.9 },
        }}
      >
        <Typography
          role="button"
          tabIndex={0}
          onKeyDown={onActivateKey(open)}
          variant="body2"
          sx={{ fontWeight: 700, lineHeight: 1.3, ...CLAMP_2, ...FOCUS_RING_ON_FILL }}
        >
          {process.name}
        </Typography>
        <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, minHeight: 20 }}>
          {caption && (
            <Typography variant="caption" sx={{ opacity: 0.85 }}>
              {caption}
            </Typography>
          )}
          <Box sx={{ flex: 1 }} />
          <FlowControls process={process} />
          <Chip
            size="small"
            variant="outlined"
            label={children.length}
            role="img"
            aria-label={t("stream.children", { count: children.length })}
            sx={SMALL_CHIP}
          />
          <CollapseToggle collapsed={collapsed} onToggle={onToggle} color={text} />
        </Box>
      </Box>
      <Box sx={{ p: 0.75, bgcolor: "action.hover", "&:empty": { display: "none" } }}>{ownChips}</Box>
      {!collapsed && (
        <Box
          sx={{
            p: 0.75,
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))",
            gap: 0.75,
            bgcolor: "action.hover",
          }}
        >
          {children}
        </Box>
      )}
    </Box>
  );
}

export function RelatedChips({ items, related }: { items: ValueStreamRelatedItem[]; related: StreamRelatedMode }) {
  const { types, openCard } = useStreamContext();
  if (related === "none" || items.length === 0) return null;
  const color = types[RELATED_TYPE[related]].color;
  const text = readableTextColor(color);
  return (
    <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5, px: 0.5 }}>
      {items.map((r) => (
        <Chip
          key={r.id}
          size="small"
          label={r.name}
          onClick={() => openCard(r.id)}
          sx={{
            height: 20,
            bgcolor: color,
            color: text,
            "&:hover": { bgcolor: color, opacity: 0.85 },
            // MUI's own focus fill would turn translucent grey under the readable text.
            "&.Mui-focusVisible": { bgcolor: color },
            ...FOCUS_RING_ON_FILL,
          }}
        />
      ))}
    </Box>
  );
}

export default function ProcessBoxes({
  placements,
  root,
  bandStartRow,
  collapsedGroups,
  onToggleGroup,
}: {
  placements: ProcessPlacement[];
  root: ValueStreamRoot;
  bandStartRow: number;
  collapsedGroups: Record<string, boolean>;
  onToggleGroup: (key: string) => void;
}) {
  const { types, processColorBy, processScales, related } = useStreamContext();
  const colorOf = (p: ValueStreamProcess) =>
    processColorBy === "none"
      ? types.businessProcess.color
      : processScales[processColorBy].colorOf(p.color_attributes[processColorBy]);
  const leafBox = (p: ValueStreamProcess) => (
    <Box key={p.id} sx={{ display: "flex", flexDirection: "column", gap: 0.5 }}>
      <ProcessLeafBox process={p} color={colorOf(p)} />
      <RelatedChips items={p.related} related={related} />
    </Box>
  );

  return placements.map((placement) => (
    <Box
      key={placement.key}
      data-placement={placement.key}
      sx={{
        gridColumn: placement.gridColumn,
        gridRow: bandStartRow + 2 + placement.row,
        display: "flex",
        flexDirection: "column",
        gap: 1,
        py: 1,
      }}
    >
      {placement.items.map((item) => {
        const process = root.processes[item.id];
        if (!process) return null;
        if (item.children.length === 0) return leafBox(process);
        const key = `${placement.key}:${item.id}`;
        return (
          <ProcessContainerBox
            key={item.id}
            process={process}
            color={colorOf(process)}
            collapsed={!!collapsedGroups[key]}
            onToggle={() => onToggleGroup(key)}
            ownChips={<RelatedChips items={process.related} related={related} />}
          >
            {item.children.flatMap((id) => root.processes[id] ?? []).map(leafBox)}
          </ProcessContainerBox>
        );
      })}
    </Box>
  ));
}

/** The band's "Color by" (none + the four process attributes) and "Show related" selects. No props. */
export function ProcessColorByFields() {
  const { t } = useTranslation("valuechain");
  const { processColorBy, setProcessColorBy, related, setRelated, fieldLabels } = useStreamContext();
  return (
    <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1.5 }}>
      <TextField
        select
        size="small"
        label={t("stream.colorBy")}
        value={processColorBy}
        onChange={(e) => setProcessColorBy(e.target.value as ProcessColorBy)}
        sx={{ minWidth: 180 }}
      >
        <MenuItem value="none">{t("stream.colorBy.none")}</MenuItem>
        {PROCESS_COLOR_ATTRS.map((attr) => (
          <MenuItem key={attr} value={attr}>
            {fieldLabels.processAttrs[attr] || t(`stream.colorBy.${attr}`)}
          </MenuItem>
        ))}
      </TextField>
      <TextField
        select
        size="small"
        label={t("stream.showRelated")}
        value={related}
        onChange={(e) => setRelated(e.target.value as StreamRelatedMode)}
        sx={{ minWidth: 180 }}
      >
        {RELATED_MODES.map((mode) => (
          <MenuItem key={mode} value={mode}>
            {t(`stream.related.${mode}`)}
          </MenuItem>
        ))}
      </TextField>
    </Box>
  );
}

/** Legend of the active selects; `ReportLegend` renders nothing for an empty list. No props. */
export function ProcessLegend() {
  const { t } = useTranslation("valuechain");
  const optionLabel = useOptionLabel();
  const { types, processColorBy, processScales, related } = useStreamContext();
  const items =
    processColorBy === "none"
      ? []
      : [
          ...processScales[processColorBy].entries.map((e) => ({ label: optionLabel(e.option), color: e.color })),
          { label: t("legend.notSet"), color: STATUS_COLORS.neutral },
        ];
  if (related !== "none") {
    const type = types[RELATED_TYPE[related]];
    items.push({ label: t("legend.related", { type: type.label }), color: type.color });
  }
  return <ReportLegend items={items} />;
}
