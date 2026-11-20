/**
 * Single source of truth for colour and motion.
 * CSS custom properties are generated from this file at build time (see tokensCss),
 * and the particle shaders read the same values as uniforms.
 *
 * "Weil myelin": the page is a stained section on paper. Resting tissue is faint grey, a decoded
 * signal is black ink (myelin taking the Weil stain), and when the signal drifts the stain fails and
 * bleeds blue. Recalibration re-inks it. Drift blue is the only hue, and it appears only for drift.
 * Contrast against paper: ink 14.9, ink-soft 9.7, ink-dim 5.9, drift 5.7, drift-deep 7.5 (text OK);
 * tissue 1.7 and tissue-faint 1.3 are never used for text.
 */
export const palette = {
  paper: '#ECE8DE',
  paperRaised: '#F4F1EA',
  ink: '#161513',
  inkSoft: '#3A3732',
  inkDim: '#5C574E',
  tissue: '#B9B2A2',
  tissueFaint: '#D3CDBF',
  drift: '#2F5C8A',
  driftDeep: '#244A72',
} as const;

/**
 * One motion curve: a critically damped spring, x(t) = 1 - (1 + wt) e^(-wt).
 * w = 9 settles to within 0.1% at t = 1. The sim uses the same function for target blending.
 */
export const spring = { omega: 9 } as const;
export const springAt = (t: number, w = spring.omega) => 1 - (1 + w * t) * Math.exp(-w * t);

/**
 * Hero trace playback: the recording plays forward then backward (a seamless loop),
 * one full loop per periodS. The static SVG (CSS) and the particle trace (shader) share it.
 */
export const tracePlayback = { periodS: 36 } as const;

export const durations = {
  ui: 260, // UI transitions, 200-350 ms
  uiFast: 200,
  morph: 900, // formation morphs, 0.6-1.2 s
} as const;

/** CSS `linear()` approximation of the spring, sampled at 24 points. */
export function springLinear(samples = 24): string {
  const pts: string[] = [];
  for (let i = 0; i <= samples; i++) {
    const t = i / samples;
    const v = i === samples ? 1 : springAt(t);
    pts.push(`${v.toFixed(4)} ${(t * 100).toFixed(1)}%`);
  }
  return `linear(${pts.join(', ')})`;
}

const kebab = (s: string) => s.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);

/** The :root block injected into every page's <head>. */
export function tokensCss(): string {
  const colours = Object.entries(palette)
    .map(([k, v]) => `--${kebab(k)}:${v}`)
    .join(';');
  return `:root{${colours};--ease-spring:${springLinear()};--dur-ui:${durations.ui}ms;--dur-ui-fast:${durations.uiFast}ms;--dur-morph:${durations.morph}ms;--trace-period:${tracePlayback.periodS}s}`;
}
