import { screen, waitFor, within } from "@testing-library/react";
import { useParams } from "react-router";
import i18n from "@/i18n";
import { mockApi } from "@/test/apiMock";
import { hookState } from "@/test/hooks";
import { renderWithProviders } from "@/test/render";
import ArchimateSandboxPage from "./ArchimateSandboxPage";
import { ARCHIMATE_FORMAT } from "./exchange/exchangeModel";
import { readExchange } from "./exchange/readExchange";

vi.mock("@/api/client", () => import("@/test/apiMock").then((m) => m.apiClientModule()));
vi.mock("@/hooks/useDateFormat", () => import("@/test/hooks").then((m) => m.useDateFormatModule()));

const t = (key: string, opts?: Record<string, unknown>) => i18n.t(`archimate:${key}`, opts) as string;

const ROWS = [
  { id: "d1", name: "Landscape", updated_at: "2026-05-01T12:00:00Z" },
  { id: "d2", name: "Target", updated_at: "2026-06-02T12:00:00Z" },
];

function Editor() {
  return <div>editor:{useParams().id}</div>;
}

function renderPage() {
  return renderWithProviders(<ArchimateSandboxPage />, {
    route: "/admin/archimate",
    routes: [{ path: "/admin/archimate" }, { path: "/admin/archimate/:id", element: <Editor /> }],
  });
}

beforeEach(() => {
  mockApi.reset();
  hookState.reset();
  mockApi.on("get", "/diagrams?kind=archimate", ROWS);
});

describe("ArchimateSandboxPage", () => {
  it("shows the empty state and the trademark notice", async () => {
    mockApi.on("get", "/diagrams?kind=archimate", []);
    renderPage();
    expect(await screen.findByText(t("sandbox.empty"))).toBeInTheDocument();
    expect(screen.getByText(t("trademark"))).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: t("sandbox.title") })).toBeInTheDocument();
  });

  it("lists the diagrams with their update date and an Open link each", async () => {
    renderPage();
    const first = (await screen.findByText("Landscape")).closest("li") as HTMLElement;
    const second = screen.getByText("Target").closest("li") as HTMLElement;
    expect(within(first).getByText(t("sandbox.updated", { date: "2026-05-01" }))).toBeInTheDocument();
    expect(within(first).getByRole("link", { name: t("sandbox.open") })).toHaveAttribute("href", "/admin/archimate/d1");
    expect(within(second).getByRole("link", { name: t("sandbox.open") })).toHaveAttribute("href", "/admin/archimate/d2");
    expect(screen.queryByText(t("sandbox.empty"))).not.toBeInTheDocument();
  });

  it("shows loadFailed and no empty state when the list cannot be loaded", async () => {
    mockApi.fail("get", "/diagrams?kind=archimate", 500);
    renderPage();
    expect(await screen.findByText(t("sandbox.loadFailed"))).toBeInTheDocument();
    expect(screen.queryByText(t("sandbox.empty"))).not.toBeInTheDocument();
  });

  it("posts the exact payload for a new diagram and opens it", async () => {
    mockApi.on("post", "/diagrams", { id: "new1" });
    const { user } = renderPage();
    await screen.findByText("Landscape");
    await user.click(screen.getByRole("button", { name: t("sandbox.newDiagram") }));
    await user.type(screen.getByLabelText(t("sandbox.name")), "  My view  ");
    await user.click(screen.getByRole("button", { name: t("sandbox.create") }));

    expect(await screen.findByText("editor:new1")).toBeInTheDocument();
    const [call] = mockApi.callsOf("post", "/diagrams");
    const body = call.body as { name: string; kind: string; data: { format: string; xml: string } };
    expect(Object.keys(body).sort()).toEqual(["data", "kind", "name"]);
    expect(body.name).toBe("My view");
    expect(body.kind).toBe("archimate");
    expect(Object.keys(body.data).sort()).toEqual(["format", "xml"]);
    expect(body.data.format).toBe(ARCHIMATE_FORMAT);
    const model = readExchange(body.data.xml);
    expect(model.name).toBe("My view");
    expect(model.views.map((v) => v.name)).toEqual(["My view"]);
    expect(model.elements).toEqual([]);
  });

  it("keeps Create disabled for an empty or whitespace-only name", async () => {
    const { user } = renderPage();
    await screen.findByText("Landscape");
    await user.click(screen.getByRole("button", { name: t("sandbox.newDiagram") }));
    const create = screen.getByRole("button", { name: t("sandbox.create") });
    expect(create).toBeDisabled();
    await user.type(screen.getByLabelText(t("sandbox.name")), "   ");
    expect(create).toBeDisabled();
    await user.type(screen.getByLabelText(t("sandbox.name")), "x");
    expect(create).toBeEnabled();
    expect(mockApi.callsOf("post")).toEqual([]);
  });

  it("shows the server's reason and stays on the page when the create is rejected", async () => {
    mockApi.fail("post", "/diagrams", 422, "name already taken");
    const { user } = renderPage();
    await screen.findByText("Landscape");
    await user.click(screen.getByRole("button", { name: t("sandbox.newDiagram") }));
    await user.type(screen.getByLabelText(t("sandbox.name")), "Dup{Enter}");

    expect(await screen.findByText(t("sandbox.createFailed", { reason: "name already taken" }))).toBeInTheDocument();
    expect(screen.queryByText(/^editor:/)).not.toBeInTheDocument();
    // The typed name is kept so the admin can fix it and retry.
    expect(screen.getByLabelText(t("sandbox.name"))).toHaveValue("Dup");
    expect(screen.getByRole("button", { name: t("sandbox.create") })).toBeEnabled();
  });

  it("asks before deleting, then deletes, refreshes the list and confirms", async () => {
    let remaining = [...ROWS];
    mockApi.on("get", "/diagrams?kind=archimate", () => remaining);
    mockApi.on("delete", "/diagrams/d1", () => {
      remaining = remaining.filter((r) => r.id !== "d1");
      return null;
    });
    const { user } = renderPage();
    const row = (await screen.findByText("Landscape")).closest("li") as HTMLElement;
    await user.click(within(row).getByRole("button", { name: t("sandbox.delete") }));

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(t("sandbox.deleteTitle"))).toBeInTheDocument();
    expect(within(dialog).getByText(t("sandbox.deleteBody", { name: "Landscape" }))).toBeInTheDocument();
    expect(mockApi.callsOf("delete")).toEqual([]);

    await user.click(within(dialog).getByRole("button", { name: t("sandbox.delete") }));
    expect(await screen.findByText(t("sandbox.deleted"))).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText("Landscape")).not.toBeInTheDocument());
    expect(screen.getByText("Target")).toBeInTheDocument();
    expect(mockApi.callsOf("delete").map((c) => c.path)).toEqual(["/diagrams/d1"]);
    expect(mockApi.callsOf("get", "/diagrams?kind=archimate")).toHaveLength(2);
  });

  it("does not delete when the confirmation is cancelled", async () => {
    const { user } = renderPage();
    const row = (await screen.findByText("Landscape")).closest("li") as HTMLElement;
    await user.click(within(row).getByRole("button", { name: t("sandbox.delete") }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: i18n.t("common:actions.cancel") }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(mockApi.callsOf("delete")).toEqual([]);
    expect(screen.getByText("Landscape")).toBeInTheDocument();
  });

  it("keeps the confirmation open and shows the error when the delete fails", async () => {
    mockApi.fail("delete", "/diagrams/d2", 500, "database is down");
    const { user } = renderPage();
    const row = (await screen.findByText("Target")).closest("li") as HTMLElement;
    await user.click(within(row).getByRole("button", { name: t("sandbox.delete") }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: t("sandbox.delete") }));

    expect(await within(dialog).findByText("database is down")).toBeInTheDocument();
    expect(screen.queryByText(t("sandbox.deleted"))).not.toBeInTheDocument();
    expect(screen.getByText("Target")).toBeInTheDocument();
  });
});
