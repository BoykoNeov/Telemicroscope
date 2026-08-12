import { Prescription, SurfaceSpec, reversePrescription } from "../trace/prescription";
import { paraxialTrace, systemProperties } from "../trace/paraxial";
import { collimatingObjectDistance, spliceModules } from "../trace/compose";
import { OpticalSystem } from "../trace/system";
import { LINE_D } from "../materials/dispersion";
import { seidelSums } from "../analysis/seidel";
import { AchromaticObjective, DoubletApertureRefusal, achromaticObjective } from "./achromat";
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
 * form; the Lister two-doublet (`designs/lister`, § 6d) and the aplanatic
 * immersion front are the named follow-ons. The Lister has since landed and is an
 * aplanat where this is not — but it walls out at NA 0.343, so it is the immersion
 * front that carries the high apertures, and that is where the dispersive oil and
 * D263 already in the catalog (§ 1) start doing work.
 *
 * ## Where the stop goes, and why it moved (§ 6v)
 *
 * A real objective puts its aperture stop at the **back focal plane**, which
 * makes it object-space telecentric: the chief ray leaves every specimen point
 * parallel to the axis, so the magnification does not drift with defocus. That
 * puts the entrance pupil at infinity, and `aimRay` refused it outright — so
 * this module shipped the stop on the objective's own specimen-side rim
 * instead, and said so here, while §§ 6f/6h/6m/6o each assumed telecentricity
 * of their *condenser*. The illumination assumed what the objective was not.
 *
 * § 6u closed that gap and § 6v spends it: `stopPlacement` defaults to
 * `"backFocal"`, and the old placement stays reachable as `"rim"` — as the
 * **negative control**, because what telecentricity buys has no measurable size
 * without a system that lacks it. What the two differ in:
 *
 *  - The radius. `f·tan u` at the back focal plane against `s·tan u` on the
 *    rim, and the first has no object distance in it: § 6u.1's aperture is the
 *    SLOPE `stopRadius/B`, and a stop at the back focal plane is exactly what
 *    makes B the focal length, so the f cancels and the slope aperture is
 *    `tan u` with no lens left in it.
 *  - The magnification under defocus: **bitwise** constant, against a control
 *    that loses 0.1% over 50 µm of specimen travel.
 *  - Off axis, the price. A rim stop pivots every bundle through one hole at the
 *    front vertex, so the footprint on the glass never moves; a telecentric one
 *    lets it TRANSLATE with the object height, and it walks off an element sized
 *    for the axial beam. Measured **on the 4×/0.10**: nothing lost to ~0.1 mm of
 *    field, 11% of the pupil at 1 mm, 35% at 3 mm. Those are that lens's numbers
 *    and they do not travel — the rim goes as f·NA while a field is absolute, so
 *    at 40×/0.10 the same 1 mm is past total occlusion. A real objective's front
 *    element is much larger than its axial beam for exactly this reason, and
 *    oversizing it here is the named next step rather than something done
 *    quietly, since the field an objective must pass is not currently part of
 *    its spec.
 *  - **On axis, nothing.** The two constructions aim the SAME rays: the rim
 *    targets `ρ·s·tan u` a distance s away, giving slope `ρ·tan u`, and the
 *    telecentric one names that slope directly. Which is why moving the default
 *    moved almost nothing in the ladder.
 *
 * ## What field the glass is sized for (§ 6w)
 *
 * § 6v's price, paid. A telecentric bundle from object height h reaches the
 * element centred on h, so the glass a field needs is
 *
 *     glass semi-diameter = f·NA + h,   h = fieldNumberMm/(2·M)
 *
 * — the axial beam plus the walk. `fieldNumberMm` is that field, in the currency
 * a microscope states it in: the diameter at the intermediate image, the same
 * number § 6q splices in as a real field stop. The **oversize is a ratio the
 * magnification cancels out of**,
 *
 *     glass/beam = 1 + FN/(2·f_tube·NA)
 *
 * because h and f·NA are both ∝ 1/M — so § 6v.5's "those figures do not travel"
 * is true in millimetres and false as a fraction: the 4× and the 40× need the
 * same proportional element, and it was only the 40×'s absolute one that looked
 * hopeless.
 *
 * The doublet is **built** at that aperture rather than having its rim widened
 * afterwards, which is `finiteConjugateObjective`'s `glassMarginFactor` route and
 * is not merely for consistency: `achromaticObjective` defaults its thicknesses
 * off D and checks the edge thickness at D/2, so an element widened after the
 * fact would have passed a check for a rim it does not have. What that costs is
 * real and is measured rather than waved at (§ 6w.4): thicker glass moves the
 * principal planes, so the working distance and the stop radius both shift, and
 * the *delivered* NA survives only because it is re-derived as `f·tan u` on the
 * lens actually built.
 *
 * ## The coverslip, and the two things it couples to (§ 6z)
 *
 * § 6c's named deferral, closed. `coverslip` puts the specimen against the
 * underside of a plate the objective is then **corrected for**: the bending is
 * solved to ΣS_I = −(the plate's), so the pair is stigmatic and the glass alone
 * deliberately is not. That is `finiteConjugateObjective`'s move at a different
 * conjugate, and two couplings are new here.
 *
 * **The plate's position is not free.** A plate crossed by both faces in one
 * medium contributes a spherical aberration that does not depend on where it
 * sits — but a *coverslip* is not that plate: the specimen is INSIDE it, so the
 * chain crosses one face and the aberration is set by the depth below it. Move
 * the face without re-solving the air gap and the sum silently reports the
 * distance from the face to the image instead of the slip's own thickness: 1.90×
 * the truth a tenth of a millimetre out, 9.96× at one, 403× with the plate laid
 * against the glass (§ 6z.2). So the gap and the target are one fixed point, not
 * two steps.
 *
 * **The field number does not enter the currency.** § 6w's oversized element
 * means D/2 is no longer the marginal ray's height, and `targetS1Mm` is evaluated
 * at D/2. The target here is therefore summed at D/2 as well — the same currency
 * the solver quotes in — because the Seidel sums are homogeneous of degree 4 in
 * the marginal ray, so one currency for both sides cancels at every height. What
 * that buys is measured on the delivered lens: `seidelS1OfGlassAlone` is the same
 * number to 10 digits with FN 18 and without it, where a caller who measured the
 * plate on the real beam and passed it unscaled would leave `1 − (beam/glass)⁴`
 * uncorrected — 77.4% on the 4×/0.10 at FN 18 (§ 6z.5).
 *
 * ## …and the price is LINEAR IN MAGNIFICATION, which § 6w's is not
 *
 * The plate asks the same absolute correction of every member of the family: its
 * aberration is set by t, n and the aperture, and none of those knows what the
 * objective's focal length is — `seidelS1OfGlassAlone` is one number to 7 digits
 * over M = 4→40. What the lens can supply is not scale-free in the same way: a
 * Seidel sum has the dimension of a length, so a lens scaled down by ten has a
 * tenth the S_I to trade with. So the correction costs a 40× ten times what it
 * costs a 4× — the bending moves 3.11e-4 → 3.10e-3, and the aperture ceiling
 * gives up 0.0123% → 0.1224%, both linear in M (§ 6z.6).
 *
 * That is § 6w's finding turned over on the same lens family. There the oversize
 * was a RATIO the magnification cancels out of, so the 4× and the 40× were one
 * lens scaled; here the slip is the one thing in the branch that does not scale,
 * so nothing cancels. It is also why a correction collar is a high-power fitting.
 *
 * SCOPE: the dry, cemented member only. `designs/lister` and the immersion front
 * take no target at all, so correcting *those* for a stack is § 6e's own open
 * item and not this one.
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
  /**
   * Where the aperture stop sits. Default `"backFocal"` — a diaphragm on the
   * group's back focal plane, which is what a real objective has and what makes
   * it object-space telecentric (§ 6v).
   *
   * `"rim"` puts it on the specimen-side glass rim instead. That is what this
   * module shipped while `aimRay` refused an entrance pupil at infinity, and it
   * is kept as the **named negative control**: the property telecentricity buys
   * is only measurable against a system that does not have it.
   */
  readonly stopPlacement?: StopPlacement;
  /**
   * The field number (mm) this objective must pass — the diameter of the field
   * at the INTERMEDIATE IMAGE, which is how a microscope's field is catalogued
   * (§ 6q splices one in as a real annular stop, and the app's stage uses 18).
   * The object-space semi-field it implies is `fieldNumberMm/(2·M)`, and the
   * glass is sized to `f·NA + that` so a telecentric bundle from the field edge
   * still lands on the element (§ 6w).
   *
   * **Omitted — the default — the glass is sized to the axial beam alone**,
   * `f·NA`, which is every objective this module built before § 6w and is what
   * § 6v.5 measured vignetting: 11% of the pupil gone at 1 mm of field on the
   * 4×/0.10, and past total occlusion on the 40×.
   *
   * Not defaulted to a number, and the reason is not caution. A stop position is
   * intrinsic to an objective, which is why § 6v could default telecentricity on;
   * the field an objective must pass is a property of the objective **together
   * with whatever stops the field downstream** — an eyepiece's field stop, a
   * sensor's diagonal — so there is no physics that picks a value. A caller that
   * knows its field says so; one that does not gets the axial lens and § 6v.5's
   * numbers, which is now the negative control this step is measured against.
   *
   * Refused with `stopPlacement: "rim"` — see `microscopeObjective`.
   */
  readonly fieldNumberMm?: number;
  /**
   * The cover glass this objective is **corrected for** — `finiteConjugateSpec`'s
   * `coverslip` at the other architecture's conjugates (§ 6z). Omitted, the
   * specimen sits bare in air, which is every rung before § 6z.
   *
   * Given, three things move together: the specimen goes *inside* the glass
   * (`objectMedium` becomes the slip and `objectDistanceMm` becomes its
   * thickness), the lens is placed by an air gap solved so the specimen still
   * lands on its front focus, and the bending is re-solved to minus the plate's
   * ΣS_I. See the module header for the two couplings that are this
   * architecture's own.
   */
  readonly coverslip?: CoverslipSpec;
}

/** Where an objective's aperture stop sits. See `MicroscopeObjectiveSpec`. */
export type StopPlacement = "backFocal" | "rim";

/**
 * What `infinityCorrectedMicroscope` needs of an objective, and nothing more —
 * the contract, not one preset's shape. The architecture's position is that an
 * objective is a *module*: `designs/lister`'s two-doublet aplanat satisfies this
 * and composes unchanged, which is the point of writing it down.
 */
export interface InfinityCorrectedObjective {
  /**
   * The objective alone, authored **specimen-side first**, trailing thickness 0:
   * the gap into the infinity space belongs to whatever follows.
   */
  readonly prescription: Prescription;
  /** f_tube / M (mm) — the focal length the nominal magnification implies. */
  readonly focalLengthMm: number;
  /** Specimen plane, in front of surface 0's vertex (mm) — the front focal distance. */
  readonly objectDistanceMm: number;
  /** Aperture stop semi-diameter (mm): the cone that delivers the stated NA. */
  readonly stopRadiusMm: number;
  /**
   * How far past the module's last GLASS vertex its own stop sits (mm), if it
   * carries one there. Omitted or 0 means the stop is on the glass, which is
   * every objective that does not place a diaphragm of its own.
   *
   * `infinityCorrectedMicroscope` subtracts it from the infinity space, so that
   * space keeps meaning "last glass vertex → tube lens" whether or not the
   * objective is telecentric (§ 6v).
   */
  readonly stopDistanceMm?: number;
  readonly designWavelengthNm: number;
}

export interface MicroscopeObjective extends InfinityCorrectedObjective {
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
   * Semi-aperture of the axial BEAM, f·NA (mm) — the sine-condition height the
   * emergent marginal ray lands at. Not the stop radius; see the header. Before
   * § 6w this was also the glass's own semi-diameter, and the name still says
   * "pupil" because that is what it is; `glassRadiusMm` is the element.
   */
  readonly pupilRadiusMm: number;
  /**
   * Semi-diameter of the GLASS (mm) — `f·NA` axially sized, `f·NA + h` with a
   * field number, h being the object-space semi-field. The two are equal exactly
   * when `fieldNumberMm` is omitted, which is what makes § 6w's comparison a
   * comparison (§ 6w.1).
   */
  readonly glassRadiusMm: number;
  /**
   * Object-space semi-field the glass was sized for (mm): `fieldNumberMm/(2·M)`,
   * or 0 when no field number was given. What the traced bundle's chief ray is
   * at when it reaches the element, because the objective is telecentric.
   */
  readonly objectFieldRadiusMm: number;
  /** The field number the glass was sized for (mm), if any. */
  readonly fieldNumberMm?: number;
  /**
   * The aperture stop's semi-diameter (mm): s·tan u, the cone from the solved
   * specimen plane that actually delivers NA at the front vertex. 2% under
   * `pupilRadiusMm` for the 4×/0.10, and it is the one that sets the NA.
   */
  readonly stopRadiusMm: number;
  /** Which of the two placements this objective was built with (§ 6v). */
  readonly stopPlacement: StopPlacement;
  /**
   * Last glass vertex → the stop (mm). The group's back focal distance for a
   * `"backFocal"` objective; 0 for a `"rim"` one, where the stop is surface 0.
   */
  readonly stopDistanceMm: number;
  /** 1/(2·NA) — a function of NA alone. */
  readonly focalRatio: number;
  /**
   * Solved specimen plane: distance from surface 0's vertex to the object, in
   * front of it (mm) — the system's conjugate distance either way. **With a
   * coverslip that is the slip thickness**, because surface 0 is then the slip's
   * upper face and the specimen is against its underside; the air path is
   * `airGapMm` and the plane the lens is really placed for is
   * `airEquivalentObjectDistanceMm`.
   */
  readonly objectDistanceMm: number;
  /** The cover glass the bending was solved for, if any (§ 6z). */
  readonly coverslip?: Coverslip;
  /**
   * Slip upper face → objective front vertex (mm). Equal to `objectDistanceMm`
   * when there is no slip, where the whole object distance is air.
   */
  readonly airGapMm: number;
  /**
   * Objective front vertex → where the specimen *appears* to be (mm): the front
   * focal distance of the glass alone, which is the plane the lens is placed
   * across. Larger than `airGapMm` by the slip's apparent depth, and equal to
   * `objectDistanceMm` when there is none. **Read off the traced paraxial chain,
   * never from t/n** — that closed form is § 6c's external pin.
   */
  readonly airEquivalentObjectDistanceMm: number;
  /**
   * Front glass to the nearest thing in front of it (mm): the slip's upper face
   * if there is one, the specimen if not, less the front surface's own sag.
   */
  readonly freeWorkingDistanceMm: number;
  /** Which surface carries the aperture stop: 0 bare, 1 behind a coverslip. */
  readonly stopSurfaceIndex: number;
  /**
   * ΣS_I (mm) of the built objective **including the coverslip if it has one**,
   * at the conjugates it is actually used at. Zero to solver precision, and a
   * *readout* rather than an assumption: it is summed on the real chain in the
   * real frame, where the target was computed in the reversed one (§ 6z.3).
   */
  readonly seidelS1AtWorkingConjugates: number;
  /**
   * ΣS_I (mm) of the objective GLASS alone, on the same marginal ray. Zero
   * without a coverslip; with one it is plus the plate's, which is the whole
   * content of "corrected for 0.17" — the lens is built aberrated on purpose.
   */
  readonly seidelS1OfGlassAlone: number;
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
  const stopPlacement = spec.stopPlacement ?? "backFocal";
  const fieldNumberMm = spec.fieldNumberMm;
  if (fieldNumberMm !== undefined) {
    if (!(fieldNumberMm > 0) || !Number.isFinite(fieldNumberMm)) {
      throw new Error("microscopeObjective: the field number must be a positive length (mm)");
    }
    // A rim-stopped objective's bundles all pivot through surface 0, so its
    // footprint does not translate with field and there is nothing for a field
    // number to buy (§ 6v.5: what that control loses off axis is the TUBE LENS
    // catching the image height). Sizing its glass past the rim would also
    // decouple surface 0 from the rim it is named for, which is the one thing
    // the negative control has to keep. Refused rather than silently ignored.
    if (stopPlacement === "rim") {
      throw new Error(
        "microscopeObjective: a field number sizes the glass a TELECENTRIC bundle walks onto — a " +
          '"rim" stop pivots every bundle through surface 0, so its footprint does not translate ' +
          "with field and there is nothing to size for (§ 6w)",
      );
    }
  }

  const f = tubeFocalLengthMm / M;
  // Sine condition: the marginal ray leaves the object at sin u = NA and EMERGES
  // at height f·sin u, so the AXIAL BEAM spans 2·f·NA. The bending solve is
  // scale-free in this — S_I ∝ h⁴, so the root of S_I(c₁) = 0 and the branch pick
  // are the same at any aperture — which is why sizing the glass here and the
  // stop below cannot pull the design around.
  const pupilRadiusMm = f * NA;
  // …and the GLASS is that beam plus wherever the beam's centre has walked to.
  // A telecentric objective's chief ray leaves the specimen parallel to the axis,
  // so a bundle from object height h arrives at the element centred on h rather
  // than on the axis: the element it needs is `f·NA + h`, with h the object-space
  // semi-field the field number implies (§ 6w). Sized to the axial beam alone —
  // no field number — that walk runs off the glass, which is § 6v.5's whole cost.
  const objectFieldRadiusMm = fieldNumberMm === undefined ? 0 : fieldNumberMm / (2 * M);
  const glassRadiusMm = pupilRadiusMm + objectFieldRadiusMm;
  // 1/(2·NA) when the glass is the beam; faster than that once it is oversized,
  // and the doublet is genuinely built at the faster ratio — the thicknesses
  // default off D, and an element wider than its design aperture would pass an
  // edge-thickness check for a rim it does not have.
  const focalRatio = f / (2 * glassRadiusMm);

  const slip = spec.coverslip === undefined ? undefined : coverslip(spec.coverslip);
  const nSlip = slip === undefined ? 1 : coverslipIndex(slip, designWavelengthNm);
  const tSlip = slip === undefined ? 0 : slip.thicknessMm;
  const stopIdx = slip === undefined ? 0 : 1;
  // The cone the specimen radiates into, IN the medium it sits in: sin u = NA/n,
  // which is the bare tan u exactly at n = 1. What the aimer is handed is a
  // SLOPE, so every stop radius below is a distance times `stopPerAirDistance` —
  // the plate's own path counts n times an air millimetre, because a paraxial
  // flat face multiplies the slope by n.
  const sinU = NA / nSlip;
  const tanU = sinU / Math.sqrt(1 - sinU * sinU);
  const stopPerAirDistance = nSlip * tanU;

  /** The real chain: the slip's upper face, the air gap, then the glass. */
  const withSlip = (bareP: Prescription, airGapMm: number): Prescription =>
    slip === undefined
      ? bareP
      : {
          ...bareP,
          objectMedium: slip.medium,
          surfaces: [coverslipSurface(airGapMm), ...bareP.surfaces],
        };

  /**
   * The air gap that leaves the specimen — against the slip's underside, a
   * thickness `tSlip` in front of surface 0 — still on the objective's front
   * focus, so the output is collimated and the architecture is unchanged.
   *
   * Solved on the traced paraxial chain, NOT by subtracting the apparent depth
   * t/n: that closed form is § 6c's external pin and building from it would
   * leave nothing to check. The error is affine in the gap, so the secant is
   * exact rather than merely convergent — which is `collimatingGap`'s reason
   * (§ 6q) one module along.
   */
  const solveAirGap = (bareP: Prescription, aAir: number): number => {
    const err = (w: number): number =>
      collimatingObjectDistance(withSlip(bareP, w), designWavelengthNm) - tSlip;
    let w0 = aAir;
    let w1 = aAir - tSlip;
    let f0 = err(w0);
    let f1 = err(w1);
    for (let i = 0; i < 40 && Math.abs(w1 - w0) > 1e-15 * Math.abs(w1); i++) {
      const df = f1 - f0;
      if (!(Math.abs(df) > 0)) break;
      const w2 = w1 - (f1 * (w1 - w0)) / df;
      w0 = w1;
      f0 = f1;
      w1 = w2;
      f1 = err(w1);
    }
    if (!(w1 > 0) || !Number.isFinite(w1)) {
      throw new Error("microscopeObjective: the coverslip air-gap solve did not converge");
    }
    return w1;
  };

  /**
   * MINUS the plate's own ΣS_I, in the frame `achromaticObjective` solves in —
   * crown first, collimated in, so the specimen side is the IMAGE side and the
   * plate is appended rather than prepended, with the image landing inside it.
   *
   * Summed by `seidelSums` over real surfaces rather than evaluated from the
   * plate's closed form, which is § 6c's pin and stays free to be one. The
   * marginal height is the solver's own D/2, not the beam's `f·NA`: the Seidel
   * sums are homogeneous of degree 4 in the marginal ray, so quoting both sides
   * in one currency makes the cancellation exact at every height, and quoting
   * the plate at the beam instead would under-correct by (beam/glass)⁴ (§ 6z.5).
   */
  const plateTargetS1 = (d: AchromaticObjective, airGapMm: number): number => {
    if (slip === undefined) return 0;
    const g = d.prescription.surfaces;
    const opts = { marginalHeightMm: glassRadiusMm };
    const appended: Prescription = {
      ...d.prescription,
      surfaces: [
        ...g.slice(0, -1),
        { ...g[g.length - 1]!, thickness: airGapMm },
        // Air INTO the slip: the reversed frame crosses that face the other way,
        // so this is not `coverslipSurface`'s glass-into-air.
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
  };

  let doublet!: AchromaticObjective;
  let glass!: Prescription;
  let airGapMm = 0;
  let targetS1Mm = 0;
  // The gap and the target are ONE fixed point: the target is set by how deep the
  // specimen sits below the plate's face, and the face's place is set by the lens
  // the target builds. It closes in a handful of passes because the only thing
  // moving between them is the paraxial EFL, parts in 10⁴ (§ 6z.3). With no slip
  // the first pass is the whole of it and nothing below runs.
  for (let pass = 0; ; pass++) {
    try {
      doublet = achromaticObjective({
        apertureMm: 2 * glassRadiusMm,
        focalRatio,
        ...(spec.crownMedium === undefined ? {} : { crownMedium: spec.crownMedium }),
        ...(spec.flintMedium === undefined ? {} : { flintMedium: spec.flintMedium }),
        designWavelengthNm,
        ...(targetS1Mm === 0 ? {} : { targetS1Mm }),
      });
    } catch (e) {
      // The cemented-doublet form has an aperture wall of its own (§ 6b.5.7), and
      // a field number is a second way to walk into it: the glass is `f·NA + h`
      // against a focal length that does not grow with h, so a wide field makes the
      // element faster exactly as a high NA does. Which input to back off is not
      // recoverable from the aperture alone, so the message names both — § 6b.5.5's
      // rule that a refusal should say what to change.
      if (e instanceof DoubletApertureRefusal && fieldNumberMm !== undefined) {
        throw new Error(
          `microscopeObjective: field number ${fieldNumberMm} mm at NA ${NA} needs a ` +
            `${(2 * glassRadiusMm).toFixed(3)} mm element at f/${focalRatio.toFixed(3)} — ` +
            `${(pupilRadiusMm * 2).toFixed(3)} mm of axial beam plus ` +
            `${(2 * objectFieldRadiusMm).toFixed(3)} mm of field walk — and the cemented doublet ` +
            `refuses it: ${e.message}`,
        );
      }
      // A slip correction moves the target off zero and therefore moves the wall
      // (§ 6z.6): the bare lens at this aperture may well build. Say so, rather
      // than let a refusal read as a verdict on the aperture alone.
      if (e instanceof DoubletApertureRefusal && slip !== undefined) {
        throw new Error(
          `microscopeObjective: corrected for a ${tSlip} mm coverslip the bending is solved to ` +
            `ΣS_I = ${targetS1Mm.toExponential(3)} mm rather than to zero, and the cemented ` +
            `doublet refuses that at NA ${NA}: ${e.message}`,
        );
      }
      throw e;
    }

    // Turned around: flint toward the specimen. See the header — the un-mirrored
    // orientation is 9 waves of spherical aberration with an identical EFL.
    //
    // The stop flag travels with its surface under reversal (it is a property of
    // that piece of glass), so the doublet's front-surface stop lands on the
    // mirrored chain's LAST surface. Re-declared below so the objective's own
    // aperture is where `stopPlacement` says, and so the prescription is
    // self-consistent standing alone rather than only once composed.
    const mirrored = reversePrescription(doublet.prescription, 0);
    glass = {
      ...mirrored,
      surfaces: mirrored.surfaces.map((s) => ({ ...s, isStop: false })),
    };
    if (slip === undefined) break;
    airGapMm = solveAirGap(glass, collimatingObjectDistance(glass, designWavelengthNm));
    const next = plateTargetS1(doublet, airGapMm);
    const settled = Math.abs(next - targetS1Mm) <= 1e-14 * Math.abs(next);
    targetS1Mm = next;
    if (settled) break;
    if (pass >= 40) {
      throw new Error("microscopeObjective: the coverslip target did not converge");
    }
  }

  // Where the stop goes, and it is the difference between an objective and a
  // lens with a hole in front of it. See the header's telecentricity section.
  let prescription: Prescription;
  let stopRadiusMm: number;
  let stopDistanceMm: number;

  if (stopPlacement === "rim") {
    // The negative control (§ 6v.3), and what this module shipped before § 6u
    // made the real placement expressible. The stop is the specimen-side rim, s
    // from the specimen, so what fills it is s·tan u — not the sine-condition
    // height f·sin u. Kept reachable because "what does telecentricity buy" has
    // no answer without a system that does not have it.
    prescription = { ...glass, surfaces: glass.surfaces.map((s, i) => ({ ...s, isStop: i === 0 })) };
    stopDistanceMm = 0;
    stopRadiusMm =
      collimatingObjectDistance(prescription, designWavelengthNm) * stopPerAirDistance;
  } else {
    // A real objective's stop is a diaphragm at the group's BACK FOCAL PLANE,
    // which is what makes it object-space telecentric: the entrance pupil goes
    // to infinity, so the chief ray leaves every specimen point parallel to the
    // axis and the magnification stops depending on where the specimen is.
    //
    // The radius is `f·tan u` rather than the rim's `s·tan u`, and that is the
    // same statement one limit further out: § 6u.1's aperture is the SLOPE
    // `stopRadius/B`, with B the object→stop matrix's B element, and "stop at
    // the back focal plane" is exactly what makes B the group's focal length.
    // So `f·tan u` is what delivers tan u, with no object distance in it —
    // which is why the delivered NA no longer depends on the conjugate.
    const group = systemProperties(glass, designWavelengthNm);
    stopDistanceMm = group.bfd;
    // …and behind a coverslip the same slope argument keeps the same shape. The
    // aimer is handed the slope IN the object medium, and a paraxial flat face
    // multiplies a slope by n on the way out, so the B element the aperture
    // divides by is n·f rather than f. One expression, `tan u` at n = 1.
    stopRadiusMm = Math.abs(group.efl) * stopPerAirDistance;
    const last = glass.surfaces[glass.surfaces.length - 1]!;
    prescription = {
      ...glass,
      surfaces: [
        ...glass.surfaces.slice(0, -1),
        { ...last, thickness: stopDistanceMm },
        // The diaphragm is a real rim, so its clear semi-diameter IS the stop
        // radius: `apertureStop: "declared"` sizes the pupil from the
        // ApertureSpec, and this is the same number, so the two cannot drift.
        {
          kind: "refract" as const,
          curvature: 0,
          semiAperture: stopRadiusMm,
          thickness: 0,
          medium: "AIR",
          isStop: true,
        },
      ],
    };
  }

  // Where the specimen APPEARS to be: the front focal distance of the glass
  // alone, which is the plane the lens is placed across whether or not a plate
  // stands between. With no slip it is also where the specimen is.
  const airEquivalentObjectDistanceMm = collimatingObjectDistance(
    prescription,
    designWavelengthNm,
  );
  if (slip === undefined) airGapMm = airEquivalentObjectDistanceMm;
  // The slip's upper face takes the front of the list and is not an aperture:
  // the one stop flag rides along on whichever surface `stopPlacement` chose,
  // one index further back (§ 6a's one-aperture rule).
  const withSlipPrescription = withSlip(prescription, airGapMm);
  const objectDistanceMm = slip === undefined ? airEquivalentObjectDistanceMm : tSlip;

  // ANTI-CIRCULARITY. The gap was solved on the glass alone, before the stop
  // surface existed; the objective is used with it. If those disagree the
  // specimen is off the front focus and the "infinity" space is not collimated —
  // which no downstream rung can see, because every one of them is composed
  // through a tube lens that will happily focus a slightly convergent beam.
  const placedAt = collimatingObjectDistance(withSlipPrescription, designWavelengthNm);
  if (!(Math.abs(placedAt - objectDistanceMm) <= 1e-11 * airEquivalentObjectDistanceMm)) {
    throw new Error(
      `microscopeObjective: the specimen plane solve did not converge — the chain collimates ` +
        `from ${placedAt.toFixed(9)} mm where the specimen sits at ${objectDistanceMm.toFixed(9)} mm`,
    );
  }

  // The marginal ray, quoted once and read in both frames: at the glass's own
  // surface 0 it is `(t + n·w)·tan u_glass`, which is `a·tan u` bare.
  const glassMarginalHeightMm = airEquivalentObjectDistanceMm * stopPerAirDistance;
  const seidelS1OfGlassAlone = seidelSums(asObjective(glass, 0), designWavelengthNm, {
    marginalHeightMm: glassMarginalHeightMm,
    objectDistanceMm: airEquivalentObjectDistanceMm,
  }).s1;
  // ANTI-CIRCULARITY, second half. A lens solved for a plate slightly unlike the
  // one in front of it sits at the right conjugates and images happily, so the
  // residual is measured on the REAL chain in the REAL frame — where the target
  // was computed in the reversed one — and scaled against the sum of the
  // surfaces' individual contributions, the same currency `achromaticObjective`
  // picks its branch on.
  let seidelS1AtWorkingConjugates = seidelS1OfGlassAlone;
  if (slip !== undefined) {
    const working = seidelSums(withSlipPrescription, designWavelengthNm, {
      marginalHeightMm: tSlip * tanU,
      objectDistanceMm: tSlip,
    });
    seidelS1AtWorkingConjugates = working.s1;
    const cancellation = working.surfaces.reduce((total, x) => total + Math.abs(x.s1), 0);
    if (!(Math.abs(working.s1) <= 1e-9 * cancellation)) {
      throw new Error(
        `microscopeObjective: the spherical-aberration solve did not converge — ΣS_I = ` +
          `${working.s1.toExponential(3)} mm against a cancellation scale of ` +
          `${cancellation.toExponential(3)} mm`,
      );
    }
  }

  const front = glass.surfaces[0]!;
  return {
    prescription: withSlipPrescription,
    focalLengthMm: f,
    paraxialFocalLengthMm: systemProperties(prescription, designWavelengthNm).efl,
    pupilRadiusMm,
    glassRadiusMm,
    objectFieldRadiusMm,
    ...(fieldNumberMm === undefined ? {} : { fieldNumberMm }),
    stopRadiusMm,
    stopPlacement,
    stopDistanceMm,
    focalRatio,
    objectDistanceMm,
    ...(slip === undefined ? {} : { coverslip: slip }),
    airGapMm,
    airEquivalentObjectDistanceMm,
    freeWorkingDistanceMm: airGapMm - sag(front.curvature, front.semiAperture),
    stopSurfaceIndex: withSlipPrescription.surfaces.findIndex((s) => s.isStop),
    seidelS1AtWorkingConjugates,
    seidelS1OfGlassAlone,
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
  readonly objective: InfinityCorrectedObjective;
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

/**
 * What forms an intermediate image, and nothing more — the contract § 6q's
 * eyepiece composes onto, written down for the same reason
 * `InfinityCorrectedObjective` is: the two architectures step 6 names are
 * *different instruments*, and an eyepiece that only fits one of them would be
 * an eyepiece for the infinity-corrected branch rather than for a microscope.
 *
 * Both members below satisfy it already; declaring it makes that a promise
 * rather than a coincidence of field names.
 */
export interface ImageFormingMicroscope {
  readonly system: OpticalSystem;
  /** The flat chain from the specimen to the intermediate image. */
  readonly prescription: Prescription;
  /** What the labels claim, unsigned. */
  readonly nominalMagnification: number;
  /** Specimen plane, in front of surface 0's vertex (mm). */
  readonly objectDistanceMm: number;
  /** Last vertex → intermediate image (mm), from the paraxial trace. */
  readonly imageDistanceMm: number;
}

export interface InfinityCorrectedMicroscope extends ImageFormingMicroscope {
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

  // `infinitySpaceMm` is measured from the objective's last GLASS vertex, which
  // is what its doc says and what it meant before § 6v gave the objective a
  // diaphragm of its own. That diaphragm sits INSIDE the infinity space, so the
  // gap spliced after the module is the space less the distance already spent
  // reaching the stop — otherwise inserting a stop would silently push the tube
  // lens back by the objective's whole back focal distance (≈ 50 mm on the 4×).
  // The beam there is collimated, so that push changes no first-order property,
  // which is exactly why it would have gone unnoticed while changing the ray
  // heights the tube lens sees and therefore its aberration contribution.
  const stopDistanceMm = objective.stopDistanceMm ?? 0;
  const gapAfterObjectiveMm = infinitySpaceMm - stopDistanceMm;
  if (!(gapAfterObjectiveMm >= 0)) {
    throw new Error(
      `infinityCorrectedMicroscope: the objective's stop sits ${stopDistanceMm.toFixed(3)} mm ` +
        `behind its glass, past the ${infinitySpaceMm} mm infinity space — the tube lens would precede the aperture`,
    );
  }

  const build = (imageGapMm: number): Prescription => {
    const chain = spliceModules(
      [
        { surfaces: objective.prescription.surfaces, gapAfterMm: gapAfterObjectiveMm },
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
    // The objective owns its aperture, wherever it put it: a `"backFocal"`
    // objective carries a diaphragm surface of its own, a `"rim"` one is
    // flagged on surface 0. Read the index off the module rather than assuming
    // either — the composed chain must declare exactly ONE stop, and both
    // doublets flag their own surface 0, so a chain that merely inherited the
    // flags would carry three. `stopIndex` takes the first and would look fine;
    // `seidelSums` throws off-axis unless the flagged stop is surface 0, which
    // is now a real constraint rather than a latent one (§ 6v).
    const stopAt = objective.prescription.surfaces.findIndex((s) => s.isStop);
    if (stopAt < 0) throw new Error("infinityCorrectedMicroscope: the objective declares no stop");
    const surfaces: SurfaceSpec[] = chain.surfaces.map((s, i) => ({ ...s, isStop: i === stopAt }));
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
 *
 * NOT a parfocal distance, which is the *other* shoulder-referenced standard and
 * lives in `core/mech.PARFOCAL_DISTANCE_MM` — shoulder to **specimen**, 45 mm for
 * DIN, and the one § 5u's parfocal ceiling is derived against. The two tables are
 * indexed by the same standards names with different numbers, so the note is on
 * both sides.
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
  /**
   * How far back the aperture had to be held on the pass in hand, 1 being not at
   * all. THE SEED IS THE WORST THE OBJECT DISTANCE EVER IS: the thin lens puts
   * the specimen f(1 + 1/M) out where the fixed point settles some 6% closer
   * (§ 6b.5), so the first pass sizes ~6% more glass than the design it is
   * converging toward has, and hands `achromaticObjective` a focal ratio that
   * much faster. Reading a refusal there as a verdict is what made the
   * constructor refuse apertures it could in fact deliver — the wall was the
   * seed's, decided before anything had looked at the lens being built.
   *
   * So a `DoubletApertureRefusal` mid-iteration is treated as an overshoot: the
   * aperture is stepped back only as far as it takes to get a lens to read the
   * next object distance off, and asked for in FULL again on the next pass, from
   * the object distance that lens implies. The step is a search resolution and
   * not slack — nothing keeps a reduced aperture. The fixed point may only close
   * on a pass that built at the full aperture (`heldBack === 1` below), so a
   * design whose CONVERGED geometry is past the solver's wall still refuses,
   * with the solver's own message and at the solver's own boundary.
   *
   * WHY THE HOLD-BACK IS THEN SHRUNK BACK TOWARD 1 AT THE DECISION, and not
   * simply left where the ladder found it: the object distance a held-back lens
   * reads off is *biased*, because the defaulted thicknesses go with the
   * aperture. Measured, ∂ln a/∂ln D ≈ −0.1 (flint first) to −0.2 (crown first) —
   * a narrower lens reports the specimen further out — so a hold-back of ε
   * inflates the next pass's aperture by ~0.2·ε, and a design that close to the
   * wall gets refused for the retry's own error. Halving the gap to 1 whenever
   * the geometry has converged drives that bias to the refinement floor, so what
   * is left is parts in 10⁴ of aperture rather than the seed's 6% of ratio. It
   * is a floor and not zero: the boundary is the converged design's own to
   * `APERTURE_REFINE`, and is no longer an exactly stated locus the way the
   * seed's was (§ 6b.5.4's closed form is what that costs).
   */
  // Coarse on the way down — every trial is a full bending scan, and a design
  // that is nowhere near buildable should find that out in a handful of them —
  // and the resolution comes back from the bisection above, not from the step.
  const APERTURE_STEP = 0.9;
  const APERTURE_FLOOR = 0.5;
  const APERTURE_BISECTIONS = 4;
  const APERTURE_REFINE = 1e-4;
  /** The hold-back the pass in hand built at; 0 means none has worked yet. */
  let heldBack = 1;
  /** …and the narrowest one this pass refused. The two bracket the ceiling. */
  let refusedAt = 1;
  let refusedAtFullAperture: unknown;

  for (let i = 0; i < 60; i++) {
    // The glass is sized off the stop the specimen plane implies. S_I ∝ h⁴
    // exactly, so the root of S_I(c₁) = target does not move with the aperture —
    // the sizing cannot pull the design around, it only decides how much glass
    // there is (and, through the defaulted thicknesses, a weak second-order
    // coupling the iteration absorbs).
    const stop = a * stopPerAirDistance;
    const D = 2 * stop * glassMarginFactor;
    // Reciprocity: the mirrored chain at object a is the crown-first chain at
    // the conjugate b. See the header.
    const solveAt = orientation === "flintFirst" ? b : a;
    // The full aperture first, always — it is the one the answer is about, and
    // whether it is refused at THIS pass's object distance is what decides
    // whether the fixed point is allowed to close. After that the trials CLIMB
    // back toward it, by bisection against the last hold-back that worked,
    // instead of laddering down from 1 again: the hold-back is what biases the
    // object distance this pass reads off, so the smallest one that gets a lens
    // is the one worth having, and every trial costs a full bending scan.
    let scale = 1;
    let bisections = 0;
    refusedAt = 1;
    refusedAtFullAperture = undefined;
    for (;;) {
      try {
        doublet = achromaticObjective({
          apertureMm: D * scale,
          focalRatio: f / (D * scale),
          objectDistanceMm: solveAt,
          ...glasses,
          designWavelengthNm,
          targetS1Mm,
        });
        break;
      } catch (e) {
        // Only the aperture is retryable, and `achromaticObjective` says so by
        // type: a glass pair with no classical solution, or a broken argument,
        // is the same answer at every aperture and is let straight through.
        if (!(e instanceof DoubletApertureRefusal)) throw e;
        if (scale === 1) refusedAtFullAperture = e;
        refusedAt = scale;
        if (heldBack === 0) {
          scale = refusedAt * APERTURE_STEP; // no footing yet — feel for one
        } else if (bisections < APERTURE_BISECTIONS && heldBack < refusedAt) {
          scale = 0.5 * (heldBack + refusedAt);
          bisections++;
        } else if (refusedAt > heldBack) {
          scale = heldBack; // fall back on the hold-back that worked last pass
        } else {
          heldBack = 0; // even that is refused now — the geometry has moved
          scale = refusedAt * APERTURE_STEP;
        }
        if (!(scale >= APERTURE_FLOOR)) throw refusedAtFullAperture;
      }
    }
    heldBack = scale;
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
      if (heldBack === 1) break;
      // The geometry has closed and the full aperture is still refused — but the
      // hold-back that produced this geometry carries a bias of its own, so that
      // is not yet an answer. What decides is the BRACKET: `heldBack` is the
      // widest aperture that built here and `refusedAt` the narrowest that did
      // not, and while they are apart the trials at the top of the next pass go
      // on bisecting between them, each one re-closing the fixed point at a
      // geometry less biased than the last.
      //
      // Testing `1 − heldBack` instead was the first version and it was wrong in
      // the expensive direction: a design that genuinely cannot be built settles
      // at a hold-back of its own — 0.97, say — which never approaches 1, so
      // every refusal ran the pass budget out before answering. On the bracket
      // both cases finish in a few passes: a design that is really inside gets
      // its full-aperture trial through, and one that is not sees the bracket
      // collapse onto its own ceiling.
      if (refusedAt - heldBack <= APERTURE_REFINE) throw refusedAtFullAperture;
    }
  }
  // Ran out of passes while still holding the aperture back: the full-aperture
  // lens was never built, so there is nothing to hand back.
  if (heldBack !== 1) throw refusedAtFullAperture;

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

export interface FiniteConjugateMicroscope extends ImageFormingMicroscope {
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
