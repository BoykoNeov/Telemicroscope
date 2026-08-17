import { Prescription } from "../trace/prescription";
import { OpticalSystem } from "../trace/system";
import { paraxialTrace, systemProperties } from "../trace/paraxial";
import { asCompiled } from "../trace/compile";
import { householderLeastSquares } from "../math/lsq";
import { PupilPoint } from "../pupil/aiming";
import { imagePlaneZ } from "../pupil/pupils";
import { exitBundle, spotAt, bestSpotZ, type ExitRay } from "./spot";
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
  /** ‖Jᵀr‖ fell below `gradientTolerance`, measured scale-free. The optimum. */
  | "gradient"
  /** The step got shorter than `stepTolerance` — the variables stopped moving. */
  | "step"
  /** An accepted step changed the merit by less than `meritTolerance`. */
  | "merit"
  /** `maxIterations` used up. Not a converged answer, and says so. */
  | "iterations"
  /** λ grew past every scale in the problem: every step, however short, failed. */
  | "damping";

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
   * Absolute finite-difference step per variable. Default: εʰ·max(|xⱼ|, 1),
   * with h = 1/2 for forward differences and 1/3 for central — the exponents
   * that balance truncation against cancellation for each scheme.
   *
   * The `max(…, 1)` floor is a unit assumption and the one place this module
   * makes one: a variable that starts at exactly 0 has no scale of its own, and
   * 1 is right for a curvature in 1/mm and a thickness in mm alike only because
   * both are O(1)-ish in this engine's units. State the steps when they are not.
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
}

export interface DlsResult {
  /** The variable values at the stopping point. */
  readonly x: readonly number[];
  /** The residual vector there — weights already applied. */
  readonly residuals: readonly number[];
  /** Σ rᵢ², the merit. */
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
}

/** `residuals` with the wall convention applied: `null` means "not a system". */
type Guarded = (x: Float64Array) => Float64Array | null;

/**
 * Minimise Σ rᵢ(x)² over x by damped least squares.
 *
 * `residuals` returns the residual vector — already weighted, already
 * target-subtracted — and may throw or return a non-finite entry for an x that
 * is not a system. There may be fewer residuals than variables: damping keeps
 * the step well-posed where Gauss–Newton alone would not be, and the surplus
 * freedom simply does not move.
 */
export function dampedLeastSquares(
  residuals: (x: readonly number[]) => readonly number[],
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
  const lambda0 = options.initialDamping ?? 1e-3;
  if (!(lambda0 > 0)) {
    throw new Error(`dampedLeastSquares: the initial damping ${lambda0} is not positive`);
  }
  if (options.steps !== undefined && options.steps.length !== n) {
    throw new Error(
      `dampedLeastSquares: ${options.steps.length} finite-difference steps for ${n} variables`,
    );
  }

  let evaluations = 0;
  let m = -1;
  const evaluate: Guarded = (x) => {
    evaluations++;
    let out: readonly number[];
    try {
      out = residuals(Array.from(x));
    } catch {
      return null;
    }
    if (m < 0) m = out.length;
    else if (out.length !== m) {
      throw new Error(
        `dampedLeastSquares: the residual vector changed length, ${m} → ${out.length}`,
      );
    }
    const r = new Float64Array(m);
    for (let i = 0; i < m; i++) {
      const v = out[i]!;
      if (!Number.isFinite(v)) return null;
      r[i] = v;
    }
    return r;
  };

  let x = Float64Array.from(x0);
  let r = evaluate(x);
  if (r === null) {
    throw new Error(
      `dampedLeastSquares: the starting point [${x0.join(", ")}] is not a system — ` +
        `there is nothing to damp away from`,
    );
  }
  if (m === 0) throw new Error("dampedLeastSquares: no residuals to minimise");
  let merit = sumSquares(r);

  const step = new Float64Array(n);
  for (let j = 0; j < n; j++) {
    const auto = (scheme === "central" ? Math.cbrt(Number.EPSILON) : Math.sqrt(Number.EPSILON)) *
      Math.max(Math.abs(x[j]!), 1);
    const s = options.steps?.[j] ?? auto;
    if (!(s > 0 && Number.isFinite(s))) {
      throw new Error(`dampedLeastSquares: variable ${j}'s difference step ${s} is not positive`);
    }
    step[j] = s;
  }

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

  const j = new Float64Array(m * n);
  const a = new Float64Array((m + n) * n);
  const b = new Float64Array(m + n);

  let iterations = 0;
  while (iterations < maxIterations) {
    iterations++;

    // ---- Jacobian, column by column, with the wall convention on the stencil.
    for (let c = 0; c < n; c++) {
      const h = step[c]!;
      const xc = x[c]!;
      const xp = Float64Array.from(x);
      xp[c] = xc + h;
      const rp = evaluate(xp);
      let rm: Float64Array | null = null;
      if (scheme === "central") {
        const xm = Float64Array.from(x);
        xm[c] = xc - h;
        rm = evaluate(xm);
      }
      if (rp !== null && rm !== null) {
        // Both sides available: the O(h²) difference this scheme exists for.
        const twoH = 2 * h;
        for (let i = 0; i < m; i++) j[i * n + c] = (rp[i]! - rm[i]!) / twoH;
      } else if (rp !== null) {
        for (let i = 0; i < m; i++) j[i * n + c] = (rp[i]! - r[i]!) / h;
      } else {
        // Forward is a wall. Difference backwards instead; the accuracy of this
        // one column drops to O(h), the run continues.
        const xm = Float64Array.from(x);
        xm[c] = xc - h;
        const back = rm ?? evaluate(xm);
        if (back !== null) {
          for (let i = 0; i < m; i++) j[i * n + c] = (r[i]! - back[i]!) / h;
        } else {
          // Walled on both sides: no information about this variable, so it
          // does not move. `math/lsq` returns 0 for the column either way; this
          // is the same answer said explicitly rather than by rank deficiency.
          for (let i = 0; i < m; i++) j[i * n + c] = 0;
        }
      }
    }

    // ---- Scale-free gradient measure, and the column norms the damping wants.
    const rNorm = Math.sqrt(merit);
    let worst = 0;
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
      const denom = Math.sqrt(col) * rNorm;
      const cosine = denom > 0 ? Math.abs(dot) / denom : 0;
      if (cosine > worst) worst = cosine;
    }
    gradient = worst;
    if (worst <= gradientTolerance) {
      reason = "gradient";
      break;
    }

    // ---- The damped step, as an augmented least-squares problem.
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
    const delta = householderLeastSquares(a, m + n, n, b);

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
    const rNew = evaluate(xNew);

    if (rNew === null) {
      // A wall. Indistinguishable, from here, from a step that made things
      // worse — and treated the same way.
      rejected++;
      lambda *= nu;
      nu *= 2;
      if (!Number.isFinite(lambda)) {
        reason = "damping";
        break;
      }
      continue;
    }

    const meritNew = sumSquares(rNew);
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
    const rho = predicted > 0 ? (merit - meritNew) / predicted : meritNew < merit ? 1 : -1;

    if (meritNew < merit) {
      accepted++;
      const change = merit === 0 ? 0 : (merit - meritNew) / merit;
      x = xNew;
      r = rNew;
      merit = meritNew;
      // Nielsen's update: the better the linear model predicted the outcome, the
      // more the damping relaxes — down to a third, never further in one step.
      lambda *= Math.max(1 / 3, 1 - (2 * rho - 1) ** 3);
      nu = 2;
      if (change < meritTolerance) {
        reason = "merit";
        break;
      }
    } else {
      rejected++;
      lambda *= nu;
      nu *= 2;
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
    evaluations,
    damping: lambda,
    gradient,
    reason,
  };
}

function sumSquares(v: Float64Array): number {
  let s = 0;
  for (let i = 0; i < v.length; i++) s += v[i]! * v[i]!;
  return s;
}

/**
 * One thing a merit can ask a prescription for.
 *
 * Every operand carries its own wavelength, which is the difference between
 * this and `solveParaxial`: a solve answers a question at one line, and the
 * first merit worth writing — hold the power, kill the colour — is a question
 * about two.
 *
 * `weight` multiplies the residual before it is squared, and its unit is
 * 1/(this operand's unit). See the module header: nothing here can choose it.
 */
export type OptimizeOperand =
  /**
   * System power 1/EFL (1/mm), by the engine's own EFL convention. Unlike an
   * `efl` operand this has no pole and no wall — an afocal system has power
   * zero, which is a number a merit can walk through.
   */
  | { readonly kind: "power"; readonly wavelengthNm: number; readonly target: number; readonly weight?: number }
  /** Effective focal length (mm). Afocal is a wall, as everywhere else. */
  | { readonly kind: "efl"; readonly wavelengthNm: number; readonly target: number; readonly weight?: number }
  /** Back focal distance, last vertex → paraxial focus (mm, signed). */
  | { readonly kind: "bfd"; readonly wavelengthNm: number; readonly target: number; readonly weight?: number }
  /**
   * P(λ₁) − P(λ₂), the axial colour of the system in 1/mm. Target 0 is the
   * achromatic condition, stated in the currency it is actually linear in.
   */
  | {
      readonly kind: "chromaticPower";
      readonly wavelengthsNm: readonly [number, number];
      readonly target: number;
      readonly weight?: number;
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
      readonly weight?: number;
    };

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
 * variable because the image has to land somewhere fixed. Hold the power with a
 * `power` operand and both are well posed, and then they still disagree: 0.7120
 * against 0.2257 in shape factor, each beating the other on the measure it was
 * asked for.
 */
export type TracedFocus = "bestSpot" | "systemImagePlane";

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
export type TracedOperand = {
  /** RMS spot radius (mm), about the centroid, unweighted by throughput. */
  readonly kind: "rmsSpot";
  /** Field angle in degrees, or object height in mm — as the system spells it. */
  readonly fieldValue: number;
  readonly wavelengthNm: number;
  /** The rays. Fixed for the whole run; `pupilGrid`/`pupilFan` build them. */
  readonly pupil: readonly PupilPoint[];
  readonly focus: TracedFocus;
  readonly target: number;
  readonly weight?: number;
};

/** Anything `optimizeSystem` can be asked for. */
export type SystemOperand = OptimizeOperand | TracedOperand;

const isTraced = (o: SystemOperand): o is TracedOperand => o.kind === "rmsSpot";

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

function operandValue(prescription: Prescription, operand: OptimizeOperand): number {
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
 */
export function optimizePrescription(
  prescription: Prescription,
  variables: readonly SolveVariable[],
  operands: readonly OptimizeOperand[],
  options: DlsOptions = {},
): DlsResult {
  validate("optimizePrescription", prescription, variables, operands);

  const residuals = (x: readonly number[]): readonly number[] => {
    const trial = withVariables(prescription, variables, x);
    return operands.map((o) => (o.weight ?? 1) * (operandValue(trial, o) - o.target));
  };

  return dampedLeastSquares(residuals, startingValues(prescription, variables), options);
}

/** The checks both entry points make, so neither can drift from the other. */
function validate(
  where: string,
  prescription: Prescription,
  variables: readonly SolveVariable[],
  operands: readonly SystemOperand[],
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
    if (!Number.isFinite(o.target)) {
      throw new Error(`${where}: a ${o.kind} target of ${o.target} is not a target`);
    }
    if (isTraced(o) && o.pupil.length < 2) {
      throw new Error(
        `${where}: a ${o.kind} operand over ${o.pupil.length} pupil point(s) has no spot to measure`,
      );
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
 */
function survivorKey(rays: readonly ExitRay[]): Float64Array {
  const k = new Float64Array(rays.length * 2);
  for (let i = 0; i < rays.length; i++) {
    k[2 * i] = rays[i]!.px;
    k[2 * i + 1] = rays[i]!.py;
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
  operand: TracedOperand,
): { value: number; survivors: Float64Array } {
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
  return { value: spotAt(bundle, z).rmsRadius, survivors };
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
  operands: readonly SystemOperand[],
  options: DlsOptions = {},
): DlsResult {
  const prescription = system.prescription;
  validate("optimizeSystem", prescription, variables, operands);

  // The survivor sets, and the refusal that says which operand could not be
  // read and how far short it fell. `exitBundle` reports what vignetted, so the
  // message can name the count rather than the symptom.
  const held = new Map<number, Float64Array>();
  operands.forEach((o, i) => {
    if (!isTraced(o)) return;
    let survivors: Float64Array;
    try {
      ({ survivors } = tracedRead(system, prescription, o));
    } catch (e) {
      throw new Error(`optimizeSystem: operand ${i} cannot be read at the start — ${(e as Error).message}`);
    }
    held.set(i, survivors);
  });

  const residuals = (x: readonly number[]): readonly number[] => {
    const trial = withVariables(prescription, variables, x);
    return operands.map((o, i) => {
      const w = o.weight ?? 1;
      if (!isTraced(o)) return w * (operandValue(trial, o) - o.target);
      const { value, survivors } = tracedRead(system, trial, o);
      if (!sameSurvivors(survivors, held.get(i)!)) {
        // Not a worse design — a different question. Same treatment as any
        // other wall: the step is undone and the damping rises.
        throw new Error(
          `optimizeSystem: operand ${i}'s surviving rays changed, ` +
            `${held.get(i)!.length / 2} → ${survivors.length / 2}`,
        );
      }
      return w * (value - o.target);
    });
  };

  return dampedLeastSquares(residuals, startingValues(prescription, variables), options);
}
