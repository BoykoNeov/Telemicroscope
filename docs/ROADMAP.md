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
5. **Telescope branch + bench editor + mech layer** ← current
   Presets (Newtonian, achromat/ED refractor, SCT), eyepiece library,
   obstruction/spider diffraction, atmospheric seeing dial, star/planet/lunar
   scenes, visual mode (eye model, exit-pupil matching) and camera mode
   (pixel scale, exposure, shot noise). Mechanical compatibility checking
   with feedback into optical spacings (extension tubes change the image).
   *Prerequisite — tilt/decenter:* ✅ closed. Refracting tilt/decenter already
   existed; what the presets actually needed was the **folded mirror frame**,
   now landed as a per-prescription convention with its own rungs (VALIDATION
   § 4a). An SCT is on-axis and was always expressible; it is the Newtonian's
   45° diagonal — a tilted mirror with surfaces downstream of it — that could
   not be written down before. The same change makes mirror *misalignment*
   place downstream surfaces correctly, which is what tolerancing rests on.
   *Prerequisite — folded pupils/OPD/PSF:* ✅ closed. The unfolded-z →
   world-frame map landed (`core/trace/axis`, VALIDATION § 4a): first-order
   geometry is computed on the `unfoldedTwin`, rays are traced through the real
   folded chain, and one rigid map joins them — so a folded system now images
   instead of throwing. A folded Newtonian is diffraction-limited on axis and
   agrees with its straightened twin on OPD, focus and Strehl.
   *First preset — Newtonian:* ✅ `designs/newtonian` (VALIDATION § 4b). Derived
   from aperture and focal ratio, not transcribed: the diagonal is sized in
   closed form and the off-axis behaviour is pinned to third-order coma, both
   the coefficient and its ∝θ/F² scaling. Writing it turned up two engine
   findings — a tilted flat's footprint in a converging beam is asymmetric, and
   the primary's sag moves the beam diameter 0.25% — plus an inclusive-rim fix
   in the tracer.
   *Spider diffraction:* ✅ (VALIDATION § 5c). The vanes arrive as a new
   `PupilFunction` — one `spiderObscures` predicate shared by the FFT and
   geometric branches — so a reflector's diffraction spikes fall out of the same
   transform the Airy rings do: perpendicular to each vane, 4→cross / 3→six-arm
   star, pinned to the rectangle-transform sinc and the strip-area energy.
   Still to come here: the eyepiece library, seeing, the SCT/refractor presets,
   and off-axis diagonal vignetting (the partial-vignetting `blendPsf` case § 5c
   leaves open).
   *Sourcing:* commercial eyepiece and objective prescriptions are trade
   secrets, but **patents are public and contain full prescription tables** —
   that is the supply route for the eyepiece library, and the validation
   ladder pins against them.
   *Tolerancing lands here, not in v2:* once tilt/decenter exists, perturbing
   every parameter by its manufacturing tolerance and watching the image
   degrade is nearly free, and it is the most educational thing the project
   can show.
6. **Microscope branch**
   Infinity-corrected + classic 160 mm architectures; 4x–100x objectives incl.
   oil immersion; brightfield (incoherent + condenser-NA factor) and
   fluorescence; coverslip mismatch; scenes: diatoms, stained tissue,
   fluorescent beads. Mostly configuration + domain models on the existing
   engine. *Prerequisite:* dispersive immersion media and a coverslip glass
   in the catalog — at NA 1.4 non-dispersive `constantIndex` oil makes the
   branch's chromatic behaviour dishonest.
   *Prerequisite:* **module composition** — a microscope must be buildable from
   whole parts (objective, tube lens, eyepiece) as well as from bare surfaces.
   The design is recorded in ARCHITECTURE § Data model: modules are authoring
   data that flatten into one surface chain, not a second tracer. Step 5's
   eyepiece library is the first consumer, so it may land there instead.
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
