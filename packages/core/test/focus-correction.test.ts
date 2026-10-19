import { describe, it, expect } from "vitest";
import {
  focusSurface,
  renderedBestFocus,
  separatedFocusMm,
  predictedFocusMm,
  type FocusProbe,
  type FocusSweepOptions,
} from "../src/imaging/focus-surface";
import { focusCorrectedTiles, surfaceStage } from "../src/imaging/focus-tiles";
import {
  fluorescenceSpectralVolume,
  labelledVolumeEmitters,
  type SpectralVolumeEmitterDensity,
} from "../src/imaging/spectral-volume";
import { gaussianBallEmitter, uniformSlabs } from "../src/imaging/emitter-volume";
import { imageRadiusForObjectHeight, objectFieldTile } from "../src/imaging/object-field";
import { colorImageFromStack } from "../src/imaging/image";
import { channelBasis } from "../src/imaging/emitter-spectrum";
import { boxcarBand } from "../src/imaging/emission";
import { quadratureSamples } from "../src/photometry/spectrum";
import { finiteConjugateMicroscope, finiteConjugateObjective } from "../src/designs/microscope";

/**
 * § 6bg — the correction applied.
 *
 * § 6bf sweeps where the stage has to be for each colour and each field point,
 * and closed on the line this step exists to strike: "nothing corrects with the
 * curve — `separatedFocusMm` predicts a stage position, no renderer takes one
 * per channel or per tile, and § 6be.7's finding that the tilt inside one frame
 * is 0.409 of a depth of focus says a per-tile correction is where this would
 * first pay." Two renderers take one now.
 *
 * Every measurement render here is on § 2q.3's resolved rim (`edgeSamples` 8),
 * and the surface is swept with the band-limited peak; the figures restated
 * there are struck in VALIDATION.md. Every one is on the exit layout since
 * § 2q.6, whose table records what that moved — and § 6bg.3's margin and
 * § 6bg.8's floor are two of the claims it weakened.
 *
 * **The correction pays, and the size of it is the field's.** At 430 nm the
 * ladder's 4×/0.10 renders its own probe 5.85× brighter at the correct stage
 * than at the nominal one, on the axis. Off the axis the colour term alone is
 * worth less and the field term more, and at the catalogued field edge the field
 * term by itself — a stage set correctly for 430 nm on the axis against one set
 * correctly for 430 nm out there — is 33.9% of the peak.
 *
 * **The uncorrected picture is sharper at its EDGE than at its centre**, which
 * is field curvature seen from an unusual side and is the one number here that
 * says the correction is not a monotone improvement in a picture that was
 * uniformly bad: an uncorrected 430 nm stage sits 0.208 mm from best focus on
 * the axis and 0.129 mm from it at the field edge, so the recovery the
 * correction wins runs the other way, 5.85× on the axis against 2.13× at the
 * edge.
 *
 * **And a picture corrected this way is not one exposure.** A microscope has one
 * stage. Two channels focused at two depths were acquired at two different
 * times, and `exposures` counts them: 3 for a step function over three filters,
 * 9 for a smooth curve over nine quadrature nodes — an acquisition nobody can
 * perform, which is why `FluorescenceSpectralVolume.focusMm` becomes `undefined`
 * rather than reporting one of them.
 *
 * **The haze readout does not follow the correction.** `inFocusFraction` is
 * measured about the NOMINAL stage, and axial colour is exactly the statement
 * that the nominal stage is not where the picture is sharp (§ 6bb.7's 50%). So
 * the corrected render — the 5.85×-brighter one — reports **no light in focus at
 * all**, and the blurred one reports all of it. § 6bg.5 pins the inversion so
 * that a panel cannot quote it as a sharpness meter.
 *
 * **What the correction costs is registration, and it is not the perspective.**
 * Refocusing a channel re-refers its own `1 + z·k`, which is the coupling § 6bb
 * would have predicted — and that term is 1/70 of what is measured. The
 * blue-against-red displacement at 1.0 mm of field grows 25.9% when each channel
 * is put at its own stage, and the cause is measured rather than inferred: with
 * only ONE channel's stage moved, that channel's own centroid walks 1.537e-3 mm
 * sideways at 1.0 mm of field and 3.02e-6 mm on the axis — 509× less, under a
 * thousandth of a pixel. A symmetric pupil's defocus cannot move a centroid; an
 * off-axis one's can, and does. (Centroids are read with the frame's floor
 * taken off — see `centroidOf`.)
 *
 * External numbers: § 6bf's swept surface on the ladder's own 4×/0.10, § 6be.2's
 * resolved floor, § 6be.7's in-frame tilt, and § 6ba.9's channel
 * misregistration.
 */

const DESIGN = 587.5618;
const RED = 656.2725;

const SYSTEM = finiteConjugateMicroscope({
  objective: finiteConjugateObjective({ magnification: 4, numericalAperture: 0.1 }),
}).system;

const SIZE = 128;
const PS = 48;
/** § 2q.3's resolved rim, on every measurement render here. */
const EDGE = 8;
const SLABS = uniformSlabs(-0.008, 0.008, 3);

const BALL: FocusProbe = (centreMm) =>
  gaussianBallEmitter({ waistMm: 0.005, axialWaistMm: 0.004, peak: 1, centreMm });

/** § 6bf's own sweep, unchanged — this step corrects with it, it does not re-measure it. */
const SWEEP: FocusSweepOptions = {
  size: SIZE,
  pupilSamples: PS,
  layout: "exit",
  edgeSamples: EDGE,
  edgeRule: "crossing",
  peak: "band-limited",
  slabs: SLABS,
  probe: BALL,
  stepMm: 0.005,
  halfMm: 0.03,
  maxPlateauDepths: 1,
};

/**
 * The surface every rung below corrects with — the expensive part of this file.
 *
 * Three wavelengths so the interpolation has an interval to be wrong in, and
 * four heights out to the catalogued field edge so the payoff is measured where
 * § 6be.3 measured the problem. Its own figures are § 6bf's: on the aim layout
 * the interaction came back at 4.741138e-3 mm, the same digits § 6bf.7's denser
 * grid read at h = 1.1, which was the cheapest possible check that this file's
 * surface is that file's surface. On the exit layout (§ 2q.6) it reads
 * 6.462937e-3 mm.
 */
const HEIGHTS = [0, 0.275, 0.55, 1.1];
const SURFACE = focusSurface(SYSTEM, {
  ...SWEEP,
  wavelengthsNm: [430, DESIGN, RED],
  objectHeightsMm: HEIGHTS,
});

const DOF430 = SURFACE.samples[0]![0]!.depthOfFocusMm;

/**
 * One tile rendered with a ball at its own object centre, at a stage of the
 * caller's choosing. The peak is the brightest sample of the tile's plane — NOT
 * § 6bf's estimator any more: since § 2q.3 the sweep reads the band-limited peak
 * of the frame's own periodic image, and a tile's plane is cropped to the stack's
 * common ruler (126² here), which is not periodic, so the interpolant does not
 * apply. "Did it pay" is asked in the units the sweep used before § 2q.
 */
function tilePeak(
  objectHeightMm: number,
  wavelengthNm: number,
  stageMm: (heightMm: number, nm: number) => number,
): { peak: number; inFocusFraction: number; heightMm: number; stageMm: number } {
  const centreMm = { x: imageRadiusForObjectHeight(SYSTEM, objectHeightMm, wavelengthNm), y: 0 };
  const base = {
    size: SIZE,
    pupilSamples: PS,
    layout: "exit" as const,
    edgeSamples: EDGE,
    edgeRule: "crossing" as const,
    samples: [{ nm: wavelengthNm, weight: 1 }],
    slabs: SLABS,
    centresMm: [centreMm],
  };
  // The probe goes at the tile's OWN object centre — § 6be.1 lost four rungs to
  // an axis-centred specimen that fell outside every off-axis tile.
  const located = focusCorrectedTiles(SYSTEM, () => 0, { ...base, stageMm: () => 0 });
  const heightMm = located.tiles[0]!.objectHeightMm[0]!;
  const ball = gaussianBallEmitter({
    waistMm: 0.005,
    axialWaistMm: 0.004,
    peak: 1,
    centreMm: { x: heightMm, y: 0, z: 0 },
  });
  const density: SpectralVolumeEmitterDensity = (x, y, z) => ball(x, y, z);
  const rendered = focusCorrectedTiles(SYSTEM, density, {
    ...base,
    stageMm: (q) => stageMm(q.objectHeightMm, q.wavelengthNm),
  });
  const plane = rendered.tiles[0]!.volume.planes[0]!;
  let peak = 0;
  for (const v of plane.intensity) if (v > peak) peak = v;
  return {
    peak,
    inFocusFraction: plane.inFocusFraction,
    heightMm,
    stageMm: rendered.tiles[0]!.focusMm[0]!,
  };
}

/**
 * A channel's centroid with the frame's own floor taken off first — its minimum,
 * subtracted before weighting.
 *
 * On § 2q.3's resolved rim the light a cut pupil cell throws past the frame comes
 * back as a UNIFORM floor (`incoherentPsf`'s `edgeFloor`), and the point-sampled
 * rim's wrapped tails were already one. A uniform pedestal weights every pixel of a
 * frame whose centre is not its middle (an even grid puts the axis one sample off
 * it), so it pulls a centroid toward the frame's middle by an amount that changes
 * with defocus. Measured: on the axis that pull IS the shift — 2.48e-5 mm read raw,
 * 3.1e-6 with the floor off, 1.6e-6 in a ±20-pixel window — and off the axis it moves
 * a channel's shift by 4% at most. The spot is what the rung is about, so the floor comes off.
 */
function centroidOf(
  stack: ReturnType<typeof fluorescenceSpectralVolume>,
  band: (nm: number) => number,
): { x: number; y: number; pixelScaleMm: number } {
  const image = colorImageFromStack(stack, channelBasis(stack, band));
  const n = image.width;
  let floor = Infinity;
  for (let i = 0; i < n * n; i++) floor = Math.min(floor, image.xyz[i * 3 + 1]!);
  let sx = 0;
  let sy = 0;
  let sum = 0;
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const v = image.xyz[(y * n + x) * 3 + 1]! - floor;
      sx += v * x;
      sy += v * y;
      sum += v;
    }
  }
  return { x: sx / sum, y: sy / sum, pixelScaleMm: image.pixelScaleMm };
}

const AXIS_430 = SURFACE.colourMm[0]!;
const corrected = (h: number, nm: number) =>
  tilePeak(h, nm, (heightMm, l) => predictedFocusMm(SURFACE, l, heightMm));
const atAxisStage = (h: number, nm: number) => tilePeak(h, nm, () => AXIS_430);
const uncorrected = (h: number, nm: number) => tilePeak(h, nm, () => 0);

describe("§ 6bg — the correction applied", () => {
  describe("§ 6bg.1 — the uncorrected render is unchanged, bitwise", () => {
    it("a constant per-channel stage IS the scalar stage, pixel for pixel", () => {
      const ball = gaussianBallEmitter({
        waistMm: 0.006,
        axialWaistMm: 0.005,
        peak: 1,
        centreMm: { x: 0.01, y: 0, z: 0 },
      });
      const density: SpectralVolumeEmitterDensity = (x, y, z) => ball(x, y, z);
      const base = {
        size: 64,
        pupilSamples: 24,
        layout: "exit" as const,
        samples: quadratureSamples({ fromNm: 450, toNm: 650, count: 5 }),
        slabs: SLABS,
      };
      const scalar = fluorescenceSpectralVolume(SYSTEM, density, { ...base, focusMm: 0.03 });
      const perChannel = fluorescenceSpectralVolume(SYSTEM, density, {
        ...base,
        channelFocusMm: () => 0.03,
      });
      expect(perChannel.planes).toHaveLength(scalar.planes.length);
      for (let p = 0; p < scalar.planes.length; p++) {
        const a = scalar.planes[p]!.intensity;
        const b = perChannel.planes[p]!.intensity;
        expect(b.length).toBe(a.length);
        for (let i = 0; i < a.length; i++) expect(Object.is(b[i], a[i])).toBe(true);
      }
      // One stage, so one exposure — and the picture may still say which.
      expect(scalar.exposures).toBe(1);
      expect(perChannel.exposures).toBe(1);
      expect(perChannel.focusMm).toBe(0.03);
      for (const plane of perChannel.planes) expect(plane.focusMm).toBe(0.03);
    });

    it("and omitting the option is the pre-§ 6bg default, stage 0 and one exposure", () => {
      const ball = gaussianBallEmitter({
        waistMm: 0.006,
        axialWaistMm: 0.005,
        peak: 1,
        centreMm: { x: 0, y: 0, z: 0 },
      });
      const stack = fluorescenceSpectralVolume(SYSTEM, (x, y, z) => ball(x, y, z), {
        size: 32,
        pupilSamples: 16,
        layout: "exit",
        samples: quadratureSamples({ fromNm: 450, toNm: 650, count: 3 }),
        slabs: SLABS,
      });
      expect(stack.focusMm).toBe(0);
      expect(stack.exposures).toBe(1);
      expect(stack.planes.every((p) => p.focusMm === 0)).toBe(true);
    });

    it("and a one-tile series at a flat stage IS that render, pixel for pixel", () => {
      const ball = gaussianBallEmitter({
        waistMm: 0.006,
        axialWaistMm: 0.005,
        peak: 1,
        centreMm: { x: 0.01, y: 0, z: 0 },
      });
      const density: SpectralVolumeEmitterDensity = (x, y, z) => ball(x, y, z);
      const base = {
        size: 64,
        pupilSamples: 24,
        layout: "exit" as const,
        samples: quadratureSamples({ fromNm: 450, toNm: 650, count: 3 }),
        slabs: SLABS,
      };
      const plain = fluorescenceSpectralVolume(SYSTEM, density, { ...base, focusMm: 0.02 });
      const series = focusCorrectedTiles(SYSTEM, density, {
        ...base,
        centresMm: [{ x: 0, y: 0 }],
        stageMm: () => 0.02,
      });
      const tile = series.tiles[0]!;
      expect(series.exposures).toBe(1);
      expect(tile.volume.planes).toHaveLength(plain.planes.length);
      for (let p = 0; p < plain.planes.length; p++) {
        const a = plain.planes[p]!.intensity;
        const b = tile.volume.planes[p]!.intensity;
        for (let i = 0; i < a.length; i++) expect(Object.is(b[i], a[i])).toBe(true);
      }
    });
  });

  describe("§ 6bg.2 — the prediction IS the surface it was built from", () => {
    it("bitwise at every point the surface was swept at", () => {
      for (let i = 0; i < SURFACE.wavelengthsNm.length; i++) {
        for (let j = 0; j < SURFACE.objectHeightsMm.length; j++) {
          const predicted = predictedFocusMm(
            SURFACE,
            SURFACE.wavelengthsNm[i]!,
            SURFACE.objectHeightsMm[j]!,
          );
          expect(Object.is(predicted, separatedFocusMm(SURFACE, i, j))).toBe(true);
        }
      }
    });

    it("and it invents no coupling — a bilinear over a separable grid separates", () => {
      // Interpolating the colour curve and the field curve one-dimensionally and
      // adding them gives the same number, because `separatedFocusMm` is already
      // a sum of the two. That is the property, not a coincidence of this grid.
      const nm = 500;
      const h = 0.4;
      const l = (nm - 430) / (DESIGN - 430);
      const colour = (1 - l) * SURFACE.colourMm[0]! + l * SURFACE.colourMm[1]!;
      const drop = (j: number) =>
        SURFACE.fieldDropMm.reduce((s, row) => s + row[j]!, 0) / SURFACE.fieldDropMm.length;
      const u = (h * h - 0.275 * 0.275) / (0.55 * 0.55 - 0.275 * 0.275);
      const field = (1 - u) * drop(1) + u * drop(2);
      expect(predictedFocusMm(SURFACE, nm, h)).toBeCloseTo(colour + field, 14);
    });
  });

  describe("§ 6bg.3 — h² is the interpolation variable, and the choice is a real one", () => {
    it("at an unswept height the even variable lands under the estimator's floor and h lands over it", () => {
      // Restated at § 2q.6, and weaker there: see the end of this rung.
      const h = 0.1375;
      const drop = (j: number) =>
        SURFACE.fieldDropMm.reduce((s, row) => s + row[j]!, 0) / SURFACE.fieldDropMm.length;
      const errors: { even: number; odd: number }[] = [];
      for (const [i, nm] of [430, DESIGN, RED].entries()) {
        const measured = renderedBestFocus(SYSTEM, nm, h, SWEEP).focusMm;
        const even = predictedFocusMm(SURFACE, nm, h) - measured;
        // The same interpolation in h rather than h², which is the only thing
        // that changes: same samples, same colour curve, same arithmetic.
        const odd = SURFACE.colourMm[i]! + drop(1) * (h / 0.275) - measured;
        errors.push({ even, odd });
      }
      const worstEven = Math.max(...errors.map((e) => Math.abs(e.even)));
      const worstOdd = Math.max(...errors.map((e) => Math.abs(e.odd)));
      expect(worstEven).toBeCloseTo(1.289305e-4, 9);
      expect(worstOdd).toBeCloseTo(1.409847e-3, 8);
      // The floor that decides it is the estimator's, and it has moved twice.
      // Point-sampled, § 6be.2 read 1.2e-3 mm and the odd variable landed ON it.
      // Resolved on the aim layout the interaction inside the pupil clip was a
      // floor of 8.7e-5 mm; the even variable (3.29347e-5) landed under it and the
      // odd one (1.330695e-3) 15× over, 40× the even. On the exit layout (§ 2q.6)
      // that interaction is a coupling, not a floor — 6–9e-4 mm, one sign on four
      // lattices — and what is left of a floor is its scatter across them, 3e-4.
      // The even variable lands under that and the odd one 4.7× over it, 10.9× the
      // even (4.8× and 8.4× while the fit dropped the off-axis rim, § 2t): h²
      // still wins, and h is still a measurable error, by a margin a quarter of
      // the aim layout's.
      const floor = 3e-4;
      expect(worstEven).toBeLessThan(floor);
      expect(worstOdd).toBeGreaterThan(4 * floor);
      expect(worstEven / DOF430).toBeLessThan(5e-3);
      expect(worstOdd / worstEven).toBeGreaterThan(8);
    });
  });

  describe("§ 6bg.4 — the correction pays, and by how much", () => {
    it("on the axis the whole of it is the colour term: 5.85× the peak", () => {
      const on = corrected(0, 430);
      const off = uncorrected(0, 430);
      expect(on.stageMm).toBe(AXIS_430);
      // 5.9000 on the aim layout (§ 2q.6)
      expect(on.peak / off.peak).toBeCloseTo(5.8492, 3);
    });

    it("on the axis the FIELD term is exactly nothing, and the stage says so bitwise", () => {
      // The field term is even (§ 6be.4), so its value at h = 0 is the axis
      // sample itself and the two stages are the same number, not two numbers
      // that agree — which is what makes the peaks identical rather than close.
      const on = corrected(0, 430);
      const axis = atAxisStage(0, 430);
      expect(Object.is(on.stageMm, axis.stageMm)).toBe(true);
      expect(Object.is(on.peak, axis.peak)).toBe(true);
    });

    it("at the field edge the field term alone is 33.9% of the peak", () => {
      const on = corrected(1.1, 430);
      const axis = atAxisStage(1.1, 430);
      // 0.12972 and 1.3549 on the aim layout (§ 2q.6)
      expect(on.stageMm).toBeCloseTo(0.12918, 4);
      expect(axis.stageMm).toBe(AXIS_430);
      expect(on.peak / axis.peak).toBeCloseTo(1.3392, 3);
    });

    it("and the uncorrected picture is SHARPER at its edge than at its centre", () => {
      // Field curvature carries best focus toward the nominal stage, so the
      // recovery the correction wins is largest where the picture looked worst.
      const edge = uncorrected(1.1, 430);
      const centre = uncorrected(0, 430);
      expect(edge.peak / centre.peak).toBeGreaterThan(2.3);
      // 2.3826 and 2.1333 on the aim layout (§ 2q.6)
      expect(edge.peak / centre.peak).toBeCloseTo(2.3708, 3);
      expect(corrected(1.1, 430).peak / edge.peak).toBeCloseTo(2.1328, 3);
    });
  });

  describe("§ 6bg.5 — the haze readout does NOT follow the correction", () => {
    it("the 5.85×-brighter render reports no light in focus, and the blurred one all of it", () => {
      // `inFocusFraction` counts slices within half a depth of focus of the
      // NOMINAL stage. Axial colour is the statement that the nominal stage is
      // not where the picture is sharp (§ 6bb.7's 50%), so once the stage is
      // corrected the specimen sits a whole chromatic shift away from it and the
      // readout reads zero — of the sharpest render in this file.
      const on = corrected(0, 430);
      const off = uncorrected(0, 430);
      expect(on.inFocusFraction).toBe(0);
      expect(off.inFocusFraction).toBe(1);
      expect(on.peak / off.peak).toBeGreaterThan(5);
    });
  });

  describe("§ 6bg.6 — what the correction costs, and what that cost is NOT", () => {
    const blue = boxcarBand(466.6666666666667, 66.66666666666667);
    const red = boxcarBand(628, 56);

    it("the channels' misregistration grows 25.9%, and the perspective is 1/70 of it", () => {
      const centreMm = { x: imageRadiusForObjectHeight(SYSTEM, 1.0, 550), y: 0 };
      const located = focusCorrectedTiles(SYSTEM, () => 0, {
        size: SIZE,
        pupilSamples: PS,
        layout: "exit",
        samples: [{ nm: 550, weight: 1 }],
        slabs: SLABS,
        centresMm: [centreMm],
        stageMm: () => 0,
      });
      const heightMm = located.tiles[0]!.objectHeightMm[0]!;
      const spot = gaussianBallEmitter({
        waistMm: 0.005,
        axialWaistMm: 0.004,
        peak: 1,
        centreMm: { x: heightMm, y: 0, z: 0 },
      });
      // ONE structure under two labels, so any displacement between the two
      // channels is the optics' and not the specimen's — § 6ba.9's design.
      const density = labelledVolumeEmitters([
        { density: spot, band: blue },
        { density: spot, band: red },
      ]);
      const samples = quadratureSamples({ fromNm: 433, toNm: 656, count: 9 });
      const render = (channelFocusMm?: (nm: number) => number) =>
        fluorescenceSpectralVolume(SYSTEM, density, {
          size: SIZE,
          pupilSamples: PS,
          layout: "exit",
          edgeSamples: EDGE,
          edgeRule: "crossing",
          samples,
          slabs: SLABS,
          centreMm,
          ...(channelFocusMm === undefined ? {} : { channelFocusMm }),
        });
      const displacement = (stack: ReturnType<typeof render>): number => {
        const b = centroidOf(stack, blue);
        const r = centroidOf(stack, red);
        return Math.hypot(r.x - b.x, r.y - b.y) * b.pixelScaleMm;
      };

      const flat = render();
      const perChannel = render((nm) => predictedFocusMm(SURFACE, nm, heightMm));
      expect(flat.exposures).toBe(1);
      expect(perChannel.exposures).toBe(samples.length);

      const before = displacement(flat);
      const after = displacement(perChannel);
      // On the exit layout (§ 2q.6); the aim layout read 6.213210e-3,
      // 7.756621e-3, 1.543412e-3 and 0.2484.
      expect(before).toBeCloseTo(6.391385e-3, 6);
      expect(after).toBeCloseTo(8.047678e-3, 6);
      const cost = after - before;
      expect(cost).toBeCloseTo(1.657023e-3, 6);
      expect(cost / before).toBeCloseTo(0.2591, 3);

      // The coupling § 6bb would have predicted, in closed form: each channel's
      // own `1 + z·k` evaluated at its own stage, bluest against reddest. It is
      // exactly ZERO uncorrected — every plane is referred to the same stage —
      // and 2.4e-5 mm corrected, which is 1.4% of what was measured. So the
      // price is not the map moving. An off-axis PSF is not symmetric, so
      // changing its defocus moves its centroid, and that is the other 98%.
      const perspective = (stack: ReturnType<typeof render>): number => {
        const first = stack.planes[0]!;
        const last = stack.planes[stack.planes.length - 1]!;
        const spread = Math.abs(
          first.rescale.stretchAt(0 - first.focusMm) - last.rescale.stretchAt(0 - last.focusMm),
        );
        return spread * heightMm * Math.abs(first.frame.magnification);
      };
      expect(perspective(flat)).toBe(0);
      // 2.3818e-5 on the aim layout (§ 2q.6)
      expect(perspective(perChannel)).toBeCloseTo(2.3700e-5, 8);
      expect(perspective(perChannel) / cost).toBeLessThan(0.02);
    });

    it("and the mechanism is a centroid that moves with defocus only OFF the axis", () => {
      // The negative above says what the price is not. This says what it is,
      // and the discriminator is the field: a symmetric pupil's defocus cannot
      // move a centroid, an asymmetric one's can. So move ONE channel's stage,
      // leave the other where it was, and watch that channel alone.
      const shifts = (nominalHeightMm: number): { blue: number; red: number } => {
        const centreMm = { x: imageRadiusForObjectHeight(SYSTEM, nominalHeightMm, 550), y: 0 };
        const located = focusCorrectedTiles(SYSTEM, () => 0, {
          size: SIZE,
          pupilSamples: PS,
          layout: "exit",
          samples: [{ nm: 550, weight: 1 }],
          slabs: SLABS,
          centresMm: [centreMm],
          stageMm: () => 0,
        });
        const heightMm = located.tiles[0]!.objectHeightMm[0]!;
        const spot = gaussianBallEmitter({
          waistMm: 0.005,
          axialWaistMm: 0.004,
          peak: 1,
          centreMm: { x: heightMm, y: 0, z: 0 },
        });
        const density = labelledVolumeEmitters([
          { density: spot, band: blue },
          { density: spot, band: red },
        ]);
        const samples = quadratureSamples({ fromNm: 433, toNm: 656, count: 9 });
        const render = (channelFocusMm?: (nm: number) => number) =>
          fluorescenceSpectralVolume(SYSTEM, density, {
            size: SIZE,
            pupilSamples: PS,
            layout: "exit",
            edgeSamples: EDGE,
            edgeRule: "crossing",
            samples,
            slabs: SLABS,
            centreMm,
            ...(channelFocusMm === undefined ? {} : { channelFocusMm }),
          });
        const flat = render();
        const stage = (nm: number) => predictedFocusMm(SURFACE, nm, heightMm);
        const blueMoved = render((nm) => (blue(nm) > 0 ? stage(nm) : 0));
        const redMoved = render((nm) => (red(nm) > 0 ? stage(nm) : 0));
        const scale = centroidOf(flat, blue).pixelScaleMm;
        return {
          blue: (centroidOf(blueMoved, blue).x - centroidOf(flat, blue).x) * scale,
          red: (centroidOf(redMoved, red).x - centroidOf(flat, red).x) * scale,
        };
      };

      const field = shifts(1.0);
      const axis = shifts(0);

      // Off the axis one channel's own refocus walks its own image sideways.
      // -1.426154e-3 and 1.172581e-4 on the aim layout (§ 2q.6)
      expect(field.blue).toBeCloseTo(-1.537390e-3, 7);
      expect(field.red).toBeCloseTo(1.196344e-4, 7);
      // On the axis the same stage moves do essentially nothing — 3.02e-6 mm,
      // under a thousandth of a pixel against over 0.4 of one off the axis. A
      // field-INDEPENDENT mechanism would show here too, and this is the rung that
      // says none does. (Read raw, with the frame's floor left in, the axis shift
      // was 1.18e-5 mm point-sampled and 2.48e-5 resolved — the floor's pull on an
      // even grid, which `centroidOf` now takes off.)
      expect(Math.abs(axis.blue)).toBeLessThan(3.2e-6);
      expect(Math.abs(axis.red)).toBeLessThan(9e-7);
      expect(Math.abs(field.blue) / Math.abs(axis.blue)).toBeGreaterThan(450);

      // And the two shifts ARE the cost measured above: the channels are
      // rendered independently, so what moved the pair is what moved each.
      expect(field.red - field.blue).toBeCloseTo(1.657023e-3, 6);
    });
  });

  describe("§ 6bg.7 — a picture with two stages in it is two exposures", () => {
    it("a step function over three filters is 3; the same band as a smooth curve is 9", () => {
      const ball = gaussianBallEmitter({
        waistMm: 0.005,
        axialWaistMm: 0.004,
        peak: 1,
        centreMm: { x: 0, y: 0, z: 0 },
      });
      const base = {
        size: 32,
        pupilSamples: 16,
        layout: "exit" as const,
        samples: quadratureSamples({ fromNm: 433, toNm: 656, count: 9 }),
        slabs: SLABS,
      };
      const banded = fluorescenceSpectralVolume(SYSTEM, (x, y, z) => ball(x, y, z), {
        ...base,
        // One value per piece of glass — an acquisition a microscope can perform.
        channelFocusMm: (nm) => (nm < 500 ? 0.2 : nm < 600 ? 0.05 : 0.07),
      });
      const smooth = fluorescenceSpectralVolume(SYSTEM, (x, y, z) => ball(x, y, z), {
        ...base,
        // One value per quadrature node — nine stage visits of one specimen.
        channelFocusMm: (nm) => predictedFocusMm(SURFACE, nm, 0),
      });
      expect(banded.exposures).toBe(3);
      expect(smooth.exposures).toBe(9);
      // Neither is a stage position, so neither reports one.
      expect(banded.focusMm).toBeUndefined();
      expect(smooth.focusMm).toBeUndefined();
      // And the per-channel figures are still there to be read.
      expect(new Set(banded.planes.map((p) => p.focusMm)).size).toBe(3);
      expect(new Set(smooth.planes.map((p) => p.focusMm)).size).toBe(9);
    });
  });

  describe("§ 6bg.8 — the tile series, and what no stage reaches", () => {
    const centresMm = [0, 0.5, 1.0].map((h) => ({
      x: imageRadiusForObjectHeight(SYSTEM, h, 550),
      y: 0,
    }));
    const SERIES_SAMPLES = [
      { nm: 433, weight: 1 },
      { nm: DESIGN, weight: 1 },
      { nm: RED, weight: 1 },
    ];
    const series = focusCorrectedTiles(SYSTEM, () => 0, {
      size: SIZE,
      pupilSamples: PS,
      layout: "exit",
      edgeSamples: EDGE,
      edgeRule: "crossing",
      samples: SERIES_SAMPLES,
      slabs: SLABS,
      centresMm,
      stageMm: surfaceStage(SURFACE),
    });

    it("every tile gets its own stage per channel, and the series counts its own exposures", () => {
      expect(series.tiles).toHaveLength(3);
      expect(series.exposures).toBe(9);
      // 0.225204 on the aim layout (§ 2q.6)
      expect(series.stageSpreadMm).toBeCloseTo(0.223482, 5);
      for (const tile of series.tiles) {
        expect(tile.exposures).toBe(3);
        expect(tile.focusMm).toHaveLength(3);
        for (let k = 0; k < 3; k++) {
          expect(tile.volume.planes[k]!.focusMm).toBe(tile.focusMm[k]);
        }
      }
      // The axis tile's stages ARE the surface's colour curve at the design and
      // red wavelengths — nothing about a tile changes what a swept point says.
      expect(series.tiles[0]!.focusMm[1]).toBe(SURFACE.colourMm[1]);
      expect(series.tiles[0]!.focusMm[2]).toBe(SURFACE.colourMm[2]);
    });

    it("the height a tile is corrected at is per wavelength, and it sits on the resolved floor", () => {
      const outer = series.tiles[2]!;
      const heights = outer.objectHeightMm;
      const spread = Math.max(...heights) - Math.min(...heights);
      // Lateral colour, seen from the object side: 2.5e-3 mm of object radius
      // between the blue and the design channel of ONE tile centre.
      expect(spread).toBeCloseTo(2.503e-3, 6);
      // What using one shared height for every channel would have moved the
      // stage by. Point-sampled it sat under § 6be.2's 1.2e-3 mm floor and this
      // rung called it bookkeeping. Resolved on the aim layout the floor inside
      // the pupil clip was 8.7e-5 mm and this (3.26471e-4) 3.7× that, a
      // measurement a sweep could confirm. On the exit layout (§ 2q.6) what is
      // left of a floor is the 3e-4 mm the lattice scatters the in-clip coupling
      // by, and this is 1.1× it: a sweep at 48 samples could not confirm it.
      let worst = 0;
      for (let k = 0; k < 3; k++) {
        const own = predictedFocusMm(SURFACE, SERIES_SAMPLES[k]!.nm, heights[k]!);
        const shared = predictedFocusMm(SURFACE, SERIES_SAMPLES[k]!.nm, heights[1]!);
        worst = Math.max(worst, Math.abs(own - shared));
      }
      expect(worst).toBeCloseTo(3.24307e-4, 7);
      expect(worst).toBeGreaterThan(3e-4);
      expect(worst).toBeLessThan(2 * 3e-4);
      expect(worst / DOF430).toBeLessThan(8e-3);
    });

    it("and the tilt inside the tile it corrected is left where § 6be.7 found it", () => {
      // A stage is a scalar, so the correction is exact at the tile's centre and
      // wrong everywhere else in the same frame. Read off the surface rather
      // than off patch columns, which is § 6be.7's measurement from the other
      // side and lands in the same place.
      const frame = objectFieldTile(SYSTEM, {
        size: SIZE,
        pupilSamples: PS,
        layout: "exit",
        wavelengthNm: 430,
        centreMm: centresMm[2]!,
      });
      const halfObjectMm = Math.abs(frame.halfExtentMm / frame.magnification);
      // 0.051494 on the aim layout's ruler (§ 6be.8)
      expect(halfObjectMm).toBeCloseTo(0.051672, 5);
      const across = Math.abs(
        predictedFocusMm(SURFACE, 430, 1.0 + halfObjectMm) -
          predictedFocusMm(SURFACE, 430, 1.0 - halfObjectMm),
      );
      // On the exit layout (§ 2q.6); the aim layout read 0.0134142 and 0.3103.
      expect(across).toBeCloseTo(0.0133718, 6);
      expect(across / DOF430).toBeCloseTo(0.3094, 3);
      // § 6be.7 reads 0.389 of a depth of focus across a frame at 1.1 mm (0.392
      // on the aim layout, 0.409 point-sampled); this is the same quantity one
      // tile further in, and no patch count removes it. The figure is this
      // lattice's FRAME: a frame is pupilSamples·λ/(2·NA) wide, so on the aim
      // layout 47 and 56 samples spanned 0.10084 and 0.12015 mm of object and
      // the same rung read 0.303 and 0.362. Per millimetre of field the tilt was
      // 0.130053 / 0.130250 / 0.130284 mm on 47 / 48 / 56 — the same to 0.18%, so
      // the lattice moves the ruler and not the surface — and on the exit
      // layout it reads 0.129387 at 48. All of them sit under § 6be.7's.
      expect(across / (2 * halfObjectMm)).toBeCloseTo(0.12939, 4);
      expect(across / DOF430).toBeLessThan(0.388);
    });
  });

  describe("§ 6bg.9 — the refusals", () => {
    it("a stage is not predicted outside the box the surface was swept over", () => {
      expect(() => predictedFocusMm(SURFACE, 420, 0)).toThrow(/outside the swept band/);
      expect(() => predictedFocusMm(SURFACE, 700, 0)).toThrow(/outside the swept band/);
      expect(() => predictedFocusMm(SURFACE, 430, 1.2)).toThrow(/outside the swept field/);
      expect(() => predictedFocusMm(SURFACE, 430, -0.1)).toThrow(/field RADIUS/);
    });

    it("and a tile placed at the swept field's own edge refuses, because its radius is not", () => {
      // The tile centre asked for 1.1 mm at 550 nm; the blue channel's own traced
      // map puts that image radius at 1.1029 mm of object, past the sweep. The
      // refusal names the height rather than extrapolating 3 µm.
      expect(() =>
        focusCorrectedTiles(SYSTEM, () => 0, {
          size: SIZE,
          pupilSamples: PS,
          layout: "exit",
          samples: [{ nm: 433, weight: 1 }],
          slabs: SLABS,
          centresMm: [{ x: imageRadiusForObjectHeight(SYSTEM, 1.1, 550), y: 0 }],
          stageMm: surfaceStage(SURFACE),
        }),
      ).toThrow(/outside the swept field/);
    });

    it("a stage that is not a number is refused before anything is rendered", () => {
      expect(() =>
        focusCorrectedTiles(SYSTEM, () => 0, {
          size: 32,
          pupilSamples: 16,
          layout: "exit",
          samples: [{ nm: DESIGN, weight: 1 }],
          slabs: SLABS,
          centresMm: [{ x: 0, y: 0 }],
          stageMm: () => Number.NaN,
        }),
      ).toThrow(/must return a stage position/);
      expect(() =>
        fluorescenceSpectralVolume(SYSTEM, () => 0, {
          size: 32,
          pupilSamples: 16,
          layout: "exit",
          samples: [{ nm: DESIGN, weight: 1 }],
          slabs: SLABS,
          channelFocusMm: () => Number.POSITIVE_INFINITY,
        }),
      ).toThrow(/not a stage a specimen can sit at/);
    });

    it("an empty tile list and an empty band", () => {
      expect(() =>
        focusCorrectedTiles(SYSTEM, () => 0, {
          size: 32,
          pupilSamples: 16,
          layout: "exit",
          samples: [{ nm: DESIGN, weight: 1 }],
          slabs: SLABS,
          centresMm: [],
          stageMm: () => 0,
        }),
      ).toThrow(/no tiles to render/);
      expect(() =>
        focusCorrectedTiles(SYSTEM, () => 0, {
          size: 32,
          pupilSamples: 16,
          layout: "exit",
          samples: [],
          slabs: SLABS,
          centresMm: [{ x: 0, y: 0 }],
          stageMm: () => 0,
        }),
      ).toThrow(/no wavelengths/);
    });

    it("a surface whose axes do not ascend cannot be interpolated on", () => {
      const scrambled = { ...SURFACE, wavelengthsNm: [DESIGN, 430, RED] };
      expect(() => predictedFocusMm(scrambled, 500, 0)).toThrow(/must ascend/);
    });
  });
});
