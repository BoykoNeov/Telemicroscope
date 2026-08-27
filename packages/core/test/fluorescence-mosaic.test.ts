import { describe, it, expect } from "vitest";
import {
  fluorescenceMosaicGeometry,
  fluorescenceMosaicPitchDriftPx,
  renderFluorescenceMosaic,
  type FluorescenceMosaicOptions,
} from "../src/imaging/fluorescence-mosaic";
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
import {
  gaussianBallEmitter,
  uniformSlabs,
  type EmitterSlabs,
  type VolumeEmitterDensity,
} from "../src/imaging/emitter-volume";
import { objectFieldTile } from "../src/imaging/object-field";
import { boxcarBand } from "../src/imaging/emission";
import { colorImageFromStack } from "../src/imaging/image";
import { finiteConjugateMicroscope, finiteConjugateObjective } from "../src/designs/microscope";

/**
 * § 6bh — the fluorescence mosaic, and what a tile's edge is made of.
 *
 * § 6bg corrects the stage tile by tile and composes nothing — "no guard band,
 * no common ruler, no pitch" — naming the mosaic as its own deferral. This
 * composes them, and the composition is the cheap half: `mosaicGuardPixels` is
 * shared with the brightfield branch, the ruler rule is `mosaic-spectrum`'s
 * verbatim, and `renderFluorescenceMosaic` wraps `focusCorrectedTiles` unforked,
 * so a one-tile mosaic is that function's tile cropped by hand, bit for bit.
 *
 * **The finding is that the guard band is the correction's business.** A tile is
 * formed by circular convolution, so a guard exists to discard the band the wrap
 * lands in, and how wide it must be is set by how far the response reaches. On
 * this branch that reach is not diffraction's and not the specimen's: at 430 nm
 * the nominal stage lets 9.8% of a point emitter's light off the frame, and
 * § 6bf's swept stage lets 1.9% — 5.3× less, from moving one number. The design
 * wavelength's nominal tile leaks 1.2%, which is the built-in zero saying this
 * is the stage error and not the traced aberration. A 0.24 mm specimen adds 0.26
 * points where axial colour added 8.
 *
 * So § 6bg's "the correction and the composition are separable" is true of the
 * arithmetic and false of the cost: an uncorrected blue tile sits past
 * § 6bd.8's half-wave containment limit and a corrected one does not, and the
 * readout that says so — `maxGridPhaseStepWaves` — has shipped since § 6i.
 *
 * External numbers: § 6o's guard in cells and its pitch drift, § 6bd.8's
 * half-wave containment limit, § 6t's ruler ordering, § 6be.8's `halfExtentMm`
 * ∝ λ, § 6bf's swept surface and § 6be.2's 1.2e-3 mm estimator floor.
 */

const DESIGN = 587.5618;
const RED = 656.2725;

const SYSTEM = finiteConjugateMicroscope({
  objective: finiteConjugateObjective({ magnification: 4, numericalAperture: 0.1 }),
}).system;

/** The tile a mosaic is built from: 4 px per resolution cell, so a guard is whole. */
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

/** § 6bf's sweep, on the two wavelengths and three heights this step corrects at. */
const SWEEP: FocusSweepOptions = {
  size: 128,
  pupilSamples: 48,
  slabs: uniformSlabs(-0.008, 0.008, 3),
  probe: BALL,
  stepMm: 0.005,
  halfMm: 0.03,
  maxPlateauDepths: 1,
};
const SURFACE = focusSurface(SYSTEM, {
  ...SWEEP,
  wavelengthsNm: [430, DESIGN, RED],
  objectHeightsMm: [0, 0.275, 0.55, 1.1],
});
const DOF430 = SURFACE.samples[0]![0]!.depthOfFocusMm;

/** A specimen with structure everywhere, so a tile's kept span is not blank. */
function speckle(cellMm: number, seed: number): VolumeEmitterDensity {
  return (x, y) => {
    const i = Math.floor(x / cellMm) + 4096;
    const j = Math.floor(y / cellMm) + 4096;
    let h = (i * 73856093) ^ (j * 19349663) ^ (seed * 83492791);
    h = (h ^ (h >>> 13)) >>> 0;
    h = (h * 1274126177) >>> 0;
    return (h >>> 8) / 0x1000000;
  };
}

const DENSITY: SpectralVolumeEmitterDensity = labelledVolumeEmitters([
  { density: speckle(0.003, 1), band: boxcarBand(400, 700) },
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
    ...over,
  };
}

describe("§ 6bh.1 — a one-tile mosaic IS the tile it composes", () => {
  const options = mosaicOptions({ tiles: 1 });
  const geometry = fluorescenceMosaicGeometry(SYSTEM, options);
  const mosaic = renderFluorescenceMosaic(SYSTEM, DENSITY, options);
  const alone = focusCorrectedTiles(SYSTEM, DENSITY, {
    ...options,
    centresMm: [{ x: 0, y: 0 }],
  });

  it("composes the tile's kept centre, bit for bit, on every plane", () => {
    const { guardPixels, keptPixels, size } = geometry;
    expect(size).toBe(keptPixels);
    let compared = 0;
    for (let p = 0; p < SAMPLES.length; p++) {
      const src = alone.tiles[0]!.volume.planes[p]!.intensity;
      const srcSize = alone.tiles[0]!.volume.size;
      const dst = mosaic.composed.planes[p]!.intensity;
      for (let r = 0; r < keptPixels; r++) {
        for (let c = 0; c < keptPixels; c++) {
          const a = src[(guardPixels + r) * srcSize + (guardPixels + c)]!;
          const b = dst[r * size + c]!;
          if (!Object.is(a, b)) {
            throw new Error(`plane ${p} pixel (${r}, ${c}): ${a} !== ${b}`);
          }
          compared++;
        }
      }
    }
    expect(compared).toBe(SAMPLES.length * keptPixels * keptPixels);
  });

  it("and the correction it carries is that function's, untouched", () => {
    expect(mosaic.tiles[0]!.focusMm).toEqual(alone.tiles[0]!.focusMm);
    expect(mosaic.exposures).toBe(alone.exposures);
    expect(mosaic.stageSpreadMm).toBe(alone.stageSpreadMm);
  });

  it("CONTROL: the kept span is not blank, and two tiles are not the same picture", () => {
    const plane = mosaic.composed.planes[0]!.intensity;
    let nonZero = 0;
    for (const v of plane) if (v > 0) nonZero++;
    expect(nonZero).toBe(plane.length);

    const three = renderFluorescenceMosaic(SYSTEM, DENSITY, mosaicOptions({ tiles: 3 }));
    const a = three.tiles[0]!.volume.planes[0]!.intensity;
    const b = three.tiles[1]!.volume.planes[0]!.intensity;
    let differ = 0;
    for (let i = 0; i < a.length; i++) if (!Object.is(a[i], b[i])) differ++;
    expect(differ / a.length).toBeGreaterThan(0.9);
  });

  it("the composed stack is still a stack — `colorImageFromStack` takes it", () => {
    const three = renderFluorescenceMosaic(SYSTEM, DENSITY, mosaicOptions({ tiles: 3 }));
    const image = colorImageFromStack(three.composed);
    expect(image.width).toBe(three.geometry.size);
    expect(image.height).toBe(three.geometry.size);
    expect(image.pixelScaleMm).toBe(three.geometry.pixelScaleMm);
    expect(three.geometry.size).toBe(3 * three.geometry.keptPixels);
  });
});

describe("§ 6bh.2 — the ruler is the bluest plane, and `halfExtentMm` is ∝ λ", () => {
  const geometry = fluorescenceMosaicGeometry(SYSTEM, mosaicOptions());

  it("a frame's extent is proportional to its wavelength, exactly", () => {
    const blue = geometry.planes[0]!.frame.halfExtentMm;
    const red = geometry.planes[2]!.frame.halfExtentMm;
    // § 6be.8's open half, closed: the ratio is the WAVELENGTHS' ratio to the
    // last bit, not merely close to it, which is what makes "one tile centre is
    // a different amount of specimen in every channel" a statement about the
    // lattice rather than about this objective.
    expect(blue).toBeCloseTo(0.13691027134586664, 15);
    expect(red).toBeCloseTo(0.20895452570193085, 15);
    expect(red / blue).toBe(RED / 430);
    expect(red / blue).toBeCloseTo(1.5262151162790698, 13);
  });

  it("so the picture's ruler is the bluest plane's, and it is chosen by scale", () => {
    expect(geometry.rulerIndex).toBe(0);
    expect(geometry.rulerWavelengthNm).toBe(430);
    expect(geometry.planes[0]!.resampleRatio).toBe(1);
    expect(geometry.planes[1]!.resampleRatio).toBeLessThan(1);
    expect(geometry.planes[2]!.resampleRatio).toBeLessThan(geometry.planes[1]!.resampleRatio);
  });

  it("the ruler plane is the LEAST guarded, and its guard is the closed form", () => {
    const cropped = 1;
    const expected = geometry.guardCells + (cropped * PS) / SIZE;
    // 4.25 at the ruler — the guard asked for, plus the ruler crop in the
    // ruler's own cells — against 7.40 and 8.30 further red. § 6t's ordering,
    // and the redder planes are over-guarded by a factor that is not constant.
    expect(geometry.planes[0]!.effectiveGuardCells).toBeCloseTo(expected, 12);
    expect(geometry.planes[0]!.effectiveGuardCells).toBeCloseTo(4.25, 12);
    expect(geometry.planes[1]!.effectiveGuardCells).toBeCloseTo(7.400904551657375, 12);
    expect(geometry.planes[2]!.effectiveGuardCells).toBeCloseTo(8.30121633924932, 12);
    expect(geometry.planes[1]!.effectiveGuardCells).toBeGreaterThan(
      geometry.planes[0]!.effectiveGuardCells,
    );
    expect(geometry.planes[2]!.effectiveGuardCells).toBeGreaterThan(
      geometry.planes[1]!.effectiveGuardCells,
    );
  });
});

describe("§ 6bh.3 — the pitch is uniform, on a measurement", () => {
  it("the drift from the abutment fixed point is a thousandth of a pixel", () => {
    const drift = fluorescenceMosaicPitchDriftPx(SYSTEM, mosaicOptions({ tiles: 3 }));
    // 4.18e-5 of a pixel across three tiles — § 6o.4's licence, re-measured on
    // this branch's own kept span rather than inherited from the mono mosaic,
    // whose kept span is a different number of pixels (§ 6t's warning).
    expect(drift).toBeGreaterThan(0);
    expect(drift).toBeCloseTo(4.179802222032157e-5, 12);
  });

  it("and with an EVEN tile count no tile sits on the anchor", () => {
    const geometry = fluorescenceMosaicGeometry(SYSTEM, mosaicOptions({ tiles: 2 }));
    expect(geometry.centresMm).toHaveLength(4);
    for (const c of geometry.centresMm) {
      expect(Math.abs(c.x)).toBeCloseTo(geometry.pitchMm / 2, 12);
      expect(Math.abs(c.y)).toBeCloseTo(geometry.pitchMm / 2, 12);
    }
  });
});

describe("§ 6bh.4 — what a tile's edge is made of is the STAGE", () => {
  const WIDE = { size: 256, pupilSamples: 64 };
  const frame = objectFieldTile(SYSTEM, {
    size: SIZE,
    pupilSamples: PS,
    wavelengthNm: 430,
    centreMm: { x: 0, y: 0 },
  });
  /** A point emitter, one pixel wide, uniform in depth. */
  const point: VolumeEmitterDensity = (() => {
    const k = 1 / (frame.objectPixelScaleMm * frame.objectPixelScaleMm);
    return (x, y) => Math.exp(-(x * x + y * y) * k);
  })();
  const source = labelledVolumeEmitters([{ density: point, band: boxcarBand(400, 700) }]);

  /**
   * Share of the light that falls outside a tile-sized square, measured on a
   * DOUBLE-EXTENT render — § 6bd.8's method, and the only way to see light the
   * tile itself has already wrapped back inside its own frame.
   */
  function escaped(nm: number, slabs: EmitterSlabs, focusMm?: number): number {
    const wide = fluorescenceSpectralVolume(SYSTEM, source, {
      ...WIDE,
      slabs,
      samples: [{ nm, weight: 1 }],
      ...(focusMm === undefined ? {} : { focusMm }),
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

  function step(nm: number, slabs: EmitterSlabs, focusMm?: number): number {
    return fluorescenceSpectralVolume(SYSTEM, source, {
      size: SIZE,
      pupilSamples: PS,
      slabs,
      samples: [{ nm, weight: 1 }],
      ...(focusMm === undefined ? {} : { focusMm }),
    }).maxGridPhaseStepWaves;
  }

  const CORR430 = predictedFocusMm(SURFACE, 430, 0);
  const CORR_DESIGN = predictedFocusMm(SURFACE, DESIGN, 0);
  const THICK = uniformSlabs(-0.12, 0.12, 7);

  it("correcting the stage keeps five times as much light inside the tile", () => {
    const nominal = escaped(430, THIN);
    const corrected = escaped(430, THIN, CORR430);
    expect(nominal).toBeCloseTo(0.09823025273885999, 12);
    expect(corrected).toBeCloseTo(0.01865971415320966, 12);
    expect(nominal / corrected).toBeCloseTo(5.264295687078539, 10);
    // And the tile crosses § 6bd.8's half-wave containment limit in the process:
    // an uncorrected blue tile is past it, a corrected one is not.
    expect(step(430, THIN)).toBeCloseTo(0.6323844086356623, 12);
    expect(step(430, THIN, CORR430)).toBeCloseTo(0.332606346827407, 12);
    expect(step(430, THIN)).toBeGreaterThan(0.5);
    expect(step(430, THIN, CORR430)).toBeLessThan(0.5);
  });

  it("BUILT-IN ZERO: at the design wavelength the nominal tile is already tight", () => {
    const nominal = escaped(DESIGN, THIN);
    const corrected = escaped(DESIGN, THIN, CORR_DESIGN);
    // 1.17% nominal against 1.10% corrected — the correction has nothing left to
    // buy, which is what says the 430 nm figure above is the STAGE error and not
    // the traced pupil's aberration. The red end agrees, at 1.14%.
    expect(nominal).toBeCloseTo(0.01168692305932173, 12);
    expect(corrected).toBeCloseTo(0.010968143073478709, 12);
    expect(escaped(RED, THIN)).toBeCloseTo(0.011368165879969583, 12);
    expect(nominal / corrected).toBeLessThan(1.1);
  });

  it("thickness is the SMALL term — 0.24 mm of specimen against the blue stage", () => {
    const thin = escaped(430, THIN, CORR430);
    const thick = escaped(430, THICK, CORR430);
    // 0.24 mm of specimen adds 0.26 points of escape; leaving the stage at
    // nominal adds 7.96. So "a thick specimen bleeds further, so guard it more"
    // is the wrong instinct on this branch by a factor of 31.
    expect(thick).toBeCloseTo(0.021229181096046323, 12);
    expect(thick - thin).toBeCloseTo(0.0025694669428366634, 12);
    expect(escaped(430, THIN) - thin).toBeCloseTo(0.07957053858565033, 12);
    expect((escaped(430, THIN) - thin) / (thick - thin)).toBeGreaterThan(30);
    // …and the two compound: uncorrected AND thick leaks 11.5%.
    expect(escaped(430, THICK)).toBeCloseTo(0.11515556630139367, 12);
  });

  it("and `maxGridPhaseStepWaves` ORDERS the escape over every configuration", () => {
    const rows: [string, number, EmitterSlabs, number | undefined][] = [
      ["430 nominal", 430, THIN, undefined],
      ["430 corrected", 430, THIN, CORR430],
      ["design nominal", DESIGN, THIN, undefined],
      ["design corrected", DESIGN, THIN, CORR_DESIGN],
      ["red nominal", RED, THIN, undefined],
      ["430 corr thick", 430, THICK, CORR430],
      ["430 nominal thick", 430, THICK, undefined],
    ];
    const measured = rows.map(([name, nm, slabs, focusMm]) => ({
      name,
      step: step(nm, slabs, focusMm),
      escaped: escaped(nm, slabs, focusMm),
    }));
    // Seven configurations spanning colour, correction and thickness, and the
    // readout every render has carried since § 6i puts them in the same order as
    // a measurement that costs a second, double-extent render.
    const byStep = [...measured].sort((a, b) => a.step - b.step);
    for (let i = 1; i < byStep.length; i++) {
      expect(byStep[i]!.escaped).toBeGreaterThan(byStep[i - 1]!.escaped);
    }
  });
});

describe("§ 6bh.5 — the seam's focus step is a FIELD quantity", () => {
  function seamStepMm(anchorX: number): number {
    const geometry = fluorescenceMosaicGeometry(
      SYSTEM,
      mosaicOptions({ tiles: 3, centreMm: { x: anchorX, y: 0 } }),
    );
    const at = (x: number): number => {
      const f = objectFieldTile(SYSTEM, {
        size: SIZE,
        pupilSamples: PS,
        wavelengthNm: 430,
        centreMm: { x, y: 0 },
      });
      return predictedFocusMm(SURFACE, 430, Math.hypot(f.centreObjectMm.x, f.centreObjectMm.y));
    };
    return Math.abs(at(anchorX + geometry.pitchMm) - at(anchorX));
  }

  it("vanishes on the axis, where the focus surface is flat", () => {
    const axis = seamStepMm(0);
    const edge = seamStepMm(4);
    // 1.798e-4 mm on the axis against 6.874e-3 mm at 1 mm of field — 38.2×, and
    // the field is the discriminator for the same reason it was in § 6bg.8: the
    // focus surface is EVEN in field radius, so its gradient vanishes on axis
    // and a seam there joins two tiles that wanted the same stage.
    expect(axis).toBeCloseTo(1.7978471375304506e-4, 14);
    expect(edge).toBeCloseTo(6.873664536600849e-3, 13);
    expect(edge / axis).toBeCloseTo(38.23275290268902, 10);
  });

  it("and reaches a sixth of a depth of focus at the field edge", () => {
    // 0.00416 against 0.15903 depths of focus. The axial figure is under
    // § 6be.2's 1.2e-3 mm estimator floor and is bookkeeping; the edge figure is
    // half § 6bg.8's 0.3183 in-frame tilt one tile further out, which it must be
    // — a seam step is the surface's rise across ONE pitch and the in-frame tilt
    // is its rise across a whole frame.
    expect(seamStepMm(0) / DOF430).toBeCloseTo(4.159455588293538e-3, 13);
    expect(seamStepMm(4) / DOF430).toBeCloseTo(0.15902743771693587, 12);
    expect(seamStepMm(0)).toBeLessThan(1.2e-3);
  });
});

describe("§ 6bh.6 — the refusals", () => {
  it("a fractional or non-positive tile count", () => {
    expect(() => fluorescenceMosaicGeometry(SYSTEM, mosaicOptions({ tiles: 2.5 }))).toThrow(
      /positive integer/,
    );
    expect(() => fluorescenceMosaicGeometry(SYSTEM, mosaicOptions({ tiles: 0 }))).toThrow(
      /positive integer/,
    );
  });

  it("a guard that is not a whole number of pixels, and one that eats the tile", () => {
    expect(() =>
      fluorescenceMosaicGeometry(SYSTEM, mosaicOptions({ guardCells: 0.1 })),
    ).toThrow(/whole/);
    expect(() => fluorescenceMosaicGeometry(SYSTEM, mosaicOptions({ guardCells: 20 }))).toThrow(
      /leaves/,
    );
    expect(() => fluorescenceMosaicGeometry(SYSTEM, mosaicOptions({ guardCells: -1 }))).toThrow(
      /guardCells/,
    );
  });

  it("an empty band", () => {
    expect(() => fluorescenceMosaicGeometry(SYSTEM, mosaicOptions({ samples: [] }))).toThrow(
      /no wavelengths/,
    );
  });

  it("and a tile whose own traced height runs past the swept surface", () => {
    expect(() =>
      renderFluorescenceMosaic(
        SYSTEM,
        DENSITY,
        mosaicOptions({ tiles: 3, centreMm: { x: 4.4, y: 0 } }),
      ),
    ).toThrow(/1\.1|outside|swept/);
  });
});
