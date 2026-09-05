# UI plan — visuals and performance of `packages/app`

The app's look and its load-time cost, as a worked list. Everything in this
file is **app wiring only** in APP.md's sense: no engine capability, no
validation rung, no physics. Read `docs/APP.md` § *What the app itself needs
to hold this* first — item 6 there is what this plan continues — and `CLAUDE.md`
for the hard rules that still apply to app work (no DOM in `packages/core`,
every commit typechecks and passes `npm test`, worker URL literals live in
`src/`).

Each step below is written so that it can be executed on its own: what to
change, in which file, how to check it, and what must NOT change. Do them in
order unless a step says otherwise; each is one commit.

## What has landed (2026-09-05)

For context, so the steps below do not re-do it:

- **Design tokens.** `packages/app/src/styles.css` defines every colour as a
  CSS variable, once for light on `:root` and once for dark in two blocks
  (`prefers-color-scheme` and explicit `data-theme="dark"`). The panels name
  tokens (`var(--ink-4)`, `var(--bad)`) instead of hex. `#000` on a raster
  canvas is the one literal kept: a picture's background is an image plane.
  `packages/app/test/theme.test.ts` pins the seam.
- **Theme state.** `packages/app/src/theme.ts`: `system | light | dark`, stored
  in `localStorage`, stamped as `data-theme` on `<html>`; `index.html` stamps it
  inline before the bundle loads so dark never flashes white.
  `useThemeVersion()` changes when the palette does; `resolveColor(element,
  color)` turns a `var(--x)` into a colour a canvas can use.
- **Lazy routes.** `panels/registry.ts` wraps every component in
  `lazy(() => import(...))`. Entry chunk 840 KB → 160 KB; each panel is its own
  chunk beside its worker. `App.tsx` has a `Suspense` fallback.
- **Shell.** `App.tsx` renders a sticky header, a nav in three rows (one per
  `group` in the registry), a theme toggle, and sets `document.title` per route.

The token names and what each is for:

| token | use |
| --- | --- |
| `--bg`, `--bg-2`, `--bg-3` | page, subtle fill, hover fill |
| `--line`, `--line-2` | control border, table rule |
| `--ink` … `--ink-5` | text, darkest to lightest |
| `--ok`, `--warn`, `--warn-strong`, `--bad` and `-tint` | the guard colours (`ui.tsx`) |
| `--accent`, `--accent-2`, `--blue`, `--blue-2` | links, "you are here" markers |
| `--green`, `--red`, `--red-2`, `--red-3`, `--orange`, `--purple`, `--pink` | plot series |
| `--mono`, `--sans` | font stacks |

## Step 1 — `React.memo` on `Plot`, and stable series in the panels that drag

**Why.** `Plot` redraws its canvas in an effect keyed on `props`, and every
panel builds `series` arrays inline, so every render of a panel — including
the ones a slider fires at 60 Hz while its worker is busy — redraws every plot
on the page. The plots are cheap individually; a panel with four of them and a
`pending` flag flipping is not.

**Change.**

1. In `packages/app/src/plot.tsx`, export `Plot` wrapped in `memo` from React.
   Props are compared shallowly, so this only helps once the panels stop
   rebuilding the arrays.
2. In each panel that has both a `Slider` and a `Plot`, wrap the `series` and
   `markers` construction in `useMemo` keyed on the engine result they are
   built from (the worker result, or the `useMemo` result of a main-thread
   compute) — NOT on the slider state. Start with `panels/mtf.tsx`,
   `panels/curvature.tsx`, `panels/coverslip.tsx`, `panels/tolerance.tsx`,
   `panels/mech.tsx`, `panels/camera.tsx`, `panels/volume.tsx`.

**Check.** Open the panel, hold a slider mid-drag: the plot must not flicker
and `npm run typecheck` must pass. There is no automated test for a redraw
count; note the before/after in the commit message instead.

**Must not change.** Series contents. A `useMemo` whose dependency list omits
something the series reads will show stale curves — list every input.

## Step 2 — transfer the picture buffers out of the workers

**Why.** Every worker posts `{ seq, result }` where `result.rgba` is a
`Uint8ClampedArray` over a 256²×4 or larger buffer. `postMessage` without a
transfer list structured-clones it (a copy), and the panel then copies again
into a fresh `Uint8ClampedArray` for `ImageData`. Two copies per frame; the
refining star field posts several frames per job.

**Change.** In each `src/*.worker.ts` whose result carries a typed array,
post with a transfer list:

```ts
const result = renderStar(request);
ctx.postMessage({ seq, result }, [result.rgba.buffer]);
```

Update the narrowed `ctx` type in each worker so `postMessage` accepts the
second argument (`postMessage: (message: X, transfer?: Transferable[]) => void`).
On the panel side the `new Uint8ClampedArray(result.rgba)` copy stays: the
comment there is right that `ImageData` wants a plain `ArrayBuffer` backing,
and after a transfer the buffer is plain.

**Check.** Every panel still paints; the app tests still pass (`npx vitest run
packages/app`). Measure `elapsedMs` on the star panel before and after: it is
the worker's number and should not move — the saving is on the main thread,
visible as a less jerky slider on the star field.

**Must not change.** A worker that reuses a buffer across jobs (search for a
module-level typed array in the adapter) must NOT transfer it — a transferred
buffer is detached and the next job would write into nothing. `stage.worker.ts`
keeps a tile cache on the panel side; check `stage.ts` before touching it.

## Step 3 — an error boundary around the panel

**Why.** A panel that throws during render blanks the whole page, nav
included, and the only way back is editing the URL. With lazy routes there is
now a second failure — a chunk that fails to load offline — that surfaces the
same way.

**Change.** Add `packages/app/src/panels/boundary.tsx`: a class component
(`componentDidCatch`) that renders the error's message in the `panel-loading`
style, in `var(--bad)`, with the nav still above it. Wrap the `<Suspense>` in
`App.tsx` with it, keyed the same way so a route change resets it.

**Check.** Temporarily throw from a panel's render, confirm the nav survives,
remove the throw. Typecheck.

## Step 4 — share the engine between the worker chunks

**Why.** `dist/` is ~2.7 MB because thirty-three workers each bundle their own
copy of `packages/core`. Vite can emit shared chunks between ES-format workers.

**Change.** In `packages/app/vite.config.ts`:

```ts
export default defineConfig({
  plugins: [react()],
  worker: { format: "es" },
});
```

Run `npm run build --workspace @telemicroscope/app` and compare the total of
`dist/assets` before and after (`ls -l dist/assets | awk '{s+=$5} END {print s}'`).
If the total does not fall, the workers are already deduplicated by content
hashing at the CDN level and this step is a no-op: revert and record the number
here.

**Check.** Open every panel in the dev server after the change (the worker
format affects dev too). A worker that fails to load shows as a panel that
never leaves "tracing…"; the browser console names the 404.

**Must not change.** The `new Worker(new URL("./x.worker.ts", import.meta.url), { type: "module" })`
literals in `src/workers.ts` — the file's header says why they must stay there.

## Step 5 — shared readout classes instead of 185 inline `fontFamily` styles

**Why.** Every readout in the app is `style={{ fontFamily: "var(--mono)", fontSize: 12, ... }}`
written out by hand, ~185 times. It works, and it is the reason a change of
size or leading is a thirty-file edit.

**Change.** Add to `styles.css`:

```css
.readout { font-family: var(--mono); font-size: 12px; line-height: 1.6; }
.readout-note { font-family: var(--mono); font-size: 11px; color: var(--ink-4); }
.prose { max-width: 640px; color: var(--ink-2); }
```

Then, ONE PANEL PER COMMIT, replace the inline objects with `className` where
the inline style is exactly those properties, keeping any extra property
(`minWidth`, `marginTop`) inline. Do `ui.tsx` first, because its components
are used everywhere. Do not touch a panel's `Plot` colours or its canvases.

**Check.** Screenshot the panel before and after at the same route; they must
match to the pixel apart from anti-aliasing. `npm run typecheck`.

## Step 6 — canvases that fit the viewport

**Why.** Every picture is a fixed CSS size (`width: 320, height: 320`), so on a
narrow window the page scrolls sideways.

**Change.** Give the raster canvases `style={{ width: "min(320px, 100%)", aspectRatio: "1" }}`
and let `height` follow; the `imageRendering: "pixelated"` stays. For `Plot`,
make `width` default to the container's width via a `ResizeObserver` on the
`<figure>`, clamped to `[280, props.width ?? 420]`, and re-run the draw effect
on change. The hotspot overlays in `panels/telescope.tsx` scale by
`displayPx / result.size` — read `displayPx` from the canvas's client width
rather than the constant.

**Check.** Resize the window to 600 px wide: no horizontal scrollbar on the
page (tables inside `.scroll-x` / `overflowX: auto` may scroll on their own).
The star-field hotspots still sit on the stars.

## Step 7 — prefetch the neighbouring routes

**Why.** A lazy route costs one network round trip on first visit. The nav is
a reading order, so the next entry is the likely next click.

**Change.** In `App.tsx`, on `mouseenter` / `focus` of a nav link call the
registry entry's loader. To make the loader callable, keep the `lazy(...)`
component AND store the import thunk on the entry (`load: () => import("./x")`),
and build `Component` from `load` so there is one thunk per panel, not two.

**Check.** Network tab: hovering a nav entry fetches its chunk; clicking it
then paints without a "loading…" flash.

## Step 8 — the three-way theme control

**Why.** The toggle cycles auto → dark → light, which is discoverable only by
clicking. A segmented control with three labelled options says what it is.

**Change.** Replace the button in `App.tsx` with three `nav-link`-styled
buttons (`auto` / `light` / `dark`), `aria-pressed` on the active one, calling
`setThemeChoice`. Keep `cycleTheme` exported for keyboard use if wanted.

## Out of scope, and why

- **Keeping a panel's workers alive across routes.** APP.md item 1 chose the
  re-trace on return as the honest trade; the elapsed time is on screen.
- **A chart library.** `plot.tsx`'s header: a smoothed curve through measured
  points is a drawing of a claim rather than the claim.
- **Any change to what a panel computes or shows.** That is a panel step in
  APP.md, with its own section.
