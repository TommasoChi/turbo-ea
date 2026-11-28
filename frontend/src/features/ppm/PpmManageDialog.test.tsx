/**
 * PpmManageDialog — it opens only for a reader who may manage the tab, so the
 * tab it shows is always editable.
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Card } from "@/types";

vi.mock("@/api/client", () => import("@/test/apiMock").then((m) => m.apiClientModule()));
const stub = (name: string) => ({
  default: (p: { canEdit?: boolean }) => <div data-testid={name}>{String(p.canEdit)}</div>,
});
vi.mock("./PpmCostTab", () => stub("cost"));
vi.mock("./PpmGanttTab", () => stub("gantt"));
vi.mock("./PpmRiskTab", () => ({
  default: (p: {
    initiativeId: string;
    risks: { id: string }[];
    canEdit: boolean;
    initiativeName?: string;
    onRefresh: () => void;
  }) => (
    <button type="button" data-testid="risks" onClick={p.onRefresh}>
      {`${p.initiativeId}|${p.risks.map((r) => r.id).join(",")}|${p.canEdit}|${p.initiativeName}`}
    </button>
  ),
}));

import { mockApi } from "@/test/apiMock";
import PpmManageDialog from "./PpmManageDialog";

const CARD = { id: "i1", type: "Initiative", name: "ERP" } as unknown as Card;

beforeEach(() => {
  mockApi.reset();
  mockApi.on("get", "/ppm/initiatives/i1/rollup", null);
  mockApi.on("get", "/ppm/initiatives/i1/risks", [{ id: "r1" }, { id: "r2" }]);
});

describe("PpmManageDialog", () => {
  it.each([
    ["cost", "cost"],
    ["gantt", "gantt"],
  ] as const)("hands the %s tab canEdit", async (tab, id) => {
    render(<PpmManageDialog card={CARD} tab={tab} onClose={vi.fn()} onChanged={vi.fn()} />);
    expect(await screen.findByTestId(id)).toHaveTextContent("true");
  });

  it("the risks tab fetches the risks and renders the risk tab", async () => {
    render(<PpmManageDialog card={CARD} tab="risks" onClose={vi.fn()} onChanged={vi.fn()} />);
    expect(await screen.findByTestId("risks")).toHaveTextContent("i1|r1,r2|true|ERP");
    expect(screen.getByRole("heading", { name: "Risk Management" })).toBeInTheDocument();
    expect(mockApi.callsOf("get", "/ppm/initiatives/i1/rollup")).toHaveLength(0);
  });

  it("a failed risks request shows the error and no risk tab", async () => {
    mockApi.fail("get", "/ppm/initiatives/i1/risks", 500);
    render(<PpmManageDialog card={CARD} tab="risks" onClose={vi.fn()} onChanged={vi.fn()} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("GET /ppm/initiatives/i1/risks failed");
    expect(screen.queryByTestId("risks")).not.toBeInTheDocument();
  });

  it("while the risks load it shows a spinner and no risk tab", async () => {
    mockApi.on("get", "/ppm/initiatives/i1/risks", () => new Promise(() => {}));
    render(<PpmManageDialog card={CARD} tab="risks" onClose={vi.fn()} onChanged={vi.fn()} />);
    expect(await screen.findByRole("progressbar")).toBeInTheDocument();
    expect(screen.queryByTestId("risks")).not.toBeInTheDocument();
  });

  it("refreshing a risk refetches and calls onChanged", async () => {
    const onChanged = vi.fn();
    render(<PpmManageDialog card={CARD} tab="risks" onClose={vi.fn()} onChanged={onChanged} />);
    const btn = await screen.findByTestId("risks");
    const calls = () => mockApi.callsOf("get", "/ppm/initiatives/i1/risks").length;
    expect(calls()).toBe(1);
    fireEvent.click(btn);
    expect(onChanged).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(calls()).toBe(2));
  });
});
