# Signal

Anuraag Punnam's portfolio. A static Astro site that reads like an instrument: real signals, real numbers, every one with a source.

Status: **Phase 2, static shell.** No JavaScript ships yet; the particle field (Phase 3) and the "Hold to contract" demo (Phase 4) are progressive enhancements on top of this.

## Run it

```sh
npm ci               # Node >= 22.23.4
npm run dev          # http://localhost:4321
npm run build        # static output in dist/
npm run budget       # per-page weight gate (< 150 KB, zero <script>)
npm run check        # astro check (TypeScript 6.0.3)
```

Lighthouse, as CI runs it: `npm run build && npx astro preview & CHROME_PATH=/path/to/chrome LH_ASSERT=1 npm run lighthouse`.
It writes `src/data/lighthouse.json` (git-ignored); the next build prints those numbers in the footer. With no file, the footer shows no score.

## How it fits together

| Path | What it owns |
| --- | --- |
| `src/site.config.ts` | Editable constants: name, thesis line, links, and the three project orderings (home, `/neuro`, `/swe`) |
| `src/tokens/tokens.ts` | Palette and the one motion curve (critically damped spring). Emitted as CSS custom properties at build; the particle shaders will read the same values |
| `src/styles/global.css` | Type, grain overlay, graticule rules, the shared `.trace` stroke style |
| `src/content/projects/*.md` | One file per project: frontmatter (schema in `src/content.config.ts`) + Question, Setup, Result, What failed, What's next |
| `src/components/` | Astro components, no client JS |
| `src/scripts/boot.ts` | The only script on a page (2.4 KB gz, `type=module`). After `load` and an idle moment it checks for hardware WebGL2, then imports the Field. `?field=off` skips it, `?tier=high\|mid\|static` forces a tier, `?fps` shows a readout |
| `src/scripts/bus.ts` | Typed event bus: `section:enter/leave`, `field:tier`, `field:pause`, and the `emg:*` events for Phase 4 |
| `src/field/` | The particle field: three.js `WebGLRenderer` + `GPUComputationRenderer` (positions and velocities live in float textures). `Field.ts` owns the loop, tiers, text mask and teardown; `shaders.ts` holds the GLSL |
| `src/data/hero-trace.json` | The hero trace: one real GRABMyo recording, produced by `research/hero_trace.py` |
| `.github/workflows/ci.yml` | check, build, budget, Lighthouse with the quality gate, rebuild with measured numbers, deploy to Vercel |

Rules the code keeps: text is always HTML, never particles; colour means state (bone reads, olive rests, bronze signals, verdigris drifts); no number without a `source`; no analytics.

## The field

- Formations so far: `swarm` (idle drift on a curl-noise flow, each particle steered toward a slowly wandering home) and `trace` (particles spring onto the same GRABMyo recording the SVG hero draws, then lock to it while it plays). The hero section switches between them through the bus.
- Particles start on whatever formation the page shows, so nothing animates on load. They only move fast in response to the visitor: pointer (140 px push), scroll, section changes.
- Particles near text: by default (`halo`) text carries a soft dark halo and particles fade a little around each rendered line, so they pass behind the words instead of leaving empty boxes. `?mask=line` (stronger fade per line) and `?mask=box` (v1, padded element boxes) are kept for comparison.
- The hero trace plays: the recording runs forward then backward on a 36 s loop (`tracePlayback` in `tokens.ts`). The static SVG and the particles share that clock, so the hand-off between them doesn't jump.
- Tiers: no hardware WebGL2 or float targets, or a software renderer, gives the static SVG. Phones start and stay at mid (76² = 5,776). Desktop starts at mid and a 1 s fps probe promotes it to high (128² = 16,384) at 57 fps or more; under 30 fps it steps down once, then gives up to the static SVG. DPR is capped at 1.5 (mid) or 2 (high).
- `prefers-reduced-motion`: no animation loop. The field is placed on its formation and drawn once, and redrawn when you scroll or resize.
- Hidden tab: the loop stops. `pagehide`: every GPU resource is disposed.

## Budgets

- HTML + inlined CSS + fonts, worst case per page: 93 to 100 KB (limit 150 KB).
- JS: the boot module is 2.4 KB gz (limit 4 KB). The field chunk loaded after paint is 134 KB gz (limit 200 KB). `npm run budget` checks all three.
- Fonts: Fraunces (variable, Latin subset) 33 KB preloaded; Fraunces italic 40 KB and JetBrains Mono 18 KB load on use.

## Add a project

1. Add `src/content/projects/<slug>.md`. The schema rejects a missing `source` on `keyMetric` or `sparkline`.
2. Only real series go in `sparkline` (x and y arrays plus the file they came from). No series: leave it out, and the card shows `keyMetric` in mono. No metric either: leave both out.
3. Add the slug to the orderings in `src/site.config.ts`. The build fails if an ordering names a project that doesn't exist.

## Deploy (Vercel, from CI)

Vercel's own Git builds are switched off in `vercel.json`, because the deployed build must be the one Lighthouse measured. Add three repository secrets: `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`. Pushes to `master` deploy to production, other branches to preview. Without the secrets the job still builds and measures.

## Credits

- Fraunces and JetBrains Mono, SIL Open Font License 1.1 (`src/assets/fonts/OFL-*.txt`).
- EMG: Jiang, N., Pradhan, A., & He, J. (2024). GRABMyo (version 1.1.0). PhysioNet. doi:10.13026/89dm-f662, CC BY 4.0. Pradhan, A., He, J. & Jiang, N. Sci Data 9, 733 (2022).
