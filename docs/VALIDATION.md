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

## Step 2b — PSF + MTF (planned)

| Rung | Pinned to |
|---|---|
| Airy first minimum at 1.22 λ/D (unobstructed circular pupil) | closed form |
| PSF Strehl ≈ exp(−(2πσ/λ)²) for small RMS wavefront error | Maréchal |
| MTF of perfect circular pupil matches analytic autocorrelation | closed form |
| Obstructed-pupil MTF: contrast loss vs obstruction ratio | published curves |
| Abbe limit λ/2NA appears in microscope-branch resolution | Abbe theory |
| PSF energy = transmitted pupil energy, in BOTH PSF branches | Parseval |
| FFT and geometric PSF agree across the fidelity blend band | continuity |

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
