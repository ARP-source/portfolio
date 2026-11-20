/**
 * The demo's gesture map: every 40-feature window seen through the three directions that best
 * separate the gestures on day 1 (exported by research/drift_pipeline.py and never refitted), so
 * drift shows as windows landing somewhere else. Four gestures span exactly three such directions,
 * so the map holds all of what the day-1 model tells them apart by. Units: one within-class SD on
 * day 1. On screen the map turns: x right, y up, z toward the viewer before turning.
 */
import type { LdaStats } from './lda.ts';

export type Vec3 = [number, number, number];
/** 3x3, row-major. */
export type Mat3 = number[];

export interface MapView {
  origin: Float64Array;
  axes: Float64Array[];
}

/** A gesture's cloud in map units: centre, and the Cholesky factor of its 3x3 covariance. */
export interface Cloud3 {
  c: Vec3;
  /** Lower-triangular, row-major 3x3. */
  L: Mat3;
}

/** A cloud as drawn: centre on screen (map units, y up), its 2x2 Cholesky factor, and depth. */
export interface Cloud {
  cx: number;
  cy: number;
  l11: number;
  l21: number;
  l22: number;
  depth: number;
}

export function mapView(m: { origin: number[]; axes: number[][] }): MapView {
  return { origin: Float64Array.from(m.origin), axes: m.axes.slice(0, 3).map((a) => Float64Array.from(a)) };
}

export function project(v: MapView, x: ArrayLike<number>): Vec3 {
  const out: Vec3 = [0, 0, 0];
  for (let i = 0; i < v.origin.length; i++) {
    const d = x[i]! - v.origin[i]!;
    for (let k = 0; k < v.axes.length; k++) out[k] = out[k]! + d * v.axes[k]![i]!;
  }
  return out;
}

/**
 * Where the model thinks each gesture lives: its class mean, and the model's own shrunk pooled
 * covariance (the one it classifies with), both seen through the map.
 */
export function clouds(s: LdaStats, v: MapView): Cloud3[] {
  const { d, lambda } = s;
  const N = s.n.reduce((a, b) => a + b, 0);
  let tr = 0;
  for (let i = 0; i < d; i++) tr += s.scatter[i * d + i]! / N;
  const sig = (a: Float64Array) => {
    const out = new Float64Array(d);
    for (let i = 0; i < d; i++) {
      let t = 0;
      for (let j = 0; j < d; j++) t += s.scatter[i * d + j]! * a[j]!;
      out[i] = (1 - lambda) * (t / N) + ((lambda * tr) / d) * a[i]!;
    }
    return out;
  };
  const A = v.axes;
  const n = A.length;
  // C[i][j] = a_i^T Sigma a_j, padded to 3x3 for a 2-axis map.
  const C: Mat3 = [1e-9, 0, 0, 0, 1e-9, 0, 0, 0, 1e-9];
  for (let i = 0; i < n; i++) {
    const sa = sig(A[i]!);
    for (let j = 0; j < n; j++) {
      let t = 0;
      for (let q = 0; q < d; q++) t += A[j]![q]! * sa[q]!;
      C[i * 3 + j] = t;
    }
  }
  const L = chol3(C);
  return s.mean.map((mu) => ({ c: project(v, mu), L }));
}

function chol3(C: Mat3): Mat3 {
  const l11 = Math.sqrt(C[0]!), l21 = C[3]! / l11, l31 = C[6]! / l11;
  const l22 = Math.sqrt(Math.max(1e-9, C[4]! - l21 * l21));
  const l32 = (C[7]! - l31 * l21) / l22;
  const l33 = Math.sqrt(Math.max(1e-9, C[8]! - l31 * l31 - l32 * l32));
  return [l11, 0, 0, l21, l22, 0, l31, l32, l33];
}

/** The turn: yaw about the vertical, then pitch about the horizontal, both in radians. */
export function rotation(yaw: number, pitch: number): Mat3 {
  const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
  // Rx(pitch) * Ry(yaw)
  return [cy, 0, sy, sp * sy, cp, -sp * cy, -cp * sy, sp, cp * cy];
}

export function mul3(A: Mat3, B: Mat3): Mat3 {
  const o: Mat3 = new Array(9).fill(0);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) for (let k = 0; k < 3; k++) o[i * 3 + j] = o[i * 3 + j]! + A[i * 3 + k]! * B[k * 3 + j]!;
  return o;
}

/** A point turned about the frame's pivot: [x, y on screen in map units, depth]. */
export function turn(R: Mat3, p: ArrayLike<number>, f: Frame): Vec3 {
  const x = p[0]! - f.px, y = p[1]! - f.py, z = p[2]! - f.pz;
  return [R[0]! * x + R[1]! * y + R[2]! * z + f.px, R[3]! * x + R[4]! * y + R[5]! * z + f.py, R[6]! * x + R[7]! * y + R[8]! * z];
}

/** A cloud as seen at this turn: the outline of an ellipsoid seen straight on is an ellipse. */
export function screenCloud(c: Cloud3, R: Mat3, f: Frame): Cloud {
  const [cx, cy, depth] = turn(R, c.c, f);
  const M = mul3(R, c.L);
  // 2x2 covariance of the first two rows of R L, and its Cholesky factor.
  const a = M[0]! * M[0]! + M[1]! * M[1]! + M[2]! * M[2]!;
  const b = M[0]! * M[3]! + M[1]! * M[4]! + M[2]! * M[5]!;
  const e = M[3]! * M[3]! + M[4]! * M[4]! + M[5]! * M[5]!;
  const l11 = Math.sqrt(a), l21 = b / l11, l22 = Math.sqrt(Math.max(1e-9, e - l21 * l21));
  return { cx, cy, l11, l21, l22, depth };
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

/**
 * The map's box in map units: where 98% of the windows on either day fall at any turn the map
 * makes, plus a margin; and the pivot it turns about.
 */
export interface Frame {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  px: number;
  py: number;
  pz: number;
}

/** How far the map turns: yaw either way, and the pitch that goes with it, in radians. */
export const TURN = { yaw: (50 * Math.PI) / 180, pitch: (18 * Math.PI) / 180 };

export function mapFrame(points: Vec3[], margin = 1.2): Frame {
  const q = (a: number[], p: number) => a.slice().sort((x, y) => x - y)[Math.floor(p * (a.length - 1))]!;
  const mid = (k: number) => {
    const a = points.map((p) => p[k]!);
    return (q(a, 0.01) + q(a, 0.99)) / 2;
  };
  const f: Frame = { x0: 0, x1: 0, y0: 0, y1: 0, px: mid(0), py: mid(1), pz: mid(2) };
  const xs: number[] = [], ys: number[] = [];
  let lo = [Infinity, Infinity], hi = [-Infinity, -Infinity];
  for (const yaw of [-1, -0.5, 0, 0.5, 1]) {
    const R = rotation(yaw * TURN.yaw, Math.abs(yaw) * TURN.pitch);
    xs.length = ys.length = 0;
    for (const p of points) {
      const [x, y] = turn(R, p, f);
      xs.push(x), ys.push(y);
    }
    lo = [Math.min(lo[0]!, q(xs, 0.01)), Math.min(lo[1]!, q(ys, 0.01))];
    hi = [Math.max(hi[0]!, q(xs, 0.99)), Math.max(hi[1]!, q(ys, 0.99))];
  }
  return { ...f, x0: lo[0]! - margin, x1: hi[0]! + margin, y0: lo[1]! - margin, y1: hi[1]! + margin };
}

/** SVG coordinates for a frame drawn w units wide (height follows, so a circle stays a circle). */
export function svgScale(f: Frame, w: number) {
  const k = w / (f.x1 - f.x0);
  return { w, h: (f.y1 - f.y0) * k, x: (x: number) => (x - f.x0) * k, y: (y: number) => (f.y1 - y) * k, k };
}
