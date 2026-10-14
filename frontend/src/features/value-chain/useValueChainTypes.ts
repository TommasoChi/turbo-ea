import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useMetamodel } from "@/hooks/useMetamodel";
import { useTypeLabel } from "@/hooks/useResolveLabel";
import { CARD_TYPE_COLORS, type CardTypeKey } from "@/theme/tokens";

export interface VcType {
  key: string;
  color: string;
  icon: string;
  label: string;
}

const SPEC = {
  businessProcess: { key: "BusinessProcess", icon: "route", label: "types.businessProcess" },
  businessContext: { key: "BusinessContext", icon: "conveyor_belt", label: "types.businessContext" },
  objective: { key: "Objective", icon: "flag", label: "types.objective" },
  businessCapability: { key: "BusinessCapability", icon: "hub", label: "types.businessCapability" },
  application: { key: "Application", icon: "apps", label: "types.application" },
  dataObject: { key: "DataObject", icon: "database", label: "types.dataObject" },
  organization: { key: "Organization", icon: "corporate_fare", label: "types.organization" },
} as const satisfies Record<string, { key: CardTypeKey; icon: string; label: string }>;

// Record, not a homomorphic mapped type: the latter would inherit SPEC's `readonly`.
export type ValueChainTypes = Record<keyof typeof SPEC, VcType>;

export function useValueChainTypes(): ValueChainTypes {
  const { t } = useTranslation("valuechain");
  const { types } = useMetamodel();
  const typeLabel = useTypeLabel();
  return useMemo(() => {
    const out = {} as ValueChainTypes;
    for (const name of Object.keys(SPEC) as (keyof typeof SPEC)[]) {
      const spec = SPEC[name];
      const type = types.find((x) => x.key === spec.key);
      out[name] = {
        key: spec.key,
        color: type?.color ?? CARD_TYPE_COLORS[spec.key],
        icon: type?.icon ?? spec.icon,
        label: type ? typeLabel(type) : t(spec.label),
      };
    }
    return out;
  }, [types, typeLabel, t]);
}
