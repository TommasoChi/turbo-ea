import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AuthProvider } from "@/hooks/AuthContext";
import type { User } from "@/types";
import ViewpointCatalogTabContent from "./ViewpointCatalogTabContent";

vi.mock("@/api/client", () => ({
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
  apiErrorMessage: (e: unknown, fallback: string) => (e instanceof Error ? e.message : fallback),
}));
import { api } from "@/api/client";

const ADMIN_USER = { id: "u1", permissions: { "*": true } } as unknown as User;

/** Renders with a signed-in admin so the per-row action buttons aren't disabled. */
function renderAsAdmin() {
  return render(
    <AuthProvider user={ADMIN_USER} refreshUser={vi.fn()}>
      <ViewpointCatalogTabContent />
    </AuthProvider>,
  );
}

const ORGANIZATION = {
  key: "organization", name: "Organization", icon: "account_tree", layer: "business",
  is_standard: true, is_hidden: false, objects: ["BusinessActor"], domains: ["business"],
};
const LAYERED = {
  key: "layered", name: "Layered", icon: "layers", layer: "other",
  is_standard: true, is_hidden: false, objects: ["BusinessActor", "ApplicationComponent", "Node"],
  domains: ["business", "application", "technology"],
};

describe("ViewpointCatalogTabContent", () => {
  beforeEach(() => {
    vi.mocked(api.get).mockReset().mockResolvedValue([ORGANIZATION]);
    vi.mocked(api.patch).mockReset();
    vi.mocked(api.delete).mockReset();
  });

  it("lists viewpoints with their layer badge and object count", async () => {
    render(<ViewpointCatalogTabContent />);
    expect(await screen.findByText("Organization")).toBeInTheDocument();
    // The layer chip renders the translated layer name (`layers.business` in
    // en/archimate.json is "Business"), not the raw backend value -- same
    // localization every sibling layer `Select` in this feature uses. The
    // domain chip renders the same word for this fixture's domains, hence 2.
    expect(screen.getAllByText("Business")).toHaveLength(2);
  });

  it("shows the viewpoint's domain(s), derived server-side, as a chip per domain", async () => {
    vi.mocked(api.get).mockResolvedValue([ORGANIZATION, LAYERED]);
    render(<ViewpointCatalogTabContent />);
    const orgRow = (await screen.findByText("Organization")).closest("tr")!;
    // "Business" appears twice in this row: the Layer chip and the Domain chip.
    expect(within(orgRow).getAllByText("Business")).toHaveLength(2);
    expect(within(orgRow).queryByText("Application & Data")).toBeNull();
    expect(within(orgRow).queryByText("Technology")).toBeNull();

    const layeredRow = screen.getByText("Layered").closest("tr")!;
    expect(within(layeredRow).getByText("Business")).toBeInTheDocument();
    expect(within(layeredRow).getByText("Application & Data")).toBeInTheDocument();
    expect(within(layeredRow).getByText("Technology")).toBeInTheDocument();
  });

  it("opens the edit dialog for a new Viewpoint from the New Viewpoint button", async () => {
    const user = userEvent.setup();
    render(<ViewpointCatalogTabContent />);
    await screen.findByText("Organization");
    await user.click(screen.getByRole("button", { name: /New Viewpoint/i }));
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
  });

  it("opens the edit dialog for an existing Viewpoint when its name is clicked", async () => {
    const user = userEvent.setup();
    render(<ViewpointCatalogTabContent />);
    await user.click(await screen.findByText("Organization"));
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("Edit Viewpoint");
    expect(within(dialog).getByDisplayValue("Organization")).toBeInTheDocument();
  });

  it("toggles a Viewpoint's hidden state and refetches the list", async () => {
    vi.mocked(api.patch).mockResolvedValue({ ...ORGANIZATION, is_hidden: true });
    const user = userEvent.setup();
    renderAsAdmin();
    await screen.findByText("Organization");
    const callsBefore = vi.mocked(api.get).mock.calls.length;
    await user.click(screen.getByRole("button", { name: /^Hidden$/i }));
    expect(api.patch).toHaveBeenCalledWith("/metamodel/viewpoints/organization", { is_hidden: true });
    await waitFor(() => expect(vi.mocked(api.get).mock.calls.length).toBeGreaterThan(callsBefore));
  });

  it("deletes a Viewpoint after confirmation and refetches the list", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    vi.mocked(api.delete).mockResolvedValue({ status: "deleted", key: "organization" });
    const user = userEvent.setup();
    renderAsAdmin();
    await screen.findByText("Organization");
    const callsBefore = vi.mocked(api.get).mock.calls.length;
    await user.click(screen.getByRole("button", { name: /Delete/i }));
    expect(confirmSpy).toHaveBeenCalled();
    expect(api.delete).toHaveBeenCalledWith("/metamodel/viewpoints/organization");
    await waitFor(() => expect(vi.mocked(api.get).mock.calls.length).toBeGreaterThan(callsBefore));
    confirmSpy.mockRestore();
  });

  it("does nothing when delete is cancelled at the confirm prompt", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    const user = userEvent.setup();
    renderAsAdmin();
    await screen.findByText("Organization");
    await user.click(screen.getByRole("button", { name: /Delete/i }));
    expect(api.delete).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });

  it("shows a dismissable error alert when the delete call fails", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    vi.mocked(api.delete).mockRejectedValue(new Error("cannot delete: in use"));
    const user = userEvent.setup();
    renderAsAdmin();
    await screen.findByText("Organization");
    await user.click(screen.getByRole("button", { name: /Delete/i }));
    expect(await screen.findByText("cannot delete: in use")).toBeInTheDocument();
    confirmSpy.mockRestore();
  });
});
