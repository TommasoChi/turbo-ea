/**
 * PpmManageDialog — the tab it opens gets the right to write that the opener
 * decided: the cost tab its own, the reports and Gantt tabs theirs.
 */
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Card } from "@/types";

vi.mock("@/api/client", () => import("@/test/apiMock").then((m) => m.apiClientModule()));
const stub = (name: string) => ({
  default: (p: { canEdit?: boolean }) => <div data-testid={name}>{String(p.canEdit)}</div>,
});
vi.mock("./PpmCostTab", () => stub("cost"));
vi.mock("./PpmGanttTab", () => stub("gantt"));
vi.mock("./PpmReportsTab", () => stub("reports"));

import { mockApi } from "@/test/apiMock";
import PpmManageDialog from "./PpmManageDialog";

const CARD = { id: "i1", type: "Initiative", name: "ERP" } as unknown as Card;

beforeEach(() => {
  mockApi.reset();
  mockApi.on("get", "/ppm/initiatives/i1/rollup", null);
  mockApi.on("get", "/ppm/initiatives/i1/reports", []);
});

describe("PpmManageDialog", () => {
  it.each([
    ["cost", "cost"],
    ["gantt", "gantt"],
    ["reports", "reports"],
  ] as const)("hands the %s tab canEdit", async (tab, id) => {
    render(<PpmManageDialog card={CARD} tab={tab} canEdit onClose={vi.fn()} onChanged={vi.fn()} />);
    expect(await screen.findByTestId(id)).toHaveTextContent("true");
  });

  it("hands the tab canEdit false when the opener says so", async () => {
    render(<PpmManageDialog card={CARD} tab="gantt" canEdit={false} onClose={vi.fn()} onChanged={vi.fn()} />);
    expect(await screen.findByTestId("gantt")).toHaveTextContent("false");
  });
});
