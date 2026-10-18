import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import IconButton from "@mui/material/IconButton";
import Tooltip from "@mui/material/Tooltip";
import CircularProgress from "@mui/material/CircularProgress";
import MaterialSymbol from "@/components/MaterialSymbol";
import { listEnterpriseObjects, updateEnterpriseObject } from "@/api/enterpriseObjects";
import { LAYER_ORDER, type ArchimateLayer } from "@/features/archimate/taxonomy/elements";
import type { EnterpriseObject } from "@/types";

/**
 * Read-only Enterprise Object registry list, grouped by ArchiMate layer.
 * `includeHidden: true` on the fetch -- this admin screen is the one place
 * hidden rows stay visible (unlike the drawing palette, which omits them).
 * The visibility toggle mirrors the eye-icon pattern on the Card Types tab.
 */
export default function CardMappingTabContent() {
  const { t } = useTranslation(["admin", "archimate", "common"]);
  const [objects, setObjects] = useState<EnterpriseObject[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchObjects = useCallback(async () => {
    setLoading(true);
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

  const toggleHidden = async (eo: EnterpriseObject) => {
    await updateEnterpriseObject(eo.key, { is_hidden: !eo.is_hidden });
    fetchObjects();
  };

  if (loading) {
    return (
      <Box sx={{ display: "flex", justifyContent: "center", p: 4 }}>
        <CircularProgress size={28} />
      </Box>
    );
  }

  return (
    <Box>
      {groups.map(({ layer, objects: layerObjects }) => (
        <Box key={layer} sx={{ mb: 3 }}>
          <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 1 }}>
            {t(`layers.${layer}`, { ns: "archimate" })}
          </Typography>
          {layerObjects.map((eo) => (
            <Box
              key={eo.key}
              data-testid={`eo-row-${eo.key}`}
              sx={{
                display: "flex",
                alignItems: "center",
                gap: 1.5,
                py: 1,
                borderBottom: 1,
                borderColor: "divider",
                opacity: eo.is_hidden ? 0.55 : 1,
              }}
            >
              <MaterialSymbol icon={eo.icon} size={20} color={eo.color} />
              <Typography sx={{ flex: 1 }} noWrap>
                {eo.name}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {t("metamodel.cardMappingCount", { count: eo.card_mappings.length })}
              </Typography>
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
            </Box>
          ))}
        </Box>
      ))}
    </Box>
  );
}
