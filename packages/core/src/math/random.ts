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
