// Budget gate for the built site.
// 1. Per page, gzip-transferred HTML (with inlined CSS) plus every font and stylesheet it references
//    must stay under 150 KB. Fonts declared in @font-face count in full: this is the worst case.
// 2. Scripts are enhancement only: each page may load just the boot module (type=module, so deferred
//    and never render-blocking), which must stay under 4 KB gz.
// 3. Everything the boot module imports lazily after paint (three.js + the sim) must stay under 200 KB gz.
import { readFile, readdir, stat } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import { join } from 'node:path';

const DIST = 'dist';
const PAGE_LIMIT = 150 * 1024;
const BOOT_LIMIT = 4 * 1024;
const LAZY_LIMIT = 200 * 1024;
const kb = (n) => `${(n / 1024).toFixed(1).padStart(6)} KB`;
const gz = (buf) => gzipSync(buf, { level: 9 }).length;
const walk = async (d) =>
  (await Promise.all((await readdir(d)).map(async (f) => ((await stat(join(d, f))).isDirectory() ? walk(join(d, f)) : join(d, f))))).flat();

let failed = false;
const boots = new Set();
for (const page of (await walk(DIST)).filter((f) => f.endsWith('.html')).sort()) {
  const html = await readFile(page, 'utf8');
  const refs = new Set([...html.matchAll(/(\/_astro\/[^"')\s]+\.(?:css|woff2))/g)].map((m) => m[1]));
  const scripts = [...html.matchAll(/<script\b([^>]*)>/g)].map((m) => m[1]);
  const blocking = scripts.filter((a) => !/type="module"/.test(a)).length;
  for (const a of scripts) {
    const src = a.match(/src="([^"]+)"/)?.[1];
    if (src) boots.add(src);
  }
  let total = gz(html);
  for (const r of refs) {
    const buf = await readFile(join(DIST, r));
    total += r.endsWith('.woff2') ? buf.length : gz(buf);
  }
  const ok = total <= PAGE_LIMIT && blocking === 0 && scripts.length <= 1;
  failed ||= !ok;
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${kb(total)}  scripts=${scripts.length} blocking=${blocking}  ${page.slice(DIST.length)}`);
}

let bootTotal = 0;
const lazy = new Set();
for (const src of boots) {
  const code = await readFile(join(DIST, src));
  bootTotal = Math.max(bootTotal, gz(code));
  for (const m of code.toString().matchAll(/import\(\s*["'`]\.\/([^"'`]+\.js)["'`]\s*\)/g)) lazy.add(`/_astro/${m[1]}`);
}
let lazyTotal = 0;
for (const f of lazy) lazyTotal += gz(await readFile(join(DIST, f)));
const bootOk = bootTotal <= BOOT_LIMIT;
const lazyOk = lazyTotal <= LAZY_LIMIT && (boots.size === 0 || lazy.size > 0);
failed ||= !bootOk || !lazyOk;
console.log(`${bootOk ? 'ok  ' : 'FAIL'}  ${kb(bootTotal)}  boot module (limit 4 KB)`);
console.log(`${lazyOk ? 'ok  ' : 'FAIL'}  ${kb(lazyTotal)}  after-paint field chunk${lazy.size === 1 ? '' : 's'} (limit 200 KB): ${[...lazy].join(', ')}`);
process.exit(failed ? 1 : 0);
