/**
 * Progressive enhancement entry. The page is complete without this file.
 * As the page loads it checks the GPU and fetches the Field chunk; the field starts at load.
 * ?field=off skips it; ?tier=high|mid|static forces a tier.
 */
import { bus } from './bus';
import { observeSections } from './sections';
import { detectCapabilities } from '../field/tiers';
import { readSession, writeSession } from './session';
import { threadHeights, threadRect } from './thread-line';

type Stats = { fps: number; tier: string; particles: number; frames: number };
declare global {
  interface Window {
    __signal?: { state: string; reason?: string; stats?: Stats; bootMs?: number; hand?: Promise<ArrayBuffer> };
  }
}

const root = document.documentElement;
const info: NonNullable<Window['__signal']> = (window.__signal = { state: 'waiting' });

/**
 * A page opened with a view transition: hold the field's start until the glide has finished, so
 * the heavy part of starting it (building and uploading the particles) doesn't stutter the glide.
 */
let revealed: Promise<unknown> = Promise.resolve();
addEventListener('pagereveal', (e) => {
  const vt = (e as Event & { viewTransition?: { finished: Promise<unknown> } | null }).viewTransition;
  if (vt) revealed = Promise.race([vt.finished.catch(() => {}), new Promise((r) => setTimeout(r, 1500))]);
});

const loaded = new Promise<void>((r) => (document.readyState === 'complete' ? r() : addEventListener('load', () => r(), { once: true })));

async function start(): Promise<void> {
  if (new URLSearchParams(location.search).get('field') === 'off') {
    info.state = 'off';
    return;
  }
  let stopSections = observeSections();
  const caps = detectCapabilities();
  // An earlier page this visit already measured this device: start where its probe ended up.
  // Only a running tier is remembered: one slow moment must never switch the field off for a visit.
  const saved = readSession();
  const known = !new URLSearchParams(location.search).has('tier') && caps.tier !== 'static' && (saved.tier === 'high' || saved.tier === 'mid');
  if (known) {
    caps.tier = saved.tier!;
    caps.reason = `${saved.reason ?? 'measured'}, earlier this visit`;
  }
  bus.on('field:tier', ({ tier, reason }) => tier !== 'static' && writeSession({ tier, reason }));
  if (caps.tier === 'static') {
    info.state = 'static';
    info.reason = caps.reason;
    bus.emit('field:tier', { tier: 'static', particles: 0, reason: caps.reason });
    return;
  }

  // Fetch the field's code and the hand's points now, alongside the page, rather than after it:
  // waiting for load and then an idle moment kept a first visit without particles for seconds.
  const t0 = performance.now();
  performance.mark('field:import');
  const mod = import('../field/Field');
  if ((document.querySelector('.hero-hand')?.getBoundingClientRect().width ?? 0) > 0) {
    info.hand = fetch('/hand.bin').then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(`hand points: ${r.status}`))));
    info.hand.catch(() => {});
  }
  const [{ Field }] = await Promise.all([mod, loaded, revealed]);
  performance.mark('field:imported');
  const layer = document.createElement('div');
  layer.className = 'field-layer';
  layer.setAttribute('aria-hidden', 'true');
  const canvas = document.createElement('canvas');
  canvas.className = 'field';
  layer.append(canvas);
  document.body.prepend(layer);

  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  let field: InstanceType<typeof Field> | null = null;
  const fallback = (reason: string) => {
    field?.dispose();
    field = null;
    layer.remove();
    delete root.dataset.field;
    info.state = 'static';
    info.reason = reason;
    console.warn(`field off: ${reason}`);
    bus.emit('field:tier', { tier: 'static', particles: 0, reason });
  };
  try {
    field = new Field({
      canvas,
      tier: caps.tier,
      halfFloat: caps.halfFloat,
      reducedMotion: reduced.matches,
      knownTier: known,
      arrive: arrival(saved),
      onFallback: fallback,
      onFirstFrame: () => {
        root.dataset.field = 'on';
        info.state = 'running';
        info.bootMs = Math.round(performance.now() - t0);
        // From here on, moving between pages keeps the field running instead of reloading it.
        import('./nav')
          .then(({ enableNav }) =>
            enableNav({
              swapped: (slug) => {
                stopSections();
                stopSections = observeSections();
                pageReady(false);
                field?.pageChanged(slug);
              },
              // After the glide: the demo's recordings and the text mask are the heavy part.
              settled: () => {
                demoWhenNear();
                field?.measure();
              },
            }),
          )
          .catch(() => {});
      },
    });
    info.stats = field.stats;
    info.reason = caps.reason;
    await field.start();
    // ?bleed=0..1 previews the drift stain until the demo drives it with measured accuracy loss.
    const bleed = Number(new URLSearchParams(location.search).get('bleed'));
    if (bleed > 0) field.setBleed(bleed);
  } catch (e) {
    fallback(`init failed: ${(e as Error).message}`);
    return;
  }
  if (new URLSearchParams(location.search).has('fps')) showFps();
  canvas.addEventListener('webglcontextlost', () => fallback('WebGL context lost'), { once: true });
  addEventListener('pagehide', (e) => {
    if (!e.persisted) field?.dispose();
  });
}

/** Opened from a project card a moment ago: where that card's line was, for the field to pick up. */
function arrival(s: ReturnType<typeof readSession>) {
  const slug = location.pathname.match(/^\/work\/([^/]+)/)?.[1];
  const t = s.thread;
  if (t) writeSession({ thread: undefined });
  return t && t.slug === slug && Date.now() - t.at < 15_000 ? t : undefined;
}

/**
 * Moving between pages: opening a project saves where its card's line is on screen, so its dots
 * can carry on into the project's page; and the project page's way back goes to the ordering of
 * the list the visitor came from (/, /neuro or /swe).
 */
function rememberPages(): void {
  addEventListener('click', (e) => {
    const a = (e.target as Element | null)?.closest?.('a[href^="/work/"]');
    const slug = a?.getAttribute('href')?.split(/[/#?]/)[2];
    const el = slug ? document.querySelector(`[data-thread-target="${slug}"] [data-thread-line]`) : null;
    const rect = el && threadRect(el);
    if (slug && rect) writeSession({ thread: { slug, rect, ys: threadHeights(el), at: Date.now() } });
  });
}

/** Per page, on load and after each in-place page change: the list, the way back, the demo. */
function pageReady(demo = true): void {
  if (document.querySelector('[data-thread-target]')) writeSession({ list: location.pathname });
  const list = readSession().list;
  if (list === '/neuro' || list === '/swe') {
    document.querySelectorAll<HTMLAnchorElement>('a[href="/#work"][data-back]').forEach((a) => (a.href = `${list}#work`));
  }
  if (demo) demoWhenNear();
}

/** ?fps: a small readout for checking a real device by hand. */
function showFps(): void {
  const el = document.createElement('output');
  el.className = 'mono meta';
  el.style.cssText = 'position:fixed;right:1rem;bottom:1rem;z-index:300;background:var(--paper);padding:.4rem .6rem;border:1px solid var(--tissue-faint)';
  document.body.append(el);
  setInterval(() => {
    const s = info.stats;
    el.textContent =
      info.state === 'static'
        ? `field off: ${info.reason ?? 'unknown'}`
        : s
          ? `${s.fps} fps · ${s.tier} · ${s.particles.toLocaleString()} particles`
          : info.state;
  }, 1000);
}

/** The demo's code and recordings (~200 KB) load only as its section comes within a screen. */
let demoIo: IntersectionObserver | null = null;
function demoWhenNear(): void {
  demoIo?.disconnect();
  const el = document.querySelector<HTMLElement>('main [data-demo]');
  if (!el) {
    // Left the page with the demo: the field lets its formation go.
    if (root.dataset.demo) bus.emit('emg:stage', { on: false });
    delete root.dataset.demo;
    return;
  }
  const io = (demoIo = new IntersectionObserver(
    (entries) => {
      if (!entries.some((e) => e.isIntersecting)) return;
      io.disconnect();
      import('../demo/demo').then((m) => (el.isConnected ? m.mountDemo(el) : undefined)).catch((e) => console.warn('demo failed to load', e));
    },
    { rootMargin: '100% 0px' },
  ));
  io.observe(el);
}

rememberPages();
pageReady();
void start();
