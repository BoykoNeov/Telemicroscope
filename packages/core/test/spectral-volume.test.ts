import { describe, it, expect } from "vitest";
import {
  focusDepthMm,
  fluorescenceSpectralVolume,
  formVolumePlane,
  labelledVolumeEmitters,
  neutralVolumeEmitterDensity,
  type SpectralVolumeEmitterDensity,
} from "../src/imaging/spectral-volume";
import { formEmitterPlane, neutralEmitterDensity } from "../src/imaging/emitter-spectrum";
import {
  depthRescale,
  gaussianBallEmitter,
  rasterizeEmitterVolume,
  slabEmitter,
  uniformSlabs,
} from "../src/imaging/emitter-volume";
import { gaussianEmitter } from "../src/imaging/emitter-density";
import {
  fieldPupilAt,
  imagePointAt,
  objectFieldTile,
  type ObjectFieldFrame,
} from "../src/imaging/object-field";
import { radialMapCovering } from "../src/imaging/radial-map";
import { defocusing, renderVolume } from "../src/imaging/volume";
import { idealPupil } from "../src/illumination/transfer";
import { incoherentPsf } from "../src/imaging/fluorescence";
import { boxcarBand } from "../src/imaging/emission";
import { quadratureSamples } from "../src/photometry/spectrum";
import { objectNumericalAperture } from "../src/pupil/microscope";
import { finiteConjugateMicroscope, finiteConjugateObjective } from "../src/designs/microscope";
import type { OpticalSystem } from "../src/trace/system";

/**
 * § 6bb — the spectral volume: § 6az's depth rescale times § 6ba's spectrum.
 *
 * Both of those steps closed with the same line in "still open" — the two are
 * independent today and a thick two-stain preparation is their product — and
 * this step is that product. No optics arrive with it. What arrives is that
 * **both factors are chromatic**, in two ways that turn out to be of completely
 * different sizes and to have completely different shapes.
 *
 * The **small** one is the perspective. § 6az.4 found the depth rate has two
 * object-space telecentric zeros inside the visible band and reverses sign
 * between them, so a *channel* — which is a band, not a wavelength — averages
 * across a reversal. § 6bb.9 measures what that does: the green channel's rate
 * cancels to 346× less than the blue's, so the quantity is **not monotone in
 * colour** and the middle channel is the extreme one. § 6bb.10 then bounds the
 * whole effect against § 6ba.9's static channel misregistration and finds it
 * reaches parity only at 83 mm of specimen depth.
 *
 * The **large** one is the focus. A stack is rendered at one stage position, so
 * the objective's own axial colour decides which depth each channel is sharp at,
 * and § 6bb.6 reads 0.167 mm between the blue channel and the design wavelength
 * — 3.88 depths of focus. § 6bb.7 then pins that this is *not* the paraxial
 * chromatic focal shift, which is 51% smaller, because each channel's best focus
 * is balanced against its own spherical aberration and the ρ⁴ term of the traced
 * wavefront falls 4.60× across the band.
 *
 * The external numbers are:
 *
 * - **the pinhole camera's perspective again**, `−2·z·k` as the odd part of the
 *   mean image radius, which § 6bb.4 reads out of the *picture* and not the
 *   raster — the measurement § 6az's own deferral asked for and did not make;
 * - **the paraxial conjugate**, solved in closed form from the y–u trace's own
 *   linearity, which is what `focusDepthMm` is and what § 6bb.7 weighs the
 *   rendered focus against;
 * - **the depth of focus**, `n·λ/(2·NA²)`, which § 6bb.11 weighs the rendered
 *   in-focus share against, and which is chromatic through the NA as well as
 *   through λ;
 * - **§ 6ba's own plane**, which § 6bb.2 shows this module reduces to at zero
 *   thickness up to one factor, and the factor turns out to be a colour.
 *
 * and the one **bracket** is § 6as.4's lattice discrepancy, inherited twice
 * over: every rung that needs an exact number uses a smooth emitter, and the
 * hard-edged ones are controls.
 */

/** § 6n's, § 6o's, § 6s's, § 6as's, § 6az's and § 6ba's own probe: the DIN 4×/0.10. */
const OBJECTIVE = finiteConjugateObjective({ magnification: 4, numericalAperture: 0.1 });
const SCOPE = finiteConjugateMicroscope({ objective: OBJECTIVE });
const SYSTEM: OpticalSystem = SCOPE.system;

/** The design wavelength — § 6v's stop and the conjugate were both set here. */
const DESIGN = 587.5618;
/** § 6az.4's free telecentric crossing: the achromat's own turn. */
const TELECENTRIC = 530.567099263;

const SIZE = 64;
const PS = 32;

/** A z-uniform lateral Gaussian — the haze, and smooth in every direction. */
const LATERAL = gaussianEmitter({ waistMm: 0.012, peak: 1 });
const HAZE = slabEmitter({ lateral: LATERAL, fromMm: -1, toMm: 1 });

const tile = (nm: number, size = SIZE, ps = PS): ObjectFieldFrame =>
  objectFieldTile(SYSTEM, { size, pupilSamples: ps, wavelengthNm: nm, centreMm: { x: 0, y: 0 } });

/** Flux-weighted mean image radius — where the picture is, on the image plane. */
function meanImageRadius(frame: ObjectFieldFrame, values: Float64Array): number {
  const { size } = frame;
  let flux = 0;
  let moment = 0;
  for (let iy = 0; iy < size; iy++) {
    for (let ix = 0; ix < size; ix++) {
      const v = values[iy * size + ix]!;
      if (v === 0) continue;
      const { x, y } = imagePointAt(frame, ix / size, iy / size);
      flux += v;
      moment += v * Math.hypot(x, y);
    }
  }
  return moment / flux;
}

/** The odd part of a quantity read at ±z, relative — the perspective's own signature. */
const asymmetry = (plus: number, minus: number): number => (2 * (plus - minus)) / (plus + minus);

const totalOf = (values: Float64Array): number => {
  let s = 0;
  for (const v of values) s += v;
  return s;
};

/** One depth of the haze, rasterized and then imaged two ways. */
function radiiAt(nm: number, zMm: number): {
  raster: number;
  ideal: number;
  traced: number;
} {
  const frame = tile(nm);
  const vol = rasterizeEmitterVolume(frame, HAZE, {
    radialMap: radialMapCovering(SYSTEM, [frame], { nodes: 128 }),
    rescale: depthRescale(SYSTEM, nm),
    slabs: { depthsMm: [zMm], thicknessMm: [1] },
  });
  const render = (pupil: Parameters<typeof defocusing>[0]) =>
    meanImageRadius(
      frame,
      renderVolume(vol, defocusing(pupil), {
        pupilSamples: PS,
        numericalAperture: 0.1,
        wavelengthNm: nm,
        scale: frame.scale,
      }).intensity,
    );
  return {
    raster: meanImageRadius(frame, vol.slices[0]!.field.values),
    ideal: render(idealPupil()),
    traced: render(fieldPupilAt(SYSTEM, frame, 0.5, 0.5, {}).pupil),
  };
}

/** The stage position that maximizes the peak, by a parabola through the best triple. */
function pictureFocusMm(nm: number): number {
  const step = 0.02;
  const xs: number[] = [];
  const ys: number[] = [];
  for (let i = -1; i <= 13; i++) {
    const focusMm = i * step;
    const plane = formVolumePlane(
      SYSTEM,
      neutralVolumeEmitterDensity(
        gaussianBallEmitter({ waistMm: 0.005, axialWaistMm: 0.004, peak: 1 }),
      ),
      {
        size: 128,
        pupilSamples: 48,
        samples: [],
        slabs: uniformSlabs(-0.008, 0.008, 3),
        focusMm,
      },
      { nm, weight: 1 },
      { x: 0, y: 0 },
    );
    let peak = 0;
    for (const v of plane.image.intensity) if (v > peak) peak = v;
    xs.push(focusMm);
    ys.push(peak);
  }
  let best = 1;
  for (let i = 1; i < ys.length - 1; i++) if (ys[i]! > ys[best]!) best = i;
  const y0 = ys[best - 1]!;
  const y1 = ys[best]!;
  const y2 = ys[best + 1]!;
  return xs[best]! + ((0.5 * (y0 - y2)) / (y0 - 2 * y1 + y2)) * step;
}

/** The ρ⁴ coefficient of the traced on-axis wavefront, in waves at the rim. */
function sphericalWaves(nm: number): number {
  const p = fieldPupilAt(SYSTEM, tile(nm), 0.5, 0.5, {}).pupil;
  const c = p.phaseWaves(0, 0);
  const w1 = p.phaseWaves(1, 0) - c;
  const wHalf = p.phaseWaves(0.5, 0) - c;
  return (wHalf - 0.25 * w1) / (0.0625 - 0.25);
}

/** The band average of the depth rate — what a CHANNEL sees, not a wavelength. */
function bandRate(fromNm: number, toNm: number): number {
  const band = boxcarBand((fromNm + toNm) / 2, toNm - fromNm);
  const samples = quadratureSamples({ fromNm: 400, toNm: 700, count: 121 });
  let weight = 0;
  let sum = 0;
  for (const s of samples) {
    const w = s.weight * band(s.nm);
    weight += w;
    sum += w * depthRescale(SYSTEM, s.nm).ratePerMm;
  }
  return sum / weight;
}

/** Bisect a wavelength where a chromatic quantity crosses zero. */
function crossing(f: (nm: number) => number, fromNm: number, toNm: number): number {
  let lo = fromNm;
  let hi = toNm;
  for (let i = 0; i < 200; i++) {
    const mid = 0.5 * (lo + hi);
    if (f(lo) * f(mid) <= 0) hi = mid;
    else lo = mid;
  }
  return 0.5 * (lo + hi);
}

describe("§ 6bb — the spectral volume", () => {
  describe("§ 6bb.1 — one wavelength of the driver IS § 6az's render, bitwise", () => {
    it("agrees to the last bit with the frame, table, rate, raster and render written out", () => {
      const nm = 546.074;
      const slabs = uniformSlabs(-0.03, 0.03, 4);
      const plane = formVolumePlane(
        SYSTEM,
        neutralVolumeEmitterDensity(HAZE),
        { size: SIZE, pupilSamples: PS, samples: [], slabs },
        { nm, weight: 1 },
        { x: 0, y: 0 },
      );

      const frame = tile(nm);
      const vol = rasterizeEmitterVolume(frame, HAZE, {
        radialMap: radialMapCovering(SYSTEM, [frame], { nodes: 128 }),
        rescale: depthRescale(SYSTEM, nm),
        slabs,
      });
      const image = renderVolume(vol, defocusing(fieldPupilAt(SYSTEM, frame, 0.5, 0.5, {}).pupil), {
        pupilSamples: PS,
        // The driver traces the object-side NA at each wavelength rather than
        // taking one number, which is a third way depth is chromatic.
        numericalAperture: objectNumericalAperture(SYSTEM, nm),
        wavelengthNm: nm,
        refractiveIndex: 1,
        scale: frame.scale,
      });

      let diff = 0;
      for (let i = 0; i < image.intensity.length; i++) {
        diff = Math.max(diff, Math.abs(image.intensity[i]! - plane.image.intensity[i]!));
      }
      expect(diff).toBe(0);
      expect(plane.numericalAperture).toBeCloseTo(0.10001613548968476, 15);
      expect(plane.numericalAperture).not.toBe(0.1);
    });
  });

  describe("§ 6bb.2 — a slab at focus is § 6ba's plane, times the thickness and the throughput", () => {
    it("the factor is the pupil's own formedSum, and it is a COLOUR", () => {
      const thickness = 0.004;
      const ratios = new Map<number, number>();
      const sums = new Map<number, number>();
      for (const nm of [430, 546.074, 680]) {
        const plane = formVolumePlane(
          SYSTEM,
          neutralVolumeEmitterDensity(HAZE),
          {
            size: SIZE,
            pupilSamples: PS,
            samples: [],
            slabs: { depthsMm: [0], thicknessMm: [thickness] },
          },
          { nm, weight: 1 },
          { x: 0, y: 0 },
        );
        const flat = formEmitterPlane(
          SYSTEM,
          neutralEmitterDensity(LATERAL),
          { size: SIZE, pupilSamples: PS, samples: [] },
          { nm, weight: 1 },
          { x: 0, y: 0 },
        );
        const frame = plane.frame;
        const formedSum = incoherentPsf(fieldPupilAt(SYSTEM, frame, 0.5, 0.5, {}).pupil, {
          pupilSamples: PS,
          size: SIZE,
          scale: frame.scale,
        }).formedSum;
        const ratio = totalOf(plane.image.intensity) / (totalOf(flat.input.intensity) * thickness);
        // `renderVolume` weighs each slice by what the pupil transmitted;
        // `renderFluorescence` normalizes it away. Same convolution, one factor.
        expect(Math.abs(ratio / formedSum - 1)).toBeLessThan(1e-14);
        ratios.set(nm, ratio);
        sums.set(nm, formedSum);
      }

      expect(sums.get(430)!).toBeCloseTo(0.17484106620284498, 15);
      expect(sums.get(680)!).toBeCloseTo(0.1759909445448711, 15);

      // The factor's own spectrum: 0.658% across the band, and it is the
      // objective's transmission rather than the pupil grid's quantization —
      // the on-axis amplitude squared reproduces it to 4.4e-6.
      const tilt = sums.get(680)! / sums.get(430)!;
      expect(tilt).toBeCloseTo(1.0065767, 6);
      const ampTilt =
        (fieldPupilAt(SYSTEM, tile(680), 0.5, 0.5, {}).pupil.amplitude(0, 0) /
          fieldPupilAt(SYSTEM, tile(430), 0.5, 0.5, {}).pupil.amplitude(0, 0)) **
        2;
      expect(Math.abs(tilt - ampTilt)).toBeLessThan(5e-6);
      expect(Math.abs(tilt - ampTilt)).toBeGreaterThan(4e-6);
    });
  });

  describe("§ 6bb.3 — one volume, one rate per channel", () => {
    it("five wavelengths of one specimen carry five perspectives, and one of them is none", () => {
      const stack = fluorescenceSpectralVolume(SYSTEM, neutralVolumeEmitterDensity(HAZE), {
        size: SIZE,
        pupilSamples: PS,
        samples: [430, 486.1327, 546.074, DESIGN, 656.2725].map((nm) => ({ nm, weight: 1 })),
        slabs: uniformSlabs(-0.5, 0.5, 3),
      });
      const rate = (nm: number) => stack.planes.find((p) => p.nm === nm)!;

      expect(rate(430).rescale.ratePerMm).toBeCloseTo(6.778530e-5, 10);
      expect(rate(546.074).rescale.ratePerMm).toBeLessThan(0);
      // `1/-Infinity`, which is what makes the telecentric case exact.
      expect(Object.is(rate(DESIGN).rescale.ratePerMm, -0)).toBe(true);
      expect(rate(430).maxStretchDeparture).toBeCloseTo(2.259510e-5, 10);
      // Exactly none, by arithmetic and not by a branch: 1 + z·(±0) is 1.
      expect(rate(DESIGN).maxStretchDeparture).toBe(0);
      // 47× between the extreme channels of one render.
      expect(rate(430).maxStretchDeparture / rate(546.074).maxStretchDeparture).toBeCloseTo(
        47.104,
        2,
      );
    });

    it("a rate from another wavelength is refused rather than zooming the stack backwards", () => {
      const frame = tile(430);
      expect(() =>
        rasterizeEmitterVolume(frame, HAZE, {
          radialMap: radialMapCovering(SYSTEM, [frame], { nodes: 128 }),
          rescale: depthRescale(SYSTEM, 656.2725),
          slabs: uniformSlabs(-0.01, 0.01, 2),
        }),
      ).toThrow(/CHANGES SIGN/);
    });
  });

  describe("§ 6bb.4 — the zoom reverses IN THE PICTURE", () => {
    it("the odd part of the mean image radius tracks −2·z·k, and is f64 zero at BOTH crossings", () => {
      const z = 0.35;
      const read = (nm: number) => {
        const plus = radiiAt(nm, +z);
        const minus = radiiAt(nm, -z);
        return {
          raster: asymmetry(plus.raster, minus.raster),
          ideal: asymmetry(plus.ideal, minus.ideal),
        };
      };

      // The rasterized geometry first: the closed form, to 0.05%.
      for (const nm of [430, 486.1327, 546.074, 656.2725, 680]) {
        const k = depthRescale(SYSTEM, nm).ratePerMm;
        const { raster } = read(nm);
        expect(raster / (-2 * z * k)).toBeCloseTo(1, 2);
      }

      // Then the picture, which is what § 6az's deferral asked for. Deeper
      // images SMALLER where the rate is positive, and LARGER between the
      // crossings — the sign reversal, read off a rendered image.
      const blue = read(430);
      const green = read(546.074);
      const red = read(656.2725);
      expect(blue.ideal).toBeCloseTo(-2.163917e-6, 11);
      expect(green.ideal).toBeCloseTo(7.891797e-8, 13);
      expect(red.ideal).toBeCloseTo(-7.578683e-7, 12);
      expect(Math.sign(blue.ideal)).toBe(-1);
      expect(Math.sign(green.ideal)).toBe(+1);
      expect(Math.sign(red.ideal)).toBe(-1);

      // And exactly nothing at either telecentric wavelength — f64 noise on a
      // quantity that is 2.2e-6 one crossing away.
      for (const nm of [TELECENTRIC, DESIGN]) {
        expect(Math.abs(read(nm).ideal)).toBeLessThan(1e-15);
      }
      expect(Math.abs(read(TELECENTRIC).raster)).toBe(0);
    });
  });

  describe("§ 6bb.5 — the picture reads the perspective DILUTED, and the dilution is chromatic", () => {
    it("an out-of-focus plane spreads more in blue, so blue hides its own perspective best", () => {
      const z = 0.35;
      const dilution = (nm: number) => {
        const plus = radiiAt(nm, +z);
        const minus = radiiAt(nm, -z);
        return (
          asymmetry(plus.ideal, minus.ideal) / asymmetry(plus.raster, minus.raster)
        );
      };
      const blue = dilution(430);
      const green = dilution(546.074);
      const red = dilution(680);
      expect(blue).toBeCloseTo(4.5582e-2, 5);
      expect(green).toBeCloseTo(7.8263e-2, 5);
      expect(red).toBeCloseTo(8.3631e-2, 5);
      // Monotone with wavelength: the same depth is fewer waves of defocus in
      // the red, so less of the geometry is smeared away.
      expect(blue).toBeLessThan(green);
      expect(green).toBeLessThan(red);
    });

    it("through the TRACED pupil the same measurement is 400 000× the perspective", () => {
      const z = 0.35;
      const plus = radiiAt(430, +z);
      const minus = radiiAt(430, -z);
      const traced = asymmetry(plus.traced, minus.traced);
      const ideal = asymmetry(plus.ideal, minus.ideal);
      expect(traced).toBeCloseTo(0.8483541, 6);
      expect(Math.abs(traced / ideal)).toBeGreaterThan(3.9e5);
      // Not a perspective at all: the objective's focus is not where the stage
      // is, so ±z are not equally blurred. That is § 6bb.6's subject, and it is
      // why the crossing rung above needs the ideal-pupil control.
    });
  });

  describe("§ 6bb.6 — the channels focus at different stage positions", () => {
    it("0.167 mm from the blue channel to the design wavelength — 3.88 depths of focus", () => {
      const blue = pictureFocusMm(430);
      const green = pictureFocusMm(546.074);
      const design = pictureFocusMm(DESIGN);
      const red = pictureFocusMm(656.2725);

      expect(blue).toBeCloseTo(0.213627, 5);
      expect(green).toBeCloseTo(0.051049, 5);
      expect(design).toBeCloseTo(0.046893, 5);
      expect(red).toBeCloseTo(0.067222, 5);

      const halfDepth430 = (430 * 1e-6) / (2 * 0.1 * 0.1);
      expect(halfDepth430).toBeCloseTo(0.0215, 12);
      // § 6k's depth of focus is half a wave across the full range, so it is
      // twice this half-depth: the two channels are 3.88 of them apart.
      expect((blue - design) / (2 * halfDepth430)).toBeCloseTo(3.8775, 3);

      // Non-monotone in colour, and the minimum is not at either end: the
      // best-focus curve turns around inside the band exactly as the rate does.
      expect(design).toBeLessThan(green);
      expect(design).toBeLessThan(red);
    });
  });

  describe("§ 6bb.7 — and it is NOT the paraxial chromatic focal shift", () => {
    it("`focusDepthMm` is 51% short, because each channel balances its own spherical", () => {
      expect(focusDepthMm(SYSTEM, 430)).toBeCloseTo(0.110213, 6);
      expect(focusDepthMm(SYSTEM, 486.1327)).toBeCloseTo(0.010050, 6);
      expect(focusDepthMm(SYSTEM, 546.074)).toBeCloseTo(-0.009622, 6);
      expect(focusDepthMm(SYSTEM, 656.2725)).toBeCloseTo(0.036257, 6);
      // Zero at the wavelength the conjugate was solved at, by construction.
      expect(Math.abs(focusDepthMm(SYSTEM, DESIGN))).toBeLessThan(1e-13);

      const paraxial = focusDepthMm(SYSTEM, 430) - focusDepthMm(SYSTEM, DESIGN);
      const picture = pictureFocusMm(430) - pictureFocusMm(DESIGN);
      expect(paraxial).toBeCloseTo(0.110213, 6);
      expect(picture).toBeCloseTo(0.166734, 5);
      expect(picture / paraxial).toBeCloseTo(1.5129, 3);

      // The cause, measured rather than asserted: the ρ⁴ term of the traced
      // wavefront falls 4.60× across the band, so the defocus each channel is
      // balanced against is its own.
      expect(sphericalWaves(430)).toBeCloseTo(1.928392, 5);
      expect(sphericalWaves(DESIGN)).toBeCloseTo(0.620972, 5);
      expect(sphericalWaves(656.2725)).toBeCloseTo(0.419576, 5);
      expect(sphericalWaves(430) / sphericalWaves(656.2725)).toBeCloseTo(4.5960, 3);
    });

    it("refuses an infinite conjugate, which has no plane for a stage to focus on", () => {
      const infinite: OpticalSystem = { ...SYSTEM, conjugate: { kind: "infinite" } };
      expect(() => focusDepthMm(infinite, DESIGN)).toThrow(/infinite conjugate/);
    });
  });

  describe("§ 6bb.8 — in focus at TWO wavelengths, telecentric at TWO, and only one is shared", () => {
    it("500.514925 and 587.5618 against 530.567099 and 587.5618", () => {
      const focusCrossing = crossing((nm) => focusDepthMm(SYSTEM, nm), 460, 545);
      const telecentricCrossing = crossing(
        (nm) => depthRescale(SYSTEM, nm).ratePerMm,
        500,
        560,
      );
      expect(focusCrossing).toBeCloseTo(500.514925275, 6);
      expect(telecentricCrossing).toBeCloseTo(TELECENTRIC, 6);
      // The design wavelength is the second root of both, and it is the only
      // one either of them was engineered to have: § 6v put the stop at the
      // back focal distance read there, and the conjugate was solved there.
      expect(Math.abs(focusDepthMm(SYSTEM, DESIGN))).toBeLessThan(1e-13);
      expect(Object.is(depthRescale(SYSTEM, DESIGN).ratePerMm, -0)).toBe(true);
      // The free roots are 30 nm apart and belong to nothing.
      expect(telecentricCrossing - focusCrossing).toBeCloseTo(30.052174, 5);
    });
  });

  describe("§ 6bb.9 — the perspective is NOT ordered by colour", () => {
    it("the green channel is telecentric and the blue and red are not — the middle is the extreme", () => {
      const blue = bandRate(433, 500);
      const green = bandRate(510, 560);
      const red = bandRate(600, 667);

      expect(blue).toBeCloseTo(2.979390e-5, 10);
      expect(green).toBeCloseTo(8.601662e-8, 12);
      expect(red).toBeCloseTo(8.132820e-6, 11);

      // A band that straddles the free crossing averages its own reversal away.
      expect(blue / green).toBeCloseTo(346.37, 1);
      expect(green / red).toBeLessThan(0.011);
      // And the two channels FURTHEST apart in colour are the two CLOSEST in
      // perspective, which is the whole point.
      expect(Math.abs(blue - red)).toBeLessThan(Math.abs(blue - green));
      expect(Math.abs(green - red)).toBeLessThan(Math.abs(blue - green));
    });
  });

  describe("§ 6bb.10 — the depth-dependent misregistration is bounded, and it is small", () => {
    it("parity with § 6ba.9's static 0.180% only at 83 mm of depth", () => {
      const spread = Math.abs(bandRate(433, 500) - bandRate(600, 667));
      expect(spread).toBeCloseTo(2.166108e-5, 11);
      // § 6ba.9 measured the two channels' STATIC magnification difference at
      // 0.180%. The depth-dependent part is z·Δk, so the depth at which the
      // volume's contribution equals the plane's is one division.
      const crossoverMm = 1.8e-3 / spread;
      expect(crossoverMm).toBeCloseTo(83.0984, 3);
      // At a thick preparation's 50 µm it is 0.06% of the static part: one
      // affine registration per channel is right for any specimen there is.
      expect(0.05 * spread).toBeCloseTo(1.0831e-6, 10);
      expect((0.05 * spread) / 1.8e-3).toBeLessThan(1e-3);
    });

    it("two labels at two depths still render as two channels of one exposure", () => {
      const density: SpectralVolumeEmitterDensity = labelledVolumeEmitters([
        {
          density: gaussianBallEmitter({
            waistMm: 0.01,
            axialWaistMm: 0.01,
            peak: 1,
            centreMm: { x: -0.02, y: 0, z: -0.03 },
          }),
          band: boxcarBand(466.5, 67),
        },
        {
          density: gaussianBallEmitter({
            waistMm: 0.01,
            axialWaistMm: 0.01,
            peak: 1,
            centreMm: { x: 0.02, y: 0, z: 0.03 },
          }),
          band: boxcarBand(633.5, 67),
        },
      ]);
      const stack = fluorescenceSpectralVolume(SYSTEM, density, {
        size: SIZE,
        pupilSamples: PS,
        samples: quadratureSamples({ fromNm: 420, toNm: 680, count: 9 }),
        slabs: uniformSlabs(-0.05, 0.05, 5),
      });
      expect(stack.planes).toHaveLength(9);
      // The ruler is the bluest plane's, § 6r's rule through § 6ba's stacker.
      expect(stack.rulerWavelengthNm).toBeCloseTo(434.44444444444446, 10);
      expect(stack.size).toBe(SIZE - 2);
      expect(stack.focusMm).toBe(0);
      // Every channel carries its own rate, and the middle of the band carries
      // one of the other sign — the reversal, inside one exposure.
      const rates = stack.planes.map((p) => p.rescale.ratePerMm);
      expect(rates.some((k) => k > 0)).toBe(true);
      expect(rates.some((k) => k < 0)).toBe(true);
      expect(rates[0]!).toBeCloseTo(6.1013e-5, 8);
    });
  });

  describe("§ 6bb.11 — the haze is chromatic", () => {
    it("the in-focus share is the depth of focus over the span, and the NA moves too", () => {
      const samples = [430, 546.074, 656.2725].map((nm) => ({ nm, weight: 1 }));
      const spanMm = 0.2;
      const slices = 51;
      const stack = fluorescenceSpectralVolume(SYSTEM, neutralVolumeEmitterDensity(HAZE), {
        size: SIZE,
        pupilSamples: PS,
        samples,
        slabs: uniformSlabs(-spanMm / 2, spanMm / 2, slices),
      });
      for (const plane of stack.planes) {
        const na = objectNumericalAperture(SYSTEM, plane.nm);
        const halfDepthMm = (plane.nm * 1e-6) / (2 * na * na);
        // A Riemann sum over depth reads the closed form to within one slice.
        expect(
          Math.abs(plane.inFocusFraction - (2 * halfDepthMm) / spanMm),
        ).toBeLessThan(1 / slices);
      }
      const share = (nm: number) => stack.planes.find((p) => p.nm === nm)!.inFocusFraction;
      expect(share(430)).toBeCloseTo(0.215686275, 8);
      expect(share(656.2725)).toBeCloseTo(0.333333333, 8);
      // Half again as much of a thick specimen is in focus in the red as in the
      // blue, on the same stack, at the same stage position.
      expect(share(656.2725) / share(430)).toBeCloseTo(1.5455, 3);

      // The NA is chromatic too — 0.26% across the band against the
      // wavelength's own 53%, so it is small and it is not nothing.
      const naBlue = objectNumericalAperture(SYSTEM, 430);
      const naRed = objectNumericalAperture(SYSTEM, 680);
      expect(objectNumericalAperture(SYSTEM, DESIGN)).toBeCloseTo(0.1, 15);
      expect(Math.abs(naRed / naBlue - 1)).toBeGreaterThan(1e-3);
      expect(Math.abs(naRed / naBlue - 1)).toBeLessThan(3e-3);
    });
  });

  describe("§ 6bb.12 — refining z does not brighten, and the refusals", () => {
    it("a z-uniform stack carries the same flux at 3, 6, 12 and 24 slices", () => {
      const emitted: number[] = [];
      const imaged: number[] = [];
      for (const count of [3, 6, 12, 24]) {
        const plane = formVolumePlane(
          SYSTEM,
          neutralVolumeEmitterDensity(HAZE),
          {
            size: SIZE,
            pupilSamples: PS,
            samples: [],
            slabs: uniformSlabs(-0.06, 0.06, count),
          },
          { nm: 546.074, weight: 1 },
          { x: 0, y: 0 },
        );
        emitted.push(plane.volume.emittedFlux);
        imaged.push(totalOf(plane.image.intensity));
      }
      for (const value of emitted) {
        expect(Math.abs(value / emitted[0]! - 1)).toBeLessThan(1e-12);
      }
      for (const value of imaged) {
        expect(Math.abs(value / imaged[0]! - 1)).toBeLessThan(1e-13);
      }
      expect(emitted[0]!).toBeCloseTo(2.71433605269866e-5, 17);
    });

    it("refuses a stack with no wavelengths", () => {
      expect(() =>
        fluorescenceSpectralVolume(SYSTEM, neutralVolumeEmitterDensity(HAZE), {
          size: SIZE,
          pupilSamples: PS,
          samples: [],
          slabs: uniformSlabs(-0.01, 0.01, 2),
        }),
      ).toThrow(/no wavelengths/);
    });

    it("refuses a preparation with no labels", () => {
      expect(() => labelledVolumeEmitters([])).toThrow(/no labels/);
    });

    it("refuses depths and thicknesses that do not match", () => {
      expect(() =>
        fluorescenceSpectralVolume(SYSTEM, neutralVolumeEmitterDensity(HAZE), {
          size: SIZE,
          pupilSamples: PS,
          samples: [{ nm: DESIGN, weight: 1 }],
          slabs: { depthsMm: [0, 0.01], thicknessMm: [0.01] },
        }),
      ).toThrow(/must not brighten/);
    });
  });
});
