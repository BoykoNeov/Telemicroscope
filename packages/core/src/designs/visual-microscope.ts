import { Prescription, SurfaceSpec } from "../trace/prescription";
import { systemProperties } from "../trace/paraxial";
import { collimatingGap, collimatingObjectDistance, spliceModules } from "../trace/compose";
import { OpticalSystem } from "../trace/system";
import { ImageFormingMicroscope } from "./microscope";

/**
 * The eyepiece on the intermediate image — what makes the branch's chain
 * something you can *look through* rather than something that ends at a sensor
 * (§ 6q).
 *
 * ## Why this is an engine step and not a call to `afocalTelescope`
 *
 * The eyepiece library (§§ 5l–5o) already builds eyepieces, and `visualSystem`
 * (§ 5q) already puts an eye behind one. Neither serves a microscope, and the
 * reason is one line of `afocalTelescope`: its gap is solved from a ray entering
 * **collimated**, `{y: 1, u: 0}` — an object at infinity. That is what a
 * telescope objective sees. A microscope eyepiece collimates a real intermediate
 * image formed a finite distance in front of it, so the ray that has to leave
 * flat is the one from the *specimen*, and the separation that flattens it is a
 * different number.
 *
 * How different is measured rather than argued (§ 6q.3): the telescope's gap on
 * a DIN 4×/0.10 leaves the exit beam with a vergence of tens of diopters, where
 * a relaxed eye accommodates a fraction of one. So `visualSystem` and
 * `afocalProperties` do **not** compose unchanged, which corrects APP.md D6's
 * own prediction — `afocalProperties` reads its magnification off a collimated
 * input ray, a quantity that means nothing on a finite-conjugate chain.
 * `collimatingGap` is the solve, and `pupil/microscope`'s visual readouts are
 * the numbers `afocalProperties` would have given.
 *
 * ## Two conventions, both stated, neither computed with silently
 *
 * A microscope's magnification is **angular**, not lateral: there is no image on
 * a screen to measure, only a collimated beam whose angular size is compared to
 * how big the specimen would look held at the near point. So
 *
 *     M_visual = M_objective × (D / f_eyepiece)
 *
 * and D — the **near point**, conventionally 250 mm — is exactly the kind of
 * number § 6a spells out for the 200/180/165 tube lengths and § 6b for the
 * 160/150 tube lengths. It is a convention about human eyes, not a law: every
 * rung here is a *ratio* against whichever value is passed in, and a microscope
 * quoted against a 254 mm near point is genuinely a different number.
 *
 * The second convention is the **field number**: the diameter, in millimetres at
 * the intermediate image, of the eyepiece's field stop. It is what actually sets
 * the visible circle — the specimen circle is FN/M_objective, which is why a 4×
 * with FN 20 shows 5 mm and no arrangement of the optics widens it. Given one,
 * this module splices a real annular stop at the intermediate image rather than
 * printing a number, so a field beyond it **vignettes in the trace**.
 *
 * ## What composes unchanged, and what does not
 *
 * `plosslEyepiece` and `huygensEyepiece` compose unchanged — an eyepiece
 * prescription is input data and does not know what is in front of it. The one
 * caveat is aperture: an eyepiece's default clear aperture is sized for its own
 * focal length, and a field number wider than that vignettes honestly rather
 * than silently, so the caller sizes the glass to the field it wants.
 * `reducedEye` and `apertureStop: "limiting"` compose unchanged too, and § 5p's
 * two-stop collapse is what gives § 6q.6 its crossover.
 */

/**
 * The near point (mm) — the distance a specimen would be held at for comparison,
 * and the D in M = M_obj·(D/f_e). Conventionally 250; **not a law**, and not
 * datasheet-verified here. Every magnification below is a ratio against whatever
 * is passed in, exactly as § 6a's tube lengths are.
 */
export const NEAR_POINT_MM = 250;

/**
 * The smallest exit pupil (mm) an observer is taken to use before magnification
 * stops buying anything — the convention behind the textbook 1000·NA ceiling,
 * which is this number and Lagrange's invariant and nothing else (§ 6q.7).
 * Stated so the ceiling is a consequence rather than a quoted rule.
 */
export const MIN_USEFUL_EXIT_PUPIL_MM = 0.5;

/**
 * The largest exit pupil worth delivering (mm) — a dark-adapted eye's own pupil,
 * past which the extra beam falls on the iris. Sets the *lower* end of the
 * useful range, the textbook 500·NA.
 */
export const MAX_USEFUL_EXIT_PUPIL_MM = 1;

export interface VisualMicroscopeSpec {
  /** The instrument that forms the intermediate image — either architecture. */
  readonly microscope: ImageFormingMicroscope;
  /** The eyepiece, field-stop side first, eye lens last. */
  readonly eyepiece: Prescription;
  /** Wavelength (nm) the collimating separation is solved at. */
  readonly wavelengthNm: number;
  /** The near point the magnification is quoted against (mm). Default 250. */
  readonly nearPointMm?: number;
  /**
   * The eyepiece's field stop diameter at the intermediate image (mm). Given, a
   * real annular surface is spliced in at that plane and a field beyond it
   * vignettes; omitted, the field is limited only by the glass.
   */
  readonly fieldNumberMm?: number;
  /**
   * Trailing distance from the eye lens to the exit (mm). Cosmetic on an afocal
   * exit — the last surface's thickness never enters the paraxial output angle —
   * and set to the eye relief by `pupil/visual`'s composition. Default 0.
   */
  readonly eyeGapMm?: number;
  /** Object heights (mm) the composed system's field is spelled with. */
  readonly objectHeightsMm?: readonly number[];
}

export interface VisualMicroscope {
  /**
   * The composed system: specimen → objective (→ tube lens) → field stop →
   * eyepiece → collimated exit. Finite conjugate, the objective's rim still the
   * one declared stop. Afocal out, so `systemProperties` throws on it — the § 5l
   * property, arriving on the other conjugate.
   */
  readonly system: OpticalSystem;
  /** The flat composed chain. */
  readonly prescription: Prescription;
  /** Microscope's last vertex → eyepiece's first vertex (mm), solved. */
  readonly gapMm: number;
  /**
   * The same gap the closed form predicts: the intermediate image distance plus
   * the eyepiece's own front focal distance. A **check**, not the construction —
   * `gapMm` is solved on the trace, and § 6q.2 is what compares them.
   */
  readonly gapFromFrontFocalDistanceMm: number;
  /** The eyepiece's front focal distance (mm), from `collimatingObjectDistance`. */
  readonly eyepieceFrontFocalDistanceMm: number;
  /** Traced paraxial EFL of the eyepiece alone (mm). */
  readonly eyepieceFocalLengthMm: number;
  /** D/f_e — the eyepiece's own magnification, against the stated near point. */
  readonly eyepieceMagnification: number;
  /**
   * M_obj × (D/f_e), **unsigned**, from the microscope's nominal magnification.
   * What the two engravings multiply to. The traced, signed number is
   * `visualMagnification` in `pupil/microscope` — and it is a real ray's answer,
   * so the two agreeing is § 6q.4 rather than a definition.
   */
  readonly nominalVisualMagnification: number;
  /** Specimen plane, in front of surface 0 (mm) — carried through unchanged. */
  readonly objectDistanceMm: number;
  /** The intermediate image, measured from the microscope's last vertex (mm). */
  readonly intermediateImageDistanceMm: number;
  readonly nearPointMm: number;
  /** The field stop diameter at the intermediate image (mm), if one was given. */
  readonly fieldNumberMm?: number;
  /**
   * The specimen circle the field number admits: FN/M_obj (mm). What a
   * microscope's field of view actually *is*, and the number APP.md's stage
   * prints its own span against.
   */
  readonly objectFieldDiameterMm?: number;
  /**
   * Apparent field of view (degrees, full angle): 2·atan(FN/(2·f_e)) — how wide
   * the circle looks to the observer. Paraxial in the sense that it is the field
   * stop's angular size at the eyepiece's focal length; the real chief ray's
   * answer carries the eyepiece distortion § 5n measures.
   */
  readonly apparentFieldOfViewDeg?: number;
  /** How many leading surfaces belong to the microscope (field stop excluded). */
  readonly microscopeSurfaceCount: number;
  /** Index of the spliced field stop in the composed chain, if there is one. */
  readonly fieldStopSurfaceIndex?: number;
}

/**
 * A flat annular surface: no power, no glass change, and a rim. The field stop
 * — an aperture that limits the *field* rather than the beam, so it carries no
 * `isStop` flag (that word means the aperture stop, and there is exactly one).
 */
const fieldStopSurface = (semiAperture: number, thickness: number): SurfaceSpec => ({
  kind: "refract",
  curvature: 0,
  semiAperture,
  thickness,
  medium: "AIR",
});

/**
 * Compose a microscope and an eyepiece into an instrument whose exit is
 * collimated for the specimen on its stage.
 */
export function visualMicroscope(spec: VisualMicroscopeSpec): VisualMicroscope {
  const { microscope, eyepiece, wavelengthNm } = spec;
  const nearPointMm = spec.nearPointMm ?? NEAR_POINT_MM;
  if (!(nearPointMm > 0)) throw new Error("visualMicroscope: the near point must be positive");
  const eyeGapMm = spec.eyeGapMm ?? 0;
  const objectDistanceMm = microscope.objectDistanceMm;

  const eyepieceFocalLengthMm = systemProperties(eyepiece, wavelengthNm).efl;
  if (!(eyepieceFocalLengthMm > 0)) {
    throw new Error(
      `visualMicroscope: the eyepiece must be positive (EFL ${eyepieceFocalLengthMm.toFixed(3)} mm) — it has to collimate a real image`,
    );
  }

  // The solve. Not `afocalTelescope`'s: the ray that has to leave flat starts at
  // the specimen, not at infinity. See the header.
  const gapMm = collimatingGap(
    microscope.prescription,
    eyepiece,
    objectDistanceMm,
    wavelengthNm,
  );
  const eyepieceFrontFocalDistanceMm = collimatingObjectDistance(eyepiece, wavelengthNm);
  const intermediateImageDistanceMm = microscope.imageDistanceMm;

  const fieldNumberMm = spec.fieldNumberMm;
  if (fieldNumberMm !== undefined && !(fieldNumberMm > 0)) {
    throw new Error("visualMicroscope: the field number must be positive");
  }
  // With a field stop the chain is spliced in three parts, the stop sitting AT
  // the intermediate image — which is where a field stop has to be, since that
  // is the only plane conjugate to the specimen inside the instrument. The two
  // gaps sum to the solved separation, so the eyepiece does not move.
  const stopGapMm = gapMm - intermediateImageDistanceMm;
  if (fieldNumberMm !== undefined && !(stopGapMm > 0)) {
    throw new Error(
      `visualMicroscope: the intermediate image lies past the eyepiece's front vertex (${stopGapMm.toFixed(3)} mm) — no field stop fits there`,
    );
  }

  const placements =
    fieldNumberMm === undefined
      ? [
          { surfaces: microscope.prescription.surfaces, gapAfterMm: gapMm },
          { surfaces: eyepiece.surfaces, gapAfterMm: eyeGapMm },
        ]
      : [
          { surfaces: microscope.prescription.surfaces, gapAfterMm: intermediateImageDistanceMm },
          { surfaces: [fieldStopSurface(fieldNumberMm / 2, stopGapMm)], gapAfterMm: stopGapMm },
          { surfaces: eyepiece.surfaces, gapAfterMm: eyeGapMm },
        ];
  const prescription = spliceModules(
    placements,
    microscope.prescription.objectMedium ?? "AIR",
  );

  // ONE aperture stop, and the check is about the COUNT rather than the index.
  // Both eyepieces declare none, so the splice should carry exactly the
  // microscope's — but § 6a was bitten by three flagged stops and § 5q by a
  // stripped one, so it is checked rather than trusted. The field stop is not an
  // aperture stop and must not have acquired a flag.
  //
  // It used to require surface 0 as well, which was true of every microscope
  // that existed when it was written and stopped being true at § 6v: a
  // telecentric objective carries its diaphragm at its own back focal plane, so
  // the flag legitimately sits mid-chain. The index is therefore reported and
  // not required — what would still be a defect is two stops, or none.
  const flagged = prescription.surfaces.reduce((n, s, i) => (s.isStop ? [...n, i] : n), [] as number[]);
  if (flagged.length !== 1) {
    throw new Error(
      `visualMicroscope: the composed chain must declare exactly one aperture stop — found ${flagged.length} at [${flagged.join(", ")}]`,
    );
  }

  const system: OpticalSystem = {
    prescription,
    aperture: microscope.system.aperture,
    field: { kind: "objectHeight", values: spec.objectHeightsMm ?? [0] },
    wavelengths: microscope.system.wavelengths,
    conjugate: { kind: "finite", distance: objectDistanceMm },
  };

  const eyepieceMagnification = nearPointMm / eyepieceFocalLengthMm;
  return {
    system,
    prescription,
    gapMm,
    gapFromFrontFocalDistanceMm: intermediateImageDistanceMm + eyepieceFrontFocalDistanceMm,
    eyepieceFrontFocalDistanceMm,
    eyepieceFocalLengthMm,
    eyepieceMagnification,
    nominalVisualMagnification: microscope.nominalMagnification * eyepieceMagnification,
    objectDistanceMm,
    intermediateImageDistanceMm,
    nearPointMm,
    ...(fieldNumberMm === undefined
      ? {}
      : {
          fieldNumberMm,
          objectFieldDiameterMm: fieldNumberMm / microscope.nominalMagnification,
          apparentFieldOfViewDeg:
            (2 * Math.atan(fieldNumberMm / (2 * eyepieceFocalLengthMm)) * 180) / Math.PI,
          fieldStopSurfaceIndex: microscope.prescription.surfaces.length,
        }),
    microscopeSurfaceCount: microscope.prescription.surfaces.length,
  };
}
