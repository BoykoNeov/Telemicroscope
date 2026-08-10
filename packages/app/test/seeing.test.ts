import { describe, it, expect } from "vitest";
import {
  PHASE_STEP_LIMIT_WAVES,
  renderSeeing,
  type SeeingRequest,
  type SeeingResult,
} from "../src/seeing";

/**
 * C6 — the long-exposure surface, as invariants rather than as prose.
 *
 * The engine step it needed landed as § 5d.1 and is pinned in
 * `core/test/seeing.test.ts`; nothing here re-pins Fried or Kolmogorov. What is
 * pinned is the wiring plus the four claims the panel makes that no rung states.
 *
 * 1. **0.98·λ/r₀ is an answer only where the telescope is seeing-limited.** The
 *    headline number says nothing about aperture, which is fine until the Airy
 *    disc is the wider of the two. They cross at D = (1.029/0.98)·r₀ — two
 *    FWHMs — with **λ cancelling**, and below it the measured disc exceeds
 *    *both* single-cause widths, because two comparable widths convolve.
 *    A first draft said "it settles onto the diffraction limit instead", and it
 *    passed only because the panel's `diffractionFwhm` was then the Rayleigh
 *    first-zero RADIUS, 1.22·λ/D — 19% too wide, and it happened to land on the
 *    measurement. Correcting the unit moved the crossover 249 → 210 mm and
 *    turned that claim into the honest one.
 * 2. **The instrument's own quality is in the seeing disc.** A paraboloid lands
 *    within a couple of percent of Fried on the same sky where a 200 mm f/8
 *    achromat measures ~9% wide. The mirror is the control that separates the
 *    atmosphere from the optic.
 * 3. **Where the transfer function leaves Fried belongs to the ensemble, not to
 *    the sky.** A mean over N screens has a residual noise floor that does not
 *    fall with frequency; the departure point moves OUTWARD as N grows.
 * 4. **The under-resolution guard is about the grid.** It is reachable inside
 *    this panel's own ranges at the coarse pupil setting and clears at the fine
 *    one, on a byte-identical atmosphere.
 */

const BASE: SeeingRequest = {
  optic: "achromat",
  apertureMm: 200,
  focalRatio: 8,
  friedParamMm: 50,
  screens: 1,
  pupilSamples: 32,
  seed: 10000,
  whiteOverMeanPeak: 1.15,
};

/** Ensembles are seconds each, and several rungs want the same one. */
const cache = new Map<string, SeeingResult>();
const run = (overrides: Partial<SeeingRequest> = {}): SeeingResult => {
  const request = { ...BASE, ...overrides };
  const key = JSON.stringify(request);
  const hit = cache.get(key);
  if (hit) return hit;
  const made = renderSeeing(request);
  if (!("size" in made)) throw new Error(`expected a long exposure, got: ${made.error}`);
  cache.set(key, made);
  return made;
};

describe("C6.1 — the wiring, and the three frames", () => {
  it("one screen makes the draw and the mean the same frame, and more screens do not", () => {
    const one = run({ screens: 1 });
    expect(one.drawFwhmPx).toBe(one.meanFwhmPx);
    expect(one.drawPeakRatio).toBe(one.meanPeakRatio);

    const many = run({ screens: 30 });
    // Same seed, so the DRAW is the same frame in both — the ensemble's screen 0.
    expect(many.drawFwhmPx).toBe(one.drawFwhmPx);
    // ...and the mean is a different object, several times fainter at the peak.
    expect(many.meanPeakRatio).toBeLessThan(0.5 * many.drawPeakRatio);
    expect(many.meanFwhmPx).toBeGreaterThan(2 * many.drawFwhmPx * 0.5);
  });

  it("the atmosphere-free frame does not know the atmosphere exists", () => {
    // Same instrument, same pupil, every screen count and every r₀ — so its
    // FWHM and Strehl are bitwise the same numbers, which is what makes it the
    // denominator of every ratio on the panel.
    const a = run({ screens: 1 });
    const b = run({ screens: 30 });
    const c = run({ screens: 30, friedParamMm: 100 });
    expect(b.cleanFwhmPx).toBe(a.cleanFwhmPx);
    expect(c.cleanFwhmPx).toBe(a.cleanFwhmPx);
    expect(c.cleanStrehl).toBe(a.cleanStrehl);
  });
});

describe("C6.2 — 0.98·λ/r₀ is an answer only where the telescope is seeing-limited", () => {
  it("the crossover is (1.029/0.98)·r₀ — two FWHMs — and λ is not in it", () => {
    for (const friedParamMm of [25, 50, 100]) {
      const r = run({ friedParamMm, screens: 1 });
      // 1.02899 is the Airy pattern's FWHM in λ/D, not the 1.22 first-zero
      // radius this panel used at first — see `AIRY_FWHM_FACTOR`.
      expect(r.seeingLimitedAboveMm).toBeCloseTo((1.02899 / 0.98) * friedParamMm, 12);
      // The two discs really are equal at that aperture — asserted by putting
      // the telescope there and reading the panel's own two closed forms, not
      // by re-deriving the algebra a second time in the test.
      const at = run({ friedParamMm, apertureMm: r.seeingLimitedAboveMm, screens: 1 });
      expect(at.diffractionFwhmArcsec).toBeCloseTo(at.friedFwhmArcsec, 12);
      // λ is not in the crossover: the aperture depends on r₀ alone, so it is
      // unchanged by anything about colour — and the two angles that meet there
      // both scale as λ, which is exactly why it cancels.
      expect(at.seeingLimitedAboveMm).toBe(r.seeingLimitedAboveMm);
      expect(at.diffractionFwhmArcsec / at.friedFwhmArcsec).toBeCloseTo(1, 12);
    }
  });

  it("past it the measurement follows Fried; short of it, it exceeds BOTH", () => {
    // A 200 mm scope under r₀ = 25 mm is eight Fried cells across — deep in the
    // seeing-limited regime — and under r₀ = 200 mm it is one, short of the
    // ~210 mm crossover.
    const seeing = run({ optic: "newtonian", friedParamMm: 25, screens: 30 });
    const both = run({ optic: "newtonian", friedParamMm: 200, screens: 30 });
    expect(seeing.seeingLimited).toBe(true);
    expect(both.seeingLimited).toBe(false);

    // Seeing-limited: the measured disc is Fried's, within the finite-screen band.
    expect(seeing.meanFwhmArcsec / seeing.friedFwhmArcsec).toBeGreaterThan(0.9);
    expect(seeing.meanFwhmArcsec / seeing.friedFwhmArcsec).toBeLessThan(1.1);

    // Short of it, the honest statement is NOT "it follows diffraction instead"
    // — a first draft asserted that and passed only because `diffractionFwhm`
    // was then the Rayleigh RADIUS, 19% too big, which happened to land on the
    // measurement. With a real Airy FWHM the disc comes out wider than *either*
    // single-cause width, which is what a convolution of two comparable widths
    // does: neither formula describes it, from either side.
    expect(both.meanFwhmArcsec).toBeGreaterThan(1.15 * both.friedFwhmArcsec);
    expect(both.meanFwhmArcsec).toBeGreaterThan(1.15 * both.cleanFwhmArcsec);
    // ...and it is not wider than their sum, so it is a combination and not a
    // third effect that appeared.
    expect(both.meanFwhmArcsec).toBeLessThan(both.friedFwhmArcsec + both.cleanFwhmArcsec);
  });

  it("the measured clean FWHM is the estimator's, and it reads narrow of the closed form", () => {
    // Stated so no sentence anywhere leans on it as a precise number: λ/D spans
    // `padFactor` = 4 pixels whatever `pupilSamples` is, and `fwhmPixels` bins by
    // whole pixels, so a 4-pixel feature is measured with 1-pixel bins at either
    // grid setting. It comes back a few percent under the Airy FWHM, and that is
    // the ruler rather than the optics.
    const r = run({ optic: "newtonian", screens: 1 });
    const ratio = r.cleanFwhmArcsec / r.diffractionFwhmArcsec;
    expect(ratio).toBeGreaterThan(0.8);
    expect(ratio).toBeLessThan(1.0);
    // Same feature, same bins, at twice the pupil sampling — so it does not move.
    const fine = run({ optic: "newtonian", screens: 1, pupilSamples: 64 });
    expect(fine.cleanFwhmArcsec / fine.diffractionFwhmArcsec).toBeCloseTo(ratio, 1);
  });
});

describe("C6.3 — the instrument's own quality is in the seeing disc", () => {
  it("a paraboloid lands on Fried where an achromat of the same aperture reads wide", () => {
    const mirror = run({ optic: "newtonian", screens: 30 });
    const lens = run({ optic: "achromat", screens: 30 });
    // The control really is perfect on axis and the lens really is not — § 4b
    // and § 5j, and without this the comparison below measures nothing.
    expect(mirror.cleanStrehl).toBeGreaterThan(0.999);
    expect(lens.cleanStrehl).toBeLessThan(0.9);

    const mirrorMiss = Math.abs(mirror.meanFwhmArcsec / mirror.friedFwhmArcsec - 1);
    const lensMiss = Math.abs(lens.meanFwhmArcsec / lens.friedFwhmArcsec - 1);
    expect(mirrorMiss).toBeLessThan(0.05);
    expect(lensMiss).toBeGreaterThan(2 * mirrorMiss);
    // ...and the lens reads WIDE, not narrow: its own aberration adds to the
    // atmosphere rather than cancelling any of it.
    expect(lens.meanFwhmArcsec).toBeGreaterThan(mirror.meanFwhmArcsec);
  });
});

describe("C6.4 — the departure point belongs to the ensemble", () => {
  it("more screens push the noise floor outward, on the same sky", () => {
    const few = run({ optic: "newtonian", screens: 10 });
    const many = run({ optic: "newtonian", screens: 120 });
    expect(few.transferDepartsAtNu).not.toBeNull();
    expect(many.transferDepartsAtNu).not.toBeNull();
    // The atmosphere is byte-identical between them — same seed, and the second
    // ensemble's first ten screens ARE the first ensemble. Only N differs.
    expect(few.dOverR0).toBe(many.dOverR0);
    expect(many.transferDepartsAtNu!).toBeGreaterThan(few.transferDepartsAtNu!);
    // ...and it is not only the floor that improves: below it, the agreement
    // with Fried tightens with N as well. Asserted as a comparison rather than
    // as two magic bands, because the claim is that averaging converges — a
    // 10-screen mean reaches 1.23× of Fried inside the low band where the
    // 120-screen one stays inside a few percent.
    const worstBelow = (r: SeeingResult) =>
      Math.max(...r.transfer.filter((p) => p.nu < 0.15).map((p) => Math.abs(p.measured / p.fried - 1)));
    expect(worstBelow(many)).toBeLessThan(worstBelow(few));
    expect(worstBelow(many)).toBeLessThan(0.15);
  });

  it("r₀_eff is flat below the floor, which is what makes the tolerance an r₀ shift", () => {
    const r = run({ optic: "newtonian", screens: 120 });
    const flat = r.transfer.filter(
      (p) => p.nu >= 0.04 && p.nu <= 0.16 && p.effectiveFriedRatio !== null,
    );
    expect(flat.length).toBeGreaterThan(2);
    const values = flat.map((p) => p.effectiveFriedRatio!);
    for (const v of values) {
      expect(v).toBeGreaterThan(0.9);
      expect(v).toBeLessThan(1.15);
    }
    expect(Math.max(...values) / Math.min(...values)).toBeLessThan(1.15);
  });
});

describe("C6.5 — the under-resolution guard is about the grid, and it is reachable", () => {
  it("the coarse pupil trips it inside the panel's own sliders, and the fine one clears it", () => {
    // The reachability check C4's lesson demands, and here it has a second half:
    // the guard is not a statement about the sky at all. The grid step across
    // the pupil is 2/pupilSamples, so doubling the samples halves the wavefront
    // step on a BYTE-IDENTICAL atmosphere — same r₀, same seed, same screens.
    const coarse = run({ optic: "achromat", friedParamMm: 25, screens: 30, pupilSamples: 32 });
    const fine = run({ optic: "achromat", friedParamMm: 25, screens: 30, pupilSamples: 64 });
    expect(coarse.maxGridPhaseStepWaves).toBeGreaterThan(PHASE_STEP_LIMIT_WAVES);
    expect(fine.maxGridPhaseStepWaves).toBeLessThan(PHASE_STEP_LIMIT_WAVES);
    // Roughly halved, which is the mechanism rather than a coincidence.
    expect(coarse.maxGridPhaseStepWaves / fine.maxGridPhaseStepWaves).toBeGreaterThan(1.6);
    expect(coarse.maxGridPhaseStepWaves / fine.maxGridPhaseStepWaves).toBeLessThan(2.4);
  });

  it("good seeing keeps it clear at either grid — the step follows the atmosphere too", () => {
    const good = run({ optic: "achromat", friedParamMm: 100, screens: 10, pupilSamples: 32 });
    expect(good.maxGridPhaseStepWaves).toBeLessThan(PHASE_STEP_LIMIT_WAVES);
    const bad = run({ optic: "achromat", friedParamMm: 25, screens: 10, pupilSamples: 32 });
    expect(bad.maxGridPhaseStepWaves).toBeGreaterThan(good.maxGridPhaseStepWaves);
  });
});
