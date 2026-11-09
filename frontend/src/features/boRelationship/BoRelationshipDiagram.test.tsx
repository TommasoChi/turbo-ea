import { fireEvent, render, screen } from "@testing-library/react";
import { vi, it, expect, beforeAll } from "vitest";
import { installSvgStubs } from "@/test/svgStubs";
import BoRelationshipDiagram from "./BoRelationshipDiagram";
beforeAll(installSvgStubs);
it("activates a node with left click and keyboard", () => {
  const activate = vi.fn();
  render(<BoRelationshipDiagram nodes={[{ id: "a", name: "Customer", subtype: "Data", isPersonalData: true, isPaymentData: false }]} edges={[]} positions={{ a: { x: 20, y: 20 } }} onActivate={activate} />);
  const node = screen.getByRole("button", { name: "Customer" });
  fireEvent.click(node, { button: 0 });
  fireEvent.keyDown(node, { key: "Enter" });
  expect(activate).toHaveBeenCalledTimes(2);
  expect(activate).toHaveBeenLastCalledWith("a");
});

it("provides a real pointer hit target for diagram nodes", () => {
  const { container } = render(<BoRelationshipDiagram nodes={[{ id: "a", name: "Customer", subtype: "data", isPersonalData: false, isPaymentData: false }]} edges={[]} positions={{ a: { x: 20, y: 20 } }} onActivate={() => {}} />);
  expect(container.querySelector(".djs-shape .djs-visual")).toHaveStyle({ pointerEvents: "all" });
});
