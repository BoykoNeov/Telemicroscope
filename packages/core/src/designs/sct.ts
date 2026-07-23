import { Prescription } from "../trace/prescription";
import { getMedium } from "../materials/catalog";
import { twoMirrorLayout, TwoMirrorSpec } from "./two-mirror";

/**
 * The all-spherical Schmidt-Cassegrain (the Celestron/Meade-class SCT sold by the
 * hundred thousand): TWO spherical mirrors — the cheapest optics there are — and a
 * single aspheric corrector plate at the primary's centre of curvature, figured to
 * null the *combined* spherical aberration of BOTH spheres. It is the sixth
 * reflecting preset, and the one the roadmap held back until a closed form for the
 * two-mirror corrector was in hand.
 *
 * ## What this pins, and how a real commercial tube departs from it
 *
 * This transcribes the *third-order closed form* with the corrector at the
 * primary's centre of curvature — the pinnable idealization the roadmap named. A
 * real Celestron/Meade tube departs in two ways, both trading the clean number for
 * a shorter tube: it shifts the corrector forward of the CoC (reintroducing coma,
 * an optimization compromise), and it optimizes the corrector figure beyond third
 * order into a proprietary surface with no external number — the tension
 * `cassegrain.ts` records. Keeping the corrector at the CoC and the figure at the
 * third-order Seidel closed form is what makes every number here external; the
 * price is an honest fifth-order residual, pinned as such below.
 *
 * ## How this differs from the Schmidt-Cassegrain (§ 5h) — read before extending
 *
 * `schmidt-cassegrain.ts` is a *Schmidt-corrected Cassegrain*: spherical primary
 * + Schmidt corrector (nulling the primary alone) + a confocal HYPERBOLOID
 * secondary that relays the corrected beam stigmatically. This preset is the
 * genuinely-commercial variant: the secondary is a **sphere** too (conic 0), and
 * the single corrector is figured to cancel what the hyperboloid used to. The
 * manufacturing story is the whole point — two spheres and one plate, no aspheric
 * mirror anywhere — and it is why the number was worth chasing.
 *
 * ## The corrector figure — the two-mirror Seidel corrector (the external pin)
 *
 * The corrector adds an r⁴ optical-path figure (n−1)·A₄·r⁴ that must cancel the
 * sum of the two spheres' third-order spherical aberration, each referenced to
 * the entrance pupil (Schroeder, *Astronomical Optics* Ch. 6; Rutten & van
 * Venrooij, *Telescope Optics*). Third-order SA is exactly linear in each mirror's
 * conic, so the sum decomposes cleanly:
 *
 *  - **Primary sphere.** Beam height r (full aperture). A sphere carries
 *    r⁴/(4R₁³) of SA against the paraboloid — the Schmidt camera's term (§ 5g).
 *
 *  - **Secondary sphere.** Beam height ε·r, where ε = s₁/f₁ is the obstruction
 *    fraction (the beam has shrunk to that radius by the secondary). The confocal
 *    hyperboloid the classical Cassegrain uses has conic k₂ = −((m+1)/(m−1))²
 *    and exactly cancels this sphere's SA, so the sphere's own contribution is
 *    the negative of that conic's r⁴ figure: +k₂·ε⁴·r⁴/(4R₂³). Since k₂ < 0 this
 *    is NEGATIVE — a convex secondary is *over*-corrected, opposite in sense to
 *    the concave primary's under-correction.
 *
 * The two spheres therefore PARTIALLY CANCEL, and the corrector that nets them
 * out is *weaker* than the primary-only Schmidt corrector:
 *
 *     (n−1)·A₄ = −1/(4R₁³) − k₂·ε⁴/(4R₂³)              [k₂ = −((m+1)/(m−1))²]
 *              = −1/(4R₁³) + ((m+1)/(m−1))²·ε⁴/(4R₂³)
 *
 * i.e. A₄ = A₄(Schmidt, primary-only) · (1 − |k₂|·ε⁴·(R₁/R₂)³), a fraction of the
 * Schmidt figure (≈ 0.8 on a fast commercial SCT). Signed thickest at the rim,
 * like every Schmidt corrector.
 *
 * ## Why the secondary term is subtractive — the sign is sourced, not fitted
 *
 * The one load-bearing sign here is whether the secondary term adds to or
 * subtracts from the primary's. It is fixed by an EXTERNAL datum, not by the
 * trace: the **Dall-Kirkham** telescope (spherical secondary, aspheric primary,
 * no corrector) has a *prolate ellipsoid* primary, conic ≈ −0.7 — LESS aspheric
 * than a paraboloid. With the Schmidt-validated calibration that a primary conic
 * K contributes +K/(4R₁³), a Dall-Kirkham nulls when (1+K₁)/(4R₁³) + W_s = 0, so
 * K₁ > −1 forces the spherical secondary's SA W_s < 0. The convex secondary
 * over-corrects; the corrector does less work, not more. The trace only CONFIRMS
 * this; it never chose it (docs/VALIDATION.md § 5i).
 *
 * ## On axis it is diffraction-limited, NOT exactly stigmatic; and it is NOT an
 * anastigmat
 *
 * Two scope limits inherited from the physics, both pinned as such:
 *
 *  - Like the Schmidt camera and the Schmidt-Cassegrain, the corrector nulls only
 *    the THIRD-order SA; a fifth-order residual survives (it grows as the primary
 *    speeds up), so the on-axis rung is "diffraction-limited and a large factor
 *    better than the corrector-removed system", never "Strehl = 1" — that is the
 *    confocal Cassegrain's property alone (§ 5e).
 *  - Unlike the single-mirror Schmidt *camera* (§ 5g), this is **not** an
 *    anastigmat. The corrector sits at the PRIMARY's centre of curvature, but the
 *    secondary sees the field asymmetrically, so third-order coma and astigmatism
 *    remain — the off-axis softness commercial SCTs are known for. Those terms are
 *    present in the trace and unpinned here, exactly as for the Schmidt-Cassegrain.
 *
 * ## Geometry (all magnitudes; engine signs applied at the end)
 *
 *     corrector front   z = 0                 (stop, at the primary's CoC)
 *     corrector back    z = plateThickness
 *     primary vertex    z = R₁ = 2f₁          (SPHERE, concave toward −z)
 *     secondary vertex  z = R₁ − d            (SPHERE, convex toward −z)
 *     focus             z = R₁ + b            (b behind the primary vertex)
 *
 * SCOPE. As for the Cassegrain/Schmidt-Cassegrain: the primary's central hole and
 * the secondary's obstruction are pupil-function bookkeeping, not traced blockers;
 * the curved (Petzval) focal surface is unpinned (rungs measure by Zernike
 * coefficient at best focus); off-axis coma/astigmatism are traced but unpinned.
 * The mirrors are sized for the ON-AXIS beam, so off-axis pencils vignette as a
 * sizing artifact, not physics — a shared, app-driven deferral across all the
 * two-mirror presets. Every rung here runs on axis. Recorded in
 * docs/VALIDATION.md § 5i.
 */
export interface CommercialSctSpec extends TwoMirrorSpec {
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
}

export interface CommercialSct {
  readonly prescription: Prescription;
  /** System effective focal length (mm) = m·f₁ = D·F. */
  readonly focalLengthMm: number;
  /** Primary focal length (mm) = D·F₁. */
  readonly primaryFocalLengthMm: number;
  /** Secondary transverse magnification m = F/F₁. */
  readonly secondaryMagnification: number;
  /** Primary vertex → secondary vertex, along the axis (mm). */
  readonly primarySeparationMm: number;
  /** Back focal distance (mm), echoed since the default is computed. */
  readonly backFocusMm: number;
  /** Spherical primary radius of curvature magnitude (mm) = 2·f₁ — the R the corrector's primary term is figured to. */
  readonly primaryRadiusMm: number;
  /** Corrector → primary vertex separation (mm) = R₁, since the corrector sits at the CoC. */
  readonly correctorToPrimaryMm: number;
  /** Spherical secondary radius of curvature magnitude (mm). */
  readonly secondaryRadiusMm: number;
  /**
   * Combined two-mirror even-asphere coefficient A₄ of the corrector front face
   * (mm⁻³), signed. Nets the primary and (over-corrected) secondary spheres.
   */
  readonly correctorA4: number;
  /**
   * The primary-ONLY Schmidt figure −1/(4(n−1)R₁³) (mm⁻³), echoed so the
   * secondary's subtractive contribution `correctorA4 − primaryOnlyA4` is legible
   * — the ΔA₄ the all-spherical secondary buys back.
   */
  readonly primaryOnlyA4: number;
  /** Corrector index at the design wavelength — the n that fixes A₄. */
  readonly correctorIndex: number;
  /** Corrector glass name, echoed since it defaults. */
  readonly correctorMedium: string;
  /** Design wavelength (nm), echoed since it defaults. */
  readonly designWavelengthNm: number;
  /** Corrector plate thickness (mm), echoed since it defaults. */
  readonly plateThicknessMm: number;
  /**
   * Central obstruction as a fraction of the pupil RADIUS — the spelling `psf()`
   * and the geometric branch both take.
   */
  readonly obstruction: number;
}

export function commercialSct(spec: CommercialSctSpec): CommercialSct {
  const L = twoMirrorLayout(spec, "commercialSct");
  const { secondaryMagnification: m, primarySeparationMm: d, backFocusMm: b } = L;
  const D = L.apertureMm;

  // Both mirrors are SPHERES (conic 0). The primary radius R₁ = 2f₁ is what the
  // corrector's primary term is figured to; R₂ is the secondary's.
  const R1 = 2 * L.primaryFocalLengthMm;
  const R2 = L.secondaryRadiusMm;
  const eps = L.obstruction; // = s₁/f₁, the fractional beam height at the secondary

  const designWavelengthNm = spec.designWavelengthNm ?? 550;
  const correctorMedium = spec.correctorMedium ?? "FUSED-SILICA";
  const n = getMedium(correctorMedium).n(designWavelengthNm);
  if (!(n > 1)) {
    throw new Error(`commercialSct: corrector medium ${correctorMedium} must have index > 1`);
  }

  // The two-mirror Seidel corrector (see the file header). |k₂| is the confocal
  // hyperboloid magnitude — used here only as the closed-form strength of the
  // secondary sphere's SA, NOT applied to the mirror (which stays a sphere).
  const k2mag = ((m + 1) / (m - 1)) ** 2;
  const primaryOnlyA4 = -1 / (4 * (n - 1) * R1 ** 3); // the Schmidt figure (§ 5g)
  // The secondary sphere is over-corrected, so its term REDUCES the corrector's
  // magnitude — the all-spherical corrector is weaker than the primary-only one.
  const secondaryA4 = (k2mag * eps ** 4) / (4 * (n - 1) * R2 ** 3);
  const A4 = primaryOnlyA4 + secondaryA4;

  const plateThicknessMm = spec.plateThicknessMm ?? 0.01 * D;
  if (!(plateThicknessMm > 0) || !(plateThicknessMm < R1)) {
    throw new Error(`commercialSct: plate thickness ${plateThicknessMm} mm must be positive and thinner than R₁`);
  }

  // The corrector glass and both mirrors overfill their clear aperture by a hair:
  // the aspheric plate refracts the marginal ray slightly, so the traced surfaces
  // after it run a touch wider than D/2 to keep the pupil's own rim ring from
  // being numerically shaved — the Schmidt analogue of sizing to the sag-exact
  // footprint. It moves no ray inside the pupil. NOTE: the clear aperture (the
  // pupil) is D/2 as set by the system's *stop-radius* aperture spec, NOT this
  // glass edge; drive this preset with `{ kind: "stopRadius", value: D/2 }` (as
  // the rungs do), since an `fNumber`/`EPD` spec would read the oversized surface.
  const correctorClearRadius = (D / 2) * 1.02;
  const primaryClearRadius = (D / 2) * 1.02;
  // The secondary carries the same extra margin beyond the bare Cassegrain cone:
  // the corrector refracts the marginal ray outward, so it reaches the secondary
  // slightly wider than `twoMirrorLayout`'s sag-exact footprint (which assumes the
  // ray leaves the primary rim at D/2). This corrector is weaker than the
  // Schmidt-Cassegrain's, so it bends the ray LESS; the 1.02 that clears that one
  // clears this one with more headroom. The reported `obstruction` stays the clean
  // paraxial ε; only the physical clear aperture grows.
  const secondaryClearRadius = L.secondaryClearRadiusMm * 1.02;

  return {
    prescription: {
      surfaces: [
        {
          // Corrector front: the aspheric face, at the primary's centre of
          // curvature (z = 0), which is also the stop. Flat base; the combined
          // r⁴ figure is the whole correction.
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
          // beam, so it adds only a focus shift best-focus absorbs. On to the
          // primary at z = R₁.
          kind: "refract",
          curvature: 0,
          semiAperture: correctorClearRadius,
          thickness: R1 - plateThicknessMm,
          medium: "AIR",
        },
        {
          // Spherical primary at z = R₁: concave toward the incoming +z beam, so
          // its centre of curvature is at −z (the stop), curvature −1/R₁. Conic
          // 0 — a sphere.
          kind: "reflect",
          curvature: L.primaryCurvature, // = −1/(2f₁) = −1/R₁
          conic: 0,
          semiAperture: primaryClearRadius,
          thickness: -d, // secondary sits d back down the returning beam (−z)
        },
        {
          // Convex SPHERICAL secondary facing the incoming (−z) beam: centre of
          // curvature also at −z, so R₂ is negative in this frame. Conic 0 — a
          // sphere; the corrector, not a figured secondary, closes the design.
          kind: "reflect",
          curvature: -1 / R2,
          conic: 0,
          semiAperture: secondaryClearRadius,
          thickness: d + b, // forward (+z) to the SCT focus, b behind the primary
        },
      ],
    },
    focalLengthMm: L.focalLengthMm,
    primaryFocalLengthMm: L.primaryFocalLengthMm,
    secondaryMagnification: m,
    primarySeparationMm: d,
    backFocusMm: b,
    primaryRadiusMm: R1,
    correctorToPrimaryMm: R1,
    secondaryRadiusMm: R2,
    correctorA4: A4,
    primaryOnlyA4,
    correctorIndex: n,
    correctorMedium,
    designWavelengthNm,
    plateThicknessMm,
    obstruction: L.obstruction,
  };
}
