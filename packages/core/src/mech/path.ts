import { getMedium } from "../materials/catalog";
import { PlaneLayer, stackApparentDistanceMm } from "../designs/coverslip";

/**
 * # The mechanical light path, and the budget over it
 *
 * ARCHITECTURE's `mech/` line is "data + rules; mechanical changes feed back
 * into optical spacings". This file is the rules half. The feedback itself is
 * `insert.ts`, and it is deliberately the *only* route from here into the
 * tracer: the mech layer never models an optical effect, it hands the engine
 * glass and lets the engine find the focus.
 *
 * ## What a part is
 *
 * A part occupies some length of the light path and may contain glass. That is
 * the whole model, and it is enough for the thing this layer exists to get
 * right, which is that **those two lengths are not the same number**.
 *
 * A star diagonal is the clean example. It occupies ~110 mm of light path, of
 * which ~40 mm is prism glass. Mechanically it consumes all 110. Optically the
 * glass pushes the focal plane back by t(n−1)/n ≈ t/3, so the chain behind it
 * gets ~13 mm of that back. A budget that counts glass as air is wrong by
 * Σ tᵢ(1 − 1/nᵢ) and wrong in the direction that says a train will not reach
 * focus when it will.
 *
 * ## Why the position of the glass is not a parameter
 *
 * In a beam converging at half-angle u, every ray crosses a plane plate at the
 * same angle wherever the plate sits along the axis — the pencil is a cone of
 * straight lines, and sliding a perpendicular plane along it does not change
 * the angles. So neither the focus shift nor the aberration depends on where in
 * the converging beam the glass is: only the mechanical fit does, and only
 * through the clear aperture the beam needs there. That is an exact statement,
 * not a small-angle one, and § 5u pins it by tracing the same glass at two
 * different gaps.
 *
 * It is what lets the whole chain's glass be flattened into one contiguous
 * stack, which is what `insert.ts` does.
 */

/** A glass layer in the light path: a thickness of a catalog medium. */
export interface GlassLayer {
  readonly thicknessMm: number;
  /** Catalog medium name — resolved at the wavelength in use, not stored as an index. */
  readonly medium: string;
}

/**
 * A part in the light path: how much of it the part occupies, and what glass is
 * inside that.
 *
 * `pathLengthMm` is the *light path*, entry face to exit face, which for a
 * diagonal is the folded path and not the housing's outside dimension. An
 * air-only part — a spacer, an extension tube, a mirror diagonal — simply has no
 * glass, and a mirror diagonal being air-only is the physical content of "a
 * mirror diagonal needs more back focus than a prism one".
 */
export interface MechPart {
  readonly name: string;
  /** Light path through the part (mm), entry face to exit face. */
  readonly pathLengthMm: number;
  /** The glass inside that path. Absent or empty ⇒ the part is air. */
  readonly glass?: readonly GlassLayer[];
}

const checkPart = (part: MechPart): void => {
  if (!(part.pathLengthMm >= 0)) {
    throw new Error(`mech: "${part.name}" has a negative light path`);
  }
  const glass = part.glass ?? [];
  for (const l of glass) {
    if (!(l.thicknessMm > 0)) {
      throw new Error(`mech: "${part.name}" has a glass layer of non-positive thickness`);
    }
  }
  const total = glass.reduce((a, l) => a + l.thicknessMm, 0);
  // Refused rather than clamped: glass longer than the path it sits in is a
  // transcription error in the part, and silently accepting it would put the
  // budget's sign in doubt exactly where this layer exists to get it right.
  if (total > part.pathLengthMm) {
    throw new Error(
      `mech: "${part.name}" carries ${total} mm of glass in a ${part.pathLengthMm} mm light path`,
    );
  }
};

/** Every glass layer in the chain, in order, with its index resolved. */
export function chainLayers(
  chain: readonly MechPart[],
  wavelengthNm: number,
): PlaneLayer[] {
  const layers: PlaneLayer[] = [];
  for (const part of chain) {
    checkPart(part);
    for (const l of part.glass ?? []) {
      layers.push({ thicknessMm: l.thicknessMm, n: getMedium(l.medium).n(wavelengthNm) });
    }
  }
  return layers;
}

/** Σ pathLengthMm — what the chain physically occupies (mm). */
export function mechanicalLengthMm(chain: readonly MechPart[]): number {
  let total = 0;
  for (const part of chain) {
    checkPart(part);
    total += part.pathLengthMm;
  }
  return total;
}

/**
 * How far the chain's glass pushes the focal plane back (mm): Σ tᵢ(1 − 1/nᵢ).
 *
 * Computed as Σtᵢ − Σtᵢ/nᵢ through § 6c's own plane stack rather than from a
 * formula written again here, so a mechanical train and a cover slip are the
 * same physics called from two places. `stackApparentDistanceMm(layers, 1)` is
 * Σ tᵢ/nᵢ exactly.
 */
export function glassFocusShiftMm(
  chain: readonly MechPart[],
  wavelengthNm: number,
): number {
  const layers = chainLayers(chain, wavelengthNm);
  const geometric = layers.reduce((a, l) => a + l.thicknessMm, 0);
  return geometric - stackApparentDistanceMm(layers, 1);
}

export interface BackFocusBudget {
  /** Σ pathLengthMm (mm). */
  readonly mechanicalLengthMm: number;
  /** Σ tᵢ (mm) — the geometric glass in the path. */
  readonly glassThicknessMm: number;
  /** Σ tᵢ(1 − 1/nᵢ) (mm) — what the glass hands back. */
  readonly focusShiftMm: number;
  /**
   * What the chain really costs out of the instrument's back focus (mm):
   * `mechanicalLengthMm − focusShiftMm`.
   */
  readonly consumedMm: number;
  /**
   * What a budget that counts glass as air says it costs (mm) — i.e. the
   * mechanical length. Carried explicitly so the divergence is a number on
   * screen rather than a caveat: this is the sum a spreadsheet gives you, and
   * § 5u measures how far from the traced truth it lands.
   */
  readonly naiveConsumedMm: number;
}

/**
 * The back-focus budget: the honest cost of a chain beside the naive one.
 *
 * Deliberately shaped like § 5t's tolerance budget, for the same reason — the
 * point of a budget is that it is a *sum of independently quoted numbers*, and
 * the interesting question is always where the sum stops predicting the honest
 * trace. Part B found its RSS budget diverged downward; this one diverges by an
 * amount that is exactly computable, which makes it the rarer case where the
 * budget can be *corrected* rather than merely bounded.
 */
export function backFocusBudget(
  chain: readonly MechPart[],
  wavelengthNm: number,
): BackFocusBudget {
  const layers = chainLayers(chain, wavelengthNm);
  const mech = mechanicalLengthMm(chain);
  const glassThicknessMm = layers.reduce((a, l) => a + l.thicknessMm, 0);
  const focusShiftMm = glassThicknessMm - stackApparentDistanceMm(layers, 1);
  return {
    mechanicalLengthMm: mech,
    glassThicknessMm,
    focusShiftMm,
    consumedMm: mech - focusShiftMm,
    naiveConsumedMm: mech,
  };
}

/**
 * A focuser: where it puts the focal plane with nothing inserted, and how far it
 * can move from there.
 *
 * `backFocusMm` is measured from the focuser's own reference face — the drawtube
 * end, or the flange a chain screws onto — at the zero position. Travel is
 * quoted about that zero because that is how a focuser is specified and how a
 * reach failure is actually diagnosed ("it bottoms out").
 */
export interface FocuserSpec {
  /** Reference face → focal plane at zero travel (mm). */
  readonly backFocusMm: number;
  /** Travel available toward the optics (mm ≥ 0). */
  readonly inwardTravelMm: number;
  /** Travel available away from the optics (mm ≥ 0). */
  readonly outwardTravelMm: number;
}

export interface FocusReach {
  /**
   * Travel the chain needs (mm), signed: positive racks *out*, away from the
   * optics. `backFocus + focusShift − mechanicalLength`.
   */
  readonly requiredTravelMm: number;
  /** Whether that lies inside the focuser's range. */
  readonly reaches: boolean;
  /**
   * How much travel is left over at the limit the chain pushes toward (mm).
   * Negative is the overshoot, which is the number a spacer or a shorter
   * adapter has to make up.
   */
  readonly marginMm: number;
  /** The same verdict computed by a budget that counts glass as air. */
  readonly naiveRequiredTravelMm: number;
  readonly naiveReaches: boolean;
  readonly budget: BackFocusBudget;
}

/**
 * Does the train reach focus?
 *
 * The chain places the sensor (or the eyepiece's field stop) at
 * `mechanicalLengthMm` from the reference face. The focal plane sits at
 * `backFocusMm + focusShiftMm`. The difference is the travel required, and the
 * two terms move in **opposite directions** when glass is added: a prism
 * diagonal lengthens the chain *and* pushes the focus back, and the second
 * partly pays for the first. A mirror diagonal only lengthens it.
 *
 * `naiveReaches` runs the same arithmetic with the glass counted as air, which
 * is what a parts-list spreadsheet does. When the two verdicts disagree, the
 * naive one is always the pessimistic one — it never invents reach that is not
 * there — and § 5u measures the size of the gap on a real diagonal.
 */
export function focusReach(
  focuser: FocuserSpec,
  chain: readonly MechPart[],
  wavelengthNm: number,
): FocusReach {
  if (!(focuser.inwardTravelMm >= 0) || !(focuser.outwardTravelMm >= 0)) {
    throw new Error("focusReach: focuser travel is a non-negative distance in each direction");
  }
  const budget = backFocusBudget(chain, wavelengthNm);
  const required = focuser.backFocusMm + budget.focusShiftMm - budget.mechanicalLengthMm;
  const naive = focuser.backFocusMm - budget.mechanicalLengthMm;
  const within = (t: number): boolean => t <= focuser.outwardTravelMm && t >= -focuser.inwardTravelMm;
  const margin =
    required > focuser.outwardTravelMm
      ? focuser.outwardTravelMm - required
      : required < -focuser.inwardTravelMm
        ? required + focuser.inwardTravelMm
        : Math.min(focuser.outwardTravelMm - required, required + focuser.inwardTravelMm);
  return {
    requiredTravelMm: required,
    reaches: within(required),
    marginMm: margin,
    naiveRequiredTravelMm: naive,
    naiveReaches: within(naive),
    budget,
  };
}

/**
 * The barrel length a parfocal standard implies (mm): shoulder to the
 * objective's first vertex.
 *
 * The objective's optics are already solved — `finiteConjugateObjective` gives
 * the glass its length and the specimen its distance in front. What the
 * *standard* adds is where the whole thing hangs: a DIN objective must put its
 * object plane 45.0 mm below the nosepiece shoulder, so
 *
 *     barrel = parfocal − (objectDistance + Σ thicknesses)
 *
 * and that is the mount the manufacturer builds. It is arithmetic, and it is
 * the arithmetic that makes a turret work: two objectives of different
 * magnification have different glass and different working distances, and the
 * barrel is what absorbs the difference so the specimen does not move when you
 * swap them.
 *
 * A negative result is a real refusal and not a numerical one — it says the
 * glass and its working distance do not fit inside the standard, which is a
 * *mechanical* ceiling on a design and the only kind this repo's catalogue has
 * not yet met.
 */
export function parfocalBarrelLengthMm(spec: {
  /** Shoulder → specimen (mm). One of `PARFOCAL_DISTANCE_MM`. */
  readonly parfocalDistanceMm: number;
  /** Objective front vertex → specimen (mm). */
  readonly objectDistanceMm: number;
  /** Front vertex → last vertex (mm) — the glass's own axial length. */
  readonly glassLengthMm: number;
}): number {
  const barrel =
    spec.parfocalDistanceMm - (spec.objectDistanceMm + spec.glassLengthMm);
  if (!(barrel >= 0)) {
    throw new Error(
      `parfocalBarrelLengthMm: the objective is ${(-barrel).toFixed(3)} mm too long for a ` +
        `${spec.parfocalDistanceMm} mm parfocal standard — the glass does not fit the mount`,
    );
  }
  return barrel;
}
