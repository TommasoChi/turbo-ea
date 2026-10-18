import { installSvgStubs } from "./svgStubs";

describe("installSvgStubs", () => {
  it("is idempotent and gives SVG elements a bounding box", () => {
    installSvgStubs();
    expect(() => installSvgStubs()).not.toThrow();
    const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    expect((rect as SVGGraphicsElement).getBBox()).toEqual({ x: 0, y: 0, width: 100, height: 100 });
  });

  it("keeps the transform attribute and the matrix APIs in step", () => {
    installSvgStubs();
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg") as SVGSVGElement;
    const gNode = document.createElementNS("http://www.w3.org/2000/svg", "g") as SVGGElement;
    const t = svg.createSVGTransform();
    t.setTranslate(5, 7);
    gNode.transform.baseVal.appendItem(t);
    expect(gNode.getAttribute("transform")).toBe("matrix(1,0,0,1,5,7)");
    const m = gNode.getCTM()!.multiply(svg.createSVGMatrix().scale(2));
    expect([m.a, m.e, m.f]).toEqual([2, 5, 7]);
    const p = Object.assign(svg.createSVGPoint(), { x: 1, y: 1 }).matrixTransform(m.inverse());
    expect([p.x, p.y]).toEqual([-2, -3]);
  });
});
