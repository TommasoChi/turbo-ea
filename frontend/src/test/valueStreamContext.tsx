/**
 * Test helper for the Value Stream band components: a complete, hook-free
 * `StreamContextValue` (fixed fake card types, fixture colour scales, `vi.fn()`
 * handlers) and `renderWithStream(ui, overrides)` that mounts `ui` under it; plus
 * `focusVisibleOutline(el)` for the Value Chain focus-ring tests.
 * Hex literals are allowed here (test-only file). Lives under `src/test/` so it stays out
 * of the mutation and coverage scopes.
 */
import type { ReactElement } from "react";
import { vi } from "vitest";

import { StreamContext, type StreamContextValue } from "@/features/value-chain/StreamContext";
import type { ValueChainTypes } from "@/features/value-chain/useValueChainTypes";
import { buildColorScale, STREAM_BAND_KEYS } from "@/features/value-chain/valueChainModel";
import { renderWithProviders } from "@/test/render";

const vcType = (key: string, color: string, icon: string, label: string) => ({ key, color, icon, label });

export const TEST_TYPES: ValueChainTypes = {
  businessProcess: vcType("BusinessProcess", "#2e7d32", "route", "Business process"),
  businessContext: vcType("BusinessContext", "#fff59d", "conveyor_belt", "Value stream"),
  objective: vcType("Objective", "#0d47a1", "flag", "Objective"),
  businessCapability: vcType("BusinessCapability", "#6a1b9a", "hub", "Business capability"),
  application: vcType("Application", "#01579b", "apps", "Application"),
  dataObject: vcType("DataObject", "#ff8f00", "database", "Data object"),
  organization: vcType("Organization", "#4e342e", "corporate_fare", "Organization"),
};

export function makeStreamContext(overrides: Partial<StreamContextValue> = {}): StreamContextValue {
  return {
    types: TEST_TYPES,
    bandOrder: [...STREAM_BAND_KEYS],
    onMoveBand: vi.fn(),
    gateColorBy: "none",
    setGateColorBy: vi.fn(),
    processColorBy: "processType",
    setProcessColorBy: vi.fn(),
    related: "none",
    setRelated: vi.fn(),
    objectiveScale: buildColorScale([
      { key: "strategic", label: "Strategic", color: "#c2185b" },
      { key: "tactical", label: "Tactical", color: "#7b1fa2" },
    ]),
    processScales: {
      processType: buildColorScale([
        { key: "management", label: "Management", color: "#00796b" },
        { key: "core", label: "Core", color: "#1976d2" },
        { key: "support", label: "Support", color: "#8e24aa" },
      ]),
      maturity: buildColorScale([]),
      automationLevel: buildColorScale([]),
      riskLevel: buildColorScale([]),
    },
    fieldLabels: {
      objectiveType: "Objective kind",
      processAttrs: { processType: "Process kind", maturity: "", automationLevel: "", riskLevel: "" },
    },
    // The page's translated defaults (en).
    subtypeLabels: { category: "Process category", group: "Process group", process: "Process", variant: "Process variant" },
    openCard: vi.fn(),
    openProcess: vi.fn(),
    openFlow: vi.fn(),
    ...overrides,
  };
}

/**
 * The outline of the element's own `:focus-visible` stylesheet rule (emotion `css-*` class),
 * or `null` when it has none: jsdom never matches `:focus-visible`, so the rule is read directly.
 */
export function focusVisibleOutline(el: Element) {
  const classes = Array.from(el.classList).filter((c) => c.startsWith("css-"));
  const rule = Array.from(document.styleSheets)
    .flatMap((sheet) => Array.from(sheet.cssRules))
    .filter((r): r is CSSStyleRule => "selectorText" in r)
    .filter((r) => classes.some((c) => r.selectorText.includes(`.${c}:focus-visible`)))
    .at(-1);
  if (!rule) return null;
  const v = (p: string) => rule.style.getPropertyValue(p);
  return { outline: v("outline"), outlineColor: v("outline-color"), outlineOffset: v("outline-offset") };
}

/** `focusVisibleOutline` of `FOCUS_RING_ON_FILL` / `FOCUS_RING_INSET`. */
export const RING_ON_FILL = { outline: "2px solid", outlineColor: "currentColor", outlineOffset: "-2px" };
export const RING_INSET = { ...RING_ON_FILL, outlineOffset: "-4px" };
/** `FOCUS_RING` under MUI's default theme (`primary.main`), which `renderWithProviders` uses. */
export const RING_PAPER = { ...RING_ON_FILL, outlineColor: "#1976d2" };

export function renderWithStream(ui: ReactElement, overrides: Partial<StreamContextValue> = {}) {
  const ctx = makeStreamContext(overrides);
  return { ...renderWithProviders(<StreamContext.Provider value={ctx}>{ui}</StreamContext.Provider>), ctx };
}
