/**
 * ArchimateViewpointPicker — combo box to pick an ArchiMate Viewpoint, then a
 * grid of starter cards (a blank model + one per the Viewpoint's examples) to
 * pick the new diagram's starting content from.
 *
 * The card grid reuses BpmnTemplateChooser.tsx's CardActionArea markup
 * (Card > CardActionArea > CardContent, same icon/typography layout) — see
 * that file. Unlike BPMN templates, every card here belongs to one specific
 * Viewpoint, so there is a Viewpoint-selection step above the grid.
 */
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import Autocomplete from "@mui/material/Autocomplete";
import Box from "@mui/material/Box";
import Card from "@mui/material/Card";
import CardActionArea from "@mui/material/CardActionArea";
import CardContent from "@mui/material/CardContent";
import Checkbox from "@mui/material/Checkbox";
import CircularProgress from "@mui/material/CircularProgress";
import Grid from "@mui/material/Grid";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import MaterialSymbol from "@/components/MaterialSymbol";
import { api } from "@/api/client";
import {
  getSuggestedCards,
  getViewpointExampleXml,
  listViewpointsForTab,
  type SuggestedCardType,
  type ViewpointTab,
} from "@/api/diagrams";
import { addCardNode, emptyModel } from "@/features/archimate/exchange/exchangeModel";
import { readExchange } from "@/features/archimate/exchange/readExchange";
import { writeExchange } from "@/features/archimate/exchange/writeExchange";
import type { ElementType } from "@/features/archimate/taxonomy/elements";
import { useMetamodel } from "@/hooks/useMetamodel";
import { useTypeLabel } from "@/hooks/useResolveLabel";
import type { ArchimateViewpointForPicker, Card as EaCard } from "@/types";

interface Props {
  /** `null` is the unscoped `Diagrams` entry point — every Viewpoint, no layer filter. */
  tab: ViewpointTab | null;
  onSelect: (
    viewpointKey: string,
    startingXml: string | null,
    suggestedCardIds: string[],
    viewpointName: string,
    linkedCardIds: string[],
  ) => void;
  /** Disables the whole grid — e.g. while the caller's own create call (kicked
   *  off from a previous `onSelect`) is still in flight. */
  disabled?: boolean;
}

export default function ArchimateViewpointPicker({ tab, onSelect, disabled }: Props) {
  const { t } = useTranslation(["diagrams", "common"]);
  const { types: metamodelTypes } = useMetamodel();
  const typeLabel = useTypeLabel();
  const [viewpoints, setViewpoints] = useState<ArchimateViewpointForPicker[]>([]);
  const [viewpoint, setViewpoint] = useState<ArchimateViewpointForPicker | null>(null);
  // Key of the card currently being turned into a diagram ("blank" or an example id) —
  // disables the rest of the grid and shows a spinner on that one card while its
  // (possibly fetched) starting XML and suggested cards are resolved.
  const [pending, setPending] = useState<string | null>(null);

  // Optional: the card types this viewpoint's allowed Enterprise Objects map
  // to, and every card of one of those types -- picking one or more (same
  // "Linked cards" field drawio's own create-diagram dialog offers) gets
  // each materialized as a real node on whichever starter the user then
  // picks (blank or an example), not just linked as metadata.
  const [cardTypeOptions, setCardTypeOptions] = useState<SuggestedCardType[]>([]);
  const [allCards, setAllCards] = useState<EaCard[]>([]);
  const [cards, setCards] = useState<EaCard[]>([]);

  const typeMap = useMemo(
    () => Object.fromEntries(metamodelTypes.map((mt) => [mt.key, mt])),
    [metamodelTypes],
  );
  const eoKeyByCardType = useMemo(
    () => Object.fromEntries(cardTypeOptions.map((o) => [o.card_type_key, o.enterprise_object_key])),
    [cardTypeOptions],
  );
  const eligibleCards = useMemo(() => {
    const eligibleTypes = new Set(cardTypeOptions.map((o) => o.card_type_key));
    return allCards.filter((c) => eligibleTypes.has(c.type));
  }, [allCards, cardTypeOptions]);

  useEffect(() => {
    setViewpoint(null);
    listViewpointsForTab(tab)
      .then(setViewpoints)
      .catch(() => setViewpoints([]));
  }, [tab]);

  useEffect(() => {
    setCards([]);
    if (!viewpoint) {
      setCardTypeOptions([]);
      return;
    }
    getSuggestedCards(viewpoint.key, tab)
      .then(setCardTypeOptions)
      .catch(() => setCardTypeOptions([]));
  }, [viewpoint, tab]);

  // Lazy-load cards the first time a viewpoint with suggested card types is picked.
  useEffect(() => {
    if (cardTypeOptions.length === 0 || allCards.length > 0) return;
    api
      .get<{ items: EaCard[] }>("/cards?page_size=500")
      .then((res) => setAllCards(res.items))
      .catch(() => {
        // Linking is optional — silent fall-through is acceptable.
      });
  }, [cardTypeOptions.length, allCards.length]);

  const handlePick = async (cardKey: string, startingXml: Promise<string | null>) => {
    if (!viewpoint || pending) return;
    setPending(cardKey);
    try {
      let xml = await startingXml;
      if (xml !== null && cards.length > 0) {
        let model = readExchange(xml);
        for (const c of cards) {
          const eoKey = eoKeyByCardType[c.type];
          if (eoKey) model = addCardNode(model, eoKey as ElementType, c.name, c.id);
        }
        xml = writeExchange(model);
      }
      const suggestedCardIds = cardTypeOptions.map((o) => o.card_type_key);
      onSelect(viewpoint.key, xml, suggestedCardIds, viewpoint.name, cards.map((c) => c.id));
    } finally {
      setPending(null);
    }
  };

  return (
    <Box>
      <Autocomplete
        options={viewpoints}
        getOptionLabel={(v) => v.name}
        isOptionEqualToValue={(a, b) => a.key === b.key}
        value={viewpoint}
        onChange={(_, v) => setViewpoint(v)}
        renderInput={(params) => (
          <TextField {...params} label={t("archimatePicker.viewpoint")} autoFocus />
        )}
      />

      {viewpoint && cardTypeOptions.length > 0 && (
        <Autocomplete
          multiple
          sx={{ mt: 2 }}
          options={eligibleCards}
          getOptionLabel={(c) => c.name}
          groupBy={(c) => typeLabel(typeMap[c.type]) || c.type}
          isOptionEqualToValue={(a, b) => a.id === b.id}
          value={cards}
          disabled={!!pending || disabled}
          onChange={(_, v) => setCards(v)}
          disableCloseOnSelect
          renderOption={(props, option, { selected }) => (
            <li {...props} key={option.id}>
              <Checkbox size="small" checked={selected} sx={{ mr: 1 }} />
              <MaterialSymbol icon={typeMap[option.type]?.icon || "apps"} size={18} color={typeMap[option.type]?.color} />
              <Box component="span" sx={{ ml: 0.5 }}>
                {option.name}
              </Box>
            </li>
          )}
          renderInput={(params) => (
            <TextField
              {...params}
              label={t("gallery.linkedCards")}
              helperText={t("gallery.linkedCardsHelperText")}
            />
          )}
        />
      )}

      {viewpoint && (
        <Grid container spacing={2} sx={{ mt: 2 }}>
          <Grid item xs={6} sm={4}>
            <Card variant="outlined">
              <CardActionArea
                disabled={!!pending || disabled}
                onClick={() =>
                  handlePick(
                    "blank",
                    Promise.resolve(writeExchange(emptyModel(viewpoint.name))),
                  )
                }
              >
                <CardContent sx={{ textAlign: "center", py: 3 }}>
                  {pending === "blank" ? (
                    <CircularProgress size={40} />
                  ) : (
                    <MaterialSymbol icon="note_add" size={40} color="#666" />
                  )}
                  <Typography variant="subtitle2" sx={{ mt: 1 }}>
                    {t("archimatePicker.blank")}
                  </Typography>
                </CardContent>
              </CardActionArea>
            </Card>
          </Grid>
          {viewpoint.examples.map((ex) => (
            <Grid item xs={6} sm={4} key={ex.id}>
              <Card variant="outlined">
                <CardActionArea
                  disabled={!!pending || disabled}
                  onClick={() =>
                    handlePick(
                      ex.id,
                      getViewpointExampleXml(viewpoint.key, ex.id)
                        .then((e) => e.xml)
                        .catch(() => null),
                    )
                  }
                >
                  <CardContent sx={{ textAlign: "center", py: 3 }}>
                    {pending === ex.id ? (
                      <CircularProgress size={40} />
                    ) : (
                      <MaterialSymbol icon="description" size={40} color="#666" />
                    )}
                    <Typography variant="subtitle2" sx={{ mt: 1 }}>
                      {ex.name}
                    </Typography>
                  </CardContent>
                </CardActionArea>
              </Card>
            </Grid>
          ))}
        </Grid>
      )}
    </Box>
  );
}
