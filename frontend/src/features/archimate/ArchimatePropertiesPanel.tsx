/**
 * The panel on the right of the ArchiMate editor.
 *
 * - An element, a relationship or a note selected: its name/text, documentation, properties and (an
 *   element only) the card it is linked to. A linked element shows the card's own name, description
 *   and parameters instead (readonly — the card is the source of truth) and a button opens the card's
 *   full sheet. A note has no documentation, properties or card: just its text.
 * - Nothing selected: the diagram itself — a View placeholder (for a future per-ontology view), then
 *   its name, documentation and parameters, editable the same way.
 * - Several items selected: just the count.
 *
 * Text is committed when a field loses focus (or Enter is pressed in a one-line one), so typing is
 * one undoable change, not one per key.
 */
import { useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Collapse from "@mui/material/Collapse";
import IconButton from "@mui/material/IconButton";
import LinearProgress from "@mui/material/LinearProgress";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import ApprovalStatusBadge from "@/components/ApprovalStatusBadge";
import LifecycleBadge from "@/components/LifecycleBadge";
import MaterialSymbol from "@/components/MaterialSymbol";
import { DataQualityPill, FieldValue } from "@/features/cards/sections";
import { useCardSubtypeLabel } from "@/hooks/useCardSubtypeLabel";
import { useMetamodel } from "@/hooks/useMetamodel";
import { useFieldLabel, useTypeLabel } from "@/hooks/useResolveLabel";
import { ARCHIMATE_LAYER_COLORS, ARCHIMATE_TEXT_COLOR } from "@/theme/tokens";
import type { Card, FieldDef } from "@/types";
import type { Rgb } from "./exchange/exchangeModel";
import type { ItemInfo, UserProperty } from "./engine/ArchimateEngine";
import type { EditorLabels } from "./engine/EditorBridge";
import { isElementType, layerOf } from "./taxonomy/elements";
import { isRelationshipType } from "./taxonomy/relationships";

const channel = (n: number) => Math.max(0, Math.min(255, Math.round(n)));
const toHex = (c: Rgb | null): string =>
  `#${[c?.r ?? 255, c?.g ?? 255, c?.b ?? 255].map((n) => channel(n).toString(16).padStart(2, "0")).join("")}`;
const fromHex = (hex: string): Rgb => ({
  r: parseInt(hex.slice(1, 3), 16), g: parseInt(hex.slice(3, 5), 16), b: parseInt(hex.slice(5, 7), 16),
});

/** A native color swatch (no picker library) plus a reset-to-default button. */
function FillColorControl({
  ids, value, onStyle, label, resetLabel,
}: { ids: string[]; value: Rgb | null; onStyle: (ids: string[], fillColor: Rgb | null) => void; label: string; resetLabel: string }) {
  return (
    <Stack direction="row" spacing={1} alignItems="center" sx={{ mt: 1 }}>
      <Typography variant="body2" sx={{ flex: 1 }}>
        {label}
      </Typography>
      <Box
        component="input"
        type="color"
        aria-label={label}
        value={toHex(value)}
        onChange={(e: React.ChangeEvent<HTMLInputElement>) => onStyle(ids, fromHex(e.target.value))}
        sx={{ width: 32, height: 28, p: 0, border: "none", borderRadius: 1, cursor: "pointer" }}
      />
      <IconButton size="small" aria-label={resetLabel} onClick={() => onStyle(ids, null)}>
        <MaterialSymbol icon="format_color_reset" size={18} />
      </IconButton>
    </Stack>
  );
}

export interface ArchimatePropertiesPanelProps {
  /** The single selected item; null for no selection or several. */
  info: ItemInfo | null;
  selectedCount: number;
  /** Every selected shape id, for the fill color control in a multi-selection. */
  selectedIds: string[];
  diagramName: string;
  diagramDescription: string;
  diagramProperties: UserProperty[];
  /** The open diagram's viewpoint, resolved by the caller; null/undefined shows the generic label. */
  viewpointName?: string | null;
  labels: EditorLabels;
  cardName: (cardId: string) => string | undefined;
  /** The full record of `info.cardId`, once fetched; null while loading or when nothing is linked. */
  linkedCard: Card | null;
  linkedCardLoading: boolean;
  onName: (id: string, name: string) => void;
  onDocumentation: (id: string, text: string) => void;
  onProperties: (id: string, properties: UserProperty[]) => void;
  /** `null` clears the override, falling back to the layer's default fill. */
  onStyle: (ids: string[], fillColor: Rgb | null) => void;
  onDiagramName: (name: string) => void;
  onDiagramDocumentation: (text: string) => void;
  onDiagramProperties: (properties: UserProperty[]) => void;
  onOpenCardSheet: (cardId: string) => void;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(true);
  return (
    <Box sx={{ borderBottom: 1, borderColor: "divider" }}>
      <Stack direction="row" alignItems="center" sx={{ pl: 2, pr: 1, py: 0.5 }}>
        <Typography variant="subtitle2" sx={{ flex: 1 }}>
          {title}
        </Typography>
        <IconButton size="small" aria-expanded={open} aria-label={title} onClick={() => setOpen((o) => !o)}>
          <MaterialSymbol icon={open ? "expand_less" : "expand_more"} size={20} />
        </IconButton>
      </Stack>
      <Collapse in={open}>
        <Box sx={{ px: 2, pb: 1.5 }}>{children}</Box>
      </Collapse>
    </Box>
  );
}

/**
 * One-line or multi-line text, committed on blur (and on Enter when it is one line). The stored
 * `value` replaces the draft when it changes (an undo, a card name), never because of our own commit.
 */
function CommittedField({
  label, value, multiline, onCommit,
}: { label: string; value: string; multiline?: boolean; onCommit: (value: string) => void }) {
  const [draft, setDraft] = useState(value);
  const seen = useRef(value);
  if (value !== seen.current) {
    seen.current = value;
    if (value !== draft) setDraft(value);
  }
  return (
    <TextField
      label={label}
      size="small"
      fullWidth
      multiline={multiline}
      minRows={multiline ? 3 : undefined}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => onCommit(draft)}
      onKeyDown={(e) => {
        if (!multiline && e.key === "Enter") (e.target as HTMLInputElement).blur();
      }}
      sx={{ mt: 1 }}
    />
  );
}

/** What the engine stores for these rows: trimmed names, blank ones dropped, a repeated name keeps its last value. */
function stored(rows: UserProperty[]): UserProperty[] {
  const byName = new Map<string, string>();
  for (const { name, value } of rows) if (name.trim()) byName.set(name.trim(), value);
  return [...byName].map(([name, value]) => ({ name, value }));
}

function PropertyRows({ properties, onChange }: { properties: UserProperty[]; onChange: (p: UserProperty[]) => void }) {
  const { t } = useTranslation("archimate");
  const [rows, setRows] = useState<UserProperty[]>(properties);
  // The stored list replaces the rows when it changes under us (an undo), never because of our own commit
  // (that would drop the focus and the half-typed row being edited).
  const seen = useRef(JSON.stringify(properties));
  const incoming = JSON.stringify(properties);
  if (incoming !== seen.current) {
    seen.current = incoming;
    if (incoming !== JSON.stringify(stored(rows))) setRows(properties);
  }
  const edit = (i: number, patch: Partial<UserProperty>) =>
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const commit = (next: UserProperty[]) => onChange(next);
  return (
    <>
      {rows.length === 0 && (
        <Typography variant="body2" color="text.secondary">
          {t("panel.noProperties")}
        </Typography>
      )}
      {rows.map((row, i) => (
        <Stack key={i} direction="row" spacing={0.5} alignItems="center" sx={{ mt: 1 }}>
          <TextField
            size="small"
            label={t("panel.propertyName")}
            value={row.name}
            onChange={(e) => edit(i, { name: e.target.value })}
            onBlur={() => commit(rows)}
            sx={{ flex: 1, minWidth: 0 }}
          />
          <TextField
            size="small"
            label={t("panel.propertyValue")}
            value={row.value}
            onChange={(e) => edit(i, { value: e.target.value })}
            onBlur={() => commit(rows)}
            sx={{ flex: 1, minWidth: 0 }}
          />
          <IconButton
            size="small"
            aria-label={t("panel.removeProperty")}
            onClick={() => {
              const next = rows.filter((_, j) => j !== i);
              setRows(next);
              commit(next);
            }}
          >
            <MaterialSymbol icon="delete" size={18} />
          </IconButton>
        </Stack>
      ))}
      <IconButton
        size="small"
        aria-label={t("panel.addProperty")}
        onClick={() => setRows((rs) => [...rs, { name: "", value: "" }])}
        sx={{ mt: 1 }}
      >
        <MaterialSymbol icon="add" size={20} />
      </IconButton>
    </>
  );
}

/**
 * The element is linked to a card: the card is now the source of truth, so its own name,
 * description and parameters show here, readonly. "Open the card" shows the full sheet.
 */
function LinkedCardSummary({ card, openLabel, onOpen }: { card: Card; openLabel: string; onOpen: () => void }) {
  const { getType } = useMetamodel();
  const typeLabel = useTypeLabel();
  const subtypeLabel = useCardSubtypeLabel();
  const fieldLabel = useFieldLabel();
  const typeConfig = getType(card.type);
  const subtype = subtypeLabel(card.type, card.subtype);

  const fieldsByKey = useMemo(() => {
    const map = new Map<string, FieldDef>();
    for (const section of typeConfig?.fields_schema ?? []) for (const field of section.fields) map.set(field.key, field);
    return map;
  }, [typeConfig]);
  const attributeEntries = Object.entries(card.attributes ?? {}).filter(
    ([, v]) => v !== undefined && v !== null && v !== "",
  );

  return (
    <Box sx={{ mt: 1 }}>
      <Button
        fullWidth
        variant="outlined"
        size="small"
        onClick={onOpen}
        aria-label={`${openLabel}: ${card.name}`}
        startIcon={<MaterialSymbol icon="open_in_new" size={18} />}
        sx={{ justifyContent: "flex-start", textTransform: "none" }}
      >
        {openLabel}: {card.name}
      </Button>
      <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap sx={{ mt: 1 }}>
        {typeConfig && <Chip size="small" variant="outlined" label={typeLabel(typeConfig)} />}
        {subtype && <Chip size="small" variant="outlined" label={subtype} />}
      </Stack>
      <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap alignItems="center" sx={{ mt: 1 }}>
        <LifecycleBadge lifecycle={card.lifecycle} />
        <ApprovalStatusBadge status={card.approval_status} size="small" />
        <DataQualityPill value={card.data_quality} />
      </Stack>
      {card.description && (
        <Typography variant="body2" sx={{ mt: 1.5, whiteSpace: "pre-wrap" }}>
          {card.description}
        </Typography>
      )}
      {attributeEntries.length > 0 && (
        <Box sx={{ mt: 1.5 }}>
          {attributeEntries.map(([key, value]) => {
            const field = fieldsByKey.get(key) ?? { key, label: key, type: "text" };
            return (
              <Stack
                key={key} direction="row" justifyContent="space-between" alignItems="baseline" spacing={1}
                sx={{ mt: 0.5 }}
              >
                <Typography variant="caption" color="text.secondary" sx={{ flexShrink: 0 }}>
                  {fieldLabel(field)}
                </Typography>
                <Box sx={{ textAlign: "right", minWidth: 0 }}>
                  <FieldValue field={field} value={value} />
                </Box>
              </Stack>
            );
          })}
        </Box>
      )}
    </Box>
  );
}

/** A static placeholder row: the current view, no behaviour yet (a future per-ontology feature). */
function ViewRow({ label }: { label: string }) {
  return (
    <Stack direction="row" alignItems="center" spacing={1} sx={{ px: 2, py: 1, borderBottom: 1, borderColor: "divider" }}>
      <MaterialSymbol icon="schema" size={18} />
      <Typography variant="body2">{label}</Typography>
    </Stack>
  );
}

export default function ArchimatePropertiesPanel({
  info, selectedCount, selectedIds, diagramName, diagramDescription, diagramProperties, viewpointName, labels,
  cardName, linkedCard, linkedCardLoading, onName, onDocumentation, onProperties, onStyle, onDiagramName,
  onDiagramDocumentation, onDiagramProperties, onOpenCardSheet,
}: ArchimatePropertiesPanelProps) {
  const { t } = useTranslation("archimate");

  let heading = diagramName;
  let chip: React.ReactNode = null;
  if (info) {
    heading =
      info.name ||
      (info.kind === "note"
        ? labels.note
        : isElementType(info.type)
          ? labels.elements[info.type]
          : isRelationshipType(info.type)
            ? labels.relationships[info.type]
            : "");
    if (isElementType(info.type)) {
      const colors = ARCHIMATE_LAYER_COLORS[layerOf(info.type)];
      chip = (
        <Chip
          size="small"
          label={`${labels.layers[layerOf(info.type)]} · ${labels.elements[info.type]}`}
          sx={{ bgcolor: colors.fill, color: ARCHIMATE_TEXT_COLOR, border: `1px solid ${colors.stroke}`, maxWidth: "100%" }}
        />
      );
    } else if (isRelationshipType(info.type)) {
      chip = <Chip size="small" variant="outlined" label={labels.relationships[info.type]} sx={{ maxWidth: "100%" }} />;
    }
  } else if (selectedCount > 1) {
    heading = t("panel.multiple", { count: selectedCount });
  }

  // Another item starts from its own stored values.
  const itemKey = info?.id ?? "none";
  const linked = info?.kind === "element" && info.cardId ? info.cardId : null;

  return (
    <Box
      component="aside"
      aria-label={t("panel.title")}
      sx={{ width: 300, flexShrink: 0, borderLeft: 1, borderColor: "divider", bgcolor: "background.paper", overflowY: "auto" }}
    >
      <Box sx={{ px: 2, py: 1.5, borderBottom: 1, borderColor: "divider" }}>
        <Typography variant="h6" sx={{ fontSize: 16, wordBreak: "break-word" }}>
          {heading}
        </Typography>
        {chip && <Box sx={{ mt: 0.5 }}>{chip}</Box>}
        {info?.kind === "element" && (
          <FillColorControl
            ids={[info.id]} value={info.fillColor ?? null} onStyle={onStyle}
            label={t("panel.fillColor")} resetLabel={t("panel.resetColor")}
          />
        )}
        {!info && selectedCount > 1 && (
          <FillColorControl
            ids={selectedIds} value={null} onStyle={onStyle}
            label={t("panel.fillColor")} resetLabel={t("panel.resetColor")}
          />
        )}
      </Box>

      {info ? (
        info.kind === "note" ? (
          <Section title={t("panel.main")}>
            <Box key={itemKey}>
              <CommittedField label={t("panel.text")} value={info.name} multiline onCommit={(v) => onName(info.id, v)} />
            </Box>
          </Section>
        ) : (
          <>
            <Section title={t("panel.main")}>
              {linked ? (
                linkedCard ? (
                  <LinkedCardSummary card={linkedCard} openLabel={labels.openCard} onOpen={() => onOpenCardSheet(linked)} />
                ) : (
                  <Box sx={{ mt: 1 }}>
                    {linkedCardLoading && <LinearProgress sx={{ mb: 1 }} />}
                    <Typography variant="body2" color="text.secondary">
                      {t("panel.linkedCard")}: {cardName(linked) ?? linked}
                    </Typography>
                  </Box>
                )
              ) : (
                <>
                  <Box key={itemKey}>
                    <CommittedField label={t("panel.name")} value={info.name} onCommit={(v) => onName(info.id, v)} />
                    <CommittedField
                      label={t("panel.documentation")}
                      value={info.documentation}
                      multiline
                      onCommit={(v) => onDocumentation(info.id, v)}
                    />
                  </Box>
                  {info.kind === "element" && (
                    <Typography variant="body2" color="text.secondary" sx={{ mt: 1.5 }}>
                      {t("panel.linkedCard")}: {labels.unlinked}
                    </Typography>
                  )}
                </>
              )}
            </Section>
            <Section title={t("panel.properties")}>
              <Box key={itemKey}>
                <PropertyRows properties={info.properties} onChange={(p) => onProperties(info.id, p)} />
              </Box>
            </Section>
          </>
        )
      ) : selectedCount > 1 ? (
        <Typography variant="body2" color="text.secondary" sx={{ p: 2 }}>
          {t("panel.multipleHint")}
        </Typography>
      ) : (
        <>
          <ViewRow label={viewpointName ?? t("panel.view")} />
          <Section title={t("panel.main")}>
            <Box>
              <CommittedField label={t("panel.name")} value={diagramName} onCommit={onDiagramName} />
              <CommittedField
                label={t("panel.documentation")} value={diagramDescription} multiline onCommit={onDiagramDocumentation}
              />
            </Box>
          </Section>
          <Section title={t("panel.properties")}>
            <PropertyRows properties={diagramProperties} onChange={onDiagramProperties} />
          </Section>
        </>
      )}
    </Box>
  );
}
