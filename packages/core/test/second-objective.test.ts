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
  renderedBestFocus,
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
import { objectNumericalAperture } from "../src/pupil/microscope";
import { finiteConjugateMicroscope, finiteConjugateObjective } from "../src/designs/microscope";
import type { OpticalSystem } from "../src/trace/system";

/**
 * § 6bk — the second objective, and which of the mosaic's numbers were the
 * LENS's.
 *
 * § 6bg, § 6bh, § 6bi and § 6bj built the focus correction, the composed tiles,
 * the flat field and the two scan geometries, and every one of them closed with
 * the same line in "Still open": nothing measures any of this on a second
 * objective. Four steps of conclusions rest on one 4×/0.10. This is the second
 * lens, and the third, and the point is not to re-run sixteen numbers — it is to
 * find out which of them were about optics and which were about that fixture.
 *
 * ## Two levers, and they are held apart on purpose
 *
 * `10×/0.10` changes the magnification and holds the aperture; `4×/0.20` changes
 * the aperture and holds the magnification. Changing both at once would make no
 * delta attributable, and § 6bk.2 is the proof that the separation is real: the
 * depth of focus moves **0.074%** across a 2.5× magnification change and
 * **4.008×** across a 2× aperture change, because it is λ/NA² and the M is not
 * in it. Anything that moves with the first lever is magnification's; anything
 * that moves with the second is aperture's.
 *
 * A realistic `10×/0.25` is **not available**: `finiteConjugateObjective` refuses
 * it, and the refusal says the aperture is binding rather than the glass pair, so
 * the ceiling on this solver is 0.20 at both 4× and 10× (§ 6bk.8). That is why
 * the aperture lever is pulled at 4× rather than at 10×.
 *
 * ## The headline: the RULER decides the verdict, and not one ruler for all of it
 *
 * § 6w already found that figures quoted in millimetres of field do not travel
 * across magnification, and named the currency that does — the field NUMBER, the
 * diameter at the intermediate image. § 6bk.3 finds the same thing on this branch
 * and then finds its limit.
 *
 * Read at a matched OBJECT HEIGHT, the two lenses disagree about which term of
 * best focus dominates: colour is 2.02× field on the 4× and 0.393× on the 10× —
 * **5.13× apart and on opposite sides of one**, which would make § 6bj's whole
 * trade (a stage scan keeps the colour term and zeroes the field term) a good
 * bargain on one lens and a bad one on the other. Read at a matched IMAGE RADIUS
 * — which is the currency a mosaic is actually configured in, `centreMm` being an
 * image coordinate — they are **2.499 and 2.173, 1.15× apart and on the same side
 * of one**. The flip was the ruler's.
 *
 * **And that does not license "image radius is the currency".** § 6bk.4 measures
 * the guard band in the same currency and it does *not* collapse: at matched image
 * radius the 4× leaks 4.21× the 10×, because matching the image radius puts the 4×
 * a full millimetre into its field and the 10× only 0.4 mm there. Matching the
 * image radius matches what a tile COVERS (both lenses' tiles span 0.09357 object
 * mm, § 6bk.2) and does not match where in the field it SITS. Which ruler collapses
 * a quantity is a property of the quantity, and the one sentence that survives all
 * of it is that a mosaic number quoted with no lens and no ruler beside it means
 * nothing.
 *
 * ## The prediction this step got wrong
 *
 * The guard band was predicted to be diffraction's: the blur is λ/NA, so a faster
 * lens should leak LESS past a tile-sized frame. It leaks **11.94× more**
 * (§ 6bk.4). The escape is set by how much of the depth slab is in focus, not by
 * how wide the diffraction pattern is — the same ±0.008 mm of specimen is 0.37
 * depths of focus at NA 0.10 and 1.48 at NA 0.20. **A faster objective wants a
 * bigger guard band, not a smaller one**, which is the opposite of what § 6bh's
 * reasoning would have suggested and is the one number here nobody should quote
 * from intuition.
 *
 * ## What travelled and what did not
 *
 * - **The sign of § 6bi's scanner verdict travels.** A real slide scanner's
 *   per-tile flat field makes a field-scanned mosaic worse on all three lenses at
 *   both field positions — never once better. The SIZE spans 1.000× to 1.209×
 *   (§ 6bk.6). A warning that holds and a number that does not.
 * - **§ 6bi's axial verdict does not travel, and inverts.** "The free flat field
 *   buys nothing on the axis and 121× at the edge" is an NA 0.10 statement: at
 *   NA 0.20 it buys **1394×** on the axis and nothing at the edge (§ 6bk.5).
 * - **The pupil-versus-rasterizer split is the APERTURE's**, 1195× against 0.999×
 *   on the axis, and barely magnification's at all — 1.136× across the 2.5×
 *   (§ 6bk.5).
 * - **§ 6bj's registration cost is lens-dependent**, 41.8× to 132.9× over the
 *   three, and does not collapse at matched image radius either (§ 6bk.6).
 *
 * ## The defect this step found before it could measure anything
 *
 * § 6bf added `radialMapSeed` to the focus SWEEP and to nothing else, and there
 * are several places that build a radial map. So `fluorescenceMosaicGeometry`,
 * which seeds its own inversions, laid out a 10× mosaic at image radius 4 mm
 * happily, while `renderFluorescenceMosaic` — filling those very tiles — built
 * its table unseeded and THREW. A picture whose geometry computes and whose
 * pixels refuse. § 6bk.1 is the thread and its bitwise rung; § 6bk.8 pins the
 * refusal message, which named vignetting and not the one option that fixes it.
 *
 * External numbers: § 6bi.2/§ 6bi.3's flat-field spans and § 6bi.4's 121× free
 * field, reproduced here as the control; § 6bi's 11.0%-worse scanner verdict;
 * § 6bj.5's 95.71× seam ratio and 40.75× anisotropy, reproduced exactly; § 6be.1's
 * separation of best focus into a colour term and a field term; § 6bf.5's finding
 * that the field curve's shape is the objective's; § 6w's field-number currency.
 */

const DESIGN = 587.5618;
const RED = 656.2725;

const build = (M: number, NA: number): OpticalSystem =>
  finiteConjugateMicroscope({
    objective: finiteConjugateObjective({ magnification: M, numericalAperture: NA }),
  }).system;

/** The control — § 6bg through § 6bj's only objective. */
const FOUR = build(4, 0.1);
/** The MAGNIFICATION lever: 2.5× the control, same aperture. */
const TEN = build(10, 0.1);
/** The APERTURE lever: 2× the control, same magnification. */
const FAST = build(4, 0.2);

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

const SWEEP: FocusSweepOptions = {
  size: 128,
  pupilSamples: 48,
  slabs: uniformSlabs(-0.008, 0.008, 3),
  probe: BALL,
  stepMm: 0.005,
  halfMm: 0.03,
  maxPlateauDepths: 1,
  // Without this the 10× does not sweep at all — § 6bf.6, and § 6bk.8 below.
  radialMapSeed: "magnification",
};

const magOf = (system: OpticalSystem): number =>
  objectFieldTile(system, {
    size: SIZE,
    pupilSamples: PS,
    wavelengthNm: DESIGN,
    centreMm: { x: 0, y: 0 },
  }).magnification;

/**
 * The object height whose chief ray lands at `radiusMm` of image — the matched
 * ruler of § 6bk.3, and seeded, because on the 10× the unseeded query throws at
 * exactly the radius the fixtures use (§ 6bk.8).
 */
const matched = (system: OpticalSystem, radiusMm: number): number =>
  objectHeightForImageRadius(system, radiusMm, DESIGN, { magnification: magOf(system) });

/** Image radius every lens is compared at. 4 mm is § 6bi's and § 6bj's anchor. */
const ANCHOR = 4;
const H4 = matched(FOUR, ANCHOR);
const H10 = matched(TEN, ANCHOR);
const H20 = matched(FAST, ANCHOR);

/**
 * The sweep must cover the mosaic's OUTER tile and not its centre: a 3-tile
 * mosaic anchored at image radius 4 reaches 0.4% past that on the 4× and 13.5%
 * past it on the 10×, and `predictedFocusMm` refuses outside the swept field
 * rather than extrapolating. 1.25 clears both. The matched height itself is a
 * NODE and not an interpolation, because § 6bf.5 pins that the 10×'s field curve
 * departs 49% from the quadratic the 4× is flat against — so a headline read off
 * an h² interpolation would be reading the interpolator.
 */
const OUTER = 1.25;

/**
 * Builds on FIRST READ and remembers the answer — `fourth-corner`'s `once`,
 * same reasoning, same cost of a `()` at every read.
 *
 * The two focus surfaces below are twelve sweeps each and the eight `flatsOf`
 * are eight mosaics, and as plain `const`s all of it was computed when the
 * module was evaluated, so a `-t` rerun of one rung paid for the whole file
 * first. `once` evaluates its argument at most once and every fixture here is a
 * pure function of the lens and the options, so each rung reads what it read
 * before. Measured on this file alone: **collect 51.1 s → 0.5 s**, the file's
 * total 92.0 s → 93.3 s, inside this machine's run-to-run spread.
 *
 * § 6bk.3's `describe` body read both surfaces directly, and a `describe` body
 * runs at COLLECT — so that block is wrapped too. A lazy fixture read from a
 * suite body is not lazy.
 */
const once = <T>(make: () => T): (() => T) => {
  let held: { readonly v: T } | undefined;
  return () => (held ??= { v: make() }).v;
};
const SURF4 = once(() =>
  focusSurface(FOUR, {
    ...SWEEP,
    wavelengthsNm: [430, DESIGN, RED],
    objectHeightsMm: [0, H4 / 2, H4, OUTER * H4],
  })
);
const SURF10 = once(() =>
  focusSurface(TEN, {
    ...SWEEP,
    wavelengthsNm: [430, DESIGN, RED],
    objectHeightsMm: [0, H10 / 2, H10, OUTER * H10],
  })
);

/**
 * The fast lens's axial best focus at 430 nm, written out.
 *
 * It cannot come from a `focusSurface`: § 6bk.8 pins that the sweep REFUSES this
 * objective at the threshold the control passes, and that forcing it through
 * yields a field curve whose drop changes sign. The AXIAL reading is not in
 * doubt — it is one interior sweep, and it comes back identical at
 * `maxPlateauDepths` of 2 and of 1e9 — so it is pinned as a constant with that
 * provenance rather than recomputed through a readout that will not certify it.
 */
const AX20 = 0.2618676018;

/**
 * The two stage conventions, and § 6bk.5's bridge between them.
 *
 * `corrected` is § 6bg's — a stage per tile, off the lens's own focus surface —
 * and only the two NA 0.10 lenses can have it. `axial` is one stage for the whole
 * mosaic, the lens's own best focus on the axis, and every lens can have it. The
 * aperture lever is therefore measured at `axial` on both its lenses, the
 * magnification lever at `corrected` on both of its, and the CONTROL is measured
 * at both — which is what makes the two comparisons commensurable: the convention
 * itself is worth 0.16% on the axis and 0.02% at the edge, so anything above
 * about 0.2% is the lens.
 */
const CORRECTED_4 = once((): TileStageMm => surfaceStage(SURF4()));
const CORRECTED_10 = once((): TileStageMm => surfaceStage(SURF10()));
const AXIAL_4: TileStageMm = () => SURF4().colourMm[0]!;
const AXIAL_20: TileStageMm = () => AX20;

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

/**
 * Share of a point emitter's light that falls outside a tile-sized square —
 * § 6bh.4's readout, on a double-extent render so that light the tile has already
 * wrapped back inside its own frame is still counted as escaped (§ 6bd.8's
 * method). The emitter sits at the tile's OWN object centre, which is the whole
 * point of the matched height.
 */
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

interface Flats {
  /** Span of the rendered (blank-slide) flat field. */
  readonly rendered: number;
  /** Span of the free (per-tile throughput) flat field. */
  readonly free: number;
  /** The pupil's share against the rasterizer's — § 6bi.3's ratio. */
  readonly rendOverFree: number;
  /** The brightness step across a seam, uncorrected. */
  readonly seam: number;
  /** …after the free flat field, and how much that bought. */
  readonly freeGain: number;
  /** …after a real scanner's per-tile flat field, as a multiple of uncorrected. */
  readonly scannerVsRaw: number;
}

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

const F4_CORR_AXIS = once(() => flatsOf(FOUR, CORRECTED_4(), AXIS));
const F4_CORR_EDGE = once(() => flatsOf(FOUR, CORRECTED_4(), EDGE));
const F4_AX_AXIS = once(() => flatsOf(FOUR, AXIAL_4, AXIS));
const F4_AX_EDGE = once(() => flatsOf(FOUR, AXIAL_4, EDGE));
const F10_CORR_AXIS = once(() => flatsOf(TEN, CORRECTED_10(), AXIS));
const F10_CORR_EDGE = once(() => flatsOf(TEN, CORRECTED_10(), EDGE));
const F20_AX_AXIS = once(() => flatsOf(FAST, AXIAL_20, AXIS));
const F20_AX_EDGE = once(() => flatsOf(FAST, AXIAL_20, EDGE));

const spanOf = (xs: readonly number[]): number => Math.max(...xs) - Math.min(...xs);

// ---------------------------------------------------------------------------

describe("§ 6bk.1 — the seed reaches the render, and the control does not move", () => {
  it("a 10× mosaic's GEOMETRY computed and its RENDER threw, before the option existed", () => {
    // The defect, stated as the two calls that disagreed. `fluorescenceMosaicGeometry`
    // seeds its own inversions off the anchor frame's traced magnification and lays
    // the tiles out; the render builds its radial table in `spectral-volume`, which
    // had no way to be told. Unseeded that bracket opens at the IMAGE radius, which
    // is |M| object heights out and past where the 10×'s chief ray survives.
    const options = mosaicOptions(CORRECTED_10(), { centreMm: EDGE });
    expect(() => fluorescenceMosaicGeometry(TEN, { ...options, radialMapSeed: "none" })).not.toThrow();
    expect(() =>
      renderFluorescenceMosaic(TEN, BLANK, { ...options, radialMapSeed: "none" }),
    ).toThrow(/no object height reaches image radius/);

    // And seeded it renders — which is this whole step's precondition.
    expect(renderFluorescenceMosaic(TEN, BLANK, options).composed.size).toBe(
      fluorescenceMosaicGeometry(TEN, options).size,
    );
  });

  it("and on the 4× the option is bitwise absent — `\"none\"` written out, and omitted", () => {
    // § 6bj.1's shape. The seed changes the PATH the bracket takes and not the
    // answer, but § 6bf.6 pins that seeded and unseeded tables differ in the
    // mantissa, so the default has to stay `"none"` or every pinned number on
    // the branch moves. This is the rung that says it did not.
    const base = mosaicOptions(AXIAL_4, { centreMm: EDGE });
    const omitted = { ...base };
    delete (omitted as { radialMapSeed?: unknown }).radialMapSeed;
    const written = { ...base, radialMapSeed: "none" as const };

    const a = renderFluorescenceMosaic(FOUR, BLANK, omitted);
    const b = renderFluorescenceMosaic(FOUR, BLANK, written);
    expect(a.composed.planes.length).toBe(b.composed.planes.length);
    for (let p = 0; p < a.composed.planes.length; p++) {
      const x = a.composed.planes[p]!.intensity;
      const y = b.composed.planes[p]!.intensity;
      expect(x.length).toBe(y.length);
      for (let i = 0; i < x.length; i++) expect(Object.is(x[i], y[i])).toBe(true);
    }
  });

  it("and the fixture reproduces § 6bi and § 6bj on the control, so the lens is the only variable", () => {
    // Six digits against § 6bi.3's two spans and § 6bi.4's free-field gain…
    expect(F4_CORR_EDGE().rendered).toBeCloseTo(1.387024e-2, 7);
    expect(F4_CORR_EDGE().free).toBeCloseTo(1.183074e-2, 7);
    expect(F4_CORR_EDGE().rendOverFree).toBeCloseTo(1.17239, 4);
    expect(F4_CORR_AXIS().rendOverFree).toBeCloseTo(1193.3549, 3);
    expect(F4_CORR_EDGE().freeGain).toBeCloseTo(121.14, 1);
    expect(F4_CORR_AXIS().freeGain).toBeCloseTo(1.01788, 4);
    // …and § 6bi's headline that a scanner's own calibration makes it 11% WORSE.
    expect(F4_CORR_EDGE().scannerVsRaw).toBeCloseTo(1.110077, 5);

    // And § 6bj.5's registration figures, to every digit that step pinned.
    const field = mosaicSeamShiftMm(FOUR, mosaicOptions(AXIAL_4, { centreMm: EDGE }));
    const stage = mosaicSeamShiftMm(
      FOUR,
      mosaicOptions(AXIAL_4, { centreMm: EDGE, scan: "stage" }),
    );
    expect(stage.px).toBeCloseTo(0.32896103, 7);
    expect(stage.mm / field.mm).toBeCloseTo(95.7128, 3);
    expect(stage.betweenRowsMm / stage.betweenColumnsMm).toBeCloseTo(40.7543, 3);
  });
});

describe("§ 6bk.2 — the two levers are separable, and the depth of focus proves it", () => {
  const na4 = objectNumericalAperture(FOUR, 430);
  const na10 = objectNumericalAperture(TEN, 430);
  const na20 = objectNumericalAperture(FAST, 430);
  const dof = (na: number) => (430 * 1e-6) / (na * na);

  it("λ/NA² carries no M, so magnification moves it 0.074% and aperture moves it 4.008×", () => {
    expect(dof(na4)).toBeCloseTo(4.322314e-2, 7);
    expect(dof(na10)).toBeCloseTo(4.319115e-2, 7);
    expect(dof(na20)).toBeCloseTo(1.078370e-2, 7);

    // The magnification lever is 2.5× and the depth of focus does not notice.
    expect(dof(na4) / dof(na10)).toBeCloseTo(1.00074056, 7);
    expect(Math.abs(dof(na4) / dof(na10) - 1)).toBeLessThan(1e-3);
    // The aperture lever is 2× and it moves as the square, which is the whole
    // reason these are two levers and not one knob.
    expect(dof(na4) / dof(na20)).toBeCloseTo(4.008190, 5);
    expect(dof(na4) / dof(na20)).toBeGreaterThan(50 * Math.abs(dof(na4) / dof(na10) - 1) * 100);
  });

  it("and a matched image radius matches what a tile COVERS — the same object span on both", () => {
    // Why the currency of § 6bk.3 is meaningful at all: the frame is sized in
    // pixels, the pixel scale is image-side, and the object span is that over M.
    // At a matched image radius the 10×'s tile is 2.5× larger on the image and
    // therefore exactly the same size on the SLIDE, to eleven digits.
    const span = (system: OpticalSystem) => {
      const tile = objectFieldTile(system, {
        size: SIZE,
        pupilSamples: PS,
        wavelengthNm: DESIGN,
        centreMm: EDGE,
      });
      return (tile.pixelScaleMm * SIZE) / Math.abs(tile.magnification);
    };
    expect(span(FOUR)).toBeCloseTo(9.357153e-2, 7);
    expect(span(TEN)).toBeCloseTo(9.357178e-2, 7);
    expect(span(TEN) / span(FOUR)).toBeCloseTo(1, 5);
  });
});

describe("§ 6bk.3 — the RULER decides which focus term dominates", () => {
  // Lazy for the same reason the module's fixtures are: a `describe` body runs
  // at COLLECT, so reading the two surfaces here forced both sweeps on every run
  // of this file, rung asked for or not.
  const colour4 = once(() => spanOf(SURF4().colourMm));
  const colour10 = once(() => spanOf(SURF10().colourMm));
  // Index 2 is the matched height itself — a swept NODE, not an interpolation.
  const field4 = once(() => Math.abs(SURF4().fieldDropMm[0]![2]!));
  const field10 = once(() => Math.abs(SURF10().fieldDropMm[0]![2]!));

  it("at a matched IMAGE RADIUS the two lenses agree to 1.15× and sit the same side of one", () => {
    // § 6be.1 split best focus into a colour term and a field term and § 6bj made
    // a whole geometry out of the split: a stage scan reaches the colour term and
    // zeroes the field term, so which is larger decides whether that trade is
    // worth taking. Read in the currency a mosaic is configured in, it is the
    // same answer on both lenses — colour dominates, by about two and a half.
    expect(colour4()).toBeCloseTo(0.16690632, 7);
    expect(colour10()).toBeCloseTo(0.05476748, 7);
    expect(field4()).toBeCloseTo(0.06679843, 7);
    expect(field10()).toBeCloseTo(0.02519870, 7);

    expect(colour4() / field4()).toBeCloseTo(2.498656, 5);
    expect(colour10() / field10()).toBeCloseTo(2.173425, 5);
    expect(colour4() / field4() / (colour10() / field10())).toBeCloseTo(1.149640, 5);
    expect(colour4() / field4()).toBeGreaterThan(1);
    expect(colour10() / field10()).toBeGreaterThan(1);
  });

  it("and at a matched OBJECT HEIGHT they land 5.13× apart, on OPPOSITE sides of one", () => {
    // The same two lenses, the same two terms, read at object height 1.1 mm —
    // which is a modest field on the 4× and about 70% of the way to where the
    // 10×'s chief ray dies. § 6w found this for a pupil footprint and this is it
    // on a focus surface: object millimetres are not a currency two objectives
    // share, and a mosaic conclusion quoted in them is a conclusion about one lens.
    // Each lens's own colour span over its own field drop at object height 1.1 mm.
    const ratio4 = spanOf(SURF4().colourMm) / 0.0826799288;
    const ratio10 = spanOf(SURF10().colourMm) / 0.139249;
    expect(ratio4).toBeCloseTo(2.018704, 5);
    expect(ratio10).toBeCloseTo(0.393306, 5);
    expect(ratio4 / ratio10).toBeCloseTo(5.132655, 4);
    expect(ratio4).toBeGreaterThan(1);
    expect(ratio10).toBeLessThan(1);
  });

  it("and the separability floor reverses with the ruler too, which is the discriminator", () => {
    // § 6be's interaction term is the estimator's own floor, so if the 5.13×
    // above were a real property of the 10× rather than the ruler's, this would
    // move the same way. It moves the OTHER way: at a matched object height the
    // 10× reads 3.03× the control's floor, and at a matched image radius it reads
    // 3.16× BETTER than it. One lens cannot be both, and the ruler is the only
    // thing that changed.
    expect(SURF4().interactionMm).toBeCloseTo(6.368587e-3, 8);
    expect(SURF10().interactionMm).toBeCloseTo(2.015989e-3, 8);
    expect(SURF4().interactionMm / SURF10().interactionMm).toBeCloseTo(3.159043, 5);
  });
});

describe("§ 6bk.4 — the guard band is APERTURE's, and the prediction was backwards", () => {
  it("twice the aperture leaks 11.94× MORE past a tile's own frame, not less", () => {
    // Predicted: the blur is λ/NA, so a faster lens forms a tighter spot and
    // should keep more of it inside the frame. Measured: the opposite, by an
    // order of magnitude. What escapes is not the diffraction pattern's width
    // but the out-of-focus content of the slab, and the SAME ±0.008 mm of
    // specimen is 0.37 depths of focus at NA 0.10 and 1.48 at NA 0.20. § 6bh
    // read this on one lens and could not have seen which of the two it was.
    const slow = escaped(FOUR, 430, H4, EDGE, SURF4().colourMm[0]!);
    const fast = escaped(FAST, 430, H20, EDGE, AX20);
    expect(slow).toBeCloseTo(0.05399968, 7);
    expect(fast).toBeCloseTo(0.64478925, 7);
    expect(fast / slow).toBeCloseTo(11.940612, 5);
    expect(fast).toBeGreaterThan(slow);
  });

  it("and the guard band does NOT collapse at a matched image radius, where the focus split did", () => {
    // The limit of § 6bk.3's currency, and the reason this file does not claim a
    // single ruler. Matching the image radius matches what a tile covers on the
    // slide (§ 6bk.2) and does NOT match where in the field it sits: the 4× is a
    // whole millimetre out and the 10× is 0.4 mm out, and field aberration is a
    // function of that. So the same currency that took the focus terms from 5.13×
    // to 1.15× leaves the escape 4.21× apart.
    const four = escaped(FOUR, 430, H4, EDGE, predictedFocusMm(SURF4(), 430, H4));
    const ten = escaped(TEN, 430, H10, EDGE, predictedFocusMm(SURF10(), 430, H10));
    expect(four).toBeCloseTo(0.09865512, 7);
    expect(ten).toBeCloseTo(0.02340965, 7);
    expect(four / ten).toBeCloseTo(4.214294, 5);
  });

  it("and § 6bg's correction still buys the most where the escape is largest", () => {
    // The one thing about the guard band that DOES travel: correcting the stage
    // always helps, on every lens, and it helps most where there was most to
    // take. § 6bh measured 5.26× on the control at its own anchor; here the same
    // readout at a matched radius reads 3.14×, 1.15× and 1.19×, ordered by how
    // far each lens's nominal stage sat from its best focus.
    const nominal4 = escaped(FOUR, 430, H4, EDGE, 0);
    const nominal10 = escaped(TEN, 430, H10, EDGE, 0);
    const nominal20 = escaped(FAST, 430, H20, EDGE, 0);
    expect(nominal4).toBeCloseTo(0.30968725, 7);
    expect(nominal10).toBeCloseTo(0.02702152, 7);
    expect(nominal20).toBeCloseTo(0.76829831, 7);

    const corrected4 = escaped(FOUR, 430, H4, EDGE, predictedFocusMm(SURF4(), 430, H4));
    const corrected10 = escaped(TEN, 430, H10, EDGE, predictedFocusMm(SURF10(), 430, H10));
    const corrected20 = escaped(FAST, 430, H20, EDGE, AX20);
    expect(nominal4 / corrected4).toBeCloseTo(3.139089, 5);
    expect(nominal10 / corrected10).toBeCloseTo(1.154290, 5);
    expect(nominal20 / corrected20).toBeCloseTo(1.191550, 5);
    for (const gain of [
      nominal4 / corrected4,
      nominal10 / corrected10,
      nominal20 / corrected20,
    ]) {
      expect(gain).toBeGreaterThan(1);
    }
  });
});

describe("§ 6bk.5 — the flat field's two shares are the APERTURE's, and § 6bi's axial verdict inverts", () => {
  it("the convention costs 0.16% on the axis and 0.02% at the edge — the bridge between the levers", () => {
    // The control is the only lens that can carry both stage conventions, so it
    // is what makes an aperture-lever number (measured at `axial`) comparable
    // with a magnification-lever number (measured at `corrected`). Everything
    // below moves by factors; the convention moves nothing by more than 0.2%.
    expect(F4_AX_AXIS().rendOverFree / F4_CORR_AXIS().rendOverFree).toBeCloseTo(1.001597, 5);
    expect(F4_AX_EDGE().rendOverFree / F4_CORR_EDGE().rendOverFree).toBeCloseTo(0.99978752, 7);
    expect(Math.abs(F4_AX_AXIS().rendOverFree / F4_CORR_AXIS().rendOverFree - 1)).toBeLessThan(2e-3);
    expect(Math.abs(F4_AX_EDGE().rendOverFree / F4_CORR_EDGE().rendOverFree - 1)).toBeLessThan(2e-3);
  });

  it("on the axis the two flat fields differ 1195× at NA 0.10 and COINCIDE at NA 0.20", () => {
    // § 6bi.3's headline was that on the axis the rendered and free fields swap
    // rank outright, 1193×, because the throughput is even in field radius and
    // therefore flat there while the rasterizer's Jacobian is not. Double the
    // aperture and the throughput is no longer flat near the axis at all: the two
    // fields land on top of each other, and the free one — which § 6bi called
    // exact for the pupil and useless on the axis — becomes the whole correction.
    expect(F4_AX_AXIS().rendOverFree).toBeCloseTo(1195.2602, 3);
    expect(F20_AX_AXIS().rendOverFree).toBeCloseTo(0.99932926, 7);
    expect(F4_AX_AXIS().rendOverFree / F20_AX_AXIS().rendOverFree).toBeGreaterThan(1000);
  });

  it("and at the edge it inverts — 1.17× at NA 0.10 against 64.70× at NA 0.20", () => {
    // The other half of the same inversion, and the reason it is an inversion
    // rather than a scaling: the slow lens's split is nearly all pupil at the
    // edge and nearly all rasterizer on the axis, and the fast lens is the other
    // way round in both places.
    expect(F4_AX_EDGE().rendOverFree).toBeCloseTo(1.1721432, 6);
    expect(F20_AX_EDGE().rendOverFree).toBeCloseTo(64.702667, 5);
    expect(F20_AX_EDGE().rendOverFree / F4_AX_EDGE().rendOverFree).toBeCloseTo(55.200311, 5);
  });

  it("and MAGNIFICATION barely touches it — 1.136× across the 2.5×", () => {
    // Against the aperture's thousandfold, on the same readout at the same field
    // positions. This is what § 6bk.2's separation buys: the split is a property
    // of the aperture and not of the objective's power.
    expect(F10_CORR_AXIS().rendOverFree).toBeCloseTo(1355.9362, 3);
    expect(F10_CORR_AXIS().rendOverFree / F4_CORR_AXIS().rendOverFree).toBeCloseTo(1.136239, 5);
    expect(F10_CORR_EDGE().rendOverFree).toBeCloseTo(1.1351098, 6);
  });

  it("and the free field's axial and edge ROLES swap with aperture, 1.018/189 against 1394/1.021", () => {
    // The most quotable consequence, because it is the sentence a caller would
    // act on. On the control, a free flat field is worth nothing on the axis and
    // 189× at the edge, so § 6bi concluded a calibration is an edge-of-field
    // instrument. At twice the aperture that is exactly backwards.
    expect(F4_AX_AXIS().freeGain).toBeCloseTo(1.0177396, 6);
    expect(F4_AX_EDGE().freeGain).toBeCloseTo(188.63416, 4);
    expect(F20_AX_AXIS().freeGain).toBeCloseTo(1394.1918, 3);
    expect(F20_AX_EDGE().freeGain).toBeCloseTo(1.0210966, 6);
    // Written as the crossing it is: each lens is useless where the other is best.
    expect(F4_AX_EDGE().freeGain / F4_AX_AXIS().freeGain).toBeGreaterThan(100);
    expect(F20_AX_AXIS().freeGain / F20_AX_EDGE().freeGain).toBeGreaterThan(100);
  });
});

describe("§ 6bk.6 — the scanner verdict's SIGN travels and its size does not", () => {
  it("a real scanner's per-tile flat field makes it worse on every lens, at both field positions", () => {
    // § 6bi's finding, and § 6bj's reason for it: the repeating per-tile frame is
    // right for a stage scan and wrong for a field scan, because in a field scan
    // each tile really was formed through a different pupil. That argument is
    // about the GEOMETRY and not the glass, so it should hold on any lens — and
    // it does, eight measurements, never once below one.
    const all = [
      F4_CORR_AXIS(),
      F4_CORR_EDGE(),
      F4_AX_AXIS(),
      F4_AX_EDGE(),
      F10_CORR_AXIS(),
      F10_CORR_EDGE(),
      F20_AX_AXIS(),
      F20_AX_EDGE(),
    ];
    for (const f of all) expect(f.scannerVsRaw).toBeGreaterThanOrEqual(1);

    // The size is another matter entirely: from doing nothing at all to 21% worse.
    expect(F20_AX_AXIS().scannerVsRaw).toBeCloseTo(1.0000024, 6);
    expect(F20_AX_EDGE().scannerVsRaw).toBeCloseTo(1.2090415, 6);
    expect(F10_CORR_AXIS().scannerVsRaw).toBeCloseTo(1.1917905, 6);
    expect(F10_CORR_EDGE().scannerVsRaw).toBeCloseTo(1.0820783, 6);
    const sizes = all.map((f) => f.scannerVsRaw);
    expect(Math.max(...sizes) / Math.min(...sizes)).toBeCloseTo(1.2090422, 5);
  });

  it("and § 6bj's registration cost is the lens's — 41.8× to 132.9× over the three", () => {
    // § 6bj measured 95.71× on the control and explained it structurally: a square
    // stage lattice cannot abut a radial map in both directions at once. The
    // explanation travels — every lens pays, and every lens pays more across than
    // along — but the number is a third to a half again of the control's, and it
    // does not collapse at a matched image radius the way § 6bk.3's terms did.
    const cost = (system: OpticalSystem, stage: TileStageMm) => {
      const field = mosaicSeamShiftMm(system, mosaicOptions(stage, { centreMm: EDGE }));
      const scan = mosaicSeamShiftMm(
        system,
        mosaicOptions(stage, { centreMm: EDGE, scan: "stage" }),
      );
      return {
        ratio: scan.mm / field.mm,
        aniso: scan.betweenRowsMm / scan.betweenColumnsMm,
      };
    };
    const four = cost(FOUR, AXIAL_4);
    const ten = cost(TEN, CORRECTED_10());
    const fast = cost(FAST, AXIAL_20);
    expect(four.ratio).toBeCloseTo(95.712993, 4);
    expect(ten.ratio).toBeCloseTo(41.775694, 4);
    expect(fast.ratio).toBeCloseTo(132.89790, 4);
    expect(four.aniso).toBeCloseTo(40.754313, 4);
    expect(ten.aniso).toBeCloseTo(16.868779, 4);
    expect(fast.aniso).toBeCloseTo(81.766377, 4);

    // The structure holds everywhere; only the size is the lens's.
    for (const c of [four, ten, fast]) {
      expect(c.ratio).toBeGreaterThan(1);
      expect(c.aniso).toBeGreaterThan(1);
    }
    expect(fast.ratio / ten.ratio).toBeCloseTo(3.1812254, 6);
  });
});

describe("§ 6bk.7 — what is structural holds on every lens, and needs no numbers", () => {
  it("a stage scan asks every tile for ONE stage, and the same array serves both geometries", () => {
    // § 6bj's two structural results, re-run on the magnification lever. They
    // follow from the code path rather than from the optics — one field position
    // for every tile, and a per-tile repeating frame that is the same object
    // whichever way the mosaic was acquired — so they were never going to move,
    // and this is the rung that says so instead of eight that re-measure it.
    const options = mosaicOptions(CORRECTED_10(), { centreMm: EDGE, scan: "stage" });
    const mosaic = renderFluorescenceMosaic(TEN, BLANK, options);
    const first = mosaic.tiles[0]!.focusMm;
    for (const tile of mosaic.tiles) {
      expect(tile.focusMm.length).toBe(first.length);
      for (let c = 0; c < first.length; c++) {
        expect(Object.is(tile.focusMm[c], first[c])).toBe(true);
      }
    }
    // The focus correction's FIELD term is therefore exactly zero here, and its
    // COLOUR term is untouched — § 6be.1's two terms, one reachable by a stage.
    expect(spanOf(mosaic.tiles.map((t) => t.focusMm[0]!))).toBe(0);
    expect(spanOf(first as number[])).toBeGreaterThan(0);

    // And the scanner calibration is bitwise the same array in both geometries.
    const field = scannerFlatField(
      renderFluorescenceMosaic(TEN, BLANK, mosaicOptions(CORRECTED_10(), { centreMm: EDGE })),
    );
    const stage = scannerFlatField(mosaic);
    for (let p = 0; p < stage.planes.length; p++) {
      const a = field.planes[p]!;
      const b = stage.planes[p]!;
      expect(a.length).toBe(b.length);
      for (let i = 0; i < a.length; i++) expect(Object.is(a[i], b[i])).toBe(true);
    }
  });
});

describe("§ 6bk.8 — the refusals, and the one that did not name its own fix", () => {
  it("a 10×/0.25 does not exist on this solver, and the refusal says the APERTURE is binding", () => {
    // Why the aperture lever is pulled at 4× and not at 10×. The ceiling is the
    // same at both magnifications, which is itself a small confirmation of § 6w's
    // reading that an objective's glass is sized by NA and field and not by M.
    expect(() => build(10, 0.25)).toThrow(/APERTURE and not the glass pair/);
    expect(() => build(4, 0.25)).toThrow(/APERTURE and not the glass pair/);
    expect(() => build(4, 0.2)).not.toThrow();
    expect(() => build(10, 0.2)).not.toThrow();
  });

  it("the unseeded inverse now names the seed instead of pointing at vignetting", () => {
    // The repair. The bracket opens at the image radius, which is |M| object
    // heights out, so the 10× reports a dead chief ray at a field point it images
    // perfectly well — and the old message sent a caller to look at the field
    // stop. § 6l's lesson was that an identity a caller can get wrong silently is
    // refused rather than documented; this one WAS refused, and said the wrong
    // thing about why.
    expect(() => objectHeightForImageRadius(TEN, ANCHOR, DESIGN)).toThrow(/UNSEEDED/);
    expect(() => objectHeightForImageRadius(TEN, ANCHOR, DESIGN)).toThrow(/magnification/);
    // Seeded, the same query answers — and answers with the height every fixture
    // in this file is built on.
    expect(matched(TEN, ANCHOR)).toBeCloseTo(0.39920498, 7);

    // And a genuinely unreachable radius still refuses when it IS seeded, so the
    // seed did not turn a refusal into a clamp.
    expect(() =>
      objectHeightForImageRadius(TEN, 1e6, DESIGN, { magnification: magOf(TEN) }),
    ).toThrow(/image radius/);
  });

  it("the fast lens's focus sweep refuses, and the unit it refuses in is the whole verdict", () => {
    // `maxPlateauDepths` is a threshold on the OPTICS expressed in depths of
    // focus, and the depth of focus is λ/NA². So doubling the aperture divides
    // the unit by four while the physical plateau does not shrink as fast, and a
    // lens whose axial peak is NARROWER IN MILLIMETRES than the control's is the
    // one that gets refused. Both readings are true and the choice of unit is the
    // entire disagreement — which is why this is pinned rather than tuned away.
    expect(() =>
      renderedBestFocus(FAST, 430, 0, { ...SWEEP, maxPlateauDepths: 1 }),
    ).toThrow(/plateau/);

    const fast = renderedBestFocus(FAST, 430, 0, { ...SWEEP, maxPlateauDepths: 2 });
    const slow = renderedBestFocus(FOUR, 430, 0, { ...SWEEP, maxPlateauDepths: 2 });
    expect(fast.plateauDepths).toBeCloseTo(1.804658, 5);
    expect(slow.plateauDepths).toBeCloseTo(0.869607, 5);
    expect(fast.plateauDepths).toBeGreaterThan(slow.plateauDepths);

    // In millimetres the ordering reverses, and by a factor of nearly two.
    const fastMm = fast.plateauDepths * fast.depthOfFocusMm;
    const slowMm = slow.plateauDepths * slow.depthOfFocusMm;
    expect(fastMm).toBeCloseTo(1.9460897e-2, 8);
    expect(slowMm).toBeCloseTo(3.7587141e-2, 8);
    expect(fastMm).toBeLessThan(slowMm);

    // The axial reading this file pins as a constant is the one that is NOT in
    // doubt: it is the same number whether the threshold admits it narrowly or
    // is opened wide enough to be no threshold at all.
    expect(fast.focusMm).toBeCloseTo(AX20, 9);
    expect(
      renderedBestFocus(FAST, 430, 0, { ...SWEEP, maxPlateauDepths: 1e9 }).focusMm,
    ).toBe(fast.focusMm);
  });

  it("and forcing a field SURFACE through that refusal produces a curve that is not one", () => {
    // The reason the threshold is not simply raised for this lens. At 2 the sweep
    // is admitted and returns a field drop that changes SIGN between its two
    // measured heights, with a separability floor 22× the control's — § 6be's
    // interaction term is meant to be the estimator's noise and here it is most
    // of the signal. The refusal at 1 was the readout working.
    const forced = focusSurface(FAST, {
      ...SWEEP,
      maxPlateauDepths: 2,
      wavelengthsNm: [430, DESIGN],
      objectHeightsMm: [0, H20 / 2, H20],
    });
    const drops = forced.fieldDropMm[0]!;
    expect(drops[1]!).toBeGreaterThan(0);
    expect(drops[2]!).toBeLessThan(0);
    expect(forced.interactionMm).toBeGreaterThan(20 * SURF4().interactionMm);
  });
});
