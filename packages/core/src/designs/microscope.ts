import { Prescription, SurfaceSpec, reversePrescription } from "../trace/prescription";
import { paraxialTrace, systemProperties } from "../trace/paraxial";
import { collimatingObjectDistance, spliceModules } from "../trace/compose";
import { OpticalSystem } from "../trace/system";
import { LINE_D } from "../materials/dispersion";
import { seidelSums } from "../analysis/seidel";
import { AchromaticObjective, achromaticObjective } from "./achromat";
import {
  Coverslip,
  CoverslipSpec,
  coverslip,
  coverslipIndex,
  coverslipSurface,
} from "./coverslip";

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
 * 165 mm for Zeiss (ICS) — widely-quoted manufacturer conventions, NOT
 * datasheet-verified here (Zeiss ICS in particular is quoted as both 165 and
 * 164.5), spelled out in `TUBE_FOCAL_LENGTH_MM` so the number is stated rather
 * than assumed and so a caller can override it with a sourced one. The
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
 * Tube lens focal lengths (mm) by manufacturer convention. Stated, not derived,
 * and **not verified against datasheets in this repo** — they are the widely
 * quoted values, and every magnification in this module is a ratio against
 * whichever is chosen. No rung depends on the digits: `tubeLens` takes an
 * explicit focal length, and the M = f_tube/f_obj rungs are checked at more than
 * one of these, so a corrected value changes labels and nothing else.
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
   * surface's sag. NO COVERSLIP: § 6c models one for the DIN objective only —
   * the infinity-corrected member's slip is a named deferral, and the wiring is
   * the same target-S_I move `finiteConjugateObjective` makes.
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
  //
  // The stop flag travels with its surface under reversal (it is a property of
  // that piece of glass), so the doublet's front-surface stop lands on the
  // mirrored chain's LAST surface. Re-declared on surface 0 here so the
  // objective's own aperture is its specimen-side rim, and so the prescription
  // is self-consistent standing alone rather than only once composed.
  const mirrored = reversePrescription(doublet.prescription, 0);
  const prescription: Prescription = {
    ...mirrored,
    surfaces: mirrored.surfaces.map((s, i) => ({ ...s, isStop: i === 0 })),
  };
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
    //
    // `isStop: i === 0`, not just setting it on 0: both doublets declare their
    // OWN surface 0 as a stop, and the objective's travelled to its last surface
    // when it was mirrored, so a composed chain would otherwise carry three
    // flagged stops. `stopIndex` takes the first and would look fine; `seidelSums`
    // throws unless the flagged stop is surface 0. One aperture, one flag.
    const surfaces: SurfaceSpec[] = chain.surfaces.map((s, i) => ({ ...s, isStop: i === 0 }));
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

/**
 * The classic finite-conjugate (DIN/JIS) microscope — the other architecture
 * step 6 names, and a **differently solved lens**, not the § 6a objective used
 * differently.
 *
 * ## What the 160 is, and what it is not
 *
 * "160 mm tube length", engraved on every DIN objective beside its coverslip
 * thickness, is the **mechanical** tube length: nosepiece shoulder to the
 * eyepiece tube's top. The magnification is quoted against a different distance —
 * the **optical tube length**, Newton's x′, from the objective's rear focal plane
 * to the intermediate image — and Newton's equation gives the whole architecture:
 *
 *     |M| = x′/f          x_o·x′ = f²          so the specimen sits f/M
 *                                              in front of the front focal point
 *
 * The optical tube length is *not* 160. It is conventionally quoted around
 * 150 mm, the difference being the mechanical stack — the objective's rear focal
 * plane sits inside its barrel, and the intermediate image sits below the
 * eyepiece shoulder. Like § 6a's 200/180/165 tube-lens conventions these digits
 * are **widely quoted and not datasheet-verified here**; sources differ, and some
 * write "M = 160/f" outright, which conflates the two lengths and is a ~7% error
 * in the label. So the number is a parameter, spelled out in
 * `OPTICAL_TUBE_LENGTH_MM`, and every rung is a **ratio against whichever value
 * is stated** — exactly the split § 6a made. Nothing here rests on the digits.
 *
 * ## Why this cannot reuse § 6a's objective
 *
 * § 6a's note predicted this step would need no new machinery: finite conjugates
 * and `bestFocus` both exist, so a DIN objective looked like a placement problem.
 * Measuring it says otherwise. § 6a's doublet, whose bending was solved for a
 * collimated input, placed at DIN conjugates carries **0.46 waves** RMS on axis
 * — 6.5× past the diffraction limit. The reason is the position factor: S_I
 * depends on the object conjugate through p, quadratically and cross-multiplying
 * the bending (§ 6b.0), so the SA-null roots move. For the 4× they move 25%.
 *
 * So the bending is re-solved *at the conjugates the objective actually works
 * at*, and the two unknowns — the bending and the specimen plane — are coupled
 * (the plane depends on the lens's front focal distance, which depends on the
 * bending). They are settled by a fixed-point iteration, and the fixed point is
 * then **verified rather than trusted**: the conjugate the bending was solved for
 * must equal the conjugate the built objective is used at, or the constructor
 * throws. Without that check a lens solved for the wrong conjugate would still
 * pass every rung downstream, because the trace confirms whatever it was solved
 * for.
 *
 * ## Reciprocity does the turn-around
 *
 * The specimen faces the flint here as it does in § 6a, so the doublet is
 * mirrored — but `achromaticObjective` solves crown-first. It needs no second
 * solver, because third-order stigmatism is **reciprocal**: rays from A
 * converging on B is the same statement as rays from B converging on A. So the
 * bending that nulls S_I for the mirrored chain with the specimen at a is exactly
 * the one that nulls it for the crown-first chain with an object at the conjugate
 * distance b. The objective is solved at b and reversed, and § 6b.1 pins the two
 * routes' roots equal to 10 digits.
 */

/**
 * Mechanical tube length (mm) — the engraved number, shoulder to eyepiece seat.
 * Carried so the distinction from the optical tube length is written down rather
 * than implied; **nothing computes with it**, because the magnification does not.
 */
export const MECHANICAL_TUBE_LENGTH_MM = { din: 160, jis: 160 } as const;

/**
 * Optical tube length (mm) — Newton's x′, rear focal plane to intermediate
 * image, and the length the magnification is actually a ratio against. Widely
 * quoted near 150 for the 160 mm mechanical standard and **not datasheet-verified
 * here**; every rung is a ratio against whichever value is passed in.
 */
export const OPTICAL_TUBE_LENGTH_MM = { din: 150 } as const;

/** The default when none is named. */
export const DEFAULT_OPTICAL_TUBE_LENGTH_MM = OPTICAL_TUBE_LENGTH_MM.din;

export interface FiniteConjugateObjectiveSpec {
  /** Nominal magnification against `opticalTubeLengthMm` (e.g. 4 for a 4×). */
  readonly magnification: number;
  /** Object-space numerical aperture n·sin u. */
  readonly numericalAperture: number;
  /** Newton's x′ the magnification is quoted against (mm). Default 150. */
  readonly opticalTubeLengthMm?: number;
  readonly crownMedium?: string;
  readonly flintMedium?: string;
  readonly designWavelengthNm?: number;
  /**
   * Which face meets the specimen. `"flintFirst"` (default) is the mirrored
   * doublet § 6a.1 measured; `"crownFirst"` builds the turn-around so the rungs
   * can measure what the choice is worth **with each orientation solved for its
   * own conjugates**, which is a different and much closer contest than § 6a's.
   */
  readonly orientation?: "flintFirst" | "crownFirst";
  /**
   * Glass semi-aperture as a multiple of the stop radius. Unlike a telescope
   * objective's, a finite-conjugate pencil is still diverging at surface 0 and
   * keeps climbing across the elements, so the glass cannot be sized to the stop.
   * Default 1.12, which clears both orientations at NA 0.10; the trace's `lost`
   * count is what checks it.
   */
  readonly glassMarginFactor?: number;
  /**
   * The cover glass this objective is **corrected for** — the `0.17` of the
   * `160/0.17` engraving. Omitted, the objective is corrected for none and the
   * specimen sits bare in air, which is what every rung before § 6c means.
   *
   * Given, three things change together and none of them is cosmetic: the
   * specimen moves *inside* the glass (`objectMedium` becomes the slip), the
   * lens is placed by an air gap rather than the whole object distance, and the
   * bending is re-solved to ΣS_I = −(the plate's), so the pair is stigmatic and
   * the lens alone deliberately is not.
   */
  readonly coverslip?: CoverslipSpec;
}

export interface FiniteConjugateObjective {
  /**
   * The objective alone, authored **specimen-side first**, trailing thickness 0.
   * Exactly one stop flag, on `stopSurfaceIndex` — surface 0 bare, surface 1
   * with a coverslip, whose upper face takes the front of the list and is not an
   * aperture.
   */
  readonly prescription: Prescription;
  /** x′/M (mm) — the focal length the nominal magnification implies. */
  readonly focalLengthMm: number;
  /** Traced paraxial EFL at the design wavelength (mm). */
  readonly paraxialFocalLengthMm: number;
  /**
   * Solved specimen plane: surface 0's vertex to the object (mm, in front) —
   * i.e. the system's conjugate distance in both cases. **With a coverslip that
   * is the slip thickness**, because surface 0 is then the slip's upper face and
   * the specimen is against its underside; the air path is `airGapMm`.
   */
  readonly objectDistanceMm: number;
  /** The cover glass the bending was solved for, if any. */
  readonly coverslip?: Coverslip;
  /**
   * Slip upper face → objective front vertex (mm). Equal to `objectDistanceMm`
   * when there is no slip: it is the air the objective is placed across, which
   * is the whole object distance for a bare specimen.
   */
  readonly airGapMm: number;
  /**
   * Objective front vertex → where the specimen *appears* to be (mm): the
   * air-equivalent object distance the lens is actually solved and placed for.
   * Larger than `airGapMm` by the slip's apparent depth, and equal to
   * `objectDistanceMm` when there is none. **Solved from the traced paraxial
   * chain, never from t/n** — which is what leaves the apparent-depth closed
   * form free to be an external pin (§ 6c).
   */
  readonly airEquivalentObjectDistanceMm: number;
  /**
   * Front glass to the nearest thing in front of it (mm): the slip's upper face
   * if there is one, the specimen if not, less the front surface's own sag. The
   * number an objective is catalogued by, and what a slide has to fit inside.
   */
  readonly freeWorkingDistanceMm: number;
  /** Which surface carries the aperture stop: 0 bare, 1 behind a coverslip. */
  readonly stopSurfaceIndex: number;
  /** Last vertex to the intermediate image (mm), from the paraxial trace. */
  readonly imageDistanceMm: number;
  /** The optical tube length asked for (mm) — Newton's x′. */
  readonly opticalTubeLengthMm: number;
  /**
   * The optical tube length the traced lens actually delivers (mm):
   * `imageDistanceMm` − BFD. Parts in 10⁴ under the nominal, the same Gullstrand
   * remainder § 5j leaves in the focal length.
   */
  readonly tracedOpticalTubeLengthMm: number;
  /**
   * Aperture stop semi-diameter (mm) — the cone from the specimen that delivers
   * the stated NA at the objective's front vertex. Bare, that is
   * objectDistance·tan u. Behind a slip the marginal ray is aimed at the
   * *entrance pupil*, which the plate pushes back to n·airGap, so what the
   * launch angle sees is (t + n·w)·tan u_glass with sin u_glass = NA/n — one
   * formula that collapses to the bare one at n = 1, and the one that will carry
   * an immersion medium unchanged.
   */
  readonly stopRadiusMm: number;
  /** f/(2·stopRadius): the working focal ratio, faster than 1/(2·NA) by (1+1/M). */
  readonly workingFocalRatio: number;
  /**
   * ΣS_I (mm) of the built objective **including the coverslip if it has one**,
   * evaluated at the conjugates it is actually used at. Zero to solver precision
   * — and it is a *readout*, not an assumption: the constructor computes it on
   * the real chain, in the real frame, after the fixed point closes. With a slip
   * that is a genuinely independent check, because the target was computed in
   * the reversed frame the bending is solved in (§ 6c).
   */
  readonly seidelS1AtWorkingConjugates: number;
  /**
   * ΣS_I (mm) of the objective GLASS alone at those conjugates. Zero without a
   * coverslip; with one it is plus the plate's, which is the whole content of
   * "corrected for 0.17" — the lens is built aberrated on purpose.
   */
  readonly seidelS1OfGlassAlone: number;
  /** The crown-first doublet this was solved as. */
  readonly doublet: AchromaticObjective;
  readonly orientation: "flintFirst" | "crownFirst";
  readonly numericalAperture: number;
  readonly designWavelengthNm: number;
}

/** Paraxial image distance from the last vertex, for an object `s` in front. */
function paraxialImageDistance(p: Prescription, s: number, wavelengthNm: number): number {
  const r = paraxialTrace(p, wavelengthNm, { y: s, u: 1 });
  if (!(Math.abs(r.u) > 0)) {
    throw new Error("finiteConjugateObjective: the chain leaves the axial cone collimated");
  }
  return -r.y / r.u;
}

/**
 * One stop flag — on surface 0 bare, on the objective's first glass surface
 * behind a coverslip — and the stated trailing thickness. See § 6a's note on why
 * the flag has to be re-declared rather than inherited.
 */
const asObjective = (p: Prescription, trailingMm: number, stopAt = 0): Prescription => ({
  ...p,
  surfaces: p.surfaces.map((s, i) => ({
    ...s,
    isStop: i === stopAt,
    ...(i === p.surfaces.length - 1 ? { thickness: trailingMm } : {}),
  })),
});

/** Sag of a sphere of curvature c at radius r — for the working-distance clearance. */
const sag = (c: number, r: number): number => {
  if (!Number.isFinite(r)) return 0;
  const d = 1 - c * c * r * r;
  if (d <= 0) return c * r * r;
  return (c * r * r) / (1 + Math.sqrt(d));
};

/**
 * A DIN/JIS objective: an achromatic doublet whose bending is solved for the
 * finite conjugate pair it works at, with the specimen plane placed by Newton's
 * equation so the magnification is x′/f.
 */
export function finiteConjugateObjective(
  spec: FiniteConjugateObjectiveSpec,
): FiniteConjugateObjective {
  const M = spec.magnification;
  const NA = spec.numericalAperture;
  if (!(M > 0)) throw new Error("finiteConjugateObjective: magnification must be positive");
  if (!(NA > 0) || NA >= 1) {
    throw new Error("finiteConjugateObjective: a dry objective's NA must lie in (0, 1)");
  }
  const opticalTubeLengthMm = spec.opticalTubeLengthMm ?? DEFAULT_OPTICAL_TUBE_LENGTH_MM;
  if (!(opticalTubeLengthMm > 0)) {
    throw new Error("finiteConjugateObjective: the optical tube length must be positive");
  }
  const designWavelengthNm = spec.designWavelengthNm ?? LINE_D;
  const orientation = spec.orientation ?? "flintFirst";
  const glassMarginFactor = spec.glassMarginFactor ?? 1.12;
  const glasses = {
    ...(spec.crownMedium === undefined ? {} : { crownMedium: spec.crownMedium }),
    ...(spec.flintMedium === undefined ? {} : { flintMedium: spec.flintMedium }),
  };
  const slip = spec.coverslip === undefined ? undefined : coverslip(spec.coverslip);
  const nSlip = slip === undefined ? 1 : coverslipIndex(slip, designWavelengthNm);
  const tSlip = slip === undefined ? 0 : slip.thicknessMm;
  const stopIdx = slip === undefined ? 0 : 1;

  // Newton: |M| = x′/f fixes the focal length outright.
  const f = opticalTubeLengthMm / M;
  // The cone the specimen radiates into, IN the medium it sits in: sin u = NA/n.
  // Bare (n = 1) this is the old tan u exactly; behind a slip it is the smaller
  // internal angle, and the entrance pupil the marginal ray is aimed at sits
  // n·airGap away, so the stop the two together fill is (t + n·w)·tan u_glass.
  const sinU = NA / nSlip;
  if (!(sinU < 1)) {
    throw new Error("finiteConjugateObjective: NA exceeds the object medium's index");
  }
  const tanU = sinU / Math.sqrt(1 - sinU * sinU);
  const stopPerAirDistance = nSlip * tanU;

  /** The real chain: slip's upper face, the air gap, then the glass. */
  const withSlip = (bareP: Prescription, airGapMm: number): Prescription =>
    slip === undefined
      ? bareP
      : {
          ...bareP,
          objectMedium: slip.medium,
          surfaces: [coverslipSurface(airGapMm), ...bareP.surfaces],
        };

  /**
   * The air gap that puts the specimen — at the slip's underside, a thickness
   * `tSlip` in front of surface 0 — onto the same image the bare lens forms of
   * an object `aAir` away. Solved on the traced paraxial chain by secant, NOT by
   * subtracting the apparent depth t/n: that closed form is the external pin
   * (§ 6c) and using it here would leave nothing to check.
   */
  const solveAirGap = (bareP: Prescription, aAir: number, imageMm: number): number => {
    // Trailing thickness zeroed: `paraxialImageDistance` measures from the last
    // vertex and `paraxialTrace` has already advanced by whatever gap the chain
    // carries. A crown-first doublet still carries its own back focus there, and
    // leaving it in silently offsets every gap this solves.
    const chain = asObjective(bareP, 0);
    const err = (w: number): number =>
      paraxialImageDistance(withSlip(chain, w), tSlip, designWavelengthNm) - imageMm;
    let w0 = aAir;
    let w1 = aAir - 0.5 * tSlip;
    let f0 = err(w0);
    let f1 = err(w1);
    for (let i = 0; i < 80 && Math.abs(w1 - w0) > 1e-15 * Math.abs(w1); i++) {
      const df = f1 - f0;
      if (!(Math.abs(df) > 0)) break;
      const w2 = w1 - (f1 * (w1 - w0)) / df;
      w0 = w1;
      f0 = f1;
      w1 = w2;
      f1 = err(w1);
    }
    if (!(w1 > 0) || !Number.isFinite(w1)) {
      throw new Error("finiteConjugateObjective: the coverslip air-gap solve did not converge");
    }
    return w1;
  };

  /**
   * MINUS the plate's own ΣS_I, in the frame `achromaticObjective` solves in —
   * which for a mirrored objective is the REVERSED one, where the specimen side
   * is the image side and the plate is therefore appended rather than prepended.
   *
   * Summed by `seidelSums` over real surfaces, not evaluated from the plate's
   * closed form: the closed form is § 6c's external pin, and a design that built
   * itself from it would be checking its own arithmetic.
   */
  const plateTargetS1 = (
    d: AchromaticObjective,
    apertureMm: number,
    airGapMm: number,
    aAir: number,
    bConj: number,
  ): number => {
    if (slip === undefined) return 0;
    const glass = d.prescription.surfaces;
    const h = apertureMm / 2;
    if (orientation === "flintFirst") {
      // Solve frame: crown first, object at b, the slip in the image space —
      // the air gap, then the plate, then the specimen on its far face.
      const opts = { marginalHeightMm: h, objectDistanceMm: bConj };
      const appended: Prescription = {
        ...d.prescription,
        surfaces: [
          ...glass.slice(0, -1),
          { ...glass[glass.length - 1]!, thickness: airGapMm },
          // Air INTO the slip here — the reversed frame crosses the same face
          // the other way, so this is not `coverslipSurface`'s glass-into-air.
          {
            kind: "refract" as const,
            curvature: 0,
            semiAperture: Infinity,
            thickness: tSlip,
            medium: slip.medium,
          },
        ],
      };
      return -(
        seidelSums(appended, designWavelengthNm, opts).s1 -
        seidelSums(d.prescription, designWavelengthNm, opts).s1
      );
    }
    // Solve frame IS the real one: the plate leads. Its marginal ray is the same
    // physical ray, so it is seeded at the height that reaches the crown at h.
    const h0 = (tSlip * h) / (tSlip + nSlip * airGapMm);
    return -(
      seidelSums(withSlip(d.prescription, airGapMm), designWavelengthNm, {
        marginalHeightMm: h0,
        objectDistanceMm: tSlip,
      }).s1 -
      seidelSums(d.prescription, designWavelengthNm, {
        marginalHeightMm: h,
        objectDistanceMm: aAir,
      }).s1
    );
  };

  // Thin-lens first guess, measured from the principal planes: the object sits
  // f(1 + 1/M) in front, the image f(1 + M) behind. The iteration moves both onto
  // the thick lens's own vertices — and, with a slip, moves the air gap and the
  // plate's third-order target along with them.
  let a = f * (1 + 1 / M);
  let b = f * (1 + M);
  let airGapMm = a;
  let targetS1Mm = 0;
  let doublet!: AchromaticObjective;
  let bare!: Prescription;

  for (let i = 0; i < 60; i++) {
    // The glass is sized off the stop the specimen plane implies. S_I ∝ h⁴
    // exactly, so the root of S_I(c₁) = target does not move with the aperture —
    // the sizing cannot pull the design around, it only decides how much glass
    // there is (and, through the defaulted thicknesses, a weak second-order
    // coupling the iteration absorbs).
    const stop = a * stopPerAirDistance;
    const D = 2 * stop * glassMarginFactor;
    doublet = achromaticObjective({
      apertureMm: D,
      focalRatio: f / D,
      // Reciprocity: the mirrored chain at object a is the crown-first chain at
      // the conjugate b. See the header.
      objectDistanceMm: orientation === "flintFirst" ? b : a,
      ...glasses,
      designWavelengthNm,
      targetS1Mm,
    });
    bare = orientation === "flintFirst"
      ? reversePrescription(doublet.prescription, 0)
      : doublet.prescription;

    const efl = systemProperties(bare, designWavelengthNm).efl;
    const ffd = collimatingObjectDistance(bare, designWavelengthNm);
    // Newton again: the specimen sits f/M beyond the front focal point. That is
    // the AIR-EQUIVALENT plane — the plate has no power, so it moves the lens,
    // not the conjugates.
    const aNext = ffd + efl / M;
    const bNext = paraxialImageDistance(asObjective(bare, 0), aNext, designWavelengthNm);
    const gapNext = slip === undefined ? aNext : solveAirGap(bare, aNext, bNext);
    const moved = Math.max(Math.abs(aNext - a), Math.abs(bNext - b));
    a = aNext;
    b = bNext;
    airGapMm = gapNext;
    const targetNext = plateTargetS1(
      doublet,
      2 * a * stopPerAirDistance * glassMarginFactor,
      airGapMm,
      a,
      b,
    );
    // The target has to be converged too, not just the conjugates: the lens in
    // hand was built with the PREVIOUS one, and a stale target is a lens solved
    // for a plate that is not quite the one in front of it.
    const targetMoved = Math.abs(targetNext - targetS1Mm);
    targetS1Mm = targetNext;
    if (
      moved < 1e-13 * (Math.abs(a) + Math.abs(b)) &&
      targetMoved <= 1e-13 * Math.abs(targetNext)
    ) {
      break;
    }
  }

  // Read the final geometry off the lens that was actually BUILT, not off the
  // iteration's variables.
  const paraxialFocalLengthMm = systemProperties(bare, designWavelengthNm).efl;
  const ffd = collimatingObjectDistance(bare, designWavelengthNm);
  const airEquivalentObjectDistanceMm = ffd + paraxialFocalLengthMm / M;
  const objectDistanceMm = slip === undefined ? airEquivalentObjectDistanceMm : tSlip;
  const prescription = asObjective(withSlip(bare, airGapMm), 0, stopIdx);
  const imageDistanceMm = paraxialImageDistance(prescription, objectDistanceMm, designWavelengthNm);

  // ANTI-CIRCULARITY. The bending was solved for one conjugate; the objective is
  // used at another. If the fixed point has not closed, those differ — and every
  // rung downstream would still pass, because the trace confirms whatever the
  // lens was solved for. So the two are compared explicitly.
  const solvedAt = doublet.objectDistanceMm;
  const usedAt =
    orientation === "flintFirst" ? imageDistanceMm : airEquivalentObjectDistanceMm;
  if (solvedAt === undefined || !(Math.abs(solvedAt - usedAt) <= 1e-9 * Math.abs(usedAt))) {
    throw new Error(
      `finiteConjugateObjective: the conjugate solve did not converge — bending solved for ${solvedAt?.toFixed(6)} mm, objective used at ${usedAt.toFixed(6)} mm`,
    );
  }

  const stopRadiusMm = airEquivalentObjectDistanceMm * stopPerAirDistance;
  // The marginal ray's height where the chain STARTS: at the slip's face it has
  // only crossed the glass, so it is short of the stop by the plate's transfer.
  const seidelMarginalHeightMm =
    slip === undefined
      ? stopRadiusMm
      : (tSlip * stopRadiusMm) / (tSlip + nSlip * airGapMm);
  // ANTI-CIRCULARITY, second half. The conjugate check above cannot see a stale
  // coverslip target: a lens solved for a plate slightly unlike the one in front
  // of it sits at the right conjugates and images perfectly happily. The residual
  // is measured on the REAL chain in the REAL frame, and scaled against the sum
  // of the surfaces' individual contributions — the same "cancellation" currency
  // `achromaticObjective` picks its branch on, which is a meaningful magnitude
  // whether or not there is a slip (with none, both sides are ~1e-16 and a
  // relative test on the total alone would be noise against noise).
  const workingSums = seidelSums(prescription, designWavelengthNm, {
    marginalHeightMm: seidelMarginalHeightMm,
    objectDistanceMm,
  });
  const cancellation = workingSums.surfaces.reduce((total, x) => total + Math.abs(x.s1), 0);
  if (!(Math.abs(workingSums.s1) <= 1e-9 * cancellation)) {
    throw new Error(
      `finiteConjugateObjective: the spherical-aberration solve did not converge — ΣS_I = ${workingSums.s1.toExponential(3)} mm against a cancellation scale of ${cancellation.toExponential(3)} mm`,
    );
  }

  const front = bare.surfaces[0]!;
  const freeWorkingDistanceMm =
    (slip === undefined ? airEquivalentObjectDistanceMm : airGapMm) -
    sag(front.curvature, front.semiAperture);
  return {
    prescription,
    focalLengthMm: f,
    paraxialFocalLengthMm,
    objectDistanceMm,
    imageDistanceMm,
    opticalTubeLengthMm,
    tracedOpticalTubeLengthMm:
      imageDistanceMm - systemProperties(prescription, designWavelengthNm).bfd,
    ...(slip === undefined ? {} : { coverslip: slip }),
    airGapMm,
    airEquivalentObjectDistanceMm,
    freeWorkingDistanceMm,
    stopSurfaceIndex: stopIdx,
    stopRadiusMm,
    workingFocalRatio: f / (2 * stopRadiusMm),
    seidelS1AtWorkingConjugates: workingSums.s1,
    seidelS1OfGlassAlone: seidelSums(asObjective(bare, 0), designWavelengthNm, {
      marginalHeightMm: stopRadiusMm,
      objectDistanceMm: airEquivalentObjectDistanceMm,
    }).s1,
    doublet,
    orientation,
    numericalAperture: NA,
    designWavelengthNm,
  };
}

export interface FiniteConjugateSpec {
  readonly objective: FiniteConjugateObjective;
  /** Object heights (mm from the axis) the system's field is spelled with. */
  readonly objectHeightsMm?: readonly number[];
  readonly wavelengths?: readonly { readonly nm: number; readonly weight: number }[];
}

export interface FiniteConjugateMicroscope {
  readonly system: OpticalSystem;
  /** The objective alone — a DIN microscope has no tube lens, by definition. */
  readonly prescription: Prescription;
  /** x′/f_obj — what the engraving claims, against the stated tube length. */
  readonly nominalMagnification: number;
  readonly objectDistanceMm: number;
  readonly imageDistanceMm: number;
  readonly opticalTubeLengthMm: number;
}

/**
 * The DIN microscope: the objective, the specimen on its solved plane, and the
 * intermediate image where Newton puts it. There is nothing between them — that
 * absence *is* the architecture, and the reason the objective had to carry the
 * whole correction itself.
 */
export function finiteConjugateMicroscope(spec: FiniteConjugateSpec): FiniteConjugateMicroscope {
  const { objective } = spec;
  const prescription = asObjective(
    objective.prescription,
    objective.imageDistanceMm,
    objective.stopSurfaceIndex,
  );
  const system: OpticalSystem = {
    prescription,
    aperture: { kind: "stopRadius", value: objective.stopRadiusMm },
    field: { kind: "objectHeight", values: spec.objectHeightsMm ?? [0] },
    wavelengths: spec.wavelengths ?? [{ nm: objective.designWavelengthNm, weight: 1 }],
    conjugate: { kind: "finite", distance: objective.objectDistanceMm },
  };
  return {
    system,
    prescription,
    nominalMagnification: objective.opticalTubeLengthMm / objective.focalLengthMm,
    objectDistanceMm: objective.objectDistanceMm,
    imageDistanceMm: objective.imageDistanceMm,
    opticalTubeLengthMm: objective.opticalTubeLengthMm,
  };
}
