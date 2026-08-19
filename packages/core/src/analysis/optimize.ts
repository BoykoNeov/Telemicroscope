import { Prescription } from "../trace/prescription";
import { OpticalSystem } from "../trace/system";
import { paraxialTrace, systemProperties } from "../trace/paraxial";
import { asCompiled } from "../trace/compile";
import {
  householderLeastSquares,
  equalityConstrainedLeastSquares,
  singularSystem,
} from "../math/lsq";
import { PupilPoint } from "../pupil/aiming";
import { imagePlaneZ } from "../pupil/pupils";
import { opdMap } from "../pupil/opd";
import { fitZernike, fitRms, balancedRms, coefficient, MAX_ZERNIKE_TERMS } from "../wave/zernike";
import { systemPupil, psfFromSystemPupil } from "../wave/psf";
import { mtf, mtfAt, type Mtf } from "../wave/mtf";
import { exitBundle, spotAt, bestSpotZ } from "./spot";
import { seidelSums } from "./seidel";
import { withVariable, type SolveVariable } from "./solve";

/**
 * Damped least squares — the second half of design mode, and the third solver
 * in this engine.
 *
 * ## Why this is neither `focus.ts` nor `solve.ts`
 *
 * `focus.ts` minimises one merit over ONE variable and has no target.
 * `solve.ts` roots one property against a target over ONE variable. This
 * minimises a WEIGHTED SUM OF SQUARES over SEVERAL variables at once, and the
 * distinction that matters is not the variable count: it is that a design has
 * more things it wants than freedoms to want them with, so the answer is a
 * compromise rather than a solution. A root find either hits the target or
 * refuses. Least squares always lands somewhere, and where it lands depends on
 * the weights — which is why the units paragraph below is part of the API and
 * not decoration.
 *
 * The method is Levenberg–Marquardt: a Gauss–Newton step, damped by λ, with λ
 * raised when a step fails and lowered when it succeeds (Madsen, Nielsen &
 * Tingleff, *Methods for Non-Linear Least Squares Problems*, 2nd ed. 2004,
 * §3.2 — including their λ update through the gain ratio ρ). Lens design has
 * called the same algorithm "damped least squares" since Wynne (1959) and
 * Meiron (1965), and the damping is the whole reason it works on optics: a
 * Jacobian over curvatures and thicknesses is routinely near-singular, because
 * two parameters of a real lens very often do almost the same thing.
 *
 * **The damping is not insurance, it is load-bearing, and the module's own
 * headline fixture proves it.** Minimising a residual that never reaches zero —
 * a singlet's spherical aberration, which has a positive minimum at the best
 * shape — is a problem where undamped Gauss–Newton *cannot* converge: it solves
 * for r = 0 at every step, and near the optimum the derivative it divides by
 * goes to zero while the residual does not. λ turns that division into
 * J·r/(J² + λ), which vanishes exactly where the merit is stationary. § 1.8
 * measures both.
 *
 * ## The step is solved as an augmented least-squares problem, not by JᵀJ
 *
 *     min ‖ [    J     ] δ + [ r ] ‖²         D = diag(‖J_j‖²)  (Marquardt)
 *         ‖ [ √λ·D^½   ]     [ 0 ] ‖              or I          (Levenberg)
 *
 * which has the same solution as (JᵀJ + λD)δ = −Jᵀr and does not square the
 * condition number on the way there. `math/lsq` does the QR, and it is shared
 * with the Zernike fit for exactly this reason.
 *
 * One inherited detail worth stating, because this caller's columns carry units
 * the Zernike fit's do not: `math/lsq` zeroes a component whose R pivot falls
 * below **1e-12 absolute**, which is a scale-dependent floor. The damping is
 * what keeps it out of reach — the augmented pivot is at least √(λ·dⱼ), so a
 * column has to be dead in earnest, not merely small, before the floor decides
 * anything. § 1.8 pins that case: a variable the merit cannot see stays exactly
 * where it started rather than moving by noise or by a division.
 *
 * Marquardt's scaling — damping each variable in proportion to how strongly the
 * merit already responds to it — is the default because the alternative is
 * unit-dependent: a plain λI damps a curvature in 1/mm and a thickness in mm by
 * the same absolute amount, so the same λ means different things on the same
 * lens. § 1.8 measures the difference on a fixture whose two variables differ in
 * sensitivity by four orders of magnitude.
 *
 * ## Weights carry units, and nothing here can choose them for you
 *
 * The merit is Σᵢ (wᵢ·(vᵢ − tᵢ))², summed over operands that may be a power in
 * 1/mm, a distance in mm and a Seidel sum in mm at once. Adding those raw is
 * meaningless, so `weight` is how a caller states the exchange rate — how many
 * millimetres of back focus one diopter of power is worth — and there is no
 * physics that fixes it. This module therefore does not invent a default
 * normalisation: `weight` defaults to 1, and a caller who mixes units at weight
 * 1 has stated an exchange rate by accident rather than on purpose.
 *
 * The consequence worth knowing before designing a test around it: an optimum
 * with a nonzero residual MOVES when the weights move, so no external number can
 * pin it unless the weighting is part of the external statement. Both of § 1.8's
 * headline pins are weight-independent by construction — one has a single
 * operand, the other reaches zero on every operand at once — and that is not a
 * convenience of the fixtures. It is what makes them pinnable at all.
 *
 * ## …and a CONDITION is the thing that has no exchange rate
 *
 * `{ minimize, hold }` on either entry point makes the `hold` entries equality
 * constraints, met exactly rather than eventually. `dampedLeastSquares` below
 * documents the method; what belongs here is the boundary. A condition is not a
 * wish with a large weight, and § 1.8.6 measures what that is worth — which is
 * NOT the accuracy of the answer, the thing everyone (this file included)
 * expected. It is the condition itself, the multiplier that prices it, roughly
 * half the trial designs on a traced merit, and the absence of a weight whose
 * right value cannot be known before the run.
 *
 * The other direction of the same boundary: `solve.ts` roots ONE property with
 * ONE variable and reports every root it found. A condition here is a Newton
 * solve too, embedded in a minimisation, and it reports the basin it landed in
 * like everything else in this file. Where a single target has two roots, the
 * solve is the honest tool.
 *
 * ## Walls
 *
 * `solve.ts` states the convention this file keeps: a parameter value that is
 * not a system — an afocal configuration has no EFL, and the engine says so by
 * throwing — is a WALL rather than an error. Here a trial step that lands on one
 * is rejected and the damping rises, exactly as a step that increased the merit
 * would be; a wall inside a finite-difference stencil is stepped around by
 * differencing on the other side; and a wall at the STARTING point is a throw,
 * because there is nothing to be damped away from.
 *
 * ## Traced operands, and the one thing that actually threatens them
 *
 * `optimizePrescription` takes a prescription, which is all a paraxial or
 * third-order operand needs. A traced one needs a SYSTEM — an aperture, a field,
 * a conjugate — so it gets its own entry point, `optimizeSystem`, rather than a
 * widened signature on the one every existing rung is validated through.
 *
 * The forecast this file carried until § 1.8.5 was that a traced merit would be
 * hard to difference because it "carries sampling noise". **Measured, that is
 * wrong, and wrong about the mechanism rather than the size.** Against a FIXED
 * set of pupil points the traced RMS spot is an ordinary smooth function of the
 * design: the central-difference estimate is stable to five significant figures
 * across nine decades of step, h = 10⁻¹¹ … 10⁻², and the floor below that is f64
 * rounding on the merit itself (~10⁻¹⁵ mm on a 2.7·10⁻² mm spot), not sampling.
 * The module's default step sits in the middle of that plateau. Nothing here
 * needed changing for a traced residual to be differenced.
 *
 * What DOES threaten it is a discontinuity, and there is exactly one: **a ray
 * entering or leaving the surviving set.** `exitBundle` drops what vignettes and
 * `spotAt` divides by the survivors, so the merit is an average over a set whose
 * MEMBERSHIP is design-dependent. Measured on a rim placed where a bending walks
 * the beam across it: four rays of 149 rejoin, and the merit jumps 6.31% across a
 * step of 10⁻¹² in the variable — a difference quotient of order 10¹⁰ where the
 * true derivative is 10⁻⁴. That cliff sat 8·10⁻⁵ from the optimum being sought.
 *
 * So a traced operand **holds its survivor set**, recorded at the starting point,
 * and a trial design whose set differs is not a system. This is `seidelS1`'s
 * fixed `marginalHeightMm` one level up — a ray height that moved with the design
 * would change the merit for reasons that are not the design, and a ray COUNT
 * that moves is the same defect. The consequence is deliberate and pinned rather
 * than left to be discovered: an optimum on the far side of a dropout boundary is
 * unreachable, and the run says so by stopping on damping with its residual
 * reported, not by walking through the cliff.
 *
 * The same argument decides the aperture: the sample set is only fixed if the
 * pupil is. `stopRadius` states a radius outright; `fNumber`, `imageNA` and
 * `objectNA` DERIVE one from the design, so the pupil breathes as the variables
 * move and the operand is no longer measuring one set of rays. Measured on the
 * singlet fixture, `fNumber` drifts the stop radius 50.042 → 49.850 across the
 * shapes an optimiser visits and moves the answer by 2.0·10⁻³ in shape factor —
 * the same size as the whole thick-lens offset the step is measuring. Held-pupil
 * aperture kinds are the contract; the rest are a different question, honestly
 * asked, and not this one.
 *
 * ## …and the wavefront, which is the same machinery and a different hazard
 *
 * § 1.8.7 adds `WavefrontCondition`: the same held rays, read as a phase map
 * through `opdMap` and `fitZernike` instead of as a scatter of intercepts. The
 * survivor hold is one mechanism over two producers, and the fit turns out to
 * settle its own recorded worry rather than raise a new one (see the type's own
 * comment). Costed on the same 313 rays it is 4.1× a traced spot and 296× a
 * third-order sum.
 *
 * The hazard it does bring is the focus convention again, and worse. `"rms"` is
 * bounded; `"balancedRms"` removes the defocus term and thereby lets the merit
 * exploit the reference sphere's radius, which no longer measures the design —
 * so it converges, confidently, on a plane where the image has been destroyed.
 * The type comment carries the numbers.
 *
 * ## …and the MTF, which is the one that is not safe on its own
 *
 * § 1.8.8 adds `MtfCondition`: the same pupil again, transformed. It is the only
 * operand here whose merit is genuinely MULTIMODAL, and not by a convention that
 * could be chosen differently — contrast at a frequency is |OTF| and the OTF
 * changes sign, so a thoroughly ruined design can read the same contrast as a
 * perfect one at that frequency. Measured: 2.31 waves RMS, Strehl 0.0075, and a
 * modulation 2.8·10⁻⁴ from the perfect system's. A run started outside the basin
 * lands there and reports 7.7·10⁻⁸.
 *
 * Two consequences a caller has to be told rather than left to meet. **The
 * diffraction-limited closed form is not a reachable target** — a sampled pupil
 * over-counts its own edge, so the engine reads 0.66/`pupilSamples` above it on
 * a perfect design, and the reachable target is the engine's own ceiling at the
 * stated sampling. **And one frequency is not a merit**: a second one separates
 * the impostor from the answer by three orders and widens the basin, without
 * abolishing the multimodality. It is also ~7 000× a third-order sum, which is
 * the first thing in this file the retired "four orders" forecast is true of.
 */

/** How the step is damped. */
export type DampingScaling =
  /** λ·diag(‖J_j‖²) — scale-free, and the default. */
  | "marquardt"
  /** λ·I — damps every variable by the same absolute amount, in its own unit. */
  | "levenberg";

/** How the Jacobian is differenced. */
export type JacobianScheme =
  /** (r(x+h) − r(x−h))/2h — O(h²), two evaluations per variable. Default. */
  | "central"
  /** (r(x+h) − r(x))/h — O(h), one evaluation per variable. */
  | "forward";

/** Why the iteration stopped. */
export type DlsStopReason =
  /**
   * The KKT test passed: ‖Jᵀr‖ fell below `gradientTolerance`, measured
   * scale-free, and — under constraints — the part of it the conditions do not
   * account for did, with the conditions themselves met. The optimum.
   */
  | "gradient"
  /** The step got shorter than `stepTolerance` — the variables stopped moving. */
  | "step"
  /** An accepted step changed the merit by less than `meritTolerance`. */
  | "merit"
  /** `maxIterations` used up. Not a converged answer, and says so. */
  | "iterations"
  /** λ grew past every scale in the problem: every step, however short, failed. */
  | "damping"
  /**
   * The conditions stopped being independent of one another *during* the run —
   * two that ask the same thing of the design, or one no variable can move any
   * more. Damping cannot mend it, because the defect is in the conditions
   * rather than in the step, so the run says so at once instead of raising λ
   * against a step it can never compute. At the STARTING design the same
   * defect throws, as every other caller error here does.
   */
  | "conditions";

export interface DlsOptions {
  /** Default 100. Counts accepted and rejected steps alike. */
  readonly maxIterations?: number;
  /**
   * Initial λ. Default 1e-3, which is Marquardt's own suggestion and is a
   * RELATIVE damping under the default scaling — the absolute amount added to
   * each diagonal is λ·‖J_j‖², so it carries the variable's units for you.
   */
  readonly initialDamping?: number;
  /** Default `"marquardt"`. */
  readonly scaling?: DampingScaling;
  /** Default `"central"`. */
  readonly jacobian?: JacobianScheme;
  /**
   * Absolute finite-difference step per variable. Default: εʰ·max(|xⱼ|, scale),
   * with h = 1/2 for forward differences and 1/3 for central — the exponents
   * that balance truncation against cancellation for each scheme.
   *
   * `scale` is **1** here, and here it is a unit assumption: `dampedLeastSquares`
   * and `meritResponse` are handed a residual function and have no way to ask
   * what a variable measures, so 1 is the only honest floor for a variable that
   * starts at exactly 0. State the steps when that is wrong.
   *
   * All four OPTICAL entry points — `optimizePrescription`, `optimizeSystem`,
   * `variableResponse`, `systemResponse` — do know, and fill this in from the
   * prescription when a caller states nothing: see `designSteps` and § 1.8.11.
   * A thickness keeps `max(|t|, 1)` to the bit; a curvature is scaled by its
   * surface's own semi-aperture instead, which is worth up to 2·10³ in the
   * located answer. Stating `steps` overrides that, exactly as before.
   *
   * Only TWO of the four can actually reach that scale, and the type system is
   * what says so: `optimizePrescription` and `variableResponse` take
   * `OptimizeOperand`/`HeldOperand`, which is paraxial and third-order kinds and
   * nothing else, so `operands.some(isTraced)` is false at every call and the
   * array they fill in is the old rule's values bitwise. They still go through
   * the same function rather than around it, so a traced operand becoming legal
   * there would carry the rule with it instead of quietly keeping this floor.
   * That is also the whole reason § 1.8.9's conditioning family did not move.
   */
  readonly steps?: readonly number[];
  /**
   * Stop when max_j |(Jᵀr)_j| / (‖J_j‖·‖r‖) ≤ this. Default 1e-12.
   *
   * The quotient is the cosine between the residual vector and each Jacobian
   * column, so the criterion is scale-free: it does not change if a weight, a
   * unit or the whole merit is multiplied by a constant. An absolute ‖Jᵀr‖
   * threshold would, which is why this one is not that.
   */
  readonly gradientTolerance?: number;
  /** Stop when ‖δ‖ ≤ this·(‖x‖ + this). Relative. Default 1e-14. */
  readonly stepTolerance?: number;
  /** Stop when an ACCEPTED step changes the merit by less than this, relatively. Default 1e-15. */
  readonly meritTolerance?: number;
  /**
   * How nearly a condition must be met before the KKT test may report an
   * optimum. Default 1e-14, and — like `gradientTolerance` — it is applied to a
   * scale-free quantity rather than to the violation itself: |cₖ| / (‖Cₖ‖·(‖x‖+1)),
   * which is how far the variables would have to move to meet condition k,
   * relative to how large they are. A violation in 1/mm and a violation in mm
   * are otherwise not comparable numbers, and a tolerance that compared them
   * would mean something different on every merit.
   */
  readonly constraintTolerance?: number;
}

export interface DlsResult {
  /** The variable values at the stopping point. */
  readonly x: readonly number[];
  /** The residual vector there — weights already applied. */
  readonly residuals: readonly number[];
  /**
   * Σ rᵢ², the merit — the WISHES only. A condition is not part of the merit,
   * which is the whole distinction: a merit is a compromise and a condition is
   * not up for compromise, so the number a caller compares between two designs
   * must not include it. Empty conditions leave this exactly as it was.
   */
  readonly merit: number;
  /** Iterations run: accepted + rejected. */
  readonly iterations: number;
  /** Steps that lowered the merit and were kept. */
  readonly accepted: number;
  /** Steps that raised it, or landed on a wall, and were undone. */
  readonly rejected: number;
  /** Residual-vector evaluations, Jacobian differencing included. */
  readonly evaluations: number;
  /** λ at the stopping point. */
  readonly damping: number;
  /** The scale-free gradient measure at the stopping point. */
  readonly gradient: number;
  readonly reason: DlsStopReason;
  /**
   * The conditions' own residuals, vₖ − tₖ, at the stopping point — in each
   * condition's own unit, unweighted, because a condition has no weight.
   * Empty when there are none.
   */
  readonly constraints: readonly number[];
  /**
   * The Lagrange multipliers, from ∇(Σrᵢ²) + Cᵀλ = 0 solved in least squares at
   * the stopping point.
   *
   * λₖ is **the price of the condition**: d(merit\*)/dtₖ = −λₖ, the rate at
   * which the best merit reachable would improve if condition k's target were
   * moved. That is the envelope theorem, and it is what makes a multiplier
   * worth reporting rather than an internal — a designer who is told "holding
   * the focal length is costing you this much aberration per millimetre" has
   * been told something the merit alone cannot say. Sign: with the condition
   * written vₖ − tₖ = 0, a POSITIVE λₖ means raising the target lowers the
   * merit.
   *
   * Meaningful only where the run actually converged; at a stop on
   * `iterations` it is the multiplier of a point that is not the optimum.
   */
  readonly multipliers: readonly number[];
  /**
   * The worst condition violation at the stopping point, measured the
   * scale-free way `constraintTolerance` documents. 0 when unconstrained.
   */
  readonly feasibility: number;
}

/**
 * What a merit hands back: the wishes, and — where there are any — the
 * conditions, in one call.
 *
 * One call rather than two functions, because on a traced merit the expensive
 * part is building the trial system, and `evaluations` is a number this module
 * reports and callers plot. Two entry points would double both.
 */
export type MeritVector =
  | readonly number[]
  | {
      /** Residuals to be squared and summed — already weighted, already target-subtracted. */
      readonly minimize: readonly number[];
      /** Conditions to be driven to exactly zero. Unweighted, and not part of the merit. */
      readonly hold: readonly number[];
    };

/** One evaluation: the wishes' residuals and the conditions' violations. */
type Evaluated = { readonly r: Float64Array; readonly c: Float64Array };

/** `residuals` with the wall convention applied: `null` means "not a system". */
type Guarded = (x: Float64Array) => Evaluated | null;

const NO_CONSTRAINTS: readonly number[] = [];

/** How short the restoration fraction θ may get before shortening it is noise. */
const THETA_FLOOR = 2 ** -30;

function splitMerit(v: MeritVector): { w: readonly number[]; h: readonly number[] } {
  if (Array.isArray(v)) return { w: v as readonly number[], h: NO_CONSTRAINTS };
  const both = v as { minimize: readonly number[]; hold: readonly number[] };
  return { w: both.minimize, h: both.hold };
}

/**
 * A residual function with the wall convention applied and the bookkeeping the
 * callers share: how many wishes and conditions the vector turned out to hold,
 * and what it has cost so far.
 *
 * Written once because the wall convention IS the contract between this module
 * and a merit — `null` for a trial that is not a system, and a length that may
 * not change under the caller's feet — and a second copy of a contract is a
 * contract that will differ from itself.
 */
interface Evaluator {
  at: Guarded;
  /** Wishes in the vector; −1 before the first evaluation. */
  m: number;
  /** Conditions in it; −1 before the first. */
  p: number;
  evaluations: number;
}

function makeEvaluator(
  where: string,
  residuals: (x: readonly number[]) => MeritVector,
): Evaluator {
  const e: Evaluator = { at: () => null, m: -1, p: -1, evaluations: 0 };
  e.at = (x) => {
    e.evaluations++;
    let out: MeritVector;
    try {
      out = residuals(Array.from(x));
    } catch {
      return null;
    }
    const { w, h } = splitMerit(out);
    if (e.m < 0) e.m = w.length;
    else if (w.length !== e.m) {
      throw new Error(`${where}: the residual vector changed length, ${e.m} → ${w.length}`);
    }
    if (e.p < 0) e.p = h.length;
    else if (h.length !== e.p) {
      throw new Error(`${where}: the condition vector changed length, ${e.p} → ${h.length}`);
    }
    const r = new Float64Array(e.m);
    for (let i = 0; i < e.m; i++) {
      const v = w[i]!;
      if (!Number.isFinite(v)) return null;
      r[i] = v;
    }
    const c = new Float64Array(e.p);
    for (let k = 0; k < e.p; k++) {
      const v = h[k]!;
      if (!Number.isFinite(v)) return null;
      c[k] = v;
    }
    return { r, c };
  };
  return e;
}

/**
 * One variable's automatic step: εʰ times the MAGNITUDE it is differenced
 * against — its own value, or `scale` where that is larger.
 *
 * Written once because there are two callers with two different scales, and a
 * second spelling of this expression is a second answer to "what did the
 * Jacobian actually see". `differenceSteps` passes scale = 1, the kind-blind
 * unit assumption; `designSteps` passes the surface's own (see § 1.8.11).
 */
function autoStep(scheme: JacobianScheme, x: number, scale: number): number {
  const eps = scheme === "central" ? Math.cbrt(Number.EPSILON) : Math.sqrt(Number.EPSILON);
  return eps * Math.max(Math.abs(x), scale);
}

/** Each variable's difference step: the caller's, or the scheme's own scale rule. */
function differenceSteps(
  where: string,
  x: Float64Array,
  scheme: JacobianScheme,
  given: readonly number[] | undefined,
): Float64Array {
  const n = x.length;
  if (given !== undefined && given.length !== n) {
    throw new Error(`${where}: ${given.length} finite-difference steps for ${n} variables`);
  }
  const step = new Float64Array(n);
  for (let j = 0; j < n; j++) {
    const s = given?.[j] ?? autoStep(scheme, x[j]!, 1);
    if (!(s > 0 && Number.isFinite(s))) {
      throw new Error(`${where}: variable ${j}'s difference step ${s} is not positive`);
    }
    step[j] = s;
  }
  return step;
}

/**
 * The steps an OPTICAL entry point differences with, when the caller stated
 * none — the one place in this module that knows what a variable measures and
 * can therefore give it a scale instead of a unit assumption (§ 1.8.11).
 *
 * A **thickness** keeps `max(|t|, 1)` unchanged, to the bit. It is a length in
 * millimetres and the engine's geometry unit is a millimetre, so the floor is a
 * statement in the variable's own units.
 *
 * A **curvature on a merit that TRACES** does not have that. 1 mm⁻¹ is a 1 mm
 * radius, which no surface in this engine has ever had, so the floor of 1 was
 * never the curvature's own scale — it was three orders above it, and a
 * curvature of 2.5·10⁻³ was being differenced over a quarter of a percent of
 * itself. The scale used instead is **1/a**, the reciprocal of the surface's own
 * semi-aperture, because that is the number that turns a curvature into a
 * length: a step h moves the rim sag by h·a²/2, so h = ∛ε/a moves it by ∛ε·a/2 —
 * a fixed fraction of the aperture, at every aperture. The old floor moved it by
 * ∛ε·a²/2, which grows with the aperture SQUARED and reaches 15 mm of radius on
 * a 160 mm mirror. Worth up to 2·10³ in the located answer.
 *
 * **And `traces` is a real condition, not a hedge.** A paraxial or third-order
 * operand is a closed form in f64, exactly LINEAR in a curvature, so its column
 * carries no truncation error at all and every decade of step is a decade less
 * cancellation: measured on the thin-singlet power column, ∛ε·1 reads (n−1) to
 * 9.8·10⁻¹⁴ and ∛ε/25 to 2.7·10⁻¹², a factor 27 that grows straight with the
 * aperture. A traced operand has the opposite shape — a 2·10⁻¹² floor on the
 * OPD and a merit that really bends — so the two families want opposite steps
 * and the merit says which it is. A merit that mixes them takes the traced rule,
 * because a merit's floor is the worst of its parts.
 *
 * The `max(|C|, 1/a)` in `autoStep` is not decoration. |C| > 1/a cannot happen
 * to the GLASS — the rim would be further from the axis than the sphere's own
 * radius, so the surface never reaches it — but it happens easily to a
 * PRESCRIPTION, which declares a rim it does not have to fill. A generous
 * `semiAperture` beside a small stop is the ordinary way to write "do not clip
 * this", and 1/a off a 10⁵ mm declared rim is 10⁻⁵ of the curvature it is meant
 * to scale. The max is the guard against a declared aperture that is a
 * statement about clipping rather than a length the surface has.
 *
 * **`semiAperture: Infinity` is shipped** — coverslips, immersion gaps and the
 * microscope's plates all declare it — so an unbounded surface takes the widest
 * bounded semi-aperture in the same prescription, and a prescription with no
 * bounded surface anywhere falls back to the kind-blind 1. Both branches are
 * pinned, because a branch the default does not take is where a shipped claim
 * hides.
 */
function designSteps(
  prescription: Prescription,
  variables: readonly SolveVariable[],
  traces: boolean,
  scheme: JacobianScheme,
): number[] {
  const bounded = prescription.surfaces
    .map((s) => s.semiAperture)
    .filter((a) => Number.isFinite(a) && a > 0);
  const widest = bounded.length > 0 ? Math.max(...bounded) : 0;
  const x = startingValues(prescription, variables);
  return variables.map((v, j) => {
    if (v.kind === "thickness" || !traces) return autoStep(scheme, x[j]!, 1);
    const a = prescription.surfaces[v.surface]!.semiAperture;
    const rim = Number.isFinite(a) && a > 0 ? a : widest;
    return autoStep(scheme, x[j]!, rim > 0 ? 1 / rim : 1);
  });
}

/**
 * `options` with the design's own steps filled in, where the caller stated none.
 *
 * `operands` is every row of the merit — wishes and conditions alike — because
 * a condition is differenced in the same stencil and a merit that holds a
 * traced quantity traces whether or not any wish does.
 */
function withDesignSteps(
  prescription: Prescription,
  variables: readonly SolveVariable[],
  operands: readonly SystemCondition[],
  options: DlsOptions,
): DlsOptions {
  if (options.steps !== undefined) return options;
  const traces = operands.some(isTraced);
  return {
    ...options,
    steps: designSteps(prescription, variables, traces, options.jacobian ?? "central"),
  };
}

/**
 * The Jacobian at x, column by column, with the wall convention on the stencil
 * — and the conditions differenced in the SAME stencil rather than a second
 * one, since they are read from the same evaluation and so cost no trial
 * designs of their own.
 *
 * `r` and `cv` are the residuals at x itself, which a one-sided difference
 * needs and a central one does not. Writes into `j` (m × n) and `cj` (p × n).
 *
 * `stencil`, when given, records WHICH of the four cases each column took.
 * A run does not care — a column is a column and the damping survives a bad
 * one — but a readout does: a zero column because the merit cannot see the
 * variable and a zero column because both trial designs were walls are the
 * same number and different facts, and `meritResponse` is the caller whose
 * whole job is to tell a reader which one they have.
 */
/** The scheme got the trials it asked for — no wall touched this column. */
const STENCIL_CLEAN = 0;
/** Under `central`, x − h was a wall: this column is one-sided and O(h). */
const STENCIL_FORWARD = 1;
/** x + h was a wall, so the column was differenced backwards. Also O(h). */
const STENCIL_BACKWARD = 2;
/** Neither side was a system. The column is zero because nothing was learned. */
const STENCIL_BLIND = 3;

function jacobianColumns(
  e: Evaluator,
  x: Float64Array,
  step: Float64Array,
  scheme: JacobianScheme,
  r: Float64Array,
  cv: Float64Array,
  j: Float64Array,
  cj: Float64Array,
  stencil?: Int8Array,
): void {
  const n = x.length;
  const m = e.m;
  const p = e.p;
  for (let c = 0; c < n; c++) {
    const h = step[c]!;
    const xc = x[c]!;
    const xp = Float64Array.from(x);
    xp[c] = xc + h;
    const rp = e.at(xp);
    let rm: Evaluated | null = null;
    if (scheme === "central") {
      const xm = Float64Array.from(x);
      xm[c] = xc - h;
      rm = e.at(xm);
    }
    if (rp !== null && rm !== null) {
      // Both sides available: the O(h²) difference this scheme exists for.
      const twoH = 2 * h;
      for (let i = 0; i < m; i++) j[i * n + c] = (rp.r[i]! - rm.r[i]!) / twoH;
      for (let k = 0; k < p; k++) cj[k * n + c] = (rp.c[k]! - rm.c[k]!) / twoH;
      if (stencil) stencil[c] = STENCIL_CLEAN;
    } else if (rp !== null) {
      for (let i = 0; i < m; i++) j[i * n + c] = (rp.r[i]! - r[i]!) / h;
      for (let k = 0; k < p; k++) cj[k * n + c] = (rp.c[k]! - cv[k]!) / h;
      // A one-sided FORWARD difference is what the "forward" scheme always
      // does; under "central" it means x − h was a wall, and only then.
      if (stencil) stencil[c] = scheme === "central" ? STENCIL_FORWARD : STENCIL_CLEAN;
    } else {
      // Forward is a wall. Difference backwards instead; the accuracy of this
      // one column drops to O(h), the run continues.
      const xm = Float64Array.from(x);
      xm[c] = xc - h;
      const back = rm ?? e.at(xm);
      if (back !== null) {
        for (let i = 0; i < m; i++) j[i * n + c] = (r[i]! - back.r[i]!) / h;
        for (let k = 0; k < p; k++) cj[k * n + c] = (cv[k]! - back.c[k]!) / h;
        if (stencil) stencil[c] = STENCIL_BACKWARD;
      } else {
        // Walled on both sides: no information about this variable, so it does
        // not move. `math/lsq` returns 0 for the column either way; this is the
        // same answer said explicitly rather than by rank deficiency.
        for (let i = 0; i < m; i++) j[i * n + c] = 0;
        for (let k = 0; k < p; k++) cj[k * n + c] = 0;
        if (stencil) stencil[c] = STENCIL_BLIND;
      }
    }
  }
}

/**
 * Minimise Σ rᵢ(x)² over x by damped least squares, optionally **subject to
 * conditions cₖ(x) = 0 held exactly**.
 *
 * `residuals` returns the residual vector — already weighted, already
 * target-subtracted — and may throw or return a non-finite entry for an x that
 * is not a system. There may be fewer residuals than variables: damping keeps
 * the step well-posed where Gauss–Newton alone would not be, and the surplus
 * freedom simply does not move.
 *
 * ## Conditions, and why they are not wishes with a large weight
 *
 * Return `{ minimize, hold }` instead of a bare array and the `hold` entries
 * become equality constraints. Each step then solves
 *
 *     min ‖ [    J     ] δ + [ r ] ‖²   subject to   C·δ = −θ·c
 *         ‖ [ √λ·D^½   ]     [ 0 ] ‖
 *
 * — the same damped least-squares step as before, with the linearised
 * conditions imposed on it exactly (`math/lsq`'s null-space solve). Newton on
 * c, so the violation falls quadratically and the fixed point is feasible to
 * the conditioning of C rather than to O(1/weight).
 *
 * **The damping stacks BEFORE the conditions reduce the problem, and that order
 * is the argument rather than an implementation detail.** Damping the reduced
 * problem instead would scale each free direction by its response in a basis of
 * the null space — and that basis is arbitrary, fixed by the sign choices
 * inside a QR, so the step would depend on something that is not a property of
 * the design at all. Stacked first, the damping is still Marquardt's, in the
 * variables' own units, and the module header's scale-freedom argument survives
 * word for word.
 *
 * ### Three things a caller can see from the outside
 *
 * **A start need not satisfy the conditions.** That is the normal case — "make
 * this lens 100 mm" starts at a lens that is not. Only a start that is not a
 * system is refused.
 *
 * **Damping no longer shortens the step to nothing.** As λ → ∞ the *wish* half
 * of the step vanishes but the condition half does not: what is left is the
 * shortest move that restores feasibility, which is the right thing to keep and
 * is why `stepTolerance` cannot fire while a condition is unmet. So a rejected
 * step also shortens the restoration itself, by θ — halved on each consecutive
 * rejection, back to 1 on any acceptance. Exactness is a property of the fixed
 * point, where c = 0 and θ multiplies nothing, so backing off costs iterations
 * and never accuracy. Without it a run whose restoration direction is walled
 * would raise λ forever against a step that never shrinks.
 *
 * **A step is accepted on Σrᵢ² + μ·Σ|cₖ|, not on the merit.** An infeasible
 * start has to be able to buy feasibility with merit, and the merit alone
 * cannot express that trade. μ is not a caller's choice and not a constant: it
 * is raised only when the step's own linear model says the wishes will get
 * worse, to twice what it takes for the step to still be a descent direction
 * for the combined measure (Nocedal & Wright, *Numerical Optimization* 2nd ed.
 * § 18.3). It is monotone and depends only on the iterates, so a run capped at
 * k iterations remains exactly the prefix of a longer one — which the app's
 * convergence trail is drawn on top of.
 */
export function dampedLeastSquares(
  residuals: (x: readonly number[]) => MeritVector,
  x0: readonly number[],
  options: DlsOptions = {},
): DlsResult {
  const n = x0.length;
  if (n === 0) throw new Error("dampedLeastSquares: no variables to move");
  for (const v of x0) {
    if (!Number.isFinite(v)) {
      throw new Error(`dampedLeastSquares: the starting point [${x0.join(", ")}] is not finite`);
    }
  }
  const maxIterations = options.maxIterations ?? 100;
  const scaling = options.scaling ?? "marquardt";
  const scheme = options.jacobian ?? "central";
  const gradientTolerance = options.gradientTolerance ?? 1e-12;
  const stepTolerance = options.stepTolerance ?? 1e-14;
  const meritTolerance = options.meritTolerance ?? 1e-15;
  const constraintTolerance = options.constraintTolerance ?? 1e-14;
  const lambda0 = options.initialDamping ?? 1e-3;
  if (!(lambda0 > 0)) {
    throw new Error(`dampedLeastSquares: the initial damping ${lambda0} is not positive`);
  }
  if (options.steps !== undefined && options.steps.length !== n) {
    throw new Error(
      `dampedLeastSquares: ${options.steps.length} finite-difference steps for ${n} variables`,
    );
  }

  const e = makeEvaluator("dampedLeastSquares", residuals);

  let x = Float64Array.from(x0);
  const current = e.at(x);
  if (current === null) {
    throw new Error(
      `dampedLeastSquares: the starting point [${x0.join(", ")}] is not a system — ` +
        `there is nothing to damp away from`,
    );
  }
  const m = e.m;
  const p = e.p;
  if (m === 0) throw new Error("dampedLeastSquares: no residuals to minimise");
  if (p > n) {
    throw new Error(
      `dampedLeastSquares: ${p} conditions on ${n} variable(s) — a condition each ` +
        `variable cannot meet is not a condition`,
    );
  }
  let r = current.r;
  let cv = current.c;
  let merit = sumSquares(r);
  let violation = sumAbs(cv);

  const step = differenceSteps("dampedLeastSquares", x, scheme, options.steps);

  // Marquardt's running maximum: a variable whose column has gone quiet stays
  // damped by the strongest response it ever showed, so a temporarily flat
  // direction is not handed an unbounded step (MINPACK's `lmdif` does the same).
  const dScale = new Float64Array(n);
  let lambda = lambda0;
  let nu = 2;
  let accepted = 0;
  let rejected = 0;
  let gradient = Number.POSITIVE_INFINITY;
  let reason: DlsStopReason = "iterations";
  // The ℓ1 exchange rate between merit and violation, and how much of the
  // violation one step is asked to remove. Both are 0 and 1 forever when there
  // are no conditions, which is what keeps the unconstrained arithmetic below
  // identical to the arithmetic before conditions existed.
  let mu = 0;
  let theta = 1;
  let multipliers: Float64Array = new Float64Array(p);
  let feasibility = 0;

  const j = new Float64Array(m * n);
  const cj = new Float64Array(p * n);
  const cs = new Float64Array(p * n);
  const a = new Float64Array((m + n) * n);
  const b = new Float64Array(m + n);
  const jtr = new Float64Array(n);
  const colNorm = new Float64Array(n);
  const rowNorm = new Float64Array(p);
  const kkt = new Float64Array(n);
  const rhs = new Float64Array(p);

  let iterations = 0;
  while (iterations < maxIterations) {
    iterations++;

    // ---- Jacobian, column by column, with the wall convention on the stencil
    // — the same builder `variableResponse` and `systemResponse` read, so what
    // a caller is shown about these variables is what the step was actually
    // computed from, on a paraxial merit and on a traced one alike.
    jacobianColumns(e, x, step, scheme, r, cv, j, cj);

    // ---- Scale-free gradient measure, and the column norms the damping wants.
    const rNorm = Math.sqrt(merit);
    let maxD = 0;
    for (let c = 0; c < n; c++) {
      let dot = 0;
      let col = 0;
      for (let i = 0; i < m; i++) {
        const jc = j[i * n + c]!;
        dot += jc * r[i]!;
        col += jc * jc;
      }
      if (col > dScale[c]!) dScale[c] = col;
      if (dScale[c]! > maxD) maxD = dScale[c]!;
      jtr[c] = dot;
      colNorm[c] = Math.sqrt(col);
      kkt[c] = dot;
    }

    // ---- The multipliers, and with them the part of the gradient the
    // conditions do NOT account for. Under a condition the merit's gradient is
    // not zero at the optimum and never becomes zero — ∇m = −Cᵀλ there — so the
    // unconstrained test would refuse to recognise an answer it had found.
    if (p > 0) {
      const ct = new Float64Array(n * p);
      for (let k = 0; k < p; k++) {
        for (let i = 0; i < n; i++) ct[i * p + k] = cj[k * n + i]!;
      }
      const g = new Float64Array(n);
      for (let i = 0; i < n; i++) g[i] = -2 * jtr[i]!;
      multipliers = householderLeastSquares(ct, n, p, g);
      for (let c = 0; c < n; c++) {
        let s = 0;
        for (let k = 0; k < p; k++) s += cj[k * n + c]! * multipliers[k]!;
        kkt[c] = jtr[c]! + s / 2;
      }
      // …and how far the variables would have to move to meet each condition,
      // relative to how large they are: a violation in 1/mm and one in mm are
      // not comparable, and this quotient is.
      let xScale = 0;
      for (let c = 0; c < n; c++) xScale += x[c]! * x[c]!;
      xScale = Math.sqrt(xScale) + 1;
      feasibility = 0;
      for (let k = 0; k < p; k++) {
        let row = 0;
        for (let c = 0; c < n; c++) row += cj[k * n + c]! * cj[k * n + c]!;
        rowNorm[k] = Math.sqrt(row);
        const far = rowNorm[k]! > 0 ? Math.abs(cv[k]!) / (rowNorm[k]! * xScale) : Infinity;
        if (far > feasibility) feasibility = far;
      }
    }

    let worst = 0;
    for (let c = 0; c < n; c++) {
      const denom = colNorm[c]! * rNorm;
      const cosine = denom > 0 ? Math.abs(kkt[c]!) / denom : 0;
      if (cosine > worst) worst = cosine;
    }
    gradient = worst;
    if (worst <= gradientTolerance && feasibility <= constraintTolerance) {
      reason = "gradient";
      break;
    }

    // ---- The damped step, as an augmented least-squares problem — and, where
    // there are conditions, that same problem with C·δ = −θ·c imposed on it.
    a.fill(0);
    b.fill(0);
    for (let i = 0; i < m; i++) {
      for (let c = 0; c < n; c++) a[i * n + c] = j[i * n + c]!;
      b[i] = -r[i]!;
    }
    for (let c = 0; c < n; c++) {
      const d = scaling === "levenberg" ? 1 : (dScale[c]! > 0 ? dScale[c]! : maxD > 0 ? maxD : 1);
      a[(m + c) * n + c] = Math.sqrt(lambda * d);
    }
    let delta: Float64Array | null;
    if (p === 0) {
      delta = householderLeastSquares(a, m + n, n, b);
    } else {
      // The conditions go in with their rows scaled to unit length. Cδ = −θc
      // and αCδ = −αθc are the same condition, so this changes no answer — but
      // it is what makes "are these two conditions the same condition?" a
      // question about the conditions instead of about their units. Unscaled,
      // holding the power and holding the focal length — which are one
      // condition written two ways, with gradients eight orders apart — pass a
      // relative rank test on the strength of the disparity alone.
      for (let k = 0; k < p; k++) {
        const s = rowNorm[k]! > 0 ? 1 / rowNorm[k]! : 1;
        for (let c = 0; c < n; c++) cs[k * n + c] = cj[k * n + c]! * s;
        rhs[k] = -theta * cv[k]! * s;
      }
      delta = equalityConstrainedLeastSquares(a, m + n, n, b, cs, p, rhs);
    }
    if (delta === null) {
      // Two conditions that have become one, or one no variable can move. λ is
      // no help against that, so the run stops on it rather than pretending.
      if (iterations === 1) {
        throw new Error(
          `dampedLeastSquares: the ${p} conditions are not independent at the ` +
            `starting point — one of them asks nothing the others do not, or ` +
            `nothing these variables can move`,
        );
      }
      reason = "conditions";
      break;
    }

    let deltaNorm = 0;
    let xNorm = 0;
    for (let c = 0; c < n; c++) {
      deltaNorm += delta[c]! * delta[c]!;
      xNorm += x[c]! * x[c]!;
    }
    deltaNorm = Math.sqrt(deltaNorm);
    xNorm = Math.sqrt(xNorm);
    if (deltaNorm <= stepTolerance * (xNorm + stepTolerance)) {
      reason = "step";
      break;
    }

    const xNew = new Float64Array(n);
    for (let c = 0; c < n; c++) xNew[c] = x[c]! + delta[c]!;
    const trial = e.at(xNew);

    if (trial === null) {
      // A wall. Indistinguishable, from here, from a step that made things
      // worse — and treated the same way.
      rejected++;
      lambda *= nu;
      nu *= 2;
      // …and the restoration itself shortens, down to a floor. Below that the
      // condition half of the step is smaller than the rounding on the design
      // and shortening it further asks for noise rather than for feasibility.
      theta = Math.max(theta / 2, THETA_FLOOR);
      if (!Number.isFinite(lambda)) {
        reason = "damping";
        break;
      }
      continue;
    }

    const meritNew = sumSquares(trial.r);
    const violationNew = sumAbs(trial.c);
    // Predicted reduction from the LINEAR model the step was built on, computed
    // from J directly rather than from the normal-equation identity, so it stays
    // honest if the QR ever returns something other than the exact minimiser.
    let predicted = 0;
    for (let i = 0; i < m; i++) {
      let lin = r[i]!;
      for (let c = 0; c < n; c++) lin += j[i * n + c]! * delta[c]!;
      predicted += lin * lin;
    }
    predicted = merit - predicted;
    // The condition half of the same model is exact by construction: the step
    // was built to take the linearised violation to (1−θ) of itself. Where the
    // wishes are predicted to get WORSE, that is the step buying feasibility,
    // and μ has to be worth at least twice the price for the combined measure
    // to still be going downhill.
    if (violation > 0 && predicted < 0) {
      const needed = -predicted / (0.5 * theta * violation);
      if (2 * needed > mu) mu = 2 * needed;
    }
    predicted += mu * theta * violation;
    const phi = merit + mu * violation;
    const phiNew = meritNew + mu * violationNew;
    const rho = predicted > 0 ? (phi - phiNew) / predicted : phiNew < phi ? 1 : -1;

    if (phiNew < phi) {
      accepted++;
      const change = phi === 0 ? 0 : (phi - phiNew) / phi;
      x = xNew;
      r = trial.r;
      cv = trial.c;
      merit = meritNew;
      violation = violationNew;
      // Nielsen's update: the better the linear model predicted the outcome, the
      // more the damping relaxes — down to a third, never further in one step.
      lambda *= Math.max(1 / 3, 1 - (2 * rho - 1) ** 3);
      nu = 2;
      theta = 1;
      if (change < meritTolerance) {
        reason = "merit";
        break;
      }
    } else {
      rejected++;
      lambda *= nu;
      nu *= 2;
      // …and the restoration itself shortens, down to a floor. Below that the
      // condition half of the step is smaller than the rounding on the design
      // and shortening it further asks for noise rather than for feasibility.
      theta = Math.max(theta / 2, THETA_FLOOR);
      if (!Number.isFinite(lambda)) {
        reason = "damping";
        break;
      }
    }
  }

  return {
    x: Array.from(x),
    residuals: Array.from(r),
    merit,
    iterations,
    accepted,
    rejected,
    evaluations: e.evaluations,
    damping: lambda,
    gradient,
    reason,
    constraints: Array.from(cv),
    multipliers: Array.from(multipliers),
    feasibility,
  };
}

function sumSquares(v: Float64Array): number {
  let s = 0;
  for (let i = 0; i < v.length; i++) s += v[i]! * v[i]!;
  return s;
}

/** ‖c‖₁ — the norm the exact-penalty argument is made in, not a sum of squares. */
function sumAbs(v: Float64Array): number {
  let s = 0;
  for (let i = 0; i < v.length; i++) s += Math.abs(v[i]!);
  return s;
}

/**
 * One thing a merit can ask a prescription for, as a CONDITION — no weight,
 * because a condition is not traded against anything.
 *
 * Every operand carries its own wavelength, which is the difference between
 * this and `solveParaxial`: a solve answers a question at one line, and the
 * first merit worth writing — hold the power, kill the colour — is a question
 * about two.
 */
export type HeldOperand =
  /**
   * System power 1/EFL (1/mm), by the engine's own EFL convention. Unlike an
   * `efl` operand this has no pole and no wall — an afocal system has power
   * zero, which is a number a merit can walk through.
   */
  | { readonly kind: "power"; readonly wavelengthNm: number; readonly target: number }
  /** Effective focal length (mm). Afocal is a wall, as everywhere else. */
  | { readonly kind: "efl"; readonly wavelengthNm: number; readonly target: number }
  /** Back focal distance, last vertex → paraxial focus (mm, signed). */
  | { readonly kind: "bfd"; readonly wavelengthNm: number; readonly target: number }
  /**
   * P(λ₁) − P(λ₂), the axial colour of the system in 1/mm. Target 0 is the
   * achromatic condition, stated in the currency it is actually linear in.
   */
  | {
      readonly kind: "chromaticPower";
      readonly wavelengthsNm: readonly [number, number];
      readonly target: number;
    }
  /**
   * Σ S_I, the third-order spherical aberration sum (mm), at a marginal ray
   * height the caller states and the optimiser holds fixed. It has to be fixed:
   * S_I carries h⁴, so a height that moved with the design would change the
   * merit for reasons that are not the design.
   */
  | {
      readonly kind: "seidelS1";
      readonly wavelengthNm: number;
      readonly marginalHeightMm: number;
      readonly target: number;
    };

/**
 * The same thing as a WISH: a residual to be squared into the merit alongside
 * the others.
 *
 * `weight` multiplies the residual before it is squared, and its unit is
 * 1/(this operand's unit). See the module header: nothing here can choose it.
 * The weight is exactly what a condition does not have, and the two types differ
 * in that one field for that one reason.
 */
export type OptimizeOperand = HeldOperand & { readonly weight?: number };

/**
 * Which plane a traced spot is measured on.
 *
 * `"bestSpot"` refocuses every trial to its own minimum-RMS plane, which
 * `bestSpotZ` gives in closed form — no search, so no search error enters the
 * merit. `"systemImagePlane"` measures where the system actually forms the
 * image, so a design that shifts its focus is charged for it. Both are smooth
 * and neither is more correct, which is why this is stated rather than
 * defaulted — and the reason is stronger than the factor of ten between them on
 * one design (2.5·10⁻¹ mm against 2.7·10⁻²).
 *
 * **Refocusing forgives the focal length, so `"bestSpot"` over an unconstrained
 * power is an unbounded wish.** A design is never charged for where it forms an
 * image, a weaker lens has less spherical aberration, and nothing stops the
 * optimiser making one: given a single free curvature on the § 1.8.5 singlet it
 * walks the focal length from +999.5 mm to −16 411 mm — a nearly flat plate —
 * with the merit still falling when the step underflows. The infimum is a
 * window, which is not a lens. `"systemImagePlane"` is bounded on the same
 * variable because the image has to land somewhere fixed. Hold the power — as a
 * wish at weight 10⁶ or as a condition — and both are well posed, and then they
 * still disagree: 0.7120 against 0.2257 in shape factor, each beating the other
 * on the measure it was asked for.
 *
 * The fixed-plane half of that pair is **weight-sensitive and the refocused half
 * is not**, which the multipliers say before the shapes do: held as a condition
 * (§ 1.8.6) the plane run reads 0.2230 rather than 0.2257, because its merit is
 * aberration AND focus position and will trade 6.2·10⁻⁶ of focal length for
 * shape — a condition it prices 6 672× higher than the refocused run prices the
 * same one. Refocused, held and weighted agree to six figures.
 */
export type TracedFocus = "bestSpot" | "systemImagePlane";

/**
 * How a spot wish is handed to the solver: as ONE number, or as the rays it was
 * summarised from.
 *
 * Both spell the same merit — Σ over `"transverse"`'s rows is exactly the RMS
 * squared, which is what the 1/√N on each row is for — so `weight` means the
 * same thing in either and the two are comparing designs by the same measure.
 * What differs is what Gauss–Newton can see of it, and § 1.8.12 measures that
 * the difference is the answer rather than the cost.
 *
 * **`"rms"` collapses N rays into one NON-NEGATIVE magnitude, and that is what
 * defeats the method.** A least-squares step models the merit as ‖r + Jδ‖² and
 * so carries JᵀJ, dropping Σrᵢ∇²rᵢ. On one non-negative row that dropped term
 * is coherent — every ray's curvature enters with the same sign as r — and on
 * this app's own achromat it measures **2.2·10⁷ against 0.4 for the term that
 * is kept**, seven orders the wrong way. Given each ray its own SIGNED row the
 * same term has mixed signs across the pupil and largely cancels, and JᵀJ stops
 * being rank one: 154 rows over 2 variables instead of 1 over 2.
 *
 * Measured on the panel's own merit, two curvatures, an 11-point grid:
 *
 * | | evaluations | stop | ‖Jᵀr‖ measure | merit |
 * |---|---|---|---|---|
 * | `"rms"` | 2 001 | `iterations` | 1.000 | 1.1389·10⁻⁶ |
 * | `"transverse"` | 155 | `step`, 22 accepted | 4.4·10⁻¹² | 7.4188·10⁻⁷ |
 *
 * The second is the optimum — an independent Nelder–Mead agrees to twelve
 * digits — and the first is **53.5% above it in merit and 35.1% in the spot**,
 * after thirteen times the work. `"rms"` is kept, defaulted and unchanged
 * because every recorded number in § 1.8.5 onward was measured on it, not
 * because it is the one to ask for.
 *
 * **A nonzero `target` is refused on `"transverse"`, and that is the honest
 * boundary rather than a gap.** "Make the RMS 0.001 mm" does not decompose into
 * a wish about any one ray; it is a statement about the summary, and the summary
 * is the thing this reading declines to form. Target 0 — make the image a point
 * — is the only per-ray wish there is. For the same reason it cannot be HELD:
 * a condition is one equation, and this is 2N of them.
 */
export type SpotReading = "rms" | "transverse";

/**
 * A wish about a quantity only real rays can answer.
 *
 * Every field here is something no default can choose: which field point, which
 * wavelength, which rays. The pupil sample set in particular is the merit's
 * definition and not a resolution knob — measured on the singlet, going from 29
 * rays to 1 253 moves the merit's VALUE by 15% and the optimum's LOCATION by
 * 5.3·10⁻⁵, so two callers who sample differently are asking near-enough the
 * same design question and reading two different numbers off it.
 */
export type SpotCondition = {
  /** RMS spot radius (mm), about the centroid, unweighted by throughput. */
  readonly kind: "rmsSpot";
  /** Field angle in degrees, or object height in mm — as the system spells it. */
  readonly fieldValue: number;
  readonly wavelengthNm: number;
  /** The rays. Fixed for the whole run; `pupilGrid`/`pupilFan` build them. */
  readonly pupil: readonly PupilPoint[];
  readonly focus: TracedFocus;
  readonly target: number;
  /**
   * Default `"rms"`, which is every number this ladder recorded before
   * § 1.8.12. `"transverse"` gives the solver one signed row per ray per axis
   * for the same merit — see `SpotReading`, and prefer it for anything being
   * MINIMISED rather than read.
   */
  readonly reading?: SpotReading;
};

/**
 * Which number a wavefront operand reads off the fitted map.
 *
 * This is `TracedFocus` again in another currency, and the resemblance is the
 * useful part: an OPD is measured against a reference sphere centred on the
 * system's own image point, so a wavefront operand is always the analogue of
 * `"systemImagePlane"` — there is no refocusing branch, because refocusing a
 * wavefront IS removing its defocus term, and that is what `"balancedRms"`
 * does algebraically instead of geometrically.
 *
 * What each one forgives, and therefore what each one is for:
 *
 *  - `"rms"` — piston out, **tilt and defocus in**. Charges a design for where
 *    it puts its focus and where it points. `fitRms`'s own reasoning: off axis
 *    tilt is a real chief-ray displacement, and hiding it reports distortion as
 *    perfection.
 *  - `"balancedRms"` — piston, tilt and defocus out (`balancedRms`, § 1.5.3's
 *    currency). The wavefront a system would show if it were refocused and
 *    re-pointed for free.
 *  - `"zernike"` — one Noll coefficient in waves, signed. The only reading that
 *    can be given a nonzero target sensibly, and the one whose residual passes
 *    through the fit and nothing else.
 *
 * **`"balancedRms"` must not be given the focus or the power to move, and the
 * reason is worse than the one this comment first claimed.** The obvious
 * argument — remove the defocus term and the merit stops depending on the image
 * plane, so a run over that variable learns nothing — is false, and § 1.8.7
 * measures how. Removing the Zernike defocus is not the same operation as
 * refocusing: the OPD's reference sphere is centred on the image point and its
 * RADIUS is the exit-pupil distance, so moving the plane inflates the sphere
 * and shrinks every high-order coefficient with it. The merit therefore has a
 * real gradient, and a real minimum, **half a focal length past focus** — where
 * the reading is 3.85× better than at true best focus and the geometric image
 * is 1 690× larger.
 *
 * That is a worse failure than `"bestSpot"`'s. An unbounded wish diverges and
 * says so by never settling; this one CONVERGES and reports success. Over a
 * free power it does the other thing too — a singlet's one free curvature walks
 * the focal length to 2 036 mm and the merit to 4·10⁻¹² waves, a lens that
 * forms no image where the image is. `"rms"` is bounded on both variables
 * because it is charged for where the light actually goes.
 */
/**
 * How an RMS wavefront wish is handed to the solver: as ONE number, or as the
 * COEFFICIENTS it is the root-sum-square of.
 *
 * This is § 1.8.12's question in the wavefront's currency, and the answer is
 * shorter here because the reading is already a sum of squares. `fitRms` is
 * √(Σ_{j≥2} c_j²) and `balancedRms` is √(Σ_{j≥5} c_j²) — Parseval on an
 * orthonormal basis, exactly rather than by quadrature — so the terms of the
 * sum ARE the residual rows, with no scale factor and nothing approximated.
 * `"value"` is the default and every number recorded from § 1.8.7 onward is on
 * it, bitwise.
 *
 * **The remedy § 1.8.12 forecast for this operand — "an OPD map's per-sample
 * residuals, scaled so their squares sum to the fitted RMS" — is the wrong
 * shape, and § 1.8.13 measures why.** A sample's OPD is not a term of this
 * merit. It carries the piston `fitRms` excludes and the part of the map the
 * fit did not capture, which the operand's own definition excludes too; and
 * discrete orthonormality on a disc-clipped square grid is an approximation
 * where the coefficient identity is exact. Per-sample rows sum to a DIFFERENT
 * number: the raw map's RMS about its mean is **1.39% away** on this ladder's
 * own singlet, and — the part that says the shortfall is the GRID rather than
 * the fit residual — resampling the fitted model at those same 77 points is
 * 1.40% away, no closer. So per-sample rows would spell a merit the operand
 * does not name. The forecast was written from the spot's shape rather than
 * from this one's.
 *
 * **And the mechanism in the lead is not the one § 1.8.12 measured either.**
 * There the dropped Σrᵢ∇²rᵢ was 2.2·10⁷ against 0.4 for the term that is kept;
 * here it is 4.5·10⁻³ of it — negligible, and the step still cannot move. What
 * defeats this operand is the RANK the single row leaves: one residual over two
 * variables makes JᵀJ a rank-one matrix by construction, and it measures so —
 * eigenvalues 1.88·10¹¹ and **exactly 0**, the two columns anti-parallel to the
 * last bit. There is a direction in the design space the step cannot see at
 * all, which is why the KKT test reads 1 and the run stops on `iterations`. The
 * decomposed form is rank two (second eigenvalue 2.8·10⁴, condition 6.7·10⁶).
 * § 1.8.12 named both mechanisms; which one dominates is per operand, and
 * assuming the spot's answer transferred would have been wrong.
 *
 * **`"terms"` is not a promise of rank, and the boundary is reachable.** The
 * rows number `terms − 1` (or `terms − 4` balanced), so at a term count equal
 * to the reading's own floor — 2 for `"rms"`, 5 for `"balancedRms"`, both
 * allowed, since only *below* the floor is refused — the decomposition is ONE
 * row again and cannot exceed rank one over two or more variables. The 2.8·10⁴
 * above is a measurement on an 11-term fit, not a guarantee. What survives at
 * the boundary is the other half: that row is a SIGNED coefficient where the
 * summary is a non-negative magnitude, so the dropped second-order term can
 * still cancel even where the rank cannot improve. Ask for terms comfortably
 * above the floor if the rank is what is wanted.
 *
 * **`"zernike"` has no decomposed spelling, and that is an answer rather than a
 * gap.** One signed coefficient is already one signed row: there is nothing to
 * decompose, and the conditioning defect this field exists to fix cannot reach
 * it. Which is why this is a field on the two RMS readings rather than two more
 * `reading` names — the term floor below is keyed by reading name, and a name
 * that fell through its table would validate an identically-zero merit.
 *
 * The two refusals are § 1.8.12's, transferred with their arguments intact: a
 * nonzero target does not decompose into a wish about one Zernike coefficient,
 * and `terms − 1` rows are not one equation, so this form cannot be HELD.
 */
export type WavefrontForm = "value" | "terms";

export type WavefrontReading =
  | { readonly reading: "rms"; readonly form?: WavefrontForm }
  | { readonly reading: "balancedRms"; readonly form?: WavefrontForm }
  | { readonly reading: "zernike"; readonly noll: number };

/**
 * A wish about the WAVEFRONT — the same rays, read as a phase map rather than
 * as a scatter of intercepts.
 *
 * Everything `SpotCondition` says about the sample set applies here unchanged:
 * the pupil list is the merit's definition, the surviving set is held, and a
 * trial design that loses or gains a ray is a wall rather than a worse design.
 * `opdMap` drops what does not reach the reference sphere exactly as
 * `exitBundle` drops what vignettes.
 *
 * ## The fit, and the conditioning question this operand was opened by
 *
 * Every reading here goes through `fitZernike`, including the two RMS ones,
 * which could have been read straight off `OpdMap.rmsWaves` without a fit. That
 * is deliberate: the fit is the operand's definition, `terms` is part of what
 * the caller is asking for, and a reading that quietly avoided the fit would
 * leave the question this operand exists to answer unasked.
 *
 * The question — recorded in § 1.8 as "the held-sample-set argument has to be
 * made again about the fit's own conditioning" — has a cleaner answer than the
 * bullet expected. `fitZernike` builds its design matrix from the sample
 * COORDINATES, and `opdMap` reports each sample at the normalized pupil point
 * that was ASKED for rather than at wherever the ray landed. So with the
 * survivor set held, the matrix, its factorisation, every R pivot and every
 * decision the 10⁻¹² pivot floor makes are all fixed for the whole run: the fit
 * is one linear map, applied to a right-hand side that is the only thing the
 * design moves. There is no conditioning that can change under the optimiser,
 * and § 1.8.7 pins that by superposition — to 8·10⁻¹⁶ — rather than by
 * inspection.
 *
 * The amplification the bullet feared runs the other way. A least-squares fit
 * spreads independent per-sample noise across the coefficients, so ‖Δc‖ is
 * √(terms/samples) of it: an ATTENUATION of 4.4× at eleven terms on a 313-point
 * grid, measured to 2% of √(terms/samples) at four widths of fit. The floor
 * that does bind is not the fit's at all — an OPD is a difference of two ~200 mm
 * optical paths expressed in waves, so f64 on the path is ~3·10⁻¹¹ waves per
 * sample and ~2·10⁻¹² waves on the reading. Three decades coarser than a traced
 * spot's, in relative terms, and still four decades below the module's own
 * differencing step.
 */
export type WavefrontCondition = {
  readonly kind: "wavefront";
  /** Field angle in degrees, or object height in mm — as the system spells it. */
  readonly fieldValue: number;
  readonly wavelengthNm: number;
  /** The rays. Fixed for the whole run; `pupilGrid`/`pupilFan` build them. */
  readonly pupil: readonly PupilPoint[];
  /**
   * Noll terms fitted, j = 1…terms. Part of the merit, not a resolution knob —
   * and it has a floor that depends on the reading, because `fitRms` sums from
   * j = 2 and `balancedRms` from j = 5. Below that the sum is empty and the
   * residual is zero for every design; refused rather than allowed to report a
   * converged optimum it never looked for.
   */
  readonly terms: number;
  /** In waves, in the reading's own sign convention. */
  readonly target: number;
} & WavefrontReading;

/**
 * A wish about CONTRAST at one spatial frequency — the question a user actually
 * asks, and the only operand here with a transform between the design and the
 * residual.
 *
 * ## What is held, and why it is ν rather than cycles/mm
 *
 * `mtfAt` samples the modulation array at `size/2 + ν·pupilSamples`, linearly
 * between two bins. Stated in NORMALIZED frequency both of those are the
 * caller's own numbers, so the sample position — and the two interpolation
 * weights — are **fixed for the whole run**, exactly as the held pupil set fixes
 * a wavefront operand's design matrix. Stated in cycles/mm they would not be:
 * `Psf.pixelScaleMm` is built from the exit-pupil radius and the reference
 * distance, both of which move with the design, so a fixed physical frequency
 * lands on a drifting bin and the merit picks up a kink at every bin crossing.
 * Measured on the § 1.8.8 mirror that drift is small — 0.056 bins per mm of
 * focus, against a signal of 4 contrast units per mm — and it is avoidable for
 * nothing, so it is avoided.
 *
 * The cost of choosing ν is stated rather than hidden: ν is normalized to
 * `2·NA/λ` read off the exit pupil, which is the aperture the system was ASKED
 * for. Where a clear aperture truncates the beam the modulation reaches zero
 * earlier than ν = 1 — 27% earlier on the app's own doublet, § 6ad — so on a
 * truncated system this operand's frequency is not the frequency its own array
 * cuts off at. That is a property of the fixture, and § 6ad is where it is
 * measured; the operand's job is to hold the ruler still, not to relabel it.
 *
 * ## The two things it is honest about and a spot merit is not
 *
 * **The reading is ~0.66/`pupilSamples` ABOVE the diffraction-limited closed
 * form on a pupil that is perfect** — 1.06% at 64 samples, 2.18% at 32 — because
 * a sampled pupil's autocorrelation over-counts its own edge. So
 * `diffractionLimitedMtf` is NOT a reachable target here: an operand told to hit
 * it at a perfect design would report a residual and go looking for the grid.
 * § 1.8.8 pins the bias and its 1/N law instead.
 *
 * **And contrast at a fixed frequency is not monotone in aberration.** The OTF
 * changes sign as defocus grows and the MTF is its modulus, so the merit passes
 * through zeros and rises again: on a perfect paraboloid at ν = 0.5 it falls
 * 0.395 → 3.5·10⁻⁴ by half a millimetre of defocus and is back at 3.5·10⁻² a
 * millimetre later. That is real optics rather than a convention — unlike
 * `"balancedRms"`'s false minimum — and it means this merit is genuinely
 * multimodal and the basin is the caller's problem. `solve.ts`'s rule applies:
 * a run reports the basin it landed in.
 *
 * One more difference worth knowing before designing around it: at a
 * zero-aberration optimum this merit is a **bowl**, where every other traced
 * operand here gives a corner. Contrast is quadratic in the wavefront error
 * where an RMS is linear in it, so § 1.8.2's square-root law applies to this one
 * and not to § 1.8.5's.
 *
 * ## No `form`, and what a second frequency actually buys (§ 1.8.14)
 *
 * A spot decomposes into its rays and a wavefront RMS into its Zernike terms,
 * and this is the third operand of that shape. It has no decomposed spelling,
 * and the reason is not that the rows do not exist. AT A BIN they do, exactly:
 * the reading is |OTF|/OTF(0), so (re, im)/OTF(0) are two signed rows whose
 * squares sum to the reading squared — bitwise at ν = 0.5 and 0.75 on a
 * 32-sample pupil. What they cannot spell is the MERIT. Both shipped
 * decompositions satisfy Σ rows² = value², and the merit is (value − target)²;
 * those agree only at target 0, which is why `validate` refuses a nonzero
 * target on both. **On contrast, a target of 0 is a wish for no image at all**,
 * so the only merit the rows could carry is the opposite of every wish anyone
 * asks. And off a bin the rows do not exist even in principle: `mtfAt` blends
 * two MODULI, which is not the modulus of any complex pair — 16% adrift at
 * ν = 0.15. A `form` on this operand is refused by name rather than ignored.
 *
 * § 1.8.13's mechanism does NOT transfer either, and assuming it would have
 * been the third wrong transfer in a row. One row over two variables is rank
 * one here too — the second eigenvalue of JᵀJ is 10⁻¹⁶ of the first and the KKT
 * test reads exactly 1 — and the run converges anyway, on `step`, in ~140
 * evaluations. Rank-one paralysis was a property of a merit whose residual
 * reaches zero, not of one row. A second frequency gives rank two and a KKT
 * test that can leave 1 (10⁻²…10⁻³), and lands within 3·10⁻⁴ of the one-row
 * answer in shape: it buys the READOUT, not the answer.
 *
 * ## …and it no longer costs a second trace (§ 1.8.15)
 *
 * ν is read at the very end of the chain — one lookup in an array built from a
 * pupil trace and two transforms, none of which it enters. So every frequency
 * at the same field, wavelength and sampling is a reading off ONE array, and
 * `systemReader` builds that array once per evaluation and hands it to all of
 * them: N frequencies cost `evaluations + 1` traced stages rather than
 * N × (evaluations + 1), which is 2.07× at two of them and 3.74× at four. The
 * saving is invisible in the answer by construction and is pinned that way —
 * every digit of a two-frequency run is bitwise what it was. What a caller has
 * to know is only the boundary: `pupilSamples` and the rest are part of what
 * makes two readings the same array, so two frequencies at two samplings are
 * two traces, correctly.
 *
 * ## What this merit spends its freedom on, which is the PLANE
 *
 * The finding a caller has to know before using it. On a singlet seeded half a
 * shape factor from Coddington's best form with the plane already placed —
 * the shape is the only defect — a wavefront merit recovers q\* to 1.1·10⁻³
 * and **this one leaves the shape exactly where it found it** (8·10⁻⁴ of a
 * 5·10⁻¹ error) and buys its contrast with a third of a wave of defocus
 * instead. It converges: restarted at its own answer it moves exactly zero,
 * while a wavefront merit from that same point drops the RMS 57%. The cost is
 * in contrast's own currency — 19.5% at ν = 0.15 and 66.7% at ν = 0.5 below
 * what this same operand reaches when a wavefront merit places the shape
 * first. Use it to place a plane, or to polish a design that is already the
 * right shape; a merit that has to FIND the shape wants § 1.8.13's operand.
 */
export type MtfCondition = {
  readonly kind: "mtf";
  /** Field angle in degrees, or object height in mm — as the system spells it. */
  readonly fieldValue: number;
  readonly wavelengthNm: number;
  /**
   * Normalized frequency ν = f/f_c, strictly inside (0, 1). Tangential — the
   * section whose contrast varies along x, which is the meridional plane this
   * engine puts a field point in, pinned to the bit against `mtfSections`.
   * That other half is not offered as an operand: it is a boundary rather than
   * an oversight, and off axis it is a different number — the two part company
   * by 27% at 2° on § 1.8.8's own mirror.
   */
  readonly nu: number;
  /**
   * Samples across the pupil DIAMETER on the FFT grid. Stated rather than
   * defaulted because it is the one knob that moves the number: it sets the
   * bias above, so two callers who sample the pupil differently are reading two
   * different contrasts off the same design.
   */
  readonly pupilSamples: number;
  /**
   * FFT size / pupilSamples. Default 4, and — measured — it does not move the
   * reading at all: 2, 4 and 8 agree to eight decimals, because the value at a
   * bin is set by the pupil sampling and padding only interpolates between
   * bins. Defaulted for that reason and not by convention.
   */
  readonly padFactor?: number;
  /** Pupil grid resolution for the TRACE, not the FFT. Default 21. */
  readonly traceSamples?: number;
  /** Zernike terms fitted to the traced OPD before the transform. Default 28. */
  readonly zernikeTerms?: number;
  /** Modulation, 0…1. */
  readonly target: number;
};

/** Anything `optimizeSystem` has to trace to answer. */
export type TracedCondition = SpotCondition | WavefrontCondition | MtfCondition;

/** The same wish, weighted into the merit. */
export type TracedOperand = TracedCondition & { readonly weight?: number };

/** Anything `optimizeSystem` can be asked for. */
export type SystemOperand = OptimizeOperand | TracedOperand;
/** …and anything it can be told to hold. */
export type SystemCondition = HeldOperand | TracedCondition;

const isTraced = (o: SystemCondition): o is TracedCondition =>
  o.kind === "rmsSpot" || o.kind === "wavefront" || o.kind === "mtf";

/**
 * How an entry point is asked: a bare list of wishes, as before, or wishes and
 * conditions told apart.
 *
 * They are two lists rather than a flag on one, and the reason is what
 * `residuals` and `merit` mean in the result: a condition is not a residual and
 * is not part of the merit, so folding conditions into the same array would
 * either lengthen `residuals` or shift the indices a caller reads it by. Split,
 * nothing about either field moves — and a weight on a condition becomes a
 * thing that cannot be written down rather than a thing that is refused.
 */
export type OptimizeRequest =
  | readonly OptimizeOperand[]
  | {
      readonly minimize: readonly OptimizeOperand[];
      readonly hold?: readonly HeldOperand[];
    };

/** The same, for the entry point that can also trace. */
export type SystemRequest =
  | readonly SystemOperand[]
  | {
      readonly minimize: readonly SystemOperand[];
      readonly hold?: readonly SystemCondition[];
    };

function asked<W, H>(
  request: readonly W[] | { readonly minimize: readonly W[]; readonly hold?: readonly H[] },
): { minimize: readonly W[]; hold: readonly H[] } {
  if (Array.isArray(request)) return { minimize: request as readonly W[], hold: [] };
  const both = request as { minimize: readonly W[]; hold?: readonly H[] };
  return { minimize: both.minimize, hold: both.hold ?? [] };
}

/**
 * A copy of `prescription` with several numbers changed at once.
 *
 * `withVariable`'s contract, extended to the variable LIST an optimiser moves:
 * a solve hands back values, and building the system from them stays a separate
 * and explicit step.
 */
export function withVariables(
  prescription: Prescription,
  variables: readonly SolveVariable[],
  values: readonly number[],
): Prescription {
  if (variables.length !== values.length) {
    throw new Error(
      `withVariables: ${variables.length} variables against ${values.length} values`,
    );
  }
  let out = prescription;
  for (let i = 0; i < variables.length; i++) out = withVariable(out, variables[i]!, values[i]!);
  return out;
}

/** 1/EFL, from the same paraxial trace `systemProperties` uses, minus the pole. */
function paraxialPower(prescription: Prescription, wavelengthNm: number): number {
  return -paraxialTrace(prescription, wavelengthNm, { y: 1, u: 0 }).u;
}

function operandValue(prescription: Prescription, operand: HeldOperand): number {
  switch (operand.kind) {
    case "power":
      return paraxialPower(prescription, operand.wavelengthNm);
    case "efl":
      return systemProperties(prescription, operand.wavelengthNm).efl;
    case "bfd":
      return systemProperties(prescription, operand.wavelengthNm).bfd;
    case "chromaticPower":
      return (
        paraxialPower(prescription, operand.wavelengthsNm[0]) -
        paraxialPower(prescription, operand.wavelengthsNm[1])
      );
    case "seidelS1":
      return seidelSums(prescription, operand.wavelengthNm, {
        marginalHeightMm: operand.marginalHeightMm,
      }).s1;
  }
}

/**
 * Damped least squares over prescription numbers.
 *
 * Starts from the values the prescription already carries — an optimiser
 * improves a design rather than inventing one — and returns them moved. Build
 * the system with `withVariables`.
 *
 * The same variable twice is refused rather than damped: two identical columns
 * are a rank deficiency the caller created, and silently splitting the step
 * between them would be an answer to a question nobody asked.
 *
 * Pass `{ minimize, hold }` for conditions the answer must satisfy exactly
 * rather than eventually: "bend this singlet for least spherical aberration
 * **at** 1000 mm of focal length" is one question with a wish and a condition
 * in it, and the difference from the same question asked with a large weight is
 * measured in § 1.8.6 rather than argued.
 */
export function optimizePrescription(
  prescription: Prescription,
  variables: readonly SolveVariable[],
  request: OptimizeRequest,
  options: DlsOptions = {},
): DlsResult {
  const { minimize, hold } = asked<OptimizeOperand, HeldOperand>(request);
  validate("optimizePrescription", prescription, variables, minimize, hold);

  const residuals = (x: readonly number[]): MeritVector => {
    const trial = withVariables(prescription, variables, x);
    const wishes = minimize.map((o) => (o.weight ?? 1) * (operandValue(trial, o) - o.target));
    if (hold.length === 0) return wishes;
    return { minimize: wishes, hold: hold.map((o) => operandValue(trial, o) - o.target) };
  };

  return dampedLeastSquares(
    residuals,
    startingValues(prescription, variables),
    withDesignSteps(prescription, variables, [...minimize, ...hold], options),
  );
}

/** Two variables that move the merit the same way, and how nearly the same. */
export interface DegeneratePair {
  readonly a: number;
  readonly b: number;
  /** |cos| between their columns — 1 is the same move made twice. */
  readonly cosine: number;
}

/** What a merit can see of a set of variables, read at one design. */
export interface MeritResponse {
  /** ‖J_j‖ per variable: the merit's units over the variable's own. */
  readonly response: readonly number[];
  /**
   * Variables whose column is exactly zero **and was measured** — no wish here
   * can see them at all. A column that is zero because both trial designs were
   * walls is in `blind` instead: same number, different fact, different fix.
   */
  readonly dead: readonly number[];
  /**
   * Variables whose stencil lost ONE side to a wall, so the column is a
   * one-sided difference and O(h) rather than O(h²). The number is real; its
   * accuracy is not the one the rest of the readout is quoted at.
   */
  readonly walled: readonly number[];
  /**
   * Variables whose stencil lost BOTH sides. The column is zero and the merit
   * has said nothing about them — the design sits on a boundary the difference
   * step cannot step off. Kept out of `dead`, out of the singular values, and
   * out of the angles, for the reason `dead` is: a rank deficiency that wants
   * a different sentence should not be reported in the same word.
   */
  readonly blind: readonly number[];
  /** |cos| between every pair of columns, n × n. NaN wherever either is dead or blind. */
  readonly cosines: readonly (readonly number[])[];
  /** The live pair whose columns are most nearly parallel. Null below two live ones. */
  readonly worstPair: DegeneratePair | null;
  /** Singular values of the live columns SCALED TO UNIT LENGTH, descending. */
  readonly singularValues: readonly number[];
  /**
   * σ₁/σ_last over those. Infinity where the live columns are exactly
   * dependent — which includes the ordinary case of more variables than
   * wishes, where the surplus freedom cannot be seen by definition.
   */
  readonly conditionNumber: number;
  /**
   * The combination of variables the merit responds to least, as a unit vector
   * in the SCALED coordinates: entry j is how much of variable j's own response
   * goes into it, and exactly 0 for a dead variable. Divide entry j by
   * `response[j]` for the same direction in the variables' own units. Signed so
   * that its largest component is positive, which is a convention and not a
   * result.
   */
  readonly weakest: readonly number[];
  /** Σrᵢ² at this design — a response is read AT a point, and this names it. */
  readonly merit: number;
  /**
   * Residual-vector evaluations spent: 2n on the default central stencil, plus
   * one — and plus up to two more per walled column where the caller is
   * `systemResponse`, which re-probes those to say what the wall was.
   */
  readonly evaluations: number;
}

/**
 * What these variables can do to this merit, read at one design: how strongly
 * it responds to each, which pairs move it the same way, and how nearly
 * dependent the set is as a whole.
 *
 * This is the question the damping exists to survive, asked out loud. Two
 * variables that do nearly the same thing do not stop a run — Marquardt's λ
 * keeps the step well-posed and an answer still arrives — so what is owed to a
 * caller here is a READOUT and not a refusal. That is the exact opposite of
 * what the same defect among CONDITIONS gets, and the asymmetry is the point:
 * λ damps a step, and a defect in the conditions is not in the step, so that
 * one stops the run (`"conditions"`) while this one is merely reported.
 * Whoever chooses which numbers a design may move is choosing this geometry,
 * and normally is not told what they chose.
 *
 * ## The columns are scaled to unit length, and that is not a detail
 *
 * A column is a curvature in 1/mm beside a thickness in mm, so the raw
 * matrix's condition number is a statement about the units rather than about
 * the design — the same disparity that lets "hold the power" and "hold the
 * focal length", one condition written two ways, pass a relative rank test on
 * the strength of the units alone. Every live column is scaled to unit length
 * before the singular values are taken, for the reason the conditions' rows
 * are: it makes *are these two variables the same variable?* a question about
 * the design.
 *
 * ## A dead variable is not a degenerate pair
 *
 * An exactly zero column — the last surface's thickness against any first-order
 * wish — means no wish here can see that variable at all. It is a rank
 * deficiency too, but it wants a different sentence and a different fix, so it
 * is named in `dead` and kept out of the singular values rather than sending
 * them to zero and thereby saying nothing about the variables that are alive.
 *
 * ## …and a zero column is not always a dead one
 *
 * The stencil can hit a wall: a trial design that is not a system, or — on a
 * traced merit — one whose surviving rays are not the same set. `jacobianColumns`
 * handles that for a RUN by dropping the column to a one-sided difference, or
 * to zero where both sides are walls, and a run is right not to care: the
 * damping survives a bad column and the next iterate is somewhere else.
 *
 * A READOUT cannot be so relaxed, because the zero it would report is the same
 * number `dead` reports and a different fact — "no wish here can see this
 * variable" against "this design is on a boundary the step cannot step off,
 * and nothing was learned". So the stencil each column actually took is
 * carried out: `walled` for the ones that lost a side and are therefore O(h)
 * rather than O(h²), `blind` for the ones that lost both, and `dead` keeps its
 * old meaning of a column that was measured and came back zero.
 *
 * ## The weights are inside the answer
 *
 * A weight scales a ROW, and row scaling changes the angles between columns.
 * So this geometry belongs to the merit *as asked* — weights, currency and
 * targets' units included — and is not a property of the design alone. § 1.8.9
 * measures both halves of that.
 *
 * Conditions are refused rather than ignored: the response under a condition is
 * a different object (the geometry inside the null space of C), and answering a
 * question that was not asked is worse here than declining it.
 */
export function meritResponse(
  residuals: (x: readonly number[]) => MeritVector,
  x0: readonly number[],
  options: DlsOptions = {},
): MeritResponse {
  const n = x0.length;
  if (n === 0) throw new Error("meritResponse: no variables to read");
  for (const v of x0) {
    if (!Number.isFinite(v)) {
      throw new Error(`meritResponse: the point [${x0.join(", ")}] is not finite`);
    }
  }
  const scheme = options.jacobian ?? "central";
  const e = makeEvaluator("meritResponse", residuals);
  const x = Float64Array.from(x0);
  const at = e.at(x);
  if (at === null) {
    throw new Error(
      `meritResponse: [${x0.join(", ")}] is not a system — there is no response to read at it`,
    );
  }
  const m = e.m;
  if (m === 0) throw new Error("meritResponse: no residuals to respond");
  if (e.p > 0) {
    throw new Error(
      `meritResponse: ${e.p} condition(s) — this reads what the WISHES can see of ` +
        `these variables, and under a condition that is a different geometry`,
    );
  }
  const step = differenceSteps("meritResponse", x, scheme, options.steps);
  const j = new Float64Array(m * n);
  const stencil = new Int8Array(n);
  jacobianColumns(e, x, step, scheme, at.r, at.c, j, new Float64Array(0), stencil);

  const norm = new Float64Array(n);
  for (let c = 0; c < n; c++) {
    let s = 0;
    for (let i = 0; i < m; i++) s += j[i * n + c]! * j[i * n + c]!;
    norm[c] = Math.sqrt(s);
  }
  const dead: number[] = [];
  const walled: number[] = [];
  const blind: number[] = [];
  const live: number[] = [];
  for (let c = 0; c < n; c++) {
    if (stencil[c] === STENCIL_BLIND) {
      blind.push(c);
      continue;
    }
    if (stencil[c] !== STENCIL_CLEAN) walled.push(c);
    (norm[c]! > 0 ? live : dead).push(c);
  }

  const cosines: number[][] = [];
  let worstPair: DegeneratePair | null = null;
  for (let a = 0; a < n; a++) {
    const row: number[] = [];
    for (let b = 0; b < n; b++) {
      if (norm[a]! === 0 || norm[b]! === 0) {
        row.push(Number.NaN);
        continue;
      }
      let dot = 0;
      for (let i = 0; i < m; i++) dot += j[i * n + a]! * j[i * n + b]!;
      // Rounding can put a normalised dot product a few ULP outside [−1, 1],
      // and an angle of 1.0000000000000002 is a number no reader can use.
      const cos = Math.min(1, Math.abs(dot) / (norm[a]! * norm[b]!));
      row.push(cos);
      if (a < b && (worstPair === null || cos > worstPair.cosine)) worstPair = { a, b, cosine: cos };
    }
    cosines.push(row);
  }

  const k = live.length;
  const scaled = new Float64Array(m * k);
  for (let i = 0; i < m; i++) {
    for (let t = 0; t < k; t++) scaled[i * k + t] = j[i * n + live[t]!]! / norm[live[t]!]!;
  }
  const { values, right } = singularSystem(scaled, m, k);
  // Fewer wishes than variables is the ordinary case, not a pathology, and the
  // surplus σ's are 0 by rank rather than by rounding — a 2 × 3 Jacobian cannot
  // have three independent columns whatever the arithmetic says. Jacobi leaves
  // them at 10⁻¹⁶² instead, which would be reported as a condition number of
  // 10¹⁶¹: a made-up number where the true one is "these variables include a
  // combination the merit cannot see at all".
  for (let t = m; t < k; t++) values[t] = 0;
  const smallest = k > 0 ? values[k - 1]! : 0;
  const conditionNumber = k === 0 ? Number.POSITIVE_INFINITY : smallest > 0 ? values[0]! / smallest : Number.POSITIVE_INFINITY;

  const weakest = new Array<number>(n).fill(0);
  if (k > 0) {
    let biggest = 0;
    for (let t = 0; t < k; t++) {
      if (Math.abs(right[t * k + (k - 1)]!) > Math.abs(biggest)) biggest = right[t * k + (k - 1)]!;
    }
    const sign = biggest < 0 ? -1 : 1;
    for (let t = 0; t < k; t++) weakest[live[t]!] = sign * right[t * k + (k - 1)]!;
  }

  let merit = 0;
  for (let i = 0; i < m; i++) merit += at.r[i]! * at.r[i]!;

  return {
    response: Array.from(norm),
    dead,
    walled,
    blind,
    cosines,
    worstPair,
    singularValues: Array.from(values),
    conditionNumber,
    weakest,
    merit,
    evaluations: e.evaluations,
  };
}

/**
 * `meritResponse` over prescription numbers: what this merit can see of these
 * variables, at the design the prescription already carries.
 *
 * The Jacobian is the one `optimizePrescription` differences — same builder,
 * same stencil, same wall convention, same default step — so what a caller is
 * shown about a variable set is what the optimiser's step is actually computed
 * from, rather than a second opinion about it that can drift.
 *
 * Wishes only, as the type says: a condition is not part of the merit, and the
 * geometry it leaves behind is a different question this does not pretend to
 * answer.
 */
export function variableResponse(
  prescription: Prescription,
  variables: readonly SolveVariable[],
  operands: readonly OptimizeOperand[],
  options: DlsOptions = {},
): MeritResponse {
  validate("variableResponse", prescription, variables, operands, []);
  const residuals = (x: readonly number[]): MeritVector => {
    const trial = withVariables(prescription, variables, x);
    return operands.map((o) => (o.weight ?? 1) * (operandValue(trial, o) - o.target));
  };
  return meritResponse(
    residuals,
    startingValues(prescription, variables),
    withDesignSteps(prescription, variables, operands, options),
  );
}

/**
 * A traced merit's response, and which of its columns are honest.
 *
 * Every field is `MeritResponse`'s, plus the one distinction only a system can
 * draw: `walled` and `blind` say a column's stencil hit a wall, and this says
 * WHICH wall it was.
 */
export interface SystemResponse extends MeritResponse {
  /**
   * Variables whose stencil was walled by the surviving rays MOVING, rather
   * than by a trial that is not a system. The design sits within one difference
   * step of a vignetting boundary in that variable, which is a fact about the
   * aperture and the field — not about the merit, and not about the variable.
   *
   * A subset of `walled` ∪ `blind`, and the reason those two are not enough
   * on their own: § 1.8.5 found a ray leaving the set to be the thing that
   * actually bites a traced run, and a readout that reported it as "not a
   * system" would send a reader to look at the wrong lens.
   */
  readonly survivorChanged: readonly number[];
}

/**
 * `meritResponse` over a SYSTEM's numbers: what a merit that traces can see of
 * these variables, at the design the system already carries.
 *
 * `variableResponse`'s question asked where a traced operand can be asked it.
 * Same builder as the run again — `optimizeSystem`'s own reader, survivor lock
 * included — so what a caller is shown about a variable set is what the step
 * would be computed from, and not a second opinion about it.
 *
 * **The survivor lock is anchored HERE, at this system's own prescription.**
 * Reading the response again at a design a run stopped on therefore means
 * handing in that design: `{ ...system, prescription: built }`. Carrying the
 * seed's survivors to the answer would wall every column and report a merit
 * that can see nothing, which is a statement about the bookkeeping.
 *
 * Wishes only, as the type says — `readonly SystemOperand[]` rather than
 * `SystemRequest`, so a condition is a thing that cannot be written down here
 * rather than a thing refused at run time. The geometry under a condition is
 * the geometry inside the null space of C, which is a different object.
 *
 * **Cost is the reason this is not the same call as `variableResponse`.** The
 * central stencil is 2n + 1 evaluations either way, but a traced evaluation is
 * 10²–10³ times a paraxial one (APP.md Part N measures 103× for a 149-ray spot
 * and 4 317× for contrast at 32 pupil samples), so this belongs wherever the
 * run itself belongs and not on a keystroke.
 */
export function systemResponse(
  system: OpticalSystem,
  variables: readonly SolveVariable[],
  operands: readonly SystemOperand[],
  options: DlsOptions = {},
): SystemResponse {
  const prescription = system.prescription;
  validate("systemResponse", prescription, variables, operands, []);
  const read = systemReader("systemResponse", system, operands);
  const residuals = (x: readonly number[]): MeritVector => {
    const trial = withVariables(prescription, variables, x);
    return operands.flatMap((o, i) => {
      const w = (o as OptimizeOperand).weight ?? 1;
      return read(trial, o, i).map((v) => w * v);
    });
  };

  // Filled in ONCE and used for both the reading and the wall probe below.
  // `meritResponse` is kind-blind by design — it is handed a residual function
  // and has no surface to ask — so the design's own scales are resolved here
  // and passed down as though the caller had stated them.
  const withSteps = withDesignSteps(prescription, variables, operands, options);
  const x0 = startingValues(prescription, variables);
  const base = meritResponse(residuals, x0, withSteps);

  // Why the wall was a wall, for the columns that hit one — and only those.
  // Re-probed here rather than recorded inside `residuals`, because the
  // stencil's call order is `jacobianColumns`'s business and a readout that
  // depends on it would be right by luck. The steps are the same function
  // `meritResponse` used, so the probe lands on the same trial designs.
  const survivorChanged: number[] = [];
  const suspect = [...base.walled, ...base.blind].sort((a, b) => a - b);
  let probes = 0;
  if (suspect.length > 0) {
    const x = Float64Array.from(x0);
    const step = differenceSteps(
      "systemResponse",
      x,
      withSteps.jacobian ?? "central",
      withSteps.steps,
    );
    for (const c of suspect) {
      const moved = [x[c]! + step[c]!, x[c]! - step[c]!].some((v) => {
        const trial = Float64Array.from(x);
        trial[c] = v;
        probes++;
        try {
          residuals(Array.from(trial));
          return false;
        } catch (e) {
          return (e as Error).message.includes(SURVIVORS_MOVED);
        }
      });
      if (moved) survivorChanged.push(c);
    }
  }

  // Counted in, rather than quoted as the stencil's 2n + 1: a probe is a trial
  // design like any other, and on a merit whose evaluation is the expensive
  // thing a cost readout that omits some of them is the wrong number.
  return { ...base, evaluations: base.evaluations + probes, survivorChanged };
}

/** The checks both entry points make, so neither can drift from the other. */
function validate(
  where: string,
  prescription: Prescription,
  variables: readonly SolveVariable[],
  operands: readonly SystemOperand[],
  hold: readonly SystemCondition[],
): void {
  if (variables.length === 0) throw new Error(`${where}: no variables to move`);
  if (operands.length === 0) throw new Error(`${where}: no operands to minimise`);
  const seen = new Set<string>();
  for (const v of variables) {
    if (!Number.isInteger(v.surface) || v.surface < 0 || v.surface >= prescription.surfaces.length) {
      throw new Error(
        `${where}: surface ${v.surface} is not in a prescription of ` +
          `${prescription.surfaces.length}`,
      );
    }
    const key = `${v.kind}:${v.surface}`;
    if (seen.has(key)) throw new Error(`${where}: ${key} is listed twice`);
    seen.add(key);
  }
  for (const o of operands) {
    const w = o.weight ?? 1;
    if (!(Number.isFinite(w) && w !== 0)) {
      throw new Error(`${where}: a weight of ${w} on a ${o.kind} operand is not a weight`);
    }
  }
  for (const o of hold) {
    // The type says a condition has no weight. The type is not there at run
    // time, and a weight silently ignored would be a caller believing something
    // about the answer that is not true of it.
    if ("weight" in o) {
      throw new Error(
        `${where}: a weight on a held ${o.kind} — a condition is not traded against ` +
          `anything, which is what makes it a condition`,
      );
    }
    // 2N rows is not a condition. Refused here rather than at the reader,
    // because `optimizeSystem` takes a condition's FIRST row on the strength
    // of this and a silent truncation is the shape of bug this file's survivor
    // lock exists to prevent.
    if (o.kind === "rmsSpot" && o.reading === "transverse") {
      throw new Error(
        `${where}: a transverse ${o.kind} is HELD — a condition is one equation and ` +
          `this reading is one per ray, so it can be minimised but not held`,
      );
    }
    // The same refusal in the wavefront's currency (§ 1.8.13). `terms − 1` rows
    // is not one equation either, and the truncation would be just as silent.
    if (o.kind === "wavefront" && "form" in o && o.form === "terms") {
      throw new Error(
        `${where}: a decomposed ${o.kind} is HELD — a condition is one equation and ` +
          `this form is one per Zernike term, so it can be minimised but not held`,
      );
    }
  }
  for (const o of [...operands, ...hold]) {
    if (!Number.isFinite(o.target)) {
      throw new Error(`${where}: a ${o.kind} target of ${o.target} is not a target`);
    }
    if (o.kind === "rmsSpot" && o.pupil.length < 2) {
      throw new Error(
        `${where}: a ${o.kind} operand over ${o.pupil.length} pupil point(s) has no spot to measure`,
      );
    }
    if (o.kind === "rmsSpot" && o.reading === "transverse" && o.target !== 0) {
      throw new Error(
        `${where}: a transverse ${o.kind} operand asks for a target of ${o.target} — ` +
          `a per-ray reading has no summary to aim at, so 0 is the only wish it can carry`,
      );
    }
    if (o.kind === "wavefront") {
      // The term count is refused here rather than left to `fitZernike`,
      // because at this level the message can say which operand asked and how
      // many points it offered — and because a fit that is exactly determined
      // is a different complaint from one that is over-wide.
      if (!Number.isInteger(o.terms) || o.terms < 1 || o.terms > MAX_ZERNIKE_TERMS) {
        throw new Error(
          `${where}: a ${o.kind} operand fitting ${o.terms} terms — ` +
            `1…${MAX_ZERNIKE_TERMS} is what the basis has`,
        );
      }
      if (o.pupil.length < o.terms) {
        throw new Error(
          `${where}: a ${o.kind} operand fits ${o.terms} terms over ` +
            `${o.pupil.length} pupil point(s), before a single ray is lost`,
        );
      }
      if (o.reading === "zernike" && (!Number.isInteger(o.noll) || o.noll < 1 || o.noll > o.terms)) {
        throw new Error(
          `${where}: a ${o.kind} operand reads Noll ${o.noll} out of a ${o.terms}-term fit`,
        );
      }
      // A term count the reading cannot see past is a merit that is EXACTLY
      // zero for every design, and the failure it produces is the worst shape a
      // failure can have here: the run stops at iteration one, on `gradient` —
      // the converged-optimum reason — having never moved the design and
      // reporting a merit of 0. `fitRms` sums from j = 2 and `balancedRms` from
      // j = 5, so those are the counts below which the sum is empty. Refused
      // rather than documented: a caller reading the result has no way to tell
      // this apart from a design that was already perfect.
      // A per-term wish about a summary is the same refusal § 1.8.12 makes
      // per-ray, and for the same reason: "make the RMS 0.001 waves" is a
      // statement about the root-sum-square, and the decomposition is exactly
      // the step that declines to form it. Target 0 — make the wavefront flat
      // in every term it fits — is the only wish these rows can carry.
      if ("form" in o && o.form === "terms" && o.target !== 0) {
        throw new Error(
          `${where}: a decomposed ${o.kind} operand asks for a target of ${o.target} — ` +
            `a per-term reading has no summary to aim at, so 0 is the only wish it can carry`,
        );
      }
      const floor = o.reading === "balancedRms" ? 5 : o.reading === "rms" ? 2 : 1;
      if (o.terms < floor) {
        throw new Error(
          `${where}: a ${o.kind} operand reading ${o.reading} over ${o.terms} terms sums ` +
            `nothing — that reading starts at Noll ${floor}, so its residual would be zero ` +
            `for every design`,
        );
      }
    }
    if (o.kind === "mtf") {
      // ν outside (0, 1) is the same defect the term floor above closes, in
      // this operand's currency: past the cutoff the pupil autocorrelation is
      // empty, so the reading is 0 whatever the design and the residual is a
      // constant. At or below 0 the sample walks off the DC bin the wrong way.
      if (!(o.nu > 0 && o.nu < 1)) {
        throw new Error(
          `${where}: a ${o.kind} operand at ν = ${o.nu} — the modulation is defined on ` +
            `(0, 1) and is identically zero past the cutoff, where a residual measures nothing`,
        );
      }
      if (!Number.isInteger(o.pupilSamples) || o.pupilSamples < 2) {
        throw new Error(
          `${where}: a ${o.kind} operand over ${o.pupilSamples} pupil samples — the FFT ` +
            `grid needs an integer of at least 2`,
        );
      }
      // A `form` here is a decomposition this operand does not have, and
      // § 1.8.14 is why. The rows CAN be spelled: at a frequency bin the
      // reading is |OTF|/OTF(0), so (re, im)/OTF(0) are two signed rows whose
      // squares sum to the reading squared, bitwise. What they cannot spell is
      // the MERIT. Σ rows² is value², and the merit is (value − target)²; the
      // two agree only where the target is 0, and a target of 0 on this
      // operand is a wish for no image at all. Refused by NAME rather than
      // ignored, because a field that falls through a table is § 1.8.13's own
      // defect — silently wrong rather than broken.
      if ("form" in o) {
        throw new Error(
          `${where}: a ${o.kind} operand carries a form — contrast has no decomposed ` +
            `spelling, because Σ rows² is the reading SQUARED and only a target of 0 makes ` +
            `that the merit, which here is a wish for no image at all`,
        );
      }
    }
  }
}

function startingValues(
  prescription: Prescription,
  variables: readonly SolveVariable[],
): number[] {
  return variables.map((v) => {
    const s = prescription.surfaces[v.surface]!;
    return v.kind === "curvature" ? s.curvature : s.thickness;
  });
}

/**
 * The surviving rays' pupil coordinates, flattened — the set a traced operand
 * holds. Stored as the coordinates themselves rather than a count, because a
 * design can lose one ray and gain another and leave the count alone.
 *
 * Written over `PupilPoint` rather than over one producer's row type because
 * there are two producers: `exitBundle`'s `ExitRay` for a spot and `opdMap`'s
 * `OpdSample` for a wavefront. Both carry the pupil coordinate that was ASKED
 * for, so both key the same way — and one function is what stops the two keys
 * from being compared across producers by accident.
 */
function survivorKey(points: readonly PupilPoint[]): Float64Array {
  const k = new Float64Array(points.length * 2);
  for (let i = 0; i < points.length; i++) {
    k[2 * i] = points[i]!.px;
    k[2 * i + 1] = points[i]!.py;
  }
  return k;
}

function sameSurvivors(a: Float64Array, b: Float64Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** One traced operand's reading, and the survivor set it was read over. */
function tracedRead(
  system: OpticalSystem,
  prescription: Prescription,
  operand: TracedCondition,
  share: TrialShare,
): { value: number; rows?: readonly number[]; survivors: Float64Array } {
  return operand.kind === "rmsSpot"
    ? spotRead(system, prescription, operand)
    : operand.kind === "wavefront"
      ? wavefrontRead(system, prescription, operand)
      : mtfRead(system, prescription, operand, share);
}

/**
 * The traced stage a contrast reading is a sample of: one pupil trace and the
 * two transforms over it. Every ν at the same field, wavelength and sampling is
 * a reading off this one array — `mtfAt` indexes it and does nothing else.
 */
interface SharedTransform {
  readonly modulation: Mtf;
  /** `Psf.pupilSamples`, which is the ruler `mtfAt` measures ν against. */
  readonly cutoffBins: number;
  readonly survivors: Float64Array;
}

/**
 * Where the traced stages of ONE trial design are kept while its operands are
 * being read — the channel two frequencies share a trace and a transform
 * through (§ 1.8.15).
 *
 * **It holds one design, not a history.** Both entry points build a trial
 * prescription once per evaluation and hand that same object to every operand
 * in turn, so a slot keyed on object identity is hit by every operand of one
 * evaluation and by none of the next. `withVariable` copies rather than
 * mutates, so identity implies the design and the reading is the one an
 * unshared read would have produced, to the bit.
 *
 * One slot rather than a `WeakMap` over every trial ever built, and the reason
 * is which way each fails. A map's failure is memory — a 128² modulation array
 * is a megabyte, and a caller holding designs alive would hold those alive too.
 * A slot's failure is a cache MISS: an interleaved read order re-traces and is
 * merely as slow as it was before this existed. A wrong answer is not among the
 * failures either way, which is what makes the cheap one the right one.
 */
type TrialShare = (
  prescription: Prescription,
  key: string,
  build: () => SharedTransform,
) => SharedTransform;

function trialShare(): TrialShare {
  let design: Prescription | undefined;
  const built = new Map<string, SharedTransform>();
  return (prescription, key, build) => {
    if (design !== prescription) {
      design = prescription;
      built.clear();
    }
    let hit = built.get(key);
    if (hit === undefined) {
      // Only a SUCCESS is kept. A trace that throws is a wall, and the throw
      // leaves the whole evaluation before a second operand is ever asked, so
      // there is no repeat to save and no failure to remember wrongly.
      hit = build();
      built.set(key, hit);
    }
    return hit;
  };
}

/**
 * One MTF reading, and the traced samples underneath it.
 *
 * Goes through `systemPupil` and `psfFromSystemPupil` rather than `psf()` for
 * one reason: `systemPupil` carries out the traced samples, so the survivor set
 * this operand holds is the SAME set the pupil was fitted from, taken from the
 * one place that decides what a system's pupil is. Tracing separately for the
 * key would have been a second definition waiting to drift.
 */
function mtfRead(
  system: OpticalSystem,
  prescription: Prescription,
  operand: MtfCondition,
  share: TrialShare,
): { value: number; survivors: Float64Array } {
  const options = {
    pupilSamples: operand.pupilSamples,
    padFactor: operand.padFactor ?? 4,
    traceSamples: operand.traceSamples ?? 21,
    zernikeTerms: operand.zernikeTerms ?? 28,
  };
  // The key is built from the RESOLVED options, not from the operand's own
  // fields, so two frequencies that spell the same sampling differently — one
  // omitting `padFactor`, one stating the same 4 — share the trace rather than
  // silently paying for it twice. ν is deliberately absent: it is the one thing
  // that does not change the array.
  const key = [
    operand.fieldValue,
    operand.wavelengthNm,
    options.pupilSamples,
    options.padFactor,
    options.traceSamples,
    options.zernikeTerms,
  ].join("/");
  const { modulation, cutoffBins, survivors } = share(prescription, key, () => {
    const trial: OpticalSystem = { ...system, prescription };
    const pupil = systemPupil(trial, operand.fieldValue, operand.wavelengthNm, options);
    const image = psfFromSystemPupil(pupil, operand.fieldValue, options);
    return {
      modulation: mtf(image),
      cutoffBins: image.pupilSamples,
      survivors: survivorKey(pupil.samples),
    };
  });
  return { value: mtfAt(modulation, operand.nu, cutoffBins), survivors };
}

/**
 * One wavefront reading, and the samples it was fitted over.
 *
 * `opdMap` throws when the chief ray fails or does not reach the reference
 * sphere. That is a wall in this file's sense and needs no handling here: the
 * throw propagates to `evaluate`, which rejects the trial and raises the
 * damping, exactly as an afocal trial or a lost ray does. At the STARTING
 * design `optimizeSystem` turns the same throw into a named refusal.
 */
function wavefrontRead(
  system: OpticalSystem,
  prescription: Prescription,
  operand: WavefrontCondition,
): { value: number; rows?: readonly number[]; survivors: Float64Array } {
  const trial: OpticalSystem = { ...system, prescription };
  const map = opdMap(trial, operand.fieldValue, operand.wavelengthNm, operand.pupil);
  const survivors = survivorKey(map.samples);
  // Counted before the fit is asked for. `fitZernike` refuses an
  // underdetermined fit with a message about sample counts, which is true and
  // does not say that the shortfall is vignetting rather than a small grid.
  if (map.samples.length < operand.terms) {
    throw new Error(
      `a ${operand.kind} operand fitting ${operand.terms} terms has ` +
        `${map.samples.length} of ${operand.pupil.length} rays surviving`,
    );
  }
  const fit = fitZernike(map.samples, operand.terms);
  if (operand.reading === "zernike") {
    return { value: coefficient(fit, operand.noll), survivors };
  }
  const balanced = operand.reading === "balancedRms";
  const value = balanced ? balancedRms(fit) : fitRms(fit);
  if (operand.form !== "terms") return { value, survivors };
  // The terms of the sum the reading already IS. No 1/√N: the spot needed one
  // because `rmsRadius` is a mean over rays, and Σ c_j² is the fitted RMS
  // squared with no averaging in it. `validate` refuses a term count below the
  // first index, so this slice is never empty.
  return { value, rows: Array.from(fit.coefficients.subarray((balanced ? 5 : 2) - 1)), survivors };
}

/** One traced SPOT reading, and the rays it was measured over. */
function spotRead(
  system: OpticalSystem,
  prescription: Prescription,
  operand: SpotCondition,
): { value: number; rows?: readonly number[]; survivors: Float64Array } {
  const trial: OpticalSystem = { ...system, prescription };
  const bundle = exitBundle(trial, operand.fieldValue, operand.wavelengthNm, operand.pupil);
  const survivors = survivorKey(bundle.rays);
  // Counted before the spot is asked for. `bestSpotZ` refuses a bundle of one
  // ray with a message about focus, which is true and is not what went wrong.
  if (bundle.rays.length < 2) {
    throw new Error(
      `a ${operand.kind} operand has ${bundle.rays.length} of ${operand.pupil.length} ` +
        `rays surviving — a spot needs two`,
    );
  }
  const z =
    operand.focus === "bestSpot"
      ? bestSpotZ(bundle)
      : imagePlaneZ(asCompiled(prescription), trial);
  const spot = spotAt(bundle, z);
  if ((operand.reading ?? "rms") === "rms") return { value: spot.rmsRadius, survivors };
  // One signed row per ray per axis, scaled so Σ rows² IS the RMS squared: the
  // merit is the same number and only the model the step is built on changes.
  // The survivor lock above is what makes the LENGTH of this vector a constant
  // of the run — a ray leaving the set is a wall, not a shorter merit.
  const k = 1 / Math.sqrt(spot.points.length);
  const rows: number[] = [];
  for (const p of spot.points) {
    rows.push((p.x - spot.centroidX) * k, (p.y - spot.centroidY) * k);
  }
  return { value: spot.rmsRadius, rows, survivors };
}

/**
 * Damped least squares over the numbers of a SYSTEM, which is what a traced
 * operand needs — a spot has a field, an aperture and a conjugate, and a
 * prescription alone has none of them.
 *
 * Paraxial and third-order operands are accepted here too and mean exactly what
 * they mean in `optimizePrescription`, so a merit may mix them: "hold the power
 * and shrink the spot" is one question, not two.
 *
 * The traced operands' survivor sets are fixed at the starting design (see the
 * module header). A start that cannot show a spot is refused HERE, by name,
 * rather than reaching the solver as an unhelpfully general "not a system".
 */
export function optimizeSystem(
  system: OpticalSystem,
  variables: readonly SolveVariable[],
  request: SystemRequest,
  options: DlsOptions = {},
): DlsResult {
  const prescription = system.prescription;
  const { minimize, hold } = asked<SystemOperand, SystemCondition>(request);
  validate("optimizeSystem", prescription, variables, minimize, hold);
  const read = systemReader("optimizeSystem", system, [...minimize, ...hold]);

  const residuals = (x: readonly number[]): MeritVector => {
    const trial = withVariables(prescription, variables, x);
    // `flatMap`, because a `"transverse"` spot is 2N rows of one wish rather
    // than one row (§ 1.8.12). Every other operand returns a single-element
    // array, so the vector this builds is bitwise what it was.
    const wishes = minimize.flatMap((o, i) => {
      const w = (o as OptimizeOperand).weight ?? 1;
      return read(trial, o, i).map((v) => w * v);
    });
    if (hold.length === 0) return wishes;
    // A condition stays one row — `validate` refuses the reading that is not.
    return { minimize: wishes, hold: hold.map((o, k) => read(trial, o, minimize.length + k)[0]!) };
  };

  return dampedLeastSquares(
    residuals,
    startingValues(prescription, variables),
    withDesignSteps(prescription, variables, [...minimize, ...hold], options),
  );
}

/** The sentence a wall gets when it was a ray leaving the set, so it can be recognised again. */
const SURVIVORS_MOVED = "surviving rays changed";

/**
 * One operand's residual at a trial design, with the survivor sets locked at
 * `system`'s own prescription — the reader `optimizeSystem` steps with and
 * `systemResponse` differences, written once so the two cannot disagree about
 * what a traced merit IS.
 *
 * The lock is anchored at the system handed in, which is the point being read.
 * Passing the design a run STOPPED on therefore re-anchors it, and has to:
 * survivors carried over from the seed would wall every column at the answer
 * and report a merit that can see nothing, which is a statement about the
 * bookkeeping and not about the design.
 *
 * Refuses at construction, by operand index, when an operand cannot be read at
 * that design at all — `exitBundle` reports what vignetted, so the message can
 * name the count rather than the symptom. Conditions are numbered after the
 * wishes in one space, so a message points at exactly one operand.
 */
function systemReader(
  where: string,
  system: OpticalSystem,
  all: readonly SystemCondition[],
): (trial: Prescription, o: SystemCondition, i: number) => readonly number[] {
  const survivorsOf = new Map<number, Float64Array>();
  // Shared by the starting reads below AND by every trial the returned reader
  // is asked for, which is what makes the lock and the run one trace: the
  // start's design is a design like any other, so N frequencies key it once.
  const share = trialShare();
  all.forEach((o, i) => {
    if (!isTraced(o)) return;
    let survivors: Float64Array;
    try {
      ({ survivors } = tracedRead(system, system.prescription, o, share));
    } catch (e) {
      throw new Error(`${where}: operand ${i} cannot be read at the start — ${(e as Error).message}`);
    }
    survivorsOf.set(i, survivors);
  });

  return (trial: Prescription, o: SystemCondition, i: number): readonly number[] => {
    if (!isTraced(o)) return [operandValue(trial, o) - o.target];
    // The survivor check stays HERE, per operand, on the shared reading: what
    // is shared is the trace, not the bookkeeping, so a message still names the
    // one operand whose set moved.
    const { value, rows, survivors } = tracedRead(system, trial, o, share);
    if (!sameSurvivors(survivors, survivorsOf.get(i)!)) {
      // Not a worse design — a different question. Same treatment as any
      // other wall: the step is undone and the damping rises.
      throw new Error(
        `${where}: operand ${i}'s ${SURVIVORS_MOVED}, ` +
          `${survivorsOf.get(i)!.length / 2} → ${survivors.length / 2}`,
      );
    }
    // `rows` is the per-ray reading, and it carries its own target (0, which
    // `validate` is what makes true) rather than subtracting one here.
    return rows ?? [value - o.target];
  };
}
