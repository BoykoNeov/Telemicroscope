# Architecture

Design record for the Telemicroscope engine. Decisions here were made
deliberately; change them consciously, not by drift.

## Positioning

- **Audience:** all levels — built to the highest fidelity bar from the start,
  with simpler models (paraxial) kept as validation rungs and instant-feedback
  helpers, not as the product ceiling.
- **Platform:** web. TypeScript throughout; no separate prototype language.
- **Hero output:** the simulated image. Engineering plots are the teaching /
  explanation layer, linked from artifacts in the image.

## The hybrid ray + wave pipeline

Neither pure ray tracing (no diffraction) nor pure wave optics (can't handle
arbitrary lens stacks) suffices. The engine uses the standard professional
hybrid:

1. **Sequential exact ray trace** through the prescription → geometry,
   vignetting, distortion, and the **OPD (optical path difference) map** at
   the exit pupil.
2. **Pupil function → PSF:** exit-pupil amplitude (aperture shape, central
   obstruction, spider) × phase (OPD) → FFT → point spread function with
   diffraction. Airy rings, coma flares, diffraction spikes all emerge here.
3. **Image simulation:** per-wavelength convolution of a scene with the
   (field-dependent) PSF, then the detector/eye model — photon noise, sky
   background, eye pupil, retinal sampling.

**Fidelity switch (invisible to the user):** when the wavefront aliases on the
pupil grid the engine falls back to the geometric (spot-based) PSF. Both
derive from the same ray data.

The switching criterion is **phase change per pupil sample**, not total wave
error: the FFT is valid while |∇(OPD)|·Δ_pupil < λ/2 (less than π of phase
between adjacent samples). This depends on sampling density, so a denser pupil
grid extends the FFT's validity — "a few waves" is a consequence, not the
rule. Two obligations follow, both testable:

- **Matched normalization.** Both PSF branches integrate to the same
  transmitted pupil energy (Parseval), so the fidelity switch never changes
  image brightness.
- **Blend band.** The branches are cross-faded over a band around the
  criterion rather than switched at a threshold; a hard switch pops visibly
  when a user drags a defocus or seeing slider across it.

**Polychromatic images** are stacked from ~7–15 wavelength samples weighted by
source spectrum × detector response.

## Precision strategy (web-specific, load-bearing)

The OPD map must resolve **nanometers over ~1 m of optical path** (~10⁹
dynamic range). GPU f32 gives ~10⁷ — not enough. Therefore:

- **Analysis tracing runs on CPU in plain JS** — JS numbers are f64. The OPD
  map needs only ~64×64 pupil rays per field point per wavelength; that is
  sub-millisecond on CPU *provided the system is compiled first* (see below).
  Precision-critical code stays small, dense, and unit-testable.
- **GPU (WebGPU, WASM/CPU fallback) handles f32-safe bulk work:** FFTs,
  per-patch scene convolution, noise, tone mapping, 3D bench view.

**Compiled systems (the hot path).** A `Prescription` is authoring data; the
tracer never consumes it directly. `compile()` resolves it once into a flat
`CompiledSystem` — surface geometry objects, per-surface frames, and a
per-wavelength refractive-index table — and `traceRay` runs against that.

This is not micro-optimization. Resolving geometry and media per ray costs a
geometry object plus closures at *every surface of every ray*; measured on a
6-surface system at 3096 pupil rays, compiling once is **6.3× faster**
(13.5 ms → 2.2 ms per pupil pass, identical results). The remaining gap to
sub-millisecond is Vec3 allocation in the inner loop. Since the full-field
render is (fields × wavelengths × pupil passes), this factor sets whether
progressive refinement feels alive or broken.

**Pupil sampling vs. atmospheric seeing.** These want different grids: the
system's own OPD is smooth and low-order (64×64 resolves it), while a
Kolmogorov phase screen at D/r₀ ≈ 20 needs several samples per r₀ — 256²–512².
Resolving this by tracing 512² rays would be wasteful by two orders of
magnitude. Instead: **trace coarse, fit a Zernike basis, evaluate the fit on
the fine FFT grid**, and generate the atmosphere screen directly at fine
resolution. Consequence for the wave-layer API: OPD is exposed as *a fitted
basis plus a sampler*, never as a fixed-size array.

## Non-sequential future-proofing (three commitments)

Ghost reflections and stray light need a different *scheduler*, not different
physics. The core honors three commitments so that engine can be added later
without a rewrite:

1. **Geometry is traversal-agnostic.** Surfaces expose `intersect(ray)` and a
   local frame; they never know about "the next surface." The sequential
   engine is one consumer; a future non-sequential engine (with a BVH) is
   another.
2. **Interactions compute the full split.** `interact()` returns refracted
   *and* reflected rays with Fresnel energy weights. The sequential engine
   discards the secondary ray — ghost tracing later means "stop discarding."
3. **Full 3D placement.** Prescriptions compile to elements positioned by
   transform chains, not just axial spacings. Buys fold mirrors, tilt/decenter
   (misalignment simulation), and what non-sequential tracing requires anyway.

Rays carry wavelength, energy, and a polarization slot (unused until
coatings/DIC need it) from day one.

## Module map

```
core/math        vectors, rigid transforms, (later: quadrature, FFT interface)
core/geometry    surface profiles: plane, sphere, conic, even asphere;
                 intersection + normals, traversal-agnostic
core/materials   dispersion (Sellmeier), glass catalog, media (air/water/oil),
                 Fresnel; (later: coating models)
core/trace       ray struct, interaction (refract/reflect/Fresnel split),
                 system spec (aperture/field/wavelength/conjugate), compiler,
                 sequential engine, paraxial engine
core/pupil       aperture stop → entrance/exit pupil, chief ray, ray aiming,
                 pupil grids, wavefront reference plane + reference sphere,
                 OPD                                              [step 1.5]
core/wave        OPD → Zernike fit, PSF (FFT + geometric), MTF     [step 2]
core/photometry  spectra, sources (star magnitudes, lamps, fluorophores),
                 detector & eye models, noise                      [step 3+]
core/imaging     scene model, field-patch convolution, resampling  [step 3+]
domain/telescope seeing (Kolmogorov screens), sky background, scenes,
                 eyepiece↔eye coupling                             [step 4]
domain/microscope condenser model, coverslip, immersion, fluorescence,
                 specimen scenes                                   [step 5]
mech/            mechanical interfaces & constraints (barrels, threads,
                 parfocal/back-focus distances) — data + rules; mechanical
                 changes feed back into optical spacings           [step 4]
app/             React UI, WebGPU viewport, web workers            [step 3+]
```

Core packages are pure TypeScript with **zero DOM dependencies** — they run
and test in Node. All heavy computation runs in web workers in the app.

## Data model

One schema serves both branches:

- **Prescription** — ordered surface list: kind (refract/reflect), curvature,
  conic constant, asphere coefficients, semi-aperture, thickness to next
  vertex (signed), medium after the surface, stop flag. A Newtonian and a
  100x oil objective are just different prescription files.

  **Composition (decided, not yet built).** An instrument is authored from
  *elements* — a single lens, or a **module** that is itself several surfaces
  (a cemented doublet, an objective, an eyepiece, a tube lens). Both branches
  need this, but the microscope forces it: a 100x objective is bought and
  reasoned about as one part, not as the eleven surfaces it happens to
  contain, and swapping it must not mean editing a surface list by hand.

  The resolution is **flattening, not a second tracer**: a module is a named
  sub-assembly of `SurfaceSpec`s carrying its own local frame, and composing a
  system splices modules into one flat surface chain before `compile()` ever
  runs. Commitment #3 already makes this cheap — the chain is a list of
  frames, so a module's internal frames simply compose with the frame it is
  placed at, and nothing in the tracer learns a new concept. `Prescription`
  stays the flat form the engine consumes; the module layer sits *above* it as
  authoring data, exactly as `OpticalSystem` sits above `Prescription`.

  Two consequences worth fixing now so the later change is additive:
  mechanical data (barrel, thread, parfocal distance — the `mech/` layer)
  attaches to the *module*, not to a surface, because that is the thing that
  physically exists; and analyses must be able to name what a surface came
  from, or a per-surface readout in a 30-surface microscope is unreadable.
  Lands with step 6; the eyepiece/objective libraries of step 5 are its first
  real consumer.
- **OpticalSystem** — a prescription *plus what makes it well-posed*. A
  surface list alone determines EFL and BFD and nothing else; every
  field-, aperture-, or conjugate-dependent analysis (spot, PSF, MTF,
  distortion, vignetting) needs these four:
  - **Aperture** — how the beam is bounded: entrance-pupil diameter,
    f-number, object-space NA, image-space NA, or the stop radius itself.
    One of five spellings of the same constraint; the compiler resolves
    whichever is given into a stop radius.
  - **Field** — infinite conjugate: field *angles*; finite conjugate: object
    *heights*. Both branches need this; only the spelling differs.
  - **Wavelengths** — a set with weights (source spectrum × detector
    response), not a single λ. Polychromatic is the normal case.
  - **Conjugate** — object at infinity or at a finite distance. **The entire
    microscope branch is finite-conjugate**, so this is not optional.
  Plus an **image surface** (position, curvature, tilt) — position is what a
  focus solve moves.
- **Scene** — what is being observed (star field, planet, diatom, tissue).
- **Detector/Eye** — what receives the image (pixels + noise, or eye model).

Analysis outputs cross the worker boundary, so they are **typed arrays, not
object graphs** — decided now because retrofitting it after the wave layer
lands would mean rewriting every analysis signature.

## Conventions (sign, units)

- Light initially travels **+z**. Surface local frames put the vertex at the
  origin, axis along z.
- **Curvature** c = 1/R; R > 0 when the center of curvature lies at +z of the
  vertex. Conic sag: `z = c·r² / (1 + √(1 − (1+k)c²r²))`; k = 0 sphere,
  k = −1 paraboloid.
- **Thickness** is the signed axial distance to the next vertex. After a
  mirror, rays travel −z and thicknesses are negative.
- **Units:** millimeters for geometry, nanometers for wavelength (µm inside
  Sellmeier formulas). Energy dimensionless (relative) until photometry lands.
- Paraxial engine uses the standard mirror convention n′ = −n with signed
  thicknesses.

### Tilt / decenter semantics (decided; commitment #3 depends on it)

Two incompatible idioms exist in real tools. This engine uses the **local
coordinate chain**: each surface carries a rigid `Transform` relative to the
*previous* surface's frame, and `thickness` advances along the **local z of
the current (already tilted) surface** — not along the global axis. Tilting a
fold flat therefore steers everything downstream of it, which is what a
Newtonian or an SCT physically does.

The alternative ("tilt about the vertex, then return to the global axis") is
rejected: it cannot express a folded telescope at all, and misalignment
scenarios under it mean something subtly different.

Consequence: the surface chain is a list of frames, not a list of z-positions.
Axial systems are the special case where every rotation is the identity — the
tracer detects and fast-paths that, so the general form costs nothing.

**Open, and deliberately not yet implemented: fold mirrors.** Making the chain
follow a folded axis requires the frame to *reflect* in the mirror plane
(a 45° tilt then deviates the chain by 90°, as the beam does). That rule is
incompatible with the existing "thicknesses are negative after a mirror"
convention, which is validated and load-bearing — under a reflecting frame,
post-mirror thicknesses become positive instead. Both conventions are
self-consistent; they cannot be mixed.

So today: tilt/decenter is supported and validated for **refracting** surfaces
(the misalignment case), and the frame chain does not auto-reflect at mirrors.
Resolving this is a prerequisite for step 5's Newtonian and SCT presets, and
should be its own change with its own rungs — a 45° fold deviating a beam by
exactly 90° is the closed form to pin it to.

### Wavefront reference (required before OPD means anything)

Optical path length accumulated from a ray's origin is **not** OPD. Two
conventions turn one into the other, and both must be applied:

1. **Input side — a plane perpendicular to the chief ray.** Launching a
   field bundle from a common z-plane is a real geometric error: an oblique
   plane wave genuinely is tilted relative to a z-plane. Measured at just 2°
   of field, that is 0.387 mm of spurious OPL spread across the pupil —
   about 6·10⁵ waves, against a target precision of ~10⁻³ waves. Rays are
   therefore launched from (or projected onto) a plane normal to the chief
   ray, which *is* an equal-phase surface.
2. **Output side — a reference sphere at the exit pupil.** OPD is measured to
   a sphere centered on the image point with radius equal to the exit-pupil
   distance, and referenced to the chief ray:
   `OPD(ray) = OPL_to_sphere(ray) − OPL_to_sphere(chief)`.

Neither is a detail: they are the difference between a nanometer-accurate
tracer and a nanometer-accurate tracer producing meaningless numbers.

## Microscope illumination coherence (known hard problem)

Telescope objects are self-luminous → incoherent imaging → PSF convolution is
exact. Microscope brightfield is **partially coherent** (condenser NA
matters). v1 ships the incoherent approximation with a condenser-NA
resolution factor; rigorous partial coherence (Hopkins TCC) plus phase
contrast and DIC are v2, behind the same PSF-provider interface.
Fluorescence is genuinely incoherent, so it is exact in this framework
already.

## Out of scope until explicitly scheduled

- Non-sequential tracing itself (the commitments above only keep the door
  open). Coatings are modeled analytically (per-surface transmission) so
  light budgets stay honest.
- Polarization physics (slot exists on the ray; unused).
- Thin-film coating stacks, birefringence, gratings.
