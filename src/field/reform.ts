/**
 * Re-forming the hero after the visitor scrolls back up. The flock streams out of itself along the
 * route Raag drew: up the left side, over the top, down the right and back along to the line's left
 * end, where the trace draws itself from left to right like a pen. The hand's dots ride the same
 * stream, peel off, swoop in at the wrist and rise into place, so it fills in from the wrist up. The
 * shader (reformChunk in shaders.ts) does the motion; this file holds the timing and the route.
 */

/** Seconds. Every particle has finished by REFORM.totalS. */
export const REFORM = {
  /** Dots leave the flock over this window, so it stretches into a stream instead of jumping. */
  leaveS: 0.6,
  /** Trace: time from the flock to the line, the spread between first and last arrival (short, so
   *  the loop reads as a band), and the time to run the whole line. The dot bound for the
   *  right end arrives first and nobody overtakes; the left end settles last. */
  traceRouteS: 2.1,
  traceSpreadS: 0.5,
  traceRunS: 1.0,
  /** How long a trace dot sits on its spot before it counts as landed (longer than a frame at 3x). */
  traceHoldS: 0.2,
  /** Hand: how far along the route its dots peel off (0..1), the swoop round to the wrist, and the
   *  rise to their points (the fingertips take the full time, the wrist about a third of it), so
   *  the hand fills in from the wrist up. */
  handBranch: 0.5,
  handTurnS: 0.6,
  handClimbS: 1.1,
  get totalS() {
    const trace = this.leaveS + this.traceRouteS + Math.max(this.traceSpreadS + 0.15, this.traceRunS) + this.traceHoldS;
    const hand = this.leaveS + this.traceSpreadS + this.handBranch * (this.traceRouteS + this.traceSpreadS) +
      this.handTurnS + this.handClimbS;
    return Math.max(trace, hand);
  },
};

/**
 * The trace route, after the drawing (2000 x 1250 px canvas, where the line runs from x 265 to 1635
 * at y 757), nudged so the dots stay clear of the hero text, which would fade them out.
 * Units: line widths, origin at the line's left end, y down.
 */
const DRAWN: [number, number][] = [
  // up the left side, above the name, across the top and down the right
  [100, 880], [100, 600], [100, 300], [130, 130], [250, 55], [500, 40], [900, 45], [1200, 70], [1340, 150],
  [1370, 260], [1300, 420], [1270, 505],
  // and back down to the line's left end, in one pass
  [1100, 575], [800, 610], [550, 650], [330, 700], [265, 757],
];
export const ROUTE_N = 48;

/** Catmull-Rom through the drawn points, resampled to ROUTE_N points evenly spaced by length. */
export function traceRoute(): Float32Array {
  const pts = DRAWN.map(([x, y]) => [(x - 265) / 1370, (y - 757) / 1370] as const);
  const dense: [number, number][] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(i - 1, 0)]!, p1 = pts[i]!, p2 = pts[i + 1]!, p3 = pts[Math.min(i + 2, pts.length - 1)]!;
    for (let k = 0; k < 16; k++) {
      const t = k / 16, t2 = t * t, t3 = t2 * t;
      const f = (a: number, b: number, c: number, d: number) =>
        0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      dense.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])]);
    }
  }
  dense.push([pts.at(-1)![0], pts.at(-1)![1]]);
  const len = [0];
  for (let i = 1; i < dense.length; i++) len.push(len[i - 1]! + Math.hypot(dense[i]![0] - dense[i - 1]![0], dense[i]![1] - dense[i - 1]![1]));
  const total = len.at(-1)!;
  const out = new Float32Array(ROUTE_N * 2);
  let j = 0;
  for (let i = 0; i < ROUTE_N; i++) {
    const s = (i / (ROUTE_N - 1)) * total;
    while (j < dense.length - 2 && len[j + 1]! < s) j++;
    const f = (s - len[j]!) / Math.max(1e-9, len[j + 1]! - len[j]!);
    out[i * 2] = dense[j]![0] + (dense[j + 1]![0] - dense[j]![0]) * f;
    out[i * 2 + 1] = dense[j]![1] + (dense[j + 1]![1] - dense[j]![1]) * f;
  }
  return out;
}
