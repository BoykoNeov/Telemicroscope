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
3. ~~**The sky, and the limiting magnitude.** Opened by § 8a. Pin: a background
   of m mag·arcsec⁻² is § 8a's rate times a pixel's solid angle, which § 5r's
   plate scale carries — closed form, no new physics. Unblocks the noisy hero
   frame and every exposure-time question the camera panel cannot answer.~~
   **Closed at [§ 8b](VALIDATION.md#step-8b--the-sky-and-the-magnitude-it-hides)**,
   and the entry's "no new physics" was half right. The rate is unchanged, but
   the pixel's solid angle times the pupil area is an **étendue**, and § 5s's
   extended-source law spells the same étendue a second way out of the traced
   marginal ray: the two differ by the sine condition and by nothing else,
   which is `(1 + 1/(16F²))²` in closed form on a paraboloid (1e-12) and a
   reading of the other sign on glass. The external pins are that closed form
   and the CCD equation's two regime slopes, 1.5051 and 0.7526 mag per 4×
   exposure.
4. ~~**The noisy frame.** Wiring on the route written on `imaging/noise`:
   per-wavelength intensity over the PSF's `energy`, times `photonSamples`'
   weight, times grasp, times seconds, then the draw, then XYZ.~~
   **Closed at [§ 8a.7–§ 8a.11](VALIDATION.md#-8a7-8a11--walking-the-route-and-the-one-thing-wrong-with-it)**,
   and it was not only wiring: dividing by the PSF's own `energy` normalizes the
   obstruction away, so the denominator is the CLEAR aperture on the same grid
   (`clearApertureEnergy`) and the pin is 1 − ε². The pupil's throughput is now a
   reading rather than a cancellation. **The golden this entry asked for does not
   exist and should not**: the Poisson sampler runs through `log` and `exp`,
   which IEEE does not fix, so a bit-exact image of a draw differs by whole
   photon counts between machines. Statistical and convergence gates replace it
   — see the step.
5. ~~**Seeing's geometric-branch analog** — rays deflected by ∇φ so a seeing
   blur survives the fidelity fallback. § 5d's deferral, restated at § 6f and
   *Later rungs*; the ladder names no pin. *Candidate:* the angle-of-arrival
   variance of a Kolmogorov screen, σ² = 0.182·λ²·D^(−1/3)·r₀^(−5/3) (Fried
   1965), which the ray deflections' centroid wander must reproduce over the
   same ensemble § 5d already averages.~~
   **Closed at [§ 5d.2](VALIDATION.md#-5d2--seeings-ray-analog-the-deflection-the-histogram-carries)**,
   and the candidate named the wrong half of a 7% split. 0.182 is the
   **Z-tilt** — the least-squares plane through the wavefront, what a
   Shack–Hartmann centroid or a tip-tilt mirror tracks. A ray bundle's centroid
   is the **G-tilt**, the aperture-averaged gradient, coefficient **0.170**:
   averaging each ray's deflection over the pupil is the same arithmetic as
   averaging the gradient over it, so there was never a choice about which one
   this branch computes. Both are re-derived from the generator's own PSD
   rather than quoted, which is what exposed the last link — the generator's
   rounded PSD constant puts every variance 0.46% above the exact one — and
   cross-checked against Noll 1976. The entry was also wrong that the ensemble
   is the instrument: the generator is scale-free, so D^(−1/3) and r₀^(−5/3)
   are **bitwise identities** of the construction, and averaging was needed
   only for the coefficient, which lands at 0.96 of the closed form with the 4%
   deficit shown closing as the screen grows. What the step found on the way is
   now item 14 below.
6. **Transport of intensity** — brightfield's geometric analog, "rays
   refracted by the specimen's phase gradient" (§ 6f.9, *Later rungs*). Needs
   rays that start at a transmittance, which `exitBundle` does not do. The
   ladder names no pin. *Candidate:* the weak-phase defocus transfer,
   contrast ∝ sin(π·λ·z·ν²) (Teague 1983), on § 6f.5's own phase grating that
   brightfield cannot see in focus.
7. ~~**Stop-shift equations in `seidelSums`.** § 6ac names the pin — "the
   published stop-shift equations would lift" the stop-in-contact zero — and
   § 6ai keeps the `"rim"` control alive only because they are absent.
   Unblocks the distortion anchor at a real stop and retires a control.~~
   **Closed at [§ 6cm](VALIDATION.md#step-6cm--the-stop-shift-becomes-the-engines)**,
   and the entry was right about the pin and wrong about the control. The chief ray through a displaced stop is
   a two-unknown linear solve, not a search, so the refusal was protecting an
   unwritten problem rather than a hard one; the non-zero distortion anchor is the
   shipped telecentric objective's −70.7001, which the engine now returns when
   asked. But `"rim"` is NOT retired: § 6ai's own reasoning is that removing it
   relocates a lens into a hand-built fixture instead of deleting one, and that
   argument never depended on the equations being absent.
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
13. ~~**The spectral stack's resampling moves energy, and nothing reports it.**
    Found at § 8a.11 while walking A4's route. A raw PSF conserves to the bit;
    the planes `spectralStack` resamples onto the common grid come back +0.3%
    to +3.0% heavy, non-monotone in the resampling ratio, while
    `truncatedFraction` reads exactly 0 because the light did not leave the
    grid. Pin: **Σ intensity ≡ energy**, the identity `psf.ts` already states
    and the raw transform already meets — no external number needed, and no
    new physics.~~

    ✅ **CLOSED at [§ 8c](VALIDATION.md#step-8c--the-resampler-that-conserves).**
    "No new physics" was right and "no external number needed" was only half
    right. The identity is the pin for the BUG, but a resampler that conserves
    is cheap to write badly — a plain area average conserves exactly and is
    three to four times WORSE than the bilinear it replaces — so the step is
    pinned to closed forms with no engine in them as well: a uniform field, a
    Gaussian's 2πσ², and a tone whose interval average is analytic, on which
    the new scheme beats bilinear at every period and both ratios. The cause was
    a quadrature and not the optics: bilinear at a destination centre times k² is
    a one-point rule, and § 8c.3 reproduces the whole failure on an Airy pattern
    written straight onto a grid (+4.0e-2 to +1.0e-1). What replaced it is a
    conservative regrid of a minmod-limited reconstruction — limited because the
    unlimited slope puts negative cells in the ring troughs, which `imaging/noise`
    refuses. § 8a.7's obstruction reading tightened from −4.3e-4 to 1.2e-5, past
    the pupil grid's own 7.6e-5, which is the prediction the change had to meet.
    Two costs are recorded rather than absorbed: a destination cell the source
    does not completely cover is left at zero, so a rim of light at k > 1 is now
    REPORTED (§ 6j.2 goes from <1e-9 to 2.0e-3) rather than placed
    approximately; and the scheme is separable, so an on-axis PSF is its own
    transpose to one 8-bit level rather than to zero.

14. ~~**The ray branch's seeing blur has no grid-independent limit.** Found at
    § 5d.2 while closing A5: a single ray's deflection variance is ∫f³Φ(f)df
    over the screen's resolved band, which diverges at the high-frequency end,
    so the per-ray rms grows as (screen samples)^(1/6) — measured 1.247× for a
    4× refinement against a predicted 1.2599 — while the aperture-averaged
    centroid that Fried's angle of arrival pins does not move at all. Only the
    centroid is therefore pinned, and the blur's fine structure is a property
    of the screen grid rather than of the sky. *Candidate:* real turbulence is
    not scale-free at the bottom either — the **Tatarski inner scale** damps
    the spectrum by exp(−f²/f_m²) with f_m = 5.92/(2π·l₀) and l₀ of order
    millimetres, which makes the integral converge and turns the divergent
    statistic into a physical one. What it unblocks is a *blur* the ray branch
    can be pinned on, and not only a centroid.~~

    ✅ **CLOSED at [§ 5d.3](VALIDATION.md#-5d3--the-inner-scale-and-the-blur-that-finally-has-a-limit).**
    The candidate was right and is now the engine: `SeeingSpec` takes an
    `innerScaleMm`, and Tatarski's `exp(−f²/f_m²)` with `f_m = 5.92/(2π·l₀)`
    damps the spectrum where the moment diverged. Over the same 4× refinement,
    the same seeds and the same reader, the Kolmogorov per-ray rms grows by
    1.2628 (against 4^(1/6) = 1.2599) and the damped one by **0.9855**. The
    converged value is bracketed by its own closed form — `c·f_m^(1/3)·Γ(1/6)/2`
    above, the same less the sub-grid band below — with Γ(1/6) computed by the
    ladder's own quadrature and pinned by Euler's reflection formula rather than
    quoted. Fried's aperture-averaged coefficient does not move, which is the
    thing that had to stay still. What the step did NOT take is the other end of
    the same correction: the outer scale is still infinite, so § 5d.2's
    0.60 → 0.80 → 0.96 trend still has no physical stopping point.

15. ~~**The distortion map has two chief rays, and the ladder traced the other
    one.** Found at § 6cn while closing 6. `pupil/aiming`'s `chiefRay` targets
    `pupil.entrance.z` — the PARAXIAL entrance pupil — and solves the ray onto
    the actual stop only when a system asks for real ray aiming, which none of
    the mosaic rungs does. On § 6ck's objective, whose diaphragm is the last
    surface, the two rays give the same third-order coefficient to 1.4e-8 and
    quartics that differ by a factor of twenty-seven and a sign. Everything
    § 6bk onward traced is self-consistent and the frames are the frames the
    ladder pinned; what is unpinned is **which of the two the engine should
    mean by "the chief ray"**, and what switching costs. *Candidate:* measure
    the same mosaic rungs under `rayAiming: "real"` and see whether anything
    load-bearing moves — the cube shifted 3.6e-4 to 2.9e-3 across four cells,
    which is inside every tolerance on the chain and outside none of the
    readings quoted to five figures. **And that 3e-3 is itself unexplained**,
    which is the sharper half of this item: § 6cn's series reproduces the exact
    trace on the reversed prescription to 5e-12, so if its ray is the
    stop-centre ray then real aiming should agree with it BETTER at third order
    than paraxial aiming does — and it agrees five orders worse. It is not the
    aiming solve's tolerance, which is 1e-12 of the stop radius. Something
    separates the reversed objective from the forward microscope at the 1e-6
    level: § 6cn's reversal is only good to 5e-6 in magnification, the same size
    as § 6ch.1's `(f/f_d)²`, and nobody has separated the reversal's residue
    from the aiming's. *Candidate:* trace the forward microscope's chief ray
    under both aiming modes at one field point and read where each crosses the
    diaphragm — one number decides whether the 3e-3 is the ray or the plane.~~

    ✅ **CLOSED at [§ 6co](VALIDATION.md#step-6co--the-maps-cube-moved-by-the-reading-plane-not-by-the-ray).**
    The candidate above is not what decided it — it could not have. Real aiming
    drives the chief ray's stop miss to 1e-12 of the stop radius *by
    construction*, so reading the crossing reports the solver, not the map. The
    **refocus sweep** decided it. `distortionSeries` reports the map between the
    reversed system's own paraxial CONJUGATE planes; these objectives are focused
    2.3% to 4.2% away from that conjugate, so the plane it reads at misses the
    specimen by 2.0e-3 to 3.3e-2 mm, and the object-space chief ray's long lever
    (2.9–6.0 m) turns that into exactly the offset measured between the two maps
    (`dz/L` = 5.5437e-6 against 5.5436e-6). Read the SAME exact trace at the
    specimen plane and the fitted cube lands on the real-aimed one to 8e-11 and
    the quartic to 2.6e-6. Walk the image plane to the paraxial conjugate and the
    shift is proportional to the defocus and gone at it, while the QUARTIC's
    discrepancy survives — so the cube was the plane, the quartic is the ray, and
    § 6cn.5's finding stands. The engine's answer to "which ray is the chief ray"
    is unchanged: the stop-centre ray, which `rayAiming: "real"` gives, and which
    an independent machinery now agrees with to 8e-11 once read at the right
    plane. The 1.4e-8 that made the two look like one is the fit's floor.

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

## C. The fluorescence-mosaic chain, § 6bk → § 6cq

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

**The stop rule has now fired a second time, and this entry says so.** All three
items below were named here as worth a step and all three landed — § 6cn
(engine change), then § 6cp and § 6cq. But § 6co, § 6cp and § 6cq are three
measurement-only steps in a row with neither an engine change nor an external
pin between them, which is exactly the count the rule stops at. So nothing below
returns to the ladder as a fourth step. What the last three left is recorded here, as
problems:

- **Four of § 6bn's six interactions still have a matched-field reading on
  neither interval** — the two flat-field splits, the free-field gain and the
  guard-band escape. § 6bp reached three of them on the SECOND interval only;
  the first would want § 6bp's rendered fixtures at 4× and escapes at 4× beside
  § 6bo's at 20×. Until then § 6bn's "not one of the six is a slope" is
  narrowed by § 6cq and not settled. This is the one item here that a step
  could still close, and it is rendered fixtures rather than a new idea.
- **Which field a matched-field interaction should be read AT has no answer.**
  § 6bo.2 proved the readout is not separable in (field, lever), so the two
  members § 6cq measures must disagree — 0.6837 against 0.9500 — and adding a
  third member would not choose between them. Every interaction quoted on this
  branch therefore carries an unstated field, which is the same disease § 6bn
  diagnosed as "a reading quoted without the condition it was taken under", one
  level up.
- **The balanced guard's residue is unnamed on both seams, and the two have
  opposite signs** — § 6cl's +3.3·10⁻⁴ on the field seam against § 6cp's
  −2.5·10⁻⁵ and −4.6·10⁻⁵ on the stage seam. Nothing varies anything that would
  separate them.
- **Why the rendered plateau scatters 0.98% in the sampling** (§ 6cq.1). Not the
  coarse pass, which is pinned, and not integrality; larger than the 0.34%
  § 6bf.5 measured over a 4× change of sweep step, on a lever § 6bf never varied.
- **The stage form's row split changes sign near w ≈ 1.05** (§ 6cp.4), a little
  past § 6cd.1's edge at 1, and whether the offset is the map's `ε` or the moved
  argmax is unmeasured — the same unwritten form § 6cd, § 6ce and § 6cf all
  stopped at.

**Worth a step, because it is an engine change or a real rung**

- ~~**Fifth-order distortion.**~~ ✅ — landed at
  [§ 6cn](VALIDATION.md#step-6cn--the-maps-quartic-computed-rather-than-fitted),
  and NOT by transcribing Buchdahl: distortion is a chief-ray property, and with
  the stop at surface 0 the chief ray is the vertex ray, so an exact trace
  carried in truncated power series hands the quartic over at machine precision.
  Two closed forms pin it (a single spherical surface stopped at its own vertex,
  whose distortion has no curvature in it; a plate, whose `B/A² = 3/(2K)` is what
  keeps the quartic from masquerading as the cube). It pinned outside the fixture
  and then said something about the fixture: **§ 6ck's fitted `b` was the chief
  ray's AIMING**, +2.5983e-8 against the computed −9.3888e-10, and real ray
  aiming moves the fit onto the coefficient. What it left open (item 15) is now
  closed at [§ 6co](VALIDATION.md#step-6co--the-maps-cube-moved-by-the-reading-plane-not-by-the-ray):
  the cube's unexplained 2.9e-3 was the plane the module reads at, not the ray.
- ~~**A frame that is not a power of two.** § 6bo: § 6bn's first interval
  (4× → 10×) "wants a non-integer `pupilSamples` at every power-of-two size"
  and "would be an engine change". Without it, whether any of the six
  interactions is a slope is neither confirmed nor refuted.~~

  ✅ **CLOSED at [§ 6cq](VALIDATION.md#step-6cq--the-first-interval-and-the-engine-change-that-was-not-needed) — and NOT by making the engine change.** There was none to
  make. `objectFieldFrame` requires `pupilSamples > 0` and nothing else; the
  power-of-two rule belongs to the source LATTICES in `illumination/source` and
  `imaging/condenser-field`, which no readout on this branch touches. A frame at
  12.8 samples holds `ps·λ/(4·NA)` to the twelfth digit, carries the 4× cell's
  own field to a part in 10¹³, and is smooth through every integer — checked on
  the seam and on the rendered plateau, whose 0.98% scatter over ps 44–52 puts
  the nine integers through the whole ranking. **And the 4× frame was never the
  only member**: "at a matched field" names a family (§ 6bp.0), and at the 10×
  frame the quartet is all integers — § 6cl's own `STEP_4_10`, built for the
  guard split and never read for this. So § 6bn's first interval is measured:
  the cost interaction crosses 1, 1.1061 → 0.9500 at the 10× frame and 0.6837 at
  the 4×, and the anisotropy's departure grows. **§ 6bn.5's "they go opposite
  ways" is withdrawn** — at one field both readouts sit below 1 on both intervals
  and both grow their departure. What is NOT settled is "not one of the six is a
  slope": four of the six still have a matched-field reading on neither interval,
  which is item 16 below.
- ~~**The stage interact's guard sensitivity**, asked § 6cl's question — "the
  cheapest open item on the branch", one file, and it either closes § 6ca.1's
  second pair the same way or shows the field seam and the stage seam differ.~~

  ✅ **CLOSED at [§ 6cp](VALIDATION.md#step-6cp--the-stage-seams-guard-sensitivity-one-power-down),
  and the answer is BOTH.** Same way: the stage split is the same four integers
  with one power off — `P/2` on rows against `P` on columns, because the stage
  row seam is first order in the kept tile where every other seam on the branch
  is second — reproducing both live slopes to 0.17% at the smallest tile. What
  that buys is the registration cost: on COLUMNS both seams are second order and
  both scans read one kept tile bitwise, so the prefactor cancels **identically**
  and the column cost slope is pure shape; on ROWS `−P/2` survives and is 86% of
  the whole slope. § 6ca.4's "small number produced by two large ones" is two
  branches of one cancellation, and balancing the share takes the stage
  sensitivity down by 12657× against the field's 2180×. Differ: **§ 6cd.1's edge at
  `w = 1` is the ROW branch's alone** — the column split holds to 1.1% out to
  w = 1.71, monotone per offset, where the row split changes sign near 1.05 and
  runs to −80%. That asymmetry is the new thing, and § 6cf could not have said
  it because it never split the interact into prefactor and shape; the field
  form has no edge in `w` at all. What follows from it is that § 6ca.1's own
  0.2637 and 0.6132, read at w = 1.3692, have a good column half and a row half
  a quarter away from the form — so the in-domain axis constant is 1.73–1.95 and
  not 2.33. (That the anchor is past the edge is § 6cf.5's finding, not this
  one; what is new is which half of the pair pays for it. The w confirms
  § 6cf.5's 1.36642 unit correction to five figures on a quantity it never
  read.)

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

- ~~**Hopkins' TCC**~~ ✅ **built at § 6cr** — the kernel, exactly Hermitian and
  positive semi-definite, giving `abbeImage`'s own image to 1e-15 off one
  transform instead of 177, with a **three**-disc closed form pinning it off the
  diagonal and § 6f's two transfer curves turning out to be the real and
  imaginary parts of one complex number. **→ phase contrast and DIC are still
  v2:** § 6cr builds the object they act on, not them — a phase plate in the
  pupil and a sheared pair are unbuilt, and the annular source
  (`latticeAnnularSource`, § 6ab.19) is still unwired.
- **The sum-of-coherent-systems decomposition** — opened by § 6cr and the reason
  it measured its own memory. The kernel is M × M complex over the M lattice bins
  the shifted pupil reaches, M ≈ (π/4)(1+S)²·pupilSamples², so it is **2.9 MB at
  pupilSamples 16 and 48.4 MB at 32** — the fourth power, measured. Being
  Hermitian and PSD it is a sum of coherent systems. **What is free is only a
  bound, and it is not the payoff:** TCC = AᴴA over the condenser, so the rank is
  at most the contributing-point count — untruncated, the decomposition is 177
  coherent systems, exactly `abbeImage`'s own cost. The whole win is in the
  truncation, so the step's question is *how few eigenvalues suffice and what
  dropping the rest costs*. Blocked on a **complex Hermitian eigensolver**:
  `math/lsq`'s `singularSystem` is one-sided Jacobi on a REAL matrix. Until it
  exists, `hopkinsImage` has no caller — wiring it into `renderBrightfield` costs
  patches² × M².
- The non-isoplanatic partially coherent image's limit (§ 6g) is **narrowed and
  not closed** by § 6cr: the kernel is isoplanatic, exactly as `abbeImage` is, and
  a non-isoplanatic one has four arguments. Coherence off axis and polychromatic
  coherence (§ 6g, § 6t), critical illumination and a non-uniform source (§ 6f,
  § 6x, § 6ag, § 6ah): none of them moved.
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
3. ~~The sky and **the noisy frame** (A3, A4)~~ ✅ — the noisy frame at
   § 8a.7–§ 8a.11, the sky and the limiting magnitude at § 8b. A13 came out of
   A4, is the other half of what walking that route found, and was untouched by
   § 8b — the resampling excess rode the sky's frame exactly as it rode the
   star's. **Closed at § 8c** (item 13 below).
4. ~~**Stop-shift equations** (A7): a named pin, an engine change, retires a
   control.~~ ✅ — landed at § 6cm. Two of the three: the pin and the engine
   change. The control stays, for a reason that predates the deferral.
5. ~~**Seeing's ray analog** (A5): the oldest deferral on the telescope
   branch, and the one a user drags a slider across.~~ ✅ — landed at § 5d.2,
   with the register's own coefficient corrected (G-tilt 0.170, not Z-tilt
   0.182) and one new item (14) opened by what the per-ray statistic turned out
   to do.
6. ~~**Fifth-order distortion** (C): the only thing on the mosaic chain that
   pins outside the fixture.~~ ✅ — landed at § 6cn. It pinned outside the
   fixture and then corrected the fixture's own reading: the quartic § 6ck
   measured was the tracer's chief-ray aiming, not the glass. One new item (15).
7. ~~**The stack's resampling moves energy** (item 13): no external number
   needed, and it sits under every absolute reading downstream.~~ ✅ — landed at
   § 8c. "No external number needed" was half right: the identity pins the bug,
   but a conserving resampler is cheap to write badly, so the step is pinned to
   closed forms with no engine in them as well. It also came in FASTER than what
   it replaced, and cost two things that are recorded rather than absorbed.
7½. ~~The two cheapest items on the mosaic chain (Part C).~~ ✅ — the stage
   interact's guard sensitivity at § 6cp and § 6bn's first interval at § 6cq.
   Neither needed an engine change, and the second found that the deferral
   blocking it was simply wrong: a non-integer `pupilSamples` is a frame this
   engine already forms. **The chain's stop rule has now fired a second time** —
   Part C lists what the last three steps left, as problems rather than steps.
8. ~~**Hopkins' TCC** (D): the v2 step, scoped as an engine step in ARCHITECTURE
   before a line is written — the brightfield refusal (§ 6f.9) is where it
   plugs in.~~ ✅ — landed at § 6cr. ARCHITECTURE was written first, as the entry asked.
   § 6f.9 needed nothing: `brightfieldFidelity` rules on a traced pupil's own
   sampling and cannot tell which sum consumed it, and the refusal it encodes
   survives — a TCC is built out of coherent fields and a ray histogram has none.
   What the plug-in point cost instead was the *grid* guard, which moved into
   `illumination/lattice.ts` so both sums report one number. Two things it did not
   deliver and one it opened: phase contrast and DIC stay v2, the non-isoplanatic
   limit stays open because the kernel is isoplanatic, and the memory cost
   (48.4 MB at pupilSamples 32) opens the decomposition as the next step.
9. **The sum-of-coherent-systems decomposition** (D): what § 6cr's fourth-power
   memory points at, and the step that gives `hopkinsImage` a caller. Needs a
   complex Hermitian eigensolver, which is its own rung set.
10. ~~Make the ladder green off the author's machine (the structural problem
    above) before any of 3–9 is trusted on a second one.~~ The convention is in
    and the assertions are restated (see the structural problem above); what
    remains is one confirming run on a second machine, which is now a check
    rather than a piece of work.
