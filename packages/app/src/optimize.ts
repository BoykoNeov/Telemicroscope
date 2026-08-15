import {
  optimizePrescription,
  seidelSums,
  solveParaxial,
  withVariable,
  withVariables,
  type DlsResult,
  type DlsStopReason,
  type OptimizeOperand,
  type SolveVariable,
} from "@telemicroscope/core/analysis";
import { systemProperties, type Prescription } from "@telemicroscope/core/trace";
import { abbeNumber, getMedium, LINE_C, LINE_D, LINE_F } from "@telemicroscope/core/materials";
import { refractorPair } from "@telemicroscope/core/designs";
import { AppRefusal, refusalOf, type Refusal } from "./refusal";

/**
 * Design mode's second half on a screen — "what is the best I can do?" —
 * drawing `core/analysis/optimize` (VALIDATION § 1.8), which had **no caller
 * anywhere in `packages/app`** until this file, exactly as `analysis/solve` had
 * none until Part M.
 *
 * ## What is different from Part M, and it is not the variable count
 *
 * Part M asks a question with an answer: one property, one number to move, a
 * root. This asks a question with no answer — several wishes, fewer freedoms
 * than wishes in general, and what comes back is a **compromise**. Three
 * consequences shape the whole surface:
 *
 *  1. **The leftover error is part of the answer**, not a diagnostic. § 1.8's
 *     sharpest rung is a run that stops with its convergence test satisfied
 *     while sitting 400 mm from the target, so this panel prints the stop reason
 *     and every wish's leftover in the SAME block. Reading either alone is how
 *     you get fooled.
 *  2. **The weights are an input**, because where the wishes cannot all be met
 *     the answer moves with them and no physics fixes the exchange rate between
 *     a millimetre and a diopter.
 *  3. **There is no `roots` array.** A scan reports every solution in an
 *     interval; a descent reports the basin it started in. So the panel runs a
 *     second start and says whether it agreed.
 *
 * ## The headline is Part M's own finding, answered
 *
 * Part M measured that retargeting the app's achromat through ONE curvature
 * spends the colour correction the lens exists for — 29× the F-to-C spread at
 * 400 mm. That number is recomputed here rather than quoted, beside the same
 * retarget through TWO curvatures with the colour as a second wish, which holds
 * the focal length exactly and leaves the spread at 5.7e-14 mm. One number
 * against two, on the same lens, at the same target.
 *
 * **And the two-variable answer is a thing § 5j.2 deliberately refused to
 * build.** That step solves the crown/flint split from the thin-lens closed form
 * and imposes it on a thick doublet, leaving a residual F−C spread in on
 * purpose: solving the split numerically until the thick lens united F and C
 * would have made its headline chromatic rung true by construction and worth
 * nothing. This panel does exactly that numerical solve — and it is right to,
 * because it is *designing* rather than *validating*. Same computation, opposite
 * verdict, and which one you are doing is the whole difference.
 *
 * ## The trail is a replay, not a reconstruction
 *
 * The convergence plots come from running the optimiser again with the iteration
 * cap set to 1, 2, 3 … The algorithm is deterministic, so a capped run IS the
 * longer run's prefix — measured in `test/optimize.test.ts`, on every field the
 * result carries, not just on the answer. Two things follow for reading the
 * plot: the x axis is **work** rather than progress, because a rejected step
 * consumes an iteration and moves nothing (the first fixture in § 1.8 spends
 * five of them raising the damping before it moves at all), and the cost of the
 * trail is quadratic in the iteration count — which is affordable only because
 * every residual here is a paraxial trace.
 */

/** The lines a lens is quoted at, matching `design.ts`. */
export const OPTIMIZE_LINES: readonly { readonly nm: number; readonly name: string }[] = [
  { nm: LINE_F, name: "F (blue)" },
  { nm: LINE_D, name: "d (yellow)" },
  { nm: LINE_C, name: "C (red)" },
];

export type OptimizeSeedId = "retarget" | "split" | "bestform" | "currency";

/**
 * What the merit is allowed to want.
 *
 * `focal` is deliberately not `efl`: which currency a focal-length wish is
 * asked in is the panel's central control, so the wish names the *quantity* and
 * the spec names the units it is asked in. The others have only one sensible
 * currency each.
 */
export type WishKind = "focal" | "colour" | "spherical" | "bfd";

export interface Wish {
  readonly kind: WishKind;
  readonly label: string;
  /** The unit the target is stated in — what the number on screen means. */
  readonly unit: string;
  readonly target: number;
  readonly weight: number;
  /** Prose for the wish's own line, saying what it is asking for. */
  readonly note: string;
}

/** How a focal-length wish is put to the optimiser. See the header. */
export type Currency = "power" | "focal";

export type ReferenceKind = "thin-split" | "best-form";

export interface OptimizeSeed {
  readonly id: OptimizeSeedId;
  readonly label: string;
  readonly note: string;
  readonly prescription: Prescription;
  readonly variables: readonly SolveVariable[];
  readonly variableLabels: readonly string[];
  readonly variableUnits: readonly string[];
  readonly wishes: readonly Wish[];
  /** Held fixed across the whole optimisation — S_I carries h⁴. */
  readonly marginalHeightMm: number;
  /**
   * Which variable Part M's single-number question would move, and where it
   * would look. `null` where the comparison is not the seed's point.
   */
  readonly singleVariable: {
    readonly index: number;
    readonly interval: readonly [number, number];
  } | null;
  readonly reference: ReferenceKind | null;
}

const REFRACTOR_FOCAL_MM = 500;
const REFRACTOR_SEMI_APERTURE_MM = 25;
const CROWN = "N-BK7";
const FLINT = "F2";

/** Part M's interval rule, and the same caveat: it is a convenience, not physics. */
function spreadInterval(x0: number, floor: number): readonly [number, number] {
  const half = Math.max(3 * Math.abs(x0), floor);
  return [x0 - half, x0 + half];
}

/** § 1.8's zero-thickness cemented doublet, where the classical split is exact. */
export function thinDoublet(c1: number, c2: number, c3: number): Prescription {
  return {
    surfaces: [
      { kind: "refract", curvature: c1, semiAperture: 25, thickness: 0, medium: CROWN, isStop: true },
      { kind: "refract", curvature: c2, semiAperture: 25, thickness: 0, medium: FLINT },
      { kind: "refract", curvature: c3, semiAperture: 25, thickness: 100, medium: "AIR" },
    ],
  };
}

/** The cemented face the split seed holds fixed, so the two outer faces carry it. */
export const SPLIT_CEMENTED_CURVATURE = -1 / 60;

/** § 1.8's currency fixture: a doublet 76.5 mm NEGATIVE, asked for +150. */
function currencySeedPrescription(): Prescription {
  return {
    surfaces: [
      { kind: "refract", curvature: 0.002, semiAperture: 25, thickness: 4, medium: CROWN, isStop: true },
      { kind: "refract", curvature: -1 / 60, semiAperture: 25, thickness: 3, medium: FLINT },
      { kind: "refract", curvature: 0.02, semiAperture: 25, thickness: 100, medium: "AIR" },
    ],
  };
}

export function optimizeSeeds(): readonly OptimizeSeed[] {
  const pair = refractorPair(REFRACTOR_FOCAL_MM, REFRACTOR_SEMI_APERTURE_MM, REFRACTOR_FOCAL_MM);
  const achromat = pair.achromat;
  const singlet = pair.singlet;

  return [
    {
      id: "retarget",
      label: "the app's achromat, retargeted",
      note: "Part M's own finding, answered: one curvature hits the focal length and spends the colour correction, and this is the same move with the correction as a second wish",
      prescription: achromat,
      variables: [
        { kind: "curvature", surface: 0 },
        { kind: "curvature", surface: 2 },
      ],
      variableLabels: ["crown front curvature", "flint back curvature"],
      variableUnits: ["1/mm", "1/mm"],
      wishes: [
        {
          kind: "focal",
          label: "focal length",
          unit: "mm",
          target: 400,
          weight: 1,
          note: "where the retarget is going — 500 mm as shipped",
        },
        {
          kind: "colour",
          label: "colour, F − C",
          unit: "1/mm",
          target: 0,
          weight: 1,
          note: "the achromatic condition, stated in the currency it is linear in: the F and C powers equal",
        },
      ],
      marginalHeightMm: REFRACTOR_SEMI_APERTURE_MM,
      singleVariable: { index: 0, interval: spreadInterval(achromat.surfaces[0]!.curvature, 0.005) },
      reference: null,
    },
    {
      id: "split",
      label: "§ 1.8's thin cemented doublet",
      note: "zero thickness, so the classical crown/flint power split is EXACT here — the fixture the ladder pins the optimiser on, with the textbook answer printed beside it",
      prescription: thinDoublet(0.01, SPLIT_CEMENTED_CURVATURE, -0.01),
      variables: [
        { kind: "curvature", surface: 0 },
        { kind: "curvature", surface: 2 },
      ],
      variableLabels: ["crown front curvature", "flint back curvature"],
      variableUnits: ["1/mm", "1/mm"],
      wishes: [
        {
          kind: "focal",
          label: "focal length",
          unit: "mm",
          target: 100,
          weight: 1,
          note: "the total power both elements have to add up to",
        },
        {
          kind: "colour",
          label: "colour, F − C",
          unit: "1/mm",
          target: 0,
          weight: 1,
          note: "φ₁/V₁ + φ₂/V₂ = 0 exactly, on a lens of no thickness",
        },
      ],
      marginalHeightMm: 25,
      singleVariable: null,
      reference: "thin-split",
    },
    {
      id: "bestform",
      label: "the singlet, bent for least spherical",
      note: "the same BK7 singlet the star panel compares against — power held by a weighted wish, shape free, and a textbook minimum to land near",
      prescription: singlet,
      variables: [
        { kind: "curvature", surface: 0 },
        { kind: "curvature", surface: 1 },
      ],
      variableLabels: ["front curvature", "back curvature"],
      variableUnits: ["1/mm", "1/mm"],
      wishes: [
        {
          kind: "focal",
          label: "focal length",
          unit: "mm",
          target: 500,
          weight: 1e4,
          note: "held by WEIGHT rather than by construction, which is why it is only held to O(1/w) — see the two gaps below",
        },
        {
          kind: "spherical",
          label: "spherical aberration, Σ S_I",
          unit: "mm",
          target: 0,
          weight: 1,
          note: "a singlet cannot reach zero, so this wish has a floor and the optimiser settles at the bottom of it — the mode that separates least squares from a root find",
        },
      ],
      marginalHeightMm: REFRACTOR_SEMI_APERTURE_MM,
      singleVariable: null,
      reference: "best-form",
    },
    {
      id: "currency",
      label: "§ 1.8's currency trap",
      note: "a doublet 76.5 mm NEGATIVE, asked for +150 mm — with an afocal configuration in between, which is a barrier in one currency and nothing at all in the other",
      prescription: currencySeedPrescription(),
      variables: [{ kind: "curvature", surface: 2 }],
      variableLabels: ["flint back curvature"],
      variableUnits: ["1/mm"],
      wishes: [
        {
          kind: "focal",
          label: "focal length",
          unit: "mm",
          target: 150,
          weight: 1,
          note: "the whole seed: switch the currency control and watch the same wish become unreachable",
        },
      ],
      marginalHeightMm: 25,
      singleVariable: null,
      reference: null,
    },
  ];
}

export const OPTIMIZE_SEEDS = optimizeSeeds();

export const optimizeSeedById = (id: OptimizeSeedId): OptimizeSeed =>
  OPTIMIZE_SEEDS.find((s) => s.id === id) ?? OPTIMIZE_SEEDS[0]!;

export interface OptimizeSpec {
  readonly seed: OptimizeSeedId;
  /** Editable copies of the seed's wishes, in the seed's order. */
  readonly wishes: readonly Wish[];
  readonly currency: Currency;
  /** How far the second start is moved, as a fraction of each variable. */
  readonly startOffset: number;
  readonly maxIterations: number;
}

export function defaultSpec(): OptimizeSpec {
  const seed = optimizeSeedById("retarget");
  return {
    seed: seed.id,
    wishes: seed.wishes,
    currency: "power",
    startOffset: 0.08,
    maxIterations: 100,
  };
}

/** The engine operand a wish becomes, in the currency the spec asked for. */
export function operandFor(wish: Wish, seed: OptimizeSeed, currency: Currency): OptimizeOperand {
  switch (wish.kind) {
    case "focal":
      return currency === "power"
        ? { kind: "power", wavelengthNm: LINE_D, target: 1 / wish.target, weight: wish.weight }
        : { kind: "efl", wavelengthNm: LINE_D, target: wish.target, weight: wish.weight };
    case "bfd":
      return { kind: "bfd", wavelengthNm: LINE_D, target: wish.target, weight: wish.weight };
    case "colour":
      return {
        kind: "chromaticPower",
        wavelengthsNm: [LINE_F, LINE_C],
        target: wish.target,
        weight: wish.weight,
      };
    case "spherical":
      return {
        kind: "seidelS1",
        wavelengthNm: LINE_D,
        marginalHeightMm: seed.marginalHeightMm,
        target: wish.target,
        weight: wish.weight,
      };
  }
}

/** What a wish is worth reading in: its own unit, never the merit's. */
export interface WishReadout {
  readonly label: string;
  readonly unit: string;
  readonly target: number;
  readonly value: number;
  /** value − target, UNWEIGHTED. The number that says whether it was granted. */
  readonly leftover: number;
  /** |leftover| ÷ |target|, or |leftover| against the starting value when the target is 0. */
  readonly relative: number;
  readonly weight: number;
  /** The unit the merit actually saw — mm for a focal wish asked in focal length. */
  readonly solvedUnit: string;
}

export interface TrailPoint {
  /** Iterations spent, accepted and rejected alike. */
  readonly work: number;
  readonly merit: number;
  readonly accepted: number;
  readonly rejected: number;
  readonly damping: number;
  /** |leftover| ÷ |target| per wish, in the wish's own unit. */
  readonly relative: readonly number[];
}

export interface LineReadout {
  readonly nm: number;
  readonly name: string;
  readonly eflMm: number;
  readonly bfdMm: number;
}

/** Part M's question, asked of the same lens for the same target. */
export interface SingleVariableComparison {
  readonly label: string;
  readonly from: number;
  readonly to: number;
  readonly eflMm: number;
  readonly spreadMm: number;
  /** How many times the starting lens's colour spread that is. */
  readonly spreadRatio: number;
  readonly refused: string | null;
}

export interface BasinControl {
  readonly offset: number;
  readonly agreed: boolean;
  readonly x: readonly number[];
  readonly merit: number;
  /** Largest relative disagreement across the variables. */
  readonly worstRelative: number;
  readonly refused: string | null;
}

/** The closed form this seed can be checked against, when it has one. */
export interface ReferenceReadout {
  readonly kind: ReferenceKind;
  readonly label: string;
  /** The textbook values, in the variables' own order where that makes sense. */
  readonly expected: readonly number[];
  readonly found: readonly number[];
  readonly note: string;
  /** For the best-form seed: shape factor, its textbook minimum, and the two gaps. */
  readonly shapeFactor?: number;
  readonly shapeFactorStar?: number;
  readonly gapHere?: number;
  readonly gapThin?: number;
  readonly thicknessMm?: number;
}

export type OptimizeStage = "build" | "optimise" | "trail" | "single" | "basin";

export interface OptimizeReadout {
  readonly seed: OptimizeSeed;
  readonly currency: Currency;
  readonly from: readonly number[];
  readonly to: readonly number[];
  readonly reason: DlsStopReason;
  readonly iterations: number;
  readonly accepted: number;
  readonly rejected: number;
  readonly evaluations: number;
  readonly damping: number;
  readonly gradient: number;
  readonly merit: number;
  readonly wishes: readonly WishReadout[];
  readonly trail: readonly TrailPoint[];
  readonly lines: readonly LineReadout[];
  /** The seed's own focal length at d, before anything moved. */
  readonly startEflMm: number;
  readonly spreadBeforeMm: number;
  readonly spreadAfterMm: number;
  readonly single: SingleVariableComparison | null;
  readonly basin: BasinControl;
  readonly reference: ReferenceReadout | null;
  /** True where the built lens has no first-order properties at all. */
  readonly builtIsAfocal: boolean;
  readonly elapsedMs: number;
}

export type OptimizeDescription =
  | ({ readonly ok: true } & OptimizeReadout)
  | Refusal<OptimizeStage>;

/** Most replays a trail is drawn from — see the note at the loop. */
export const TRAIL_MAX_POINTS = 48;

/**
 * The work levels a trail is replayed at: every one up to the cap, evenly
 * spaced above it, and always including 1 and the last.
 */
export function trailWorkLevels(iterations: number): readonly number[] {
  if (iterations <= TRAIL_MAX_POINTS) {
    return Array.from({ length: iterations }, (_, i) => i + 1);
  }
  const out = new Set<number>([1, iterations]);
  for (let i = 0; i < TRAIL_MAX_POINTS; i++) {
    out.add(1 + Math.round(((iterations - 1) * i) / (TRAIL_MAX_POINTS - 1)));
  }
  return [...out].sort((a, b) => a - b);
}

/** Where a variable currently sits in a prescription. */
function valueOf(prescription: Prescription, variable: SolveVariable): number {
  const s = prescription.surfaces[variable.surface]!;
  return variable.kind === "curvature" ? s.curvature : s.thickness;
}

/** A wish's quantity, read off a built lens in the wish's OWN unit. */
function readWish(prescription: Prescription, wish: Wish, seed: OptimizeSeed): number {
  switch (wish.kind) {
    case "focal":
      return systemProperties(prescription, LINE_D).efl;
    case "bfd":
      return systemProperties(prescription, LINE_D).bfd;
    case "colour":
      return (
        1 / systemProperties(prescription, LINE_F).efl - 1 / systemProperties(prescription, LINE_C).efl
      );
    case "spherical":
      return seidelSums(prescription, LINE_D, { marginalHeightMm: seed.marginalHeightMm }).s1;
  }
}

const colourSpread = (p: Prescription): number =>
  systemProperties(p, LINE_F).efl - systemProperties(p, LINE_C).efl;

/** The relative miss, with a sane denominator when the target is zero. */
function relativeMiss(leftover: number, target: number, scale: number): number {
  const denom = Math.abs(target) > 0 ? Math.abs(target) : Math.abs(scale) > 0 ? Math.abs(scale) : 1;
  return Math.abs(leftover) / denom;
}

export function describeOptimize(spec: OptimizeSpec): OptimizeDescription {
  const started = performance.now();
  const seed = optimizeSeedById(spec.seed);
  const wishes = spec.wishes.length === seed.wishes.length ? spec.wishes : seed.wishes;

  for (const w of wishes) {
    if (!Number.isFinite(w.target)) {
      return refusalOf(
        new AppRefusal(`a ${w.label} target of ${w.target} is not something to ask for.`),
        "build",
      );
    }
    if (!(Number.isFinite(w.weight) && w.weight > 0)) {
      return refusalOf(
        new AppRefusal(
          `a weight of ${w.weight} on "${w.label}" is not an exchange rate — it has to be positive and finite.`,
        ),
        "build",
      );
    }
    if (w.kind === "focal" && w.target === 0) {
      return refusalOf(
        new AppRefusal(`a focal length of 0 mm is not a design target.`),
        "build",
      );
    }
  }

  const operands = wishes.map((w) => operandFor(w, seed, spec.currency));
  const from = seed.variables.map((v) => valueOf(seed.prescription, v));

  let result: DlsResult;
  try {
    result = optimizePrescription(seed.prescription, seed.variables, operands, {
      maxIterations: spec.maxIterations,
    });
  } catch (cause) {
    return refusalOf(cause, "optimise");
  }

  const built = withVariables(seed.prescription, seed.variables, result.x);
  let builtIsAfocal = false;
  try {
    systemProperties(built, LINE_D);
  } catch {
    builtIsAfocal = true;
  }

  // Every wish read back in its OWN unit off the built lens, rather than from
  // the merit's residual vector: a focal wish asked in power has a residual in
  // 1/mm, and "you are 400 mm short" is the sentence that means something.
  const wishReadouts: WishReadout[] = wishes.map((w) => {
    let value: number;
    try {
      value = readWish(built, w, seed);
    } catch {
      value = Number.NaN;
    }
    const startValue = (() => {
      try {
        return readWish(seed.prescription, w, seed);
      } catch {
        return Number.NaN;
      }
    })();
    const leftover = value - w.target;
    return {
      label: w.label,
      unit: w.unit,
      target: w.target,
      value,
      leftover,
      relative: relativeMiss(leftover, w.target, startValue),
      weight: w.weight,
      solvedUnit: w.kind === "focal" && spec.currency === "power" ? "1/mm" : w.unit,
    };
  });

  // The trail, by replay. Deterministic, so a capped run is the longer run's
  // prefix — pinned in this panel's test rather than assumed here.
  //
  // SAMPLED rather than every k, and the reason is the cost shape: a capped run
  // at k costs O(k), so walking every k is quadratic in the iteration count. A
  // hundred-iteration run is 40 ms drawn that way and 20 sampled, on a panel
  // that is otherwise 1–6 ms. The first and last work levels are always kept, so
  // the curve still starts where the design started and ends where it stopped.
  const trail: TrailPoint[] = [];
  try {
    for (const k of trailWorkLevels(result.iterations)) {
      const step = optimizePrescription(seed.prescription, seed.variables, operands, {
        maxIterations: k,
      });
      const at = withVariables(seed.prescription, seed.variables, step.x);
      trail.push({
        work: k,
        merit: step.merit,
        accepted: step.accepted,
        rejected: step.rejected,
        damping: step.damping,
        relative: wishes.map((w) => {
          try {
            return relativeMiss(readWish(at, w, seed) - w.target, w.target, readWish(seed.prescription, w, seed));
          } catch {
            return Number.NaN;
          }
        }),
      });
    }
  } catch (cause) {
    return refusalOf(cause, "trail");
  }

  const lines = OPTIMIZE_LINES.map((l): LineReadout => {
    try {
      const p = systemProperties(built, l.nm);
      return { nm: l.nm, name: l.name, eflMm: p.efl, bfdMm: p.bfd };
    } catch {
      return { nm: l.nm, name: l.name, eflMm: Number.NaN, bfdMm: Number.NaN };
    }
  });

  const spreadBeforeMm = colourSpread(seed.prescription);
  let spreadAfterMm: number;
  try {
    spreadAfterMm = colourSpread(built);
  } catch {
    spreadAfterMm = Number.NaN;
  }

  // Part M's question, on the same lens, for the same focal target — computed
  // rather than quoted, so the comparison cannot drift away from the panel that
  // first measured it.
  let single: SingleVariableComparison | null = null;
  const focalWish = wishes.find((w) => w.kind === "focal");
  if (seed.singleVariable !== null && focalWish !== undefined) {
    const variable = seed.variables[seed.singleVariable.index]!;
    const label = seed.variableLabels[seed.singleVariable.index]!;
    try {
      const s = solveParaxial(
        seed.prescription,
        variable,
        { kind: "efl", value: focalWish.target },
        LINE_D,
        { interval: seed.singleVariable.interval },
      );
      const one = withVariable(seed.prescription, variable, s.x);
      const spread = colourSpread(one);
      single = {
        label,
        from: valueOf(seed.prescription, variable),
        to: s.x,
        eflMm: systemProperties(one, LINE_D).efl,
        spreadMm: spread,
        spreadRatio: spreadBeforeMm === 0 ? Number.NaN : spread / spreadBeforeMm,
        refused: null,
      };
    } catch (cause) {
      single = {
        label,
        from: valueOf(seed.prescription, variable),
        to: Number.NaN,
        eflMm: Number.NaN,
        spreadMm: Number.NaN,
        spreadRatio: Number.NaN,
        refused: (cause as Error).message,
      };
    }
  }

  // The second start. Least squares reports a basin, and the only honest way to
  // say so on a screen is to run one.
  let basin: BasinControl;
  try {
    const moved = seed.variables.map((v, i) => {
      const x0 = from[i]!;
      return x0 === 0 ? spec.startOffset : x0 * (1 + spec.startOffset);
    });
    const nudged = withVariables(seed.prescription, seed.variables, moved);
    const again = optimizePrescription(nudged, seed.variables, operands, {
      maxIterations: spec.maxIterations,
    });
    let worst = 0;
    again.x.forEach((v, i) => {
      const a = result.x[i]!;
      const scale = Math.max(Math.abs(a), Math.abs(v), 1e-12);
      worst = Math.max(worst, Math.abs(v - a) / scale);
    });
    basin = {
      offset: spec.startOffset,
      agreed: worst < 1e-6,
      x: again.x,
      merit: again.merit,
      worstRelative: worst,
      refused: null,
    };
  } catch (cause) {
    basin = {
      offset: spec.startOffset,
      agreed: false,
      x: [],
      merit: Number.NaN,
      worstRelative: Number.NaN,
      refused: (cause as Error).message,
    };
  }

  let reference: ReferenceReadout | null = null;
  try {
    reference = referenceFor(seed, result, spec);
  } catch (cause) {
    return refusalOf(cause, "build");
  }

  return {
    ok: true,
    seed,
    currency: spec.currency,
    from,
    to: result.x,
    reason: result.reason,
    iterations: result.iterations,
    accepted: result.accepted,
    rejected: result.rejected,
    evaluations: result.evaluations,
    damping: result.damping,
    gradient: result.gradient,
    merit: result.merit,
    wishes: wishReadouts,
    trail,
    lines,
    startEflMm: (() => {
      try {
        return systemProperties(seed.prescription, LINE_D).efl;
      } catch {
        return Number.NaN;
      }
    })(),
    spreadBeforeMm,
    spreadAfterMm,
    single,
    basin,
    reference,
    builtIsAfocal,
    elapsedMs: performance.now() - started,
  };
}

/** Coddington's shape factor, from the two curvatures the panel just solved. */
export const shapeFactor = (c1: number, c2: number): number => (c1 + c2) / (c1 - c2);

/** The published best form for a thin lens in air, object at infinity. */
export const bestFormShapeFactor = (n: number): number => (2 * (n * n - 1)) / (n + 2);

function referenceFor(
  seed: OptimizeSeed,
  result: DlsResult,
  spec: OptimizeSpec,
): ReferenceReadout | null {
  if (seed.reference === null) return null;

  if (seed.reference === "thin-split") {
    const nCrown = getMedium(CROWN).n(LINE_D);
    const nFlint = getMedium(FLINT).n(LINE_D);
    const vCrown = abbeNumber(getMedium(CROWN));
    const vFlint = abbeNumber(getMedium(FLINT));
    const focal = spec.wishes.find((w) => w.kind === "focal")?.target ?? 100;
    const phi = 1 / focal;
    const phiCrown = (phi * vCrown) / (vCrown - vFlint);
    const phiFlint = (-phi * vFlint) / (vCrown - vFlint);
    return {
      kind: "thin-split",
      label: "the classical split, φ₁ = φ·V₁/(V₁−V₂)",
      expected: [
        SPLIT_CEMENTED_CURVATURE + phiCrown / (nCrown - 1),
        SPLIT_CEMENTED_CURVATURE - phiFlint / (nFlint - 1),
      ],
      found: result.x,
      note: "exact here because the elements have no thickness: both wishes reach zero together, so the answer does not depend on the weighting either",
    };
  }

  // best-form: the textbook minimum is a THIN-lens result, and this lens is not
  // thin. So the panel separates the two gaps rather than blaming the optimiser
  // for either: the same optimisation on a 1 nm version of the same lens.
  const n = getMedium(CROWN).n(LINE_D);
  const q = shapeFactor(result.x[0]!, result.x[1]!);
  const qStar = bestFormShapeFactor(n);
  const thickness = seed.prescription.surfaces[0]!.thickness;
  const thin: Prescription = {
    surfaces: [
      { ...seed.prescription.surfaces[0]!, thickness: 1e-6 },
      seed.prescription.surfaces[1]!,
    ],
  };
  const operands = spec.wishes.map((w) => operandFor(w, seed, spec.currency));
  const thinResult = optimizePrescription(thin, seed.variables, operands, {
    maxIterations: spec.maxIterations,
  });
  const qThin = shapeFactor(thinResult.x[0]!, thinResult.x[1]!);
  return {
    kind: "best-form",
    label: "Coddington's best form, q* = 2(n²−1)/(n+2)",
    expected: [qStar],
    found: [q],
    note: "a thin-lens result, so the gap on a real lens is mostly its thickness — the same solve on a 1 nm version of this lens is the control",
    shapeFactor: q,
    shapeFactorStar: qStar,
    gapHere: q / qStar - 1,
    gapThin: qThin / qStar - 1,
    thicknessMm: thickness,
  };
}
