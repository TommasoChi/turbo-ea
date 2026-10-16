import type { ComponentProps } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { mockApi } from "@/test/apiMock";
import CreateCardDialog from "./CreateCardDialog";

vi.mock("@/api/client", () => import("@/test/apiMock").then((m) => m.apiClientModule()));

const TYPES = [{ key: "Application", label: "Application" }, { key: "ITComponent", label: "IT Component" }];

beforeEach(() => mockApi.reset());

function setup(over: Partial<ComponentProps<typeof CreateCardDialog>> = {}) {
  const onCreated = vi.fn();
  const onClose = vi.fn();
  render(<CreateCardDialog open cardTypes={TYPES} initialName="CRM" onCreated={onCreated} onClose={onClose} {...over} />);
  return { onCreated, onClose };
}

describe("CreateCardDialog", () => {
  it("defaults to the first type and prefills the element name", () => {
    setup();
    expect(screen.getByRole("textbox", { name: "Name" })).toHaveValue("CRM");
    expect(screen.getByRole("combobox", { name: "Card type" })).toHaveTextContent("Application");
  });

  it("creates the card with the chosen type and name, then reports it", async () => {
    mockApi.on("post", "/cards", { id: "c9", name: "Billing", type: "ITComponent" });
    const { onCreated } = setup();
    await userEvent.click(screen.getByRole("combobox", { name: "Card type" }));
    await userEvent.click(screen.getByRole("option", { name: "IT Component" }));
    const name = screen.getByRole("textbox", { name: "Name" });
    await userEvent.clear(name);
    await userEvent.type(name, " Billing ");
    await userEvent.click(screen.getByRole("button", { name: "Create and link" }));
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith({ id: "c9", name: "Billing" }));
    expect(mockApi.callsOf("post", "/cards")).toEqual([
      { method: "post", path: "/cards", body: { type: "ITComponent", name: "Billing" } },
    ]);
  });

  it("stays open with the reason and reports nothing when the request fails", async () => {
    mockApi.fail("post", "/cards", 403, "Not allowed");
    const { onCreated, onClose } = setup();
    await userEvent.click(screen.getByRole("button", { name: "Create and link" }));
    expect(await screen.findByText("The card could not be created: Not allowed")).toBeInTheDocument();
    expect(onCreated).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Create and link" })).toBeEnabled();
  });

  it("cannot submit an empty name, and cancel makes no request", async () => {
    const { onClose } = setup({ initialName: "" });
    expect(screen.getByRole("button", { name: "Create and link" })).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(mockApi.calls).toEqual([]);
  });
});
