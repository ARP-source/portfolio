// The link-preview image (public/og.jpg, 1200 x 630): the name, the thesis line and a real stretch
// of the hero's forearm recording, in the site's own fonts and colours.
// Run after changing any of those: node scripts/og.mjs (needs Playwright with Chromium installed).
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const root = fileURLToPath(new URL('..', import.meta.url));
const read = (p) => readFile(root + p);
const trace = JSON.parse(await read('src/data/hero-trace.json'));
const config = (await read('src/site.config.ts')).toString();
const name = config.match(/name: '([^']+)'/)[1];
const thesis = config.match(/thesis: '([^']+)'/)[1];
const tokens = (await read('src/tokens/tokens.ts')).toString();
const color = (k) => tokens.match(new RegExp(`${k}: '(#[0-9A-Fa-f]{6})'`))[1];
const font = async (f) => `data:font/woff2;base64,${(await read(`src/assets/fonts/${f}`)).toString('base64')}`;

// Two gestures end to end (hand close, then open), as the hero plays them.
const pts = ['close', 'open'].flatMap((k) => trace.clips.find((c) => c.key === k).points);
const W = 1040, H = 150;
const d = pts.map((v, i) => `${i ? 'L' : 'M'}${((i / (pts.length - 1)) * W).toFixed(1)} ${(H / 2 - v * H * 0.44).toFixed(1)}`).join('');

const grain = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='180' height='180'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.65' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.05'/%3E%3C/svg%3E")`;
const html = `<!doctype html><html><head><style>
@font-face { font-family: Fraunces; src: url(${await font('fraunces-wght.woff2')}); font-weight: 100 900; }
@font-face { font-family: Mono; src: url(${await font('jetbrains-mono-wght.woff2')}); font-weight: 100 800; }
html, body { margin: 0; width: 1200px; height: 630px; overflow: hidden; }
body { background: ${color('paper')} ${grain}; background-blend-mode: multiply; color: ${color('ink')}; font-family: Fraunces; padding: 72px 80px; box-sizing: border-box; }
h1 { font-size: 92px; font-weight: 640; letter-spacing: -0.02em; line-height: 1; margin: 0 0 24px; }
p { font-size: 36px; line-height: 1.25; margin: 0; max-width: 900px; color: ${color('inkSoft')}; }
svg { position: absolute; left: 80px; bottom: 92px; overflow: visible; }
.cap { position: absolute; left: 80px; bottom: 52px; font: 400 18px Mono; color: ${color('inkDim')}; }
</style></head><body>
<h1>${name}</h1><p>${thesis}</p>
<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><path d="${d}" fill="none" stroke="${color('ink')}" stroke-width="2" stroke-linejoin="round"/></svg>
<div class="cap">Forearm EMG, hand close then open. GRABMyo, participant 1, day 1 (CC BY 4.0)</div>
</body></html>`;

let chromium;
try {
  ({ chromium } = await import('playwright').catch(() => createRequire(import.meta.url)('playwright')));
} catch {
  console.error('og: needs Playwright (npm i -D playwright && npx playwright install chromium)');
  process.exit(1);
}
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
await page.setContent(html);
await page.evaluate(() => document.fonts.ready);
await writeFile(root + 'public/og.jpg', await page.screenshot({ type: 'jpeg', quality: 88 }));
await browser.close();
console.log('wrote public/og.jpg');
