/**
 * The demo's data: public/demo/emg.json (provenance, model statistics, clip index) and emg.bin
 * (float16 arrays the index points into), both written by research/drift_pipeline.py.
 */
import { statsFrom, type LdaStats } from './lda.ts';

export type Role = 'play+test' | 'test' | 'recal';

interface Span {
  offset: number;
  length: number;
}

export interface ClipMeta {
  gesture: number;
  day: number;
  trial: number;
  role: Role;
  windows: number;
  features: Span;
  trace?: Span & { pair: string };
  envelope?: Span & { hz: number };
}

export interface EmgMeta {
  source: string;
  doi: string;
  license: string;
  participant: number;
  selection: string;
  gestures: { id: number; label: string }[];
  windowing: { lengthMs: number; stepMs: number; trimS: number };
  featureCount: number;
  model: { lambda: number; n: number[]; mean: number[][]; scatterUpper: number[] };
  accuracy: Record<'day1' | 'day8' | 'day29' | 'recal1' | 'recal2' | 'recal3', number>;
  clips: ClipMeta[];
}

export interface Clip {
  gesture: number;
  day: number;
  trial: number;
  role: Role;
  /** One z-scored feature vector per 200 ms window, stepped every 50 ms. */
  rows: Float32Array[];
  /** Min/max-decimated trace of the most active pair, in units of 50 uV. */
  trace?: Float32Array;
  pair?: string;
  /** RMS envelope over all pairs, in units of 50 uV, at envelopeHz. */
  envelope?: Float32Array;
  envelopeHz?: number;
}

export interface Emg {
  meta: EmgMeta;
  clips: Clip[];
  stats: LdaStats;
}

export function decode(meta: EmgMeta, buf: ArrayBuffer): Emg {
  const view = new DataView(buf);
  const read = (s: Span) => {
    const out = new Float32Array(s.length);
    for (let i = 0; i < s.length; i++) out[i] = half(view.getUint16(s.offset + 2 * i, true));
    return out;
  };
  const d = meta.featureCount;
  const clips = meta.clips.map((c): Clip => {
    const f = read(c.features);
    const rows = Array.from({ length: c.windows }, (_, i) => f.subarray(i * d, (i + 1) * d));
    return {
      gesture: c.gesture,
      day: c.day,
      trial: c.trial,
      role: c.role,
      rows,
      ...(c.trace && { trace: read(c.trace), pair: c.trace.pair }),
      ...(c.envelope && { envelope: read(c.envelope), envelopeHz: c.envelope.hz }),
    };
  });
  const m = meta.model;
  return { meta, clips, stats: statsFrom(m.lambda, m.n, m.mean, m.scatterUpper) };
}

export async function loadEmg(base = '/demo/'): Promise<Emg> {
  const [meta, buf] = await Promise.all([
    fetch(base + 'emg.json').then((r) => r.json() as Promise<EmgMeta>),
    fetch(base + 'emg.bin').then((r) => r.arrayBuffer()),
  ]);
  return decode(meta, buf);
}

/** Stack clips into rows and labels. */
export function stack(clips: Clip[]): { rows: Float32Array[]; labels: number[] } {
  const rows: Float32Array[] = [];
  const labels: number[] = [];
  for (const c of clips) for (const r of c.rows) rows.push(r), labels.push(c.gesture);
  return { rows, labels };
}

function half(h: number): number {
  const s = h & 0x8000 ? -1 : 1;
  const e = (h >> 10) & 0x1f;
  const f = h & 0x3ff;
  if (e === 0) return s * f * 2 ** -24;
  if (e === 31) return f ? NaN : s * Infinity;
  return s * (1 + f / 1024) * 2 ** (e - 15);
}
