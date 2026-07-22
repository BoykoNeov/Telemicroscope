import { SurfaceGeometry, makeConic, makeEvenAsphere } from "../geometry/surfaces";

/**
 * The one data model both branches share: an ordered surface list.
 * A Newtonian and a 100x oil objective are different instances of this.
 *
 * Conventions (docs/ARCHITECTURE.md):
 *  - light starts along +z; surface 0's vertex is at z = 0
 *  - thickness = signed axial distance to the next vertex (negative after
 *    mirrors, where rays travel −z)
 *  - medium = name of the material AFTER the surface (ignored for mirrors,
 *    which keep the incident medium)
 *
 * Tilt/decenter per surface will attach a Transform here (architecture
 *commitment #3 — the engine already traces in per-surface local frames).
 */
export interface SurfaceSpec {
  readonly kind: "refract" | "reflect";
  /** 1/mm. 0 = plane. */
  readonly curvature: number;
  readonly conic?: number;
  /** Even-asphere coefficients A₄, A₆, … (mm^(1−order)). */
  readonly asphereCoeffs?: readonly number[];
  /** Clear semi-aperture (mm). Infinity = unbounded. */
  readonly semiAperture: number;
  /** Signed distance to next vertex (mm). Last surface: to the image plane. */
  readonly thickness: number;
  /** Medium after this surface (catalog name). Required for `refract`. */
  readonly medium?: string;
  readonly isStop?: boolean;
  /**
   * Tilt of this surface about its own vertex, degrees, applied X then Y.
   * Thickness advances along the TILTED surface's local z — the local
   * coordinate chain, so a tilted fold steers everything downstream of it
   * (docs/ARCHITECTURE.md § Tilt / decenter semantics).
   */
  readonly tiltXDeg?: number;
  readonly tiltYDeg?: number;
  /** Decenter of this surface's vertex within its frame (mm). */
  readonly decenterX?: number;
  readonly decenterY?: number;
  /**
   * Energy fraction surviving this surface, overriding the computed Fresnel
   * value: mirror reflectance, or a coating's transmittance. Null/absent ⇒
   * uncoated Fresnel for refraction, perfect (1.0) for mirrors.
   */
  readonly reflectance?: number;
}

export interface Prescription {
  /** Medium before the first surface. Default "AIR". */
  readonly objectMedium?: string;
  readonly surfaces: readonly SurfaceSpec[];
}

export function surfaceGeometry(spec: SurfaceSpec): SurfaceGeometry {
  const k = spec.conic ?? 0;
  return spec.asphereCoeffs && spec.asphereCoeffs.length > 0
    ? makeEvenAsphere(spec.curvature, k, spec.asphereCoeffs)
    : makeConic(spec.curvature, k);
}

/** Vertex z position of every surface (surface 0 at z = 0). */
export function vertexPositions(p: Prescription): number[] {
  const zs: number[] = [];
  let z = 0;
  for (const s of p.surfaces) {
    zs.push(z);
    z += s.thickness;
  }
  return zs;
}
