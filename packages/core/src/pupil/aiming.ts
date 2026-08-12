import { Vec3, vec3, sub, add, scale, dot, normalize } from "../math/vec3";
import { applyToPoint } from "../math/transform";
import { Ray, makeRay } from "../trace/ray";
import { OpticalSystem } from "../trace/system";
import { CompiledSystem, asCompiled, compile } from "../trace/compile";
import { traceRay } from "../trace/sequential";
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

/**
 * Orient an aim toward the optics.
 *
 * Aiming is a statement about a **line**: the ray from the object point through
 * the chosen entrance-pupil point. Which way it is *travelled* is separate, and
 * in object space light always travels +z (surface 0's vertex is at z = 0 and
 * the object sits behind it; object space is never after a mirror).
 *
 * The two come apart because an entrance pupil is a paraxial IMAGE of the stop
 * and may be virtual — and a virtual one can land **behind the object plane**.
 * `target − origin` then points away from the optics, and the aimed ray
 * propagates in −z. Nothing downstream can recover: `traceRay` reports `miss`,
 * so the system reads as one whose rays do not reach it, when the geometry is
 * ordinary and the pupil point is perfectly reachable. Pinned at § 1.5.2.
 *
 * The regime is not exotic: it is everything approaching object-space
 * telecentricity from either side. As the stop moves toward the front group's
 * back focal plane the entrance pupil runs off to ∓∞, and it is behind the
 * object for every stop position past the one that images it to the object
 * plane. That is why no rung caught this — the exactly-telecentric case throws
 * a *different* error (see the head of `aimRay`), and every system in the
 * ladder puts its stop where the entrance pupil stays in front.
 *
 * `dz === 0` is the boundary between the two orientations: the pupil lies IN
 * the object plane, the line is perpendicular to the axis, and no ray along it
 * ever reaches the optics. Refused rather than returned as a `miss`.
 */
function towardOptics(d: Vec3, objectZ: number): Vec3 {
  if (d.z === 0) {
    throw new Error(
      `entrance pupil lies in the object plane (z = ${objectZ}): the aim is perpendicular to the axis ` +
        `and no ray along it reaches the optics`,
    );
  }
  return d.z > 0 ? d : scale(d, -1);
}

/**
 * Aiming when the entrance pupil is at infinity — § 6a's object-space blocker.
 *
 * Real objectives put the stop at the **back focal plane**, which makes them
 * object-space telecentric: chief rays leave the specimen parallel to the axis,
 * so magnification does not drift with defocus. That is the configuration the
 * whole microscope branch has been approximating with the stop on the
 * objective's own rim, and it is the one `aimRay` refused outright.
 *
 * The refusal was right about the diagnosis and wrong to stop there. Aiming at
 * a POINT is not what aiming means — it is what aiming *reduces to* when the
 * pupil is at a finite distance. A pupil at infinity is a set of **directions**,
 * so the normalized pupil coordinate names a slope, and the construction is the
 * same construction one limit further out:
 *
 *     dir ∝ (px·tan u_max, py·tan u_max, 1)
 *
 * with `tan u_max = stopRadius/B` carried on the pupil geometry (`pupils.ts`).
 * It contains **no object height**, which is not an approximation but the
 * defining property: telecentricity is `A = 0` in `y_stop = A·h + B·u`, so every
 * field point sees the same cone. Aiming here is therefore *simpler* than the
 * finite case rather than harder, which is why the tangent — matching the finite
 * branch, where a target a finite arm away subtends one — is the right reading
 * and not the sine (§ 1.5.1's distinction, on the other spelling of the same
 * aperture).
 *
 * WAVEFRONT REFERENCE is unchanged and needs no new case: this branch is
 * finite-conjugate, so every ray starts at the object point itself and the
 * equal-phase surface is a sphere.
 *
 * An INFINITE conjugate with a telecentric entrance pupil is a different
 * animal — the object is at infinity and so is the pupil, so there is no
 * object-space cone to aim at all — and is refused rather than guessed.
 */
function aimObjectSpace(
  system: OpticalSystem,
  pupil: PupilGeometry,
  fieldValue: number,
  point: PupilPoint,
  wavelengthNm: number,
): Ray {
  const slope = pupil.entrance.slopeRadius;
  if (slope === undefined) {
    throw new Error(
      "entrance pupil is at infinity but carries no slope aperture: the pupil geometry is inconsistent",
    );
  }
  if (system.conjugate.kind !== "finite") {
    throw new Error(
      "an object at infinity behind a telecentric entrance pupil has no object-space cone to aim",
    );
  }
  const o = objectPoint(system, fieldValue);
  return makeRay(o, normalize(vec3(point.px * slope, point.py * slope, 1)), wavelengthNm);
}

/**
 * REAL RAY AIMING — docs/VALIDATION.md § 1.5.3.
 *
 * `aimRay`'s default aims at the first-order entrance pupil, and `pupils()`
 * computes that on the straight-axis twin, which drops tilt and decenter
 * (`trace/axis`'s SCOPE note). On an aligned system the two agree — the pupil
 * really is on the axis. On a MISALIGNED one they do not, and not by a subtlety:
 * in the local coordinate chain a decenter or tilt on a surface carries every
 * surface after it, **the stop included**, so a 0.5 mm shift upstream moves the
 * stop 0.5 mm and the paraxial aim keeps pointing at where the stop used to be.
 *
 * What that costs is not the millimetre — it is that the error has the SAME
 * SHAPE as the physics being measured. A pupil sampled off-centre puts a
 * field-constant coma-like term on the wavefront, which is exactly the signature
 * a misalignment produces, so a field curve drawn under paraxial aiming cannot
 * separate the two. Measured on § 5j's doublet, a rigid 0.2° turn of the whole
 * instrument — which by construction introduces NO new asymmetry at all —
 * reports up to 3.9e-3 waves of one, against 3.7e-2 waves for a genuine
 * one-surface tilt of the same size. A tenth of the signal, in the signal's own
 * shape.
 *
 * So the solve: find the pupil-plane target whose traced ray lands on the point
 * the coordinate names **in the stop's own local frame**. The construction is
 * otherwise untouched — same launch plane, same wavefront reference — because
 * only WHERE the aim points changes, not what a ray is.
 *
 * SCOPE. `stopRadius` still comes from the axial twin, so this aims at a
 * circular stop of the nominal radius read in the tilted stop's own frame. That
 * is the physically right reading of "40% of the way across the stop" for a
 * tilted iris; the *projected* aperture of one, which is an ellipse, is a
 * vignetting question and is not this.
 */

/** A ray's transverse miss at the stop, in the stop's own frame. */
type StopMiss = readonly [number, number];

const UNCLIPPED = new WeakMap<CompiledSystem, CompiledSystem>();

/**
 * The same chain with every rim removed, used ONLY while solving.
 *
 * Aiming decides which ray to launch; whether that ray survives the apertures
 * is the caller's trace to report. Without this an iterate that strays outside
 * a rim returns no hit point and the solve stalls on a system whose final
 * answer is perfectly unvignetted.
 */
function unclipped(c: CompiledSystem): CompiledSystem {
  let u = UNCLIPPED.get(c);
  if (!u) {
    u = compile({
      ...c.prescription,
      surfaces: c.prescription.surfaces.map((s) => ({ ...s, semiAperture: Infinity })),
    });
    UNCLIPPED.set(c, u);
  }
  return u;
}

/** Jacobian of (stop x, stop y) against the pupil-plane target, per field and λ. */
const JACOBIANS = new WeakMap<CompiledSystem, Map<string, readonly number[]>>();

const MAX_CHORD_STEPS = 24;
const MAX_NEWTON_STEPS = 12;

function solveOntoStop(
  system: OpticalSystem,
  pupil: PupilGeometry,
  fieldValue: number,
  point: PupilPoint,
  wavelengthNm: number,
  seed: { qx: number; qy: number },
  construct: (qx: number, qy: number) => Ray,
): { qx: number; qy: number } {
  const c = asCompiled(system.prescription);
  const solveIn = unclipped(c);
  const k = pupil.stopIndex;
  const stop = c.surfaces[k]!;
  const tx = point.px * pupil.stopRadius;
  const ty = point.py * pupil.stopRadius;

  const miss = (qx: number, qy: number): StopMiss | null => {
    const res = traceRay(solveIn, construct(qx, qy));
    const hit = res.path[k];
    if (!hit) return null;
    const local = applyToPoint(stop.inverseFrame, hit);
    return [local.x - tx, local.y - ty];
  };

  // The scale everything here is measured against. A stop radius is the natural
  // one: it is what a pupil coordinate is a fraction of.
  const scaleMm = Math.max(pupil.stopRadius, 1);
  const tol = 1e-12 * scaleMm;
  const h = 1e-5 * scaleMm;

  const jacobianAt = (qx: number, qy: number): readonly number[] | null => {
    const px = miss(qx + h, qy);
    const mx = miss(qx - h, qy);
    const py = miss(qx, qy + h);
    const my = miss(qx, qy - h);
    if (!px || !mx || !py || !my) return null;
    const j = [
      (px[0] - mx[0]) / (2 * h),
      (py[0] - my[0]) / (2 * h),
      (px[1] - mx[1]) / (2 * h),
      (py[1] - my[1]) / (2 * h),
    ];
    return Math.abs(j[0]! * j[3]! - j[1]! * j[2]!) > 0 ? j : null;
  };

  const step = (j: readonly number[], f: StopMiss): [number, number] => {
    const det = j[0]! * j[3]! - j[1]! * j[2]!;
    return [
      -(j[3]! * f[0] - j[1]! * f[1]) / det,
      -(-j[2]! * f[0] + j[0]! * f[1]) / det,
    ];
  };

  // The aim depends on the field and the wavelength, never on the pupil point:
  // one Jacobian therefore serves a whole bundle, which is what keeps this
  // affordable. Leaving the field out of the key would silently reuse one
  // field's linearization for the next and cost accuracy, not just speed.
  const key = `${system.conjugate.kind}|${pupil.stopIndex}|${fieldValue}|${wavelengthNm}`;
  let perSystem = JACOBIANS.get(c);
  if (!perSystem) JACOBIANS.set(c, (perSystem = new Map()));

  let qx = seed.qx;
  let qy = seed.qy;
  let f = miss(qx, qy);
  if (!f) {
    throw new Error(
      `rayAiming 'real': the seed ray does not reach the stop (surface ${k}) — the system cannot be aimed through (§ 1.5.3)`,
    );
  }

  // Chord phase: one Jacobian, reused for every ray of this field and λ. The
  // map from a pupil-plane target to a stop coordinate is the first-order
  // mapping plus distortion, so it is nearly affine and this converges in a
  // handful of steps at one trace each — the whole reason real aiming costs a
  // small multiple of paraxial aiming rather than a large one.
  let j = perSystem.get(key) ?? null;
  if (!j) {
    j = jacobianAt(seed.qx, seed.qy);
    if (j) perSystem.set(key, j);
  }
  if (j) {
    for (let i = 0; i < MAX_CHORD_STEPS && Math.hypot(f[0], f[1]) > tol; i++) {
      const [dx, dy] = step(j, f);
      const next = miss(qx + dx, qy + dy);
      if (!next || Math.hypot(next[0], next[1]) >= Math.hypot(f[0], f[1])) break;
      qx += dx;
      qy += dy;
      f = next;
    }
  }
  if (Math.hypot(f[0], f[1]) <= tol) return { qx, qy };

  // Newton phase, entered only when the shared Jacobian was not good enough
  // here — a rim ray of a strongly misaligned system, where the mapping is no
  // longer close to its axial linearization.
  for (let i = 0; i < MAX_NEWTON_STEPS && Math.hypot(f[0], f[1]) > tol; i++) {
    const jl = jacobianAt(qx, qy);
    if (!jl) break;
    const [dx, dy] = step(jl, f);
    const next = miss(qx + dx, qy + dy);
    if (!next) break;
    qx += dx;
    qy += dy;
    f = next;
    if (Math.hypot(dx, dy) <= tol) break;
  }
  if (Math.hypot(f[0], f[1]) > 1e-9 * scaleMm) {
    throw new Error(
      `rayAiming 'real': no launch reaches (${point.px.toFixed(3)}, ${point.py.toFixed(3)}) on the stop — best miss ${Math.hypot(f[0], f[1]).toExponential(2)} mm (§ 1.5.3)`,
    );
  }
  return { qx, qy };
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
    if (system.rayAiming === "real") {
      // Not a fallback: a pupil at infinity names directions, so "the point on
      // the stop this coordinate means" is a different construction and not a
      // refinement of this one. Refused rather than quietly aimed the old way.
      throw new Error(
        "rayAiming 'real' is not defined for an entrance pupil at infinity — the coordinate names a slope, not a point (§ 1.5.3)",
      );
    }
    return aimObjectSpace(system, pupil, fieldValue, point, wavelengthNm);
  }

  const construct = (qx: number, qy: number): Ray => {
    const target = vec3(qx, qy, pupil.entrance.z);
    if (system.conjugate.kind === "finite") {
      const o = objectPoint(system, fieldValue);
      return makeRay(o, normalize(towardOptics(sub(target, o), o.z)), wavelengthNm);
    }
    const dir = fieldDirection(system, fieldValue);
    const z0 = options.launchZ ?? defaultLaunchZ(pupil);
    const p0 = vec3(0, 0, z0);
    // Project the pupil target back onto the plane through p0 normal to dir:
    // origin + dir·s = target, with origin guaranteed to lie on that plane.
    const s = dot(sub(target, p0), dir);
    return makeRay(sub(target, scale(dir, s)), dir, wavelengthNm);
  };

  const seed = { qx: point.px * r, qy: point.py * r };
  if (system.rayAiming !== "real") return construct(seed.qx, seed.qy);

  const solved = solveOntoStop(system, pupil, fieldValue, point, wavelengthNm, seed, construct);
  return construct(solved.qx, solved.qy);
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
