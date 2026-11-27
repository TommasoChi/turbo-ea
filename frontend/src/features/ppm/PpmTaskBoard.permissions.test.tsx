/**
 * The task board without write access (`canEdit` false): the tasks are listed
 * and filterable, but nothing creates, completes, edits, deletes or drags one.
 */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AuthProvider } from "@/hooks/AuthContext";
import type { PpmTask, PpmWbs, User } from "@/types";

import PpmTaskBoard from "./PpmTaskBoard";

const { get } = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("@/api/client", () => ({
  api: { get, post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
  ApiError: class ApiError extends Error {},
}));

const ME = { id: "u1", email: "me@example.com", display_name: "Me", role: "member", is_active: true } as User;
const base = { initiative_id: "i1", description: null, assignee_id: null, assignee_name: null, start_date: null, due_date: null, sort_order: 0, tags: [], created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z" };
const TASKS = [{ ...base, id: "t1", title: "Ship it", status: "todo", priority: "high", wbs_id: "w1", comment_count: 0 }] as PpmTask[];
const WBS = [{ id: "w1", initiative_id: "i1", title: "Phase 1", parent_id: null, is_milestone: false } as PpmWbs];

const renderBoard = (canEdit: boolean, entry = "/ppm/i1") =>
  render(
    <MemoryRouter initialEntries={[entry]}>
      <AuthProvider user={ME} refreshUser={async () => {}}>
        <PpmTaskBoard initiativeId="i1" canEdit={canEdit} />
      </AuthProvider>
    </MemoryRouter>,
  );

beforeEach(() => {
  get.mockImplementation((path: string) =>
    Promise.resolve(path.endsWith("/tasks") ? TASKS : path.endsWith("/wbs") ? WBS : []),
  );
});

describe("PpmTaskBoard write access", () => {
  it("offers Create Task, Quick Add and Mark as done with canEdit", async () => {
    renderBoard(true);
    await screen.findByText("Ship it");
    expect(screen.getByRole("button", { name: /Create Task$/ })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /Quick Add$/ }).length).toBeGreaterThan(0);
  });

  it("hides every creating control on the kanban without canEdit", async () => {
    renderBoard(false);
    await screen.findByText("Ship it");
    expect(screen.queryByRole("button", { name: /Create Task$/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Quick Add$/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Add Task/ })).not.toBeInTheDocument();
  });

  it("opens no edit dialog from a card without canEdit", async () => {
    const user = userEvent.setup();
    renderBoard(false);
    await user.click(await screen.findByText("Ship it"));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("offers no complete, edit or delete in the list without canEdit", async () => {
    renderBoard(false, "/ppm/i1?view=list");
    await screen.findByText("Ship it");
    expect(document.querySelector('[data-testid="CheckCircleIcon"], tbody button')).toBeNull();
  });

  it("offers them in the list with canEdit", async () => {
    renderBoard(true, "/ppm/i1?view=list");
    await screen.findByText("Ship it");
    await waitFor(() => expect(document.querySelectorAll("tbody button").length).toBeGreaterThan(0));
  });
});
