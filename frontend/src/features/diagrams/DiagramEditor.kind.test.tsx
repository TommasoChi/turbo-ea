import { screen, waitFor } from "@testing-library/react";
import i18n from "@/i18n";
import { mockApi } from "@/test/apiMock";
import { hookState } from "@/test/hooks";
import { renderWithProviders } from "@/test/render";
import DiagramEditor from "./DiagramEditor";

vi.mock("@/api/client", () => import("@/test/apiMock").then((m) => m.apiClientModule()));
vi.mock("@/hooks/useMetamodel", () => import("@/test/hooks").then((m) => m.useMetamodelModule()));

const t = (key: string) => i18n.t(`diagrams:${key}`) as string;

const render = () =>
  renderWithProviders(<DiagramEditor />, {
    route: "/diagrams/d1/edit",
    routes: [{ path: "/diagrams/:id/edit" }],
  });

beforeEach(() => {
  mockApi.reset();
  hookState.reset();
  localStorage.clear();
});

describe("DiagramEditor — diagram kind", () => {
  it("treats an ArchiMate diagram opened by URL as unavailable: no DrawIO frame, the not-found text", async () => {
    mockApi.on("get", "/diagrams/d1", {
      id: "d1",
      kind: "archimate",
      name: "Landscape (ArchiMate)",
      type: "free",
      data: { format: "archimate-exchange-3.1", xml: "<model/>" },
    });
    render();
    expect(await screen.findByText(t("editor.notFound"))).toBeInTheDocument();
    expect(document.querySelector("iframe")).toBeNull();
    expect(screen.queryByText("Landscape (ArchiMate)")).not.toBeInTheDocument();
  });

  it("opens a DrawIO diagram (kind drawio, or no kind at all) in the DrawIO frame", async () => {
    mockApi.lenient([]);
    mockApi.on("get", "/diagrams/d1", { id: "d1", name: "Classic", type: "free", data: { xml: "<mxGraphModel/>" } });
    render();
    await waitFor(() => expect(document.querySelector("iframe")).not.toBeNull());
    expect(screen.queryByText(t("editor.notFound"))).not.toBeInTheDocument();
  });
});
