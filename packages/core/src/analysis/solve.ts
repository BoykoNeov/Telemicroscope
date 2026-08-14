import { Prescription } from "../trace/prescription";
import { systemProperties } from "../trace/paraxial";

/**
 * The paraxial solve — "what value of this parameter makes that property equal
 * X?" — which is the first half of ROADMAP's design-mode entry and the other
 * half of what `bestFocus` already does.
 *
 * ## Why this is a separate module from `focus.ts`, and not a generalisation of it
 *
 * The roadmap bullet reads "the focus solve is already a solver; generalizing
 * it is cheap", and the cheap part is true while the *generalizing* part is
 * not: they are different problems. `bestFocus` MINIMISES a merit — it has no
 * target value, it wants the bottom of a curve, and golden section is the right
 * tool because a minimum is bracketed by three points and not by a sign change.
 * A design target is a ROOT: g(x) = property(x) − target, and it is bracketed by
 * two points of opposite sign. Nothing in `bracketedMin` transfers, and a
 * minimiser pointed at a root problem finds |g| ≈ 0 only to the square root of
 * the precision it would find a sign change to, because near a simple root |g|
 * is V-shaped and a minimiser reads a V as flat over a much wider interval.
 *
 * So: this module roots, `focus.ts` minimises, and the damped-least-squares
 * half of design mode — which minimises a merit over SEVERAL variables — is a
 * third thing that is deliberately not here. It needs a merit whose minimiser
 * is known in closed form before it can be pinned at all, and this repo does
 * not land a capability it cannot pin.
 *
 * ## A solve hands you a number; it does not hand you a system
 *
 * `focus.ts` states the convention and this file keeps it: solving returns the
 * VALUE, and `withVariable` is the separate, explicit step that builds a
 * prescription from it. A solver that returned a mutated prescription would
 * make "what does this parameter have to be?" and "give me the lens" the same
 * call, and a design tool asks the first question far more often than it wants
 * the second — every constraint in a multi-parameter design is the first
 * question about a system that is not built yet.
 *
 * ## The search is an INTERVAL the caller states, not a bracket that expands
 *
 * A root find needs somewhere to look, and there are two ways to get one:
 * expand outward from a seed until the sign changes, or scan a range the caller
 * declares. This module scans, and the reason is that the first design is
 * quietly dishonest about multiple roots. Expanding outward returns the first
 * sign change it happens to meet and says nothing about the others, so a
 * caller who asks an equiconvex lens for a 20 mm focal length gets ONE of the
 * two curvatures that deliver it, chosen by the expansion schedule — which is
 * an implementation detail wearing the clothes of a physical answer.
 *
 * Scanning makes the multiplicity visible instead: `roots` carries every root
 * the scan resolved, in increasing x, and `x` is the one nearest the seed. The
 * caller states the interval because only the caller knows what is physical —
 * a curvature has no natural range, and a thickness that goes negative is a
 * different lens rather than a worse one.
 *
 * **The blindness this buys, stated rather than left to be found:** a scan cell
 * containing an EVEN number of roots shows no sign change across it, so a pair
 * of roots closer together than one cell is stepped over as if it were not
 * there. That is why `scanCells` is an option and not a constant. It is the
 * same class of sharp edge as `bracketedMin`'s bracket width, and it fails the
 * same way — silently — which is why the refusal below names the resolution it
 * searched at.
 *
 * ## The pole, which is a root the arithmetic invents
 *
 * EFL is 1/P, so a system whose power passes through zero has an EFL that runs
 * to +∞, reappears at −∞, and crosses **every** finite target on the way — with
 * a sign change, at a place where the property does not take the target value
 * at all. A bisection dropped into that cell converges neatly onto the pole and
 * returns it. So every candidate is CHECKED at its refined x: a root whose
 * residual exceeds `valueTolerance` is discarded as an artefact of the sign,
 * and if the discards leave nothing the solve refuses and names them.
 *
 * `solveParaxial` then removes the hazard rather than only surviving it: an
 * `efl` target is solved as a POWER target internally, 1/efl against 1/value,
 * which turns the pole into an ordinary zero and leaves no spurious sign change
 * for the guard to catch. The guard stays because `solveScalar` is public and a
 * caller's own merit may have poles this module cannot see. § 1.7 pins both
 * halves: the guard firing on a bare `solveScalar`, and the same system solving
 * cleanly through `solveParaxial`.
 */

export interface ScalarRoot {
  /** The variable's value at the root. */
  readonly x: number;
  /** `evaluate(x)` there — reported so a caller can see what it actually got. */
  readonly value: number;
}

export interface ScalarSolveOptions {
  /**
   * Where to look, `[lo, hi]`. Required: only the caller knows what range of
   * this parameter is a lens rather than an arithmetic possibility.
   */
  readonly interval: readonly [number, number];
  /**
   * Which root to prefer when the interval holds several. Default: the
   * interval's midpoint. Ties go to the smaller x, so the choice is a function
   * of the arguments and not of the scan order.
   */
  readonly seed?: number;
  /**
   * Equal cells the interval is scanned in before anything is refined. Default
   * 64. Two roots inside one cell are invisible — see the module header.
   */
  readonly scanCells?: number;
  /**
   * Absolute convergence width on x. Default `8·eps·max(|lo|, |hi|)`, i.e. a
   * few ulp of the interval's own scale.
   */
  readonly tolerance?: number;
  /**
   * How close `evaluate(x)` must land to `target` for a candidate to count as a
   * root rather than a pole. Default `1e-9·|target| + 1e-12`.
   */
  readonly valueTolerance?: number;
}

export interface ScalarSolveResult {
  /** The root nearest the seed. */
  readonly x: number;
  /** `evaluate(x)`. */
  readonly value: number;
  /** `value − target`, in the property's own units. */
  readonly residual: number;
  /** Every root the scan resolved, in increasing x. Length ≥ 1. */
  readonly roots: readonly ScalarRoot[];
  /** How many times `evaluate` was called. */
  readonly evaluations: number;
}

/**
 * Root find on `evaluate(x) = target` over a stated interval.
 *
 * `evaluate` may throw or return a non-finite number for an x that is not a
 * system — an afocal configuration has no EFL, and the engine says so by
 * throwing. Such a point is treated as a WALL: the cells touching it are
 * skipped rather than being allowed to manufacture a sign change against a
 * neighbour. This is not error suppression; it is the same statement the engine
 * makes, read as "there is no root here" instead of being propagated to a
 * caller who asked about a different x.
 */
export function solveScalar(
  evaluate: (x: number) => number,
  target: number,
  options: ScalarSolveOptions,
): ScalarSolveResult {
  const [lo, hi] = options.interval;
  if (!(Number.isFinite(lo) && Number.isFinite(hi))) {
    throw new Error(`solveScalar: the search interval [${lo}, ${hi}] is not finite`);
  }
  if (!(hi > lo)) {
    throw new Error(`solveScalar: the search interval [${lo}, ${hi}] is empty or reversed`);
  }
  if (!Number.isFinite(target)) {
    throw new Error(`solveScalar: the target ${target} is not finite`);
  }
  const cells = options.scanCells ?? 64;
  if (!(Number.isInteger(cells) && cells >= 1)) {
    throw new Error(`solveScalar: scanCells must be a positive integer, got ${cells}`);
  }
  const seed = options.seed ?? (lo + hi) / 2;
  const scale = Math.max(Math.abs(lo), Math.abs(hi));
  const tolerance = options.tolerance ?? 8 * Number.EPSILON * scale;
  const valueTolerance = options.valueTolerance ?? 1e-9 * Math.abs(target) + 1e-12;

  let evaluations = 0;
  /** `evaluate` with the wall convention applied: NaN means "not a system". */
  const g = (x: number): number => {
    evaluations++;
    let v: number;
    try {
      v = evaluate(x);
    } catch {
      return Number.NaN;
    }
    return Number.isFinite(v) ? v - target : Number.NaN;
  };

  // The scan. Nodes are computed from the index rather than accumulated, so the
  // last one is exactly `hi` and no cell is a rounding wider than its neighbour.
  const node = (i: number): number => lo + ((hi - lo) * i) / cells;
  const gs: number[] = [];
  for (let i = 0; i <= cells; i++) gs.push(g(node(i)));

  const candidates: number[] = [];
  for (let i = 0; i <= cells; i++) {
    // An exact hit at a node is a root already; nothing to bisect.
    if (gs[i] === 0) candidates.push(node(i));
  }
  for (let i = 0; i < cells; i++) {
    const a = gs[i]!;
    const b = gs[i + 1]!;
    if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
    if (a === 0 || b === 0) continue; // already taken as an exact hit
    if (a > 0 === b > 0) continue;
    candidates.push(brent(g, node(i), a, node(i + 1), b, tolerance));
  }

  // Every candidate is checked at its own x. A sign change across a pole is a
  // sign change, and the only thing that separates it from a root is the
  // residual there.
  const roots: ScalarRoot[] = [];
  const rejected: string[] = [];
  for (const x of candidates) {
    let v: number;
    try {
      v = evaluate(x);
      evaluations++;
    } catch (err) {
      rejected.push(`x = ${x} (${(err as Error).message})`);
      continue;
    }
    if (Number.isFinite(v) && Math.abs(v - target) <= valueTolerance) {
      roots.push({ x, value: v });
    } else {
      rejected.push(`x = ${x} → ${v}`);
    }
  }
  roots.sort((p, q) => p.x - q.x);

  if (roots.length === 0) {
    const where = `over [${lo}, ${hi}] scanned in ${cells} cells`;
    if (rejected.length > 0) {
      throw new Error(
        `solveScalar: every sign change ${where} was a pole rather than a root ` +
          `for target ${target} — rejected ${rejected.join("; ")}`,
      );
    }
    // Nothing changed sign anywhere. Report how close the scan came, because
    // "unreachable" and "your interval was in the wrong place" look identical
    // from the outside and the closest approach tells them apart.
    let bestX = Number.NaN;
    let bestValue = Number.NaN;
    let bestAbs = Number.POSITIVE_INFINITY;
    for (let i = 0; i <= cells; i++) {
      const v = gs[i]!;
      if (Number.isFinite(v) && Math.abs(v) < bestAbs) {
        bestAbs = Math.abs(v);
        bestX = node(i);
        bestValue = v + target;
      }
    }
    if (!Number.isFinite(bestX)) {
      throw new Error(
        `solveScalar: nothing ${where} evaluates to a finite number, so the target ` +
          `${target} has nowhere to be reached`,
      );
    }
    throw new Error(
      `solveScalar: the target ${target} is not reached ${where} — the closest the scan ` +
        `came is ${bestValue} at x = ${bestX}, off by ${bestAbs}`,
    );
  }

  let best = roots[0]!;
  for (const r of roots) {
    const d = Math.abs(r.x - seed);
    const bd = Math.abs(best.x - seed);
    if (d < bd) best = r;
  }
  return { x: best.x, value: best.value, residual: best.value - target, roots, evaluations };
}

/**
 * Brent's method on a bracket already known to change sign.
 *
 * Inverse quadratic interpolation where it helps, secant where it does not, and
 * bisection whenever either would step outside the bracket or fail to halve it
 * — so it keeps the bracket at every iteration and cannot converge to anything
 * but a sign change, while costing a handful of evaluations rather than the ~52
 * plain bisection needs to reach the same width.
 */
function brent(
  g: (x: number) => number,
  aIn: number,
  gaIn: number,
  bIn: number,
  gbIn: number,
  tolerance: number,
): number {
  let a = aIn;
  let b = bIn;
  let fa = gaIn;
  let fb = gbIn;
  if (Math.abs(fa) < Math.abs(fb)) {
    [a, b] = [b, a];
    [fa, fb] = [fb, fa];
  }
  let c = a;
  let fc = fa;
  let d = b - a;
  let e = d;

  for (let it = 0; it < 200; it++) {
    if (fb === 0) return b;
    if (fc !== 0 && fb > 0 === fc > 0) {
      c = a;
      fc = fa;
      d = b - a;
      e = d;
    }
    if (Math.abs(fc) < Math.abs(fb)) {
      a = b;
      b = c;
      c = a;
      fa = fb;
      fb = fc;
      fc = fa;
    }
    const tol = 2 * Number.EPSILON * Math.abs(b) + tolerance / 2;
    const m = (c - b) / 2;
    if (Math.abs(m) <= tol) return b;

    if (Math.abs(e) < tol || Math.abs(fa) <= Math.abs(fb)) {
      d = m;
      e = m;
    } else {
      const s = fb / fa;
      let p: number;
      let q: number;
      if (a === c) {
        p = 2 * m * s;
        q = 1 - s;
      } else {
        const r = fb / fc;
        const t = fa / fc;
        p = s * (2 * m * t * (t - r) - (b - a) * (r - 1));
        q = (t - 1) * (r - 1) * (s - 1);
      }
      if (p > 0) q = -q;
      p = Math.abs(p);
      if (2 * p < Math.min(3 * m * q - Math.abs(tol * q), Math.abs(e * q))) {
        e = d;
        d = p / q;
      } else {
        d = m;
        e = m;
      }
    }
    a = b;
    fa = fb;
    b += Math.abs(d) > tol ? d : m > 0 ? tol : -tol;
    fb = g(b);
    // A wall inside the bracket: `g` said this x is not a system. Fall back to
    // the midpoint, which is inside a bracket that was valid at both ends.
    if (!Number.isFinite(fb)) {
      b = (a + c) / 2;
      fb = g(b);
      if (!Number.isFinite(fb)) return b;
      e = c - a;
      d = e;
    }
  }
  return b;
}

/** Which prescription number a solve is allowed to move. */
export type SolveVariable =
  /** `surfaces[surface].curvature`, in 1/mm — what the sag formula consumes. */
  | { readonly kind: "curvature"; readonly surface: number }
  /** `surfaces[surface].thickness`, in mm, signed as the engine signs it. */
  | { readonly kind: "thickness"; readonly surface: number };

/** Which first-order property a solve is aiming at. */
export type ParaxialTarget =
  /** Effective focal length (mm). Solved on POWER — see the module header. */
  | { readonly kind: "efl"; readonly value: number }
  /** Back focal distance, last vertex → paraxial focus (mm, signed). */
  | { readonly kind: "bfd"; readonly value: number };

/**
 * A copy of `prescription` with one number changed. Does not mutate — the same
 * contract `withFocus` keeps, for the same reason.
 *
 * Prescription-level and therefore fold-blind: `mirrorFrames` is copied through
 * untouched, and a thickness on a folded chain keeps whatever meaning the chain
 * already gave it. Nothing here re-reads a surface list in the other convention.
 */
export function withVariable(
  prescription: Prescription,
  variable: SolveVariable,
  value: number,
): Prescription {
  const i = variable.surface;
  if (!Number.isInteger(i) || i < 0 || i >= prescription.surfaces.length) {
    throw new Error(
      `withVariable: surface ${i} is not in a prescription of ${prescription.surfaces.length}`,
    );
  }
  // Written as two branches rather than one computed key: a computed key widens
  // the property's type to the union of both, and a `curvature` that typechecks
  // as `number | undefined` is exactly the kind of silent hole this engine's
  // strict settings exist to close.
  const surfaces = prescription.surfaces.map((s, k) => {
    if (k !== i) return s;
    return variable.kind === "curvature"
      ? { ...s, curvature: value }
      : { ...s, thickness: value };
  });
  return { ...prescription, surfaces };
}

/**
 * Solve one prescription number for one first-order target.
 *
 * Returns the value the variable must take — build with `withVariable`. The
 * `roots` array carries every solution in the interval, so a caller can see
 * that a target was reachable two ways rather than discovering it later.
 *
 * The wavelength matters: every index in the chain is dispersive, so "make the
 * EFL 100 mm" is a different equation at F than at C, and the answer is only a
 * design value at the line it was solved on.
 */
export function solveParaxial(
  prescription: Prescription,
  variable: SolveVariable,
  target: ParaxialTarget,
  wavelengthNm: number,
  options: ScalarSolveOptions,
): ScalarSolveResult {
  const i = variable.surface;
  if (!Number.isInteger(i) || i < 0 || i >= prescription.surfaces.length) {
    throw new Error(
      `solveParaxial: surface ${i} is not in a prescription of ${prescription.surfaces.length}`,
    );
  }
  if (!(Number.isFinite(target.value) && target.value !== 0)) {
    throw new Error(`solveParaxial: a ${target.kind} target of ${target.value} is not a design target`);
  }

  const at = (x: number): { efl: number; bfd: number } =>
    systemProperties(withVariable(prescription, variable, x), wavelengthNm);

  if (target.kind === "bfd") {
    return solveScalar((x) => at(x).bfd, target.value, options);
  }

  // EFL solved as POWER: 1/efl has a zero where efl has a pole, so the crossing
  // the arithmetic would invent is not there to be found. The result is
  // translated back into mm so a caller reads focal lengths, not diopters.
  const powerTarget = 1 / target.value;
  const inPower = solveScalar((x) => 1 / at(x).efl, powerTarget, {
    ...options,
    // The default value tolerance is relative to the target, and the target has
    // been reciprocated — so reciprocate the tolerance with it rather than
    // letting a 1000 mm focal length be solved a million times more loosely
    // than a 1 mm one.
    valueTolerance: options.valueTolerance ?? 1e-9 * Math.abs(powerTarget) + 1e-15,
  });
  const roots = inPower.roots.map((r) => ({ x: r.x, value: 1 / r.value }));
  const value = 1 / inPower.value;
  return {
    x: inPower.x,
    value,
    residual: value - target.value,
    roots,
    evaluations: inPower.evaluations,
  };
}
