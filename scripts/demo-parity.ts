/**
 * Checks that the browser's LDA (src/demo/lda.ts, on the float16 assets) reproduces the accuracies
 * research/drift_pipeline.py measured for the demo participant, recalibration included.
 * Run: node scripts/demo-parity.ts
 */
import { readFileSync } from 'node:fs';
import { decode, stack, type EmgMeta } from '../src/demo/emg.ts';
import { accuracy, addWindows, fit } from '../src/demo/lda.ts';

const meta = JSON.parse(readFileSync('public/demo/emg.json', 'utf8')) as EmgMeta;
const bin = readFileSync('public/demo/emg.bin');
const emg = decode(meta, bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength));
const pick = (day: number, roles: string[], trials?: number[]) =>
  stack(emg.clips.filter((c) => c.day === day && roles.includes(c.role) && (!trials || trials.includes(c.trial))));

const m1 = fit(emg.stats);
const t1 = pick(1, ['play+test', 'test']);
const t29 = pick(29, ['play+test', 'test']);
const got: Record<string, number> = {
  day1: accuracy(m1, t1.rows, t1.labels),
  day29: accuracy(m1, t29.rows, t29.labels),
};
let s = emg.stats;
for (const k of [1, 2, 3]) {
  const r = pick(29, ['recal'], [k]);
  s = addWindows(s, r.rows, r.labels);
  got[`recal${k}`] = accuracy(fit(s), t29.rows, t29.labels);
}
let worst = 0;
for (const [k, v] of Object.entries(got)) {
  const want = meta.accuracy[k as keyof EmgMeta['accuracy']];
  worst = Math.max(worst, Math.abs(v - want));
  console.log(`${k.padEnd(7)} python ${(want * 100).toFixed(2)}%  browser ${(v * 100).toFixed(2)}%`);
}
console.log(`largest difference ${(worst * 100).toFixed(2)} points`);
if (worst > 0.01) process.exit(1);
