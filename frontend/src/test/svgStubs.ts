/**
 * The SVG geometry diagram-js needs, for jsdom (which has none).
 *
 * jsdom parses SVG but implements no matrices, transform lists or bounding boxes, so a real
 * `new Diagram(...)` dies on its first `createSVGMatrix()`. This installs the minimum on the
 * prototypes — the engine tests run the real diagram-js on top of it, nothing is mocked.
 *
 * The `transform` attribute is the single source of truth: a transform list is parsed from it on
 * every access and written back on every change, so `setAttribute('transform', ...)` (diagram-js's
 * `setCTM`) and tiny-svg's `transform()` see the same thing.
 */

class Matrix {
  constructor(
    public a = 1, public b = 0, public c = 0, public d = 1, public e = 0, public f = 0,
  ) {}

  multiply(m: Matrix): Matrix {
    return new Matrix(
      this.a * m.a + this.c * m.b, this.b * m.a + this.d * m.b,
      this.a * m.c + this.c * m.d, this.b * m.c + this.d * m.d,
      this.a * m.e + this.c * m.f + this.e, this.b * m.e + this.d * m.f + this.f,
    );
  }

  inverse(): Matrix {
    const det = this.a * this.d - this.b * this.c;
    return new Matrix(
      this.d / det, -this.b / det, -this.c / det, this.a / det,
      (this.c * this.f - this.d * this.e) / det, (this.b * this.e - this.a * this.f) / det,
    );
  }

  translate(x: number, y: number): Matrix { return this.multiply(new Matrix(1, 0, 0, 1, x, y)); }
  scale(s: number): Matrix { return this.multiply(new Matrix(s, 0, 0, s, 0, 0)); }
  scaleNonUniform(sx: number, sy: number): Matrix { return this.multiply(new Matrix(sx, 0, 0, sy, 0, 0)); }
  rotate(deg: number): Matrix {
    const r = (deg * Math.PI) / 180;
    return this.multiply(new Matrix(Math.cos(r), Math.sin(r), -Math.sin(r), Math.cos(r), 0, 0));
  }
}

class Point {
  constructor(public x = 0, public y = 0) {}
  matrixTransform(m: Matrix): Point {
    return new Point(m.a * this.x + m.c * this.y + m.e, m.b * this.x + m.d * this.y + m.f);
  }
}

class Transform {
  type = 1; // SVG_TRANSFORM_MATRIX
  angle = 0;
  matrix = new Matrix();
  setMatrix(m: Matrix): void { this.matrix = new Matrix(m.a, m.b, m.c, m.d, m.e, m.f); }
  setTranslate(x: number, y: number): void { this.matrix = new Matrix(1, 0, 0, 1, x, y); }
  setScale(sx: number, sy: number): void { this.matrix = new Matrix(sx, 0, 0, sy, 0, 0); }
  setRotate(angle: number, cx = 0, cy = 0): void {
    this.angle = angle;
    this.matrix = new Matrix().translate(cx, cy).rotate(angle).translate(-cx, -cy);
  }
}

function fromMatrix(m: Matrix): Transform {
  const t = new Transform();
  t.setMatrix(m);
  return t;
}

const FN = /(matrix|translate|scale|rotate)\(([^)]*)\)/g;

/** Parses the subset of the transform syntax diagram-js writes. */
function parseTransforms(value: string | null): Transform[] {
  const out: Transform[] = [];
  for (const [, fn, args] of (value ?? "").matchAll(FN)) {
    const n = args.trim().split(/[\s,]+/).map(Number);
    const t = new Transform();
    if (fn === "matrix") t.setMatrix(new Matrix(n[0], n[1], n[2], n[3], n[4], n[5]));
    else if (fn === "translate") t.setTranslate(n[0], n[1] ?? 0);
    else if (fn === "scale") t.setScale(n[0], n[1] ?? n[0]);
    else t.setRotate(n[0], n[1], n[2]);
    out.push(t);
  }
  return out;
}

class TransformList {
  private items: Transform[];
  constructor(private node: Element) { this.items = parseTransforms(node.getAttribute("transform")); }

  get numberOfItems(): number { return this.items.length; }
  getItem(i: number): Transform { return this.items[i]; }
  clear(): void { this.items = []; this.write(); }
  initialize(t: Transform): Transform { this.items = [t]; this.write(); return t; }
  appendItem(t: Transform): Transform { this.items.push(t); this.write(); return t; }
  createSVGTransformFromMatrix(m: Matrix): Transform { return fromMatrix(m); }

  consolidate(): Transform | null {
    if (!this.items.length) return null;
    return this.initialize(fromMatrix(this.items.reduce((m, t) => m.multiply(t.matrix), new Matrix())));
  }

  private write(): void {
    if (!this.items.length) { this.node.removeAttribute("transform"); return; }
    const m = this.items.reduce((acc, t) => acc.multiply(t.matrix), new Matrix());
    this.node.setAttribute("transform", `matrix(${m.a},${m.b},${m.c},${m.d},${m.e},${m.f})`);
  }
}

function ownMatrix(node: Element): Matrix {
  return new TransformList(node).consolidate()?.matrix ?? new Matrix();
}

let installed = false;

export function installSvgStubs(): void {
  if (installed) return;
  installed = true;

  const g = globalThis as Record<string, unknown>;
  if (typeof g.SVGMatrix === "undefined") g.SVGMatrix = Matrix;

  const define = (proto: object, members: Record<string, unknown>) => {
    for (const [name, value] of Object.entries(members)) {
      Object.defineProperty(proto, name, { configurable: true, writable: true, value });
    }
  };

  define(SVGElement.prototype, {
    getBBox: () => ({ x: 0, y: 0, width: 100, height: 100 }),
    // ponytail: own transform only (ancestors up to the <svg> ignored) — enough for the viewport <g>.
    getCTM(this: Element) { return ownMatrix(this); },
    getScreenCTM(this: Element) { return ownMatrix(this); },
    getComputedTextLength(this: Element) { return (this.textContent ?? "").length * 6; },
  });
  Object.defineProperty(SVGElement.prototype, "transform", {
    configurable: true,
    get(this: Element) { return { baseVal: new TransformList(this) }; },
  });

  define(SVGSVGElement.prototype, {
    createSVGMatrix: () => new Matrix(),
    createSVGPoint: () => new Point(),
    createSVGTransform: () => new Transform(),
    createSVGTransformFromMatrix: (m: Matrix) => fromMatrix(m),
  });

  // diagram-js sizes the viewport from its own `.djs-container` div; every other element keeps jsdom's 0.
  for (const [prop, size] of [["clientWidth", 800], ["clientHeight", 600]] as const) {
    const original = Object.getOwnPropertyDescriptor(Element.prototype, prop)?.get;
    Object.defineProperty(HTMLElement.prototype, prop, {
      configurable: true,
      get(this: HTMLElement) { return this.classList.contains("djs-container") ? size : (original?.call(this) ?? 0); },
    });
  }
}
