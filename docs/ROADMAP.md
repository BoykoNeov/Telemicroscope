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
5. **Telescope branch + bench editor + mech layer** ← optics landed; still open:
   the mechanical layer, scenes (star/planet/lunar), and the bench editor.
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
   *Off-axis diagonal vignetting:* ✅ (§ 2f). The partial-vignetting case § 2e
   left open, arriving as one `PupilFunction` mask whose criterion is the trace
   itself, so both branches see one aperture.
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
   Still to build on it: the UI this exists for — a slider per tolerance, the
   image degrading as the budget predicts.
6. **Microscope branch** ← current
   Infinity-corrected + classic 160 mm architectures; 4x–100x objectives incl.
   oil immersion ✅ (§ 6e); brightfield ✅ (§ 6f) and fluorescence ✅ (§ 6i),
   the latter now over a 3-D specimen ✅ (§ 6k); coverslip mismatch ✅ (§ 6c);
   scenes: fluorescent beads ✅ (§ 6i.5), with diatoms and stained tissue still
   open.
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
   **Open here:** the 4×
   sitting at f/4.1 — the edge of the cemented-doublet form, and the second piece
   of evidence for the Lister follow-on. *Composing an eyepiece onto the
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
   image, so **energy is not a witness** here either. **Open:** depth-dependent
   spherical aberration (the physics is in § 6c/§ 6e already; wiring focal depth
   into that stack is its own step), deconvolution and confocal — both named by
   the cone rather than built — an axial sampling verdict, and how far the
   quadratic wavefront sits from the exact Ewald cap (sin α against tan α: 2.6×
   at NA 1.40, but living entirely in the object-side z mapping, since the engine
   defocuses an image space where NA′ is 0.024).
   *Still open in this step, and now scoped:* everything above forms an image
   **93.5 µm wide at 4× and 2.6 µm at 100×/1.40**, on the axis, in grey, with no
   eyepiece — a detail crop, and § 6h's own closed form says raising the grid
   will never widen it. Closing that is § 6m–§ 6r, ordered and costed in
   APP.md's Part D. The **off-axis frame** (§ 6m) is ✅ **done** — a tile sits
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
   in the trace. **Open:** the retinal PSF itself, the eyepiece's own aberrations at
   this conjugate, colour, and the exit pupil off axis. § 5j's doublet form also
   walls out again — a computed Plössl admits ~0.88·f_e of clear aperture, so FN 20
   sits at the edge and a genuinely wide field needs the transcribed patent members
   rather than a wider aperture on this form. That is the fourth wall of its kind,
   after § 6b's f/4.1, § 6d's NA 0.343 and § 6e.4's NA 1.411.
   What is left in this step is **polychromatic
   brightfield** (§ 6r), which is what makes a stained section look stained.
   § 6l — depth-dependent spherical aberration — is unchanged and independent of
   all of them, and is now a numbered gap in the ladder rather than a plan.
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
