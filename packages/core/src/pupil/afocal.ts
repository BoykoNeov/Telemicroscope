import { AfocalTelescope, paraxialTrace, vertexPositions, OpticalSystem } from "../trace";
import { pupils } from "./pupils";

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
