import { describe, it, expect } from "vitest";
import {
  MAX_ZERNIKE_TERMS,
  fitZernike,
  wavefrontSampler,
  zernike,
  zernikeBasis,
  type WavefrontSample,
  type ZernikeFit,
} from "../src/wave/zernike";
import { householderLeastSquares } from "../src/math/lsq";
import { opdMap } from "../src/pupil/opd";
import { pupilGrid } from "../src/pupil/aiming";
import { laidPupil } from "../src/wave/psf";
import { finiteConjugateMicroscope, finiteConjugateObjective } from "../src/designs/microscope";
import { infinityCorrectedMicroscope, tubeLens } from "../src/designs/microscope";
import { oilImmersionObjective } from "../src/designs/immersion";

/**
 * § 2k — what the exit layout costs, and where.
 *
 * Register item 24 put the trace COST first: § 2i measured 35% more traces and
 * one 10× mosaic render timing out, and § 2j added 124 traces per pupil. Traces
 * are not where it goes. Measured per pupil, all 317 of a map's traces cost
 * 0.3–1.8 ms; on a brightfield tile the exit layout ran 2.4× to 5× the aim
 * layout's wall time and ~95% of it was `PupilFunction.amplitude` — the
 * exit layout evaluates three fitted Zernike series per lookup (the irradiance,
 * and the two halves of the inverse map when a mask is present) on top of the
 * phase both layouts share, and `zernike(j, …)` recomputed ρ, θ, every power
 * of ρ and every cos(mθ) once per TERM.
 *
 * **Hypothesis.** The cost is that per-term recomputation, so hoisting what
 * depends on the point alone closes the gap without moving any number.
 * **Refuted by** any of: a single bit of any basis value, fit or sample moving
 * (the identity is exact by construction, so it is asserted with `Object.is`,
 * not a tolerance); the exit layout's tile still costing ≥ 2× the aim
 * layout's after the change (recorded in VALIDATION § 2k — a wall-clock is the
 * machine's, so it is measured there rather than asserted here).
 */

/** The fit `fitZernike` computed before § 2k, spelled out with `zernike`. */
const longhandFit = (samples: readonly WavefrontSample[], terms: number): Float64Array => {
  const inside = samples.filter((s) => s.px * s.px + s.py * s.py <= 1 + 1e-9);
  const a = new Float64Array(inside.length * terms);
  const b = new Float64Array(inside.length);
  inside.forEach((s, i) => {
    b[i] = s.waves;
    for (let j = 1; j <= terms; j++) a[i * terms + (j - 1)] = zernike(j, s.px, s.py);
  });
  return householderLeastSquares(a, inside.length, terms, b);
};

/** And the sampler, the same way. */
const longhand = (fit: ZernikeFit) => (px: number, py: number) => {
  let sum = 0;
  for (let j = 1; j <= fit.terms; j++) sum += fit.coefficients[j - 1]! * zernike(j, px, py);
  return sum;
};

/** Every point the transform asks at: inside, on, and past the rim (edge supersampling), and ρ = 0. */
const POINTS: readonly (readonly [number, number])[] = (() => {
  const out: [number, number][] = [[0, 0], [1, 0], [0, -1], [-0, 0], [0, -0]];
  for (let i = 0; i <= 40; i++) {
    for (let j = 0; j <= 40; j++) out.push([-1.3 + (2.6 * i) / 40, -1.3 + (2.6 * j) / 40]);
  }
  return out;
})();

const dry10 = () =>
  finiteConjugateMicroscope({
    objective: finiteConjugateObjective({ magnification: 10, numericalAperture: 0.2 }),
  }).system;
const oil = () =>
  infinityCorrectedMicroscope({
    objective: oilImmersionObjective({ magnification: 100, numericalAperture: 1.25, tubeFocalLengthMm: 200 }),
    tubeLens: tubeLens({ focalLengthMm: 200 }),
    objectHeightsMm: [0],
  }).system;

describe("§ 2k.1 — the basis, hoisted, is the basis to the bit", () => {
  it("every Noll term through order 8, at every point, Object.is", () => {
    const z = new Float64Array(MAX_ZERNIKE_TERMS);
    let compared = 0;
    for (const [px, py] of POINTS) {
      zernikeBasis(MAX_ZERNIKE_TERMS, px, py, z);
      for (let j = 1; j <= MAX_ZERNIKE_TERMS; j++) {
        if (!Object.is(z[j - 1], zernike(j, px, py))) {
          throw new Error(`Z${j}(${px}, ${py}): ${z[j - 1]} vs ${zernike(j, px, py)}`);
        }
        compared++;
      }
    }
    expect(compared).toBe(POINTS.length * MAX_ZERNIKE_TERMS);
  });

  it("a shorter basis is the longer one's prefix — the powers and angles it skips are not read", () => {
    const long = new Float64Array(MAX_ZERNIKE_TERMS);
    for (const terms of [1, 3, 6, 10, 15, 28]) {
      const short = new Float64Array(terms);
      for (const [px, py] of POINTS.slice(0, 200)) {
        zernikeBasis(terms, px, py, short);
        zernikeBasis(MAX_ZERNIKE_TERMS, px, py, long);
        for (let k = 0; k < terms; k++) expect(Object.is(short[k], long[k])).toBe(true);
      }
    }
  });

  it("samplers sharing the last point's basis read it right in any order, ±0 included", () => {
    // The one-entry memo every sampler reads through: a short series then a
    // long one at the same point, a long then a short, and 0 against −0, whose
    // θ differ by π. Each sampler must still be its own longhand.
    const coefficients = (terms: number, seed: number) =>
      Float64Array.from({ length: terms }, (_, k) => Math.sin(seed * (k + 1) + 0.3));
    const fits = [6, MAX_ZERNIKE_TERMS, 28, 1, 15].map(
      (terms, s): ZernikeFit => ({ terms, coefficients: coefficients(terms, s + 1), rmsResidualWaves: 0, samplesUsed: 0 }),
    );
    const fast = fits.map(wavefrontSampler);
    const slow = fits.map(longhand);
    const order = [0, 1, 2, 3, 4, 2, 0, 1, 4, 3];
    const points: (readonly [number, number])[] = [[0, 0], [-0, 0], [0, -0], [-0, -0], [0.3, -0.7], [0.3, -0.7], [1.2, 0.1]];
    for (const [px, py] of [...points, ...POINTS.slice(0, 300)]) {
      for (const k of order) {
        if (!Object.is(fast[k]!(px, py), slow[k]!(px, py))) {
          throw new Error(`sampler ${k} at (${Object.is(px, -0) ? "-0" : px}, ${Object.is(py, -0) ? "-0" : py})`);
        }
      }
    }
  });

  it("refuses a term count past the table, as fitZernike does", () => {
    expect(() => zernikeBasis(MAX_ZERNIKE_TERMS + 1, 0, 0, new Float64Array(46))).toThrow(/MAX_ZERNIKE_TERMS/);
  });
});

describe("§ 2k.2 — and every fit and sampler built on it, on traced pupils", () => {
  // The series a pupil lookup evaluates: the phase (28), the irradiance (45 on
  // the exit layout), the inverse map's two halves (45 each, where masked).
  const maps = [
    ["the vignetted DIN 10×/0.2 at 0.2 mm", opdMap(dry10(), 0.2, 550, pupilGrid(21))],
    ["the oil 100×/1.25 on the axis", opdMap(oil(), 0, 550, pupilGrid(21))],
  ] as const;

  for (const [name, map] of maps) {
    it(`${name}: coefficients, residual and sampler, Object.is`, () => {
      for (const terms of [6, 28, MAX_ZERNIKE_TERMS]) {
        const fit = fitZernike(map.samples, terms);
        const old = longhandFit(map.samples, terms);
        for (let k = 0; k < terms; k++) expect(Object.is(fit.coefficients[k], old[k])).toBe(true);
        const fast = wavefrontSampler(fit);
        const slow = longhand(fit);
        for (const [px, py] of POINTS) expect(Object.is(fast(px, py), slow(px, py))).toBe(true);
      }
    });
  }

  it("the laid exit pupil itself — amplitude and phase on a transform's lattice — is unmoved", () => {
    // Recorded on the commit before § 2k (7a8b0bf) and asserted bitwise: the
    // whole lookup, irradiance and traced rim and inverse map included. The
    // amplitude sum re-recorded at § 2n (728.2925078450103 before): a transmitted
    // field's |P|² became each component's own cos θ, with no Jacobian. The phase
    // did not move. Re-recorded at § 2o (744.5714016274019 before): 550 nm is in
    // the band where the DIN 10×'s aim is mirrored, so the exit layout now lays
    // the pupil the other way round — and this lattice is symmetric in x, so both
    // sums are the same numbers added in another order, and each moved in its
    // last bit (the phase 1588.677585164183 before).
    const map = maps[0][1];
    const p = laidPupil(dry10(), map, { layout: "exit", source: "field" }).pupil;
    let a = 0;
    let w = 0;
    for (let i = 0; i < 32; i++) {
      for (let j = 0; j < 32; j++) {
        const px = -1 + (i + 0.5) / 16;
        const py = -1 + (j + 0.5) / 16;
        const amp = p.amplitude(px, py);
        a += amp;
        if (amp > 0) w += p.phaseWaves(px, py);
      }
    }
    expect(a).toBe(EXIT_AMPLITUDE_SUM);
    expect(w).toBe(EXIT_PHASE_SUM);
  });
});

const EXIT_AMPLITUDE_SUM = 744.571401627401;
const EXIT_PHASE_SUM = 1588.6775851641826;
