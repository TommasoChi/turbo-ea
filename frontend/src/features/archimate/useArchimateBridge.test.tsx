import type { ReactNode } from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router";
import type { CardType, EnterpriseObject } from "@/types";
import { ELEMENT_TYPES, LAYER_ORDER } from "./taxonomy/elements";
import { RELATIONSHIP_TYPES } from "./taxonomy/relationships";
import { useArchimateBridge } from "./useArchimateBridge";

const TYPES = vi.hoisted(() => ({
  list: [
    { key: "Application", label: "Application", subtypes: [] },
    { key: "Interface", label: "Interface", subtypes: [{ key: "api", label: "API" }] },
    { key: "ITComponent", label: "IT Component", subtypes: [] },
    { key: "Unmapped", label: "Unmapped", subtypes: [] },
  ] as unknown as CardType[],
  objects: [
    {
      key: "obj1", card_mappings: [
        { id: "1", enterprise_object_key: "ApplicationComponent", card_type_key: "Application", card_subtype_key: null },
        { id: "2", enterprise_object_key: "ApplicationComponent", card_type_key: "Interface", card_subtype_key: "api" },
        { id: "3", enterprise_object_key: "Node", card_type_key: "ITComponent", card_subtype_key: null },
      ],
    },
  ] as unknown as EnterpriseObject[],
}));
vi.mock("@/hooks/useMetamodel", () => ({ useMetamodel: () => ({ types: TYPES.list }) }));
vi.mock("@/api/enterpriseObjects", () => ({
  listEnterpriseObjects: () => Promise.resolve(TYPES.objects),
}));

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

  it("offers the card types whose mapping (type or subtype) resolves to the element type", async () => {
    const { result } = renderHook(() => useArchimateBridge(), { wrapper });
    await waitFor(() =>
      expect(result.current.bridge.cardTypesFor("ApplicationComponent")).toEqual([
        { key: "Application", label: "Application" },
        { key: "Interface", label: "Interface" },
      ]),
    );
    expect(result.current.bridge.cardTypesFor("Node")).toEqual([{ key: "ITComponent", label: "IT Component" }]);
    expect(result.current.bridge.cardTypesFor("Goal")).toEqual([]);
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
