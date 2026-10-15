import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/hooks/useMetamodel", () => import("@/test/hooks").then((m) => m.useMetamodelModule()));

import i18n from "@/i18n";
import { CARD_TYPE_COLORS } from "@/theme/tokens";
import { hookState, withMetamodel } from "@/test/hooks";
import { makeCardType } from "@/test/fixtures/metamodel";
import { useValueChainTypes } from "./useValueChainTypes";

const t = i18n.getFixedT("en", "valuechain");

beforeEach(() => {
  hookState.reset();
});

describe("useValueChainTypes", () => {
  it("uses the metamodel colour, icon and label of a type that is present", () => {
    withMetamodel([
      makeCardType({ key: "BusinessProcess", label: "Process", color: "#123456", icon: "account_tree" }),
    ]);
    const { result } = renderHook(() => useValueChainTypes());
    expect(result.current.businessProcess).toEqual({
      key: "BusinessProcess",
      color: "#123456",
      icon: "account_tree",
      label: "Process",
    });
  });

  it("uses the localized type label when the type has a translation", async () => {
    withMetamodel([
      makeCardType({
        key: "Application",
        label: "Application",
        translations: { label: { it: "Applicazione IT" } },
      }),
    ]);
    const previous = i18n.language;
    await act(async () => {
      await i18n.changeLanguage("it");
    });
    try {
      const { result } = renderHook(() => useValueChainTypes());
      expect(result.current.application.label).toBe("Applicazione IT");
    } finally {
      await act(async () => {
        await i18n.changeLanguage(previous);
      });
    }
  });

  it("falls back to the token colour, a default icon and the translated label for an absent type", () => {
    withMetamodel([]);
    const { result } = renderHook(() => useValueChainTypes());
    const vc = result.current;
    expect(vc.businessContext).toEqual({
      key: "BusinessContext",
      color: CARD_TYPE_COLORS.BusinessContext,
      icon: "conveyor_belt",
      label: t("types.businessContext"),
    });
    expect(vc.businessContext.label).toBe("Value stream");
    expect(vc.objective.icon).toBe("flag");
    expect(vc.businessCapability.icon).toBe("hub");
    expect(vc.application.icon).toBe("apps");
    expect(vc.dataObject.icon).toBe("database");
    expect(vc.organization.icon).toBe("corporate_fare");
    expect(vc.businessProcess.icon).toBe("route");
    for (const [name, v] of Object.entries(vc)) {
      expect(v.color).toBe(CARD_TYPE_COLORS[v.key as keyof typeof CARD_TYPE_COLORS]);
      expect(v.label).toBe(t(`types.${name}`));
    }
    // Two-word keys must come out as the display label, not the CamelCase key.
    expect(vc.businessProcess.label).toBe("Business process");
    expect(vc.dataObject.label).toBe("Data object");
  });

  it("translates the fallback label into the active language, never the key", async () => {
    withMetamodel([]);
    const previous = i18n.language;
    await act(async () => {
      await i18n.changeLanguage("it");
    });
    try {
      const { result } = renderHook(() => useValueChainTypes());
      expect(result.current.organization.label).toBe("Organizzazione");
    } finally {
      await act(async () => {
        await i18n.changeLanguage(previous);
      });
    }
  });

  it("mixes present and absent types independently", () => {
    withMetamodel([makeCardType({ key: "Objective", label: "Goal", color: "#abcdef", icon: "target" })]);
    const { result } = renderHook(() => useValueChainTypes());
    expect(result.current.objective.label).toBe("Goal");
    expect(result.current.dataObject.label).toBe("Data object");
    expect(result.current.dataObject.color).toBe(CARD_TYPE_COLORS.DataObject);
  });
});
