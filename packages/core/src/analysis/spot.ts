import { Ray } from "../trace/ray";
import { traceRay } from "../trace/sequential";
import { asCompiled } from "../trace/compile";
import { toImageSpace } from "../trace/axis";
import { OpticalSystem } from "../trace/system";
import { PupilGeometry, pupils, imagePlaneZ } from "../pupil/pupils";
import { PupilPoint, AimOptions, aimRay } from "../pupil/aiming";

/**
 * Spot diagrams — where a pupil-full of rays actually lands. This is the
 * geometric half of image quality (the wave half is `pupil/opd`), and it is
 * also the machinery the min-RMS-spot focus criterion runs on.
 *
 * The one structural idea here: trace ONCE, evaluate at MANY planes. Every ray
 * leaving the last surface is a straight line, so its transverse position is
 * linear in z and the mean-square spot radius is therefore an exact quadratic
 * in z. Best focus by the spot criterion is a closed form, not a search — see
 * `bestSpotZ`.
 */

/**
 * A ray that survived the system, tagged with the pupil point it came from.
 *
 * The ray is in unfolded IMAGE-SPACE coordinates, not world: the whole module
 * evaluates transverse position as a function of an axial z, and on a folded
 * chain the world exit beam can run along +y, where that form divides by zero.
 * The map is rigid, so spot sizes are unaffected by it, and it is the identity
 * for an axial system (`trace/axis`).
 */
export interface ExitRay extends PupilPoint {
  readonly ray: Ray;
  readonly throughput: number;
}

export interface ExitBundle {
  readonly rays: readonly ExitRay[];
  /** Requested rays lost to vignetting/TIR/miss — this IS vignetting. */
  readonly lost: number;
  readonly pupil: PupilGeometry;
  readonly wavelengthNm: number;
  readonly fieldValue: number;
}

/** Aim a pupil-full of rays and keep the ones that make it out. */
export function exitBundle(
  system: OpticalSystem,
  fieldValue: number,
  wavelengthNm: number,
  points: readonly PupilPoint[],
  options: AimOptions = {},
): ExitBundle {
  const c = asCompiled(system.prescription);
  const pupil = pupils(system, wavelengthNm);
  const rays: ExitRay[] = [];
  let lost = 0;

  for (const p of points) {
    const input = aimRay(system, pupil, fieldValue, p, wavelengthNm, options);
    const res = traceRay(system.prescription, input);
    if (res.status !== "ok" || !res.ray) {
      lost++;
      continue;
    }
    rays.push({ px: p.px, py: p.py, ray: toImageSpace(c, res.ray), throughput: res.throughput });
  }

  return { rays, lost, pupil, wavelengthNm, fieldValue };
}

export interface SpotPoint extends PupilPoint {
  readonly x: number;
  readonly y: number;
  readonly throughput: number;
}

export interface Spot {
  /** World z of the plane the spot was evaluated on. */
  readonly z: number;
  readonly points: readonly SpotPoint[];
  readonly centroidX: number;
  readonly centroidY: number;
  /** RMS distance from the centroid (mm). Unweighted — see the note below. */
  readonly rmsRadius: number;
  /** Largest distance from the centroid (mm) — the geometric spot radius. */
  readonly geoRadius: number;
  readonly lost: number;
  readonly wavelengthNm: number;
  readonly fieldValue: number;
}

/**
 * The spot on a flat plane at world z.
 *
 * RMS is taken about the centroid and is UNWEIGHTED by throughput: the
 * standard RMS spot radius counts rays, not energy. Per-ray throughput rides
 * along on each point so an energy-weighted readout stays available without
 * this function silently choosing a different convention.
 */
export function spotAt(bundle: ExitBundle, z: number): Spot {
  const points: SpotPoint[] = [];
  for (const r of bundle.rays) {
    const o = r.ray.origin;
    const d = r.ray.dir;
    const t = (z - o.z) / d.z;
    points.push({
      px: r.px,
      py: r.py,
      x: o.x + d.x * t,
      y: o.y + d.y * t,
      throughput: r.throughput,
    });
  }

  let cx = 0;
  let cy = 0;
  for (const p of points) {
    cx += p.x;
    cy += p.y;
  }
  if (points.length > 0) {
    cx /= points.length;
    cy /= points.length;
  }

  let acc = 0;
  let worst = 0;
  for (const p of points) {
    const r2 = (p.x - cx) ** 2 + (p.y - cy) ** 2;
    acc += r2;
    if (r2 > worst) worst = r2;
  }

  return {
    z,
    points,
    centroidX: cx,
    centroidY: cy,
    rmsRadius: points.length > 0 ? Math.sqrt(acc / points.length) : 0,
    geoRadius: Math.sqrt(worst),
    lost: bundle.lost,
    wavelengthNm: bundle.wavelengthNm,
    fieldValue: bundle.fieldValue,
  };
}

/** Convenience: trace and evaluate on the system's own image plane. */
export function spotDiagram(
  system: OpticalSystem,
  fieldValue: number,
  wavelengthNm: number,
  points: readonly PupilPoint[],
  options: AimOptions = {},
): Spot {
  const bundle = exitBundle(system, fieldValue, wavelengthNm, points, options);
  return spotAt(bundle, imagePlaneZ(asCompiled(system.prescription), system));
}

/**
 * The plane of minimum RMS spot radius — in closed form.
 *
 * Write each exit ray's transverse position about a reference plane z₀ as
 * u + b·s, with s = z − z₀ and b = dx/dz. Centring on the (itself moving)
 * centroid gives
 *     ⟨r²⟩(s) = S_uu + 2·S_ub·s + S_bb·s²
 * a parabola, minimised at s = −S_ub / S_bb. No iteration, no bracket, and no
 * dependence on where the image plane currently sits.
 *
 * Works for beams travelling either direction: b is a ratio of components, so
 * a mirror's −z bundle needs no special case.
 */
export function bestSpotZ(bundle: ExitBundle): number {
  const rays = bundle.rays;
  if (rays.length < 2) {
    throw new Error("best-spot focus needs at least two surviving rays");
  }

  let z0 = 0;
  for (const r of rays) z0 += r.ray.origin.z;
  z0 /= rays.length;

  const n = rays.length;
  const ux = new Float64Array(n);
  const uy = new Float64Array(n);
  const bx = new Float64Array(n);
  const by = new Float64Array(n);

  for (let i = 0; i < n; i++) {
    const { origin: o, dir: d } = rays[i]!.ray;
    if (Math.abs(d.z) < 1e-15) {
      throw new Error("exit ray travels perpendicular to the axis: no focal plane");
    }
    const mx = d.x / d.z;
    const my = d.y / d.z;
    bx[i] = mx;
    by[i] = my;
    ux[i] = o.x + mx * (z0 - o.z);
    uy[i] = o.y + my * (z0 - o.z);
  }

  const mean = (a: Float64Array): number => {
    let s = 0;
    for (let i = 0; i < a.length; i++) s += a[i]!;
    return s / a.length;
  };
  const mux = mean(ux);
  const muy = mean(uy);
  const mbx = mean(bx);
  const mby = mean(by);

  let sub = 0;
  let sbb = 0;
  for (let i = 0; i < n; i++) {
    const du = ux[i]! - mux;
    const db = bx[i]! - mbx;
    const dv = uy[i]! - muy;
    const dc = by[i]! - mby;
    sub += du * db + dv * dc;
    sbb += db * db + dc * dc;
  }

  // A perfectly collimated bundle has no focus; report the reference plane
  // rather than dividing by zero.
  if (sbb <= 0) return z0;
  return z0 - sub / sbb;
}
