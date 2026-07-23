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
- **Trace-level vignetting is not carved out of the pupil support.**
  `OpdMap.lost` reports it; the pupil is still modelled as the full disc minus
  an optional central obstruction and any spider vanes. The **spider landed at
  § 5c** — as promised, a different `PupilFunction`, applied identically to both
  branches, so it does *not* trip the hazard below. What remains is *partial
  vignetting*: rays clipped at a surface (the off-axis Newtonian past its
  diagonal), where the aperture the two branches see genuinely differs.

  That work must revisit `blendPsf`. The two branches currently disagree about
  the aperture and it does not matter: the geometric branch drops vignetted
  rays while the FFT branch models the full disc, and their energies are then
  forced equal by construction. For an unvignetted system that is exact — and a
  spider keeps it exact, because the same mask reaches both. The moment
  *partial vignetting* is real the forced equality would paper over a genuine
  disagreement about how much light gets through — so the matched-normalization
  rungs need re-deriving there, not just re-running.
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

## Step 3c — the spatially-variant full-field render (current)

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

## Step 4a — folded chains: the frame follows the beam, and maps back (current)

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

## Step 4b — the Newtonian preset (current)

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

## Step 5c — the spider: diffraction spikes from the vanes (current)

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

## Step 5d — atmospheric seeing: the one random draw in the image (current)

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

## Later rungs

- Published achromat/apochromat prescriptions reproduce catalogued EFL/BFD.
- Seeing's geometric-branch analog: rays deflected by ∇φ, so a seeing blur
  survives the fidelity fallback (the § 5d deferral).
- Photometry: star magnitude → photon flux through aperture vs published
  zero points.

## Rules

- New engine capability ⇒ new rung(s) in the same PR.
- Never loosen a tolerance to make a test pass — investigate; tolerances
  document the physics, not the implementation's mood.
