import { describe, it, expect } from "vitest";
import {
  focusSurface,
  renderedBestFocus,
  separatedFocusMm,
  type FocusProbe,
  type FocusSweepOptions,
  type FocusSurface,
} from "../src/imaging/focus-surface";
import { formVolumePlane, neutralVolumeEmitterDensity } from "../src/imaging/spectral-volume";
import { gaussianBallEmitter, uniformSlabs } from "../src/imaging/emitter-volume";
import { imageRadiusForObjectHeight, objectFieldTile } from "../src/imaging/object-field";
import { radialMapCovering } from "../src/imaging/radial-map";
import { objectNumericalAperture } from "../src/pupil/microscope";
import { finiteConjugateMicroscope, finiteConjugateObjective } from "../src/designs/microscope";
import type { OpticalSystem } from "../src/trace/system";

/**
 * § 6bf — the focus surface, offered.
 *
 * § 6be measured where the stage has to be for each colour and each field point
 * and closed by saying a correction wants two one-dimensional curves rather than
 * a map — then returned neither, deferring the readout "because the curve that
 * matters is per objective and the ladder has one". This step builds the readout
 * and answers the deferral's own objection by measuring two more objectives.
 *
 * **The estimator moves into source unchanged**, which is what makes § 6be's
 * pins this step's reproduction: `spectral-field-volume.test.ts` now imports
 * `renderedBestFocus` and its every figure stands untouched, and § 6bf.1 pins
 * the swap bitwise against the sweep written out.
 *
 * **The bracket no longer has to be handed in.** § 6be tabulated twelve
 * `about` values by hand from a coarse pass and could not have shipped that. A
 * coarse pass seeded from `focusDepthMm` — the paraxial catalogue shift, which
 * § 6bb.7 pins 50% away from this answer, so it opens the bracket and does not
 * choose it — widens until the maximum is interior and refuses rather than
 * returning an edge, `analysis/focus`'s own rule. It lands 3.3e-7 mm from
 * § 6be's hand-bracketed figure.
 *
 * **And a coefficient is not the field curve.** § 6be read the field term as
 * h² and found one curve serving every wavelength. That reading is true of the
 * ladder's 4×/0.10 at its own design wavelength — 3.9% across the whole field —
 * and of nothing else measured here. The same objective at 430 nm drifts 11.1%,
 * monotonely, and § 6be could not have seen it because it read the OUTER THIRD,
 * where the drift is already spent (0.16% across its own two heights). A 10×
 * from the same solver drifts 48.7% over the same field, on sweeps conditioned
 * as well as the 4×'s own.
 *
 * **The scale is not derivable either.** The edge coefficient runs 0.045459,
 * 0.068860 and 0.120476 mm/mm² at focal lengths 75, 37.5 and 15 mm — a factor
 * 2.65 over a focal-length ratio of 5, so it goes as f^-0.60, and all three
 * pairs of objectives agree on that exponent to 2%. A form that merely scaled
 * would give f^-1 and put the 10× at 2.5× the 4×; it is 1.75×. So the SAMPLED
 * curve is the readout and a coefficient is a fit a caller may take from it.
 *
 * **Every sample carries its own conditioning**, because a stage sweep stops
 * resolving before it stops returning a number. § 6bf.5 is the negative
 * control: on the 2× at 430 nm the axial response is a plateau, the parabola
 * still fits, and the readout refuses.
 *
 * External numbers: § 6bb.6's rendered focus sweep, through § 6be's
 * reproduction of it, and § 6be's own pinned surface.
 */

const DESIGN = 587.5618;
const RED = 656.2725;

const build = (M: number, NA: number): OpticalSystem =>
  finiteConjugateMicroscope({
    objective: finiteConjugateObjective({ magnification: M, numericalAperture: NA }),
  }).system;

/** § 6bb.6's own configuration, which § 6be extended and this reproduces. */
const SYSTEM = build(4, 0.1);
const FOCUS_SIZE = 128;
const FOCUS_PS = 48;

const BALL: FocusProbe = (centreMm) =>
  gaussianBallEmitter({ waistMm: 0.005, axialWaistMm: 0.004, peak: 1, centreMm });

const SWEEP: FocusSweepOptions = {
  size: FOCUS_SIZE,
  pupilSamples: FOCUS_PS,
  slabs: uniformSlabs(-0.008, 0.008, 3),
  probe: BALL,
  stepMm: 0.005,
  halfMm: 0.03,
  // Loose enough that only a genuine plateau trips it — § 6bf.5 measures where
  // the real configurations sit against it.
  maxPlateauDepths: 1,
};

const NA430 = objectNumericalAperture(SYSTEM, 430);
const DOF430 = (430 * 1e-6) / (NA430 * NA430);

// ---------------------------------------------------------------------------
// § 6be's sweep, written out — the control § 6bf.1 reduces to.
// ---------------------------------------------------------------------------

function peakWrittenOut(system: OpticalSystem, nm: number, h: number, focusMm: number): number {
  const frame = objectFieldTile(system, {
    size: FOCUS_SIZE,
    pupilSamples: FOCUS_PS,
    wavelengthNm: nm,
    centreMm: { x: imageRadiusForObjectHeight(system, h, nm), y: 0 },
  });
  const ball = gaussianBallEmitter({
    waistMm: 0.005,
    axialWaistMm: 0.004,
    peak: 1,
    centreMm: { x: frame.centreObjectMm.x, y: frame.centreObjectMm.y, z: 0 },
  });
  const intensity = formVolumePlane(
    system,
    neutralVolumeEmitterDensity(ball),
    {
      size: FOCUS_SIZE,
      pupilSamples: FOCUS_PS,
      samples: [],
      slabs: uniformSlabs(-0.008, 0.008, 3),
      focusMm,
    },
    { nm, weight: 1 },
    frame.centreMm,
  ).image.intensity;
  let peak = 0;
  for (const v of intensity) if (v > peak) peak = v;
  return peak;
}

function bestFocusWrittenOut(nm: number, h: number, about: number, step: number, half: number) {
  const xs: number[] = [];
  const ys: number[] = [];
  const n = Math.round(half / step);
  for (let i = -n; i <= n; i++) {
    xs.push(about + i * step);
    ys.push(peakWrittenOut(SYSTEM, nm, h, about + i * step));
  }
  let best = 1;
  for (let i = 1; i < ys.length - 1; i++) if (ys[i]! > ys[best]!) best = i;
  const y0 = ys[best - 1]!;
  const y1 = ys[best]!;
  const y2 = ys[best + 1]!;
  return {
    mm: xs[best]! + ((0.5 * (y0 - y2)) / (y0 - 2 * y1 + y2)) * step,
    peak: y1,
  };
}

/**
 * The three surfaces, computed once — the expensive part of this file.
 *
 * Heights are the SAME on all three so the coefficients are comparable: a
 * coefficient read to each objective's own field edge would be three different
 * questions. The 2× and the 10× are swept at the design wavelength only, and
 * that is an economy and not a result — the 2× at 430 nm is § 6bf.5's plateau
 * and cannot be read there at all, and a second wavelength on the 10× would
 * repeat a shape the design wavelength already shows.
 */
const HEIGHTS = [0, 0.275, 0.55, 0.825, 1.1];

const surfaceOf = (system: OpticalSystem, lambdas: readonly number[], seed: boolean) =>
  focusSurface(system, {
    ...SWEEP,
    ...(seed ? { radialMapSeed: "magnification" as const } : {}),
    wavelengthsNm: [...lambdas],
    objectHeightsMm: HEIGHTS,
  });

/** Read as h², which is how § 6be read it — and what § 6bf.3 is about. */
const coefficients = (surface: FocusSurface, i: number): number[] =>
  surface.fieldDropMm[i]!.slice(1).map((d, k) => d / (HEIGHTS[k + 1]! * HEIGHTS[k + 1]!));

const spread = (xs: readonly number[]): number =>
  Math.max(...xs.map(Math.abs)) / Math.min(...xs.map(Math.abs)) - 1;

const worstPlateau = (surface: FocusSurface, i: number): number =>
  Math.max(...surface.samples[i]!.map((s) => s.plateauDepths));

const SURFACE_4 = surfaceOf(SYSTEM, [430, DESIGN], false);
const SURFACE_2 = surfaceOf(build(2, 0.1), [DESIGN], false);
const SURFACE_10 = surfaceOf(build(10, 0.1), [DESIGN], true);

describe("§ 6bf — the focus surface, offered", () => {
  describe("§ 6bf.1 — the readout IS § 6be's estimator, bitwise", () => {
    it("at three wavelengths on the axis and at the field edge, given the same bracket", () => {
      const cases: readonly (readonly [number, number, number])[] = [
        [430, 0, 0.2136],
        [DESIGN, 0, 0.0469],
        [RED, 0, 0.0672],
        [430, 1.1, 0.132],
        [DESIGN, 1.1, -0.0367],
      ];
      for (const [nm, h, about] of cases) {
        const readout = renderedBestFocus(SYSTEM, nm, h, { ...SWEEP, aboutMm: about });
        const control = bestFocusWrittenOut(nm, h, about, 0.005, 0.03);
        expect(Object.is(readout.focusMm, control.mm)).toBe(true);
        expect(Object.is(readout.peak, control.peak)).toBe(true);
        expect(readout.interior).toBe(true);
      }
    });

    it("and it reproduces § 6be's pinned surface to the digits § 6be pinned", () => {
      // § 6bb.6's on-axis figures, which § 6be reproduced before extending.
      expect(renderedBestFocus(SYSTEM, 430, 0, { ...SWEEP, aboutMm: 0.2136 }).focusMm).toBeCloseTo(
        0.21400556,
        7,
      );
      expect(
        renderedBestFocus(SYSTEM, DESIGN, 0, { ...SWEEP, aboutMm: 0.0469 }).focusMm,
      ).toBeCloseTo(0.04709541, 7);
      expect(renderedBestFocus(SYSTEM, RED, 0, { ...SWEEP, aboutMm: 0.0672 }).focusMm).toBeCloseTo(
        0.06736525,
        7,
      );
    });
  });

  describe("§ 6bf.2 — the bracket does not have to be handed in", () => {
    it("a coarse pass seeded from the paraxial shift lands 3.3e-7 mm from the hand-bracketed answer", () => {
      const auto = renderedBestFocus(SYSTEM, 430, 0, SWEEP);
      expect(auto.interior).toBe(true);
      expect(auto.focusMm).toBeCloseTo(0.21400523, 7);
      // Against § 6be's hand-tabulated bracket: the vertex depends on where the
      // fine grid's points fall, and that dependence is three orders under the
      // 1.2e-3 mm floor § 6be.2 measured for the estimator itself.
      const drift = Math.abs(auto.focusMm - 0.21400556);
      expect(drift).toBeLessThan(1e-6);
      expect(drift / DOF430).toBeLessThan(1e-4);
    });

    it("and the paraxial seed is nowhere near the answer, which is why it only opens the bracket", () => {
      // § 6bb.7's 50%: the catalogue quantity is 0.1102 mm where the picture is
      // sharpest at 0.2140. A seed is not an estimate.
      const auto = renderedBestFocus(SYSTEM, 430, 0, SWEEP);
      expect(auto.focusMm / 0.11021339).toBeGreaterThan(1.9);
    });

    it("refuses rather than returning an edge when no bracket contains a maximum", () => {
      expect(() =>
        renderedBestFocus(SYSTEM, 430, 0, {
          ...SWEEP,
          // A coarse window far too narrow to reach the peak, and forbidden from
          // widening: the peak still rises at its edge.
          coarseStepMm: 0.001,
          coarseHalfMm: 0.004,
          maxWidenings: 0,
        }),
      ).toThrow(/never bracketed a maximum/);
    });
  });

  describe("§ 6bf.3 — a coefficient is not the field curve", () => {
    it("the 4× is quadratic at its design wavelength and is NOT at 430 nm", () => {
      // § 6be read the field term as h² and found one curve per wavelength. At
      // the design wavelength, over the whole field, that reading holds: the
      // coefficient wobbles about a constant with no trend.
      const design = coefficients(SURFACE_4, 1);
      expect(design[0]).toBeCloseTo(-0.066276, 5);
      expect(design[3]).toBeCloseTo(-0.068860, 5);
      expect(design[3]! / design[0]! - 1).toBeCloseTo(0.039012, 4);
      expect(spread(design)).toBeLessThan(0.071);

      // At 430 nm the same objective drifts three times as far, and MONOTONELY,
      // which a wobble about a constant does not do.
      const blue = coefficients(SURFACE_4, 0);
      expect(blue[0]).toBeCloseTo(-0.076898, 5);
      expect(blue[3]).toBeCloseTo(-0.068331, 5);
      expect(blue[3]! / blue[0]! - 1).toBeCloseTo(-0.111411, 4);
      for (let k = 1; k < blue.length; k++) {
        expect(Math.abs(blue[k]!)).toBeLessThan(Math.abs(blue[k - 1]!));
      }
      expect(spread(blue)).toBeGreaterThan(1.8 * spread(design));
    });

    it("and § 6be missed it because it read the OUTER THIRD, where the drift is spent", () => {
      // § 6be's own two heights are the last two here, and across just those the
      // 430 nm coefficient is constant to 0.16% — its 1.04% figure, on a
      // slightly different pair. The drift is in the inner field it did not read.
      const blue = coefficients(SURFACE_4, 0);
      expect(spread([blue[2]!, blue[3]!])).toBeLessThan(0.002);
      expect(spread(blue)).toBeGreaterThan(0.12);
    });
  });

  describe("§ 6bf.4 — the curve is per objective, in SHAPE and not only in scale", () => {
    it("the edge coefficient goes as f^-0.60 over 5× of focal length, where a scaled form gives f^-1", () => {
      const two = Math.abs(coefficients(SURFACE_2, 0)[3]!);
      const four = Math.abs(coefficients(SURFACE_4, 1)[3]!);
      const ten = Math.abs(coefficients(SURFACE_10, 0)[3]!);
      expect(two).toBeCloseTo(0.045459, 5);
      expect(four).toBeCloseTo(0.068860, 5);
      expect(ten).toBeCloseTo(0.120476, 5);

      // f = 75, 37.5 and 15 mm. All three pairs give the same exponent to 2%,
      // and none of them gives 1.
      const p = (f1: number, c1: number, f2: number, c2: number) =>
        Math.log(c2 / c1) / Math.log(f1 / f2);
      const exponents = [p(75, two, 37.5, four), p(37.5, four, 15, ten), p(75, two, 15, ten)];
      expect(exponents[0]).toBeCloseTo(0.599107, 5);
      expect(spread(exponents)).toBeLessThan(0.02);
      // The claim is the BAND, not one pair: three independent pairs of
      // objectives agree on the exponent to 2%, and 1 is nowhere in it.
      for (const e of exponents) {
        expect(e).toBeGreaterThan(0.59);
        expect(e).toBeLessThan(0.62);
      }

      // The negative control on the claim: a form that merely scaled would put
      // the 10×'s coefficient at 2.5× the 4×'s. It is 1.75×.
      expect(ten / four).toBeCloseTo(1.749579, 5);
      expect(ten / four).toBeLessThan(2);
    });

    it("and the SHAPE differs too: the 10× drifts 49% across the field the 4× is flat over", () => {
      const four = coefficients(SURFACE_4, 1);
      const ten = coefficients(SURFACE_10, 0);
      expect(spread(ten)).toBeCloseTo(0.486951, 4);
      expect(spread(four)).toBeCloseTo(0.067538, 4);
      expect(spread(ten) / spread(four)).toBeGreaterThan(7);
      // Monotone at every height — not a wobble.
      for (let k = 1; k < ten.length; k++) {
        expect(Math.abs(ten[k]!)).toBeLessThan(Math.abs(ten[k - 1]!));
      }

      // And it is not the estimator giving up. The 10×'s sweeps are conditioned
      // as well as the 4×'s own — 0.4058 against 0.3973 of a depth of focus,
      // within 2.2% — so the same estimator that reads a flat curve on one reads
      // a drifting one on the other.
      expect(worstPlateau(SURFACE_10, 0)).toBeCloseTo(0.405839, 5);
      expect(worstPlateau(SURFACE_4, 1)).toBeCloseTo(0.397282, 5);
      expect(worstPlateau(SURFACE_10, 0) / worstPlateau(SURFACE_4, 1)).toBeLessThan(1.03);
      // The 2× is the one that IS worse conditioned, half as sharp again, and
      // its coefficients wobble with no trend rather than drifting like the
      // 10×'s — which is what a reading at the estimator's limit looks like
      // beside a reading of a real shape.
      expect(worstPlateau(SURFACE_2, 0)).toBeGreaterThan(1.4 * worstPlateau(SURFACE_4, 1));
      expect(spread(coefficients(SURFACE_2, 0))).toBeCloseTo(0.154104, 4);
      const twoCoeffs = coefficients(SURFACE_2, 0);
      expect(Math.abs(twoCoeffs[1]!)).toBeGreaterThan(Math.abs(twoCoeffs[0]!));
      expect(Math.abs(twoCoeffs[2]!)).toBeLessThan(Math.abs(twoCoeffs[1]!));
    });
  });

  describe("§ 6bf.7 — the readout reports its own separability", () => {
    it("the interaction over the 4×'s grid, and the two-curve prediction is worth exactly that", () => {
      expect(SURFACE_4.interactionMm).toBeCloseTo(2.152515e-3, 7);
      expect(SURFACE_4.interactionDepths).toBeCloseTo(4.980007e-2, 6);
      // Under a twentieth of a depth of focus — § 6be.2's finding, on this grid
      // and through this readout.
      expect(SURFACE_4.interactionDepths).toBeLessThan(0.05);

      // With two wavelengths the averaged field term is half-way between them,
      // so the prediction's error IS half the interaction — exactly, which is
      // what makes `interactionMm` the number a caller reads the prediction
      // against rather than a decoration on it.
      let worst = 0;
      for (let i = 0; i < SURFACE_4.wavelengthsNm.length; i++) {
        for (let j = 0; j < HEIGHTS.length; j++) {
          worst = Math.max(
            worst,
            Math.abs(separatedFocusMm(SURFACE_4, i, j) - SURFACE_4.samples[i]![j]!.focusMm),
          );
        }
      }
      expect(worst).toBeCloseTo(SURFACE_4.interactionMm / 2, 15);

      // A surface at one wavelength cannot disagree with itself.
      expect(SURFACE_10.interactionMm).toBe(0);
      expect(separatedFocusMm(SURFACE_10, 0, 4)).toBe(SURFACE_10.samples[0]![4]!.focusMm);
    });
  });

  describe("§ 6bf.5 — a plateau is refused, not reported", () => {
    it("the 2×/0.10 at 430 nm reads a plateau, and the same objective at its design wavelength does not", () => {
      const two = build(2, 0.1);
      const plateau = renderedBestFocus(two, DESIGN, 0.7, { ...SWEEP, maxPlateauDepths: 1 });
      // Well-conditioned at the design wavelength — a real vertex.
      expect(plateau.plateauDepths).toBeLessThan(1);
      expect(plateau.curvature).toBeLessThan(0);

      // …and at 430 nm, twelve depths of focus from nominal and past this
      // doublet's Maréchal reach, the axial response flattens out.
      expect(() =>
        renderedBestFocus(two, 430, 0.7, { ...SWEEP, maxPlateauDepths: 1 }),
      ).toThrow(/is a plateau/);
    });
  });

  describe("§ 6bf.6 — a 10× renders only with a seeded bracket", () => {
    it("unseeded the inverse map refuses; seeded it renders, and the seed costs the mantissa", () => {
      const ten = build(10, 0.1);
      expect(() => renderedBestFocus(ten, DESIGN, 0.55, { ...SWEEP, aboutMm: -0.04 })).toThrow(
        /no object height reaches image radius/,
      );
      const seeded = renderedBestFocus(ten, DESIGN, 0.55, {
        ...SWEEP,
        aboutMm: -0.04,
        radialMapSeed: "magnification",
      });
      expect(seeded.interior).toBe(true);

      // Why it is opt-in rather than the default: on an objective where BOTH
      // paths work the tables are not bitwise equal, and § 6bb.1 compares
      // bitwise. The cost is the mantissa and it is not zero.
      const frame = objectFieldTile(SYSTEM, {
        size: FOCUS_SIZE,
        pupilSamples: FOCUS_PS,
        wavelengthNm: 546.074,
        centreMm: { x: 0, y: 0 },
      });
      const plain = radialMapCovering(SYSTEM, [frame], { nodes: 128 });
      const withSeed = radialMapCovering(SYSTEM, [frame], {
        nodes: 128,
        magnification: frame.magnification,
      });
      let worstRel = 0;
      for (let i = 0; i < plain.heights.length; i++) {
        const a = plain.heights[i]!;
        if (a !== 0) worstRel = Math.max(worstRel, Math.abs(a - withSeed.heights[i]!) / Math.abs(a));
      }
      expect(worstRel).toBeGreaterThan(0);
      expect(worstRel).toBeLessThan(1e-15);
    });
  });

  describe("§ 6bf.8 — the refusals", () => {
    it("a field curve read against something other than the axis, and a sweep with no interior", () => {
      expect(() =>
        focusSurface(SYSTEM, { ...SWEEP, wavelengthsNm: [430], objectHeightsMm: [0.4, 0.8] }),
      ).toThrow(/first object height must be 0/);
      expect(() =>
        focusSurface(SYSTEM, { ...SWEEP, wavelengthsNm: [], objectHeightsMm: [0] }),
      ).toThrow(/no wavelengths/);
      expect(() =>
        renderedBestFocus(SYSTEM, 430, 0, { ...SWEEP, stepMm: 0.03, halfMm: 0.03 }),
      ).toThrow(/has no interior/);
      expect(() =>
        renderedBestFocus(SYSTEM, 430, 0, { ...SWEEP, maxPlateauDepths: 0 }),
      ).toThrow(/maxPlateauDepths must be positive/);
    });
  });
});
