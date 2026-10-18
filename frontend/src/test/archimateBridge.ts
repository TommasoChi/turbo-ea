/**
 * A fake EditorBridge for engine tests: every label is `"L:" + key` (so a test can tell a bridge
 * label from elementLabel) and every function is a spy, so "no card was touched" is assertable.
 * The engine's palette needs a bridge to build its entries, so every diagram built from
 * ARCHIMATE_MODULES in a test gets one through `withBridge`.
 */
import type { ModuleDeclaration } from "didi";
import { vi } from "vitest";
import type { EditorBridge, EditorLabels } from "@/features/archimate/engine/EditorBridge";
import { ELEMENT_TYPES, LAYER_ORDER } from "@/features/archimate/taxonomy/elements";
import { ACCESS_TYPES, RELATIONSHIP_TYPES } from "@/features/archimate/taxonomy/relationships";
import { ARCHIMATE_MODULES } from "@/features/archimate/engine/modules";

const labelled = <K extends string>(keys: readonly K[]) =>
  Object.fromEntries(keys.map((k) => [k, `L:${k}`])) as Record<K, string>;

export function makeBridge(): EditorBridge {
  const labels: EditorLabels = {
    elements: labelled(ELEMENT_TYPES),
    relationships: labelled(RELATIONSHIP_TYPES),
    access: labelled(ACCESS_TYPES),
    layers: labelled(LAYER_ORDER),
    linkCard: "L:linkCard", createCard: "L:createCard", openCard: "L:openCard", unlinkCard: "L:unlinkCard",
    delete: "L:delete", connect: (relationship) => `L:connect ${relationship}`, unlinked: "L:unlinked",
    directed: "L:directed", tools: { hand: "L:hand", lasso: "L:lasso" }, note: "L:note",
  };
  return {
    labels,
    cardTypesFor: vi.fn(() => []),
    openLinkPicker: vi.fn(),
    openCreateCard: vi.fn(),
    openCard: vi.fn(),
    cardName: vi.fn(),
    openObjectInfo: vi.fn(),
  };
}

/** The engine's modules plus the bridge value, as `ArchimateEngine` assembles them. */
export function withBridge(bridge: EditorBridge = makeBridge()): ModuleDeclaration[] {
  return [...ARCHIMATE_MODULES, { bridge: ["value", bridge] }];
}
