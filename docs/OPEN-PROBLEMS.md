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
6. ~~**Transport of intensity** — brightfield's geometric analog, "rays
   refracted by the specimen's phase gradient" (§ 6f.9, *Later rungs*). Needs
   rays that start at a transmittance, which `exitBundle` does not do. The
   ladder names no pin. *Candidate:* the weak-phase defocus transfer,
   contrast ∝ sin(π·λ·z·ν²) (Teague 1983), on § 6f.5's own phase grating that
   brightfield cannot see in focus.~~

   ✅ **CLOSED at [§ 6f.10](VALIDATION.md#6f10--transport-of-intensity-the-rays-the-specimens-own-phase-bends).**
   The candidate was right about the pin and the fixture, and **the entry's own
   blocker was wrong again** — § 6cs's eigensolver and § 6cq's engine change went
   the same way. Rays that start at a transmittance are not needed: the ray answer
   is the closed-form map x′ = x + δ·∇φ(x), so there is no bundle to trace, no
   aim to solve and no Monte Carlo. `illumination/transport` pushes the object's
   flux along that map (conservative to 1e-13, and it survives rays crossing) and
   differentiates it as well (I/|det J|, which is where the Laplacian in Teague's
   equation comes FROM — the trace of a Hessian falling out of a determinant,
   rather than an equation discretized).

   **What it is pinned on.** The whole units bridge first, on its own, as
   δ = −4·w₂₀·padFactor²/π against λz/(2π·Δx²) rebuilt from a physical pupil —
   and the DEFOCUS sign, which no convention in the engine fixed, measured off
   `abbeImage` rather than derived. Then the closed form: the de-windowed
   contrast is 2·φ₁·2π·w₂₀·ν², and against the engine's own wave branch the ratio
   is **χ/sin χ** across a defocus sweep, which is the statement "this is the
   geometric limit of that" as a measurement. Two things came out that neither
   the entry nor § 6f.5 could say. The fold is at **2·φ₁·χ = 1** — ray optics
   stops having one answer exactly where believing it would have meant believing
   in 100% modulation — and § 6f.5's in-focus null is reproduced by a *different
   mechanism*: not two sidebands cancelling, but no lever, so nothing moves.

   **What is left, named rather than folded in.** The branch is **source-blind**
   and honestly cannot be otherwise: opening the condenser damps the wave answer
   1.9% by S = 0.6 and this one does not move, because a ray carries no direction
   to weight a deposition by. § 6f.9's cliff is therefore untouched — this is a
   separate capability, not a fallback under `brightfieldFidelity`. And the
   *traced* version is unbuilt: the objective's own aberration between the
   specimen and the plane, which is what `exitBundle` would actually have been
   for. Nothing has asked for it yet.
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
8. ~~**Astigmatism and field curvature on conics.** Every reflector preset
   (§ 4b, § 5e, § 5f, § 5i) and the Lister (§ 6d) say "what is missing is the
   external number, not the measurement", since `seidelSums` refuses conics.
   *Candidate:* the classical two-mirror field aberrations in Schroeder
   (*Astronomical Optics*, ch. 6).~~

   ✅ **CLOSED at [§ 5j.3](VALIDATION.md#5j3--the-conics-own-third-order-term-and-the-reflectors-field)** — and the candidate was not needed. The
   refusal was not "a different closed form": a conic's departure from the base
   sphere is a quartic, a quartic sag is a phase plate on the surface, and one
   expansion of (ρy cosθ + ηȳ)⁴ hands over the whole third-order set as one
   constant times powers of the two ray heights. **ΔS_IV = 0 falls out of that
   expansion** rather than being asserted, through the same S_III/(S_III + S_IV)
   split `analysis/field` already uses — so the derivation carries its own check.
   The pins are closed forms with no engine in them and no book to transcribe: a
   paraboloid nulls ΣS_I at every radius and aperture (which is what fixes the
   one constant's SIGN, and the first derivation of it was wrong); a prolate
   ellipsoid's own geometry gives K = −e², which is the module's ΣS_I = 0 root to
   1e-12 and stigmatic to all orders in the trace; a mirror stopped at itself has
   a **flat sagittal field** because S_III + S_IV carries a factor (n + n′); a
   Schmidt camera's film former has radius f, and its residual coma and
   astigmatism are the corrector's own glass path in closed form.

   **Three things the entry got wrong.** The Lister was never blocked on this —
   § 6d is a FINITE conjugate, and `thirdOrderSags` refuses one for § 6b's
   chief-ray convention, which is untouched. § 5h (the Schmidt-Cassegrain) was
   blocked and is not listed. And Schroeder's two-mirror forms are still what
   would pin the RC-vs-Cassegrain astigmatism *ratio*, which is computable now
   but is a consistency check — so this item closes as a **capability**
   (`thirdOrderSags` returns both focal surfaces for every reflecting preset) with
   that one external number still named and unclaimed.
9. ~~**The exact Ewald cap against the quadratic wavefront** (2.6× at NA 1.40).
   § 6k names the pin: "a wavefront traced through a defocused *object*
   plane".~~

   ✅ **CLOSED at [§ 6k.8](VALIDATION.md#-6k8--the-exact-cap-and-the-paraboloid-that-osculates-it),
   and the named pin is the fifth blocker in a row not to exist.** The depth phase
   is n·δ·cosθ on every plane-wave component of the emitter's own field, and the
   pupil coordinate IS that direction — so there is nothing to trace, and the
   entry's *2.6× was one of two numbers*. It is the slope at ν → 0, where the
   boundary is a tangent and nothing can be measured; at the pupil edge, which is
   where a widefield microscope actually sections, the cap grows by **1.4429**.
   Quoting the 2.6 as the curve would overstate it by 80% at that frequency.

   **The trace was attempted rather than argued away**, and what it found is
   recorded: an OPD map references its sphere to the chief ray's crossing, so on
   an aberrated system the moved sphere couples to the transverse ray error at
   first order (1–3% residual on a reversed 100×/1.40, ρ-dependent and not
   vanishing with the shift). A fixture that isolated the cap by tracing would
   have to be stigmatic at both conjugates — Herschel beside Abbe — which cannot
   hold away from unit magnification. So no cheap fixture exists, and that is a
   property of the problem.

   **What it took from § 6k.4 is three things, all the paraboloid's**: the lattice
   period P(ν) (the comb is gone — odd bins 4e-15 under the paraboloid, 0.56
   under the cap), the 2% envelope threshold with it, and the stack settings
   themselves (2.18 waves per grid step against 0.97). And **§ 6k.7 gains a
   condition**: its conjugate invariance is of one NUMBER, not of the wavefront
   — s = NA/n is 0.9191 on the specimen side of a shipped 100×/1.40 and 0.014439
   on the camera side, so the two exact wavefronts differ by more than a third of
   a wave per wave of defocus. What is left open is the aplanatic amplitude
   apodization (an amplitude, so it would break § 6k.1); ~~and the fact that nothing
   yet CHOOSES the cap: `renderVolume` takes whatever pupils it is handed.~~
   **Closed at [§ 6k.9](VALIDATION.md#-6k9--the-engine-chooses-the-cap-and-the-band-it-counts-as-focus)**,
   which found the wiring to be the smaller half: the paraboloid was also setting
   the **band** `inFocusFraction` counts as focus, and the exact one is
   (1 + cos α)/2 of it — 295 nm against 426 on an oil 1.40, so § 6k.2's reading of
   how much light is in focus was 44% generous. It leaves item 16.
10. ~~**A depth-varying phase stack's support boundary.** § 6l: "a different
    closed form" from § 6k's.~~ ✅ — landed at § 6l.12, and the entry's own words
    were the error. There is no different closed form: the stack's phase is
    exactly linear in the coordinate it is transformed over anyway (the depth
    aberration is a bare factor in d, the waves-to-depth map is affine), so
    § 6k.4's derivation survives whole and only the per-wave profile changes — and
    that profile collapses to § 6k.8's law at the **immersion's** aperture angle
    over the **mount's** rim. One wave of the stack is exactly an ideal defocus in
    the immersion, which makes § 6l.5's focus-knob scaling the whole of what a
    depth costs the family. Two things it cost that the entry did not price: the
    angle and the rim had to stop being one argument (`ewaldConeEdgeAtRim`, with
    both older boundaries as cases of it), and the collapse belongs to the exact
    defocus half only — the paraboloid default's profile turns over inside the rim,
    so its maximiser is interior and `mountConeEdge` refuses it rather than
    approximating. The app half is **item 19**.
11. **An immersed image plane behind an objective.** Opened by § 2g, which
    pinned the index on a single surface; a design where it enters twice
    (§ 6e's front and a back) does not exist on the ladder.
12. **Which way an aberration-free band moves the Airy core.** § 6j names
    "an analytic band-integrated Airy" as the resampler-free check.
16. ~~**The exact band is reported and never defaulted**, and `packages/app` still
    asks for the paraboloid. § 6k.9: `inFocusFraction` still means the
    paraboloid's quarter wave beside the exact `exactInFocusFraction`, because
    defaulting it would rewrite readings on rungs that have nothing to do with
    that step; the app's one `renderVolume` call builds `defocusing`, and moving
    it is an APP.md costing rather than an engine one. Both renderers report the
    exact band, and every other user of a quarter-wave depth of focus in the
    engine sits at NA 0.17 or below where the two agree to 0.7%, so what is left
    is a decision rather than a measurement: which reading the ladder's older
    rungs are entitled to keep. No external number would settle it.~~

    ✅ **CLOSED at [APP.md — the picture chooses its depth wavefront](APP.md#the-picture-chooses-its-depth-wavefront)**,
    in its two halves and by two different kinds of answer.

    **The default half closes as a recorded decision and no code**, which is what
    the entry itself said it was: `inFocusFraction` keeps the paraboloid's band,
    `exactInFocusFraction` is the one to believe, and every other user of a
    quarter-wave depth of focus in the engine sits at NA 0.17 or below where the
    two agree to 0.7%. Moving the default would rewrite pinned numbers on rungs
    that have nothing to do with § 6k.9, which is the thing the hard rules forbid;
    reporting both is what a reading taken under one convention and superseded by
    another actually looks like.

    **The app half closes as work**, and it cost more than the entry priced. The
    picture is on the exact cap, and the two are **0.36 of peak apart** on the
    shipped oil 100×/1.40 — measured, converged, and *under*-reported by a tenth
    at the panel's own default pupil, which is why the panel's grid guard is left
    to fire rather than the default raised. It costs no time (one square root
    against a multiply) and the sampling cost is bracketed by 1/cos α rather than
    recorded. Two of the panel's four surfaces deliberately stay on the paraboloid
    with a measured number behind each refusal. And the two in-focus fractions
    read **equal** on every setting the panel can reach — the band moved, the
    light in it did not — so the step's real risk was the caption rather than the
    code.

    **The entry's own sentence "moving it is an APP.md costing rather than an
    engine one" is false**, and that is item 17. Four named blockers in a row
    turned out not to exist (§ 6cs, § 6cq, § 6f.10, § 6k.8); this is the mirror —
    an unnamed one that does.

17. ~~**`objectSinAlpha` refuses a mount rarer than the immersion, and § 6l.3 says
    the pupil there is simply dark.**~~ Found at APP.md's *the picture chooses its depth wavefront* while closing 16.
    § 6k.9 guards sin α = NA/n < 1 because sin α ≥ 1 is not a cone a medium can
    carry, and it named the two mistakes it was catching: an image-side aperture
    paired with an object-side index, and a dry objective engraved 1.2. A
    specimen mounted in something rarer than the immersion is a **third** case
    the text never considered and is not a mistake at all — an oil 1.40 over
    water is 1.05 and over air is 1.40, both shipped in the app, and the second
    is what the app's own code calls "the sharpest demonstration" of the wall.
    So two of four mount rows cannot have the exact depth phase.

    Pin: **the wall and the branch point are the same radius**, and it needs no
    external number because it is an identity of the two engine forms. § 6l.3
    zeroes the amplitude beyond ρ = min(NA, n_s)/NA; § 6k.8's radicand
    1 − s²ρ² runs out at ρ = 1/s = n/NA. Once the `min` has chosen n those are
    the same division of the same two doubles, which the app test already pins
    with `toBe` — so the exact phase is defined **exactly** where light exists and
    undefined exactly where none does, and `withObjectDefocus`'s existing
    disc ≤ 0 fallback already covers the rest. What a rung would have to add is
    the measurement that fallback's value is never read: two different finite
    values there must give a bitwise-identical image, because the amplitude
    multiplying them is zero.

    What it unblocks, stated as the hypothesis a step would test rather than as a
    result — *candidate*, in this file's sense, and derived here rather than
    measured anywhere. Because the wall and the branch point are the same radius,
    a truncating mount puts the **lit rim exactly at s·ρ = 1**: cos of the angle
    there is exactly 0, so the exact phase at the outermost lit sample is exactly
    **twice** the paraboloid's at that same radius and (1 + cos α)/2 is exactly
    **½** — not asymptotically, and not more so for a thinner mount, but ½ for
    every mount that truncates at all, water and air alike. **What would refute
    it** is a measured lit-rim ratio away from 2 on any truncating row.

    **And it is a prediction about a band convention that does not yet exist**,
    which is why it cannot be quoted as the answer today: `depthOfFocusMm` and
    `exactDepthFactor` both define the band at the **nominal** rim ρ = 1, and on a
    truncating mount that rim is dark. The ½ above is at the **lit** rim. Two
    rims, two bands, and every reading the ladder has was taken where the two
    coincide — the same shape of problem item 16 just closed, one level down, and
    the relaxation has to decide it before it can quote a number at all.

    ✅ **CLOSED at [§ 6l.10](VALIDATION.md#6l10--the-mount-that-has-no-aperture-angle-and-the-radius-that-is-not-one-expression)**, and the
    prediction it was built on was wrong in the place that mattered.

    **The engine change landed as described**: `mountSinAlpha` admits sin α ≥ 1,
    a mount rarer than the immersion gets the exact cap, and it is the **largest
    picture change on the ladder** — 0.4113 of peak at the coverslip against
    § 6k.9's 0.2893 for a *matched* oil 1.40. Larger, against the intuition that
    a truncated pupil is a smaller one, because the lit rim sits at s·ρ = 1 where
    the cap is exactly twice the paraboloid. It decays to 0.0244 by 10 µm as
    § 6l's own aberration takes 3.61× off the peak: the correction matters at the
    top of a specimen and is swamped at the bottom.

    **But "the same division of the same two doubles" was not true.** The identity
    is real in the RADIUS and both engine sites work in radius², where the two
    spellings disagree by an ulp in either direction — and on an oil 1.45 or 1.49
    over air, or a 1.49 over glycerol, the outermost lit sample came back on the
    paraboloid, half the phase, on light that is there. The ulp gap is not even
    the predicate; the rounding of `1 − s²ρ²` is a third expression. So the step's
    answer is not a more careful radius but **no radius**: √max(disc, 0) is the
    cap's own continuous limit and the second boundary is deleted. The free pin
    survived in better form — at s·ρ = 1 the phase is exactly **2×** the
    paraboloid's, `toBe` rather than asymptotic.

    **Two things it deliberately did not do**, both for item 16's reason. The
    guard was NOT widened on `objectSinAlpha`: the discriminator is the immersion
    index and that function is not given one, so a widened guard would have
    rendered the paraboloid over a lit annulus in `renderVolume`'s bare-pupil arm
    and turned a throw into a NaN in `exactDepthOfFocusMm`. And `packages/app` did
    not move: the picture is now available to those two rows but the band is not,
    and wiring one without the other breaks the panel's caption invariant. That
    residue is **item 18**.

18. ~~**Every depth-of-focus reading is taken at a rim that a truncating mount
    leaves dark.**~~ **Closed at [§ 6l.11](VALIDATION.md#6l11--the-band-at-the-rim-the-light-reaches).**
    Opened at § 6l.10 as the half of item 17 that did not close.
    `depthOfFocusMm` and `exactDepthFactor` both define the band at the **nominal**
    pupil rim ρ = 1, and on an oil 1.40 over water the light stops at ρ = 0.9533.
    So the phase is now exact on that mount and the band is still absent: § 6l.10
    pins that `exactDepthFactor` and `ewaldConeEdge` keep refusing sin α ≥ 1
    rather than returning a number for a rim with nothing at it.

    What a step would have to decide, and it is a **convention** and not a
    measurement — which is why it is here and not on the ladder. A band at the lit
    rim would make (1 + cos α)/2 exactly **½** on *every* truncating mount, water
    and air alike, since cos of the angle there is exactly 0. That is a clean
    number, and it is not comparable with any band the ladder already has: every
    existing reading was taken where the two rims coincide. Quoting it beside
    § 6k.9's 0.693 would be two criteria wearing one name, which is exactly what
    § 6k.9 refused to do to § 6k.2.

    Until it is decided, `packages/app` cannot show the exact cap on its WATER and
    AIR rows even though the engine can now render it: the panel's fields are
    absent *together* so that a caption cannot describe one wavefront beside a
    picture drawn on another (item 16).

    **The wavefront half of this is settled and there is nothing left to measure
    in it**: § 6l.10 pins the lit-rim ratio at exactly 2, `toBe`, at every s — so
    the old "what would refute it" (a measured ratio away from 2) is already
    closed by the step that opened this entry, and a reader looking for an
    experiment here will not find one. **What is open is a choice**: which rim the
    band is quoted at. Quoting the lit rim makes (1 + cos α)/2 exactly ½ on every
    truncating mount and makes every band on the ladder incomparable with it;
    quoting the nominal rim keeps them comparable and defines the band where there
    is no light. **What would refute the ½** is therefore not a measurement of the
    wavefront but a demonstration that the lit-rim convention breaks something the
    nominal one holds — flux, the § 6k.1 invariance, or a rung's reading — which
    is a thing to derive rather than to run. A step that closes this closes it by
    argument and a renaming, and its cost is in the readings it would have to
    restate, not in what it would have to trace. Also `depthOfFocusMm`'s own doc
    comment now says this at the function, so a caller meets it there.

    **How it closed, and the entry was wrong about the shape of the answer in two
    ways.** The choice went to the lit rim, written as **ρ_e = min(1, 1/s)** — and
    that min is what dissolved the entry's own objection. The two rims coincide
    everywhere a reading was ever taken, so nothing on the ladder is incomparable
    with anything and **no reading was restated**: § 6l.11 pins the factor bitwise
    against its old spelling at 4000 apertures below the wall. The cost the entry
    priced — "the readings it would have to restate" — was zero.

    The second error is the ½ itself. It is a ratio to a paraboloid measured at
    the *same* lit rim; `exactDepthFactor` multiplies the paraboloid at the
    **nominal** rim, and against that reference the factor is **s²/2**. Quoting
    the ½ would have shipped a band wrong by a factor of s². What the lit rim
    actually buys is a saturation the entry never names: past the wall the
    half-band is **λ/(4·n_s)** with the NA cancelled out, so an oil engraved 1.40,
    1.45 or 1.49 gets the same 206.04 nm out of water. And f is not monotone — it
    bottoms at ½ and crosses 1 at s² = 2, so an oil 1.45 over air has a band
    *longer* than the paraboloid's, which falsified every "% shorter" sentence in
    the engine and the app. `packages/app`'s WATER and AIR rows now carry the cap
    and the band together.
19. **`packages/app`'s D10 asserts a boundary § 6l.12 falsified.** The cone panel
    builds its stack from `mountPupils`' paraboloid default and compares the
    measured edge against ν·(2 − ν), then explains in prose that a mount *loses*
    the support law. It does not: § 6l.12 has the law. Pin: the panel's own edges
    against `mountConeEdge`, which needs the exact cap **and** a finer pupil than
    the panel pays for today — at 64 bins three of the four shipped mounts step
    over a wave between neighbours and read their leakage floor, which is where
    the "10 axial bins" came from. `conePeriodWaves` goes with it: it is the
    paraboloid lattice's period, and the exact profile has none, so that field is
    meaningless rather than merely different. Unblocks: the panel saying *check*
    where it now says *measurement*. **Trim before writing:** § 6l.12 left the
    index's mean row at 249.986 against `docs-index.test.ts`' cap of 250, so
    whichever step writes this one has 0.014 characters of headroom and must
    shorten an existing row before it adds its own.

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
- ~~**The sum-of-coherent-systems decomposition**~~ ✅ **built at § 6cs**, and it
  closed the memory question by a route the entry did not anticipate. The entry
  said the step was blocked on a **complex Hermitian eigensolver**. It was not:
  § 6cr's own pass one already builds A with TCC = A·Aᴴ and throws it away, so
  the modes are that factor's left singular vectors and λ = σ² — a complex SVD of
  an M × P matrix, where P is the direction count and does not grow with the
  pupil sampling. `complexSingularSystem` (§ 6cs.1) is the existing one-sided
  Jacobi plus a phase rotation, not a new solver.
  **The memory is fixed by the factorization alone, with nothing dropped**:
  47.1 MB → 4.75 MB at `pupilSamples` 32, and the ratio quadruples each time the
  sampling doubles (§ 6cs.2). **Two things the entry got wrong.** Its cost
  comparison was against `abbeImage`, but `hopkinsImage` already costs one
  transform, so the untruncated decomposition is *slower* than what exists and
  better only in memory. And "the whole win is in the truncation" is false in
  both directions: the win that mattered is not in the truncation at all, and the
  truncation is a lossy trade rather than a free one — 90% of the transmitted
  light is 7 modes of 69, but **99% is 48 of 69** (§ 6cs.4).
  **Still open, and now sharper:** whether the coherent sum beats Hopkins' in
  *wall time*. § 6cs.4 declines to answer it, because `kernelTerms` and
  `transforms` are different units and dividing them is a flop estimate dressed
  as a reading — what is measured is that Hopkins' work moves 311× with the
  specimen (475 terms on a grating, 147 873 on noise) and the coherent sum's does
  not move at all. `renderBrightfield` therefore stays on the Abbe sum, and
  wiring either one into it is a step nobody has costed.
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
9. ~~**The sum-of-coherent-systems decomposition** (D): what § 6cr's fourth-power
   memory points at, and the step that gives `hopkinsImage` a caller. Needs a
   complex Hermitian eigensolver, which is its own rung set.~~ ✅ — landed at
   § 6cs, and the eigensolver was **not needed**: the kernel is A·Aᴴ and § 6cr
   already built A, so a complex SVD of the factor does it. The fourth-power
   memory is gone with nothing approximated (47.1 MB → 4.75 MB at pupilSamples
   32). Neither of the entry's other two predictions held: the untruncated
   decomposition is slower than `hopkinsImage` rather than equal to `abbeImage`,
   and truncation is lossy — 99% of the light needs 48 of 69 modes.
   `hopkinsImage` still has no caller in `renderBrightfield`, and what would
   settle that is a wall-time measurement nobody has taken.
10½. ~~**Astigmatism and field curvature on conics** (A8): an engine change,
    and the widest unblock left — five presets carry the same deferral.~~ ✅ —
    landed at § 5j.3, and the register's candidate (Schroeder's two-mirror forms)
    was not needed: the refusal was one constant, derivable in a page, and the
    pins are a paraboloid, an ellipsoid, a bare mirror's flat sagittal field and
    a Schmidt's film former. What it leaves is one external number still named:
    the two-mirror astigmatism ratio is computable but is a consistency check.
10¾. ~~**Transport of intensity** (A6): the last entry in A with an engine
    change in it, and the one a defocus slider would show.~~ ✅ — landed at
    § 6f.10, and the blocker the entry named (rays that start at a transmittance)
    was the fourth in a row not to exist. What it leaves is the traced launch and
    the source it cannot carry.
11½. ~~**The cap nothing chose** (item 9's residue): the one loose end § 6k.8
    left with an engine change in it.~~ ✅ — landed at § 6k.9. The wiring was
    two lines; what it cost was the **band**, which was the paraboloid's quarter
    wave everywhere and is 31% shorter on the exact wavefront. The default
    aperture is 0 and `withObjectDefocus` at 0 is `withDefocus` bitwise, so two
    call sites moved onto the aperture-aware form with every reading intact by
    construction. One new item (16), and no external number in it.
11. ~~Make the ladder green off the author's machine (the structural problem
    above) before any of 3–9 is trusted on a second one.~~ The convention is in
    and the assertions are restated (see the structural problem above); what
    remains is one confirming run on a second machine, which is now a check
    rather than a piece of work.
12. ~~**The band nothing displayed** (item 16): the app half of § 6k.9, and the
    only entry left with a *decision* rather than a measurement in it.~~ ✅ —
    landed at APP.md's *the picture chooses its depth wavefront*, in two halves and by two kinds of answer. The
    decision half closes as a decision and no code, which is what the entry said
    it was. The app half cost more than the entry priced — 0.36 of peak on the
    shipped oil 1.40, a grid guard deliberately left to fire, two surfaces that
    stay on the paraboloid for measured reasons, and a caption whose real risk
    was two numbers that agree. And the entry's own "an APP.md costing rather
    than an engine one" is falsified, which is **item 17**.
13. ~~**The mount that has no aperture angle** (item 17): an engine change with a
    pin that is an identity of two forms the engine already has, and the widest
    unblock left on the microscope branch — the exact cap on every mount, and the
    limit where the in-focus band halves.~~ ✅ — landed at § 6l.10. The engine
    change is in and buys the ladder's largest picture change (0.4113 of peak at
    the slip). The "identity of two forms" was not one: it holds in the radius and
    breaks in the radius², so the fix was to delete the second boundary rather
    than align it. The band did not follow, and that is **item 18**.
14. ~~**The band at a rim that is dark** (item 18): the residue of 17, and the one
    entry left whose blocker is a *convention* rather than a measurement — every
    depth-of-focus reading the ladder has is taken at the nominal rim ρ = 1, and a
    truncating mount has no light there. It is item 16's shape one level down.~~ ✅
    — landed at § 6l.11, and the convention cost nothing it was priced at. Writing
    the rim as min(1, 1/s) makes the lit-rim band an *extension* rather than a
    rival: the two rims coincide on every reading the ladder has, so nothing was
    restated and the factor is bitwise its old self below the wall. The entry's ½
    was a ratio to the wrong reference — s²/2 is what the engine's own band
    multiplies — and what the lit rim really buys is a **saturation**: λ/(4·n_s)
    per side with the NA cancelled out. One thing it falsified along the way: the
    exact band is not always the shorter one, crossing at s² = 2.

15. ~~**A depth-varying phase stack's support boundary** (item 10): the widest of
    the three A items left, and the one sitting under every axial reading a mount
    touches.~~ ✅ — landed at § 6l.12, and it needed no external number at all:
    the boundary reduces to § 6k.8's own law at the immersion's angle, so the pin
    is that reduction plus a brute force over lit pairs. The entry's "a different
    closed form" is the thing that turned out to be false — the third deferral on
    this step to fall to being read rather than to being measured. What it opened
    is **item 19**, the app half.

16. **The off-machine run** (the structural problem at the top): one confirming
    run of the ladder on a second machine, now a check rather than a piece of
    work — though not the cheap command this file called it, since the Linux
    subsystem on the author's box has no Node installed. Then **item 19** (an app
    costing, and the only entry left with a falsified claim shipped in it), and
    Part A's items 11 and 12, neither of which has an external number named yet.
