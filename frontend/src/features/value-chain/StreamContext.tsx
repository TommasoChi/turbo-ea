import { createContext, useContext } from "react";
import type { StreamRelatedMode } from "@/types";
import type { ValueChainTypes } from "./useValueChainTypes";
import type { ColorScale, GateColorBy, PROCESS_COLOR_ATTRS, ProcessColorBy, StreamBandKey } from "./valueChainModel";

type ProcessAttr = (typeof PROCESS_COLOR_ATTRS)[number];

/** Page-wide Value Stream state shared by every band component of every root. */
export interface StreamContextValue {
  types: ValueChainTypes;
  bandOrder: StreamBandKey[];
  onMoveBand(key: StreamBandKey, direction: "up" | "down"): void;
  gateColorBy: GateColorBy;
  setGateColorBy(v: GateColorBy): void;
  processColorBy: ProcessColorBy;
  setProcessColorBy(v: ProcessColorBy): void;
  related: StreamRelatedMode;
  setRelated(v: StreamRelatedMode): void;
  objectiveScale: ColorScale;
  processScales: Record<ProcessAttr, ColorScale>;
  /** Localized metamodel field labels; an empty string means "use the translated fallback". */
  fieldLabels: { objectiveType: string; processAttrs: Record<ProcessAttr, string> };
  /** BusinessProcess subtype key -> display label (metamodel label over the translated default). */
  subtypeLabels: Record<string, string>;
  openCard(id: string): void;
  openProcess(id: string): void;
  openFlow(id: string): void;
}

export const StreamContext = createContext<StreamContextValue | null>(null);

export function useStreamContext(): StreamContextValue {
  const value = useContext(StreamContext);
  if (!value) throw new Error("useStreamContext must be used inside a StreamContext provider");
  return value;
}
