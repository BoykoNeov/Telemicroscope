# Open problems — the register

One page for what the engine has left open. VALIDATION.md records a step's
deferrals under that step, which is right for provenance and useless for
planning: at 1.8 MB and a hundred-odd *Still open* paragraphs, nobody can see
what is open, which items are one deferral wearing six names, or which chain
of steps has stopped producing anything. This file is the view across them.

**Rules for this file.** An entry is one line of what is open, the step that
records it, and — only where one is known — the external number that would
pin it and what it unblocks. A pin the ladder itself named is quoted; a pin
proposed here is marked *candidate* and is a proposal, not a rung. An entry
closes by being struck through with the step that closed it, and stays for one
release so the closure is visible. Line numbers are never cited — they move
with every edit — so references are `§` labels, which `docs-index.test.ts`
checks resolve to headings in VALIDATION.md.

**The stop rule** (VALIDATION § Rules; CLAUDE.md). A measurement-only step
opens with a hypothesis and the number that would refute it, and a chain of
such steps ends when three in a row add neither an engine change nor an
external pin. The residue is then written *here* as a problem. Part C below
is the chain that rule was written on.

**A structural problem before any physics.** ~~`npm test` on a Linux container
(Node 22.22, x86-64) fails 21 of 3499 rungs on `main`: 3 are the vitest
worker-timeout `vitest.setup.ts` documents, and the other 18 are bit-exact
pins — `toBe` on a double, `toEqual` on an array of doubles, or a
`toBeCloseTo` at 5e-16 — that differ by one to a few ulps from the machine
they were recorded on.~~ **Addressed**, by the route this entry named rather
than by widening anything: VALIDATION's *Rules* now carry the recorded-reading
convention (a recorded number is asserted relatively, under a bound set by what
the reading IS — well-conditioned, a residue of cancellation, or an optimiser's
output, which is never pinned tighter than the `stepTolerance` that stopped it),
and the fragile assertions were restated on it in six of the named files —
`optimize` (core), `mtf-share`, `mosaic-flat-field`, `stage-mosaic`,
`refusal-boundary`, `refusal-frames` and `wavefront-form`, with the shared
comparison living in `test/support/refusalSweep.ts`. The other five were read
line by line and left alone deliberately: what they carry is same-process
identities (two code paths, one libm, one operation order — bitwise equal on
every platform), integer step counts, and values that are exact by construction
(`volume-mount`'s 7.5 µm is `request.depthUm` copied through). Turning any of
those into a tolerance would have been the real regression. The two that missed
by 1e-8 (§ 1.8.7's landing residual, § 1.8.13's run that stops on its iteration
cap) were re-derived rather than loosened: the first is bracketed at its ORDER,
which is what that rung ever claimed, and the second is stated at six figures
because a run that stops on a cap is a point on a trajectory and not a fixed
point of one.

**What is still open in it.** The fix is verified green on the author's Windows
machine only, and five of the twelve files it named were left untouched on the
argument above rather than on evidence. Nobody has re-run the Linux container,
so the claim that the ladder is now green off-machine is *unverified* — the bounds are argued from
conditioning and from the register's own "one to a few ulps", not from a second
run. Running it is the cheap next step. If a rung then misses by ORDERS rather
than by ulps, that is a finding about the stopping rule and belongs here as a
problem, not in a widened tolerance. The 3 worker-timeout failures are
`vitest.setup.ts`'s and are untouched.

## A. Ready to pin — an external number exists

Ranked by what each unblocks. The first two are closed and kept as the format.

1. ~~**The photon zero point.** Recorded at § 3a, § 5s, and *Later rungs*;
   blocked shot noise, absolute throughput and every fluorescence ratio.~~
   **Closed at [§ 8a](VALIDATION.md#step-8a--the-photon-zero-point-and-the-one-draw-a-camera-makes)**
   on the AB definition; Vega at 0.02 mag is the external number.
2. ~~**A non-unit image-space index in `pixelScaleMm`.** § 2f, § 6a: "once an
   immersion objective places one of these media in image space".~~
   **Closed at [§ 2g](VALIDATION.md#step-2g--the-image-formed-in-a-medium-the-cartesian-ellipsoid)**
   with a Cartesian ellipsoid, not an objective.
3. **The sky, and the limiting magnitude.** Opened by § 8a. Pin: a background
   of m mag·arcsec⁻² is § 8a's rate times a pixel's solid angle, which § 5r's
   plate scale carries — closed form, no new physics. Unblocks the noisy hero
   frame and every exposure-time question the camera panel cannot answer.
4. **The noisy frame.** Wiring on the route written on `imaging/noise`:
   per-wavelength intensity over the PSF's `energy`, times `photonSamples`'
   weight, times grasp, times seconds, then the draw, then XYZ. No rung of its
   own beyond a golden; the physics is § 8a's.
5. **Seeing's geometric-branch analog** — rays deflected by ∇φ so a seeing
   blur survives the fidelity fallback. § 5d's deferral, restated at § 6f and
   *Later rungs*; the ladder names no pin. *Candidate:* the angle-of-arrival
   variance of a Kolmogorov screen, σ² = 0.182·λ²·D^(−1/3)·r₀^(−5/3) (Fried
   1965), which the ray deflections' centroid wander must reproduce over the
   same ensemble § 5d already averages.
6. **Transport of intensity** — brightfield's geometric analog, "rays
   refracted by the specimen's phase gradient" (§ 6f.9, *Later rungs*). Needs
   rays that start at a transmittance, which `exitBundle` does not do. The
   ladder names no pin. *Candidate:* the weak-phase defocus transfer,
   contrast ∝ sin(π·λ·z·ν²) (Teague 1983), on § 6f.5's own phase grating that
   brightfield cannot see in focus.
7. **Stop-shift equations in `seidelSums`.** § 6ac names the pin — "the
   published stop-shift equations would lift" the stop-in-contact zero — and
   § 6ai keeps the `"rim"` control alive only because they are absent.
   Unblocks the distortion anchor at a real stop and retires a control.
8. **Astigmatism and field curvature on conics.** Every reflector preset
   (§ 4b, § 5e, § 5f, § 5i) and the Lister (§ 6d) say "what is missing is the
   external number, not the measurement", since `seidelSums` refuses conics.
   *Candidate:* the classical two-mirror field aberrations in Schroeder
   (*Astronomical Optics*, ch. 6), which are closed forms in the conic
   constants and the magnification.
9. **The exact Ewald cap against the quadratic wavefront** (2.6× at NA 1.40).
   § 6k names the pin: "a wavefront traced through a defocused *object*
   plane".
10. **A depth-varying phase stack's support boundary.** § 6l: "a different
    closed form" from § 6k's.
11. **An immersed image plane behind an objective.** Opened by § 2g, which
    pinned the index on a single surface; a design where it enters twice
    (§ 6e's front and a back) does not exist on the ladder.
12. **Which way an aberration-free band moves the Airy core.** § 6j names
    "an analytic band-integrated Airy" as the resampler-free check.

## B. Blocked on data, not on code

The hard rule forbids transcribing from memory, so these wait for a sourced
number and land the day one arrives.

- **Published eyepiece and objective prescriptions** (Erfle/Nagler-class,
  patents) with their glasses' dispersion — ROADMAP step 5, *Later rungs*.
  The catalogue holds N-BK7, F2, CaF₂, fused silica and the three immersion
  media; a patent member needs its own crown and flint.
- **A fluorophore** with a measured emission curve and quantum yield (§ 6i,
  § 6j, § 6ba) — the brightness zero point fluorescence needs, which § 8a is
  not.
- **H&E absorption curves** (§ 6r: "a rung pinned to them would be the
  strongest version of this step"), and a stain lineshape (§ 6ba).
- **Limb darkening, an albedo map, lunar terrain** for the telescope scenes
  (§ 5v; ROADMAP step 5's last open item).
- The DIN optical tube length digit (§ 6b) — a datasheet, and it moves labels
  only.

## C. The fluorescence-mosaic chain, § 6bk → § 6cl

Twenty-eight steps: twenty-one carry *Source: measurement only — no engine
change*, six more (§ 6bt–§ 6by) name no source at all, and one (§ 6bk) is an
engine change. None of the chain's open items is pinned to an external number.
The chain set out to explain one number — the mosaic guard band's refusal
boundary and its sensitivity to magnification and aperture — and each step
found the previous step's form to be a special case of a wider one: a
threshold became a drift, the drift a hump, the hump a shoulder, the shoulder
a handover, the handover a fixed point, and the fixed point one corner of a
seam, until § 6cl found the whole published sensitivity to be the matched
field's own arithmetic and left a residue of 3.3·10⁻⁴, three orders below the
number it began with, "unnamed".

That is a result — the number was never optics — and it is also where the
stop rule applies. What the chain leaves, sorted by whether it is worth a
step:

**Worth a step, because it is an engine change or a real rung**

- **Fifth-order distortion.** § 6ck: the map's `b` "is measured here and named
  nowhere"; `seidelSums` stops at third order. A fifth-order rung is an
  engine capability with textbook forms behind it (Buchdahl), and it is the
  one thing on the chain that would pin something outside the fixture.
- **A frame that is not a power of two.** § 6bo: § 6bn's first interval
  (4× → 10×) "wants a non-integer `pupilSamples` at every power-of-two size"
  and "would be an engine change". Without it, whether any of the six
  interactions is a slope is neither confirmed nor refuted.
- **The stage interact's guard sensitivity**, asked § 6cl's question — "the
  cheapest open item on the branch", one file, and it either closes § 6ca.1's
  second pair the same way or shows the field seam and the stage seam differ.

**Parked, by the stop rule** — the residue and the forms nobody wrote:
§ 6cl's unnamed 3.3·10⁻⁴; § 6bz.4's per-cell turn and § 6ca's branch
inversion as one unwritten event; § 6ch's coma residue changing sign near
NA 0.21; the plateau's mechanism (§ 6bn → § 6bq); § 6bs.6's two orderings;
§ 6cj's corner ranking as a max over 65 probes; the map coefficient at one
wavelength; why a coarser pupil puts light outside the box (§ 6cc.2); and
the twenty smaller items § 6bk–§ 6bt recorded and never restated. They are
listed under their steps; none returns to the ladder without a hypothesis
and a number that would refute it.

## D. Partial coherence — v2, and why it has no ray analog

- **Hopkins' TCC → phase contrast and DIC.** § 6f, § 6p: "both are v2, and
  the annular source is already here waiting" (`latticeAnnularSource`,
  § 6ab.19, unwired). The one v2 item with a textbook behind it (Hopkins
  1953; Born & Wolf, ch. 10) and the one that changes what the microscope
  branch *is*.
- The non-isoplanatic partially coherent image's limit (§ 6g), coherence off
  axis and polychromatic coherence (§ 6g, § 6t), critical illumination and a
  non-uniform source (§ 6f, § 6x, § 6ag, § 6ah): all downstream of the TCC.
- The geometric PSF branch has no coherence and never will (§ 6f.9): not a
  problem, a fact, and the reason brightfield rules rather than blends.

## E. Design, optimizer, telecentric and illumination — open, engine-side

- § 1.7: targets beyond first order (a traced residual as a root); § 1.8.11's
  stopping rule, named and not fixed.
- § 6au, § 6aw: the tolerance budget is one field, one wavelength, equal
  shares; a lateral-colour budget and a cost-weighted allocation have no
  source.
- § 6ae, § 6ag, § 6x: the condenser's own aberrations per patch, and § 6p's
  cache under a shifted pupil (1.8×, priced).
- § 6u → § 6ak, § 6ay: pupil aberration — the aim is paraxial; "real
  ray-aiming iteration would".
- § 6c, § 6e, § 6z: a correction collar (index and NA, not thickness); water
  immersion; the chromatic aplanatic condition.
- § 6ar: a control on the crossing uncertainty the panel exceeds.

## F. Everything else, by step

§ 3b lateral colour and extended telescope scenes · § 4a fold-plus-misalignment
tolerancing · § 5u barrel vignetting as a rung, a sensor cover glass · § 5v the
fourth cosine · § 6h many-patch fields · § 6j–§ 6k an excitation path, epi and
dichroic, deconvolution and confocal · § 6l TIRF and a chromatic half · § 6q
the eyepiece's aberrations at this conjugate and eye relief · § 6s non-uniform
radial-map nodes · § 6ba differential bleaching.

## Suggested order

1. ~~§ 8a — the zero point and the draw.~~ ✅
2. ~~§ 2g — the image in a medium.~~ ✅
3. **The sky and the noisy frame** (A3, A4): closes step 8's headline with
   no new physics, and gives the camera panel its first absolute readout.
4. **Stop-shift equations** (A7): a named pin, an engine change, retires a
   control.
5. **Seeing's ray analog** (A5): the oldest deferral on the telescope branch,
   and the one a user drags a slider across.
6. **Fifth-order distortion** (C): the only thing on the mosaic chain that
   pins outside the fixture.
7. **Hopkins' TCC** (D): the v2 step, scoped as an engine step in ARCHITECTURE
   before a line is written — the brightfield refusal (§ 6f.9) is where it
   plugs in.
8. ~~Make the ladder green off the author's machine (the structural problem
   above) before any of 3–7 is trusted on a second one.~~ The convention is in
   and the assertions are restated (see the structural problem above); what
   remains is one confirming run on a second machine, which is now a check
   rather than a piece of work.
