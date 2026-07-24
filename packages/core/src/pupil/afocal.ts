import { AfocalTelescope, paraxialTrace, traceRay, vertexPositions, OpticalSystem } from "../trace";
import { pupils } from "./pupils";
import { chiefRay } from "./aiming";

/**
 * First-order properties of an afocal telescope that only make sense in the
 * *collimated exit space* — the numbers a visual observer actually reads, and
 * the ones the engine could not compute at all before an afocal system could be
 * expressed (`systemProperties` throws on it: there is no finite focus). The
 * eyepiece prescription is input data; THESE are the pinnable capability
 * (VALIDATION § 5l), each one a closed form the trace can refuse.
 */
export interface AfocalProperties {
  /**
   * Angular magnification f_o/f_e, signed. Negative for an ordinary Keplerian
   * pair (the image is inverted). Measured from the beam compression of the
   * axial parallel ray, so it is the trace's number, not the two EFLs' ratio —
   * which is exactly what makes "M = −f_o/f_e" a test rather than a definition.
   */
  readonly magnification: number;
  /** Entrance-pupil (objective) semi-diameter (mm) — the aperture it was given. */
  readonly entrancePupilRadiusMm: number;
  /**
   * Exit-pupil semi-diameter (mm) = entrance-pupil semi-diameter / |M|. Computed
   * independently, by imaging the stop through the eyepiece (`pupils`), so its
   * agreement with EPD/|M| is a cross-check of two routes.
   */
  readonly exitPupilRadiusMm: number;
  /**
   * Eye relief: distance from the last (eye-lens) vertex to the exit pupil (mm).
   * Where the observer's pupil must sit to see the whole field.
   */
  readonly eyeReliefMm: number;
}

/**
 * @param apertureRadiusMm the objective's clear semi-aperture (the entrance
 * pupil). The composition does not carry an aperture — that is a property of the
 * system, not of the flattened surface chain — so it is supplied here.
 */
export function afocalProperties(
  telescope: AfocalTelescope,
  wavelengthNm: number,
  apertureRadiusMm: number,
): AfocalProperties {
  const p = telescope.prescription;

  // A ray parallel to the axis at height 1 exits at height A = −f_e/f_o (the
  // system matrix's transverse element for an afocal chain), so 1/A is the
  // angular magnification, sign and all.
  const yOut = paraxialTrace(p, wavelengthNm, { y: 1, u: 0 }).y;
  if (!(Math.abs(yOut) > 0)) throw new Error("afocalProperties: degenerate beam compression");
  const magnification = 1 / yOut;

  const system: OpticalSystem = {
    prescription: p,
    aperture: { kind: "stopRadius", value: apertureRadiusMm },
    field: { kind: "angle", values: [0] },
    wavelengths: [{ nm: wavelengthNm, weight: 1 }],
    conjugate: { kind: "infinite" },
  };
  const pg = pupils(system, wavelengthNm);
  const vz = vertexPositions(p);
  const lastVertexZ = vz[vz.length - 1]!;

  return {
    magnification,
    entrancePupilRadiusMm: apertureRadiusMm,
    exitPupilRadiusMm: pg.exit.radius,
    eyeReliefMm: pg.exit.z - lastVertexZ,
  };
}

/**
 * The apparent field angle a visual observer sees for a given object-space field
 * angle: the direction of the REAL chief ray after the last surface, in the
 * collimated exit space (radians, in the x–z meridional plane).
 *
 * This is the capability that needs a real trace, not paraxial. Near the axis it
 * is M·θ (the § 5l magnification), so
 *
 *     θ_out(θ) = M·θ + O(θ³)
 *
 * and the O(θ³) departure IS the eyepiece's distortion — pincushion for a simple
 * positive eyepiece (the local angular magnification grows toward the edge). The
 * paraxial `afocalProperties` cannot see it: distortion is exactly the nonlinear
 * term a first-order trace drops. Pinned in VALIDATION § 5n.
 *
 * Throws if the chief ray does not clear the optics (a field beyond the eyepiece
 * field stop vignettes), so a caller that widens the field past the aperture
 * fails loudly rather than reading a silently-clipped angle.
 *
 * @param apertureRadiusMm the objective's clear semi-aperture (entrance pupil).
 */
export function apparentFieldAngleRad(
  telescope: AfocalTelescope,
  fieldAngleDeg: number,
  wavelengthNm: number,
  apertureRadiusMm: number,
): number {
  const p = telescope.prescription;
  const system: OpticalSystem = {
    prescription: p,
    aperture: { kind: "stopRadius", value: apertureRadiusMm },
    field: { kind: "angle", values: [fieldAngleDeg] },
    wavelengths: [{ nm: wavelengthNm, weight: 1 }],
    conjugate: { kind: "infinite" },
  };
  const pg = pupils(system, wavelengthNm);
  const res = traceRay(p, chiefRay(system, pg, fieldAngleDeg, wavelengthNm));
  if (res.status !== "ok" || !res.ray) {
    throw new Error(
      `apparentFieldAngleRad: chief ray ${res.status} at ${fieldAngleDeg}° — field beyond the eyepiece aperture?`,
    );
  }
  const d = res.ray.dir;
  return Math.atan2(d.x, d.z);
}
