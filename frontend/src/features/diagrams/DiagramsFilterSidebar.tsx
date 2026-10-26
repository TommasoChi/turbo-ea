import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import List from "@mui/material/List";
import ListItemButton from "@mui/material/ListItemButton";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import Chip from "@mui/material/Chip";
import Button from "@mui/material/Button";
import Divider from "@mui/material/Divider";
import IconButton from "@mui/material/IconButton";
import Tooltip from "@mui/material/Tooltip";
import FormControl from "@mui/material/FormControl";
import InputLabel from "@mui/material/InputLabel";
import Select from "@mui/material/Select";
import MenuItem from "@mui/material/MenuItem";
import MaterialSymbol from "@/components/MaterialSymbol";
import { LAYER_ORDER, type ArchimateLayer } from "@/features/archimate/taxonomy/elements";
import type { ArchimateViewpoint, DiagramGroup } from "@/types";

/** Single-select scope (like mail folders). */
export type DiagramScope =
  | { kind: "all" }
  | { kind: "mine" }
  | { kind: "favorites" }
  | { kind: "group"; id: string };

/** The diagram-kind filter, orthogonal to `DiagramScope` above (you can be
 *  looking at "mine" + "archimate" + a specific layer/viewpoint at once).
 *  `layer`/`viewpointKey` only apply once `kind === "archimate"` -- cascading,
 *  so `viewpointKey` is cleared whenever `layer` changes. */
export interface DiagramTypeFilter {
  kind: "all" | "drawio" | "archimate";
  layer: ArchimateLayer | null;
  viewpointKey: string | null;
}

export const DEFAULT_TYPE_FILTER: DiagramTypeFilter = {
  kind: "all",
  layer: null,
  viewpointKey: null,
};

export const SIDEBAR_MIN_WIDTH = 220;
export const SIDEBAR_MAX_WIDTH = 360;

interface Props {
  scope: DiagramScope;
  onScopeChange: (s: DiagramScope) => void;
  groups: DiagramGroup[];
  onManageGroups: () => void;
  collapsed: boolean;
  onToggleCollapse: () => void;
  width: number;
  onWidthChange: (w: number) => void;
  /** Called after a scope selection — used to auto-close the mobile drawer. */
  onAfterChange?: () => void;
  typeFilter: DiagramTypeFilter;
  onTypeFilterChange: (f: DiagramTypeFilter) => void;
  /** Hidden entirely for a user with no ArchiMate view/manage permission on
   *  any layer -- there would be nothing for the filter to ever show. */
  showArchimateFilter: boolean;
  /** The full Viewpoint catalog, for the layer→viewpoint cascade. Only
   *  fetched by the caller once `showArchimateFilter` is true. */
  viewpoints: ArchimateViewpoint[];
}

const sameScope = (a: DiagramScope, b: DiagramScope) =>
  a.kind === b.kind && (a.kind !== "group" || b.kind !== "group" || a.id === b.id);

export default function DiagramsFilterSidebar({
  scope,
  onScopeChange,
  groups,
  onManageGroups,
  collapsed,
  onToggleCollapse,
  width,
  onWidthChange,
  onAfterChange,
  typeFilter,
  onTypeFilterChange,
  showArchimateFilter,
  viewpoints,
}: Props) {
  const { t } = useTranslation(["diagrams", "archimate", "common"]);

  const activeCount =
    (scope.kind === "all" ? 0 : 1) + (typeFilter.kind === "all" ? 0 : 1);

  // Layers present among the (non-hidden) Viewpoint catalog, in LAYER_ORDER.
  const availableLayers = useMemo(() => {
    const present = new Set(viewpoints.map((v) => v.layer));
    return LAYER_ORDER.filter((l) => present.has(l));
  }, [viewpoints]);

  const viewpointsInLayer = useMemo(
    () => viewpoints.filter((v) => v.layer === typeFilter.layer),
    [viewpoints, typeFilter.layer],
  );

  const pickKind = (kind: DiagramTypeFilter["kind"]) => {
    onTypeFilterChange({ kind, layer: null, viewpointKey: null });
    onAfterChange?.();
  };

  const typeKinds: { kind: DiagramTypeFilter["kind"]; icon: string; color?: string; label: string }[] =
    [
      { kind: "all", icon: "apps", label: t("sidebar.typeAll") },
      { kind: "drawio", icon: "schema", label: t("gallery.diagramTypeDrawio") },
      ...(showArchimateFilter
        ? [
            {
              kind: "archimate" as const,
              icon: "hub",
              color: "#7b1fa2",
              label: t("gallery.diagramTypeArchimate"),
            },
          ]
        : []),
    ];

  const pickScope = (s: DiagramScope) => {
    onScopeChange(s);
    onAfterChange?.();
  };

  const handleResizeMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = width;
    const onMove = (ev: MouseEvent) => {
      const newW = Math.min(
        SIDEBAR_MAX_WIDTH,
        Math.max(SIDEBAR_MIN_WIDTH, startW + (ev.clientX - startX)),
      );
      onWidthChange(newW);
    };
    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  };

  /* ---- Collapsed rail ---- */
  if (collapsed) {
    return (
      <Box
        sx={{
          width: 44,
          minWidth: 44,
          borderRight: 1,
          borderColor: "divider",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          pt: 1,
          bgcolor: "action.hover",
        }}
      >
        <Tooltip title={t("gallery.filters")} placement="right">
          <IconButton size="small" onClick={onToggleCollapse}>
            <MaterialSymbol icon="chevron_right" size={20} />
          </IconButton>
        </Tooltip>
        {activeCount > 0 && (
          <Chip
            label={activeCount}
            size="small"
            color="primary"
            sx={{ mt: 1, minWidth: 24, height: 20, fontSize: 12 }}
          />
        )}
      </Box>
    );
  }

  const quick: { scope: DiagramScope; icon: string; label: string }[] = [
    { scope: { kind: "all" }, icon: "grid_view", label: t("sidebar.all") },
    { scope: { kind: "mine" }, icon: "person", label: t("sidebar.mine") },
    { scope: { kind: "favorites" }, icon: "star", label: t("sidebar.favorites") },
  ];

  /* ---- Expanded sidebar ---- */
  return (
    <Box sx={{ display: "flex", height: "100%" }}>
      <Box
        sx={{
          width,
          minWidth: SIDEBAR_MIN_WIDTH,
          borderRight: 1,
          borderColor: "divider",
          display: "flex",
          flexDirection: "column",
          bgcolor: "action.hover",
          overflow: "hidden",
        }}
      >
        {/* Header */}
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            px: 1.5,
            py: 0.5,
            minHeight: 40,
            borderBottom: 1,
            borderColor: "divider",
          }}
        >
          <Box sx={{ display: "flex", alignItems: "center", gap: 0.75 }}>
            <Typography variant="subtitle2" fontWeight={600}>
              {t("gallery.filters")}
            </Typography>
            {activeCount > 0 && (
              <Box sx={{ width: 8, height: 8, borderRadius: "50%", bgcolor: "primary.main" }} />
            )}
          </Box>
          <IconButton size="small" onClick={onToggleCollapse}>
            <MaterialSymbol icon="chevron_left" size={20} />
          </IconButton>
        </Box>

        {/* Scrollable content */}
        <Box sx={{ flex: 1, overflow: "auto", p: 1.5 }}>
          {/* Quick filters */}
          <Typography variant="overline" color="text.secondary" sx={{ px: 0.5 }}>
            {t("sidebar.show")}
          </Typography>
          <List dense disablePadding>
            {quick.map((q) => (
              <ListItemButton
                key={q.scope.kind}
                selected={sameScope(scope, q.scope)}
                onClick={() => pickScope(q.scope)}
                sx={{ borderRadius: 1 }}
              >
                <ListItemIcon sx={{ minWidth: 32 }}>
                  <MaterialSymbol icon={q.icon} size={18} />
                </ListItemIcon>
                <ListItemText primary={q.label} />
              </ListItemButton>
            ))}
          </List>

          <Divider sx={{ my: 1 }} />

          {/* Type (drawio / archimate), then its layer -> viewpoint cascade. Rows,
              not a ToggleButtonGroup: three segments' labels don't fit on one
              line at the sidebar's width, and this matches the Show list above. */}
          <Typography variant="overline" color="text.secondary" sx={{ px: 0.5 }}>
            {t("sidebar.type")}
          </Typography>
          <List dense disablePadding sx={{ mb: 1 }}>
            {typeKinds.map((k) => (
              <ListItemButton
                key={k.kind}
                selected={typeFilter.kind === k.kind}
                onClick={() => pickKind(k.kind)}
                sx={{ borderRadius: 1 }}
              >
                <ListItemIcon sx={{ minWidth: 32 }}>
                  <MaterialSymbol icon={k.icon} size={18} color={k.color} />
                </ListItemIcon>
                <ListItemText primary={k.label} />
              </ListItemButton>
            ))}
          </List>

          {typeFilter.kind === "archimate" && (
            <Box sx={{ display: "flex", flexDirection: "column", gap: 1, mb: 1 }}>
              <FormControl size="small" fullWidth>
                <InputLabel id="diagrams-layer-filter-label">{t("sidebar.layer")}</InputLabel>
                <Select
                  labelId="diagrams-layer-filter-label"
                  label={t("sidebar.layer")}
                  value={typeFilter.layer ?? ""}
                  onChange={(e) => {
                    const layer = (e.target.value || null) as ArchimateLayer | null;
                    onTypeFilterChange({ ...typeFilter, layer, viewpointKey: null });
                  }}
                >
                  <MenuItem value="">{t("sidebar.anyLayer")}</MenuItem>
                  {availableLayers.map((l) => (
                    <MenuItem key={l} value={l}>
                      {t(`layers.${l}`, { ns: "archimate" })}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>

              {typeFilter.layer && (
                <FormControl size="small" fullWidth>
                  <InputLabel id="diagrams-viewpoint-filter-label">
                    {t("archimatePicker.viewpoint")}
                  </InputLabel>
                  <Select
                    labelId="diagrams-viewpoint-filter-label"
                    label={t("archimatePicker.viewpoint")}
                    value={typeFilter.viewpointKey ?? ""}
                    onChange={(e) =>
                      onTypeFilterChange({ ...typeFilter, viewpointKey: e.target.value || null })
                    }
                  >
                    <MenuItem value="">{t("sidebar.anyViewpoint")}</MenuItem>
                    {viewpointsInLayer.map((v) => (
                      <MenuItem key={v.key} value={v.key}>
                        {v.name}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
              )}
            </Box>
          )}

          <Divider sx={{ my: 1 }} />

          {/* Groups */}
          <Box sx={{ display: "flex", alignItems: "center", px: 0.5 }}>
            <Typography variant="overline" color="text.secondary" sx={{ flex: 1 }}>
              {t("sidebar.groups")}
            </Typography>
            {groups.length > 0 && (
              <Box sx={{ display: "flex", gap: 0.5 }}>
                <Tooltip title={t("gallery.diagramTypeDrawio")}>
                  <Box sx={{ width: 20, display: "flex", justifyContent: "center" }}>
                    <MaterialSymbol icon="schema" size={14} />
                  </Box>
                </Tooltip>
                <Tooltip title={t("gallery.diagramTypeArchimate")}>
                  <Box sx={{ width: 20, display: "flex", justifyContent: "center" }}>
                    <MaterialSymbol icon="hub" size={14} color="#7b1fa2" />
                  </Box>
                </Tooltip>
              </Box>
            )}
          </Box>
          <List dense disablePadding>
            {groups.length === 0 ? (
              <Typography
                variant="body2"
                color="text.secondary"
                sx={{ px: 1.5, py: 1, fontStyle: "italic" }}
              >
                {t("sidebar.noGroups")}
              </Typography>
            ) : (
              groups.map((g) => (
                <ListItemButton
                  key={g.id}
                  selected={scope.kind === "group" && scope.id === g.id}
                  onClick={() => pickScope({ kind: "group", id: g.id })}
                  sx={{ borderRadius: 1 }}
                >
                  <ListItemIcon sx={{ minWidth: 28 }}>
                    <Box
                      sx={{
                        width: 12,
                        height: 12,
                        borderRadius: "3px",
                        bgcolor: g.color || "action.selected",
                      }}
                    />
                  </ListItemIcon>
                  <ListItemText primary={g.name} primaryTypographyProps={{ noWrap: true }} />
                  <Box
                    aria-label={t("sidebar.groupDrawioCount", { count: g.diagram_count_drawio })}
                    sx={{ width: 20, textAlign: "center" }}
                  >
                    <Typography variant="caption" color="text.secondary">
                      {g.diagram_count_drawio}
                    </Typography>
                  </Box>
                  <Box
                    aria-label={t("sidebar.groupArchimateCount", { count: g.diagram_count_archimate })}
                    sx={{ width: 20, textAlign: "center" }}
                  >
                    <Typography variant="caption" color="text.secondary">
                      {g.diagram_count_archimate}
                    </Typography>
                  </Box>
                </ListItemButton>
              ))
            )}
          </List>

          <Button
            size="small"
            startIcon={<MaterialSymbol icon="settings" size={16} />}
            onClick={onManageGroups}
            sx={{ textTransform: "none", justifyContent: "flex-start", mt: 0.5 }}
          >
            {t("sidebar.manageGroups")}
          </Button>
        </Box>
      </Box>

      {/* Resize handle */}
      <Box
        onMouseDown={handleResizeMouseDown}
        sx={{
          width: 5,
          cursor: "col-resize",
          bgcolor: "transparent",
          "&:hover": { bgcolor: "primary.main", opacity: 0.3 },
          transition: "background-color 0.2s",
          zIndex: 1,
        }}
      />
    </Box>
  );
}
