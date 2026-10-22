import { useState } from "react";
import { useTranslation } from "react-i18next";
import Box from "@mui/material/Box";
import Tab from "@mui/material/Tab";
import Tabs from "@mui/material/Tabs";
import MaterialSymbol from "@/components/MaterialSymbol";
import type { CardType } from "@/types";
import CardMappingTabContent from "./CardMappingTabContent";
import ViewpointCatalogTabContent from "./ViewpointCatalogTabContent";

interface Props {
  /** Forwarded to `CardMappingTabContent`'s bridge-table editor -- fetched
   *  once by `MetamodelAdmin` and shared with every tab, no second fetch. */
  types: CardType[];
}

/**
 * The Architecture Studio tab: "Card Mapping" and "Viewpoint Catalog" as sub-tabs.
 * "Relations Mapping" (RelationsMappingTabContent) stays unmounted -- the
 * generated standard ArchiMate relation matrix is too restrictive to be
 * useful (most structural relation columns only ever resolve to
 * Grouping/And/OrJunction as a valid target); the component is kept in the
 * repo, just not routed to, in case the matrix source improves.
 *
 * Plain index state, no `?sub=` and no localStorage -- same posture as
 * `RelationsTabContent`'s own sub-tabs.
 */
export default function ArchitectureStudioTab({ types }: Props) {
  const { t } = useTranslation(["admin"]);
  const [sub, setSub] = useState(0);

  return (
    <Box>
      <Tabs
        value={sub}
        onChange={(_, v) => setSub(v)}
        variant="scrollable"
        scrollButtons="auto"
        sx={{ borderBottom: 1, borderColor: "divider", mb: 2 }}
      >
        <Tab
          label={t("metamodel.tabs.architectureStudioSub.cardMapping")}
          icon={<MaterialSymbol icon="table_chart" size={16} />}
          iconPosition="start"
          sx={{ minHeight: 40, textTransform: "none", fontSize: "0.875rem" }}
        />
        <Tab
          label={t("metamodel.tabs.architectureStudioSub.viewpointCatalog")}
          icon={<MaterialSymbol icon="visibility" size={16} />}
          iconPosition="start"
          sx={{ minHeight: 40, textTransform: "none", fontSize: "0.875rem" }}
        />
      </Tabs>
      {sub === 0 ? <CardMappingTabContent types={types} /> : <ViewpointCatalogTabContent />}
    </Box>
  );
}
