import { Prescription, SurfaceSpec } from "../trace/prescription";
import { paraxialTrace } from "../trace/paraxial";
import { LINE_D } from "../materials/dispersion";

/**
 * The image-space telecentric stop — a *placement*, shipped as a design.
 *
 * Every other entry in this folder is a lens. This one is the millimetre in
 * front of one, and it is here because that millimetre is where the physics is.
 * Machine-vision telecentric lenses are the real article, and what makes them
 * telecentric is not the glass: it is that the aperture stop sits on the tail
 * group's FRONT focal plane, so every chief ray leaves the last surface parallel
 * to the axis, the exit pupil is at infinity, and the image scale stops
 * depending on where the sensor is. § 6aj grew the engine quantity that reads
 * that condition; §§ 6ak–6aq built five fixtures around it in test files. This
 * is the fixture, with the argument attached.
 *
 * ## Why it takes a TAIL rather than choosing one
 *
 * The obvious shape for this file was three presets — a singlet one, an
 * achromatic one, an apochromatic one — and that shape is wrong, because § 6aq
 * measured that the lens and the placement are **independent knobs**. What the
 * glass decides is how many turns the front focal distance FFD(λ) has; what the
 * placement decides is whether a pole is crossed or touched. Fusing them would
 * hide exactly the finding the last three steps produced. So the tail comes in
 * from outside — `designs/achromat`, `designs/apochromat`, or a bare
 * prescription — and this entry owns only where the stop goes.
 *
 * ## The count is bounded by the turns, and that is arithmetic
 *
 * FFD is wavelength-dependent, so a stop at a fixed distance is at a front focal
 * point only at the wavelengths where FFD(λ) equals that distance. For a
 * **singlet** FFD(λ) is monotone across the visible: one crossing, and § 6an's
 * whole story. **Achromatise** the tail and FFD(λ) turns around inside the band,
 * so the same distance is reached twice (§ 6ap). Add a **third glass** and there
 * are two turns, so three times (§ 6aq).
 *
 * The pattern is not "one more glass, one more colour" — it is that a curve with
 * k interior turns meets a horizontal line at most k+1 times. § 6ap's deferral
 * predicted FOUR crossings from two turns and that was arithmetic, not physics;
 * four needs three turns. `telecentricWavelengthsNm` reports what the tail
 * handed in actually achieves, and `turningPointsNm` reports the bound.
 *
 * **What is NOT true is that a fourth united wavelength supplies the third
 * turn**, and this file said it was until § 6ay measured it. Four united
 * wavelengths put three turns in **EFL(λ)** — that much is Rolle's theorem on
 * the solve's own conditions. But the placement is a level of FFD, and
 * FFD = EFL · D: the chromatic solve constrains C, which is EFL, and leaves the
 * ray-transfer element D alone. On the superachromatic quadruplet D drifts
 * monotonically, and over the span its four united lines cover it carries FFD
 * 61.9× further than the corrected EFL's ripple bends it back — so FFD(λ) has
 * NO turn in the visible and the stop is telecentric ONCE, fewer than the
 * doublet two glasses back. The turn count is a fact about the tail's principal planes,
 * and a chromatic solve is not how one gets more of them.
 *
 * ## Two placements, and the difference is 3.8 µm
 *
 *  - `{ kind: "frontFocal" }` puts the stop at FFD(λ₀) for a stated wavelength.
 *    That distance is a value FFD(λ) *passes through*, so the roots are simple:
 *    the exit pupil sweeps through infinity and out the other side, and the
 *    defocus rescale 1 + δ/R(λ) reverses sign at each crossing.
 *  - `{ kind: "turn" }` puts it at the value FFD(λ) *turns at*. The two roots
 *    there merge into a double one: telecentricity still holds exactly, once,
 *    but the pole is **touched** rather than crossed and the sign never reverses
 *    — the whole band defocuses in one direction. On § 6ap's doublet the two
 *    placements are 3.8 µm apart, which is the entire design decision and is a
 *    number a mount has to hold.
 *
 * `poleOrder` says which was built. It is a consequence of the placement, not a
 * measurement of it, and § 6ar.5 is the rung that checks the two agree.
 *
 * **A turn placement does not make the whole band one-directional, and this is
 * the one thing none of the five fixtures could see.** § 6ap's doublet has ONE
 * turn, so a stop at it has one root in the band and the sign genuinely never
 * reverses — which is what § 6ap.5 pins. Put the same placement on § 6aq's
 * triplet and the curve, having turned twice, comes back down to that same level
 * at the red end: the pole is touched at 498.76 nm and still CROSSED at 728.43,
 * so the sign reverses once after all. `poleOrders` gives the order of each
 * crossing so a caller cannot read the design-wavelength one as a statement
 * about the band.
 *
 * ## What is quoted to how many digits, and why they differ
 *
 * The two reported wavelength lists are found by different searches and are
 * **not** quotable to the same precision, which § 6aq learned the hard way:
 *
 *  - `turningPointsNm` are **extrema**, found by golden section, and locating a
 *    smooth extremum is a √ε business: near the turn the curve is flat, so
 *    wavelengths a long way apart give focal distances that differ by less than
 *    a double can represent. On § 6aq's triplet the spread is ~5e−4 nm, a
 *    thousand times more than the design's own bending root moves the same turn.
 *  - `telecentricWavelengthsNm` are **crossings**, found by bisection on a sign
 *    change, and they are far better located — but **not to the last bits, and
 *    saying so was this file's own first mistake.** The tempting argument is
 *    that a sign is exact. The sign is exact; the FUNCTION is not. FFD(λ) minus
 *    the placement is a difference of two numbers near 53 mm, so it carries
 *    nothing below 53·ε ≈ 1.2e−14 mm, and dividing that by the slope the curve
 *    crosses at gives the floor — 4.1e−10 nm at the d line on § 6aq's triplet.
 *    § 6aq.4 pinned that crossing to nine decimals and § 6ar found that nine was
 *    the bracket: the same lens from five brackets spreads 1.6e−9 nm, and four of
 *    the five miss by more than the pin allowed.
 *
 * Both are therefore reported with a MEASURED uncertainty — `turnUncertaintyNm`
 * and `crossingUncertaintyNm`, each the spread of the same search run from five
 * brackets, neither of them a guess. **Digits past them belong to the bracket,
 * not to the lens.**
 *
 * ## Scope
 *
 * The stop is a plane dummy surface in air ahead of the tail, which is what the
 * five fixtures use and what a mount is. The condition is paraxial — it is
 * `u′ = C·y + D·u` at `D = 0`, read on the tail's own ray-transfer matrix — so
 * pupil aberration is not modelled here any more than it is in § 6u or § 6aj,
 * and the tail's own aberrations are the tail's business. Nothing here traces a
 * real ray or touches the pupil layer: `pupils()` is what confirms the exit pupil
 * is at infinity, and it is a reader, not part of the construction.
 *
 * If the tail carries its own `isStop` — `designs/achromat` and
 * `designs/apochromat` both flag their front vertex, since a bare objective's
 * cell is its stop — the flag is **stripped** as the group is composed in, so
 * the prescription has exactly one stop. `trace/system` takes the first flagged
 * surface, so this changes no traced result; it is the `pupil/visual` precedent,
 * and § 6ar.4 pins the frame bitwise either way.
 */

/** Where the stop goes. */
export type TelecentricPlacement =
  /**
   * At the tail's front focal distance for `wavelengthNm` (default the d line).
   * The roots are simple and the pole is crossed.
   */
  | { readonly kind: "frontFocal"; readonly wavelengthNm?: number }
  /**
   * At the value FFD(λ) turns at. The root is double and the pole is touched.
   * `index` selects among the turns in the band, in increasing wavelength;
   * default 0. Refuses if the tail has no turn there — a singlet has none.
   */
  | { readonly kind: "turn"; readonly index?: number }
  /** At a stated distance, for a caller that has its own placement argument. */
  | { readonly kind: "distance"; readonly stopToVertexMm: number };

export interface TelecentricStopSpec {
  /**
   * The tail group. Its last surface's thickness is ignored — a focal length is
   * a property of the glass, not of where the sensor was left — and replaced by
   * `imageDistanceMm`.
   */
  readonly tail: Prescription;
  /** Default `{ kind: "frontFocal" }`, i.e. the front focal distance at the d line. */
  readonly placement?: TelecentricPlacement;
  /**
   * The band (nm) the crossings and turns are searched over. Default 380…800,
   * which is the band §§ 6ap and 6aq measure their tails to render over. It is
   * NOT a claim that the tail is honest across it — `imaging/brightfield-spectrum`
   * decides that, per plane, by measuring.
   */
  readonly bandNm?: readonly [number, number];
  /** The dummy stop surface's own semi-aperture (mm). Default 30, as the fixtures use. */
  readonly stopSemiApertureMm?: number;
  /**
   * Distance from the LAST vertex to the image plane (mm). Defaults to the tail
   * group's paraxial back focal distance at the design wavelength, so the
   * prescription itself lands on focus; a focus solve normally replaces it.
   */
  readonly imageDistanceMm?: number;
}

export interface TelecentricStopSystem {
  /** Stop dummy, then the tail, then `imageDistanceMm` of air. */
  readonly prescription: Prescription;
  /** The gap from the stop to the tail's first vertex (mm) — the whole design. */
  readonly stopToVertexMm: number;
  /** The wavelength the placement was computed at (nm). */
  readonly designWavelengthNm: number;
  /** The tail's front focal distance at the design wavelength (mm). */
  readonly frontFocalDistanceMm: number;
  /**
   * The wavelengths in the band at which the stop is at a front focal point, so
   * the exit pupil is at infinity and the system is image-space telecentric.
   * Bisected on a sign change — good to the last bits. At most one more than
   * `turningPointsNm.length`.
   */
  readonly telecentricWavelengthsNm: readonly number[];
  /**
   * Where FFD(λ) turns inside the band (nm), in increasing wavelength. The bound
   * on the count above, and the placements a `"turn"` can select.
   */
  readonly turningPointsNm: readonly number[];
  /**
   * What the turn search can actually locate (nm), measured as the spread of the
   * same search from five nested brackets — NOT a tolerance and not a guess. It
   * is the number of digits of `turningPointsNm` that mean anything. Zero when
   * there are no turns.
   */
  readonly turnUncertaintyNm: number;
  /**
   * What the crossing search can locate (nm), measured the same way: the spread
   * of the same bisection run from five brackets around each crossing. Much
   * smaller than `turnUncertaintyNm` — a crossing is an ε business where a turn
   * is a √ε one — but NOT zero, which is the correction § 6ar made to § 6aq.4.
   * Zero when there are no crossings.
   */
  readonly crossingUncertaintyNm: number;
  /**
   * The order of the root AT `designWavelengthNm`. `"simple"` — the stop is at a
   * distance FFD(λ) passes through, so the exit pupil sweeps through infinity and
   * the defocus rescale reverses sign there. `"double"` — it is at a turn, so
   * that pole is touched and the sign does not reverse there.
   *
   * It is about ONE crossing. A tail with two turns can be touched at the design
   * wavelength and still crossed elsewhere in the band — see `poleOrders`.
   */
  readonly poleOrder: "simple" | "double";
  /**
   * The order of each entry of `telecentricWavelengthsNm`, in the same order.
   * Exactly one is `"double"` when the placement is a turn, and every entry is
   * `"simple"` otherwise.
   */
  readonly poleOrders: readonly ("simple" | "double")[];
  readonly bandNm: readonly [number, number];
  readonly imageDistanceMm: number;
}

/**
 * The tail's front focal distance at a wavelength: the gap that makes a ray
 * leaving the stop centre arrive at the tail's exit parallel to the axis.
 *
 * By definition rather than by search, and this is § 6aj.1's own form: a ray
 * leaving the stop centre at slope 1 reaches the first vertex at height `t` and
 * leaves the group with slope `C·t + D`, so the gap that zeroes it is `−D/C`.
 * Both elements come off the public paraxial trace of the group alone.
 */
export function frontFocalDistance(group: Prescription, wavelengthNm: number): number {
  const c = paraxialTrace(group, wavelengthNm, { y: 1, u: 0 }).u;
  const d = paraxialTrace(group, wavelengthNm, { y: 0, u: 1 }).u;
  return -d / c;
}

/** The group a focal length is OF: the tail with its trailing air removed. */
const groupOf = (tail: Prescription): Prescription => ({
  surfaces: tail.surfaces.map((s, i, all) =>
    i === all.length - 1 ? { ...s, thickness: 0 } : s,
  ),
});

/** Bisection on a sign change, to the last bits a double holds. */
const bisect = (g: (x: number) => number, a: number, b: number): number => {
  let lo = a;
  let hi = b;
  for (let i = 0; i < 200; i++) {
    const mid = 0.5 * (lo + hi);
    if (g(lo) * g(mid) <= 0) hi = mid;
    else lo = mid;
  }
  return 0.5 * (lo + hi);
};

/**
 * Golden section on a smooth extremum, `want` naming which one. Spelled as a
 * word rather than a ±1 because the sign that means "maximum" is not the one
 * it reads as: the comparison keeps the LEFT sub-interval when the left probe is
 * the better one, so the multiplier that finds a maximum is −1.
 */
const goldenSection = (
  g: (x: number) => number,
  a: number,
  b: number,
  want: "min" | "max",
): number => {
  const sign = want === "min" ? 1 : -1;
  let lo = a;
  let hi = b;
  for (let i = 0; i < 200; i++) {
    const m1 = lo + (hi - lo) * 0.382;
    const m2 = lo + (hi - lo) * 0.618;
    if (sign * g(m1) < sign * g(m2)) hi = m2;
    else lo = m1;
  }
  return 0.5 * (lo + hi);
};

export function telecentricStop(spec: TelecentricStopSpec): TelecentricStopSystem {
  const surfaces = spec.tail.surfaces;
  if (surfaces.length < 2) {
    throw new Error("telecentricStop: the tail needs at least two surfaces to have a focal length");
  }
  const bandNm = spec.bandNm ?? ([380, 800] as const);
  const [from, to] = bandNm;
  if (!(from > 0) || !(to > from) || !Number.isFinite(to)) {
    throw new Error(
      `telecentricStop: the band must be a positive increasing wavelength range (got ${from}…${to} nm)`,
    );
  }
  const stopSemiApertureMm = spec.stopSemiApertureMm ?? 30;
  if (!(stopSemiApertureMm > 0) || !Number.isFinite(stopSemiApertureMm)) {
    throw new Error("telecentricStop: the stop's semi-aperture must be positive and finite");
  }

  const group = groupOf(spec.tail);
  const ffd = (nm: number): number => frontFocalDistance(group, nm);

  const placement = spec.placement ?? ({ kind: "frontFocal" } as const);

  /**
   * The turns, found in two passes: a coarse walk on the SLOPE for how many
   * there are and roughly where, then a golden section for where exactly.
   *
   * **The bracket handed to the golden section is WIDE — halfway to each
   * neighbour — and that is not laziness.** Near a turn the curve is flat to
   * within what a double can represent, so the coarse walk's own sign change
   * lands anywhere inside that flat region: on the § 6aq triplet it fires 0.24 nm
   * off the true turn, which is a hundred times the step. A golden section
   * bracketed by the walk's neighbourhood would therefore be bracketing noise,
   * and would return the grid point it started from. Bracketing halfway to the
   * neighbouring turn instead is safe for the reason the count establishes: with
   * one turn between them the function is unimodal on that interval.
   *
   * The coarse step is 0.1 nm, the fixtures' own. A turn narrower than that is
   * not a turn this band resolves — and it is the COUNT that has to be right,
   * since the count is what bounds the crossings.
   */
  const step = 0.1;
  const coarse: number[] = [];
  /** A turn the curve RISES into is a maximum. */
  const want: ("min" | "max")[] = [];
  let previousSlope = ffd(from + step) - ffd(from);
  for (let nm = from + step; nm + step <= to; nm += step) {
    const slope = ffd(nm + step) - ffd(nm);
    if (previousSlope * slope < 0) {
      coarse.push(nm);
      want.push(previousSlope > 0 ? "max" : "min");
    }
    previousSlope = slope;
  }
  /** Halfway to each neighbour, or to the band edge. */
  const bracketFor = (i: number): [number, number] => [
    i === 0 ? from : 0.5 * (coarse[i - 1]! + coarse[i]!),
    i === coarse.length - 1 ? to : 0.5 * (coarse[i]! + coarse[i + 1]!),
  ];
  const turningPointsNm = coarse.map((_, i) => {
    const [a, b] = bracketFor(i);
    return goldenSection(ffd, a, b, want[i]!);
  });

  /**
   * What the search can locate, MEASURED. Five nested brackets around each turn,
   * and the spread of the answers is the honest uncertainty — the § 6aq lesson,
   * and the reason `turningPointsNm` is not quoted to twelve digits.
   */
  let turnUncertaintyNm = 0;
  for (let i = 0; i < coarse.length; i++) {
    const [a, b] = bracketFor(i);
    const centre = turningPointsNm[i]!;
    const sign = want[i]!;
    const answers: number[] = [];
    for (let k = 0; k < 5; k++) {
      const shrink = 1 - 0.15 * k;
      const lo = centre - (centre - a) * shrink;
      const hi = centre + (b - centre) * shrink;
      if (hi > lo) answers.push(goldenSection(ffd, lo, hi, sign));
    }
    if (answers.length > 1) {
      turnUncertaintyNm = Math.max(
        turnUncertaintyNm,
        Math.max(...answers) - Math.min(...answers),
      );
    }
  }

  let stopToVertexMm: number;
  let designWavelengthNm: number;
  let poleOrder: "simple" | "double";
  if (placement.kind === "frontFocal") {
    designWavelengthNm = placement.wavelengthNm ?? LINE_D;
    if (!(designWavelengthNm > 0) || !Number.isFinite(designWavelengthNm)) {
      throw new Error("telecentricStop: the design wavelength must be positive and finite");
    }
    stopToVertexMm = ffd(designWavelengthNm);
    poleOrder = "simple";
  } else if (placement.kind === "turn") {
    const index = placement.index ?? 0;
    if (!Number.isInteger(index) || index < 0) {
      throw new Error("telecentricStop: the turn index must be a non-negative integer");
    }
    if (index >= turningPointsNm.length) {
      // A singlet's FFD is monotone and has none — which is § 6an's tail, and is
      // a fact about the GLASS, not about the request. Say which.
      //
      // **And do NOT say it is a fact about the united wavelengths**, which this
      // message did until § 6ay measured the opposite: the superachromatic
      // quadruplet unites four and is monotone across the visible, where the
      // achromatic doublet unites two and turns at 556 nm. What FFD(λ) turns on
      // is the ray-transfer element D, which the chromatic solve never touches.
      throw new Error(
        turningPointsNm.length === 0
          ? `telecentricStop: this tail's front focal distance has no turn in ${from}…${to} nm, so there is no double-root placement — FFD(λ) is monotone here. That is a fact about D and not about how many wavelengths the tail unites: a four-glass superachromat unites four and is monotone across the visible (§ 6ay)`
          : `telecentricStop: this tail has ${turningPointsNm.length} turn${turningPointsNm.length === 1 ? "" : "s"} in ${from}…${to} nm, so turn ${index} does not exist`,
      );
    }
    designWavelengthNm = turningPointsNm[index]!;
    stopToVertexMm = ffd(designWavelengthNm);
    poleOrder = "double";
  } else {
    stopToVertexMm = placement.stopToVertexMm;
    if (!Number.isFinite(stopToVertexMm)) {
      throw new Error("telecentricStop: the stop distance must be finite");
    }
    designWavelengthNm = LINE_D;
    poleOrder = "simple";
  }
  if (!Number.isFinite(stopToVertexMm)) {
    throw new Error(
      `telecentricStop: this tail has no front focal distance at ${designWavelengthNm} nm — it is afocal there, so no stop placement makes it telecentric`,
    );
  }

  /**
   * The crossings: where FFD(λ) equals the placement. A walk at 0.05 nm for the
   * sign changes — the fixtures' own step — and bisection inside each.
   *
   * A `"turn"` placement is a DOUBLE root and therefore has no sign change at
   * all, so a sign walk would report zero crossings on a system that is
   * telecentric there exactly. It is added from the placement rather than
   * searched for, which is honest about how it was obtained: the touched pole is
   * a construction, not a discovery.
   */
  const g = (nm: number): number => ffd(nm) - stopToVertexMm;
  const telecentricWavelengthsNm: number[] = [];
  let previous = g(from);
  for (let nm = from + 0.05; nm <= to; nm += 0.05) {
    const value = g(nm);
    if (previous * value < 0) telecentricWavelengthsNm.push(bisect(g, nm - 0.05, nm));
    previous = value;
  }
  /**
   * The same bisection from five brackets of different width around each
   * crossing, so the reported wavelengths carry the spread of the search that
   * found them rather than an implied exactness. § 6ar.8.
   */
  let crossingUncertaintyNm = 0;
  for (const nm of telecentricWavelengthsNm) {
    const answers: number[] = [];
    for (let k = 1; k <= 5; k++) {
      const half = 0.05 * k;
      const a = nm - half;
      const b = nm + half;
      if (a > from && b < to && g(a) * g(b) < 0) answers.push(bisect(g, a, b));
    }
    if (answers.length > 1) {
      crossingUncertaintyNm = Math.max(
        crossingUncertaintyNm,
        Math.max(...answers) - Math.min(...answers),
      );
    }
  }

  if (poleOrder === "double") telecentricWavelengthsNm.push(designWavelengthNm);
  telecentricWavelengthsNm.sort((a, b) => a - b);
  const poleOrders = telecentricWavelengthsNm.map((nm) =>
    poleOrder === "double" && nm === designWavelengthNm ? "double" : "simple",
  );

  // The tail's own stop flag is stripped: a bare objective's front vertex is its
  // own stop, but composed behind one it is not. `trace/system` takes the FIRST
  // flagged surface, so this is behaviour-preserving (§ 6ar.4).
  const tailSurfaces = surfaces.map(({ isStop: _isStop, ...s }): SurfaceSpec => s);

  const marginal = paraxialTrace(group, designWavelengthNm, { y: 1, u: 0 });
  const imageDistanceMm = spec.imageDistanceMm ?? -marginal.y / marginal.u;
  if (!Number.isFinite(imageDistanceMm)) {
    throw new Error("telecentricStop: imageDistanceMm must be finite");
  }

  const prescription: Prescription = {
    surfaces: [
      {
        kind: "refract",
        curvature: 0,
        semiAperture: stopSemiApertureMm,
        thickness: stopToVertexMm,
        medium: "AIR",
        isStop: true,
      },
      ...tailSurfaces.slice(0, -1),
      { ...tailSurfaces[tailSurfaces.length - 1]!, thickness: imageDistanceMm },
    ],
  };

  return {
    prescription,
    stopToVertexMm,
    designWavelengthNm,
    frontFocalDistanceMm: ffd(designWavelengthNm),
    telecentricWavelengthsNm,
    turningPointsNm,
    turnUncertaintyNm,
    crossingUncertaintyNm,
    poleOrder,
    poleOrders,
    bandNm: [from, to],
    imageDistanceMm,
  };
}
