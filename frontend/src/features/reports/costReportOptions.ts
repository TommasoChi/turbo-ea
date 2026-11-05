import { pickGroupableFields } from "@/lib/fieldFacets";
import { isCostItemType } from "@/lib/costItems";
import type { CostItemType, FieldDef, RelationType } from "@/types";

/** The selector entry that reports Applications and IT Components together. */
export const COMBINED_KEY = "Application+ITComponent";

type Schema = { fields: FieldDef[] }[];

export const typeKeysOf = (selection: string): string[] => selection.split("+");
export const typeParam = (selection: string): string => typeKeysOf(selection).join(",");

/** Fields of `pick(schema)` whose key exists in every schema, from the first one. */
function common(schemas: Schema[], pick: (s: Schema) => FieldDef[]): FieldDef[] {
  if (schemas.length === 0) return [];
  const [first, ...rest] = schemas.map(pick);
  return first.filter((f) => rest.every((o) => o.some((x) => x.key === f.key)));
}

export const commonCostFields = (schemas: Schema[]): FieldDef[] =>
  common(schemas, (s) => s.flatMap((x) => x.fields.filter((f) => f.type === "cost")));

export const commonGroupableFields = (schemas: Schema[]): FieldDef[] =>
  common(schemas, (s) => pickGroupableFields(s));

/** Relations the card can be grouped by: the card sits on the at-most-one end. */
export function relationGroupOptions(
  relationTypes: RelationType[],
  typeKeys: string[],
  label: (rt: RelationType) => string,
): { value: string; label: string }[] {
  if (typeKeys.length !== 1) return [];
  const [type] = typeKeys;
  return relationTypes
    .filter((rt) => {
      if (rt.is_hidden) return false;
      if (rt.cardinality === "1:n") return rt.source_type_key === type;
      return (
        rt.cardinality === "1:1" &&
        rt.source_type_key !== rt.target_type_key &&
        (rt.source_type_key === type || rt.target_type_key === type)
      );
    })
    .map((rt) => ({ value: `rel:${rt.key}`, label: label(rt) }));
}


/** The cost-type selector: TCO plus one entry per catalogue item for Application / IT Component. */
export function costFieldChoices(
  typeKeys: string[],
  catalogue: CostItemType[],
  schemaFields: { key: string; label: string }[],
  tcoLabel: string,
  labelOf: (i: CostItemType) => string,
): { key: string; label: string }[] {
  if (typeKeys.length === 0 || !typeKeys.every(isCostItemType)) return schemaFields;
  return [
    { key: "costTotalAnnual", label: tcoLabel },
    ...[...catalogue]
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((i) => ({ key: i.key, label: labelOf(i) })),
  ];
}
