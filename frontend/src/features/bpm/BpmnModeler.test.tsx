import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/api/client", () => import("@/test/apiMock").then((m) => m.apiClientModule()));
vi.mock("@/hooks/useMetamodel", () => import("@/test/hooks").then((m) => m.useMetamodelModule()));

const mockNavigate = vi.fn();
vi.mock("react-router", async () => {
  const actual = await vi.importActual<typeof import("react-router")>("react-router");
  return { ...actual, useNavigate: () => mockNavigate };
});

vi.mock("@/components/CardPicker", () => ({
  default: ({ onChange }: { onChange: (v: { id: string; name: string; type: string } | null) => void }) => (
    <button onClick={() => onChange({ id: "picked-1", name: "Picked Card", type: "x" })}>
      pick-card
    </button>
  ),
}));
vi.mock("@/components/CardMultiPicker", () => ({
  default: ({
    onChange,
  }: {
    onChange: (ids: string[], picked: { id: string; name: string }[]) => void;
  }) => (
    <button
      onClick={() =>
        onChange(["org-1"], [{ id: "org-1", name: "Acme Org" }])
      }
    >
      pick-organizations
    </button>
  ),
}));

/** Captures the live bridge object the component hands to
 *  `createCalledProcessModule` -- the only way to reach `openPicker` /
 *  `clearLink` / `openCard` from outside, since the real wiring is a bpmn-js
 *  context-pad click this test suite does not drive. */
const bridgeState: { bridge: LinkBridge | null } = vi.hoisted(() => ({ bridge: null }));
vi.mock("./calledProcessModule", () => ({
  createCalledProcessModule: (bridge: unknown) => {
    bridgeState.bridge = bridge;
    return {};
  },
}));

const modelerState = vi.hoisted(() => ({
  instances: [] as FakeModeler[],
  importFails: false,
  saveXmlResult: { xml: "<bpmn:definitions>saved</bpmn:definitions>" },
  saveXmlFails: false,
  saveSvgResult: { svg: "<svg>generated</svg>" },
  // Read live on every call (not fixed at construction time), so a test can
  // configure the lookup before rendering and have it apply to whichever
  // instance the init effect goes on to create -- the effect's own async
  // chain (dynamic imports, then the draft-elements fetch) otherwise races
  // any mock reconfigured only after the modeler is observed to exist.
  registryGet: (_id: string): unknown => null,
}));

class FakeModeler {
  services: Record<string, unknown>;
  destroyed = false;
  importedXml: string | undefined;

  constructor(public opts: unknown) {
    this.services = {
      canvas: { zoom: vi.fn((z?: unknown) => z ?? 1) },
      overlays: { add: vi.fn(), remove: vi.fn() },
      elementRegistry: { getAll: vi.fn(() => []), get: vi.fn((id: string) => modelerState.registryGet(id)) },
      eventBus: { on: vi.fn(), fire: vi.fn() },
      commandStack: { undo: vi.fn(), redo: vi.fn() },
      propertiesPanel: { attachTo: vi.fn(), detach: vi.fn() },
      modeling: { updateProperties: vi.fn() },
    };
    modelerState.instances.push(this);
  }

  get(name: string) {
    return this.services[name];
  }

  async importXML(xml: string) {
    this.importedXml = xml;
    if (modelerState.importFails) throw new Error("bad xml");
  }

  async saveXML() {
    if (modelerState.saveXmlFails) throw new Error("save failed");
    return modelerState.saveXmlResult;
  }

  async saveSVG() {
    return modelerState.saveSvgResult;
  }

  destroy() {
    this.destroyed = true;
  }
}

vi.mock("bpmn-js/lib/Modeler", () => ({ default: FakeModeler }));
vi.mock("bpmn-js-color-picker", () => ({ default: {} }));
vi.mock("bpmn-js-create-append-anything", () => ({ CreateAppendAnythingModule: {} }));
vi.mock("bpmn-js-properties-panel", () => ({
  BpmnPropertiesPanelModule: {},
  BpmnPropertiesProviderModule: {},
}));

import BpmnModeler from "./BpmnModeler";
import type { LinkBridge } from "./calledProcessModule";
import { mockApi } from "@/test/apiMock";
import { hookState } from "@/test/hooks";

const DRAFT_XML = "<bpmn:definitions>draft</bpmn:definitions>";

function renderModeler(props: Partial<React.ComponentProps<typeof BpmnModeler>> = {}) {
  return render(
    <BpmnModeler processId="p1" versionId="v1" initialXml={DRAFT_XML} {...props} />,
  );
}

/** The component registers more than one "commandStack.changed" listener
 *  (link-dots refresh, autosave/dirty-tracking) -- fire them all, same as a
 *  real bpmn-js edit would. */
function triggerCommandStackChanged(modeler: FakeModeler) {
  const handlers = (modeler.get("eventBus") as { on: ReturnType<typeof vi.fn> }).on.mock.calls
    .filter((c) => c[0] === "commandStack.changed")
    .map((c) => c[1] as () => void);
  expect(handlers.length).toBeGreaterThan(0);
  act(() => handlers.forEach((h) => h()));
}

describe("BpmnModeler", () => {
  beforeEach(() => {
    localStorage.clear();
    hookState.reset();
    modelerState.instances = [];
    modelerState.importFails = false;
    modelerState.saveXmlFails = false;
    modelerState.registryGet = () => null;
    mockApi.reset();
    mockApi.on("get", /\/draft-elements$/, []);
    mockApi.on("patch", /^\/bpm\/processes\/.*\/flow\/versions\/.*$/, {});
    mockApi.on("put", /\/draft-elements\//, {});
  });

  it("loads the given initialXml straight into the modeler, with the Save button disabled (nothing is dirty yet)", async () => {
    renderModeler();
    await waitFor(() => expect(modelerState.instances).toHaveLength(1));
    expect(modelerState.instances[0].importedXml).toBe(DRAFT_XML);
    expect(screen.getByRole("button", { name: /save/i })).toBeDisabled();
  });

  it("marks the document dirty as soon as the modeler reports a commandStack change", async () => {
    renderModeler();
    await waitFor(() => expect(modelerState.instances).toHaveLength(1));
    const modeler = modelerState.instances[0];

    expect(screen.queryByText(/unsaved/i)).not.toBeInTheDocument();
    triggerCommandStackChanged(modeler);
    expect(screen.getByText(/unsaved/i)).toBeInTheDocument();
  });

  it("clicking Save writes the exported XML and SVG, then shows a success snackbar", async () => {
    const user = userEvent.setup();
    renderModeler();
    await waitFor(() => expect(modelerState.instances).toHaveLength(1));
    // Force dirty so the Save button is enabled, same as a real edit would.
    triggerCommandStackChanged(modelerState.instances[0]);

    await user.click(screen.getByRole("button", { name: /save/i }));
    await waitFor(() =>
      expect(
        mockApi.calls.some(
          (c) => c.method === "patch" && (c.body as { bpmn_xml?: string })?.bpmn_xml === modelerState.saveXmlResult.xml,
        ),
      ).toBe(true),
    );
    expect(await screen.findByText(/draft saved/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /save/i })).toBeDisabled();
  });

  it("shows an error snackbar and keeps the dirty flag when the save request fails", async () => {
    mockApi.on("patch", /^\/bpm\/processes\/.*\/flow\/versions\/.*$/, () => {
      throw new Error("boom");
    });
    const user = userEvent.setup();
    renderModeler();
    await waitFor(() => expect(modelerState.instances).toHaveLength(1));
    triggerCommandStackChanged(modelerState.instances[0]);
    await user.click(screen.getByRole("button", { name: /save/i }));
    expect(await screen.findByText(/save failed/i)).toBeInTheDocument();
    // Still dirty: the Save button stays enabled.
    expect(screen.getByRole("button", { name: /save/i })).not.toBeDisabled();
  });

  it("Ctrl+S triggers the same save as clicking the button", async () => {
    renderModeler();
    await waitFor(() => expect(modelerState.instances).toHaveLength(1));
    triggerCommandStackChanged(modelerState.instances[0]);
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "s", ctrlKey: true }));
    });
    await waitFor(() => expect(mockApi.calls.some((c) => c.method === "patch")).toBe(true));
  });

  it("undo/redo/zoom in/out/fit call straight through to the modeler's own commandStack and canvas", async () => {
    const user = userEvent.setup();
    renderModeler();
    await waitFor(() => expect(modelerState.instances).toHaveLength(1));
    const modeler = modelerState.instances[0];
    const commandStack = modeler.get("commandStack") as { undo: ReturnType<typeof vi.fn>; redo: ReturnType<typeof vi.fn> };
    const canvas = modeler.get("canvas") as { zoom: ReturnType<typeof vi.fn> };

    await user.click(screen.getByRole("button", { name: /undo/i }));
    expect(commandStack.undo).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole("button", { name: /redo/i }));
    expect(commandStack.redo).toHaveBeenCalledTimes(1);

    canvas.zoom.mockClear();
    canvas.zoom.mockReturnValueOnce(2); // current zoom level read by zoom-in/out
    await user.click(screen.getByRole("button", { name: /zoom in/i }));
    expect(canvas.zoom).toHaveBeenNthCalledWith(2, 2 * 1.2);

    canvas.zoom.mockClear();
    canvas.zoom.mockReturnValueOnce(2);
    await user.click(screen.getByRole("button", { name: /zoom out/i }));
    expect(canvas.zoom).toHaveBeenNthCalledWith(2, 2 / 1.2);

    canvas.zoom.mockClear();
    await user.click(screen.getByTestId("bpmn-fit-to-screen"));
    expect(canvas.zoom).toHaveBeenCalledWith("fit-viewport");
  });

  it("toggles the properties panel, attaching/detaching on the modeler and persisting the choice", async () => {
    const user = userEvent.setup();
    renderModeler();
    await waitFor(() => expect(modelerState.instances).toHaveLength(1));
    const modeler = modelerState.instances[0];
    const panel = modeler.get("propertiesPanel") as { attachTo: ReturnType<typeof vi.fn>; detach: ReturnType<typeof vi.fn> };
    const toggle = screen.getByTestId("bpmn-toggle-properties");
    expect(toggle).toHaveAttribute("aria-pressed", "true"); // open by default

    await user.click(toggle);
    expect(panel.detach).toHaveBeenCalledTimes(1);
    expect(toggle).toHaveAttribute("aria-pressed", "false");
    expect(localStorage.getItem("turboea.bpmn.propertiesPanel")).toBe("closed");

    await user.click(toggle);
    expect(panel.attachTo).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem("turboea.bpmn.propertiesPanel")).toBe("open");
  });

  it("opens closed when the stored preference says so", async () => {
    localStorage.setItem("turboea.bpmn.propertiesPanel", "closed");
    renderModeler();
    expect(screen.getByTestId("bpmn-toggle-properties")).toHaveAttribute("aria-pressed", "false");
    await waitFor(() => expect(modelerState.instances).toHaveLength(1));
    const modeler = modelerState.instances[0];
    await waitFor(() =>
      expect((modeler.get("propertiesPanel") as { detach: ReturnType<typeof vi.fn> }).detach).toHaveBeenCalled(),
    );
  });

  it("exports BPMN XML as a download with the process id in the filename", async () => {
    const user = userEvent.setup();
    const clickSpy = vi.fn();
    const originalCreateElement = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
      const el = originalCreateElement(tag);
      if (tag === "a") el.click = clickSpy;
      return el;
    });
    const createUrlSpy = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:xml");
    const revokeUrlSpy = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});

    renderModeler();
    await waitFor(() => expect(modelerState.instances).toHaveLength(1));
    await user.click(screen.getByRole("button", { name: /export bpmn/i }));

    await waitFor(() => expect(clickSpy).toHaveBeenCalled());
    expect(createUrlSpy).toHaveBeenCalled();
    expect(revokeUrlSpy).toHaveBeenCalledWith("blob:xml");

    vi.restoreAllMocks();
  });

  it("imports a chosen .bpmn file, re-fitting the canvas and marking the document dirty", async () => {
    renderModeler();
    await waitFor(() => expect(modelerState.instances).toHaveLength(1));
    const modeler = modelerState.instances[0];
    const canvas = modeler.get("canvas") as { zoom: ReturnType<typeof vi.fn> };
    canvas.zoom.mockClear();

    const originalCreateElement = document.createElement.bind(document);
    let capturedInput: HTMLInputElement | undefined;
    const createElementSpy = vi
      .spyOn(document, "createElement")
      .mockImplementation((tag: string) => {
        const el = originalCreateElement(tag);
        if (tag === "input") capturedInput = el as HTMLInputElement;
        return el;
      });

    await act(async () => {
      screen.getByRole("button", { name: /import bpmn/i }).click();
    });
    createElementSpy.mockRestore();
    expect(capturedInput).toBeDefined();

    // jsdom's File has no .text() -- the component only ever calls that one
    // method on the picked file, so a lookalike is simpler than polyfilling it.
    const file = { text: async () => "<bpmn:definitions>imported</bpmn:definitions>" };
    Object.defineProperty(capturedInput!, "files", { value: [file] });
    await act(async () => {
      capturedInput!.dispatchEvent(new Event("change"));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(modeler.importedXml).toContain("imported");
    expect(canvas.zoom).toHaveBeenCalledWith("fit-viewport");
    expect(await screen.findByText(/unsaved/i)).toBeInTheDocument();
  });

  it("shows an import-invalid snackbar when the chosen file fails to parse", async () => {
    renderModeler();
    await waitFor(() => expect(modelerState.instances).toHaveLength(1));
    modelerState.importFails = true;

    const originalCreateElement2 = document.createElement.bind(document);
    let capturedInput: HTMLInputElement | undefined;
    const createElementSpy = vi
      .spyOn(document, "createElement")
      .mockImplementation((tag: string) => {
        const el = originalCreateElement2(tag);
        if (tag === "input") capturedInput = el as HTMLInputElement;
        return el;
      });
    await act(async () => {
      screen.getByRole("button", { name: /import bpmn/i }).click();
    });
    createElementSpy.mockRestore();

    const file = { text: async () => "<bad/>" };
    Object.defineProperty(capturedInput!, "files", { value: [file] });
    await act(async () => {
      capturedInput!.dispatchEvent(new Event("change"));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(await screen.findByText(/not.*valid|invalid/i)).toBeInTheDocument();
  });

  it("shows Draft and Revision chips once a version is known, Unsaved only while dirty", async () => {
    mockApi.on("get", "/bpm/processes/p1/flow/versions/v1", {
      bpmn_xml: DRAFT_XML,
      revision: 3,
    });
    renderModeler({ initialXml: undefined });
    expect(await screen.findByText(/draft/i)).toBeInTheDocument();
    expect(await screen.findByText(/rev 3/i)).toBeInTheDocument();
    expect(screen.queryByText(/unsaved/i)).not.toBeInTheDocument();
  });

  it("falls back to the published flow, then the blank template, when no draft version exists", async () => {
    mockApi.on("get", "/bpm/processes/p1/flow/versions/v1", () => {
      throw new Error("not found");
    });
    mockApi.on("get", "/bpm/processes/p1/flow/published", {
      bpmn_xml: "<bpmn:definitions>published</bpmn:definitions>",
      revision: 7,
    });
    renderModeler({ initialXml: undefined });
    await waitFor(() => expect(modelerState.instances).toHaveLength(1));
    expect(modelerState.instances[0].importedXml).toContain("published");
    expect(await screen.findByText(/rev 7/i)).toBeInTheDocument();
  });

  it("falls all the way back to the hardcoded blank BPMN when every fetch fails", async () => {
    mockApi.on("get", "/bpm/processes/p1/flow/versions/v1", () => {
      throw new Error("not found");
    });
    mockApi.on("get", "/bpm/processes/p1/flow/published", () => {
      throw new Error("not found");
    });
    mockApi.on("get", "/bpm/templates/blank", () => {
      throw new Error("not found");
    });
    renderModeler({ initialXml: undefined });
    await waitFor(() => expect(modelerState.instances).toHaveLength(1));
    expect(modelerState.instances[0].importedXml).toContain("Definitions_1");
  });

  it("shows no Draft chip and the back button only when onBack is given", async () => {
    const onBack = vi.fn();
    const user = userEvent.setup();
    render(<BpmnModeler processId="p1" initialXml={DRAFT_XML} onBack={onBack} />);
    expect(screen.queryByText(/^draft$/i)).not.toBeInTheDocument(); // no versionId => no Draft chip
    const backButtons = screen.getAllByRole("button");
    await user.click(backButtons[0]);
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  describe("card-link picker (bridge opened by the canvas's own context pad)", () => {
    const step = { id: "task1" };

    it("opens the single-card dialog for a non-organization kind, picking writes the link and closes it", async () => {
      const user = userEvent.setup();
      renderModeler();
      await waitFor(() => expect(modelerState.instances).toHaveLength(1));

      act(() => bridgeState.bridge.openPicker(step, "application"));
      expect(screen.getByRole("dialog")).toBeInTheDocument();
      expect(screen.getAllByText(/application/i).length).toBeGreaterThan(0);

      await user.click(screen.getByText("pick-card"));
      await waitFor(() =>
        expect(
          mockApi.calls.some(
            (c) =>
              c.method === "put" &&
              c.path.includes("draft-elements/task1") &&
              (c.body as { application_id?: string }).application_id === "picked-1",
          ),
        ).toBe(true),
      );
      await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    });

    it("reverts the optimistic link and shows an error snackbar when the write fails", async () => {
      mockApi.on("put", /\/draft-elements\//, () => {
        throw new Error("boom");
      });
      const user = userEvent.setup();
      renderModeler();
      await waitFor(() => expect(modelerState.instances).toHaveLength(1));
      act(() => bridgeState.bridge.openPicker(step, "application"));
      await user.click(screen.getByText("pick-card"));
      expect(await screen.findByText(/could not be saved/i)).toBeInTheDocument();
    });

    it("opens the multi-picker for organizations instead of the single-card dialog", async () => {
      const user = userEvent.setup();
      renderModeler();
      await waitFor(() => expect(modelerState.instances).toHaveLength(1));
      act(() => bridgeState.bridge.openPicker(step, "organization"));
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(screen.getByText("pick-organizations")).toBeInTheDocument();

      await user.click(screen.getByText("pick-organizations"));
      await waitFor(() =>
        expect(
          mockApi.calls.some(
            (c) =>
              c.method === "put" &&
              c.path.includes("draft-elements/task1") &&
              (c.body as { organization_ids?: string[] }).organization_ids?.[0] === "org-1",
          ),
        ).toBe(true),
      );
    });

    it("cancelling the dialog closes it without writing anything", async () => {
      const user = userEvent.setup();
      renderModeler();
      await waitFor(() => expect(modelerState.instances).toHaveLength(1));
      act(() => bridgeState.bridge.openPicker(step, "application"));
      await user.click(screen.getByRole("button", { name: /cancel/i }));
      await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
      expect(mockApi.calls.some((c) => c.method === "put")).toBe(false);
    });

    it("clearLink on a process step both clears the BPMN property and writes the draft link as null", async () => {
      renderModeler();
      await waitFor(() => expect(modelerState.instances).toHaveLength(1));
      const modeler = modelerState.instances[0];
      const modeling = modeler.get("modeling") as { updateProperties: ReturnType<typeof vi.fn> };

      act(() => bridgeState.bridge.clearLink(step, "process"));
      // processRefProperties(element, null) -- clearing writes both possible
      // diagram attributes to undefined so neither a call-activity's
      // calledElement nor a plain step's turboea:processRef is left behind.
      expect(modeling.updateProperties).toHaveBeenCalledWith(step, {
        calledElement: undefined,
        "turboea:processRef": undefined,
      });
      await waitFor(() =>
        expect(
          mockApi.calls.some(
            (c) =>
              c.method === "put" &&
              c.path.includes("draft-elements/task1") &&
              (c.body as { business_process_id?: string }).business_process_id === "",
          ),
        ).toBe(true),
      );
    });

    it("clearLink on a non-process kind only writes the draft link, no diagram property touched", async () => {
      renderModeler();
      await waitFor(() => expect(modelerState.instances).toHaveLength(1));
      const modeler = modelerState.instances[0];
      const modeling = modeler.get("modeling") as { updateProperties: ReturnType<typeof vi.fn> };
      modeling.updateProperties.mockClear();

      act(() => bridgeState.bridge.clearLink(step, "data_object"));
      expect(modeling.updateProperties).not.toHaveBeenCalled();
      await waitFor(() =>
        expect(
          mockApi.calls.some(
            (c) => c.method === "put" && (c.body as { data_object_id?: string }).data_object_id === "",
          ),
        ).toBe(true),
      );
    });

    it("openCard navigates to the called-process page for a process link and to the card page for any other kind", async () => {
      renderModeler();
      await waitFor(() => expect(modelerState.instances).toHaveLength(1));
      bridgeState.bridge.openCard("card-1", "process");
      expect(mockNavigate).toHaveBeenCalledWith(expect.stringContaining("card-1"));
      mockNavigate.mockClear();
      bridgeState.bridge.openCard("card-2", "application");
      expect(mockNavigate).toHaveBeenCalledWith("/cards/card-2");
    });
  });

  it("draws one link dot per card type a step is linked to, read from the resolved draft links", async () => {
    mockApi.reset();
    mockApi.on("get", /\/draft-elements$/, [
      {
        bpmn_element_id: "task1",
        application_id: "app-1",
        application_name: "CRM",
      },
    ]);
    mockApi.on("patch", /^\/bpm\/processes\/.*\/flow\/versions\/.*$/, {});
    const shape = { id: "task1" };
    modelerState.registryGet = (id: string) => (id === "task1" ? shape : null);
    renderModeler();
    await waitFor(() => expect(modelerState.instances).toHaveLength(1));
    const modeler = modelerState.instances[0];
    const overlays = modeler.get("overlays") as { add: ReturnType<typeof vi.fn> };

    // loadDraftLinks fires on init and calls refreshLinkDots once resolved.
    await waitFor(() => expect(overlays.add).toHaveBeenCalled());
    const [, , options] = overlays.add.mock.calls[overlays.add.mock.calls.length - 1];
    expect((options as { html: string }).html).toContain("CRM");
  });
});
