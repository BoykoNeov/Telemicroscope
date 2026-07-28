import { SurfaceSpec } from "../trace/prescription";
import { getMedium } from "../materials/catalog";

/**
 * The coverslip — the `0.17` half of a DIN objective's `160/0.17` engraving.
 *
 * ## What it is, and why a flat piece of glass is not a no-op
 *
 * A cover glass is a plane-parallel plate: no power, no first-order effect on
 * focal length or magnification. It is nonetheless one of the two numbers
 * engraved on every objective, because a plate in a **non-collimated** beam
 * carries spherical aberration, and the beam between a specimen and an objective
 * is the most steeply convergent one in the whole instrument.
 *
 * The specimen is mounted *under* the slip, so the light leaves it inside the
 * glass and crosses the full thickness before reaching air. That is the model
 * here: `objectMedium` is the cover glass, and the plate's upper face is a plane
 * refracting surface a slip-thickness in front of the specimen.
 *
 * ## Everything the plate does has an exact closed form
 *
 * A plate is one of the few real optical elements whose aberration is solvable in
 * closed form to **all orders**, from Snell alone, which makes it an unusually
 * strong external pin: no third-order truncation, no fitted design, no reference
 * implementation. Three of them, and the engine has to reproduce each.
 *
 *  - **Apparent depth.** Paraxially the plate makes the specimen look t/n closer,
 *    so the objective must sit a physical air gap of a − t/n away where a is the
 *    air-equivalent object distance it was designed for. Every readout here is a
 *    readout: `finiteConjugateObjective` places the lens by *solving the traced
 *    paraxial chain*, never by evaluating t/n, so the agreement is a measurement.
 *  - **Longitudinal spherical aberration**, exactly, for a ray leaving the
 *    specimen at angle θ′ inside the glass and emerging at θ:
 *
 *        LSA(θ) = t·(1/n − tanθ′/tanθ)          sinθ = n·sinθ′
 *
 *    the difference between where that ray crosses the axis and where the
 *    paraxial one does, signed along +z. It comes out POSITIVE: the marginal
 *    ray's axial crossing lands *beyond* the paraxial one — the opposite sense
 *    to a positive lens, whose marginal focus falls short — which is why an
 *    objective corrected for a slip is deliberately built aberrated the other
 *    way, and why using it without one is worse than not correcting at all.
 *  - **The wavefront**, referenced to that paraxial image point:
 *
 *        W(s) = t·[√(n²−s²) − n] − (t/n)·[√(1−s²) − 1],     s = sin θ
 *
 *    from the optical path n·t/cosθ′ less the projection onto the emergent ray of
 *    the vector from the paraxial image point. Its leading term is the classical
 *    third-order plate coefficient
 *
 *        W₀₄₀ = t·(n²−1)·s⁴ / (8n³)
 *
 * ## Two things follow, and they are the whole reason the engraving exists
 *
 * **It is exactly linear in thickness.** Every formula above carries t as a bare
 * factor, so the aberration of a *wrong* slip is the aberration of a plate of the
 * error alone: swapping a 0.17 mm slip for a 0.19 mm one is a 0.02 mm plate's
 * worth of spherical aberration, at any NA and to all orders. That is what makes
 * "coverslip mismatch" a one-parameter story.
 *
 * **It scales as NA⁴.** So the tolerance on the thickness runs as 1/NA⁴, and the
 * range over which an objective's engraving matters is savage: the same slip
 * error that is invisible at NA 0.10 — where the tolerance is measured in
 * *millimetres* — takes a 0.95 dry objective out of the diffraction limit at a
 * few microns. `coverslipTolerance` reports it under both of the criteria the
 * literature quotes, because they differ by 4× and are easy to confuse.
 *
 * SCOPE. Thickness mismatch only. **Index** mismatch is a real second axis — a
 * slip of the right thickness and the wrong glass aberrates too, at
 * ∂W₀₄₀/∂n = t·(3−n²)·s⁴/(8n⁴) — and is not modelled; nor is the tilt of a
 * non-parallel slip, nor the mounting medium between specimen and slip (the
 * specimen is taken to be in contact with the glass). Off axis the plate also
 * adds coma and astigmatism in a non-telecentric beam; only the on-axis S_I story
 * is pinned, which is the one a correction collar exists for.
 *
 * The one-plate scope above is the DRY case. An immersion objective looks through
 * a *stack* — slip, fluid, the front element's flat underside — and the second
 * half of this module generalises every formula here to N layers of N indices
 * (§ 6e.1), exactly, still to all orders. That generalisation is where "the oil
 * is index-matched" stops being a slogan and becomes an algebraic identity.
 *
 * The **third** section takes the same stack and buries the specimen inside one
 * of its layers (§ 6l): a mount of index n_s and a focal depth d. That needs no
 * new physics at all — a depth is one more layer — and what it adds is the
 * reference the literature quotes it in, the focus-knob scaling that falls out of
 * the same apparent distance, and the aperture ceiling that is not an aberration
 * at all.
 */

/** The No. 1.5 cover glass every DIN/JIS objective is engraved for (mm). */
export const NOMINAL_COVERSLIP_THICKNESS_MM = 0.17;

/** Schott D 263® T eco — the ISO 8255-1 cover-glass borosilicate (§ 1). */
export const COVERSLIP_MEDIUM = "D263";

export interface CoverslipSpec {
  /** Thickness (mm). Default 0.17, the No. 1.5 standard. */
  readonly thicknessMm?: number;
  /** Catalog medium. Default "D263". */
  readonly medium?: string;
}

export interface Coverslip {
  readonly thicknessMm: number;
  readonly medium: string;
}

export function coverslip(spec: CoverslipSpec = {}): Coverslip {
  const thicknessMm = spec.thicknessMm ?? NOMINAL_COVERSLIP_THICKNESS_MM;
  if (!(thicknessMm > 0) || !Number.isFinite(thicknessMm)) {
    throw new Error("coverslip: thickness must be a positive finite distance");
  }
  const medium = spec.medium ?? COVERSLIP_MEDIUM;
  getMedium(medium); // fail here, not three layers down inside a trace
  return { thicknessMm, medium };
}

/**
 * The plate's upper face as a prescription surface: plane, glass behind it,
 * `gapMm` of `medium` in front of the objective's first vertex.
 *
 * Only one surface, because the specimen sits ON the lower face — the light
 * starts inside the glass, so the prescription carrying this must declare the
 * slip as its `objectMedium` and put the object a slip-thickness in front.
 * Unbounded: a 22 mm square cover glass is never the aperture.
 *
 * Takes no `Coverslip`, deliberately: the slip's own glass is the *object*
 * medium and everything about this face is a property of what comes AFTER it —
 * air for a dry objective, and the immersion fluid for a wet one. § 6e took the
 * `medium` argument this comment predicted it would want; it defaults to "AIR",
 * so every § 6c caller is unchanged.
 */
export function coverslipSurface(gapMm: number, medium: string = "AIR"): SurfaceSpec {
  return {
    kind: "refract",
    curvature: 0,
    semiAperture: Infinity,
    thickness: gapMm,
    medium,
  };
}

/** Index of the slip's glass at this wavelength. */
export const coverslipIndex = (slip: Coverslip, wavelengthNm: number): number =>
  getMedium(slip.medium).n(wavelengthNm);

/**
 * Apparent depth: how far below the plate's top face the specimen *appears*,
 * paraxially. The whole first-order effect of a coverslip, and the reason the
 * objective sits closer than its air-equivalent object distance.
 */
export const apparentDepthMm = (thicknessMm: number, n: number): number => thicknessMm / n;

/**
 * How far the plate pushes the paraxial focus back: t·(n−1)/n, the complement of
 * the apparent depth. Quoted this way round because it is what a plate inserted
 * into a *converging* beam does.
 */
export const plateFocusShiftMm = (thicknessMm: number, n: number): number =>
  (thicknessMm * (n - 1)) / n;

/**
 * Exact longitudinal spherical aberration of the plate for a ray emerging at
 * `sinTheta`: where it crosses the axis, less where the paraxial ray does.
 *
 *     LSA = t·(1/n − tanθ′/tanθ),     sinθ = n·sinθ′
 *
 * All orders, from Snell and one similar triangle. Signed along +z, and positive
 * — the marginal crossing is beyond the paraxial one.
 */
export function plateLongitudinalAberrationMm(
  thicknessMm: number,
  n: number,
  sinTheta: number,
): number {
  if (!(sinTheta > 0) || sinTheta >= 1) {
    throw new Error("plateLongitudinalAberrationMm: sinTheta must lie in (0, 1)");
  }
  // Rationalised. As written above this is a difference of two numbers near 1/n,
  // which at small angles is all cancellation: the answer at NA 1e-4 is 3e-10
  // out of terms of order 0.66, and f64 has nothing left to say about it.
  // Substituting tanθ′/tanθ = √(1−s²)/√(n²−s²) and clearing the difference of
  // roots leaves an equivalent form with no subtraction of like quantities —
  // and with the third-order limit t·s²(n²−1)/(2n³) visible in it.
  const s2 = sinTheta * sinTheta;
  const rootN = Math.sqrt(n * n - s2);
  return (
    (thicknessMm * s2 * (n * n - 1)) / (n * rootN * (rootN + n * Math.sqrt(1 - s2)))
  );
}

/**
 * Exact wavefront error of the plate at `sinTheta`, referenced to the paraxial
 * image point (so the defocus the plate introduces is already taken out and what
 * is left is aberration):
 *
 *     W(s) = t·[√(n²−s²) − n] − (t/n)·[√(1−s²) − 1]
 *
 * mm of optical path. All orders; `plateW040Mm` is its leading term.
 */
export function plateWavefrontErrorMm(
  thicknessMm: number,
  n: number,
  sinTheta: number,
): number {
  // Same rationalisation as the longitudinal form, and for the same reason: as
  // written in the header it is (a number near n) minus (a number near n), which
  // at NA 0.001 leaves f64 computing a part in 10⁻¹³ from cancellation alone and
  // getting it 0.2% wrong. Clearing both differences of roots gives
  //
  //     W = t·s⁴·(n²−1) / [ n(√(1−s²)+1)·(√(n²−s²)+n)·(√(n²−s²)+n√(1−s²)) ]
  //
  // whose small-angle limit is t·s⁴(n²−1)/(8n³) — `plateW040Mm`, now visible in
  // the denominator's four factors rather than hidden behind a subtraction.
  const s2 = sinTheta * sinTheta;
  const rootOne = Math.sqrt(1 - s2);
  const rootN = Math.sqrt(n * n - s2);
  return (
    (thicknessMm * s2 * s2 * (n * n - 1)) /
    (n * (rootOne + 1) * (rootN + n) * (rootN + n * rootOne))
  );
}

/**
 * The third-order plate coefficient, W₀₄₀ = t·(n²−1)·s⁴/(8n³) (mm) — the
 * published closed form, and the leading term of `plateWavefrontErrorMm`.
 *
 * `sinTheta` is a SINE — the numerical aperture of a dry objective — which is
 * how the microscopy literature quotes it. `analysis/seidel` seeds its marginal
 * ray with the paraxial slope u = h/s, i.e. a TANGENT, so the engine's own
 * third-order sum for the same plate is the tan⁴ version of this. Third-order
 * theory cannot tell them apart (their difference is fifth-order and up) and
 * neither is wrong, but they part company fast: 0.5% at NA 0.10 and a factor of
 * three by NA 0.65. Anything comparing the two has to say which it plotted.
 */
export function plateW040Mm(thicknessMm: number, n: number, sinTheta: number): number {
  return (thicknessMm * (n * n - 1) * sinTheta ** 4) / (8 * n * n * n);
}

/**
 * ## The plane STACK — § 6c's plate, generalised to N layers of different glass
 *
 * An immersion objective does not look through *a* plate. It looks through a
 * stack: the specimen sits under a cover glass, above the cover glass is a film
 * of immersion fluid, and above that is the flat underside of the front element.
 * Three layers of three different indices, all in the steepest cone in the
 * instrument. Everything above generalises to that stack exactly, and the
 * generalisation is what § 6e is pinned on — so it lives here, next to the
 * single-plate forms it must reduce to, rather than in the design that uses it.
 *
 * Write q = n·sinθ for the ray invariant, which is conserved across every plane
 * face and IS the numerical aperture. In layer i the ray runs at
 * sinθᵢ = q/nᵢ, so cosθᵢ = √(nᵢ²−q²)/nᵢ, and with n_out the index the light
 * finally emerges into:
 *
 *  - **Apparent distance** (paraxial): D = n_out · Σᵢ tᵢ/nᵢ. Each layer is seen
 *    through its own reduced thickness — § 6c's apparent depth, per layer.
 *  - **Longitudinal**, exactly:
 *
 *        LSA = Σᵢ tᵢ·[ n_out/nᵢ − √(n_out²−q²)/√(nᵢ²−q²) ]
 *
 *  - **Wavefront** referenced to the paraxial image point, exactly:
 *
 *        W(q) = Σᵢ tᵢ[√(nᵢ²−q²) − nᵢ] − n_out(√(n_out²−q²) − n_out)·Σᵢ tᵢ/nᵢ
 *
 * ## Two things about these are worth more than the formulas
 *
 * **They reduce to § 6c.** One layer of index n emerging into air is
 * `plateLongitudinalAberrationMm` and `plateWavefrontErrorMm`, term for term —
 * not approximately, identically, which is a rung rather than a remark.
 *
 * **They are identically zero when the stack is index-matched.** Set every
 * nᵢ = n_out and each summand above vanishes *on its own*, for every q, to all
 * orders. That is not a small residual to be measured; it is an algebraic
 * identity, and it is the entire physical reason immersion oil is formulated to
 * the index of the front element and the cover glass. A matched stack is
 * optically invisible no matter how steep the cone crossing it — which is what
 * lets an immersion objective work at NA 1.4 through 0.17 mm of glass that would
 * destroy a dry NA 0.95.
 *
 * The rationalised forms below make both properties survive floating point: each
 * is written per layer with (nᵢ²−n_out²) as an explicit factor, so a matched
 * layer returns a hard zero instead of a difference of two numbers near 1. The
 * cost is the honest one — a nearly-matched layer (Δn ~ 1e-3, which is what the
 * real oil/D263/N-BK7 triad is) computes its small answer with about three fewer
 * digits than a mismatched one, because that is what a difference of like
 * quantities costs. Ten digits is far more than any rung here asks for.
 */
export interface PlaneLayer {
  readonly thicknessMm: number;
  /** Refractive index of this layer AT THE WAVELENGTH IN USE — already resolved. */
  readonly n: number;
}

const checkStack = (layers: readonly PlaneLayer[], nOut: number, q: number): void => {
  if (!(nOut > 0)) throw new Error("plane stack: the emergent index must be positive");
  if (!(q >= 0)) throw new Error("plane stack: the ray invariant q = n·sinθ must be non-negative");
  if (q >= nOut) {
    throw new Error(
      `plane stack: q = ${q} does not propagate into a medium of index ${nOut} — total internal reflection`,
    );
  }
  for (const l of layers) {
    if (!(l.n > 0)) throw new Error("plane stack: every layer index must be positive");
    if (q >= l.n) {
      throw new Error(
        `plane stack: q = ${q} exceeds a layer index of ${l.n} — the ray never leaves that layer`,
      );
    }
  }
};

/**
 * Paraxial apparent distance of the object through the stack, measured in the
 * emergent medium from the stack's last face: D = n_out·Σ tᵢ/nᵢ.
 *
 * The only first-order effect a stack of plane layers has. For a matched stack
 * it is just the geometric total thickness, which is the paraxial half of the
 * "the oil is invisible" statement.
 */
export function stackApparentDistanceMm(
  layers: readonly PlaneLayer[],
  nOut: number,
): number {
  checkStack(layers, nOut, 0);
  return nOut * layers.reduce((a, l) => a + l.thicknessMm / l.n, 0);
}

/**
 * Exact longitudinal spherical aberration of the stack for the ray of invariant
 * `q`: the paraxial crossing less the real one, signed the same way § 6c signs
 * `plateLongitudinalAberrationMm` (positive = the marginal crossing lands beyond
 * the paraxial one, along +z).
 *
 * Rationalised per layer to
 *
 *     LSA = Σᵢ tᵢ q²(nᵢ²−n_out²) / [ nᵢ√(nᵢ²−q²)·(n_out√(nᵢ²−q²) + nᵢ√(n_out²−q²)) ]
 *
 * — no subtraction of like quantities anywhere, and (nᵢ²−n_out²) sitting in the
 * numerator so a matched layer contributes an exact zero.
 */
export function stackLongitudinalAberrationMm(
  layers: readonly PlaneLayer[],
  nOut: number,
  q: number,
): number {
  checkStack(layers, nOut, q);
  const rootOut = Math.sqrt(nOut * nOut - q * q);
  let sum = 0;
  for (const l of layers) {
    const root = Math.sqrt(l.n * l.n - q * q);
    sum +=
      (l.thicknessMm * q * q * (l.n * l.n - nOut * nOut)) /
      (l.n * root * (nOut * root + l.n * rootOut));
  }
  return sum;
}

/**
 * Exact wavefront error of the stack at invariant `q`, referenced to the
 * paraxial image point (mm of optical path). Rationalised per layer to
 *
 *     W = Σᵢ tᵢ q⁴(nᵢ²−n_out²)
 *         / [ (n_out√(nᵢ²−q²)+nᵢ√(n_out²−q²))·nᵢ(√(nᵢ²−q²)+nᵢ)(√(n_out²−q²)+n_out) ]
 *
 * The q⁴ is not fitted — it falls out of clearing the two differences of roots,
 * and it is the reason a stack's leading term is third-order spherical and
 * nothing lower. `stackW040Mm` is that leading term.
 */
export function stackWavefrontErrorMm(
  layers: readonly PlaneLayer[],
  nOut: number,
  q: number,
): number {
  checkStack(layers, nOut, q);
  const rootOut = Math.sqrt(nOut * nOut - q * q);
  const q4 = q * q * q * q;
  let sum = 0;
  for (const l of layers) {
    const root = Math.sqrt(l.n * l.n - q * q);
    sum +=
      (l.thicknessMm * q4 * (l.n * l.n - nOut * nOut)) /
      ((nOut * root + l.n * rootOut) * l.n * (root + l.n) * (rootOut + nOut));
  }
  return sum;
}

/**
 * The stack's third-order coefficient — the small-q limit of
 * `stackWavefrontErrorMm`:
 *
 *     W₀₄₀ = q⁴ · Σᵢ tᵢ(nᵢ²−n_out²) / (8·nᵢ³·n_out²)
 *
 * For one layer in air this is `plateW040Mm` exactly. Its sign is the useful
 * part: a layer DENSER than the emergent medium contributes positive spherical
 * aberration and a rarer one contributes negative, so a stack can be balanced
 * against itself — and an objective corrected for a stack is deliberately built
 * aberrated by minus this, § 6c's `targetS1Mm` route.
 */
export function stackW040Mm(
  layers: readonly PlaneLayer[],
  nOut: number,
  q: number,
): number {
  checkStack(layers, nOut, q);
  const q4 = q * q * q * q;
  return layers.reduce(
    (a, l) =>
      a + (l.thicknessMm * q4 * (l.n * l.n - nOut * nOut)) / (8 * l.n ** 3 * nOut * nOut),
    0,
  );
}

/**
 * ## The DEPTH — § 6e.1's stack with the specimen buried inside one of its layers
 *
 * Everything above puts the specimen *on* the cover glass. A real specimen is
 * mounted in something — water, glycerol, a resin — and sits some depth below
 * the slip, which is the dominant real-world defect of deep widefield and
 * confocal imaging and the reason correction collars exist (§ 6l).
 *
 * The physics needs nothing new. Focusing at depth d into a mount of index n_s,
 * through immersion n_i, is **one more layer** on the stack above: t = d,
 * n = n_s. `stackWavefrontErrorMm` already solves that exactly, to all orders,
 * and every property it has transfers unchanged — linear in d, identically zero
 * when n_s = n_i, leading term q⁴.
 *
 * ## The literature quotes a different expression, and the difference is a refocus
 *
 * Gibson–Lanni and Hell et al. quote the depth aberration as
 *
 *     OPD(q) = d·[ √(n_s²−q²) − √(n_i²−q²) ]
 *
 * which is `depthOpdMm` below — derived independently here (a ray leaving the
 * source at θ_s against a ray leaving the objective's nominal focus at θ_i, the
 * two emerging parallel, with the lateral offset of the interface crossing
 * projected onto the shared emergent direction). It is **not** the stack's
 * expression, because the two are referenced to different points: the stack to
 * the *paraxial image* of the buried source, the literature to the objective's
 * *nominal* focus. They differ by an exact axial shift `depthFocusShiftMm` plus
 * a piston, and § 6l.1 pins that to f64.
 *
 * **The trap worth stating, because it is the natural check to reach for and it
 * reads backwards:** the two forms have *different q⁴ coefficients* — for a 10 µm
 * water mount under oil, −1.1918e-4 against −1.6826e-4 per q⁴. That is evidence
 * of correctness, not of error. An exact axial shift δ in a medium of index n is
 * δ·[√(n²−q²) − n], which carries q⁴ and every higher even order; only its
 * *paraxial* part is q². So two expressions genuinely related by a refocus **must**
 * disagree in q⁴, and the disagreement here is the shift's own q⁴ to the last
 * digit. Comparing third-order coefficients cannot tell a wrong wavefront from a
 * differently-referenced one; the all-orders identity can.
 *
 * ## The wall is not aberration — the rays do not exist
 *
 * A ray inside the mount carries q = n_s·sinθ_s < n_s. So **no ray of invariant
 * above n_s ever leaves the specimen**, whatever the objective's rim is engraved
 * with: an oil objective labelled 1.40 delivers at most **1.3347** into a water
 * mount, and the outer annulus of its pupil receives no light from the specimen
 * at all. That is `deliveredNaIntoMount`, and it is a geometric ceiling of the
 * kind this branch keeps meeting — after § 6b's f/4.1, § 6d's NA 0.343,
 * § 6e.4's NA 1.411 and § 6q's 0.88·f_e, the fifth, and the cleanest, being one
 * line of the ray invariant.
 *
 * It is a ceiling on the rays and **not** on the wavefront, which is worth
 * stating because the two behave oppositely there. `stackLongitudinalAberrationMm`
 * carries √(n_s²−q²) in its denominator and **diverges** at the wall — the
 * grazing ray's axial crossing runs away. `stackWavefrontErrorMm` does not: its
 * rationalised denominator keeps that root as a *factor* alongside terms that
 * stay finite, so W at q = n_s is an ordinary number (−4.30e-3 mm for 10 µm of
 * water under oil). So nothing blows up and nothing is clipped by an aberration
 * budget; the rays simply stop existing, and § 6l.3 pins the boundary at exactly
 * n_s — one ulp below it computes, at it refuses.
 */

/**
 * The literature's depth OPD — Gibson–Lanni / Hell et al., referenced to the
 * objective's **nominal** focus rather than to the buried source's paraxial
 * image:
 *
 *     OPD(q) = d·[ √(n_s²−q²) − √(n_i²−q²) ]
 *
 * Written as the header derives it, deliberately NOT rationalised and NOT reusing
 * the stack: it is the external pin `stackWavefrontErrorMm` is checked against,
 * so it must be an independent expression or the check is a tautology. Carries
 * piston and defocus; `stackWavefrontErrorMm` carries neither.
 */
export function depthOpdMm(
  depthMm: number,
  mountIndex: number,
  immersionIndex: number,
  q: number,
): number {
  if (!(q >= 0)) throw new Error("depthOpdMm: the ray invariant q must be non-negative");
  if (!(q < mountIndex)) {
    throw new Error(
      `depthOpdMm: q = ${q} does not propagate in a mount of index ${mountIndex} — no ray of that invariant leaves the specimen`,
    );
  }
  if (!(q < immersionIndex)) {
    throw new Error(
      `depthOpdMm: q = ${q} does not propagate in immersion of index ${immersionIndex}`,
    );
  }
  return (
    depthMm *
    (Math.sqrt(mountIndex * mountIndex - q * q) - Math.sqrt(immersionIndex * immersionIndex - q * q))
  );
}

/**
 * The exact axial shift separating the two references above: how much farther
 * than its geometric depth the buried source's paraxial image lies.
 *
 *     δ = d·(n_i − n_s)/n_s
 *
 * Computed as `stackApparentDistanceMm` less the real depth rather than from that
 * formula, so the two cannot drift: it *is* § 6e.1's apparent distance, seen as a
 * displacement.
 *
 * Its practical name is the **focus-knob scaling**, and the direction inverts
 * easily, so both currencies: the objective travels δ + d = d·n_i/n_s per unit of
 * real depth — **1.1365 for oil into water** — so a z-stack indexed by knob
 * travel *overestimates* depth, and the correction multiplies nominal z by
 * n_s/n_i = **0.8799**. Paraxial; § 6l.5 measures the marginal ray's own ratio,
 * whose spread across the aperture IS the spherical aberration.
 */
export function depthFocusShiftMm(
  depthMm: number,
  mountIndex: number,
  immersionIndex: number,
): number {
  return (
    stackApparentDistanceMm([{ thicknessMm: depthMm, n: mountIndex }], immersionIndex) - depthMm
  );
}

/**
 * The paraxial depth scaling n_i/n_s — knob travel per unit of real depth.
 *
 * Multiply a nominal (knob-travel) z by its reciprocal to recover real depth.
 */
export const mountDepthScale = (mountIndex: number, immersionIndex: number): number =>
  immersionIndex / mountIndex;

/**
 * The largest numerical aperture a mount of index `mountIndex` can deliver into
 * an objective engraved for `objectiveNa`: min(NA, n_s), because q = n_s·sinθ_s.
 *
 * Not a tolerance and not an aberration — a ray of higher invariant does not
 * exist inside the specimen, so the pupil beyond it is dark. See the header.
 *
 * When the mount is the binding one this returns n_s, which is a **supremum and
 * not a maximum**: sinθ_s < 1 strictly, so the aperture is approached and never
 * reached. That is why it is the right number for a pupil mask — the boundary
 * point is one lattice point of measure zero — and the wrong one to hand to
 * `mountDepthTolerance`, which refuses it.
 */
export function deliveredNaIntoMount(objectiveNa: number, mountIndex: number): number {
  if (!(objectiveNa > 0)) throw new Error("deliveredNaIntoMount: NA must be positive");
  if (!(mountIndex > 0)) throw new Error("deliveredNaIntoMount: the mount index must be positive");
  return Math.min(objectiveNa, mountIndex);
}

export interface CoverslipTolerance {
  /**
   * Rayleigh's quarter wave: the peak third-order coefficient W₀₄₀ held to λ/4.
   * The criterion the classical microscopy tolerances are quoted under, and the
   * stricter of the two by 4×.
   */
  readonly quarterWaveMm: number;
  /**
   * Maréchal: the *balanced* residual — W₀₄₀ against its best-fit defocus, whose
   * RMS is W₀₄₀/(6√5) — held to λ/14, i.e. Strehl ≥ 0.8. Looser, because a
   * microscope's focus knob really does buy back most of the damage.
   */
  readonly marechalMm: number;
}

/**
 * How far a slip's thickness may stray from the one an objective was corrected
 * for, before the mismatch alone spends the whole error budget.
 *
 * Both criteria are on the *third-order* coefficient with the sine convention,
 * and both run as 1/NA⁴. `n` is the slip's index at this wavelength.
 */
export function coverslipTolerance(
  numericalAperture: number,
  wavelengthNm: number,
  n: number,
): CoverslipTolerance {
  if (!(numericalAperture > 0)) {
    throw new Error("coverslipTolerance: NA must be positive");
  }
  const lambdaMm = wavelengthNm * 1e-6;
  // Δt = W₀₄₀ · 8n³ / ((n²−1)·NA⁴) — plateW040Mm inverted, exact since it is
  // linear in thickness.
  const perW040 = (8 * n * n * n) / ((n * n - 1) * numericalAperture ** 4);
  return {
    quarterWaveMm: (lambdaMm / 4) * perW040,
    marechalMm: ((6 * Math.sqrt(5) * lambdaMm) / 14) * perW040,
  };
}

/**
 * How deep into a mismatched mount an objective may focus before the depth
 * aberration alone spends the whole error budget — `coverslipTolerance`'s
 * structure, with depth in place of slip thickness.
 *
 * Both criteria run on the third-order coefficient
 * W₀₄₀ = d·NA⁴·(n_s²−n_i²)/(8·n_s³·n_i²) and therefore as 1/NA⁴, exactly as the
 * slip's does — but with one difference that is the whole reason the two are
 * different steps: a slip error is a fixed one-off, and **depth grows without
 * bound**, so every mismatched mount has a depth past which no objective is
 * diffraction-limited.
 *
 * `numericalAperture` must be one the mount can deliver (see
 * `deliveredNaIntoMount`) — a budget quoted at an aperture whose rays do not
 * exist is a number about nothing, so it is refused rather than extrapolated.
 *
 * **This is a THIRD-ORDER readout, and against a mount it stops being a bound
 * much sooner than `coverslipTolerance` does.** Both are the W₀₄₀ coefficient's
 * budget, but a stack's exact wavefront departs from its own leading term as the
 * aperture approaches the *smallest* index in the stack — and for a mount that
 * index is the mount's, which is the smallest number anywhere in an immersion
 * system. Water under oil measures exact/third-order at 1.02 (NA 0.2), 1.94
 * (NA 1.0), 3.29 (NA 1.2), 5.79 (NA 1.3); a D263 slip in the same oil is at 2.50
 * only by NA 1.2, because 1.5254 is a long way from 1.2 and 1.3347 is not.
 *
 * What that costs is measured rather than estimated (§ 6l.4): against a Maréchal
 * depth **bisected on the traced Strehl**, this function over-reports by 1.25× at
 * NA 0.6, 1.91× at NA 0.9 and **4.51× at NA 1.2**, where it says 21.3 µm and the
 * real answer is 4.74 µm. It is kept in the third-order currency anyway — that is
 * the currency the literature's tolerances are quoted in and the one
 * `coverslipTolerance` uses, and a function that silently switched conventions
 * between the slip and the mount would be worse than one that names its own
 * departure. Quote it below NA ~0.9 and bisect above it.
 */
export function mountDepthTolerance(
  numericalAperture: number,
  wavelengthNm: number,
  mountIndex: number,
  immersionIndex: number,
): CoverslipTolerance {
  if (!(numericalAperture > 0)) throw new Error("mountDepthTolerance: NA must be positive");
  if (!(numericalAperture < mountIndex)) {
    throw new Error(
      `mountDepthTolerance: NA ${numericalAperture} is not delivered by a mount of index ${mountIndex} — no ray of that invariant leaves the specimen. The ceiling is ${mountIndex} and it is OPEN, since q = n_s·sinθ_s is strictly below n_s, so quote the budget at an aperture the mount actually carries rather than at the ceiling itself.`,
    );
  }
  if (mountIndex === immersionIndex) {
    throw new Error(
      "mountDepthTolerance: a matched mount aberrates identically zero at every depth — there is no budget to report",
    );
  }
  const lambdaMm = wavelengthNm * 1e-6;
  // d = W₀₄₀ · 8·n_s³·n_i² / (|n_s²−n_i²|·NA⁴) — the depth coefficient inverted,
  // exact because it is linear in depth.
  const perW040 =
    (8 * mountIndex ** 3 * immersionIndex * immersionIndex) /
    (Math.abs(mountIndex * mountIndex - immersionIndex * immersionIndex) * numericalAperture ** 4);
  return {
    quarterWaveMm: (lambdaMm / 4) * perW040,
    marechalMm: ((6 * Math.sqrt(5) * lambdaMm) / 14) * perW040,
  };
}
