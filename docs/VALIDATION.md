# Validation ladder

The engine is only trusted where it is pinned to known physics. Every rung is
a vitest test in `packages/core/test/`. A rung is "done" only when the test
asserts a number from outside the engine (textbook, published design, closed
form, or — at [step 0](#step-0--the-exact-tracer-against-an-independent-implementation)
alone — another program's answer to the same question) — engine-vs-itself tests
are consistency checks, not validation.

Every step below is landed and green. The prose under each step is the record
of *why* — why a tolerance is the number it is, and what a rung caught. It is
the point of this file, not padding; read the step you need rather than the
whole ladder.

## The ladder at a glance

| Step | What it pins | Tests |
|---|---|---|
| [0](#step-0--the-exact-tracer-against-an-independent-implementation) | The one rung whose external number is another **program** rather than a closed form: sixteen systems, rays given as points and directions, traced by `traceRay` and by rayoptics 0.9.9 to the last bits of a double — bar the asphere's Newton floor; **0.1** the misaligned seven, sharing the chain but not its parameters, so FRAMES are compared and not angles; **0.2** the aimed chief ray, where the ray IS the answer; **0.3** tilted mirrors and the folded frame, two conventions one z-flip apart; **0.4** a THIRD tracer, so the two references can be compared with the engine out of it | `crosscheck` `crosscheck-optiland` |
| [1](#step-1--geometry-materials-ray-tracing) | Snell, Fresnel, conics, glass catalogs, paraxial + exact trace, mirrors | `geometry` `materials` `interaction` `paraxial` `sequential` `physics` `math` |
| [1.5](#step-15--system-spec--pupils) | Entrance/exit pupils, ray aiming, OPD at the exit pupil; **1.5.1** an NA read as Abbe's n·sin u rather than as a paraxial slope — pinned on the ray the engine AIMS, and NA ≥ n refused; **1.5.2** an aim is a line, so a virtual entrance pupil behind the object still launches forward instead of reporting `miss`; **1.5.3** real aiming, because a misalignment MOVES the stop and the paraxial pupil does not follow — pinned on two rigid-motion identities, and the finding that the artifact lived in the currency rather than in the aim | `pupil` `opd` `compile` `real-aiming` |
| [1.6](#step-16--focus-solve--spot-diagrams) | The three focus criteria and the 4/3 and 2 ratios between them; and the bracket that makes the wavefront solve a minimum rather than an edge | `focus` |
| [1.7](#step-17--the-paraxial-solve-the-root-a-design-target-names) | Design mode's first half: a parameter solved for a first-order target, pinned against Gullstrand INVERTED rather than evaluated — and the three findings that are not the arithmetic: the search is a stated interval so multiplicity is reported rather than chosen, an EFL pole is a sign change that is not a root, and a scan cell holding two roots holds none | `solve` |
| [1.8](#step-18--damped-least-squares-the-compromise-a-merit-settles-on) | Design mode's second half: a merit over several variables, on two closed-form minimisers — Coddington's best form *recovered* rather than evaluated, and the achromat's power split — plus the run that converges 400 mm from the target | `optimize` |
| [2a](#step-2a--fft--zernike-basis) | FFT transform pairs; Noll indexing, closed forms, orthonormality | `fft` `zernike` |
| [2b](#step-2b--psf--mtf) | Airy encircled energy, Maréchal Strehl, closed-form circular MTF | `psf` |
| [2c](#step-2c--the-fidelity-criterion) | When the FFT branch is trustworthy — measured on raw traced samples | `fidelity` |
| [2d](#step-2d--geometric-branch--blend-band) | Ray-histogram PSF, energy matched to the diffraction branch, smooth blend | `geometric` |
| [2e](#step-2e--polychromatic-stacking) | Stacking on a common *physical* grid, not bin-for-bin | `polychromatic` |
| [2f](#step-2f--trace-level-partial-vignetting) | Partial vignetting from the trace, on-axis pinnable geometry | `vignetting` |
| [3a](#step-3a--the-standard-observer-and-thermal-sources) | CIE 1931 observer, Planck sources, sRGB | `photometry` |
| [3b](#step-3b--the-hero-image-colour-out-of-chromatic-aberration) | The milestone: a singlet fringes, an achromat does not | `hero` |
| [3c](#step-3c--the-spatially-variant-full-field-render) | Patch decomposition conserves light; field mapping from the chief ray; the cost model corrected — far fewer field RADII than patches, cached ≡ uncached bit for bit; and the refinement ladder's middle levels dropped, a level being the standalone render at its own patch count; the fidelity criterion read off the trace, so the branch it rules out is not computed | `render` `golden` `geometric` |
| [4a](#step-4a--folded-chains-the-frame-follows-the-beam-and-maps-back) | Reflection primitive, folded ≡ unfolded authoring, mapping back | `fold` |
| [4b](#step-4b--the-newtonian-preset) | Newtonian geometry, on-axis quality, coma | `newtonian` |
| [5c](#step-5c--the-spider-diffraction-spikes-from-the-vanes) | Spikes ⊥ each vane; 4 vanes → 4 arms, 3 vanes → 6 | `psf` |
| [5d](#step-5d--atmospheric-seeing-the-one-random-draw-in-the-image) | Kolmogorov D_φ(r), Fried's long-exposure OTF, r₀ not aperture; **5d.1** the ensemble promoted out of the test file and run on a traced system | `seeing` |
| [5e](#step-5e--the-classical-cassegrain-preset) | Classical Cassegrain geometry, on axis, coma | `cassegrain` |
| [5f](#step-5f--the-ritchey-chrétien-preset) | Ritchey-Chrétien aplanatism — the coma null | `ritchey` |
| [5g](#step-5g--the-schmidt-camera-preset) | Schmidt camera, corrector plate, off axis | `schmidt` |
| [5h](#step-5h--the-schmidt-cassegrain-preset) | Schmidt-Cassegrain geometry and spherochromatism | `schmidt-cassegrain` |
| [5i](#step-5i--the-all-spherical-commercial-sct-preset) | All-spherical commercial SCT and its spherochromatism | `sct` |
| [5j](#step-5j--third-order-sums-and-the-achromatic-doublet-preset) | `analysis/seidel` closed forms; the achromatic doublet objective | `seidel` `achromat` |
| [5k](#step-5k--the-ed-fluorite-refractor) | CaF₂ anomalous partial dispersion — what ED buys and costs | `ed-refractor` |
| [5l](#step-5l--module-composition-and-afocal-telescope-evaluation) | The splice; thin-lens Keplerian closed forms; **5l.1** the on-axis splice that silently swallowed a folded module | `afocal` |
| [5m](#step-5m--the-computed-plössl-eyepiece) | Plössl computed from two achromatic doublets | `eyepiece` |
| [5n](#step-5n--real-ray-afocal-apparent-field-of-view-and-distortion) | Real-ray AFOV and distortion | `afocal` |
| [5o](#step-5o--the-huygens-eyepiece-achromatism-by-spacing) | Huygens achromatism by spacing | `eyepiece` |
| [5p](#step-5p--limiting-aperture-stop-selection) | Which stop actually limits the chain | `aperture-stop` |
| [5q](#step-5q--the-reduced-eye-and-visual-mode) | Reduced eye model; the two-stop competition | `visual` |
| [5r](#step-5r--camera-mode-pixel-scale-and-sensor-sampling) | Plate scale, the pixel as box integrator, critical sampling; **5r.1** the FOV bracket that started outside the field | `camera` |
| [5s](#step-5s--camera-mode-relative-exposure) | Image-space cone from the marginal ray; f-ratio and aperture laws | `exposure` |
| [5t](#step-5t--tolerancing-sensitivity-compensators-and-the-rss-budget) | Sensitivity, compensators, RSS budget — four external pins | `tolerance` |
| [5u](#step-5u--the-mechanical-layer-the-glass-path-that-is-not-its-own-length) | The mechanical layer, and the one claim it exists for: a part's mechanical length is not its optical cost — glass moves the traced focus by t(1−1/n), dispersively, and exactly independently of where it sits in the converging beam — plus the sixth geometric ceiling, the first from a MOUNT rather than the ray invariant | `mech` |
| [5v](#step-5v--the-extended-source-and-the-jacobian-that-makes-it-one) | The sky's first source with a SIZE: a radiance over solid angle, so the chief-ray map is differentiated rather than only evaluated — a Jacobian shown to be one-dimensional and pinned to cos³θ/f², with the fourth cosine measured to be absent from the engine and therefore NOT applied | `extended` |
| [6a](#step-6a--the-infinity-corrected-microscope-architecture-and-the-first-objective) | Infinity-corrected architecture; M = f_tube/f_obj; the first objective | `microscope` |
| [6b](#step-6b--the-classic-160-mm-din-microscope) | Finite conjugates (position factor); the re-solved DIN objective; the doublet's ceiling (§ 6b.5) | `microscope` `seidel` `achromat` |
| [6c](#step-6c--the-coverslip-and-what-mismatching-it-costs) | The plate solved to ALL orders; the slip-corrected objective; mismatch | `coverslip` |
| [6d](#step-6d--the-lister-the-first-aplanat-and-the-ceiling-of-two-doublets) | Aplanatic sphere (exact, all orders); ΣS_I and ΣS_II nulled together; coma NA³ → NA^5.2 | `lister` |
| [6e](#step-6e--oil-immersion-the-plane-stack-exactly) | The N-layer immersion stack solved to ALL orders; the matched-stack identity; the aplanatic front (dome + menisci); a diffraction-limited 100×/1.40 oil objective; the slip tolerance, and why the delivered NA depends on the slip | `immersion` |
| [6f](#step-6f--brightfield-the-condenser-and-partial-coherence) | Abbe source-point summation; the coherent plateau and the incoherent identity as the two exact ends; the (NA_obj + NA_cond) cutoff measured; the weak-phase null; the coherence deferral made detectable — a verdict, not a blend, and the sum's own lattice guard | `illumination` |
| [6g](#step-6g--the-coherence-width-and-what-a-field-decomposition-may-window) | van Cittert–Zernike from the condenser's own sampling; the 0.61·λ/NA_cond coherence width measured; μ shown to be what the Abbe image contains; the finding that an input-side partition of unity multiplies the interference by C = Σ√(w₁w₂); and the bridge built on it — a field-varying brightfield render whose edge patches are exact and which is `brightfieldFidelity`'s first caller | `coherence` `math` `brightfield` |
| [6h](#step-6h--object-space-field-mapping-for-a-finite-conjugate) | The traced chief ray inverted to an object height, carrying distortion (cubic, ×8.00 per doubling); the frame's extent set by pupilSamples and not by the grid, and its 2.7% gap from the NA form shown to BE the objective's aplanatism; the pupil rotation exact and pinned against `rotateKernel`'s; a traced frame that finally rules `valid`; and the finding that the frame is NOT isoplanatic — convergence ratio ½, not the fixture's 0.4 | `object-field` |
| [6i](#step-6i--fluorescence-the-specimen-that-emits) | The Abbe sum shown to BECOME a convolution — exactly, at any modulation — once the source lattice steps by the pupil's own frequency step and reaches past 1 + B; the transfer shown to be a lattice point COUNT, which explains its non-monotone departure from § 2b's closed form; ν = 2 reached with no condenser at all; the input-side partition of unity exact where § 6g.2's output-side one was forced; beads placed through their own traced chief rays | `fluorescence` |
| [6j](#step-6j--the-stokes-shift-and-the-band-the-image-is-formed-in) | The excitation shown to be absent from the imaging path by construction; the depth of focus DERIVED from § 1.5's own defocus wavefront and checked against a traced one; a 20 nm Stokes shift measured at 0.32 depths of focus on a 4×/0.10 and 3.77 on a 100×/1.40; the emission band stacked over KERNELS on one physical grid; and the finding that scale diversity alone is not blur | `emission` |
| [6k](#step-6k--out-of-focus-haze-and-the-missing-cone) | Defocus shown to be a pure phase, so a plane's flux is EXACTLY invariant with depth and the haze cannot be focused away; the axis shown to follow sinc²(π·w₂₀), with 8/π² at the quarter wave and a hard null at every integer one; the missing cone as that same constant transformed — zero axial transfer at zero lateral frequency, 2.2e-15, with a negative control that fills it in; the support boundary μ = ν(2−ν) measured exactly at three frequencies and the defocused OTF pinned against an independent quadrature | `volume` |
| [6l](#step-6l--depth-dependent-spherical-aberration) | A focal depth is one more layer on § 6e.1's stack, so the step adds no physics and its content is what the reuse costs — and the headline is not an aberration at all: no ray of invariant above n_s leaves the specimen, so an oil 1.40 delivers exactly 1.3347 into water, the fifth geometric ceiling in this branch | `depth-aberration` |
| [6m](#step-6m--the-off-axis-frame) | The frame moved off axis, so a field is reached by tiling and not by widening: a tile at the origin bitwise identical to the frame, registration pinned in the LAST BIT, the reference sphere as hypot(R_axis, r), the ruler's trade in closed form, field curvature at ×4.000 per doubling — and the finding that an off-axis tile is ANISOTROPIC in the ratio 3 that § 6h.1's cubic implies | `object-field` |
| [6n](#step-6n--the-warped-grid-rasterizer) | § 6h's named deferral: the grid itself warped, a `Specimen` callback evaluated at the object point each pixel really looks at — so the warp happens in the ARGUMENT and nothing is resampled — with a straight object line shown to bow at ×2.00 per doubling, the map's own curvature, and the sign pinned as barrel | `specimen` |
| [6o](#step-6o--the-mosaic-and-its-guard-band) | Tiles composed into one image, each cropped to its useful span, with the guard band that crop needs measured against a CLOSED FORM — the coherent tail integral, which a filled condenser beats by a factor that doubles with the guard — and a tile rendered alone shown to be the tile the mosaic composes bit for bit | `mosaic` |
| [6p](#step-6p--the-commensurate-condenser-and-the-cached-pupil) | The condenser's lattice stepped by a whole multiple of the PUPIL's own frequency step, so a traced pupil is evaluated once instead of once per direction — cached ≡ uncached bit for bit, the saving pinned as an exact integer rather than a wall clock, and commensurability shown to be accuracy-neutral | `commensurate` |

| [6q](#step-6q--the-eyepiece-on-the-intermediate-image) | The eyepiece placed at last, and why the finite-object solve is an engine step: a gap solved from a collimated input leaves 70.5 diopters of vergence on a microscope — with the two object NAs exactly tan u and sin u, so the textbook 500·NA/M misses by 61% at NA 1.40 | `visual-microscope` |
| [6r](#step-6r--polychromatic-brightfield) | Colour at last, and the RULER that is the whole difficulty: the Abbe sum per wavelength, each on its own frame, stacked on one grid — the Abbe image shown by measurement to be an irradiance and not energy per pixel, so the resampler carries no Jacobian, and the blue plane worst-resolved by 2.56× | `brightfield-spectrum` |
| [6s](#step-6s--the-radial-map-tabulated) | The bisection per pixel replaced by a table: the inverse chief-ray map is ONE-DIMENSIONAL and belongs to the system, so one fourth-order Lagrange table serves a whole mosaic — and the map's own error estimate is shown to under-read the truth rather than bound it | `radial-map` |

| [6t](#step-6t--the-polychromatic-mosaic) | § 6o's mosaic and § 6r's colour composed, and the answer is an ORDERING — the guard is cropped per plane on that plane's own grid, before the stack — with the finding that the ruler plane is the least guarded, pinned to the wavelengths alone | `mosaic-spectrum` |
| [6u](#step-6u--object-space-ray-aiming-and-telecentricity) | § 6a's third and last immersion blocker: a stop at the back focal plane puts the entrance pupil at infinity, which `aimRay` refused — a pupil coordinate then names a SLOPE with no object height in it, and the magnification is bitwise unchanged over 20 mm of object travel | `telecentric` |

| [6v](#step-6v--the-presets-are-telecentric) | The shipped objective's stop moves from its rim to its back focal plane, the rim kept as the NEGATIVE CONTROL — and the price the step did not go looking for: a telecentric bundle's footprint translates with field, so it walks off glass sized for the axial beam | `telecentric-objective` |

| [6w](#step-6w--the-objective-knows-what-field-it-must-pass) | § 6v's price, paid: the objective is sized for a FIELD NUMBER, so its glass is f·NA + h — every number in it magnification-independent, the closed form an upper bound never reached, and a field number a second door onto § 6b.5.7's geometric doublet ceiling | `field-sized-objective` |
| [6x](#step-6x--what-telecentricity-is-worth-to-the-illumination) | A correction to four module headers before it is a measurement: the licence for one source at every field point belongs to the OBJECTIVE and not the condenser, so the offset is bitwise zero only on a telecentric lens — and what it costs off axis is § 6p's cache | `telecentric-illumination` |
| [6y](#step-6y--the-plane-stack-off-axis) | A slab is symmetric about its NORMAL, so off axis its quartic sits on a displaced disc: the classical plate set 1:4:4:2:4, a crescent instead of an annulus, and coma over spherical = 4·q_c/NA with no glass in it | `oblique-slab` |
| [6z](#step-6z--the-infinity-corrected-objectives-coverslip) | § 6c's last deferral: the slip is the one thing in the branch that does NOT scale with the objective, so its price is linear in M where § 6w's was magnification-free — plus a shipped telecentric aperture that assumed the object and the stop share a medium, and delivered NA 0.152 for 0.10 | `infinity-coverslip` |
| [6aa](#step-6aa--the-transform-of-a-row-nobody-wrote) | Every caller fills a box and transforms a grid, so 95 of 128 rows were a transform of zeros: skipping them is bit-for-bit, the band is RECORDED as the caller writes rather than derived from bounds it believes, the negative control is what stops the identity rungs passing on a no-op, and the columns are declined because realigning a centred block costs the one stage it would buy | `row-band` |
| [6ab](#step-6ab--the-commensurate-condenser-at-an-s-on-no-lattice) | § 6p's cache needed the DIRECTIONS, never S — a lattice masked to radius S frees the slider, the gap a divisibility law; § 6ab.12 gating the 2ν readout on where the beat exists; § 6ab.13 the ORDERS folded on too, the object from its spectrum; § 6ab.14 the carrying AREA, the whole condenser only below √((1−S²)/2); § 6ab.15 the ODD harmonics null by PARITY, the even ones 2·J_{h/2}(φ)²; § 6ab.16 a TRACED pupil failing REALNESS, not evenness; § 6ab.17 that bound false at n = 17, the envelope n^{-4/3}; § 6ab.18 the rim predictor REFUTED; § 6ab.19 the commensurate ANNULUS, cached | `lattice-disk`, `phase`, `harmonic-support`, `phase-grating-spectrum`, `harmonic-carrying-area`, `harmonic-parity`, `traced-parity` |
| [6ac](#step-6ac--the-two-focal-surfaces-and-distortion) | The sentence four sections carried — astigmatism and field curvature traced and unpinned — closed: S_III/S_IV added to the sums against a closed form carrying NO shape factor, the traced sagittal and tangential foci reproducing it to 0.04%/0.09% over 128× of field, tangential 2.9948× as far from Petzval as sagittal, barrel distortion cubic and matching S_V/(2n′u′) from disjoint machinery — and both plausible-wrong-answer hazards measured and refused by the API: a mismatched axial reference at 59× the signal, and the wrong measuring plane at 13× | `field-curvature` |
| [6ad](#step-6ad--the-two-mtf-sections-and-the-cutoff-of-an-aperture-that-did-not-transmit) | The split `wave/mtf` promised when field curvature arrived: direction pinned by three machineries agreeing (rays 1.848, PSF 1.390, MTF 1.48×) and by a stop-at-CoC mirror that is 0.75 waves out and still splits by 1e-4 — plus the header sentence that was false, the cutoff being the aperture ASKED FOR while the array stops at ν = 0.73 where the crown closes on itself | `mtf-sections` |

Two sections close the file: [Later rungs](#later-rungs), the pins that are
named but not yet made, and [Rules](#rules), the discipline every rung is held
to. Individual steps also carry their own "Not yet pinned" notes.

Tests are in `packages/core/test/<name>.test.ts`. Steps 5a and 5b do not
exist: tilt/decenter and folded pupils were prerequisites closed inside § 4a.
**Step 6l is now closed too** — it was the one gap rather than a closure, taken
after the § 6m–§ 6s line because that line is what the field of view was blocked
on and this one is independent of all of it. With it the microscope branch has
no numbered gap left.

## Step 0 — the exact tracer against an independent implementation

| Rung | Pinned to | Status |
|---|---|---|
| Cemented doublet (§ 5j's 60 mm f/8 achromat), 11 rays: hit point on every surface | rayoptics 0.9.9 | ✅ |
| The same, exit direction cosines and optical path length | rayoptics 0.9.9 | ✅ |
| Two-doublet objective (§ 6d's 20×/0.25 Lister), 6 surfaces, 9 rays, all four quantities | rayoptics 0.9.9 | ✅ |
| Two-mirror telescope (§ 5e's 200 mm f/10 Cassegrain), paraboloid + hyperboloid, 8 rays | rayoptics 0.9.9 | ✅ |
| Even asphere on a refracting surface (synthetic singlet), 8 rays | rayoptics 0.9.9 | ✅ |
| Optical path DIFFERENCES across each pupil — the wavefront the OPD layer is built on | rayoptics 0.9.9 | ✅ |
| **0.1** Every surface's compiled FRAME — rotation and vertex, in the launch frame — against the frame rayoptics traced it in | rayoptics 0.9.9 | ✅ |
| **0.1** Six singlets misaligned one degree of freedom at a time (decenter X, decenter Y, tilt X, tilt Y), 9 rays each incl. skew | rayoptics 0.9.9 | ✅ |
| **0.1** The two combinations no isolated system can see: two tilts on one surface (12°, 9°), and a tilt with a decenter on one surface | rayoptics 0.9.9 | ✅ |
| **0.1** A tilted surface with two surfaces downstream of it — the local coordinate chain against tilt-and-return | rayoptics 0.9.9 | ✅ |
| **0.2** The AIMED chief ray onto a stated surface's own vertex, on all seven misaligned systems — each side solving it with its own Newton around its own tracer | rayoptics 0.9.9 | ✅ |
| **0.3** A tilted MIRROR as a misalignment: the Cassegrain's secondary tilted in two axes and decentered, on the default chain, with a flat riding on its tilted frame | rayoptics 0.9.9 | ✅ |
| **0.3** Four FOLDED systems — a 45° diagonal, a Newtonian's two mirrors, a curved 15° fold, a compound-tilted diagonal — frames reconciled by one z-flip per mirror | rayoptics 0.9.9 | ✅ |
| **0.3** The frame the chain continues in after a mirror, against the direction rayoptics' own trace sent the BEAM — the one comparison with no convention in it | rayoptics 0.9.9 | ✅ |
| **0.3** The direction leaving EVERY surface, on all sixteen systems — an error two surfaces cancel between them is invisible in the exit direction alone | rayoptics 0.9.9 | ✅ |
| **0.3** rayoptics' own `'bend'` against the reflected frame: identical for an in-plane tilt, 0.88° apart for a compound one, and the traced beam picks the reflection | rayoptics 0.9.9 | ✅ |
| **0.4** The same sixteen systems and the same rays, traced by a SECOND independent tracer — inputs read verbatim from the rayoptics fixture, and that identity asserted field by field | Optiland 0.6.1 | ✅ |
| **0.4** rayoptics against Optiland with the engine out of it: the majority, and the only comparison that can see a convention the engine SHARES with one reference | Optiland 0.6.1 vs rayoptics 0.9.9 | ✅ |
| **0.4** Every surface's frame on the twelve unfolded systems, composed by Optiland's own reference chain rather than by the generator | Optiland 0.6.1 | ✅ |
| **0.4** The four folded systems placed absolutely, so what they vote on is the beam — Optiland has no fold concept to compare a frame against | Optiland 0.6.1 | ✅ |
| **0.4** Seven controls: a launch shift, an index error, a flipped tilt sign, the two tilt angles swapped, 0.1° on a fold mirror, two systems' answers crossed — and the seventh asserting agreement | the rung's own tolerances | ✅ |
| Sixteen negative controls: a 1 nm launch shift, a 1e-7 index error, a sphere where the fixture has a paraboloid, the asphere coefficients dropped, a flipped tilt sign, the two tilt angles swapped, a decenter read along the tilted axes, no two singlets landing in one place, the sixteen systems not being sixteen spellings of one shape — and seven for the fold, starting with the one the other six need: the undamaged systems still agreeing when read through the same helper, then the z-flip being a real rotation, the same surfaces read on the default chain, a curvature and a thickness that do not carry the parity, the diagonal's conjugated tilt, and the folds turning a corner at all | the rung's own tolerances | ✅ |

This is the "one cross-validation against an independent tracer" ROADMAP has
carried in *Engineering practices* since step 4, and it is a different kind of
rung from everything below it. Every other rung compares the engine to a closed
form, which checks it wherever an answer can be written down — a sphere, a
paraboloid, a thin lens, a plate. This one compares it to another program's
arithmetic on systems where **no closed form exists**, which is the only
evidence available that the machinery is right rather than the special cases.

The reference is **rayoptics 0.9.9** (Michael Hayford, BSD-3), a mature
open-source sequential design package with no shared lineage with this engine.
It is driven headless by `docs/notes/rayoptics-crosscheck.py`; its answers live
in `packages/core/test/fixtures/rayoptics-crosscheck.json`, committed, so
`npm test` needs no Python and the number cannot quietly change underneath the
rung — the test asserts the tool name, the version and the call that produced
it, and a different rayoptics writing that file fails there first.

**The design is one decision: compare the primitive, not the workflow.** Both
programs expose a raw trace of a ray given as a point and a direction, so that
is what is compared — surface by surface, ending on the last surface. No pupil
coordinates, no ray aiming, no field angles, no image plane, no focus solve.
Every index is stated in the fixture as a number and constant, so the glass
catalog is out of it too. What survives is intersection, Snell and path length,
and a disagreement could not have been anything else. The alternative — compare
spot sizes, or EFL, or an OPD map — would have made every disagreement an
argument about whose definition of a pupil coordinate is right.

**The headline is that there is nothing to report, at the last bit.** Over the
four axial systems the worst disagreements are **0.94 ulp** on a hit point, **5 ulp**
on a direction cosine, **1.6 ulp** on an optical path and **2.3 ulp** on a path
*difference* — where an ulp is measured at the system's own geometric scale,
because a hit point may land at y = 0 after the ray travelled 560 mm to reach
it and the rounding it carries is the travel's, not the zero's. In physical
units the worst case is the Cassegrain's, at 3.41e-13 mm of wavefront over a
660 mm path: **5.8e-10 of a wave**. The tolerances are stated in ulp for that
reason; a bound in millimetres would have to be a different number for a 3 mm
objective and a 600 mm telescope and would say nothing about either.

**The one place they do not agree to the last bit is not rounding, and it is
the finding.** An even asphere has no closed-form intersection, so both sides
Newton-iterate and both stop at an absolute residual of 1e-12 mm
(`makeEvenAsphere`'s `|g| < 1e-12`, rayoptics' `trace_raw(eps=1e-12)`). Two
independent stopping criteria cannot agree closer than the looser of them, so
that system's hit points are held to that floor rather than to a bit count.
Measured, they agree to **3.8e-14 mm** — both iterations are converging about
26× tighter than either promises, which is worth knowing and is not something
either program's own tests would say.

**Four conventions had to be mapped, and naming them is most of what this file
gains.** Each is a way the comparison could have reported a difference that was
not one. (i) rayoptics' `EvenPolynomial.coefs` start at **r²** where
`asphereCoeffs` start at **r⁴**, so a zero is prepended; that mismatch alone
would have moved a 20 mm ray by 0.016 mm and read as a tracer defect. (ii)
rayoptics returns hit points in **each interface's own frame**, ours in the
launch frame, so the vertex offsets are added back. (iii) `trace_raw`'s default
`intersect_obj=True` starts the path at the *object surface* rather than at the
given point, which would have measured the optical path from somewhere else —
it is set `False`, and this is the reason the rung compares path *differences*
as well as absolute paths, since a shared offset is exactly what a difference
cannot hide. (iv) `last_surf` does not suppress the image interface, so the
trailing segment is dropped explicitly.

**And one convention did not need mapping, which is a result rather than a
convenience.** The unfolded mirror frame this engine has used since § 4a —
thicknesses going negative after a mirror while the coordinate axis stays put —
is rayoptics' convention too, so the Cassegrain reconciled with **no sign
mapping at all**. The engine's highest-risk sign convention agrees with an
independent implementation's on a two-mirror system, which is the strongest
statement available about it and one no closed form was going to make.

**What this does NOT pin, stated because the rung is easy to over-read.** It
does not upgrade the rungs below it: they still assert what they assert, and
this one adds independent evidence for the shared machinery underneath them
rather than a second signature on their numbers. **Dispersion is deliberately
out** — both sides are handed the same indices, so `materials` is untouched
here and keeps its own datasheet rungs. **Apertures are out** — every ray is
well inside every rim and the prescriptions are built unbounded, because a rim
could only let one tracer clip where the other does not. **The systems are
ours** — captured once from `designs/achromat`, `designs/lister` and
`designs/cassegrain`, then frozen as literals, so the fixture is a system
rather than a reference to a solver and a design change cannot silently move
it. Only the *answers* are external.

### Step 0.1 — tilt and decenter, and a convention that does not translate

The "second investigation" the paragraph below used to defer. Seven more
systems, all refracting, and the result is that the two programs **agree about
misalignment while disagreeing about how to write one down** — which is why the
step is built the way it is.

**They share the structure, and that was the risk.** rayoptics'
`DecenterData('decenter')` is "pos and orientation applied prior to surface"
and is never returned to the global axis; `forward_transform` then steps from
surface i to surface i+1 by taking the thickness along **surface i's own,
already tilted, local z**, adding surface i+1's decenter in that same frame,
and rotating about the decentered vertex. That is exactly the local coordinate
chain in ARCHITECTURE § Tilt / decenter semantics, down to the order of the two
operations. The idiom ARCHITECTURE rejects — tilt about the vertex, then return
to the global axis — is rayoptics' *`dec and return`*, a different type on the
same class. The engine's most consequential misalignment decision turns out to
match a mature independent implementation's default, and nothing in the repo
could have said so before.

**They do not share the parameters, and there is no fixing that.** This engine
builds a surface's rotation as **Ry(tiltY)·Rx(tiltX)**. rayoptics negates its
first two Euler angles (`euler2opt`: "alpha and beta are left-handed") and
multiplies in intrinsic x-y-z order, giving **Rx(−α)·Ry(−β)·Rz(γ)**. For a
single-axis tilt the two coincide up to a sign. For a two-axis tilt they do not
coincide at all, because Ry·Rx is not Rx·Ry — no angle-for-angle translation
exists, and a fixture that tried to state one would have been asserting a
falsehood.

**So the fixture compares frames, not angles.** It states each tilt in this
engine's parameters, builds the matrix they mean, and solves for the Euler
triple that realizes *that matrix* (`mat2euler(…, axes='rxyz')`, then undoing
`euler2opt`). The triple is checked against the matrix it came from before a
single ray is traced — worst residual **1.1e-16**, half an ulp — and every
system then carries the frames rayoptics actually traced in, so the TypeScript
side compares its own compiled `frame.rotation` and `frame.translation` against
them. **That rung is what makes the ray agreement mean anything**: two tracers
can agree about rays while disagreeing about where the glass is only by a
coincidence, and comparing the frames removes the coincidence.

**The numbers.** Frames agree to **0.50 ulp** of a direction cosine at worst
and vertices to **0.01 ulp**; rays to **0.96 ulp** on a hit point, **3 ulp** on
a direction, **1.63 ulp** on a path difference — **2.4e-11 of a wave**. The
misaligned systems are therefore *tighter* than the axial ones already here (the
Lister's 5 ulp on a direction, the asphere's 6.9 on a point), which is the
opposite of what a new convention usually costs.

**Where the half-ulp lives is the whole finding in one number.** The frames are
bitwise identical on the single-axis tilt-X system, 0.06 ulp out on tilt-Y,
0.03 on the tilted doublet — and **0.50 ulp on the two-axis system**, the only
one whose rotation has no angle-for-angle spelling in rayoptics' parameters. The
convention gap is not an argument; it is half a bit, and it is visible in
exactly the system that has to pay it.

**Isolation is a property of the design, not a nicety.** Each degree of freedom
is moved *alone* somewhere — decenter X, decenter Y, tilt X, tilt Y, on one
singlet shape traced by one ray set — because in a system that moved several at
once, a sign error in one could be absorbed by an order error in another and the
pair would still agree. The two systems that *do* combine exist for the opposite
reason: a combination is the only thing that can see an ordering. `tilt-xy`
carries **12° and 9°**, deliberately large, because Ry·Rx and Rx·Ry differ at
second order in the angles — at a tenth of a degree the swap control passes
under either convention and proves nothing. `tilt-and-decenter` is the only
system that can tell "shift the vertex, then rotate about it" from "rotate, then
shift along the rotated axes", and its control is *conservative*: the rotated
reading puts part of the shift along z, which a decenter has no field for, so
the damage the test applies is smaller than the difference it stands for.

**One system exists purely to have something downstream.** A single tilted
surface cannot distinguish the local chain from tilt-and-return, because there
is nothing after it to be steered. `misaligned-achromat` tilts surface 0 of
§ 5j's doublet by 2° and 1.5° and puts a decenter on surface 1, so the whole
rear of the cemented pair rides on the tilted frame — and a decenter composed
with an upstream rotation is exercised, which no single-surface system reaches.

**Skew rays throughout, and that is load-bearing too.** A meridional-only ray
set never leaves the plane a Y tilt acts in, so it cannot see a sign error in
one. Every misaligned system carries rays with x ≠ 0 in both the origin and the
direction.

**What the last control caught, and it caught it in the drafting.** The check
that the *reference itself* moved — no two of the six singlets landing in the
same place, which is the only failure the ray comparison is blind to, since two
tracers agree perfectly about a surface neither of them moved — first compared
one ray, the axial one, and failed at **5.5e-17**. Not a defect: **a surface
tilted about its own vertex leaves the ray through that vertex exactly where it
was**, so all three tilt systems share that one exit point while differing by
millimetres everywhere else. The control now runs over the whole ray set. A
control aimed at the wrong ray is a control that reports geometry as a bug.

### Step 0.2 — the aimed chief ray, where the ray IS the answer

Everywhere else in this file the ray is **given** and only the trace is compared
— deliberately, since that is what removes every aiming and pupil convention
from the argument. § 1.5.3 needed the other thing, so this block adds it in the
one form that keeps the property: the target is a **surface's own vertex**, which
is a point on a surface and needs no agreement about what a pupil coordinate
means on a tilted stop. A rim point would have needed exactly that agreement, so
the rim is left to § 1.5.3's rigid-motion identities and only the chief ray is
pinned here.

Both sides solve it, and **neither uses the other's solver**: a two-variable
Newton around `trace_raw` in the generator, `aimRay` with `rayAiming: "real"` in
the engine. Two independent solvers over two independent tracers driven to one
geometric condition, which is a different and stronger claim than either
program's aiming checked against a formula. rayoptics' solve lands on the vertex
to **1.5e-16 mm at worst**; the engine's own bound is its stop radius times
1e-12, and the comparison is held to the looser of the two.

**The negative control is asserted where it can bite and silent where it cannot,
and the fixture records which is which.** Paraxial aiming must reach a *different*
ray wherever the perturbation actually moved the target — it does, by a fraction
of the target's own displacement, on four of the seven. On the other three it
correctly agrees, and the reason is the same geometry the § 0.1 control ran into
from the other side: **a tilt is about a surface's own vertex, so it does not
move that vertex**, and aiming at it is the same problem tilted or not. Those
three are named in the rung rather than left looking like coverage.

**Not yet pinned.** ~~**Tilted mirrors and the folded frame**, deliberately: a
mirror under `mirrorFrames: "folded"` reflects the coordinate chain in its own
tangent plane, which is a second convention with its own handedness and sign
questions, and every misaligned system here refracts.~~ — **done, § 0.3 below**,
and the sentence is struck rather than deleted because it named the risk
correctly: the folded chain *is* a second convention, and what closed it was
finding the one rule that maps it onto rayoptics' and then refusing to trust the
map where it stops holding. ~~Still open: a second independent tracer, which
would turn an agreement into a majority.~~ — **done, § 0.4 below.**

### Step 0.3 — tilted mirrors, and a fold rule settled by where the beam went

Five more systems, and they answer two different questions that the phrase
"tilted mirrors and the folded frame" had been carrying as one.

**The first question turns out not to be a question.** A tilted mirror on the
DEFAULT chain is a misalignment like the seven refracting ones above: the chain
keeps its direction, the thickness behind the mirror stays negative, and
rayoptics' `DecenterData('decenter')` places it exactly as it places a tilted
lens. So `tilted-secondary-cassegrain` — § 5e's telescope with the secondary
tilted 0.4° in X and −0.25° in Y, decentered 0.5 mm, and a flat 700 mm behind it
riding on the tilted frame — needed no new machinery at all. What it adds is
that the surface which *moved* is a reflecting one, which no system in § 0.1
had, and that a two-axis tilt composed with a decenter is exercised on a mirror
with something downstream of it to steer.

**The second question is real, and it has one answer.** A folded prescription
and the model rayoptics traces are the same world geometry read in frames that
differ by **one z-flip per mirror**: with D = diag(1, 1, −1) and `parity` =
(−1)^(mirrors so far),

> frame_rayoptics(i) = frame_engine(i) · D^(mirrors before i)

and every other difference between the two authorings follows from what D does
to a field. A curvature and an even-asphere coefficient **are** the sag and the
sag is along z, so they carry the parity; a conic constant is a shape parameter
and does not; a decenter is an (x, y, 0) shift and D leaves it alone; a
thickness carries the parity *behind* its own surface, which is precisely the
statement that post-mirror thicknesses are positive in a folded prescription and
negative in an unfolded one. A tilt matrix conjugates to D·T·D — for this
engine's in-plane tilt axes, both angles negated. **The flip is applied on the
TypeScript side**, computed from the fixture's own surface list, because a
fixture that arrived pre-flipped would have hidden the reconciliation in the one
place nothing checks it.

**rayoptics' own fold is used, not emulated.** `DecenterData('bend')` —
"orientation applied before and after surface" — is what each tilted fold mirror
is built with, so the frames the comparison agrees on are the ones rayoptics'
fold concept produced. Three systems exercise it: `fold-flat-45` (a 45° diagonal
with a lens 100 mm along the folded axis, whose curvature therefore sits behind
an odd mirror count), `newtonian-fold` (a paraboloid of f = 1000, a diagonal
800 mm up the tube, a flat at the eyepiece 200 mm out the side — two mirrors, so
the parity returns, and the diagonal's tilt is the one place D·T·D is
exercised), and `fold-sphere-15` (a *curved* fold: a concave sphere tilted 15°
about Y, deviating the chain by 30°, with a meniscus in the converging beam — a
flat fold cannot see a curvature parity and a 45° one cannot tell an angle from
its double, so this system is neither).

**And the two fold rules are not the same rule, which is the finding.** 'bend'
applies the tilt rotation twice; this engine reflects the incoming frame in the
mirror's tangent plane. Those coincide **identically** — residual 0.0, not
merely small — when D·T·D = Tᵀ, i.e. whenever the rotation is about an axis in
the xy-plane. That is every single-axis tilt, and so every fold mirror that is
actually a fold mirror. A **two-axis** tilt is not such a rotation, because
Ry·Rx carries a roll, and there the two rules part: at 45° in X with 3° in Y the
chains sit **0.880040°** apart.

**Which one follows the light is not a matter of taste, and rayoptics settles it
against itself.** `fold-compound-tilt` carries exactly that diagonal, and the
beam its own `trace_raw` sends off the mirror leaves along the **reflected
frame's** axis to 0.5 ulp of a direction cosine — and 0.88° away from where its
own 'bend' would have pointed the chain. This is not a defect on either side:
'bend' is a definition, and for the tilts fold mirrors have it is the reflection
exactly. It is a definition that stops meaning "follow the beam" for a
misaligned diagonal, which is exactly the case a tolerancing run reaches. The
generator therefore **asserts the coincidence before using 'bend' anywhere**,
and the one system that would violate it puts the mirror last, where no chain
follows it and rayoptics builds it as a plain 'decenter'.

**The rung that is worth the most needs no mapping at all.** Ray 0 of every
folded system is exactly axial, so it reaches each mirror's own vertex
travelling along the chain's axis, and the direction it leaves in *is* the
direction the chain must continue in. Comparing `outgoingFrame`'s +z against
that traced direction puts a frame against a **beam** — no D, no parity, no
'bend' — and it is the one comparison that a convention error shared by both
programs could not survive. Agreement is **≤ 2.5 ulp** of a direction cosine.

**The numbers.** Frames agree to **2.5 ulp** of a direction cosine and vertices
to **2.9 ulp**; hit points to **2.9 ulp**, exit directions to **4 ulp**, optical
paths to **3.1 ulp**. The worst path *difference* is the Newtonian's at
**2.3e-9 of a wave**, and it is the largest in the whole file for the ordinary
reason that its rays are launched 2000 mm out — an ulp is measured at the
system's own scale, and this system's scale is a telescope tube.

**One rung was added for every system, not just the folded ones.** The fixture
now carries the direction leaving **every** surface, because the exit direction
is a product of all the interactions and cannot see an error at one surface that
a later surface undoes — and because the fold rung needs the direction a beam
left a *mirror* in. `traceRay` reports hit points and a final ray, so the
intermediate directions are recovered from consecutive hits, which sets the
tolerance: two points good to their own bound fix a direction to that over their
separation, so a 0.23 mm segment inside the Lister's cement earns a looser bound
than an 800 mm tube, and the rounding floor is added rather than substituted so
a short segment is never held tighter than a double allows.

**What the fold controls are for, and one of them is the others' own control.**
Six of them damage a rule; the seventh is the one they need, because "a damaged
system no longer agrees" is also what a helper that always answered *no* would
report, leaving all six passing and pinning nothing. So the undamaged
prescriptions are put through the same helper first and required to agree.
That check is not decorative: it is the assertion that fails when the fold rule
itself is wrong, which is exactly when the six below stop meaning anything.

The reconciliation is four
rules travelling together — a frame flip, a curvature parity, a thickness parity
and a conjugated tilt — and rules that travel together are exactly the ones that
can be wrong in a way that cancels. Each is damaged alone and the comparison has
to notice: reading the same surfaces on the **default** chain (the strongest,
since it changes nothing but where the chain points), a curvature that does not
carry the parity, a thickness that keeps the unfolded sign, the diagonal's tilt
un-conjugated, the z-flip shown to be a whole axis rather than bookkeeping, and
— the blindness check — the folds actually turning a corner, since an *untilted*
mirror simply reverses the chain and any implementation gets that right.
"Notices" is stated as either the exit point moving past tolerance **or** the
ray failing to trace at all; both are the fixture working, and only a damaged
system still landing on the reference is forbidden.

**Not pinned here, and named rather than half-done.** No aimed chief ray is
solved on a folded system. That would pull in pupils and the unfolded-axis map,
which is § 4a's rung and § 1.5.3's — a different claim from the frame convention
this block is about, and one `fold.test.ts` already makes against closed forms.

### Step 0.4 — a second independent tracer, and the majority it makes

Everything above is an agreement between **two** programs, and two programs
agreeing cannot tell you *why*. Where this engine and rayoptics had agreed about
a **convention** rather than about arithmetic, nothing in § 0–§ 0.3 could have
said so: from inside either comparison, a shared definition looks exactly like a
shared answer. That is what the "still open" line above was pointing at, and
closing it needs a third implementation rather than more systems.

The third is **Optiland 0.6.1** (Kramer Harrison, MIT, DOI
10.5281/zenodo.14588961), driven headless by
`docs/notes/optiland-crosscheck.py` into
`packages/core/test/fixtures/optiland-crosscheck.json`, committed like the first
so `npm test` still needs no Python. **Lineage was checked before anything was
built on it**, because a third vote that is a transcription of the second is not
a vote: no module in the wheel mentions rayoptics, ray-optics, Hayford or
opticalglass. Its file-format readers name Zemax, OSLO and CODE V, which is
import plumbing rather than trace math.

**No new system and no new ray**, on purpose. The generator reads `surfaces`,
`rays`, `objectIndex`, `mirrorFrames` and the wavelength **verbatim** out of the
rayoptics fixture, and `crosscheck-optiland.test.ts` asserts that identity field
by field before it compares an answer. This is the rung the whole third
comparison rests on: two programs agreeing about an achromat and an
achromat-*shaped* thing is not evidence about either, and "the generator read
the other fixture" is a claim in a comment until something checks it.

**So the file compares three ways**, and the third is the point:

| Comparison | What it can see |
|---|---|
| engine vs Optiland | a defect in the engine, on sixteen systems |
| engine vs rayoptics (§ 0) | the same, against a different reference |
| **rayoptics vs Optiland, engine out of it** | a convention the engine *shares* with one of them |

**The headline is the tilt, and it is a statement about this engine's design
rather than about its arithmetic.** rayoptics builds a surface's rotation as
Rx(−α)·Ry(−β)·Rz(γ); this engine builds Ry(tiltY)·Rx(tiltX). Those are not the
same two-parameter family, which is why § 0.1 had to compare *frames* and solve
for the Euler triple realizing the matrix the engine meant. Optiland's
`CoordinateSystem` builds Rz(rz)·Ry(ry)·Rx(rx) — so with rz = 0 it is **this
engine's spelling, angle for angle**, and the generator states `tiltXDeg` as
`rx` and `tiltYDeg` as `ry` and stops. The engine's tilt parameterization is
therefore not idiosyncratic: an independent implementation writes it
identically. Nothing assumes it — § 0's controls (a sign, at −3°; an order, at
12°/9°) are what make it measured.

**Two constructions, and which system gets which is the scope note.**

- **Chained — the twelve unfolded systems, eight of them misaligned.** Surface
  *i*'s coordinate system references surface *i−1*'s and carries a decenter, the
  previous thickness and the tilt. **Optiland composes the chain**, so the frames
  in the fixture are its own answer about where the glass is, and comparing them
  against `compile()`'s is independent evidence for the local coordinate chain
  from a second source. Agreement: **0.13 ulp** on a rotation entry, **0.01 ulp**
  on a vertex.
- **Absolute — the four folded systems.** Optiland has **no fold concept at
  all**: a coordinate system is a placement, a mirror is an interaction, and
  nothing in the library reverses a chain. Those systems are therefore placed by
  absolute frame computed in the generator, and **the fixture deliberately
  carries no frames for them** — comparing `compile()` against frames the
  generator derived would be checking a transcription against its own source, a
  code-duplication check wearing a cross-validation's clothes. What the folded
  four vote on is the **beam**: Optiland traces through that placement and has to
  reproduce rayoptics' hit points, per-surface directions and path lengths. A
  negative control adds 0.1° to the Newtonian's diagonal and requires the beam to
  notice.

**Why the beam rung is evidence and not two transcriptions agreeing, stated
because it reads stronger than it is.** On **three** of the four, rayoptics
placed the surfaces *after* the mirror by its **own** rule — `DecenterData('bend')`
on a tilted fold, a parity-flipped `'decenter'` on the Newtonian's untilted
primary — so two unrelated placements arrive at one geometry and the rays can
adjudicate between them. On **`fold-compound-tilt` there is nothing after the
mirror at all**: it is the last surface on purpose, because that is the one
system where 'bend' sits 0.88° from the reflection (§ 0.3). So that system's rays
pin the mirror's own tilt and its reflection, and say nothing about a fold
*continuation* — which is § 0.3's `foldCheck` rung, and is not restated here.

**A second reconciliation of the fold, and it is simpler than § 0.3's.** The
engine's folded chain frame after a mirror is the reflection of the frame the
light arrived in, which is left-handed, and Optiland's Euler angles can only
express a rotation. Restoring right-handedness by negating the frame's **x**
axis — rather than its z, which is what rayoptics' convention amounts to — keeps
+z on the beam, so **curvature, conic, thickness and asphere coefficients are all
used exactly as the prescription writes them** and no parity flip appears
anywhere. § 0.3's four rules travelling together become one. Only a misalignment
would conjugate under the x flip, and no system has one behind an odd mirror
count, so that branch is not shipped as untested code: the generator raises.

**The numbers.** Against the engine: **4.6 ulp** on a hit point, **9 ulp** on a
direction cosine, **7.0 ulp** on an optical path, **9.3 ulp** on a path
*difference*. Against rayoptics with the engine out of it: **6.9**, **14**,
**6.4**, **7.0**. The worst disagreement anywhere in the file is **5.7e-13 mm**,
on the Cassegrain's 660 mm path — **9.7e-10 of a wave**.

**The direction bound is the one number that is larger than § 0's, and that is a
result rather than a slackening.** Everywhere the engine is one of the two sides,
the quantity is read off an implementation this repo controls and part of the
rounding path is shared. rayoptics against Optiland shares nothing, so six
refractions of independently-rounded arithmetic accumulate on both sides
independently — 14 ulp on the Lister's steep marginal ray where the same rung
against the engine reads 9. It is stated as its own constant
(`MAJORITY_ULP_DIR`) rather than folded into the other, which would quietly
loosen the rung that does not need it.

**Optiland's Newton floor is its own, and is not rayoptics' borrowed.**
`NewtonRaphsonGeometry` stops at max |sag(x, y) − z| < tol over the whole batch,
default **1e-10** — looser than the 1e-12 the engine and rayoptics both promise
— so the generator sets 1e-12: the same *promise*, a different *criterion*. What
it achieves is **8.3e-16 mm**, converging some **1200× tighter** than it
promises, which is the same kind of statement § 0 could make about the other two
and is not something Optiland's own tests say.

**Four conventions had to be handled**, and one of them is the dangerous kind.
(i) `EvenAsphere.coefficients` start at r² where `asphereCoeffs` start at r⁴ —
the same prepended zero rayoptics needed, arrived at independently. (ii)
`SurfaceGroup.__init__` calls `_update_surface_links()`, which sets surface 0's
`previous_surface` to `None`; `material_pre` then falls back to the surface's
**own** `material_post`, so the first surface refracts n→n and the launch
segment's path is measured **in glass**. It traces cleanly and answers wrongly,
so the object medium is re-attached after construction and then **asserted**
against the fixture's `objectIndex` before any ray is traced. (iii) Path length
accumulates as `abs(t·n)`, the absolute geometric distance, which is the physical
path only while no ray back-tracks within a segment — true of every ray here, and
the Cassegrain agreeing to the last bits is the evidence. (iv) rayoptics'
`--no-deps` trick barely applies: `optiland/__init__.py` imports the
visualization stack eagerly, so matplotlib, numba, vtk and seaborn are
load-bearing at *import* time even though the script draws nothing.

**Seven controls, and the seventh is the one the other six need.** Six damage
one input and require the comparison to notice at the tolerances above — a 1 nm
launch shift, a 1e-7 index error, a flipped tilt sign, the two tilt angles
swapped, 0.1° on a fold mirror, and one aimed at the majority rung specifically:
crossing one system's rayoptics answer against a *different* system's Optiland
answer, which has to blow up, since a comparison of two files would otherwise
pass on two files generated from each other. The seventh asserts **agreement** —
undamaged, through the same helper, all sixteen systems, both worst residuals
stated in ulp — because six assertions that a damaged input disagrees say only
that the comparison is not blind.

**Deliberately out of scope.** § 0.2's aimed chief rays: that is a question about
two *solvers*, and a majority about the tracer does not need a third one. New
systems or new rays: either would force the rayoptics fixture to be regenerated
to keep the two answering one question, which is a different and much larger
change. Dispersion and apertures stay out for § 0's reasons, unchanged.

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
| **`objectNA` fills the entrance pupil to arm·tan(asin(NA/n))** | NA ≡ n·sin u (Abbe) | ✅ |
| **`imageNA` fills the exit pupil the same way** | NA ≡ n·sin u (Abbe) | ✅ |
| **The AIMED marginal ray carries the invariant asked for, to NA 1.4 in oil** | ray invariant | ✅ |
| **The slope reading it replaces = its paraxial limit, 1/√(1−(NA/n)²)** | small-angle limit | ✅ |
| **NA ≥ n is refused: no ray of that invariant exists** | ray invariant | ✅ |

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
| The DIN objective's own stop radius survives being re-spelled as its NA | round trip |
| Stop with power on both sides → distinct, finite pupils | smoke |

The two NA round trips are the ones § 1.5.1 caught, and they are kept as round
trips rather than promoted: they now invert the *sine* reading, but they still
invert whatever the resolver did, so what they can catch is an inverted
conversion and nothing about which reading is right. The DIN entry is new and is
filed here deliberately — both sides of it are this repo's, since
`designs/microscope` sizes its stop with the same closed form § 1.5.1 pins
against Abbe. What it is worth is that the two are now **one number**.

### 1.5.1 — an NA is n·sin u, and the arm holds a tangent

The rungs above come from outside the resolver, which is the whole point: the
five aperture spellings had four checks and every one of them round-tripped
`resolveStopRadius` against `pupils`, so none could see a wrong *reading* of the
number it was handed.

Numerical aperture is Abbe's **n·sin u**. The entrance pupil is a plane a finite
arm from the object, so what fills it is `arm·tan u`, and therefore

    EP radius = arm · tan(asin(NA/n)) = arm · (NA/n) / √(1 − (NA/n)²).

Both NA branches instead computed `(NA/n)·arm` — the *paraxial slope*, which is
the small-angle limit of that expression and nothing more. The two disagree by
1/√(1 − (NA/n)²): **0.50% at NA 0.10, 15.5% at 0.50, 3.2× at 0.95**, and 2.6× in
oil at NA 1.4.

**Nothing landed moved, and that is why this sat open as long as it did.** Every
design in `designs/` hands its chain a `stopRadius` and every telescope adapter
an `EPD`, so no rung and no panel reached the branch — ROADMAP said exactly that,
and then **Part E made it false**: the bench editor is a form over all five
spellings, so a reader can re-spell a design's aperture and get a stop 0.5%
narrower for having asked in the currency the design was authored in. The panel
handled it the honest way available at the time, by printing the ratio beside the
pupil (`naSpellingRatio`, pinned at 1.005037815). That caption is now retired,
its app test rewritten to pin the *agreement*, and the disclosure replaced by the
half-angle itself — the panel prints `sin u`, which is what an NA is.

**The traced rung is the one that is about physics.** A closed-form rung pins the
number the resolver must produce, and an algebraic re-derivation of it can pass
for the old code with the definitions shuffled. So the second rung asks what the
ray the engine *actually aims* carries: an axial specimen point in Cargille Type
B under a plane face that is also the stop, `aimRay` to the pupil rim, and
`n·sin u` read off the **direction cosine** with the resolved radius appearing
nowhere in the assertion. An aperture engraved 1.40 delivered **1.028242** — not
a tolerance failure but a different cone, and the discriminator this step is
pinned by.

**The refusal is deliberate and is not a free rider on a one-line fix.**
`sin u = NA/n ≥ 1` has no real u; the old form returned Infinity at the equality
and NaN past it, both of which propagate silently into a stop radius. It is
refused instead, and it is the same sentence § 6l measures from the other end —
an oil objective engraved 1.40 delivering exactly 1.3347 into a water mount,
because no ray of invariant above the medium's index exists. The ceiling was
already in the ladder as a *measurement*; here it is the aperture spec's
precondition. The refusal is about the medium and not the number: NA 1.2 throws
in air and is ordinary in oil, and the rung asserts both.

The correction's own shape is worth one line, because it is the reason the defect
survived every rung: the wrong form is the right form's **limit**, so it is exact
on axis at low aperture and degrades smoothly. There is no aperture at which it
is visibly broken — only apertures at which it is quietly 15% out.

**"Nothing landed moves" is checked at the call sites and not inferred from the
suite**, since a green suite is exactly what the finding says cannot see this.
Two modules in `core` resolve an aperture they did not author. `analysis/focus`'s
`freezeAperture` rewrites any non-`stopRadius` spelling to the radius it
currently resolves to, so a refocus optimises a fixed pupil rather than a moving
one; `pupil/aperture-stop` seeds § 5p's fill competition with `r0 =
resolveStopRadius(...)`, and there a wrong radius would change *which surface
wins*. Both reach the branch only through this function, so both inherit the fix,
and the new refusal is reachable only where the old code returned ∞/NaN into
their arithmetic. Neither constructs an NA spelling itself — which is the same
sentence as before, now with the two places that could have falsified it named.

### 1.5.2 — an aim is a line, and which way it is travelled is separate

`aimRay` built its direction as `normalize(target − origin)`. An entrance pupil
is a paraxial **image** of the stop, so it can be virtual, and a virtual one can
land **behind the object plane** — at which point that difference points away
from the optics and the ray propagates in −z.

**The magnitude was never wrong.** Measured at a stop one picometre past the
front group's back focal plane, the aimed slope agrees with the exact answer to
**12 digits**; the relative error against `stopRadius/f` is `−2.000` exactly,
which is a sign and not an error. So this defect could not produce a plausible
wrong number. What it produced was `traceRay` reporting **`miss`** — a system
whose rays do not reach it — on geometry that is entirely ordinary.

That makes it the **fifth member** of the family APP.md names (§ 5r.1's bracket,
§ 1.6.1's bracket, § 5l.1's dropped declaration, § 6b.5's refusal message): *a
routine that answers confidently for a system it cannot express.* It is the
first to answer with a **status** rather than a number, and that is exactly why
no rung caught it — a `miss` reads as the system's fault, not the aimer's.

**The regime is not exotic.** It is everything approaching object-space
telecentricity from the far side. As the stop crosses the front group's back
focal plane the entrance pupil runs off to +∞, returns from −∞ and walks
forward; while it is further from the optics than the object is, the old
construction fired. The exactly-telecentric case throws a *different* error
("aim in object space instead"), so the two failure modes sat either side of one
boundary and neither pointed at the other.

**"Re-pins nothing" is proved rather than asserted.** The check a green suite
cannot perform was run directly: `aimRay` was made to *throw* on the backward
case and the whole ladder re-run — **75 files, 1310 tests, all passing**. No
system anywhere in the repo aims at an entrance pupil behind its object plane.
A rung states the same thing positively: where the pupil is in front, the
returned direction is **bit-identical** to the expression it replaces.

The fix is that the aim is a **line** — the ray from the object point through
the chosen pupil point — while the direction of travel is object space's, which
is always +z. The line is what is pinned: a virtual pupil sits on the ray's
**backward extension**, so the crossing is asserted at a *negative* path length,
which is what keeps the rung a statement about the line rather than about the
sense. `dz = 0` — the pupil lying in the object plane — is the boundary between
the two orientations and the one position where no ray along the line ever
reaches the optics; it is refused rather than returned as a `miss`.

**The pin with teeth is that the launched ray fills the stop**, since an aim
that points the right way can still point at the wrong place. It does not do so
exactly — `aimRay` targets the *paraxial* pupil — so the honest statement is an
**order**. Halving the aperture, the relative landing error falls

    4.2902, 4.0665, 4.0163, 4.00406, 4.00101, 4.00025

approaching **4 strictly from above**: the absolute error is ∝ stopRadius³, the
leading pupil-aberration term. And the *excess* over 4 is itself ×4 per halving
(4.3605, 4.0825, 4.0202, 4.0050, 4.0013), which names the next term as **fifth
order** instead of leaving it as "some higher order" — two aberration orders
identified from one sweep of the aperture. Both sequences are asserted by their
**shape**, monotone and one-sided, because a value at a step chosen for passing
is not the claim.

One convention is worth writing down, because it makes a correct landing look
wrong: `entrance.radius` is `|m|·stopRadius`, a **magnitude**, so `px = +1` is a
point in *entrance-pupil* coordinates and reaches the stop's **−x** rim wherever
the pupil magnification is negative — which it is throughout this regime. The
sign belongs to the pupil convention, not to the aim.

### 1.5.3 — real ray aiming, and the stop a misalignment moved

§ 1.5.2 ended on an honest limitation: `aimRay` targets the *paraxial* pupil, so
the launched ray fills the stop only to an order — the landing error is
∝ stopRadius³, the leading pupil-aberration term. This step adds the other
option, `rayAiming: "real"` on `OpticalSystem`, which aims at the **stop itself**
by solving for it, and pins what the two modes mean.

**The reason is misalignment, and it is structural rather than a matter of
degree.** In the local coordinate chain a perturbation on surface *i* carries
every surface after it — **the stop included**. So a 0.5 mm decenter upstream
moves the stop 0.5 mm, `pupils()` computes the first-order pupil on the
straight-axis twin that has dropped the decenter entirely, and the aim keeps
pointing at where the stop used to be. **The chief ray misses by very nearly the
whole displacement**, identically at every field, which no aberration would be.
Real aiming lands it: 0.5 mm becomes **1e-11 mm**, and the rim points land on
their own radius to the same bound.

**Pinned to two exact identities**, both statements about optical systems rather
than about this engine, which is what lets them carry the step:

- **A rigid translation is the same instrument.** Decentering surface 0 by *d*
  moves every surface by *d* — asserted directly on the compiled frames — so
  that system *is* the aligned one, moved, and its wavefront must be identical.
  Under real aiming it is, to **3e-12 waves**. Under paraxial aiming it is not:
  **1.5e-4 waves** at 0.5 mm, and the gap grows faster than 50× for a 10× larger
  shift, which is the identity failing rather than the optics changing.
- **A rigid rotation is the same instrument at a shifted field.** Tilting
  surface 0 by β about y turns the whole chain about y, and `fieldDirection` is
  (sin t, 0, cos t) in that same plane, so the turned system at field φ is the
  aligned system at field **φ − β** — exactly, and the other sign is two orders
  of magnitude away.

**The second identity found what the step was not looking for, and it is the
result worth carrying out.** Real aiming makes the translation identity exact
and leaves the rotation identity's raw RMS **as wrong as it was**, because that
residual was never on the entrance side. `opdMap` quotes the wavefront about the
chief ray's point on the *nominal* image plane, and a turned instrument's has
moved — which is piston, tilt and defocus and **nothing else**. Removing those
three drops the residual from ~1e-2 waves to **4.6e-5**, a factor of ~1700. So
the invariant is the **balanced** wavefront — § 5t's `sigmaWaves` currency, and
what Strehl and Maréchal are built on — and `OpdMap.rmsWaves`, which removes
piston alone, **is not a currency a misaligned system may be measured in.**

**Which correction actually mattered, measured, because the opposite was assumed
when the step was begun.** A rigid turn introduces no asymmetry across the field,
so whatever asymmetry the engine reports for one is entirely its own; against a
genuine one-surface tilt of the same size:

| currency | aiming | artifact | signal | ratio |
|---|---|---|---|---|
| raw RMS | paraxial | 9.4e-4 | 3.7e-2 | 39 |
| raw RMS | real | 9.3e-4 | 3.7e-2 | 40 |
| balanced | paraxial | 2.9e-6 | 5.8e-3 | 2021 |
| balanced | real | 1.7e-6 | 5.8e-3 | 3497 |

The artifact lived in the **currency**, not in the aiming: choosing the balanced
one removes ~320× of it and real aiming a further 1.7×. The step's value is
therefore the exact translation identity and pupil coordinates that mean what
they say on a misaligned system — not the artifact, which a currency already
handled. Recorded this way round because a step that kept a wrong reason would
be worse than one that states the right one.

**Not inert on an aligned system either, and the two reasons separate.** On axis
with the stop at the first surface the two modes agree **bitwise** — an on-axis
bundle runs parallel to z and crosses the pupil plane and the curved stop at the
same height. Off axis they do not, because *a pupil plane is not a stop surface*:
the ray is tilted, so the sag displaces it — 2.0 mm of sag at this doublet's rim
times tan(0.3°) is 1.0e-2 mm of pupil, **2.3e-5 waves**. Move the stop to the
last surface and § 1.5.2's pupil aberration adds an order of magnitude on top,
**1.6e-3 waves**, with nothing misaligned at all. That is why the mode is opt-in
per system and defaults to `paraxial`: every rung in this file below here is
written against the paraxial aim, and switching it globally would be a silent
re-baselining rather than a new capability.

**Refusals.** An entrance pupil at infinity (§ 6u's telecentric branch) names a
set of *directions*, so "the point on the stop this coordinate means" is a
different construction rather than a refinement of this one; real aiming throws
there instead of quietly handing back a paraxial ray under the name that was
asked for. A solve that cannot reach its target throws with the best miss it
managed.

**External number.** § 0's fixture carries an **aimed chief ray** for each of the
seven misaligned systems: the launch that reaches a stated surface's own vertex
from a stated direction, solved on the rayoptics side by its own two-variable
Newton around its own raw trace. Two independent solvers over two independent
tracers, agreeing on a target that needs no convention — see § 0.2.

**Not yet pinned.** The **exit side**, deliberately: the reference sphere is
still built on the axial twin's exit pupil and image plane, which the rotation
identity shows costs piston, tilt and defocus and nothing else. Fixing it would
change what every rung in this file quotes and buys 4.6e-5 waves in a currency
that already removes those three terms. **Cost** is measured only as a shape:
real aiming is a few traces per ray against one, with the Jacobian shared across
a whole bundle at one field and wavelength, and no wall-clock figure is claimed.

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

### 1.6.1 — the wavefront solve returns a minimum, not a bracket edge

Every rung above runs on a spherical mirror, where the only aberration is
primary spherical and the two planes the solve involves are locked in the 4/3
ratio those rungs pin. **That ratio is also what sized the search**, and the two
uses are not the same claim. `bestFocus` brackets the wavefront minimum with
twice the distance from the paraxial plane to the *spot* plane; `goldenMin`
assumes the bracket contains the minimum, and when it does not, both its probes
move the same way and it converges on the **edge** — returning it, with its
merit, as though it were a minimum.

A real objective carrying fifth order can balance its transverse aberration
while its wavefront minimum stays put, at which point the estimate collapses
toward zero and brackets nothing. That is not hypothetical and it is not rare:
it is § 6e.4's own 100×/1.40 oil objective looking through a 0.164 mm slip,
refocused § 6e.5's way.

| Rung | Pinned to | Status |
|---|---|---|
| **The estimate COLLAPSES there**: the spot plane is within 0.083 mm of the paraxial one while the wavefront minimum is 1.44 mm away — 17× too narrow | the two planes are different quantities; only third-order theory ties them | ✅ |
| **The solve lands on the scanned minimum anyway**, and no plane in a 350-point scan of its own merit beats it | an independent computation, not a transcribed number | ✅ |
| …and the merit it *reports* is the merit at the plane it *returns*, to 1e-12 | a search may not report a value it never evaluated | ✅ |
| **The edge the collapsed bracket used to return is 3.2× worse** — σ 0.054 against 0.017 waves | what the defect cost, in the currency the app draws | ✅ |
| **IDENTITY: a slip whose bracket does not collapse is unchanged** — same plane, same merit | widening must not perturb a solve that was already right | ✅ |

**How it was found, and why that matters more than the fix.** Nothing in the
ladder caught this. § 6e.5's own sweeps run the solve at every slip thickness
and its rungs are all `toBeLessThan`, which a *worse* σ passes when the bound is
loose enough — and at NA 1.0 and 1.25, where those rungs live, the bracket never
collapses. What found it was **APP.md's A6 drawing the curve**: σ against slip
thickness has a 3.2× spike at one thickness, smooth on either side, converged in
`pupilSamples`, and it looked exactly like physics. This is the fifth time a
surface has found what a rung could afford to ignore (A3's undersampled lobes,
A4's frozen sweep, A5's lattice period, D8's defaulted parameters) — and the
first time the thing it found was wrong rather than merely unsaid.

The fix widens the bracket until the answer is interior, and **throws** if it
cannot after 8 doublings rather than returning its last edge: an undefined
readout is refused, not printed, one layer below where that rule usually
applies. The throw is a backstop with no known trigger — a real system's
wavefront error grows without bound away from focus, so it always brackets
eventually — and is deliberately not pinned, because a rung with a contrived
system behind it would pin the contrivance.

**What moved, checked rather than assumed.** A green suite cannot establish
"no number changed" here, because the looseness that let the defect survive
§ 6e.5 cuts the same way afterwards: most rungs are `toBeLessThan`, which a σ
that *improved* passes silently — and this file's **prose** quotes σ and
best-focus figures that no assertion pins at all. So the widening was
instrumented and the whole suite run to see which files reach it. **Four do**,
and only two are not this fix's own fixtures:

| Where | Doublings | What changed |
|---|---|---|
| § 6e.5 "the delivered NA is SLIP-DEPENDENT" | 1 | **Nothing it pins.** Traced NA is identical to 12 digits at every thickness, and `lost` does not move — the image plane does not clip rays. The σ in that band *does* move (0.03793 → 0.01657 at t = 0.165), and no rung or prose line reads it. |
| § 5j "predicts the traced Zernike coma from S_II" | 1 | **The fifth significant figure.** c8 goes 1.11121600e-1 → 1.11124621e-1, a relative 2.7e-5 against a rung that allows 3% — which is Zernike coma being very nearly orthogonal to defocus, measured. |

So no pinned number and no quoted number moved. § 6e.5's σ rungs are untouched
for a sharper reason than luck: they run at NA 1.0 and 1.25, and the bracket
never collapses there — the instrumentation is silent for that whole test.

### Consistency checks (NOT validation)

| Check | Kind |
|---|---|
| Closed-form best-spot plane beats a scan of neighbouring planes | self-consistency |
| Evaluating a traced bundle at a plane = re-tracing to that plane | round trip |
| Vignetted rays counted, not dropped | bookkeeping |

## Step 1.7 — the paraxial solve: the root a design target names

The first half of ROADMAP's v2+ design-mode entry, and it sits here rather than
at the end of the ladder because of what it generalises: § 1.6 answers "where is
best focus?", and this answers "what does this parameter have to be?". They are
neighbours in the file because they are neighbours in the engine, and they are
**separate modules** because they are not the same problem. `analysis/solve.ts`,
`solve.test.ts`.

### A solve is a root, and a focus solve is a minimum

The roadmap bullet reads "the focus solve is already a solver; generalizing it is
cheap". The cheap part is true and the *generalizing* part is not. `bestFocus`
minimises a merit: no target value, the bottom of a curve, golden section,
bracketed by three points. A design target is a root: g(x) = property(x) − target,
bracketed by two points of opposite sign. Nothing in `bracketedMin` transfers —
and worse than not transferring, a minimiser pointed at a root problem is
*quietly* less precise, because near a simple root |g| is V-shaped and a
minimiser reads a V as flat over an interval ~√ε wide instead of ~ε. So the
solver is a new module, and the damped-least-squares half of design mode — a
merit minimised over several variables at once — is a third thing that is
deliberately **not** landed here. See "Not yet pinned" below for what it is
waiting on, which is a pin and not an implementation.

### The external number, and why it is the inverse rather than the equation

Gullstrand's thick-lens equation, for a lens of index n and axial thickness d in
air (Hecht, *Optics* § 5.2; Smith, *Modern Optical Engineering* § 2.6):

    P = (n−1)(c₁ − c₂) + (d/n)·(n−1)²·c₁·c₂,    f = 1/P
    BFD = f·(1 − (d/n)·(n−1)·c₁)

The equation is not here to check the tracer — § 1 did that. It is here because
it can be **inverted in closed form**, so every rung compares the solver's answer
against an algebraic expression for the same root rather than against the number
it converged to last time. That distinction is the whole reason this step is
landable: an optimiser test that says only "it found something" is regression,
not validation, and this file never has to say it.

The first rung is anti-circularity and runs before any solving: Gullstrand *is*
the engine's own EFL and BFD, three geometries, both properties, agreeing to
**better than 1e-15 relative**. Without it the file could be self-consistently
wrong — a solver agreeing perfectly with an equation the tracer does not obey.

| Solved for | Variable | Inverse | Measured |
|---|---|---|---|
| EFL = 100 mm | thickness | d = (1/f − A)/B | 2.28e-15 relative, and the residual is **exactly 0** |
| EFL = 120 mm | curvature c₂ | c₂ = (1/f − (n−1)c₁)/((d/n)(n−1)²c₁ − (n−1)) | 2.2e-19 absolute; R₂ = +1782.82 mm |
| BFD = 92 mm | thickness | d = (1 − t·A)/(t·B + (n−1)c₁/n) | **bit for bit**; 1.4e-14 mm left on the property |

with A = (n−1)(c₁−c₂) and B = (n−1)²c₁c₂/n. The third is the only nonlinear
target in the set and is pinned as one — its second difference in d is measured
at 1.5e-4 of the value, against the power's, which is **exactly zero** rather
than merely small.

**The first row's 2.28e-15 is not the solver's convergence, and saying so was
the correction this step needed.** The residual is exactly zero: the value the
solver returns and the value the closed form returns are *both* roots to the last
bit, and the 2.28e-15 between them is the closed form's own conditioning. The
reason it can be zero is worth stating because it is not obvious and it decides
what else in this module can be tested at all: the paraxial system matrix is a
product of [[1,0],[−φ,1]] and [[1,t],[0,1]] factors, so it is **affine in any one
curvature or any one thickness** — and so is the power. Brent's first
interpolation step lands on the root of a straight line exactly. Every EFL solve
over the supported variable set is therefore an exact solve, not a converged one.

### The search is an interval the caller states, and multiplicity is reported

A root find needs somewhere to look. Expanding a bracket outward from a seed
returns the first sign change it meets and says nothing about the others — so a
caller asking an equiconvex lens for a focal length gets one of the two
curvatures that deliver it, chosen by the expansion schedule, which is an
implementation detail wearing the clothes of a physical answer. This module
scans a stated interval instead: `roots` carries every root resolved, in
increasing x, and `x` is the one nearest the seed. The caller states the interval
because only the caller knows what is physical.

The multiplicity rung uses the equiconvex constraint c₂ = −c₁ — supplied as a
closure, since nothing in `SolveVariable` couples two surfaces — under which the
power is a downward parabola P(c) = 2(n−1)c − (d/n)(n−1)²c². One system then pins
three separate claims, all against the quadratic formula rather than against the
solver's own output:

- **Two roots for one target.** At f = 2·f_min both curvatures are found —
  0.1074546282 and 0.6262914696 /mm — each matching the closed form to 1e-12, and
  each verified to be a real lens of that focal length rather than merely a number.
- **The seed is the only thing that chooses.** Same interval, same two roots;
  seeding at 0.02 returns the first and at 0.85 the second. The tie-break — ties
  to the smaller x, so the answer is a function of the arguments and not of the
  scan order — is pinned on x² and **not** on the lens, and that is the finding
  rather than a shortcut: the midpoint between the two equiconvex roots is not
  equidistant from them in f64, it misses by an ulp, one root wins on arithmetic
  and the tie-break is never reached. A tie has to be constructed to be tested.
- **A shortest achievable focal length.** The parabola has a vertex at
  c\* = n/(d(n−1)) = 0.3668730489 /mm, so f_min = 5.274261483 mm exists, and a
  target past it is refused with the closest approach *measured* and named — this
  engine refuses a readout it cannot produce rather than returning the nearest edge.

### The pole, which is a root the arithmetic invents

EFL is 1/P, so a system whose power passes through zero has an EFL that runs to
+∞, reappears at −∞, and crosses **every** finite target on the way — with a
genuine sign change, at a place where the property does not take the target value
at all. A bisection dropped in that cell converges neatly onto the pole and
returns it, and the returned number is a perfectly plausible thickness.

Pinned on an air-spaced pair (f ≈ +60 then f ≈ −50) that is afocal at a
**9.0159878 mm** gap: the EFL is negative at 5 mm, positive at 110 mm, and
exceeds 1e4 mm in between, so the pole is demonstrated to be in the interval
before anything is asked of it. (That gap was described here and in the fixture's
own comment as ≈ 9.67 mm until APP.md's Part M measured it — by bisecting the
sign of the power, and confirmed against the value the engine's own refusal
names. No rung asserted it; it was a description of a fixture.) A bare `solveScalar` aimed at the EFL then **refuses**, naming the
crossing it rejected — every candidate is re-checked at its own refined x, and a
residual past `valueTolerance` is an artefact of the sign rather than a root.

`solveParaxial` does better than surviving it: an `efl` target is solved as a
**power** target, 1/efl against 1/value, which turns the pole into an ordinary
zero and leaves no spurious crossing for the guard to find. The same question on
the same system through that entry point meets no pole at all — pinned both ways,
the guard firing on the general call and the specialised one not needing it. The
guard stays because `solveScalar` is public and a caller's own merit may have
poles this module cannot see.

### The blindness the scan buys, measured rather than asserted

A scan cell holding an **even** number of roots shows no sign change across it,
so a pair closer together than one cell is stepped over as if it were not there.
That is the same class of sharp edge as § 1.6's bracket width and it fails the
same way — silently — so it is demonstrated rather than documented and hoped
about. At 0.9995 of the vertex power the two equiconvex roots sit 0.0164 apart:
256 cells over [0.01, 0.9] resolve them both to 1e-6, and 8 cells report the
target as unreachable. The refusal names the resolution it searched at, which is
the only thing that tells "your interval was too coarse" apart from "this lens
cannot do that".

### The wall, which the module claimed and no fixture ran

`evaluate` may throw or go non-finite for an x that is not a system — an afocal
chain has no EFL and the engine says so by throwing — and the module treats that
as a **wall**: the cells touching it are skipped rather than being allowed to
manufacture a sign change against a neighbour. That convention was written down
and then executed by nothing, because every optical fixture in the file is a real
system and `systemProperties` only throws at |u| < 1e-15, which a 64-cell scan
meets with probability zero. A documented sharp edge nobody has run is a
documented guess, so it is pinned on synthetic closures: a root outside a wall is
still found (both when the wall returns NaN and when it throws), a −1/+1 cliff
with nothing in between invents **no** root across it — the pole's mistake
arrived at from the opposite side — and a root lying *inside* a wall is refused
after the refinement walks into it, which is the one path that exercises the
in-bracket fallback.

**The reasoning above is right about the scan and incomplete about what reaches
the wall, and APP.md's Part M is what showed it.** A *scan* meets the wall with
probability zero, exactly as stated. A **refinement aimed at it meets it with
probability one**, because there is an ordinary design question whose root is the
wall: "which value of this variable makes the system afocal?", i.e. a power target
of 0. The two widths are what settle it. `systemProperties` throws at |u| < 1e-15
and u is −1/f, so the hole is exactly where |1/f| < 1e-15; on the pair above the
power moves 3.565e-4 per mm of gap, putting the last gap that is a system at
9.015987757053926 and the first one above it at 9.015987757059541 — a hole
**5.615e-12 mm** wide, against Brent's 8·eps·120 = 2.13e-13 mm, **26× narrower**.
The final bracket therefore fits inside the hole and the candidate fails its own
residual check. The engine answers that
question by refusing — "every sign change was a pole rather than a root" — and
naming the place, which is how the corrected 9.0159878 above was confirmed. So
the wall is reachable from a real optical fixture after all; the synthetic
closures stay, because they exercise three paths this question does not.

### The regression net a general solver gets for free

`huygensEyepiece` runs its own unguarded secant on an overall scale to hit a
target focal length, and § 5o pins the eyepiece it produces. That same
one-parameter family, rebuilt and handed to `solveScalar`, lands on the same
lens: the focal length to 1e-10 mm, and the separation and field-lens focal
length to 1e-9 mm — so the general solver reproduces a bespoke one that was
validated independently. **The three bespoke call sites are deliberately not
refactored onto this module** (`designs/lister.ts`'s coupled fixed point,
`designs/eyepiece.ts`'s secant, `designs/microscope.ts`'s ffd + efl/M iteration).
That is diff churn buying nothing this rung does not already assert, and the
lister one is not even a scalar solve — its geometry moves under the variable.

### Not yet pinned

- ~~**Damped least squares**, which is the rest of design mode.~~ ✅ **landed**
  at [§ 1.8](#step-18--damped-least-squares-the-compromise-a-merit-settles-on).
  Both candidate merits survived contact and both are pinned: the Coddington
  shape factor as a genuine minimisation with a nonzero floor, the achromat's
  power split as a merit that reaches zero on every operand at once. The
  forecast that turned out to be the load-bearing one is the third sentence of
  this bullet — "an optimizer test that only says it converged is regression" —
  because § 1.8 measures a run that reports the gradient test satisfied while
  sitting 400 mm from what was asked for.
- **The unit of `valueTolerance` on an `efl` target.** `solveParaxial` solves an
  EFL target as a POWER target, so a caller's tolerance has to be converted with
  it — |ΔP| = |Δf|/f² — or the same option field would mean mm on a `bfd` target
  and 1/mm on an `efl` one, loosened by f², which is a factor of a million at
  1000 mm. That is fixed by construction and it is **not pinned**, because the
  affineness above makes it unobservable: an exact root passes any guard, in
  either unit, so no fixture in the supported variable set can tell the two
  apart. It becomes testable the moment a target arrives whose solve is not
  exact. **That was expected to be the damped-least-squares item above, and it
  was not:** § 1.8 landed with an inexact optimum and still cannot see this,
  because it is a different module with a different guard — it has no
  `valueTolerance`, it solves power and focal length as two *operands* rather
  than one target converted into the other, and § 1.8's own currency rung says
  what happens when a caller picks the wrong one. The event this is actually
  waiting on is the next bullet, a target beyond first order.
- **Targets beyond first order.** Everything here is a paraxial property, so
  every evaluation is a paraxial trace and 64 scan cells cost nothing. A target
  on a traced quantity — an RMS spot, a Zernike term — changes the cost model
  by four orders of magnitude and wants a different search than a full scan.
- ~~**No surface.**~~ ✅ **closed** — APP.md **Part M**, route `#/design`, app
  wiring only and no rung of its own. What it added that is not above: the
  exactness is in the POWER and a millimetre residual is that ulp times f²
  (measured 1.048576 of the identity at a 1000 mm target, both quantities being
  ulp-quantized); the affineness is visible as **work**, two evaluations past the
  scan against fifty-six for the same question asked at f; there is always
  exactly **one** root through a single prescription number, so the multiplicity
  this step pins needs the coupled closure and not merely a different lens; the
  two equiconvex roots' back focal distances **cancel exactly**, by an algebra
  this file does not state, so only one of the pair is a lens you can put a
  sensor behind; and a single-variable solve **spends the correction** the lens
  was built for, by 29× to 240× on the app's own achromat, which is the measured
  case for the damped-least-squares half.

## Step 1.8 — damped least squares: the compromise a merit settles on

Design mode's second half, and the last solver the engine needs. § 1.7 roots one
property against one target with one variable; this minimises a **weighted sum
of squares** over several variables at once, which is the shape every real design
question has: more wishes than freedoms, so the answer is a compromise rather
than a solution.

The method is Levenberg–Marquardt — Gauss–Newton damped by λ, with λ raised when
a step fails and lowered when it succeeds through Nielsen's gain ratio (Madsen,
Nielsen & Tingleff, *Methods for Non-Linear Least Squares Problems*, 2nd ed.
2004, § 3.2). Lens design has called it damped least squares since Wynne (1959).
The step is solved as an augmented least-squares problem, J stacked on √λ·D^½,
through the same Householder QR the Zernike fit uses — now `math/lsq`, extracted
when the second caller arrived — rather than by forming JᵀJ and squaring the
condition number of a matrix whose columns are parameters in unrelated units.

**The whole difficulty of validating an optimiser is that it can always report
that it converged.** So this step is built entirely on merits whose minimiser is
known in closed form, and one of its rungs is a run that converges, reports the
gradient test satisfied, and is wrong by 400 mm.

### 1.8.1 — the two external numbers

**Coddington's best form**, which is a minimisation with a floor. § 5j.1 pins the
thin-lens W₀₄₀ polynomial in the shape factor q and evaluates its published
minimum at q\* = 2(n²−1)/(n+2). What is pinned here is the other direction: an
optimiser that has never heard of the polynomial, fed nothing but W₀₄₀ values
from `analysis/seidel`, **recovers** the minimiser. A singlet's spherical
aberration has a strictly positive floor (~1.67·10⁻³ mm on this fixture), so the
residual at the optimum is nowhere near zero and the fixture exercises the mode
that separates least squares from a root find.

**The achromat's crown/flint power split** φ₁ = φ·V₁/(V₁−V₂), which is a merit
that reaches zero on *every* operand at once. § 5j.2 already carries the external
numbers. The rung that matters most here is the one that runs before any
optimising: on a two-element prescription of zero thickness both residuals are
**exactly** zero at the textbook split — the power target to the bit, the F−C
difference below 10⁻¹⁷ /mm. A fixture whose "exact" answer were only exact to
O(t/f) would be pinning the thickness rather than the optimiser, and § 5j.2's
refusal to solve the split numerically on a *thick* doublet is the same point:
that would make the headline chromatic rung true by construction.

| Rung | Pinned to | Status |
|---|---|---|
| **The weighted mean.** min (x−1)² + (x−3)² = 2 with merit exactly 2, and weighted 1:3 → 2.8 | arithmetic — fixes what "merit" and "weight" mean before either touches a lens | ✅ |
| **q\* = 2(n²−1)/(n+2) recovered from three starts, at two indices, in both difference schemes** | Jenkins & White / Hecht § 6.3, via § 5j.1's fixture | ✅ |
| …and the W₀₄₀ there is the published one to 1e-8 | the polynomial's absolute scale | ✅ |
| …with a strictly positive floor, and neighbours ±0.01 and ±0.4 in q all higher | it is a minimum, not a root | ✅ |
| **Undamped Gauss–Newton cannot find it** — twelve steps, closest approach 0.073 in q | the method's name, measured | ✅ |
| **Both residuals vanish exactly at the closed-form achromat split** (0, and < 1e-17 /mm) | § 5j.2 closed form — the fixture check the rung depends on | ✅ |
| **φ₁ = φ·V₁/(V₁−V₂) recovered from three starts to 1e-12**, in curvatures and in element powers | § 5j.2 closed form | ✅ |
| …and unchanged over 10⁶ of weight ratio, which is why it can be a pin at all | zero-residual optima are weight-free | ✅ |
| **On a 10/6 mm doublet the same merit picks a 10.3% different lens**, the thin split being 5.6% off in power there | § 5j.2's "prediction, not construction" | ✅ |
| **Marquardt scaling against plain λI**: same answer, 8 iterations against 21 | scale-freedom, on a curvature/thickness pair | ✅ |
| A variable the merit cannot see stays exactly put; a merit no variable can move stops at iteration 1 and reports its residual | rank deficiency, stated not divided by | ✅ |
| **Both S_I-null bendings of a thick doublet found, one per starting basin**, and § 5j.2's Σ\|S_I,ᵢ\| criterion ranks them 0.0199 vs 0.0350 | § 5j.2's pair of roots, found by search | ✅ |
| A domain edge is walked to and reported (boundary to 1e-13, λ → 8·10¹³), a one-sided stencil is used where the other side is a wall, a start on a wall is refused | § 1.7's wall convention, one level up | ✅ |
| An over-determined answer moves 0.68 mm of focal length between two defensible weightings | the units argument, measured | ✅ |
| Refusals: a variable listed twice, a zero weight, a non-finite target or start, a residual vector that changes length, a step count that does not match | validity | ✅ |

### 1.8.2 — why the two Coddington tolerances differ by seven orders of magnitude

The shape is pinned to 1e-7 and the aberration at that shape to 1e-15, and that
is the honest way round rather than a hedge. Near a minimum the merit is
quadratic, m(q) ≈ m\* + ½m″(q−q\*)², so an optimiser that resolves the merit to a
relative ε resolves q only to √(2ε·m\* / m″). The square root is the shape of a
minimum, not a weakness of this implementation, and the step pins it twice:
measured 2.2·10⁻⁸ in q against 4.4·10⁻¹⁶ in W₀₄₀ on the optical fixture, and —
on the weighted-mean rung, where every quantity is exact algebra — a merit right
to all 17 digits with the location out at 3·10⁻¹⁰.

The corollary is the one to carry into any future merit: **the value is what an
optimiser knows; the design is what it guesses.** Two lenses whose merits agree
to the last bit can differ in the sixth digit of a curvature.

### 1.8.3 — the currency finding, which is § 1.7's pole with teeth

§ 1.7 found that an EFL target hides a pole a bisection converges *onto*, and
solves power instead so the pole is not there to be found. One level up the same
choice decides whether the answer is reachable at all.

A doublet starting at −76.5 mm EFL, asked for +150 mm, with an afocal
configuration in between. In **power** the optimiser is exact in five iterations.
In **millimetres of focal length** it slides the other way, to EFL → 0, and stops
with the gradient test satisfied at a merit of 2.25·10⁴ — 150 mm from what was
asked. 1/f runs to ±∞ between the start and the target, so the merit has a
barrier of infinite height there, and a downhill method does not cross barriers.

**And it never touches the wall it failed to cross.** The intuition is that the
afocal configuration throws and a step gets rejected; measured, zero steps are
rejected and the residual function never throws once. The wall is uphill, so the
optimiser is never near it. The failure is a barrier, not an exception — which is
why the guard § 1.7 needed is not the guard this module needs, and why `power` is
an operand kind at all.

The rung that says this out loud: `reason: "gradient"` with `residuals: [−400]`.
A converged optimiser is not a correct one, and the residuals are reported so a
caller can tell the difference.

### 1.8.4 — what least squares gives up, stated rather than discovered

- **Multiplicity.** § 1.7 scans an interval and reports every root it resolved,
  because a target reachable two ways should say so. A descent method reports the
  basin it started in. Measured on three curvatures against three wishes — hold
  the power, hold the colour, null S_I — where two starts land on one bending and
  the third lands on the other, both satisfying all three wishes to the f64
  floor. § 5j.2's branch criterion, Σ|S_I,ᵢ|, then ranks roots this file found by
  *search* the same way it ranked the ones § 5j solved by algebra.
- **The gradient test is an angle, not a distance.** It measures the cosine
  between the residual vector and each Jacobian column, which makes it scale-free
  — immune to a change of weight, unit or overall merit scale — and also blind on
  a single-operand merit, where the cosine is identically 1 until the residual is
  zero. The Coddington runs therefore always stop on `merit` or `step`. Pinned
  so that nobody later reads a gradient of 1 as a failure and "fixes" the
  tolerance.
- **Weights are an exchange rate nothing physical fixes.** Where residuals do not
  all vanish, the optimum is a statement about how many diopters a millimetre is
  worth. Measured: 0.68 mm of focal length between two defensible weightings of
  the same two wishes. Both headline rungs are weight-independent by
  construction, and that is not a convenience of the fixtures — it is what makes
  them pinnable.
- **Surplus freedom goes into the shortest step.** Two variables against one
  operand is not a refusal: the damping picks the smallest move that satisfies
  it, and both variables move by comparable amounts rather than one being held.

### Not yet pinned

- **Targets on traced quantities.** Every operand here is paraxial or
  third-order, so a residual evaluation is a paraxial trace and the whole file
  runs in 24 ms. An RMS spot or a Zernike term as an operand is the same
  optimiser with a residual four orders of magnitude more expensive, and it
  changes what the finite-difference step should be — a merit built on a traced
  quantity carries sampling noise, and differencing noise is how an optimiser
  is made to chase its own tail.
- **Constraints, as opposed to heavily weighted operands.** "Hold the power
  *exactly* while minimising aberration" is a Lagrange condition, not a residual
  with a big weight, and the difference is measurable: a weighted constraint is
  satisfied only to O(1/w). The achromat rung avoids it by using a fixture where
  the constraint and the objective vanish together.
- **The step's own scaling.** `steps` defaults to εʰ·max(|xⱼ|, 1), and the floor
  of 1 is a unit assumption — right for a curvature in 1/mm and a thickness in mm
  because both are O(1) in this engine's units, and stated in the option's own
  documentation rather than pinned by a rung.

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
drifting afterwards. Three statistics are reported and **two of them are the
gate** — 2/255 on any channel, 0.05/255 on the mean — because the two fail
differently: a one-pixel centring slip moves almost nothing except the max,
while a re-scaled exposure moves everything a little and nothing past the max's
tolerance, so the mean is the whole of that catch. The fraction of changed
pixels is a *diagnostic*, telling a reader whether a failure is one pixel or
half the frame; it is not a threshold, and measurement is why. It counts pixels
moving by 2/255 or more, and 2.5% of a frame doing that has already moved the
mean past 0.05 — there is no gap for it to cover. This paragraph used to claim
all three were compared; the code never did, and the code was right.

The harness carries a negative control at both levels. **The fixture's** asserts
the two goldens are not the same image, which is exactly what a copy-paste slip
would otherwise produce silently. **The gate's** — added later, and the more
easily forgotten of the two — damages the committed goldens deliberately and
asserts the gate rejects the damage, because a tolerance quietly too loose makes
every golden in the repo pass forever while proving nothing. It records what the
gate can and cannot see, measured rather than hoped:

| Defect, applied to a committed golden | Reads | Caught by |
|---|---|---|
| One-pixel shift | max 255, mean 1.32 | the max |
| Exposure +0.5% | max 1, mean 0.063 | the mean *alone* |
| Exposure +0.2% | max 1, mean 0.001 | **nothing — the floor** |
| Transposed axes, hero star | **max 0** | **nothing — see below** |
| Transposed axes, star field | max 255, mean 3.2 | both |

Two of those rows are the reason the table is here. The exposure floor is real:
a drift under ~0.2% is below the level at which a reference render can tell a
change from a platform's last float bit, and tightening the gate to chase it
would buy an intermittent rather than a catch. And **the hero goldens are blind
to a transposed grid** — an on-axis PSF of a rotationally symmetric system *is*
its own transpose, so swapping the axes returns the identical image and would go
on doing so however many on-axis goldens were added. The star field is what
covers that class, which is the argument for it existing: not a third pretty
picture, a defect the other two structurally cannot see.

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
| Cost is exactly **distinct patch radii** × wavelengths — 5 over the 1/2/4 ladder, not 21 | cost model | ✅ |
| **The radius cache is bit for bit the uncached render**, every channel of every pixel | `toBe`, not a tolerance | ✅ |
| An odd finest grid gets its 1×1 preview for nothing (4 radii over 1/2/3, not 14) | axis is a patch centre | ✅ |
| `onPsf` reaches its own stated total — cost accounting, not a progress bar | the total was unreachable | ✅ |
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

### 3c.1 — the cost model was wrong, and it was wrong in the render's favour

**"Cost is patches × wavelengths" was never true, and the code was paying it
anyway.** A p×p grid has p² patches but far fewer distinct field *radii*: the
centres are the pairs drawn from ⌈p/2⌉ distances off each axis, so 2×2 has
**one** radius, 3×3 and 4×4 have **three**. Everything at one radius gets the
same PSF. The render was tracing sixteen stacks where three would do.

**And the licence to share them was one the render had already spent.** The
engine's field spec is a single scalar, so a PSF is always traced on the +x axis
and turned to the patch's own azimuth by `rotateKernel` — which *is* the claim
that the PSF is a function of radius alone, made in the same place since step 4
and granted by the prescription's axial symmetry. What the cache changes is how
many times that claim is evaluated, not what is claimed. So this rung is not a
new approximation with a tolerance: `fieldAngleFor` and `spectralStack` are
deterministic, a reused stack is bitwise the stack the recomputation would have
built, and the equivalence is asserted with `toBe` on every channel of every
pixel of a 4×4 render. `psfCache: false` exists to be that reference, the way
§ 6p's uncached path exists to be its own — a cache whose claim is exactness has
to be able to be turned off, or the claim is the header's opinion.

The saving is stated as an integer for § 6p's reason, wall clocks being a
property of the machine: **21 stacks over the 1/2/4 ladder become 5, and 14 over
1/2/3 become 4.** The second number carries a small finding of its own — the
axis is a patch centre of every **odd** grid, so radius 0 is already in the
finest level's set and the 1×1 preview that begins the refinement costs *nothing
at all*. An even grid has no patch on the axis and its preview does cost one.

**The key is the radius itself, and that under-collapses at 5, 6 and 7
patches.** Keying on the computed `radiusMm` is what keeps the render bitwise
what it was — deriving the radius from canonical integer magnitudes instead
would group perfectly but perturb the value by an ulp and forfeit the identity
that makes this a cache rather than a change. The price is that two mirrored
centres only share a key where their offsets negate *exactly* in floating point,
which holds at 1, 2, 3, 4 and 8 and fails at 5, 6 and 7: measured, those give
**8, 11 and 13** buckets where the ⌈p/2⌉ rule predicts 6, 6 and 10. Nothing
offers a count in that range — the panels stop at 4 — so the rule above is what
ships, but it is the rule for the geometry and not a guarantee about the key.

**It also holds every distinct stack for the whole render**, where each was
previously garbage the moment its patch was done. That is distinct radii ×
wavelengths × n² doubles: a few MB for the sky disc (n = 128, 5 wavelengths) and
~24 MB for the star field at 9. Affordable at every setting on offer, and the
term to watch if a caller ever raises the grid and the wavelength count
together.

**Two things this corrects that were written down.** The ladder's comment said
the levels were powers of two so that a level's centres would be a superset of
the one below, "which is what would let a cache reuse them" — they are not:
4×4's centres sit at ¼ and ¾ of the half-frame and 2×2's at ½, and the two
levels share no radius but the axis. The ladder is worth keeping for what it
shows the viewer, not for a nesting it does not have. And the header's "the PSF
dominates — *that* is the number progressive refinement exists to hide, not the
convolutions" is now the wrong way round, which is the more interesting
correction: measured, the PSF term was **59–66%** of a render, so removing four
fifths of it leaves a render that is *mostly convolution*. The next saving on
this path is a cheaper transform, not a cheaper trace.

**End to end, through both app surfaces that call it** (median of three warm runs
in node, 200 mm f/8, pupilSamples 32, 5 wavelengths), before against after: the
sky disc on an achromat 3704 → 1936 ms at 2 patches, 6757 → 3332 at 3, 12659 →
4095 at 4; the star field 1816 → 994, 4326 → 1690, 5796 → 2074. Roughly 2×,
growing with the grid, and short of the 4.2× the stack count falls by for the
reason above. At 1 patch the two builds measured 92 against 94 ms and 1254
against 1277 — the identity as a null, and the check that both columns are the
same measurement on the same day.

*Superseded at 3 and 4 patches by § 3c.2*, which drops the levels between the
preview and the finish — so both right-hand figures above are now ladders this
render no longer walks. The 1- and 2-patch numbers stand, since that ladder is
unchanged.

**The one invariant the cache introduces**, recorded because nothing enforces
it: a cached stack's arrays are now shared, so nothing downstream may write into
them. `rotateKernel` returns its input **by reference** at azimuth 0, a path
several patches can reach, and what keeps that safe is only that
`convolveCentred` copies before transforming. An in-place normalization added
below would corrupt every later patch at the same radius — and would do it as a
gradient across the frame, which is the shape of defect this step already has
three entries for.

*Not done here, deliberately:* emitting partial frames inside the finest level,
which would break the rung above it — a half-accumulated level is missing the
light of the patches not yet summed — and rendering coarse levels at fewer
wavelengths, which would preview in a different colour from the one it finishes
in, since the colour basis is built once from the first stack's samples.

That second one is a live limit rather than a hypothetical, and driving the sky
panel in a browser is what showed it. Watched frame by frame on the achromat at
3 patches, the ladder lands at **2.1 s, 3.3 s and 5.6 s** — so the 1×1 preview
the header calls "near-instant" is *two seconds*, because a traced doublet stack
costs ~0.4 s a wavelength and the preview pays for five. The radius cache is no
help there by construction: one patch has one radius and there is nothing to
share. Fewer wavelengths at the coarse level is the only lever left, and it
costs a colour shift mid-refinement — which is the worse artifact, and is why
the preview stays slow and honest rather than fast and differently coloured.

### 3c.2 — the ladder was carrying levels nobody looks at and nothing reuses

**§ 3c.1 wrote down the fact and left the ladder alone.** Its own correction says
the doubling levels do not nest — "4×4's centres sit at ¼ and ¾ of the half-frame
and 2×2's at ½, and the two levels share no radius but the axis" — and concludes
the ladder is "worth keeping for what it shows the viewer, not for a nesting it
does not have". That is right about the 1×1 preview and wrong about everything
between it and the finish. After the radius cache a level costs the **radii it
adds**, and an intermediate level adds radii the finished picture never asks
for: all four of 2×2's centres sit at √2/2 of the half-extent, a distance no
other grid puts a patch at. So the 2×2 level is a trace set spent on a field
angle that is computed, drawn once, and thrown away.

**The default ladder is now the 1×1 preview and then `patches`, with nothing
between** (`refinement: "preview"`; `"doubling"` survives as the reference this
rung measures against, exactly as `psfCache: false` does). Counted in radii,
doubling against the new default: `finest` 2 costs 2 either way — **the same
ladder, which is why the sky panel's default setting is untouched by this** — and
3 costs 4 against 3, 4 costs 5 against 4.

**The identity that makes dropping a level safe was unpinned until now, and it
is the rung that matters.** A level is not a partial accumulation on the way to
the finest one; it is exactly what `renderField` returns when asked for that
patch count alone. Pinned with `toBe` per element: the 1×1 frame emitted while
refining to 3×3 **is** the standalone `patches: 1` render, bit for bit. Anything
weaker would mean the ladder carries state between its levels, and then removing
a level would be a change to the finished image rather than to the wait.

**Measured** on the star-field scene, median of three warm runs in node, as
first frame / final, doubling against preview. At 200 mm f/8, pupilSamples 32,
5 wavelengths: `finest` 2 is 103 / 239 ms against 100 / 239 — the identity
showing up as a null; 3 is 102 / 525 against 99 / 388; 4 is 107 / 694 against
100 / 562. The first frame never moves and the finished image lands **26% and
19%** sooner. Through the sky panel in the browser, where that panel's label is
priced, 3 patches went 605 → 501 ms on the mirror and 5456 → 4279 on the
doublet.

**That system is not the one the star panel ships, and the difference is 5×.**
`panels/telescope.tsx` runs a 100 mm f/10 at **pupilSamples 64 and 9
wavelengths** — a 256² grid — where the same three settings read 311 / 1023
against 329 / 1034, 347 / 2776 against 329 / 2051, and 342 / 4183 against
343 / 3410. Same ratios, five times the clock. It is recorded because the
hero-image decision below was taken on the smaller numbers, and they understated
what a reader waits by that factor; the decision does not turn on it, and if
anything the preview earns its trace set more easily at four seconds than at
one. **Driven in the browser too**, which is this document's own standard and
the check a rung cannot make: the panel paints the 1×1 preview at **1.23 s** and
the finished 4×4 at **4.80 s**, two frames where there used to be three, and the
backpressure hook releases its queue on the last of them as it should.

**Two cheaper ladders were measured and declined, and the second is the
interesting one.** Dropping the preview wherever it is *not* free — no 1×1 at an
even `finest`, since the axis is a patch centre of no even grid — saves another
radius at 2 and at 4, and was declined as a product decision: it removes the
feature rather than tuning it, and the star field is the app's hero image, where
it would trade something on screen at ~0.2 s for a blank panel until ~0.8 s. And
a 1×1 level whose kernel is the finest grid's **smallest** radius rather than the
axis would cost no trace at any parity — 3 radii at `finest` 4, beating every row
above. That one is declined on a harder ground than cost: it is not a render
anyone can ask for. `onRefinement`'s contract is that a level is complete and
correct *at its own patch count*, which is what the identity rung pins and what
makes a frame safe to put on screen. A frame formed by applying an off-axis
kernel to the whole field answers no call to this function, so nothing could
check it against anything, and the panel's `1×1 → 4×4` readout would name a grid
that was not what was drawn.

**The parity cuts both ways, and the second half is new.** § 3c.1 records that an
odd grid gets its preview free. It does not follow that a caller should prefer
one: an odd grid also spends a patch centred on the axis, where the PSF varies
least. Measured against a converged 8×8 reference on this scene, in the sRGB
bytes the panel actually draws, **3×3 is worse than 2×2** — worst pixel 101
display levels against 91, rms 2.08 against 1.99 — while 4×4 reaches 47 and 1.01
and 6×6 reaches 13 and 0.43. That is why the star field keeps 4 patches and pays
one trace set for its preview rather than dropping to 3 to get it free.

**One cost fact found on the way, and not chased further.** The same bench run on
the *singlet* reads ~5× the achromat's per-stack cost — 478 ms against 92 — which
is the opposite of every other cost note here, since the doublet is normally the
expensive one. It is not a mystery and not the ladder: `adaptivePsf` forms the
diffraction PSF, and where the wavefront's phase step per pupil sample is past
the limit it forms the **geometric ray histogram as well** and blends. The
singlet reads 1.208 waves per sample and the achromat 0.005, so the singlet runs
at `geometricWeight` 1.0 and pays both branches — 97 ms against 4 at one
wavelength — while the achromat never leaves the diffraction one. Worth
recording twice over: no app surface renders a singlet *field*, so nothing is
owed here; and at weight exactly 1 the diffraction PSF is computed and then
entirely discarded, which is ~9% of that path available to whoever needs it.

### 3c.3 — the criterion was known one step before it was read

**§ 3c.2's closing paragraph recorded the waste and mis-stated its reach.** It
says that at weight exactly 1 "the diffraction PSF is computed and then entirely
discarded, which is ~9% of that path available to whoever needs it" — the last
clause implying nobody shipped does. Two panels do, and one of them reaches
weight 1 at half its aperture slider's travel. On the star panel's own defaults
with the aperture at its maximum 20 mm, the **singlet** canvas runs 3 of its 9
wavelength planes at weight exactly 1 and 2 more inside the band (417, 450 and
483 nm read phase steps of 2.24, 1.62 and 0.99 against the 0.65 the band ends
at). The tolerance panel is worse: at `pupilSamples` 32 the criterion is twice as
large for the same wavefront, so its singlet at 20 mm runs 3 of its 5 planes at
weight 1 — and it renders **two** stacks per job, nominal and perturbed. The
achromat never leaves weight 0 at any aperture the panels offer, which is why
this was invisible: the lens the app is built around does not reach it.

**Why the transform can be skipped at all is a fact about where the criterion is
measured.** `wave/fidelity` takes it from differences between neighbouring
TRACED samples, not from the fitted wavefront on the FFT grid — § 2d's reasoning,
that a Zernike fit is smooth whatever it was fitted to. So the criterion is
settled when `systemPupil` returns, one step before any transform exists.
`adaptivePsf` was asking `psf()` for it, which forms the transform to hand back
the `sampling` that was decided before it started. At weight 1 the discarded
array is not merely unused work: the criterion has just ruled that an FFT on this
pupil grid is aliasing rather than diffraction, so the module spends 18 ms
computing something it has itself declared invalid here.

**`psf()` is now `systemPupil` + `psfFromSystemPupil`**, split for the mirror
image of the reason `systemPupil` was split out. That one exists so a caller with
many transforms of one traced system does not re-trace (the long-exposure seeing
average); this one exists so a caller that must see the sampling *before* it
knows whether it wants a transform can stop there. The seeing screen's wavelength
now comes off `scale` rather than a parameter, so it cannot be applied at a
wavelength the pupil was not traced at.

**The rungs are identities against the old composition written out verbatim,**
one per regime, since the claim is that this is a change of order and nothing
else. `toEqual` over the whole returned object — every element of a 65 536-sample
`Float64Array`, and the presence or absence of the optional fields — plus an
`Object.keys` comparison, because `toEqual` is order-blind and a caller's own
spread is not. Damage table, by breaking the new path deliberately: handing the
transform a pupil traced at 15 samples instead of 21 fails weight 0 and the
blend and leaves weight 1 green (it uses neither), and dropping `sampling` from
the weight-0 return fails weight 0 alone.

**The witness that no transform is formed is a grid the FFT refuses.** A timing
is not evidence and a discarded array leaves no trace, so the check is made
observable instead: `psfFromPupilFunction` throws on a side that is not a power
of two and the ray histogram has no such constraint, so at `padFactor` 3 the old
order threw and the new order returns a picture. That is also **the one
behavioural difference this change introduces**, stated rather than left to be
discovered: `adaptivePsf` now accepts a grid the FFT cannot take, on the branch
that never needed the FFT. It stops being a witness — rather than starting to
fail — if `fft2d` ever handles arbitrary sizes, at which point the throw beside
it is what says so.

**Measured, and the honest part is what could not be resolved.** The work
removed is exactly the transform: 18–21 ms on the star panel's 256² grid, 5.8–6.0
on the tolerance panel's 128², medians of 15 interleaved reps. End to end the
difference is consistent with that and no tighter — 21–43 ms measured at 256²
and 3.7–4.1 at 128² — because what remains is the ray histogram, whose own
p10–p90 spread is 14–68 ms and therefore **larger than the thing being
measured**. A first attempt at 5 reps put the frame-level saving at 0.7% with
individual planes reading negative, which is the number a reader would get by
running it once. In frame terms the arithmetic is ~3%: three planes × ~19 ms
against a 1.74 s star frame, and six × ~6 ms against a 0.92 s tolerance job.
Zero on every other configuration the panels can be put in, because no plane
leaves weight 0.

**One duplicate measured and deliberately left.** `geometricPsf` traces and fits
its own OPD map, so at any weight above 0 the pupil work happens twice. It is
2.0 ms against that branch's own 378–481, and threading a traced map through a
public signature to recover 0.5% is the worse trade — `geometricPsf` is exported
and used standalone. Recorded here so the duplicate reads as a decision.

**A fixture was found covering nothing, by the rung that asserts its own
regime.** The energy rung beside this one ran three offsets under the name "whichever
branch it lands on", and the middle one — `R/2 − 0.3` — lands at weight **0**
(phase step 0.150 against the band's 0.35), so the blend was never exercised by
it. `R/2 − 1` reads 0.498 and blends 0.490 of ray. The regime assertions are
written to fail rather than pass when a fixture drifts out of the band it exists
to cover, which is how this surfaced.

**Not chased, and worth writing down: the bottom edge of the band is expensive.**
The singlet at 20 mm and 550 nm reads a phase step of 0.3528, which is 0.0028
past the band's start and gives a geometric share of **2.6e-4**. That plane costs
187 ms against a weight-0 plane's 19, because any weight above zero pays the
whole ray histogram — ~168 ms for 0.03% of the picture. The blend's smoothness is
the point of the band (§ 2d) and a threshold on cost would put a visible step
back into a slider drag, so this is a note rather than a proposal.

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

Every rung in this step compares the fold to a closed form or to its own
straightened twin — both internal arguments. **§ 0.3 has since added the
external one**: the same convention against rayoptics 0.9.9, which reconciles by
one z-flip per mirror and, on the rule itself, disagrees with this engine in
exactly one case and is settled by its own ray trace in this engine's favour.

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
  [§ 6ac](#step-6ac--the-two-focal-surfaces-and-distortion) closes this on a
  spherical refractor and **cannot** close it here: its closed-form half runs
  through `seidelSums`, which refuses a conic outright, so a paraboloid has no
  third-order cross-check to be measured against. What § 6ac does add is the
  traced readout — both focal surfaces of this mirror are now one call away, and
  what is missing is the external number, not the measurement.

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

### § 5d.1 — the long exposure becomes an API, and runs on a real system

The first half of that "named next" is now closed, and the shape of the gap is
worth stating because it is a kind this ladder had not had: **the physics was
pinned and the machinery that produces it was unreachable.** `seeingEnsemble`
lived inside `seeing.test.ts`, closed over that file's aperture, grid and flat
pupil, with no export anywhere — so every long-exposure number in this section
was true and nothing outside the test could ask for one. An app could show a
single speckle draw and say so (which is what it did), and no more.

`longExposurePsf` (`wave/long-exposure`) is that helper promoted. Two mechanical
notes, both load-bearing. It is a **separate module** from `seeing.ts` because
`psf.ts` imports `withPhaseScreen` as a value while `seeing.ts` imports from
`psf.ts` as a *type only* — a back-edge that must keep erasing — and the ensemble
needs `psfFromPupilFunction` as a value. And it takes a **pupil**, not a system,
because a long exposure is many atmospheres over one instrument: going through
`psf({seeing})` would re-trace, re-fit and rebuild the vignette mask per screen
for a result that cannot change. `systemPupil()` was split out of `psf()` for
that, and `psf()` now calls it, so there is one definition of a system's pupil
rather than two.

| Rung | Pinned to | Status |
|---|---|---|
| **Every § 5d ensemble rung passes unchanged, at the same seeds and the same bands** | the promotion is a move, not a rewrite | ✅ |
| `screens: 1` is `psfFromPupilFunction(withPhaseScreen(…))` **bit-identical** | no special path at the degenerate case | ✅ |
| **The atmospheric MTF against exp(−3.44·(ν·D/r₀)^(5/3)) evaluated forward, no fitting** | Fried, the same law the r₀_eff rung inverts | ✅ |
| **A draw's FWHM spans 5.3× over five seeds; a 30-screen mean is stable to 7.5%** | a realisation is a random variable and a mean is not | ✅ |
| ...and a draw peaks at ~0.31 of the diffraction peak where the 120-screen mean peaks at ~0.06 | speckle core vs seeing disc | ✅ |
| **r₀_eff comes back on a REAL traced achromat's pupil, not only on a flat one** | the atmospheric MTF is a ratio, so the instrument divides out | ✅ |
| A non-integer or non-positive screen count is refused | it is an ensemble size, not a weight | ✅ |

The **traced-system** rung is the one the test-local helper could not carry, and
it is the claim an app surface rests on: the helper closed over a *flat pupil*,
so every long-exposure number this ladder had was measured on a perfect
aperture. A 200 mm f/8 achromat has a fifth-order spherical residual of its own
and its pupil is a Zernike fit of a traced wavefront rather than a mathematical
disc — and Fried's r₀ still comes back inside the documented band, because the
atmospheric MTF is a **ratio against the same instrument** and the system divides
out. The rung asserts the instrument really is aberrated (Strehl strictly under
1) before asserting the recovery, or it would silently be the flat-pupil rung
again.

The **variance** rung replaced a first draft that asserted a single screen is
*narrower* than the mean — a guess about magnitude standing in for the claim.
The claim is about spread, not centre: one screen's FWHM runs 12.3 to 65.3 px
over five seeds while a mean over only thirty is stable to 7.5% between disjoint
seed sets. That is why this is **compute-once and never a live dial**, and it is
the sentence APP.md's C6 surface exists to make visible.

Cost is unchanged and irreducible: the low-order wander converges as 1/√N, so
120 screens is ~8 s and these rungs remain the heaviest in the suite. Note also,
from § 5d's own convergence warning seen again here: two 30-screen means land at
12.5 and 13.5 px where 120 screens gives 15.5, so the mean is still *climbing* at
30 — a cheap ensemble is biased narrow rather than merely noisy.

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
  [§ 6ac](#step-6ac--the-two-focal-surfaces-and-distortion)'s traced readout
  reaches this system; its third-order anchor does not, the mirrors being conics.
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
  Same split as the Cassegrain after
  [§ 6ac](#step-6ac--the-two-focal-surfaces-and-distortion): measurable now,
  still without a closed form to be measured against, because the surfaces are
  conics.
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
  [§ 6ac](#step-6ac--the-two-focal-surfaces-and-distortion) does not change this
  one at all, and the corrector fails its preconditions twice over: it is an
  asphere, which `seidelSums` refuses, and it is a FLAT in a collimated beam,
  which is precisely the A = 0 surface that makes the classical distortion term
  0/0. The stop being surface 0 — it is, the corrector sits at the primary's
  centre of curvature — is the one precondition this system does meet.
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
optimises); astigmatism and field curvature are traced and **now pinned, on this
very lens** — [§ 6ac](#step-6ac--the-two-focal-surfaces-and-distortion) measures
both focal surfaces here and reproduces the third-order closed form to 0.04% and
0.09%. Uncorrected, not unmeasured: an achromat is not an anastigmat, and the
tangential surface sits 1.44 mm inside focus at 1.6° off axis.
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

### § 5l.1 — the on-axis splice may not swallow a folded module

The defect APP.md's C5 surface exposed, and it is the third of its shape after
A6's collapsing focus bracket (§ 1.6.1) and C4's FOV bracket (§ 5r.1): a routine
that **answers** for a system it cannot express, in the one place the ladder
could not see.

The mechanism is a dropped declaration. `ModulePlacement` carries *surfaces*,
not a `Prescription`, so a module's `mirrorFrames` never reaches
`spliceModules` — and the flat chain it returns therefore carries no declaration
at all, i.e. the default `unfolded`. Splice a folded module and the *tilt*
survives onto that chain while the *frame* does not. The exact tracer then walks
a 90° bend, and every first-order layer reads the numbers of a straight chain,
because `unfoldedTwin` is what drops tilts and it is never reached. Neither
frame, no announcement.

| Rung | Pinned to | Status |
|---|---|---|
| **A Newtonian objective is refused by the splice, naming the tilted surface** | § 4b's own diagonal, `tiltXDeg: 45` | ✅ |
| ...and by `afocalTelescope` on the **declaration**, which a tilt-free folded chain would need | `isFolded`, the only level that has it | ✅ |
| **What it answered instead: a 1405 mm afocal gap where the geometry has ~131 mm** | § 4b's focus offset + the eyepiece's FFD | ✅ |
| **The same optics UNFOLDED still composes, and still gives M = −f_o/f_e** | § 5l's own magnification rung, on a Cassegrain of equal D and f | ✅ |
| Every existing splice and composition is byte-identical | non-regression — no other design in the repo is `folded` | ✅ |

The wrong number is pinned rather than only the throw, and that is the point of
the section: "it refuses now" is a statement about the code, while "it used to
answer 1405 mm where the geometry has 131" is a statement about how far wrong
silence was. The reconstruction is done in the test from the parts the guard now
stops — a paraxial gap solve on a chain whose thicknesses are folded-frame
distances, i.e. positive after the primary where the unfolded convention
(`n′ = −n`, § 4a) needs them negative.

The **unfolded control** is what makes this a statement about the fold and not
about mirrors: a classical Cassegrain of the same aperture and system focal
length has two *powered* mirrors, no tilt anywhere, and composes into an afocal
telescope that lands on § 5l's magnification rung unchanged. That is why C5's
objective list has a Cassegrain in it and no Newtonian.

Composing a **folded** module remains the step-6 generalisation `compose.ts`'s
header has named from the start — placement frames, not a wider splice. What
changed is that asking for it now fails loudly.

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
| **A vignetting-limited system still has a FOV, and its refusal boundary is § 2f's wall** | § 2f closed form | ✅ |
| ...the fix is a no-op where the old bracket worked, and a paraboloid's FOV is exactly paraxial | negative control | ✅ |

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

### § 5r.1 — the FOV bracket may not start outside the system's own field

An engine defect none of the rungs above could see, found by driving APP.md's C4
camera panel and fixed in the same change. It is the second of its kind and the
same kind as the first: A6 found `bestFocus`'s golden-section **bracket estimate**
collapsing (§ 1.6.1), and this is a bracket that starts in the wrong place.

`fieldAngleAtImageRadius` probed the traced chief-ray map at a fixed 0.5° and
doubled *upward*. That silently assumes every system passes at least half a
degree, and a **folded** one need not: § 2f's diagonal wall stops a Newtonian's
chief ray at a fraction of a degree — 0.346° at f/10 — so `imagePointOf` threw
and the whole sensor's geometry was refused, **for sensors whose answer was a
tenth of that angle and perfectly well defined**. An APS-C frame on a 2000 mm
f/10 Newtonian spans 0.67°, i.e. ±0.34°, comfortably inside the wall.

So the defect was a **bracket artifact presented as a physical wall**, and the
two must not be confusable: one is an implementation detail and the other is
geometry. Every rung above runs on the unfolded achromat, where the 0.5° probe
always landed inside, which is exactly why none of them reddened — the same
shape of blindness § 5r's own centroid rung exists to fix.

The fix treats a failed chief ray as **data rather than as an error**: `null`
means "this angle is past the field", which for the search is the same side of
the answer as "this angle overshoots the radius", so both send `hi` down. The
probe shrinks before it grows. The bisection body needs the guard as much as the
bracket does — without it the crash moves rather than disappears, since a `mid`
can land past the wall at any iteration. A genuine refusal survives and is now
*separable*: after converging, the returned angle must actually reach the
requested radius, and where the sensor is larger than the field the trace passes,
it does not.

The pin is **external and is not the guard restated**: the boundary between
"answers" and "refuses" is found by bisecting `fieldOfView`'s own transition —
the engine never sees a closed form — and must land on § 2f's

    tan θ_max = (√2·k/2) / [ (F − ½ − 1/(16F)) · (F − k) ]

which it does to **4e-6** at f/8, f/10 and f/15. Drop the 1/(16F) sag term and
the rung reddens, so it is a cross-check of § 4b's diagonal sizing rather than a
restatement of it. Two controls sit beside it: the achromat's FOV round trip is
unchanged to 1e-9 where the old bracket already worked, and a **paraboloid's
traced FOV is the paraxial `EFL·tan θ` to 1e-9** — a mirror carries no index and,
with the stop at the primary's vertex, no distortion either, which is what makes
the same readout's departure on a refractor that refractor's rather than the
readout's.

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

### Flagged, not pinned: what the app surface measured on an ABERRATED nominal

APP.md's Part B put sliders on this module, and because every rung above sits on
a *perfect* nominal by design, the panel is the first thing to drive it on a real
N-BK7/F2 doublet. Three measurements came back that no rung here states. They are
**app probes and deliberately not rungs** — D8's convention — because each is a
statement about one arbitrary design rather than about the module, and pinning
them would mean pinning a lens.

- **The RSS is not a bound in either direction.** The section above shows it
  under-reporting for correlated modes. On the achromat a **conic** error on
  surface 0 and a **curvature** error on surface 2 — different parameters,
  different surfaces — each spending σ = λ/28 give a combined trace of 2.7e-4
  waves against an RSS of 0.0506: the estimate is **189× pessimistic**, because
  both produce spherical of opposite sign. That factor belongs to the lens rather
  than to the pair — 214× at f = 50 / EPD 14, 8× at f = 100 / EPD 10 — which is
  why it is flagged here rather than pinned.
- **The projection-versus-physical-refocus gap is larger for a COMBINATION than
  the per-row rung suggests.** The consistency rung measures < 0.8× on one
  perturbation. On that cancelling pair the projected delta is 2.7e-4 waves and
  the physically refocused one is **1.85e-2**, sixty-nine times larger, because
  removing the pair's defocus by moving the plane is a 1.9 mm move undoing 17.5
  waves. The projection is still the right currency — it is what makes the RSS
  exact — and this is the size of what it is not.
- **σ has no sign and the image does, by a factor of 1.45.** A conic error of
  ±0.0675 reads σ = 0.0716 either way and gives a real PSF Strehl ratio of
  **0.675 against 0.979**; a negative curvature error at a whole budget makes the
  star *better* than nominal (1.040). Inverting Maréchal on the three Strehls
  gives ⟨W_nominal·δ⟩ = 6.08e-4 against σ_n·σ_δ = 6.00e-4 — **correlation 1.01**,
  i.e. the delta is exactly parallel to the doublet's own residual. This is the
  concrete content of "every external rung is pinned on a perfect nominal": the
  currency is correct and it is not the whole answer once a nominal has
  aberration of its own to interfere with.

Tolerancing lands here, at step 5, rather than in v2: once tilt/decenter exists
(the § 4a folded-mirror frame closed it) the whole capability is a difference of
two traces, and it is the most educational thing the simulator can show — a slider
per tolerance, the image degrading as the RSS budget predicts. **That surface now
exists** (APP.md Part B), and the three measurements above are what it found.

## Step 5u — the mechanical layer: the glass path that is not its own length

ARCHITECTURE has carried a `mech/` line since the beginning — "barrels, threads,
parfocal/back-focus distances; **data + rules; mechanical changes feed back into
optical spacings**" — and it is ROADMAP step 5's last unbuilt item. Most of it is
a parts list, and a parts list is not physics. What makes it a ladder step is the
single claim it exists to get right: **a part's mechanical length and its optical
cost are different numbers**, and the difference is exactly the glass inside it.

So the discipline here is inverted from every other step, and the inversion is
written into the module's own file split. `mech/standards.ts` is transcribed
interface data — 31.75 mm, 55 mm, 45 mm — and is **not rungs**: this file's rule
is that a rung asserts a number from outside the engine, and `TWO_INCH === 50.8`
is a spelling check on a constant. `mech/path.ts` is rules over that data.
`mech/insert.ts` is the one route into the optics, and it hands the tracer glass
rather than handing an image a formula.

That last point is the whole reason the step is honest. `t(1−1/n)` has a closed
form and it would have been trivial to *apply* it — move the image plane and
call the mechanical layer done. The result would have shifted focus correctly
and carried **no spherical aberration and no colour**, because neither was put
in by hand. `withGlassPath` splices plane surfaces into the prescription and lets
the sequential tracer find the focus, so all three arrive from one operation and
the closed form is pinned *against* the trace rather than substituted for it.

| Rung | Pinned to | Status |
|---|---|---|
| **A spliced chain moves the traced focus by exactly t(1−1/n)** | closed form (§ 6c), 9 digits | ✅ |
| **The shift is position-independent along the converging beam** — same focus, same OPD | exact geometry | ✅ |
| Linear in thickness; additive across layers of different glass | closed form | ✅ |
| **The naive air-only budget over-reports the cost by exactly Σtᵢ(1−1/nᵢ)** | closed form + trace | ✅ |
| A mirror diagonal hands back a hard zero | negative control | ✅ |
| **The focus shift is itself dispersive: t(1/n_C − 1/n_F), traced** | Schott N-BK7 catalog, 8 digits | ✅ |
| The same plate moves two different doublets' F−C residual identically | trace, two glass pairs | ✅ |
| The cost goes as (f/#)⁻⁴, and the exact form outruns the third-order one — **closed form only, no trace in this step** | W₀₄₀ vs the all-orders form, both trace-pinned at § 6c.1 | ✅ |
| **A single group cannot be DIN-parfocal below M = [x′+√(x′²+4Px′)]/2P** | closed form, = 4.1387 | ✅ |
| A part carrying more glass than its light path is refused | construction | ✅ |

### The measurement the layer exists for

A 2″ prism star diagonal — ~110 mm of light path with ~40 mm of N-BK7 in it —
consumes all 110 mm mechanically and hands **13.6287 mm** of it back optically,
because a plate pushes the focus by t(1−1/n) and 1 − 1/n is **0.3407** at the d
line. That is the "a prism diagonal buys back about a third of its glass" folk
result, with the engine's own catalog index in it rather than a rule of thumb.

Spliced into an f/10 achromat the *traced* paraxial focus moves by that number to
nine digits. On a chain of diagonal + 20 mm spacer + a 44 mm SLR body, the naive
sum is wrong by **7.83% of the whole chain's length** — not a rounding term, and
always in the same direction: it never invents reach that is not there, it only
denies reach that is. On a focuser with 150 mm of back focus and 2 mm of
in-travel the two verdicts **genuinely disagree**: the spreadsheet says the train
does not reach and the physics says it does.

### The finding that is not arithmetic: the position does not matter, exactly

A plane plate slid along a converging beam meets every ray at the same angle,
because the pencil is a cone of *straight lines* and a perpendicular plane
crossing it does not change any of them. So neither the focus shift nor the
aberration depends on where the glass sits — only the clear aperture it needs
there does. Pinned by tracing the same 40 mm prism at a 50 mm gap and a 600 mm
gap: the focus agrees to 1e-11 mm and the OPD map agrees point for point to below
**1e-6 waves** over a 100 mm aperture.

It is an exact statement rather than a small-angle one, and it is what licenses
`insert.ts` to flatten a whole chain's glass into one contiguous stack instead of
modelling the air between the parts. The air is not a surface; what the spacers
do is set the total, and the total was already the trailing thickness.

### The colour, and how far the sign claim actually reaches

The focus shift is dispersive — t(1−1/n) grows with n — so a plate pushes **blue
further back** than red. The traced spread the prism adds is t(1/n_C − 1/n_F) to
eight digits, and *that* is the pin. A positive element does the reverse for the
same reason (a larger n is a shorter focal length), and that half is a law.

**The tempting next sentence is not, and it is worth saying why.** "So a glass
diagonal is a colour compensator" requires the lens's F−C spread to have the
opposite sign, and for an achromat that spread is a **residual**: F and C are
united by design, and what is left is the thin-lens split's Gullstrand
remainder, whose sign belongs to the lens and not to lenses. § 5j and § 5k
already show partial dispersions are exactly the delicate quantity here. So the
compensation is *measured on two glass pairs rather than asserted on one*: the
BK7/F2 achromat at f/5 carries −0.2098 mm and § 5k's CaF₂/BK7 ED pair −0.5068 mm,
both undercorrected the same way, and the diagonal reduces both.

What is exactly identical across the two is the amount it moves them —
**0.139742 mm** to six digits, because the plate does not know what it is bolted
to. And that magnitude is not negligible: it is **more than four Rayleigh depths
of focus at f/5** (2λ(f/#)²) and inside one at f/10. A diagonal's own colour is a
fast-scope problem, and it is invisible to any budget made of lengths.

### Where the glass stops being free — and it is not where this step guessed

The plate's wavefront error is W₀₄₀ = t(n²−1)s⁴/(8n³) with s = 1/(2·f/#), so the
cost is a **fourth power of the aperture** — ×16 per halving of the focal ratio.
The exact all-orders form (§ 6c) outruns it the way § 6l's does: ×16.0216 between
f/20 and f/10, ×16.5629 between f/4 and f/2, and the exact/third-order ratio
climbs monotonically to 1.0469 at f/2.

Bisecting for Rayleigh's quarter wave puts the crossing at **f/5.315**, where this
step was scoped expecting f/3–f/4. The correction matters, because f/5 is an
ordinary focal ratio and f/3 is not: an ordinary prism diagonal is comfortably
free on an f/10 refractor (0.0794 of a quarter wave), sits essentially **at** the
Rayleigh limit on a common f/5, and is a genuine aberration on anything faster.
Which is the numerical version of why a diagonal is uncontroversial visually and
argued about for imaging.

**"No trace in this step" was the right call, and APP.md's C3 is what established
it** — as an app measurement rather than as a rung, so nothing in the table above
moves. The panel differences two `withGlassPath` systems at their own best focus,
which reaches this section's number off the *tracer*: it lands within ±1% of
W₀₄₀/(6√5). But the residual **never converges**. It wanders non-monotonically
with the pupil sampling — 1.061 / 0.956 / 1.007 / 0.995 / 0.988 at `pupilSamples`
9 / 15 / 21 / 31 / 61 — it is exactly linear in the plate's thickness, and the
**same sequence returns where the lens's share of the total is four times
different**: bare ÷ plate is 3.64 at f/10 and 0.90 at f/40, and the two wobbles
agree to 2.5e-3. So what moves is the **quadrature of an RMS over a lattice
clipped to a disc** and not physics. (The first version of this paragraph said
the control was "an f/40 doublet with no residual of its own", which is **wrong**
— at f/40 the lens residual is 90% of the plate's contribution rather than
absent. The 4× swing is what the app's rungs pin, and it is the stronger claim.) That
±1% is *larger* than the exact/third-order excess above at anything slower than
about f/4 (1.0018 at f/10, 1.0005 at f/20), so a traced route cannot resolve the
departure this section computes. The two obvious alternatives are worse and are
recorded because they look reasonable: a § 5t thickness `Perturbation` on the
glass layer moves the image plane 40 mm and its linear ρ² projection reads **7×
high**, and a zero-thickness plate — the structurally identical control — breaks
the tracer, since two coincident plane faces make the chief ray miss.

C3 also measured what this section's f/5.315 does **not** say. It is a plate in
isolation: on a 100 mm N-BK7/F2 doublet the lens alone leaves Maréchal at
**f/6.007** and the lens with 40 mm of glass in it at **f/6.192**, both slower, so
at f/5 the doublet is 2.6 budgets over on its own and the diagonal is the smaller
term at 3.1% of focal ratio. Never a *negative* term, though — the traced
difference is positive at every ratio and every sampling, because a plate's
spherical aberration carries an achromat residual's sign and the two add, which is
the opposite of § 6e.4's oil.

### The sixth geometric ceiling, and the first that comes from a mount

The parfocal standard says an objective must put its specimen 45.0 mm below the
nosepiece shoulder, whatever its magnification — that is what makes a turret
work. The optics are already solved, so what the standard adds is where the whole
thing *hangs*: barrel = parfocal − (object distance + glass length). For the
objectives that fit, the barrel is what absorbs the difference and it is not a
constant — a 10× still stands well back from its specimen and needs a short one,
a 40× is nearly against it and needs almost the whole 45 mm as mount.

**And a 4× does not fit at all.** A single group working at magnification M
against Newton's x′ has f = x′/M and stands off its object by f(1+1/M), so the
shortest it can *possibly* be from its specimen is x′(M+1)/M² — before any glass
and before any mount. Setting that equal to the parfocal distance P gives

    P·M² − x′·M − x′ = 0    ⇒    M_min = [x′ + √(x′² + 4·P·x′)] / (2P)

which for the DIN pair (x′ = 150, P = 45) is **4.1387**. Below it the standard is
unreachable by construction. With the built doublet's real thickness the floor
rises to **4.236**, bisected on the refusal.

This is the sixth ceiling in the repo after § 6b's f/4.1, § 6d's NA
0.343, § 6e.4's NA 1.411, § 6q's 0.88·f_e and § 6l's n_s, and it is the first that
comes from a **mount** rather than from the ray invariant — which is exactly the
class of constraint ARCHITECTURE put this layer in the tree for. (That list was
written as "geometric ceilings"; [§ 6b.5](#-6b5--the-ceiling-and-whose-it-is)
sorts it into kinds and only § 6e.4's and § 6l's are geometric in the strict
sense — § 6b's f/4.1 is an aberration edge and § 6q's is a solver locus. This
one is a mount constraint, which is the distinction the sentence above was
already reaching for.) Its physical
content is that a real 4× DIN objective **cannot be one doublet**: the standard
reaches back into the optical design and demands a front group closer to the
specimen than a single group can be.

**And the 4.236 is not a constant — APP.md's C3 made the aperture a slider.** Also
an app measurement and not a rung, and it is D8's lesson on a third axis: 4.236 is
the **NA 0.10** answer, and the floor runs 4.173 / 4.236 / 4.341 / 4.506 over
NA 0.05 / 0.10 / 0.15 / 0.20 because a faster objective is a thicker one and
thickness is what the standard runs out of room for. The thin-lens floor above
knows nothing about any of it (4.1387 throughout), so the whole spread is glass;
against the *standard* instead the penalty is nearly constant, 1.022 to 1.029 over
parfocal distances from 35 mm to 95 mm. Above about **NA 0.22 the mount stops
being the binding wall** and § 6b.5's aperture refusal takes over — a different
kind of wall on the same axis, and telling them apart is not optional: a search
that catches both as one exception reports a mount ceiling of **12.6× at NA 0.25**,
where the truth is that no doublet exists there to mount.

### Not yet pinned

- **Barrel vignetting.** The spliced faces default to an unbounded clear
  aperture, so a 1.25″ diagonal in a 2″ beam does not clip here. It physically
  does, § 2f's machinery is what would catch it, and `semiApertureMm` is the hook
  — the missing piece is a rung, not a mechanism.
- **The sensor's own cover glass** is glass in the converging beam and does shift
  focus on a fast astrograph. `parts.ts` deliberately leaves it out of
  `cameraBody` rather than inventing a per-body thickness nobody can check.
- **Tilted elements.** Every part here is normal to the axis. A tilted plate
  displaces and astigmatizes, and § 1 already pins the displacement.
- **The tube-length error** — a 160 mm objective used at 170 — and its known
  equivalence with a coverslip error as mutual compensators. § 6c has the
  machinery; this step took the parfocal half of the standard and not that one.

## Step 5v — the extended source, and the Jacobian that makes it one

ROADMAP step 5's last unbuilt item, and the last engine step outside the
teaching layer: the telescope's scenes. Everything the engine has imaged from
the sky so far has been a **star**, and `rasterizePointSources` is the reason —
a point source has no angular size, so its whole light lands at one image point
and the only question the rasterizer answers is *which* point. A planet, the
Moon or a nebula has no flux at all until an area is named. What it carries is a
**radiance**, light per unit solid angle, and turning that into the flux per
pixel `renderField` convolves needs the solid angle each pixel subtends.

So the step adds **no optics**. Every ray it needs was already being traced by
`imagePointOf`; what is new is that the chief-ray map is **differentiated**
rather than only evaluated. Its content is therefore what that derivative costs
and what it reveals, and both turned out to be more interesting than the
picture.

| Rung | Pinned to | Status |
|---|---|---|
| **dΩ/dA = cos³θ/f²** on a distortion-free map | closed form / textbook cos⁴ law, 1.3e-10 | ✅ |
| The axis is exactly **1/f²**, as the limit of two vanishing quantities | closed form, 1.5e-12 | ✅ |
| The fixture's licence: **r = f·tan θ to ≤ 1 ulp** on a stop-at-the-mirror paraboloid | reflection law | ✅ |
| The Jacobian converges **×8** per doubling of nodes where the radius converges ×16 | interpolation order | ✅ |
| A disc's total flux is its **exact solid angle**, with a residual that **changes sign** | closed form + Gauss circle | ✅ |
| The point-source limit: centroid exact, flux → the star's | § 3c's own rasterizer | ✅ |
| On a real doublet the departure from cos³ runs **×4.00 per doubling of field** | § 6h.1's cubic, one derivative down | ✅ |
| A disc and a star of equal flux integrate to the same light through `renderField` | 1e-13 | ✅ |
| A disc's image reaches **f·tan(D/2)** — the capability itself | geometry | ✅ |
| `I(μ)/I(0) = 1 − u(1 − μ)` contains the uniform disc bitwise at u = 0 | textbook law | ✅ |

### 5v.1 — the cosine count, and the one this module does not apply

The textbook falloff for an extended source is **cos⁴θ**, and the obvious move
is to pin that. It would have been wrong, and finding out why was the first
thing this step did — before a line of the module was written, because the
answer decides the module's signature.

cos⁴ has two standard decompositions. The classical one is exit-pupil-side
(inverse square through `d/cos θ` gives cos², pupil foreshortening one more, the
tilted image plane a fourth). The one this engine's architecture forces is
object-side: a **geometric cos³** from the sky-to-image-plane Jacobian, times
**one cosine** for the entrance pupil's projected area. The totals agree; the
decompositions do not, and the difference lands exactly where this engine
normalizes.

So it was measured. `psf().energy` — the transmitted pupil energy that § 2b, § 2d
and § 2f all normalize to — is **flat in field to 8e-7 at 2°** on the hero
achromat, where cos θ would be 6.1e-4. Three orders apart, and the residual that
is there is not even a cosine's shape: **linear in θ** on the paraboloid
(2.33 / 3.50 / 4.66 e-4 at 0.5 / 1 / 2°), quadratic on the doublet. That is the
pupil lattice's own quantization. The engine's pupil is a *normalized* grid, so
its area is field-independent by construction and the obliquity cosine is
**definitively absent**.

That left three options, and the third is the trap. Applying the cosine here
would make this rasterizer disagree with `rasterizePointSources`, which does not
apply it either — a star and a disc of the same total flux would render at
different brightnesses, and 5v.7's limit would have to be written around the
disagreement instead of pinning it. Fixing `transmittedEnergy` instead would drag
§ 2b, § 2d and § 2f into a re-pin for a factor none of them is about.

**So the module applies the Jacobian only, and the fourth cosine is named as a
deferral belonging to the pupil layer** — where fixing it once would serve both
rasterizers. It is missing from both today, identically, which is precisely what
makes it cancel in the one rung that compares them. A deferral that cancels in
the comparison is worth more than a factor applied on one side.

### 5v.2 — the Jacobian is one-dimensional, and that is physics rather than luck

§ 6s found that "where does this pixel look" is a function of one scalar because
the systems are axially symmetric. The same symmetry makes the **area element**
factorize. A pixel at image radius r looking at field radius θ(r) covers
`r·dr·dφ` of image plane and `sin θ·dθ·dφ` of sky, so

    dΩ/dA = (sin θ / r) · (dθ/dr)

— a **tangential** factor times a **radial** one, each a function of r alone.
That is § 6m.4's anisotropy written as a product rather than as a 2×2
determinant: the two scales genuinely differ, and the determinant is still
one-dimensional. There is no off-diagonal term to compute, and none is neglected.

On the axis both factors are the same limit, `sin θ/r → dθ/dr`, so
`dΩ/dA(0) = (dθ/dr)²` **exactly** — a closed form rather than a 0/0, and on a
system that images at f it is **1/f²**, measured at 1.5e-12. The alternative
(clamping the axis, or nudging it off zero) is the kind of special case that
would have made the frame's brightest pixel the one nobody could pin.

### 5v.3 — the fixture, and why it is exact rather than merely good

cos³θ/f² is true of the map `r = f·tan θ` and of no other. A real doublet does
not have that map, so pinning cos³ on one would mean choosing a tolerance to
cover the distortion — which is the move this file forbids.

The fixture is instead psf.test's own **paraboloid at its focus**, and it is
exact for a structural reason: its stop is **at the mirror**, so the chief ray
from any field angle strikes the vertex and reflects there. Image height is then
the reflection law and nothing else. Measured: `r = f·tan θ` to **0 or 1 ulp**
(≤ 1.11e-16) at every field from 0.05° to 4°.

On that map the Jacobian reproduces **cos³θ/f² to 1.3e-10** over the same range.

The falloff itself is worth stating plainly, because the cos⁴ law is famous from
wide-angle photography where it bites hard: at 4° of field it is **0.73%**, and a
telescope's field is degrees at most. **Natural vignetting is real, pinned, and
invisible in every instrument this branch models.** The rung exists to pin the
law, not to promise a visible effect — and the honest version of that sentence is
in the rung.

### 5v.4 — a derivative loses an order, and the error estimate is the wrong quantity's

The map is built **forward** — one chief ray per node, smooth in θ, no search
anywhere — and inverted afterwards by Newton on the interpolating cubic, with
`dr/dθ` from differentiating the *same* cubic. The alternative, differencing
`render.ts`'s bisected `fieldAngleFor`, carries √ε/h noise that would have
swamped the cos³ pin it exists to be checked against. The round trip
field → radius → field returns to **1e-15**.

The interpolant is § 6s's — piecewise 4-point Lagrange, with the same odd
mirror node below the axis for the same reason (r is odd in θ). What is new is
what reading its **derivative** costs, and it is exactly one order:

| nodes | Jacobian error | ratio |
|---|---|---|
| 8 | 5.92e-8 | — |
| 16 | 7.60e-9 | 7.79 |
| 32 | 9.63e-10 | 7.90 |
| 64 | 1.21e-10 | 7.95 |

**×8, not ×16.** The same table that places a pixel to fourth order reports that
pixel's solid angle to third. That is elementary once stated and it is not
stated anywhere in § 6s, because § 6s never differentiated anything.

It has a consequence for the reported `errorEstimateMm`, and it is sharper than
§ 6s.2's. There the estimate under-read the truth by 7–17%; **here it is not
even the same order** — it falls ×14.91, ×15.47, ×15.74, approaching sixteen
from below, because it estimates the interpolated *radius*'s remainder while the
quantity actually consumed is the derivative. Reported rather than fixed: an
estimate of the wrong order is still the number that says when more nodes stop
buying anything, and naming what it measures is the honest repair.

### 5v.5 — energy is a witness here, and it converges rather than conserving

`imaging/specimen` records that its warp carries **no** Jacobian, because an
amplitude transmittance is a property of a point; it also names the case that
would need one — an extended emitter **density** — as its own deferral. A sky
radiance is exactly such a density, so this module is the one place in the
engine where the object-side warp does carry a Jacobian, and where **energy is a
real witness**, against § 6g.2, § 6k.4 and § 6r.2 all recording that it is not.

It is a *converging* witness, not an exact one, and the distinction is the rung.
The radiance is point-sampled at each pixel's own field direction — § 6n's
convention, so the warp stays in the argument and nothing is resampled — and a
point sample of a hard-edged disc is a count of lattice points inside a circle:

| disc | radius | flux residual |
|---|---|---|
| 0.005° | 3.2 px | **+1.70e-1** |
| 0.01° | 6.3 px | +1.95e-2 |
| 0.02° | 12.7 px | **−2.27e-3** |
| 0.04° | 25.4 px | +1.99e-4 |

**The residual changes sign.** A systematic under- or over-count would keep its
sign and could be corrected by a factor; this is the Gauss circle problem, which
§ 6i.2 met counting a pupil's points and § 6k.5's truncation met again. So the
rung asserts the **sign flip** and the falling magnitude, and claims **no rate** —
because a sequence like this does not have one, and asserting "each step is
smaller" alone would pass for a drifting image too (§ 6g.3's lesson).

A related null, and the reason it is not bitwise: a bigger frame adds no light to
**1e-14**, but not to the last bit, because each frame tabulates its map out to
its **own** corner and a wider frame spreads the same node count over a longer
span. The sampled sky is identical; the table under it is not. Saying which of
the two moved is the whole value of the rung.

### 5v.6 — the point-source limit, and what it may not promise

A disc of fixed total flux shrunk below a pixel is a star, and the two
rasterizers must agree there. They do — in **flux**, converging to 3e-3 by 0.03°,
and in **centroid**, exactly at every size, because the centroid is the map's and
not the quadrature's.

It is **not** a bitwise identity, and § 6n.2 is why that is worth saying: there,
the specimen and emitter rasterizers *were* pinned bit for bit, because both
place a value at a point. Here `rasterizePointSources` splats one flux
bilinearly over four pixels while a disc is point-sampled over however many
pixel centres fall inside it. Two different quadratures cannot be asked to round
the same way, and a rung demanding it would have been pinning the arithmetic
rather than the physics.

The negative control is the module's whole content: **drop the Jacobian and a
uniform sky renders uniform**, which it is not. The error that makes is exactly
`1 − cos³θ` on the paraboloid — pinned as an absolute difference against 5v.3's
own accuracy, not as a ratio, since the falloff vanishes on the axis while the
interpolant's error does not and a relative test would tighten without limit
toward θ = 0.

### 5v.7 — on a real lens the departure from cos³ IS the distortion

The closed form is exact only on the distortion-free map, so the traced systems
are where it is *measured* rather than asserted. On the hero achromat, normalized
to the map's own axial scale — which removes C4's constant 0.0212%
plane-position offset and leaves the field-dependent term alone — the departure
from cos³ runs:

| field | departure | ratio |
|---|---|---|
| 0.125° | 1.055e-7 | — |
| 0.25° | 4.220e-7 | 3.99997 |
| 0.5° | 1.688e-6 | 3.99992 |
| 1° | 6.752e-6 | 3.99969 |
| 2° | 2.700e-5 | 3.99878 |

**×4.00 per doubling** — quadratic, where the height's own departure is cubic,
because this reads the map's *slope* rather than the map. That completes a ladder
of derivatives off one coefficient: § 6h.1's ×8.00 cubic in the height, § 6m.4's
slope, § 6n's ×2.00 sagitta, and now ×4.00 in the Jacobian. The paraboloid reads
below 1e-9 on the identical test, which is the control that makes the number
distortion rather than arithmetic.

### 5v.8 — the composition, which is the architectural claim as a number

The step's real deliverable is that **nothing downstream changed**. The scene it
produces is `ImagePlaneScene`, so `renderField`'s patch decomposition, the
polychromatic stack and the colour integration — all built at step 4, before an
extended source existed — consume it unaltered.

Pinned rather than asserted: a disc and a star of **equal total flux** integrate
to the same light through `renderField` to **1e-13** at one patch, and the
rendered light is **bitwise linear** in the radiance (doubling reads exactly
2.0000000000000000), which is the shortest statement of incoherent imaging's
linearity in the branch.

And the capability itself, which no point source can express: a disc's image
reaches **f·tan(D/2)**, pinned against the geometry rather than against the
rasterizer — the last lit pixel is the geometric edge's own pixel.

### 5v.9 — what it refuses

The map is monotone or it is not invertible, and every consumer inverts it. Three
refusals, and the second is C4's lesson applied before it could bite:

- a radius **outside the tabulated range**, rather than extrapolating off the end;
- a **frame whose corner reaches further than the system passes light**. § 2f's
  diagonal wall is 1.56° on an f/5 Newtonian, and a frame reaching past it is
  refused with the field it *did* reach in the message. C4 named the family —
  "a bracket that assumes its own field passes unnoticed until something folded
  arrives" — and this is the first routine written after it, so the forward
  covering search reports rather than assumes;
- a table too coarse to resolve its own fourth difference (`nodes < 4`), since
  its error estimate would be noise.

### Not yet pinned

- **The fourth cosine.** 5v.1's deferral, and it belongs to the pupil layer
  rather than to either rasterizer. Fixing it there would serve both at once;
  fixing it here would break the one rung that compares them.
- **A soft-edged or anti-aliased disc.** 5v.5's residual is a hard edge
  point-sampled, and area-sampling the boundary cells would remove most of it.
  Deliberately not done: the convergence is the honest report of what § 6n's
  callback convention costs, and hiding it behind a soft edge would make the
  rasterizer's accuracy a property of the source's authoring.
- **Unifying this map with § 6s's `RadialMap` and `render.ts`'s
  `fieldAngleFor`.** Three inversions of the same chief ray now exist — to an
  object height, to a field angle by table, and to a field angle by bisection.
  Deferred on § 6s's own argument: § 3c's rungs pin the render, and an
  interpolant underneath them would mean they pinned the interpolant.
- **The extended *emitter* deferral is still `imaging/specimen`'s.** The
  factorization here is what such a step would need, and it transplants; the
  microscope's version has a different map and its own rungs, and nothing in
  this step closes it.
- **A real limb-darkening coefficient**, a planetary albedo map, and lunar
  terrain. The law is pinned; `u` for an actual star is measured data, and the
  same rule that keeps real dye spectra out of § 6i keeps it out of here.
- **Rotation and phase.** A gibbous Moon is a terminator, which is a shape on
  the source rather than an optical effect — content for the authoring layer,
  and it needs no rung.

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
- ~~**`objectNA`'s aperture seed is wrong at high NA.**~~ ✅ **closed at § 1.5.1**,
  and the diagnosis here was right in every part except which unit would close
  it. `resolveStopRadius`'s `objectNA` branch computed
  `epRadius = (NA/n)·armLength`, treating NA/n as a *tangent* over the arm: 0.5%
  at NA 0.10 and **2.6× out** at NA 1.4 in oil, where sin u = 0.924 gives
  u = 67.5° and tan u = 2.42. What this bullet did not predict is that the
  immersion unit would sidestep it too — § 6e.4 hands its chain a `stopRadius`
  like every other design — so it was **an app surface** that reached the branch
  first, the bench editor being a form over all five spellings. `imageNA` had the
  same defect and is fixed with it.
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

### § 6b.5 — the ceiling, and whose it is

`test/doublet-wall.test.ts`. This step left an item open in words — "the 4×
sitting at f/4.1 — the edge of the cemented-doublet form" — and APP.md's **D8**
then measured `finiteConjugateObjective`'s own refusal boundary, found it at
f/2.3 rather than f/4.1, found it nearly constant (8%) across two glass pairs
and two orientations where the NA was not (28%), and flagged *"the doublet's
ceiling is a focal ratio ≈ f/2.3, and the ratio is the invariant"* as an open
question for this step rather than quietly adding it to the ladder. **No
engine capability is added here**; what follows is that question answered.

**The answer is that the two halves of D8's sentence are about two different
things, and only one of them is optics.**

#### The optical ceiling — Maréchal, bisected, and § 6b's own sentence survives

| Rung | Pinned to | Status |
|---|---|---|
| **The DIN 4× is diffraction-limited to NA 0.10311**, so the catalogued 4×/0.10 has **3.1%** of aperture in hand | Maréchal — EXTERNAL | ✅ |
| …at a working ratio of **f/3.956** against the catalogued f/4.076 | the same, in D8's currency | ✅ |
| σ runs as **NA^6.2** across it, so the reach is bisected and not interpolated | § 5j/§ 6d's order, on two consecutive ratios | ✅ |
| **NEITHER the aperture NOR the ratio is invariant on it**: reach 0.1031 → 0.1827 (**77%**) and f/3.956 → f/2.823 (**40%**) over M = 4 → 40 | measurement, against D8's flagged claim | ✅ |
| …monotone in both and in opposite directions — a slower objective reaches a higher NA at a faster working cone | the position factor, showing its sign | ✅ |
| **At the constructor's refusal NA the wavefront is 5.6 waves — 78× Maréchal**, and 1.91× past the reach | the same criterion, at the § 6b.5.6 wall (was 3.45 waves / 48× at D8's) | ✅ |

So **§ 6b's original sentence is the one that stands.** The 4×/0.10 really is
at the edge of the cemented-doublet form: it clears Maréchal by 3% of aperture
and 3% of ratio, which is as close to an edge as a catalogued member gets. D8's
"the form survives to NA 0.1843" is true only in the sense that the constructor
returns an object — the lens there is 48× past diffraction-limited and is not an
objective. And the invariance D8 measured is real but belongs to something else:
**there is no single focal ratio that is the cemented doublet's optical ceiling**,
because on the external criterion the ratio still spans 40%. It is the tighter of
the two measures by about 2×, which is the grain of truth in "quote a ratio", and
that is all it is.

#### The refusal boundary — a solver locus, and which parts of the solver

The reason the ratio looked invariant is that `achromaticObjective`'s refusal
boundary **contains no aperture by construction**, so of course the ratio at it
barely moves. These rungs are identities, closed forms and negative controls in
the sense § 6s uses the word: a rung about a solver is an identity rung, and
none of the table below is pinned to an external number.

| Rung | Pinned to | Status |
|---|---|---|
| **The refusal ratio is aperture-free to ≤ 3 ULP over D = 1 → 1000**, at two conjugates | identity; degree-1 homogeneity in D | ✅ |
| …and it is **algebraic, not arithmetic** — most values bitwise equal, one 2–3 ULP off | § 6p's distinction, on its other side | ✅ |
| ~~**F\* is homogeneous of degree 1 in the STATED thickness pair**~~ **FALSIFIED by § 6b.5.7** — ×2 and ×3 now move it by **under 2%** | the locus has stopped living in t/f | ✅ |
| …and with it ~~the crown/flint asymmetry~~ (×1.86 against ×1.15): both are now ×0.99 | the curve in (t_c/f, t_f/f) is gone, not redrawn | ✅ |
| **ANTI-CIRCULARITY: it is the LENS count that flips 2→1 across the constructor's verdict**, thicknesses stated | the reconstruction is checked, not assumed (was 2→3 on the raw count) | ✅ |
| **The arriving third root is >5× hemispherical and ENTERS at \|c₁\|/span = 3⁻** — the scan window's own constant | measurement, unchanged; what changed is that nothing reads it | ✅ |
| …and the constructor now **BUILDS with that ghost in its scan**, at 1.01·F\* and 1.05·F\* | § 6b.5.7's whole point, stated as a build | ✅ |
| **The boundary is now GEOMETRIC**: just inside, the steeper real bending is at \|c\|·(D/2) = 0.9999; just outside it has passed 1 | the wall changes kind, not just place | ✅ |
| ~~**The DIN wall is the fixed point's SEED, in closed form**, to 1e-11~~ **FALSIFIED by § 6b.5.6** — the seed's prediction now misses, low, by 2.9%–9.6% | negative control; the miss runs with M and orientation, so it is the seed's error and not a rescaling | ✅ |
| **The wall is now the CONVERGED design's own refusal ratio** — f/(2·a·tan u·k) = F\*(s/f) to **3e-13**, both read off the fixed point | identity — exact, but self-consistent rather than predictive | ✅ |
| …and on a second glass pair, where the seed's form misses by 7.9% and 11.6% | anti-circularity | ✅ |
| **The optical tube length cancels BITWISE** — three equal walls at x′ = 100/150/250 | identity; survives the re-seed unchanged | ✅ |
| **WITNESS — the wall as absolute LITERALS**: 8 apertures over M × orientation, the silica pair, and a coverslip row the closed form cannot reach | the only rung here a re-seed cannot satisfy by agreeing with itself | ✅ |
| …and **what the seed cost, as a literal** — a_conv/a_seed = 0.935788, the seed presenting f/1.782 where the solver's locus is f/1.904 | the 6% of § 6b.5, now read from the other side | ✅ |
| A glass-pair failure **finds nothing** at any ratio (CaF₂/F2); an aperture failure finds bendings and **fewer than two are lenses** | the count discriminates | ✅ |
| …and the same pair **builds when slowed**, which falsifies the message's sentence on that branch | negative control | ✅ |
| **The message says APERTURE on that branch and never on the empty one**, and the glass sentence is bit-for-bit unchanged where it is true | the count, turned into prose | ✅ |
| …and it **counts the lenses** rather than assuming how many: **2 found, 1 a lens** at the wall, **2 found, 0 lenses** at f/1.2 | measured in the failing call | ✅ |
| **A glass-pair refusal is NOT retried** — `DoubletApertureRefusal` on the aperture branch, an ordinary `Error` on the empty one | one count decides both the prose and the type | ✅ |
| **§ 6q's Plössl wall is this same refusal**, which is why it is scale-invariant — and it moved with it, 0.899195 → 0.9615248·f_e | mechanism, not the number | ✅ |

**The closed form.** The DIN constructor seeds its fixed point from the thin
lens — object at a = f(1 + 1/M), image at b = f(1 + M), glass sized over the
stop the object distance implies, D = 2·a·tan u·k with k = 1.12 — so

    tan u_wall = 1 / (2·k·(1 + 1/M)·F*(s/f)),   s/f = 1 + M   (flint first)
                                                      1 + 1/M (crown first)

with F\* the aperture-free refusal ratio. **f cancels out of f/D**, which is why
the optical tube length does not move the wall and why D8 measured 0.1843 at
x′ = 100, 150 and 250 — here that is an identity rather than three equal
measurements. The prediction lands on the bisected engine wall to **1e-11
relative** at every magnification, both orientations and both glass pairs.

**And that exactness was the finding.** If the *converged* design were binding,
the closed form would miss by the ~6% the fixed point moves the object distance.
It did not miss at all — so the wall was decided by the **thin-lens seed**, before
the constructor had looked at the lens it was building. The converged geometry at
that NA sat about 6% inside the boundary, which meant `finiteConjugateObjective`
refused apertures it could in fact deliver.

**That is now FIXED — § 6b.5.6 below — and this closed form is what it cost.**
The prediction above is kept as the section's negative control: it misses the
wall, low, by 2.9%–9.6%, which is exactly the aperture the seed was throwing
away. What replaces it is equally exact and no longer predictive — see § 6b.5.6.

**So "f/2.3" was two solver conventions composed** — the ±3·span scan window,
which decided F\*, and the seed, which decided how an NA mapped onto it. Neither
was a property of the glass. **Three ratios were in play and D8 quoted the third:**
F\* = 1.904 (the refusal locus), f/D = 2.023 at the converged geometry, and the
working f/# = 2.266 = 2.023 × 1.12, the glass margin. A number quoted without its
convention will read as agreeing with D8 while measuring something else.

**Both conventions have since been taken out, and what is left is not one.**
§ 6b.5.6 stopped the seed deciding how an NA maps onto the locus — the design at
the wall now presents its own ratio, so f/D and the locus are the same number and
the wall is where they meet — and § 6b.5.7 stopped the scan window deciding where
the locus is, by rejecting bendings no glass can be bent to before counting them.
What binds now is \|c\|·(D/2) = 1 on a real bending, which is geometry. F\* itself
moved with that: **1.9042573 → 1.8372723** at s/f = 5, **1.9175107 → 1.7397236**
at infinity.

**The refusal named the wrong cause, and the engine already printed the right
one — ~~left alone deliberately~~, now FIXED (§ 6b.5.5).**
`achromaticObjective` said *"this glass pair does not admit the classical
doublet solution"* for both branches, and on the aperture branch that sentence is
false — the same pair builds 10% slower. The **count** in the message was already
the discriminator: **0** is the glass pair (CaF₂/F2, at any ratio), **3** is the
aperture. What the fix does is derive the prose from that count instead of
asserting over it, so the 3-root branch now reads *"the classical solution has
two, so the bending scan has admitted an extra root, and N of the 3 are deeper
than hemispherical (…× at the steepest surface) and are not lenses — what is
binding here is the APERTURE and not the glass pair, so slow the focal ratio"*.
On the 0-root branch the original sentence is bit-for-bit unchanged, because
there it is true.

**Nothing about which designs are refused moved — in THIS commit.** The extra root
was *reported*, not rejected, rejecting it being the other open item below; that
is § 6b.5.7, and it did move the boundary. So § 6b.5.5 was a message change with
an identity behind it, and the two are separable exactly because of that.

**The count is measured in the failing call rather than assumed**, which the
build immediately earned: at the wall itself the two real roots were ordinary
glass, so **1 of 3** was past hemispherical — but drive the ratio far enough below
it and the real pair goes non-physical too. A message hard-coding "one ghost
root" would have been wrong there, and § 6b.5.3's "the two REAL roots at the wall
are ordinary glass" was a statement *about that wall* and did not travel — it is
false at the § 6b.5.7 wall, where one real root is at \|c\|·(D/2) = 1 by
construction.

**The claim was restricted to the two counts that were measured**, 0 and 3, with
an odd count of **1** falling through to the glass-pair sentence with nothing
behind it — named here rather than guessed, since no input reached it. **§ 6b.5.7
closed that hole as a side effect**: what is counted is now a lens, every count
with anything found at all lands on the aperture branch, and the message prints
both numbers ("found 2, of which 1 is a lens").

**The unification.** § 6q's Plössl clear-aperture wall — bisected there to
0.899195·f_e and reported as "exactly scale-invariant from f_e 15 to 50" — throws
this same refusal. That scale invariance *is* the identity above, seen through a
different constructor: both forms are specified entirely in ratios, so neither
boundary can contain an aperture. What is **not** claimed is the number: the
clear aperture reaches the doublets' apertures through the Plössl's own layout,
which nothing here measures. **The unification then paid a bill**: § 6b.5.7 moved
this refusal, so the Plössl wall moved with it, to **0.9615248·f_e** — same
constant, same exact scale-invariance, new value.

**So the repo's list of walls is three kinds and not one — and § 6b.5.7 moved two
of them between columns.** § 6e.4's NA 1.411 and § 6l's 1.3347 are **geometric** —
the rays stop existing. § 6b's f/4.1 is an **aberration** edge, and § 6b.5.1 is
what earns it that name: the wavefront leaves Maréchal at f/3.956, with the glass
in perfectly good health. § 6q's Plössl wall and D8's f/2.3 were **solver
loci** — and are not any more. Once the scan stops counting bendings that are not
surfaces, what refuses at both is a real bending reaching \|c\|·(D/2) = 1: the
glass runs out. They join the geometric column, at 0.9615248·f_e and f/1.837, and
the taxonomy's three kinds now have one member fewer in the middle of them.
§ 6d's NA 0.343 is unclassified here and should not be assumed: § 6d.4 already says "its limit is the SOLVE, not
aberration — at its ceiling it is still λ/27", which is the shape of this
mechanism, but the Lister solves two bendings jointly and nothing above measures
it. That is a named follow-on, not a claim.

**§ 6b.5.6 — the seed is no longer the wall, and what that did and did not buy.**
The fix the item above asked for. `finiteConjugateObjective` sizes its glass off
an object distance it is still converging, and the seed's is the worst that
distance ever is — so the first pass presented `achromaticObjective` with a focal
ratio the design being converged to never needed, and a refusal there was read as
a verdict. It is now read as an **overshoot**: the aperture is held back only as
far as it takes to get a lens to read the next object distance off, asked for in
FULL again every pass, and the fixed point may only close on a pass that built at
it. Nothing keeps a reduced aperture, so a design whose *converged* glass is past
the locus is still refused, with `achromaticObjective`'s own sentence.

The hold-back is then **bisected back toward 1** as the geometry settles, and
that half is not an optimisation — it is what makes the boundary meaningful. A
held-back lens reports the specimen further out than it is (∂ln a/∂ln D ≈ −0.1
flint-first, −0.2 crown-first, measured), so a hold-back of ε inflates the next
pass's aperture by ~0.2·ε; left where the ladder first found it, *that bias*
would have become the new wall. Driven to a floor of 1e-4 instead, the wall lands
on the converged design's own refusal ratio to **3e-13**. Only the aperture
refusal is retried: `achromaticObjective` now throws a distinct
`DoubletApertureRefusal` on the aperture branch, while the glass-pair branch — the
one where the scan finds nothing at all — stays an ordinary `Error`. The same
count § 6b.5.5 derives the prose from also decides the type, so the two cannot
disagree.

| Rung | Pinned to | Status |
|---|---|---|
| **EXTERNAL: everything it unlocked is 60–78× past Maréchal** — 3.45 waves at the old wall, 5.59 at the new | the § 6b.5.1 criterion, on the opened band | ✅ |
| …and **the diffraction-limited reach does not move at all** (0.10311) | negative control: this touched the refusal, not the optics | ✅ |
| The wall moves **+6.6% (4×) to +10.6% (40×)** flint-first, +3.0% to +5.7% crown-first | the literals, edited in the same commit that moved them | ✅ |
| **The lenses in the opened band are genuine solutions** — solved-for conjugate = used-at conjugate, ΣS_I null where used, stop = a·tan u exactly | § 6b.1's own two guards, at apertures that used to be refused | ✅ |
| **The retry is not slack**: past the wall it still refuses, and still names the APERTURE | the verdict survives | ✅ |
| **NEGATIVE CONTROL: ordinary apertures are untouched** — the 4×/0.10 is unchanged to 7 digits | the retry only ever engages on a refusal | ✅ |
| **A glass-pair refusal is not retried** — `DoubletApertureRefusal` on the aperture branch, ordinary `Error` when the scan finds nothing, and the DIN constructor passes it through | the type and the prose come off one count | ✅ |

**What it cost, stated as a loss.** § 6b.5.4's closed form gave the wall from M,
k and the glass pair alone — nothing from the built lens — and predicted the
engine to 1e-11. Its replacement is exact to 3e-13 but **self-consistent rather
than predictive**: a and s/f are the fixed point's *outputs*, so the lens has to
be built before the identity can be evaluated. The section keeps its exactness
and loses its closed form. That is a real reduction in what § 6b.5 can claim, and
it is recorded here rather than papered over by restating a weaker check in the
same words.

**And the honest summary of the whole thing: no usable aperture was unlocked.**
Every design between the old wall and the new one is tens of times past
diffraction-limited — the band opens at 3.45 waves and closes at 5.59. What the
fix buys is that the refusal now means what it says: the constructor walls out
where the *lens it has converged to* meets the solver's locus, not where an
arithmetic seed put a lens nobody was going to build.

**§ 6b.5.7 — the scan window's `3`, and the boundary it stops deciding.** The last
of § 6b.5's open items, and the one with the widest blast radius. S_I(c₁) is a
paraxial polynomial and does not know what glass can be bent to: past the wall it
grows a root at \|c₁\|/span → 3⁻ that is **five times hemispherical** and is not a
surface. Counting it made the refusal a property of the **scan window** — a wider
±span would have admitted it sooner — and made the message's own count mean
something other than what it said. `solveBendings` now rejects bendings with
\|c\|·(D/2) ≥ 1 **before** it counts, which is the sanity filter
`designs/lister` already applies to the roots of its two-dimensional scan.

| Rung | Pinned to | Status |
|---|---|---|
| **IDENTITY: the window constant is INERT over ±2 … ±5** — the surviving root set agrees to **1e-14**, same roots and same count | the literal `3` no longer reaches any verdict in that range | ✅ |
| …while the **raw** count still moves with it (2, 3, 3), which is what makes that a statement about the filter | negative control | ✅ |
| **F\* moves: 1.9042573 → 1.8372723** (s/f = 5) and **1.9175107 → 1.7397236** (infinity) | the boundary the rest of § 6b.5 pins | ✅ |
| **The DIN walls move OUT flint-first** (+4% at the 4×, +10% at the 40×) **and IN crown-first** (−7%, −8%) | the asymmetry is the finding, not a wash | ✅ |
| **EXTERNAL: the band gained is 78–106× Maréchal**; the band lost is bounded below at **41×**, and σ rises with NA across it | the same external criterion, in both directions | ✅ |
| …and **the diffraction-limited reach still does not move** (0.10311) | negative control | ✅ |
| **What the crown-first band lost was a design with only ONE of its pair a lens** — the refusal prints "found 2, of which 1 is a lens" | the mechanism of the loss, not just its size | ✅ |
| **The refusal stays MONOTONE in the focal ratio** over a factor of twelve, at two conjugates | what `refusalRatio`, `buildWall` and the app's `measureApertureWall` all assume | ✅ |
| **§ 6b.5.6's identity survives**: the wall is still the converged design's own F\*, to 1e-9, both orientations | the two fixes compose rather than interfere | ✅ |
| **NEGATIVE CONTROL: the 4×/0.10 is bit-for-bit** what it was | a filter that changed a working design would be a different commit | ✅ |

**What "inert" does and does not mean.** The scan lays 2000 samples across
±window·span, so the window still sets the *sample spacing*: widen it far enough
and sign changes between neighbouring samples start being missed, which is a
detection limit and not a verdict the window is entitled to. What the rung shows
is that over ±2 to ±5 — the range where the spacing is fine enough for this
curve — the surviving roots and the count do not move, where before the filter
the boundary was set by exactly where the window's edge fell. The claim is
scoped to that, deliberately.

**The boundary changes KIND, which is the part worth carrying.** Just inside the
wall the steeper of the two SA-null bendings sits at \|c\|·(D/2) = 0.9999; just
outside, it has passed 1 and cannot be ground. So what refuses is the glass
running out, not a scan convention — and the thickness dependence § 6b.5.2
measured goes with it: doubling or tripling either element used to scale the
locus **exactly** and now moves it by **under 2%**.

**It refuses designs that used to build, and that is not free.** Crown-first, the
scan was already finding one bending that is not a surface, and the constructor
was building on the pair anyway — picking the physical root by cancellation and
never noticing that the `branch: "steep"` alternative it advertises could not be
made. Those designs are refused now: **NA 0.1715–0.1846 at the 4×**, and the
equivalent band at every other magnification. The classical premise the
constructor implements is *two* bendings to choose between, and where only one of
them is a lens that premise has failed. The cost is stated rather than argued
away, and it is bounded on the external criterion: the refused band cannot be
measured where it was refused — those designs no longer exist — but σ rises with
NA, so all of it is worse than its bottom end, which is **2.94 waves, 41×
Maréchal**.

**Downstream, the same refusal moved two other walls.** § 6q's Plössl
clear-aperture wall goes **0.899195 → 0.9615248·f_e** and stays exactly
scale-invariant, which is the identity behind it saying the same thing at a new
number; § 6d.4's negative control on the single doublet's constructor ceiling goes
**0.2608 → 0.2874**. Both are the ghost no longer arriving, and both are edited in
the same commit — as are the app's D6.5 rungs and the eyepiece panel's own prose.

### Not yet pinned

- ~~**The seed, not the design, decides the wall**~~ — closed by § 6b.5.6 above.
  It was worth 2.9%–10.6% of aperture depending on magnification and orientation,
  all of it in a region § 6b.5.1 has already disqualified on Maréchal.

  **The witness this section did not have — ~~missing~~, BUILT, and then spent
  by § 6b.5.6, which had to edit every number in it.** `refusalRatio` bisects against the *live* constructor, so every
  rung above moves with a seed change instead of failing — including § 6b.5.4's
  closed form, which takes `F*` from it and would go on agreeing with itself at
  the relocated wall. The rungs would stay green while the boundary they describe
  silently went somewhere else. So the wall's **number** is now pinned as
  literals: **eight refusal apertures** (M = 4/10/20/40 × both orientations), the
  silica pair at two magnifications, a **coverslip** row — which the closed form
  does *not* reach, since a target ΣS_I ≠ 0 is absolute while S_I ∝ h⁴, so the
  refusal ratio there is not aperture-free — and what the seed costs, as a number.
  **It worked.** § 6b.5.6 could not land without editing all eleven of them
  (0.1843357 → 0.1965000 at the 4×, and so on) and without turning the closed
  form into a falsified control, so the commit that moved the boundary had to say
  so in its own diff. It also caught a defect the literals were not aimed at:
  § 6b.5.4's `predict/measured − 1 < 1e-11` was **one-sided**, and a prediction
  that falls 6% short satisfies it vacuously — that rung would have gone on
  passing at the relocated wall. It is two-sided now.
- ~~**The scan window is a stated constant.**~~ Closed by § 6b.5.7 — and the
  window turned out not to be a constant worth stating, because with
  non-physical bendings rejected nothing downstream can see it (over the ±2 … ±5
  range measured; the sample grid is laid over the window, so detection
  resolution still scales with it).
- **The OTHER `achromaticObjective` caller has not been looked at.**
  `microscopeObjective` — the infinity-corrected member of § 6a — is the third
  caller, and its own constructor wall moved 0.2608 → 0.2874 under § 6b.5.7
  (§ 6d.4's negative control measures it). It never got § 6b.5.6's treatment,
  because that fix was written for `finiteConjugateObjective`'s fixed point. If
  its placement solve seeds an aperture the same way, the same defect is sitting
  there unmeasured. Named rather than assumed: nothing here has looked.
- **Where the optical ceiling is for the OTHER forms.** § 6d.4 bisects the
  Lister's Maréchal reach and § 6b.5.1 now does the DIN doublet's; the
  infinity-corrected member of § 6a has neither.
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
  member the § 6a "high NA needs a different glass form" note anticipates.
  **Measured at [§ 6b.5](#-6b5--the-ceiling-and-whose-it-is): the edge is
  f/3.956 / NA 0.10311, so "at the edge" was right to 3%.** The
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
- **Telecentricity and immersion** remain exactly as § 6a left them; this step
  changes neither. The third of that trio, **the `objectNA` seed, is ✅ closed at
  [§ 1.5.1](#151--an-na-is-nsin-u-and-the-arm-holds-a-tangent)** — and not by
  this step or by the immersion one that was expected to need it, since both
  hand their chains a `stopRadius`. It took a *panel*.

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
- **Field beyond coma.** S_III–S_V now exist
  ([§ 6ac](#step-6ac--the-two-focal-surfaces-and-distortion)), so the reason this
  stays open has changed rather than gone: the Lister is a FINITE conjugate, and
  § 6ac's closed-form path refuses one rather than carry § 6b's chief-ray
  slope-vs-object-height convention untested. The traced focal surfaces are
  reachable here; the external number is not. An aplanat is not an anastigmat.
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
- ~~**Polychromatic brightfield.**~~ **Closed at § 6r.** The sum does run per
  wavelength now, and the sentence above was right about the shape and wrong
  about the grid: § 2e's resampler carries an energy Jacobian, and an Abbe image
  is an irradiance, so reusing it tilts the lamp's spectrum as 1/λ². What is
  still true is that every number *in this section* is monochromatic — S needs no
  wavelength conversion (§ 6r), so nothing here had to change.
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
disagreement with the incoherent limit would read as physics. (§ 6p generalized
it to a lattice stepping by *m* pupil steps and this became the m = 1 case, which
tightened one thing: `pupilSamples` must now be a power of two, because § 6p's
cache is bit-for-bit only where 2/N is exactly representable. Every count here is
16, 32 or 64, so no rung moved.) Under both
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
- ~~**Depth-dependent spherical aberration.**~~ **Closed at
  [§ 6l](#step-6l--depth-dependent-spherical-aberration).** It was exactly as
  scoped — a focal depth is one more layer on § 6e.1's stack, so no physics was
  added — and `DepthPupils` took its first real user beside § 6k.3's control.
  Two of this step's own results survived it and one did not: § 6k.1's flux
  invariance and § 6k.4's empty cone both hold (the SA is a pure phase, and the
  mount's aperture truncation does not vary with depth), while § 6k.1's axial
  *symmetry* breaks 19.24× for an emitter at a fixed depth.
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

## Step 6l — depth-dependent spherical aberration

The last numbered gap in the microscope branch, and § 6k's own named deferral.
§ 6k images a volume through a pupil that varies with depth **only by defocus**,
and a real specimen is mounted in something — water, glycerol, a resin — whose
index is not the immersion's. Focusing d below the coverslip drags the cone
through d of the wrong medium and adds spherical aberration **that grows with
d**: the dominant real defect of deep widefield and confocal imaging, and the
reason correction collars exist.

The step adds **no physics**. § 6c solves a plate to all orders and § 6e.1 the
N-layer stack; a focal depth is one more layer, t = d and n = n_s, and every
property of the stack transfers unchanged. What the rungs pin is that the reuse
is legitimate, what it costs, and the two places the branch's own habits mislead.

New: `depthOpdMm`, `depthFocusShiftMm`, `mountDepthScale`, `deliveredNaIntoMount`
and `mountDepthTolerance` in `designs/coverslip`; `imaging/depth-aberration`
(`MountSpec`, `mountAperture`, `mountWavefrontWaves`, `withMountAberration`,
`mountPupils`, `mountVolumeOptions`, `mountDefocusWaves`).

| Rung | Pinned to | Status |
|---|---|---|
| Literature depth OPD = stack wavefront + exact axial shift + piston, < 1e-17 at every q | Gibson–Lanni / Hell et al., derived independently | ✅ |
| The two forms' q⁴ coefficients disagree by 1.4115×, and the gap is the shift's own q⁴ to 1e-15 relative | closed form | ✅ |
| The shift IS § 6e.1's apparent distance: δ + d = `stackApparentDistanceMm` | engine identity | ✅ |
| Doubling the depth doubles the wavefront at every aperture, to 1e-14 | closed form (d is a bare factor) | ✅ |
| A mount matched to the immersion returns `toBe(0)` at every depth and aperture | algebraic identity (§ 6e.1) | ✅ |
| Delivered NA capped at exactly n_s; boundary refuses AT n_s, computes one ulp below | ray invariant q = n_s·sinθ_s | ✅ |
| At the wall the WAVEFRONT is finite (4.3039e-3 mm) and the LONGITUDINAL aberration diverges | rationalised forms' denominators | ✅ |
| Pupil truncation is a lattice POINT COUNT converging on (n_s/NA)², < 1e-3 by 256 bins | § 6i.2, closed form | ✅ |
| The depth budget is exactly 1/NA⁴ under both criteria, 24√5/14 apart | closed form | ✅ |
| Exact/third-order = 1.0203, 1.9417, 3.2870, 5.7947 at NA 0.2, 1.0, 1.2, 1.3 | exact stack vs its own leading term | ✅ |
| The third-order budget over-reports the BISECTED Maréchal depth by 4.51× at NA 1.2 (21.3 µm against 4.74 µm) and 1.25× at NA 0.6 | Strehl 0.8, bisected | ✅ |
| Paraxial focus-knob scaling = n_i/n_s = 1.13709, reciprocal 0.87944 | closed form | ✅ |
| The marginal ray's own depth ratio departs from it at order q² — ×4.00 per halving | third-order spherical | ✅ |
| Every plane's throughput constant with depth to 1e-12; the missing cone stays under 1e-12 | § 6k.1 / § 6k.4 | ✅ |
| A fixed depth makes the axial response 19.24× asymmetric where an unaberrated one is symmetric to 1e-12 | § 6k's sinc² control | ✅ |
| Best focus moves to +1.11 waves; Strehl at best focus 0.9606 / 0.7801 / 0.4386 at 2 / 5 / 10 µm | measured | ✅ |
| A rarer mount's W₀₄₀ opposes a denser slip's, at 33.28 µm of slip per µm of depth, summing to zero at the crossing | `stackW040Mm`'s sign rule | ✅ |
| `mountVolumeOptions` emits the four coupled numbers and refuses each override, while letting an explicit `undefined` through | engine identity | ✅ |
| Quoting the budget AT the mount's ceiling is refused — the cap is a supremum, not a maximum | sinθ_s < 1 strictly | ✅ |
| A matched mount reproduces § 6k's `defocusing` **bit for bit** | identity rung | ✅ |

### 6l.1 — the literature quotes it in a different reference, and the natural check reads backwards

Gibson–Lanni and Hell et al. quote the depth aberration as
OPD(q) = d·[√(n_s²−q²) − √(n_i²−q²)], which is `depthOpdMm` — derived here
independently of the stack (a ray leaving the buried source at θ_s against one
leaving the objective's nominal focus at θ_i, the two emerging parallel, with the
lateral offset of the interface crossing projected onto the shared emergent
direction). That is deliberately **not** written in terms of
`stackWavefrontErrorMm`, or the check below would be a rearrangement rather than
a pin.

The two are referenced to different points — the stack to the buried source's
**paraxial image**, the literature to the objective's **nominal focus** — and the
whole of the difference is the axial distance between them plus a piston, both in
closed form:

    OPD(q) = W_stack(q) + δ·[√(n_i²−q²) − n_i] + d·(n_s − n_i),   δ = d(n_i−n_s)/n_s

Residual **< 1e-17 mm at every q from 0 to 1.33**, and flat across the aperture
rather than growing, which is what separates an identity from a fit that happens
to be good near the axis. δ is not a second formula: δ + d is
`stackApparentDistanceMm` to 1e-18, so the shift IS § 6e.1's apparent distance
seen as a displacement.

**The trap, and it is worth the rung on its own.** The natural way to check two
wavefront expressions against each other is to compare their third-order
coefficients, and here that **fails**: −1.19130e-4 against −1.68153e-4 per q⁴ for
10 µm of water under oil, a factor of 1.4115. It is evidence of correctness. An
exact axial shift δ in a medium of index n is δ·[√(n²−q²) − n], whose expansion
is −δq²/(2n) − δq⁴/(8n³) − …: it carries q⁴ and every higher even order, and only
its *leading* part is defocus. Two expressions genuinely related by a refocus
therefore **must** disagree in q⁴ — and the disagreement here is the shift's own
q⁴ to 1e-15 relative. Comparing third-order coefficients cannot tell a wrong
wavefront from a differently-referenced one; only the all-orders identity can.

### 6l.2 — linear in depth exactly, and a matched mount is a hard zero

d is a bare factor in every stack formula, so doubling the depth doubles the
wavefront **at NA 1.3 as much as at NA 0.1** — 1e-14, not a small-aberration
approximation holding. And the layer carries (n_s²−n_i²) as an explicit factor,
so a mount matched to the immersion returns `toBe(0)` at every depth and every
aperture: § 6e.1's identity arriving where a microscopist meets it, and the whole
reason water and glycerol objectives exist.

The one property that does **not** transfer from § 6c is the one that matters: a
slip error is a fixed one-off, and depth is unbounded. Every mismatched mount has
a depth past which no objective is diffraction-limited.

### 6l.3 — the wall is the ray invariant, and it is not an aberration at all

A ray inside the specimen carries q = n_s·sinθ_s < n_s. **No ray of higher
invariant leaves the specimen**, whatever the objective's rim is engraved with, so
an oil objective labelled 1.40 collects at most **1.3347** from a water mount and
the outer annulus of its pupil is dark. The boundary is exact: q one ulp below n_s
computes, q = n_s refuses.

That is the fifth ceiling in this branch — after § 6b's f/4.1, § 6d's
NA 0.343, § 6e.4's NA 1.411 and § 6q's 0.88·f_e — and the only one that is a
single line of algebra. (Written as "the fifth *geometric* ceiling";
[§ 6b.5](#-6b5--the-ceiling-and-whose-it-is) later split that list and only
this one and § 6e.4's are geometric — § 6b's f/4.1 is an aberration edge,
§ 6q's a solver locus. "The only one that is a single line of algebra" was the
difference showing through before it was named.)

**It is a ceiling on the rays and not on the wavefront, and the two behave
oppositely there**, which is why the rung says which it pins.
`stackLongitudinalAberrationMm` carries √(n_s²−q²) in its *denominator* and
diverges — the grazing ray's axial crossing runs away, growing >20× over the last
decade of approach. The rationalised wavefront keeps that root as a *factor*
beside terms that stay finite, so W at the wall is an ordinary number,
**4.3039e-3 mm** for 10 µm of water under oil. Nothing blows up and nothing is
clipped by an aberration budget; the rays simply stop existing.

The truncation is an **amplitude**, so it costs flux. What the engine reports is
the fraction of pupil *lattice points* inside the ceiling — § 6i.2's finding
again, a count and not an area — converging on (n_s/NA)² = 0.90887 from 0.9391 at
16 bins through 0.9140 at 64 to within 1e-3 by 256, with no rate claimed for the
same reason § 6i.2 claimed none. A pupil the mount can carry whole is returned
**as the same object**, so a matched narrow system pays nothing for a wrapper that
does nothing.

### 6l.4 — the budget is 1/NA⁴, and it stops being a bound sooner than the slip's

`mountDepthTolerance` mirrors `coverslipTolerance` exactly: the W₀₄₀ coefficient
under Rayleigh's quarter wave and Maréchal's balanced residual, 24√5/14 apart, and
exactly 1/NA⁴ (16.000 between NA 0.5 and 1.0). At NA 1.0 into water under oil it
reads 11.542 µm and 44.244 µm. An aperture the mount cannot deliver is refused
rather than extrapolated, and a matched mount is refused outright — there is no
budget to report on a hard zero.

**But the third-order form dies far sooner against a mount than against a slip,
and the reason is structural.** A stack's exact wavefront outruns its own leading
term as the aperture approaches the *smallest* index in the stack, and for a mount
that index is the mount's — the smallest number anywhere in an immersion system.
Water under oil measures exact/third-order at

| NA | 0.2 | 1.0 | 1.2 | 1.3 |
|---|---|---|---|---|
| exact / W₀₄₀ | 1.0203 | 1.9417 | 3.2870 | 5.7947 |

where a D263 slip in the same oil is only at 2.4953 by NA 1.2, because 1.5254 is a
long way from 1.2 and 1.3347 is not.

What that costs is **measured, not estimated**. Against a Maréchal depth bisected
on the traced Strehl (§ 6d's discipline), the third-order budget over-reports by
1.25× at NA 0.6, 1.91× at NA 0.9 and **4.51× at NA 1.2** — where it says 21.3 µm
and the answer is **4.74 µm**. That last number is the classic "an oil lens on an
aqueous specimen is good for a few microns", produced rather than transcribed.

The function is kept in the third-order currency anyway, and says so: that is the
currency the literature's tolerances are quoted in and the one `coverslipTolerance`
uses, and a function that silently switched conventions between the slip and the
mount would be worse than one that names its own departure. § 6s reported its
map's error as an estimate and not a bound for the same reason.

### 6l.5 — the focus-knob scaling, and its spread across the aperture IS the aberration

Paraxially the buried source's image sits n_i/n_s farther than its geometric
depth, so the objective travels **1.13709 per unit of real depth** for oil into
water. A z-stack indexed by knob travel is therefore *stretched*, and the
correction multiplies nominal z by n_s/n_i = **0.87944**. Both currencies are
written down because this is the single most-inverted factor in the subject; the
ratio is checked against `stackApparentDistanceMm` rather than restated.

The real ratio is **aperture-dependent**, and that dependence is what spherical
aberration *is*. Read off `stackLongitudinalAberrationMm`, the marginal ray's own
depth ratio departs from the paraxial one at order q² — ×4.016 and ×4.004 per
halving of q, the ×4.00 that says third-order spherical and nothing lower, which
is the same statement as the stack's leading term being q⁴. At a working aperture
it is not a small correction: the marginal ray scales depth by **1.5902** at
q = 1.2 where the paraxial one says 1.1371. The depth scaling and the depth
aberration are one measurement rather than two.

### 6l.6 — the SA is a pure phase, so § 6k.1 survives and the cone stays empty

A depth's aberration changes no pupil amplitude, and the mount's own truncation
does not vary with depth either — so Σ|P|² is untouched and, by Parseval through
the engine's own FFT, so is every kernel's total. Throughput is constant to 1e-12
over 0 → 8 waves, and the missing cone read through `axialSpectrum` stays under
**1e-12** where § 6k.5's depth-varying *amplitude* control filled it to 0.05.

That is the precise sense in which this step changes what the image looks like
without changing what deconvolution could recover.

### 6l.7 — a fixed depth breaks the axial symmetry § 6k pinned

The other of the two questions the API refuses to blur: one emitter at a known
depth, the objective walked through it. Composed rather than given its own entry
point — `defocusing(withMountAberration(...))` — so a caller has to say which
question they are asking.

§ 6k's sinc²(π·w₂₀) is even in the defocus and the engine reproduces that to
1e-12. Add 20 µm of water under an NA 1.2 oil cone and the axial response is
**19.24× brighter one wave past focus than one wave before it**, and best focus
moves to **+1.11 waves**. The sign is the diagnosis and it is the one the physics
predicts: water is *rarer* than oil, the depth aberration is negative, and the
compensating defocus is positive.

Refocusing buys back the paraxial half and no more. Strehl at best focus falls
**0.9606 → 0.7801 → 0.4386** at 2, 5 and 10 µm — Maréchal crossed between 5 and
10 µm, consistent with 6l.4's bisected 4.74 µm.

### 6l.8 — a rarer mount opposes a too-thick slip, at a rate that kills the idea

`stackW040Mm`'s sign rule says a layer denser than the emergent medium
contributes positive spherical aberration and a rarer one negative. A D263 slip is
denser than the oil and a water mount is much rarer, so focusing **deeper**
partially cancels a slip that is too **thick** — § 6e.4's "the cover slip HELPS"
with a number attached.

The number kills it as a usable trade. The slip is nearly index-matched to the oil
and the mount is not, so the exchange rate is **33.28 µm of slip error per µm of
depth**: 10 µm of slip error is undone by 0.3005 µm of depth, and the two layers
at that depth sum to zero to 1e-18. Depth is the dominant term by a factor of
thirty, and a correction collar set for one cannot be trading against the other.

### 6l.9 — the coupling with no readout to catch it is refused, not documented

`renderVolume` turns a slice's millimetres into waves with W = ½·δ·NA²/n, and **n
there is the medium the geometry is in** — the mount, not the immersion.
`mountPupils` inverts that same map to recover each slice's absolute depth (affine,
so exact to 1e-14). If the two disagree, every slice is aberrated for a depth 14%
wrong, silently, with nothing in the resulting image to show it.

So the four coupled numbers are not the caller's to supply. `mountVolumeOptions`
emits NA, wavelength, refractive index and focus from the same `MountSpec` the
pupils were built from, the type removes them from the options it accepts, and
each is refused at runtime as well — a plain object reaching it through `any`
would otherwise reintroduce exactly the error the type was there to stop. This is
§ 6s's discipline with the radial map's identity, applied where there is no
readout to notice the mismatch. An explicit `undefined` is **not** an override and
is let through: three of the four are optional on `VolumeImageOptions`, so a
respread options object carries the key unset, and the spec's values are written
after the spread and would have won regardless.

One asymmetry is deliberate and pinned. `deliveredNaIntoMount` returns n_s, which
`withMountAberration` uses as a pupil mask and `mountDepthTolerance` **refuses** —
because n_s is a *supremum and not a maximum*: sinθ_s < 1 strictly, so the
aperture is approached and never reached. That is the right number for a mask,
where the boundary is one lattice point of measure zero, and the wrong one for a
budget, which would then be quoted for an aperture no ray has. The error message
says which rather than only naming the ceiling.

The identity rung closes it: a **matched** mount reproduces § 6k's own
`defocusing` **bit for bit**, values and `formedSum` alike, so every § 6k result
survives this step unaltered. And a whole volume renders through the new pupils
with each slice aberrated for its own depth, its planes still delivering equal
flux — § 6k.2 again, through machinery that could have broken it.

### Not yet pinned
- ~~**Off axis.**~~ ✅ **Closed at § 6y**, and the reason recorded here had
  expired before it was written: "the object-space ray aiming that would express
  it is § 6a's standing blocker" stopped being true at § 6u. What was really
  missing was narrower — every form in the stack takes the invariant as a bare
  radius, and a radius cannot express coma. See § 6y.
- **The chromatic half.** Every index is resolved at one wavelength, so a mount
  dispersive relative to the immersion is one λ at a time — the same deferral
  § 6e names. § 6r's per-wavelength machinery would carry it, at one stack per λ.
- **Correcting the objective FOR a depth**, rather than measuring what a depth
  costs. That is § 6c's `targetS1Mm` route with the mount's W₀₄₀ as the target,
  and it is what a correction collar physically does — § 6e.5 having already
  measured the collar's real job to be index and NA drift rather than thickness.
- **A depth-dependent radial map.** § 6s's table is built at one conjugate, and a
  mount moves the object plane. § 6s.6 names this as its own open item; the
  aberration does not move the chief ray's *height* map, but the refocus in 6l.5
  does move the plane it is tabulated at.
- **TIRF and the evanescent side of the wall.** 6l.3 stops at "the rays do not
  exist". What happens beyond n_s is a real imaging modality and it is not
  geometric optics.
- **Where § 6k.4's support edge goes under a mount, and it is not where 6l.6
  might suggest.** 6l.6 pins that the missing cone stays **empty** — the ν = 0
  null needs only an amplitude that does not move with depth, and the SA is a
  pure phase. It says nothing about the support *boundary* ν·(2 − ν), and the
  two come apart: that law is derived from a stack whose members differ by
  nothing but w₂₀, and a `mountPupils` stack's members differ by their own
  depth's spherical aberration as well. APP.md's D10 draws both beside each
  other and measures the edges moving by up to **10 axial bins** on the
  100×/1.25 in water while the null holds at ~2e-15. That is an app measurement
  at a 2% threshold on a leaked window, so it is reported as a departure and not
  as a number; what it would take to pin is a support boundary derived for a
  stack with a depth-varying phase, which is a different closed form and not
  this step's.
- **Whether a plane may sit above the coverslip.** Not a gap in the physics —
  the answer is plainly zero, since such a plane's light crosses only what the
  objective was corrected for — but nothing here refuses a negative depth, and
  the stack being *linear* in depth means it will cheerfully return the
  mismatch with the sign reversed. It never arises in these rungs because they
  all place a source at a stated positive depth. It arises immediately for a
  caller that *places a slab*, which is how D10 met it, and D10 handles it by
  anchoring rather than by clamping. If a second consumer appears, the refusal
  belongs in `withMountAberration` beside the aperture ceiling.

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

**On one on-axis frame it is very nearly invisible**, which is why § 6h could
defer it — and § 6n.5 measures how nearly rather than leaving it as a claim: a
rendered picture through the warped grid and through a uniform one differ by
**1.5e-6 of peak** on the axial frame. Not zero, and the earlier phrasing that
the cubic is "parts per billion" over a 46.77 µm half-extent was measuring the
wrong thing: it is parts per ten-million of the *object coordinate*, which is
still ~1e-2 of a **pixel**. § 6m is what changes the verdict — a tile sits at
millimetres, two tiles abut, and a straight specimen crossing the seam arrives on
each side through a different *linear* approximation to a map that is not linear.

| Rung | Pinned to | Status |
|---|---|---|
| A specimen point and a point emitter at it land in the SAME pixel, weight 1.000 | § 6i's `rasterizeEmitters`, bitwise | ✅ |
| …on axis and in a tile, at three pixels each | the convention, not one lucky index | ✅ |
| A pixel index round-trips through the forward map to 1e-12 | `imagePointAt`'s own convention | ✅ |
| The uniform map IS `imagePointAt` over \|M\| on the axial frame, to f64 | the control, named | ✅ |
| Both maps are exact at the frame centre, and differ everywhere else | the control is not a strawman | ✅ |
| **A straight object line BOWS, ×2.00 per doubling of field** | d²/dr² of § 6h.1's cubic | ✅ |
| …and as the SQUARE of the tile's extent — ×2.00 in pixels, since § 6h.2 ties the pixel scale to it | sagitta = curvature·L²/2 | ✅ |
| The sign is BARREL: r − \|M\|·h < 0, so a chord's ends are pulled in and the sagitta is positive | § 6h.1's departure, signed | ✅ |
| NEGATIVE CONTROL: the uniform map's sagitta is **identically zero**, at every field | a linear map has no curvature | ✅ |
| The bow is the map's own second difference, equal and opposite, to 0.3% | two readings of one number | ✅ |
| A bump recovers its own pixel through a rasterized picture, < 1e-5 px | round trip through the image | ✅ |
| …and misses by the CURVATURE: ×2.00 per doubling, converging from below | § 6n.2's law again | ✅ |
| CONTROL: the uniform map misses by the SLOPE — ×4.00 per doubling | § 6m.4's quadratic | ✅ |
| …so the gap between them DOUBLES per doubling: 16.8× at 0.4 mm, 257× at 6.4 mm | quadratic over linear | ✅ |
| CONTROL: and it is exact at the tile centre, 1e-12 — where a linear map cannot be wrong | why the rung samples pixel (20, 12) | ✅ |
| A pure phase specimen stays \|t\| = 1 in every pixel | amplitude is a point property | ✅ |
| Total \|t\|² is NOT conserved, grows as the field's square, and is 1e-5 | det J ≠ 1, and energy is no witness | ✅ |
| The result is the `ObjectField` `abbeImage` consumes, unchanged | § 6n is the authoring path only | ✅ |
| A warped specimen renders through `renderBrightfield` and rules `valid` | § 6f.9's verdict, on a warped grid | ✅ |
| …and survives `requireHonest`, on a traced 4×/0.10 at 6.4 mm | § 6g.3's bridge, composed | ✅ |
| **The two maps make different PICTURES: 2.8e-3 of peak at 6.4 mm** | the seam misregistration, seen | ✅ |
| CONTROL: on axis it is 1.5e-6 — present, 1800× smaller, monotone between | why § 6h could defer it | ✅ |

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

**And it is composed, because that is where the claim has to be true.** Every
sibling step in this branch closes on a traced objective — § 6f's readouts on
§ 6a's 4×/0.10, § 6g.3 and § 6h.5 on a composed one — and § 6n has the same
obligation, because "nothing downstream learns the grid was warped" is a claim
about the *consumer* and an assertion on an array's shape is not a witness for
it. So a bar grating authored in object millimetres is rasterized through both
maps in a tile at 6.4 mm and rendered by `renderBrightfield` on `tracedFieldPupils`:
the warped render rules `valid` and survives `requireHonest`, and the two
pictures differ by **2.8e-3 of peak** — the seam misregistration, at the level
it was always about, and the first time in this step it is a picture rather than
a coordinate.

The control is the axial frame, and it is the honest kind rather than the
convenient kind: the difference there is **1.5e-6 of peak, not zero**, because
the traced map is cubic and disagrees with a linear one at every field including
that one. What the axis buys is a factor of 1800, monotone in between. That
number is § 6h's whole deferral, measured at last: on one axial frame the
unwarped grid cost a millionth of the peak and deferring was right.

Both were rendered at size 64, and the engine picked it: at 32 the S = 0.6 source
shifts the pupil off a 32-bin frequency grid and `abbeImage` **refuses**, naming
50 as the smallest grid that carries it. § 6f's lattice guard doing its job in a
rung that was not written to test it.

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
- ~~**No tiles are composed yet.**~~ **Closed at
  [§ 6o](#step-6o--the-mosaic-and-its-guard-band).** § 6n removes the
  misregistration a seam would have shown; it does not lay one tile beside
  another. `renderMosaic` does, and the bow measured here is what a mosaic
  would have displayed.
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

## Step 6o — the mosaic and its guard band

§ 6m put a tile at an arbitrary field position; § 6n warped its grid so two tiles
agree about where the specimen is. `imaging/mosaic` lays them beside one another:
`mosaicLayout` places the tiles and says how much of each survives, and
`renderMosaic` rasterizes, images and crops each one into a composed picture.
Nothing is blended across a seam and nothing is resampled — a tile's kept pixels
are its own — which is what makes a seam error a **step** rather than a smear.

**The question a mosaic has to answer first is what a tile's own edge costs.** A
grid is finite and `abbeImage` is a transform, so the specimen outside the grid
is not absent but *wrapped*, and the image near the edge is formed from the wrong
neighbourhood. The guard band is the answer: render a tile whose grid runs past
the span that will be kept, and keep only the centre.

| Rung | Pinned to | Status |
|---|---|---|
| **The coherent crop BRACKETS guard^(−1/2)** — −0.435 and −0.533 straddle it by 13% and 6.6%, monotone | ∫\|h\|² over the Airy tail = 2π/d | ✅ |
| NEGATIVE CONTROL: an unguarded tile, rms 0.368 and worst pixel 55% of peak | not a tolerance — a different picture | ✅ |
| …and 16× the guard buys under 5×, so **no guard makes a coherent tile exact** | the tail is algebraic | ✅ |
| **A filled condenser beats it by a factor that DOUBLES per doubling of guard** — 22.9, 42.0, 84.8 | the two exponents differ by 1 | ✅ |
| …so 16 cells buy **286×** at S = 0.25 where the coherent limit bought 4.8× | the same table read as convergence | ✅ |
| **Refining the source alone drops the guard-16 error 7.1×** — 6.4e-3 → 9.0e-4 | 97 → 749 points, all else held | ✅ |
| …and the flat guard^(−0.3) tail appears only at the coarse sampling (−0.21, −0.36 against −1.31, −1.55) | the plateau arriving from underneath | ✅ |
| CONTROL: the coherent curve **cannot** move under refinement — it has one point | why § 6o.1 is the pinned exponent | ✅ |
| The same 749 points are NOT converged at S = 1: the curve goes flat, 2.80/2.91/2.92e-3 | `diskSource` spaces by 2S/samples | ✅ |
| The two surrounds carry identical total transmittance, to the last bit | a permutation of one multiset | ✅ |
| Dividing each image by its own mean changes nothing, at any guard or source | the DC control, both halves | ✅ |
| A guard is cells; pixels follow as size/pupilSamples, and both edges are cropped | § 6h.2's reciprocity | ✅ |
| A non-integral guard is **refused**, not rounded; so is one that eats the tile | `latticeMatchedSource`'s argument | ✅ |
| A one-tile mosaic with no guard IS `objectFieldTile`, bitwise | § 6m.1's idiom | ✅ |
| Uniform pitch is a **hundredth of a pixel** from the abutment fixed point across 17 tiles | D1's licence, measured | ✅ |
| …and with an EVEN tile count the two agree exactly, which is not a bug | no tile on the axis to walk from | ✅ |
| A mosaic renders through `renderMosaic`, rules `valid`, survives `requireHonest` | § 6g.3's bridge, composed | ✅ |
| **The seam step falls monotonically with the guard: 1.8e-2 → 7.8e-4** | on a traced 4×/0.10 at 1.6 mm | ✅ |
| With no guard the error is LOCALIZED at the seam — 90× its neighbour 3 px away | a seam, not a wrong tile | ✅ |
| …and by 8 cells it is no longer the worst pixel in its own neighbourhood | the residual has stopped being a seam | ✅ |
| **An anchored tile (i, j) is the layout's, bitwise — at 3×3 and at 5×5** | the pitch is read on the anchor and nowhere else | ✅ |
| …and a 5×5's inner ring IS the 3×3, tile for tile | the viewport is not in the answer | ✅ |
| A fractional index and an `"abutting"` pitch are **refused** | the fixed point is a finite mosaic's | ✅ |
| …and so is a tile laid out on one lattice and rendered on another | the crop would come from the wrong one | ✅ |
| **A tile rendered ALONE is the tile the mosaic composes, bit for bit** | nothing blends, nothing resamples | ✅ |
| CONTROL: two tiles differ in > 90% of their pixels | registration, not a flat picture | ✅ |
| NEGATIVE CONTROL: re-anchoring on the viewport costs 3.4e-3 px on a tile centre… | § 6m.4's ppm ruler drift, in pixels | ✅ |
| …and **16.0 px** a third of a tile off it | a fraction of a pitch, not a drift | ✅ |

### The external number is a closed form, and it lives in the coherent limit

A crop deletes δ = ∫_{|r|>d} Δt(r)·h(r) dr from every amplitude in the window.
With the deleted structure uncorrelated of variance σ² per unit area,
Var(δ) = σ²a·∫_{|r|>d}|h|², and for an Airy amplitude h ~ r^(−3/2) that integral
is ∫_d^∞ r^(−3)·2πr dr = **2π/d**. Under a coherent source the intensity error is
2Re(A·δ*) and therefore carries δ itself, so it falls as **guard^(−1/2)** — no
coefficient, nothing fitted, just the tail integral of the Airy amplitude.

`coherentSource()` is **one point**, so the source sum is exact and no quadrature
residual can contribute: the measured decay is the crop's and nothing else. It
reads −0.033, −0.334, −0.435, −0.533 over guards 1 → 2 → 4 → 8 → 16, monotone.

**It brackets −1/2 rather than converging to it, and the rung says so.** The
first version of this step asserted a monotone approach from above; the last
slope is −0.533, which is *past* −1/2, and asserting an approach would have been
claiming a convergence the numbers do not show. The probe is squeezed from both
ends and the closed form is the infinite-surround law that neither end reaches:

- **at small guard the window's own width dilutes it.** The window is 8 cells
  across, so a chord of it sits between `guard` and `guard + 4` cells from the
  crop — § 6n.3's correction of order W/d — and the slope reads *shallower*.
- **at large guard the surround is finite.** The probe's two specimens differ
  only out to the grid edge, so the integral it measures is ∫_d^R and not
  ∫_d^∞, and a truncated tail falls *faster* than the untruncated one.

The second reading is checked rather than assumed, because it would otherwise be
a story that fits: the slope tracks **d/R** and not d. At R = 64 cells the same
d/R = 0.5 gives −0.524 against this lattice's −0.533, and d/R = 0.25 gives −0.375
against −0.435. So −1/2 is straddled by consecutive slopes, by 13% and 6.6%, and
that bracket is what the rung pins.

**The partially coherent exponent is NOT pinned anywhere here**, and that is
deliberate rather than an omission — it moved from −1.31 to −1.82 across the
grids probed, because a finite grid truncates the same tail integral at its own
edge. What is pinned is the coherent limit, where the closed form is clean, and
the *ratio*, which is lattice-stable.

### Two things this step measured that Part D's feasibility table did not

**1. The guard DOES depend on the coherence, and the coherent limit is the worst
case.** D0.2 concluded "the guard does not grow as the diaphragm closes", and was
careful to add that S = 0 was not measured and not claimed. It is measured here,
and the coherent limit is worse than a filled condenser by 22.9, 42.0 and 84.8×
at guards 4, 8 and 16 — **one factor of two per doubling of the guard**, so the
two illuminations' exponents differ by exactly 1. D0.2's plateau across
S = 1 → 0.25 stands; what does not survive is reading it as an S-independent law,
which ROADMAP.md said in those words and APP.md implied. Both are corrected.

**2. D0.2's ~4e-3 floor is the CONDENSER'S OWN QUADRATURE, not h's algebraic
tail.** This is the finding, and it is the kind D0.2's own "one hypothesis
measured down" paragraph exists for — that paragraph tested a DC artefact, found
the predicted magnitude and W-scaling both matched, and correctly rejected the
mechanism. There was a probe artefact; it was simply a different one.

At the *same* guard, the *same* specimen and the *same* lattice, taking the
condenser from D0.2's own 97 points to 749 drops the guard-16 error **7.1×**,
6.381e-3 → 8.966e-4. A tail that a source sampling can move is not the impulse
response's. The mechanism is visible directly in the slopes: at 97 points the
curve goes flat past guard 4 (−0.214, −0.356), which is D0.2's guard^(−0.3)
exactly; at 749 it is still falling steeply (−1.310, −1.546). The plateau was the
sum's residual arriving from underneath, not the crop levelling off.

**The control is what makes that a measurement rather than an inference:** source
refinement is a knob the coherent case does not have. Its sum is one term and is
exact, so its curve cannot move — and it does not.

**And the same 749 points are not converged at S = 1.** `diskSource` spaces its
points by 2S/samples, so a count converged at S = 0.25 is four times too coarse
at S = 1, and the witness is that the guard curve goes **flat**: 2.795e-3,
2.910e-3, 2.923e-3 at guards 4, 8, 16. That is the residual and not the crop.

> **Corrected by [§ 6p](#step-6p--the-commensurate-condenser-and-the-cached-pupil).**
> This paragraph originally continued: "§ 6p's commensurate condenser is what
> fixes it, which is why that step is not only about speed — it lowers the
> mosaic's error floor." **It does not.** A commensurate source *is*
> `diskSource`'s lattice — § 6p.1 pins the two bitwise — so no property of the
> image can depend on the commensurability, and 812 commensurate points at S = 1
> reproduce this very plateau (3.68e-3 → 3.63e-3 over guards 4 → 16) slightly
> *worse* than the 749 above. What un-flattens the curve is **3 228 points**
> (8.2e-4 → 1.7e-4, slope −1.13). § 6p's contribution is that 3 228 *traced*
> directions became affordable: the floor is the point count, and that step
> changes its price rather than its value.

### One hypothesis raised against this table and measured down

A discrete source lattice of spacing δ = 2S/samples makes μ(Δ) periodic with
period 2/δ = samples/S resolution cells — at 97 points that is 44, 22 and 11
cells at S = 0.25, 0.5 and 1.0, the last sitting *inside* the guard band. If that
revival were the mechanism, holding δ fixed while S varied would flatten the row.
It does not: at guard 8 the fixed-spacing row reads 8.128e-3, 3.707e-3, 1.866e-3
(spread 4.36) where the fixed-count row reads 8.128e-3, 9.440e-3, 1.136e-2
(spread 1.40). At fixed spacing the error falls as 1/S, which is 1/√(point count)
since points ∝ S² there — the ratios are 2.19 and 1.99 against a predicted 1.99.
So the variable is the **number of points averaging the residual down**, and the
revival is not the mechanism. Recorded because it would have changed the reading
of § 6o.3 and it is a hypothesis a reader will have too.

### The probe, and why it is built the way it is

The lattice is held fixed — one `pupilSamples`, one grid, one pupil sampling —
and the only thing that varies is how far out the specimen is the true one: two
specimens identical inside a box of half-width W/2 + guard, and **permutations of
one multiset** outside it. Independent draws would differ in total transmittance
by ~1/√N and T(0) reaches every pixel through the pupil at every source point,
laying a floor of the probe's own making across the whole table. Both halves of
the control are pinned — the multiset bitwise, and the per-image mean
normalization to within 3% at every guard and every source.

128 at `pupilSamples` 64 is **two pixels per resolution cell**, and it was chosen
against `abbeImage`'s own lattice guard rather than for tidiness: a source point
at S needs `size ≥ ceil(pupilSamples·(1+S)) + 2`, so 2 px per cell is the finest
sampling S = 1 admits at *any* grid. What it buys is that a 749-point condenser
costs 0.6 s a render there and 9.6 s at 256 — the difference between § 6o.3 being
a rung and being a footnote.

### The pitch is not the span, and the solve is skipped on the licence D1 gave

Each tile reads its own ruler at its own centre (§ 6m), so tile k's useful span in
millimetres is `usefulPixels · pixelScaleMm_k` and the two neighbours of a seam do
not agree about it. Exact abutment is therefore a **fixed point**, not an
arithmetic. § 6m licensed skipping the solve if the drift was measured, and this
is the measurement: 3.7e-5 px across 3 tiles, 2.2e-4 across 5, 1.6e-3 across 9 and
1.3e-2 across 17, by which point the outer tile is 2.24 mm off axis. Growing and
monotone, so it is the ruler's real field dependence and not f64 noise — it is
simply far below the pixel that would make it matter. `"abutting"` is implemented
anyway, because a drift is only meaningful against the thing it drifts from.

With an **even** tile count the two schemes agree exactly, and that is named
rather than left to look like a measurement of nothing: with no tile on the axis
the innermost pair straddles it half a span out on the reference ruler, which is
where both put it. The drift appears only once a tile is placed *from* another.

### The seam needs a reference, and a wider frame is not available

"The step across a seam" is not well defined against nothing: the two sides
sample different object points, so a raw column difference is not the error — and
a wider reference frame is exactly what § 6h.2 says cannot be built. The
reference is **a third tile centred on the seam**, § 6n.2's "two readings of one
number" move, compared along the row through the tile centres so it sits at the
same field point in *both* coordinates. On a traced 4×/0.10 at 1.6 mm with a bar
grating authored in object millimetres, the step falls 1.768e-2 → 1.320e-2 →
8.531e-3 → 7.81e-4 of peak as the guard goes 0 → 2 → 4 → 8 cells.

With no guard the error is **localized at the seam** — 1.8e-2 there against
1.9e-4 three pixels away, and it is the worst pixel of its own neighbourhood.
That is the shape a viewer reads as a grid line, and it is what the guard
removes: by 8 cells the seam is no longer the worst pixel near it, and what
remains is the tile's own floor, which § 6o.3 says is this 21-point source's
quadrature rather than the crop.

### § 6o.8 — the anchored tile, and what a pannable stage needs on top

The rungs above ask `renderMosaic` for one finite picture at a time. A **stage**
does none of that: it renders tiles singly, out of order, in several workers, and
keeps them in a cache across pans. Each of those verbs is an assumption about the
construction, and two of them needed pinning before APP.md's A7 could claim them.

**A tile rendered alone is the tile the mosaic composes — bit for bit.** Nothing
is blended across a seam and nothing is resampled (§ 6o.5), so an isolated tile is
not an approximation of the composed one; it is the same arithmetic. `renderMosaic`
is now literally a loop over `renderMosaicTile` plus a paste, and the rung compares
two tiles of a 3×3 against the composed picture pixel for pixel with `toBe`. The
control beside it is that those two tiles differ in more than 90% of their pixels,
so the equality is a statement about registration rather than about a picture that
is the same everywhere.

**A tile's identity is its index from the anchor, not the viewport it was asked
from.** `mosaicLayout` reads its pitch on the tile nearest *its own* centre, which
is exactly right for a finite picture and wrong for an unbounded one — recentre the
layout on wherever you have panned to and the same piece of specimen lands in two
different places depending on how you got there. `mosaicTileAt(system, options, i,
j)` puts tile `(i, j)` at `anchor + (i, j)·pitch` with the pitch read on the anchor
and nowhere else, and the rung pins it bitwise against `mosaicLayout`'s own tiles at
**two viewport sizes** — a 5×5's inner ring is the 3×3, tile for tile.

**The negative control is the version a stage writes by accident, and it splits
into two very different sizes of mistake.** Re-anchored on a tile *centre* the cost
is **3.4e-3 px** eight tiles out: § 6m.4's parts-per-million ruler drift, arriving
where it can be counted in pixels, and small enough that it would never be noticed.
Re-anchored where a viewport actually is — a pan is not a whole number of tiles —
the grid moves by that fraction of a pitch: **16.0 px** of a 48-pixel span a third
of a tile off centre, nearly four orders larger, and the whole picture jumping on
every pan. So what anchoring protects is the **lattice**, not the ruler, and a
`(col, row)` cache key is legitimate for that reason rather than by convention.

`"abutting"` is refused here rather than approximated: its fixed point is walked
outward from the centre of a *finite* mosaic, so it is defined by the tile count,
which is the dependence an anchored index exists to remove. § 6o.6's measurement is
the licence — the uniform pitch it would converge to sits ~1e-3 of a pixel away. So
is a **tile laid out on one lattice and rendered on another**: `renderMosaicTile`
takes its crop from the options and its pixels from the tile, so a mismatch is a
plausible picture of the wrong piece of specimen and nothing downstream could tell.

**Measured while wiring A7, and it corrects Part D's cost model.** D0.1 priced a
tile by its Abbe sum (76 ms at ps 32 / grid 128, ideal pupil) and every arithmetic
in Part D was built on that. On a **traced** tile with § 6p's cache the sum is no
longer the bill: at grid 128 / ps 32 it is 180 ms against **1 001 ms** for
`rasterizeSpecimen`, and at grid 64 / ps 32 it is 61 ms against 292 ms. § 6n's
warped grid bisects a traced chief ray per pixel to mantissa exhaustion, so the
raster is 4.8–5.6× the imaging and the affordable tile size is set by it. That is
the deferral § 6n named and attributed to § 6p — which landed as the *pupil* cache
instead — so the radial map cache is still open, and it is now the dominant cost of
a traced tile.

### Not yet pinned

- **A mosaic under a non-telecentric condenser.** § 6h hands every patch the same
  `CondenserSource` with its points centred on the pupil, which says the
  illumination cone stays centred at every field point. A real condenser's cone
  tilts off axis; `shiftPupil` is already the operator that would do it. § 6a's
  object-space ray-aiming blocker, arriving where it finally bites.
- **The converged crop exponent under partial coherence.** It is lattice-bound at
  every grid affordable here, because a finite grid truncates the tail integral at
  its own edge. What is pinned instead is the coherent limit and the ratio.
- **A guard chosen for a caller.** § 6o measures what a guard costs; it does not
  recommend one, because the answer depends on S, on the source sampling and on
  the error a caller will accept — and the honest deliverable was always a bound.
- **The cost.** A tile pays for its guard at full price and throws it away: 64 px
  with an 8-cell guard at 2 px/cell keeps 36% of what it computes. D0's arithmetic
  puts a 4×'s real 5 mm field at ~181 tiles, and § 6p is what makes that minutes
  rather than hours.
- **One objective**, still — every number here is the DIN 4×/0.10's.

## Step 6p — the commensurate condenser and the cached pupil

§ 6o's mosaic costs one `abbeImage` per tile and one inverse transform per
illumination direction inside each — and on a *traced* objective the transform is
not the expensive part. `pupilFunctionFromOpd`'s callback re-traces rays, and
`abbeImage` calls it once per lattice point **per source point**, so the traced
multiplier over an ideal pupil is a flat 8–10× (Part D, § 2). This step removes
it, and removes nothing else.

`commensurateSource(S, pupilSamples, stepMultiple)` spaces the condenser's
directions by a whole multiple of the **pupil's own** frequency step 2/N instead
of by the source-chosen 2S/samples. Then every direction reads the pupil at the
same coordinates as every other, the union of all the shifted sub-lattices is one
grid, and the pupil can be evaluated once over its support and read back by index
for every direction after the first. `illumination/abbe` does that, call-locally,
and reports what it cost as `pupilEvaluations`.

| Rung | Pinned to | Status |
|---|---|---|
| **Cached ≡ uncached, BIT FOR BIT** — every pixel, 5 lattices, both parities | `toBe`, not a tolerance | ✅ |
| …and `maxGridPhaseStepWaves`, a max over directions, is the same number | `toBe` | ✅ |
| …and it survives the bridge: a traced tile through `renderBrightfield` | § 6g.3, composed | ✅ |
| **The saving is EXACTLY `contributingPoints`** — one pass over the support, not one per direction | counted, integer | ✅ |
| `pupilEvaluations` is the calls the pupil receives, not a prediction of them | instrumented callback | ✅ |
| An ordinary source's boxes are not even equal: 100 033 over 97 is 1031.3 apiece | the fractional offset | ✅ |
| The construct is `diskSource`'s lattice **bitwise** wherever `diskSource` is exact | `toBe`, 5 lattices | ✅ |
| …and the one place they differ (5.6e-17) is the one place `gridCoordinate` rounds | `1/24` is not dyadic | ✅ |
| `latticeMatchedSource` IS the `stepMultiple` = 1 case | § 6i, generalized not duplicated | ✅ |
| A fractional count, a non-dyadic `pupilSamples`, a fractional multiple: **refused** | `latticeMatchedSource`'s argument | ✅ |
| NEGATIVE CONTROL: a source that DECLARES a lattice it is not on **throws** | the declaration is the trigger | ✅ |
| …and one declared for another `pupilSamples` is simply not used, and says so | no silent fallback | ✅ |
| The allowed ladder is measured: 4.56e-3, 1.78e-2, 3.38e-2, 1.34e-1 at m = 1…8 | § 6f.2's `maxTransferError` | ✅ |
| **`stepMultiple` 4 is already past § 6f.2's "wrong enough to notice"** — 3.4e-2 | that step's own 3e-2 | ✅ |
| …and the way out is `pupilSamples`, not the multiple: (0.5, 128, 2) ≡ (0.5, 64, 1) | `toBe`, same 812 points | ✅ |
| An allowed count must be MEASURED — 15/16/17 read 1.29e-2, 1.78e-2, 8.94e-3 | § 6f.2 is not monotone | ✅ |
| **Commensurability is accuracy-NEUTRAL**: the same transfer as `diskSource`, exactly | `toBe`, 4 frequencies | ✅ |
| **812 commensurate points at S = 1 are as flat as § 6o's 749, and worse** | § 6o.3's plateau, reproduced | ✅ |
| …and what un-flattens it is 3 228 points: 8.2e-4 → 1.7e-4, slope −1.13 | the count, not the lattice | ✅ |

### The exactness is arithmetic, not just algebraic

"The same sum in a different order" is only bit-for-bit if the order does not
round. Illuminating from s samples the pupil at (ix − n/2)·Δ + s; the cache
indexes by (j + p/2)·Δ, where j is an integer and p ∈ {0, 1}. Those agree
mathematically for any commensurate source and agree *in f64* only when Δ = 2/N
is a power of two — then (ix − n/2)·Δ, s and their sum are all exact multiples of
Δ/2 and no operation rounds. So `commensurateSource` **refuses a `pupilSamples`
that is not a power of two** rather than tolerating a last-bit difference, and
`latticeMatchedSource` inherits the requirement. Every brightfield lattice in the
engine is 16, 32, 64 or 128, so this costs nothing.

It is load-bearing rather than decorative, and § 6p.1 shows where: the
constructor builds its coordinates as one integer product times one exact scale,
and that is bitwise identical to `diskSource`'s at S = 0.5, 0.25 and 1 — but
differs by **5.6e-17** at S = 0.75 with `stepMultiple` 2, where `gridCoordinate`
divides by 24 and 1/24 is not representable. Physically nothing; exactly enough
to make the cached image not the uncached one. The point *count* is unchanged, so
nothing about the disc moved.

**The parity is the second half of the index, and it is not a corner case.**
s = (2i + 1 − samples)·m·Δ/2, so every coordinate is a whole number of
half-steps, and they share one parity: odd exactly when the source grid has an
even count *and* the multiple is odd. `latticeMatchedSource` at S = 0.5 and
`pupilSamples` 64 is 32 across with m = 1, so it lands there — this is § 6i's own
"an even count is the same lattice offset by half a step" arriving as an array
index. Both parities are in § 6p.3.

### The saving is the point count, exactly — and it is the *only* saving

The shifted pupil is supported on |u| ≤ 1 whichever direction it came from, so
every source point visits the same box. The cache fills that box once; the
uncached path fills it per direction. So `pupilEvaluations` falls by exactly
`contributingPoints` — an integer, asserted as one, rather than a wall clock.

An ordinary `diskSource` does not even have a fixed box: its points sit at
arbitrary fractions of Δ, so the box is 32 or 33 samples wide depending on where
the fraction falls, and 97 directions cost 100 033 evaluations — 1031.3 apiece,
which is no whole box at all. That is the same fact from the other side.

**What it buys, measured, and what it does not.** On the DIN 4×/0.10's traced
pupils through `renderBrightfield`, cached against uncached runs **7.21× at 52
points, 10.76× at 208** (and 3.61× at 12, where the transforms are already most
of the cost). On an *ideal* pupil the same shapes run 239 ms against 233 ms —
**no saving at all**, because there the FFTs are the whole bill. Both halves are
reported: the step removes the traced multiplier and touches nothing else, and a
speed claim without its null half would be a claim about the wrong quantity.

### The correction: § 6p is a speed step, and § 6o said otherwise

§ 6o.3 wrote that "§ 6p's commensurate condenser is what fixes this, which is why
that step is not only about speed", and APP.md's D5 said the same. **Both are
wrong**, and this step's own rungs are what say so — the same shape of correction
§ 6o made to D0.2's feasibility table, arriving one step later.

- **Commensurability is accuracy-neutral.** `commensurateSource(S, ps, m)` is
  `diskSource(S, S·ps/m)` — the same lattice, and § 6p.1 pins it bitwise. So no
  property of the image can depend on the declaration, and § 6p.6 confirms the
  transfer is identical to every digit.
- **A commensurate source of comparable size reproduces the plateau.** Re-running
  § 6o's own guard probe at S = 1: `diskSource(1, 31)`'s 749 points read 3.07e-3
  → 2.98e-3 over guards 4 → 16, and `commensurateSource(1, 64, 2)`'s 812 read
  3.68e-3 → 3.63e-3. Flat, and *slightly worse* — which is the count and not the
  lattice.
- **What un-flattens it is 3 228 points.** Hold the spacing at the pupil's own
  step and the count follows S² to 3 228, and the curve falls again: 8.2e-4 →
  1.7e-4, a slope of −1.13 against the 812-point curve's −0.01.

So the honest statement is that the floor is set by the **point count**, and
§ 6p changes which count a traced pupil can *afford* — 3 228 traced directions
were ten times out of reach and are now merely expensive. It does not lower the
floor at a given count. That distinction is the whole difference between a rung
and a slogan.

### And the same measurement corrects D0.3's premise for the API

Part D asked for a source that was commensurate **and coarse** — around 100
points, where `latticeMatchedSource` fixes 3 217 at S = 0.5 and `pupilSamples`
128. `stepMultiple` was to be the knob. It is not a usable one: at S = 0.5 and
`pupilSamples` 64, multiples 1, 2, 4, 8 read **4.56e-3, 1.78e-2, 3.38e-2,
1.34e-1** on § 6f.2's own metric, and multiple 4 — 52 points — is already past
where that step's "a coarse source is wrong by enough to notice" rung fires.
Commensurability is not what makes a source affordable; the **cache** is.

The way out is the scale rather than the multiple, and it is exact:
`commensurateSource(0.5, 128, 2)` and `commensurateSource(0.5, 64, 1)` are the
same 812 points, so raising `pupilSamples` moves the allowed ladder without
coarsening it. The recommended configuration is therefore `stepMultiple` 1 at a
`pupilSamples` whose S·ps is the count that converges — which is
`latticeMatchedSource`, now affordable.

**The ladder must be measured at each allowed count, not interpolated.**
Commensurability restricts the count to divisors of S·pupilSamples, and § 6f.2's
convergence is explicitly not monotone doubling-by-doubling: 15, 16 and 17
directions across read 1.29e-2, 1.78e-2 and 8.94e-3 at S = 0.5, while 31, 32 and
33 run the other way. No even/odd law is minted — the rung pins the
non-monotonicity itself, and the mechanism is § 6f.2's, that the rim's midpoint
errors cancel by different amounts at different counts.

### Not yet pinned

- **The cache under a field-varying pupil, amortized across patches.**
  `renderBrightfield` gives every patch its own `PupilFunction`, so the cache is
  strictly call-local and each patch pays its own single pass. That is correct
  and it is also the ceiling: a mosaic of 181 tiles × P patches builds 181·P
  caches. Sharing one across patches would be sharing across *different pupils*,
  which is the correctness hazard the call-locality exists to prevent.
- ~~**A commensurate ANNULUS.** `annularSource` has the same lattice available and
  does not declare it.~~ **Built at § 6ab.19** as `latticeAnnularSource`, with the
  cache identity measured bit for bit. Phase contrast is still a v2 item (§ 6f).
- **The wall-clock figures are measurements, not rungs.** 7.21×/10.76×/3.61×
  traced and the ideal-pupil null are reported above and are not asserted
  anywhere: a timing assertion is flaky, and `pupilEvaluations` is the same claim
  in a currency a test can hold.
- **One objective**, still — the traced numbers are the DIN 4×/0.10's.

## Step 6q — the eyepiece on the intermediate image

The step that makes the branch's chain something you can **look through**. Every
microscope rung before this one ends at an image — a sensor, a grid, a mosaic
tile — and APP.md's Part D named the missing piece precisely: an eyepiece, and
the reason one could not simply be composed.

The reason is one line of `afocalTelescope`. Its objective↔eyepiece separation is
solved from a ray entering **collimated**, `{y: 1, u: 0}` — an object at
infinity. That is what a telescope objective sees. A microscope eyepiece
collimates a real *intermediate image* formed a finite distance in front of it,
so the ray that has to leave flat starts at the **specimen**, and the separation
that flattens it is a different number. `collimatingGap` is that solve, and it is
affine for the same reason the telescope's is: the free transfer across g is the
only place g enters the output slope, so two evaluations pin the line and its
zero is exact rather than iterative.

**The negative control's sign is the diagnosis, and it is the opposite of the
obvious guess.** The telescope's gap is 150.8 mm *short*, which sounds like it
would leave the image inside the eyepiece's front focus and the exit beam
diverging. It does the other thing: 55.8 mm of gap against an intermediate image
188.2 mm out puts the eyepiece **132 mm in front of the image it is supposed to
collimate**, so its object is virtual and the exit beam **converges** to a real
point 14.2 mm past the eye lens. `exitVergenceDiopters` reads **+70.5 D**, and
positive is the unusable side — accommodation only ever adds positive power, so
an eye cannot bring converging light to focus at any effort. The failure is
therefore not "more than an observer can accommodate" but the wrong side of
infinity, which is a stronger statement and the one the rung pins. The sign was
read off the trace rather than reasoned about, after the reasoning went the other
way.

Everything else here is a closed form the composed trace can refuse.

| Rung | Pinned to | Status |
|---|---|---|
| **The composed exit is collimated for the SPECIMEN** — vergence < 1e-8 D, all three instruments | the afocal condition | ✅ |
| **Solved gap = intermediate image distance + the eyepiece's own FFD**, to 1e-12 relative | closed form, as a check | ✅ |
| The eyepiece's FFD is 27% short of its focal length — the solve is thick-correct | thick-group first order | ✅ |
| A powerless / negative second module is refused rather than solved | negative control | ✅ |
| **`afocalTelescope`'s gap on the same pair leaves +70.5 D** — 280× a quarter diopter, and CONVERGING, the side no eye can accommodate | the step's own reason | ✅ |
| **M_visual = M_obj·(D/f_e)** from the REAL chief ray, both architectures | angular magnification | ✅ |
| **The sign, pinned by a magnifier**: one positive lens reads +D/f (erect); the compound instrument is negative | textbook orientation | ✅ |
| M is exactly ∝ the near point D — the convention carries no ray | dimensional, by construction | ✅ |
| M grows 20% toward the field edge and converges cubically as h → 0 | § 5n distortion, this conjugate | ✅ |
| **The two object NAs are exactly tan u and sin u**: their ratio is sec u to f64, at two apertures | closed form | ✅ |
| **Exit pupil = D·NA/\|M\| with the PARAXIAL NA** — 1e-5 at NA 0.10, 1e-7 at NA 1.40 | Lagrange invariant | ✅ |
| ...and with the SINE NA it misses by exactly √(1−NA²) − 1 at NA 0.10 | closed form | ✅ |
| **...and by 61% at NA 1.40** — the textbook 500·NA/M is wrong by a factor of 2.5 there | measured departure | ✅ |
| Eye relief = exit pupil − eye-lens vertex, and it shortens with f_e | pupil imaging | ✅ |
| **`limiting` selection flips exactly where the exit pupil crosses the iris** (bracketed f_e 40/39) | § 5p, on this conjugate | ✅ |
| **Above the crossover the detail ratio does not move with M** — flat to 1e-6 over a 4× sweep | Lagrange, M cancelling | ✅ |
| Below it the ratio is exactly ∝ M — ratio/M constant to f64 | the iris fixed, M carried | ✅ |
| λ cancels: the ratio is 1 at F, d and C while M, the NA and the exit pupil all move | both limits ∝ λ | ✅ |
| **500·NA and 1000·NA fall out of two exit-pupil conventions** — the digits appear nowhere | inverted Lagrange | ✅ |
| **The field number is a REAL stop**: h = 2.49 mm traces, h = 2.51 vignettes, bracketing FN/(2·M_obj) | the tracer's own rim | ✅ |
| Specimen circle = FN/M_obj — 5 mm at 4×, 2 mm at 10× | field-stop conjugacy | ✅ |
| The field stop disturbs neither the gap, the magnification nor the exit pupil | it limits field, not aperture | ✅ |
| Exactly one aperture stop survives the splice, on surface 0; a second is refused | § 6a/§ 5q's own scars | ✅ |
| The computed Plössl's clear aperture walls out at ~0.88·f_e | § 5j's doublet form | ✅ |

### The near point is a convention, and it is the third one

250 mm joins § 6a's 200/180/165 tube-lens focal lengths and § 6b's 160/150 tube
lengths as a number that is **stated and not computed with silently**. It is a
claim about human eyes, not about optics; it is quoted as 250 mm and as 10
inches (254 mm) by different sources; and every magnification here is a *ratio*
against whichever value is passed in. The rung is that M is exactly proportional
to D — so the digits move the label and no ray.

The **field number** is the second convention and it is a different kind: it is a
property of a particular eyepiece, engraved on its barrel, and it is what
actually sets the visible circle. This step does not print it — it splices a real
annular surface at the intermediate image, so a field beyond it is clipped by the
tracer. The specimen circle is FN/M_obj, which is why a 4× with FN 20 shows 5 mm
and no arrangement of the optics widens it.

### The sign was wrong, and a magnifier is what caught it

The first implementation read M = θ_out/(h/D) and returned **+40** for a compound
microscope, which is upside down — the image is inverted. The convention that was
missing is that a bundle *arriving* at the eye with slope θ came from a source
the observer must look toward at angular position −θ, while an object held at the
near point sits at +h/D.

What settled it was not the algebra but a **degenerate case with a known
answer**: a single positive lens with the object on its front focus is a
magnifier, and everyone knows a magnifier is erect at +D/f. On the corrected
definition it reads +5.00 at f = 50 mm and the microscope reads −40, which is
§ 5l's Keplerian sign arriving on the other conjugate. The rung is kept as a
control rather than deleted once it passed.

### Which numerical aperture the Lagrange invariant takes

The step's sharpest finding, and the § 6h move repeated: pin the law that holds,
then **measure what the plausible alternative costs** where it stops being a
rounding error.

The exit pupil obeys h·NA = −r_xp·θ_out — the Lagrange invariant, with the chief
ray crossing the axis at the exit pupil and the marginal ray at the object.
Dividing by the visual magnification's own definition gives

    r_xp = D · NA / |M_visual|

which is the textbook "exit pupil = 500·NA/M mm" with the 500 shown to be 2·250
and nothing else. **But it is a statement about paraxial slopes**, and the engine
carries two different object NAs:

- `objectNumericalAperture` — n·**sin** u, from the real marginal ray as it
  leaves the specimen. The defining number of a microscope, the one on the
  engraving, and the one Abbe's sine condition is about.
- `paraxialObjectNumericalAperture` — n·u from the entrance pupil's own geometry.
  With the stop on surface 0 and nothing between it and the specimen the marginal
  ray is a straight line, so this is exactly n·**tan** u.

Their ratio is therefore exactly **sec u = 1/√(1−NA²)**, and that is pinned to
f64 at NA 0.10 and NA 0.15. The invariant holds with the tangent one (1e-5 at
NA 0.10, 1e-7 at NA 1.40, both being the real chief ray's own departure from
paraxial) and the sine one misses by exactly √(1−NA²) − 1 = −0.50% at NA 0.10.

**At NA 1.40 that gap is not a correction, it is the answer.** On the 100×/1.40
oil the paraxial figure is **3.55** — larger than the immersion oil's own index,
so it is not a physically realizable aperture at all; it is a slope, and Lagrange
is a law about slopes. Feeding the law the sine NA instead misses the traced exit
pupil by **61%**, a factor of 2.5. So the formula every microscopy text prints is
exact on a 4×/0.10 to two parts in a million and wrong by a factor on an oil
immersion objective, and this step measures which.

### Empty magnification, stated rather than quoted

The useful range 500·NA to 1000·NA is a rule of thumb, and reproducing it would
pin nothing — it is two exit-pupil conventions and an inverted Lagrange
invariant, which is exactly how `usefulMagnificationRange` produces it (the
digits 500 and 1000 appear nowhere in the engine). The *content* is the reason
behind it, and that is a statement the engine can make:

    detail ratio = |M_visual| · p / (2 · NA · D)

— the finest detail the objective delivers, in units of the finest the
observer's working pupil p can carry, where p is whichever of the exit pupil and
the iris is narrower. § 5p's two-stop competition decides that, on the trace,
via `apertureStop: "limiting"`.

**Below the crossover the ratio is exactly proportional to M**: the iris is
fixed, so magnification buys real resolution (0.398 → 0.995 over M = 10 → 25,
with ratio/M constant to f64). **Above it the ratio does not move at all** —
because there p *is* the exit pupil, which is D·NA/|M|, so the M cancels
identically. Measured flat to 1e-6 across M = 25.6 → 100, and the residual is
the real chief ray's own departure from paraxial rather than anything physical.

That exact invariance is what "the image gets bigger without getting better"
means, and it is a stronger claim than the rule it explains: past the crossover,
magnification **cannot** change whether the eye resolves what the objective
transmits, at any M. The crossover itself is where the ratio reaches 1 — the
exit pupil equalling the iris — and `limitingStop` flips there without being
told to.

**λ cancels**, which is worth saying out loud because it is the one place a
reader expects a wavelength and there is none: both limits scale with it —
Abbe's λ/(2·NA) and the pupil's own λ/p — so where magnification stops paying is
a property of the geometry alone. The convention is Abbe's period against the
pupil's cutoff period, which puts the crossover at 1; Rayleigh's criterion would
put it at 1.22 and change nothing about the independence.

### Two predictions this step corrects

**APP.md D6 said `visualSystem` and `afocalProperties` "compose unchanged". They
do not**, and the doc has now been wrong in the same direction six times.
`visualSystem` calls `afocalTelescope` internally, so it places the eyepiece for
an object at infinity — the exact error this step exists to fix — and
`afocalProperties` reads its magnification off a `{y: 1, u: 0}` collimated input,
a quantity a finite-conjugate chain does not have. What *does* compose unchanged
is everything downstream of the spacing: `plosslEyepiece` and `huygensEyepiece`
(an eyepiece prescription does not know what is in front of it), `reducedEye`,
and `apertureStop: "limiting"`. The pupil half of `afocalProperties` survives
too — the exit pupil is the stop imaged through whatever follows it, whatever the
object does — which is why `microscopeVisualProperties` is short.

**And § 5j's doublet form walls out again, in a new place.** A field number of 20
needs 20 mm of eyepiece glass, and the computed Plössl admits a clear aperture of
about **0.88·f_e** — 22 mm at f_e = 25, refusing 24, with each doublet at ~f/2.27.
So FN 20 sits near the wall rather than comfortably inside it, and a genuinely
wide field is a different eyepiece *form* — the transcribed patent members
(Erfle/Nagler-class), still blocked on real published prescription data — not a
wider aperture on this one. That is the same pattern as § 6b's f/4.1 ceiling,
§ 6d's NA 0.343 wall and § 6e.4's NA 1.411: **the form stops existing before it
stops being good.**

**[§ 6b.5](#-6b5--the-ceiling-and-whose-it-is) corrects the mechanism here, and
the eyepiece conclusion survives it.** This wall is not merely the same *pattern*
as the microscope doublet's — it is the same *wall*: `achromaticObjective`
finding a third S_I root once its ±3·span bending scan admits one, at a curvature
about five times hemispherical. That is why this rung measured the wall as
scale-invariant in f_e — the refusal carries no length by construction. So "the
form stops existing" is the right shape of claim with the wrong agent: what stops
is the solver's two-lens bracket, and the honest statement is that FN 20 sits
inside *what this engine will build* — at the edge of it when this was written,
with room since § 6b.5.7 moved the wall out to 0.9615·f_e. Whether the glass itself would run out
there is a Maréchal question this rung does not ask.

*The 0.88 above is a bracket — the two builds this rung makes — and not the wall
itself. Bisected it is **0.9615248·f_e** (0.899195 until § 6b.5.7 stopped the
doublet's bending scan counting a root no glass can be bent to), and it is a
**constant**: the Plössl form is exactly scale-invariant, so the fraction does not
move with focal length at all, and the only thing that breaks it is
`plosslEyepiece`'s own air-gap default `max(0.3, 0.02·f_e)` below f_e = 15. That measurement is an **app** one and lives
in APP.md D6 and `packages/app/test/eyepiece.test.ts` rather than here, because
bisecting where a constructor refuses is not new physics and mints no rung. It is
recorded here so the next reader does not re-derive it, and so "about 0.88" is not
mistaken for the number.*

### Not yet pinned

- **The retinal image itself.** `visualMicroscopeSystem` composes the eye and
  hands back a focal system ready for `psf()`, but no rung here forms one — the
  empty-magnification claim is made on pupils and the Lagrange invariant, which
  is where it is exact. A retinal PSF sweep showing the diffraction pattern grow
  in lockstep with the magnification is the natural next rung and is a
  measurement of § 6q.7 rather than a new capability.
- **The eyepiece's own aberrations at this conjugate.** § 5m's Plössl was solved
  and pinned for the telescope's; nothing here re-measures its coma or field
  curvature working on an intermediate image, and the 20% edge distortion above
  is reported, not decomposed.
- **Polychromatic.** One wavelength throughout. § 6r has since landed and is the
  branch's colour step, but it stops at the intermediate image — nothing here
  runs a spectrum through the eyepiece, and lateral colour through one is still
  § 5o's Huygens theorem waiting for a caller.
- **Real eye relief ergonomics and the field lens.** Eye relief is read off the
  pupil imaging and not compared to any spectacle-wearer standard, and no field
  lens is inserted to shorten it.
- **The exit pupil off axis.** Everything above is the axial pupil; pupil
  aberration and the vignetting a real eyepiece shows at the field edge are
  § 6h's open item, inherited.

## Step 6r — polychromatic brightfield

Every brightfield rung before this one is monochromatic: one wavelength, one
pupil, one grid. A lamp is a spectrum, and a stained section is a specimen that
absorbs part of it — so colour here is not a finish applied to a grey image, it
is what the image is made of. The step is the Abbe sum run per wavelength, and
almost all of its difficulty is one thing: **the ruler**.

Two quantities cross the wavelength boundary and they behave oppositely.
**S does not need converting.** The coherence parameter is NA_cond/NA_obj, a
ratio of numerical apertures, which is the same reason `illumination/abbe` may
take its object in reduced coordinates — so one `CondenserSource` serves the
whole band, including a commensurate one (§ 6p), whose lattice is tied to
`pupilSamples` and not to λ. **`pupilSamples` does.** It counts frequency bins
across the pupil *diameter*, and what physical frequency a bin carries depends on
the pupil's size in wavelengths. `imagePixelScaleMm` is ∝ λ, so at fixed `size`
and `pupilSamples` every wavelength's image arrives on a grid of a different
physical size, and its frame is proportionally wider. Adding the arrays
bin-for-bin is **§ 2e's error committed again**, one branch over — it rescales
each wavelength instead of stacking it, and it looks entirely plausible.

So each wavelength gets its own `objectFieldTile`, and the planes are resampled
onto one common physical grid before anything else touches them.

| Rung | Pinned to | Status |
|---|---|---|
| **A clear field images to exactly 1 at every `size` and `pupilSamples`** | measured, not derived | ✅ |
| The two resamplers differ by exactly k², and only one leaves a density alone | closed form | ✅ |
| **A clear field under an equal-energy lamp is § 3a's own white, at every pixel** | § 3a's continuous integral, < 1e-4 | ✅ |
| The planes' scales span λ exactly; the ruler is the bluest sample | `imagePixelScaleMm` ∝ λ | ✅ |
| **The Jacobian branch reproduces an SED tilted by 1/λ², exactly** | the observer alone, 10 places | ✅ |
| **Energy is not the witness — the wrong branch loses none of it** | negative control | ✅ |
| The plane that sets the ruler is copied **bit for bit** | k = 1 identically | ✅ |
| A common grid that would reach outside a source is refused | the stencil's reach | ✅ |
| A crop that cannot be shared **centrally** is refused, at any size | § 6n.2's pixel convention | ✅ |
| `size` and `croppedPixels` disagreeing is refused rather than one winning | one knob | ✅ |
| **The MEAN scale puts a coloured vignette on a neutral field** | negative control | ✅ |
| **A dye absorbing the middle of the band images magenta on neutral white** | the purple line's direction | ✅ |
| **Tinting the monochrome image gives the stain and the field the SAME hue** | negative control, < 1e-12 | ✅ |
| Each wavelength's traced frame is its own size, extents ∝ λ | § 6h.2's closed form | ✅ |
| A neutral specimen stays neutral through the whole **traced** path | § 3a, < 2e-3 | ✅ |
| **Refocusing to a wavelength's own paraxial plane removes exactly its chromatic defocus** | § 1's chromatic shift + § 1.5's defocus wavefront, < 8% | ✅ |
| The achromat's crossing and its **sign flip** both survive the trace | achromat theory | ✅ |
| **The bluest plane is worst-resolved by 2.56×, where λ alone gives 1.22** | measured | ✅ |
| Lateral colour is exactly zero on axis and **linear in field**, < 1% | third-order theory | ✅ |
| On a dry front-stopped objective the two condenser conventions are **identical** | geometry, bitwise | ✅ |
| On an oil objective they part by 0.85% across 450–650 nm | the oil's own Cauchy series (§ 1) | ✅ |

### 6r.1 — the premise is measured, not derived

The whole step turns on what an Abbe image's `intensity` *holds*, and it is not
what a PSF's holds. `wave/polychromatic` resamples with a Jacobian `k²` because
`Psf.intensity` is energy per pixel: change the pixel size and each one holds
more. An Abbe image is an **irradiance** — a value at a point — so warping it is
pure coordinate substitution and carries no Jacobian, exactly as
`imaging/specimen` argues for the amplitude transmittance one layer earlier.

That is asserted rather than reasoned about, because the two are the same type
and the difference is invisible in it: a clear field images to **exactly 1** at
(32, 16), (64, 16), (64, 32) and (128, 64) — not close to each other, the same
f64 number. A density that drifted with the grid would be an energy in disguise.

### 6r.2 — the negative control, and why energy cannot see it

Reusing `wave/polychromatic`'s resampler is the architecturally tempting move:
one function, already written, already pinned. It multiplies each plane by
(λ_ruler/λ)², which **tilts the lamp's spectrum as 1/λ²** and turns a neutral
specimen blue. The rung pins that as an identity rather than as "different": the
measured chromaticity of the wrong branch reproduces, to ten places, the
chromaticity of the same lamp with a 1/λ² tilt computed from the observer alone,
and it sits 0.02 from neutral where the honest path holds 1e-4.

**Energy is not the witness, and that is why the mistake would survive review.**
Nothing is lost on either branch — every plane is multiplied by a constant — so
a conservation check is satisfied by both. The rung states it in the currency
that makes it concrete: the same field, the same optics, two readings whose
integrals differ by a factor of 2.9, and no check on the arrays can say which is
right. That is a question about what the array *holds*. This joins § 6g.2 and
§ 6k.4 on the list of places this engine records that energy is not a witness —
and here the witness is a **colour cast**.

### 6r.3 — the common grid is the bluest plane's, and strictly interior

`wave/polychromatic` centres its common grid on the mean wavelength and reports
what falls off the edge (`truncatedFraction`). That is right for a PSF: the
energy is compact, near the centre, and a truncated skirt is a number a caller
can weigh. An extended brightfield image has no skirt — it fills the frame — so
whatever the resampler cannot source is a **black border**, and since the frames'
extents go as λ, the border's width goes as λ too. A λ-dependent black border is
a coloured vignette, and it is indistinguishable by eye, and by any energy check,
from optics. Measured: on the mean scale, the corner of a *clear* field lands
0.05 from the centre of the same field in chromaticity, and on the red side.

So the fix is to make truncation impossible rather than to report it. The common
scale is the **smallest** of the planes' — taken over the planes as measured,
not assumed to be the shortest wavelength's, since the reference sphere and exit
pupil are traced per λ too — and the output is cropped by one pixel on each side
because a bilinear stencil needs `x0 + 1`. Truncation is then zero by
construction, and a caller asking for more is refused with the reason rather than
handed the border.

One consequence is worth having and is pinned in § 6o.8's currency: at the plane
that *sets* the scale, k is exactly 1, every destination lands on a lattice point
and the bilinear weights collapse, so **that plane is copied bit for bit** rather
than interpolated. Without it, "the ruler is the bluest plane's" would be a
rounding rather than a statement about arithmetic.

That identity is also what makes the crop's **parity** load-bearing, and it is
refused rather than rounded. `resample` maps a destination to
srcSize/2 + (x − size/2)·k, so an odd number of dropped pixels puts the two
grids' centres half a pixel apart: k = 1 stops being an identity, the ruler plane
gets interpolated and every plane shifts with it. That is § 6n.2's class of bug —
half a pixel of misregistration, invisible in the picture — so it throws, and the
rung checks it well inside the reach bound as well as at it, to show that what is
being refused is the centring and not the stencil running off the edge.

### 6r.4 — a stain is the specimen, and not the display

§ 3b's milestone in this branch's own currency, negative control and all. There,
the tempting wrong implementation renders the monochrome polychromatic PSF and
tints it, producing a plausible coloured star with no fringing in it. Here it
produces a plausible *stained* section in which the stain and the clear field
around it are **the same hue** — which is exactly what a stain is not. A grey
image multiplied by one colour has identical chromaticity at every pixel by
construction, so the difference that is the whole point reads zero to 1e-12 on
the very specimen that stains most, while the per-wavelength path moves the stain
0.05 off the background and toward the purple line.

A `SpectralSpecimen` is a `Specimen` that reads a third argument, and "neutral"
is defined as ignoring it. That is why `rasterizeSpecimen` is unchanged: it is
called once per wavelength with `nm` already bound, so nothing below the
authoring layer learns that a spectrum exists — the same seam § 6n keeps for the
warp.

### 6r.5 — axial colour, in the wavefront the sum is actually formed with

APP.md asked for the doublet's axial colour to show up as the focal shift § 6b's
design implies. It does, and the measurement **joins two closed forms already on
the ladder rather than minting a third** — § 3b's move: § 1's chromatic focal
shift says where each colour focuses, § 1.5's W = ½·δ·NA²·ρ² says what a focus
error costs in waves, and what § 6r adds is the wavefront the Abbe sum is formed
with.

It is read as a **difference** — as-built minus refocused — and that is what
makes it a measurement rather than a fit. The DIN 4×/0.10's traced pupil carries
~0.44 waves of residual defocus at its own design wavelength, so the absolute
coefficient is not the chromatic shift and never was; moving the image plane to
each wavelength's own paraxial focus removes the chromatic part and leaves the
residual where it is. Across 450–700 nm the measured removal matches the
predicted defocus to within 8%, and the excess is **systematic and monotone**:
6.6% at 450 nm falling to 2.9% at 700 nm. That is the diagnosis as well as the
tolerance — a wrong pupil→image scale, NA or pixel size would bias every
wavelength the same way, so a residual that shrinks with λ is chromatic, which
makes it the objective's own spherochromatism.

The **sign flip is the control**. An achromat's focal-shift curve has two zeros,
and between them the paraxial focus falls in front of the design plane rather
than behind it. On this objective the curve crosses at ~500 nm — where predicted
and measured both collapse below 0.005 waves *together* — is negative at 550 and
positive at 700, and the traced defocus follows it every time.

**And the practical consequence is the one a caller has to act on.** § 6f's
lattice criterion is phase per pupil sample, so a stack sized at the design
wavelength is under-sampled in the blue by the ratio of wavelengths — 1.22 here,
which would be unremarkable. It is not 1.22. The axial colour above puts a whole
extra wavefront on the blue plane and the measured ratio is **2.56**. So a
polychromatic brightfield stack's `pupilSamples` is set by the **blue end**, not
by the design wavelength, and `brightfieldFidelity` says so out loud: at 32 bins
the blue plane rules `no-honest-image` while 550 and 650 nm rule `valid`, and at
64 all three are valid. Every traced rung here runs at 64 for that reason.

### 6r.6 — what concentric frames carry for free

The per-λ frames share a wavelength-independent `centreMm` and everything inside
them is traced at their own wavelength: the chief-ray inversion, the reference
sphere, the exit pupil. So the object point a given *image* position looks at
moves with λ — **lateral colour, arriving because the frames are concentric and
for no other reason**. Nothing in the module codes for it.

Pinned to the law rather than to the engine's own number: primary transverse
chromatic aberration is linear in field height, so each doubling of the field
must double the separation, and it does to better than 1% at 1, 2 and 4 mm. On
the axis there is no field height for it to be proportional to and the two maps
agree to the last bit, which is the control that says the separation is the
field's doing and not the inversion's.

### 6r.7 — one condenser for the band, and which convention that is

Reusing a single `CondenserSource` across the band says S is held constant, and
that is a **statement about the condenser**, not a free simplification: holding S
is a diaphragm that tracks the objective's own NA across the band, while a
physically fixed diaphragm holds NA_cond and lets S drift with the objective's
dispersion. § 6q's move — "any panel printing an exit pupil has to pick, and this
is which" — in the condenser's currency.

On the DIN 4×/0.10 the two are **the same convention, exactly**, and the reason
is geometry rather than luck: a DIN objective carries its stop on its own front
vertex, so the entrance pupil *is* the stop, sitting in object space with no
glass between it and the specimen. The marginal ray's launch angle is then a pure
ratio of distances, and n = 1 in air carries no dispersion either — there is
nothing for λ to act on, and `objectNumericalAperture` returns the same f64
number at 450 and 650 nm.

Where the exactness comes from is visible in what breaks it. NA is n·sin u, and
§ 6e's oil is a Cauchy series, so on the 100×/1.40 the same geometric cone is a
different numerical aperture at each wavelength: 0.85% across 450–650 nm, bluer
being higher. That is well under § 6f.2's own sampling convergence, so nothing in
this step turns on the choice — but the step says which one it made.

### Not yet pinned

- **A polychromatic mosaic.** `halfExtentMm` is ∝ λ, so a tile's useful span and
  therefore § 6o's pitch and guard band are wavelength-dependent. Composing one
  means fixing the lattice by a reference λ and cropping every other λ to it,
  which is a design question this step deliberately does not answer. § 6f's "one
  field point, on axis, like the rest of § 6" is the precedent, and § 6o's guard
  closed form is monochromatic until it is redone.
- **A singlet-versus-achromat objective contest.** § 3b's headline is that a
  singlet fringes and an achromat does not, and its *substance* is reproduced
  here — the colour is the optics and the specimen, not the display (§ 6r.4), and
  the doublet's own axial colour is measured (§ 6r.5). What is missing is the
  contest itself, because there is **no singlet finite-conjugate objective in the
  engine**: `finiteConjugateObjective` is built on `achromaticObjective`, whose
  split divides by V₁ − V₂, so a single-glass "doublet" is not a degenerate case
  of it but a different design. Building one is its own step with its own rungs.
- **Per-wavelength contrast through the sum.** § 6r.5 measures the axial colour
  in the *wavefront*; nothing here measures a grating's modulation depth per λ
  and shows it fall at the band ends. That is the readout an app panel would
  print, and it is a measurement of this step rather than a new capability.
- **A real lamp.** Every rung runs an equal-energy illuminant, because that is
  what § 3a pins a chromaticity for. A tungsten filament is `blackbodySpectrum`
  and composes with no code change; what is absent is a rung saying the rendered
  white *is* that lamp's white.
- **The stain itself.** § 6r.4's dye is a Gaussian absorbance authored in the
  rung, exactly as § 6f's gratings are measurement fixtures. Real haematoxylin
  and eosin transmittance curves are published data the engine does not carry,
  and a rung pinned to them would be the strongest version of this step.
- **Non-uniform and non-telecentric illumination**, unchanged from § 6f and
  § 6h — inherited, not made worse.

## Step 6s — the radial map, tabulated

The first step on this ladder whose subject is **cost**. § 6n's rasterizer asks
`objectHeightForImageRadius` where each pixel looks, and that inverse bisects a
traced chief ray to mantissa exhaustion — ~60 chief rays, 0.12 ms — once per
pixel. D4 measured what that means for a traced tile and it was not what Part D
had assumed: at grid 128 / `pupilSamples` 32 the raster is **1 001 ms** against
the Abbe sum's 180, so the rasterizer and not the transform was the bill. § 6r
then multiplied it by the number of wavelengths. § 6n deferred the cache and
attributed it to § 6p, which spent itself on the pupil instead; this is it.

**A speed step's rungs are identity rungs, and the anchor is the ladder's own
exact map.** Nothing new is claimed about the physics. The external number is
Lagrange's remainder — the interpolating cubic through four nodes has

    |error| ≤ max|∏(r − rᵢ)| · max|f⁗| / 4!  =  (9/16) · h⁴ · max|f⁗| / 24

— and everything else is measured against the bisection § 6m and § 6n pin, which
stays the default everywhere so that no rung on this ladder runs through an
interpolant. The cache is **opt-in**, and it touches only where the specimen is
*sampled*: `fieldPupilAt` keeps inverting exactly, because it is patch-rate
rather than pixel-rate and because the pupil is the physics.

**Why a cache is possible at all is a physical statement, not a software one.**
The systems are axially symmetric, so "where does this pixel look" is a function
of one scalar — the absolute image radius — with the azimuth carried through
untouched, which is how `objectPointAt` was already written. A tile's 16 384
pixels are therefore 16 384 queries of a **single curve**, and the curve belongs
to the *system* rather than to the tile, so one table serves a whole mosaic.

| Rung | Pinned to | Status |
|---|---|---|
| **`heightAt(0)` is exactly zero, from the Lagrange weights** | the map's own oddness, bitwise | ✅ |
| The mirrored node below the axis is the map, not a boundary condition | the exact bisection, < 1e-15 mm | ✅ |
| An axial tile's centre pixel lands on the axis **bitwise**, and its grid registers | exact map, < 1e-12 px | ✅ |
| **×1.5 of node count costs ×1.5⁴ of error; ×4/3 costs ×(4/3)⁴** | Lagrange remainder, within 7% | ✅ |
| The map's reported error **estimate under-reads the truth by 7–17%** | the exact map | ✅ |
| The error stops falling at the rounding floor, ~4 ulp of the object height | f64 | ✅ |
| **Registration is 3.8e-13 px — nine orders below § 6o.8's 3.4e-3** | § 6o.8's ruler drift | ✅ |
| **Nine** inversions already place a pixel to 6e-11 px | exact map | ✅ |
| A traced, illuminated, cropped tile is the same picture | exact map, < 1e-12 of peak | ✅ |
| The saving is an exact integer: `inversions` = nodes + 1 = 65 vs 16 384 | § 6p's currency | ✅ |
| One table covers a 4×4 mosaic — every corner of every tile inside its span | the map is the system's | ✅ |
| **Tabulating the residual instead of the height buys nothing** | negative control, < 1% | ✅ |
| A table from another wavelength is refused | § 6r's per-λ frames | ✅ |
| A table traced with another `launchZ` is refused | the table's identity | ✅ |
| A radius past the end is refused rather than extrapolated onto | `objectHeightForImageRadius`'s rule | ✅ |
| Frames at two wavelengths covered by one table is refused | § 6r | ✅ |
| § 6r's spectral planes are unchanged, one table per wavelength | exact stack, < 1e-12 | ✅ |
| The `"uniform"` control ignores a table, because it inverts nothing | § 6n's negative control, bitwise | ✅ |

### 6s.1 — the axis is exact because the map is odd

The first interval's stencil wants a node at −h and there is no chief ray there.
There does not need to be one: the object height reaching an image radius is
**odd** through the axis — the same axial symmetry the map's one-dimensionality
comes from — so the node below zero is minus the node above it, exactly. It
costs no trace and it is not an extrapolation.

What it buys is that `heightAt(0)` is **bitwise** zero rather than nearly zero:
the Lagrange weights at t = 0 are (0, 1, 0, 0), the node at the origin is not
traced because it is zero by symmetry, and the product is exactly `0`. So an
axial tile's centre pixel lands on `centreObjectMm` with `Object.is`, and the
alternative — clamping a small radius, or tracing the origin and accepting its
residual — would have put the centre of every axial frame a rounding off the
axis. § 6n.2's class of bug, and the reason it is asserted bitwise.

The far end has no such trick, so one node is traced **beyond** the requested
radius and every query is strictly interior to its stencil — § 6o's and § 6r's
construction, third use. A radius past the built range is refused with both
numbers in the message.

### 6s.2 — the order is the closed form, and the estimate is not a bound

The ladder is walked in two ratios rather than in doublings, because the claim is
an *order* and a third-order scheme would give 3.38 and 2.37 where a fourth-order
one gives 5.06 and 3.16. Measured, on a 2 mm off-axis tile of the DIN 4×/0.10,
over the span a mosaic asks for:

| nodes | error (mm) | in pixels | fall | predicted |
|---|---|---|---|---|
| 4 | 1.293e-12 | 8.8e-10 | | |
| 6 | 2.676e-13 | 1.8e-10 | 4.83 | 5.06 (×1.5) |
| 8 | 8.704e-14 | 6.0e-11 | 3.07 | 3.16 (×4/3) |
| 12 | 1.787e-14 | 1.2e-11 | 4.87 | 5.06 |
| 16 | 5.884e-15 | 4.0e-12 | 3.04 | 3.16 |
| 32 | 8.882e-16 | 6.1e-13 | — | floor |
| 64 | 5.551e-16 | 3.8e-13 | — | floor |

So the scheme is fourth-order, which is why it is 4-point Lagrange and not
Catmull-Rom: Keys' a = −1/2 kernel is the obvious choice, is C¹ where this is
only C⁰ at the nodes, and is **third**-order. The C¹ kink is a derivative
discontinuity in a quantity whose absolute error is 1e-15 mm, so it is bought
cheaply.

**The estimate the map reports is an estimate, and it leans one way.** A fourth
difference is f⁗ at *some* point inside its stencil; the remainder formula wants
the maximum over the interval. Measured, `errorEstimateMm` under-reads the true
error by 7–17% at every node count where truncation decides — 1.166, 1.100,
1.078, 1.069, 1.085 — consistently and in the same direction. It is reported
anyway, and named an estimate rather than a bound, because it is what tells a
caller whether more nodes would buy anything: past 32 nodes the estimate keeps
falling ×h⁴ while the measured error flattens at ~4 ulp of the object height,
and the **gap between them is how the floor announces itself**.

### 6s.3 — nine orders below the smallest error the branch has cared about

The currency is the one § 6m.4 and § 6o.8 established: pixels of registration.
At 64 nodes the cached map places a pixel of a 2 mm off-axis tile **3.8e-13 px**
from where the exact bisection places it. § 6o.8 measured the two registration
errors this branch spends its design on — 3.4e-3 px of ruler drift on a tile
centre, and 16.0 px of lattice offset a third of a tile off it — so the cache
sits nine orders below the smaller of them.

The practical form of § 6s.2's order is that **the table does not need to be
large, it needs to exist**: 8 nodes is nine chief-ray inversions for a whole tile
and already places a pixel to 6e-11 px. The default of 64 is chosen to be
obviously past the floor rather than tuned to it, because 65 inversions against a
128² tile's 16 384 is not a budget worth economising on.

### 6s.4 — the saving, as an integer and as a clock

`inversions` is `nodes + 1` exactly — § 6p's currency, an integer a rung can pin
on any machine rather than a wall clock. A 128² tile asks **16 384** inversions of
the exact path and **65** of this one, and a 4×4 mosaic asks 65 for the whole
picture rather than 65 per tile, because the curve belongs to the system.

The clock is recorded here rather than asserted. On this machine, DIN 4×/0.10:

| what | exact | cached | |
|---|---|---|---|
| `rasterizeSpecimen`, grid 128 | 1 046 ms | 2 ms | 428× |
| `rasterizeSpecimen`, grid 64 | 258 ms | 1 ms | 243× |
| a whole traced tile, grid 128 / ps 32 | 1 293 ms | 235 ms | 5.50× |
| a whole traced tile, grid 64 / ps 32 | 738 ms | 237 ms | 3.11× |
| a 2×2 mosaic, grid 64 / ps 32 | 2 193 ms | 883 ms | 2.48× |
| § 6r's 3-λ stack, grid 64 / ps 32 | 1 625 ms | 741 ms | 2.19× |
| **the app's stage tile, at its own defaults** | 293 ms | 45 ms | 6.46× |

The first six rows run an ideal 21-point `diskSource`; the last runs the stage's
actual request — DIN 4×/0.10, ps 32, grid 64, guard 4, S = 0.5, and § 6p's
208-direction commensurate source — which is the one a reader should take as
"what the panel costs", and its two pictures differ by 9.9e-15.

**The last four lines are the step's real finding, and they are a correction to
APP.md's cost model for the third time in as many steps.** With the raster
cached, the Abbe sum is the bill again — exactly where D0.1 had it before D4
moved it — and the 5.50× on a whole grid-128 tile is D4's own 1 001-against-180
ratio delivered. What a tile costs is set by the transform once more, so the
stage's 2 px per resolution cell is a sampling choice rather than a rasterizer
budget, and the next thing worth optimising is not in this module.

### 6s.5 — the residual tabulation buys nothing

The obvious optimisation, and it is a null. The map is nearly linear — § 6m.4
measures the departure at 49 ppm — so tabulating only the departure should
collapse the table's dynamic range and buy digits. It buys none: the two agree to
under 1% at every node count where truncation decides, and at the floor they
differ by under one ulp of the object height, on both sides of zero across the
ladder (the residual form is worse at 24 nodes and better at 64).

The reason is worth stating because it is not obvious and it generalises: **a
cubic already reproduces a linear function exactly**, so subtracting one changes
no truncation error at all — and the reconstruction's final add, `slope·r + δ`,
rounds at the same magnitude the direct table does, so it changes no rounding
error either. There is no régime in which it wins. The control is kept as code
(`tabulate: "residual"`) rather than as this paragraph, on the ladder's usual
rule that a negative control which cannot be run is an assertion.

### 6s.6 — a table is a function of three things, and two are invisible

The table belongs to (system, wavelength, aiming). The system is the argument
that built it; the other two are not visible at the call site, and § 6r is the
step that makes that dangerous — it rasterizes the same specimen on one frame per
wavelength, so a 550 nm table used on the 450 nm frame is a perfectly plausible
picture of very slightly the wrong specimen with **no witness anywhere
downstream**. § 6n.2's and § 6p's bug class exactly.

So the map carries its wavelength and its launch plane, `specimenPointAt` refuses
a frame that disagrees, and `radialMapCovering` refuses to build one table across
frames at two wavelengths — which is precisely the set of frames a caller reading
§ 6r's stack would be tempted to hand it.

### Not yet pinned

- **A non-uniform node distribution.** The nodes are uniform in radius and the
  map's fourth derivative is not. On this objective it does not matter — the
  floor arrives at 32 nodes — but a system with strong distortion at the field
  edge would be served better by nodes clustered there, and nothing measures
  that.
- **The map under a `DepthPupils` stack (§ 6l).** The inverse is a function of
  the object plane's depth as well. § 6l has since landed, so there IS something
  to refuse with now — and it is still not refused: the table's identity carries
  the wavelength and the aiming, not the conjugate. § 6l.5's focus-knob scaling is
  what moves the plane a table was built at (n_i/n_s per unit of real depth), so a
  table built at one focal depth and used at another is the same bug class as the
  wavelength one, now with a measured size rather than an unspecified one.
- **The seeded-bisection alternative**, which would be exact. Bisecting inside a
  bracket 1e-9 wide returns the same float (§ 6m.2: the seed chooses the path and
  not the answer) but still costs 23 of the 52 iterations, so it is ~2.5× against
  this table's 428×. It is recorded as the reason this step is an interpolant and
  not measured.

## Step 6t — the polychromatic mosaic

§ 6o tiles a field at one wavelength. § 6r images one tile in colour. Each landed
naming the other as its own deferral, and § 6r's words are the whole scope of
this step: *"a tile, not a mosaic — `halfExtentMm` is ∝ λ, so a mosaic's pitch
and guard band, which § 6o pins against a closed form at one wavelength, would
have to be fixed by one reference λ with every other λ cropped to it. That is a
real design question and not this one."*

**The answer is an ordering, and the wrong order produces a picture that is
plausible everywhere.** A spectral tile is cropped twice: the **guard band**,
because `abbeImage` is a transform and the specimen outside the grid is wrapped
rather than absent (§ 6o); and the **ruler**, because the planes have different
physical scales and are resampled onto the bluest one's grid (§ 6r). The guard
goes **first, per plane, on that plane's own grid** — and then the guard is
exactly `guardCells` in every plane's own cells, so § 6o's whole ladder applies
to each plane unchanged and this step mints no new guard number at all.

That is pinned as an **identity** rather than argued: a spectral tile's plane at
λ *is* `renderMosaicTile`'s tile at λ, bit for bit (§ 6t.1). Cropping after the
stack instead would take one *physical* distance off every plane, which is a
different number of cells in each of them, and the guard § 6o measured would no
longer be the guard any plane received.

| Rung | Pinned to | Status |
|---|---|---|
| **A spectral tile's plane at λ IS `renderMosaicTile` at λ, bit for bit** — on the anchor and off it | § 6o's guard ladder, transplanted by identity | ✅ |
| …and each plane's frame is that tile's frame — centre, ruler, traced object point | one expression, not two that agree | ✅ |
| **A one-tile spectral mosaic at guard zero IS `brightfieldSpectralStack`**, bitwise | § 6o.5's idiom, in colour | ✅ |
| **The ruler plane is the LEAST guarded**, and every other plane by a closed form | (size − useful·s_ruler/s_λ)/2 · ps/size | ✅ |
| …4 cells asked delivers **4.500 / 6.592 / 8.040** at 450 / 550 / 650 nm | **λ_ruler/λ**, the wavelengths alone | ✅ |
| …with a **1.69e-4** residual that is the traced pupil's own λ dependence | why the ruler is a min over MEASURED scales | ✅ |
| …and the excess is not a constant of the band — it carries `usefulPixels` | the same form at twice the grid, 1e-10 | ✅ |
| The kept span is `size − 2·guard − 2·rulerCrop`, and the pitch follows it | 46 px against a mono tile's 48 | ✅ |
| A fractional index, a non-whole guard, and a crop that eats the tile are **refused** | `mosaicGuardPixels`, shared not copied | ✅ |
| **A tile whose ruler is not the anchor's is refused** — two rulers is a scale step | the composed picture has one grid | ✅ |
| …and so is a geometry laid out on one lattice and rendered on another | `renderMosaicTile`'s own refusal | ✅ |
| **The anchored index is the layout's, bitwise, at 3×3 and 5×5** | the pitch read on the anchor's ruler plane | ✅ |
| …and the 5×5's inner ring IS the 3×3, tile for tile | the viewport is not in the answer | ✅ |
| **A tile rendered alone is the composed picture's tile, bit for bit, in XYZ** | one observer basis, no blending | ✅ |
| CONTROL: neighbouring tiles differ in > 90% of a row | registration, not a flat picture | ✅ |
| The verdict is the worst λ of the worst tile and **names the wavelength** | § 6r.7's blue end, § 6g.3's ordering | ✅ |
| **Lateral colour is exactly zero on axis and linear in the tile index** | § 6r.6's law, over millimetres | ✅ |
| …**0.4962 px at a 9 mm field edge, MEASURED at tile 44** — no correction needed | 0.1% off the ×4 fit's extrapolation | ✅ |

### The ruler plane binds twice, and that is § 6r.7 on a second axis

The common grid is the smallest-scaled plane's — the bluest — so every other
plane's kept span is strictly **interior** to what it rendered. At plane λ the
composed span covers `usefulPixels · s_ruler/s_λ` of that plane's own pixels,
which is fewer than `usefulPixels` for every plane but the ruler, so the distance
from the kept edge to that plane's own wrap boundary is

    effectiveGuardCells(λ) = (size − usefulPixels·s_ruler/s_λ) / 2 · ps/size

— minimised at the ruler, where it is exactly `guardCells + rulerCrop·ps/size`.
On the bench (grid 64, `pupilSamples` 32, guard 4 cells, 450/550/650 nm) a guard
of 4 cells is delivered as **4.500, 6.592 and 8.040 cells**: the red plane is
guarded **1.787×** better than the blue one, which by § 6o.1's own
`guard^(−1/2)` is 1.34× less crop error, for free and without being asked for.

**The pin is the wavelengths and not that expression.** `imagePixelScaleMm` is
∝ λ (§ 6r), so `resampleRatio` is λ_ruler/λ and everything above is arithmetic on
it: 450/550 and 450/650 predict 0.818182 and 0.692308 where the traced planes read
**0.818067 and 0.692138**. Comparing the delivered guard against the formula that
computes it would be the module checked against itself; comparing it against
450 / 550 / 650 nm is a prediction, and the rung is written that way.

The **1.69e-4 residual is the finding attached to it**, because it has a cause: the
exit pupil and the reference sphere are traced per λ too, so `pixelScaleMm` is ∝ λ
times a factor that is itself faintly λ-dependent. That is exactly why
`stackBrightfieldPlanes` takes the minimum over *measured* scales instead of
assuming the shortest wavelength, and why the ruler is refused rather than assumed
when two tiles disagree — the ordering is a measurement, and here it comes out the
ordinary way with 1.7e-4 to spare.

So the blue end of the lamp sets the guard as well as the sampling. § 6r.7 found
the blue plane worst-resolved by 2.56× and concluded that `pupilSamples` is set
by the blue end; this is the same sentence about a different knob, and it has the
same cause — the plane that refuses first is the plane whose grid the picture is
on. The excess is **not** a property of the band: it carries `usefulPixels`, so a
larger tile over-guards its red end further, and the rung measures the ratio at
two grids rather than quoting the 8.040.

**This was predicted backwards.** The reasoning that reached for a mosaic first —
"a guard fixed in millimetres is fewer cells for red, because red's impulse
response is physically wider" — is wrong in its reference frame. Every plane is
rendered at the same `size` and `pupilSamples`, so in *cells* every frame is
identical and the physical width of red's response is already carried by the
cell. What decides is which plane's ruler the crop is taken on, and that favours
the redder planes rather than punishing them.

### The pitch is a span, and a span is a ruler

Tile centres are image-plane millimetres and carry no wavelength, so every plane
of every tile shares one centre. The **pitch** does not: it is a kept span, read
on the anchor tile's ruler plane and nowhere else, which is `mosaicTileAt`'s rule
with one more word in it.

The consequence is worth stating loudly because getting it wrong tiles with a
step in it that reads as optics: at the same `size`, `pupilSamples` and
`guardCells` a spectral mosaic keeps **2·rulerCropPixels fewer pixels** than a
monochromatic one — 46 against 48 on the bench — so its pitch is smaller too. A
spectral tile is therefore pinned against the mono tile **at the same centre**
(§ 6t.1) and never at the same index.

### Lateral colour, finally measured where there is field to measure it

§ 6r.6 pinned that the per-λ frames are concentric and everything inside them is
traced at its own wavelength, so the object point a given image pixel looks at is
wavelength-dependent — zero on axis, linear in field. It had 47 µm of field to
say that in, because a brightfield frame spans `pupilSamples` resolution cells
and no more (§ 6h.2). A mosaic *is* the field, and the same law read over
millimetres answers the question a mosaic raises: **do the planes have to be
registered against each other?**

On the DIN 4×/0.10 they do not. The blue–red split of the traced tile centre is
f64 **zero** on the axis — not small, zero, because `objectHeightForImageRadius`
bisects on a radius that is identically zero at every λ — and 1.126e-2, 2.252e-2,
4.505e-2 pixels at 1, 2 and 4 tiles out, which is the linearity to two digits.
That is 0.0547 px per mm of image near the axis.

**The field edge is measured and not extrapolated to**, which is the discipline
this file keeps and the reason is specific: the split is read off the *traced*
map, which carries distortion by construction (§ 6h.1's cubic), so multiplying a
slope fitted over ×4 out to ×44 admits a term the linearity check cannot see — and
a tile 44 pitches out is far enough that the tracer *refusing* would be a real
outcome (§ 2f's wall) rather than a hypothetical. It does not refuse, and at
9 mm — half of the DIN 18 mm field number, a convention and not an engine number —
the split reads **0.4962 px**, against 0.4955 px extrapolated. So the nonlinearity
over that whole reach is **0.1%**, the extrapolation would have been right, and it
is now a measurement instead of a hope. The per-λ frames register on their own
everywhere this objective can see, and the mosaic needs no chromatic registration
step. Reading only frame centres, it costs three traces and no render.

### Cost, and what it inherits

A spectral mosaic is `tiles² × wavelengths` tile-renders, which is why this step
waited for § 6p's cached pupil and § 6s's tabulated map rather than being written
beside § 6r. The radial map is built **once per wavelength over every tile's
frame** — the map belongs to the system and the λ, not to the tile (§ 6s), and
`radialMapCovering` already refuses to span two wavelengths, so the per-λ split is
the module's rather than a choice. The observer basis is built once from the
first tile's normalized samples and shared, which is what makes § 6t.6 an
identity rather than two evaluations of one integral.

The identity rungs run with the cache **off**, for § 6s's own reason: a whole
mosaic's shared table is not the single tile's table, so a bitwise claim about a
tile rendered alone has to be made on the exact bisection.

### Not yet pinned

- **The guard's own exponent under a spectral stack.** § 6t.1 makes each plane's
  guard § 6o's guard, so the law transplants — but nothing measures the *stacked*
  image's crop error against `guard^(−1/2)`, and the planes are not independent
  draws of it. The prediction is that a weighted sum of planes at 4.5, 6.6 and 8.0
  cells lands between them, and it is a prediction rather than a rung.
- **A polychromatic seam step.** § 6o.7 measured the mono seam against a third
  tile centred on it, falling 1.8e-2 → 7.8e-4 as the guard grows. The same probe
  in colour would say whether a seam has a *hue*, which is the thing a reader
  would notice first, and it is not built.
- **A band wide enough to reorder the planes.** The ruler is taken as the minimum
  scale over the planes and a disagreement between tiles is refused, but no system
  in the ladder produces one — so the refusal is pinned by construction (§ 6t.4,
  provoked with a narrowed band) and never by a real reordering.
- **Off-axis coherence**, inherited from § 6g, and the non-telecentric condenser
  (§ 6a's object-space ray-aiming blocker), inherited from § 6o. Both are
  unchanged by the wavelength axis.

## Step 6u — object-space ray aiming, and telecentricity

§ 6a named **three** blockers for immersion and recorded them rather than
papering over them. The aperture seed closed at § 1.5.1, the glass form at
§§ 6e.2–6e.4, and this is the third: *"telecentricity needs object-space ray
aiming that does not exist."* It is the branch's last named engine gap.

A real objective puts its aperture stop at the **back focal plane**, which makes
it object-space telecentric — the chief ray leaves every specimen point parallel
to the axis, so magnification does not drift with defocus. That puts the entrance
pupil at infinity, and `aimRay` refused it by design. So every microscope in this
repo has carried its stop on the objective's own rim instead, while § 6f, § 6h,
§ 6m and § 6o each wrote *"telecentricity is assumed"* about their **condenser**.
The illumination assumed what the objective was not.

**The step adds no physics.** It is the paraxial pupil relation read at A = 0,
and the reason it took a step at all is that the refusal was right about the
diagnosis and wrong to stop at it: aiming at a *point* is not what aiming means,
it is what aiming reduces to when the pupil is a finite distance away. A pupil at
infinity is a set of **directions**, so a normalized pupil coordinate names a
slope and the construction is the same one limit further out.

### 6u.1 — the aperture is a slope, and the slope is stopRadius/f

Paraxially a ray leaving object height h with slope u reaches the stop at
`y = A·h + B·u`. The entrance pupil is at infinity exactly when **A = 0**, and
the rim is then

    u_max = ± stopRadius / B,   with no h in it at all,

which is not an approximation but the defining property — it is *why* a
telecentric aperture is field-independent, and why one number suffices where a
finite pupil needs a position and a radius.

**B comes free from the trace that already ran, and that is the whole
implementation.** `imageStopBackward` traces `{y: 0, u: 1}` back from the stop,
which applies the inverse of the object→stop matrix; the matrix has unit
determinant, so the inverse carries (0, 1) to **(−B, A)**. The branch's own
condition `|axis.u| < 1e-15` is therefore already a test of A = 0, and the height
it exits with is already B. No second computation exists to drift from it.

Measured: `slopeRadius` is `stopRadius/f_group` **bitwise**, on a thick
asymmetric singlet chosen so that no thin-lens identity can be doing the work —
because "stop at the back focal plane" is precisely what makes `y = f·u`, with
the principal-plane offsets cancelling. Linear in the stop radius over four
values, also bitwise.

The type carries the invariant rather than leaving callers to discover it:
**`radius` finite XOR `slopeRadius` defined.** A caller that has checked one has
decided the other.

### 6u.2 — the chief ray is parallel to the axis, and it lands on the stop centre

The first half is bitwise and nearly a tautology: the aim contains no object
height, so `chiefRay` returns exactly `(0, 0, 1)` at every field. Recorded as a
`toBe`, not a tolerance, because a tolerance here would hide the point.

The second half is the rung with teeth, since a ray parallel to the axis is only
the *chief* ray if it actually passes through the stop centre. It does not do so
exactly — `aimRay` targets the **paraxial** pupil — so the honest statement is an
**order**. On axis the miss is exactly zero; off axis it grows **×8.00 per
doubling of object height** (8.0013, 8.0052, 8.0209, 8.0846, approaching 8 from
above as h shrinks, the excess being the fifth-order term). That is the
third-order cubic — § 6h.1's distortion constant, here in the *pupil* rather than
in the image.

### 6u.3 — magnification does not drift with defocus

The property telecentricity is bought for, and the experiment is **named**
because two are defensible: the **object plane moves and the image plane is held
fixed**. The image blurs and does not change size. (Moving the object and
refocusing is a different measurement and is not this rung.)

Telecentric: the traced magnification is **bitwise unchanged** over 20 mm of
object travel — the chief ray is literally the same line, so there is nothing to
round. The control is a non-telecentric stop 10 mm in front of the same lens,
where the entrance pupil is a real plane a finite arm L from the object;
magnification goes as 1/arm, so

    ΔM/M = −δz / (L + δz),

pinned to 1e-3, the residual being real-ray distortion at the 2 mm object height
the magnification is read at. It is a large effect at ordinary numbers: **20 mm
of object travel costs 9.1% of magnification**, against a hard zero.

### 6u.4 — the spellings a pupil at infinity does and does not have

`objectNA` is the spelling a telecentric objective is actually engraved in, and
it survives: `stopRadius = B·tan u` off the same probe, with the delivered
`n·sin u` read from the aimed ray's **direction cosine** — § 1.5.1's
discriminator reused, the resolved radius appearing nowhere in the assertion. It
round-trips to 12 places at four apertures, and the **object distance cancels
bitwise** across a 6.7× range of conjugate, which for a finite pupil is false.

Two spellings were returning arithmetic on ∞ rather than saying so. `EPD` and
`fNumber` divide by an infinite pupil magnification and came back a silent
**0** — an aperture that closes the system. `objectNA` multiplied an infinite arm
by a finite tangent and divided by an infinite magnification for a silent
**NaN**. The zero is the worse of the two, because it survives arithmetic and
propagates as an ordinary number; both are refused now. An object at infinity
*behind* a telecentric pupil has no object-space cone at all and is refused
rather than guessed.

### 6u.5 — the branch is a limit, not a cliff

`|axis.u| < 1e-15` is an exact-zero test on an f64 paraxial trace, so whether a
given design lands inside it is luck — the fixture here sits at 1.11e-16, inside
by only 9×. What makes that benign rather than a cliff is that the two branches
**agree in the limit**, and they agree to *first order* in how far the stop sits
from the back focal plane: relative difference 5.6e-2, 5.3e-4, 5.3e-6, 5.3e-8,
5.3e-10, 5.3e-12 over ten decades of offset. At the threshold itself the two
readings differ by ~1e-16 relative, so which side a system falls on cannot
matter.

**That measurement only became possible at § 1.5.2.** Before it, the finite aim
on this side of the back focal plane pointed backwards — the convergence would
have been measured against a ray travelling the wrong way. The two steps are one
investigation: the sign defect was found while probing whether this branch was
reachable at all.

### 6u.6 — what it unblocks

`opdMap`, `spotDiagram` and everything built on them funnel through `aimRay`, so
one refusal made a telecentric system **un-analysable** rather than degraded.
They now run: the pupil fills with nothing lost on and off axis, and the sample
count is identical at every object height — which is what telecentricity buys the
*sampling*, the cone being field-independent so one pupil grid is one physical
bundle everywhere in the field.

### An aside that is not this step's to fix

The axial spot's centroid is not zero, and it is not the aim's fault:
**`pupilGrid` is itself asymmetric.** `(i/(n−1))·2 − 1` yields −0.9 exactly but
0.9000000000000001, so the unit-disc clip keeps different points on the two sides
and the grid's own Σpx is **−1.2 over 313 points**. An ordinary non-telecentric
system carries the same bias identically (5.2e-5 of centroid against this one's
8.9e-4, the ratio being the two spot sizes and nothing else). Correcting the
sampler would move pinned numbers across the whole ladder and belongs in its own
step; what belongs here is not leaning on it, so the symmetry rung is asserted on
a fan, which is symmetric by construction.

### Not yet pinned

- ~~**A telecentric objective in `designs/microscope`.**~~ **Claimed at § 6v**,
  and the "wiring plus a re-measurement" reading was right about the wiring and
  wrong about where the work would be: the stop is one surface at a distance the
  paraxial trace already reported, and what the step is actually made of is the
  re-measurement — including two things nothing here predicted, an off-axis
  vignette and a silently relocated tube lens.
- **Image-space telecentricity.** `pupils` has had the branch since it was
  written (`imageStopForward` returns an infinite exit pupil) and `psf` refuses
  it outright. The object side is what § 6a blocked on; the image side has no
  caller and stays unpinned.
- **Pupil aberration**, unchanged: the aim is paraxial, and § 6u.2 measures the
  cubic it costs rather than removing it. Real ray-aiming iteration would.
- **Off-axis vignetting against a telecentric stop**, and the condenser: § 6f's
  "telecentricity is assumed" is now assumable rather than assumed, but nothing
  has been re-measured against it.

## Step 6v — the presets are telecentric

§ 6u made an entrance pupil at infinity *expressible* and then said, in its own
"not yet pinned" list, that nothing used it: *"the capability is here and the
presets do not use it yet — the stop still sits on the objective's rim. That is
wiring plus a re-measurement of what moves."* This is that step.

**It adds no physics, and it is not an option either.** `designs/microscope`'s
header said the rim stop was there *because* `aimRay` refused the real one; once
that stopped being true, keeping it as the default would have preserved a
workaround for a gap that had closed. So `stopPlacement` defaults to
`"backFocal"` and `"rim"` survives as the **negative control** — which is not a
courtesy: every rung below is a comparison, and the property telecentricity buys
has no measurable size without a system that lacks it.

### 6v.1 — the aperture stops being a length

The stop goes at the glass group's back focal distance, read off
`systemProperties` rather than restated, and sized `f·tan u`. What arrives at the
aimer is then **`tan u` exactly** — pinned to 12 places across four apertures and
three magnifications — because § 6u.1's telecentric aperture is the *slope*
`stopRadius/B`, a stop at the back focal plane is what makes B the focal length,
and the f cancels. No focal length, no object distance and no magnification is
left in the number. The control keeps a real pupil at a real place, its
specimen-side vertex, and carries no slope at all.

### 6v.2 — the delivered NA is the engraving, and the conjugate cancels

The label is delivered to 12 places at three apertures. The rung with teeth is
the second: moving the specimen leaves the delivered NA **bitwise** unchanged,
where the control's changes — which is the same statement as the aperture having
no object distance in it, in the spelling a microscope is actually engraved in.

### 6v.3 — the magnification stops drifting with focus

§ 6u.3's experiment on a real objective, and the experiment is **named** because
two are defensible: the object plane moves and the image plane is **held fixed**.
The image blurs and must not change size.

Bitwise — asserted on the magnification itself rather than on the relative
change, because the difference of two identical negatives is `-0` and
`Object.is(-0, 0)` is false, so a rung phrased on the ratio would fail while
reporting a drift of zero. The control drifts as −δz/(L+δz) with L its own object
distance, which is **0.1% over 50 µm** of specimen travel.

### 6v.4 — the chief ray leaves parallel to the axis

Exactly `(0, 0, 1)` at every field, where the control's tangent is the object
height over the object distance. Both halves are near-tautologies of the aim and
are recorded as `toBe` for the same reason § 6u.2 does.

### 6v.5 — the price, and it is off axis

**The finding this step did not go looking for.** A rim stop pivots every bundle
through one hole at the front vertex, so the footprint on the glass never moves.
A telecentric stop does the opposite: the chief ray is parallel to the axis, so
the footprint **translates** with the object height and walks off an element
sized for the axial beam. Measured on the 4×/0.10: nothing lost out to ~0.1 mm of
field, **11% of the pupil at 1 mm and 35% at 3 mm**, monotone, a falloff rather
than a wall.

**Those are that lens's numbers and they do not travel** — stated here because
the quantity has a magnification in it and the field does not. What the bundle
walks against is the rim, which goes as f·NA, while the field is quoted in
absolute millimetres; so at 40×/0.10 the element is a tenth the size (f = 5 mm)
and the same 1 mm of field is not an 11% loss but past total occlusion. Any
figure here is per objective, and the surfaces that pan across millimetres
(§§ 6o, 6t) are the ones that run at the magnifications where it bites hardest.
That is the argument for the oversized front element below, and it is why it is
named as a step rather than a constant.

It is the **glass** and not the diaphragm, and that is a controlled experiment
rather than an assertion: opening the diaphragm by 5 mm changes the throughput by
nothing to 12 places, and widening the glass by 1 mm recovers part of it. So the
stop is doing its job and the element is too small — which is why real objectives
have front elements much larger than their axial beams. Oversizing it here is
**named as the next step** rather than done quietly, because the field an
objective must pass is not something the objective's own spec currently states.

The control is not perfectly free either, and saying so is the point: at 3 mm it
loses one lattice point of 313. What separates them is the mechanism and
therefore the rate — the control's loss is the tube lens catching a 12 mm image
height, a rounding error where the telecentric one is spending a tenth of its
pupil.

### 6v.6 — on axis, the two aim the same rays

Which is why moving the default moved almost nothing: **9 tests of 1364**, six of
them statements about which surface carries the flag. The reason is sharper than
"a stop shift changes no axial aberration" — for the same normalized pupil
coordinate the two constructions produce the *same ray*. The rim targets
`ρ·s·tan u` a distance s away, giving slope `ρ·tan u`; the telecentric one names
that slope directly. Two constructions, one bundle, pinned to 12 places.

What does move on axis is a **reference and not an aberration**: the stop moved,
so its image through the following optics moved, and OPD is struck on a sphere
against the exit pupil. That is the whole content of the one downstream number
that shifted — § 6d.4's bisected reach, by 0.5%.

§ 6d's negative control is therefore held at `"rim"` **on purpose**, and for two
reasons. The section's claim is about the FORM, one cemented doublet against two,
so holding the stop fixed is what isolates it; moving both at once would report
the sum of a form change and a stop change. And third-order S_II is derived with
the stop at the first surface — `seidelSums` refuses any other placement — so the
§ 6d.2 control has no telecentric spelling at all. Against the telecentric
single doublet the same comparison reads 6.07× where the controlled one reads
past 15×, and that number is recorded here rather than substituted there.

### 6v.7 — the defect it turned up, which nothing first-order could see

Inserting the diaphragm made it the objective module's last surface, and
`infinityCorrectedMicroscope` splices the infinity space **after the module** —
so the tube lens was silently pushed back by the objective's whole back focal
distance, ≈ 50 mm on the 4×. The space is collimated, so **no first-order
property changed and the whole suite stayed green**; what moved was the ray
height at the tube lens, and with it the aberration it contributes. It surfaced
only as § 6v.6's rung failing at 2.8e-5 where it expected 1e-12 — a rung written
to assert a null, catching something else.

The fix is that the gap spliced after the objective is the infinity space *less*
the distance already spent reaching the stop, so `infinitySpaceMm` keeps meaning
what its doc says: last **glass** vertex to tube lens, telecentric or not. With
that, the two placements differ in exactly one thing, which is what makes every
comparison above a comparison.

It also introduces a real geometric constraint and the engine now refuses rather
than composes: **the infinity space cannot be shorter than the objective's back
focal distance**, or the tube lens would precede the aperture that defines the
beam it sees. Pinned at the boundary itself — `infinitySpaceMm` exactly equal to
the stop distance builds — and § 6a.3's own sweep starts at 60 mm rather than 20
because of it, with the control shown to still accept 20.

This is the fourth member of the family APP.md names — *a routine that answers
confidently for a system it cannot express* — after § 1.6.1's and § 5r.1's
brackets and § 5l.1's dropped declaration. Same signature as § 5l.1 in
particular: a module composed at a gap the geometry does not have, silently,
because the quantity that would have shown it was collimated.

### Not yet pinned

- ~~**The oversized front element.**~~ **Closed at § 6w**, and it landed the way
  this bullet said it would — a new spec parameter, not a constant — with one
  correction to the sentence above it: the numbers § 6v.5 quotes are not per
  objective at all once they are asked in the units an objective is catalogued
  in. See § 6w.2.
- **The DIN objective.** `finiteConjugateObjective` is untouched and still carries
  its stop on the rim. A real DIN objective is telecentric too, and the
  composition it feeds is a different one, so it is its own step.
- ~~**What telecentricity is worth to the illumination.**~~ **Closed at § 6x**,
  and this bullet had the component wrong along with the four modules it quotes:
  the assumption was never about the condenser. Köhler illumination *is* one
  direction per diaphragm point over the whole field, exactly. What is
  field-dependent is where that direction lands in the OBJECTIVE's pupil, by
  `h/R_ep`, which telecentricity sends to zero. See § 6x.1.
- **Pupil aberration**, unchanged from § 6u: the aim is paraxial, and § 6u.2
  measures the cubic it costs rather than removing it.

## Step 6w — the objective knows what field it must pass

Test: `packages/core/test/field-sized-objective.test.ts`

§ 6v's price, paid. That step measured a cost it did not go looking for — a
telecentric bundle's footprint *translates* with object height where a
rim-stopped one pivots through one hole, so it walks off an element sized for
the axial beam — and named the fix rather than doing it quietly, because "the
field an objective must pass is not something the objective's own spec currently
states". This is that parameter. As at § 6v, **no physics is added**: the glass
is `f·NA + h` instead of `f·NA`, and everything below is a consequence of the h.

`fieldNumberMm` is that field, in the currency a microscope states it in — the
diameter at the **intermediate image**, the same number § 6q splices in as a real
annular field stop and the app's stage carries as `FIELD_NUMBER_MM = 18`. The
object-space semi-field it implies is `h = FN/(2·M)`, and a telecentric chief ray
leaves the specimen parallel to the axis, so a bundle from the field edge arrives
at the element centred on h rather than on the axis.

**The default stays off, and the reason is not caution.** § 6v could default
telecentricity on because a stop position is intrinsic to an objective. A field
is not: it is a property of the objective *together with whatever stops the field
behind it* — an eyepiece's field stop, a sensor's diagonal — so no physics picks
a value, which is what ROADMAP means by "a new spec parameter … not a constant".
An objective built without one is still the § 6v lens, and that is what makes
every rung here a comparison against a shipped control. The § 6v rungs pass no
field number **on purpose** and should keep passing none: they are now this
step's negative control, and "fixing" them would delete the comparison.

### 6w.1 — the glass is the beam plus the walk, and the oversize is a RATIO

The sizing is one line, so the rung that matters is the second one. Both terms of
`f·NA + h` are ∝ 1/M — the beam because `f = f_tube/M`, the walk because
`h = FN/(2M)` — so the magnification cancels out of the fraction entirely:

    glass/beam = 1 + FN/(2·f_tube·NA)

which is **1.450000000000** at FN 18 / NA 0.10 for the 4×, the 10× and the 40×
alike, pinned to 12 places, and reproduced across NA 0.05–0.20 × FN 10–25.

That is the sentence of § 6v.5's this step corrects. Those figures were quoted in
millimetres of field — 11% of the pupil at 1 mm on the 4×, past total occlusion
at 40× — and were explicitly said not to travel. In millimetres they do not. In
the units an objective is actually catalogued in they are the same number for
every member: **§ 6v.5's numbers were a verdict about the units, not about the
40×.**

### 6w.2 — the family is ONE LENS, scaled

Not a restatement of 6w.1: that was one ratio inside one lens, this is every
dimension of two. Focal length, glass radius, beam radius, stop radius, object
distance and stop distance all run ×10 from the 40× to the 4× (9–12 places), and
the three curvatures run ÷10 — a curvature being the reciprocal of a length. The
**bending is identical**, because `S_I ∝ h⁴` makes the third-order solve
scale-free, so the catalogue is one shape at three sizes.

This is what licenses quoting a single set of figures below for the whole
catalogue, and it is why the panning surfaces (§§ 6o, 6t), which run at the high
magnifications, are fixed by the same field number as the low ones rather than
needing one each.

### 6w.3 — it passes the field it was sized for, where the § 6v objective does not

The claim of the step, against the shipped control, and it lands as a **discrete
count**: at its own field edge the field-sized objective delivers **313 of 313**
lattice points and the axially-sized one delivers **229** — the same 84 lost at
4×, 10× and 40×, which is 6w.2's invariance arriving in integers, since it is the
same lens and therefore the same rays.

The bridge to § 6v.5 is the same control read in millimetres: the axial 4×/0.10
passes 0.888 of its pupil at 1 mm of field, which is that section's "11%". And it
is not magic past what it was sized for — an FN 18 objective's semi-field is
2.25 mm, and at 3 mm it vignettes too, gently.

**The isolation is checked rather than assumed.** These rungs compose against a
60 mm tube lens so that what clips a bundle is the objective and the claim stays
about the objective. That would be a thumb on the scale if the shipped 25 mm one
could not carry the field, so it is measured: it passes FN 18 at every
magnification. The chief angle in the infinity space is `FN/(2·f_tube)` — with no
magnification in it either — so one check covers the catalogue.

### 6w.4 — the closed form is an UPPER BOUND, and the last glass face is what binds

`f·NA + h` is two paraxial statements added, and neither is a height at a
*vertex*: the sine condition puts the emergent marginal ray at `f·sin u` on the
equivalent refracting sphere — the same distinction § 6a records for the stop
radius — and telecentricity puts the chief ray at exactly h. So the traced
footprint lands **inside** the size it asks for, at every surface, topping out at
**0.98922** of the bound on the last glass face, monotone across the three faces
as the beam climbs toward its emergent height.

Reported with its sign rather than as a tolerance. The sizing is conservative,
which is the safe direction, and that 1.1% is real glass a tighter derivation
could reclaim.

The delivered field is correspondingly **5.27% more than asked** — bisected, and
identical at 4× and 40×. The number is not arbitrary: it is the 1.1% above plus
`cementedDoubletForm`'s own **0.5% rim margin** on the binding face, divided by
the ~0.965 mm of footprint each mm of field walks. And the binding face is the
**crown's outer one** (surface 2 of the mirrored chain), because that is the one
carrying the 0.5% margin where the two specimen-side faces carry 2%.

### 6w.5 — what it costs, and the delivered NA is not what pays

The doublet is **built** at the wider aperture rather than having its rim widened
afterwards. That is `finiteConjugateObjective`'s `glassMarginFactor` route, and
it is not merely consistency: `achromaticObjective` defaults its thicknesses off
D and checks the **edge thickness at D/2**, so an element widened after the fact
would have passed a check for a rim it does not have — APP.md's *routine that
answers confidently for a system it cannot express*, avoided rather than
committed.

What that costs is **2.115% of working distance**, at every magnification.
Thicker glass moves the principal planes and the specimen sits on the front
focus, so it comes closer. The flint's default centre thickness is `0.06·D` and
scales with the glass exactly (×1.45); the crown's is finalised from the sags,
which grow faster than the aperture, so it goes ×2.031.

**The delivered NA does not pay**: 0.10 to 14 digits, before and after, because
it is re-derived as `f·tan u` at the back focal plane on the lens actually
built — § 6v.1's slope aperture reading whatever group is in front of it. The
stop radius itself moves; the aperture it delivers does not.

The traced magnification moves **0.08%, toward the label** — a thicker doublet's
Gullstrand term is smaller, so its traced EFL sits closer to the design focal
length (49.9694 → 49.9871 on the 4×). Recorded rather than buried: it is a real
change to a shipped number, it is not an improvement the step was aiming for, and
nothing downstream reads the traced magnification as a specification.

**And it is the one number in this step that carries a magnification** —
−8.0516e-4 at 4× against −8.0368e-4 at 40×, a 0.18% spread over a 10× range.
6w.2's scale invariance belongs to the *objective family*; the **microscope** is
not scale-free, because every member is composed against the same 200 mm tube
lens, which does not shrink with the objective. Everything else here is measured
inside the objective and is exactly invariant; a magnification is a property of
the pair.

### 6w.6 — the wall: a field number is a second door onto the doublet's own ceiling

The glass is `2(f·NA + h)` against a focal length that does not grow with h, so
the element's own focal ratio is

    D/f = 2·NA + FN/f_tube

— magnification-free, because both terms lose their M the same way. The cemented
doublet refuses past a fixed D/f (§ 6b.5.7's geometric wall: a real bending
reaching a hemisphere), so the aperture ceiling must fall **linearly in the field
number**, at half the reciprocal tube length. Bisected, it does, to nine digits:
the drop is **0.045000000** at FN 18 and **0.062500000** at FN 25, against
`FN/(2·f_tube)` of exactly those.

The axial ceiling it falls from is **NA 0.287401975**, and that is
`1/(2·F*)` for § 6b.5.7's own **F\* = 1.7397236** — two steps' constants meeting
by a route neither was derived through, which is what makes this a wall of an
existing kind rather than a new one. The ceiling is magnification-independent to
12 places, like everything else here.

The refusal **names the field number beside the aperture**, which is § 6b.5.5's
rule that a refusal should say what to back off: NA 0.25 builds axially and
refuses at FN 18, so the aperture alone cannot be the whole message. A refusal
that has nothing to do with the field — NA 0.30, which builds at no field number
at all — is passed straight through unwrapped.

### 6w.7 — refused where it would mean nothing

A field number together with `stopPlacement: "rim"` is **refused**. A rim stop
pivots every bundle through surface 0, so its footprint does not translate and
there is no walk to size for — what § 6v.5's control loses off axis is the *tube
lens* catching the image height, which no amount of objective glass fixes. It is
also the thing the negative control cannot afford to lose: surface 0 has to stay
the rim it is named for.

### Not yet pinned

- **The 1.1% the bound leaves on the table.** 6w.4 measures the footprint inside
  `f·NA + h` and does not tighten the form to it. A sizing that traced the real
  footprint would reclaim it, at the cost of making the glass depend on a trace.
- **Off-axis aberration at the field the glass now passes.** This step is about
  whether the light *arrives*; nothing here says what the image looks like at
  2.25 mm, and § 6d's Lister is the form that would have to answer.
- **The cost has no free working distance to be quoted in.** 6w.5's 2.115% is the
  distance to the specimen plane, which is what an infinity objective reports.
  The number a user of a real one would feel is the *free* working distance —
  that, less the front surface's sag — and only `finiteConjugateObjective`
  computes one. Not a gap this step opened, and the sag is the smaller term, but
  it is the currency the cost belongs in.
- **The DIN objective**, unchanged from § 6v: `finiteConjugateObjective` carries
  its stop on the rim, so it has neither telecentricity nor this parameter.
- **A coverslip target through an oversized element.** Once a field number is
  given, D/2 is no longer the marginal ray's height, and `achromaticObjective`'s
  `targetS1Mm` is documented as evaluated at D/2. Nothing bites today because no
  target is passed here; § 6c's deferred infinity-corrected slip must scale its
  target from the beam, not from the glass.

## Step 6x — what telecentricity is worth to the illumination

`packages/core/test/telecentric-illumination.test.ts`

§ 6v moved the shipped infinity objective's stop to its back focal plane and
§ 6w sized its glass for a field. Both are about the light the objective
**collects**. This step is the other side, and it is the last item § 6w left
that is not a new lens: §§ 6f, 6h, 6m and 6o each hand every field point one
`CondenserSource` with its points centred on the pupil, and each wrote that
down as an assumption about the *condenser*.

**It is not one, and that is the step.** Köhler illumination images the lamp
onto the condenser's aperture diaphragm, so each diaphragm point lights the
whole field with one collimated beam — the set of *directions* is genuinely the
same at every specimen point, exactly, and that half needed no correction.
But `illumination/source`'s coordinates are the **objective's** pupil, and a ray
leaving object height h with object-space slope u reaches the entrance pupil at
height h + u·z_ep:

    ρ = h/R_ep + u/u_max

The field term dies only when R_ep is infinite — object-space telecentricity and
nothing else. So the licence for one source at every field point belongs to the
objective, § 6v is what granted it, and it was granted **only to the infinity
presets**. The DIN carries its stop on the rim and is the live subject rather
than a hypothetical.

No physics is added. `translateSource` moves the cone, `imaging/object-field`
measures where to, and `renderBrightfield` composes them. Nothing on axis and
nothing telecentric changes by a bit, which is asserted rather than hoped for.

### 6x.1 — the offset is `h/R_ep`, read off the aimer and not derived

The engine never computes `h/R_ep`. `illuminationOffset` inverts the aimer: the
aimed ray's object-space slope is affine in the pupil coordinate, so the
coordinate whose ray leaves the specimen **parallel to the axis** is
`−u(0)/(u(1) − u(0))`, and that is where a Köhler condenser's central diaphragm
point actually puts its light. The closed form is then an independent check and
the two agree to **ten digits** on both rim-stopped members (the DIN 4×/0.10 and
§ 6v's own `"rim"` control).

Reading it rather than deriving it settles two things algebra would have had to
be trusted on. The **currency** — the aimer's parametrization decides whether a
pupil coordinate is a tangent or a sine, and § 6q.5 is the step where guessing
that wrong cost 61%. And the **sign**, which arrives from a construction.

The magnitude is **0.21736 of a pupil radius per millimetre** on the shipped DIN
4×/0.10, exactly linear in field. Against an S that is rarely above 1, a
millimetre of field lights the specimen through a cone sitting a fifth of the way
out of the aperture that has to catch it.

**On § 6v's telecentric objective it is bitwise zero at every height**, not
small: `aimRay` takes its object-space branch, where a pupil coordinate names a
slope (§ 6u.1) and the chief ray's slope is § 6v.4's literal `0`, so the
quotient never happens. That exactness is what licenses `translateSource`
returning its own argument, and through it every telecentric and every on-axis
render staying byte-identical to its pre-§ 6x self.

The **sign and the azimuth** are pinned where they are visible: at +x the offset
is positive and `sy` is under 1e-15, at +y the roles swap — the only witness that
the offset is turned by the same rotation as the pupil, since every meridional
rung is blind to it — and at the 45° corner the two components are equal with the
magnitude the radial offset.

### 6x.2 — the aperture stops admitting the whole cone, and it is a count

§ 6w's currency, and deliberately: at S = 0.9 the objective admits **97 of 97**
source points on axis and **90 of 97** at 1 mm, with the seven that leave being
the seven furthest out **along the field's own direction**.

That last clause is the load-bearing one. A *dimming* cannot check this: shifting
a disc source by ±d pushes the same number of points out of a centred pupil
whichever way it went, so a mean intensity is sign-blind. Worse, the obvious
reading of "a clear field dims off axis" is **true on the telecentric objective
too** — 0.8158 → 0.7737 over the same sweep — for § 6v.5's reason, the imaging
bundle walking off the glass. The two mechanisms are told apart by the count and
not by a brightness, and the telecentric control admits all 97 at every field.

And while the cone is still inside, the displacement costs a clear field
**exactly nothing** (to 1e-5 over four field heights): a clear field uses only
the undiffracted order, which every source point still carries wherever inside
the pupil it sits. So the offset is not a brightness fudge — what it moves is
which part of the aberrated pupil each diffracted order crosses, which is
§ 6f's contrast story and not § 6f's throughput.

### 6x.3 — the fluorescence null, bit for bit

§ 6i's "there is no condenser in the expression at all", promoted from a sentence
to a test. `tracedFieldPupils` is shared by both renderers, so the offset now
travels into the fluorescence path and **must be ignored there** — a fluorophore
has no phase memory of the field that excited it. Asserted bitwise rather than to
a tolerance, on patches whose offset is verified non-zero first, so the null is
not vacuous. This is why the offset rides beside the pupil instead of being
folded into it.

### 6x.4 — folding it into the pupil would have been silently wrong

Recorded because it is the design decision and it is not obvious.
`shiftPupil(P, d)` is arithmetically the same composition — the sum evaluates the
pupil at `ν + s + d` either way. But `abbeImage` derives the box of frequency
bins it visits from the **source point alone**, on the premise that the pupil is
supported on |u| ≤ 1; a pupil pre-shifted by d is supported on a disc centred at
−d, so the part outside that box would be dropped. abbe's own comment says what
that is worth: a silently truncated pupil is indistinguishable from a smaller
aperture, "a coverage cap that would read as physics". Translating the source
puts d inside the box computation, where the grid guard can see it and throw.

It does throw, correctly: a rim-stopped objective off axis needs a wider
frequency grid than a telecentric one at the same S, because the reach the guard
sizes against is S + d rather than S.

### 6x.5 — § 6p's cache is a telecentric-only optimisation

An offset read off a trace is not a whole number of half-steps, so a translated
source cannot carry `pupilLattice` — and rounding it onto the lattice would be
exactly the lie `commensurateSource` refuses one function up (§ 6p's "a *nearly*
commensurate source would form a perfectly plausible image"). The metadata is
dropped and `abbeImage` falls back to evaluating the pupil per source point.

**Which is a fact about telecentricity rather than a limitation of the cache.**
Commensurability is a claim about where the source sits in the pupil, and a
non-telecentric objective moves it with field. The fallback is pinned as a
fallback: a translated commensurate source and its own points handed over as a
plain one form the same image and make the same number of pupil evaluations, so
what is lost is the saving and not the sum.

**What that costs is measured rather than waved at, and the first answer was
wrong.** This step was scoped believing `commensurateSource` had no caller
outside its own rungs — a truncated search, and it does have three. Two are
unaffected: `imaging/fluorescence`'s `latticeMatchedSource` keeps its cache
because 6x.3's null means fluorescence never translates anything, and A9's
colour section renders an **axial** frame at `patches: 1`, where the offset is
identically zero. The one that pays is A7/A10's **stage**, which is a mosaic and
therefore off axis by construction.

Timed on the stage's own settings — DIN 4×/0.10, `pupilSamples` 32, guard 4,
S = 0.5, the 208-direction commensurate source — a tile goes **404 ms on the
anchor to 727 ms off it**, and flat thereafter (727 ms at both 4 and 8 tiles out,
because the cache is either available or not and the offset's size does not
enter). So the loss is **1.8×**, not § 6p's 10.76×, and the reason is § 6s: that
step cached the radial map and moved the bill back onto the Abbe sum, so what
§ 6p bought is a smaller share of a tile than it was when § 6p measured it. The
saving § 6p pinned was pinned as an exact evaluation count and that number is
untouched; this is the wall clock it converts to *now*, which is a different
quantity and is why it is stated separately.

### 6x.6 — the binding knob is the PUPIL sampling, not the source count

The step's second finding, and it arrived as two moved rungs rather than as a
prediction.

Once each patch is lit from its own point of the pupil, a source point crossing
the aperture rim is a **step change that happens between patches**. At § 6h.5's
32-bin fixture that stops the patch-refinement sequence converging at all —
ratios **1.95 and 0.87** where the rung had read 0.50 — and refining the
**source** does not rescue it: 0.82/0.69 at 97 points, 0.46/0.51 at 349, at three
and eight times the cost. Refining the **pupil** does, at every source count
(0.509/0.507 at 21, 97 and 349 points alike, the sequence itself moving only
1.239 → 1.201e-2). § 6m.4's contrast tells the same story independently: swept by
hand against the offset at 32 bins it is not even monotone (0.340, 0.239, 0.172,
**0.320**, 0.165), and at 64 it falls smoothly (0.525, 0.457, 0.378, 0.257,
0.205) and stops moving when the source is refined.

Both rungs therefore moved to 64 bins, which is a fixture correction and not a
loosened tolerance: the claims are unchanged, and what was too coarse to carry
them is measured rather than asserted. This is § 6r.7's "the blue end sets
`pupilSamples`" and § 6t.4's ruler arriving a third time on the same knob.

**With the fixture adequate, the offset's own effect on the convergence is small
and in the unexpected direction.** Suppressing it gives 0.5001/0.4999 and
restoring it gives 0.5092/0.5067 — but the *first* step **shrinks**, 1.71e-2 →
1.24e-2, a factor 0.727. The displacement partly cancels the field aberration's
effect on the image, so a rim-stopped objective's frame is slightly **more**
isoplanatic than its wavefront alone predicts.

### What moved, and what could not

Exactly one category: rungs that are **traced and rim-stopped**. Ideal-pupil
rungs have no system to be non-telecentric and cannot move; traced telecentric
ones move by an identical zero. Four numbers moved in three rungs — § 6h.5's
composition identity (which had to be handed the same translated source, and
reads 2.5e-3 instead of 1e-12 without it), § 6h.5's convergence ratio, § 6m.4's
off-axis contrast (0.343 → 0.231, with its rms figures untouched because an
illumination offset is not an aberration), and § 6o.7's seam floor.

**§ 6o.7's is a finding rather than a re-pin.** Two abutting tiles sit at two
field heights, so they are lit from two points of the pupil: a mosaic seam now
carries an **illumination** step as well as an aberration one, and unlike the
crop error it does not fall with the guard band. The floor rises 7.8e-4 → 1.2e-3
while the shape of the claim — monotone in the guard, 15× over 0 → 8 cells — is
unchanged.

### Not yet pinned

- **A condenser that is genuinely not Köhler.** Critical illumination images the
  filament onto the specimen, which breaks the set-of-directions model itself
  rather than displacing it, and `illumination/source` says so in its header.
  Nothing here touches that.
- **The condenser's own aberrations and its own pupil.** The cone is translated
  rigidly; a real condenser's cone also *changes shape* off axis, which is a
  second trace this step does not run.
- **Whether § 6p's cache can be recovered.** It can, by building the lattice
  cache on the pre-shifted pupil with per-axis extents — the sample positions
  `{lattice + d}` are still one lattice, so nothing about the identity is lost,
  only the assumption that its box is centred. Rejected on scope rather than on
  merit: `abbeImage` is the branch's most-pinned module and § 6p's bit-for-bit
  identity would need re-pinning. It **does** buy something — 6x.5 measures the
  stage's off-axis tile at 1.8× — so this is a deferred optimisation with a
  price on it, not a dead end.
- **§ 6o.7's floor at a finer lattice.** 6x.6 shows the offset's effect is
  lattice-decided at 32 bins, and the mosaic rung stayed there because it renders
  four guards; the illumination seam is therefore reported with its size
  uncertain, not with its existence.
- **The DIN objective's own stop**, unchanged from § 6v and § 6w. Giving it a
  back focal stop is what would make this step's subject disappear, which is
  precisely why it must not happen in this step.

## Step 6y — the plane stack off axis

`packages/core/test/oblique-slab.test.ts`

§ 6l's own "Not yet pinned" opened with **Off axis**, and gave a reason that had
already expired: "the object-space ray aiming that would express it is § 6a's
standing blocker". § 6u built that aiming and § 6v spent it. The sentence
survived in `imaging/depth-aberration`'s header and in this document because no
structural check can see a comment that quietly stopped matching the engine —
APP.md's Part F lesson, arriving in `core` rather than in a document.

**What was true underneath it is narrower and is a fact about the module, not
about aiming:** every stack form takes the invariant as a bare radius, and a
radius cannot express coma.

The step adds **no physics**, and this is the third time the branch has been able
to say that with a straight face. A plane stack is symmetric about its own
**normal**, not about the beam; both components of the transverse invariant are
conserved at every plane face, so the wavefront is `W(|q|)` and nothing else — the
same W § 6c solved to all orders. Tilting the bundle moves the pupil's disc of
invariants **off the origin** of the plane W is radial in,

    q(ρ, φ) = q_chief + NA·ρ·(cos φ, sin φ)

and a quartic evaluated on a displaced disc is not a quartic in ρ. New:
`stackWavefrontVectorMm`, `stackObliqueSeidelMm` in `designs/coverslip`;
`chiefRayInvariant` in `pupil/microscope`; `ChiefInvariant`,
`mountWavefrontWavesVector` and `withMountAberration`'s `chief` argument in
`imaging/depth-aberration`.

| Rung | Pinned to | Status |
|---|---|---|
| A traced ray's `opl` less q·x_exit reconstructs t·√(n²−q²) to 2e-16, at every azimuth and to q = 1.3 | exact tracer, no lens | ✅ |
| …and with the reference removed it is `stackWavefrontVectorMm` to 1e-15 | closed form | ✅ |
| An axial or telecentric chief invariant takes the scalar path by delegation, so every § 6l claim is bitwise unmoved | identity rung | ✅ |
| The closed coefficient set is 1 : 4 : 4 : 2 : 4 on one A | classical plane-parallel plate (Welford; Smith) | ✅ |
| The exact form converges onto all five at fourth order — ratio 4.09 then 4.02, from above | closed form | ✅ |
| Levels at NA 0.10: +9.79e-3, +9.68e-3, +1.17e-2, −2.86e-2, −2.83e-2 — the last two approach from BELOW | measured | ✅ |
| The mount's ceiling cuts a crescent off axis, not an annulus: lost on the field's side, zero on the other | ray invariant, off axis | ✅ |
| The telecentric 4×/0.10 reads a bitwise-zero chief invariant at every height, so the slab wavefront is one wavefront | § 6v.4 | ✅ |
| The rim-stopped members tilt linearly and with a sign: 2.184557e-3 per 0.1 mm on the DIN, reversing at −h | measured off the aimer | ✅ |
| Rotating the radial reading by π lands on the trace at −h, with the y component under 1e-18 — and § 6x's offset is odd in h too | § 6x.1's azimuth pin | ✅ |
| Mirroring the field and the pupil together is the same wavefront, at three pupil radii, where mirroring the pupil alone is not | physical symmetry | ✅ |
| Coma over spherical is 4·q_c/NA with no stack in it — 8.738e-2 at 0.1 mm, 0.8736 at 1 mm | closed form | ✅ |
| The slip's coma at 1 mm is 1.1803e-3 waves against 1.3510e-3 of its own spherical, and 66.6× the mount's, opposite in sign | measured | ✅ |
| A rim that has left the stack is refused; a matched stack is an exact zero off axis as well as on | § 6e.1's identity | ✅ |

### 6y.1 — the tracer reconstructs the closed form, with no lens in the way

§ 6c.1's strength was that a plate is solvable exactly, so the tracer could be
checked against an exact answer at NA 0.95 where every third-order comparison
elsewhere has long since become a small-angle approximation. That strength is
still available off axis, and this is it.

The identity used is `Φ(q) = OPL − q·x_exit`. That subtraction is the Legendre
transform that turns a path into a phase, and it removes exactly the transverse
displacement the interface crossing introduces; what is left must be
`Σ tᵢ√(nᵢ²−q²)`, which is why the stack's formulas are a **sum over layers** at
all. Both quantities on the traced side are the tracer's own — `opl` and the
intersection point — so nothing in the check recomputes the refraction it is
checking. Agreement is **2e-16 mm** at q = 0, 0.2, 0.6, 1.0 and 1.3, at two
azimuths; with the paraxial reference removed the wavefront agrees with
`stackWavefrontVectorMm` to **1e-15** at three azimuths.

No lens, no image plane, no pupil convention and no aiming, which is deliberate:
it is § 0's argument for comparing the *primitive* rather than the workflow, made
against the engine's own tracer instead of against rayoptics.

### 6y.2 — the axial case is the old path, not a new one that agrees

`mountWavefrontWavesVector` **delegates** to `mountWavefrontWaves` when the chief
invariant is bitwise zero, rather than reaching the same answer through the vector
arithmetic. That is not tidiness. `hypot(NA·px, NA·py)` and `NA·hypot(px, py)` are
the same number in algebra and not always the same f64, so a vector path that
recomputed it would have left every on-axis claim in § 6l agreeing to a tolerance
where it used to agree bitwise. `withMountAberration` still returns its own
argument for a matched, untruncated pupil.

### 6y.3 — the classical plate set, and third order is not uniformly an over-estimate

With A the stack's q⁴ coefficient, expanding A|q_chief + q_ρ|⁴ gives the
plane-parallel plate's classical coefficients:

    W₀₄₀ = A·NA⁴          W₁₃₁ = 4A·q_c·NA³      W₂₂₂ = 4A·q_c²·NA²
    W₂₂₀ = 2A·q_c²·NA²    W₃₁₁ = 4A·q_c³·NA      piston = A·q_c⁴

The **1 : 4 : 4 : 2 : 4** pattern is Welford's plate and Smith's, and it is what
the fourth power of a shifted radius contains. Field curvature appears with **no
Petzval in it** — a plane face has no power, so W₂₂₀ is the astigmatic partner
term rather than a curved image surface.

The exact form converges onto all five at fourth order, checked on a geometry held
*similar* as the aperture shrinks (q_c = NA/4, so the coma-to-spherical ratio is
fixed at 1 and only the order varies): the relative error's ratio is **4.089 then
4.022**, approaching 4 from above, which is what separates a fourth-order tail
from a fit that happens to be good.

**The signs are the content.** At NA 0.10 the five errors are +9.79e-3, +9.68e-3,
+1.17e-2, **−2.86e-2** and **−2.83e-2**: the two terms carrying ρ² and ρ approach
from *below* while the other three approach from above. § 6l.4 could say "the
third-order form over-reports" and mean it; off axis that sentence does not
travel, and a budget built on it would be wrong in two directions at once.

### 6y.4 — the ceiling cuts a crescent, and that makes it an apodization

§ 6l.3's wall is a statement about the **invariant**, and `mountAperture`'s
min(NA, n_s) is that statement collapsed onto a pupil radius — which is only
available while the disc is centred on the stack's normal. Off axis the ceiling is
still a circle in the invariant plane and the pupil is a disc displaced inside it,
so what is lost is a **crescent on the field's own side**: at NA 1.25 with a chief
invariant of 0.15 into a water mount, the +x rim is outside (1.40 against 1.333)
and the −x rim is comfortably inside (1.10), where the centred pupil loses nothing
at all.

That is a different object from the annulus § 6l.3 measured. An annulus is a
smaller aperture; a crescent is **asymmetric**, so it is an apodization, and the
PSF it makes is not the PSF of any circular pupil. Nothing here computes that PSF
— the rung counts the lost samples on each side and pins that one is zero.

### 6y.5 — the headline is INVARIANCE, and it is not a small number

On § 6v's telecentric 4×/0.10 the chief invariant is a **bitwise zero** at every
field height, because `aimRay` takes its object-space branch where the chief
slope is § 6v.4's literal `0`. So the slab's pupil phase is not *nearly* the same
across the field — it is the **same wavefront**, asserted with `toBe` at three
pupil radii and four heights, against an axial value first checked to be non-zero
so the null is not vacuous.

**What that does not mean:** the spherical term is untouched and at full strength
everywhere. Telecentricity removes what depends on the field and nothing else.

The rim-stopped members give it a size. The DIN 4×/0.10 and § 6v's own `"rim"`
control both tilt **linearly in field** — 2.184557e-3 of invariant per 0.1 mm on
the DIN, doubling to 3 digits and reversing sign at −h, with an exact zero on
axis — read off the aimer for § 6x.1's reason: the aimer's parametrization settles
both the currency (tangent or sine, where § 6q.5 cost 61% by guessing) and the
sign, by construction rather than by convention.

**And what it costs is one ratio with no stack in it.** Every coefficient carries
the same A, so A cancels and coma over spherical is **4·q_c/NA** — geometry, not
glass. On the DIN that is 8.738e-2 at 0.1 mm of field and **0.8736 at 1 mm**: by a
millimetre the plate's coma is 87% of its spherical term, on a lens whose whole
plate contribution § 6c pinned as negligible on the axis.

**The azimuth, which every meridional rung is blind to.** § 6x.1 pinned the
illumination offset's ("+x positive, sy under 1e-15, roles swap at +y, equal
components at the 45° corner") for exactly this reason, and § 6y needs its own —
with one extra thing to say, because a chief invariant is a **direction** where an
illumination offset is a pupil **coordinate**, and `fieldPupilAt` turns both with
the same rotation. So the rule serving both is a fact to check rather than a
default. It does serve both: each is read at a positive radius and rotated,
because each is **odd** in the height (the offset is h/R_ep). Pinned by rotating
the reading through π and landing on the trace at −h, y component under 1e-18,
and by the physical statement underneath it — mirroring the field and the pupil
*together* is the same wavefront, where mirroring the pupil alone is not.

*Recorded because the rung earned it:* the first draft of that paragraph asserted
the offset was **even** in the height, on the reasoning that a ratio flips twice.
It is not — the numerator flips and the span does not — and the rung failed on
that clause rather than on the code it was written to check. Which is § 6x.1's own
lesson arriving one quantity along: parities and signs here are read, not
reasoned.

*The field range is chosen and the reason is an amplitude.* § 6v.5 measured a
telecentric bundle walking off an axially-sized front element — 11% of the pupil
at 1 mm on this very lens — so the invariance rung stays inside 0.1 mm where no
glass is lost and a phase claim cannot be confused with a vignetting one. § 6w's
`fieldNumberMm` is what buys the range back, and it is not this step's subject.

### 6y.6 — the coverslip carries this too, and it is the bigger one

Same geometry, same 4·q_c/NA, so the ratio is identical for the slip and the
mount to 12 digits — what differs is A, by **66.6×** and in the opposite **sign**,
the slip being denser than the air it emerges into and the mount rarer than its
immersion. That sign is `stackW040Mm`'s rule (§ 6l.8's trade) seen at a pupil point
instead of in a budget.

In waves at the d line, on the DIN at 1 mm of field: the slip's coma is
**1.1803e-3** against its own **1.3510e-3** of spherical. Both are four orders
under Maréchal, so § 6c's headline — low-power objectives really are
coverslip-insensitive — **survives the off-axis half** rather than having been a
statement about the axis all along.

### Not yet pinned
- **Any of this in a PSF.** The crescent is an apodization and the coma is a
  phase, and 6y.4 counts samples where a step that wanted the image would
  transform them. Rendering an off-axis aberrated volume is the follow-on and was
  deliberately kept out of this step.
- ~~**The chief invariant through a real stack.**~~ **Closed at § 6z.8, and the
  reason was revised on the way.** The objectives now carry a slab, and this
  entry's own last clause — *"for a plane stack those are the same by
  conservation"* — turns out to hold **only where the objective is telecentric**,
  where both readings are a bitwise zero. On the rim-stopped control they part
  company as the **square** of the field, because the assembly's chief ray and
  the lens's chief ray at the *paraxial* apparent depth are not the same ray and
  a plate's apparent depth depends on angle.
- **The condenser's own aberrations**, unchanged from § 6x — and now with a
  second reason to want them, since an illumination cone that changes shape off
  axis crosses this crescent rather than the axial pupil.
- **The DIN objective's own stop**, unchanged from § 6v, § 6w and § 6x. Giving it
  a back focal stop is what would make this step's control disappear.

## Step 6z — the infinity-corrected objective's coverslip

`packages/core/test/infinity-coverslip.test.ts`

§ 6c's last named deferral, and the one it left phrased as pure wiring: *"the
infinity-corrected member's slip is a named deferral, and the wiring is the same
target-S_I move `finiteConjugateObjective` makes."* The move is the same. Three
of its consequences are not, and one of them is the reason this is a step.

New: `coverslip` on `MicroscopeObjectiveSpec`, and with it `airGapMm`,
`airEquivalentObjectDistanceMm`, `freeWorkingDistanceMm`, `stopSurfaceIndex`,
`seidelS1AtWorkingConjugates` and `seidelS1OfGlassAlone` on the result — the
names `finiteConjugateObjective` already uses, so the two architectures report
the same facts. **No physics is added**: the plate is § 6c's, exact to all
orders from Snell, and this step spends it at the other conjugate.

**The headline is that the price is linear in magnification.** § 6w measured the
4× and the 40× to be one lens scaled — every length ×10, the oversize a ratio
the magnification cancels out of. A 0.17 mm coverslip is the one thing in this
branch that does **not** scale with the objective, so nothing cancels: the plate
asks the same absolute correction of every member (one number to 7 digits over
M = 4→40) while a Seidel sum, having the dimension of a length, gives a lens ten
times smaller a tenth as much to trade with. The bending it costs runs
**3.11e-4 → 3.10e-3** and the aperture ceiling gives up **0.0123% → 0.1224%**,
both linear in M. It is why a correction collar is a high-power fitting.

| Rung | Pinned to | Status |
|---|---|---|
| The gap is solved by trace, and comes back as the apparent depth t/n to 1e-13 of the object distance | § 6c's closed form | ✅ |
| A stale gap reports a different plate: 1.90× at 0.1 mm out, 9.96× at 1 mm, 403× against the glass | measured | ✅ |
| The glass alone carries PLUS the plate's −t(n²−1)u⁴/n³, to 9 digits, and the pair sums to zero | closed form, summed over real surfaces | ✅ |
| Delivered NA to 10 digits and −4× on both stop placements, one stop flag, nothing lost | § 6a/§ 6v identities | ✅ |
| The stop the slip needs is smaller by √((1−(NA/n)²)/(1−NA²)) = 1.00287, and the bare sizing reads 0.100286 back | § 6c.3's control | ✅ |
| A field number does not change the delivered correction — same S_I to 10 digits at FN 18 and without | h⁴ homogeneity | ✅ |
| …and the beam-currency control under-corrects by exactly 1 − 1/k⁴ = 0.7738 | closed form | ✅ |
| The plate's demand is magnification-free to 7 digits; the bending and the wall cost are both ∝ M | measured | ✅ |
| `imageStopBackward` assumed det = 1: an NA 0.10 objective delivered **0.152** through a slip | ray invariant | ✅ |
| …and at n_object = n_stop the corrected expression is bitwise the old one | identity rung | ✅ |
| The chief invariant through the assembly is a bitwise zero when telecentric, and ×4.00 per doubling when not | § 6y.5 | ✅ |
| The two mismatches are equal and opposite in the traced wavefront, to 2.4% | third-order identity | ✅ |

### 6z.1 — the specimen is inside the glass, and the gap is what moves

Given a slip, three things move together and none is cosmetic. The specimen goes
*inside* the glass, so `objectMedium` becomes D263 and `objectDistanceMm` becomes
the **slip thickness** — surface 0 is the slip's upper face, and the air the
objective is placed across is `airGapMm`. The lens is placed by that gap rather
than by the whole object distance. And the bending is re-solved to minus the
plate's ΣS_I, so the pair is stigmatic and the glass alone deliberately is not.

The gap is solved on the traced paraxial chain by secant — the error is affine in
the gap, so the secant is exact rather than merely convergent, which is
`collimatingGap`'s reason (§ 6q) one module along. It never evaluates t/n, which
is what leaves the apparent depth free to be the check: the objective sits closer
to the slip than it would to a bare specimen by **exactly** the depth the plate
gives the specimen, agreeing to 1e-13 of the 48 mm object distance. Quoting that
residual against the 0.11 mm depth instead would have flattered it 400×, so it is
not.

### 6z.2 — the gap and the target are ONE fixed point

The finding that separates this from § 6c's wiring sentence.

A plane-parallel plate crossed by both faces in one medium contributes a
spherical aberration **independent of where it sits**: the two faces' S_I terms
differ only through the marginal height, and that difference is the transfer
across the plate, so the sum comes out −t(n²−1)u⁴/n³ with no position in it. That
is the fact a beamsplitter designer relies on, and it is *not* the fact that
applies here. A coverslip has the image inside it, so the chain crosses **one**
face and what sets the aberration is the depth from that face to the image. Move
the face without re-solving the gap and the Seidel sum faithfully reports the
plate it can see:

| plate face, relative to focus-consistent | ΣS_I as a multiple of the truth |
|---|---|
| 0.1 mm short | **1.896** |
| 1 mm short | **9.961** |
| laid against the glass | **402.7** |

So the target and the gap close together or not at all. The fixed point converges
in a handful of passes because the only thing moving between them is the paraxial
EFL — parts in 10⁴ — and what the constructor asserts afterwards is the null on
the **real** chain in the **real** frame, where the target was computed in the
reversed one.

### 6z.3 — the target is the plate, summed rather than quoted

`achromaticObjective` solves the bending crown-first with the object at infinity,
which for the mirrored objective is the specimen side seen as the image side — so
the plate is **appended**, not prepended, and the image lands inside it. The
target is the difference of two `seidelSums` over real surfaces, never the closed
form, for § 6c's reason: a design built from the formula would be checking its own
arithmetic.

The closed form is then the pin. On the delivered lens, `seidelS1OfGlassAlone` is
**minus** −t(n²−1)u⁴/n³ to 9 digits at NA 0.10, 0.15 and 0.20, where u is the
slope the emergent marginal ray carries in air; the working sum is zero to 1e-9
of it. The bending really moves — 2.3e-4 of relative curvature on the 4×/0.10 —
and the movement is optically negligible on that lens, which is § 6c's headline
arriving on the other architecture: the plate asks for a balanced RMS under
2e-4 waves against an objective residual two orders above it.

### 6z.4 — the cone the specimen radiates into is the one inside the glass

The specimen is in D263, so it radiates into sin u = NA/n and not NA. Every stop
radius in the module is therefore a distance times `n·tan u_glass`, which is the
bare `tan u` exactly at n = 1 — one expression covering the rim and the back
focal plane, and the one that will carry an immersion medium unchanged.

Sizing it the bare way over-fills the pupil by
**√((1−(NA/n)²)/(1−NA²)) = 1.0028699**, and the readout sees it: 0.100286 for a
lens labelled 0.100. That is § 6c.3's negative control reproduced here, and the
same number, because it is a statement about the object cone rather than about
where a stop sits. Read on **one** lens, deliberately: comparing the corrected
build's stop against the bare build's carries their two focal lengths apart as
well, 6.6e-6 of it, which is a different and real difference.

### 6z.5 — the field number does not enter the currency

§ 6w's own note, closed. Once the glass is sized `f·NA + h` the marginal ray is no
longer at D/2, and `targetS1Mm` is documented as being evaluated there. So the
target is summed at D/2 as well — the same currency the solver quotes in — rather
than at the beam. The Seidel sums are homogeneous of degree four in the marginal
ray, so one currency for both sides cancels at **every** height rather than
approximately.

What that buys is measured on the delivered lens rather than argued: at FN 18 and
without one, two genuinely different builds (the fielded one is 1.45× wider) carry
`seidelS1OfGlassAlone` **identical to 10 digits**, because the plate in front of
them is the same plate.

The control is what a caller who measured the plate on the real beam and passed
that number would get. `achromaticObjective` drives ΣS_I at D/2 to the target, so
a target k⁴ too small leaves the pair carrying **1 − 1/k⁴** of the plate —
**0.7738** at FN 18 on the 4×/0.10, matched to 9 digits. Note what is *not*
claimed: the two builds' **targets** differ by 2.185 where k⁴ is 2.2519, 3% apart,
because the fielded lens's front focal distance moves. The exactness lives in the
delivered aberration, not in the target ratio.

### 6z.6 — the price is linear in magnification, and § 6w's was not

The step's headline, and it is a contrast rather than a number. § 6w:

> the oversize is a RATIO, `1 + FN/(2·f_tube·NA)` … because the semi-field and
> the beam are both ∝ 1/M — so the 4× and the 40× turn out to be one lens scaled

A coverslip does not participate in that scaling. Its aberration is set by t, n
and the aperture, and none of those knows the objective's focal length:
`seidelS1OfGlassAlone` is one number to **7 digits** over M = 4, 10, 20, 40 at
NA 0.20. What the lens can supply is not scale-free in the same way — S_I has the
dimension of a length, so a lens scaled down by ten has a tenth of it to trade —
and the two together make the price linear in M:

| M | bending shift | wall cost against the bare NA 0.287401975 |
|---|---|---|
| 4 | 3.1122e-4 | 0.01227% |
| 10 | 7.7744e-4 | 0.03066% |
| 20 | 1.5529e-3 | 0.06128% |
| 40 | 3.0977e-3 | 0.12236% |

Both columns are ×2 per doubling of M to three digits, and the bare wall itself
carries no magnification at all (§ 6w's own 0.287401975 at both 4× and 40×). This
is § 6b.5.7's geometric ceiling walked into from a **third** direction after NA
and field number, and the first one whose cost is not magnification-free.

The refusal says so. A target off zero is not the aperture's fault, and the same
aperture without a slip builds, so the message names the slip and the target it
was solved to rather than letting the solver's aperture sentence stand alone —
§ 6b.5.5's rule that a refusal should say what to change.

### 6z.7 — a telecentric aperture assumed the object and the stop shared a medium

*Recorded here rather than only in the design's own section because it is a defect
in a shipped function:* the **sixth** member of the C4/A6/C5 family, and the
second after § 1.5.2 to be found by being the first caller to reach a case.

`imageStopBackward`'s telecentric branch traces {y: 0, u: 1} back from the stop
and reads the height it exits with as **−B**, the quantity the slope aperture
divides by. That is the inverse of the object→stop matrix carrying (0, 1) to
(−B, A)/det, and the comment asserted det = 1. With `u` the raw geometric slope a
refraction contributes n_before/n_after, so **det = n_object/n_stop** — unity
exactly while the two spaces share an index, which every telecentric system in
this repo did until a specimen was put under a coverslip.

Left uncorrected the aperture comes back n times too wide and an objective
labelled NA 0.10 **delivers 0.1519**, 51.9% fast. What makes it the family's shape
is not that it is silent — it is that **two readouts disagree and neither names
the other**. The trace does object: glass sized `f·NA` for 0.10 cannot pass a
0.152 cone, so 176 of the pupil grid's rays are lost. But
`objectNumericalAperture` goes on reporting 0.152, so what a caller sees is a
correctly-labelled objective mysteriously vignetting itself — which reads as a
fault of the **glass**. § 1.5.2's "a miss reads as the system's fault", one
readout along.

*Checked rather than assumed: no other caller was reaching it.* The obvious
second candidate is immersion, whose specimen also sits in something other than
air — but `designs/immersion` and `designs/lister` both flag their stop on
**surface 0**, where `imageStopBackward` returns before the telecentric branch
exists. So this really was the first system to put a non-air object behind a back
focal stop, and there is no second silent correction hiding in the fix.

The fix carries both indices, and at n_object = n_stop it multiplies and divides
by a literal 1.0 — **bitwise** the old expression, so no system that ever worked
moved, and the whole ladder re-ran unchanged. That identity is asserted as a rung
rather than left to the suite's silence, because a "no test moved" argument
expires the moment someone edits the expression again.

### 6z.8 — the chief invariant through a real stack, and § 6y's sentence

§ 6y's second "Not yet pinned" closes here, with its own reasoning revised. It
said: *"For a plane stack those are the same by conservation."* The objectives
now carry a slab, so the claim is testable, and it is **half right**.

On the telecentric member the assembly's chief invariant and the lens's are both
a **bitwise zero** at every height — § 6y.5's null, surviving the arrival of the
glass it was a statement about. On the rim-stopped control the two part company,
and the departure is the **square** of the field: 3.0e-7, 1.2e-6, 3.0e-5 at
h = 0.05, 0.1 and 0.5 mm, which is ×4.00 per doubling and ×25 over a fivefold.

The reason is not conservation failing — a flat face conserves n·sin exactly along
any ray. It is that the two constructions do not compare the *same* ray: the
lens-alone system places its specimen at the **paraxial** apparent depth, and a
plate's apparent depth depends on the angle the ray leaves at. So the assembly's
chief ray and the lens's chief ray are different rays whose invariants differ at
second order in field. § 6y's sentence was a paraxial statement wearing an exact
one's clothes.

That puts a third term on the ladder § 6n assembled off one coefficient — § 6h.1's
cubic ×8.00, § 6n's curvature ×2.00, § 6m.4's slope — and this is the one § 6y did
not have.

### 6z.9 — what the correction is worth, and which way it points

Third order says the two mismatches are exactly equal and opposite: the corrected
glass carries +plate and the bare glass carries 0, so taking the slip away from
one and putting it in front of the other move ΣS_I by the same amount in opposite
directions. That survives into a **traced** wavefront to 2.4% on a lens whose
residual is dominated by orders the target never saw, which is the part worth
pinning.

**The direction falsifies the slogan on this lens.** § 6c's "using a corrected
objective without its slip is worse than using no correction at all" is a
statement about the third-order term. On the 4×/0.10 the corrected objective run
**dry** is 2.3% *better* than the matched pair — the doublet's own fifth-order
residual dominates, and the plate's third-order term partly cancels it. That is
§ 6e.4's "the cover slip HELPS" arriving where it does not help anyone: both
figures are two orders over what the plate itself asks for, so the sign is a
curiosity here and would only be a trade on a form that can carry the aperture.

### Not yet pinned
- **The chromatic half.** The slip is dispersive and the correction is solved at
  one wavelength, so a slip-corrected objective is corrected at the d line and
  nowhere else. Unmeasured, and the same deferral § 6e names for the dome.
- **The correction collar**, which § 6e.5 already re-scoped as an index-and-NA
  fitting rather than a thickness one — and which § 6z.6 now gives an
  independent reason to want, since the price of correcting is what grows with
  magnification.
- **The mismatch sweep.** § 6c.3 sweeps slip thickness and index on the DIN;
  nothing here does, because at the apertures this form reaches the tolerance is
  200× the slip and the sweep would measure the solver.
- **The immersion members.** `designs/lister` and the aplanatic front take no
  target at all, so correcting *those* for a stack stays § 6e's open item.
- **The condenser's own aberrations**, unchanged from § 6x and § 6y.

## Step 6aa — the transform of a row nobody wrote

Every wave-layer caller in this engine fills a **box** and transforms a
**grid**, and the gap between the two is paid on every render. The pupil spans
`pupilSamples` bins inside a `size` array; at the shipped brightfield 32-in-128
that is 33 rows carrying signal and **95 that are identically zero**, and
`wave/psf` is sparser still, because `padFactor` 4 puts a `pupilSamples`-wide
pupil in a grid four times that. A row–column FFT transforms each of those zero
rows separately. A transform of zeros is zeros.

So `fft2d` takes an optional `writtenRows` band and skips the rest of the row
pass. Only the ROW pass is skippable: afterwards every row is dense across all
`n` columns, so every column still runs. Like § 6p and § 6s this is a **speed
step and nothing else**, and its rungs are therefore identity rungs — the claim
is that no image anywhere changes, and the way to pin that is `toBe`.

| Rung | Pinned to | Status |
|---|---|---|
| **Banded ≡ full, BIT FOR BIT** — 3 sizes, 5 bands, forward and inverse | `toEqual` on Float64Array, not a tolerance | ✅ |
| `fftShift2d` sends a contiguous row run to a **cyclic** band, count unchanged | the shift itself, not the algebra | ✅ |
| **NEGATIVE CONTROL: one row short is a DIFFERENT array**, by > 1e-3 | the parameter is load-bearing | ✅ |
| A band covering the grid, or omitted, is the full transform | `toEqual`, three ways | ✅ |
| **The Abbe sum ≡ a sum with NO box and NO band** — 2 pupils × 2 sources | `toEqual` on every pixel | ✅ |
| …including the cached path, so the band and § 6p's cache compose | commensurate source | ✅ |
| A pupil that blocks whole rows of the box still images identically | the hull is inside the box | ✅ |
| **`incoherentPsf` ≡ the whole-grid kernel** — 3 grids | `toEqual` | ✅ |
| **`psfFromPupilFunction` ≡ the whole-grid PSF** — 3 grids, intensity/peak/Strehl | `toEqual`, `toBe` | ✅ |
| The padding is the sparsity: 65 written rows of 256, under 0.3 | counted off `pupilSampling` | ✅ |
| A band that is not a band — fractional, negative, empty, off-grid: **refused** | `latticeMatchedSource`'s argument | ✅ |

### The two ways of being wrong are not symmetric, and that decides the API

A band **wider** than the rows the caller wrote is merely slower than it needed
to be. A band **narrower** than them drops signal and returns a perfectly
plausible wrong image — the same failure shape `commensurateSource` refuses one
module over, where a *nearly* commensurate source would take a cached path and
form an image whose disagreement with the honest sum reads as physics.

So the callers do **not** derive the band from the box bounds they believe.
They record `iy` as they write and hand back the hull of what they actually
wrote, which is a superset of the nonzero rows: a row inside the hull whose
every sample was blocked stays zero and is transformed for nothing. That is the
safe direction, and § 6aa.5 is the case where the two differ — a pupil that
transmits only a strip leaves whole rows of the |u + s| ≤ 1 box empty, and the
recorded hull is the one that is right.

The derivation that *is* shared lives in `shiftedRowBand`, beside `fftShift2d`
rather than open-coded at three call sites, because it is one fact about the
shift: row r afterwards holds what row (r + n/2) mod n held before, so a
rotation takes a contiguous run to a contiguous run — cyclically, since the run
may straddle row 0. § 6aa.1 pins it against the shift itself rather than against
the algebra that produced it.

**The negative control is what makes the rest of the table mean anything.**
Every identity rung above would also pass on an implementation that ignored the
parameter entirely. § 6aa.3 asserts that a band one row too narrow produces a
different array, and by more than a rounding — dropping a row drops its whole
contribution, not a last bit.

### What it buys, measured, and where it does not

Medians of 7 runs after 3 warmups, DIN 4×/0.10, one machine:

- **The Abbe sum, ideal pupil, 97 directions: 125 ms → 80 ms, 1.56×.** This is
  the pure case — § 6p's null half, where the transforms are the whole bill and
  the cache buys nothing, is exactly where this buys the most.
- **The shipped brightfield panel render: 134 ms → 95 ms ideal, 378 ms → 331 ms
  traced.** The traced figure is small for § 6p's reason in reverse: there the
  bill is the re-tracing, and this step does not touch it.
- **`incoherentPsf` at 256/32: 5.9 ms → 4.3 ms.** **`psfFromPupilFunction` at
  512: 130 ms → 110 ms** — smaller than the row arithmetic predicts, because
  `pupilSampling`'s edge sub-sampling and the full-grid energy loop are a real
  fraction of that call and neither is a transform.

The pattern across all three: the saving is a fraction of the *transform*, so it
is largest exactly where a pupil is cheap and a grid is large, and invisible
where a traced callback dominates. Both halves are reported, for § 6p's reason —
a speed claim without its null half is a claim about the wrong quantity.

### 6aa.8 — the column pass, measured and declined

**The open item said the input is sparse in both axes while only rows are
skipped, and that a sparse-input transform is a different algorithm wanting its
own identity rungs. It is, and it is not worth writing.** The reason `math/fft`
gave for stopping at rows was also wrong, which is why this is a section rather
than a struck bullet: it said each transformed row is dense across all `n`
columns "so every column has to run". That is true of a row's VALUES and beside
the point. A column's INPUTS are still mostly zero — after a banded row pass
exactly `count` of the `n` rows hold anything, which § 6aa.8's first rung pins,
because a declined optimisation whose premise was never checked is an argument
and not a measurement.

What actually stops it is arithmetic, in two steps:

- **A radix-2 stage collapses to copies only where the zeros are an ALIGNED
  block, and every caller here writes a CENTRED one.** Whole skippable stages
  are ⌊log₂(n/count)⌋, and at **both** shipped grids that floor is **1** — not
  the 2 the 4× padding suggests. The pupil spans `pupilSamples` bins, its
  inclusive hull is `pupilSamples + 1`, and inside `padFactor` 4 that is one row
  past a quarter of the grid. One row is the whole margin, and § 6aa.8's second
  rung pins that it binds at 32 and at 64 alike.
- **Realigning a cyclic block so a stage becomes skippable is a phase ramp over
  the output — n² complex multiplies.** Measured at n = 256: the ramp costs
  **0.210 ms** against the one stage's **0.208 ms**. A wash, to three digits, by
  arithmetic rather than by luck — the saving is (n²/2)·k butterflies and the
  correction n² multiplies, so at k = 1 they are the same order and the constant
  decides. At n = 128 it nets 0.028 ms, **5.5%** of a 0.507 ms banded transform.

Sized against what a caller actually waits for, that best case is smaller again:
`psfFromPupilFunction` runs **two** transforms inside a step measured at 17–18 ms
at 256², of which the pair of `fft2d` calls is ~4 ms — so a perfectly realized
column pruning is ~0.4 ms of ~17 ms, and the pupil sampling and phase loop
beside it are the larger half. Declined on that, not on difficulty.

### Not yet pinned
- **The other `fft2d` call sites, read and found dense.** `imaging/render`'s
  `convolveCentred`, `imaging/fluorescence`'s and `imaging/volume`'s
  `convolveCircular` — two transforms each, object and kernel — plus `wave/mtf`
  and `wave/seeing`'s phase screen. One rule decides all five: what is sparse is
  a **pupil**, and what these transform is a **PSF or an object**. A PSF
  *spreads* — that is what a PSF is — so a convolution kernel fills its grid
  even though the pupil it came from did not, `mtf` transforms a PSF intensity
  for the same reason, and `seeing` writes coloured noise into every cell by
  construction. So `fluorescence` takes the band at its `incoherentPsf` and not
  at its `convolveCircular`, which is the same file treated two ways on purpose.
  Named here as a **reading** rather than an inference: "there is no sparsity
  here" is worth exactly what the reading behind it is worth, and the first
  draft of this bullet asserted it for two of the five without having opened
  any.
- **The wall-clock figures are measurements, not rungs**, exactly as § 6p's are.
  A timing assertion is flaky; the identity is the claim a test can hold.

## Step 6ab — the commensurate condenser at an S on no lattice

§ 6p's cache is licensed by every source point sitting on the pupil's own
frequency lattice, and `commensurateSource` buys that licence by deriving its
point **count** from S — so it throws on any S making `S·pupilSamples/m` a
fraction. A caller with a continuous S had to choose between the cache and the
slider, and both brightfield panels chose the slider: they call `diskSource`,
and the cache has never once been taken on the surfaces a reader actually opens.

**Snapping S is not the small concession it looks like.** The brightfield
panel's central demonstration — an S where the textbook law says the grating is
transmitted and the sampled condenser says it is not — lives in a window of S
*one lattice cell wide*: 0.3125 to 0.3438 at `pupilSamples` 32, which is 10/32
to 11/32. A slider snapped to multiples of 1/pupilSamples cannot put a stop
strictly inside a window one cell wide; it can only land on the endpoints. So
snapping does not degrade that demonstration, it deletes it, and the proof is
arithmetic rather than taste.

`latticeDiskSource` decouples the two instead. `abbeImage`'s precondition, read
off `latticeOffset`, is about **coordinates** — whole numbers of half-steps, one
parity — and S enters only through the disc mask `sx² + sy² ≤ S²` that
`commensurateSource` already applies. So the grid is a fixed lattice, S is free,
and the direction count follows from `stepMultiple` as a consequence.

| Rung | Pinned to | Status |
|---|---|---|
| **Cached ≡ uncached BIT FOR BIT at an S on no lattice** — the rung § 6p cannot state | `toEqual`, 3 steps × 3 S × 2 pupils | ✅ |
| …and `maxGridPhaseStepWaves`, a max over directions, is the same number | `toBe` | ✅ |
| The saving is EXACTLY `contributingPoints`, at every one of those S | counted, integer | ✅ |
| `commensurateSource` **refuses every one of those S**, which is the whole point | its own message | ✅ |
| Every coordinate is a whole number of half-steps, all at parity 0 | `Number.isInteger`, 3 lattices × 4 steps | ✅ |
| S = 0 leaves exactly the one on-axis direction — the coherent limit, not a case | `toBe`, weight 1 | ✅ |
| **The extent is `ceil`, so a ring at exactly \|s\| = S is admitted** | `toBe(S)`, the case `floor` needs an epsilon for | ✅ |
| …and no point outside the disc is ever admitted, whatever it rounded to | the mask, 4 steps × 9 S | ✅ |
| § 6p.9's identity survives: (S, 64, 2) is (S, 32, 1), same points | `toBe`, 9 S | ✅ |
| The quadrature converges as the lattice refines, measured at each step | § 6f.2's `maxTransferError` | ✅ |
| **Not worse per direction than `diskSource`** — 197 points read below its 177 | § 6f.2's metric | ✅ |
| **The cutoff gap is a DIVISIBILITY LAW**: empty iff m divides cycles − ps/2 | closed form vs a swept measurement, 2 lattices × 32 frequencies | ✅ |
| …so `stepMultiple` 1 has no gap at **any** frequency | the law, both lattices | ✅ |
| …and the POWERS OF TWO die together at cycles 20, 24, 28, 32 | `toEqual` on the dead list | ✅ |
| …which an odd step rescues, leaving only ν = 1.75 | `toEqual([28])` | ✅ |
| A non-power-of-two `pupilSamples`, a fractional step, a negative S: **refused** | § 6p's exactness argument | ✅ |
| The frequency-grid wall still throws — no softening anywhere | `abbeImage`'s own message | ✅ |

### Two deliberate differences from `commensurateSource`

**The count is odd, so the grid is centred.** Parity is then 0 whatever
`stepMultiple` is, there is always an on-axis direction, and S → 0 degenerates
to `coherentSource`'s one point with no special case. It is therefore *not*
`diskSource`'s lattice, and § 6p.1's bitwise identity does not transplant — this
is a different quadrature of the same disc, and § 6ab.6 measures it as one
rather than assuming § 6p's answer carries over. It does carry: 197 lattice
directions at S = 0.5 read **1.15e-2** against `diskSource`'s 177 at 1.29e-2 and
its 349 at 1.04e-2, so the decoupling costs nothing per direction and § 6p.6's
"commensurability is accuracy-neutral" survives the generalization.

**The extent is `ceil` and carries no tolerance.** The grid only has to *cover*
radius S, because the mask decides membership: an extra ring is dropped and
costs nothing, while `floor` can drop a legitimate ring when the division rounds
down and needs an epsilon to be safe. That is § 6aa's asymmetry — wider is
merely slower, narrower is silently wrong — and a rounding tolerance inside a
*lattice* constructor is the exact lie `commensurateSource` refuses two
functions up. The first draft carried `+ 1e-12`; removing it changed no count
and no error, which is the point: it was never buying anything, and it was still
the wrong shape.

### The gap is a divisibility law, and it is why an odd step is offered

The sampled condenser's outermost useful direction is axial, so its reach is
1 + ⌊S/spacing⌋·spacing against the textbook's 1 + min(S, 1). Those disagree
*about a given grating* only where the grating's frequency falls between two
lattice radii, so with ν = 2·cycles/pupilSamples and spacing =
2·stepMultiple/pupilSamples the question collapses to whether
(cycles − pupilSamples/2)/stepMultiple is a whole number.

That is not a curiosity. At `stepMultiple` 1 the source lattice has the grid's
own step and ν is quantized to that same step, so the finest lattice reaches
exactly the frequencies the grid can hold and there is **no gap at any
grating** — a true fact that would otherwise read as a broken panel. Worse,
every power-of-two multiple is dead together wherever 4 divides
cycles − pupilSamples/2: at `pupilSamples` 32 that is ν = 1.25, 1.5, 1.75 and
2.0, a quarter of the usable slider. An odd multiple breaks the pattern, and
{4, 3, 2, 1} leaves only ν = 1.75 uncovered because 28 − 16 = 12 is divisible by
4, 3, 2 and 1 alike. `latticeCutoffGapExists` is the law as a function, so the
panel greys out a step rather than leaving a reader hunting for a demonstration
that is provably not there.

**The rung found a rounding in its own measurement, and the fix was the
measurement.** Swept against the closed form, ν = 1.375 at `stepMultiple` 1
reported a gap the law said was empty — at S = 0.37499999999999994, one ulp
below the lattice radius 0.375, where `1 + S` **rounds up** to exactly 1.375
while the disc mask (comparing S² against the radius²) correctly excludes the
ring. Two sides of one comparison reading S at different precisions. Written as
`min(S, 1) ≥ ν − 1` there is no addition to round and the disagreement is gone.
Same family as § 6p.1's 5.6e-17: physically nothing, exactly enough to change an
answer.

### What it buys, measured, and the half it does not

DIN 4×/0.10 through the panel's own request path, S = 0.5, `pupilSamples` 32:

- **Traced: 197 directions in 144 ms, against the shipped 97-point disc's
  236 ms.** More converged and faster at once, which is the shape of the whole
  step — 197× fewer pupil evaluations (exactly `contributingPoints`, § 6p.4).
- **Ideal: 163 ms against 90 ms — slower**, and reported because it is the same
  fact from the other side. What was removed is the *tracing*; twice the
  directions cost twice the transforms, and on a pupil that costs nothing to
  evaluate there is nothing to save. § 6p's null half, reproduced exactly.
- The step ladder at S = 0.5 traced: **13 / 21 / 49 / 197** directions at
  **31 / 43 / 62 / 174 ms**, so the whole ladder is inside APP.md's ~800 ms live
  line where `diskSource`'s finest setting (349 points, 1 124 ms) never was.

**The cost crosses over, and it is the count and not the cache that does it.** A
lattice step is a fixed *angular density*, so the direction count follows the
aperture's area — 49 at S = 0.25, 197 at 0.5, 797 at 1.0, 1 793 at 1.5 — while
`diskSource` holds 97 wherever S goes. Traced at `pupilSamples` 32 that is
**49 ms against 231** at S = 0.25 and **1 115 ms against 272** at S = 1.5, with
the crossing near S = 0.75. Neither number is a defect: § 6p.7 already found
that what un-flattens the error floor is the point count, and a fixed count does
not stay a fixed *quality* as the diaphragm opens — it stops saying so. The step
control is what trades it back, and the panel prints both the count and the
clock so the trade is visible rather than inferred.

**At `pupilSamples` 64 the panel was already past its own live line, and this
step improves it rather than causing it.** Traced at size 128: the shipped
`diskSource(S, 11)` runs **1 523 ms** and its 21-point setting **5 672 ms**,
against the pupil-matched ladder's **125 / 188 / 299 / 1 110 ms** at steps
4/3/2/1. So every pupil-matched setting beats the old default there, and step 2
— 197 directions, the same count the default gives at `pupilSamples` 32 —
returns it to 299 ms. The default step is left at 1 rather than adjusted per
lattice: the count is printed on the control itself, and a control that rewrites
another control's value is the state-chasing-state the panel's own S clamp is
written to avoid.

### The phase panel, audited — and declined (§ 6ab.9, § 6ab.10)

**The reasoning does not transplant, which is what the item said and is now the
measurement rather than the suspicion.** The phase panel is ideal-pupil *by
design* — APP.md A3 is explicit that tracing it would replace an exact null with
a small number that cannot be told from a bug — so it sits exactly in § 6p's
null half above. There is no tracing for the cache to eliminate, and twice the
directions is twice the transforms: at S = 1 the panel's own render goes
**57 ms → 349 ms** on 97 points against 797. Three facts decide it and § 6ab.9
pins each:

- **The switch would cost directions and buy no cache.** Counted rather than
  timed, since the cost is linear in the count and a millisecond is a property
  of the machine: 97 at every S against 197 at S = 0.5 and 797 at S = 1.
- **It would fix the null's precondition and nothing observable.** The null
  needs a source symmetric under s → −s, and `diskSource` is symmetric only to
  rounding — `gridCoordinate` forms `radius·(2(i+½)/samples − 1)`, and the
  subtraction of 1 does not commute with the mirror, so the outer pair at
  11 samples is 0.9090909090909091 against 0.9090909090909092. The asymmetry
  scales with S, reaching 2.2e-16 at S = 1, against the lattice's exact zero.
  The measured null is ~1e-16 either way.
- **And it could not have been a straight swap.** Below one lattice cell
  (S < 2/`pupilSamples` = 0.0625) the lattice holds a single point, so a slider
  stepping by 0.01 would show the coherent limit for its first 6% of travel,
  where `diskSource` keeps its full 97 all the way down.

**What the audit actually found is a defect in the panel, and it is not about
which source (§ 6ab.10).** The panel prints the 2ν contrast — the second-order
term that survives where the linear one is null — to four significant figures
(`toExponential(3)`; this file said "six digits" until § 6ab.11 went to read the
call), and that number is not converged over the top ~40% of its own S slider. Worst ratio between
samplings of the same source: **1.06× at S = 0.6, 1.26× at 0.75, 1.76× at 0.90,
9.75× at S = 1.00**, and 5.8× to 42.7× at every S above it out to the slider's
1.5. At S = 1 the shipped `diskSource(S, 11)` reads **1.48e-3** where the
797-point lattice, the 349-point disc and the 2 933-point disc all read
~1.5e-4 — 1.531, 1.517 and 1.557e-4, agreeing to 3%.

**That trio is not the whole story and is not being selected for.** The
1 313-point disc reads 3.385e-4, 2.2× off the three that agree, and the
5 169-point one reads 7.9e-5, 2× off the other way. So the refinements scatter
among themselves by about a factor of two, and the honest statement is not "the
converged value is 1.5e-4" but that the shipped reading sits an order of
magnitude **outside** a scatter it should be inside. Which of the refinements is
closest to the continuum is not settled here and does not need to be: what the
panel prints is wrong either way.

**It is not coarseness, and refinement does not fix it.** A lattice at step 3
uses FEWER points than the shipped disc (89 against 97), a COARSER spacing
(0.1875 against 0.1818) and a WORSE rim reach (0.9561 against 0.9791) — and
reads 1.58e-4, agreeing with the 797-point lattice to 3%. Meanwhile refining the
disc does not converge: at S = 1, 1 313 and 2 933 points disagree with each other
by 2.2×. The quantity is dominated by which points land near |s| = 1, where the
shifted pupil is tangent to the objective's, and no amount of interior sampling
resolves a rim. The signal itself collapses across that band — 2.8e-2 at S = 0.6
against 1.5e-4 at S = 1 — so the disagreement grows while the thing it is
measuring shrinks.

The rung asserts the two ends and the outlier and stops there. What the panel
should *print* above S ≈ 0.9 is a product question — fewer digits, a stated
uncertainty, or a refusal in the idiom it already uses for a 2ν bin that does
not fit the grid — and answering it honestly costs a second render, so it is
listed below rather than guessed at here. **§ 6ab.11 answers it, and the answer
is none of the three**, for a reason § 6ab.10 could not see from ν = 0.75 alone.

### The 2ν readout, answered (§ 6ab.11) — and there was no boundary to draw

`packages/app/test/phase.test.ts`, the first app-side rung on this panel.

§ 6ab.10's three candidate answers — fewer digits, a stated uncertainty, a
refusal — **all want a boundary, and measuring across ν and φ says there is not
one to have.** Both structural facts are new here and either alone kills a rule
in S:

- **ν = 1 exactly is 9.4× uncertain at every S from 0.25 up**, not just at the
  top of the slider. The ±1 orders land on the pupil rim, where the lattice
  decides in-or-out for them one point at a time — the same rim `threeOrderCheck`
  already excludes ν = 1 for, showing a second face that has nothing to do with
  S. A band in S would print four significant figures on it. *§ 6ab.12 names what
  this is: the carrying set there has zero **area**, so the honest reading is 0 and
  the 9.4× is a lattice disagreeing with itself about nothing. "Structural" was
  right and "property of the rim" was not.*
- ~~**ν = 1.94 is inside 1.05× at S = 1.5.** High S is not uniformly bad, so a
  band in S would also refuse readings that are fine.~~ **Withdrawn at § 6ab.12,
  and left visible because it is the sharpest thing this panel taught.** 2ν there
  is 3.875, nearly twice the incoherent cutoff: nothing carries it at any S, all
  four samplings are reading f64 roundoff, and *that is why they agreed*. The
  tightest agreement in the panel was the strongest evidence of nothing at all —
  a probe over a control cannot tell a converged reading from an absent one.
- And **φ moves it as hard as either**: at φ = 0.1, S = 1.5 spreads **838×**;
  at φ = 3 the same cell spreads **1.37×**. ~~The 2ν signal grows as φ² and what
  disagrees with it does not, so the ratio is a signal-to-noise statement as much
  as a geometric one.~~ **Wrong, and corrected at § 6ab.18: the disagreement grows
  as φ² too. What makes the printed ratio run is the 7-point lattice reading
  O(φ⁴) at this cell where the other three read O(φ²). The lever measured as a
  fraction of the reading is 9.7×, not 838×.** **This is the leg the conclusion
  now rests on**, and it
  survives the withdrawal above on its own: ν = 0.75 at S = 1.5 has 27.8% of its
  illumination carrying 2ν, so both those numbers are readings of something, and
  one S holding both 838× and 1.37× is a band in S refuted at a single S.

**A cheaper probe than the exhaustive one lies, measured rather than supposed.**
The obvious self-check — render at one other sampling, print the disagreement —
reads **1.3× at S = 1**, where 11-against-21 reads **9.7×**; at S = 1.25 the two
swap (7.6× against 1.1×). Every three-of-four subset tried under-reports the
four-way spread somewhere. Two samplings agreeing bounds nothing.

**So the panel prints the range across `PANEL_SOURCE_SAMPLES` — 7/11/15/21,
every option its own control offers, all of them rendered — and no ± anywhere.**
(**In brightfield, since § 6ab.19.** Darkfield's control is a lattice spacing
there — 0.0625/0.125/0.25 — and the spread carries a `kind` so the readout names
which quantity it is a range across. The scope argument below is unchanged: it is
still an exhaustive enumeration of one control, just of a different one.)
What dissolves the hard rule is the scope: the claim is not *"the error is X"*,
which would need a continuum this file has no external number for, but *"moving
this control moves the number by X"*, and over a four-member list that
enumeration is **complete rather than sampled**. Widening to nine samplings
reaches 41× at S = 0.9 and 185× at S = 1.5, which is exactly why the sentence is
scoped to the control rather than to the truth. The list is exported from
`phase.ts` and the control is built from it, so the two cannot drift apart and
quietly turn the sentence into a sample.

**The defocused frame needed its own probe, and finding that out changed the
code.** The module's "2ν is the same at every defocus" is derived at S = 0, where
one on-axis point puts the ±1 orders at equal pupil radius so the defocus phase
cancels in the beat. Off axis it does not — the beat picks up
w₂₀(|s + ν|² − |s − ν|²) = 4·w₂₀·(s·ν), which vanishes for no off-axis point.
Measured at S = 0.9, ν = 0.75: **5.87e-3 in focus against 6.64e-4 at w₂₀ = 1 and
1.57e-2 at 6**, where S = 0 holds 7.691302e-2 at every one of them. The spreads
move with it — 1.2× in focus at S = 0.5 against 13.4× at w₂₀ = 3 — so one probe
over the pair would have reported whichever frame it happened to run on.

**Darkfield was never audited and is the worst case in the panel.**
`annularSource` masks the same lattice, so the ring holds **16 points at N = 7
against 128 at N = 21**, and at ν = 0.75 the 16 do not resolve the beat at all:
**8.8e-17 against ~1.5e-3**, a spread of 2.3e13 across the panel's own control.
A reader on that option is shown "no second harmonic in darkfield", which is
false — the other three samplings agree to 1.35×. ~~It is left as a reading the
probe reports rather than an option the panel gates, because a "too few annulus
points" gate would need a threshold nothing here measures.~~ **§ 6ab.12 gates it,
and needed no threshold: the 16 points are not too few, they are none of the
set.**

**Cost, and why the default state pays none of it.** At S = 0 in brightfield
`sourceFor` returns `coherentSource()` whatever the count, so the four options
are one source and the spread is 1 with **zero extra renders** — verified
bit-identical (0.07691301586554729 from the N = 7 and N = 21 branches alike),
not assumed. Past that the probe cost is near enough *fixed*, since it always
renders the three options the reader did not pick: measured under `vite-node`,
**5 ms at the panel's default**, 391 ms once S = 1 in focus (339 of it probe),
989 ms with the defocused frame distinct, and 4.8 s at grid 256 with
pupilSamples 64 against 2.3 s before. The panel prints the split rather than
carrying its old "N ms for the pair" label over renders that are not the pair.

Two things deliberately left alone, and why: `besselCheck`'s **nine decimals**
need no spread, because `threeOrderCheck` requires S = 0 — the one source point,
where every sampling gives the same image and there is nothing for the count to
move. And samplings the frequency grid cannot carry are **dropped and named**,
never clamped: the panel's S ceiling is computed from the count in force and the
binding lattice sample sits at S·(1 − 1/N), so a reader at N = 7 can be at an S
that N = 21 cannot render, and a truncated pupil would read as a smaller
aperture.

### Not yet pinned

- ~~**Does rim weight predict the spread?** … A criterion of the shape "weight
  within one lattice spacing of the tangency circle" would be a cheap render-free
  substitute for the whole probe.~~ **No — refuted at § 6ab.18**, with a cell
  where that weight is *exactly zero* in all four lattices and the readings
  disagree by 0.73 of their mean. The cheaper candidate already in the repo, the
  spread of `harmonicSupportWeight`, fails the same way. § 6ab.18 also finds the
  explanation of the φ lever in this section to be wrong.
- ~~**Whether darkfield at 7 source samples should be reachable at all.**~~
  **Answered at § 6ab.12, and the framing was the problem.** It is not a
  threshold on annulus points: at ν = 0.75 the ring's carrying band is
  s_x ∈ [1.25, 1.4] and the 7-sample lattice's outermost x is 1.2, so it holds
  **no point of the set at all**. Exact, and the same criterion turns out to
  condemn two readings § 6ab.11 trusted. (**And at § 6ab.19 the question stopped
  being about a threshold in the other direction too: the option is gone.**
  Darkfield's control is a lattice spacing now, so 7 samples is not a setting the
  panel has. The ring itself still reads 8.8e-17 and is still pinned — as a ring,
  not as something a reader can select.)
- ~~**A commensurate ANNULUS**, still — § 6p's own open item, and now with a
  constructor that would make it S-free too.~~ **Built at § 6ab.19**, and it takes
  the § 6p cache into darkfield: identical images bit for bit at 1 089 pupil
  evaluations against 662 112. The app is not wired to it.
- **Whether the staircase is the better teaching object.** The pupil-matched
  cutoff curve is a sawtooth of amplitude one lattice step (measured max 0.060
  at `pupilSamples` 32, against the plot's 1.2 of range) where `diskSource`'s is
  a smooth offset curve. Both show "a finite condenser lattice"; nothing here
  measures which one a reader learns more from, and that is a claim about people
  rather than optics.

### 6ab.12 — the readout had no support, and there was never a threshold to find

`packages/core/src/illumination/transfer.ts`
(`harmonicSupportWeight`, `apertureCarriesHarmonic`),
`packages/core/test/harmonic-support.test.ts`, 21 rungs, 15 s.

§ 6ab.11 left "should darkfield at 7 samples be reachable" open **because it was
looking for a threshold** — how few annulus points is too few — and § 6ab.10
before it had gone looking for a band in S. There is no threshold in this. There
is a geometric fact, and it is exact:

> A grating diffracts into orders at s + m·ν. The image is |Σ orders|², so its
> harmonic at h·ν comes only from beats between order pairs **h apart**, and
> those sit h·ν apart in the pupil. **The harmonic exists only if some
> illuminated direction puts both members of one such pair inside the pupil.**

No wavefront, no φ, no defocus — which is the contrast with § 6ab.11's finding
that the *spread* needed a probe per frame. Existence is geometry and one
computation covers both frames; magnitude is not and does not.

**The criterion is pinned by recovering two cutoffs this file already has, not
by asserting itself.** At h = 1 it *is* Abbe's law: asked only "can two orders
one ν apart both be inside the pupil, from somewhere in a disc of radius S", the
answer flips at exactly `intensityCutoff(S)` = 1 + min(S, 1) — the
λ/(NA_obj + NA_cond) of § 6f, arrived at from order geometry with the formula
nowhere in the code. At h = 2 the same argument caps ν at **1**, because 2ν must
still clear the incoherent cutoff 2, so **a second harmonic past the coherent
cutoff does not exist at any S.** Both flips are checked at ±1e-9, not on a
sweep grid: they are exact, not asymptotic.

**Darkfield has its own, lower cutoff, and nothing had noticed.** Necessary is
not sufficient — the direction has to be *in* the aperture, and a ring starting
outside the pupil reaches a pair only by borrowing a whole number of orders. The
smallest usable count is 3, so the binding condition is 3ν ≤ 1 + outer and the
ring's second harmonic stops at **(1 + outer)/3 — 0.8 for A3's own 1.1–1.4
ring**, three slider stops below where a reader would expect anything to change.
The ring's carrying area *thins* to it rather than falling off it (as areas, from
§ 6ab.14: 55.11% at ν = 0.25, 19.66% at 0.7, 7.027% at 0.75, 0.634% at 0.79,
nothing at 0.8), which is the evidence that it is a boundary of the geometry. The grating's own line survives
where its second harmonic does not: at ν = 0.875 the ring still carries ν and
not 2ν, so darkfield does not stop imaging there — it stops having a second
harmonic, and those are different claims.

### The two legs disagree in both directions, and each was a shipped defect

`apertureCarriesHarmonic` asks it of the **aperture**, in closed form and on a
set of **positive area**. `harmonicSupportWeight` asks it of the **sampled**
source an image was formed from, by calling `pupil.amplitude` at exactly the
coordinates `abbeImage` evaluates — never a fresh |p| ≤ 1, because A3's ring at
11 samples carries on **two points out of 36** and one lattice cell is the
difference between a verdict and its opposite. Three regimes, and the panel was
printing four significant figures in all of them:

- **aperture yes, sampling no — the lattice is blind.** The 7-sample ring holds
  16 points and none is in the carrying band, so it reads 8.8e-17 and a reader is
  shown "darkfield has no second harmonic". (**No longer reachable from the panel
  after § 6ab.19** — darkfield's control is a lattice spacing and every setting it
  offers holds this set. The regime itself still exists and the gate still fires:
  25 cycles at grid 256 / `pupilSamples` 64 is where, and that cell is why the
  count came off.) § 6ab.11 measured the 2.3e13 spread
  and could not name the cause. The weights are point counts: **0 of 16, 2 of 36,
  6 of 68, 10 of 128** — and the surviving three are thin enough (5.6%, 8.8%,
  7.8%, against the aperture's own **7.027%**; the 6.6% first quoted here is a
  scan that weights every (ring, angle) sample equally and so is not an area at
  all, corrected at § 6ab.14) to explain why they still disagree by 1.35× once
  they agree there *is* one.
- **aperture no, sampling yes — the lattice invented it.** At ν = 1 exactly the
  carrying set is the single on-axis direction: zero area, so a real objective at
  its own cutoff transmits nothing, but `diskSource` puts a point at the origin at
  odd counts, `idealPupil` admits the orders because its test is |p| ≤ 1, and the
  panel reads **8e-4**. § 6ab.11 recorded that number's 9.4× disagreement as a
  *structural property of the rim*; it is area zero given finite weight, and the
  weight thins with the count (1/97 against 1/317) exactly as a measure-zero set
  must. A brute-force scan of the aperture is fooled the same way and the closed
  form is not — which is the whole reason the leg asks for area.
- **neither — and this one looked the most settled of anything in the panel.** At
  ν = 1.9375 the four samplings agree to **1.031×**, the tightest agreement
  anywhere, because all four are reading f64 roundoff of a quantity whose 2ν is
  3.875 — nearly twice the incoherent cutoff. § 6ab.11 used precisely that cell
  as its evidence that high S is not uniformly bad.

**The gate is not conservative, and that is measured rather than argued.** Across
nine cells, wherever the weight is zero the rendered 2ν contrast is below 1e-13,
and wherever it is positive the reading is above 1e-4 — thirteen orders apart
with nothing in between, which is why no threshold appears anywhere in it.

**One cell breaks that floor, and finding it needed the top of the φ slider.**
The separation above was measured at φ = 0.4. At φ = 3 a zero-weight darkfield
cell (ν = 0.8125, 21 samples) reads **6.8e-7** — six orders above roundoff, small
enough to pass for a weak real signal. It is **aliasing**: a phase grating has
orders at every integer m with amplitude J_m(φ), on a 128-bin grid at 13 cycles
they wrap past |m| = 5, a wrapped order sits at a coordinate that is not m·ν and
can re-enter the pupil, and pairs are 2·cycles apart in *bin* space whether or not
they are 2ν apart in the pupil. J₇(3)·J₉(3) ≈ 3e-7 is the size of it. The cause is
named by a control rather than by argument: ν is 2·cycles/pupilSamples, so
**widening the frequency grid changes only where the orders wrap** — same
aperture, same ν, same φ, same source — and at 256 bins the reading collapses to
6.5e-16, **nine orders**. This is why the gate suppresses the number instead of
annotating it: at φ = 3 there is a plausible-looking figure to annotate.

It touches nothing that has real support: aliasing contributes ~1e-7 wherever it
contributes at all, invisible against a genuine 2ν of 0.088, which is identical
to five significant figures at 128, 256 and 512 bins. So it is only ever the
whole reading or none of it, and that is what makes existence the right thing to
gate and precision the wrong one.

The aliasing itself is gone as of § 6ab.13 — the numbers above are what the
pointwise construction read, and `pointwisePhaseGratingObject` still reads them.
The gate stands unchanged: it was never the aliasing it was gating.

### Not yet pinned

- ~~**Whether the sampled carrying fraction converges to the aperture's area
  fraction.** The four ring samplings read 0%, 5.6%, 8.8% and 7.8% against a
  scanned 6.6%: they bracket it and are not monotone in the count.~~ **Closed at
  § 6ab.14, and the scanned 6.6% was the wrong reference** — that scan weights
  every (ring, angle) sample equally, which is not an area. The area is 7.027%,
  the sampled weight converges to it under 0.55/samples, and the
  non-monotonicity is real and survives to 255 samples.
- ~~**Whether aliased orders should be refused rather than measured.**~~
  **Answered at § 6ab.13, and neither — they are not put on the grid at all.**
  Refusing needed a threshold; measuring needed one too. Building the object from
  its spectrum needs neither.
- ~~**The h ≥ 3 harmonics**, which the criterion covers and nothing renders. The
  cutoffs fall as 2/h and the cheap prediction is that a third harmonic needs
  ν < 2/3.~~ **§ 6ab.15 asks for it, and the prediction was the uninteresting
  half** — the cutoff is right, and a third harmonic *inside* it is zero anyway,
  because the phase null is a parity law over h and not a fact about ν.

### 6ab.13 — the folded orders were in the image, and the fix is not a threshold

§ 6ab.12 left the aliasing open as a question about the *readout*: refuse the
1.2e-7 or annotate it, and either needs a number saying how much wrap-around is
too much. There is no such number, and looking for one was the wrong move —
because the folded orders were never confined to that readout. They were in every
image the panel formed, hidden under whatever real signal was there.

**The defect is one sentence: `abbeImage` reads a DFT bin as a diffraction
direction, and the pointwise object's bins are not that.** Jacobi–Anger writes
exp(iφ·cos θ) = Σₘ iᵐJₘ(φ)e^{imθ}, orders at every integer m, the m-th at bin
m·cycles. Evaluating the exponential sample by sample puts all of them on a grid
with room for |m·cycles| < size/2, and the surplus does not vanish — it **folds**.
At 128 bins and 13 cycles, order 5 lands on bin −63. That is −4.85 orders: not a
direction the object diffracts into at all. The imaging sum then admits it
through the pupil as though it were.

The 2ν readout was where it surfaced only because a folded *pair* 2·cycles apart
in bin space beats there whatever the pupil looks like — orders 5 and 7 land on
−63 and −37, exactly 26 apart. Nothing about that mechanism is special to 2ν.

**And the image carried it two orders larger, in a cell nothing was gating.**
This is the claim § 6ab.12 could not make, and measuring it needed a test that a
difference of the two images cannot give: the truncation's own cost at 12 cycles
is a 2.4e-2 amplitude ripple, which swamps anything the fold contributed. The
separation is **periodicity**. Band-limiting removes order bins and can never
create one, so the band-limited object's spectrum lives only on multiples of
`cycles`, and the intensity — an autocorrelation of it — does too. A bin that is
**not** a multiple of `cycles` is therefore a signature of the fold *alone*,
whatever the truncation does.

At 12 cycles, φ = 3, 128 bins, **brightfield** — where the 2ν reading is 0.0878
and stable to eight figures, so nothing is gated, refused or annotated — the
pointwise image holds **3.7e-5** of its mean at image bin 8. Eight is not a
multiple of twelve. It is order 10, folded onto bin −8 (120 mod 128), inside a
pupil of radius 16, beating with the direct beam: 2·J₁₀(3)·|J₀(3)| = 2·1.3e-5·0.26.
Filling the condenser to S = 0.6 makes it **1.4e-4**, 3.8× worse, because more
directions put the folded order inside the pupil — so partial coherence does not
wash the artefact out, it amplifies it. The band-limited object reads 5e-15 at the
same bins with the same pupil, source and φ.

That is the user-visible defect: a frame a reader has no reason to distrust,
carrying structure at a frequency the object has no order at.

**The fix is to build the object from its spectrum.** `phaseGratingObject` now
places the orders that fit and inverse-transforms; `pointwisePhaseGratingObject`
keeps the old construction, exported for the rung that measures the difference.
Then the object's bins *are* its angular spectrum, which is what the imaging sum
already assumed, and no order is anywhere the object did not put it.

**What it costs, and why that is reportable rather than thresholded.** A
truncated series is not exactly unit modulus: a strictly band-limited object
**cannot** be a pure phase object. `SpectrumTruncation` returns `maxOrder`, a
bound on the amplitude ripple (2·Σ|Jₘ| over the dropped tail) and the dropped
energy (2·ΣJₘ², *exact* rather than a bound, because Σₘ Jₘ² = 1). Measured:

| grid | cycles | φ | max order | ripple | bound | light dropped |
|---|---|---|---|---|---|---|
| 128 | 12 | 0.4 | 5 | 1.77e-7 | 1.82e-7 | 1.6e-14 |
| 128 | 12 | 3 | 5 | 2.38e-2 | 2.91e-2 | 2.7e-4 |
| 128 | 13 | 3 | 4 | 7.11e-2 | 1.15e-1 | 4.0e-3 |
| 128 | 31 | 3 | 2 | 6.07e-1 | 9.97e-1 | **23%** |
| 256 | 13 | 3 | 9 | 2.63e-5 | 3.00e-5 | 3.4e-10 |
| 512 | 13 | 3 | 19 | 2.8e-15 | 2.6e-15 | 3e-30 |

The bound is real (ripple ≤ bound throughout) and not vacuous (0.61–0.97 of it),
and at 512 bins it has gone under f64 — the last row measures the transform's
roundoff, not the cut. The last row is also why the rung brackets rather than
bounds: a bound alone would pass if the truncation were not happening.

**23% at the corner is not the fix failing, it is the fix reporting.** 31 cycles
is the panel's own `maxCycles` at 128 bins, φ = 3 the top of the other slider, and
there the grid holds |m| ≤ 2 while J₃(3) = 0.31 goes over the side. The pointwise
construction does not avoid that quarter of the light — it *keeps* it, in
directions the object diffracts nothing into, where it becomes image detail
nothing distinguishes from the real kind. **Missing light is a number a panel can
print; misplaced light is not.** That is the whole argument for preferring a
truncation to a fold, and it is why no threshold appears anywhere in it.

**The § 6ab.12 rungs did not need loosening, and two got stronger.** The aliasing
rung is now an A/B at a *fixed* grid — pointwise reads 1.2e-7, band-limited reads
3.3e-16, ratio 3.5e8 — which is a better control than the grid-widening one that
found it, since that compared three different objects and this compares two
constructions of the same one. And the carrying cell, where § 6ab.12 could only
claim five figures across three grid sizes, is unchanged to **eight**: the orders
the band limit drops are outside the pupil for every direction in the ring, so
where the reading is genuine, removing them changes nothing.

**Pinned against, in order of what would catch a mistake:**

- **An FFT of the continuous object** over 2048 samples of one period, truncated
  to the same orders. It mentions no Bessel function, so it and the synthesis are
  two independent derivations of the same field; they agree to 1e-13.
- **Bessel's integral**, Jₘ(x) = (1/π)∫₀^π cos(mθ − x·sin θ)dθ, by a trapezoid
  rule that is spectrally convergent on this integrand — the second definition
  `math/bessel`'s policy demands, since the new `besselJ(m, x)` is the first
  general-order function in the engine. Agreement is 3e-15 out to |x| = 7.5, and
  the rung then brackets the documented decay — 1e-13..1e-10 at 15, 1e-9..1e-6 at
  25 — which is the measurement `BESSEL_SERIES_LIMIT` rests on and had not had.
- **Neumann's identity** Σₘ Jₘ² = 1, to 3e-15, which is what makes the dropped
  energy exact; and Parseval on the built field, which recovers 1 − dropped to
  5.6e-16.
- **Σₘ iᵐJₘ(φ) = exp(iφ)** at zero cycles, where every order lands on DC and the
  object is exactly representable. A wrong iᵐ phase would show up there as a
  wrong constant instead of a wrong image.

- **Periodicity**, for the image claim — the only pin that isolates the fold from
  the truncation, because the two are otherwise inseparable in a formed image.

`packages/core/test/phase-grating-spectrum.test.ts`, 12 rungs.

### Not yet pinned

- **Whether any other object constructor has the same latent defect.**
  `cosineGratingObject`'s spectrum is exactly three lines and `uniformObject`'s is
  one, so neither can fold — but the rule that would cover future ones ("a
  constructor that evaluates a nonlinear function of position pointwise owes a
  spectrum") is stated here and enforced nowhere.
- **What the truncation does to the ν null itself.** The null is measured at
  2.7e-15 and the band-limited object is no longer exactly |t| = 1, so at the 23%
  corner the precondition has moved. No rung asks whether the null degrades with
  `droppedEnergy` or is indifferent to it, and the two would look identical
  everywhere the panel is usually set.

### 6ab.14 — how much of the condenser carries it, and the reference that was not an area

`packages/core/src/math/quadrature.ts` (`adaptiveIntegral`),
`packages/core/src/illumination/transfer.ts`
(`harmonicCarryingChord`, `harmonicCarryingArea`),
`packages/core/test/harmonic-carrying-area.test.ts`, 19 rungs, 2.3 s.

§ 6ab.12's first open item, closed. It asked whether the *sampled* carrying
weight converges to the aperture's own carrying fraction, and could not be
answered because the thing it would converge to did not exist in the repo — the
number § 6ab.12 compared against was borrowed from a scan, and the scan was
measuring something else.

**The criterion decomposes by row, and the row is exact.** The grating runs along
x, so its orders differ only in s_x and each row of constant s_y is an
independent one-dimensional problem: a direction carries h·ν iff some integer m
puts s_x + m·ν and s_x + (m+h)·ν both inside the pupil, which is the interval
s_x ∈ [−R − m·ν, R − (m+h)·ν] with R = √(1 − s_y²). One interval per m, all of
length 2R − h·ν, all spaced ν apart. Three facts fall out of that picture and all
three are used:

- **2R ≤ h·ν empties the row** — so nothing above |s_y| = √(1 − (h·ν/2)²) carries,
  and a darkfield ring's rows past |s_y| = 1 carry nothing at any ν while still
  counting in the denominator.
- **2R ≥ (h+1)·ν closes the gaps** and the row carries wherever the aperture
  reaches, whatever the chord looks like.
- **Between them the row is striped**, carrying 2R − h·ν out of every ν. Which
  stripes the chord lands on is the whole story of the sampled lattice's scatter.

`harmonicCarryingChord` is that row measure — finite unions of intervals, exact
arithmetic, no quadrature — and `harmonicCarryingArea` integrates it.

### The number the open item was measured against was a different quantity

§ 6ab.12 quoted "the aperture's own 6.6%" from a brute-force scan stepping
uniformly in ring index and angle with **equal weight per sample**. That is
∫∫ dr dφ, not ∫∫ r dr dφ: a fraction of directions sampled that way, not a
fraction of area. `annularSource` and `diskSource` weight equal-area cells
equally, so the lattice weight is a midpoint estimate of the **area** fraction,
and the two limits are genuinely different — refining the scan 4× moves it from
6.579% to 6.562% and no closer to the area's **7.0268%**, while putting the r
back moves the same samples onto 7.030%. The r-weighted scan is the cross-check
on the quadrature by a route that shares no code with it: no rows, no intervals,
no Gauss nodes, one point at a time.

Restated against the right reference, § 6ab.12's three lattice readings are
−21%, +26% and +11% rather than −16%, +34% and +19%, **and the finest is now the
closest**, which the old comparison did not show.

### It converges, under 0.55/samples, and not monotonically

> **Corrected at § 6ab.17: "across 7…255" was eleven counts, and the bound fails
> between two of them.** The ring at n = 17 reads 0.7373/n. Everything below is
> true of the eleven counts it was measured at; the statement over a ladder that
> asks every integer to n = 121 is 0.74/n, and the envelope is n^{-4/3}.

Across 7…255 samples on the ring and on an S = 0.9 disc, |sampled − exact| stays
below 0.55/samples. That is a bound and not a rate: the observed decay is faster
than 1/n over the range, but **31 samples reads 7.246% and 45 reads 6.410%** —
half again as many points for 2.8× the error — so a rate would be a claim the
data does not support. The bound's own extreme is § 6ab.12's headline cell: the
7-sample ring has no point in the carrying set at all, so its error is the whole
7.027%, which is 0.49 of the 0.55. **The gate exists to catch the case that sets
the bound**, and "more samples" is not "more accurate" here — what moves the
reading is which stripes the lattice lands on.

### A new cutoff: √((1 − S²)/2), where the condenser stops carrying with all of itself

Full coverage fails first at a row that is neither the axis nor the rim. A row
carries its whole chord two ways — the gaps close (2R ≥ (h+1)·ν), hardest at the
outermost row where R is least; or, **for even h only**, the one interval centred
on the axis already covers the chord, hardest at the axis. The two bind in
opposite directions, so the answer is where they cross, and for h = 2 that is

> **ν\* = √((1 − S²)/2)** for S ≥ 1/3, and 1 − S below it, the two agreeing
> exactly at S = 1/3.

Checked at ±1e-9 on the row the closed form names. For odd h no interval sits on
the axis, the second branch does not exist, and ν\* = 2√(1 − S²)/(h+1) — verified
at h = 1 and 3. At S = 0.6 every direction carries 2ν out to ν = 0.5657 while the
harmonic itself survives to ν = 1: **between them the condenser is imaging the
harmonic with a shrinking part of itself**, and that is where the panel's slider
spends most of its travel.

### Two ways a quadrature lies, both found by the aperture that hides a stripe

- **Splitting at the rows a reader can name is not enough.** |s_y| = inner,
  |s_y| = 1 and the two radii above are the obvious breakpoints; the rest are the
  rows where an order-interval endpoint crosses a chord endpoint. On a
  0.999–1.001 ring, a panel straddling one of those has a stripe narrower than the
  node spacing: all fifteen Kronrod nodes miss it, **the error estimate is
  therefore zero**, and the answer comes back 0.11700 against a true 0.11656 with
  every sign of having converged. Adaptivity cannot rescue that — it refines where
  it sees disagreement and there is none to see. The crossings are not searched
  for: in y = s_y² each solves ±√(1 − y) + c = ±√(a − y), so y = (4a − K²)/(4c²)
  with K = 1 + a − c².
- **A cusp is unaffordable, so it is substituted away rather than refined.** Both
  edges of an annulus are square-root cusps in s_y. The panel error there falls
  like w^1.5 while the budget each child inherits falls like w, so bisection loses:
  the annulus 0.3–0.5 at ν = 0.4 — an aperture that carries *everywhere* — ran out
  of 40 bisections rather than returning 1. Integrating each piece in its own
  angle, s_y = scale·sin φ, removes the cusp at that piece's own edge; nothing in
  a 1 345-case sweep then bisects more than twice. The same lesson is a rung on
  the integrator itself: ∫₀¹√(1−x²) needs 53 levels at a tolerance of 1e-13 and
  is exact to 2e-16 whenever it finishes, while the substituted form takes it in
  **one panel** at 1e-15.

**Zero stays exact.** Where no row carries, every integrand evaluation is exactly
0 and so is the sum, so the area agrees with `apertureCarriesHarmonic` as a
predicate rather than approximately — measured over 1 600 aperture/ν cells with no
disagreement. There is still no threshold anywhere in the gate. **What that does
not say is that positive readings stand clear of zero**, and the first draft of
this step claimed it did: the smallest positive fraction in the sweep is 2.9e-4,
which is a fact about steps of 0.01 in ν and not about the quantity — the same
ring reads 6.4e-6 at ν = 0.7999 and 2.0e-7 at 0.79999, because the area *thins*
to its cutoff, as the rung two sections up says in so many words. The exactness
that matters is the zero, and the zero is exact. That property is what forced the
ring to be integrated as one integrand: computing it as a difference of two discs
is a true identity and converges just as well, but it leaves 9e-17 where the
answer is none.

### Not yet pinned

- ~~**Whether the bound is a rate.** 0.55/samples holds over 7…255 and the decay
  looks faster, but the scatter is set by lattice commensurability with a striped
  set and nothing here models that. A rate would need either an averaging argument
  or a lattice-counting one.~~ **Answered at § 6ab.17, and it starts by finding
  that 0.55/samples does not hold over 7…255** — it holds at the eleven counts
  that sentence was measured at, and n = 17 reads 0.7373/n. No rate is claimed;
  the envelope is n^{-4/3}, and the reason not to push further is named there.
- ~~**What the panel should do with the number.**~~ **Done in the same change**:
  `HarmonicSupport.apertureFraction` carries the exact area, the phase panel
  prints it beside the lattice's own weight, and the 7-sample refusal now names
  how thin the set it missed is. (**That refusal moved at § 6ab.19** — darkfield
  has no 7-sample setting, and the refusal that remains names the settings that
  hold the set rather than a direction to move in.) The label says the ratio is of the *set* and not
  of the contrast, because those are different quantities — 1.59× against 1.35×
  on the same three lattices, and § 6ab.11 measured the contrast one separately.
- ~~**The h ≥ 3 harmonics** — still § 6ab.12's item. The area function answers for
  any h and two rungs use h = 3, but nothing renders one.~~ **Answered at
  § 6ab.15, and the prediction in it was the uninteresting half:** a third
  harmonic inside its own cutoff is still zero, because § 6f's phase null is a
  parity law and applies to every odd h.

### 6ab.15 — the third harmonic is zero, and the null was never about the first

The open item above predicted that a third harmonic needs ν < 2/3, the cutoffs
falling as 2/h. That is right, and it is not what happens. **Put a third
harmonic comfortably inside its own cutoff and it is still zero** — measured at
f64 roundoff over coherent, extended and darkfield sources — and so is the
fifth. The reason is not where the orders land:

> A phase grating has orders at every integer m with amplitude Jₘ(φ). Squaring
> Σₘ iᵐJₘ(φ)·P(s+mν)e^{imu} puts the image's h-th harmonic at
> **c_h = i^h · Σₙ Jₙ₊ₕ(φ)·Jₙ(φ)·P(s+(n+h)ν)·P̄(s+nν)**, summed over the source.
> Pair the term at (s, n) with the term at (−s, −n−h): J₋ₖ = (−1)^k Jₖ applies
> twice and contributes (−1)^h, and the two pupil factors match because the
> pupil is **even** and the source **centro-symmetric**. For odd h the sum is
> its own negative.

So § 6f's headline — a brightfield microscope cannot see an unstained cell — is
the **h = 1 case of a parity law**, and the story it was carried by is weaker
than the fact. "Two sidebands enter with opposite signs and cancel" is about a
three-line spectrum and a weak object; the parity argument needs neither, which
is why the null survives to φ = 3 where the object is nothing like weak. That
comment in `illumination/transfer` now states the general reason rather than the
special case it happened to be found in.

**The preconditions are the two `weakPhaseTransfer` already names, and a third
one that turns out not to be needed.** Evenness of the pupil and centro-symmetry
of the source do all the work. A symmetric band limit does *not* break it: § 6ab.13
truncates the order series at |m| ≤ M, and the partner of a surviving term is
always itself surviving, so the cancellation stays exact — measured at h = 1 and
h = 3 in the corner § 6ab.12's 6.8e-7 aliasing artifact lived in, φ = 3 with
**3.9% of the light dropped** and only |m| ≤ 3 on the grid, reading 2.0e-15 to
3.1e-15 while h = 2 in the same images reads 0.25 to 0.77.

**Defocus breaks them together, and one apparent exception is the interesting
cell.** A defocused pupil is still even but no longer real, so the paired factor
becomes a conjugate instead of an equal: at ν = 0.375 under an S = 0.6 disc,
h = 3 goes from 2.7e-16 to 3.9e-3 and h = 5 from 8.6e-16 to 2.6e-3. Under a
*coherent* source at the same ν, h = 3 goes to 0.246 and **h = 5 does not move**
— 1.4e-15 in and out of focus. That is not parity surviving; it is § 6ab.12's
support criterion, since only |m| ≤ 2 pass and no order pair 5 apart exists to
beat. Two nulls that look identical on screen, told apart by one slider.

#### The even harmonics are a family of closed forms

Where the symmetric pair (−h/2, +h/2) is the **only** pair h apart that gets
through, one term survives in c_h, its two members carry J₋ₘ and J₊ₘ, and

> **contrast(h·ν) · mean = 2·J_{h/2}(φ)²**

with no free parameter and ~~no pupil in it~~. Measured at h = 2, 4, 6 and 8
across φ ∈ {0.4, 1.5, 3}, worst residual **2.3e-14**. § 6f's 2·J₁(φ)² and A3's
`threeOrderCheck` are the h = 2 member of this, recovered rather than restated:
the predicate is told nothing about three orders and says ν = 0.75 qualifies
because ±1 passes and ±2 does not.

**"No pupil in it" is an `idealPupil` statement, corrected at § 6ab.16.** The
general form carries the pupil's own transmission at the pair's two coordinates,
2·J_{h/2}(φ)²·A(+mν)·A(−mν), which is 1 for every pupil this section renders
through and 0.74 for a real objective — an 18% to 26% error, not a rounding.

It is also **exactly defocus-invariant** — the same closed form to 1e-13 at
w₂₀ = 0, 1 and 3 — and the reason given here is geometric: the pair sits
symmetric about the axis, so both members are at the same pupil radius and any
*even* aberration gives them the same phase, which the beat cancels. Over that
same slider the h = 1 reading swings from a hard null to 1.14. One control, two
harmonics, and only one of them moves. **That reason is true and narrower than
the fact (§ 6ab.16):** one surviving term is a product of two moduli, so no
wavefront of any parity enters it, which a pupil aberrated *oddly* across the
pair then confirms.

#### Why the regime is a predicate and not a bound on S

The tempting form is a formula: the next order enters at source radius
(h/2 + 1)·ν − 1, so require S below it. **That formula is wrong**, and one cell
shows it. An 11-point disc at S = 0.13 has its outermost sample at |s| = 0.1273,
past the bound's 0.125, and the closed form holds to **7.7e-14** — because the
sample past the bound is a *corner*, and what displaces an order is s_x alone
while s_y spends the pupil's budget without moving anything.

So `onlySymmetricPairPasses` asks the pupil at exactly the coordinates
`abbeImage` evaluates, as `harmonicSupportWeight` does and for the same reason,
and the answer is then lattice-dependent — which is the honest outcome rather
than a defect. The regime ends at S = 0.14 for an 11-point disc and at 0.13 for
a 41-point one. Across 24 cells of measured error either side of both crossings,
the predicate and the closed form's survival agree **everywhere**, which no
formula in S can do. Outside it the closed form is not approximately right: 74%
error one ν step below the regime, 96% two steps below, and 100% above it, where
no pair h apart passes at all and the harmonic is a hard 4.6e-16.

**The rim is not a hazard here, and the contrast with § 6ab.11 is the point.**
ν = 1/M puts order M exactly on |p| = 1, the same boundary that gave § 6ab.11 an
8e-4 reading off a set of zero area. There the two legs were different
quantities — an aperture's AREA against a lattice's WEIGHT — so a rim decision
could fall one way for one and the other way for the other. This predicate and
the image it predicts consult the **same** `PupilFunction`, so they cannot
disagree about a convention: `idealPupil` admits the rim and both say the family
holds (1.7e-13); a pupil whose rim is strict moves both at once, to `false` and
to roundoff. A rim convention is a property of the pupil, and the family follows
it wherever it goes. That is measured rather than argued — over 27 cells sweeping
ν at h = 2 and h = 4, including both rims, the predicate is true exactly where
the residual is roundoff and false exactly where it is 74% or worse.

#### Two numbers that outlived the defect they described

A3's `threeOrderCheck` is the h = 2 member of this family, and replacing its
hand-written range with the predicate found both of its extra conditions to be
wrong rather than merely conservative.

- **ν = 1 was excluded** on a rim artifact worth "2.6e-8 rising to 1.5e-2 at
  φ = 3". Those are the **pointwise** object's numbers, reproduced through
  `pointwisePhaseGratingObject` at 2.577e-8 and 1.448e-2, and § 6ab.13 removed
  their cause by building the object from its spectrum. The same cell now agrees
  to 5.5e-14. A number kept after the defect it described was fixed describes
  nothing, and the only way to find out is to re-measure it.
- **S = 0 was required** on "25% at S = 0.2, 70% at S = 0.4". Those reproduce —
  at **ν = 0.875**, which the claim did not name. There is no ceiling in S alone:
  the pair stays inside the pupil while |s| ≤ 1 − ν, so the ceiling is 0.125 at
  ν = 0.875 and 0.25 at ν = 0.75, where the panel was refusing S = 0.2 while the
  closed form was exact there to 1.7e-14. It is the same shape as § 6ab.11's own
  lesson — "the bad region is not a band in S" — found this time in the condition
  rather than in the readout.

#### The predicate is not sufficient for the closed form, and the extra condition was hiding

The family needs two independent things: the orders alone, **and** the pair's two
members sharing a pupil phase. `onlySymmetricPairPasses` answers only the first,
because only the first is geometry. The second is what makes the reading
defocus-invariant, and it is an **on-axis** statement: the members sit at
|s ± mν|, so the beat carries w₂₀(|s+mν|² − |s−mν|²) = 4·w₂₀·m·(s·ν), which is
zero only for a direction on the grating's own axis.

**Nothing separated those two until this step, because A3's regime was S = 0 and
one on-axis point satisfies both at once.** Replacing that with the order
geometry opened the regime to extended sources — which is right in focus, where
the pupil is real and there is no phase to share, and measured exact to 1.7e-14
at S = 0.2. Out of focus it is not: the same cell is **39% out at S = 0.1 with
one wave and 98% at S = 0.2**, and the panel would have printed nine decimals of
it. So the app carries `pairPhaseSurvives` beside the predicate, asking the
source's own points for s_x = 0 rather than asking S, and refuses that frame.
A generalization that removes a condition is worth checking for a *second*
condition the removed one was silently supplying.

#### What the panel does with it, and why the rows are free

A3 read the ν and 2ν bins. It now reads **every harmonic the grid can hold** —
`h·cycles < size/2`, which is ten of them at 6 cycles on a 128 grid and five at
the default 12 — as a column under each canvas, with the § 6ab.12 gate asked per
h. The point of the column is that a law is visible in it where two numbers were
not: roundoff, 0.149, roundoff, 0.109, roundoff, straight down.

**The rows cost nothing, and the instinct they defeat is worth naming.** A probe
is a *render* — one transform per source point, hundreds of them — where a
harmonic is one pass of `imageHarmonic` over an image already in hand. Five
harmonics are one probe and four extra passes, not five probes, so `checkFrames`
is the same 3 per defocus § 6ab.11 pinned and the S = 0 default still pays none.

Two things had to be refused to keep it that way, and both are the same refusal
§ 6ab.12 already makes:

- **No spread over an odd harmonic.** The parity law says it is identically
  zero, so four samplings would agree about nothing — the same failure as the
  1.031× at ν = 1.9375. Without it the *fundamental*, which always has support,
  orders three renders in every cell that previously ordered none: measured as a
  test file going from 24 s to 198 s before the refusal went in.
- **No closed form at odd h.** There is no symmetric pair, and `besselJ` has no
  half-integer order to evaluate — it throws rather than guess, which is how the
  omission was found rather than shipped.

**One defect in it was invisible to the suite, and the panel showed it in the
first screenshot.** The table's first draft printed *"null by parity"* beside the
defocused canvas's h = 1 reading of **0.583** — the null broken, which is the
entire content of the picture directly above the label. Every rung passed,
because the readings were right and only the sentence was wrong, and a sentence
living inside a `<td>` is not something the headless suite can reach. The colour
was wrong the same way: the row was painted in the null colour while showing
0.583.

The fix is not the corrected string but `harmonicNote`, which makes the row's
explanation a **value** — `parity-null`, `parity-lifted`, `unsupported`,
`closed-form`, `measured` — that the component only renders. Two rungs then
assert what no test could assert before: that a `parity-null` note never sits
beside a number above the null ceiling, swept over defocus × cycles × S. It is
also decided from the *reading* rather than from the defocus slider, since
deciding it from w₂₀ would be the same mistake pointed the other way. Same
lesson as § 6ab.14's: **a new panel line has to be checked against the lines
already on the screen**, and the cheapest way to check is to open the panel.

**The refusal messages name a slider position, not a cutoff.** The h = 2 forms
this file pins — ν = 1 in brightfield, (1 + outer)/3 for the annulus — do not
generalize, and both fail at an h the panel can reach: measured against
`apertureCarriesHarmonic`, the disc's cutoff is 2/h at h = 2, 4, 5 and 6 but
**1 + S** at h = 1 (Abbe's law, which is what h = 1 *is*) and 0.6 rather than
2/3 at h = 3 with S = 0.2; the ring's is (1 + outer)/(h + 1) up to h = 5 and 1/3
rather than 0.343 at h = 6. So a formula in the string would be an unpinned
claim the reader is invited to act on. `highestCarryingCycles` asks the
closed-form predicate at each ν the cycles slider can reach instead — exhaustive
over the control rather than an approximation of a continuum, the same move
`SamplingSpread` makes for the source count, and better advice besides: a slider
position to go to rather than a ν to solve for.

### Both open items closed at § 6ab.16

- ~~**Whether the odd-h null survives a traced pupil's residual.** … A real
  objective is not exactly even, so the parity cancellation should degrade to
  that asymmetry rather than to zero.~~ **It degrades to something else
  entirely**, and the two words naming the mechanism were the wrong two: the
  precondition a real lens fails is **realness**, not evenness.
- ~~**The h ≥ 3 spread.**~~ **Measured, and it is worse than the row the panel
  warns about** — 9.7× at h = 4 where 2ν spreads 1.15×, in the same three renders.

### 6ab.16 — the traced pupil, and the precondition that was named wrong

`packages/core/test/traced-parity.test.ts`, and the spread half in
`packages/app/test/phase.test.ts`.

| Rung | Pinned to | Status |
|---|---|---|
| **A traced objective lifts h = 1 from 1.5e-16 to 0.23, 0.52 and 1.25** — ordered by its own RMS wavefront | § 6f.10's two pupils, and one off axis | ✅ |
| …and h = 3 comes up with it, as one law rather than two readings | § 6ab.15's parity law | ✅ |
| **It is the PHASE**: phase-only reproduces the lift to 5 figures; amplitude-only reads 3.1e-7 | the decomposition, measured | ✅ |
| **Symmetrizing the pupil changes nothing** — A and W each averaged against −p gives the same 0.51637 | evenness, refuted as the cause | ✅ |
| h = 5 stays at roundoff through all three — § 6ab.12's support null, told apart by a LENS this time | the order geometry | ✅ |
| **contrast(hν)·mean = 2·J_{h/2}(φ)²·A(+mν)·A(−mν)** at h = 2, 4, 6, 8 × 3 φ × 3 traced pupils | Bessel closed form × the pupil's own A, 1e-13 | ✅ |
| The bare A = 1 form is **18.4% and 26.3% out, the same fraction at four h** — a transmission, not an aberration | 1e-13 against A(+mν)·A(−mν) | ✅ |
| **No phase enters at all** — a comatic pupil with 0.17 waves ODD across the pair still holds it | one term is a product of moduli | ✅ |
| Off axis it departs in proportion to the wavefront: 1.2e-4, 8.5e-4, 0.22 at S = 0.1 | `pairPhaseSurvives`, for a real lens | ✅ |
| **Sampling spreads h = 4 by 9.67× where 2ν spreads 1.15×**, one image | the panel's own four samplings | ✅ |
| …reaching 20× at h = 4 and 46.9× at h = 6, where 2ν never leaves 1.75× over the panel's S range | 12 cells | ✅ |
| NEGATIVE CONTROL: the one cell where the higher harmonic is the tighter one, recorded | S = 0.3, ν = 0.375 | ✅ |
| The unsupported h = 6 row would print **1.146×** — tighter than h = 2's 1.147× — while reading 5e-16 | § 6ab.12's gate, load-bearing again | ✅ |

#### Evenness was never the precondition, and a real lens is how you find out

§ 6ab.15 derived the null by pairing the term at (s, n) with the term at
(−s, −n−h) and observing that an even pupil over a centro-symmetric source makes
the second's pupil factor the **conjugate** of the first's. A conjugate cancels
against its partner only when it is also an *equal*, which asks the pupil to be
**real** — and § 6ab.15 knew that, since it is exactly how it explained defocus
("still even, no longer real"). What it then wrote in its open item was that a
real objective "is not exactly even, so the cancellation should degrade to that
asymmetry". A traced objective is not exactly even, and that is not why its null
is gone.

The decomposition is three renders and settles it:

- the pupil as traced reads **0.51637** at h = 1 where `idealPupil` reads 1.5e-16;
- its **phase on a perfect disc** reads 0.51637 — the same number to five figures;
- its **amplitude with the phase zeroed** reads **3.1e-7**.

That last one is the asymmetry, and it is real: a Zernike fit of √throughput is
not exactly even, so a real pupil that is not quite even lifts the null a little,
which is the mechanism the open item described. It is **1.6 million times** too
small to be the answer. And symmetrizing — averaging the amplitude against A(−p)
and the phase against W(−p), which builds an even pupil, and is *not* the complex
average (P(p) + P(−p))/2, an operation that does not preserve the modulus and can
cancel to zero — leaves the reading at 0.51637, so the lift does not even partly
live there. Even the comatic pupil 0.3 mm off axis, whose odd part is
0.17 waves, keeps 1.27 of its 1.25 when symmetrized.

**A prediction can be right about the size of an effect and wrong about which
effect it is.** Nothing in § 6ab.15 was false; the sentence that carried its open
item picked one of its two preconditions and it was the one that survives.

#### The closed form gains a factor, and the factor is the same at four harmonics

The family generalizes without an error term. One surviving term in `c_h` is
J₋ₘJ₊ₘ·P(+mν)·P̄(−mν), whose modulus is a product of two amplitudes, so

> **contrast(h·ν) · mean = 2·J_{h/2}(φ)² · A(+mν) · A(−mν)**

with A the pupil's own amplitude — measured to **1e-13** at h = 2, 4, 6 and 8,
over φ ∈ {0.4, 1.5, 3}, through all three traced pupils. § 6ab.15's
2·J_{h/2}(φ)² is its A = 1 case.

This is not a refinement to file away. Against the 4×/0.10 the A = 1 form is
**18.4%** out and against the Lister **26.3%**, and a nine-decimal readout that
printed either would be wrong in the second digit. What says it is a transmission
rather than an aberration is that it is **one number at four harmonics**: the
four cells put the surviving pair at three distinct pupil radii — 0.75, 0.9375
and 0.875 — so
a wavefront effect would miss by four different amounts, and these agree with each
other to better than 1e-3 and with A(+mν)·A(−mν) to the same 1e-13 the family
holds to.

#### And the invariance is stronger than the argument given for it

§ 6ab.15 called the closed form defocus-invariant and explained it by the pair
sharing a radius: an *even* aberration gives both members the same phase, which
the beat cancels. True, and narrower than the fact. **One term's modulus has no
phase in it to cancel**, so any wavefront whatever leaves it alone. The off-axis
traced pupil is the case that separates the two claims — W(+0.75, 0) − W(−0.75, 0)
is 0.17 waves, so its aberration is *not* even across the pair — and the closed
form holds there to 1e-13 like everywhere else.

What does break it is more than one direction, which is unchanged: the surviving
terms at |s ± mν| carry different phases and stop adding as moduli. § 6ab.15
measured that against a defocus slider; here it is measured against three real
lenses and it tracks them, **1.2e-4, 8.5e-4 and 0.22 at S = 0.1 for 0.018, 0.040
and 0.217 waves RMS**, with the ideal pupil exact over the same source. So the
app's `pairPhaseSurvives` is the right gate for a traced pupil too, and for the
same reason.

#### The higher harmonics are the ones the sampling moves

§ 6ab.11 taught a reader to watch the 2ν spread. § 6ab.15 then put nine more rows
under it, and **the row § 6ab.11 was written about is the steadiest one on the
screen.** At S = 0.7 and ν = 0.375, in one set of three probe renders, h = 2
spreads 1.15× and h = 4 spreads **9.67×**; at S = 0.9 the pair is 1.64× against
20.3×; and at S = 0.7, ν = 0.3125 the worst row in the column is h = 6 at
**46.9×**. Over the twelve cells swept, h = 2 never leaves 1.75× and the higher
rows reach 27 times further.

**It is worse as a fraction of the reading too, so it is not the ratio's own
sensitivity to a small denominator.** At S = 0.7 and ν = 0.375 the four readings
span 0.19 of their mean at h = 2 and 1.09 at h = 4, and the ordering holds in four
more cells. (§ 6ab.11's signal-to-noise explanation of the φ lever is itself wrong
— § 6ab.18 — and nothing here rests on it.) That makes it a *tendency*, and the
cell where it inverts is pinned rather than rounded away: at S = 0.3, ν = 0.375
the two spreads are 1.148× and 1.145× and the readings are only 2.1× apart.

**§ 6ab.12's gate turns out to be protecting the new rows harder than the old
one.** The cutoffs fall as 2/h, so most of a ten-row column has no support at any
ν the slider is likely to sit at. At S = 0.7 and ν = 0.375 the h = 6 row reads
4.8e-16, and rendering its four samplings by hand — which is what the panel would
print without the gate — puts them inside **1.146×, tighter than the h = 2 row's
own 1.147× in the same images**. That is § 6ab.11's ν = 1.9375 trap exactly, the
tightest number in the column being the one reading nothing, now reached by moving
h instead of ν.

### 6ab.17 — the bound was eleven counts, and the envelope is n^{-4/3}

`packages/core/test/harmonic-carrying-area.test.ts`, alongside the rungs it
corrects.

| Rung | Pinned to | Status |
|---|---|---|
| **0.55/samples is FALSE at n = 17** — the ring reads 0.7373/n, 34% past it | every integer 7…121, not eleven of them | ✅ |
| …and every one of § 6ab.14's own eleven counts still passes, so only the range claimed was wrong | the same eleven | ✅ |
| The bound is **0.74/samples**, in three cells at two ν, every maximum inside the exhaustive window | measured sup, rounded up in the 4th digit — 0.36% | ✅ |
| It is **loose past n ≈ 30** — under 0.14/n for every n ≥ 401, five times the slack | the same ladder | ✅ |
| **sup e·n^{4/3} < 1.9, and smaller at the TOP of the range than the bottom** — tail÷head 0.81, 0.74, 0.63 | 3 cells | ✅ |
| NEGATIVE CONTROL: **e·n^{3/2} is NOT smaller at the top** — tail÷head 1.25 and 1.03, so 3/2 over-corrects | 2 of 3 cells | ✅ |
| The third cell is a genuinely PARTIAL disc at a different ν, not one below ν\* that carries everywhere | S = 0.5, ν = 0.875 | ✅ |
| The zeros are still exact, so no error above is a difference of two approximations | `toBe(0)`, 4 counts | ✅ |

#### The first thing the wider measurement found was the bound

§ 6ab.14 wrote "across 7…255 samples … stays below 0.55/samples" and checked
**eleven** counts. Asked at every integer over the same range, the ring at
**n = 17** reads 0.7373/n — one point coarser than the 21 the panel's own control
offers, and 34% past the constant. The eleven counts' own worst is 0.4919 at
n = 7, so the number was not conservative; it was measured on a set that missed
its own maximum, and the sentence then quantified over a range the set did not
cover.

Nothing about the eleven readings was wrong, which is what makes this the same
shape as § 6ab.15's ν = 1 exclusion and § 6ab.14's own "6.6% aperture": **a
number is only as wide as what it was measured on, and the sentence around it is
where the width gets exaggerated.** The corrected statement is 0.74/samples over
a ladder that asks **every integer from 7 to 121** — where all three cells attain
their maximum, at n = 17, 7 and 17 — then odd counts to 255 and every twentieth
to 801. The 0.74 is the ring's own maximum rounded up in the fourth digit, a
**0.36% margin**: it is a measured supremum and not a conservative constant, and
saying which counts were asked is the part § 6ab.14's sentence did not have.

#### Whether it is a rate, answered by comparing the two ends of the range

The test that separates exponents needs no theorem. If the error decayed like
n^{-p}, then e·n^q is **larger at the bottom of a range than at the top when
q < p**, and larger at the top when q > p. Comparing sup e·n^q over n ≤ 121
against sup over n ≥ 200, in three cells:

| q | sup e·n^q (ring / S = 0.9 / S = 0.5) | tail ÷ head |
|---|---|---|
| 1 | 0.737 / 0.535 / 0.465 | 0.338 / 0.287 / 0.314 |
| 4/3 | 1.896 / 1.285 / 1.473 | 0.807 / 0.736 / 0.630 |
| 3/2 | 3.788 / 2.347 / 3.214 | **1.246 / 1.033** / 0.727 |

So **n^{-4/3} is an envelope and n^{-3/2} is not**: at q = 4/3 the tail is below
the head in all three cells, and at q = 3/2 it is at or above it in two. An
exponent whose e·n^q grows across the range is above the true decay.

The honest claim is therefore a **bracket, not an exponent**: the decay is between
n^{-4/3} and n^{-3/2}, and it is not the same in every aperture — the S = 0.5 disc
still falls at q = 3/2 where the two ν = 0.75 cells rise. That cell-dependence is
itself the answer to "is it a rate": there is no single exponent for the
measurement to converge on.

**And this file stops there on purpose.** The quantity is a lattice count inside a
region bounded by circular arcs, and the exponent for those is the Gauss-circle
family, where the proven bounds and the conjectured one differ and the truth is a
famous open question. Measuring further would land between the same two numbers
with more digits. That sentence is recorded as the reason to stop, **not as a
pin** — no rung above is anchored on it, and the 4/3 is a measured envelope over
a stated range rather than a cited exponent.

### 6ab.18 — the predictor that is not, and the reason § 6ab.11 gave that is not either

`packages/app/test/phase.test.ts`, alongside the § 6ab.11 rungs it corrects.

| Rung | Pinned to | Status |
|---|---|---|
| **The disagreement grows as φ², like the signal** — ×3.95 and ×3.79 over φ = 0.1, 0.2, 0.4 | § 6ab.11's own cell | ✅ |
| …so the disagreement AS A FRACTION of the reading is flat: 3.075, 3.038, 2.890 | 7% across a 16× in signal | ✅ |
| **The 838× is one lattice reading a different POWER of φ** — n = 7 is O(φ⁴) where 11, 15, 21 are O(φ²) | contrast/φ² flat to 1.2× for three, ×4 per doubling for the fourth | ✅ |
| The φ lever is therefore **9.7×, not 838×**, and it is still a lever | 3.075 against 0.317 | ✅ |
| …and the conclusion gains a leg with no φ in it: **22× across ν at one S** | S = 0.3, five ν | ✅ |
| § 6ab.16's h ordering survives on the φ-free quantity — 5 cells, and the same one inverts | 0.19 vs 1.09 at S = 0.7, ν = 0.375 | ✅ |
| **REFUTED: rim weight predicts nothing.** Exactly 0 in all four lattices where the readings span 0.73 of their mean | S = 0.3, ν = 0.1875 | ✅ |
| **REFUTED: so does the carrying-set spread.** Unanimous 1.0 to f64 in the same cell | `toBeCloseTo(1, 12)` × 4 | ✅ |

#### The reason was wrong and the number it explained was real

§ 6ab.11 built its refutation of a band in S partly on φ: 838× at φ = 0.1 and
1.37× at φ = 3, one S holding both. The reading is right and the sentence
attached to it — "the 2ν signal grows as φ² and what disagrees with it does not"
— is not. At that cell, over φ = 0.1, 0.2, 0.4:

| | φ = 0.1 | φ = 0.2 | φ = 0.4 |
|---|---|---|---|
| max − min | 3.319e-4 | 1.310e-3 | 4.969e-3 |
| mean | 1.079e-4 | 4.313e-4 | 1.720e-3 |
| (max − min)/mean | 3.075 | 3.038 | 2.890 |
| printed ratio | 838× | 208× | 50× |

Both the disagreement and the signal are second order, and their **quotient is
flat to 7% across a 16× in signal** while the printed ratio moves by 17. So the
φ dependence is not in the disagreement at all.

**It is in the minimum.** At this cell the 7-point lattice's second-order 2ν term
nearly cancels and its reading is O(φ⁴), where the other three are O(φ²):
contrast/φ² is flat at 3.3e-2, 6.5e-3 and 3.4e-3 for n = 11, 15 and 21 and runs
4.0e-5 → 1.6e-4 → 6.3e-4 for n = 7. A max over φ² divided by a min over φ⁴ is
O(φ^{-2}), which is exactly 838 → 208 → 50.

Measured as a fraction of the reading the lever is **9.7×** (3.075 at φ = 0.1
against 0.317 at φ = 3) rather than 612×. That is still a lever and § 6ab.11's
conclusion survives — and it now has a second leg with no φ in it: at S = 0.3 the
relative disagreement runs 0.034 at ν = 0.3125 to 0.73 at ν = 0.1875, **22× inside
one S**, which refutes a band in S without φ being mentioned.

It also forced § 6ab.16's h claim to be re-measured, since that was stated in
ratios too. It survives: at S = 0.7, ν = 0.375 the four readings span 0.19 of
their mean at h = 2 and **1.09** at h = 4, with the ordering holding in five cells
and inverting in the same S = 0.3, ν = 0.375 cell the ratio found.

#### Both render-free predictors fail, and for one structural reason

§ 6ab.10 attributed the spread to source points near the tangency circle
|s ± mν| = 1, where the shifted pupil grazes the objective's and the lattice's
in-or-out decision moves an order. That attribution is plausible and the criterion
built from it is not a predictor:

- **Rim weight** — source weight within one lattice spacing of that circle — is
  **exactly 0 for all four lattices** at S = 0.3, ν = 0.1875, where the readings
  disagree by 0.73 of their mean. Over 50 cells it is zero in 13 of them with
  relative disagreements up to 0.73, and where it is positive the ratio between
  the two quantities spans 143×.
- **The carrying-set spread** — the disagreement of `harmonicSupportWeight` across
  the same four lattices, which is free and already in the repo — is worse: in the
  same cell all four lattices report the whole aperture carries 2ν, to f64, so the
  statistic is unanimous where the readings differ by more than half their mean.

The reason is one sentence. A predictor built on the carrying set answers **which
directions can contribute**; the disagreement is an **integral over that set with
an integrand that varies across it**. Two lattices can agree perfectly about the
set and sample its interior differently, and at S = 0.3, ν = 0.1875 that is
precisely what they do. Nothing render-free was found, so § 6ab.11's exhaustive
four-render probe stands — not for want of a cheaper option, but because the
cheap options answer a different question.

### 6ab.19 — the commensurate annulus, and what a change of offset does and does not move

`packages/core/test/lattice-disk.test.ts`, beside the disc it generalizes.

| Rung | Pinned to | Status |
|---|---|---|
| Every coordinate is a whole number of half-steps, all of parity 0 | `latticeOffset`'s own precondition, asserted directly | ✅ |
| **The cached and uncached images are IDENTICAL, bit for bit** | every pixel, `toBe` | ✅ |
| …at **1 089 pupil evaluations against 662 112** | § 6p's claim, 608× | ✅ |
| **It RENDERS the 2ν the 7-point ring reads as 8.8e-17** — and inside 1.4× of the count-based 21 | § 6ab.12's headline cell, on an IMAGE | ✅ |
| …and holds the carrying set that ring misses entirely — 0.067–0.069 against exactly 0 | the gate's own leg | ✅ |
| Still darkfield: a clear field through it is **exactly** 0 at every pixel | `toBe(0)`, not a tolerance | ✅ |
| A step that lands nothing in the ring **throws**, naming the step and the width | the limit `latticeDiskSource` has and this does not | ✅ |
| § 6ab.17's **constant does not transplant** — 0.901/n here against 0.7373/n | 39 counts, n = 9…358 | ✅ |
| …and its **envelope does** — tail÷head 0.19 at q = 1, 0.52 at q = 4/3, sup e·n^{4/3} = 2.36 | the same ladder | ✅ |
| RECORDED AND REFUSED: 21 of 39 lattice cells put a point exactly on the set's edge — and the worst cells have none | 0 of 115 for the count-based ring | ✅ |
| **It is NOT an offset difference** — `annularSource` is origin-centred at every ODD count, and the offset is worth 1.6% inside its own ladder | every point of all 115 counts; sup 0.7373 odd against 0.7259 even | ✅ |
| **The 22% is one cell of 20** — drop it and the comparison reverses, 0.7006 against 0.7373 | the ladder's 39 rows being 20 distinct steps | ✅ |
| …and the gap **0.1635 is smaller than one carrying point** — 2 of 100 there, 10 of 88 here | n/N at each record cell, 0.1792 and 0.1932 | ✅ |
| **Neither constant is the family's** — the same lattice with the step FREE reaches 1.949 over the same n | 1 201 steps, 2.2× and 2.6× the two records | ✅ |
| RECORDED AND REFUSED, a fourth: sup e·n is not ordered by the boundary's phase — 1.949 a fifth across the cell against 1.264 hard against a line | 3 phase bins of the free-step ladder | ✅ |

#### The ring needed a step where the disc merely wanted one

`annularSource` inherits `diskSource`'s "N points across the diameter", and a
ring throws most of them away: 16 of 49 at N = 7, 128 of 441 at N = 21. So the
number a caller sets and the density it gets are only loosely related, and
§ 6ab.12 measured what that costs — at ν = 0.75 the carrying band is
s_x ∈ [1.25, 1.4] and the 7-point ring's outermost x is 1.2, so it holds **no
point of the set at all** and reads 8.8e-17 where the other samplings agree to
1.35×.

`latticeAnnularSource` sets the lattice *step*, which is an angular density, and
lets the count follow. At `pupilSamples` 64 the same ring holds 2 416 points at
step 1 and 608 at step 2, reading 0.0671 and 0.0691 against the exact 0.070268.

**The claim is made on an image, not on the set.** § 6ab.18 has just finished
measuring that which directions *can* contribute does not determine what they
*do*, so a carrying weight of 0.067 against 0 would be exactly the inference that
section refutes. Rendered: the same grating at 12 cycles and φ = 1.5 reads
**8.8e-17 through the 7-point ring and above 1e-3 through the lattice ring at
either step**, and the lattice reading sits inside **1.4×** of the count-based
21-point ring — the spread § 6ab.11 measured among the samplings that agreed.

**And it takes the § 6p cache into darkfield, which nothing did before.** That is
the constructor's whole justification, so it is measured rather than inherited
from `latticeDiskSource`'s argument: the same object through the same pupil, with
the lattice metadata and without it, is identical at **every pixel** — and the
cached path asks the pupil 1 089 times against 662 112, a **608×** saving. (The
ratio is the claim; only the 33² cache box is pinned exactly, since the other
number is the ring's point count and a change to the mask would fail it as though
physics had moved.)

**One thing does not carry over from the disc.** `latticeDiskSource` argues that
an odd centred grid always contains the axis, so S → 0 degenerates to
`coherentSource` without a special case. A ring with inner > 0 **excludes the
axis by construction**, so a step too coarse to land inside the annulus produces
no points at all — a failure, not a limit. It throws with the step it used and
the width it could not resolve, which is what a caller can act on.

#### A change of step set separates the constant from the envelope

Running § 6ab.17's ladder on the second ring is a controlled test of which half of
that result was about the *set* and which about the *sampling* — the carrying
region is fixed at ν = 0.75 throughout, because `RING_ORDERS` keeps `pupilSamples`
at 32 while the source's own sweeps 8…512. Only the lattice moves.

- **The constant is about the ladder.** sup e·n reaches **0.901** here against
  0.7373 there — 22% worse — so 0.74/n describes the counts `annularSource`
  accepts and not the quantity it estimates. **And 0.901 describes the steps this
  one accepts**, which is the subsection below and was originally left open.
- **The envelope is about the set.** tail÷head is 0.19 at q = 1 and 0.52 at
  q = 4/3, the same shape and the same direction, with sup e·n^{4/3} = 2.36
  against 1.90. n^{-4/3} survives a change of lattice, which is what one would
  want of a claim about a curved boundary.

**One plausible mechanism is recorded and refused.** A lattice commensurate with
the pupil can place a direction exactly where the shifted pupil is tangent to it,
making the in-or-out decision a floating-point tie — the rim hazard § 6ab.11 and
§ 6ab.12 both met. It happens, and often: **21 of 39** lattice configurations have
at least one such point, where the count-based ring has none at any count from 7
to 40. It is nevertheless **not** why this grid converges worse — all six of the
worst cells have no such point, including the one that sets the 0.901. Two
sections of § 6ab have already had to withdraw a mechanism that fit the picture,
so this one is measured before it is believed and reported as a difference rather
than as a cause.

#### The 22% was not an effect, and the sentence that framed it was wrong twice

This section left the gap open as "why the offset costs 22% is unexplained". The
question was malformed, and the premise under it was false.

**It is not an offset.** `annularSource`'s coordinates are `outer·(2i+1−N)/N`,
whose numerator is even for **odd** N — an integer multiple of its own step
`2·outer/N`, so that grid contains the origin exactly as this one does. Only the
even counts are at cell centres, and § 6ab.17's record is at **N = 17**, odd.
Asked of every point of all 115 counts, the deviation is under 1e-12 at odd counts
and exactly ½ a step at even ones. So the offset is a variable the count ladder
itself sweeps, and inside that ladder it is worth **1.6%** — sup 0.7373 over the
odd counts against 0.7259 over the even ones, with the top ten splitting five and
five. It was never 22%'s worth of anything.

**The 22% is one cell of twenty.** The ladder reads 39 cells, but a step is
`2k/pupilSamples` and several (P, k) pairs give the same step: it is **20 distinct
lattices**, each asked up to four times. Drop the single cell that sets the 0.901
and the comparison **reverses** — the runner-up is 0.7006 against the count ring's
0.7373. A direction that survives only its own extremum is not a direction.

**And the gap is smaller than the statistic's own quantum.** e is a difference of
two ratios of integer counts, so one source point entering the carrying set moves
e·n by n/N. The record cells hold **2 carrying points of 100** and **10 of 88**, so
one point is worth 0.1792 and 0.1932 — where the whole gap between the two records
is **0.1635**. The two numbers differ by less than the smallest change either can
make.

**Neither constant is the family's.** Both constructors mask the same ring with
the same origin-centred square lattice and differ only in which steps they can
reach — `2·outer/N` against `2k/pupilSamples`. Asked with the step **free** over
the same range of n, that family reaches sup e·n = **1.949** over 1 201 steps:
2.2× this ring's constant and 2.6× the other's. So 0.7373 and 0.901 are two
suprema over two differently shaped subsets of one family, neither of which
contains its maximum, and the ordering between them is a fact about the subsets.
Both readings stand as measured; the **comparison** is what does not.

**A fourth plausible mechanism, measured and refused.** The one structural pin the
count ladder does carry is real: its step is `2·outer/N`, so `outer/h = N/2` and
its outer boundary sits exactly midway between two lattice lines at **every** one
of the 115 counts, both parities — and pinning that phase at offset 0 is
algebraically the same as requiring an odd count. That is the midpoint-optimal
position, so it is the mechanism a reader would reach for. It does not order the
supremum: binned over the free-step ladder, sup e·n is **1.949 a fifth of the way
across the cell**, against 1.264 hard against a lattice line and 0.935 at the
count ring's own phase. A quantity whose maximum is in the middle is not
controlled by the ends.

#### The app is wired to it, and the reason turned out not to be the obvious one

`packages/app/test/phase.test.ts`, in § 6ab.19's name — app wiring, so no engine
capability and no sub-step of its own.

| Rung | Pinned to | Status |
|---|---|---|
| The control sets a SPACING and the count follows — 608/160/36 at `pupilSamples` 32 **and** 64 | the density being a property of the ring, not of the grid | ✅ |
| …each deriving a whole step (1/2/4 and 2/4/8) and declaring `pupilLattice` | `latticeOffset`'s precondition, § 6p's cache in darkfield | ✅ |
| § 6ab.12's headline cell is **off the control** — the 16-point ring still reads 0, and no option is it | what the CONTROL can reach, the image being § 6ab.19's own rung above | ✅ |
| **Every darkfield refusal names a spacing that works** — 0 unreachable over 2 pupil samplings × 2 grids × every cycle count × 3 spacings | the advice being takeable | ✅ |
| …and the branch fires rather than passing by never being asked | the sweep's own count | ✅ |
| § 6ab.14's carrying **area is unchanged** at 0.070267681347553, at all three spacings | a set with no sampling in it | ✅ |
| The set-resolution ratio moves (0.98/1.07/0.79 against 0.79/1.26/1.11) and is still **not** the contrast's error | § 6ab.14's parenthesis, kept true across a change of lattice | ✅ |

**The defect that decided it was not the cell everyone was looking at.**
§ 6ab.19's open item named the 7-sample cell, and that one was already honest:
the gate said "raise source samples" and 11, 15 and 21 all worked. The cell that
could not be answered is **25 cycles at grid 256 / `pupilSamples` 64**, ν =
0.78125, where the aperture carries 2ν on **1.62%** of its directions and *all
four* counts hold none of it — 7, 11, 15 and 21 all read ~6e-16. So the panel
printed "raise source samples" at every setting a reader could raise it to. That
is advice that cannot be taken, which APP.md records fixing once already at
S = 0; the two finer spacings read 7.8e-3 and 1.34e-2 in the same cell.

The refusal now reads the options rather than asserting one, so "no setting holds
it" is a sentence the panel can say — and the sweep above is the check that it
never has to.

**Three spacings and not two, and the cost is measured rather than summed.** The
probe renders every option whichever is selected, so darkfield's per-frame total
goes from the counts' **248 directions to 804**. Measured under `vite-node` on a
whole scene, pair and probe together: **1310, 1322 and 1366 ms** at the three
spacings and **1333 ms** at φ = 3 — flat, because the selection does not change
what the probe renders — against **1167 ms** for brightfield at S = 1 with a
distinct defocused frame, measured the same way on the same machine. So darkfield
lands at the panel's existing worst case rather than past it. (A3 quotes 989 ms
for that brightfield cell; this machine reads 1167 ms for it, which is why the
comparison is re-measured here instead of quoted across.)

Two spacings would be cheaper and would **under-report**: dropping the finest
narrows the reported disagreement at 6 cycles (1.000× against 1.034×), 9 (1.010×
against 1.081×) and 11 (1.256× against 1.407×), which is this panel's own
established finding that a cheaper probe lies.

**The S ceiling question, asked by the item above, answers to nothing.** The
ceiling is a function of S and darkfield holds S at exactly 0 — the ring's radius
is `DARKFIELD_OUTER` and not the slider — so it stays a brightfield quantity
keyed off the count, which stays the brightfield knob. The three spacings differ
in reach (1.375 against 1.25) and no grid the panel offers has a wall between
them, so nothing is dropped there either.

**One measured consequence, recorded rather than smoothed.** At 12 cycles and
w₂₀ = 3 the coarsest spacing's reading passes through zero — 1.7e-16 against
1.6e-4 and 1.0e-3 — so the printed max/min runs to 6e12 where the focused reading
is a clean 1.466×. That is § 6ab.18's own caution about this statistic arriving
in a cell the geometry says all three samplings carry, not a defect the wiring
introduced.

### Not yet pinned

- ~~**§ 6ab.19's convergence gap is still unexplained.** A lattice-point ring
  converges worse than a cell-centred one (0.901/n against 0.7373/n) while
  keeping the n^{-4/3} envelope.~~ **Answered above, by finding the question
  malformed**: it is not a lattice-point ring against a cell-centred one — both
  grids are origin-centred where the records are set — the 22% is one cell of the
  20 the ladder distinguishes, and it is smaller than one carrying point at either
  record cell. Both constants are suprema over structurally different step sets of
  one family whose own sup over the same n is 1.949. The envelope is untouched.

## Step 6ac — the two focal surfaces, and distortion

Four separate sections of this file have carried the same sentence —
"astigmatism and field curvature are present in the trace and unpinned" — and
the reason it kept being true is that nothing was missing from the *engine*. An
off-axis pencil has never had one focus: the fan in the plane containing the axis
and the field point comes to a line focus at one z, the fan at right angles to it
at another, and `spotAt`, `bestFocus` and `opdMap` have all been quietly
reporting whichever one they landed on since § 6a. What was missing was the
**claim**, and the sums that would let one be stated: `analysis/seidel` computed
S_I and S_II and said so in its own scope note — "S_III…S_V are not computed …
an unpinned formula is worse than an absent one".

So the step is two things joined: S_III and S_IV added to the sums with their own
external anchor, and `analysis/field` measuring the same two surfaces by tracing,
so the closed form and the trace can disagree. They agree to 0.04% and 0.09%.

| Rung | Pinned to | Status |
|---|---|---|
| **S_III = H²φ and S_IV = H²Σφ/n** for a thin lens, stop in contact | Kingslake ch. 6 / Welford ch. 8, 2 indices × 6 shapes | ✅ |
| …and the 6.4e-9 residual **is the centre thickness** — ×10 per decade of it | linearity, 3 decades | ✅ |
| **Neither carries a shape factor**, while S_I over the same scan moves 8.6× | the closed form's own claim | ✅ |
| S_IV/S_III = 1/n exactly — the index, read off two sums | closed form, 2 indices | ✅ |
| H = θ·h to f64, and does not move with the bending | Lagrange invariant | ✅ |
| **S_V = 0**, and it is a CANCELLATION: 1e-13 against per-surface 2.8e-5 | the published zero, 7 orders | ✅ |
| Every field sum identically zero on axis, while S_I is not | `toBe(0)` | ✅ |
| **Distortion refused where the classical term is 0/0** — the reversed plano-convex singlet | A = 0, its own message | ✅ |
| **The traced sags reproduce −(S_III+S_IV)/2n′u′² and −(3S_III+S_IV)/2n′u′²** | 0.04% / 0.09%, over 128× of field | ✅ |
| **Tangential departs from Petzval 3× as far as sagittal** — measured 2.9948 | third-order theory | ✅ |
| Both surfaces INSIDE focus, same side, tangential the further | sign, not ratio | ✅ |
| The astigmatic interval grows as h² — ×4.000 per doubling, 7 doublings to 7.1e-4 | third-order field dependence | ✅ |
| NEGATIVE CONTROL: on axis the interval and both sags are **exactly** zero | `toBe(0)` | ✅ |
| The interval at the smallest field is 2.1e8 ulps of its own focal plane | the f64 floor, measured | ✅ |
| **A mismatched axial reference is 59× the signal** — why the API traces its own | 21-point fan vs 41 | ✅ |
| Distortion is **barrel**, cubic — ×4.00 per doubling — and matches S_V/(2n′u′) | 1e-6 at 0.05°, disjoint machinery | ✅ |
| The paraxial reference IS f·tanθ for a stop at the front vertex | 1e-9, construction check | ✅ |
| **The wrong plane is 13× the signal and nearly flat where physics is steep** | the refused alternative, measured | ✅ |
| A finite conjugate and a displaced stop are refused, not approximated | § 6h owns the finite branch | ✅ |

### The anchor is shape-independent, and that is what makes it sharp

§ 5j pins S_I on a thin lens by matching a published *polynomial* in the
Coddington shape factor — every cross-term and the absolute scale. The field sums
are anchored on the same lens and the anchor is stronger in a specific way: at a
stop in contact, S_III and S_IV **have no shape factor in them at all**. They are
fixed by the power and the glass, so a scan that moves S_I over a factor of 8.6
must leave both numerically unmoved. An error in the chief-ray invariant Ā, in the
Lagrange invariant H, or in the Δ(1/n) that only S_IV carries would almost
certainly show as a spurious q-dependence — which a single-number match would
have absorbed and this cannot.

The residual is not absorbed either. Matching to 6.4e-9 rather than to f64 wants
an explanation, and the explanation is testable: these are thin-lens statements
checked against a two-surface lens 1 nm thick, so a thickness ×10 must cost ×10.
It does, over three decades. That is the same mechanism § 5j records for S_I, and
naming it is the difference between a tolerance and a physics statement.

### Two ways to a plausible wrong answer, and the API refuses both

Both hazards were found by measurement while the step was being built, and both
are the kind that pass a test rather than fail one.

**A sag is a difference, so the reference must be traced the same way.** The
on-axis best-spot plane of the § 5j achromat moves **2.80e-3 mm** between a
21-point fan and a 41-point one — fifth-order spherical residual, sampled
differently, nothing to do with field. That offset is 59× the entire astigmatic
interval at 0.0125°, and it enters both sags as a field-independent constant: the
h² law flattens, and the 3:1 ratio the step exists to check reads **1.02**. It
looks like physics. So `fieldSurfaces` traces its own axial reference with the
identical fan, and the reference is not a parameter a caller can supply.

**Distortion is only distortion at the paraxial image plane.** A chief ray is
straight in image space, so at a plane Δz away its height is scaled by roughly
(1 + Δz/f) — a constant relative error with no field dependence at all. Read at
the best-spot plane instead, the § 5j achromat shows **3.07e-5** where its real
third-order term at the edge of the field is 2.27e-6: thirteen times the signal,
moving 7% over a span of field that multiplies the real term by 256. A reading
dominated by the lever is nearly flat exactly where the physics is steep, which is
how a wrong plane makes distortion look absent rather than wrong. So
`distortionProfile` takes the plane from `paraxialImageOffset` and does not accept
one.

### The sign a ratio cannot see

The headline is a ratio, and a ratio is sign-blind: 3:1 would pass with both sags
mirrored, or with the two sections swapped. Three assertions close that separately
— both sags negative (both surfaces bend toward the lens, inside paraxial focus),
the tangential the further of the two, and the on-axis interval **exactly** zero
rather than small. The last is also what licenses the tolerances above: the two
fans differ by nothing at all when there is nothing to differ about, so the
0.04%/0.09% residuals at field are the closed form's own higher-order tail and not
a floor in the measurement.

Distortion's sign is fixed the same way, and deliberately not by the comparison it
is being checked against: the § 5j achromat carries its stop at the **front
vertex**, ahead of the lens, and a stop ahead of a positive lens gives barrel —
the textbook direction. The traced departure is negative. Had the conversion from
S_V to a length needed a minus sign to agree, that would have been evidence
against the convention rather than a free parameter.

### Not yet pinned

- **The stop shift.** Every off-axis sum here needs the stop at the first surface,
  inherited from `seidelSums`' chief-ray shortcut. The published stop-shift
  equations would lift that, and they are what a *non-zero* external distortion
  anchor needs: the only closed form reachable now is the stop-in-contact zero.
  The traced achromat's distortion is therefore pinned against its own S_V and
  against a power law, not against a textbook number for a displaced stop.
- **The 0/0 at A = 0.** A surface the marginal ray crosses undeviated makes the
  classical S_V term 0/0 — the numerator vanishes identically there, shown in the
  module header — and the reversed plano-convex singlet is not an exotic system to
  hit it with. The limit needs L'Hôpital on the pair and is not implemented; the
  flag refuses out loud instead.
- **The sagittal criterion.** Both foci are `bestSpotZ` on their fan, which is a
  min-RMS-spot plane over both transverse axes. The classical sagittal focus is
  the y-crossing of the sagittal fan alone, and the two part company only at
  higher order — bounded here by the 0.04% agreement with the closed form, but not
  separately measured.
- **Astigmatism off the d line, and the medial surface as a focus criterion.**
  Everything is at one wavelength, and `medialZ` is reported but nothing measures
  that it is where a real detector wants to sit.
- **No app surface, and not even a scoped one.** This is engine capability with no
  panel: `analysis/field` has no caller in `packages/app`, and APP.md has no
  field-curvature entry to cost one — its only mention of the term is in passing,
  about a tilt tolerance. Scoping it is the next thing this step wants, and the
  readouts are already decided by what is pinned above: both sags against field,
  the astigmatic interval, the Petzval surface as the third curve, and the
  distortion profile. The one design constraint the step hands the panel is that
  neither number survives being measured against a plane the caller chose —
  which is why both live behind functions that pick their own.


## Step 6ad — the two MTF sections, and the cutoff of an aperture that did not transmit

`wave/mtf` has said since it was written that the tangential/sagittal split is
"a separate function when field curvature work arrives". § 6ac is when it
arrived: it gave the two sections two focal surfaces and measured them. This step
is the same split in frequency space — the readout that says which way a lens
resolves — and it turned out to be two things joined, because writing it required
opening the module's own prose and one sentence there was false.

**The readout adds no physics and the rungs know it.** § 2b already pinned the
on-axis MTF against the closed-form circular-pupil curve and its scale against
2·NA/λ. Slicing a row and a column out of that array is composition. What it adds
is a **claim about direction** — that the row is the meridional section — and a
direction is exactly the kind of thing that passes every magnitude test while
being backwards. So nearly all of the effort below is spent on the direction, and
the anchor is not one measurement but the **agreement of three machineries that
share no code above the trace**: the ray spot's second moments (geometry, no
transform), the PSF intensity's second moments (one transform), and the section
split itself (two transforms). On the § 5j achromat at 0.8° they read 1.848,
1.390 and 1.48× — different numbers, because an unweighted ray count and an
energy-weighted intensity weigh a coma flare's thin tail differently, and the same
answer about which direction is blurred.

**The negative control is the load-bearing rung, and it had to be made worse to
be worth anything.** A spherical mirror with its aperture stop at the centre of
curvature is symmetric about that stop at every field angle — the Schmidt
camera's premise — so coma, astigmatism and distortion vanish identically. It is
therefore a system that is genuinely off axis and genuinely round, and any
machinery that manufactures a split out of a non-zero field rather than out of an
asymmetry fails on it. The first draft used it at 0.135 waves RMS at 0.8° and
**0.0698 at 1.6°** — the second is *inside* Maréchal's 0.0745, so it was very
nearly a perfect system agreeing with itself, which proves almost nothing. At a
15 mm semi-aperture the same mirror carries **0.747 and 0.593 waves** and a Strehl
under 0.11, and the sections still agree to 5e-4. Large aberration, no asymmetry,
no split — that is the statement, and it needed the aperture opened to make it.

**The obvious rung does not hold, and the reason is recorded so it is not
rediscovered as a bug.** Refocusing to § 6ac's tangential focus and watching the
tangential section win is the textbook demonstration, and on this achromat it
fails: at 0.8–1.6° the lens is coma-dominated, not astigmatism-dominated, so
*both* sections are best at the sagittal focus and the crossover never happens.
The classical crossover is a statement about pure astigmatism; a real lens at a
field where its astigmatism is measurable has several times as much coma. A rung
for it would need a coma-free astigmatic design this repo does not have.

### The sentence that was false

`wave/mtf`'s header said the cutoff landing at exactly `psf.pupilSamples`
frequency bins is "a strong internal check on the whole pupil→image scale". It is
not one. The scale is built from the exit pupil **radius**; the array's real
support is the aperture that survived the **trace**; nothing makes those the same
aperture, and on the lens the app ships they are not.

`refractorPair` fixes the crown's centre thickness at 3 mm whatever the focal
length, so past some semi-diameter the two sags meet and the tracer reports
`miss` from the rim inward. That is APP.md Part B's **aperture wall**, already
measured there as an EPD going as √f. What is new here is where it becomes
visible: not as a lost-ray count but as **a wrong number on a plot**. At f/10 with
D = 100 the modulation reaches zero at ν = 0.73 while `cutoffCyclesPerMm` still
reports the full 170.27 c/mm, and at f/5 at ν = 0.51. The two measurements agree
with the surviving pupil radius to better than 2% (0.728 and 0.515 traced), and
Part B's √f extrapolation lands at 73.0 mm against the 72.8 measured here — the
same wall reached by a third route.

**What makes it aperture and not aberration** is the one check that distinguishes
them, because a badly aberrated system also has almost no high-frequency
contrast: the **aberration-free** PSF — same pupil, phase zeroed — cuts off in the
same place. A perfect system whose contrast stops at 0.73 of its stated cutoff has
a smaller aperture than it says it has, and there is no second reading. The
singlet of the same pair is the control: 5 mm of centre thickness on a much
flatter crown never closes inside D = 100, so it traces ρ = 1.0000 at every focal
length the achromat loses one at.

The header now carries the missing clause and `cutoffCyclesPerMm` says in its own
doc comment that it is the cutoff of the aperture that was *asked for*. The
engine is not changed: the number is the right number for the question it
answers, and measuring the transmitted cutoff is a readout, left to the caller
that wants it.

| Rung | Pinned to | Status |
|---|---|---|
| Both sections reproduce (2/π)·[arccos ν − ν√(1−ν²)] on axis, to 0.01 | Goodman, closed form | ✅ |
| Both are exactly 1 at ν = 0, and the sections span [0,1] where the profile cannot | the definition | ✅ |
| On axis the two sections are **the same curve to 1.4e-16** — a floor, not a tolerance | rotational symmetry | ✅ |
| `mtfAt` **is** the tangential sampler, asserted as an identity | so older callers keep meaning what they meant | ✅ |
| Monocentric mirror, 0.75 waves RMS and Strehl < 0.11 off axis: split **< 1e-3** | stop-at-CoC symmetry, 2 fields | ✅ |
| …against the achromat's **0.226** at the same field — three orders | the control's whole purpose | ✅ |
| Coma blurs the meridional direction: **1.848 / 1.390 / 1.48×** by rays, by PSF, by MTF | three machineries agreeing | ✅ |
| The tangential section is below the sagittal one at every ν ≥ 0.05 | the convention, checked not asserted | ✅ |
| The radial average is **not bracketed** by the two sections it summarizes | 45° azimuths are worse than either | ✅ |
| Transmitted cutoff = surviving pupil radius: **0.728 / 0.515** at f/10 and f/5, to 6% | the trace's own `miss` count | ✅ |
| …and the **aberration-free** PSF cuts off in the same place | aperture, not aberration | ✅ |
| …while `cutoffCyclesPerMm` reports 2·NA/λ regardless, to 1% | the number is right for its own question | ✅ |
| The singlet of the same pair keeps ρ = 1.0000 and `lost` = 0 at all three focal lengths | the control on the tracer itself | ✅ |
| `mtfProfile` **refuses** a bin count past `cutoffBins`, and fills every bin at exactly it | § 6ac's refuse-don't-document rule | ✅ |

### Not yet pinned

- **The classical T/S crossover at the two foci**, for the reason above: it needs a
  coma-free astigmatic design, and the honest alternative was to pin the direction
  by agreement between machineries instead.
- **The 1e-4 residual split off axis** is attributed to Part J's fit-over-a-discrete-pupil
  leak — it grows with the wavefront and with field, as that leak does — but it is
  bounded here rather than separately identified the way Part J identified its own.
- **A transmitted-cutoff readout in the engine.** Deliberate: the measurement is a
  scan for where an array falls to its floor, which is a caller's convention
  (what counts as zero) rather than physics. The rungs above do it with an
  explicit threshold and say so.
### The refusal the panel added, one commit later

`mtfProfile` bins by annulus, and past `cutoffBins` bins the annuli are narrower
than a pixel: they come back empty and used to fall through to `modulation = 0`,
which on a plot is indistinguishable from a frequency the lens transmits nothing
at. Asking for 161 bins across a 64-bin band read **0.51 of modulation below the
two sections** — four times the real 45°-azimuth effect, in the same direction,
and therefore perfectly shaped to confirm the very claim the panel had gone
looking for. It briefly did: APP.md Part K's first draft asserted the excursion
was 0.015 and it was the bin width.

It now throws, naming the largest count it can fill. § 6ac's rule — an identity a
caller can get wrong silently is refused rather than documented — and this is the
strongest case for it yet, because the caller genuinely cannot notice: the
returned array is the right length and full of plausible numbers.

### Not yet pinned (continued)

- **No app surface.** ~~`mtfSections` has no caller in `packages/app`~~ — ✅ closed
  by APP.md Part K, route `#/mtf`, which is what found the refusal above.

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
- ~~**§ 6r — polychromatic brightfield.**~~ **Claimed**, and with it the whole
  Part D line: [§ 6m](#step-6m--the-off-axis-frame),
  [§ 6n](#step-6n--the-warped-grid-rasterizer),
  [§ 6o](#step-6o--the-mosaic-and-its-guard-band),
  [§ 6p](#step-6p--the-commensurate-condenser-and-the-cached-pupil),
  [§ 6q](#step-6q--the-eyepiece-on-the-intermediate-image) and
  [§ 6r](#step-6r--polychromatic-brightfield) have all left this list. Every one
  of them arrived as the scoping of an app surface, and Part D carried the
  feasibility measurements they would pin, labelled as feasibility figures and
  **not** as pins — which is the distinction this file exists to keep, and four
  of the five showed why it matters. § 6o corrected two of the three conclusions
  D0.2's feasibility table drew, § 6p corrected D0.3's premise *and* one of
  § 6o's own conclusions, § 6q corrected D6's prediction that `visualSystem`
  would compose unchanged, and § 6r corrected D7's own premise: the ruler is the
  step's difficulty, but the resampler it needs is **not** the one already on the
  ladder. A rung pinned to a previous measurement inherits whatever that
  measurement was really measuring.
- ~~**§ 6l — depth-dependent spherical aberration.**~~ **Claimed**, and it is the
  branch's last numbered gap. It is the one entry on this list that did **not**
  arrive as the scoping of an app surface — it was scoped in APP.md as
  *disqualified*, blocked on itself — and it is the one that behaved most exactly
  as predicted: "the physics is in § 6c/§ 6e already; wiring focal depth into that
  stack is its own step" was right, and no physics was added. What it did not
  predict is where the difficulty sat. Not in the wavefront, which was one call to
  an existing function, but in the **reference** it is quoted in (§ 6l.1) and in a
  **coupling between two modules' conventions** that no readout could have caught
  (§ 6l.9). Twice now the expensive part of a step has been a convention rather
  than a formula — § 6r's resampler Jacobian and this — which is a different
  failure from "the feasibility number measured something else" and wants its own
  guard: an identity a caller can get wrong silently is refused, not documented.

## Rules

- New engine capability ⇒ new rung(s) in the same PR.
- Never loosen a tolerance to make a test pass — investigate; tolerances
  document the physics, not the implementation's mood.
