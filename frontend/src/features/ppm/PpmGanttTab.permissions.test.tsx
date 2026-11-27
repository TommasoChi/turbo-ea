/**
 * The Gantt without write access (`canEdit` false): the bars and rows are
 * shown, but the chart is handed nothing to drag, resize, link or edit.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { TaskOrEmpty } from "@wamra/gantt-task-react";

vi.mock("@/api/client", () => import("@/test/apiMock").then((m) => m.apiClientModule()));

interface GanttProps {
  tasks: TaskOrEmpty[];
  canMoveTasks?: boolean;
  onDoubleClick?: unknown;
  onDateChange?: unknown;
  contextMenuOptions?: unknown[];
}
const gantt: { props: GanttProps | null } = { props: null };
vi.mock("@wamra/gantt-task-react", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...(actual.default as Record<string, unknown>),
    ...actual,
    Gantt: (props: GanttProps) => {
      gantt.props = props;
      return <div data-testid="gantt">{props.tasks.map((t) => t.name).join("|")}</div>;
    },
  };
});

import { mockApi } from "@/test/apiMock";
import PpmGanttTab from "./PpmGanttTab";

const base = "/ppm/initiatives/i1";
const WBS = [{ id: "w1", initiative_id: "i1", parent_id: null, title: "Phase 1", start_date: "2026-01-01", end_date: "2026-02-01", completion: 0, is_milestone: false, sort_order: 0 }];

beforeEach(() => {
  mockApi.reset();
  mockApi.on("get", `${base}/wbs`, WBS);
  mockApi.on("get", `${base}/tasks`, []);
  mockApi.on("get", `${base}/dependencies`, []);
});

describe("PpmGanttTab write access", () => {
  it("offers creating and editing with canEdit", async () => {
    render(<PpmGanttTab initiativeId="i1" canEdit />);
    await screen.findByTestId("gantt");
    expect(screen.getByRole("button", { name: /Add Work Package$/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Add Milestone$/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Create Task$/ })).toBeInTheDocument();
    expect(gantt.props?.canMoveTasks).not.toBe(false);
    expect(gantt.props?.onDoubleClick).toBeTypeOf("function");
    expect(gantt.props?.tasks.some((t) => t.type === "empty")).toBe(true);
  });

  it("hands the chart nothing to edit without canEdit", async () => {
    render(<PpmGanttTab initiativeId="i1" canEdit={false} />);
    await screen.findByTestId("gantt");
    expect(screen.queryByRole("button", { name: /Add Work Package$/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Add Milestone$/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Create Task$/ })).not.toBeInTheDocument();
    const props = gantt.props!;
    expect(props.canMoveTasks).toBe(false);
    expect(props.onDoubleClick).toBeUndefined();
    expect(props.contextMenuOptions).toEqual([]);
    expect(props.tasks.some((t) => t.type === "empty")).toBe(false);
    expect(props.tasks.every((t) => (t as { isDisabled?: boolean }).isDisabled)).toBe(true);
    expect(screen.getByTestId("gantt")).toHaveTextContent("Phase 1");
  });
});
