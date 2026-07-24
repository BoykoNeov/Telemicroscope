import { asCompiled, CompiledSystem } from "../trace/compile";
import { axialTwin } from "../trace/axis";
import { PlaneRay, paraxialRefract, paraxialTransfer } from "../trace/paraxial";
import { OpticalSystem, stopIndex } from "../trace/system";
import { resolveStopRadius } from "./pupils";

/**
 * Which physical aperture actually limits the axial beam — the aperture stop by
 * its real definition, not the one a prescription happens to flag with `isStop`.
 *
 * `pupils()` keys off the DECLARED stop (`stopIndex`): a designer's single
 * chosen surface. That is right for a well-declared instrument, but it is a
 * declaration, not a measurement — nothing forces the flagged surface to be the
 * one the marginal cone fills first. The moment two apertures compete for the
 * axial beam (a telescope's objective versus the observer's iris at the exit
 * pupil; a downstream rim smaller than the nominal stop) the *limiting* one is
 * the true stop, and the exit pupil, chief ray and OPD reference must move to
 * it. Selecting it is the capability visual mode is built on (VALIDATION § 5p).
 *
 * METHOD (textbook aperture-stop finding). Send one pseudo-marginal ray from
 * the axial object point through the whole chain and record its height at every
 * surface. The stop is the surface where the ray fills its clear aperture most —
 * `argmax |y_i| / semiAperture_i` — because scaling the ray scales every height
 * equally, so that argmax is independent of the (arbitrary) launch slope. The
 * declared stop competes as one more candidate at its ApertureSpec-resolved
 * radius `r0`, so a system whose flagged surface really is limiting selects
 * itself and nothing changes.
 *
 * Works on the `axialTwin`, exactly as `pupils()` does, so a folded chain is
 * measured along the straight axis its optics unfold onto.
 */

export interface LimitingStop {
  /** Index (into the axial-twin surface list) of the true aperture stop. */
  readonly index: number;
  /** Clear semi-diameter of that stop (mm) — its own rim, or `r0` if it is the declared stop. */
  readonly radius: number;
}

/**
 * Height of the pseudo-marginal ray at every surface vertex. The launch is
 * scaled so the ray fills the declared stop (`y = r0` at surface `k0`), which
 * makes the returned heights directly comparable to each `semiAperture`.
 */
function marginalHeights(
  c: CompiledSystem,
  system: OpticalSystem,
  wavelengthNm: number,
  k0: number,
  r0: number,
): number[] {
  const n0 = c.objectMedium.n(wavelengthNm);

  // A ray from the axial object point: parallel to the axis for an object at
  // infinity, diverging from the axis for a finite conjugate. Unit-scaled here;
  // rescaled to fill the declared stop once its height there is known.
  let st: PlaneRay =
    system.conjugate.kind === "finite"
      ? paraxialTransfer({ y: 0, u: 1, n: n0 }, system.conjugate.distance)
      : { y: 1, u: 0, n: n0 };

  const heights: number[] = [];
  for (let i = 0; i < c.surfaces.length; i++) {
    st = paraxialRefract(c, i, wavelengthNm, st);
    heights.push(st.y); // refraction preserves y, so this is the height AT surface i
    st = paraxialTransfer(st, c.surfaces[i]!.thickness);
  }

  const yAtStop = heights[k0]!;
  if (!(Math.abs(yAtStop) > 0)) {
    // The marginal ray crosses the axis at the declared stop (e.g. a field stop
    // at an internal image). Such a plane cannot BE the aperture stop; leave the
    // heights unscaled and let the finite-aperture argmax decide.
    return heights;
  }
  const scale = r0 / yAtStop;
  return heights.map((y) => y * scale);
}

export function limitingStop(system: OpticalSystem, wavelengthNm: number): LimitingStop {
  const c = axialTwin(asCompiled(system.prescription));
  const k0 = stopIndex(system.prescription);
  const r0 = resolveStopRadius(system, wavelengthNm);
  const heights = marginalHeights(c, system, wavelengthNm, k0, r0);

  // Fill fraction at every candidate aperture. The declared stop competes at
  // its ApertureSpec radius r0 (its physical rim may be larger); every other
  // surface competes at its own clear rim. The largest fill is the true stop.
  let bestIndex = k0;
  let bestFill = -Infinity;
  for (let i = 0; i < c.surfaces.length; i++) {
    const rim = i === k0 ? Math.min(c.surfaces[i]!.semiAperture, r0) : c.surfaces[i]!.semiAperture;
    if (!Number.isFinite(rim)) continue;
    const fill = Math.abs(heights[i]!) / rim;
    if (fill > bestFill) {
      bestFill = fill;
      bestIndex = i;
    }
  }

  const radius = bestIndex === k0 ? r0 : c.surfaces[bestIndex]!.semiAperture;
  return { index: bestIndex, radius };
}

/**
 * The stop index `pupils()` should actually use, given the system's aperture-stop
 * policy. Default (`undefined`) preserves the declared-stop behaviour every
 * existing rung is validated under; `"limiting"` selects the real limiting
 * aperture; `"surface"` pins a specific index.
 */
export function effectiveStopIndex(system: OpticalSystem, wavelengthNm: number): number {
  const policy = system.apertureStop;
  if (!policy || policy.kind === "declared") return stopIndex(system.prescription);
  if (policy.kind === "surface") return policy.index;
  return limitingStop(system, wavelengthNm).index;
}
