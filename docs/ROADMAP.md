# Roadmap

**Where the project is (2026-09-02).** Steps 1–7 below are closed, and step 6
alone runs to ninety lettered sub-steps. The open scientific items — what is
deferred, what is blocked on data, what would pin each, and which of the
ladder's own chains has stopped producing engine changes — now live in one
place, [`docs/OPEN-PROBLEMS.md`](OPEN-PROBLEMS.md), rather than scattered across
a hundred *Still open* paragraphs in VALIDATION.md. Read that register before
choosing the next step; its *Suggested order* is the plan, and step 8 below is
its first entry, landed.

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
5. **Telescope branch + bench editor + mech layer** ← optics landed, and **every
   mode now has an app surface**: the presets, the spider, the diagonal's
   vignetting, the camera, the eyepieces/eye/visual mode, and the long exposure
   (APP.md C1–C6, all landed). The **mechanical layer is ✅ closed** (§ 5u,
   below). **The scenes' engine step is ✅ closed too** (§ 5v) — an extended
   incoherent source had no rasterizer, and now does. **The bench editor is ✅
   closed too** (APP.md Part E) — the prescription schema on a form, seeded from
   designs the engine built, with both tracers on the same rows. App wiring
   only, and it produced one result nothing else in the repo states: the
   **order** of the surviving aberration is measurable off the aperture alone
   — halve the stop and the on-axis residual falls by 2^p — which reads 3 for an
   uncorrected singlet and **5.01 for § 6b's objective**, confirming that
   solve's ΣS_I = 0 by a route that never computes S_I, and working on the
   conics `seidelSums` refuses outright.
   *Recorded here rather than only in APP.md because a panel that finds an engine
   inconsistency gets a line in this file (C4, A6, C5):* **`resolveStopRadius`'s
   `objectNA`/`imageNA` branches read NA as a paraxial slope, not as n·sin u** —
   (NA/n)·arm rather than arm·tan(asin(NA/n)) — so the same aperture spelled two
   ways differed by 1/√(1 − (NA/n)²): 0.50% at NA 0.10, 15.5% at 0.50, 3.2× at
   0.95. ✅ **Closed at § 1.5.1**, and it landed the way this paragraph said it
   should — one line, re-pinning nothing, with rungs of its own that pin n·sin u
   at a high aperture. Two corrections to what stands above it. The clause
   **"no rung and no panel reaches the branch" had already expired when it was
   written**: Part E is a form over all five spellings, so the branch was
   reachable from the editor, and that panel was disclosing the discrepancy in a
   caption (`naSpellingRatio`, pinned at 1.005037815) rather than the engine
   being right — which makes this the fourth defect in the C4/A6/C5 family and
   the first the app had already *found* and worked around. Retiring that
   caption, and rewriting its test to pin the agreement, was most of the change.
   And **"nothing landed moves" is exactly true and is the reason it survived**:
   the wrong form is the right form's paraxial limit, so there is no aperture at
   which it looks broken, only apertures at which it is quietly 15% out. The
   fix also **refuses NA ≥ n** rather than returning ∞/NaN, which is § 6l's ray
   invariant arriving one layer up as a precondition instead of a measurement.
   The scenes' **app surface** is ✅ **closed too** (APP.md C7) — app wiring
   only, and it found something no § 5v rung could: those rungs run on an
   unfolded fixture, and a **Newtonian's frame stops rather than dimming**. Past
   a certain field the chief ray misses the diagonal and the rasterizer refuses,
   which is § 2f's wall reached through the chief ray instead of through
   `opdMap` — measured at **2.383° at f/4 falling to 0.131° at f/15**, with
   aperture cancelling *exactly* (the bisection returns the identical value at
   100, 200 and 400 mm) and a local exponent of **2.334 → 2.099** against § 2f's
   own 2.34 → 2.11. § 2f's closed form is deliberately **not** printed beside
   it: transcribed against this preset it reads 7.7× low, because it is the
   minimal diagonal's case and `newtonian`'s clear radius carries a √2 footprint
   allowance, so the exponent is what the two share and the wall itself is always
   the measurement. The headline is that the wall is **mechanical**: the focus
   offset is a number `newtonian` itself calls optical-surface-free, and moving
   it over a focuser height of 100 → 300 mm takes the reachable field
   **0.320° → 1.109°** — how much sky a Newtonian can frame is set by how tall
   its focuser is. Still open here: the scenes' **content** (an albedo map,
   lunar terrain, a real limb-darkening coefficient), which is measured data
   rather than engine or wiring — the panel therefore ships a synthetic disc
   with the darkening law's coefficient left to the reader.
   **`core/mech`'s panel has landed too**
   (APP.md C3) — see the end of § 5u below for what driving it corrected.
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
   *The long exposure, and its panel:* ✅ (§ 5d.1, APP.md C6) — § 5d's **other**
   named deferral, and a gap of a kind this ladder had not had: the physics was
   pinned and the machinery was **unreachable**, since the averaging lived in
   `seeingEnsemble` inside `seeing.test.ts` with no export. `longExposurePsf`
   promotes it — in its own module, because `psf.ts` imports `withPhaseScreen` as
   a value and `seeing.ts`'s back-edge is type-only by design, and taking a
   *pupil* rather than a system so the trace happens once (`systemPupil` split out
   of `psf()` for it). Every § 5d rung passes unchanged at the same seeds, which
   is what makes the move a move. Five things came out of driving the panel.
   **0.98·λ/r₀ is an answer only where the telescope is seeing-limited**: the two
   FWHMs meet at D = (1.029/0.98)·r₀ ≈ 1.05·r₀ with **λ cancelling**, and a 200 mm
   Newtonian lands within 2% of Fried at r₀ = 25 mm while at r₀ = 200 mm it comes
   out wider than *both* single-cause widths — a quarter over Fried, a third over
   its own atmosphere-free disc, under their sum — because below the crossover
   two comparable widths convolve and neither formula describes the result.
   Getting that right needed a **unit corrected**: the panel first used 1.22·λ/D,
   which is the first zero's *radius* and not a FWHM (1.02899·λ/D is), moving the
   crossover 249 → 210 mm and making the wrong claim pass. The tell was on screen
   — two adjacent captions converting pixels to arcseconds differently, by 35%. **The
   instrument's own quality is in the seeing disc**: on the same sky the
   paraboloid measures 0.98× Fried where a Strehl-0.609 achromat measures 1.09×,
   which no § 5d number can show because they are all flat-pupil numbers — hence
   the new rung running the ensemble on a *traced* pupil. **Where the transfer
   function leaves Fried belongs to the ensemble**, not the sky: it is a residual
   speckle floor that does not fall with frequency, identified by moving outward
   as the screen count grows. **The under-resolution guard is about the grid** —
   doubling `pupilSamples` halves the step on a byte-identical atmosphere, 0.556
   red to 0.288 green — and both halves are reachable from the panel. And the
   cost verdict this was scoped with is right for the wrong reason: the bill is
   the **screen generation**, not the transform, so a 4× finer PSF grid is ~1.2×.
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
   *The panel those two existed for:* ✅ **landed** (APP.md C5) — the eyepiece
   library and the eye are **one surface**, because an eyepiece has no exit pupil
   to match until something is behind it. App wiring **plus one engine fix it
   forced** (§ 5l.1), the third Part C surface to need one. Seven things came out
   of driving it. The headline is that an **apparent field of view belongs to the
   eyepiece**: bisecting § 5n's own refusal gives the object-space wall as
   atan(r_e/f_o), which moves **5×** across six instruments spanning 4× of
   aperture, 2.5× of focal ratio and 5× of eyepiece focal length — while the
   apparent field those buy holds **58.3°–59.0°**, under 3%, because the two f_o's
   cancel. The catalogue's 2·atan(r/f_e) is therefore **wrong in a direction**,
   +24.1% on the default Plössl, that being § 5n's pincushion read at the edge
   (and running ×4.00 per doubling near the axis, rising to 5.07 at the wall —
   the fifth-order term identified from the other end than § 5n's). A computed
   Plössl **cannot exceed ≈61.3°** of apparent field, and what stops it is § 5j's
   *doublet* refusing an aperture at **0.9615248·f_e** — bit-identical to the
   constant D6 bisected as a length, so two panels now measure one refusal in two
   currencies, which is the concrete reason the wide-field members below need
   patents rather than a wider Plössl. On a Huygens the same comparison reads
   **−35%, and that is not distortion**: its wall lands 38% short of the front
   rim, so the chief ray is dying behind the field lens — § 5o's own scope note
   ("the field stop sits between the lenses"), and the panel's two numbers detect
   *which surface is the stop* with nothing in the engine reporting one
   (0.94–0.99 for every Plössl, 0.61–0.78 for every Huygens). **Accommodation is
   not zero and its sign is the eyepiece's**, proved on the stigmatic Cassegrain
   as a control: the residual there is the eyepiece's alone and is negative for
   both forms (−0.124 D Plössl, −2.58 D Huygens), while an achromat's own residual
   opposes it and sends the Plössl's to **+0.696 D** — and a *negative* demand is
   the red one, because a relaxed eye can only add, which is § 6q.3's "wrong side
   of infinity" on the other conjugate. Since the frame is formed AT the retina
   rather than at best focus, the Huygens' Strehl says what that costs: **0.094**
   against the Plössl's 0.980 on the same telescope. And **a diopter is the wrong
   unit for how much it hurts** — on the control the demand falls 4.4× from
   f_e 8 → 32 while the Strehl gets *worse*, because the demand is a length and
   the damage is a wave count over a beam that is growing. The engine fix is the
   third defect of A6's and C4's family and widens it: not a bracket but a
   **declaration dropped at a boundary** — `spliceModules` takes surfaces rather
   than a `Prescription`, so a folded Newtonian's frame never reached the splice
   while its 45° tilt did, and the pair composed *silently* at a **1405 mm**
   afocal gap where the geometry has 131.
   *Camera mode — pixel scale + sensor sampling:* ✅ (§ 5r). A `Sensor` at the
   focal plane (`imaging/camera`); `resampleToSensor` rebins by area, so the
   detector-footprint MTF and aliasing are carried, not assumed. `plateScale` and
   `fieldOfView` invert the *traced* chief-ray map, so they carry distortion.
   *Its panel has now landed* (APP.md C4) — app wiring **plus one engine fix it
   forced** (§ 5r.1), the first Part C surface to need one. Five things came out
   of driving it, and two correct sentences above. **The critical pitch is not
   λ/(4·NA) with λ alone moving:** the traced NA moves too, and how it moves is
   the lens's correction — a singlet's spread runs **+2.593%** wider than the
   wavelength ratio, an achromat's **−0.155%** narrower (the crossing, so the
   sign flips and the magnitude is 17× smaller), and a Newtonian's is **exactly
   zero** because a conic has no index and its NA is bitwise identical at every λ.
   That is § 3b's contest in pixels rather than in colour, with the mirror as the
   control. So `samplingRegime` is **not one verdict**: at the pitch that is
   critical at 550 nm the blue plane is undersampled and the red oversampled, one
   sensor holding three at once, and the ruling plane is the shortest the stack
   actually contains — **430 nm, not a round 450**. The **FOV-against-paraxial
   readout has a floor that is not distortion** — 0.0212% at 0.029° of field where
   distortion is identically zero — and moving the image plane to the last vertex
   sends it to +3.4553% while leaving the field term unchanged, so it factorizes
   into a plane-position *scale* (−21.1 µm on the achromat, −190.0 µm on the
   singlet, −2e-5 µm on the paraboloid) times a distortion that runs ×4.00 per
   doubling. The **peak gain is parity-dependent by 3.7×**, since sample-at-centre
   puts the axis on a cell or on a seam by the column count's parity — § 5r's own
   centroid lesson with the roles swapped, the centroid being the blind one here —
   against a flat field that reads footprint² **exactly**. And the panel **cannot
   auto-expose**: the rebin conserves energy, so normalizing would cancel § 5r's
   headline, and the star's own total is flat in aperture (0.5% over 2× of D and
   2× of f), so light grasp is applied rather than inherited. The engine fix is
   the second bracket defect a panel has found after A6's § 1.6.1: the FOV
   bracket probed at a fixed 0.5° and threw on every Newtonian sensor, § 2f's
   diagonal wall being 0.346° at f/10, and the refusal boundary now lands on
   § 2f's closed form to 4e-6.
   *Camera mode — relative exposure:* ✅ (§ 5s). `imaging/exposure`, pinned as
   ratios because the absolute photon zero point is § 3a's deferral. ~~**Shot noise
   stays deferred** — it is a draw from an absolute photon count, which needs
   that zero point.~~ **The zero point landed as § 8a** (step 8 below) and the
   draw with it: `collectedPhotonRate` is § 5s's grasp times the AB zero point,
   and `imaging/noise` is the Poisson draw. What is still not done is the
   *frame* — the hero image with its noise in it — which is wiring and is
   step 8's next item.
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
   in the repo, and the first that is not the ray invariant. **§ 6ai added a
   second, higher floor:** the shipped objective's stop is a diaphragm one focal
   length behind its glass, so the mount must hold that too, and
   `P·M² − 2x′M − x′ = 0` gives **7.134** (7.212 built). Not one doublet, and not
   even one doublet below about 7×. **Open:** barrel
   vignetting (the `semiApertureMm` hook exists, the rung does not), the sensor's
   own cover glass, tilted elements, and the tube-length error with its known
   coverslip equivalence.
   *Its panel has now landed* (APP.md C3) — app wiring only, no rung, and the
   first surface in that doc belonging to **neither branch**: three of its blocks
   are a telescope's imaging train and the fourth is a microscope's DIN mount,
   which is what a layer about hardware looks like. Four things came out of
   driving it, two of which correct sentences above. **§ 5u.6 is now traced**,
   which that rung deliberately is not — by differencing two `withGlassPath`
   systems, after the two obvious routes failed (a § 5t thickness `Perturbation`
   moves the image plane 40 mm and reads **7× high**; a zero-thickness plate
   breaks the tracer outright). It lands within ±1% of W₀₄₀/(6√5), and the
   residual **never converges** — wandering non-monotonically with `pupilSamples`
   (1.061 / 0.956 / 1.007 / 0.995 / 0.988 at 9 / 15 / 21 / 31 / 61) and coming back
   *unchanged* where the lens's share of the total is four times different — bare
   ÷ plate 3.64 at f/10 against 0.90 at f/40, the two wobbles agreeing to 2.5e-3 —
   so it is the pupil lattice's own quadrature and not the doublet's higher
   orders. That ±1% is *larger* than this step's exact/third-order excess at
   anything slower than f/4, so the traced route cannot resolve the number the
   rung computed — which makes the closed form the right call rather than a gap in
   it. **The f/5.315 is a plate in isolation**: on a 100 mm doublet the *lens*
   leaves Maréchal at **f/6.007** and the lens with the diagonal at **f/6.192**,
   both slower, so at f/5 the doublet is already 2.6 budgets over and the
   diagonal — costing 3.1% of focal ratio — is the smaller problem. It is never
   free either, being positive at every ratio swept, because a plate's spherical
   aberration shares an achromat residual's sign; the exact **opposite** of
   § 6e.4's oil, which is rarer than the glass either side and helps. And **the
   mount floor is not a constant**: it is the NA 0.10 answer, running 7.163 →
   7.427 over NA 0.05 → 0.20 (4.173 → 4.506 before § 6ai) with the thin-lens
   floor unmoved at 7.1339, so the whole spread is glass — while above ≈ NA 0.22 the mount **stops being the binding wall** and
   § 6b.5's aperture refusal takes over. Telling those two apart is load-bearing:
   catching both as one exception reports a mount ceiling of 12.6× where no
   doublet exists to mount. Two nulls arrive free — § 5u.2's position independence
   at **2.7e-11 waves**, and the plate's cost not knowing the aperture (0.22% over
   D = 60 → 150 mm) where the doublet's own share moves 2.5×.
   *The extended source:* ✅ `imaging/extended` (§ 5v) — this step's scenes, at the
   engine, and the last unbuilt engine capability outside the teaching layer.
   Everything the branch had imaged from the sky was a **star**, because
   `rasterizePointSources` places a flux at a point; a planet has no flux until an
   area is named, and what it carries is a **radiance over solid angle**. So the
   step adds **no optics** — every ray was already being traced — and its content
   is that the chief-ray map is **differentiated** rather than only evaluated.
   The Jacobian is **one-dimensional**, `dΩ/dA = (sin θ/r)·(dθ/dr)`, which is
   § 6m.4's anisotropy as a *product* rather than a determinant: axial symmetry
   leaves no off-diagonal term to neglect. Pinned to **cos³θ/f² at 1.3e-10** on a
   paraboloid whose stop is at the mirror, so its `r = f·tan θ` is the reflection
   law and holds to **one ulp**, with the axis exact as `(dθ/dr)²` = 1/f². **The
   headline is a cosine that is deliberately not applied.** The textbook falloff
   is cos⁴θ, and it was measured *before* the module was written rather than
   assumed: `psf().energy` is flat in field to **8e-7 at 2°** where cos θ is
   6.1e-4, and the residual is not even a cosine's shape — the engine's pupil is a
   normalized grid, so its area is field-independent by construction. Applying the
   fourth cosine here would have made this rasterizer disagree with the
   point-source one, which is missing it identically, so it is named as a
   **pupil-layer deferral** and it **cancels** in the rung that compares them. Four
   more. **A derivative loses an order**: the Jacobian converges ×8 per doubling of
   nodes where § 6s's radius converges ×16, and `errorEstimateMm` is therefore not
   merely under-reading as at § 6s.2 but is the **wrong quantity's order**. **Energy
   is a real witness here** — a radiance is a density, so this warp carries the
   Jacobian `imaging/specimen`'s deliberately does not — and it *converges* rather
   than conserving, the disc's flux residual **changing sign** (+1.70e-1, +1.95e-2,
   −2.27e-3, +1.99e-4) because a point-sampled hard edge counts lattice points
   inside a circle, so the sign flip is what is asserted and no rate is claimed.
   The departure from cos³ on a real doublet **is** the distortion, at **×4.00 per
   doubling of field** — § 6h.1's ×8.00 cubic and § 6n's ×2.00 sagitta seen one
   derivative along. And **nothing downstream changed**: a disc and a star of equal
   flux integrate identically through `renderField` to 1e-13, the rendered light is
   *bitwise* linear in radiance, and a disc's image reaches f·tan(D/2), which no
   point source can say. **Open:** the fourth cosine, and the content —
   albedo maps, lunar terrain and a real limb-darkening coefficient are measured
   data or authoring, not engine. ~~a panel~~ — ✅ **landed** (APP.md C7), and it
   reported one thing back to this step: every rung above runs on an **unfolded**
   fixture, so none of them could meet the refusal a folded system reaches first.
   The falloff is also confirmed invisible where a telescope actually works —
   measured against cos³ to six digits at every field the panel can frame, since
   § 5v.3's own 0.73% needs 4° — so the panel prints it as a number and draws no
   axes for it.
6. **Microscope branch** ← current; **every numbered step in it is now closed**
   (§ 6l was the last gap, and § 6u has since closed the last *named blocker* —
   § 6a's telecentricity — which was an engine capability rather than a numbered
   step; **§ 6v then spent it**, moving the shipped objective's stop onto its back
   focal plane so the presets *are* telecentric rather than able to be,
   **§ 6w paid its price**, sizing the glass for a field number so the
   objective knows what field it must pass, and **§ 6x has since collected what
   it is worth on the other side** — the illumination, where four earlier steps
   had blamed the condenser for something that was the objective's all along).
   What remains here is app wiring and scenes.
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
   while the tube lens forms the image in air. ~~A non-unit image-space index
   stays unpinned only because no system in the ladder has one.~~ **It has one
   now — § 2g**, the Cartesian ellipsoid, a single k = −1/n² surface whose image
   sits in glass by construction; the wiring is pinned to the Airy ring in the
   medium, 1/n the size the air formula gives.
   *Prerequisite:* **module composition** ✅ — landed as § 5l with the eyepiece
   library; this step consumes it unchanged. Design in ARCHITECTURE § Data model.
   *Architecture + the first objective:* ✅ `designs/microscope` (§ 6a). The chain
   the whole branch varies on — specimen at the objective's front focus,
   collimated space, tube lens, image — plus the one first-order capability the
   engine lacked, `collimatingObjectDistance`. **Three named blockers for
   immersion**, recorded rather than papered over: `objectNA`'s aperture seed is a
   tangent and is 2.6× out at NA 1.4; telecentricity needs object-space ray aiming
   that does not exist; and F = 1/(2·NA) means high NA is a different glass form
   (Lister, then the aplanatic hyperhemisphere), not a faster doublet. **Two of the
   three are now closed** — the glass form by § 6e.2–6e.4, and the seed by § 1.5.1,
   which took neither this step nor the immersion one that was expected to need it
   (both hand their chains a `stopRadius`) but a *panel*. **And the third has now
   closed too, at § 6u** — so all three are shut and this step has no named
   blocker left. Object-space aiming turned out to add **no physics**: a pupil at
   infinity is a set of *directions*, so a pupil coordinate names a slope, the
   aperture is `stopRadius/B` **with no object height in it** — the defining
   property rather than an approximation — and B falls out of the backward trace
   `pupils` already ran, because tracing {y:0, u:1} back from the stop applies the
   inverse matrix and carries (0,1) to (−B, A). The existing `|axis.u| < 1e-15`
   branch was therefore *already* a test of A = 0 and had B in hand. The headline
   is the property telecentricity is bought for, in the experiment named rather
   than assumed — object plane moving, image plane **held fixed**: the
   magnification is **bitwise** unchanged over 20 mm of travel against a control
   that drifts as −δz/(L+δz) and loses **9.1%**. Also measured: the traced chief
   ray's miss at the stop centre is a **cubic**, ×8.00 per doubling of object
   height, which is § 6h.1's distortion constant appearing in the pupil; and the
   f64 branch threshold is **not a cliff**, since the two aims converge linearly
   in the stop's offset from the back focal plane (5.6e-2 → 5.3e-12 over ten
   decades), so which side a design falls on cannot matter.
   *Recorded here rather than only in VALIDATION because probing whether the
   branch was reachable found a defect in a shipped function:* **`aimRay`
   returned a backward-propagating ray whenever the entrance pupil lay behind the
   object plane** (§ 1.5.2) — magnitude exact to 12 digits, sign inverted, so
   `traceRay` answered **`miss`** on ordinary geometry. That is the **fifth**
   member of the C4/A6/C5 family and the first to answer with a *status* rather
   than a number, which is exactly why no rung caught it: a `miss` reads as the
   system's fault. It re-pins nothing, and that was *proved* rather than
   assumed — `aimRay` was made to throw on the backward case and the whole ladder
   re-run, 75 files and 1310 tests passing. The two steps are one investigation.
   *The presets now USE it:* ✅ § 6v. The infinity-corrected objective's stop
   moves from its rim to its **back focal plane**, so the branch's presets are
   telecentric rather than merely able to be — and the old placement stays
   reachable as the **negative control**, since what telecentricity buys has no
   measurable size without a system that lacks it. "Wiring plus a re-measurement"
   was right about the wiring — the stop is one surface at a distance the
   paraxial trace already reported — and the step is made of the re-measurement.
   The aperture **stops being a length**: sized f·tan u, the f cancels against
   § 6u.1's stopRadius/B and what reaches the aimer is **tan u exactly**, with no
   focal length, object distance or magnification left in it; the delivered NA is
   then bitwise indifferent to where the specimen is, and so is the
   **magnification under defocus**, against a control that loses 0.1% over 50 µm.
   Two things nothing predicted. **The price is off axis and it is the glass:** a
   telecentric bundle's footprint translates with object height where a
   rim-stopped one pivots through one hole, so it walks off an element sized for
   the axial beam — **on the 4×/0.10** nothing lost to ~0.1 mm of field, 11% of
   the pupil at 1 mm, 35% at 3 mm, and identified as the element rather than the
   diaphragm by widening one at a time. Those figures do **not** travel: the rim
   goes as f·NA and the field is absolute, so at 40×/0.10 the same 1 mm is past
   total occlusion — which is exactly the magnification range the panning
   surfaces run at. Real objectives oversize the front element for this reason;
   doing it here needs an objective that knows what field it must pass, so it is
   **named as the next step** rather than done quietly. And the
   ladder **barely moved — 9 tests of 1364** — because on axis the two
   constructions aim the *same rays*, which is also why the one number that did
   shift (§ 6d.4's reach, 0.5%) is a **reference** and not an aberration: the stop
   moved, so the exit pupil the wavefront is struck against moved. § 6d's control
   is held at the rim deliberately — its claim is about the FORM, one doublet
   against two, and third-order S_II has no telecentric spelling since
   `seidelSums` needs the stop at surface 0.
   *Recorded here rather than only in VALIDATION because it is the fourth member
   of the C4/A6/C5 family:* giving the objective a diaphragm made it the module's
   last surface, and the composition splices the infinity space **after the
   module** — so the tube lens was **silently pushed back by the objective's whole
   back focal distance**, ≈ 50 mm. The space is collimated, so no first-order
   property changed and the whole suite stayed green; it surfaced only as a rung
   written to assert a null reading 2.8e-5. Same signature as § 5l.1 — a module
   composed at a gap the geometry does not have, hidden because the quantity that
   would have shown it was collimated. The space is now measured from the last
   **glass** vertex, and an infinity space shorter than the back focal distance is
   **refused** rather than composed, pinned at the boundary itself.
   *The oversized front element it named:* ✅ § 6w. `fieldNumberMm` — the field
   diameter at the intermediate image, the number a microscope is catalogued by
   and the one § 6q already splices in as a real stop — sizes the glass to
   `f·NA + FN/(2M)`, the axial beam plus the walk. **The default stays off, and
   on principle rather than out of caution:** a stop position is intrinsic to an
   objective, which is why § 6v could default telecentricity on, while a field is
   a property of the objective *together with whatever stops the field behind
   it*, so nothing picks a value — which leaves the § 6v lens standing as this
   step's negative control. **The content is that every number in it loses the
   magnification.** The oversize is a RATIO, `1 + FN/(2·f_tube·NA)` = 1.45 at
   FN 18/NA 0.10 for the 4×, 10× and 40× alike, because the semi-field and the
   beam are both ∝ 1/M — so § 6v.5's "those figures do not travel" is true in
   millimetres and **false as a fraction**, and the 4× and the 40× turn out to be
   one lens scaled (every length ×10, every curvature ÷10, the bending identical,
   since S_I ∝ h⁴ makes the solve scale-free). Against the shipped control the
   claim lands as a count: **313 of 313** pupil points at the field edge where
   the axial objective passes **229**, the same 84 lost at every magnification.
   Three things the plan did not have. The closed form is an **upper bound never
   reached** — it adds two heights that live on the equivalent refracting sphere
   rather than on a vertex, so the traced footprint tops out at 0.98922 of it and
   the delivered field is 5.27% *more* than asked, with the crown's outer face
   (0.5% rim margin, against 2% on the specimen side) the one that finally stops
   it. The cost is **2.115% of working distance** at every magnification, and it
   exists *because* the doublet is built at the wider aperture rather than having
   its rim widened — which is the honest route, since `achromaticObjective`
   checks edge thickness at D/2 and a rim widened afterwards would have passed a
   check for an element that cannot be made; the delivered NA does not pay,
   holding to 14 digits because it is re-derived on the lens actually built. And
   the **traced magnification is the one quantity here that still carries an M**
   (0.08%, spread 0.18% over 4×→40×), because the microscope is composed against
   a 200 mm tube lens that does not shrink with the objective — the invariance is
   the objective family's, not the instrument's. The wall it opens is not a new
   kind: `D/f = 2·NA + FN/f_tube` is magnification-free, so a field number is a
   **second door onto § 6b.5.7's geometric doublet ceiling** and costs aperture
   linearly — the NA ceiling drops by exactly `FN/(2·f_tube)` (0.045 at FN 18, to
   nine digits) from an axial 0.287401975 that is `1/(2·F*)` for that step's own
   F\* = 1.7397236, two constants meeting by a route neither was derived through.
   *What it was worth to the illumination:* ✅ § 6x — § 6w's last open item that
   was not a new lens, and it turned out to be a **correction to four module
   headers before it was a measurement**. §§ 6f/6h/6m/6o each hand every field
   point one condenser with its directions centred on the pupil and each wrote
   that down as an assumption about the *lamp side*. It is not one: Köhler
   illumination really does send one direction per point of the condenser's
   diaphragm to the whole field, exactly. What depends on the field is where that
   direction **lands in the objective's own pupil** — `h/R_ep` of the way out —
   and that dies only for an entrance pupil at infinity. So the licence belonged
   to the **objective** all along, § 6v is what granted it, and it granted it to
   the infinity presets only; the DIN still carried its stop on the rim and
   was this step's live subject. **§ 6ae gave the DIN the same diaphragm and
   § 6ai made it the default**, so the displacement quoted next is the rim
   member's; the shipped lens's is a bitwise zero at every field. The displacement is **0.217 of a pupil radius per
   millimetre** on the shipped 4×/0.10 — against a condenser setting rarely above
   1, a millimetre of field is lit through a cone a fifth of the way out of the
   aperture meant to catch it — and it is read off the **aimer** rather than
   derived, which settles the tangent-versus-sine currency § 6q.5 got wrong and
   settles the sign by construction; the closed form then agrees to ten digits.
   On § 6v's telecentric lens it is **bitwise zero** at every height, so every
   telecentric and every on-axis render is byte-identical to its pre-§ 6x self.
   The claim lands as § 6w's kind of count — **97 of 97** illumination directions
   admitted on axis against **90 of 97** at a millimetre, the seven lost being the
   seven furthest out *along the field's own direction* — and that last clause is
   the rung, because a **dimming cannot check this**: displacing a disc by ±d
   ejects the same count either way, and "the clear field dims off axis" is true
   on the telecentric objective too (0.8158 → 0.7737) for § 6v.5's entirely
   different reason. While the cone is still inside, the offset costs a clear
   field **exactly nothing**; what it moves is which part of the aberrated pupil
   each diffracted order crosses. Three more. **§ 6i's "there is no condenser in
   the expression at all" becomes a bitwise test** — the offset rides beside the
   pupil rather than inside it, so fluorescence reads the same object and
   correctly ignores it — and folding it into the pupil would have been *silently*
   wrong, since the Abbe sum sizes the frequency box it visits from the source
   point alone and would have cropped a pupil sitting off centre, which is the
   truncation its own comment says reads as a smaller aperture. **§ 6p's cache
   does not survive an offset, and that is a fact about telecentricity rather
   than a limitation of the cache:** commensurability is a claim about where the
   source sits in the pupil, so a non-telecentric objective walks it off the
   lattice with field. **What that costs was measured after the step was scoped
   on a wrong belief** — the cache was thought to have no caller outside its own
   rungs and has three, of which only the pannable stage pays, because a mosaic is
   off axis by construction while the colour section renders on the axis and
   fluorescence never translates anything. A stage tile goes **404 ms to 727 ms**,
   which is 1.8× and not § 6p's 10.76×: § 6s cached the radial map and put the
   Abbe sum back as the bill, so what § 6p bought is a smaller share of a tile
   than when § 6p measured it. And **the binding knob is the pupil sampling, not the source
   count**: a direction crossing the aperture rim is a step change that now
   happens *between* patches, which stops § 6h.5's 32-bin sequence converging at
   all (ratios 1.95, 0.87) and is **not** rescued by refining the source
   (0.82/0.69 at 97 directions, 0.46/0.51 at 349, at three and eight times the
   cost) while refining the pupil rescues it at every source count — with
   § 6m.4's contrast sweep saying the same thing independently, non-monotone at 32
   bins and smooth at 64. Two rungs moved to 64 bins as a **fixture** correction
   with their claims unchanged, and with the fixture adequate the offset's own
   effect is small and **backwards**: the first refinement step *shrinks* by a
   factor 0.727, because the displacement partly cancels the field aberration, so
   a rim-stopped frame is slightly more isoplanatic than its wavefront predicts.
   Exactly one category of rung moved — traced **and** rim-stopped — and § 6o.7's
   is a finding rather than a re-pin: two abutting tiles sit at two field heights,
   so a mosaic seam now carries an **illumination** step the guard band cannot
   remove.
   ~~**Still open here:** the DIN objective~~ — **closed at § 6ae**, which took the
   placement this step deliberately left alone. It arrived the way this bullet
   said it would (a `stopPlacement` and a `fieldNumberMm` on the finite-conjugate
   constructor, no physics added) with one correction to the sentence above it:
   the DIN's stop radius has no conjugate in it EITHER, and that is not an
   infinite-conjugate accident but the B = f of the object→back-focal-plane
   matrix, which holds at every object distance. § 6ae did **not** move the
   default, for exactly the reason this bullet gives — it would make § 6x's
   subject disappear — so the placement is now *chosen*, § 6x's fixture chooses
   `"rim"` by name, and the flip is priced at 81 rungs across 17 files. The
   finding is that the classical prediction FAILS on the shipped lens: a stop
   shift costs no coma when ΣS_I = 0, and at the f/4 the 4×/0.10 works at it moves
   71% of it, because the only spherical left is fifth order and the induced coma
   rides on that.
   ~~**Still open here:** the condenser's own aberrations~~ — **half closed at
   § 6af**, which built the condenser this branch never had: an UNCORRECTED Abbe
   pair, chosen that way on purpose because an aplanat's cone barely deforms and
   the subject would have been designed away. Its aberration turns out to be
   expressible as an AMBIGUITY in `illumination/source`'s own premise — "one
   direction per diaphragm point" has two natural readings that straddle the
   paraxial value by 5.7% and 5.8% at NA 0.30, closing as NA² — and the cone does
   not merely translate as § 6x models it but STRETCHES, its radius moving 0.0222
   of the objective's pupil over 2.25 mm of field against a 0.0428 translation.
   ~~**Still open here:** feeding that cone into `CondenserSource` per patch~~ —
   **closed at § 6ag**, and the wiring inverted two of the sentences that scoped
   it. Traced BACKWARDS from the specimen point the solve disappears (one trace
   against ninety, inverting the forward fixture to 1e-15), and with it the
   aberration moves out of the sample POSITIONS and into the sample WEIGHTS —
   1.32% of spread on axis, 11.3% at 2.25 mm, worth −0.661% of contrast on an
   identical point set and 2.9× that through the objective's own aberration. So
   § 6p's cache **survives** a shape-changing cone rather than being lost to it
   (289 pupil evaluations against the rigid translation's 35 088), and "patch size
   and source sampling are coupled" is an exact reciprocal: tile span × source
   step is constant to 12 digits, both set by `pupilSamples`, so § 6af's 0.094 mm
   and 0.374 mm patches are that one knob at 32 and 128. The residual failure mode
   is discrete membership rather than continuous drift, and it is scale-invariant
   in the step — refining the source cannot reduce it.
   ~~**Still open here:** image-space telecentricity, which has no caller.~~ —
   **closed at § 6aj**, which grew the exit-side slope this sentence is § 6u's
   own wording of, and shipped as `designs/telecentric` at § 6ar. It carried
   nine steps past the fix here: the deferral was quoted forward as written
   rather than re-read against the ladder. The app half followed at APP.md
   **Part O** (`#/telecentric`).
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
   Two solver conventions composed to make "f/2.3". The boundary ratio is set by the
   **±3·span scan window** — what arrives there is a root **5× hemispherical**
   entering at |c₁|/span = 3⁻ while both real roots are still ordinary glass — and
   the NA it mapped onto was set by the fixed point's **thin-lens seed**, in a closed
   form that predicted the engine's own wall to **1e-11** at four magnifications,
   both orientations and two glass pairs (f cancels, which is why the tube length
   moves it **bitwise** not at all). That exactness was the finding: the *converged*
   design sat ~6% inside the boundary, so the constructor **refused apertures it
   could deliver** — **✅ now fixed at § 6b.5.6, see below**. Also unified: **§ 6q's Plössl wall is this same refusal**, and
   its measured scale-invariance is this same identity — so the repo's walls are
   three kinds, not one (geometric, aberration, solver locus), with § 6d's NA 0.343
   deliberately left unclassified.
   **The third of those was the refusal message, and it is ✅ closed (§ 6b.5.5).**
   The count already discriminated (0 vs 3); the fix derives the sentence from it,
   so the aperture branch now names the aperture and prints how many of its roots
   are past hemispherical, while the glass sentence survives bit-for-bit where it
   is true. **No verdict and no boundary moves** — the extra root is reported, not
   rejected — which is what made it separable from the other two. It also earned a
   correction of its own: the non-physical count is **1 of 3 at the wall and 3 of 3
   at f/1.5**, so § 6b.5.3's "the two real roots are ordinary glass" is a statement
   about the wall and does not travel, and the message counts rather than assumes.
   **The seed was the second of those, and it is ✅ closed (§ 6b.5.6).** A refusal
   mid-iteration is now an *overshoot*, not a verdict: the aperture is held back
   only as far as it takes to read the next object distance off a lens, asked for
   in full again every pass, and the fixed point may close only on a pass that
   built at it — then the hold-back is **bisected back toward 1**, because a
   held-back lens reports the specimen further out (∂ln a/∂ln D ≈ −0.1…−0.2,
   measured) and that bias would otherwise have *become* the new wall. The wall
   now lands on the **converged design's own refusal ratio to 3e-13**, and moves
   out **6.6%→10.6%** (flint first, M = 4→40) and 3.0%→5.7% (crown first). Two
   things are said plainly rather than sold: **no usable aperture was unlocked** —
   the opened band runs 3.45→5.59 waves, 48→78× Maréchal, and the
   diffraction-limited reach does not move at all — and the **closed form is
   gone**, since a and s/f are now the fixed point's outputs, so § 6b.5.4's
   prediction-from-M-alone becomes a self-consistency identity and is kept as the
   *falsified* control (it misses low by 2.9%–9.6%). The witness commit that
   preceded it also caught a one-sided assertion that would have passed at the
   relocated wall. **And the scan window's `3` is the third, ✅ closed as well (§ 6b.5.7).**
   `solveBendings` rejects bendings with |c|·(D/2) ≥ 1 before it counts them — the
   sanity filter `designs/lister` already applies in two dimensions — so the count
   is a count of LENSES and means what the message says. **The window constant
   becomes inert** over ±2 … ±5: the surviving root set agrees to 1e-14 while the
   raw count still moves with it (the scan's 2000 samples are laid across the
   window, so detection resolution still scales with it — what is gone is the
   window deciding the boundary). **F\* moves** (1.9042573 → 1.8372723 at
   s/f = 5; 1.9175107 → 1.7397236 at infinity) and **changes kind** — what binds is
   a real bending reaching a hemisphere, so this wall and § 6q's leave the
   "solver locus" column of the taxonomy for the geometric one, and § 6b.5.2's
   thickness homogeneity is falsified with them (×2 and ×3 now move the locus by
   under 2%). The DIN walls go **out** flint-first (+4% to +10%) and **in**
   crown-first (−7% to −8%): that second direction **refuses designs that used to
   build**, the ones where only one of the two SA-null bendings was a lens, and
   the cost is stated rather than argued away — bounded at 41× Maréchal, since σ
   rises with NA and the refused band cannot be measured where it was refused.
   Downstream it moved § 6q's Plössl wall (0.899195 → 0.9615248·f_e, still exactly
   scale-invariant) and § 6d.4's negative control (0.2608 → 0.2874), both edited
   in the same commit. **No usable aperture either way**: the band gained is
   78–106× Maréchal and the diffraction-limited reach does not move.
   *Composing an eyepiece onto the
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
   NA 0.10 to 3.9 µm at NA 0.95. **Open:** index mismatch and the correction
   collar — the off-axis plate terms are ✅ § 6y and the infinity-corrected
   member's slip is ✅ § 6z, where the "wiring" this line promised turned out to
   have three consequences it did not.
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
   traced chief ray, so distortion is carried and § 6h's then-unbuilt warped-grid
   rasterizer is not needed — which is exactly what a stained-tissue field would
   need. Both halves of that sentence have since been built: § 6n's rasterizer
   for a transmittance, and § 6as's `imaging/emitter-density` for an emitter
   **density**, which is the one that needs det J because a density moves flux
   between pixels when a transmittance does not. **No verdict is minted** (§ 6f.9's asymmetry, stated: incoherent imaging
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
   clear-aperture wall is **0.9615248·f_e and a constant** (0.899195 until § 6b.5.7
   stopped the doublet's bending scan counting a root no glass can be bent to),
   exactly scale-invariant from f_e 15 to 50, and the droop below that is the
   form's own air-gap floor `max(0.3, 0.02·f_e)` rather than the design — forcing
   the gap to 0.02·f_e makes every focal length read the constant to six digits. The **negative control can
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
   walls out again — a computed Plössl admits ~0.96·f_e of clear aperture (**the
   bracket the panel above bisects to 0.9615248·f_e**), so FN 20 sits inside it and
   a genuinely wide field needs the transcribed patent members
   rather than a wider aperture on this form. That is the fourth wall of its kind,
   after § 6b's f/4.1, § 6d's NA 0.343 and § 6e.4's NA 1.411 — **and § 6b.5 later
   identifies it as literally the same wall as the doublet's aperture refusal,
   which is why it is scale-invariant in f_e; § 6b.5.7 then moved both together,
   0.899195 → 0.9615248, which is that identity paying out** — and the panel adds
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
   **Open:** the chromatic half, correcting the objective *for* a depth
   (§ 6c's `targetS1Mm` route, which is what a collar physically does), § 6s's table
   under a moved conjugate, and TIRF — 6l.3 stops at "the rays do not exist", and
   what happens past n_s is a real modality and not geometric optics.
   *Off axis was the first of those and is now* ✅ **closed at § 6y** — and it
   closed with a correction to its own reason, which had expired before it was
   written. "The object-space ray aiming that would express it is § 6a's standing
   blocker" stopped being true at § 6u, and the sentence went on standing in
   `depth-aberration`'s header, in `lister`'s, and in VALIDATION, because no
   structural check can see a comment that quietly stops matching the engine —
   which is APP.md's Part F lesson arriving in `core` instead of in a document.
   What was really missing was narrower and was a fact about the module: every
   stack form takes the invariant as a bare **radius**, and a radius cannot
   express coma. **The step adds no physics.** A plane stack is symmetric about
   its own *normal* rather than about the beam, so the wavefront stays `W(|q|)`
   and tilting the bundle only moves the pupil's disc of invariants off the
   origin — a quartic on a displaced disc is not a quartic in ρ, and what falls
   out is the classical plane-parallel plate set in the ratio **1 : 4 : 4 : 2 : 4**
   on one coefficient, converging from the exact form at fourth order (4.09 then
   4.02). Three things nothing predicted. **The headline is invariance and not
   zero:** on the telecentric preset the chief invariant is a *bitwise* zero at
   every field height, so the slab's wavefront is the same wavefront across the
   field — while the spherical part stays at full strength, so "telecentricity
   fixes the coverslip" would be false. **What it costs is one ratio with no glass
   in it** — coma over spherical is `4·q_c/NA`, so it is geometry: 8.7e-2 at
   0.1 mm on the rim-stopped DIN and **0.87 at 1 mm**, where the plate's coma is
   87% of its spherical term on the lens whose plate contribution § 6c pinned as
   negligible on the axis (both stay four orders under Maréchal, so § 6c's verdict
   survives the off-axis half rather than having been about the axis). And **the
   aperture ceiling stops being an aperture**: § 6l.3's wall is a statement about
   the invariant, so off axis it cuts a **crescent** on the field's own side
   rather than an annulus — an apodization, whose PSF is not that of any circular
   pupil, and which nothing yet transforms.
   *§ 6c's last deferral was the other one, and it is now* ✅ **closed at § 6z** —
   the infinity-corrected objective can be corrected for the cover glass it works
   under, which § 6c had written down as wiring. The move is the same one the DIN
   makes and three of its consequences are not. **The specimen is inside the
   plate**, so what the chain crosses is one face and the aberration is set by the
   depth below it — which means a plate laid anywhere else reports a *different*
   plate (1.90× the truth a tenth of a millimetre out, 9.96× at one, 403× against
   the glass), so the air gap and the correction target are one fixed point rather
   than two steps. **§ 6w's oversized element changes what currency the target has
   to be quoted in**, and quoting it in the beam's instead of the glass's would
   have left 77% of the plate uncorrected while every readout still said the pair
   was stigmatic. **And the headline is a contrast with § 6w:** there the oversize
   was a ratio the magnification cancelled out of, so the 4× and the 40× were one
   lens scaled; a 0.17 mm coverslip is the one thing in this branch that does not
   scale, so nothing cancels and the price is **linear in M** — the same absolute
   correction asked of every member, against a lens ten times smaller having a
   tenth of a Seidel sum to pay with, so the bending moves ten times further and
   the aperture ceiling gives up ten times more (0.0123% at 4×, 0.1224% at 40×).
   That is why a correction collar is a high-power fitting. Two more. Being the
   first caller to put a specimen in *glass* behind a telecentric stop found a
   **defect in a shipped function** — the entrance pupil's slope aperture assumed
   the object and the stop share an index, so an objective labelled NA 0.10
   delivered **0.152** — and the giveaway was not silence but two readouts
   disagreeing: the trace lost half its pupil while the NA readout went on
   reporting the wrong number, so the symptom pointed at the glass. And § 6y's
   own open item closes with its reasoning revised: the chief invariant through a
   real stack is the lens's own **bitwise** when the objective is telecentric, and
   departs as the *square* of the field when it is not.
   *The row band:* ✅ **done** (§ 6aa) — the branch's second spent optimisation,
   and unlike § 6p and § 6s it was not on any list. It came out of profiling the
   shipped brightfield panel rather than out of a predicted cost, and what it
   found is **architectural rather than physical**: every wave-layer caller fills
   a box and transforms a grid, so the headroom those grids exist to provide was
   being paid on rows that hold nothing. At the panel's own 32-in-128 that is 95
   rows of 128, and `wave/psf` is worse — `padFactor` 4 means three quarters of
   its row pass is a transform of zeros. Skipping them is not an approximation:
   bit-reversal permutes zeros to zeros and every butterfly reads 0 ± 0, so
   § 6aa's rungs are `toEqual` on whole `Float64Array`s at three call sites,
   against references built with **no box and no band at all**. **The API choice
   is the finding.** A band wider than what was written is merely slow; a band
   narrower silently drops signal and returns a plausible wrong image — so the
   callers do not derive the band from bounds they believe, they *record* rows as
   they write them, and the hull that comes back is a superset by construction.
   § 6aa.5 is the case where derived and recorded differ. The measured saving is
   a fraction of the *transform*, so it lands exactly where § 6p's cache does
   nothing: the Abbe sum on an ideal pupil goes **125 ms → 80 ms** where § 6p's
   own null half reported no saving at all, and the traced render moves least
   because there the bill is still the tracing. **Open:** the input is sparse in
   both axes and only rows are skipped — a sparse-input transform is a different
   algorithm and would want its own identity rungs.
   *The condenser at an S on no lattice:* ✅ **done** (§ 6ab) — § 6p's cache,
   finally reaching the surfaces a reader opens. It had never once been taken
   there: both brightfield panels call `diskSource`, because
   `commensurateSource` derives its point count from S and so **throws on any S
   that is not on the lattice**, and a panel whose subject is a continuous dial
   could not pay that. **The obvious fix is provably worse than it looks.** The
   panel's central demonstration lives in a window of S *one lattice cell wide*
   (0.3125 to 0.3438, which is 10/32 to 11/32), so a snapped slider cannot land
   strictly inside it — snapping does not degrade that demonstration, it deletes
   it. What the cache actually needs is only that the DIRECTIONS sit on the
   lattice; S enters through the disc mask alone. So `latticeDiskSource` fixes
   the grid and lets S be free, and the count follows from the spacing as a
   consequence — which is also the physically natural reading, a lattice step
   being a fixed angular density where a fixed count oversamples a small
   aperture and undersamples a large one. **Three findings.** The decoupling is
   **free per direction**: 197 lattice directions read 1.15e-2 on § 6f.2's
   metric against `diskSource`'s 177 at 1.29e-2, so § 6p.6's accuracy-neutrality
   survives being generalized. The panel gets **more converged and faster at
   once** — 197 directions in 144 ms against the shipped 97 in 236 — while the
   *ideal*-pupil half goes the other way (163 against 90 ms), which is § 6p's
   null half reproduced exactly: what was removed is the tracing, and twice the
   directions cost twice the transforms. And the cutoff gap the third curve
   exists to show turns out to be a **divisibility law** — empty exactly when
   the step divides cycles − pupilSamples/2 — so `stepMultiple` 1 has no gap at
   *any* frequency and every power-of-two step dies together at a quarter of the
   slider. An odd step is what rescues it, and the law is pinned as a closed
   form so the panel greys out a dead one instead of leaving a reader hunting.
   **The rung also caught a rounding in its own measurement**: at one ulp below
   a lattice radius `1 + S` rounds up onto it while the disc mask does not, so
   the sweep and the law disagreed until the comparison lost its addition.
   **Open:** the *phase* panel takes `diskSource` on the same argument and is
   deliberately untouched — its teaching has not been audited, and switching it
   on the assumption that A2's reasoning transplants is the move this step's own
   history argues against.
7. **Teaching layer + polish** — ✅ all three items landed
   ~~Every artifact in the image links to the plot that explains it (coma flare
   → ray fan; purple fringe → chromatic focal shift).~~ ✅ **landed** — APP.md
   Part H, routes `#/rayfan` and `#/chromatic`, plus the link between them:
   neither destination plot existed, and the sender is the step-4 star page where
   both named artifacts live. The link carries the sender's sliders, because a
   plot that opened on its own defaults would explain a *different* lens while
   looking exactly as convincing — there is no exception to throw and no pixel to
   compare, so the wire format is checked field by field and a link that does not
   decode says so in red rather than falling back quietly.
   **What the step is actually worth is that it falsified the page it explains.**
   `telescope.tsx` said in print that the field's coma tails "point radially
   outward"; on this achromat they point **inward**, and three measurements agree
   — the fan's even half is negative at the rim, the traced wavefront PSF puts its
   centre of light 2.524 µm on the axis side of the chief ray at 1.13° against the
   geometric centroid's 2.510, and the stars in the rendered frame sit 5–7 µm
   inward of where the renderer placed them. Which way a comet points is a
   property of a lens, not a rule of optics, and the sentence had recited the
   rule. Two smaller corrections went the same way: the fan's on-axis even half is
   the f64 floor rather than a bitwise zero — the *sampler*'s ±ρ are not exact
   negatives, and believing they were had also been silently dropping pairs from
   the split — and the chromatic curve does not cross zero at the wavelength the
   picture is focused at, because that plane is the balanced one and this plot
   draws the paraxial one, the gap being spherical aberration (193 µm on the
   singlet, 24 on the achromat).
   ~~Misalignment (tilt/decenter) scenarios.~~ ✅ **landed** — APP.md Part G, route
   `#/collimation`: in-plane coma against field, and the node a knock takes with
   it. Part G is the **first app surface in that document that was not wiring**;
   its engine prerequisite is below.
   ~~Progressive-refinement tuning.~~ ✅ **landed** (§ 3c.2) — the step's last
   item, and the thing it tuned was a ladder that had already been measured and
   left alone. § 3c.1 found that the doubling levels do not nest — 2×2's four
   centres all sit at one radius that no other grid puts a patch at — and
   concluded the ladder was worth keeping "for what it shows the viewer". That
   is true of the 1×1 preview and false of everything between it and the finish:
   after the radius cache a level costs the radii it ADDS, so an intermediate
   level is a traced wavefront computed, drawn once and discarded. The default
   ladder is now the preview and then the finest grid. **The first frame never
   moves and the finished image lands 26% and 19% sooner** at 3 and 4 patches;
   at 2 the two ladders are the same ladder, so the sky panel's own default is
   untouched and its 1- and 2-patch columns moved only with the machine.
   **What made it safe to remove a level is an identity that was not pinned
   until now** — a level is not a partial accumulation towards the finest, it is
   exactly what the renderer returns when asked for that patch count alone, and
   the preview is now asserted to be that render bit for bit. **Two cheaper
   ladders were declined**, one because dropping the preview where it is not
   free removes the feature rather than tuning it, and one — a preview built on
   the finest grid's smallest radius, free at every patch count — because it is
   not a render anyone can ask for, so nothing could check it against anything.
   **And the parity turns out to cut both ways**: an odd grid gets its preview
   free but also spends a patch on the axis, where the PSF varies least, so 3×3
   measures *worse* than 2×2 against a converged reference. The free preview is
   not a reason to prefer an odd count, which is the opposite of what the cost
   arithmetic alone would have said.
   *Misalignment's engine prerequisite is ✅ closed* (§ 1.5.3, real ray aiming).
   It was not on any list: a misalignment MOVES the aperture stop, because the
   local coordinate chain carries a perturbation to every surface after it, and
   the paraxial pupil the aim targets is computed on a twin that has dropped the
   perturbation — so the chief ray missed by very nearly the whole displacement,
   at every field alike. Pinned on two rigid-motion identities (an instrument
   moved sideways, and one turned) plus § 0.2's independently-solved aimed ray.
   **The step also corrected its own premise.** It was taken because the pupil
   error had the same field-constant shape as the misalignment being measured —
   true, but the artifact turned out to live in the CURRENCY rather than in the
   aim: `OpdMap.rmsWaves` removes piston alone, so a misaligned system's
   wavefront carries a reference-frame tilt that is not image degradation.
   Balancing the wavefront removes ~320× of it and the new aiming a further
   1.7×. What the step is actually worth is the exact translation identity —
   1.5e-4 waves to 3e-12 — and pupil coordinates that mean what they say off the
   nominal axis.

   *With that, every numbered step in this build order is closed, and so are the
   three items it left parked.* **What is open now is three things and none of
   them is an engine step:** the telescope scenes' *content* (§ 5 above — an
   albedo map, lunar terrain, a real limb-darkening coefficient, which is
   measured data to source rather than code to write); ~~§ 6x's two deferrals, the
   DIN objective's telecentricity and the condenser's own aberrations~~ — **the
   first closed at § 6ae**, the second's own first half at **§ 6af** and its
   second half at **§ 6ag**, where the traced cone went into `CondenserSource` per
   patch — backwards, which put the aberration in the WEIGHTS and *restored*
   § 6p's cache instead of costing it; ~~**what the phase panel should print
   for its 2ν contrast above S ≈ 0.9**~~ — **closed**, at § 6ab.12 (the readout
   was printed where the harmonic cannot exist, and the fix is a geometric gate
   with no threshold in it), § 6ab.13 (the grating's own orders were folding onto
   the grid, so the object is now built from its spectrum) and § 6ab.14 (how much
   of the condenser carries the harmonic, which the sampled lattice converges to
   under 0.74/samples and not monotonically — 0.55 until § 6ab.17 asked every
   count rather than eleven); and the v2+ list further down. The
   v1 cut after this is what decides whether this is shippable. The panel's own
   half landed with § 6ab.14: it prints how much of the condenser's area carries
   the harmonic beside how much of its weight the lattice puts there, so the
   refusal names how thin the set it missed is instead of only pointing at a
   slider.

   *The three parked items, and why each is recorded rather than struck.* All
   three were written down where they were found instead of being gathered into
   a step, and each turned out to correct the sentence that parked it.

   - ~~*The sparse-input transform § 6aa left* — rows are skipped, columns are
     not, and a sparse-input transform is a different algorithm wanting its own
     identity rungs.~~ **Measured and ✅ declined at § 6aa.8.** Recorded because
     the reason `math/fft` gave for stopping at rows was wrong: it said each
     transformed row is dense across all n columns "so every column has to run",
     which is true of a row's *values* and beside the point, since a column's
     *inputs* are still mostly zero — the thing a pruned transform exploits. What
     stops it is arithmetic. A radix-2 stage collapses only where the zeros are
     an **aligned** block and every caller here writes a **centred** one, so the
     whole skippable stages are ⌊log₂(n/count)⌋ — at both shipped grids that is
     **1**, not the 2 the 4× padding suggests, because the pupil's inclusive hull
     is one row past a quarter of the grid. Realigning a cyclic block to earn a
     stage is a phase ramp over the output, n² complex multiplies: **0.210 ms
     against the one stage's 0.208** at n = 256, a wash by arithmetic rather than
     by luck, netting 5.5% at n = 128. And the transform pair is ~4 ms of the
     17 ms step containing it, so the best case is ~0.4 ms of ~17.

   - ~~*The phase panel's condenser § 6ab deliberately did not switch* — its
     teaching has not been audited, and assuming A2's reasoning transplants is
     the move that step's own history argues against.~~ **Audited at § 6ab.9 and
     ✅ declined**, so that history was right and it is now the measurement
     rather than the suspicion. The panel is ideal-pupil *by design* (A3: tracing
     it would replace an exact null with a small number nobody can tell from a
     bug), which puts it in § 6p's null half exactly — no tracing for the cache
     to remove, and twice the directions is twice the transforms: 57 ms to 349 at
     S = 1. The switch would fix the null's precondition and nothing observable
     (`diskSource` is centro-symmetric only to rounding, 2.2e-16 at S = 1, and
     the measured null is 1e-16 either way), and it could not have been a
     straight swap regardless: below one lattice cell the source collapses to a
     single point, so the S slider would show the coherent limit for its first 6%
     of travel. **The audit's real finding is the open item named above** —
     § 6ab.10. The panel prints the 2ν contrast to six digits and that number is
     not converged over the top ~40% of its own slider: samplings of the same
     source agree to 1.06× at S = 0.6 and disagree by 9.75× at S = 1, staying
     5.8–42.7× apart above it. Not coarseness — a lattice at step 3 with fewer
     points, coarser spacing and a worse rim reach lands within 3% of the
     797-point answer, while the disc's own refinements scatter by 2× among
     themselves out to 5 169 points, because the quantity is set by what happens
     where the shifted pupil is tangent to the objective's. The shipped reading
     is an order of magnitude outside that scatter. What the panel should print
     instead costs a second render to decide, so it is left open rather than
     guessed at. **Answered at § 6ab.12, and the framing was wrong**: the
     question is not how much scatter is tolerable but whether the harmonic
     exists at the setting being read, which is geometry and needs no threshold
     and no second render. § 6ab.14 then measured what fraction of the condenser
     carries it, so the scatter has a reference: the lattice converges to that
     area under 0.74/samples, and not monotonically. (0.55 until § 6ab.17: that
     constant was measured at eleven counts and n = 17 reads 0.7373/n. The
     envelope over the range is n^{-4/3}; no rate is claimed.)

   - ~~*The discarded diffraction PSF § 3c.2 found inside `adaptivePsf` at
     geometric weight 1.*~~ **✅ closed at § 3c.3.** Recorded here because § 3c.2
     got its *reach* wrong in the same way this file's own accounting did above:
     it called the discard "available to whoever needs it", and **two shipped
     panels need it**. The star panel's singlet canvas at its maximum aperture
     runs 3 of 9 wavelength planes at weight exactly 1, and the tolerance panel —
     which samples the pupil half as finely, doubling the criterion for the same
     wavefront — runs 3 of 5, twice per job. It stayed invisible because the
     achromat, the lens this app is built around, never leaves weight 0 at any
     aperture the panels offer. The fix is a change of order and nothing else:
     the criterion is measured on the traced samples, so it is settled before any
     transform exists, and asking `psf()` for it was forming a transform to learn
     something already decided. Pinned as deep-equality identities against the old
     composition at all three regimes, with the skip witnessed by a grid the FFT
     refuses. **What it is worth is not the time** — the removed work is 18–21 ms
     per plane where it applies, ~3% of the two frames that reach it, and the ray
     branch's own run-to-run spread is larger than that — but that at weight 1
     the array being discarded is an FFT the criterion has just ruled is aliasing
     rather than diffraction.

8. **The light budget** ← *opened 2026-09-02; the first step whose every
   number is absolute.* Everything before it was a ratio: a blackbody
   normalized to peak at 1, an exposure that was a cone over a cone, a noise
   draw that could not be made because there was nothing to draw from.
   *The zero point:* ✅ **§ 8a** — `photometry/magnitude`. AB = 0 is 3631 Jy by
   definition (Oke & Gunn 1983), so the pin that reaches outside the engine is
   Vega: the textbook 1000 photons·s⁻¹·cm⁻²·Å⁻¹ for a V = 0 star comes out at
   996, inside the published 0.02 mag AB−Vega offset. The result worth carrying
   is that **a band's photon count is a closed form in the magnitude alone**,
   (f_ν/h)·ln(λ₂/λ₁), for any spectral shape — so no quadrature over a blackbody
   decides how bright a star is, only where its photons fall.
   *The draw:* ✅ **§ 8a** — `math/random`'s `poisson` (Knuth below 30, Hörmann's
   PTRS above, both exact) and `imaging/noise`'s `shotNoise`, pinned as
   variance = mean at six means across the seam and √N on a flat field.
   *A magnitude through a pupil:* ✅ **§ 8a.6** — `collectedPhotonRate`, § 5s's
   traced grasp times the zero point, with § 5s.5's refusals intact: a pupil
   that is not an area has no photon rate.
   *Next here, in order:* the **sky** in mag·arcsec⁻² through § 5r's plate
   scale (a closed form, no new physics); the **noisy hero frame** (imaging and
   app wiring on the route written on `imaging/noise`); the **limiting
   magnitude** that falls out of the two. Extinction, filter curves and quantum
   efficiency are declared multipliers and arrive as data, not as physics.

## v1 cut (both branches shipped)

- ~~Bench editor over the prescription schema; exact + paraxial tracing; glass
  catalog.~~ ✅ **landed** — route `#/editor`, APP.md Part E. All three clauses:
  a row per surface, both tracers reported side by side without either being
  converted into the other, and the media read off `materials/catalog` itself.
- Analyses: spot diagram, ray fan, chromatic focal shift, PSF/MTF, Zernike
  readout, distortion/field curvature. **The ray fan and the chromatic focal
  shift now have surfaces of their own** — step 7's teaching layer needed them as
  destinations (APP.md Part H), and both were wiring on `analysis/spot` and
  `analysis/focus` rather than new capability. **The spot diagram now has one
  too** — APP.md Part I, route `#/spot`, wiring on the same two modules. Recorded
  here rather than only in APP.md because the panel found a **defect in its own
  shipped range**: the shared plot box reduced with `Math.max(...allRays)`, which
  is 42,300 *arguments* at the densest setting the panel offers, and probing past
  it took the stack out. The panel's own finding is that a spot diagram
  misdescribes a **good** lens rather than a bad one — 0.013× the Airy radius on
  the f/25 achromat — and that the engine's geometric switch does **not** answer
  that question and visibly parts from it (7.46 Airy radii of spot at
  `geometricWeight` 0.00), because `wave/fidelity` measures phase change per pupil
  sample and not total wave error. **The Zernike readout now has one too** — APP.md Part J,
  route `#/wavefront`. Recorded here because it settles a question the engine
  poses and never answers: `fitRms` and `balancedRms` are both "RMS wavefront
  error" and **neither is the one Maréchal's Strehl formula wants**. Piston and
  tilt out with **defocus kept** reproduces the traced Strehl to four digits;
  keeping tilt is three orders wrong off axis (0.0003 against 0.4002) because a
  tilt shifts a PSF rather than dimming it; removing defocus is 6.3× wrong
  wherever defocus is real (0.9633 against 0.1523). The panel also pins a **fit
  leak** nothing had looked at — on axis the non-symmetric terms come back at
  ~1e-7 rather than the f64 floor, identified as the fit over a discrete pupil
  rather than an asymmetry by its equal x/y partners and its cubic growth.
  **Distortion/field curvature now has its rungs** — VALIDATION § 6ac,
  `analysis/field`, and it was an engine step exactly as predicted. **The brief's
  own premise was wrong in one load-bearing word:** it said `seidelSums` "already
  produces the two coefficients independently", and it did not — the module's scope
  note said in as many words that S_III–S_V were not computed, "an unpinned formula
  is worse than an absent one". So the step began by adding them, which turned out
  to be the better half of it: at a stop in contact the closed forms are
  S_III = H²φ and S_IV = H²Σφ/n with **no shape factor at all**, so a bending scan
  that moves S_I 8.6× must leave both unmoved — a sharper anchor than the single
  number that was expected. Both pre-checks the brief demanded came back clean and
  neither was close: the astigmatic interval is 2.1e8 ulps above the f64 floor, and
  both sags come out negative with the tangential further, so the sign-blind 3:1
  ratio (measured 2.9948) is now flanked by assertions it cannot fake. What the
  brief did not foresee is that **both** of the step's real hazards were in the
  measurement rather than the physics — a reference plane traced with a different
  fan density is 59× the signal, and reading distortion at the best-spot plane
  instead of the paraxial one is 13× — and both are now refused by the API rather
  than documented. Distortion is pinned as far as it can be reached without
  stop-shift equations: the published zero for a thin lens with the stop in
  contact, plus the traced achromat's own cubic against its S_V.
  **What is left on this line is one:** the
  optical MTF — `core/wave/mtf` has no caller anywhere in the app, and the camera
  panel's MTF is the sensor's. ~~That one is wiring.~~ **It was not**, and the
  engine half is now ✅ closed at § 6ad, recorded here because the sentence above
  was wrong in the same way § 6ac's brief was: an entry called wiring turned out
  to be an engine step, and for a reason the module had written down and nobody
  had read. `wave/mtf` had promised since it was written that the
  tangential/sagittal split was "a separate function when field curvature work
  arrives" — which is § 6ac, one entry earlier on this very line. Off axis those
  two sections part by 1.5× on the achromat, and the azimuthal average that
  existed instead is **not even bracketed by them**: a panel drawing the average
  would report a contrast no orientation of a bar target gets. The direction is
  pinned by three machineries agreeing rather than by one number, and by a
  stop-at-the-centre-of-curvature mirror that is 0.75 waves out of round and
  still splits by 1e-4. **And it found a false sentence in the module it was
  reading**: the MTF cutoff landing at exactly `pupilSamples` bins was called "a
  strong internal check on the whole pupil→image scale", and it is not one,
  because the scale is built from the aperture that was ASKED FOR and the array's
  support is the aperture that TRANSMITTED. On the app's own f/10 doublet those
  differ by 27% — APP.md Part B's aperture wall, arriving as a curve that falls
  off a cliff at ν = 0.73 while the readout still prints 170.27 c/mm. **The panel
  is now ✅ landed too** (APP.md Part K, route `#/mtf`). ~~And with it this whole
  line closes: all six v1 analyses have a surface.~~ **That sentence was false when
  it was written, and correcting it is why this line has one more entry.** Five
  analyses had a surface. The sixth — distortion/field curvature, § 6ac, the entry
  *immediately above* on this very line — had no route, no panel, no APP.md part,
  and no caller of `analysis/field` anywhere under `packages/app`. **The same
  error is stated twice on this line**, which is what makes it worth this much
  space: "what is left on this line is one: the optical MTF" is the first
  statement of it and was already wrong when written, since § 6ac is described
  three sentences earlier in this same bullet with no panel; "all six have a
  surface" is the second. Both were written from the step that landed *after*
  § 6ac, and both counted the entry in between as though its panel had arrived
  with its rungs. **It is now ✅ landed** — APP.md Part L, route `#/curvature`,
  app wiring only — and *now* the line closes. Recorded at length rather than
  quietly struck, because the failure was in this file's own accounting rather
  than in any panel or any rung, and because the check that would have caught it
  is cheap and was never run: a capability this file marks as surfaced should have
  a route in `panels/registry.ts`. What the panel found is that the achromat —
  this app's whole demonstration, the lens that fixes the singlet's colour and its
  spherical aberration — **does not flatten the field**: at 1.6° its tangential
  surface is 1.6% further inside focus than the singlet's and its Petzval surface
  8.1% further, because Petzval is a sum of element powers over their indices and
  correcting colour by adding glass adds power to sum. What it *does* correct is
  the **chromatic variation** of it, 2.1% of the Petzval sag across the F-to-C
  band falling to 0.26%. In the units that decide anything, both lenses put the
  corner of a ±1.6° frame **12 quarter-wave depths of focus** out at f/10 and 2 at
  f/25 — stopping down fixes it without flattening anything, since the depth of
  focus grows as the focal ratio squared while these surfaces, measured across
  EPD 20 → 120, move 0.63% on the singlet and 0.04% on the achromat. And § 6ac's
  refused plane parameter is worth far more here than on the fixture it was
  measured against: **218×** the signal on the achromat and **942×** on the
  singlet, against the 13× the module records. It corrected one more thing,
  and the thing it corrected was its own first draft. The complaint it set out to
  make about the azimuthal average — that it runs over the 45° directions and so
  sits BELOW both sections, reporting a contrast no bar target gets — measured
  0.015 and was **the binning**, not the optics; through a fine enough profile it
  is 3e-5. What is actually wrong with an average is that the two sections are
  0.28 apart and it reports one number for two. The coarse binning that produced
  the wrong story was itself an engine sharp edge — empty annuli falling through
  to zero contrast, which read as four times the real effect *in the same
  direction* — and `mtfProfile` now refuses a bin count it cannot fill.
- ~~Hero image simulation with progressive refinement (instant on-axis preview,
  background full-field render).~~ ✅ **landed** — the background render is the
  worker each panel posts to, and the on-axis preview is the ladder's first
  level, tuned at § 3c.2. One word of the clause is now known to be wrong and is
  worth leaving visible: **"instant" is a property of the optic, not of the
  preview**. On the mirror it is 0.2 s; on the doublet the same one-patch frame
  is 2.1 s, because a traced doublet wavefront costs ~0.4 s a wavelength and the
  preview pays for five. Nothing in the ladder can fix that — one patch has one
  radius, so there is nothing for the cache to share — and the two levers that
  could (fewer wavelengths at the coarse level, an off-axis kernel reused from
  the finest grid) were both measured and both declined, at § 3c.1 and § 3c.2
  respectively, for reasons that are about honesty rather than cost.
- Mechanical compatibility (barrels, threads, parfocal/back-focus) feeding
  back into optics.
- Telescope: presets above, seeing, eyepieces, visual + camera modes.
- Microscope: brightfield + fluorescence, immersion, coverslip mismatch.

### The six analyses, and the route each claim is pinned to

**Why this table is here and not only in APP.md.** The analyses bullet above says
twice, in different words, that a set of analyses has surfaces — and both times it
was counting an entry whose panel had not arrived. The sentence was prose, so
nothing could check it. This is the same claim in a form a test can read: a row
marked ✅ **must** name a route that exists in `packages/app/src/panels/registry.ts`,
and a row not marked ✅ must name none. `packages/app/test/surfaces.test.ts` pins
it. Had it existed one commit earlier, the distortion/field-curvature row would
have had to be written not-✅ — one line above a sentence claiming the opposite —
or name a route that did not resolve.

| Analysis | Surfaced | Route |
| --- | --- | --- |
| Spot diagram | ✅ | `#/spot` |
| Ray fan | ✅ | `#/rayfan` |
| Chromatic focal shift | ✅ | `#/chromatic` |
| PSF / MTF | ✅ | `#/mtf` |
| Zernike readout | ✅ | `#/wavefront` |
| Distortion / field curvature | ✅ | `#/curvature` |

## v2+

- Rigorous partial coherence (Hopkins TCC) → phase contrast, DIC.
- Non-sequential engine: ghosts, internal reflections, stray light (the
  architecture commitments keep this a new scheduler, not a rewrite).
- Thin-film coatings, polarization physics.
- More catalogs (glasses, patent-derived eyepieces/objectives).
- **Design mode**, which is two items and was one bullet. Strongly
  differentiating either way — no other web optics sim lets you *design*.
  - ~~Curvature/thickness solves ("make EFL = X").~~ ✅ **landed**, in the engine
    (`analysis/solve.ts`, VALIDATION § 1.7) and now on a screen too (APP.md
    Part M, route `#/design`). It is still not a row in the analyses table above,
    because that table is the **v1** cut and this is a v2+ entry; the row that
    checks this claim is Part M's in APP.md's own table. One word of the original
    clause is now known to be wrong and is worth
    leaving visible: **"generalizing" the focus solve is not what happened**.
    `bestFocus` minimises a merit and a design target is a root, so nothing in
    its bracket-and-golden-section transfers; the two live side by side rather
    than one inside the other. What the step actually bought that was not
    forecast is three refusals — a stated search interval, so a target reachable
    two ways *reports* both instead of the solver picking one; an EFL pole
    rejected as a sign change that is not a root; and a scan cell holding two
    roots holding none, measured rather than left to be discovered.
    *Recorded here rather than only in APP.md because the panel carries a
    finding back to the ladder and a number back to it:* **the wall § 1.7 could
    only pin on synthetic closures is reachable from an ordinary design
    question.** "Which value makes this system afocal?" converges *onto* the
    wall by construction — the hole is 5.615e-12 mm wide in that fixture's gap,
    measured edge to edge, against a refinement width of 2.13e-13, 26× narrower
    — so the engine refuses and names the place, where § 1.7 had reasoned that a
    64-cell scan meets |u| < 1e-15 with probability zero. It does; a bisection
    aimed at it does not. The number is
    that same fixture's afocal gap, described in two places as ≈ 9.67 mm and
    measured at **9.0159878 mm**; no rung asserted it.
  - ~~Damped least squares over a few variables.~~ ✅ **landed** in the engine
    (`analysis/optimize.ts`, VALIDATION § 1.8). Both candidate merits survived
    contact and both are pinned — thin-lens bending for minimum spherical (the
    Coddington shape factor, *recovered* by the optimiser rather than evaluated)
    and the achromat's crown/flint power split, on a zero-thickness fixture
    where both residuals reach exactly zero so the answer does not depend on the
    weighting. **It is now on a screen too** — APP.md Part N, route
    `#/optimize`, app wiring only and no rung of its own.
    *Recorded here rather than only in VALIDATION because the step's sharpest
    finding is about the tool and not the physics:* an optimiser always reports
    that it converged, and this one is measured doing it while wrong by 400 mm.
    Asked to move a doublet from −76.5 mm focal length to +150 mm, the run in
    **power** is exact in five iterations; the same question in **millimetres of
    focal length** slides the other way to EFL → 0 and stops with its gradient
    test satisfied, because 1/f runs through ±∞ in between and a downhill method
    does not cross barriers. It never touches the afocal wall it failed to cross
    — zero rejected steps — so the guard § 1.7 needed is not the guard this
    needed. What Part M forecast is confirmed on the way: holding a correction
    while moving a focal length is exactly a merit over several variables, and
    a single curvature spends 29× to 240× of the achromat's colour correction
    doing it alone.
    **§ 1.8.5 has since added TRACED targets** — `optimizeSystem`, an RMS-spot
    operand, and two more external numbers: a paraboloid recovered to 1e-12 in
    conic and a spherical mirror's centre of curvature recovered to 2.3e-6, both
    exact conjugates at every aperture and to all orders. *The finding to carry
    out of it is that the bullet it closed was wrong about the mechanism and
    about the size, and right that something would bite.* A traced merit carries
    no sampling noise at all against a fixed ray set — it differences cleanly
    over ten decades of step — and it costs 430× a third-order sum rather than
    the forecast four orders. What it does carry is one genuine discontinuity
    nobody had named: a ray entering or leaving the surviving set moves the merit
    **6.30% across a step of 1e-12**, and on the fixture that shows it the cliff
    sits 8e-5 from the optimum. The set is therefore held, which is `seidelS1`'s
    fixed ray height one level up. Second finding, on the ladder rather than the
    physics: the first convergence ladder shrank the aperture while scaling the
    glass with it and would have recorded a clean h² approach to Coddington's
    shape as the aperture's doing. Held apart, the aperture's part is 4.29e-4 and
    the glass's is −5.256e-4 per millimetre, and **the glass was carrying five
    sixths of it.** Still no surface — see APP.md Part N, where the missing piece
    is now a cost decision rather than a pin.

## Engineering practices to land alongside the code

- ~~**Nothing checks this file's claims against the app.**~~ ✅ **landed** —
  `packages/app/test/surfaces.test.ts`, plus the two tables it reads (APP.md's
  *Every landed section*, and the six-analysis table at the end of the v1 cut
  above). It is the cheap check the field-curvature miss named and nobody ran.
  The damage table is in the test's own header, and the finding worth carrying
  out of it is which half caught what: reconstructing the tree at `d3c5b79`
  left **APP.md's three assertions green** and failed only on ROADMAP's row,
  because with no ✅ section written there was nothing for a section-to-route
  check to find missing. A registry checked against APP.md could never have
  caught this. The claim had to become a row in *this* file.

- ~~**Golden-image regression harness at step 4**, not step 7.~~ ✅ **landed**
  with step 3b — `golden.test.ts` in both packages, with the committed renders
  beside them and a damage table (VALIDATION § Golden images) proving the
  comparison can fail. The scope note stands as written: a golden image is
  regression, **not** validation — it says the render has not changed, never
  that it was right.
- ~~**One cross-validation against an independent tracer.**~~ ✅ **landed** as
  VALIDATION § 0 — `crosscheck.test.ts` against **rayoptics 0.9.9**, four
  systems (§ 5j's achromat, § 6d's Lister, § 5e's Cassegrain, and a synthetic
  asphere), the fixture committed so `npm test` needs no Python. The scope note
  above is corrected in one word: it does **not** upgrade the other rungs, which
  still assert what they assert; it adds independent evidence for the machinery
  underneath them, which is a different and smaller claim. What made it work was
  comparing the **primitive** rather than the workflow — a ray as a point and a
  direction, ending on the last surface, with every index stated as a number —
  so no pupil, field, aiming, image-plane or glass convention could turn a
  disagreement into an argument about definitions. Agreement is at the f64
  rounding floor (worst case 2.3 ulp on a wavefront, **5.8e-10 of a wave**), and
  the only place it is not is the even asphere, where both sides Newton-iterate
  to their own 1e-12 mm and therefore cannot agree closer — measured at 3.8e-14,
  so both converge ~26× tighter than they promise. **The result worth carrying
  out of it is a sign convention:** the unfolded mirror frame (negative
  thicknesses after a mirror, axis unmoved) is rayoptics' convention too, so the
  two-mirror system reconciled with no mapping at all — the engine's
  highest-risk convention agreeing with an independent implementation, which no
  closed form was going to say. **The second investigation has since been
  done** — VALIDATION § 0.1, seven misaligned systems — and it says the same
  thing twice over. The engine's local coordinate chain, the misalignment
  decision ARCHITECTURE calls out as load-bearing, **is rayoptics' default
  too**, down to the order of the shift and the rotation and to which frame the
  next thickness runs along. What is *not* shared is how a tilt is spelled: this
  engine multiplies Ry(tiltY)·Rx(tiltX) and rayoptics Rx(−α)·Ry(−β)·Rz(γ), which
  for two axes have no angle-for-angle translation at all. So the fixture
  compares **frames** rather than angles, and the whole cost of the mismatch
  turns out to be **half an ulp**, on exactly the one system whose rotation has
  no spelling in the other's parameters. **The third investigation has since
  been done too** — VALIDATION § 0.3, five systems, sixteen in all — and it
  splits the thing that was open into two. A tilted mirror on the DEFAULT chain
  turns out not to be a new convention at all, just a misalignment whose surface
  happens to reflect, so it reconciled the same way the seven refracting ones
  did. The FOLDED chain is a second convention, and the whole of it is **one
  z-flip per mirror**: with D = diag(1, 1, −1), rayoptics' frames are the
  engine's times D^(mirrors before the surface), and every other difference —
  why a curvature and a thickness flip sign behind a mirror while a conic and a
  decenter do not — falls out of what D does to a field. **What is worth
  carrying out of it is that the two programs' fold RULES are not the same
  rule.** rayoptics' `'bend'` applies the tilt rotation twice; this engine
  reflects the frame the light arrived in. Those are identical — residual 0.0 —
  for a tilt about an in-plane axis, which is every fold mirror that is really a
  fold mirror, and they part by **0.88°** for a diagonal misaligned in a second
  axis. Which one follows the light is settled by rayoptics against itself: its
  own ray trace leaves along the reflected frame's axis to half an ulp.
  ~~**Still open:** a *second* independent tracer, which would turn an agreement
  into a majority.~~ **The fourth investigation has since been done, and it was
  the last one this item was carrying** — VALIDATION § 0.4, **Optiland 0.6.1**
  (MIT, lineage checked: no module in it mentions rayoptics, ray-optics or
  Hayford), on the same sixteen systems and the same rays, read verbatim out of
  the first fixture so the three are provably answering one question. So the
  comparison that did not exist before is now available and is the point of the
  step: **rayoptics against Optiland with the engine out of it**, which is the
  only one of the three that can see a convention the engine *shares* with a
  reference. It sees none — worst disagreement 5.7e-13 mm, 9.7e-10 of a wave.
  **What is worth carrying out of it is that the engine's tilt spelling is not
  idiosyncratic.** rayoptics writes a surface rotation Rx(−α)·Ry(−β)·Rz(γ) and
  needed a solved Euler triple; Optiland writes Rz·Ry·Rx, so with rz = 0 it is
  this engine's own Ry(tiltY)·Rx(tiltX), angle for angle, and the generator
  states the two tilts and stops. The fold reconciled a second and simpler way
  too — one **x**-flip per mirror instead of § 0.3's z-flip, which keeps +z on
  the beam and leaves curvature, conic, thickness and asphere coefficients
  exactly as written, collapsing four rules travelling together into one. The
  honest limit is stated rather than glossed: Optiland has **no fold concept at
  all**, so on the folded four it votes on the beam and not on a frame, the
  fixture carries no frames for them, and on the one system whose mirror is last
  there is no fold continuation for anyone to place, so its rays pin the mirror
  and not the chain.

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
