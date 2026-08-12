import { CompiledSystem, asCompiled } from "../trace/compile";
import { axialTwin } from "../trace/axis";
import {
  PlaneRay,
  paraxialRefract,
  paraxialUnrefract,
  paraxialTransfer,
  systemProperties,
} from "../trace/paraxial";
import { OpticalSystem, ApertureSpec, stopIndex } from "../trace/system";
import { limitingStop } from "./aperture-stop";

/**
 * Aperture stop → pupils. Until this module existed the `isStop` flag was
 * declared and never read, which meant nothing field- or aperture-dependent
 * could be computed at all: no chief ray, no ray aiming, no exit pupil, and
 * therefore no OPD (see docs/ARCHITECTURE.md § Wavefront reference).
 *
 * Definitions (standard):
 *  - The **entrance pupil** is the image of the stop formed by the surfaces
 *    that PRECEDE it — where the stop appears to be, seen from object space.
 *  - The **exit pupil** is the image of the stop formed by the surfaces that
 *    FOLLOW it — where it appears to be, seen from image space.
 *  - The stop surface's own power belongs to neither: the aperture is
 *    physically AT that surface.
 *
 * Both are found the same way. Send two paraxial rays from the stop plane
 * through the relevant surfaces: one through the stop centre (y = 0, u = 1)
 * whose axis crossing IS the pupil plane, and one at unit height (y = 1,
 * u = 0) whose height at that plane IS the magnification — because a plane
 * conjugate to the stop images stop height h to h·m regardless of slope.
 *
 * COORDINATE. Every `z` here is a position on the **unfolded axis**, and this
 * module normalizes to `axialTwin` so that a folded prescription is measured
 * along the same straight axis its optics unfold onto (see `trace/axis`). For
 * an axial system that is the world z, unchanged. For a folded one, object
 * space still coincides with the world — so ray aiming needs no map — while
 * image-space positions (the exit pupil, the image plane) are carried into the
 * world by `imageSpace`.
 */

export interface PupilPlane {
  /** Position on the unfolded axis (mm) — the world z of an axial system. */
  readonly z: number;
  /** Semi-diameter (mm). `Infinity` when the pupil is at infinity. */
  readonly radius: number;
  /** Transverse magnification of the stop into this pupil. */
  readonly magnification: number;
  /** Refractive index of the space the pupil lies in (signed, mirror convention). */
  readonly n: number;
  /**
   * Semi-aperture as a ray **slope** (tan u) — what a pupil at infinity has
   * instead of a radius, since a plane infinitely far away has no useful mm.
   *
   * INVARIANT, and the reason this is optional rather than always present:
   * `radius` finite XOR `slopeRadius` defined. A caller that has checked one
   * has decided the other, and never needs to check both.
   *
   * A pupil at infinity is a set of DIRECTIONS, so a normalized pupil
   * coordinate names a slope rather than a point. Paraxially a ray leaving
   * object height h with slope u reaches the stop at `y = A·h + B·u`; the pupil
   * is at infinity exactly when `A = 0`, and the rim is then `u = ±stopRadius/B`
   * **with no h in it** — which is why a telecentric aperture is field-
   * independent and why one number suffices here. Pinned at § 6u.
   *
   * `u` is the raw geometric slope in the OBJECT medium, which is what makes B
   * carry an index ratio when the object and the stop do not share one — see
   * the derivation in `imageStopBackward` and § 6z.7.
   */
  readonly slopeRadius?: number;
}

export interface PupilGeometry {
  readonly stopIndex: number;
  readonly stopRadius: number;
  readonly stopZ: number;
  readonly entrance: PupilPlane;
  readonly exit: PupilPlane;
}

/** Where the stop images through the surfaces AFTER it (exit pupil). */
function imageStopForward(
  c: CompiledSystem,
  k: number,
  wavelengthNm: number,
  stopRadius: number,
): PupilPlane {
  const n = c.indices(wavelengthNm);
  const nAfterStop = c.surfaces[k]!.kind === "reflect" ? -n[k]! : n[k + 1]!;
  const stopZ = c.surfaces[k]!.vertexZ;

  // Stop is the last surface: nothing images it, so the exit pupil is the stop.
  if (k >= c.surfaces.length - 1) {
    return { z: stopZ, radius: stopRadius, magnification: 1, n: nAfterStop };
  }

  let axis: PlaneRay = { y: 0, u: 1, n: nAfterStop };
  let height: PlaneRay = { y: 1, u: 0, n: nAfterStop };
  let z = stopZ;

  for (let i = k; i < c.surfaces.length - 1; i++) {
    const t = c.surfaces[i]!.thickness;
    axis = paraxialTransfer(axis, t);
    height = paraxialTransfer(height, t);
    z += t;
    axis = paraxialRefract(c, i + 1, wavelengthNm, axis);
    height = paraxialRefract(c, i + 1, wavelengthNm, height);
  }

  if (Math.abs(axis.u) < 1e-15) {
    // Stop imaged to infinity — telecentric in image space.
    return { z: Infinity, radius: Infinity, magnification: Infinity, n: axis.n };
  }
  const dz = -axis.y / axis.u;
  const m = height.y + height.u * dz;
  return { z: z + dz, radius: Math.abs(m) * stopRadius, magnification: m, n: axis.n };
}

/** Where the stop images through the surfaces BEFORE it (entrance pupil). */
function imageStopBackward(
  c: CompiledSystem,
  k: number,
  wavelengthNm: number,
  stopRadius: number,
): PupilPlane {
  const n = c.indices(wavelengthNm);
  const nBeforeStop = n[k]!;
  const stopZ = c.surfaces[k]!.vertexZ;

  // Stop is the first surface: nothing precedes it, so it IS the entrance pupil.
  if (k === 0) {
    return { z: stopZ, radius: stopRadius, magnification: 1, n: nBeforeStop };
  }

  let axis: PlaneRay = { y: 0, u: 1, n: nBeforeStop };
  let height: PlaneRay = { y: 1, u: 0, n: nBeforeStop };
  let z = stopZ;

  for (let i = k - 1; i >= 0; i--) {
    const t = c.surfaces[i]!.thickness;
    axis = paraxialTransfer(axis, -t);
    height = paraxialTransfer(height, -t);
    z -= t;
    axis = paraxialUnrefract(c, i, wavelengthNm, axis);
    height = paraxialUnrefract(c, i, wavelengthNm, height);
  }

  if (Math.abs(axis.u) < 1e-15) {
    // Object-space telecentric: the stop sits at the front group's back focal
    // plane, so the chief ray leaves every object point parallel to the axis.
    //
    // `axis` started {y: 0, u: 1} at the stop and was traced BACKWARDS, which
    // applies the inverse of the object→stop matrix [[A, B], [C, D]]; that
    // inverse carries (0, 1) to (−B, A)/det. So this branch's condition is
    // `A = 0` — telecentricity itself — and the height it exits with is
    // **−B/det**, one determinant away from the quantity the slope aperture
    // needs. No second trace, and therefore nothing that can drift from this
    // one.
    //
    // AND THE DETERMINANT IS NOT ALWAYS 1. `u` here is the raw geometric slope,
    // so a refraction contributes n_before/n_after and the object→stop matrix
    // has det = n_object/n_stop — unity exactly while the two spaces share an
    // index, which every telecentric system in this repo did until a specimen
    // was put under a coverslip (§ 6z.7). Left uncorrected the aperture comes
    // back n times too wide and the trace answers with a NUMBER: an objective
    // labelled NA 0.10 delivers 0.152 through a D263 slip, 52% fast, with no
    // ray lost to say so. Both indices are in hand here, and at n_object =
    // n_stop the arithmetic is `×1 / ×1` — bitwise the old expression, so no
    // system that ever worked moves.
    //
    // Measured in air: |axis.y| is the group's EFL bitwise, thick and
    // asymmetric included, because "stop at the back focal plane" is what makes
    // y = f·u.
    return {
      z: -Infinity,
      radius: Infinity,
      magnification: Infinity,
      n: axis.n,
      slopeRadius: Math.abs((stopRadius * nBeforeStop) / (axis.y * axis.n)),
    };
  }
  const dz = -axis.y / axis.u;
  const m = height.y + height.u * dz;
  return { z: z + dz, radius: Math.abs(m) * stopRadius, magnification: m, n: axis.n };
}

/**
 * `tan u` for a cone of numerical aperture NA in a medium of index n — the
 * factor an NA spelling multiplies its arm by.
 *
 * NA is Abbe's `n·sin u`, so `sin u = NA/n` and the *pupil* — a plane a finite
 * arm away — is filled to `arm·tan u`. Reading NA/n as the tangent itself is
 * the paraxial limit of this and disagrees by 1/√(1 − (NA/n)²): 0.50% at
 * NA 0.10, 15.5% at 0.50, 2.6× in oil at NA 1.4. Every design in `designs/`
 * hands its chain a `stopRadius` and sizes it with this same closed form
 * (`designs/microscope` writes it out longhand), so nothing built moved when
 * this replaced the slope reading — what it fixes is the *other four*
 * spellings meaning what the schema says they mean, which is reachable from the
 * bench editor's aperture selector. Pinned at § 1.5.1.
 *
 * `sin u = 1` is a cone that has closed onto the surface and `> 1` names rays
 * that do not exist, so both are refused rather than returned as ∞/NaN. That is
 * § 6l's ray-invariant ceiling arriving one layer up: an NA above the medium's
 * own index is not a wide aperture, it is no aperture.
 */
function marginalTangent(numericalAperture: number, n: number, spelling: string): number {
  const sinU = numericalAperture / n;
  if (!(Math.abs(sinU) < 1)) {
    throw new Error(
      `${spelling} ${numericalAperture} needs n·sin u with |sin u| = ${Math.abs(sinU).toFixed(4)} ` +
        `in a medium of index ${n.toFixed(4)}: no such ray exists`,
    );
  }
  return sinU / Math.sqrt(1 - sinU * sinU);
}

/**
 * Resolve an ApertureSpec into a stop radius. All five spellings constrain
 * the same thing; the pupil magnifications are what convert between them.
 * Magnification is independent of stop size, so a unit-radius probe suffices.
 */
export function resolveStopRadius(system: OpticalSystem, wavelengthNm: number): number {
  const spec: ApertureSpec = system.aperture;
  if (spec.kind === "stopRadius") return spec.value;

  const c = axialTwin(asCompiled(system.prescription));
  const k = stopIndex(system.prescription);
  const probeEntrance = imageStopBackward(c, k, wavelengthNm, 1);
  const mEP = Math.abs(probeEntrance.magnification);

  // An entrance pupil at infinity has no diameter and no arm, so three of the
  // five spellings have nothing to resolve against. Two of them were returning
  // arithmetic on ∞ rather than saying so: `EPD` and `fNumber` divide by an
  // infinite magnification and come back a silent **0** — an aperture that
  // closes the system — while `objectNA` multiplies an infinite arm by a finite
  // tangent and divides by an infinite magnification for a silent **NaN**.
  // A zero is the worse of the two, because it propagates as a number.
  //
  // `objectNA` is the spelling that survives, and it is the one a telecentric
  // microscope is actually engraved in: the aperture is an angle, so
  // `stopRadius = B·tan u` with B read off the same probe. See § 6u.
  const telecentric = probeEntrance.slopeRadius;
  if (telecentric !== undefined && (spec.kind === "EPD" || spec.kind === "fNumber")) {
    throw new Error(
      `${spec.kind} cannot size an entrance pupil at infinity (object-space telecentric): ` +
        `spell the aperture as objectNA, which is an angle`,
    );
  }

  switch (spec.kind) {
    case "EPD":
      return spec.value / 2 / mEP;
    case "fNumber": {
      const efl = systemProperties(system.prescription, wavelengthNm).efl;
      return Math.abs(efl / spec.value) / 2 / mEP;
    }
    case "objectNA": {
      if (system.conjugate.kind !== "finite") {
        throw new Error("objectNA requires a finite conjugate");
      }
      const nObj = c.indices(wavelengthNm)[0]!;
      const tanU = marginalTangent(spec.value, nObj, "objectNA");
      // Telecentric: the aperture is an angle and the object distance cancels,
      // which is the same statement as the chief ray being parallel to the axis.
      // The unit-radius probe reports 1/|B|, so this is B·tan u.
      if (telecentric !== undefined) return tanU / telecentric;
      // Otherwise the marginal ray runs from the axial object point to the
      // entrance-pupil edge over a finite arm.
      const objectZ = -system.conjugate.distance;
      const armLength = probeEntrance.z - objectZ;
      const epRadius = Math.abs(tanU * armLength);
      return epRadius / mEP;
    }
    case "imageNA": {
      const probeExit = imageStopForward(c, k, wavelengthNm, 1);
      const nImg = Math.abs(probeExit.n);
      const armLength = imagePlaneZ(c, system) - probeExit.z;
      const xpRadius = Math.abs(marginalTangent(spec.value, nImg, "imageNA") * armLength);
      return xpRadius / Math.abs(probeExit.magnification);
    }
  }
}

/**
 * Unfolded axial z of the image plane: the last vertex plus the image-surface
 * offset, both measured on the twin's axis. `imageSpace(c).toWorld` carries it
 * into the world when a folded system needs the plane placed rather than
 * measured along.
 */
export function imagePlaneZ(cIn: CompiledSystem, system: OpticalSystem): number {
  const c = axialTwin(cIn);
  const last = c.surfaces[c.surfaces.length - 1]!;
  const offset = system.imageSurface?.offsetFromLastVertex ?? last.thickness;
  return last.vertexZ + offset;
}

export function pupils(system: OpticalSystem, wavelengthNm: number): PupilGeometry {
  const c = axialTwin(asCompiled(system.prescription));

  // Which surface is the stop, and how wide. Default `declared` keeps the flagged
  // stop at its ApertureSpec radius (every existing rung); `limiting`/`surface`
  // move it to the real limiting aperture at that surface's own clear rim.
  const policy = system.apertureStop;
  let k: number;
  let stopRadius: number;
  if (!policy || policy.kind === "declared") {
    k = stopIndex(system.prescription);
    stopRadius = resolveStopRadius(system, wavelengthNm);
  } else if (policy.kind === "surface") {
    k = policy.index;
    stopRadius = c.surfaces[k]!.semiAperture;
  } else {
    const ls = limitingStop(system, wavelengthNm);
    k = ls.index;
    stopRadius = ls.radius;
  }

  return {
    stopIndex: k,
    stopRadius,
    stopZ: c.surfaces[k]!.vertexZ,
    entrance: imageStopBackward(c, k, wavelengthNm, stopRadius),
    exit: imageStopForward(c, k, wavelengthNm, stopRadius),
  };
}
