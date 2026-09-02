import { describe, it, expect } from "vitest";
import {
  AB_ZERO_POINT_JY,
  JANSKY_W_PER_M2_HZ,
  PassBand,
  fluxDensityAB,
  photonFluxAB,
  photonSamples,
  photonSpectralFluxAB,
  spectralFluxDensityAB,
} from "../src/photometry/magnitude";
import { blackbodySpectrum } from "../src/photometry/blackbody";
import { POISSON_KNUTH_LIMIT, mulberry32, poisson } from "../src/math/random";
import { shotNoise } from "../src/imaging/noise";
import { collectedPhotonRate, pointSourceCollection } from "../src/imaging/exposure";
import { EPD_MM, FOCUS_NM, heroPair, heroSystem } from "./support/heroScene";

/**
 * § 8a — the photon zero point, and the one draw a camera makes.
 *
 * Three named deferrals close here: § 3a's "star magnitude → photon flux",
 * § 5s's exposure that stopped at a ratio, and ROADMAP's shot noise that
 * "stays deferred — a draw from an absolute photon count". They were one
 * deferral: nothing absolute could be shown until a magnitude was a rate.
 *
 * ## The pins, and why the first one is a definition
 *
 * The AB system (Oke & Gunn 1983) defines m_AB = 0 as f_ν = 3631 Jy, at every
 * frequency. There is no table in that — it is the zero point the SDSS, GALEX
 * and HST filter systems are quoted in, and it can be checked against nothing
 * because it IS the definition. What can be checked is what it implies:
 *
 *  - the Vega-system number every observing handbook quotes — a V = 0 star
 *    delivers about 1000 photons·s⁻¹·cm⁻²·Å⁻¹ near 550 nm, from Bessell's
 *    (1998) f_λ = 3.63·10⁻⁹ erg·s⁻¹·cm⁻²·Å⁻¹ — has to come out of the AB
 *    definition to within the published AB–Vega offset in V, which is 0.02 mag
 *    (Blanton & Roweis 2007). It comes out at 996. That is the one rung here
 *    that reaches a MEASURED number: Vega's spectrum.
 *  - the photon count through a top-hat band is a closed form,
 *    (f_ν/h)·ln(λ₂/λ₁), and it is the same for every spectral shape once the
 *    band's AB magnitude is fixed — because the broadband AB magnitude
 *    (Fukugita et al. 1996) and the photon count carry the same dλ/λ weight.
 *    The rung sets a 9600 K and a 3600 K blackbody to the same magnitude,
 *    shows their photons distributed oppositely across the band, and equal in
 *    number to the last digit.
 *
 * ## The draw
 *
 * Photon arrivals are Poisson, so shot noise is Poisson(μ) per pixel with no
 * parameter. Its law is that the variance equals the mean — and that is
 * pinned on the sampler at six means straddling its algorithm seam, and on a
 * rendered flat field as the √N signal-to-noise. Statistical rungs are stated
 * at five standard errors of the sample size, so a seed is a reproducibility
 * device and not a tuned number: any seed passes.
 */

const V_LIKE: PassBand = { fromNm: 500, toNm: 600 };
const PLANCK_H = 6.62607015e-34;

/** photons·s⁻¹·m⁻²·nm⁻¹ → photons·s⁻¹·cm⁻²·Å⁻¹. */
const perCm2PerAngstrom = (perM2PerNm: number): number => perM2PerNm * 1e-4 * 0.1;
/** W·m⁻²·nm⁻¹ → erg·s⁻¹·cm⁻²·Å⁻¹. */
const cgsFluxDensity = (siPerNm: number): number => siPerNm / 1e-2;
/** 0.02 mag, as a flux ratio. */
const VEGA_AB_OFFSET = Math.pow(10, 0.4 * 0.02);

describe("§ 8a.1 — the AB zero point is a definition, and Pogson's ratio is exact", () => {
  it("m_AB = 0 is 3631 Jy, in SI", () => {
    expect(AB_ZERO_POINT_JY).toBe(3631);
    expect(fluxDensityAB(0)).toBeCloseTo(3631 * JANSKY_W_PER_M2_HZ, 36);
    expect(fluxDensityAB(0)).toBeCloseTo(3.631e-23, 27);
  });

  it("five magnitudes are exactly a factor of 100, one is 10^0.4", () => {
    // Pogson (1856): the scale is defined so that Δm = 5 is 100×. Photon counts
    // inherit it unchanged, since the band's logarithm is common to both.
    expect(photonFluxAB(0, V_LIKE) / photonFluxAB(5, V_LIKE)).toBeCloseTo(100, 10);
    expect(photonFluxAB(6, V_LIKE) / photonFluxAB(7, V_LIKE)).toBeCloseTo(Math.pow(10, 0.4), 12);
    // Fainter is fewer.
    expect(photonFluxAB(1, V_LIKE)).toBeLessThan(photonFluxAB(0, V_LIKE));
  });

  it("refuses a band that is not a band, and a magnitude that is not a number", () => {
    expect(() => photonFluxAB(0, { fromNm: 600, toNm: 500 })).toThrow();
    expect(() => photonFluxAB(0, { fromNm: 0, toNm: 500 })).toThrow();
    expect(() => photonFluxAB(Number.NaN, V_LIKE)).toThrow();
    expect(() => photonFluxAB(Number.POSITIVE_INFINITY, V_LIKE)).toThrow();
  });
});

describe("§ 8a.2 — the Vega-system V zero point falls out of the AB definition", () => {
  it("a 0-mag star delivers ~1000 photons·s⁻¹·cm⁻²·Å⁻¹ at 550 nm — 996, inside the 0.02 mag offset", () => {
    // The textbook figure is derived from Bessell's Vega f_λ; AB reproduces it
    // to 0.4%, and the tolerance is the published AB−Vega offset in V rather
    // than a number chosen to pass.
    const photons = perCm2PerAngstrom(photonSpectralFluxAB(0, 550));
    expect(photons).toBeGreaterThan(1000 / VEGA_AB_OFFSET);
    expect(photons).toBeLessThan(1000 * VEGA_AB_OFFSET);
    expect(photons).toBeCloseTo(996.34, 1);
  });

  it("f_λ(V = 0) = 3.63e-9 erg·s⁻¹·cm⁻²·Å⁻¹ (Bessell 1998) sits between AB's 545 and 550 nm values", () => {
    // f_λ = f_ν·c/λ² runs as 1/λ², so the AB value is 3.665e-9 at 545 nm and
    // 3.599e-9 at 550: Bessell's V zero point is bracketed by the two
    // conventional effective wavelengths, and within 0.02 mag of either.
    const at545 = cgsFluxDensity(spectralFluxDensityAB(0, 545));
    const at550 = cgsFluxDensity(spectralFluxDensityAB(0, 550));
    expect(at545).toBeGreaterThan(3.631e-9);
    expect(at550).toBeLessThan(3.631e-9);
    expect(at545 / 3.631e-9).toBeLessThan(VEGA_AB_OFFSET);
    expect(3.631e-9 / at550).toBeLessThan(VEGA_AB_OFFSET);
  });

  it("the two spectral densities are one number: f_λ·λ/(hc) is the photon rate", () => {
    // Consistency between the energy and photon spellings — an internal
    // identity, and stated as one so a unit slip in either shows here first.
    const nm = 550;
    const energyPerPhoton = (PLANCK_H * 2.99792458e8) / (nm * 1e-9);
    expect(spectralFluxDensityAB(0, nm) / energyPerPhoton).toBeCloseTo(photonSpectralFluxAB(0, nm), 6);
  });
});

describe("§ 8a.3 — the band's photon count is a closed form, and the spectral shape cancels", () => {
  it("N = (f_ν/h)·ln(λ₂/λ₁): 9.991e9 photons·s⁻¹·m⁻² for m_AB = 0 over 500–600 nm", () => {
    const closed = ((3631 * JANSKY_W_PER_M2_HZ) / PLANCK_H) * Math.log(600 / 500);
    expect(photonFluxAB(0, V_LIKE)).toBeCloseTo(closed, 0);
    expect(photonFluxAB(0, V_LIKE)).toBeCloseTo(9.991e9, -6);
    // And the closed form is what a quadrature of ṅ(λ) = f_ν/(hλ) gives —
    // trapezoid on 2000 steps, so the two routes agree to 1e-7.
    let acc = 0;
    const steps = 2000;
    for (let i = 0; i <= steps; i++) {
      const nm = V_LIKE.fromNm + (i * (V_LIKE.toNm - V_LIKE.fromNm)) / steps;
      acc += (i === 0 || i === steps ? 0.5 : 1) * photonSpectralFluxAB(0, nm);
    }
    acc *= (V_LIKE.toNm - V_LIKE.fromNm) / steps;
    expect(Math.abs(acc / closed - 1)).toBeLessThan(1e-7);
  });

  it("a 9600 K and a 3600 K star at the same AB magnitude deliver the same photons, distributed oppositely", () => {
    // The theorem, as a measurement: the shape moves photons between bins and
    // cannot move their total. The hot star is blue-heavy and its weights fall
    // across the band; the cool one's rise; both sum to the closed form.
    const hot = photonSamples(blackbodySpectrum(9600), 0, V_LIKE);
    const cool = photonSamples(blackbodySpectrum(3600), 0, V_LIKE);
    const total = (s: readonly { weight: number }[]) => s.reduce((a, x) => a + x.weight, 0);
    expect(total(hot)).toBeCloseTo(photonFluxAB(0, V_LIKE), 0);
    expect(total(cool)).toBeCloseTo(photonFluxAB(0, V_LIKE), 0);
    expect(total(hot) / total(cool)).toBeCloseTo(1, 12);
    for (let i = 1; i < hot.length; i++) {
      expect(hot[i]!.weight).toBeLessThan(hot[i - 1]!.weight);
      expect(cool[i]!.weight).toBeGreaterThan(cool[i - 1]!.weight);
    }
    // The split is real and not a rounding: the hot star's bluest bin carries
    // ~1.5× what the cool star's does.
    expect(hot[0]!.weight / cool[0]!.weight).toBeGreaterThan(1.4);
  });

  it("the AB reference itself — flat in f_ν — gives weights ∝ ln(λ_{i+1}/λ_i)", () => {
    // f_ν flat is f_λ ∝ 1/λ², whose photon weighting is 1/λ; each bin's share
    // is then exactly the log of its edges, which is the dλ/λ measure in the
    // closed form. Pinned to that logarithm, not to the shape's own quadrature.
    const flatFnu = (nm: number) => 1 / (nm * nm);
    const s = photonSamples(flatFnu, 0, V_LIKE, { count: 4, binSteps: 256 });
    const edges = [500, 525, 550, 575, 600];
    for (let i = 0; i < 4; i++) {
      const expected = photonFluxAB(0, V_LIKE) * (Math.log(edges[i + 1]! / edges[i]!) / Math.log(600 / 500));
      expect(Math.abs(s[i]!.weight / expected - 1)).toBeLessThan(1e-6);
    }
  });
});

describe("§ 8a.4 — the Poisson sampler: variance equals the mean, on both sides of its seam", () => {
  const DRAWS = 100_000;
  /** Sample mean and variance of `n` draws at `mean`, on a fixed seed. */
  function sample(mean: number, seed: number, n = DRAWS): { mean: number; variance: number; zeros: number } {
    const rng = mulberry32(seed);
    let sum = 0;
    let sumSq = 0;
    let zeros = 0;
    for (let i = 0; i < n; i++) {
      const k = poisson(mean, rng);
      if (!Number.isInteger(k) || k < 0) throw new Error(`not a count: ${k}`);
      if (k === 0) zeros++;
      sum += k;
      sumSq += k * k;
    }
    const m = sum / n;
    return { mean: m, variance: sumSq / n - m * m, zeros };
  }

  // Means straddling the Knuth → PTRS seam at 30, and two decades either side.
  const MEANS = [0.5, 7, 29.9, 30.1, 250, 5000];
  for (const mu of MEANS) {
    it(`μ = ${mu}: the sample mean is μ and the variance is μ, to five standard errors`, () => {
      const { mean, variance } = sample(mu, 0x5eed + Math.round(mu * 10));
      // SE of the mean is √(μ/n); SE of the variance is √((μ + 2μ²)/n), from
      // the Poisson fourth cumulant (κ₄ = μ).
      expect(Math.abs(mean - mu)).toBeLessThan(5 * Math.sqrt(mu / DRAWS));
      expect(Math.abs(variance - mu)).toBeLessThan(5 * Math.sqrt((mu + 2 * mu * mu) / DRAWS));
    });
  }

  it("P(0) = e^(−μ): at μ = 2.5, 8.21% of draws are empty", () => {
    const mu = 2.5;
    const p0 = Math.exp(-mu);
    const { zeros } = sample(mu, 42);
    expect(Math.abs(zeros / DRAWS - p0)).toBeLessThan(5 * Math.sqrt((p0 * (1 - p0)) / DRAWS));
  });

  it("the seam is where it says, and a mean of zero draws nothing from the stream", () => {
    expect(POISSON_KNUTH_LIMIT).toBe(30);
    const rng = mulberry32(7);
    const before = rng.next();
    const rng2 = mulberry32(7);
    expect(poisson(0, rng2)).toBe(0);
    expect(rng2.next()).toBe(before);
  });

  it("refuses a negative, infinite or NaN mean", () => {
    const rng = mulberry32(1);
    expect(() => poisson(-1, rng)).toThrow();
    expect(() => poisson(Number.NaN, rng)).toThrow();
    expect(() => poisson(Number.POSITIVE_INFINITY, rng)).toThrow();
  });
});

describe("§ 8a.5 — shot noise on a flat field: signal-to-noise is √N", () => {
  const SIZE = 256;
  function flat(expected: number, seed: number): { mean: number; variance: number } {
    const field = new Float64Array(SIZE * SIZE).fill(expected);
    const drawn = shotNoise(field, mulberry32(seed));
    let sum = 0;
    let sumSq = 0;
    for (const v of drawn) {
      sum += v;
      sumSq += v * v;
    }
    const m = sum / drawn.length;
    return { mean: m, variance: sumSq / drawn.length - m * m };
  }

  it("a field expecting 200 photons per pixel records 200 ± √200, and no less noise than that", () => {
    const n = SIZE * SIZE;
    const { mean, variance } = flat(200, 3);
    expect(Math.abs(mean - 200)).toBeLessThan(5 * Math.sqrt(200 / n));
    expect(Math.abs(variance - 200)).toBeLessThan(5 * Math.sqrt((200 + 2 * 200 * 200) / n));
  });

  it("four times the light is twice the signal-to-noise", () => {
    const a = flat(50, 11);
    const b = flat(200, 12);
    const snr = (s: { mean: number; variance: number }) => s.mean / Math.sqrt(s.variance);
    // √50 = 7.07 and √200 = 14.1; each SNR is measured to ~0.3% on 65 536
    // pixels, so the ratio is pinned at 1% and the law at √N, not N or 1.
    expect(snr(b) / snr(a)).toBeGreaterThan(2 * 0.99);
    expect(snr(b) / snr(a)).toBeLessThan(2 * 1.01);
  });

  it("is deterministic under a seed, and refuses a negative expectation", () => {
    const field = new Float64Array([0, 1.5, 40, 3000]);
    const x = shotNoise(field, mulberry32(9));
    const y = shotNoise(field, mulberry32(9));
    expect(Array.from(x)).toEqual(Array.from(y));
    expect(x[0]).toBe(0);
    expect(() => shotNoise(new Float64Array([1, -1]), mulberry32(1))).toThrow();
  });
});

describe("§ 8a.6 — a magnitude through a pupil is a rate: the hero refractor at f/10", () => {
  const achromat = heroSystem(heroPair().achromat);

  it("m_AB = 0 over 500–600 nm through a 10 mm entrance pupil is 7.847e5 photons/s", () => {
    // Bookkeeping in the same sense as § 5s.3 — the hero's stop is its front
    // surface, so the traced entrance pupil is the declared one and π·r² is
    // 78.54 mm². What is new is the multiplication being absolute: this is the
    // first photon count the engine has ever returned, and it is checkable by
    // hand from the two definitions above.
    const area = pointSourceCollection(achromat, FOCUS_NM);
    expect(area).toBeCloseTo(Math.PI * (EPD_MM / 2) ** 2, 6);
    const rate = collectedPhotonRate(achromat, FOCUS_NM, 0, V_LIKE);
    expect(rate).toBeCloseTo(photonFluxAB(0, V_LIKE) * area * 1e-6, 3);
    expect(rate).toBeCloseTo(7.847e5, -2);
  });

  it("a sixth-magnitude star — the naked-eye limit — is a hundred-fold fewer than first", () => {
    expect(collectedPhotonRate(achromat, FOCUS_NM, 1, V_LIKE) / collectedPhotonRate(achromat, FOCUS_NM, 6, V_LIKE)).toBeCloseTo(
      100,
      9,
    );
  });
});
