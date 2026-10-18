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
const listEnterpriseObjectsMock = vi.hoisted(() => vi.fn());
vi.mock("@/api/enterpriseObjects", () => ({
  listEnterpriseObjects: listEnterpriseObjectsMock,
}));

const wrapper = ({ children }: { children: ReactNode }) => (
  <MemoryRouter>{children}</MemoryRouter>
);

describe("useArchimateBridge", () => {
  beforeEach(() => {
    listEnterpriseObjectsMock.mockReset();
    listEnterpriseObjectsMock.mockResolvedValue(TYPES.objects);
  });

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
    expect(labels.tools.hand).toBe("Hand tool");
    expect(labels.tools.lasso).toBe("Lasso selection");
    expect(labels.tools.objectInfo("Business Actor")).toBe("View details: Business Actor");
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

  it("a failed mapping fetch logs the error and leaves cardTypesFor offering nothing, instead of an unhandled rejection", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    listEnterpriseObjectsMock.mockReset();
    listEnterpriseObjectsMock.mockRejectedValue(new Error("network down"));
    const { result } = renderHook(() => useArchimateBridge(), { wrapper });
    await waitFor(() => expect(consoleError).toHaveBeenCalled());
    expect(result.current.bridge.cardTypesFor("ApplicationComponent")).toEqual([]);
    consoleError.mockRestore();
  });

  it("fetches the registry with includeHidden -- a hidden standard type's row must reach the engine, or ArchimatePaletteProvider's is_hidden check never sees it and the type stays shown", async () => {
    renderHook(() => useArchimateBridge(), { wrapper });
    await waitFor(() => expect(listEnterpriseObjectsMock).toHaveBeenCalledWith(true));
  });

  it("enterpriseObjectsLoaded starts false and flips true once the fetch resolves", async () => {
    const { result } = renderHook(() => useArchimateBridge(), { wrapper });
    expect(result.current.enterpriseObjectsLoaded).toBe(false);
    await waitFor(() => expect(result.current.enterpriseObjectsLoaded).toBe(true));
    expect(result.current.enterpriseObjects).toEqual(TYPES.objects);
  });

  it("enterpriseObjectsLoaded still flips true on a failed fetch -- fails open so a down registry never blocks the page from building the engine", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    listEnterpriseObjectsMock.mockReset();
    listEnterpriseObjectsMock.mockRejectedValue(new Error("network down"));
    const { result } = renderHook(() => useArchimateBridge(), { wrapper });
    expect(result.current.enterpriseObjectsLoaded).toBe(false);
    await waitFor(() => expect(result.current.enterpriseObjectsLoaded).toBe(true));
    expect(result.current.enterpriseObjects).toEqual([]);
    consoleError.mockRestore();
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

  it("opens the object-info popover through the bridge, resolving the object by key, and closeDialogs clears it", async () => {
    const { result } = renderHook(() => useArchimateBridge(), { wrapper });
    await waitFor(() => expect(listEnterpriseObjectsMock).toHaveBeenCalled());
    const anchorEl = document.createElement("div");

    expect(result.current.objectInfo).toBeNull();
    act(() => result.current.bridge.openObjectInfo("obj1", anchorEl));
    expect(result.current.objectInfo).toEqual({ key: "obj1", anchorEl });
    await waitFor(() => expect(result.current.objectInfoObject).toBe(TYPES.objects[0]));

    act(() => result.current.closeDialogs());
    expect(result.current.objectInfo).toBeNull();
  });

  it("resolves no object for a key the registry hasn't loaded (yet, or at all)", () => {
    const { result } = renderHook(() => useArchimateBridge(), { wrapper });
    act(() => result.current.bridge.openObjectInfo("NoSuchKey", document.createElement("div")));
    expect(result.current.objectInfoObject).toBeUndefined();
  });

  it("exposes the full Enterprise Object registry for the engine (empty until the fetch resolves)", async () => {
    const { result } = renderHook(() => useArchimateBridge(), { wrapper });
    expect(result.current.enterpriseObjects).toEqual([]);
    await waitFor(() => expect(result.current.enterpriseObjects).toEqual(TYPES.objects));
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
