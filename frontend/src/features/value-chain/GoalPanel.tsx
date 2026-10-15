import { useState } from "react";
import Box from "@mui/material/Box";
import IconButton from "@mui/material/IconButton";
import Typography from "@mui/material/Typography";
import { useTranslation } from "react-i18next";
import MaterialSymbol from "@/components/MaterialSymbol";
import { readableTextColor } from "@/lib/color";
import { iconSize } from "@/theme/tokens";
import type { ValueStreamGoal } from "@/types";
import CollapseToggle from "./CollapseToggle";
import { FOCUS_RING_ON_FILL } from "./focusRing";
import { useStreamContext } from "./StreamContext";

/**
 * The Business Goal panel of one root, as TWO grid items: a blank separator strip
 * (`gridColumn: lastCol+1`, the goal-strip track) and the panel (`gridColumn: lastCol+2`), both
 * spanning every row of the root (`1 / totalRows+1`). Each goal is a block in the Objective colour
 * (name click/Enter/Space -> `openCard(goal.id)`) with its description shown by default and a
 * per-goal show/hide toggle only when the description is non-empty (local state).
 * Rendered by the page only when the root has goals.
 *
 * Props:
 * - `goals`: `root.goals`.
 * - `totalRows`: `bandRowStarts(...).total`.
 * - `lastCol`: `geometry.lastCol`.
 * - `collapsed`: panel collapsed (narrow, header toggle only).
 * - `onToggle()`: the panel's collapse toggle was clicked.
 */
export default function GoalPanel({
  goals,
  totalRows,
  lastCol,
  collapsed,
  onToggle,
}: {
  goals: ValueStreamGoal[];
  totalRows: number;
  lastCol: number;
  collapsed: boolean;
  onToggle: () => void;
}) {
  const { t } = useTranslation("valuechain");
  const { types, openCard } = useStreamContext();
  const [hiddenDescriptions, setHiddenDescriptions] = useState<Record<string, boolean>>({});
  const color = types.objective.color;
  const text = readableTextColor(color);
  const rows = `1 / ${totalRows + 1}`;

  return (
    <>
      <Box
        data-goal-strip
        sx={{ gridRow: rows, gridColumn: lastCol + 1, bgcolor: "background.paper", pointerEvents: "none" }}
      />
      <Box
        data-goal-panel
        sx={{
          gridRow: rows,
          gridColumn: lastCol + 2,
          display: "flex",
          flexDirection: "column",
          minWidth: collapsed ? 44 : 200,
          maxWidth: collapsed ? 44 : 260,
          border: 1,
          borderColor: color,
          borderRadius: 1.5,
          overflow: "hidden",
        }}
      >
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            gap: 0.5,
            px: 1,
            py: 0.75,
            borderBottom: collapsed ? 0 : 1,
            borderColor: color,
          }}
        >
          <CollapseToggle collapsed={collapsed} onToggle={onToggle} />
          {!collapsed && (
            <>
              <Typography
                variant="subtitle2"
                sx={{
                  flex: 1,
                  textTransform: "uppercase",
                  letterSpacing: 0.5,
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {t("stream.goal.title")}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {`(${goals.length})`}
              </Typography>
            </>
          )}
        </Box>
        {!collapsed && (
          <Box sx={{ flex: 1, overflow: "auto", display: "flex", flexDirection: "column", gap: 1, p: 1 }}>
            {goals.map((goal) => {
              const hidden = !!hiddenDescriptions[goal.id];
              const open = () => openCard(goal.id);
              return (
                <Box key={goal.id} sx={{ border: 1, borderColor: "divider", borderRadius: 1.5, overflow: "hidden" }}>
                  <Box
                    onClick={open}
                    sx={{
                      bgcolor: color,
                      color: text,
                      px: 1.5,
                      py: 1,
                      display: "flex",
                      alignItems: "flex-start",
                      gap: 0.5,
                      cursor: "pointer",
                    }}
                  >
                    <Typography
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          open();
                        }
                      }}
                      variant="body2"
                      sx={{ flex: 1, fontWeight: 700, lineHeight: 1.2, ...FOCUS_RING_ON_FILL }}
                    >
                      {goal.name}
                    </Typography>
                    {goal.description && (
                      <IconButton
                        size="small"
                        aria-label={hidden ? t("actions.showDescription") : t("actions.hideDescription")}
                        aria-expanded={!hidden}
                        onClick={(e) => {
                          e.stopPropagation();
                          setHiddenDescriptions((prev) => ({ ...prev, [goal.id]: !prev[goal.id] }));
                        }}
                        sx={{ p: 0.25, color: "inherit", flexShrink: 0, ...FOCUS_RING_ON_FILL }}
                      >
                        <MaterialSymbol icon={hidden ? "expand_more" : "expand_less"} size={iconSize.xs} />
                      </IconButton>
                    )}
                  </Box>
                  {goal.description && !hidden && (
                    <Typography
                      variant="caption"
                      sx={{ display: "block", color: "text.secondary", p: 1, whiteSpace: "pre-wrap" }}
                    >
                      {goal.description}
                    </Typography>
                  )}
                </Box>
              );
            })}
          </Box>
        )}
      </Box>
    </>
  );
}
