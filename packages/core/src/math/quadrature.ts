/**
 * Adaptive quadrature, for integrands this engine builds rather than picks.
 *
 * Nothing here is new physics. It exists because § 6ab.14 needed the *area* of
 * a set that is defined a row at a time — exactly on each row, and with kinks
 * between rows wherever the row's description changes — and neither of the two
 * habits already in the repo covers that. Fixed-node sampling (the wavelength
 * weights of `quadratureSamples`, the pupil lattices) is right when the
 * integrand is smooth and the node count is a cost the caller is choosing;
 * a closed form is right when there is one. An integrand with a square-root
 * endpoint and a dozen slope discontinuities at coordinates the caller cannot
 * enumerate is neither, and a uniform rule on it converges at a rate that would
 * hide behind the number it is trying to produce.
 *
 * ## Why a Gauss–Kronrod pair and not Simpson halving
 *
 * The 15-point Kronrod rule *reuses* all seven Gauss nodes, so the error
 * estimate |K₁₅ − G₇| costs eight extra evaluations rather than a second full
 * pass, and it is an estimate of the better rule's error rather than of the
 * worse one's. On the smooth stretches — which is most of the domain once the
 * caller has split at the breakpoints it does know — G₇ is already at f64
 * roundoff and the panel is accepted without recursion. The recursion is then
 * spent entirely near the kinks, which is the whole point of adaptivity: a
 * uniform rule pays the same price everywhere and is set by its worst piece.
 *
 * The nodes are the standard ones, and they are pinned rather than trusted:
 * `quadrature.test.ts` recovers π/4 from ∫₀¹√(1−x²) dx (a square-root endpoint,
 * the case the fixed rules fail on) and a polynomial of degree 21, which is one
 * past what G₇ alone integrates exactly and so cannot pass on the Gauss nodes'
 * strength.
 *
 * ## The tolerance is absolute, and it is a budget rather than a target
 *
 * Each bisection gives half the parent's tolerance to each child, so the sum
 * over accepted panels is bounded by the tolerance the caller asked for — an
 * error *bound*, not a hope. The cost of that is that a genuinely singular
 * integrand demands geometrically finer panels until `maxDepth`, and hitting
 * that cap means the answer is NOT to tolerance. It throws there rather than
 * returning the last Kronrod value: a quadrature that quietly returns whatever
 * it reached is the same failure mode as a readout printed where its quantity
 * does not exist, which is the defect § 6ab.12 was about.
 */

/** Gauss 7-point nodes on [−1, 1]. Every one is also a Kronrod node. */
const GAUSS7_NODES = [
  0, 0.4058451513773972, -0.4058451513773972, 0.7415311855993945, -0.7415311855993945,
  0.9491079123427585, -0.9491079123427585,
] as const;

const GAUSS7_WEIGHTS = [
  0.4179591836734694, 0.3818300505051189, 0.3818300505051189, 0.2797053914892766,
  0.2797053914892766, 0.1294849661688697, 0.1294849661688697,
] as const;

/** Kronrod 15-point nodes: the seven above, interlaced with eight more. */
const KRONROD15_NODES = [
  0, 0.4058451513773972, -0.4058451513773972, 0.7415311855993945, -0.7415311855993945,
  0.9491079123427585, -0.9491079123427585, 0.2077849550078985, -0.2077849550078985,
  0.5860872354676911, -0.5860872354676911, 0.8648644233597691, -0.8648644233597691,
  0.9914553711208126, -0.9914553711208126,
] as const;

const KRONROD15_WEIGHTS = [
  0.2094821410847278, 0.1903505780647854, 0.1903505780647854, 0.1406532597155259,
  0.1406532597155259, 0.0630920926299785, 0.0630920926299785, 0.2044329400752989,
  0.2044329400752989, 0.1690047266392679, 0.1690047266392679, 0.1047900103222502,
  0.1047900103222502, 0.0229353220105292, 0.0229353220105292,
] as const;

export interface QuadratureOptions {
  /** Absolute error budget for the whole interval. Default 1e-12. */
  readonly tolerance?: number;
  /** Bisections allowed below the top panel before the call refuses. Default 40. */
  readonly maxDepth?: number;
}

function panel(
  f: (x: number) => number,
  a: number,
  b: number,
  tolerance: number,
  depth: number,
  maxDepth: number,
): number {
  const half = (b - a) / 2;
  const mid = (a + b) / 2;
  let gauss = 0;
  for (let i = 0; i < GAUSS7_NODES.length; i++) {
    gauss += GAUSS7_WEIGHTS[i]! * f(mid + half * GAUSS7_NODES[i]!);
  }
  let kronrod = 0;
  for (let i = 0; i < KRONROD15_NODES.length; i++) {
    kronrod += KRONROD15_WEIGHTS[i]! * f(mid + half * KRONROD15_NODES[i]!);
  }
  gauss *= half;
  kronrod *= half;
  if (Math.abs(kronrod - gauss) <= tolerance) return kronrod;
  if (depth >= maxDepth) {
    throw new Error(
      `adaptiveIntegral: [${a}, ${b}] still estimates ${Math.abs(kronrod - gauss).toExponential(2)} ` +
        `of error against a budget of ${tolerance.toExponential(2)} after ${maxDepth} bisections. ` +
        `Split the integral at the integrand's own breakpoints, or ask for less.`,
    );
  }
  return (
    panel(f, a, mid, tolerance / 2, depth + 1, maxDepth) +
    panel(f, mid, b, tolerance / 2, depth + 1, maxDepth)
  );
}

/**
 * ∫ₐᵇ f, to an absolute tolerance, by bisecting where the Gauss–Kronrod pair
 * disagrees.
 *
 * `a > b` is an error rather than a sign flip: every caller here is integrating
 * a length or an area over an interval it built itself, so a reversed interval
 * is a bug in the caller and not a request for a negative answer. `a === b`
 * returns 0, which is the one degenerate case that is a legitimate limit.
 *
 * **Split at the breakpoints you know before calling.** The adaptivity is for
 * the kinks a caller cannot enumerate; feeding it one panel spanning a
 * discontinuity it could have avoided spends recursion on work that a single
 * extra call would have made free.
 */
export function adaptiveIntegral(
  f: (x: number) => number,
  a: number,
  b: number,
  options: QuadratureOptions = {},
): number {
  const tolerance = options.tolerance ?? 1e-12;
  const maxDepth = options.maxDepth ?? 40;
  if (!Number.isFinite(a) || !Number.isFinite(b)) {
    throw new Error(`adaptiveIntegral needs finite limits, got [${a}, ${b}]`);
  }
  if (b < a) {
    throw new Error(`adaptiveIntegral needs a <= b, got [${a}, ${b}]`);
  }
  if (!(tolerance > 0)) {
    throw new Error(`adaptiveIntegral tolerance must be > 0, got ${tolerance}`);
  }
  if (!Number.isInteger(maxDepth) || maxDepth < 1) {
    throw new Error(`adaptiveIntegral maxDepth must be a positive integer, got ${maxDepth}`);
  }
  if (a === b) return 0;
  return panel(f, a, b, tolerance, 0, maxDepth);
}
