import { describe, it, expect } from "vitest";
import {
  fluorescenceMosaicGeometry,
  renderFluorescenceMosaic,
  mosaicSeamShiftMm,
  type FluorescenceMosaicOptions,
} from "../src/imaging/fluorescence-mosaic";
import {
  renderedFlatField,
  throughputFlatField,
  scannerFlatField,
  flatFieldCorrect,
  mosaicSeamStep,
} from "../src/imaging/mosaic-flat-field";
import { surfaceStage, type TileStageMm } from "../src/imaging/focus-tiles";
import {
  focusSurface,
  predictedFocusMm,
  type FocusProbe,
  type FocusSweepOptions,
} from "../src/imaging/focus-surface";
import {
  fluorescenceSpectralVolume,
  labelledVolumeEmitters,
  type SpectralVolumeEmitterDensity,
} from "../src/imaging/spectral-volume";
import { gaussianBallEmitter, uniformSlabs, type EmitterSlabs } from "../src/imaging/emitter-volume";
import { boxcarBand } from "../src/imaging/emission";
import { objectFieldTile, objectHeightForImageRadius } from "../src/imaging/object-field";
import { finiteConjugateMicroscope, finiteConjugateObjective } from "../src/designs/microscope";
import type { OpticalSystem } from "../src/trace/system";

/**
 * § 6bl — the third magnification, and the trend that never crosses one.
 *
 * § 6bk pulled two levers off a 4×/0.10 control — a 10×/0.10 and a 4×/0.20 —
 * and closed with the honest complaint that **two lenses is not a family**:
 * every conclusion rested on three points, one per lever plus the control, and a
 * lever pulled once cannot tell a trend from a coincidence. This is the
 * magnification lever pulled twice more, to 20× and 40× at the same NA 0.10, and
 * once in the other direction to a 2× that refuses.
 *
 * ## What a matched image radius does and does not tie together
 *
 * Every reading below is at a matched IMAGE radius of 4 mm, which is the currency
 * a mosaic is actually configured in (`centreMm` is an image coordinate) and the
 * one § 6bk.3 found collapses the focus terms. It has a consequence that has to
 * be said out loud before any number is read: **matching the image radius forces
 * the object height to scale as 1/M** — 1.997 mm at 2×, 0.998 at 4×, 0.399 at
 * 10×, 0.200 at 20×, 0.0998 at 40×. Magnification and field position are
 * therefore perfectly tied in this fixture, and no rung here may name
 * magnification as a *mechanism* on the strength of a reading taken in it. What
 * the rungs claim is a trend IN THAT CURRENCY, which is a claim about what a
 * mosaic configured that way does — and § 6bl.5 is the one rung that breaks the
 * tie by holding the object height fixed instead.
 *
 * ## The headline: matched image radius narrows the ratio but does not collapse it
 *
 * § 6bk.3's finding was that the two terms of best focus — colour and field —
 * disagree 5.13× and land on opposite sides of one when read at a matched object
 * height, and agree to 1.15× when read at a matched image radius. The natural
 * reading of a two-point agreement is that the currency collapses the quantity.
 * Four points say something more useful. Colour over field reads **2.499, 2.173,
 * 1.922, 1.808** at 4×, 10×, 20× and 40× — monotone down, **flattening** (−13.0%,
 * −11.6%, −5.9% per step), and never once crossing one. So:
 *
 * - **§ 6bj's trade survives on every lens measured.** A stage scan reaches the
 *   colour term and zeroes the field term (§ 6bj), and colour dominates on all
 *   four. That is now a family statement rather than a coincidence of two.
 * - **The currency narrows the ratio; it does not collapse it, and the residual
 *   grows with the lever's range** — 1.150× across 2.5× of magnification, 1.300×
 *   across 5×, 1.382× across 10×. § 6bk.3's 1.15× was the smallest lever anyone
 *   had pulled, and quoting it as "the lenses agree" would have been quoting the
 *   lever length.
 *
 * ## What § 6bk could not see with two points, and this step can with three
 *
 * § 6bj's registration cost — a square stage lattice cannot abut a radial map in
 * both directions at once — was 95.7× on the control, and § 6bk found 41.8× and
 * 132.9× on its two lenses and could only conclude "the number is the lens's".
 * Three points on ONE lever have a shape: **95.71, 41.78, 21.05 track 1/M to
 * within 10%** (§ 6bl.4), and the anisotropy 40.75, 16.87, 8.87 does the same.
 * A cost that scales as 1/M is a cost a caller can budget for; "somewhere between
 * 42 and 133" is not.
 *
 * ## The two things that go the other way
 *
 * - **The mosaic outruns its own swept field, and worse the higher the
 *   magnification.** § 6bk sized its sweep `OUTER = 1.25` to clear a 13.5%
 *   overshoot at 10×. At 20× the outermost tile lands **1.275×** past the matched
 *   height and 1.25 is SHORT — a throw, not a wrong number, and § 6bl.3 pins the
 *   mechanism: the tile pitch in image mm grows with M while the matched object
 *   height shrinks as 1/M, so the overshoot grows at both ends at once.
 * - **The free flat field stops helping on the axis and starts hurting.** § 6bi
 *   called a per-tile throughput calibration an edge-of-field instrument, worth
 *   1.018× on the control's axis. At 20× the same readout is **0.972× — below
 *   one**, which is a correction that makes the seam worse.
 *
 * ## The refusal, and the one place the confound is broken
 *
 * A 2×/0.10 does not sweep: `renderedBestFocus` refuses it as a plateau 1.079
 * depths of focus wide against the 1 asked for. That is the same *shape* of
 * refusal § 6bk.8 pinned for the 4×/0.20 at 1.805 depths, and § 6bk assigned it
 * no cause — the "aperture binding" in § 6bk.8 was the objective SOLVER refusing
 * NA 0.25, a different refusal entirely. This step can say what the sweep's is.
 *
 * The 2× is swept at 1.997 mm of object height and the control at 0.998, so the
 * refusal is confounded with field position by construction. **Sweeping the 4× at
 * the 2×'s own object height breaks it: the 4× passes there** (§ 6bl.5). Same
 * aperture, same object height, same probe — only the magnification differs, and
 * only one of them refuses. **What that licenses is exactly one sentence: at a
 * fixed object height and a fixed aperture, magnification alone flips the
 * verdict.** Whether the plateau widens *monotonically* as magnification falls is
 * two points and therefore unmeasured — the same inference § 6bl.2 declines to
 * make from four. What is measured is that the estimator's floor is reached from
 * BOTH ends of this solver's range: too fast at 4×/0.20, too slow at 2×/0.10.
 *
 * External numbers: § 6bk.3's 2.498656 and 2.173425 colour-over-field ratios and
 * its 1.149640 residual; § 6bk.5's 1193.3645 and 1355.9474 axial splits and its
 * 1.0177396 free-field gain; § 6bk.6's 95.712993 / 41.775694 registration costs
 * and 40.754313 / 16.868779 anisotropies, and its finding that a scanner's own
 * calibration is never once better; § 6bk.8's 1.80466-depth refusal; § 6be.1's
 * split of best focus into a colour term and a field term.
 *
 * **The 4× and 10× figures above are CITED from § 6bk, not recomputed here.**
 * `second-objective.test.ts` recomputes and guards every one of them, and
 * repeating a 26-second focus sweep to re-derive a number another rung already
 * pins would buy nothing but runtime. If those move, that file fails, not this one.
 */

const DESIGN = 587.5618;
const RED = 656.2725;

const build = (M: number, NA: number): OpticalSystem =>
  finiteConjugateMicroscope({
    objective: finiteConjugateObjective({ magnification: M, numericalAperture: NA }),
  }).system;

/** § 6bk's control, for the geometry rungs — no sweep is run on it. */
const FOUR = build(4, 0.1);
/** § 6bk's magnification lever, likewise geometry only. */
const TEN = build(10, 0.1);
/** The third magnification: 5× the control, same aperture. A full member. */
const TWENTY = build(20, 0.1);
/** The fourth point. Its SWEEP only — no mosaic, which is where the runtime is. */
const FORTY = build(40, 0.1);
/** The other direction, and it refuses. */
const TWO = build(2, 0.1);

const SIZE = 128;
const PS = 32;
const THIN: EmitterSlabs = { depthsMm: [0], thicknessMm: [0.016] };
const SAMPLES = [
  { nm: 430, weight: 1 },
  { nm: DESIGN, weight: 1 },
  { nm: RED, weight: 1 },
];

/** The featureless specimen a blank calibration slide stands for — § 6bi's. */
const BLANK: SpectralVolumeEmitterDensity = labelledVolumeEmitters([
  { density: () => 1, band: boxcarBand(400, 700) },
]);

const BALL: FocusProbe = (centreMm) =>
  gaussianBallEmitter({ waistMm: 0.005, axialWaistMm: 0.004, peak: 1, centreMm });

/** § 6bk's sweep, unchanged — the lens is the only variable. */
const SWEEP: FocusSweepOptions = {
  size: 128,
  pupilSamples: 48,
  slabs: uniformSlabs(-0.008, 0.008, 3),
  probe: BALL,
  stepMm: 0.005,
  halfMm: 0.03,
  maxPlateauDepths: 1,
  radialMapSeed: "magnification",
};

const magOf = (system: OpticalSystem): number =>
  objectFieldTile(system, {
    size: SIZE,
    pupilSamples: PS,
    wavelengthNm: DESIGN,
    centreMm: { x: 0, y: 0 },
  }).magnification;

/** § 6bk's matched ruler, seeded for the same reason (§ 6bk.8). */
const matched = (system: OpticalSystem, radiusMm: number): number =>
  objectHeightForImageRadius(system, radiusMm, DESIGN, { magnification: magOf(system) });

/** Image radius every lens is compared at — § 6bi's, § 6bj's and § 6bk's anchor. */
const ANCHOR = 4;
const H20 = matched(TWENTY, ANCHOR);
const H40 = matched(FORTY, ANCHOR);
const H2 = matched(TWO, ANCHOR);

/**
 * The swept field's outer node, as a multiple of the matched height.
 *
 * § 6bk used 1.25 for both its NA 0.10 lenses and documented why: a 3-tile mosaic
 * anchored at image radius 4 reaches 0.4% past the matched height on the 4× and
 * 13.5% on the 10×, and `predictedFocusMm` refuses outside the swept field rather
 * than extrapolating. **At 20× that overshoot is 27.5% and 1.25 does not cover
 * it** — § 6bl.3 is the measurement, and this is the consequence. It is a sweep
 * EXTENT and not a tolerance: index 2 is still the matched height itself, still a
 * swept node and not an interpolation, and the readings there are unchanged from
 * a 1.25 sweep to the digits pinned below.
 */
const OUTER = 1.3;

const SURF20 = focusSurface(TWENTY, {
  ...SWEEP,
  wavelengthsNm: [430, DESIGN, RED],
  objectHeightsMm: [0, H20 / 2, H20, OUTER * H20],
});
const SURF40 = focusSurface(FORTY, {
  ...SWEEP,
  wavelengthsNm: [430, DESIGN, RED],
  objectHeightsMm: [0, H40 / 2, H40, OUTER * H40],
});

const CORRECTED_20: TileStageMm = surfaceStage(SURF20);

/** § 6bk.3's readings on its two lenses, cited — see the header. */
const RATIO_4 = 2.498656;
const RATIO_10 = 2.173425;

function mosaicOptions(
  stageMm: TileStageMm,
  over: Partial<FluorescenceMosaicOptions> = {},
): FluorescenceMosaicOptions {
  return {
    size: SIZE,
    pupilSamples: PS,
    slabs: THIN,
    samples: SAMPLES,
    tiles: 3,
    guardCells: 4,
    stageMm,
    radialMapSeed: "magnification",
    ...over,
  };
}

const AXIS = { x: 0, y: 0 };
const EDGE = { x: ANCHOR, y: 0 };

interface Flats {
  readonly rendered: number;
  readonly free: number;
  readonly rendOverFree: number;
  readonly seam: number;
  readonly freeGain: number;
  readonly scannerVsRaw: number;
}

/** § 6bk's `flatsOf`, unchanged. */
function flatsOf(
  system: OpticalSystem,
  stageMm: TileStageMm,
  centreMm: { x: number; y: number },
): Flats {
  const options = mosaicOptions(stageMm, { centreMm });
  const geometry = fluorescenceMosaicGeometry(system, options);
  const mosaic = renderFluorescenceMosaic(system, BLANK, options);
  const rendered = renderedFlatField(system, BLANK, options);
  const free = throughputFlatField(mosaic);
  const scanner = scannerFlatField(mosaic);
  const raw = mosaicSeamStep(mosaic.composed, geometry).acrossSeam;
  const afterFree = mosaicSeamStep(flatFieldCorrect(mosaic.composed, free), geometry).acrossSeam;
  const afterScanner = mosaicSeamStep(
    flatFieldCorrect(mosaic.composed, scanner),
    geometry,
  ).acrossSeam;
  return {
    rendered: rendered.span,
    free: free.span,
    rendOverFree: rendered.span / free.span,
    seam: raw,
    freeGain: raw / afterFree,
    scannerVsRaw: afterScanner / raw,
  };
}

/** § 6bk.4's escape readout, unchanged — a double-extent render, § 6bd.8's method. */
function escaped(
  system: OpticalSystem,
  nm: number,
  objectHeightMm: number,
  centreMm: { x: number; y: number },
  focusMm: number,
): number {
  const source = labelledVolumeEmitters([
    {
      density: gaussianBallEmitter({
        waistMm: 0.005,
        axialWaistMm: 0.004,
        peak: 1,
        centreMm: { x: objectHeightMm, y: 0, z: 0 },
      }),
      band: boxcarBand(400, 700),
    },
  ]);
  const wide = fluorescenceSpectralVolume(system, source, {
    size: SIZE * 2,
    pupilSamples: PS,
    slabs: THIN,
    samples: [{ nm, weight: 1 }],
    centreMm,
    radialMapSeed: "magnification",
    focusMm,
  });
  const v = wide.planes[0]!.intensity;
  const n = wide.size;
  const o = Math.round((n - SIZE) / 2);
  let inner = 0;
  let all = 0;
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      const x = v[r * n + c]!;
      all += x;
      if (r >= o && r < o + SIZE && c >= o && c < o + SIZE) inner += x;
    }
  }
  return 1 - inner / all;
}

const F20_AXIS = flatsOf(TWENTY, CORRECTED_20, AXIS);
const F20_EDGE = flatsOf(TWENTY, CORRECTED_20, EDGE);

const spanOf = (xs: readonly number[]): number => Math.max(...xs) - Math.min(...xs);

/** The object height the outermost tile of a 3-tile mosaic anchored at 4 mm sits at. */
function outermostHeight(system: OpticalSystem): { pitchMm: number; ratio: number } {
  const geometry = fluorescenceMosaicGeometry(
    system,
    mosaicOptions(() => 0, { centreMm: EDGE }),
  );
  const corner = Math.hypot(ANCHOR + geometry.pitchMm, geometry.pitchMm);
  return { pitchMm: geometry.pitchMm, ratio: matched(system, corner) / matched(system, ANCHOR) };
}

// ---------------------------------------------------------------------------

describe("§ 6bl.1 — the matched ruler ties magnification to field height, and says so", () => {
  it("a matched IMAGE radius forces the object height to scale as 1/M", () => {
    // The confound, measured rather than asserted, because every rung below is
    // read in this currency and one of them (§ 6bl.5) exists only to escape it.
    // `matched` is a traced chief-ray inversion and not M-times-anything, so the
    // agreement with 1/M is a finding about the lenses and not an identity.
    expect(H2).toBeCloseTo(1.99686296, 7);
    expect(H20).toBeCloseTo(0.19958776, 7);
    expect(H40).toBeCloseTo(0.09978992, 7);

    // 4 mm of image radius is the same place on the slide divided by M, to 0.3%.
    expect((H2 * 2) / (H20 * 20)).toBeCloseTo(1, 2);
    expect((H20 * 20) / (H40 * 40)).toBeCloseTo(1, 2);
    // Which is why the lever spans a factor of twenty in field position too.
    expect(H2 / H40).toBeCloseTo(20.0106, 3);
  });

  it("and the third lens's own surface is the one thing this file measures fresh", () => {
    // The 20× certifies at the same `maxPlateauDepths: 1` the control passes and
    // the 4×/0.20 and the 2× refuse — so it is a full member of the family and
    // not a forced reading (§ 6bk.8's distinction, and § 6bl.5's).
    expect(spanOf(SURF20.colourMm)).toBeCloseTo(0.02384236, 7);
    expect(Math.abs(SURF20.fieldDropMm[0]![2]!)).toBeCloseTo(0.01240811, 7);
    expect(SURF20.colourMm[0]!).toBeCloseTo(0.02687130, 7);
    expect(SURF20.interactionMm).toBeCloseTo(1.89219442e-3, 9);
  });
});

describe("§ 6bl.2 — four points, monotone, and never across one", () => {
  const ratio20 = spanOf(SURF20.colourMm) / Math.abs(SURF20.fieldDropMm[0]![2]!);
  const ratio40 = spanOf(SURF40.colourMm) / Math.abs(SURF40.fieldDropMm[0]![2]!);

  it("colour over field reads 2.499, 2.173, 1.922, 1.808 across a 10× magnification range", () => {
    // § 6be.1 split best focus into a colour term and a field term; § 6bj built a
    // geometry on which of them dominates. § 6bk had two points and could say only
    // that they agreed to 1.15×. Four say the ratio moves, in one direction, and
    // stops short of the thing that would matter.
    expect(ratio20).toBeCloseTo(1.921514, 5);
    expect(ratio40).toBeCloseTo(1.807941, 5);

    const series = [RATIO_4, RATIO_10, ratio20, ratio40];
    for (let i = 1; i < series.length; i++) expect(series[i]!).toBeLessThan(series[i - 1]!);
    // And the step SHRINKS each time — it is flattening, not heading for a crossing.
    // `steps[0]` is arithmetic on two constants cited from § 6bk and pins nothing
    // this file computes; it is written out so the series can be read as a series.
    // `steps[1]` and `steps[2]` each have a measured operand and are real pins.
    const steps = [1 - RATIO_10 / RATIO_4, 1 - ratio20 / RATIO_10, 1 - ratio40 / ratio20];
    expect(steps[0]!).toBeCloseTo(0.13016238, 7);
    expect(steps[1]!).toBeCloseTo(0.11590498, 7);
    expect(steps[2]!).toBeCloseTo(0.05910622, 7);
    for (let i = 1; i < steps.length; i++) expect(steps[i]!).toBeLessThan(steps[i - 1]!);
  });

  it("and every one of the four sits above one, so § 6bj's trade survives the family", () => {
    // The sentence a caller acts on. A stage scan keeps the colour term and zeroes
    // the field term, so the trade is worth taking wherever colour dominates —
    // and it dominates on every lens this ladder has measured at NA 0.10.
    for (const r of [RATIO_4, RATIO_10, ratio20, ratio40]) expect(r).toBeGreaterThan(1);
    expect(Math.min(RATIO_4, RATIO_10, ratio20, ratio40)).toBeGreaterThan(1.5);
  });

  it("and the residual GROWS with the lever's range — 1.150×, 1.300×, 1.382×", () => {
    // Why § 6bk.3's 1.15× should not be quoted as "the lenses agree": it is the
    // spread of the shortest lever anyone had pulled. The currency narrows the
    // ratio (§ 6bk.3's matched-object-height reading spread 5.13× and straddled
    // one) and it does not collapse it.
    expect(RATIO_4 / RATIO_10).toBeCloseTo(1.149640, 5);
    expect(RATIO_4 / ratio20).toBeCloseTo(1.30035779, 7);
    expect(RATIO_4 / ratio40).toBeCloseTo(1.38204525, 7);
    expect(RATIO_4 / ratio40).toBeGreaterThan(RATIO_4 / ratio20);
    expect(RATIO_4 / ratio20).toBeGreaterThan(RATIO_4 / RATIO_10);
    // Still an order of magnitude tighter than the ruler § 6bk.3 rejected.
    expect(RATIO_4 / ratio40).toBeLessThan(5.132655 / 2);
  });
});

describe("§ 6bl.3 — the mosaic outruns its swept field, and worse the higher the M", () => {
  it("the outermost tile is 1.051×, 1.132× and 1.275× the matched height", () => {
    // § 6bk's fixture comment measured the first two and sized `OUTER = 1.25` to
    // clear them. The third is past it: a 20× mosaic swept at 1.25 makes
    // `predictedFocusMm` refuse on its own corner tiles, which is a throw and not
    // a wrong answer — but it is a throw nobody would have predicted from a
    // fixture comment that reads "1.25 clears both".
    const four = outermostHeight(FOUR);
    const ten = outermostHeight(TEN);
    const twenty = outermostHeight(TWENTY);
    expect(four.ratio).toBeCloseTo(1.051293, 5);
    expect(ten.ratio).toBeCloseTo(1.132087, 5);
    expect(twenty.ratio).toBeCloseTo(1.274809, 5);

    expect(four.ratio).toBeLessThan(1.25);
    expect(ten.ratio).toBeLessThan(1.25);
    expect(twenty.ratio).toBeGreaterThan(1.25);
    expect(twenty.ratio).toBeLessThan(OUTER);
  });

  it("because the pitch grows with M while the matched height shrinks as 1/M", () => {
    // The mechanism, and the reason this gets worse rather than wandering: a tile
    // is a fixed pixel count on the IMAGE, so its pitch in image mm goes as M,
    // while the height the anchor sits at goes as 1/M. The overshoot is squeezed
    // from both ends, so any future rung on a faster-magnifying lens has to size
    // its sweep from the geometry rather than inherit a constant.
    const four = outermostHeight(FOUR);
    const ten = outermostHeight(TEN);
    const twenty = outermostHeight(TWENTY);
    expect(four.pitchMm).toBeCloseTo(0.201158, 5);
    expect(ten.pitchMm).toBeCloseTo(0.502895, 5);
    expect(twenty.pitchMm).toBeCloseTo(1.005792, 5);
    // Pitch is linear in M to under three parts per million — it IS the
    // image-side pixel scale, and the residual is the traced magnification's
    // departure from the nominal one and not a property of the mosaic.
    expect(ten.pitchMm / four.pitchMm).toBeCloseTo(2.50000644, 7);
    expect(Math.abs(ten.pitchMm / four.pitchMm / 2.5 - 1)).toBeLessThan(3e-6);
    expect(Math.abs(twenty.pitchMm / ten.pitchMm / 2.0 - 1)).toBeLessThan(3e-6);
  });
});

describe("§ 6bl.4 — three points on one lever, and the registration cost has a shape", () => {
  const field = mosaicSeamShiftMm(TWENTY, mosaicOptions(CORRECTED_20, { centreMm: EDGE }));
  const scan = mosaicSeamShiftMm(
    TWENTY,
    mosaicOptions(CORRECTED_20, { centreMm: EDGE, scan: "stage" }),
  );
  const ratio20 = scan.mm / field.mm;
  const aniso20 = scan.betweenRowsMm / scan.betweenColumnsMm;

  it("§ 6bj's cost is 95.71, 41.78, 21.05 along the lever — 1/M to within 10%", () => {
    // § 6bj explained the cost structurally: a square stage lattice cannot abut a
    // radial map in both directions at once, so a stage scan pays a registration
    // error a field scan does not. § 6bk found the size was the lens's and stopped
    // there, having two points and no lever long enough to fit. Three points on
    // one lever, at a matched image radius, fall on 1/M — which turns "somewhere
    // between 42× and 133×" into a number a caller can budget.
    //
    // A note on conventions, because the series mixes them: § 6bk measured the 4×
    // at its AXIAL stage and the 10× at its corrected one, and the 20× here is
    // corrected. The stage convention moves where the focus sits and not where a
    // tile LANDS, and the seam shift is a lateral geometry — but the series is
    // stated as § 6bk published it rather than silently re-based.
    expect(ratio20).toBeCloseTo(21.045983, 4);
    // Arithmetic on two constants cited from § 6bk — written out so the lever's
    // first step can be read beside its second, not a pin on anything measured.
    expect(95.712993 / 41.775694).toBeCloseTo(2.291, 2);
    // This one has a measured operand, and is the step this file actually adds.
    expect(41.775694 / ratio20).toBeCloseTo(1.985, 2);

    // Against the lever's own factors, 2.5 and 2.
    expect(Math.abs(95.712993 / 41.775694 / 2.5 - 1)).toBeLessThan(0.1);
    expect(Math.abs(41.775694 / ratio20 / 2.0 - 1)).toBeLessThan(0.1);
    // The residual is a consistent EXCESS and not scatter — it is 1/M plus a bit,
    // at both steps and in the same direction, which is what makes it a law with
    // a stated error rather than three numbers that happen to descend.
    expect(95.712993 * (4 / 20)).toBeLessThan(ratio20);
    expect(95.712993 * (4 / 10)).toBeLessThan(41.775694);
  });

  it("and the anisotropy does the same, 40.75, 16.87, 8.87 — every lens pays more across", () => {
    // The direction is § 6bj's and it travels unchanged; only the size moves, and
    // it moves the same way as the cost itself.
    expect(aniso20).toBeCloseTo(8.874831, 4);
    // Cited-literal arithmetic again, then the measured step.
    expect(40.754313 / 16.868779).toBeCloseTo(2.416, 2);
    expect(16.868779 / aniso20).toBeCloseTo(1.901, 2);
    for (const a of [40.754313, 16.868779, aniso20]) expect(a).toBeGreaterThan(1);
    for (const r of [95.712993, 41.775694, ratio20]) expect(r).toBeGreaterThan(1);
  });
});

describe("§ 6bl.5 — the sweep's refusal is MAGNIFICATION's, and the confound is broken", () => {
  const twoSweep = () =>
    focusSurface(TWO, {
      ...SWEEP,
      wavelengthsNm: [430, DESIGN, RED],
      objectHeightsMm: [0, H2 / 2, H2],
    });

  it("a 2×/0.10 refuses as a plateau 1.079 depths wide, at the control's own aperture", () => {
    // The same SHAPE of refusal § 6bk.8 pinned for the 4×/0.20 at 1.80466 depths —
    // but at the control's aperture, which the fast lens was not. § 6bk assigned
    // the sweep refusal no cause (its "aperture binding" was the objective SOLVER
    // refusing NA 0.25, a different refusal), so this is additive to that rung.
    expect(twoSweep).toThrow(/plateau/);
    expect(twoSweep).toThrow(/1\.078594/);
    expect(twoSweep).toThrow(/depths of focus/);
  });

  it("and the 4× at the 2×'s OWN object height PASSES — same NA, same height, only M differs", () => {
    // The rung that earns the header's caution. Read at a matched image radius the
    // 2× is also two millimetres out in the field, so its refusal is confounded
    // with field position by construction — and the whole point of § 6bk.3 is that
    // a claim read in the wrong currency is a claim about the ruler. Hold the
    // object height at the 2×'s own 1.9969 mm and sweep the CONTROL there: it
    // certifies. So magnification alone flips the verdict at a fixed height and a
    // fixed aperture — which is the whole claim, two points supporting no trend —
    // and this solver's range is bounded at both ends by the same estimator floor:
    // too fast at 4×/0.20, too slow at 2×/0.10.
    const at2sHeight = focusSurface(FOUR, {
      ...SWEEP,
      wavelengthsNm: [430, DESIGN, RED],
      objectHeightsMm: [0, H2 / 2, H2],
    });
    expect(Math.abs(at2sHeight.fieldDropMm[0]![2]!)).toBeCloseTo(0.14107375, 7);

    // The colour term is axial and does not know the height — it is § 6bk.3's
    // control value to eight digits, which is what makes this the SAME sweep
    // pushed out in field and not a different measurement.
    expect(spanOf(at2sHeight.colourMm)).toBeCloseTo(0.16690632, 7);
    // And out at 2 mm the control's own ratio is still above one, so the 2× would
    // not have been a sign change even if it had swept.
    expect(spanOf(at2sHeight.colourMm) / Math.abs(at2sHeight.fieldDropMm[0]![2]!)).toBeCloseTo(
      1.183,
      2,
    );
  });
});

describe("§ 6bl.6 — the flat field on a third lens, and a gain that crosses below one", () => {
  it("the free field stops helping on the axis: 1.018× on the control, 0.972× at 20×", () => {
    // § 6bi called a per-tile throughput calibration an edge-of-field instrument —
    // worth nothing on the axis (1.01788×, § 6bk.1) and 189× at the edge — and
    // § 6bk found that at NA 0.20 it inverts outright. This is the third thing it
    // does: on the axis at 20× it goes BELOW one. A flat field that makes the seam
    // worse is not a smaller correction, it is the wrong correction, and it is
    // reached along the magnification lever rather than the aperture one.
    //
    // The control's figure cited here is § 6bk.1's **corrected**-stage 1.01788
    // and not § 6bk.5's axial 1.0177396, because `F20_AXIS` is a corrected-stage
    // reading and the two conventions are not the same number (§ 6bk.5's bridge
    // is what says how far apart). Comparing across them would be a 0.2% error
    // inside a 4.6% finding — small, and still the wrong comparison.
    expect(F20_AXIS.freeGain).toBeCloseTo(0.97220158, 7);
    expect(F20_AXIS.freeGain).toBeLessThan(1);
    expect(1.01788 / F20_AXIS.freeGain).toBeCloseTo(1.046985, 5);

    // At the edge it still buys nearly everything, as on the control.
    expect(F20_EDGE.freeGain).toBeCloseTo(193.71560, 4);
    expect(F20_EDGE.freeGain / F20_AXIS.freeGain).toBeGreaterThan(100);
  });

  it("and § 6bk.5's 'magnification barely touches the split' holds across 5×, at 1.185×", () => {
    // § 6bk measured 1.136× across 2.5× and called it barely-anything beside the
    // aperture's 1195×. Across twice the lever it is 1.185× — still nothing, and
    // now known to be SATURATING rather than merely small: 1.136× over the first
    // 2.5× and 1.043× more over the next 2×.
    expect(F20_AXIS.rendOverFree).toBeCloseTo(1414.32847, 4);
    expect(F20_AXIS.rendOverFree / 1193.3645).toBeCloseTo(1.185164, 5);
    expect(F20_AXIS.rendOverFree / 1355.9474).toBeCloseTo(1.043055, 5);
    expect(F20_AXIS.rendOverFree / 1193.3645).toBeLessThan(1195.2705 / 10);

    // And at the edge the split is flat outright — the 10× and the 20× agree to 0.2%.
    expect(F20_EDGE.rendOverFree).toBeCloseTo(1.1363943, 6);
    expect(Math.abs(F20_EDGE.rendOverFree / 1.1351098 - 1)).toBeLessThan(2e-3);
  });

  it("and § 6bk.6's scanner verdict is never once better on the third lens either", () => {
    // The one sign that has travelled to every lens on this branch: a real slide
    // scanner's repeating per-tile flat field is right for a stage scan and wrong
    // for a field-scanned mosaic, which is a statement about the GEOMETRY and not
    // the glass. Ten measurements over four lenses now, never once below one.
    expect(F20_AXIS.scannerVsRaw).toBeCloseTo(1.2012641, 6);
    expect(F20_EDGE.scannerVsRaw).toBeCloseTo(1.0914923, 6);
    expect(F20_AXIS.scannerVsRaw).toBeGreaterThanOrEqual(1);
    expect(F20_EDGE.scannerVsRaw).toBeGreaterThanOrEqual(1);
    // And still inside § 6bk.6's 1.209× ceiling, which four lenses have not passed.
    expect(F20_AXIS.scannerVsRaw).toBeLessThan(1.2090451);
  });

  it("and § 6bg's focus correction still helps on the third lens, as on every other", () => {
    // § 6bk.4 found 3.139×, 1.154× and 1.192×, ordered by how far each lens's
    // nominal stage sat from its best focus. The 20×'s nominal stage is very
    // nearly its best focus already, so it has the least to gain and gains the
    // least — 2.1%. The direction is what travels; the size never has.
    const nominal = escaped(TWENTY, 430, H20, EDGE, 0);
    const corrected = escaped(TWENTY, 430, H20, EDGE, predictedFocusMm(SURF20, 430, H20));
    expect(nominal).toBeCloseTo(0.02255043, 7);
    expect(corrected).toBeCloseTo(0.02209087, 7);
    expect(nominal / corrected).toBeCloseTo(1.020803, 5);
    expect(nominal / corrected).toBeGreaterThan(1);
  });
});
