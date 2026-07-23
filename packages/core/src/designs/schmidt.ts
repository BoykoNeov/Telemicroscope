import { Prescription } from "../trace/prescription";
import { getMedium } from "../materials/catalog";

/**
 * The Schmidt camera: a spherical primary mirror with an aspheric corrector
 * plate at its centre of curvature. It is the fourth reflecting preset and the
 * first to USE the engine's even-asphere path for physics rather than for a
 * round-trip geometry test — the aspheric corrector figure is a closed-form
 * textbook number, which is exactly why the roadmap names a Schmidt camera (and
 * not a commercial SCT) as the clean external pin for aspheric correction.
 *
 * ## Why a Schmidt camera, and not the SCT
 *
 * A Schmidt-Cassegrain's corrector is an OPTIMISED, proprietary surface with no
 * external number to pin it to. The Schmidt camera's corrector has its figure in
 * closed form, because the design is defined by a geometric idea rather than an
 * optimisation:
 *
 *  - The primary is a **sphere**, the cheapest mirror there is. A sphere has
 *    spherical aberration; a paraboloid of the same vertex radius does not.
 *  - The aperture stop sits at the mirror's **centre of curvature**, a distance
 *    R in front of it. From the stop every field angle sees the mirror down a
 *    radius, so the system has no preferred axis: third-order **coma and
 *    astigmatism vanish by symmetry**. The Schmidt is an anastigmat, and that —
 *    not the on-axis figure — is its reason to exist. Its wide flat(ish) field
 *    is why Schmidt cameras shot the great photographic sky surveys.
 *  - A thin **aspheric corrector plate** at the stop nulls the sphere's
 *    spherical aberration, and nothing else needs correcting.
 *
 * ## The corrector figure — the pin (Rutten & van Venrooij; Schroeder)
 *
 * A sphere and the paraboloid of the same vertex radius R differ in sag by
 * r⁴/(8R³) to leading order (the sphere is deeper at the edge). On reflection a
 * surface-height error doubles into wavefront error, so a spherical mirror
 * carries r⁴/(4R³) of spherical aberration against the perfect paraboloid. A
 * glass plate of index n retards the wavefront by (n−1) per unit thickness, so a
 * plate whose thickness varies as r⁴ cancels that error when
 *
 *     (n−1)·A₄·r⁴  =  −r⁴/(4R³)      ⇒      A₄ = −1/(4·(n−1)·R³)
 *
 * with A₄ the even-asphere coefficient of the plate's front face (curvature 0,
 * conic 0). The sign puts more glass at the edge — the corrector is thickest at
 * the rim, thinnest on axis for this pure-r⁴ figure. The magnitude is *the*
 * external number this preset pins: computed here from the scalars n and R, and
 * checked against the trace's residual wavefront in docs/VALIDATION.md § 5g.
 *
 * Because the object is at infinity, the beam between the corrector (at the
 * centre of curvature) and the mirror is collimated: an on-axis ray keeps its
 * height from plate to mirror, so the r⁴ figure derived at the mirror applies
 * unchanged at the plate. n is dispersive, so A₄ is evaluated at a design
 * wavelength; away from it the correction drifts — the Schmidt's residual
 * **spherochromatism** — which the trace shows for free at other wavelengths.
 *
 * ## It is 3rd-order corrected, NOT exactly stigmatic
 *
 * Unlike the classical Cassegrain (§ 5e), whose confocal conics are stigmatic on
 * axis to numerical precision, the Schmidt corrector nulls only the THIRD-order
 * spherical aberration. A 5th-order residual remains (it grows as 1/F⁵), so the
 * on-axis rung is not "Strehl = 1" but "diffraction-limited, and a large factor
 * better than the bare sphere". At the moderate focal ratios this preset targets
 * that residual is a few hundredths of a wave; a fast Schmidt is a separate,
 * honest story, not this headline.
 *
 * SCOPE. Deferred and recorded in docs/VALIDATION.md § 5g: the neutral-zone r²
 * term (a chromatic/defocus rebalance, irrelevant to the monochromatic 3rd-order
 * null); the curved (Petzval) focal surface — the Schmidt images onto a sphere,
 * and the rungs measure aberration by Zernike coefficient at best focus so the
 * field-curvature defocus does not contaminate them; and the prime-focus
 * obstruction — the detector sits in the beam, between corrector and mirror, and
 * is bookkeeping applied in the pupil function, not a traced blocker.
 */

export interface SchmidtSpec {
  /** Clear aperture of the corrector / entrance pupil (mm). */
  readonly apertureMm: number;
  /** Focal ratio f/D, with f = R/2 the spherical mirror's focal length. */
  readonly focalRatio: number;
  /**
   * Corrector glass (catalog name). Dispersive by default, so spherochromatism
   * emerges from the trace. Its index at `designWavelengthNm` fixes A₄.
   */
  readonly correctorMedium?: string;
  /** Wavelength (nm) the corrector is figured for. Default 550. */
  readonly designWavelengthNm?: number;
  /**
   * Corrector plate axial thickness (mm). A mechanical number: a plane-parallel
   * plate in the collimated beam is aberration-neutral, shifting focus only.
   * Default 0.01·D — thin, as a corrector is.
   */
  readonly plateThicknessMm?: number;
  /**
   * Half-field the mirror is sized to pass unvignetted (degrees). Off-axis
   * pencils walk across the mirror by R·tan θ, so a real Schmidt mirror is
   * oversized; this sets by how much. Default 0.5°.
   */
  readonly maxFieldDeg?: number;
}

export interface Schmidt {
  readonly prescription: Prescription;
  /** System focal length (mm) = R/2 = D·F. */
  readonly focalLengthMm: number;
  /** Spherical mirror radius of curvature magnitude (mm) = 2·f. */
  readonly mirrorRadiusMm: number;
  /** Even-asphere coefficient A₄ of the corrector front face (mm⁻³), signed. */
  readonly correctorA4: number;
  /** Corrector index at the design wavelength — the n that fixes A₄. */
  readonly correctorIndex: number;
  /** Corrector glass name, echoed since it defaults. */
  readonly correctorMedium: string;
  /** Design wavelength (nm), echoed since it defaults. */
  readonly designWavelengthNm: number;
  /** Corrector plate thickness (mm), echoed since it defaults. */
  readonly plateThicknessMm: number;
}

export function schmidt(spec: SchmidtSpec): Schmidt {
  const D = spec.apertureMm;
  const F = spec.focalRatio;
  if (!(D > 0) || !(F > 0)) {
    throw new Error("schmidt: aperture and focal ratio must be positive");
  }

  const f = D * F; // mirror focal length
  const R = 2 * f; // mirror radius of curvature (magnitude)
  const designWavelengthNm = spec.designWavelengthNm ?? 550;
  const correctorMedium = spec.correctorMedium ?? "FUSED-SILICA";
  const n = getMedium(correctorMedium).n(designWavelengthNm);
  if (!(n > 1)) {
    throw new Error(`schmidt: corrector medium ${correctorMedium} must have index > 1`);
  }
  const plateThicknessMm = spec.plateThicknessMm ?? 0.01 * D;
  if (!(plateThicknessMm > 0) || !(plateThicknessMm < R)) {
    throw new Error(`schmidt: plate thickness ${plateThicknessMm} mm must be positive and thinner than R`);
  }

  // The corrector figure: thickest at the rim, cancelling the sphere's SA.
  const A4 = -1 / (4 * (n - 1) * R ** 3);

  // The corrector glass overfills its clear aperture by a hair: the traced glass
  // runs a touch wider than D/2 so the pupil's own rim ring is not numerically
  // shaved at this aspheric surface — the Schmidt analogue of sizing the
  // Cassegrain secondary to its sag-exact footprint rather than the paraxial
  // cone. It moves no ray inside the pupil. NOTE: the clear aperture (the pupil)
  // is D/2 as set by the system's *stop-radius* aperture spec, NOT this glass
  // edge; a consumer resolving the stop from an `fNumber`/`EPD` spec instead
  // would read this oversized surface and get a 2%-large pupil, so drive this
  // preset with `{ kind: "stopRadius", value: D/2 }` (as the rungs do).
  const correctorClearRadius = (D / 2) * 1.02;

  // Oversize the mirror so off-axis pencils (which shift by R·tan θ, and whose
  // own half-width is (D/2)/cos θ) clear it out to the sized half-field.
  const maxFieldDeg = spec.maxFieldDeg ?? 0.5;
  const maxFieldRad = (maxFieldDeg * Math.PI) / 180;
  const mirrorClearRadius = (D / 2 / Math.cos(maxFieldRad) + R * Math.tan(maxFieldRad)) * 1.02;

  return {
    prescription: {
      surfaces: [
        {
          // Corrector front: the aspheric face, at the mirror's centre of
          // curvature (z = 0), which is also the stop. Flat base (curvature 0,
          // conic 0); the r⁴ figure is the whole correction.
          kind: "refract",
          curvature: 0,
          asphereCoeffs: [A4],
          semiAperture: correctorClearRadius,
          thickness: plateThicknessMm,
          medium: correctorMedium,
          isStop: true,
        },
        {
          // Corrector back: flat, into air. Plane-parallel in the collimated
          // beam, so it adds only a focus shift best-focus absorbs.
          kind: "refract",
          curvature: 0,
          semiAperture: correctorClearRadius,
          thickness: R - plateThicknessMm, // on to the mirror at z = R
          medium: "AIR",
        },
        {
          // Spherical primary: concave toward the incoming +z beam, so its
          // centre of curvature is at −z (the stop), R₁ = −R, curvature −1/R.
          // Conic 0 — a sphere; the corrector, not the figure, kills the SA.
          kind: "reflect",
          curvature: -1 / R,
          conic: 0,
          semiAperture: mirrorClearRadius,
          thickness: -f, // back to prime focus, R/2 in front of the mirror
        },
      ],
    },
    focalLengthMm: f,
    mirrorRadiusMm: R,
    correctorA4: A4,
    correctorIndex: n,
    correctorMedium,
    designWavelengthNm,
    plateThicknessMm,
  };
}
