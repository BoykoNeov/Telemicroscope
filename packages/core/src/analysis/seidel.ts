import { getMedium } from "../materials/catalog";
import { Prescription, unfoldedTwin } from "../trace/prescription";

/**
 * Third-order (Seidel) aberration sums S_I (spherical) and S_II (coma), from the
 * paraxial marginal and chief rays.
 *
 * This is a DESIGN tool, not an analysis readout. The engine already measures
 * aberration the honest way — trace rays, build the OPD map, fit Zernikes — and
 * that stays the ground truth. What the exact trace cannot do is *solve*: given a
 * doublet's two glasses and its total power, which bending makes the spherical
 * aberration vanish? Third-order theory answers that in closed form, which is how
 * every achromat since Fraunhofer has been laid out, and it is why this module
 * exists: `designs/achromat` solves S_I = 0 here and the trace then confirms the
 * result independently (docs/VALIDATION.md § 5j). Solving on the trace's own
 * residual instead would be fitting the design to the engine — the circularity the
 * project's hard rule forbids.
 *
 * ## The formulas (Welford, *Aberrations of Optical Systems*, ch. 8)
 *
 * For each surface, with the paraxial MARGINAL ray (y, u) and CHIEF ray (ȳ, ū)
 * incident, indices n → n′ and curvature c:
 *
 *     A  = n(y·c + u)          the marginal refraction invariant (n·i)
 *     Ā  = n(ȳ·c + ū)          the chief-ray one
 *     Δ(u/n) = u′/n′ − u/n
 *
 *     S_I  = −A²·y·Δ(u/n)      S_II = −A·Ā·y·Δ(u/n)
 *
 * Both are wavefront measures in the same units as the ray heights (mm here), for
 * a marginal ray launched at the pupil edge: the wavefront aberration is
 *
 *     W(ρ, θ) = (S_I/8)·ρ⁴ + (S_II/2)·ρ³·cos θ + …
 *
 * so `w040 = S_I/8` is the peak spherical-aberration wavefront error at the rim.
 *
 * ## Two external anchors pin this, and they are checked before anything is built
 * ## on it (test/seidel.test.ts)
 *
 *  - **A spherical mirror.** Collimated in, S_I/8 must come out h⁴/(4R³) — the
 *    number § 5g derived independently from the sphere-vs-paraboloid sag
 *    difference and pinned through the Schmidt corrector. It fixes the SCALE
 *    (the 1/8, the sign convention, the n′ = −n mirror handling).
 *  - **The thin lens in air**, whose third-order spherical aberration has a
 *    published closed form in Coddington's shape factor q = (c₁+c₂)/(c₁−c₂) and
 *    position factor p (Jenkins & White, *Fundamentals of Optics*; Hecht,
 *    *Optics* § 6.3), with p = −1 for an object at infinity:
 *
 *        W₀₄₀ = h⁴/(32·f³·n(n−1)) · [ (n+2)/(n−1)·q² + 4(n+1)·p·q
 *                                     + (3n+2)(n−1)·p² + n³/(n−1) ]
 *
 *    The sums reproduce this to 1e-8 across the shape range at two indices — the
 *    whole polynomial and its absolute scale, not one evaluation — and the
 *    residual falls linearly with the element's centre thickness, i.e. what is
 *    left is the honest thick-lens correction. Its corollaries come free: the
 *    best-form minimum at q = 2(n²−1)/(n+2) ≈ 0.71 at n = 1.5 (the steeply
 *    curved face toward the collimated beam), and a plano-convex singlet turned
 *    back-to-front carrying 27/7 ≈ 3.86× the spherical aberration.
 *
 * SCOPE, deliberately narrow — this module does one job for one caller:
 *
 *  - **Object at infinity only.** The marginal ray enters collimated (u = 0).
 *  - **Spherical surfaces only.** A conic or an even asphere adds its own
 *    third-order term, which is a *different* closed form; rather than carry an
 *    unpinned one, a non-zero conic or asphere throws. (The aspheric presets do
 *    not need this module: §§ 5g–5i figure their correctors from the sag
 *    difference directly.)
 *  - **S_II needs the stop at the first surface.** The chief ray is then simply
 *    (ȳ = 0, ū = θ) there, with no pupil solve; anywhere else it would need the
 *    stop imaged into object space, and no caller wants that yet — it throws.
 *  - S_III…S_V (astigmatism, field curvature, distortion) are not computed. The
 *    doublet solve needs S_I; S_II picks between its two roots. Nothing else is
 *    needed, and an unpinned formula is worse than an absent one.
 */

export interface SeidelOptions {
  /** Marginal ray height at the first surface (mm) — the pupil semi-diameter. */
  readonly marginalHeightMm: number;
  /**
   * Field angle for the chief ray (radians). 0 (default) leaves S_II identically
   * zero, which is the on-axis truth, not a missing value.
   */
  readonly fieldAngleRad?: number;
}

export interface SeidelSurfaceTerms {
  readonly s1: number;
  readonly s2: number;
}

export interface SeidelResult {
  /** Σ S_I — third-order spherical aberration (mm). */
  readonly s1: number;
  /** Σ S_II — third-order coma (mm), zero unless a field angle was given. */
  readonly s2: number;
  /** Wavefront spherical-aberration coefficient W₀₄₀ = S_I/8 (mm). */
  readonly w040: number;
  /** Per-surface contributions, in prescription order. */
  readonly surfaces: readonly SeidelSurfaceTerms[];
}

export function seidelSums(
  prescriptionIn: Prescription,
  wavelengthNm: number,
  opts: SeidelOptions,
): SeidelResult {
  const prescription = unfoldedTwin(prescriptionIn);
  const { marginalHeightMm, fieldAngleRad = 0 } = opts;
  if (!(marginalHeightMm > 0)) {
    throw new Error("seidelSums: marginal ray height must be positive");
  }
  if (fieldAngleRad !== 0) {
    const stop = prescription.surfaces.findIndex((s) => s.isStop);
    if (stop !== 0) {
      throw new Error("seidelSums: S_II needs the stop at the first surface");
    }
  }

  let n = getMedium(prescription.objectMedium ?? "AIR").n(wavelengthNm);
  // Marginal ray: collimated (object at infinity), entering at the pupil edge.
  let y = marginalHeightMm;
  let u = 0;
  // Chief ray: through the centre of the stop, which is the first surface.
  let yb = 0;
  let ub = fieldAngleRad;

  const surfaces: SeidelSurfaceTerms[] = [];
  let s1 = 0;
  let s2 = 0;

  for (const s of prescription.surfaces) {
    if ((s.conic ?? 0) !== 0 || (s.asphereCoeffs?.length ?? 0) > 0) {
      throw new Error("seidelSums: spherical surfaces only (a conic/asphere adds an uncomputed term)");
    }
    let n2: number;
    if (s.kind === "reflect") {
      n2 = -n;
    } else {
      if (!s.medium) throw new Error("seidelSums: refract surface needs a medium");
      n2 = Math.sign(n) * getMedium(s.medium).n(wavelengthNm);
    }
    const c = s.curvature;
    const phi = c * (n2 - n);

    const A = n * (y * c + u);
    const Ab = n * (yb * c + ub);
    const u2 = (n * u - y * phi) / n2;
    const ub2 = (n * ub - yb * phi) / n2;
    const dun = u2 / n2 - u / n;

    const termS1 = -A * A * y * dun;
    const termS2 = -A * Ab * y * dun;
    surfaces.push({ s1: termS1, s2: termS2 });
    s1 += termS1;
    s2 += termS2;

    // Transfer to the next vertex.
    y = y + u2 * s.thickness;
    yb = yb + ub2 * s.thickness;
    u = u2;
    ub = ub2;
    n = n2;
  }

  return { s1, s2, w040: s1 / 8, surfaces };
}
