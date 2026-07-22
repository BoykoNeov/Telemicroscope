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
  /** Semi-diameter (mm). */
  readonly radius: number;
  /** Transverse magnification of the stop into this pupil. */
  readonly magnification: number;
  /** Refractive index of the space the pupil lies in (signed, mirror convention). */
  readonly n: number;
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
    return { z: -Infinity, radius: Infinity, magnification: Infinity, n: axis.n };
  }
  const dz = -axis.y / axis.u;
  const m = height.y + height.u * dz;
  return { z: z + dz, radius: Math.abs(m) * stopRadius, magnification: m, n: axis.n };
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
      // Marginal ray from the axial object point to the entrance-pupil edge.
      const nObj = c.indices(wavelengthNm)[0]!;
      const objectZ = -system.conjugate.distance;
      const armLength = probeEntrance.z - objectZ;
      const epRadius = Math.abs((spec.value / nObj) * armLength);
      return epRadius / mEP;
    }
    case "imageNA": {
      const probeExit = imageStopForward(c, k, wavelengthNm, 1);
      const nImg = Math.abs(probeExit.n);
      const armLength = imagePlaneZ(c, system) - probeExit.z;
      const xpRadius = Math.abs((spec.value / nImg) * armLength);
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
  const k = stopIndex(system.prescription);
  const stopRadius = resolveStopRadius(system, wavelengthNm);
  return {
    stopIndex: k,
    stopRadius,
    stopZ: c.surfaces[k]!.vertexZ,
    entrance: imageStopBackward(c, k, wavelengthNm, stopRadius),
    exit: imageStopForward(c, k, wavelengthNm, stopRadius),
  };
}
