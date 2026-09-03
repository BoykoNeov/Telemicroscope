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
import {
  drawPhotonFrame,
  expectedPhotons,
  intensityFromPhotons,
  shotNoise,
} from "../src/imaging/noise";
import { colorImageFromStack, integratedXyz } from "../src/imaging/image";
import { clearApertureEnergy, psf } from "../src/wave/psf";
import { SpectralStack, spectralStack } from "../src/wave/polychromatic";
import { VISIBLE_MAX_NM, VISIBLE_MIN_NM, spectralSamples } from "../src/photometry/spectrum";
import { bestFocus, withFocus } from "../src/analysis/focus";
import { newtonian } from "../src/designs/newtonian";
import { infinityCorrectedMicroscope, microscopeObjective, tubeLens } from "../src/designs/microscope";
import { OpticalSystem } from "../src/trace/system";
import { collectedPhotonRate, pointSourceCollection } from "../src/imaging/exposure";
import {
  EPD_MM,
  FOCUS_NM,
  PSF_OPTIONS,
  SOURCE_TEMPERATURE_K,
  heroPair,
  heroSystem,
  renderHero,
} from "./support/heroScene";

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

// ── § 8a.7–§ 8a.11 — the route from a rendered stack to a frame of photons ──

/**
 * § 8a left the noisy frame as "app and imaging wiring" on a route written on
 * `imaging/noise`: intensity over the PSF's energy, times the sample's photon
 * weight, times the grasp, times seconds. Walking it found one thing wrong with
 * it, and the rungs below are what the correction is pinned on.
 *
 * **The PSF's own `energy` is the wrong denominator for a photon count.** It is
 * the light that got THROUGH the pupil — obstruction, spider and Fresnel loss
 * already subtracted — and `Σ intensity === energy` by construction, so dividing
 * by it normalizes those losses away. The photons arrive through
 * `pointSourceCollection`, which is π·r² of the whole entrance-pupil circle and
 * cannot see a secondary mirror (the obstruction is a `PsfOptions` field and
 * never reaches the prescription). The two together spread the full circle's
 * photons over the survivors, and a 200 mm Newtonian records exactly what a
 * 200 mm clear aperture would. The fix invents no factor: divide by the CLEAR
 * aperture on the same grid (`clearApertureEnergy`) and every loss stays a loss.
 */

const NEWTONIAN_APERTURE_MM = 200;
const NEWTONIAN_FOCAL_RATIO = 5;
const RENDER_BAND: PassBand = { fromNm: VISIBLE_MIN_NM, toNm: VISIBLE_MAX_NM };

/** The app's own Newtonian preset, rendered with and without its secondary. */
function newtonianStack(withObstruction: boolean): SpectralStack {
  const scope = newtonian({
    apertureMm: NEWTONIAN_APERTURE_MM,
    focalRatio: NEWTONIAN_FOCAL_RATIO,
  });
  const base: OpticalSystem = {
    prescription: scope.prescription,
    aperture: { kind: "EPD", value: NEWTONIAN_APERTURE_MM },
    field: { kind: "angle", values: [0] },
    wavelengths: spectralSamples(blackbodySpectrum(SOURCE_TEMPERATURE_K), { count: 5 }),
    conjugate: { kind: "infinite" },
  };
  const focus = bestFocus(base, "minRmsWavefront", { wavelengthNm: FOCUS_NM });
  return spectralStack(withFocus(base, focus.offsetFromLastVertex), 0, {
    pupilSamples: 64,
    padFactor: 4,
    ...(withObstruction ? { obstruction: scope.obstruction } : {}),
  });
}

const sumOf = (a: Float64Array): number => {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i]!;
  return s;
};

/** Σ over every plane of that plane's own image — the light on the grid. */
const stackLight = (stack: SpectralStack): number =>
  stack.planes.reduce((acc, p) => acc + sumOf(p.intensity), 0);

describe("§ 8a.7 — the photon denominator is the CLEAR aperture, so an obstruction stays a loss", () => {
  it("the clear-aperture energy is the grid's own π/4·pupilSamples², not the formula", () => {
    // It converges to the analytic disc and is deliberately not it: the
    // numerator was computed on this grid, so reading the denominator off the
    // same one divides the edge cells' quadrature error out instead of leaving
    // it in the throughput, where it would read as a real loss of light.
    const coarse = clearApertureEnergy(64, 256);
    const fine = clearApertureEnergy(128, 512);
    expect(Math.abs(coarse / ((Math.PI / 4) * 64 * 64) - 1)).toBeLessThan(1e-4);
    expect(Math.abs(fine / ((Math.PI / 4) * 128 * 128) - 1)).toBeLessThan(1e-4);
    // And it is closer at twice the pupil resolution, so the gap is
    // discretization and not a definition that disagrees.
    expect(Math.abs(fine / ((Math.PI / 4) * 128 * 128) - 1)).toBeLessThan(
      Math.abs(coarse / ((Math.PI / 4) * 64 * 64) - 1),
    );
  });

  it("HEADLINE: on one denominator the secondary costs exactly 1 − ε², on the plane's own it costs nothing", () => {
    const epsilon = newtonian({
      apertureMm: NEWTONIAN_APERTURE_MM,
      focalRatio: NEWTONIAN_FOCAL_RATIO,
    }).obstruction;
    const obstructed = newtonianStack(true);
    const clear = newtonianStack(false);

    // The fix: one denominator for both frames, so the obstruction is what it
    // physically is — 2.26% of the aperture, gone. ε = 0.150376 here.
    //
    // The bound is 1e-3 and the reason is § 8a.11, not the optics. On the pupil
    // grid the agreement is 7.6e-5 (the last assertion below); after
    // `spectralStack` resamples every plane it is −4.3e-4, because the
    // resampler's per-plane excess is NOT common-mode between two frames whose
    // PSFs differ — measured at −1.6e-3 to +4.1e-4 across the five planes. So
    // the looser number here is the resampler being carried through a ratio,
    // and it is bounded rather than divided out.
    expect(Math.abs(stackLight(obstructed) / stackLight(clear) / (1 - epsilon * epsilon) - 1)).toBeLessThan(1e-3);

    // The bug the route as written would have had, stated as a measurement:
    // each frame over its OWN energy is the same number, so the secondary
    // mirror is invisible and the Newtonian collects like a clear 200 mm.
    const ownShare = (s: SpectralStack): number =>
      s.planes.reduce((acc, p) => acc + sumOf(p.intensity) / p.energy, 0) / s.planes.length;
    expect(Math.abs(ownShare(obstructed) / ownShare(clear) - 1)).toBeLessThan(1e-3);

    // And the throughput the clear denominator recovers is the closed form.
    const throughput = obstructed.planes[0]!.energy / clearApertureEnergy(64, 256);
    expect(Math.abs(throughput / (1 - epsilon * epsilon) - 1)).toBeLessThan(1e-4);
  });

  it("an uncoated achromat's throughput is its Fresnel loss, on the same reading", () => {
    // Nothing about this is a special case for glass: the amplitude carries
    // √throughput from the trace, so the same ratio that reported a secondary
    // reports four uncoated surfaces — about a tenth of the light, and it is
    // chromatic because the index is.
    const hero = renderHero(heroPair().achromat);
    const clear = clearApertureEnergy(PSF_OPTIONS.pupilSamples, hero.stack.size);
    for (const plane of hero.stack.planes) {
      expect.soft(plane.energy / clear, `${plane.nm} nm`).toBeGreaterThan(0.85);
      expect.soft(plane.energy / clear, `${plane.nm} nm`).toBeLessThan(0.95);
    }
  });
});

describe("§ 8a.8 — an absolute frame: the counts a magnitude puts on a grid", () => {
  const hero = renderHero(heroPair().achromat);
  const AREA_MM2 = pointSourceCollection(hero.system, FOCUS_NM);
  const CLEAR = clearApertureEnergy(PSF_OPTIONS.pupilSamples, hero.stack.size);

  const frame = (magnitudeAB: number, seconds: number) =>
    expectedPhotons({
      planes: hero.stack.planes,
      samples: hero.stack.samples,
      photons: photonSamples(blackbodySpectrum(SOURCE_TEMPERATURE_K), magnitudeAB, RENDER_BAND, {
        count: hero.stack.planes.length,
      }),
      clearEnergy: CLEAR,
      collectingAreaMm2: AREA_MM2,
      seconds,
    });

  it("what the pupil admits is the closed form, summed over the samples", () => {
    // `photonSamples` normalizes its shares to (f_ν/h)·ln(λ₂/λ₁) exactly, so
    // the frame's admitted total is § 8a.3's number times the traced area and
    // the time — no quadrature error enters between the magnitude and the grid.
    const f = frame(10, 30);
    const admitted = f.admitted.reduce((a, b) => a + b, 0);
    const closedForm = photonFluxAB(10, RENDER_BAND) * AREA_MM2 * 1e-6 * 30;
    expect(Math.abs(admitted / closedForm - 1)).toBeLessThan(1e-12);
  });

  it("five magnitudes is a hundredfold, and a doubled exposure is a doubling", () => {
    expect(Math.abs(frame(5, 1).totalPhotons / frame(10, 1).totalPhotons / 100 - 1)).toBeLessThan(1e-12);
    expect(Math.abs(frame(10, 2).totalPhotons / frame(10, 1).totalPhotons / 2 - 1)).toBeLessThan(1e-12);
  });

  it("what lands is below what was admitted, and by the pupil's own throughput", () => {
    // The one number in the route that is a reading rather than an identity.
    // It is not 1 and must not be normalized to 1: the achromat's ~10% is
    // Fresnel, and the rest is § 8a.11's resampling excess pulling the other way.
    const f = frame(10, 1);
    expect(f.deliveredFraction).toBeGreaterThan(0.85);
    expect(f.deliveredFraction).toBeLessThan(1);
    expect(f.totalPhotons).toBeGreaterThan(0);
  });

  it("a tenth-magnitude star through the hero refractor is a few thousand photons a second", () => {
    // The first absolute frame the engine has produced, and every step of it is
    // checkable by hand: § 8a.6's 7.847e5 photons·s⁻¹ at m = 0 over 500–600 nm
    // times ln(700/400)/ln(600/500) = 3.069389 — the closed form's whole
    // dependence on the band — is 2.408519e6 over 400–700, and m = 10 is 10⁻⁴
    // of it. What the grid receives is that times the pupil's throughput.
    const f = frame(10, 1);
    const admitted = f.admitted.reduce((a, b) => a + b, 0);
    expect(Math.abs(admitted / 240.8519 - 1)).toBeLessThan(1e-6);
    expect(f.totalPhotons).toBeGreaterThan(200);
    expect(f.totalPhotons).toBeLessThan(240.8519);
  });
});

describe("§ 8a.9 — the noisy frame is the clean frame plus Poisson noise, and nothing else", () => {
  const hero = renderHero(heroPair().achromat);
  const AREA_MM2 = pointSourceCollection(hero.system, FOCUS_NM);
  const expectation = expectedPhotons({
    planes: hero.stack.planes,
    samples: hero.stack.samples,
    photons: photonSamples(blackbodySpectrum(SOURCE_TEMPERATURE_K), 4, RENDER_BAND, {
      count: hero.stack.planes.length,
    }),
    clearEnergy: clearApertureEnergy(PSF_OPTIONS.pupilSamples, hero.stack.size),
    collectingAreaMm2: AREA_MM2,
    seconds: 1,
  });

  it("dividing the counts back by their own scale restores the render", () => {
    // The claim the colour route rests on. `colorImageFromStack` integrates the
    // observer against the stack's ENERGY weights and those are already right;
    // the photon weighting is a different weighting of the same grid and exists
    // only to make the draw. Restoring means no second colour basis can disagree
    // with the first — v·k/k, so one rounding rather than a bit-exact identity.
    const restored = intensityFromPhotons(
      expectation.planes.map((p) => Float64Array.from(p)),
      expectation,
    );
    for (let p = 0; p < restored.length; p++) {
      const a = sumOf(restored[p]!);
      const b = sumOf(hero.stack.planes[p]!.intensity);
      expect.soft(Math.abs(a / b - 1), `plane ${p}`).toBeLessThan(1e-12);
    }
  });

  it("and the colour it collapses to is the same colour", () => {
    const restored = intensityFromPhotons(
      expectation.planes.map((p) => Float64Array.from(p)),
      expectation,
    );
    const clean = colorImageFromStack(hero.stack);
    const same = colorImageFromStack({
      size: hero.stack.size,
      pixelScaleMm: hero.stack.pixelScaleMm,
      planes: restored.map((intensity) => ({ intensity })),
      samples: hero.stack.samples,
    });
    expect(Math.abs(integratedXyz(same).y / integratedXyz(clean).y - 1)).toBeLessThan(1e-12);
  });

  it("a drawn frame counts what the frame expected, to √N", () => {
    // Statistical, so it is stated at five standard errors of the frame's own
    // total and any seed passes — § 8a.4's convention, on a real image rather
    // than on a flat field.
    const drawn = drawPhotonFrame(expectation, mulberry32(17));
    const counted = drawn.reduce((acc, plane) => acc + sumOf(plane), 0);
    const expected = expectation.totalPhotons;
    expect(Math.abs(counted - expected)).toBeLessThan(5 * Math.sqrt(expected));
    // Integers, because they are counts. A frame that came back fractional
    // would mean the draw had been replaced by a scaling somewhere.
    expect(drawn.every((plane) => plane.every((v) => Number.isInteger(v)))).toBe(true);
  });

  it("is a frame rather than a plane: one seed, one observation", () => {
    const a = drawPhotonFrame(expectation, mulberry32(5));
    const b = drawPhotonFrame(expectation, mulberry32(5));
    expect(a.map((p) => sumOf(p))).toEqual(b.map((p) => sumOf(p)));
    // The generator is threaded through the planes in order, so plane 1 of a
    // frame is not plane 1 of a frame drawn from a different first plane.
    const c = drawPhotonFrame(expectation, mulberry32(6));
    expect(a.map((p) => sumOf(p))).not.toEqual(c.map((p) => sumOf(p)));
  });
});

describe("§ 8a.10 — what the route refuses", () => {
  const hero = renderHero(heroPair().achromat);
  const base = {
    planes: hero.stack.planes,
    samples: hero.stack.samples,
    clearEnergy: clearApertureEnergy(PSF_OPTIONS.pupilSamples, hero.stack.size),
    collectingAreaMm2: pointSourceCollection(hero.system, FOCUS_NM),
    seconds: 1,
  };

  it("a magnitude quoted over a different band from the one the frame was rendered in", () => {
    // The failure this catches is silent and plausible: V-band photons
    // delivered into a 400–700 nm image, every plane finite, the picture merely
    // wrong. So the check is on the wavelengths, never on the weights — two
    // weightings of one grid is the intended state.
    expect(() =>
      expectedPhotons({
        ...base,
        photons: photonSamples(blackbodySpectrum(SOURCE_TEMPERATURE_K), 4, V_LIKE, {
          count: hero.stack.planes.length,
        }),
      }),
    ).toThrow(/different wavelength grid/);
  });

  it("a pupil that is not an area has no photon frame, exactly as it has no rate", () => {
    // § 5s.5's refusal, propagated rather than re-implemented: the telecentric
    // 4×/0.10 objective's entrance pupil is not an area at any wavelength, so
    // the route never gets as far as a count. `expectedPhotons` refuses the
    // same construction directly if a caller hands it one anyway.
    const tele = infinityCorrectedMicroscope({
      objective: microscopeObjective({ magnification: 4, numericalAperture: 0.1 }),
      tubeLens: tubeLens({ apertureMm: 25 }),
    }).system;
    expect(() => pointSourceCollection(tele, FOCUS_NM)).toThrow(/SOLID ANGLE/);
    expect(() =>
      expectedPhotons({ ...base, collectingAreaMm2: Infinity, photons: base.samples }),
    ).toThrow(/§ 5s.5/);
  });

  it("a negative expectation, a zero denominator and a mismatched plane count", () => {
    const photons = photonSamples(blackbodySpectrum(SOURCE_TEMPERATURE_K), 4, RENDER_BAND, {
      count: hero.stack.planes.length,
    });
    expect(() => expectedPhotons({ ...base, photons, clearEnergy: 0 })).toThrow(/positive pupil energy/);
    expect(() => expectedPhotons({ ...base, photons, seconds: -1 })).toThrow(/non-negative/);
    expect(() => expectedPhotons({ ...base, photons: photons.slice(1) })).toThrow(/one photon weight per plane/);
    expect(() =>
      expectedPhotons({
        ...base,
        photons,
        planes: [{ intensity: new Float64Array([1, -1]) }, ...hero.stack.planes.slice(1)],
      }),
    ).toThrow(/non-negative and finite everywhere/);
  });
});

describe("§ 8a.11 — a finding: the stack's resampler moves energy and nothing reports it", () => {
  it("a PSF conserves exactly, and the stack it goes into does not", () => {
    // Σ intensity === energy is `psf.ts`'s "by construction", and it holds to
    // the bit on the raw transform. `spectralStack` then resamples every plane
    // onto the mean wavelength's grid with a k² Jacobian, and that step is
    // energy-correct only to first order on a function with rings in it: the
    // hero's planes come back between +0.3% and +3.0% heavy, non-monotone in
    // |k − 1| — it is the rings aliasing against the grid, not a scale error.
    //
    // `truncatedFraction` does not see it. That field reports light that fell
    // OFF the grid and is exactly 0 here, so a caller reading it has no signal
    // that the energy moved at all. It is reported through `deliveredFraction`
    // and never divided out; the register carries it as an open item.
    //
    // If the first expectation below starts failing, the resampler was fixed —
    // update this rung and OPEN-PROBLEMS rather than widening anything.
    const hero = renderHero(heroPair().achromat);
    const raw = psf(hero.system, 0, FOCUS_NM, PSF_OPTIONS);
    expect(Math.abs(sumOf(raw.intensity) / raw.energy - 1)).toBeLessThan(1e-12);

    expect(hero.stack.truncatedFraction).toBe(0);
    const departures = hero.stack.planes.map((p) => sumOf(p.intensity) / p.energy - 1);
    const worst = Math.max(...departures.map(Math.abs));
    expect(worst).toBeGreaterThan(1e-3);
    expect(worst).toBeLessThan(0.05);
  });
});
