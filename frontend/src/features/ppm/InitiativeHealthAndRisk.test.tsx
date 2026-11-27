import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/api/client", () => import("@/test/apiMock").then((m) => m.apiClientModule()));
vi.mock("@/hooks/useDateFormat", () => import("@/test/hooks").then((m) => m.useDateFormatModule()));
vi.mock("./StatusReportDialog", () => ({
  default: ({ initiativeId, report, onSaved, onClose }: { initiativeId: string; report?: unknown; onSaved: () => void; onClose: () => void }) => (
    <div role="dialog" aria-label="report editor" data-initiative={initiativeId} data-edit={String(!!report)}>
      <button onClick={onSaved}>save report</button>
      <button onClick={onClose}>close editor</button>
    </div>
  ),
}));

import { mockApi } from "@/test/apiMock";
import InitiativeHealthAndRisk from "./InitiativeHealthAndRisk";

const BASE = "/ppm/initiatives/i1";

function renderIt(props: Partial<React.ComponentProps<typeof InitiativeHealthAndRisk>> = {}) {
  return render(
    <InitiativeHealthAndRisk initiativeId="i1" revision={0} onManageRisks={() => {}} onChanged={() => {}} {...props} />,
  );
}

beforeEach(() => {
  mockApi.reset();
  mockApi.on("get", BASE + "/reports", [
    { id: "r1", report_date: "2026-03-01", created_at: "x", schedule_health: "onTrack", scope_health: "onTrack", cost_health: null, summary: "Latest words", accomplishments: "", next_steps: "" },
  ]);
  mockApi.on("get", BASE + "/risks", []);
  mockApi.on("get", BASE + "/schedule", { initiative_id: "i1", cost_health: "atRisk" });
});

describe("InitiativeHealthAndRisk", () => {
  it("shows the latest report in Health Summary and the risks in Risk Management", async () => {
    renderIt({ canManage: true });
    expect(await screen.findByText("Latest words")).toBeInTheDocument();
    expect(screen.getByText("Health Summary")).toBeInTheDocument();
    expect(await screen.findByText("Risk Management")).toBeInTheDocument();
    expect(await screen.findByText("No risks yet")).toBeInTheDocument();
  });

  it("opens the report editor in create mode and refreshes the reports after a save", async () => {
    const onChanged = vi.fn();
    renderIt({ canManage: true, onChanged });
    fireEvent.click(await screen.findByRole("button", { name: /manage health summary/i }));
    const dialog = await screen.findByRole("dialog", { name: "report editor" });
    expect(dialog).toHaveAttribute("data-initiative", "i1");
    expect(dialog).toHaveAttribute("data-edit", "false");
    fireEvent.click(screen.getByRole("button", { name: "save report" }));
    expect(onChanged).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("closes the editor without a refresh when it is dismissed", async () => {
    const onChanged = vi.fn();
    renderIt({ canManage: true, onChanged });
    fireEvent.click(await screen.findByRole("button", { name: /manage health summary/i }));
    fireEvent.click(await screen.findByRole("button", { name: "close editor" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(onChanged).not.toHaveBeenCalled();
  });

  it("calls onManageRisks from the Risk Management Manage button", async () => {
    const onManageRisks = vi.fn();
    renderIt({ canManage: true, onManageRisks });
    fireEvent.click(await screen.findByRole("button", { name: /manage risks/i }));
    expect(onManageRisks).toHaveBeenCalledTimes(1);
  });

  it("offers no Manage button without canManage", async () => {
    renderIt({ canManage: false });
    expect(await screen.findByText("Latest words")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /manage/i })).not.toBeInTheDocument();
  });

  it("reads all three again when the revision changes", async () => {
    const view = renderIt();
    await screen.findByText("Latest words");
    const reads = () => mockApi.calls.filter((c) => c.method === "get").length;
    const before = reads();
    view.rerender(<InitiativeHealthAndRisk initiativeId="i1" revision={1} onManageRisks={() => {}} onChanged={() => {}} />);
    await waitFor(() => expect(reads()).toBe(before + 3));
  });
});
