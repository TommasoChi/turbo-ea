import { useState } from "react";
import { useTranslation } from "react-i18next";
import Box from "@mui/material/Box";
import Tab from "@mui/material/Tab";
import Tabs from "@mui/material/Tabs";
import MaterialSymbol from "@/components/MaterialSymbol";
import type { CardType } from "@/types";
import CardMappingTabContent from "./CardMappingTabContent";
import RelationsMappingTabContent from "./RelationsMappingTabContent";

interface Props {
  /** Forwarded to `CardMappingTabContent`'s bridge-table editor -- fetched
   *  once by `MetamodelAdmin` and shared with every tab, no second fetch. */
  types: CardType[];
}

/**
 * The Architecture Studio tab: a nested Tabs/Tab shell with "Card Mapping"
 * and "Relations Mapping". Mirrors RelationsTabContent's local `sub` state --
 * no `?sub=` and no localStorage, for the same reason it gives there: a
 * refresh already lands back on Card Types, so a restored sub-tab would sit
 * under a parent nobody returned to.
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
          icon={<MaterialSymbol icon="dashboard" size={16} />}
          iconPosition="start"
          sx={{ minHeight: 40, textTransform: "none", fontSize: "0.875rem" }}
        />
        <Tab
          label={t("metamodel.tabs.architectureStudioSub.relationsMapping")}
          icon={<MaterialSymbol icon="share" size={16} />}
          iconPosition="start"
          sx={{ minHeight: 40, textTransform: "none", fontSize: "0.875rem" }}
        />
      </Tabs>

      {sub === 0 && <CardMappingTabContent types={types} />}
      {sub === 1 && <RelationsMappingTabContent types={types} />}
    </Box>
  );
}
