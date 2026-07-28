# Validation ladder

The engine is only trusted where it is pinned to known physics. Every rung is
a vitest test in `packages/core/test/`. A rung is "done" only when the test
asserts a number from outside the engine (textbook, published design, closed
form) — engine-vs-itself tests are consistency checks, not validation.

Every step below is landed and green. The prose under each step is the record
of *why* — why a tolerance is the number it is, and what a rung caught. It is
the point of this file, not padding; read the step you need rather than the
whole ladder.

## The ladder at a glance

| Step | What it pins | Tests |
|---|---|---|
| [1](#step-1--geometry-materials-ray-tracing) | Snell, Fresnel, conics, glass catalogs, paraxial + exact trace, mirrors | `geometry` `materials` `interaction` `paraxial` `sequential` `physics` `math` |
| [1.5](#step-15--system-spec--pupils) | Entrance/exit pupils, ray aiming, OPD at the exit pupil | `pupil` `opd` `compile` |
| [1.6](#step-16--focus-solve--spot-diagrams) | The three focus criteria and the 4/3 and 2 ratios between them | `focus` |
| [2a](#step-2a--fft--zernike-basis) | FFT transform pairs; Noll indexing, closed forms, orthonormality | `fft` `zernike` |
| [2b](#step-2b--psf--mtf) | Airy encircled energy, Maréchal Strehl, closed-form circular MTF | `psf` |
| [2c](#step-2c--the-fidelity-criterion) | When the FFT branch is trustworthy — measured on raw traced samples | `fidelity` |
| [2d](#step-2d--geometric-branch--blend-band) | Ray-histogram PSF, energy matched to the diffraction branch, smooth blend | `geometric` |
| [2e](#step-2e--polychromatic-stacking) | Stacking on a common *physical* grid, not bin-for-bin | `polychromatic` |
| [2f](#step-2f--trace-level-partial-vignetting) | Partial vignetting from the trace, on-axis pinnable geometry | `vignetting` |
| [3a](#step-3a--the-standard-observer-and-thermal-sources) | CIE 1931 observer, Planck sources, sRGB | `photometry` |
| [3b](#step-3b--the-hero-image-colour-out-of-chromatic-aberration) | The milestone: a singlet fringes, an achromat does not | `hero` |
| [3c](#step-3c--the-spatially-variant-full-field-render) | Patch decomposition conserves light; field mapping from the chief ray | `render` `golden` |
| [4a](#step-4a--folded-chains-the-frame-follows-the-beam-and-maps-back) | Reflection primitive, folded ≡ unfolded authoring, mapping back | `fold` |
| [4b](#step-4b--the-newtonian-preset) | Newtonian geometry, on-axis quality, coma | `newtonian` |
| [5c](#step-5c--the-spider-diffraction-spikes-from-the-vanes) | Spikes ⊥ each vane; 4 vanes → 4 arms, 3 vanes → 6 | `psf` |
| [5d](#step-5d--atmospheric-seeing-the-one-random-draw-in-the-image) | Kolmogorov D_φ(r), Fried's long-exposure OTF, r₀ not aperture | `seeing` |
| [5e](#step-5e--the-classical-cassegrain-preset) | Classical Cassegrain geometry, on axis, coma | `cassegrain` |
| [5f](#step-5f--the-ritchey-chrétien-preset) | Ritchey-Chrétien aplanatism — the coma null | `ritchey` |
| [5g](#step-5g--the-schmidt-camera-preset) | Schmidt camera, corrector plate, off axis | `schmidt` |
| [5h](#step-5h--the-schmidt-cassegrain-preset) | Schmidt-Cassegrain geometry and spherochromatism | `schmidt-cassegrain` |
| [5i](#step-5i--the-all-spherical-commercial-sct-preset) | All-spherical commercial SCT and its spherochromatism | `sct` |
| [5j](#step-5j--third-order-sums-and-the-achromatic-doublet-preset) | `analysis/seidel` closed forms; the achromatic doublet objective | `seidel` `achromat` |
| [5k](#step-5k--the-ed-fluorite-refractor) | CaF₂ anomalous partial dispersion — what ED buys and costs | `ed-refractor` |
| [5l](#step-5l--module-composition-and-afocal-telescope-evaluation) | The splice; thin-lens Keplerian closed forms | `afocal` |
| [5m](#step-5m--the-computed-plössl-eyepiece) | Plössl computed from two achromatic doublets | `eyepiece` |
| [5n](#step-5n--real-ray-afocal-apparent-field-of-view-and-distortion) | Real-ray AFOV and distortion | `afocal` |
| [5o](#step-5o--the-huygens-eyepiece-achromatism-by-spacing) | Huygens achromatism by spacing | `eyepiece` |
| [5p](#step-5p--limiting-aperture-stop-selection) | Which stop actually limits the chain | `aperture-stop` |
| [5q](#step-5q--the-reduced-eye-and-visual-mode) | Reduced eye model; the two-stop competition | `visual` |
| [5r](#step-5r--camera-mode-pixel-scale-and-sensor-sampling) | Plate scale, the pixel as box integrator, critical sampling | `camera` |
| [5s](#step-5s--camera-mode-relative-exposure) | Image-space cone from the marginal ray; f-ratio and aperture laws | `exposure` |
| [5t](#step-5t--tolerancing-sensitivity-compensators-and-the-rss-budget) | Sensitivity, compensators, RSS budget — four external pins | `tolerance` |
| [6a](#step-6a--the-infinity-corrected-microscope-architecture-and-the-first-objective) | Infinity-corrected architecture; M = f_tube/f_obj; the first objective | `microscope` |
| [6b](#step-6b--the-classic-160-mm-din-microscope) | Finite conjugates (position factor); the re-solved DIN objective | `microscope` `seidel` |
| [6c](#step-6c--the-coverslip-and-what-mismatching-it-costs) | The plate solved to ALL orders; the slip-corrected objective; mismatch | `coverslip` |
| [6d](#step-6d--the-lister-the-first-aplanat-and-the-ceiling-of-two-doublets) | Aplanatic sphere (exact, all orders); ΣS_I and ΣS_II nulled together; coma NA³ → NA^5.2 | `lister` |
| [6e](#step-6e--oil-immersion-the-plane-stack-exactly) | The N-layer immersion stack solved to ALL orders; the matched-stack identity; the aplanatic front (dome + menisci); a diffraction-limited 100×/1.40 oil objective; the slip tolerance, and why the delivered NA depends on the slip | `immersion` |
| [6f](#step-6f--brightfield-the-condenser-and-partial-coherence) | Abbe source-point summation; the coherent plateau and the incoherent identity as the two exact ends; the (NA_obj + NA_cond) cutoff measured; the weak-phase null; the coherence deferral made detectable — a verdict, not a blend, and the sum's own lattice guard | `illumination` |
| [6g](#step-6g--the-coherence-width-and-what-a-field-decomposition-may-window) | van Cittert–Zernike from the condenser's own sampling; the 0.61·λ/NA_cond coherence width measured; μ shown to be what the Abbe image contains; the finding that an input-side partition of unity multiplies the interference by C = Σ√(w₁w₂); and the bridge built on it — a field-varying brightfield render whose edge patches are exact and which is `brightfieldFidelity`'s first caller | `coherence` `math` `brightfield` |
| [6h](#step-6h--object-space-field-mapping-for-a-finite-conjugate) | The traced chief ray inverted to an object height, carrying distortion (cubic, ×8.00 per doubling); the frame's extent set by pupilSamples and not by the grid, and its 2.7% gap from the NA form shown to BE the objective's aplanatism; the pupil rotation exact and pinned against `rotateKernel`'s; a traced frame that finally rules `valid`; and the finding that the frame is NOT isoplanatic — convergence ratio ½, not the fixture's 0.4 | `object-field` |
| [6i](#step-6i--fluorescence-the-specimen-that-emits) | The Abbe sum shown to BECOME a convolution — exactly, at any modulation — once the source lattice steps by the pupil's own frequency step and reaches past 1 + B; the transfer shown to be a lattice point COUNT, which explains its non-monotone departure from § 2b's closed form; ν = 2 reached with no condenser at all; the input-side partition of unity exact where § 6g.2's output-side one was forced; beads placed through their own traced chief rays | `fluorescence` |
| [6j](#step-6j--the-stokes-shift-and-the-band-the-image-is-formed-in) | The excitation shown to be absent from the imaging path by construction; the depth of focus DERIVED from § 1.5's own defocus wavefront and checked against a traced one; a 20 nm Stokes shift measured at 0.32 depths of focus on a 4×/0.10 and 3.77 on a 100×/1.40; the emission band stacked over KERNELS on one physical grid; and the finding that scale diversity alone is not blur | `emission` |
| [6k](#step-6k--out-of-focus-haze-and-the-missing-cone) | Defocus shown to be a pure phase, so a plane's flux is EXACTLY invariant with depth and the haze cannot be focused away; the axis shown to follow sinc²(π·w₂₀), with 8/π² at the quarter wave and a hard null at every integer one; the missing cone as that same constant transformed — zero axial transfer at zero lateral frequency, 2.2e-15, with a negative control that fills it in; the support boundary μ = ν(2−ν) measured exactly at three frequencies and the defocused OTF pinned against an independent quadrature; and the finding that z does NOT factor the way § 6j's band does, except for a specimen uniform in z | `volume` |
| [6m](#step-6m--the-off-axis-frame) | The frame moved off axis, so a field is reached by tiling and not by widening: a tile at the origin reproducing the frame bitwise, image and all; registration pinned in the LAST BIT and shown to be seed-free because the inverse bisects to mantissa exhaustion; the reference sphere shown to be hypot(R_axis, r) with its departure quartic; the ruler's whole trade in closed form — h_e(r+h_e)/R² on the tile's own against r²/2R² on the axial one, crossing at (1+√3)·h_e; field curvature reached at last, ×4.000 per doubling; § 6i’s bead rasterizer moved off the axis with it; and the finding that an off-axis tile is ANISOTROPIC, its radial and tangential scales departing in the ratio 3 that § 6h.1's cubic implies | `object-field` |
| [6n](#step-6n--the-warped-grid-rasterizer) | The grid itself warped at last — § 6h's named deferral: a `Specimen` callback evaluated at the object point each pixel really looks at, so the warp happens in the ARGUMENT and nothing is resampled; the pixel convention pinned bitwise against § 6i's emitter rasterizer, whole flux in one pixel; a straight object line shown to BOW, and at ×2.00 per doubling rather than the cubic's ×8.00 — the sagitta is the map's CURVATURE, so § 6h.1's cubic, § 6m.4's slope and this complete one ladder of derivatives; the sign pinned as barrel; a negative control that cannot bow AT ALL; and a round trip through a whole picture whose residual is that same curvature, against a uniform map whose residual is the slope — so the gap between them doubles with field, 16.8× to 257× | `specimen` |

Two sections close the file: [Later rungs](#later-rungs), the pins that are
named but not yet made, and [Rules](#rules), the discipline every rung is held
to. Individual steps also carry their own "Not yet pinned" notes.

Tests are in `packages/core/test/<name>.test.ts`. Steps 5a and 5b do not
exist: tilt/decenter and folded pupils were prerequisites closed inside § 4a.
Step 6l does not exist *yet*, and unlike those it is a gap rather than a
closure: it is depth-dependent spherical aberration, scoped in APP.md and
independent of the § 6m–§ 6r line, which was taken first because it is what the
field of view is blocked on.

## Step 1 — geometry, materials, ray tracing

| Rung | Pinned to | Status |
|---|---|---|
| Vector Snell matches scalar Snell angles | closed form | ✅ |
| Fresnel: normal incidence R=((n1−n2)/(n1+n2))², R+T=1 | closed form | ✅ |
| Conic intersection: sphere case matches |x²+y²+(z−R)²=R²| | closed form | ✅ |
| Glass catalog: N-BK7 nd≈1.5168, Vd≈64.2 | Schott datasheet | ✅ |
| Glass catalog: F2 nd≈1.620, Vd≈36.4 | Schott datasheet | ✅ |
| Glass catalog: fused silica nd≈1.4585 | Malitson 1965 | ✅ |
| Immersion water nd≈1.3334, Vd≈55.7 | Daimon & Masumura 2007 | ✅ |
| Immersion oil (Cargille B) nd≈1.5150, nₑ≈1.5180 | Cargille datasheet | ✅ |
| Immersion oil Cauchy reproduces the datasheet line table (nF,nC,nF′,nC′) | Cargille datasheet | ✅ |
| Immersion oil Abbe νd≈42.9 and νₑ≈42.8 (both conventions) | Cargille datasheet | ✅ |
| Coverslip D263 nd≈1.5233, Vd≈54.52 | SCHOTT Zemax catalog | ✅ |
| Coverslip D263 nₑ≈1.5255±0.0015, νₑ≈55 | D 263® M datasheet, ISO 8255-1 | ✅ |
| Paraxial EFL = thick lensmaker's equation | closed form | ✅ |
| Exact trace → paraxial in the small-height limit | limit consistency | ✅ |
| Positive singlet: marginal focus shorter than paraxial (undercorrected SA) | textbook sign | ✅ |
| Parabolic mirror (k=−1): all rays cross at R/2 to ~1 nm | closed form | ✅ |
| Spherical mirror: marginal focus ≠ R/2 (SA exists) | textbook | ✅ |
| Fermat: parabola OPL to focus equal across pupil to ~1 nm | Fermat's principle | ✅ |
| TIR beyond the critical angle is detected | closed form | ✅ |
| Achromat (BK7/F2, thin-lens design): F–C focal shift ≪ singlet's | achromat theory | ✅ |
| Singlet chromatic shift ≈ f/V | thin-lens theory | ✅ |
| Two mirrors: axial crossing matches the mirror equation 1/s′ = 2/R − 1/s | closed form | ✅ |
| Tilted plane-parallel plate displaces by t·sin i·[1 − cos i/(n cos r)] | Hecht, closed form | ✅ |
| Uncoated plate throughput = (1 − R)², R = ((n−1)/(n+1))² | Fresnel, closed form | ✅ |

Mirror *composition* was previously untested — every mirror rung used a single
surface. It is the highest-risk sign convention in the engine, so it is now
pinned before folds and multi-mirror presets arrive.

The **immersion / coverslip** media replace the old `constantIndex` stand-ins
for `WATER` and `IMMERSION-OIL` with real dispersion — the ROADMAP step-6
prerequisite, since at NA 1.4 a flat index makes the microscope branch's
chromatic behaviour dishonest. Two subtleties are pinned deliberately because
each masquerades as bad data. **Functional form:** the Cargille oil is published
as a Cauchy series, not Sellmeier, so a `cauchy()` constructor carries the
datasheet's own coefficients verbatim (λ in nm, its printed unit) rather than a
refit — and the line-table rung checks that constructor against the datasheet's
printed indices, not just its header. **Line convention:** immersion/coverslip
Abbe numbers are quoted as νₑ (Hg e / Cd F′,C′), not the νd triad, so both are
pinned and shown to agree with the datasheet's own νd = 42.9 *and* νₑ = 42.8 —
a rung fed only νd would read a spurious few-percent gap that is pure convention.
The reduced eye's vitreous was split into its own non-dispersive `VITREOUS`
constant at the same value, so `WATER` could become real without any eye rung
moving (all rungs byte-identical). D263 carries *two independent* external
anchors: the SCHOTT Zemax catalog it is transcribed from (nd = 1.5233,
Vd = 54.52, tight) and the separate D 263® M product datasheet (nₑ = 1.5255 ±
0.0015, νₑ ≈ 55) — the No. 1.5 coverslip an objective is designed for. The
Sellmeier reproduces the datasheet's headline nₑ inside its own ±0.0015
tolerance while its νₑ (≈ 54.3) lands just under the rounded guide 55; that
residual is carried as data, not forced to agree, and is the seed of the
coverslip mismatch step 6 will show.

## Step 1.5 — system spec + pupils

| Rung | Pinned to | Status |
|---|---|---|
| Entrance-pupil position = stop imaged by preceding surfaces, n₂/s′ − n₁/s = (n₂−n₁)/R | closed form | ✅ |
| Entrance-pupil magnification = reciprocal of the imaging m = n₁s′/(n₂s) | closed form | ✅ |
| Exit-pupil position and size = stop imaged by following surfaces | closed form | ✅ |
| Entrance pupil IS the stop when no surface precedes it | definition | ✅ |
| Oblique bundles launch from one plane ⊥ the chief ray | equal-phase surface | ✅ |
| Each aimed ray passes through its entrance-pupil target | closed form | ✅ |
| Paraboloid OPD at focus flat to < 1e-4 RMS waves | Fermat's principle | ✅ |
| Sphere at the same focus is NOT flat (negative control) | textbook | ✅ |
| Defocus OPD = ½·δ·NA²·ρ² to 1% at NA 0.1 | closed form | ✅ |
| Defocus OPD is quadratic in ρ (rim/half-pupil ratio = 4) | closed form | ✅ |
| Off-axis OPD: coma is linear in field angle | 3rd-order theory | ✅ |
| Off-axis OPD: coma is cubic in pupil radius (ratio 8) | 3rd-order theory | ✅ |
| Off-axis OPD vanishes identically on axis | symmetry | ✅ |
| **Off-axis MIRROR: coma cubic in ρ, linear in field, bounded by ~a wave** | 3rd-order theory | ✅ |

The **off-axis mirror** rungs were added after the wave layer's centroid rung
exposed a defect they then pinned. The reference sphere is centred on the image
point and passes through the chief ray at the exit-pupil *plane*; the flat plane
and the curved sphere straddle each other, and off axis the sphere's centre also
shifts transversely, pushing an entire side of the pupil **inside** it. For a
point inside a sphere the only forward intersection is the far one, beyond the
focus — so half the pupil was picking up a full sphere diameter of spurious
path: 200 mm, or 3.4·10⁵ waves, on an f/5 system. `intersectSphere` now returns
the *signed nearest* crossing rather than the first positive one.

On axis every point lands outside the sphere and both readings agree, which is
precisely why every symmetric rung was blind to it — and why the off-axis rungs
existed only for a refracting singlet, whose geometry happened to keep its
points outside. The lesson is recorded because it generalizes: a rung on one
surface kind is not a rung on the other.

The defocus rung's 1% tolerance is set by the first neglected term of the NA
expansion, not by convenience — the comparison is deliberately made at low NA
where that term is bounded. The two coma rungs are likewise tolerance-bounded
by the fifth-order term, which is why they are asserted at small field angles.

The **off-axis** rungs matter disproportionately: the on-axis ones are
rotationally symmetric and so cannot exercise the reference sphere centred on
a tilted chief ray's image point — which is the convention the whole
off-axis image quality rests on.

### Consistency checks (NOT validation)

These round-trip `resolveStopRadius` against `pupils` and cannot fail on
physics — the EPD case is algebraically tautological, since the pupil
magnification cancels. They catch inverted conversions, nothing deeper.

| Check | Kind |
|---|---|
| EPD spec → that entrance-pupil diameter | round trip |
| f-number spec → EPD = EFL/f# | round trip |
| Object-space NA → entrance-pupil arm | round trip |
| Image-space NA → exit-pupil arm | round trip |
| Stop with power on both sides → distinct, finite pupils | smoke |

## Step 1.6 — focus solve + spot diagrams

Writing the on-axis wavefront of a spherically-aberrated system as
W(ρ) = a·ρ⁴ + b·ρ², where b is the defocus the image plane contributes:

| Rung | Pinned to | Status |
|---|---|---|
| Paraxial image plane of a mirror = R/2 | closed form | ✅ |
| Paraxial image plane, finite conjugate = n₂/s′ − n₁/s = (n₂−n₁)/R | closed form | ✅ |
| Criterion ordering: paraxial → wavefront → spot → marginal, same side | 3rd-order theory | ✅ |
| **δz(min-RMS-spot) / δz(min-RMS-wavefront) = 4/3** | 3rd-order theory | ✅ |
| δz(marginal) / δz(min-RMS-wavefront) = 2 | 3rd-order theory | ✅ |
| That 4/3 error falls ≥4× when NA halves | 5th-order scaling | ✅ |
| RMS wavefront at best focus = W₀₄₀/(6√5) | Var = 4a²/45 + ab/6 + b²/12 | ✅ |
| Balancing defocus improves RMS wavefront exactly 4× | ratio √(4/45 · 180) | ✅ |
| RMS spot at best focus = (2/3)·W₀₄₀/NA | ⟨(W′)²⟩ = 4a² + 16ab/3 + 2b² | ✅ |
| A paraboloid: all three criteria land on the same plane | zero aberration | ✅ |

The 4/3 and 2 ratios are the strongest rungs here: b is linear in the
image-plane shift, so the conversion cancels and the ratios are pure numbers
with no NA, focal length, or wavelength left in them. Their 1% tolerances are
bounded by the neglected fifth-order term — which is why the NA-halving rung
exists, and why the answer to a drifting ratio is a lower NA, never a wider
band.

The criteria are also shown to disagree *usefully*: each one's plane is worse
than the other's when scored by the other's measure.

### Consistency checks (NOT validation)

| Check | Kind |
|---|---|
| Closed-form best-spot plane beats a scan of neighbouring planes | self-consistency |
| Evaluating a traced bundle at a plane = re-tracing to that plane | round trip |
| Vignetted rays counted, not dropped | bookkeeping |

## Step 2a — FFT + Zernike basis

The transform and the basis the PSF is built on. The FFT is pinned to the
*definition* of the DFT — analytic transform pairs — rather than to a second
hand-rolled DFT in the test file: two implementations of one misunderstanding
agree with each other, a delta and a cosine do not.

| Rung | Pinned to | Status |
|---|---|---|
| δ[n] → flat spectrum of ones | DFT definition | ✅ |
| constant → single spike of height N at DC | DFT definition | ✅ |
| cos(2πk₀n/N) → N/2 at bins k₀ and N−k₀ | DFT definition | ✅ |
| linear phase ramp → one spike at bin k₀ (shift theorem) | DFT definition | ✅ |
| Σ\|x\|² = (1/N)·Σ\|X\|² | Parseval, this convention | ✅ |
| 2-D transform of a separable image = outer product of its 1-D transforms | separability | ✅ |
| 2-D linear phase ramp → one spike | shift theorem | ✅ |
| Noll j = 1…11 → the published (n, m) table | Noll 1976 Table 1 | ✅ |
| Z₄ = √3(2ρ²−1), Z₈ = √8(3ρ³−2ρ)cos θ, Z₁₁ = √5(6ρ⁴−6ρ²+1) | Noll 1976 | ✅ |
| (1/π)∫∫ Z_j² dA = 1 through radial order 4, and Z_i ⟂ Z_j | Noll normalization | ✅ |
| **Defocus δ → c₄ = δ·NA²/(4√3)** | closed form + ρ²→Z₄ expansion | ✅ |
| **Spherical aberration → c₄/c₁₁ = 3√(5/3)** | ρ⁴ Zernike expansion | ✅ |
| Spherical aberration → c₁₁ = W₀₄₀/(6√5) vs the rim OPD | ρ⁴ Zernike expansion | ✅ |
| Pure defocus excites no other term; an in-focus paraboloid excites none | symmetry | ✅ |

The orthonormality rung asserts at 10⁻¹² because its quadrature is *exact*, not
merely convergent — 8-point Gauss–Legendre radially (exact to degree 15) and a
midpoint rule azimuthally (exact for the frequencies present). A midpoint rule
in ρ leaves ~6·10⁻⁵, which would have forced a loose tolerance that then hides
a real normalization slip.

The two spherical-aberration rungs are the strong ones. **c₄/c₁₁ = 3√(5/3)** is
a pure number: W₀₄₀ cancels, so no aperture, focal length or wavelength
survives in it — the same character as the 4/3 focus-criterion ratio. Its 1%
tolerance is bounded by the fifth-order (ρ⁶) term, which is why the comparison
is made at NA 0.1. Note that the non-zero c₄ there is *not* image-plane
defocus; it is the balancing defocus ρ⁴ contains, which is precisely why best
focus is not the paraxial focus.

### Consistency checks (NOT validation)

| Check | Kind |
|---|---|
| Fit recovers injected coefficients; residual ~0 | round trip |
| fitRms = √(Σ_{j≥2}c_j²) for known coefficients | round trip |
| Sampler evaluates the fit off the traced grid | round trip |
| Inverse FFT undoes forward | round trip |

**√(Σc²) is grid-independent where the raw sample RMS is not** — a measured
fact worth recording, because it decides which number the UI reports.
`fitRms` is an *area* average over the disc delivered by orthonormality;
`OpdMap.rmsWaves` is a *point* average over whichever samples of a square grid
land inside the disc, and which corner points fall inside changes
discontinuously with grid size. Across grids of 21…81 the point average wanders
over ~0.6% while the fitted value moves in the 7th decimal. They agree to that
jitter, which is enough to catch a normalization error (that would show as a
factor like √3 or 2, not a fraction of a percent).

## Step 2b — PSF + MTF

The system under test is a paraboloid at its focus — geometrically perfect, so
everything the PSF shows beyond a point is diffraction and nothing else. Run at
NA 0.1, deliberately: the pupil→image scale identifies NA with r/R, which is a
paraxial identification.

| Rung | Pinned to | Status |
|---|---|---|
| **Encircled energy → 83.8% inside the 1st dark ring (1.220 λ/2NA)** | Airy pattern | ✅ |
| **Encircled energy → 91.0% inside the 2nd dark ring (2.233 λ/2NA)** | Airy pattern | ✅ |
| **Encircled energy → 93.8% inside the 3rd dark ring (3.238 λ/2NA)** | Airy pattern | ✅ |
| ...each converging first-order, Richardson-extrapolating onto the value | discretization order | ✅ |
| **A circular pupil's PSF is rotationally symmetric to <6e-6 of peak** | transform of a disc | ✅ |
| Point-sampling the aperture instead is ≥4× worse (negative control) | measurement | ✅ |
| ...and the residue halves as the pupil grid doubles | discretization order | ✅ |
| First dark ring → 1.22 λ/(2·NA) as image sampling refines | closed form | ✅ |
| PSF integrates to the transmitted pupil energy | Parseval | ✅ |
| **Strehl ≈ exp(−(2πσ)²), σ from the OPD map** | Maréchal | ✅ |
| That Maréchal error shrinks as the aberration does | approximation order | ✅ |
| **MTF = (2/π)[arccos ν − ν√(1−ν²)] to <0.01 across the band** | Goodman, closed form | ✅ |
| MTF = 1 at DC, 0 at the cutoff, and nothing beyond it | pupil autocorrelation | ✅ |
| MTF cutoff = 2·NA/λ cycles/mm | Abbe form | ✅ |
| Central obstruction: mid-frequency loss, high-frequency gain, cutoff fixed | published behaviour | ✅ |
| Aberration lowers contrast below the cutoff without extending it | pupil autocorrelation | ✅ |
| Airy scale independent of pad factor | sampling vs physics | ✅ |
| **Annular aperture: first dark ring at the root of J₁(v) = ε·J₁(εv)** | closed form | ✅ |
| That reduces to J₁(v) = 0, v = 3.8317 at ε = 0 (validates the solver) | Bessel zero | ✅ |
| Obstructed pupil transmits (1 − ε²) of the energy | annulus area | ✅ |

The three **encircled-energy** rungs are the primary Airy pins and are stronger
than locating a minimum: their radii come from the closed form and are
converted to pixels through `pixelScaleMm`, so a wrong pupil→image scale moves
all three; and they are integrals, so they test the pattern's shape out to
three rings rather than one position.

They are stated as **limits in pupil sampling**, and the reason is the sharpest
lesson in this section. They were previously fixed tolerances (±0.003 at 64
pupil samples) and they passed — at 0.83804, 0.83806, 0.83806 for N = 64, 128,
256. *Dead flat.* An answer that does not move as the grid refines has not been
resolved; it has been arrived at by cancellation, and here two errors were
cancelling: the staircase edge of a point-sampled round aperture aliased energy
outward while the same staircase left the energy denominator short by the same
amount. Resolving the aperture edge breaks the cancellation, and the sequence
starts behaving like a discretization should — 0.84698, 0.84235, 0.84021,
halving each time the grid doubles, Richardson-extrapolating to **0.8378**, the
analytic value.

So the convergence form is the *stricter* standard, not a relaxed one: the old
implementation passes the old tolerance and fails the new rung. This is the
same treatment the first-dark-ring rung already had, for the same reason.

### Aperture edge resolution

`amplitudeGrid` subdivides only those cells whose corners disagree about being
inside the aperture — about π·pupilSamples of them, 256 out of 65536 on a
typical grid — and area-averages the amplitude there. It keys on the pupil
function's own zeros rather than on a circle, so obstructions and (later)
spiders and vignetted pupils get it for free.

**What it fixes is not the number, it is the artifact.** A round aperture
point-sampled on a square grid transforms into *radial spokes* at ~6·10⁻⁵ of
the peak, where the true azimuthal variation of a disc's transform is exactly
zero. That is small and it is dangerous rather than harmless, because of what
it looks like: diffraction spikes — a real effect this engine will produce for
real reasons once spiders arrive, so leaving it in means a refractor renders as
though it had a spider in it. The rotational-symmetry rung and its negative
control exist to keep it gone.

Two things it does **not** do, both recorded because the measurements were
made. It does not reach zero, and cannot: a piecewise-constant aperture on a
square grid carries an O(Δ²) boundary error however exactly each cell's mean is
computed, leaving a faint plaid at ~4·10⁻⁶ of peak — the same level a pupil
grid of twice the density reaches without it, so the honest summary is that it
buys a factor of two in pupil resolution, not exactness. And it does not
improve when the aperture is stopped down, because defocus blur falls as NA
while the Airy radius grows as 1/NA.

Cell averaging forces one distinction that did not exist before: **⟨A⟩ for the
field, ⟨A²⟩ for the energy.** A half-covered cell of a hard aperture has
⟨A⟩ = ½ but ⟨A²⟩ = ½, not ¼. The transform must use the average *field*, while
the transmitted energy must be the average *power*, so the PSF is normalized to
Σ⟨A²⟩ rather than to the Σ⟨A⟩² that Parseval hands back. Getting this wrong
shrinks the transmitted energy by ~1% on a 64-sample pupil, and that number is
what the geometric branch matches itself to — so it would have broken matched
normalization rather than merely mis-stating a brightness.

The **first-dark-ring position** is stated as a limit rather than a fixed
tolerance because measuring it *is* sampling-limited — a one-pixel azimuthal
annulus averages across a near-zero and biases the ring outward. The error runs
13.3% → 2.2% → 1.1% → 0.4% at pad factors 4 → 8 → 16 → 32. That convergence is
what distinguishes a discretization artifact from a wrong scale, which would
leave a constant offset instead.

The **Strehl** rung takes σ from `OpdMap.rmsWaves` — a direct mean-square over
traced rays, with no FFT and no Zernike fit in its history — so it compares the
transform's peak against a published formula fed by an independently measured
number. Its tolerance widens with σ because Maréchal itself does, and the
companion rung asserts the error shrinks as the aberration does.

The **annular** rungs are what make `obstruction` a validated capability rather
than a parameter that merely behaves plausibly. The comparison is made as a
ratio r(ε)/r(0), because locating a dark ring by azimuthal averaging carries a
systematic outward bias that measuring both radii identically cancels — which
is what lets it assert to 1% instead of 3%. The ε = 0 case is asserted first,
so the Bessel series and root finder are themselves validated before the
obstructed cases lean on them.

## Step 2c — the fidelity criterion

The quantity that decides, per field point, whether the FFT PSF or the
geometric PSF is honest. Pinned carefully because a switch that fails does so
in the direction of *looking fine*: it hands back a confidently-wrong
diffraction pattern instead of falling back.

| Rung | Pinned to | Status |
|---|---|---|
| **Defocus: measured \|∇W\| = 2a·(1 − spacing/2), a = ½δNA²/λ** | closed form + midpoint offset | ✅ |
| That finite-difference bias vanishes monotonically as the grid refines | estimator order | ✅ |
| **The same wavefront aliases at 64 pupil samples and resolves at 256** | ARCHITECTURE criterion | ✅ |
| Phase step scales exactly as 1/pupilSamples | definition | ✅ |
| Gradient and fit residual are independent signals | measurement | ✅ |

Two decisions are recorded here because measurement, not intuition, settled
them.

**The gradient is measured on the RAW traced samples, never on the fitted
wavefront.** A Zernike fit is band-limited by construction, so evaluated on a
fine grid it reports "gentle, FFT valid" whatever it was fitted to — it would
be blindest exactly when the fallback is most needed. `Psf.maxGridPhaseStepWaves`
measures FFT-grid adequacy for the *supplied* pupil function and is explicitly
documented as **not** the fidelity criterion.

**Neither the gradient nor the fit residual subsumes the other**, which is why
both are reported. Opening a spherical mirror from NA 0.05 to NA 0.3 raises the
gradient by three orders of magnitude while the fit residual stays below 10⁻⁴
of the wavefront — because spherical aberration is *exactly* representable by
low-order rotationally-symmetric Zernikes. A switch keyed on the residual alone
(the intuitive choice, since the residual is what "the fit failed" sounds like)
would sail straight through a badly aliasing wavefront.

The sampling-density rung is the one that pins ARCHITECTURE's actual claim: the
criterion is phase change *per sample*, so a denser pupil grid genuinely extends
the FFT's validity. A criterion phrased in total waves would deny that and would
fall back to the geometric branch on systems the FFT handles perfectly well.

## Step 2d — geometric branch + blend band

The second PSF branch is not an approximation of the first. Where the wavefront
aliases on the pupil grid the FFT stops being a diffraction calculation, and
what is actually true there is the ray answer; where rays under-describe, the
FFT is. Each covers the other's blind spot, so the geometric branch gets its own
external pin rather than being checked against the FFT.

| Rung | Pinned to | Status |
|---|---|---|
| **Defocused geometric spot: encircled energy = (r/R_blur)²** | uniform disc | ✅ |
| That blur radius = δ·tan u | closed form | ✅ |
| **Both branches integrate to the same energy (to 1e-12)** | matched normalization | ✅ |
| Every blend of them carries that energy too | convexity | ✅ |
| An obstruction removes (1 − ε²) from both branches alike | annulus area | ✅ |
| **The branches agree on blur radius where both are valid** | continuity | ✅ |
| **PSF centroid = geometric spot centroid, off axis** | mean wavefront gradient | ✅ |
| Blend weight is 0 / 1 at the band edges, ½ at the criterion | definition | ✅ |
| Blend weight has zero slope at both edges (C¹, no kink) | smoothstep | ✅ |
| `adaptivePsf` conserves energy on whichever branch it lands | matched normalization | ✅ |
| **Default ray grid ∝ blur radius, floor 151, reported on the Psf** | blur-scaling law | ✅ |
| **Interior fluctuation < 1/√target, and FLAT as blur quadruples in area** | uniform disc, pointwise | ✅ |
| Fixed 151 rays on the same system read ≥1.5× worse (negative control) | measurement | ✅ |
| **Histogram fluctuation halves as the ray grid doubles** | discretization order | ✅ |

The **uniform-disc** rung is the strong half of the geometric pin: (r/R_blur)²
is a pure shape statement with no scale in it, so it holds whatever the exact
marginal-ray angle turns out to be, and the radius is then pinned separately.

The **centroid** rung is the only one in the whole wave layer that can catch a
transverse sign or orientation mismatch between the two branches — every
rotationally symmetric test is blind to one, and it would otherwise surface much
later as coma flaring the wrong way, after the blend had been trusted. It is
also what exposed the reference-sphere defect recorded under step 1.5.

The band is a **cross-fade, not a threshold**, because a hard switch pops
visibly when a user drags a defocus or seeing slider across it. Smoothstep is
used rather than a linear ramp because it is C¹ at both edges: the image and its
rate of change are both continuous through the transition. Since both branches
carry identical energy, every convex combination does too — the switch cannot
alter brightness anywhere in the band, not merely at its ends.

The **ray-grid rungs** close a debt recorded at step 4, found by driving the
app rather than by the ladder: a wide-open singlet falls entirely to the
geometric branch (the switch reporting 100%, correctly) and spreads its light
over ~10⁵ pixels, which the old fixed 151² = 23k rays could not fill — honest
shot noise, but a picture of speckle. The default now derives the blur radius
from the same traced gradient the fidelity switch runs on, via an identity
worth recording: a slope of s waves per pupil sample displaces a ray by
s·size pixels, so the Nyquist step s = ½ puts rays at the grid edge exactly
where the FFT starts to alias — the two branches fail toward each other. The
bundle is sized to hold ~`TARGET_RAYS_PER_BLUR_PIXEL` over the blur disc; the
stratified pupil grid actually beats the Poisson 1/√target bound (measured
0.19 against 0.33), and the *flatness* rung is the real claim: quadruple the
blur area, same per-pixel noise. Two caps are deliberate and visible rather
than silent — blur radius at the half-grid (off-grid light is
`truncatedFraction`'s job, not more rays'), grid at 1023 (past it, density
degrades instead of runtime exploding) — and the chosen grid is reported on
the returned `Psf` so a caller can see when a cap has bound. The app's
aperture-keyed stopgap is gone.

Re-baking the singlet golden came with this change and is worth a line: the
singlet's violet wavelengths carry a geometric share, so the denser bundle
moved the image by max 2/255 on 0.5% of pixels — inspected side by side and
visually identical, which is what a convergence improvement should look like.

## Step 2e — polychromatic stacking

| Rung | Pinned to | Status |
|---|---|---|
| Pixel scale ∝ λ | pupil→image scale | ✅ |
| Physical Airy radius ∝ λ though the pixel radius is not | 1.22 λ/2NA | ✅ |
| **Stack's encircled energy = weighted sum of components', at a common physical radius** | definition of stacking | ✅ |
| **Rings wash out 5× where a bin-for-bin sum would leave them sharp** | negative control | ✅ |
| A one-wavelength spectrum reproduces the monochromatic PSF exactly | degenerate case | ✅ |
| Weights normalize; mean λ is their weighted mean; energy conserved to <1% | bookkeeping | ✅ |
| **Polychromatic Strehl = peak / peak of an aberration-free stack built the same way** | coherence | ✅ |
| ...and is NOT the weighted mean of component Strehls (28% apart here) | negative control | ✅ |
| That Strehl is converged in pupil sampling (128 vs 256 within 1%) | convergence | ✅ |
| Reports 0, not a fabricated ratio, when a component falls to the geometric branch | honesty | ✅ |

The failure being guarded against is invisible rather than loud. Pixel scale is
∝ λ, so summing per-wavelength arrays bin-for-bin silently *rescales* each one
instead of stacking them — producing a perfectly plausible-looking PSF that has
flattened exactly the chromatic differences the calculation exists to show. So
each wavelength is resampled onto a common physical grid first, carrying the
Jacobian (Δ_out/Δ_src)² because `intensity` is energy per pixel, not a density.

A **Strehl ratio for a spectrum** needed the same care and initially did not
get it: it was reported as a weighted mean of the components' Strehls, with
`diffractionLimitedPeak` summed from per-λ peaks that live on *different*
λ-dependent grids. Both shortcuts look reasonable; both are wrong. Averaging
Strehls assumes every wavelength puts its peak on the same pixel — false
exactly when there is chromatic defocus, which is the case the achromat story
exists to show — and on a singlet with real axial colour it read 0.0440 against
the true 0.0344, a 28% error. The stack is now compared against an
aberration-free stack assembled through the identical resample-and-sum path.
Where any wavelength falls to the geometric branch there is no honest
denominator at all, and 0 is reported rather than a plausible number built from
a ray histogram's sampling artifact.

The encircled-energy rung states the identity that "stacking on a common grid"
*means*, and the wash-out rung is its negative control: at the d-line the first
dark ring is a deep minimum, but in the stack it fills in 5× because F's ring
falls inside it and C's outside. A bin-for-bin sum would put all three minima on
the same pixel and leave the ring as deep as a monochromatic one.

### Not yet pinned
- ~~**Trace-level vignetting is not carved out of the pupil support.**~~ Closed
  at **§ 2f**. The prediction recorded here — that partial vignetting would
  force `blendPsf`'s matched normalization to be re-derived rather than
  re-forced — turned out to be half right, and the half that was wrong is the
  interesting half. The disagreement was real and worth 2.61× in brightness,
  but the fix was not in `blendPsf` at all: carving the vignetting into the
  pupil support (the first sentence of this bullet) makes both branches see one
  aperture, at which point the forced equality is *honestly* true by the
  spider's own argument and `blendPsf`'s arithmetic never changes. What had to
  be re-derived was the *evidence*, not the code — see § 2f.
- **Immersion.** The dispersive media themselves are now **sourced and pinned**
  (step 1 table: Daimon-Masumura water, Cargille Type B oil, Schott D263
  coverslip), closing the ROADMAP step-6 *data* prerequisite. What remains is the
  *wiring*: `pixelScaleMm` carries an image-space index factor that is identity
  for every system validated here, and the microscope branch's Abbe rung is what
  will pin it once an immersion objective places one of these media in image
  space.

## Step 2f — trace-level (partial) vignetting

The open item § 2e recorded, and roadmap step 5's "off-axis diagonal
vignetting". *Partial* vignetting is a ray clipped at a downstream surface
rather than by the aperture stop — the off-axis Newtonian past its diagonal.
It is the one case where the two PSF branches genuinely disagreed about how
much light gets through: the geometric branch dropped vignetted rays
(`exitBundle`), the FFT branch modelled the full disc, and the geometric
histogram was then rescaled to the FFT's full-disc energy — **over-brightening
a vignetted field point by 1/fraction, measured 2.61× on the test geometry.**

The fix is the one the spider already established: vignetting arrives as a
`PupilFunction` mask. `vignetteMask` is a predicate over pupil coordinates
whose criterion is *the trace itself* (`status !== "ok"`) — the same test
`opdMap` drops samples on and `exitBundle` drops rays on. It zeroes the FFT
amplitude and, through the shared `transmittedEnergy`, sets the geometric
branch's normalization target, so both branches see one aperture.

| Rung | Pinned to | Status |
|---|---|---|
| **Vignetted FFT pupil area = two-disc intersection (vesica), 0.383301** | closed form | ✅ |
| ...and converges as the pupil grid refines (7.1e-5 → 1.6e-5, 128 → 256) | discretization order | ✅ |
| **Geometric ray-survivor fraction = the SAME closed form (< 1e-3)** | closed form | ✅ |
| The open pupil is genuinely off-centre, not a stopped-down disc | geometry | ✅ |
| Both branches normalize to the vignetted energy, not the full disc | matched normalization | ✅ |
| ...the pre-fix normalization was **2.61× too bright** (negative control) | measurement | ✅ |
| **`adaptivePsf` — the blend § 2e named — carries the vignetted energy** | § 2e, at the named site | ✅ |
| **Newtonian: on axis the diagonal loses ZERO of 17661/31413 rays** | § 4b diagonal sizing | ✅ |
| Newtonian: throughput falls monotonically with field (0.9958 → 0.9530) | vignetting | ✅ |
| **Newtonian: FFT mask and ray-survivor fraction agree to 1.2e-4** | cross-branch | ✅ |

### The pinnable geometry is on-axis, not the cat's eye

The obvious system to validate against is the off-axis Newtonian, and it is the
wrong one to validate *with*: it stacks a fold, an off-axis trace and vignetting,
and its clipped footprint is not an exact anything — a collimated oblique bundle
meets a plane perpendicular to the axis in an ellipse, so the "shifted circle" is
only correct to O(θ²).

So the closed-form rung is built on a **decentered circular aperture in the
collimated space** between the stop and a paraboloidal mirror, on axis. Before
any power the beam is parallel to the axis, so the clip maps to the pupil as the
identity, and the open pupil is *exactly* the intersection of two discs — a
textbook area. That isolates the genuinely new capability, which is a **mask that
is not centred on the pupil**: every aperture the engine could previously
represent (the disc, the central obstruction, the spider) is symmetric about the
axis, and a concentric stop-down would have passed a rung that only checked "less
light gets through". The off-centre control (the survivors' mean pupil x is
displaced) is what distinguishes the two.

The Newtonian then layers the real mechanism back on, pinned to what it can
honestly carry: that throughput falls with field, and that the two branches
agree about how much. Its on-axis rung is a free cross-check of § 4b — the
closed-form diagonal is derived to be exactly tangent to the on-axis cone, and
it loses *exactly* zero rays, not 0.999.

That rung is asserted on `ExitBundle.lost` **directly**, and the first draft's
form is worth recording because it looked stronger and was empty. Phrased as a
*transmitted fraction* it read `onAxis / onAxis` — the same bundle divided by
itself, which is 1 by construction however badly the diagonal were sized. It is
the identical by-construction triviality this section already calls out for the
two branches' shared `energy`, caught there and shipped here, which is the
argument for asking of every green rung not "is this true?" but "what would have
to break for this to go red?". `lost === 0` can go red; a self-ratio cannot.

### What the equality of the two energies does and does not prove

`psf().energy` and `geometricPsf().energy` come from one `transmittedEnergy`
call, so their agreement is **by construction and proves nothing on its own** —
recorded explicitly because it is exactly the kind of number that reads as
validation. The evidence is that the *same fraction* is measured by two
independent routes: an area integral over the masked pupil (FFT, area-averaged
at the edge) and a count of rays that physically cleared the clip (geometric,
no FFT and no mask in its history). Both land on the closed form, which is why
the shared number is trustworthy. Their error bands differ honestly — 1.6e-5
for the area against ~5e-4 for the lattice count — because a ray count of a
curved region converges more raggedly than a subdivided edge, and setting both
to one round tolerance would have hidden that.

### Cost, and the trigger that bounds it

The predicate re-aims and re-traces **one ray per queried pupil point**, and
`pupilSampling` queries the whole in-disc lattice plus every subdivided edge
cell. That is affordable but not free, so it is built **only when the trace
already reports loss** (`OpdMap.lost > 0`). An unvignetted system never
constructs the mask and is bit-identical to before — the entire 377-rung suite,
goldens included, is unchanged by this work, which is the evidence that the
gate holds.

Two limits follow from the gate and are recorded rather than hidden. A sliver of
vignetting too thin to lose any of the 21² OPD samples will not raise the mask —
the same sliver the Zernike fit already ignored, so nothing is made worse, but it
is not detected either. And a vignetted field point in a full-field render costs
meaningfully more than a clear one, per patch and per wavelength; the render pays
it only on the patches that actually clip.

The mask is **binary**, which is what a hard stop is: a ray either clears the
aperture or it does not. Partial-cell coverage at the vignetting boundary is
handled by the same edge-averaging every other aperture edge gets, and carries
the same O(Δ²) floor (§ 2b). Any loss counts — a stop, a TIR, a miss — because
all three mean "no light here", which is what a pupil amplitude of zero says.

## Step 3a — the standard observer and thermal sources

The layer that makes the hero image *visible*. Purple fringing is not new
physics — it is the chromatic focal shift step 1 already pinned, seen through
the response of an eye. Without a λ → colour map the milestone is a table of
numbers that differ; with one it is an image that is violet at the edges.

| Rung | Pinned to | Status |
|---|---|---|
| **Equal-energy illuminant E → chromaticity (1/3, 1/3) to <1e-3** | definition of E | ✅ |
| ȳ peaks at 555 nm, with value 1 | photopic V(λ) | ✅ |
| Planck peak: λ_max·T = 2.8977720e-3 m·K | Wien, CODATA | ✅ |
| **Total exitance ∝ T⁴ (ratios 16 and 81)** | Stefan–Boltzmann | ✅ |
| **A 6500 K Planckian radiator → (0.3135, 0.3237)** | published locus | ✅ |
| **Blackbody → observer → McCamy cubic → T, within 1.5% over 3000–6500 K** | McCamy 1992 | ✅ |
| Hotter is bluer: chromaticity x falls monotonically in T | Planckian locus | ✅ |
| D65 white point → linear sRGB (1, 1, 1) | IEC 61966-2-1 | ✅ |
| White has unit relative luminance (0.2126/0.7152/0.0722) | BT.709 | ✅ |
| Transfer curve fixes 0 and 1; 0.5 encodes to 0.7354 | IEC 61966-2-1 | ✅ |
| **Equal-energy spectrum is neutral at any sample count 5…15** | quadrature | ✅ |
| A 9-sample blackbody reproduces its own CCT to 5% | quadrature | ✅ |
| Weights carry the source spectrum only, no observer response | contract | ✅ |
| Intensity differences across λ become colour differences | mechanism | ✅ |

Three decisions are recorded because they each had a plausible wrong answer.

**The observer is the published analytic fit, not the tabulated data.** Wyman,
Sloan & Shirley (JCGT 2(2), 2013) fit the CIE 1931 2° CMFs with piecewise
Gaussians to ~1% of peak. This is a deliberate trade: the whole observer is 20
numbers that can be read and checked rather than 243 that can only be trusted,
and the error it costs is *measured* by the rungs above rather than assumed —
illuminant E lands 6·10⁻⁴ from (1/3, 1/3), the ȳ peak 0.8 nm from 555. Both are
orders of magnitude below any chromatic difference this engine exists to show.
Swapping in the tabulated observer later is a change to `photometry/cmf.ts`
alone. The two strongest rungs are the ones that leave the engine entirely: the
**6500 K locus point** and the **McCamy round trip**, which runs
blackbody → observer → chromaticity → published cubic → temperature and gets
the temperature back.

**The observer is integrated over each sample's bin, never point-sampled at its
centre.** Nine wavelengths across the visible put 33 nm between them, and x̄
alone has three lobes on that scale. Point-sampled, an equal-energy spectrum —
white by definition — comes back at (0.3382, 0.3405) instead of (0.3335,
0.3341), and the answer *wanders with sample count* in a way that looks like
physics: N = 5, 7, 9, 11, 15 give 0.3349, 0.3320, 0.3382, 0.3344, 0.3329. Bin
integration removes it entirely — every count from 5 up agrees with the
continuous integral to 10⁻⁵ — because the approximation then made is that the
*image* varies slowly across a bin, which it does, rather than that the
*observer* does, which it does not. The bins cost nothing per pixel; they fold
into the XYZ basis once.

**`weight` must carry the source spectrum and no detector response.** The
`WavelengthSample.weight` docstring says "source spectrum × detector response",
which is right for a monochrome detector and wrong for colour: the colour
observer is three responses, applied per channel. Folding ȳ(λ) in as well would
apply luminance twice and erase the distinction between channels — the image
would come back grey. There is a rung asserting the weights of a flat spectrum
are flat, because this contract is invisible until it is violated.

Out of gamut is **reported, not hidden**: the violet skirt of a chromatic fringe
is a real spectral colour outside the sRGB triangle, and clipping it silently is
how a renderer starts telling comfortable lies. `toSrgb` returns the flag. Its
tolerance is 10⁻³ — set by the standard's own four-decimal matrices, which are
not exact inverses and put white itself 5·10⁻⁵ above 1.

### Not yet pinned
- **Star magnitude → photon flux.** Deliberately absent rather than
  approximated: zero points, band passes and aperture area are a separate
  calculation, and an unpinned plausible number in front of the user is worse
  than none. `blackbodySpectrum` is normalized to peak at 1 and is *relative*
  shape only.

## Step 3b — the hero image: colour out of chromatic aberration

Roadmap step 4's milestone, asserted rather than admired: **purple fringing
appears for a singlet and shrinks for an achromat because the glass data says
so.** The two lenses live in `src/designs/refractor`, computed from the
catalog's own Abbe numbers, and are already pinned by the step-1 rungs — which
now import that same code, so the hero and the ladder cannot drift apart.
These rungs ask a different question: does the *rendered image* carry the
consequence?

| Rung | Pinned to | Status |
|---|---|---|
| **Blur radius per λ = (2/3)·\|δz\|·NA where defocus dominates** | steps 1 + 2d, joined | ✅ |
| **That residual flips sign with the sign of δz** | spherical aberration | ✅ |
| **Singlet chromatic blur spread > 5× the achromat's** | F−C shift ratio | ✅ |
| Singlet spreads colour over >8 Airy radii, achromat over <2 | scale | ✅ |
| **Beyond the achromat's light, the singlet's halo is blue (b/r > 3)** | the milestone | ✅ |
| **Singlet hue drifts blueward with radius; the achromat's does not** | the milestone | ✅ |
| Both lenses still render the star's own white | negative control | ✅ |
| **Tinting the monochrome stack by mean λ gives ZERO radial colour** | negative control | ✅ |

The first rung joins two closed forms already on the ladder rather than adding
a third: the paraxial chromatic focal shift says *where* each colour focuses,
and the uniform-disc geometric spot says how big the blur is when it does not
focus here — mean radius (2/3)R for R = |δz|·NA. It is asserted only where the
defocus blur clears the diffraction floor by 4×; nearer focus the Airy pattern
sets the size and a geometric prediction is the wrong physics there, which is
the fidelity switch's entire premise.

Its 30% tolerance is bounded by the singlet's own **spherical aberration**, and
the companion rung is what identifies it as such. A wrong pupil→image scale, NA
or pixel size would bias every wavelength in the same direction; undercorrected
spherical aberration cannot — it adds to the blur on one side of focus and
partly cancels it on the other. So the ratio must sit above 1 for δz < 0 and
below 1 for δz > 0, and it does (1.15, 1.24 against 0.81, 0.83). Stopping the
lens down does *not* tighten the tolerance, and the attempt is recorded because
the reason is instructive: defocus blur ∝ NA while the Airy radius ∝ 1/NA, so
closing the aperture shrinks the defocus-dominated window faster than it shrinks
the aberration, and by f/20 no wavelength qualifies at all.

The blur-spread ratio is asserted at **5×, not the 28×** the F−C focal shifts
differ by, and the gap is physics rather than slack: the achromat's worst
wavelength is already close enough to focus that diffraction sets its size, a
floor the singlet never reaches. Claiming 28× would mean the achromat's residual
colour error were resolvable, and it is not.

The **negative control is the load-bearing rung of this section**. The
architecturally tempting implementation renders the monochrome polychromatic
PSF and tints it — and it produces a perfectly plausible coloured star with no
fringing anywhere in it, because `polychromaticPsf` collapses the wavelengths
with a *scalar* weight one step earlier and the information the tint would need
is already gone. The rung makes that explicit: a tinted grayscale image has
identical chromaticity at every pixel by construction, so the hue drift that IS
the milestone reads zero to 10⁻¹² on the very system that fringes most, while
the per-wavelength integration of the same rays moves by >0.1 in x. This is why
`SpectralStack` stops one move short of summing and why both the grayscale and
colour paths collapse the same stack.

Two disciplines carried over from the wave layer: colour is integrated on the
**common physical grid** the stack already established (pixel scale is ∝ λ), and
both lenses are focused by the **same criterion at the same wavelength**, since
a fringing metric on two differently-focused systems measures the focus
difference rather than the chromatism.

### Golden images — regression, NOT validation

Committed reference renders of both stars, plus a diff, landing at step 4 as
the roadmap requires rather than at step 7. The ladder pins physics; **nothing
pins images**. A flipped axis, a swapped channel, an off-by-one centring, a
changed resampler or a different exposure passes all 223 rungs and still ruins
the picture.

The distinction is kept sharp: a golden image proves the render has not
changed, never that it was right. What makes these two trustworthy is that the
rungs above already pinned the physics inside them; the file only stops it
drifting afterwards. Three statistics are compared, not one — a re-scaled
exposure moves the mean everywhere, a flipped axis moves a large fraction by a
lot, and a one-pixel centring slip moves almost nothing except the max — and
the harness carries its own negative control, asserting the two goldens are not
the same image, which is exactly what a copy-paste slip in the fixture would
otherwise produce silently.

Exposure is peak-referenced and pushed 25×, so the core clips as an
overexposed star does and the halo at ~10⁻³ of peak is visible. The ceiling is
the render's own noise floor: at 25× the darkest level sRGB can encode is ~10⁻⁵
of peak, comfortably above the 4·10⁻⁶ plaid. An auto-exposure to a high
quantile of lit pixels — the obvious choice, and the first one tried — pushes
past that and fills the frame with discretization artifact, committing it to a
reference image as though it were optics.

## Step 3c — the spatially-variant full-field render

Built at step 4 rather than step 7 because it is the heaviest compute in the
app and its cost has to be known early. A PSF is only a convolution kernel
where it is *constant*, and it is not: convolving a whole frame with the
on-axis PSF renders a perfectly sharp corner on a lens that has none. So the
kernel is made piecewise constant and blended,
`image = Σ_p PSF_p ⊛ (w_p·scene)` with `Σ_p w_p ≡ 1`.

These rungs are about the **decomposition** — that splitting a frame into
patches neither creates, destroys nor moves light — rather than about the PSF
inside it, which the wave layer already pins.

| Rung | Pinned to | Status |
|---|---|---|
| **Patch weights are a partition of unity at every count (1e-12)** | definition | ✅ |
| Refining the patch grid does not change total light | linearity | ✅ |
| **A one-patch render of one star IS the wave layer's PSF (1e-6)** | degenerate case | ✅ |
| The star lands at the centre, not half a frame away | kernel centring | ✅ |
| Off-axis stars land off axis, in the placed direction | axial symmetry | ✅ |
| Image height ≈ f·tan θ, and only *approximately* | distortion exists | ✅ |
| Every refinement level is a complete image carrying all the light | definition | ✅ |
| Cost is exactly patches × wavelengths | cost model | ✅ |
| **SED-weighted samples in a scene render shift colour past a JND** | negative control | ✅ |
| **Kernel rotation sense: a +x feature turns to +y for an azimuth-90° patch** | trace convention | ✅ |
| Rotation conserves the kernel's energy exactly | matched normalization | ✅ |
| Azimuth 0 returns the kernel by reference, unresampled | definition | ✅ |
| A real off-axis PSF is genuinely changed by being turned | negative control | ✅ |
| **Off-axis kernel asymmetric along the field axis and ONLY there** | reflection symmetry | ✅ |
| **Two stars at ±x render as mirror images, end to end** | reflection symmetry | ✅ |
| **One diagonal star renders transpose-symmetric (the sense-catcher)** | reflection symmetry | ✅ |

The window is applied to the **scene, not to the output**. Both look like they
would work and only one does: windowing the output blends two images that were
each formed with the wrong kernel over most of their support, leaving a seam
wherever the PSFs differ. Windowing the input splits the *light*, so every
photon is convolved with the kernel nearest where it came from.

Three defects were found by these rungs rather than by inspection, and all
three would have produced entirely plausible pictures.

**The edge patches summed to ½.** Interior patches are covered by two
overlapping ramps; the outermost half-patch is covered by one. The frame border
therefore rendered at half brightness — indistinguishable from vignetting, and
on a system that has some, indistinguishable from *correct* vignetting.

**The colour basis was built from the scene's raw weights** while
`spectralStack` normalizes its own to sum to 1, scaling the entire render by
the width of the sampling band. Every ratio in the image is right and the
absolute brightness is off by 300×; nothing but a direct comparison against the
single-source path catches it, which is what the degenerate-case rung is.

**The spectrum was applied twice.** `WavelengthSample.weight` carries the
source SED for a single-source calculation, because there is nowhere else to
put it — but a scene has many sources and they have different colours, so
there the weights must be pure quadrature (`quadratureSamples`) and the SED
belongs to each source. Using the single-source samples squares the spectrum: a
5800 K star renders visibly bluer, well past a MacAdam just-noticeable
difference, and looks like a perfectly ordinary star.

The field mapping goes through the **chief ray**, not `EFL·tan θ`. That matters
beyond accuracy: `EFL·tan θ` is the *definition* of a distortion-free system, so
a renderer built on it could never show distortion no matter how much the
prescription had. There is a rung asserting the mapping is only approximately
`f·tan θ`, because the gap is the physics.

**The kernel had to be rotated, and was not.** Found by reading the code, not
by a rung — the rungs were structurally incapable of seeing it. A PSF is always
traced for a field point on ONE axis, and convolution is shift-invariant, so
whatever orientation that kernel has is stamped onto every star in the patch.
Placement was already rotated — `imagePointOf` carries the azimuth — so the
stars landed in the right places wearing the wrong shape: every coma tail in
the frame pointing the same way, which reads as a decentred or tilted system, a
fault this engine will later simulate deliberately. Same category as the
aperture spokes: the render inventing an optical component.

**And then the rotation was wrong by 90°, which is where step 5 began.** The
step-4 fix turned each kernel by `azimuth − 90°`, on the stated belief that the
traced kernel faces +y. It faces **+x**: `fieldDirection` tilts the incoming
bundle in the x–z plane, which the geometric branch's tests had said in plain
words all along ("fields lie in the x–z plane, so neither branch may drift in
y"). The belief was only ever written in comments, and the rotation-sense rung
pinned `rotateKernel` the *operator* on a synthetic kernel — the convention
connecting the operator to the trace was never pinned to anything. Every patch
kernel in every frame was 90° from radial: coma tangential instead of radial,
which also reads as a misaligned instrument.

The unexplained **0.049 residual** in the withdrawn mirror rung was this bug
seen end to end: the wrongly-turned kernel injects its own field-axis
asymmetry (0.046 on this achromat at 0.04°) straight into the mirror metric.
That is why toggling the rotation moved the metric by only 4% — both variants
were wrong, one by 90° and one by whatever the azimuth was — and why the rung
was withdrawn as toothless when it was in fact reporting a real defect it
could not localize. The conclusion recorded at step 4, that pinning this needs
a strong-coma Newtonian, was wrong too: with the convention corrected the same
achromat discriminates at 200×–3500×, because the correct reading is
interpolation-level (1e-5–2e-4) while any orientation defect reads the
kernel's full asymmetry (~0.05). *The rung was not weak because the asymmetry
was small; it was weak because it compared two defective renders to each
other.*

Three rungs now pin orientation end to end, each carrying a distinct part:

- **The kernel-axis rung** asserts the off-axis kernel is asymmetric along the
  field axis and mirror-symmetric across it to < 1e-4 — measured 1.6e-5, the
  same as the on-axis plaid floor, against 0.046 along the field. Pure
  reflection symmetry: a field displacement along x̂ cannot break y-parity.
  This is the rung that identifies which axis the trace uses, and it is what a
  transposed FFT grid or swapped OPD axes would break.
- **The mirror-pair rung** (stars at ±x, frame vs its own reflection) pins the
  whole pipeline's symmetry about the axis — placement, windows, convolution.
  Correct reading 2.2e-4; asserted < 0.005.
- **The transpose rung** (one star on the +45° diagonal, frame vs its own
  transpose — reflection in the plane containing the axis and the star) is the
  **sense-catcher**, asserted < 0.002 against a measured 1.0e-5. It exists
  because the mirror-pair metric is *structurally blind to a rotation-sense
  flip*: flipping the sense conjugates the render by a reflection, which maps
  a mirrored pair to itself — measured, the pair metric does not move at all
  (0.000221 both ways) while the transpose metric reads 0.052. Axis error,
  sense flip and missing rotation each read 0.035–0.052 on it.

### Golden image

`renderField` now has a committed golden — the first picture it ever produced
outside a unit test, inspected the day it was committed, closing the step-4
note that its off-axis output had only ever been asserted about. The scene is
built for drift detection rather than beauty: a sun-like star on axis, four at
one field radius on the axes and diagonals (the mirror and transpose partners
the symmetry rungs pin), and a 9000 K / 3200 K pair whose colours exercise the
per-source SED path in the picture itself. A kernel-orientation slip breaks
the ring's symmetry; an SED slip drags the pair's colours together. Same
regression-not-validation status as the hero goldens.

### Not yet pinned
- **A multi-star field panel in the app.** The engine-side picture exists and
  is pinned; the app still renders only the on-axis point path. Belongs with
  the step-5 app work (presets, eyepieces, seeing).
- **Lateral colour is not rendered.** Each wavelength's PSF is centred on its
  own chief-ray image point, which removes exactly the transverse colour
  separation lateral chromatic aberration consists of. On axis there is none to
  remove, so the hero image is unaffected; off axis this render is missing a
  real effect. The fix is local — carry each plane's image point on
  `SpectralPlane` and offset it when resampling onto the common grid — but it
  changes what the polychromatic Strehl means off axis, so it belongs with
  step 5's field-dependent work and its own rungs.
- **No extended scenes yet.** The convolution machinery is general and is
  exercised by point sources, whose degenerate case is what makes the
  equivalence rung exact. A planet or lunar scene is scene authoring, not new
  render physics.
- **Circular convolution wraps at the frame edge.** Harmless while the PSF is
  small against the frame and every source is well inside it; a scene with
  light at the border needs padding.
- ~~The geometric branch's ray count does not scale with the blur.~~ Closed at
  step 5: the default is now blur-scaled with its own rungs — see § 2d.

## Step 4a — folded chains: the frame follows the beam, and maps back

| Rung | Pinned to | Status |
|---|---|---|
| Householder reflection is improper (det = −1) | definition | ✅ |
| The frame's reflection matrix agrees with the engine's own `reflectDir` | cross-implementation | ✅ |
| 45° flat steers the downstream chain by exactly 90° | closed form | ✅ |
| The next surface lands 100 mm up the *folded* axis, not the old one | closed form | ✅ |
| The traced ray goes where the chain went, and hits the surface it placed | beam/frame agreement | ✅ |
| Folded path length equals the unfolded one (reflection is an isometry) | closed form | ✅ |
| An off-axis ray folds about the same plane, keeping its x untouched | symmetry | ✅ |
| Folded and unfolded authorings of one two-mirror system place every vertex identically | cross-convention | ✅ |
| …and trace identically: hit points, exit direction, path length | cross-convention | ✅ |
| …and report the same EFL/BFD through the unfolded twin | cross-convention | ✅ |
| Two mirrors return the chain to a proper (right-handed) frame | parity | ✅ |
| Newtonian: diagonal vertex sits *d* back down the returning beam | closed form | ✅ |
| Newtonian: axial bundle focuses at (f − d) out the side of the tube | closed form | ✅ |
| Folding adds no power: the paraboloid's EFL survives the fold | closed form | ✅ |
| The unfolded→world map is proper (det = +1): the twin is congruent, not mirrored | parity | ✅ |
| The map carries every unfolded vertex back onto its world vertex | cross-convention | ✅ |
| It places the image plane (f − d) out the side of the tube | closed form, via a second route | ✅ |
| A traced folded exit ray maps onto the twin's, line for line, in 3D | cross-implementation | ✅ |
| Folded and straightened agree on OPD, all three focus criteria, and Strehl | cross-convention | ✅ |
| The folded Newtonian is diffraction-limited on axis (Strehl 1) | closed form | ✅ |

The **cross-convention** rungs carry the most weight here. They pin the new
convention against the already-validated one rather than against a fresh closed
form, and they are the reason the two authorings' *differences* are meaningful:
post-mirror thicknesses flip sign, and so does every curvature read after an odd
number of mirrors — exactly what the two conventions say must differ, and
nothing else.

The 90°-deviation rung earns its place by catching the tempting wrong
implementation. Reflecting the mirror's own (already tilted) frame instead of
the frame the light arrived in turns the chain by the tilt twice, and lands the
downstream axis at (0, 0.707, −0.707) — a 45° deviation wearing the right
shape. Every other rung in this table passes under that bug.

The **map** rungs replaced the guard rungs that used to sit here (`pupils()`
and friends throwing on a folded system). The guard was a promise to fail
loudly until the unfolded-z → world map existed; it now exists, so the promise
is kept by computing the right answer instead.

The **line-for-line** rung is the one carrying the weight, and it is the only
one that can see an orientation error. Strehl, RMS and an on-axis image point
are all blind to which axis got flipped: a map that flipped x instead of z
would keep det = +1, keep focus on the tube's side, and pass every other rung
in this section. So that rung traces the *same input rays* through the folded
prescription and through its straightened twin, and demands the map be the
entire difference between the two exit rays in all three components. It is not
a restatement of the map's own algebra — the folded ray and the twin ray bounce
off **different planes** and genuinely leave from different points (by exactly
the ray's height above the fold), so the lines coinciding after mapping is the
isometry claim itself being tested.

The OPD equality is bounded in waves rather than matched to N decimals, and the
bound is set by f64: the folded route carries the same path through one extra
rigid transform, and one ulp at an 1800 mm path is 4.5·10⁻¹³ mm ≈ 8·10⁻¹⁰
waves. The measured spread sits at that floor. A decimal-places match would be
asserting below what the representation carries; the bound used (10⁻⁸ waves) is
still five orders under the engine's ~10⁻³-wave target.

### Not yet pinned
- **Clear apertures differ between a fold and its twin.** The twin drops the
  diagonal's tilt, so its aperture cuts a circle where the folded one cuts an
  ellipse. The equivalence rungs are sized so neither clips, which means the
  *vignetting* of a tilted fold is exercised by nothing yet. It needs the
  elliptical-footprint case and belongs with obstruction/spider work.
- **Fold + misalignment together.** Tolerancing rungs (perturb, watch the image
  degrade) are now unblocked — the image exists — but are not written. Note the
  scope limit above: with a *curved* surface tilted, the twin is the nominal
  system, so pupils and image plane are nominal while the rays are exact.

## Step 4b — the Newtonian preset

The first instrument that could not be written down before the fold, and the
first consumer of the unfolded→world map. A Newtonian is one paraboloid and one
flat, so there is no design table to hide behind: every number below is a closed
form or a traced consequence of one.

| Rung | Pinned to | Status |
|---|---|---|
| EFL equals D·F | definition | ✅ |
| Focus lands (f − d) out the side of the tube | closed form, via the map | ✅ |
| Diagonal minor axis is the beam that reaches it | traced marginal ray | ✅ |
| …and the classic paraxial formula sits 0.25% under it, for a known reason | paraxial limit | ✅ |
| The whole on-axis beam gets through; the naive √2 ellipse clips it | closed form | ✅ |
| Obstruction is the projected minor axis over the aperture | definition | ✅ |
| Zero wavefront error on axis (a paraboloid is perfect there) | closed form | ✅ |
| Diffraction-limited on axis: Strehl 1 | closed form | ✅ |
| An obstructed pupil passes 1 − ε² of the light | closed form | ✅ |
| A star lands at f·tan θ, at the azimuth it came from | closed form | ✅ |
| Coma matches the third-order coefficient θ·D/(32F²√72) waves RMS | third-order theory | ✅ |
| Coma ∝ field angle | scaling | ✅ |
| Coma ∝ 1/F² | scaling | ✅ |
| Coma ∝ aperture at fixed focal ratio | scaling | ✅ |
| The comatic flare is 3:2, length to width | closed form | ✅ |
| …and its length is the textbook tangential coma 3θ/(16F²) | closed form | ✅ |

The **coma coefficient** rung is the one worth reading twice. The traced Zernike
coma (Noll j = 8, whose coefficients *are* RMS contributions) agrees with
third-order theory to within half a percent — and the residual shrinks as the
system slows: 0.47% at f/4, 0.30% at f/5, 0.075% at f/10. That is the signature
of the higher-order coma third-order theory omits, so the disagreement is the
theory's rather than the tracer's, and it vanishes in the limit where the theory
is exact. The tolerance admits exactly that band and no more; the ∝1/F² rung
asserts the *sign* of the deviation too, because a tolerance loose enough to
call 3.991 "4" would also admit a real scaling error.

Two findings came out of writing these rungs, both engine-side:

- **A tilted flat in a converging beam has an asymmetric footprint.** The plane
  cuts through the beam, so the far edge is met nearer the primary where the
  beam is still wider. A diagonal cut to the projected ellipse's m·√2/2 clips
  its own beam by 11% at f/5. The preset now sizes the clear aperture to the
  footprint's real far edge, in closed form. This is the same asymmetry real
  Newtonians answer by offsetting the diagonal.
- **The primary's sag matters at the 0.25% level.** The marginal ray leaves the
  rim at the sag plane, not the vertex plane, so it starts (f + z_sag) from
  focus. Both the minor-axis and footprint formulas carry the term; dropping it
  leaves the diagonal narrow enough to vignette the pupil's own edge, which is
  how it was found.

A third came out of the tracer: rays landing **exactly** on a clear aperture are
the designed case, not a corner case — a stop whose radius is the element's
clear aperture puts every marginal ray there. The rim test is inclusive and now
carries a tolerance so f64 round-off cannot decide it ray by ray, with its own
rung in `sequential.test.ts`.

### Not yet pinned
- **The diagonal is circular, not elliptical.** `semiAperture` is a radius, so
  the ellipse a real diagonal is cannot be expressed; the modelled flat is
  slightly larger than the ideal offset ellipse. No traced ray moves — nothing
  clips either way — but a diagonal *offset* is not modelled, and the obstruction
  reported is the ideal ellipse's.
- **The obstruction is not traced as a blocker.** It is reported by the preset
  and applied in the pupil function, which is where a central obstruction
  belongs. The spider now exists too (§ 5c) — both are amplitude masks, not
  ray-level blockers — but neither the obstruction nor the vanes are baked into
  the preset's output: a vane width is a mechanical number with no closed form,
  so it is a caller-supplied option, not an invented default in front of the
  user (the same discipline as the deferred star-magnitude zero point).
- **Off-axis vignetting by the diagonal.** The sizing rungs are on axis. A field
  ray walks across the diagonal, and with `fullyIlluminatedFieldMm` = 0 it will
  start to clip — which is the correct physics but is pinned by nothing.
- **Astigmatism and field curvature** are present in the trace and unpinned;
  coma dominates a Newtonian but it is not the only off-axis term.

## Step 5c — the spider: diffraction spikes from the vanes

The vanes that hold a secondary mirror are long thin opaque bars, and the
transform of a bar is a bright streak *perpendicular* to it — so a reflector's
diffraction spikes are not drawn on, they fall out of the same
`|FFT{A·exp(2πiW)}|²` the Airy rings do. The spider arrives exactly as
ARCHITECTURE promised the central obstruction's successor would: **a new
`PupilFunction`, not a change to the transform.** One predicate,
`spiderObscures`, zeroes the amplitude under each radial bar; the edge-resolving
sampler, `transmittedEnergy`, and the geometric ray-drop all key on the pupil's
own zeros, so they carry the vanes for free. Both branches call that *same*
predicate — the lesson of the kernel-rotation drift (§ 3c) written into the
code, not just a comment.

| Rung | Pinned to | Status |
|---|---|---|
| **Isolated slit's streak is a sinc, first zero at padFactor/width** | transform of a rectangle | ✅ |
| …and halving the slit width doubles that radius (zero ∝ 1/w) | Fourier scaling | ✅ |
| **A vane along x̂ throws its spike along ŷ (17:1)** | perpendicularity, a Fourier theorem | ✅ |
| **A 30° vane's spike lands at 120°, not the transpose's 60°** | ⊥ vs transpose (the sense-catcher) | ✅ |
| 4 vanes → a 4-arm cross on the axes, not the diagonals | even N: N/2 collinear pairs → N arms | ✅ |
| 3 vanes → a 6-arm star, bright ⊥ each vane, dark along them | odd N: no pairing → 2N arms | ✅ |
| **A spider removes the vane area (FFT branch)** | strip area 2(h√(1−h²)+arcsin h), closed form | ✅ |
| **The geometric branch carves that vane's shadow into the defocused spot** | pupil→spot map + the ray-drop | ✅ |

The **isolated-slit** rung is the ε = 0-first move, straight from the annular
rung's playbook: the sinc law is validated on a bare transmitting rectangle,
where the streak IS the whole pattern and its zeros are exact, before anything
leans on it in an aperture where the Airy tail contaminates the null. That
contamination is not a nuisance to tolerate but the reason the in-aperture
absolute first-zero is *not* pinned: measured on the mirror, the streak's
apparent minima sit at the Airy-ring radii (16, 43, 77 px), independent of vane
width — the same azimuthal-averaging bias the annular rung already documents,
carried to the point where the absolute number is meaningless and only the
clean-slit pin survives. The width is deliberately fat (w = D/8, D/16): a thin
realistic vane throws its first zero to `padFactor/widthFraction` pixels, off
any modest grid — correct physics, the spike runs off frame — so the validation
vanes are sized to keep the streak on-grid, and the rectangle-approximation
error that fatness costs is `(w/D)² ≈ 0.4–1.6%`, which bounds the tolerance the
way low NA bounds the annular one.

The **perpendicularity** rung and its **30° sense-catcher** are the spider's
kernel-rotation guards, and the scar is explicit in their design. The symmetric
0°/90° rung is *structurally blind to a transpose* — swapping the pupil→image
axes maps a vane-along-x/spike-along-y system onto vane-along-y/spike-along-x,
which reads the same both ways — exactly as the § 3c mirror-pair metric could
not see a rotation-sense flip. So the 30° vane is the real sense-catcher: ⊥
puts its spike at 120°, a transposed axis at 90° − 30° = 60°, and those are
different lines, where a 45° vane (the tempting symmetric choice) would leave
them on top of each other. The spike energy is measured **parametrically**, one
pixel per radius, not by masking a strip — a strip-mask captures √2 more pixels
along a diagonal than an axis, biasing an isotropic Airy floor into a false
diagonal feature, and a spider-free control (flat across all angles) is what
proved the parametric measure unbiased.

The **count** rungs pin the even/odd law and cost the odd case its contrast
honestly. Four vanes pair into two collinear diameters, so their spikes fall on
the x and y lines with the diagonals ~3× dimmer; three vanes do not pair, so the
light splits into six arms each from a radial *half*-bar, and the bright/dark
contrast is a genuine ~1.75×, not the even case's 3×. It is asserted at that
value rather than inflated: fattening the odd vane past ~D/10 grows the central
overlap of the three bars faster than the spikes and *lowers* the contrast, so
the thinner vane is the stronger rung — measured, not guessed. The pattern is
still exact and six-fold symmetric, so a wrong count or a 30°-rotated star
(spikes on the vane directions instead of ⊥ them) inverts the two sets.

The **energy** rung earns the spider its place beside the annular capability,
and it is where the step-2e matched-normalization note is answered — carefully,
because the two branches do not measure energy the same way. The **FFT branch
carries the external pin**: a full-diameter bar of half-width h blocks a strip
of the unit disc of area 2(h√(1−h²) + arcsin h), a closed form, and Σ⟨A²⟩ on the
edge-resolved grid matches it to 1%. The **geometric branch does not have an
independent energy to check** — it is handed `transmittedEnergy(pupil)` and
returns it verbatim, so `sg.energy ≈ sd.energy` is a *consistency* check that
the same mask reached both, precisely the status the obstruction rung has, and
nothing stronger. Claiming the geometric branch pins the area independently
would be false: it is the same computation on the same pupil.

That distinction matters because it is exactly the step-2e hazard *not* firing.
The harder case the note warns of is *trace-level* vignetting — where the FFT
branch models the full disc, the ray count genuinely disagrees, and `blendPsf`'s
forced equality would paper over it — and it stays deferred (off-axis diagonal,
§ 4a/4b). A spider is the *same* mask on both branches, so there is no
disagreement to paper over; the forced equality is honest here.

But energy being shared means **energy is blind to the geometric ray-drop** —
the branch is scaled to `transmittedEnergy` whether or not it actually drops the
vane rays. So the ray-drop, real new code, is pinned by its effect on the spot's
*shape*, not its energy. Defocused, the geometric spot is a scaled picture of
the pupil (the uniform-disc rung of § 2d), so a full-diameter vane along x̂ casts
a horizontal dark stripe across it: the spot's horizontal centreline lies wholly
in shadow, the vertical one crosses it only at the core, and without the drop the
two are equal by the disc's symmetry — so the asymmetry *is* the ray-drop. It is
the geometric counterpart of the FFT branch's spike, which runs ⊥ to the very
same vane.

That pairing is the physics worth stating: **the spike is an FFT-branch
phenomenon, the shadow a geometric one.** The histogram has no phase, so a vane
casts a shadow but no streak — correct, because diffraction spikes wash out far
from focus, precisely where the geometric branch rules; and the FFT branch,
in-focus, shows the spike but no defocused shadow. A vane's *energy* effect is
on both branches, but its two visible signatures live one to a branch, and the
orientation/spike rungs run on the paraboloid at focus where the diffraction
branch is fully active (Strehl 1, no aliasing).

## Step 5d — atmospheric seeing: the one random draw in the image

The turbulence a ground telescope looks through stamps a random optical-path
error across the pupil, and it arrives exactly as ARCHITECTURE promised the
successor to the obstruction and the spider would: **a `PupilFunction` phase,
added onto whatever the optics already did, with the transform in `wave/psf`
never changing.** `withPhaseScreen` is that addition. Unlike the spider it is
*pure phase* — no amplitude mask — so it lives only in the FFT branch (see the
geometric deferral below), and unlike everything before it there is no closed
form for a single realisation: a speckle pattern is a speckle pattern. What is
pinned is the **statistics**, and they follow from one law, the phase structure
function D_φ(r) = 6.88·(r/r₀)^(5/3), through the two observables the ensemble
average must reproduce.

| Rung | Pinned to | Status |
|---|---|---|
| **D_φ(r) follows the 5/3 power law over the resolved mid-band** | Kolmogorov spectrum, the shape | ✅ |
| …and D_φ(r₀) matches the constant 6.88 within the finite-screen band | Kolmogorov, the magnitude | ✅ |
| **The long-exposure OTF is exp(−3.44·(ρ/r₀)^(5/3)): r₀_eff ≈ r₀** | Fried, the seeing transfer function | ✅ |
| …and r₀_eff is **flat across frequency** — an r₀ shift, not a shape error | the effective-r₀ discriminator | ✅ |
| **Seeing is set by r₀ not aperture: r₀_eff ≈ r₀ at two different D/r₀** | D-independence / the λ/r₀ scaling | ✅ |
| The long-exposure FWHM ≈ 0.98·λ/r₀ where it is well resolved | Fried, the headline number | ✅ |
| The FFT grid resolves the screen: maxGridPhaseStepWaves < ½ wave | the under-resolution guard | ✅ |
| A screen is stored as OPD, so halving λ doubles its waves | r₀ ∝ λ^(6/5), colour-free path | ✅ |
| **`psf({seeing})` is bit-identical to the manual `withPhaseScreen` compose** | the wiring adds nothing | ✅ |
| The stack applies ONE screen to every colour: the bluer λ carries 2× the grid phase step and is the more degraded plane, and no plane loses energy | colour-honest / pure-phase plumbing | ✅ |

The ladder is **ε = 0-first**, the isolated-slit playbook again: the structure
function is pinned on the bare screen *before any transform* — the generator in
isolation — and only then do the OTF and FWHM lean on it. The generator is an
FFT screen (white noise coloured by √Φ) with **subharmonics** (Lane/Johansson)
added below the grid fundamental; without them a bare FFT screen undershoots
D_φ at large r by ~35% because the largest turbulent scales fall through the
grid, and the subharmonics are the seeing counterpart of the edge-resolving
trick in `pupilSampling` — a known discretisation error, corrected where it
bites. Randomness runs through a **seeded** `mulberry32` (`math/random`), never
`Math.random`: an ensemble rung that averages 120 screens has to replay
identically or its tolerance means nothing.

The **one honest tolerance is a single number seen three ways.** A finite screen
truncates the largest scales the infinite Kolmogorov spectrum keeps forever, so
the generator carries a small *effective-r₀ inflation* — the seeing comes out a
touch milder than r₀ says. It shows up once and consistently: a ~5–15% deficit
in D_φ at large r, a ~2–5% high bias in r₀_eff, a ~5–15% narrow bias in the
pixel FWHM. That it is a single **r₀ shift and not a shape distortion** is what
the OTF rung proves and what earns the documented band — the same way the
spider's (w/D)² rectangle-approximation tolerance is earned. The proof is
`r0_eff` recovered from the OTF at each frequency: it comes back **flat across
the whole meaningful band** (1.00–1.05 of r₀ from u = 0.05 to 0.16), which a
shape error could not do. So the tight, converged pin is the OTF's r₀_eff; the
pixel FWHM is deliberately the *loose* rung, band-pinned where it is well
resolved (D/r₀ = 4) — it is one geometric measurement on a still-lumpy mean and
the slowest-converging feature, and its finite-screen narrow-bias itself grows
with D/r₀, so a raw FWHM *ratio* across apertures is contaminated where the
OTF's r₀_eff is not. That is why the **λ/r₀ scaling and D-independence are stated
on the OTF** (r₀_eff ≈ r₀ at both D/r₀ = 4 and 8) rather than on a FWHM ratio: a
bigger telescope returns the *same* r₀, so it does not resolve past the seeing,
and FWHM ∝ 1/r₀ follows analytically from the OTF being Fried's form.

**Ensembles are sized for convergence, and that is the cost.** The long-exposure
quantities are averages over many screens and the low-order wander converges as
1/√N, so these rungs run ~120 screens each and are the heaviest in the suite
(~35 s). Fewer screens passed on one seed set and drifted on the next — the FWHM
of the mean moved 16% between 30 and 60 screens at D/r₀ = 10 — so the ensemble
size is set by measured convergence, not guessed, and the tolerances were fixed
only after checking N = 80 against N = 160.

**The geometric branch is deferred, and honestly.** A phase screen has no
amplitude mask, so — unlike the spider, whose shadow carried into the ray
histogram — seeing has no geometric counterpart here: the ray-drop's analog
would be deflecting each ray by ∇φ, a separate capability. This matters only
when the *system's own* aberration is bad enough to trip the fidelity fallback;
a well-corrected telescope on axis, which is where seeing is actually watched,
stays on the FFT branch and images correctly. The trap the deferral must not
spring is a screen the FFT grid cannot resolve — and the fidelity criterion is
measured on the raw traced samples, so it is *blind to the screen*. That is why
a rung asserts `maxGridPhaseStepWaves < ½` on the final pupil directly: it is
the only thing that catches an under-resolved screen, and it holds even under
strong seeing (0.19–0.23 waves at D/r₀ = 4–8). The pairing to state is the
spider's, one branch further: **the spider's spike is an FFT phenomenon and its
shadow a geometric one; seeing is an FFT phenomenon whose geometric analog is
not yet built** — named, not overlooked.

**The screen is now wired into the pipeline, at plumbing scope.** A `seeing`
screen on `SystemPsfOptions` is composed in `psf()` as the last wrapper on the
pupil — `psf({seeing})` is *bit-identical* to
`psfFromPupilFunction(withPhaseScreen(…))`, the equivalence rung above, so the
physics stays pinned on the generator and its ensemble rather than re-derived
through the wired path. It threads through the polychromatic stack with no code
change (`PolychromaticOptions extends SystemPsfOptions`, and one screen object
reaches every `adaptivePsf`), so the whole spectrum sees one atmosphere and the
bluer plane carries proportionally more waves of the shared OPD — the
colour-honesty rung. The guard rides up for free: `SpectralStack.maxGridPhaseStep
Waves` is the max across wavelengths, so it keys on the bluest, worst-resolved
plane. The app surfaces exactly that number on its **seeing dial**
(`seeingPhaseStepWaves`) as a live readout — green while resolved, red past ½.
A *readout, not a binary warning*, and the reason is empirical: at D/r₀ = 4 the
singlet's readout reads **0.53 waves/sample and turns red** — the gate genuinely
trips inside the app's own range, not only under a deliberately under-sampled
screen. It trips because the guard measures the *final* pupil (native aberration
+ screen): the singlet's uncorrected chromatic wavefront — worst in the bluest
plane, which the stack maxes over — adds to the shared screen, while the
well-corrected achromat sits at 0.34 and stays green on the byte-identical
screen. So the number carries more than a threshold could: it shows *where* the
wavefront sits on the grid at every dial value and turns red exactly when the
total gradient crosses ½ — and honours "every number on screen comes from the
engine." (An earlier note here claimed this fixed 256²/oversize-4 screen "keeps
the step ≈ 0.2–0.3 waves/sample at every dial value," so a warning would be dead
code; the running app disproves it — 0.53 at D/r₀ = 4. That reasoning was
measured on the deferral rung's aperture-20 screen and does not carry to the
app's 4–20 mm apertures with their bluer polychromatic planes.) The app draws a
**single fixed-seed screen** (a short-exposure
speckle that morphs continuously as the dial moves, not the ensemble-averaged
disc), and dials **D/r₀** rather than r₀ so the effect stays visible at the toy
4–20 mm apertures; the long-exposure ensemble and the field-panel wiring are
named next.

## Step 5e — the classical Cassegrain preset

The second reflecting preset, and the first two-powered-mirror instrument. Like
the Newtonian it has no design table to hide behind: a paraboloidal primary and
a convex hyperboloidal secondary, every number a closed form or a traced
consequence of one. It is the *pinnable* member of the Cassegrain family — the
Schmidt-Cassegrain the roadmap names corrects two spherical mirrors with an
OPTIMIZED, proprietary corrector plate that has no external number to pin
against, so it would violate the hard rule; the classical design has its number
for free because it is defined by geometry rather than optimization. The
aspheric corrector belongs to a later unit whose clean pin is a Schmidt camera
(single spherical mirror + corrector, textbook figure).

| Rung | Pinned to | Status |
|---|---|---|
| System EFL = m·f₁ = D·F, reported and traced paraxially | definition | ✅ |
| Secondary radius, conic and separation are the confocal closed forms | closed form | ✅ |
| Obstruction = s₁/f₁, the projected secondary | closed form | ✅ |
| Focus lands b behind the primary vertex (the accessible-focus payoff) | closed form | ✅ |
| Refuses a system faster than its primary, and an oversize back focus | validity | ✅ |
| **On axis the two confocal conics are stigmatic: RMS < 1e-6 waves** | conic focal property | ✅ |
| **Diffraction-limited on axis: Strehl 1** | conic focal property | ✅ |
| **The confocal formula is stigmatic across m = 2, 3, 4, not just one m** | conic focal property | ✅ |
| A spherical secondary is NOT stigmatic (⅓ wave, Strehl < 0.1) | negative control | ✅ |
| The whole beam gets through; a secondary cut to the paraxial cone clips it | sag footprint | ✅ |
| An obstructed pupil passes 1 − ε² of the light | annulus area | ✅ |
| A star lands at ≈ f·tan θ — with a real distortion residual — at its azimuth | plate scale + distortion | ✅ |
| Coma matches the third-order θ·D/(32F²√72) at the system focal ratio | third-order theory | ✅ |
| **Coma equals a paraboloid of the same SYSTEM focal length, to four figures** | cross-check (see below) | ✅ |
| Coma ∝ field angle, tight in the small-angle regime | scaling | ✅ |
| Coma ∝ 1/F² at fixed primary | scaling | ✅ |
| Coma ∝ aperture at fixed focal ratios | scaling | ✅ |

**It is authored `unfolded`, not folded — the counter-intuitive part.** The
Newtonian needed the fold because its diagonal steers the beam out the side of
the tube. A Cassegrain does not: the primary reflects the beam straight back
(−z), the secondary reflects it forward again (+z) through a hole in the primary
to a focus behind it, every vertex on one z-axis with thicknesses alternating
sign per mirror. That is *exactly* the two-curved-mirror case already pinned
against the mirror equation in `compile.test.ts` — so the preset needed no new
trace machinery, only the design math and these rungs. The primary's central
hole is obstruction bookkeeping, not an annular aperture: the sequential trace
meets the primary once, on the way in, where the beam is wide and the hole a
small near-axis region the marginal rays miss; the returning beam is
post-secondary and is never re-tested against it.

**The on-axis rung is the strongest here and needs no table, exactly as the
Newtonian's does.** A paraboloid images an axial point at infinity with zero
error; a hyperboloid images one of its geometric foci onto the other with zero
error. Place the hyperboloid's near focus on the paraboloid's focus and the pair
is stigmatic *exactly* — not to third order, to numerical precision. The traced
RMS sits at 1.5e-10 waves and every ray height crosses the axis at the same
point to six figures. Writing the design turned up the one place a sign or a
factor can hide and still pass a paraxial check: the secondary radius is
2·m·s₁/(m−1), and the tempting (m+1) denominator under-powers it by exactly a
factor of two — the beam then *diverges* out of the secondary to a virtual focus
with the right cone angle but the wrong sign, so a paraxial-only test that
matched cone angles would sail through. The stigmatism pin catches it at once
(RMS jumps from 1e-10 to hundreds of waves), which is why the exact
conic-focal-property rung is worth more than a paraxial layout check. The
spherical-secondary negative control (⅓ wave even at best focus, against the
hyperboloid's 1e-10) proves the conic, not the layout, is what nulls it.

**The formula is pinned across magnifications, not just at one.** A single
stigmatic design would only prove k₂ = −((m+1)/(m−1))² *at that m* — and a wrong
conic at another magnification injects rotationally symmetric SPHERICAL
aberration, which the j = 8 coma rungs are structurally blind to and the
cross-check below could not see either (that compares coma). So a dedicated rung
runs the on-axis wavefront at m = 2, 3 and 4 (two routes to m = 4, from different
primaries): all sit at ~2·10⁻¹⁰ waves with nothing lost. That is what pins the
*formula* rather than one instance of it.

**The external coma pin is the third-order θ·D/(32F²) at the SYSTEM focal
ratio**, the same closed form the Newtonian uses, and it sits just under 1 for
the same reason: the trace carries the higher-order coma the theory omits,
shrinking as the system slows (0.12% at F/8, 0.06% at F/16). The **cross-check**
beside it — that the traced Cassegrain coma equals the traced coma of a
prime-focus paraboloid of the system focal length, to four figures across three
designs — is engine-vs-engine and so is a *consistency* check by this ladder's
own rule (it earns its place because the equivalent-paraboloid coma is itself
externally pinned, by § 4b's single-mirror rungs, and because it ties the new
two-mirror preset to that already-validated machinery — but the external number
is the third-order one, not this).

**Two tolerances are set by real physics, not convenience, and are recorded so
the numbers are on the record rather than looking like slack.** The plate scale
is f·tan θ only *approximately*, because a Cassegrain has distortion (the single
paraboloid Newtonian does not, which is why its rung held to six decimals): the
image height departs by a cubic term, 4e-5 relative at 0.3°, and the rung pins
it as ≈, the way § 3c does, because the gap is the physics. The coma-linearity
rung then follows this ladder's standing discipline — *tighten the regime, don't
widen the band*: it is asserted at 0.05° → 0.1° (ratio 1.9999) where the linear
coma dominates, rather than over a 4× lever where the Cassegrain's fast (F/4)
primary folds in a genuine higher-order field term. That term is real and
measured, not a tolerance excuse: from 0.1° to 0.4° the coma grows 3.994× (not
4×) and the equivalent-paraboloid cross-check drifts from 0.99991 to 0.99857 in
lockstep — so the sublinearity is kept *out* of the linearity rung, where a slow
paraboloid would have hidden it, rather than absorbed into a loose band.

### Not yet pinned
- **The secondary is circular and on-axis.** A Cassegrain secondary offset or
  tilt (the misalignment tolerancing case) is expressible but unpinned, and the
  circular clear aperture is sized to the on-axis beam, so off-axis vignetting by
  the secondary is exercised by nothing yet — the same status the Newtonian's
  diagonal has.
- **Astigmatism and field curvature** are present in the trace and unpinned;
  coma dominates a classical Cassegrain off axis but it is not the only term, and
  the field curvature of a Cassegrain is strong.
- **App wiring.** The engine preset exists and is pinned; the app still renders
  only the refractor path, as it does for the Newtonian. Belongs with the step-5
  app work.
- **The Schmidt-Cassegrain** is the family's remaining member: it needs the
  aspheric corrector, best pinned first through a Schmidt camera — which has now
  landed (§ 5g), so the corrector figure the SCT reuses is pinned to a closed
  form. (The **Ritchey-Chrétien** named here has also landed — § 5f below.)

## Step 5f — the Ritchey-Chrétien preset

The third reflecting preset, and the coma-nulled sibling of the classical
Cassegrain. An RC is a Cassegrain-form telescope in which *both* mirrors are
hyperboloids, the conics chosen to make it **aplanatic** — free of third-order
coma *and* spherical aberration. It shares the Cassegrain's entire layout —
aperture, focal length, magnification, separations, radii, obstruction — through
one `twoMirrorLayout`, and differs *only* in the two conic constants. That
sharing is the textbook fact the preset rests on, and the reason the layout
cannot drift between the two designs; the load-bearing anti-drift move is a code
extraction, not a comment.

| Rung | Pinned to | Status |
|---|---|---|
| System EFL = m·f₁ = D·F, reported and traced paraxially | definition | ✅ |
| **Same layout as the classical Cassegrain, conics apart** | shared closed form (see below) | ✅ |
| K₁ = −1 − (2/m³)(s₂/d), K₂ = −1 − (2/(m−1)³)[m(2m−1) + s₂/d] | consistency + the s₂-vs-b trap (see below) | ✅ |
| Both conics < −1 (both mirrors hyperboloidal); the secondary stronger than the Cassegrain's | aplanatic theory | ✅ |
| Focus lands b behind the primary vertex | closed form | ✅ |
| Refuses a system faster than its primary, and an oversize back focus | validity | ✅ |
| **On axis: diffraction-limited but NOT exactly stigmatic — 3rd-order spherical only** | RC corrects 3rd order | ✅ |
| …the residual is fifth-order: it falls > 20× when the primary slows 2× | 5th-order scaling | ✅ |
| The whole beam gets through; a secondary cut to the paraxial cone clips it | sag footprint | ✅ |
| A star lands at ≈ f·tan θ — with a distortion residual — at its azimuth | plate scale + distortion | ✅ |
| **Coma nulled: RC coma < 1% of the classical Cassegrain's at the same D, F** | aplanatism (the headline) | ✅ |
| …and < 1.5% of the third-order θ·D/(32F²√72) at the system focal ratio | third-order theory | ✅ |
| **Astigmatism NOT nulled: ≈ the Cassegrain's, and ≫ the RC's own coma** | targeted-correction negative control | ✅ |

**The conic formula is the one place a factor hides and still typechecks, so it
carries two guards, and the honest labelling matters.** The conic-value row is a
**consistency check, not an external pin** — the test recomputes the same
algebra the preset uses and compares, so a *structural* transcription error (a
wrong power, a misplaced bracket) would be copied into both sides and pass. What
that row *does* catch independently is the **s₂-vs-b trap**: Wikipedia's
variables map onto the Cassegrain code as M = m (the secondary magnification),
D = d (the mirror separation) and — the trap — **B = s₂ = d + b, the
secondary→focus distance, not the primary back focus b.** The identity
(F − B)/D = m *forces* B = s₂, so the mapping is derived rather than guessed; the
test computes s₂ = d + b from that correct definition and hardcoded numbers
(d = 537.5, s₂ = 787.5), so a preset that reached for b instead would mismatch
and fail. For D = 200, F₁ = 4, F = 12, b = 250 the closed form gives K₁ = −1.10853
(a mild hyperboloid, just past the Cassegrain's parabolic primary) and
K₂ = −5.11628 (stronger than the Cassegrain's −4) — the extra figuring on both
mirrors is exactly what buys the coma correction.

**The external pin on the conics is the trace, not the formula row.** That these
particular conics are the *aplanatic* solution — rather than any other
two-hyperboloid pair — is validated by the coma-null and on-axis-spherical rungs
below, which run the ray trace and fail on a wrong formula whatever its
structure: a mistyped exponent gives conics that do not null coma, and the
coma-null rung reads it at once.

**The on-axis rung is where the RC parts company with the Cassegrain, and the
difference is pinned rather than glossed.** The confocal Cassegrain is stigmatic
to *all* orders (~1e-10 waves, § 5e); the RC nulls only *third-order* spherical,
so on axis it carries a fifth-order residual — measured 4.5·10⁻⁵ waves at best
focus, still deep inside the Maréchal limit (Strehl 0.99999) but three orders
above the Cassegrain's floor. Copying the Cassegrain's `rmsWaves < 1e-6` /
`Strehl ≈ 1` rung here would have been wrong physics; the honest rung asserts
diffraction-limited-but-nonzero and contrasts it against the confocal design
built from the same spec. That the residual is genuinely *fifth*-order and not a
constant offset is its own rung: slowing the primary from f/4 to f/8 at fixed
magnification drops it ~34× (a third-order defect, being nulled, would not
move) — the same "tighten the regime and watch a higher-order term vanish"
signature the Newtonian's and Cassegrain's coma rungs carry.

**The coma null is the headline, and it is pinned against the classical
Cassegrain on the identical geometry.** Because the two presets share a layout,
they carry the same third-order coma budget — except the RC's conics zero it.
So the traced RC coma (Noll j = 8) comes back at 0.13–0.67% of the classical
Cassegrain's coma at the same D and F, and below 1.5% of the third-order
θ·D/(32F²√72) the Newtonian and Cassegrain are pinned to. The magnitude null is
what is asserted, **not a field-power law**: the RC's fifth-order coma residual
still contains a field-linear term (W151), and near the Zernike-fit floor its
apparent scaling is noisy (1.79× rather than 2× from 0.1° to 0.2°), so a scaling
rung would be pinning fit noise. Claiming coma went superlinear would be the same
over-reach the ladder avoids elsewhere.

**The astigmatism negative control is what proves the correction is coma-specific
rather than global** — the strongest guard against "I built something that merely
looks like an RC." Wikipedia states the RC keeps "severe large-angle
astigmatism," and it does: at 0.3° the RC's astigmatism (j = 5, 6) is 1.1–1.2×
the classical Cassegrain's — essentially untouched — and 50–2000× its own
residual coma. The RC traded a fifth-order spherical residual on axis for a
third-order coma null off it, and left astigmatism and field curvature exactly
where the Cassegrain had them.

### Not yet pinned
- **The secondary is circular and on-axis**, as the Cassegrain's is: an offset or
  tilt (misalignment tolerancing) is expressible but unpinned, and off-axis
  vignetting by the secondary is exercised by nothing yet.
- **Astigmatism and field curvature** are present in the trace and, beyond the
  "not nulled" negative control above, unpinned to an external number — the RC's
  field curvature is strong and dominates its usable field once coma is gone.
- **App wiring.** The engine preset exists and is pinned; the app still renders
  only the refractor path, as it does for the Newtonian and Cassegrain.

## Step 5g — the Schmidt camera preset

The fourth reflecting preset, and the first that uses the engine's even-asphere
path for **physics** rather than a round-trip geometry check. A Schmidt camera is
a *spherical* primary mirror with an aspheric corrector plate at its centre of
curvature; the plate nulls the sphere's spherical aberration, and the stop at the
centre of curvature makes the whole thing an anastigmat. It is the preset the
roadmap named as the clean external pin for aspheric correction — the figure a
Schmidt-Cassegrain reuses — because unlike an SCT's optimised corrector, the
Schmidt corrector has its fourth-order figure in closed form.

| Rung | Pinned to | Status |
|---|---|---|
| f = R/2 = D·F, mirror radius = 2f, paraxial EFL magnitude = f | definition | ✅ |
| Corrector A₄ = −1/(4(n−1)R³), from the scalars n and R | consistency + the trace pins it (see below) | ✅ |
| Image forms at the prime focus, R/2 in front of the mirror | closed form | ✅ |
| Refuses non-positive geometry, an over-thick plate, an unknown glass | validity | ✅ |
| Whole beam through; nothing vignettes on axis | footprint | ✅ |
| **On axis: the corrector nulls 3rd-order spherical — ~100× better than the bare sphere, diffraction-limited (Strehl > 0.95)** | 3rd-order correction (the headline) | ✅ |
| **The corrector's SIGN is load-bearing: flip A₄ and the error ≈ doubles the bare sphere's** | sign negative control | ✅ |
| **Anastigmat: coma AND astigmatism < 1% of an equal-f/D paraboloid's (3–4 orders down)** | stop at centre of curvature (the wide-field headline) | ✅ |
| At f/10 the design-λ residual < 1e-3 waves | 3rd-order null exact; f/4 residual was pure 5th-order | ✅ |
| **Spherochromatism: Δc₁₁(λ) = (n(λ)−n(550))·A₄·(D/2)⁴/(6√5)/λ, matched to a few %** | dispersion × corrector figure | ✅ |
| …the shift is monotonic across the visible band | dispersion sign | ✅ |

**The corrector figure has a closed form, but — as with the RC's conics (§ 5f) —
the formula-equality row is a consistency check, and the external pin is the
trace.** A sphere and the paraboloid of the same vertex radius R differ in sag by
r⁴/(8R³); reflection doubles that into r⁴/(4R³) of wavefront error; a glass plate
retards by (n−1) per unit thickness, so the plate that cancels it has
A₄ = −1/(4(n−1)R³) (Rutten & van Venrooij; Schroeder). The test evaluates that
from n = `getMedium("FUSED-SILICA").n(550)` and R and checks the preset's reported
`correctorA4` to 18 digits — but the preset hardcodes the same formula, so this
row catches a *unilateral* transcription drift, not a *conceptual* error copied
into both sides (a believed 2· for the 4· would pass). What pins A₄ to physics is
the on-axis pair below: the null pins the **magnitude** — scale A₄ by 1.5 and the
net becomes −½·r⁴/(4R³), ~0.42 waves, and the `corrected < 0.02` rung fails — and
the sign-flip pins the **sign**. Those fail on a conceptually-wrong figure
whatever its self-consistency, exactly as the RC's coma-null rung pins its conics
rather than the formula row.

**On axis the Schmidt parts company with the confocal Cassegrain, and the rung
says so.** The Cassegrain's two conics are stigmatic to all orders (§ 5e); the
Schmidt corrector nulls only *third-order* spherical, leaving a fifth-order
residual (∝ 1/F⁵). So the headline is not "Strehl = 1" but "diffraction-limited
and a large factor better than the bare sphere": at f/4 the on-axis wavefront
collapses from 0.84 waves (a flat plate — the bare sphere) to 0.008 waves
(Strehl 0.986), ~100×. That the residual is genuinely fifth-order is its own
rung — at f/10 it has all but vanished (7.7·10⁻⁵ waves), which is the on-axis
proof that A₄ nulls the third-order term *exactly*.

**The sign control is the sharpest proof the figure is doing physics, not
cosmetics.** Flip A₄ and the corrector adds its r⁴/(4R³) *on top of* the mirror's
instead of subtracting it, so the error comes back at ≈ 2× the bare sphere's
(measured 1.98×) — a distinctive signature a mere magnitude error could not fake.
Removing the corrector entirely (a flat plate) is the companion control that
restores the full sphere aberration.

**The anastigmatism is the Schmidt's reason to exist, and it is pinned against a
paraboloid of the same focal ratio.** With the stop at the centre of curvature
every field angle sees the sphere down a radius, so third-order coma *and*
astigmatism vanish by symmetry. The cross-check is a prime-focus paraboloid of
the same system f/D with its stop at the mirror: it carries the full coma and
astigmatism of a fast reflector, and the Schmidt's Zernike coma (j = 8) and
astigmatism (j = 5, 6) come back three to four orders of magnitude smaller
(< 1% at 0.3° and 0.5°). Measured by coefficient at best focus, so the Schmidt's
own curved focal surface — a defocus term (j = 4) — does not contaminate the read.

**Spherochromatism falls out of the same trace, and it too gets a closed-form
pin.** The corrector is figured for one wavelength; away from it (n−1) drifts, so
the cancellation is imperfect by exactly the corrector's own r⁴ figure scaled by
the index change: (n(λ)−n(550))·A₄·r⁴ — a *pure* primary-spherical term, hence
refocus-invariant, whose Zernike j = 11 projection is Δc₁₁(λ) =
(n(λ)−n(550))·A₄·(D/2)⁴/(6√5)/λ (from ρ⁴ = Z₁₁/(6√5) + defocus + piston). This is
pinned on a *slow* f/10 camera on purpose: the fifth-order monochromatic residual
also lands on j = 11 but scales as 1/F⁵, so at f/10 it has shrunk to a few
percent and the traced chromatic shift sits just under the pure-3rd-order line
(magnitude 0.96–0.98 of the closed form) — the same "just below the third-order
coefficient, because the trace carries the higher order the formula omits"
signature the Cassegrain coma rung carries. The shift is monotonic across the
band because the dispersion is.

**The corrector glass overfills its clear aperture by 2%.** The aperture stop —
the pupil — is D/2, set by the system's stop radius; the traced corrector faces
run a hair wider so the pupil's own rim ring is not numerically shaved at this
aspheric surface (a flat plate does not need it; an even-asphere stop does). It
is the Schmidt analogue of sizing the Cassegrain secondary to its sag-exact
footprint rather than the paraxial cone: it moves no ray inside the pupil and
does not change the stop, and the "whole beam through, nothing vignettes" rung
holds it to `lost === 0`.

### Not yet pinned
- **The neutral-zone r² term.** A real Schmidt corrector adds a balancing r²
  (paraxial-power) term that shifts the design wavelength and rebalances the
  chromatic/defocus budget across the band. This preset is pure r⁴, so its
  design-λ residual is a plain fifth-order term; the neutral-zone refinement is
  a later, chromatic story, not the monochromatic third-order null pinned here.
- **The curved (Petzval) focal surface.** The Schmidt images onto a sphere of
  radius ≈ f, not a plane. The aberration rungs read Zernike coefficients at best
  focus, so the field-curvature defocus is removed rather than pinned; a flat-field
  Schmidt (a field flattener at the focal surface) is unbuilt.
- **The prime-focus obstruction.** The detector sits *in* the beam, between
  corrector and mirror. As with the Newtonian's diagonal and the Cassegrain's
  secondary, it is obstruction bookkeeping applied in the pupil function, not a
  traced blocker, and it is not yet wired for this preset.
- **App wiring.** The engine preset exists and is pinned; the app still renders
  only the refractor path, as it does for the Newtonian, Cassegrain and RC.

## Step 5h — the Schmidt-Cassegrain preset

The fifth reflecting preset, and the first that exists to **compose** two units
rather than introduce new physics: it is a Schmidt corrector (§ 5g) on the
primary of a Cassegrain-form pair (§ 5e). The variant built is a *Schmidt-
corrected Cassegrain* — spherical primary + Schmidt corrector at its centre of
curvature + convex confocal-hyperboloid secondary — **not** the commercial all-
spherical "compact SCT", whose corrector is an optimised proprietary surface
with no external number (the tension recorded in `cassegrain.ts`). Every number
here stays a closed form: the corrector figure is the Schmidt A₄ referenced to
the *primary* radius R₁ = 2f₁, and the secondary conic is the classical
Cassegrain's confocal hyperboloid — both reused verbatim, not re-derived.

| Rung | Pinned to | Status |
|---|---|---|
| f = D·F, primary f₁ = D·F₁, R₁ = 2f₁, paraxial EFL = m·f₁ | definition | ✅ |
| Corrector A₄ = −1/(4(n−1)R₁³), from scalars n and R₁; corrector sits at R₁ | consistency + the trace pins it (below) | ✅ |
| **Shares the classical Cassegrain's MIRROR layout exactly — separation, secondary radius, confocal conic, obstruction all equal; only the primary (sphere vs paraboloid), stop and corrector differ** | shared `twoMirrorLayout` (anti-drift) | ✅ |
| Obstruction ε = s₁/f₁ the secondary projects onto the pupil | closed form | ✅ |
| Focus lands b behind the primary vertex, at z = R₁ + b | closed form | ✅ |
| Refuses a system faster than its primary, an oversize back focus, an over-thick plate, an unknown glass | validity | ✅ |
| Whole beam through; nothing vignettes on axis | footprint | ✅ |
| **On axis: the corrector nulls 3rd-order spherical — ~120× better than the corrector-removed sphere, diffraction-limited (Strehl > 0.95)** | 3rd-order correction | ✅ |
| **The corrector's SIGN is load-bearing: flip A₄ and the error ≈ doubles the bare sphere's** | sign negative control | ✅ |
| **Diffraction-limited but NOT exactly stigmatic: ~5 orders above the confocal Cassegrain on the same spec** | 3rd-order-only correction (the headline distinction) | ✅ |
| **Carries a FIFTH-order residual: it falls ~32× when the primary slows f/4 → f/8** | 1/F⁵ scaling (the 2⁵ signature) | ✅ |
| At a primary f/10 the design-λ residual < 1e-3 waves | 3rd-order null exact; f/4 residual was pure 5th-order | ✅ |
| **Spherochromatism: Δc₁₁(λ) = (n(λ)−n(550))·A₄·(D/2)⁴/(6√5)/λ, matched to a few %** | dispersion × corrector figure | ✅ |
| …the shift is monotonic across the visible band | dispersion sign | ✅ |
| Obstruction stays in the pupil function, not the geometry (blocked/clear energy = 1 − ε²) | annulus area | ✅ |

**The anti-drift rung is the load-bearing structural one.** An SCT and a
classical Cassegrain built from the same spec must be the same *mirror pair* —
identical separation, secondary radius, confocal conic (both −4 at m = 3) and
obstruction — because both flow through `twoMirrorLayout`. What the SCT changes
is exactly and only: the primary becomes a **sphere** (conic 0, corrector-nulled)
where the Cassegrain's is a paraboloid, and the **stop moves to the corrector**.
Pinning the shared numbers equal while the primary conic differs is the same
both-sides pin the RC carries against the Cassegrain (§ 5f), and it is what stops
a future edit to the layout from silently desynchronising the two-mirror presets.

**The stop is on the corrector, and that is why the field aberrations are NOT
cross-checked against the Cassegrain.** Placing the stop at the primary's centre
of curvature is what lets the r⁴ figure transfer exactly (the input beam is
collimated, so ray height is preserved plate → primary), but it also gives the
system a different coma and astigmatism budget than the stop-at-primary
Cassegrain. So — unlike the RC, whose whole point is a coma cross-validation
against the Cassegrain — the SCT's off-axis terms are left in the trace and
unpinned. The two genuinely-new pins are on axis instead, and they are exactly
the two prices the cheap spherical primary buys.

**On axis it parts company with the confocal Cassegrain, and the rung says so —
for a different reason than the RC's.** The classical Cassegrain is stigmatic to
all orders (§ 5e); the SCT, like the Schmidt camera (§ 5g), nulls only *third-
order* spherical and keeps a fifth-order residual. At f/4 the on-axis wavefront
is 0.007 waves (Strehl 0.986) against a corrector-removed 0.84 (~120×), and it
sits ~5 orders above the confocal Cassegrain's ~1e-8 on the identical spec. That
the residual is genuinely fifth-order is its own rung: slowing the primary f/4 →
f/8 drops it ~32× — the 2⁵ signature of a fifth-order term, the same the RC shows
(§ 5f). At a primary f/10 it has all but vanished (7·10⁻⁵ waves), the on-axis
proof that A₄ nulls the third order *exactly*. The sign control (flip A₄ →
≈ 2× the bare error) pins the corrector's sign, exactly as for the Schmidt camera.

**Spherochromatism is the one behaviour no all-mirror preset has, and it is why
the SCT earns its own place rather than being a corrected Cassegrain footnote.**
The refractive corrector is figured for one wavelength; away from it the residual
is the corrector's own r⁴ figure scaled by the index change — a pure primary-
spherical term, refocus-invariant, whose j = 11 projection is the closed form
above. Pinned on a slow (primary f/10) camera on purpose, so the fifth-order
monochromatic residual (also on j = 11, ∝ 1/F⁵) has shrunk to a few percent and
the traced chromatic shift sits at 0.96–0.98 of the closed form — the same "just
below the third-order line because the trace carries the higher order the formula
omits" signature the Cassegrain coma and Schmidt spherochromatism rungs carry.

**The corrector, primary and secondary each overfill their clear aperture by 2%.**
The pupil is D/2, set by the system's stop radius. The corrector and primary run
a hair wider so the pupil's rim ring is not shaved at the aspheric stop, as for
the Schmidt camera. The secondary needs its *own* extra margin beyond
`twoMirrorLayout`'s sag-exact cone: the corrector refracts the marginal ray
outward (the very bend that corrects the SA), so it reaches the secondary ~0.5%
wider than the bare-Cassegrain footprint, which assumes the ray leaves the
primary rim at D/2. The same 2% clears it on every geometry the rungs exercise,
the reported obstruction stays the clean paraxial ε, and "whole beam through"
holds it to `lost === 0`.

### Not yet pinned
- ~~The all-spherical commercial SCT.~~ **Landed at § 5i.** The Celestron/Meade
  design keeps both mirrors spherical and lets the corrector null the *combined*
  two-mirror spherical aberration, via the published two-mirror Seidel closed form
  (Schroeder Ch. 6; Rutten & van Venrooij).
- **Off-axis field aberrations.** Coma, astigmatism and field curvature are in
  the trace but unpinned (the stop-at-corrector budget is neither the
  Cassegrain's nor a clean closed form). The SCT is a compromise between the
  Schmidt's wide field and the Cassegrain's compactness, not an anastigmat.
- **Off-axis vignetting is a sizing artifact here, not physics.** The mirrors are
  sized for the on-axis beam only, exactly as the Cassegrain/RC secondary is, so
  an off-axis pupil clips — measured ~9% at 0.3° — and it clips at *both* mirrors,
  worse than the Cassegrain/RC, because the forward stop (at the corrector) walks
  the beam off the D/2 primary as well as the secondary, where the siblings' stop
  *is* the primary and only their secondary clips. This does not touch any rung
  (all run on axis, `lost === 0`), but a copied off-axis rung would fit over a
  clipped pupil. **Sizing is rung-driven in this project** — the Schmidt
  field-sizes because its anastigmat rung asserts `lost === 0` off axis; the
  two-mirror presets do not, because their off-axis rungs measure wavefront shape
  over the survivors. Field-sizing all three two-mirror presets uniformly (propagate
  the R·tanθ chief-ray walk to primary and secondary) is a shared, app-field-render-
  driven deferral, to be done together when the app needs off-axis beams to pass —
  not an SCT one-off on fresh sizing math.
- **The prime-focus / secondary obstruction and the primary hole.** Obstruction
  bookkeeping in the pupil function, not traced blockers, as for the Cassegrain
  and Schmidt.
- **App wiring.** The engine preset exists and is pinned; the app still renders
  only the refractor path, as it does for the other four reflecting presets.

## Step 5i — the all-spherical commercial SCT preset

The sixth reflecting preset, and the last of the Schmidt family: the "compact
SCT" sold as a Celestron/Meade tube — **two spherical mirrors** (the cheapest
optics there are) and one aspheric corrector plate at the primary's centre of
curvature, figured to null the **combined** spherical aberration of both spheres.
It is structurally the Schmidt-Cassegrain (§ 5h) with the secondary conic set to
0 and a stronger-story corrector, and it is the preset the roadmap held back until
a closed form for the two-mirror corrector was in hand.

The external number is the two-mirror Seidel corrector (Schroeder, *Astronomical
Optics* Ch. 6; Rutten & van Venrooij, *Telescope Optics*). Third-order spherical
aberration is exactly linear in each mirror's conic, so the corrector nets two
entrance-pupil r⁴ terms:

    (n−1)·A₄ = −1/(4R₁³)  −  k₂·ε⁴/(4R₂³)          k₂ = −((m+1)/(m−1))²
             = −1/(4R₁³)  +  ((m+1)/(m−1))²·ε⁴/(4R₂³)

— the Schmidt primary term (§ 5g), **minus** the secondary sphere's own SA, the
one the classical Cassegrain's confocal hyperboloid used to cancel. ε = s₁/f₁ is
the obstruction (the fractional beam height at the secondary), R₁ = 2f₁, R₂ the
secondary radius. The secondary term **subtracts**: a convex sphere is *over*-
corrected, opposite in sense to the concave primary, so the two spheres partially
cancel and the corrector is *weaker* than the primary-only Schmidt figure — 0.61×
on this f/12, primary-f/4 tube.

| Rung | Pinned to | Status |
|---|---|---|
| f = D·F, primary f₁ = D·F₁, R₁ = 2f₁, paraxial EFL = m·f₁ | definition | ✅ |
| **BOTH mirrors are spheres (conic 0) — the defining feature of the commercial SCT** | design definition | ✅ |
| **Corrector A₄ = −1/(4(n−1)R₁³) − k₂ε⁴/(4(n−1)R₂³), from scalars, and WEAKER than the primary-only Schmidt figure (0.61×)** | two-mirror Seidel closed form + the trace pins it (below) | ✅ |
| **Shares the classical Cassegrain's MIRROR layout exactly — separation, secondary radius, obstruction all equal; but the secondary is a SPHERE here, not the confocal hyperboloid** | shared `twoMirrorLayout` (anti-drift) | ✅ |
| Obstruction ε = s₁/f₁ the secondary projects onto the pupil | closed form | ✅ |
| Focus lands b behind the primary vertex, at z = R₁ + b | closed form | ✅ |
| Refuses a system faster than its primary, an oversize back focus, an over-thick plate, an unknown glass | validity | ✅ |
| Whole beam through; nothing vignettes on axis | footprint | ✅ |
| **On axis: the corrector nulls the COMBINED 3rd-order spherical — diffraction-limited (Strehl > 0.95), ~160× better than the corrector-removed pair** | 3rd-order correction | ✅ |
| **The SECONDARY term earns its keep: combined ≪ primary-only-corrector ≪ wrong-sign, and wrong-sign ≈ 2× primary-only** | the ΔA₄ ladder (the sign/magnitude discriminator) | ✅ |
| **Diffraction-limited but NOT exactly stigmatic: ~5 orders above the confocal Cassegrain on the same spec** | 3rd-order-only correction | ✅ |
| **Carries a FIFTH-order residual: it falls ~31× when the primary slows f/4 → f/8** | 1/F⁵ scaling (the 2⁵ signature) | ✅ |
| At a primary f/10 the design-λ residual < 1e-3 waves | 3rd-order null exact | ✅ |
| **Spherochromatism: Δc₁₁(λ) = (n(λ)−n(550))·A₄·(D/2)⁴/(6√5)/λ, matched to a few %** | dispersion × combined corrector figure | ✅ |
| …the shift is monotonic across the visible band | dispersion sign | ✅ |
| Obstruction stays in the pupil function, not the geometry (blocked/clear energy = 1 − ε²) | annulus area | ✅ |

**The secondary-term sign is sourced externally, and the trace only confirms it.**
The one load-bearing sign here — whether the secondary term adds to or subtracts
from the primary's — is fixed by an external datum, *before* any trace: the
**Dall-Kirkham** telescope (spherical secondary, aspheric primary, no corrector)
has a *prolate ellipsoid* primary, conic ≈ −0.7, LESS aspheric than a paraboloid.
With the Schmidt-validated calibration that a primary conic K contributes
+K/(4R₁³), a Dall-Kirkham nulls only if the spherical secondary's SA W_s < 0 (so
that 1 + K₁ > 0). That fixes the convex secondary as *over*-corrected, hence the
subtraction and the weaker corrector. Committing to the sign first is the point:
the trace's job is to confirm the closed form, never to pick between two signs by
seeing which one nulls — that would be fitting the corrector to the engine, the
exact circularity the hard rule forbids.

**The three-way ladder is the rung that earns this preset over the Schmidt-
Cassegrain.** A single-mirror Schmidt can only test its overall corrector sign (a
flip roughly doubles the error). It cannot test the SECONDARY term, because it has
no secondary. Here the ladder does, on the all-spherical system: the **combined**
corrector lands the on-axis wavefront at 3·10⁻³ waves; the **primary-only** Schmidt
figure (right for the primary, blind to the secondary) leaves |W_s| = 0.32 waves;
the **wrong-sign** secondary term (primary-only minus the secondary term instead of
plus) *adds* |W_s| and lands at 0.65 — twice the primary-only, to 0.5%. That the
middle rung is large (0.32 ≫ the 3·10⁻³ fifth-order floor) is what makes the ladder
discriminate; it is set on a primary-f/4 tube for exactly that separation. This is
the ΔA₄ lever made into a test — combined = primary-only + secondary-term, and the
ladder measures all three.

**On axis it parts company with the confocal Cassegrain the same way the rest of
the family does.** The classical Cassegrain is stigmatic to all orders (§ 5e); the
SCT, like the Schmidt camera (§ 5g) and Schmidt-Cassegrain (§ 5h), nulls only
*third-order* spherical and keeps a fifth-order residual — 3·10⁻³ waves at f/12
(primary f/4), ~5 orders above the confocal Cassegrain's ~1·10⁻⁸ on the identical
spec, and dropping ~31× (the 2⁵ signature) when the primary slows f/4 → f/8. At a
primary f/10 it has all but vanished (3·10⁻⁵ waves), the proof the combined A₄
nulls the third order exactly.

**Spherochromatism carries the same closed form as the rest of the family, now
with the combined A₄.** The refractive corrector is figured for one wavelength;
away from it the residual is the corrector's own r⁴ figure scaled by the index
change, a refocus-invariant primary-spherical term whose j = 11 projection matches
(n(λ)−n(550))·A₄·(D/2)⁴/(6√5)/λ to 0.98, on a slow (primary f/10) tube where the
fifth-order monochromatic residual has shrunk away — the same "just below the
third-order line" signature § 5g/5h show.

**Not an anastigmat, and the scope says so.** Unlike the single-mirror Schmidt
*camera* (§ 5g), whose stop at the mirror's centre of curvature makes coma and
astigmatism vanish, the two-mirror SCT's corrector is at the *primary's* centre of
curvature only; the secondary sees the field asymmetrically, so third-order coma
and astigmatism remain — the off-axis softness commercial SCTs are known for.
Those terms are traced but unpinned, exactly as for the Schmidt-Cassegrain, and
off-axis pupils vignette as a sizing artifact (both mirrors sized for the on-axis
beam), the shared two-mirror deferral recorded at § 5h. Every rung here runs on
axis, `lost === 0`.

## Step 5j — third-order sums, and the achromatic doublet preset

The refractor preset, and the first preset that is a **lens**. It arrives in two
halves, in that order and in one change: a third-order (Seidel) sum module pinned
against external closed forms, and the cemented achromatic doublet that is
*solved* with it.

### 5j.1 — `analysis/seidel`: the closed form, pinned before anything uses it

Every reflecting preset could be written down from geometry alone. A doublet
cannot: which of the infinitely many bendings of the same two elements makes the
spherical aberration vanish is not a geometric question, and the engine's own
traced residual must not be the thing that answers it — solving on the trace would
fit the design to the tracer and leave the trace nothing independent to confirm.
So the answer comes from the published third-order theory (Welford, *Aberrations of
Optical Systems*, ch. 8), with the marginal and chief rays' refraction invariants
A = n(y·c + u), Ā = n(ȳ·c + ū):

    S_I = −A²·y·Δ(u/n)        S_II = −A·Ā·y·Δ(u/n)        W₀₄₀ = S_I/8

and it is pinned FIRST, on two external numbers that between them fix the scale
and the entire shape dependence:

| Rung | Pinned to | Status |
|---|---|---|
| **A spherical mirror's S_I/8 = h⁴/(4R³), to 15 digits** | § 5g's sag-difference figure, derived independently and pinned through the Schmidt corrector — fixes the 1/8, the sign convention and the n′ = −n handling | ✅ |
| …and scales as h⁴ and 1/R³ exactly | closed form | ✅ |
| **A thin lens in air matches the published Coddington-factor closed form to 1e-8, over q ∈ [−2, 2] at two indices** — W₀₄₀ = h⁴/(32f³n(n−1))·[(n+2)/(n−1)·q² + 4(n+1)pq + (3n+2)(n−1)p² + n³/(n−1)], p = −1 | Jenkins & White; Hecht § 6.3 — the whole polynomial AND its absolute scale, not one evaluation | ✅ |
| …with the residual falling linearly in centre thickness (1.5e-6 at 1 µm, 1.5e-9 at 1 nm) | it is the honest thick-lens correction, not an error | ✅ |
| **Best-form minimum at q = 2(n²−1)/(n+2)** ≈ 0.71 at n = 1.5 — the steep face toward the beam | corollary of the bracket at p = −1 | ✅ |
| **A plano-convex singlet turned back-to-front carries 27/7 ≈ 3.86× the spherical aberration** | the classic orientation result, and a sign-sensitive check | ✅ |
| A singlet's S_I never reaches zero at any shape | why a doublet is needed at all | ✅ |
| **Traced j = 11 Zernike of a slow real singlet = S_I/8 predicted, to 5%** | the exact trace confirming the closed form, the other direction | ✅ |
| Refuses conics/aspheres (a different, uncomputed term), refuses S_II unless the stop is the first surface, refuses a non-positive marginal height | scope, stated not silently approximated | ✅ |

**The q sign is fixed by physics, not by recall.** The best-form shape factor is
quoted in the literature with both signs, because p carries both conventions. The
engine's minimum lands at q = **+**0.714 for n = 1.5, which is the biconvex-with-
the-steep-face-to-the-sky lens every plano-convex singlet is oriented as — and the
same convention that makes the back-to-front penalty 27/7 rather than 7/27. The
full-bracket rung is what settles it: it matches at every q, so the polynomial and
its sign convention are pinned together.

### 5j.2 — the achromatic doublet objective

Aperture and focal ratio in; three radii and a power split out, from the catalog.
A cemented doublet has three curvatures and two conditions — total power φ = 1/f
and achromatism φ₁/V₁ + φ₂/V₂ = 0, giving the classical split φ₁ = φ·V₁/(V₁−V₂) —
so exactly one freedom is left: the **bending**, which slides all three curvatures
together, changes no first-order and no chromatic property, and is what the design
spends on spherical aberration. It is solved from S_I = 0 above, on the real thick
prescription.

| Rung | Pinned to | Status |
|---|---|---|
| Power split φ₁ = φ·V₁/(V₁−V₂), φ₂ = −φ·V₂/(V₁−V₂), from the catalog's Abbe numbers | closed form | ✅ |
| Element powers land in the curvature differences: φᵢ = (nᵢ−1)Δc | maker's equation | ✅ |
| Traced EFL misses D·F by < 1e-3, one-sided, and is reported separately | Gullstrand thickness term, left in honestly | ✅ |
| **Exactly TWO spherical-aberration-null bendings exist, both with \|S_I\| < 1e-12** | the classical pair of roots | ✅ |
| **The branch is chosen on Σᵢ\|S_I,ᵢ\| — how violently the surfaces cancel — and that is the shallower-surfaced root, and the one the exact trace prefers** | third-order theory nulls the SUM; the un-modelled higher orders scale with the terms that had to cancel. Cross-glass evidence in § 5k | ✅ |
| **F and C land together — 1.5·10⁻⁴ f, against an equal-power singlet's 1/V ≈ 1/64: 100× better** | the achromatic condition, as a prediction of the trace | ✅ |
| …and the residual shrinks monotonically as t/f does (f/6 → f/50), below 5·10⁻⁵ | thin-lens design applied to a thick lens: O(t/f) | ✅ |
| **Secondary spectrum Δf/f = −(P₁−P₂)/(V₁−V₂) = −4.99·10⁻⁴ ≈ −1/2000 for N-BK7/F2**, from the catalog's partial dispersions alone | the classic crown-flint number; independent of aperture and focal ratio | ✅ |
| …and the trace measures it, converging on the closed form from above as the lens slows (1.08× at f/10, 1.02× at f/50) | dispersion × power split | ✅ |
| …and it dwarfs the F−C residual, so it is the real colour limit of the glass pair | closed form vs residual | ✅ |
| **On axis: diffraction-limited (0.0054 waves, Strehl > 0.99) where an equal-power N-BK7 singlet is at 0.32 waves — 60×** | the third-order null, confirmed by the exact trace | ✅ |
| **A plausible WRONG bending costs an order**: the midpoint of the two roots (max \|S_I\|, near-zero coma) lands at 0.089 waves, 16× worse | the bending is load-bearing | ✅ |
| …and the naive equiconvex crown, which happens to sit within 5% of the solved root for this glass pair, is still 4.6× worse with \|S_I\| ≫ 0 | near-coincidence recorded, not hidden | ✅ |
| …while all three bendings unite F and C alike: bending buys spherical aberration, not colour | the condition is on the powers | ✅ |
| **A FIFTH-order residual survives, falling 32× per doubling of focal ratio** (f/5→10, 6→12, 8→16 all in 28–36×) | 1/F⁵ at fixed aperture — the 2⁵ signature §§ 5f–5i also carry | ✅ |
| **S_II predicts the traced Zernike coma of BOTH branches to ~2%**, at two field angles | (S_II/2)ρ³cos θ → j = 8 with factor 1/(3√8) | ✅ |
| …coma is linear in field angle | third-order coma | ✅ |
| Refuses a reversed glass pair, one glass twice, an unknown glass, an edge-thickness-negative doublet, non-positive geometry | validity | ✅ |
| Whole beam through on axis, and `lost === 0` off axis out to 0.5° | footprint | ✅ |

**Choosing between the two roots is decided by cancellation, not by coma — and the
first answer here was wrong.** Both roots null the same third order, so the choice
has to be made on what third-order theory does *not* model. The criterion is
Σᵢ|S_I,ᵢ|: a solution whose surfaces each contribute little is robust, while one
that reaches zero by subtracting two large numbers drags large fifth-and-higher
order terms along (and tighter tolerances with them). It selects the visibly
shallower root, and the trace agrees in every catalog pair — 2.4× better on axis
for N-BK7/F2, 3.2× for silica/F2, 8× for CaF₂/N-BK7 (§ 5k).

The obvious first guess, "take the lower coma", survived N-BK7/F2 by luck and is
now a *negative* result recorded in the ladder: S_II runs monotonically through the
bending and crosses zero **between** the two roots, so the pair straddles the
coma-free shape and their comas come out similar in magnitude and opposite in sign
(+0.111 vs −0.129 mm/rad at 100 mm f/10). Neither root is aplanatic, the margin is a
few percent — and for the fluorite pair the lower-|S_II| root is the one that is
eight times worse on axis. Coma is reported per branch and does not decide.
Making S_I and S_II vanish together is not a matter of bending at all: it is a
constraint on the **glass pair**, or it needs the third freedom a broken-contact air
gap provides. Both are open.

For N-BK7/F2 the chosen root is the near-equiconvex crown with the almost-flat rear
face a Fraunhofer objective is recognised by: 468.3 / −429.0 / −4520.6 mm.

**The design is a prediction, not a construction — deliberately.** The power split
is the thin-lens closed form, imposed on elements 10 and 6 mm thick and left there.
It would have been easy to solve the split numerically until the thick lens united
F and C exactly; that would have made the headline chromatic rung true *by
construction* and worth nothing, the same defect the § 2f vignetting rung was
rewritten to remove. Instead the residual stays in, is reported, and is pinned
twice: two orders below a singlet's, and shrinking with t/f. The same discipline
puts the traced EFL a few parts in 10⁴ below D·F rather than fitting it away.

**What is not corrected.** Coma is not nulled (and is not what the branch choice
optimises); astigmatism and field curvature are traced and unpinned.
Spherochromatism (the bending is solved at one wavelength) is present in the trace
and unpinned here. The secondary spectrum is a property of the glass pair that no
bending can touch — beating it needs an anomalous-partial-dispersion glass, which
is § 5k.

## Step 5k — the ED (fluorite) refractor

The second half of the roadmap's "achromat/ED refractor", and it needs **no new
design code**: it is § 5j's `achromaticObjective` driven with CaF₂ (Malitson 1963,
new in the catalog) as the crown and N-BK7 as the mate. Everything that makes it
better comes from the glass data, which is precisely the claim to pin.

The lever is *not* the famous Vd = 95. Secondary spectrum is (P₁−P₂)/(V₁−V₂), and
what CaF₂ has that no ordinary glass does is an **anomalous relative partial
dispersion**: its P sits ≈ 0.018 BELOW the line the catalog's ordinary glasses fall
on, so paired with N-BK7 the two P's nearly match while ΔV stays large.

| Rung | Pinned to | Status |
|---|---|---|
| CaF₂: nd ≈ 1.4338, Vd ≈ 95.0 | Malitson 1963 via refractiveindex.info (materials.test) | ✅ |
| …and it disperses normally: n(F) > n(d) > n(C) — "anomalous" is about the SHAPE of n(λ) | dispersion sign | ✅ |
| **CaF₂'s P lies ≈ 0.018 below the normal line defined by the catalog's own ordinary glasses, while fused silica sits within a quarter of that** | the textbook normal-line construction, run on the catalog | ✅ |
| **ΔV is NOT the lever: CaF₂/F2 has 1.9× the Abbe difference of CaF₂/N-BK7 and ≈ 1.9× the secondary spectrum** — the pair with the smaller ΔV wins | (P₁−P₂)/(V₁−V₂), the anomaly doing the work | ✅ |
| **Secondary spectrum ≈ f/10259 against the achromat's f/2003 — 5× smaller, and of the OPPOSITE sign** (d now focuses long, not short) | closed form from the catalog | ✅ |
| **Focus spread across 450–650 nm is 3.7× tighter, below 5·10⁻⁴ f** — the reason a fluorite doublet costs what it does | the trace | ✅ |
| …while both designs still unite F and C to < 2.5·10⁻⁴ f: the ED gain is in the *secondary* spectrum | § 5j's achromatic condition, unchanged | ✅ |
| Diffraction-limited on axis at f/15, `lost === 0` | the same S_I solve | ✅ |
| **The cost: steeper surfaces (CaF₂'s low index + a harder-working crown), so at f/10 the fluorite doublet is NOT diffraction-limited where the crown-flint achromat is** | honest higher-order residual | ✅ |
| **The harder cost: CaF₂ against a heavy flint (F2) has NO spherically-corrected cemented solution — S_I is strictly positive at every bending — and the preset throws** | a fact about the glasses, not a solver failure | ✅ |
| **Branch criterion across three glass pairs: Σ\|S_I,ᵢ\| picks the root the exact trace prefers, 6/6** | the § 5j selector, cross-validated | ✅ |
| **…and coma would pick WRONGLY for the fluorite pair: 8× worse on axis for a 2% coma gain** | the negative result that set the criterion | ✅ |

**The fluorite pair is what corrected the branch criterion.** With only N-BK7/F2 in
hand, "choose the lower-coma root" and "choose the gentler-cancelling root" agree,
and the first was shipped. CaF₂/N-BK7 separates them: the two roots' comas differ by
2% while their on-axis wavefronts differ by 8×, and coma points at the bad one. The
criterion was changed to Σ|S_I,ᵢ| and re-checked on all three pairs. Recorded here
because the wrong version was in the ladder first, and because a criterion that
survives one glass pair is not a criterion.

**The selector is a third-order proxy, and is scoped as one.** Σ|S_I,ᵢ| is checked
against the exact trace for the catalog's three pairs, not proven for arbitrary
glass, and `achromaticObjective` applies it without tracing (a `designs/` function
reaching into the wave layer would invert the layering). For some untried pair it
could return the worse root silently. Both roots are valid SA-nulled designs and
`branch: "steep"` builds the other, so the escape hatch is there; the limit is
recorded in the module header rather than papered over.

**A cemented fluorite doublet is deliberately a modest design.** Real premium
fluorite refractors are AIR-SPACED, which buys the third freedom this form does not
have, and cementing large CaF₂ is a thermal-expansion problem besides. What is
pinned here is what this form can honestly claim: the colour is much better, the
monochromatic correction is worse at the same speed, and the fast end is where it
shows. The air-spaced doublet — and with it the possibility of nulling S_I and S_II
together — is the open follow-on.

## Step 5l — module composition and afocal (telescope) evaluation

The prerequisite the eyepiece library is the first consumer of. Two capabilities
that arrive together because neither is worth much alone: **composition** (build
an instrument from whole parts — an objective, an eyepiece — not a hand-edited
surface list) and **afocal evaluation** (read the numbers a visual observer
sees, which live in the collimated exit space the engine could not express
before).

The distinction that governs the whole section: an eyepiece *prescription* is
input data, and transcribing one pins nothing (that rung is "the tracer reads a
table", listed under Later rungs). The **afocal composed system** is the
pinnable capability — a collimated-in/collimated-out chain has no finite focus,
so `systemProperties` throws on it, and every number below is a closed form the
trace can refuse.

Composition is **flattening, not a second tracer** (ARCHITECTURE § Data model):
`spliceModules` concatenates modules into one ordinary `Prescription`, replacing
only each module's trailing thickness (a standalone BFD, meaningless once a part
follows) with the gap to what comes next. Commitment #3 is what makes it free —
the chain is already a list of per-surface frames, so on-axis parts just
concatenate. `afocalTelescope` then solves the objective↔eyepiece separation
that makes the pair afocal, and `afocalProperties` reads magnification, exit
pupil and eye relief off the result.

| Rung | Pinned to | Status |
|---|---|---|
| The splice keeps each module's internal thicknesses and overwrites only its trailing one with the join gap | bookkeeping | ✅ |
| **Afocal spacing → f_o + f_e in the thin-lens limit** | combined power φ_o+φ_e−dφ_oφ_e = 0 | ✅ |
| **A parallel ray in exits parallel out — afocal to ~10 orders below the objective's own bend** | the afocal condition | ✅ |
| **Angular magnification = −f_o/f_e, measured from the beam compression** | afocal system matrix | ✅ |
| ...and it inverts (M < 0 for a Keplerian pair) | textbook sign | ✅ |
| **That M equals the ratio of the two separately-traced group EFLs** (route independence) | first-order theory | ✅ |
| **Exit-pupil diameter = EPD/\|M\|, via the stop imaged through the eyepiece** | pupil imaging, a third route | ✅ |
| **Eye relief = f_e·(f_o+f_e)/f_o** | stop conjugate through the eye lens | ✅ |
| A wrong separation is NOT afocal — `systemProperties` finds a finite focus | negative control | ✅ |
| **The solve is thick-correct: a real achromat objective still gives M = −f_o/f_e** | affine-in-gap solve, BFD_o+FFD_e | ✅ |

The **afocal spacing** solve is the load-bearing piece, and it is deliberately
not the thin-lens formula. A parallel input ray's paraxial output angle is
*affine* in the objective↔eyepiece gap g — only the free transfer across g
touches it — so two evaluations pin the line and its zero is the afocal spacing.
In the thin-lens limit that zero is the textbook f_o + f_e (the first strong
rung); for thick groups it is BFD_o + FFD_e, which the same solve delivers
without either being named, and the achromat-objective rung is what shows it
holds there. Solving on the trace rather than on a formula is what keeps a thick
objective honest.

The **three routes to the exit pupil** are the reason this section is more than
a definition check. The magnification comes from the beam compression of one
parallel ray through the composed chain; the ratio of the two group EFLs comes
from two *separate* `systemProperties` calls; and the exit-pupil diameter comes
from imaging the stop through the eyepiece with the pupil machinery (§ 1.5). All
three agree — M = −f_o/f_e and D_xp = EPD/|M| — and none is the others by
construction, which is what a definition-level rung would be.

The **afocal condition** rung is asserted as a ratio (residual output angle
against the objective's 1/f_o bend) rather than through `systemProperties`'
throw, because that guard fires only below 1e-15 rad and a two-point numeric
solve floors at ~1e-14. The residual is ~10 orders below the objective's own ray
angle, which is afocal to the trace's floating-point limit; the hard 1e-15 guard
is the wrong instrument, not a failure, and the note is recorded so the next
reader does not tighten it into a flake. `systemProperties` still throws for the
*right* reason on a mis-spaced pair (the negative control), which is the check
that the guard works at all.

Deferred here on purpose, so the first commit is the splice and its first-order
numbers: real-ray afocal evaluation (apparent field of view and the eyepiece's
pincushion, which need the *output chief-ray angle* off a real trace, not
paraxial), the computed Plössl and the transcribed patent library, and the eye
model / exit-pupil-to-eye matching. Mechanical metadata and per-surface
provenance attach to the module and land with step 6; the splice carries only
`objectiveSurfaceCount`, enough to name which part a surface came from.

## Step 5m — the computed Plössl eyepiece

The eyepiece library's lead member, and the second preset that *composes* two
prior units rather than adding physics (after the Schmidt-Cassegrain): the Plössl
is two of § 5j's achromatic doublets mirrored across a central air gap, crowns
out, flints in.

It is COMPUTED, not transcribed, and the reason is the same one that makes the
Cassegrain family computable while the commercial SCT is not: a symmetric pair of
doublets has *behaviour that is a theorem*. Each half is the achromat § 5j solves
from the glass catalog and third-order theory; stacking two mirror images gives a
construction that is achromatic by inheritance and, by the principle of symmetry,
suppresses the odd aberrations between its halves. So the eyepiece is pinned to
what symmetry and the doublet solve predict — a closed form the trace can refuse —
not to a catalogued part's numbers. It deliberately is NOT a commercial Plössl:
bent for the eyepiece role its residuals clone no patent, and it claims none. The
Huygens (§ 5o) is the library's second computed member; the transcribed patent
wide-fields are the deferred follow-on, blocked on external data, not code.

| Rung | Pinned to | Status |
|---|---|---|
| The focal-length solve hits the requested EFL | secant on the doublet power | ✅ |
| EFL = the thick two-group Gaussian combination 1/f_e = 2/f_d − d/f_d², d = gap + 2(f_d − BFD_d) | Gaussian reduction, from the doublet's own cardinal points — *consistency check* | ✅ |
| **Symmetric by construction: curvature i = −(curvature 5−i)** | the mirror layout | ✅ |
| **Inherited achromatism: F–C focal spread ≈ 4·10⁻⁴ f, secondary-spectrum level** | the doublets unite F and C | ✅ |
| ...≥ 10× below an equal-power singlet's ≈ 1/V_d spread (negative control) | thin-lens chromatic theory | ✅ |
| **Composes into a telescope: M = −f_o/f_e, exit pupil = EPD/\|M\|, eye relief > 0** | § 5l machinery, on a real 6-surface eyepiece | ✅ |

The **EFL rung** is a *consistency check*, not external validation — it compares
the 6-surface trace's EFL against the Gaussian reduction fed by the doublet's own
paraxial f_d and BFD, so both sides come from one paraxial engine. It earns its
place by catching an assembly bug (a mismatched thickness, a swapped medium, a
broken splice all move it), and it is not the naive Gullstrand check it first
looks like. Combining the two doublets with the air-gap as the lens
separation is wrong by 5% here, because the doublets are *thick* and the
separation that enters the power formula is between their principal planes, not
their inner vertices. Carrying the principal-plane offset — d = gap + 2(f_d −
BFD_d), from the doublet's paraxial EFL and back focal distance, both computed by
`achromaticObjective` independently of the composed trace — makes the composed
6-surface trace agree with the two-group reduction to machine precision (4·10⁻¹⁶).
It is a real cross-check: a mismatched thickness, a swapped medium or a broken
splice would move it. The naive-gap version is recorded because it is the obvious
wrong pin, and the 5% it misses by is the thick-lens principal-plane geometry, not
slack.

The **achromatism rung** is what makes "two doublets" worth more than "one lens of
the same power": the F and C foci that each doublet unites stay united in the
pair, so the eyepiece's own chromatic focal spread is ~40× below a singlet
eyepiece's. The singlet negative control is the same-power thin lens, whose spread
is the textbook 1/V_d; the Plössl sits at the secondary-spectrum level its glasses
allow.

The **symmetry dividend is deferred, not skipped.** The reason a symmetric
construction is used for eyepieces — coma, distortion and lateral colour cancel
between mirror halves — is a third-order-theory claim about the *odd* Seidel sums,
and `analysis/seidel` is object-at-infinity / stop-at-first-surface only (§ 5j
scope), so it cannot score the eyepiece at its working conjugates. That dividend is
measured on the real-ray afocal trace instead (the apparent-field-of-view /
distortion capability), and is pinned there against a singlet-eyepiece control.

## Step 5n — real-ray afocal: apparent field of view and distortion

The genuinely-new engine capability under "eyepiece library" — the one the
prescription is merely input to. `afocalProperties` (§ 5l) is first-order and so
is blind to distortion by construction; distortion is exactly the nonlinear term
a paraxial trace drops. `apparentFieldAngleRad` traces the REAL chief ray through
the composed telescope and reads its direction in the collimated exit space:

    θ_out(θ) = M·θ + O(θ³)

the linear coefficient is the § 5l magnification, and the O(θ³) departure is the
eyepiece's distortion.

| Rung | Pinned to | Status |
|---|---|---|
| **The near-axis slope of θ_out equals the paraxial M** (real trace vs first-order) | § 5l magnification | ✅ |
| **The distortion residual octuples when the field doubles — third-order** | θ³ distortion | ✅ |
| ...and the ratio → 8 as the field halves (fifth-order-bounded) | approximation order | ✅ |
| **Pincushion: local angular magnification grows with field** (convention-free) | third-order distortion sign | ✅ |
| **Lateral colour: the Plössl's is ≥ 20× below an equal-power singlet eyepiece's** | the doublets unite F and C | ✅ |
| Distortion is NOT the dividend — comparable to the singlet's | symmetry principle, scoped | ✅ |

The **cubic rung** is the § 5n headline and is built to the same discipline as
every other ratio pin in this ladder (the 4/3 focus ratio, the coma cubics): the
residual θ_out − M·θ octuples per doubling of the field (8.02 at 0.1°→0.2°),
asserted at a *small* angle where the tolerance is bounded by the next
(fifth-order) term, with the companion **convergence** rung showing the measured
ratio moves toward 8 as the field halves (8.02 at 0.1°→0.2° against 8.10 at
0.2°→0.4°). A single fixed-angle assertion of "≈ 8" would read as slack; the
convergence is what identifies the excess as fifth order rather than error.

The **pincushion** rung is stated convention-independently, and that is
deliberate. "θ_out − M·θ" presupposes the angle-condition reference; what survives
any convention is that the *local* angular magnification |θ_out/θ_in| grows
monotonically toward the edge (1.002 → 1.019 → 1.058 of M at 0.2°, 0.6°, 1.0°),
which is pincushion in every convention. The residual measure is the angle
condition's, noted as such.

The **lateral-colour dividend** is what the Plössl's construction actually buys,
and it corrects the intuition — recorded because the intuition was mine. A
symmetric doublet pair *looks* like it should cancel distortion by the principle
of symmetry, but that principle cancels the odd aberrations only for a system
symmetric *about its stop* near *unit magnification*; a Plössl in a telescope has
its stop at the objective and works infinite:finite conjugates, so the
cancellation does not transfer, and the trace confirms it — the Plössl's
distortion is within a few percent of a single-lens eyepiece's (the honest
negative rung). What DOES transfer is achromatism: each doublet unites F and C, so
the Plössl's lateral colour sits at the trace floor (a few arcsec, sign-varying
with field — pinned as "at/below floor, dominated by the control", not as a
precise number), while the equal-power singlet eyepiece carries primary ~1/V
lateral colour ~60× larger. That is the eyepiece worth building, and it is a
colour claim, not a distortion one.

`apparentFieldAngleRad` throws when the chief ray does not clear the optics (a
field past the eyepiece field stop vignettes), and the rungs assert well inside
that limit, so a later aperture change surfaces as a loud failure rather than a
silently-clipped angle. Off-axis PSF, real AFOV *edge* (where the field stop cuts
the beam), and the eye-model exit-pupil match remain deferred.

## Step 5o — the Huygens eyepiece: achromatism by spacing

The library's second COMPUTED member, chosen because it achromatizes by a
*different theorem* than the Plössl and so pins different physics. It is two
plano-convex singlets of one glass — no flint anywhere — and its colour
correction comes from their separation:

    d = (f₁ + f₂)/2

At that spacing two thin lenses of a single glass have an achromatic combined
power. The derivation is thin-lens algebra: Φ = φ₁ + φ₂ − d·φ₁φ₂, and with one
glass each dφᵢ/dλ ∝ φᵢ (same V), so dΦ/dλ ∝ φ₁ + φ₂ − 2d·φ₁φ₂, which vanishes at
d = (f₁+f₂)/2. The combined focal length there is f_e = 2f₁f₂/(f₁+f₂); scaling
f₁, f₂ together preserves d = (f₁+f₂)/2, so the design solves one overall scale to
hit the requested focal length without perturbing the theorem.

| Rung | Pinned to | Status |
|---|---|---|
| The scale solve hits the requested EFL, one glass throughout, four surfaces | construction | ✅ |
| EFL = 2·f₁·f₂/(f₁+f₂) to the thick-lens residual | thin-lens combination — *consistency check* | ✅ |
| **Achromatic at d = (f₁+f₂)/2: F–C spread ≥ 10× below an equal-power singlet** | same-glass spacing theorem | ✅ |
| **The achromatism is a ZERO CROSSING in the spacing — under below, over above** | dΦ/dλ = 0 at (f₁+f₂)/2 | ✅ |
| Composes into a telescope with the § 5l magnification / exit pupil / eye relief | § 5l machinery | ✅ |

The **zero-crossing** rung is the Huygens headline, and it is a negative control
the Plössl's construction cannot offer. The Plössl is achromatic because each of
its halves is a cemented achromat — remove the flint and the correction is simply
gone, monotonically. The Huygens is achromatic because of a *spacing*, so its
lateral colour changes SIGN across the design separation: too close
under-corrects, too far over-corrects, and only at (f₁+f₂)/2 do the F and C focal
lengths agree. The rung builds the eyepiece at 0.7 d and 1.3 d and asserts the F–C
spread takes opposite signs there while the design sits between them near zero.
That sign flip is the theorem made falsifiable — a wrong spacing does not merely
correct less, it corrects the *other way* — which a "smaller is better" tolerance
would miss.

The **EFL rung** is a *consistency check* (trace EFL against the thin-lens
combination of the design's own focal lengths, one engine on both sides) and
carries a ~1.5% thick-lens residual against 2f₁f₂/(f₁+f₂), bounded rather than
tightened: unlike the Plössl, whose
EFL is pinned to the *thick* two-group combination at machine precision, the
Huygens rung is stated against the thin form on purpose, because the point of the
design is the spacing condition (also a thin-lens statement), and holding both to
the same thin-lens order keeps the section about the theorem rather than about
principal-plane bookkeeping. The residual is recorded as the thick correction, not
absorbed.

The Huygens is deliberately a modest eyepiece and is scoped as one: the field stop
is internal (a reticle there is not sharp), eye relief is short, and only lateral
colour is corrected — spherical aberration and field curvature are not. What is
pinned is the one thing it does by theorem, which is exactly the discipline the
rest of this ladder holds to.

## Step 5p — limiting-aperture stop selection

The visual branch's prerequisite, and a real engine capability rather than a
readout. `pupils()` has always keyed off the DECLARED stop (`stopIndex`: the
surface a prescription flags `isStop`, or surface 0). That is a *declaration*,
not a *measurement* — nothing forces the flagged surface to be the one the axial
cone fills first. The moment two apertures compete for the beam — a telescope's
objective versus the observer's iris sitting at the exit pupil, or a downstream
rim smaller than the nominal stop — the **limiting** one is the true aperture
stop, and the exit pupil, chief ray and OPD reference must move to it. Visual
mode (§ 5q) is built entirely on this: when the eye pupil is smaller than the
exit pupil it *becomes* the stop, and the effective aperture drops to d_eye·M.

`limitingStop` finds it the textbook way: send one pseudo-marginal ray from the
axial object point through the chain and take `argmax |y_i|/semiAperture_i` — the
surface the ray fills most relative to its clear rim. Scaling the ray scales
every height equally, so that argmax is independent of the launch slope; the
declared stop competes as one candidate at its ApertureSpec radius. Selection is
**opt-in** (`OpticalSystem.apertureStop`: `declared` default, `limiting`,
`surface`), so every prior rung is byte-identical and the flip is a conscious
per-system choice.

| Rung | Pinned to | Status |
|---|---|---|
| **Every existing preset's limiting aperture IS its declared stop** (all 10, incl. 9- and 7-surface composed telescopes) | honest declaration + a safe default-flip — *non-regression* | ✅ |
| **The crossover is a closed form: two bare planes + a point source flip at a₂\* = a₁(L+t)/L** | subtended angle a_i/(L+z_i), pure geometry | ✅ |
| ...and the flip is bracketed to 0.01 mm, exactly there and nowhere else | the same closed form | ✅ |
| The selected stop is the one subtending the SMALLEST angle at the object | convention-free stop definition | ✅ |
| **`pupils()` MOVES to it: a smaller downstream iris relocates the exit pupil and collapses the effective aperture** | the wiring is the feature, not a returned integer | ✅ |
| The `surface` policy pins a chosen index | provenance / test control | ✅ |
| A pinhole field stop AT the internal focus is NOT selected (marginal y ≈ 0 → fill ≈ 0) | negative control | ✅ |

The **non-regression** rung is load-bearing: it could have failed (a preset whose
rear element is fractionally smaller than its front stop would select the rear),
and its passing is what licenses a future default-flip. The **wiring** rung is the
one that keeps this a mechanism rather than a formula — it asserts `pupils()`
actually consumes the selected index, so the exit pupil and OPD reference the real
limiting aperture, which is exactly what would be tempting to fake with an
`exit_pupil/eye_pupil` ratio and is refused here.

## Step 5q — the reduced eye and visual mode

The first consumer of § 5p, and the step that closes the visual chain. The
eyepiece library (§§ 5l–5o) computed the exit pupil and eye relief; visual mode
puts the observer's eye there and lets the collimated exit beam form a REAL
retinal image, so what a visual observer actually gets — how much aperture
reaches the retina, and how sharp the result is — becomes a readout of one trace
through (objective + eyepiece + eye).

The **eye** is Emsley's reduced model: a single refracting surface of power 60 D
in front of a vitreous of index n = 4/3 (`WATER`), retina at the surface's own
paraxial focus. All its geometry is derived from those two scalars — corneal
radius (n−1)/F, axial length n/F, posterior nodal distance 1/F — so nothing is
transcribed. It is kept IDEAL: the corneal surface carries the Cartesian conic
K = −1/n² that images a collimated axial beam stigmatically, nulling the single
surface's own spherical aberration, so a (telescope + eye) rung measures what the
TELESCOPE delivers to the retina rather than the eye's SA (which is the deferral).

The physics is the § 5p two-stop competition. The telescope compresses the
objective's beam to an exit pupil D/|M|; if the eye pupil is wider, the objective
still fills the retina, and if it is narrower the iris BECOMES the aperture stop
and the effective aperture collapses to d_eye·|M|. The composed system is traced
with `apertureStop: "limiting"`, so the collapse EMERGES.

| Rung | Pinned to | Status |
|---|---|---|
| Eye geometry (R, L, PND) follows from power and index; PND = 1/F, retina = n/F | reduced-eye construction, not transcription | ✅ |
| **The corneal conic K = −1/n² nulls the eye's own SA** (bare eye, 6 mm pupil: Strehl > 0.99) with the sphere K = 0 as the negative control (Strehl < 0.3) | the Cartesian ellipsoid e = 1/n, a closed form — *isolated from the telescope* | ✅ |
| **Effective aperture = min(D, d_eye·\|M\|): full above the exit pupil, d_eye·\|M\| below it** | the two-stop collapse — *headline*, a closed form the trace can refuse | ✅ |
| The iris takes over exactly when the eye pupil drops below the exit pupil | the crossover IS M_min = D/d_eye | ✅ |
| **The retinal Airy disc grows by D/(d_eye·\|M\|)** — the same collapse seen in the image | diffraction scale ∝ 1/effective aperture | ✅ |
| **Stop-selection and exact-trace masking give the SAME iris-limited PSF** | two independent routes (§ 5p pupil sizing vs § 2f `vignetteMask`) | ✅ |
| A field angle images to \|M\|·PND·tan θ on the retina | retinal angular magnification, a third route — *sanity anchor* | ✅ |

The **effective-aperture** rung is the headline and the falsifiable one: the
collapse to d_eye·|M| is a closed form, with the knee exactly at the exit pupil
(⟺ |M| = D/d_eye, the minimum useful magnification falling out of the same
boundary rather than being asserted as folklore). The **two-routes** rung is what
keeps this a mechanism: the iris-limited retinal PSF computed by sizing the pupil
to the iris (`limiting`) agrees with keeping the objective as stop and letting the
exact tracer BLOCK rays at the iris rim (`declared` + the § 2f mask) — different
code paths, one physical aperture, one diffraction disc. The **retinal
magnification** rung is nearly true by construction (the advisor's caution) and is
carried as a sanity anchor, not a headline; its sub-percent departure from the
paraxial form is the eyepiece's distortion (§ 5n), kept small by a small field.

The eye's own aberrations, the empty-magnification / eye-acuity resolution ceiling
(which needs a stated acuity rather than the folklore 2×D), and the photopic vs
scotopic pupil are the named follow-ons; the mechanism they would sit on is landed.

## Step 5r — camera mode: pixel scale and sensor sampling

The visual mode put an eye at the exit pupil; camera mode puts a **sensor** at
the focal plane. A rendered `ColorImage` sits on the *native* grid the
diffraction calculation needs (`pixelScaleMm` ∝ λ, fine enough to sample the
PSF) — that is the continuous optical image, not what a camera records. A real
pixel has a fixed pitch and **integrates the light over its area**, so the
recorded image is the native one rebinned by area onto the sensor grid — which
brings a detector-footprint MTF and aliasing of its own.

Two capabilities, pinned apart: **pixel scale** (optical geometry through the
traced EFL and chief ray) and **sensor sampling** (a property of the rebin
alone, pinned on synthetic targets with no system in the way).

| Rung | Pinned to | Status |
|---|---|---|
| **Plate scale = 206265″ · pitch / EFL, EFL from the trace** | closed form + traced EFL | ✅ |
| **Field of view is the exact inverse of the traced chief-ray map** | `imagePointOf` round trip | ✅ |
| ...and is near the paraxial 2·atan(½·w/EFL) where distortion is small | sanity | ✅ |
| **Rebinning SUMS footprint energy — a 4×4-footprint pixel reads 16×** | energy per pixel, not density | ✅ |
| **A feature symmetric about N/2 rebins to sensor centroid 0** | sample-at-centre registration | ✅ |
| **Detector-footprint MTF = sinc(π·f·pitch) below Nyquist** | box-filter transform | ✅ |
| **A target above Nyquist aliases to bin \|f_s − f\|** | sampling theorem | ✅ |
| **λ/(4·NA) matches the traced MTF cutoff (pitch·2·cutoff = 1)** | Abbe cutoff, independent route | ✅ |
| Sampling-regime classifier: ½·critical over-, 2×·critical under-samples | definition | ✅ |
| `resampleToSensor` carries the sensor pitch, conserving each channel | linearity | ✅ |

The **plate scale** rung's only non-trivial input is EFL, and it comes from the
paraxial trace; pinned to the design's 100 mm and the external 206265″/rad, it
reddens if the trace drifts, the ratio inverts, or the constant is wrong — none
of which a self-consistent `pitch/EFL·206265/EFL·pitch` round trip could catch,
which is why the constant and the traced EFL are each asserted separately first.

The **field-of-view** rung is deliberately the *round trip*, not a formula
match: FOV is found by inverting the traced chief-ray map (which angle lands at
the sensor edge), so feeding the reported half-FOV back through `imagePointOf`
must land exactly on the edge. That is what makes it carry the distortion
`EFL·tan θ` is *defined* to have none of (forward map pinned § 3c) — a FOV built
on the pinhole formula could never report barrel or pincushion.

Three sensor-sampling rungs are the load-bearing ones, and each has a plausible
wrong answer. **The rebin sums, it does not average** — `intensity` is energy
per pixel (the § 2e Jacobian note), so a larger photosite collects *more*
energy, not the same energy averaged; dividing by the footprint would dim every
camera render by the pixel-area ratio and look like nothing worse than a darker
exposure. **The pixel is a box integrator, not a point sampler**, so it applies
the detector MTF sinc(π·f·pitch) *before* sampling — pinned at two sub-Nyquist
frequencies so a flat response (which would pass both at unity) is excluded, and
it is exactly this pre-filter that makes the aliased amplitude ≠ the input's.
**Aliasing pins the frequency, not the amplitude** (the advisor's caution): the
footprint sinc has already attenuated the amplitude near the cutoff, but the
folded frequency |f_s − f| is fixed by the sampling rate alone.

The **centroid** rung is the one the others are all blind to, and it caught a
real defect. Energy is a total, the sinc and alias rungs measure frequencies
(shift-invariant), and the sums-not-averages rung uses a symmetric field — none
can see a half-pixel *shift*. The first `overlapWeights` placed coordinate 0 at
the *left edge* of pixel N/2, while `rasterizePointSources` and
`radialColorProfile` are **sample-at-centre** (an on-axis star sits at index
N/2). Because source and sensor carry different pixel widths, that half-pixel
offset did not cancel between them: a perfectly symmetric star rebinned to a
sensor centroid of −½·(pitch − srcStep), ≈ −0.375 px on the test geometry — the
exact drift § 3b warns a golden image would catch and a physics rung would not,
on the one module whose headline is *sub-pixel* plate scale. Centring the cells
on the samples fixes it; the rung now holds it there.

The **critical-pitch** rung is the non-tautological one: λ/(4·NA) is a scalar
closed form, while the MTF cutoff is built from the pupil autocorrelation on the
FFT grid — a different computation entirely — so pitch·2·cutoff = 1 is physics,
not construction. Asserting "sensor Nyquist == optical cutoff *at* critical
pitch" would have expanded to 2NA/λ == 2NA/λ and pinned nothing; the aliasing
rung carries the real consequence.

Absolute exposure in electrons and its shot noise are **not** here: they need
the magnitude → photon-flux zero point § 3a records as deliberately absent.
Relative exposure — the aperture and f-ratio laws, whose pins are ratios — is
the § 5s follow-on.

## Step 5s — camera mode: relative exposure

How bright the recorded frame is, up to the one scalar that is § 3a's named
deferral: the source's absolute radiance in photons, which the shot noise would
also need. So every rung here is a **ratio** — how illuminance changes with
focal ratio and aperture — the part a photographer reasons about in stops and
the part pinnable without the zero point.

The discipline that makes these validation and not arithmetic: the illuminance
must **emerge from the trace**. A hand-written πD²/4 that the test then recovers
as D² pins nothing. So the image-space cone is read from the *traced* marginal
ray, and the 1/F² law is checked against it as a consequence.

| Rung | Pinned to | Status |
|---|---|---|
| **sin u′ from the traced marginal ray ≈ 1/(2F)** | paraxial, first order | ✅ |
| **...departing by the sine condition, and MORE at the faster stop** | Abbe sine condition | ✅ |
| **Extended-source illuminance ∝ 1/F² (f/10 → f/5 is 4×)** | image irradiance π·L·sin²u′ | ✅ |
| ...landing just ABOVE 4, by the faster stop's sine-condition excess | Abbe sine condition | ✅ |
| Point-source light grasp ∝ D² | entrance-pupil area — *consistency check* | ✅ |
| Exposure scale = illuminance × time × gain | definition | ✅ |

The load-bearing rung is the **sine-condition departure**. sin u′ read from the
traced marginal ray is 0.050237 at f/10 and 0.100941 at f/5, against the
paraxial 0.050151 and 0.100302 — a departure of 0.17% and 0.64%, growing with
aperture. That growth is the pin: a stub that returned the paraxial 1/(2F)
formula would read *zero* departure for both and fail it, which is precisely the
tautology the whole "emerge from the trace" discipline guards against. The
**1/F² illuminance** law then rides on that traced sine: the f/10 → f/5 ratio
lands at 4.04, not exactly the paraxial 4 — the faster stop's larger
sine-condition departure pushing it *above*, which the rung asserts
directionally so a paraxial stub returning exactly 4 fails it.

The **point-source D²** rung is labelled a consistency check, not a pin, and the
label is the honest part: with a front stop the entrance-pupil radius is the
declared aperture, so π·r² recovers D² by construction. Making it independent
would need a stop imaged through preceding power (the entrance pupil ≠ the
declared aperture) — worth doing when such a preset exists, not manufactured
here. The validated, trace-emergent exposure law is the extended-source 1/F².

Shot noise remains the named deferral: it is a draw from an absolute photon
count, and there is no honest count until the § 3a zero point lands.

## Step 5t — tolerancing: sensitivity, compensators, and the RSS budget

Perturb a parameter by its manufacturing tolerance and watch the image degrade.
The roadmap calls this the most educational thing the project can show, and it
is *nearly free* — it adds no physics, only a readout composed of already-pinned
readouts (`opdMap` → the wavefront, `bestFocus` → the focus compensator), driven
by a one-field edit of the immutable `Prescription`. The whole difficulty is the
**currency**, and the obvious choice is wrong, so the validation burden is on the
orchestration — the sensitivity metric, the compensator, the aggregation — not on
optics. Every EXTERNAL rung is pinned on a **perfect nominal** (a paraboloid at
focus, or a flat fold), the one place the currency's design subtlety cannot bite.

| Rung | Pinned to | Status |
|---|---|---|
| **Boresight = 2θ: tilting a flat fold by θ deviates the beam by 2θ** | reflection law | ✅ |
| **Conic error → residual = balanced spherical RMS \|ΔK·c³h⁴/4\|/(6√5)** | conic sag ρ⁴ + § 1.6/2a | ✅ |
| A curvature error on a mirror is pure defocus — fully removed by refocus | negative control | ✅ |
| **Orthogonal tolerances add in quadrature: combined trace = √(Σσᵢ²)** | variance addition | ✅ |
| **Correlated tolerances add LINEARLY (2σ), not RSS (√2·σ)** | negative control | ✅ |
| **The perturbation costing σ = λ/14 lands the real PSF Strehl on ≈ 0.8** | Maréchal, § 2b | ✅ |

### Why the currency is a delta-wavefront σ, not d(RMS)/dparameter

The tempting sensitivity is a central difference of the total RMS wavefront. It
fails *silently*, and the failure is recorded as a consistency rung because it is
the reason the module is built the way it is. At a corrected nominal the total
RMS is **stationary** in any perturbation whose aberration is orthogonal to the
residual already there: `total_RMS(δ) = √(σ₀² + δ²s²)`, so `d(RMS)/dδ → 0` at
δ = 0. A front-surface decenter of the achromat — pure coma, orthogonal to its
spherical residual — leaves the total RMS flat to four digits while the image
genuinely comas; the central difference reads a slope more than 8× *below* the
true one. The change in the wavefront, `δW = W(perturbed) − W(nominal)`, is
linear in the perturbation and has no such kink. Its RMS is the sensitivity.

Two of `δW`'s modes are not blur but **compensators** — adjustments a builder or
a focuser removes for free — so the blur currency is `δW` with them projected out
by least squares:

  - **piston + tilt** — an unobservable offset and a boresight shift (the image
    moves; you re-point). The tilt IS the pointing error, reported separately as
    `boresightRad` and pinned by the reflection law.
  - **defocus (ρ²)** — you refocus.

What is left is exactly the *balanced* wavefront RMS the extended Maréchal Strehl
uses, which is why one number feeds both the RSS budget and the Strehl estimate.

### Linear projection, not a physical refocus — and why they differ

The compensator is a **linear projection** of ρ² out of `δW`, on one common
reference (the nominal's best-focus plane and pupil grid), so the deltas of
independent perturbations superpose and their variances add — which is what makes
the RSS budget *exact* rather than approximate. It is NOT the same as physically
re-running `bestFocus` on the perturbed system, and the gap is diagnostic: ρ² and
ρ⁴ are not orthogonal over the disc, so a physical refocus of an *aberrated*
nominal pulls its defocus with the nominal's own spherical, landing below the
projection (measured < 0.8× on the achromat, carried as a consistency rung). On a
*perfect* nominal that cross-term vanishes and the two coincide to ~0.3% — which
is exactly why every external rung sits on a perfect nominal, where the choice
cannot matter. The physically-refocused residual is offered as
`physicalRefocusWaves` for the "what a real focuser leaves" question, validated
only by tracking the projection on a perfect nominal.

### The four external pins

**Boresight = 2θ** is the cleanest external number in optics and the one rung
that exercises the tilt-perturbation path end to end. A Newtonian's diagonal is a
45° flat; tilt it by θ and the chief ray — the whole beam — swings by exactly 2θ,
measured straight off the traced ray with no wavefront decomposition in the path.

**The conic compensator** is the non-trivial half of the compensator story, and
the negative control beside it is what makes it non-trivial. A *curvature* error
on a single mirror induces **pure defocus**: refocus removes it completely and the
residual collapses (the rung asserts the pre-compensator σ is ≥ 20× the post).
That is the tautology to avoid — a compensator pin that a focus shift satisfies by
construction. A *conic* error induces **spherical**, which a refocus only partly
removes: it adds `W = W₀₄₀·ρ⁴` with `W₀₄₀ = ΔK·c³·h⁴/4` (the r⁴ conic-sag term,
doubled by reflection), and the balanced-focus residual is `W₀₄₀/(6√5)` — the
same closed form § 1.6 and § 2a already pin. So the tolerance currency reproduces
an external number, to a few percent (bounded by the NA-identification and the
fifth order), and on the perfect nominal the projection equals the physical
refocus to within that band, closing the loop of the previous paragraph.

**The RSS budget** is where the § 2f discipline bites hardest: `√(Σσᵢ²)` written
as a formula pins *nothing* — it is the same self-divide the vignetting section
calls out. The rung compares it against σ of an **actual combined trace**, both
perturbations applied at once and traced through the engine. Spherical-from-conic
(even) is orthogonal to coma-from-tilt (odd), so their delta wavefronts are
uncorrelated and the combined variance equals the sum; the rung can go red if the
engine fails to superpose the two aberrations. A tilt is used, not a decenter, and
the reason is itself a checked feature: surface 0 is the aperture stop, so
decentering it shifts the pupil with it and produces *no* relative aberration
(σ ≈ 2·10⁻¹¹), where a tilt meets the fixed on-axis beam obliquely and comas. The
negative control is **two identical perturbations**, perfectly correlated: their
combined trace is the linear sum (2σ), not the RSS (√2·σ), and the rung asserts
the combined exceeds the RSS by more than 1.3× — proving the quadrature is a
measured consequence of orthogonality, not a hard-wired √.

**The diffraction-limit threshold** pins the RMS-native form, not Rayleigh's. A
conic error is bisected until the tolerance currency reads σ = λ/14, and the
*real* PSF Strehl of that perturbed system at best focus (OPD → FFT, the § 2b
pin) is asserted onto ≈ 0.8. Maréchal gives `exp(−(2π/14)²) ≈ 0.817`; the
diffraction-limit convention rounds it to 0.8. This is deliberately σ = λ/14 RMS,
not the λ/4 peak-to-valley Rayleigh quarter-wave — the two coincide only for
balanced defocus, and the module's currency is an RMS, so the RMS threshold is the
honest one to pin.

Tolerancing lands here, at step 5, rather than in v2: once tilt/decenter exists
(the § 4a folded-mirror frame closed it) the whole capability is a difference of
two traces, and it is the most educational thing the simulator can show — a slider
per tolerance, the image degrading as the RSS budget predicts.

## Step 6a — the infinity-corrected microscope: architecture and the first objective

The unit that opens the microscope branch. Everything step 6 promises — immersion,
coverslip mismatch, brightfield, fluorescence — is a variation on one chain:
specimen at an objective's front focus, a collimated space, a tube lens, an image.
The engine could express neither end of it. Finite conjugates existed but nothing
*placed* the object; `systemProperties` reads EFL and BFD from a ray coming in
collimated, and `bestFocus` moves the image plane. The one genuinely new
first-order capability here is `collimatingObjectDistance` — where the specimen
goes so the objective's output is collimated. The objective itself needs no new
lens-design code: a low-power achromatic objective *is* a cemented doublet, so
`achromaticObjective` builds it, as § 5k's ED refractor also reused it.

| Rung | Pinned to | Status |
|---|---|---|
| **The doublet nulls S_I only MIRRORED — the wrong way round is 9.2 waves** | § 5j solve + reversibility | ✅ |
| Both orientations have identical EFL — nothing first-order can tell them apart | negative control | ✅ |
| **The object-distance solve = the front focal distance** = reversed chain's BFD | independent route | ✅ |
| FFD ≠ BFD for this asymmetric doublet (the two routes are not one number) | negative control | ✅ |
| A real marginal ray at full NA leaves the objective collimated (tilt < 5e-4) | exact trace vs the paraxial solve | ✅ |
| **M = f_tube/f_obj on the traced chief ray** (−4.00103 vs −4) | the tube-length convention | ✅ |
| M is unchanged by the infinity-space length (20 / 100 / 250 mm) | why the infinity space exists | ✅ |
| The same objective is 3.3× on a 165 mm Zeiss tube | convention-relativity | ✅ |
| **Traced object NA = 0.100000** from the marginal ray's launch angle | design spec | ✅ |
| Sizing the stop f·NA instead of s·tan u ships NA 0.1021 | negative control | ✅ |
| **Abbe sine condition on the emergent ray: height = f·sin u to 0.43%** | Abbe | ✅ |
| …and NOT to zero — a doublet is corrected but never aplanatic | § 5j, negative control | ✅ |
| **λ/(2·NA) magnified = the FFT grid's MTF cutoff, to 0.5%** | Abbe vs § 3 grid | ✅ |
| Rayleigh/Abbe = 1.22 exactly — different criteria, both reported | Airy factor | ✅ |
| Distortion moves M by 2e-5 over a 40× field spread | § 5n real-chief-ray route | ✅ |
| Diffraction-limited on axis at the paraxial image plane (σ = λ/23) | Maréchal | ✅ |

### The orientation rung, and why it is third-order

A doublet solved for one conjugate pair is correct for the reverse pair only when
it is **turned around**. § 5j solved the bending for S_I = 0 with light arriving
collimated on the crown; a microscope objective runs the other pair, specimen in
and collimated out. By reversibility the orientation reproducing the solve is the
doublet mirrored — flint toward the specimen — which is the same turn-around
`designs/eyepiece` makes for the Plössl's second group.

This was *measured before the module existed*, not assumed, and it is not a close
call: 1.7e-18 mm of ΣS_I mirrored against 4.33e-2 mm un-mirrored, i.e. **9.2 waves**
of third-order spherical aberration. The rung is worth having precisely because the
two orientations have the same EFL to 10 digits — no first-order readout, and no
"does it look about right" glance at the prescription, can separate them.

### The stop radius is not the sine-condition height

Recorded as a finding because the module made the mistake once and the tests now
pin it. f·NA is the height an aplanat maps sin u to on the **equivalent refracting
sphere**, a sphere of radius f about the front principal point. The physical stop
sits on the front vertex, a distance s = FFD from the specimen, so what fills it is
a tangent relation, r = s·tan u = s·NA/√(1−NA²). For the 4×/0.10 that is 4.8951 mm
against f·NA = 5.0000 mm: sizing the stop by the sine-condition height and reading
the NA back would have shipped an objective 2.1% faster than its label.

Getting this right is what frees the sine condition to be an **external check
rather than a construction**, and it is applied where it belongs — on the emergent
ray. The marginal ray launched at sin u = NA leaves the objective at height 4.9757
against f·sin u = 4.9969, a residual of −0.43%. Small, and *deliberately pinned as
non-zero*: an offence against the sine condition is exactly coma, and § 5j already
found that the two SA-null bendings **straddle** the coma-free one, so a cemented
doublet is spherically corrected but never aplanatic. A residual of zero here would
mean the rung was measuring its own construction.

### What is a convention, and what is physics

M = f_tube/f_obj is external only *relative to a stated tube length*: 200 mm for
Nikon (CFI60) and Leica, 180 mm for Olympus (UIS2), 165 mm for Zeiss (ICS). These
are catalogue conventions, spelled out in `TUBE_FOCAL_LENGTH_MM` so the number is
stated rather than assumed, and the rung is checked for more than one of them — the
same 50 mm objective is 4× on a 200 mm tube and 3.3× on a 165 mm one. That is a
real property of real microscopes, not a modelling artifact.

The digits themselves are **not datasheet-verified here** — they are the widely
quoted values, and Zeiss ICS is quoted as both 165 and 164.5. Nothing rests on
them: `tubeLens` takes an explicit focal length and the magnification rungs are
ratios, so sourcing a corrected value would move labels and no physics. Flagged
explicitly because § 1's D263 commit had to fix exactly this class of thing
(νₑ = 55, not 56).

### Not yet pinned

- **The classic 160 mm architecture.** The roadmap's step 6 names *two*
  architectures; this step lands the infinity-corrected one only. The DIN/JIS
  finite-conjugate form (M = 160/f_obj, no tube lens, the objective forming a
  real image directly at the tube's far end) needs no new machinery — finite
  conjugates and `bestFocus` both exist, and the objective is used at yet a third
  conjugate pair, so it is mostly a question of which orientation the § 6a.1
  argument picks for it. Listed here because it is the item most likely to be
  silently dropped.
- **`pixelScaleMm`'s image-space index.** The ROADMAP § 1 note lists this as the
  immersion wiring left over. It is **not** what this step pins and no rung here
  pretends to: an infinity-corrected microscope forms its final image in **air**,
  so n_image = 1. The oil enters through Snell at the first surface, through OPD
  (path = n × length), and chromatically through its dispersion — i.e. through
  **NA**, not through the image grid. The wiring rung stays open for a
  configuration whose image is itself immersed.
- **`objectNA`'s aperture seed is wrong at high NA.** `resolveStopRadius`'s
  `objectNA` branch computes `epRadius = (NA/n)·armLength`, treating NA/n as a
  *tangent* over the arm. At NA 0.10 in air that is a 0.5% error and harmless;
  at NA 1.4 in oil, sin u = 0.924 gives u = 67.5° and tan u = 2.42 — the seed is
  **2.6× out**, and ray aiming will either fail to converge or land on a nonsense
  stop radius. This step sidesteps it entirely by specifying `stopRadius`
  directly, but the immersion unit must fix the seed to the true sine relation.
- **Telecentricity.** Real objectives put the stop at the **back focal plane**,
  making them object-space telecentric — chief rays parallel to the axis, so
  magnification does not drift with defocus. That puts the entrance pupil at
  infinity and `aimRay` refuses it by design ("telecentric: aim in object space
  instead"). Object-space aiming is a real engine gap; until it lands the stop
  sits on the objective's own rim, which changes no axial property and no
  magnification, only the chief-ray angle.
- **High NA needs a different glass form.** F = 1/(2·NA) is a function of NA
  alone, so NA 0.25 is an f/2 doublet — where the third-order solve's neglected
  higher orders dominate and the design stops being a design. The computed member
  is honestly the low-power, low-NA objective. The Lister two-doublet (§ 6d — an
  aplanat, but it stops at NA 0.343) and the **aplanatic immersion front** (hemisphere + Weierstrass meniscus, stigmatic by
  the aplanatic-points closed form, and where the § 1 oil and D263 start doing
  work) are the named follow-ons.

## Step 6b — the classic 160 mm (DIN) microscope

The second of the two architectures step 6 names, and the one § 6a listed under
"Not yet pinned" as *the item most likely to be silently dropped*. That note
predicted it would need **no new machinery** — finite conjugates and `bestFocus`
both exist — and measuring it falsified that before any design code was written:
§ 6a's infinity-solved objective, placed at DIN conjugates, carries **0.46 waves**
RMS on axis. A DIN objective is not an infinity objective used differently. It is
a differently-solved lens, and solving it needs a capability `analysis/seidel`
explicitly refused.

### 6b.0 — Seidel at finite conjugates: the position factor

`seidelSums` was scoped "object at infinity only": the marginal ray entered with
u = 0, hard-coded. That is the *only* thing an object conjugate changes — the
recursion for A, Ā and Δ(u/n) was never told where the ray came from — so
`objectDistanceMm` adds one term at the start of the loop and leaves every
pre-§ 6b caller's numbers bit-for-bit unchanged.

What it switches on is not cosmetic. The published thin-lens bracket already
pinned in § 5j carries a **position factor** p beside the shape factor q,

    W₀₄₀ = h⁴/(32·f³·n(n−1)) · [ (n+2)/(n−1)·q² + 4(n+1)·p·q
                                 + (3n+2)(n−1)·p² + n³/(n−1) ]
    p = 1 − 2f/s′        (−1 at infinity, 0 at s = s′ = 2f, → +1 as s → f)

and the infinite-conjugate rungs exercised exactly one point of it, p = −1. The
p² and p·q terms are the whole difference between a telescope doublet and a
microscope objective.

| Rung | Pinned to | Status |
|---|---|---|
| **p = 0 lands at s = s′ = 2f**, across the shape range, to 1e-8 | symmetric conjugates — the sign check | ✅ |
| **The bracket across p ∈ [−0.82, +0.33] × q ∈ [−2, 2], two indices, to 1e-8** | Jenkins & White; Hecht § 6.3 | ✅ |
| **q_best(p) = −2(n²−1)·p/(n+2)** is the minimum at every p tested | d(bracket)/dq = 0 | ✅ |
| …whose p = −1 case *is* the classical best form § 5j pins | cross-check of the two laws | ✅ |
| The best form turns ROUND inside 2f (p > 0 ⇒ q_best < 0) | corollary, and a negative control | ✅ |
| A singlet's parabola in q stays positive at every p — no conjugate rescues it | § 5j motivation, generalised | ✅ |
| Omitting the option is **identical**, not approximately infinite | non-regression | ✅ |
| …and s = 1e9·f converges onto it from the finite side (1e-7) | limit consistency | ✅ |
| Rejects a non-positive or non-finite object distance | refuses what it cannot compute | ✅ |

**Why p = 0 is the rung that matters.** The marginal ray's launch slope is
u = h/s, and a sign error there is invisible to a scan: the bracket is even in
neither p nor q, but a flipped p simply relabels which object distance goes with
which prediction, and a scan that generates both from the same wrong convention
agrees with itself. p = 0 is the one point whose geometry is known
*independently* of the bracket — the symmetric pair s = s′ = 2f — so it is
checked first and across five shapes, and everything downstream inherits it.

**The corollary that anticipates § 6b.1.** q_best carries the opposite sign to p,
so a lens working with the object inside 2f wants its steep face toward the
**image** — the reverse of the collimated-beam rule every telescope objective
follows. That is the thin-lens shadow of § 6a.1's orientation finding, and the
reason a DIN objective cannot inherit the infinity-solved bending.

### 6b.1–6b.4 — the DIN objective and the tube-lens-less architecture

`designs/microscope`'s `finiteConjugateObjective` / `finiteConjugateMicroscope`:
a cemented doublet whose bending is solved **for the conjugate pair it works
at**, with the specimen placed by Newton's equation. There is nothing after it —
a DIN microscope has no tube lens, and that absence is why the objective has to
carry the whole correction itself.

| Rung | Pinned to | Status |
|---|---|---|
| **Reusing the infinity-solved bending costs 2.0 waves of W₀₄₀** at the DIN pair | § 6b.0 position factor | ✅ |
| …where the re-solved bending nulls S_I to >1e12 below it | the solve | ✅ |
| The two bendings differ by 14% of the curvature (0.04674 vs 0.05465 mm⁻¹) | the same lens, two conjugates | ✅ |
| Re-solving moves the *traced* focal length +0.56% and flips the sign of the thick-lens remainder | Gullstrand, on real shapes | ✅ |
| **Reciprocity: crown-first solved at b == mirrored solved at a, to 10 digits** | reversibility, vs a direct solve | ✅ |
| **The fixed point is verified, not trusted**: solved-for conjugate == used-at conjugate | anti-circularity | ✅ |
| …and the guard fires when the route is broken (mutation-checked) | negative control | ✅ |
| **Newton x_o·x′ = f² across three independent computations** (FFD solve, BFD, ray) | Newton | ✅ |
| Traced chief-ray M = −4 / −10 / −20 to 1e-4 | the stated tube length | ✅ |
| x′_traced/x′_nominal ≡ f_traced/f_target — M and x′ cannot both be exact | identity, not tolerance | ✅ |
| The microscope is **3 surfaces**: one doublet, one stop flag, no tube lens | the architecture | ✅ |
| f = x′/M uses the OPTICAL tube length; 160/4 is 2.5 mm away and is not it | convention hygiene | ✅ |
| **Orientation is worth only ~25%** once both are solved for their own conjugates | vs § 6a's 9.2 waves | ✅ |
| …and crown-first is the *better* one on the sine condition | § 5j straddle, negative control | ✅ |
| Both orientations trace with `lost` = 0 before their RMS is compared | fair-comparison guard | ✅ |
| **Traced object NA = 0.100000** at 4×, 10×, 20× | design spec | ✅ |
| …and the readout SEES a mis-sized stop: 2% out reads 0.10198 = sin(atan(k·tan u)) | negative control | ✅ |
| § 6a's f·NA stop mistake costs **18%** here, not 2.1%, shrinking with M | conjugate-dependence | ✅ |
| Working F is faster than 1/(2·NA) and climbs toward it: 4.08 / 4.65 / 4.88 | the finite-conjugate cone | ✅ |
| **Diffraction-limited at best focus** (σ = λ/17 at 4×) — and NOT at the paraxial plane (λ/7) | Maréchal, honestly | ✅ |
| Balancing is worth >2× — the signature of a fifth-order residual | § 5j/5f/5h | ✅ |
| The residual falls >10× from 4× to 20× as the working F slows | the same law | ✅ |

**The falsified prediction.** § 6a listed this step as needing no new machinery.
It needs one capability `analysis/seidel` explicitly refused (§ 6b.0) and a
solver change, because the infinity-solved objective at DIN conjugates carries
0.46 waves RMS — 6.5× past the diffraction limit. The note is corrected rather
than quietly dropped: **a DIN objective and an infinity-corrected objective of
the same magnification and NA are different lenses**, and the difference is the
position factor, not the orientation.

**Reciprocity is what avoids a second solver.** The specimen faces the flint, but
`achromaticObjective` builds crown-first. Third-order stigmatism is reciprocal —
rays from A converging on B is the same statement as rays from B converging on
A — so the bending nulling S_I for the mirrored chain at object distance a is the
one nulling it for the crown-first chain at the conjugate b. The rung does not
take that on faith: it re-solves the mirrored chain directly, by bisection, and
the two roots agree to 10 digits.

**Why the fixed point is checked rather than assumed.** The bending and the
specimen plane are mutually dependent — the plane is placed off the front focal
distance, which moves with the bending — so they are settled by iteration. A
fixed point that had not closed would ship a lens solved for one conjugate and
used at another, and *every rung below would still pass*, because the trace
confirms whatever the lens was solved for. So the constructor compares the two
distances and throws. Mutating the design route to solve at the wrong conjugate
fires it, which is what makes the check evidence rather than decoration.

**M and x′ cannot both be exact.** A thick lens's traced EFL is not its thin-lens
design target, so placing the specimen for an exact magnification leaves the
optical tube length long by exactly that remainder — 0.52% at 4×, 0.26% at 10×,
0.09% at 20×. Pinned as the *identity* x′_traced/x′_nominal = f_traced/f_target
rather than as a tolerance: whichever way the remainder goes, the two must move
together. The remainder is larger here than § 5j's few-parts-in-10⁴ because the
re-solved bending is shallower, and the achromatic split fixes curvature
*differences*, so a different bending is a different pair of real shapes with a
different separation term.

**The NA rung needed its control.** `objectNumericalAperture` reads the marginal
ray's launch angle, and the stop was *sized* from the tangent relation
a·tan u — so agreement to 1e-6 could have been the identity round-tripping
through a trace rather than a measurement. Perturbing the stop settles it: the
readout tracks sin(atan(k·tan u)) exactly, so it is genuinely seeing the stop
(and the marginal ray genuinely aims at its rim). The sharper control is § 6a's
own mistake transposed — sizing the stop by the sine-condition height f·NA
instead. § 6a costs 2.1% that way; here it costs **18%** at 4×, because the
specimen sits beyond the front focus so a > f, and it shrinks back toward § 6a's
figure (2.4% at 20×) as the DIN objective approaches an infinity-corrected one.
The size of that error is a property of the conjugate, not a constant — which is
exactly why the § 6a figure could not be carried over by rule of thumb.

**Orientation, re-contested.** § 6a's 9.2-wave orientation rung compares a
doublet used at the conjugates it was solved for against one that is not. Solve
*both* orientations for the DIN pair and the contest collapses to about 25% in
RMS wavefront (crown-first/flint-first = 1.21 at 4×, 1.25 at 10×, 1.26 at 20×).
Flint-first still wins everywhere, so the § 6a choice stands — but it stands on a
quarter, not on nine waves, and the honest version of the claim is that
*orientation matters far less than conjugate*. Crown-first is meanwhile the
**better** orientation on the sine condition (1.10e-2 against 2.26e-2), the § 5j
straddle showing up once more: the SA-better build is not the coma-better one,
and no bending makes a cemented doublet aplanatic.

### Not yet pinned

- ~~**The coverslip.**~~ Closed by [§ 6c](#step-6c--the-coverslip-and-what-mismatching-it-costs):
  the 0.17 mm slab, the objective re-solved through it, and mismatch. Read
  `objectDistanceMm` in this step as the bare-specimen case § 6c generalises —
  with a slip it becomes the slip thickness and the air path is `airGapMm`.
- **The eyepiece is not composed on.** The intermediate image is where this stops;
  § 5l's `spliceModules` and the § 5m/5o eyepieces would carry it to a virtual
  image at the eye, which is what a real DIN microscope delivers. Left out
  deliberately — the architecture rung is about the objective standing alone.
- **The 4× is at the edge of the glass form.** f/4.1 is fast for a cemented
  doublet: it clears Maréchal only after the balancing defocus, and it is the
  member the § 6a "high NA needs a different glass form" note anticipates. The
  Lister two-doublet is the follow-on, and this is the second piece of evidence
  for it (the first being F = 1/(2·NA) at high NA). **Closed by
  [§ 6d](#step-6d--the-lister-the-first-aplanat-and-the-ceiling-of-two-doublets)**
  — which also revises what it was expected to buy: the Lister is an *aplanat*
  where this is not, but its own ceiling is NA 0.35, so it does not reach the
  immersion apertures. The third piece of evidence, and it points past the Lister
  to the aplanatic front element.
- **The optical tube length digit.** 150 mm is widely quoted for the 160 mm
  mechanical standard and is **not datasheet-verified here**; sources differ, and
  some write M = 160/f outright, which conflates the two lengths. Every rung is a
  ratio against the stated value, so sourcing a corrected one moves labels and no
  physics — the same treatment § 6a gave Zeiss's 165-vs-164.5.
- **Telecentricity, the `objectNA` seed, and immersion** remain exactly as § 6a
  left them; this step changes none of them.

## Step 6c — the coverslip, and what mismatching it costs

The `0.17` half of the `160/0.17` engraving § 6b left open, and the first of step
6's named deliverables — coverslip mismatch — to land. `designs/coverslip`,
`test/coverslip.test.ts`.

A cover glass is a plane-parallel plate: no power, no first-order effect on focal
length or magnification. It is nonetheless engraved on every objective beside the
tube length, because a plate in a **non-collimated** beam carries spherical
aberration, and the cone between a specimen and an objective is the steepest one
in the instrument. The specimen is mounted *under* the slip, so the model is the
plate's underside: `objectMedium` is the cover glass and the object sits a
slip-thickness in front of surface 0.

### Why this rung is stronger than anything else in the ladder

A plate is one of the very few real elements whose aberration is solvable **to
all orders** from Snell alone. Every other spherical-aberration pin here is a
third-order closed form, honest only while the angles are small; this one is
exact at NA 0.95. That is why § 6c.1 comes first and uses **no lens at all** —
one plane surface, an object inside the glass, and rays.

Three closed forms, all external, none of which any design code evaluates:

    apparent depth   t/n
    LSA(θ)           t·(1/n − tanθ′/tanθ),   sinθ = n·sinθ′
    W(s)             t·[√(n²−s²) − n] − (t/n)·[√(1−s²) − 1],   s = sinθ
    W₀₄₀             t·(n²−1)·s⁴ / (8n³)     — the leading term of W

### 6c.1 — the plate alone

- **The traced axial crossing matches LSA(θ) to ten digits at NA 0.1 … 0.95.**
  The exact tracer against an exact answer, with no small-angle escape hatch.
- **The paraxial limit is the apparent depth**, and what is left at finite angle
  IS the closed form — the same trace pins the limit and the departure from it.
- **The plate is OVERcorrected.** Its marginal crossing lands *beyond* the
  paraxial one, where a positive singlet's falls short, and the two signs come
  out opposite in `seidelSums` as well. This is why an objective corrected for a
  slip is a deliberately aberrated lens, and why using one without its slip is
  worse than not correcting at all.
- **Exactly linear in thickness**, to all orders — every formula carries t as a
  bare factor. This is what makes mismatch a *one-parameter* story: a wrong slip
  aberrates exactly like a plate of the error alone.

**The three conventions, and why the ladder names them.** `analysis/seidel` seeds
its marginal ray with a paraxial *slope*, so the engine's third-order answer is
the **tan⁴** version; the microscopy literature quotes **sin⁴ = NA⁴**; and the
exact form is neither. Third order cannot distinguish tan from sin — the
difference is fifth-order — and neither is wrong, but they part company fast, and
the ratios are themselves closed forms worth pinning:

| NA | engine (tan⁴) / literature (sin⁴) | exact / third-order |
|---|---|---|
| 0.05 | 1.0022 | 1.0018 |
| 0.10 | 1.0087 | 1.0072 |
| 0.33 | 1.101 | 1.084 |
| 0.36 | 1.122 | **1.102** |
| 0.65 | 1.495 | 1.434 |
| 0.80 | **1.907** | — |

The engine/literature gap is exactly (1 − (NA/n)²)⁻², reaching 10% at NA 0.33;
third order itself fails by 10% at NA 0.36, and by NA 0.65 it *understates* the
damage by 43%. Anything plotting a coverslip tolerance has to say which of the
three it drew — and that third order stops predicting the damage above NA ~0.4 is
precisely why a high-dry objective needs a correction **collar** rather than a
nominal figure.

**Cancellation.** Both exact forms are written in the header as differences of
near-equal quantities, and at small angles that is all rounding: at NA 0.001 the
subtractive W is 0.2% wrong in f64. Both are rationalised in the code — the
identity √(n²−s²) − n√(1−s²) = s²(n²−1)/(√(n²−s²) + n√(1−s²)) clears it — after
which the exact form tracks its own series to the last digit, with the next term
(1 + 1/n²)/2 · s² pinned across two decades of aperture.

### 6c.2 — the DIN objective re-solved through the slip

`finiteConjugateObjective({coverslip: {}})`. Three things change together:

- **Placement.** The air gap is solved by a **secant on the traced paraxial
  chain**, never by evaluating t/n. That it lands on a − t/n to eleven digits is
  therefore a measurement of the apparent-depth closed form, not a restatement of
  it — the same discipline § 6a used for the front focal distance.
- **The bending.** `achromaticObjective` gained `targetS1Mm`: ΣS_I is solved to a
  stated value rather than to zero, and the value is **summed by `seidelSums` over
  the plate's real surfaces**, not evaluated from the closed form above. A design
  built from the formula the test then checks would be checking its own
  arithmetic.
- **The stop.** The slip's upper face takes the front of the surface list, so the
  aperture moves to surface 1 — still exactly one flag, the § 6a one-aperture
  rule, and `pupils` images the stop back through the plate to an entrance pupil
  at n·(air gap). Sizing the stop against *that* is what keeps the delivered NA
  exact: r = (t + n·w)·tan u with sin u = NA/n, one formula that collapses to the
  bare `a·tan u` at n = 1 and will carry an immersion medium unchanged. The
  **negative control** is the rung that makes that a claim rather than a shared
  arithmetic: size the stop the § 6b way, ignoring the plate, and the readout
  reports 0.10029 for a lens labelled 0.10 — over-sized by exactly
  √((1−(NA/n)²)/(1−NA²)), and the NA error tracks it nearly 1:1.

**The anti-circularity check is the interesting one.** For the mirrored
(flint-first) objective the bending is solved in the *reversed* frame, where the
specimen side is the image side — so the plate's target is computed at conjugate
b and the null is then measured at conjugate a, on the real chain, in the real
frame. Nothing forces those to agree; that ΣS_I comes out 3e-16 is the § 6b.1
reciprocity statement surviving an extra surface, and it holds for the
crown-first build too. It is also **enforced**, not merely reported: the
constructor throws if ΣS_I on the real chain exceeds 1e-9 of the surfaces' own
cancellation scale, because a lens solved for a plate slightly unlike the one in
front of it sits at the right conjugates and images perfectly happily.

**And the headline is a NULL.** At NA 0.10 the correction the slip demands is
W₀₄₀ = 1.1e-6 mm — 1.4e-4 waves once balanced — which is **400× under the
objective's own fifth-order residual** of 5.9e-2 waves. The bending really does
move (0.04% of the curvature, resolvable and pinned), and it really is optically
irrelevant. A 4×/0.10 is coverslip-*insensitive*, which is why low-power
objectives are not fussy about cover glass, and the ladder now says so with a
number instead of leaving it implied. The wiring is what matters here.

**A prediction this paragraph originally carried, now falsified.** It said the
wiring "becomes load-bearing when the Lister carries NA past 0.4". It does not:
[§ 6d](#step-6d--the-lister-the-first-aplanat-and-the-ceiling-of-two-doublets)
measured two cemented doublets walling out at NA 0.343, identically for a second
glass pair. The wiring waits on the aplanatic front element instead.

### 6c.3 — mismatch

The controlled experiment: the specimen goes Δt deeper into glass and the
objective moves in by Δt/n, so every paraxial conjugate — and the magnification
with it — is untouched and the **only** change in the chain is that Δt of glass
has replaced Δt/n of air. The wavefront difference, with piston and defocus
projected out, is then the mismatch and nothing else.

- **Exactly linear in Δt**, to parts in 10⁴ across a factor of 100 in Δt — the
  traced confirmation of § 6c.1's algebraic linearity.
- **Within 2.4% of the published closed form**, and the deficit is very likely
  the lens's rather than the plate's: moving the objective by the **paraxial**
  apparent depth leaves the real marginal ray a hair off its old height, so a
  sliver of the objective's own large fifth-order residual rides along. Slowing
  the objective at fixed NA — where § 6b.4 pins that residual falling 16× from
  4× to 20× — takes the deficit 2.4% → 1.0% → 0.7%, and it is that **trend**
  that is the evidence. The 0.7% endpoint is not, on its own: it is the same
  size as the tan/sin/exact convention spread at this NA (0.7–0.9%), so the two
  candidate explanations are indistinguishable there. What the monotone fall
  with the objective's own residual rules out is the formula being wrong.
- **1/NA⁴ tolerance**, reported under both criteria the literature quotes,
  because they differ by 6√5·4/14 = 3.83× and a tolerance without its criterion
  is unusable:

| NA | Rayleigh λ/4 on W₀₄₀ | Maréchal λ/14 on the balanced RMS |
|---|---|---|
| 0.10 | 31 mm | 121 mm |
| 0.25 | 805 µm | 3.1 mm |
| 0.40 | 123 µm | 471 µm |
| 0.65 | 17.6 µm | 67.6 µm |
| 0.95 | 3.9 µm | 14.8 µm |

The quarter-wave column is the classical one, and it recovers the familiar shop
numbers: a few microns at NA 0.95, tens at 0.65 — and *thirty millimetres* at
NA 0.10. Same glass, same formula, NA⁴ apart.

### Not yet pinned

- **Index mismatch.** A slip of the right thickness and the wrong glass aberrates
  too, at ∂W₀₄₀/∂n = t·(3−n²)·s⁴/(8n⁴). Only the thickness axis is modelled; the
  index axis is a one-line generalisation of the same plate and is deliberately
  left until something needs it.
- **The correction collar.** § 6c.1's exact-vs-third-order table is the argument
  for one, and nothing here models the moving element that would provide it.
- **Off axis.** A plate in a non-telecentric beam adds coma and astigmatism as
  well; `seidelSums` computes S_II only with the stop at surface 0, which the
  slip now occupies, so the off-axis plate terms are untraced by the third-order
  path. The exact trace sees them and nothing pins them.
- **The infinity-corrected member has no slip.** `microscopeObjective` is
  unchanged; the wiring is the same `targetS1Mm` move and lands when § 6a's
  branch needs it.
- **The mounting medium.** The specimen is taken to be in contact with the glass.
  A real slide has a mountant between them, which is another plate — and at
  matched index, none at all.
- **Tilt.** A non-parallel or tilted slip adds astigmatism; not modelled.

## Step 6d — the Lister, the first aplanat, and the ceiling of two doublets

The § 6a note that "high NA is a different glass form (Lister, then the aplanatic
hyperhemisphere)" comes due. `designs/lister`, `test/lister.test.ts`.

§ 5j found that a cemented doublet's two spherical-aberration-null bendings
**straddle** the coma-free one, so neither is aplanatic, and § 6a measured the
price on a real objective: the emergent marginal ray misses the sine-condition
height by 0.43%. That is not a tolerance to be tightened. One free parameter
satisfies one condition, and ΣS_I = 0 has already spent it.

Two doublets have two bendings, and the two conditions

    ΣS_I = 0     ΣS_II = 0

are solved **together** on the composed six-surface chain, at the conjugates the
objective actually works at. HONESTLY: the historical Lister is a finite-conjugate
objective and predates infinity correction by a century. Lister fixed the lenses
and moved the conjugates; here the architecture fixes the conjugates and the two
bendings are the freedoms. Same two conditions, opposite unknowns — the
*principle*, realised in § 6a's architecture so that it composes with the tube
lens unchanged.

**The stop, and why it cannot contaminate the answer.** This inherits § 6a's
telecentricity deferral, so the stop sits on the front group's rim rather than at
the back focal plane — and coma is stop-dependent. Under a stop shift the
third-order sums transform as S_I\* = S_I, S_II\* = S_II + E·S_I (Welford ch. 8),
so **at ΣS_I = 0, ΣS_II is invariant under stop position**. Solving the two
together is what makes the coma answer well-posed; had S_I been left standing, the
coma would have been a property of where the stop happened to sit. Third order
only — the real-ray sine residual below does move with the stop.

### What is stated, and why it is not an argmin

`powerSplit` k = 0.6 (the front group's share), `separationFactor` 0.6, and
flint-first at both groups are **defaults, not optima**. The joint solve holds
across k ∈ [0.3, 0.8] and separations 0.3–0.9·f, so the aplanat is a property of
the form; picking the split by grid search would have made every number below an
artifact of the grid's own bounds. Which orientation pair wins is itself
k-dependent.

Two positive groups also cannot be combined to an arbitrarily short focal length:
φ = P − d·k(1−k)·P² peaks at 1/(4·d·k(1−k)), so a total power of 1/f needs

    d · k(1−k) < f/4

— 1.042·f at k = 0.6. Checked in closed form up front, because past it the power
fixed point has nothing to converge to and would report a focal-length failure for
what is really an impossible request.

### 6d.1 — the aplanatic sphere: what "aplanatic" means, externally

Included so the word has an external definition before a design claims it. It pins
the **hyperhemisphere** — the follow-on 6d.5's ceiling argues for — and **nothing
about the Lister**, which is pinned by 6d.3 and 6d.4.

A spherical surface between n₁ and n₂ has one conjugate pair, measured from the
VERTEX,

    u = R(n₁+n₂)/n₁     v = R(n₁+n₂)/n₂     m = n₁²/n₂²

exactly stigmatic to all orders (Born & Wolf; Smith, *Modern Optical Engineering*
— the Weierstrass points).

| Rung | Pinned to | Status |
|---|---|---|
| The traced paraxial image distance and magnification ARE the closed forms | Weierstrass, read off the trace rather than restated | ✅ |
| **The axial crossing does not move from sin u = 1e-6 to 0.9** — spread 1.6e-14 mm | exact, to all orders; f64 is the only limit | ✅ |
| sin u′/sin u is CONSTANT at n₂/n₁ across the aperture — coma-free, not merely stigmatic | Abbe | ✅ |
| **NEGATIVE CONTROL: 0.1% off the point costs 1.5e-2 mm**, 1% costs 1.8e-1 | twelve orders of magnitude; the pair is a point, not a region | ✅ |

**The image is VIRTUAL**, and the sign is load-bearing: the useful case is a real
object inside a dense medium, so the centre of curvature lies on the object's
side. Getting it backwards produces a perfectly plausible non-aplanatic surface
whose crossing wanders by millimetres and which total-internal-reflects past
sin u ≈ 0.4 — which is exactly what this module did on the first attempt, caught
by the constancy rung rather than by inspection.

### 6d.2 — the joint solve

| Rung | Pinned to | Status |
|---|---|---|
| **ΣS_I and ΣS_II both < 1e-9 of the cancellation scale**, re-measured on the BUILT chain | anti-circularity, § 6b/6c's currency | ✅ |
| …against a cancellation scale of 1.1e-2 mm, not against zero | or the rung is noise against noise | ✅ |
| **NEGATIVE CONTROL: § 6a's single doublet leaves S_II above 1e-3 of its own cancellation** | § 5j's straddle, on a real objective | ✅ |
| The traced EFL is f_tube/M to a part in 10⁹ — solved, not asserted | the thin-lens split is only a seed | ✅ |
| Traced object NA = the label to 6 digits at NA 0.10 / 0.15 / 0.20 | § 6a's s·tan u stop rule, unchanged | ✅ |
| Both joint roots reported, least-cancelling built; the built bendings are NEAR but not equal to the seed's | the geometry moves under the solve | ✅ |

### 6d.3 — the LAW: solve on Seidel, confirm on the traced wavefront

The rung that actually pins this step. The design nulls ΣS_II from third-order
theory alone; the residual coma is then read off the **traced wavefront** (Noll
Z7/Z8 from `opdMap` at a fixed object height, at best focus), and what changes is
its power law. A number can be fitted. An order cannot.

| NA | single σ | Lister σ | σ ratio | single sine | Lister sine | single coma | Lister coma |
|---|---|---|---|---|---|---|---|
| 0.080 | 4.596e-4 | 2.856e-5 | 16.1× | 0.918% | 0.0385% | 2.299e-4 | 1.976e-6 |
| 0.100 | 1.790e-3 | 1.073e-4 | 16.7× | 2.059% | 0.0929% | 4.402e-4 | 6.318e-6 |
| 0.125 | 7.077e-3 | 4.024e-4 | 17.6× | 5.031% | 0.2245% | 8.411e-4 | 2.013e-5 |
| 0.150 | 2.222e-2 | 1.153e-3 | 19.3× | 11.543% | 0.4516% | 1.439e-3 | 5.165e-5 |
| 0.175 | 6.001e-2 | 2.777e-3 | 21.6× | 26.966% | 0.8096% | 2.325e-3 | 1.147e-4 |
| 0.200 | 1.467e-1 | 5.881e-3 | 24.9× | 75.802% | 1.3354% | 3.730e-3 | 2.292e-4 |

40× on a 200 mm tube, N-BK7/F2, d line, dry. σ is the RMS wavefront in waves at
best focus; the field for the coma and the sine residual is 0.005 mm.

| Rung | Pinned to | Status |
|---|---|---|
| **The single doublet's traced coma runs as NA^2.9–3.5** | third-order coma W₁₃₁ ∝ ρ³ — present | ✅ |
| **The Lister's runs as NA^5.17–5.21, flat** | the NA³ term is GONE, not merely smaller | ✅ |
| Both forms' σ runs as ~NA⁶ | fifth-order spherical, what a third-order solve leaves behind | ✅ |
| …and the single doublet LEAVES that regime, drifting past 6.6 by NA 0.20 | why its σ ratio grows instead of staying a constant | ✅ |
| Matched-NA: 16–25× on axis, 16–120× on coma, 22–57× on the sine residual | § 6a's 0.43% offence against Abbe, answered | ✅ |

**Why the table stops at NA 0.20.** At NA 0.25 the single doublet carries σ = 0.80
waves and its sine residual *changes sign*. At that error the traced chief and
marginal rays are not measuring a lens, and a ratio through that point would be
arithmetic on garbage. The row is excluded from every claim above and recorded
here as the reason.

### 6d.4 — reach: Maréchal, bisected

σ runs as NA⁶, so linear interpolation between samples is not good enough; both
crossings are bisected.

| Rung | Pinned to | Status |
|---|---|---|
| **The single cemented doublet is diffraction-limited to NA 0.1797** | Maréchal σ ≤ λ/14, external | ✅ |
| **The Lister to NA 0.2733** — 1.52× the NA, and so 1.52× Abbe's resolution | the same criterion | ✅ |
| **…and its limit is the SOLVE, not aberration**: at its ceiling it is still λ/27 | the two ceilings coincide | ✅ |
| NEGATIVE CONTROL: the single doublet's *constructor* ceiling is NA 0.2608 | a DIFFERENT fact — see below | ✅ |

**Two walls that must not be conflated.** `achromaticObjective` refuses NA ≥ 0.261
because the root count of S_I(c₁) stops being the classical two (three roots at
0.30, one at 0.40). That is **constructor strictness about the structure**, not
"no SA-null bending exists", and it sits 45% above the physics wall. The number to
quote is the Maréchal 0.1797.

The Lister's own result is the more interesting one: the default form stops
*existing* before it stops being diffraction-limited. Its binding constraint is
that no makeable joint root survives, not that the wavefront has degraded.

### 6d.5 — the ceiling is a property of the FORM

| Rung | Pinned to | Status |
|---|---|---|
| The joint solve holds at every k ∈ {0.3 … 0.8} and separation ∈ {0.3 … 0.9}·f | a form, not a lucky split | ✅ |
| **N-BK7/F2 walls out at NA 0.343; fused silica/F2 at 0.383** | neither reaches 0.4 | ✅ |
| d·k(1−k) < f/4 is enforced in closed form, with its own message | the combination limit | ✅ |
| Crown-first at both groups does not solve at all at the default split | orientation is a choice, not an inference | ✅ |
| …and flint/crown is BETTER on axis than the default flint/flint | recorded trade: it reaches 0.245 against 0.273 | ✅ |

Measured by a direct scan of NA, not a bisection: solvability has one small gap
and is not quite monotone, so a bisection's answer depends on its bracket. Both
winning (k, separation) pairs at the ceiling are **interior** to the grid — (0.5,
0.3) and (0.6, 0.7) — and extending the grid to k = 0.9 and separations of 2.2·f
moves neither number, so the ceiling is not an artifact of the search. It IS
conditioned on the glass thickness rules (`achromaticObjective`'s 0.10D/0.06D
floors) and on `glassMarginFactor` 1.15: looser thicknesses reach slightly
further, and the numbers travel with those conventions.

Two glass pairs walling out together is what makes this a statement about the
**form**. It is the third piece of evidence for the aplanatic front element, after
§ 6a's F = 1/(2·NA) and § 6b's 4× sitting at f/4.1 — and 6d.1 is the closed form
that element will be pinned against.

### 6d.6 — scale-free, and a module

| Rung | Pinned to | Status |
|---|---|---|
| **The same NA at 10×, 20× and 40× is ONE design**: c₁·f and a/f identical to 9 digits | S_I ∝ h⁴ makes the solve scale-free in f | ✅ |
| …so σ in waves is exactly ∝ f: the 40× is 2.000× the 20× and 4× the 10× | § 6a's own magnification rung, reproduced | ✅ |
| It satisfies `InfinityCorrectedObjective` and composes with § 6a's tube lens unchanged | ARCHITECTURE's "an objective is a module" | ✅ |
| Exactly one stop flag in the composed chain, on surface 0 | § 6a's one-aperture rule — two spliced doublets would break it four ways | ✅ |
| M is unchanged by the infinity space at 20 / 100 / 250 mm | why the infinity space exists | ✅ |

### Not yet pinned

- **The aplanatic hyperhemisphere itself.** 6d.1 pins the closed form; no design
  uses it yet. That is the immersion unit, and this step's measured ceiling is the
  argument for it.
- **Chromatically the pair is only as good as its glasses.** Each group is
  achromatic by construction, so the secondary spectrum is § 5j's and is not
  re-pinned here; the joint solve is monochromatic, at the d line.
- **Field beyond coma.** S_III–S_V are still uncomputed (`analysis/seidel`'s
  stated scope), so astigmatism and field curvature are traced and unpinned. An
  aplanat is not an anastigmat.
- **The coverslip.** § 6c's `targetS1Mm` route applies unchanged — the target
  would now be a pair of them, one per group — and is not wired here.
- **The finite-conjugate (DIN) Lister**, which is the historical form. § 6b's
  machinery would carry it; nothing here needs it.

## Step 6e — oil immersion: the plane stack, exactly

§ 6d ended with a measured wall: two cemented doublets stop solving near NA 0.35
for *two different glass pairs*, so the ceiling belongs to the form. The way past
it is an element in front that reduces the aperture without adding aberration,
which is only possible at a surface's aplanatic conjugates — the closed form
§ 6d.1 pinned and no design used.

Before any of that glass, though, there is something to look through. A dry
objective has one plate in its cone (§ 6c); an immersion objective has a **stack**
— cover glass, fluid film, the flat underside of the front element — three
indices, in the steepest cone in the instrument. This rung is that stack, and it
comes first because it needs no lens.

### Why this rung is as strong as § 6c's

For the same reason: it is solvable **to all orders** from Snell alone. With
q = n·sinθ the ray invariant (conserved across every plane face, and equal to the
numerical aperture), and n_out the index the light emerges into:

    D    = n_out · Σᵢ tᵢ/nᵢ
    LSA  = Σᵢ tᵢ·[ n_out/nᵢ − √(n_out²−q²)/√(nᵢ²−q²) ]
    W(q) = Σᵢ tᵢ[√(nᵢ²−q²) − nᵢ] − n_out(√(n_out²−q²) − n_out)·Σᵢ tᵢ/nᵢ

Rationalised per layer, each carries (nᵢ²−n_out²) as an explicit factor, and W
carries an explicit q⁴ — so the third-order coefficient is not fitted but read
off the algebra.

### 6e.1 — the stack

| Rung | Pinned to | Status |
|---|---|---|
| **One layer emerging into air REDUCES to § 6c**, term for term, at 4 ULP | `plateLongitudinalAberrationMm` / `plateWavefrontErrorMm` / `plateW040Mm` | ✅ |
| **A MATCHED stack aberrates a HARD ZERO** — `toBe(0)`, at every q to 1.5 | algebraic identity, not a tolerance | ✅ |
| The traced axial crossing IS the closed-form LSA to 1e-12, q ≤ 1.4 | exact tracer vs exact answer, all orders | ✅ |
| **The traced WAVEFRONT is the closed-form W to 1e-12**, built from the tracer's own accumulated OPL | as above; nothing consults the formula until the comparison | ✅ |
| POSITIVE CONTROL: matched media leave the traced crossing flat to 1e-13 at q = 1.4 | the identity, seen by the tracer rather than the algebra | ✅ |
| NEGATIVE CONTROL: the same stack DRY carries 34 waves at q = 0.95, and refuses q > 1 | why the fluid is there at all | ✅ |
| The sign follows the contrast — denser layers one way, rarer the other, so a stack balances against itself | § 6c's sign, per layer | ✅ |
| W₀₄₀ is the q → 0 limit, and the exact form LEAVES it | both halves; only the second catches a wrong higher order | ✅ |

**The identity is the point.** Set every nᵢ = n_out and each summand vanishes on
its own, for every q, to all orders. That is not a small residual to be measured;
it is why immersion fluid is formulated to the index of the front element and the
cover glass, and it is what lets an objective work at NA 1.4 through 0.17 mm of
glass that would wreck a dry NA 0.95.

### What the REAL triad costs, and the finding that surprised

Quoted as **balanced σ** — piston and defocus projected out — because that is the
currency Maréchal is stated in. The peak W at NA 1.25 is 0.59 waves and comparing
*that* to λ/14 would be comparing two different quantities, which is exactly the
confusion § 6c was careful to head off.

| NA | σ, N-BK7 front | σ, D 263 front | Maréchal λ/14 |
|---|---|---|---|
| 0.95 | 1.03e-2 | 1.59e-3 | 7.14e-2 |
| 1.25 | 6.49e-2 | 1.00e-2 | 7.14e-2 |
| 1.40 | 2.10e-1 | 3.25e-2 | 7.14e-2 |

Cargille Type B (1.51512), D 263 T eco (1.52330) and N-BK7 (1.51680) are all
"1.515 glass" and all different in the third decimal. With an N-BK7 front element
the stack at NA 1.25 is **inside Maréchal and only just — it spends 91% of the
whole diffraction-limited budget on itself**, leaving 9% for the objective that
has to look through it. "Inside the limit" and "affordable" part company here. At
NA 1.4 it is 2.9× outside, on the stack alone.

**The dominant layer is the cover glass, not the oil** — the 0.17 mm slip against
the 0.02 mm film — and the film's contribution is of the *opposite* sign (it is
rarer than the front element), so it buys back a few percent rather than adding.

**The lever is the front element's glass, and its gain is bounded at 6.5×.** Build
the front from the cover glass's own borosilicate and the thick layer's
(nᵢ²−n_out²) collapses entirely — but moving the front element onto the slip moves
it *off* the oil (Δn 0.0017 → 0.0082), so the thin film's share grows by nearly
five as the slip's vanishes. There is no single index that matches both. That
three-way compromise is what specifying an immersion fluid to four decimals is
fighting, and the ladder now has a number for it.

**Higher orders dominate.** § 6c could quote W₀₄₀ and be nearly right because a
dry objective's NA caps at 1. An immersion stack has no such excuse: the exact
wavefront is 1.15× the third-order coefficient at q = 0.5, 2.9× at 1.25 and 5.3×
at 1.4. Anything toleranced on W₀₄₀ alone would be wrong by a factor of five, in
the reassuring direction.

### 6e.2 — the hyperhemisphere

The first design in this repo to consume § 6d.1's closed form. One dome, worked
at the Weierstrass pair with the specimen inside the dense medium: the aperture
n·sinu is divided by n² and the image magnified by n², both exactly.

The specimen is placed by matching **apparent** distance through § 6e.1's stack —
n_glass·Σtᵢ/nᵢ = u = R(n+1)/n — and the element's thickness is the unknown that
closes it. So the residual is honestly whatever the stack's index mismatch costs
and nothing else, which is exactly what the control pair below measures.

| Rung | Pinned to | Status |
|---|---|---|
| **MATCHED: the traced axial crossing does not move from q = 1e-6 to 1.25** — spread < 1e-12 mm | Weierstrass, exact to all orders | ✅ |
| …and lands at v = R(n+1) in front of the dome vertex, read off the trace | § 6d.1's closed form, on a built element | ✅ |
| **sinu′/sinu is CONSTANT at 1/n across the aperture** — aplanatic, not merely stigmatic | Abbe | ✅ |
| The aperture is divided by n² and the magnification is n², both from the trace | Lagrange | ✅ |
| NEGATIVE CONTROL: the specimen 1% off the point takes the spread from 1e-13 to 1e-8 | the pair is a point, not a region | ✅ |
| **CONTROL PAIR: matched media 1e-13, the real slip+oil bench 1e-4** — a 10⁹ ratio on identical geometry | § 6e.1's identity, seen by the tracer | ✅ |
| The rim fraction is the closed form sin(θ + arcsin(sinθ/n)) and is SCALE-FREE — identical at R = 0.3, 0.5, 1.5, 4 | geometry | ✅ |
| **The stop radius is EXACT at a plane face** — the marginal ray's own hit on surface 0, at NA 1.25 and 1.40 | § 6a's blocker, closed | ✅ |
| The NA ceiling is the chain's RAREST medium (the fluid), not the glass | q conserved across plane faces | ✅ |

**§ 6a's first named immersion blocker is closed, and the diagnosis was half
wrong.** § 6a recorded that its aperture seed "is a tangent and is 2.6× out at
NA 1.4". A tangent is not an approximation at a *plane* face — a ray leaving the
specimen at θ and crossing t of medium lands at exactly t·tanθ, to all orders.
What was 2.6× out was using the sine-condition height f·sinu as though it were a
stop radius, which was never what it is (§ 6a's own 2% finding at NA 0.10, grown
up). With the stop on the first plane face the radius is a closed form that is as
exact at NA 1.4 as at NA 0.01, and no solve is needed anywhere.

**The rim is a ridge, not a wall.** h/R = sin(θ + arcsin(sinθ/n)) has no R in it,
so a bigger dome buys no margin. It reaches 1 near **NA 1.275** for D 263, where
the marginal ray grazes the equator exactly and no hyperhemisphere of any radius
has room to spare; either side of that it comes back down (0.971 at NA 1.40). A
design has to know which side of the ridge its aperture sits on, and this is why
a high-NA front element is a ball cut past its own equator rather than a gentler
lens.

### 6e.3 — the aplanatic meniscus, and the front group

A sphere has three stigmatic conjugate pairs and the meniscus uses two of them,
one per surface: the first surface **concentric** about the incoming virtual
object point (perfect, and bends nothing at all), the second at the **Weierstrass**
pair of that same point in glass. Their magnifications are 1/n and n², so a
meniscus is m = n and divides the aperture *angle* by n — not by n², and
conflating the two pairs would cost the whole design.

| Rung | Pinned to | Status |
|---|---|---|
| **The concentric surface bends NOTHING** — emergent sine = incident sine to 13 digits | normal incidence, by construction | ✅ |
| Its radius is not a free parameter: concentricity fixes it to the object distance | closed form | ✅ |
| The rear radius is R₂ = (R₁+t)·n/(n+1) and the new image at u₂·n | Weierstrass | ✅ |
| **MATCHED GROUP: still exactly stigmatic after a dome and two menisci** — spread < 1e-11 | exactness composes; a third-order design does not | ✅ |
| The group's sine ratio is flat, and the aperture divided by exactly n²·nᵏ at k = 0, 1, 2, 3 | Lagrange, per element | ✅ |
| The traced transverse magnification IS n²·nᵏ, signed (erect — the image is virtual) | Lagrange, measured independently of the aperture rung | ✅ |
| NEGATIVE CONTROL: a rear radius 1% off Weierstrass moves the spread by 10⁶ | the closed form used, not gestured at | ✅ |
| The solve holds across every stated gap ∈ {0.1, 0.2, 0.5} and thickness ∈ {0.3, 0.5, 0.9} | § 6d's discipline: a form, not a lucky pick | ✅ |

### THE BUDGET — this step's number is the last step's measurement

§ 6d measured that two cemented doublets stop solving at NA 0.343 (N-BK7/F2) and
0.383 (fused silica/F2). The front group's job is to deliver an aperture under
that, and **the count of menisci is set by that number rather than by taste**:

| Object NA | dome only | + 1 meniscus | + 2 menisci | § 6d ceiling |
|---|---|---|---|---|
| 1.25 | 0.539 | 0.354 | **0.232** | 0.343 |
| 1.40 | 0.603 | 0.396 | **0.260** | 0.343 |

One meniscus is not enough at either aperture — both land above the ceiling. Two
is enough at both, and NA 1.40's 0.260 is under § 6d's *default* reach of 0.273
as well, so the rear group need not be pushed to its own edge. That is the whole
argument of § 6e in one table.

### 6e.4 — the composed oil-immersion objective

§ 6e's aplanatic front, then § 6d's Lister, spliced into an
`InfinityCorrectedObjective`. It composes **without a re-solve**: the front group
leaves a virtual image, the Lister was solved for a real object at its own front
focal distance, and putting one exactly at the other hands the rear group the
conjugate pair and the cone it was solved for. That is the whole benefit of an
aplanatic front — it changes the aperture and the magnification without changing
the aberration problem.

Nothing here is chosen twice. The front group's magnification n²·nᵏ is fixed by
the glass and the meniscus count alone, so the rear group's share is known before
any geometry exists (f_rear = (f_tube/M)·m_front, NA_rear = NA/m_front); the dome
radius is then *solved*, not picked, because every length in the front group is
exactly proportional to R.

**Third-order theory is deliberately absent.** `analysis/seidel` seeds its
marginal ray with the paraxial slope h/s — a tangent — and § 6c measured the tan
and sin conventions parting company by a factor of three at NA 0.65. At NA 1.25 a
Seidel sum is not a wrong number, it is not a number. Every rung below is read off
the traced wavefront or off real rays.

| Rung | Pinned to | Status |
|---|---|---|
| **The traced object NA IS the label** at 1.00 / 1.25 / 1.40, to 7 digits | § 6e.2's closed-form stop, never solved against the NA | ✅ |
| 100× is 100× on a real chief ray, and the paraxial EFL is f_tube/M to 1e-9 | § 6a's convention, through 13 surfaces | ✅ |
| **DIFFRACTION-LIMITED from NA 1.0 to 1.40** — σ ≤ 0.35·λ/14 throughout | Maréchal, external | ✅ |
| **The ceiling is GEOMETRIC: NA 1.411, bisected**, where the placement-solved R meets `minimumDomeRadiusMm` | § 6d.4's shape — the design stops existing, not stops working | ✅ |
| …and at that ceiling the wavefront is still **λ/50** | the two walls are 3.6× apart | ✅ |
| **The COVER SLIP HELPS** — with it σ is 1.7× better than in a matched bath | § 6c's sign, at the aperture it matters | ✅ |
| The sine residual is ~0.9%, and it is the REAR group's (§ 6d measured 1.3% at NA 0.20) | attributed, not just bounded | ✅ |
| Abbe: NA 1.4 resolves 210 nm against a dry 0.95's 309 nm — the NA ratio exactly | Abbe, external | ✅ |
| NEGATIVE CONTROL: a Lister asked for NA 1.25 refuses — sinu > 1 in air | not a hard problem, an impossible one | ✅ |
| **NEGATIVE CONTROL: 0 or 1 meniscus and the Lister refuses in ITS OWN words** | the failure quotes § 6d's ceiling, not a new number | ✅ |
| Exactly one stop flag, on surface 0, after splicing two groups that each declared one | § 6a's rule | ✅ |
| The placement solve is exact: the virtual image lands at `frontImageFactor` of the rear object distance to 1e-10 | and the R-linearity it rests on is asserted directly | ✅ |
| **`minimumDomeRadiusMm` is EXACT on a matched stack** (1e-7, the bisection's own floor) | it is a homogeneous-medium geometry statement | ✅ |
| …and on the real bench it under-estimates by 1.2e-5 (NA 0.5) → 3.7e-3 (NA 1.4), monotone in NA | the stack mismatch, growing with its leverage — an explanation, not a discrepancy | ✅ |
| **THE EXTREMA, not the endpoints: rim utilisation peaks at 0.999995 at NA 1.275** — the marginal ray at the dome's EQUATOR | scale-free h/R = sin(θ + arcsin(sinθ/n)); the aperture a coarse sweep steps over | ✅ |
| …and at the equator it still builds, delivers its NA to 7 digits and stays diffraction-limited | grazing incidence is where § 6e.3's self-vignetting bug lived | ✅ |
| **NA 1.410 builds and is inside Maréchal; NA 1.411 THROWS** | it fails loudly, not by handing back a ray outside a rim | ✅ |

**The flagship, measured.** A 100×/1.25 oil objective on a 200 mm tube: dome
radius 0.480 mm, element thickness 0.604 mm, working distance 0.19 mm, stop
radius 0.244 mm on the slip's face, rim utilisation 0.999, rear group a Lister at
NA 0.232 and f 10.77 mm with ΣS_I = 0 and ΣS_II = 3e-18. Traced NA 1.25000000,
traced magnification −99.96, σ = 0.0179 waves.

**Two walls, and which one binds.** Above NA 1.411 the dome floor and the
placement ceiling cross and no front group exists; had that not bound first, the
Lister's own § 6d ceiling of 0.343 would have bound at NA 1.470. The wavefront
binds nowhere in that range. This is § 6d.4's finding repeating in a different
mechanism, and it is worth saying plainly: **twice now the form has stopped
existing well before it stopped being diffraction-limited.**

**The cover slip helps, which is not the obvious direction.** § 6e.1 says the slip
adds spherical aberration and § 6d says the Lister leaves a fifth-order residual;
they are of opposite sign, so the objective *with* its slip is better corrected
than the same objective in a perfectly index-matched bath (σ 0.0179 against
0.0300). This is why a real objective is corrected as a whole including the glass
it looks through, and it is § 6c's "using it without a slip is worse than not
correcting at all", arriving at the aperture where it bites. It also means the
correction depends on a plate the objective does not control — which is what
§ 6e.5 goes on to measure rather than leave as a worry.

### 6e.5 — the slip tolerance: what refocusing fixes, and what it cannot

§ 6e.4 measured σ with the *nominal* 0.17 mm slip, and a design point is not a
tolerance — especially here, where the cover slip was found to be carrying part of
the correction. This step measures the dependence rather than assuming it in
either direction, and it splits into three mechanisms that behave nothing alike.

**The refocus model is worth more than any of the numbers.** A real immersion
objective is focused by *moving it*, which changes the oil film — the gap **is**
the focus control. Refocusing only on the image side with the film held fixed is
not a conservative assumption, it is a different instrument, and it is wrong by an
order of magnitude. So the sweeps refocus the way the closed form says to: hold
the stack's paraxial apparent distance n_g·Σtᵢ/nᵢ — § 6c's own quantity,
generalised in § 6e.1 — constant, which is one evaluation and not a search. The
pin is that closed form, not a published slip tolerance.

| Rung | Pinned to | Status |
|---|---|---|
| **A thickness error contributes an EXACT zero** to `stackWavefrontErrorMm` — `toBe`, at ±20 µm | slip and front element are both D263, so (n²−n_out²) = 0 identically | ✅ |
| …so the oil is the only mismatched layer and carries the *whole* residual, bit-for-bit | § 6e.1's identity, used as a decomposition | ✅ |
| **REFOCUSED, σ holds across 0.15–0.18 mm**: ≤0.10·λ/14 at NA 1.0, ≤0.35·λ/14 at NA 1.25 | Maréchal, external | ✅ |
| …and at NA 1.0 σ is nearly INVARIANT — ±20 µm of slip moves it under 15% | to first order it is not an error, just a different place to stand | ✅ |
| **NEGATIVE CONTROL: film held fixed, +5 µm is already 3× the budget at NA 1.40** — and 0.41× refocused | picking the wrong refocus model costs an order of magnitude | ✅ |
| **The delivered NA is SLIP-DEPENDENT**: NA(t) = n_slip·h/√(t²+h²), traced to 2e-4 | § 6e.2's `planeLayerHeightMm`, read backwards | ✅ |
| …signed the surprising way — a THINNER slip delivers a HIGHER aperture | the rim is fixed; the specimen moves closer to it | ✅ |
| **PREDICTED then confirmed: the thin side ends at t = 0.1613 mm**, where the delivered NA reaches § 6e.4's 1.411 ceiling | closed form first, then the tracer starts losing rays across it | ✅ |
| The thick side is bounded by the **oil film**, not by σ: 0.19 mm asks for a 0.11 µm film | `immersionGapMm` is the knob, not the form | ✅ |
| **INDEX is what refocusing cannot fix**: ±0.003 is outside Maréchal at NA 1.40, symmetric to 5% | a displacement is signed; a broken index match is not | ✅ |
| …and survivable at NA 1.25 (0.81·λ/14), so index tolerance is part of what aperture costs | the cost climbs with NA | ✅ |
| **MEASURED, NOT ACTED ON**: the placement solve is ~0.8 µm off its own σ optimum, worth 9–16× at NA 1.0–1.25 | the later step gets a target instead of a guess | ✅ |

**The three mechanisms.** *Thickness* costs nothing in aberration: the slip and the
front element are the same glass — § 6e chose D263 for the front precisely because
matching it to the *slip* beat matching it to the fluid — so a thickness error is
a pure axial displacement of the specimen, and refocusing is exactly the operation
that removes one. *Thickness does move the delivered aperture*, which is not
obvious and is what actually ends the range. *Index* breaks the match that made
thickness free, and no axial motion touches it.

**The finding: a cover slip changes the objective's NA.** The rims are fixed glass
sized from the nominal slip, and the specimen sits on the slip's underside — so a
thinner slip puts it closer to those rims, and the same rim subtends a wider cone.
Measured: 1.4126 at 0.160 mm and 1.3870 at 0.180 mm on an objective labelled 1.40.
At NA 1.25 the effect is identical in form and reaches nothing (1.298 at the thin
end of the band, far under any wall). At NA 1.40 it is what ends the thin side, and
predictably: inverting the plane-layer height puts the delivered NA at § 6e.4's
1.411 ceiling when the slip is 0.1613 mm — 8.7 µm thin — and the tracer begins
losing rays across exactly that thickness. **A third mechanism, and the same wall.**
The two previous times the form stopped existing before it stopped working; this
time the aperture climbs into a wall that was already measured, from below.

**So the § 6e.4 claim survives, with its condition stated.** The 100×/1.40 is
diffraction-limited across the slip band it will actually meet — *provided the
instrument is focused*, which is what focusing an immersion objective means. With
the film pinned instead, σ crosses Maréchal within ±1.6 µm at NA 1.40 and ±3.8 µm
at 1.25. The binding tolerance is not thickness at all: it is the slip's **index**,
where a realistic ±0.003 is already 1.9× the budget at NA 1.40.

**And the placement is not at its own optimum.** The specimen is placed at the
dome's paraxial Weierstrass point, exact for the dome alone; the objective around
it also carries the oil's mismatch and § 6d's fifth-order residual, and the σ
minimum sits ~0.8 µm of apparent distance away — worth 9× at NA 1.0 and 16× at
NA 1.25. Recorded and deliberately not acted on: moving it re-solves every number
in §§ 6e.2–6e.4, and it is the same open item as correcting for the stack on
purpose. What is pinned is that the gain exists and how big it is.

### Not yet pinned

- **Off-axis, everywhere.** Both the stack and the aplanatic elements are pinned
  on axis only. An aplanat is not an anastigmat (§ 6d's open item, inherited) and
  a plate in a non-telecentric beam adds coma and astigmatism (§ 6c's, inherited).
- **Chromatic.** Every number here is at the d line, and the aplanatic condition
  is wavelength-dependent through n — a dome is aplanatic at ONE wavelength. The
  three media also have genuinely different Abbe numbers (oil 42.9, D 263 54.5,
  N-BK7 64.2), so the stack's mismatch is chromatic too. Neither is measured.
- **Correcting an objective FOR its stack, deliberately.** 6e.4 found the slip's
  aberration cancelling the rear group's by luck of sign, not by design. § 6c's
  `targetS1Mm` route would make it intentional and would buy the rest; the Lister
  solves ΣS_I = ΣS_II = 0 with no target, and giving it one is a real change.
  6e.5 gives that step a measured target: the placement alone is worth 9–16× at
  NA 1.0–1.25, and index — not thickness — is the tolerance that binds.
- **The correction collar itself.** 6e.5 says what one would have to correct, and
  it is *not* the classical picture. Thickness is absorbed by focusing, so a
  collar's job here is the slip's index and the delivered-NA drift that comes with
  a thickness error — neither of which a refocus touches. Nothing builds one yet.
- **A thicker oil film.** `immersionGapMm` defaults to 20 µm against the ~130 µm a
  real 100×/1.40 carries, and 6e.5 measured that the film — not the wavefront —
  is what ends the thick side of the slip band. Raising it is untried.
- **The tube lens is unchanged from § 6a**, so the composed microscope's field
  performance is still its, not the objective's.
- **Water immersion and the dry ceiling.** The catalog has dispersive water
  (§ 1) and nothing here uses it; NA 1.0-class water objectives are the same
  construction with a rarer fluid, and the rarest-medium rung already says what
  caps them.
- **Tilt, wedge, and a non-uniform film.** The stack is taken to be plane,
  parallel and axial.

## Step 6f — brightfield: the condenser, and partial coherence

Every image the engine has formed until now came from an object that **emits** —
a star, and a fluorescent bead when § 6 gets there. Intensities add, the image is
a convolution with |PSF|², and one MTF describes it. A brightfield specimen emits
nothing. It sits in a beam from a condenser and modulates it, so whether two
neighbouring points of the specimen interfere depends on where their light came
from. That is partial coherence, and it makes the image **nonlinear in the
object's intensity**: brightfield has no MTF, and the "incoherent MTF × a
condenser factor" the ROADMAP once promised for v1 would have been a fiction.

What replaces it is Abbe's own construction, and it is a sum rather than a fudge:
the condenser aperture is a set of illumination directions, each direction images
**coherently**, and different directions come from mutually incoherent points of
the lamp so their intensities add —

    I(x) = Σ_s w_s · | F⁻¹{ T(u) · P(u + s) } |²

with the modulus-squared *inside* the sum. Illuminating from direction s slides
the object's spectrum by s; changing variables slides the pupil the other way
instead and leaves a global phase the modulus discards. So an illumination
direction is a **translated `PupilFunction`** — the same lever the spider (§ 5c)
and the seeing screen (§ 5d) pulled, and the transform underneath never learns
its name.

### Why this step can be pinned as hard as § 6c and § 6e

Because for the one object class that *is* linear — a **weak absorber** — the
whole transfer curve has a closed form, and it is pure circle geometry:

    T(ν) = area( disc(0, S) ∩ disc(ν, 1) ) / (π·S²),     S = NA_cond / NA_obj

the illumination directions for which the undiffracted beam *and* the order at ν
both get through, which are the only pairs that can interfere and so the only
ones carrying contrast at ν. Frequency ν is in units of NA/λ throughout this
step: **ν = 1** is the coherent cutoff and **ν = 2** is `wave/mtf`'s incoherent
cutoff 2·NA/λ (so § 2b's ν is half of this one). Both ends of the curve are
exact, and the middle is a law:

| Rung | Pinned to | Status |
|---|---|---|
| Source weights are a partition; the lattice fills (π/4)·N² and converges | closed form | ✅ |
| **S → 0: T ≡ 1 below ν = 1 and ≡ 0 above** — a flat plateau and a cliff | coherent imaging, `toBeCloseTo(1, 12)` / `toBe(0)` | ✅ |
| Coherent cutoff is exactly ν = 1, i.e. NA/λ | bisected | ✅ |
| **S ≥ 1: T is `diffractionLimitedMtf`** — the SAME closed form § 2b pins | Goodman, no second number minted | ✅ |
| Opening past S = 1 changes nothing: S = 1.5 and S = 3 give the same curve | pupil autocorrelation | ✅ |
| The measured sum matches the three-circle closed form at S = 0.25/0.5/0.75 | closed form, < 1e-3 | ✅ |
| The plateau survives at finite S out to ν = 1 − S, and is **exact** there | algebraic, `toBeCloseTo(1, 12)` | ✅ |
| `circleOverlapArea`/π ≡ `diffractionLimitedMtf` for two unit circles | closed form, 1e-12 | ✅ |

### 6f.1 — the (NA_obj + NA_cond) law, measured

The textbook line is d_min = λ/(NA_obj + NA_cond). Nothing here writes it down:
the cutoff is *bisected* off the sum and comes back exact, with its own
discretization visible rather than buried in a tolerance. An odd sample count
puts a row of source points on the axis, so the outermost usable direction is at
S·(1 − 1/N) and the measured cutoff is **1 + S·(1 − 1/N)** — matched to 9 places
at N = 17, 33, 65 and S = 0.25 … 1, and extrapolating to exactly 1 + S.

| Rung | Pinned to | Status |
|---|---|---|
| Cutoff = 1 + S·(1 − 1/N), to 1e-9, over N × S | lattice geometry + closed form | ✅ |
| Cutoff is **linear in S with unit slope** | law, not a ratio | ✅ |
| `brightfieldResolutionMm(λ, NA, NA)` ≡ `abbeResolutionMm(λ, NA)` | § 6a's λ/(2·NA) | ✅ |
| `brightfieldResolutionMm(λ, NA, 0)` = 2× that — λ/NA | coherent limit | ✅ |
| Past a matched condenser it stops improving | capped at ν = 2 | ✅ |

**And the law stops at S = 1** — which is not a modelling choice but the sum's
own doing. A source point outside the pupil has no undiffracted beam to
interfere with, so it contributes no linear transfer at all; the support is set
by the pupil's autocorrelation and cannot exceed 2·NA/λ however far the
diaphragm opens. Measured: the cutoff at S = 1.25, 1.5, 2, 3 never exceeds 2.

**What the diaphragm actually trades.** Just under the coherent cutoff the closed
condenser still delivers full contrast where a matched one has already spent 60%
of it (0.397) — 2.5× the contrast, bought by giving up everything between ν = 1
and ν = 2. That is the dial, and both ends of it are now pinned.

### 6f.2 — the source is a sampling parameter, and it is treated as one

N_source has the same failure mode as the pupil grid: too coarse, and it produces
structure that reads as physics. At 5 directions across the diameter the transfer
is 4% wrong — an error that would pass for aberration. So convergence is pinned,
not assumed. Only cells the pupil's rim cuts can be wrong, so the error is a
perimeter effect; the measured rate is about N^−1.3, faster than the O(1/N) a
discontinuous integrand guarantees because midpoint errors of opposite sign
partly cancel around the rim. It is **not** monotone doubling-by-doubling (ratios
run 1.85–4.7), so the rung pins the rate over two doublings and the total (> 30×
from N = 8 to 128) rather than claiming a halving it does not have.

### 6f.3 — two paths to the same number

`illumination/abbe` runs the sum with an inverse FFT per source point — the
general imager, which is what the scenes will need. `illumination/transfer` runs
the *same* sum with the transform done in closed form, because a sinusoidal
grating's spectrum is three lines and the inverse transform is then three terms.
Three pupil evaluations per direction instead of a transform is what makes
sweeping ν × S × N affordable, and the two are pinned against each other rather
than one being trusted:

| Rung | Pinned to | Status |
|---|---|---|
| FFT image harmonics ≡ the three-order evaluation, dc and fundamental | 1e-12, over 6 frequencies | ✅ |
| A clear field images as exactly 1 — not nearly | `toBeCloseTo(1, 12)` at every pixel | ✅ |
| A grating past (1 + S) images as a blank field | < 1e-12 | ✅ |
| A grid too small for the shifted pupil **throws** rather than truncating | no silent caps | ✅ |

`abbeImage` needs `size ≥ pupilSamples·(1 + S)` for the shifted pupil to fit on
the frequency grid. Clamping the box instead would truncate the pupil, and a
truncated pupil is indistinguishable from a smaller aperture — a coverage cap
that would read as physics. It throws, with the size it needs.

### 6f.4 — the nonlinearity, made visible

The transfer function above is a **limit**, not a description, and the rungs say
so. `gratingImage` evaluates the exact three-order sum at finite modulation. The
readout is image contrast ÷ the object's *own intensity* contrast, 2m/(1+m²/2) —
dividing by 2m instead would fold in a factor computable without any optics. So
normalized, it converges to the weak-object transfer as m → 0 (6 places at
m = 1e-4) and then walks **away** from it: 1.3% above at m = 0.3 and **11.2%
above at m = 1**. There is no function to multiply the object by.

And a single-frequency object images with a component at **twice** its frequency,
growing exactly as m² (a factor of 1e4 for a factor of 100 in m, to 9 places) — a
frequency no linear imager could have put there. **It lands above the cutoff.**
At S = 0.5 nothing is linearly transferred past ν = 1.5, yet a grating at
ν = 0.8125 puts a component of amplitude 0.18 at ν = 1.625 into the image, where
the linear transfer is exactly zero. That is spurious resolution — real detail in
the image at a frequency the instrument cannot linearly carry, and detail the
object did not have there. Both computation paths agree on it to 1e-12, so it is
the physics and not one path's artifact. It does **not** reach past ν = 2: the
harmonic needs both diffracted orders inside the pupil, which is the same
autocorrelation ceiling everything else in this step runs into.

### 6f.5 — the null: brightfield cannot see phase

A weak phase object's two sidebands enter the intensity with opposite signs:

    T_phase(ν) = |Σ w·[ P(s+ν)P̄(s) − P(s)P̄(s−ν) ]| / (2·Σ w·|P(s)|²)

so for a real pupil the two terms are equal and this is **identically zero** — at
every frequency, every S, and every phase amplitude. That is the strongest kind
of rung this ladder has: a hard zero from an algebraic identity, and it is the
reason stains exist.

| Rung | Pinned to | Status |
|---|---|---|
| Aberration-free pupil transfers **no** phase, over S × ν | < 1e-14 | ✅ |
| (the null needs a **symmetric source** as well as a real pupil — every source here is centro-symmetric, and a lopsided one would break it with no aberration at all) | stated, not pinned | — |
| A quarter wave of defocus makes it appear (T > 0.3) | the sum, not a switch | ✅ |
| A tenth of the defocus leaves under a fifth of the signal; zero defocus, zero | continuity in the aberration | ✅ |
| The full FFT image of a real (all-Bessel-orders) phase grating agrees | < 1e-12 focused, > 0.02 defocused | ✅ |
| In focus it leaves a residue at **2×** its frequency | the nonlinearity again | ✅ |

So a focused brightfield image of an unstained cell shows almost nothing and a
defocused one shows something — a fact every microscopist knows and no part of
this file was told.

### 6f.6 — darkfield, for free

An annular condenser whose *inner* radius exceeds 1 puts every illuminating beam
outside the objective's pupil. An object that diffracts nothing then delivers
nothing: the clear field images **exactly 0**, `toBe(0)` at every pixel, with no
special case anywhere in the sum. The phase object brightfield could not see is
visible against it — faint (1% of the brightfield mean) but on a black
background, which is the whole trick.

### 6f.7 — a traced objective, through its own pupil

The closed forms above are for an ideal disc. The same readouts run on the
*traced* wavefront of § 6a's 4×/0.10 (0.031 waves rms) and § 6d's Lister 20×/0.25
(0.070 waves rms), best-focused:

| Rung | Pinned to | Status |
|---|---|---|
| The cutoff is unchanged — 1 + S·(1 − 1/N) to 1e-9 on both | § 2b's "the cutoff is geometric" | ✅ |
| Contrast falls below the ideal pupil at every ν | aberration spends contrast below cutoff | ✅ |
| And falls **in wavefront order**: the 0.070-wave lens is under the 0.031 | ordering, not a value | ✅ |
| The condenser still buys resolution on a real lens: 1 → > 1.9 | § 6f.1 on traced glass | ✅ |

### 6f.8 — the frequency axis is the engine's, not this step's

Everything above is stated in ν, and both computation paths share that
convention — so a factor-of-two or one-bin error in `px = 2k/pupilSamples` would
leave *every* closed-form comparison passing, because the closed forms would be
sampled at the same mislabeled ν. Pinning S ≥ 1 against `diffractionLimitedMtf`
does not close that: it is evaluated at this step's own ν, which makes it an
algebraic identity rather than a bridge between two rulers. This is § 3c's
kernel-orientation drift in a new place — two modules, one shared convention,
nothing forcing agreement — so the bridge is a function
(`spatialFrequencyCyclesPerMm`, f = ν·NA/λ) and it is pinned both ways.

| Rung | Pinned to | Status |
|---|---|---|
| Bin `pupilSamples` on an Abbe grid **is** 2·NA/λ, over pupilSamples × padFactor | `imagePixelScaleMm`, exact | ✅ |
| ...and that number is `wave/mtf`'s own `cutoffCyclesPerMm` | 1e-9 | ✅ |
| **One `PupilFunction`, two implementations**: `psf` → `mtf` versus the Abbe sum at S = 1 | agree to < 1e-2 over ν | ✅ |
| Each also sits on the closed form from its own side | 1e-3 | ✅ |

The residual is two discretizations, not a convention: the Abbe sum's largest
departure from the closed form is 3.3e-4 (its source sampling) and the PSF path's
is 9.1e-3 (its pupil grid), which is the whole of the 9.2e-3 gap between them. A
mislabeled axis would show as a curve of the wrong shape, not an offset that
size.

### 6f.9 — the geometric branch has no coherence, so brightfield rules instead of blending

Every PSF the engine forms has two branches and a cross-fade between them: the
FFT while the wavefront is resolved on the pupil grid, a ray histogram once it
is not, and a smoothstep across the criterion (§ 2g). That works because both
branches compute the *same* quantity by two methods, each correct where the
other fails.

**Brightfield has one branch and cannot have two.** Every term of the Abbe sum
is a coherent field; a ray histogram has no phase, so it cannot interfere, so it
cannot represent the one thing the sum exists to represent. Falling back to it
would not degrade partial coherence gracefully — it would silently answer a
different question. So the deferral stands, and what lands here is the detection
whose absence the previous entry named ("nothing currently detects that"): a
**verdict** rather than a fallback, which is the same shape of response § 5d
made when it left the seeing ∇φ ray-tilt unbuilt and pinned the guard that
catches the trap instead.

Two independent questions, two readouts, and neither answers the other.

**Is a coherent sum the right physics here at all?** `brightfieldFidelity`
reads the *traced-sample* criterion — the real one, measured on raw samples for
the reason `wave/fidelity` gives — and rules `valid`, `no-honest-image`, or
`unknown`. The asymmetry with the PSF is the whole content: where `adaptivePsf`
ramps, this is a **cliff**, because there is no partially coherent branch to
mix toward. Any geometric share above zero is a refusal.

| Rung | Pinned to | Status |
|---|---|---|
| Absent sampling is `unknown`, never `valid` — and that is the *default* case, since `psfFromPupilFunction` (the shape `abbeImage` is called in) carries no `sampling` | the trap `adaptivePsf`'s `: 0` default would spring here | ✅ |
| The 4×/0.10 of § 6f.7 is `valid` at 0.015 waves per sample — thirty times inside the criterion | every traced § 6f number is on the FFT branch by a wide margin | ✅ |
| It is `adaptivePsf`'s own switch read twice, not a second switch: step and share `toBe` equal, exactly | one criterion, two callers | ✅ |
| Inside the blend band the PSF mixes 27.8% ray histogram and stays honest; brightfield refuses at any share > 0 | `geometricWeight`, and the missing capability made visible | ✅ |
| A denser pupil grid genuinely rescues the same wavefront: `no-honest-image` at 64 and 128, `valid` at 256, with the step falling exactly as 1/pupilSamples | phase per *sample*, not total waves | ✅ |

**Did this grid carry the pupil it was handed?** `AbbeImage.maxGridPhaseStepWaves`
is `wave/psf`'s number measured on the lattice the sum actually evaluates — and
every source point reads that lattice at its own offset (ix − n/2)·h + s, so it
is maximized over the source rather than taken at s = 0. Lattice step is
h = 2/pupilSamples, and because 1/h is an integer the outermost transmitting
pair on the centre row is exactly (1 − h, 1), which makes the defocus closed
form an **identity rather than a bound**:

    max step = W·h·(2 − h) = (4W/pupilSamples)·(1 − 1/pupilSamples)

The (1 − 1/pupilSamples) is a difference quotient estimating a derivative at
the midpoint of its pair, half a lattice step inside the rim — § 5d's gradient
rung carries the same factor from the same cause.

| Rung | Pinned to | Status |
|---|---|---|
| An unaberrated pupil steps nowhere | `toBe(0)` | ✅ |
| Defocus lands on W·h·(2 − h) at four grids × three strengths | closed form, 1e-12 | ✅ |
| ...approaching the naive 4W/pupilSamples from **below** by exactly (1 − 1/pupilSamples) | the midpoint factor, as an identity | ✅ |
| It crosses ½ at W = pupilSamples²/(8·(pupilSamples − 1)) | closed form, 1e-12 | ✅ |
| For defocus the sub-lattices barely differ: spread ≤ 2W·h², measured at 0.378 of it, and the disc's number `toBe` the max over its points run singly | px_max ∈ (1 − 2h, 1 − h]; no *direction* is claimed — registration is not monotone in \|s\| | ✅ |
| The same pupil through `wave/psf` and through the sum gives one number | `toBeLessThanOrEqual` (exact: point-sampling makes this module's transmitting set a strict subset of the area-averaged one) then equal to 1e-12 | ✅ |

**Why the maximum is over the source and not taken at s = 0.** Defocus makes
that choice look cosmetic, and it is not — it only looks that way because
defocus is smooth and peaks at the rim, where the on-axis sub-lattice already
has a point. A pure phase **ripple** breaks it completely. A ripple of k cycles
per unit pupil radius steps by 2A·sin(πkh)·cos(2πk(ρ + h/2)) between
neighbours, and at k = pupilSamples/4 — period exactly 2h — the sampled
midpoints (m + ½)h land on cos = 0 for *every* m. The on-axis sub-lattice reads
the ripple as identically zero. Offsetting by s rotates those midpoints and the
same ripple reads full strength. This is the aliasing wavefront `wave/fidelity`
warns about, arriving where it can do the most damage: silently.

| Rung | Pinned to | Status |
|---|---|---|
| At the lattice period, s = 0 reads the ripple as **zero** | < 1e-12 — invisible to floating point | ✅ |
| An offset sub-lattice reads 2A·\|sin(π·s/h)\| — full strength 2A at s = h/2, and *across* the half-wave criterion where s = 0 was silent | closed form, 1e-10, at three offsets | ✅ |
| A real condenser finds it: an S = 1 disc recovers 99.89% of the full step | the max over directions is not a formality | ✅ |
| ...but it is a max over the directions the condenser **has**, not over all offsets: S = 0.7 at 15 samples recovers only 28.9% | source sampling is § 6f.2's convergence knob, and this rides on it rather than escaping it | ✅ |

**What ½ physically is.** A slope of s waves per pupil sample displaces a ray by
s·size pixels — the identity `defaultRayGrid` already rests on — so s = ½ puts
it at size/2, the grid edge. The criterion is not a rule of thumb about
aberration; it is the point where the spread stops fitting.

| Rung | Pinned to | Status |
|---|---|---|
| `maxGridPhaseStepWaves`·size = 4W·size/pupilSamples · (1 − 1/pupilSamples) — the geometric blur radius, short by the midpoint factor | closed form, 1e-12, on three grids carrying the same 96-px physical blur | ✅ |
| A pinhole is spectrally flat, so its image *is* the coherent spread; far from focus that is a uniform disc, which puts **¼** of its energy inside half its radius | a uniform disc — closed form owing nothing to the engine — to 2%, on both grids that fit it | ✅ |
| The grid that does not fit it reads 0.330 instead: the wrap folds the outside back onto the middle | > 0.32, and the two resolved grids agree with each other 150× better | ✅ |
| A clear bar under S = 0.5 and 12 waves: the two resolved grids agree to 5e-3 across the whole profile | convergence at fixed physical pixel scale, fixed source | ✅ |
| The unresolved grid is 13% out in the skirt and **57% out in the tail** — error growing with distance from the object, which is what wrap does and lost resolution does not | > 0.12 and > 0.5 | ✅ |
| **Control:** one wave of defocus on the *same* grids, including the 64-px one that failed at twelve — all four agree to 3e-3 | it is the guard deciding, not the grid being small | ✅ |

**And what the guard does *not* mean, pinned so it is not overread.** A cosine
grating's spectrum is three lattice lines, so the sum only ever evaluates the
pupil at three points per direction and there is nothing between them to alias.
At twelve waves of defocus, with the guard running 1.45 → 0.19 across four
grids, the grating contrast is identical **to nine places**. So every other
§ 6f rung — all of them gratings — is untouched by this, and the guard is a
statement about *broadband* objects: the class the scenes (diatoms, tissue)
will belong to and the gratings never did.

### Not yet pinned

- **The geometric PSF branch still has no notion of coherence** — only the
  detection landed (§ 6f.9), not the capability, and there is no capability to
  land: a ray histogram has no phase to interfere with. Everything here lives in
  the FFT branch, exactly as § 5d's seeing screen does. The nearest geometric
  analog is a different physical effect, refraction of rays through the
  *specimen's* ∇φ — which is phase-object visibility in the geometric limit
  (transport-of-intensity), not partial coherence — and it is the same shape of
  deferral as the seeing ∇φ ray-tilt, recorded beside it under "Later rungs".
- ~~**The verdict has no caller yet.**~~ **Closed at § 6g.3.** `renderBrightfield`
  consults `brightfieldFidelity` once per patch and reports the WORST verdict,
  so one corner that has left the coherent sum's regime is not averaged away by
  good neighbours. What is still true is the sentence under it: a pupil function
  carries no memory of what traced it, so absent sampling reads `unknown` and
  the bridge passes that through rather than rounding it to `valid`.
- **Scenes.** Diatoms, stained tissue and fluorescent beads are the step's named
  deliverables and none exists; `abbeImage` is the imager they need. The bridge
  from it into a field decomposition landed at § 6g.3 — but nothing in § 6f
  itself is spatially variant: one pupil, one isoplanatic patch.
- **Fluorescence**, which is the *easy* half — a fluorescent specimen is
  self-luminous, so it is the incoherent path the engine already has, plus
  Stokes-shifted emission and filter passbands. Not started.
- **Polychromatic brightfield.** Every number here is monochromatic. The source
  is a set of directions at one wavelength; a real lamp is a spectrum, and the
  sum would run per wavelength on § 2e's common physical grid.
- **A non-uniform source.** `diskSource` weights every direction equally, which
  is Köhler with an evenly filled diaphragm. A real filament image is not even,
  and *critical* illumination — the filament imaged onto the specimen — breaks
  the direction-set model rather than reweighting it.
- **Aperture-edge sampling in `abbeImage`.** The pupil is point-sampled on the
  DFT lattice there (correct for a sampled spectrum, and stated in the header),
  so an extended object sees a staircased rim where `wave/psf` would see an
  area-averaged one. **Now measured, in § 6g.1:** which lattice points fall
  inside the rim changes with the illumination direction, and that costs a few
  1e-4 absolute in a two-point cross-term energy — invisible against an image,
  and percent-level only when divided by a near-vanishing autocorrelation. It
  does not shrink with `pupilSamples`.
- **Phase contrast and DIC** need a phase plate in the pupil and Hopkins' TCC
  respectively; both are v2, and the annular source is already here waiting.
- **Off-axis.** One field point, on axis, like the rest of § 6.

## Step 6g — the coherence width, and what a field decomposition may window

| Rung | Pinned to | Status |
|---|---|---|
| J₁ series agrees with Bessel's integral, (1/π)∫₀^π cos(θ − x sin θ)dθ | second definition | ✅ |
| J₁ vanishes at j₁,₁, j₁,₂, j₁,₃ and keeps one sign between them | tabulated zeros | ✅ |
| jinc(0) = 1, and 1 − v²/8 + v⁴/192 either side of the cut | series limit | ✅ |
| μ(0) = 1; a point source is coherent at every separation | closed form | ✅ |
| A disc condenser's μ converges on 2J₁(v)/v | van Cittert–Zernike | ✅ |
| Its first zero is 0.61·λ/NA_condenser | textbook coherence width | ✅ |
| The Abbe image's own cross term equals Re μ | continuum identity | ✅ |
| Past the first zero the interference returns inverted | jinc sign | ✅ |
| C = Σ√(w₁w₂): 1 in a shared mixture, 0 across a seam, ≤ 1 always | Cauchy–Schwarz | ✅ |
| 1 − C = δ²(1/α + 1/(1−α))/8 for a window difference δ | closed form | ✅ |
| An input-side partition multiplies the cross term by exactly C, pointwise | exact algebra | ✅ |
| …and C is the same number under every condenser | closed form | ✅ |
| An output-side partition is the identity at a field-constant pupil | Σ w ≡ 1 | ✅ |

`brightfieldFidelity` landed at § 6f.9 with no caller, because the bridge from
`abbeImage` — which images **one isoplanatic patch** — into `imaging/render`'s
field decomposition was unbuilt. This step is not that bridge. It is the thing
that had to be settled first, because the two do not compose the way they look
like they do, and building the bridge on the assumption that they do would have
produced a picture that was wrong in a way no check in this repo catches.

### The finding: the partition of unity may window the output, never the input

`imaging/render` decomposes the field into patches and blends with a partition
of unity, and it windows the **scene** rather than the output, with an argument
stated in its own header: windowing the input splits the *light*, so every
photon is convolved with the kernel nearest where it came from. That argument is
airtight, and it is airtight because incoherent imaging is **linear in the
object's intensity**. Abbe imaging is not — that is § 6f's headline — and the
scheme fails here in a way that is not a matter of degree.

Split an object amplitude between patches (necessarily as √w_p, since it is the
*intensities* that must partition), image each patch, add the intensities. The
self terms come back whole, because Σ_p w_p ≡ 1. The cross term between two
object points comes back multiplied by

    C = Σ_p √( w_p(x₁) · w_p(x₂) )   ≤ 1

by Cauchy–Schwarz, with equality only where the two points sit in the *same
mixture* of patches. Where a seam separates them the factor is not small, it is
**zero**: the interference is deleted, and interference between neighbouring
object points is the entire content of partial coherence. Expanding about equal
mixtures gives 1 − C = δ²·(1/α + 1/(1−α))/8 for a window difference δ — second
order in the difference, but with the coefficient blowing up at the *edges* of
the window, which is precisely where a decomposition puts its seams. Measured on
the rung's own geometry: two points 8 cells apart on a 128-cell grid lose under
2% at two patches and **89%** at sixteen, where a patch is as wide as the
separation.

The rung that pins this is pointwise and exact — the windowed image minus the
two self images equals C times the unwindowed cross term at every pixel, to
1e-12 of the cross term's peak — and it holds through the **hard-rimmed** ideal
pupil, because it is algebra about the windows and knows nothing about the
aperture.

The error therefore factorizes into one geometric term and one physical one:

    error = (1 − C) · |cross term|,      cross term ∝ μ(Δ)

and **C carries no S**: it is identical under a coherent source and a wide-open
condenser, pinned across S ∈ {0, 0.5, 1.1}. The S-dependence lives entirely in
μ, which is why the scheme looks harmless in the incoherent limit — there is no
cross term left to damage — and is worst exactly where brightfield is
interesting.

Windowing the **output** costs nothing where the pupil is field-constant: Σ_p w_p
≡ 1 and every patch forms the same image, so the blend is the identity to 1e-12
at any patch count. That is engine-vs-itself and not a rung on its own, but it
is the fact that makes the output side the available side. The § 6g.3 bridge
will therefore flip the window to the output relative to `imaging/render`, and
the two modules disagreeing about which side to window is not a contradiction —
it is two different operators, and the brightfield module says so where a reader
comparing them would otherwise conclude one is broken.

### Energy conservation is not a witness, and that is worth saying out loud

At the object the input-side split is exact by construction: Σ_p ∫w_p|t|² =
∫|t|². The conservation check this repo reaches for first therefore **passes for
the scheme that deletes the interference**. In the image the two schemes do
differ, but by exactly (1 − C) times the cross-term energy — the same quantity
the rung above already measures, wearing a different name — and opening the
condenser collapses that deficit along with μ while the deletion is unchanged.
Pinned as an identity, deficit = (1 − C)·(cross energy) to 10 places, so the
absence of independent information is recorded rather than assumed.

### μ, and the number it produces

The complex degree of coherence is the source's own transform,

    μ(Δ) = Σ_s w_s · exp(2πi·s·Δ)

which is the van Cittert–Zernike theorem in the only form this engine needs:
`illumination/coherence` computes it as the sum over the condenser's *sampled*
directions, so it is what the Abbe image really contains rather than a parallel
model of it. The rungs pin it three ways.

**Against the closed form.** For the uniform disc `diskSource` builds, the
continuum limit is 2J₁(v)/v with v = π·S·pupilSamples·Δ/size. The sampled sum
converges on it — worst-case error over S ∈ [0.2, 1.4] and four zeros' worth of
separation falls monotonically with the source count and reaches 3e-3 at 129
samples across the diameter. That is § 6f.2's convergence knob seen from the
object side instead of from the transfer function. The imaginary part is
identically zero for every centro-symmetric source, which is the statement that
the fringes sit where the geometry says.

**Against the textbook width.** Bisecting the sampled μ for its first zero and
converting through `imagePixelScaleMm` gives **0.61·λ/NA_condenser** — matched to
2e-4 relative at 257 source samples, at S = 0.4, 0.75 and 1.2. Nothing in the
chain that produced that number knew what a millimetre was until the last line.
The engine carries no 0.61 anywhere: the constant is j₁,₁ = 3.8317059702, and
0.61 = j₁,₁/2π is what comes back out — the *same* constant as Rayleigh's
resolution criterion and the Airy first dark ring's 1.22, because all three are
the first zero of a filled circle's transform. The discretization converges
**non-monotonically** (7.7e-3 at 17 samples, 4.1e-5 at 257): the error is set by
how a square lattice happens to cut the rim of a disc at each count, so it is a
magnitude that falls rather than a sequence that descends, and the rung asserts
it that way.

**Against the imager.** The cross term of a two-point object, measured off
`abbeImage` and divided by the same thing under coherent illumination, equals
Re μ to 9 places at separations either side of the first zero and through it.
This is the rung that makes μ the image's property rather than a second theory
beside it — the illumination direction multiplies the object by a phase ramp, so
the pair's cross term picks up exp(2πi·s·Δ), and the source sum of that *is* μ.

Two details of that rung are load-bearing rather than incidental. Each point's
own image has to be formed under the **same** source: a rasterized pupil
transmits a slightly different set of lattice points from each direction, so a
self term computed once and reused leaks that difference into the cross term.
And the identity is a **continuum** one, so it is pinned on an apodized pupil.
Through the hard-rimmed ideal pupil the same measurement holds only to a few
1e-2 — this is § 6f's own deliberate point-sampling of the rim, worth a few 1e-4
absolute in the cross energy, showing up worst where the disc's autocorrelation
at that separation is near a zero and divides it up. It does not improve with
`pupilSamples`. Recorded here so a later reader measuring 2% on a hard pupil
finds it already named.

**And the sign matters.** Past the first zero μ goes negative: two object points
beyond the coherence width are *anti*-correlated before they are uncorrelated,
which is why the width is named by the first zero and not by a half-height. An
annulus of the same outer radius holds |μ| further out than the disc, because
the transform of a ring decays more slowly — the darkfield source of § 6f seen
from the object side.

### J₁, and why it is a series rather than a table

The closed form needed a Bessel function, and the engine had gone this far
without one deliberately: every diffraction result so far came out of an FFT of
an actual pupil, so the Airy pattern was *produced* rather than evaluated.
`math/bessel` changes nothing about that — it is the closed form a rung compares
against.

It is the defining power series, evaluated by term recurrence, and not one of
the published minimax approximations. A table of fitted coefficients would have
to be transcribed, which this repo forbids for the same reason it forbids
transcribing a lens prescription from memory: the numbers would be unpinnable
and a typo in the sixth digit invisible. A series is a definition, so it can be
pinned against a *second* definition — Bessel's integral, evaluated by a
quadrature that converges geometrically because its integrand is smooth and
periodic. The price is cancellation: the terms have total magnitude I₁(x) ≈
e^x/√(2πx) and sum to something below 0.6, so f64 returns about ε·I₁(x) of
absolute accuracy — 15 digits below x = 3, 13 by x = 10 where every caller in
this engine lives, ~1e-7 by x = 25, past which it refuses rather than returning
noise. The rung's tolerance is that bound, derived rather than tuned, and it
holds with an order of headroom at every x because the roundoff is a random walk
rather than an adversary.

### § 6g.3 — the bridge, and the verdict's first caller

`imaging/brightfield`'s `renderBrightfield` is the field decomposition applied
to the side § 6g.2 leaves available: each patch forms a **whole** `abbeImage`
through its own pupil, and the finished intensities are blended with the same
`patchWeight` partition of unity `imaging/render` uses.

| Rung | Pinned to | Status |
|---|---|---|
| A field-constant pupil makes the decomposition the identity, at 1, 2, 4, 8 patches | Σ w ≡ 1 | ✅ |
| The outer half-patch's local contrast is § 6f's three-order closed form for *that patch's* pupil | § 6f closed form | ✅ |
| …and the two edges are different numbers; one patch lands between them | § 6f closed form | ✅ |
| The interior converges geometrically in the patch count, ratio ≈ 0.4 per doubling | convergence | ✅ |
| The worst patch's verdict rules; `unknown` does not mask `no-honest-image` | ordering | ✅ |
| `requireHonest` refuses both `no-honest-image` and `unknown`, and only when asked | — | ✅ |
| The grid guard comes through as a max over patches, the source count as a min | — | ✅ |
| The pupil callback is keyed on normalized position, not patch index | — | ✅ |

**The edge patches are exact, and that is where the external number enters.**
`patchWeight` runs *flat* to the frame edge — the outermost half-patch is covered
by one window at weight 1 and by no other, which is the same detail that stops
`imaging/render` rendering every border at half brightness. So in that strip the
blend is not an approximation: the output **is** `abbeImage` through that patch's
pupil, bit for bit. Its local grating contrast is therefore § 6f's own
three-order closed form for that pupil — matched to 9 places at both ends of a
frame whose defocus runs from 0.1 to 0.9 waves, and the two ends are different
numbers by more than 10%, so a render that had quietly used one pupil everywhere
would fail. A single patch lands strictly between them, which is the whole point
of the decomposition stated as an inequality. The interior is pinned by
convergence and not by a closed form, and § 6g's deferral list says so.

**Output windowing is forced, and it costs what `render.ts` says it costs.**
Where the pupil genuinely varies, this blends images each formed with the wrong
pupil over most of their support — the isoplanatic approximation running from the
destination point instead of the source point, which is precisely the objection
`imaging/render` raises against output windowing. It is paid here because the
input side is *unavailable*, not because it is cheaper. What that costs has no
closed form, so the rung measures the sequence: the worst-pixel change per patch
doubling falls 16.4% → 6.4% → 2.4% → 0.97% of peak, a stable ratio just under 0.4
— between first and second order. The rung asserts the *ratio*, not merely that
each step is smaller than the last, because a wandering image satisfies the
latter and a stalling one would show the ratio drifting to 1.

**The verdict finally has a caller.** § 6f.9 landed `brightfieldFidelity` with
nothing in the engine to consult it, pinned then so it could not be forgotten
now. `renderBrightfield` calls it once per patch and reports the **worst**:
a frame is not honest in the places where it happens to be, and averaging one
corner whose wavefront has left the coherent sum's regime against its good
neighbours would be exactly the silent substitution of incoherent imaging that
`illumination/fidelity` exists to prevent. `no-honest-image` ≻ `unknown` ≻
`valid`, pinned including the case that matters — an `unknown` patch beside a
`no-honest-image` one still reports `no-honest-image`. The refusal is opt-in
(`requireHonest`) rather than default, because absent traced sampling reads
`unknown` and a default throw would make the function unusable for every caller
that has a pupil but not the trace behind it; the verdict is always returned and
is not a field a caller can round down. `maxGridPhaseStepWaves` and
`contributingPoints` come through aggregated the way each one means something —
a worst case and a coverage floor — rather than from whichever patch ran last.

**The pupil arrives by normalized position, not by patch index**, and that is
load-bearing rather than tidy: with index keying, "patch 2 of 4" and "patch 2 of
8" are different field points, so raising the patch count would change the
physics instead of refining the discretization and the convergence rung above
would be measuring nothing.

**Cost is patches² × source points × one N² transform.** There is no locality
saving to be had — every patch images the whole object, because the object's
spectrum is global. Progressive refinement, which `imaging/render` has, is not
built: the shape is identical and the rungs would be the same rungs.

**Not wired to a traced system.** ~~Mapping an `OpticalSystem` and an
object-plane position onto the pupil callback is object-space field mapping for a
finite conjugate — its own capability, and the next unit.~~ **Closed at § 6h.**
The field-varying pupil these rungs use is still a labelled fixture (defocus
linear across the frame) and not a claim about any real objective; § 6h repeats
the convergence measurement on a traced one and finds a different rate.

### Not yet pinned

- **What the output-side scheme costs where the pupil DOES vary**, as a
  *number* rather than as a rate. § 6g.3 measures the patch-count convergence and
  pins its ratio; nothing pins the limit it converges to, because there is no
  closed form for a non-isoplanatic partially coherent image and Hopkins' TCC —
  which would give one — is a v2 item. The edge patches are exact and the
  interior is a sequence.
- ~~**The bridge to a traced system.**~~ **Closed at § 6h.** Every § 6g.3
  field-varying rung still uses a labelled fixture, so nothing *here* is a claim
  about a real objective's field curvature — § 6h is where a traced one is
  measured, and it converges at a different rate than the fixture does.
- **Coherence off axis, and in two dimensions with a decentred source.** μ is
  computed for an arbitrary (Δx, Δy) and an arbitrary source, and the complex
  form is carried because an oblique condenser displaces the fringes — but every
  rung here uses a centro-symmetric source and a separation along one axis.
- **Polychromatic coherence.** μ is wavelength-dependent through the same grid
  relation, and a real lamp has a coherence *length* as well as a width. Both are
  monochromatic here, as all of § 6f is.

## Step 6h — object-space field mapping for a finite conjugate

`imaging/object-field` is the seam § 6g.3 named: an `OpticalSystem` and a
normalized frame position onto `renderBrightfield`'s pupil callback. The chain is

    (u, v) ∈ [0,1]²  →  image-plane mm  →  OBJECT height (mm)  →  traced pupil

— the finite-conjugate twin of `imaging/scene`'s `fieldAngleFor`, running the
other way because `illumination/abbe` takes the object in reduced (image-plane)
coordinates, so the grid the patches are blended on is the image and the mapping
has to walk back along the chief ray to reach the specimen.

| Rung | Pinned to | Status |
|---|---|---|
| Forward ∘ inverse on the traced chief ray is the identity, to 1e-9 | identity | ✅ |
| The departure from the linear map grows as h³ — ×8.00 per doubling, to 1% | third-order distortion is cubic | ✅ |
| …and it is not the paraxial map: r/\|M\| differs from the traced answer | — | ✅ |
| An unreachable radius throws, naming the radius and not the probe height | — | ✅ |
| An infinite conjugate is refused rather than read as an angle | — | ✅ |
| Half-extent is exactly pupilSamples·λ·R/(4·n′·r_exit), to f64 | closed form | ✅ |
| …independent of the grid size, and linear in pupilSamples | DFT reciprocity | ✅ |
| Its departure from pupilSamples·λ/(4·NA) IS sin u′/tan u′ − 1, to f64 | identity + the objective's aplanatism | ✅ |
| Coma grows as h¹ and astigmatism as h² across the field | third-order field dependence | ✅ |
| `rotatePupil` ↔ `rotateKernel` at 90° and 180°, to the dropped strip | § 3c convention, cross-module | ✅ |
| …and the centroid carries the handedness, to 0.023 px of 3.6 | — | ✅ |
| `rotatePupil` composes and is the identity at 0, to f64 at any angle | — | ✅ |
| A traced patch carries `sampling`, so the verdict rules `valid` | § 6f.9's first traced caller | ✅ |
| The edge patch IS `abbeImage` through the mapper's own pupil, to 1e-12 | § 6g.3 exactness | ✅ |
| The frame is NOT isoplanatic; convergence ratio ½, not the fixture's 0.4 | convergence | ✅ |
| A field-blind mapper makes the decomposition the identity, to 1e-12 | Σ w ≡ 1 | ✅ |
| The one common ruler drifts by 1e-6 across the frame | measurement | ✅ |

**The inverse is bisected on the traced chief ray, never divided by a
magnification** — `fieldAngleFor`'s argument at a finite conjugate. The forward
map carries distortion; an inverse that did not would hand every off-centre patch
the pupil of the wrong object point, and on exactly the systems where it matters
most. The departure between the two is pinned as an ORDER rather than a value,
because the coefficient is this objective's own and nothing external fixes it:
the heights double and the departure multiplies by 8.00, 8.01, 8.05 — cubic to
1%, which is third-order distortion and nothing else. It is small (6.5e-6 mm at
h = 0.4 mm) and it is three orders above the bisection's own 1e-9 closure, so it
is aberration and not noise.

**The frame's extent is set by `pupilSamples` and NOT by the grid.** The
half-extent is λ·R·pupilSamples/(4·n′·r_exit), in which the size has cancelled —
`imagePixelScaleMm` is ∝ 1/size and the extent is size × that. Doubling the grid
resolves the image better and shows not one micron more of specimen. This is DFT
reciprocity: pupilSamples frequency bins across the pupil ⟺ pupilSamples
resolution cells across the image, and that is a **cost statement**. Covering a
4×'s real 5 mm field at its 2.75 µm resolution wants pupilSamples ≈ 1800 and a
grid to match. Step 4's framing lesson, arriving where it bites harder:
`renderField` could resample a PSF onto a coarser scene grid, and this cannot,
because the Abbe sum's grid IS its frequency lattice.

**The textbook form pupilSamples·λ/(4·NA) is 2.7% out, and the 2.7% is the
objective's own aplanatism.** The closed form is written in the numerical
aperture; the frame is built from the PARAXIAL exit pupil, whose r/R is a
*tangent*. The whole image-side departure is therefore sin u′/tan u′ − 1, pinned
as an identity to f64. Referred to the specimen it needs the sine condition as
well, and the DIN 4× is a single cemented doublet solved for ΣS_I with ΣS_II
picking the root — which § 5j showed cannot be aplanatic — so its sine-condition
residual is 2.3%. The object-side form comes out only 0.5% out because the two
errors partly cancel, and that cancellation is written down as a coincidence of
this objective rather than as accuracy.

**The rotation is EXACT here, and that asymmetry is the finding.** Every traced
pupil belongs to a field point on +x, so a frame position's pupil must be turned
to its own azimuth or every patch's coma would point the same way —
`imaging/render`'s `rotateKernel` argument, one layer earlier in the pipeline.
One layer earlier is the whole difference: `rotateKernel` turns a sampled array,
so it interpolates and renormalizes the energy it loses, while `rotatePupil`
turns a **callback** and there is nothing to resample. Composition and the
identity hold to f64 at any angle. The cross-check runs at 90° and 180°, where
`rotateKernel` maps the lattice onto itself and is interpolation-free — but it is
still not exact, because it skips destinations sourced from the last row and
column and renormalizes. **Both tolerances are derived from that strip**, not
picked: the pixel bound from its peak and energy fraction, and the centroid bound
from f·n/2 (a fraction f of the energy deleted from at most n/2 pixels out).
0.023 px against a 3.6 px coma displacement, and the pair 90°/180° is what pins
the handedness — a transposed convention would send +x to −y and land here.

**The frame is NOT isoplanatic, and that revises the prediction.** The frame
spans only pupilSamples resolution cells — 47 µm of specimen on a 4×/0.10 — which
looked far too small to leave a corrected objective's isoplanatic patch. It is
not: the corner reads 8.8e-3 waves of coma against the axis's 7.5e-6 (the
least-squares fit's own noise floor on a rotationally symmetric trace), and the
image moves 0.9% of peak on the first patch refinement. So the decomposition
earns its keep. § 6g.3 pinned this convergence as a *ratio* because a wandering
image also satisfies "each step is smaller"; on a traced objective the ratio is
**0.50**, where the labelled defocus-ramp fixture gave just under 0.4. The
fixture was representative in SHAPE — geometric convergence — and not in RATE,
which is exactly why § 6g.3 pinned a measured number and did not call it a law.
The control matters as much as the measurement: a mapper that hands every
position the axial pupil reproduces the identity to 1e-12, so the 0.9% is field
variation and not plumbing.

**§ 6f.9's verdict finally runs on a trace.** § 6g.3 gave it its first caller and
every frame still ruled `unknown`, because a bare `PupilFunction` carries no
memory of what produced it. A `PatchPupil` from here carries `opdSampling` from
the trace behind it, so a traced frame rules `valid` and survives `requireHonest`
— which nothing traced could do before.

**One `PupilScale` for the whole frame, read on axis**, because the patches are
blended pixel for pixel and a common ruler is what makes that legal. Each patch's
own `opdMap` reports its own reference-sphere radius and exit-pupil radius; those
build that patch's pupil and are then discarded. Threading them into the scale
would blend images on different rulers — `wave/polychromatic`'s failure mode, and
just as invisible to an energy check. What the common ruler costs is measured:
1e-6 across the frame. The exit-pupil half of that drift is **identically zero**,
and that is a limit of the instrument rather than a result — `pupils()` is a
paraxial construction with no field argument, so it cannot move with the field
whatever the optics do. What the number bounds is the reference sphere following
the chief ray's image point.

**The cost cliff is vignetting, and it is avoided rather than survived.**
`pupilFunctionFromOpd`'s vignette predicate re-traces a ray on every amplitude
query; `wave/psf` pays that once per FFT cell, but `illumination/abbe` pays it
once per lattice point **per source point**, so a vignetting field point
multiplies the trace count by the condenser's sampling. Following `psf()`, the
mask is built only when the trace already shows loss, and the DIN 4× is pinned to
clear its own glass at every frame corner (`lost === 0`).

### Not yet pinned
- **The grid itself is not warped.** Distortion is carried in the *pupil
  assignment* — each patch gets the pupil of the object point its image position
  really comes from — but each patch's `abbeImage` is still formed on the
  undistorted grid, so a specimen authored by uniform scaling is placed by the
  paraxial map. `objectPointAt` exposes the object-plane coordinate a
  distortion-carrying rasterizer would need; that rasterizer is not built.
- **Telecentricity is assumed.** Every patch is handed the same `CondenserSource`
  with its points centred on the pupil, which says the illumination cone stays
  centred at every field point. § 6a lists object-space ray aiming as an open
  blocker and § 6h inherits it: a non-telecentric condenser would shift each
  patch's source points along with its chief ray, and `shiftPupil` is already the
  operator that would do it.
- **Pupil aberration.** The scale-drift measurement bounds the reference sphere's
  motion and says nothing about the exit pupil's, because `pupils()` is paraxial
  and field-independent by construction. A system whose pupil genuinely walks
  with the field would need a different instrument, and none in the ladder has
  one.
- **A field large enough to need many patches.** The rungs run at pupilSamples 32
  — 47 µm of specimen — because the frame's extent is proportional to it and the
  transform cost is quadratic. The convergence ratio is measured there and
  nothing pins that it holds at a field ten times wider.

## Step 6i — fluorescence: the specimen that emits

§ 6f's brightfield specimen emits nothing — it modulates a beam, so whether two
of its points interfere depends on where their light came from, and the image is
nonlinear in the object's intensity. A fluorophore is the opposite in every one
of those clauses. It absorbs a photon and emits a new one, spontaneously, with no
phase memory of the exciting field and none of its neighbours, so the emitters
are **mutually incoherent by nature**, their intensities add, and the image is a
plain convolution:

    I(x) = h(x) ⊛ E(x),     h = |F⁻¹{P}|²

with E the emitter density. There is no condenser in that line, and no S. This
step's whole content is that the claim is *provable against the engine's own
partial-coherence machinery* rather than asserted, and that the proof is exact.

| Rung | Pinned to | Status |
|---|---|---|
| **A lattice-matched source past 1 + B makes the Abbe sum exactly incoherent** | identity, < 1e-12, cross-module | ✅ |
| …at m = 1 as well as m = 0.2 — § 6f.4's nonlinearity **vanishes** | linearity in emitter density, 1e-12 | ✅ |
| A source that stops at S = 1 (or 0.5) is measurably NOT that limit | negative control, > 5% | ✅ |
| An overfilled condenser images a clear field at transmitting/source points | counted, 1e-12 | ✅ |
| `latticeMatchedSource` throws on a fractional count rather than rounding | no silent caps | ✅ |
| A grid too small for the pupil throws rather than truncating it | § 6f.3's discipline | ✅ |
| An unmatched lattice converges: 2.5e-2 → 2.0e-3 over N = 9 → 65 | § 6f.2's rim convergence | ✅ |
| **The measured transfer IS the lattice point count**, at every ν | identity, 1e-12 | ✅ |
| …and tracks `incoherentTransfer` — § 2b's closed form, nothing new minted | closed form, 2 places | ✅ |
| The departure from it does NOT fall monotonically with the lattice | Gauss circle problem | ✅ |
| Transfer reaches ν = 2 — `wave/mtf`'s cutoff — with no condenser at all | § 6f.1's own ceiling | ✅ |
| At ν = 2 exactly the engine reads 1/797: the tangency IS a lattice point | counted, 1e-12 | ✅ |
| A closed condenser transfers 0 at ν = 1.5 where fluorescence transfers 0.14 | § 6f's coherent cliff | ✅ |
| **The input-side partition of unity is EXACT here** at any patch count | Σ w ≡ 1 + linearity, 1e-12 | ✅ |
| Light is conserved: the image holds exactly the emitted power | Σh = 1, 1e-12 | ✅ |
| With a varying pupil, refining the patches converges | convergence | ✅ |
| A bead is placed by its own traced chief ray, splat weights to f64 | § 6h's forward map | ✅ |
| The corner's traced pupil gives a lower-peaked kernel than the axis's | § 6h.5's corner coma | ✅ |
| Brightfield's phase contrast is **second order** in φ — 1.9994, and 2.000 without the top point | § 6f.5's null, as an order | ✅ |
| The same structure labelled images at the full incoherent transfer | closed form, 1e4× separation | ✅ |

### 6i.1 — partial coherence becomes a convolution, and the convolution is fluorescence's

Expanding the Abbe sum over object-spectrum pairs leaves each pair (u₁, u₂)
weighted by Σ_s P(u₁+s)·P*(u₂+s). The image is a convolution exactly when that
bracket depends only on u₁ − u₂, and two **geometric** conditions make it do so:

1. **The source reaches past 1 + B**, B being the object spectrum's outer radius
   in pupil-radius units. Every s contributing at all has |s| ≤ 1 + B, so a disc
   of that radius already contains every pair's whole overlap region.
2. **The source lattice steps by the pupil's own frequency step**, 2/pupilSamples.
   Translating s by u₁ − u₂ — a whole number of frequency bins — then maps the
   lattice onto itself, and the bracket becomes a genuine discrete
   autocorrelation of the sampled pupil. By discrete Wiener–Khinchin that
   autocorrelation is the DFT of |F⁻¹{P}|², which is h.

`latticeMatchedSource` constructs the condenser that satisfies condition 2 —
S·pupilSamples points across the diameter — and **throws rather than rounding**,
because a rounded count still produces a perfectly plausible image whose
disagreement with the incoherent limit would read as physics. Under both
conditions the two modules return **the same array to f64 noise**, and the rung
runs at m = 1 as well as m = 0.2: § 6f.4 measured brightfield's normalized
transfer walking 11.2% *away* from the weak-object limit at m = 1, and here that
walk does not shrink, it is identically absent. Nothing is left for m to enter.

The negative control matters as much: at S = 1 — a matched condenser, the way a
brightfield microscope is normally run — the same object images more than 5%
differently, so the identity is not true by construction.

**Why the comparison is made against each operator's own clear field.** Once the
condenser overfills the objective the clear field images *below* 1: source points
outside the pupil deliver light the objective never collects. The share is
**counted** rather than integrated — transmitting lattice points over source
points, 0.4029 here — and both numbers are ones the engine already reports. The
fluorescence operator has no such loss, because its kernel is normalized to unit
sum and a uniform emitter field images as itself at any aperture.

**One implementation choice is load-bearing.** `incoherentPsf` samples the pupil
the way `abbeImage` does — point-sampled on the DFT lattice — and NOT the way
`wave/psf` does, which area-averages the cells the rim cuts (§ 6f's "one
deliberate difference"). Convolving with a `wave/psf` kernel instead would have
measured that rim mismatch, a residual near 1e-3 that looks exactly like a real
disagreement about coherence and is nothing of the kind. The only difference
between the two modules is the sum over source points, which is what makes this a
1e-12 identity instead of an argument.

### 6i.2 — what an unmatched source lattice costs

A condenser that does not satisfy condition 2 is not wrong, it is discretized.
The residual against the incoherent limit runs 2.47e-2 → 1.99e-2 → 6.03e-3 →
1.97e-3 for N = 9, 17, 33, 65 — falling, and by 12× overall. The first doubling
barely moves it, which is § 6f.2's own finding arriving here: the error is a rim
effect and its ratios are not monotone doubling-by-doubling. The rung pins the
total and the endpoint rather than claiming a halving it does not have.

### 6i.3 — the transfer is a lattice point count, and the cutoff needs no condenser

The autocorrelation of a point-sampled clear pupil is a **count**: lattice points
that the pupil and its ν-shifted copy both transmit, over the points the pupil
transmits. The test writes that count out independently and the engine matches it
to 1e-12 at every frequency — so this step's discretization is not a tolerance
nobody can account for, it is an integer ratio.

That identity then *explains* the departure from the closed form instead of
excusing it. Refining the lattice at fixed ν gives errors of 1.4e-4, 7.9e-4,
8.5e-5 for pupilSamples 16, 32, 64 — **up, then down**. That is the Gauss circle
problem: the number of lattice points in a disc oscillates about its area, so a
rung asserting "smaller every time" would be pinning the fluctuation. What is
pinnable is the bound (< 1e-3) plus the exactness of the count at each.

**The cutoff is ν = 2 — `wave/mtf`'s own — and fluorescence is there with no
condenser in the instrument.** § 6f.1 measured brightfield needing a matched
condenser (S = 1) to reach it and a closed diaphragm stopping at ν = 1; the two
limits are put side by side on one frequency, where a coherent source transfers
< 1e-12 at ν = 1.5 and fluorescence transfers 0.142. No new λ/NA-family constant
is minted anywhere in this step: `incoherentTransfer` is § 2b's closed-form
circular MTF and the measurement lands on it.

At ν = 2 exactly the engine reads **1/797** where the closed form reads 0. The
two discs are tangent there, and the tangency point is *on the lattice* because
the pupil radius is a whole number of steps — so one point survives the count.
Pinned as 1/`transmittingSamples`, which is the discretization made visible
rather than absorbed. Past tangency the image is flat to f64.

### 6i.4 — the window goes back on the input, and here it is exact

`imaging/render` windows the scene and says why; `imaging/brightfield` windows
the output and says why it must. `renderFluorescence` windows the **input**, for
`render.ts`'s reason: the imaging is linear in the emitter density, so splitting
the emitters splits the light and every photon meets the kernel nearest to where
it was emitted. The partition of unity then makes the decomposition **exact** —
Σ_p h ⊛ (w_p·E) = h ⊛ E — pinned to 1e-12 at 2, 4 and 8 patches, where § 6g.2
measured the same split *deleting* 89% of the interference in the brightfield
case. So the two microscope renders window opposite sides, and the reason is a
property of the specimen rather than of the optics.

Light is conserved to f64: the kernel sums to 1 and the windows sum to 1, so
neither the optics nor the decomposition may invent or lose a photon. Circular
convolution is what makes that exact rather than edge-limited — light leaving one
side of the frame returns on the other, the wrap step 4's app surfaces rather
than hides. With a genuinely varying pupil the decomposition is no longer exact
and the residual is measured as convergence, § 6g.3's discipline unchanged.

### 6i.5 — a traced objective, and why beads are the first specimen

`tracedFieldPupils` is consumed unchanged from § 6h: a `PatchPupil`'s `sampling`
is simply unused here, because **no fidelity verdict is minted**. § 6f.9 had to
rule instead of blending since a ray histogram has no phase to interfere with, so
brightfield has no geometric branch to fall back to. Incoherent imaging does —
`adaptivePsf`, cross-faded since § 2d — so fluorescence needs no new verdict, and
that asymmetry is the point rather than an omission.

**Beads are the first specimen for an engine reason, not a biological one.** A
point emitter is placed individually through its own traced chief ray, so the
objective's distortion is carried in the placement — and § 6h's unbuilt
distortion-carrying rasterizer, the one a stained-tissue field would need, is not
required. The splat weights are pinned to f64 against the traced position. On the
same objective the corner's traced pupil gives a lower-peaked kernel than the
axis's (the kernel has unit sum, so its peak is a Strehl-like readout), which is
§ 6h.5's 8.8e-3 waves of corner coma showing up in an image — and the drop is
under 1%, as it must be at 47 µm of specimen.

### 6i.6 — the object brightfield structurally cannot see

§ 6f.5's null is why stains exist. This is the other answer to it. A pure phase
grating's brightfield contrast is **second order in φ** — the fitted order is
1.99943 over φ = 0.01…0.1, and 2.000 to three places with the top point dropped,
the residual being the genuine φ⁴ term that `phaseGratingObject` carries exactly
(all Bessel orders, not the weak truncation). So what brightfield shows of a
phase object is not a faint image of it, it is the object's *square*: 2.2e-5 of
contrast at φ = 0.01 rad.

Label the same structure and it images at the full incoherent transfer, linear in
the label's modulation and on § 2b's closed form — more than 10⁴× the unlabelled
phase object's contrast. What fluorescence images is the emitter density, and a
tagged phase object has one.

### Not yet pinned
- **The Stokes shift, and the emission band.** Every rung here is
  monochromatic. The excitation wavelength never enters the imaging path at all
  (the emission filter blocks it), so resolution is set by λ_em — architecture
  rather than physics — but two real effects are unpinned: the axial focus offset
  between λ_ex and λ_em against the depth of focus, and the objective's secondary
  spectrum across a finite emission band. Both are § 2e's stacking on a band and
  neither is built.
- **No fluorophore is named.** Real excitation/emission spectra are measured data
  and transcribing a dye's curve from memory is what the hard rule forbids. The
  band is an input parameter, following § 5s's precedent with the photometric zero
  point: pin the ratios, not an invented absolute.
- **Out-of-focus haze.** A real widefield fluorescence image is dominated by
  light from emitters *outside* the focal plane — which is why deconvolution and
  confocal exist. It needs a defocused pupil per z slice and a z stack of emitter
  planes; this operator images one plane.
- **Photobleaching, saturation, quantum yield and shot noise**, each blocked on
  the same thing: an absolute photon count, § 3a's standing deferral. Emitter flux
  here is relative, exactly as `PointSource.flux` is.
- **Colour.** `renderFluorescence` returns intensity on one grid where
  `renderField` returns XYZ. A two-colour merge is what a real fluorescence figure
  shows, and it wants the emission band first.

## Step 6j — the Stokes shift, and the band the image is formed in

§ 6i's operator is monochromatic and takes no excitation wavelength at all. That
is the **architecture**, not an omission: a fluorophore absorbs at λ_ex and emits
at λ_em > λ_ex, and the emission filter blocks the excitation, so it cannot reach
the image. "Resolution is set by λ_em" is therefore the shape of the API rather
than a measurement, and this step pins the two things that ARE measurable — what
the shift between the bands costs in focus, and what a band of finite width does
to the kernel.

| Rung | Pinned to | Status |
|---|---|---|
| A band's samples are normalized, so a wider filter does not brighten by arithmetic | Σw = 1, 1e-12 | ✅ |
| The band multiplies quadrature **once** — it IS `spectralSamples`, renormalized | § 3a's double-application warning | ✅ |
| A band with no light in the sampled range throws | no silent black image | ✅ |
| **A one-line band reproduces the monochromatic kernel exactly** | identity, 1e-12 | ✅ |
| The components' pixel scales really are ∝ λ — 650/450 to f64 | § 2e's premise, measured | ✅ |
| The stacked kernel keeps unit sum, and reports what resampling lost | § 2e's `truncatedFraction` | ✅ |
| **Hold the scale fixed and band width does nothing, exactly** | isolation, 1e-12 | ✅ |
| The weighted-mean wavelength's scale IS the common grid | identity, 1e-12 | ✅ |
| **Half a depth of focus IS a quarter wave on the TRACED wavefront** | § 1.5's defocus form, 2 places | ✅ |
| DOF scales as n and as 1/NA², separately | closed form, 1e-12 | ✅ |
| Object- and image-side depths differ by the longitudinal magnification M²·n′/n | sine condition, 1e-9 | ✅ |
| **A 20 nm shift costs 0.32 depths of focus at 4×/0.10** | measurement | ✅ |
| **…and 3.77 at 100×/1.40** — more than 10× worse | measurement | ✅ |
| The difference is stable to 4% (and 0.5% at NA 1.40) over the trace's sampling | conditioning, measured | ✅ |
| Swapping the endpoints negates the shift; a zero interval gives exactly 0 | negative control | ✅ |
| A wide band is broader than a narrow one where the objective is chromatic | convergence, both sides resampled | ✅ |
| The kernel's scale follows λ_em to within the exit pupil's own dispersion (1.4e-4) | measurement | ✅ |

### 6j.1 — the band's weights are the source's, and they enter exactly once

`imaging/scene` carries an explicit warning that a scene render must be handed
*pure quadrature* samples with each source's spectrum kept on the source, because
SED-weighted samples apply the spectrum twice and give "a plausible image of the
wrong colour". An emission band IS an SED, so the hazard is live here. The guard
is structural: `emissionSamples` is the engine's own one-source constructor,
`spectralSamples`, with nothing added but a normalization — pinned term by term
against it, so a second application would show up as the band squared.

**No fluorophore is named.** Real excitation/emission curves are measured data,
and transcribing a dye's from memory is what the hard rule forbids. What is
offered is `boxcarBand`, named for what it models — an **interference filter**,
whose transmission really is close to rectangular — and a caller-supplied
`(nm) => number` for anything else, exactly as `PointSource.spectrum` works.

**A one-line band must be the monochromatic kernel exactly**, or every broadband
number is measured against a moving zero. It very nearly was not: `resampleGrid`
drops destinations sourced from the last row and column, so passing an
already-matching grid through it loses 2.6e-4 of the light and — after the
stack's renormalization — moves the peak by the same amount. A component already
on the common grid is therefore left alone, compared within f64 rounding rather
than bit-exactly, since the target is a weighted mean and a component that IS the
mean can miss it by an ulp depending on summation order.

### 6j.2 — one physical grid, because the pixel scale is ∝ λ

Each wavelength forms its own incoherent PSF and `imagePixelScaleMm` is ∝ λ, so
the components live on **different physical grids** — measured, 650/450 to f64,
rather than assumed. Summing them bin for bin would silently rescale each instead
of stacking it: `wave/polychromatic`'s founding failure mode, recurring one layer
up. Its resampler is reused rather than a second one grown.

One bug this caught, and it is worth recording because no energy check would
have: `incoherentPsf` returns DC-at-index-0 (so a convolution is a plain
multiply) while `resampleGrid` scales about the grid's **centre**. Resampling the
unshifted array rescaled a kernel wrapped into the four corners — it moved the
peak by 60% and threw away 74% of the light, and the stack still summed to 1
afterwards, because the sum is renormalized either way.

**The stack is over kernels, not images**, and that is exact rather than an
economy: a single-label specimen emits with one spectrum, so E(x)·w(λ) factors
and Σ_λ w_λ(h_λ ⊛ E) = (Σ_λ w_λ h_λ) ⊛ E — one convolution with the whole band in
the kernel. A two-label specimen does not factor that way, which is § 6i's colour
deferral rather than a limit found here.

**A band is not automatically a blur, and that is a finding.** With an
aberration-free pupil the only thing λ changes is the scale, and a band symmetric
in λ is two-sided about it: the blue components are physically narrower and
genuinely concentrate more energy inside a fixed radius while the red ones
spread. Neither candidate readout is monotone across 0 → 200 nm — the peak pixel
runs 0.19458, 0.19222, 0.19007, 0.19029 and turns back up, and core energy
disagrees with it depending on how the band is sampled — and both compete with
the resampler's own bilinear smoothing, which grows with |k − 1|. So the rung
pinned is the **isolation**: hold the scale fixed and band width does nothing at
all, exactly, so λ enters an aberration-free kernel through the scale and through
nothing else. The direction is left unpinned rather than settled by choosing the
metric that flattered the claim.

### 6j.3 — the depth of focus, derived rather than transcribed

    DOF = n·λ / NA²

§ 1.5 pins the engine's own defocus wavefront, W(ρ) = ½·δ·NA²·ρ². Setting the rim
value to the quarter wave of the Rayleigh criterion gives δ = λ/(2·NA²) each side,
so the full range is λ/NA² in air and n·λ/NA² in a medium. The rung does not stop
at the algebra: it defocuses a **traced** system by half that range and reads
0.25/(2√3) waves of RMS back off the wavefront, the system's own residual
subtracted in quadrature. The formula is held to the tracer, not to a textbook.

`refractiveIndex` is the medium the cone is *in* — the immersion fluid on the
object side, air on the image side of every system in the ladder. Getting it wrong
is a factor of 1.515 at NA 1.40, which is exactly the size of thing that reads as
a finding. The ratio Δz/DOF is **invariant between the two spaces**, and that is
pinned rather than asserted: NA′ = NA/|M| by the sine condition, so
DOF′/DOF = M²·n′/n — the longitudinal magnification — and both the shift and the
tolerance scale by it, so it cancels. That is what makes it legitimate to measure
where `bestFocus` lives (image side) and quote where a microscopist works.

### 6j.4 — what the Stokes shift costs, on the ladder's own two objectives

A 20 nm shift (500 → 520 nm) costs **0.32 depths of focus on the DIN 4×/0.10** and
**3.77 on the 100×/1.40 oil**. Free at low NA; a refocus between channels at high
NA, which is the real instrument's behaviour and the reason multi-channel
fluorescence images need registration in z.

Part of the 12× is NA — DOF ∝ 1/NA² — and part is the objective's own colour
correction. § 6e is explicit that the aplanatic front group is exact at ONE
wavelength and that "the chromatic half" is its named open item, so the second
number is partly the cost of that deferral arriving where it bites. **It is not a
claim about what a real apochromatic 100×/1.40 does.**

**The conditioning is pinned, because the ratio could easily have been noise.**
The absolute best-focus offset moves by ~5e-2 mm with the trace's pupil sampling
on the 4× — 5% of a depth of focus, which would sink the ratio. The *difference*
between two wavelengths holds to 4% over pupilSamples 11 → 31, and to 0.5% at
NA 1.40. `minRmsWavefront` is the criterion throughout because the tolerance it is
compared against is itself a wavefront statement, and § 1.6 pins that the three
focus criteria genuinely disagree (the geometric one gives −0.364 mm where this
gives −0.298 mm on the same system).

### 6j.5 — a traced objective through a real band

Where § 6j.2 could not show broadening, an objective that focuses the colours in
different planes does: a 160 nm band empties the core relative to a 10 nm one on
the traced DIN 4×. **Both sides are resampled and both use the same sample
count**, so the resampler's bilinear smoothing is present on each and cancels —
comparing against an unresampled single line would have measured that smoothing
and called it secondary spectrum.

The kernel's scale follows the emission wavelength to 1.4e-4 of exact
proportionality, and the residual is physics rather than slop: `pixelScaleMm` is
λ·R/(n′·size·Δpupil), and R and the exit-pupil radius come from a trace that is
itself chromatic. So the honest statement is that the scale follows λ_em to within
the exit pupil's own dispersion.

### Not yet pinned
- **Which way an aberration-free band moves the core.** See § 6j.2 — two readouts
  disagree and both are entangled with the resampler's smoothing. Settling it
  wants a resampler-free comparison, e.g. an analytic band-integrated Airy.
- **The excitation path.** The imaging side is complete without it, but the
  *illumination* side is not modelled at all: epi-illumination through the
  objective, the dichroic, and whether the excitation is uniform over the field.
  Köhler uniformity is assumed by having no excitation path to be non-uniform.
- **Photobleaching, saturation and quantum yield**, all blocked on § 3a's
  absolute photon count, exactly as § 6i recorded.
- **Two-colour merge.** The stack factors because one spectrum multiplies the
  whole emitter field; two labels do not factor and want a render per channel,
  which is § 6i's colour deferral and wants `imaging/image`'s XYZ path.

## Step 6k — out-of-focus haze, and the missing cone

§ 6i images one plane. A real widefield fluorescence image is dominated by light
from emitters that are **not** in the focal plane — the largest single difference
between what § 6i forms and what a microscope shows, and the reason deconvolution
and confocal exist at all. This step builds the volume operator and pins what it
costs.

The headline is one fact stated twice. A defocus is a **pure phase**, so it
changes no pupil amplitude, so Σ|P|² does not move, so — by Parseval, through the
engine's own FFT — the kernel's total does not move either. **Every plane of a
thick specimen delivers its whole flux to the image however far out of focus it
is.** Transform that constant along the depth axis and it is the **missing
cone**: exactly zero axial transfer at zero lateral frequency.

| Rung | Pinned to | Status |
|---|---|---|
| **The kernel's total is EXACTLY invariant over 0 → 8 waves of defocus** | pure phase, 1e-12 | ✅ |
| Parseval is the identity that carries it: `formedSum`·size² = `energy` | identity, 1e-12 | ✅ |
| `relativeThroughput` is exactly 1 across a pure-defocus stack | 1e-12 | ✅ |
| **The axis follows sinc²(π·w₂₀)**, and the gap closes as the pupil refines | closed form, 3.5e-2 → 4.8e-3 | ✅ |
| **A quarter wave of defocus is a Strehl of 8/π² = 0.8106** | closed form, 2 places | ✅ |
| **At every integer wave the axis is a hard null** — and the total has not moved | null, 4.8e-4 → 6.3e-6 | ✅ |
| The total is invariant but no FINITE aperture's share is — confocal's opening | monotone fall, 0.90 → 0.08 | ✅ |
| Every plane delivers the same flux, however deep | 1e-12 | ✅ |
| **A slab three times thicker is three times hazier, and refocusing cannot help** | 1/3, 1/9, 1/27 to 1e-12 | ✅ |
| The image's total light does not depend on where the objective is focused | 1e-12 | ✅ |
| The axial transfer at zero lateral frequency is a CONSTANT | 1e-12 | ✅ |
| **Its transform is EXACTLY zero at every axial frequency but DC** | the missing cone, 2.2e-15 | ✅ |
| **A depth-varying pupil AMPLITUDE fills the cone in** | negative control, 1e-15 → >5% | ✅ |
| A non-uniformly spaced stack throws rather than transforming the wrong thing | no plausible wrong spectrum | ✅ |
| **The support boundary is μ_max = ν·(2 − ν)** | derived, measured exactly at ν = 0.5, 1, 1.5 | ✅ |
| **The defocused OTF matches an independent quadrature**, and converges | closed form, <1% at 64 bins | ✅ |
| **A z-uniform specimen collapses to ONE convolution** | identity, 1e-12, on weights that must be right | ✅ |
| **A z-varying one does not** — same total, different image | negative control, energy is not a witness | ✅ |
| The haze kernel is a Riemann sum, so refining the stack does not brighten it | Σ = 1, 1e-12 | ✅ |
| Half of § 6j's depth of focus is a quarter wave, for every NA and medium | identity, 1e-12 | ✅ |
| Object- and image-side waves differ by the sine-condition residual, SQUARED | 1e-9, on a 2.4% residual | ✅ |

### 6k.1 — defocus does not dim, it only spreads

`withDefocus` passes `amplitude` through untouched and adds `waves·ρ²` to the
phase — § 1.5's own W(ρ) = ½·δ·NA²·ρ² read at the rim. Because nothing is
attenuated, Σ|P|² is identical at every depth, and Parseval carries that through
the transform to the formed kernel: `formedSum` holds to 1e-12 over 0 → 8 waves
and `formedSum`·size² = `energy` to the same. **The light from an out-of-focus
plane is neither lost nor dimmed.**

What defocus does instead is redistribute, and the on-axis intensity follows a
closed form the engine reproduces:

    h_w(0) / h_0(0)  =  sinc²(π·w₂₀)  =  [ sin(π·w₂₀) / (π·w₂₀) ]²

3.5e-2 of it at 16 bins across the pupil and 4.8e-3 at 64. The convergence is
**not** pinned as monotone: § 6i.2 showed this transfer is a lattice point
*count*, so its departure wanders with the Gauss circle problem — 96 bins is
worse than 64 — and what is asserted is the fall from 16 to 64, not a rate.

Two things fall out of the closed form and neither is a coincidence. At a quarter
wave it is **8/π² = 0.8106**, which is the Rayleigh quarter-wave criterion and
§ 2b's Maréchal Strehl arriving from the axial side; § 6j's depth of focus is
*defined* as half a wave across the full range, so "half a depth of focus", "a
quarter wave" and "Strehl 0.81" are one statement measured three ways. And at
**every integer wave the axis is exactly zero** — all of the light is in the
rings, none on axis, and the total has not moved by 1e-12. The null sharpens with
the lattice (4.8e-4 at 16 bins, 6.3e-6 at 64), so it is a zero rather than a
floor.

Together those two are what "haze" means: the light is put where it carries no
detail rather than being removed. The rung that keeps the invariance from reading
as vacuous is its own negative control — collect over the whole plane and defocus
changes nothing, collect through **any finite aperture** and it changes
everything (0.90 → 0.08 of the light inside 8 bins over 0 → 2 waves). A detection
pinhole is exactly that aperture, which is why confocal sections and widefield
cannot.

### 6k.2 — the in-focus fraction belongs to the specimen, not the instrument

Since every plane delivers the same flux, a slab sampled every depth of focus
gives an in-focus fraction of exactly 1/N — 1/3, 1/9 and 1/27 to 1e-12 as the
slab thickens. **Refocusing onto another plane changes which slice is counted and
nothing else**, and the image's total light does not move at all (1e-12). Haze is
therefore a property of how much specimen there is, and no setting of the
microscope adjusts it.

### 6k.3 — the missing cone, and why it is not the normalizer's doing

At zero lateral frequency each plane's transfer is its own total, which § 6k.1
just showed is constant; the transform of a constant sequence is zero everywhere
but DC, and the engine reads **2.2e-15** of the DC value. The 3-D widefield OTF
has no support on the axial axis, so the instrument transmits no axial
information whatever about the specimen's total brightness — no inversion
recovers it, and deconvolution is ill-posed for a structural reason rather than a
numerical one.

**This rung was very nearly worthless, in § 6j.2's exact way.** § 6i normalizes
its kernels to sum 1, so a null built on *their* totals would read zero whatever
the pupils did — the same shape as "the stack still summed to 1 afterwards", one
layer up. `IncoherentPsf.formedSum` was added for this step: it is what the
kernel summed to *before* normalization, the stack weighs with it, and the null
therefore has a control. Give `depthKernels` pupils whose **amplitude** varies
with depth and the cone fills in with more than 5% support where pure defocus
held 1e-15. Nothing in the engine varies amplitude with depth yet — that is the
depth-dependent-spherical deferral below — which is precisely why `DepthPupils`
is a callback rather than a pupil.

### 6k.4 — the cone's boundary, derived and then measured

The quadratic wavefront puts 2·w₂₀·(u·ν) waves between two pupil points separated
by ν — **linear in u** — so transforming over w₂₀ maps each axial frequency onto
one line of the two discs' overlap and the 3-D OTF is that overlap's own chord
profile:

    OTF₃(ν, μ) = g( μ/(2ν) ) / (2ν),   g(t) = 2·√(1 − (|t| + ν/2)²)

supported on **|μ| ≤ ν·(2 − ν)** cycles per wave of w₂₀, which in physical units
is ν_z ≤ NA·ν_r − λ·ν_r²/2. Measured on a 64-slice stack over ±8 waves, the 2%
support edge lands on 0.7500, 1.0000 and 0.7500 at ν = 0.5, 1.0 and 1.5 —
**exactly** the law, against an axial bin of 0.0625. The support closes at ν = 0
(the missing cone) and again at the ν = 2 lateral cutoff, so a widefield
microscope sections best at mid frequencies and not at all at low ones.

The 1/(2ν) in front is why deconvolution amplifies noise near the cone rather
than merely failing inside it: the transfer does not fall to zero at the boundary
and stop, it concentrates into an ever-narrower band of axial frequencies.

**The defocus axis has a lattice period, and this rung's window is therefore not
neutral.** The pupil is point-sampled, so the phase a defocus w₂₀ puts between two
points separated by ν takes only the values 4·w₂₀·ν·k/`pupilSamples`, and the
axial transfer at ν is **exactly periodic in w₂₀** with

    P(ν) = pupilSamples / (4·ν)   waves

pinned to 1e-12 at six (`pupilSamples`, ν) pairs. It is the axial twin of § 6i.2's
"the transfer is a point count" — a property of the lattice rather than of the
optics. The consequence is measured rather than described: the ±8-wave stack above
is **two** periods at ν = 1, so its spectrum is a **comb** whose odd bins are
empty to 1e-12, and a window inside one period fills bin 1 back to over half the
peak at the same step and the same Nyquist. The edge measurement survives the comb
because it reads the envelope through a 2% threshold, and that is precisely what
the threshold buys. Anything that *draws* the spectrum must take its window from
P(ν) instead — `packages/app`'s A5 surface found this by plotting the curve, and
the rung exists so the property cannot drift silently underneath it.

### 6k.5 — the defocused OTF against an independent quadrature

The same g, integrated in one dimension by trapezoid, sharing no code with the
engine's 2-D FFT: agreement is better than 1% at 64 bins across the pupil over
ν ∈ {0.25, 0.5} and w₂₀ ∈ {0.25, 0.5, 1}, and the gap closes from 16 bins to 64.
That is what makes § 6k.4's boundary a derivation the engine confirms rather than
a curve fitted to the engine's output.

### 6k.6 — over z it does not factor, and the one case where it does

§ 6j stacks over **kernels rather than images** and calls it exact rather than an
economy: a single-label specimen emits with one spectrum, so E(x)·w(λ) factors
and Σ_λ w_λ(h_λ ⊛ E) = (Σ_λ w_λ h_λ) ⊛ E — one convolution with the whole band
inside the kernel. **The same machinery pointed at z does not factor**, because
every plane has its own emitter field and there is no common E to pull out. A
volume costs one convolution per slice, and that is the price of the third
dimension rather than an implementation awaiting optimization.

The exception is exact and is worth having, because it is what "haze" means: a
specimen **uniform in z** puts the same E on every plane, factors again, and
collapses to a single convolution with Σ_z T(z)·h_z. That is `hazeKernel`, and a
slice-by-slice render of a z-uniform volume equals it to 1e-12.

**That rung is run on depth-*tapered* pupils, not on plain defocus, and the
reason is that plain defocus would have made it vacuous.** Under pure defocus
every slice has the same throughput, so two operators that each normalize by
their own total agree by linearity of convolution alone — the rung would pass
even for a `renderVolume` that weighted its slices with a constant. Fading the
pupil amplitude with depth makes `relativeThroughput` run 0.44 → 1 across the
stack, so the two sides agree only if both apply the same per-slice weight.
Checked by breaking it: with the weighting removed, the worst pixel moves from
1e-16 to 2.0e-2.

The negative control is the one that matters. Sum a z-*varying* volume's emitters
and convolve once with the same haze kernel and the result accounts for **every
photon the specimen emitted** — each operator conserving in its own
normalization, both to 1e-12 — and forms a different image. **Energy is not a
witness** (§ 6g.2's phrase, recurring): the check this repo reaches for first
passes for the operator that is wrong.

### 6k.7 — depth in waves, and the conjugate it is measured in

`defocusWaves` is δ·NA²/(2·n·λ), and half of § 6j's depth of focus lands on
exactly ¼ for every NA, medium and wavelength (1e-12) — which is what ties this
step's axial readouts to that step's tolerance.

The number is **conjugate-invariant**: δ′ = δ·M²·n′/n by the longitudinal
magnification § 6j pins and NA′ = NA/|M| by the sine condition, so the M² cancels
against the NA² and the n against the n′. A caller may therefore author a
specimen in object-space millimetres with the objective's object-side NA — which
is how a specimen is actually described — while the engine defocuses the
image-side pupil, with no conversion between them to get backwards. It is exact
only as far as the objective is aplanatic, and what is left over is measured
rather than waved away: the DIN 4×'s sine-condition residual is **2.4%**, and the
two sides differ by 1/(1+r)² — a 4.7% gap, pinned to 1e-9 against the residual
the engine reads independently. § 6h's "a doublet cannot be aplanatic" arriving
in a third place.

### Not yet pinned
- **Depth-dependent spherical aberration.** Focusing *into* a specimen whose
  index does not match the immersion adds spherical aberration that grows with
  depth — the dominant real-world defect of deep widefield and confocal imaging,
  and the reason correction collars exist. § 6c solves the plate to all orders
  and § 6e the N-layer stack, so the physics is already in the engine; wiring the
  focal depth into that stack is its own step. `DepthPupils` is a callback so
  that it can be supplied, and § 6k.3's control is its first user.
- **Deconvolution and confocal**, both named by the missing cone rather than
  built. Confocal is not a post-process: it needs a detection pinhole and an
  excitation PSF, which is the excitation path § 6j left open.
- **An axial sampling verdict.** A stack whose slices step by more than the
  kernel can resolve is undersampled in z exactly as a grid can be in x, but the
  criterion is § 6f.9's shape of problem and wants its own rung. What is reported
  meanwhile is § 6i's per-slice `maxGridPhaseStepWaves`.
- **The exact Ewald cap, and how far the quadratic wavefront is from it.** The
  boundary above is derived from W = ½·δ·NA²·ρ², a *paraboloid*. The exact cap of
  the Ewald sphere gives a cone slope of tan α where the quadratic form gives
  sin α — they agree paraxially and diverge by 1/cos α, which is 2.6× at
  NA 1.40 in oil. The engine forms images in image space, where NA′ is 0.024 even
  for a 100×/1.40 and the quadratic form is excellent, so the departure lives
  entirely in the object-side z mapping. Measuring it wants a wavefront traced
  through a defocused *object* plane rather than a shifted image plane.
- **Signal-to-haze against specimen thickness**, and the bead-in-a-slab scene
  that would show it. It is a consequence of § 6k.1 and § 6k.2 rather than an
  independent pin, and it wants scenes the branch has not built.

## Step 6m — the off-axis frame

§ 6h.2 pinned that a frame's extent is set by `pupilSamples` and not by the grid,
which turns it into a **cost**: covering a 4×'s real 5 mm field at its own 2.75 µm
resolution wants pupilSamples ≈ 1800 and a grid to match, and the Abbe sum's grid
IS its frequency lattice, so nothing can be resampled down. A microscope's field
is therefore reached by **tiling and never by widening**. `objectFieldTile` is
the tile: the same construction about an arbitrary field position, which in code
is `imagePointAt` gaining an offset and every consumer below it reading an
absolute image point without knowing a tile exists.

It is also the first thing in this branch that reaches **millimetres of
specimen**, and that is where the step earns its rungs rather than in the offset.

| Rung | Pinned to | Status |
|---|---|---|
| A tile at the origin reproduces `objectFieldFrame` field for field, bitwise | identity | ✅ |
| …and the image it renders is bit-identical, not merely close | identity | ✅ |
| Half-extent is pupilSamples·λ·R/(4·n′·r_exit) in the tile's OWN R, to f64 | § 6h.2's closed form, moved | ✅ |
| A tile's centre pupil is the parent frame's pupil there — height, azimuth, amplitude and phase, bitwise | identity | ✅ |
| An emitter at a tile's own `centreObjectMm` lands on its centre pixel, through the traced chief ray | § 6i's rasterizer, moved | ✅ |
| NEGATIVE CONTROL: the axial frame clips that same emitter out entirely | 47 µm against 200 µm | ✅ |
| West and south tiles work: same height bitwise, wavefront turned π and −π/2 | all four quadrants | ✅ |
| A non-finite centre is refused rather than rounded | — | ✅ |
| An infinite conjugate is refused, as `objectFieldFrame` refuses it | § 6h.1, inherited | ✅ |
| Two tiles naming one image point return one object point, **in the last bit** | registration | ✅ |
| …and it does not depend on the bracket: 6 seeds over 10⁷ agree bitwise | mantissa exhaustion | ✅ |
| NEGATIVE CONTROL: a seed 4 000× too small breaks it, by 1.3e-15 | the mechanism, not luck | ✅ |
| The general seam costs the ulp of the image point that named it, and no more | derived bound | ✅ |
| The azimuth is the SYSTEM's: a north tile is the east tile turned 90°, to 1e-15 | § 6h.3's convention | ✅ |
| The reference sphere is hypot(R_axis, r), to 2.4e-15 at 0.2 mm | plane geometry | ✅ |
| …and its departure is QUARTIC in r — ×16.0 per doubling over four | the chief ray's cubic × the lever | ✅ |
| The exit pupil does not move at all, at 6.4 mm as at 47 µm | § 6h.5's limit of the instrument | ✅ |
| The tile's own ruler drifts h_e(r+h_e)/R², the axial one is r²/2R² wrong | closed form, to 1e-3 | ✅ |
| …so they cross at r = (1+√3)·h_e and the gain past it is r²/2h_e(r+h_e) | closed form | ✅ |
| Defocus across tile centres grows as h² — ×4.000 per doubling, to 0.1% | third-order field curvature | ✅ |
| Coma h¹ and astigmatism h² held over 8× of field, at tile centres | third-order field dependence | ✅ |
| **An off-axis tile is ANISOTROPIC: radial and tangential departures in the ratio 3** | d/dh of § 6h.1's cubic | ✅ |
| …and exactly square on axis, to f64 | negative control | ✅ |
| The pitch is not the span; it is a fixed point, converging in 3 iterations | — | ✅ |
| …and a uniform pitch is 1.9e-5 of a tile out — 1.2e-3 of a pixel at 1.6 mm | bound | ✅ |
| Off-axis tiles rule `valid` and survive `requireHonest`, with `lost` = 0 | § 6f.9, off axis | ✅ |

**The tile at the origin is the frame, and the rung is bitwise on purpose.** A
tile centred on the axis traces field 0, which is the frame's own trace, so
nothing may differ — not to a tolerance, in the last bit, and not only in the
sixteen numbers of the frame but in the 64² pixels of the image it renders
(worst difference 0). That is the gate: had the offset arithmetic or a defaulted
`traceSamples` drifted, a near-identity would have hidden it and every rung below
would be standing on a second construction that merely resembles the first.

**Registration is bitwise, and the reason is not the one that was expected.** The
mosaic needs two tiles overlapping an image point to agree about which specimen
point is there. They do, exactly — and the design guess was that this held only
because every tile seeds `objectHeightForImageRadius`'s bracket with the same
on-axis magnification. It is not: the bisection runs 60 halvings and stops when
the interval closes on adjacent f64s, so **the seed chooses the path and not the
answer.** Six seeds spanning 10⁷ return the same object height in the last bit,
and so does no seed at all. The control is what makes that a mechanism rather
than a coincidence: a seed 4 000× too small opens a bracket 60 halvings cannot
exhaust, and it costs 1.3e-15 — the mantissa, and nothing physical. The
consequence is a freedom, not a constraint: `magnification` may stay the on-axis
reading in every tile, which it must, because it is a linear *reference* and one
that moved per tile would make `objectPixelScaleMm` mean something different in
each tile of a mosaic.

The general seam is separated from that rung deliberately. When two abutting
tiles reach their shared edge through *different* normalized coordinates, the f64
route to the point no longer coincides and the object points differ — by the ulp
of the image point that named them, which is the bound the rung is written
against and is derived rather than picked. The map is exact; naming a point twice
is not free.

**The ruler's whole field story is a hypotenuse.** The reference sphere is centred
on the image point and passes through the chief ray at the exit-pupil plane; that
plane does not move, because `pupils()` is a paraxial construction with no field
argument, and the image point moves laterally by r. So R = hypot(R_axis, r) and
nothing else — 2.4e-15 at 0.2 mm. What is left over is attributed rather than
tolerated: it grows as **r⁴**, ×16.0 per doubling over four of them, which is the
chief ray's own cubic miss of the pupil centre multiplied by the lever arm r.

That geometry is what decides § 6m's one departure from § 6h's rules. § 6h reads
one `PupilScale` on axis for the whole frame because the patches are blended
pixel for pixel; a mosaic does not blend across tiles, it abuts them, so each
tile reads the scale at **its own** centre. Differentiating the hypotenuse gives
both sides of that trade in closed form, with no fitted constant:

    own ruler, across the tile    h_e(r + h_e)/R²      linear in the field
    axial ruler, AT the tile      r²/2R²               quadratic

and § 6h.5's on-axis 9.7e-7 is the first formula at r = 0 (h_e²/R², exactly). So
the crossover is **r = (1+√3)·h_e**, and the finding is that a tile is *not*
automatically better off on its own ruler: at 0.4 mm the gain is 0.73 — worse —
and it only becomes 8.1× at 3.2 mm and 16.6× at 6.4 mm. Every tile in a real
mosaic is past 2.73 half-extents; the tile that is not, is the frame.

**Field curvature arrives, and it is the sharpest field-order rung in the
branch.** Third-order theory puts the focal surface a quadratic distance from the
flat image plane, so a mosaic laid on that plane must show defocus growing as h².
§ 6h could not see it: inside one 47 µm frame the term is ~1e-6 waves, under the
Zernike fit's own noise, which is why § 6h.4 pinned coma and astigmatism and
stopped. At tile centres it is 5.3e-2 waves by 0.8 mm and it is **×4.000 per
doubling, to 0.1%** — sharper than the distortion rung's 1% and the coma rung's
fitted slope, because the term is large and clean rather than because the
measurement improved.

**The finding: an off-axis tile is anisotropic, and the ratio is 3 with no free
coefficient.** A tile off axis is not a scaled copy of an axial one — it is a
rectangle. Differentiating § 6h.1's own r = M·h + C·h³, the two local
magnifications are

    tangential   r/h     = M +   C·h²     (the chief ray's lever)
    radial       dr/dh   = M + 3·C·h²     (its slope)

so their departures from the linear reference stand in the ratio **3**, exactly,
whatever C is — which is what makes it a pin rather than a measurement. Measured
on a tile's own edges rather than on the closed form: 2.97 at 0.4 mm and 2.998 at
1.6 mm, approaching 3 from below as the h³ term climbs clear of the inverse's own
1e-9 closure, with the axial tile exactly square to f64 as the control. It is
small on this objective — a tile 0.8 mm off axis is 33 ppm out of square, 1.5 nm
of specimen — and the size is not the point: **no single per-tile scale can carry
it**, which is § 6n's warped-grid rasterizer arriving with a number attached
instead of an argument.

**A mosaic's pitch is not its tile span**, and that follows from the ruler moving:
a tile's extent is read on its own scale, so it depends on where the tile is, and
abutment is a fixed point rather than an offset known in advance. It converges
immediately — three iterations to f64, the first move already 6e-4 of a pixel —
and the practical answer is that a mosaic may skip the solve entirely: laying
tiles on the axial pitch mismatches the true span by 1.9e-5 of a tile, 1.2e-3 of
a pixel at 1.6 mm off axis.

**The first consumer that assumed the axis has moved with it.** § 6i's
`rasterizeEmitters` measured from the grid centre and called it the axis, which
was the same point until this step; it now reads `frame.centreMm`, and a bead at
a tile's own `centreObjectMm` lands on that tile's centre pixel through the
traced chief ray, while the axial frame clips the same bead out entirely. The
convention that comes with it is worth stating because it is invisible when
wrong: the object point's azimuth is the **image** point's, the reduced
coordinates `illumination/abbe` already runs in, so a caller placing a tile over
a known specimen point multiplies by |M| and not by `magnification`. The signed
one gives a mirrored mosaic with every rung here still green.

**And it works in all four quadrants**, which is measured rather than reasoned:
every other rung in this step builds its tiles at (r, 0) or (0, r), and a stage
pans in four directions, so the first drag would land where nothing had been.

**What the picture does.** Off-axis tiles render, rule `valid` and survive
`requireHonest` — they are traced, so § 6f.9's verdict has the sampling it needs
— and they get softer with field because the *objective* does: the DIN 4× carries
0.140 waves rms on axis, 0.325 at 0.8 mm and 0.632 at 1.6 mm, and a grating's
contrast follows it down from 0.687 to 0.343. Nothing vignettes anywhere in that
range (`lost` = 0 out to 6.4 mm of image radius, 1.6 mm of specimen). That is a
single cemented doublet's own field showing up as a picture, which is what a
mosaic is for.

### Not yet pinned
- ~~**The grid is still not warped.**~~ **Closed at [§ 6n](#step-6n--the-warped-grid-rasterizer).**
  § 6m sharpened § 6h's deferral rather than closing it — the anisotropy rung
  measures the thing a per-tile uniform scale cannot carry — and
  `rasterizeSpecimen` has since attached to the `objectPointAt` seam. § 6n also
  turns the anisotropy into a picture: the bow it predicts is ×2.00 per doubling
  of field, and the uniform scale's own miss is a whole order worse.
- **No tiles have been composed.** Registration, the ruler's step and the pitch
  are pinned; a mosaic that crops each tile to a useful span and lays it beside
  its neighbour is § 6o, and its guard band is measured in APP.md's Part D as a
  feasibility figure and not as a pin.
- **Telecentricity, still.** Every tile is handed the same `CondenserSource`
  centred on the pupil, and a real condenser's cone tilts off axis. § 6a's
  object-space ray-aiming blocker, inherited unchanged, and it bites harder here
  because a tile at 1.6 mm is exactly where the cone would have tilted.
- **The field curvature is measured and not corrected.** A real microscope
  refocuses, or uses a plan objective; this engine reports the defocus a flat
  plane costs and offers no per-tile focus. That is a design question for the
  stage, not a missing physics.
- **One objective.** Every number above is the DIN 4×/0.10's. The orders are
  third-order theory's and travel; the coefficients do not, and no rung claims
  they do.

## Step 6n — the warped-grid rasterizer

§ 6h carried distortion in the **pupil assignment** — each patch is handed the
pupil of the object point its own image position really comes from — and left
the grid itself unwarped, naming `objectPointAt` as the seam a rasterizer would
attach to. This is that rasterizer. A `Specimen` is a callback in object
millimetres, and `rasterizeSpecimen` evaluates it at the object point each pixel
actually looks at, producing the `ObjectField` `abbeImage` already consumes.

The callback is the whole reason it is exact, and the argument is `rotatePupil`'s
one layer further out: the warp happens **in the argument**, so the value that
comes back is the specimen's own value there — no resampling, no interpolation
kernel, nothing to renormalize. Handed a sampled array instead, the same map
would carry `rotateKernel`'s bilinear error on top of the optics it exists to
represent. The direction is backwards on purpose — image pixel → object point,
never the reverse — because a forward splat leaves holes where the map expands
and doubles up where it contracts, and § 6m.4 measured that an off-axis tile does
both at once.

**On one on-axis frame none of this is visible**, which is why § 6h could defer
it: over a 46.77 µm half-extent the cubic is parts per billion. § 6m is what
forces it — a tile sits at millimetres, two tiles abut, and a straight specimen
crossing the seam arrives on each side through a different *linear* approximation
to a map that is not linear.

| Rung | Pinned to | Status |
|---|---|---|
| A specimen point and a point emitter at it land in the SAME pixel, weight 1.000 | § 6i's `rasterizeEmitters`, bitwise | ✅ |
| …on axis and in a tile, at three pixels each | the convention, not one lucky index | ✅ |
| A pixel index round-trips through the forward map to 1e-12 | `imagePointAt`'s own convention | ✅ |
| The uniform map IS `imagePointAt / |M|` on the axial frame, to f64 | the control, named | ✅ |
| Both maps are exact at the frame centre, and differ everywhere else | the control is not a strawman | ✅ |
| **A straight object line BOWS, ×2.00 per doubling of field** | d²/dr² of § 6h.1's cubic | ✅ |
| …and as the SQUARE of the tile's extent — ×2.00 in pixels, since § 6h.2 ties the pixel scale to it | sagitta = curvature·L²/2 | ✅ |
| The sign is BARREL: r − |M|·h < 0, so a chord's ends are pulled in and the sagitta is positive | § 6h.1's departure, signed | ✅ |
| NEGATIVE CONTROL: the uniform map's sagitta is **identically zero**, at every field | a linear map has no curvature | ✅ |
| The bow is the map's own second difference, equal and opposite, to 0.3% | two readings of one number | ✅ |
| A bump recovers its own pixel through a rasterized picture, < 1e-5 px | round trip through the image | ✅ |
| …and misses by the CURVATURE: ×2.00 per doubling, converging from below | § 6n.2's law again | ✅ |
| CONTROL: the uniform map misses by the SLOPE — ×4.00 per doubling | § 6m.4's quadratic | ✅ |
| …so the gap between them DOUBLES per doubling: 16.8× at 0.4 mm, 257× at 6.4 mm | quadratic over linear | ✅ |
| CONTROL: and it is exact at the tile centre, 1e-12 — where a linear map cannot be wrong | why the rung samples pixel (20, 12) | ✅ |
| A pure phase specimen stays |t| = 1 in every pixel | amplitude is a point property | ✅ |
| Total |t|² is NOT conserved, grows as the field's square, and is 1e-5 | det J ≠ 1, and energy is no witness | ✅ |
| The result is the `ObjectField` `abbeImage` consumes, unchanged | § 6n is the authoring path only | ✅ |

**The bow is the cubic's second derivative, and that corrects what Part D
predicted.** APP.md's D2 scoped this rung as "a straight line bows by the amount
§ 6h.1 already pins (cubic, ×8.00 per doubling)". It does not, and a rung
asserting ×8.00 would have been quoting the right theory at the wrong
derivative. The sagitta of a chord is the map's **curvature** across that chord,
and d²/dr² of a cubic is linear — so the bow grows ×2.00 per doubling of field,
measured at 2.0003, 2.0002, 2.0004, 2.0014 over 0.4 → 6.4 mm. Nothing is fitted:
the same coefficient § 6h.1 measured produces all three numbers, and the step
completes a ladder rather than adding to it —

- § 6h.1 pinned the **cubic itself**, ×8.00 per doubling;
- § 6m.4 pinned its **slope**, radial and tangential in the ratio 3;
- § 6n pins its **curvature**, ×2.00, which is what a rasterizer consumes.

Read the other way it is the same coefficient again: doubling the tile's extent
at fixed field quadruples the sagitta in millimetres and doubles it in **pixels**,
because § 6h.2 ties the extent to `pupilSamples` and the pixel scale rides along.
The two ×2.00 rungs are one statement seen on its two axes.

**The negative control cannot express the law, rather than approximating it
badly.** The uniform map — `centreObjectMm` plus a pixel offset times
`objectPixelScaleMm`, which is what a specimen authored by uniform scaling really
is — is linear, so its sagitta is `toBe(0)` at every field however far off axis
the tile is placed. That is the strongest form a control takes in this file, and
it is worth naming what it is *not*: the uniform map is right where the frame is
aimed. It has the tile's own traced centre as its fixed point, so at the centre
pixel it reads 1e-12 and a control placed there would have reported that the two
maps agree. What it cannot do is stay right.

**The pixel convention is pinned bitwise against the rasterizer that already had
one.** The bug this step exists to remove is a seam misregistration, and half a
pixel is one — so the convention is not re-derived here, it is checked against
§ 6i's `rasterizeEmitters`: a point emitter placed at `specimenPointAt(ix, iy)`
lands on pixel (ix, iy) with its **whole** flux, 1.000 to 12 places, on axis and
in a tile. Bilinear splatting puts all of it in one pixel only when the point
lands exactly on it, so a half-pixel error would have read 0.5 rather than
shifting a picture no one was looking at.

**The round trip goes through a picture, and its residual is physics.** The
obvious round trip — forward map then inverse — pins nothing here, because
`objectHeightForImageRadius` already self-checks its residual to 1e-9 (§ 6h.1) and
would pass whatever the pixel indexing did. So the rung places a smooth bump at
the object point a pixel looks at, rasterizes it, and reads the centroid back:
it returns that pixel to better than 1e-5 px. Not exactly, and the miss is not
slop — the grid samples object space non-uniformly, so a bump symmetric on the
specimen is slightly asymmetric on the grid, and the miss obeys § 6n.2's own law,
×2.00 per doubling.

That is what makes the control quantitative rather than a factor: the uniform
map's miss carries the map's *first* derivative and grows ×4.00, so **the gap
between them doubles with the field** — 16.8× at 0.4 mm to 257× at 6.4 mm. The
seam misregistration § 6n removes is unbounded in the field, not a constant
somebody could have absorbed into a tolerance.

**Both sequences converge from below, and that is pinned as convergence.** The
tile's own half-extent (46.77 µm) is not negligible against the smallest field
sampled (0.4 mm), so the chord samples the map over a finite span and the leading
term is diluted by a correction of order L/r: the ratios climb 1.888 → 1.943 →
1.971 → 1.987 toward 2, and 3.694 → 3.842 → 3.920 → 3.961 toward 4. The rungs
assert monotone approach to the limit and a final value within 1–1.5% of it,
because a wandering ratio satisfies "each is within 5% of the limit" too — § 6g.3's
argument about a sequence, reused where it applies again.

**Energy is not a witness here either, and this time because it should differ.**
§ 6g.2 and § 6k.4 both record that an energy check passes for schemes that are
wrong. Here the sum has the opposite problem: an `ObjectField` is an amplitude
**transmittance**, which is a property of a *point*, so the warp is pure
coordinate substitution with no Jacobian — and total |t|² therefore *ought* to
change, because a region the map magnifies really does present more specimen to
more of the image. It does, by 1e-5 growing as the field's square, which is
det J − 1 and is § 6m.4's anisotropy in another currency. Far too small to have
caught a broken map; the witness is § 6n.3's pixel and never this sum.

The rung that nearly said nothing is worth recording, in § 6k.3's way: the first
version authored the wedge about the **axis**, where a tile 1.6 mm off it sees
only the saturated tail — and the two totals then agreed in the last bit, which
reads exactly like conservation and is nothing of the kind.

**The cost is measured, and the cache is deliberately elsewhere.** One bisected
chief ray per pixel: 0.12 ms of it, so 0.5 s at 64² and ~2 s at 128². That is the
same order as the sum it feeds — a `patches` = 2, five-point-source
`renderBrightfield` on the same frame is 0.33 s — so the warp is not free
relative to the imaging, merely affordable, and a mosaic of tens of tiles is
where that stops being true. The radial cache that fixes it is § 6p and is
**kept out of here on purpose**: these rungs pin the *map*, and an interpolant
underneath them would mean they pinned the interpolant instead. § 6p's own idiom
already covers it — cached ≡ uncached, bit for bit.

### Not yet pinned
- **The extended fluorescent specimen — the Jacobian.** An emitter **density** is
  not a point property: warping one without multiplying by det J moves flux
  between pixels. § 6i's beads sidestep it by placing each point through its own
  chief ray, which is why they were the branch's first specimen. Named here
  rather than dropped, and it is the one place in this branch where energy
  genuinely *is* the witness.
- **No tiles are composed yet.** § 6n removes the misregistration a seam would
  have shown; it does not lay one tile beside another. That is § 6o, with its
  guard band, and the bow measured here is what a mosaic would have displayed.
- **No stained-tissue or diatom scene is authored.** The rasterizer is what those
  were blocked on and they are now unblocked, but a scene is content on top of
  this, not a rung of it — and no rung here claims a specimen that resembles
  anything biological.
- **The grid is warped; the pupil sampling is not re-derived.** Each pixel still
  reads the patch pupil § 6h assigns, so the two halves now agree; whether a
  warped grid changes the *lattice* argument `illumination/fidelity` rules on is
  not asked, because `abbeImage`'s frequency lattice is the image grid's and that
  is unchanged.
- **Telecentricity, still**, and **one objective** — both inherited from § 6m
  unchanged, and every number above is the DIN 4×/0.10's. The orders are
  third-order theory's and travel; the coefficients do not.

## Later rungs

- Published achromat/apochromat prescriptions reproduce catalogued EFL/BFD.
- Seeing's geometric-branch analog: rays deflected by ∇φ, so a seeing blur
  survives the fidelity fallback (the § 5d deferral).
- Brightfield's geometric-branch analog, which is the same ∇φ one surface
  further in: rays refracted by the *specimen's* phase gradient, so a defocused
  phase object shows contrast on the ray branch too. That is
  transport-of-intensity, not partial coherence — the coherence itself has no
  ray analog and never will — and it needs rays that start at a transmittance
  rather than at a field point, which `exitBundle` does not do. § 6f.9 pins the
  verdict that refuses in the meantime.
- Photometry: star magnitude → photon flux through aperture vs published
  zero points.
- **§ 6o–§ 6r — the rest of the microscope's field of view, and looking through
  it.** Named in APP.md's Part D rather than here, because they arrived as the
  scoping of an app surface and their step numbers are not yet claimed —
  [§ 6m](#step-6m--the-off-axis-frame) and
  [§ 6n](#step-6n--the-warped-grid-rasterizer) have since claimed theirs and left
  this list. What remains:
  the mosaic guard band (§ 6o), the commensurate condenser and cached pupil
  (§ 6p, exact against the uncached sum bit for bit), the eyepiece on a *finite*
  intermediate image (§ 6q — `afocalTelescope` solves from a collimated input and
  cannot serve it), and polychromatic brightfield (§ 6r). Part D carries the
  feasibility measurements each would pin, labelled as feasibility figures and
  **not** as pins, which is the distinction this file exists to keep.

## Rules

- New engine capability ⇒ new rung(s) in the same PR.
- Never loosen a tolerance to make a test pass — investigate; tolerances
  document the physics, not the implementation's mood.
