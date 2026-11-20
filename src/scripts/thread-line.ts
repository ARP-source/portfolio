/**
 * Where a project's thread is drawn (Phase 5). An element marked data-thread-line is either a
 * sparkline's <svg>, whose dots then trace the series itself, or a run of text, which gets a line
 * drawn just under it. Shared by the Field and by boot.ts, which saves the clicked card's line so
 * the next page can start its dots there.
 */
export const THREAD_N = 32;

export type Rect = [x: number, y: number, w: number, h: number];

/** The line's box on screen now, CSS px. Null when it isn't laid out. */
export function threadRect(el: Element): Rect | null {
  const path = el instanceof SVGSVGElement ? el.querySelector('path.trace') : null;
  if (path) {
    const r = path.getBoundingClientRect();
    return r.width > 0 ? [r.x, r.y, r.width, r.height] : null;
  }
  const range = document.createRange();
  range.selectNodeContents(el);
  const r = range.getBoundingClientRect();
  return r.width > 0 ? [r.x, r.bottom + 6, r.width, 0] : null;
}

const cache = new WeakMap<Element, number[]>();

/** The line's height (0 top .. 1 bottom of its box) at THREAD_N evenly spaced points across it. */
export function threadHeights(el: Element): number[] {
  const hit = cache.get(el);
  if (hit) return hit;
  const path = el instanceof SVGSVGElement ? el.querySelector<SVGPathElement>('path.trace') : null;
  let ys = new Array<number>(THREAD_N).fill(0);
  if (path) {
    const bb = path.getBBox();
    const len = path.getTotalLength();
    const pts: Array<[number, number]> = [];
    for (let i = 0; i <= 256; i++) {
      const p = path.getPointAtLength((len * i) / 256);
      pts.push([(p.x - bb.x) / (bb.width || 1), (p.y - bb.y) / (bb.height || 1)]);
    }
    // Sparklines run left to right, so x only grows along the path.
    let j = 0;
    ys = ys.map((_, k) => {
      const u = k / (THREAD_N - 1);
      while (j < pts.length - 2 && pts[j + 1]![0] < u) j++;
      const [x0, y0] = pts[j]!, [x1, y1] = pts[j + 1]!;
      const f = x1 > x0 ? Math.min(1, Math.max(0, (u - x0) / (x1 - x0))) : 0;
      return y0 + (y1 - y0) * f;
    });
  }
  cache.set(el, ys);
  return ys;
}
