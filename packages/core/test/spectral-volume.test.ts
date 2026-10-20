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
import { opdMap } from "../src/pupil/opd";
import { aimRay } from "../src/pupil/aiming";
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
 * cancels to two or three orders below the blue's, so the quantity is **not
 * monotone in colour** and the middle channel is the extreme one. Being a
 * cancellation it is also the one figure here that moves with the quadrature, so
 * that rung pins the ordering and the staircase and not one count's digits.
 * § 6bb.10 then bounds the whole effect against § 6ba.9's static channel
 * misregistration and finds it reaches parity only at 83–86 mm of depth.
 *
 * The **large** one is the focus. A stack is rendered at one stage position, so
 * the objective's own axial colour decides which depth each channel is sharp at,
 * and § 6bb.6 reads 0.162 mm between the blue channel and the design wavelength
 * — 3.77 depths of focus on the rim § 2q.3 resolved (the point-sampled rim read
 * 0.167 and 3.88). § 6bb.7 then pins that this is *not* the paraxial chromatic
 * focal shift, which the picture exceeds by 47%, because each channel's best focus
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
/** § 2q.3's resolved rim, on every render here. */
const EDGE = 8;

/** A z-uniform lateral Gaussian — the haze, and smooth in every direction. */
const LATERAL = gaussianEmitter({ waistMm: 0.012, peak: 1 });
const HAZE = slabEmitter({ lateral: LATERAL, fromMm: -1, toMm: 1 });

const tile = (nm: number, size = SIZE, ps = PS): ObjectFieldFrame =>
  objectFieldTile(SYSTEM, { size, pupilSamples: ps, layout: "exit", wavelengthNm: nm, centreMm: { x: 0, y: 0 } });

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

/**
 * ∫|P|²/|P(0)|² over the axial exit pupil, over π — predicted from traced rays
 * and one closed form, with no layout code in it.
 *
 * An emitter's power per unit of the aim goes as T·cos³θ (dΩ = cos³θ·d²tanθ)
 * times the aim's own Jacobian onto the slope, (t/a)·dt/da of a symmetric map,
 * and a ray tube carries it to its exit coordinate e(a), spread by (e/a)·de/da.
 * So on a radius |P|² ∝ T·cos³θ·(t/a)·(dt/da)/((e/a)·de/da), integrated over the
 * disc in e. The slope is each ray's own launch: under the paraxial aim it is
 * linear in a and its Jacobian a constant that cancels (as this read before
 * § 2z, with t = a·tan u); under real aiming each ray is solved onto the stop,
 * and the slope is not linear in the coordinate (§ 2z.7).
 */
function rimShape(nm: number, n = 1001): number {
  const grid = Array.from({ length: n }, (_, i) => ({ px: i / (n - 1), py: 0 }));
  const map = opdMap(SYSTEM, 0, nm, grid);
  const a = map.samples.map((p) => p.px);
  const e = map.samples.map((p) => p.exitX / map.samples[n - 1]!.exitX);
  const t = grid.map((q) => {
    const d = aimRay(SYSTEM, map.pupil, 0, q, nm).dir;
    return d.x / d.z;
  });
  const derivative = (f: readonly number[], k: number): number => {
    const lo = Math.max(k - 1, 0);
    const hi = Math.min(k + 1, n - 1);
    return (f[hi]! - f[lo]!) / (a[hi]! - a[lo]!);
  };
  const density = (k: number): number => {
    const de = derivative(e, k);
    const dt = derivative(t, k);
    const exit = k === 0 ? de * de : (e[k]! / a[k]!) * de;
    const aim = k === 0 ? dt * dt : (t[k]! / a[k]!) * dt;
    return (map.samples[k]!.throughput * (1 + t[k]! * t[k]!) ** -1.5 * aim) / exit;
  };
  let sum = 0;
  for (let k = 0; k < n - 1; k++) {
    sum += 0.5 * (density(k) * e[k]! + density(k + 1) * e[k + 1]!) * (e[k + 1]! - e[k]!);
  }
  return (2 * sum) / density(0);
}

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
        edgeSamples: EDGE,
        edgeRule: "crossing",
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
        layout: "exit",
        edgeSamples: EDGE,
        edgeRule: "crossing",
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

/**
 * The same sweep with an ABERRATION-FREE pupil — the estimator's own control.
 *
 * § 6bb.6 reads a stage position off a rendered peak and § 6bb.7 attributes all
 * of it to the objective. That is only allowed if the sweep grid, the three-point
 * parabola and the three-slice axial discretization contribute nothing, and this
 * is what says so: with no axial colour and no spherical aberration anywhere,
 * best focus must come back at exactly zero. It is § 6bb.4's discipline applied
 * to a different estimator — a readout that cannot produce its own zero is not a
 * readout.
 */
function idealFocusMm(nm: number): number {
  const step = 0.02;
  const xs: number[] = [];
  const ys: number[] = [];
  for (let i = -3; i <= 3; i++) {
    const focusMm = i * step;
    const frame = tile(nm, 128, 48);
    const volume = rasterizeEmitterVolume(
      frame,
      gaussianBallEmitter({ waistMm: 0.005, axialWaistMm: 0.004, peak: 1 }),
      {
        radialMap: radialMapCovering(SYSTEM, [frame], { nodes: 128 }),
        rescale: depthRescale(SYSTEM, nm),
        slabs: uniformSlabs(-0.008, 0.008, 3),
        focusMm,
      },
    );
    const image = renderVolume(volume, defocusing(idealPupil()), {
      pupilSamples: 48,
      edgeSamples: EDGE,
      edgeRule: "crossing",
      numericalAperture: objectNumericalAperture(SYSTEM, nm),
      wavelengthNm: nm,
      refractiveIndex: 1,
      scale: frame.scale,
    });
    let peak = 0;
    for (const v of image.intensity) if (v > peak) peak = v;
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

/**
 * The band average of the depth rate — what a CHANNEL sees, not a wavelength.
 *
 * The sample count is an argument because the answer depends on it: the band
 * edges do not fall on bin boundaries, so this is § 6ba.8's staircase and not a
 * converging quadrature — and the green channel, which is a cancellation, feels
 * it far more than the other two. § 6bb.9 measures that rather than pinning one
 * count's digits.
 */
function bandRate(fromNm: number, toNm: number, count = 121): number {
  const band = boxcarBand((fromNm + toNm) / 2, toNm - fromNm);
  const samples = quadratureSamples({ fromNm: 400, toNm: 700, count });
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
        { size: SIZE, pupilSamples: PS, layout: "exit", edgeSamples: EDGE, edgeRule: "crossing", samples: [], slabs },
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
        edgeSamples: EDGE,
        edgeRule: "crossing",
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
      expect(plane.numericalAperture).toBeCloseTo(0.09995938110004654, 15); // was 0.10001613548968476 (§ 2z)
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
            layout: "exit",
            edgeSamples: EDGE,
            edgeRule: "crossing",
            samples: [],
            slabs: { depthsMm: [0], thicknessMm: [thickness] },
          },
          { nm, weight: 1 },
          { x: 0, y: 0 },
        );
        const flat = formEmitterPlane(
          SYSTEM,
          neutralEmitterDensity(LATERAL),
          { size: SIZE, pupilSamples: PS, layout: "exit", edgeSamples: EDGE, edgeRule: "crossing", samples: [] },
          { nm, weight: 1 },
          { x: 0, y: 0 },
        );
        const frame = plane.frame;
        const formedSum = incoherentPsf(fieldPupilAt(SYSTEM, frame, 0.5, 0.5, {}).pupil, {
          pupilSamples: PS,
          edgeSamples: EDGE,
          edgeRule: "crossing",
          size: SIZE,
          scale: frame.scale,
        }).formedSum;
        const ratio = totalOf(plane.image.intensity) / (totalOf(flat.input.intensity) * thickness);
        // § 6bc closed this. `renderVolume` weighs each slice by what the
        // pupil transmitted and `renderFluorescence` now does too, so the two
        // expressions of one convolution agree with no factor between them —
        // where before § 6bc the same ratio came back `formedSum` (0.1748 at
        // 430 nm), which is what made this seam check a deferral.
        expect(Math.abs(ratio - 1)).toBeLessThan(1e-14);
        expect(formedSum).toBeLessThan(0.2);
        ratios.set(nm, ratio);
        sums.set(nm, formedSum);
      }

      // On the exit layout (§ 2q.6). The aim layout read 0.17641773149460835
      // and 0.17757798551517912; point-sampled, 0.17484106620284498 and
      // 0.1759909445448711.
      expect(sums.get(430)!).toBeCloseTo(0.1764652207442036, 15); // was 0.17645329245685296 (§ 2z)
      expect(sums.get(680)!).toBeCloseTo(0.17920512628301952, 15); // was 0.17920478048786664 (§ 2z)

      // The factor's own spectrum: 1.56% across the band, and it is two things,
      // neither of them the pupil grid's quantization. One is the objective's
      // transmission, 0.658% — the on-axis amplitude squared, and on the aim
      // layout, which lays the pupil uniform, the whole of it (to 4.4e-6). The
      // other is the exit pupil brightening toward its rim, which is a colour:
      // `rimShape` predicts it from traced rays and cos³ alone, 0.891% from 430 to
      // 680 nm (0.897% before § 2z), and the product meets the formed sums to
      // 1.07e-5 — the 32-sample edge cells' share, which a fine quadrature of the
      // same pupil puts at 1.2e-5.
      const tilt = sums.get(680)! / sums.get(430)!;
      expect(tilt).toBeCloseTo(1.0155266, 6); // was 1.0155933 (§ 2z)
      const ampTilt =
        (fieldPupilAt(SYSTEM, tile(680), 0.5, 0.5, {}).pupil.amplitude(0, 0) /
          fieldPupilAt(SYSTEM, tile(430), 0.5, 0.5, {}).pupil.amplitude(0, 0)) **
        2;
      expect(ampTilt).toBeCloseTo(1.0065732, 6);
      const shapeTilt = rimShape(680) / rimShape(430);
      expect(shapeTilt).toBeCloseTo(1.0089055, 6); // was 1.0089721 (§ 2z)
      expect(Math.abs(tilt - ampTilt * shapeTilt)).toBeLessThan(1.5e-5);
      // and the transmission alone is no longer the answer
      expect(tilt - ampTilt).toBeGreaterThan(8e-3);
    });
  });

  describe("§ 6bb.3 — one volume, one rate per channel", () => {
    it("five wavelengths of one specimen carry five perspectives, and one of them is none", () => {
      const stack = fluorescenceSpectralVolume(SYSTEM, neutralVolumeEmitterDensity(HAZE), {
        size: SIZE,
        pupilSamples: PS,
        layout: "exit",
        edgeSamples: EDGE,
        edgeRule: "crossing",
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

      // The rasterized geometry first: the closed form, to 0.203% on the exit
      // layout's ruler (0.198% on the aim one, § 2q.6) — and the departure is not
      // noise, it grew monotonically with wavelength on the aim layout (0.0497% at
      // 430 nm to 0.1978% at 680), which is the Gaussian's finite width read
      // against a frame whose scale is ∝ λ.
      let worst = 0;
      for (const nm of [430, 486.1327, 546.074, 656.2725, 680]) {
        const k = depthRescale(SYSTEM, nm).ratePerMm;
        const { raster } = read(nm);
        worst = Math.max(worst, Math.abs(raster / (-2 * z * k) - 1));
      }
      expect(worst).toBeLessThan(2.05e-3);
      expect(worst).toBeGreaterThan(2.0e-3);

      // Then the picture, which is what § 6az's deferral asked for. Deeper
      // images SMALLER where the rate is positive, and LARGER between the
      // crossings — the sign reversal, read off a rendered image.
      const blue = read(430);
      const green = read(546.074);
      const red = read(656.2725);
      // On the exit layout (§ 2q.6); the aim layout read −2.489404e-6,
      // 7.869282e-8 and −7.384180e-7. The point-sampled rim read −2.163917e-6,
      // 7.891797e-8 and −7.578683e-7: 15% low in the blue at this lattice, and 1% at 47.
      expect(blue.ideal).toBeCloseTo(-2.468054e-6, 11); // was -2.480642e-6 (§ 2z)
      expect(green.ideal).toBeCloseTo(7.766377e-8, 13); // was 7.774197e-8 (§ 2z)
      expect(red.ideal).toBeCloseTo(-7.280106e-7, 12); // was -7.271317e-7 (§ 2z)
      expect(Math.sign(blue.ideal)).toBe(-1);
      expect(Math.sign(green.ideal)).toBe(+1);
      expect(Math.sign(red.ideal)).toBe(-1);

      // And exactly nothing at either telecentric wavelength — f64 noise on a
      // quantity that is 2.5e-6 one crossing away.
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
      // On the exit layout (§ 2q.6); the aim layout read 5.2438e-2, 7.8040e-2
      // and 8.1315e-2, the point-sampled rim 4.5582e-2, 7.8263e-2 and 8.3631e-2.
      expect(blue).toBeCloseTo(5.1988e-2, 5); // was 5.2253e-2 (§ 2z)
      expect(green).toBeCloseTo(7.7017e-2, 5); // was 7.7095e-2 (§ 2z)
      expect(red).toBeCloseTo(8.016e-2, 5); // was 8.0038e-2 (§ 2z)
      // Monotone with wavelength: the same depth is fewer waves of defocus in
      // the red, so less of the geometry is smeared away.
      expect(blue).toBeLessThan(green);
      expect(green).toBeLessThan(red);
    });

    it("through the TRACED pupil the same measurement is 340 000× the perspective", () => {
      const z = 0.35;
      const plus = radiiAt(430, +z);
      const minus = radiiAt(430, -z);
      const traced = asymmetry(plus.traced, minus.traced);
      const ideal = asymmetry(plus.ideal, minus.ideal);
      // On the exit layout (§ 2q.6; 0.8547819 on the aim one). Point-sampled,
      // 0.8483541 and above 3.9e5 — the ratio fell because the ideal-pupil
      // denominator rose 15%.
      expect(traced).toBeCloseTo(0.8562133, 6); // was 0.8557766 (§ 2z)
      expect(Math.abs(traced / ideal)).toBeGreaterThan(3.4e5);
      // Not a perspective at all: the objective's focus is not where the stage
      // is, so ±z are not equally blurred. That is § 6bb.6's subject, and it is
      // why the crossing rung above needs the ideal-pupil control.
    });
  });

  describe("§ 6bb.6 — the channels focus at different stage positions", () => {
    it("0.164 mm from the blue channel to the design wavelength — 3.82 depths of focus", () => {
      const blue = pictureFocusMm(430);
      const green = pictureFocusMm(546.074);
      const design = pictureFocusMm(DESIGN);
      const red = pictureFocusMm(656.2725);

      // On the exit layout (§ 2q.6); the aim layout read 0.209851, 0.051906,
      // 0.047701 and 0.067900, and the blue 0.210131 at 56 samples, 2.8e-4 away.
      // Point-sampled these read 0.213627, 0.051049, 0.046893 and 0.067222, and
      // the blue 0.211107 at 56 samples, 2.5e-3 away.
      expect(blue).toBeCloseTo(0.211903, 5); // was 0.208698 (§ 2z)
      expect(green).toBeCloseTo(0.051525, 5); // was 0.051648 (§ 2z)
      expect(design).toBeCloseTo(0.047478, 5);
      expect(red).toBeCloseTo(0.067844, 5); // was 0.067734 (§ 2z)

      const halfDepth430 = (430 * 1e-6) / (2 * 0.1 * 0.1);
      expect(halfDepth430).toBeCloseTo(0.0215, 12);
      // § 6k's depth of focus is half a wave across the full range, so it is
      // twice this half-depth: the two channels are 3.82 of them apart (3.75 before
      // § 2z; 3.7709 on
      // the aim layout and 3.7770 there at 56 samples; 3.8775 point-sampled).
      expect((blue - design) / (2 * halfDepth430)).toBeCloseTo(3.8238, 3); // was 3.7493 (§ 2z)

      // Non-monotone in colour, and the minimum is not at either end: the
      // best-focus curve turns around inside the band exactly as the rate does.
      expect(design).toBeLessThan(green);
      expect(design).toBeLessThan(red);
    });

    it("and the estimator's own zero: an aberration-free pupil focuses at 0", () => {
      // 2.8e-7 mm at 430 nm and 3.5e-17 at the design wavelength, against the
      // 0.0477 mm the traced pupil puts there — so none of § 6bb.6's numbers
      // belong to the sweep grid, the parabola or the axial discretization.
      expect(Math.abs(idealFocusMm(430))).toBeLessThan(1e-6);
      expect(Math.abs(idealFocusMm(DESIGN))).toBeLessThan(1e-6);
      expect(Math.abs(pictureFocusMm(DESIGN))).toBeGreaterThan(0.04);
    });
  });

  describe("§ 6bb.7 — and it is NOT the paraxial chromatic focal shift", () => {
    it("`focusDepthMm` is 33% short, because each channel balances its own spherical", () => {
      expect(focusDepthMm(SYSTEM, 430)).toBeCloseTo(0.110213, 6);
      expect(focusDepthMm(SYSTEM, 486.1327)).toBeCloseTo(0.010050, 6);
      expect(focusDepthMm(SYSTEM, 546.074)).toBeCloseTo(-0.009622, 6);
      expect(focusDepthMm(SYSTEM, 656.2725)).toBeCloseTo(0.036257, 6);
      // Zero at the wavelength the conjugate was solved at, by construction.
      expect(Math.abs(focusDepthMm(SYSTEM, DESIGN))).toBeLessThan(1e-13);

      const paraxial = focusDepthMm(SYSTEM, 430) - focusDepthMm(SYSTEM, DESIGN);
      const picture = pictureFocusMm(430) - pictureFocusMm(DESIGN);
      expect(paraxial).toBeCloseTo(0.110213, 6);
      // On the exit layout (§ 2q.6); the aim layout read 0.162150 and 1.4712,
      // the point-sampled rim 0.166734 and 1.5129.
      expect(picture).toBeCloseTo(0.164425, 5); // was 0.161220 (§ 2z)
      expect(picture / paraxial).toBeCloseTo(1.4919, 3); // was 1.4628 (§ 2z)

      // The cause, measured rather than asserted: the ρ⁴ term of the traced
      // wavefront falls 4.49× across the band (4.59× before § 2z), so the defocus each channel is
      // balanced against is its own. (Read in the exit coordinate, § 2q.6; in
      // the aim one 1.928392, 0.620972, 0.419576 and 4.5960.)
      expect(sphericalWaves(430)).toBeCloseTo(1.906235, 5); // was 1.942338 (§ 2z)
      expect(sphericalWaves(DESIGN)).toBeCloseTo(0.621416, 5); // was 0.621378 (§ 2z)
      expect(sphericalWaves(656.2725)).toBeCloseTo(0.424736, 5); // was 0.422800 (§ 2z)
      expect(sphericalWaves(430) / sphericalWaves(656.2725)).toBeCloseTo(4.488, 3); // was 4.5940 (§ 2z)
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
    it("the green channel is telecentric and the blue and red are not, at EVERY sample count", () => {
      const counts = [61, 121, 241, 481];
      const greens: number[] = [];
      for (const count of counts) {
        const blue = bandRate(433, 500, count);
        const green = bandRate(510, 560, count);
        const red = bandRate(600, 667, count);
        greens.push(green);

        // Two to three orders below both, which is what 'telecentric channel'
        // means. The digits are the quadrature's; the order of magnitude is not.
        expect(blue).toBeGreaterThan(2.88e-5);
        expect(blue).toBeLessThan(2.99e-5);
        expect(red).toBeGreaterThan(7.9e-6);
        expect(red).toBeLessThan(8.2e-6);
        expect(green).toBeGreaterThan(5.0e-8);
        expect(green).toBeLessThan(1.3e-7);
        expect(blue / green).toBeGreaterThan(240);
        expect(green / red).toBeLessThan(0.016);

        // The finding, and it survives every count: the two channels FURTHEST
        // apart in colour are the two CLOSEST in perspective, and both are
        // further from the one BETWEEN them than from each other.
        expect(Math.abs(blue - red)).toBeLessThan(Math.abs(blue - green));
        expect(Math.abs(green - red)).toBeLessThan(Math.abs(blue - green));
      }

      // And the trap, measured rather than walked into: the band edges do not
      // fall on bin boundaries, so this is § 6ba.8's staircase. Blue and red
      // wobble by a few percent while GREEN — a cancellation of +1e−5 against
      // −1.5e−6 — falls by half over the same refinement. Its digits belong to
      // the quadrature and only its order of magnitude to the objective.
      for (let i = 1; i < greens.length; i++) {
        expect(greens[i]!).toBeLessThan(greens[i - 1]!);
      }
      expect(greens[0]! / greens[greens.length - 1]!).toBeGreaterThan(1.9);
      const blues = counts.map((c) => bandRate(433, 500, c));
      expect(Math.max(...blues) / Math.min(...blues)).toBeLessThan(1.04);
    });
  });

  describe("§ 6bb.10 — the depth-dependent misregistration is bounded, and it is small", () => {
    it("parity with § 6ba.9's static 0.180% only at 83–86 mm of depth", () => {
      // Blue against red is a DIFFERENCE and not a cancellation, so unlike
      // § 6bb.9's green it is stable under refinement — 1.5% over 61 → 481
      // samples, which is why this bound survives being quoted.
      for (const count of [61, 121, 241, 481]) {
        const spread = Math.abs(bandRate(433, 500, count) - bandRate(600, 667, count));
        expect(spread).toBeGreaterThan(2.09e-5);
        expect(spread).toBeLessThan(2.17e-5);
        // § 6ba.9 measured the two channels' STATIC magnification difference at
        // 0.180%. The depth-dependent part is z·Δk, so the depth at which the
        // volume's contribution equals the plane's is one division.
        const crossoverMm = 1.8e-3 / spread;
        expect(crossoverMm).toBeGreaterThan(83);
        expect(crossoverMm).toBeLessThan(86.2);
        // At a thick preparation's 50 µm it is 0.06% of the static part: one
        // affine registration per channel is right for any specimen there is.
        expect((0.05 * spread) / 1.8e-3).toBeLessThan(6.1e-4);
      }
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
        layout: "exit",
        edgeSamples: EDGE,
        edgeRule: "crossing",
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
        layout: "exit",
        edgeSamples: EDGE,
        edgeRule: "crossing",
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

      // The NA is chromatic too — 0.60% across the band against the
      // wavelength's own 53%, so it is small and it is not nothing. (0.26% on the
      // paraxial aim: the real rim ray carries the doublet's spherochromatism, § 6r.9.)
      const naBlue = objectNumericalAperture(SYSTEM, 430);
      const naRed = objectNumericalAperture(SYSTEM, 680);
      expect(objectNumericalAperture(SYSTEM, DESIGN)).toBeCloseTo(0.1, 15);
      expect(Math.abs(naRed / naBlue - 1)).toBeGreaterThan(1e-3);
      expect(Math.abs(naRed / naBlue - 1)).toBeLessThan(7e-3);
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
            layout: "exit",
            edgeSamples: EDGE,
            edgeRule: "crossing",
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
      // 2.71433605269866e-5 on the aim layout's ruler: the raster's own
      // quadrature on a pixel 3e-13 different (§ 2q.6).
      expect(emitted[0]!).toBeCloseTo(2.714336052699539e-5, 17);
    });

    it("refuses a stack with no wavelengths", () => {
      expect(() =>
        fluorescenceSpectralVolume(SYSTEM, neutralVolumeEmitterDensity(HAZE), {
          size: SIZE,
          pupilSamples: PS,
          layout: "exit",
          edgeSamples: EDGE,
          edgeRule: "crossing",
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
          layout: "exit",
          edgeSamples: EDGE,
          edgeRule: "crossing",
          samples: [{ nm: DESIGN, weight: 1 }],
          slabs: { depthsMm: [0, 0.01], thicknessMm: [0.01] },
        }),
      ).toThrow(/must not brighten/);
    });
  });
});
