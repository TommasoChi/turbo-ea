import { categoricalColor } from "@/lib/color";
import { STATUS_COLORS } from "@/theme/tokens";
import type { CardType, FieldDef, FieldOption, ValueChainBand, ValueChainBandKey } from "@/types";

export const DEFAULT_CHAIN_ROW_ORDER: ValueChainBandKey[] = ["management", "core", "support"];

/** Bands in the BPM Process House row order, `not_set` always last. */
export function orderBands(bands: ValueChainBand[], rowOrder: string[]): ValueChainBand[] {
  const byKey = new Map<string, ValueChainBand>(bands.map((b) => [b.key, b]));
  const out: ValueChainBand[] = [];
  const seen = new Set<string>();
  const take = (key: string) => {
    const band = byKey.get(key);
    if (band && key !== "not_set" && !seen.has(key)) {
      out.push(band);
      seen.add(key);
    }
  };
  rowOrder.forEach(take);
  bands.forEach((b) => take(b.key));
  const notSet = byKey.get("not_set");
  if (notSet) out.push(notSet);
  return out;
}

export function moveKey<T extends string>(order: readonly T[], key: T, direction: "up" | "down"): T[] {
  const idx = order.indexOf(key);
  const swap = direction === "up" ? idx - 1 : idx + 1;
  if (idx < 0 || swap < 0 || swap >= order.length) return [...order];
  const next = [...order];
  [next[idx], next[swap]] = [next[swap], next[idx]];
  return next;
}

export const STREAM_BAND_KEYS = ["gate", "vs", "process", "cap"] as const;
export type StreamBandKey = (typeof STREAM_BAND_KEYS)[number];
export const STREAM_BAND_ORDER_STORAGE_KEY = "turboea.valuechain.streamBandOrder";

function browserStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function readStreamBandOrder(
  storage: Pick<Storage, "getItem"> | null = browserStorage(),
): StreamBandKey[] {
  try {
    const saved: unknown = JSON.parse(storage?.getItem(STREAM_BAND_ORDER_STORAGE_KEY) ?? "null");
    if (
      Array.isArray(saved) &&
      saved.length === STREAM_BAND_KEYS.length &&
      STREAM_BAND_KEYS.every((k) => saved.includes(k))
    ) {
      return saved as StreamBandKey[];
    }
  } catch {
    /* malformed or blocked storage: fall through to the default */
  }
  return [...STREAM_BAND_KEYS];
}

export function writeStreamBandOrder(
  order: StreamBandKey[],
  storage: Pick<Storage, "setItem"> | null = browserStorage(),
): void {
  try {
    storage?.setItem(STREAM_BAND_ORDER_STORAGE_KEY, JSON.stringify(order));
  } catch {
    /* storage unavailable: the order still holds for this session */
  }
}

/** A field definition by key, searched across every section of the type. */
export function fieldOf(type: CardType | undefined, fieldKey: string): FieldDef | undefined {
  for (const section of type?.fields_schema ?? []) {
    const field = section.fields.find((f) => f.key === fieldKey);
    if (field) return field;
  }
  return undefined;
}

export function fieldOptionsOf(type: CardType | undefined, fieldKey: string): FieldOption[] {
  return fieldOf(type, fieldKey)?.options ?? [];
}

export interface ColorScale {
  colorOf(value: string | null | undefined): string;
  entries: { key: string; option: FieldOption; color: string }[];
}

/** Colour per option key: the option's own colour, else a categorical one by position. */
export function buildColorScale(options: FieldOption[]): ColorScale {
  const entries = options.map((option, i) => ({
    key: option.key,
    option,
    color: option.color || categoricalColor(i),
  }));
  const byKey = new Map(entries.map((e) => [e.key, e.color]));
  return {
    entries,
    colorOf: (value) => (value ? (byKey.get(value) ?? STATUS_COLORS.neutral) : STATUS_COLORS.neutral),
  };
}

export type GateColorBy = "none" | "objectiveType";
export const PROCESS_COLOR_ATTRS = ["processType", "maturity", "automationLevel", "riskLevel"] as const;
export type ProcessColorBy = "none" | (typeof PROCESS_COLOR_ATTRS)[number];
