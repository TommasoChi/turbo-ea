import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { setViewportWidth } from "@/test/matchMedia";
import { useLocation, useNavigate, type NavigateFunction } from "react-router";
import { ApiError } from "@/api/client";
import i18n from "@/i18n";
import { mockApi } from "@/test/apiMock";
import { MODEL } from "@/test/archimateModel";
import { renderWithProviders, wrapWithProviders } from "@/test/render";
import { itSourceScan } from "@/test/sourceScan";
import { installSvgStubs } from "@/test/svgStubs";
import type { CardType } from "@/types";
import ArchimateModeler from "./ArchimateModeler";
import { downloadText } from "./download";
import type { ArchimateEngine } from "./engine/ArchimateEngine";
import { ARCHIMATE_FORMAT, getCardId, type ArchimateModel } from "./exchange/exchangeModel";
import { MAX_EXCHANGE_BYTES, readExchange } from "./exchange/readExchange";
import { writeExchange } from "./exchange/writeExchange";

vi.mock("@/api/client", () => import("@/test/apiMock").then((m) => m.apiClientModule()));
vi.mock("./download", () => ({ downloadText: vi.fn() }));
const CARD_TYPES: CardType[] = [
  { key: "Application", label: "Application", archimate_type: "ApplicationComponent", subtypes: [], fields_schema: [] },
  { key: "ITComponent", label: "IT Component", archimate_type: "Node", subtypes: [], fields_schema: [] },
] as unknown as CardType[];
vi.mock("@/hooks/useMetamodel", () => ({
  useMetamodel: () => ({
    types: CARD_TYPES,
    getType: (key: string) => CARD_TYPES.find((t) => t.key === key),
  }),
}));
vi.mock("@/components/CardPicker", () => ({
  default: (p: { types: string[]; onChange: (c: unknown) => void }) => (
    <button onClick={() => p.onChange({ id: "c5", name: "Billing", type: p.types[0] })}>
      pick:{p.types.join(",")}
    </button>
  ),
}));
vi.mock("@/components/CardDetailSidePanel", () => ({
  default: (p: { cardId: string | null; open: boolean; onClose: () => void }) =>
    p.open ? (
      <div role="dialog" aria-label={`card sheet: ${p.cardId}`}>
        <button onClick={p.onClose}>close card sheet</button>
      </div>
    ) : null,
}));

beforeAll(() => {
  installSvgStubs();
  // jsdom's File has no text() (every supported browser does).
  if (!File.prototype.text) {
    File.prototype.text = function (this: File) {
      return new Promise<string>((ok, fail) => {
        const r = new FileReader();
        r.onload = () => ok(String(r.result));
        r.onerror = () => fail(r.error);
        r.readAsText(this);
      });
    };
  }
});

const UNLINKED: ArchimateModel = structuredClone(MODEL);
UNLINKED.elements[0].properties = [];
UNLINKED.propertyDefinitions = [];
const APP_SHAPE = "id-n1";

const doc = (model: ArchimateModel | string = UNLINKED, over: Record<string, unknown> = {}) => ({
  id: "d1",
  kind: "archimate",
  name: "A",
  data: { format: ARCHIMATE_FORMAT, xml: typeof model === "string" ? model : writeExchange(model) },
  card_ids: [],
  ...over,
});

interface Handle {
  engine: ArchimateEngine;
  bridge: {
    openLinkPicker(id: string): void;
    openCreateCard(id: string): void;
    openObjectInfo(key: string, anchorEl: HTMLElement): void;
  };
}
let handle: Handle | null = null;
const engine = () => handle!.engine;
const services = <T,>(name: string) => (engine() as unknown as { diagram: { get(n: string): T } }).diagram.get(name);

/** Exposes the router (navigate + current path) to the tests. */
let nav: { navigate: NavigateFunction; path: string };
function NavProbe() {
  nav = { navigate: useNavigate(), path: useLocation().pathname };
  return null;
}

const tree = (diagramId = "d1", props: Partial<React.ComponentProps<typeof ArchimateModeler>> = {}) => (
  <>
    <NavProbe />
    <ArchimateModeler
      diagramId={diagramId}
      onEngine={(e) => {
        handle = {
          engine: e,
          bridge: (e as unknown as { diagram: { get(n: string): Handle["bridge"] } }).diagram.get("bridge"),
        };
      }}
      {...props}
    />
  </>
);

async function mount(d: unknown = doc(), props: Partial<React.ComponentProps<typeof ArchimateModeler>> = {}) {
  mockApi.on("get", "/diagrams/d1", d);
  const view = renderWithProviders(tree("d1", props), { theme: true });
  await waitFor(() => expect(handle).not.toBeNull());
  return view;
}

const lastPatchBody = () => mockApi.callsOf("patch").at(-1)!.body as { data: { format: string; xml: string }; card_ids: string[] };

async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

beforeEach(() => {
  mockApi.reset();
  mockApi.on("patch", "/diagrams/d1", {});
  mockApi.on("get", "/cards?ids=*", { items: [{ id: "c1", name: "CRM" }] });
  // useArchimateBridge fetches the Enterprise Object registry to resolve card<->element
  // mappings. Mirrors CARD_TYPES above: Application <-> ApplicationComponent, ITComponent <-> Node.
  mockApi.on("get", "/metamodel/enterprise-objects?include_hidden=true", [
    {
      key: "ApplicationComponent",
      name: "Application Component",
      description: "A modular, deployable part of software.",
      icon: "deployed_code",
      color: "#99c7ef",
      card_mappings: [
        { id: "m1", enterprise_object_key: "ApplicationComponent", card_type_key: "Application", card_subtype_key: null },
      ],
    },
    {
      key: "Node",
      name: "Node",
      description: "A computational or physical resource.",
      icon: "dns",
      color: "#ffcc80",
      card_mappings: [
        { id: "m2", enterprise_object_key: "Node", card_type_key: "ITComponent", card_subtype_key: null },
      ],
    },
  ]);
  handle = null;
  vi.mocked(downloadText).mockClear();
});
afterEach(() => vi.useRealTimers());

describe("loading", () => {
  it("shows the not-ArchiMate alert and no editor for another kind of diagram", async () => {
    mockApi.on("get", "/diagrams/d1", doc(UNLINKED, { kind: "drawio" }));
    const { container } = renderWithProviders(<ArchimateModeler diagramId="d1" />);
    expect(await screen.findByText("This is not an ArchiMate diagram.")).toBeInTheDocument();
    expect(container.querySelector(".djs-container")).toBeNull();
  });

  it("shows the translated import error with the ref, never a blank canvas", async () => {
    const xml = writeExchange(UNLINKED).replace("</model>", "<elements/></model>").replace('identifier="id-app"', 'identifier="id-node"');
    mockApi.on("get", "/diagrams/d1", doc(xml));
    const { container } = renderWithProviders(<ArchimateModeler diagramId="d1" />);
    expect(
      await screen.findByText("The file could not be imported: The identifier “id-node” is used twice."),
    ).toBeInTheDocument();
    expect(container.querySelector(".djs-container")).toBeNull();
  });

  it("explains a DOCTYPE in the stored xml", async () => {
    mockApi.on("get", "/diagrams/d1", doc('<!DOCTYPE x [<!ENTITY a "b">]><model/>'));
    renderWithProviders(<ArchimateModeler diagramId="d1" />);
    expect(
      await screen.findByText(
        "The file could not be imported: The file contains a DOCTYPE or entity declaration, which is not allowed.",
      ),
    ).toBeInTheDocument();
  });

  it("shows loadFailed with a Retry that loads the diagram", async () => {
    mockApi.fail("get", "/diagrams/d1", 500, "boom");
    renderWithProviders(<ArchimateModeler diagramId="d1" />);
    expect(await screen.findByText("The diagram could not be loaded.")).toBeInTheDocument();
    mockApi.on("get", "/diagrams/d1", doc());
    const { default: userEvent } = await import("@testing-library/user-event");
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(document.querySelector(".djs-container")).not.toBeNull());
    expect(screen.queryByText("The diagram could not be loaded.")).toBeNull();
  });

  it("warns that organizations are not kept", async () => {
    const xml = writeExchange(UNLINKED).replace("</model>", "<organizations><label xml:lang=\"en\">F</label></organizations></model>");
    await mount(doc(xml));
    expect(screen.getByText("The file contains folders (organizations); they are not kept.")).toBeInTheDocument();
  });

  it("does not warn when there are no organizations, and shows the trademark", async () => {
    await mount();
    expect(screen.queryByText(/organizations/)).toBeNull();
    expect(screen.getByText(/ArchiMate® is a registered trademark of The Open Group/)).toBeInTheDocument();
  });

  it("resolves the names of the linked cards for the bridge", async () => {
    await mount(doc(MODEL));
    await waitFor(() => expect(mockApi.callsOf("get", "/cards?ids=*")).toHaveLength(1));
    expect(mockApi.callsOf("get", "/cards?ids=*")[0].path).toBe("/cards?ids=c1");
  });

  it("fetches the diagram's viewpoint to filter the palette", async () => {
    mockApi.on("get", "/metamodel/viewpoints/organization", {
      key: "organization",
      name: "Organization",
      icon: "account_tree",
      description: null,
      layer: "business",
      is_standard: true,
      is_hidden: false,
      sort_order: 1,
      objects: ["ApplicationComponent"],
      examples: [],
    });
    await mount(doc(UNLINKED, { viewpoint_key: "organization" }));
    await waitFor(() =>
      expect(mockApi.callsOf("get", "/metamodel/viewpoints/organization")).toHaveLength(1),
    );
  });

  it("fails open to an unfiltered palette when the viewpoint can't be fetched", async () => {
    mockApi.fail("get", "/metamodel/viewpoints/organization", 500, "boom");
    const { container } = await mount(doc(UNLINKED, { viewpoint_key: "organization" }));
    await waitFor(() =>
      expect(mockApi.callsOf("get", "/metamodel/viewpoints/organization")).toHaveLength(1),
    );
    expect(container.querySelector(".djs-container")).not.toBeNull();
  });

  it("does not build the engine (no canvas, no onEngine) until the Enterprise Object registry settles, and builds it exactly once -- regression: a registry that arrived AFTER the engine was already built used to force a silent rebuild that discarded any edit made in that window", async () => {
    let release!: (objects: unknown[]) => void;
    mockApi.on("get", "/metamodel/enterprise-objects?include_hidden=true", () => new Promise((r) => (release = r)));
    let builds = 0;
    mockApi.on("get", "/diagrams/d1", doc());
    renderWithProviders(<ArchimateModeler diagramId="d1" onEngine={() => { builds += 1; }} />, { theme: true });
    // The diagram model itself has had plenty of time to load; the registry has not.
    await new Promise((r) => setTimeout(r, 30));
    expect(document.querySelector(".djs-container")).toBeNull();
    expect(builds).toBe(0);
    await act(async () => {
      release([]);
      await Promise.resolve();
    });
    await waitFor(() => expect(document.querySelector(".djs-container")).not.toBeNull());
    expect(builds).toBe(1);
    // Give any stray microtask a chance to run, then confirm no second build followed.
    await new Promise((r) => setTimeout(r, 30));
    expect(builds).toBe(1);
  });
});

describe("card names", () => {
  it("tells the user when the linked cards' names could not be loaded", async () => {
    mockApi.fail("get", "/cards?ids=*", 500, "names down");
    await mount(doc(MODEL));
    expect(await screen.findByText("names down")).toBeInTheDocument();
  });
});

describe("autosave", () => {
  it("saves 3 s after a change with exactly the documented body, then shows Saved (API round trip)", async () => {
    await mount();
    expect(screen.getByRole("status")).toHaveTextContent("Saved");
    vi.useFakeTimers();
    act(() => engine().setCardId(APP_SHAPE, "c1"));
    expect(screen.getByRole("status")).toHaveTextContent("Unsaved changes");
    await advance(2999);
    expect(mockApi.callsOf("patch")).toHaveLength(0);
    await advance(1);
    expect(mockApi.callsOf("patch")).toHaveLength(1);
    expect(Object.keys(lastPatchBody()).sort()).toEqual(["card_ids", "data"]);
    expect(lastPatchBody().data.format).toBe(ARCHIMATE_FORMAT);
    expect(Object.keys(lastPatchBody().data).sort()).toEqual(["format", "thumbnail", "xml"]);
    const saved = readExchange(lastPatchBody().data.xml);
    expect(getCardId(saved.elements.find((e) => e.id === "id-app")!)).toBe("c1");
    expect(lastPatchBody().card_ids).toEqual(["c1"]);
    expect(mockApi.callsOf("patch")[0].path).toBe("/diagrams/d1");
    vi.useRealTimers();
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Saved"));
  });

  it("still saves the diagram when the thumbnail export itself fails", async () => {
    await mount();
    vi.spyOn(engine(), "exportSvg").mockRejectedValue(new Error("no svg"));
    vi.useFakeTimers();
    act(() => engine().setName(APP_SHAPE, "X"));
    await advance(3000);
    expect(mockApi.callsOf("patch")).toHaveLength(1);
    expect(Object.keys(lastPatchBody().data).sort()).toEqual(["format", "xml"]);
    vi.useRealTimers();
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Saved"));
  });

  it("restarts the timer on every change", async () => {
    await mount();
    vi.useFakeTimers();
    act(() => engine().setName(APP_SHAPE, "X"));
    await advance(2000);
    act(() => engine().setName(APP_SHAPE, "Y"));
    await advance(2999);
    expect(mockApi.callsOf("patch")).toHaveLength(0);
    await advance(1);
    expect(mockApi.callsOf("patch")).toHaveLength(1);
  });

  it("saves at once from the Save button and shows the saving state meanwhile", async () => {
    let release!: () => void;
    mockApi.on("patch", "/diagrams/d1", () => new Promise((r) => (release = () => r({}))));
    const { user } = await mount();
    act(() => engine().setName(APP_SHAPE, "X"));
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(mockApi.callsOf("patch")).toHaveLength(1);
    expect(screen.getByRole("status")).toHaveTextContent("Saving…");
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    await act(async () => release());
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Saved"));
  });

  it("never overlaps saves: a change during a save stays dirty and re-arms the timer after it", async () => {
    let release!: () => void;
    mockApi.on("patch", "/diagrams/d1", () => new Promise((r) => (release = () => r({}))));
    await mount();
    vi.useFakeTimers();
    act(() => engine().setName(APP_SHAPE, "X"));
    await advance(3000);
    expect(mockApi.callsOf("patch")).toHaveLength(1);
    act(() => engine().setName(APP_SHAPE, "Y")); // during the save
    await advance(10_000);
    expect(mockApi.callsOf("patch")).toHaveLength(1);
    await act(async () => release());
    expect(screen.getByRole("status")).toHaveTextContent("Unsaved changes");
    await advance(3000);
    expect(mockApi.callsOf("patch")).toHaveLength(2);
    expect(readExchange(lastPatchBody().data.xml).elements.find((e) => e.id === "id-app")!.name).toBe("Y");
    await act(async () => release());
    expect(screen.getByRole("status")).toHaveTextContent("Saved");
  });
});

describe("silent save failure", () => {
  it("shows a persistent error with the server's issues, stays unsaved, and Retry saves", async () => {
    mockApi.fail("patch", "/diagrams/d1", 422, {
      message: "Invalid ArchiMate model",
      issues: [{ code: "relationship_not_allowed", ref: "r1" }],
    });
    const { user } = await mount();
    vi.useFakeTimers();
    act(() => engine().setName(APP_SHAPE, "X"));
    await advance(3000);
    vi.useRealTimers();
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(
      "The diagram could not be saved: Invalid ArchiMate model: relationship_not_allowed (r1)",
    );
    expect(screen.getByRole("status")).toHaveTextContent("Unsaved changes");
    // Persistent: it is still there later.
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.getByRole("alert")).toBeInTheDocument();

    mockApi.on("patch", "/diagrams/d1", {});
    await user.click(within(alert).getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
    expect(screen.getByRole("status")).toHaveTextContent("Saved");
    expect(mockApi.callsOf("patch")).toHaveLength(2);
  });

  it("a later change still re-arms the autosave after a failure", async () => {
    mockApi.on("patch", "/diagrams/d1", () => {
      throw new ApiError("x", 500, "down");
    });
    await mount();
    vi.useFakeTimers();
    act(() => engine().setName(APP_SHAPE, "X"));
    await advance(3000);
    expect(screen.getByRole("alert")).toHaveTextContent("The diagram could not be saved: down");
    act(() => engine().setName(APP_SHAPE, "Y"));
    await advance(3000);
    expect(mockApi.callsOf("patch")).toHaveLength(2);
  });

  it("handles a non-API failure (the error's message)", async () => {
    mockApi.on("patch", "/diagrams/d1", () => {
      throw new Error("offline");
    });
    const { user } = await mount();
    act(() => engine().setName(APP_SHAPE, "X"));
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("The diagram could not be saved: offline");
  });
});

describe("beforeunload", () => {
  const listenerCount = (spy: ReturnType<typeof vi.spyOn>) => spy.mock.calls.filter((c) => c[0] === "beforeunload").length;

  it("is registered exactly while dirty, and removed once saved", async () => {
    const add = vi.spyOn(window, "addEventListener");
    const remove = vi.spyOn(window, "removeEventListener");
    const { user } = await mount();
    expect(listenerCount(add)).toBe(0);
    act(() => engine().setName(APP_SHAPE, "X"));
    expect(listenerCount(add)).toBe(1);
    const event = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(listenerCount(remove)).toBe(1));
    const after = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(after);
    expect(after.defaultPrevented).toBe(false);
    add.mockRestore();
    remove.mockRestore();
  });

  it("is removed on unmount while still dirty", async () => {
    const remove = vi.spyOn(window, "removeEventListener");
    const view = await mount();
    act(() => engine().setName(APP_SHAPE, "X"));
    view.unmount();
    expect(listenerCount(remove)).toBe(1);
    remove.mockRestore();
  });
});

describe("unmount", () => {
  it("destroys the engine and cancels the pending autosave, without asking to leave", async () => {
    const confirm = vi.spyOn(window, "confirm");
    const view = await mount();
    const destroy = vi.spyOn(engine(), "destroy");
    vi.useFakeTimers();
    act(() => engine().setName(APP_SHAPE, "X"));
    view.unmount();
    expect(destroy).toHaveBeenCalledTimes(1);
    await advance(10_000);
    expect(mockApi.callsOf("patch")).toHaveLength(0);
    expect(confirm).not.toHaveBeenCalled();
    confirm.mockRestore();
  });
});

describe("unsaved-changes guard", () => {
  const CONFIRM = "You have unsaved changes. Leave without saving?";
  afterEach(() => vi.restoreAllMocks());

  it("asks before an in-app navigation while dirty, and declining keeps the page", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    await mount();
    act(() => engine().setName(APP_SHAPE, "X"));
    act(() => nav.navigate("/elsewhere"));
    expect(confirm).toHaveBeenCalledWith(CONFIRM);
    expect(nav.path).toBe("/");
    expect(screen.getByRole("button", { name: "Save" })).toBeInTheDocument();
  });

  it("lets the navigation through once the user accepts", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    await mount();
    act(() => engine().setName(APP_SHAPE, "X"));
    act(() => nav.navigate("/elsewhere"));
    expect(nav.path).toBe("/elsewhere");
  });

  it("does not ask while clean, including after a successful save", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const { user } = await mount();
    act(() => nav.navigate("/a"));
    expect(nav.path).toBe("/a");
    act(() => engine().setName(APP_SHAPE, "X"));
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Saved"));
    act(() => nav.navigate("/b"));
    expect(nav.path).toBe("/b");
    expect(confirm).not.toHaveBeenCalled();
  });

  it("is still active while a failed-save alert is showing", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    mockApi.fail("patch", "/diagrams/d1", 500, "down");
    const { user } = await mount();
    act(() => engine().setName(APP_SHAPE, "X"));
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("down");
    act(() => nav.navigate("/elsewhere"));
    expect(confirm).toHaveBeenCalledWith(CONFIRM);
    expect(nav.path).toBe("/");
  });
});

describe("language switch", () => {
  afterEach(() => i18n.changeLanguage("en"));

  it("keeps the engine, the unsaved edit and the undo history", async () => {
    await mount();
    const first = engine();
    act(() => first.setName(APP_SHAPE, "Edited"));
    expect(screen.getByRole("status")).toHaveTextContent("Unsaved changes");
    await act(async () => {
      await i18n.changeLanguage("it");
    });
    expect(screen.getByRole("status")).not.toHaveTextContent("Unsaved changes"); // translated
    expect(engine()).toBe(first); // onEngine was not called again
    expect(first.toModel().elements.find((e) => e.id === "id-app")!.name).toBe("Edited");
    expect(first.canUndo()).toBe(true);
    expect(document.querySelectorAll(".djs-container")).toHaveLength(1);
  });
});

describe("switching diagram", () => {
  it("a save still in flight for the old diagram does not freeze the new one", async () => {
    let release!: () => void;
    mockApi.on("patch", "/diagrams/d1", () => new Promise((r) => (release = () => r({}))));
    mockApi.on("get", "/diagrams/d2", doc(UNLINKED, { id: "d2", name: "B" }));
    mockApi.on("patch", "/diagrams/d2", {});
    const { user, rerender } = await mount();
    act(() => engine().setName(APP_SHAPE, "X"));
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(screen.getByRole("status")).toHaveTextContent("Saving…");
    handle = null;
    rerender(wrapWithProviders(tree("d2"), { theme: true }));
    await waitFor(() => expect(handle).not.toBeNull());
    expect(screen.getByRole("status")).toHaveTextContent("Saved");
    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
    await act(async () => release()); // the old save finishes late
    expect(screen.getByRole("status")).toHaveTextContent("Saved");
    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
    vi.useFakeTimers();
    act(() => engine().setName(APP_SHAPE, "Y"));
    await advance(3000);
    expect(mockApi.callsOf("patch", "/diagrams/d2")).toHaveLength(1);
    expect(readExchange((mockApi.callsOf("patch", "/diagrams/d2")[0].body as { data: { xml: string } }).data.xml)
      .elements.find((e) => e.id === "id-app")!.name).toBe("Y");
    expect(mockApi.callsOf("patch", "/diagrams/d1")).toHaveLength(1);
  });

  it("a late card-name failure of the old diagram shows nothing on the new one", async () => {
    let fail!: () => void;
    mockApi.on("get", "/cards?ids=*", () => new Promise((_, rej) => (fail = () => rej(new Error("late")))));
    mockApi.on("get", "/diagrams/d2", doc(UNLINKED, { id: "d2", name: "B" }));
    const { rerender } = await mount(doc(MODEL));
    handle = null;
    rerender(wrapWithProviders(tree("d2"), { theme: true }));
    await waitFor(() => expect(handle).not.toBeNull());
    await act(async () => fail());
    expect(screen.queryByText("late")).toBeNull();
  });

  it("starts clean: no stale dirty state, error, timer or guard for the new diagram", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    mockApi.fail("patch", "/diagrams/d1", 500, "down");
    mockApi.on("get", "/diagrams/d2", doc(UNLINKED, { id: "d2", name: "B" }));
    const view = await mount();
    vi.useFakeTimers();
    act(() => engine().setName(APP_SHAPE, "X"));
    await advance(3000); // fails: the error alert and the dirty state are up
    expect(screen.getByRole("alert")).toBeInTheDocument();
    act(() => engine().setName(APP_SHAPE, "Y")); // re-arms a timer for d1
    const patches = mockApi.callsOf("patch").length;
    handle = null;
    view.rerender(wrapWithProviders(tree("d2"), { theme: true }));
    await advance(0);
    await advance(0);
    expect(handle).not.toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("status")).toHaveTextContent("Saved");
    await advance(10_000);
    expect(mockApi.callsOf("patch")).toHaveLength(patches); // the old timer never fires
    act(() => nav.navigate("/elsewhere"));
    expect(confirm).not.toHaveBeenCalled();
    expect(nav.path).toBe("/elsewhere");
    confirm.mockRestore();
  });
});

describe("toolbar", () => {
  it("gives every button a translated accessible name", async () => {
    await mount(doc(), { onBack: vi.fn() });
    const toolbar = screen.getAllByRole("button").filter((b) => !b.closest(".djs-container"));
    const names = toolbar.map((b) => b.getAttribute("aria-label") ?? b.textContent);
    expect(names.every((n) => !!n && n.trim() !== "")).toBe(true);
    for (const label of [
      "Back", "Undo", "Redo", "Zoom in", "Zoom out", "Fit to screen", "Save", "Check the model",
      "Export as Exchange file", "Export as SVG", "Import an Exchange file", "Keyboard shortcuts",
    ]) {
      expect(screen.getByRole("button", { name: label })).toBeInTheDocument();
    }
  });

  it("goes back", async () => {
    const onBack = vi.fn();
    const { user } = await mount(doc(), { onBack });
    await user.click(screen.getByRole("button", { name: "Back" }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it("has no back button without onBack", async () => {
    await mount();
    expect(screen.queryByRole("button", { name: "Back" })).toBeNull();
  });

  it("enables undo/redo from the command stack and drives it", async () => {
    const { user } = await mount();
    const undo = screen.getByRole("button", { name: "Undo" });
    const redo = screen.getByRole("button", { name: "Redo" });
    expect(undo).toBeDisabled();
    expect(redo).toBeDisabled();
    act(() => engine().setName(APP_SHAPE, "X"));
    expect(undo).toBeEnabled();
    expect(redo).toBeDisabled();
    await user.click(undo);
    expect(engine().elementInfo(APP_SHAPE)!.name).toBe("CRM <core>");
    expect(undo).toBeDisabled();
    expect(redo).toBeEnabled();
    await user.click(redo);
    expect(engine().elementInfo(APP_SHAPE)!.name).toBe("X");
  });

  it("zooms and fits through the engine", async () => {
    const { user } = await mount();
    const zoomBy = vi.spyOn(engine(), "zoomBy");
    const zoomFit = vi.spyOn(engine(), "zoomFit");
    await user.click(screen.getByRole("button", { name: "Zoom in" }));
    await user.click(screen.getByRole("button", { name: "Zoom out" }));
    await user.click(screen.getByRole("button", { name: "Fit to screen" }));
    expect(zoomBy.mock.calls).toEqual([[1], [-1]]);
    expect(zoomFit).toHaveBeenCalledTimes(1);
  });

  it("checks the model on the server and lists the issues", async () => {
    mockApi.on("post", "/archimate/validate", {
      valid: false,
      issues: [{ code: "relationship_not_allowed", message: "m", ref: "r1" }],
    });
    const { user } = await mount();
    await user.click(screen.getByRole("button", { name: "Check the model" }));
    const dialog = await screen.findByRole("dialog", { name: "Model check" });
    expect(within(dialog).getByText("1 problem found")).toBeInTheDocument();
    expect(within(dialog).getByText(/does not allow the relationship r1/)).toBeInTheDocument();
    const body = mockApi.callsOf("post", "/archimate/validate")[0].body as { xml: string };
    expect(Object.keys(body)).toEqual(["xml"]);
    expect(readExchange(body.xml).name).toBe(UNLINKED.name);
  });

  it("says when the model is fine, and shows a failed check", async () => {
    mockApi.on("post", "/archimate/validate", { valid: true, issues: [] });
    const { user } = await mount();
    await user.click(screen.getByRole("button", { name: "Check the model" }));
    expect(await screen.findByText("No problems found.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Close" }));
    mockApi.fail("post", "/archimate/validate", 500, "validator down");
    await user.click(screen.getByRole("button", { name: "Check the model" }));
    expect(await screen.findByText("validator down")).toBeInTheDocument();
  });

  it("exports the Exchange file and the SVG under the diagram's name", async () => {
    const { user } = await mount();
    await user.click(screen.getByRole("button", { name: "Export as Exchange file" }));
    expect(downloadText).toHaveBeenCalledTimes(1);
    const [file, text, mime] = vi.mocked(downloadText).mock.calls[0];
    expect([file, mime]).toEqual(["A.xml", "application/xml"]);
    expect(text).toBe(writeExchange(engine().toModel()));

    vi.spyOn(engine(), "exportSvg").mockResolvedValue("<svg/>");
    await user.click(screen.getByRole("button", { name: "Export as SVG" }));
    await waitFor(() => expect(downloadText).toHaveBeenCalledWith("A.svg", "<svg/>", "image/svg+xml"));
  });

  it("reports an SVG export failure", async () => {
    const { user } = await mount();
    vi.spyOn(engine(), "exportSvg").mockRejectedValue(new Error("no svg"));
    await user.click(screen.getByRole("button", { name: "Export as SVG" }));
    expect(await screen.findByText("no svg")).toBeInTheDocument();
  });

  it("opens the shortcuts list", async () => {
    const { user } = await mount();
    await user.click(screen.getByRole("button", { name: "Keyboard shortcuts" }));
    expect(await screen.findByRole("dialog", { name: "Keyboard shortcuts" })).toBeInTheDocument();
  });
});

describe("import", () => {
  const other: ArchimateModel = (() => {
    const m = structuredClone(UNLINKED);
    m.name = "Other";
    m.elements[0].name = "Imported app";
    return m;
  })();
  const upload = (user: ReturnType<typeof renderWithProviders>["user"], text: string) =>
    user.upload(screen.getByTestId("archimate-import-input"), new File([text], "m.xml", { type: "text/xml" }));

  it("accepts only Exchange files", async () => {
    await mount();
    expect(screen.getByTestId("archimate-import-input")).toHaveAttribute("accept", ".xml,.archimate-exchange");
  });

  it("asks before replacing, then loads the model and marks the diagram unsaved", async () => {
    const { user } = await mount();
    await upload(user, writeExchange(other));
    const dialog = await screen.findByRole("dialog", { name: "Replace the diagram?" });
    expect(within(dialog).getByText("Importing a file replaces everything in this diagram.")).toBeInTheDocument();
    expect(engine().elementInfo(APP_SHAPE)!.name).toBe("CRM <core>");
    await user.click(within(dialog).getByRole("button", { name: "Replace" }));
    expect(engine().elementInfo(APP_SHAPE)!.name).toBe("Imported app");
    expect(screen.getByRole("status", { hidden: true })).toHaveTextContent("Unsaved changes");
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Replace the diagram?" })).toBeNull());
  });

  it("keeps the diagram when the confirmation is cancelled", async () => {
    const { user } = await mount();
    await upload(user, writeExchange(other));
    await user.click(await screen.findByRole("button", { name: "Cancel" }));
    expect(engine().elementInfo(APP_SHAPE)!.name).toBe("CRM <core>");
    expect(screen.getByRole("status", { hidden: true })).toHaveTextContent("Saved");
  });

  it("shows the translated reason for a bad file and changes nothing", async () => {
    const { user } = await mount();
    await upload(user, "<!DOCTYPE a><model/>");
    expect(
      await screen.findByText(
        "The file could not be imported: The file contains a DOCTYPE or entity declaration, which is not allowed.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "Replace the diagram?" })).toBeNull();
    expect(engine().elementInfo(APP_SHAPE)!.name).toBe("CRM <core>");
    expect(screen.getByRole("status", { hidden: true })).toHaveTextContent("Saved");
  });

  it("refuses an oversized file before reading it", async () => {
    const { user } = await mount();
    const file = new File(["<model/>"], "big.xml", { type: "text/xml" });
    Object.defineProperty(file, "size", { value: MAX_EXCHANGE_BYTES + 1 });
    const read = vi.spyOn(file, "text");
    await user.upload(screen.getByTestId("archimate-import-input"), file);
    expect(await screen.findByText("The file could not be imported: The file is larger than 5 MB.")).toBeInTheDocument();
    expect(read).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog", { name: "Replace the diagram?" })).toBeNull();
  });

  it("warns about organizations of the imported file", async () => {
    const { user } = await mount();
    const xml = writeExchange(other).replace("</model>", "<organizations><label xml:lang=\"en\">F</label></organizations></model>");
    await upload(user, xml);
    await user.click(await screen.findByRole("button", { name: "Replace" }));
    expect(screen.getByText("The file contains folders (organizations); they are not kept.")).toBeInTheDocument();
  });
});

describe("link dialog", () => {
  it("offers the card types of the element and links the picked card, keeping a non-empty name", async () => {
    const { user } = await mount();
    act(() => handle!.bridge.openLinkPicker(APP_SHAPE));
    const dialog = await screen.findByRole("dialog", { name: "Link to a card" });
    await user.click(within(dialog).getByText("pick:Application"));
    expect(engine().elementInfo(APP_SHAPE)).toMatchObject({ cardId: "c5", name: "CRM <core>" });
    expect(screen.queryByRole("dialog", { name: "Link to a card" })).toBeNull();
  });

  it("opens nothing for an element no card type maps to (CardPicker would offer every type)", async () => {
    await mount();
    expect(engine().elementInfo("id-n2")!.type).toBe("DataObject");
    act(() => handle!.bridge.openLinkPicker("id-n2"));
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByText(/^pick:/)).toBeNull();
  });

  it("takes the card's name when the element has none", async () => {
    const unnamed = structuredClone(UNLINKED);
    unnamed.elements[0].name = "";
    const { user } = await mount(doc(unnamed));
    act(() => handle!.bridge.openLinkPicker(APP_SHAPE));
    await user.click(await screen.findByText("pick:Application"));
    expect(engine().elementInfo(APP_SHAPE)).toMatchObject({ cardId: "c5", name: "Billing" });
  });

  it("changes nothing when closed without a pick", async () => {
    const { user } = await mount();
    act(() => handle!.bridge.openLinkPicker(APP_SHAPE));
    await user.click(await screen.findByRole("button", { name: "Cancel" }));
    expect(engine().elementInfo(APP_SHAPE)).toMatchObject({ cardId: null, name: "CRM <core>" });
    expect(engine().canUndo()).toBe(false);
    expect(screen.getByRole("status")).toHaveTextContent("Saved");
  });
});

describe("create-card dialog", () => {
  const open = () => act(() => handle!.bridge.openCreateCard(APP_SHAPE));

  it("creates the card on submit and links the element", async () => {
    mockApi.on("post", "/cards", { id: "c9", name: "CRM <core>", type: "Application" });
    const { user } = await mount();
    open();
    expect(await screen.findByRole("textbox", { name: "Name" })).toHaveValue("CRM <core>");
    expect(mockApi.callsOf("post", "/cards")).toHaveLength(0); // nothing happens until the click
    await user.click(screen.getByRole("button", { name: "Create and link" }));
    await waitFor(() => expect(engine().elementInfo(APP_SHAPE)!.cardId).toBe("c9"));
    expect(mockApi.callsOf("post", "/cards")).toEqual([
      { method: "post", path: "/cards", body: { type: "Application", name: "CRM <core>" } },
    ]);
    expect(screen.queryByRole("dialog", { name: "Create a card" })).toBeNull();
  });

  it("stays open with the reason and does not link when the creation fails", async () => {
    mockApi.fail("post", "/cards", 403, "Not allowed");
    const { user } = await mount();
    open();
    await user.click(await screen.findByRole("button", { name: "Create and link" }));
    expect(await screen.findByText("The card could not be created: Not allowed")).toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "Create a card" })).toBeInTheDocument();
    expect(engine().elementInfo(APP_SHAPE)!.cardId).toBeNull();
  });
});

describe("object info popover", () => {
  // The palette tile's own click/keyboard branching between "start placing" and "open the info
  // popover" is covered at the unit level in ArchimatePaletteProvider.test.ts, with a faked
  // `create` service for the tile-body case -- the real `create` service drives mouse tracking
  // that jsdom doesn't support (no `document.elementFromPoint`). Here, through the same
  // `handle!.bridge` seam the link/create-card dialogs above use, we verify ArchimateModeler
  // renders what the bridge asks for.
  it("renders the popover the bridge asks for, read-only (no edit pencil, per the spec's Anti-goals)", async () => {
    await mount();
    const anchorEl = document.createElement("div");
    document.body.appendChild(anchorEl);
    act(() => handle!.bridge.openObjectInfo("ApplicationComponent", anchorEl));
    expect(await screen.findByText("Application Component")).toBeInTheDocument();
    expect(screen.getByText("A modular, deployable part of software.")).toBeInTheDocument();
    expect(screen.queryByLabelText("Edit description")).not.toBeInTheDocument();
  });

  it("renders nothing for a key the registry hasn't resolved", async () => {
    await mount();
    act(() => handle!.bridge.openObjectInfo("NoSuchKey", document.createElement("div")));
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByText("A modular, deployable part of software.")).toBeNull();
  });

  it("a real click on the tile's info badge opens the popover and places no element -- unlike the tile body, this is safe to click in jsdom since it never reaches the real create service", async () => {
    const { user } = await mount();
    const registry = services<{ getAll(): unknown[] }>("elementRegistry");
    const before = registry.getAll().length;
    const tile = document.querySelector<HTMLElement>('[data-action="create.ApplicationComponent"]')!;
    const badge = tile.querySelector<HTMLElement>(".archimate-palette-info")!;
    await user.click(badge);
    expect(await screen.findByText("Application Component")).toBeInTheDocument();
    expect(screen.getByText("A modular, deployable part of software.")).toBeInTheDocument();
    expect(registry.getAll().length).toBe(before); // no element was placed
  });
});

describe("hiding a standard Enterprise Object", () => {
  it("omits its palette tile -- regression: the bridge used to fetch the registry WITHOUT include_hidden, so a hidden standard type's row never arrived and stayed indistinguishable from no row at all (which is fail-open/visible)", async () => {
    mockApi.on("get", "/metamodel/enterprise-objects?include_hidden=true", [
      {
        key: "ApplicationComponent", name: "Application Component", description: "A modular, deployable part of software.",
        icon: "deployed_code", color: "#99c7ef", is_hidden: true,
        card_mappings: [{ id: "m1", enterprise_object_key: "ApplicationComponent", card_type_key: "Application", card_subtype_key: null }],
      },
      {
        key: "Node", name: "Node", description: "A computational or physical resource.", icon: "dns", color: "#ffcc80",
        card_mappings: [{ id: "m2", enterprise_object_key: "Node", card_type_key: "ITComponent", card_subtype_key: null }],
      },
    ]);
    await mount();
    expect(document.querySelector('[data-action="create.ApplicationComponent"]')).toBeNull();
    expect(document.querySelector('[data-action="create.Node"]')).not.toBeNull();
  });
});

describe("no card is created or deleted by editing", () => {
  it("dropping a palette element and deleting it touches no card", async () => {
    await mount();
    const registry = services<{ getAll(): unknown[] }>("elementRegistry");
    const before = registry.getAll().length;
    const entry = document.querySelector<HTMLElement>('[data-action="create.BusinessActor"]')!;
    act(() => {
      entry.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    });
    expect(registry.getAll().length).toBe(before + 1);
    const created = engine().selection();
    expect(created).toHaveLength(1);
    act(() => {
      const modeling = services<{ removeElements(e: unknown[]): void }>("modeling");
      const els = services<{ get(id: string): unknown }>("elementRegistry");
      modeling.removeElements(created.map((id) => els.get(id)));
    });
    expect(registry.getAll().length).toBe(before);
    expect(mockApi.callsOf("post", "/cards")).toEqual([]);
    expect(mockApi.callsOf("delete")).toEqual([]);
    expect(mockApi.callsOf("patch", /^\/cards/)).toEqual([]);
  });
});

describe("custom Enterprise Objects on the canvas", () => {
  const AI_MODEL_ROW = {
    key: "AIModel", name: "AI Model", description: null, icon: "smart_toy", color: "#ab12cd",
    layer: "application", is_standard: false, is_locked: false, is_hidden: false, sort_order: 0, card_mappings: [],
  };

  beforeEach(() => {
    // Adds a custom row alongside the two standard ones the top-level beforeEach already mocks,
    // so a palette tile for it exists.
    mockApi.on("get", "/metamodel/enterprise-objects?include_hidden=true", [
      {
        key: "ApplicationComponent", name: "Application Component", description: "A modular, deployable part of software.",
        icon: "deployed_code", color: "#99c7ef",
        card_mappings: [{ id: "m1", enterprise_object_key: "ApplicationComponent", card_type_key: "Application", card_subtype_key: null }],
      },
      {
        key: "Node", name: "Node", description: "A computational or physical resource.", icon: "dns", color: "#ffcc80",
        card_mappings: [{ id: "m2", enterprise_object_key: "Node", card_type_key: "ITComponent", card_subtype_key: null }],
      },
      AI_MODEL_ROW,
    ]);
  });

  it("drops, selects, renames and saves a custom object end to end -- regression: selecting one used to throw inside the real engine (itemInfo/getCardId assumed every businessObject has a `properties` array), and saving while one was on the canvas used to throw for the WHOLE diagram (extractEdited assumed the same)", async () => {
    await mount();
    const tile = document.querySelector<HTMLElement>('[data-action="create.AIModel"]')!;
    expect(tile).not.toBeNull();
    const registry = services<{ getAll(): unknown[] }>("elementRegistry");
    const before = registry.getAll().length;

    // Keyboard drop: dropAtCentre auto-selects the new shape, firing onSelect -> the page calls
    // selectedItem() -> itemInfo() on the very next render. This must not throw.
    expect(() => {
      act(() => {
        tile.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
      });
    }).not.toThrow();
    expect(registry.getAll().length).toBe(before + 1);
    const created = engine().selection();
    expect(created).toHaveLength(1);

    // Renaming it (the inline edit box every fresh drop opens) must not throw either.
    expect(() => engine().setName(created[0], "Fraud Detector")).not.toThrow();
    expect(engine().itemInfo(created[0])?.name).toBe("Fraud Detector");

    // Saving the WHOLE diagram with it still on the canvas must not throw, and the diagram's own
    // elements still save correctly -- the custom object is saved too, as a Note/Label (its type
    // degrades to a plain note on reload; true round-trip fidelity is explicitly deferred, but it
    // must not silently vanish).
    vi.useFakeTimers();
    act(() => engine().setName(APP_SHAPE, "Renamed"));
    await advance(3000);
    expect(mockApi.callsOf("patch")).toHaveLength(1);
    const saved = readExchange(lastPatchBody().data.xml);
    expect(saved.elements.find((e) => e.id === "id-app")!.name).toBe("Renamed");
    expect(saved.elements.some((e) => e.name === "Fraud Detector")).toBe(false);
    expect(saved.views[0].notes.some((n) => n.text === "Fraud Detector")).toBe(true);
    vi.useRealTimers();

    // Deleting it afterwards still touches no card, same as any other shape.
    act(() => {
      const modeling = services<{ removeElements(e: unknown[]): void }>("modeling");
      const els = services<{ get(id: string): unknown }>("elementRegistry");
      modeling.removeElements(created.map((id) => els.get(id)));
    });
    expect(registry.getAll().length).toBe(before);
    expect(mockApi.callsOf("post", "/cards")).toEqual([]);
  });
});

describe("properties panel", () => {
  const toggle = () => screen.getByRole("button", { name: "Show or hide the properties panel" });
  const select = (shapeId: string) =>
    act(() => {
      const registry = services<{ get(id: string): unknown }>("elementRegistry");
      services<{ select(e: unknown): void }>("selection").select(registry.get(shapeId));
    });

  it("is closed on a narrow screen, opens from the toolbar and follows the selection", async () => {
    act(() => setViewportWidth(600));
    await mount();
    expect(screen.queryByRole("complementary")).toBeNull();
    const user = userEvent.setup();
    await user.click(toggle());
    expect(within(screen.getByRole("complementary")).getByRole("heading", { name: "A" })).toBeInTheDocument();
    select(APP_SHAPE);
    expect(await within(screen.getByRole("complementary")).findByRole("heading", { name: "CRM <core>" })).toBeInTheDocument();
    await user.click(toggle());
    expect(screen.queryByRole("complementary")).toBeNull();
  });

  it("is open on a wide screen, and the toolbar closes it", async () => {
    await mount();
    expect(screen.getByRole("complementary")).toBeInTheDocument();
    await userEvent.setup().click(toggle());
    expect(screen.queryByRole("complementary")).toBeNull();
  });

  it("renames from the panel as one change that is saved with the diagram", async () => {
    await mount();
    const user = userEvent.setup();
    select(APP_SHAPE);
    const name = (await screen.findAllByLabelText("Name"))[0];
    await user.clear(name);
    await user.type(name, "Billing{Enter}");
    expect(engine().itemInfo(APP_SHAPE)!.name).toBe("Billing");
    expect(screen.getByRole("status")).toHaveTextContent("Unsaved changes");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(mockApi.callsOf("patch")).toHaveLength(1));
    expect(readExchange(lastPatchBody().data.xml).elements.find((e) => e.id === "id-app")!.name).toBe("Billing");
  });

  it("saves a property typed in the panel with its definition", async () => {
    await mount();
    const user = userEvent.setup();
    select(APP_SHAPE);
    await user.click(await screen.findByRole("button", { name: "Add a property" }));
    const panel = within(screen.getByRole("complementary")); // the palette has a "Value" entry too
    const names = panel.getAllByLabelText("Name");
    await user.type(names[names.length - 1], "owner");
    await user.type(panel.getByLabelText("Value"), "Ann");
    await user.tab();
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(mockApi.callsOf("patch")).toHaveLength(1));
    const saved = readExchange(lastPatchBody().data.xml);
    const def = saved.propertyDefinitions.find((d) => d.name === "owner")!;
    expect(saved.elements.find((e) => e.id === "id-app")!.properties).toEqual([{ ref: def.id, value: "Ann" }]);
  });

  it("renames the diagram and edits its description from the panel, as separate PATCH calls", async () => {
    await mount({ ...doc(), description: "Old description" });
    const user = userEvent.setup();
    const name = (await screen.findAllByLabelText("Name"))[0];
    await user.clear(name);
    await user.type(name, "Renamed{Enter}");
    await waitFor(() => expect(mockApi.callsOf("patch").at(-1)?.body).toEqual({ name: "Renamed" }));
    expect(screen.getByRole("heading", { name: "Renamed" })).toBeInTheDocument();
    const doc2 = screen.getByLabelText("Documentation");
    expect(doc2).toHaveValue("Old description");
    await user.clear(doc2);
    await user.type(doc2, "New description");
    await user.tab();
    await waitFor(() => expect(mockApi.callsOf("patch").at(-1)?.body).toEqual({ description: "New description" }));
    // Neither touches the autosaved Exchange XML.
    expect(mockApi.callsOf("patch").every((c) => !("data" in (c.body as object)))).toBe(true);
  });

  it("shows the View placeholder only when nothing is selected", async () => {
    await mount();
    expect(screen.getByText("View")).toBeInTheDocument();
    select(APP_SHAPE);
    await screen.findByRole("heading", { name: "CRM <core>" });
    expect(screen.queryByText("View")).toBeNull();
  });

  it("saves the diagram's own parameters through autosave, like an element's", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    await mount();
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    await user.click(await screen.findByRole("button", { name: "Add a property" }));
    const panel = within(screen.getByRole("complementary"));
    await user.type(panel.getAllByLabelText("Name").at(-1)!, "owner");
    await user.type(panel.getByLabelText("Value"), "EA team");
    await user.tab();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    await waitFor(() => expect(mockApi.callsOf("patch")).toHaveLength(1));
    const saved = readExchange(lastPatchBody().data.xml);
    const def = saved.propertyDefinitions.find((d) => d.name === "owner")!;
    expect(saved.properties).toEqual([{ ref: def.id, value: "EA team" }]);
    vi.useRealTimers();
  });

  it("shows the linked card's own summary, readonly, and its button opens the card sheet", async () => {
    mockApi.on("get", "/cards/c1", {
      id: "c1", type: "Application", name: "CRM", description: "Customer relations",
      status: "ACTIVE", approval_status: "APPROVED", data_quality: 90, tags: [], stakeholders: [], attributes: {},
    });
    await mount(doc(MODEL));
    const user = userEvent.setup();
    select(APP_SHAPE);
    const panel = within(await screen.findByRole("complementary"));
    const openButton = await panel.findByRole("button", { name: "Open the linked card: CRM" });
    expect(panel.getByText("Customer relations")).toBeInTheDocument();
    expect(panel.queryByLabelText("Name")).toBeNull(); // the free-text Name field is gone; the card owns it
    await user.click(openButton);
    expect(screen.getByRole("dialog", { name: "card sheet: c1" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "close card sheet" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("source hygiene", () => {
  const dir = __dirname;
  const sources = readdirSync(dir)
    .filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f))
    .sort();

  itSourceScan("scans this feature's own files", () => {
    expect(sources).toEqual(expect.arrayContaining(["ArchimateModeler.tsx", "useArchimateBridge.ts", "saveError.ts"]));
  });

  itSourceScan.each(sources)("%s has no empty (or comment-only) catch block", (file) => {
    expect(readFileSync(resolve(dir, file), "utf-8")).not.toMatch(
      // Every alternative starts with a distinct character and ends at a fixed delimiter: one way to match, no ReDoS.
      /catch\s*(?:\([^)]*\)\s*)?\{(?:\s|\/\/[^\n]*(?=\n|$)|\/\*(?:[^*]|\*(?!\/))*\*\/)*\}/,
    );
  });

  itSourceScan("creates a card only in CreateCardDialog", () => {
    const posts = sources.filter((f) => /api\.post/.test(readFileSync(resolve(dir, f), "utf-8")));
    // The sandbox page posts a new DIAGRAM (never a card).
    expect(posts).toEqual(["ArchimateModeler.tsx", "ArchimateSandboxPage.tsx", "CreateCardDialog.tsx"]);
    expect(readFileSync(resolve(dir, "ArchimateModeler.tsx"), "utf-8")).not.toMatch(/["'`]\/cards["'`]/);
    const sandbox = readFileSync(resolve(dir, "ArchimateSandboxPage.tsx"), "utf-8");
    expect(sandbox).not.toMatch(/["'`]\/cards/);
    expect(sandbox.match(/api\.post[^(]*\(\s*"([^"]+)"/g)).toEqual(['api.post<{ id: string }>("/diagrams"']);
  });
});
