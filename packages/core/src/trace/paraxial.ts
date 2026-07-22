import { getMedium } from "../materials/catalog";
import { Prescription } from "./prescription";
import { CompiledSystem, asCompiled } from "./compile";

/**
 * Paraxial (first-order) engine: the y–u trace. This is both the validation
 * ground truth for the exact tracer in the small-angle limit and the
 * instant-feedback layer for the UI (EFL, BFD, magnification on every
 * slider tick).
 *
 * Conventions: real angles u = dy/dz; refraction n′u′ = nu − yφ with
 * φ = c(n′ − n); mirrors use n′ = −n (so φ = −2nc) with signed thicknesses.
 */

export interface ParaxialRayState {
  readonly y: number;
  readonly u: number;
}

/**
 * Paraxial state at a plane, carrying its own index so segments can be
 * composed in either direction (pupil imaging needs both). `n` is signed:
 * it goes negative after a mirror, per the n′ = −n convention.
 */
export interface PlaneRay {
  readonly y: number;
  readonly u: number;
  readonly n: number;
}

/** Refraction (or reflection) at compiled surface `i`. */
export function paraxialRefract(
  c: CompiledSystem,
  i: number,
  wavelengthNm: number,
  st: PlaneRay,
): PlaneRay {
  const s = c.surfaces[i]!;
  const n2 = s.kind === "reflect"
    ? -st.n
    : Math.sign(st.n) * s.mediumAfter!.n(wavelengthNm);
  const phi = s.geometry.curvature * (n2 - st.n);
  return { y: st.y, u: (st.n * st.u - st.y * phi) / n2, n: n2 };
}

/** Inverse of `paraxialRefract`: undo surface `i`, going backwards. */
export function paraxialUnrefract(
  c: CompiledSystem,
  i: number,
  wavelengthNm: number,
  st: PlaneRay,
): PlaneRay {
  const s = c.surfaces[i]!;
  // st.n is the index AFTER surface i; recover the index before it.
  const nBefore = s.kind === "reflect"
    ? -st.n
    : Math.sign(st.n) * c.indices(wavelengthNm)[i]!;
  const phi = s.geometry.curvature * (st.n - nBefore);
  return { y: st.y, u: (st.n * st.u + st.y * phi) / nBefore, n: nBefore };
}

/** Free propagation by a signed axial distance. */
export const paraxialTransfer = (st: PlaneRay, t: number): PlaneRay => ({
  y: st.y + st.u * t,
  u: st.u,
  n: st.n,
});

export function paraxialTrace(
  prescription: Prescription,
  wavelengthNm: number,
  start: ParaxialRayState,
): ParaxialRayState {
  let n = getMedium(prescription.objectMedium ?? "AIR").n(wavelengthNm);
  let { y, u } = start;

  for (const s of prescription.surfaces) {
    let n2: number;
    if (s.kind === "reflect") {
      n2 = -n;
    } else {
      if (!s.medium) throw new Error("refract surface needs a medium");
      n2 = Math.sign(n) * getMedium(s.medium).n(wavelengthNm);
    }
    const phi = s.curvature * (n2 - n);
    u = (n * u - y * phi) / n2;
    n = n2;
    y = y + u * s.thickness;
  }
  return { y, u };
}

export interface SystemProperties {
  /** Effective focal length (mm). */
  readonly efl: number;
  /** Back focal distance: last vertex → paraxial focus (mm, signed). */
  readonly bfd: number;
}

/**
 * First-order properties from a parallel input ray (object at infinity).
 * Note: paraxialTrace propagates past the last surface by its `thickness`,
 * so we rewind that here to measure from the last vertex.
 */
export function systemProperties(prescription: Prescription, wavelengthNm: number): SystemProperties {
  const y0 = 1;
  const out = paraxialTrace(prescription, wavelengthNm, { y: y0, u: 0 });
  if (Math.abs(out.u) < 1e-15) throw new Error("afocal system: no finite focus");
  const lastThickness = prescription.surfaces[prescription.surfaces.length - 1]!.thickness;
  const yAtLastVertex = out.y - out.u * lastThickness;
  return {
    efl: -y0 / out.u,
    bfd: -yAtLastVertex / out.u,
  };
}
