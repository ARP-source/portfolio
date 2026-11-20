// Runs Lighthouse against a served build (default: `astro preview` on :4321), 3 runs per form factor,
// takes the median performance run, and writes src/data/lighthouse.json for the footer.
// CI runs this, then rebuilds so the footer carries the measured numbers. Never edit the JSON by hand.
import { writeFile, mkdir } from 'node:fs/promises';
import lighthouse from 'lighthouse';
import desktopConfig from 'lighthouse/core/config/desktop-config.js';
import * as chromeLauncher from 'chrome-launcher';

const base = process.env.LH_URL ?? 'http://localhost:4321';
const paths = (process.env.LH_PATHS ?? '/').split(',');
const runs = Number(process.env.LH_RUNS ?? 3);
const chrome = await chromeLauncher.launch({
  chromePath: process.env.CHROME_PATH,
  chromeFlags: ['--headless=new', '--no-sandbox', '--disable-gpu'],
});

const score = (lhr, k) => Math.round((lhr.categories[k]?.score ?? 0) * 100);
const results = {};
try {
  for (const path of paths) {
    for (const formFactor of ['mobile', 'desktop']) {
      const lhrs = [];
      for (let i = 0; i < runs; i++) {
        const { lhr } = await lighthouse(
          base + path,
          { port: chrome.port, output: 'json', logLevel: 'error' },
          formFactor === 'desktop' ? desktopConfig : undefined,
        );
        lhrs.push(lhr);
      }
      lhrs.sort((a, b) => score(a, 'performance') - score(b, 'performance'));
      const lhr = lhrs[Math.floor(lhrs.length / 2)];
      const a = lhr.audits;
      results[`${path} ${formFactor}`] = {
        performance: score(lhr, 'performance'),
        accessibility: score(lhr, 'accessibility'),
        bestPractices: score(lhr, 'best-practices'),
        seo: score(lhr, 'seo'),
        lcpMs: Math.round(a['largest-contentful-paint'].numericValue),
        cls: Number(a['cumulative-layout-shift'].numericValue.toFixed(3)),
        tbtMs: Math.round(a['total-blocking-time'].numericValue),
        transferKb: Math.round(a['total-byte-weight'].numericValue / 1024),
        failing: Object.values(a)
          .filter((x) => x.score !== null && x.score < 0.9 && x.scoreDisplayMode === 'binary')
          .map((x) => x.id),
      };
      console.log(path, formFactor, JSON.stringify(results[`${path} ${formFactor}`]));
    }
  }
} finally {
  chrome.kill();
}

if (process.env.LH_WRITE !== '0') {
  const home = (f) => results[`/ ${f}`];
  await mkdir('src/data', { recursive: true });
  await writeFile(
    'src/data/lighthouse.json',
    JSON.stringify(
      {
        measuredAt: new Date().toISOString(),
        url: '/',
        lighthouse: (await import('lighthouse/package.json', { with: { type: 'json' } })).default.version,
        mobile: home('mobile'),
        desktop: home('desktop'),
        all: results,
      },
      null,
      2,
    ) + '\n',
  );
}

// Quality gate from the brief: Performance >= 98, Accessibility 100, Best Practices 100 on every run page.
if (process.env.LH_ASSERT === '1') {
  const bad = Object.entries(results).filter(
    ([, r]) => r.performance < 98 || r.accessibility < 100 || r.bestPractices < 100,
  );
  for (const [k, r] of bad) console.error(`GATE FAIL ${k}: perf ${r.performance} a11y ${r.accessibility} bp ${r.bestPractices} ${r.failing.join(',')}`);
  if (bad.length) process.exit(1);
}
