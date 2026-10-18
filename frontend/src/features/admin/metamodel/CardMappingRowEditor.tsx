import { useState } from "react";
import { useTranslation } from "react-i18next";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Button from "@mui/material/Button";
import IconButton from "@mui/material/IconButton";
import FormControl from "@mui/material/FormControl";
import InputLabel from "@mui/material/InputLabel";
import Select from "@mui/material/Select";
import MenuItem from "@mui/material/MenuItem";
import MaterialSymbol from "@/components/MaterialSymbol";
import { addCardMapping, removeCardMapping } from "@/api/enterpriseObjects";
import { useSubtypeLabel, useTypeLabel } from "@/hooks/useResolveLabel";
import type { CardType, EnterpriseObject } from "@/types";

// Sentinel for the subtype <Select>'s "All subtypes" option. "" can never
// collide with a real subtype key (KeyInput-validated, never empty).
const ALL_SUBTYPES = "";

export interface CardMappingRowEditorProps {
  object: EnterpriseObject;
  /** Every card type, for the "card type" picker and for resolving existing
   *  rows' labels. Comes from `MetamodelAdmin`'s own fetch -- no second fetch here. */
  types: CardType[];
  /** Called after a successful add/remove so the caller can refetch. */
  onChanged: () => void;
}

/**
 * Per-Enterprise-Object editor for the Card Mapping bridge table
 * (`card_mappings`): lists the object's current rows with a delete button
 * each, plus an "add" row -- a card-type `Select` and, when that type has
 * subtypes, a second `Select` offering "All subtypes" (`card_subtype_key:
 * null`) or one specific subtype.
 *
 * Locking is the caller's job: `CardMappingTabContent` only renders this for
 * an unlocked Enterprise Object (Grouping's is_locked row never gets here),
 * so there is no lock check in this file.
 */
export default function CardMappingRowEditor({ object, types, onChanged }: CardMappingRowEditorProps) {
  const { t } = useTranslation(["admin", "common"]);
  const typeLabel = useTypeLabel();
  const subtypeLabel = useSubtypeLabel();

  const [typeKey, setTypeKey] = useState("");
  const [subtypeKey, setSubtypeKey] = useState(ALL_SUBTYPES);

  const selectedType = types.find((ct) => ct.key === typeKey);
  const hasSubtypes = (selectedType?.subtypes?.length ?? 0) > 0;

  const resolveTypeLabel = (key: string): string => {
    const ct = types.find((candidate) => candidate.key === key);
    return ct ? typeLabel(ct) : key;
  };

  const resolveSubtypeLabel = (typeKeyForRow: string, subtypeKeyForRow: string | null): string => {
    if (!subtypeKeyForRow) return t("metamodel.cardMappingAllSubtypes");
    const ct = types.find((candidate) => candidate.key === typeKeyForRow);
    const st = ct?.subtypes?.find((candidate) => candidate.key === subtypeKeyForRow);
    return st ? subtypeLabel(st) : subtypeKeyForRow;
  };

  const handleAdd = async () => {
    if (!typeKey) return;
    await addCardMapping(object.key, typeKey, subtypeKey || null);
    setTypeKey("");
    setSubtypeKey(ALL_SUBTYPES);
    onChanged();
  };

  const handleRemove = async (mappingId: string) => {
    await removeCardMapping(object.key, mappingId);
    onChanged();
  };

  return (
    <Box sx={{ pl: 5, pr: 2, pb: 1.5 }}>
      {object.card_mappings.map((mapping) => (
        <Box key={mapping.id} sx={{ display: "flex", alignItems: "center", gap: 1, py: 0.5 }}>
          <Typography variant="body2" sx={{ flex: 1 }}>
            {resolveTypeLabel(mapping.card_type_key)} — {resolveSubtypeLabel(mapping.card_type_key, mapping.card_subtype_key)}
          </Typography>
          <IconButton
            size="small"
            aria-label={t("metamodel.cardMappingRemoveLabel")}
            onClick={() => handleRemove(mapping.id)}
          >
            <MaterialSymbol icon="delete" size={16} />
          </IconButton>
        </Box>
      ))}

      <Box sx={{ display: "flex", alignItems: "center", gap: 1, pt: object.card_mappings.length > 0 ? 1 : 0 }}>
        <FormControl size="small" sx={{ minWidth: 180 }}>
          <InputLabel id={`card-mapping-type-label-${object.key}`}>
            {t("metamodel.cardMappingTypeLabel")}
          </InputLabel>
          <Select
            labelId={`card-mapping-type-label-${object.key}`}
            label={t("metamodel.cardMappingTypeLabel")}
            value={typeKey}
            onChange={(e) => {
              setTypeKey(e.target.value);
              setSubtypeKey(ALL_SUBTYPES);
            }}
          >
            {types.map((ct) => (
              <MenuItem key={ct.key} value={ct.key}>
                {typeLabel(ct)}
              </MenuItem>
            ))}
          </Select>
        </FormControl>

        {hasSubtypes && (
          <FormControl size="small" sx={{ minWidth: 160 }}>
            <InputLabel id={`card-mapping-subtype-label-${object.key}`}>
              {t("common:labels.subtype")}
            </InputLabel>
            <Select
              labelId={`card-mapping-subtype-label-${object.key}`}
              label={t("common:labels.subtype")}
              value={subtypeKey}
              onChange={(e) => setSubtypeKey(e.target.value)}
            >
              <MenuItem value={ALL_SUBTYPES}>
                <em>{t("metamodel.cardMappingAllSubtypes")}</em>
              </MenuItem>
              {selectedType!.subtypes!.map((st) => (
                <MenuItem key={st.key} value={st.key}>
                  {subtypeLabel(st)}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
        )}

        <Button size="small" variant="outlined" disabled={!typeKey} onClick={handleAdd}>
          {t("common:actions.add")}
        </Button>
      </Box>
    </Box>
  );
}
