import { getMedium } from "../materials/catalog";
import { Prescription, unfoldedTwin } from "./prescription";
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
  prescriptionIn: Prescription,
  wavelengthNm: number,
  start: ParaxialRayState,
): ParaxialRayState {
  // A folded chain has no single axis to run a y–u trace along; its unfolded
  // twin is the same optics straightened out, which is what this convention
  // was built for.
  const prescription = unfoldedTwin(prescriptionIn);
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
  /**
   * Effective focal length 1/Φ (mm) — the focal length a magnification, a plate
   * scale or an f-number is a ratio of. NOT the image-side focal distance, which
   * is n′ times longer once the image is in a medium (§ 2h).
   */
  readonly efl: number;
  /** Back focal distance: last vertex → paraxial focus (mm, signed). */
  readonly bfd: number;
}

/**
 * First-order properties from a parallel input ray (object at infinity).
 * Note: paraxialTrace propagates past the last surface by its `thickness`,
 * so we rewind that here to measure from the last vertex.
 *
 * ## The EFL is read off the REDUCED slope, and the BFD off the real one
 *
 * The parallel ray leaves at slope u′, and the power is what bends it:
 * n′·u′ = −y·Φ. So the EFL is −y/(n′·u′) and the back focal DISTANCE, which is a
 * length along the axis, is −y/u′. The two agree in air and nowhere else; until
 * § 2h this returned −y/u′ for both, which was the image-side focal distance
 * n′/Φ wearing the EFL's name, and every system it had ever been asked about
 * formed its image in air. § 2h's Cartesian back is the first that does not:
 * F = 200 mm read as 303.36 in N-BK7 and 324.01 in F2, and f_tube/f_obj then
 * claims a 152× and a 162× for an objective whose traced magnification is 100.
 *
 * |n′| rather than n′: after an odd count of mirrors the engine's index is
 * negative (n′ = −n), and the EFL's sign there is the convention every
 * reflecting rung is pinned to. In air |n′| is exactly 1 and the product is u′
 * to the bit, so no reading taken on an air image moves.
 */
export function systemProperties(prescriptionIn: Prescription, wavelengthNm: number): SystemProperties {
  const prescription = unfoldedTwin(prescriptionIn);
  const y0 = 1;
  const out = paraxialTrace(prescription, wavelengthNm, { y: y0, u: 0 });
  if (Math.abs(out.u) < 1e-15) throw new Error("afocal system: no finite focus");
  const lastThickness = prescription.surfaces[prescription.surfaces.length - 1]!.thickness;
  const yAtLastVertex = out.y - out.u * lastThickness;
  return {
    efl: -y0 / (imageSpaceIndex(prescription, wavelengthNm) * out.u),
    bfd: -yAtLastVertex / out.u,
  };
}

/**
 * |n′|, the image space's index: the medium after the last REFRACTING surface,
 * since a mirror returns the light into the medium it came from. A chain with
 * no refracting surface images in its object medium.
 */
function imageSpaceIndex(prescription: Prescription, wavelengthNm: number): number {
  for (let i = prescription.surfaces.length - 1; i >= 0; i--) {
    const s = prescription.surfaces[i]!;
    if (s.kind !== "reflect") return getMedium(s.medium!).n(wavelengthNm);
  }
  return getMedium(prescription.objectMedium ?? "AIR").n(wavelengthNm);
}
