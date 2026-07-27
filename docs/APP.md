# App surfaces

What the engine can do that you cannot yet *see*, scoped as app work.

ROADMAP tracks capability; VALIDATION pins it. Neither tracks whether a
capability ever reached a screen, and the gap is now large: the engine is
roughly fourteen validated sub-steps past the last thing the app draws. This
doc is the scope for closing it. It covers the two axes named as unscoped —
**step 5's tolerancing UI** and **the whole microscope branch** — and keeps the
other telescope gaps in a clearly secondary section, because they are a
different kind of missing.

Read ARCHITECTURE for the engine's commitments and ROADMAP for build order.
This doc adds no physics and proposes none; where a surface would need new
physics, that is called out and the surface is disqualified rather than scoped.

## The baseline: what the app draws today, and its house style

`packages/app` is roughly 950 lines. `render.ts` is the whole optical pipeline
as **pure functions** — numbers in, pixels out, no DOM, no React — so running it
in a worker was a change of caller and not of code. `App.tsx` is one page with a
shared slider row and two panel kinds (`StarCanvas`, `FieldCanvas`), each with a
worker hook that does backpressure rather than queueing.

Two traits of that baseline are load-bearing and every new surface should
inherit them:

1. **The pure-adapter boundary.** Nothing in `render.ts` knows it is in a
   browser. Keep it.
2. **The guards are on screen as live engine numbers.** `truncatedFraction`,
   `geometricWeight`, `seeingPhaseStepWaves` are displayed with their own
   thresholds, red when crossed — *"an app that showed that silently would be
   lying with more conviction than one that showed nothing."* Every microscope
   surface below already has its analogous verdict built in the engine. Wiring
   it is free, and skipping it would be a regression in honesty, not just in
   polish.

What the app builds optically is exactly one thing: `refractorPair` — an N-BK7
singlet and an N-BK7/F2 achromat. Not one preset, eyepiece, eye, sensor,
tolerance or microscope has ever been instantiated in the app.

## The rule that decides what is scopeable at all

ROADMAP's own words for the multi-star panel: *"App wiring only — the capability
was already pinned."* That is the line.

- **App-wiring-only** — the engine call exists, is pinned, and returns what the
  panel needs. Scopeable here.
- **Needs an engine step first** — the panel would require capability that does
  not exist. **Not an app task**, because the hard rule requires validation
  rungs pinned to external numbers in the same change. Listing such a panel as
  UI work would smuggle a physics step in as a UI ticket.

Every surface below is tagged with one of the two. The disqualified ones are
listed anyway, with what blocks them, so the boundary is visible.

## Three constraints, measured

These decide the microscope surfaces. All numbers below were measured against
the current engine, not estimated.

### 1. A brightfield frame's width is `pupilSamples`, and it cannot be resampled

This is the constraint to internalize first, because the app's existing
field-panel trick **does not transfer**.

`renderFieldScene` widens the telescope frame by choosing a coarser pixel and
letting `renderField` resample each patch's PSF onto it — the native PSF scale
packs the frame into ~0.06°, so it is sized to 0.8° instead. That escape hatch
exists because a PSF is a kernel that may be resampled.

§ 6h found the brightfield case is different in kind: **the Abbe sum's grid IS
its frequency lattice.** So the frame spans `pupilSamples` resolution cells and
no more, the grid `size` cancels out, and widening the view means raising
`pupilSamples` — which is the cost axis. Measured, at λ = 587.6 nm:

| system | ps=32 | ps=64 | ps=128 | image pixel |
|---|---|---|---|---|
| DIN 4×/0.10 (finite conjugate) | 93.5 µm | 187.1 µm | 374.2 µm | 5.85 µm |
| infinity 4×/0.10 + tube lens | 93.5 µm | 187.1 µm | 374.2 µm | 5.85 µm |
| infinity 100×/1.40 oil | 2.6 µm | 5.3 µm | 10.6 µm | 4.13 µm |

(object-space span across the whole frame; § 6h pins the half-extent as
`pupilSamples`·λ/(4·NA), and pins the 2.7% departure from it as the DIN 4×'s own
violation of the sine condition.)

A real 4× with a 20 mm field number shows ~5 mm and a 100×/1.40 shows ~0.2 mm.
So even at `pupilSamples` = 128 the frame is **13× narrower than the real 4×
field and 19× narrower than the real 100× field.** Two consequences for scoping:

- Any copy that calls a brightfield panel "the view through the eyepiece" is
  false. It is a **detail crop**, and it should be labelled with its own span in
  µm — which the frame object already carries as `objectHalfExtentMm`.
- The panel needs a *specimen* whose interesting structure fits 90 µm (4×) or
  10 µm (100×). A cosine grating does. A field of beads does. A whole diatom
  frustule at 4× does not.

**Good news that fell out of the same measurement:** `objectFieldFrame` works
for the infinity-corrected chain too — objective + tube lens has a finite
conjugate overall (0.17 mm for the oil objective, the coverslip). So both
architectures, including the 100×/1.40 oil, reach the field mapper with **no
engine work**.

### 2. Cost — measured, and the traced pupil is the driver

`diskSource(S, samples)` counts points across the **diameter**, and the count is
independent of S: `samples` = 5 → 21 points, 9 → 69, 15 → 177, 21 → 349. Each
point is one FFT per patch.

Brightfield, `patches` = 1, source = 69 points:

| | ideal pupil | traced DIN 4× | traced 100×/1.40 oil |
|---|---|---|---|
| ps=32, size=64 | 18 ms | 207 ms | 173 ms |
| ps=64, size=128 | 61 ms | 736 ms | — |
| ps=128, size=256 | 395 ms | — | — |

Traced brightfield against `patches`, source = 69:

| | patches=1 | patches=2 | patches=4 |
|---|---|---|---|
| ps=32, size=64 | 207 ms | 789 ms | 3 088 ms |
| ps=64, size=128 | 736 ms | 2 995 ms | 11 799 ms |

Three findings that change the scoping:

- **A traced pupil costs a flat ~8–10× an ideal one, and that multiplier scales
  linearly with source points** (measured 1 → 349 points at ps=32: 19 → 866 ms
  traced against 1 → 89 ms ideal). The pupil callback is re-evaluated per source
  point. There is real headroom here — but caching it is an *engine* change with
  its own exactness question (`shiftPupil` moves where the pupil is sampled, so
  a cache is exact only when the source and pupil lattices are commensurate, as
  § 6i's `latticeMatchedSource` makes them). **Engine step with its own rung, not
  an app task** — but worth knowing it is the reason brightfield is slow.
- **Objective complexity is not the cost driver.** The 100×/1.40 oil — dome, two
  menisci, two cemented doublets, slip and oil film — came in at 173 ms, *below*
  the four-surface DIN 4×. Cost is `patches²` × source points × grid, and the
  prescription barely enters. The branch's most elaborate design is as
  affordable as its simplest.
- **The live/compute-once line falls at about 800 ms.** The existing backpressure
  hook already drops mid-drag slider values, so ≤ ~800 ms is a usable live
  surface. That means: brightfield is live at `patches` = 1 (either objective, up
  to ps=64), and **compute-once at `patches` ≥ 2**. Progressive refinement over
  patches is the fix and `renderBrightfield` already has the hook —
  `onPatch(done, total)` — but note it reports *within* one patch grid, where
  `renderField` refines *across* grids. Coarse-to-fine over `patches` would want
  the caller to run the whole render repeatedly, as `renderFieldScene` does.

Fluorescence and volume are cheap by comparison and are live everywhere:

| fluorescence (traced DIN 4×) | patches=1 | patches=4 |
|---|---|---|
| ps=32 | 9 ms | 119 ms |
| ps=64 | 17 ms | 287 ms |
| ps=128 | 59 ms | 982 ms |

| volume, ps=64 | 5 slices | 11 | 21 | 41 |
|---|---|---|---|---|
| `renderVolume` | 30 ms | 75 ms | 102 ms | 198 ms |

### 3. Several headline results are nulls, so pair every picture with a plot

The branch's strongest findings are things that *do not* appear: brightfield
transfers no phase at any S until a quarter wave of defocus is added; darkfield's
clear field reads exactly 0; a matched plane stack aberrates a hard zero at every
aperture; the missing cone reads 2.2e-15. These make superb panels and terrible
look-at-the-image panels — a black canvas is indistinguishable from a bug.

Scope them as **image + plot pairs**: the picture, and beside it the engine
number or curve that says why it looks like that. This is not extra work bolted
on; it is step 7's stated goal (*"every artifact in the image links to the plot
that explains it"*) arriving early, and it is the only honest way to show a null.

Each surface below is tagged **picture**, **plot**, or **pair**.

---

## Part A — the microscope branch

Nothing here has any app surface. Ordered by value per unit of work.

### A1. Objective picker + the specimen frame — *app wiring only* — **the prerequisite**

Not a panel; the substrate every other microscope panel sits on. One selector
over the ladder's objectives, building the system and its `objectFieldFrame`:

| entry | call | conjugate |
|---|---|---|
| DIN 4×/0.10 | `finiteConjugateMicroscope(finiteConjugateObjective(…))` | finite |
| infinity 4×/0.10 | `infinityCorrectedMicroscope({objective: microscopeObjective(…), tubeLens: tubeLens()})` | finite overall |
| Lister aplanat | `listerObjective(…)` into the same chain | finite overall |
| 100×/1.25 and 100×/1.40 oil | `oilImmersionObjective(…)` + `tubeLens()` | finite overall |

Readouts, all straight off the engine: traced NA against the label, actual
magnification against the label, the frame's object span in µm (§ 6h's constraint
made visible rather than hidden), pixel scale, and `scaleDrift`.

**Cost:** frame build is 1–6 ms. Free.
**Why first:** A2–A6 all consume it, and it is where "the frame is 93 µm wide,
not 5 mm" gets said once instead of five times.

### A2. Brightfield — condenser S, and the (NA_obj + NA_cond) law — *app wiring only* — **pair**

The step's headline. A cosine-grating specimen through a traced objective, with
S on a slider from 0 to > 1.

- **Picture:** `renderBrightfield(object, tracedFieldPupils(system, frame),
  diskSource(S, samples), …)`. Contrast collapses as S → 0 and the image goes
  hard-edged and ringy; opening past S = 1 changes nothing, visibly.
- **Plot:** the cutoff against S. § 6f bisects it off the sum and it returns
  1 + S·(1 − 1/N) to 9 places — so the plot can show the measured cutoff, the
  textbook λ/(NA_obj + NA_cond) line, *and* the lattice discretization term that
  separates them. That third curve is the difference between a demo and this
  repo.
- **Guard:** `fidelity.verdict` — and § 6g.3's rule that the **worst patch
  rules**, plus `contributingPoints` (min over patches: how well the worst
  patch's source was sampled) and `maxGridPhaseStepWaves`. Absent sampling reads
  `unknown`, never `valid`; the panel must show `unknown` as its own state and
  not round it to green.

**Cost:** live at `patches` = 1 (173–736 ms). Compute-once at `patches` ≥ 2.

### A3. The phase null, and why stains exist — *app wiring only* — **pair**

The branch's best single teaching result and it is a *null*: a weak phase object
imaged in brightfield produces **no contrast at any S and any frequency** — the
sidebands cancel identically — and a quarter wave of defocus makes it appear.

Two canvases side by side (`phaseGratingObject` in focus / defocused via
`defocusedPupil` or `withDefocus`) plus the transfer curve from
`weakPhaseTransfer` sitting on zero and then lifting off it. Darkfield rides
along for free: swap `diskSource` for `annularSource` outside the pupil and the
clear field reads `0`.

**Cost:** ideal-pupil path, `patches` = 1 — tens of ms. Live.
**Note:** this one is *stronger* on ideal pupils than traced ones, because the
null is exact there. Do not "improve" it by tracing.

### A4. Fluorescence beads — *app wiring only* — **picture**

The first surface that looks like a microscope photograph rather than a test
chart. `rasterizeEmitters` places beads through the traced chief ray (distortion
carried), `renderFluorescence` forms the image. Cheap enough to be live at
`patches` = 4 and ps = 128 (982 ms) and trivially live at ps = 64 (287 ms).

Its second job is to show the contrast with A2 that § 6i is *about*: no condenser
in the instrument at all, the partition of unity back on the **input** and exact
there, and the ν = 2 cutoff reached where brightfield's closed diaphragm stopped
at ν = 1. Worth a one-line caption and a shared frequency axis with A2's plot.

**Guard:** `maxGridPhaseStepWaves`. No verdict is minted here and the panel must
not invent one — § 6f.9's asymmetry is deliberate.

### A5. Out-of-focus haze and the focus stack — *app wiring only* — **pair**

A z-slider through a `renderVolume` stack, with the finding stated as a number
beside it: **every plane delivers its whole flux however far out of focus it is**,
so a slab three times thicker is exactly three times hazier and refocusing cannot
help.

- **Picture:** the stack, refocusing live (198 ms at 41 slices).
- **Plot:** `axialTransfer` / `axialSpectrum` → the missing cone, zero axial
  transfer at zero lateral frequency; and the axial sinc²(π·w₂₀), which is
  0.8106 at the quarter wave and **exactly zero at every integer wave** — a
  striking thing to scrub a slider through.
- **Readouts:** `inFocusFraction` and `relativeThroughput` (1 for every slice —
  that is the whole point, and it is only meaningful because it is computed from
  `formedSum` rather than from the normalized kernels).

The bead-in-a-slab scene that would make signal-to-haze visible is named in
§ 6k's *Not yet pinned* as wanting scenes the branch has not built — but as a
*scene*, it is A4's `rasterizeEmitters` at several depths, which is app work.

### A6. Coverslip mismatch and the slip tolerance — *app wiring only* — **plot**

Sliders for slip thickness and index against σ, on the 100×/1.40 oil. The
results are sharp and entirely numeric, so this is a plot surface with at most a
small PSF inset:

- thickness error costs **exactly zero** aberration when refocused the way the
  instrument does — σ flat across 0.15–0.18 mm;
- with the oil film pinned instead, σ crosses Maréchal within ±1.6 µm;
- **index** is the binding tolerance: ±0.003 is 1.9× the budget;
- delivered NA drifts with thickness (1.4126 on an objective labelled 1.40) and
  hits § 6e.4's own 1.411 geometric ceiling at 0.1613 mm — where the tracer
  starts losing rays. That coincidence is worth drawing.

`coverslipTolerance`, `stackW040Mm`, `plateWavefrontErrorMm` supply all of it.

### Disqualified — needs an engine step first

| surface | blocked on |
|---|---|
| Stained tissue / diatom fields | § 6h's warped-grid rasterizer, not built. A points-only scene (A4) sidesteps it; an extended specimen does not. |
| Depth-dependent spherical aberration in the z-slider | § 6l — the physics is in § 6c/§ 6e but wiring focal depth into the stack is its own step with its own rungs. `DepthPupils` is the hook. |
| Confocal / deconvolution | the excitation path (§ 6j open) — a detection pinhole and an excitation PSF. |
| Polychromatic brightfield / fluorescence colour | § 6f and § 6i both name it open. § 6j's band is emission-only. |
| A live "real field of view" brightfield frame | constraint 1. Not a UI problem and not solvable by resampling. |

---

## Part B — tolerancing (step 5's named leftover)

ROADMAP asks for *"a slider per tolerance, the image degrading as the budget
predicts."* Scoped as slider-→-blurrier-picture it loses the only thing that
makes it more than a blur dial, because the interesting claim is that the
**predicted** and **actual** degradation agree.

`toleranceBudget` already returns both, side by side and computed differently:

- `rssWaves` — √(Σ σᵢ²), the budget's prediction *assuming the modes are
  independent*;
- `combinedWaves` — everything applied at once and traced **once**, the honest
  number;
- `strehlMarechal` from the combined blur;
- and per-row `contributions`, so the bar chart of who-spends-what is free.

So the panel is: a slider per `Perturbation` (curvature, thickness, tilt,
decenter on a chosen surface), a contribution bar chart, **the two σ numbers
against each other**, and the rendered star degrading beside them. The moment
the panel exists to show is `rssWaves` and `combinedWaves` diverging when the
modes stop being orthogonal — independence is an assumption, and this is the
surface where it visibly fails.

`sensitivity` adds the three-way split per perturbation
(`sigmaBeforeFocusWaves` → `sigmaWaves` → `physicalRefocusWaves`: before the
focus compensator, after it, and what a real focuser actually leaves) plus
`boresightRad`. The middle one is the budget's currency; showing all three is
what stops the panel from implying a focuser fixes more than it does.

**Status:** app wiring only. **Cost:** `sensitivity` traces per perturbation at
`pupilSamples` = 21 by default — cheap, but it re-solves best focus, so measure
before putting it under a live slider.

---

## Part C — secondary: telescope surfaces with no app presence

Real gaps, but a different kind: these are *presets and modes* the app never
instantiated, not a whole branch. All are app-wiring-only unless noted. Listed
for completeness, not proposed as the next work.

- **Presets** — Newtonian, Cassegrain, Ritchey-Chrétien, Schmidt,
  Schmidt-Cassegrain, SCT. The app hardcodes `refractorPair`; a preset selector
  is the same shape as A1 and would light up six designs at once.
- **Spider diffraction** (§ 5c) — a `PupilFunction`, so it composes with the
  seeing screen already wired. Probably the cheapest visible win in the repo.
- **Off-axis diagonal vignetting** (§ 2f) — one more `PupilFunction` mask.
- **Eyepieces + afocal** (§§ 5l–5o) — Plössl and Huygens, with real-ray AFOV and
  distortion.
- **Eye model / visual mode** (§§ 5p–5q) — the two-stop collapse, exit-pupil
  matching.
- **Camera mode** (§§ 5r–5s) — `Sensor`, `resampleToSensor`, `plateScale`,
  `fieldOfView`, `samplingRegime`. The oversampled/critical/undersampled verdict
  is another ready-made guard readout, and aliasing is carried rather than
  assumed.
- **Long-exposure seeing** — *needs a small engine step*, and the distinction
  matters: the **physics is already pinned** (Fried's OTF exp(−3.44·(ρ/r₀)^5/3)
  and the seeing-limited FWHM), but the averaging lives in a **test-local
  helper**, `seeingEnsemble` in `seeing.test.ts`, with no exported API. The app's
  dial is one short-exposure draw and says so. Promoting the helper to
  `core/wave` is the step; note the cost first — the rung averages 120 screens
  and takes 14–20 s, so this is a compute-once surface, never a live dial.

---

## What the app itself needs to hold this

Structural work implied by the above, independent of which surfaces land:

1. **A panel registry and routing.** One 500-line `App.tsx` with a shared slider
   row does not extend to a dozen surfaces with disjoint controls. Tabs or routes
   per surface family (telescope / microscope / tolerancing), each owning its
   controls.
2. **One adapter module per family, on `render.ts`'s pattern.** `microscope.ts`,
   `tolerance.ts` — pure functions, no DOM, so they drop into workers unchanged.
   This is the single commitment worth keeping from the current app; everything
   else there is disposable.
3. **Generalize the worker hooks.** `useRenderedStar` (one reply) and
   `useRenderedField` (many frames, releases on `done`) are already the two
   shapes needed. Make them generic over request/result rather than copying a
   third.
4. **A shared guard-readout component.** Every surface has a verdict or a
   threshold number; they should look the same and turn red the same way.
5. **A shared plot primitive.** Constraint 3 means roughly half the microscope
   surfaces are curves, and there is no plotting in the app at all. A minimal
   axes+line canvas is enough and keeps the no-dependency posture.

Note that `@telemicroscope/core/illumination` is already in the package's
`exports` map, so no packaging work is needed for the brightfield surfaces.

## Suggested order

**A1 → A2 → A3 → A4** lands the microscope branch's headline results with one
substrate and two panel kinds, and A3 and A4 are cheap once A1 and A2 exist.
**Part B** is self-contained and can go in parallel — it touches no microscope
code. **A5 and A6** follow. **Part C** is a separate decision.

The structural items are not a prerequisite: A1+A2 can land in the current
`App.tsx` shape and force the registry honestly, the way the multi-star panel
forced the field worker.
