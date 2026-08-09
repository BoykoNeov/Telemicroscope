# Roadmap

## Build order

1. **Core skeleton + validation harness** ✅
   math, geometry, materials, paraxial + exact sequential trace — tested to
   textbook values (see VALIDATION.md).
2. **System spec + pupils + compiler** ✅
   The prerequisites the wave layer cannot be built without:
   - `OpticalSystem` — aperture, field, wavelengths, conjugate, image
     surface. A bare prescription only determines EFL/BFD; everything
     field- or aperture-dependent needs these. Finite conjugates land here,
     which is what unblocks the microscope branch later.
   - `core/pupil` — the aperture stop finally *does something*: entrance and
     exit pupil location and size, chief ray, ray aiming, pupil grids, and
     the two wavefront reference conventions. "OPD at the exit pupil" is not
     computable without this.
   - `compile()` — prescription → flat `CompiledSystem`, traced against
     once rather than resolved per ray (measured 6.3× on the hot path).
   - **Focus solve** — best focus by paraxial / minimum-RMS-spot /
     maximum-Strehl criteria (they genuinely disagree). "Is it in focus?" is
     the most common user action in both branches and everything downstream
     assumes an answer exists. Landed in `core/analysis` alongside spot
     diagrams, which share its machinery: exit rays are straight lines, so the
     geometric criterion is a closed form rather than a search. Max-Strehl is
     implemented as min-RMS-wavefront — monotone in Strehl by extended
     Maréchal, and it needs no PSF, which does not exist until step 3.
3. **Wave layer** ✅
   OPD → PSF → MTF, geometric-PSF fidelity switch with blend band and matched
   energy normalization, polychromatic stacking, Zernike decomposition
   (also the resampling basis — see the pupil-sampling note in ARCHITECTURE).
   - `core/math/fft` + `core/wave/zernike` ✅ — the transform and the basis,
     landed ahead of the PSF so each got its own rungs instead of being
     validated implicitly through a diffraction pattern. The Zernike fit is
     the resampling step ARCHITECTURE requires: trace coarse, fit, evaluate
     the fit on the fine FFT grid.
   - `core/wave/psf` + `core/wave/mtf` ✅ — pupil function → FFT → PSF →
     MTF, pinned to the Airy encircled-energy fractions, Maréchal and the
     closed-form circular-pupil MTF. Energy is normalized to the transmitted
     pupil energy *now*, before a second PSF branch exists to disagree.
   - `core/wave/fidelity` ✅ — the criterion, measured on the RAW traced
     samples. Not on the fitted wavefront: a Zernike fit is band-limited by
     construction, so it reports "smooth, FFT valid" whatever it was fitted
     to, and would be blindest when the fallback is most needed.
   - `core/wave/geometric` ✅ — the ray-histogram branch, matched to the
     diffraction branch's energy exactly, and cross-faded over a smoothstep
     band rather than switched at a threshold.
   - `core/wave/polychromatic` ✅ — each wavelength resampled onto a common
     *physical* image grid before the weighted sum. `pixelScaleMm` is ∝ λ, so
     a bin-for-bin sum silently rescales each component instead of stacking
     it, flattening the very chromatic differences the calculation is for.
   The wave layer is complete; step 4's hero image is next.
4. **First hero image (end-to-end thread)** ✅
   Refractor + star scene → rendered image. Ugly UI, correct physics.
   *Milestone:* purple fringing appears for a singlet and shrinks for an
   achromat because the glass data says so. ✅ — reached headless and pinned
   (VALIDATION step 3b); the golden-image harness landed with it.
   - `core/photometry` ✅ — CIE 1931 observer, Planck sources, sRGB. The
     layer that makes the milestone *visible*: fringing is the chromatic
     focal shift step 1 pinned, seen through the response of an eye.
   - `core/imaging` colour ✅ — colour is integrated **per wavelength**, off
     `SpectralStack`, which stops one move short of summing precisely so the
     grayscale and colour paths can share one grid and one resampler.
   - `core/imaging` full-field render ✅ — per-patch convolution with a
     partition-of-unity blend and progressive refinement. Cost is
     patches × wavelengths × (one PSF + one convolution), and the PSF
     dominates; that is the number refinement exists to hide.
   - App ✅ — ugly UI on port 5187 via the port guard, rendering both lenses
     live with the engine's own numbers on screen. Driving it found two
     things the headless suite did not: the geometric branch's ray count does
     not scale with the blur, and off-grid light *wraps* rather than
     vanishing. Both are now surfaced in the UI rather than hidden.
   - **Carried into step 5, now closed at the engine:** step 5 opened by
     resolving the 0.049 residual — a real 90° kernel-orientation bug (see
     VALIDATION § 3c) — after which `renderField`'s orientation was pinned by
     symmetry rungs and its first real picture was rendered, looked at, and
     committed as a golden.
   - **Multi-star field panel ✅** — the last step-4 leftover, now in the app:
     `renderField` exposed as a 5×5 star field through the achromat, each patch
     tracing its own PSF so coma flares radially outward and grows toward the
     corners. App wiring only — the capability was already pinned (render.test
     symmetry rungs) — but it surfaced the framing lesson that at the native PSF
     pixel scale the frame spans ~0.06° and the field is effectively
     shift-invariant, so the scene is sized to ~0.8° and the PSF resampled onto
     it. Rendered coarse-to-fine in its own worker.
5. **Telescope branch + bench editor + mech layer** ← optics landed, the
   **presets, the spider and the diagonal's vignetting have an app surface**
   (APP.md C1–C2), and the **mechanical layer is now ✅ closed** (§ 5u, below);
   still open: scenes (star/planet/lunar), the bench editor, and Part C's
   remaining modes — eyepieces, the eye, the camera, and long-exposure seeing
   (the one that needs an engine step). **`core/mech` has no app surface yet.**
   Presets (Newtonian, achromat/ED refractor, SCT), eyepiece library,
   obstruction/spider diffraction, atmospheric seeing dial, star/planet/lunar
   scenes, visual mode (eye model, exit-pupil matching) and camera mode
   (pixel scale, exposure, shot noise). Mechanical compatibility checking
   with feedback into optical spacings (extension tubes change the image).
   *Prerequisite — tilt/decenter:* ✅ closed. The **folded mirror frame**, a
   per-prescription convention (VALIDATION § 4a). It is what makes the
   Newtonian's 45° diagonal expressible, and what tolerancing rests on.
   *Prerequisite — folded pupils/OPD/PSF:* ✅ closed. The unfolded-z →
   world-frame map (`core/trace/axis`, § 4a), so a folded system images instead
   of throwing.
   *First preset — Newtonian:* ✅ `designs/newtonian` (§ 4b). Derived from
   aperture and focal ratio, not transcribed; off-axis pinned to third-order
   coma.
   *Spider diffraction:* ✅ (§ 5c). The vanes as a `PupilFunction` shared by
   both branches, so spikes fall out of the same transform as the Airy rings.
   **Its panel has landed too** (APP.md C2), and it turned § 5c's own aside into a
   live guard: a streak's first dark point sits at `padFactor/widthFraction` px
   with no aperture in it, so a *realistic* 1/50 vane throws it to 200 px and off a
   256-pixel grid — which is why § 5c's validation vanes are deliberately fat, and
   the panel says on screen that a red guard there means the spike **left the
   frame** rather than being suppressed. Also measured: a spider is amplitude-only,
   so the Strehl holds at 1.000000 at every vane width while the core energy falls
   0.847 → 0.531, and a zero-vane spider is refused rather than treated as none.
   *Atmospheric seeing:* ✅ (§ 5d). A seeded subharmonic Kolmogorov screen as a
   `PupilFunction` *phase*, pinned to Kolmogorov and Fried statistics. Being
   pure phase it lives only in the FFT branch; **the geometric ∇φ ray-tilt is
   the named deferral.**
   *Classical Cassegrain:* ✅ `designs/cassegrain` (§ 5e). Two powered mirrors;
   the confocal-conic property makes it exactly stigmatic on axis. The pinnable
   member of the family — the commercial SCT's optimised corrector has no
   external number, the tension `cassegrain.ts` records.
   *Ritchey-Chrétien:* ✅ `designs/ritchey` (§ 5f). Both mirrors hyperboloidal;
   the coma null pinned against the Cassegrain on identical geometry, sharing
   one `twoMirrorLayout` so the two cannot drift.
   *Schmidt camera:* ✅ `designs/schmidt` (§ 5g). The first `asphereCoeffs`
   preset — spherical mirror + corrector at its centre of curvature, pinned to
   the closed-form figure A₄ = −1/(4(n−1)R³). An anastigmat.
   *Schmidt-Cassegrain:* ✅ `designs/schmidt-cassegrain` (§ 5h). Composes § 5g's
   corrector onto § 5e's pair. A *Schmidt-corrected* Cassegrain, **not** the
   commercial all-spherical SCT; every number stays a closed form.
   *All-spherical commercial SCT:* ✅ `designs/sct` (§ 5i). Two spherical mirrors
   and one corrector nulling their *combined* SA, pinned to the published
   two-mirror Seidel corrector (Schroeder; Rutten & van Venrooij). NOT an
   anastigmat — its off-axis coma/astigmatism remain **unpinned**.
   *The panel the six presets existed for:* ✅ **landed** (APP.md C1) — app wiring
   only, no rung, and the first Part C surface. Six designs had been in
   `core/designs` since this step with no app presence at all. What it corrects is
   an app **readout** rather than a physics line: § 3b's chromatic-spread measure
   reads **0.36 Airy radii on a Newtonian**, which contains no glass and cannot
   disperse, because it divides every plane by ONE Airy radius while the Airy
   pattern scales as λ — untouched as the *difference* between two lenses that
   § 3b uses it as, wrong as an absolute. Normalizing per wavelength leaves a floor
   that is the **ruler** (`spectralStack`'s common grid crops red where it pads
   blue) and that wanders rather than converging with grid, so it is refused; the
   control is free and exact in its logic, since a Cassegrain and a
   Ritchey-Chrétien differ *only* in conic constants and a conic has no index —
   they agree to 1.3e-5, four orders under the corrector's own excess. Above the
   floor the corrector's dispersion tracks its own figure as **A₄²** (implied power
   2.07 → 1.92 → 1.45 as the plate steepens and the small-aberration form
   saturates), and A₄ ∝ F₁⁻³ makes that F₁⁻⁶ — which is why a slow f/10 Schmidt
   camera sits *at* the floor with a corrector in it. Two more: § 4b's diagonal
   sizing has **no aperture in it**, ε = (k/F)/(1 − 1/(16F²)) to 12 digits, so a
   Newtonian's obstruction is a mechanical convention over the focal ratio where
   the Cassegrain family's ε = s₁/f₁ is optical; and the obstruction is a pupil
   fact the trace never sees — Strehl 1 to six digits with a fifth of the pupil
   dark, the annulus's whole on-axis effect being that it moves **18.3%** of the
   core into the rings.
   *Off-axis diagonal vignetting:* ✅ (§ 2f). The partial-vignetting case § 2e
   left open, arriving as one `PupilFunction` mask whose criterion is the trace
   itself, so both branches see one aperture.
   **Its panel has landed** (APP.md C2), and it needed **no control at all** —
   `psf()` builds the mask only when `map.lost > 0`, so the criterion being the
   trace means a field angle is the whole input. What it found is a **wall**, the
   sixth of its kind in the repo after § 6b's f/4.1, § 6d's NA 0.343, § 6e.4's NA
   1.411, § 6q's 0.88·f_e and § 6l's 1.3347 (§ 6b.5 sorts that list into three
   kinds — geometric, aberration, solver locus — and this one is geometric):
   past a certain field the chief ray
   misses the diagonal, and since it defines both the image point and the reference
   sphere, `opdMap` **refuses** rather than degrading. Derived from § 4b's own
   footprint sizing as tan θ = (√2·k/2)/[(F − ½ − 1/(16F))·(F − k)] — D cancels
   again — and the engine's bisection lands on it to **5e-13** at every focal ratio.
   It closes as **1/F²** (2.681° at f/4 against 0.147° at f/15, local power
   2.34 → 2.11 from above), which runs *opposite* to this step's own coma ∝ θ/F²:
   a fast Newtonian is comatic sooner per degree while its minimum diagonal passes
   several times more field, so "how fast should a Newtonian be" has no answer that
   is only about aberration. Throughput falls 1 → 0.384 out to 1.561° at f/5, and
   § 2f's two independent routes are measured live — agreeing to ~1e-4 under light
   clipping and parting to 1.1e-2 at the wall, because a ray-lattice count of a
   clipped region converges more raggedly as the clipped boundary lengthens.
   *Achromatic doublet — the refractor preset:* ✅ `designs/achromat` (§ 5j). The
   first preset that is a LENS and the first that had to be *solved*. Choosing
   the bending needed third-order theory, so `analysis/seidel` landed with it,
   pinned BEFORE use. **Open:** the two SA-null bendings straddle the coma-free
   one, so neither is aplanatic — fixing that is a glass-pair or broken-contact
   question, not a bending one.
   *ED (fluorite) refractor:* ✅ (§ 5k). The same `achromaticObjective` driven
   with CaF₂; the gain comes from anomalous partial dispersion, not the famous
   Vd = 95. **Open:** real premium fluorite doublets are air-spaced — the third
   freedom that could null S_I and S_II together.
   *Eyepiece library — composition, afocal evaluation, and the computed lead:*
   ✅ (§§ 5l–5n). **Module composition** (`trace/compose`) flattens whole parts
   into one prescription, as ARCHITECTURE committed — flattening, not a second
   tracer. On it, the **afocal system** the engine could not previously express,
   plus real-ray apparent field of view and distortion (§ 5n). Members so far are
   **computed**, not transcribed: the **Plössl** (§ 5m) and the **Huygens**
   (§ 5o).
   *Eye model + visual mode:* ✅ (§§ 5p–5q). Its prerequisite was a genuine engine
   capability: **limiting-aperture stop selection** (`pupil/aperture-stop`, § 5p),
   since a narrow iris *becomes* the stop. On it, the **reduced eye**
   (`designs/eye`) and the two-stop collapse. **Open:** the
   empty-magnification/acuity ceiling, real ocular aberrations, and the
   photopic/scotopic pupil.
   *Camera mode — pixel scale + sensor sampling:* ✅ (§ 5r). A `Sensor` at the
   focal plane (`imaging/camera`); `resampleToSensor` rebins by area, so the
   detector-footprint MTF and aliasing are carried, not assumed. `plateScale` and
   `fieldOfView` invert the *traced* chief-ray map, so they carry distortion.
   *Camera mode — relative exposure:* ✅ (§ 5s). `imaging/exposure`, pinned as
   ratios because the absolute photon zero point is § 3a's deferral. **Shot noise
   stays deferred** — it is a draw from an absolute photon count, which needs
   that zero point.
   *Still to come here — the transcribed patent members.* Commercial eyepiece and
   objective prescriptions are trade secrets, but **patents are public and contain
   full prescription tables** — the supply route for the wide-field members
   (Erfle/Nagler-class), pinned to their catalogued EFL + AFOV. This is blocked on
   real external data, not code: a verified published prescription AND the crown/
   flint glasses it uses added to the catalog with real dispersion data (the
   current catalog has only N-BK7, F2, CaF₂, fused silica). Transcribing from
   memory is forbidden by the hard rule; the members land when the data is sourced.
   *Tolerancing:* ✅ `analysis/tolerance` (§ 5t). A readout composed of `opdMap`
   and `bestFocus`, no new physics; the whole difficulty was the *currency* — the
   σ of the *delta* wavefront with compensator modes projected out, so
   independent tolerances' variances stay additive and the RSS budget is exact.
   *The UI this exists for:* ✅ **landed** (APP.md Part B) — a slider per
   tolerance, the image degrading as the budget predicts, and the budget turning
   out **not to be a bound**. App wiring only; no rung was added because no
   capability was. What it corrects is the sentence above it: the interesting
   divergence between `rssWaves` and `combinedWaves` was expected upward, when
   modes correlate, and § 5t's own two-identical-perturbations control does read
   √2 to four digits. The larger departure is **downward** — a conic error on one
   surface and a curvature error on another, each spending half the Maréchal
   budget, together spend almost none: on the achromat at f = 100 / EPD 20 the
   RSS is **189× pessimistic**, and how far they cancel is a property of the lens
   (214× at f = 50 / EPD 14, 8× at f = 100 / EPD 10), so the panel measures it
   rather than promising it. Two things
   that only a panel could ask: the cancellation belongs to the *linear
   projection* and a real focuser recovers 69× less of it, and **a σ has no sign
   where an image does** — the same |σ| costs a Strehl ratio of 0.675 or 0.979
   depending on which way the slider went, because this nominal is a real doublet
   with a spherical residual of its own and § 5t's rungs deliberately sit on a
   perfect one. Also measured, and it is a wall of a kind the microscope branch
   never met: `refractorPair`'s fixed 3 mm centre thickness runs the crown's two
   sags together at h = √(t·R), so the whole-pupil aperture goes as **√f** — EPD
   16.1 / 23.0 / 32.6 at f = 50 / 100 / 200 — and is not a focal ratio at all.
   *The mechanical layer:* ✅ `core/mech` (§ 5u) — this step's last unbuilt item,
   and ARCHITECTURE's oldest unbuilt line. Most of it is a parts list, so its
   content is the one claim a parts list gets wrong: **a part's mechanical length
   and its optical cost are different numbers.** The layer therefore never models
   an optical effect — `withGlassPath` splices plane surfaces into the
   prescription and the *tracer* finds the focus, which is what makes the closed
   form a pin rather than a substitute, and what makes the spliced chain carry
   spherical aberration and colour that nobody put in by hand. Four findings.
   A prism diagonal hands back **0.3407** of its glass (13.6287 mm of 40), a
   mirror one a hard zero, and the naive air-only budget is wrong by **7.83% of a
   real chain's length** — always pessimistically, and the two verdicts genuinely
   disagree on an ordinary focuser. The glass's **position along the converging
   beam is exactly irrelevant** — a cone is straight lines, so a perpendicular
   plane meets every ray at the same angle wherever it sits — pinned at a 50 mm
   and a 600 mm gap to 1e-11 mm of focus and 1e-6 waves of OPD, which is what
   licenses flattening a chain's glass into one stack. The shift is
   **dispersive**, pushing blue further back where a positive element does the
   reverse, so a glass diagonal *compensates* both doublets measured — though an
   achromat's F−C spread is a residual whose sign belongs to the lens, so that
   half is measured on two glass pairs and not asserted as a law. What is
   identical across them is the amount: **0.139742 mm** to six digits, because
   the plate does not know what it is bolted to — four Rayleigh depths of focus
   at f/5, inside one at f/10, invisible to any budget made of lengths. And the
   quarter wave lands at **f/5.315** where this
   step was scoped for f/3–f/4, which is the difference between "diagonals are
   fine" and "diagonals are marginal on a common f/5". **The headline is a
   ceiling that comes from a mount.** A single group at magnification M stands
   off its object by x′(M+1)/M², so a DIN objective is impossible below
   M = [x′+√(x′²+4Px′)]/2P = **4.1387** — 4.236 with the built doublet's real
   glass — and a real 4× therefore cannot be one doublet. Sixth geometric ceiling
   in the repo, and the first that is not the ray invariant. **Open:** barrel
   vignetting (the `semiApertureMm` hook exists, the rung does not), the sensor's
   own cover glass, tilted elements, and the tube-length error with its known
   coverslip equivalence.
6. **Microscope branch** ← current; **every numbered step in it is now closed**
   (§ 6l was the last gap). What remains here is app wiring and scenes.
   Infinity-corrected + classic 160 mm architectures; 4x–100x objectives incl.
   oil immersion ✅ (§ 6e); brightfield ✅ (§ 6f) and fluorescence ✅ (§ 6i),
   the latter now over a 3-D specimen ✅ (§ 6k); coverslip mismatch ✅ (§ 6c);
   scenes: fluorescent beads ✅ (§ 6i.5), and **diatoms and stained tissue are
   authored too** — in the app, since § 6n unblocked them (`app/src/specimens.ts`,
   drawn by A7's stage and, since APP.md's A9, **in colour**). No rung pins one:
   a specimen is a picture, and the physics it is fed through is § 6f's and
   § 6r's.
   "Mostly configuration + domain models on the existing engine" held for the
   optics and did **not** hold for brightfield — see § 6f.
   *Prerequisite — dispersive immersion/coverslip glass:* ✅ sourced and
   pinned (§ 1) — Daimon-Masumura water, Cargille Type B oil, Schott D263 T eco
   coverslip, so at NA 1.4 the branch rides on measured data. The D263 half is
   now consumed by § 6c. *This line used to promise "remaining is the wiring —
   the image-space index in `pixelScaleMm`, pinned when an immersion objective
   lands here". That objective landed (§ 6e.4) and the promise was misaimed:*
   the wiring exists (`psf.ts` divides by `nImage`, read from the exit pupil's
   own index) and an oil-immersion microscope never exercises it, because the
   **oil is in object space** — where it enters through NA, which is carried —
   while the tube lens forms the image in air. A non-unit image-space index
   stays unpinned only because no system in the ladder has one.
   *Prerequisite:* **module composition** ✅ — landed as § 5l with the eyepiece
   library; this step consumes it unchanged. Design in ARCHITECTURE § Data model.
   *Architecture + the first objective:* ✅ `designs/microscope` (§ 6a). The chain
   the whole branch varies on — specimen at the objective's front focus,
   collimated space, tube lens, image — plus the one first-order capability the
   engine lacked, `collimatingObjectDistance`. **Three named blockers for
   immersion**, recorded rather than papered over: `objectNA`'s aperture seed is a
   tangent and is 2.6× out at NA 1.4; telecentricity needs object-space ray aiming
   that does not exist; and F = 1/(2·NA) means high NA is a different glass form
   (Lister, then the aplanatic hyperhemisphere), not a faster doublet.
   *Classic 160 mm (DIN/JIS) architecture:* ✅ `finiteConjugateObjective` /
   `finiteConjugateMicroscope` (§ 6b). The second of the two architectures this
   step names. A DIN objective is not an infinity objective used differently, it
   is a **re-solved lens** — which needed the position factor, a finite object
   conjugate, that § 5j's `analysis/seidel` had explicitly refused (§ 6b.0).
   *The 4× at f/4.1 — the edge of the cemented-doublet form:* ✅ **closed at
   § 6b.5**, and the open item it closes had two answers because D8's flagged
   sentence turned out to be about two different boundaries. **The optical edge is
   Maréchal's, it is EXTERNAL, and § 6b's original sentence survives:** the DIN 4×
   is diffraction-limited to **NA 0.10311 = f/3.956**, so the catalogued 4×/0.10
   has **3.1%** of aperture in hand and really is at the edge. **D8's f/2.3 is not
   an optical boundary at all** — the wavefront there is **3.45 waves, 48×
   Maréchal** — so "the form survives to NA 0.1843" holds only in the sense that
   the constructor returns an object, and "f/4.1 is a landmark rather than the
   edge" is **withdrawn**. What D8 measured is `achromaticObjective`'s refusal
   locus, which **contains no aperture by construction** (aperture-free to ≤ 3 ULP
   over four decades of D) — which is exactly why the ratio at it looked invariant
   at 8%. On the external criterion **neither** measure is invariant: over M = 4→40
   the reach spans **77%** in NA and **40%** in working ratio, monotone in opposite
   directions, so **there is no single focal ratio that is this form's ceiling**;
   the ratio is the tighter of the two by ~2× and that is all it is.
   Two solver conventions compose to make "f/2.3". The boundary ratio is set by the
   **±3·span scan window** — what arrives there is a root **5× hemispherical**
   entering at |c₁|/span = 3⁻ while both real roots are still ordinary glass — and
   the NA it maps onto is set by the fixed point's **thin-lens seed**, in a closed
   form that predicts the engine's own wall to **1e-11** at four magnifications,
   both orientations and two glass pairs (f cancels, which is why the tube length
   moves it **bitwise** not at all). That exactness is the finding: the *converged*
   design sits ~6% inside the boundary, so the constructor **refuses apertures it
   could deliver**. Also unified: **§ 6q's Plössl wall is this same refusal**, and
   its measured scale-invariance is this same identity — so the repo's walls are
   three kinds, not one (geometric, aberration, solver locus), with § 6d's NA 0.343
   deliberately left unclassified.
   **Open here:** the seed (worth ~6% of ratio, measured), the scan window's
   `3`, and a refusal message whose sentence names the glass pair when the cause is
   the aperture — the count already discriminates (0 vs 3), and all three are
   upstream of §§ 5j/6b/6c/6d/6e, so they are their own step. *Composing an eyepiece onto the
   intermediate image was the other open item and is now closed by § 6q, which
   runs on this architecture and the infinity-corrected one alike.*
   *The coverslip — `160/0.17`:* ✅ `designs/coverslip` (§ 6c), and with it the
   first of this step's named deliverables, **coverslip mismatch**. The plate is
   the strongest external pin in the ladder: its aberration is solvable **to all
   orders** from Snell, so the exact tracer is checked against an exact answer at
   NA 0.95 rather than against a small-angle form. The objective is genuinely
   re-solved through it — `achromaticObjective` gained `targetS1Mm`, so ΣS_I is
   solved to *minus the plate's* and the lens alone is deliberately aberrated —
   and the target is summed over the plate's real surfaces so the closed form
   stays a test, not a construction. **The headline is a null:** at NA 0.10 the
   correction the slip demands is 400× under the objective's own residual, so a
   4×/0.10 is coverslip-*insensitive*; the tolerance runs as 1/NA⁴, from 31 mm at
   NA 0.10 to 3.9 µm at NA 0.95. **Open:** index mismatch, the correction collar,
   the off-axis plate terms, and the infinity-corrected member's slip.
   *The Lister — the first aplanat:* ✅ `designs/lister` (§ 6d). Two cemented
   doublets whose bendings are solved **together** for ΣS_I = ΣS_II = 0, which no
   single doublet can be (§ 5j: its two SA-null bendings straddle the coma-free
   one). Well-posed because at ΣS_I = 0 the coma sum is invariant under stop
   position, so § 6a's front-vertex stop cannot contaminate it. The pin is a
   **law, not a ratio**: solve on third-order Seidel, then watch the traced
   wavefront's residual coma change ORDER, from NA³ to NA^5.2. Diffraction-limited
   reach goes 0.180 → 0.273 (Maréchal, bisected), and the split/separation are
   *stated* parameters — the solve holds across k ∈ [0.3, 0.8], so the aplanat is
   a property of the form rather than of a lucky pick.
   **The ceiling, measured, and it revises the prediction above:** two cemented
   doublets wall out at NA 0.343 (N-BK7/F2) and 0.383 (fused silica/F2) — the same
   for both pairs, so it is the FORM, not the glass. The Lister does *not* carry NA
   past 0.4, and § 6c's slip wiring therefore waits on the aplanatic front element
   instead. That element is the next unit, and § 6d.1 already pins the closed form
   it rests on: the Weierstrass points of a single sphere, exactly stigmatic to all
   orders, u = R(n₁+n₂)/n₁, v = R(n₁+n₂)/n₂, m = n₁²/n₂².
   **Open here:** the hyperhemisphere itself, the coverslip through a two-group
   target, astigmatism/field curvature (S_III–S_V remain uncomputed — an aplanat is
   not an anastigmat), and the finite-conjugate DIN Lister.
   *Oil immersion — the plane stack:* ✅ (§ 6e.1). Before the aplanatic glass, the
   thing it looks *through*: cover glass, fluid film and the front element's flat
   underside, as the exact N-layer generalisation of § 6c's single plate — still
   solvable to all orders from Snell, and reducing to § 6c term for term. It
   carries the identity immersion rests on: **a matched stack aberrates a hard
   zero**, at every aperture, which is why oil is formulated to the index of the
   slip and the front element. The finding is that the real triad does *not*
   match well enough to ignore — at NA 1.25 an N-BK7 front spends 91% of the
   whole Maréchal budget on the stack alone, and 2.9× the budget at NA 1.4;
   matching the front element to the cover glass instead is worth 6.5× and no
   more, because it moves the element off the oil. **Open:** the aplanatic front
   element itself, off-axis plate terms, correcting the objective *for* its stack
   (§ 6c's `targetS1Mm` route, which the Lister has no target parameter for), and
   the chromatic half of the mismatch.
   *The aplanatic front — the hyperhemisphere and its menisci:* ✅
   `designs/immersion` (§§ 6e.2–6e.3). The first design to CONSUME § 6d.1's closed
   form instead of admiring it. A dome at its Weierstrass conjugates divides the
   aperture by n² and magnifies by n²; an aplanatic meniscus — concentric first
   surface that bends nothing, Weierstrass second — divides the angle by n. Every
   element is exact to all orders, so the traced axial crossing does not move
   across the whole aperture (spread < 1e-11 mm) and the sine ratio is flat: a
   control pair against the real slip+oil bench separates the two by 10⁹ on
   identical geometry, and the difference is § 6e.1's mismatch and nothing else.
   **The budget is the previous step's measurement:** NA 1.25 → 0.232 and NA 1.40
   → 0.260 through a dome and two menisci, both under § 6d's measured 0.343 —
   and one meniscus is *not* enough at either, so the count is set by that number
   rather than by taste. **§ 6a's first immersion blocker is closed**, and its
   diagnosis was half wrong: a tangent is exact at a plane face, and what was
   2.6× out at NA 1.4 was using the sine-condition height as a stop radius.
   **Open:** off-axis everywhere, the chromatic half (a dome is aplanatic at ONE
   wavelength), and water immersion.
   *The oil-immersion objective:* ✅ `oilImmersionObjective` (§ 6e.4), and with it
   the branch's headline deliverable: **a 100×/1.25 and a 100×/1.40 that are
   diffraction-limited**, σ ≤ 0.35·λ/14 from NA 1.0 to 1.40, traced NA equal to the
   label to 7 digits and 100× that really is 100×. It composes **without a
   re-solve** — the front group's virtual image lands on the Lister's own front
   focus, so the rear group sees the conjugates it was solved for — and the dome
   radius is solved rather than picked, since every length in the front group is
   proportional to R. **The ceiling is geometric, not aberration:** NA 1.411,
   where the slip's apparent-depth floor on the dome meets the placement's
   ceiling, and the wavefront there is still λ/50. That is § 6d.4's finding
   repeating in a new mechanism — twice now the form has stopped *existing* well
   before it stopped being diffraction-limited. **And the cover slip HELPS:** its
   spherical aberration is opposite in sign to the Lister's residual, so the
   objective with its slip is 1.7× better corrected than the same one in a matched
   bath — § 6c's "worse than not correcting at all", arriving where it bites.
   *The slip tolerance:* ✅ (§ 6e.5) — because the rung above makes the correction
   depend on a plate the objective does not control. It splits three ways. A
   **thickness** error costs *exactly* zero aberration (slip and front element are
   both D263, so the layer's (n²−n_out²) factor is identically zero) — it is a pure
   axial displacement, and refocusing removes it: σ holds across 0.15–0.18 mm and
   is nearly flat at NA 1.0. That claim is conditional on refocusing the way the
   instrument does, by **moving the objective and changing the oil film**; with the
   film pinned instead, σ crosses Maréchal within ±1.6 µm at NA 1.40. **A thickness
   error does change the delivered NA**, though: the rims are fixed glass, so a
   thinner slip puts the specimen closer to them and the same rim subtends a wider
   cone — 1.4126 at 0.160 mm on an objective labelled 1.40. That is what ends the
   thin side, and it is *predicted*: the delivered NA reaches § 6e.4's own 1.411
   ceiling at a slip of 0.1613 mm, and the tracer starts losing rays across exactly
   there — a third mechanism arriving at the same wall, this time from below. The
   binding tolerance is **index**, which no refocus touches: ±0.003 is 1.9× the
   budget at NA 1.40. Also measured and deliberately left alone: the paraxial
   Weierstrass placement sits ~0.8 µm off its own σ optimum, worth 9–16×.
   **Open:** correcting for the stack deliberately rather than by luck of sign
   (§ 6e.5 hands that step a measured target), the correction collar — whose job
   turns out to be index and NA drift, not thickness — a realistic oil film
   (20 µm here against a real ~130 µm), water immersion, off-axis, and the
   chromatic half.
   *Brightfield — the condenser and partial coherence:* ✅ `core/illumination`
   (§ 6f), and the step's second named deliverable. The first imaging in the
   engine of an object that does **not** emit: a brightfield specimen modulates a
   beam, so whether two of its points interfere depends on where their light came
   from, and the image is **nonlinear in the object's intensity**. This step
   therefore *overshoots* what the ROADMAP promised — the line above says
   "incoherent + condenser-NA factor", and a factor multiplying the incoherent
   MTF would have been a fiction, forbidden by the no-faked-physics rule. What
   landed instead is **Abbe source-point summation**: the condenser is a set of
   illumination directions, each images coherently, and their intensities add.
   An illumination direction turns out to be a **translated `PupilFunction`**, so
   it arrives the same way the spider and the seeing screen did and the transform
   never learns its name. Hopkins' TCC stays a v2 item and is not needed for any
   of this. **Both ends of the curve are exact, and the middle is a law:** S → 0
   gives a flat plateau and a cliff at NA/λ; S ≥ 1 reproduces § 2b's own
   `diffractionLimitedMtf` (no second number minted) and opening further changes
   nothing; in between, the cutoff is **bisected off the sum** and comes back at
   1 + S·(1 − 1/N) to 9 places — the textbook λ/(NA_obj + NA_cond), measured,
   with its lattice discretization written down rather than absorbed. Two paths
   compute the sum — an FFT imager for arbitrary objects and a three-order closed
   evaluation for gratings — and they are pinned against each other to 1e-12
   rather than one being trusted. **The headline null is why stains exist:** a
   weak phase object's sidebands cancel identically, so brightfield transfers
   *no* phase at any S or frequency, and a quarter wave of defocus makes it
   appear. Darkfield falls out with no special case (an annulus outside the pupil
   images a clear field as `toBe(0)`), and the readouts run unchanged on the
   *traced* pupils of § 6a's 4×/0.10 and § 6d's Lister, where the cutoff does not
   move and contrast falls in wavefront order. **Open:** the scenes themselves
   (diatoms, stained tissue, beads) and the bridge into `imaging/render` —
   `abbeImage` is one isoplanatic patch; fluorescence, called the *easy* half here
   because a fluorescent specimen is self-luminous — which it was, and § 6i also
   turned it into this step's own proof; polychromatic brightfield; a non-uniform
   source. The named deferral that the geometric PSF branch has no
   notion of coherence at all, exactly as § 5d's seeing does not, **now detects
   itself** (§ 6f.9): brightfield cannot cross-fade the way the PSF does — a ray
   histogram has no phase to interfere with — so it *rules* instead of blending,
   and where `adaptivePsf` ramps, `brightfieldFidelity` is a cliff. Absent
   sampling reads `unknown`, never `valid`. Beside it the sum's own lattice
   reports whether the grid carried the pupil, on a defocus closed form exact to
   1e-12, and a pinhole's ¼-encircled-energy disc pins what the half-wave
   criterion physically *is*: the point where the spread reaches the grid edge.
   The capability stays deferred — its nearest analog is refraction through the
   specimen's ∇φ, which is transport-of-intensity rather than coherence — and
   the verdict has no caller until the `imaging/render` bridge lands.
   *The coherence width, and what the field decomposition may window:* ✅
   `illumination/coherence` (§ 6g.1–6g.2). Not the bridge — the thing that had
   to be settled before building it, because `abbeImage` images ONE isoplanatic
   patch and `imaging/render`'s partition of unity does **not** compose with it
   the way it looks like it does. The finding is exact: splitting an object
   amplitude between patches returns the self terms whole and multiplies the
   interference between two object points by **C = Σ_p √(w_p(x₁)·w_p(x₂))**,
   Cauchy–Schwarz, which is 1 only in a shared mixture and **0 across a seam** —
   deleted, not attenuated. Pinned pointwise to 1e-12 of the cross term's peak,
   and 89% of the interference is gone at 16 patches on the rung's own geometry.
   So the error factorizes, (1 − C)·|cross term| with cross term ∝ μ, one purely
   geometric factor and one purely physical: **C carries no S at all.** The
   bridge must therefore window the OUTPUT, the opposite side from
   `imaging/render`, and that is two operators disagreeing rather than one being
   wrong. **Energy is not a witness** — the object-side split is exact by
   construction, so the check this repo reaches for first passes for the scheme
   that deletes the interference. The physical half arrives as van
   Cittert–Zernike, computed from the condenser's own sampling and pinned three
   ways: against 2J₁(v)/v, against `abbeImage`'s own cross term to 9 places, and
   against the textbook **0.61·λ/NA_condenser** to 2e-4 — where the engine
   carries no 0.61, only j₁,₁, the same constant as Rayleigh's criterion. Needed
   its own primitive, `math/bessel`, a defining series pinned against Bessel's
   integral rather than a transcribed coefficient table. **Open:** the bridge
   itself, what output windowing costs where the pupil DOES vary, off-axis
   coherence, and the polychromatic half.
   *The bridge:* ✅ `imaging/brightfield` (§ 6g.3). `renderBrightfield` — each
   patch forms a whole `abbeImage` through its own pupil and the finished
   intensities blend, which is the same partition of unity as `imaging/render`
   applied to the other side. **The edge patches are exact**, because
   `patchWeight` runs flat to the frame edge, so the outer half-patch's local
   contrast IS § 6f's three-order closed form for that patch's pupil — matched
   to 9 places at both ends of a frame whose defocus runs 0.1 → 0.9 waves, and
   a single patch lands strictly between them. The interior is a **sequence**,
   not a closed form: the worst-pixel change per patch doubling falls
   16.4% → 6.4% → 2.4% → 0.97% of peak at a stable ratio just under 0.4, and the
   rung asserts the ratio because a wandering image satisfies “each step is
   smaller” too. Output windowing is **forced, not free** — it pays exactly the
   cost `render.ts` objects to — and that is recorded rather than dressed up.
   **§ 6f.9's verdict finally has a caller:** the worst patch rules, since a
   frame is not honest in the places where it happens to be. **Open:** the limit
   the interior converges to (Hopkins' TCC would give one, and is v2).
   *Object-space field mapping for a finite conjugate:* ✅ `imaging/object-field`
   (§ 6h). The wiring to a traced system, and the seam § 6g.3 named: the frame
   position → image mm → **object height** → traced pupil, inverted numerically
   off the chief ray so it carries distortion — pinned as an ORDER, ×8.00 per
   doubling, third-order theory's cubic. Two findings revise what was predicted.
   **The frame's extent is set by `pupilSamples` and not by the grid** — the size
   cancels, so a brightfield frame spans `pupilSamples` resolution cells and no
   more, which is step 4's framing lesson biting harder because the Abbe sum's
   grid IS its frequency lattice and cannot be resampled. And **the frame is NOT
   isoplanatic** at that scale after all: 47 µm of specimen on a 4×/0.10 already
   carries 8.8e-3 waves of corner coma, the image moves 0.9% on the first patch
   refinement, and the convergence ratio is ½ where § 6g.3's labelled fixture
   gave just under 0.4 — the fixture was representative in shape, not in rate.
   The pupil rotation is **exact** here where `renderField`'s is bilinear (a
   `PupilFunction` is a callback, so the coordinates turn before it is ever
   sampled), and the two are pinned against each other at 90°/180° with both
   tolerances derived from the strip `rotateKernel` drops. **§ 6f.9's verdict
   finally runs on a trace** and rules `valid` instead of `unknown`. The textbook
   pupilSamples·λ/(4·NA) is 2.7% out, and the 2.7% is shown to BE the DIN 4×'s
   own departure from the sine condition — § 5j's "a doublet cannot be aplanatic"
   arriving as a measured number. **Open:** warping the grid itself (distortion
   is carried in the pupil assignment only), telecentricity — § 6a's object-space
   ray-aiming blocker, inherited — pupil aberration, and a field wide enough to
   need many patches.
   *Fluorescence — the specimen that emits:* ✅ `imaging/fluorescence` (§ 6i), the
   step's last named deliverable. A fluorophore has no phase memory of the field
   that excited it and none of its neighbours, so the emitters are incoherent **by
   nature**, the image is a plain convolution, and there is no condenser in the
   expression at all. The step's content is that this is *proved against the
   engine's own partial-coherence machinery* rather than asserted: when the
   condenser's lattice steps by the pupil's own frequency step and reaches past
   1 + B, the Abbe sum's order-pair bracket becomes a discrete autocorrelation and
   the sum **collapses to a convolution** — matched to f64 noise, and **at m = 1
   as well as m → 0**, so § 6f.4's 11.2% nonlinearity does not shrink here, it is
   identically absent. Two smaller findings came out of the same lattice. The
   transfer is a **point count**, exactly — which turns the departure from § 2b's
   closed form into the Gauss circle problem (1.4e-4, 7.9e-4, 8.5e-5 as the
   lattice refines: up, then down, so no rate is claimed) and explains the 1/797
   the engine reads at ν = 2, where the tangency of the two discs happens to be a
   lattice point. And fluorescence reaches `wave/mtf`'s ν = 2 cutoff **with no
   condenser in the instrument**, where § 6f.1 needed a matched one and a closed
   diaphragm stopped at ν = 1. The partition of unity goes back on the **input**
   and is exact there (1e-12, any patch count) where § 6g.2's output-side one was
   forced and cost 89% of the interference — two operators, opposite sides, and
   the reason is the specimen rather than the optics. **Beads are the first
   specimen for an engine reason:** a point emitter is placed through its own
   traced chief ray, so distortion is carried and § 6h's unbuilt warped-grid
   rasterizer is not needed — which is exactly what a stained-tissue field would
   need. **No verdict is minted** (§ 6f.9's asymmetry, stated: incoherent imaging
   *has* a geometric branch) and no fluorophore is named — real dye spectra are
   measured data. **Open:** colour, and the remaining scenes. Out-of-focus haze
   from a 3-D specimen — the thing that makes deconvolution and confocal mean
   something — was this step's largest named gap and is § 6k.
   *The Stokes shift, and the band the image is formed in:* ✅ `imaging/emission`
   (§ 6j). § 6i never sees an excitation wavelength, and that is the architecture
   rather than a gap: the emission filter blocks it, so "resolution is set by λ_em"
   is the shape of the API. What is measurable is what the shift *costs*, and the
   answer is a ratio against a **derived** depth of focus — § 1.5's own defocus
   wavefront W = ½·δ·NA²·ρ² taken to a quarter wave, then checked by defocusing a
   traced system by half that range and reading the quarter wave back off its
   wavefront. A 20 nm shift costs **0.32 depths of focus on the DIN 4×/0.10 and
   3.77 on the 100×/1.40 oil** — free at low NA, a refocus between channels at high
   NA, which is why real multi-channel images need registration in z. Part of the
   12× is NA and part is § 6e's deliberately deferred "chromatic half" arriving
   where it bites; it is NOT a claim about a real apochromat. The ratio is
   invariant between object and image space (pinned: the two depths differ by the
   longitudinal magnification M²·n′/n), which is what makes it legitimate to
   measure where `bestFocus` lives. The band itself stacks over **kernels rather
   than images** — one spectrum multiplies the whole emitter field, so it factors
   and costs one convolution — on § 2e's common physical grid, since
   `pixelScaleMm` is ∝ λ. **The surprise:** a band is not automatically a blur.
   With no aberration the blue components are narrower and genuinely concentrate,
   so neither the peak nor the core energy moves monotonically with band width;
   what is pinned instead is the isolation (hold the scale fixed and width does
   nothing, exactly), and the blur is measured where an objective supplies it.
   **Open:** the excitation/illumination path itself (epi, dichroic, Köhler
   uniformity), the two-colour merge, and which way an aberration-free band moves
   the core.
   *Out-of-focus haze, and the missing cone:* ✅ `imaging/volume` (§ 6k). § 6i's
   largest named gap, and the largest single difference between what it forms and
   what a microscope shows. The step is one fact stated twice. A defocus is a
   **pure phase**, so no pupil amplitude moves, so Σ|P|² does not — and Parseval
   carries that through the engine's own FFT to the formed kernel, whose total is
   invariant to 1e-12 over 0 → 8 waves. **Every plane of a thick specimen
   delivers its whole flux to the image however far out of focus it is**, so a
   slab three times thicker is exactly three times hazier (1/3, 1/9, 1/27 to
   1e-12) and **refocusing cannot help** — haze is a property of how much
   specimen there is, not of the microscope. Transform that constant along the
   depth axis and it is the **missing cone**: zero axial transfer at zero lateral
   frequency, read at 2.2e-15, which is why deconvolution is ill-posed
   structurally rather than numerically. The rung was nearly worthless in § 6j.2's
   exact way — § 6i's kernels are normalized to sum 1, so a null on *their* totals
   would hold whatever the pupils did — so `formedSum` was added, the stack weighs
   with it, and a depth-varying pupil **amplitude** fills the cone back in on
   demand. What defocus does instead is redistribute, on a closed form: the axis
   follows **sinc²(π·w₂₀)**, which is 8/π² = 0.8106 at the quarter wave (the
   Rayleigh criterion and § 2b's Maréchal Strehl seen axially, and § 6j's depth of
   focus is defined so half of it lands there) and **exactly zero at every integer
   wave** — all the light in the rings, total unmoved. Away from the axis the
   support boundary **μ = ν(2 − ν)** is derived from the quadratic wavefront and
   then measured *exactly* at ν = 0.5, 1 and 1.5, with the defocused OTF pinned
   against an independent quadrature. **The structural finding is the one § 6j
   sets up:** its band stacks over kernels rather than images because one spectrum
   multiplies the whole emitter field, and **over z that fails** — each plane has
   its own field, so a volume costs one convolution per slice. The exception is a
   specimen uniform in z, which factors again and IS the haze kernel; and the
   shortcut that sums the planes first carries every photon and forms a different
   image, so **energy is not a witness** here either. **Open:** ~~depth-dependent
   spherical aberration~~ — **closed at § 6l**, exactly as scoped and with two of
   this step's results surviving it (flux invariance, the empty cone) and one not
   (the axial symmetry) — deconvolution and confocal, both named by
   the cone rather than built — an axial sampling verdict, and how far the
   quadratic wavefront sits from the exact Ewald cap (sin α against tan α: 2.6×
   at NA 1.40, but living entirely in the object-side z mapping, since the engine
   defocuses an image space where NA′ is 0.024).
   *Scoped, and now walked:* everything above formed an image
   **93.5 µm wide at 4× and 2.6 µm at 100×/1.40**, on the axis, in grey, with no
   eyepiece — a detail crop, and § 6h's own closed form says raising the grid
   will never widen it. Closing that was § 6m–§ 6r, ordered and costed in
   APP.md's Part D, and **all six have landed**. The **off-axis frame** (§ 6m) is ✅ **done** — a tile sits
   anywhere in the field, registers with its neighbours in the last bit, and
   carries the first millimetre-scale field measurements in the branch: field
   curvature at ×4.000 per doubling, and the finding that an off-axis tile is
   *anisotropic* in the ratio 3, which is the **warped-grid rasterizer**'s
   (§ 6n, § 6h's named deferral) argument turned into a number. That rasterizer
   is ✅ **done** (§ 6n): a `Specimen` is a callback in object millimetres,
   evaluated at the point each pixel really looks at, so the warp happens in the
   *argument* and nothing is resampled — `rotatePupil`'s reason, one layer out.
   Its pixel convention is pinned **bitwise** against § 6i's bead rasterizer, and
   its headline is that a straight object line **bows**: at ×2.00 per doubling of
   field, which corrects Part D's own prediction of the cubic's ×8.00. The
   sagitta is the map's *curvature*, so § 6h.1's cubic, § 6m.4's slope and this
   complete one ladder of derivatives off a single coefficient. The negative
   control — a uniform per-tile scale — **cannot bow at all**, and its miss
   carries the slope rather than the curvature, so the gap the seam would have
   shown doubles with field: 16.8× at 0.4 mm to 257× at 6.4 mm. **It unblocks
   stained tissue and diatom fields**, which were blocked on precisely this.
   The **mosaic and its guard band** is ✅ **done** (§ 6o): `renderMosaic`
   composes tiles into one image, each cropped to its useful span, and the guard
   that crop needs is pinned to a **closed form** — under a coherent source the
   error falls as `guard^(−1/2)`, the tail integral ∫|h|² of the Airy amplitude,
   straddled by consecutive measured slopes at 13% and 6.6% either side. Its feasibility probe had
   read the guard as S-independent and small; **that is corrected**. The guard
   does grow as the diaphragm closes — the coherent limit is worse than a filled
   condenser by a factor that *doubles with the guard* (22.9, 42.0, 84.8) — and
   the ~4e-3 floor the probe took for the impulse response's algebraic tail is
   the **condenser's own quadrature**: the same guard, specimen and lattice at
   749 source points instead of 97 falls 7.1×, and the flat tail flattens only
   at the coarse sampling. The control is that a coherent source has one point
   and so cannot move under refinement. Its seam, on a traced 4×/0.10, falls 23×
   from 1.8e-2 to 7.8e-4 and stops being a seam at all. The **commensurate
   condenser and the cached pupil** is ✅ **done** (§ 6p), and it is what makes a
   traced mosaic cost minutes instead of hours: a condenser lattice stepping by a
   whole multiple of the *pupil's* own frequency step means every direction reads
   one grid, so a traced pupil is evaluated **once** over its support instead of
   once per direction — **10.76× at 208 directions** on the DIN 4×/0.10, and
   nothing at all on an ideal pupil, because there the transforms were always the
   bill. The saving is pinned as an exact integer rather than a wall clock
   (`pupilEvaluations` falls by exactly the contributing-point count), and the
   cached sum is the uncached one **bit for bit** — which needed a precondition
   nobody had stated: the identity is *arithmetic*, not just algebraic, so
   `pupilSamples` must be a power of two and a non-dyadic one is refused rather
   than tolerated. § 6i's `latticeMatchedSource` became the m = 1 case of it, and
   the one place the new construct departs from `diskSource`'s is 5.6e-17 wide
   and sits exactly where `gridCoordinate` divides by 24. **Two beliefs died
   there.** § 6o's "it also lowers the mosaic's error floor" is **wrong** — a
   commensurate source *is* `diskSource`'s lattice, pinned bitwise, so
   commensurability is accuracy-neutral, and 812 commensurate points at S = 1
   reproduce the plateau slightly *worse* than the 749; what un-flattens the
   curve is 3 228 points, and what § 6p changed is that 3 228 *traced* directions
   became affordable — the floor is the point count, and this step changes its
   price. And APP.md's hope for a source "commensurate **and** coarse" at ~100
   points does not survive § 6f.2: a step multiple of 4 is 52 directions and
   already past that step's own wrong-enough-to-notice threshold, so the knob is
   `pupilSamples` and not the multiple.
   **The stage those four steps were for is ✅ done** — APP.md's A7, a brightfield
   field of view you can drag, and the first surface in the repo that looks like a
   microscope rather than an experiment. Scoped as app wiring, it needed a little
   engine after all (§ 6o.8): a mosaic that *pans* renders its tiles singly, out of
   order and cached, which `renderMosaic` could not do — so `renderMosaicTile` is
   pinned **bit for bit** against the tile a whole mosaic composes, and
   `mosaicTileAt` indexes from the **anchor** rather than the viewport. The
   alternative is measured and splits in two: re-anchoring on a tile centre costs
   3.4e-3 px — § 6m.4's ppm ruler drift, finally in pixels — while a third of a
   tile off centre costs **16.0 px**, so what anchoring protects is the *lattice*
   and not the ruler. Wiring it also **corrected Part D's cost model**: D0.1 timed
   the Abbe sum, but with § 6p's cache in place a traced tile is dominated by
   § 6n's warped rasterizer (1 001 ms against 180 ms at grid 128, 292 against 61 at
   grid 64), which is the radial map cache § 6n deferred *to* § 6p and § 6p spent
   on pupils instead. It is now the branch's dominant per-tile cost and its named
   next optimisation.
   *The eyepiece on the intermediate image:* ✅ `designs/visual-microscope` (§ 6q),
   and with it **§ 6b's own open item** — the branch's chain no longer ends at an
   image, it ends at an eye. The blocker was one line of `afocalTelescope`: its gap
   is solved from a ray entering *collimated*, and a microscope eyepiece collimates
   a real intermediate image formed a finite distance away, so the ray that must
   leave flat starts at the **specimen**. `collimatingGap` is that solve, affine in
   the gap and therefore exact rather than iterative. **The negative control is the
   step's justification, in the currency that decides it:** the telescope's own gap
   on the same two modules leaves **+70.5 diopters** — 280× the quarter diopter an
   observer notices — against 1e-11 for the solved one. The *sign* is the diagnosis
   and it is the opposite of the obvious guess: a gap 150.8 mm short puts the
   eyepiece 132 mm **in front of** the image it should collimate, so its object is
   virtual and the exit beam **converges** 14 mm past the eye lens — the side no
   accommodation can reach, since accommodation only adds positive power. Three
   findings
   came out of it. The **sign was wrong first**, and what caught it was a degenerate
   case with a known answer rather than algebra: a single positive lens is a
   magnifier and reads +D/f erect, on which definition the compound instrument reads
   −40. The **Lagrange invariant takes the tangent NA, not the sine one** — the
   engine's two object NAs are exactly n·tan u and n·sin u, ratio sec u to f64 — so
   the textbook exit pupil = 500·NA/M is right to 2e-6 on a 4×/0.10 and **wrong by
   61% on the 100×/1.40 oil**, where the paraxial figure is 3.55, larger than the
   oil's own index, because it is a slope and not an aperture. And **empty
   magnification is an invariance rather than a rule**: above § 5p's two-stop
   crossover the ratio of what the objective delivers to what the eye can carry is
   flat to 1e-6 across a 4× sweep of M — the M cancels identically — while below it
   the ratio is exactly ∝ M; 500·NA and 1000·NA fall out of two stated pupil
   conventions with the digits appearing nowhere, and λ cancels entirely. The field
   number is spliced in as a **real** annular stop, so a field beyond it vignettes
   in the trace. **Its panel has now landed** (APP.md D6) — app wiring only, and the
   first microscope surface in the app to run on the **main thread**, because § 6q's
   composition is first-order work (18–22 ms an instrument) and the only things that
   need a worker are *sweeps of builds* rather than of traces. Four things came out
   of driving it. § 6q.9's "about 0.88·f_e" is a **bracket**: bisected, the Plössl's
   clear-aperture wall is **0.899195·f_e and a constant**, exactly scale-invariant
   from f_e 15 to 50, and the droop below that is the form's own air-gap floor
   `max(0.3, 0.02·f_e)` rather than the design — forcing the gap to 0.02·f_e makes
   every focal length read 0.899195 to six digits. The **negative control can
   refuse**: on the 100×/1.40 oil `afocalTelescope` returns no gap at all
   (−254.006 mm, non-physical), so § 6q.3's point arrives one step earlier than
   § 6q.3 states it and the control needs a refusal path of its own. The eyepiece's
   **placement band closes as 1/f_e²** — ±0.157 mm at f_e 25 against the quarter
   diopter an observer notices, ±0.025 at 10 — and its departure from the thin-lens
   1000·Δ/f_e² is **affine in f_e with intercept exactly 1000** (997.1965 → 990.6551
   over f_e 15 → 50, to 7 digits), which is what a term proportional to the second
   principal plane's offset must look like on a scale-invariant form: the gap
   between the drawn curves *is* the eyepiece's thickness, proved rather than
   asserted. f_e 10 is the single point off that line, by the same air-gap floor.
   And the vergence has a **pole** at Δ = −31.774 mm where the axial exit ray's
   height passes through zero, which is measured rather than explained: it is *not*
   the front-focus crossing, since at Δ = −FFD = −19.670 mm the vergence is −82.6 D,
   large but finite — the flip is 12.1 mm further on.
   **Open:** the retinal PSF itself, the eyepiece's own aberrations at
   this conjugate, colour, and the exit pupil off axis. § 5j's doublet form also
   walls out again — a computed Plössl admits ~0.88·f_e of clear aperture (**the
   bracket the panel above bisects to 0.899195·f_e**), so FN 20 sits at the edge and
   a genuinely wide field needs the transcribed patent members
   rather than a wider aperture on this form. That is the fourth wall of its kind,
   after § 6b's f/4.1, § 6d's NA 0.343 and § 6e.4's NA 1.411 — **and § 6b.5 later
   identifies it as literally the same wall as the doublet's three-root refusal,
   which is why it is scale-invariant in f_e** — and the panel adds
   that it belongs to the **Plössl** rather than to eyepieces: a Huygens has no
   cemented doublet to fail and no wall below the 1.5·f_e its search stops at.
   *Polychromatic brightfield:* ✅ **done** (§ 6r) — the branch is in colour, and
   a stained section looks stained. The Abbe sum runs per wavelength, each on its
   own `objectFieldTile`, because `pupilSamples` is a bin count and the physical
   frequency a bin carries goes as λ — so every wavelength's image lands on a
   grid of a different physical size while **S needs no conversion at all**,
   being a ratio of numerical apertures. What that costs is a ruler, and the
   correction is APP.md D7's own premise: § 2e's resampler is the wrong one.
   `Psf.intensity` is energy per pixel and an Abbe image is an **irradiance** —
   measured, not derived: a clear field images to exactly 1 at every grid and
   every `pupilSamples` — so the Jacobian must not be applied, and applying it
   tilts the lamp as 1/λ² and turns a neutral specimen blue. **Energy cannot see
   it**: nothing is lost either way, only rescaled, so the witness is a colour
   cast and the ladder gains a third entry beside § 6g.2 and § 6k.4. The common
   grid is the **bluest** plane's and strictly interior, which makes truncation
   zero by construction instead of reported — an extended image has no skirt, so
   what falls off is a λ-dependent black border, i.e. a coloured vignette on a
   clear field (measured at 0.05 of chromaticity against 1e-4 for the honest
   path). The ruler plane is copied **bit for bit**. § 3b's negative control
   transplants exactly: tinting the monochrome image gives the stain and the
   field the same hue to 1e-12, where the per-wavelength path puts the dye 0.05
   off § 3a's own white. Three findings came out of the traced half. The
   doublet's **axial colour is recovered from the wavefront the sum is formed
   with** — refocusing to each λ's paraxial plane removes exactly the predicted
   defocus, to 8%, with a systematic excess that *shrinks* with λ (6.6% → 2.9%)
   and is therefore spherochromatism rather than a scale error, and with the
   achromat's crossing and its sign flip both surviving. The **blue plane is the
   worst-resolved by 2.56× where λ alone gives 1.22**, so a polychromatic stack's
   `pupilSamples` is set by the blue end and `brightfieldFidelity` rules
   `no-honest-image` there at 32 bins while 550 and 650 nm pass. And **lateral
   colour arrives free** — the per-λ frames are concentric and everything inside
   them is traced at its own wavelength — exactly zero on axis and linear in
   field to under 1%. *Its panel has now landed* (APP.md A9) — app wiring only,
   and it corrected this step's own cost line: with § 6s in place nine wavelengths
   are **403 ms** at ps 32 / grid 64 where D7 had budgeted minutes, so the
   expensive axis is the **pupil lattice** and not the wavelength count (ps 64 is
   17×, 208 → 812 directions). Two things came out of driving it. A **neutral**
   specimen — with no λ anywhere in it — images with violet fringes that beat the
   stain on the worst pixel (0.2227 against 0.1700) and survive at the lattice
   where every plane rules `valid`, so § 3b's purple fringing is in this branch
   too on an object that has no colour at all; what separates a stain from a
   fringe is not the spread but the frame's **mean** chromaticity, which the stain
   moves 0.0234 off the lamp's white and the grid moves 0.0010. And the blue
   plane's refusal below reproduces exactly from the app, which is what makes it a
   panel guard rather than a footnote. **Open:** ~~a polychromatic *mosaic*~~ — **closed at
   § 6t**, and the reference λ it predicted would be needed turned out to be the
   *ordering* instead, a singlet-versus-
   achromat objective contest (there is no singlet finite-conjugate objective —
   `achromaticObjective`'s split divides by V₁ − V₂), per-λ grating contrast as a
   readout, and a rung pinning a real lamp's white and a published stain's
   transmittance.
   *The radial map, tabulated:* ✅ **done** (§ 6s) — the branch's named next
   optimisation, spent. § 6n deferred a cache for the inverse chief-ray map and
   attributed it to § 6p, which landed as the *pupil* cache instead; D4 then
   measured that the map, not the sum, is what a traced tile costs (1 001 ms
   against 180 at grid 128) and § 6r multiplied it by the wavelength count. What
   makes a cache possible is **physical rather than architectural**: the systems
   are axially symmetric, so "where does this pixel look" is a function of one
   scalar, and a tile's 16 384 pixels are queries of a **single curve** that
   belongs to the *system* — so one table of 65 chief-ray inversions serves a
   whole 16-tile mosaic. The scheme is piecewise 4-point Lagrange, chosen over
   Catmull-Rom because Keys' a = −1/2 kernel is third-order where this is fourth,
   and its remainder is the closed form the rungs are pinned to: the error falls
   ×5.06 per ×1.5 of node count and ×3.16 per ×4/3, measured at 4.83/4.87 and
   3.07/3.04, until it meets the f64 floor by 32 nodes. **A speed step's rungs
   are identity rungs**, so the exact bisection stays the default and the cache
   is opt-in — § 6m's and § 6n's rungs still pin the *map* and not an interpolant
   — and what is cached is only where the specimen is *sampled*, never the pupil
   assignment. Three findings. The **axis is exact because the map is odd**: the
   node below the first interval is the mirror of the one above it, which costs
   no trace, is not an extrapolation, and makes `heightAt(0)` bitwise zero out of
   the Lagrange weights rather than out of a clamp. The map's reported error is
   an **estimate and not a bound**, under-reading the truth by 7–17% at every
   node count where truncation decides, because a fourth difference reads f⁗
   inside its stencil while the remainder wants the maximum over the interval —
   named as such rather than dressed up. And tabulating the **residual instead of
   the height buys nothing**, in either régime: a cubic already reproduces a
   linear function exactly, so there is no truncation to remove, and the
   reconstruction's final add rounds where the direct table does. Registration
   costs **3.8e-13 px**, nine orders below § 6o.8's 3.4e-3 px of ruler drift, and
   nine inversions already buy 6e-11 px. **The cost model is corrected a third
   time, back the way it came:** with the raster cached (1 046 ms → 2 ms at grid
   128) a whole traced tile goes 1 293 ms → 235 ms and the **Abbe sum is the bill
   again**, exactly where D0.1 had it before D4 moved it. **Open:** a non-uniform
   node distribution for a system whose distortion crowds the field edge, and the
   map under a `DepthPupils` stack — which is § 6l, and there is nothing to
   refuse a wrong-depth table with because there is nothing to build one from.
   *The polychromatic mosaic:* ✅ `imaging/mosaic-spectrum` (§ 6t) — § 6o's field
   of view and § 6r's colour, each of which had named the other as its own
   deferral. § 6r predicted the difficulty would be "one reference λ with every
   other λ cropped to it"; what it actually is, is an **ordering**. A spectral
   tile is cropped twice — the guard band because a transform wraps (§ 6o), then
   the ruler because the planes have different physical scales (§ 6r) — and
   taking the guard **first, per plane, on that plane's own grid** makes it
   exactly `guardCells` in every plane's own cells, so § 6o's whole ladder
   transplants by *identity*: a spectral tile's plane at λ is `renderMosaicTile`'s
   tile at λ, bit for bit, and the step mints no new guard number. Taking it after
   the stack would crop one *physical* distance from every plane, which is a
   different number of cells in each. Three findings. **The ruler plane is the
   least guarded** — every other plane's kept span is strictly interior to what it
   rendered, so 4 cells asked is delivered as **4.500 / 6.592 / 8.040** at
   450 / 550 / 650 nm and the red plane is guarded 1.787× better for free, which by
   § 6o.1's own `guard^(−1/2)` is 1.34× less crop error. That is pinned to the
   **wavelengths alone** — `imagePixelScaleMm` is ∝ λ, so the resample ratio is
   λ_ruler/λ — with a **1.69e-4** residual that is itself a finding: the exit pupil
   is traced per λ too, which is why the ruler is a minimum over *measured* scales
   rather than an assumption about the shortest wavelength. That is § 6r.7's "the blue
   end sets `pupilSamples`" arriving on a second knob and for the same reason, and
   it is the **opposite** of the reasoning that reaches for a mosaic first: a guard
   fixed in millimetres would under-guard red, but every plane renders at the same
   `size` and `pupilSamples`, so in *cells* the frames are identical and what
   decides is whose ruler the crop is taken on. **A spectral pitch is not a mono
   pitch** at the same options — the kept span is `size − 2·guard − 2·rulerCrop`,
   46 px against 48 — so the two are pinned at the same *centre* and never at the
   same index, and a tile whose ruler is not the anchor's is refused because two
   rulers is a scale step nothing downstream can see. And **§ 6r.6's lateral colour
   finally has field to be measured in**: exactly zero on axis, linear in the tile
   index, and **0.4962 px at a 9 mm field edge** — *measured* at tile 44 rather than
   extrapolated, since the split is read off the traced map and a ×44 extrapolation
   of a ×4 fit would admit a distortion term the linearity check cannot see. The
   nonlinearity over that reach turns out to be 0.1%, so the per-λ frames register
   on their own and a polychromatic mosaic needs no chromatic registration.
   *Its panel has landed* (APP.md A10) — app wiring only, and the surface both
   halves of Part D were built for: A7's pannable stage in A9's colour. Three
   things came out of driving it. The exposure has to be the **lamp's** and not the
   tile's — A7's fixed white, in colour — and the first version took it off the raw
   SED×Δλ weights where the image is formed with the **normalized** ones, so every
   tile rendered **300× too dark**; a factor is exactly what a picture cannot show
   the size of, so the app rung pins the number and not the shade. The picture
   cannot pin the white either: an Abbe image's background is **0.92** of a clear
   field, because a nearby absorber depresses it, so the rung was rewritten to
   claim only that a fixed exposure adds nothing to that. And the headline —
   **colour costs a sampling, not a wavelength count**: at the stage's own ps 32
   the colour picture draws and the verdict rules **`no-honest-image` at 450 nm**,
   § 6r.7's blue plane reproducing on a mosaic tile, and that wavelength is the
   *ruler*, so the plane the picture's grid belongs to is the plane that refuses.
   ps 64 clears it at **~0.39 s → ~2.0 s a tile**, which is now an offered control
   rather than a hidden one.
   **Open:** the guard's exponent measured on the *stacked* image rather than
   transplanted, a polychromatic seam step (does a seam have a hue?), and a band
   wide enough to reorder the planes — the refusal exists, no real system trips it.
   *Depth-dependent spherical aberration:* ✅ `imaging/depth-aberration` (§ 6l) —
   the branch's **last numbered gap**, and § 6k's own named deferral. A specimen is
   mounted in something whose index is not the immersion's, so focusing d below the
   slip drags the cone through d of the wrong medium: the dominant real defect of
   deep imaging. The step adds **no physics** — a focal depth is one more layer on
   § 6e.1's stack — so its content is what the reuse costs, and it costs two things
   that were not in the plan. First, the **reference**: the literature quotes the
   depth OPD about the objective's nominal focus and the stack is referenced to the
   buried source's paraxial image, so the two differ by an exact axial refocus, and
   the natural check reads *backwards* — their q⁴ coefficients disagree by 1.4115×
   precisely **because** an exact axial shift is not a pure q² wavefront. Comparing
   third-order coefficients cannot tell a wrong wavefront from a differently-
   referenced one; the all-orders identity (< 1e-17 at every q) can. Second, a
   **coupling no readout could catch**: `renderVolume` divides by the index the
   geometry is in — the *mount*, not the immersion — so the four coupled numbers are
   emitted from one spec and each override is refused rather than documented.
   **The headline is not an aberration at all.** No ray of invariant above n_s
   leaves the specimen, so an oil objective engraved 1.40 delivers exactly **1.3347**
   into a water mount and the rest of its pupil is dark — the fifth geometric
   ceiling in this branch after § 6b's f/4.1, § 6d's NA 0.343, § 6e.4's NA 1.411 and
   § 6q's 0.88·f_e (of which, per § 6b.5, only § 6e.4's is geometric alongside this
   one), and the only one that is a single line of the ray invariant. At
   that wall the *wavefront* is an ordinary number while the *longitudinal*
   aberration diverges, so nothing is clipped by a budget; the rays stop existing.
   **The budget stops being a bound sooner than the slip's, and that is measured
   rather than estimated:** the exact wavefront outruns its own leading term as NA
   approaches the smallest index in the stack — which for a mount is the mount's —
   at 1.02, 1.94, 3.29, 5.79 over NA 0.2 → 1.3, so against a **bisected** Maréchal
   depth the third-order form over-reports **4.51× at NA 1.2**, saying 21.3 µm where
   the answer is **4.74 µm**. That is the classic "an oil lens on an aqueous
   specimen is good for a few microns", produced rather than transcribed. Also
   pinned: exact linearity in depth and a **hard zero** for a matched mount at every
   aperture (why water and glycerol objectives exist); the focus-knob scaling
   n_i/n_s = 1.13709 that stretches every z-stack, with the marginal ray's own ratio
   departing at order q² — so the depth scaling and the depth aberration are **one**
   measurement; § 6k.1's flux invariance and § 6k.4's empty cone both surviving,
   because the SA is a pure phase and the truncation is depth-independent; and
   § 6k's axial *symmetry* breaking **19.24×** for an emitter at a fixed depth, best
   focus moved to +1.11 waves. § 6e.4's "the cover slip HELPS" finally gets a rate,
   and the rate kills it as a trade: **33.28 µm of slip error per µm of depth**.
   **Open:** off axis, the chromatic half, correcting the objective *for* a depth
   (§ 6c's `targetS1Mm` route, which is what a collar physically does), § 6s's table
   under a moved conjugate, and TIRF — 6l.3 stops at "the rays do not exist", and
   what happens past n_s is a real modality and not geometric optics.
7. **Teaching layer + polish**
   Every artifact in the image links to the plot that explains it (coma flare
   → ray fan; purple fringe → chromatic focal shift). Misalignment
   (tilt/decenter) scenarios. Progressive-refinement tuning.

## v1 cut (both branches shipped)

- Bench editor over the prescription schema; exact + paraxial tracing; glass
  catalog.
- Analyses: spot diagram, ray fan, chromatic focal shift, PSF/MTF, Zernike
  readout, distortion/field curvature.
- Hero image simulation with progressive refinement (instant on-axis preview,
  background full-field render).
- Mechanical compatibility (barrels, threads, parfocal/back-focus) feeding
  back into optics.
- Telescope: presets above, seeing, eyepieces, visual + camera modes.
- Microscope: brightfield + fluorescence, immersion, coverslip mismatch.

## v2+

- Rigorous partial coherence (Hopkins TCC) → phase contrast, DIC.
- Non-sequential engine: ghosts, internal reflections, stray light (the
  architecture commitments keep this a new scheduler, not a rewrite).
- Thin-film coatings, polarization physics.
- More catalogs (glasses, patent-derived eyepieces/objectives).
- **Design mode.** The focus solve (step 2) is already a solver; generalizing
  it is cheap and turns a simulator into a design tool: curvature/thickness
  solves ("make EFL = X"), then damped least squares over a few variables.
  Strongly differentiating — no other web optics sim lets you *design*.

## Engineering practices to land alongside the code

- **Golden-image regression harness at step 4**, not step 7. The validation
  ladder pins physics; nothing pins *images*. A small set of committed
  reference renders plus a perceptual diff catches what unit tests cannot.
- **One cross-validation against an independent tracer.** A single system
  traced in an existing tool and committed as a fixture upgrades several
  rungs from "matches closed form" to "matches an independent
  implementation" — the strongest evidence available for the exact tracer.

## Deliberate deferrals

- No Python prototype — physics validated directly in TypeScript via the test
  ladder.
- ~~Partial coherence approximated in v1 (condenser-NA factor)~~ — **withdrawn
  at § 6f.** The approximation was never built: a factor on the incoherent MTF
  asserts the (NA_obj + NA_cond) law instead of producing it, and the hard rule
  forbids that. Abbe source-point summation gives the law and the nonlinearity
  for the cost of one transform per illumination direction, which turned out to
  be affordable. Hopkins' TCC stays a v2 item, but for *phase contrast and DIC*,
  not for brightfield. Fluorescence and telescopes remain exactly incoherent by
  nature.
