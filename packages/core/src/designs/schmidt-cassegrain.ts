import { Prescription } from "../trace/prescription";
import { getMedium } from "../materials/catalog";
import { twoMirrorLayout, TwoMirrorSpec } from "./two-mirror";

/**
 * The Schmidt-Cassegrain: a Cassegrain-form two-mirror telescope whose spherical
 * primary is corrected by a Schmidt aspheric plate at its centre of curvature,
 * with a convex confocal-hyperboloid secondary relaying the beam to a focus
 * behind the primary. It is the fifth reflecting preset, and it exists to
 * *compose* the two units that came before it: the Schmidt camera's corrector
 * figure (§ 5g) and the Cassegrain-form layout + confocal secondary (§ 5e).
 *
 * ## Which Schmidt-Cassegrain this is — read this before extending it
 *
 * This is a **Schmidt-corrected Cassegrain**: a spherical primary + a Schmidt
 * corrector nulling its spherical aberration + an *aspheric* (hyperboloidal)
 * confocal secondary. It is NOT the commercial "compact SCT" (Celestron/Meade),
 * whose primary AND secondary are BOTH spheres and whose corrector is an
 * OPTIMISED, proprietary surface figured to null the *combined* two-mirror
 * spherical aberration. That surface has no external number to pin it to, so it
 * would violate the project's hard rule (new capability pinned to
 * textbook/closed-form/published values) — the tension is recorded in
 * `cassegrain.ts`. The variant built here keeps every number a closed form:
 *
 *  - The corrector figure is the Schmidt camera's textbook A₄, referenced to the
 *    PRIMARY's radius (below). Reused verbatim, not re-derived.
 *  - The secondary is the classical Cassegrain's confocal hyperboloid, reused
 *    verbatim from `twoMirrorLayout` — because once the corrector makes the
 *    sphere behave (to third order) like the paraboloid the confocal pairing
 *    expects, the same secondary relays it stigmatically.
 *
 * The all-spherical commercial SCT belongs to a later unit that transcribes the
 * published two-mirror Seidel corrector formula (Schroeder Ch. 6; Rutten & van
 * Venrooij) rather than deriving it here.
 *
 * ## The corrector figure — reused from the Schmidt camera (§ 5g)
 *
 * The corrector sits at the primary's centre of curvature (a distance R₁ = 2f₁
 * in front of the primary vertex), which is also the aperture stop. Because the
 * object is at infinity the beam there is collimated, so an on-axis ray keeps its
 * height from plate to primary and the r⁴ figure derived at the mirror applies
 * unchanged at the plate. A sphere carries r⁴/(4R₁³) of spherical aberration
 * against the paraboloid of the same vertex radius; a plate of index n whose
 * thickness varies as r⁴ cancels it when
 *
 *     (n−1)·A₄·r⁴ = −r⁴/(4R₁³)      ⇒      A₄ = −1/(4·(n−1)·R₁³)
 *
 * — the SAME closed form the Schmidt camera pins, with the mirror radius now the
 * PRIMARY's R₁, not the system's. Signed thickest at the rim. n is dispersive, so
 * A₄ is figured for one wavelength and the correction drifts away from it: the
 * Schmidt's residual **spherochromatism**, which the trace shows for free.
 *
 * ## The stop is on the corrector, NOT the primary
 *
 * This is the one structural difference from the classical Cassegrain (whose stop
 * is the paraboloidal primary). Placing the stop at the corrector — the primary's
 * centre of curvature — is what lets the r⁴ figure transfer exactly, and it is
 * also why this preset does NOT share the Cassegrain's field behaviour: a
 * different stop position gives different coma and astigmatism, so those are not
 * cross-validated against `cassegrain` here. Only the *mirror geometry* is shared
 * (radii, separation, secondary conic, obstruction, secondary footprint) — the
 * on-axis marginal footprint is stop-independent because the input beam is
 * collimated, which is what makes reusing `twoMirrorLayout` valid.
 *
 * ## On axis it is diffraction-limited, NOT exactly stigmatic
 *
 * Like the Schmidt camera and unlike the confocal Cassegrain, the corrector nulls
 * only the THIRD-order spherical aberration; a fifth-order residual survives and
 * is relayed through the secondary. So the on-axis rung is "diffraction-limited,
 * and a large factor better than the corrector-removed system" — never
 * "Strehl = 1", which is the classical Cassegrain's (~1e-10) property alone. That
 * residual falls steeply as the primary is slowed, the signature of a
 * higher-order term. Its reason to exist over the all-reflective Cassegrain is
 * the cheap SPHERICAL primary, and the two rungs that make it non-redundant are
 * exactly the two prices that buys: the fifth-order on-axis residual and the
 * refractive corrector's spherochromatism.
 *
 * ## Geometry (all magnitudes; engine signs applied at the end)
 *
 *     corrector front   z = 0                 (stop, at the primary's CoC)
 *     corrector back    z = plateThickness
 *     primary vertex    z = R₁ = 2f₁          (spherical, concave toward −z)
 *     secondary vertex  z = R₁ − d            (between corrector and primary)
 *     focus             z = R₁ + b            (b behind the primary vertex)
 *
 * The incoming collimated beam is not tested against the secondary in the
 * sequential trace — the secondary is met only on the returning leg — so its
 * central obstruction is ε bookkeeping in the pupil function, exactly as for the
 * classical Cassegrain.
 *
 * SCOPE. As for the Cassegrain (§ 5e) and Schmidt (§ 5g): the primary's central
 * hole and the secondary's obstruction are not traced as blockers; the curved
 * (Petzval) focal surface is unpinned (rungs measure by Zernike coefficient at
 * best focus, so field-curvature defocus does not contaminate them); off-axis
 * coma/astigmatism are present in the trace but unpinned, since with the stop at
 * the corrector they are neither the classical Cassegrain's nor a clean closed
 * form.
 *
 * The mirrors are sized for the ON-AXIS beam only (like the Cassegrain/RC
 * secondary), so off-axis beams VIGNETTE at both mirrors as an artifact of
 * sizing, not physics — and more than the Cassegrain/RC do, because the forward
 * stop also walks the beam off the D/2 primary (the siblings' stop is the
 * primary, so only their secondary clips). Every rung here runs on axis, so none
 * is affected. Field-sizing all three two-mirror presets uniformly is a shared,
 * app-field-render-driven deferral — do it when the app needs off-axis beams to
 * pass, not as an SCT one-off. All recorded in docs/VALIDATION.md § 5h.
 */
export interface SchmidtCassegrainSpec extends TwoMirrorSpec {
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

export interface SchmidtCassegrain {
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
  /** Spherical primary radius of curvature magnitude (mm) = 2·f₁ — the R the corrector is figured to. */
  readonly primaryRadiusMm: number;
  /** Corrector → primary vertex separation (mm) = R₁, since the corrector sits at the CoC. */
  readonly correctorToPrimaryMm: number;
  /** Secondary radius of curvature magnitude (mm). */
  readonly secondaryRadiusMm: number;
  /** Secondary conic (the confocal hyperboloid, < −1). */
  readonly secondaryConic: number;
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
  /**
   * Central obstruction as a fraction of the pupil RADIUS — the spelling `psf()`
   * and the geometric branch both take.
   */
  readonly obstruction: number;
}

export function schmidtCassegrain(spec: SchmidtCassegrainSpec): SchmidtCassegrain {
  const L = twoMirrorLayout(spec, "schmidtCassegrain");
  const { secondaryMagnification: m, primarySeparationMm: d, backFocusMm: b } = L;
  const D = L.apertureMm;

  // The primary is a SPHERE (conic 0) of radius R₁ = 2f₁; the corrector, not the
  // figure, kills its spherical aberration. R₁ is the radius the Schmidt A₄ is
  // referenced to.
  const R1 = 2 * L.primaryFocalLengthMm;

  // The confocal hyperboloid secondary — identical to the classical Cassegrain's,
  // because to third order the corrected sphere delivers the paraboloid's
  // wavefront the confocal pairing was designed to relay.
  const k2 = -(((m + 1) / (m - 1)) ** 2);

  // The corrector figure, reused from the Schmidt camera (§ 5g) with the PRIMARY
  // radius: thickest at the rim, cancelling the sphere's third-order SA.
  const designWavelengthNm = spec.designWavelengthNm ?? 550;
  const correctorMedium = spec.correctorMedium ?? "FUSED-SILICA";
  const n = getMedium(correctorMedium).n(designWavelengthNm);
  if (!(n > 1)) {
    throw new Error(`schmidtCassegrain: corrector medium ${correctorMedium} must have index > 1`);
  }
  const A4 = -1 / (4 * (n - 1) * R1 ** 3);

  const plateThicknessMm = spec.plateThicknessMm ?? 0.01 * D;
  if (!(plateThicknessMm > 0) || !(plateThicknessMm < R1)) {
    throw new Error(`schmidtCassegrain: plate thickness ${plateThicknessMm} mm must be positive and thinner than R₁`);
  }

  // The corrector glass and the primary overfill their clear aperture by a hair:
  // the aspheric plate refracts the marginal ray slightly, so the traced surfaces
  // after it run a touch wider than D/2 to keep the pupil's own rim ring from
  // being numerically shaved — the Schmidt analogue of sizing to the sag-exact
  // footprint. It moves no ray inside the pupil. NOTE: the clear aperture (the
  // pupil) is D/2 as set by the system's *stop-radius* aperture spec, NOT this
  // glass edge; drive this preset with `{ kind: "stopRadius", value: D/2 }` (as
  // the rungs do), since an `fNumber`/`EPD` spec would read the oversized surface.
  const correctorClearRadius = (D / 2) * 1.02;
  const primaryClearRadius = (D / 2) * 1.02;
  // The secondary needs its own extra margin beyond the bare Cassegrain cone:
  // the corrector refracts the marginal ray outward (the very bend that corrects
  // the SA), so it reaches the secondary ~0.5% wider than `twoMirrorLayout`'s
  // sag-exact footprint — which assumes the ray leaves the primary rim at D/2.
  // The same 1.02 the corrector and primary carry clears it on every geometry
  // the rungs exercise, with headroom. The reported `obstruction` stays the clean
  // paraxial ε; only the physical clear aperture grows.
  const secondaryClearRadius = L.secondaryClearRadiusMm * 1.02;

  return {
    prescription: {
      surfaces: [
        {
          // Corrector front: the aspheric face, at the primary's centre of
          // curvature (z = 0), which is also the stop. Flat base; the r⁴ figure
          // is the whole correction.
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
          // 0 — a sphere; the corrector, not the figure, kills the SA.
          kind: "reflect",
          curvature: L.primaryCurvature, // = −1/(2f₁) = −1/R₁
          conic: 0,
          semiAperture: primaryClearRadius,
          thickness: -d, // secondary sits d back down the returning beam (−z)
        },
        {
          // Convex confocal hyperboloid secondary facing the incoming (−z) beam:
          // centre of curvature also at −z, so R₂ is negative in this frame.
          kind: "reflect",
          curvature: -1 / L.secondaryRadiusMm,
          conic: k2,
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
    secondaryRadiusMm: L.secondaryRadiusMm,
    secondaryConic: k2,
    correctorA4: A4,
    correctorIndex: n,
    correctorMedium,
    designWavelengthNm,
    plateThicknessMm,
    obstruction: L.obstruction,
  };
}
