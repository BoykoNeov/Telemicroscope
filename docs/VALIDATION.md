# Validation ladder

The engine is only trusted where it is pinned to known physics. Every rung is
a vitest test in `packages/core/test/`. A rung is "done" only when the test
asserts a number from outside the engine (textbook, published design, closed
form) — engine-vs-itself tests are consistency checks, not validation.

## Step 1 — geometry, materials, ray tracing (current)

| Rung | Pinned to | Status |
|---|---|---|
| Vector Snell matches scalar Snell angles | closed form | ✅ |
| Fresnel: normal incidence R=((n1−n2)/(n1+n2))², R+T=1 | closed form | ✅ |
| Conic intersection: sphere case matches |x²+y²+(z−R)²=R²| | closed form | ✅ |
| Glass catalog: N-BK7 nd≈1.5168, Vd≈64.2 | Schott datasheet | ✅ |
| Glass catalog: F2 nd≈1.620, Vd≈36.4 | Schott datasheet | ✅ |
| Glass catalog: fused silica nd≈1.4585 | Malitson 1965 | ✅ |
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

## Step 1.5 — system spec + pupils (current)

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

## Step 1.6 — focus solve + spot diagrams (current)

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

## Step 2a — FFT + Zernike basis (current)

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

## Step 2b — PSF + MTF (current)

The system under test is a paraboloid at its focus — geometrically perfect, so
everything the PSF shows beyond a point is diffraction and nothing else. Run at
NA 0.1, deliberately: the pupil→image scale identifies NA with r/R, which is a
paraxial identification.

| Rung | Pinned to | Status |
|---|---|---|
| **Encircled energy 83.8% inside the 1st dark ring (1.220 λ/2NA)** | Airy pattern | ✅ |
| **Encircled energy 91.0% inside the 2nd dark ring (2.233 λ/2NA)** | Airy pattern | ✅ |
| **Encircled energy 93.8% inside the 3rd dark ring (3.238 λ/2NA)** | Airy pattern | ✅ |
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
three rings rather than one position. Measured 0.8378 / 0.9099 / 0.9376 against
the textbook 0.838 / 0.910 / 0.938, identically at every pad factor.

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

## Step 2c — the fidelity criterion (current)

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

## Step 2d — geometric branch + blend band (current)

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

## Step 2e — polychromatic stacking (current)

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
- **Vignetting is not carved out of the pupil support.** `OpdMap.lost` reports
  it; the pupil is still modelled as the full disc minus an optional central
  obstruction. Partial vignetting and spider diffraction arrive as a different
  `PupilFunction` at step 5.

  That work must revisit `blendPsf`. The two branches currently disagree about
  the aperture and it does not matter: the geometric branch drops vignetted
  rays while the FFT branch models the full disc, and their energies are then
  forced equal by construction. For an unvignetted system that is exact. The
  moment partial vignetting is real the forced equality would paper over a
  genuine disagreement about how much light gets through — so the matched-
  normalization rungs need re-deriving there, not just re-running.
- **Immersion.** `pixelScaleMm` carries an image-space index factor that is
  identity for every system validated here; the microscope branch's Abbe rung
  is what will pin it.

## Step 3a — the standard observer and thermal sources (current)

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

## Step 3b — the hero image: colour out of chromatic aberration (current)

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

## Later rungs

- Fold mirrors: a 45° flat deviates the beam by exactly 90°, and the folded
  path length equals the unfolded one. (Blocked on the mirror-frame
  convention — see ARCHITECTURE § Tilt / decenter semantics.)

- Published achromat/apochromat prescriptions reproduce catalogued EFL/BFD.
- Newtonian coma ∝ θ/(f/#)² formula.
- Seeing: long-exposure FWHM ≈ 0.98 λ/r0 for Kolmogorov screens.
- Photometry: star magnitude → photon flux through aperture vs published
  zero points.

## Rules

- New engine capability ⇒ new rung(s) in the same PR.
- Never loosen a tolerance to make a test pass — investigate; tolerances
  document the physics, not the implementation's mood.
