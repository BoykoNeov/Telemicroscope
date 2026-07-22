import { Vec3, vec3, along, normalize } from "../math/vec3";
import { applyToPoint, applyToDirection } from "../math/transform";
import { Ray, makeRay } from "./ray";
import { interact, reflectDir } from "./interaction";
import { Prescription } from "./prescription";
import { CompiledSystem, asCompiled } from "./compile";

/**
 * Sequential exact ray trace: visit surfaces in prescription order, keep the
 * primary ray at each interaction (the Fresnel-weighted secondary is
 * discarded here by design — see architecture commitment #2).
 *
 * Runs on CPU in f64 — this is the precision-critical path that feeds the
 * OPD/wavefront computation (nanometers over ~1 m of path). It traces against
 * a CompiledSystem; passing a raw Prescription compiles it once and memoizes.
 */

export type TraceStatus = "ok" | "vignetted" | "tir" | "miss";

export interface TraceResult {
  readonly status: TraceStatus;
  /** Ray after the last surface (undefined unless status === "ok"). */
  readonly ray?: Ray;
  /** Optical path length Σ nᵢ·dᵢ from the input ray origin to the last surface hit (mm). */
  readonly opl: number;
  /** Hit point on each surface reached, in global coordinates. */
  readonly path: Vec3[];
  /**
   * Surviving energy fraction: Π (Fresnel T, or the surface's reflectance
   * override). This is the light budget — an uncoated air-glass surface
   * really does cost ~4%.
   */
  readonly throughput: number;
  /** Index of the surface where the ray was lost (for vignetted/tir/miss). */
  readonly failedAt?: number;
}

export function traceRay(system: Prescription | CompiledSystem, input: Ray): TraceResult {
  const c = asCompiled(system);
  const n = c.indices(input.wavelengthNm);

  let origin = input.origin;
  let dir = normalize(input.dir);
  let opl = 0;
  let throughput = input.energy;
  const path: Vec3[] = [];

  for (let i = 0; i < c.surfaces.length; i++) {
    const s = c.surfaces[i]!;

    // World → surface local frame. Axial systems (the overwhelmingly common
    // case) skip the matrix entirely.
    const localOrigin = s.isAxial
      ? vec3(origin.x, origin.y, origin.z - s.vertexZ)
      : applyToPoint(s.inverseFrame, origin);
    const localDir = s.isAxial ? dir : applyToDirection(s.inverseFrame, dir);

    const hit = s.geometry.intersect(localOrigin, localDir);
    if (!hit) return { status: "miss", opl, path, throughput, failedAt: i };

    const globalPoint = s.isAxial
      ? vec3(hit.point.x, hit.point.y, hit.point.z + s.vertexZ)
      : applyToPoint(s.frame, hit.point);
    const globalNormal = s.isAxial ? hit.normal : applyToDirection(s.frame, hit.normal);

    path.push(globalPoint);
    opl += n[i]! * hit.t;

    // Aperture is tested in the surface's own frame — a tilted surface's
    // clear aperture is a disc on the surface, not its projection.
    //
    // The rim is inclusive, and the tolerance is what makes that survive f64.
    // A ray landing exactly ON the rim is the DESIGNED case here, not a corner
    // case: the ordinary way to author a system is a stop whose radius is the
    // element's clear aperture, which puts every marginal ray exactly on it,
    // and an element sized to just catch its beam (a minimum Newtonian
    // diagonal) is tangent to that beam by construction. Without the tolerance
    // the last ulp of the intersection solve decides, and the pupil edge
    // vignettes in a scatter of points that looks like physics and is not.
    const r2 = hit.point.x * hit.point.x + hit.point.y * hit.point.y;
    const rim = s.semiAperture * s.semiAperture;
    if (Number.isFinite(s.semiAperture) && r2 > rim * (1 + 1e-12)) {
      return { status: "vignetted", opl, path, throughput, failedAt: i };
    }

    if (s.kind === "reflect") {
      dir = normalize(reflectDir(dir, globalNormal));
      throughput *= s.reflectance ?? 1;
    } else {
      const result = interact(dir, globalNormal, n[i]!, n[i + 1]!);
      if (result.tir || !result.refracted) {
        return { status: "tir", opl, path, throughput, failedAt: i };
      }
      dir = normalize(result.refracted);
      throughput *= s.reflectance ?? result.T;
    }

    origin = globalPoint;
  }

  return {
    status: "ok",
    ray: makeRay(origin, dir, input.wavelengthNm, throughput),
    opl,
    path,
    throughput,
  };
}

/**
 * Convenience: a ray parallel to the axis at height h (in x), starting at
 * z = startZ, traveling +z.
 */
export function parallelRay(h: number, wavelengthNm: number, startZ = -10): Ray {
  return makeRay(vec3(h, 0, startZ), vec3(0, 0, 1), wavelengthNm);
}

/**
 * z at which a meridional (x–z plane) ray crosses the optical axis.
 * Throws if the ray is parallel to the axis.
 */
export function axialCrossingZ(ray: Ray): number {
  if (Math.abs(ray.dir.x) < 1e-15) throw new Error("ray is parallel to the axis");
  const t = -ray.origin.x / ray.dir.x;
  return ray.origin.z + t * ray.dir.z;
}

/** Point along a traced output ray at parameter t (mm). */
export function pointOnRay(ray: Ray, t: number): Vec3 {
  return along(ray.origin, ray.dir, t);
}
