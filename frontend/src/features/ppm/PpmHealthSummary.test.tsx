import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

vi.mock("@/hooks/useDateFormat", () => import("@/test/hooks").then((m) => m.useDateFormatModule()));

import PpmHealthSummary from "./PpmHealthSummary";

const base = { schedule_health: "onTrack", scope_health: "offTrack" };

describe("PpmHealthSummary", () => {
  it("shows the report date and the three texts", () => {
    render(
      <PpmHealthSummary
        report={{
          ...base,
          report_date: "2026-09-01",
          summary: "All good see https://example.com",
          accomplishments: null,
          next_steps: "Ship it",
        }}
        costHealth="atRisk"
      />,
    );
    expect(screen.getByText("Health Summary")).toBeInTheDocument();
    expect(screen.getAllByText("2026-09-01")).toHaveLength(1);
    expect(screen.getByText("Summary")).toBeInTheDocument();
    expect(screen.getByText("Accomplishments")).toBeInTheDocument();
    expect(screen.getByText("Next Steps")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "https://example.com" })).toBeInTheDocument();
    expect(screen.getByText("Ship it")).toBeInTheDocument();
    expect(screen.getAllByText("—")).toHaveLength(1);
    expect(screen.getByText("Cost")).toBeInTheDocument();
  });

  it("lays the three texts in one wrapping row of equal boxes", () => {
    render(<PpmHealthSummary report={{ ...base, summary: "S", accomplishments: "A", next_steps: "N" }} />);
    const boxes = ["Summary", "Accomplishments", "Next Steps"].map(
      (label) => screen.getByText(label).parentElement!,
    );
    const row = boxes[0].parentElement!;
    expect(boxes.every((box) => box.parentElement === row)).toBe(true);
    expect(getComputedStyle(row).display).toBe("flex");
    expect(getComputedStyle(row).flexWrap).toBe("wrap");
    for (const box of boxes) expect(getComputedStyle(box).flex).toBe(getComputedStyle(boxes[0]).flex);
    expect(getComputedStyle(boxes[0]).flex).not.toBe("");
  });

  it("is a region named by its title, with or without a report", () => {
    const { rerender } = render(<PpmHealthSummary report={base} />);
    expect(screen.getByRole("region", { name: "Health Summary" })).toHaveTextContent("Schedule");
    rerender(<PpmHealthSummary report={null} />);
    expect(screen.getByRole("region", { name: "Health Summary" })).toHaveTextContent("No status reports yet");
  });

  it("shows no date without report_date", () => {
    render(<PpmHealthSummary report={base} />);
    expect(screen.queryByText(/\d{4}-\d{2}-\d{2}/)).not.toBeInTheDocument();
  });

  it("omits the Cost dot without costHealth", () => {
    render(<PpmHealthSummary report={base} costHealth={null} />);
    expect(screen.queryByText("Cost")).not.toBeInTheDocument();
    expect(screen.getByText("Schedule")).toBeInTheDocument();
  });

  it("shows the empty state and Manage with no report", () => {
    const onManage = vi.fn();
    render(<PpmHealthSummary report={null} onManage={onManage} />);
    expect(screen.getByText("No status reports yet")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Manage Health Summary" }));
    expect(onManage).toHaveBeenCalledTimes(1);
  });

  it("Manage is absent without onManage", () => {
    render(<PpmHealthSummary report={base} />);
    expect(screen.queryByRole("button", { name: /manage/i })).not.toBeInTheDocument();
  });
});
