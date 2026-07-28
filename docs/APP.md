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

A1 and A2 have landed; A3–A6 have no app surface yet. Ordered by value per unit
of work.

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
kind. How many landed is printed beside it (78 of 80 at ps 32, 80 of 80 at 128 —
the wider frame keeps more of them), along with the density in beads per 100 µm²,
without which the oil objective's 2.65 µm crop looks like a broken bead slider.

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

**A1 ✅ → A2 ✅ → A3 ✅ → A4 ✅** landed the microscope branch's headline results
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
**Part B** is self-contained and can go in parallel — it touches no microscope
code. **A5 and A6** follow. **Part C** is a separate decision.

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
