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
 * § 2r.2: the exit layout, on the located rim (§ 2q.4). Every reading below is
 * on it; where the aim layout's reading is kept beside it, it says so. The
 * step's own header below quotes it as first published, on the aim layout;
 * VALIDATION § 2r.2 lists what moved, and what reversed.
 */
const EXIT = { layout: "exit", edgeSamples: 8, edgeRule: "crossing" } as const;

/**
 * § 2r.3: the registration cost is a stage scan's seam over a FIELD scan's, and
 * on the exit layout a field scan's seam is exactly 0 — every tile reads the
 * anchor's ruler (§ 2i) — so the cost was the aim layout's per-tile ruler drift.
 * It is kept as that layout's readout, on that layout: every seam shift here
 * asks for it.
 */
const SEAM = { layout: "aim" } as const;

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
  ...EXIT,
  peak: "band-limited",
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
    layout: "exit",
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
 * `maxPlateauDepths` of 3 and of 1e9 — so it is pinned as a constant with that
 * provenance rather than recomputed through a readout that will not certify it.
 *
 * § 2r.2: 0.2618676018 on the aim layout, admitted there at 2. The exit layout
 * moves it 0.141 mm — thirteen depths of focus — and its plateau from 1.80 to
 * 2.66 depths, so it is admitted at 3 and not at 2. The rim is not what moves
 * it: the aim layout reads 0.2619 point-sampled and 0.2642 located, the exit
 * 0.1358 and 0.1208. This lens's design-wavelength wavefront and paraxial foci
 * lie 19 mm apart behind it, so where its peak sits depends on how the pupil's
 * zones are weighted, and that is what the layout changes.
 */
const AX20 = 0.1208356486;

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
    ...EXIT,
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
    ...EXIT,
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
    expect(F4_CORR_EDGE().rendered).toBeCloseTo(0.015120893109409818, 7);
    expect(F4_CORR_EDGE().free).toBeCloseTo(0.01294880299314637, 7);
    expect(F4_CORR_EDGE().rendOverFree).toBeCloseTo(1.1677442898523582, 4);
    expect(F4_CORR_AXIS().rendOverFree).toBeCloseTo(1383.141941582124, 3);
    expect(F4_CORR_EDGE().freeGain).toBeCloseTo(55.02939054528365, 1);
    expect(F4_CORR_AXIS().freeGain).toBeCloseTo(1.007039735203195, 4);
    // …and § 6bi's headline that a scanner's own calibration makes it 11% WORSE.
    expect(F4_CORR_EDGE().scannerVsRaw).toBeCloseTo(1.0995244139390026, 5);

    // And § 6bj.5's registration figures, to every digit that step pinned.
    const field = mosaicSeamShiftMm(FOUR, mosaicOptions(AXIAL_4, { ...SEAM, centreMm: EDGE }));
    const stage = mosaicSeamShiftMm(
      FOUR,
      mosaicOptions(AXIAL_4, { ...SEAM, centreMm: EDGE, scan: "stage" }),
    );
    expect(stage.px).toBeCloseTo(0.32896102643146014, 7);
    expect(stage.mm / field.mm).toBeCloseTo(95.7128, 3);
    expect(stage.betweenRowsMm / stage.betweenColumnsMm).toBeCloseTo(40.754312859167435, 3);
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
        layout: "exit",
      });
      return (tile.pixelScaleMm * SIZE) / Math.abs(tile.magnification);
    };
    expect(span(FOUR)).toBeCloseTo(0.09424015506112565, 7);
    expect(span(TEN)).toBeCloseTo(0.09429690028712436, 7);
    expect(span(TEN) / span(FOUR)).toBeCloseTo(1.0006021342596678, 5);
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
    expect(colour4()).toBeCloseTo(0.16081172033414903, 7);
    expect(colour10()).toBeCloseTo(0.05493782316659187, 7);
    expect(field4()).toBeCloseTo(0.06013442900749552, 7);
    expect(field10()).toBeCloseTo(0.025931110614440034, 7);

    expect(colour4() / field4()).toBeCloseTo(2.6742038294585697, 5);
    expect(colour10() / field10()).toBeCloseTo(2.118606641398503, 5);
    expect(colour4() / field4() / (colour10() / field10())).toBeCloseTo(1.2622465054170293, 5);
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
    expect(ratio4).toBeCloseTo(1.9449910355286741, 5);
    expect(ratio10).toBeCloseTo(0.3945293909944909, 5);
    expect(ratio4 / ratio10).toBeCloseTo(4.929901497644908, 4);
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
    expect(SURF4().interactionMm).toBeCloseTo(0.008782488635683483, 8);
    expect(SURF10().interactionMm).toBeCloseTo(0.0010104607615383024, 8);
    expect(SURF4().interactionMm / SURF10().interactionMm).toBeCloseTo(8.691563076541543, 5);
  });
});

describe("§ 6bk.4 — the guard band is APERTURE's, and the prediction was backwards", () => {
  it("twice the aperture leaks 9.53× MORE past a tile's own frame, not less (11.94× on the aim layout)", () => {
    // Predicted: the blur is λ/NA, so a faster lens forms a tighter spot and
    // should keep more of it inside the frame. Measured: the opposite, by an
    // order of magnitude. What escapes is not the diffraction pattern's width
    // but the out-of-focus content of the slab, and the SAME ±0.008 mm of
    // specimen is 0.37 depths of focus at NA 0.10 and 1.48 at NA 0.20. § 6bh
    // read this on one lens and could not have seen which of the two it was.
    const slow = escaped(FOUR, 430, H4, EDGE, SURF4().colourMm[0]!);
    const fast = escaped(FAST, 430, H20, EDGE, AX20);
    expect(slow).toBeCloseTo(0.06443157661795051, 7);
    expect(fast).toBeCloseTo(0.6142572956786506, 7);
    expect(fast / slow).toBeCloseTo(9.533485238687573, 5);
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
    expect(four).toBeCloseTo(0.11051389272596401, 7);
    expect(ten).toBeCloseTo(0.026190151012319807, 7);
    expect(four / ten).toBeCloseTo(4.219673749646516, 5);
  });

  it("and § 6bg's correction still buys the most where the escape is largest", () => {
    // The one thing about the guard band that DOES travel: correcting the stage
    // always helps, on every lens. § 6bh measured 4.31× on the control at its
    // own anchor; here the same readout at a matched radius reads 2.68×, 1.20×
    // and 1.05×. On the aim layout it read 3.14×, 1.15× and 1.19×, ordered by
    // how far each lens's nominal stage sat from its best focus; § 2r.2: that
    // ordering does not survive — the fast lens's axial focus is 0.121 mm out
    // and the 10×'s 0.063 mm (§ 6bm), and the fast lens gains the least.
    const nominal4 = escaped(FOUR, 430, H4, EDGE, 0);
    const nominal10 = escaped(TEN, 430, H10, EDGE, 0);
    const nominal20 = escaped(FAST, 430, H20, EDGE, 0);
    expect(nominal4).toBeCloseTo(0.29565502631807605, 7);
    expect(nominal10).toBeCloseTo(0.03141035627302369, 7);
    expect(nominal20).toBeCloseTo(0.6473805218197384, 7);

    const corrected4 = escaped(FOUR, 430, H4, EDGE, predictedFocusMm(SURF4(), 430, H4));
    const corrected10 = escaped(TEN, 430, H10, EDGE, predictedFocusMm(SURF10(), 430, H10));
    const corrected20 = escaped(FAST, 430, H20, EDGE, AX20);
    expect(nominal4 / corrected4).toBeCloseTo(2.6752747462366346, 5);
    expect(nominal10 / corrected10).toBeCloseTo(1.1993194028643936, 5);
    expect(nominal20 / corrected20).toBeCloseTo(1.0539240256063904, 5);
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
    expect(F4_AX_AXIS().rendOverFree / F4_CORR_AXIS().rendOverFree).toBeCloseTo(1.001389553686291, 5);
    expect(F4_AX_EDGE().rendOverFree / F4_CORR_EDGE().rendOverFree).toBeCloseTo(0.9998014271451009, 7);
    expect(Math.abs(F4_AX_AXIS().rendOverFree / F4_CORR_AXIS().rendOverFree - 1)).toBeLessThan(2e-3);
    expect(Math.abs(F4_AX_EDGE().rendOverFree / F4_CORR_EDGE().rendOverFree - 1)).toBeLessThan(2e-3);
  });

  it("on the axis the two flat fields differ 1385× at NA 0.10 and 1.42× at NA 0.20 — they coincided on the aim layout", () => {
    // § 6bi.3's headline was that on the axis the rendered and free fields swap
    // rank outright, 1193×, because the throughput is even in field radius and
    // therefore flat there while the rasterizer's Jacobian is not. Double the
    // aperture and the throughput is no longer flat near the axis at all: the two
    // fields land on top of each other, and the free one — which § 6bi called
    // exact for the pupil and useless on the axis — becomes the whole correction.
    //
    // § 2r.2 WEAKENED. On the aim layout the NA 0.20 split was 0.99933 — the
    // two fields coincided, a 1195× collapse. On the exit layout it is 1.416:
    // the aperture still collapses the split 978×, and the two fields no longer
    // land on top of each other. (1.857 and 657× until § 2u: the density's fit
    // had dropped its off-axis rim nodes, and the axial split is a residue.)
    expect(F4_AX_AXIS().rendOverFree).toBeCloseTo(1385.0696624191917, 3);
    expect(F20_AX_AXIS().rendOverFree).toBeCloseTo(1.4159142921470034, 7);
    expect(F4_AX_AXIS().rendOverFree / F20_AX_AXIS().rendOverFree).toBeGreaterThan(600);
    expect(F20_AX_AXIS().rendOverFree).toBeGreaterThan(1.4);
  });

  it("and at the edge it no longer inverts — 1.17× at NA 0.10 against 1.83× at NA 0.20 (64.70× on the aim layout)", () => {
    // On the aim layout this was the other half of the same inversion, and the
    // reason it was an inversion rather than a scaling: the slow lens's split
    // was nearly all pupil at the edge and nearly all rasterizer on the axis,
    // and the fast lens the other way round in both places. § 2r.2 REVERSED:
    // on the exit layout the fast lens's split is 1.42 on the axis and 1.83 at
    // the edge — within 1.3× of each other — so the aperture collapses the axial
    // split and leaves the edge one within 1.6× of the slow lens's. (1.86 and
    // 1.96, "the same at both", until § 2u.)
    expect(F4_AX_EDGE().rendOverFree).toBeCloseTo(1.1675135979980493, 6);
    expect(F20_AX_EDGE().rendOverFree).toBeCloseTo(1.8285496913259278, 5);
    expect(F20_AX_EDGE().rendOverFree / F4_AX_EDGE().rendOverFree).toBeCloseTo(1.5661917172909268, 5);
    expect(F20_AX_EDGE().rendOverFree / F20_AX_AXIS().rendOverFree).toBeLessThan(1.3);
  });

  it("and MAGNIFICATION barely touches it — 1.09× across the 2.5× (1.136× on the aim layout)", () => {
    // Against the aperture's thousandfold, on the same readout at the same field
    // positions. This is what § 6bk.2's separation buys: the split is a property
    // of the aperture and not of the objective's power.
    expect(F10_CORR_AXIS().rendOverFree).toBeCloseTo(1508.9125068175138, 3);
    expect(F10_CORR_AXIS().rendOverFree / F4_CORR_AXIS().rendOverFree).toBeCloseTo(1.0909310617039967, 5);
    expect(F10_CORR_EDGE().rendOverFree).toBeCloseTo(1.1547558095010866, 6);
  });

  it("and the free field's axial and edge ROLES swapped with aperture on the aim layout — on the exit, the fast lens is 3–4× everywhere", () => {
    // The most quotable consequence, because it is the sentence a caller would
    // act on. On the control, a free flat field is worth nothing on the axis and
    // 72× at the edge (189× on the aim layout), so § 6bi concluded a calibration
    // is an edge-of-field instrument. On the aim layout twice the aperture made
    // that exactly backwards: 1394× on the axis, 1.021× at the edge.
    //
    // § 2r.2 REVERSED. On the exit layout the fast lens's free field buys 4.07×
    // on the axis and 2.97× at the edge: it helps everywhere, within 1.4× of
    // equally, so there is no swap — the control's split is an edge-of-field one
    // and the fast lens's is not split by anything like it. (2.76× and 2.52×,
    // "about equally", until § 2u.)
    expect(F4_AX_AXIS().freeGain).toBeCloseTo(1.007015373172117, 6);
    expect(F4_AX_EDGE().freeGain).toBeCloseTo(71.87243048996875, 4);
    expect(F20_AX_AXIS().freeGain).toBeCloseTo(4.066072733732504, 3);
    expect(F20_AX_EDGE().freeGain).toBeCloseTo(2.9731424820942416, 6);
    expect(F4_AX_EDGE().freeGain / F4_AX_AXIS().freeGain).toBeGreaterThan(70);
    expect(F20_AX_AXIS().freeGain / F20_AX_EDGE().freeGain).toBeLessThan(1.4);
    expect(F20_AX_AXIS().freeGain).toBeGreaterThan(2.5);
    expect(F20_AX_EDGE().freeGain).toBeGreaterThan(2.5);
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
    expect(F20_AX_AXIS().scannerVsRaw).toBeCloseTo(1.000896563934938, 6);
    expect(F20_AX_EDGE().scannerVsRaw).toBeCloseTo(1.1339198384323084, 6);
    expect(F10_CORR_AXIS().scannerVsRaw).toBeCloseTo(1.1759964719379172, 6);
    expect(F10_CORR_EDGE().scannerVsRaw).toBeCloseTo(1.0960895892787776, 6);
    const sizes = all.map((f) => f.scannerVsRaw);
    expect(Math.max(...sizes) / Math.min(...sizes)).toBeCloseTo(1.1749430208904372, 5);
  });

  it("and § 6bj's registration cost is the lens's — 41.8× to 132.9× over the three", () => {
    // § 6bj measured 95.71× on the control and explained it structurally: a square
    // stage lattice cannot abut a radial map in both directions at once. The
    // explanation travels — every lens pays, and every lens pays more across than
    // along — but the number is a third to a half again of the control's, and it
    // does not collapse at a matched image radius the way § 6bk.3's terms did.
    const cost = (system: OpticalSystem, stage: TileStageMm) => {
      const field = mosaicSeamShiftMm(system, mosaicOptions(stage, { ...SEAM, centreMm: EDGE }));
      const scan = mosaicSeamShiftMm(
        system,
        mosaicOptions(stage, { ...SEAM, centreMm: EDGE, scan: "stage" }),
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
    //
    // § 2r.2: on the aim layout the fast lens was admitted at 2, with a plateau
    // of 1.804658 depths against the control's 0.869607. On the exit layout it
    // is 2.657 and refused at 2 as well — so the comparison below is read at 3.
    expect(() =>
      renderedBestFocus(FAST, 430, 0, { ...SWEEP, maxPlateauDepths: 1 }),
    ).toThrow(/plateau/);
    expect(() =>
      renderedBestFocus(FAST, 430, 0, { ...SWEEP, maxPlateauDepths: 2 }),
    ).toThrow(/2\.6572/);

    const fast = renderedBestFocus(FAST, 430, 0, { ...SWEEP, maxPlateauDepths: 3 });
    const slow = renderedBestFocus(FOUR, 430, 0, { ...SWEEP, maxPlateauDepths: 3 });
    expect(fast.plateauDepths).toBeCloseTo(2.6572556249247663, 5);
    expect(slow.plateauDepths).toBeCloseTo(0.8393537667713457, 5);
    expect(fast.plateauDepths).toBeGreaterThan(slow.plateauDepths);

    // In millimetres the ordering reverses, and by a factor of nearly two.
    const fastMm = fast.plateauDepths * fast.depthOfFocusMm;
    const slowMm = slow.plateauDepths * slow.depthOfFocusMm;
    expect(fastMm).toBeCloseTo(0.028655060391486194, 8);
    expect(slowMm).toBeCloseTo(0.03627950184664337, 8);
    expect(fastMm).toBeLessThan(slowMm);

    // The axial reading this file pins as a constant is the one that is NOT in
    // doubt: it is the same number whether the threshold admits it narrowly (3,
    // on this layout) or is opened wide enough to be no threshold at all.
    expect(fast.focusMm).toBeCloseTo(AX20, 9);
    expect(
      renderedBestFocus(FAST, 430, 0, { ...SWEEP, maxPlateauDepths: 1e9 }).focusMm,
    ).toBe(fast.focusMm);
  });

  it("and forcing a field SURFACE through that refusal produced a curve that was not one — on the aim layout", () => {
    // The reason the threshold was not simply raised for this lens. On the aim
    // layout, at 2 the sweep was admitted and returned a field drop that changed
    // SIGN between its two measured heights, with a separability floor 22× the
    // control's — § 6be's interaction term is meant to be the estimator's noise
    // and there it was most of the signal.
    //
    // § 2r.2 REVERSED. On the exit layout, at 3, the forced surface is a curve:
    // its drops are monotone and negative, −0.0176 and −0.0555 mm, and its
    // interaction term is 1.57× the control's and a quarter of the field drop —
    // § 6bm.7's corner's signature (0.213), not this lens's old one. So on this
    // layout the refusal rests on the plateau's width alone.
    const forced = focusSurface(FAST, {
      ...SWEEP,
      maxPlateauDepths: 3,
      wavelengthsNm: [430, DESIGN],
      objectHeightsMm: [0, H20 / 2, H20],
    });
    const drops = forced.fieldDropMm[0]!;
    expect(drops[1]!).toBeCloseTo(-0.01758933525844189, 9);
    expect(drops[2]!).toBeCloseTo(-0.055513893107703965, 9);
    expect(drops[1]!).toBeLessThan(0);
    expect(drops[2]!).toBeLessThan(drops[1]!);
    expect(forced.interactionMm / SURF4().interactionMm).toBeCloseTo(1.57233812952735, 5);
    expect(forced.interactionMm).toBeLessThan(2 * SURF4().interactionMm);
    expect(forced.interactionMm / Math.abs(drops[2]!)).toBeCloseTo(0.2487491682431725, 4);
  });
});
