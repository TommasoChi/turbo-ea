/**
 * ArchimateModeler — the React shell around the ArchiMate engine (a diagram-js diagram).
 *
 * Loads `GET /diagrams/{id}` (Exchange XML 3.1 in `data.xml`), autosaves 3 s after the last change and
 * on the Save button, and keeps `card_ids` equal to the cards the diagram links to, as the DrawIO
 * editor does. Mirrors the DrawIO rule: the ONLY place a card is created is the create-card dialog's
 * submit; dropping or deleting a shape never creates or deletes a card.
 *
 * A failed save is never silent: the error stays on screen with a Retry, the diagram stays dirty and
 * the browser warns before the tab closes.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useTheme } from "@mui/material/styles";
import useMediaQuery from "@mui/material/useMediaQuery";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import CircularProgress from "@mui/material/CircularProgress";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogContentText from "@mui/material/DialogContentText";
import DialogTitle from "@mui/material/DialogTitle";
import Divider from "@mui/material/Divider";
import Snackbar from "@mui/material/Snackbar";
import Typography from "@mui/material/Typography";
import CardDetailSidePanel from "@/components/CardDetailSidePanel";
import MaterialSymbol from "@/components/MaterialSymbol";
import { DiagramCanvasToolbar, DiagramDisplayMenu, DiagramEditorHeader, DiagramGridTool, DiagramSyncButton, DiagramTool } from "@/components/DiagramEditorToolbar";
import ColorBySelector from "@/features/diagrams/ColorBySelector";
import { buildColorMap, colorKeyForCard, type ViewSource } from "@/features/diagrams/viewSource";
import { useMetamodel } from "@/hooks/useMetamodel";
import { useDiagramDotGrid } from "@/hooks/useDiagramDotGrid";
import { useFieldLabel, useOptionLabel, useTypeLabel } from "@/hooks/useResolveLabel";
import { useLatestRequest } from "@/hooks/useLatestRequest";
import { fetchCardsByIds } from "@/api/cardsByIds";
import { getViewpoint } from "@/api/archimateViewpoints";
import { api } from "@/api/client";
import type { Card } from "@/types";
import { archimateCanvasSx } from "./archimateStyles";
import { downloadText } from "./download";
import { ArchimateEngine, type UserProperty } from "./engine/ArchimateEngine";
import { ARCHIMATE_FORMAT, type ArchimateModel, linkedCardIds } from "./exchange/exchangeModel";
import {
  ExchangeParseError, MAX_EXCHANGE_BYTES, exchangeWarnings, readExchange, requireView,
} from "./exchange/readExchange";
import { writeExchange } from "./exchange/writeExchange";
import EnterpriseObjectPopover from "@/features/admin/metamodel/EnterpriseObjectPopover";
import ArchimatePropertiesPanel from "./ArchimatePropertiesPanel";
import CreateCardDialog from "./CreateCardDialog";
import LinkCardDialog from "./LinkCardDialog";
import ShortcutsDialog from "./ShortcutsDialog";
import ConnectorRoutingMenu from "@/components/ConnectorRoutingMenu";
import ValidationDialog, { type ValidationIssue } from "./ValidationDialog";
import { describeApiError } from "./saveError";
import { useUnsavedChangesGuard } from "@/hooks/useUnsavedChangesGuard";
import { useArchimateBridge } from "./useArchimateBridge";

import "diagram-js/assets/diagram-js.css";

const AUTOSAVE_MS = 3000;

export interface ArchimateModelerProps {
  diagramId: string;
  onBack?: () => void;
  /** Test seam (also used by the sandbox integration test): called once the engine exists. */
  onEngine?: (engine: ArchimateEngine) => void;
}

interface DiagramDoc {
  id: string;
  kind?: string;
  name: string;
  description?: string | null;
  data?: { format?: string; xml?: string } | null;
  /** `null` for every `archimate` diagram created before this feature: the palette filter
   *  (`viewpointObjectKeys` below) then stays unset, same as an unfiltered palette today. */
  viewpoint_key?: string | null;
}

type Load =
  | { status: "loading" }
  | { status: "ready"; model: ArchimateModel }
  | { status: "error"; kind: "load" | "notArchimate" | "import"; reason?: string };

/** Everything a file or a stored diagram can do wrong, as ExchangeParseError (or a plain Error). */
function parse(xml: string): { model: ArchimateModel; warnings: string[] } {
  const model = readExchange(xml);
  requireView(model);
  return { model, warnings: exchangeWarnings(xml) };
}

const fileName = (name: string) => name.replace(/[\\/:*?"<>|]+/g, "_").trim() || "diagram";

export default function ArchimateModeler({ diagramId, onBack, onEngine }: ArchimateModelerProps) {
  const { t } = useTranslation(["archimate", "common", "cards", "diagrams"]);
  const theme = useTheme();
  const { types } = useMetamodel();
  const typeLabel = useTypeLabel();
  const fieldLabel = useFieldLabel();
  const optionLabel = useOptionLabel();
  const [cardView, setCardView] = useState<ViewSource>({ kind: "card_type" });
  const [cards, setCards] = useState<Card[]>([]);
  const [showLinkedBadge, setShowLinkedBadge] = useState(true);
  const [showLinkedName, setShowLinkedName] = useState(false);
  const [showGrid, toggleGrid] = useDiagramDotGrid(`archimate.${diagramId}`);
  const [syncing, setSyncing] = useState(false);
  const { run: runInventory, cancel: cancelInventory } = useLatestRequest();
  const {
    bridge, enterpriseObjects, enterpriseObjectsLoaded,
    linkShapeId, createShapeId, objectInfo, objectInfoObject, closeDialogs, rememberCards,
  } = useArchimateBridge();

  const containerRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const engineRef = useRef<ArchimateEngine | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const unmountedRef = useRef(false);
  const savingRef = useRef(false);
  /** Bumped by every change: a save only clears `dirty` when nothing changed while it ran. */
  const changeSeqRef = useRef(0);
  /** Bumped when the diagram id changes: a save still in flight for the old diagram reports nothing. */
  const epochRef = useRef(0);

  const [load, setLoad] = useState<Load>({ status: "loading" });
  // The open diagram's viewpoint `objects` (Enterprise Object keys), for the palette filter --
  // fetched once per diagram load (not per palette render), gated the same way as
  // enterpriseObjectsLoaded below so the engine is only ever built once it is known.
  const [viewpointObjectKeys, setViewpointObjectKeys] = useState<string[] | null>(null);
  const [viewpointName, setViewpointName] = useState<string | null>(null);
  const [viewpointLoaded, setViewpointLoaded] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [name, setName] = useState("");
  /** The diagram's own description (the DB column, not the ArchiMate model's documentation): the
   *  panel's "Documentation" field when nothing is selected. */
  const [description, setDescription] = useState("");
  const [warnings, setWarnings] = useState<string[]>([]);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [history, setHistory] = useState({ undo: false, redo: false });
  const [snack, setSnack] = useState<string | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [pendingImport, setPendingImport] = useState<{ model: ArchimateModel; warnings: string[] } | null>(null);
  const [issues, setIssues] = useState<ValidationIssue[] | null>(null);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [routeMenu, setRouteMenu] = useState<{ id: string; left: number; top: number } | null>(null);
  // The card sheet drawer, opened from the panel's "Linked card" button.
  const [cardSheetId, setCardSheetId] = useState<string | null>(null);
  // The full card record behind the selected element's link, for the panel's readonly summary.
  const [linkedCard, setLinkedCard] = useState<Card | null>(null);
  const [linkedCardLoading, setLinkedCardLoading] = useState(false);
  // The properties panel: open by default on a wide screen; the toolbar button overrides that.
  const wide = useMediaQuery(theme.breakpoints.up("md"));
  const [panelPref, setPanelPref] = useState<boolean | null>(null);
  const panelOpen = panelPref ?? wide;
  /** Bumped by a selection change or an edit: the panel reads the engine again. */
  const [, setPanelTick] = useState(0);
  const refreshPanel = () => setPanelTick((n) => n + 1);
  const refreshPanelRef = useRef(refreshPanel);
  refreshPanelRef.current = refreshPanel;

  const reason = useCallback(
    (e: unknown) => describeApiError(e, t("common:errors.generic")),
    [t],
  );
  const parseFailure = useCallback(
    (e: unknown) =>
      e instanceof ExchangeParseError
        ? t(`archimate:errors.exchange.${e.code}`, { ref: e.ref ?? "" })
        : reason(e),
    [t, reason],
  );

  // ── Load ────────────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    // A new diagram starts clean: nothing dirty, no error, no pending timer, dialog or import.
    epochRef.current += 1;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
    setDirty(false);
    setSaving(false);
    savingRef.current = false; // a save still in flight for the old diagram must not block this one
    setSaveError(null);
    setHistory({ undo: false, redo: false });
    setImportError(null);
    setPendingImport(null);
    setIssues(null);
    setCardSheetId(null);
    cancelInventory();
    setCards([]);
    setSyncing(false);
    setLinkedCard(null);
    setLinkedCardLoading(false);
    closeDialogs();
    setLoad({ status: "loading" });
    setViewpointObjectKeys(null);
    setViewpointName(null);
    setViewpointLoaded(false);
    (async () => {
      let doc: DiagramDoc;
      try {
        doc = await api.get<DiagramDoc>(`/diagrams/${diagramId}`);
      } catch {
        if (!cancelled) setLoad({ status: "error", kind: "load" });
        return;
      }
      if (cancelled) return;
      if (doc.kind !== "archimate") {
        setLoad({ status: "error", kind: "notArchimate" });
        return;
      }
      try {
        const parsed = parse(doc.data?.xml ?? "");
        setName(doc.name);
        setDescription(doc.description ?? "");
        setWarnings(parsed.warnings);
        setLoad({ status: "ready", model: parsed.model });
      } catch (e) {
        setLoad({ status: "error", kind: "import", reason: parseFailure(e) });
      }
      if (!doc.viewpoint_key) {
        if (!cancelled) setViewpointLoaded(true);
        return;
      }
      try {
        const viewpoint = await getViewpoint(doc.viewpoint_key);
        if (!cancelled) {
          setViewpointObjectKeys(viewpoint.objects);
          setViewpointName(viewpoint.name);
        }
      } catch {
        // Fails open: an unfiltered palette, same as a diagram with no viewpoint_key -- the
        // viewpoint catalog not being reachable must never block the editor from opening.
        if (!cancelled) setViewpointObjectKeys(null);
      } finally {
        if (!cancelled) setViewpointLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
    // parseFailure and closeDialogs are stable per language/mount; neither must reload the diagram.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [diagramId, reloadKey]);

  // ── Save ────────────────────────────────────────────────────────────────
  const clearTimer = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
  };

  const saveRef = useRef<() => Promise<void>>(async () => undefined);
  const arm = () => {
    clearTimer();
    timerRef.current = setTimeout(() => void saveRef.current(), AUTOSAVE_MS);
  };

  const save = async () => {
    const engine = engineRef.current;
    if (!engine || savingRef.current) return;
    clearTimer();
    savingRef.current = true;
    setSaving(true);
    const seq = changeSeqRef.current;
    const epoch = epochRef.current;
    const current = () => !unmountedRef.current && epoch === epochRef.current;
    try {
      const model = engine.toModel();
      // A nice-to-have for the Diagrams gallery card, same field DrawIO's own
      // save flow populates (DiagramEditor.tsx) -- a failed export must never
      // block saving the diagram itself.
      let thumbnail: string | undefined;
      try {
        thumbnail = await engine.exportSvg();
      } catch {
        // Falls through with no thumbnail; the card just shows its placeholder icon.
        thumbnail = undefined;
      }
      await api.patch(`/diagrams/${diagramId}`, {
        data: {
          format: ARCHIMATE_FORMAT,
          xml: writeExchange(model),
          ...(thumbnail ? { thumbnail } : {}),
        },
        card_ids: linkedCardIds(model),
      });
      if (!current()) return;
      setSaveError(null);
      if (seq === changeSeqRef.current) setDirty(false);
    } catch (e) {
      // Stays dirty, and the error stays on screen until a save succeeds.
      if (current()) setSaveError(t("archimate:errors.saveFailed", { reason: reason(e) }));
    } finally {
      if (epoch === epochRef.current) savingRef.current = false;
      if (current()) {
        setSaving(false);
        // A change that landed while saving re-arms the chain.
        if (seq !== changeSeqRef.current) arm();
      }
    }
  };
  saveRef.current = save;

  const markChanged = () => {
    changeSeqRef.current += 1;
    setDirty(true);
    const engine = engineRef.current;
    if (engine) setHistory({ undo: engine.canUndo(), redo: engine.canRedo() });
    // While a save runs the timer is re-armed when it ends.
    if (!savingRef.current) arm();
    refreshPanel();
  };
  const markChangedRef = useRef(markChanged);
  markChangedRef.current = markChanged;

  // Leaving with unsaved (or failed-to-save) edits asks first: tab close, in-app navigation and Back.
  useUnsavedChangesGuard(dirty, t("cards:detail.unsavedLeaveConfirm"));

  // ── Engine ──────────────────────────────────────────────────────────────
  const onEngineRef = useRef(onEngine);
  onEngineRef.current = onEngine;
  const model = load.status === "ready" ? load.model : null;

  // Stable identity: a language switch must never rebuild the engine (that would drop the edits).
  const reasonRef = useRef(reason);
  reasonRef.current = reason;
  const refreshInventory = useCallback(
    (m: ArchimateModel, requested = false) => {
      if (requested) setSyncing(true);
      void runInventory(async ({ signal, isCurrent }) => {
        try {
          const result = await fetchCardsByIds(linkedCardIds(m), { signal });
          if (!isCurrent()) return;
          rememberCards(result);
          setCards(result);
          if (requested) {
            const selected = engineRef.current?.selectedItem();
            const selectedId = selected?.kind === "element" ? selected.cardId : null;
            if (selectedId) setLinkedCard(result.find(({ id }) => id === selectedId) ?? null);
            setSnack(t("archimate:toolbar.inventoryRefreshed"));
          }
        } catch (e) {
          if (isCurrent()) setSnack(reasonRef.current(e));
        } finally {
          if (isCurrent()) setSyncing(false);
        }
      });
    },
    [rememberCards, runInventory, t],
  );
  const refreshInventoryRef = useRef(refreshInventory);
  refreshInventoryRef.current = refreshInventory;
  const activeCardTypes = useMemo(() => [...new Set(cards.map(({ type }) => type).filter(Boolean))], [cards]);
  const cardAppearance = useMemo(() => {
    const palette = buildColorMap(cardView, types, { typeLabel, fieldLabel, optionLabel, t });
    return new Map(cards.map((card) => {
      const key = colorKeyForCard(cardView, card);
      return [card.id, { name: card.name, color: key ? palette.get(key)?.color : undefined }];
    }));
  }, [cardView, cards, types, typeLabel, fieldLabel, optionLabel, t]);

  useEffect(() => {
    const container = containerRef.current;
    // enterpriseObjectsLoaded gates this: unlike `bridge` (a stable object whose members read a
    // ref, so its identity never changes), `enterpriseObjects` is a plain array snapshot injected
    // into diagram-js as a one-time "value" -- it is not a live reference the engine re-reads
    // later. The registry fetch resolves asynchronously after mount, so building the engine before
    // it settles and then rebuilding once it does would discard any edit the user had already made
    // in that window (and the undo stack with it) under the user's feet. Waiting for the gate means
    // the engine is only ever built once per model, already with the final registry snapshot.
    if (!model || !container || !enterpriseObjectsLoaded || !viewpointLoaded) return;
    const engine = new ArchimateEngine({
      container, bridge, enterpriseObjects, viewpointObjectKeys,
      onChange: () => markChangedRef.current(),
      onSelect: () => refreshPanelRef.current(),
      onConnectionContextMenu: (id, anchor) => setRouteMenu({ id, ...anchor }),
    });
    engine.load(model);
    engineRef.current = engine;
    setHistory({ undo: false, redo: false });
    refreshInventoryRef.current(model);
    onEngineRef.current?.(engine);
    return () => {
      engine.destroy();
      if (engineRef.current === engine) engineRef.current = null;
    };
    // enterpriseObjects itself is still a dependency (it's read inside), but in practice it is
    // already stable by the time enterpriseObjectsLoaded flips true, so this effect now runs once.
  }, [model, bridge, enterpriseObjects, enterpriseObjectsLoaded, viewpointObjectKeys, viewpointLoaded]);

  useEffect(() => {
    engineRef.current?.setCardAppearance(cardAppearance, showLinkedBadge, showLinkedName);
  }, [model, enterpriseObjectsLoaded, viewpointLoaded, cardAppearance, showLinkedBadge, showLinkedName]);

  useEffect(() => {
    unmountedRef.current = false;
    return () => {
      unmountedRef.current = true;
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  // ── The selected element's linked card (the panel's readonly summary) ───
  const selected = model ? (engineRef.current?.selectedItem() ?? null) : null;
  const linkedCardId = selected?.kind === "element" ? selected.cardId : null;
  useEffect(() => {
    if (!linkedCardId) {
      setLinkedCard(null);
      setLinkedCardLoading(false);
      return;
    }
    let cancelled = false;
    setLinkedCard(null);
    setLinkedCardLoading(true);
    api
      .get<Card>(`/cards/${linkedCardId}`)
      .then((card) => {
        if (!cancelled) setLinkedCard(card);
      })
      .catch(() => {
        // The panel still shows the id/name it already has (from rememberCards).
      })
      .finally(() => {
        if (!cancelled) setLinkedCardLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [linkedCardId]);

  // ── Diagram-level fields (name, description, parameters) ────────────────
  const patchDiagram = async (body: { name?: string } | { description: string }) => {
    try {
      await api.patch(`/diagrams/${diagramId}`, body);
      if ("name" in body && body.name !== undefined) setName(body.name);
      if ("description" in body) setDescription(body.description);
    } catch (e) {
      setSnack(reason(e));
    }
  };
  const onDiagramName = (v: string) => {
    if (v.trim() && v !== name) void patchDiagram({ name: v });
  };
  const onDiagramDocumentation = (v: string) => {
    if (v !== description) void patchDiagram({ description: v });
  };
  const diagramProperties = engineRef.current?.modelProperties() ?? [];
  const onDiagramProperties = (props: UserProperty[]) => engineRef.current?.setModelProperties(props);

  // ── Toolbar actions ─────────────────────────────────────────────────────
  const validate = async () => {
    const engine = engineRef.current;
    if (!engine) return;
    try {
      const res = await api.post<{ valid: boolean; issues: ValidationIssue[] }>("/archimate/validate", {
        xml: writeExchange(engine.toModel()),
      });
      setIssues(res.issues ?? []);
    } catch (e) {
      setSnack(reason(e));
    }
  };

  const exportXml = () => {
    const engine = engineRef.current;
    if (engine) downloadText(`${fileName(name)}.xml`, writeExchange(engine.toModel()), "application/xml");
  };

  const exportSvg = async () => {
    const engine = engineRef.current;
    if (!engine) return;
    try {
      downloadText(`${fileName(name)}.svg`, await engine.exportSvg(), "image/svg+xml");
    } catch (e) {
      setSnack(reason(e));
    }
  };

  const onFileChosen = async (file: File | undefined) => {
    if (!file) return;
    setImportError(null);
    // Refuse before reading: file.text() would load a huge file into memory first.
    if (file.size > MAX_EXCHANGE_BYTES) {
      setImportError(t("archimate:errors.importFailed", { reason: t("archimate:errors.exchange.too_large", { ref: "" }) }));
      return;
    }
    try {
      setPendingImport(parse(await file.text()));
    } catch (e) {
      setImportError(t("archimate:errors.importFailed", { reason: parseFailure(e) }));
    }
  };

  const confirmImport = () => {
    const engine = engineRef.current;
    const next = pendingImport;
    setPendingImport(null);
    if (!engine || !next) return;
    engine.load(next.model);
    setWarnings(next.warnings);
    refreshInventory(next.model);
    markChanged();
  };

  // ── Dialog results ──────────────────────────────────────────────────────
  const shapeInfo = (shapeId: string | null) =>
    shapeId ? (engineRef.current?.elementInfo(shapeId) ?? null) : null;
  const linkInfo = shapeInfo(linkShapeId);
  // No card type maps to this element: CardPicker would offer ALL types, so offer nothing.
  const linkTypes = linkInfo ? bridge.cardTypesFor(linkInfo.type) : [];
  const createInfo = shapeInfo(createShapeId);

  const pickCard = (card: { id: string; name: string }) => {
    const engine = engineRef.current;
    if (engine && linkShapeId) {
      engine.setCardId(linkShapeId, card.id);
      if (!engine.elementInfo(linkShapeId)?.name) engine.setName(linkShapeId, card.name);
      rememberCards([card]);
    }
    closeDialogs();
  };

  const cardCreated = (card: { id: string; name: string }) => {
    if (createShapeId) engineRef.current?.setCardId(createShapeId, card.id);
    rememberCards([card]);
    closeDialogs();
  };

  // ── Render ──────────────────────────────────────────────────────────────
  if (load.status === "loading") {
    return (
      <Box sx={{ display: "flex", justifyContent: "center", p: 6 }}>
        <CircularProgress />
      </Box>
    );
  }
  if (load.status === "error") {
    return (
      <Box sx={{ p: 2 }}>
        <Alert
          severity="error"
          action={
            load.kind === "load" ? (
              <Button color="inherit" size="small" onClick={() => setReloadKey((k) => k + 1)}>
                {t("archimate:errors.retry")}
              </Button>
            ) : undefined
          }
        >
          {load.kind === "load"
            ? t("archimate:errors.loadFailed")
            : load.kind === "notArchimate"
              ? t("archimate:errors.notArchimate")
              : t("archimate:errors.importFailed", { reason: load.reason ?? "" })}
        </Alert>
      </Box>
    );
  }

  const status = saving
    ? t("archimate:status.saving")
    : dirty
      ? t("archimate:status.unsaved")
      : t("archimate:status.saved");
  const tool = (label: string, icon: string, onClick: () => void, disabled = false) => (
    <DiagramTool label={label} icon={icon} onClick={onClick} disabled={disabled} />
  );
  const divider = <Divider orientation="vertical" flexItem sx={{ mx: 0.5 }} />;

  return (
    <Box sx={{ display: "flex", flexDirection: "column", height: "calc(100vh - 64px - 48px)" }}>
      <DiagramEditorHeader title={name} onBack={onBack}>
        <ColorBySelector activeTypeKeys={activeCardTypes} types={types} current={cardView} onChange={setCardView} />
        <DiagramDisplayMenu label={t("common:cardDisplay.showOnCard")} icon="label" options={[
          { label: t("archimate:toolbar.linkedBadge"), checked: showLinkedBadge, onSelect: () => setShowLinkedBadge((v) => !v) },
          { label: t("archimate:toolbar.linkedName"), checked: showLinkedName, onSelect: () => setShowLinkedName((v) => !v) },
        ]} />
        <DiagramSyncButton disabled={syncing} onClick={() => {
          const current = engineRef.current;
          if (current) refreshInventory(current.toModel(), true);
        }} />
      </DiagramEditorHeader>
      <DiagramCanvasToolbar>
        <Button
          variant="contained"
          size="small"
          aria-label={t("archimate:toolbar.save")}
          onClick={() => void save()}
          disabled={saving}
          startIcon={<MaterialSymbol icon="save" />}
        >
          {t("archimate:toolbar.save")}
        </Button>
        <Typography variant="body2" color="text.secondary" sx={{ px: 1 }} role="status">
          {status}
        </Typography>
        {divider}
        {tool(t("archimate:toolbar.undo"), "undo", () => engineRef.current?.undo(), !history.undo)}
        {tool(t("archimate:toolbar.redo"), "redo", () => engineRef.current?.redo(), !history.redo)}
        {divider}
        {tool(t("archimate:toolbar.zoomIn"), "zoom_in", () => engineRef.current?.zoomBy(1))}
        {tool(t("archimate:toolbar.zoomOut"), "zoom_out", () => engineRef.current?.zoomBy(-1))}
        {tool(t("archimate:toolbar.fit"), "fit_screen", () => engineRef.current?.zoomFit())}
        {divider}
        {tool(t("archimate:toolbar.validate"), "rule", () => void validate())}
        {tool(t("archimate:toolbar.exportXml"), "download", exportXml)}
        {tool(t("archimate:toolbar.exportSvg"), "image", () => void exportSvg())}
        {tool(t("archimate:toolbar.importXml"), "upload", () => fileInputRef.current?.click())}
        <Box sx={{ flex: 1 }} />
        <DiagramGridTool enabled={showGrid} onToggle={toggleGrid} />
        {tool(t("archimate:toolbar.shortcuts"), "keyboard", () => setShortcutsOpen(true))}
        {tool(
          t("archimate:toolbar.togglePanel"),
          panelOpen ? "right_panel_close" : "right_panel_open",
          () => setPanelPref(!panelOpen),
        )}
        <input
          ref={fileInputRef}
          type="file"
          accept=".xml,.archimate-exchange"
          hidden
          data-testid="archimate-import-input"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            void onFileChosen(file);
          }}
        />
      </DiagramCanvasToolbar>

      {saveError && (
        <Alert
          severity="error"
          sx={{ borderRadius: 0 }}
          action={
            <Button color="inherit" size="small" onClick={() => void save()} disabled={saving}>
              {t("archimate:errors.retry")}
            </Button>
          }
        >
          {saveError}
        </Alert>
      )}
      {importError && (
        <Alert severity="error" sx={{ borderRadius: 0 }} onClose={() => setImportError(null)}>
          {importError}
        </Alert>
      )}
      {warnings.includes("organizations") && (
        <Alert severity="info" sx={{ borderRadius: 0 }} onClose={() => setWarnings([])}>
          {t("archimate:import.organizationsIgnored")}
        </Alert>
      )}

      <Box sx={{ flex: 1, minHeight: 0, display: "flex" }}>
        <Box ref={containerRef} sx={{ flex: 1, minWidth: 0, minHeight: 0, ...archimateCanvasSx(theme, showGrid) }} />
        {panelOpen && (
          <ArchimatePropertiesPanel
            info={selected}
            selectedCount={engineRef.current?.selection().length ?? 0}
            selectedIds={engineRef.current?.selection() ?? []}
            diagramName={name}
            diagramDescription={description}
            diagramProperties={diagramProperties}
            viewpointName={viewpointName}
            labels={bridge.labels}
            cardName={bridge.cardName}
            linkedCard={linkedCard}
            linkedCardLoading={linkedCardLoading}
            onName={(id, v) => engineRef.current?.setName(id, v)}
            onDocumentation={(id, v) => engineRef.current?.setDocumentation(id, v)}
            onProperties={(id, p) => engineRef.current?.setUserProperties(id, p)}
            onStyle={(ids, c) => engineRef.current?.setStyle(ids, c)}
            onDiagramName={onDiagramName}
            onDiagramDocumentation={onDiagramDocumentation}
            onDiagramProperties={onDiagramProperties}
            onOpenCardSheet={setCardSheetId}
          />
        )}
      </Box>

      <CardDetailSidePanel cardId={cardSheetId} open={!!cardSheetId} onClose={() => setCardSheetId(null)} />

      <Typography variant="caption" color="text.secondary" sx={{ px: 2, py: 0.5 }}>
        {t("archimate:trademark")}
      </Typography>

      {linkShapeId && linkTypes.length > 0 && (
        <LinkCardDialog
          open
          cardTypes={linkTypes}
          onPick={pickCard}
          onClose={closeDialogs}
        />
      )}
      {createShapeId && createInfo && (
        <CreateCardDialog
          key={createShapeId}
          open
          cardTypes={bridge.cardTypesFor(createInfo.type)}
          initialName={createInfo.name}
          onCreated={cardCreated}
          onClose={closeDialogs}
        />
      )}
      {objectInfo && objectInfoObject && (
        <EnterpriseObjectPopover
          object={objectInfoObject}
          anchorEl={objectInfo.anchorEl}
          onClose={closeDialogs}
          canEdit={false}
        />
      )}
      {issues && <ValidationDialog open issues={issues} onClose={() => setIssues(null)} />}
      <ShortcutsDialog open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
      <ConnectorRoutingMenu anchor={routeMenu}
        routing={routeMenu ? engineRef.current?.connectionRouting(routeMenu.id) : undefined}
        onSelect={(routing) => { if (routeMenu) engineRef.current?.setConnectionRouting(routeMenu.id, routing); }}
        onClose={() => setRouteMenu(null)} />

      <Dialog open={!!pendingImport} onClose={() => setPendingImport(null)}>
        <DialogTitle>{t("archimate:import.confirmTitle")}</DialogTitle>
        <DialogContent>
          <DialogContentText>{t("archimate:import.confirmBody")}</DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPendingImport(null)}>{t("common:actions.cancel")}</Button>
          <Button variant="contained" onClick={confirmImport}>
            {t("archimate:import.confirm")}
          </Button>
        </DialogActions>
      </Dialog>

      <Snackbar
        open={!!snack}
        autoHideDuration={4000}
        onClose={() => setSnack(null)}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
      >
        <Alert severity="error" variant="filled" onClose={() => setSnack(null)}>
          {snack}
        </Alert>
      </Snackbar>
    </Box>
  );
}
