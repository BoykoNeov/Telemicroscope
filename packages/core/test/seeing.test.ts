import { describe, it, expect } from "vitest";
import { mulberry32 } from "../src/math/random";
import {
  kolmogorovScreen,
  withPhaseScreen,
  screenPhaseWaves,
  phaseStructureFunction,
  SeeingSpec,
} from "../src/wave/seeing";
import {
  psf,
  psfFromPupilFunction,
  pupilFunctionFromOpd,
  systemPupil,
  PupilFunction,
  PupilScale,
} from "../src/wave/psf";
import { achromaticObjective } from "../src/designs/achromat";
import { bestFocus, withFocus } from "../src/analysis/focus";
import { friedAtmosphericMtf, longExposurePsf } from "../src/wave/long-exposure";
import { spectralStack } from "../src/wave/polychromatic";
import { opdMap } from "../src/pupil/opd";
import { pupilGrid } from "../src/pupil/aiming";
import { fitZernike } from "../src/wave/zernike";
import { OpticalSystem } from "../src/trace/system";
import { Prescription } from "../src/trace/prescription";
import { LINE_D } from "../src/materials/dispersion";

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
const SCALE: PupilScale = { referenceRadius: 1000, exitRadius: D / 2, wavelengthNm: REF_LAM, nImage: 1, slopeRadius: undefined };
// λ/D in pixels equals n/pupilSamples = PAD, which sets the FWHM scale.
const LAM_OVER_D_PX = PAD;

const flatPupil: PupilFunction = {
  amplitude: (px, py) => (px * px + py * py <= 1 ? 1 : 0),
  phaseWaves: () => 0,
};

/**
 * Ensemble-mean PSF through the atmosphere at a given D/r₀.
 *
 * This used to be twenty lines of accumulation and two radial helpers, all
 * local to this file — which is exactly why § 5d.1 exists: the physics below was
 * pinned and the machinery that produces it was unreachable from anywhere else,
 * so an app could show one speckle draw and nothing more. It is now
 * `longExposurePsf` in `wave/long-exposure`, and this is a call to it.
 *
 * What was checked, stated as what it is: every rung below **passes unchanged, at
 * the same seeds and inside the same bands**, and the promotion preserves the
 * per-screen call sequence and the accumulation order by construction. That is
 * not the same as having compared the values digit for digit before and after —
 * these bands are wide (0.9–1.12) and would absorb a small drift — so the claim
 * is the one that was verified, not the stronger one it is tempting to write.
 */
function seeingEnsemble(dOverR0: number, nEns: number, seed0: number) {
  return longExposurePsf({
    pupil: flatPupil,
    scale: SCALE,
    seeing: {
      friedParamMm: D / dOverR0,
      apertureDiameterMm: D,
      screenSamples: SCREEN_N,
      oversize: 4,
      subharmonics: 6,
      seed: seed0,
    },
    wavelengthNm: REF_LAM,
    screens: nEns,
    psfOptions: { pupilSamples: PUPIL_SAMPLES, padFactor: PAD },
  });
}

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

// ---- Wiring rungs: the screen through psf() and the polychromatic stack ---
//
// The physics is pinned upstream on the bare screen and its ensemble; these are
// *plumbing* — that `psf({seeing})` is exactly the composed `withPhaseScreen`
// path, and that the polychromatic stack applies ONE screen to every colour
// honestly (stored as OPD, so the bluer plane carries proportionally more
// waves). Cheap by construction: single screens, no ensemble.

/** A geometrically perfect paraboloid at NA 0.1 — anything past a point is the screen. */
function paraboloid(wavelengths = [{ nm: LINE_D, weight: 1 }]): OpticalSystem {
  const R = -200; // concave; focus at R/2
  const semiAperture = 10; // NA = 10/100 = 0.1, full aperture 20 mm
  const prescription: Prescription = {
    surfaces: [
      { kind: "reflect", curvature: 1 / R, conic: -1, semiAperture, thickness: R / 2, isStop: true },
    ],
  };
  return {
    prescription,
    aperture: { kind: "stopRadius", value: semiAperture },
    field: { kind: "angle", values: [0] },
    wavelengths,
    conjugate: { kind: "infinite" },
  };
}

/** The screen the wiring rungs share: D/r₀ = 4 on the 20 mm paraboloid. */
const wiringScreen = () =>
  kolmogorovScreen({
    friedParamMm: 5,
    apertureDiameterMm: 20,
    screenSamples: 256,
    oversize: 4,
    subharmonics: 6,
    seed: 3,
  });

const WIRE_GRID = { pupilSamples: 64, padFactor: 4, traceSamples: 21, zernikeTerms: 28 } as const;

describe("psf() composes the seeing screen, in the FFT branch, colour-honestly", () => {
  it("psf({seeing}) is bit-identical to the manual withPhaseScreen compose", () => {
    const sys = paraboloid();
    const screen = wiringScreen();
    const wired = psf(sys, 0, LINE_D, { ...WIRE_GRID, seeing: screen });

    // Reproduce psf()'s own pipeline and wrap the pupil by hand: the wiring must
    // add nothing the composition would not, so the two intensity arrays match
    // exactly, not merely closely.
    const map = opdMap(sys, 0, LINE_D, pupilGrid(21), {});
    const fit = fitZernike(map.samples, 28);
    const pupil = pupilFunctionFromOpd(map, fit);
    const scale: PupilScale = {
      referenceRadius: map.referenceRadius,
      exitRadius: map.pupil.exit.radius,
      wavelengthNm: LINE_D,
      nImage: map.pupil.exit.n,
      slopeRadius: map.pupil.exit.slopeRadius,
    };
    const manual = psfFromPupilFunction(withPhaseScreen(pupil, screen, LINE_D), scale, 0, WIRE_GRID);

    expect(wired.intensity).toEqual(manual.intensity);
    expect(wired.maxGridPhaseStepWaves).toBe(manual.maxGridPhaseStepWaves);
  });

  it("the screen degrades the PSF and the guard rises but stays resolved", () => {
    const sys = paraboloid();
    const clean = psf(sys, 0, LINE_D, WIRE_GRID);
    const seen = psf(sys, 0, LINE_D, { ...WIRE_GRID, seeing: wiringScreen() });

    // The perfect paraboloid is Strehl ≈ 1; the atmosphere pulls it down.
    expect(seen.strehl).toBeLessThan(clean.strehl);
    // The guard is blind to nothing now: the screen shows up on the FFT grid…
    expect(seen.maxGridPhaseStepWaves).toBeGreaterThan(clean.maxGridPhaseStepWaves);
    // …and at D/r₀ = 4 the 256²/oversize-4 screen is still resolved (< ½ wave).
    expect(seen.maxGridPhaseStepWaves).toBeLessThan(0.5);
  });

  it("one OPD screen across the spectrum: the bluer colour carries more waves", () => {
    const sys = paraboloid([
      { nm: 400, weight: 1 },
      { nm: 800, weight: 1 },
    ]);
    const screen = wiringScreen();
    const grid = { pupilSamples: 64, padFactor: 4, traceSamples: 21 } as const;

    const blue = psf(sys, 0, 400, { ...grid, seeing: screen });
    const red = psf(sys, 0, 800, { ...grid, seeing: screen });

    // Stored as OPD → phase in waves ∝ 1/λ, so halving the wavelength doubles the
    // grid phase step through the wired path (the paraboloid's own OPD ≈ 0).
    expect(blue.maxGridPhaseStepWaves / red.maxGridPhaseStepWaves).toBeGreaterThan(1.85);
    expect(blue.maxGridPhaseStepWaves / red.maxGridPhaseStepWaves).toBeLessThan(2.15);
    // More waves of the same bumps → the blue image is the more degraded one.
    expect(blue.strehl).toBeLessThan(red.strehl);

    // Through the stack: one screen object reaches every wavelength, the guard
    // keys on the bluest (worst) plane, and — pure phase — no plane loses energy.
    const seenStack = spectralStack(sys, 0, { ...grid, seeing: screen });
    const cleanStack = spectralStack(sys, 0, grid);
    expect(seenStack.maxGridPhaseStepWaves).toBeCloseTo(blue.maxGridPhaseStepWaves, 12);
    for (const nm of [400, 800]) {
      const seenPlane = seenStack.planes.find((p) => p.nm === nm)!;
      const cleanPlane = cleanStack.planes.find((p) => p.nm === nm)!;
      expect(seenPlane.energy).toBeCloseTo(cleanPlane.energy, 10);
    }
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
    const e = seeingEnsemble(4, 120, 10000);
    const bins = [3, 4, 6, 8, 10]; // u = f/cutoff ∈ [0.05, 0.16], above the noise floor
    const vals = bins.map((b) => e.effectiveFriedRatio[b]!);
    for (const v of vals) {
      expect(v).toBeGreaterThan(0.9);
      expect(v).toBeLessThan(1.12);
    }
    // Flat: the spread across frequency is small (effective-r₀ shift, not shape).
    const spread = Math.max(...vals) / Math.min(...vals);
    expect(spread).toBeLessThan(1.12);
    // The under-resolution guard: the fidelity criterion is blind to the screen,
    // so this is what catches a screen the FFT grid cannot represent.
    expect(e.maxGridPhaseStepWaves).toBeLessThan(0.5);
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
    const e4 = seeingEnsemble(4, 120, 11000);
    const e8 = seeingEnsemble(8, 120, 12000);
    for (const b of [2, 3, 4]) {
      expect(e4.effectiveFriedRatio[b]!).toBeGreaterThan(0.9);
      expect(e4.effectiveFriedRatio[b]!).toBeLessThan(1.13);
      expect(e8.effectiveFriedRatio[b]!).toBeGreaterThan(0.9);
      expect(e8.effectiveFriedRatio[b]!).toBeLessThan(1.16);
    }
    // The guard holds even under strong seeing: the screen is still resolved.
    expect(e4.maxGridPhaseStepWaves).toBeLessThan(0.5);
    expect(e8.maxGridPhaseStepWaves).toBeLessThan(0.5);

    // The pixel FWHM honours the headline number ≈ 0.98·λ/r₀, pinned where it is
    // well resolved (D/r₀ = 4) and by a wide band — it is the noisy estimator,
    // narrow-biased a documented few-to-fifteen percent by the finite screen.
    const fwhmTheory = 0.98 * 4 * LAM_OVER_D_PX;
    expect(e4.fwhmPixels / fwhmTheory).toBeGreaterThan(0.8);
    expect(e4.fwhmPixels / fwhmTheory).toBeLessThan(1.05);
  });
});

/**
 * § 5d.1 — the ensemble is an API now, and it runs on a REAL system.
 *
 * The rungs above are § 5d's, unchanged, and the promotion's honesty is that
 * their bands did not move. What is new is what the helper could not carry: it
 * closed over a **flat pupil**, so every long-exposure number this ladder had
 * was measured on a perfect aperture and nothing could ask what an instrument
 * with aberration of its own does under the same sky. That is exactly what an
 * app surface wants to draw, so it is pinned before one draws it.
 */
describe("§ 5d.1 — the long exposure, exported", () => {
  it("one screen is `psf({seeing})` exactly — the ensemble's degenerate case", () => {
    // `screens: 1` must not be a special path. Byte-for-byte against the wiring
    // rung's own composition, so the average adds nothing at N = 1.
    const seeing: SeeingSpec = {
      friedParamMm: D / 4,
      apertureDiameterMm: D,
      screenSamples: SCREEN_N,
      oversize: 4,
      subharmonics: 6,
      seed: 7000,
    };
    const one = longExposurePsf({
      pupil: flatPupil,
      scale: SCALE,
      seeing,
      wavelengthNm: REF_LAM,
      screens: 1,
      psfOptions: { pupilSamples: PUPIL_SAMPLES, padFactor: PAD },
    });
    const manual = psfFromPupilFunction(
      withPhaseScreen(flatPupil, kolmogorovScreen(seeing), REF_LAM),
      SCALE,
      0,
      { pupilSamples: PUPIL_SAMPLES, padFactor: PAD },
    );
    for (const i of [0, 1234, N * N - 1, (N / 2) * N + N / 2]) {
      expect(one.psf.intensity[i]).toBe(manual.intensity[i]);
    }
    expect(one.maxGridPhaseStepWaves).toBe(manual.maxGridPhaseStepWaves);
    // ...and the seed is the FIRST screen's, so screen 0 is the bare spec's.
    expect(one.screens).toBe(1);
  });

  it("the transfer function IS Fried's closed form, evaluated rather than inverted", () => {
    // The rungs above invert Fried for r₀_eff, which is the discriminator. This
    // is the same statement forward: the measured atmospheric MTF against
    // exp(−3.44·(ν·D/r₀)^(5/3)) with no fitting anywhere, over the band where
    // the ensemble is above its own noise floor.
    const e = seeingEnsemble(4, 120, 10000);
    for (const b of [3, 4, 6, 8, 10]) {
      const nu = b / PUPIL_SAMPLES;
      const ratio = e.atmosphericModulation[b]! / friedAtmosphericMtf(4, nu);
      // A few percent high: the finite screen's r₀ inflation, the documented
      // tolerance of this whole section, seen a fourth way.
      expect(ratio).toBeGreaterThan(1.0);
      expect(ratio).toBeLessThan(1.35);
    }
  });

  it("a draw's width is a random variable and a mean's is not — 5.3× against 1.08×", () => {
    // The sentence the app surface exists to show, and the first draft of this
    // rung got its shape wrong: it asserted a single screen is *narrower* than
    // the mean, which was a guess about magnitude standing in for the claim. The
    // claim is about VARIANCE. One screen's FWHM is a draw — over five seeds it
    // runs 12.3 to 65.3 px, a factor of **5.3** — while a mean over only thirty
    // is stable to 7.5% between two disjoint seed sets. That contrast is what
    // "one screen is a speckle pattern and only the mean is the seeing disc"
    // actually says, and it is why the ensemble is compute-once rather than a
    // number one draw could stand in for.
    const draws = [10000, 20000, 30000, 40000, 50000].map((seed) => seeingEnsemble(4, 1, seed));
    const widths = draws.map((d) => d.fwhmPixels);
    const drawSpread = Math.max(...widths) / Math.min(...widths);
    expect(drawSpread).toBeGreaterThan(2.5);

    const a = seeingEnsemble(4, 30, 60000);
    const b = seeingEnsemble(4, 30, 70000);
    const meanSpread = Math.max(a.fwhmPixels, b.fwhmPixels) / Math.min(a.fwhmPixels, b.fwhmPixels);
    expect(meanSpread).toBeLessThan(1.2);
    expect(drawSpread).toBeGreaterThan(3 * (meanSpread - 1) + 1);

    // And the mean is a genuinely different object, not a noisy version of a
    // draw: averaging destroys the bright speckle core. Against the same clean
    // instrument, one draw peaks at ~0.31 of the diffraction peak and the
    // 120-screen mean at ~0.06 — five times fainter at the centre, which is the
    // visible difference between a speckle frame and a seeing disc.
    const many = seeingEnsemble(4, 120, 10000);
    const peak = (v: Float64Array) => v.reduce((m, x) => (x > m ? x : m), 0);
    const cleanPeak = peak(many.clean.intensity);
    expect(peak(draws[0]!.psf.intensity) / cleanPeak).toBeGreaterThan(4 * (peak(many.psf.intensity) / cleanPeak));
    // The mean is far wider than the diffraction core it came from...
    expect(many.fwhmPixels / many.cleanFwhmPixels).toBeGreaterThan(3);
    // ...and the clean instrument is untouched by any of it — same pupil, every
    // screen, so its FWHM is bitwise the same number in every ensemble above.
    expect(draws[0]!.cleanFwhmPixels).toBe(many.cleanFwhmPixels);
  });

  it("...and it recovers r₀ on a REAL traced system, not only on a flat pupil", () => {
    // The pin the test-local helper could not carry. A 200 mm f/8 achromat has a
    // fifth-order spherical residual of its own; its pupil is a Zernike fit of a
    // traced wavefront rather than a mathematical disc. Fried's r₀ must come
    // back anyway, because the atmospheric MTF is a RATIO against the same
    // instrument — the system divides out, which is the claim.
    const objective = achromaticObjective({ apertureMm: D, focalRatio: 8 });
    const system: OpticalSystem = {
      prescription: objective.prescription,
      aperture: { kind: "EPD", value: D },
      field: { kind: "angle", values: [0] },
      wavelengths: [{ nm: REF_LAM, weight: 1 }],
      conjugate: { kind: "infinite" },
    };
    const focus = bestFocus(system, "minRmsWavefront", { wavelengthNm: REF_LAM });
    const { pupil, scale } = systemPupil(withFocus(system, focus.offsetFromLastVertex), 0, REF_LAM);

    const traced = longExposurePsf({
      pupil,
      scale,
      seeing: {
        friedParamMm: D / 4,
        apertureDiameterMm: D,
        screenSamples: SCREEN_N,
        oversize: 4,
        subharmonics: 6,
        seed: 13000,
      },
      wavelengthNm: REF_LAM,
      screens: 60,
      psfOptions: { pupilSamples: PUPIL_SAMPLES, padFactor: PAD },
    });

    // The instrument really is aberrated — otherwise this rung is the one above.
    expect(traced.clean.strehl).toBeLessThan(0.999);
    expect(traced.clean.strehl).toBeGreaterThan(0.5);
    for (const b of [3, 4, 6, 8, 10]) {
      expect(traced.effectiveFriedRatio[b]!).toBeGreaterThan(0.9);
      expect(traced.effectiveFriedRatio[b]!).toBeLessThan(1.15);
    }
    expect(traced.maxGridPhaseStepWaves).toBeLessThan(0.5);
  });

  it("refuses a screen count that is not a positive integer", () => {
    const spec = {
      pupil: flatPupil,
      scale: SCALE,
      seeing: { friedParamMm: D / 4, apertureDiameterMm: D, screenSamples: 64 },
      wavelengthNm: REF_LAM,
    };
    expect(() => longExposurePsf({ ...spec, screens: 0 })).toThrow(/positive integer/);
    expect(() => longExposurePsf({ ...spec, screens: 2.5 })).toThrow(/positive integer/);
  });
});
