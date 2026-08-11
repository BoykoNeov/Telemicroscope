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
`fluorescence.ts`, `volume.ts`, `stage.ts`, `builder.ts`, `coverslip.ts`,
`eyepiece.ts`, `tolerance.ts` — are
the whole optical pipeline as **pure functions**, numbers
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
  above. (NA ≥ 0.20 throws — a doublet ceiling arriving as an error message. A
  picker must handle it. **§ 6b.5 corrected the attribution** — this is
  `achromaticObjective`'s aperture refusal, which for a 4× N-BK7/F2 sits at
  **NA 0.20427** (0.1843 until § 6b.5.6 stopped the fixed point's thin-lens seed
  deciding it, then 0.1965 until § 6b.5.7 stopped the scan counting bendings that
  are not lenses), *not* § 6b's f/4.1, which is an aberration edge at NA 0.10311
  and twice as slow — and **§ 6b.5.5 corrected the message itself**, which no
  longer says *"this glass pair does not admit the classical doublet solution"*
  here. It now reads *"found 2, of which 1 is a lens — the rest are deeper than
  hemispherical (1.00× at the steepest surface) and cannot be made … what is
  binding here is the APERTURE and not the glass pair"*, so a picker can say which
  knob to move. The sentence about the glass survives on the branch where it is
  true — a genuine glass-pair failure, where the scan finds **nothing**.)
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

All of A1–A6, A9 and A10 have landed. Ordered by value per unit of work, and
kept in that order rather than resorted, because the ordering is the record of
what was expected to be cheap. (This line said "A6 has no app surface yet" long
after A6 shipped — the third stale-accounting slip this doc has caught in itself,
and the same registry check found it: every ✅ section that is a panel has a
route in `panels/registry.ts`, and A6's is `coverslip`.)

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

**Three entries were written to be refused**, and the engine's own error text is
what the cell shows: the doublet's refusal locus (DIN 4×/0.20 — § 6b.5 pins this
as `achromaticObjective`'s three-root wall rather than § 6b's f/4.1) and § 6d's
measured NA 0.343 wall (Lister 40×/0.40, whose message carries both glass pairs'
numbers). This doc predicted a picker "must handle it"; showing the message *is*
the handling, and it puts a measured finding on screen for free. **§ 6b.5.5
improved that cell without touching the panel**: the DIN 4×/0.20 row now says
the aperture is what is binding and prints how many of its three roots are past
hemispherical, where before it told the reader to change glass. Showing the
engine's own text means a fix upstream arrives here for nothing — and means a
wrong sentence would have too.

**And it did, which Part F found: today ONE row refuses.** § 6b.5.6 seeded the
doublet solve differently and the DIN 4×/0.20 builds — it draws a picture in
brightfield — so the paragraph above went from a count to a history, and the row
note that called it "an error message" was on screen saying so. The sentence
predicting exactly this failure was in the same paragraph as the failure. **How
many rows refuse is now read off the table and asserted nowhere**, in the app and
in the rungs alike; see Part F's *What it cost that the enumeration did not
count*.

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

**~~Deliberately absent, and stated on the page: depth-dependent spherical
aberration.~~ Wired at D10** — the panel now has a mount and a depth, the stack
stops being symmetric about focus, and the paragraph that said otherwise is gone
from the page. What is still absent: any field decomposition (`renderVolume`
takes one pupil keyed on *depth*, so the frame is imaged through the on-axis
pupil and A4's corner-versus-axis comparison has no analogue); and `hazeKernel`,
which is exact only for a z-uniform specimen — a bead field is not one, and
§ 6k.6's whole content is that over z the sum does not factor.

**No engine capability was added, so no validation rung was.** Everything here is
§ 6k's and § 6l's, called from the app — though D10 did add the branch's first
**app** test file, for the wiring rather than the physics. See D10.

### A6. Coverslip mismatch and the slip tolerance — ✅ **landed** — *app wiring only, plus one engine fix it forced* — **plot**

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

**Built as `coverslip.ts` + `panels/coverslip.tsx`, four plots and a readout, in
three workers** (thickness sweep ~2–5 s, index sweep ~3 s, and the one slip the
sliders stand on at ~200 ms). App-level invariants are in
`packages/app/test/coverslip.test.ts`; no ladder rung was added *for the panel*,
because every number it draws is § 6c's and § 6e.5's. **One was added for what
the panel found** — see below.

**The line above that says "`coverslipTolerance`, `stackW040Mm`,
`plateWavefrontErrorMm` supply all of it" is wrong**, and it is this doc's own
recorded failure mode arriving a sixth time: *the feasibility number turns out to
be measuring something else.* Those three are closed forms; three of the four
bullets are **traced** σ, and what supplies them is § 6e.5's whole recipe —
build the objective, splice a different slip in front of it without re-solving,
refocus by the closed form, `bestFocus` + `opdMap`. `stackW040Mm` does earn its
place, but not as a supplier: it is the *decomposition* that makes the σ curve
legible (below). `plateWavefrontErrorMm` is not used at all — it is the dry
single-plate form, and this objective looks through a stack.

**What it cost that was not budgeted: an engine defect, and it was in the focus
solve.** σ against slip thickness at NA 1.40 had a **3.2× spike at one
thickness**, smooth on either side and converged in `pupilSamples` — it looked
exactly like physics. It was not: `bestFocus("minRmsWavefront")` brackets its
golden-section search with twice the distance from the paraxial plane to the
*spot* plane, and where a system balances its transverse aberration while its
wavefront minimum stays put, that estimate collapses and `goldenMin` returns a
**bracket edge** as though it were a minimum. § 1.6.1 now pins the fix against a
scan of the solver's own merit. Nothing in the ladder had caught it: § 6e.5 runs
this solve at every thickness, but its rungs are `toBeLessThan` — which a *worse*
σ passes — and at NA 1.0 and 1.25, where they live, the bracket never collapses.
**A6's prediction slot therefore resolves harder than A3–A5's**: those found
things a rung had not needed to *say*; this one found something a rung had got
*wrong*.

**Three findings, and the first corrects the bullet above it.**

- **"σ flat across 0.15–0.18 mm" is an NA 1.00 statement**, not a general one.
  Measured on the panel's own sweep: at NA 1.00 the refocused σ moves under 15%
  across the band (§ 6e.5's flatness rung, reproduced), at **NA 1.25 it varies
  3×**, and at **NA 1.40 it has a genuine minimum about 5 µm UNDER nominal**.
  All of it stays inside a third of the budget, so "not flat" is not "not
  diffraction-limited" — the panel says both.
- **The minimum is § 6e.4's "the cover slip helps", with the film as the knob.**
  The oil is the only mismatched layer in the stack (slip and front element are
  both D263, so the slip's contribution is an identical zero), and it is
  **rarer** than the glass either side of it — so its W₀₄₀ is negative and
  opposes the Lister residual. Refocusing a *thinner* slip **thickens** the film,
  which buys more of that cancellation. `stackW040Mm` on that one layer is drawn
  beside σ, which is what turns a monotone drift from mysterious into legible.
  The index slider is the same mechanism on the other axis: a slightly rarer slip
  adds negative aberration too. Neither is a recommendation — § 6e.5 records the
  same kind of gain in the placement solve and deliberately does not act on it.
- **Both ends of the band are geometric, and the panel measures them rather than
  quoting them.** § 6e.4's NA 1.411 is a number in the validation ladder and not
  an engine export, so the adapter **bisects** for the slip at which the tracer
  first loses a ray and reads the closed-form aperture there: **0.1612 mm at NA
  1.4112**, which is § 6e.5's predicted 0.1613 mm arriving as an observation with
  the constant appearing nowhere in the app. The thick end is the **film**, not
  σ — at 0.19 mm the refocus asks for 0.11 µm of oil. The wavefront is
  comfortably inside budget at both walls.

**And A3's refusal rule is load-bearing here rather than decorative.** `opdMap`
returns an `rmsWaves` whether or not the pupil is whole, and at the thin end a
third of this objective's pupil is dark — that σ *rises*, smoothly, and drawn as
a curve it reads as aberration growing toward a thin slip, which is the opposite
of what is happening. Every σ carries its own `lost` and refuses itself, so the
thin end of the black curve is a **gap** and a sentence, never a plotted number.
The two refusals are also distinguishable by voice, A1's `source` distinction:
lost rays are the app's refusal, a thrown design is the engine's.

### A9. The section in colour, and the tint that cannot be a stain — ✅ **landed** — *app wiring only* — **pair**

Built as `packages/app/src/section.ts` (pure adapter), `section.worker.ts`,
`panels/section.tsx`, `packages/app/test/section.test.ts`. **No engine capability
was added, so no validation-ladder rung was** — every number is § 6r's, called
from the app.

**It starts by correcting this document.** "Scenes nobody has authored" was
stale: `stage.ts` authored a diatom field and a stained section for A7, and the
disqualified row below has said "what remains is authoring a scene" since § 6n.
What was actually missing was **colour** — every microscope surface in the repo
was grey, the stage's section is a neutral absorber bound at the d line, and
`brightfieldSpectralStack` (§ 6r, the branch's own headline "a stained section
looks stained") had **zero callers in the app**. That gap, not the scene, is what
A9 closes. The specimen library moved to `specimens.ts` and became
`SpectralSpecimen` on the way; the stage binds `atWavelength(spec, LAMBDA_NM)`
and its picture is unchanged, which is the seam `imaging/specimen` keeps.

The dyes are **invented** — two Gaussian absorption bands composing by
Beer–Lambert, stated as synthetic on screen. § 6r lists a rung against a
published stain's transmittance as open and real dye spectra are measured data
this repo does not have, so nothing on the page is a claim about a real stain.

**The pair is § 6r.5 drawn.** The same stack produces the honest image (one Abbe
sum per λ, stacked on the bluest plane's ruler, collapsed against the CIE
observer) and the tempting one (sum to grey, then multiply by the lamp's colour).
The tint's chromaticity spread is **4e-16 and zero by construction** — a scalar
times one XYZ cannot vary — against **0.156** measured on the same frame. A proof
beside a measurement, and the panel says which is which.

**Four findings, and the first two revise what this section was scoped to say.**

- **A specimen with NO wavelength in it images in colour, and on the worst pixel
  it beats the stain.** The ruled grid is `neutralSpecimen`; its image has violet
  lines on a cream ground and spreads **0.2227** against the stained section's
  **0.1700**. Axial colour is concentrated exactly at an edge and a 1.5 µm ruling
  on a 20 µm pitch is nothing but edges, while a dye tints a whole cell mildly.
  This is § 3b's purple fringing arriving in the microscope branch on an object
  that has no colour at all. **It survives the honest lattice**: at ps 64, where
  every plane rules `valid`, the grid still reads 0.2254 — so it is the
  objective's dispersion and not the refused blue plane.
- **So one number was not enough, and that is this panel's version of the
  pattern.** A5 found a rung's *sampling*; D8 found a rung's *defaulted
  parameters*; A9 found a rung's **statistic**. A max is an outlier and a stain is
  an area, so the panel reports the luminance-weighted mean beside it — and the
  discriminator that actually separates a fringe from a stain is neither: it is
  the frame's **mean chromaticity**, which the section moves **0.0234** off the
  lamp's white and the grid moves **0.0010**. A fleck would move the spread and
  not the mean.
- **§ 6r.7 reproduces exactly, and it is the panel's guard.** At ps 32 on the DIN
  4× the 450 nm plane rules `no-honest-image` while 550 and 650 rule `valid`;
  doubling the lattice clears it and costs **17×** (208 → 812 directions). The
  panel names the wavelength rather than colouring the frame, because "the frame
  is unreliable" and "the blue third of its colour is" are different sentences.
- **D7's cost line is corrected, and § 6s is the whole reason.** D7 says "nine
  wavelengths at 64² is still minutes"; measured on the DIN 4×/0.10 at ps 32 /
  grid 64 with its 208-direction commensurate condenser it is **403 ms** — 149 ms
  at 3 λ, 231 at 5, and 45–50 ms a wavelength *flat in the count*, which is what
  "the Abbe sum is the bill" looks like from outside. The expensive axis is the
  **lattice**, not the wavelength count: ps 64 / grid 128 is 2 487 ms at 3 λ. So
  this is a select-change surface rather than the button D7 budgeted for.

**Two smaller things the wiring had to state.** A colour frame is the **blue
end's** — every plane resamples onto the bluest one's grid and § 6h.2's extent is
∝ λ, so the same objective covers **69.4 µm** here against A1's 93.5 at the d
line, and the closed form at the ruler λ lands to −0.50% (the traced frame's own
departure, A1's column again). And the resample ratio is λ's **to 1.7e-4 and not
exactly**, because these frames are traced and the exit pupil moves with λ too —
§ 6r.6 states the same agreement to three decimals for the same reason.

**And one claim in this section's own first commit was false, which is the
fourth thing.** "The stage's picture is unchanged" is true of `ruled` and
`diatom` — wrapped verbatim, bit-identical at every λ — and **not** of the
section, which went from stain fractions to two dyes. A monochrome surface sees
one wavelength's *slice* of a spectrum, and the bands first chosen put the d line
at 0.195 of the cytoplasmic peak: the stage's cell bodies went from amplitude
0.55 to 0.80 and vanished, leaving nuclei on a flat ground. **Nothing would have
caught it** — no golden pinned that render, and the A9 rungs are all about
colour — so it was found by loading `#/stage` and looking. The bands are now
picked against both surfaces (545/50 puts the d line at 0.485 of the peak,
cytoplasm back to 0.53) and the header states the trade: a wider band reads
better in grey and carries less hue.

**A golden pins it now, and that sentence is the reason.** The new
`packages/app/test/golden.test.ts` commits the stage as `#/stage` opens on it —
the panel's own default state, verbatim, since the defect was found by opening
the panel and what is worth pinning is therefore the view it opens on. It is
**2×2 tiles
composed on `stageInfo`'s pitch**, not one: `stage.ts` warns that a per-tile
exposure would paint a brightness step at every seam, and a single-tile golden
is structurally blind to exactly that, so the frame carries three seams. Both
branches are committed — the monochrome d-line picture (`valid`, ~50 ms a tile)
and § 6t's colour one at the panel's 3 λ (~140 ms a tile, and
`no-honest-image` at 32 pupil samples, which is asserted rather than avoided:
the panel says so on screen, and honest would cost **1.9 s** a tile at settings
no default reaches). Per tile, as § 6s's numbers are, so the four-tile frames
are four times each. Same status as the engine's goldens: **regression, not
validation.**

Three controls come with it, because a golden that cannot fail is worse than
none. The four tiles must differ from each other — an index dropped anywhere
between cache, anchor and worker composes four copies of one tile into a
picture that tiles perfectly and is wrong. The colour frame must contain an
off-grey pixel and the monochrome frame none, which is what catches a tinted
grey stack standing in for a spectral one. And **the cell bodies must still be
in the picture at the level the dye predicts** — the level read off the specimen
rather than typed in, so a legitimate re-authoring moves with it: the cytoplasm
plateau at the d line is intensity 0.284 (amplitude 0.533, the 0.53 above) and
12.0% of the frame images at or under it. That last one is the only rung that
*names* this defect instead of detecting it. A golden fails with "drifted"; this
fails with "the cell bodies faded", which is the sentence that was missing.

**The panel found one bug and one false sentence, both at the S slider's left
end.** S = 0 is a *different source*, not a small one: a commensurate lattice of
radius zero holds no points, so `commensurateSource` refuses it where
`coherentSource` is the single axial direction (A2's `sourceAt` makes the same
split). Fixing that exposed the second: clamping the frequency-grid reach to zero
puts "only the coherent limit fits" on screen, and at ps 64 on a 64² grid that is
**false** — an *unshifted* pupil of 64 bins already needs 66, so nothing renders
until the grid grows. The reach is now reported raw, a negative value gets its
own sentence, and both are pinned (A9.7).

### A10. The stage in colour — ✅ **landed** — *app wiring on § 6t* — **picture**

**The two surfaces this doc built separately, joined.** A7 is a field of view you
can drag and it is grey; A9 is one frame in colour and it is 93.5 µm wide. § 6t is
the engine step that lets a mosaic be spectral, and this is `panels/stage.tsx`
taking it: a `wavelengths` control where `0` is A7's monochrome path **untouched**
and 3/5/9 is one Abbe sum per wavelength per tile, stacked on the bluest one's
ruler.

**What it has to say on screen, and both are § 6t's findings rather than
decorations.** The **ruler**: the picture's grid is the bluest plane's, printed by
wavelength. And the **delivered guard**, per plane — because the slider says "4
cells" and § 6t.3 measured that exactly one plane gets 4. The panel prints
`450 nm 4.50 · 550 nm 6.59 · 650 nm 8.04` at ps 32, and — the closed form visible
as a control rather than as a claim — `4.50 · 9.50 · 12.97` at ps 64, because the
excess carries `usefulPixels` and is not a property of the band.

**Three things came out of driving it.**

1. **A factor of 300, caught by a test rather than by an eye.** The exposure has to
   be the *lamp's* and not the tile's — A7's own fixed white, in colour — but the
   first version computed it from the raw SED×Δλ weights where
   `colorImageFromStack` folds in the **normalized** ones. Every tile rendered near
   black. `stage.test.ts` pins the exposure against an independently normalized
   lamp for that reason: the failure is a factor, and a factor is exactly what a
   picture cannot show you the size of.
2. **The picture cannot pin the white either, and the rung was rewritten.** The
   first version asserted that a clear field lands on the byte the lamp's XYZ says.
   It does not — the background of an Abbe image is **0.92** of a clear field,
   because a nearby absorber depresses it, and how far depends on how much specimen
   is in reach (a dense ruled grid's background wanders 205 → 207 between two tiles
   where the sparser diatoms hold still). So the exposure is pinned as a number and
   the picture only carries that a fixed exposure adds nothing to that.
3. **Colour costs a sampling, not a wavelength count** — and this is the finding.
   At the stage's own ps 32 the colour picture draws and the verdict says
   **`no-honest-image` at 450 nm**: § 6r.7's blue plane, worst-resolved by 2.56×
   where λ alone gives 1.22, reproducing on a mosaic tile. And that wavelength is
   the **ruler**, so the plane the picture's grid belongs to is the plane that
   refuses. ps 64 clears it, measured at **~0.39 s → ~2.0 s a tile** (39 tiles in
   14.3 s across three workers), so `64` is now an option on this panel and the
   trade is on screen rather than hidden. The grey stage still rules `valid` at 32,
   because the d line is not the blue end.

Cost, measured on the DIN 4×/0.10 with the 208-direction commensurate source:
~0.39 s a tile at ps 32 / 3 λ, ~2.0 s at ps 64 / 3 λ — linear in the wavelength
count, as § 6r's own panel measured, and the lattice is still the expensive axis.

**§ 6x raised the off-axis half of that by 1.8×**, and only the off-axis half: a
tile lit through a displaced cone can no longer use § 6p's pupil cache, so the
monochrome figure runs **404 ms on the anchor against 727 ms anywhere else** and
flat with distance — the cache is available or it is not, and how far the cone
moved does not enter. On a telecentric objective nothing changes at all, which is
the point of § 6x rather than a caveat to it.

### Disqualified — needs an engine step first

| surface | blocked on |
|---|---|
| ~~Stained tissue / diatom fields~~ | ~~§ 6h's warped-grid rasterizer, not built.~~ **Unblocked at § 6n** — `rasterizeSpecimen` places an extended specimen through the traced map. ~~What remains is authoring a scene, which is content rather than a blocker.~~ **Authored, and now in colour**: `stage.ts` had both scenes from A7 and A9 made them spectral (`specimens.ts`). Nothing here is disqualified any more. |
| ~~Depth-dependent spherical aberration in the z-slider~~ | ~~§ 6l — the physics is in § 6c/§ 6e but wiring focal depth into the stack is its own step.~~ ~~**Unblocked at § 6l**~~ — **built at D10.** A5 has a mount control and a depth control, `mountPupils` is its `DepthPupils` and `mountVolumeOptions` its options, and the stack is no longer symmetric about focus. Nothing here is disqualified any more. |
| Confocal / deconvolution | the excitation path (§ 6j open) — a detection pinhole and an excitation PSF. |
| ~~Polychromatic brightfield~~ / fluorescence colour | ~~§ 6f and § 6i both name it open. § 6j's band is emission-only. Scoped as § 6r in Part D.~~ **Brightfield colour unblocked at § 6r** — `brightfieldSpectralStack` runs the Abbe sum per wavelength and `colorImageFromStack` collapses it. Fluorescence colour is still open: § 6j's band is emission-only, and an extended emitter field needs the Jacobian § 6n deferred. |
| ~~A pannable field of view in colour~~ | ~~§ 6o's pitch and guard band are pinned at one wavelength, and `halfExtentMm` is ∝ λ.~~ **Unblocked at § 6t** — the guard is cropped per plane on that plane's own grid, before the stack, so § 6o's measurement transplants by identity. Built at **A10**. |
| A live "real field of view" brightfield frame | constraint 1. Not a UI problem and not solvable by resampling — and that stands. **What Part D adds is that it is reachable by tiling rather than by widening**, which is a different operation with its own error, now measured and composed: § 6m–§ 6o, compute-once, never live at a full field. § 6o pins the crop error of a tile to a closed form and § 6o.7 composes them. |

---

## Part B — tolerancing (step 5's named leftover) — ✅ **landed** — *app wiring only* — **pair**

Built as `packages/app/src/tolerance.ts` (pure adapter, `render.ts`'s pattern for
the seventh time), two workers, and `panels/tolerance.tsx`. App-level invariants
are in `packages/app/test/tolerance.test.ts` (15 rungs); **no engine capability
was added, so no validation-ladder rung was** — every number the panel draws is
§ 5t's, called from the app. A6's and D10's convention, and this time nothing in
the engine had to be fixed for it.

**The scoped moment is real and it is the smaller half.** The section below says
the panel exists to show `rssWaves` and `combinedWaves` diverging *when the modes
stop being orthogonal* — combined running ABOVE the estimate. The `correlated`
preset does exactly that and lands on √2 to four digits (1.4145), which is § 5t's
own negative control arriving as something a reader clicks. But the larger
departure is the other way, and it is the panel's headline: a **conic** error on
the front surface and a **curvature** error on the rear one — different
parameters, different surfaces, every instinct says independent — each spending
half the Maréchal budget, and the pair spends **almost none**. On the achromat at
f = 100 / EPD 20 the rss reads 0.0506 waves, the honest trace reads 2.7e-4, and
the budget is **189× pessimistic**. Both make spherical aberration, of opposite
sign. So the claim the panel can make is not "RSS under-reports when modes
correlate" but **"RSS is not a bound in either direction"**, and that is why every
slider goes negative.

**How far they cancel is a property of the lens, so the preset is named for the
mechanism** — `both spherical`, not `cancelling`. Measured across the panel's own
control space it runs 189× at f = 100 / EPD 20, 214× at f = 50 / EPD 14, 78× on
the singlet and only **8×** at f = 100 / EPD 10. A button promising a
cancellation that reads 1.02 somewhere would be the mislabel this doc keeps
correcting; `independenceRatio` beside it says what actually happened. D8's rule
about walls, applied to a cancellation.

**Five findings, and the first two are the ones a σ cannot state.**

- **The cancellation is the PROJECTION's, and a real focuser gets only part of
  it.** § 5t is explicit that its compensator is a *linear projection* of ρ² on
  one reference plane — which is what makes the RSS exact rather than
  approximate — and that this is not a physical refocus. The cancelling preset
  is where that stops being a caveat: the projected delta is 2.7e-4 waves and
  the physically refocused one is **1.85e-2, sixty-nine times larger**, because
  removing the pair's defocus means a 1.9 mm plane move undoing 17.5 waves. It
  is still 2.7× inside the RSS, so the finding cuts both ways.
- **A σ has no sign and an image does.** § 5t pins every external rung on a
  *perfect* nominal, "the one place the currency's design subtlety cannot bite";
  this nominal is a real N-BK7/F2 doublet at f/5 with 0.0323 waves of spherical
  residual. So a conic error of ±0.0675 reads σ = 0.0716 **both ways** and gives
  a Strehl ratio of **0.675 against 0.979**, and a negative curvature error at a
  whole budget makes the star *better* than nominal (1.040). Even the refocused
  cancelling pair loses 6% of its Strehl, and the mechanism is measurable rather
  than asserted: inverting Maréchal on the three Strehls gives ⟨W_nominal·δ⟩ =
  6.08e-4 against σ_n·σ_δ = 6.00e-4, a **correlation of 1.01** — the residual is
  exactly parallel to the doublet's own. The panel draws the measured Strehl
  beside Maréchal's prediction and prints their ratio, because that gap is the
  finding.
- **The slider scaling is a measurement that checks itself.** A `PerturbTarget`
  is in its own unit and a slider in 1/mm is unreadable, so ±1 is the drift that
  spends the whole budget — read from a linear coefficient at a probe delta, then
  **bisected**, and the ratio between the two printed. § 5t's premise holds: for
  **twelve of the achromat's fifteen** (surface, target) pairs that ratio is
  **0.96 to 1.06**, so δW really is linear out to a whole Maréchal. The other
  three are the interesting ones. A tilt of the
  **cemented interface** has a linear coefficient 63× smaller than the outer
  surfaces' — its index step is 0.103 against 0.517 — while its second-order term
  is not smaller at all, so the extrapolation is **20× wrong** (0.0504) and the
  bisection is what saves it. And a **decenter of the stop surface** cannot reach
  the budget at all before the glass runs out, which is § 5t's exact null on a
  mirror arriving as a mere 11× on a powered refracting stop. (The third is the
  inert row below.)
- **Two rows are refusals, not zeros, and one of them was a surprise.** The
  **last surface's thickness is inert**: `withFocus` sets the image plane as an
  offset from the last vertex, so that airspace never reaches the image. The tell
  is that `sigmaBeforeFocusWaves` is exactly 0 **as well** — a compensated row has
  a large one and a small `sigmaWaves` (measured 357× on an inner airspace) — so
  the two cases are distinguishable rather than both reading zero. The other is
  the aperture wall, below.
- **The aperture wall is mechanical, and it is NOT a focal ratio.** `refractorPair`
  fixes the crown's centre thickness at 3 mm whatever the focal length, so past
  some semi-diameter the two sags meet and the tracer reports `miss` from the rim
  inward. Bisected: EPD **16.11 / 22.99 / 32.65** at f = 50 / 100 / 200, ratios
  1.427 and 1.420 against √2 — the wall goes as **√f**, which is h = √(t·R) with t
  fixed, and the f-number at it therefore *loosens*, f/3.10 → f/4.35 → f/6.13.
  That is the opposite shape from every wall the microscope branch measured, and
  it sharpens **D8's finding 3** rather than contradicting it: D8 found the
  cemented doublet's *aberration* ceiling is more nearly a ratio than an aperture;
  this is the same glass form's *geometry* running out, and geometry is a sag.

- **The singlet is where three of the above stop holding, and the panel only
  reached it because it was asked to.** Its wall obeys the same h = √(t·R) with a
  5 mm centre thickness instead of 3, which puts it at EPD **31.8 / 45.2 / 64.1**
  — past every aperture the panel offers, so the singlet **never reaches its own
  wall** and unconditional achromat prose would have been the only thing that
  branch ever showed. Its front-surface curvature row is **not linear**: 0.24 at
  f/10, climbing to 0.93 at f/3.3, so *which rows are linear is a property of the
  lens* and the verify-then-bisect step is load-bearing rather than belt-and-
  braces. And its nominal Strehl falls off a cliff — 0.956 at f/10, 0.500 at
  f/7.1, **0.067 at f/5**, 0.018 at f/4 — at which point the measured Strehl ratio
  is two small numbers divided and reads **1.179**, the perturbed system
  "better" than a nominal that is not forming an image. So the ratio is
  **refused below Strehl 0.8**, § 5t's own diffraction-limit convention supplying
  the line. The budget above it is untouched and says so: a delta σ does not need
  the nominal to be any good, and what is unavailable is the *image* comparison.

**Two things were found by driving the panel and could not have been found
headlessly**, which is this doc's own tradition on its seventh repetition.

- **A `[]` fallback locked the tab.** With no scaling yet the request carried a
  fresh empty array on every render, so the memoized request changed identity
  every render, so the worker hook's post effect re-fired, so it rendered again —
  a post-per-render spin that saturated the worker queue and froze the renderer
  hard enough that a screenshot timed out. The headless suite calls
  `runTolerance` directly and has no render loop to spin. Hoisting one `NO_SCALES`
  constant is the whole fix.
- **The stale-scaling window has two sides, and guarding one of them is worse
  than guarding neither.** A scaling is a statement about (surface, target) pairs
  and an aperture, so holding the last good one while the next is in flight would
  print "±1 = 0.27 mm of decentre" under a row that already says *curvature*.
  `ScaleResult` therefore echoes the question it answers. But that alone produces
  the mirror bug: the render fired against the *empty* scaling answers first, and
  once the new scaling lands its table of zeros is displayed as real — "these
  tolerances cost nothing". So `ToleranceResult` carries a `scaleSignature` too,
  and the panel shows a result only when it ran on the scaling on screen. **A
  reply has to carry its question in both directions**, and A4's withdraw-rather-
  than-grey rule is what says which.
- **And the same rule has a third axis the first two fixes missed: the
  compensator.** `refocus` decides the caption under the perturbed frame, which σ
  the table prints large, and whether the Strehl-against-Maréchal ratio means
  anything — so driving those from the *control's* state relabels a frame one to
  three seconds before it is recomputed, which is A4's "makes a false label faint
  rather than absent" exactly. `ToleranceResult` echoes `refocus` too, and every
  one of those reads off the result. **A stale-state guard is not one check; it is
  one per thing the state labels.**

**Cost, measured in the browser** (dev build, achromat f = 100 / EPD 20): the
whole job — budget, the k sweep, both Strehls and both star frames — is
**650–990 ms** with the compensator on and **~3 s** with it off, where the
defocus hands the picture to the geometric branch (`geometricWeight` 1.000, and
the panel says so). The **scaling** is a second job at **1.7–3.4 s**. So this is
a backpressured compute-once surface in A5's and A6's sense, not a drag surface —
and it corrects the cost note at the end of the original scope below, which
worried about `sensitivity` re-solving best focus under a live slider. It does,
and at 21 ms a row that is the *cheap* half; what the scope did not anticipate is
that scaling the sliders honestly costs more than everything it scales. **Focal
length and aperture are therefore buttons rather than sliders**, because both
re-derive every row's full scale and the aperture wall, and a drag would put
seconds under every frame to buy nothing — the continuous axes on this panel are
the tolerances, which is what it is about.

**Guards:** `truncatedFraction` and `geometricWeight` for both frames — genuinely
reachable, since turning the compensator off puts 11% of the light off the PSF
grid where it *wraps*, and the singlet at f/4 reads `geometricWeight` 1.000 on
*both* frames — and `lost` on the nominal and perturbed pupils, so a σ over a
shrinking sub-pupil refuses itself. **Three readouts refuse themselves rather
than defaulting**: the Strehl ratio below the diffraction limit, the
Strehl-against-Maréchal ratio when the compensator is off, and `combined ÷ rss`
when no row is perturbed — where rss = 0 would otherwise make the ratio fall back
to 1 and print "quadrature holds" about no modes at all. The Strehl-against-Maréchal ratio is
**refused outright** when the compensator is off, because the two then describe
different systems and a ratio between them is arithmetic rather than a
comparison. A3's rule, and the σ column swaps its primary reading to
`sigmaBeforeFocusWaves` in the same state so the number beside the picture is the
one that describes it.

The original scope follows, unchanged.

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
instantiated, not a whole branch. All are app-wiring-only unless noted.

- **Presets** — Newtonian, Cassegrain, Ritchey-Chrétien, Schmidt,
  Schmidt-Cassegrain, SCT — ✅ **landed** as C1 below, together with the central
  obstruction each of them reports.
- **Spider diffraction** (§ 5c) — ✅ **landed** as C2, on the same panel.
- **Off-axis diagonal vignetting** (§ 2f) — ✅ **landed** as C2. It needed no
  option at all, which is the finding: `psf()` builds the mask itself and only
  when the trace has already lost rays, so a field angle is the whole input.
- **The mechanical layer** (§ 5u) — ✅ **landed** as C3, which ROADMAP had named
  in bold as the one part of step 5 with no app presence at all. It is the only
  entry in this doc that is not on one branch: three of its blocks are a
  telescope's imaging train and the fourth is a microscope's DIN mount.
- **Eyepieces + afocal** (§§ 5l–5o) and **eye model / visual mode** (§§ 5p–5q) —
  ✅ **landed together as C5**, because they are one surface: an eyepiece has no
  exit pupil to match until something is behind it. It needed one engine fix
  (§ 5l.1), and the largest finding is that the apparent field of view is a
  property of the **eyepiece** — the object-space wall moves 5× across the
  panel's sliders while the field the observer sees moves under 3%.
- **Camera mode** (§§ 5r–5s) — ✅ **landed** as C4 below, and it needed one
  engine fix (§ 5r.1). The oversampled/critical/undersampled verdict turned out
  **not** to be a single readout: it is one per wavelength, and one sensor holds
  three of them at once.
- **Long-exposure seeing** — ✅ **landed as C6**, and it is the only Part C item
  that needed an engine step (§ 5d.1). The distinction this entry drew was the
  right one: the **physics was already pinned** and the averaging lived in a
  test-local helper with no exported API, so the app's dial could only ever be
  one short-exposure draw. Two corrections from doing it. The promotion could not
  go in `seeing.ts` — `psf.ts` imports `withPhaseScreen` as a value and the
  back-edge is type-only by design — so it is a module above both, and it takes a
  **pupil** rather than a system so the trace happens once. And the compute-once
  verdict is right while its reason was not: the bill is the **screen
  generation**, not the transform, so a 4× finer PSF grid costs only ~1.2×.

### C1. The six reflectors, and the obstruction each one reports — ✅ **landed** — *app wiring only* — **pair**

`reflector.ts` + `panels/reflector.tsx` + `test/reflector.test.ts`. Six designs
had sat in `core/designs` since roadmap step 5 with **no app presence at all**;
the app instantiated one refractor and nothing else. No rung was added because no
capability was: every number is § 4b's, § 5e's, § 5f's, § 5g's, § 5h's or § 5i's.

**The shape is a table of all six and a picture of one, which inverts A1's split
for a stated reason.** A1 traces the whole objective catalogue because the
comparison is the finding and the rows are cheap. Here the *table* is the cheap
half — constructing a reflector is closed-form layout arithmetic, six of them in
microseconds, since every radius, conic, separation and obstruction is derived
rather than solved — while a polychromatic star through one is 88–182 ms of trace
and transform. So the comparison stays un-clicked and only the picture is
selected. A row that cannot exist keeps its place and prints the engine's own
sentence, which is A1's convention: `F > F₁` or the Cassegrain family's secondary
does not magnify, and **four of the six rows refuse together** at F = F₁ while the
Newtonian and the Schmidt, which need only D and F, are untouched.

**The panel has its own aperture range and that is deliberate.** 100–400 mm
against the star panel's 4–20 mm, because `refractorPair` is a toy whose halo has
to stay on an FFT grid and a 6 mm Newtonian is not a thing. Two sliders that look
alike and are not is exactly what structural item 1 describes two panels having
had over `pupil samples`; routing is what keeps them from reading as one control.

Four findings, and **three of them were wrong predictions first** — recorded that
way because the corrections are the content.

**1. A Newtonian's obstruction contains no aperture, and is not an optical
choice.** Working § 4b's diagonal sizing through by hand, D cancels exactly:
ε = (k/F)/(1 − 1/(16·F²)), with k = 0.75 the stand-in focus offset as a fraction
of the aperture. The app derives it and the engine builds it and they agree to 12
digits, which is a real cross-check of § 4b's **sag** term rather than a
restatement — drop the 1/(16F²) and it fails at the fourth digit. The correction
is worth 0.251% at f/5, reproducing the 0.25% `newtonian.ts` quotes in its own
header, from the app's side. So a Newtonian's ε is a *mechanical* convention over
the focal ratio — where the focal plane has to sit off the axis — where the whole
Cassegrain family's ε = s₁/f₁ is optical, falling out of the magnification the two
mirrors must supply. At f/10 that makes the Newtonian's 0.075 about a quarter of
the family's 0.300, and the family's four members share the figure to 15 digits
because they share one `twoMirrorLayout`.

**2. The obstruction is a pupil fact and the trace never sees it.** `newtonian.ts`
is explicit that the diagonal is not traced as a blocker — it is reported and
applied in the pupil function — so on axis the Strehl reads 1 to six digits while
a fifth of the pupil is dark, and the annulus's entire on-axis effect is *where
the light sits*. Measured on one grid with ε = 0 as the control, since the same
system, wavelength and transform then differ in nothing else: energy inside the
clear Airy first zero falls from 84.70% to 69.20% at ε = 0.300, so the secondary
moves **18.3% of the core into the rings**.

**3. This app's own fringe measure is diffraction, not dispersion.** `render.ts`
reports a chromatic spread in Airy radii, and a Newtonian — two mirrors, no glass,
incapable of dispersing — reads **0.36 Airy radii** of it. The denominator is one
Airy radius, the focus wavelength's, while the Airy pattern scales as λ, so red
diffracting wider than blue is being counted as fringing. § 3b's use of it is
untouched: there a singlet and an achromat share the floor and it cancels in the
comparison. As an *absolute* number it does not, and a panel with no second lens
beside it is what exposes that. Dividing each plane by its own Airy radius removes
λ and is the measure that can vanish.

**4. Even normalized, the floor is the ruler — and the free control is what
proves it.** The all-mirror members read 1.1e-2 to 2.6e-2, and the number
**wanders non-monotonically as the grid refines** (Newtonian: 1.72e-2, 1.20e-2,
1.67e-2 at pupilSamples 32/64/128) rather than converging, so it is neither
resolution nor optics. It is `spectralStack`'s common-grid step — `pixelScaleMm`
is ∝ λ, so red planes are cropped where blue ones are padded and an
energy-weighted mean radius picks up a λ-dependent bias. It is therefore
**refused rather than subtracted** (0.03 Airy radii), which is A3's rule about
undefined readouts applied to a floor. The control costs nothing and is exact in
its logic: a Cassegrain and a Ritchey-Chrétien differ *only* in two conic
constants, and a conic carries no refractive index, so a dispersion measure must
return one number for both. They agree to **1.3e-5** of each other — four orders
under the corrector's own excess on the same layout — and *not* exactly, which is
the informative part: different conics make different wavefronts, so the two PSFs
are different shapes and the common-grid crop bites slightly differently on each.
What survives the control is the ruler reacting to a different picture, still not
dispersion. What sits *above* the floor tracks the corrector's own figure, and
approaches **A₄²** as the plate weakens — implied power 2.07, 1.92, then 1.45 over
F₁ 4 → 3.5 → 3 → 2.5, where the excess reaches 0.64 Airy radii and the
small-aberration form has plainly saturated. Since A₄ ∝ F₁⁻³ that is F₁⁻⁶, which
is why this slow f/10 Schmidt **camera** sits at the floor with a corrector in it
while an SCT on an f/4 primary sits three times above. That is the chromatic half
§§ 5g–5i left open, arriving as a number rather than a caveat.

### C2. The spider, and the diagonal that clips off axis — ✅ **landed** — *app wiring only* — **pair**

The same panel, two more `PupilFunction`s, and § 5c and § 2f finally have a
caller. Still no rung; the sweep gets its own worker
(`reflector.vignette.worker.ts`) because it is a sweep of *traces* where the
picture is one, which is the split D6 drew.

**§ 2f needed no control, and that is the finding.** The obvious design was a
vignetting toggle. There is none: `psf()` builds a `vignetteMask` by itself and
only when `map.lost > 0`, so the criterion *is* the trace and an unvignetted
system never pays for one. A minimum diagonal is sized to the on-axis cone, so a
**field angle is the whole input** — and the panel's only vignetting parameter is
therefore the field. Both curves are measured against the *on-axis* bundle rather
than the field's own, which is § 2f's own dissection of a draft rung that read
`onAxis / onAxis` and was 1 by construction.

**The largest finding is a wall, and it is the sixth of its kind in this repo.**
Past a certain field the engine does not degrade, it **refuses**: `opdMap` throws
`chief ray failed (vignetted)`, because the chief ray defines both the image point
and the reference sphere and a system without one has no wavefront to be right or
wrong about. Derived in the app from § 4b's own footprint sizing —

    tan θ_max = (√2·k/2) / [ (F − ½ − 1/(16F)) · (F − k) ]

— with **D cancelling again**, and the engine's bisection (40 halvings on a
3-point pupil, the criterion being its own refusal) lands on it to **5e-13** at
every focal ratio and is aperture-independent to every digit. So it joins § 6b's
f/4.1, § 6d's NA 0.343, § 6e.4's NA 1.411, § 6q's 0.88·f_e and § 6l's 1.3347, and
like the last of those it is one line of geometry rather than an aberration
budget: at the wall the wavefront is an ordinary number and the rays stop
existing. It closes as **1/F²** — 2.681° at f/4 against 0.147° at f/15, local
power 2.34 → 2.20 → 2.11, approaching 2 from above because the exact form carries
an extra (F − k) — and it runs **opposite** to the coma § 4b pins at θ·D/(32F²):
a fast Newtonian is comatic sooner per degree while its minimum diagonal passes
several times more field. Both carry 1/F² and point opposite ways, so "how fast
should a Newtonian be" has no answer that is only about aberration — and the
mechanical k is in one of them and not the other. It is also what makes the field
control a **fraction of the wall** rather than a degree range: the wall moves by
an order across the focal-ratio slider, so a fixed range would be mostly invalid
at one end and mostly unused at the other.

**Throughput, twice, by routes that share no code.** 1 → 0.384 out to 1.561° at
f/5, the FFT route integrating a masked pupil's area and the ray route counting
survivors with no mask and no transform in its history. § 2f pins them 1.2e-4
apart at pupilSamples 128 / 201 rays; at this panel's 64 / 101 the gap is ~1e-4 at
light clipping and **grows with the clipping** to 1.1e-2 at the wall — which is
the honest shape of it, since a ray-lattice count of a clipped region converges
more raggedly than a subdivided edge and the clipped boundary lengthens as the
pupil empties. Both the tight end and the growth are pinned, so neither can rot
into a single forgiving tolerance.

**The spider's guard is a measurement, not a warning.** A streak's first dark
point sits at `padFactor/widthFraction` pixels with no aperture and no focal
length in it, so a fat 1/8 vane puts it 32 px out and a *realistic* 1/50 one puts
it at 200 px — past the edge of a 256-pixel grid. § 5c sizes its validation vanes
fat for exactly this reason, and the panel turns that into a live red guard whose
meaning is unusual and is spelled out on screen: **the spike has not been
suppressed, it has left the frame.** Two smaller things fall out. A spider is
amplitude-only, so it cannot move the Strehl — 1.000000 at every vane width,
while the core energy falls 0.847 → 0.531 from bare to 1/8 vanes, which is the
same "where the light sits, not how well it is corrected" the obstruction showed
in C1. And a zero-vane spider is **refused** rather than treated as none
(`spiderObscures` requires a positive integer), so "no spider" is the absence of
the option — the same distinction the obstruction draws, and worth a rung because
the alternative failure is silent.

### C3. The mechanical train, and the ceiling that comes from a mount — ✅ **landed** — *app wiring only* — **plot**

`mech.ts` + `panels/mech.tsx` + `mech.optics.worker.ts` +
`mech.parfocal.worker.ts` + `test/mech.test.ts`. ROADMAP names this one in bold —
***`core/mech` has no app surface yet*** — and it had none since § 5u landed. No
rung was added because no capability was: every number is § 5u's, § 6b.5's or
§ 6c's, called from the app.

**It is the first entry in this doc that belongs to neither branch**, and that is
not a filing accident. `core/mech` sits in ROADMAP step 5 with the telescope, and
three of its four blocks are a telescope's — a diagonal, a filter, a camera body,
a focuser. The fourth is the **DIN parfocal standard**, which is a microscope's
mount and reaches back into a microscope objective's optical design. A layer
whose subject is *hardware* does not sort by branch, and the panel does not
pretend it does.

**The house style holds and the display convention breaks, for the fifth time.**
Adapter, worker, plot primitive, `Guard` — all unchanged. What is new is that the
headline is neither a picture nor a wavefront: it is **two verdicts about one
parts list, disagreeing**. § 5u measured that on a single focuser; making the
focuser a control is what turns "the naive sum is wrong by 7.83%" into a band —
**20 of 25** points along the glass axis, on the default train, where the
spreadsheet says the train will not reach focus and the physics says it will.

**The first plot is the layer in one picture, and its x axis is the argument.**
Required travel against *the glass inside a light path of fixed length*: the
naive line is **exactly flat** — one distinct value across the whole sweep,
because filling a fixed-length diagonal with glass does not change what it
occupies — while the honest one slopes at 0.340717 per millimetre, which is
(1 − 1/n) for N-BK7 read off the slope rather than typed in. Every other control
on the page translates both lines together; only this one separates them. Its
x = 0 end is not a fiction either: a diagonal with no glass in it **is** a mirror
diagonal, and `buildChain` builds one there, so the two lines meet exactly.

**Driving it added a bound the arithmetic does not suggest: the honest line leaves
the focuser at *both* ends.** Too little glass and the train wants to rack further
*in* than the drawtube goes; too much and it wants more *out*-travel than exists.
On the default focuser the trains that reach focus run from about 5 to about
100 mm of glass, so "a prism diagonal buys back back-focus" has a ceiling as well
as a floor. Nothing in § 5u says otherwise — it simply never drew the axis.

**Block 2 is § 5u.6 traced, which that rung explicitly is not** ("closed form
only, no trace in this step"). Two routes were tried and abandoned before the one
that works, and both are recorded in `mech.ts` because they look reasonable.
Expressing "insert the diagonal" as a § 5t `Perturbation` on the glass layer's
thickness **fails**: a 40 mm thickness perturbation moves the image plane 40 mm,
`sigmaBeforeFocusWaves` comes back at 15 waves, and the linear ρ² projection
cannot remove a defocus that large, so the currency reads **7× high**. And a
*zero*-thickness plate — which would have made the no-glass control structurally
identical to the glassed one — **breaks the tracer**: two coincident plane faces,
and the chief ray misses at 0 and at 1e-9 mm, while 1e-6 mm is a clean no-op to
seven digits. What works is differencing two `withGlassPath` systems, which keeps
the image plane fixed by construction.

**Its headline corrects the reading of § 5u.6's own number.** f/5.315 is a
statement about a plate **in isolation**. On a 100 mm doublet the *lens* leaves
the Maréchal budget at **f/6.007** and the lens with the diagonal in it at
**f/6.192** — both slower than the plate's own quarter-wave crossing. So "a
diagonal is marginal on a common f/5" does not mean a diagonal spoils an
otherwise diffraction-limited instrument: at f/5 the doublet is already **2.6
budgets** over on its own and the diagonal is the smaller of the two problems,
costing **3.1%** of focal ratio. It is never *free*, though — the difference is
positive at every ratio swept and at every sampling, because a plate's spherical
aberration has the same sign as an achromat's residual and the two add. That is
the **opposite** of § 6e.4's immersion oil, which is rarer than the glass either
side of it and therefore helps: same physics, opposite sign, and the panel says
so beside the curve.

**And the second plot is why § 5u.6 stayed closed form.** The traced difference
reproduces W₀₄₀/(6√5) to about ±1% — but the residual **never converges**, and it
is not physics. Move the sampling and it wanders non-monotonically (1.061 at
`pupilSamples` 9, 0.956 at 15, 1.007 at 21, 0.995 at 31, 0.988 at 61), it is
linear in the plate's thickness, and — the discriminator that actually settles it
— the **same sequence comes back where the lens's share of the total is four
times different**: bare ÷ plate is 3.64 at f/10 and 0.90 at f/40, while the two
wobbles agree to 2.5e-3. (The tempting phrasing, "it does the same on a doublet
with no residual of its own", is **wrong** and was corrected: at f/40 the lens
residual is 90% of the plate's contribution, not absent. What is pinned is the
4× swing, which is the stronger claim anyway.) So what is moving is the
**quadrature of an RMS over a lattice clipped to a disc**, not the exact form's
departure and not the doublet's higher orders. That ±1% is *larger* than § 5u.6's own exact/third-order excess at
every ratio slower than about f/4 (1.0018 at f/10, 1.0005 at f/20), so this route
**cannot resolve the number the rung computed**. A5's lesson — *a surface that
draws a quantity a rung only summarizes will find the sampling the rung could
afford to ignore* — arriving a fifth time, and for once it explains a decision the
ladder had already made rather than correcting one.

**Two nulls fall out for free, and one of them is new.** § 5u.2's
position-independence, measured at gaps 18× apart rather than at the rung's own
50 and 600 mm: **2.7e-11 waves**. And the plate's traced cost **does not know the
aperture** — 3.6557e-3, 3.6506e-3 and 3.6476e-3 waves at D = 60, 100 and 150 mm at
f/8, agreeing to 0.22% — while the doublet's own share over the same three moves
**2.5×** (0.140 → 0.349 budgets). A cone angle is the plate's only input; a lens's
own W₀₄₀ scales with its diameter.

**Block 4's finding is D8's, on a third axis: the ceiling is a function of a
parameter the ladder defaulted.** § 5u pins the DIN floor at 4.236, and that is
the **NA 0.10** answer. Walk the aperture and it runs **4.173 / 4.236 / 4.341 /
4.506** at NA 0.05 / 0.10 / 0.15 / 0.20, because a faster objective is a thicker
one and thickness is what the standard runs out of room for. The thin-lens floor
knows nothing about any of it (4.1387 throughout), so the entire spread is glass —
and against the *standard* rather than the aperture the penalty is nearly
constant, 1.022 to 1.029 over parfocal distances from 35 mm to 95 mm.

**The block that could not be written naively is the same one.** Above about
NA 0.22 the mount **stops being the binding wall**, and § 6b.5's aperture refusal
takes over — a wall of an entirely different kind sitting on the same axis. A
bisection that caught both as one exception reports a **mount ceiling of 12.6× at
NA 0.25**, where the truth is that no doublet exists there to mount at all. So
`barrelAt` discriminates on `DoubletApertureRefusal` and the sweep carries both
floors, reporting which is binding rather than whichever exception it caught.
This is § 6b.5.5's message work — *the count already discriminated; the fix
derives the sentence from it* — paying off in an app, and it is the first place in
this doc where **naming a refusal was load-bearing rather than polite**.

Two things about that block only a screen could have said. The sweep is **slowest
exactly where its answer is "not the mount"** — ~0.7 s at NA 0.10 against ~6 s at
0.27, because a `DoubletApertureRefusal` costs a whole failed bending scan — so
the panel is least responsive on the branch whose whole content is a refusal. And
the thin-lens rule had to be **relabelled from what binds to what it is**: at
NA 0.27 the buildable range starts at 43×, and a grey line labelled "the floor"
sitting at 4.14 would have been this panel's own refusal rule broken by its own
plot.

### C4. The sensor, and the critical pitch that is per wavelength — ✅ **landed** — *app wiring only, plus one engine fix it forced* — **pair**

`camera.ts` + `panels/camera.tsx` + `camera.worker.ts` + `test/camera.test.ts`.
`core/imaging/camera` (§ 5r) and `core/imaging/exposure` (§ 5s) had existed since
roadmap step 5 and the app had called **neither** — no `Sensor` had ever been
instantiated. No ladder rung was added *for the panel*, because every physical
number it draws is § 5r's or § 5s's; **one was added for what driving it broke**,
§ 5r.1, and that follows A6's precedent exactly.

**The shape is a picture, a table and two plots**, and the picture is the only
part that runs a transform. The format table, the per-λ critical pitches and
both MTF sweeps repaint on the slider's own tick while the star goes to a
worker. C2's asymmetry, falling the same way.

**They are not free, and the first version of this section said they were** —
this doc's cost model being wrong a fourth time, after D0.1, D4 and § 6s each
moved it. Measured: the main-thread block is **50 ms** in node, ~115 ms in a
browser at A4's 2.3×, of which **21–28 ms is one `buildCameraSystem`**, because
constructing a system runs a `bestFocus` solve. "Chief rays and array
arithmetic" describes `describeFormats` (8 ms) and the two sweeps (5.4 and
1.2 ms) accurately and the *construction* not at all. Worse, almost all of it
was being spent for nothing: the contest rebuilds three systems and depends on
the pitch through **no quantity it draws**, so a pitch drag paid for three focus
solves it could not change. Keying the memos on what each block genuinely varies
with — the system on the spec, the contest on focal ratio and the source —
leaves a pitch tick paying the cheap half alone. The lesson is the narrow one:
*in this engine, building a system is not construction, it is a solve.*

**This is the one panel in the app that does not auto-expose, and the break is
the surface.** Every other picture here normalizes to its own total; doing that
here would exactly cancel § 5r's headline rung, since the rebin conserves energy,
and § 5s's whole axis is a ratio a self-normalizing frame cannot have. So the
exposure is fixed and the frame is allowed to clip — a camera whose picture
cannot blow out is not showing you exposure. The factor has to be applied rather
than inherited, and that is **measured, not assumed**: `spectralStack` normalizes
to the transmitted pupil energy, so the rendered star's integrated Y is flat in
aperture (1074.81 / 1069.78 / 1073.73 at f/10·D10, f/5·D20, f/10·D20 — 0.5% across
a 2× aperture *and* a 2× focal length). Light grasp is not in the picture until it
is put there. A10's rule travels with it: **a factor is exactly what a picture
cannot show the size of**, so the rungs pin the numbers and never the shade.

Which of § 5s's two laws drives it is a distinction the panel has to make out
loud. The picture is a **point** source, so its brightness rides on D², which
§ 5s itself labels *a consistency check, not a pin*. The validated,
trace-emergent law is the extended-source 1/F² — measured here at **4.037** for
f/10 → f/5 against the paraxial 4, the excess being the faster stop's
sine-condition departure — and this panel has no extended source in it, so that
number is printed beside the picture rather than drawn through it.

**Nine findings, four of which were wrong predictions first**, and four of the
nine only exist because the panel was driven or reviewed rather than reasoned
about.

**The headline: the critical pitch is not λ/(4·NA) with λ alone moving.** The
traced NA moves too, and *how* it moves is the lens's chromatic correction. Over
430 → 670 nm at f/10:

| optic | traced NA across the band | critical ratio | vs λ ratio 1.558140 |
|---|---|---|---|
| N-BK7 singlet | falls monotonically, 0.050708 → 0.049426 | 1.598538 | **+2.593%** |
| N-BK7/F2 achromat | peaks mid-band at 550 — the crossing | 1.555723 | **−0.155%** |
| Newtonian | **bitwise identical** at every λ | 1.558140 | **exactly 0** |

Three optics, three signs, and the achromat's magnitude 17× under the singlet's.
That is § 3b's singlet-versus-achromat contest arriving on the sampling axis,
measured in pixels rather than in colour, and reusing the app's own lens toggle.
The mirror is what makes it a statement about *glass* rather than a curiosity: a
conic has no refractive index, so its spread is the wavelength ratio to the last
bit, at any aperture — C1's Cassegrain-versus-Ritchey control in a second
currency.

**One sensor holds three verdicts at once.** `criticalPitchMm` ∝ λ is a 1.56×
spread against `samplingRegime`'s 2% tolerance, so at the pitch that is exactly
critical at 550 nm the blue plane is **undersampled** and the red is
**oversampled**. The verdict is therefore ruled on the shortest wavelength the
stack *actually contains* — which at five samples is **430 nm, not a round 450**
— and that is § 6r.7's "the blue end sets `pupilSamples`" arriving on a third
knob, and § 6g.3's "a frame is not honest in the places where it happens to be"
arriving on the sensor.

**The FOV readout has a floor, and the floor is not distortion.** The obvious
number — traced FOV against the paraxial 2·atan(½w/EFL) — reads 0.0212% at a
half-width of 0.05 mm, i.e. 0.029° of field, where distortion is identically
zero. Printing that as distortion would be **C1's own fringe error repeating one
panel later in a different quantity**, and it was caught the same way: by putting
something with a guaranteed zero through it. The cause is confirmed by moving the
plane rather than argued — at the last vertex instead of best focus the floor
becomes **+3.4553%** while the field-dependent part is unchanged (−1.77e-4 against
−1.57e-4 over the same span) — so the departure **factorizes** into a
plane-position scale times a distortion. The scale is a *length*: implied EFL
minus paraxial EFL = **−21.1 µm** on the f/10 achromat, **−190.0 µm** on the
singlet whose spherical residual is far worse, and **−2e-5 µm** on the paraboloid
that has none. Reported against the on-axis limit instead, the distortion alone
runs **×4.00 per doubling of field** — third-order theory's cubic in its
fractional form — and the mirror reads **0 to f64**, so both floors vanish
together on the control.

**The detector MTF is measured, not drawn.** `camera.ts` exports no detector MTF
— § 5r computes it inside the rung — so drawing sinc(π·f·p) would be the app
asserting physics the engine does not provide. Sweeping a cosine through the
pinned `resampleGridToSensor` instead costs microseconds and gets § 5r's aliasing
rung for free: past Nyquist the modulation reappears at |1/p − f|, and projecting
there returns the **bit-identical** number, because on the sampled grid those are
one frequency. Two things had to be right and were wrong first — **integer cycles
across the sensor span** (otherwise the projection leaks and reads 1.08 at a tenth
of Nyquist, *above* a box filter's own transfer, which was the tell) and **the
source strictly containing the sensor** (otherwise the outer cells are partly
empty, which is missing data rather than sampling, and drifts the curve ~1%).
What survives agrees with the closed form to 2e-5 at a twelfth of Nyquist and
3e-3 at the last point below it, and **that residual is the target's own
staircase**: refining the source subdivision gives 0.964045 / 0.991060 / 0.997768
/ 0.999442 / 0.999861 at sub = 4 / 8 / 16 / 32 / 64, an error falling ×4.00 per
doubling (measured 4.022 / 4.005 / 4.001 / 4.004) — the midpoint rule's own second
order. The rung pins the *rate*, because that is a closed form; pinning the 3e-3
would be pinning a previous measurement, the failure this doc's Part D order
section names as the expensive one.

**Exactly Nyquist is refused.** The modulation there is entirely phase-dependent
— 0.634573 with the target aligned to the pixel grid and **exactly 0** a quarter
period along, the target vanishing into the sampling — so it has no value to
plot. The 2/π = 0.63662 envelope is real; the point is not. Twice Nyquist is
refused too, folding to DC. A3's rule, on a curve rather than on a readout.

**And the contest could not be drawn as itself.** Plotting the three optics'
critical pitches against λ puts three nearly coincident straight lines on the
page — they differ by under 3% over the band — so the picture said only that
λ/(4·NA) is linear in λ while the table beside it carried the entire finding.
The quantity the finding is *about* is the departure from proportionality, so
that is what the plot draws, and the three separate immediately. This is A3's
rule ("a readout whose value is undefined must be refused") in its positive
form: **a plot must draw the quantity the claim is about, not the quantity the
claim is computed from.** It cost nothing to fix and would have been invisible
without putting it on a screen.

**And the star's peak gain is parity-dependent, by 3.7×.** This one came from
dragging the pitch slider and looked like a bug. `overlapWeights` is
sample-at-centre, so an **even** column count centres a cell on the axis and an
**odd** one puts the axis on a seam: the star either lands in one pixel or splits
between two, and the peak reads ~18.5 against ~5.0 as the pitch walks 12 → 20 µm
and the parity interleaves. It is not a smooth function of pitch and must not be
drawn as one. This is **§ 5r's own lesson with the roles swapped** — that step's
centroid rung exists because the energy and frequency rungs are blind to a
half-pixel shift, and here the *centroid* is the blind one, since the split is
symmetric. The flat field is immune to both, which is the third reason it is
worth computing: `resampleGridToSensor` of ones puts **exactly** footprint² in a
cell (1.000000000000 at footprints 2, 3, 4 and 5.5, integer and not), while the
star gains strictly less — 6.25 of 7.63 at footprint 2.763 — and the deficit is
the PSF core's curvature rather than anything the rebin did. Running only the
star would have made that deficit look like a defect.

**And the two guards this doc's own trait 2 requires were computed and not
displayed** — caught in review, before the panel was called done. Both bite
*inside this panel's own slider ranges*, which is why it matters here rather
than as a checklist item: at the fast end, singlet f/4 with a 20 mm aperture,
**1.45%** of the light leaves the grid (where § 3b says it *wraps* rather than
vanishing) and `geometricWeight` reaches **1.000000**. That second one is a
coupling no other panel has. Everything to the right of the picture — the
critical pitch, the verdict, the whole λ/(4·NA) contest — is about a
**diffraction** limit, and a fully geometric frame is not showing one: the
numbers stay true of the system while the picture stops illustrating them. The
thresholds are C1's unchanged, deliberately.

**And the refusal the panel was proudest of could not be reached from it.** The
pitch slider stopped at 20 µm, where a `pupilSamples` 32 frame of 174.2 µm
records **exactly 8** columns — `MIN_SENSOR_COLS`, and not below it — so the red
box existed only in the test suite, which reached it at 60 µm. A guard the
controls cannot reach is the same honesty problem as one that never fires, in
the other direction, and this doc has no prior entry for that failure mode. The
bound now lives in the adapter beside the constant it belongs to, and the rung is
on the *reachability* rather than on the number.

**What it cost that was not budgeted: an engine defect, and it was in a bracket.**
`fieldOfView` threw on a Newtonian at *every* sensor size. `fieldAngleAtImageRadius`
probed at a fixed 0.5° and doubled upward, which assumes every system passes half
a degree — and § 2f's diagonal wall stops a Newtonian's chief ray at 0.346° at
f/10, so an APS-C frame spanning 0.67° total was refused despite sitting well
inside. A bracket artifact presented as a physical wall, which is precisely what
this panel keeps catching in readouts, arriving in the engine. Fixed at § 5r.1 by
treating a failed chief ray as *data* — `null` is the same side of the answer as
"overshoots", so both send `hi` down — with the probe shrinking before it grows
and **the bisection body guarded too**, without which the crash moves rather than
disappears. The genuine refusal survives and is now separable, and the pin is that
the boundary lands on § 2f's own closed form to **4e-6** at f/8, f/10 and f/15,
bisected off `fieldOfView`'s own answers/refuses transition so the engine never
sees the formula. It is the second defect of exactly this shape after A6's
collapsing focus bracket (§ 1.6.1), which is now a pattern worth naming: **the
rungs run on the unfolded achromat, and a bracket that assumes its field passes
unnoticed until something folded arrives.**

### C5. The eye takes the aperture, and the apparent field belongs to the eyepiece — ✅ **landed** — *app wiring only, plus one engine fix it forced* — **pair**

`visual.ts` + `panels/visual.tsx` + `visual.worker.ts` +
`visual.ceiling.worker.ts` + `test/visual.test.ts`. `core/pupil/visual` (§ 5q)
has existed since roadmap step 5 with **one caller anywhere in the app, and it is
the microscope's** (D6): `afocalProperties`, `apparentFieldAngleRad` and
`visualSystem` were validated, exported and unwired, and no telescope had ever
been looked through. No rung was added *for the panel* — every physical number is
§ 5l's, § 5m's, § 5n's, § 5o's, § 5p's or § 5q's — and **one was added for what
driving it broke**, § 5l.1, which follows A6's and C4's precedent exactly.

**The shape is a picture, a readout block and two plots, and the break from the
house style is *where the image plane is*.** Every picture in this app is drawn
at whatever plane `bestFocus` chooses, because a focuser is free. An eye's is
not: the relaxed eye's retina sits at the reduced model's own paraxial focus, and
moving it is **accommodation** — something the observer does, with a size. So the
frame is formed where the retina is and the distance to best focus is reported in
diopters beside it. C4's refusal to auto-expose, in a second currency, and for the
same reason: normalizing it away would cancel the finding.

**Cost, measured.** The instrument is main-thread — ~10 ms, of which almost all
is the Plössl's secant solve (a Huygens is ~0.05 ms) and the achromat's (~1.5 ms;
a Cassegrain is closed-form arithmetic). Everything else on that thread is free:
the afocal solve, the pupil imaging, the field wall's ~50 chief rays, a 25-point
distortion curve and a 41-point aperture-collapse curve come to under a
millisecond together. Two things go to workers, and the split is D6's unchanged —
**sweeps of builds are worker work, sweeps of rays are not**: the retinal PSF
with its focus solve (~145 ms in the browser at pupilSamples 64; ~45–85 ms in
node), and the aperture ceiling, which is a bisection over ~14 eyepiece builds
(~120 ms Plössl, ~3 ms Huygens).

**Seven findings, three of which were wrong predictions first**, and two of the
seven exist only because the panel was driven rather than reasoned about.

**The headline: an eyepiece's apparent field of view is a property of the
eyepiece, and the app can prove it because both halves are measured.** § 5n names
the real AFOV *edge* as deferred — deferred as a **measurement**, not as a
capability, since `apparentFieldAngleRad` already refuses loudly when the chief
ray stops clearing the glass. Bisecting that refusal gives the object-space wall,
and it moves a great deal: **atan(r_e/f_o)**, landing within 1–6% of that closed
form, so a longer objective passes less sky. The *apparent* field it buys does
not move: across six instruments spanning 4× of aperture, 2.5× of focal ratio and
5× of eyepiece focal length — whose walls themselves spread **5×** — the apparent
field holds **58.3° to 59.0°**, under 3%. The two f_o's cancel, which is why a
catalogue prints AFOV on the eyepiece and never on the telescope.

**The catalogue's own formula is wrong in a direction, and by a fifth.** 2·atan(
r/f_e) has no trace in it. The real chief ray leaves steeper than |M|·θ, so the
field an observer actually gets is **larger** — 58.79° against 47.37° on the
default Plössl, **+24.1%**, which is § 5n's pincushion evaluated at the edge
instead of near the axis. On the panel's own curve that same distortion runs
**×4.00 per doubling** nearest the axis (4.005, 4.020, 4.046) and rises
monotonically to 5.07 at the wall — § 5n's residual octupling one power down,
with its companion convergence rung read from the other end: the drift *upward*
is what identifies the excess as fifth order.

**A computed Plössl cannot show more than ≈61° of apparent field, and what stops
it is not the eyepiece.** Bisecting the clear-aperture wall gives
**0.9615248·f_e** — bit-identical to the constant D6 measured on the microscope
conjugate, and scale-free the same way — and that widest glass buys **61.29°**
against the catalogue's 52.24°. So the ceiling is § 5j's *doublet* refusing an
aperture, arriving as a limit on how much sky an eyepiece can show. That is the
concrete reason ROADMAP's wide-field members (Erfle/Nagler-class) need transcribed
patents with more elements rather than a wider Plössl, stated as a number instead
of as a plan. Two panels now measure one refusal in two currencies — a length and
a solid angle — and neither has the constant typed into it.

**And the same comparison on a Huygens reads −35%, which is not distortion
changing sign.** This was the panel's most useful surprise, caught by driving it
rather than by reasoning: the Huygens' wall lands **38% short** of atan(r_e/f_o),
which says the chief ray is dying somewhere *behind* the field lens. § 5o says
exactly where, in prose, as a scope note — a Huygens' field stop sits **between**
its two lenses, so the eye lens runs out first — and the panel's two numbers turn
out to be enough to detect that with **nothing in the engine reporting which
surface clipped**: the bisected wall against the front rim's closed form is
0.94–0.99 for every Plössl measured and 0.61–0.78 for every Huygens, a gap wide
enough that the classifier is not a tuning. So the readout prints *which surface
is the field stop* and refuses to call the departure distortion when it is not.
The corrected sentence is the one this section nearly shipped: "the catalogue
formula is wrong in a direction" is true of a Plössl and is a statement about the
**field stop's location**, not about eyepieces.

**Accommodation is not zero, and its sign belongs to the eyepiece — proved on a
control rather than argued.** The afocal solve is paraxially exact, so the
paraxial image is on the retina by construction and every micron of offset is the
composed chain's spherical aberration. Whose: the eye is a Cartesian ellipsoid
with none of its own for a collimated beam (§ 5q), so on a **Cassegrain** —
exactly stigmatic on axis (§ 5e) — the whole residual is the *eyepiece's*, and it
is **negative for both forms** (−0.124 D Plössl, −2.58 D Huygens at f_e = 8). Put
an achromat back and the Plössl's crosses to **+0.696 D**, because the
objective's own fifth-order residual and the eyepiece's oppose; the Huygens' only
shrinks. C1's Cassegrain-as-control move, in a third currency.

**The guard turns red on a *negative* demand rather than on a large one**, and
that is physics rather than a convention: a relaxed eye is at minimum power and
can only add. A chain whose best focus lands in front of the retina is asking it
to subtract — § 6q.3's "wrong side of infinity" arriving on the telescope
conjugate, from the opposite direction, since there it was the eyepiece placement
and here it is the eyepiece *form*. The Huygens does this at every focal length
the sliders reach, and because the frame is formed AT the retina its Strehl says
what that costs: **0.094 at f_e = 20** against the Plössl's 0.980 on the same
telescope. A panel that silently refocused could not have read that.

**And a diopter is the wrong unit for how much it hurts, which the panel shows by
printing both.** The demand is a length; the damage is a wave count over the beam
that actually fills the eye. A short eyepiece hands the iris a narrow exit pupil,
so it takes a *large* focus shift to spoil the same number of waves — on the
stigmatic control the demand falls ~4.4× from f_e 8 to 32 while the Strehl gets
**worse** over the same span (0.9988 → 0.988). Largest where it costs least, and
the two numbers must be read together or either one alone lies.

**The two-stop collapse is exact, and the picture is where it becomes a
statement about observing.** § 5q pins the closed form; what a panel adds is that
the drawn number comes off the entrance pupil under `limiting` selection and
never off a `Math.min` — `irisLimited` is *which surface won*, and it agrees with
the side of the knee at all 41 points. In the image the retinal Airy disc grows
by exactly D/(d_eye·|M|) — 3.20× at an eye pupil of 1 mm against 3.5 on the
default instrument — and the same ratio carries to the sky: **1.384″ becomes
2.769″**. Above the knee the frame stops changing to twelve digits at 3, 5 and
7 mm of iris, which is empty magnification's positive form: past the crossover
the telescope has stopped resolving what its aperture could, and no further
magnification is involved in either direction.

**What it cost that was not budgeted: an engine defect, and it was in the
splice.** `spliceModules` takes *surfaces*, not a `Prescription`, so a module's
`mirrorFrames` never reaches it — and the flat chain it returns carries no
declaration at all while the folded module's **tilt** rides along on its surface.
A Newtonian objective and an eyepiece therefore composed *silently*: an afocal
gap of **1405 mm** where the geometry has ~131, after which the chief ray missed
on axis. Fixed at § 5l.1 as a refusal in `reversePrescription`'s shape, pinned
against § 4b's own geometry and with an **unfolded Cassegrain of the same
aperture and focal length as the control**, so the statement is about the fold and
not about mirrors. It is the third defect of this family after A6's § 1.6.1 and
C4's § 5r.1, and it sharpens what that family is: the first two were **brackets
that assumed their own starting point**, and this one is a **declaration dropped
at a boundary** — different mechanism, same signature, which is a routine
answering confidently for a system it cannot express. The panel does not offer a
Newtonian, and it prints the engine's live refusal in the place one would have
been, so the cell starts working by itself if a later step composes folded
modules.

### C6. One screen is a speckle pattern, and only the mean is the seeing disc — ✅ **landed** — *needed a small engine step (§ 5d.1)* — **pair**

`seeing.ts` + `panels/seeing.tsx` + `seeing.worker.ts` + `test/seeing.test.ts`,
on `core/wave/long-exposure` (§ 5d.1). The only Part C item that was **not**
app-wiring-only, and the gap was an unusual shape — this doc named it correctly
in advance and one word of it turned out to be worth expanding.

**The engine step, and what it actually was.** § 5d's physics has been pinned
since roadmap step 5 — Fried's OTF, the seeing-limited FWHM — while the
*averaging* lived in `seeingEnsemble` inside `seeing.test.ts`, closed over that
file's aperture, grid and flat pupil, with no export. True numbers, unreachable
machinery: the app's existing dial could draw **one screen** and say so, and
nothing more. `longExposurePsf` is that helper promoted. Two things came out of
promoting it that the plan did not have. It could not live in `seeing.ts`,
because `psf.ts` imports `withPhaseScreen` as a value and `seeing.ts`'s back-edge
into `psf.ts` is type-only *by design*; the ensemble needs
`psfFromPupilFunction` as a value, so it is a module above both. And it takes a
**pupil**, not a system — a long exposure is many atmospheres over one
instrument, so `psf({seeing})` per screen would re-trace and re-fit for a result
that cannot change. `systemPupil()` was split out of `psf()` for that, and
`psf()` now calls it.

**The cost note this doc wrote in advance was right, and the reason was wrong.**
"120 screens, 14–20 s, compute-once, never a live dial" holds — measured at ~7 s
in node and ~12 s in the browser. But the bill is **not the transform**:
generating one 256² Kolmogorov screen with six subharmonic levels costs more
than transforming the pupil it lands on, so a **4× finer PSF grid is only ~1.2×**
the total. The screen count is the whole cost, which is why it is the one control
that is an explicit choice with its price on the button, and why the panel's
default is **1 screen** — the star panel's existing behaviour, so the surface
opens on exactly the thing it is about to correct.

**Five findings, and two of them are about what a formula is for.**

**The headline: 0.98·λ/r₀ is an answer only where the telescope is
seeing-limited.** The number every observer quotes is a statement about the
atmosphere with no aperture in it, which is fine until the instrument's own Airy
disc is the wider of the two. They are equal at 1.029·λ/D = 0.98·λ/r₀, i.e. at
**D = (1.029/0.98)·r₀ ≈ 1.05·r₀**, and **λ cancels** — the crossover is a
property of r₀ and the telescope, not of colour, because both angles scale the
same way. Measured on the Newtonian at 200 mm: under r₀ = 25 mm (eight Fried
cells across) the mean lands within **2%** of Fried. Under r₀ = 200 mm — one
cell, short of the 210 mm crossover — it reads about **a quarter wider than
Fried and a third wider than its own atmosphere-free disc**, staying under their
sum. So it does not fall back to the diffraction limit either: below the
crossover the two widths are comparable and they *convolve*, and neither
single-cause formula describes the result from either side. That is C4's "a plot
must draw the quantity the claim is about" arriving as a **validity domain**
rather than as an axis choice.

**And getting that right needed a unit corrected, which is the section's own
error to record.** The first version of this panel used **1.22·λ/D** as the
"diffraction FWHM". That is the first *zero's radius* — the Rayleigh criterion —
and the Airy pattern's actual FWHM is **1.02899·λ/D**, 19% smaller. The tell was
on screen and went unread for a while: the clean frame's caption printed "FWHM
3.60 px = 0.629″" while the mean's printed "17.09 px = 2.204″", two different
px→arcsec conversions in adjacent captions, the second wrong by **35%**. It
propagated exactly as far as a wrong unit does — it moved the crossover from
210 mm to 249 mm, and it made "short of the crossover the disc follows
diffraction" *pass*, because a width inflated by 19% happened to land on the
measurement. The test that checked it was comparing two of this file's own
formulas and structurally could not catch it. This is C1's "the fringe measure is
measuring something else" in a **unit** rather than in a normalization, and the
lesson is narrower and worth having: **an equals sign between a measured quantity
and a closed form is a claim, and it can be checked by reading the two sides.**

**The instrument's own quality is in the seeing disc, and a mirror is what
separates them.** On the same sky at D/r₀ = 4 the Newtonian — a paraboloid,
perfect on axis — measures **0.98×** Fried while a 200 mm f/8 achromat, whose own
Strehl is **0.609**, measures **1.09×**. The seeing disc a telescope delivers is
the atmosphere convolved with whatever the optic was already doing, and § 5d's
own numbers are all flat-pupil numbers, so this is not visible anywhere in the
ladder. It is C1's Cassegrain-versus-Ritchey control in a fourth currency, and it
is why § 5d.1's new rung runs the ensemble on a *traced* pupil.

**Where the measured transfer function leaves Fried is a property of the
ensemble, not of the sky.** The curve tracks exp(−3.44·(ν·D/r₀)^(5/3)) to a few
percent and then runs away — 40× by ν = 0.375 at 120 screens. That is not
turbulence: a mean over N screens has a residual speckle floor that does **not**
fall with frequency, so once Fried's exponential plunges under it the ratio
diverges. It is identified by moving: raise the screen count and the departure
point moves **outward**, and the low-frequency agreement tightens with it
(1.23× of Fried at 10 screens against a few percent at 120). The panel draws the
rule and says which of the two it belongs to, which is § 5d's own "the bins are
chosen above the noise floor" turned from a test-file comment into something a
reader can watch.

**The under-resolution guard turns out to be about the grid.** § 5d's
`maxGridPhaseStepWaves` is the only thing that catches an atmosphere the FFT grid
cannot represent, because the fidelity criterion runs on traced samples and is
blind to the screen. What driving this panel shows is that it is not a statement
about the *sky*: the grid step across the pupil is 2/pupilSamples, so doubling
the samples **halves** the step on a byte-identical atmosphere — 0.556 red at 32
becoming 0.288 green at 64, same r₀, same seed, same screens. Both halves are
reachable from the panel's own controls, which is C4's lesson applied on purpose
rather than caught in review.

**And the display scale had to be chosen after two wrong ones.** Three frames —
draw, mean, atmosphere-free — must share one white or the comparison is
fabricated. Referring it to the frames' shared **energy** (C5's encoder, and the
star panel's) blows all three out, because a PSF's peak is orders above its mean.
Referring it to the atmosphere-free **peak** fails the other way: under ordinary
seeing the mean sits at 6–8% of it and is a smudge. So the white is the **mean's**
peak — the frame the panel is about — and the other two clip by exactly the
ratios printed beside them. A10's rule is what makes that acceptable rather than
sloppy: **a factor is precisely what a picture cannot show the size of**, so the
peak ratios are numbers on the page (22.0% for a draw against 7.7% for the
120-screen mean) and the shade only has to make the shapes legible. The shapes
are the argument: speckle, disc, rings.

---

## Part D — the microscope you can look through

Parts A–C close the gap between what the engine can do and what the app draws.
This part is different in kind: it closes the gap between what the app draws and
what a **microscope** is. Today you can select one of ten objectives and watch it
form an image; you cannot build one, change its glass, put a slide under it, look
through an eyepiece, or see anything wider than a detail crop, in colour.

The priority is the last of those, and it is the one that looked impossible.
Everything below the first section is ordered behind it.

**Where that stands now.** The slide and the wider field are D1–D5 and are
walked — A7 is a stage you can pan. The eyepiece is D6 and is walked too, so
"look through" is an engine capability rather than a wish; ~~what remains unbuilt
is the *panel* for it~~ — **and that panel has now landed**, so the sentence this
part opens with is no longer true of the app either. Colour is D7 and has now landed as well, so a stained
section is an engine capability too. Building an instrument is D8 and has now
landed as well — so the opening sentence above is no longer a description of the
engine at all, only of the app's surfaces, which is what Part D is a queue for —
and **D10 has now landed too, so that queue is empty.** What remained anywhere in
this doc was A6 and Part B, neither of which was ever in Part D — and **both have
since landed as well**. So has **A9**, which is what "the scenes nobody has
authored" turned out to really be: the scenes existed and the *colour* did not.
What is left is Part C — whose **presets landed as C1 and whose two pupil masks
landed as C2**, so what remains there is the eyepiece/eye/camera modes and the one
item that needs an engine step — and the telescope's own star/planet/lunar scenes,
which are an engine step rather than wiring.

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
> this cost and deferred the fix to § 6p, which then landed as the pupil cache.
>
> **✅ Re-corrected by § 6s, back toward this table.** The radial map is now
> tabulated — the inverse chief-ray map is one-dimensional, so a table of 65
> chief-ray inversions serves a whole mosaic — and the raster falls from 1 046 ms
> to **2 ms** at grid 128. A whole traced tile goes 1 293 ms → 235 ms, which is
> D4's own 1 001-against-180 ratio delivered, so **the Abbe sum is the bill again
> and the figures in this table are once more the right order of magnitude for
> what a traced tile costs.** The 2 px per resolution cell the stage renders at is
> now a sampling choice, not a rasterizer budget. The warning above is kept
> because the reason it was written is the reason the fix exists.

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
0.33 s). Affordable for a tile, not for a mosaic of tens. The radial cache is
kept out of § 6n deliberately, because these rungs pin the *map* and an
interpolant underneath them would mean they pinned the interpolant.

**✅ It landed as § 6s, and on exactly that condition** — the cache is opt-in and
the exact bisection stays the default, so every rung above still runs on the map
itself. The step it was attributed to (D5/§ 6p) spent itself on the pupil
instead; what § 6s adds is that the map is *one-dimensional*, so a table of 65
chief-ray inversions serves a whole mosaic and registration costs 3.8e-13 px.

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

~~**Deliberately not attempted:** a mosaic under a *non-telecentric* condenser.~~
**Built at § 6x, and the omission was named after the wrong component.** A
Köhler condenser's cone does *not* tilt off axis — every diaphragm point lights
the whole field from one direction, exactly. What moves is where that direction
sits in the **objective's** pupil, by `h/R_ep`, and a mosaic is where that is
largest because a mosaic is how this branch reaches millimetres: 0.217 of a
pupil radius per millimetre on the 4×/0.10. Each tile is now lit from where it is
really lit from, and the one thing that does not go away is a seam — two abutting
tiles are at two field heights, so a seam carries an illumination step the guard
band cannot remove (§ 6o.7's floor, 7.8e-4 → 1.2e-3).

### D4. A7 — the stage: a brightfield field of view you can pan — *app* — ✅ **landed**

**Landed as `panels/stage.tsx` + `stage.ts` + a pool of `stage.worker.ts`**, and
it needed one engine addition after all — § 6o.8, below. Everything this section
asked for is on screen: the span against the field number, the guard *with* S and
the source count, the worst tile's verdict, tiles-and-elapsed, and a centre-first
queue. What it cost, measured on the DIN 4×/0.10 at ps 32 / grid 64 with a
208-direction commensurate condenser: **~300 ms a tile, 36 tiles in 3.3 s** across
three workers, and a pan that crosses no tile boundary renders **nothing**.
(**Superseded by § 6s** — the same tile is ~45 ms; see finding 2 below.)

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
   The rasterizer, not the Abbe sum, was what a traced tile cost. **§ 6s has
   since removed that half**: the panel runs its raster off a tabulated radial
   map (`RADIAL_MAP_NODES`), and measured on *this panel's own request* — ps 32,
   grid 64, guard 4, S = 0.5, the 208-direction commensurate source — a tile goes
   **293 ms → 45 ms (6.46×)**, the two pictures differing by 9.9e-15. So the
   ~300 ms a tile above is **stale rather than re-attributed**: what is left is
   the Abbe sum, and a stage tile is now ~45 ms.
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

### D6. § 6q — the eyepiece on the intermediate image — *engine step* — ✅ **done**, and its panel is ✅ **landed**

**The panel exists now** (`panels/eyepiece.tsx` + `eyepiece.ts` + two workers), which
closes the gap this doc's own accounting had lost — see "Suggested order". App
wiring only: **no new engine capability, so no validation-ladder rung.** What the
panel claims that no rung states is pinned app-side instead, in
`packages/app/test/eyepiece.test.ts` (20 assertions), which is A6's and D10's
convention. Six findings, and the first two are corrections to things written here.

- **It runs on the MAIN THREAD**, the first microscope surface since A2 that
  does. § 6q's composition really is first-order work — one affine gap solve,
  one chief ray, one marginal ray, one paraxial pupil image — so a whole
  instrument is **18–22 ms** and sits under a live slider, exactly as this
  section predicted. What does *not* fit is neither physics nor wiring but
  **sweeps of builds**: a 21-point focal-length sweep is 21 `plosslEyepiece`
  secant solves at ~7.5 ms each (222 ms on the DIN 4×, 274 ms on the oil), and
  the clear-aperture wall is a bisection over the same solve. Those are the two
  workers. The split on every previous surface was traces against wiring; here
  it is *builds* against traces, which is a different axis and is why the
  scheduling looks nothing like A2–A6's.
- **The negative control can FAIL, and that is not the instrument failing.** On
  the 100×/1.40 oil, `afocalTelescope` does not merely return a wrong gap — it
  **refuses**, because the spacing a collimated-in solve asks for is negative
  (−254.006 mm). So § 6q.3's point arrives one step earlier than § 6q.3 makes
  it: on a short-focus objective the telescope's placement is not unusable, it
  *does not exist*. The first draft of this panel let that throw propagate and
  reported a perfectly well-composed microscope as a broken one; the control is
  now guarded in its own line. **A negative control needs its own refusal path.**
- **§ 6q.9's "about 0.88·f_e" is a bracket, and bisected the wall is a
  CONSTANT.** This was very nearly written up as D8's own
  pattern ("a quoted wall turns out to be a function of a defaulted parameter"),
  on a probe that stepped the clear aperture by 0.5 mm and read ratios of 0.850
  → 0.887 across f_e 10 → 40. That spread is **inside the step's own
  quantization** (0.5/f_e is ±0.05 at f_e 10). Bisected to 1e-6 mm the ratio is
  the same at every f_e from 15 to 50, and the departure below that is
  `plosslEyepiece`'s **own air-gap floor**, `max(0.3, 0.02·f_e)`, which stops
  scaling with the design: force the gap to 0.02·f_e and all seven agree to six
  digits. So the form is exactly scale-invariant and the wall is a property of it.
  **The value has moved once since**, and in a way that confirms rather than
  disturbs this: it read **0.899195·f_e** (with 0.8902 at f_e 6, 0.8940 at 8,
  0.8962 at 10, 0.8977 at 12 below the floor) until § 6b.5.7 stopped the doublet's
  bending scan counting a root that is five times hemispherical and cannot be
  ground, and now reads **0.9615248·f_e** — with the same exact scale-invariance,
  the same air-gap droop below f_e 15 (0.9515 at 6, 0.9557 at 8, 0.9582 at 10,
  0.9599 at 12), and the same mechanism. A constant that moves when the mechanism
  under it is corrected, and moves *as a constant*, is the strongest form this
  measurement could take. That is this
  doc's recorded failure mode — *"the feasibility number will turn out to be
  measuring something else"* — arriving in the panel's own probe rather than in a
  rung, for the seventh time. And **the wall is the Plössl's, not the
  eyepiece's**: the Huygens has no cemented doublet to fail and no wall at all
  below the 1.5·f_e the search stops at, which the readout says rather than
  leaving blank.
- **The placement band closes as 1/f_e², and the departure from the thin-lens
  form is EXACTLY the eyepiece's thickness.** How far the eyepiece may sit from
  its solved position before the exit beam asks the quarter diopter an observer
  notices, bisected on the trace: **±0.157 mm at f_e 25**, ±0.025 at 10, ±0.403
  at 40. Read backwards as f_e²·(quarter diopter ÷ band edge), the thin-lens
  Newton form 1000·Δ/f_e² says that number is **1000 at every focal length**; the
  traced Plössl gives 997.1965, 996.2620, 995.3275, 994.3931, 992.5241, 990.6551
  at f_e 15 → 50. That is not "a drift" — it is **affine in f_e with intercept
  exactly 1000**, to seven digits, which is what a term proportional to the
  second principal plane's distance from the last vertex has to look like on a
  scale-invariant form. So the panel is entitled to call the gap between the two
  curves the thickness rather than merely noticing there is one, and the thin
  form stays drawn as a **label**, not as a rung. Checked before it was believed:
  the bisection was re-run at 1e-4, 1e-9 and 1e-13 relative and the numbers agree
  to 1e-5, so the departure is physics and not the search. This is the pair
  APP.md's third constraint asks for — § 6q's headline is a null (the exit beam
  is flat to f64 noise), and a null needs a plot of what leaving it costs. **And
  f_e 10 is the one point off that line**, by 400× the residuals it holds to
  above: the air-gap floor again, detected a second time by a quantity that has
  nothing to do with clear apertures.
- **The vergence has a pole**, at Δ = **−31.774 mm** on the panel's own fixture
  (DIN 4×/0.10, Plössl f_e 25, FN 20 — the same fixture every number in this
  bullet comes from), bisected and reported **with no mechanism attributed**. It
  is where the axial exit ray's *height* passes through zero, which is **not**
  the eyepiece's front focus crossing the intermediate image: at Δ = −FFD =
  −19.670 mm the vergence is −82.6 D, large, finite, and on the side an eye can
  at least partly accommodate. The flip is **12.1 mm further on**. § 6q.3's
  virtual-object diagnosis is right about the far *branch*, where the telescope's
  gap lives; it is not the pole's location, and the panel does not claim it is.
- **The labelling correction, which is the one a reader would otherwise be
  misled by.** `pupils().exit.radius` is the aperture stop imaged **paraxially**,
  and `paraxialObjectNumericalAperture` is n·u off that same pupil geometry — so
  the two agreeing to 1e-7 is *one bookkeeping being self-consistent through a
  traced M*, which is what § 6q.5 pins and is weaker than two independent routes
  meeting. A6's "traced" was a real marginal ray; this is not, and calling it
  traced would have been precisely the failure this ladder keeps catching. What
  *is* traced here is the magnification (a real chief ray's exit angle) and the
  engraved NA (a real marginal ray's launch sine). The panel labels all three by
  what computed them.

**§ 6q.5's headline arrives live, and it is why this panel exists at all.** On
the 100×/1.40 oil the exit pupil reads **1.7767 mm**; the invariant in its own
(paraxial) NA gives 1.7767; the textbook `500·NA/M` gives **0.7002 — off by
−60.59%**, because sec u is 2.5372 there and n·u is 3.5521, larger than the
immersion oil's own index. Both forms are plotted, the wrong one deliberately, and
`sec u` is the guard that says when they part company (1.0050 dry, 1.0206 on the
Lister, 2.5372 on the oil). `usefulMagnificationRange` is shown on the **engraved**
NA — the way the textbook rule is stated — with sec u beside it, rather than the
panel minting a competing "honest" range: the ladder's claim is about which NA the
invariant takes, not about what a real oil objective's exit pupil measures.

**Open, and unchanged by the panel:** the retinal PSF (there is no image plane
behind an afocal exit, so nothing is rendered here and that is the physics), the
eyepiece's own aberrations at this conjugate, colour, and the exit pupil off axis.

The original scope and what § 6q found follow, unchanged.



**Landed as `designs/visual-microscope` + `trace/compose`'s `collimatingGap` +
the visual readouts in `pupil/microscope` and `pupil/visual`, with 24 rungs in
VALIDATION.md § 6q.** Everything this section asked for is pinned: the total
magnification against a stated near point, the exit pupil, the two-stop collapse,
empty magnification, the field number and eye relief.

**This section's own prediction was wrong, and it is the sixth time in the same
direction.** It said `visualSystem` and `afocalProperties` "compose unchanged".
Neither does. `visualSystem` calls `afocalTelescope` *internally*, so it commits
the exact error this step exists to fix — it would place the eyepiece for an
object at infinity — and `afocalProperties` reads its magnification off a
`{y: 1, u: 0}` collimated input, a quantity a finite-conjugate chain does not
have. `visualMicroscopeSystem` and `microscopeVisualProperties` are the
replacements, and they are short because the *pupil* half genuinely does survive:
an exit pupil is the stop imaged through whatever follows it, whatever the object
is doing. `plosslEyepiece`, `huygensEyepiece`, `reducedEye` and
`apertureStop: "limiting"` all did compose unchanged.

**Three things this section did not anticipate:**

1. **The negative control has a number, and it is decisive.** The telescope's own
   gap on the same two modules leaves **+70.5 diopters** against 1e-11 for the
   solved one — 280× the quarter diopter an observer notices. The sign is the
   diagnosis: the gap is short enough to put the eyepiece 132 mm *in front of*
   the image it should collimate, so the exit beam **converges** 14 mm past the
   eye lens, the side no accommodation can reach. Justified numerically rather
   than by argument — and by a trace rather than by reasoning, which had it
   backwards.
2. **The sign was wrong first**, and algebra did not catch it — a degenerate case
   with a known answer did. A single positive lens with the object on its front
   focus is a magnifier, and a magnifier is erect at +D/f; on the corrected
   definition it reads +5.00 and the compound instrument reads −40. The loupe is
   kept as a control rather than deleted once it passed.
3. **The textbook exit-pupil formula is wrong at high NA.** `exit pupil =
   500·NA/M` is the Lagrange invariant, which is a law about paraxial *slopes*;
   the engine's two object NAs are exactly n·tan u and n·sin u (ratio sec u, to
   f64). Fed the tangent one the law is exact; fed the engraved sine NA it misses
   by 0.50% at NA 0.10 and by **61% at NA 1.40**. Any panel printing an exit
   pupil for an oil objective has to pick, and this is which.

**What it buys A7, and what it costs:** the circular field stop is a *real*
annular surface at the intermediate image, so a field beyond it vignettes in the
trace rather than being checked for — the specimen circle is FN/M_obj, 5 mm on a
4× with FN 20, which is the number A7 already prints its own span against.
Composition is first-order work only (one affine solve, no FFTs), so a build is
microseconds and it can sit under a live control.

**One thing a builder has to handle:** § 5j's doublet form walls out again. A
computed Plössl admits a clear aperture of about **0.88·f_e** — 22 mm at
f_e = 25, refusing 24 — so FN 20 sits at the edge of what the form can hold, and
a genuinely wide field is the transcribed patent members (still blocked on real
published prescription data), not a wider aperture on this one. A field-number
control must expect the engine's refusal, exactly as A1 established.

The original scope follows, unchanged.

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

### D7. § 6r — polychromatic brightfield — ✅ **landed**

**Landed as § 6r** (`imaging/brightfield-spectrum`,
`packages/core/test/brightfield-spectrum.test.ts`). The branch is in colour and a
stained section looks stained. What follows is what the step corrected in the
scope below, then the original text.

**The premise was right and the plan under it was wrong.** The diagnosis holds
exactly: S needs no conversion, `pupilSamples` does, and stacking bin-for-bin
would be § 2e's error again. But "`wave/polychromatic` already stacks on a common
physical grid" is the part that does not survive. Its resampler carries an energy
Jacobian `k²`, because `Psf.intensity` holds energy per pixel; an Abbe image
holds an **irradiance** — measured, not argued: a clear field images to exactly 1
at every `size` and every `pupilSamples` — so the Jacobian must not be applied.
Applying it multiplies each plane by (λ_ruler/λ)², which tilts the lamp as 1/λ²
and turns a neutral specimen blue. **Energy cannot see it**, since nothing is
lost either way; the witness is a colour cast. There are now two named
resamplers, `resampleEnergyGrid` and `resampleIrradianceGrid`, with the physics
in the name.

**Two more things a builder has to handle.** The common grid is the **bluest**
plane's and one pixel interior, not the mean's: an extended image has no skirt,
so what a resampler cannot source is a λ-dependent black border — a coloured
vignette on a clear field, measured at 0.05 of chromaticity. And a polychromatic
stack's `pupilSamples` is set by the **blue end**: the DIN 4×'s blue plane is
worst-resolved by **2.56×** where λ alone gives 1.22, and at 32 bins it rules
`no-honest-image` while 550 and 650 nm rule `valid`. A panel offering a
wavelength count has to raise the pupil lattice with it, or the engine will
correctly refuse the bluest plane.

**What it costs, corrected — and then corrected again by § 6s.** Everything
multiplies by the wavelength count: one tile trace, one `rasterizeSpecimen` and
one `renderBrightfield` per λ. The raster was the dominant term (§ 6n's 0.12
ms/px), which is exactly what made it worth caching, and since § 6s it is a table
lookup — `radialMapNodes` on `brightfieldSpectralStack`, **one table per
wavelength** because the inverse map is λ-dependent and the covering builder
refuses to span two. Measured on a 3-λ stack at 64² / ps 32: 1 625 ms → 741 ms,
so what a colour panel costs is now the Abbe sum times the wavelength count and
nothing else. Nine wavelengths at 64² is still minutes. A colour panel is a
compute-once surface, not a drag surface, and D0.1's rule applies unchanged.

**What is still open**, and it is the third rung below: there is **no singlet
finite-conjugate objective in the engine**, so the singlet-versus-achromat
contest cannot be run. `finiteConjugateObjective` is built on
`achromaticObjective`, whose split divides by V₁ − V₂. Its *substance* landed —
the colour is the optics and the specimen, not the display, pinned at 1e-12 —
and so did the second rung, but the contest itself is a design step. A
polychromatic **mosaic** is also open: the useful span is ∝ λ, so § 6o's pitch
and guard band would need one reference λ and a crop.

The original scope follows, unchanged.

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

### D8. A8 — the microscope builder — *app wiring only* — ✅ **landed**

Independent of everything above, cheap, and the direct answer to *"can we compose
one and change its components?"* — which was *no*: `MICROSCOPE_CATALOG` was ten
hardcoded rows calling `din(4, 0.1)`, and the constructors' other parameters were
defaults nothing exposed.

Shipped as `packages/app/src/builder.ts` (pure adapter, `render.ts`'s pattern for
the sixth time) plus a `BuilderPanel` route. The form is the list this doc
scoped — architecture, form, magnification, NA, crown and flint, tube focal
length or optical tube length, cover slip thickness and glass, objective
orientation, infinity-space length, the Lister's split and separation, the
dome's meniscus count and immersion fluid — and A1's readouts run against
whatever it builds, **literally**: `describeSystem` was extracted so the
catalogue and the form share one function rather than one copying the other.

**The catalogue is now generated from the same specs**, so the design space
provably contains it: each of the ten entries carries a `BuildSpec`, its preset
button reloads it, and the systems it builds were checked identical — object for
object, and message for message on the rows that refuse — against the two-argument
calls they replaced. **That check was a one-off and is a standing rung since Part
F**, which is where it belonged once every imaging panel started sending a spec
and no second path remained to catch a preset that drifted.

**The one trap, and it is why `CoverslipChoice` has no absent case.** The two
engine specs read a missing slip in *opposite* directions:
`FiniteConjugateObjectiveSpec.coverslip` omitted means bare in air, while
`HyperhemisphereSpec.coverslipSpec` omitted means a real 0.17 mm D263 slip and
`null` is what means bare. An optional field would have inherited both readings
and given every DIN preset a cover slip it was never built with — silently moving
A1's landed numbers, with nothing on screen to say so.

**Three findings, and two of them correct numbers this doc and the ROADMAP quote
as constants.**

1. **The walls are not constants, and the panel therefore measures rather than
   quotes.** `measureApertureWall` bisects the refusal boundary for the spec in
   the form, every other control held — ~15 solves, 130–220 ms — and the guard
   colours the traced NA against *that*. It reproduces § 6e.4's oil ceiling
   exactly (**1.4110**) and then shows what moves it: **1.4717** with no slip,
   **0.9661** with one meniscus instead of two (which is § 6e.3's "one is not
   enough at either" as a number), **1.3161** in water.
2. **§ 6d's NA 0.343 is the aplanat's wall at one choice of two *stated*
   parameters.** At the engine's own defaults (split 0.6, separation 0.6) the
   same form stops at **NA 0.273**; at (0.5, 0.3) it reaches **0.345**; at
   (0.7, 0.8) only **0.165** — a factor of 2.1 across the very grid § 6d checks
   its solve over. The engine's own refusal text already names the possibility
   ("…*or this split/separation/orientation admits none*"); what a builder adds
   is which of the two is binding at the defaults, and it is the split. The wall
   is **flat in magnification to four figures** (M = 10, 20, 40, 100), which is
   the form's scale-freedom arriving as a measurement.
3. **The cemented doublet's limit is much more nearly a focal ratio than an
   aperture — and it is not f/4.1.** § 6b records "the 4× sitting at f/4.1 — the
   edge of the cemented-doublet form", and f/4.076 is indeed where the DIN 4×/0.10
   sits — but the form survives to **NA 0.1843**, which is **f/2.27**. Checked the
   way § 6d checks its own form claim, on two glass pairs rather than one:

   | | NA wall, M = 4 → 40 | working f/# there |
   |---|---|---|
   | N-BK7/F2 | 0.1843 → 0.2218 | f/2.266 → f/2.357 |
   | fused silica/F2 | 0.1915 → 0.2293 | f/2.212 → f/2.315 |
   | N-BK7/F2, crown-first | 0.1792 → 0.2074 (M = 4, 20) | f/2.268 → f/2.386 |

   **Every NA in that table has since moved twice.** § 6b.5.6 took the fixed
   point's thin-lens seed off the boundary and the walls went out 2.9%–10.6%;
   § 6b.5.7 then stopped the bending scan counting roots that are not lenses, which
   moved them again — **out** flint-first and **in** crown-first, the latter
   refusing designs that used to build. The table now reads N-BK7/F2
   **0.20427 → 0.26918**, silica/F2 **0.19039 → 0.25030**, crown-first
   **0.17152 → 0.20174** (M = 4 → 20). Note the *order* of the two glass pairs
   reversed with the second move: against the scan window silica/F2 reached 6%
   further, against |c|·(D/2) = 1 it reaches 7% less. The *shape* of the finding
   survives (the ratio is far tighter than the aperture) and the interpretation
   below is unaffected, because what this panel bisects was never an optical
   boundary.

   Across two pairs, two orientations and four magnifications the NA wall spans
   **0.179–0.229** (28%) while the ratio at it spans **f/2.21–f/2.39** (8%) — about
   3.5× tighter, so the ROADMAP's instinct to quote a ratio is right and the
   *number* is a landmark rather than the edge. The optical tube length does not
   move it at all (0.1843 at x′ = 100, 150 and 250 mm), which is the same
   scale-freedom the aplanat shows in M. **Flagged, not pinned:** these are probes
   of the composed build, not ladder rungs, and "the doublet's ceiling is a focal
   ratio ≈ f/2.3, and the ratio is the invariant" is left as an open question for
   § 6b rather than quietly added to the ladder — D8 is app wiring and adds no
   physics.

   **That question has now been answered at § 6b.5, and refusing to pin it here
   was the right call — because what this panel measures is not an optical
   boundary.** At NA 0.1843 the wavefront is **3.45 waves, 48× Maréchal**; the DIN
   4× stops being diffraction-limited at **NA 0.10311 = f/3.956**, so § 6b's
   original "the 4× sits at f/4.1, the edge of the form" was right to 3% and this
   row's "f/4.1 is a landmark rather than the edge" is **withdrawn**. The wall
   `measureApertureWall` bisects is `achromaticObjective`'s refusal locus, which
   **contains no aperture by construction** — which is precisely why the ratio at
   it looked like the invariant. On the external criterion neither measure is: the
   reach spans **77%** in NA and **40%** in ratio over M = 4→40. So the panel's
   guard is honest about what it is (where the engine first says no) and the
   *interpretation* in this paragraph was the part that overreached. **The pattern
   this doc keeps naming, on its sixth repetition and in its sharpest form yet:
   the feasibility number was measuring something else** — and this time the
   surface that found it was a ladder rung reading the panel, rather than a panel
   reading a rung.

   **Two smaller corrections to this row.** The three ratios are not
   interchangeable — F\* = 1.904 is the refusal locus, f/D = 2.023 the converged
   geometry, and the **f/2.266 quoted above is the *working* ratio**, 2.023 × the
   1.12 glass margin — so a number lifted from this table into an engine context
   will be 12% off. And the wall's independence of the optical tube length, read
   here as three equal measurements, is an **identity**: f cancels out of the
   seed's f/D, and § 6b.5 pins the three as bitwise equal.

**Two refusals in this panel are the app's, not the engine's, and they are styled
apart.** DIN × Lister and DIN × oil have no engine call to refuse them (the
finite-conjugate Lister is a named open item in ROADMAP § 6d), and neither
`MicroscopeObjectiveSpec` nor `ListerObjectiveSpec` has anywhere to put a cover
slip. `AppRefusal` tags those, `describeBuild` reports `source`, and the panel
prints them in amber with "this sentence is the app's" — because an engine
refusal is a measured finding and this repo does not let app text wear that voice.
The slip control therefore means **three** things across the four forms —
*corrected for* (§ 6c's `targetS1Mm`), *looked through* (§ 6e.1's plane stack),
*not expressible* — and the panel says which rather than presenting one uniform
knob whose meaning changes underneath it.

**Cost, measured, and it splits in two.** A refused build is 3–8 ms. A whole
submit is ~140 ms for the DIN doublet, 313 ms for the oil form and 344 ms for the
Lister — of which the **wall bisection is 103–213 ms** and the build-and-frame is
the rest: **38 ms** for the DIN, which is A1's ~50 ms estimate delivered, but
**131–181 ms** for the two-group forms, where A1's number was never measured. So
the estimate below held for the case it was made about and understates the
aplanat by 3×, and the panel prints the two halves separately rather than letting
one hide the other. It is a form-submit cost either way: nothing recomputes until
the button is pressed, which is how this surface buys the honesty every other
panel pays backpressure for.

**§ 6b.5.6 made the DIN half of that ~10× more expensive, and the number is here
rather than in a footnote.** The wall bisection for the DIN doublet now measures
**~1.15 s** (4×/0.10 and 40×/0.20 alike) against the 103–213 ms above. Nothing in
the app changed; what changed is the price of a *refusal*, which is half of every
bisection's samples: `finiteConjugateObjective` no longer takes one refused
bending scan as a verdict, it holds the aperture back, re-closes its fixed point
and bisects the hold-back until the bracket collapses — tens of scans instead of
one. The two-group forms are untouched (**78 ms** Lister, **74 ms** oil) because
they refuse for reasons that never enter this path. The panel's own structure is
what makes that liveable — it is a form submit, not a keystroke — but a 1.15 s
button is a different thing from a 140 ms one and this row should say so.

### D10. A5's z-slider through a real mount — *app wiring only* — **pair** — ✅ **landed**

A5 gained a **mount** control (`matched` / water / immersion-oil / air) and a
**depth** control, and the picture, the axial sweep and a new third plot all run
off them. `mountPupils` is the `DepthPupils` the module used to fill with
`defocusing`, and `mountVolumeOptions` emits the four coupled numbers so
`renderVolume` divides by the mount's index and not the immersion's — § 6l.9's
refusal is what stops that from being a thing a panel can get wrong, and it is
also why the panel's own depth of focus had to be re-derived in the mount: a plane
step is half a wave only if the same n is in both.

**Three headline results, and only one of them is the picture.** The delivered NA
is capped at the mount's own index — a readout and not a blur, since no ray of
higher invariant leaves the specimen. The axial response stops being even in the
defocus. And the third-order depth budget over-reports what a bisection on the
Strehl actually finds. The **pair** was mandatory for constraint 3's reason and
then some: two of the three cannot be seen in a frame.

**What it measured that was not predicted here.** Four things, and the first two
are corrections to this section as it was written.

- **The numbers this section quoted are § 6l's probe, not the panel's.** 19.24×,
  +1.11 waves and 4.51× are all **NA 1.2 on an ideal pupil**, and no catalogue row
  is NA 1.2. The panel computes its own: on the **oil 100×/1.25 in water** the
  budget over-reports by **5.75×** (18.71 µm quoted against **3.25 µm** bisected),
  and at 10 µm of depth the axial response is **13.17×** asymmetric with best focus
  at **+0.72 waves**. The engine's own figures are cited on the page as § 6l.4's
  and § 6l.7's reference points and labelled as such — this doc has been burned
  once already by quoting a core probe as a panel's number.
- **The asymmetry needed a control the step had not thought of.** A1 traces to the
  system's *own* image plane, so a row carries a residual defocus that is already
  an asymmetry about w₂₀ = 0 with no mount in it: the 100×/1.25 reads **0.47×** at
  zero depth. Quoting the mounted 13.17× alone would hand that share to the mount —
  whose own contribution is **larger** at 16.88×, because the objective's residual
  works the other way. So the panel prints three numbers where the step expected
  one: mounted, the mount's own (ideal pupil, same NA), and the objective's at zero
  depth. The prediction below about D4 needing something D0 did not measure holds
  for D10 as well, and this is its version of it.
- **§ 6k.4's support-edge check comes apart, and the split is § 6l.6's.** The
  missing cone stays **empty** through a mount (ν = 0 reads ~2e-15, unchanged),
  because that needs only an amplitude that does not move with depth. The support
  *boundary* ν·(2 − ν) does not: it is a **defocus-only** law, derived from a stack
  whose members differ by nothing but w₂₀, and the edges move by up to **10 axial
  bins**. So the panel shows those amber as a measurement rather than red as a
  failure, and says which. § 6l.6 pinned half of this pair; the other half only
  appears when something draws the edges beside it.
- **A rule neither § 6l nor § 6k had reason to state: no plane may sit above the
  coverslip.** The volume's z origin is the slip's underside, and a plane at
  negative z crosses only what the objective was corrected for — so its aberration
  is *zero*, while a stack linear in depth continues through negative thickness and
  signs the mismatch backwards. A5's slab was centred on z = 0 and its cone stack
  spans ±4 waves, so both would have reached it. The depth control is therefore
  anchored to the slab's **top face** and the cone stack to its **shallowest
  slice**: unreachable rather than clamped. This was found by a test, not by
  reading.

**Cost, measured.** The picture is A5's, and the mount does not move it: matched
against mounted at ps 32 / grid 128 over 5–27 planes measures 0.85–1.26× with no
trend, which is run-to-run noise on a five-run best-of, since the mount adds one
term to a callback already being evaluated per slice. A5's own table above is
therefore left standing rather than restated — it was measured in a different
session and this step has no reason to move it. The axial job goes
**509 → 675 ms** in node when a mount is on it (the cone stack pays
`stackWavefrontErrorMm` per lattice point). The new depth job is **230–360 ms**,
in its own worker and keyed on the objective and mount **only** — a sweep over
depth must not recompute when the depth slider moves.

**That job is a rung's worth of compute done in a fifth of a second**, and how is
worth stating because neither half touches the physics. § 6l.4's own bisection
takes minutes: 162 transforms per focus search, 22 bisection steps. The panel
replaces the focus scan with a **golden section seeded at the least-squares
balanced defocus** (10 transforms) and wraps the pupil in an **exact memo** — no
interpolation, no lattice arithmetic, just the first evaluation at each point
cached, which matters because a traced pupil is a 28-term Zernike sum per sample
and the mount's phase is a stack solve per sample: 1.9 ms and 4.0 ms of a 5.8 ms
transform whose FFT is 0.23 ms. Together they take a kernel from 5.8 ms to 0.5 ms.
Run at § 6l.4's own probe it returns **4.735 µm and 4.51×**, the rung to the digit,
at grid 64 — which is § 6k's measured grid-indifference for a DC readout being
spent rather than re-argued.

**The over-report has a floor at 0.9501 and it is not the third-order form.**
Maréchal's λ/14 is an *approximation* to Strehl 0.8 — exp(−(2πσ)²) there is
0.8177 — so a bisection at 0.8 runs 1.0525× deeper at *every* aperture. Measured:
**0.95 on every dry row in the catalogue**, where third-order theory has nothing
left to be wrong about. Everything above that floor is § 6l.4's departure. The
panel prints the floor beside the ratio, because a reader who did not know it
would read 0.95 as the budget being 5% pessimistic.

**Both `mountDepthTolerance` refusals are content.** An oil 1.40 on water is
refused because the ceiling is *open* — the delivered 1.3334 is a supremum, so
even it is not an aperture the budget may be quoted at — and a matched mount is
refused because there is no budget on a hard zero. The panel prints the engine's
sentence in both cases and still bisects in the first, since a mask's boundary is
one lattice point of measure zero. That is § 6l.9's supremum-and-not-maximum
asymmetry as two different things a reader can click on.

**The identity, stated exactly.** A matched mount costs identically zero at every
depth — `toBe(0)`, an explicit (n_s²−n_i²) factor — and `withMountAberration`
returns the pupil object itself, so no arithmetic happens at all. The *render* is
f64-identical rather than bit-identical, and the reason is arithmetic and not
physics: a slab authored at absolute depths computes (D + z) − (D + f) where it
used to compute z − f. The doc said "bit for bit"; the test says which half is.

**And the branch's first app test file.** `packages/app/test/volume-mount.test.ts`
— 14 rungs on the *wiring*, not the physics, plus `packages/app/tsconfig.test.json`
so `npm run typecheck` covers it. A5's precedent ("no engine capability was added,
so no validation rung was") still holds and no ladder rung was added; what changed
is that D10's invariants are about a panel placing a slab, which no ladder rung
could have held.

### D9. What stays out, and why

- **A live full-field frame.** D0.1. Compute-once or nothing.
- ~~**Non-telecentric illumination.**~~ **Closed at § 6x**, engine-side, and it
  needed no panel decision: the cone's displacement is read off the trace, so
  every microscope surface that renders brightfield got it without a control. Two
  app-visible consequences, both small and both measured. The stage's two goldens
  moved by **1–2 levels of 255 on under 0.15% of pixels** — structurally the same
  picture, which is the harness doing exactly its job. And **the stage's off-axis
  tiles lost § 6p's pupil cache**, because a source displaced by a traced offset
  is no longer on the pupil's lattice: **404 ms on the anchor against 727 ms off
  it**, 1.8× and flat with distance. That is the whole app cost — A9's colour
  section renders an axial frame and keeps the cache, and A4's fluorescence never
  translates its source at all (§ 6x.3). The 1.8× is smaller than § 6p's own
  10.76× for § 6s's reason: the radial-map cache put the Abbe sum back as the
  bill, so the pupil saving is a smaller share of a tile than it was.
- **Köhler illumination as a light budget.** `abbeImage` normalizes the source
  weights to Σ = 1, so closing the diaphragm costs resolution and no light where
  a real one goes dim — A2 already prints the mean so the normalization is not
  hidden. A field diaphragm and a real photometric budget are their own step, and
  the honest note stays on screen until then.
- **Confocal, deconvolution, DIC, phase contrast.** Unchanged: § 6j's excitation
  path and v2's Hopkins TCC.

### Order

**~~D8 first if the goal is breadth~~ — walked.** It was independent, app-only,
and it turned ten rows into the whole design space; the ten are now generated
from the same specs the form edits, so the space provably contains them. What it
found was not breadth but that **two of this part's quoted walls are not
constants** — see D8 — which is a builder's characteristic result and not one any
catalogue row could have produced.

**Otherwise, the priority path was ~~D1~~ → ~~D2~~ → ~~D3~~ → ~~D4~~, and it is
walked**: the off-axis frame, the rasterizer that registers it, the mosaic that
bounds its error and the stage that draws it have all **landed**. **D5** landed
alongside and makes it fast — though *only* fast: § 6p measured down § 6o's belief
that it would also lower the mosaic's error floor. **~~D6~~** landed after it, so
the instrument ends at an eye rather than at an image, and **~~D7~~ has now
landed too** — the branch is in colour. **Every engine step in Part D is done**,
and so is the one engine step that was never in Part D at all: **§ 6l**, the
depth-dependent spherical aberration this doc had listed as *disqualified*, which
closes the microscope branch's last numbered gap and turns A5's stated omission
into **D10**.

**~~D8~~ has now landed too**, and so has **~~D10~~** — so **Part D is walked, end
to end.** *(And since then **~~A6~~** has landed as well, and so has **~~the D6
panel~~** this section's own accounting had lost — see "Suggested order" — so what
is left in this doc is Part B, Part C, and the scenes nobody has authored — and
**~~Part B~~ has now landed too**, so it is Part C and the scenes. **And "the
scenes" was the wrong name for what was missing**: they were authored at A7 and
what had no caller was § 6r's colour, which is **~~A9~~**, now landed. So it is
Part C, and the telescope's extended sources, which are an engine step. **And Part C
turned out to contain a C3 this doc had never listed** — `core/mech`, which ROADMAP
had in bold and APP.md had nowhere, because this doc sorts by branch and a
mechanical layer has none. It has landed; what remains in Part C is the
eyepiece/eye/camera modes and long-exposure seeing. **And ~~camera mode~~ has now
landed too, as C4** — the first Part C entry to force an engine fix, which is A6's
heading arriving on the telescope side. What remains in Part C is the
eyepiece/eye modes and long-exposure seeing, the last of which is the only item
left in this doc that is not app wiring.)* D10 was billed as the cheapest engine-backed surface in the doc and the
picture half of it was: the mount is one more term in a callback already being
evaluated per slice. The two things it cost that were not budgeted are both about
*comparison* rather than about rendering — an ideal-pupil control the axial
asymmetry turned out to need, and a Strehl-versus-depth job that had to be made
250× cheaper than the rung it reproduces before it could sit in a panel. A6 and
Part B were untouched by all of this and were what was left in the doc; **both
have since landed**, and Part B's own version of the pattern is that the thing it
did not budget for was *scaling its own sliders* — which costs more than
everything it scales.

**The one engine number that changed the queue — and has now been spent.** D4
found the *rasterizer*, not the Abbe sum, is what a traced tile costs (see D0.1's
correction), which made § 6n's deferred radial-map cache the branch's dominant
per-tile cost and its named next optimisation; D7 then multiplied it by the
wavelength count. **§ 6s built it.** The inverse chief-ray map is
one-dimensional and belongs to the *system*, so a tile's 16 384 pixels are
queries of a single tabulated curve and a whole mosaic pays 65 chief-ray
inversions rather than 65 per tile: the raster falls 1 046 ms → 2 ms at grid 128,
a whole traced tile 1 293 ms → 235 ms, and registration is 3.8e-13 px — nine
orders below D4's own 3.4e-3 px of ruler drift.

**So the cost model is corrected a third time, back the way it came: the Abbe sum
is the bill again**, exactly where D0.1 had it before D4 moved it. On core's own
probe (an ideal 21-point source, grid 128) a whole traced tile is 1 293 ms →
235 ms, which is D4's 1 001-against-180 ratio delivered; on **the stage's actual
request** — 208 commensurate directions, ps 32, grid 64 — it is 293 ms → 45 ms,
6.46×. Either way what a tile costs is set by the transform once more. The
stage's 2 px per resolution cell is now a sampling choice rather than a
rasterizer budget, and the next optimisation in this branch is not the one this
paragraph used to name.

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

## Part E — the bench editor — ✅ **landed** — *app wiring only* — **form**

ROADMAP's v1 line, and the last item step 5 left open that is not an engine step:
*"bench editor over the prescription schema; exact + paraxial tracing; glass
catalog."* This document had never scoped it, for the same reason it had never
scoped `core/mech` (C3): APP.md sorts by branch, and a `Prescription` has none.
The registry could not have caught it either — the panel it names is `bench`,
which is A1's objective table and a different surface entirely. **Only ROADMAP
carried it**, which is the C3 lesson arriving a second time.

**Route `#/editor`, `src/editor.ts` + `src/panels/editor.tsx`.** D8 edits the
arguments a constructor is called with and the constructor decides what surfaces
exist; this edits the surface list itself — one row per surface (kind, R, conic,
semi-aperture, thickness, medium, stop), plus the four specs a `Prescription`
does not carry, plus a seed row of designs the engine built.

### What it found

- **The order of the surviving aberration is measurable off the aperture alone,
  and it is this panel's own result.** Halve the stop and the on-axis RMS at best
  focus falls by 2^p, where p is the lowest order that has *not* been corrected.
  The BK7 singlet reads 3.01, 3.00, 3.00 across three halvings; the achromat
  2.75 → 2.94 → 2.99, settling as the higher orders die faster than the one being
  measured; and the **DIN 4×/0.10 objective reads 5.20 → 5.05 → 5.01**, which is
  § 6b's ΣS_I = 0 confirmed by a route that never computes S_I. The two routes
  are printed side by side and neither is converted into the other.
- **The Seidel route refuses where the aperture route does not.** `seidelSums`
  declines a conic outright ("spherical surfaces only — a conic/asphere adds an
  uncomputed term"), so the Cassegrain has no third-order column at all. That is
  why the readout is **sectioned**: each of paraxial / pupil / exact / Seidel /
  order is its own numbers or its own refusal, because they fail independently
  and each failure is informative. An afocal chain has no EFL and still has a
  spot; a conic has no S_I and still has an order.
- **The aperture route needs its own honesty guard.** On the Cassegrain the
  full-aperture residual is 4.5e-14 mm — stigmatic on axis by construction
  (§ 5e) — so the exponent through those points would be the shape of the
  rounding. Below a picometre the panel says *none* and explains why, rather than
  printing the 1.45 / 1.33 / 0.70 the arithmetic produces.
- **The same NA, spelled two ways, was two different apertures — exactly
  1/√(1 − NA²) apart — and that turned out to be an engine defect this panel
  found rather than a fact about spellings.** `resolveStopRadius`'s `objectNA`
  branch read NA as a paraxial *slope*, while `finiteConjugateObjective` sizes
  its stop with the real `tan u` at `sin u = NA`: **0.50% at NA 0.10**, 15.5% at
  0.50, 3.2× at 0.95. Nothing landed moved — every design in `designs/` hands its
  chain a `stopRadius`, so the disagreement was only reachable by re-spelling one,
  which is what a form is for, and ROADMAP had recorded the branch as reached by
  no panel at all. It **was** reached, by this one, and the panel disclosed the
  discrepancy in a caption instead. ✅ **The engine now reads the sine
  (§ 1.5.1)**, the caption is retired for the half-angle itself, and
  `editor.test.ts` pins the *agreement* to twelve digits — keeping 1.005037815 as
  the size of what was fixed so the number does not vanish with the defect. This
  is the fourth entry in the C4 / A6 / C5 family (**a routine that answers
  confidently for a system it cannot express**) and the first where the app had
  already found the defect and built around it: a disclosure is a workaround, and
  a workaround in a landed panel is a finding this doc's accounting can lose.
- **An authored back focus is not a focus.** `refractorPair` writes its last
  thickness as the focal length — 500 mm for a lens whose BFD is 496.577 — and
  its own doc calls that a stand-in. So the panel carries a *solve focus* button,
  and the point of it is what happens afterwards: the exact best focus is still
  **95 µm** short of the paraxial one on the achromat, **1.302 mm** on the
  singlet, **1.352 mm** on the objective. That gap is the panel's subject and it
  is not an error in either tracer.
- **Which prescription to seed from is a real choice, and the first one was
  wrong.** `finiteConjugateObjective` authors the objective with a trailing
  thickness of **zero** and lets `finiteConjugateMicroscope` place the image, so
  seeding from the objective alone opens the form on a design whose image plane
  is its own last vertex: a **3.25 mm** spot for a lens that is 14 µm at focus.
  Seeded from the chain instead, and cross-checked against it — 1.405e-2 mm at
  best focus bare, 1.444e-2 through the chain. The seeds' whole value is that
  loading one and editing nothing must reproduce the design's own numbers, and a
  seed that reproduces an authoring convention instead is worth nothing.

### Cost, and why this one is live

2.4 ms for the two-mirror Cassegrain, 2.9 ms for the three-surface achromat,
4.0 ms for the DIN objective — three paraxial traces, one pupil solve, two exact
bundles and four more for the aperture sweep, at 149 rays each. (The very first
render prints 15.8 ms; that is warm-up, and it settles inside one edit. Worth
recording because the panel prints its own elapsed time and a reader's first
number is the wrong one.) Two orders under
the ~800 ms live line, so it recomputes on **every keystroke**: D8 submits because
a build is 50 ms of solving, and a table you have to press a button to see the
effect of is not an editor.

### What it does not edit, and why that is not timidity

`SurfaceSpec` also carries `tiltXDeg`/`tiltYDeg`, `decenterX`/`decenterY` and a
`reflectance` override; `Prescription` carries `mirrorFrames`. **The form is
unfolded and axial, and says so on screen.** A folded chain's thicknesses run
along the beam while an unfolded chain's alternate sign at every mirror, so a
control that flipped the convention under a list authored in the other one would
silently re-read every number in it — the C5 defect's signature (a routine
answering confidently for a system it cannot express) rebuilt as a UI control.
Tilt and decenter already have a home as *perturbations* of a built design, which
is Part B, where they have rungs behind them; authoring them from scratch is what
the module layer in ARCHITECTURE.md § Data model is for.

Two app-voice refusals, both marked as the app's: **R = 0** (c = ∞ is a geometry
the engine has no error for — it would trace to NaN and lose every ray, which is
the one failure an editor must not have) and an **empty surface list**. Everything
else is the engine's own sentence, quoted verbatim, exactly as A1 established.

### The structural item it closed

`builder.tsx`'s `NumberField` carried the note *"it moves the day a second form
exists"*. This is that day, so it moved to `ui.tsx` — along with `Fieldset`,
`Fact` and `num`, which the second form would otherwise have copied verbatim.
One behavioural change came with it: the field now accepts **±Infinity**, because
a plane is R = ∞ and an unbounded rim is `semiAperture: Infinity` — both values
the schema means rather than overflow, and `String(Infinity)` is what the field
already showed.

---

## Part F — the build you can look through — *app wiring only* — ✅ **landed**

D8 answered *"can we compose one and change its components?"* and Part E answered
*"can we author the surface list under it?"* Neither answered the question a
reader actually asks next, which is **"can I see through the one I built?"** —
and the answer is no. The builder draws no picture, and every panel that draws
one addresses its objective by a **name from a closed list of ten**.

This section is the scope for closing that. It is app wiring only in the strict
sense this doc uses: no engine call changes, no constructor gains a parameter, no
rung is added or moved. What changes is which value the imaging panels carry.

**It landed as scoped, in three commits, and the decisions were taken as: A
(replace `kind` with `spec`), the saved slot, and two voices.** What follows is
the scope as written; the corrections it earned are collected at the end, under
*What it cost that the enumeration did not count*. Read that section too — one of
its three items is a sentence this document has been getting wrong for a while.

### What is already true, which is most of it

Three things that would otherwise be the expensive parts are already done, and
the scope is small **because** of them:

1. **The catalogue is already builder specs.** D8 made `MicroscopeEntry` carry a
   `BuildSpec` and a `build: () => buildMicroscope(spec).system` closure
   (`microscope.ts:101`). Every imaging panel is therefore *already* rendering a
   builder-built system. What is frozen is not the pipeline — it is the ten
   specs.
2. **`describeSystem` is already shared.** D8 extracted it so A1's readouts run
   against whatever is built. Nothing about the readout layer is catalogue-shaped.
3. **Refusals already reach the screen from inside a render.** Every imaging
   adapter wraps its build in `try`/`catch` and returns
   `{ ok: false, error }` — `brightfield.ts:338`, `fluorescence.ts:345`,
   `volume.ts:687`, `stage.ts:287`, `section.ts:514`, `eyepiece.ts:329` — and the
   panels print it in red with the engine's own words
   (`brightfield.tsx:102`, `fluorescence.tsx:365`, `stage.tsx:498`). That path is
   live today: it is what `din-4x-020` and `lister-40x-040` do when selected in
   brightfield. **So "build something impossible and watch a picture panel quote
   the engine's own refusal" needs no new plumbing at all.** It is the headline of
   this part and it arrives for free.

### The seam, enumerated

One indirection is the whole obstacle: `MicroscopeKind` — a ten-member string
union (`microscope.ts:68`) — is what a request carries, and `entryOf` throws on
anything not in it (`microscope.ts:203`). Three groups of call sites:

- **The two build chokepoints.** `buildFrame(request)` reads `request.kind`
  (`microscope.ts:424`) and is called ten times: `brightfield.ts:273,404`,
  `fluorescence.ts:276,446`, `volume.ts:545,920,974,1035,1328,1406`.
  `entryOf(kind)` is reached directly three more times: `section.ts:425`,
  `stage.ts:141`, `eyepiece.ts:268`.
- **Ten request types** carry `kind: MicroscopeKind` and cross a `postMessage`
  boundary: `brightfield.ts:77`, `fluorescence.ts:83`, `section.ts:75`,
  `stage.ts:105`, `volume.ts:298,820,1125,1137`, `eyepiece.ts:143,535`.
- **Six non-null assertions**, one per panel, of the form
  `MICROSCOPE_CATALOG.find(e => e.kind === k)!.label` —
  `brightfield.tsx:340`, `fluorescence.tsx:314`, `section.tsx:236`,
  `stage.tsx:397`, `volume.tsx:638`, `eyepiece.tsx:367`. A custom objective
  reaching any of these is `undefined.label`. **This is the concrete break
  list**, and it is why the work is checkable rather than narrative.

**Send the spec, never the entry.** `MicroscopeEntry.build` is a closure and does
not survive `postMessage` — which is part of why the requests carry a string
today. `BuildSpec` is strings, numbers and one plain discriminated union, so it
structured-clones without ceremony. Nobody should reach for the entry.

### Decision 1 — what a request carries

- **A. Replace `kind` with `spec: BuildSpec`.** The string union disappears and
  the catalogue becomes what it already is, a list of named specs. Largest diff,
  no second path to maintain.
- **B. A discriminated `ObjectiveRef`** — `{catalog: MicroscopeKind}` or
  `{custom: BuildSpec}`. Smaller diff; two paths forever, and every readout site
  has to ask which it has.

**Recommend A.** After D8 the `kind` is pure indirection, and B's second path
exists only to preserve a lookup nothing needs. **But note the de-risking claim
that does not hold:** D8 records that the ten entries "were checked identical —
object for object, and message for message" against the two-argument calls they
replaced, and `packages/app/test/builder.test.ts` does **not** contain that check
— it pins the infinity-refusal behaviour and nothing else. That verification was
a one-off. Under A it should become a standing test (below), which is cheap and
worth having regardless of which option is taken.

### Decision 2 — where a custom build lives between routes

This is the one genuinely user-facing choice, and `registry.ts` states the value
it trades against: *"`id` is the URL hash, so a route survives a reload and can be
linked to."* A panel owns its own state and unmounts on route change, so a build
made in the builder needs somewhere to be.

- **Hash parameter.** The spec serializes into the URL. Survives reload **and is
  sendable to another person** — the design and the view are one link. Sixteen
  fields makes for an ugly hash, and it needs a versioned encoding or an old link
  silently decodes wrong.
- **A saved slot (`localStorage`), one build at a time.** Cleanest to build, no
  encoding to version, survives reload. **Loses linkability** — a saved build
  cannot be sent to anyone, which is the property `registry.ts` calls out.
- **React context in `App.tsx`.** Simplest of the three and the weakest: does not
  survive a reload, so a link to a picture of your build is not a thing.

No recommendation is forced here; the trade is linkability against encoding cost,
and it is a product call rather than an engine one. If asked: **the saved slot
first, with the hash left possible** — the encoding is additive, and a slot that
cannot be linked is still strictly more than the nothing that exists today.

### Decision 3 — what a caption says about a design nobody has measured

**This is the decision, and it is unanswered.** The two above are plumbing with a
recommendation attached; this one decides whether the feature is worth building.

The panels' prose names objectives, and with a custom build selected those
sentences misdescribe what is on screen. `fluorescence.tsx:485` prints "the DIN
4×/0.10 drops 0.659% and the infinity 20×/0.10 drops 0.997%"; `volume.tsx:866`
attributes 90/92/100% focus shares to three named rows. A4's own rule is the
standard: *a stale reading may be shown greyed only if nothing on screen
misdescribes it* — and A4 **withdrew** a plot rather than dim it, for exactly this
reason.

The obvious move is to gate every objective-specific claim on a catalogue row
being selected. But those claims *are* the panels' teaching, and a brightfield
caption that withdraws every measured comparison the moment a custom objective is
chosen may be correct and useless — the reader finally gets to look through their
own lens and the page goes quiet about what they are seeing. The alternative is a
caption that says something true about an **arbitrary** design, which is writing
rather than wiring and has no measurement behind it.

Three shapes, none costed:

- **Withdraw.** Honest, cheapest, and risks a panel that teaches nothing about
  the one design the reader cares about.
- **Re-measure.** Say the same *kind* of thing about whatever is selected — the
  corner-versus-axis drop, the axial peak offset — computed live rather than
  quoted. Some of these are already engine calls the panel makes; some are
  sweeps that would cost a second job.
- **Two voices.** Keep the catalogue prose as an explicitly-labelled comparison
  ("measured, on the ten rows") beside a readout that describes the current
  selection. Most work, and the only one that loses nothing.

**Recommend deciding this before writing any of the plumbing above**, because it
is the only part that could make the plumbing not worth doing.

### What must not regress

**Two smaller ones**, both mechanical.

- The refusal branches say *"the engine refuses this render"* unconditionally,
  and the imaging results carry only `{ ok, error }` with **no `source` field**
  (`brightfield.ts:156`). Today only engine refusals are reachable, so it is
  true; a custom spec makes `AppRefusal` reachable in principle, and this repo
  does not let an app sentence wear the engine's voice. `refusal.ts` already has
  the shape — thread `source` through, or gate the build so an unbuildable spec
  can never be saved. One field either way.
- A custom build has no `label` and no `note`. The panels must not print a
  catalogue note beside a lens the catalogue never described.

### Cost — and there is no new cost class

**A custom spec is not more expensive than a catalogue one.** The catalogue
already contains `lister-40x-020` and `oil-100x-140`, whose builds D8 measured at
**131–181 ms**, and brightfield, fluorescence and volume already pay that per job
for them and are documented live. Nothing about a user's spec is a new class of
work.

**The wall bisection stays out of the imaging path by construction** — it lives in
`describeBuild` (`microscope.ts:415`), not in `buildFrame`. That matters more
since § 6b.5.6: the DIN bisection now measures **~1.15 s**, which would be
unaffordable per render and is never reached from one.

**One cache breaks and it is the only one.** *(As landed: `SYSTEMS` is keyed by
`specKey` and the key list is a `Record<keyof BuildSpec, true>`, so a field added
to the spec breaks the build rather than collapsing two designs onto one system —
see Part F's measurements below.)* `stage.ts:134` held
`SYSTEMS = new Map<MicroscopeKind, OpticalSystem>()`. It is module-level inside an
adapter that runs **in a worker**, so its scope is one worker's lifetime — built
once per worker per objective, across the tens of tiles a mosaic asks for, and
gone when routing away terminates that worker. Nothing spans panels or reloads. A
spec is still not a map key: it needs one canonical key function, with field order
fixed in code rather than inherited from whatever `postMessage` handed over, and
one call site changes.

### What would pin it

No physics is added, so **no ladder rung is appropriate** and one would be a
category error. App tests, in `packages/app/test/`, following D10's and Part E's
precedent:

1. **The identity D8 claimed and never pinned.** For each of the ten catalogue
   entries, the spec path and the kind path produce the same system and the same
   readout — and, for **whichever** rows refuse, the same message. This is the
   check that makes A safe, and it is the one that currently does not exist.
   ✅ **Landed**, and the wording above is a correction: the first draft said
   "the three rows that exist to be refused", which was the stale count again —
   the rung pins that the two paths *agree*, never how many disagree with the
   engine.
2. **A round trip through whatever encoding decision 2 picks**, so a saved or
   linked build rebuilds the design it was saved from rather than one that
   resembles it — `editor.test.ts`'s seed round-trip, applied to `BuildSpec`.
   ✅ **Landed** as `saved.test.ts`, and it grew past a round trip: the decode
   is checked to return **nothing** rather than a partial spec for a missing
   field, a wrong-typed field, a malformed slip, an unknown version and a
   non-JSON string, because a spec that is fifteen-sixteenths right builds a
   *different lens* rather than failing. The round trip is compared through
   `specKey` as well as by value, so a reload cannot produce a spec that builds
   the same lens while missing the tile cache.
3. **A refusing custom spec returns rather than hangs**, through at least one
   imaging adapter. `builder.test.ts`'s own posture: the point is that it
   *returns*, because an unbounded solve is the one failure a panel cannot
   report. ✅ **Landed**, both voices: a DIN × Lister spec returns the *app's*
   sentence and an over-aperture aplanat returns the *engine's*, and a
   catalogue-free DIN 10×/0.12 draws a picture — which is Part F in one
   assertion.

**A fourth, unplanned:** `sweepFocalLengths` returning an empty curve instead of
throwing (D6.9), and the `specKey` invariants — order-blind, field-sensitive
including inside the slip, one key per catalogue row (`stage.test.ts`).

### What stays out

- **A custom objective in the bench table.** A1's table is a comparison whose
  rows are arranged to make two findings read off it; an eleventh row that moves
  would break the arrangement rather than extend it.
- **More than one saved build.** A library of builds is a different surface with
  its own naming and deletion questions. One slot answers the question asked.
- **A custom *condenser*, eyepiece, camera or stage.** `BuildSpec` is **the
  objective** — with the tube lens's focal length tied to it — and nothing here
  widens it. The mismatches a reader might expect to simulate (an infinity
  objective on the wrong tube, an objective with no tube lens) are *designed out*
  of `BuildSpec` on stated grounds — `builder.ts:332`, "a magnification quoted
  against one tube and formed by another is a mislabelled lens, not a design" —
  and unpicking that is a different scope with a different argument behind it.
- **A retinal picture through the eyepiece.** § 6q's named open item, unchanged
  by any of this: the visual exit beam is collimated and there is no image plane
  to render.

### The prediction

This doc has been wrong in the same direction six times — *the feasibility number
turns out to be measuring something else* — so the thing worth predicting is
where this scope's own confidence is misplaced. It is **not** the plumbing, which
is enumerated above and countable, and it is not the cost, which has no new class
in it.

It is decision 3, and the first draft of this section got that wrong in a way
worth recording: the caption problem was filed as a regression-prevention line
item, one bullet among several, because it looked like styling. It is not — it is
the only open question here whose answer could make the rest not worth building,
and it is the only one with no measurement behind it. **The pattern this doc keeps
naming arrives before the work rather than after it this time**: the part that
looked like arithmetic is the part that is not.

**The prediction was half right, and the half it missed is the one worth
keeping.** Decision 3 was indeed the load-bearing one — but it was cheap, not
expensive, because the panels already computed the live numbers. Fluorescence
already printed the axis and corner kernel peaks; volume already printed the
axial peak offset and the share of σ it accounts for. Nothing was missing except
a sentence saying *which lens* each claim was about, so "two voices" cost two
labels and one line of prose per panel and **no second worker job** — the cost
guard this section wrote for it was never reached. What the prediction did not
see is below, and it is not in the plumbing either: it is that one of the
sentences being labelled had stopped being true.

### What it cost that the enumeration did not count

Three things, and the enumeration missed all three. The plumbing itself was
exactly as counted — two build chokepoints, ten request types, six catalogue
lookups — and none of it surprised anything.

**1. A build site outside a `try`, which is the one failure mode this part cares
about.** `sweepFocalLengths` (`eyepiece.ts`) built its objective with no `catch`
around it. That was safe for as long as the only reachable specs were ten that
had been checked, and stops being safe the moment a reader's own spec crosses the
`postMessage` boundary: a throw there is a dead worker and a plot that never
arrives — precisely the *"an unbounded solve is the one failure a panel cannot
report"* posture `builder.test.ts` already had, arriving at a different site. It
returns an empty curve now, with `describeInstrument` on the main thread printing
the objective's own refusal beside it. **Pinned at D6.9.** The lesson generalises:
the enumeration counted every place a `kind` was *read*, and the site that
mattered was one where a build was not *guarded*.

**2. The `source` field, as scoped — and it made a second thing shareable.**
The imaging results carried `{ok, error}` with no `source`, which was true while
only engine refusals were reachable from a render. `Refused` split out of
`Refusal<Stage>` for surfaces with exactly one stage (a one-member `stage` union
would be a field that can never say anything), and `refusalVoice` replaced the
nine panel sites that said "the engine refuses…" unconditionally — ten, with the
bench table, which had the same sentence and was not on the list.

**3. "Three entries exist to be refused" is false, and has been for a while.**
This section's own headline rested on it: *"it is what `din-4x-020` and
`lister-40x-040` do when selected in brightfield."* Measured against the current
engine, **one** catalogue row refuses — `lister-40x-040`. § 6b.5.6 seeded the
doublet solve differently, and the DIN 4×/0.20 that was written to fail at § 6b's
f/4.1 ceiling now builds and draws a picture, while its own row note still called
it an error message. The claim was in four places, two of them on screen
(`builder.tsx`'s prose and the row note itself), and § A1 above stated it while
naming only two rows, so it was internally inconsistent before the wall even
moved. A1 predicted this exactly when it chose to quote the engine rather than
paraphrase it — *"a fix upstream arrives here for nothing — and means a wrong
sentence would have too"* — and the wrong sentence was that one. **The count is
now read off the table everywhere and asserted nowhere**, including in the test:
the rung pins that the two build paths *agree* about which rows refuse and that a
refusal carries the engine's voice and a number, never how many there are.

The headline this part was built for survives the correction and is
better for it: build something the engine will not make, and a picture panel
quotes the engine's own refusal. It is `lister-40x-040` that demonstrates it from
the catalogue, and the builder that demonstrates it at any aperture you like.

### What it measured

**The cost claim held, and it is now measured rather than argued.** A custom spec
is not a new class of work: in node, a stage tile is **82 ms** on the catalogue's
DIN 4×/0.10 and **79 ms** on a composed DIN 10×/0.12, with the first tile of each
carrying its build (158 ms / 101 ms) and every later one hitting the per-worker
`SYSTEMS` cache. In the browser, on a settled panel, the same custom lens renders
**39 tiles in 1.3 s** against the catalogue row's **36 in 1.7 s**.

**One measurement looked like a regression and was not**, which is worth
recording because the obvious reading was wrong: switching objectives *mid-render*
showed 39 tiles in 80 s and a slowest tile of 2 545 ms, ~30× the settled number.
That is the workers finishing the previous epoch's tiles while the new epoch's
queue waits — pre-existing behaviour on a panel that spawns several workers, and
nothing to do with the spec. The node measurement is what settled it; the
plausible story (a cache keyed on an object that arrives fresh every message) was
checkable and false, because `specKey` had already made the key a value.

**And the cache key is now a compile-time obligation.** `SPEC_FIELDS` is a
`Record<keyof BuildSpec, true>`, so a field added to the spec breaks the build
rather than silently collapsing two designs onto one cached system. The first
draft of that function was a hand-written list of sixteen reads with a comment
claiming exactly this property, which it did not have.

### The eleventh spec field, and the first the engine deliberately will not default

**§ 6w landed after this part and added `fieldNumberMm` to `BuildSpec`** — the
field number an infinity-corrected doublet's glass is sized to pass. It is worth
a section here rather than a line, because it is the first parameter whose home
is *this side* of the seam.

The engine cannot default it, and says so: a stop position is intrinsic to an
objective, but a field is a property of the objective *together with whatever
stops the field behind it*, so `microscopeObjective` leaves it off and the § 6v
lens — sized to its axial beam — stays the shipped default and § 6w's negative
control. **The app is that "whatever stops the field."** A7's stage crops to
`FIELD_NUMBER_MM` and prints the number on screen, so before this the panel drew
a caption naming a field its own objective vignetted **27% of the pupil** at the
edge of. The catalogue's three infinity doublets now carry the same constant the
caption quotes, which is also why the constant moved from `stage.ts` (a consumer)
into `builder.ts`: one number doing two jobs cannot drift from itself.

That makes these the **first catalogue rows that are not byte-identical to the
constructor calls they replaced**, and the sentence in `microscope.ts` claiming
they are is corrected rather than left to go stale — this document's own repeated
lesson, arriving where it can be acted on.

Three smaller things the change had to get right. The parameter is **refused, in
the app's voice, on the three forms that have no such thing** — a DIN objective
stops on its rim where a bundle pivots instead of walking, and the Lister and the
oil front are different constructors — rather than being dropped silently;
`liveFields` greys the control for the same cases, so the form and the refusal
agree. `SPEC_FIELDS` and `saved.ts`'s `SPEC_CHECKS` both **broke the build** until
the field was added to them, which is the compile-time obligation Decision 2
installed working exactly as designed: a field added to the spec cannot silently
collapse two designs onto one cache key or vanish from a saved slot. And the
builder's own control offers **0 = axial glass**, so § 6v's objective stays
reachable from the form — the comparison this step is measured by is a control
the user can also run.

### What is still open

- **The hash.** Decision 2 took the slot; `encodeBuild` is already a string, so
  linking a design remains an additive step rather than a rewrite. Nobody has
  needed it yet.
- **More than one saved build**, a custom condenser/eyepiece/camera/stage, and a
  custom row in A1's comparison table — all still out, on the grounds stated
  above, none of which the work changed.
- **The prose is labelled, not re-measured.** "Two voices" was taken as *label
  the catalogue's claim and print the live one beside it*, and every panel that
  had a live equivalent already had it on screen. Where a panel's teaching has no
  live counterpart, it now says whose lens it is about and stops — a re-measured
  version would need the second job this part declined to add.

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
2. **One adapter module per family, on `render.ts`'s pattern.** ✅ **held, eleven
   times.** `microscope.ts` and `tolerance.ts` are the two this item named and
   both exist; so do nine more. Pure functions, no DOM, so they drop into workers
   unchanged. This is the single commitment worth keeping from the current app;
   everything else there is disposable — and Part B is the closing evidence, since
   `tolerance.ts` needed no adaptation at all to be called from a worker, from a
   panel, and from a vitest file with no DOM in the room.
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

**And the item this section named as the last one has landed too — as something
else.** "Scenes are content, not blockers" was right that § 6n unblocked them and
**wrong that nobody had authored one**: `stage.ts` has had a diatom field and a
stained section since A7, and the registry could have said so. What the doc's
accounting had actually lost was **colour** — `brightfieldSpectralStack` with no
caller anywhere in the app, which is § 6r's own headline unwired. That is
**A9**, it has landed, and its findings are in its section. Twice now this
document's residue has turned out to name the wrong thing (the D6 panel was the
first), and both times the registry was the check that would have caught it.

**A third time, and in the other direction — where the registry could not have
helped.** "What is left in this doc is Part C, and the telescope's own scenes" was
right about Part C and **incomplete about what was in it**: the largest item with
no app presence was not an eyepiece mode, it was **`core/mech`** — a whole
validated layer this document had never scoped, because APP.md sorts by branch and
a mechanical layer does not have one. ROADMAP had it in bold the entire time. It is
now **C3**. The lesson is the mirror of the registry one: the registry catches a
panel this doc believes exists and does not, and only ROADMAP catches a *layer*
this doc never listed.

**~~Part B~~ has landed**, and it was self-contained exactly as predicted — it
touches no microscope code and no engine code at all. What it corrects is its own
scoped headline: the RSS budget diverges from the honest trace **downward** more
dramatically than upward, so "independence is an assumption and this is where it
visibly fails" is right about the assumption and wrong about the direction.
**~~A6~~ has landed**; see its section for the three findings and for the engine
defect it turned up in the focus solve. **Part C** is a separate decision, and
**C1–C6 have since landed** — C3 was a whole layer this doc had not scoped (see
the third-time paragraph below), C5 closed the modes, and **C6 closed the part**
by promoting § 5d's ensemble out of its own test file.

**Two things this doc had lost, recorded here because A6 emptied the queue that
was hiding them.** First, ~~**the D6 panel does not exist**~~ — **it does now**,
see D6. Part D's own opening said of the eyepiece "what remains unbuilt is the
*panel* for it" while its closing accounting said the only remaining items were
A6 and Part B; the registry sided with the first, and the gap is closed: there
are ten panels and the tenth is the visual microscope. Second, **scenes are
content, not blockers**: § 6n unblocked stained tissue and diatom fields, and the
disqualified table says so, but nobody has authored one. ~~**That is now the only
microscope item left anywhere in this doc**~~ — **and it was already done when
this was written.** A7 authored both, in `stage.ts`, grey; the real gap under the
word "scenes" was colour, and **A9** closed it. What is left in this doc is
**Part C** — **and Part C is now walked: C1 through C6 have all landed.** The
last of them, long-exposure seeing, was the only one that was not wiring, and it
closed § 5d's own named deferral rather than adding physics. **Nothing scoped in
this document is open** — checked the way this doc's own history says to check
it, since it has been wrong about exactly this twice: every ✅ section that is a
panel has a route in `panels/registry.ts` (seventeen of them), and a sweep for
residual "unbuilt / no app presence / still to come" language outside the
deliberate Disqualified and D9 tables turns up only historical quotations — plus
one genuinely stale line, "A6 has no app surface yet" at the head of Part A,
which is now fixed. What remains for the telescope is not this doc's: the
scenes — star, planet and lunar — are ROADMAP step 5's item and an engine step
rather than wiring, since `rasterizePointSources` is point-only and an extended
incoherent source has no rasterizer.

**That engine step has since landed as § 5v**, and the sentence above was right
about the diagnosis and incomplete about what would be left afterwards.
`imaging/extended` gives an extended incoherent source its rasterizer — a sky
radiance evaluated at the field direction each pixel really looks at, times the
solid angle that pixel subtends — and the scene it produces is the
`ImagePlaneScene` `renderField` has consumed since step 4, so **no app-facing
capability is blocked any more.** What is left for the scenes in *this* doc's
currency is therefore ordinary: a **panel** (none exists; the registry is the
check, and there is no route for one), and the **content** — an albedo map,
lunar terrain, a real limb-darkening coefficient — which is authoring or measured
data rather than either engine or wiring, exactly as `stage.ts`'s diatoms were
for the microscope.

Worth recording because this doc keeps a prediction ledger: § 5v is the first
step in a while where **the feasibility number was not measuring something
else** — there was no feasibility number, because the measurement that decided
the design was taken *before* the module was written rather than inherited from
a scoping note. What it decided was whether the cos⁴ law's fourth cosine was
already in `psf().energy` (it is not), and the answer changed the module's
signature. The defence this doc has named three times — pin to a closed form
rather than to a previous measurement — worked a fourth time by being applied
one step earlier than usual.

**C2's own version of the pattern is that the cheapest item in the doc was
cheap, and the one nobody costed was the expensive one.** APP.md called the spider
"probably the cheapest visible win in the repo" and it was — one option passed
through. § 2f's vignetting was listed beside it as "one more `PupilFunction`
mask", and it needed *no option at all* while producing the part's largest
finding: a **wall** where the chief ray stops clearing the diagonal, which no rung
states because no rung needed a field range, and which had to be derived before a
field control could exist at all. A surface that only *displays* a capability can
still be the thing that finds its edge.

**C1 is the first Part C surface and it repeated the pattern this doc keeps
naming, in the reverse direction.** Every previous part found the *feasibility
number* was measuring something else; C1 found a **readout** was — this app's own
fringe number reads 0.36 Airy radii on a system with no glass in it, because it
divides by one Airy radius while the Airy pattern scales as λ. Three of C1's four
findings began as wrong predictions of the panel's author, which is what a surface
that puts an absolute number on screen next to nothing else does for you: § 3b's
measure was only ever used as a *difference* between two lenses, and the floor it
carries was invisible until something with a guaranteed zero was put through it.

**C4 makes that pattern say something new, and it is about this doc's own
prediction record.** Every previous part found the *feasibility number* was
measuring something else, and C1 found a *readout* was. C4 found **the engine
itself** was: `fieldOfView` reported a bracket's starting point as a physical
wall, and it did so in the one place the ladder could not see, because every § 5r
rung runs on an unfolded achromat that always passed the probe. That is the third
rung of the same ladder — feasibility number, readout, engine — and the defence
is unchanged and worked again: the fix is pinned to § 2f's closed form rather
than to any previous measurement. It is also the second bracket defect a panel
has found (A6's § 1.6.1 was the first), which is now enough to name: **a bracket
that assumes its own field passes unnoticed until something folded arrives.**

**C5 makes it a family of three, and widens what the family is.** Its defect
(§ 5l.1) is not a bracket at all — it is a **declaration dropped at a boundary**:
`spliceModules` takes surfaces rather than a `Prescription`, so a folded module's
frame never arrives while its 45° tilt does, and the composed chain answered a
1405 mm afocal gap where the geometry has 131. Different mechanism, identical
signature, and the same defence worked a third time: pin the fix to independent
geometry (§ 4b's) and carry an unfolded control — a Cassegrain of equal aperture
and focal length — so the refusal is about the fold and not about mirrors. What
the three share is therefore not "brackets" but **a routine that answers
confidently for a system it cannot express**, and all three were found by a panel
rather than by the ladder, because each routine's ladder fixtures are the ones it
was written against. Twice now that has been *something folded arriving*.

**Part D** is where the branch goes next, and it is a different kind of work from
A1–A5: those wired capability the engine already had, and D1–D3, D5–D7 are engine
steps with their own rungs. Its own order is at the end of that part; the short
version was **D8 first for breadth, D1 → D4 for the field of view** — and every
engine step in the part has since landed (§ 6m–§ 6s), as have **D8** and **D10**,
so **Part D is walked**. D10 existed because § 6l closed the branch's last
numbered gap, which this doc had scoped as disqualified rather than as work; what
it found is that wiring a *placed* specimen raises a question no engine rung had
had to ask — whether a plane may sit above the coverslip — and the answer is a
panel's to enforce, not the engine's to state.
**D8 also made the sixth reuse of the adapter pattern say something new**: the
five before it wired capability and reported it, while a *form* over the same
capability found that two of the branch's catalogued walls are functions of
parameters the catalogue had defaulted — the aplanat's NA and the doublet's
focal ratio. A surface that lets a reader move a stated parameter will find out
what the stating cost, which is A5's lesson ("a surface that draws a quantity a
rung only summarizes will find the sampling the rung could afford to ignore")
arriving a fourth time, in the design space rather than in the sampling.

**Part E is the fifth time, one layer further down, and it makes the C3 lesson a
pair.** D8 moved a *stated parameter* and found the walls were not constants;
Part E moves the *surface list under the parameter* and finds that a design's
correction state is readable off its aperture — halve the stop, and the exponent
of the residual names the lowest order still there. That is a quantity no rung
summarizes because no rung needed it: § 6b pins ΣS_I = 0 and stops, which is the
right thing for a rung to do and leaves "so what survives?" for a surface to ask.
And it is the C3 lesson repeated exactly: **only ROADMAP carried this item**,
because APP.md sorts by branch and a `Prescription` does not have one — the same
blind spot that hid `core/mech`, in the same document, found the same way. The
registry could not help here either, and for a sharper reason than with C3: there
*was* a route called `bench`, and it is A1's objective table. A name collision is
worse than an absence, since the check that catches absences reads as satisfied.
The panel count is eighteen.

**Part F is the sixth, and it is the first one the ledger's own method missed.**
Every entry above was found by a *structural* check — a registry sweep, a
grep for "unbuilt", a branch that owns no document. Part F's finding is none of
those: "three entries exist to be refused" was written in four places, and all
four were *true when written*. § 6b.5.6 changed the engine, and no structural
check can see a sentence that quietly stopped matching a solver. What caught it
was **driving the panel** — clicking the row the doc said would refuse and
watching it draw a picture — which is A5's and A6's lesson arriving at the
document instead of at a panel. The consequence is written into the rungs rather
than into a promise: the count is now derived from the catalogue everywhere,
including in the test that pins it, so the next time a wall moves the sentence
moves with it. The panel count is still eighteen; Part F added no route, which is
the point — the eleventh objective appears inside the eighteen that exist.

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
