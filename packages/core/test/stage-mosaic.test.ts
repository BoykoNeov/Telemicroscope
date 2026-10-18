import { describe, it, expect } from "vitest";
import {
  fluorescenceMosaicGeometry,
  fluorescenceMosaicPitchDriftPx,
  renderFluorescenceMosaic,
  mosaicSeamShiftMm,
  composeTileFrame,
  type FluorescenceMosaicOptions,
} from "../src/imaging/fluorescence-mosaic";
import {
  renderedFlatField,
  throughputFlatField,
  scannerFlatField,
  flatFieldCorrect,
  mosaicSeamStep,
} from "../src/imaging/mosaic-flat-field";
import { focusCorrectedTiles, surfaceStage } from "../src/imaging/focus-tiles";
import { focusSurface, type FocusProbe, type FocusSweepOptions } from "../src/imaging/focus-surface";
import {
  labelledVolumeEmitters,
  type SpectralVolumeEmitterDensity,
} from "../src/imaging/spectral-volume";
import { gaussianBallEmitter, uniformSlabs, type EmitterSlabs } from "../src/imaging/emitter-volume";
import { boxcarBand } from "../src/imaging/emission";
import { finiteConjugateMicroscope, finiteConjugateObjective } from "../src/designs/microscope";

/**
 * § 2r.2: the exit layout, on the located rim (§ 2q.4). Every reading below is
 * on it; where the aim layout's reading is kept beside it, it says so. The
 * step's own header below quotes it as first published, on the aim layout;
 * VALIDATION § 2r.2 lists what moved, and what reversed.
 */
const EXIT = { layout: "exit", edgeSamples: 8, edgeRule: "crossing" } as const;

/**
 * § 6bj — the stage-scanning mosaic, and the geometry § 6bi left open.
 *
 * Every mosaic on this branch so far holds the specimen still and walks the tile
 * across the objective's field. A real slide scanner does the opposite: the
 * optics are fixed and the **stage** moves, so every tile is formed at the same
 * field position and what changes between tiles is which part of the slide is
 * under the lens. `scan: "stage"` is that geometry, and the two are opposites
 * rather than variants.
 *
 * **One sentence generates every rung below.** A field scan spreads a
 * field-dependent quantity across the picture as a gradient; a stage scan
 * collapses it to one constant, chosen by the anchor. Uniform is not the same as
 * good: on the axis the constant is the best value available, and at the edge of
 * the field it is a mediocre one applied everywhere.
 *
 * - **Focus.** One field height, so field curvature asks every tile for the same
 *   stage: the nine tiles' stages are `Object.is`-equal and § 6bh.5's seam focus
 *   step is exactly zero. What survives is the *colour* term, so the two
 *   geometries are § 6be.1's two terms and choosing one chooses which of them a
 *   stage can reach (§ 6bj.3).
 * - **Brightness.** `throughputFlatField` — 85% of the correction in § 6bi.3 —
 *   goes flat and buys nothing, while the per-tile repeating frame that made
 *   § 6bi's mosaic **11% worse** is exactly right here. And it is the *same
 *   array*: a field scan's scanner calibration is bitwise the stage scan's true
 *   one (§ 6bj.4).
 * - **Aberration.** Every tile reports the anchor tile's own kernel, bit for bit
 *   — better than the field scan's worst tile and worse than its best (§ 6bj.6).
 * - **Geometry, and this is what it costs.** A field scan's tiles are adjacent
 *   windows on one continuous traced map and, on the exit layout, abut exactly
 *   (3.4e-3 of a pixel on the aim layout, its per-tile ruler — § 2r.3); a stage
 *   scan repeats one tile's map, so a **square** stage lattice meets a **radial**
 *   map and the seam carries a third of a pixel — 40.6× more across the
 *   direction the pitch was not fitted to (§ 6bj.5).
 *
 * External numbers: § 6bi.2's seam and § 6bi.3's two flat fields (6.5373e-3,
 * 1.2949e-2 / 1.5121e-2 on the exit layout since § 2r.2; 5.2943e-3, 1.1831e-2 /
 * 1.3870e-2 on the aim layout), reproduced here as the field-scan control; § 6bh.5's 6.6808e-3 mm
 * seam focus step, which the field scan's outer seam reproduces exactly; § 6m.4's
 * anisotropy of the traced map; § 6be.1's separation of best focus into a colour
 * term and a field term.
 */

const DESIGN = 587.5618;
const RED = 656.2725;

const SYSTEM = finiteConjugateMicroscope({
  objective: finiteConjugateObjective({ magnification: 4, numericalAperture: 0.1 }),
}).system;

/** § 6bh's tile and § 6bi's fixture, unchanged, so the control is theirs. */
const SIZE = 128;
const PS = 32;
const THIN: EmitterSlabs = { depthsMm: [0], thicknessMm: [0.016] };

const SAMPLES = [
  { nm: 430, weight: 1 },
  { nm: DESIGN, weight: 1 },
  { nm: RED, weight: 1 },
];

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
  ...EXIT,
  peak: "band-limited",
};
const SURFACE = focusSurface(SYSTEM, {
  ...SWEEP,
  wavelengthsNm: [430, DESIGN, RED],
  objectHeightsMm: [0, 0.275, 0.55, 1.1],
});

/** The featureless specimen a blank calibration slide stands for. */
const BLANK: SpectralVolumeEmitterDensity = labelledVolumeEmitters([
  { density: () => 1, band: boxcarBand(400, 700) },
]);

function mosaicOptions(over: Partial<FluorescenceMosaicOptions> = {}): FluorescenceMosaicOptions {
  return {
    size: SIZE,
    pupilSamples: PS,
    slabs: THIN,
    samples: SAMPLES,
    tiles: 3,
    guardCells: 4,
    stageMm: surfaceStage(SURFACE),
    ...EXIT,
    ...over,
  };
}

/** § 6bi's anchors: 4 mm of image is 1.0009 mm of field. */
const EDGE = { x: 4, y: 0 };
const AXIS = { x: 0, y: 0 };

const AXIS_FIELD = mosaicOptions({ centreMm: AXIS });
const AXIS_STAGE = mosaicOptions({ centreMm: AXIS, scan: "stage" });
const EDGE_FIELD = mosaicOptions({ centreMm: EDGE });
const EDGE_STAGE = mosaicOptions({ centreMm: EDGE, scan: "stage" });

const AXIS_FIELD_GEOMETRY = fluorescenceMosaicGeometry(SYSTEM, AXIS_FIELD);
const AXIS_STAGE_GEOMETRY = fluorescenceMosaicGeometry(SYSTEM, AXIS_STAGE);
const EDGE_FIELD_GEOMETRY = fluorescenceMosaicGeometry(SYSTEM, EDGE_FIELD);
const EDGE_STAGE_GEOMETRY = fluorescenceMosaicGeometry(SYSTEM, EDGE_STAGE);

const AXIS_FIELD_BLANK = renderFluorescenceMosaic(SYSTEM, BLANK, AXIS_FIELD);
const AXIS_STAGE_BLANK = renderFluorescenceMosaic(SYSTEM, BLANK, AXIS_STAGE);
const EDGE_FIELD_BLANK = renderFluorescenceMosaic(SYSTEM, BLANK, EDGE_FIELD);
const EDGE_STAGE_BLANK = renderFluorescenceMosaic(SYSTEM, BLANK, EDGE_STAGE);

/** Every value of every plane, for the bitwise comparisons. */
function allPixelsEqual(a: readonly Float64Array[], b: readonly Float64Array[]): boolean {
  if (a.length !== b.length) return false;
  for (let p = 0; p < a.length; p++) {
    if (a[p]!.length !== b[p]!.length) return false;
    for (let i = 0; i < a[p]!.length; i++) if (!Object.is(a[p]![i], b[p]![i])) return false;
  }
  return true;
}

describe("§ 6bj.1 — a field scan is § 6bi's mosaic, bit for bit", () => {
  const explicit = mosaicOptions({ centreMm: EDGE, scan: "field" });
  const rendered = renderFluorescenceMosaic(SYSTEM, BLANK, explicit);

  it("names the default and changes nothing by being named", () => {
    expect(EDGE_FIELD_GEOMETRY.scan).toBe("field");
    expect(fluorescenceMosaicGeometry(SYSTEM, explicit).scan).toBe("field");
    expect(
      allPixelsEqual(
        rendered.composed.planes.map((p) => p.intensity),
        EDGE_FIELD_BLANK.composed.planes.map((p) => p.intensity),
      ),
    ).toBe(true);
    for (let k = 0; k < rendered.tiles.length; k++) {
      expect(
        allPixelsEqual(
          rendered.tiles[k]!.volume.planes.map((p) => p.intensity),
          EDGE_FIELD_BLANK.tiles[k]!.volume.planes.map((p) => p.intensity),
        ),
      ).toBe(true);
    }
  });

  it("and the specimen never moves, so every tile is handed the SAME zero", () => {
    // Not merely nine equal offsets: one shared object, so the renderer's
    // `x === 0 && y === 0` test hands `focusCorrectedTiles` the caller's own
    // density by reference rather than a wrapper that adds zero. `-0 + 0` is
    // `+0`, so a wrapper is not the identity and the bitwise rung above would be
    // a claim about this density rather than about the arithmetic.
    const first = EDGE_FIELD_GEOMETRY.offsetsMm[0]!;
    expect(EDGE_FIELD_GEOMETRY.offsetsMm.every((o) => o === first)).toBe(true);
    expect(first).toEqual({ x: 0, y: 0 });
    expect(EDGE_FIELD_GEOMETRY.stagePitchMm).toBe(0);
    expect(EDGE_FIELD_BLANK.tiles.every((t) => t.offsetMm === first)).toBe(true);

    // …and the tile centres are the expressions § 6bh wrote, not new ones.
    expect(EDGE_FIELD_GEOMETRY.centresMm[0]!.x).toBe(EDGE.x - EDGE_FIELD_GEOMETRY.pitchMm);
    expect(EDGE_FIELD_GEOMETRY.centresMm[4]!.x).toBe(EDGE.x);
    expect(EDGE_FIELD_GEOMETRY.pitchMm).toBe(
      EDGE_FIELD_GEOMETRY.pitchPixels * EDGE_FIELD_GEOMETRY.pixelScaleMm,
    );
  });
});

describe("§ 6bj.2 — the stage pitch is the MAP's and not the ruler's", () => {
  it("holds one field position and moves the slide instead", () => {
    const g = EDGE_STAGE_GEOMETRY;
    expect(g.scan).toBe("stage");
    expect(g.centresMm.every((c) => c === g.centresMm[0])).toBe(true);
    expect(g.centresMm[0]).toEqual(EDGE);
    // Row-major from −x, −y, the same order the picture is composed in.
    expect(g.offsetsMm.map((o) => o.x / g.stagePitchMm)).toEqual([-1, 0, 1, -1, 0, 1, -1, 0, 1]);
    expect(g.offsetsMm.map((o) => o.y / g.stagePitchMm)).toEqual([-1, -1, -1, 0, 0, 0, 1, 1, 1]);
    // The centre tile of an odd mosaic does not move at all, so it is the plain
    // render bit for bit — the same reference-not-wrapper argument as § 6bj.1.
    expect(g.offsetsMm[4]!.x).toBe(0);
    expect(g.offsetsMm[4]!.y).toBe(0);
    expect(EDGE_STAGE_BLANK.tiles[4]!.offsetMm.x).toBe(0);
  });

  it("and the linear reference is a magnification where the pitch is a MAP", () => {
    // `pitchPixels · objectPixelScaleMm` is what a magnification would say the
    // tiles are apart on the slide. What has to abut is the object distance
    // between the object points the kept span's own ends look at, and the two
    // differ by the anchor's own distortion.
    const axis = AXIS_STAGE_GEOMETRY;
    const edge = EDGE_STAGE_GEOMETRY;
    const departure = (g: typeof axis): number =>
      g.stagePitchMm / (g.pitchPixels * g.objectPixelScaleMm) - 1;

    expect(axis.stagePitchMm).toBeCloseTo(0.05059555601389658, 12);
    expect(departure(axis)).toBeCloseTo(-0.0000010598329203137524, 12);
    expect(edge.stagePitchMm).toBeCloseTo(0.05033605077083214, 12);
    expect(departure(edge)).toBeCloseTo(-0.005130066972617753, 9);

    // 4879× more distortion at the edge of the field than on the axis, and in
    // the units that matter it is half a pixel per tile step — so a three-tile
    // mosaic laid out on the linear ruler ends a whole pixel out.
    expect(departure(edge) / departure(axis)).toBeCloseTo(4840.448786115316, 1);
    const perStepPx =
      (edge.pitchPixels * edge.objectPixelScaleMm - edge.stagePitchMm) / edge.objectPixelScaleMm;
    expect(perStepPx).toBeCloseTo(0.48222629542606865, 6);
  });

  it("and the slide really MOVES — in that direction, by that amount", () => {
    // Every other rung on this step renders a uniform specimen, and a uniform
    // density is translation-invariant: drop the density wrapper, flip its sign
    // or swap its axes and all of them stay green. This is the one that cannot.
    // Two balls one stage pitch apart on the slide must land one PITCH apart in
    // the picture, in tiles 1 and 2 and not 1 and 0. `centreObjectMm`'s own
    // warning — "a mosaic mirrored about the axis, with every rung in § 6m still
    // green" — is exactly this failure mode one module up.
    const g = EDGE_STAGE_GEOMETRY;
    const anchorObjectMm =
      EDGE_STAGE_BLANK.tiles[4]!.volume.planes[g.rulerIndex]!.frame.centreObjectMm;
    const ball = (x: number, y: number) =>
      gaussianBallEmitter({
        waistMm: 0.004,
        axialWaistMm: 0.004,
        peak: 1,
        centreMm: { x, y, z: 0 },
      });
    const here = ball(anchorObjectMm.x, anchorObjectMm.y);
    const right = ball(anchorObjectMm.x + g.stagePitchMm, anchorObjectMm.y);
    const pair: SpectralVolumeEmitterDensity = labelledVolumeEmitters([
      {
        density: (xMm, yMm, zMm) => here(xMm, yMm, zMm) + right(xMm, yMm, zMm),
        band: boxcarBand(400, 700),
      },
    ]);
    const mosaic = renderFluorescenceMosaic(SYSTEM, pair, EDGE_STAGE);
    const plane = mosaic.composed.planes[g.rulerIndex]!;

    // Centroids taken inside one tile's own kept span, so the two balls are read
    // apart by geometry rather than by a threshold.
    const centroidIn = (col: number): { x: number; y: number; total: number } => {
      let sx = 0;
      let sy = 0;
      let total = 0;
      for (let r = 0; r < g.size; r++) {
        for (let c = col * g.pitchPixels; c < col * g.pitchPixels + g.keptPixels; c++) {
          const v = plane.intensity[r * g.size + c]!;
          sx += v * c;
          sy += v * r;
          total += v;
        }
      }
      return { x: sx / total, y: sy / total, total };
    };
    const middle = centroidIn(1);
    const rightTile = centroidIn(2);

    // The ball that is +x on the SLIDE is +x in the picture, exactly one pitch
    // over — and exactly, because a stage scan gives both tiles the identical
    // PSF, so whatever the off-axis kernel does to a centroid it does twice.
    expect(rightTile.x - middle.x).toBeCloseTo(g.pitchPixels, 6);
    expect(rightTile.y).toBeCloseTo(middle.y, 6);
    // …and the third tile is dark, so that separation is two balls and not one
    // ball found twice: a mirrored stage would have put the second one here.
    expect(centroidIn(0).total / middle.total).toBeLessThan(1e-6);
  });

  it("and a one-tile stage scan is the plain render, bit for bit", () => {
    const one = mosaicOptions({ centreMm: EDGE, tiles: 1, scan: "stage" });
    const g = fluorescenceMosaicGeometry(SYSTEM, one);
    expect(g.offsetsMm).toEqual([{ x: 0, y: 0 }]);
    const stage = renderFluorescenceMosaic(SYSTEM, BLANK, one);
    const field = renderFluorescenceMosaic(
      SYSTEM,
      BLANK,
      mosaicOptions({ centreMm: EDGE, tiles: 1 }),
    );
    expect(
      allPixelsEqual(
        stage.composed.planes.map((p) => p.intensity),
        field.composed.planes.map((p) => p.intensity),
      ),
    ).toBe(true);
  });
});

describe("§ 6bj.3 — the focus correction's FIELD term is gone and its COLOUR term is not", () => {
  const blue = (m: typeof EDGE_FIELD_BLANK): number[] => m.tiles.map((t) => t.focusMm[0]!);

  it("asks every tile for the same stage, bitwise", () => {
    const stages = blue(EDGE_STAGE_BLANK);
    expect(stages.every((s) => Object.is(s, stages[0]))).toBe(true);
    expect(stages[0]).toBeCloseTo(0.14264485687879946, 12);
    // …which is exactly the stage the field scan gives its own centre tile.
    expect(Object.is(stages[0], blue(EDGE_FIELD_BLANK)[4])).toBe(true);
  });

  it("where a field scan racks it a whole seam step per tile", () => {
    const field = blue(EDGE_FIELD_BLANK);
    const span = Math.max(...field) - Math.min(...field);
    expect(span).toBeCloseTo(0.0132014845972791, 10);
    // The OUTER of the row's two seams reproduces § 6bh.5's 6.6808e-3 mm (6.8737e-3 on the aim layout) — the
    // same quantity on the same fixture, measured there one seam at a time — and
    // the inner one is 5% smaller, because the focus surface is not linear
    // across a tile and a mosaic's steps are samples of a curve, not a slope.
    expect(field[3]! - field[4]!).toBeCloseTo(0.006356333263828451, 10);
    expect(field[4]! - field[5]!).toBeCloseTo(0.006680791281394205, 10);
    expect(Math.max(...blue(EDGE_STAGE_BLANK)) - Math.min(...blue(EDGE_STAGE_BLANK))).toBe(0);

    // And it is a FIELD quantity: on the axis the same field scan racks 37.8×
    // less, because the focus surface is flat there (§ 6bd.3's evenness again).
    const axis = blue(AXIS_FIELD_BLANK);
    const axisSpan = Math.max(...axis) - Math.min(...axis);
    expect(axisSpan).toBeCloseTo(0.00034671318658460737, 11);
    expect(span / axisSpan).toBeCloseTo(38.07609605888925, 3);
    expect(Math.max(...blue(AXIS_STAGE_BLANK)) - Math.min(...blue(AXIS_STAGE_BLANK))).toBe(0);
  });

  it("and what is left is the colour term, which no geometry reaches", () => {
    // `stageSpreadMm` is over tiles AND channels, so the stage scan's is the
    // axial-colour spread alone — § 6be.1's other term, a property of the glass
    // and not of the field, and the reason a stage scan still needs `exposures`.
    expect(EDGE_STAGE_BLANK.stageSpreadMm).toBeCloseTo(0.16046251422038463, 11);
    expect(EDGE_FIELD_BLANK.stageSpreadMm).toBeCloseTo(0.1736257958047898, 11);
    expect(EDGE_FIELD_BLANK.stageSpreadMm / EDGE_STAGE_BLANK.stageSpreadMm).toBeCloseTo(1.0820333748873352, 5);
    expect(AXIS_STAGE_BLANK.stageSpreadMm).toBeCloseTo(0.1608117203341495, 11);
    expect(EDGE_STAGE_BLANK.exposures).toBe(27);
  });
});

describe("§ 6bj.4 — the flat field inverts: the free one goes flat, the scanner's becomes exact", () => {
  const edgeFree = throughputFlatField(EDGE_STAGE_BLANK);
  const edgeScanner = scannerFlatField(EDGE_STAGE_BLANK);
  const edgeRendered = renderedFlatField(SYSTEM, BLANK, EDGE_STAGE);

  it("the free field buys nothing, because one pupil forms every tile", () => {
    // One scalar per tile off `patchThroughput`, and a stage scan images every
    // tile through the same pupil — so the nine scalars are one number, the
    // field is constant, and normalising to unit mean leaves 1.
    const throughput = EDGE_STAGE_BLANK.tiles.map((t) => t.volume.planes[0]!.patchThroughput[0]!);
    expect(throughput.every((v) => Object.is(v, throughput[0]))).toBe(true);
    expect(edgeFree.span).toBe(0);
    // Flat to 1.9e-12 rather than to the bit, and the residue is arithmetic and
    // not optics: `span` — a max less a min — is EXACTLY zero, and what is left
    // is the error in summing 66564 equal values to get the mean it divides by.
    let worst = 0;
    for (const plane of edgeFree.planes) for (const v of plane) worst = Math.max(worst, Math.abs(v - 1));
    expect(worst).toBeLessThan(2e-12);
    // Against § 6bi.3's 1.2949e-2 (1.1831e-2 on the aim layout) for the same anchor under a field scan.
    expect(throughputFlatField(EDGE_FIELD_BLANK).span).toBeCloseTo(0.012948745076020495, 9);

    // Dividing by it moves the seam by 7e-13 of itself — nothing, where § 6bi.4
    // measured the same division taking 121× off a field scan's seam.
    const before = mosaicSeamStep(EDGE_STAGE_BLANK.composed, EDGE_STAGE_GEOMETRY);
    const after = mosaicSeamStep(
      flatFieldCorrect(EDGE_STAGE_BLANK.composed, edgeFree),
      EDGE_STAGE_GEOMETRY,
    );
    // 6.608e-13 was the reading. It is not a quantity — it is the rounding left
    // over when a frame is divided by one that equals it to the last few bits,
    // and its digits are the platform's summation order rather than any optics.
    // The claim in the sentence above is "nothing", so that is what is asserted:
    // it is under a part in 10¹¹, three orders below the 121× that § 6bi.4's
    // field scan gave up to the same division.
    expect(Math.abs(after.acrossSeam / before.acrossSeam - 1)).toBeLessThan(1e-11);
  });

  it("and the scanner's per-tile frame is the calibration, exactly", () => {
    expect(
      allPixelsEqual(edgeScanner.planes as Float64Array[], edgeRendered.planes as Float64Array[]),
    ).toBe(true);
    const after = mosaicSeamStep(
      flatFieldCorrect(EDGE_STAGE_BLANK.composed, edgeScanner),
      EDGE_STAGE_GEOMETRY,
    );
    expect(after.acrossSeam).toBe(0);
    expect(after.maxAdjacent).toBe(0);
  });

  it("and it is the SAME ARRAY a field scan's scanner field is — the verdict is the geometry's", () => {
    // § 6bi.4 divides a field scan by exactly this and makes its seam 11.0%
    // WORSE. The picture a scanner acquires does not know which geometry it is
    // in; what changes is whether the profile it carries repeats per tile.
    expect(
      allPixelsEqual(
        scannerFlatField(EDGE_FIELD_BLANK).planes as Float64Array[],
        edgeRendered.planes as Float64Array[],
      ),
    ).toBe(true);
  });

  it("and what is left to correct is 9.4× smaller than a field scan's, and is the map", () => {
    // 9.41× on the exit layout's located rim (§ 2r.2); 7.60× on the aim layout's
    // point-sampled one.
    const stage = mosaicSeamStep(EDGE_STAGE_BLANK.composed, EDGE_STAGE_GEOMETRY);
    const field = mosaicSeamStep(EDGE_FIELD_BLANK.composed, EDGE_FIELD_GEOMETRY);
    expect(stage.acrossSeam).toBeCloseTo(0.0006950060546880257, 10);
    expect(field.acrossSeam).toBeCloseTo(0.006537335922888002, 9);
    expect(field.acrossSeam / stage.acrossSeam).toBeCloseTo(9.40615679358719, 4);
    // The residue is the rasterizer's Jacobian and nothing of the glass, which
    // is why § 6bi.3's axial swap is the whole picture here: 1.512e-2 for a
    // field scan against 6.995e-4 (1.387e-2 and 7.013e-4 on the aim layout), and
    // the free field reaches none of it.
    expect(edgeRendered.span).toBeCloseTo(0.0006994588396925117, 10);
    expect(renderedFlatField(SYSTEM, BLANK, EDGE_FIELD).span).toBeCloseTo(0.015120774699892207, 9);

    const axisStage = mosaicSeamStep(AXIS_STAGE_BLANK.composed, AXIS_STAGE_GEOMETRY);
    const axisField = mosaicSeamStep(AXIS_FIELD_BLANK.composed, AXIS_FIELD_GEOMETRY);
    // Axial, so this is a residue of a quantity the symmetry sends to zero:
    // 1.9e-7 out of a throughput of order 1, which puts a few ulps of the
    // operands at ~5e-9 of the residue. Bound three orders above that floor;
    // the ratio on the next line is looser still, as a quantity dividing by a
    // residue must be.
    expect(Math.abs(axisStage.acrossSeam / 1.8930955824643685e-7 - 1)).toBeLessThan(1e-5);
    expect(axisField.acrossSeam / axisStage.acrossSeam).toBeCloseTo(21.465155155222618, 3);
  });
});

describe("§ 6bj.5 — the distortion becomes a SEAM, and a square lattice on a radial map is anisotropic", () => {
  const axisField = mosaicSeamShiftMm(SYSTEM, AXIS_FIELD);
  const axisStage = mosaicSeamShiftMm(SYSTEM, AXIS_STAGE);
  const edgeField = mosaicSeamShiftMm(SYSTEM, EDGE_FIELD);
  const edgeStage = mosaicSeamShiftMm(SYSTEM, EDGE_STAGE);

  it("on the axis the two geometries are indistinguishable, and both are isotropic", () => {
    expect(axisField.px).toBeLessThan(1e-12);
    expect(axisStage.px).toBeCloseTo(0.00010299609769116545, 9);
    // The map is even about the axis, so a square lattice and a radial map agree
    // to ten digits there — the same symmetry § 6bd.3 keeps returning to.
    expect(axisStage.betweenRowsMm / axisStage.betweenColumnsMm).toBeCloseTo(1, 9);
    // On the exit layout a field scan's seam is not small but ZERO on both axes —
    // every tile reads the anchor's ruler (§ 2r.3) — so its isotropy is 0 = 0.
    // On the aim layout it was a ratio of two drifts, 1 to nine digits.
    expect(axisField.betweenRowsMm).toBeLessThan(1e-15);
    expect(axisField.betweenColumnsMm).toBeLessThan(1e-15);
    const aim = mosaicSeamShiftMm(SYSTEM, { ...AXIS_FIELD, layout: "aim" });
    expect(aim.betweenRowsMm / aim.betweenColumnsMm).toBeCloseTo(1, 9);
  });

  it("and at the edge a field scan abuts exactly and a stage scan is a third of a pixel out", () => {
    // A field scan's tiles are adjacent windows on ONE continuous traced map, so
    // there is nothing to disagree about: on the exit layout every tile reads the
    // anchor's ruler and the seam is 0 to rounding (§ 2r.3). Its distortion is real
    // and is one smooth warp of the whole picture.
    expect(edgeField.mm).toBeLessThan(1e-15);
    expect(edgeStage.px).toBeCloseTo(0.3289882559667031, 7);
    // On the aim layout the field scan carried the parts-per-million ruler drift
    // of each tile's paraxial reference sphere, and the stage scan was 95.7×
    // that — the aim layout's figure, kept as its own.
    const aim = mosaicSeamShiftMm(SYSTEM, { ...EDGE_FIELD, layout: "aim" });
    expect(mosaicSeamShiftMm(SYSTEM, { ...EDGE_STAGE, layout: "aim" }).mm / aim.mm).toBeCloseTo(95.7128, 3);
  });

  it("and the disagreement is in the direction the stage pitch was NOT fitted to", () => {
    // `stagePitchMm` is one scalar read along x through the anchor, which is the
    // radial direction for an anchor on the x axis. Column seams are therefore
    // nearly right and row seams — the tangential direction — are not, by 40.6×
    // (40.8× on the aim layout's ruler).
    expect(edgeStage.betweenColumnsMm).toBeCloseTo(0.000004359705222972879, 12);
    expect(edgeStage.betweenRowsMm).toBeCloseTo(0.00017707831248914285, 10);
    expect(edgeStage.betweenRowsMm / edgeStage.betweenColumnsMm).toBeCloseTo(40.61703794927523, 3);
    expect(edgeStage.betweenTiles[1]! - edgeStage.betweenTiles[0]!).toBe(3);

    // A field scan imposes no lattice on the map: on the exit layout both its
    // directions are 0. On the aim layout they were the same quantity to 1.4× —
    // drift and not a mismatch — kept as that layout's.
    expect(edgeField.betweenRowsMm).toBeLessThan(1e-15);
    const aim = mosaicSeamShiftMm(SYSTEM, { ...EDGE_FIELD, layout: "aim" });
    expect(aim.betweenRowsMm / aim.betweenColumnsMm).toBeCloseTo(1.39923, 4);
  });
});

describe("§ 6bj.6 — the aberration is the anchor's, everywhere, and uniform is not good", () => {
  it("gives every tile the anchor tile's own kernel, bit for bit", () => {
    const stage = EDGE_STAGE_BLANK.tiles.map((t) => t.volume.maxGridPhaseStepWaves);
    const field = EDGE_FIELD_BLANK.tiles.map((t) => t.volume.maxGridPhaseStepWaves);
    expect(stage.every((w) => Object.is(w, stage[0]))).toBe(true);
    expect(Object.is(stage[0], field[4])).toBe(true);
    expect(EDGE_STAGE_BLANK.maxGridPhaseStepWaves).toBe(stage[0]);
    expect(stage[0]).toBeCloseTo(0.40334916562875556, 12);
  });

  it("and the constant it chose is between the field scan's best and worst tile", () => {
    // The readout § 6bh.4 pinned as ordering the escape past a tile's own frame.
    // A stage scan does not make it small, it makes it the SAME — and at the
    // edge of the field that is 1.99% worse than the best tile a field scan has
    // and 3.85% better than its worst (1.85% and 3.53% on the aim layout). The anchor chooses it, and nothing else.
    const field = EDGE_FIELD_BLANK.tiles.map((t) => t.volume.maxGridPhaseStepWaves);
    const stage = EDGE_STAGE_BLANK.maxGridPhaseStepWaves;
    expect(Math.min(...field)).toBeCloseTo(0.3954695114507474, 8);
    expect(Math.max(...field)).toBeCloseTo(0.41951074866464433, 8);
    expect(stage / Math.min(...field)).toBeCloseTo(1.0199248082338948, 6);
    expect(stage / Math.max(...field)).toBeCloseTo(0.9614751634199288, 6);

    // On the axis the anchor is the field scan's own centre tile, bitwise. On the
    // aim layout it was also the BEST tile, so the same collapse was a gain
    // everywhere — "same mechanism, opposite verdict". On the exit layout it is
    // the WORST of the nine, 0.34088 against 0.33287–0.33344, so on the axis too
    // the stage scan costs: REVERSED at § 2r.2, and why the axial tile reads the
    // largest step is not traced (the eight around it sit 0.13 mm out).
    const axisField = AXIS_FIELD_BLANK.tiles.map((t) => t.volume.maxGridPhaseStepWaves);
    expect(Object.is(AXIS_STAGE_BLANK.maxGridPhaseStepWaves, axisField[4])).toBe(true);
    expect(Object.is(AXIS_STAGE_BLANK.maxGridPhaseStepWaves, Math.max(...axisField))).toBe(true);
    expect(Math.min(...axisField)).toBeCloseTo(0.33287423136610395, 12);
    expect(AXIS_STAGE_BLANK.maxGridPhaseStepWaves).toBeCloseTo(0.34088099768340685, 12);
  });
});

describe("§ 6bj.7 — the economy a field scan could not have", () => {
  it("has one field position, so it has one frame and not tiles² of them", () => {
    // § 6bg closed with "there is no economy in it: the frames are at different
    // field positions, so nothing about the pupil, the map or the raster is
    // shared". Under a stage scan that sentence is false in every clause, and
    // this is the evidence: the traced frames are the same numbers to the bit.
    const frames = EDGE_STAGE_BLANK.tiles.map((t) => t.volume.planes[0]!.frame);
    for (const f of frames) {
      expect(Object.is(f.pixelScaleMm, frames[0]!.pixelScaleMm)).toBe(true);
      expect(Object.is(f.halfExtentMm, frames[0]!.halfExtentMm)).toBe(true);
      expect(Object.is(f.centreObjectMm.x, frames[0]!.centreObjectMm.x)).toBe(true);
    }
    const throughput = EDGE_STAGE_BLANK.tiles.map((t) => t.volume.planes[0]!.patchThroughput[0]!);
    expect(throughput.every((v) => Object.is(v, throughput[0]))).toBe(true);

    // A field scan's differ — not in their ruler, which on the exit layout every
    // tile reads on the axis (on the aim layout it was the parts-per-million drift
    // § 6m.4 measured, § 2r.3), but in their field position, pupil and light.
    const fieldFrames = EDGE_FIELD_BLANK.tiles.map((t) => t.volume.planes[0]!.frame);
    expect(Object.is(fieldFrames[0]!.pixelScaleMm, fieldFrames[4]!.pixelScaleMm)).toBe(true);
    expect(Object.is(fieldFrames[0]!.centreObjectMm.x, fieldFrames[4]!.centreObjectMm.x)).toBe(false);
    const fieldThroughput = EDGE_FIELD_BLANK.tiles.map((t) => t.volume.planes[0]!.patchThroughput[0]!);
    expect(Object.is(fieldThroughput[0], fieldThroughput[4])).toBe(false);

    // `mosaicSeamShiftMm` takes the economy rather than noting it: one trace for
    // a stage scan's nine tiles, nine for a field scan's.
    expect(mosaicSeamShiftMm(SYSTEM, EDGE_STAGE, 3).px).toBeGreaterThan(0);
  });
});

describe("§ 6bj.8 — the refusals", () => {
  it("refuses a scan that is neither of the two geometries", () => {
    expect(() =>
      fluorescenceMosaicGeometry(SYSTEM, {
        ...EDGE_FIELD,
        scan: "diagonal" as unknown as "field",
      }),
    ).toThrow(/scan must be "field" or "stage"/);
  });

  it("refuses the field scan's pitch drift on a stage scan, and says what to read", () => {
    expect(() => fluorescenceMosaicPitchDriftPx(SYSTEM, EDGE_STAGE)).toThrow(/mosaicSeamShiftMm/);
    // 0 on the exit layout, where every tile reads the anchor's ruler (§ 2r.3);
    // the aim layout's drift is kept as that layout's.
    expect(fluorescenceMosaicPitchDriftPx(SYSTEM, EDGE_FIELD)).toBeLessThan(1e-12);
    expect(fluorescenceMosaicPitchDriftPx(SYSTEM, { ...EDGE_FIELD, layout: "aim" })).toBeGreaterThan(0);
  });

  it("refuses a seam shift with no seam and a probe line with no ends", () => {
    expect(() =>
      mosaicSeamShiftMm(SYSTEM, mosaicOptions({ centreMm: EDGE, tiles: 1, scan: "stage" })),
    ).toThrow(/no seam/);
    expect(() => mosaicSeamShiftMm(SYSTEM, EDGE_STAGE, 1)).toThrow(/at least 2/);
  });

  it("refuses a stage that has not been told where every tile is", () => {
    expect(() =>
      focusCorrectedTiles(SYSTEM, BLANK, {
        ...EDGE_FIELD,
        centresMm: [AXIS, EDGE],
        offsetsMm: [{ x: 0, y: 0 }],
      }),
    ).toThrow(/2 tile centres and 1 stage offsets/);
  });

  it("refuses a calibration frame that is not a kept span, and a tile that is not a tile", () => {
    expect(() => composeTileFrame(EDGE_STAGE_GEOMETRY, new Float64Array(4))).toThrow(
      /a kept span is/,
    );
    expect(() => scannerFlatField(EDGE_STAGE_BLANK, 9)).toThrow(/not one of the 9 tiles/);
    expect(() => scannerFlatField(EDGE_STAGE_BLANK, 1.5)).toThrow(/not one of the 9 tiles/);
  });
});
