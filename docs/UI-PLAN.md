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
  `group` in the registry), a three-way theme control (step 8), and sets
  `document.title` per route.
- **The section drawing (2026-09-06).** `src/layout.ts` + `src/drawing.tsx`:
  the bench editor draws the prescription it edits — sag profiles, glass, the
  stop, traced rays to the image plane — above its table, with hover pairing
  the two. APP.md § E3 says what it draws and what it states about itself. Its
  canvas already follows the container's width (a `ResizeObserver` on the
  `<figure>`, clamped to 320–760), which is step 6's shape for `Plot`. The
  builder (`#/builder`) draws the same section of the lens it solved, fanned at
  the frame's corner, with a hover readout in place of a table (APP.md § D8,
  *It draws the lens it solved*).

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

## Step 3 — an error boundary around the panel ✅

**Landed 2026-09-06.** `packages/app/src/panels/boundary.tsx`, wrapped around
the `Suspense` in `App.tsx` and keyed on the route.

**The step's own check cannot fail.** "Confirm the nav survives" is satisfied by
a boundary that catches and latches forever — the nav is *there*, and every
link in it does nothing, because the boundary goes on rendering the old message
for whatever route resolves next. That is a worse failure than the blank page it
replaces: a blank page reads as a crash, a dead nav reads as the app. So the
check that discriminates is the *second* click: throw, then click a **different**
panel and confirm that panel actually paints.

Which it does, because the boundary sits inside the keyed wrapper and carries the
same key itself. `routeKey` is now one named expression used twice, since the
fade wrapper and the boundary have to reset on exactly the same event and two
copies of a template literal is how they would stop doing so.

**What it catches, which is narrower than "a panel that throws".** React's
boundaries see render and the lifecycle beneath them. That is the panel's own
render, and a `lazy()` chunk that rejects. It does **not** see a throw inside a
worker's `onmessage`, inside a `.then`, or inside an event handler — and the
physics of every panel here runs in a worker whose reply lands in a callback, so
most of the code in `packages/app` is outside this net. Nothing regressed there
(an unhandled rejection was never blanking the page), but nothing was gained
either. A throw in `App`'s own render — hash resolution, the registry, the nav
— is above the boundary and still takes the page.

**Measured in a headless Chrome**, because `npm test` renders no React at all.
A temporary `throw` behind a `?boom=1` query in `spot.tsx` for the render case,
and CDP `Network.setBlockedURLs` for the download case. Read off the live DOM —
nav links present, and what the panel slot holds.

Say exactly what the second half measured, because step 4 changes it: this ran
against the **dev server**, where a panel is an individually served ES module
(`/src/panels/telecentric.tsx`), so what was blocked is that URL and not a built
chunk. A production `dist/` chunk fails through the same path — a rejected
dynamic import, re-thrown by `Suspense` — with a different URL in the message.
That is the mechanism, not a second observation.

| what was done | nav links | panel slot |
| --- | --- | --- |
| `#/spot?boom=1`, panel throws in render | 31 | the boundary's message |
| clicked nav → `#/rayfan` (no reload) | 31 | the ray fan, 7 controls, 2 canvases |
| clicked nav → `#/spot`, no query | 31 | the spot diagram, 8 controls, 21 canvases |
| `#/telecentric`, its module blocked | 31 | *"Failed to fetch dynamically imported module"* |
| unblocked, clicked away and back | 31 | **still the error** |
| unblocked, full reload | 31 | the telecentric stop, 10 controls, 1 canvas |

**The counterfactual was run, not assumed.** With the `<PanelBoundary>` wrapper
deleted from `App.tsx` and nothing else changed, the same `?boom=1` route reports
**0 nav links** and the document's static `<title>` — React 18 unmounted the
whole tree, which is the failure this step exists to remove. A check that only
ever asserts the good state cannot tell a working boundary from an app that
never threw.

**One finding the step did not anticipate, and it is now in the UI text.** React
18's `lazy` caches the *rejection*: remounting the component re-throws the same
error rather than re-attempting the import. Rows five and six above are that —
unblocking the URL and clicking back still shows the error, and only a document
reload recovers. So the boundary's second line tells the reader to reload if the
panel could not be downloaded, which is a fact about React rather than a hedge.

**Two departures from the step as written.** The colour is a `.panel-error` class
in `styles.css`, not an inline style — step 5 is about deleting inline style
objects and this step should not add one. And the state is a boxed
`{ cause } | null` rather than the thrown value: `throw` takes `null`, and a
panel that threw it would render its children, throw again, and loop.

**What the repo keeps.** `packages/app/test/boundary.test.ts` pins the wiring by
reading `App.tsx`, for the same reason `transfer.test.ts` does: deleting the
wrapper compiles, typechecks, passes every other test in that directory, and
paints all thirty-one panels — the only symptom is a white page on the day
something throws. It pins that the boundary opens before the `Suspense`, and that
both it and the fade wrapper are keyed on `routeKey`. It also pins `errorMessage`
against the values `throw` can carry, since a boundary that prints `undefined`
where the explanation goes is a second failure on top of the first. It cannot
render anything, and does not pretend to.

**Left as it is, on purpose:** `shell-blurb` sits above the boundary, so a panel
that threw still has its one-line description over the error. That reads as the
header naming where you are rather than as a stale claim, and moving it inside
would put the route's name inside the thing that failed.

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

## Step 4 — share the engine between the worker chunks ✅ measured: no-op, reverted

**Tried 2026-09-06, measured, and reverted.** The premise was wrong, so the
step buys nothing; what follows is the number and the mechanism, so it is not
tried again.

**Why it was proposed.** `dist/` is 2.88 MB and the thirty-two workers are
1.98 MB of it — 69%, because each one bundles its own copy of `packages/core`.
The hope was that Vite would emit one shared engine chunk between ES-format
workers, since the `iife` default cannot import and so cannot share.

**What was changed.** `worker: { format: "es" }` in
`packages/app/vite.config.ts`, and nothing else. Every one of the thirty-two
factories in `src/workers.ts` already passes `{ type: "module" }` (checked
before the flip — a classic worker handed an ES module fails at parse time, and
that surfaces as a panel stuck on "tracing…", not as a build error).

**What it measured.** Vite 7.3.6, clean `dist/` both times:

| | files | total | 32 worker bundles |
| --- | --- | --- | --- |
| before | 98 | 2 876 049 B | 1 984 566 B |
| after | 98 | 2 875 493 B | 1 984 005 B |

556 bytes, 0.02%. Not a shared chunk — the IIFE wrapper. The workers give up
561 and the total only 556 because the non-worker chunks grew a few bytes as
their hashes changed. 561 across 32 workers is 17.5 bytes each, which is
`(function(){` plus `})();`, and the emitted `stage.worker-*.js` now opens on
`function Kt(t){` where before it opened on the wrapper.

**Why it cannot work, and it is not CDN hashing.** The original text guessed
that a null result would mean "the workers are already deduplicated by content
hashing at the CDN level". That explanation is impossible: the measurement is
`ls -l` on local bytes, and no CDN behaviour reaches it. The real reason is
that Vite compiles each `new Worker(new URL(...))` entry in its **own Rollup
pass**. `format: "es"` lifts the syntax restriction on splitting *within* one
worker, but there is no chunk graph spanning the thirty-two workers for a
shared engine copy to live in. The check is direct: after the flip the worker
bundles contain **zero** `import` statements — each is still closed over its
own engine.

**What would actually be needed, and why it is not done here.** Only a
restructure that gives the workers a common build: hand-declared
`build.rollupOptions.input` entries, or workers that pull the engine from the
main graph. Both destroy the `new Worker(new URL("./x.worker.ts",
import.meta.url), { type: "module" })` literal convention that `src/workers.ts`
exists to protect — its header says why — and both are a different step from
this one. Recorded under *Out of scope* below rather than left as a pointer;
`docs/OPEN-PROBLEMS.md` is not its home, that register being scoped to what the
**engine** has left open and keyed by `§` labels this has none of.

**The runtime check was not needed** and was not run: the config is back to
what shipped, so the bytes served are the ones already in use. The note in
`vite.config.ts` carries the warning forward.

## Step 5 — shared readout classes instead of 185 inline `fontFamily` styles ✅

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

### 5a — the classes, and `ui.tsx` ✅ 2026-09-06

The three classes are in `styles.css` with the eligibility rule written above
them, and `ui.tsx` is converted. What the doing of it settled, for the panel
commits that follow:

**Read the eligibility rule literally, because it is narrower than it looks.**
A site takes a class when EVERY property the class sets is already present with
the class's value; extras stay inline beside the `className`. You cannot keep
the ABSENCE of a property inline — so a bare `{ fontFamily, fontSize: 12 }` is
**not** a `.readout`, because `.readout` also says `line-height: 1.6` and the
bare site inherits the base 1.5. Applying it would move the leading, and this
step is required not to move a pixel.

**The census, so no panel commit has to re-derive it.** 182 inline `fontFamily`
sites in 91 distinct shapes. Under the rule above the three classes reach:

| class | eligible sites | the shape |
| --- | --- | --- |
| `.readout` | ~12 | the ones that already say `lineHeight: 1.6` |
| `.readout-note` | ~23 | mono/11/`--ink-4`, mostly `width: 420, marginTop: 4` |
| `.prose` | 43 | `<p style={{ maxWidth: 640, color: "var(--ink-2)" }}>` |

`.prose` sets no font, so it is not among the 182 at all and was found
separately — it is nonetheless the largest single group in the step.

**The gap this leaves, named rather than papered over.** The biggest family is
the bare `{ fontFamily: "var(--mono)", fontSize: 12 }` and its variants, and
**no class in this step covers it.** That is deliberate: the sites differ only
in leading (inherited 1.5 here, 1.6/1.7/1.8 elsewhere), and inventing a 1.5
class to fit the majority would be choosing their leading by accident instead of
on purpose. Leave them inline. Deciding what those should be is a step of its
own, not a thing a panel commit gets to improvise.

### 5b — the inline styles the stylesheet already says ✓ 2026-09-06

`ui.tsx`'s share landed with 5a; the 14 panel files followed in one commit — 75
properties, none of them replaced by anything. Found while doing 5a, and a
different mechanism from the rest of step 5: some
inline objects restate, property for property, what a base element rule in
`styles.css` already sets. Those are **deleted**, not classed — the cascade is
already the shared definition, and adding a `className` beside it would be a
second name for the same thing.

Confirmed by reading every site rather than by pattern-replacing, because the
claim is per-site. `M:/claud_projects/temp/step5-verify/census.py` prints the
style object belonging to each `<button>`, `<input>`, `<select>`, `<table>` and
`<legend>` in the app, and that is where these counts come from: four of the
table sites and two of the button sites spread their attributes over several
lines, so a line-wise grep undercounts them.

- `table` — base is `border-collapse: collapse; font-family: var(--mono);
  font-size: 12px`. 22 sites. 19 say exactly that and lose all three
  properties, keeping whatever else they carry (`marginTop`, `marginBottom`,
  `lineHeight`) inline. `panels/phase.tsx:249` and `panels/spot.tsx:199` are
  `fontSize: 11` and **keep the size**, losing the other two.
  `panels/tolerance.tsx:418` never set a family and loses only `borderCollapse`.
- `button` — base is mono/12px. 12 sites carry a font, four of them through
  `editor.tsx`'s `...mono` spread. Six lose both properties; six lose only the
  family, because their size is deliberately 11 or 13.
- `input[type="text"]` and `select` — base is mono/12px. `ui.tsx`'s
  `NumberField` field and `editor.tsx`'s two `<select>`s lose both.
- `legend` — base is mono/11px/`--ink-4`, which is the whole of `Fieldset`'s
  inline object; the `style` attribute goes entirely.

**What must not be deleted, though it does match the base rule.** A button's
inline `background`, `border` and `cursor` frequently restate `button` word for
word — and they are load-bearing exactly because they do. They are what stops
`button:hover:not(:disabled)` (which changes background and border colour) and
`button:disabled` (which sets `cursor: default`) from ever applying to that
button. Deleting them would hand those buttons a hover they have never had and
change the cursor on a disabled one. So the rule for 5b is not "delete what the
base rule already says" but the narrower "delete what the base rule already says
**and no state rule ever overrides**" — which, in this stylesheet, is the font
properties and `border-collapse`, and nothing else.

**Two things the script could not do, done by hand.** `editor.tsx`'s second
`<select>` carries `style={mono}` — a reference, not a `{{ }}` literal, so the
parser skips it; `select` is mono/12px in the stylesheet and `mono` is exactly
those two, so the attribute goes. The `<label>` wrapping it keeps its copy,
because the `label` rule sets only a colour. And four tags in `camera.tsx` and
`budget.tsx` were wrapped across lines only because their style object used to
be long; with three properties gone they read better as one line again.

**Check for 5a and 5b — and why it is not a screenshot.** The plan's check as
written cannot be run: every panel prints its own elapsed trace time, so two
runs of the *same* tree differ in the pixels. The substitute tried first was
worse. It walked the routes in a headless Chrome and dumped `getComputedStyle`
for every element, on the theory that resolved values are deterministic where
pixels are not; it never completed a single before/after pair. The reason is
worth writing down, because it would sink any future attempt at the same shape:
producing the "before" means stashing `ui.tsx`, which every one of the 31 panels
imports, so the dev server's transform cache is cold for all of them. One panel
alone takes 6 s to transform, its import graph much longer, and the route sits
on its `loading…` fallback until the driver gives up. The check was measuring
the harness, not the change.

What these edits claim is static anyway, and one file decides it. An inline
style beats a stylesheet rule, so deleting an inline property that equals the
base rule is a no-op *unless* a more specific rule was being blocked by it. So
the only question is: does any other selector in `styles.css` match a touched
element and set one of the removed properties to a different value? It is the
app's only stylesheet, imported once in `main.tsx`, so reading it whole answers
that for every route at once — which the five-route sample never did. The answer
is no:

- a `button` is matched by `button` (mono/12px — the removed values), by
  `:hover` / `:disabled` / `:focus-visible` (background, cursor, outline, no
  font), and by nothing else. `.theme-toggle` is the shell's own button and
  carries its own class.
- an `input[type="number"]` is matched by the mono/12px control rule and by
  `:focus-visible`; `input[type="range"]` does not match it.
- a `legend` is matched by `legend` alone — there is no `fieldset legend`.
- a `table` is matched by `table` alone. `.scroll-x` is the wrapper div and sets
  only `overflow-x` / `max-width`; `th` sets weight and colour, not size.
- `Guard`'s div takes `.readout`, specificity 0,1,0, and no other rule in the
  file sets a font on it.

Neither media query sets a font property — they move `.shell` padding and switch
off transitions — so nothing was hiding at a narrow viewport either. Note the
one shape this argument does *not* license: it covers deleting a property that
the cascade already sets, and adding `.readout` to a site that already had all
three of its properties inline. It says nothing about a site missing one of
them, which is why the eligibility rule above is read literally.
`npm run typecheck` passes, and `npm test` with the caveat 5c records below —
this suite has four load-dependent `packages/core` rungs, and an unqualified
tick here would be claiming something a full run on this machine does not show.

### 5c — the 86 panel sites, in one sweep ✅ 2026-09-06

**The counts, measured rather than estimated.** 86 sites across 24 panel files:
18 `.readout`, 24 `.readout-note`, 44 `.prose`. 5a's census ran low on all
three (~12 / ~23 / 43), and the `.prose` one is the interesting miss: 43 was a
count of `<p>`, and `panels/wavefront.tsx:219` is a `<ul>` carrying the same
object. 43 + 1 reconciles it, and reading the shape rather than the tag is what
found it. The `.readout` class now appears 19 times, the nineteenth being
`ui.tsx`'s `Guard`, which landed with 5a.

**One commit, not fourteen, and why that is not a corner cut.** The plan says
ONE PANEL PER COMMIT. This landed as a single sweep on instruction, and the
constraint that rule exists to protect — CLAUDE.md's "every commit typechecks
and passes `npm test` on its own" — is met by the sweep as much as by fourteen
commits, because the edit is mechanical and the check below is per-site rather
than per-panel. The per-panel commit buys a bisect point; what it was really
buying here was a place to eyeball a screenshot, and 5b already established
that screenshot cannot be taken.

**What stands in for the check the plan asks for.** 5b's landing note explains
why the before/after screenshot is unrunnable — every panel prints its own
elapsed trace time, so two runs of the *same* tree differ in the pixels, and
producing a "before" means stashing `ui.tsx`, which cold-caches all 31 panel
transforms. So the substitute is a proof per site rather than a sample of
routes, and it is three assertions inside the transform plus one re-run:

1. **No spread in an eligible object.** A `...mono` could re-supply exactly the
   properties being deleted, and then the deletion is not a no-op. `editor.tsx`
   is known from 5b to spread that way. The transform hard-fails on any `...`
   entry in an object it is about to edit; none fired.
2. **The removed set is exactly the class's set, at the class's values** —
   asserted property by property at every one of the 86 sites, which is the
   eligibility rule of 5a restated as a runtime check rather than trusted to
   the matcher that selected the site.
3. **No `style={{}}` survives.** 51 of the 86 lose every property they had. An
   empty style object typechecks and renders perfectly, so neither `tsc` nor
   the panel tests would have said a word about a left-behind one.

Then the census that selected the sites is re-run over the result: it must
report **zero** eligible sites remaining, which is both the completeness check
(nothing was skipped) and the idempotency one (nothing was half-converted). It
does. `npm run typecheck` passes.

`npm test` needs a sentence rather than a tick. The full run reported four
failures, all four in `packages/core`, which imports nothing from
`packages/app` and cannot see a `className`. All four are the load-dependent
kind this repo already documents: § 6bl.2, § 6bk.1 and § 6bm.1 hit the 180 s
budget `vitest.config.ts` sets, and `mtf-share`'s § 1.8.15 read its wall-time
split at 0.593 against a 0.55 bound. Re-run per file they pass — 60 rungs and 11.
The full run was also launched with the *coordinator* process at below-normal
priority, which `vitest.setup.ts` names as the way to manufacture precisely that
`onTaskUpdate` timeout; that is a fact about how the run was started, not about
the tree. The re-runs follow `vitest.config.ts`'s own instruction: repeat a
time-based failure at `TELEMICROSCOPE_TEST_PRIORITY=normal` before believing it.

**And the cascade question, which the assertions do not answer.** Those three
checks say the deleted properties equal the class's. What they cannot say is
whether the class then *wins* — an inline style beats everything, a class does
not. 5b answered this for its own five element types by reading the whole
stylesheet; the tags that took a class here are `p` (63), `figcaption` (13),
`div` (8), `span` and `ul`, and the answer is the same and shorter. The only
selectors in `styles.css` that match any of them are `p { margin }` and
`figcaption { color: var(--ink-2) }`, both specificity 0,0,1 and both beaten by
a class; `p`'s margin is not a property any of the three classes sets, and
`figcaption`'s colour survives because `.readout` sets no colour — which is
also why the one `.readout` site that wants `--ink-3` still says so inline.
Every other class rule in the file belongs to the shell, the nav or the error
boundary and is applied by name to elements a panel does not own, and neither
media query touches a font, a colour or a width. No site has a second class,
and none had a `className` before this step.

**The one thing that check is blind to, done by hand.** The census parses
`style={{ … }}` literals only, so its "zero remaining" is a claim about
literals and would say nothing about a `style={head}` — a reference to a const,
which is exactly how 5b's `editor.tsx` case escaped a script and had to be done
by eye. There are eight such consts: `cell` and `head` in `panels/bench.tsx` and
`panels/editor.tsx`, `CELL` in `panels/design.tsx` and `panels/optimize.tsx`, and
`mono` and the `note` that spreads it in `panels/editor.tsx`. Between them they
are reached at 99 tags, and five further inline objects are built by spreading
`mono` or `note`. Every one was read, and **none of them is eligible**:

- the six table-cell consts (`cell`, `head`, `CELL`) carry padding, alignment
  and a border rule and, since 5b took the fonts out of them, no font at all —
  `head` does say `color: var(--ink-2)`, but without a `maxWidth` it is not a
  `.prose`;
- `mono` is `{ fontFamily: "var(--mono)", fontSize: 12 }` — the bare shape with
  no leading, which is precisely the family no class in this step covers;
- `note` is `{ ...mono, color: "var(--ink-4)", maxWidth: 640, margin }`, which
  misses `.readout-note` on size (12, not 11) and `.prose` on colour;
- the five spreads add a `--bad`/`--warn` border colour, a `fontSize: 13` or a
  `maxWidth` to those two, and none of them lands on a class either.

So the 86 is the whole of it, and the consts are left alone on their own merit:
`editor.tsx`'s `head`, used at seventeen tags, already says a shape once rather
than writing it out per site, which is the thing this step is for.

**The one site where the rule and the intuition disagree.** `panels/camera.tsx`'s
refusal box — the bordered red square drawn where the sensor picture would be —
is mono/12/1.6 with five other properties, so under the literal rule it is a
`.readout` and it took the class. It does not read like one: it is a failure
notice, not a readout. It was converted anyway, because 5a's whole landing note
is an instruction to apply the rule literally, the computed style is identical
either way, and curating these by meaning is a different step with a different
argument behind it. Six tags that had been wrapped across three lines only
because their style object was long were re-joined into one line, the same tidy
5b did.

**What stayed inline, so the next reader does not go looking.** Every property
the class does not set: `maxWidth` / `width` / `marginTop` / `margin` on 31 of
the sites, `lineHeight: 1.7` on one `.readout-note` and `1.5` on two more (both
overriding what they inherit, not what the class sets), `fontSize: 14` on one
`.prose`, `color: var(--ink-3)` on one `.readout`, and the refusal box's six.

**What step 5 does not reach, now written as its own step.** 110 inline mono
sites remain, in 29 files, and step 10 below is what to do about them. 5a named
this family and deferred it; closing step 5 is the moment that stops being a
note inside a landed sub-step and becomes a step of its own.

## Step 6 — canvases that fit the viewport ✅ 2026-09-06

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

**What landed.** One class, `.raster` in `styles.css` (`max-width: 100%;
height: auto; aspect-ratio: 1`), on the 17 picture canvases across 14 panels
plus `panels/sky.tsx`'s placeholder box; each site keeps its own `width` and
drops the `height` it was repeating. `Plot` reads its own CSS width back through
a `ResizeObserver` and draws at that width, clamped to `[280, requested]`.
`panels/telescope.tsx`'s field canvas does the same for the hotspot scale, so
the overlay follows the canvas instead of a constant. `panels/tolerance.tsx`'s
drift table, the one table wider than 600 px, went inside a `.scroll-x`.

**Three floors the plan did not predict, all found by measuring.** Each is a
place where the column *could not* shrink, and each is a CSS intrinsic-sizing
rule rather than a typo:

1. **A fixed-width text note beside a plot** — `<p style={{ width: 420 }}>`,
   36 sites in seven panels (`brightfield`, `phase`, `fluorescence`,
   `coverslip`, `eyepiece`, `volume`, `mech`). A block's `width` is its
   min-content, so the note held its flex item at 420 and the plot beside it
   never got the chance to shrink. Every one is now `maxWidth: 420`, which
   renders identically in a wide column (the notes are longer than 420 px of
   text, so the box was 420 either way) and lets a narrow one wrap.
2. **A `div` wearing `.raster`** — `sky.tsx`'s pre-first-frame placeholder and
   `telescope.tsx`'s hotspot wrapper. A percentage `max-width` shrinks a
   *replaced* element's minimum size but not a block's, so both take
   `width: min(Npx, 100%)` instead, which is what the plan's *Change* line
   said and the reason it said it.
3. **`Plot`'s own canvas, one nesting deeper.** `width: 420; max-width: 100%`
   shrank in every panel where the figure is a direct flex item, and did not
   shrink in `volume.tsx`, whose rows sit one flex box further down — there
   Chrome took the fixed width as the floor and the page scrolled. The canvas
   is now `width: 100%; max-width: 420px`: a replaced element's percentage
   *width* contributes nothing to a minimum, and the absolute `max-width`
   keeps the wide-column size exactly what it was. The legend entries under it
   were `white-space: nowrap` spans, which is a second floor of the same kind
   (a long series label is a fixed width); they are `inline-block` now, so an
   entry still moves to the next line whole but wraps inside itself when it is
   wider than the column.

**The check, run three times, against a production build.** Driver at
`M:\claud_projects\temp\step6-verify\drive.mjs` (a headless Chrome of its own
against `vite preview` of the tree, `preview.mjs` beside it; `probe.mjs` is the
one-route DOM probe that found each floor). Every one of the 31 routes at
600 px and again at 400 px, reading `scrollWidth > clientWidth` on the document
and listing any element past the viewport that is not inside its own scroller;
then `#/telescope` at 1280, 600 and 400 px, mapping each hotspot's centre into
the canvas bitmap and reading the brightest pixel in a 7×7 window there.

- **600 px: 31 of 31 routes, no horizontal overflow.** That is the plan's
  number, and the first run had one failure at it — `tolerance`'s table — which
  is the `.scroll-x` above.
- **400 px: every canvas fits.** 25 routes clean. The five that still overflow
  are not canvases: four tables with no `.scroll-x` (`reflector`, `editor`,
  `telecentric`, `design`) and `optimize`'s fixed-width result rows. They are
  below the plan's width and outside this step's subject, and are left as the
  next thing to do if 400 px ever becomes a target.
- **Hotspots: 25 of 25 on a star at all three widths**, peak 255 under every
  hotspot against a frame median of 0 and a control window 40 bitmap px to the
  side reading ≤ 33. At 400 px the field canvas is 357 px, not 420, so the
  scaled case is the one being exercised, not the constant.

The first sweep ran against a stale build the previous session had left
serving on 5187 (a `preview` server reads its `dist` from disk, so a rebuild is
picked up without a restart — but only after the rebuild). Trust a sweep only
after the served `index-*.js` hash matches the one `vite build` just printed.

`npm test`, the same sentence as 5c's. The full run: 3796 of 3805 pass, nine
fail, all nine in `packages/core`, which imports nothing from `packages/app`
and renders no canvas. Eight are the 180 s budget (§ 6bo.2, § 6l.4, § 6b.5.4,
§ 6bm.1, § 6bk.1 twice, § 6bl.1, § 6bl.2) and one is `mtf-share`'s § 1.8.15
wall-time split at 0.609 against its 0.55 bound — a ratio of two durations,
which load moves and a `className` cannot. Re-run per `vitest.config.ts`'s own
instruction, the seven files alone at `TELEMICROSCOPE_TEST_PRIORITY=normal`:
165 of 165 pass in 215 s. That run still printed five `Timeout calling
"onTaskUpdate"` errors, the worker-side stall `vitest.setup.ts` describes, with
no test attached to any of them.

**What this step does not change.** `imageRendering: pixelated` and every
site's own `width` stay; no pixel moves in a column wider than the picture.
Plot heights are still fixed (280), so a shrunk plot is shorter in aspect, not
scaled — the axes are redrawn at the real width rather than squeezed.

## Step 7 — prefetch the neighbouring routes ✅ 2026-09-06

**Why.** A lazy route costs one network round trip on first visit. The nav is
a reading order, so the next entry is the likely next click.

**Change.** In `App.tsx`, on `mouseenter` / `focus` of a nav link call the
registry entry's loader. To make the loader callable, keep the `lazy(...)`
component AND store the import thunk on the entry (`load: () => import("./x")`),
and build `Component` from `load` so there is one thunk per panel, not two.

**Check.** Network tab: hovering a nav entry fetches its chunk; clicking it
then paints without a "loading…" flash.

**What landed.** `panels/registry.ts`: every entry carries `load` beside
`Component`, both from one `lazyPanel(...)` call around the same import thunk,
so the hover and the click share one in-flight promise; the 31 entries read
`...lazyPanel(() => import("./x").then(…))` and a search for `BenchPanel` still
lands there. `App.tsx`: each nav link calls `warm(entry)` on `mouseenter` and
`focus` — `load()` with the rejection swallowed, because a chunk that will not
download is met again by the click, where the error boundary prints it with
its URL. `test/prefetch.test.ts` pins six things: one import per entry; the
fallback while the chunk is in flight; a loaded panel rendering with **no**
fallback under `renderToString`; a memoised rejection; a loader on every
registry entry; the two handlers in `App.tsx`.

**What the plan did not predict: fetching early is half of it.** React's
`lazy` initialises from its thunk on its own first render, not from a promise
the entry already holds, so the first mount after a hover hands it a settled
promise it has never seen, and `Suspense` commits `panel-loading` for the one
task it takes to notice. Measured, with that path disabled in a one-line
variant build: hover fetched the chunk, the module was evaluated before the
click, and the click still put the loading node into the DOM for **36 ms** —
two frames. So `lazyPanel` keeps the resolved component beside the promise and
renders it directly when a mount finds it there, decided **once per mount** in
a `useState` initialiser: a panel that mounted through `lazy` keeps rendering
through `lazy`, since switching element types on a later re-render (a theme
change) would remount it and terminate its workers mid-trace. A *revisit* was
never the problem — `lazy` remembers a resolved module on the component
itself, and the pre-step tree shows no loading node on a warm revisit either.

**The check, run against three production builds in a headless Chrome of its
own.** Driver at `M:\claud_projects\temp\step7-verify\drive.mjs`
(`preview.mjs` and `build-both.ps1` beside it; `report.json`, `lazyonly.json`
and `damage.json` are the three runs). A fresh profile per run, so the cache is
cold; a `MutationObserver` installed before each navigation records every
`panel-loading` node entering or leaving the DOM, which is stricter than a
screenshot — a fallback React committed counts even if the browser never
painted it. The star field is left to finish refining before the first hover.
An earlier run hovered while it was still tracing, and the click showed the
fallback for 2 s with the chunk already downloaded: Chrome runs input ahead of
module evaluation, so the click beat the evaluation and mounted through
`lazy`. That is an ordering, not a bug — and it is why a hover during the
reader's idle moment is the one worth buying.

| build | hover | focus | click after hover | cold, no hover | warm revisit |
| --- | --- | --- | --- | --- | --- |
| this tree | fetches, 9 ms; evaluated at 77 ms | fetches, 1 ms | no loading node | 430 ms | none |
| `lazy` only, direct path off | fetches | fetches | **36 ms** of loading node | 560 ms | none |
| before the step | nothing; the click fetches | nothing | 471 ms | 48 ms | none |

The cold-route numbers are the download: the same 9 KB chunk from the same
preview server took 391 ms in one run and 6 ms in another, and the loading node
left the DOM within 5 ms of the module being evaluated each time. That spread
is this machine's disk, and it is the plan's point restated — the only cost a
lazy route has is the fetch, and the hover moves it off the click.

`npm run typecheck` passes. `npm test`, the same sentence as 5c's and 6's,
with a cause this time. The full run: 3791 of 3811 pass, twenty fail, all in
eleven files, and `prefetch.test.ts` passes in 665 ms. Nineteen are the 180 s
budget (§ 6ai.4, § 6ai.6, § 6b.5.4, § 6bk.1 twice, § 6bl.1, § 6bl.2, § 6bl.5,
§ 6bm.1, § 6bo.2, § 6bp.1, § 6bp.3 twice, § 6bq.1, § 6bq.2, § 6bq.4, § 6bq.5,
§ 6cc.0, § 6cc.5) and one is `telecentric.test.ts`'s "costs a frame rather than
a job" at 1 911 ms against its 1 500 ms wall-clock bound. The cause: that run
was launched through `Start-Process` at `BelowNormal`, which nices vitest's
*coordinator* along with the workers — exactly what `vitest.setup.ts` argues
against, and it took 54 minutes instead of the usual handful. A rerun of the
eleven files the same way failed seven of them. The seven files run plainly,
`npx vitest run <files>`: 6 of 7 pass, every timeout gone, and the one left is
the same wall-clock bound at 2 219 ms beside six physics files; that file alone,
20 of 20 in 50 s, the bound met at 318 ms. Nothing here touched `packages/core`.

**What this step does not do.** No idle-time prefetch of the entry after the
current one: hover is a stronger signal, and a chunk fetched for a link the
reader never reaches is bandwidth spent on a guess. A touch screen gets no
prefetch — there is no hover, and a tap's `touchstart`-to-click gap is tens of
milliseconds, not worth a third handler. The `Suspense` fallback and the error
boundary are unchanged; a chunk that fails to download still lands in
`panel-error` with its URL, whether the hover or the click asked for it.

## Step 8 — the three-way theme control ✅ 2026-09-07

**Why.** The toggle cycles auto → dark → light, which is discoverable only by
clicking. A segmented control with three labelled options says what it is.

**Change.** Replace the button in `App.tsx` with three `nav-link`-styled
buttons (`auto` / `light` / `dark`), `aria-pressed` on the active one, calling
`setThemeChoice`. Keep `cycleTheme` exported for keyboard use if wanted.

**What landed.** `App.tsx`: a `role="group"` labelled *theme* holding the three
buttons from one `THEME_OPTIONS` list, auto first; `aria-pressed` is computed
from `themeChoice()`, each click calls `setThemeChoice` with its own state, and
the group's `aria-label` carries what is painting right now — under auto on a
dark OS the labels alone cannot say "dark". `cycleTheme` is deleted rather than
kept: three tab stops reach any state in one Tab and one Space, which is more
than a cycling key offered, and a helper nothing calls is a helper a later hand
wires back in. `styles.css`: the `.theme-toggle` rule goes; the inverted rule
now reads `.nav-link[aria-current="page"], .nav-link[aria-pressed="true"]`, and
two `button.nav-link` rules restate the hover and the pressed-under-hover look —
needed because the bare `button:hover:not(:disabled)` rule under *controls*
outranks `.nav-link:hover` (an element plus two pseudo-classes against a class
plus one) and would have painted the pressed option's hover in the pale fill.
`test/theme.test.ts` pins the three choices in order, the pressed attribute, the
per-button `setThemeChoice`, the absence of `cycleTheme`, and the two selectors.

**Checked in a headless Chrome of its own** against the production build
(`M:\claud_projects\temp\step8-verify\drive.mjs`; `report.json` and five header
screenshots beside it), on `#/rayfan`, fresh profile:

| action | pressed | `data-theme` | stored | pressed button paints |
| --- | --- | --- | --- | --- |
| fresh profile (OS dark) | auto | none | none | `--ink` on `--bg` |
| click *light* | light | `light` | `light` | inverted |
| hover the pressed one | light | — | — | still inverted |
| hover an unpressed one | light | — | — | that one `--bg-2`, border `--line` |
| click *dark* | dark | `dark` | `dark` | inverted, dark palette |
| focus *auto*, Tab, Space | light | `light` | `light` | inverted |
| click *auto* | auto | none | removed | — |
| choose dark, reload | dark | `dark` | `dark` | stamped before React |

`npm run typecheck` passes; `theme.test.ts`, `prefetch.test.ts` and
`boundary.test.ts` — the three that read `App.tsx` — 20 of 20. `npm test`, run
plainly this time (step 7's note says what the other way costs): 3806 of 3813
in 15.6 minutes, seven fail, all the 180 s budget in six `packages/core` files
(§ 6ai.6, § 6b.5.4, § 6bk.1, § 6bk.8, § 6bl.2, § 6bm.1, § 6bo.2 — step 6's list
again, near enough). The six files alone: 137 of 137 in 260 s, with four of the
`onTaskUpdate` stalls `vitest.setup.ts` describes and no test attached to any.

**What this step does not do.** No shortcut key, no `prefers-contrast`, and no
per-panel theme; the control is the shell's and the panels re-style themselves
through the tokens as before.

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

## Step 10 — choose the leading of the bare mono readouts

**Why.** Step 5 named three shapes and reached 86 sites; it deliberately did
not reach the largest family of all. 110 inline `fontFamily: "var(--mono)"`
sites remain across 29 files — 111 occurrences in the app, of which exactly one,
`panels/editor.tsx`'s `mono`, is already a const rather than a site — and they
split by size and leading like this:

| size | leading | sites |
| --- | --- | --- |
| 12 | inherited 1.5 | 65 |
| 12 | 1.7 | 17 |
| 13 | inherited 1.5 | 10 |
| 11 | inherited 1.5 | 7 |
| 12 | 1.8 | 5 |
| 14 | inherited 1.5 | 4 |
| 11 | 1.7 | 1 |
| 15 | inherited 1.5 | 1 |

The 65 are one shape written 65 times and they are *not* a `.readout`: that
class says 1.6 and these inherit 1.5, so classing them would move every one of
them by a pixel of leading. That is why step 5 left them — not because the
duplication is acceptable, but because a class that fits the majority chooses
the minority's leading by accident. Step 5 was required not to move a pixel;
this step is the one that is allowed to, on purpose.

**Change.** Decide, once, what leading a 12 px mono readout has, and say it in
`styles.css`. Then the 65 take that class and the 22 that name 1.7 or 1.8
either join them or keep their own value inline with a reason beside it. The
same question is open for the 13 px and 11 px sites, which are fewer and can
follow whatever the 12 px answer turns out to be.

**Check.** Not a screenshot, and not per site — this step *changes* pixels,
which is the point. What must hold instead is that the change is the one
intended: every site that moves moves from 1.5 to the chosen value and nothing
else about it changes, and the count that moves equals the count in the table
above. `npm run typecheck` and `npm test`.

**Must not change.** The three classes step 5 landed. A site already carrying
`.readout` is settled at 1.6 and is not re-opened here; if the answer to this
step is a different number, changing `.readout` too is a third decision and
wants its own line in this file.

## Out of scope, and why

- **Keeping a panel's workers alive across routes.** APP.md item 1 chose the
  re-trace on return as the honest trade; the elapsed time is on screen.
- **A chart library.** `plot.tsx`'s header: a smoothed curve through measured
  points is a drawing of a claim rather than the claim.
- **Any change to what a panel computes or shows.** That is a panel step in
  APP.md, with its own section.
- **Restructuring the workers so they share one engine copy.** Left open by
  step 4, which measured the cheap route and found it does nothing. Only a
  build that puts the workers in a common chunk graph — declared
  `build.rollupOptions.input` entries, or workers that pull the engine off the
  main graph — would share anything. Both cost the `new Worker(new URL(...))`
  literal convention `src/workers.ts` has a header defending, which trades a
  runtime 404 for a build-time guarantee, so this is a decision about that
  convention and not a performance tweak: it wants asking rather than doing.
  **Bound the prize before paying that.** The 32 bundles are 1.98 MB of
  `dist/`'s 2.88 MB, but that is not 32 copies of one engine — each worker
  imports a different slice of `packages/core` and Rollup tree-shakes it, so
  what dedup can recover is the *intersection*, and the intersection is a
  subset of the smallest bundle. The smallest is `mech.parfocal.worker` at
  19 449 B, so the ceiling is 31 × that ≈ **589 kB**, a fifth of `dist/` and
  not the two thirds the raw worker total suggests. Then discount it again:
  the chunks are lazy, and a session loads two or three.
