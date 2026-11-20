import {
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  DataTexture,
  FloatType,
  HalfFloatType,
  LinearFilter,
  Mesh,
  PlaneGeometry,
  NearestFilter,
  OrthographicCamera,
  Points,
  RedFormat,
  RGBAFormat,
  Scene,
  ShaderMaterial,
  WebGLRenderer,
  type WebGLRenderTarget,
  Vector3,
  type IUniform,
  type Texture,
} from 'three';
import { GPUComputationRenderer, type Variable } from 'three/examples/jsm/misc/GPUComputationRenderer.js';
import { bus, type Formation, type Tier } from '../scripts/bus';
import { durations, palette, tracePlayback } from '../tokens/tokens';
import { TIER_SIZE } from './tiers';
import { THREAD, pointsFragment, pointsVertex, positionShader, velocityShader } from './shaders';
import { THREAD_N, threadHeights, threadRect, type Rect } from '../scripts/thread-line';
import trace from '../data/hero-trace.json';
import { REFORM, traceRoute } from './reform';
import { BONES, POSES, SEQUENCE, blendPose, handWorld, loadHand, poseBones, projectHand, type HandData, type Pose } from './hand';

/** Formations implemented in v1. The rest of the contract arrives in later phases. */
const FORM_VALUE: Partial<Record<Formation, number>> = { swarm: 0, trace: 1 };
const MASK_SCALE = 1 / 8;
/** Device pixels the canvas may cover at the mid tier (about a 1440 x 900 screen at 1.1x). */
const MID_PIXELS = 1.6e6;
/** Texture height cap for the page-sized mask (very long pages are squeezed vertically). */
const MASK_MAX = 4096;
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
  // Under a line of text the dots fade to about 12 %; the CSS paper halo does the rest.
  halo: { strength: 0.88, pad: 4, blur: 3, lines: true },
};
/**
 * The flock (flockChunk in shaders.ts). Leaving the hero it is held where the hero was and drifts
 * out to its own path over holdS; a scroll drags it by kick of the distance, then it catches up.
 */
const FLOCK = { holdS: 1.6, kick: 0.25, kickMax: 0.22, catchUp: 1.2 };
/** How long the hero takes to dissolve into the swarm; each particle's own release is a slice of it. */
const RELEASE_MS = 700;
const TOUCH = matchMedia('(pointer: coarse)').matches;
/** Re-forming in place (reduced motion, or scrolling back before the hero has fully let go). */
const FORM_MS = 1900;
/**
 * Scroll pace: a fast scroll speeds the break-up and the re-form up (to max times), so the page
 * has settled by the time the reader looks. Below fromVh screens per second (reading speed)
 * nothing changes; at fullVh and faster it runs at max. leadS: how far ahead a fast scroll is
 * read, so the hero lets go (or starts re-forming) before the trigger point actually arrives.
 */
const PACE = { fromVh: 0.6, fullVh: 3, max: 3, leadS: 0.45, leadMaxVh: 0.3 };
const TEXT_SELECTOR =
  'main h1, main h2, main h3, main p, main li, main dt, main dd, main th, main td, main figcaption, main a, main .meta, header a, footer a, footer p';

/** Hand: one slow turn every spinS seconds; a fixed three-quarter view with reduced motion. */
const HAND = { spinS: 30, reducedSpin: -28 };
/**
 * Demo: lossFull is the accuracy loss (day 1 minus now) that reads as fully drifted; below
 * confident the hand keeps its last pose rather than following a guess.
 */
const DEMO = { lossFull: 0.25, confident: 0.6, poseS: 0.25 };
/** The demo map's clouds, in the order emg:map sends them. */
const CLOUDS = ['close', 'open', 'pinch', 'point'] as const;
const HAND_SPLIT = 0.6;
/**
 * Thread: drawS to draw a project's line left to right, undrawS to let it go again (right to left)
 * before the next one starts. The card whose middle is nearest the middle of the screen, within
 * the pick band (fractions of the screen height), holds it; another card takes over only once it
 * is nearer by margin of the screen, so a card sitting halfway doesn't flip it back and forth.
 */
const THREAD_TIME = { drawS: 1.3, undrawS: 0.5, arriveS: 2.5 };
const THREAD_BAND = { pick: [0.25, 0.75], margin: 0.12 } as const;

interface Sim {
  size: number;
  handLocal: Float32Array;
  handTex: DataTexture;
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
  /** Called when the field can't run (WebGL lost) so the page can show the static SVG again. */
  onFallback: (reason: string) => void;
  /** Called after the first rendered frame, so the SVG can fade out under the particles. */
  onFirstFrame: () => void;
  /** The tier came from an earlier page's probe this visit: don't probe it upward again. */
  knownTier?: boolean;
  /** Opened from a project card: where that card's line was, so its dots start there. */
  arrive?: { slug: string; rect: Rect; ys: number[] } | undefined;
}

export class Field {
  readonly stats = { fps: 0, tier: 'mid' as Tier, particles: 0, frames: 0 };
  #o: FieldOptions;
  #renderer: WebGLRenderer;
  #scene = new Scene();
  #camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  #sim: Sim | null = null;
  #traceTex: DataTexture;
  #mask: { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D; tex: CanvasTexture; rects: DOMRect[]; dirty: boolean; size: [number, number] };
  #shared: Record<string, IUniform>;
  #vw = innerWidth;
  #vh = innerHeight;
  #raf = 0;
  #last = 0;
  #time = 0;
  #scrollY = scrollY;
  #scrollDy = 0;
  /** hold: where the flock is held while k runs 0 -> 1 (the hero it left, or just above the screen). */
  #flock = { hold: 'free' as 'free' | 'hero' | 'top', k: 1, x: 0, y: 0, kick: 0 };
  #snapNext = false;
  #sized = false;
  #pr = 0;
  /** p: 0..1 through the sweep; pace speeds it up (latched from the scroll speed, only ever raised). */
  #form = { from: 0, to: 0, p: 1, pace: 1, value: 0 };
  /** Smoothed scroll speed, px/s, + down. */
  #scrollV = 0;
  /** How early (px before the trigger) the last release fired; re-forming waits until it is undone. */
  #releaseLead = 0;
  /** Re-forming along the drawn routes: waits until the hero is on screen, then runs REFORM.totalS
   *  of simulation time (so a slow frame slows the whole procession instead of leaving dots behind). */
  #reform = { pending: false, start: -1, t: 0, pace: 1, spin: 0 };
  #handM: Float32Array<ArrayBuffer> = handWorld(0);
  #bones = new Float32Array(BONES * 16);
  #grip = 0;
  // Only fetch the hand where it will show: the hero anchor is hidden on narrow screens.
  #handPts: Promise<HandData | null> = (document.querySelector('.hero-hand')?.getBoundingClientRect().width ?? 0) > 0
    ? loadHand(window.__signal?.hand ?? undefined).catch(() => null)
    : Promise.resolve(null);
  #handReady = false;
  #handData: HandData | null = null;
  /** Which particles make the hand and in how many columns: kept so a hand loaded later can be filled in. */
  #handMap: { n: number; size: number; ids: number[]; cols: number } | null = null;
  #handLoading = false;
  /** Between pageChanged() and measure(): the page is still gliding in. */
  #swapping = false;
  #bleed = 0;
  #bleedTarget = 0;
  /** The demo: wired up (stage), eased weights, and what the classifier last said. */
  #demo = {
    stage: false, map: false, on: 0, view: 0, env: 0, envTo: 0, picked: -1, loss: 0, hand: 0, seen: false,
    pose: 'rest' as keyof typeof POSES,
  };
  #demoPose: Pose = POSES.rest.map((q) => [...q] as Pose[number]);
  /**
   * The demo's map sits in a sticky column on wide screens. While it is stuck the browser keeps it
   * still on screen between frames, so the canvas has to stay still too (fixed to the viewport),
   * not travel with the page until the next frame catches up and pulls the clouds back.
   */
  #pinToViewport = false;
  #stillTimer = 0;
  #pointer = { x: -1e4, y: -1e4, strength: 0, lastMove: 0 };
  #probe: number[] = [];
  #probeDone = false;
  #probeAt = 2.5;
  #stepped = false;
  /** A slow probe at mid gets one more look before the field gives up: a load hitch is not a slow GPU. */
  #retried = false;
  /** Still slow after the retry at mid: the canvas drops to 1x instead of the field switching off. */
  #lean = false;
  #fade = 0;
  /** The thread: which line it draws (el), how far the pen has got, and a hand-over in progress. */
  #thread = { el: null as Element | null, pen: 0, arriving: 0, cards: [] as HTMLElement[] };
  #off: Array<() => void> = [];
  #disposed = false;

  constructor(o: FieldOptions) {
    this.#o = o;
    this.#renderer = new WebGLRenderer({
      canvas: o.canvas,
      antialias: false,
      alpha: true,
      // Premultiplied: on a light page, straight alpha leaves dark fringes where dots overlap.
      premultipliedAlpha: true,
      powerPreference: 'high-performance',
    });
    this.#renderer.setClearColor(0x000000, 0);
    // Checking link status forces a synchronous wait for the driver to compile each shader.
    // Production skips it so compilation stays off the main thread; dev keeps the error messages.
    this.#renderer.debug.checkShaderErrors = import.meta.env.DEV;

    if (trace.clips.length !== SEQUENCE.length || trace.clips.some((c, i) => c.key !== SEQUENCE[i]))
      throw new Error('hero-trace.json clips must match the hand SEQUENCE');
    const pts = Float32Array.from(TAPE);
    this.#traceTex = new DataTexture(pts, pts.length, 1, RedFormat, FloatType);
    this.#traceTex.minFilter = this.#traceTex.magFilter = NearestFilter;
    this.#traceTex.needsUpdate = true;

    const mc = document.createElement('canvas');
    const ctx = mc.getContext('2d')!;
    const tex = new CanvasTexture(mc);
    tex.minFilter = tex.magFilter = LinearFilter;
    tex.generateMipmaps = false;
    this.#mask = { canvas: mc, ctx, tex, rects: [], dirty: true, size: [1, 1] };

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
      uFlockT: { value: 0 },
      uAnchor: { value: [0, 0, 1] },
      uKick: { value: 0 },
      uAbort: { value: 0 },
      uPace: { value: 1 },
      uSnap: { value: 0 },
      uMaskStrength: { value: MASK_MODES[maskMode()].strength },
      uTrace: { value: this.#traceTex },
      uTraceN: { value: pts.length },
      uClipN: { value: PER_CLIP },
      uReform: { value: -1 },
      uSpinT: { value: 0 },
      uRoute: { value: traceRoute() },
      uPixelRatio: { value: 1 },
      uTissue: { value: c(palette.tissue) },
      uInk: { value: c(palette.ink) },
      uDrift: { value: c(palette.drift) },
      uInkDim: { value: c(palette.inkDim) },
      uBleed: { value: 0 },
      uHandOn: { value: 0 },
      uHandRect: { value: [0, -1000, 1, 1] },
      uBones: { value: this.#bones },
      uHandLocal: { value: null },
      uMask: { value: tex },
      uMaskView: { value: [0, 0, 1, 1] },
      uFade: { value: 0 },
      uDemo: { value: [0, 0, 0, 0] },
      uDemoRect: { value: [0, -1000, 1, 1] },
      uDemoVel: { value: [0, 0] },
      uMapC: { value: Array.from({ length: 4 }, () => new Vector3(0.5, 0.5, 0)) },
      uMapX: { value: Array.from({ length: 4 }, () => new Vector3(0.05, 0, 0)) },
      uMapY: { value: Array.from({ length: 4 }, () => new Vector3(0, 0.05, 0)) },
      uMapZ: { value: Array.from({ length: 4 }, () => new Vector3(0, 0, 0.05)) },
      uThread: { value: [0, 0, 0, 0] },
      uThreadRect: { value: [0, -1000, 1, 1] },
      uThreadVel: { value: [0, 0] },
      uThreadY: { value: new Float32Array(THREAD_N) },
    };
    if (o.knownTier) this.#stepped = true;
    if (o.arrive && !o.reducedMotion) {
      // The dots start on the card's line as it was on the last page, then swim to this page's.
      const el = document.querySelector(`[data-thread-line="${o.arrive.slug}"]`);
      if (el) {
        // The pen starts again from the left on this page's line, like every other line.
        this.#threadOn(el);
        this.#thread.arriving = THREAD_TIME.arriveS;
      }
    }

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
    const startForm: Formation = this.#wantHero() ?? this.#heroVisible() ? 'trace' : 'swarm';
    this.#form = { from: FORM_VALUE[startForm]!, to: FORM_VALUE[startForm]!, p: 1, pace: 1, value: FORM_VALUE[startForm]! };
    await yieldTask();
    if (this.#disposed) return;
    // The point cloud was requested in the constructor; it is small and usually here by now.
    this.#handData = await this.#handPts;
    if (this.#disposed) return;
    this.#build(TIER_SIZE[o.tier]);
    this.stats.tier = o.tier;
    performance.mark('field:built');
    await yieldTask();
    if (this.#disposed) return;
    // Compiled off the main thread where the driver allows it (KHR_parallel_shader_compile): a
    // blocking compile here froze the page for up to a second right as it arrived.
    // A driver that trips over the early compile just compiles on first use instead.
    await this.#compileSim().catch(() => {});
    if (this.#disposed) return;
    await this.#renderer.compileAsync(this.#scene, this.#camera).catch(() => {});
    performance.mark('field:compiled');
    if (this.#disposed) return;
    this.#step(1 / 60);
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
    // Leaving the trace after it has already scrolled far out of view (a fast scroll): don't fly
    // thousands of particles back from far off-screen. The flock starts just above the screen and
    // flies in from there.
    if (to === 0 && this.#form.value > 0.5 && !this.#traceNear() && this.#sim) {
      this.#form = { from: 0, to: 0, p: 0, pace: this.#pace(), value: 0 };
      this.#reform = { pending: false, start: -1, t: 0, pace: 1, spin: 0 };
      this.#shared.uReform!.value = -1;
      this.#shared.uAbort!.value = 0;
      this.#holdFlock('top');
      this.#snapNext = true;
      return;
    }
    const reforming = this.#reform.pending || this.#reform.start >= 0;
    if (reforming && to === 1) return;
    const midReform = this.#reform.start >= 0;
    this.#reform = { pending: false, start: -1, t: 0, pace: 1, spin: 0 };
    this.#shared.uReform!.value = -1;
    this.#shared.uAbort!.value = 0;
    // Leaving: the flock gathers where the hero is and drifts off from there.
    if (to === 0 && this.#form.value > 0.5) this.#holdFlock(this.#o.reducedMotion ? 'free' : 'hero');
    // Back to the hero from the swarm: wait for it to come on screen, then swim the drawn routes.
    if (to === 1 && !instant && !this.#o.reducedMotion && this.#form.value < 0.5 && this.#sim) {
      this.#reform.pending = true;
      return;
    }
    // Leaving mid re-form: dots still on their way rejoin the flock at once; the ones already on
    // the shape let go in the usual order.
    if (to === 0 && midReform && this.#form.value === 1) {
      this.#shared.uAbort!.value = 1;
      this.#form = { from: 1, to: 0, p: 0, pace: this.#pace(), value: 1 };
      return;
    }
    if (to === 0 && reforming) {
      // Was only waiting for the hero to come into view: nothing has moved yet.
      this.#form = { from: 0, to: 0, p: 0, pace: this.#pace(), value: 0 };
      return;
    }
    this.#form = { from: instant ? to : this.#form.value, to, p: 0, pace: this.#pace(), value: instant ? to : this.#form.value };
    if (this.#o.reducedMotion && !this.#disposed && this.#sim) {
      this.#form.value = to;
      this.#settle(90);
      this.#renderOnce();
    }
  }

  /**
   * Drift stain: 0 is clean ink, 1 is fully bled into drift blue. Callers pass the measured
   * accuracy loss (normalised), so the amount of blue tracks the amount of drift; reinking is
   * just setting it back toward 0, eased so it reads as ink returning, not a switch.
   */
  setBleed(amount: number): void {
    this.#bleedTarget = Math.min(1, Math.max(0, amount));
  }

  /**
   * The page under the field was swapped for another without a reload (nav.ts): the field keeps
   * running. Pass the slug of the project whose card was clicked, if any: its dots carry on into
   * that project's line, drawn again from the left. Call measure() once the glide has finished.
   */
  pageChanged(arrive?: string): void {
    // The swap scrolled the page: not a scroll by the visitor, so no kick or hurry from it.
    this.#scrollY = scrollY;
    this.#scrollDy = 0;
    this.#scrollV = 0;
    this.#swapping = true;
    const t = this.#thread;
    t.cards = [];
    t.pen = 0;
    const el = arrive && !this.#o.reducedMotion ? document.querySelector(`[data-thread-line="${arrive}"]`) : null;
    this.#threadOn(el);
    t.arriving = el ? THREAD_TIME.arriveS : 0;
    // Left the hero behind: its dots fly off into the flock from wherever they are, no snapping.
    if (!document.querySelector('.hero-trace svg') && (this.#formTo() === 1 || this.#form.value > 0)) {
      this.#reform = { pending: false, start: -1, t: 0, pace: 1, spin: 0 };
      this.#shared.uReform!.value = -1;
      this.#shared.uAbort!.value = 0;
      this.#form = { from: 0, to: 0, p: 1, pace: 1, value: 0 };
      this.#holdFlock('free');
    }
    this.#ensureHand();
    // Reduced motion has no frame loop to notice the hero: settle on this page's formation now.
    if (this.#o.reducedMotion) {
      const want = this.#wantHero() ?? this.#heroVisible();
      if ((want ? 1 : 0) !== this.#formTo()) this.setFormation(want ? 'trace' : 'swarm', true);
    }
    this.#still();
  }

  /** Re-read this page's text and cards (the mask the dots fade under). */
  measure(): void {
    this.#swapping = false;
    this.#measureText();
    this.#still();
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    clearTimeout(this.#stillTimer);
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

    // Homes: a jittered grid over 0..1, each dot's fixed place in the flock (see flockChunk).
    const homes = new Float32Array(n * 4);
    const cols = Math.ceil(Math.sqrt(n * (this.#vw / Math.max(this.#vh, 1))));
    const rows = Math.ceil(n / cols);
    for (let i = 0; i < n; i++) {
      const gx = i % cols, gy = Math.floor(i / cols);
      homes[i * 4] = (gx + Math.random()) / cols;
      homes[i * 4 + 1] = (gy + Math.random()) / rows;
      homes[i * 4 + 2] = Math.random();
    }
    // Every particle has one spot in the swarm and one in each shape, and the two correspond:
    // the left 60 % of the swarm (by x) makes the trace, the right 40 % the hand. Within each,
    // particles are taken column by column, top to bottom, and matched to shape points taken
    // the same way, so a strip of the line unrolls into a column of the swarm and a patch of the
    // hand into the patch beside it. Breaking up and re-forming retrace the same short paths.
    // H.w: trace members 0..HAND_SPLIT (their order along the line), hand members above it.
    const byX = Array.from({ length: n }, (_, i) => i).sort((a, b) => homes[a * 4]! - homes[b * 4]!);
    const nt = Math.round(n * HAND_SPLIT);
    const traceCols = Math.max(1, Math.round(cols * HAND_SPLIT));
    const traceIds = columnOrder(byX.slice(0, nt), traceCols, (i) => [homes[i * 4]!, homes[i * 4 + 1]!]);
    traceIds.forEach((id, k) => (homes[id * 4 + 3] = (k / nt) * HAND_SPLIT));
    const handIds = columnOrder(byX.slice(nt), Math.max(1, cols - traceCols), (i) => [homes[i * 4]!, homes[i * 4 + 1]!]);
    handIds.forEach((id, k) => (homes[id * 4 + 3] = HAND_SPLIT + ((k + 1) / handIds.length) * (1 - HAND_SPLIT)));
    const home = new DataTexture(homes, size, size, RGBAFormat, FloatType);
    home.minFilter = home.magFilter = NearestFilter;
    home.needsUpdate = true;

    // Hand points for hand members, matched the same way (columns by screen x, rows by height).
    this.#handMap = { n, size, ids: handIds, cols: Math.max(1, cols - traceCols) };
    const { handLocal, handTex } = this.#fillHand();
    this.#updateHand(0);

    const p0 = gpu.createTexture();
    const v0 = gpu.createTexture();
    const pa = p0.image.data as Float32Array;
    this.#shared.uPhase!.value = playbackPhase();
    this.#updateTraceRect();
    const [rx, ry, rw, rh] = this.#shared.uTraceRect!.value as number[];
    const onTrace = this.#form.value > 0.5;
    this.#snapNext = !onTrace;
    const handOn = this.#shared.uHandOn!.value === 1;
    const arrive = this.#thread.arriving > 0 && this.#o.arrive?.ys.length === THREAD_N ? this.#o.arrive : null;
    for (let i = 0; i < n; i++) {
      const seed = Math.random();
      if (onTrace && handOn && homes[i * 4 + 3]! > HAND_SPLIT) {
        const L = handLocal.subarray(i * 4, i * 4 + 4);
        const [hx, hy, hz] = projectHand(L[0]!, L[1]!, L[2]!, L[3]!, this.#bones, this.#shared.uHandRect!.value as number[]);
        pa[i * 4] = hx; pa[i * 4 + 1] = hy; pa[i * 4 + 2] = hz;
      } else if (onTrace) {
        // Same target as traceTarget() in the shader, evaluated once on the CPU.
        const u = handOn ? homes[i * 4 + 3]! / HAND_SPLIT : homes[i * 4 + 3]!;
        const sv = traceSample(u, this.#shared.uPhase!.value as number);
        pa[i * 4] = rx! + u * rw!;
        pa[i * 4 + 1] = ry! + rh! * 0.5 - sv * rh! * 0.44 + (((seed * 7.13) % 1) - 0.5) * 2.4;
      } else if (arrive && (Math.fround(seed) * 17.93) % 1 < THREAD.share) {
        // Thread members of a card that was just opened: on that card's line, where it last was.
        const u = ((Math.fround(seed) * 17.93) % 1) / THREAD.share;
        const x = u * (THREAD_N - 1), k = Math.min(Math.floor(x), THREAD_N - 2);
        const y = arrive.ys[k]! + (arrive.ys[k + 1]! - arrive.ys[k]!) * (x - k);
        pa[i * 4] = arrive.rect[0] + u * arrive.rect[2];
        pa[i * 4 + 1] = arrive.rect[1] + y * arrive.rect[3];
      } else {
        // Placed in the flock by the first compute step (uSnap).
        pa[i * 4] = homes[i * 4]! * this.#vw;
        pa[i * 4 + 1] = homes[i * 4 + 1]! * this.#vh;
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
      premultipliedAlpha: true,
      depthTest: false,
      depthWrite: false,
    });
    const points = new Points(geometry, material);
    points.frustumCulled = false;
    this.#scene.add(points);
    this.#sim = { size, handLocal, handTex, gpu, pos, vel, home, points, geometry, material };
    this.stats.particles = n;
  }

  /** The two compute shaders, compiled for the render targets they draw into, without waiting on them. */
  async #compileSim(): Promise<void> {
    const s = this.#sim;
    if (!s) return;
    const r = this.#renderer;
    const scene = new Scene();
    const quad = new PlaneGeometry(2, 2);
    for (const v of [s.pos, s.vel]) scene.add(new Mesh(quad, v.material));
    const prev = r.getRenderTarget();
    // Programs are keyed by where they draw: compile them as the compute pass will use them.
    r.setRenderTarget(s.gpu.getCurrentRenderTarget(s.pos) as WebGLRenderTarget);
    const done = r.compileAsync(scene, this.#camera);
    r.setRenderTarget(prev);
    await done;
    quad.dispose();
  }

  /** The hand members' points on the hand (none until the point cloud is here), as a texture. */
  #fillHand(): { handLocal: Float32Array<ArrayBuffer>; handTex: DataTexture } {
    const { n, size, ids, cols } = this.#handMap!;
    const hd = this.#handData;
    this.#handReady = hd !== null;
    const handLocal = new Float32Array(n * 4);
    if (hd) {
      const m = hd.skin.length;
      const pick = Array.from({ length: ids.length }, (_, k) => Math.floor((k * m) / ids.length));
      const ordered = columnOrder(pick.sort((a, b) => hd.xyz[a * 3]! - hd.xyz[b * 3]!), cols, (j) => [hd.xyz[j * 3]!, -hd.xyz[j * 3 + 1]!]);
      ids.forEach((id, k) => {
        const j = ordered[k]!;
        handLocal.set([hd.xyz[j * 3]!, hd.xyz[j * 3 + 1]!, hd.xyz[j * 3 + 2]!, hd.skin[j]!], id * 4);
      });
    }
    const handTex = new DataTexture(handLocal, size, size, RGBAFormat, FloatType);
    handTex.minFilter = handTex.magFilter = NearestFilter;
    handTex.needsUpdate = true;
    this.#shared.uHandLocal!.value = handTex;
    return { handLocal, handTex };
  }

  /** Arrived on a page with the hero's hand when the visit began without one: fetch it now. */
  #ensureHand(): void {
    if (this.#handData || this.#handLoading || !this.#sim) return;
    if ((document.querySelector('.hero-hand')?.getBoundingClientRect().width ?? 0) <= 0) return;
    this.#handLoading = true;
    loadHand()
      .then((hd) => {
        const s = this.#sim;
        if (this.#disposed || !hd || !s) return;
        this.#handData = hd;
        const old = s.handTex;
        Object.assign(s, this.#fillHand());
        old.dispose();
        this.#still();
      })
      .catch(() => {})
      .finally(() => (this.#handLoading = false));
  }

  #teardownSim(): void {
    const s = this.#sim;
    if (!s) return;
    this.#scene.remove(s.points);
    s.geometry.dispose();
    s.material.dispose();
    s.home.dispose();
    s.handTex.dispose();
    s.gpu.dispose();
    this.#sim = null;
  }

  #step(dt: number): void {
    const s = this.#sim!;
    const u = this.#shared;
    u.uDt!.value = dt;
    u.uTime!.value = this.#time;
    u.uForm!.value = this.#form.value;
    this.#updateFlock(dt);
    u.uSnap!.value = this.#snapNext ? 1 : 0;
    u.uPhase!.value = playbackPhase();
    this.#updateDemo(dt);
    this.#updateThread(dt);
    this.#updateHand(dt);
    // The demo's stain shows only while the demo is on screen; the hero is never stained by it.
    const bleedTo = Math.max(this.#bleedTarget, this.#demo.loss * this.#demo.view);
    this.#bleed += (bleedTo - this.#bleed) * (1 - Math.exp(-dt * 2.5));
    u.uBleed!.value = this.#bleed;
    this.#scrollDy = 0;
    s.gpu.compute();
    if (this.#snapNext) {
      this.#snapNext = false;
      u.uSnap!.value = 0;
    }
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
    // rAF timestamps are frame-start times and can precede the performance.now() taken at start.
    const dt = Math.min(Math.max(raw, 0), 1 / 30);
    this.#time += dt;

    // An even sweep both ways, so particles let go (or join) one after another, not all at once.
    const step = Math.min(Math.max(raw, 0), 0.1);
    // Scroll speed: rises at once with a flick, eases off over a few tenths of a second after.
    const inst = this.#scrollDy / Math.max(step, 1 / 240);
    this.#scrollV += (inst - this.#scrollV) * (1 - Math.exp(-step / (Math.abs(inst) > Math.abs(this.#scrollV) ? 0.05 : 0.3)));
    const f = this.#form;
    // A fast scroll partway through hurries the rest of it along too.
    f.pace = Math.max(f.pace, this.#pace());
    f.p = Math.min(1, f.p + (step * 1000 * f.pace) / (f.to < f.from ? RELEASE_MS : FORM_MS));
    const t = f.p;
    const e = t * t * (3 - 2 * t);
    this.#form.value = this.#form.from + (this.#form.to - this.#form.from) * e;

    const p = this.#pointer;
    if (now - p.lastMove > 1200) p.strength *= 0.92;
    this.#shared.uPointer!.value = [p.x, p.y, p.strength];

    const want = this.#wantHero();
    if (want !== null && (want ? 1 : 0) !== this.#formTo()) this.setFormation(want ? 'trace' : 'swarm');
    this.#updateTraceRect();
    this.#runReform(now, dt);
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

  /** The formation being headed for, counting a re-form that is waiting for the hero to show. */
  #formTo(): number {
    return this.#reform.pending || this.#reform.start >= 0 ? 1 : this.#form.to;
  }

  #runReform(now: number, dt: number): void {
    const r = this.#reform;
    if (r.pending && this.#heroInView()) {
      r.pending = false;
      r.start = now;
      r.t = 0;
      r.spin = 0;
      r.pace = this.#pace();
      this.#form = { from: 1, to: 1, p: 1, pace: 1, value: 1 };
    }
    if (r.start < 0) return;
    r.pace = Math.max(r.pace, this.#pace());
    this.#shared.uPace!.value = r.pace;
    r.t += dt * r.pace;
    // The tornado turns on real time: a hurried re-form shortens it, never spins it faster.
    r.spin += dt;
    this.#shared.uSpinT!.value = r.spin;
    if (r.t > REFORM.totalS + 0.6) {
      r.start = -1;
      this.#shared.uReform!.value = -1;
      this.#shared.uPace!.value = this.#flockPace;
    } else this.#shared.uReform!.value = r.t;
  }

  #render(): void {
    const s = this.#sim!;
    if (this.#mask.dirty) this.#drawMask();
    this.#shared.uMaskView!.value = [scrollX, scrollY, this.#mask.size[0], this.#mask.size[1]];
    s.material.uniforms.texPos!.value = s.gpu.getCurrentRenderTarget(s.pos).texture as Texture;
    s.material.uniforms.texVel!.value = s.gpu.getCurrentRenderTarget(s.vel).texture as Texture;
    this.#shared.uFade!.value = this.#fade;
    // Everything this frame was placed from rects read at this scroll position; pin the canvas
    // there, so if the page scrolls before the next frame the drawing travels with it.
    const cs = this.#o.canvas.style;
    if (this.#pinToViewport) {
      cs.position = 'fixed';
      cs.transform = 'none';
    } else {
      cs.position = '';
      cs.transform = `translate3d(${scrollX}px,${scrollY}px,0)`;
    }
    this.#renderer.render(this.#scene, this.#camera);
  }

  #pixelRatio(): number {
    const dpr = devicePixelRatio || 1;
    if (this.#lean) return 1;
    if (this.stats.tier === 'high') return Math.min(dpr, 2);
    // Mid: a large sharp screen costs the GPU more in pixels than in particles, and a slow GPU is
    // why it is on mid. Keep the canvas near MID_PIXELS; the dots keep their size, just a touch softer.
    return Math.max(1, Math.min(dpr, 1.5, Math.sqrt(MID_PIXELS / (innerWidth * innerHeight))));
  }

  #renderOnce(): void {
    if (this.#sim && !this.#disposed) this.#render();
  }

  /** Reduced motion has no frame loop: settle and draw once after the demo changes state. */
  #still(): void {
    if (!this.#o.reducedMotion || this.#stillTimer) return;
    this.#stillTimer = window.setTimeout(() => {
      this.#stillTimer = 0;
      if (this.#disposed || !this.#sim) return;
      this.#settle(60);
      this.#renderOnce();
    }, 250);
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
      } else if (!this.#retried) {
        this.#retried = true;
        this.#probe = [];
        this.#probeDone = false;
        this.#probeAt = this.#time + 2;
      } else {
        // Slow, but still moving: keep the particles, they are the page. Drop the canvas to one
        // device pixel per CSS pixel, the cheapest it goes without changing what is drawn.
        this.#lean = true;
        this.#resize();
        bus.emit('field:tier', { tier: this.stats.tier, particles: this.stats.particles, reason: `slow GPU (${fps} fps), canvas at 1x` });
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
    return r.bottom > innerHeight * 0.2 && r.top < innerHeight * 0.8;
  }

  /** Enough of the hero on screen to watch it form. */
  #heroInView(): boolean {
    const el = document.querySelector('.hero-trace svg');
    if (!el) return true;
    const r = el.getBoundingClientRect();
    // innerHeight, not the canvas height: on a phone the canvas keeps the tallest height seen.
    // A line that sits at the bottom of a short screen still counts once it is mostly on screen.
    const vh = innerHeight;
    // Scrolling up fast, start as the line is about to arrive rather than once it has.
    const lead = this.#lead(-this.#scrollV);
    return r.top + r.height * 0.5 < vh + lead && r.bottom > vh * 0.1;
  }

  /** Within a screen of the viewport: close enough that released particles can stream in. */
  #traceNear(): boolean {
    const el = document.querySelector('.hero-trace svg');
    if (!el) return false;
    const r = el.getBoundingClientRect();
    return r.bottom > -this.#vh && r.top < 2 * this.#vh;
  }

  /**
   * The hero holds together until the divider above the third project scrolls into view, then
   * dissolves; scrolling back above it re-forms it. Null on pages without that divider.
   */
  #wantHero(): boolean | null {
    const el = document.querySelector('[data-field-release]');
    if (!el || !document.querySelector('.hero-trace svg')) return null;
    const top = el.getBoundingClientRect().top;
    if (this.#formTo() === 1) {
      // Scrolling down fast, let go a little before the divider arrives, by how far it will
      // travel in leadS. Remember how early, so stopping right there doesn't re-form it.
      const lead = this.#lead(this.#scrollV);
      if (top > innerHeight + lead) return true;
      this.#releaseLead = lead;
      return false;
    }
    if (top > innerHeight + this.#releaseLead) {
      this.#releaseLead = 0;
      return true;
    }
    return false;
  }

  /**
   * The demo's stage and hand slot, read every frame like the hero. It forms only once the hero has
   * fully let go, so nothing the hero does changes while the demo is off screen.
   */
  #updateDemo(dt: number): void {
    const d = this.#demo;
    const u = this.#shared;
    const r = d.stage ? document.querySelector('[data-field-stage]')?.getBoundingClientRect() : undefined;
    const free = this.#formTo() === 0 && this.#form.value < 0.02 && this.#reform.start < 0;
    // Held within a screen of the viewport, so the clouds are already formed when the map scrolls
    // (back) into view instead of streaming in from the flock each time.
    const want = !!r && r.width > 0 && r.bottom > -innerHeight && r.top < 2 * innerHeight && free;
    if (!free || !d.stage || !d.map) d.on = 0;
    else d.on += ((want ? 1 : 0) - d.on) * (1 - Math.exp(-dt * 3));
    if (d.on < 0.002) d.on = 0;
    const inView = !!r && r.bottom > 0 && r.top < innerHeight;
    d.view = Math.min(d.on, d.view + ((inView ? 1 : 0) - d.view) * (1 - Math.exp(-dt * 3)));
    const up = d.envTo > d.env;
    d.env += (d.envTo - d.env) * (1 - Math.exp(-dt * (up ? 14 : 4)));
    const slot = document.querySelector('[data-field-hand]')?.getBoundingClientRect();
    const handOk = this.#handReady && d.seen && !!slot && slot.width > 0 && slot.height > 0;
    d.hand += ((handOk ? 1 : 0) - d.hand) * (1 - Math.exp(-dt * 3));
    if (r) {
      // How fast the map is moving on screen (a scroll), so dots swimming to it move with it and
      // don't trail behind; px/s, smoothed a little against uneven frame times.
      const [px, py] = u.uDemoRect!.value as number[];
      const v = u.uDemoVel!.value as number[];
      const k = dt > 0 && py! > -999 ? 1 - Math.exp(-dt / 0.03) : 0;
      if (k > 0) {
        v[0] = v[0]! + ((r.x - px!) / dt - v[0]!) * k;
        v[1] = v[1]! + ((r.y - py!) / dt - v[1]!) * k;
      }
      u.uDemoRect!.value = [r.x, r.y, r.width, r.height];
    }
    this.#pinToViewport = d.on > 0 && stuck(document.querySelector('[data-field-sticky]'));
    u.uDemo!.value = [d.on, d.env, d.picked, d.hand];
    // The hand eases toward the pose the classifier last read with confidence.
    const k = this.#o.reducedMotion ? 1 : 1 - Math.exp(-dt / DEMO.poseS);
    this.#demoPose = blendPose(this.#demoPose, POSES[d.pose], k);
  }

  /**
   * The thread: once the hero has let go, the project card in the middle of the screen gets its
   * line drawn by a slice of the flock; on a project's own page, its graph near the top does. A new
   * line waits for the last one to be let go, so one set of dots moves from card to card.
   */
  #updateThread(dt: number): void {
    const t = this.#thread;
    const u = this.#shared;
    const free = this.#formTo() === 0 && this.#form.value < 0.02 && this.#reform.start < 0;
    const want = free ? this.#threadPick() : null;
    const still = this.#o.reducedMotion;
    if (t.arriving > 0) t.arriving = Math.max(0, t.arriving - dt);
    if (want === t.el && t.el) t.pen = still ? 1 : Math.min(1, t.pen + dt / THREAD_TIME.drawS);
    else if (t.pen > 0 && !still) t.pen = Math.max(0, t.pen - dt / THREAD_TIME.undrawS);
    else t.pen = 0;
    if (t.pen === 0 && want !== t.el) {
      t.el?.removeAttribute('data-threaded');
      this.#threadOn(want);
      if (want && still) t.pen = 1;
    }
    const r = t.el ? threadRect(t.el) : null;
    if (r) {
      const [px, py] = u.uThreadRect!.value as number[];
      const v = u.uThreadVel!.value as number[];
      const k = dt > 0 && py! > -999 ? 1 - Math.exp(-dt / 0.03) : 0;
      if (k > 0) {
        v[0] = v[0]! + ((r[0] - px!) / dt - v[0]!) * k;
        v[1] = v[1]! + ((r[1] - py!) / dt - v[1]!) * k;
      }
      u.uThreadRect!.value = r;
      // The SVG line steps aside while the dots draw it, as the hero's does, so nothing is drawn
      // ahead of the pen.
      if (t.pen > 0) t.el!.setAttribute('data-threaded', '');
      else t.el!.removeAttribute('data-threaded');
    }
    // About three dots per px of line: enough for a solid stroke, and a short line isn't a blob.
    const members = (this.#sim?.size ?? 76) ** 2 * THREAD.share;
    const w = r ? Math.min(1, (Math.hypot(r[2], r[3]) * 3) / members) : 1;
    u.uThread!.value = [t.el && r ? 1 : 0, t.pen, t.arriving > 0 ? 1 : 0, w];
  }

  #threadOn(el: Element | null): void {
    const u = this.#shared;
    this.#thread.el = el;
    if (!el) return;
    u.uThreadY!.value = Float32Array.from(threadHeights(el));
    u.uThreadVel!.value = [0, 0];
    u.uThreadRect!.value = [0, -1000, 1, 1];
  }

  /** The line the thread should be on now: a card in the middle of the screen, or this page's own graph. */
  #threadPick(): Element | null {
    const t = this.#thread;
    const h = innerHeight;
    const [a, b] = THREAD_BAND.pick;
    const cur = t.el?.closest('[data-thread-target]');
    let best: HTMLElement | null = null, bestD = Infinity, curD = Infinity;
    for (const card of t.cards) {
      const r = card.getBoundingClientRect();
      const c = r.top + r.height / 2;
      if (r.height === 0 || c < a * h || c > b * h) continue;
      const d = Math.abs(c - h / 2);
      if (card === cur) curD = d;
      if (d < bestD) (best = card), (bestD = d);
    }
    if (cur && curD - bestD < THREAD_BAND.margin * h) return t.el;
    if (best) return best.querySelector('[data-thread-line]');
    const own = document.querySelector('[data-thread-home]');
    if (own) {
      const r = own.getBoundingClientRect();
      if (r.bottom > 0 && r.top < h) return own;
    }
    return null;
  }

  /** Hand rect, gesture (cycle + EMG grip) and the slow turn, as 16 skinning matrices. */
  #updateHand(dt: number): void {
    const el = document.querySelector<HTMLElement>('.hero-hand');
    const r = el?.getBoundingClientRect();
    const on = this.#handReady && !!r && r.width > 0 && r.height > 0;
    this.#shared.uHandOn!.value = on ? 1 : 0;
    if (!on) return;
    const still = this.#o.reducedMotion;
    const d = this.#demo;
    const slot = d.on > 0 && d.hand > 0.001 ? document.querySelector('[data-field-hand]')?.getBoundingClientRect() : undefined;
    if (slot) {
      // The demo's hand: posed by the classifier, turning slowly like the hero's.
      this.#shared.uHandRect!.value = [slot.x, slot.y, slot.width, slot.height];
      const spin = still ? HAND.reducedSpin : (this.#time / HAND.spinS) * 360 - 25;
      poseBones(this.#demoPose, handWorld(spin, 8, this.#handM), 0, this.#bones);
      return;
    }
    this.#shared.uHandRect!.value = [r.x, r.y, r.width, r.height];
    const phase = playbackPhase();
    let pose = POSES.open;
    if (!still) {
      // The hand makes the gesture whose recording is entering at the trace's right edge, moving
      // into it over the first morphS of that clip and holding it for the rest.
      const edge = phase + 1, k = Math.floor(edge), n = SEQUENCE.length;
      const m = Math.min(1, ((edge - k) * tracePlayback.clipS) / tracePlayback.morphS);
      const a = POSES[SEQUENCE[(((k - 1) % n) + n) % n]!], b = POSES[SEQUENCE[((k % n) + n) % n]!];
      pose = blendPose(a, b, m * m * (3 - 2 * m));
      // How hard the recording is working right there (mean rectified EMG under the hand) sets how
      // fully the gesture is made: 85 % on a quiet stretch, all of it at full activation.
      const env = envelopeAt(phase);
      this.#grip += (Math.min(1, Math.max(0, (env - 0.08) / 0.17)) - this.#grip) * (1 - Math.exp(-dt * 4));
      pose = blendPose(POSES.rest, pose, 0.85 + 0.15 * this.#grip);
    }
    const spin = still ? HAND.reducedSpin : (this.#time / HAND.spinS) * 360 - 25;
    poseBones(pose, handWorld(spin, 8, this.#handM), 0, this.#bones);
  }

  /** 1 at reading speed, up to PACE.max for a fast scroll. */
  #pace(): number {
    const v = Math.abs(this.#scrollV) / Math.max(1, innerHeight);
    const k = Math.min(1, Math.max(0, (v - PACE.fromVh) / (PACE.fullVh - PACE.fromVh)));
    return 1 + (PACE.max - 1) * k;
  }

  #flockPace = 1;

  /** How far ahead (px) to read a scroll moving at v px/s in the direction that matters. Capped,
   *  so a flick or a jump can't fire a release from far away that a scroll back can never undo. */
  #lead(v: number): number {
    return Math.min(Math.max(0, v) * PACE.leadS, PACE.leadMaxVh * innerHeight);
  }

  #holdFlock(where: 'hero' | 'top' | 'free'): void {
    const f = this.#flock;
    f.hold = where;
    this.#flockPace = this.#pace();
    // From above the screen it starts already on its way, so the screen is never empty for long.
    f.k = where === 'free' ? 1 : where === 'top' ? 0.2 : 0;
    this.#updateFlock(0);
  }

  #updateFlock(dt: number): void {
    const f = this.#flock;
    if (f.hold !== 'free') {
      this.#flockPace = Math.max(this.#flockPace, this.#pace());
      f.k = Math.min(1, f.k + (dt * this.#flockPace) / FLOCK.holdS);
      if (f.k >= 1) f.hold = 'free';
    }
    // Dots chase their flock places harder while a fast break-up is under way, then ease back.
    else this.#flockPace += (1 - this.#flockPace) * (1 - Math.exp(-dt * 1.5));
    if (this.#reform.start < 0) this.#shared.uPace!.value = this.#flockPace;
    if (f.hold === 'hero') {
      const [x, y, w, h] = this.#shared.uTraceRect!.value as number[];
      f.x = x! + w! * 0.5;
      // Above the screen it waits just past the top edge, so the dots pour in from there.
      f.y = Math.max(y! + h! * 0.5, -0.3 * this.#vh);
    } else if (f.hold === 'top') {
      f.x = this.#vw * 0.5;
      f.y = -0.25 * this.#vh;
    }
    const lim = FLOCK.kickMax * this.#vh;
    f.kick = Math.max(-lim, Math.min(lim, (f.kick - this.#scrollDy * FLOCK.kick) * Math.exp(-dt * FLOCK.catchUp)));
    const u = this.#shared;
    u.uFlockT!.value = this.#time;
    u.uAnchor!.value = [f.x, f.y, f.k];
    u.uKick!.value = f.kick;
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
    // Phones resize the window as the address bar slides in and out while scrolling. Keep the
    // tallest height seen at this width, so that doesn't reallocate the canvas, move the flock or
    // re-measure every line of text mid-scroll; the extra rows just sit under the bar.
    const sameWidth = innerWidth === this.#vw && this.#sized;
    const h = sameWidth && TOUCH ? Math.max(this.#vh, innerHeight) : innerHeight;
    if (sameWidth && h === this.#vh && this.#pr === this.#pixelRatio()) return;
    this.#sized = true;
    this.#vw = innerWidth;
    this.#vh = h;
    const pr = (this.#pr = this.#pixelRatio());
    this.#renderer.setPixelRatio(pr);
    this.#renderer.setSize(this.#vw, this.#vh, true);
    this.#shared.uViewport!.value = [this.#vw, this.#vh];
    this.#shared.uPixelRatio!.value = pr;
    this.#measureText();
  };

  /** Text rects in document coordinates; re-read on resize and when layout changes. */
  #measureText(): void {
    this.#thread.cards = Array.from(document.querySelectorAll<HTMLElement>('[data-thread-target]')).filter((c) =>
      c.querySelector('[data-thread-line]'),
    );
    const sx = scrollX, sy = scrollY;
    const lines = MASK_MODES[maskMode()].lines;
    const range = document.createRange();
    const rects: DOMRect[] = [];
    for (const el of document.querySelectorAll<HTMLElement>(TEXT_SELECTOR)) {
      // The hero's own line, and captions that sit right under a formation (the demo map's), stay unmasked.
      if (el.closest('.hero-trace svg, [data-field-nomask]')) continue;
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
    // The mask covers the whole page, drawn once in page coordinates; the shader adds the scroll
    // offset, so scrolling never redraws or re-uploads it.
    const m = this.#mask, de = document.documentElement;
    const w = Math.max(this.#vw, de.scrollWidth), h = Math.max(this.#vh, de.scrollHeight);
    const cw = Math.max(1, Math.round(w * MASK_SCALE));
    const ch = Math.max(1, Math.min(MASK_MAX, Math.round(h * MASK_SCALE)));
    if (cw !== m.canvas.width || ch !== m.canvas.height) {
      m.canvas.width = cw;
      m.canvas.height = ch;
      // The GPU copy has a fixed size: a page that grows (the demo mounting, fonts) needs a new one.
      m.tex.dispose();
    }
    m.size = [w, h];
    m.dirty = true;
  }

  #drawMask(): void {
    const { ctx, canvas, rects, tex, size } = this.#mask;
    const kx = canvas.width / size[0], ky = canvas.height / size[1];
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const mode = MASK_MODES[maskMode()];
    ctx.filter = `blur(${mode.blur}px)`;
    ctx.fillStyle = '#fff';
    const pad = mode.pad;
    for (const r of rects) ctx.fillRect((r.x - pad) * kx, (r.y - pad) * ky, (r.width + 2 * pad) * kx, (r.height + 2 * pad) * ky);
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
      if (this.#o.reducedMotion) {
        const want = this.#wantHero();
        if (want !== null && (want ? 1 : 0) !== this.#formTo()) this.setFormation(want ? 'trace' : 'swarm');
      }
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

    // Not mid page change: the swap resizes the body, and measuring then stuttered the glide.
    const ro = new ResizeObserver(() => !this.#swapping && this.#measureText());
    ro.observe(document.body);
    this.#off.push(() => ro.disconnect());

    // The demo: it emits, the Field forms. Late listeners pick up the last state.
    const d = this.#demo;
    const lossOf = (e: { accuracy: number; baseline: number }) =>
      Math.min(1, Math.max(0, (e.baseline - e.accuracy) / DEMO.lossFull));
    const stage = (on: boolean) => {
      d.stage = on;
      if (!on) Object.assign(d, { envTo: 0, picked: -1, loss: 0, seen: false, pose: 'rest' });
    };
    const map = ({ clouds }: { clouds: number[][] }) => {
      const u = this.#shared;
      const [C, X, Y, Z] = (['uMapC', 'uMapX', 'uMapY', 'uMapZ'] as const).map((n) => u[n]!.value as Vector3[]);
      clouds.forEach((v, k) => {
        C![k]!.fromArray(v, 0);
        X![k]!.fromArray(v, 3);
        Y![k]!.fromArray(v, 6);
        Z![k]!.fromArray(v, 9);
      });
      d.map = true;
    };
    stage(bus.last('emg:stage')?.on ?? false);
    const lastMap = bus.last('emg:map');
    if (lastMap) map(lastMap);
    const lastLoss = bus.last('emg:recalibrated') ?? bus.last('emg:drift');
    if (lastLoss) d.loss = lossOf(lastLoss);
    this.#off.push(
      bus.on('emg:stage', ({ on }) => (stage(on), this.#still())),
      bus.on('emg:map', (e) => (map(e), this.#still())),
      bus.on('emg:envelope', ({ rms }) => {
        d.envTo = Math.min(1, Math.max(0, rms));
        this.#still();
      }),
      bus.on('emg:prediction', ({ gesture, p }) => {
        d.picked = gesture === 'rest' ? -1 : CLOUDS.indexOf(gesture);
        if (gesture === 'rest') d.pose = 'rest';
        else if (p >= DEMO.confident) {
          d.pose = gesture;
          d.seen = true;
        }
        this.#still();
      }),
      bus.on('emg:drift', (e) => ((d.loss = lossOf(e)), this.#still())),
      bus.on('emg:recalibrated', (e) => ((d.loss = lossOf(e)), this.#still())),
    );

    this.#off.push(
      // Pages with a release divider are driven from the frame loop instead (#wantHero).
      bus.on('section:enter', ({ id }) => {
        if (id === 'hero' && this.#wantHero() === null) this.setFormation('trace');
      }),
      bus.on('section:leave', ({ id }) => {
        if (id === 'hero' && this.#wantHero() === null) this.setFormation('swarm');
      }),
    );
  }
}

function maskMode(): MaskMode {
  const m = new URLSearchParams(location.search).get('mask');
  return m === 'box' || m === 'line' || m === 'halo' ? m : DEFAULT_MASK;
}
export const DEFAULT_MASK: MaskMode = 'halo';

/** Every clip end to end: the loop the trace plays. */
const TAPE = trace.clips.flatMap((c) => c.points);
const PER_CLIP = trace.clips[0]!.points.length;

/** Sample at u (0..1 across the window) for a playback position in clips. Same as traceAt() in the shader. */
function traceSample(u: number, phase: number): number {
  const n = TAPE.length;
  const x = (((u + phase) * PER_CLIP) % n + n) % n;
  const k = Math.floor(x), f = x - k;
  return TAPE[k]! * (1 - f) + TAPE[(k + 1) % n]! * f;
}

/** Mean rectified EMG over the last tenth of the visible trace. */
function envelopeAt(phase: number): number {
  let sum = 0;
  for (let i = 0; i < 24; i++) sum += Math.abs(traceSample(0.9 + i / 240, phase));
  return sum / 24;
}

/**
 * Playback position in clips (0..clips). Reads the static SVG's CSS animation clock when it exists,
 * so the particles pick up the line exactly where the SVG left it. Reduced motion holds the open hand.
 */
function playbackPhase(): number {
  if (REDUCED.matches) return Math.max(0, SEQUENCE.indexOf('open'));
  // Read the SVG's clock once, then keep time from there: once the particles are on, the SVG's own
  // animation is paused (global.css), and asking for it every frame forced a style recalc.
  if (tapeOrigin === null) {
    const anim = document.querySelector('.hero-trace .tape')?.getAnimations()[0];
    tapeOrigin = performance.now() - (typeof anim?.currentTime === 'number' ? anim.currentTime : performance.now());
  }
  return (((performance.now() - tapeOrigin) / 1000) / tracePlayback.clipS) % tracePlayback.clips;
}
let tapeOrigin: number | null = null;
const REDUCED = matchMedia('(prefers-reduced-motion: reduce)');

/** Ids split into ncols runs (in the order given), each run sorted top to bottom by key()[1]. */
function columnOrder(ids: number[], ncols: number, key: (i: number) => [number, number]): number[] {
  const per = Math.ceil(ids.length / ncols);
  const out: number[] = [];
  for (let c = 0; c < ids.length; c += per) {
    out.push(...ids.slice(c, c + per).sort((a, b) => key(a)[1] - key(b)[1]));
  }
  return out;
}

/** Whether a position: sticky element is currently held at its offset. */
function stuck(el: Element | null): boolean {
  if (!el) return false;
  const cs = getComputedStyle(el);
  if (cs.position !== 'sticky') return false;
  return Math.abs(el.getBoundingClientRect().top - parseFloat(cs.top)) < 0.5;
}
