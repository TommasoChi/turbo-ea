import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

vi.mock("./MigrationAdmin", () => ({ default: () => <div>migration-admin-panel</div> }));
vi.mock("./WorkspaceTransferAdmin", () => ({
  default: () => <div>workspace-transfer-panel</div>,
}));

import MigrationHub from "./MigrationHub";

describe("MigrationHub", () => {
  it("shows Platform migration as the first tab, selected by default", async () => {
    render(<MigrationHub />);
    expect(screen.getByRole("tab", { name: /platform migration/i })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(await screen.findByText("migration-admin-panel")).toBeInTheDocument();
    expect(screen.queryByText("workspace-transfer-panel")).not.toBeInTheDocument();
  });

  it("switches to Workspace transfer on click, unmounting the first panel", async () => {
    const user = userEvent.setup();
    render(<MigrationHub />);
    await user.click(screen.getByRole("tab", { name: /workspace transfer/i }));
    expect(screen.getByRole("tab", { name: /workspace transfer/i })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(await screen.findByText("workspace-transfer-panel")).toBeInTheDocument();
    expect(screen.queryByText("migration-admin-panel")).not.toBeInTheDocument();
  });

  it("lists exactly the two migration tabs, in order", () => {
    render(<MigrationHub />);
    const tabs = screen.getAllByRole("tab");
    expect(tabs).toHaveLength(2);
    expect(tabs[0]).toHaveAccessibleName(/platform migration/i);
    expect(tabs[1]).toHaveAccessibleName(/workspace transfer/i);
  });
});
