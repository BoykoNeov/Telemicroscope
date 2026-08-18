import { Prescription } from "../trace/prescription";
import { systemProperties } from "../trace/paraxial";
import { collimatingObjectDistance } from "../trace/compose";
import { getMedium } from "../materials/catalog";
import { LINE_D } from "../materials/dispersion";
import { seidelSums } from "../analysis/seidel";

/**
 * The condenser, as a lens — § 6x's last deferral.
 *
 * Everything the illumination branch has done since § 6f models the condenser as
 * a **set of directions**: `illumination/source` builds points on a disc and
 * `illumination/abbe` sums over them. That reduction is exact for Köhler
 * illumination and it is where the physics of partial coherence lives, so it is
 * not being replaced. What it cannot express is written into § 6x's own deferral
 * list: *"the cone is translated rigidly; a real condenser's cone also changes
 * shape off axis, which is a second trace this step does not run."* You cannot
 * run that trace without a condenser to trace through, and `designs/` had none.
 * This module is that lens.
 *
 * ## Why the UNCORRECTED form, deliberately
 *
 * `designs/immersion` already has the pieces of a good condenser — the aplanatic
 * hyperhemisphere is stigmatic in closed form and the meniscus keeps it so — and
 * building the condenser out of them would have been the obvious move and the
 * wrong one. An aplanat has zero spherical aberration AND zero coma by
 * construction, so its cone barely deforms: the subject would have been designed
 * away, which is exactly the trap § 6x flagged about defaulting the DIN objective
 * telecentric. The Abbe condenser is the right subject *because* it is
 * uncorrected — two simple elements, no achromatism, no aplanatism, which is what
 * sits under a real student microscope and what makes "the condenser's own
 * aberrations" a phrase with a size.
 *
 * The negative control is therefore not a second design. It is the
 * **aberration-free limit** reached by closing the condenser's own aperture,
 * where the traced cone must converge onto `diskSource` — § 6ae.5's shape, and it
 * needs one lens rather than two.
 *
 * ## The construction, and what makes it Köhler
 *
 * Two plano-convex elements, flats toward the lamp, convex toward the specimen —
 * the standard orientation, and the one that keeps each element near its own
 * best form for a beam that is collimated on the specimen side. One free
 * parameter, the shared radius, solved on the TRACED paraxial chain for the
 * stated focal length rather than from the thin-lens maker's equation, so the
 * element thicknesses are in the answer and the closed form stays free to be an
 * external pin.
 *
 * The aperture diaphragm is **surface 0, at the group's front focal plane**, and
 * that placement is the whole of Köhler illumination in this module: an object at
 * the front focus leaves collimated, so every diaphragm point lights the entire
 * field with one direction and the diaphragm's radius sets the largest angle.
 * `illumination/source`'s "one direction per diaphragm point" is that sentence,
 * and until now nothing in the repo could check it.
 *
 * It is the same placement `designs/microscope` gives an objective's stop one
 * step earlier (§ 6ae), read from the other side: a stop at a group's focal plane
 * makes the conjugate space telecentric, and which space depends on which focal
 * plane. The objective's back focal plane buys object-space telecentricity; the
 * condenser's front focal plane buys the same property for the beam it sends.
 *
 * ## Units and orientation
 *
 * Authored **lamp-side first**, light travelling toward the specimen, which is
 * the direction the illumination actually goes and the opposite of every
 * objective in this package. The specimen sits `workingDistanceMm` past the last
 * vertex. Nothing here knows what objective is above it: the condenser's cone
 * becomes a `CondenserSource` only when something states an objective's aperture
 * to express the directions in, and that mapping is not this module's.
 *
 * SCOPE, and it is the honest limit of the whole idea: a `CondenserSource` is a
 * set of PLANE waves, and an aberrated condenser's diaphragm point does not send
 * one — its beam arrives at the specimen with a direction that varies across the
 * field. Reducing that to one direction per (diaphragm point, field point) is a
 * ray summary, and it is legitimate only while the variation across whatever
 * patch is being rendered stays under the source's own sampling step. That is a
 * measurable condition, not an assumption, and it is measured rather than assumed
 * wherever this lens is turned into a source.
 */

/** N-BK7 is what an Abbe condenser is actually made of, and it is uncorrected. */
const DEFAULT_CONDENSER_MEDIUM = "N-BK7";

export interface AbbeCondenserSpec {
  /**
   * The illumination numerical aperture the diaphragm delivers wide open. The
   * diaphragm radius follows as `f·tan u`, so this is the aperture in the
   * currency a condenser is engraved in, and closing the diaphragm below it is
   * what the coherence parameter S does.
   */
  readonly numericalAperture: number;
  /** Focal length (mm). Default 10 — a real condenser's order. */
  readonly focalLengthMm?: number;
  /** Last vertex → specimen (mm). Default 2. */
  readonly workingDistanceMm?: number;
  /**
   * The specimen circle this condenser must illuminate (mm, radius). Default
   * 2.25 — an 18 mm field number at 4×, which is the app's stage.
   *
   * It sizes the glass, and it is the condenser's counterpart to § 6w's field
   * number on an objective: every diaphragm point's beam covers the whole field,
   * so the glass has to be at least the field wide however small the aperture is.
   */
  readonly fieldRadiusMm?: number;
  /** Air gap between the two elements (mm). Default 0.5. */
  readonly gapMm?: number;
  /** Centre thickness of each element (mm). Default 2.5. */
  readonly elementThicknessMm?: number;
  /**
   * How many elements. **2** (default) is the Abbe form. **1** is not a design —
   * it is the rung's own fixture, because a single plano-convex element at a
   * stated shape factor is exactly what the published Coddington polynomial
   * describes, so its spherical aberration can be pinned to an external number
   * that a two-element sum cannot be.
   */
  readonly elements?: 1 | 2;
  readonly medium?: string;
  readonly designWavelengthNm?: number;
}

export interface AbbeCondenser {
  /**
   * The whole condenser, lamp-side first: **surface 0 is the aperture
   * diaphragm**, a flat carrying the stop flag at the group's front focal plane,
   * then the glass. Trailing thickness is the working distance, so the
   * prescription's image plane IS the specimen plane.
   */
  readonly prescription: Prescription;
  /** The glass alone — the group the front focal distance is measured against. */
  readonly glass: Prescription;
  /** Focal length asked for (mm). */
  readonly focalLengthMm: number;
  /** Traced paraxial EFL of the glass at the design wavelength (mm). */
  readonly paraxialFocalLengthMm: number;
  /** Diaphragm → first glass vertex (mm): the group's front focal distance. */
  readonly frontFocalDistanceMm: number;
  /** Diaphragm semi-diameter wide open (mm) — `f·tan u`. */
  readonly diaphragmRadiusMm: number;
  /** The illumination NA that radius delivers. */
  readonly numericalAperture: number;
  readonly workingDistanceMm: number;
  readonly fieldRadiusMm: number;
  /** Clear semi-diameter of each element (mm). */
  readonly glassSemiDiameterMm: number;
  /** The shared radius of curvature the solve landed on (mm). */
  readonly radiusMm: number;
  /**
   * Coddington's shape factor of each element, `(c₁+c₂)/(c₁−c₂)`. **−1** for
   * every condenser this constructor builds: the elements are plano-convex with
   * the flat toward the lamp. Reported because it is what the external pin is
   * written in, not because it is a freedom.
   */
  readonly shapeFactor: number;
  /**
   * ΣS_I/8 of one diaphragm point's BEAM (mm) — its spherical aberration as a
   * wavefront coefficient. Not zero and not meant to be: it is the quantity that
   * makes an Abbe condenser an Abbe condenser.
   *
   * **It does not move when the diaphragm closes, and that is Köhler
   * illumination rather than an oversight.** Every diaphragm point lights the
   * whole field with one beam, so that beam's width at the glass is set by the
   * FIELD and not by the aperture — the marginal ray height here is
   * `fieldRadiusMm`, and closing the diaphragm changes how many such beams there
   * are and what angles they leave at, never how wide any one of them is. Which
   * is why this is named for the beam: the aperture-dependent quantity is the
   * ANGULAR error of the cone the beams make between them, it goes as NA², and
   * it is § 6af.5's measurement rather than this readout.
   */
  readonly fieldBeamW040Mm: number;
  /** Which surface carries the stop. 0 — the diaphragm, and there is no other. */
  readonly stopSurfaceIndex: number;
  readonly elements: 1 | 2;
  readonly designWavelengthNm: number;
}

/** tan u for a cone of numerical aperture NA in air. */
const tanOf = (na: number): number => na / Math.sqrt(1 - na * na);

/**
 * The glass alone at a trial radius: plano-convex elements, flats toward the
 * lamp. `c₁ = 0` and `c₂ = −1/R` makes each element bulge toward the specimen,
 * which is shape factor −1 and the orientation a real condenser is stacked in.
 */
function glassAt(
  radiusMm: number,
  elements: 1 | 2,
  thicknessMm: number,
  gapMm: number,
  semiAperture: number,
  medium: string,
): Prescription {
  const c = -1 / radiusMm;
  const element = (trailing: number) => [
    { kind: "refract" as const, curvature: 0, semiAperture, thickness: thicknessMm, medium },
    { kind: "refract" as const, curvature: c, semiAperture, thickness: trailing, medium: "AIR" },
  ];
  return {
    objectMedium: "AIR",
    surfaces: elements === 1 ? element(0) : [...element(gapMm), ...element(0)],
  };
}

/**
 * An Abbe condenser: two plano-convex elements and an aperture diaphragm at
 * their common front focal plane.
 */
export function abbeCondenser(spec: AbbeCondenserSpec): AbbeCondenser {
  const NA = spec.numericalAperture;
  if (!(NA > 0) || NA >= 1) {
    throw new Error("abbeCondenser: a dry condenser's NA must lie in (0, 1)");
  }
  const focalLengthMm = spec.focalLengthMm ?? 10;
  if (!(focalLengthMm > 0)) {
    throw new Error("abbeCondenser: the focal length must be positive");
  }
  const workingDistanceMm = spec.workingDistanceMm ?? 2;
  if (!(workingDistanceMm > 0)) {
    throw new Error("abbeCondenser: the working distance must be positive");
  }
  const fieldRadiusMm = spec.fieldRadiusMm ?? 2.25;
  if (!(fieldRadiusMm > 0)) {
    throw new Error("abbeCondenser: the field radius must be positive");
  }
  const elements = spec.elements ?? 2;
  const gapMm = spec.gapMm ?? 0.5;
  const thicknessMm = spec.elementThicknessMm ?? 2.5;
  const medium = spec.medium ?? DEFAULT_CONDENSER_MEDIUM;
  const designWavelengthNm = spec.designWavelengthNm ?? LINE_D;
  const tanU = tanOf(NA);

  // The glass has to pass the FIELD, not the aperture — every diaphragm point
  // lights the whole specimen circle, so a beam that clears the axial cone still
  // misses the edge of the field. `fieldRadius + walk`, the walk being how far
  // the most oblique beam has moved by the time it reaches the specimen. Same
  // shape as § 6w's `f·NA + h` and for the same reason, with the roles of the
  // aperture and the field swapped because the light is going the other way.
  const glassSemiDiameterMm =
    fieldRadiusMm +
    (workingDistanceMm + elements * thicknessMm + (elements === 2 ? gapMm : 0)) * tanU;

  // One free parameter, solved on the TRACED paraxial chain rather than from the
  // thin-lens maker's equation — the element thicknesses are then in the answer,
  // and the closed form stays free to be an external pin (§ 6af.2).
  const eflAt = (R: number): number => {
    try {
      return systemProperties(
        glassAt(R, elements, thicknessMm, gapMm, glassSemiDiameterMm, medium),
        designWavelengthNm,
      ).efl;
    } catch {
      // `systemProperties` refuses an afocal chain, and a trial radius can reach
      // one — thick elements far enough apart cancel their own power. Reported as
      // an aperture-side infinity so the bisection reads it as "too weak" and
      // steps the right way, instead of the solve dying on a trial.
      return Infinity;
    }
  };
  const n = getMedium(medium).n(designWavelengthNm);
  // Thin-lens seed: one element is (n−1)/R, two of them in near-contact twice
  // that. The bisection does not depend on the seed being good, only on the
  // bracket, and EFL is monotone in R over it.
  let lo = 0.05 * focalLengthMm;
  let hi = 20 * focalLengthMm * elements;
  for (let i = 0; i < 200; i++) {
    const mid = 0.5 * (lo + hi);
    if (eflAt(mid) < focalLengthMm) lo = mid;
    else hi = mid;
  }
  const radiusMm = 0.5 * (lo + hi);
  if (!Number.isFinite(eflAt(radiusMm))) {
    throw new Error(
      `abbeCondenser: no radius gives a ${focalLengthMm} mm focal length with ${elements} × ` +
        `${thicknessMm} mm of glass and a ${gapMm} mm gap — the elements are thick enough ` +
        "against the focal length that the pair goes afocal before it gets there",
    );
  }
  const glass = glassAt(radiusMm, elements, thicknessMm, gapMm, glassSemiDiameterMm, medium);
  const paraxialFocalLengthMm = systemProperties(glass, designWavelengthNm).efl;
  if (!(Math.abs(paraxialFocalLengthMm - focalLengthMm) <= 1e-9 * focalLengthMm)) {
    throw new Error(
      `abbeCondenser: the radius solve did not converge — asked ${focalLengthMm} mm, built ` +
        `${paraxialFocalLengthMm.toFixed(9)} mm at R = ${radiusMm.toFixed(9)} mm`,
    );
  }

  // The diaphragm sits where an object collimates: the group's front focal
  // plane. That IS Köhler illumination in this module — every point of it lights
  // the whole field with one direction.
  const frontFocalDistanceMm = collimatingObjectDistance(glass, designWavelengthNm);
  if (!(frontFocalDistanceMm > 0)) {
    throw new Error(
      `abbeCondenser: the group's front focus is behind its first vertex (${frontFocalDistanceMm.toFixed(4)} mm), ` +
        "so no diaphragm can sit there — shorten the elements or lengthen the focal length",
    );
  }
  const diaphragmRadiusMm = Math.abs(paraxialFocalLengthMm) * tanU;

  const surfaces = glass.surfaces.map((s, i) =>
    i === glass.surfaces.length - 1 ? { ...s, thickness: workingDistanceMm } : s,
  );
  const prescription: Prescription = {
    objectMedium: "AIR",
    surfaces: [
      {
        kind: "refract",
        curvature: 0,
        semiAperture: diaphragmRadiusMm,
        thickness: frontFocalDistanceMm,
        medium: "AIR",
        isStop: true,
      },
      ...surfaces,
    ],
  };

  // One diaphragm point's beam, at the conjugates it works at: the diaphragm in
  // front, the beam leaving collimated, and its width set by the FIELD because
  // that is what Köhler illumination means. A READOUT, and a large one — it is
  // what the word "Abbe" is doing in the name of this constructor.
  const fieldBeamW040Mm =
    seidelSums(glass, designWavelengthNm, {
      marginalHeightMm: fieldRadiusMm,
      objectDistanceMm: frontFocalDistanceMm,
    }).s1 / 8;

  return {
    prescription,
    glass,
    focalLengthMm,
    paraxialFocalLengthMm,
    frontFocalDistanceMm,
    diaphragmRadiusMm,
    numericalAperture: NA,
    workingDistanceMm,
    fieldRadiusMm,
    glassSemiDiameterMm,
    radiusMm,
    // c₁ = 0 and c₂ = −1/R, so (c₁+c₂)/(c₁−c₂) = −1 identically. Computed rather
    // than written down, so it cannot drift from the surfaces above.
    shapeFactor: (0 + -1 / radiusMm) / (0 - -1 / radiusMm),
    fieldBeamW040Mm,
    stopSurfaceIndex: 0,
    elements,
    designWavelengthNm,
  };
}
