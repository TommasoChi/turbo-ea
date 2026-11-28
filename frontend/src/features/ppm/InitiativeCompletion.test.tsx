import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/api/client", () => import("@/test/apiMock").then((m) => m.apiClientModule()));

import { mockApi } from "@/test/apiMock";
import InitiativeCompletion from "./InitiativeCompletion";

const PATH = "/ppm/initiatives/i1/completion";

beforeEach(() => mockApi.reset());

describe("InitiativeCompletion", () => {
  it("shows a loading bar under the label until the figure arrives", async () => {
    let answer: (value: unknown) => void = () => {};
    mockApi.on("get", PATH, () => new Promise((resolve) => { answer = resolve; }));
    render(<InitiativeCompletion initiativeId="i1" revision={0} />);
    expect(screen.getByText("Completion")).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).not.toHaveAttribute("aria-valuenow");
    answer({ completion: 10, wbs_count: 1 });
    expect(await screen.findByText("10%")).toBeInTheDocument();
  });

  it("shows the ring with the rounded percentage", async () => {
    mockApi.on("get", PATH, { completion: 41.6, wbs_count: 3 });
    render(<InitiativeCompletion initiativeId="i1" revision={0} />);
    expect(await screen.findByText("42%")).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "42");
  });

  it("says there are no work packages when wbs_count is 0", async () => {
    mockApi.on("get", PATH, { completion: 0, wbs_count: 0 });
    render(<InitiativeCompletion initiativeId="i1" revision={0} />);
    expect(await screen.findByText("No work packages yet")).toBeInTheDocument();
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
  });

  it("shows the error in an alert", async () => {
    mockApi.fail("get", PATH, 500);
    render(<InitiativeCompletion initiativeId="i1" revision={0} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("failed");
  });
});
