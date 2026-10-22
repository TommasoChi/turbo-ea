import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ScopedArchimateDiagramPage from "./ScopedArchimateDiagramPage";

const mockNavigate = vi.fn();
vi.mock("react-router", async () => {
  const actual = await vi.importActual("react-router");
  return { ...actual, useNavigate: () => mockNavigate };
});
vi.mock("@/api/client", () => ({ api: { get: vi.fn(), post: vi.fn() } }));
import { api } from "@/api/client";

describe("ScopedArchimateDiagramPage", () => {
  beforeEach(() => {
    mockNavigate.mockClear();
    vi.mocked(api.get).mockReset();
    vi.mocked(api.post).mockReset();
    vi.mocked(api.get).mockImplementation((url: string) => {
      if (url.includes("viewpoints-for-tab?tab=business")) {
        return Promise.resolve([
          { key: "business-process", name: "Business Process Cooperation", icon: "route", examples: [] },
        ]);
      }
      return Promise.resolve([]);
    });
    vi.mocked(api.post).mockResolvedValue({ id: "new-diagram-1", name: "x", kind: "archimate", card_ids: [] });
  });

  it("requires a name, then creates the diagram and navigates to the editor on the fixed tab's viewpoints", async () => {
    const user = userEvent.setup();
    render(<ScopedArchimateDiagramPage tab="business" />);

    expect(screen.getByText(/enter a name/i)).toBeInTheDocument();

    await user.type(screen.getByLabelText(/name/i), "My Business Diagram");
    await user.click(await screen.findByRole("combobox"));
    await user.click(await screen.findByRole("option", { name: "Business Process Cooperation" }));
    await user.click(await screen.findByText(/blank/i));

    expect(api.post).toHaveBeenCalledWith(
      "/diagrams",
      expect.objectContaining({ name: "My Business Diagram", kind: "archimate", viewpoint_key: "business-process" }),
    );
    expect(mockNavigate).toHaveBeenCalledWith("/admin/architectureStudio/new-diagram-1", expect.anything());
  });

  it("shows exampleLoadFailed and does not create a diagram when the example XML can't be fetched", async () => {
    vi.mocked(api.get).mockImplementation((url: string) => {
      if (url.includes("viewpoints-for-tab?tab=business")) {
        return Promise.resolve([
          {
            key: "business-process",
            name: "Business Process Cooperation",
            icon: "route",
            examples: [{ id: "ex1", name: "Starter" }],
          },
        ]);
      }
      if (url.includes("/examples/ex1")) return Promise.reject(new Error("boom"));
      return Promise.resolve([]);
    });
    const user = userEvent.setup();
    render(<ScopedArchimateDiagramPage tab="business" />);

    await user.type(screen.getByLabelText(/name/i), "My Business Diagram");
    await user.click(await screen.findByRole("combobox"));
    await user.click(await screen.findByRole("option", { name: "Business Process Cooperation" }));
    await user.click(await screen.findByText("Starter"));

    expect(
      await screen.findByText("Couldn't load that example. Try again, or start from Blank."),
    ).toBeInTheDocument();
    expect(api.post).not.toHaveBeenCalled();
  });

  it("shows the backend's error message and stays usable when the create call fails", async () => {
    vi.mocked(api.post).mockRejectedValue(new Error("server exploded"));
    const user = userEvent.setup();
    render(<ScopedArchimateDiagramPage tab="business" />);

    await user.type(screen.getByLabelText(/name/i), "My Business Diagram");
    await user.click(await screen.findByRole("combobox"));
    await user.click(await screen.findByRole("option", { name: "Business Process Cooperation" }));
    await user.click(await screen.findByText(/blank/i));

    expect(await screen.findByText("server exploded")).toBeInTheDocument();
    expect(mockNavigate).not.toHaveBeenCalled();
  });
});
