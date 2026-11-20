import {
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  DataTexture,
  FloatType,
  HalfFloatType,
  LinearFilter,
  NearestFilter,
  OrthographicCamera,
  Points,
  RedFormat,
  RGBAFormat,
  Scene,
  ShaderMaterial,
  WebGLRenderer,
  type IUniform,
  type Texture,
} from 'three';
import { GPUComputationRenderer, type Variable } from 'three/examples/jsm/misc/GPUComputationRenderer.js';
import { bus, type Formation, type Tier } from '../scripts/bus';
import { durations, palette, springAt, tracePlayback } from '../tokens/tokens';
import { TIER_SIZE } from './tiers';
import { pointsFragment, pointsVertex, positionShader, velocityShader } from './shaders';
import trace from '../data/hero-trace.json';

/** Formations implemented in v1. The rest of the contract arrives in later phases. */
const FORM_VALUE: Partial<Record<Formation, number>> = { swarm: 0, trace: 1 };
const MASK_SCALE = 1 / 8;
/**
 * How particles meet text (?mask= to compare):
 * box  - fade inside padded element boxes (v1)
 * line - fade around each rendered line of text, softly
 * halo - a weak line fade plus a dark halo on the text itself (CSS), so particles pass behind
 */
type MaskMode = 'box' | 'line' | 'halo';
const MASK_MODES: Record<MaskMode, { strength: number; pad: number; blur: number; lines: boolean }> = {
  box: { strength: 0.85, pad: 10, blur: 2, lines: false },
  line: { strength: 0.9, pad: 6, blur: 3, lines: true },
  halo: { strength: 0.55, pad: 4, blur: 3, lines: true },
};
const PARALLAX = 0.3, WRAP_M = 40;
const TEXT_SELECTOR =
  'main h1, main h2, main h3, main p, main li, main dt, main dd, main th, main td, main figcaption, main a, main .meta, header a, footer a, footer p';

interface Sim {
  size: number;
  gpu: GPUComputationRenderer;
  pos: Variable;
  vel: Variable;
  home: DataTexture;
  points: Points;
  geometry: BufferGeometry;
  material: ShaderMaterial;
}

export interface FieldOptions {
  canvas: HTMLCanvasElement;
  tier: Exclude<Tier, 'static'>;
  halfFloat: boolean;
  reducedMotion: boolean;
  /** Called when the field gives up (too slow) so the page can show the static SVG again. */
  onFallback: (reason: string) => void;
  /** Called after the first rendered frame, so the SVG can fade out under the particles. */
  onFirstFrame: () => void;
}

export class Field {
  readonly stats = { fps: 0, tier: 'mid' as Tier, particles: 0, frames: 0 };
  #o: FieldOptions;
  #renderer: WebGLRenderer;
  #scene = new Scene();
  #camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  #sim: Sim | null = null;
  #traceTex: DataTexture;
  #mask: { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D; tex: CanvasTexture; rects: DOMRect[]; dirty: boolean };
  #shared: Record<string, IUniform>;
  #vw = innerWidth;
  #vh = innerHeight;
  #raf = 0;
  #last = 0;
  #time = 0;
  #scrollY = scrollY;
  #scrollDy = 0;
  #form = { from: 0, to: 0, start: 0, value: 0 };
  #pointer = { x: -1e4, y: -1e4, strength: 0, lastMove: 0 };
  #probe: number[] = [];
  #probeDone = false;
  #probeAt = 2.5;
  #stepped = false;
  #fade = 0;
  #off: Array<() => void> = [];
  #disposed = false;

  constructor(o: FieldOptions) {
    this.#o = o;
    this.#renderer = new WebGLRenderer({
      canvas: o.canvas,
      antialias: false,
      alpha: true,
      premultipliedAlpha: false,
      powerPreference: 'high-performance',
    });
    this.#renderer.setClearColor(0x000000, 0);
    // Checking link status forces a synchronous wait for the driver to compile each shader.
    // Production skips it so compilation stays off the main thread; dev keeps the error messages.
    this.#renderer.debug.checkShaderErrors = import.meta.env.DEV;

    const pts = Float32Array.from(trace.points);
    this.#traceTex = new DataTexture(pts, pts.length, 1, RedFormat, FloatType);
    this.#traceTex.minFilter = this.#traceTex.magFilter = NearestFilter;
    this.#traceTex.needsUpdate = true;

    const mc = document.createElement('canvas');
    const ctx = mc.getContext('2d')!;
    const tex = new CanvasTexture(mc);
    tex.minFilter = tex.magFilter = LinearFilter;
    tex.generateMipmaps = false;
    this.#mask = { canvas: mc, ctx, tex, rects: [], dirty: true };

    // Raw sRGB palette values: ShaderMaterial does no colour conversion, so the dots match the CSS exactly.
    const c = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
    this.#shared = {
      uTime: { value: 0 },
      uDt: { value: 1 / 60 },
      uForm: { value: 0 },
      uViewport: { value: [this.#vw, this.#vh] },
      uTraceRect: { value: [0, 0, 1, 1] },
      uPhase: { value: 0 },
      uPointer: { value: [-1e4, -1e4, 0] },
      uScrollDy: { value: 0 },
      uScroll: { value: scrollY },
      uSnap: { value: 0 },
      uMaskStrength: { value: MASK_MODES[maskMode()].strength },
      uTrace: { value: this.#traceTex },
      uTraceN: { value: pts.length },
      uPixelRatio: { value: 1 },
      uOlive: { value: c(palette.olive) },
      uBronze: { value: c(palette.bronzeBright) },
      uBone: { value: c(palette.bone) },
      uMask: { value: tex },
      uFade: { value: 0 },
    };

    document.documentElement.dataset.mask = maskMode();
    performance.mark('field:renderer');
  }

  /**
   * Startup is split into tasks with a yield between each, so no single task blocks input for long:
   * build the sim (compiles the compute shaders), compile the point shader, then start the loop.
   * Particles are placed directly on their starting formation, so nothing animates on load.
   */
  async start(): Promise<void> {
    const o = this.#o;
    const yieldTask = () => new Promise<void>((r) => setTimeout(r, 0));
    this.#resize();
    // Only what is on screen now counts: the bus may still remember a hero the visitor has scrolled past.
    const startForm: Formation = this.#heroVisible() ? 'trace' : 'swarm';
    this.#form = { from: FORM_VALUE[startForm]!, to: FORM_VALUE[startForm]!, start: 0, value: FORM_VALUE[startForm]! };
    await yieldTask();
    if (this.#disposed) return;
    this.#build(TIER_SIZE[o.tier]);
    this.stats.tier = o.tier;
    performance.mark('field:built');
    await yieldTask();
    if (this.#disposed) return;
    this.#renderer.compile(this.#scene, this.#camera);
    performance.mark('field:compiled');
    await yieldTask();
    if (this.#disposed) return;
    this.#step(1 / 60); // first compute pass compiles the two sim shaders
    performance.mark('field:sim-compiled');
    await yieldTask();
    if (this.#disposed) return;
    this.#listen();
    if (o.reducedMotion) {
      this.#fade = 1;
      this.#renderOnce();
      o.onFirstFrame();
    } else {
      this.#last = performance.now();
      this.#raf = requestAnimationFrame(this.#frame);
    }
  }

  /** Public API (contract from the brief). recruit/stream/setDrift land with the demo in Phase 4. */
  setFormation(name: Formation, instant = false): void {
    const to = FORM_VALUE[name];
    if (to === undefined) return;
    const now = performance.now();
    // Leaving the trace after it has already scrolled out of view (a fast scroll): don't fly thousands
    // of particles back from off-screen. Place them at their swarm homes and fade the field back in.
    if (to === 0 && this.#form.value > 0.5 && !this.#traceOnScreen() && this.#sim) {
      this.#form = { from: 0, to: 0, start: now, value: 0 };
      this.#shared.uSnap!.value = 1;
      this.#step(1 / 60);
      this.#shared.uSnap!.value = 0;
      this.#fade = 0;
      return;
    }
    this.#form = { from: instant ? to : this.#form.value, to, start: now, value: instant ? to : this.#form.value };
    if (this.#o.reducedMotion && !this.#disposed && this.#sim) {
      this.#form.value = to;
      this.#settle(90);
      this.#renderOnce();
    }
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    cancelAnimationFrame(this.#raf);
    this.#off.forEach((f) => f());
    this.#teardownSim();
    this.#traceTex.dispose();
    this.#mask.tex.dispose();
    this.#renderer.dispose();
    this.#renderer.forceContextLoss();
  }

  // ---------------------------------------------------------------- simulation

  #build(size: number): void {
    const r = this.#renderer;
    const gpu = new GPUComputationRenderer(size, size, r);
    if (this.#o.halfFloat) gpu.setDataType(HalfFloatType);
    const n = size * size;

    // Swarm homes: a jittered grid, so the idle field covers the page evenly.
    // Trace u is the rank of each home's x, so particles that sit together in the swarm
    // sit together on the line and a morph moves neighbourhoods, not individuals.
    const homes = new Float32Array(n * 4);
    const order = new Uint32Array(n);
    const cols = Math.ceil(Math.sqrt(n * (this.#vw / Math.max(this.#vh, 1))));
    const rows = Math.ceil(n / cols);
    for (let i = 0; i < n; i++) {
      const gx = i % cols, gy = Math.floor(i / cols);
      homes[i * 4] = (gx + Math.random()) / cols;
      homes[i * 4 + 1] = (gy + Math.random()) / rows;
      homes[i * 4 + 2] = Math.random();
      order[i] = i;
    }
    order.sort((a, b) => homes[a * 4]! - homes[b * 4]!);
    for (let rank = 0; rank < n; rank++) homes[order[rank]! * 4 + 3] = rank / (n - 1);
    const home = new DataTexture(homes, size, size, RGBAFormat, FloatType);
    home.minFilter = home.magFilter = NearestFilter;
    home.needsUpdate = true;

    const p0 = gpu.createTexture();
    const v0 = gpu.createTexture();
    const pa = p0.image.data as Float32Array;
    this.#shared.uPhase!.value = playbackPhase();
    this.#updateTraceRect();
    const [rx, ry, rw, rh] = this.#shared.uTraceRect!.value as number[];
    const onTrace = this.#form.value > 0.5;
    const pts = trace.points, last = pts.length - 1;
    for (let i = 0; i < n; i++) {
      const seed = Math.random();
      if (onTrace) {
        // Same target as traceTarget() in the shader, evaluated once on the CPU.
        const u = homes[i * 4 + 3]!;
        const v = (u + (this.#shared.uPhase!.value as number)) * 0.5;
        const x = (1 - Math.abs(1 - 2 * (v - Math.floor(v)))) * last;
        const k = Math.floor(x), f = x - k;
        const sv = pts[k]! * (1 - f) + pts[Math.min(k + 1, last)]! * f;
        pa[i * 4] = rx! + u * rw!;
        pa[i * 4 + 1] = ry! + rh! * 0.5 - sv * rh! * 0.44 + (seed - 0.5) * 2.4;
      } else {
        const span = this.#vh + 2 * WRAP_M;
        const hy = homes[i * 4 + 1]! * span - scrollY * PARALLAX;
        pa[i * 4] = homes[i * 4]! * this.#vw;
        pa[i * 4 + 1] = hy - Math.floor(hy / span) * span - WRAP_M;
      }
      pa[i * 4 + 3] = seed;
    }
    const pos = gpu.addVariable('texPos', positionShader, p0);
    const vel = gpu.addVariable('texVel', velocityShader, v0);
    gpu.setVariableDependencies(pos, [pos, vel]);
    gpu.setVariableDependencies(vel, [pos, vel]);
    for (const v of [pos, vel]) {
      Object.assign(v.material.uniforms, this.#shared, { uHome: { value: home } });
    }
    const err = gpu.init();
    if (err) throw new Error(err);

    const refs = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) {
      refs[i * 2] = ((i % size) + 0.5) / size;
      refs[i * 2 + 1] = (Math.floor(i / size) + 0.5) / size;
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(new Float32Array(n * 3), 3));
    geometry.setAttribute('ref', new BufferAttribute(refs, 2));
    const material = new ShaderMaterial({
      vertexShader: pointsVertex,
      fragmentShader: pointsFragment,
      uniforms: { ...this.#shared, uHome: { value: home }, texPos: { value: null }, texVel: { value: null } },
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });
    const points = new Points(geometry, material);
    points.frustumCulled = false;
    this.#scene.add(points);
    this.#sim = { size, gpu, pos, vel, home, points, geometry, material };
    this.stats.particles = n;
  }

  #teardownSim(): void {
    const s = this.#sim;
    if (!s) return;
    this.#scene.remove(s.points);
    s.geometry.dispose();
    s.material.dispose();
    s.home.dispose();
    s.gpu.dispose();
    this.#sim = null;
  }

  #step(dt: number): void {
    const s = this.#sim!;
    const u = this.#shared;
    u.uDt!.value = dt;
    u.uTime!.value = this.#time;
    u.uForm!.value = this.#form.value;
    u.uScrollDy!.value = this.#scrollDy;
    u.uScroll!.value = this.#scrollY;
    u.uPhase!.value = playbackPhase();
    this.#scrollDy = 0;
    s.gpu.compute();
  }

  #settle(steps: number): void {
    this.#updateTraceRect();
    for (let i = 0; i < steps; i++) this.#step(1 / 60);
  }

  // ---------------------------------------------------------------- frame loop

  #frame = (now: number): void => {
    if (this.#disposed) return;
    this.#raf = requestAnimationFrame(this.#frame);
    const raw = (now - this.#last) / 1000;
    this.#last = now;
    const dt = Math.min(raw, 1 / 30);
    this.#time += dt;

    const t = Math.min(1, (now - this.#form.start) / durations.morph);
    this.#form.value = this.#form.from + (this.#form.to - this.#form.from) * springAt(t);

    const p = this.#pointer;
    if (now - p.lastMove > 1200) p.strength *= 0.92;
    this.#shared.uPointer!.value = [p.x, p.y, p.strength];

    this.#updateTraceRect();
    this.#step(dt);
    this.#fade = Math.min(1, this.#fade + dt / (durations.ui / 1000));
    this.#render();
    this.stats.frames++;
    if (this.stats.frames === 1) {
      performance.mark('field:first-frame');
      this.#o.onFirstFrame();
    }
    this.#measure(raw);
  };

  #render(): void {
    const s = this.#sim!;
    if (this.#mask.dirty) this.#drawMask();
    s.material.uniforms.texPos!.value = s.gpu.getCurrentRenderTarget(s.pos).texture as Texture;
    s.material.uniforms.texVel!.value = s.gpu.getCurrentRenderTarget(s.vel).texture as Texture;
    this.#shared.uFade!.value = this.#fade;
    this.#renderer.render(this.#scene, this.#camera);
  }

  #renderOnce(): void {
    if (this.#sim && !this.#disposed) this.#render();
  }

  /** Rolling fps, plus the one-off tier probe: 1 s of frames after a 1.5 s warm-up. */
  #measure(raw: number): void {
    if (raw <= 0 || raw > 0.5) return;
    this.#probe.push(raw);
    if (this.#probe.length > 90) this.#probe.shift();
    // Mean over the last 90 frames, so dropped frames count (a median would hide them).
    this.stats.fps = Math.round(this.#probe.length / this.#probe.reduce((a, b) => a + b, 0));
    if (this.#probeDone || this.#time < this.#probeAt || this.#probe.length < 60) return;
    this.#probeDone = true;
    const fps = this.stats.fps;
    const forced = new URLSearchParams(location.search).has('tier');
    if (fps < 30) {
      // Step down once before giving up: high -> mid -> static SVG.
      if (this.stats.tier === 'high') {
        this.#stepped = true;
        this.#rebuild(TIER_SIZE.mid, 'mid', `fps probe ${fps} at high`);
      } else {
        this.#o.onFallback(`measured ${fps} fps at ${this.stats.particles} particles`);
      }
      return;
    }
    if (!forced && !this.#stepped && this.stats.tier === 'mid' && fps >= 57 && !matchMedia('(pointer: coarse)').matches) {
      this.#rebuild(TIER_SIZE.high, 'high', `fps probe ${fps} at mid`);
    } else {
      bus.emit('field:tier', { tier: this.stats.tier, particles: this.stats.particles, reason: `fps probe ${fps}` });
    }
  }

  #rebuild(size: number, tier: Tier, reason: string): void {
    this.#teardownSim();
    this.stats.tier = tier;
    this.#resize(); // the DPR cap depends on the tier
    this.#build(size);
    this.#probe = [];
    // Probe again at the new size: a promotion that turns out too slow steps back down.
    this.#probeDone = false;
    this.#probeAt = this.#time + 2.5;
    bus.emit('field:tier', { tier, particles: size * size, reason });
  }

  // ---------------------------------------------------------------- DOM inputs

  #heroVisible(): boolean {
    const el = document.querySelector('.hero-trace svg');
    if (!el) return false;
    const r = el.getBoundingClientRect();
    return r.bottom > this.#vh * 0.2 && r.top < this.#vh * 0.8;
  }

  #traceOnScreen(): boolean {
    const el = document.querySelector('.hero-trace svg');
    if (!el) return false;
    const r = el.getBoundingClientRect();
    return r.bottom > 0 && r.top < this.#vh;
  }

  #updateTraceRect(): void {
    const el = document.querySelector('.hero-trace svg');
    if (!el) {
      // Pages without the hero: park the line off-screen; the formation is never asked for there.
      this.#shared.uTraceRect!.value = [0, -400, this.#vw, 100];
      return;
    }
    const r = el.getBoundingClientRect();
    this.#shared.uTraceRect!.value = [r.x, r.y, r.width, r.height];
  }

  #resize = (): void => {
    this.#vw = innerWidth;
    this.#vh = innerHeight;
    const cap = this.stats.tier === 'high' ? 2 : 1.5;
    const pr = Math.min(devicePixelRatio || 1, cap);
    this.#renderer.setPixelRatio(pr);
    this.#renderer.setSize(this.#vw, this.#vh, false);
    this.#shared.uViewport!.value = [this.#vw, this.#vh];
    this.#shared.uPixelRatio!.value = pr;
    const m = this.#mask;
    m.canvas.width = Math.max(1, Math.round(this.#vw * MASK_SCALE));
    m.canvas.height = Math.max(1, Math.round(this.#vh * MASK_SCALE));
    this.#measureText();
  };

  /** Text rects in document coordinates; re-read on resize and when layout changes. */
  #measureText(): void {
    const sx = scrollX, sy = scrollY;
    const lines = MASK_MODES[maskMode()].lines;
    const range = document.createRange();
    const rects: DOMRect[] = [];
    for (const el of document.querySelectorAll<HTMLElement>(TEXT_SELECTOR)) {
      if (el.closest('.hero-trace svg')) continue;
      let list: ArrayLike<DOMRect>;
      if (lines) {
        // One rect per rendered line of text, so the fade follows the words, not the block.
        range.selectNodeContents(el);
        list = range.getClientRects();
      } else list = [el.getBoundingClientRect()];
      for (const r of Array.from(list)) {
        if (r.width > 0 && r.height > 0) rects.push(new DOMRect(r.x + sx, r.y + sy, r.width, r.height));
      }
    }
    this.#mask.rects = rects;
    this.#mask.dirty = true;
  }

  #drawMask(): void {
    const { ctx, canvas, rects, tex } = this.#mask;
    const sy = scrollY, sx = scrollX;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const mode = MASK_MODES[maskMode()];
    ctx.filter = `blur(${mode.blur}px)`;
    ctx.fillStyle = '#fff';
    const pad = mode.pad;
    for (const r of rects) {
      const y = r.y - sy;
      if (y + r.height < -pad || y > this.#vh + pad) continue;
      ctx.fillRect(
        (r.x - sx - pad) * MASK_SCALE,
        (y - pad) * MASK_SCALE,
        (r.width + 2 * pad) * MASK_SCALE,
        (r.height + 2 * pad) * MASK_SCALE,
      );
    }
    ctx.filter = 'none';
    tex.needsUpdate = true;
    this.#mask.dirty = false;
  }

  #listen(): void {
    const on = <K extends keyof WindowEventMap | keyof DocumentEventMap>(
      t: K,
      f: (e: K extends keyof WindowEventMap ? WindowEventMap[K] : Event) => void,
      target: Window | Document = window,
    ) => {
      target.addEventListener(t, f as EventListener, { passive: true });
      this.#off.push(() => target.removeEventListener(t, f as EventListener));
    };
    let settleTimer = 0;
    const stillUpdate = () => {
      if (!this.#o.reducedMotion) return;
      clearTimeout(settleTimer);
      settleTimer = window.setTimeout(() => {
        this.#settle(60);
        this.#renderOnce();
      }, 120);
    };
    on('resize', () => {
      this.#resize();
      stillUpdate();
    });
    on('scroll', () => {
      const y = scrollY;
      this.#scrollDy += y - this.#scrollY;
      this.#scrollY = y;
      this.#mask.dirty = true;
      stillUpdate();
    });
    on('pointermove', (e) => {
      if (this.#o.reducedMotion) return;
      this.#pointer.x = e.clientX;
      this.#pointer.y = e.clientY;
      this.#pointer.strength = e.pointerType === 'touch' ? 0.6 : 1;
      this.#pointer.lastMove = performance.now();
    });
    on('pointerleave', () => (this.#pointer.strength = 0), document);
    on('visibilitychange', () => {
      const hidden = document.hidden;
      bus.emit('field:pause', { paused: hidden });
      if (this.#o.reducedMotion) return;
      cancelAnimationFrame(this.#raf);
      if (!hidden && !this.#disposed) {
        this.#last = performance.now();
        this.#raf = requestAnimationFrame(this.#frame);
      }
    }, document);

    const ro = new ResizeObserver(() => this.#measureText());
    ro.observe(document.body);
    this.#off.push(() => ro.disconnect());

    this.#off.push(
      bus.on('section:enter', ({ id }) => {
        if (id === 'hero') this.setFormation('trace');
      }),
      bus.on('section:leave', ({ id }) => {
        if (id === 'hero') this.setFormation('swarm');
      }),
    );
  }
}

function maskMode(): MaskMode {
  const m = new URLSearchParams(location.search).get('mask');
  return m === 'box' || m === 'line' || m === 'halo' ? m : DEFAULT_MASK;
}
export const DEFAULT_MASK: MaskMode = 'halo';

/**
 * Playback position in trace lengths. Reads the static SVG's CSS animation clock when it exists,
 * so the particles pick up the line exactly where the SVG left it.
 */
function playbackPhase(): number {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return 0;
  const anim = document.querySelector('.hero-trace .tape')?.getAnimations()[0];
  const ms = typeof anim?.currentTime === 'number' ? anim.currentTime : performance.now();
  return (2 * (ms / 1000)) / tracePlayback.periodS;
}
