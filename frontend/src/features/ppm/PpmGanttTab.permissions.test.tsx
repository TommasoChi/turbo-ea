/**
 * The Gantt without write access (`canEdit` false): the bars and rows are
 * shown, but the chart is handed nothing to drag, resize, link or edit.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, within } from "@testing-library/react";
import type { TaskOrEmpty } from "@wamra/gantt-task-react";

vi.mock("@/api/client", () => import("@/test/apiMock").then((m) => m.apiClientModule()));

interface GanttProps {
  tasks: TaskOrEmpty[];
  canMoveTasks?: boolean;
  onDoubleClick?: (task: TaskOrEmpty) => void;
  onDateChange?: unknown;
  contextMenuOptions?: unknown[];
  onProgressChange?: unknown;
  onRelationChange?: unknown;
  onMoveTaskBefore?: (target: TaskOrEmpty, moved: TaskOrEmpty) => Promise<void>;
  onMoveTaskAfter?: unknown;
  onMoveTaskInside?: unknown;
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
const TASKS = [{ id: "t1", initiative_id: "i1", wbs_id: "w1", title: "Ship it", description: "Why it matters", status: "todo", priority: "high", assignee_id: null, assignee_name: null, start_date: "2026-01-05", due_date: "2026-01-10", sort_order: 0, tags: [], comment_count: 0, created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z" }];

beforeEach(() => {
  mockApi.reset();
  mockApi.on("get", `${base}/wbs`, WBS);
  mockApi.on("get", `${base}/tasks`, TASKS);
  mockApi.on("get", "/users*", []);
  mockApi.on("get", /\/comments$/, []);
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
    for (const h of ["onDateChange", "onProgressChange", "onRelationChange", "onMoveTaskBefore", "onMoveTaskAfter", "onMoveTaskInside"] as const) {
      expect(gantt.props?.[h], h).toBeTypeOf("function");
    }
  });

  it("hands the chart nothing to edit without canEdit", async () => {
    render(<PpmGanttTab initiativeId="i1" canEdit={false} />);
    await screen.findByTestId("gantt");
    expect(screen.queryByRole("button", { name: /Add Work Package$/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Add Milestone$/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Create Task$/ })).not.toBeInTheDocument();
    const props = gantt.props!;
    expect(props.canMoveTasks).toBe(false);
    expect(props.onDoubleClick).toBeTypeOf("function");
    expect(props.contextMenuOptions).toEqual([]);
    for (const h of ["onDateChange", "onProgressChange", "onRelationChange", "onMoveTaskBefore", "onMoveTaskAfter", "onMoveTaskInside"] as const) {
      expect(props[h], h).toBeUndefined();
    }
    expect(props.tasks.some((t) => t.type === "empty")).toBe(false);
    expect(props.tasks.every((t) => (t as { isDisabled?: boolean }).isDisabled)).toBe(true);
    expect(screen.getByTestId("gantt")).toHaveTextContent("Phase 1");
  });

  it("opens a task read-only on double-click without canEdit, editable with it", async () => {
    const open = async (canEdit: boolean) => {
      render(<PpmGanttTab initiativeId="i1" canEdit={canEdit} />);
      await screen.findByTestId("gantt");
      const task = gantt.props!.tasks.find((t) => t.id === "task-t1")!;
      act(() => gantt.props!.onDoubleClick!(task));
      return screen.findByRole("dialog");
    };
    let dialog = await open(false);
    expect(within(dialog).getByLabelText("Description")).toHaveValue("Why it matters");
    expect(within(dialog).getByLabelText("Description")).toBeDisabled();
    expect(within(dialog).queryByRole("button", { name: /^Save$/ })).not.toBeInTheDocument();
    cleanup();
    dialog = await open(true);
    expect(within(dialog).getByLabelText("Description")).toBeEnabled();
    expect(within(dialog).getByRole("button", { name: /^Save$/ })).toBeInTheDocument();
  });
});
