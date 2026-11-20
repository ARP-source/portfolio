# Signal

Anuraag Punnam's portfolio. A static Astro site with a GPU particle field behind it, built around real forearm EMG recordings. Every number on the site comes from a file or script in this repo.

## Run it

```sh
npm ci               # Node >= 22.23.4
npm run dev          # http://localhost:4321
npm run build        # static output in dist/
npm run check        # astro check (TypeScript 6.0.3)
npm run budget       # page weight and script size gates (see Budgets)
npm run demo:parity  # the browser classifier against the Python pipeline, within 0.1 point
```

Lighthouse, as CI runs it: `npm run build && npx astro preview & CHROME_PATH=/path/to/chrome LH_ASSERT=1 npm run lighthouse`.
It writes `src/data/lighthouse.json` (git-ignored), and the next build prints those numbers in the footer. Without the file the footer shows no score.

Query parameters for checking things by hand: `?fps` shows the frame rate and tier, `?field=off` skips the particles, `?tier=high|mid|static` forces a tier, `?mask=box|line|halo` switches how particles fade near text.

## How it fits together

| Path | What it owns |
| --- | --- |
| `src/site.config.ts` | Name, thesis line, links, the site's address, and the three project orderings (home, `/neuro`, `/swe`) |
| `src/tokens/tokens.ts` | Palette and motion constants. Emitted as CSS custom properties at build; the shaders read the same values |
| `src/content/projects/*.md` | One file per project: frontmatter (schema in `src/content.config.ts`) and the write-up |
| `src/content/changelog/*.md` | The site's own version history, shown at `/changelog` |
| `src/components/` | Astro components. No client JS of their own |
| `src/scripts/boot.ts` | The only script on a page (3.6 KB gz, `type=module`). Checks for hardware WebGL2, fetches the field and the hand alongside the page, and starts the field at `load` |
| `src/scripts/nav.ts` | Page changes once the field is running (see Moving between pages) |
| `src/field/` | The particle field: three.js `WebGLRenderer` and `GPUComputationRenderer`, positions and velocities in float textures. `Field.ts` owns the loop, tiers, text mask and teardown; `shaders.ts` the GLSL; `reform.ts` the timing and route of the hero re-forming; `hand.ts` the rigged hand |
| `src/demo/` | The drift demo: recordings, the in-browser LDA (`lda.ts`), the 3D map |
| `research/` | Python that produces the data: `hero_trace.py` (hero recording), `drift_pipeline.py` (all 43 participants, `src/data/drift.json`) |
| `scripts/` | `budget.mjs`, `lighthouse.mjs`, `demo-parity.ts`, `hand-points.py` (samples and rigs the hand mesh into `public/hand.bin`), `og.mjs` (the link-preview image) |
| `.github/workflows/ci.yml` | Check, build, budget, Lighthouse with a quality gate, rebuild with the measured numbers, deploy to Vercel |

Rules the code keeps: text is always HTML, never particles. Ink on paper: resting dots are tissue grey, signal is ink, and blue means drift and nothing else. No number without a source. No analytics.

## The field

- Away from the hero the particles fly as one flock, like starlings, filling the screen.
- In the hero, 60 % of them draw the recorded EMG line and the rest form a rigged 3D hand that cycles through the gestures the line was recorded from. Scrolling past the divider above the third project releases them into the flock. Scrolling back re-forms the hero: the line's dots follow a drawn route and pen the line from left to right, and the hand's dots spiral into a spinning funnel and build the hand from the wrist up. A fast scroll speeds both up.
- Further down, a tenth of the flock draws the graph of the project card nearest the middle of the screen, left to right. Opening that project carries those dots into the project page's own graph.
- In the demo, the particles form the classifier's gesture clouds and the posed hand.
- Near text the particles fade a little, so they pass behind the words.
- Tiers: without hardware WebGL2 and float render targets, or with a software renderer, the page keeps its static SVG trace. Desktop starts at mid (76² = 5,776 particles) and a fps probe promotes it to high (128² = 16,384) at 57 fps or more. Under 30 fps it steps down to mid, then drops the canvas to 1x pixel ratio. It never switches itself off for being slow; only a lost WebGL context does that. Phones stay at mid.
- `prefers-reduced-motion`: no animation loop. The field is placed on its formation and drawn once, and redrawn on scroll or resize.
- Hidden tab: the loop stops. `pagehide`: every GPU resource is disposed.

## Moving between pages

Before the field has started, links are ordinary links, and browsers with cross-document view transitions glide the project title and graph between pages (`src/styles/transitions.css`).

Once the field is running, `nav.ts` takes over same-site links. It fetches the next page on hover, then swaps the header, main, footer and inlined styles inside a same-document view transition with the same names, so the title still glides. The field is never rebuilt: it keeps running through the change, and `Field.pageChanged()` tells it what the new page holds. Back and forward restore the scroll position. Any failure falls back to loading the page normally.

## Budgets

- Per page, HTML with inlined CSS plus every font it references, counted in full: 94 to 115 KB (limit 150 KB).
- The boot module: 3.6 KB gz (limit 4 KB). Everything loaded after paint (three.js and the field, page changes, the demo): 158 KB gz (limit 200 KB). The hand's point cloud: 59 KB (limit 64 KB).
- Fonts: Fraunces (variable, Latin subset) 33 KB, preloaded; Fraunces italic 40 KB and JetBrains Mono 18 KB load on use.

`npm run budget` checks all of these and fails the build over any limit.

## Add a project

1. Add `src/content/projects/<slug>.md`. The schema rejects a `keyMetric` or `sparkline` without a `source`.
2. Only real series go in `sparkline` (x and y arrays and the file they came from). With no series the card shows `keyMetric`; with neither, the title carries the card's line.
3. Add the slug to the orderings in `src/site.config.ts`. The build fails if an ordering names a project that doesn't exist.

## Link previews

`public/og.jpg` is the image every page shares, made from the site's fonts, colours and a stretch of the hero recording. Regenerate it after changing any of those with `node scripts/og.mjs` (needs Playwright with Chromium). Preview tags use `site.url` in `src/site.config.ts`.

## Deploy (Vercel, from CI)

Vercel's own Git builds are switched off in `vercel.json`, because the deployed build must be the one Lighthouse measured. CI deploys once three repository secrets exist: `VERCEL_TOKEN`, `VERCEL_ORG_ID` and `VERCEL_PROJECT_ID`. Pushes to `master` deploy to production, other branches to a preview. Without the secrets the job still builds and measures, and nothing deploys.

## Credits

- Fraunces and JetBrains Mono, SIL Open Font License 1.1 (`src/assets/fonts/OFL-*.txt`).
- EMG: Jiang, N., Pradhan, A., & He, J. (2024). GRABMyo (version 1.1.0). PhysioNet. doi:10.13026/89dm-f662, CC BY 4.0. Pradhan, A., He, J. & Jiang, N. Sci Data 9, 733 (2022).
- three.js, MIT licence.
- The hand mesh: TODO(anuraag): source and licence.
