import { Prescription, SurfaceSpec, isFolded } from "./prescription";
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
  /**
   * What this part is, for readouts. ARCHITECTURE's second consequence of the
   * module decision: "analyses must be able to name what a surface came from, or
   * a per-surface readout in a 30-surface microscope is unreadable." Purely
   * descriptive — the splice drops it, because a flat `Prescription` is what the
   * engine consumes and nothing downstream may branch on a label.
   */
  readonly name?: string;
  /**
   * The mechanical interfaces this part carries — thread, barrel, parfocal or
   * flange distance (`core/mech`).
   *
   * ARCHITECTURE's first consequence, and the reason it hangs *here* rather than
   * on a `SurfaceSpec`: a barrel and a parfocal distance are properties of the
   * thing that physically exists, and the thing that physically exists is the
   * module, not one of the eleven glass faces inside it.
   *
   * Deliberately untyped against `core/mech` so `trace/` keeps no dependency on
   * a layer above it; `core/mech` is what reads it. Like `name`, the splice
   * drops it — mechanical data reaches the optics only through
   * `mech.withGlassPath`, never by the tracer learning about mounts.
   */
  readonly mech?: Readonly<Record<string, number | string>>;
}

/**
 * A tilted or decentered surface makes the splice's own precondition false, and
 * the failure is silent unless it is checked here.
 *
 * `ModulePlacement` carries surfaces, not a `Prescription`, so the splice never
 * sees a module's `mirrorFrames` declaration — it returns a chain with **no**
 * declaration, i.e. the default `unfolded`. Splice a folded module and the tilt
 * survives onto the flat chain while the frame declaration does not: the exact
 * tracer walks a 90° bend, and every first-order layer (paraxial, pupils, OPD,
 * focus) reads the same numbers as a straight chain, because `unfoldedTwin`
 * drops tilts and is never reached. The result is a system that is neither
 * folded nor unfolded, and it does not announce itself — it answers.
 *
 * What it answers is wrong by a lot rather than by a little: a Newtonian
 * objective spliced to an eyepiece solves an afocal gap of 1405 mm where the
 * geometry has 130 mm, and the composed chain's chief ray then misses on axis.
 * So the precondition the header states in prose ("this on-axis splice", with
 * folded placement named as the step-6 generalisation) is enforced, with the
 * surface named — `reversePrescription`'s existing folded guard, one layer over.
 */
function refuseTilted(surfaces: readonly SurfaceSpec[], moduleIndex: number): void {
  for (let i = 0; i < surfaces.length; i++) {
    const s = surfaces[i]!;
    const tilted = (s.tiltXDeg ?? 0) !== 0 || (s.tiltYDeg ?? 0) !== 0;
    const decentered = (s.decenterX ?? 0) !== 0 || (s.decenterY ?? 0) !== 0;
    if (!tilted && !decentered) continue;
    throw new Error(
      `spliceModules: module ${moduleIndex}'s surface ${i} is ${tilted ? "tilted" : "decentered"} — ` +
        "the splice is on-axis, and a folded module's frame declaration does not survive it " +
        "(composing a folded part is the step-6 generalisation, docs/VALIDATION § 5l.1)",
    );
  }
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
  for (let m = 0; m < placements.length; m++) {
    const p = placements[m]!;
    if (p.surfaces.length === 0) throw new Error("spliceModules: a module has no surfaces");
    refuseTilted(p.surfaces, m);
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

/**
 * The separation that makes a two-module chain afocal for an object at a
 * **finite** distance — the microscope's counterpart to `afocalTelescope`'s gap
 * solve, and the capability § 6q exists for.
 *
 * `afocalTelescope` solves its gap from a ray entering **collimated**: an object
 * at infinity, which is what a telescope objective sees and what a microscope
 * eyepiece never does. A microscope eyepiece collimates a real *intermediate
 * image* formed a finite distance in front of it, so the ray that has to leave
 * flat is the one from the specimen, and the gap that flattens it is a different
 * number. Using the telescope's gap on a microscope puts the eyepiece 132 mm
 * *before* the intermediate image instead of behind it, so its object is virtual
 * and the exit beam **converges** to a point 14 mm past the eye lens — +70.5
 * diopters (§ 6q.3). That is not merely more than an eye accommodates, it is the
 * wrong side of infinity: an eye cannot accommodate converging light at all.
 * Which is why this is an engine step and not a call-site argument.
 *
 * Affine for the same reason the telescope's solve is: the free transfer across
 * g is the only place g enters the output slope, so u_out(g) = p + q·g and two
 * evaluations pin the line. Exact, not iterative.
 *
 * @param front the image-forming chain, authored object-side first. Its own
 * trailing thickness is overwritten by the solved gap, so whatever BFD it
 * carries standalone is irrelevant here.
 * @param back the collimating group (the eyepiece), field-side first.
 * @param objectDistanceMm the axial object, in front of `front`'s surface 0.
 */
export function collimatingGap(
  front: Prescription,
  back: Prescription,
  objectDistanceMm: number,
  wavelengthNm: number,
): number {
  const build = (g: number): Prescription =>
    spliceModules(
      [
        { surfaces: front.surfaces, gapAfterMm: g },
        { surfaces: back.surfaces, gapAfterMm: 0 },
      ],
      front.objectMedium ?? "AIR",
    );
  const uOut = (g: number): number =>
    paraxialTrace(build(g), wavelengthNm, { y: objectDistanceMm, u: 1 }).u;
  const p = uOut(0);
  const q = uOut(1) - p;
  if (!(Math.abs(q) > 0)) {
    throw new Error("collimatingGap: the second module has no power — no gap collimates the exit");
  }
  const gapMm = -p / q;
  if (!(gapMm > 0)) {
    throw new Error(
      `collimatingGap: the collimating separation is non-physical (${gapMm.toFixed(3)} mm) — is the object inside the front group's focus?`,
    );
  }
  return gapMm;
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
  // The spec above says "refracting" of both groups; this is where it becomes a
  // refusal instead of a comment. `spliceModules` catches a folded module by its
  // TILT, which is what a Newtonian's diagonal carries; a folded chain whose
  // surfaces are all axial would slip past that and still be mis-read, because
  // the frame declaration is what the splice drops (§ 5l.1). Checked on the
  // Prescription, which is the only level that has the declaration.
  for (const [name, p] of [
    ["objective", objective],
    ["eyepiece", eyepiece],
  ] as const) {
    if (isFolded(p)) {
      throw new Error(
        `afocalTelescope: the ${name} is a folded chain — the composed splice is on-axis and ` +
          "would drop its frame, so the gap solve would answer for a system it cannot express",
      );
    }
  }
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
