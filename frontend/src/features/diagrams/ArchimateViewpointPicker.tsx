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
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import Autocomplete from "@mui/material/Autocomplete";
import Box from "@mui/material/Box";
import Card from "@mui/material/Card";
import CardActionArea from "@mui/material/CardActionArea";
import CardContent from "@mui/material/CardContent";
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
import type { ArchimateViewpointForPicker, Card as EaCard } from "@/types";

interface Props {
  /** `null` is the unscoped `Diagrams` entry point — every Viewpoint, no layer filter. */
  tab: ViewpointTab | null;
  onSelect: (
    viewpointKey: string,
    startingXml: string | null,
    suggestedCardIds: string[],
    viewpointName: string,
  ) => void;
  /** Disables the whole grid — e.g. while the caller's own create call (kicked
   *  off from a previous `onSelect`) is still in flight. */
  disabled?: boolean;
}

export default function ArchimateViewpointPicker({ tab, onSelect, disabled }: Props) {
  const { t } = useTranslation(["diagrams", "common"]);
  const [viewpoints, setViewpoints] = useState<ArchimateViewpointForPicker[]>([]);
  const [viewpoint, setViewpoint] = useState<ArchimateViewpointForPicker | null>(null);
  // Key of the card currently being turned into a diagram ("blank" or an example id) —
  // disables the rest of the grid and shows a spinner on that one card while its
  // (possibly fetched) starting XML and suggested cards are resolved.
  const [pending, setPending] = useState<string | null>(null);

  // Optional: a card type (from the ones suggested for this viewpoint) and a
  // specific card of that type -- when set, whichever starter card the user
  // then picks (blank or an example) gets that card materialized as a real
  // node, not just linked as metadata.
  const [cardTypeOptions, setCardTypeOptions] = useState<SuggestedCardType[]>([]);
  const [cardType, setCardType] = useState<SuggestedCardType | null>(null);
  const [cardOptions, setCardOptions] = useState<EaCard[]>([]);
  const [card, setCard] = useState<EaCard | null>(null);

  useEffect(() => {
    setViewpoint(null);
    listViewpointsForTab(tab)
      .then(setViewpoints)
      .catch(() => setViewpoints([]));
  }, [tab]);

  useEffect(() => {
    setCardType(null);
    setCard(null);
    setCardOptions([]);
    if (!viewpoint) {
      setCardTypeOptions([]);
      return;
    }
    getSuggestedCards(viewpoint.key, tab)
      .then(setCardTypeOptions)
      .catch(() => setCardTypeOptions([]));
  }, [viewpoint, tab]);

  const searchCards = async (search: string) => {
    if (!cardType) return;
    try {
      const res = await api.get<{ items: EaCard[] }>(
        `/cards?type=${encodeURIComponent(cardType.card_type_key)}&search=${encodeURIComponent(search)}&page_size=20`,
      );
      setCardOptions(res.items);
    } catch {
      /* card search is optional -- silent fall-through */
    }
  };

  const handlePick = async (cardKey: string, startingXml: Promise<string | null>) => {
    if (!viewpoint || pending) return;
    setPending(cardKey);
    try {
      let xml = await startingXml;
      if (xml !== null && card && cardType?.enterprise_object_key) {
        xml = writeExchange(
          addCardNode(readExchange(xml), cardType.enterprise_object_key as ElementType, card.name, card.id),
        );
      }
      const suggestedCardIds = cardTypeOptions.map((o) => o.card_type_key);
      onSelect(viewpoint.key, xml, suggestedCardIds, viewpoint.name);
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
        <Grid container spacing={2} sx={{ mt: 2 }}>
          <Grid item xs={6}>
            <Autocomplete
              options={cardTypeOptions}
              getOptionLabel={(o) => o.card_type_key}
              isOptionEqualToValue={(a, b) => a.card_type_key === b.card_type_key}
              value={cardType}
              disabled={!!pending || disabled}
              onChange={(_, v) => {
                setCardType(v);
                setCard(null);
                setCardOptions([]);
              }}
              renderInput={(params) => (
                <TextField {...params} label={t("archimatePicker.cardType")} />
              )}
            />
          </Grid>
          <Grid item xs={6}>
            <Autocomplete
              options={cardOptions}
              getOptionLabel={(c) => c.name}
              isOptionEqualToValue={(a, b) => a.id === b.id}
              value={card}
              disabled={!cardType || !!pending || disabled}
              onChange={(_, v) => setCard(v)}
              onInputChange={(_, v) => searchCards(v)}
              renderInput={(params) => (
                <TextField {...params} label={t("archimatePicker.card")} />
              )}
            />
          </Grid>
        </Grid>
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
