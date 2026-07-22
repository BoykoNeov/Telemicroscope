import { Vec3, dot, scale, add, sub } from "../math/vec3";

/**
 * Ray–surface interaction physics. Computes the FULL refracted/reflected
 * split with Fresnel energy weights (architecture commitment #2): the
 * sequential engine keeps the primary ray and discards the secondary; a
 * future non-sequential engine traces both. Nothing here knows about
 * prescriptions or traversal order.
 */

export interface InteractionResult {
  /** Refracted direction (unit), or null on total internal reflection. */
  readonly refracted: Vec3 | null;
  /** Reflected direction (unit). Always defined. */
  readonly reflected: Vec3;
  /** Fresnel energy reflectance (unpolarized average). 1 on TIR. */
  readonly R: number;
  /** Fresnel energy transmittance = 1 − R. */
  readonly T: number;
  readonly tir: boolean;
  readonly cosI: number;
}

/** d' = d − 2(d·n)n; n need not be oriented, result is the same. */
export function reflectDir(d: Vec3, n: Vec3): Vec3 {
  return sub(d, scale(n, 2 * dot(d, n)));
}

/**
 * Vector Snell refraction with Fresnel coefficients.
 * `normal` may point to either side; it is re-oriented against the ray
 * internally. n1 is the index on the incident side, n2 beyond the surface.
 */
export function interact(d: Vec3, normal: Vec3, n1: number, n2: number): InteractionResult {
  // Orient the normal against the incoming ray so cosI ≥ 0.
  let n = normal;
  let cosI = -dot(d, n);
  if (cosI < 0) {
    n = scale(n, -1);
    cosI = -cosI;
  }

  const reflected = reflectDir(d, n);
  const eta = n1 / n2;
  const sin2T = eta * eta * (1 - cosI * cosI);

  if (sin2T > 1) {
    return { refracted: null, reflected, R: 1, T: 0, tir: true, cosI };
  }

  const cosT = Math.sqrt(1 - sin2T);
  const refracted = add(scale(d, eta), scale(n, eta * cosI - cosT));

  // Fresnel, unpolarized average of s and p power reflectances.
  const rs = (n1 * cosI - n2 * cosT) / (n1 * cosI + n2 * cosT);
  const rp = (n2 * cosI - n1 * cosT) / (n2 * cosI + n1 * cosT);
  const R = 0.5 * (rs * rs + rp * rp);

  return { refracted, reflected, R, T: 1 - R, tir: false, cosI };
}
