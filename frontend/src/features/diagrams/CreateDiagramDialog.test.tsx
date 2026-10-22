import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { AuthProvider } from "@/hooks/AuthContext";
import { hookState } from "@/test/hooks";
import type { User } from "@/types";
import CreateDiagramDialog from "./CreateDiagramDialog";

vi.mock("@/api/client", () => ({ api: { get: vi.fn().mockResolvedValue({ items: [] }), post: vi.fn() } }));
vi.mock("@/hooks/useMetamodel", () => import("@/test/hooks").then((m) => m.useMetamodelModule()));
vi.mock("@/hooks/useArchimateEnabled", () =>
  import("@/test/hooks").then((m) => m.useArchimateEnabledModule()),
);

const createDiagram = vi.fn().mockResolvedValue({ id: "new-diagram" });
vi.mock("@/api/diagrams", () => ({
  createDiagram: (...args: unknown[]) => createDiagram(...args),
  listViewpointsForTab: vi.fn().mockResolvedValue([
    { key: "organization", name: "Organization", icon: "account_tree", examples: [] },
  ]),
  getSuggestedCards: vi.fn().mockResolvedValue([]),
  getViewpointExampleXml: vi.fn(),
}));

function renderAs(permissions: Record<string, boolean>) {
  const user = { id: "u", display_name: "U", email: "u@t", role: "member", permissions } as unknown as User;
  render(
    <MemoryRouter>
      <AuthProvider user={user} refreshUser={vi.fn()}>
        <CreateDiagramDialog open onClose={vi.fn()} />
      </AuthProvider>
    </MemoryRouter>,
  );
}

describe("CreateDiagramDialog — ArchiMate kind toggle", () => {
  beforeEach(() => {
    hookState.reset();
    hookState.archimate = { archimateEnabled: true, archimateLoaded: true };
  });

  it("is offered with an ArchiMate manage key on any one layer", () => {
    renderAs({ "diagrams.manage": true, "archimatediagrams.technology.manage": true });
    expect(screen.getByRole("button", { name: /archimate/i })).toBeInTheDocument();
  });

  it("is hidden with only diagrams.* or only a view key", () => {
    renderAs({ "diagrams.manage": true, "archimatediagrams.business.view": true });
    expect(screen.queryByRole("button", { name: /archimate/i })).not.toBeInTheDocument();
  });

  it("is hidden when the ArchiMate module is off", () => {
    hookState.archimate = { archimateEnabled: false, archimateLoaded: true };
    renderAs({ "*": true });
    expect(screen.queryByRole("button", { name: /archimate/i })).not.toBeInTheDocument();
  });
});

describe("CreateDiagramDialog — ArchiMate default name", () => {
  beforeEach(() => {
    hookState.reset();
    hookState.archimate = { archimateEnabled: true, archimateLoaded: true };
    createDiagram.mockClear();
  });

  it("defaults the diagram name to the picked viewpoint's name when left blank", async () => {
    const user = userEvent.setup();
    renderAs({ "diagrams.manage": true, "archimatediagrams.technology.manage": true });

    await user.click(screen.getByRole("button", { name: /archimate/i }));
    await user.click(await screen.findByLabelText(/viewpoint/i));
    await user.click(await screen.findByText("Organization"));
    await user.click(await screen.findByText(/blank/i));

    await waitFor(() => expect(createDiagram).toHaveBeenCalled());
    expect(createDiagram.mock.calls[0][0]).toMatchObject({ name: "Organization" });
  });
});
