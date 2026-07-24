import { Prescription, SurfaceSpec, reversePrescription } from "../trace/prescription";
import { paraxialTrace, systemProperties } from "../trace/paraxial";
import { collimatingObjectDistance, spliceModules } from "../trace/compose";
import { OpticalSystem } from "../trace/system";
import { LINE_D } from "../materials/dispersion";
import { AchromaticObjective, achromaticObjective } from "./achromat";

/**
 * The infinity-corrected microscope — the architecture the whole microscope
 * branch is built on, and its first computed objective.
 *
 * ## Why this is the branch's opening unit
 *
 * Everything step 6 promises (immersion, coverslip mismatch, brightfield,
 * fluorescence) is a variation on one chain: a specimen at an objective's front
 * focus, a collimated space, a tube lens, an image. The engine could express
 * neither end of it. Finite conjugates existed but nothing *placed* the object;
 * `systemProperties` reads EFL and BFD from a ray coming in collimated, and
 * `bestFocus` moves the image plane. Where the specimen goes so that the
 * objective's output is collimated is a different solve, and it is the one
 * genuinely new first-order capability here (`collimatingObjectDistance`).
 *
 * ## The two conventions, and which one is external
 *
 * An infinity-corrected objective has no magnification of its own — it is
 * afocal-out, so `systemProperties` throws on it (the § 5l finding). Its
 * catalogued "4×" is a ratio against a **tube lens focal length that is a
 * manufacturer convention**, not a law:
 *
 *     M = f_tube / f_objective
 *
 * f_tube is 200 mm for Nikon (CFI60) and Leica, 180 mm for Olympus (UIS2), and
 * 165 mm for Zeiss (ICS) — published conventions, spelled out in
 * `TUBE_FOCAL_LENGTH_MM` so the number is stated rather than assumed. The
 * physics rung is *relative* to whichever is chosen: the traced magnification
 * must equal f_tube/f_obj for the stated pair, and a 4× objective on the wrong
 * maker's tube lens is genuinely not 4×. That is a real property of real
 * microscopes, not a modelling artifact.
 *
 * ## The objective is a TELESCOPE DOUBLET, TURNED AROUND
 *
 * A low-power achromatic objective really is a cemented doublet — 4×/0.10 is one
 * in glass, not just in simulation — so `achromaticObjective` builds it and no
 * new lens-design code is needed, exactly as the ED refractor (§ 5k) reused it.
 * What is NOT free is the orientation. § 5j solved the bending for S_I = 0 with
 * the light arriving **collimated on the crown**; a microscope objective runs the
 * other conjugate pair, specimen in and collimated out. By reversibility the
 * orientation that reproduces the solve is the doublet **mirrored — flint toward
 * the specimen, crown toward the tube lens** — the same turn-around
 * `designs/eyepiece` makes for the Plössl's second group.
 *
 * This is measured, not assumed, and it is not a close call: the same doublet
 * with the crown toward the specimen carries **9.2 waves** of third-order
 * spherical aberration where the mirrored one carries ~1e-16 (§ 6a). Both
 * orientations have identical EFL, so nothing first-order can tell them apart —
 * which is precisely why the rung is worth having.
 *
 * ## What the focal ratio is fixed by, and where the sine condition really acts
 *
 * The glass diameter follows from the **Abbe sine condition**: an aplanatic lens
 * maps object-space angle to *emergent* ray height as y = f·sin u, so a
 * numerical aperture NA = n·sin u fills a semi-aperture f·NA (dry), and the
 * objective's focal ratio is
 *
 *     F = f / (2·f·NA) = 1/(2·NA)
 *
 * — a function of NA **alone**, independent of magnification. A 4×/0.10 and a
 * 20×/0.10 are both f/5 doublets; what changes is their focal length.
 *
 * The **stop radius is a different number**, and conflating them is a mistake
 * this module made once and now records. f·sin u is a height on the equivalent
 * refracting surface — a sphere of radius f about the front principal point —
 * and the physical front vertex is not that sphere. The stop sits on the vertex,
 * a distance s (the front focal distance) from the specimen, so the cone that
 * actually fills it is a *tangent* relation:
 *
 *     r_stop = s · tan u = s · NA/√(1−NA²)
 *
 * For the 4×/0.10 the two differ by 2.1% — small, and entirely a real effect: a
 * stop of f·NA on the vertex would deliver NA 0.102, not 0.100. Sizing by the
 * sine-condition height and then *reading back* the NA would have quietly
 * shipped an objective 2% faster than its label.
 *
 * That leaves the sine condition free to be a genuine external check rather than
 * a construction, and it is applied where it belongs: the marginal ray that
 * leaves the specimen at sin u = NA must emerge from the objective **parallel to
 * the axis at height f·sin u** (`pupil/microscope`'s `sineConditionResidual`).
 * Nothing in the design put it there.
 *
 * ## Honest limits of the computed member
 *
 * A cemented doublet cannot be pushed far up the NA scale: F = 1/(2·NA) means
 * NA 0.25 is an f/2 doublet, where the third-order solve's neglected higher
 * orders dominate and the design stops being a design. So the computed member is
 * the **low-power, low-NA** objective, which is the honest range for this glass
 * form; the Lister two-doublet and the aplanatic immersion front are the named
 * follow-ons, and the latter is where the dispersive oil and D263 already in the
 * catalog (§ 1) start doing work.
 *
 * Also NOT modelled here, and deliberately: real objectives put the aperture stop
 * at the **back focal plane**, which makes them object-space telecentric — chief
 * rays parallel to the axis, so magnification does not drift with defocus. That
 * puts the entrance pupil at infinity, and `aimRay` refuses it by design
 * ("telecentric: aim in object space instead"). Object-space aiming is a real
 * engine gap; until it lands the stop sits on the objective's own rim, which
 * changes no axial property and no magnification, only the chief-ray angle.
 */

/**
 * Tube lens focal lengths (mm) by manufacturer convention. Stated, not derived:
 * these are catalogue conventions, and every magnification in this module is a
 * ratio against whichever is chosen.
 */
export const TUBE_FOCAL_LENGTH_MM = {
  nikon: 200,
  leica: 200,
  olympus: 180,
  zeiss: 165,
} as const;

/** The default convention when none is named: the 200 mm Nikon/Leica standard. */
export const DEFAULT_TUBE_FOCAL_LENGTH_MM = TUBE_FOCAL_LENGTH_MM.nikon;

export interface MicroscopeObjectiveSpec {
  /** Nominal magnification against `tubeFocalLengthMm` (e.g. 4 for a 4×). */
  readonly magnification: number;
  /** Object-space numerical aperture n·sin u (e.g. 0.10). */
  readonly numericalAperture: number;
  /** The tube lens this magnification is quoted against (mm). Default 200. */
  readonly tubeFocalLengthMm?: number;
  readonly crownMedium?: string;
  readonly flintMedium?: string;
  /** Wavelength (nm) the design is computed at. Default the d line. */
  readonly designWavelengthNm?: number;
}

export interface MicroscopeObjective {
  /**
   * The objective alone, authored **specimen-side first** — so surface 0 is the
   * flint's outer face, the mirrored doublet's front. Trailing thickness 0: the
   * gap into the infinity space belongs to whatever follows.
   */
  readonly prescription: Prescription;
  /** f_tube / M (mm) — the focal length the nominal magnification implies. */
  readonly focalLengthMm: number;
  /** Traced paraxial EFL at the design wavelength (mm), from the mirrored chain. */
  readonly paraxialFocalLengthMm: number;
  /**
   * Semi-aperture of the GLASS, f·NA (mm) — the sine-condition height the
   * emergent marginal ray lands at. Not the stop radius; see the header.
   */
  readonly pupilRadiusMm: number;
  /**
   * The aperture stop's semi-diameter (mm): s·tan u, the cone from the solved
   * specimen plane that actually delivers NA at the front vertex. 2% under
   * `pupilRadiusMm` for the 4×/0.10, and it is the one that sets the NA.
   */
  readonly stopRadiusMm: number;
  /** 1/(2·NA) — a function of NA alone. */
  readonly focalRatio: number;
  /**
   * Solved specimen plane: distance from surface 0's vertex to the object, in
   * front of it (mm). The *free working distance* is this less the front
   * surface's sag, and less the coverslip once § 6c models one.
   */
  readonly objectDistanceMm: number;
  /** The telescope-orientation doublet this is the mirror image of. */
  readonly doublet: AchromaticObjective;
  readonly numericalAperture: number;
  readonly tubeFocalLengthMm: number;
  readonly designWavelengthNm: number;
}

/**
 * A low-power achromatic objective: `achromaticObjective`'s doublet, mirrored
 * into the microscope's conjugate pair, with the specimen plane solved onto its
 * front focus.
 */
export function microscopeObjective(spec: MicroscopeObjectiveSpec): MicroscopeObjective {
  const M = spec.magnification;
  const NA = spec.numericalAperture;
  if (!(M > 0)) throw new Error("microscopeObjective: magnification must be positive");
  if (!(NA > 0) || NA >= 1) {
    throw new Error("microscopeObjective: a dry objective's NA must lie in (0, 1)");
  }
  const tubeFocalLengthMm = spec.tubeFocalLengthMm ?? DEFAULT_TUBE_FOCAL_LENGTH_MM;
  const designWavelengthNm = spec.designWavelengthNm ?? LINE_D;

  const f = tubeFocalLengthMm / M;
  // Sine condition: the marginal ray leaves the object at sin u = NA and EMERGES
  // at height f·sin u, so the glass spans 2·f·NA and F = 1/(2·NA). The bending
  // solve is scale-free in this — S_I ∝ h⁴, so the root of S_I(c₁) = 0 and the
  // branch pick are the same at any aperture — which is why sizing the glass
  // here and the stop below cannot pull the design around.
  const pupilRadiusMm = f * NA;
  const focalRatio = 1 / (2 * NA);

  const doublet = achromaticObjective({
    apertureMm: 2 * pupilRadiusMm,
    focalRatio,
    ...(spec.crownMedium === undefined ? {} : { crownMedium: spec.crownMedium }),
    ...(spec.flintMedium === undefined ? {} : { flintMedium: spec.flintMedium }),
    designWavelengthNm,
  });

  // Turned around: flint toward the specimen. See the header — the un-mirrored
  // orientation is 9 waves of spherical aberration with an identical EFL.
  const prescription = reversePrescription(doublet.prescription, 0);
  const objectDistanceMm = collimatingObjectDistance(prescription, designWavelengthNm);
  // The stop is on the front vertex, s from the specimen — so what fills it is
  // s·tan u, not the sine-condition height f·sin u. See the header.
  const stopRadiusMm = (objectDistanceMm * NA) / Math.sqrt(1 - NA * NA);

  return {
    prescription,
    focalLengthMm: f,
    paraxialFocalLengthMm: systemProperties(prescription, designWavelengthNm).efl,
    pupilRadiusMm,
    stopRadiusMm,
    focalRatio,
    objectDistanceMm,
    doublet,
    numericalAperture: NA,
    tubeFocalLengthMm,
    designWavelengthNm,
  };
}

export interface TubeLensSpec {
  /** Focal length (mm). Default 200 — see `TUBE_FOCAL_LENGTH_MM`. */
  readonly focalLengthMm?: number;
  /** Clear aperture (mm). Default 25, a typical 200 mm tube lens. */
  readonly apertureMm?: number;
  readonly crownMedium?: string;
  readonly flintMedium?: string;
  readonly designWavelengthNm?: number;
}

export interface TubeLens {
  /** Authored infinity-space first — collimated in, focus out: crown first. */
  readonly prescription: Prescription;
  readonly focalLengthMm: number;
  readonly paraxialFocalLengthMm: number;
  readonly doublet: AchromaticObjective;
}

/**
 * The tube lens: an achromatic doublet in its **telescope** orientation.
 *
 * It sees collimated light and forms an image, which is `achromaticObjective`'s
 * own conjugate pair, so unlike the objective it is used the way it was solved
 * and needs no turn-around. That asymmetry is the point — in an
 * infinity-corrected microscope the two doublets face opposite ways.
 */
export function tubeLens(spec: TubeLensSpec = {}): TubeLens {
  const f = spec.focalLengthMm ?? DEFAULT_TUBE_FOCAL_LENGTH_MM;
  const D = spec.apertureMm ?? 25;
  const designWavelengthNm = spec.designWavelengthNm ?? LINE_D;
  const doublet = achromaticObjective({
    apertureMm: D,
    focalRatio: f / D,
    ...(spec.crownMedium === undefined ? {} : { crownMedium: spec.crownMedium }),
    ...(spec.flintMedium === undefined ? {} : { flintMedium: spec.flintMedium }),
    designWavelengthNm,
  });
  return {
    prescription: doublet.prescription,
    focalLengthMm: f,
    paraxialFocalLengthMm: systemProperties(doublet.prescription, designWavelengthNm).efl,
    doublet,
  };
}

export interface InfinityCorrectedSpec {
  readonly objective: MicroscopeObjective;
  readonly tubeLens: TubeLens;
  /**
   * Objective rear vertex → tube lens front vertex (mm). Default 100. The beam
   * between them is collimated, so this changes no first-order property — the
   * reason the infinity space exists at all, and a rung in its own right.
   */
  readonly infinitySpaceMm?: number;
  /** Object heights (mm from the axis) the system's field is spelled with. */
  readonly objectHeightsMm?: readonly number[];
  /** Wavelengths to evaluate. Defaults to the objective's design wavelength alone. */
  readonly wavelengths?: readonly { readonly nm: number; readonly weight: number }[];
}

export interface InfinityCorrectedMicroscope {
  readonly system: OpticalSystem;
  /** The flat composed chain: objective, infinity space, tube lens. */
  readonly prescription: Prescription;
  /** Nominal f_tube/f_obj — what the labels claim. Negative sign is not applied. */
  readonly nominalMagnification: number;
  /** Last tube-lens vertex → paraxial image plane (mm), from the composed trace. */
  readonly imageDistanceMm: number;
  /** Specimen plane, in front of the objective's first vertex (mm). */
  readonly objectDistanceMm: number;
  readonly infinitySpaceMm: number;
  readonly objectiveSurfaceCount: number;
}

/**
 * Compose objective + tube lens into one traceable microscope, with the
 * specimen placed on the objective's front focus and the image plane on the
 * composed chain's paraxial focus.
 */
export function infinityCorrectedMicroscope(
  spec: InfinityCorrectedSpec,
): InfinityCorrectedMicroscope {
  const { objective, tubeLens: tube } = spec;
  const infinitySpaceMm = spec.infinitySpaceMm ?? 100;
  const lambda = objective.designWavelengthNm;

  const build = (imageGapMm: number): Prescription => {
    const chain = spliceModules(
      [
        { surfaces: objective.prescription.surfaces, gapAfterMm: infinitySpaceMm },
        { surfaces: tube.prescription.surfaces, gapAfterMm: imageGapMm },
      ],
      objective.prescription.objectMedium ?? "AIR",
    );
    // The objective's own rim is the aperture — see the header's telecentricity
    // note for why the stop is not at the back focal plane yet.
    const surfaces: SurfaceSpec[] = chain.surfaces.map((s, i) =>
      i === 0 ? { ...s, isStop: true } : s,
    );
    return { ...chain, surfaces };
  };

  // The specimen sits on the OBJECTIVE's front focus, not the composed chain's:
  // the composed chain is focal, and its own front focal plane is a different
  // (and for a microscope meaningless) place.
  const objectDistanceMm = objective.objectDistanceMm;

  // Paraxial image: trace the axial marginal ray from the object plane through
  // the chain with no trailing gap, then run it to its crossing of the axis.
  const probe = paraxialTrace(build(0), lambda, { y: objectDistanceMm, u: 1 });
  if (!(Math.abs(probe.u) > 0)) {
    throw new Error("infinityCorrectedMicroscope: the composed chain leaves the axial cone collimated");
  }
  const imageDistanceMm = -probe.y / probe.u;

  const prescription = build(imageDistanceMm);
  const wavelengths = spec.wavelengths ?? [{ nm: lambda, weight: 1 }];
  const objectHeightsMm = spec.objectHeightsMm ?? [0];

  const system: OpticalSystem = {
    prescription,
    aperture: { kind: "stopRadius", value: objective.stopRadiusMm },
    field: { kind: "objectHeight", values: objectHeightsMm },
    wavelengths,
    conjugate: { kind: "finite", distance: objectDistanceMm },
  };

  return {
    system,
    prescription,
    nominalMagnification: tube.focalLengthMm / objective.focalLengthMm,
    imageDistanceMm,
    objectDistanceMm,
    infinitySpaceMm,
    objectiveSurfaceCount: objective.prescription.surfaces.length,
  };
}
