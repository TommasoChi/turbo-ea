import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { vi, it, expect, beforeEach } from "vitest";
import { api } from "@/api/client";
import { useOptionalAuthUser } from "@/hooks/AuthContext";
import type { User } from "@/types";
import BoRelationshipPage from "./BoRelationshipPage";
import type Diagram from "./BoRelationshipDiagram";

vi.mock("@/api/client", () => ({ api: { get: vi.fn(), put: vi.fn(), delete: vi.fn() }, isAbortError: () => false }));
vi.mock("@/hooks/AuthContext", () => ({ useOptionalAuthUser: vi.fn() }));
vi.mock("@/hooks/useMetamodel", () => ({
  useMetamodel: () => ({
    types: [{ key: "DataObject", subtypes: [{ key: "Data", label: "Custom Data" }] }],
    getType: () => undefined,
  }),
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, string>) => [key, ...Object.values(values ?? {})].join(" "),
    i18n: { language: "en" },
  }),
}));
vi.mock("@/components/CardDetailSidePanel", () => ({
  default: ({ cardId, open, refreshKey, onSaved }: {
    cardId: string; open: boolean; refreshKey: number; onSaved: () => void;
  }) => open ? (
    <div data-testid="card-panel" data-refresh={refreshKey}>
      {cardId}
      <button onClick={onSaved}>Refetch from card panel</button>
    </div>
  ) : null,
}));
vi.mock("./BoRelationshipDiagram", () => ({
  default: ({
    nodes, edges, positions, onActivate, onMove, onRequestRemoveEdge,
  }: React.ComponentProps<typeof Diagram>) => (
    <div data-testid="canvas" data-edges={edges.map((edge) => edge.id).join(",")} data-positions={JSON.stringify(positions)}>
      {nodes.map((node) => <button key={node.id} onClick={() => onActivate(node.id)}>{node.name}</button>)}
      {nodes[0] && onMove && <button onClick={() => onMove(nodes[0].id, { x: 96, y: 48 })}>Move first BO</button>}
      {onRequestRemoveEdge && edges.map((edge) => (
        <button key={edge.id} onClick={() => onRequestRemoveEdge(edge.id)}>Remove line {edge.source}</button>
      ))}
    </div>
  ),
}));

function signInAsEditor() {
  vi.mocked(useOptionalAuthUser).mockReturnValue({ permissions: { "*": true } } as User);
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(useOptionalAuthUser).mockReturnValue(null);
});

it("opens the chosen card alongside the canvas and shows its own application groups", async () => {
  vi.mocked(api.get).mockResolvedValue({ nodes: [{ id: "a", name: "Customer", subtype: "Data", isPersonalData: true, isPaymentData: false }, { id: "b", name: "Order", subtype: "Document", isPersonalData: false, isPaymentData: false }], edges: [], positions: {}, applications: { a: { master: { id: "x", name: "CRM" }, slaves: [], unclassified: [] }, b: { master: null, slaves: [], unclassified: [{ id: "y", name: "ERP" }] } }, capabilities: { can_manage_master: false }, snapshot_revision: null });
  render(<MemoryRouter><BoRelationshipPage /></MemoryRouter>);
  fireEvent.click(await screen.findByRole("button", { name: "Customer" }));
  expect(screen.getByTestId("card-panel")).toHaveTextContent("a");
  expect(screen.getByTestId("canvas")).toBeInTheDocument();
  expect(screen.getByText("CRM")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Order" }));
  expect(screen.getByTestId("card-panel")).toHaveTextContent("b");
  expect(screen.getByText("ERP")).toBeInTheDocument();
  expect(screen.queryByText("CRM")).not.toBeInTheDocument();
});

it("updates or clears the master and refreshes both panels", async () => {
  signInAsEditor();
  const graph = { nodes: [{ id: "a", name: "Customer", subtype: "data", isPersonalData: false, isPaymentData: false }], edges: [], positions: {}, applications: { a: { master: { id: "x", name: "CRM" }, slaves: [{ id: "y", name: "ERP" }], unclassified: [] } }, capabilities: { can_manage_master: true }, snapshot_revision: null };
  vi.mocked(api.get).mockResolvedValue(graph);
  vi.mocked(api.put)
    .mockResolvedValueOnce({ master: { id: "y", name: "ERP" }, slaves: [{ id: "x", name: "CRM" }], unclassified: [] })
    .mockResolvedValueOnce({ master: null, slaves: [], unclassified: [{ id: "x", name: "CRM" }, { id: "y", name: "ERP" }] });
  render(<MemoryRouter><BoRelationshipPage /></MemoryRouter>);
  fireEvent.click(await screen.findByRole("button", { name: "Customer" }));
  fireEvent.click(screen.getByRole("button", { name: "boRelationship.setMaster" }));
  await waitFor(() => expect(api.put).toHaveBeenCalledWith("/bo-relationship/objects/a/master", { application_id: "y" }));
  await waitFor(() => expect(vi.mocked(api.get).mock.calls.filter(([path]) => path === "/bo-relationship").length).toBeGreaterThan(1));
  expect(screen.getByTestId("card-panel")).toHaveAttribute("data-refresh", "1");
  fireEvent.click(screen.getByRole("button", { name: "boRelationship.clearMaster" }));
  await waitFor(() => expect(api.put).toHaveBeenCalledWith("/bo-relationship/objects/a/master", { application_id: null }));
  await waitFor(() => expect(screen.queryByRole("button", { name: "boRelationship.clearMaster" })).not.toBeInTheDocument());
});

it("shows an isolated object with empty groups and no master controls for viewers", async () => {
  vi.mocked(api.get).mockResolvedValue({ nodes: [{ id: "z", name: "Isolated", subtype: null, isPersonalData: false, isPaymentData: false }], edges: [], positions: {}, applications: {}, capabilities: { can_manage_master: false }, snapshot_revision: null });
  render(<MemoryRouter><BoRelationshipPage /></MemoryRouter>);
  fireEvent.click(await screen.findByRole("button", { name: "Isolated" }));
  expect(screen.getByText("boRelationship.master")).toBeInTheDocument();
  expect(screen.getByText("boRelationship.slave")).toBeInTheDocument();
  expect(screen.getByText("boRelationship.unclassified")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "boRelationship.setMaster" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "boRelationship.clearMaster" })).not.toBeInTheDocument();
});

it("shows the live master returned by the mutation even if the saved graph is older", async () => {
  signInAsEditor();
  const graph = { nodes: [{ id: "a", name: "Customer", subtype: "data", isPersonalData: false, isPaymentData: false }], edges: [], positions: {}, applications: { a: { master: null, slaves: [], unclassified: [{ id: "y", name: "ERP" }] } }, capabilities: { can_manage_master: true }, snapshot_revision: null };
  vi.mocked(api.get).mockResolvedValue(graph);
  vi.mocked(api.put).mockResolvedValue({ master: { id: "y", name: "ERP" }, slaves: [], unclassified: [] });
  render(<MemoryRouter><BoRelationshipPage /></MemoryRouter>);
  fireEvent.click(await screen.findByRole("button", { name: "Customer" }));
  fireEvent.click(screen.getByRole("button", { name: "boRelationship.setMaster" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "boRelationship.clearMaster" })).toBeInTheDocument());
  expect(screen.queryByRole("button", { name: "boRelationship.setMaster" })).not.toBeInTheDocument();
});


it("filters nodes and incident edges with AND while retaining positions and clearing hidden selection", async () => {
  vi.mocked(api.get).mockResolvedValue({
    nodes: [
      { id: "a", name: "Personal", subtype: null, isPersonalData: true, isPaymentData: false },
      { id: "b", name: "Payment", subtype: null, isPersonalData: false, isPaymentData: true },
      { id: "c", name: "Both", subtype: null, isPersonalData: true, isPaymentData: true },
    ],
    edges: [{ id: "ab", source: "a", target: "b", cardinality: null }, { id: "bc", source: "b", target: "c", cardinality: null }],
    positions: { a: { x: 10, y: 20 }, b: { x: 30, y: 40 }, c: { x: 50, y: 60 } },
    applications: {}, capabilities: { can_manage_master: false }, snapshot_revision: null,
  });
  render(<MemoryRouter><BoRelationshipPage /></MemoryRouter>);
  fireEvent.click(await screen.findByRole("button", { name: "Personal" }));
  const originalPositions = screen.getByTestId("canvas").getAttribute("data-positions");
  fireEvent.click(screen.getByRole("button", { name: /boRelationship.filters/ }));
  fireEvent.click(screen.getByRole("checkbox", { name: "boRelationship.paymentData" }));
  expect(screen.queryByRole("button", { name: "Personal" })).not.toBeInTheDocument();
  expect(screen.queryByTestId("card-panel")).not.toBeInTheDocument();
  expect(screen.getByTestId("canvas")).toHaveAttribute("data-edges", "bc");
  expect(screen.getByTestId("canvas")).toHaveAttribute("data-positions", originalPositions);
  fireEvent.click(screen.getByRole("checkbox", { name: "boRelationship.personalData" }));
  expect(screen.queryByRole("button", { name: "Payment" })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Both" })).toBeInTheDocument();
  expect(screen.getByTestId("canvas")).toHaveAttribute("data-edges", "");
  fireEvent.click(screen.getByRole("checkbox", { name: "boRelationship.paymentData" }));
  expect(screen.getByRole("button", { name: "Personal" })).toBeInTheDocument();
  expect(screen.queryByTestId("card-panel")).not.toBeInTheDocument();
});

it("keeps filters active when collapsed and shows an empty result without unmounting the canvas", async () => {
  vi.mocked(api.get).mockResolvedValue({
    nodes: [{ id: "a", name: "Personal", subtype: null, isPersonalData: true, isPaymentData: false }],
    edges: [], positions: {}, applications: {}, capabilities: { can_manage_master: false }, snapshot_revision: null,
  });
  render(<MemoryRouter><BoRelationshipPage /></MemoryRouter>);
  await screen.findByRole("button", { name: "Personal" });
  const filters = screen.getByRole("button", { name: /boRelationship.filters/ });
  fireEvent.click(filters);
  expect(filters).toHaveAttribute("aria-expanded", "true");
  fireEvent.click(screen.getByRole("checkbox", { name: "boRelationship.paymentData" }));
  expect(screen.getByText("boRelationship.noFilterResults")).toBeInTheDocument();
  expect(screen.getByTestId("canvas")).toBeInTheDocument();
  fireEvent.keyDown(filters, { key: " " });
  expect(filters).toHaveAttribute("aria-expanded", "false");
  expect(screen.queryByRole("button", { name: "Personal" })).not.toBeInTheDocument();
  fireEvent.keyDown(filters, { key: "Enter" });
  expect(screen.getByRole("checkbox", { checked: true })).toBeInTheDocument();
});

const customer = { id: "a", name: "Customer", subtype: "Data", isPersonalData: false, isPaymentData: false };
const order = { ...customer, id: "b", name: "Order" };
const orderEdge = { id: "ab", source: "a", target: "b", cardinality: null };
const baseGraph = {
  nodes: [customer],
  edges: [],
  positions: { a: { x: 10, y: 20 } },
  applications: {},
  capabilities: { can_manage_master: true },
  snapshot_revision: "rev-1",
};

function openPage() {
  render(<MemoryRouter><BoRelationshipPage /></MemoryRouter>);
  return screen.findByRole("button", { name: "Customer" });
}

async function stageOrderAndLink() {
  const customerButton = await openPage();
  fireEvent.click(screen.getByRole("button", { name: "boRelationship.newObject" }));
  let dialog = screen.getByRole("dialog");
  fireEvent.change(within(dialog).getByLabelText("boRelationship.objectName"), { target: { value: "Order" } });
  const stage = within(dialog).getByRole("button", { name: "boRelationship.stageObject" });
  expect(stage).toBeDisabled();
  fireEvent.change(within(dialog).getByLabelText("boRelationship.subtype"), { target: { value: "Data" } });
  fireEvent.click(stage);
  fireEvent.click(customerButton);
  fireEvent.click(screen.getByRole("button", { name: "boRelationship.linkObjects" }));
  dialog = screen.getByRole("dialog");
  const target = within(dialog).getByLabelText("boRelationship.targetObject");
  const orderOption = within(target).getByRole("option", { name: "Order" }) as HTMLOptionElement;
  fireEvent.change(target, { target: { value: orderOption.value } });
  fireEvent.click(within(dialog).getByRole("button", { name: "boRelationship.stageLink" }));
}

it("keeps a saved BO and retries only its failed link with the same draft ID", async () => {
  signInAsEditor();
  vi.mocked(api.get).mockResolvedValue(baseGraph);
  let linkFailed = false;
  let linkSaved = false;
  vi.mocked(api.put).mockImplementation(async (path) => {
    if (path.startsWith("/bo-relationship/objects/")) return order;
    if (path.startsWith("/bo-relationship/relation-drafts/")) {
      if (!linkFailed) {
        linkFailed = true;
        throw new Error("Link unavailable");
      }
      linkSaved = true;
      return orderEdge;
    }
    return { ...baseGraph, nodes: [customer, order], edges: linkSaved ? [orderEdge] : [] };
  });

  await stageOrderAndLink();
  expect(api.put).not.toHaveBeenCalled();
  const save = screen.getByRole("button", { name: "common:actions.save" });
  fireEvent.click(save);
  expect(await screen.findByText(/Link unavailable/)).toBeInTheDocument();
  const [object, failedLink, firstLayout] = vi.mocked(api.put).mock.calls;
  expect(object).toEqual([expect.stringMatching(/^\/bo-relationship\/objects\/[0-9a-f-]{36}$/), {
    name: "Order", subtype: "Data", isPersonalData: false, isPaymentData: false,
  }]);
  expect(failedLink).toEqual([expect.stringMatching(/^\/bo-relationship\/relation-drafts\/[0-9a-f-]{36}$/), {
    source_id: "a", target_id: "b",
  }]);
  expect(firstLayout).toEqual(["/bo-relationship/layout", expect.objectContaining({
    saved_drafts: [{ kind: "node", id: object[0].split("/").at(-1) }],
  })]);
  expect(screen.getByRole("button", { name: "Order" })).toBeInTheDocument();
  fireEvent.click(save);
  await waitFor(() => expect(screen.getByTestId("canvas")).toHaveAttribute("data-edges", "ab"));
  expect(vi.mocked(api.put).mock.calls.slice(3)).toEqual([
    failedLink,
    ["/bo-relationship/layout", expect.objectContaining({
      saved_drafts: [{ kind: "edge", id: failedLink[0].split("/").at(-1) }],
    })],
  ]);
});

it("retries a lost object response with the same UUID even without crypto.randomUUID", async () => {
  signInAsEditor();
  vi.mocked(api.get).mockResolvedValue(baseGraph);
  vi.mocked(api.put)
    .mockRejectedValueOnce(new Error("Response lost"))
    .mockResolvedValueOnce(order)
    .mockResolvedValueOnce(orderEdge)
    .mockResolvedValueOnce({ ...baseGraph, nodes: [customer, order], edges: [orderEdge] });
  vi.stubGlobal("crypto", { getRandomValues: crypto.getRandomValues.bind(crypto) });
  try {
    await stageOrderAndLink();
    const save = screen.getByRole("button", { name: "common:actions.save" });
    fireEvent.click(save);
    expect(await screen.findByText(/Response lost/)).toBeInTheDocument();
    expect(api.put).toHaveBeenCalledTimes(1);
    const [url] = vi.mocked(api.put).mock.calls[0];
    expect(url).toMatch(/\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    fireEvent.click(save);
    await waitFor(() => expect(screen.getByTestId("canvas")).toHaveAttribute("data-edges", "ab"));
    expect(vi.mocked(api.put).mock.calls[1]).toEqual(vi.mocked(api.put).mock.calls[0]);
  } finally {
    vi.unstubAllGlobals();
  }
});

it("retains failed position writes for the next Save", async () => {
  signInAsEditor();
  vi.mocked(api.get).mockResolvedValue(baseGraph);
  vi.mocked(api.put)
    .mockRejectedValueOnce(new Error("Positions unavailable"))
    .mockResolvedValueOnce({ ...baseGraph, positions: { a: { x: 96, y: 48 } } });
  await openPage();
  fireEvent.click(screen.getByRole("button", { name: "Move first BO" }));
  const save = screen.getByRole("button", { name: "common:actions.save" });
  fireEvent.click(save);
  expect(await screen.findByText(/Positions unavailable/)).toBeInTheDocument();
  expect(screen.getByTestId("canvas")).toHaveAttribute("data-positions", JSON.stringify({ a: { x: 96, y: 48 } }));
  fireEvent.click(save);
  await waitFor(() => expect(api.put).toHaveBeenCalledTimes(2));
  expect(vi.mocked(api.put).mock.calls[1]).toEqual(vi.mocked(api.put).mock.calls[0]);
  expect(api.put).toHaveBeenCalledWith("/bo-relationship/layout", expect.objectContaining({
    positions: { a: { x: 96, y: 48 } },
  }));
});

it("applies a newer scoped graph read after showing the committed layout response", async () => {
  signInAsEditor();
  const graph = { ...baseGraph, nodes: [customer, order], edges: [orderEdge] };
  const positions = { a: { x: 96, y: 48 }, b: { x: 400, y: 30 } };
  let graphReads = 0;
  vi.mocked(api.get).mockImplementation(async (path) => path === "/bo-relationship/changes"
    ? { changes: [] } : ++graphReads === 1 ? graph : { ...baseGraph, positions });
  vi.mocked(api.put).mockResolvedValue({ ...graph, positions });
  fireEvent.click(await openPage());
  fireEvent.click(screen.getByRole("button", { name: "Move first BO" }));
  const save = screen.getByRole("button", { name: "common:actions.save" });
  fireEvent.click(save);
  await waitFor(() => expect(screen.getByRole("button", { name: "Move first BO" })).toBeEnabled());
  expect(screen.getByTestId("canvas")).toHaveAttribute("data-positions", JSON.stringify(positions));
  fireEvent.click(screen.getByRole("button", { name: "Refetch from card panel" }));
  await waitFor(() => expect(screen.queryByRole("button", { name: "Order" })).not.toBeInTheDocument());
  expect(screen.getByTestId("canvas")).toHaveAttribute("data-edges", "");
});

it("retries a failed layout Save without recreating the successful BO and ER link", async () => {
  signInAsEditor();
  vi.mocked(api.get).mockResolvedValue(baseGraph);
  vi.mocked(api.put)
    .mockResolvedValueOnce(order)
    .mockResolvedValueOnce(orderEdge)
    .mockRejectedValueOnce(new Error("Layout unavailable"))
    .mockResolvedValueOnce({
      ...baseGraph, nodes: [customer, order], edges: [orderEdge],
      positions: { ...baseGraph.positions, b: { x: 400, y: 30 } },
    });
  await stageOrderAndLink();
  const save = screen.getByRole("button", { name: "common:actions.save" });
  fireEvent.click(save);
  expect(await screen.findByText("Layout unavailable")).toBeInTheDocument();
  expect(screen.getByTestId("canvas")).toHaveAttribute("data-edges", "ab");
  fireEvent.click(save);
  await waitFor(() => expect(screen.queryByText("Layout unavailable")).not.toBeInTheDocument());
  expect(save).toBeDisabled();
  const calls = vi.mocked(api.put).mock.calls;
  expect(calls).toHaveLength(4);
  expect(calls[3]).toEqual(calls[2]);
});

it("drops a successful BO draft and its dependent link when the layout reports the BO unavailable", async () => {
  signInAsEditor();
  vi.mocked(api.get).mockResolvedValue(baseGraph);
  vi.mocked(api.put).mockImplementation(async (path, body) => {
    if (path.startsWith("/bo-relationship/objects/")) return order;
    if (path.startsWith("/bo-relationship/relation-drafts/")) throw new Error("BO unavailable");
    return {
      ...baseGraph,
      unavailable_drafts: (body as { saved_drafts: unknown[] }).saved_drafts,
    };
  });
  await stageOrderAndLink();
  const save = screen.getByRole("button", { name: "common:actions.save" });
  fireEvent.click(save);
  expect(await screen.findByText("boRelationship.draftUnavailable")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Order" })).not.toBeInTheDocument();
  expect(screen.getByTestId("canvas")).toHaveAttribute("data-edges", "");
  expect(save).toBeDisabled();
});

it("discards a staged line locally without prompting or writing to inventory", async () => {
  signInAsEditor();
  vi.mocked(api.get).mockResolvedValue(baseGraph);
  await stageOrderAndLink();
  fireEvent.click(screen.getByRole("button", { name: "Remove line a" }));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(screen.getByTestId("canvas")).toHaveAttribute("data-edges", "");
  expect(screen.getByRole("button", { name: "Order" })).toBeInTheDocument();
  expect(api.put).not.toHaveBeenCalled();
  expect(api.delete).not.toHaveBeenCalled();
});

it("saves a visual removal and retries inventory deletion only through Sync", async () => {
  signInAsEditor();
  const graph = { ...baseGraph, nodes: [customer, order], edges: [orderEdge] };
  vi.mocked(api.get).mockResolvedValue(graph);
  vi.mocked(api.put).mockResolvedValue({ ...graph, edges: [] });
  vi.mocked(api.delete).mockRejectedValueOnce(new Error("Delete response lost")).mockResolvedValueOnce(undefined);
  await openPage();
  const remove = screen.getByRole("button", { name: "Remove line a" });
  fireEvent.click(remove);
  const dialog = screen.getByRole("dialog");
  expect(dialog).toHaveTextContent("Customer");
  expect(dialog).toHaveTextContent("Order");
  fireEvent.click(within(dialog).getByRole("button", { name: "boRelationship.keepLine" }));
  expect(screen.getByTestId("canvas")).toHaveAttribute("data-edges", "ab");
  fireEvent.click(remove);
  fireEvent.click(screen.getByRole("button", { name: "boRelationship.queueRemoval" }));
  expect(screen.getByTestId("canvas")).toHaveAttribute("data-edges", "");
  fireEvent.click(screen.getByRole("button", { name: "boRelationship.cancelRemoval" }));
  expect(screen.getByTestId("canvas")).toHaveAttribute("data-edges", "ab");
  fireEvent.click(screen.getByRole("button", { name: "Remove line a" }));
  fireEvent.click(screen.getByRole("button", { name: "boRelationship.queueRemoval" }));
  fireEvent.click(screen.getByRole("button", { name: "common:actions.save" }));
  await waitFor(() => expect(api.put).toHaveBeenCalledWith("/bo-relationship/layout", expect.objectContaining({
    removed_relation_ids: ["ab"],
  })));
  expect(api.delete).not.toHaveBeenCalled();
  await waitFor(() => expect(screen.getByRole("button", { name: "boRelationship.syncAll" })).toBeEnabled());
  fireEvent.click(screen.getByRole("button", { name: "boRelationship.syncAll" }));
  expect(await screen.findByText(/Delete response lost/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "boRelationship.syncRemoval" }));
  await waitFor(() => expect(screen.queryByRole("button", { name: "boRelationship.cancelRemoval" })).not.toBeInTheDocument());
  expect(vi.mocked(api.delete).mock.calls).toEqual([
    ["/bo-relationship/relations/ab"], ["/bo-relationship/relations/ab"],
  ]);
  expect(screen.getByTestId("canvas")).toHaveAttribute("data-edges", "");
});

it("restores a queued line after a visual Save when its removal is cancelled", async () => {
  signInAsEditor();
  const graph = { ...baseGraph, nodes: [customer, order], edges: [orderEdge] };
  const savedGraph = { ...graph, edges: [], positions: { ...graph.positions, b: { x: 400, y: 30 } } };
  vi.mocked(api.get).mockResolvedValue(graph);
  vi.mocked(api.put).mockResolvedValueOnce(savedGraph).mockResolvedValueOnce(graph);
  await openPage();
  fireEvent.click(screen.getByRole("button", { name: "Remove line a" }));
  fireEvent.click(screen.getByRole("button", { name: "boRelationship.queueRemoval" }));
  const save = screen.getByRole("button", { name: "common:actions.save" });
  fireEvent.click(save);
  const cancel = screen.getByRole("button", { name: "boRelationship.cancelRemoval" });
  await waitFor(() => expect(cancel).toBeEnabled());
  expect(save).toBeDisabled();
  fireEvent.click(cancel);
  expect(screen.getByTestId("canvas")).toHaveAttribute("data-edges", "ab");
  fireEvent.click(save);
  await waitFor(() => expect(api.put).toHaveBeenNthCalledWith(2, "/bo-relationship/layout", expect.objectContaining({
    restored_relation_ids: ["ab"],
    removed_relation_ids: [],
  })));
  expect(api.delete).not.toHaveBeenCalled();
});

it("reopens the saved drawing with an empty inventory deletion queue", async () => {
  signInAsEditor();
  const graph = { ...baseGraph, nodes: [customer, order], edges: [orderEdge] };
  const savedGraph = { ...graph, edges: [], positions: { ...graph.positions, b: { x: 400, y: 30 } } };
  let graphReads = 0;
  vi.mocked(api.get).mockImplementation(async (path) => path === "/bo-relationship/changes"
    ? { changes: [] } : ++graphReads === 1 ? graph : savedGraph);
  vi.mocked(api.put).mockResolvedValue(savedGraph);
  const page = render(<MemoryRouter><BoRelationshipPage /></MemoryRouter>);
  fireEvent.click(await screen.findByRole("button", { name: "Remove line a" }));
  fireEvent.click(screen.getByRole("button", { name: "boRelationship.queueRemoval" }));
  fireEvent.click(screen.getByRole("button", { name: "common:actions.save" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "boRelationship.syncAll" })).toBeEnabled());
  page.unmount();
  await openPage();
  expect(screen.getByTestId("canvas")).toHaveAttribute("data-edges", "");
  expect(screen.queryByRole("button", { name: "boRelationship.syncAll" })).not.toBeInTheDocument();
  expect(api.delete).not.toHaveBeenCalled();
});

it("saves an unrelated move when a queued visual removal is no longer available", async () => {
  signInAsEditor();
  const graph = { ...baseGraph, nodes: [customer, order], edges: [orderEdge] };
  const positions = { a: { x: 96, y: 48 }, b: { x: 400, y: 30 } };
  vi.mocked(api.get).mockResolvedValue(graph);
  vi.mocked(api.put).mockResolvedValue({
    ...graph, edges: [], positions, inventory_conflicts: [{ kind: "edge", id: "ab" }],
  });
  await openPage();
  fireEvent.click(screen.getByRole("button", { name: "Move first BO" }));
  fireEvent.click(screen.getByRole("button", { name: "Remove line a" }));
  fireEvent.click(screen.getByRole("button", { name: "boRelationship.queueRemoval" }));
  const save = screen.getByRole("button", { name: "common:actions.save" });
  fireEvent.click(save);
  expect(await screen.findByText("boRelationship.visualChangeUnavailable")).toBeInTheDocument();
  expect(api.put).toHaveBeenCalledWith("/bo-relationship/layout", expect.objectContaining({
    skip_unavailable_relations: true,
    removed_relation_ids: ["ab"],
    positions: { a: { x: 96, y: 48 } },
  }));
  expect(screen.getByTestId("canvas")).toHaveAttribute("data-positions", JSON.stringify(positions));
  expect(save).toBeDisabled();
  expect(screen.getByRole("button", { name: "boRelationship.syncRemoval" })).toBeEnabled();
  expect(api.delete).not.toHaveBeenCalled();
});

it("omits drawing actions for viewers", async () => {
  vi.mocked(api.get).mockResolvedValue({ ...baseGraph, nodes: [customer, order], edges: [orderEdge] });
  fireEvent.click(await openPage());
  expect(screen.queryByRole("button", { name: "common:actions.save" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "boRelationship.newObject" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "boRelationship.linkObjects" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "boRelationship.linkApplication" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Remove line a" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Move first BO" })).not.toBeInTheDocument();
});

const crm = { id: "crm", name: "CRM" };
const erp = { id: "erp", name: "ERP" };

async function stageApplication(name: string, role: "master" | "slave" | "unclassified") {
  fireEvent.click(screen.getByRole("button", { name: "boRelationship.linkApplication" }));
  const dialog = screen.getByRole("dialog");
  fireEvent.focus(within(dialog).getByRole("combobox", { name: "boRelationship.application" }));
  fireEvent.click(await screen.findByRole("option", { name }));
  fireEvent.change(within(dialog).getByLabelText("boRelationship.role"), { target: { value: role } });
  fireEvent.click(within(dialog).getByRole("button", { name: "boRelationship.stageLink" }));
}

it("keeps a Slave pending until the staged Master saves, using the module-scoped picker", async () => {
  signInAsEditor();
  vi.mocked(api.get).mockImplementation(async (path) => path.startsWith("/bo-relationship/applications?")
    ? { items: [crm, erp], total: 2 }
    : baseGraph);
  vi.mocked(api.put)
    .mockRejectedValueOnce(new Error("Master unavailable"))
    .mockResolvedValueOnce({ id: "ac", object_id: "a", application: crm, is_master: true })
    .mockResolvedValueOnce({ id: "ae", object_id: "a", application: erp, is_master: false })
    .mockResolvedValueOnce({ ...baseGraph, applications: { a: { master: crm, slaves: [erp], unclassified: [] } } });
  fireEvent.click(await openPage());
  await stageApplication("CRM", "master");
  await stageApplication("ERP", "slave");
  expect(vi.mocked(api.get).mock.calls.some(([path]) => path.startsWith("/bo-relationship/applications?"))).toBe(true);
  expect(vi.mocked(api.get).mock.calls.some(([path]) => path.startsWith("/cards?"))).toBe(false);
  expect(api.put).not.toHaveBeenCalled();
  const save = screen.getByRole("button", { name: "common:actions.save" });
  fireEvent.click(save);
  expect(await screen.findByText(/Master unavailable/)).toBeInTheDocument();
  expect(screen.getByText(/boRelationship.waitingForMaster/)).toHaveTextContent("ERP");
  expect(api.put).toHaveBeenCalledTimes(1);
  expect(api.put).toHaveBeenNthCalledWith(1, expect.stringMatching(/^\/bo-relationship\/application-link-drafts\//), {
    object_id: "a", application_id: "crm", role: "master",
  });
  fireEvent.click(save);
  await waitFor(() => expect(screen.getByRole("link", { name: "CRM" })).toBeInTheDocument());
  expect(vi.mocked(api.put).mock.calls[1]).toEqual(vi.mocked(api.put).mock.calls[0]);
  expect(api.put).toHaveBeenNthCalledWith(3, expect.stringMatching(/^\/bo-relationship\/application-link-drafts\//), {
    object_id: "a", application_id: "erp", role: "slave",
  });
});

it("offers Unclassified and omits Master when the BO capability is denied", async () => {
  signInAsEditor();
  vi.mocked(api.get).mockImplementation(async (path) => path.startsWith("/bo-relationship/applications?")
    ? { items: [crm], total: 1 }
    : { ...baseGraph, capabilities: { can_manage_master: false } });
  fireEvent.click(await openPage());
  fireEvent.click(screen.getByRole("button", { name: "boRelationship.linkApplication" }));
  const role = screen.getByLabelText("boRelationship.role");
  expect(within(role).getByRole("option", { name: "boRelationship.unclassified" })).toBeInTheDocument();
  expect(within(role).queryByRole("option", { name: "boRelationship.master" })).not.toBeInTheDocument();
  expect(within(role).queryByRole("option", { name: "boRelationship.slave" })).not.toBeInTheDocument();
});

it("applies an inventory update locally without moving the BO and shares it only on Save", async () => {
  signInAsEditor();
  const updated = { ...customer, name: "Client", subtype: "Document" };
  const change = { kind: "node", id: "a", revision: "a".repeat(64), change: "updated", before: customer, after: updated };
  vi.mocked(api.get).mockImplementation(async (path) => path === "/bo-relationship/changes" ? { changes: [change] } : baseGraph);
  vi.mocked(api.put).mockResolvedValue({ ...baseGraph, nodes: [updated], inventory_conflicts: [], unavailable_drafts: [] });
  await openPage();
  expect(await screen.findByText(/Client ·/)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Customer" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "boRelationship.acceptChange" }));
  expect(screen.getByRole("button", { name: "Client" })).toBeInTheDocument();
  expect(screen.getByTestId("canvas")).toHaveAttribute("data-positions", JSON.stringify(baseGraph.positions));
  expect(api.put).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "common:actions.save" }));
  await waitFor(() => expect(api.put).toHaveBeenCalledWith("/bo-relationship/layout", expect.objectContaining({
    accepted_inventory_changes: [{ kind: "node", id: "a", revision: "a".repeat(64) }],
    positions: {},
  })));
});


it("shows inventory changes to viewers without allowing synchronization", async () => {
  const updated = { ...customer, name: "Client" };
  vi.mocked(api.get).mockImplementation(async (path) => path === "/bo-relationship/changes"
    ? { changes: [{ kind: "node", id: "a", revision: "a".repeat(64), change: "updated", before: customer, after: updated }] }
    : baseGraph);
  await openPage();
  expect(await screen.findByText(/Client ·/)).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "boRelationship.acceptChange" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "common:actions.save" })).not.toBeInTheDocument();
});

it("keeps the drawing and its positions usable if the inventory comparison fails", async () => {
  signInAsEditor();
  vi.mocked(api.get).mockImplementation(async (path) => {
    if (path === "/bo-relationship/changes") throw new Error("Inventory unavailable");
    return baseGraph;
  });
  await openPage();
  expect(await screen.findByText(/Inventory unavailable/)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Customer" })).toBeInTheDocument();
  expect(screen.getByTestId("canvas")).toHaveAttribute("data-positions", JSON.stringify(baseGraph.positions));
  expect(screen.getByRole("button", { name: "boRelationship.checkUpdates" })).toBeEnabled();
});

it("requests a fresh comparison when an accepted inventory revision conflicts", async () => {
  signInAsEditor();
  const updated = { ...customer, name: "Client" };
  const change = { kind: "node", id: "a", revision: "a".repeat(64), change: "updated", before: customer, after: updated };
  vi.mocked(api.get).mockImplementation(async (path) => path === "/bo-relationship/changes" ? { changes: [change] } : baseGraph);
  vi.mocked(api.put).mockResolvedValue({ ...baseGraph, inventory_conflicts: [{ kind: "node", id: "a" }], unavailable_drafts: [] });
  await openPage();
  fireEvent.click(await screen.findByRole("button", { name: "boRelationship.acceptChange" }));
  fireEvent.click(screen.getByRole("button", { name: "common:actions.save" }));
  expect(await screen.findByText("boRelationship.inventoryConflict")).toBeInTheDocument();
  await waitFor(() => expect(vi.mocked(api.get).mock.calls.filter(([path]) => path === "/bo-relationship/changes")).toHaveLength(2));
  expect(screen.getByRole("button", { name: "Customer" })).toBeInTheDocument();
});

it("syncs an application ownership change into the local groups", async () => {
  signInAsEditor();
  const crm = { id: "crm", name: "CRM" };
  const erp = { id: "erp", name: "ERP" };
  const graph = { ...baseGraph, applications: { a: { master: crm, slaves: [erp], unclassified: [] } } };
  const before = { id: "link", object_id: "a", application: crm, is_master: true };
  const change = { kind: "application_link", id: "link", revision: "b".repeat(64), change: "updated", before, after: { ...before, is_master: false } };
  vi.mocked(api.get).mockImplementation(async (path) => path === "/bo-relationship/changes" ? { changes: [change] } : graph);
  fireEvent.click(await openPage());
  fireEvent.click(await screen.findByRole("button", { name: "boRelationship.acceptChange" }));
  const groups = screen.getByText("boRelationship.unclassified").parentElement!;
  expect(within(groups).getByText("CRM")).toBeInTheDocument();
  expect(within(groups).getByText("ERP")).toBeInTheDocument();
  expect(api.put).not.toHaveBeenCalled();
});

it("ignores a superseded inventory comparison even when its request resolves last", async () => {
  signInAsEditor();
  let resolveFirst!: (value: unknown) => void;
  const first = new Promise((resolve) => { resolveFirst = resolve; });
  let checks = 0;
  const stale = { kind: "node", id: "a", revision: "a".repeat(64), change: "updated", before: customer, after: { ...customer, name: "Stale" } };
  const fresh = { ...stale, revision: "b".repeat(64), after: { ...customer, name: "Fresh" } };
  vi.mocked(api.get).mockImplementation(async (path) => {
    if (path !== "/bo-relationship/changes") return baseGraph;
    return ++checks === 1 ? first : { changes: [fresh] };
  });
  fireEvent.click(await openPage());
  fireEvent.click(screen.getByRole("button", { name: "Refetch from card panel" }));
  expect(await screen.findByText(/Fresh ·/)).toBeInTheDocument();
  resolveFirst({ changes: [stale] });
  await waitFor(() => expect(screen.queryByText(/Stale ·/)).not.toBeInTheDocument());
  expect(screen.getByText(/Fresh ·/)).toBeInTheDocument();
});

it("keeps queued outgoing removals distinct from incoming changes after a visual Save", async () => {
  signInAsEditor();
  const graph = { ...baseGraph, nodes: [customer, order], edges: [orderEdge] };
  const change = { kind: "edge", id: "ab", revision: "a".repeat(64), change: "added", before: null, after: orderEdge };
  vi.mocked(api.get).mockImplementation(async (path) => path === "/bo-relationship/changes" ? { changes: [change] } : graph);
  vi.mocked(api.put).mockResolvedValue({ ...graph, edges: [], inventory_conflicts: [], unavailable_drafts: [] });
  await openPage();
  fireEvent.click(screen.getByRole("button", { name: "Remove line a" }));
  fireEvent.click(screen.getByRole("button", { name: "boRelationship.queueRemoval" }));
  fireEvent.click(screen.getByRole("button", { name: "common:actions.save" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "boRelationship.syncRemoval" })).toBeEnabled());
  expect(screen.queryByRole("button", { name: "boRelationship.acceptChange" })).not.toBeInTheDocument();
  expect(screen.getByTestId("canvas")).toHaveAttribute("data-edges", "");
  expect(api.delete).not.toHaveBeenCalled();
});

it("keeps the previous master as a slave when syncing a promotion", async () => {
  signInAsEditor();
  const crm = { id: "crm", name: "CRM" };
  const erp = { id: "erp", name: "ERP" };
  const graph = { ...baseGraph, applications: { a: { master: crm, slaves: [erp], unclassified: [] } } };
  const before = { id: "link", object_id: "a", application: erp, is_master: false };
  const change = { kind: "application_link", id: "link", revision: "b".repeat(64), change: "updated", before, after: { ...before, is_master: true } };
  vi.mocked(api.get).mockImplementation(async (path) => path === "/bo-relationship/changes" ? { changes: [change] } : graph);
  fireEvent.click(await openPage());
  fireEvent.click(await screen.findByRole("button", { name: "boRelationship.acceptChange" }));
  expect(within(screen.getByText("boRelationship.master").parentElement!).getByText("ERP")).toBeInTheDocument();
  expect(within(screen.getByText("boRelationship.slave").parentElement!).getByText("CRM")).toBeInTheDocument();
});

it.each([true, false])("retains a manual move after a conflicting removal only if the node is visible (%s)", async (visible) => {
  signInAsEditor();
  const removal = { kind: "node", id: "a", revision: "a".repeat(64), change: "removed", before: customer, after: null };
  vi.mocked(api.get).mockImplementation(async (path) => path === "/bo-relationship/changes" ? { changes: [removal] } : baseGraph);
  vi.mocked(api.put).mockResolvedValue({
    ...baseGraph,
    nodes: visible ? baseGraph.nodes : [],
    positions: visible ? baseGraph.positions : {},
    inventory_conflicts: [{ kind: "node", id: "a" }],
    unavailable_drafts: [],
  });
  await openPage();
  fireEvent.click(screen.getByRole("button", { name: "Move first BO" }));
  fireEvent.click(await screen.findByRole("button", { name: "boRelationship.acceptChange" }));
  fireEvent.click(screen.getByRole("button", { name: "common:actions.save" }));
  expect(await screen.findByText("boRelationship.inventoryConflict")).toBeInTheDocument();
  expect(screen.getByTestId("canvas")).toHaveAttribute("data-positions", JSON.stringify(visible ? { a: { x: 96, y: 48 } } : {}));
  const save = screen.getByRole("button", { name: "common:actions.save" });
  if (visible) expect(save).toBeEnabled();
  else expect(save).toBeDisabled();
});
