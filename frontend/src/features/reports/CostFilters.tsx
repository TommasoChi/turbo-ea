import { useTranslation } from "react-i18next";
import { useApiQuery } from "@/hooks/useApiQuery";
import { useMetamodel } from "@/hooks/useMetamodel";
import { useTypeLabel } from "@/hooks/useResolveLabel";
import CardFilterSection from "./CardFilterSection";
import { EMPTY_CARD_FILTERS } from "./cardFilters";
import type { CardFilterValue, FilterMember } from "./cardFilters";
import type { CostCardFilters } from "./costCardFilters";
import type { RelTypeDef } from "./portfolioHelpers";
import { useCardFilterOptions } from "./useCardFilterOptions";

/** `GET /reports/cost-filter-options`: the facets a type's cost filter offers. */
interface CostFilterOptions {
  relation_types: RelTypeDef[];
  groupable_types: Record<string, FilterMember[]>;
}

const NO_RELATION_TYPES: RelTypeDef[] = [];
const NO_GROUPABLE: Record<string, FilterMember[]> = {};

interface SectionProps {
  typeKey: string;
  value: CardFilterValue;
  onChange: (next: CardFilterValue) => void;
  collapsed: boolean;
  onToggle: () => void;
}

function TypeFilters({ typeKey, value, onChange, collapsed, onToggle }: SectionProps) {
  const { t } = useTranslation(["reports"]);
  const { types } = useMetamodel();
  const typeLabel = useTypeLabel();
  const { data } = useApiQuery<CostFilterOptions>(
    `/reports/cost-filter-options?type=${encodeURIComponent(typeKey)}`,
  );
  const { relationOptions, relSubtypes, subtypeOptions, facetFields } = useCardFilterOptions({
    cardTypeKey: typeKey,
    relationTypes: data?.relation_types ?? NO_RELATION_TYPES,
    groupableTypes: data?.groupable_types ?? NO_GROUPABLE,
    includeDescendants: value.includeDescendants,
  });

  return (
    <CardFilterSection
      label={t("portfolio.typeFilters", {
        type: typeLabel(types.find((tp) => tp.key === typeKey)) || typeKey,
      })}
      collapsed={collapsed}
      onToggle={onToggle}
      value={value}
      onChange={onChange}
      relationOptions={relationOptions}
      tagGroups={[]}
      subtypeOptions={subtypeOptions}
      fields={facetFields}
      relSubtypes={relSubtypes}
      onClearAll={() =>
        onChange({ ...EMPTY_CARD_FILTERS, includeDescendants: value.includeDescendants })
      }
      disabledReason={data?.relation_types ? undefined : t("cost.filtersUnavailable")}
    />
  );
}

/** The cost report's field and relation filters: one section per selected card type. */
export default function CostFilters({
  typeKeys,
  value,
  onChange,
  collapsed,
  onToggle,
}: {
  typeKeys: string[];
  value: CostCardFilters;
  onChange: (next: CostCardFilters) => void;
  collapsed: boolean;
  onToggle: () => void;
}) {
  return (
    <>
      {typeKeys.map((key) => (
        <TypeFilters
          key={key}
          typeKey={key}
          value={value[key] ?? EMPTY_CARD_FILTERS}
          onChange={(next) => onChange({ ...value, [key]: next })}
          collapsed={collapsed}
          onToggle={onToggle}
        />
      ))}
    </>
  );
}
