/**
 * Build-time numbers for Demo.astro, computed by the same code the page runs, from the same assets,
 * so the page without JS says exactly what the live demo measures.
 */
import { readFileSync } from 'node:fs';
import { decode, stack, type EmgMeta } from './emg';
import { accuracy, addWindows, fit, predict } from './lda';
import { clouds, mapFrame, mapView, project } from './map';

export function demoSummary() {
  const meta = JSON.parse(readFileSync('public/demo/emg.json', 'utf8')) as EmgMeta;
  const bin = readFileSync('public/demo/emg.bin');
  const emg = decode(meta, bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength));
  const tested = (day: number) => stack(emg.clips.filter((c) => c.day === day && c.role !== 'recal'));
  const t1 = tested(1);
  const t29 = tested(29);
  const base = fit(emg.stats);
  const acc = { day1: accuracy(base, t1.rows, t1.labels), day29: accuracy(base, t29.rows, t29.labels), recal: [] as number[] };
  let s = emg.stats;
  for (const k of [1, 2, 3]) {
    const r = stack(emg.clips.filter((c) => c.day === 29 && c.role === 'recal' && c.trial === k));
    s = addWindows(s, r.rows, r.labels);
    acc.recal.push(accuracy(fit(s), t29.rows, t29.labels));
  }
  // Where the day-29 loss is: the gesture the day-1 model gets wrong most often, and what it calls it.
  const perGesture = meta.gestures.map((_, g) => {
    const idx = t29.labels.flatMap((l, i) => (l === g ? [i] : []));
    const preds = idx.map((i) => predict(base, t29.rows[i]!));
    const counts = meta.gestures.map((__, k) => preds.filter((p) => p === k).length);
    const wrong = counts.map((c, k) => (k === g ? -1 : c));
    return { ok: counts[g]! / idx.length, as: wrong.indexOf(Math.max(...wrong)) };
  });
  const worst = perGesture.reduce((w, x, g) => (perGesture[w]!.ok > x.ok ? g : w), 0);
  // One amplitude scale for every clip, so day 1 and day 29 can be compared by eye.
  const scale = Math.max(...emg.clips.flatMap((c) => (c.trace ? Array.from(c.trace, Math.abs) : [])));
  const play = emg.clips.find((c) => c.day === 1 && c.gesture === 0 && c.role === 'play+test')!;
  const path = (tr: ArrayLike<number>, W: number, H: number) =>
    Array.from(tr, (v, i) => `${i ? 'L' : 'M'}${((i / (tr.length - 1)) * W).toFixed(1)} ${(H / 2 - (v / scale) * H * 0.46).toFixed(1)}`).join('');
  const view = mapView(meta.model.map);
  const frame = mapFrame([...t1.rows, ...t29.rows].map((r) => project(view, r)));
  return { meta, acc, worst, worstAs: perGesture[worst]!.as, scale, play, path, frame, day1Clouds: clouds(emg.stats, view) };
}
