import type { Tier } from '../scripts/bus';

/** Particle counts are square texture sizes: 128² = 16,384 and 76² = 5,776. */
export const TIER_SIZE: Record<Exclude<Tier, 'static'>, number> = { high: 128, mid: 76 };

export interface Capabilities {
  tier: Tier;
  reason: string;
  halfFloat: boolean;
}

/** Cheap startup check, no three.js: WebGL2, renderable float targets, and device hints. */
export function detectCapabilities(): Capabilities {
  const forced = new URLSearchParams(location.search).get('tier') as Tier | null;
  const c = document.createElement('canvas');
  const gl = c.getContext('webgl2', { failIfMajorPerformanceCaveat: true });
  if (!gl) return { tier: 'static', reason: 'no hardware WebGL2', halfFloat: false };
  const fullFloat = !!gl.getExtension('EXT_color_buffer_float');
  const halfFloat = !fullFloat && !!gl.getExtension('EXT_color_buffer_half_float');
  const dbg = gl.getExtension('WEBGL_debug_renderer_info');
  const renderer = dbg ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)) : '';
  gl.getExtension('WEBGL_lose_context')?.loseContext();

  if (!fullFloat && !halfFloat) return { tier: 'static', reason: 'no float render targets', halfFloat };
  if (forced === 'high' || forced === 'mid' || forced === 'static') return { tier: forced, reason: 'forced by ?tier', halfFloat };
  if (/swiftshader|llvmpipe|software|basic render/i.test(renderer)) {
    return { tier: 'static', reason: `software renderer (${renderer})`, halfFloat };
  }
  const coarse = matchMedia('(pointer: coarse)').matches;
  const mem = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 8;
  const cores = navigator.hardwareConcurrency ?? 4;
  if (coarse || mem < 4 || cores < 4) return { tier: 'mid', reason: 'phone or low-memory hints', halfFloat };
  // Desktop starts at mid; the 1 s fps probe in Field promotes it to high when the GPU keeps up.
  return { tier: 'mid', reason: 'desktop, awaiting fps probe', halfFloat };
}
