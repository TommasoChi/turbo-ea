/**
 * The EditorBridge the page hands to the engine: labels from i18n, the card types an element can link
 * to (from the metamodel mapping), and the dialog / navigation hooks. The engine captures the bridge
 * once, so it is ONE stable object whose members read the latest values through refs.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";
import { listEnterpriseObjects } from "@/api/enterpriseObjects";
import { useMetamodel } from "@/hooks/useMetamodel";
import { useTypeLabel } from "@/hooks/useResolveLabel";
import type { EnterpriseObjectCardMapping } from "@/types";
import { elementLabel } from "./engine/elementLabel";
import type { CardTypeOption, EditorBridge, EditorLabels } from "./engine/EditorBridge";
import { elementTypesForCardType } from "./mapping/resolveMapping";
import { ELEMENT_TYPES, LAYER_ORDER } from "./taxonomy/elements";
import { ACCESS_TYPES, RELATIONSHIP_TYPES } from "./taxonomy/relationships";

export interface ArchimateBridgeState {
  bridge: EditorBridge;
  /** The shape whose link picker is open, if any. */
  linkShapeId: string | null;
  /** The shape whose create-card dialog is open, if any. */
  createShapeId: string | null;
  closeDialogs: () => void;
  /** Remembers card names for `bridge.cardName` (the linked cards found at load, newly picked ones). */
  rememberCards: (cards: { id: string; name: string }[]) => void;
}

export function useArchimateBridge(): ArchimateBridgeState {
  const { t } = useTranslation("archimate");
  const navigate = useNavigate();
  const { types } = useMetamodel();
  const typeLabel = useTypeLabel();
  const [linkShapeId, setLinkShapeId] = useState<string | null>(null);
  const [createShapeId, setCreateShapeId] = useState<string | null>(null);
  const [mappings, setMappings] = useState<EnterpriseObjectCardMapping[]>([]);
  const names = useRef(new Map<string, string>());

  useEffect(() => {
    let cancelled = false;
    listEnterpriseObjects()
      .then((objects) => {
        if (!cancelled) setMappings(objects.flatMap((o) => o.card_mappings));
      })
      .catch((err: unknown) => {
        // Non-critical: "Link to card"/"Create a card" just offers no candidates for this
        // mount (mappings stays []) instead of crashing with an unhandled rejection.
        if (!cancelled) console.error("Failed to load enterprise object mappings:", err);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const labels: EditorLabels = {
    elements: Object.fromEntries(ELEMENT_TYPES.map((e) => [e, elementLabel(e)])) as EditorLabels["elements"],
    relationships: Object.fromEntries(
      RELATIONSHIP_TYPES.map((r) => [r, t(`relationships.${r}`)]),
    ) as EditorLabels["relationships"],
    access: Object.fromEntries(ACCESS_TYPES.map((a) => [a, t(`access.${a}`)])) as EditorLabels["access"],
    layers: Object.fromEntries(LAYER_ORDER.map((l) => [l, t(`layers.${l}`)])) as EditorLabels["layers"],
    linkCard: t("context.linkCard"),
    createCard: t("context.createCard"),
    openCard: t("context.openCard"),
    unlinkCard: t("context.unlinkCard"),
    delete: t("context.delete"),
    connect: (relationship) => t("context.connect", { relationship }),
    unlinked: t("context.unlinked"),
    directed: t("context.directed"),
    tools: { hand: t("tools.hand"), lasso: t("tools.lasso") },
    note: t("note.label"),
  };

  // Everything the bridge reads, refreshed on every render.
  const latest = useRef({ labels, types, typeLabel, navigate, mappings });
  latest.current = { labels, types, typeLabel, navigate, mappings };

  const bridge = useMemo<EditorBridge>(
    () => ({
      get labels() {
        return latest.current.labels;
      },
      cardTypesFor(type): CardTypeOption[] {
        const { types: all, typeLabel: label, mappings: m } = latest.current;
        return all
          .filter((ct) => elementTypesForCardType(ct.key, m).includes(type))
          .map((ct) => ({ key: ct.key, label: label(ct) }));
      },
      openLinkPicker: setLinkShapeId,
      openCreateCard: setCreateShapeId,
      openCard: (cardId) => latest.current.navigate(`/cards/${cardId}`),
      cardName: (cardId) => names.current.get(cardId),
    }),
    [],
  );

  const closeDialogs = useCallback(() => {
    setLinkShapeId(null);
    setCreateShapeId(null);
  }, []);
  const rememberCards = useCallback((cards: { id: string; name: string }[]) => {
    for (const c of cards) names.current.set(c.id, c.name);
  }, []);

  return { bridge, linkShapeId, createShapeId, closeDialogs, rememberCards };
}
