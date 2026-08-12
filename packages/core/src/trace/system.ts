import { Prescription, SurfaceSpec } from "./prescription";

/**
 * A `Prescription` is a surface list — enough to determine EFL and BFD, and
 * nothing else. Every field-, aperture-, or conjugate-dependent analysis
 * (spot, PSF, MTF, distortion, vignetting) needs the four specs below.
 *
 * See docs/ARCHITECTURE.md § Data model.
 */

/**
 * Five spellings of one constraint: how wide is the beam? The compiler
 * resolves whichever is given into a stop radius.
 *
 *  - `EPD`        entrance-pupil diameter (mm) — telescope-natural
 *  - `fNumber`    focal ratio, EFL/EPD — telescope-natural
 *  - `objectNA`   n·sin θ in object space — microscope-natural (finite conj.)
 *  - `imageNA`    n·sin θ in image space
 *  - `stopRadius` the stop semi-diameter itself (mm) — no resolution needed
 */
export type ApertureSpec =
  | { readonly kind: "EPD"; readonly value: number }
  | { readonly kind: "fNumber"; readonly value: number }
  | { readonly kind: "objectNA"; readonly value: number }
  | { readonly kind: "imageNA"; readonly value: number }
  | { readonly kind: "stopRadius"; readonly value: number };

/**
 * Infinite conjugate → field *angles* (degrees off axis).
 * Finite conjugate → object *heights* (mm from the axis).
 * Both branches need field; only the spelling differs.
 */
export type FieldSpec =
  | { readonly kind: "angle"; readonly values: readonly number[] }
  | { readonly kind: "objectHeight"; readonly values: readonly number[] };

/** Polychromatic is the normal case: a set with weights, not a single λ. */
export interface WavelengthSample {
  readonly nm: number;
  /** Source spectrum × detector response. Need not be normalized. */
  readonly weight: number;
}

/**
 * Object at infinity, or at a finite distance. The entire microscope branch
 * is finite-conjugate, so this is not optional.
 *
 * `distance` is the (positive) axial separation from the object plane to
 * surface 0's vertex, i.e. the object sits at z = −distance.
 */
export type ConjugateSpec =
  | { readonly kind: "infinite" }
  | { readonly kind: "finite"; readonly distance: number };

/**
 * How the aperture stop is chosen.
 *
 *  - `"declared"` (default, and what `undefined` means) — the surface flagged
 *    `isStop`, or surface 0. Every existing rung is validated under this, so it
 *    stays the default and nothing changes unless a system opts out.
 *  - `"limiting"` — the surface the axial marginal cone actually fills first
 *    (`pupil/aperture-stop`). This is what visual mode needs: when the eye's
 *    iris is smaller than the exit pupil it *becomes* the stop, and the exit
 *    pupil, chief ray and OPD reference move to it.
 *  - `"surface"` — pin a specific surface index, for tests and provenance.
 */
export type ApertureStopPolicy =
  | { readonly kind: "declared" }
  | { readonly kind: "limiting" }
  | { readonly kind: "surface"; readonly index: number };

/** Where the image is formed. Position is what a focus solve moves. */
export interface ImageSurfaceSpec {
  /**
   * Axial position of the image plane, as a signed offset from the last
   * surface's vertex (mm). Defaults to the last surface's `thickness`, i.e.
   * where the prescription itself says the image lands.
   */
  readonly offsetFromLastVertex?: number;
  /** Curvature of the image surface (1/mm). 0 = flat. */
  readonly curvature?: number;
}

export interface OpticalSystem {
  readonly prescription: Prescription;
  readonly aperture: ApertureSpec;
  readonly field: FieldSpec;
  readonly wavelengths: readonly WavelengthSample[];
  readonly conjugate: ConjugateSpec;
  readonly imageSurface?: ImageSurfaceSpec;
  /** How the aperture stop is chosen. Default `declared` (see `ApertureStopPolicy`). */
  readonly apertureStop?: ApertureStopPolicy;
  /** How a pupil coordinate is turned into a ray. Default `paraxial`. */
  readonly rayAiming?: RayAiming;
}

/**
 * Where a pupil coordinate is aimed AT (docs/VALIDATION.md § 1.5.3).
 *
 *  - `"paraxial"` (default) — at the first-order entrance pupil, which
 *    `pupils()` computes on the straight-axis twin. Exact for an aligned
 *    system, and the reference every rung below § 1.5.3 is written against.
 *  - `"real"` — at the aperture stop itself, found by tracing. The two differ
 *    only when the stop is not where the first-order layer thinks it is, which
 *    is exactly what a MISALIGNMENT does: a decenter or tilt upstream of the
 *    stop carries the stop with it, and the paraxial pupil does not follow.
 *
 * This is opt-in per system rather than inferred, for the same reason
 * `mirrorFrames` is: it changes what every pupil coordinate means, and a
 * misalignment appearing in the data must not silently redefine that.
 */
export type RayAiming = "paraxial" | "real";

/**
 * Index of the aperture stop. Falls back to surface 0 when the prescription
 * declares none — a single-element system's own rim *is* the stop, and
 * silently defaulting beats throwing on every toy prescription.
 */
export function stopIndex(p: Prescription): number {
  const declared = p.surfaces.findIndex((s: SurfaceSpec) => s.isStop === true);
  return declared >= 0 ? declared : 0;
}

/** The λ that analyses use when they need exactly one: the highest-weighted. */
export function primaryWavelength(system: OpticalSystem): number {
  if (system.wavelengths.length === 0) throw new Error("system has no wavelengths");
  let best = system.wavelengths[0]!;
  for (const w of system.wavelengths) if (w.weight > best.weight) best = w;
  return best.nm;
}

/** Convenience for the common "one wavelength, on axis, at infinity" case. */
export function simpleSystem(
  prescription: Prescription,
  aperture: ApertureSpec,
  wavelengthNm: number,
): OpticalSystem {
  return {
    prescription,
    aperture,
    field: { kind: "angle", values: [0] },
    wavelengths: [{ nm: wavelengthNm, weight: 1 }],
    conjugate: { kind: "infinite" },
  };
}
