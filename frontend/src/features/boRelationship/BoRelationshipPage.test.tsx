import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { vi, it, expect } from "vitest";
import { api } from "@/api/client";
import BoRelationshipPage from "./BoRelationshipPage";

vi.mock("@/api/client", () => ({ api: { get: vi.fn(), put: vi.fn() }, isAbortError: () => false }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("@/components/CardDetailSidePanel", () => ({ default: ({ cardId, open, refreshKey }: { cardId: string; open: boolean; refreshKey: number }) => open ? <div data-testid="card-panel" data-refresh={refreshKey}>{cardId}</div> : null }));
vi.mock("./BoRelationshipDiagram", () => ({ default: ({ nodes, onActivate }: { nodes: { id: string; name: string }[]; onActivate: (id: string) => void }) => <div data-testid="canvas">{nodes.map((node) => <button key={node.id} onClick={() => onActivate(node.id)}>{node.name}</button>)}</div> }));

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
  const graph = { nodes: [{ id: "a", name: "Customer", subtype: "data", isPersonalData: false, isPaymentData: false }], edges: [], positions: {}, applications: { a: { master: null, slaves: [], unclassified: [{ id: "y", name: "ERP" }] } }, capabilities: { can_manage_master: true }, snapshot_revision: null };
  vi.mocked(api.get).mockResolvedValue(graph);
  vi.mocked(api.put).mockResolvedValue({ master: { id: "y", name: "ERP" }, slaves: [], unclassified: [] });
  render(<MemoryRouter><BoRelationshipPage /></MemoryRouter>);
  fireEvent.click(await screen.findByRole("button", { name: "Customer" }));
  fireEvent.click(screen.getByRole("button", { name: "boRelationship.setMaster" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "boRelationship.clearMaster" })).toBeInTheDocument());
  expect(screen.queryByRole("button", { name: "boRelationship.setMaster" })).not.toBeInTheDocument();
});
