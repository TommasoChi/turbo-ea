import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import PpmSectionHeader from "./PpmSectionHeader";

describe("PpmSectionHeader", () => {
  it("renders the title as a semibold subtitle1 with no divider", () => {
    render(<PpmSectionHeader title="Risks" />);
    const title = screen.getByText("Risks");
    expect(title).toHaveClass("MuiTypography-subtitle1");
    expect(getComputedStyle(title).fontWeight).toBe("600");
    expect(getComputedStyle(title.parentElement!).borderBottomWidth).not.toBe("1px");
  });

  it("renders the action beside the title", () => {
    render(<PpmSectionHeader title="Risks" action={<button type="button">Go</button>} />);
    expect(screen.getByRole("button", { name: "Go" })).toBeInTheDocument();
  });
});
