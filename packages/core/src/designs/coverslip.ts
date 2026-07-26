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
 * `airGapMm` of air in front of the objective's first vertex.
 *
 * Only one surface, because the specimen sits ON the lower face — the light
 * starts inside the glass, so the prescription carrying this must declare the
 * slip as its `objectMedium` and put the object a slip-thickness in front.
 * Unbounded: a 22 mm square cover glass is never the aperture.
 *
 * Takes no `Coverslip`, deliberately: the slip's own glass is the *object*
 * medium and everything about this face is a property of what comes AFTER it,
 * which for a dry objective is air. An immersion front would put a medium there
 * and want the argument back.
 */
export function coverslipSurface(airGapMm: number): SurfaceSpec {
  return {
    kind: "refract",
    curvature: 0,
    semiAperture: Infinity,
    thickness: airGapMm,
    medium: "AIR",
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
