import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { renderWithProviders } from "@/test/render";
import StreamBandFrame from "./StreamBandFrame";

// Emotion minifies grid shorthands ("6 / span 3" is served as "6/span 3").
const frame = (container: HTMLElement) => container.firstElementChild as HTMLElement;

describe("StreamBandFrame", () => {
  it("draws a dashed frame with the centred empty label when the band is empty", () => {
    const { container } = renderWithProviders(
      <StreamBandFrame row={6} rows={3} hasGoals={false} goalBoundary={5} empty emptyLabel="No value gate found" />,
    );
    expect(screen.getByText("No value gate found")).toHaveStyle({ color: "rgba(0, 0, 0, 0.6)" });
    expect(frame(container)).toHaveStyle({
      borderStyle: "dashed",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
    });
  });

  it("draws a solid frame with no label when the band has content", () => {
    const { container } = renderWithProviders(
      <StreamBandFrame row={6} rows={3} hasGoals={false} goalBoundary={5} empty={false} emptyLabel="No value gate found" />,
    );
    expect(screen.queryByText("No value gate found")).not.toBeInTheDocument();
    expect(frame(container)).toHaveStyle({ borderStyle: "solid" });
    expect(frame(container)).not.toHaveStyle({ display: "flex" });
    expect(frame(container)).toBeEmptyDOMElement();
  });

  it("spans its rows, the full width and both gutters without goals, and never takes clicks", () => {
    const { container } = renderWithProviders(
      <StreamBandFrame row={6} rows={3} hasGoals={false} goalBoundary={5} empty={false} emptyLabel="x" />,
    );
    expect(frame(container)).toHaveStyle({
      gridRow: "6/span 3",
      gridColumn: "1/-1",
      marginLeft: "-12px",
      marginRight: "-12px",
      pointerEvents: "none",
      backgroundColor: "rgba(0, 0, 0, 0.04)",
      borderColor: "rgba(0, 0, 0, 0.12)",
      borderRadius: "8px",
    });
  });

  it("stops at the goal boundary, with no right gutter compensation, when goals are shown", () => {
    const { container } = renderWithProviders(
      <StreamBandFrame row={2} rows={14} hasGoals goalBoundary={5} empty={false} emptyLabel="x" />,
    );
    expect(frame(container)).toHaveStyle({
      gridRow: "2/span 14",
      gridColumn: "1/5",
      marginLeft: "-12px",
      marginRight: "0px",
    });
  });
});
