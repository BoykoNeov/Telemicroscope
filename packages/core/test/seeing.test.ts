import { describe, it, expect } from "vitest";
import { mulberry32 } from "../src/math/random";
import {
  kolmogorovScreen,
  withPhaseScreen,
  screenPhaseWaves,
  phaseStructureFunction,
  SeeingSpec,
} from "../src/wave/seeing";
import { psfFromPupilFunction, PupilFunction, PupilScale, Psf } from "../src/wave/psf";
import { mtf } from "../src/wave/mtf";

/**
 * Rungs for atmospheric seeing — the one random draw in the image.
 *
 * A Kolmogorov phase screen has no closed form for any single realisation; a
 * speckle pattern is a speckle pattern. What is pinned is the *statistics*, and
 * they come from one law — the structure function D_φ(r) = 6.88·(r/r₀)^(5/3) —
 * through two observables the ensemble average must reproduce: Fried's
 * long-exposure OTF exp(−3.44·(ρ/r₀)^(5/3)) and the seeing-limited FWHM
 * ≈ 0.98·λ/r₀. The ladder is ε = 0-first: the structure function is pinned on
 * the bare screen before any transform, then the OTF and FWHM downstream.
 *
 * ## The one honest tolerance, and why it is one number three ways
 *
 * A finite screen truncates the largest turbulent scales, which the infinite
 * Kolmogorov spectrum keeps going forever, so the generator carries a small
 * *effective-r₀ inflation* of a few percent — the seeing comes out a touch
 * milder than r₀ says. It shows up once and consistently: as a ~5–15% deficit
 * in D_φ at large r (the wing), a ~2–5% high bias in r₀_eff from the OTF, and a
 * ~5–15% narrow bias in the pixel FWHM. That it is a single *r₀ shift* and not a
 * shape error is exactly what the OTF rung proves — r₀_eff is flat across
 * frequency — which is what earns the documented band the same way the spider's
 * (w/D)² tolerance is earned. Subharmonics (Lane/Johansson) are what keep it to
 * a few percent rather than the ~35% a bare FFT screen would show.
 *
 * ## Ensembles are sized for convergence, and that is the cost
 *
 * The long-exposure quantities are averages over many screens, and the
 * low-order wander converges as 1/√N — so these rungs run ~120 screens each and
 * are the heaviest in the suite. The pixel FWHM is the slowest-converging
 * feature (it is one geometric measurement on a still-lumpy mean), so it is
 * pinned by a wide band and by its *scaling*; the OTF-derived r₀_eff is the
 * tight, well-converged number and does the real work.
 */

// ---- The optical setup the ensemble rungs share --------------------------
const D = 200; // aperture diameter, mm
const REF_LAM = 500; // nm
const PUPIL_SAMPLES = 64;
const PAD = 4;
const N = PUPIL_SAMPLES * PAD; // 256-pixel PSF grid
const SCREEN_N = 256;
const SCALE: PupilScale = { referenceRadius: 1000, exitRadius: D / 2, wavelengthNm: REF_LAM, nImage: 1 };
// λ/D in pixels equals n/pupilSamples = PAD, which sets the FWHM scale.
const LAM_OVER_D_PX = PAD;

const flatPupil: PupilFunction = {
  amplitude: (px, py) => (px * px + py * py <= 1 ? 1 : 0),
  phaseWaves: () => 0,
};

/** Azimuthal average of an fftshifted MTF (DC at centre), one bin per pixel. */
function radialMtf(mod: Float64Array, n: number, bins: number): Float64Array {
  const c = n / 2;
  const sums = new Float64Array(bins);
  const counts = new Float64Array(bins);
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      const b = Math.round(Math.hypot(x - c, y - c));
      if (b >= bins) continue;
      sums[b] = sums[b]! + mod[y * n + x]!;
      counts[b] = counts[b]! + 1;
    }
  const out = new Float64Array(bins);
  for (let b = 0; b < bins; b++) out[b] = counts[b]! > 0 ? sums[b]! / counts[b]! : 0;
  return out;
}

/** FWHM (px) of the azimuthally-averaged PSF, from peak to half-max crossing. */
function fwhmPx(intensity: Float64Array, n: number): number {
  const c = n / 2;
  const sums = new Float64Array(n);
  const counts = new Float64Array(n);
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      const b = Math.floor(Math.hypot(x - c, y - c));
      if (b >= n) continue;
      sums[b] = sums[b]! + intensity[y * n + x]!;
      counts[b] = counts[b]! + 1;
    }
  const prof = new Float64Array(n);
  for (let b = 0; b < n; b++) prof[b] = counts[b]! > 0 ? sums[b]! / counts[b]! : 0;
  const half = prof[0]! / 2;
  for (let b = 1; b < n; b++)
    if (prof[b]! <= half) {
      const t = (prof[b - 1]! - half) / (prof[b - 1]! - prof[b]!);
      return 2 * (b - 1 + t);
    }
  return NaN;
}

/**
 * Ensemble-mean PSF through the atmosphere at a given D/r₀, plus what the
 * downstream rungs read off it: the OTF-derived r₀_eff and the pixel FWHM.
 */
function seeingEnsemble(dOverR0: number, nEns: number, seed0: number, cleanMtf: Float64Array) {
  const r0 = D / dOverR0;
  const mean = new Float64Array(N * N);
  let maxStep = 0;
  for (let s = 0; s < nEns; s++) {
    const screen = kolmogorovScreen({
      friedParamMm: r0,
      apertureDiameterMm: D,
      screenSamples: SCREEN_N,
      oversize: 4,
      subharmonics: 6,
      seed: seed0 + s,
    });
    const psf = psfFromPupilFunction(withPhaseScreen(flatPupil, screen, REF_LAM), SCALE, 0, {
      pupilSamples: PUPIL_SAMPLES,
      padFactor: PAD,
    });
    for (let i = 0; i < N * N; i++) mean[i] = mean[i]! + psf.intensity[i]!;
    if (psf.maxGridPhaseStepWaves > maxStep) maxStep = psf.maxGridPhaseStepWaves;
  }
  for (let i = 0; i < N * N; i++) mean[i] = mean[i]! / nEns;
  const meanPsf: Psf = { ...cleanPsf, intensity: mean };
  const mScreen = radialMtf(mtf(meanPsf).modulation, N, PUPIL_SAMPLES + 1);
  // Atmospheric OTF = long-exposure MTF / diffraction MTF, and Fried says it is
  // exp(−3.44·(D/r₀)^(5/3)·u^(5/3)) with u = f/cutoff = bin/pupilSamples. Invert
  // for r₀_eff so a flat r₀_eff(u) means "a pure r₀ shift, not a shape change".
  const r0effOverR0 = (bin: number): number => {
    const u = bin / PUPIL_SAMPLES;
    const atm = mScreen[bin]! / cleanMtf[bin]!;
    const dOverR0Eff = Math.pow(-Math.log(atm) / (3.44 * Math.pow(u, 5 / 3)), 3 / 5);
    return D / dOverR0Eff / r0;
  };
  return { fwhm: fwhmPx(mean, N), r0effOverR0, maxStep };
}

// Built once: the diffraction-only PSF and its MTF are the denominators.
const cleanPsf: Psf = psfFromPupilFunction(flatPupil, SCALE, 0, {
  pupilSamples: PUPIL_SAMPLES,
  padFactor: PAD,
});
const cleanMtf = radialMtf(mtf(cleanPsf).modulation, N, PUPIL_SAMPLES + 1);

// ---- Plumbing rungs (fast) -----------------------------------------------

describe("the seeded generator is deterministic and standard-normal", () => {
  it("the same seed replays, a different seed diverges", () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    const c = mulberry32(43);
    const av = [a.next(), a.next(), a.next()];
    expect([b.next(), b.next(), b.next()]).toEqual(av);
    expect(c.next()).not.toBe(av[0]);
  });

  it("nextGaussian is mean 0, variance 1", () => {
    const rng = mulberry32(7);
    let sum = 0;
    let sumSq = 0;
    const n = 100000;
    for (let i = 0; i < n; i++) {
      const g = rng.nextGaussian();
      sum += g;
      sumSq += g * g;
    }
    expect(Math.abs(sum / n)).toBeLessThan(0.02);
    expect(Math.abs(sumSq / n - 1)).toBeLessThan(0.02);
  });
});

describe("a screen composes onto a pupil as pure phase", () => {
  const base: SeeingSpec = { friedParamMm: 40, apertureDiameterMm: D, seed: 5, screenSamples: 128 };

  it("the same seed makes the same screen; a different seed does not", () => {
    const s1 = kolmogorovScreen(base);
    const s2 = kolmogorovScreen(base);
    const s3 = kolmogorovScreen({ ...base, seed: 6 });
    expect(s1.opdMm[1000]).toBe(s2.opdMm[1000]);
    expect(s1.opdMm[1000]).not.toBe(s3.opdMm[1000]);
  });

  it("withPhaseScreen leaves amplitude untouched and adds the screen's waves", () => {
    const screen = kolmogorovScreen(base);
    const wrapped = withPhaseScreen(flatPupil, screen, REF_LAM);
    const add = screenPhaseWaves(screen, REF_LAM);
    // Amplitude is the bare aperture — turbulence dims nothing.
    expect(wrapped.amplitude(0.3, 0.2)).toBe(flatPupil.amplitude(0.3, 0.2));
    expect(wrapped.amplitude(1.5, 0)).toBe(0);
    // Phase is base (0 here) plus the screen sample.
    expect(wrapped.phaseWaves(0.3, 0.2)).toBeCloseTo(add(0.3, 0.2), 12);
  });

  it("halving the wavelength doubles the phase in waves (OPD is colour-free)", () => {
    const screen = kolmogorovScreen(base);
    const atRef = screenPhaseWaves(screen, REF_LAM);
    const atHalf = screenPhaseWaves(screen, REF_LAM / 2);
    expect(atHalf(0.25, -0.1)).toBeCloseTo(2 * atRef(0.25, -0.1), 10);
  });

  it("rejects screens it cannot build", () => {
    expect(() => kolmogorovScreen({ ...base, screenSamples: 100 })).toThrow(/power of two/);
    expect(() => kolmogorovScreen({ ...base, oversize: 0.5 })).toThrow(/oversize/);
    expect(() => kolmogorovScreen({ ...base, friedParamMm: 0 })).toThrow(/friedParamMm/);
    expect(() => kolmogorovScreen({ ...base, apertureDiameterMm: 0 })).toThrow(/apertureDiameterMm/);
  });
});

// ---- Physics rungs (ensemble) --------------------------------------------

describe("the screen obeys Kolmogorov statistics", () => {
  it("D_φ(r) follows 6.88·(r/r₀)^(5/3): the 5/3 slope and the constant", () => {
    // Structure function needs no transform — this is the generator in
    // isolation, ε = 0-first, before the OTF and FWHM lean on it. Averaged over
    // ~30 screens (millions of pairs each, so it converges fast).
    const dOverR0 = 5;
    const r0mm = D / dOverR0;
    // Separations spanning the resolved mid-band r/r₀ ∈ [0.5, 2].
    const seps = [0.1, 0.15, 0.2, 0.3, 0.4]; // in aperture diameters
    const acc = new Float64Array(seps.length);
    const nEns = 30;
    for (let s = 0; s < nEns; s++) {
      const screen = kolmogorovScreen({
        friedParamMm: r0mm,
        apertureDiameterMm: D,
        screenSamples: 512,
        oversize: 4,
        subharmonics: 6,
        seed: 9000 + s,
      });
      const sf = phaseStructureFunction(screen, seps);
      for (let i = 0; i < seps.length; i++) acc[i] = acc[i]! + sf[i]!;
    }
    for (let i = 0; i < seps.length; i++) acc[i] = acc[i]! / nEns;

    // The value at r ≈ r₀ (sep 0.2·D, since r₀ = 0.2·D here): the constant.
    const rOverR0 = seps.map((s) => (s * D) / r0mm);
    const idxR0 = rOverR0.findIndex((x) => Math.abs(x - 1) < 1e-9);
    const theoryAtR0 = 6.88; // (r/r₀ = 1)
    // A few-percent low bias is the finite-screen truncation, documented above.
    expect(acc[idxR0]! / theoryAtR0).toBeGreaterThan(0.8);
    expect(acc[idxR0]! / theoryAtR0).toBeLessThan(1.08);

    // Log–log slope over the mid-band pins the 5/3 power law (the shape), which
    // is independent of the constant. Least squares on log D_φ vs log r.
    let sx = 0, sy = 0, sxx = 0, sxy = 0;
    const m = seps.length;
    for (let i = 0; i < m; i++) {
      const lx = Math.log(rOverR0[i]!);
      const ly = Math.log(acc[i]!);
      sx += lx;
      sy += ly;
      sxx += lx * lx;
      sxy += lx * ly;
    }
    const slope = (m * sxy - sx * sy) / (m * sxx - sx * sx);
    expect(slope).toBeGreaterThan(1.45);
    expect(slope).toBeLessThan(1.75);
  });
});

describe("the ensemble reproduces Fried's long-exposure seeing", () => {
  it("the OTF is exp(−3.44·(ρ/r₀)^5/3) — r₀_eff flat across frequency and ≈ r₀", { timeout: 120000 }, () => {
    // The tight, well-converged pin. r₀_eff recovered from the OTF at each
    // frequency; flatness across u is what proves the generator's small error
    // is a pure r₀ shift, not a shape distortion.
    const e = seeingEnsemble(4, 120, 10000, cleanMtf);
    const bins = [3, 4, 6, 8, 10]; // u = f/cutoff ∈ [0.05, 0.16], above the noise floor
    const vals = bins.map((b) => e.r0effOverR0(b));
    for (const v of vals) {
      expect(v).toBeGreaterThan(0.9);
      expect(v).toBeLessThan(1.12);
    }
    // Flat: the spread across frequency is small (effective-r₀ shift, not shape).
    const spread = Math.max(...vals) / Math.min(...vals);
    expect(spread).toBeLessThan(1.12);
    // The under-resolution guard: the fidelity criterion is blind to the screen,
    // so this is what catches a screen the FFT grid cannot represent.
    expect(e.maxStep).toBeLessThan(0.5);
  });

  it("seeing depends on r₀, not aperture: r₀_eff ≈ r₀ at two different D/r₀", { timeout: 120000 }, () => {
    // The λ/r₀ scaling and D-independence in one move, and the OTF carries it
    // rather than the pixel FWHM: if the transfer function returns the same r₀
    // whatever the aperture, then the seeing disc is set by r₀ alone — a bigger
    // telescope does not resolve past the seeing — and its FWHM ∝ 1/r₀ follows.
    // This is the robust way to state the scaling, because the pixel FWHM's
    // finite-screen narrow-bias itself grows with D/r₀ (an 8-cell-wide r₀ on a
    // 64-sample pupil is marginally resolved) and would contaminate a raw FWHM
    // ratio; the OTF's r₀_eff does not, so the scaling law lands cleanly on it.
    const e4 = seeingEnsemble(4, 120, 11000, cleanMtf);
    const e8 = seeingEnsemble(8, 120, 12000, cleanMtf);
    for (const b of [2, 3, 4]) {
      expect(e4.r0effOverR0(b)).toBeGreaterThan(0.9);
      expect(e4.r0effOverR0(b)).toBeLessThan(1.13);
      expect(e8.r0effOverR0(b)).toBeGreaterThan(0.9);
      expect(e8.r0effOverR0(b)).toBeLessThan(1.16);
    }
    // The guard holds even under strong seeing: the screen is still resolved.
    expect(e4.maxStep).toBeLessThan(0.5);
    expect(e8.maxStep).toBeLessThan(0.5);

    // The pixel FWHM honours the headline number ≈ 0.98·λ/r₀, pinned where it is
    // well resolved (D/r₀ = 4) and by a wide band — it is the noisy estimator,
    // narrow-biased a documented few-to-fifteen percent by the finite screen.
    const fwhmTheory = 0.98 * 4 * LAM_OVER_D_PX;
    expect(e4.fwhm / fwhmTheory).toBeGreaterThan(0.8);
    expect(e4.fwhm / fwhmTheory).toBeLessThan(1.05);
  });
});
