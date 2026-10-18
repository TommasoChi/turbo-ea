import { useState } from "react";
import { useTranslation } from "react-i18next";
import Box from "@mui/material/Box";
import Tab from "@mui/material/Tab";
import Tabs from "@mui/material/Tabs";
import MaterialSymbol from "@/components/MaterialSymbol";
import CardMappingTabContent from "./CardMappingTabContent";

/**
 * The Architecture Studio tab: a nested Tabs/Tab shell with one entry so far
 * ("Card Mapping"). Mirrors RelationsTabContent's local `sub` state -- no
 * `?sub=` and no localStorage, for the same reason it gives there: a refresh
 * already lands back on Card Types, so a restored sub-tab would sit under a
 * parent nobody returned to. Later tasks (a description popover, the
 * bridge-table editor) add sub-tabs beside this one.
 */
export default function ArchitectureStudioTab() {
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
      </Tabs>

      {sub === 0 && <CardMappingTabContent />}
    </Box>
  );
}
