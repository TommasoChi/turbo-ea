import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import CostLegend from "./CostLegend";

describe("CostLegend", () => {
  it("lists a swatch and a label per entry", () => {
    render(
      <CostLegend
        entries={[
          { key: "a", label: "Finance", color: "rgb(1, 2, 3)" },
          { key: "__others__", label: "Others (2 groups)", color: "rgb(4, 5, 6)" },
        ]}
      />,
    );
    const legend = screen.getByTestId("cost-legend");
    expect(within(legend).getByText("Finance")).toBeInTheDocument();
    expect(within(legend).getByText("Others (2 groups)")).toBeInTheDocument();
    expect(within(legend).getByTestId("cost-legend-swatch-a")).toHaveStyle({ backgroundColor: "rgb(1, 2, 3)" });
    expect(within(legend).getByTestId("cost-legend-swatch-__others__")).toHaveStyle({
      backgroundColor: "rgb(4, 5, 6)",
    });
  });

  it("renders nothing without entries", () => {
    const { container } = render(<CostLegend entries={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  const entries = [
    { key: "a", label: "Finance", color: "rgb(1, 2, 3)" },
    { key: "b", label: "HR", color: "rgb(4, 5, 6)" },
  ];

  it("calls onSelect with the entry key on click", async () => {
    const onSelect = vi.fn();
    render(<CostLegend entries={entries} onSelect={onSelect} />);
    await userEvent.click(screen.getByRole("button", { name: "HR" }));
    expect(onSelect).toHaveBeenCalledExactlyOnceWith("b");
  });

  it("entries are buttons reachable by keyboard and fire on Enter and Space", async () => {
    const onSelect = vi.fn();
    render(<CostLegend entries={entries} onSelect={onSelect} />);
    await userEvent.tab();
    expect(screen.getByRole("button", { name: "Finance" })).toHaveFocus();
    await userEvent.keyboard("{Enter}");
    await userEvent.tab();
    await userEvent.keyboard(" ");
    expect(onSelect.mock.calls).toEqual([["a"], ["b"]]);
  });

  it("marks the active entry", () => {
    render(<CostLegend entries={entries} onSelect={vi.fn()} activeKey="b" />);
    const active = screen.getByRole("button", { name: "HR" });
    expect(active).toHaveAttribute("aria-current", "true");
    expect(within(active).getByText("HR")).toHaveStyle({ fontWeight: 600 });
    const other = screen.getByRole("button", { name: "Finance" });
    expect(other).not.toHaveAttribute("aria-current");
    expect(within(other).getByText("Finance")).not.toHaveStyle({ fontWeight: 600 });
  });

  it("renders plain entries without onSelect", () => {
    render(<CostLegend entries={entries} activeKey="a" />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.getByText("Finance")).toBeInTheDocument();
    expect(screen.getByTestId("cost-legend-swatch-a")).toBeInTheDocument();
  });

  it("keeps the swatch a phrasing element inside the button", () => {
    render(<CostLegend entries={entries} onSelect={vi.fn()} />);
    for (const e of entries) {
      const swatch = screen.getByTestId(`cost-legend-swatch-${e.key}`);
      expect(swatch.tagName).toBe("SPAN");
      expect(swatch).toHaveStyle({ display: "inline-block" });
    }
  });
});
