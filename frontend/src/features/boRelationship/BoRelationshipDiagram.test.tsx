import { fireEvent, render, screen } from "@testing-library/react";
import { vi, it, expect, beforeAll } from "vitest";
import { installElementFromPoint } from "@/test/dom";
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

it("keeps the canvas coordinate direction independent of an RTL page", () => {
  const { container } = render(
    <div dir="rtl">
      <BoRelationshipDiagram
        nodes={[
          { id: "a", name: "سجل العميل", subtype: "Data", isPersonalData: true, isPaymentData: false },
          { id: "b", name: "Order", subtype: "Document", isPersonalData: false, isPaymentData: true },
        ]}
        edges={[{ id: "link", source: "a", target: "b", cardinality: "1:n" }]}
        positions={{ a: { x: 20, y: 20 }, b: { x: 350, y: 20 } }}
        onActivate={vi.fn()}
      />
    </div>,
  );
  expect(screen.getByRole("region").closest("[dir]")).toHaveAttribute("dir", "rtl");
  expect(container.querySelector(".djs-shape text")?.closest("[dir]")).toHaveAttribute("dir", "ltr");
  expect(container.querySelector(".djs-connection text")?.closest("[dir]")).toHaveAttribute("dir", "ltr");
  expect(container.querySelector(".djs-connection text")).toHaveTextContent("1:n");
});

it("reports the moved position once and keeps a drag separate from card activation", () => {
  const onMove = vi.fn();
  const onActivate = vi.fn();
  render(
    <BoRelationshipDiagram
      nodes={[{ id: "a", name: "Customer", subtype: "Data", isPersonalData: false, isPaymentData: false }]}
      edges={[]}
      positions={{ a: { x: 20, y: 20 } }}
      onActivate={onActivate}
      onMove={onMove}
    />,
  );
  const node = screen.getByRole("button", { name: "Customer" });
  const restore = installElementFromPoint(() => null);
  try {
    fireEvent.mouseDown(node, { button: 0, clientX: 30, clientY: 30 });
    fireEvent.mouseMove(document, { buttons: 1, clientX: 90, clientY: 100 });
    expect(onMove).not.toHaveBeenCalled();
    fireEvent.mouseUp(document, { button: 0, clientX: 90, clientY: 100 });
    fireEvent.click(node, { button: 0 });
  } finally {
    restore();
  }
  expect(onMove).toHaveBeenCalledExactlyOnceWith("a", { x: 80, y: 90 });
  expect(onActivate).not.toHaveBeenCalled();
});

it("requests removal only after the selected relation gets an explicit remove action", () => {
  const onRequestRemoveEdge = vi.fn();
  const { container } = render(
    <BoRelationshipDiagram
      nodes={[
        { id: "a", name: "Customer", subtype: "Data", isPersonalData: false, isPaymentData: false },
        { id: "b", name: "Order", subtype: "Document", isPersonalData: false, isPaymentData: false },
      ]}
      edges={[{ id: "link", source: "a", target: "b", cardinality: "1:n" }]}
      positions={{ a: { x: 20, y: 20 }, b: { x: 350, y: 20 } }}
      onActivate={vi.fn()}
      onRequestRemoveEdge={onRequestRemoveEdge}
    />,
  );
  expect(container.querySelector(".djs-connection .djs-visual polyline"))
    .toHaveAttribute("points", "220,70 350,70");
  const remove = screen.getByRole("button", { name: "Remove selected relation" });
  expect(remove).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Relation from Customer to Order" }));
  expect(onRequestRemoveEdge).not.toHaveBeenCalled();
  fireEvent.click(remove);
  expect(onRequestRemoveEdge).toHaveBeenCalledExactlyOnceWith("link");
});
