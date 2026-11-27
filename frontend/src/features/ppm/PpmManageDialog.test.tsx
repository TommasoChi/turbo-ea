/**
 * PpmManageDialog — it opens only for a reader who may manage the tab, so the
 * tab it shows is always editable.
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
    render(<PpmManageDialog card={CARD} tab={tab} onClose={vi.fn()} onChanged={vi.fn()} />);
    expect(await screen.findByTestId(id)).toHaveTextContent("true");
  });
});
