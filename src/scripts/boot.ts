/**
 * Progressive enhancement entry. The page is complete without this file.
 * After load and an idle moment it checks the GPU, then fetches the Field chunk.
 * ?field=off skips it; ?tier=high|mid|static forces a tier.
 */
import { bus } from './bus';
import { observeSections } from './sections';
import { detectCapabilities } from '../field/tiers';

type Stats = { fps: number; tier: string; particles: number; frames: number };
declare global {
  interface Window {
    __signal?: { state: string; reason?: string; stats?: Stats; bootMs?: number };
  }
}

const root = document.documentElement;
const info: NonNullable<Window['__signal']> = (window.__signal = { state: 'waiting' });

function idle(fn: () => void): void {
  const go = () => ('requestIdleCallback' in window ? requestIdleCallback(fn, { timeout: 2000 }) : setTimeout(fn, 200));
  if (document.readyState === 'complete') go();
  else addEventListener('load', go, { once: true });
}

async function start(): Promise<void> {
  if (new URLSearchParams(location.search).get('field') === 'off') {
    info.state = 'off';
    return;
  }
  observeSections();
  const caps = detectCapabilities();
  if (caps.tier === 'static') {
    info.state = 'static';
    info.reason = caps.reason;
    bus.emit('field:tier', { tier: 'static', particles: 0, reason: caps.reason });
    return;
  }

  const t0 = performance.now();
  performance.mark('field:import');
  const { Field } = await import('../field/Field');
  performance.mark('field:imported');
  const canvas = document.createElement('canvas');
  canvas.className = 'field';
  canvas.setAttribute('aria-hidden', 'true');
  document.body.prepend(canvas);

  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  let field: InstanceType<typeof Field> | null = null;
  const fallback = (reason: string) => {
    field?.dispose();
    field = null;
    canvas.remove();
    delete root.dataset.field;
    info.state = 'static';
    info.reason = reason;
    bus.emit('field:tier', { tier: 'static', particles: 0, reason });
  };
  try {
    field = new Field({
      canvas,
      tier: caps.tier,
      halfFloat: caps.halfFloat,
      reducedMotion: reduced.matches,
      onFallback: fallback,
      onFirstFrame: () => {
        root.dataset.field = 'on';
        info.state = 'running';
        info.bootMs = Math.round(performance.now() - t0);
      },
    });
    info.stats = field.stats;
    info.reason = caps.reason;
    await field.start();
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

/** ?fps: a small readout for checking a real device by hand. */
function showFps(): void {
  const el = document.createElement('output');
  el.className = 'mono meta';
  el.style.cssText = 'position:fixed;right:1rem;bottom:1rem;z-index:300;background:var(--paper);padding:.4rem .6rem;border:1px solid var(--tissue-faint)';
  document.body.append(el);
  setInterval(() => {
    const s = info.stats;
    el.textContent = s ? `${s.fps} fps · ${s.tier} · ${s.particles.toLocaleString()} particles` : info.state;
  }, 1000);
}

idle(() => void start());
