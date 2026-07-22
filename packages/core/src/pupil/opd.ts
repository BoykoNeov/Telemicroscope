import { Vec3, vec3, sub, dot, length } from "../math/vec3";
import { Ray } from "../trace/ray";
import { traceRay } from "../trace/sequential";
import { asCompiled } from "../trace/compile";
import { toImageSpace } from "../trace/axis";
import { OpticalSystem } from "../trace/system";
import { PupilGeometry, pupils, imagePlaneZ } from "./pupils";
import { PupilPoint, AimOptions, aimRay, chiefRay } from "./aiming";

/**
 * OPD — optical path difference at the exit pupil. This is the wave layer's
 * entire input, and it is NOT the raw accumulated OPL: that also contains the
 * reference geometry. Two conventions convert one into the other
 * (docs/ARCHITECTURE.md § Wavefront reference):
 *
 *  1. rays launched from an equal-phase surface (handled in `aimRay`), and
 *  2. path measured to a **reference sphere** centred on the image point with
 *     radius equal to the exit-pupil distance, differenced against the chief
 *     ray:  OPD = OPL_to_sphere(ray) − OPL_to_sphere(chief).
 *
 * Sign: positive OPD means the ray's path is LONGER than the chief ray's —
 * that part of the wavefront lags.
 *
 * COORDINATE. Rays are traced through the real prescription, folds included,
 * and their exit segments are then re-expressed in unfolded IMAGE-SPACE
 * coordinates (`toImageSpace`). Path length is invariant under that rigid map,
 * so the OPD is untouched by it; what the map buys is that the image plane and
 * the reference sphere can go on being described by one axial number. For an
 * axial system it is the identity and nothing here changes.
 */

export interface OpdSample extends PupilPoint {
  /** OPD in waves at the sample's wavelength. */
  readonly waves: number;
  /** Surviving energy fraction along this ray (Fresnel + coatings). */
  readonly throughput: number;
}

export interface OpdMap {
  readonly wavelengthNm: number;
  readonly fieldValue: number;
  /** Samples that made it through; vignetted/TIR/missed rays are dropped. */
  readonly samples: readonly OpdSample[];
  /** How many requested samples were lost to vignetting — this IS vignetting. */
  readonly lost: number;
  /** Chief-ray image point, in unfolded image-space coordinates. */
  readonly imagePoint: Vec3;
  readonly referenceRadius: number;
  readonly pupil: PupilGeometry;
  /** RMS OPD in waves about its own mean (piston removed). */
  readonly rmsWaves: number;
}

/**
 * Signed distance along a ray to the NEAREST crossing of the reference sphere.
 *
 * "Nearest", not "first forward" — and the difference is not cosmetic. The
 * sphere is centred on the image point and passes through the chief ray where
 * it crosses the exit-pupil plane. That plane is flat and the sphere is curved,
 * so the traced rays end up straddling it: some land just outside, some just
 * inside, by of order the sagitta. Off axis the sphere's centre also shifts
 * transversely, which pushes a whole side of the pupil inside it.
 *
 * For a point INSIDE the sphere the only forward crossing is the far one,
 * beyond the focus — a full sphere diameter away. Taking it adds ~2R of
 * spurious path (200 mm, or 3·10⁵ waves, on an f/5 system) to half the pupil.
 * The physically meaningful quantity is the signed path from the ray's endpoint
 * to the sphere, which is negative when the endpoint has already passed it.
 *
 * On axis every point lands outside and both readings agree, which is why the
 * symmetric rungs never saw this.
 */
function intersectSphere(o: Vec3, d: Vec3, centre: Vec3, radius: number): number | null {
  const oc = sub(o, centre);
  const b = 2 * dot(oc, d);
  const cc = dot(oc, oc) - radius * radius;
  const disc = b * b - 4 * cc; // a = 1 for a unit direction
  if (disc < 0) return null;
  const sq = Math.sqrt(disc);
  const t1 = (-b - sq) / 2;
  const t2 = (-b + sq) / 2;
  // A ray may start exactly ON the sphere — the chief ray does, whenever the
  // exit pupil coincides with the last surface. t = 0 is then the answer.
  return Math.abs(t1) <= Math.abs(t2) ? t1 : t2;
}

/** Where a ray meets the (flat) image plane. */
function atPlaneZ(r: Ray, z: number): Vec3 {
  const t = (z - r.origin.z) / r.dir.z;
  return vec3(r.origin.x + r.dir.x * t, r.origin.y + r.dir.y * t, z);
}

/** Total optical path from launch to the reference sphere, or null if lost. */
function pathToSphere(
  system: OpticalSystem,
  ray: Ray,
  centre: Vec3,
  radius: number,
  nImage: number,
): { opl: number; throughput: number } | null {
  const c = asCompiled(system.prescription);
  const res = traceRay(system.prescription, ray);
  if (res.status !== "ok" || !res.ray) return null;
  const exit = toImageSpace(c, res.ray);
  const t = intersectSphere(exit.origin, exit.dir, centre, radius);
  if (t === null) return null;
  return { opl: res.opl + Math.abs(nImage) * t, throughput: res.throughput };
}

export function opdMap(
  system: OpticalSystem,
  fieldValue: number,
  wavelengthNm: number,
  points: readonly PupilPoint[],
  options: AimOptions = {},
): OpdMap {
  const c = asCompiled(system.prescription);
  const pupil = pupils(system, wavelengthNm);
  const nImage = Math.abs(c.indices(wavelengthNm)[c.surfaces.length]!);

  // The chief ray defines both the image point and the reference sphere.
  const chief = chiefRay(system, pupil, fieldValue, wavelengthNm, options);
  const chiefTrace = traceRay(system.prescription, chief);
  if (chiefTrace.status !== "ok" || !chiefTrace.ray) {
    throw new Error(`chief ray failed (${chiefTrace.status}) at field ${fieldValue}`);
  }
  const chiefExit = toImageSpace(c, chiefTrace.ray);
  const imagePoint = atPlaneZ(chiefExit, imagePlaneZ(c, system));

  // Reference sphere: centred on the image point, passing through the chief
  // ray where it crosses the exit-pupil plane.
  const qz = Number.isFinite(pupil.exit.z) ? pupil.exit.z : imagePoint.z - 1;
  const q = atPlaneZ(chiefExit, qz);
  const referenceRadius = length(sub(imagePoint, q));

  const chiefPath = pathToSphere(system, chief, imagePoint, referenceRadius, nImage);
  if (!chiefPath) throw new Error("chief ray does not reach the reference sphere");

  const samples: OpdSample[] = [];
  let lost = 0;
  const mmToWaves = 1e6 / wavelengthNm;

  for (const p of points) {
    const ray = aimRay(system, pupil, fieldValue, p, wavelengthNm, options);
    const got = pathToSphere(system, ray, imagePoint, referenceRadius, nImage);
    if (!got) {
      lost++;
      continue;
    }
    samples.push({
      px: p.px,
      py: p.py,
      waves: (got.opl - chiefPath.opl) * mmToWaves,
      throughput: got.throughput,
    });
  }

  let mean = 0;
  for (const s of samples) mean += s.waves;
  mean = samples.length > 0 ? mean / samples.length : 0;
  let acc = 0;
  for (const s of samples) acc += (s.waves - mean) ** 2;
  const rmsWaves = samples.length > 0 ? Math.sqrt(acc / samples.length) : 0;

  return {
    wavelengthNm,
    fieldValue,
    samples,
    lost,
    imagePoint,
    referenceRadius,
    pupil,
    rmsWaves,
  };
}
