import { fireEvent, render, screen } from "@testing-library/react";
import { vi, it, expect, beforeAll } from "vitest";
import { installElementFromPoint } from "@/test/dom";
import { installSvgStubs } from "@/test/svgStubs";
import BoRelationshipDiagram from "./BoRelationshipDiagram";
beforeAll(installSvgStubs);

it("opens the routing menu on a single connection and redraws its right angles after a move", () => {
  const nodes = [
    { id: "a", name: "Customer", subtype: "Data", isPersonalData: false, isPaymentData: false },
    { id: "b", name: "Order", subtype: "Data", isPersonalData: false, isPaymentData: false },
  ];
  const edge = { id: "link", source: "a", target: "b", cardinality: "1:n" };
  const props = { nodes, positions: { a: { x: 20, y: 20 }, b: { x: 350, y: 170 } }, onActivate: vi.fn(), onChangeRouting: vi.fn() };
  const { container, rerender } = render(<BoRelationshipDiagram {...props} edges={[edge]} />);
  const line = () => container.querySelector(".bo-edge-line")!;
  fireEvent.contextMenu(line().closest(".djs-connection")!, { button: 2, clientX: 250, clientY: 130 });
  expect(screen.getByRole("menuitemradio", { name: "Straight" })).toBeChecked();
  fireEvent.click(screen.getByRole("menuitemradio", { name: "Orthogonal" }));
  expect(props.onChangeRouting).toHaveBeenCalledExactlyOnceWith("link", "orthogonal");
  const routed = [{ ...edge, routing: "orthogonal" as const }];
  for (const positions of [props.positions, { ...props.positions, b: { x: 20, y: 300 } }]) {
    rerender(<BoRelationshipDiagram {...props} positions={positions} edges={routed} />);
    const points = line().getAttribute("points")!.split(" ").map((point) => point.split(","));
    expect(points.length).toBeGreaterThan(2);
    expect(points.slice(1).every(([x, y], i) => x === points[i][0] || y === points[i][1])).toBe(true);
  }
});

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

it.each([false, true])("pans from the background without moving BOs (editable: %s)", (editable) => {
  const onMove = vi.fn();
  const onActivate = vi.fn();
  const { container } = render(<BoRelationshipDiagram
    nodes={[{ id: "a", name: "Customer", subtype: "Data", isPersonalData: false, isPaymentData: false }]}
    edges={[]}
    positions={{ a: { x: 20, y: 20 } }}
    onActivate={onActivate}
    onMove={editable ? onMove : undefined}
  />);
  const svg = container.querySelector(".djs-container > svg")!;
  const viewport = svg.querySelector(".viewport")!;
  const shape = svg.querySelector(".djs-shape")!;
  const initialPosition = shape.getAttribute("transform");
  fireEvent.mouseDown(svg, { button: 0, clientX: 250, clientY: 200 });
  fireEvent.mouseMove(document, { buttons: 1, clientX: 310, clientY: 240 });
  fireEvent.mouseUp(document, { button: 0, clientX: 310, clientY: 240 });
  fireEvent.click(svg);
  expect(viewport).toHaveAttribute("transform", "matrix(1,0,0,1,60,40)");
  expect(shape).toHaveAttribute("transform", initialPosition);
  expect(onMove).not.toHaveBeenCalled();
  expect(onActivate).not.toHaveBeenCalled();
  fireEvent.keyDown(svg, { key: "ArrowRight" });
  expect(viewport).toHaveAttribute("transform", "matrix(1,0,0,1,-140,40)");
  fireEvent.click(shape, { button: 0 });
  expect(onActivate).toHaveBeenCalledExactlyOnceWith("a");
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
  expect(container.querySelector(".bo-edge-many")?.closest("[dir]")).toHaveAttribute("dir", "ltr");
  expect(container.querySelector(".bo-edge-many[data-end='source']")).toBeNull();
  expect(container.querySelector(".bo-edge-many[data-end='target']")).toBeInTheDocument();
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

it("reflects the externally selected card and updates it without losing activation", () => {
  const node = { id: "a", name: "Customer", subtype: "Data", isPersonalData: true, isPaymentData: false };
  const activate = vi.fn();
  const props = { nodes: [node], edges: [], positions: { a: { x: 20, y: 20 } }, onActivate: activate };
  const { rerender } = render(<BoRelationshipDiagram {...props} selectedId="a" />);
  const selected = screen.getByRole("button", { name: "Customer" });
  expect(selected).toHaveAttribute("aria-pressed", "true");
  selected.focus();
  rerender(<BoRelationshipDiagram {...props} selectedId={null} />);
  const card = screen.getByRole("button", { name: "Customer" });
  expect(card).toHaveAttribute("aria-pressed", "false");
  expect(card).toBe(selected);
  expect(card).toHaveFocus();
  fireEvent.click(card);
  expect(activate).toHaveBeenCalledWith("a");
});

it("renders the translated type and indicators without duplicating the toolbar zoom controls", () => {
  const { container } = render(<BoRelationshipDiagram nodes={[{ id: "a", name: "Order", subtype: "Document", isPersonalData: false, isPaymentData: true }]} edges={[]} positions={{ a: { x: 20, y: 20 } }} onActivate={() => {}} />);
  expect(container.querySelector(".djs-shape .djs-visual")).toHaveTextContent("Document");
  expect(container.querySelector(".djs-shape .djs-visual")).toHaveTextContent("PCI");
  expect(screen.queryByRole("button", { name: "Zoom in" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Zoom out" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Pan left" })).not.toBeInTheDocument();
});

const shortcutDiagram = {
  nodes: [
    { id: "a", name: "Customer", subtype: "Data", isPersonalData: false, isPaymentData: false },
    { id: "b", name: "Order", subtype: "Document", isPersonalData: false, isPaymentData: false },
  ],
  edges: [{ id: "link", source: "a", target: "b", cardinality: "1:n" }],
  positions: { a: { x: 20, y: 20 }, b: { x: 350, y: 20 } },
};

it.each([
  ["1:1", []], ["1:n", ["target"]], ["n:1", ["source"]], ["n:m", ["source", "target"]],
] as const)("renders the crow's foot at the many ends for %s", (cardinality, ends) => {
  const edges = [{ ...shortcutDiagram.edges[0], cardinality }];
  const { container } = render(<BoRelationshipDiagram {...shortcutDiagram} edges={edges} onActivate={vi.fn()} />);
  expect([...container.querySelectorAll(".bo-edge-many")].map((path) => path.getAttribute("data-end"))).toEqual(ends);
});

it("keeps bends and follows a manually pinned end when its object moves", () => {
  const edges = [{ ...shortcutDiagram.edges[0], geometry: { bends: [{ x: 280, y: 100 }], target: { x: 45, y: 0 } } }];
  const props = { ...shortcutDiagram, edges, onActivate: vi.fn(), onChangeGeometry: vi.fn() };
  const { container, rerender } = render(<BoRelationshipDiagram {...props} />);
  const points = () => container.querySelector(".bo-edge-line")!.getAttribute("points");
  expect(points()).toMatch(/280,100 395,20$/);
  rerender(<BoRelationshipDiagram {...props} positions={{ ...props.positions, b: { x: 365, y: 160 } }} />);
  expect(points()).toMatch(/280,100 410,160$/);
});

function viewportTransform(viewport: Element): number[] {
  return (viewport.getAttribute("transform") ?? "matrix(1,0,0,1,0,0)")
    .slice(7, -1).split(",").map(Number);
}

it("scrolls vertically, scrolls horizontally with Shift, and zooms around the pointer with Ctrl", () => {
  const { container } = render(<BoRelationshipDiagram {...shortcutDiagram} onActivate={vi.fn()} />);
  const svg = container.querySelector(".djs-container > svg")!;
  const viewport = svg.querySelector(".viewport")!;
  fireEvent.mouseOver(svg);
  expect(fireEvent.wheel(svg, { deltaY: 40 })).toBe(false);
  expect(viewportTransform(viewport)).toEqual([1, 0, 0, 1, 0, -30]);
  expect(fireEvent.wheel(svg, { deltaY: 80, shiftKey: true })).toBe(false);
  expect(viewportTransform(viewport)).toEqual([1, 0, 0, 1, -60, -30]);
  expect(fireEvent.wheel(svg, { deltaY: -100, ctrlKey: true, clientX: 100, clientY: 150 })).toBe(false);
  const [scale, , , , x, y] = viewportTransform(viewport);
  expect(scale).toBeGreaterThan(1);
  expect(160 * scale + x).toBeCloseTo(100);
  expect(180 * scale + y).toBeCloseTo(150);
});

it("steps keyboard zoom and centers the drawing with Ctrl+0", () => {
  const { container } = render(<BoRelationshipDiagram {...shortcutDiagram} onActivate={vi.fn()} />);
  const svg = container.querySelector<SVGSVGElement>(".djs-container > svg")!;
  const viewport = svg.querySelector(".viewport")!;
  svg.focus();
  expect(fireEvent.keyDown(svg, { key: "+", ctrlKey: true, shiftKey: true })).toBe(false);
  expect(viewportTransform(viewport)[0]).toBeGreaterThan(1);
  expect(fireEvent.keyDown(svg, { key: "-", ctrlKey: true })).toBe(false);
  expect(viewportTransform(viewport)[0]).toBeLessThan(1.1);
  expect(fireEvent.keyDown(svg, { key: "0", ctrlKey: true })).toBe(false);
  expect(viewportTransform(viewport)).toEqual([1, 0, 0, 1, 350, 250]);
});

it("pans and fits using the current canvas width after a panel resize", () => {
  const { container } = render(<BoRelationshipDiagram {...shortcutDiagram} onActivate={vi.fn()} />);
  const svg = container.querySelector<SVGSVGElement>(".djs-container > svg")!;
  const viewport = svg.querySelector(".viewport")!;
  fireEvent.keyDown(svg, { key: "ArrowRight" });
  Object.defineProperty(svg.parentElement, "clientWidth", { configurable: true, value: 400 });
  fireEvent.keyDown(svg, { key: "ArrowRight" });
  expect(viewportTransform(viewport)).toEqual([1, 0, 0, 1, -300, 0]);
  Object.defineProperty(svg.parentElement, "clientWidth", { configurable: true, value: 600 });
  fireEvent.keyDown(svg, { key: "0", ctrlKey: true });
  expect(viewportTransform(viewport)).toEqual([1, 0, 0, 1, 250, 250]);
});

it.each([
  ["undo", { key: "z", ctrlKey: true }],
  ["redo", { key: "y", ctrlKey: true }],
  ["redo", { key: "Z", ctrlKey: true, shiftKey: true }],
  ["copy", { key: "c", ctrlKey: true }],
  ["paste", { key: "v", ctrlKey: true }],
  ["delete", { key: "Delete" }],
  ["delete", { key: "Backspace" }],
  ["edit", { key: "F2" }],
  ["edit", { key: "Enter" }],
  ["selectAll", { key: "a", ctrlKey: true }],
] as const)("dispatches %s from the diagram background only when handled", (action, keys) => {
  const onShortcut = vi.fn(() => true);
  const { container } = render(<BoRelationshipDiagram {...shortcutDiagram} onActivate={vi.fn()} onShortcut={onShortcut} />);
  const svg = container.querySelector<SVGSVGElement>(".djs-container > svg")!;
  svg.focus();
  expect(fireEvent.keyDown(svg, keys)).toBe(false);
  expect(onShortcut).toHaveBeenCalledExactlyOnceWith(action);
  onShortcut.mockReturnValue(false);
  expect(fireEvent.keyDown(svg, keys)).toBe(true);
});

it("preserves text editing shortcuts outside the canvas", () => {
  const onShortcut = vi.fn(() => true);
  render(<>
    <input aria-label="Name" />
    <BoRelationshipDiagram {...shortcutDiagram} onActivate={vi.fn()} onShortcut={onShortcut} />
  </>);
  const input = screen.getByRole("textbox", { name: "Name" });
  input.focus();
  expect(fireEvent.keyDown(input, { key: "z", ctrlKey: true })).toBe(true);
  expect(fireEvent.keyDown(input, { key: "a", ctrlKey: true })).toBe(true);
  expect(fireEvent.keyDown(input, { key: "+", ctrlKey: true })).toBe(true);
  expect(fireEvent.keyDown(input, { key: "Backspace" })).toBe(true);
  expect(input).toHaveFocus();
  expect(onShortcut).not.toHaveBeenCalled();
});

it.each([
  ["edit", { key: "F2" }],
  ["copy", { key: "c", ctrlKey: true }],
  ["delete", { key: "Delete" }],
] as const)("dispatches %s for the focused node", (action, keys) => {
  const onShortcut = vi.fn(() => true);
  const onActivate = vi.fn();
  render(<BoRelationshipDiagram {...shortcutDiagram} onActivate={onActivate} onShortcut={onShortcut} />);
  const order = screen.getByRole("button", { name: "Order" });
  order.focus();
  expect(fireEvent.keyDown(order, keys)).toBe(false);
  expect(onShortcut).toHaveBeenCalledExactlyOnceWith(action, "b");
  expect(onActivate).not.toHaveBeenCalled();
});

it("opens an unselected node with Enter and offers to edit a selected node", () => {
  const onActivate = vi.fn();
  const onShortcut = vi.fn(() => true);
  const props = { ...shortcutDiagram, onActivate, onShortcut };
  const { rerender } = render(<BoRelationshipDiagram {...props} />);
  const customer = screen.getByRole("button", { name: "Customer" });
  customer.focus();
  fireEvent.keyDown(customer, { key: "Enter" });
  expect(onActivate).toHaveBeenCalledExactlyOnceWith("a");
  expect(onShortcut).not.toHaveBeenCalled();

  rerender(<BoRelationshipDiagram {...props} selectedIds={new Set(["a"])} />);
  expect(customer).toHaveFocus();
  fireEvent.keyDown(customer, { key: "Enter" });
  expect(onShortcut).toHaveBeenCalledExactlyOnceWith("edit", "a");
  expect(onActivate).toHaveBeenCalledTimes(1);

  fireEvent.keyDown(customer, { key: " " });
  expect(onActivate).toHaveBeenCalledTimes(2);
  onShortcut.mockReturnValue(false);
  fireEvent.keyDown(customer, { key: "Enter" });
  expect(onActivate).toHaveBeenCalledTimes(3);
});

it("applies multi-selection markers and aria state without replacing node graphics", () => {
  const props = { ...shortcutDiagram, onActivate: vi.fn() };
  const { rerender } = render(<BoRelationshipDiagram {...props} selectedIds={new Set(["a", "b"])} />);
  const customer = screen.getByRole("button", { name: "Customer", pressed: true });
  const order = screen.getByRole("button", { name: "Order", pressed: true });
  expect(customer).toHaveClass("bo-node-selected");
  expect(order).toHaveClass("bo-node-selected");
  order.focus();
  rerender(<BoRelationshipDiagram {...props} selectedIds={new Set(["a"])} />);
  expect(screen.getByRole("button", { name: "Order", pressed: false })).toBe(order);
  expect(order).toHaveFocus();
  expect(order).not.toHaveClass("bo-node-selected");
  expect(customer).toHaveClass("bo-node-selected");
});

it("uses Backspace to request removal of the selected relation", () => {
  const onShortcut = vi.fn(() => true);
  const onRequestRemoveEdge = vi.fn();
  const { container } = render(<BoRelationshipDiagram {...shortcutDiagram} onActivate={vi.fn()} onShortcut={onShortcut} onRequestRemoveEdge={onRequestRemoveEdge} />);
  const relation = screen.getByRole("button", { name: "Relation from Customer to Order" });
  relation.focus();
  fireEvent.keyDown(relation, { key: "Enter" });
  const svg = container.querySelector<SVGSVGElement>(".djs-container > svg")!;
  svg.focus();
  expect(fireEvent.keyDown(svg, { key: "Backspace" })).toBe(false);
  expect(onRequestRemoveEdge).toHaveBeenCalledExactlyOnceWith("link");
  expect(onShortcut).not.toHaveBeenCalled();
});

it("lets Ctrl+A replace relation selection before a subsequent Delete", () => {
  const onShortcut = vi.fn(() => true);
  const onRequestRemoveEdge = vi.fn();
  const { container } = render(<BoRelationshipDiagram {...shortcutDiagram} onActivate={vi.fn()} onShortcut={onShortcut} onRequestRemoveEdge={onRequestRemoveEdge} />);
  const relation = screen.getByRole("button", { name: "Relation from Customer to Order" });
  relation.focus();
  fireEvent.keyDown(relation, { key: "Enter" });
  fireEvent.keyDown(relation, { key: "a", ctrlKey: true });
  const svg = container.querySelector<SVGSVGElement>(".djs-container > svg")!;
  expect(svg).toHaveFocus();
  expect(fireEvent.keyDown(svg, { key: "Delete" })).toBe(false);
  expect(onShortcut.mock.calls).toEqual([["selectAll"], ["delete"]]);
  expect(onRequestRemoveEdge).not.toHaveBeenCalled();
});

it("targets a focused node instead of a previously selected relation on Delete", () => {
  const onShortcut = vi.fn(() => true);
  const onRequestRemoveEdge = vi.fn();
  render(<BoRelationshipDiagram {...shortcutDiagram} onActivate={vi.fn()} onShortcut={onShortcut} onRequestRemoveEdge={onRequestRemoveEdge} />);
  fireEvent.click(screen.getByRole("button", { name: "Relation from Customer to Order" }));
  const order = screen.getByRole("button", { name: "Order" });
  order.focus();
  expect(fireEvent.keyDown(order, { key: "Delete" })).toBe(false);
  expect(onShortcut).toHaveBeenCalledExactlyOnceWith("delete", "b");
  expect(onRequestRemoveEdge).not.toHaveBeenCalled();
});

it("keeps canvas keyboard focus after a drawing change and leaves external focus alone", () => {
  const props = { ...shortcutDiagram, onActivate: vi.fn(), onShortcut: vi.fn(() => true) };
  const drawing = (x: number) => <>
    <input aria-label="Name" />
    <BoRelationshipDiagram {...props} positions={{ ...props.positions, a: { x, y: 20 } }} />
  </>;
  const { container, rerender } = render(drawing(20));
  const svg = () => container.querySelector<SVGSVGElement>(".djs-container > svg")!;
  svg().focus();
  rerender(drawing(30));
  expect(svg()).toHaveFocus();
  fireEvent.keyDown(svg(), { key: "z", ctrlKey: true });
  expect(props.onShortcut).toHaveBeenCalledExactlyOnceWith("undo");
  const input = screen.getByRole("textbox", { name: "Name" });
  input.focus();
  rerender(drawing(40));
  expect(input).toHaveFocus();
});
