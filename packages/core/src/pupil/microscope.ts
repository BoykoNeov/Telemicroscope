import { asCompiled } from "../trace/compile";
import { toImageSpace } from "../trace/axis";
import { OpticalSystem } from "../trace/system";
import { traceRay } from "../trace/sequential";
import { getMedium } from "../materials/catalog";
import { chiefRay, marginalRay } from "./aiming";
import { imagePlaneZ, pupils } from "./pupils";

/**
 * Microscope readouts — numerical aperture, magnification, and the resolution
 * limit — all measured on the **traced** rays.
 *
 * The discipline is `imaging/exposure`'s: a readout that recomputes the formula
 * the design was built from pins nothing. NA is read as the sine of the angle at
 * which the marginal ray actually leaves the specimen, so it carries whatever
 * the real surfaces did to it; magnification is read as the image height a real
 * chief ray lands at, so it carries distortion the way `apparentFieldAngleRad`
 * does (§ 5n). Where those disagree with the nominal design values, the
 * disagreement is the finding.
 */

/** Direction cosine helper: the sine of a ray direction's tilt off the axis. */
const sinOffAxis = (dx: number, dy: number, dz: number): number =>
  Math.hypot(dx, dy) / Math.hypot(dx, dy, dz);

/**
 * Object-space numerical aperture n·sin u, from the marginal ray as it **leaves
 * the specimen**.
 *
 * This is the microscope's defining number — everything about resolution follows
 * from it — and it is an object-space quantity, so unlike `imageSpaceMarginalSin`
 * it is read at the ray's launch rather than after the chain. The index is the
 * object medium's at this wavelength, which is 1 for a dry objective and the
 * dispersive oil's once immersion lands: NA is where the immersion medium does
 * its work, not in the image space.
 *
 * Read from `aimRay`'s marginal ray, whose launch angle at the object point is
 * exact whatever the aim converges to downstream — the angle *is* the aim.
 */
export function objectNumericalAperture(system: OpticalSystem, wavelengthNm: number): number {
  if (system.conjugate.kind !== "finite") {
    throw new Error("objectNumericalAperture: needs a finite conjugate (there is no object-space cone at infinity)");
  }
  const pupil = pupils(system, wavelengthNm);
  const m = marginalRay(system, pupil, 0, wavelengthNm);
  const n = getMedium(system.prescription.objectMedium ?? "AIR").n(wavelengthNm);
  return n * sinOffAxis(m.dir.x, m.dir.y, m.dir.z);
}

/**
 * Image-space numerical aperture n′·sin u′, from the same ray after the chain.
 *
 * The pair (NA, NA′) is what the magnification has to satisfy: for an aplanatic
 * system the Abbe sine condition says n·y·sin u = n′·y′·sin u′, so with the
 * object and image heights in the ratio M the numerical apertures are in the
 * ratio 1/M. That relation is a *check*, not a construction — see
 * `sineConditionResidual`.
 */
export function imageNumericalAperture(system: OpticalSystem, wavelengthNm: number): number {
  const c = asCompiled(system.prescription);
  const pupil = pupils(system, wavelengthNm);
  const m = marginalRay(system, pupil, 0, wavelengthNm);
  const traced = traceRay(system.prescription, m);
  if (traced.status !== "ok" || !traced.ray) {
    throw new Error(`imageNumericalAperture: marginal ray failed (${traced.status})`);
  }
  const r = toImageSpace(c, traced.ray);
  const lastMedium = system.prescription.surfaces[system.prescription.surfaces.length - 1]!.medium;
  const n = getMedium(lastMedium ?? "AIR").n(wavelengthNm);
  return n * sinOffAxis(r.dir.x, r.dir.y, r.dir.z);
}

/**
 * Lateral magnification from the **traced chief ray**: the image height it
 * reaches at the image plane, over the object height it started from.
 *
 * Signed — a microscope's real image is inverted, so this is negative — and
 * measured at a stated object height, because a real ray's answer is only
 * independent of that height to the extent the system is distortion-free.
 * Shrinking the height toward zero recovers the paraxial value; keeping it
 * finite is how distortion becomes visible.
 */
export function lateralMagnification(
  system: OpticalSystem,
  objectHeightMm: number,
  wavelengthNm: number,
): number {
  if (system.conjugate.kind !== "finite") {
    throw new Error("lateralMagnification: needs a finite conjugate");
  }
  if (!(Math.abs(objectHeightMm) > 0)) {
    throw new Error("lateralMagnification: needs a non-zero object height");
  }
  const c = asCompiled(system.prescription);
  const pupil = pupils(system, wavelengthNm);
  const cr = chiefRay(system, pupil, objectHeightMm, wavelengthNm);
  const traced = traceRay(system.prescription, cr);
  if (traced.status !== "ok" || !traced.ray) {
    throw new Error(`lateralMagnification: chief ray failed (${traced.status})`);
  }
  const r = toImageSpace(c, traced.ray);
  const zImage = imagePlaneZ(c, system);
  const t = (zImage - r.origin.z) / r.dir.z;
  const height = r.origin.x + t * r.dir.x;
  return height / objectHeightMm;
}

/**
 * How far the system departs from the Abbe sine condition, as a relative
 * residual on n·y·sin u = n′·y′·sin u′.
 *
 * Zero means aplanatic: the same magnification is delivered at the pupil rim as
 * on the axis, which is exactly the condition for a system to be free of coma as
 * well as spherical aberration. Written as the ratio of the two invariants less
 * one, so it is dimensionless and signed.
 */
export function sineConditionResidual(
  system: OpticalSystem,
  objectHeightMm: number,
  wavelengthNm: number,
): number {
  const na = objectNumericalAperture(system, wavelengthNm);
  const naPrime = imageNumericalAperture(system, wavelengthNm);
  const m = lateralMagnification(system, objectHeightMm, wavelengthNm);
  // n·y·sin u = n′·y′·sin u′  ⇒  NA = |M|·NA′ for the same conjugate pair.
  return na / (Math.abs(m) * naPrime) - 1;
}

/**
 * Abbe's resolution limit: the smallest resolvable period of a self-luminous
 * (incoherent) specimen, d = λ/(2·NA).
 *
 * The external number the whole branch turns on, and the one the imaging layer
 * has to agree with independently: 1/d is the incoherent cutoff frequency of a
 * pupil of this numerical aperture, so the MTF computed from the traced
 * wavefront must run to zero there and not somewhere else.
 *
 * `wavelengthNm` is the **vacuum** wavelength; the medium enters through NA,
 * which already carries n, so no second index factor belongs here.
 */
export function abbeResolutionMm(wavelengthNm: number, numericalAperture: number): number {
  if (!(numericalAperture > 0)) throw new Error("abbeResolutionMm: NA must be positive");
  return (wavelengthNm * 1e-6) / (2 * numericalAperture);
}

/**
 * Rayleigh's criterion for the same pupil, 0.61·λ/NA — the radius of the Airy
 * disc referred to **object** space. Larger than Abbe's d by 1.22, because they
 * are answers to different questions (two point sources resolved, versus a
 * grating's finest transmitted period); both are reported so neither gets used
 * as if it were the other.
 */
export function rayleighResolutionMm(wavelengthNm: number, numericalAperture: number): number {
  if (!(numericalAperture > 0)) throw new Error("rayleighResolutionMm: NA must be positive");
  return (0.61 * wavelengthNm * 1e-6) / numericalAperture;
}
