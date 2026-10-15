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
import { bandLimitedPeak } from "../src/math/band-limited-peak";

/**
 * § 6bf — the focus surface, offered.
 *
 * § 6be measured where the stage has to be for each colour and each field point
 * and closed by saying a correction wants two one-dimensional curves rather than
 * a map — then returned neither, deferring the readout "because the curve that
 * matters is per objective and the ladder has one". This step builds the readout
 * and answers the deferral's own objection by measuring two more objectives.
 *
 * Every render here is on § 2q.3's resolved rim (`edgeSamples` 8) and reads
 * the band-limited peak; the figures restated there are struck in VALIDATION.md.
 *
 * **The estimator moves into source unchanged**, which is what makes § 6be's
 * pins this step's reproduction: `spectral-field-volume.test.ts` imports
 * `renderedBestFocus`, § 6bf.1 pins the swap bitwise against the sweep written
 * out, and it returns § 6be.3's restated on-axis figures to the digit.
 *
 * **The bracket no longer has to be handed in.** § 6be tabulated twelve
 * `about` values by hand from a coarse pass and could not have shipped that. A
 * coarse pass seeded from `focusDepthMm` — the paraxial catalogue shift, which
 * § 6bb.7 pins 50% away from this answer, so it opens the bracket and does not
 * choose it — widens until the maximum is interior and refuses rather than
 * returning an edge, `analysis/focus`'s own rule. It lands 2.8e-6 mm from
 * § 6be's hand-bracketed figure, inside the 1.1e-5 mm the vertex moves with
 * where the fine grid's points fall.
 *
 * **And a coefficient is not the field curve.** § 6be read the field term as
 * h² and found one curve serving every wavelength. That reading is true of the
 * ladder's 4×/0.10 at its own design wavelength — 3.5% across the whole field —
 * and of nothing else measured here. The same objective at 430 nm spreads
 * 12.7%, and not as a drift: it dips at the height where § 6be's pupil clip
 * begins and recovers outward (register item 33). The 10× drifts 48.8% over the
 * same field, monotonely, and the 2× 34.1%, monotonely too.
 *
 * **The scale is not derivable either.** The edge coefficient runs 0.044873,
 * 0.067953 and 0.116512 mm/mm² at focal lengths 75, 37.5 and 15 mm — a factor
 * 2.60 over a focal-length ratio of 5, so it goes as f^-0.59, and all three
 * pairs of objectives agree on that exponent to 2%. A form that merely scaled
 * would give f^-1 and put the 10× at 2.5× the 4×; it is 1.71×. So the SAMPLED
 * curve is the readout and a coefficient is a fit a caller may take from it.
 *
 * **Every sample carries its own conditioning**, because a stage sweep stops
 * resolving before it stops returning a number, and the refusal is what a caller
 * holds it against. § 6bf.5's negative control was the 2× at 430 nm, refused as
 * a plateau. On the resolved rim at 48 pupil samples it reads under the
 * threshold at every height, its vertex moves with the field and holds to 2e-4 mm
 * over a 4× range of step — but at 47 samples it is refused, and at 56 it
 * passes on its own bracket yet reads over 1 at one sweep step of three off its
 * vertex, so it sits on the threshold and the lattice decides the side
 * (register item 34). The refusal is now tested as a threshold, below the
 * reading, rather than as a fact about that objective.
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
/** § 2q.3's resolved rim, on every render here. */
const EDGE = 8;

const BALL: FocusProbe = (centreMm) =>
  gaussianBallEmitter({ waistMm: 0.005, axialWaistMm: 0.004, peak: 1, centreMm });

const SWEEP: FocusSweepOptions = {
  size: FOCUS_SIZE,
  pupilSamples: FOCUS_PS,
  edgeSamples: EDGE,
  peak: "band-limited",
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
      edgeSamples: EDGE,
      samples: [],
      slabs: uniformSlabs(-0.008, 0.008, 3),
      focusMm,
    },
    { nm, weight: 1 },
    frame.centreMm,
  ).image.intensity;
  return bandLimitedPeak(intensity, FOCUS_SIZE).value;
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
 * questions. The 2× is swept at the design wavelength only, and that is not an
 * economy — at 430 nm it is § 6bf.5's plateau and cannot be read there at all.
 * The 10× gets both, because "the shape is the objective's" has to be told apart
 * from "the shape is the wavelength's", and the 4×'s own two rows show the
 * wavelength moving it.
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
const SURFACE_10_BLUE = surfaceOf(build(10, 0.1), [430], true);

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
      // § 6be.3's on-axis figures on the resolved rim (§ 2q.3; 0.21400556 /
      // 0.04709541 / 0.06736525 point-sampled), which § 6be reproduced from § 6bb.6.
      expect(renderedBestFocus(SYSTEM, 430, 0, { ...SWEEP, aboutMm: 0.2136 }).focusMm).toBeCloseTo(
        0.20977356,
        7,
      );
      expect(
        renderedBestFocus(SYSTEM, DESIGN, 0, { ...SWEEP, aboutMm: 0.0469 }).focusMm,
      ).toBeCloseTo(0.04787834, 7);
      expect(renderedBestFocus(SYSTEM, RED, 0, { ...SWEEP, aboutMm: 0.0672 }).focusMm).toBeCloseTo(
        0.06802565,
        7,
      );
    });
  });

  describe("§ 6bf.2 — the bracket does not have to be handed in", () => {
    it("a coarse pass seeded from the paraxial shift lands 2.8e-6 mm from the hand-bracketed answer", () => {
      const auto = renderedBestFocus(SYSTEM, 430, 0, SWEEP);
      expect(auto.interior).toBe(true);
      expect(auto.focusMm).toBeCloseTo(0.20977072, 7);
      // Against § 6be's hand-tabulated bracket: the vertex depends on where the
      // fine grid's points fall. That dependence is measured rather than assumed
      // — five bracket centres a fifth of a step apart span 1.12e-5 mm — and the
      // auto-seeded answer lands inside it. (Point-sampled, the gap was 3.3e-7.)
      const drift = Math.abs(auto.focusMm - 0.20977356);
      expect(drift).toBeCloseTo(2.8383e-6, 9);
      const phase = [0, 1, 2, 3, 4].map(
        (k) => renderedBestFocus(SYSTEM, 430, 0, { ...SWEEP, aboutMm: 0.2136 + k * 0.001 }).focusMm,
      );
      const phaseSpan = Math.max(...phase) - Math.min(...phase);
      expect(phaseSpan).toBeCloseTo(1.12319e-5, 9);
      expect(auto.focusMm).toBeGreaterThan(Math.min(...phase));
      expect(auto.focusMm).toBeLessThan(Math.max(...phase));
      expect(drift / DOF430).toBeLessThan(1e-4);
    });

    it("and the paraxial seed is nowhere near the answer, which is why it only opens the bracket", () => {
      // § 6bb.7's 50%: the catalogue quantity is 0.1102 mm where the picture is
      // sharpest at 0.2098. A seed is not an estimate.
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
      expect(design[0]).toBeCloseTo(-0.068726, 5);
      expect(design[3]).toBeCloseTo(-0.067953, 5);
      expect(design[3]! / design[0]! - 1).toBeCloseTo(-0.011256, 4);
      expect(spread(design)).toBeCloseTo(0.034726, 4);

      // At 430 nm the same objective spreads 3.65 times as far. Point-sampled it
      // fell monotonely (−11.1%); resolved it DIPS — down to h = 0.825 and back
      // up at 1.1 — and the dip sits past where § 6be's pupil clip begins, between
      // h = 0.5 and 0.56 on this objective (register item 33).
      const blue = coefficients(SURFACE_4, 0);
      expect(blue[0]).toBeCloseTo(-0.068641, 5);
      expect(blue[2]).toBeCloseTo(-0.060916, 5);
      expect(blue[3]).toBeCloseTo(-0.064034, 5);
      expect(spread(blue)).toBeCloseTo(0.126816, 4);
      expect(Math.abs(blue[1]!)).toBeLessThan(Math.abs(blue[0]!));
      expect(Math.abs(blue[2]!)).toBeLessThan(Math.abs(blue[1]!));
      expect(Math.abs(blue[3]!)).toBeGreaterThan(Math.abs(blue[2]!));
      expect(spread(blue)).toBeGreaterThan(3.5 * spread(design));
    });

    it("and § 6be's outer-third reading does not survive: across its own pair the 430 nm term moves 5.1%", () => {
      // Point-sampled, § 6be's two heights read the 430 nm coefficient constant
      // to 0.16% and this rung said the drift was spent before them. Resolved, the
      // pair straddles the dip above and moves 5.1% — more than the design
      // wavelength moves over the whole field.
      const blue = coefficients(SURFACE_4, 0);
      expect(spread([blue[2]!, blue[3]!])).toBeCloseTo(0.051190, 4);
      expect(spread([blue[2]!, blue[3]!])).toBeGreaterThan(spread(coefficients(SURFACE_4, 1)));
    });
  });

  describe("§ 6bf.4 — the curve is per objective, in SHAPE and not only in scale", () => {
    it("the edge coefficient goes as f^-0.59 over 5× of focal length, where a scaled form gives f^-1", () => {
      const two = Math.abs(coefficients(SURFACE_2, 0)[3]!);
      const four = Math.abs(coefficients(SURFACE_4, 1)[3]!);
      const ten = Math.abs(coefficients(SURFACE_10, 0)[3]!);
      expect(two).toBeCloseTo(0.044873, 5);
      expect(four).toBeCloseTo(0.067953, 5);
      expect(ten).toBeCloseTo(0.116512, 5);

      // f = 75, 37.5 and 15 mm. All three pairs give the same exponent to 2%,
      // and none of them gives 1.
      const p = (f1: number, c1: number, f2: number, c2: number) =>
        Math.log(c2 / c1) / Math.log(f1 / f2);
      const exponents = [p(75, two, 37.5, four), p(37.5, four, 15, ten), p(75, two, 15, ten)];
      expect(exponents[0]).toBeCloseTo(0.598693, 5);
      expect(spread(exponents)).toBeLessThan(0.02);
      // The claim is the BAND, not one pair: three independent pairs of
      // objectives agree on the exponent to 2%, and 1 is nowhere in it. (Point-
      // sampled the band sat at 0.59–0.62; resolved it is 0.588–0.599.)
      for (const e of exponents) {
        expect(e).toBeGreaterThan(0.585);
        expect(e).toBeLessThan(0.605);
      }

      // The negative control on the claim: a form that merely scaled would put
      // the 10×'s coefficient at 2.5× the 4×'s. It is 1.71×.
      expect(ten / four).toBeCloseTo(1.714602, 5);
      expect(ten / four).toBeLessThan(2);
    });

    it("and the SHAPE differs too: the 10× drifts 49% across the field the 4× is flat over", () => {
      const four = coefficients(SURFACE_4, 1);
      const ten = coefficients(SURFACE_10, 0);
      expect(spread(ten)).toBeCloseTo(0.487979, 4);
      expect(spread(four)).toBeCloseTo(0.034726, 4);
      expect(spread(ten) / spread(four)).toBeGreaterThan(14);
      // Monotone at every height — not a wobble.
      for (let k = 1; k < ten.length; k++) {
        expect(Math.abs(ten[k]!)).toBeLessThan(Math.abs(ten[k - 1]!));
      }

      // How well each sweep is conditioned. Point-sampled the 10×'s worst sample
      // sat within 2.2% of the 4×'s (0.4058 against 0.3973) and this rung read
      // that as the estimator not giving up. Resolved it is 1.23× worse — 0.517
      // against 0.421, both near half the refusal threshold — so that defence is
      // weaker than it was, and what still answers "the estimator gave up" is
      // the shape: a monotone 49% with every sample under 0.52.
      expect(worstPlateau(SURFACE_10, 0)).toBeCloseTo(0.517029, 5);
      expect(worstPlateau(SURFACE_4, 1)).toBeCloseTo(0.420705, 5);
      expect(worstPlateau(SURFACE_10, 0) / worstPlateau(SURFACE_4, 1)).toBeLessThan(1.25);
      expect(worstPlateau(SURFACE_10, 0)).toBeLessThan(0.55);
      // The 2× is the worst conditioned of the three, and point-sampled its
      // coefficients wobbled with no trend, which this rung read as a reading at
      // the estimator's limit beside a real shape. Resolved they DRIFT, 34.1%
      // and monotonely, the same way as the 10×'s — so the 2× is a second
      // objective with a shape, not a control for one.
      expect(worstPlateau(SURFACE_2, 0)).toBeCloseTo(0.590108, 5);
      expect(worstPlateau(SURFACE_2, 0)).toBeGreaterThan(worstPlateau(SURFACE_10, 0));
      const twoCoeffs = coefficients(SURFACE_2, 0);
      expect(spread(twoCoeffs)).toBeCloseTo(0.341208, 4);
      for (let k = 1; k < twoCoeffs.length; k++) {
        expect(Math.abs(twoCoeffs[k]!)).toBeLessThan(Math.abs(twoCoeffs[k - 1]!));
      }
    });

    it("and the shape is the OBJECTIVE's, not the wavelength's — the 10× drifts at 430 nm too", () => {
      // The 4×'s two rows show the wavelength moving the spread (3.47% → 12.68%),
      // so a one-wavelength reading on the 10× could not tell "this objective
      // has a shape" from "this wavelength has one". Both of the 10×'s rows
      // drift, and both are several times the 4×'s at the SAME wavelength.
      const tenBlue = coefficients(SURFACE_10_BLUE, 0);
      expect(tenBlue[0]).toBeCloseTo(-0.166067, 5);
      expect(tenBlue[3]).toBeCloseTo(-0.113623, 5);
      expect(spread(tenBlue)).toBeCloseTo(0.461552, 4);
      for (let k = 1; k < tenBlue.length; k++) {
        expect(Math.abs(tenBlue[k]!)).toBeLessThan(Math.abs(tenBlue[k - 1]!));
      }

      const fourBlue = spread(coefficients(SURFACE_4, 0));
      expect(fourBlue).toBeCloseTo(0.126816, 5);
      expect(spread(tenBlue) / fourBlue).toBeGreaterThan(3);
      expect(spread(coefficients(SURFACE_10, 0)) / spread(coefficients(SURFACE_4, 1))).toBeGreaterThan(7);
    });
  });

  describe("§ 6bf.7 — the readout reports its own separability", () => {
    it("the interaction over the 4×'s grid, and the two-curve prediction is worth exactly that", () => {
      expect(SURFACE_4.interactionMm).toBeCloseTo(6.395390e-3, 7);
      expect(SURFACE_4.interactionDepths).toBeCloseTo(0.1479622, 6);
      // Point-sampled this read 2.15e-3 mm, under a twentieth of a depth of
      // focus, and stood for § 6be.2's "separates". Resolved it is § 6be's
      // restated coupling, on a grid of its own: 6.4e-6 mm at h = 0.275 (1.1 mm of
      // image radius, inside the pupil clip), 6.3e-4 at 0.55 (2.2 mm, at its
      // onset) and the worst, 6.4e-3, at 0.825 — past it (register item 33).
      const coupling = HEIGHTS.map((_, j) =>
        Math.abs(SURFACE_4.fieldDropMm[0]![j]! - SURFACE_4.fieldDropMm[1]![j]!),
      );
      expect(coupling[1]).toBeLessThan(1e-5);
      expect(coupling[2]).toBeGreaterThan(5e-4);
      expect(coupling[2]).toBeLessThan(1e-3);
      expect(coupling[3]).toBeCloseTo(SURFACE_4.interactionMm, 15);
      expect(SURFACE_4.interactionDepths).toBeLessThan(0.15);

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
    it("the 2×/0.10 at 430 nm, refused point-sampled, reads on this lattice — and sits ON the threshold", () => {
      const two = build(2, 0.1);
      const design = renderedBestFocus(two, DESIGN, 0.7, { ...SWEEP, maxPlateauDepths: 1 });
      // Well-conditioned at the design wavelength — a real vertex.
      expect(design.plateauDepths).toBeCloseTo(0.579822, 5);
      expect(design.curvature).toBeLessThan(0);

      // At 430 nm, twelve depths of focus from nominal, this rung refused it as a
      // plateau: two heights 0.35 mm apart had returned vertices 5e-4 mm apart.
      // Resolved it passes the same threshold at every height, its vertex walks
      // with the field — 1.03e-2 mm from the axis to 0.35, 9.4e-3 more to 0.7 —
      // and it is still the worse-conditioned half, 1.48× the design wavelength.
      // It is not a plateau as a fact about the optics, and not a measurement as
      // one either: at 56 pupil samples the same sample passes on its own
      // bracket but, bracketed off its vertex, reads 0.96–0.98 at two sweep steps
      // and over 1 at the third; at 47 it is refused — the threshold falls inside
      // the lattice's own spread (register item 34), so the figure pinned here is
      // 48's.
      const blue = [0, 0.35, 0.7].map((h) =>
        renderedBestFocus(two, 430, h, { ...SWEEP, maxPlateauDepths: 1 }),
      );
      expect(blue[0]!.focusMm).toBeCloseTo(0.531770, 6);
      expect(blue[1]!.focusMm).toBeCloseTo(0.521498, 6);
      expect(blue[2]!.focusMm).toBeCloseTo(0.512127, 6);
      expect(blue[2]!.plateauDepths).toBeCloseTo(0.860568, 5);
      for (const b of blue) expect(b.plateauDepths).toBeLessThan(1);
      expect(blue[2]!.plateauDepths / design.plateauDepths).toBeGreaterThan(1.45);
    });

    it("and the refusal is the THRESHOLD's: set under the reading, the same sample throws", () => {
      // What this tests is the mechanism and not the objective — with no
      // configuration on the ladder left reading over 1, the threshold is put
      // below the 0.86 the sample reads.
      expect(() =>
        renderedBestFocus(build(2, 0.1), 430, 0.7, { ...SWEEP, maxPlateauDepths: 0.8 }),
      ).toThrow(/is a plateau/);
    });

    it("and the conditioning is a property of the OPTICS, not of the sweep grid", () => {
      // The expression carries `stepMm`, so the obvious worry is that it reports
      // the grid. It does not: the second difference goes as step², the square
      // root turns that into 1/step, and the multiply cancels it — exactly, where
      // the parabola is a good local fit. Measured over a 4× range of step:
      const at = (system: OpticalSystem, nm: number, h: number, about: number, stepMm: number) =>
        renderedBestFocus(system, nm, h, {
          ...SWEEP,
          aboutMm: about,
          stepMm,
          maxPlateauDepths: 1e9,
        }).plateauDepths;
      const STEPS = [0.0025, 0.005, 0.01];

      // The flattest sample measured, the 2× at 430 nm, is the most invariant
      // of the three, at 0.15% about its own vertex (0.08% point-sampled).
      const two = build(2, 0.1);
      const plateau = STEPS.map((s) => at(two, 430, 0.7, 0.5121, s));
      expect(spread(plateau)).toBeLessThan(0.002);
      for (const p of plateau) expect(p).toBeLessThan(1);

      // And a well-conditioned sample, to 0.34%.
      const sharp = STEPS.map((s) => at(SYSTEM, DESIGN, 0, 0.0479, s));
      expect(spread(sharp)).toBeLessThan(0.004);
      for (const p of sharp) expect(p).toBeLessThan(0.35);

      // The exception this rung pinned is gone. Point-sampled, the 4× at 430 nm at
      // the field edge moved 23.47% over the same three steps, seventy times the
      // sharp sample; § 2q.2 traced it to the brightest pixel handing over beside
      // the vertex, and the band-limited peak — which has no such corner — reads
      // the same sample to 0.28%, as invariant as the sharp one. That is § 2q.2's
      // diagnosis confirmed.
      const ragged = STEPS.map((s) => at(SYSTEM, 430, 1.1, 0.1323, s));
      expect(spread(ragged)).toBeCloseTo(0.002845, 5);
      expect(spread(ragged)).toBeLessThan(spread(sharp));
      expect(Math.max(...ragged)).toBeLessThan(1);
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
