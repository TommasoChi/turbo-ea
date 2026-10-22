import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import ComingSoonPage from "./ComingSoonPage";

describe("ComingSoonPage", () => {
  it("shows the nav label it was given as its title, plus the generic not-available message", () => {
    render(<ComingSoonPage titleKey="swotAnalysis" />);
    expect(screen.getByText("SWOT Analysis")).toBeInTheDocument();
    expect(screen.getByText(/isn't available yet/i)).toBeInTheDocument();
  });
});
