import { Prescription } from "../trace/prescription";
import { OpticalSystem } from "../trace/system";
import { afocalTelescope, spliceModules } from "../trace/compose";
import { reducedEye, ReducedEye, ReducedEyeSpec } from "../designs/eye";
import { afocalProperties } from "./afocal";
import { pupils } from "./pupils";
import { limitingStop } from "./aperture-stop";

/**
 * Visual mode: an objective and eyepiece composed into an afocal telescope, then
 * the observer's eye spliced on so the collimated exit beam forms a REAL retinal
 * image. The whole point is that the two things a visual observer cares about —
 * how much aperture actually reaches the retina, and how sharp the result is —
 * fall out of one trace through (objective + eyepiece + eye), not out of rules of
 * thumb (VALIDATION § 5q).
 *
 * The load-bearing physics is the two-stop competition (§ 5p). The telescope
 * compresses the objective's beam to an exit pupil of diameter D/|M|. If the
 * eye's pupil is WIDER than that, the objective still limits and the observer
 * gets the full aperture. If it is NARROWER, the eye's iris BECOMES the aperture
 * stop, the effective aperture collapses to d_eye·|M|, and the retinal image
 * dims and blurs. So the composed system is traced with `apertureStop:
 * "limiting"`, and the iris-limited regime emerges rather than being asserted.
 */

export interface VisualSystemSpec {
  /** The objective, authored standalone; carries the aperture stop. */
  readonly objective: Prescription;
  /** The eyepiece, field-stop-side first, eye-lens last. */
  readonly eyepiece: Prescription;
  /** The objective's clear semi-aperture (entrance pupil), mm. */
  readonly apertureRadiusMm: number;
  /** The observer's eye. */
  readonly eye: ReducedEyeSpec;
  /** Wavelength the afocal spacing is solved at (nm). */
  readonly wavelengthNm: number;
}

export interface VisualSystem {
  /**
   * The composed (objective + eyepiece + eye) system, focal, imaging onto the
   * retina, with `apertureStop: "limiting"` so the true stop is whichever of the
   * objective and the iris actually limits the beam. Feed it to `psf()` /
   * `spot()` for the retinal image.
   */
  readonly system: OpticalSystem;
  readonly eye: ReducedEye;
  /** Angular magnification f_o/f_e, signed (negative = inverted). */
  readonly magnification: number;
  /** Exit-pupil diameter of the afocal telescope = EPD/|M| (mm). */
  readonly exitPupilDiameterMm: number;
  /** Eye relief: eye-lens vertex → exit pupil, where the iris must sit (mm). */
  readonly eyeReliefMm: number;
  /** The eye pupil diameter (mm) — copied through for convenience. */
  readonly eyePupilDiameterMm: number;
  /**
   * Effective aperture actually reaching the retina (mm): the full objective
   * when the eye pupil admits the whole exit pupil, else the collapsed d_eye·|M|.
   * Read off the entrance pupil under limiting-stop selection, so it is the
   * trace's number.
   */
  readonly effectiveApertureMm: number;
  /** True when the eye's iris — not the objective — is the aperture stop. */
  readonly irisLimited: boolean;
}

export function visualSystem(spec: VisualSystemSpec): VisualSystem {
  const { objective, eyepiece, apertureRadiusMm, wavelengthNm } = spec;
  const eye = reducedEye(spec.eye);

  // The afocal solve gives the objective→eyepiece spacing and the first-order
  // exit pupil / eye relief the eye must be placed against.
  const afocal = afocalTelescope({ objective, eyepiece, wavelengthNm });
  const props = afocalProperties(afocal, wavelengthNm, apertureRadiusMm);

  // Splice the eye on, its iris sitting AT the exit pupil (eye relief gap), the
  // retina as the composed chain's trailing distance. On axis the afocal beam is
  // collimated, so the exact eye-relief placement changes no on-axis rung; it is
  // set correctly so the off-axis field is honest too.
  // The eye's cornea is flagged `isStop` for standalone use; drop that in the
  // composition so the objective is the sole DECLARED stop and the iris only
  // becomes the stop through `limiting` selection — never a second `isStop` for
  // `stopIndex` to arbitrate.
  const eyeSurfaces = eye.prescription.surfaces.map(({ isStop, ...s }) => s);
  const prescription = spliceModules(
    [
      { surfaces: objective.surfaces, gapAfterMm: afocal.gapMm },
      { surfaces: eyepiece.surfaces, gapAfterMm: props.eyeReliefMm },
      { surfaces: eyeSurfaces, gapAfterMm: eye.axialLengthMm },
    ],
    objective.objectMedium ?? "AIR",
  );

  const system: OpticalSystem = {
    prescription,
    aperture: { kind: "stopRadius", value: apertureRadiusMm },
    field: { kind: "angle", values: [0] },
    wavelengths: [{ nm: wavelengthNm, weight: 1 }],
    conjugate: { kind: "infinite" },
    apertureStop: { kind: "limiting" },
  };

  // The effective aperture is the entrance pupil the limiting stop projects back
  // into object space; irisLimited is simply which surface won the competition.
  const eyeIrisIndex = prescription.surfaces.length - 1;
  const stop = limitingStop(system, wavelengthNm);
  const effectiveApertureMm = pupils(system, wavelengthNm).entrance.radius * 2;

  return {
    system,
    eye,
    magnification: props.magnification,
    exitPupilDiameterMm: props.exitPupilRadiusMm * 2,
    eyeReliefMm: props.eyeReliefMm,
    eyePupilDiameterMm: eye.pupilDiameterMm,
    effectiveApertureMm,
    irisLimited: stop.index === eyeIrisIndex,
  };
}
