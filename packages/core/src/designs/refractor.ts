import { N_BK7, F2 } from "../materials/catalog";
import { abbeNumber, indexD } from "../materials/dispersion";
import { Prescription } from "../trace/prescription";

/**
 * Two refractors that differ in exactly one respect: whether the colours land
 * together.
 *
 * This pair is the step-4 hero. It is deliberately *computed from the glass
 * catalog* rather than transcribed from a design table, so the achromat is
 * achromatic because the Abbe numbers say so and for no other reason — which
 * is the claim the milestone makes. Change N-BK7's Sellmeier coefficients and
 * the doublet stops working; that is the point.
 *
 * Thin-lens achromatic condition, for a cemented pair of total power φ:
 *
 *     φ₁ = φ·V₁/(V₁ − V₂),   φ₂ = −φ·V₂/(V₁ − V₂)
 *
 * which makes dφ/dλ vanish between the F and C lines. The elements are given
 * real thickness, so the result carries a genuine (small) chromatic residual:
 * the thin-lens design is only exactly achromatic in the thin-lens limit, and
 * pretending otherwise would make the achromat look better than one is.
 *
 * These prescriptions are pinned by the step-1 rungs in `physics.test.ts` —
 * F−C shift ≫ for the singlet, ≈ f/V for the singlet, EFL preserved for the
 * doublet — so anything built on them starts from validated optics. They live
 * in `src` rather than in a test file precisely so that the hero image and the
 * rungs cannot drift apart.
 *
 * SCOPE. A design, not a preset. The eyepiece/objective libraries of step 5
 * come from published patent prescriptions and belong in their own catalog;
 * this is one worked example whose purpose is to make a physical effect
 * visible.
 */

export interface RefractorPair {
  /** BK7/F2 cemented doublet: the colours land together. */
  readonly achromat: Prescription;
  /** Equiconvex BK7 singlet of the same power: they do not. */
  readonly singlet: Prescription;
}

/**
 * A thin-lens achromat and its uncorrected counterpart.
 *
 * `backFocus` is the last surface's thickness — where the prescription itself
 * says the image lands. A focus solve normally replaces it, but it has to be
 * *something* for the prescription to be complete.
 */
export function refractorPair(
  focalLengthMm: number,
  semiApertureMm: number,
  backFocusMm = focalLengthMm,
): RefractorPair {
  const phi = 1 / focalLengthMm;
  const V1 = abbeNumber(N_BK7);
  const V2 = abbeNumber(F2);
  const n1 = indexD(N_BK7);
  const n2 = indexD(F2);

  const phi1 = (phi * V1) / (V1 - V2);
  const phi2 = (-phi * V2) / (V1 - V2);
  const R1 = (2 * (n1 - 1)) / phi1; // equiconvex crown, so R2 = −R1
  const R2 = -R1;
  const R3 = 1 / (1 / R2 - phi2 / (n2 - 1));

  const achromat: Prescription = {
    surfaces: [
      { kind: "refract", curvature: 1 / R1, semiAperture: semiApertureMm, thickness: 3, medium: "N-BK7", isStop: true },
      { kind: "refract", curvature: 1 / R2, semiAperture: semiApertureMm, thickness: 1.5, medium: "F2" },
      { kind: "refract", curvature: 1 / R3, semiAperture: semiApertureMm, thickness: backFocusMm, medium: "AIR" },
    ],
  };

  const Rs = (2 * (n1 - 1)) / phi; // equiconvex singlet of the same power
  const singlet: Prescription = {
    surfaces: [
      { kind: "refract", curvature: 1 / Rs, semiAperture: semiApertureMm, thickness: 5, medium: "N-BK7", isStop: true },
      { kind: "refract", curvature: -1 / Rs, semiAperture: semiApertureMm, thickness: backFocusMm, medium: "AIR" },
    ],
  };

  return { achromat, singlet };
}
