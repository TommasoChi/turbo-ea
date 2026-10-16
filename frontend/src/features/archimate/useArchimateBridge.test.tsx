import type { ReactNode } from "react";
import { act, renderHook } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router";
import type { CardType } from "@/types";
import { ELEMENT_TYPES, LAYER_ORDER } from "./taxonomy/elements";
import { RELATIONSHIP_TYPES } from "./taxonomy/relationships";
import { useArchimateBridge } from "./useArchimateBridge";

const TYPES = vi.hoisted(() => ({
  list: [
    { key: "Application", label: "Application", archimate_type: "ApplicationComponent", subtypes: [] },
    {
      key: "Interface", label: "Interface", archimate_type: "ApplicationInterface",
      subtypes: [{ key: "api", label: "API", archimate_type: "ApplicationComponent" }],
    },
    { key: "ITComponent", label: "IT Component", archimate_type: "Node", subtypes: [] },
    { key: "Unmapped", label: "Unmapped", archimate_type: null, subtypes: [] },
  ] as unknown as CardType[],
}));
vi.mock("@/hooks/useMetamodel", () => ({ useMetamodel: () => ({ types: TYPES.list }) }));

const wrapper = ({ children }: { children: ReactNode }) => (
  <MemoryRouter>{children}</MemoryRouter>
);

describe("useArchimateBridge", () => {
  it("builds every label from i18n and elementLabel", () => {
    const { bridge } = renderHook(() => useArchimateBridge(), { wrapper }).result.current;
    const { labels } = bridge;
    expect(Object.keys(labels.elements)).toEqual([...ELEMENT_TYPES]);
    expect(labels.elements.BusinessActor).toBe("Business Actor");
    expect(Object.keys(labels.relationships)).toEqual([...RELATIONSHIP_TYPES]);
    expect(labels.relationships.Serving).toBe("Serving");
    expect(labels.access.ReadWrite).toBe("Read/Write");
    expect(Object.keys(labels.layers)).toEqual(LAYER_ORDER);
    expect(labels.layers.implementation).toBe("Implementation & Migration");
    expect(labels.connect("Flow")).toBe("Draw Flow");
    expect(labels.tools).toEqual({ hand: "Hand tool", lasso: "Lasso selection" });
    expect(labels).toMatchObject({
      linkCard: "Link to a card", createCard: "Create a card", openCard: "Open the linked card",
      unlinkCard: "Unlink the card", delete: "Remove from the diagram", unlinked: "Not linked to a card",
      directed: "Directed association",
    });
  });

  it("offers the card types whose mapping (type or subtype) resolves to the element type", () => {
    const { bridge } = renderHook(() => useArchimateBridge(), { wrapper }).result.current;
    expect(bridge.cardTypesFor("ApplicationComponent")).toEqual([
      { key: "Application", label: "Application" },
      { key: "Interface", label: "Interface" },
    ]);
    expect(bridge.cardTypesFor("Node")).toEqual([{ key: "ITComponent", label: "IT Component" }]);
    expect(bridge.cardTypesFor("Goal")).toEqual([]);
  });

  it("keeps ONE bridge object across renders", () => {
    const { result, rerender } = renderHook(() => useArchimateBridge(), { wrapper });
    const first = result.current.bridge;
    rerender();
    expect(result.current.bridge).toBe(first);
  });

  it("opens and closes the two dialogs through the bridge", () => {
    const { result } = renderHook(() => useArchimateBridge(), { wrapper });
    expect([result.current.linkShapeId, result.current.createShapeId]).toEqual([null, null]);
    act(() => result.current.bridge.openLinkPicker("s1"));
    expect(result.current.linkShapeId).toBe("s1");
    act(() => result.current.bridge.openCreateCard("s2"));
    expect(result.current.createShapeId).toBe("s2");
    act(() => result.current.closeDialogs());
    expect([result.current.linkShapeId, result.current.createShapeId]).toEqual([null, null]);
  });

  it("remembers card names and navigates to a card", () => {
    const { result } = renderHook(() => ({ h: useArchimateBridge(), where: useLocation() }), { wrapper });
    expect(result.current.h.bridge.cardName("c1")).toBeUndefined();
    act(() => result.current.h.rememberCards([{ id: "c1", name: "CRM" }]));
    expect(result.current.h.bridge.cardName("c1")).toBe("CRM");
    act(() => result.current.h.bridge.openCard("c1"));
    expect(result.current.where.pathname).toBe("/cards/c1");
  });
});
