import { describe, it, expect } from "vitest";
import { adaptiveIntegral } from "../src/math/quadrature";
import { pupilGrid } from "../src/pupil/aiming";
import {
  kolmogorovScreen,
  screenTiltWaves,
  KOLMOGOROV_PSD_COEFF,
  TATARSKI_INNER_SCALE_FACTOR,
  innerScaleCutoff,
} from "../src/wave/seeing";

/**
 * § 5d.3 — the inner scale, and the blur that finally has a limit.
 *
 * § 5d.2 built the ray branch's atmosphere and then said plainly what it could
 * not pin: "the blur's fine structure is set by the screen's grid and has no
 * grid-independent limit". A single ray's deflection variance is ∫f³Φ(f)df, and
 * Kolmogorov's Φ ∝ f^(−11/3) makes that diverge as f_max^(1/3) — refine the
 * screen and every ray bends more, forever, measured there as 1.25× for a 4×
 * refinement against a predicted 4^(1/6). Only the aperture-AVERAGED tilt, which
 * is what Fried's angle of arrival is about, converged.
 *
 * The divergence is not physics, it is the model missing a bottom. Real air has
 * one: below the **inner scale** l₀ — millimetres, where viscosity wins over
 * inertia — the cascade stops. Tatarski's spectrum puts it in as a Gaussian
 * roll-off, Φ ∝ f^(−11/3)·exp(−f²/f_m²) with f_m = 5.92/(2π·l₀), and the moment
 * then converges to a closed form:
 *
 *     ∫₀^∞ f³ · c·f^(−11/3) · e^(−f²/f_m²) df = c · f_m^(1/3) · Γ(1/6) / 2
 *
 * ## Γ(1/6) is computed here, not quoted
 *
 * The hard rule's whole point is that a transcribed constant is checked against
 * nothing. Under t = u⁶ the gamma integral becomes smooth — Γ(1/6) = ∫₀^∞ 6·
 * e^(−u⁶) du and Γ(5/6) = ∫₀^∞ 6u⁴·e^(−u⁶) du, with the u^(−5/6) corner gone —
 * so both fall out of the ladder's own `adaptiveIntegral`, and the pin on the
 * pair is Euler's reflection formula, Γ(1/6)Γ(5/6) = π/sin(π/6) = 2π. Two
 * independent quadratures against a closed form that came from a relation.
 *
 * ## What a finite screen can and cannot show
 *
 * A screen carries a band. Its FFT grid starts at 1/L and stops at Nyquist, and
 * three subharmonic levels reach down to 1/(27L) with nine modes apiece rather
 * than a full spectral density. For THIS moment the sub-grid band is not a
 * detail — ∫₀^(1/L) f^(−2/3)df is about 40% of the whole integral — so the
 * measurement cannot be expected to sit on the closed form, and the subharmonic
 * patch means it need not sit monotonically below it either.
 *
 * What is exactly computable is a **bracket**: the closed form over the whole
 * spectrum above, and the same closed form with the sub-grid band removed below.
 * Both come from the same Γ(1/6) and neither has a free parameter. The
 * measurement lands inside it on three screen geometries (§ 5d.3.3), and the
 * same bracket predicts the l₀ SCALING (§ 5d.3.4) — where the infinite-band
 * answer is a clean 2^(1/6) and the measured ratio must exceed it, because the
 * missing low band is common to both terms and inflates a ratio.
 *
 * The rung that matters most needs none of that arithmetic (§ 5d.3.2): over the
 * same 4× refinement, the Kolmogorov screen's per-ray rms grows by 1.26 and the
 * Tatarski screen's by 0.99. That is item 14 closed.
 */

/* ------------------------------------------------------------------ */
/* Γ(1/6), and the reflection formula that pins it                     */
/* ------------------------------------------------------------------ */

/**
 * Γ(z) = ∫₀^∞ t^(z−1) e^(−t) dt under t = u⁶: dt = 6u⁵du and t^(z−1) = u^(6z−6),
 * so the integrand is 6·u^(6z−1)·e^(−u⁶) — polynomial times a Gaussian-like
 * tail, with the origin's corner removed. Cut at u = 12, where e^(−u⁶) is below
 * every double there is.
 */
function gammaBySubstitution(z: number): number {
  return adaptiveIntegral((u) => 6 * Math.pow(u, 6 * z - 1) * Math.exp(-Math.pow(u, 6)), 0, 12, {
    tolerance: 1e-14,
  });
}

const GAMMA_1_6 = gammaBySubstitution(1 / 6);
const GAMMA_5_6 = gammaBySubstitution(5 / 6);

/* ------------------------------------------------------------------ */
/* The moment, and the band a screen actually carries                  */
/* ------------------------------------------------------------------ */

/**
 * ∫₀^F f^(−2/3) e^(−f²/f_m²) df, by the same u³ substitution that smooths it:
 * f = u³ gives 3·e^(−u⁶/f_m²) du, with no corner at the origin at all.
 */
function dampedMoment(fm: number, fUpper: number): number {
  const uUpper = Math.cbrt(fUpper);
  return adaptiveIntegral((u) => 3 * Math.exp(-Math.pow(u, 6) / (fm * fm)), 0, uUpper, {
    tolerance: 1e-13,
  });
}

/** The whole spectrum: `f_m^(1/3)·Γ(1/6)/2`. */
const fullMoment = (fm: number): number => (Math.cbrt(fm) * GAMMA_1_6) / 2;

/* ------------------------------------------------------------------ */
/* The screens                                                          */
/* ------------------------------------------------------------------ */

/**
 * A 50 mm aperture, not a telescope's 200. A screen can only impose an inner
 * scale its grid resolves, and l₀/D is what sets the frequency: at D = 50 mm a
 * physical l₀ of 5 mm sits at f_m = 9.42 cycles per aperture, which a 256-sample
 * screen clears by a factor of 13. The same 5 mm on a 200 mm aperture would need
 * 1024 samples for the same margin, which is what § 5d.3.5's refusal says out
 * loud rather than quietly delivering a screen with no inner scale in it.
 */
const D = 50;
const L0 = 5;
const LAM = 500;
const OVERSIZE = 2;
const D_OVER_R0 = 8;
const SUBHARMONICS = 3;
const POINTS = pupilGrid(41);

function screenAt(N: number, oversize: number, seed: number, innerScaleMm?: number) {
  return kolmogorovScreen({
    friedParamMm: D / D_OVER_R0,
    apertureDiameterMm: D,
    screenSamples: N,
    oversize,
    subharmonics: SUBHARMONICS,
    seed,
    ...(innerScaleMm === undefined ? {} : { innerScaleMm }),
  });
}

/** RMS of a SINGLE ray's deflection, waves per pupil radius, over an ensemble. */
function rayRms(N: number, oversize: number, screens: number, innerScaleMm?: number): number {
  let sum = 0;
  for (let s = 0; s < screens; s++) {
    const tilt = screenTiltWaves(screenAt(N, oversize, 1 + s, innerScaleMm), LAM);
    let r2 = 0;
    for (const p of POINTS) {
      const g = tilt(p.px, p.py);
      r2 += g.dx * g.dx + g.dy * g.dy;
    }
    sum += r2 / POINTS.length;
  }
  return Math.sqrt(sum / screens);
}

/** The aperture-AVERAGED tilt — the statistic § 5d.2 pinned to Fried. */
function gTiltRms(N: number, screens: number, innerScaleMm?: number): number {
  let sum = 0;
  for (let s = 0; s < screens; s++) {
    const tilt = screenTiltWaves(screenAt(N, OVERSIZE, 1 + s, innerScaleMm), LAM);
    let mx = 0;
    let my = 0;
    for (const p of POINTS) {
      const g = tilt(p.px, p.py);
      mx += g.dx;
      my += g.dy;
    }
    mx /= POINTS.length;
    my /= POINTS.length;
    sum += mx * mx + my * my;
  }
  return Math.sqrt(sum / screens);
}

/**
 * The closed form for the per-ray rms, in waves per pupil radius.
 *
 * `<(∂φ/∂x_D)²> = ∫(2πf_x)²Φ d²f = 4π³·∫f³Φ df` in radians² over D units, and
 * `screenTiltWaves` reports `(λ_ref/λ)·(1/4π)·∂φ/∂x_D`; the reported rms is
 * two-dimensional, so it carries a further √2. λ_ref = λ here.
 */
function closedFormRayRms(momentValue: number): number {
  const c = KOLMOGOROV_PSD_COEFF * Math.pow(1 / D_OVER_R0, -5 / 3);
  const perAxisRad2 = 4 * Math.PI ** 3 * c * momentValue;
  return Math.sqrt(2 * perAxisRad2) / (4 * Math.PI);
}

describe("§ 5d.3.0 — Γ(1/6) by quadrature, pinned by Euler's reflection formula", () => {
  it("Γ(1/6)·Γ(5/6) = π/sin(π/6) = 2π", () => {
    // Neither value is written down anywhere in this repo. The product is fixed
    // by the reflection formula, so two independent quadratures check each other
    // against a closed form that came from a relation and not from recall.
    const reflection = Math.PI / Math.sin(Math.PI / 6);
    expect(Math.abs(reflection / (2 * Math.PI) - 1)).toBeLessThan(1e-15);
    expect(Math.abs((GAMMA_1_6 * GAMMA_5_6) / reflection - 1)).toBeLessThan(1e-13);
    // Γ(1/6) ≈ 5.5663, Γ(5/6) ≈ 1.1288 — recorded, not asserted against.
    expect(GAMMA_1_6).toBeGreaterThan(5);
    expect(GAMMA_5_6).toBeGreaterThan(1);
  });

  it("and the damped moment's closed form is what the quadrature gives", () => {
    // ∫₀^∞ f³·c·f^(−11/3)·e^(−f²/f_m²) df = c·f_m^(1/3)·Γ(1/6)/2, the whole
    // reason an inner scale makes the blur finite. Checked at three cutoffs, so
    // the f_m^(1/3) is exercised and not just the constant.
    for (const fm of [1, 9.421972859, 100]) {
      const quad = dampedMoment(fm, 40 * fm);
      expect(Math.abs(quad / fullMoment(fm) - 1)).toBeLessThan(1e-11);
    }
  });
});

describe("§ 5d.3.1 — an absent inner scale changes nothing", () => {
  it("omitted, undefined and 0 are the same screen, bit for bit", () => {
    const base = screenAt(128, OVERSIZE, 7);
    const zero = screenAt(128, OVERSIZE, 7, 0);
    expect(base.innerScaleMm).toBeUndefined();
    expect(zero.innerScaleMm).toBeUndefined();
    for (let i = 0; i < base.opdMm.length; i++) {
      expect(zero.opdMm[i]).toBe(base.opdMm[i]);
    }
    // And a screen that HAS one is a different screen, or nothing was applied.
    const damped = screenAt(128, OVERSIZE, 7, L0);
    expect(damped.innerScaleMm).toBe(L0);
    let differs = 0;
    for (let i = 0; i < base.opdMm.length; i++) if (damped.opdMm[i] !== base.opdMm[i]) differs++;
    expect(differs).toBeGreaterThan(0.99 * base.opdMm.length);
  });
});

describe("§ 5d.3.2 — the divergence, and its absence", () => {
  it("a 4× refinement multiplies the Kolmogorov blur by 4^(1/6) and the Tatarski blur by 1", () => {
    // Both legs start at N = 256, where f_max/f_m is 13.6 — the damping is over
    // and done well inside the grid, which is the precondition for reading the
    // ratio as physics rather than as a truncation artefact.
    const kCoarse = rayRms(256, OVERSIZE, 12);
    const kFine = rayRms(1024, OVERSIZE, 12);
    const tCoarse = rayRms(256, OVERSIZE, 12, L0);
    const tFine = rayRms(1024, OVERSIZE, 12, L0);

    // ∫f³Φdf diverges as f_max^(1/3): measured 1.2628 against 4^(1/6) = 1.2599.
    const kRatio = kFine / kCoarse;
    expect(Math.abs(kRatio / Math.pow(4, 1 / 6) - 1)).toBeLessThan(0.05);

    // With a bottom on the spectrum there is nothing left to gain: measured
    // 0.9855, and the whole of item 14 is that this number is 1 and not 1.26.
    const tRatio = tFine / tCoarse;
    expect(tRatio).toBeGreaterThan(0.95);
    expect(tRatio).toBeLessThan(1.05);
    // Stated as the separation, which is what the step is: the two legs are the
    // same screens, the same ensemble and the same reader, differing only in
    // whether the spectrum has a bottom.
    expect(kRatio / tRatio).toBeGreaterThan(1.2);
  }, 300000);
});

describe("§ 5d.3.3 — the converged blur, bracketed by its own closed form", () => {
  it("sits between the whole spectrum and the spectrum the grid actually carries", () => {
    const fm = innerScaleCutoff(L0 / D);
    for (const [N, oversize] of [
      [256, 2],
      [512, 4],
      [1024, 8],
    ] as const) {
      // Above: the whole spectrum. Below: the same, less the band under the FFT
      // grid's fundamental 1/L, which the nine-mode subharmonic patches only
      // partly restore. No fitted quantity in either.
      const upper = closedFormRayRms(fullMoment(fm));
      const lower = closedFormRayRms(fullMoment(fm) - dampedMoment(fm, 1 / oversize));
      const measured = rayRms(N, oversize, 8, L0);
      expect(lower).toBeLessThan(upper);
      expect(measured).toBeGreaterThan(lower);
      expect(measured).toBeLessThan(upper * 1.02);
      // Measured 0.89 to 0.98 of the whole-spectrum value against a floor of
      // 0.77 — the subharmonics restore most of the sub-grid band but not all,
      // and not monotonically in the screen size, which is why this is a
      // bracket and not a trend.
      expect(measured / upper).toBeGreaterThan(0.85);
    }
  }, 600000);
});

describe("§ 5d.3.4 — halving the inner scale, which the bracket also predicts", () => {
  it("the rms grows by more than 2^(1/6), and by less than the sub-grid floor allows", () => {
    const fmWide = innerScaleCutoff(L0 / D);
    const fmTight = innerScaleCutoff(L0 / 2 / D);
    // Over the whole spectrum the ratio is exactly (f_m ratio)^(1/6) = 2^(1/6),
    // constant-free — Γ(1/6) and c cancel.
    const whole = Math.sqrt(fullMoment(fmTight) / fullMoment(fmWide));
    expect(Math.abs(whole / Math.pow(2, 1 / 6) - 1)).toBeLessThan(1e-12);
    // The measured ratio must EXCEED it: the sub-grid band the screen misses is
    // very nearly the same absolute amount for both cutoffs, and subtracting a
    // common amount from both terms of a ratio > 1 raises it.
    const fLo = 1 / OVERSIZE;
    const floorRatio = Math.sqrt(
      (fullMoment(fmTight) - dampedMoment(fmTight, fLo)) / (fullMoment(fmWide) - dampedMoment(fmWide, fLo)),
    );
    expect(floorRatio).toBeGreaterThan(whole);

    for (const N of [512, 1024]) {
      const wide = rayRms(N, OVERSIZE, 10, L0);
      const tight = rayRms(N, OVERSIZE, 10, L0 / 2);
      const ratio = tight / wide;
      // Measured 1.1452 and 1.1423, between 1.1225 and 1.1988.
      expect(ratio).toBeGreaterThan(whole);
      expect(ratio).toBeLessThan(floorRatio);
    }
  }, 600000);
});

describe("§ 5d.3.5 — the aperture average, and the refusals", () => {
  it("Fried's statistic does not notice the inner scale", () => {
    // The G-tilt lives at frequencies of order 1/D and the cutoff is at 9.4/D,
    // so damping the top of the spectrum must leave it alone. If this moved, the
    // roll-off would be eating the low frequencies and the implementation would
    // be wrong. The band is the ensemble's own spread at this screen count, not
    // a claim of exact equality.
    for (const N of [256, 512]) {
      const without = gTiltRms(N, 24);
      const with_ = gTiltRms(N, 24, L0);
      expect(Math.abs(with_ / without - 1)).toBeLessThan(0.05);
    }
  }, 300000);

  it("a grid too coarse for the inner scale is refused, with the grid that works", () => {
    // 200 mm aperture, 5 mm inner scale: f_m = 37.688 cycles per aperture, and a
    // 128-sample screen at oversize 2 has a Nyquist of 32. Delivering that screen
    // would hand back pure Kolmogorov under an inner-scale name. This is the
    // ordinary case, not a corner: a millimetre inner scale on a real aperture
    // needs a big grid, and the message is where a caller finds out how big.
    expect(() =>
      kolmogorovScreen({
        friedParamMm: 25,
        apertureDiameterMm: 200,
        screenSamples: 128,
        oversize: 2,
        innerScaleMm: 5,
      }),
    ).toThrow(/would not carry one.*screenSamples ≥ 512/s);
    // And the grid it names is enough — the refusal is actionable, which is the
    // only thing that makes it better than silently doing the wrong thing.
    expect(() =>
      kolmogorovScreen({
        friedParamMm: 25,
        apertureDiameterMm: 200,
        screenSamples: 512,
        oversize: 2,
        innerScaleMm: 5,
      }),
    ).not.toThrow();
  });

  it("a negative inner scale is a caller error, not a silent zero", () => {
    expect(() =>
      kolmogorovScreen({ friedParamMm: 6.25, apertureDiameterMm: 50, innerScaleMm: -1 }),
    ).toThrow(/innerScaleMm must be ≥ 0/);
  });

  it("the cutoff constant is the one the generator uses", () => {
    // Same discipline as KOLMOGOROV_PSD_COEFF: the closed forms above are
    // evaluated at the constant the screens were built with, not at a rounded
    // one, so the constant is exported and asserted rather than absorbed.
    expect(TATARSKI_INNER_SCALE_FACTOR).toBe(5.92);
    expect(innerScaleCutoff(0.1)).toBeCloseTo(5.92 / (2 * Math.PI * 0.1), 12);
  });
});
