import { describe, test, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import NewArchitectureObjectDialog from "./NewArchitectureObjectDialog";

vi.mock("@/api/enterpriseObjects", () => ({
  createEnterpriseObject: vi.fn(),
}));

import { createEnterpriseObject } from "@/api/enterpriseObjects";

describe("NewArchitectureObjectDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(createEnterpriseObject).mockResolvedValue({
      key: "AIModel",
      name: "AI Model",
      description: "",
      icon: "category",
      color: "#1976d2",
      layer: "strategy",
      is_standard: false,
      is_locked: false,
      is_hidden: false,
      sort_order: 0,
      card_mappings: [],
    });
  });

  test("creating a custom object posts the form and closes on success", async () => {
    const onCreated = vi.fn();
    const onClose = vi.fn();
    render(<NewArchitectureObjectDialog open onClose={onClose} onCreated={onCreated} />);

    await userEvent.type(screen.getByLabelText("Key"), "AIModel");
    await userEvent.type(screen.getByLabelText("Name"), "AI Model");
    await userEvent.click(screen.getByRole("button", { name: "Create" }));

    expect(createEnterpriseObject).toHaveBeenCalledWith(
      expect.objectContaining({ key: "AIModel", name: "AI Model" }),
    );
    expect(onCreated).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  test("create button is disabled until key and name are valid", () => {
    render(<NewArchitectureObjectDialog open onClose={vi.fn()} onCreated={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Create" })).toBeDisabled();
  });

  test("create button stays disabled with an invalid key even once name is filled", async () => {
    render(<NewArchitectureObjectDialog open onClose={vi.fn()} onCreated={vi.fn()} />);

    await userEvent.type(screen.getByLabelText("Name"), "Bad Key Object");
    // KeyInput auto-strips invalid characters, so type a key starting with a
    // digit directly via the underlying input to exercise `isValidKey`'s
    // rejection path rather than the coercion path.
    const keyInput = screen.getByLabelText("Key") as HTMLInputElement;
    await userEvent.type(keyInput, "1bad");

    expect(screen.getByRole("button", { name: "Create" })).toBeDisabled();
  });

  test("defaults the layer select to a standard layer, never Other", () => {
    render(<NewArchitectureObjectDialog open onClose={vi.fn()} onCreated={vi.fn()} />);
    expect(screen.queryByText("Other")).not.toBeInTheDocument();
  });

  test("cancel closes without creating", async () => {
    const onClose = vi.fn();
    render(<NewArchitectureObjectDialog open onClose={onClose} onCreated={vi.fn()} />);

    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(onClose).toHaveBeenCalled();
    expect(createEnterpriseObject).not.toHaveBeenCalled();
  });
});
