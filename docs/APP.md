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
Parts A–C add no physics and propose none; where a surface would need new
physics, that is called out and the surface is disqualified rather than scoped.

**Part D breaks that rule deliberately and says so.** A1–A5 landed the microscope
branch's headline results and left the branch unable to do the thing a microscope
is for — you cannot build an instrument, put a slide under it, look through an
eyepiece, or see anything wider than a detail crop, in colour. Those are not
wiring gaps, so Part D scopes the **engine steps** as well, each with the rungs
that would pin it, and marks which is which throughout.

## The baseline: what the app draws today, and its house style

The adapters — `render.ts`, `microscope.ts`, `brightfield.ts`, `phase.ts`,
`fluorescence.ts` — are the whole optical pipeline as **pure functions**, numbers
in, pixels out, no DOM, no React, so running one in a worker was a change of
caller and not of code. A4 stretched "pixels out" and it is worth naming: its
worker returns the **intensity grid**, and the panel maps it to grey, because the
display stretch there is a control over the same numbers and re-tracing an
objective to change a grey scale would be paying an optical cost for a display
choice. The boundary is unchanged — `toGrey` is still a pure function in the
adapter — but "the adapter returns RGBA" was a convention rather than the rule.
Since structural item 1 below, `App.tsx` is a nav row and one panel: each surface
lives under `src/panels/`, owns its own controls and state, and is routed to by
hash.

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
   polish. Since A3 they all render through one `Guard` (structural item 4).

   A3 widened this trait in a way worth stating as its own rule: **a readout
   whose value is undefined must be refused, not printed as zero.** Its
   darkfield transfer curves are 0/0 — the quantity they normalize by is
   identically zero — and three flat lines would have read as the panel's null
   while saying something false. The engine returning a guarded 0 is not
   permission to draw it.

What the app built optically, when this doc was written, was exactly one thing:
`refractorPair` — an N-BK7 singlet and an N-BK7/F2 achromat. **A1 has since added
the microscope catalogue** (`microscope.ts`); no preset, eyepiece, eye, sensor or
tolerance has been instantiated yet.

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

(object-space span across the whole frame. § 6h pins the half-extent as
`pupilSamples`·λ/(4·NA) and pins its departure from that closed form as the
DIN 4×'s own violation of the sine condition.)

**The span is set by NA alone — magnification does not widen it.** Measured
within one architecture, holding everything but one variable:

- NA 0.10 → 0.15 at 4×: span 93.54 → 61.96 µm. Ratio 1.510 against an NA ratio
  of 1.500 — 1/NA, with the ~0.7% residual being the sine-condition departure
  above. (NA ≥ 0.20 throws: *"this glass pair does not admit the classical
  doublet solution"* — § 6b's f/4.1 ceiling, arriving as an error message. A
  picker must handle it.)
- 4× → 10× → 20× at NA 0.10: span **identical** at 93.54 µm, while the image
  pixel scales exactly with M (5.8462 → 14.6154 → 29.2308 µm).

That second row is the one to act on. Reaching for a higher-magnification
objective does **not** buy a wider or narrower crop; only NA moves it, and it
moves the wrong way — the better the objective resolves, the less of the
specimen the panel can hold. The oil objective's 2.6 µm is that plus the
immersion medium, which enters through the wavelength in the medium; this doc
does not re-derive it and quotes the measurement.

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

The timings below are **single runs under `vite-node`, no warmup** — good for
the only decision they are used for (live against compute-once, an
order-of-magnitude call) and not to be read as pinned numbers the way the frame
spans above are. The 8–10× traced/ideal ratio is the exception: it holds across
five source sizes, so it is a real ratio.

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
- **The live/compute-once line falls at about 800 ms** — and unlike everything
  else in this section that is a **judgment call laid on the timings, not a
  measurement**. It comes from how the existing backpressure hook behaves: it
  already drops mid-drag slider values, so ≤ ~800 ms stays usable. That means: brightfield is live at `patches` = 1 (either objective, up
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

(That volume row is `renderVolume` alone on pre-made fields. A5 measured the
whole job — rasterizing a bead field per plane included — at 59–107 ms for
9 planes and 129–262 ms for 27 under `vite-node`, of which **rasterizing is
1–3 ms**. The browser ran ~2.3× the node figure, as A4 found.)

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

A1–A5 have landed; A6 has no app surface yet. Ordered by value per unit of work.

### A1. Objective picker + the specimen frame — ✅ **landed** — *app wiring only*

Not a panel; the substrate every other microscope panel sits on. Shipped as
`packages/app/src/microscope.ts` (pure adapter, `render.ts`'s pattern) plus a
`MicroscopeTable` in `App.tsx`, building each entry's system and its
`objectFieldFrame`:

| entry | call | conjugate |
|---|---|---|
| DIN 4×/0.10, 4×/0.15, 4×/0.20 | `finiteConjugateMicroscope(finiteConjugateObjective(…))` | finite |
| infinity 4×, 10×, 20× at NA 0.10 | `infinityCorrectedMicroscope({objective: microscopeObjective(…), tubeLens: tubeLens()})` | finite overall |
| Lister 40×/0.20 and 40×/0.40 | `listerObjective(…)` into the same chain | finite overall |
| 100×/1.25 and 100×/1.40 oil | `oilImmersionObjective(…)` + `tubeLens()` | finite overall |

Readouts, all straight off the engine: traced NA against the label, actual
magnification against the label, the frame's object span in µm (§ 6h's constraint
made visible rather than hidden), object and image pixel scale, λ/(2·NA),
`scaleDrift`, the corner's vignetted-ray count, and σ on axis and at the corner.

**It is a table rather than a selector, and that was the one departure from this
doc.** A selector shows one row at a time and the finding worth showing is a
*comparison*: three rows at NA 0.10 covering an identical 93.5 µm while their
image pixels scale exactly with M. That is constraint 1 as an experiment the
reader runs — move the grid control and watch the crop *not* change — rather than
as a paragraph. The whole catalogue is ~550 ms, which buys it.

**Three entries exist to be refused**, and the engine's own error text is what
the cell shows: § 6b's f/4.1 doublet ceiling (DIN 4×/0.20) and § 6d's measured
NA 0.343 wall (Lister 40×/0.40, whose message carries both glass pairs' numbers).
This doc predicted a picker "must handle it"; showing the message *is* the
handling, and it puts two measured findings on screen for free.

**Two corrections to what was scoped above.** Frame build is indeed 1–6 ms, but a
row is ~50 ms — `scaleDrift` is six more field traces and dominates, so the panel
reports its own elapsed time rather than inheriting the 1–6 ms estimate. And σ is
reported **as traced**, about its own mean at the system's own image plane with
no best-focus solve, because that is the wavefront a render will see; the
Maréchal comparison is therefore one-sided and the panel says so (green ⇒
genuinely diffraction-limited, red ⇒ "not at this focus", not "not correctable").

**The `cells` column — span ÷ (λ/2·NA) — is § 6h's closed form checked on
screen**, and it does not come out clean: it lands on `pupilSamples` to within a
percent for every dry row and ~2.5× under it for the two immersion ones. It was
briefly dropped for reading like a bug, and that was the wrong call in this
repo's terms — removing it left the "spans `pupilSamples` resolution cells" claim
standing with nothing to check it against, honest in this doc and overclaiming on
the page. It is shown with the gap named instead: λ/(2·NA) is quoted at the
**vacuum** wavelength and lets the medium in through NA alone, while the frame's
extent carries the wavelength in the medium as well. Constraint 1 above already
declines to re-derive the immersion span and quotes it as measured; the panel
says the same thing where a reader can see it. Closing the gap is a physics
question with its own rung, not a UI one.

**Why first:** A2–A6 all consume `buildFrame`, and it is where "the frame is
93 µm wide, not 5 mm" gets said once instead of five times.

### A2. Brightfield — condenser S, and the (NA_obj + NA_cond) law — ✅ **landed** — *app wiring only* — **pair**

The step's headline, and it landed as scoped: a cosine-grating specimen through
a traced objective, S on a slider, `patches` = 1. Shipped as
`packages/app/src/brightfield.ts` (pure adapter), `brightfield.worker.ts`,
`plot.tsx`, and a picture/plot pair in `App.tsx`.

**The pair is joined by two markers, and that is what makes it one claim.** The
plot carries a vertical rule at the slider's S and a horizontal one at the
object's own ν; where they cross the curve is where the grating appears in the
picture beside it. Measured on the traced DIN 4×/0.10 at ν = 1.3125 with an
11-point condenser: contrast reads **identically 0.00000** at S = 0.30 and
**0.02446** at S = 0.35 — and the weak-object prediction 2mT is 0.02452, so the
lift-off is where the transfer says and the magnitude is what the closed form
says.

**The third curve is not the one this doc specified, and the correction is the
finding.** `1 + S·(1 − 1/N)` is right only while the whole source sits inside
the pupil. What the measured cutoff actually lands on — at every S, for every
objective in the catalogue, and for *even* sample counts as well as odd — is the
**lattice reach**: the largest |s_x| + √(1 − s_y²) over the directions the
sampled condenser holds and the pupil admits. Measured meets it to **~1e-12**
(`worstResidual` is printed under the plot); it meets the textbook line nowhere.
At the default sampling there is a slider stop, S = 0.33, where the textbook law
says ν = 1.3125 is transmitted (cutoff 1.330) and the engine transmits nothing
(lattice 1.3000) — the disagreement is not described, it is stood in. That is
why the S slider steps by 0.01: at 0.05 the window where the two laws differ
contains no stop.

**And this doc's "opening past S = 1 changes nothing, visibly" is wrong on a
finite lattice.** In the continuum it is exactly right. On the lattice the
sampled directions keep marching outward, the outermost ones leave the pupil,
and the measured cutoff steps back **down** — at N = 11 from 1.909 at S = 1 to
1.818 at S = 1.5 and 1.727 at S = 2, a visible saw-tooth on the plot. It is
discretization, not physics, and raising `sourceSamples` walks it back up
(N = 33 reaches exactly 2.000 at S = 1.5). The panel shows it and names which of
the two it is.

**Two things the plan did not budget for.**

*The S slider needs a hard clamp.* `abbeImage` **throws** when the shifted pupil
runs off the frequency grid — correctly, since a truncated pupil would read as a
smaller aperture — so S has a ceiling of ((size − 2)/pupilSamples − 1)/(1 − 1/N)
that moves with three other controls. `maxCoherenceParameter` derives it, the
slider is capped at it and says so, and the throw is still caught and shown:
a clamp from a formula is a claim, and the engine's message is the check on it.
Verified against the engine at pupilSamples 64 / size 128 / N 11 — predicts
1.0656, and `abbeImage` throws at 1.1.

*`unknown` is unreachable through `tracedFieldPupils`*, which was the whole
point of § 6h's wiring — so a **traced / ideal pupil toggle** was added rather
than leaving the third verdict state as dead code. It earns its place three
times over: it is the only way the panel reaches `unknown` (and shows the
engine's reason for it), it puts § 6f.10's contrast ordering on screen (ideal
0.7407 > Lister 40× 0.7385 > DIN 4× 0.5887, in wavefront order), and it is
~2.7× faster.

**Guard:** `fidelity.verdict` in three distinct colours, with
`phaseStepWaves`, `contributingPoints`/source points, and
`maxGridPhaseStepWaves` beside it. Also reported: the mean intensity (the
display normalizes to it, and the panel says so), and the harmonic at **2ν** —
a frequency no linear imager could put there from a single-frequency object,
which is partial coherence's nonlinearity as a reading rather than an assertion.

**One honesty note the panel carries:** `abbeImage` normalizes the source
weights to Σ = 1, so closing the diaphragm costs no *light* here where a real
one goes dim. What it costs is resolution. The mean is printed so the
normalization is not hiding a change.

**Cost, measured in the browser** (dev build, in the worker, pupilSamples 32 /
size 128 / N 11): **~620 ms traced, ~228 ms ideal**, against the 173–736 ms
scoped below. Live. `patches` is fixed at 1 and deliberately not exposed — ≥ 2
is compute-once and progressive refinement over patches still does not exist.

### A3. The phase null, and why stains exist — ✅ **landed** — *app wiring only* — **pair**

The branch's best single teaching result and it is a *null*. Shipped as
`packages/app/src/phase.ts` (pure adapter), `phase.worker.ts`, and
`panels/phase.tsx` — two canvases from `phaseGratingObject`, in focus and
defocused through `defocusedPupil`, beside the transfer curve from
`weakPhaseTransfer` sitting on zero and lifting off it. The ideal-pupil
instruction was kept and is stated on the page with its reason: the null's
precondition is an unaberrated pupil, so tracing would turn an exact zero into a
small number, and a small number cannot be told from a bug. No objective means
no honest µm scale, so the panel quotes ν and grid units and never a span.

**The scoped headline was wrong in a way worth keeping.** This doc said "no
contrast at any S and any frequency", and the canvas is *not* blank.
`phaseGratingObject` is exact — every Bessel order, not the weak-object
truncation — so squaring t = Σ iⁿJₙ(φ)e^{inu} leaves the ν bin (the 0×±1 beat)
cancelled and the **2ν bin (the +1×−1 beat) alive at order φ²**. What is null is
the **linear** response, which is precisely what `weakPhaseTransfer` computes and
what the plot draws. So the picture carries structure at twice the frequency of
the object that made it while the transfer at the object's own frequency sits on
the axis — a better panel than a blank rectangle, and the correction is the
finding rather than a caveat on it.

**And the null is much stronger than "weak".** Measured worst case over
φ ∈ [0.1, 3.0], ν ∈ [0.25, 1.0], S ∈ [0, 1] *and* darkfield: **2.7e-15**. The φ
slider is therefore an experiment that fails to break it rather than a brightness
dial — at φ = 3 rad the object is nothing like weak and the 2ν contrast has run to
0.77, and the ν bin has not moved off f64 noise. `weakPhaseTransfer` itself
returns **bit-exact 0**, not a small number, over every S and ν sampled, which is
why the plot's y-range is fixed rather than autoscaled and the magnitude is
printed as `0.000e+0`: autoscaling to a null draws f64 noise as a signal with its
own tick labels.

**A closed form this doc did not scope, and it needs no new engine code.** Under
one on-axis plane wave with 0.5 < ν < 1, exactly three orders reach the image, and
the algebra gives `contrast(2ν) · mean = 2·J₁(φ)²` with no free parameter.
Written that way round — multiplying by the *measured* mean rather than dividing
by a computed one — it needs only `besselJ1`, which § 6g.2 already pinned, and
**not** J₀, which the engine does not have and which a panel must not invent.
The regime boundaries are measured too and the panel refuses the comparison
outside them rather than showing an approximate one: at ν ≤ 0.5 the ±2 orders get
through (99% error), at S = 0.4 the source is no longer one plane wave (70%), and
ν = 1 exactly is excluded because the ±1 orders land on the pupil rim.

**The residual is printed, and the first version of this panel was wrong not to.**
It read "agrees to ~1e-14" in prose and showed two nine-digit numbers for the
reader to diff by eye. Swept over every (cycles, φ) the sliders can actually
reach, the agreement is 1e-16..1e-14 through most of the regime but reaches
**6.1e-10** at ν = 0.8125 with φ = 3 — and it is **not monotone in ν**, since
ν = 0.9375 at the same φ is back at 2.6e-15. Which lattice samples the ±1 orders
land on is what moves it. On screen at ν = 0.75, φ = 3 the two numbers both print
`0.229921955` while the residual reads `1.18e-11`: visually identical, three
orders apart. A panel that stated a precision its own controls can falsify is the
failure mode this repo is otherwise careful about, and printing the number makes
the claim self-checking at every setting instead.

**The sharpest thing on the panel came out of that same form.** Drag the defocus
slider and `2ν · mean` does not move — not approximately, but in every printed
digit, from 0 to 6 waves — while the contrast at ν runs 0 → 0.74 → back.
Defocus is a pure phase and orders +1 and −1 sit at the *same* pupil radius, so
the beat that makes 2ν picks up no phase difference at all, while the 0×±1 beat
that makes ν picks up sin(2π·w₂₀·ν²). One slider, two terms in one image, and
only one of them listening.

**Darkfield does NOT ride along for free, and that is this surface's real
correction to the plan.** The clear-field half is exactly as scoped —
`annularSource` outside the pupil, φ = 0, and the mean reads `0.0000e+0` with both
canvases hard black. But every transfer in `illumination/transfer` is a ratio to
the undiffracted energy Σw·|P(s)|², and darkfield puts that at **exactly zero**,
so the engine's guarded division returns 0 and *all three curves* — including the
absorption one — lie flat on the axis. Drawing them beside a paragraph about a
null would state something plainly false: darkfield transfers plenty of contrast,
and the canvases measure it. So the panel **refuses to draw the plot** in
darkfield and says which quantity is undefined. A2's `latticeReach` docstring
called this case out in advance and named A3 as the panel that would ask for it;
this is the same hole in the normalization rather than in the cutoff. It was
found by driving the app, not by the headless suite.

**Darkfield also has a grid ceiling A2's formula does not describe.** The annulus
lies outside |s| = 1, so its outermost lattice point needs frequency-grid headroom
that pupil samples 64 on a 128² grid does not have — measured, the N = 11 ring
reaches |s| = 1.371 against a reach of 0.969, and `abbeImage` throws. The check
runs over the source's own points rather than as a formula in S, because an
annulus's reach is not something a formula in S describes; the option is disabled
with the engine's numbers in the message, and the throw is still caught.

**One display choice the plan did not budget for.** Both canvases share one grey
scale, because a pair independently normalized would rescale against each other —
but that fixes the pair against itself and not against the rest of the app, and a
darkfield mean runs ~50× below a brightfield one. Rather than hide the stretch,
the **display gain is printed as a factor**: ×1.0 in brightfield, ×51.5 in
darkfield. The honest-looking alternative — an absolute scale, darkfield rendered
genuinely dark — makes it a black rectangle indistinguishable from a broken
render, which is the failure constraint 3 above says a null panel can least
afford.

**The plot's own sampling had to follow the defocus, and that is a second guard
the first version lacked.** At S = 0 the defocused phase transfer is exactly
|sin(2π·w₂₀·ν²)| for ν ≤ 1 (measured to 1e-14), so its lobes narrow to 1/(4·w₂₀)
at ν = 1 — and a fixed 111 samples over [0, 2.2] is 50 per lobe at a quarter wave
but **2.08 at six**, where the slider ends. The rightmost lobes were a drawing of
the sampling rather than of the transfer. `plot.tsx`'s own posture is the
argument: it refuses to interpolate or fit *because* a smoothed curve through
measured points draws a claim rather than the claim, and joining an undersampled
oscillation with straight lines is the same error facing the other way. The
sample count now scales with w₂₀ for 8 per lobe; measured cost at 441 samples is
0.2 ms at S = 0 and 20.7 ms at S = 1 with a 349-point condenser. Note the
`maxGridPhaseStepWaves` guard does **not** cover this — that one is about the
image's pupil sampling, a different quantity from the plot's ν sampling.

**Guard:** `maxGridPhaseStepWaves` against the half-wave criterion, the same
number `telescope.tsx` holds `seeingPhaseStepWaves` to. It is genuinely reachable
here and the slider's range was set from where it is crossed rather than by
arithmetic: at pupil samples 32 the step runs 0.0303 at a quarter wave and 0.7266
at 6, crossing near w₂₀ = 4.1 — so the slider ends at 6. At pupil samples 64 it is
exactly half that and 6 waves reaches only 0.369, which is the guard being a
statement about the grid rather than about the physics. `fidelity` is shown too
and reads `unknown` at every setting, correctly: an ideal pupil carries no memory
of a trace, and A3 must not round that to green.

**Cost, measured in the browser** (dev build, in the worker, pupil samples 32 /
grid 128 / N 11): **~20–24 ms for the pair** at S = 0 and **~162 ms** in darkfield,
where the annulus holds 36 directions against the coherent limit's one. Live
everywhere. One job carries both images rather than two — the panel's claim is a
comparison, and two jobs can transiently show an in-focus frame at one φ beside a
defocused one at another.

**Note kept:** this one is *stronger* on ideal pupils than traced ones, because
the null is exact there. Do not "improve" it by tracing.

### A4. Fluorescence beads ✅ — *app wiring only* — **picture**

Landed as `fluorescence.ts` / `fluorescence.worker.ts` /
`fluorescence.sweep.worker.ts` / `panels/fluorescence.tsx`. It is the first
surface in the app that looks like a microscope photograph rather than a test
chart, and it did what it was scoped to do: `rasterizeEmitters` places beads
through the traced chief ray, `renderFluorescence` forms the image, and the
second job — no condenser in the instrument, the ν = 2 cutoff reached where
brightfield's closed diaphragm stopped at ν = 1 — is a plot on A2's and A3's own
ν axis. Both halves are live. Four things had to change from the plan, and three
of them are findings rather than adjustments.

**The display convention had to break with A2 and A3, and that was not a taste
call.** Both of those put white at twice the frame's mean, which is right for a
grating filling every pixel. A bead field is *sparse*: measured, a single bead's
peak runs **12.7× the frame mean at pupil samples 32 and 99.5× at 128**, so
white = 2·mean would have clipped every bead into a flat white disc — the panel
whose entire claim is *"each blob is the PSF"* showing discs with no PSF in
them. White comes from the image's own peak, and the stretch (peak ÷ 1, 4, 16)
is a `Choice` with the divisor printed, A3's rule about a stated stretch kept.
It rides on a second departure: the **worker returns the intensity grid rather
than pixels**, so moving the stretch remaps the same numbers instead of
re-tracing an objective to change a grey scale.

**The picture's brightness is NOT a reliable reading of the optics, and this is
the surface's real correction to the plan.** "Every bead emits the same power,
so a difference between two blobs is the objective" is true of the physics and
false of the *picture* at coarse sampling. `rasterizeEmitters` splats
bilinearly — right, and `imaging/scene`'s own convention — but the splat spreads
a point over up to four pixels, and how much that costs the peak depends on how
many pixels the PSF spans. Measured on the DIN 4×, one bead walked across a
pixel in eighths:

| pixels per Abbe distance | peak spread |
|---|---|
| 2.01 (grid 128, ps 64) | **19.1%** |
| 4.02 (grid 128, ps 32) | 5.7% |
| 8.04 (grid 256, ps 32) | 1.5% |

Against a corner-to-axis kernel drop of 0.2–9.3%, that means at two pixels per
cell the **rasterizer outweighs the optics**. So the panel prints pixels per
resolution cell, turns it amber under 3, and says in as many words that blobs
may be compared by eye only above ~4 — and the corner-coma claim lives in a
readout computed from the *pupils*, not read off the picture. This is also the
concrete answer to why `grid` is worth raising when § 6h says it buys no field:
it buys PSF sampling, and that is what the splat error is a function of.

**§ 6i.5's corner drop has no universal sign.** That rung measured the corner's
traced pupil giving a lower-peaked kernel than the axis's on one objective, and
it holds here — but across the catalogue at pupil samples 32 the sign flips: the
DIN 4×/0.10 drops **0.659%** and the infinity 20×/0.10 drops **0.997%**, while
the Lister 40×/0.20 **gains 0.188%** and the 100×/1.40 oil **gains 0.184%**.
Their corner wavefront is genuinely better than their axial one at the system's
own image plane with no best-focus solve (Lister: 0.01242 waves at the corner
against 0.01419 on axis). "The corner is worse" is a statement about a
particular design, not about field position. The drop also scales with the crop
rather than being a property of the objective alone — on the DIN 4× it runs
**0.659% → 2.38% → 9.33%** at pupil samples 32 → 64 → 128, because raising
pupil samples widens the frame (93.5 → 187.1 → 374.2 µm) and walks the "corner"
further off axis. At 128 it is visible in the picture: the outer beads are
plainly fatter than the central ones.

**The transfer sweep needed its own worker, where A2's and A3's run on the main
thread.** Theirs are pupil-evaluation sums at 190 ms and 20 ms, which a
`setTimeout` deferral covers. This one renders an image per frequency and
measures **244 ms / 1140 ms / 2511 ms** in the browser at pupil samples
32 / 64 / 128. On the main thread that froze the page on every objective change
hard enough that a screenshot timed out — found by driving the panel, not by
reading the timings. Two workers rather than a second message type on one: the
picture re-renders on every bead and stretch change while the sweep does not
move at all, and separate workers let them run at once.

Moving it there introduced a defect worth recording, because the fix is not the
obvious one: with the sweep deferred by `setTimeout` the plot blanked itself
before recomputing, and with it in a worker the previous objective's curve stayed
mounted for the 1–2.5 s the next one took — under a legend reading *"measured,
this objective"* and a caption attributing the residual to the objective by name.
Every other surface **dims** on `pending`, and dimming would have been wrong
here: it makes a false label faint rather than absent. The plot is withdrawn
instead while the picture beside it still only dims, and the asymmetry is the
rule — *a stale reading may be shown greyed only if nothing on screen
misdescribes it.*

**What the plot actually shows.** Three curves on ν: `incoherentTransfer`'s
closed form, `weakObjectTransfer` under one on-axis plane wave (brightfield with
the diaphragm shut — flat at 1 to ν = 1, then a cliff to 0), and the **measured**
series, `imageHarmonic` read off a rendered `cosineGratingEmitters` through the
same traced pupil the picture used. Two details are load-bearing:

- **There is no factor of two.** A2's `2·m·T` comes from an *amplitude* object,
  t = 1 + m·cos, squared. A fluorescent object emits, so E = 1 + m·cos is
  already an intensity and I = 1 + m·T·cos — T is the measured contrast
  unhalved. Copying A2's 2 would have doubled every point on the curve. Pinned
  by a control: on an *ideal* pupil the measured contrast lands on the closed
  form to worst 3.1e-3 at ps 32 and 1.2e-3 at ps 64, which is § 6i.3's lattice
  discretization and not a factor. The sweep runs at m = 1 and says why —
  § 6i.1 leaves nothing for the modulation to enter.
- **§ 6i.3's tangency reproduces live.** At ν = 2 the DIN 4× reads
  **1.2546e-3** against 1/797 = **1.2547e-3** transmitting lattice points; the
  oil reads 1.178e-3 against the same 1/797, and that gap is the traced pupil's
  own amplitude at the one surviving point. Past tangency the image is flat to
  f64 (4.1e-16). But ν = 2 is only *on the grid* when the grid carries
  2·ps + 2 bins, so at pupil samples 128 it is unreachable and the panel says
  which grid would fix it rather than printing an aliased Nyquist bin.

**§ 6i.4's conservation is live and reads ~1e-15** at every patch count. It is
measured against the **rasterized** emitter field, not the flux asked for:
`rasterizeEmitters` drops beads whose splat falls off the grid, and counting
those as lost photons would print a conservation failure that is nothing of the
kind. When nothing lands at all it is a ratio to zero, and the panel **refuses
it** rather than printing a guarded 0 beside a green tick — A3's rule, applied to
a case no seed the slider offers actually reaches.

How many landed is printed beside it, and what moves it is **the grid, not the
frame width**. `rasterizeEmitters` drops a bead whose 2×2 splat footprint
crosses the edge, so the lossy band is one pixel wide out of `size` and halving
the pixel halves the loss: measured 78 of 80 at grid 128 and 80 of 80 at grid
256 — *at both pupil samples 32 and 64, and identically for the DIN 4×'s 93.5 µm
crop and the oil's 2.65 µm one.* A 35× difference in span and a completely
different distortion move the count not at all, which is a sharper statement
than the frame-width one it replaces and was only visible because the two
configs first compared had varied `pupilSamples` and `size` together. Printed
with it: the density in beads per 100 µm², without which the oil objective's
2.65 µm crop looks like a broken bead slider (80 beads there is 1114 per
100 µm², and the picture is the crowded mush that implies).

**Cost, measured in the browser** (dev build, DIN 4×, 80 beads): **65 ms** at
ps 32 / grid 128 / patches 1, **189 ms** at ps 64 / grid 256, **246 ms** at
ps 128 / grid 256. `patches` = 4 costs **983 ms** at ps 64 and **1831 ms** at
ps 128 — so the plan's "live at `patches` = 4 and ps = 128 (982 ms)" **did not
hold in the browser**, which ran ~2.3× the node figure this doc's § 2 table was
built from. Fluorescence is live at `patches` = 1 everywhere and compute-once at
`patches` ≥ 2, which is brightfield's own line arriving three times further
along.

**Guard:** `maxGridPhaseStepWaves`, and it is the only one. No verdict is minted
and the panel does not invent one — `VERDICT_LEVEL` does not appear in the file.
The trace's `rmsWaves` and `lost` are printed as what they are, a wavefront error
and a vignetting count, never dressed as fidelity. § 6f.9's asymmetry is
deliberate and § 6i.5 states it.

**No engine capability was added, so no validation rung was.** Everything here
is § 6i's, called from the app.

### A5. Out-of-focus haze and the focus stack — ✅ **landed** — *app wiring only* — **pair**

Landed as `volume.ts` / `volume.worker.ts` / `volume.axial.worker.ts` /
`panels/volume.tsx`. The bead-in-a-slab scene this doc predicted would be app
work was exactly that — A4's `rasterizeEmitters` called once per plane — and the
adapter/worker/plot pattern transferred for the fifth time. Two things it did not
predict are findings rather than adjustments, and one of them was only visible
because a curve got drawn.

**The scene is arithmetic, and that is what makes the claim exact.** The planes
step by one depth of focus and the focus steps by the same, so **plane j sits at
(j − focus)/2 waves** — § 6j defines the depth of focus so that half of it is a
quarter wave — and exactly one plane lies inside the ±½ DOF window at every
setting. Half-DOF focus steps would tie two planes on the window's `<=` boundary
and the fraction would flicker between 1/N and 2/N for a reason about the window
rather than the specimen. Equal bead counts per plane, so the slab is uniform in
z before rasterizing.

**The headline is an invariant you can drag, and it holds in every printed
digit.** On the DIN 4× at 27 planes, scrubbing the focus from the middle of the
stack to its far edge changes the picture completely and leaves
`total light 9.31425579640` and `in focus 0.037735849` **unmoved** — not
approximately, but in all twelve and nine digits shown. Beside them the identity
that explains it: the image's in-focus share equals the *specimen's own emitted
share* of the same plane to ~1e-16, measured for every objective in the
catalogue. That is § 6k.2's "the in-focus fraction belongs to the specimen"
arriving as something a reader does rather than reads.

**This doc's `relativeThroughput` readout had to be replaced, and the reason is
the trap the engine was built around.** `renderVolume` does not return it —
`depthKernels` does — and reading it off the render's own kernels would have
meant re-deriving from values normalized to sum 1, which report the identity by
arithmetic. What the panel prints instead is each plane's **delivered flux ÷ its
own emitters**, constant across the slab to ~1e-14 (measured 7.8e-15 to 2.2e-14
over the catalogue). Same statement, read from the light rather than from the
normalizer.

**The new finding: the defocus axis has a lattice period, and it sets the
stack's window.** The pupil is point-sampled, so the phase a defocus puts between
two points separated by ν takes only the values 4·w·ν·k/`pupilSamples`, and the
axial transfer at ν is therefore **exactly periodic in w₂₀ with period
P(ν) = pupilSamples/(4·ν)** — verified to 1e-14 at six (pupilSamples, ν) pairs.
§ 6k.4's own stack runs to ±8 waves at 32 bins, which is *two* periods at ν = 1
and three at ν = 1.5, so the DFT of that sequence is a **comb**: nonzero only at
every second or third bin. The rung is unaffected — it reads the edge off the
envelope with a 2% threshold, and the envelope is right — but the first version
of this plot drew the comb, a picket fence oscillating between 0 and 1 that is a
drawing of the lattice rather than of the transfer. **Found by looking at the
curve, not by the headless suite**, and the same shape of problem as A3's
undersampled defocus lobes. The window is therefore *derived*: it must not exceed
one period at the highest ν drawn. At 64 bins and ν = 1.5 that is 10.67 waves, so
±4 clears it — and the bin it gives, 1/8, represents every edge the law predicts
(0.75, 1.00, 0.75) **exactly**, so the check on screen is an equality rather than
a rounding. The curve's second difference falls 1.375 → 0.086.

**The second finding: on a traced pupil the axial peak is not at w₂₀ = 0, and
where it sits is a reading of A1's σ.** A1 reports the wavefront as traced, about
the system's *own* image plane with no best-focus solve, and its caption says a
red number means "not at this focus" rather than "not correctable" — a claim that
panel cannot check. The axial response measures it: a residual defocus moves the
peak, and the defocus it takes to get there carries σ = |w|/(2√3) of its own.
Measured, for the three rows whose traced σ exceeds λ/14, that is **90%, 92% and
100%** of it — DIN 4×/0.10 peaks 0.438 waves away and is **1.79× brighter
there**, oil 100×/1.25 0.156 waves and 1.10×, oil 100×/1.40 0.281 waves and
1.27×. Their red is focus and almost nothing else. The well-corrected rows sit
one sweep step (0.031 waves) from zero, which is a bound rather than a
measurement, and the caption says so where it happens rather than quoting a share
computed from a quantized offset.

**The missing cone is measured on the traced pupil**, deliberately: the ν = 0
null is a statement about `relativeThroughput` alone, so it holds for any pupil
whose amplitude does not vary with depth. Measured **1.2e-15 to 2.3e-15** across
the catalogue. Showing it only on `idealPupil` would have left open the one thing
a reader would ask.

**The frame has a depth as well as a width, and the depth runs out faster** —
A1's constraint 1 with the axial direction added, and free off `depthOfFocusMm`.
The lateral crop falls as 1/NA and the depth of focus as n/NA², so at 4×/0.10
nine planes is **529 µm** of specimen (thicker than any real slide) while at
100×/1.40 it is **4.1 µm**, about one cell. The immersion rows are where a
z-stack means something, and their object medium is read off
`system.prescription.objectMedium` rather than assumed: it is the **cover glass**
(D263, n = 1.5233), not the oil, because § 6e puts the specimen under the slip.
Passing `renderVolume` the default index of 1 would have put every immersion
depth out by that factor.

**Guards — two of them, and they answer different questions.** The picture's is
`maxGridPhaseStepWaves` over its slices; the cone stack's is its own, and the two
are shown separately for the reason A3 keeps its plot's ν sampling apart from its
image's pupil sampling. The picture's is genuinely reachable and A3's
walk-into-the-wall posture is kept rather than A2's clamp — nothing throws here,
so a fence would hide the lesson. At 27 planes on the DIN 4× it reads **0.9486**
red, and beside it the concrete symptom: the worst plane is 6.50 waves out and
its kernel puts **26.7%** of its light outside the frame's inscribed circle. A
lattice-sampled pupil has a *periodic* kernel, so those tails fold back in and the
frame fills with a false uniform glow — which is exactly what the picture shows,
so the guard names something visible rather than something abstract. **Raising the
grid does not help** (measured identical at 128 and 256, because the kernel scales
with it); only `pupilSamples` does. And **focusing at an end of the stack doubles
the worst plane's defocus**, so the guard moves while the focus slider does even
though the physics does not — 0.9486 → 1.4127 at 27 planes.

**Cost, and it is NOT live everywhere** — the first draft of this section said it
was, which is a claim over the whole control space rather than over what was
measured. Node figures (dev build, DIN 4×, 8 beads per plane), with the browser
running ~2.5× them where both were taken:

| picture | 5 planes | 9 | 17 | 27 |
|---|---|---|---|---|
| ps 32 / grid 128 | 27 ms | 46 ms | 86 ms | 129 ms |
| ps 64 / grid 128 | 47 ms | 84 ms | 162 ms | 262 ms |
| ps 64 / grid 256 | 117 ms | 191 ms | 447 ms | 713 ms |
| ps 128 / grid 256 | 241 ms | 420 ms | 856 ms | 1357 ms |

Against § 2's 800 ms line that is **live at ps 32 and at ps 64 / grid 128 at
every plane count** — the defaults, and 27 planes there measured 332 ms in the
browser — and **compute-once at grid 256 with many planes**, where ps 128 / 27
planes projects past 3 s. Backpressure covers a drag there rather than making it
pleasant, and the panel prints its own elapsed time. The axial job is
**518–545 ms** in node and **~1.2 s** in the browser, A4's ratio again, hence its
own worker and A4's withdraw-while-stale rule. This doc's
"198 ms at 41 slices" was a node figure with pre-made fields and no rasterizing;
rasterizing the whole slab measures **1–3 ms** against 130–700 ms of rendering,
so the memoization that looked worth having is not — it would save under 1% and
have to be invalidated on six controls.

**A departure worth naming: the two plots run at different samplings**, each
derived from what it needs. The cone stack wants a lattice period longer than its
window (64 bins). The response sweep wants w₂₀ resolution and is **indifferent to
the grid** — it reads one number per kernel, the DC pixel, which is |Σ P|² over
the pupil lattice divided by a normalization defocus cannot move, so the whole
curve at grid 64 matches grid 128 to **1e-14**. It therefore runs on the smallest
grid a 32-bin pupil fits and spends what it saves on 1/32-wave steps. The peak
position is identical at 32 and 64 bins for every objective.

**Deliberately absent, and stated on the page:** depth-dependent spherical
aberration (§ 6l — `DepthPupils` is the hook and this panel passes phase only, so
the stack is symmetric about focus in a way a real one is not); any field
decomposition (`renderVolume` takes one pupil keyed on *depth*, so the frame is
imaged through the on-axis pupil and A4's corner-versus-axis comparison has no
analogue); and `hazeKernel`, which is exact only for a z-uniform specimen — a
bead field is not one, and § 6k.6's whole content is that over z the sum does not
factor.

**No engine capability was added, so no validation rung was.** Everything here is
§ 6k's, called from the app.

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
| ~~Stained tissue / diatom fields~~ | ~~§ 6h's warped-grid rasterizer, not built.~~ **Unblocked at § 6n** — `rasterizeSpecimen` places an extended specimen through the traced map. What remains is authoring a scene, which is content rather than a blocker. |
| Depth-dependent spherical aberration in the z-slider | § 6l — the physics is in § 6c/§ 6e but wiring focal depth into the stack is its own step with its own rungs. `DepthPupils` is the hook. Unchanged, and independent of Part D. |
| Confocal / deconvolution | the excitation path (§ 6j open) — a detection pinhole and an excitation PSF. |
| Polychromatic brightfield / fluorescence colour | § 6f and § 6i both name it open. § 6j's band is emission-only. **Scoped as § 6r in Part D.** |
| A live "real field of view" brightfield frame | constraint 1. Not a UI problem and not solvable by resampling — and that stands. **What Part D adds is that it is reachable by tiling rather than by widening**, which is a different operation with its own error, now measured and composed: § 6m–§ 6o, compute-once, never live at a full field. § 6o pins the crop error of a tile to a closed form and § 6o.7 composes them. |

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

## Part D — the microscope you can look through

Parts A–C close the gap between what the engine can do and what the app draws.
This part is different in kind: it closes the gap between what the app draws and
what a **microscope** is. Today you can select one of ten objectives and watch it
form an image; you cannot build one, change its glass, put a slide under it, look
through an eyepiece, or see anything wider than a detail crop, in colour.

The priority is the last of those, and it is the one that looked impossible.
Everything below the first section is ordered behind it.

### D0. The three feasibility measurements this part rests on

Same status as § 2's timings and stated the same way: **single runs under vitest,
no warmup, on an ideal pupil unless said otherwise.** Good for the
order-of-magnitude calls they are used for here, and *not* pinned numbers — the
rungs that would pin them are named with each step.

**1. One Abbe tile, against `pupilSamples`** (S = 0.5, 97-point condenser, grid
held at 4 px per resolution cell, so every row images the same specimen at the
same scale and only the *span* changes):

| tile | span at NA 0.10 | cost | per unit area |
|---|---|---|---|
| ps 32 / grid 128 | 94 µm | 76 ms | 8.6e-3 ms/µm² |
| ps 64 / grid 256 | 188 µm | 508 ms | 1.4e-2 |
| ps 128 / grid 512 | 376 µm | 6 232 ms | 4.4e-2 |
| ps 256 / grid 1024 | 752 µm | 26 621 ms | 4.7e-2 |

> **⚠️ Corrected by D4/§ 6o.8: this table times the Abbe sum, and on a *traced*
> tile that is no longer the bill.** Every figure above is an ideal pupil's
> imaging cost. Rendering a real tile also runs § 6n's warped rasterizer, which
> bisects a traced chief ray **per pixel** to mantissa exhaustion, and with § 6p's
> cache in place that is now the larger half: at grid 128 / ps 32 the raster is
> **1 001 ms** against 180 ms of Abbe sum, and at grid 64 / ps 32 it is 292 ms
> against 61 ms. So the tile size a stage can afford is set by the *rasterizer*
> and the sensible sampling is 2 px per resolution cell, not the 4 px this table
> holds. The row structure and the per-unit-area conclusion below stand; the
> absolute cost of a traced tile is ~5× what a reader would take from them.
>
> This is the fourth time the pattern below has repeated, and it is the same one:
> the feasibility number turned out to be measuring something else. § 6n *named*
> this cost and deferred the fix to § 6p, which then landed as the pupil cache;
> the radial map cache is still open and is now the dominant term.

The right-hand column is the one that decides the design: **cost per unit of
specimen rises with tile size**, and the ps 64 → 128 step is 12.3× where N²·log N
predicts ~4.3×. That gap is presumably the working set leaving cache (a 512²
f64 grid is 2 MB and `abbeImage` holds five of them) and it is not chased here,
because the decision it feeds is only *"do not build the mosaic out of giant
tiles"*, which it settles either way.

**2. The guard band — and it is not what the coherence argument predicted.**

A tile hard-crops the specimen, which deletes the cross terms between points
inside and outside the crop; § 6g's factorization gives that error as
(1 − C)·|cross term| with the cross term ∝ μ(Δ), and μ dies past the coherence
width 0.61λ/NA_cond. That reasoning says the guard band is a coherence width and
therefore **diverges as the diaphragm closes**. It is wrong, and the measurement
is what says so.

Lattice held fixed — one `pupilSamples`, one grid, one pupil sampling — with two
specimens identical inside a window and differing outside it, compared over the
central 128 px. The only thing that varies is how far out the specimen is the
true one. The two surrounds are **permutations of one multiset**, so the objects
carry identical total transmittance; without that, T(0) reaches every pixel
through the pupil at every source point and lays a floor of the probe's own
making across the whole table. Errors below are rms relative, and each was also
computed after normalizing both images by their own mean — the two agree to four
digits, which is what says the DC control worked:

| guard (cells) | S = 0.25 | S = 0.5 | S = 1.0 |
|---|---|---|---|
| 0 | 1.06e-1 | 8.8e-2 | 6.1e-2 |
| 8 | 6.4e-3 | 7.0e-3 | 7.7e-3 |
| 16 | 6.1e-3 | 5.9e-3 | 6.1e-3 |
| 24 | 5.0e-3 | 4.5e-3 | 5.0e-3 |
| 32 | 4.2e-3 | 4.0e-3 | 3.8e-3 |

(Δ_coh is 4.88, 2.44 and 1.22 cells at the three S, so those same guards span
**1.6 to 26.2 coherence widths** across the table.)

**The first row is the whole result: a guard of 8 cells removes 88–94% of the
error at every S.** After that the curve goes slowly — roughly guard^−0.3 — and
that flatness is exactly why the *variable* has to be read off the diagonals
rather than off the near-constant tail:

- along a **constant guard in cells**, the three S spread by 1.20× at guard 8 and
  1.10× at guard 32, non-monotone;
- along a **constant guard in coherence widths** (S = 0.25 at 32 cells, S = 0.5
  at 16, S = 1.0 at 8 — all ≈ 6.56 Δ_coh), they spread by **1.83× and
  monotonically in S**.

So cells is the better variable and μ is not the one, but this is a 1.8-against-1.2
discrimination and it is stated as that rather than as a collapse. It agrees with
the physics stated directly, which is the stronger of the two arguments: a
coherent image is the object amplitude convolved with h, and I = Σ_s w_s|∫t·h_s|²
weights every object point's contribution by |h| whatever the source does. **μ
weights the cross terms; it does not extend them.** Three consequences:

- **The guard does not grow as the diaphragm closes**, over the range measured
  (S = 1 → 0.25). The near-coherent setting — brightfield's most interesting one
  — is not a special case, where the coherence-width argument said it would be
  the worst one. S = 0 itself is not measured and is not claimed.
- **It is small.** The first 8 cells buy 8–16×; the next 24 buy 1.5×. What is
  left is h's algebraic tail, so **there is no guard band that makes a tile
  exact** and the honest deliverable is a bound, not a limit.
- The floor is ~4e-3 rms and ~2–3% worst pixel. That is fine for a picture and it
  is **not** fine for a rung pinned to a closed form, so § 6o's rungs are written
  against the bound and its convergence, never against an equality.

**One hypothesis was raised against this table and measured down, which is worth
recording because it would have invalidated the step.** The plateau looks like a
probe artifact — two independently drawn surrounds differ in total transmittance
by ~1/√N, and the DC term lands on every pixel — and the predicted magnitude
(~6e-3) and W-scaling (1.46 against a measured 1.44) both matched. They matched a
mechanism that is not there: with the multiset balanced and the means divided
out, the floor did not move (4.20e-3 against 4.15e-3 at S = 0.25, guard 32). The
first table in this section was drawn without that control and it should not have
been; the numbers above are the controlled run.

> **⚠️ Corrected by § 6o. Two of the three consequences above did not survive
> being pinned**, and the paragraph immediately above turns out to have been
> right to look for a probe artifact and wrong about which one.
>
> - **The plateau IS an artifact — it is the condenser's own quadrature.** At the
>   same guard, the same specimen and the same lattice, taking the condenser from
>   this section's 97 points to 749 drops the guard-16 error **7.1×**. The flat
>   guard^(−0.3) tail appears *only* at the coarse sampling: slopes −0.21 and
>   −0.36 at 97 points against −1.31 and −1.55 at 749. So "what is left is h's
>   algebraic tail" was reading the source sum's residual arriving from
>   underneath. The control that makes this a measurement rather than an
>   inference is that a **coherent** source has one point, so its curve cannot
>   move under refinement — and it does not.
> - **The guard DOES grow as the diaphragm closes.** This section was careful to
>   say S = 0 was not measured and not claimed, and that caution was warranted:
>   the coherent limit is worse than a filled condenser by 22.9, 42.0 and 84.8×
>   at guards 4, 8 and 16 — one factor of two per doubling. The S = 1 → 0.25
>   plateau stands as measured; reading it as an S-independent law does not.
> - **What survives, and is stronger than a bound:** under a coherent source the
>   crop error falls as **guard^(−1/2)**, which is the tail integral ∫|h|² of the
>   Airy amplitude and has no free coefficient. "There is no guard band that
>   makes a tile exact" is therefore *more* true than this section claimed — it
>   is a closed form rather than an observation. It is pinned as a **bracket**:
>   consecutive slopes straddle −1/2 by 13% and 6.6%, since the probe's own
>   window and finite surround pull the exponent either side of it.
>
> § 6o in VALIDATION.md carries all 28 rungs, and the revival hypothesis it
> raised and measured down in turn.

**3. The traced-pupil multiplier is the real cost, and the fix is named but not
built.** § 2 pins traced/ideal at a flat 8–10×, linear in source points, because
`pupilFunctionFromOpd`'s callback is re-evaluated per source point per lattice
point. § 6i's `latticeMatchedSource` is already the *exactness precondition* for
caching that — a source lattice stepping by the pupil's own frequency step means
every shifted pupil reads the same coordinates — but it fixes the sample count at
S·`pupilSamples` **across**, which is 3 217 points at S = 0.5 and ps = 128 where a
picture needs ~100. The construct the mosaic wants is the generalization:
spacing an **integer multiple** m of the pupil step, count S·ps/m — commensurate
and coarse at once. That, plus a cached pupil pass in `abbeImage`, is § 6p, and
it is the difference between a traced full field in minutes and one in hours.

> **Built, and this paragraph's premise is corrected** — § 6p in VALIDATION.md.
> The construct and the cache both exist and the multiplier is gone: 10.76× on
> the DIN 4×/0.10's traced pupils at 208 directions, with the saving pinned as an
> exact integer (`pupilEvaluations` falls by exactly `contributingPoints`) rather
> than a wall clock. But **"commensurate *and* coarse" does not survive § 6f.2.**
> At S = 0.5 and ps = 64, multiples 1, 2, 4, 8 read 4.56e-3, 1.78e-2, 3.38e-2,
> 1.34e-1 on that step's own metric, and multiple 4 — 52 points — is already past
> where its "a coarse source is wrong by enough to notice" rung fires. The ~100
> points this paragraph wanted are not a converged condenser, and m is not the
> knob that gets you there. **`pupilSamples` is:** `commensurateSource(0.5, 128,
> 2)` and `commensurateSource(0.5, 64, 1)` are the same 812 points, exactly, so
> raising the scale moves the allowed ladder without coarsening it. What made the
> count affordable was never the commensurability — it is the cache.

**What the three together say.** A 4× objective's real field is ~5 mm, 19.6 mm²
of specimen. At ps 128 tiles with an 8-cell guard the useful span is 329 µm, so
the whole field is **~181 tiles**. At the 4 px per resolution cell the table
above was measured at, that is 6.2 s a tile ideal and ~50–62 s traced:
**2.5–3.1 hours single-threaded, ~20–25 min across eight workers.** Dropping to
2 px/cell is 4× cheaper and would put it near 40 min single-threaded — but A4
measured the bilinear splat outweighing the optics below ~3 px/cell (19.1% peak
spread at 2.01), and § 6n's rasterizer splats too, so **that sampling is not
available for free** and what it costs an *extended* specimen is a measurement
§ 6n owes rather than an assumption this section may make. Quote the 4 px/cell
figure until it exists.

§ 6p is what moves this: the traced multiplier is 8–10× of a cost that is
otherwise minutes.

And the number that actually decides the design is none of those — **a viewport
holds tens of tiles, not 181.** Panning is seconds even at the pessimistic
figure. That is the whole argument for D4: **not a bigger frame, a tiled
stage**, rendered where you are looking.

### D1. § 6m — the off-axis frame — *engine step* — ✅ **landed**

`objectFieldFrame` was centred on the axis and every consumer assumed it.
`objectFieldTile(system, {centreMm, …})` is the same construction about an
arbitrary field position, and it was as small as scoped: `centreMm` folded into
`ObjectFieldFrame`, `imagePointAt` gained an offset, and the inverse map, the
azimuth, the rotation and `scaleDrift` all work unchanged because they read the
**absolute** image point.

The rungs landed as scoped — a tile at the origin reproduces `objectFieldFrame`
bitwise (and so does the image it renders); a tile's centre pupil is the parent
frame's pupil there, bitwise; two tiles naming one image point return one object
point, in the last bit. § 6m in VALIDATION.md carries all 21.

**Three things this section did not predict**, recorded because the closing
paragraph of Part D predicted that D4 would need something D0 did not measure and
D1 got there first:

- **Registration is bitwise for a different reason than the design assumed.** The
  guess was that it holds because every tile seeds the inverse's bracket with the
  same on-axis magnification. It does not depend on the seed at all — the
  bisection runs to mantissa exhaustion, so six seeds over 10⁷ agree in the last
  bit. That is a freedom rather than a constraint, and it is why `magnification`
  can stay the on-axis reference every tile needs it to be.
- **The ruler's trade is a closed form, and the tile's own ruler is not always
  better.** The reference sphere is hypot(R_axis, r), so the tile's own drift is
  h_e(r+h_e)/R² against the axial ruler's r²/2R², crossing at (1+√3)·h_e. Below
  three half-extents off axis the departure from § 6h's one-ruler rule *loses*
  (0.73× at 0.4 mm); past it, it wins by r/2h_e — 16.6× at 6.4 mm.
- **An off-axis tile is anisotropic**, its radial and tangential scales departing
  from the linear reference in the ratio 3 — the derivative of § 6h.1's cubic,
  with no free coefficient. 33 ppm out of square at 0.8 mm: too small to see and
  impossible for one per-tile scale to carry, which is **D2's argument, now with
  a number**.

And one that D3 and D4 both want: **a mosaic's pitch is not its tile span.** Each
tile's extent is read on its own ruler, so abutment is a fixed point — it
converges in three iterations, and a uniform axial pitch is 1.2e-3 of a pixel out
at 1.6 mm, so D3 may skip the solve and say so. **D3 took the licence and § 6o.6
is the "say so"**: `mosaicPitchDriftPx` measures 1.3e-2 of a pixel across 17
tiles, by which point the outer one is 2.24 mm off axis. `"abutting"` is
implemented anyway, because a drift is only meaningful against what it drifts
from.

### D2. § 6n — the warped-grid rasterizer — *engine step* — ✅ **landed**

§ 6h's named deferral, and the mosaic is what finally forced it: distortion was
carried in the pupil *assignment* while each patch's image was formed on the
undistorted grid, which is invisible on one on-axis frame and becomes a **visible
seam misregistration** the moment two tiles meet off axis. `objectPointAt` was
the seam § 6h left for exactly this, and `imaging/specimen` attaches to it: a
`Specimen` is a callback in object millimetres, so the warp happens in the
*argument* and nothing is resampled — `rotatePupil`'s own argument, one layer
further out. It produces the `ObjectField` `abbeImage` already consumes, so this
is the **authoring** path and nothing downstream learns the grid was warped.
**Stained tissue and diatom fields are unblocked**, which the disqualified table
above blocked on precisely this rasterizer.

**Two things this section got wrong**, recorded rather than quietly fixed:

- **The bow is not the cubic.** D2 scoped the first rung as "bows by the amount
  § 6h.1 already pins (cubic, ×8.00 per doubling)". A chord's sagitta is the
  map's **curvature** across it, and d²/dr² of a cubic is linear — so the bow
  grows **×2.00** per doubling of field (2.0003, 2.0002, 2.0004, 2.0014 over
  0.4 → 6.4 mm). Asserting ×8.00 would have been quoting the right theory at the
  wrong derivative. The three steps now form one ladder off a single coefficient:
  § 6h.1 the cubic, § 6m.4 its slope, § 6n its curvature.
- **The round trip as scoped pins nothing.** "Rasterized through the warped map
  and read back through the inverse returns its own coordinates" is true by
  construction — `objectHeightForImageRadius` already self-checks its residual to
  1e-9. The rung that has content goes through **pixel indexing** instead: a bump
  placed at the object point a pixel looks at, rasterized, and recovered by
  centroid, which is what catches the half-pixel and |M|-vs-signed-M class of bug.
  The convention is additionally pinned **bitwise** against § 6i's
  `rasterizeEmitters` — whole flux, one pixel, 1.000 to 12 places.

The negative control turned out stronger than "fails at the field where § 6h.1
says it should": a uniform per-tile scale is linear, so its sagitta is
`toBe(0)` at **every** field — it cannot express the law rather than
approximating it badly. Quantitatively it misses by the map's *slope* where the
traced map misses by its *curvature*, so the gap doubles with field, 16.8× at
0.4 mm to 257× at 6.4 mm — the seam error is unbounded in the field, not a
constant a tolerance could have absorbed. § 6n in VALIDATION.md carries all 18
tests of `specimen.test.ts`, including the one this section did not ask for and
should have: **the warped specimen actually rendered.** § 6n.5 puts a bar grating
through `renderBrightfield` on a traced 4×/0.10 — it rules `valid`, survives
`requireHonest`, and the two maps' pictures differ by 2.8e-3 of peak at 6.4 mm
against 1.5e-6 on axis. Without it, "a visible seam misregistration" stayed an
argument, and every sibling step (§ 6f, § 6g.3, § 6h.5) closes on a composed
objective for exactly that reason.

**Cost, and why the cache is not here.** One bisected chief ray per pixel —
0.12 ms, so 0.5 s at 64² and ~2 s at 128², the same order as the sum it feeds
(a `patches` = 2, five-point-source `renderBrightfield` on the same frame is
0.33 s). Affordable for a tile, not for a mosaic of tens, which is D5's job: the
radial cache is kept out of § 6n deliberately, because these rungs pin the *map*
and an interpolant underneath them would mean they pinned the interpolant.

**Deferred, and named:** an extended *fluorescent* specimen. An emitter density
is not a point property — warping one needs det J, where an amplitude
transmittance needs nothing — and it is the one place in this branch where an
energy check genuinely *is* the witness.

### D3. § 6o — the mosaic and its guard band — *engine step* — ✅ **landed**

`mosaicLayout` places the tiles and says how much of each survives the crop;
`renderMosaic` rasterizes, images and composes them. Nothing is blended across a
seam and nothing is resampled — a tile's kept pixels are its own — which is what
makes a seam error a **step** rather than a smear. The guard band is free of
machinery for § 6n's reason: a `Specimen` is a callback, so what crops is the
*grid*, and the guard is simply grid that gets thrown away.

**The rungs are not the ones this section scoped, and that is the finding.** D3
planned to write everything against a bound, "because D0.2 says an equality is
not available". An equality *is* available, in the limit D0.2 declined to
measure: under a **coherent** source the crop error falls as **guard^(−1/2)** —
the tail integral ∫|h|² = 2π/d of the Airy amplitude, no coefficient, nothing
fitted. The measured slopes −0.435 and −0.533 **straddle** it by 13% and 6.6%
— bracketed rather than converged, because the window's own width dilutes the
slope at small guard and the probe's finite surround steepens it at large guard,
and the rung pins the bracket because that is what the numbers show. `coherentSource()` is one point, so the source sum is exact and the
residual is provably the crop's and nothing else. That rung costs 11 ms a render.

**And the diagonal-against-row rung was dropped rather than reproduced**, because
what it measures is not the crop. The 1.83-against-1.20 discrimination
reproduces qualitatively at a different lattice (2.18 against ≤1.50, stable
across four seed sets) — but D0.2's whole table sits on a ~4e-3 floor that is the
**condenser's own quadrature**, and a comparison of spreads on top of that floor
is a comparison of quadrature residuals. Refining the source alone, at the same
guard and lattice, drops the guard-16 error 7.1×. See the correction box in D0.2.

Three consequences this step owns:

- **The guard is not S-independent**, and the coherent limit is the worst case by
  a factor that *doubles with the guard*: 22.9, 42.0, 84.8 at guards 4, 8, 16. So
  the two illuminations' exponents differ by exactly 1, and the coherence-width
  argument D0.2 rejected was right about the *direction* even though it was wrong
  about the magnitude over S = 1 → 0.25.
- ~~**§ 6p is not only a speed step — it lowers the mosaic's error floor.**~~ The
  same 749 points that are converged at S = 0.25 are not at S = 1, where
  `diskSource` spaces them four times wider, and the witness is that the guard
  curve goes flat at 2.9e-3 instead of continuing down. **That much stands; the
  conclusion drawn from it does not.** § 6p measured it: a commensurate source
  *is* `diskSource`'s lattice (pinned bitwise), so nothing about the image can
  depend on the commensurability, and 812 commensurate points at S = 1 reproduce
  the plateau slightly *worse* than the 749. What un-flattens the curve is
  **3 228 points**, and § 6p's contribution is that 3 228 *traced* directions
  became affordable. The floor is the point count; § 6p changes its price.
- **The pitch question is closed as D1 licensed.** Uniform pitch is 1.3e-2 of a
  pixel from the abutment fixed point across 17 tiles (2.24 mm off axis), so the
  solve is skipped and `mosaicPitchDriftPx` is what says so. `"abutting"` is
  implemented anyway, because a drift is only meaningful against what it drifts
  from.

**The seam needed a reference D3 had not named.** A raw column difference is not
the seam's error — the two sides sample different object points — and a wider
reference frame is exactly what § 6h.2 forbids. The reference is a **third tile
centred on the seam**, § 6n.2's "two readings of one number" move: on a traced
4×/0.10 at 1.6 mm the step falls 1.768e-2 → 7.81e-4 of peak as the guard goes
0 → 8 cells, and with no guard the error is *localized* at the seam, 90× its
neighbour three pixels away — the shape a viewer reads as a grid line.

**Deliberately not attempted:** a mosaic under a *non-telecentric* condenser.
§ 6h assumes the illumination cone stays centred at every field point, which is
§ 6a's object-space ray-aiming blocker arriving where it finally bites. A real
condenser's cone tilts off axis, `shiftPupil` is already the operator that would
do it, and it is its own step.

### D4. A7 — the stage: a brightfield field of view you can pan — *app* — ✅ **landed**

**Landed as `panels/stage.tsx` + `stage.ts` + a pool of `stage.worker.ts`**, and
it needed one engine addition after all — § 6o.8, below. Everything this section
asked for is on screen: the span against the field number, the guard *with* S and
the source count, the worst tile's verdict, tiles-and-elapsed, and a centre-first
queue. What it cost, measured on the DIN 4×/0.10 at ps 32 / grid 64 with a
208-direction commensurate condenser: **~300 ms a tile, 36 tiles in 3.3 s** across
three workers, and a pan that crosses no tile boundary renders **nothing**.

**Three things this section did not anticipate**, in the doc's own tradition of
recording them:

1. **It is an engine step, slightly.** A stage renders tiles singly, out of order,
   and caches them across pans — none of which `renderMosaic` could do, since it
   only ever composed a whole finite picture. `renderMosaicTile` and
   `mosaicTileAt` are the two additions, with eight rungs in § 6o.8. The load-bearing
   one is that a tile's identity is its **index from the anchor**: re-anchoring on
   the viewport costs 3.4e-3 px of ruler drift on a tile centre but **16.0 px** of
   lattice offset a third of a tile off it.
2. **D0.1's cost model was measuring the wrong half** — see the correction there.
   The rasterizer, not the Abbe sum, is what a traced tile costs.
3. **A fixed white is forced.** Every other panel puts mid-grey at its own frame's
   mean; here that would give each tile its own brightness and paint a grid of
   seams the physics does not have. `abbeImage` normalizes the source weights to
   Σ = 1, so a clear field is intensity 1 whatever the condenser does, and the
   whole plane shares one reference.

The original scope follows, unchanged.

**The priority surface, and the first thing in this repo that looks like a
microscope rather than an experiment.** A tiled, pannable, zoomable view over a
specimen that is larger than one frame: tiles render into a cache as the viewport
reaches them, in workers, and the panel draws what it has.

What it must carry on screen, because every other panel established the rule:

- **Its own span, and what fraction of the real field number it is.** A1 made
  `objectSpanUm` the thing a microscope frame is labelled with; a stage that
  covered 1.2 mm of a 5 mm field and did not say so would be the "view through
  the eyepiece" claim this doc has refused four times.
- **The guard band's own bound**, as a live readout with the guard it was rendered
  at. It is never zero, and § 6o sharpened what the readout has to say: the bound
  depends on **S and on the condenser's sampling**, not on the guard alone, so a
  stage that printed one number for a guard would be printing a third of the
  answer. The guard, S and the source point count all belong on screen — and at
  small S the honest number is much larger than D0.2's floor suggested.
- Tiles still rendering, and the elapsed time, exactly as A1–A5 print theirs.
- **A live centre tile.** § 2's ~800 ms line has not moved: one tile at ps 32–64
  is live and the full field is not, so the panel is live where you are looking
  and compute-once everywhere else. That is the same coarse-to-fine posture
  `renderFieldScene` has, arriving on a different axis.

**Deliberately not offered:** a live full-field drag. D0.1 measures why, the
disqualified table already said so, and a control that quietly took 40 minutes
would be worse than one that is absent.

### D5. § 6p — the commensurate condenser and the cached pupil — ✅ **done**

The construct and the cache from D0.3. What makes A7 fast rather than possible.

**Rungs:** cached ≡ uncached **bit for bit** on a commensurate source (it is the
same arithmetic in a different order, so anything looser would be hiding a bug);
the constructor refuses a non-commensurate (S, ps, m) rather than rounding, on
`latticeMatchedSource`'s own argument that a rounded lattice produces a
perfectly plausible image whose disagreement looks like physics; and the source
sampling that results still clears § 6f.2's convergence, which is not automatic —
commensurability constrains the count, and the counts it allows are not the
counts § 6f.2 was measured at.

**All three landed, and the third one bit.** `commensurateSource` and the
call-local pupil cache are in `illumination/source` and `illumination/abbe`, with
19 rungs in VALIDATION.md § 6p. The bitwise rung needed a precondition this
section did not anticipate — it is *arithmetic*, not just algebraic, so
`pupilSamples` must be a power of two and a non-dyadic one is refused rather than
tolerated. The saving is pinned as an exact integer (`pupilEvaluations` falls by
exactly `contributingPoints`), and the wall clock is reported beside it as a
measurement: **10.76× at 208 traced directions, and no saving at all on an ideal
pupil**, which is the honest scope of the step.

**Two corrections came out of the third rung**, and they are the reason it was
worth asking rather than ticking:

- **D0.3's "commensurate *and* coarse" premise fails** — see the note there. The
  usable knob is `pupilSamples`, not `stepMultiple`.
- **This section's own "what makes A7 fast" is right, and § 6o's "it also lowers
  the mosaic's error floor" is wrong.** Commensurability is accuracy-neutral: a
  commensurate source is `diskSource`'s lattice, bitwise. The floor is the point
  count, and § 6p changes what count a traced pupil can afford.

**What A7 should ask for:** `commensurateSource(S, pupilSamples, 1)` at the
`pupilSamples` the tile is already rendered at — i.e. `latticeMatchedSource`,
which is now affordable rather than theoretical.

### D6. § 6q — the eyepiece on the intermediate image — *engine step*

`afocalTelescope` solves its group spacing from a ray entering **collimated** —
an object at infinity. A microscope eyepiece collimates from a *finite*
intermediate image, so the solve is different, and `visualSystem` inherits the
assumption through it. This is the blocker behind "you cannot look through it",
and it is an engine step rather than app wiring for that reason.

`plosslEyepiece`, `huygensEyepiece`, `reducedEye`, `visualSystem`,
`afocalProperties` and `apertureStop: "limiting"` all compose unchanged once the
spacing solve exists.

**Rungs:** total magnification M_obj × (250/f_e) against the stated near-point
convention — spelled out the way § 6a spells out the 200/180/165 tube lengths,
because 250 mm is a convention and not a law, and every rung is a ratio against
whichever value is passed in; the exit pupil at D_obj/M_total and § 5p's
two-stop collapse when the eye's iris is the narrower; **empty magnification** —
the M past which the exit pupil is smaller than the eye can use and the image
gets bigger without getting better, which is the microscope's own version of a
result this engine can state rather than assert; the **field number** as what
actually sets the visible circle; and eye relief.

**What it buys A7:** the circular field stop, an honest angular scale, and the
readout that says whether the magnification on screen is doing any work.

### D7. § 6r — polychromatic brightfield — *engine step*

§ 6f names it open, and it is what makes a stained section look stained.
`wave/polychromatic` already stacks on a common physical grid and § 3a's CIE path
already exists; what is new is that the Abbe sum runs per wavelength with the
pupil re-traced, and that **the pupil lattice step is wavelength-dependent where
S is not** — S is a ratio of numerical apertures and needs no conversion
(`illumination/abbe`'s own note), but `pupilSamples` bins across the pupil is a
different physical frequency at each λ, so the per-λ images land on different
rulers and stacking them bin-for-bin would be § 2e's error committed again.

**Rungs:** a neutral specimen stays neutral through the whole path; a doublet
objective's axial colour shows as the focal shift § 6b's own design implies;
§ 3b's hero result — a singlet fringes and an achromat does not — reproduced in
the microscope branch, which is the strongest available check that the colour is
the optics and not the display.

### D8. A8 — the microscope builder — *app wiring only*

Independent of everything above, cheap, and the direct answer to *"can we compose
one and change its components?"* — today, no: `MICROSCOPE_CATALOG` is ten
hardcoded rows calling `din(4, 0.1)`, and the constructors' other parameters are
defaults nothing exposes.

A form over what the engine already takes: architecture (DIN / infinity),
magnification, NA, crown and flint, tube focal length or optical tube length,
coverslip thickness and index, objective orientation, infinity-space length,
Lister or immersion front. Then A1's readouts, unchanged, against whatever was
built.

**Its best feature is already built:** the engine refuses impossible objectives
with messages carrying measured numbers — § 6b's f/4.1 doublet ceiling, § 6d's
NA 0.343 wall, § 6c's slip solve — and A1 established that showing the engine's
own words *is* the handling. A builder is the surface where a reader walks into
those walls on purpose, which is worth more than three catalogue rows that exist
to fail.

**Cost:** ~50 ms a build (A1 measured it), so it is a form-submit cost, not a
drag cost. Sliders would need the same backpressure every other panel has.

### D9. What stays out, and why

- **A live full-field frame.** D0.1. Compute-once or nothing.
- **Non-telecentric illumination.** § 6a's object-space aiming blocker, named by
  D3 as its one deliberate omission and still open after § 6o landed.
- **Köhler illumination as a light budget.** `abbeImage` normalizes the source
  weights to Σ = 1, so closing the diaphragm costs resolution and no light where
  a real one goes dim — A2 already prints the mean so the normalization is not
  hidden. A field diaphragm and a real photometric budget are their own step, and
  the honest note stays on screen until then.
- **Confocal, deconvolution, DIC, phase contrast.** Unchanged: § 6j's excitation
  path and v2's Hopkins TCC.

### Order

**D8 first if the goal is breadth** — it is independent, app-only, and turns ten
rows into the whole design space.

**Otherwise, the priority path was ~~D1~~ → ~~D2~~ → ~~D3~~ → ~~D4~~, and it is
walked**: the off-axis frame, the rasterizer that registers it, the mosaic that
bounds its error and the stage that draws it have all **landed**. **D5** landed
alongside and makes it fast — though *only* fast: § 6p measured down § 6o's belief
that it would also lower the mosaic's error floor. What is left in Part D is
**D6**, an eyepiece on it, and **D7**, colour; **D8** is still independent and
still the cheapest breadth in the doc. A6 and Part B are untouched by all of this
and can go at any point.

The one thing worth predicting, because this doc has been wrong in the same
direction five times: **D4 will need something D0 did not measure.** A3 needed a
plot sampling no rung had named, A4 needed a display convention two panels
disagreed with, A5 needed a lattice period no rung had had to state. A tiled
stage's version of that is most likely the seam — the place where the bound in
D0.2 stops being a number and becomes something a reader can see.

**The prediction was right and early.** D1 was scoped as an offset with four
identity rungs and it produced three things this section did not have: the ruler
crossover at (1+√3)·h_e, below which a tile is better off on the *axial* ruler;
the anisotropy that is D2's argument with a number attached; and a pitch that is
a fixed point rather than a span. None of them were the seam, and all of them
were in the part that looked like arithmetic.

**And D4 was predicted wrong in the usual direction.** It was scoped as *app*, and
it needed two engine functions and eight rungs (§ 6o.8) — a mosaic that pans is not
a mosaic that is drawn. The seam this section predicted D4 would trip over never
arrived, because D3 had already paid for it; what arrived instead was the *cost
model*, D0.1, measuring the wrong half of a tile. Which is the pattern named two
paragraphs down, on its fourth repetition.

**And D3 was where it stopped being cheap.** The seam did arrive, and it needed a
reference D3 had not named — a third tile centred on it, since a wider frame is
what § 6h.2 forbids. But the larger correction was underneath: D0.2's table, the
one every D3 rung was to be written against, sits on a floor that is the
**condenser's own quadrature** rather than the physics it was read as. The
pattern this doc keeps repeating is not "D4 will need a new measurement" — it is
**"the feasibility number will turn out to be measuring something else"**, which
is a different and more expensive failure, and the only defence is that a rung
has to be pinned to a closed form rather than to a previous measurement. § 6o's
guard^(−1/2) is that defence working: it survived precisely because it was not
anchored to D0.2's floor.

---

## What the app itself needs to hold this

Structural work implied by the above, independent of which surfaces land:

1. **A panel registry and routing.** ✅ **landed.** `App.tsx` went from 1 178
   lines to ~80: a nav row and one panel. `src/panels/registry.ts` is the
   routing table — `id` (the URL hash), nav label, one-line blurb, component —
   and `telescope.tsx` / `bench.tsx` / `brightfield.tsx` each own their controls
   and their state. A panel unmounts when you route away, which terminates its
   workers; the cost is a re-trace on return (~630 ms for the bench catalogue)
   and every panel already prints its own elapsed time.

   **The split found one constraint worth writing down.** Vite resolves
   `new Worker(new URL("./x.worker.ts", import.meta.url))` only for a *literal*,
   and it resolves it relative to the file the literal sits in — while `tsc`
   cannot check the string at all. So moving a worker factory into `panels/`
   silently produces a 404 and a panel that never paints, with a green
   typecheck. All three factories therefore live in one `src/`-level
   `workers.ts` and panels import them: **a file holding a worker URL literal
   lives in `src/`.** The same rule keeps `hooks.ts` there.

   The two `pupil samples` / `grid` pairs that motivated this **stayed
   separate**, and that is the fix rather than a shortfall: same engine
   parameters, different affordable range — the bench offers 32/64/128 against
   64/128/256 because it is one catalogue trace on a sampling change, where
   traced brightfield costs 8–10× per source point and would land seconds past
   its live line. Routing is what stops the two groups from being confusable.
   Sharing the state would have made one of the two panels lie about its cost.
2. **One adapter module per family, on `render.ts`'s pattern.** `microscope.ts`,
   `tolerance.ts` — pure functions, no DOM, so they drop into workers unchanged.
   This is the single commitment worth keeping from the current app; everything
   else there is disposable.
3. **Generalize the worker hooks.** ✅ **landed with A2** — `useRenderedStar`
   became `useLatestFromWorker<Req, Res>` and now serves the star panels and the
   brightfield render both, the worker factory passed in as a module-level
   constant so Vite still resolves the URL statically. The multi-frame shape
   (`useRenderedField`, releases on `done`) stays separate: it differs in one
   line and that line is load-bearing. Done because A2 was the point at which a
   third hand-copied copy would have been two too many, not as separate work.
4. **A shared guard-readout component.** ✅ **landed with A3** — `Guard` in
   `ui.tsx`, with `GuardLevel` (ok / warn / bad), `GUARD_COLOR`, `VERDICT_LEVEL`
   for § 6f.9's three-state verdict, and `thresholdLevel` for a number against a
   ceiling (warn at 80% of the way there, so a slider being walked into a wall
   says so before it hits it). What is shared is deliberately narrow: **the way a
   guard turns red**, not a panel's ordinary readouts, which stay its own because
   each says a different engine number in its own words.

   The rule attached to this item was that the next surface **extracts rather
   than copies**, and that is what made this more than an addition: A2's local
   `VERDICT_COLOR` moved out in the same change, and its fidelity line now
   renders through `Guard`. A shared component sitting beside a private copy
   would have made the problem worse rather than solved it.
5. **A shared plot primitive.** ✅ **landed with A2** — `packages/app/src/plot.tsx`,
   ~150 lines: linear axes, nice ticks, polylines, and straight-line markers,
   no dependency. Points are drawn as given; nothing is interpolated or fitted,
   because a smoothed curve through measured points is a drawing of a claim
   rather than the claim.

Note that `@telemicroscope/core/illumination` is already in the package's
`exports` map, so no packaging work is needed for the brightfield surfaces.

## Suggested order

**A1 ✅ → A2 ✅ → A3 ✅ → A4 ✅ → A5 ✅** landed the microscope branch's headline results
with one substrate and two panel kinds. A3 was predicted to be "A2's panel with
`phaseGratingObject` in place of the cosine one", and the shape of that held —
same adapter pattern, same worker hook, same plot primitive — but the *content*
did not: it needed a second image rather than a second object, a closed form A2
has no analogue of, and a refusal path A2 never reaches. Cheap to build is not
the same as a variation on the one before it.

A4 repeated that lesson in a different place. The adapter, worker and plot
pattern transferred unchanged for the fourth time — but the two conventions
every previous panel shares, *white at twice the mean* and *the sweep on the
main thread*, both had to be broken, and neither for reasons visible from the
plan. A sparse specimen and a per-frequency render are different in kind from a
grating and a pupil sum. **The house style is the adapter boundary and the
guards, not the display and scheduling choices layered on it** — those are per
surface, and each one that changes has to say why on screen.
**A5** landed the fifth reuse of that pattern and made the same point a third
time, from a new direction: what changed was neither display nor scheduling but
the **plot's own sampling**, and the reason was a property of the engine's
lattice that no rung had needed to name — the axial transfer's period
pupilSamples/(4ν). § 6k.4 reads its edges off an envelope and is right to; a
curve drawn from the same stack is a comb. **A surface that draws a quantity a
rung only summarizes will find the sampling the rung could afford to ignore**,
which is A3's undersampled lobes and A4's frozen sweep arriving a third time in a
third place.

**Part B** is self-contained and can go in parallel — it touches no microscope
code. **A6** follows. **Part C** is a separate decision.

**Part D** is where the branch goes next, and it is a different kind of work from
A1–A5: those wired capability the engine already had, and D1–D3, D5–D7 are engine
steps with their own rungs. Its own order is at the end of that part; the short
version is **D8 first for breadth, D1 → D4 for the field of view** — and D1, D2
and D3 have landed as § 6m, § 6n and § 6o, so the field of view now waits on
nothing but **D4's stage**: the engine composes tiles into one image, with the
guard band its error needs measured against a closed form.

The structural items were not a prerequisite, and A1 confirmed it. A2 revised
that: items 3 and 5 landed *inside* it, because a second worker-backed panel and
the first curve on the page are exactly what makes a generic hook and a plot
primitive cheaper to build than to avoid. Item 1 could not land that way — a
routing table is not something one panel needs — so it went in **on its own,
before A3**, and A3 arrived as a fourth registry entry rather than a sixth
control group on one scroll. **Item 4 landed inside A3**, as predicted below and
by the rule rather than by taste — A3 has both a numeric threshold the defocus
slider walks into and § 6f.9's three-state verdict, so it needed the component
A2 had only half of, and extracting A2's copy in the same change is what the
rule actually asks for. **Every structural item is now closed.** The
paragraph below is what predicted it, kept because it called the shot:

> A3 has a defocus threshold and a transfer curve sitting on zero, so that is
> plausibly A3's job.
