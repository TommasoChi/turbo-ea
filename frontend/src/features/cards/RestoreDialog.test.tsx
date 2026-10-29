import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import RestoreDialog from "./RestoreDialog";

vi.mock("@/api/client", () => ({
  api: { get: vi.fn(() => Promise.resolve({ passengers: [] })), post: vi.fn() },
}));

describe("RestoreDialog", () => {
  it("shows the card name as text, not as markup", async () => {
    const hostile = '<img src="x" onerror="alert(1)">CRM';
    render(
      <RestoreDialog open cardId="c1" cardName={hostile} onClose={() => {}} onConfirmed={() => {}} />,
    );
    const dialog = await screen.findByRole("dialog");
    await vi.waitFor(() => expect(dialog.querySelector("strong")).not.toBeNull());
    expect(dialog.querySelector("strong")?.textContent).toBe(hostile);
    expect(dialog.querySelector("img")).toBeNull();
  });
});
