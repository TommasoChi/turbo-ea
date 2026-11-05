import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
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
});
