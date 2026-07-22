import { Vec3 } from "../math/vec3";

/**
 * A ray carries wavelength, energy, and a polarization slot from day one
 * (architecture commitment: the non-sequential/coating future needs them;
 * polarization stays null until DIC/coating physics lands).
 */
export interface Ray {
  readonly origin: Vec3;
  /** Unit direction. */
  readonly dir: Vec3;
  readonly wavelengthNm: number;
  /** Relative radiant energy (dimensionless until photometry lands). */
  readonly energy: number;
  readonly polarization: null;
}

export function makeRay(origin: Vec3, dir: Vec3, wavelengthNm: number, energy = 1): Ray {
  return { origin, dir, wavelengthNm, energy, polarization: null };
}
