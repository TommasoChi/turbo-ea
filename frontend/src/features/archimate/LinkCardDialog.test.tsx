import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import LinkCardDialog from "./LinkCardDialog";

const picker = vi.hoisted(() => ({ props: null as null | { types: string[]; label: string } }));
vi.mock("@/components/CardPicker", () => ({
  default: (p: { types: string[]; label: string; onChange: (c: unknown) => void }) => {
    picker.props = p;
    return <button onClick={() => p.onChange({ id: "c1", name: "CRM", type: "Application" })}>pick-crm</button>;
  },
}));

const TYPES = [{ key: "Application", label: "Application" }, { key: "Interface", label: "Interface" }];

describe("LinkCardDialog", () => {
  it("limits the picker to the given card types and says which", () => {
    render(<LinkCardDialog open cardTypes={TYPES} onPick={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByRole("dialog", { name: "Link to a card" })).toBeInTheDocument();
    expect(picker.props?.types).toEqual(["Application", "Interface"]);
    expect(picker.props?.label).toBe("Card");
    expect(screen.getByText("Cards of type: Application, Interface")).toBeInTheDocument();
  });

  it("reports the picked card", async () => {
    const onPick = vi.fn();
    render(<LinkCardDialog open cardTypes={TYPES} onPick={onPick} onClose={vi.fn()} />);
    await userEvent.click(screen.getByText("pick-crm"));
    expect(onPick).toHaveBeenCalledWith({ id: "c1", name: "CRM", type: "Application" });
  });

  it("closes without picking", async () => {
    const onPick = vi.fn();
    const onClose = vi.fn();
    render(<LinkCardDialog open cardTypes={TYPES} onPick={onPick} onClose={onClose} />);
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onPick).not.toHaveBeenCalled();
  });

  it("renders nothing when closed", () => {
    render(<LinkCardDialog open={false} cardTypes={TYPES} onPick={vi.fn()} onClose={vi.fn()} />);
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
