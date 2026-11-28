import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import Box from "@mui/material/Box";
import Divider from "@mui/material/Divider";
import { hasSectionDivider } from "@/test/sectionDivider";
import PpmSectionHeader from "./PpmSectionHeader";

describe("PpmSectionHeader", () => {
  it("renders the title as a semibold subtitle1 with no divider", () => {
    render(<PpmSectionHeader title="Risks" />);
    const title = screen.getByText("Risks");
    expect(title).toHaveClass("MuiTypography-subtitle1");
    expect(getComputedStyle(title).fontWeight).toBe("600");
    expect(hasSectionDivider(title)).toBe(false);
  });

  it("the divider check can fail: it sees a bottom border and a Divider sibling", () => {
    const { unmount } = render(
      <Box sx={{ borderBottom: 1 }}>
        <span>Bordered</span>
      </Box>,
    );
    expect(getComputedStyle(screen.getByText("Bordered").parentElement!).borderBottomWidth).toBe("1px");
    expect(hasSectionDivider(screen.getByText("Bordered"))).toBe(true);
    unmount();
    render(
      <div>
        <div>
          <span>Plain</span>
        </div>
        <Divider />
      </div>,
    );
    expect(hasSectionDivider(screen.getByText("Plain"))).toBe(true);
  });

  it("gives the title the id it is asked to carry", () => {
    render(<PpmSectionHeader title="Risks" titleId="t1" />);
    expect(screen.getByText("Risks")).toHaveAttribute("id", "t1");
  });

  it("renders the action beside the title", () => {
    render(<PpmSectionHeader title="Risks" action={<button type="button">Go</button>} />);
    expect(screen.getByRole("button", { name: "Go" })).toBeInTheDocument();
  });
});
