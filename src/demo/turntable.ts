/**
 * The demo's map on screen: clouds, window dots and labels in the SVG, turned in 3D on wide screens
 * (slowly by itself, facing front while the visitor holds a gesture, or by dragging), and the same
 * view sent to the Field so its dots fill the clouds from the same angle.
 */
import { bus } from '../scripts/bus';
import type { LdaStats } from './lda';
import { clouds, ellipsePath, mapView, mul3, project, rotation, screenCloud, svgScale, turn, TURN, type Cloud3, type Frame, type Vec3 } from './map';

const SVGNS = 'http://www.w3.org/2000/svg';
const MAX_DOTS = 240;
/**
 * The slow turn, as (seconds, yaw in -1..1) keys over one cycle, eased between: it rests facing
 * front, where pinch's drift toward open reads best, and looks round each side in turn.
 */
const KEYS: [number, number][] = [[0, 0], [5, 0], [10, 1], [12.5, 1], [17.5, 0], [22.5, 0], [27.5, -1], [30, -1], [35, 0]];
/** After a hold or a drag, how long the map waits before it turns again. */
const IDLE_S = 2.5;

export interface MapControl {
  setClouds(stats: LdaStats): void;
  addDot(row: ArrayLike<number>, ok: boolean): void;
  clearDots(): void;
  /** Dots from earlier holds fade back. */
  ageDots(): void;
  pick(k: number): void;
  mine(k: number): void;
  holding(on: boolean): void;
}

export function mountMap(root: HTMLElement, model: { origin: number[]; axes: number[][] }, day1: LdaStats): MapControl {
  const $ = <T extends Element>(sel: string) => root.querySelector<T>(sel)!;
  const svg = $<SVGSVGElement>('[data-field-stage]');
  const view = mapView(model);
  const frame = JSON.parse(svg.dataset.frame!) as Frame;
  const S = svgScale(frame, 440);
  const zs = 2 / (frame.x1 - frame.x0); // depth in about -1..1 for the Field
  const dotsG = $<SVGGElement>('[data-dots]');
  const cloudPaths = [...root.querySelectorAll<SVGPathElement>('.cloud')];
  const ghostPaths = [...root.querySelectorAll<SVGPathElement>('.ghost')];
  const labels = [...root.querySelectorAll<SVGTextElement>('.label')];
  const dots: { el: SVGCircleElement; p: Vec3 }[] = [];
  const ghosts = clouds(day1, view);
  let current: Cloud3[] = ghosts;

  const wide = matchMedia('(min-width: 68rem)');
  const still = matchMedia('(prefers-reduced-motion: reduce)');
  const turns = () => wide.matches && !still.matches;
  let yaw = 0, pitch = 0;

  const draw = () => {
    const R = rotation(yaw, pitch);
    const sc = current.map((c) => screenCloud(c, R, frame));
    sc.forEach((c, k) => {
      cloudPaths[k]!.setAttribute('d', ellipsePath(c, 2, S.x, S.y));
      labels[k]!.setAttribute('x', S.x(c.cx).toFixed(1));
      labels[k]!.setAttribute('y', (S.y(c.cy + 2 * Math.hypot(c.l21, c.l22)) - 6).toFixed(1));
    });
    ghosts.forEach((c, k) => ghostPaths[k]!.setAttribute('d', ellipsePath(screenCloud(c, R, frame), 2, S.x, S.y)));
    for (const d of dots) {
      const [x, y] = turn(R, d.p, frame);
      d.el.setAttribute('cx', S.x(x).toFixed(1));
      d.el.setAttribute('cy', S.y(y).toFixed(1));
    }
    // In 0..1 of the map's box, y down: the Field samples each cloud as c + M z for a 3D z.
    bus.emit('emg:map', {
      clouds: current.map((c) => {
        const [x, y, z] = turn(R, c.c, frame);
        const M = mul3(R, c.L);
        const sx = S.k / S.w, sy = -S.k / S.h;
        return [S.x(x) / S.w, S.y(y) / S.h, z * zs, ...M.slice(0, 3).map((v) => v * sx), ...M.slice(3, 6).map((v) => v * sy), ...M.slice(6).map((v) => v * zs)];
      }),
    });
  };

  // ------------------------------------------------------------------ the turn

  let raf = 0, last = 0, clock = 0, idle = IDLE_S, held = false, dragging = false, visible = false;
  const keyAt = (t: number) => {
    const T = KEYS[KEYS.length - 1]![0];
    t %= T;
    let i = 0;
    while (KEYS[i + 1]![0] < t) i++;
    const [t0, a] = KEYS[i]!, [t1, b] = KEYS[i + 1]!;
    const u = Math.min(1, Math.max(0, (t - t0) / (t1 - t0)));
    return a + (b - a) * u * u * (3 - 2 * u);
  };
  const frameStep = (now: number) => {
    raf = 0;
    const dt = Math.min(0.1, Math.max(0, (now - last) / 1000));
    last = now;
    if (!dragging) {
      let ty = 0, tp = 0;
      if (held) (clock = 0), (idle = 0);
      else if ((idle += dt) >= IDLE_S) {
        clock += dt;
        const u = keyAt(clock);
        ty = u * TURN.yaw;
        tp = Math.abs(u) * TURN.pitch;
      } else (ty = yaw), (tp = pitch);
      const k = 1 - Math.exp(-dt * (held ? 4 : 2));
      yaw += (ty - yaw) * k;
      pitch += (tp - pitch) * k;
    }
    draw();
    schedule();
  };
  const schedule = () => {
    if (raf || !turns() || !visible || document.hidden) return;
    last = performance.now();
    raf = requestAnimationFrame(frameStep);
  };
  const settleFront = () => {
    if (raf) cancelAnimationFrame(raf), (raf = 0);
    yaw = pitch = 0;
    draw();
  };
  const update = () => {
    svg.toggleAttribute('data-turns', turns());
    if (turns()) schedule();
    else settleFront();
  };
  wide.addEventListener('change', update);
  still.addEventListener('change', update);
  document.addEventListener('visibilitychange', schedule);
  new IntersectionObserver((es) => {
    visible = es.some((e) => e.isIntersecting);
    schedule();
  }).observe(svg);

  // Drag to turn it (mouse or pen; a finger keeps scrolling the page).
  let px = 0, py = 0;
  svg.addEventListener('pointerdown', (e) => {
    if (!turns() || e.button !== 0 || e.pointerType === 'touch') return;
    dragging = true;
    px = e.clientX;
    py = e.clientY;
    svg.setAttribute('data-dragging', '');
    try {
      svg.setPointerCapture(e.pointerId);
    } catch {
      /* already released */
    }
    e.preventDefault();
  });
  svg.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const k = 1 / 160;
    yaw = Math.max(-TURN.yaw, Math.min(TURN.yaw, yaw + (e.clientX - px) * k));
    pitch = Math.max(-TURN.pitch, Math.min(TURN.pitch, pitch + (e.clientY - py) * k));
    px = e.clientX;
    py = e.clientY;
  });
  const endDrag = () => {
    if (!dragging) return;
    dragging = false;
    idle = 0;
    // Rest a moment where the visitor left it, then ease back to front and carry on turning.
    clock = 0;
    svg.removeAttribute('data-dragging');
  };
  for (const t of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) svg.addEventListener(t, endDrag);

  const control: MapControl = {
    setClouds(stats) {
      current = clouds(stats, view);
      draw();
    },
    addDot(row, ok) {
      dots.at(-1)?.el.setAttribute('r', '3');
      const el = document.createElementNS(SVGNS, 'circle');
      const p = project(view, row);
      const [x, y] = turn(rotation(yaw, pitch), p, frame);
      el.setAttribute('cx', S.x(x).toFixed(1));
      el.setAttribute('cy', S.y(y).toFixed(1));
      el.setAttribute('r', '5');
      el.setAttribute('class', ok ? 'dot' : 'dot miss');
      dotsG.append(el);
      dots.push({ el, p });
      while (dots.length > MAX_DOTS) dots.shift()!.el.remove();
    },
    clearDots() {
      dots.length = 0;
      dotsG.replaceChildren();
    },
    ageDots() {
      for (const d of dots) d.el.classList.add('old');
    },
    pick(k) {
      labels.forEach((l, i) => l.toggleAttribute('data-picked', i === k));
    },
    mine(k) {
      labels.forEach((l, i) => l.toggleAttribute('data-mine', i === k));
    },
    holding(on) {
      held = on;
      if (!on) idle = 0;
    },
  };
  update();
  draw();
  return control;
}
