import { asCompiled } from "../trace/compile";
import { toImageSpace } from "../trace/axis";
import { OpticalSystem } from "../trace/system";
import { traceRay } from "../trace/sequential";
import { marginalRay } from "../pupil/aiming";
import { pupils } from "../pupil/pupils";

/**
 * Camera mode, part 2: relative exposure.
 *
 * How bright the recorded frame is, up to one scalar. That scalar — the source's
 * absolute radiance in photons — is the magnitude → photon-flux zero point
 * VALIDATION § 3a records as **deliberately absent**: an unpinned photon count in
 * front of the user is worse than none, and the shot noise that rides on it needs
 * the same number. So everything here is a *ratio*: how illuminance changes with
 * focal ratio and aperture, which is exactly the part a photographer or an
 * astronomer reasons about (f-stops, light grasp) and the part that can be pinned
 * without the zero point.
 *
 * The one discipline that makes these validation rather than arithmetic: the
 * illuminance must **emerge from the trace**. Multiplying by a hand-written πD²/4
 * and then recovering D² pins nothing (D² == D²). So the image-space cone is read
 * from the *traced* marginal ray — every surface's power bends it — and the famous
 * 1/F² law is a *consequence* checked against that traced angle, not the formula
 * it is derived from.
 */

export interface CameraExposure {
  /** Integration time (s). */
  readonly seconds: number;
  /** Linear gain (ISO-like). Default 1. */
  readonly gain?: number;
}

/**
 * sin u′ of the image-space marginal cone, from the **traced** marginal ray.
 *
 * The rim ray of the on-axis bundle, traced through the whole chain; the tilt of
 * its exit direction away from the axis is sin u′ — the image-space numerical
 * aperture in air. Trace-emergent: it is 1/(2F) only to first order, and departs
 * by the sine condition, which is the whole reason to read it rather than compute
 * it.
 */
export function imageSpaceMarginalSin(system: OpticalSystem, wavelengthNm: number): number {
  const c = asCompiled(system.prescription);
  const pupil = pupils(system, wavelengthNm);
  const m = marginalRay(system, pupil, 0, wavelengthNm);
  const traced = traceRay(system.prescription, m);
  if (traced.status !== "ok" || !traced.ray) {
    throw new Error(`marginal ray failed (${traced.status})`);
  }
  const r = toImageSpace(c, traced.ray);
  const len = Math.hypot(r.dir.x, r.dir.y, r.dir.z);
  return Math.hypot(r.dir.x, r.dir.y) / len;
}

/**
 * Relative image-plane illuminance of an **extended** (resolved) source.
 *
 * Lambertian image irradiance is E = π·L·sin²u′; this returns the π·sin²u′
 * factor, with the source radiance L the deferred absolute. Because sin u′ is the
 * traced cone, this carries the exposure law E ∝ 1/F² as a *result* — a faster
 * system spreads the same scene over a smaller image and so lights each pixel
 * more, independent of aperture at fixed focal ratio.
 */
export function extendedSourceIlluminance(system: OpticalSystem, wavelengthNm: number): number {
  const s = imageSpaceMarginalSin(system, wavelengthNm);
  return Math.PI * s * s;
}

/**
 * Relative collected flux of a **point** source ∝ entrance-pupil area.
 *
 * From the traced entrance-pupil radius (`pupils`, the stop imaged through the
 * surfaces before it). A point source's whole image is the PSF, whose total
 * energy scales with the light grasp π·r² — light gathering ∝ D². Where the stop
 * is the front aperture this radius is the declared one, so this is a consistency
 * check on the light-grasp bookkeeping rather than an independent pin; the
 * validated, trace-emergent law is `extendedSourceIlluminance`'s 1/F².
 */
export function pointSourceCollection(system: OpticalSystem, wavelengthNm: number): number {
  const r = pupils(system, wavelengthNm).entrance.radius;
  return Math.PI * r * r;
}

/**
 * The linear scale a relative illuminance and an exposure combine to — the
 * number that multiplies the linear-light image before `toSrgbBytes` encodes it.
 * Illuminance × time × gain, so a stop of aperture and a doubling of time move it
 * the same way.
 */
export function exposureScale(illuminance: number, exposure: CameraExposure): number {
  return illuminance * exposure.seconds * (exposure.gain ?? 1);
}
