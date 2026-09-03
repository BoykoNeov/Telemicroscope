import { describe, it, expect } from "vitest";
import { besselJ, BESSEL_SERIES_LIMIT } from "../src/math/bessel";
import { adaptiveIntegral } from "../src/math/quadrature";
import { pupilGrid } from "../src/pupil/aiming";
import { OpticalSystem } from "../src/trace/system";
import { Prescription } from "../src/trace/prescription";
import { LINE_D } from "../src/materials/dispersion";
import { psf, imagePixelScaleMm, Psf, PupilScale } from "../src/wave/psf";
import { geometricPsf, adaptivePsf, rayDeflectionScaleMm } from "../src/wave/geometric";
import {
  kolmogorovScreen,
  screenPhaseWaves,
  screenTiltWaves,
  KOLMOGOROV_PSD_COEFF,
  PhaseScreen,
} from "../src/wave/seeing";

/**
 * § 5d.2 — seeing's geometric analog: the deflection a ray histogram carries.
 *
 * § 5d built the atmosphere as pure phase and said so plainly: a phase screen
 * has no amplitude mask, so the ray branch had nothing to add it to and the
 * fallback lost the sky exactly where the system's own aberration took over.
 * The missing capability was never in doubt — deflect each ray by ∇φ — and this
 * file is its pin. `wave/seeing` grew `screenTiltWaves`, `wave/geometric` grew
 * `rayDeflectionScaleMm` and a `seeing` option, and `adaptivePsf` now blends two
 * images of the SAME sky at every point of the fidelity band.
 *
 * ## The external number, and the correction the register needed
 *
 * `OPEN-PROBLEMS` A5 named the pin as Fried's angle-of-arrival variance with
 * coefficient **0.182**. That number is right for a quantity this branch does
 * not compute. Two different "tilts" are in the literature and they differ by
 * 7%:
 *
 *  - **G-tilt**, the aperture-AVERAGED wavefront gradient, coefficient
 *    **0.170** — and it is a ray-bundle centroid by definition, because
 *    averaging each ray's deflection over the pupil is the same arithmetic as
 *    averaging the gradient over the pupil.
 *  - **Z-tilt**, the least-squares plane through the wavefront (the Zernike tip
 *    coefficient), coefficient **0.182** — what a Shack-Hartmann centroid or a
 *    tip-tilt mirror tracks.
 *
 * A ray histogram's centre of mass is the first of those. So the pin this file
 * asserts against is 0.170·λ²·D^(−1/3)·r₀^(−5/3) per axis, 0.182 is asserted
 * alongside it as the other reading of the same screens, and the register's
 * entry is struck with the correction rather than with a claim of success.
 *
 * ## The coefficients are re-derived here, not quoted
 *
 * Both fall out of the same PSD the generator is built on, Φ(f) = c·r₀^(−5/3)·
 * f^(−11/3), through one Weber-Schafheitlin integral each:
 *
 *     σ²_G = 4π·c·π^(5/3)·∫₀^∞ u^(−8/3) J₁²(u) du · λ² D^(−1/3) r₀^(−5/3)
 *     σ²_Z = 64·c·π^(2/3)·∫₀^∞ u^(−14/3) J₂²(u) du · λ² D^(−1/3) r₀^(−5/3)
 *
 * — the J₁ because a circular aperture's averaging kernel is 2J₁(πDf)/(πDf),
 * the J₂ because a least-squares plane weights by an extra factor of radius.
 * They are integrated here with the ladder's own `adaptiveIntegral` and pinned
 * against their closed forms, and then the whole chain is checked against
 * Noll 1976's independently tabulated tip variance. That matters because of
 * the last link: the derivation must be evaluated at **the constant the
 * generator actually used**, 0.023, which is 0.46% above the exact 0.022896.
 * Every variance in this file rides that 0.46%, and the rungs are tight enough
 * to see it — so it is asserted rather than absorbed.
 *
 * ## What the ensemble can pin and what it cannot
 *
 * Two of A5's three factors are not measurements at all. The generator is
 * scale-free — it builds in aperture-diameter units and only D/r₀ enters — so
 * two screens at the same D/r₀ and different D have **bitwise identical** OPD,
 * and halving r₀ multiplies it by exactly 2^(5/6). The D^(−1/3) and r₀^(−5/3)
 * scalings are therefore identities of the construction, pinned to the bit on
 * two screens instead of chased through a 300-screen ensemble that could only
 * have recovered them to a few percent. The ensemble is spent entirely on the
 * one thing it alone can settle: the **coefficient**.
 *
 * And there it lands 4% low, for a reason that is measured rather than
 * excused. A finite screen truncates the largest turbulent scales and a finite
 * grid the smallest, and both losses are in the direction of less tilt. The
 * trend rung watches the deficit close monotonically — 0.60 of the closed form
 * on a screen twice the aperture, 0.80 at four times, 0.96 at sixteen times and
 * twice the resolution — which is what earns the band, exactly as § 5d earned
 * its own few-percent r₀ inflation by showing it was one r₀ shift and not a
 * shape error.
 *
 * ## The finding: one statistic converges, the other has no limit
 *
 * The same screens carry a second number, and it does not behave. The variance
 * of a SINGLE ray's deflection is ∫f³Φ(f)df over the resolved band, which
 * diverges at high frequency: refine the screen and each ray bends more,
 * forever. Measured, the per-ray rms grows as (screen samples)^(1/6) — a factor
 * 1.25 for a 4× refinement against a predicted 1.26. The aperture-average does
 * not move, because averaging over the pupil kills the high frequencies that
 * drive the divergence. So the honest statement about this branch is not "the
 * blur is right": the blur's fine structure is set by the screen grid and has
 * no grid-independent limit. What is right, and what Fried's angle of arrival
 * actually pins, is where the light's centre of mass goes.
 *
 * ## And the centroid is what the pipeline is pinned on
 *
 * Two rungs, in that order. A pure ramp (ε = 0, no randomness) fixes the SCALE:
 * a screen tilted a waves per pupil radius moves the histogram by exactly
 * 2·padFactor·a pixels, which is the same identity `defaultRayGrid` sizes the
 * ray bundle with, and the FFT branch lands within 0.7% of the same place.
 * Then real Kolmogorov screens through the whole of `geometricPsf` reproduce
 * 2·padFactor·⟨∂φ/∂px⟩ screen by screen, worst case 0.19 px, regression slope
 * 0.999 — so the statistics pinned on the reader above are the statistics the
 * image actually has.
 *
 * That pairing runs at weight 0, on a stigmatic mirror, and deliberately.
 * At weight 1 the centroid is not a usable statistic: the criterion that trips
 * the fallback (phase step > ½ wave per pupil sample) forces the geometric blur
 * radius to 2·step half-grids, so a weight-1 blur ALWAYS overruns the
 * diffraction-sized frame and its centre of mass is set by where the frame cuts
 * rather than by where the rays went. What the weight-1 rung asserts is
 * therefore the thing the deferral was actually about: the image is no longer
 * the same image. Before this change a screen at weight 1 was byte-identical to
 * no screen at all; now it differs by two thirds of the total energy, and by
 * more when the seeing is worse.
 */

/** D/r₀ ensembles run on a 200 mm aperture at 500 nm — the § 5d convention. */
const ENSEMBLE_D = 200;
const ENSEMBLE_LAM = 500;
/** Pupil sampling for every tilt average here. */
const PUPIL_POINTS = pupilGrid(41);

// ---------------------------------------------------------------------------
// The coefficients, from the PSD the generator is built on.
// ---------------------------------------------------------------------------

/**
 * ∫₀^∞ u^(−p) J_ν(u)² du by the substitution u = t³.
 *
 * The substitution is what makes this integrable at all: the integrand goes as
 * u^(2ν−p) near zero, which for (ν, p) = (1, 8/3) is u^(−2/3) — finite in value
 * but with an infinite derivative, and adaptive quadrature bisects forever
 * against that. Cubing spreads the origin out into a smooth region. Past
 * `BESSEL_SERIES_LIMIT` the mean value of J² is 1/(πu) and the remaining tail
 * is done in closed form; the oscillation about that mean contributes below the
 * quadrature's own 1e-6, which is why the closed-form rungs below hold to that
 * and not further.
 */
function besselMoment(order: number, p: number): number {
  const U = BESSEL_SERIES_LIMIT;
  const T = Math.pow(U, 1 / 3);
  const f = (t: number): number => {
    const j = besselJ(order, t * t * t);
    return 3 * Math.pow(t, 2 - 3 * p) * j * j;
  };
  let core = 0;
  const panels = 24;
  for (let i = 0; i < panels; i++) {
    core += adaptiveIntegral(f, (T * i) / panels, (T * (i + 1)) / panels, { tolerance: 1e-11 });
  }
  return core + Math.pow(U, -p) / (Math.PI * p);
}

/** One-axis G-tilt (aperture-averaged gradient) coefficient at a PSD constant. */
function gTiltCoefficient(psdCoeff: number): number {
  return (16 * Math.PI * psdCoeff * Math.pow(Math.PI, 5 / 3) * besselMoment(1, 8 / 3)) /
    (4 * Math.PI * Math.PI);
}

/** One-axis Z-tilt (least-squares plane) coefficient at a PSD constant. */
function zTiltCoefficient(psdCoeff: number): number {
  return 64 * psdCoeff * Math.pow(Math.PI, 2 / 3) * besselMoment(2, 14 / 3);
}

/** Noll's tip/tilt Zernike VARIANCE coefficient, in (D/r₀)^(5/3) — his a₂. */
function nollTipVariance(psdCoeff: number): number {
  return 16 * Math.PI * psdCoeff * Math.pow(Math.PI, 5 / 3) * besselMoment(2, 14 / 3);
}

/**
 * The exact Kolmogorov PSD constant against a CYCLIC frequency: 0.490·(2π)^(−5/3).
 * `KOLMOGOROV_PSD_COEFF` is the rounded 0.023 the generator was written on.
 */
const EXACT_PSD_COEFF = 0.0228956;

/** Evaluated once — each is a few thousand adaptive-quadrature evaluations. */
const G_TILT = gTiltCoefficient(KOLMOGOROV_PSD_COEFF);
const Z_TILT = zTiltCoefficient(KOLMOGOROV_PSD_COEFF);

describe("the tilt coefficients come from the generator's own PSD", () => {
  it("the two Weber-Schafheitlin moments match their closed forms", () => {
    // Watson's formula for ∫ J_μ J_ν t^(−λ) dt at μ = ν, evaluated from Γ.
    expect(besselMoment(1, 8 / 3)).toBeCloseTo(0.8643735252, 5);
    expect(besselMoment(2, 14 / 3)).toBeCloseTo(0.05787946414, 8);
    // Stated as relative error, because that is what the rungs below inherit.
    expect(Math.abs(besselMoment(1, 8 / 3) / 0.8643735252 - 1)).toBeLessThan(5e-6);
    expect(Math.abs(besselMoment(2, 14 / 3) / 0.05787946414 - 1)).toBeLessThan(1e-6);
  });

  it("the chain reproduces Noll 1976's tabulated tip variance", () => {
    // Noll table 1: Δ₁ = 1.0299, Δ₂ = 0.582 (D/r₀)^(5/3) of residual, so the
    // one tip term removes 1.0299 − 0.582 = 0.4479 — an entirely independent
    // published route to the same integral.
    const tip = nollTipVariance(EXACT_PSD_COEFF);
    expect(tip).toBeCloseTo(0.4489, 3);
    expect(Math.abs(tip / (1.0299 - 0.582) - 1)).toBeLessThan(0.005);
  });

  it("G-tilt is 0.170 and Z-tilt is 0.182, at the exact PSD constant", () => {
    expect(gTiltCoefficient(EXACT_PSD_COEFF)).toBeCloseTo(0.169804, 5);
    expect(zTiltCoefficient(EXACT_PSD_COEFF)).toBeCloseTo(0.181924, 5);
    expect(Math.abs(gTiltCoefficient(EXACT_PSD_COEFF) / 0.170 - 1)).toBeLessThan(0.005);
    expect(Math.abs(zTiltCoefficient(EXACT_PSD_COEFF) / 0.182 - 1)).toBeLessThan(0.005);
  });

  it("the generator's rounded constant is 0.46% high, and every variance rides it", () => {
    expect(KOLMOGOROV_PSD_COEFF / EXACT_PSD_COEFF).toBeCloseTo(1.0045597, 6);
    expect(G_TILT).toBeCloseTo(0.1705780310280268, 12);
    expect(Z_TILT).toBeCloseTo(0.18275343385286763, 12);
    expect(G_TILT / gTiltCoefficient(EXACT_PSD_COEFF)).toBeCloseTo(1.0045597, 6);
  });

  it("the ratio Z/G is 1.0714 and does not depend on the constant at all", () => {
    // A5's candidate pin was the numerator of this ratio; a ray histogram's
    // centre of mass is the denominator. 7% apart, and constant-free because
    // both coefficients are linear in c.
    expect(Z_TILT / G_TILT).toBeCloseTo(1.0713773, 6);
    expect(zTiltCoefficient(EXACT_PSD_COEFF) / gTiltCoefficient(EXACT_PSD_COEFF)).toBeCloseTo(
      Z_TILT / G_TILT,
      12,
    );
  });
});

// ---------------------------------------------------------------------------
// The two scalings are identities of a scale-free generator, not measurements.
// ---------------------------------------------------------------------------

describe("the D and r₀ scalings are exact, so no ensemble is spent on them", () => {
  const base = { screenSamples: 128, oversize: 4, subharmonics: 6, seed: 11 } as const;

  it("same D/r₀, different aperture: the OPD field is bitwise identical", () => {
    const big = kolmogorovScreen({ ...base, friedParamMm: 200 / 8, apertureDiameterMm: 200 });
    const small = kolmogorovScreen({ ...base, friedParamMm: 50 / 8, apertureDiameterMm: 50 });
    expect(small.opdMm.length).toBe(big.opdMm.length);
    for (let i = 0; i < big.opdMm.length; i++) expect(small.opdMm[i]).toBe(big.opdMm[i]!);

    // So the slope in waves per pupil RADIUS is identical too, and the arrival
    // ANGLE — slope · λ/(D/2) — is exactly inversely proportional to D. With
    // r₀ ∝ D that is precisely λ²·D^(−1/3)·r₀^(−5/3) ∝ D^(−2), the first of
    // A5's two scalings, as an identity rather than a fit.
    const tb = screenTiltWaves(big, ENSEMBLE_LAM);
    const ts = screenTiltWaves(small, ENSEMBLE_LAM);
    for (const p of PUPIL_POINTS) {
      expect(ts(p.px, p.py).dx).toBe(tb(p.px, p.py).dx);
      expect(ts(p.px, p.py).dy).toBe(tb(p.px, p.py).dy);
    }
  });

  it("halving r₀ multiplies the whole field by exactly 2^(5/6)", () => {
    const weak = kolmogorovScreen({ ...base, friedParamMm: 200 / 8, apertureDiameterMm: 200 });
    const strong = kolmogorovScreen({ ...base, friedParamMm: 200 / 16, apertureDiameterMm: 200 });
    const k = Math.pow(2, 5 / 6);
    let maxRel = 0;
    for (let i = 0; i < weak.opdMm.length; i++) {
      const want = weak.opdMm[i]! * k;
      if (want !== 0) maxRel = Math.max(maxRel, Math.abs(strong.opdMm[i]! - want) / Math.abs(want));
    }
    // Not bitwise only because r₀^(−5/6) is computed, not multiplied in.
    expect(maxRel).toBeLessThan(1e-7);
    // Variance therefore scales as 2^(5/3) — A5's r₀^(−5/3), exactly.
  });
});

// ---------------------------------------------------------------------------
// The ensemble, which exists to settle the coefficient and nothing else.
// ---------------------------------------------------------------------------

interface TiltStats {
  /** Mean square one-axis G-tilt angle (rad²) over the ensemble. */
  readonly gVar: number;
  /** Mean square one-axis Z-tilt angle (rad²). */
  readonly zVar: number;
  /** RMS of a SINGLE ray's deflection angle (rad) — the divergent one. */
  readonly rayRms: number;
}

/**
 * Average both tilt statistics, and the per-ray one, over an ensemble.
 *
 * The G-tilt is the plain mean of ∇φ across the pupil (a ray-bundle centroid);
 * the Z-tilt is the least-squares slope of φ against pupil coordinate, which
 * over a symmetric grid needs no piston term to be unbiased. Both are read
 * from the SAME screens, so the ratio rung below carries no ensemble noise
 * from the draw.
 */
function tiltStats(
  dOverR0: number,
  screenSamples: number,
  oversize: number,
  subharmonics: number,
  screens: number,
  seed0: number,
): TiltStats {
  const r0 = ENSEMBLE_D / dOverR0;
  let gSum = 0;
  let zSum = 0;
  let rSum = 0;
  for (let s = 0; s < screens; s++) {
    const screen = kolmogorovScreen({
      friedParamMm: r0,
      apertureDiameterMm: ENSEMBLE_D,
      screenSamples,
      oversize,
      subharmonics,
      seed: seed0 + s,
    });
    const tilt = screenTiltWaves(screen, ENSEMBLE_LAM);
    const phase = screenPhaseWaves(screen, ENSEMBLE_LAM);
    let mx = 0;
    let my = 0;
    let sxx = 0;
    let sxw = 0;
    let syw = 0;
    let r2 = 0;
    for (const p of PUPIL_POINTS) {
      const g = tilt(p.px, p.py);
      mx += g.dx;
      my += g.dy;
      r2 += g.dx * g.dx + g.dy * g.dy;
      const w = phase(p.px, p.py);
      sxx += p.px * p.px;
      sxw += p.px * w;
      syw += p.py * w;
    }
    mx /= PUPIL_POINTS.length;
    my /= PUPIL_POINTS.length;
    r2 /= PUPIL_POINTS.length;
    // Waves per pupil radius → radians of arrival angle.
    const k = (ENSEMBLE_LAM * 1e-6) / (ENSEMBLE_D / 2);
    gSum += (mx * k) ** 2 + (my * k) ** 2;
    zSum += ((sxw / sxx) * k) ** 2 + ((syw / sxx) * k) ** 2;
    rSum += r2 * k * k;
  }
  // Two axes per screen, so the one-axis variance divides by 2·screens.
  return {
    gVar: gSum / (2 * screens),
    zVar: zSum / (2 * screens),
    rayRms: Math.sqrt(rSum / (2 * screens)),
  };
}

/** Fried's one-axis prediction, coefficient supplied. */
function predictedVariance(coefficient: number, dOverR0: number): number {
  const r0 = ENSEMBLE_D / dOverR0;
  return (
    coefficient *
    (ENSEMBLE_LAM * 1e-6) ** 2 *
    Math.pow(ENSEMBLE_D, -1 / 3) *
    Math.pow(r0, -5 / 3)
  );
}

/**
 * Held, not recomputed: three rungs below read the same 200-screen ensemble and
 * running it three times costs 32 s for numbers that are bit-identical. The
 * cost of saying so is a `()` at every read — `fourth-corner.test.ts`'s helper,
 * and its reason.
 */
const once = <T>(make: () => T): (() => T) => {
  let held: { readonly v: T } | undefined;
  return () => (held ??= { v: make() }).v;
};

describe("the ensemble reproduces Fried's angle of arrival", () => {
  /** Screen twice the aperture, coarse grid — the § 5d default, and the worst. */
  const NARROW = once(() => tiltStats(8, 128, 2, 3, 200, 1));
  /** Four times the aperture, same grid. */
  const WIDER = once(() => tiltStats(8, 128, 4, 6, 200, 1));
  /** Sixteen times the aperture at twice the resolution — the shipping point. */
  const WIDEST = once(() => tiltStats(8, 256, 16, 8, 200, 1));

  it("the centroid wander lands on 0.170·λ²·D^(−1/3)·r₀^(−5/3)", () => {
    const s = WIDEST();
    const ratio = s.gVar / predictedVariance(G_TILT, 8);
    // 0.9597 at this seed; 0.9306 and 0.9783 at two others, so a 200-screen
    // block has ~0.025 of spread and the band below is several σ wide. What it
    // is NOT tight around is 1: the residual 4% is the finite screen, and the
    // trend rung is what shows it closing.
    expect(ratio).toBeGreaterThan(0.85);
    expect(ratio).toBeLessThan(1.05);
  }, 60000);

  it("the same screens read as a least-squares plane give 0.182 instead", () => {
    const s = WIDEST();
    // The ratio is the clean number here: both readings share the draw, so the
    // ensemble noise largely cancels and what is left is the 7% that separates
    // A5's candidate coefficient from the one a ray bundle actually has.
    expect(s.zVar / s.gVar).toBeGreaterThan(1.02);
    expect(s.zVar / s.gVar).toBeLessThan(1.16);
    expect(s.zVar / predictedVariance(Z_TILT, 8)).toBeGreaterThan(0.85);
    expect(s.zVar / predictedVariance(Z_TILT, 8)).toBeLessThan(1.10);
  }, 60000);

  it("the deficit is the finite screen, and closes as the screen grows", () => {
    const narrow = NARROW().gVar / predictedVariance(G_TILT, 8);
    const wider = WIDER().gVar / predictedVariance(G_TILT, 8);
    const widest = WIDEST().gVar / predictedVariance(G_TILT, 8);
    // 0.596 → 0.797 → 0.960. Monotone toward the closed form, never past it:
    // truncating the spectrum can only remove tilt power, never add it.
    expect(narrow).toBeLessThan(wider);
    expect(wider).toBeLessThan(widest);
    expect(narrow).toBeLessThan(0.7);
    expect(widest).toBeLessThan(1.05);
  }, 90000);
});

describe("the per-ray deflection has no grid-independent limit", () => {
  it("its rms grows as (screen samples)^(1/6) while the average does not", () => {
    // ∫f³Φ(f)df over the resolved band diverges as f_max^(1/3), so a 4×
    // refinement should multiply the per-ray rms by 4^(1/6) = 1.2599.
    const coarse = tiltStats(8, 128, 4, 6, 40, 1);
    const fine = tiltStats(8, 512, 4, 6, 40, 1);
    const ratio = fine.rayRms / coarse.rayRms;
    expect(ratio).toBeGreaterThan(1.19);
    expect(ratio).toBeLessThan(1.31);
    // Measured 1.2469 at this seed and 1.2542 at another — the small shortfall
    // against 1.2599 is the finite low-frequency end, which does not scale.
    expect(Math.abs(ratio / Math.pow(4, 1 / 6) - 1)).toBeLessThan(0.06);
    // This is why the blur's fine structure is not pinned anywhere in this
    // file, and why `screenTiltWaves` says so in its own doc.
  }, 60000);
});

// ---------------------------------------------------------------------------
// The pipeline: what actually reaches the image plane.
// ---------------------------------------------------------------------------

const R = -200;
const APERTURE = 10;
const MIRROR_D = 2 * APERTURE;

/** § 5c's paraboloid — stigmatic on axis, so the histogram is a single bin. */
function mirror(imageOffset?: number): OpticalSystem {
  const prescription: Prescription = {
    surfaces: [
      {
        kind: "reflect",
        curvature: 1 / R,
        conic: -1,
        semiAperture: APERTURE,
        thickness: R / 2,
        isStop: true,
      },
    ],
  };
  return {
    prescription,
    aperture: { kind: "stopRadius", value: APERTURE },
    field: { kind: "angle", values: [0] },
    wavelengths: [{ nm: LINE_D, weight: 1 }],
    conjugate: { kind: "infinite" },
    ...(imageOffset === undefined ? {} : { imageSurface: { offsetFromLastVertex: imageOffset } }),
  };
}

/** A screen with a pure tilt of `wavesPerRadius` across the pupil — the ε = 0 case. */
function rampScreen(wavesPerRadius: number, wavelengthNm: number, N = 64, oversize = 2): PhaseScreen {
  const physicalSizeMm = oversize * MIRROR_D;
  const slope = (wavesPerRadius * wavelengthNm * 1e-6) / (MIRROR_D / 2);
  const opdMm = new Float64Array(N * N);
  for (let iy = 0; iy < N; iy++) {
    for (let ix = 0; ix < N; ix++) {
      opdMm[iy * N + ix] = slope * ((ix - N / 2) * (physicalSizeMm / N));
    }
  }
  return {
    samples: N,
    physicalSizeMm,
    apertureDiameterMm: MIRROR_D,
    opdMm,
    friedParamMm: 1,
    refWavelengthNm: 500,
  };
}

/** A screen that is there and does nothing — the no-op control. */
function flatScreen(N = 64, oversize = 2): PhaseScreen {
  return {
    samples: N,
    physicalSizeMm: oversize * MIRROR_D,
    apertureDiameterMm: MIRROR_D,
    opdMm: new Float64Array(N * N),
    friedParamMm: 1,
    refWavelengthNm: 500,
  };
}

function centroidX(p: Psf): number {
  let sx = 0;
  let s = 0;
  for (let y = 0; y < p.size; y++) {
    for (let x = 0; x < p.size; x++) {
      const v = p.intensity[y * p.size + x]!;
      sx += v * x;
      s += v;
    }
  }
  return sx / s - p.size / 2;
}

const PSF_OPTS = { pupilSamples: 32, padFactor: 4 } as const;

describe("the deflection reaches the image plane at the right scale", () => {
  it("the mm deflection and the mm pixel are one ruler apart: 2·padFactor", () => {
    // Both readers take the pupil's geometry and λ; their quotient must be the
    // pure number `defaultRayGrid` sizes the ray bundle with, with λ, R, r_exit
    // and n′ all cancelling. Asserted rather than assumed, because § 6aj.6's
    // repair in this same function was exactly a second copy of a ruler.
    for (const [referenceRadius, exitRadius, nImage, wavelengthNm] of [
      [1000, 50, 1, 550],
      [98.7, 10, -1, LINE_D],
      [250, 3.25, 1.515, 486.1],
    ] as const) {
      for (const [pupilSamples, padFactor] of [
        [32, 4],
        [64, 4],
        [64, 8],
      ] as const) {
        const scale: PupilScale = {
          referenceRadius,
          exitRadius,
          wavelengthNm,
          nImage,
          slopeRadius: undefined,
        };
        const perPixel =
          rayDeflectionScaleMm(referenceRadius, exitRadius, nImage, wavelengthNm) /
          imagePixelScaleMm(scale, pupilSamples * padFactor, pupilSamples);
        expect(perPixel).toBeCloseTo(2 * padFactor, 9);
      }
    }
  });

  it("a pure tilt lands both branches on 2·padFactor·a pixels", () => {
    const sys = mirror();
    for (const [a, fft] of [
      [1, 7.957599],
      [2.5, 19.871237],
    ] as const) {
      const screen = rampScreen(a, LINE_D);
      const wave = psf(sys, 0, LINE_D, { ...PSF_OPTS, seeing: screen });
      const geo = geometricPsf(sys, 0, LINE_D, { ...PSF_OPTS, seeing: screen });
      const predicted = 2 * PSF_OPTS.padFactor * a;
      // On a stigmatic mirror every ray carries the same deflection into the
      // same bin, so the histogram's centroid is the identity itself, exact.
      expect(centroidX(geo)).toBeCloseTo(predicted, 9);
      // The FFT branch agrees to well under a pixel; the residual is the
      // discrete pupil's edge, not the screen.
      expect(centroidX(wave)).toBeCloseTo(fft, 4);
      expect(Math.abs(centroidX(wave) / predicted - 1)).toBeLessThan(0.01);
    }
  });

  it("real screens: the histogram centroid IS 2·padFactor·⟨∂φ/∂px⟩", () => {
    // The link that makes the ensemble rungs above statements about the image
    // rather than about a reader: 24 Kolmogorov screens through the whole of
    // `geometricPsf`, each checked against its own pupil-mean gradient.
    const sys = mirror();
    for (const [dOverR0, worstBand] of [
      [2, 0.3],
      [4, 0.4],
    ] as const) {
      let worst = 0;
      let sxy = 0;
      let sxx = 0;
      for (let s = 0; s < 24; s++) {
        const screen = kolmogorovScreen({
          friedParamMm: MIRROR_D / dOverR0,
          apertureDiameterMm: MIRROR_D,
          screenSamples: 256,
          oversize: 4,
          subharmonics: 6,
          seed: 100 + s,
        });
        const got = centroidX(geometricPsf(sys, 0, LINE_D, { ...PSF_OPTS, seeing: screen }));
        const tilt = screenTiltWaves(screen, LINE_D);
        let mx = 0;
        for (const p of PUPIL_POINTS) mx += tilt(p.px, p.py).dx;
        const predicted = 2 * PSF_OPTS.padFactor * (mx / PUPIL_POINTS.length);
        worst = Math.max(worst, Math.abs(got - predicted));
        sxy += got * predicted;
        sxx += predicted * predicted;
      }
      // Worst case 0.11 px at D/r₀ = 2 and 0.19 px at 4 — a bin is 1 px, and
      // the shifts being tracked run to tens of them.
      expect(worst).toBeLessThan(worstBand);
      // Regression slope through the origin: 0.9998 and 0.9990.
      expect(sxy / sxx).toBeCloseTo(1, 2);
    }
  }, 60000);

  it("a flat screen is bitwise nothing", () => {
    const sys = mirror();
    const bare = geometricPsf(sys, 0, LINE_D, PSF_OPTS);
    const flat = geometricPsf(sys, 0, LINE_D, { ...PSF_OPTS, seeing: flatScreen() });
    // Including the ray count: a zero-gradient screen must not widen the grid.
    expect(flat.rayGrid).toBe(bare.rayGrid);
    for (let i = 0; i < bare.intensity.length; i++) {
      expect(flat.intensity[i]).toBe(bare.intensity[i]!);
    }
  });

  it("an exit pupil at infinity is refused, not answered with zero", () => {
    expect(() => rayDeflectionScaleMm(1000, Number.POSITIVE_INFINITY, 1, 550)).toThrow(
      /exit pupil at infinity/,
    );
    // The finite branch is the plain transverse ray aberration λ·R/(n′·r).
    expect(rayDeflectionScaleMm(1000, 50, 1, 550)).toBeCloseTo((550e-6 * 1000) / 50, 15);
    // The sign is POSITIVE — extra optical path tilts a ray toward the longer
    // side, the way a prism deviates toward its base — and |n′| is used because
    // the deflection's direction is set by the gradient, not by which side of a
    // mirror the light is travelling on.
    expect(rayDeflectionScaleMm(1000, 50, -1, 550)).toBeGreaterThan(0);
    expect(rayDeflectionScaleMm(1000, 50, -1, 550)).toBe(rayDeflectionScaleMm(1000, 50, 1, 550));
  });
});

describe("the fallback carries the atmosphere — § 5d's deferral, closed", () => {
  /** 2 mm inside focus: phase step 1.97 waves/sample, far past the blend band. */
  const DEFOCUSED = mirror(R / 2 - 2);

  /** Σ|seen − clean| over the frame, as a fraction of the total energy. */
  function imageChange(dOverR0: number | null, screens: number): number {
    const clean = adaptivePsf(DEFOCUSED, 0, LINE_D, PSF_OPTS);
    expect(clean.geometricWeight).toBe(1);
    let total = 0;
    for (let s = 0; s < screens; s++) {
      const seeing =
        dOverR0 === null
          ? flatScreen()
          : kolmogorovScreen({
              friedParamMm: MIRROR_D / dOverR0,
              apertureDiameterMm: MIRROR_D,
              screenSamples: 256,
              oversize: 4,
              subharmonics: 6,
              seed: 500 + s,
            });
      const seen = adaptivePsf(DEFOCUSED, 0, LINE_D, { ...PSF_OPTS, seeing });
      // The screen must not move the switch: the criterion is measured on the
      // raw traced samples and stays screen-blind by design (§ 5d).
      expect(seen.geometricWeight).toBe(1);
      expect(seen.phaseStepWaves).toBe(clean.phaseStepWaves);
      let d = 0;
      for (let i = 0; i < seen.intensity.length; i++) {
        d += Math.abs(seen.intensity[i]! - clean.intensity[i]!);
      }
      total += d / clean.energy;
    }
    return total / screens;
  }

  it("at weight 1 the sky is in the image, and more of it in worse seeing", () => {
    // Before this change these two calls returned byte-identical arrays: the
    // FFT branch was switched off and it was the only branch that had ever
    // heard of a screen. The measure runs 0 to 2, and lands at two thirds of
    // the way up — this is not a perturbation, it is a different image.
    const mild = imageChange(4, 8);
    const rough = imageChange(8, 8);
    expect(mild).toBeGreaterThan(0.8);
    expect(rough).toBeGreaterThan(mild);
    // 1.336 and 1.408 as measured; the band is set by the ensemble's own
    // spread at eight screens, not by the numbers being uncertain in principle.
    expect(mild).toBeCloseTo(1.34, 1);
    expect(rough).toBeCloseTo(1.41, 1);
  }, 60000);

  it("and a flat screen at weight 1 still changes nothing at all", () => {
    expect(imageChange(null, 1)).toBe(0);
  }, 30000);
});
