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
  const construct = (qx: number, qy: number): Ray => makeRay(o, normalize(vec3(qx, qy, 1)), wavelengthNm);
  const seed = { qx: point.px * slope, qy: point.py * slope };
  if (system.rayAiming !== "real") return construct(seed.qx, seed.qy);
  // Real aiming at a pupil at infinity (§ 2z.1). The coordinate still names a
  // point on the STOP — that is what "real" means — and only what is solved for
  // changes: a slope from the object point rather than a target on a plane at
  // infinity. Every telecentric objective is in this branch at its design
  // wavelength, and next to it the plane solve aims at a pupil 1e5 mm away; the
  // two land the same ray on the same stop point, which is the continuity the
  // paraxial aim, switching from a target to a slope at the crossing, never had.
  const solved = solveOntoStop(system, pupil, fieldValue, point, wavelengthNm, seed, construct, {
    space: "slope",
    stepScale: slope,
  });
  return construct(solved.qx, solved.qy);
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

/**
 * A ray's transverse miss at the stop, in the stop's own frame, and the first
 * surface its continuation crosses behind itself (-1 where none does, up to the
 * stop).
 */
type StopMiss = readonly [number, number, number];

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
const CONTINUATION = { minT: -Infinity } as const;
const MAX_NEWTON_STEPS = 12;

/** What the solve moves: a target on the entrance-pupil plane, or a slope from the object point. */
type SolveSpace = { readonly space: "target" } | { readonly space: "slope"; readonly stepScale: number };

function solveOntoStop(
  system: OpticalSystem,
  pupil: PupilGeometry,
  fieldValue: number,
  point: PupilPoint,
  wavelengthNm: number,
  seed: { qx: number; qy: number },
  construct: (qx: number, qy: number) => Ray,
  solve: SolveSpace = { space: "target" },
): { qx: number; qy: number } {
  const c = asCompiled(system.prescription);
  const solveIn = unclipped(c);
  const k = pupil.stopIndex;
  const stop = c.surfaces[k]!;
  const tx = point.px * pupil.stopRadius;
  const ty = point.py * pupil.stopRadius;

  // Solved through the CONTINUATION (§ 2z.4): each surface's vertex-branch root
  // wherever it falls, so the map from launch to stop runs on smoothly past a
  // lens's knife edge, where a real ray stops existing because its next
  // surface's root falls behind it. Reachable is then a property of the SOLVED
  // ray — every crossing ahead of it — and its edge a sign change of t, located
  // as finely as any smooth function, where a solve that gave up at the hole
  // put it wherever the iteration happened to stall.
  // Nothing past the stop decides where a ray lands on it.
  const toStop = { ...CONTINUATION, lastSurface: k };
  const miss = (qx: number, qy: number): StopMiss | null => {
    const res = traceRay(solveIn, construct(qx, qy), toStop);
    const hit = res.path[k];
    if (!hit) return null;
    const local = applyToPoint(stop.inverseFrame, hit);
    const behind = res.behindAt !== undefined && res.behindAt <= k ? res.behindAt : -1;
    return [local.x - tx, local.y - ty, behind];
  };

  // The scale everything here is measured against. A stop radius is the natural
  // one: it is what a pupil coordinate is a fraction of.
  const scaleMm = Math.max(pupil.stopRadius, 1);
  const tol = 1e-12 * scaleMm;
  // The difference step is in the unknown's own units: millimetres on the pupil
  // plane, or a slope — where a millimetre-sized step would be a tenth of the cone.
  const h = 1e-5 * (solve.space === "slope" ? solve.stepScale : scaleMm);

  const jacobianAt = (qx: number, qy: number): readonly number[] | null => {
    const px = miss(qx + h, qy);
    const mx = miss(qx - h, qy);
    const py = miss(qx, qy + h);
    const my = miss(qx, qy - h);
    // One-sided where the centred stencil straddles the edge of the rays that
    // reach the stop at all — a lens's knife edge, where a solve for a point just
    // inside it otherwise stops one step short (§ 2z.1).
    const along = (p: StopMiss | null, m: StopMiss | null): [number, number] | null => {
      if (p && m) return [(p[0] - m[0]) / (2 * h), (p[1] - m[1]) / (2 * h)];
      const f0 = miss(qx, qy);
      if (!f0) return null;
      if (p) return [(p[0] - f0[0]) / h, (p[1] - f0[1]) / h];
      if (m) return [(f0[0] - m[0]) / h, (f0[1] - m[1]) / h];
      return null;
    };
    const dx = along(px, mx);
    const dy = along(py, my);
    if (!dx || !dy) return null;
    const j = [dx[0], dy[0], dx[1], dy[1]];
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
  const key = `${system.conjugate.kind}|${solve.space}|${pupil.stopIndex}|${fieldValue}|${wavelengthNm}`;
  let perSystem = JACOBIANS.get(c);
  if (!perSystem) JACOBIANS.set(c, (perSystem = new Map()));

  let qx = seed.qx;
  let qy = seed.qy;
  let f = miss(qx, qy);
  // A paraxial seed that overfills the stop can miss a surface the stop point's
  // own ray clears (the DIN 4×/0.20's lands 9.5% past the stop's rim): start from
  // the farthest reachable seed toward the chief's instead (§ 2z.1).
  for (let t = 0.9; !f && t > -0.05; t -= 0.1) {
    const s = Math.max(t, 0);
    qx = seed.qx * s;
    qy = seed.qy * s;
    f = miss(qx, qy);
  }
  if (!f) {
    throw new UnreachableStopPoint(
      `rayAiming 'real': neither the seed ray nor the chief's reaches the stop (surface ${k}) — the system cannot be aimed through (§ 1.5.3)`,
      "aim",
    );
  }

  // Chord phase: one Jacobian, reused for every ray of this field and λ. The
  // map from a pupil-plane target to a stop coordinate is the first-order
  // mapping plus distortion, so it is nearly affine and this converges in a
  // handful of steps at one trace each — the whole reason real aiming costs a
  // small multiple of paraxial aiming rather than a large one.
  let j = perSystem.get(key) ?? null;
  if (!j) {
    j = jacobianAt(qx, qy);
    if (j) perSystem.set(key, j);
  }
  // The chord runs on past `tol`: a rim ray is solved onto the stop's own rim,
  // and the trace clips at the rim's radius² × (1 + 1e-12), 5e-13 of the radius —
  // a landing past that reads vignetted BY THE STOP (§ 2z.1). A tenth of `tol`
  // clears it on every stop down to 0.2 mm; it was a thousandth, which the chord
  // reached a step later on every ray for nothing the clip can see (§ 2z.6).
  const fine = 0.1 * tol;
  if (j) {
    // The shared Jacobian is the axial-ish linearization; this ray's own map is
    // that plus the pupil's aberration, so each step's own secant corrects it
    // (Broyden's rank-one update) and the chord gains superlinearly rather than
    // by the fixed ratio a stale slope allows — two to three traces a ray (§ 2z.6).
    const jb = [...j];
    for (let i = 0; i < MAX_CHORD_STEPS && Math.hypot(f[0], f[1]) > fine; i++) {
      let [dx, dy] = step(jb, f);
      let next = miss(qx + dx, qy + dy);
      for (let b = 0; b < 40 && !next; b++) {
        dx /= 2;
        dy /= 2;
        next = miss(qx + dx, qy + dy);
      }
      if (!next || Math.hypot(next[0], next[1]) >= Math.hypot(f[0], f[1])) break;
      const r0 = next[0] - f[0] - (jb[0]! * dx + jb[1]! * dy);
      const r1 = next[1] - f[1] - (jb[2]! * dx + jb[3]! * dy);
      const d2 = dx * dx + dy * dy;
      jb[0] = jb[0]! + (r0 * dx) / d2;
      jb[1] = jb[1]! + (r0 * dy) / d2;
      jb[2] = jb[2]! + (r1 * dx) / d2;
      jb[3] = jb[3]! + (r1 * dy) / d2;
      qx += dx;
      qy += dy;
      f = next;
    }
  }
  if (Math.hypot(f[0], f[1]) <= tol) return reached(qx, qy, f);

  // Newton phase, entered only when the shared Jacobian was not good enough
  // here — a rim ray of a strongly misaligned system, where the mapping is no
  // longer close to its axial linearization.
  for (let i = 0; i < MAX_NEWTON_STEPS && Math.hypot(f[0], f[1]) > tol; i++) {
    const jl = jacobianAt(qx, qy);
    if (!jl) break;
    let [dx, dy] = step(jl, f);
    let next = miss(qx + dx, qy + dy);
    // A full step can leave the rays that reach the stop at all — near a surface
    // they graze, which is where a field-limited lens's rim is (§ 2z.1). Halve it
    // until it lands, rather than calling a reachable point unreachable.
    for (let b = 0; b < 40 && !next; b++) {
      dx /= 2;
      dy /= 2;
      next = miss(qx + dx, qy + dy);
    }
    if (!next) break;
    qx += dx;
    qy += dy;
    f = next;
    if (Math.hypot(dx, dy) <= tol) break;
  }
  // Accepted at 10·tol. It was 1e-9 of the scale, and at a lens's knife edge
  // that let a point no ray reaches pass as reached: the solve stalled against
  // the edge 3e-9 mm short and a rim corner was placed past the real one, its
  // landing 2e-11 off (§ 2z.3). Through the continuation a knife edge no longer
  // stalls it; what is left to refuse is a point even the continuation cannot
  // reach — past a sphere's silhouette, or into total internal reflection.
  if (Math.hypot(f[0], f[1]) > 10 * tol) {
    throw new UnreachableStopPoint(
      `rayAiming 'real': no launch reaches (${point.px.toFixed(3)}, ${point.py.toFixed(3)}) on the stop — best miss ${Math.hypot(f[0], f[1]).toExponential(2)} mm (§ 1.5.3)`,
      "aim",
    );
  }
  return reached(qx, qy, f);

  /** The solved launch — refused where its continuation crossed a surface behind itself on the way. */
  function reached(qx: number, qy: number, f: StopMiss): { qx: number; qy: number } {
    if (f[2] < 0) return { qx, qy };
    throw new UnreachableStopPoint(
      `rayAiming 'real': (${point.px.toFixed(3)}, ${point.py.toFixed(3)}) on the stop lies past a knife edge — the launch toward it crosses surface ${f[2]} behind itself (§ 2z.4)`,
      `miss@${f[2]}`,
      construct(qx, qy),
    );
  }
}

/**
 * A stop point no ray from this object point reaches, even with every rim
 * removed — the ray toward it leaves a surface's sphere first (§ 2z.1).
 *
 * It carries no light, so a bundle counts it lost, exactly as the paraxial aim's
 * ray toward the same region is traced and lost; what it must never be is a
 * reason to aim that point the paraxial way instead. Thrown by `aimRay` under
 * real aiming, and the one refusal a bundle may catch.
 */
export class UnreachableStopPoint extends Error {
  override readonly name = "UnreachableStopPoint";
  constructor(
    message: string,
    /**
     * What makes the edge there, in `traceRay`'s status@surface form: "miss@2"
     * where the continuation's launch crosses surface 2 behind itself — the
     * label the paraxial aim's ray past the same knife edge is lost with — and
     * "aim" where not even the continuation reaches the point.
     */
    readonly edge: string,
    /**
     * The continuation's launch, where it reached the point: a direction, not a
     * ray — tracing it does not reach the stop (§ 2z.4).
     */
    readonly launch?: Ray,
  ) {
    super(message);
  }
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
    if (system.rayAiming === "real" && system.conjugate.kind !== "finite") {
      // An object at infinity behind a pupil at infinity has no object point to
      // solve a slope from, and its launch plane has no pupil to aim through.
      // Refused rather than quietly aimed the old way. At a finite conjugate the
      // solve runs over the slope instead (§ 2z.1).
      throw new Error(
        "rayAiming 'real' is not defined for an entrance pupil at infinity with the object at infinity — no object-space cone to solve over (§ 1.5.3)",
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
