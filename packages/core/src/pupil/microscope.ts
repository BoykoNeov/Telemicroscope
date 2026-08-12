import { asCompiled } from "../trace/compile";
import { toImageSpace } from "../trace/axis";
import { OpticalSystem } from "../trace/system";
import { traceRay } from "../trace/sequential";
import { paraxialTrace } from "../trace/paraxial";
import { getMedium } from "../materials/catalog";
import { chiefRay, marginalRay, type AimOptions } from "./aiming";
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
 * The **chief ray's own transverse invariant** in object space, n·sin θ, at
 * object height `objectHeightMm` — the number that decides how much of a plane
 * stack's aberration is coma rather than spherical (§ 6y).
 *
 * Signed by the ray's own x direction, so a field point at +h and one at −h give
 * opposite answers and the azimuth is the caller's to apply (`illuminationOffset`
 * has the same shape and for the same reason).
 *
 * ## Read off the aimer, not derived — § 6x.1's lesson, one quantity along
 *
 * The chief ray is the aim at pupil coordinate zero, so this is a *measurement*
 * of what the objective does with a field point, carrying whatever the real
 * surfaces did to it. Deriving it as `h/z_ep` instead would need the aimer's
 * parametrization to be trusted on two separate things — whether a pupil
 * coordinate is a tangent or a sine (§ 6q.5 got that wrong at a cost of 61%) and
 * the sign — and would not survive a system where those differ.
 *
 * ## Telecentricity makes it a bitwise zero, not a small number
 *
 * An entrance pupil at infinity sends `aimRay` down its object-space branch,
 * where the chief ray's slope is the literal `0` of § 6v.4. Both transverse
 * direction cosines are then exactly zero, so this returns `0` rather than a
 * rounding residual — which is what lets § 6y assert that a telecentric
 * objective's slab wavefront is the *same wavefront* at every field height,
 * bit for bit, instead of merely a close one.
 */
export function chiefRayInvariant(
  system: OpticalSystem,
  objectHeightMm: number,
  wavelengthNm: number,
  options: { readonly aim?: AimOptions } = {},
): number {
  if (system.conjugate.kind !== "finite") {
    throw new Error(
      "chiefRayInvariant: needs a finite conjugate (there is no object-space chief ray at infinity)",
    );
  }
  const pupil = pupils(system, wavelengthNm);
  const c = chiefRay(system, pupil, objectHeightMm, wavelengthNm, options.aim ?? {});
  const n = getMedium(system.prescription.objectMedium ?? "AIR").n(wavelengthNm);
  const sin = sinOffAxis(c.dir.x, c.dir.y, c.dir.z);
  return c.dir.x < 0 ? -n * sin : n * sin;
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

/**
 * The object-space NA the **paraxial pupil geometry** implies: n·u, with u the
 * entrance pupil's semi-diameter over its distance from the specimen.
 *
 * The partner to `objectNumericalAperture`, which reads n·**sin** u off the real
 * marginal ray, and the two are different numbers on purpose. The Lagrange
 * invariant — the law behind the exit-pupil size (§ 6q.5) — is a statement about
 * paraxial *slopes*, so it is this one the invariant is exact in; Abbe's sine
 * condition is a statement about sines, so it is the other one aplanatism is
 * about. Their ratio is the tangent-versus-sine gap § 6a's header already
 * names ("a stop of f·NA on the vertex would deliver NA 0.102, not 0.100"), and
 * at high aperture it is not a rounding error: 2% at NA 0.10 and a factor at
 * NA 1.40, which is § 6q.5's finding.
 */
export function paraxialObjectNumericalAperture(
  system: OpticalSystem,
  wavelengthNm: number,
): number {
  if (system.conjugate.kind !== "finite") {
    throw new Error("paraxialObjectNumericalAperture: needs a finite conjugate");
  }
  const pupil = pupils(system, wavelengthNm);
  const n = getMedium(system.prescription.objectMedium ?? "AIR").n(wavelengthNm);
  const arm = pupil.entrance.z + system.conjugate.distance;
  if (!(Math.abs(arm) > 0)) {
    throw new Error("paraxialObjectNumericalAperture: the entrance pupil lies on the specimen");
  }
  return (n * pupil.entrance.radius) / arm;
}

/**
 * **Visual** magnification: how much bigger the specimen looks through the
 * instrument than it would held at the near point, from the **traced chief
 * ray's** exit angle.
 *
 * A microscope with an eyepiece has no image to measure — the exit beam is
 * collimated — so its magnification is angular, not lateral, and
 * `lateralMagnification` cannot express it. What is measured instead is the
 * angle the chief ray leaves at, against the angle the same object height would
 * subtend at the near point:
 *
 *     M_visual = −θ_out / (h / D)
 *
 * **The minus is a convention and it is load-bearing**, so it is stated rather
 * than absorbed: a bundle *arriving* at the eye with slope θ came from a source
 * the observer must look toward at angular position −θ, and an object of height
 * h held at the near point sits at +h/D. Comparing the two apparent positions is
 * what "how much bigger does it look" means, and the sign that falls out is the
 * one every instrument agrees with — a simple magnifier reads **+D/f** (erect,
 * § 6q.4's control) and a compound microscope reads negative (inverted), which
 * is § 5l's Keplerian sign arriving on the other conjugate.
 *
 * This is a **real** ray's answer, taken at a stated object height like § 5n's
 * `apparentFieldAngleRad`, so it carries the distortion a paraxial route drops —
 * which is what makes M_obj·(D/f_e) a rung (§ 6q.4) rather than a definition.
 *
 * @param nearPointMm the convention the magnification is quoted against; the
 * answer is a ratio against whatever is passed in (`NEAR_POINT_MM` is 250).
 */
export function visualMagnification(
  system: OpticalSystem,
  objectHeightMm: number,
  wavelengthNm: number,
  nearPointMm: number,
): number {
  if (system.conjugate.kind !== "finite") {
    throw new Error("visualMagnification: needs a finite conjugate");
  }
  if (!(Math.abs(objectHeightMm) > 0)) {
    throw new Error("visualMagnification: needs a non-zero object height");
  }
  if (!(nearPointMm > 0)) throw new Error("visualMagnification: the near point must be positive");
  const pupil = pupils(system, wavelengthNm);
  const cr = chiefRay(system, pupil, objectHeightMm, wavelengthNm);
  const traced = traceRay(system.prescription, cr);
  if (traced.status !== "ok" || !traced.ray) {
    throw new Error(
      `visualMagnification: chief ray ${traced.status} at ${objectHeightMm} mm — object height beyond the field stop?`,
    );
  }
  const d = traced.ray.dir;
  const thetaOut = Math.atan2(d.x, d.z);
  return -thetaOut / (objectHeightMm / nearPointMm);
}

/**
 * The vergence (diopters) the exit beam leaves with — zero when the instrument
 * is collimated for a relaxed eye, and the currency the § 6q.3 negative control
 * is measured in.
 *
 * A residual output slope is meaningless on its own ("1e-3 of what?"). What
 * decides whether it matters is the accommodation it demands of the observer:
 * an axial ray leaving at height y and slope u crosses the axis at L = −y/u mm,
 * and 1000/L is the diopters. A quarter of a diopter is the usual threshold of
 * noticing; a relaxed eye can supply none at all.
 *
 * **Signed, and the sign is the whole diagnosis.** Positive means the beam
 * CONVERGES to a real point L mm past the last surface — light an eye cannot use
 * at any accommodation, because accommodation only ever adds positive power.
 * Negative means it diverges from a virtual point behind the instrument, which
 * is what a near-focused eyepiece delivers and what a young eye can pull in.
 * Zero is collimated, the relaxed-eye condition every eyepiece is placed for.
 * § 6q.3's misplaced eyepiece is +70.5 D — the unusable side.
 */
export function exitVergenceDiopters(
  system: OpticalSystem,
  wavelengthNm: number,
  marginalHeightMm: number,
): number {
  if (system.conjugate.kind !== "finite") {
    throw new Error("exitVergenceDiopters: needs a finite conjugate");
  }
  if (!(Math.abs(marginalHeightMm) > 0)) {
    throw new Error("exitVergenceDiopters: needs a non-zero probe height");
  }
  // A paraxial ray from the axial specimen point reaching surface 0 at the stop
  // rim: height IS that rim, slope is the rim over the object distance.
  const r = paraxialTrace(system.prescription, wavelengthNm, {
    y: marginalHeightMm,
    u: marginalHeightMm / system.conjugate.distance,
  });
  if (!(Math.abs(r.y) > 0)) return Infinity;
  // L = −y/u is where it crosses the axis, in mm; 1000/L converts to diopters.
  return (-1000 * r.u) / r.y;
}

/**
 * The exit pupil the **Lagrange invariant** predicts: r = D·NA/|M_visual|.
 *
 * The microscope's counterpart to § 5l's exit pupil = EPD/|M|, and the same kind
 * of statement — a conservation law, not a fit. With the chief ray crossing the
 * axis at the exit pupil and the marginal ray at the object, H = h·NA on the
 * object side and −r_xp·θ_out on the exit side, so h·NA = −r_xp·θ_out; dividing
 * by the visual magnification's own definition θ_out = M·h/D leaves
 *
 *     r_xp = D·NA / |M_visual|
 *
 * — the textbook "exit pupil = 500·NA/M mm" with the 500 shown to be 2·250 and
 * nothing else. It is a **paraxial** invariant, so the NA it holds for is
 * `paraxialObjectNumericalAperture`'s; feeding it the traced sine NA is how
 * § 6q.5 measures what the sine-versus-tangent gap is worth.
 */
export function lagrangeExitPupilRadiusMm(
  numericalAperture: number,
  nearPointMm: number,
  visualMagnification: number,
): number {
  if (!(Math.abs(visualMagnification) > 0)) {
    throw new Error("lagrangeExitPupilRadiusMm: needs a non-zero magnification");
  }
  return (nearPointMm * numericalAperture) / Math.abs(visualMagnification);
}

/**
 * **Empty magnification, as a ratio rather than as a rule.** The finest detail
 * the objective delivers, measured in units of the finest the observer's own
 * working pupil can carry:
 *
 *     ratio = |M_visual| · p / (2 · NA · D)
 *
 * where p is whichever pupil actually limits the beam entering the eye — the
 * instrument's exit pupil, or the iris when the iris is narrower (§ 5p's
 * two-stop competition, which is what gives this its crossover).
 *
 * Below 1 the eye is the bottleneck and more magnification buys real resolution.
 * At 1 the two limits meet. **Above the crossover the ratio does not move at
 * all** — because there p *is* the exit pupil, which is D·NA/|M| by the Lagrange
 * invariant above, and the M cancels identically. That exact independence is
 * what "the image gets bigger without getting better" means, and it is a
 * stronger statement than the 500·NA–1000·NA rule it explains: magnification
 * past the crossover cannot change whether the eye resolves what the objective
 * transmits, at any M, to f64.
 *
 * **λ cancels**, which is worth saying out loud: both limits scale with
 * wavelength — Abbe's λ/(2·NA) and the eye pupil's λ/p — so where magnification
 * stops paying is a property of the geometry alone. The convention is Abbe's
 * period against the pupil's own cutoff period; Rayleigh's criterion would put
 * the crossover at 1.22 instead of 1, which changes the number and not the
 * independence.
 */
export function visualDetailRatio(
  visualMagnification: number,
  numericalAperture: number,
  nearPointMm: number,
  workingPupilDiameterMm: number,
): number {
  if (!(numericalAperture > 0)) throw new Error("visualDetailRatio: NA must be positive");
  if (!(nearPointMm > 0)) throw new Error("visualDetailRatio: the near point must be positive");
  if (!(workingPupilDiameterMm > 0)) {
    throw new Error("visualDetailRatio: the working pupil must be positive");
  }
  return (
    (Math.abs(visualMagnification) * workingPupilDiameterMm) / (2 * numericalAperture * nearPointMm)
  );
}

/**
 * The magnifications worth using, as the exit pupils they correspond to — the
 * textbook 500·NA to 1000·NA, produced from the Lagrange invariant and two
 * stated eye-pupil conventions rather than quoted.
 *
 * Invert r_xp = D·NA/|M|: an exit pupil of p millimetres is M = 2·D·NA/p. So the
 * *largest* useful pupil gives the smallest useful magnification and vice versa,
 * and with D = 250 the classic pair falls out of p = 1 mm and p = 0.5 mm exactly.
 * Both conventions are `designs/visual-microscope`'s named constants; the digits
 * 500 and 1000 appear nowhere in the engine.
 */
export function usefulMagnificationRange(
  numericalAperture: number,
  nearPointMm: number,
  minExitPupilMm: number,
  maxExitPupilMm: number,
): { readonly min: number; readonly max: number } {
  if (!(numericalAperture > 0)) throw new Error("usefulMagnificationRange: NA must be positive");
  if (!(minExitPupilMm > 0) || !(maxExitPupilMm >= minExitPupilMm)) {
    throw new Error("usefulMagnificationRange: need 0 < minExitPupil ≤ maxExitPupil");
  }
  return {
    min: (2 * nearPointMm * numericalAperture) / maxExitPupilMm,
    max: (2 * nearPointMm * numericalAperture) / minExitPupilMm,
  };
}
