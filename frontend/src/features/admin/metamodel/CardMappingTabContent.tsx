import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import Box from "@mui/material/Box";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import Collapse from "@mui/material/Collapse";
import Typography from "@mui/material/Typography";
import Button from "@mui/material/Button";
import ButtonBase from "@mui/material/ButtonBase";
import IconButton from "@mui/material/IconButton";
import Tooltip from "@mui/material/Tooltip";
import CircularProgress from "@mui/material/CircularProgress";
import MaterialSymbol from "@/components/MaterialSymbol";
import { listEnterpriseObjects, updateEnterpriseObject } from "@/api/enterpriseObjects";
import { LAYER_ORDER, type ArchimateLayer } from "@/features/archimate/taxonomy/elements";
import { ARCHIMATE_LAYER_COLORS, ARCHIMATE_TEXT_COLOR } from "@/theme/tokens";
import { useAuthContext } from "@/hooks/AuthContext";
import { usePermissions } from "@/hooks/usePermissions";
import type { CardType, EnterpriseObject } from "@/types";
import CardMappingRowEditor from "./CardMappingRowEditor";
import EnterpriseObjectPopover from "./EnterpriseObjectPopover";
import NewArchitectureObjectDialog from "./NewArchitectureObjectDialog";

export interface CardMappingTabContentProps {
  /** Card types for the bridge-table editor's "card type" picker. Optional
   *  so existing callers/tests that render this without wiring the prop
   *  through yet keep working -- the editor just has nothing to offer. */
  types?: CardType[];
}

type Aspect = "passive" | "behavior" | "active";
const ASPECTS: Aspect[] = ["passive", "behavior", "active"];

// The Aspects x Layers framework only classifies Strategy..Implementation &
// Migration -- Motivation and the "Other" composites sit outside that grid
// entirely (see ArchiMate-Full-Framework.png), so their rows get no aspect
// cells at all rather than three permanently-empty ones.
const ASPECT_LAYERS = new Set<ArchimateLayer>([
  "strategy", "business", "application", "technology", "physical", "implementation",
]);

/**
 * Read-only Enterprise Object registry list, grouped by ArchiMate layer.
 * `includeHidden: true` on the fetch -- this admin screen is the one place
 * hidden rows stay visible (unlike the drawing palette, which omits them).
 * The visibility toggle mirrors the eye-icon pattern on the Card Types tab.
 *
 * Each row also expands into a `CardMappingRowEditor` for its `card_mappings`
 * bridge-table rows. A locked Enterprise Object (`Grouping`, seeded with
 * `is_locked: true`) never gets the expand control at all -- mirroring the
 * visibility toggle's lock gating -- so there is no path to attempt an
 * add/remove on it.
 *
 * Layer sections are colour-coded from the same `ARCHIMATE_LAYER_COLORS` the
 * diagram canvas uses, and collapsible (local, unpersisted state -- there is
 * no server-side "last collapsed" concept here, unlike GovernanceTab's
 * localStorage-backed sub-tab).
 */
export default function CardMappingTabContent({ types = [] }: CardMappingTabContentProps) {
  const { t } = useTranslation(["admin", "archimate", "common"]);
  const { user } = useAuthContext();
  const { can } = usePermissions(user);
  const canEdit = can("admin.metamodel");
  const [objects, setObjects] = useState<EnterpriseObject[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [infoAnchor, setInfoAnchor] = useState<HTMLElement | null>(null);
  // The KEY only, not a snapshot of the object -- `infoObject` below is derived fresh from
  // `objects` on every render, so an already-open popover picks up a refetch (e.g. after it
  // saves its own edit) without a remount or any extra plumbing. A snapshot would otherwise go
  // stale the moment `objects` is replaced underneath it.
  const [infoKey, setInfoKey] = useState<string | null>(null);
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const [collapsedLayers, setCollapsedLayers] = useState<Set<ArchimateLayer>>(() => new Set());

  // No `setLoading(true)` here: `loading` already starts `true` (first load keeps its spinner),
  // and every OTHER call is a refetch after a mutation (visibility toggle, create, mapping edit,
  // popover save) -- looping back through the full-page spinner on every one of those used to
  // unmount the whole tab (including an open popover) and remount it from scratch, which is what
  // made the popover blink out and reappear mispositioned/stale after a save.
  const fetchObjects = useCallback(async () => {
    try {
      setObjects(await listEnterpriseObjects(true));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchObjects();
  }, [fetchObjects]);

  // The four "Other" rows (Grouping, Location, AndJunction, OrJunction) carry
  // layer: null -- they sit outside the normal ArchiMate layer grouping, so
  // they get folded into LAYER_ORDER's trailing "other" bucket instead of
  // disappearing or needing a separate code path.
  const groups = useMemo(() => {
    const byLayer = new Map<ArchimateLayer, EnterpriseObject[]>();
    for (const eo of objects) {
      const layer = (eo.layer ?? "other") as ArchimateLayer;
      const bucket = byLayer.get(layer);
      if (bucket) bucket.push(eo);
      else byLayer.set(layer, [eo]);
    }
    return LAYER_ORDER.filter((layer) => byLayer.has(layer)).map((layer) => ({
      layer,
      objects: byLayer.get(layer)!,
    }));
  }, [objects]);

  const toggleLayer = (layer: ArchimateLayer) => {
    setCollapsedLayers((prev) => {
      const next = new Set(prev);
      if (next.has(layer)) next.delete(layer);
      else next.add(layer);
      return next;
    });
  };

  const toggleHidden = async (eo: EnterpriseObject) => {
    await updateEnterpriseObject(eo.key, { is_hidden: !eo.is_hidden });
    fetchObjects();
  };

  // Click the aspect a row already has to clear it back to unclassified;
  // click a different one to switch. Standard rows start seeded with the
  // aspect the standard fixes for their type (taxonomy.py's aspect_of()) but
  // are not otherwise protected from this -- same posture as their name,
  // icon and colour, which an admin can already edit freely.
  const setAspect = async (eo: EnterpriseObject, aspect: Aspect) => {
    await updateEnterpriseObject(eo.key, { aspect: eo.aspect === aspect ? null : aspect });
    fetchObjects();
  };

  const openInfo = (event: React.MouseEvent<HTMLElement>, eo: EnterpriseObject) => {
    setInfoAnchor(event.currentTarget);
    setInfoKey(eo.key);
  };
  const closeInfo = () => {
    setInfoAnchor(null);
    setInfoKey(null);
  };
  const infoObject = infoKey ? objects.find((o) => o.key === infoKey) ?? null : null;

  if (loading) {
    return (
      <Box sx={{ display: "flex", justifyContent: "center", p: 4 }}>
        <CircularProgress size={28} />
      </Box>
    );
  }

  return (
    <Box>
      <Box sx={{ display: "flex", justifyContent: "flex-end", mb: 2 }}>
        <Button
          variant="contained"
          startIcon={<MaterialSymbol icon="add" size={18} />}
          onClick={() => setCreateOpen(true)}
        >
          {t("metamodel.newArchitectureObject")}
        </Button>
      </Box>

      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell padding="checkbox" />
            <TableCell>{t("metamodel.columns.enterpriseObject")}</TableCell>
            <TableCell align="center">{t("metamodel.columns.passive")}</TableCell>
            <TableCell align="center">{t("metamodel.columns.behavior")}</TableCell>
            <TableCell align="center">{t("metamodel.columns.active")}</TableCell>
            <TableCell align="right">{t("metamodel.columns.mapping")}</TableCell>
            <TableCell padding="checkbox" />
            <TableCell padding="checkbox" />
          </TableRow>
        </TableHead>
        <TableBody>
          {groups.map(({ layer, objects: layerObjects }) => {
            const open = !collapsedLayers.has(layer);
            const fill = ARCHIMATE_LAYER_COLORS[layer].fill;
            const showAspects = ASPECT_LAYERS.has(layer);
            return (
              <Fragment key={layer}>
                <TableRow>
                  {/* colSpan={8}: icon, name, 3 aspect cells, mapping count, expand, visibility. */}
                  <TableCell colSpan={8} sx={{ p: 0, border: 0 }}>
                    <ButtonBase
                      onClick={() => toggleLayer(layer)}
                      sx={{
                        width: "100%",
                        justifyContent: "flex-start",
                        gap: 1,
                        px: 1.5,
                        py: 0.75,
                        backgroundColor: fill,
                        color: ARCHIMATE_TEXT_COLOR,
                        borderRadius: 1,
                      }}
                    >
                      <MaterialSymbol icon={open ? "expand_more" : "chevron_right"} size={18} />
                      <Typography variant="subtitle2" sx={{ color: "inherit" }}>
                        {t(`layers.${layer}`, { ns: "archimate" })}
                      </Typography>
                    </ButtonBase>
                  </TableCell>
                </TableRow>
                {open &&
                  layerObjects.map((eo) => (
                    <Fragment key={eo.key}>
                      <TableRow
                        data-testid={`eo-row-${eo.key}`}
                        sx={{ opacity: eo.is_hidden ? 0.55 : 1 }}
                      >
                        <TableCell padding="checkbox">
                          <MaterialSymbol icon={eo.icon} size={20} color={eo.color} />
                        </TableCell>
                        <TableCell>
                          <ButtonBase
                            onClick={(e) => openInfo(e, eo)}
                            sx={{ justifyContent: "flex-start", p: 0.5, borderRadius: 1, maxWidth: "100%" }}
                          >
                            <Typography noWrap>{eo.name}</Typography>
                          </ButtonBase>
                        </TableCell>
                        {ASPECTS.map((aspect) => (
                          <TableCell key={aspect} align="center">
                            {showAspects && (
                              <IconButton
                                size="small"
                                disabled={eo.is_locked}
                                aria-label={t(`metamodel.columns.${aspect}`)}
                                aria-pressed={eo.aspect === aspect}
                                onClick={() => setAspect(eo, aspect)}
                              >
                                <MaterialSymbol
                                  icon={eo.aspect === aspect ? "check_circle" : "radio_button_unchecked"}
                                  size={16}
                                  color={eo.aspect === aspect ? ARCHIMATE_LAYER_COLORS[layer].stroke : "#ddd"}
                                />
                              </IconButton>
                            )}
                          </TableCell>
                        ))}
                        <TableCell align="right">
                          <Typography variant="caption" color="text.secondary">
                            {t("metamodel.cardMappingCount", { count: eo.card_mappings.length })}
                          </Typography>
                        </TableCell>
                        <TableCell padding="checkbox">
                          {/* Locked rows (Grouping) never get the expand control -- no
                              path to attempt an add/remove on a bridge table whose
                              registry row the API rejects every edit to, per Task 9's
                              is_locked gating. */}
                          {!eo.is_locked && (
                            <IconButton
                              size="small"
                              aria-label={t("metamodel.cardMappingExpandLabel")}
                              onClick={() => setExpandedKey(expandedKey === eo.key ? null : eo.key)}
                            >
                              <MaterialSymbol
                                icon={expandedKey === eo.key ? "expand_less" : "expand_more"}
                                size={18}
                                color="#bbb"
                              />
                            </IconButton>
                          )}
                        </TableCell>
                        <TableCell padding="checkbox">
                          <Tooltip
                            title={
                              eo.is_locked
                                ? t("metamodel.cardMappingLocked")
                                : eo.is_hidden
                                  ? t("common:actions.restore")
                                  : t("metamodel.hidden")
                            }
                          >
                            {/* A disabled button inside a Tooltip needs a wrapping span --
                                MUI's Tooltip can't attach its listeners to a disabled
                                child directly. */}
                            <span>
                              <IconButton
                                size="small"
                                aria-label={
                                  eo.is_locked
                                    ? t("metamodel.cardMappingLocked")
                                    : eo.is_hidden
                                      ? t("common:actions.restore")
                                      : t("metamodel.hidden")
                                }
                                disabled={eo.is_locked}
                                onClick={() => toggleHidden(eo)}
                              >
                                <MaterialSymbol
                                  icon={eo.is_hidden ? "visibility_off" : "visibility"}
                                  size={18}
                                  color={eo.is_locked ? "#ccc" : eo.is_hidden ? "#f57c00" : "#bbb"}
                                />
                              </IconButton>
                            </span>
                          </Tooltip>
                        </TableCell>
                      </TableRow>
                      {!eo.is_locked && (
                        <TableRow>
                          <TableCell colSpan={8} sx={{ p: 0, border: 0 }}>
                            <Collapse in={expandedKey === eo.key}>
                              <CardMappingRowEditor object={eo} types={types} onChanged={fetchObjects} />
                            </Collapse>
                          </TableCell>
                        </TableRow>
                      )}
                    </Fragment>
                  ))}
              </Fragment>
            );
          })}
        </TableBody>
      </Table>

      <NewArchitectureObjectDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={fetchObjects}
      />

      {infoObject && (
        <EnterpriseObjectPopover
          object={infoObject}
          anchorEl={infoAnchor}
          onClose={closeInfo}
          canEdit={canEdit}
          onSaved={fetchObjects}
        />
      )}
    </Box>
  );
}
