import { describe, it, expect } from "vitest";
import {
  fluorescenceMosaicGeometry,
  renderFluorescenceMosaic,
  composeTileScalars,
  type FluorescenceMosaicOptions,
} from "../src/imaging/fluorescence-mosaic";
import {
  renderedFlatField,
  throughputFlatField,
  flatFieldCorrect,
  mosaicSeamStep,
  type MosaicFlatField,
} from "../src/imaging/mosaic-flat-field";
import { focusCorrectedTiles, surfaceStage } from "../src/imaging/focus-tiles";
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
import { objectFieldTile } from "../src/imaging/object-field";
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
 * § 6bi — the flat field and the blend.
 *
 * § 6bh composed the tiles and closed with two things missing: nothing feathers
 * a seam, and nothing corrects the throughput's own field profile. Both are here
 * and they turn out not to be two halves of one job.
 *
 * **The seam's biggest artifact is a brightness staircase, and § 6bh did not
 * measure it.** Every tile is formed through its own pupil at its own field
 * height and nothing normalizes that away, so a mosaic of a featureless specimen
 * steps 0.65% across a seam at 1 mm of field and 4.1e-6 on the axis, a ratio of
 * 1609 — even in field radius, for the third time on this ladder. And it is
 * barely the correction's business where § 6bh.4's escape was all of it:
 * abandoning the focus correction moves the escape 4.31× and moves this 2.99%,
 * because a uniform object is uniform under any kernel.
 *
 * (Every figure here is on the exit layout's located rim since § 2r.2. On the
 * aim layout's point-sampled rim they read 0.53%, 1.9e-6, 2783, 5.264×, 4.06%,
 * 121×, 1193×, 11%, 1.6e-6, 1.7e-12 and 2.3%; each test keeps its own.)
 *
 * **A flat field is a division, so it removes the amplitude and cannot touch the
 * phase.** The free field — one scalar per tile off `patchThroughput` — takes
 * 55× off the seam at the field edge and nothing off it on the axis, because on
 * the axis the residue is not the glass at all: it is the rasterizer's own
 * Jacobian, and the two terms swap rank by 1218×.
 *
 * **And a real slide scanner's flat field is not merely useless here, it is
 * harmful** — it makes the seam 10% worse. A scanner holds the optics still and
 * moves the stage, so its vignetting repeats identically in every tile; this
 * mosaic moves the tile in the image plane, so the profile is one global even
 * function of field radius and a per-tile-repeating field carries none of it.
 *
 * **The blend's cost is the mixture and not the displacement.** The law of total
 * variance splits a blended pixel's second moment into the two tiles' own blurs
 * plus a cross term in their centroid separation; the cross term is 1.8e-6 of
 * the total at the field edge and 2.1e-12 on the axis, so what a blend really
 * costs is that half the light came from the worse-focused tile — 2.1% of the
 * second moment, and 37× less on the axis.
 *
 * External numbers: the law of total variance (an identity, held to 5e-15),
 * § 6bd.3's throughput profile, § 6be.6's achromatic null, § 6bh.1's bitwise
 * composition, § 6bh.4's guard contents and § 6bh.5's 38.2× focus step.
 */

const DESIGN = 587.5618;
const RED = 656.2725;

const SYSTEM = finiteConjugateMicroscope({
  objective: finiteConjugateObjective({ magnification: 4, numericalAperture: 0.1 }),
}).system;

/** § 6bh's tile, unchanged, so the two steps are read on one mosaic. */
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

/** The anchor of § 6bh.5's edge measurement: 4 mm of image is 1.0009 mm of field. */
const EDGE = { x: 4, y: 0 };
const AXIS = { x: 0, y: 0 };

const AXIS_OPTIONS = mosaicOptions({ centreMm: AXIS });
const EDGE_OPTIONS = mosaicOptions({ centreMm: EDGE });
const AXIS_GEOMETRY = fluorescenceMosaicGeometry(SYSTEM, AXIS_OPTIONS);
const EDGE_GEOMETRY = fluorescenceMosaicGeometry(SYSTEM, EDGE_OPTIONS);
const AXIS_BLANK = renderFluorescenceMosaic(SYSTEM, BLANK, AXIS_OPTIONS);
const EDGE_BLANK = renderFluorescenceMosaic(SYSTEM, BLANK, EDGE_OPTIONS);

describe("§ 6bi.1 — an abutting mosaic is § 6bh's, bit for bit", () => {
  const options = mosaicOptions({ tiles: 3 });
  const geometry = fluorescenceMosaicGeometry(SYSTEM, options);
  const mosaic = renderFluorescenceMosaic(SYSTEM, BLANK, options);
  const loose = focusCorrectedTiles(SYSTEM, BLANK, {
    ...options,
    centresMm: geometry.centresMm,
  });

  it("composes the tiles' kept centres, every pixel of every plane", () => {
    const { guardPixels, keptPixels, size, tilesPerAxis } = geometry;
    let compared = 0;
    for (let t = 0; t < loose.tiles.length; t++) {
      const col = t % tilesPerAxis;
      const row = (t - col) / tilesPerAxis;
      for (let p = 0; p < SAMPLES.length; p++) {
        const src = loose.tiles[t]!.volume.planes[p]!.intensity;
        const srcSize = loose.tiles[t]!.volume.size;
        const dst = mosaic.composed.planes[p]!.intensity;
        for (let r = 0; r < keptPixels; r++) {
          for (let c = 0; c < keptPixels; c++) {
            const a = src[(guardPixels + r) * srcSize + (guardPixels + c)]!;
            const b = dst[(row * keptPixels + r) * size + col * keptPixels + c]!;
            if (!Object.is(a, b)) {
              throw new Error(`tile ${t} plane ${p} pixel (${r}, ${c}): ${a} !== ${b}`);
            }
            compared++;
          }
        }
      }
    }
    expect(compared).toBe(9 * SAMPLES.length * keptPixels * keptPixels);
  });

  it("and a zero overlap is the old arithmetic, not a neutral factor on it", () => {
    // The geometry the option resolves to is integer: a pitch of `kept − 0` IS
    // `kept`, so § 6bh's expressions survive rather than being reproduced.
    expect(geometry.overlapPixels).toBe(0);
    expect(geometry.pitchPixels).toBe(geometry.keptPixels);
    expect(geometry.size).toBe(3 * geometry.keptPixels);
    expect(geometry.pitchMm).toBe(geometry.keptPixels * geometry.pixelScaleMm);

    const explicit = renderFluorescenceMosaic(SYSTEM, BLANK, { ...options, overlapPixels: 0 });
    for (let p = 0; p < SAMPLES.length; p++) {
      const a = mosaic.composed.planes[p]!.intensity;
      const b = explicit.composed.planes[p]!.intensity;
      for (let i = 0; i < a.length; i++) {
        if (!Object.is(a[i], b[i])) throw new Error(`plane ${p} pixel ${i}: ${a[i]} !== ${b[i]}`);
      }
    }
  });
});

describe("§ 6bi.2 — the seam's brightness step is a FIELD quantity", () => {
  const axis = mosaicSeamStep(AXIS_BLANK.composed, AXIS_GEOMETRY);
  const edge = mosaicSeamStep(EDGE_BLANK.composed, EDGE_GEOMETRY);

  it("vanishes on the axis, where the throughput profile is flat", () => {
    // Throughput is EVEN in field radius (§ 6bd.3), so its gradient is zero on
    // the axis and two tiles either side of an axial seam were formed through
    // pupils that pass the same light. § 6bh.5's focus step vanishes there for
    // the same reason and the two are otherwise unrelated quantities.
    // The axial step is a RESIDUE: the quantity is zero by the symmetry above,
    // and what is left is the render's own discretization, arrived at by
    // differencing two throughputs of order 1 that agree to 2 parts per
    // million. So a few ulps of disagreement in those operands — ~1e-15
    // absolute, which is all IEEE 754 leaves free once `exp` and `sqrt` are
    // involved — is 5e-10 OF THE RESIDUE. That is the floor; the bound is two
    // orders above it, and the recorded digits past that were the machine's,
    // not this engine's. `golden.ts` states the same fact about the image gate.
    // The edge reading cancels nothing and keeps its twelve.
    expect(Math.abs(axis.acrossSeam / 0.0000040616091761757945 - 1)).toBeLessThan(1e-7);
    expect(edge.acrossSeam).toBeCloseTo(0.006537195656447521, 12);
    expect(Math.abs(edge.acrossSeam / axis.acrossSeam / 1609.5087865156474 - 1)).toBeLessThan(1e-7);
  });

  it("and the whole picture is a staircase, not just its seams", () => {
    const axisField = renderedFlatField(SYSTEM, BLANK, AXIS_OPTIONS);
    const edgeField = renderedFlatField(SYSTEM, BLANK, EDGE_OPTIONS);
    expect(axisField.span).toBeCloseTo(0.00008182543259949791, 10);
    expect(edgeField.span).toBeCloseTo(0.01512084440833761, 7);
  });

  it("and it is barely the focus correction's business, where the ESCAPE was all of it", () => {
    // The discriminator against § 6bh.4. Abandoning the correction entirely —
    // every tile back at the nominal stage — moves the escape past a tile's own
    // frame by 5.264× and moves this by 4.06%. What little it does move is the
    // map's share of the step (§ 6bi.3) being blurred by a different kernel; the
    // pupil's share, which is the other 87%, cannot move at all, because a
    // uniform object is uniform under any kernel and defocus is not a loss.
    const flat = renderFluorescenceMosaic(SYSTEM, BLANK, {
      ...EDGE_OPTIONS,
      stageMm: () => 0,
    });
    const step = mosaicSeamStep(flat.composed, EDGE_GEOMETRY);
    expect(step.acrossSeam).toBeCloseTo(0.006732809753362543, 12);
    expect(step.acrossSeam / edge.acrossSeam).toBeCloseTo(1.0299232434204553, 9);
  });
});

describe("§ 6bi.3 — two flat fields, and the difference between them is the MAP", () => {
  const axisRendered = renderedFlatField(SYSTEM, BLANK, AXIS_OPTIONS);
  const edgeRendered = renderedFlatField(SYSTEM, BLANK, EDGE_OPTIONS);
  const axisThroughput = throughputFlatField(AXIS_BLANK);
  const edgeThroughput = throughputFlatField(EDGE_BLANK);

  it("at the field edge the pupil is most of the field, and the map the rest", () => {
    expect(edgeRendered.span).toBeCloseTo(0.01512084440833761, 7);
    expect(edgeThroughput.span).toBeCloseTo(0.012948802993138702, 7);
    expect(edgeRendered.span / edgeThroughput.span).toBeCloseTo(1.1677405502324736, 4);
  });

  it("and on the AXIS the two swap rank — what is left there is the map alone", () => {
    // The throughput is even, so it is flat on axis; the radial map's local
    // scale is not, so a uniform density in the OBJECT is not uniform on the
    // image grid. 1218× says the whole of an axial flat field is the rasterizer
    // (1193× on the aim layout, § 2r.2).
    expect(axisRendered.span).toBeCloseTo(0.00008182543259949791, 10);
    // The axial throughput span is the flat profile's residue — 6.5e-8 out of a
    // throughput of order 1 — so the same few ulps are 1.5e-8 of it. Bound set
    // three orders above that floor, because the number of accumulated
    // operations behind a rendered span is not bounded tightly enough to claim
    // less; it still keeps five figures of a seven-figure reading.
    expect(Math.abs(axisThroughput.span / 5.915908480306978e-8 - 1)).toBeLessThan(1e-5);
    // The ratio divides BY that residue, so it cannot be pinned tighter than the
    // residue is known: same bound, not the 4e-7 an absolute `toBeCloseTo` on
    // 1218 would have implied. 1218× is the finding and five figures state it.
    expect(Math.abs(axisRendered.span / axisThroughput.span / 1383.1422996464605 - 1)).toBeLessThan(1e-5);
  });

  it("and the pupil's ratio between two tiles is nearly ACHROMATIC — one slide, every channel", () => {
    // § 6be.6's null, measured between TILES rather than between patches of one
    // frame. It is why a real calibration gets away with one blank slide. On the
    // aim layout it was a null to 5e-8; on the exit layout the colours part by
    // 5.5e-5 — § 2q.6's displaced bundle, whose share of the rim is a colour —
    // which is under 1% of the 6.2e-3 the ratio itself departs from 1 by, so one
    // slide still serves every channel, to that (§ 2r.2, WEAKENED).
    const n = EDGE_GEOMETRY.tilesPerAxis;
    const ratios = SAMPLES.map((_, p) => {
      const mean = (t: number): number => {
        const v = EDGE_BLANK.tiles[t]!.volume.planes[p]!.patchThroughput;
        let s = 0;
        for (const x of v) s += x;
        return s / v.length;
      };
      return mean(n + 1) / mean(n);
    });
    expect(ratios[0]!).toBeCloseTo(0.9937511386910051, 9);
    const lo = Math.min(...ratios);
    const hi = Math.max(...ratios);
    expect(Math.abs((hi - lo) / ((hi + lo) / 2) / 5.483663835470606e-5 - 1)).toBeLessThan(1e-6);
    expect((hi - lo) / ((hi + lo) / 2) / (1 - ratios[0]!)).toBeLessThan(0.01);
  });
});

describe("§ 6bi.4 — division removes the amplitude and cannot touch the phase", () => {
  const edgeRendered = renderedFlatField(SYSTEM, BLANK, EDGE_OPTIONS);
  const before = mosaicSeamStep(EDGE_BLANK.composed, EDGE_GEOMETRY);

  it("the free field takes 55× off the seam at the edge and nothing off it on axis", () => {
    // 55.02× on the exit layout's located rim (54.96× at § 2r.2); 121.08× on the aim
    // layout's point-sampled one, whose residue after division was 2.7× smaller.
    const edge = mosaicSeamStep(
      flatFieldCorrect(EDGE_BLANK.composed, throughputFlatField(EDGE_BLANK)),
      EDGE_GEOMETRY,
    );
    const axis = mosaicSeamStep(
      flatFieldCorrect(AXIS_BLANK.composed, throughputFlatField(AXIS_BLANK)),
      AXIS_GEOMETRY,
    );
    expect(edge.acrossSeam).toBeCloseTo(0.00011881724761856992, 9);
    expect(before.acrossSeam / edge.acrossSeam).toBeCloseTo(55.01884906318218, 3);
    // Nothing on the axis, and that is not a failure: there is no throughput
    // gradient there to remove, so the 4.1e-6 that survives is § 6bi.3's map.
    expect(axis.acrossSeam).toBeCloseTo(0.000004033216626725496, 11);
  });

  it("and the free field is EXACT for the pupil because it carries no defocus", () => {
    // The claim "exact for the pupil" is measured and not asserted. A stage move
    // is a phase, so what the pupil transmits is unchanged by it (§ 6bc's "depth
    // exactly 0"), which means `patchThroughput` is a property of the field
    // position alone. Built from a mosaic rendered at a FLAT stage and applied to
    // the corrected one, it leaves the identical residual — so the 4.37e-5 above
    // is § 6bi.3's map and none of it is the stage.
    const flatStage = renderFluorescenceMosaic(SYSTEM, BLANK, {
      ...EDGE_OPTIONS,
      stageMm: () => 0,
    });
    const own = throughputFlatField(EDGE_BLANK);
    const other = throughputFlatField(flatStage);
    let departure = 0;
    for (let p = 0; p < SAMPLES.length; p++) {
      for (let i = 0; i < own.planes[p]!.length; i++) {
        departure = Math.max(departure, Math.abs(own.planes[p]![i]! - other.planes[p]![i]!));
      }
    }
    expect(departure).toBeLessThan(2e-14);
    const crossed = mosaicSeamStep(flatFieldCorrect(EDGE_BLANK.composed, other), EDGE_GEOMETRY);
    const native = mosaicSeamStep(flatFieldCorrect(EDGE_BLANK.composed, own), EDGE_GEOMETRY);
    expect(crossed.acrossSeam).toBeCloseTo(native.acrossSeam, 12);
    expect(crossed.acrossSeam).toBeCloseTo(0.00011881724762014468, 9);
  });

  it("and a stage scanner's per-tile field makes it WORSE, by 10%", () => {
    // 9.95% on the exit layout (§ 2r.2); 11.0% on the aim layout.
    // The correction a real slide scanner uses: one calibration frame, repeated
    // in every tile, because a scanner re-uses one part of the objective's field
    // for every tile. This mosaic moves the tile IN the field, so a repeating
    // field carries no between-tile information at all — and superimposes the
    // anchor tile's own profile on every tile, which is the 10%.
    const { keptPixels: k, guardPixels, pitchPixels, size, tilesPerAxis: n } = EDGE_GEOMETRY;
    const anchor = EDGE_BLANK.tiles[Math.floor(n / 2) * n + Math.floor(n / 2)]!;
    const planes = EDGE_BLANK.composed.planes.map((_, p) => {
      const src = anchor.volume.planes[p]!.intensity;
      const srcSize = anchor.volume.size;
      const out = new Float64Array(size * size);
      for (let row = 0; row < n; row++) {
        for (let col = 0; col < n; col++) {
          for (let r = 0; r < k; r++) {
            for (let c = 0; c < k; c++) {
              out[(row * pitchPixels + r) * size + col * pitchPixels + c] =
                src[(guardPixels + r) * srcSize + guardPixels + c]!;
            }
          }
        }
      }
      let sum = 0;
      for (const v of out) sum += v;
      const mean = sum / out.length;
      for (let i = 0; i < out.length; i++) out[i] = out[i]! / mean;
      return out;
    });
    const repeating: MosaicFlatField = {
      kind: "rendered",
      size,
      nm: EDGE_BLANK.composed.planes.map((p) => p.nm),
      planes,
      meanValue: planes.map(() => 1),
      span: 0,
    };
    const after = mosaicSeamStep(flatFieldCorrect(EDGE_BLANK.composed, repeating), EDGE_GEOMETRY);
    expect(after.acrossSeam).toBeCloseTo(0.007187783512334202, 8);
    expect(after.acrossSeam / before.acrossSeam).toBeCloseTo(1.099521415911169, 5);

    // …where the mosaic-wide field of the same render removes it exactly.
    const exact = mosaicSeamStep(
      flatFieldCorrect(EDGE_BLANK.composed, edgeRendered),
      EDGE_GEOMETRY,
    );
    // Exactly 0 before § 8c and 1.2e-16 after — half an ulp of the unity the
    // division lands on, not a seam. The correction is still the same render
    // divided by itself; what changed is that the quotients now round to 1 from
    // both sides instead of all from one, so the step across the seam is a
    // rounding rather than an identity. Bounded at one ulp, which is the claim.
    expect(exact.acrossSeam).toBeLessThan(2.3e-16);
  });

  it("and on a point emitter it moves the brightness 559× more than the WIDTH", () => {
    // 558.6× on the exit layout's located rim (560.8× at § 2r.2); 304.7× on the aim
    // layout's point-sampled one.
    // A flat field multiplies; a kernel convolves. So the correction reaches the
    // amplitude half of a seam and leaves the phase half exactly where § 6bh.5
    // measured it — § 6bd.6's split, one layer up.
    const frame = objectFieldTile(SYSTEM, {
      size: SIZE,
      pupilSamples: PS,
      wavelengthNm: 430,
      centreMm: { x: EDGE.x + EDGE_GEOMETRY.pitchMm, y: 0 },
      layout: "exit",
    });
    const point: SpectralVolumeEmitterDensity = labelledVolumeEmitters([
      {
        density: gaussianBallEmitter({
          waistMm: 0.005,
          axialWaistMm: 0.004,
          peak: 1,
          centreMm: { ...frame.centreObjectMm, z: 0 },
        }),
        band: boxcarBand(400, 700),
      },
    ]);
    const picture = renderFluorescenceMosaic(SYSTEM, point, EDGE_OPTIONS);
    const corrected = flatFieldCorrect(picture.composed, edgeRendered);
    const raw = moments(picture.composed.planes[0]!.intensity, EDGE_GEOMETRY.size);
    const fixed = moments(corrected.planes[0]!.intensity, EDGE_GEOMETRY.size);
    const brightness = (fixed.flux - raw.flux) / raw.flux;
    const width = (fixed.m2 - raw.m2) / raw.m2;
    expect(brightness).toBeCloseTo(0.006992845747157018, 9);
    expect(width).toBeCloseTo(-0.000012517637844773444, 11);
    expect(Math.abs(brightness / width)).toBeCloseTo(558.6393992542785, 9);
  });
});

describe("§ 6bi.5 — the ramp is a partition of unity, and it spreads what it cannot remove", () => {
  it("constant tiles compose to one, exactly or within an ulp", () => {
    // A rising weight and its own `1 − w`, separable, so the four tiles meeting
    // at a corner sum to one as well. Exact at all four small overlaps here — a
    // power of two makes `(j+0.5)/overlap` an exact binary fraction and 3 happens
    // to round back to one anyway — and ONE ULP at the two large ones, which is
    // the worst departure seen at any overlap. Pinned as `toBe`, never as a
    // tolerance: a partition of unity that drifts is a brightness error.
    for (const [overlapPixels, worst] of [
      [0, 0],
      [2, 0],
      [3, 0],
      [8, 0],
      [24, 2.220446049250313e-16],
      [31, 2.220446049250313e-16],
    ] as const) {
      const geometry = fluorescenceMosaicGeometry(
        SYSTEM,
        mosaicOptions({ centreMm: EDGE, ...(overlapPixels === 0 ? {} : { overlapPixels }) }),
      );
      const ones = composeTileScalars(geometry, () => 1);
      let departure = 0;
      for (const v of ones) departure = Math.max(departure, Math.abs(1 - v));
      expect(departure).toBe(worst);
    }
  });

  it("and it divides the visible step by the overlap and leaves the total alone", () => {
    // The closed form: a linear ramp spreads one step over `overlap` pixels, so
    // the largest change between neighbouring pixels is the total over the
    // overlap. What a blend changes is how fast a seam is crossed, not how far.
    for (const [overlapPixels, ratio] of [
      [2, 2.0009],
      [8, 7.9881283268954855],
      [24, 23.980699544001393],
    ] as const) {
      const options = mosaicOptions({ centreMm: EDGE, overlapPixels });
      const geometry = fluorescenceMosaicGeometry(SYSTEM, options);
      const blank = renderFluorescenceMosaic(SYSTEM, BLANK, options);
      const step = mosaicSeamStep(blank.composed, geometry);
      expect(step.acrossSeam / step.maxAdjacent).toBeCloseTo(ratio, 3);
      expect(Math.abs(step.acrossSeam / step.maxAdjacent - overlapPixels) / overlapPixels)
        .toBeLessThan(7e-3);
      // And the band comes out of the KEPT span, never the guard (§ 6bh.4): the
      // pitch falls, the guard does not move, and covering the same field costs
      // more tiles.
      expect(geometry.guardPixels).toBe(EDGE_GEOMETRY.guardPixels);
      expect(geometry.keptPixels).toBe(EDGE_GEOMETRY.keptPixels);
      expect(geometry.pitchPixels).toBe(EDGE_GEOMETRY.keptPixels - overlapPixels);
      expect(geometry.size).toBe(3 * geometry.keptPixels - 2 * overlapPixels);
    }
  });
});

describe("§ 6bi.6 — the blend's cost is the MIXTURE, not the displacement", () => {
  /** The two stages a seam joins, and the same point emitter rendered at each. */
  function seamPair(anchorX: number): {
    m2A: number;
    m2B: number;
    m2Mix: number;
    predicted: number;
    crossShare: number;
    separationMm: number;
  } {
    const geometry = fluorescenceMosaicGeometry(
      SYSTEM,
      mosaicOptions({ centreMm: { x: anchorX, y: 0 } }),
    );
    const frameOf = (x: number) =>
      objectFieldTile(SYSTEM, {
        size: SIZE,
        pupilSamples: PS,
        wavelengthNm: 430,
        centreMm: { x, y: 0 },
        layout: "exit",
      });
    const here = frameOf(anchorX);
    const next = frameOf(anchorX + geometry.pitchMm);
    const stageOf = (frame: { centreObjectMm: { x: number; y: number } }): number =>
      predictedFocusMm(SURFACE, 430, Math.hypot(frame.centreObjectMm.x, frame.centreObjectMm.y));

    const density: SpectralVolumeEmitterDensity = labelledVolumeEmitters([
      {
        density: gaussianBallEmitter({
          waistMm: 0.005,
          axialWaistMm: 0.004,
          peak: 1,
          centreMm: { ...here.centreObjectMm, z: 0 },
        }),
        band: boxcarBand(400, 700),
      },
    ]);
    const render = (focusMm: number): Float64Array =>
      fluorescenceSpectralVolume(SYSTEM, density, {
        ...EXIT,
        size: SIZE,
        pupilSamples: PS,
        slabs: THIN,
        samples: SAMPLES,
        centreMm: { x: anchorX, y: 0 },
        focusMm,
      }).planes[0]!.intensity;

    const a = render(stageOf(here));
    const b = render(stageOf(next));
    const n = Math.round(Math.sqrt(a.length));
    const scale = geometry.pixelScaleMm;
    const mA = moments(a, n, scale);
    const mB = moments(b, n, scale);

    // A blend at the middle of the band is an equal mixture of the two.
    const mix = new Float64Array(a.length);
    for (let i = 0; i < mix.length; i++) mix[i] = 0.5 * a[i]! + 0.5 * b[i]!;
    const mM = moments(mix, n, scale);

    // The law of total variance, with the mixture weights the FLUXES imply.
    const p = (0.5 * mA.flux) / (0.5 * mA.flux + 0.5 * mB.flux);
    const separation2 = (mA.cx - mB.cx) ** 2 + (mA.cy - mB.cy) ** 2;
    const cross = p * (1 - p) * separation2;
    const predicted = p * mA.m2 + (1 - p) * mB.m2 + cross;
    return {
      m2A: mA.m2,
      m2B: mB.m2,
      m2Mix: mM.m2,
      predicted,
      crossShare: cross / predicted,
      separationMm: Math.sqrt(separation2),
    };
  }

  const axis = seamPair(0);
  const edge = seamPair(4);

  it("the decomposition is an identity, and it holds to 5e-15", () => {
    expect(Math.abs(axis.m2Mix - axis.predicted) / axis.predicted).toBeLessThan(1e-14);
    expect(Math.abs(edge.m2Mix - edge.predicted) / edge.predicted).toBeLessThan(1e-14);
  });

  it("the cross term — the double image — is nothing, and 838 000 times less on axis", () => {
    // It goes as the square of the centroid separation, and § 6bg.6 measured
    // that separation to be an odd-order field quantity. So the term one would
    // fear from blending two differently-focused pictures is 1.8e-6 of the spot
    // where the focus step is worst, and 2.1e-12 where it is not (1.6e-6 and
    // 1.7e-12, a million times apart, on the aim layout's point-sampled rim;
    // 836 000 times on the exit layout's located one, § 2r.2, and 838 000 since
    // § 2t).
    expect(edge.crossShare).toBeCloseTo(0.00000179344723867554, 11);
    // The axial cross share goes as the SQUARE of a separation that is itself a
    // cancellation (1.1e-7 mm against a spot of ~1e-3), so it carries twice that
    // loss. But the binding constraint here is not the conditioning — it is the
    // RECORDED LITERAL, which is quoted to seven figures. Half an ulp of its
    // last digit is already 3e-7 of it, so no bound below that can be met by any
    // machine, this one included: the reading sits 1.6e-7 away because that is
    // where seven figures put it. A bound is never tighter than the rounding of
    // the number it compares against. 2.1e-12 is what the sentence quotes and
    // the 8e5 ratio below is the claim.
    expect(Math.abs(axis.crossShare / 2.14088900707964e-12 - 1)).toBeLessThan(1e-6);
    expect(edge.crossShare / axis.crossShare).toBeGreaterThan(8e5);
    expect(edge.separationMm).toBeCloseTo(0.0001249921443410392, 9);
    expect(axis.separationMm).toBeCloseTo(1.3508949330109527e-7, 12);
  });

  it("what it DOES cost is that half the light came from the blurrier tile", () => {
    // The first two terms, not the third: a blended pixel is the average of the
    // two tiles' own blurs, so it is wider than the sharper of them by half
    // their spread. 2.07% at the field edge and 0.056% on the axis (2.32% and
    // 0.062% on the aim layout's point-sampled rim, § 2r.2).
    expect(edge.m2A).toBeCloseTo(0.002133709878056041, 9);
    expect(edge.m2B).toBeCloseTo(0.002221875150651805, 9);
    expect((edge.m2Mix - edge.m2A) / edge.m2A).toBeCloseTo(0.020660677384176585, 12);
    // The axial fraction is 6.2e-4 of a second moment — a difference of two
    // readings of order 1.9e-3 that agree to four figures — so a few ulps in
    // them is ~2e-12 of the fraction. Bound three orders above that. 0.056% is
    // the claim and it is untouched.
    expect(Math.abs((axis.m2Mix - axis.m2A) / axis.m2A / 0.0005587062369442022 - 1)).toBeLessThan(1e-9);
  });

  it("and its field dependence is § 6bh.5's, read off the PIXELS and not the stage", () => {
    // The two tiles' own blurs differ 36.98× more at the edge than on the axis,
    // beside § 6bh.5's 38.5× for the stage step that causes it (37.20× and 38.2×
    // on the aim layout, § 2r.2). Suggestive and
    // NOT pinned as an identity: a second moment is not linear in defocus, and
    // the two are read on different quantities.
    const spread = (r: { m2A: number; m2B: number }): number => (r.m2B - r.m2A) / r.m2A;
    expect(spread(edge)).toBeCloseTo(0.041320007461819, 12);
    // Same cancellation as the fraction above — 1.2e-3 between two second
    // moments, so the same ~2e-12 floor — and the 37.20× divides by it, so it
    // is never pinned tighter than the quantity it divides by.
    expect(Math.abs(spread(axis) / 0.0011174140382109107 - 1)).toBeLessThan(1e-9);
    expect(Math.abs(spread(edge) / spread(axis) / 36.978242664622435 - 1)).toBeLessThan(1e-8);
  });
});

describe("§ 6bi.7 — the refusals", () => {
  it("an overlap that is fractional, negative, or eats the pitch", () => {
    for (const overlapPixels of [1.5, -1]) {
      expect(() =>
        fluorescenceMosaicGeometry(SYSTEM, mosaicOptions({ overlapPixels })),
      ).toThrow(/overlapPixels must be a non-negative integer/);
    }
    expect(() =>
      fluorescenceMosaicGeometry(
        SYSTEM,
        mosaicOptions({ overlapPixels: AXIS_GEOMETRY.keptPixels }),
      ),
    ).toThrow(/leaves a pitch of 0 px/);
  });

  it("a field from another mosaic, another channel, or another length", () => {
    const field = throughputFlatField(EDGE_BLANK);
    expect(() =>
      flatFieldCorrect(EDGE_BLANK.composed, { ...field, planes: field.planes.slice(0, 2) }),
    ).toThrow(/is per channel/);
    expect(() => flatFieldCorrect(EDGE_BLANK.composed, { ...field, size: 17 })).toThrow(
      /belongs to the mosaic geometry/,
    );
    expect(() =>
      flatFieldCorrect(EDGE_BLANK.composed, { ...field, nm: [431, DESIGN, RED] }),
    ).toThrow(/is a colour error, not a correction/);
    expect(() => mosaicSeamStep(EDGE_BLANK.composed, AXIS_GEOMETRY)).not.toThrow();
    expect(() =>
      mosaicSeamStep({ ...EDGE_BLANK.composed, size: 17 }, EDGE_GEOMETRY),
    ).toThrow(/must be the same mosaic/);
  });

  it("and a calibration that came back dark", () => {
    const dark: SpectralVolumeEmitterDensity = labelledVolumeEmitters([
      { density: () => 0, band: boxcarBand(400, 700) },
    ]);
    expect(() => renderedFlatField(SYSTEM, dark, mosaicOptions({ tiles: 1 }))).toThrow(
      /must be positive/,
    );
  });
});

/** Flux, centroid and second moment of an image, in whatever unit `scale` is. */
/**
 * Flux, centroid and second moment, each sum compensated (Neumaier). § 6bi.6's
 * identity is a statement about these sums, and over 128² pixels a plain sum's
 * rounding is itself ~1e-14 of the moment — the size of the bound. On the aim
 * layout's images plain sums happened to land under it; on the exit layout's
 * they read 1.17e-14 (§ 2r.2). Compensated, the sums carry their operands' own
 * rounding and nothing of the order they were added in.
 */
function moments(
  a: Float64Array,
  n: number,
  scale = 1,
): { flux: number; cx: number; cy: number; m2: number } {
  const flux = new Compensated();
  const sx = new Compensated();
  const sy = new Compensated();
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      const v = a[r * n + c]!;
      flux.add(v);
      sx.add(v * c);
      sy.add(v * r);
    }
  }
  const total = flux.value();
  const cx = sx.value() / total;
  const cy = sy.value() / total;
  const m2 = new Compensated();
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      m2.add(a[r * n + c]! * ((c - cx) ** 2 + (r - cy) ** 2));
    }
  }
  return { flux: total, cx: cx * scale, cy: cy * scale, m2: (m2.value() / total) * scale * scale };
}

/** Neumaier's compensated sum. */
class Compensated {
  private sum = 0;
  private carry = 0;
  add(x: number): void {
    const t = this.sum + x;
    this.carry += Math.abs(this.sum) >= Math.abs(x) ? this.sum - t + x : x - t + this.sum;
    this.sum = t;
  }
  value(): number {
    return this.sum + this.carry;
  }
}
