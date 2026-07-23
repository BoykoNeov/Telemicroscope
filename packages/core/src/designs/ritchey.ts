import { Prescription } from "../trace/prescription";
import { twoMirrorLayout, TwoMirrorSpec } from "./two-mirror";

/**
 * The Ritchey-Chrétien: a Cassegrain-form two-mirror telescope in which BOTH
 * mirrors are hyperboloids, their conics chosen so the system is *aplanatic* —
 * free of third-order coma AND spherical aberration. It is the third reflecting
 * preset and the coma-nulled sibling of the classical Cassegrain (§ 5e): same
 * aperture, focal length, magnification, separations and radii — every layout
 * number is shared through `twoMirrorLayout` — differing ONLY in the two conic
 * constants. That is the textbook fact this preset is built on, and it is why
 * the two cannot drift apart.
 *
 * ## The pin: aplanatism (coma null), and what it is NOT
 *
 * The classical Cassegrain's headline rung is EXACT on-axis stigmatism — its
 * confocal conics image the axial point perfectly to all orders. The RC does
 * *less on axis and more off it*: it corrects spherical aberration only to
 * **third order**, so on axis it carries a residual fifth-order spherical error
 * (small — still diffraction-limited — but not the Cassegrain's ~1e-10), and in
 * exchange it nulls third-order **coma**, which the classical Cassegrain leaves
 * at full strength. Coma is the aberration that limits a fast reflector's usable
 * field, so nulling it is the RC's entire reason to exist (and why nearly every
 * large professional telescope is one). Residual astigmatism and field curvature
 * remain — the RC targets coma specifically, not every off-axis term.
 *
 * ## The conic constants (Wikipedia, "Ritchey–Chrétien telescope")
 *
 * With m the secondary magnification, d the mirror separation and s₂ = d + b the
 * secondary→focus distance (Wikipedia's M, D and B respectively — note **B is
 * secondary→focus, s₂, not the primary back focus b**):
 *
 *     K₁ = −1 − (2/m³)·(s₂/d)
 *     K₂ = −1 − (2/(m−1)³)·[m(2m−1) + s₂/d]
 *
 * Both are < −1 (m > 1), so both mirrors are hyperboloids: the primary a mild
 * one just past parabolic (≈ −1.11 for a 2400 mm f/12), the secondary stronger
 * than the classical Cassegrain's (≈ −5.12 against −4). The layout — the paraxial
 * radii and separations — is identical to the Cassegrain's; only these conics move.
 *
 * SCOPE. As for the Cassegrain (§ 5e): the primary's central hole is obstruction
 * bookkeeping, not a traced blocker; the secondary is circular and on-axis, so
 * off-axis vignetting by it is unpinned; astigmatism and field curvature are in
 * the trace but unpinned. All are recorded in docs/VALIDATION.md § 5f.
 */

/** The Ritchey-Chrétien shares the Cassegrain-form layout (see two-mirror.ts). */
export type RitcheyChretienSpec = TwoMirrorSpec;

export interface RitcheyChretien {
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
  /** Secondary radius of curvature magnitude (mm). */
  readonly secondaryRadiusMm: number;
  /** Primary conic — a mild hyperboloid, just past parabolic (< −1). */
  readonly primaryConic: number;
  /** Secondary conic — a hyperboloid stronger than the classical Cassegrain's (< −1). */
  readonly secondaryConic: number;
  /**
   * Central obstruction as a fraction of the pupil RADIUS — the spelling `psf()`
   * and the geometric branch both take.
   */
  readonly obstruction: number;
}

export function ritcheyChretien(spec: RitcheyChretienSpec): RitcheyChretien {
  const L = twoMirrorLayout(spec, "ritcheyChretien");
  const { secondaryMagnification: m, primarySeparationMm: d, backFocusMm: b } = L;

  // The aplanatic conics. B/D uses s₂ = d + b (secondary→focus), NOT the
  // primary back focus b: swapping them corrupts the whole design and still
  // typechecks, so the value is named explicitly and the on-axis + coma rungs
  // are its runtime guard.
  const s2OverD = L.secondaryToFocusMm / d;
  const k1 = -1 - (2 / m ** 3) * s2OverD;
  const k2 = -1 - (2 / (m - 1) ** 3) * (m * (2 * m - 1) + s2OverD);

  return {
    prescription: {
      surfaces: [
        {
          // Concave hyperboloidal primary (mild): centre of curvature at −z, so
          // R₁ = −2f₁; the conic k₁ < −1 is what nulls third-order coma.
          kind: "reflect",
          curvature: L.primaryCurvature,
          conic: k1,
          semiAperture: L.apertureMm / 2,
          thickness: -d, // secondary sits d back down the returning beam (−z)
          isStop: true,
        },
        {
          // Convex hyperboloidal secondary facing the incoming (−z) beam: centre
          // of curvature also at −z, so R₂ is negative in this frame.
          kind: "reflect",
          curvature: -1 / L.secondaryRadiusMm,
          conic: k2,
          semiAperture: L.secondaryClearRadiusMm,
          thickness: d + b, // forward (+z) to the RC focus, b behind the primary
        },
      ],
    },
    focalLengthMm: L.focalLengthMm,
    primaryFocalLengthMm: L.primaryFocalLengthMm,
    secondaryMagnification: m,
    primarySeparationMm: d,
    backFocusMm: b,
    secondaryRadiusMm: L.secondaryRadiusMm,
    primaryConic: k1,
    secondaryConic: k2,
    obstruction: L.obstruction,
  };
}
