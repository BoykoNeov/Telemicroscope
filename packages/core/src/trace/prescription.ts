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

/**
 * How the coordinate chain crosses a mirror. The two are each self-consistent
 * and cannot be mixed inside one prescription, so the choice is made here,
 * once, and never inferred from the data (a misalignment tilt on a mirror must
 * not silently change what every downstream thickness means).
 *
 *  - `"unfolded"` (default) — the chain keeps its direction through a mirror,
 *    so rays travel −z afterwards and thicknesses go negative, alternating with
 *    each mirror. Curvature signs stay in the launch frame. This is the
 *    convention every existing rung is validated under, and it is what the
 *    paraxial engine's n′ = −n trace expects.
 *  - `"folded"` — the chain *reflects* in the mirror's tangent plane, so its
 *    local +z follows the beam. Thicknesses are then always distances along the
 *    light, and a curvature's sign is read against the propagation direction.
 *    A 45° flat deviates the whole downstream chain by 90°, which is the only
 *    way a Newtonian's diagonal can place an eyepiece where it physically sits.
 *
 * Folded prescriptions trace exactly; everything first-order — the paraxial
 * layer, pupils, OPD, focus and the PSF — runs on the straightened
 * `unfoldedTwin` and is carried back into the world by `trace/axis`, which is
 * what lets a folded system image at all (docs/ARCHITECTURE.md).
 */
export type MirrorFrames = "unfolded" | "folded";

export interface Prescription {
  /** Medium before the first surface. Default "AIR". */
  readonly objectMedium?: string;
  readonly surfaces: readonly SurfaceSpec[];
  /** Default "unfolded". */
  readonly mirrorFrames?: MirrorFrames;
}

export const isFolded = (p: Prescription): boolean => p.mirrorFrames === "folded";

/**
 * The unfolded equivalent of a folded prescription: the same optics laid out
 * along one straight axis, which is the only form the paraxial engine and its
 * n′ = −n mirror convention can read.
 *
 * Each mirror flips the sense of the axis, so with `parity` = (−1)^(mirrors so
 * far), a surface's curvature — read against the beam in folded authoring —
 * unfolds as `c · parity` *before* its own reflection is counted, and its
 * thickness as `t · parity` *after*. Tilt and decenter are dropped: the
 * paraxial trace is first-order about the axis and already ignores them.
 */
export function unfoldedTwin(p: Prescription): Prescription {
  if (!isFolded(p)) return p;
  let parity = 1;
  const surfaces = p.surfaces.map((s): SurfaceSpec => {
    const { tiltXDeg, tiltYDeg, decenterX, decenterY, ...axial } = s;
    const curvature = s.curvature * parity;
    if (s.kind === "reflect") parity = -parity;
    return { ...axial, curvature, thickness: s.thickness * parity };
  });
  return { ...p, surfaces, mirrorFrames: "unfolded" };
}

export function surfaceGeometry(spec: SurfaceSpec): SurfaceGeometry {
  const k = spec.conic ?? 0;
  return spec.asphereCoeffs && spec.asphereCoeffs.length > 0
    ? makeEvenAsphere(spec.curvature, k, spec.asphereCoeffs)
    : makeConic(spec.curvature, k);
}

/**
 * Vertex z position of every surface (surface 0 at z = 0). Straight thickness
 * accumulation, so it is axial-only: for a tilted or folded chain the vertices
 * are not on one z-axis at all, and `vertexPoint` on the compiled system is
 * the answer.
 */
export function vertexPositions(p: Prescription): number[] {
  if (isFolded(p)) throw new Error("vertexPositions is axial-only; use vertexPoint on the compiled system");
  const zs: number[] = [];
  let z = 0;
  for (const s of p.surfaces) {
    zs.push(z);
    z += s.thickness;
  }
  return zs;
}
