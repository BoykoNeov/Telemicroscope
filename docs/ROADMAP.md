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
   oil immersion; brightfield (incoherent + condenser-NA factor) and
   fluorescence; coverslip mismatch ✅ (§ 6c); scenes: diatoms, stained tissue,
   fluorescent beads. Mostly configuration + domain models on the existing
   engine. *Prerequisite — dispersive immersion/coverslip glass:* ✅ sourced and
   pinned (§ 1) — Daimon-Masumura water, Cargille Type B oil, Schott D263 T eco
   coverslip, so at NA 1.4 the branch rides on measured data. The D263 half is
   now consumed by § 6c. **Remaining is the wiring** (image-space index in
   `pixelScaleMm`), pinned when an immersion objective lands here — though the
   *object*-space index is already carried, since § 6c's specimen sits inside the
   cover glass and the stop is sized against sin u = NA/n.
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
   **Open here:** composing an eyepiece onto the intermediate image; and the 4×
   sitting at f/4.1 — the edge of the cemented-doublet form, and the second piece
   of evidence for the Lister follow-on.
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
   **Open:** the composed objective, off-axis everywhere, the chromatic half (a
   dome is aplanatic at ONE wavelength), and water immersion.
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
- Partial coherence approximated in v1 (condenser-NA factor); exact for
  fluorescence and telescopes by nature.
