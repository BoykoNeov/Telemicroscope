import { Vec3, vec3, sub, add, scale, dot, normalize } from "../math/vec3";
import { Ray, makeRay } from "../trace/ray";
import { OpticalSystem } from "../trace/system";
import { PupilGeometry } from "./pupils";

/**
 * Ray aiming: launch a ray that reaches a chosen point in the entrance pupil.
 *
 * Without this you cannot fill the pupil for an off-axis field — rays launched
 * on a fixed grid arrive at the stop unevenly, silently biasing every off-axis
 * spot diagram and PSF.
 *
 * Field convention: fields lie in the x–z meridional plane. A positive field
 * angle tilts the incoming bundle toward +x.
 *
 * WAVEFRONT REFERENCE (docs/ARCHITECTURE.md § Wavefront reference). Rays must
 * start on a common equal-phase surface or the accumulated OPL is not usable
 * as OPD:
 *  - **Infinite conjugate:** rays start on a plane NORMAL TO THE CHIEF RAY.
 *    Starting them on a common z-plane instead introduces real, spurious tilt
 *    — 0.387 mm across the pupil at only 2° of field, roughly 6·10⁵ waves.
 *  - **Finite conjugate:** all rays start at the object point itself, so the
 *    equal-phase surface is a sphere and no projection is needed.
 */

/** A point in the pupil in normalized coordinates: px² + py² ≤ 1 at the rim. */
export interface PupilPoint {
  readonly px: number;
  readonly py: number;
}

export interface AimOptions {
  /**
   * z of the launch reference plane for infinite conjugates (world mm).
   * Any plane before the first surface works — OPD is referenced to the chief
   * ray, so the choice cancels — provided every ray in a bundle shares it.
   */
  readonly launchZ?: number;
}

function defaultLaunchZ(pupil: PupilGeometry): number {
  const ep = Number.isFinite(pupil.entrance.z) ? pupil.entrance.z : 0;
  return Math.min(0, ep) - 10;
}

/**
 * Direction of the incoming bundle for a field value.
 * Infinite conjugate → field is an angle in degrees; finite → an object height.
 */
export function fieldDirection(system: OpticalSystem, fieldValue: number): Vec3 {
  if (system.conjugate.kind === "infinite") {
    const t = (fieldValue * Math.PI) / 180;
    return vec3(Math.sin(t), 0, Math.cos(t));
  }
  throw new Error("fieldDirection is only defined for infinite conjugates");
}

/** Object point for a finite-conjugate field (an object height, mm). */
export function objectPoint(system: OpticalSystem, fieldValue: number): Vec3 {
  if (system.conjugate.kind !== "finite") {
    throw new Error("objectPoint is only defined for finite conjugates");
  }
  return vec3(fieldValue, 0, -system.conjugate.distance);
}

export function aimRay(
  system: OpticalSystem,
  pupil: PupilGeometry,
  fieldValue: number,
  point: PupilPoint,
  wavelengthNm: number,
  options: AimOptions = {},
): Ray {
  const r = pupil.entrance.radius;
  if (!Number.isFinite(r)) {
    throw new Error("entrance pupil is at infinity (telecentric): aim in object space instead");
  }
  const target = vec3(point.px * r, point.py * r, pupil.entrance.z);

  if (system.conjugate.kind === "finite") {
    const o = objectPoint(system, fieldValue);
    return makeRay(o, normalize(sub(target, o)), wavelengthNm);
  }

  const dir = fieldDirection(system, fieldValue);
  const z0 = options.launchZ ?? defaultLaunchZ(pupil);
  const p0 = vec3(0, 0, z0);
  // Project the pupil target back onto the plane through p0 normal to dir:
  // origin + dir·s = target, with origin guaranteed to lie on that plane.
  const s = dot(sub(target, p0), dir);
  return makeRay(sub(target, scale(dir, s)), dir, wavelengthNm);
}

/** The chief ray: through the centre of the entrance pupil. */
export function chiefRay(
  system: OpticalSystem,
  pupil: PupilGeometry,
  fieldValue: number,
  wavelengthNm: number,
  options: AimOptions = {},
): Ray {
  return aimRay(system, pupil, fieldValue, { px: 0, py: 0 }, wavelengthNm, options);
}

/** The marginal ray: through the rim of the entrance pupil, in +x. */
export function marginalRay(
  system: OpticalSystem,
  pupil: PupilGeometry,
  fieldValue: number,
  wavelengthNm: number,
  options: AimOptions = {},
): Ray {
  return aimRay(system, pupil, fieldValue, { px: 1, py: 0 }, wavelengthNm, options);
}

/**
 * Square grid of pupil samples clipped to the unit disc — the sampling the
 * FFT-based PSF consumes. `n` is the grid resolution across the full pupil
 * diameter; the returned points are the ones that land inside it.
 */
export function pupilGrid(n: number): PupilPoint[] {
  const pts: PupilPoint[] = [];
  for (let i = 0; i < n; i++) {
    const px = n === 1 ? 0 : (i / (n - 1)) * 2 - 1;
    for (let j = 0; j < n; j++) {
      const py = n === 1 ? 0 : (j / (n - 1)) * 2 - 1;
      if (px * px + py * py <= 1) pts.push({ px, py });
    }
  }
  return pts;
}

/** Points along one pupil diameter — what a ray fan plots. */
export function pupilFan(n: number, axis: "x" | "y" = "x"): PupilPoint[] {
  const pts: PupilPoint[] = [];
  for (let i = 0; i < n; i++) {
    const p = n === 1 ? 0 : (i / (n - 1)) * 2 - 1;
    pts.push(axis === "x" ? { px: p, py: 0 } : { px: 0, py: p });
  }
  return pts;
}

/** Point at parameter t along a ray (mm). */
export const advance = (r: Ray, t: number): Vec3 => add(r.origin, scale(r.dir, t));
