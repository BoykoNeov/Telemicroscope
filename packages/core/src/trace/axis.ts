import { vec3 } from "../math/vec3";
import {
  Mat3,
  MAT3_IDENTITY,
  Transform,
  IDENTITY,
  applyToDirection,
  applyToPoint,
  compose,
  invert,
  translation,
} from "../math/transform";
import { Ray } from "./ray";
import { CompiledSystem, compile } from "./compile";
import { unfoldedTwin } from "./prescription";

/**
 * The unfolded axis, and the map from it back to the world.
 *
 * Every first-order quantity in this engine — pupil planes, the image plane,
 * best focus, the reference sphere — is a position on ONE straight axis. That
 * axis is the `"unfolded"` convention's: light starts along +z, a mirror keeps
 * the chain pointing where it was and turns the following thicknesses negative.
 * On a `"folded"` chain the same coordinate stops following the light at the
 * first mirror, which is why everything built on it used to refuse a folded
 * system outright.
 *
 * The fix is not to teach the paraxial layer about folds. It is to notice that
 * a folded prescription and its `unfoldedTwin` are the same optics related by a
 * RIGID MOTION — the composition of one reflection per mirror — and a rigid
 * motion preserves every optical path length and every transverse distance. So:
 *
 *  - first-order geometry is computed on the twin (`axialTwin`), where the
 *    already-validated code runs unchanged;
 *  - exact rays are traced through the real folded prescription, because that
 *    is where the tilted diagonal and its clear aperture actually are;
 *  - the two meet through `spaceToWorld`, the rigid map that carries unfolded
 *    axial coordinates in one space into the world.
 *
 * **Spaces.** Space *k* is the medium the light crosses on its way INTO surface
 * *k*: space 0 is object space, space *N* is image space. Each has its own map,
 * because each mirror adds another reflection to the composition.
 *
 * Two properties are worth stating because they are what make this cheap:
 *
 *  - **Object space is always the world +z axis.** The chain starts at the
 *    identity and surface 0's own tilt belongs to the surface, not to the
 *    incoming chain. So ray aiming, the entrance pupil, and the launch plane
 *    need no map at all — only the exit side does.
 *  - **The map is the identity whenever no mirror is tilted**, which is exactly
 *    the case where the two conventions describe the same physical layout. Every
 *    axial system therefore pays nothing and cannot move.
 *
 * SCOPE. `unfoldedTwin` drops tilt and decenter, so the twin is a faithful
 * straightening only when the tilts belong to FLAT fold mirrors. Tilt a curved
 * surface (a misalignment) and the twin becomes the nominal system: rays are
 * still traced exactly, but the pupil planes and the image plane they are
 * measured against are the nominal ones — which is what tolerancing wants, and
 * is the same first-order treatment tilted systems already get.
 */

/** Reflection of the axial coordinate itself: what an odd mirror count costs. */
const Z_FLIP: Mat3 = [1, 0, 0, 0, 1, 0, 0, 0, -1];

const TWIN_CACHE = new WeakMap<CompiledSystem, CompiledSystem>();

/**
 * The compiled straight-axis twin: the system every first-order quantity is
 * expressed in. Already-unfolded systems are their own twin, so this is free
 * and idempotent — call sites can normalize without checking.
 *
 * Memoized on the compiled system rather than left to `asCompiled`: every call
 * to `unfoldedTwin` mints a fresh `Prescription`, so the identity-keyed cache
 * there would miss every time and recompile the whole chain per pupil lookup.
 */
export function axialTwin(c: CompiledSystem): CompiledSystem {
  if (!c.folded) return c;
  let twin = TWIN_CACHE.get(c);
  if (!twin) {
    twin = compile(unfoldedTwin(c.prescription));
    TWIN_CACHE.set(c, twin);
  }
  return twin;
}

/**
 * Rigid map carrying unfolded axial coordinates in space `k` into the world.
 *
 * Walk the chain to the surface that opens the space, then undo the two things
 * that separate the twin's coordinate from the beam: the axial origin (the
 * twin's vertex z) and, after an odd number of mirrors, the direction the
 * coordinate runs in.
 *
 *     world = outgoingFrame[k−1] ∘ zFlip(parity) ∘ translate(0, 0, −Z[k−1])
 *
 * It is always PROPER: `outgoingFrame` picks up det = −1 per mirror and so does
 * the flip, and the two cancel. That is the statement that the twin is a
 * congruent copy and not a mirrored one — an image formed through an odd number
 * of mirrors is inverted in the world, and the twin carries that inversion
 * already rather than having it applied twice.
 */
export function spaceToWorld(c: CompiledSystem, k: number): Transform {
  if (!c.folded || k === 0) return IDENTITY;
  if (k < 0 || k > c.surfaces.length) throw new Error(`space ${k} is not in the chain`);

  let parity = 1;
  let z = 0; // unfolded vertex z of the surface reached so far
  for (let i = 0; i + 1 < k; i++) {
    if (c.surfaces[i]!.kind === "reflect") parity = -parity;
    z += c.surfaces[i]!.thickness * parity;
  }
  if (c.surfaces[k - 1]!.kind === "reflect") parity = -parity;

  const flip: Transform = {
    rotation: parity < 0 ? Z_FLIP : MAT3_IDENTITY,
    translation: vec3(0, 0, 0),
  };
  return compose(
    c.surfaces[k - 1]!.outgoingFrame,
    compose(flip, translation(vec3(0, 0, -z))),
  );
}

/** A space's map and its inverse, cached — the exit side uses both per ray. */
export interface SpaceFrames {
  /** Unfolded axial coordinates → world. */
  readonly toWorld: Transform;
  /** World → unfolded axial coordinates. */
  readonly toAxial: Transform;
  /** True when the two coincide: every axial system, and unfolded folds. */
  readonly isIdentity: boolean;
}

const IMAGE_CACHE = new WeakMap<CompiledSystem, SpaceFrames>();

/** Image space: where the exit pupil, the image plane and every spot live. */
export function imageSpace(c: CompiledSystem): SpaceFrames {
  let f = IMAGE_CACHE.get(c);
  if (!f) {
    const toWorld = spaceToWorld(c, c.surfaces.length);
    f = { toWorld, toAxial: invert(toWorld), isIdentity: !c.folded };
    IMAGE_CACHE.set(c, f);
  }
  return f;
}

/**
 * A traced ray, re-expressed in unfolded image-space coordinates.
 *
 * This is what lets every downstream evaluation keep saying `(z − o.z) / d.z`.
 * On a folded system the exit beam can travel along +y — `d.z` is then zero and
 * the axial forms do not merely lose accuracy, they divide by zero. In image
 * space the beam runs along ±z again by construction.
 */
export function toImageSpace(c: CompiledSystem, r: Ray): Ray {
  const f = imageSpace(c);
  if (f.isIdentity) return r;
  return {
    ...r,
    origin: applyToPoint(f.toAxial, r.origin),
    dir: applyToDirection(f.toAxial, r.dir),
  };
}
