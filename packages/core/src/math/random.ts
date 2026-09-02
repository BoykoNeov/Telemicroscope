/**
 * A seeded pseudo-random generator — for the parts of the engine that are
 * *statistical* rather than deterministic.
 *
 * Almost nothing here is random: a ray trace is exact, a PSF is a transform.
 * Atmospheric turbulence is the exception — a Kolmogorov phase screen is a
 * random draw from a known spectrum (`wave/seeing`), and its validation rungs
 * average many draws to recover a closed form. Those rungs have to be
 * *reproducible*, which `Math.random` is not: it cannot be seeded, so a test
 * that averages 40 screens could pass on one run and fail on the next. So the
 * engine carries its own small generator, seeded explicitly, and never reaches
 * for the global one.
 *
 * `mulberry32` is a 32-bit generator with a full 2³² period and good
 * equidistribution for the low-dimensional use here (a few thousand normals per
 * screen). It is not cryptographic and does not need to be — the requirement is
 * "same seed, same screen", not unpredictability.
 */
export interface Rng {
  /** Next uniform in [0, 1). */
  readonly next: () => number;
  /** Next standard normal, mean 0 variance 1. */
  readonly nextGaussian: () => number;
}

/**
 * Seed a `mulberry32` generator. Any 32-bit seed gives a distinct stream; the
 * same seed always gives the same stream, which is the whole point.
 */
export function mulberry32(seed: number): Rng {
  let state = seed >>> 0;
  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  // Box–Muller draws two independent normals from two uniforms; the spare is
  // cached so no draw is wasted.
  let spare: number | null = null;
  const nextGaussian = (): number => {
    if (spare !== null) {
      const v = spare;
      spare = null;
      return v;
    }
    // u1 must avoid 0 or log(0) is −∞; next() is already < 1, so only the low
    // end needs guarding.
    let u1 = next();
    while (u1 <= Number.MIN_VALUE) u1 = next();
    const u2 = next();
    const mag = Math.sqrt(-2 * Math.log(u1));
    spare = mag * Math.sin(2 * Math.PI * u2);
    return mag * Math.cos(2 * Math.PI * u2);
  };
  return { next, nextGaussian };
}

/**
 * ln(k!) for a non-negative integer, to f64 accuracy at every k.
 *
 * Below 20 it is the product, summed as logs so it cannot overflow; from 20
 * up it is Stirling's series through the 1/k⁵ term, whose next term is
 * 1/(1680·k⁷) < 2·10⁻¹² — below f64's resolution of ln(20!) ≈ 42. Kept
 * private: it exists for `poisson` and is not a Γ function.
 */
function logFactorial(k: number): number {
  if (k < 20) {
    let acc = 0;
    for (let i = 2; i <= k; i++) acc += Math.log(i);
    return acc;
  }
  const k2 = k * k;
  return (
    (k + 0.5) * Math.log(k) -
    k +
    0.5 * Math.log(2 * Math.PI) +
    1 / (12 * k) -
    1 / (360 * k * k2) +
    1 / (1260 * k * k2 * k2)
  );
}

/**
 * Where the Poisson sampler switches algorithm. Knuth's product of uniforms
 * costs one uniform per unit of mean and its threshold e^(−μ) underflows
 * long before this; the transformed rejection above it is constant-cost.
 * Both are exact samplers, so the seam is a cost decision and not a
 * distributional one — VALIDATION § 8a.4 measures both sides of it.
 */
export const POISSON_KNUTH_LIMIT = 30;

/**
 * One draw from a Poisson distribution of the given mean.
 *
 * The one random draw a camera makes: photon arrivals are Poisson, so a pixel
 * that expects μ photons records this many, and the shot noise every real
 * image carries is nothing but this draw applied per pixel (`imaging/noise`).
 *
 * Two exact samplers, chosen by the mean:
 *
 *  - **μ < 30 — Knuth.** Multiply uniforms until the product falls below
 *    e^(−μ); the count of factors, less one, is Poisson(μ). Exact, and costs
 *    ~μ uniforms.
 *  - **μ ≥ 30 — PTRS** (Hörmann 1993, "The transformed rejection method for
 *    generating Poisson random variables"). A rejection sampler under a
 *    transformed hat with acceptance above 0.9 for all large μ; exact, and
 *    constant cost. The constants are the published ones and the same ones
 *    NumPy ships. The squeeze (`us ≥ 0.07 && v ≤ vr`) accepts most draws
 *    without evaluating the log-factorial; the rest go through the exact test.
 *
 * A mean of exactly zero returns zero without touching the generator, so a
 * dark pixel costs nothing and consumes no stream.
 */
export function poisson(mean: number, rng: Rng): number {
  if (!(mean >= 0) || !Number.isFinite(mean)) {
    throw new Error(`Poisson mean must be finite and non-negative, got ${mean}`);
  }
  if (mean === 0) return 0;
  if (mean < POISSON_KNUTH_LIMIT) {
    const limit = Math.exp(-mean);
    let k = 0;
    let product = 1;
    do {
      k++;
      product *= rng.next();
    } while (product > limit);
    return k - 1;
  }
  const sqrtMean = Math.sqrt(mean);
  const logMean = Math.log(mean);
  const b = 0.931 + 2.53 * sqrtMean;
  const a = -0.059 + 0.02483 * b;
  const invAlpha = 1.1239 + 1.1328 / (b - 3.4);
  const vr = 0.9277 - 3.6224 / (b - 2);
  for (;;) {
    const u = rng.next() - 0.5;
    const v = rng.next();
    const us = 0.5 - Math.abs(u);
    const k = Math.floor(((2 * a) / us + b) * u + mean + 0.43);
    if (us >= 0.07 && v <= vr) return k;
    if (k < 0 || (us < 0.013 && v > us)) continue;
    if (
      Math.log(v) + Math.log(invAlpha) - Math.log(a / (us * us) + b) <=
      -mean + k * logMean - logFactorial(k)
    ) {
      return k;
    }
  }
}
