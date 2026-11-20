/**
 * The demo's gesture map: every 40-feature window seen through the two directions that best
 * separate the gestures on day 1 (exported by research/drift_pipeline.py and never refitted), so
 * drift shows as windows landing somewhere else. Units: one within-class SD on day 1.
 */
import type { LdaStats } from './lda.ts';

export interface MapView {
  origin: Float64Array;
  axes: [Float64Array, Float64Array];
}

/** A gesture's cloud in map units: centre, and the Cholesky factor of its 2x2 covariance. */
export interface Cloud {
  cx: number;
  cy: number;
  l11: number;
  l21: number;
  l22: number;
}

export function mapView(m: { origin: number[]; axes: number[][] }): MapView {
  return { origin: Float64Array.from(m.origin), axes: [Float64Array.from(m.axes[0]!), Float64Array.from(m.axes[1]!)] };
}

export function project(v: MapView, x: ArrayLike<number>): [number, number] {
  let a = 0, b = 0;
  for (let i = 0; i < v.origin.length; i++) {
    const d = x[i]! - v.origin[i]!;
    a += d * v.axes[0][i]!;
    b += d * v.axes[1][i]!;
  }
  return [a, b];
}

/**
 * Where the model thinks each gesture lives: its class mean, and the model's own shrunk pooled
 * covariance (the one it classifies with), both seen through the map.
 */
export function clouds(s: LdaStats, v: MapView): Cloud[] {
  const { d, lambda } = s;
  const N = s.n.reduce((a, b) => a + b, 0);
  let tr = 0;
  for (let i = 0; i < d; i++) tr += s.scatter[i * d + i]! / N;
  // Sigma a for each axis a, then a^T Sigma b.
  const sig = (a: Float64Array) => {
    const out = new Float64Array(d);
    for (let i = 0; i < d; i++) {
      let t = 0;
      for (let j = 0; j < d; j++) t += s.scatter[i * d + j]! * a[j]!;
      out[i] = (1 - lambda) * (t / N) + ((lambda * tr) / d) * a[i]!;
    }
    return out;
  };
  const [A, B] = v.axes;
  const sA = sig(A), sB = sig(B);
  let caa = 0, cab = 0, cbb = 0;
  for (let i = 0; i < d; i++) {
    caa += A[i]! * sA[i]!;
    cab += A[i]! * sB[i]!;
    cbb += B[i]! * sB[i]!;
  }
  const l11 = Math.sqrt(caa), l21 = cab / l11, l22 = Math.sqrt(Math.max(1e-9, cbb - l21 * l21));
  return s.mean.map((mu) => {
    const [cx, cy] = project(v, mu);
    return { cx, cy, l11, l21, l22 };
  });
}

/** SVG path of a cloud's ellipse at r standard deviations, in the given coordinate transform. */
export function ellipsePath(c: Cloud, r: number, toX: (x: number) => number, toY: (y: number) => number, n = 48): string {
  let p = '';
  for (let i = 0; i <= n; i++) {
    const t = (i / n) * 2 * Math.PI, u = Math.cos(t) * r, w = Math.sin(t) * r;
    const x = c.cx + c.l11 * u, y = c.cy + c.l21 * u + c.l22 * w;
    p += `${i ? 'L' : 'M'}${toX(x).toFixed(1)} ${toY(y).toFixed(1)}`;
  }
  return p + 'Z';
}

/** The map's box in map units: where 98% of the windows on either day fall, plus a margin. */
export interface Frame {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

export function mapFrame(points: [number, number][], margin = 1.2): Frame {
  const q = (a: number[], p: number) => a.sort((x, y) => x - y)[Math.floor(p * (a.length - 1))]!;
  const xs = points.map((p) => p[0]), ys = points.map((p) => p[1]);
  return { x0: q(xs, 0.01) - margin, x1: q(xs, 0.99) + margin, y0: q(ys, 0.01) - margin, y1: q(ys, 0.99) + margin };
}

/** SVG coordinates for a frame drawn w units wide (height follows, so a circle stays a circle). */
export function svgScale(f: Frame, w: number) {
  const k = w / (f.x1 - f.x0);
  return { w, h: (f.y1 - f.y0) * k, x: (x: number) => (x - f.x0) * k, y: (y: number) => (f.y1 - y) * k, k };
}
