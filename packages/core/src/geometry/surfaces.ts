import { Vec3, vec3, along, normalize } from "../math/vec3";

/**
 * Surface geometry, in the surface's LOCAL frame: vertex at the origin,
 * optical axis along +z. Traversal-agnostic — a surface never knows about
 * "the next surface"; the sequential engine is one consumer, a future
 * non-sequential engine (BVH) is another.
 *
 * Conic sag: z(r²) = c·r² / (1 + √(1 − (1+k)·c²·r²))
 *   c = 1/R (R > 0 ⇒ center of curvature at +z),  k: conic constant
 *   k = 0 sphere, k = −1 paraboloid, k < −1 hyperboloid, −1 < k < 0 prolate ellipsoid.
 * Even asphere adds Σ Aᵢ·r^(2i+4)  (A[0]·r⁴ + A[1]·r⁶ + …).
 */
export interface SurfaceGeometry {
  readonly curvature: number;
  readonly conic: number;
  readonly asphereCoeffs: readonly number[];
  sag(r2: number): number;
  /**
   * Nearest intersection along the ray (t > EPS_T), or null.
   * The returned normal is the unit surface normal on the side facing −z at
   * the vertex (i.e. against the nominal direction of travel); interaction
   * code must not assume its orientation relative to the ray.
   */
  intersect(origin: Vec3, dir: Vec3): SurfaceHit | null;
}

export interface SurfaceHit {
  /** Distance along the (unit) ray direction. Always > 0. */
  readonly t: number;
  readonly point: Vec3;
  readonly normal: Vec3;
}

const EPS_T = 1e-9;
const EPS_CURV = 1e-14;

export function conicSag(c: number, k: number, r2: number): number {
  if (Math.abs(c) < EPS_CURV) return 0;
  const arg = 1 - (1 + k) * c * c * r2;
  if (arg < 0) return NaN; // beyond the surface's real extent
  return (c * r2) / (1 + Math.sqrt(arg));
}

/**
 * Implicit form of the conic: F(x,y,z) = c(x²+y²) + c(1+k)z² − 2z = 0
 * (equivalent to the sag equation on the vertex branch).
 * ∇F = (2cx, 2cy, 2c(1+k)z − 2).
 */
function conicNormal(c: number, k: number, p: Vec3): Vec3 {
  return normalize(vec3(2 * c * p.x, 2 * c * p.y, 2 * c * (1 + k) * p.z - 2));
}

/**
 * Exact conic intersection (Spencer & Murty style): transfer the ray to the
 * vertex tangent plane z = 0, then solve the quadric from there and take the
 * root nearest the tangent plane — this selects the vertex branch of
 * two-sheeted quadrics.
 */
export function intersectConic(c: number, k: number, origin: Vec3, dir: Vec3): SurfaceHit | null {
  // Plane case.
  if (Math.abs(c) < EPS_CURV) {
    if (Math.abs(dir.z) < 1e-15) return null;
    const t = -origin.z / dir.z;
    if (t < EPS_T) return null;
    return { t, point: along(origin, dir, t), normal: vec3(0, 0, -1) };
  }

  if (Math.abs(dir.z) < 1e-15) return null; // rays skimming the tangent plane: unsupported in v1
  const tPlane = -origin.z / dir.z;
  const p0 = along(origin, dir, tPlane); // p0.z ≈ 0

  const ck = c * (1 + k);
  const A = c * (dir.x * dir.x + dir.y * dir.y) + ck * dir.z * dir.z;
  const B = 2 * c * (p0.x * dir.x + p0.y * dir.y) - 2 * dir.z;
  const C = c * (p0.x * p0.x + p0.y * p0.y);

  let s: number;
  if (Math.abs(A) < 1e-18) {
    if (Math.abs(B) < 1e-18) return null;
    s = -C / B;
  } else {
    const disc = B * B - 4 * A * C;
    if (disc < 0) return null;
    const sq = Math.sqrt(disc);
    // Numerically stable pair of roots.
    const q = -0.5 * (B + Math.sign(B || 1) * sq);
    const s1 = q / A;
    const s2 = Math.abs(q) > 0 ? C / q : s1;
    // Nearest the tangent plane ⇒ vertex branch.
    s = Math.abs(s1) <= Math.abs(s2) ? s1 : s2;
    const tCand = tPlane + s;
    if (tCand < EPS_T) {
      const sOther = s === s1 ? s2 : s1;
      if (tPlane + sOther < EPS_T) return null;
      s = sOther;
    }
  }

  const t = tPlane + s;
  if (t < EPS_T || !Number.isFinite(t)) return null;
  const point = along(origin, dir, t);
  return { t, point, normal: conicNormal(c, k, point) };
}

export function makeConic(curvature: number, conic = 0): SurfaceGeometry {
  return {
    curvature,
    conic,
    asphereCoeffs: [],
    sag: (r2) => conicSag(curvature, conic, r2),
    intersect: (o, d) => intersectConic(curvature, conic, o, d),
  };
}

export const makePlane = (): SurfaceGeometry => makeConic(0, 0);

/**
 * Even asphere: conic base + polynomial terms. Intersection starts from the
 * base-conic hit and Newton-iterates on g(t) = z(t) − sag(r²(t)).
 */
export function makeEvenAsphere(
  curvature: number,
  conic: number,
  coeffs: readonly number[],
): SurfaceGeometry {
  const sag = (r2: number): number => {
    let z = conicSag(curvature, conic, r2);
    let rPow = r2 * r2; // r⁴
    for (const a of coeffs) {
      z += a * rPow;
      rPow *= r2;
    }
    return z;
  };

  const dSagDr2 = (r2: number): number => {
    // Derivative of the conic part w.r.t. r².
    let d: number;
    if (Math.abs(curvature) < EPS_CURV) {
      d = 0;
    } else {
      const arg = 1 - (1 + conic) * curvature * curvature * r2;
      if (arg <= 0) return NaN;
      const sq = Math.sqrt(arg);
      // z = c r²/(1+sq);  dz/dr² = c/(1+sq) + c r² · c²(1+k)/(2·sq·(1+sq)²)
      d = curvature / (1 + sq) +
        (curvature * r2 * curvature * curvature * (1 + conic)) / (2 * sq * (1 + sq) * (1 + sq));
    }
    let rPow = r2; // d(r⁴)/dr² = 2r²
    let m = 2;
    for (const a of coeffs) {
      d += a * m * rPow;
      rPow *= r2;
      m += 1;
    }
    return d;
  };

  return {
    curvature,
    conic,
    asphereCoeffs: coeffs,
    sag,
    intersect(origin: Vec3, dir: Vec3): SurfaceHit | null {
      const base = intersectConic(curvature, conic, origin, dir) ??
        intersectConic(0, 0, origin, dir); // fall back to tangent plane as seed
      if (!base) return null;
      let t = base.t;
      for (let i = 0; i < 32; i++) {
        const p = along(origin, dir, t);
        const r2 = p.x * p.x + p.y * p.y;
        const g = p.z - sag(r2);
        if (!Number.isFinite(g)) return null;
        if (Math.abs(g) < 1e-12) {
          const ds = dSagDr2(r2);
          const n = normalize(vec3(-2 * p.x * ds, -2 * p.y * ds, 1));
          // Match conic normal orientation (−z at vertex).
          return { t, point: p, normal: vec3(-n.x, -n.y, -n.z) };
        }
        const ds = dSagDr2(r2);
        const dg = dir.z - ds * 2 * (p.x * dir.x + p.y * dir.y);
        if (Math.abs(dg) < 1e-15) return null;
        t -= g / dg;
        if (t < EPS_T || !Number.isFinite(t)) return null;
      }
      return null; // no convergence
    },
  };
}
