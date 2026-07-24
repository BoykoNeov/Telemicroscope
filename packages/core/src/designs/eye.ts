import { Prescription } from "../trace/prescription";
import { getMedium } from "../materials/catalog";

/**
 * The reduced eye — Emsley's schematic model, the standard single-surface
 * stand-in for the human eye. One refracting surface of power ≈ 60 D separates
 * air from a vitreous of index n = 4/3, with the retina at the surface's own
 * paraxial focus. That is enough to close the visual chain: composed after a
 * telescope's eyepiece it turns the collimated exit beam back into a real
 * (retinal) image, so resolution and vignetting become readouts of a trace
 * rather than formulas (VALIDATION § 5q).
 *
 * Kept deliberately IDEAL — a single conic-free surface, diffraction-limited by
 * construction — so a rung on (telescope + eye) measures what the TELESCOPE
 * delivers to the retina, not the eye's own aberrations. Real ocular spherical
 * aberration at large pupils is a named deferral, not v1.
 *
 * Geometry, all derived from the two scalars (power F, index n) so nothing is
 * transcribed:
 *   - corneal radius        R  = (n − 1)/F           (≈ 5.55 mm at 60 D)
 *   - axial length / retina L  = n/F                 (≈ 22.2 mm) — the paraxial
 *                                                     focus, so infinity images
 *                                                     onto the retina
 *   - posterior nodal dist. PND = L − R = 1/F        (≈ 16.7 mm) — the nodal
 *     point of a single surface sits at its centre of curvature, so retinal
 *     image height is PND·tan θ, NOT L·tan θ (the standard conflation).
 *
 * The iris is at the corneal vertex (a reduced eye's stop is at its one
 * surface), so the pupil is both the aperture and the entrance pupil.
 */

/** Vitreous index — the eye's image space is not air. `WATER` (1.333) is it. */
const VITREOUS = "WATER";
/** Standard relaxed-eye power. */
const DEFAULT_POWER_DIOPTERS = 60;

export interface ReducedEyeSpec {
  /** Pupil diameter (mm). 2–3 mm photopic, up to ~7 mm fully dark-adapted. */
  readonly pupilDiameterMm: number;
  /** Total refracting power (diopters, 1/m). Defaults to the relaxed 60 D. */
  readonly powerDiopters?: number;
}

export interface ReducedEye {
  /** One surface + vitreous + retina at the paraxial focus, iris = pupil, isStop. */
  readonly prescription: Prescription;
  readonly pupilDiameterMm: number;
  readonly powerDiopters: number;
  /** Corneal radius of curvature (mm). */
  readonly cornealRadiusMm: number;
  /** Vertex → retina (mm) = the paraxial focus in the vitreous. */
  readonly axialLengthMm: number;
  /** Posterior nodal point → retina (mm): the lever for retinal image scale. */
  readonly posteriorNodalDistanceMm: number;
}

export function reducedEye(spec: ReducedEyeSpec): ReducedEye {
  const pupilDiameterMm = spec.pupilDiameterMm;
  const powerDiopters = spec.powerDiopters ?? DEFAULT_POWER_DIOPTERS;
  if (!(pupilDiameterMm > 0)) throw new Error("reducedEye: pupil diameter must be positive");
  if (!(powerDiopters > 0)) throw new Error("reducedEye: power must be positive");

  // Diopters are 1/m; geometry is in mm.
  const F = powerDiopters / 1000; // 1/mm
  const n = getMedium(VITREOUS).n(587.56); // constantIndex → wavelength-independent
  const cornealRadiusMm = (n - 1) / F;
  const axialLengthMm = n / F;
  const posteriorNodalDistanceMm = axialLengthMm - cornealRadiusMm; // = 1/F

  // IDEAL eye: the corneal surface is the Cartesian ellipsoid that images a
  // collimated axial beam stigmatically — eccentricity e = 1/n, so conic
  // K = −1/n². This nulls the single surface's spherical aberration for the
  // telescope's on-axis (collimated) output, so a (telescope + eye) rung
  // measures what the TELESCOPE delivers, not the eye's own SA. Real ocular
  // aberration at large pupils is the named deferral (§ 5q).
  const conic = -1 / (n * n);

  const prescription: Prescription = {
    surfaces: [
      {
        kind: "refract",
        curvature: 1 / cornealRadiusMm,
        conic,
        semiAperture: pupilDiameterMm / 2,
        thickness: axialLengthMm, // to the retina (the image plane)
        medium: VITREOUS,
        isStop: true,
      },
    ],
  };

  return {
    prescription,
    pupilDiameterMm,
    powerDiopters,
    cornealRadiusMm,
    axialLengthMm,
    posteriorNodalDistanceMm,
  };
}
