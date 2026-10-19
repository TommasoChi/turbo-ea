/**
 * GovernanceTab — the GRC page's "EA Governance" tab, which hosts Principles,
 * Decisions and (while PPM is off) EA Delivery as sub-tabs.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import GovernanceTab from "./GovernanceTab";

vi.mock("@/hooks/usePpmEnabled", () => ({ usePpmEnabled: vi.fn() }));
vi.mock("./PrinciplesPanel", () => ({ default: () => <div>principles panel</div> }));
vi.mock("./DecisionsPanel", () => ({ default: () => <div>decisions panel</div> }));
vi.mock("@/features/reports/EaDeliveryReport", () => ({ default: () => <div>delivery panel</div> }));

import { usePpmEnabled } from "@/hooks/usePpmEnabled";

function renderTab() {
  return render(
    <MemoryRouter initialEntries={["/grc?tab=governance"]}>
      <GovernanceTab />
    </MemoryRouter>,
  );
}

describe("GovernanceTab", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.mocked(usePpmEnabled).mockReturnValue({
      ppmEnabled: false,
      ppmLoaded: true,
      invalidatePpm: vi.fn(),
    });
  });

  it("lands on Principles by default and shows Decisions then EA Delivery after it, while PPM is off", async () => {
    renderTab();
    expect(await screen.findByText("principles panel")).toBeInTheDocument();
    // Each tab's accessible name is its icon's ligature text plus its label
    // (MaterialSymbol renders the icon name as real text content), so match
    // on the label substring rather than full-string equality.
    const tabs = screen.getAllByRole("tab").map((t) => t.textContent);
    expect(tabs?.[0]).toContain("Principles");
    expect(tabs?.[1]).toContain("Decisions");
    expect(tabs?.[2]).toContain("EA Delivery");
    expect(tabs).toHaveLength(3);
  });

  it("clicking the EA Delivery sub-tab renders EaDeliveryReport", async () => {
    const user = userEvent.setup();
    renderTab();
    await screen.findByText("principles panel");

    await user.click(screen.getByRole("tab", { name: /EA Delivery/ }));
    expect(await screen.findByText("delivery panel")).toBeInTheDocument();
  });

  it("hides the EA Delivery sub-tab once PPM is on -- it stays a tab of PPM instead", async () => {
    vi.mocked(usePpmEnabled).mockReturnValue({
      ppmEnabled: true,
      ppmLoaded: true,
      invalidatePpm: vi.fn(),
    });
    renderTab();
    await screen.findByText("principles panel");

    const tabs = screen.getAllByRole("tab").map((t) => t.textContent);
    expect(tabs?.[0]).toContain("Principles");
    expect(tabs?.[1]).toContain("Decisions");
    expect(tabs).toHaveLength(2);
  });

  it("a stored EA Delivery sub-tab falls back to Principles once PPM turns on, instead of rendering a dead tab", async () => {
    localStorage.setItem("turboea.grc.governance.sub", "delivery");
    vi.mocked(usePpmEnabled).mockReturnValue({
      ppmEnabled: true,
      ppmLoaded: true,
      invalidatePpm: vi.fn(),
    });
    renderTab();

    expect(await screen.findByText("principles panel")).toBeInTheDocument();
    expect(screen.queryByText("delivery panel")).not.toBeInTheDocument();
  });

  it("remembers the EA Delivery sub-tab across visits while PPM stays off", async () => {
    const user = userEvent.setup();
    renderTab();
    await screen.findByText("principles panel");
    await user.click(screen.getByRole("tab", { name: /EA Delivery/ }));
    await screen.findByText("delivery panel");

    await waitFor(() =>
      expect(localStorage.getItem("turboea.grc.governance.sub")).toBe("delivery"),
    );
  });
});
