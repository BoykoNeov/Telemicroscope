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

- **Memoized plots (step 1).** `plot.tsx` exports `Plot` as `memo(PlotCanvas)`
  and the seven panels named in step 1 build their `series` in a `useMemo`
  keyed on the engine result. Markers are keyed on *their* inputs, which for a
  "you are here" rule includes the control it tracks — see step 1's landing
  note for why that is the rule and not a compromise.
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

## Step 1 — `React.memo` on `Plot`, and stable series in the panels that drag ✅

**Landed 2026-09-05**, in all seven named panels. What it cost and what it
bought, counted as *canvases repainted per tick of a control*, read off the
dependency lists rather than from a profiler:

| panel | control moved | before | after |
| --- | --- | --- | --- |
| `camera` | exposure, gain, magnitude, sky | 2 | 0 |
| `camera` | pixel pitch | 2 | 1 |
| `coverslip` | slip thickness | 4 | 2 |
| `coverslip` | slip index | 4 | 1 |
| `mech` | back focus / travel | 5 | 1 |
| `volume` | worst-plane mark | 3 | 1 |
| `tolerance` | a row edit, worker still busy | 1 | 0 |
| `mtf`, `curvature` | any | 1, 2 | 1, 2 |

The last row is the honest one: on those two panels **every** control is an
input to the curves, so a tick that changes the curves must redraw them and
the memo buys nothing on a drag. It is still right to have — it stops an
unrelated re-render (a `pending` flag, a parent's state) repainting a canvas
whose data did not move — but this step's gain is concentrated in the panels
whose sliders move a *rule* rather than a *line*.

**Markers were the one place the step as written would have been wrong.** Taken
literally — "keyed on the engine result, NOT on the slider state" — a
slider-tracking rule would freeze mid-drag and point at a thickness the reader
had already left. So `series` is keyed on the result and `markers` on their own
inputs, which for those rules *includes* the control. The consequence is
deliberate: a plot carrying a tracking rule still repaints while its slider
moves, because the rule moved.

Two panels needed their arrays hoisted **above** a refusal return
(`volume.tsx`'s `AxialPlots` and `DepthPlot`), since a hook cannot run after a
conditional return. They are written against a readout that may still be
`null`, and return an empty array when it is — the refusal message below is
unchanged and still what renders.

**The table above was then confirmed in the browser**, against the running app
rather than against the dependency lists it was first read off. Method, worth
reusing for the later steps: wrap `CanvasRenderingContext2D.prototype.clearRect`
so each canvas counts its own repaints — every `Plot` draw begins with exactly
one full-canvas clear — then move one control by one step and read the counter.
Every row reproduced: `camera`'s exposure, gain, magnitude and sky each cost 0
and its pitch 1; `coverslip` 2 on thickness and 1 on index; `train` 1 on the
focuser; `volume` 1, on the axial plot alone.

`tolerance` needed a second discriminator, because its worker answers in about a
second and a reply landing inside the sample window is a *legitimate* repaint,
not a wasted one. Comparing `toDataURL()` across each edit separates them: every
repaint that occurred changed the pixels, and the edits with no reply in flight
cost 0. So the panel now has no wasted redraws at all, which is the stronger
claim the row was standing in for.

All seven panels render, and the console is clean of React errors — in
particular no "rendered more hooks than during the previous render", which is
the failure the `volume.tsx` hoisting could have introduced. That panel's
refusal path is exercised on every load, since the plots only appear once the
focus-stack workers reply.

Left as it was, deliberately: `plot.tsx`'s effect still keys on the whole
`props` object. Once `memo` gates the re-render there is nothing left for a
finer dependency list to catch, and splitting it is a change this step did not
ask for.


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

## Step 2 — transfer the picture buffers out of the workers ✅

**Landed 2026-09-06.** Fifteen of the thirty-two workers now post with a transfer
list; the other seventeen answer with numbers and have nothing to hand over.

**The step as written would have taken the smaller half.** `[result.rgba.buffer]`
at each call site is right only where the result is one flat object with one
picture in it, and most are not: `brightfield`, `fluorescence`, `volume`,
`section` and `stage` answer with a `{ ok: true, readout } | Refused` union where
the buffer exists on one arm only; `camera` has three buffers and the third is
optional; `phase` carries an array of frames with one image each. Each of those
needs a type guard before it can name a buffer. Worse, a list written from the
panel's point of view names what the panel *paints* — and `RenderResult` and
`ReflectorResult` also carry the `ColorImage` the picture was encoded from,
whose `xyz` is a `Float64Array` **six times larger than the RGBA beside it**.
That is the largest buffer in the app and the first draft of this step missed it.

So the list is built by a walk instead: `src/transfer.ts` collects every distinct
`ArrayBuffer` reachable from the message, and `postTransferring(ctx, message)`
derives it from the message being sent in one expression, so the two cannot drift
apart. Distinctness matters — `postMessage` throws `DataCloneError` on a list
naming one buffer twice.

**What was handed over, measured in the running app** — bytes per reply, which is
the arithmetic the saving is made of. Each of these was structured-cloned on the
way out of the worker and is not any more; the second copy the step's *Why*
counts, the panel's own on arrival, is untouched here and is now step 9:

| panel | worker | what moves | per reply |
| --- | --- | --- | --- |
| star & field | `render.worker` | rgba + the `ColorImage` it was encoded from | 256 kB + 1 536 kB |
| star & field | `render.field.worker` | rgba, one per refinement level | 256 kB |
| the reflectors | `reflector.worker` | rgba + `ColorImage` | 256 kB + 1 536 kB |
| a source with a size | `emitter.worker` | object + image intensity, f64 | 2 × 512 kB |
| fluorescence beads | `fluorescence.worker` | intensity, f64 | 512 kB |
| the sensor | `camera.worker` | native + sensor + observed | 256 + 33 + 33 kB |
| visual mode | `visual.worker` | rgba | 256 kB |
| long exposure | `seeing.worker` | mean + draw + clean | 3 × 64 kB |
| the phase null | `phase.worker` | one rgba per defocus frame | 2 × 64 kB |
| tolerances | `tolerance.worker` | nominal + perturbed | 2 × 64 kB |
| haze & the focus stack | `volume.worker` | intensity, f64 | 128 kB |
| a disc, not a point | `sky.worker` | rgba, one per refinement level | 64 kB |
| brightfield | `brightfield.worker` | rgba | 64 kB |
| the section, in colour | `section.worker` | spectral + tinted | 2 × 15 kB |
| the stage | `stage.worker` | rgba, one per tile | 9 kB × 36 per viewport |

The two refining renders and the stage are where this compounds: a star field
posts one 256 kB frame per level, and a stage viewport 36 tiles.

**The check the step proposed cannot see this, and neither can `npm test`.**
"Every panel still paints" is true whether the buffers moved or were copied — a
transfer list the browser ignores costs nothing and errors nowhere. And
`packages/app/test` constructs no `Worker` at all, so vitest never reaches the
seam. The only proof is worker-side: a transferred `ArrayBuffer` is **detached**,
so its `byteLength` is 0 immediately after the post. Instrumented to log
`before -> after` and driven in a headless Chrome over the debugging protocol,
every one of 120 posts across all fifteen panels read `262144 -> 0`, `65536 -> 0`,
`9216 -> 0` and so on: **no post where a buffer survived the call**. The
instrumentation was then removed.

Two things about that drive are worth keeping, since the later steps will want
it. Worker targets advertise a `webSocketDebuggerUrl` that accepts a socket and
then answers nothing — the direct route is a dead end, and auto-attach on the
*page* session is the one that works. And auto-attach only reports targets
created **after** it is armed, so each route needs a real document reload; a
hash-only navigate keeps the document, and the panel that was up carries on
answering into the next route's window with its posts counted against the wrong
panel. Blank the page between routes.

What survives in the repo is `packages/app/test/transfer.test.ts`. It pins the
list against every shape above, and — the part that matters most — it pins that
the list reaches `postMessage`, with a stub. `transfer?: Transferable[]` is
*optional* in each worker's narrowed type, so dropping the second argument
compiles, passes every other expectation and paints every panel. That is this
step being silently undone, and it is the one failure a test runner can catch.

**The stage's cached repaint was exercised, not just reasoned about.** It is the
one consumer that re-reads a worker's buffer more than once — `stage.tsx`'s
`paint()` copies every cached tile on every pan — so it is where a detached
buffer would show. A drag across the viewport reported *"0 tiles — the cache
served this pan whole"*: every pixel came from tiles transferred earlier, the
picture changed, and nothing threw.

**Not measured, deliberately:** the step asked for `elapsedMs` before and after
on the star panel. That number prices the worker's own tracing and the transfer
happens after `renderStar` has returned, so it cannot move for a reason this step
caused — reading it would be a guard against breaking the physics, not a measure
of the saving. The saving is on the main thread, and the honest form of it is the
byte arithmetic above.

**One gap is written down rather than closed:** the walk uses `Object.values`, so
a buffer held inside a `Map` or a `Set` would be missed even though both clone.
No result posts one. It is recorded in `transfer.ts` because the symptom would be
a silent copy rather than a crash.

The panel-side `new Uint8ClampedArray(result.rgba)` copy stays, as the step said
— but the step's reason for keeping it argues the other way: *"after a transfer
the buffer is plain"* is precisely why the copy is no longer needed. It is now
step 9, because its verification surface is every canvas rather than every
worker.


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

## Step 9 — drop the panel-side copy of a transferred buffer

**Why.** Opened by step 2, whose own instruction to keep the copy carries the
argument against it. Every panel that paints does
`context.putImageData(new ImageData(new Uint8ClampedArray(result.rgba), size, size), …)`.
The copy exists because `ImageData` refuses a view over a `SharedArrayBuffer` —
but a buffer that arrived by transfer is a plain `ArrayBuffer`, so
`new ImageData(result.rgba, size, size)` is already legal for every one of them.
That is the second of the two copies step 2's *Why* counted, and step 2 removed
only the first. It is worst on `panels/stage.tsx`, which copies **every cached
tile on every pan** rather than once per reply.

**Change.** In each panel that paints a worker result, drop the
`new Uint8ClampedArray(...)` and pass `result.rgba` to `ImageData` directly. ONE
PANEL PER COMMIT. Where the array is built on the main thread instead — the
`toGrey(...)` calls in `panels/emitter.tsx` and `panels/fluorescence.tsx` — the
copy is already redundant for a different reason and goes the same way.

**Check.** Screenshot the panel before and after at the same route; they must
match to the pixel. Then the case the copy was hiding: paint the same result
twice (`stage.tsx`'s pan, `telescope.tsx`'s hotspot overlay) and confirm the
second paint is identical to the first — `putImageData` reads the buffer, it does
not consume it, but that is the assumption being cashed in.

**Must not change.** A panel that MUTATES the pixels it received before painting
them, if one exists — search for a write into `result.rgba` — must keep its copy,
since the buffer is now the only one there is.

## Out of scope, and why

- **Keeping a panel's workers alive across routes.** APP.md item 1 chose the
  re-trace on return as the honest trade; the elapsed time is on screen.
- **A chart library.** `plot.tsx`'s header: a smoothed curve through measured
  points is a drawing of a claim rather than the claim.
- **Any change to what a panel computes or shows.** That is a panel step in
  APP.md, with its own section.
