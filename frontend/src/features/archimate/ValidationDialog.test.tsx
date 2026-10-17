import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ValidationDialog from "./ValidationDialog";

describe("ValidationDialog", () => {
  it("says so when there is nothing to report", () => {
    render(<ValidationDialog open issues={[]} onClose={vi.fn()} />);
    expect(screen.getByRole("dialog", { name: "Model check" })).toBeInTheDocument();
    expect(screen.getByText("No problems found.")).toBeInTheDocument();
  });

  it("lists each issue by its translated code with the ref, and the plural count", () => {
    const issues = [
      { code: "relationship_not_allowed", message: "server text", ref: "r1" },
      { code: "dangling_target", message: "server text", ref: "r2" },
    ];
    render(<ValidationDialog open issues={issues} onClose={vi.fn()} />);
    expect(screen.getByText("2 problems found")).toBeInTheDocument();
    expect(screen.getByText(/does not allow the relationship r1/)).toBeInTheDocument();
    expect(screen.getByText("The relationship r2 ends on something that does not exist.")).toBeInTheDocument();
  });

  it("uses the singular for one issue and the server message for an unknown code", () => {
    render(<ValidationDialog open issues={[{ code: "brand_new", message: "Server says no", ref: null }]} onClose={vi.fn()} />);
    expect(screen.getByText("1 problem found")).toBeInTheDocument();
    expect(screen.getByText("Server says no")).toBeInTheDocument();
  });

  it("closes", async () => {
    const onClose = vi.fn();
    render(<ValidationDialog open issues={[]} onClose={onClose} />);
    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
