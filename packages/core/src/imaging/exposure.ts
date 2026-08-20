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
 * energy scales with the light grasp π·r² — light gathering ∝ D².
 *
 * **The pupil need not be the declared aperture, and the rung that says so is
 * § 5s.6.** Where the stop is the front surface the two coincide and π·r² only
 * recovers what was typed in; § 5q's iris-limited telescope is the case where
 * they part, the eye's own pupil imaged back through eyepiece *and* objective
 * giving a 19.9937 mm entrance radius against a declared 50 mm, and the grasp
 * 6.25× below what the declared aperture would claim. That is the preset § 5s
 * said this rung was waiting for.
 *
 * **Two constructions have no answer here, and both refuse** (§ 5s.5). What
 * makes π·r² a flux is that a plane wave of irradiance E delivers E·πr² through
 * the pupil, so the pupil has to be an area a beam actually fills:
 *
 *  1. **A FINITE conjugate whose pupil is not the stop itself.** From a point
 *     source a finite distance away the collected flux is a SOLID ANGLE, and
 *     π·r² is proportional to it only while the arm r is measured over stays
 *     put. Behind preceding power it does not: on the default telecentric 4×
 *     objective the entrance radius runs 2 039.7 mm at 430 nm → 11 028.9 at the
 *     F line → 64 338.9 at 550 → ∞ at the d line it was designed on, thirteen
 *     orders of grasp across one visible spectrum, while the arm runs off with
 *     it and the *cone* stays ≈ 0.1005. Refusing only the ∞ would have caught
 *     one wavelength of that and passed the rest as finite numbers. The rim
 *     member, whose pupil IS its stop, reads 75.278387 mm² at every one of
 *     those wavelengths — flat — which is why the refusal is about the pupil's
 *     placement and not about the conjugate.
 *  2. **An entrance pupil at infinity**, at either conjugate. There is no area
 *     at all. `PupilPlane.slopeRadius` carries what the aperture is *instead*
 *     (an angle), on the invariant `radius` finite XOR `slopeRadius` defined —
 *     and an angle is not an area, so returning one for the other would be
 *     worse than the ∞ it replaced.
 *
 * Each refusal names the reading that does survive, and they are different
 * readings: the cone (`paraxialObjectNumericalAperture`) for the first, and for
 * the second — where the beam is collimated and an area is the right kind of
 * thing — the system re-read with `apertureStop: {kind: "limiting"}`, which
 * finds the aperture that actually limits it. **The second remedy is not
 * general**: it works when the declared stop is not the limiting one, and the
 * telecentric objective is exactly the case where `limitingStop` agrees with the
 * declared stop and there is nothing to escape to. § 5s.5 measures both.
 */
export function pointSourceCollection(system: OpticalSystem, wavelengthNm: number): number {
  const pupil = pupils(system, wavelengthNm);
  const entrance = pupil.entrance;
  const r = entrance.radius;
  // Checked first, so a telecentric objective gets the same sentence at every
  // wavelength rather than one sentence at the design line and a wrong number
  // beside it.
  if (system.conjugate.kind === "finite" && pupil.stopIndex !== 0) {
    throw new Error(
      `light grasp is an entrance-pupil AREA, and at a finite conjugate that is a collected flux ` +
        `only while the pupil is the stop itself: here the stop is surface ${pupil.stopIndex}, so ` +
        `preceding power images it to r = ${r.toPrecision(6)} mm over an arm that moved with it. ` +
        `From a point source a finite distance away the flux is a SOLID ANGLE — read the cone ` +
        `(paraxialObjectNumericalAperture), which is stop-placement free (§ 5s.5)`,
    );
  }
  if (!Number.isFinite(r)) {
    const slope = entrance.slopeRadius;
    throw new Error(
      "light grasp is an entrance-pupil AREA and this pupil is at infinity" +
        (slope === undefined ? "" : ` — the aperture is the slope tan u = ${slope.toFixed(6)}`) +
        ": an angle is not an area. Re-read the system with apertureStop: " +
        '{kind: "limiting"} to collect on the aperture that actually limits it (§ 5s.5)',
    );
  }
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
