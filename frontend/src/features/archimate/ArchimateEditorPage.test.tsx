import { useRef } from "react";
import { screen } from "@testing-library/react";
import { useLocation, useNavigate } from "react-router";
import { renderWithProviders } from "@/test/render";
import ArchimateEditorPage from "./ArchimateEditorPage";

// The editor itself is covered by ArchimateModeler.test.tsx; here only the page's wiring is asserted.
const mounts = vi.hoisted(() => ({ count: 0 }));
vi.mock("./ArchimateModeler", () => ({
  default: ({ diagramId, onBack }: { diagramId: string; onBack?: () => void }) => {
    const instance = useRef<number | null>(null);
    if (instance.current === null) instance.current = ++mounts.count;
    return (
      <div>
        <span>modeler:{diagramId}</span>
        <span>instance:{instance.current}</span>
        <button onClick={onBack}>back</button>
      </div>
    );
  },
}));

function Where() {
  const nav = useNavigate();
  return (
    <>
      <span>at:{useLocation().pathname}</span>
      <button onClick={() => nav("/admin/archimate/d2")}>go-d2</button>
    </>
  );
}

function renderPage() {
  return renderWithProviders(
    <>
      <ArchimateEditorPage />
      <Where />
    </>,
    { route: "/admin/archimate/d1", routes: [{ path: "/admin/archimate/:id" }, { path: "/admin/archimate" }] },
  );
}

beforeEach(() => {
  mounts.count = 0;
});

describe("ArchimateEditorPage", () => {
  it("renders the editor for the route's diagram", () => {
    renderPage();
    expect(screen.getByText("modeler:d1")).toBeInTheDocument();
  });

  it("goes back to the sandbox list", async () => {
    const { user } = renderPage();
    await user.click(screen.getByRole("button", { name: "back" }));
    expect(screen.getByText("at:/admin/archimate")).toBeInTheDocument();
  });

  it("rebuilds the editor when the URL moves to another diagram", async () => {
    const { user } = renderPage();
    expect(screen.getByText("instance:1")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "go-d2" }));
    expect(screen.getByText("modeler:d2")).toBeInTheDocument();
    expect(screen.getByText("instance:2")).toBeInTheDocument();
  });
});
