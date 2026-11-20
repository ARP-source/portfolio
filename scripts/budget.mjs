// Budget gate for the built site: per page, gzip-transferred HTML (with its inlined CSS) plus every
// font, stylesheet or script it references must stay under 150 KB, and no page may ship a <script>.
// Fonts declared in @font-face count in full even though browsers fetch them only when used:
// this is the worst case.
import { readFile, readdir, stat } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import { join } from 'node:path';

const DIST = 'dist';
const LIMIT = 150 * 1024;
const walk = async (d) =>
  (await Promise.all((await readdir(d)).map(async (f) => ((await stat(join(d, f))).isDirectory() ? walk(join(d, f)) : join(d, f))))).flat();
let failed = false;
for (const page of (await walk(DIST)).filter((f) => f.endsWith('.html')).sort()) {
  const html = await readFile(page, 'utf8');
  const refs = new Set([...html.matchAll(/(\/_astro\/[^"')\s]+\.(?:css|woff2|js))/g)].map((m) => m[1]));
  const scripts = (html.match(/<script\b/g) ?? []).length;
  let total = gzipSync(html, { level: 9 }).length;
  for (const r of refs) {
    const buf = await readFile(join(DIST, r));
    total += r.endsWith('.woff2') ? buf.length : gzipSync(buf, { level: 9 }).length;
  }
  const ok = total <= LIMIT && scripts === 0;
  failed ||= !ok;
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${(total / 1024).toFixed(1).padStart(6)} KB  scripts=${scripts}  ${page.slice(DIST.length)}`);
}
process.exit(failed ? 1 : 0);
