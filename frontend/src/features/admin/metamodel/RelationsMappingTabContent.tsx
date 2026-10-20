import { Fragment, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import Box from "@mui/material/Box";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import Typography from "@mui/material/Typography";
import ButtonBase from "@mui/material/ButtonBase";
import Select from "@mui/material/Select";
import MenuItem from "@mui/material/MenuItem";
import Tooltip from "@mui/material/Tooltip";
import CircularProgress from "@mui/material/CircularProgress";
import MaterialSymbol from "@/components/MaterialSymbol";
import { listEnterpriseObjects } from "@/api/enterpriseObjects";
import { api } from "@/api/client";
import { LAYER_ORDER, type ArchimateLayer } from "@/features/archimate/taxonomy/elements";
import {
  RELATIONSHIP_TYPES,
  isRelationshipAllowed,
  type RelationshipType,
} from "@/features/archimate/taxonomy/relationships";
import { ARCHIMATE_LAYER_COLORS, ARCHIMATE_TEXT_COLOR } from "@/theme/tokens";
import { useTypeLabel } from "@/hooks/useResolveLabel";
import type { CardType, EnterpriseObject, RelationType } from "@/types";

export interface RelationsMappingTabContentProps {
  /** For resolving a card type key to its label -- same list the Card Mapping
   *  tab receives, fetched once by `MetamodelAdmin`. */
  types: CardType[];
}

/** Every distinct card type a bridge-table row maps the object to. */
function cardTypesOf(eo: EnterpriseObject): string[] {
  return [...new Set(eo.card_mappings.map((m) => m.card_type_key))];
}

/** The RelationType row(s), if any, that already connect this exact card-type
 *  pair under this ArchiMate relationship -- `archimate_reversed` means the
 *  RelationType's own source/target are stored swapped relative to the
 *  ArchiMate direction, so the match flips with it. */
function matchingRelationTypes(
  relationTypes: RelationType[],
  sourceCardType: string,
  targetCardType: string,
  rel: RelationshipType,
): RelationType[] {
  return relationTypes.filter(
    (rt) =>
      rt.archimate_type === rel &&
      (rt.archimate_reversed
        ? rt.source_type_key === targetCardType && rt.target_type_key === sourceCardType
        : rt.source_type_key === sourceCardType && rt.target_type_key === targetCardType),
  );
}

interface CellPick {
  target?: string;
  sourceCardType?: string;
  targetCardType?: string;
}

/**
 * Read-only explorer: for each Enterprise Object and each of the 11 ArchiMate
 * relationship types, lets an admin pick a valid target object (per the
 * standard relation matrix, `isRelationshipAllowed`) and see whether a real
 * `RelationType` already connects the two objects' mapped card types -- if
 * so, its functional label ("hosts") is shown instead of the generic verb
 * ("Serving"). Changes nothing: real diagrams already resolve this at the
 * card-instance level (`resolveMapping.ts`); this tab only makes the mapping
 * visible and explorable. The one genuinely *editable* piece this feature
 * needed -- `RelationType.archimate_type`/`archimate_access`/
 * `archimate_reversed` -- lives in `RelationTypesPanel`'s edit dialog.
 *
 * Hidden objects behave exactly as in `CardMappingTabContent`: the row still
 * renders (dimmed), but a hidden object never appears as a selectable target
 * for another row's relationship column.
 */
export default function RelationsMappingTabContent({ types }: RelationsMappingTabContentProps) {
  const { t } = useTranslation(["admin", "archimate"]);
  const typeLabel = useTypeLabel();
  const [objects, setObjects] = useState<EnterpriseObject[]>([]);
  const [relationTypes, setRelationTypes] = useState<RelationType[]>([]);
  const [loading, setLoading] = useState(true);
  const [collapsedLayers, setCollapsedLayers] = useState<Set<ArchimateLayer>>(() => new Set());
  const [picks, setPicks] = useState<Record<string, CellPick>>({});

  useEffect(() => {
    (async () => {
      const [eo, rt] = await Promise.all([
        listEnterpriseObjects(true),
        api.get<RelationType[]>("/metamodel/relation-types?include_hidden=true"),
      ]);
      setObjects(eo);
      setRelationTypes(rt);
      setLoading(false);
    })();
  }, []);

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

  const resolveType = (key: string) => types.find((ct) => ct.key === key);

  const setPick = (cellKey: string, patch: CellPick) => {
    setPicks((prev) => ({ ...prev, [cellKey]: { ...prev[cellKey], ...patch } }));
  };

  // Hidden objects never appear as a pickable target -- same invisibility as
  // the Card Mapping tab, just enforced here instead of by not rendering a row.
  const visibleTargets = (source: EnterpriseObject, rel: RelationshipType) =>
    objects.filter(
      (o) => o.key !== source.key && !o.is_hidden && isRelationshipAllowed(source.key, o.key, rel),
    );

  const renderCell = (source: EnterpriseObject, rel: RelationshipType) => {
    const targets = visibleTargets(source, rel);
    if (targets.length === 0) return null;

    const cellKey = `${source.key}|${rel}`;
    const pick = picks[cellKey] ?? {};
    const target = pick.target ? objects.find((o) => o.key === pick.target) : undefined;

    const sourceCardTypes = cardTypesOf(source);
    const targetCardTypes = target ? cardTypesOf(target) : [];
    const sourceCardType = sourceCardTypes.length === 1 ? sourceCardTypes[0] : pick.sourceCardType;
    const targetCardType = targetCardTypes.length === 1 ? targetCardTypes[0] : pick.targetCardType;

    const matches =
      target && sourceCardType && targetCardType
        ? matchingRelationTypes(relationTypes, sourceCardType, targetCardType, rel)
        : [];

    return (
      <Box sx={{ display: "flex", flexDirection: "column", gap: 0.5, minWidth: 160, py: 0.5 }}>
        <Select
          size="small"
          variant="standard"
          displayEmpty
          value={pick.target ?? ""}
          onChange={(e) =>
            setPick(cellKey, {
              target: e.target.value || undefined,
              sourceCardType: undefined,
              targetCardType: undefined,
            })
          }
          sx={{ fontSize: "0.75rem" }}
        >
          <MenuItem value="">
            <em>{t("metamodel.relationsMapping.pickTarget")}</em>
          </MenuItem>
          {targets.map((o) => (
            <MenuItem key={o.key} value={o.key}>
              {o.name}
            </MenuItem>
          ))}
        </Select>

        {target && sourceCardTypes.length === 0 && (
          <Typography variant="caption" color="text.secondary">
            {t("metamodel.relationsMapping.noCardMapping", { object: source.name })}
          </Typography>
        )}
        {target && sourceCardTypes.length > 1 && (
          <Select
            size="small"
            variant="standard"
            displayEmpty
            value={pick.sourceCardType ?? ""}
            onChange={(e) => setPick(cellKey, { sourceCardType: e.target.value || undefined })}
            sx={{ fontSize: "0.75rem" }}
          >
            <MenuItem value="">
              <em>{t("metamodel.relationsMapping.pickCardType", { object: source.name })}</em>
            </MenuItem>
            {sourceCardTypes.map((ctk) => (
              <MenuItem key={ctk} value={ctk}>
                {typeLabel(resolveType(ctk)) || ctk}
              </MenuItem>
            ))}
          </Select>
        )}

        {target && targetCardTypes.length === 0 && (
          <Typography variant="caption" color="text.secondary">
            {t("metamodel.relationsMapping.noCardMapping", { object: target.name })}
          </Typography>
        )}
        {target && targetCardTypes.length > 1 && (
          <Select
            size="small"
            variant="standard"
            displayEmpty
            value={pick.targetCardType ?? ""}
            onChange={(e) => setPick(cellKey, { targetCardType: e.target.value || undefined })}
            sx={{ fontSize: "0.75rem" }}
          >
            <MenuItem value="">
              <em>{t("metamodel.relationsMapping.pickCardType", { object: target.name })}</em>
            </MenuItem>
            {targetCardTypes.map((ctk) => (
              <MenuItem key={ctk} value={ctk}>
                {typeLabel(resolveType(ctk)) || ctk}
              </MenuItem>
            ))}
          </Select>
        )}

        {target && sourceCardType && targetCardType && (
          <Typography variant="caption" sx={{ fontWeight: 600 }}>
            {matches.length > 0
              ? matches.map((m) => m.label).join(", ")
              : t(`relationships.${rel}`, { ns: "archimate" })}
          </Typography>
        )}
      </Box>
    );
  };

  if (loading) {
    return (
      <Box sx={{ display: "flex", justifyContent: "center", p: 4 }}>
        <CircularProgress size={28} />
      </Box>
    );
  }

  return (
    <Box sx={{ overflowX: "auto" }}>
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell padding="checkbox" />
            <TableCell>{t("metamodel.columns.enterpriseObject")}</TableCell>
            {RELATIONSHIP_TYPES.map((rel) => (
              <TableCell key={rel} align="center">
                <Tooltip title={t(`relationshipDefinitions.${rel}`, { ns: "archimate" })}>
                  <Box sx={{ display: "inline-flex", alignItems: "center", gap: 0.5 }}>
                    <Typography variant="caption" sx={{ fontWeight: 600 }}>
                      {t(`relationships.${rel}`, { ns: "archimate" })}
                    </Typography>
                    <MaterialSymbol icon="info" size={14} color="#999" />
                  </Box>
                </Tooltip>
              </TableCell>
            ))}
          </TableRow>
        </TableHead>
        <TableBody>
          {groups.map(({ layer, objects: layerObjects }) => {
            const open = !collapsedLayers.has(layer);
            const fill = ARCHIMATE_LAYER_COLORS[layer].fill;
            return (
              <Fragment key={layer}>
                <TableRow>
                  <TableCell colSpan={2 + RELATIONSHIP_TYPES.length} sx={{ p: 0, border: 0 }}>
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
                    <TableRow key={eo.key} sx={{ opacity: eo.is_hidden ? 0.55 : 1 }}>
                      <TableCell padding="checkbox">
                        <MaterialSymbol icon={eo.icon} size={20} color={eo.color} />
                      </TableCell>
                      <TableCell>
                        <Typography noWrap variant="body2">
                          {eo.name}
                        </Typography>
                      </TableCell>
                      {RELATIONSHIP_TYPES.map((rel) => (
                        <TableCell key={rel}>{renderCell(eo, rel)}</TableCell>
                      ))}
                    </TableRow>
                  ))}
              </Fragment>
            );
          })}
        </TableBody>
      </Table>
    </Box>
  );
}
