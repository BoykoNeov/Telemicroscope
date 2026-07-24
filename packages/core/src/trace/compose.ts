import { Prescription, SurfaceSpec } from "./prescription";
import { paraxialTrace, systemProperties } from "./paraxial";

/**
 * Module composition — building an instrument from whole *parts* (an objective,
 * an eyepiece, a tube lens) rather than a bare surface list.
 *
 * The resolution ARCHITECTURE § Data model commits to is **flattening, not a
 * second tracer**: a module is a named sub-assembly of `SurfaceSpec`s, and
 * composing a system splices the modules into ONE flat `Prescription` before
 * `compile()` ever runs. Commitment #3 is what makes it cheap — the surface
 * chain is already a list of per-surface frames, so on-axis parts simply
 * concatenate and nothing in the tracer learns a new concept. Folded/tilted
 * *placement* of a whole module (composing the module's frame with a placement
 * frame) is the step-6 generalisation; this on-axis splice is what step 5's
 * eyepiece library needs, and it is a strict special case of it.
 *
 * The one non-trivial thing the splice does is the JOIN: a module authored
 * standalone ends with a trailing thickness to its own focus/image (a BFD),
 * which is meaningless once another part follows it. So the gap AFTER a module
 * overwrites its last surface's thickness; the last module's `gapAfterMm` is the
 * composed chain's own trailing thickness to the image or exit.
 */
export interface ModulePlacement {
  readonly surfaces: readonly SurfaceSpec[];
  /**
   * Axial gap from this module's last vertex to the next module's first vertex
   * (mm). Overwrites the module's own trailing thickness. For the last module
   * it is the composed chain's distance to the image plane / exit.
   */
  readonly gapAfterMm: number;
}

/**
 * Splice modules into one flat `Prescription`. Each module keeps its internal
 * thicknesses; only the trailing thickness of each is replaced by the gap to
 * what follows it. The result is an ordinary prescription that the compiler and
 * every analysis already consume.
 */
export function spliceModules(
  placements: readonly ModulePlacement[],
  objectMedium: string = "AIR",
): Prescription {
  if (placements.length === 0) throw new Error("spliceModules: no modules to splice");
  const surfaces: SurfaceSpec[] = [];
  for (const p of placements) {
    if (p.surfaces.length === 0) throw new Error("spliceModules: a module has no surfaces");
    p.surfaces.forEach((s, i) => {
      surfaces.push(i === p.surfaces.length - 1 ? { ...s, thickness: p.gapAfterMm } : s);
    });
  }
  return { objectMedium, surfaces };
}

/**
 * The object distance that makes the chain's axial output collimated — the
 * **front focal distance**, measured from surface 0's vertex.
 *
 * This is the microscope's counterpart to `afocalTelescope`'s gap solve, and it
 * is a capability the engine did not have: `bestFocus` moves the image plane,
 * and `systemProperties` reports only EFL and BFD, both of which are read from a
 * ray coming *in* collimated. An infinity-corrected objective is the other way
 * round — the specimen sits at the front focus and the light leaves collimated —
 * so where the specimen goes had to be solved rather than looked up.
 *
 * Same affine argument the gap solve rests on, and for the same reason it is
 * exact rather than iterative. A ray from the axial object point at distance s
 * with unit slope reaches surface 0 at height y = s, and the paraxial system's
 * output slope is linear in its input state, so u′(s) = A·s + B: two evaluations
 * pin the line and its zero is the answer. Two, not one, because B ≠ 0 in
 * general and the ratio is what is wanted.
 *
 * Sign: positive means the object is in front of the first vertex, at z = −s,
 * which is the sign `ConjugateSpec.distance` uses.
 */
export function collimatingObjectDistance(p: Prescription, wavelengthNm: number): number {
  const uOut = (s: number): number => paraxialTrace(p, wavelengthNm, { y: s, u: 1 }).u;
  const b = uOut(0);
  const a = uOut(1) - b;
  if (!(Math.abs(a) > 0)) {
    throw new Error("collimatingObjectDistance: the chain has no power — every object distance is afocal");
  }
  return -b / a;
}

export interface AfocalTelescopeSpec {
  /** The objective (refracting), authored standalone; it carries the aperture stop. */
  readonly objective: Prescription;
  /** The eyepiece (refracting), authored field-stop-side first, eye-lens last. */
  readonly eyepiece: Prescription;
  /** Wavelength (nm) the afocal spacing is solved at. */
  readonly wavelengthNm: number;
  /**
   * Trailing distance from the eye lens to the eye (mm). Cosmetic for an afocal
   * system: the exit beam is collimated, so this changes no first-order property
   * (the last surface's thickness never enters the paraxial output angle).
   * Defaults to 0.
   */
  readonly eyeGapMm?: number;
}

export interface AfocalTelescope {
  /** The flat composed chain — objective, solved gap, eyepiece. */
  readonly prescription: Prescription;
  /** Solved objective-rear-vertex → eyepiece-front-vertex separation (mm). */
  readonly gapMm: number;
  /** Paraxial EFL of the objective alone at the design wavelength (mm). */
  readonly objectiveEflMm: number;
  /** Paraxial EFL of the eyepiece alone at the design wavelength (mm). */
  readonly eyepieceEflMm: number;
  /**
   * How many leading surfaces belong to the objective. Enough to name what a
   * per-surface readout came from without a full provenance model (that lands
   * with step 6).
   */
  readonly objectiveSurfaceCount: number;
}

/**
 * Compose an objective and an eyepiece into an afocal (collimated-in,
 * collimated-out) telescope, solving the separation that puts the objective's
 * rear focus on the eyepiece's front focus.
 *
 * The separation is found by the trace, not by a thin-lens formula, so it is
 * correct for thick groups: a parallel input ray's paraxial output angle is
 * affine in the gap g — only the free transfer across g touches it — so two
 * evaluations pin the line and its zero is the afocal spacing. In the thin-lens
 * limit that zero is the textbook f_o + f_e (VALIDATION § 5l); for thick groups
 * it is BFD_o + FFD_e, which the affine solve delivers without either being
 * named.
 */
export function afocalTelescope(spec: AfocalTelescopeSpec): AfocalTelescope {
  const { objective, eyepiece, wavelengthNm } = spec;
  const eyeGap = spec.eyeGapMm ?? 0;
  const objectiveEflMm = systemProperties(objective, wavelengthNm).efl;
  const eyepieceEflMm = systemProperties(eyepiece, wavelengthNm).efl;

  const build = (g: number): Prescription =>
    spliceModules(
      [
        { surfaces: objective.surfaces, gapAfterMm: g },
        { surfaces: eyepiece.surfaces, gapAfterMm: eyeGap },
      ],
      objective.objectMedium ?? "AIR",
    );

  // Output angle of the axial parallel ray is affine in the gap: p + q·g.
  const uOut = (g: number): number => paraxialTrace(build(g), wavelengthNm, { y: 1, u: 0 }).u;
  const p = uOut(0);
  const q = uOut(1) - p;
  if (!(Math.abs(q) > 0)) {
    throw new Error("afocalTelescope: the two groups cannot be made afocal (one has no power)");
  }
  const gapMm = -p / q;
  if (!(gapMm > 0)) {
    throw new Error(
      `afocalTelescope: the afocal spacing is non-physical (${gapMm.toFixed(3)} mm) — check the group signs`,
    );
  }

  return {
    prescription: build(gapMm),
    gapMm,
    objectiveEflMm,
    eyepieceEflMm,
    objectiveSurfaceCount: objective.surfaces.length,
  };
}
