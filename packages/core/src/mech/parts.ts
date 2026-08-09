import { MechPart } from "./path";
import { FLANGE_FOCAL_DISTANCE_MM } from "./standards";

/**
 * # The parts a real imaging train is made of
 *
 * Constructors rather than a catalogue, because the numbers that matter here are
 * per-product and a fixed table would go stale while pretending not to. What is
 * fixed is the *shape*: a part occupies light path and may contain glass, and
 * these say which is which for the four kinds that actually appear.
 *
 * The dimensions in the defaults are representative of commercial parts and are
 * **not** transcribed from a datasheet — they are there so a caller can build a
 * plausible train in one line, and every rung in docs/VALIDATION.md § 5u passes
 * its own numbers explicitly rather than leaning on a default.
 */

/**
 * A prism star diagonal: a folded light path with a block of glass in it.
 *
 * The one part where the mechanical length and the optical cost differ most, and
 * the reason this layer exists. Roughly a third of the prism's glass path is
 * handed back as focus travel (t(1−1/n) = 0.34·t for N-BK7), so a prism diagonal
 * needs measurably less back focus than a mirror one of the same length.
 */
export function prismDiagonal(spec: {
  readonly name?: string;
  /** Entry face → exit face along the folded path (mm). */
  readonly pathLengthMm: number;
  /** Glass path through the prism (mm). */
  readonly prismThicknessMm: number;
  readonly medium?: string;
}): MechPart {
  return {
    name: spec.name ?? "prism diagonal",
    pathLengthMm: spec.pathLengthMm,
    glass: [{ thicknessMm: spec.prismThicknessMm, medium: spec.medium ?? "N-BK7" }],
  };
}

/**
 * A mirror star diagonal: the same fold, no glass.
 *
 * Its whole content is the *absence* of a glass layer, which is why it is a
 * constructor and not a comment: the budget then charges it its full length with
 * nothing handed back, and the "a mirror diagonal needs more back focus" folk
 * result falls out of the arithmetic instead of being asserted.
 */
export function mirrorDiagonal(spec: {
  readonly name?: string;
  readonly pathLengthMm: number;
}): MechPart {
  return { name: spec.name ?? "mirror diagonal", pathLengthMm: spec.pathLengthMm };
}

/**
 * A filter in the converging beam — the part whose whole light path is glass.
 *
 * A filter cell is longer than its glass, but the *light* only crosses the
 * glass, so `pathLengthMm` is the substrate thickness. Its cost goes as the
 * fourth power of the numerical aperture it sits in, which is why the same
 * filter is invisible at f/10 and is not at f/2 (§ 5u).
 */
export function filter(spec: {
  readonly name?: string;
  /** Substrate thickness (mm). */
  readonly thicknessMm: number;
  readonly medium?: string;
}): MechPart {
  return {
    name: spec.name ?? "filter",
    pathLengthMm: spec.thicknessMm,
    glass: [{ thicknessMm: spec.thicknessMm, medium: spec.medium ?? "N-BK7" }],
  };
}

/** An extension tube, spacer or adapter: length, no glass. */
export function spacer(lengthMm: number, name = "spacer"): MechPart {
  return { name, pathLengthMm: lengthMm };
}

/**
 * A camera body, as the light path sees it: its flange focal distance, and no
 * glass.
 *
 * The sensor's cover window and any filter stack in front of it *are* glass in
 * the converging beam and do shift focus — a real and much-discussed effect on
 * fast astrographs. It is deliberately not folded into this default, because the
 * thickness is per-body and inventing one would put a number into a budget that
 * nobody can check. Pass a `filter()` part alongside when it is known.
 */
export function cameraBody(spec: {
  readonly name?: string;
  /** Flange focal distance (mm) — one of `FLANGE_FOCAL_DISTANCE_MM`. */
  readonly flangeFocalDistanceMm: number;
}): MechPart {
  return {
    name: spec.name ?? "camera body",
    pathLengthMm: spec.flangeFocalDistanceMm,
  };
}

/** A T-threaded camera train's own convention: 55 mm from the T-thread face. */
export const t2Camera = (name = "T2 camera train"): MechPart =>
  cameraBody({ name, flangeFocalDistanceMm: FLANGE_FOCAL_DISTANCE_MM.t2 });
