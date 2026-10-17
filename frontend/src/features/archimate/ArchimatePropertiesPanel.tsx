/**
 * The panel on the right of the ArchiMate editor: what is selected (an element or a relationship),
 * its name and documentation, its properties and the card it is linked to. With nothing selected it
 * shows the diagram.
 *
 * Text is committed when a field loses focus (or Enter is pressed in a one-line one), so typing is
 * one undoable change, not one per key.
 */
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import Box from "@mui/material/Box";
import Chip from "@mui/material/Chip";
import Collapse from "@mui/material/Collapse";
import IconButton from "@mui/material/IconButton";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import MaterialSymbol from "@/components/MaterialSymbol";
import { ARCHIMATE_LAYER_COLORS, ARCHIMATE_TEXT_COLOR } from "@/theme/tokens";
import type { ItemInfo, UserProperty } from "./engine/ArchimateEngine";
import type { EditorLabels } from "./engine/EditorBridge";
import { isElementType, layerOf } from "./taxonomy/elements";
import { isRelationshipType } from "./taxonomy/relationships";

export interface ArchimatePropertiesPanelProps {
  /** The single selected item; null for no selection or several. */
  info: ItemInfo | null;
  selectedCount: number;
  diagramName: string;
  labels: EditorLabels;
  cardName: (cardId: string) => string | undefined;
  onName: (id: string, name: string) => void;
  onDocumentation: (id: string, text: string) => void;
  onProperties: (id: string, properties: UserProperty[]) => void;
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

export default function ArchimatePropertiesPanel({
  info, selectedCount, diagramName, labels, cardName, onName, onDocumentation, onProperties,
}: ArchimatePropertiesPanelProps) {
  const { t } = useTranslation("archimate");

  let heading = diagramName;
  let chip: React.ReactNode = null;
  if (info) {
    heading = info.name || (isElementType(info.type) ? labels.elements[info.type] : isRelationshipType(info.type) ? labels.relationships[info.type] : "");
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
      </Box>

      {info ? (
        <>
          <Section title={t("panel.main")}>
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
                {t("panel.linkedCard")}:{" "}
                {info.cardId ? (cardName(info.cardId) ?? info.cardId) : labels.unlinked}
              </Typography>
            )}
          </Section>
          <Section title={t("panel.properties")}>
            <Box key={itemKey}>
              <PropertyRows properties={info.properties} onChange={(p) => onProperties(info.id, p)} />
            </Box>
          </Section>
        </>
      ) : (
        <Typography variant="body2" color="text.secondary" sx={{ p: 2 }}>
          {selectedCount > 1 ? t("panel.multipleHint") : t("panel.nothingSelected")}
        </Typography>
      )}
    </Box>
  );
}
