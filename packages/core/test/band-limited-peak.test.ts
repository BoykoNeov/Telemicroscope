import { describe, it, expect } from "vitest";
import { bandLimitedPeak } from "../src/math/band-limited-peak";
import { fft2d } from "../src/math/fft";
import { renderedBestFocus, type FocusSweepOptions } from "../src/imaging/focus-surface";
import { formVolumePlane, neutralVolumeEmitterDensity } from "../src/imaging/spectral-volume";
import { gaussianBallEmitter, uniformSlabs } from "../src/imaging/emitter-volume";
import { imageRadiusForObjectHeight, objectFieldTile } from "../src/imaging/object-field";
import { finiteConjugateMicroscope, finiteConjugateObjective } from "../src/designs/microscope";
import type { OpticalSystem } from "../src/trace/system";
import type { PupilLayout } from "../src/wave/psf";

/**
 * § 2q.2 — a swept peak is read off the image, not off its brightest pixel.
 *
 * § 2q's trial flip killed `focus-surface.test.ts` at module level: the 4×/0.10
 * at 430 nm, 0.825 mm off axis, read as a plateau 1.22 depths of focus wide
 * against a threshold of 1. The aperture sine was constant across the sweep and
 * so was the lit lattice (1 751 nodes); what moved was the brightest PIXEL. The
 * image of an off-axis point slides sideways with defocus, the brightest sample
 * handed over from (65,64) to (64,64) at 0.1700 mm — at the vertex — and the
 * three-point parabola read the corner as a flat top. On the aim layout the
 * hand-over fell at 0.1790 mm, outside the parabola's three points, by luck.
 * § 6bf.5's pinned "ragged" exception (the same objective at 1.1 mm on aim,
 * 23% across three steps) is the same corner: its hand-over sits at 0.1341 mm,
 * beside its vertex at 0.1313.
 *
 * **Hypothesis:** read the peak as the maximum of the image's trigonometric
 * interpolant and the plateau figure is a property of the optics again —
 * step-invariant on both samples, below 1, while § 6bf.5's genuine plateau (the
 * 2× at 430 nm) still reads above 1 and is still refused. **Refuted by** a
 * spread over the three steps near the brightest pixel's, or the 2× passing.
 *
 * External numbers: a Gaussian's maximum is its amplitude at its centre, in
 * closed form; and the interpolant is the image only if the render has no
 * content at the Nyquist row and column, which is measured here, not assumed.
 */

const build = (M: number, NA: number): OpticalSystem =>
  finiteConjugateMicroscope({
    objective: finiteConjugateObjective({ magnification: M, numericalAperture: NA }),
  }).system;
const FOUR = build(4, 0.1);

const SIZE = 128;
const PS = 48;

/** A rotated elliptical Gaussian, σ 2.5 and 4 px at 30°, amplitude 1 at (x0, y0). */
function gaussian(n: number, x0: number, y0: number): Float64Array {
  const a = Math.PI / 6;
  const v = new Float64Array(n * n);
  for (let iy = 0; iy < n; iy++) {
    for (let ix = 0; ix < n; ix++) {
      const dx = ix - x0;
      const dy = iy - y0;
      const u = Math.cos(a) * dx + Math.sin(a) * dy;
      const w = -Math.sin(a) * dx + Math.cos(a) * dy;
      v[iy * n + ix] = Math.exp(-(u * u) / (2 * 2.5 * 2.5) - (w * w) / (2 * 4 * 4));
    }
  }
  return v;
}

/** Fractions of an image's non-DC energy at the Nyquist row/column and past ±pupilSamples. */
function spectralTail(values: Float64Array, n: number, ps: number) {
  const re = Float64Array.from(values);
  const im = new Float64Array(n * n);
  fft2d(re, im, n);
  let total = 0;
  let nyquist = 0;
  let beyond = 0;
  for (let l = 0; l < n; l++) {
    for (let k = 0; k < n; k++) {
      if (k === 0 && l === 0) continue;
      const e = re[l * n + k]! ** 2 + im[l * n + k]! ** 2;
      const kk = Math.abs(k < n / 2 ? k : k - n);
      const ll = Math.abs(l < n / 2 ? l : l - n);
      total += e;
      if (k === n / 2 || l === n / 2) nyquist += e;
      if (Math.max(kk, ll) > ps) beyond += e;
    }
  }
  return { nyquist: nyquist / total, beyond: beyond / total };
}

function plane(nm: number, h: number, focusMm: number, size: number, ps: number, layout: PupilLayout) {
  const frame = objectFieldTile(FOUR, {
    size,
    pupilSamples: ps,
    wavelengthNm: nm,
    layout,
    centreMm: { x: imageRadiusForObjectHeight(FOUR, h, nm), y: 0 },
  });
  const ball = gaussianBallEmitter({
    waistMm: 0.005,
    axialWaistMm: 0.004,
    peak: 1,
    centreMm: { x: frame.centreObjectMm.x, y: frame.centreObjectMm.y, z: 0 },
  });
  return formVolumePlane(
    FOUR,
    neutralVolumeEmitterDensity(ball),
    { size, pupilSamples: ps, samples: [], slabs: uniformSlabs(-0.008, 0.008, 3), focusMm, layout },
    { nm, weight: 1 },
    frame.centreMm,
  ).image.intensity;
}

const sweep = (layout: PupilLayout, peak: "pixel" | "band-limited", stepMm: number): FocusSweepOptions => ({
  size: SIZE,
  pupilSamples: PS,
  layout,
  peak,
  slabs: uniformSlabs(-0.008, 0.008, 3),
  probe: (centreMm) => gaussianBallEmitter({ waistMm: 0.005, axialWaistMm: 0.004, peak: 1, centreMm }),
  stepMm,
  halfMm: 0.03,
  maxPlateauDepths: 1e9,
});

const STEPS = [0.0025, 0.005, 0.01];
const spread = (xs: readonly number[]): number => Math.max(...xs) / Math.min(...xs) - 1;

describe("§ 2q.2 — a swept peak is read off the image, not off its brightest pixel", () => {
  it("recovers a Gaussian's amplitude and centre between pixels, where the brightest pixel cannot", () => {
    for (const n of [64, 128]) {
      for (const [x0, y0] of [
        [n / 2 + 0.37, n / 2 - 0.21],
        [n / 2 - 2.5, n / 2 + 3.5],
      ] as const) {
        const image = gaussian(n, x0, y0);
        const p = bandLimitedPeak(image, n);
        expect(Math.abs(p.value - 1)).toBeLessThan(1e-14);
        expect(Math.abs(p.x - x0)).toBeLessThan(1e-12);
        expect(Math.abs(p.y - y0)).toBeLessThan(1e-12);
        // The pixel readout is the brightest sample, and short of the amplitude.
        let brightest = 0;
        for (const v of image) if (v > brightest) brightest = v;
        expect(p.pixelValue).toBe(brightest);
        expect(p.pixelValue).toBeLessThan(0.993);
      }
    }
  });

  it("refuses a ring — its maximum runs round it, and this reads a peak", () => {
    const n = 128;
    const ring = new Float64Array(n * n);
    for (let iy = 0; iy < n; iy++) {
      for (let ix = 0; ix < n; ix++) {
        const r = Math.hypot(ix - 64.3, iy - 63.8);
        ring[iy * n + ix] = Math.exp(-((r - 12) ** 2) / (2 * 2 * 2));
      }
    }
    expect(() => bandLimitedPeak(ring, n)).toThrow(/bandLimitedPeak/);
  });

  it("the rendered plane IS band-limited on its grid when size > 2·pupilSamples, and not at 2·pupilSamples", () => {
    // Off axis at the sample that refused, on both layouts: round-off.
    for (const layout of ["aim", "exit"] as const) {
      const tail = spectralTail(plane(430, 0.825, 0.17, SIZE, PS, layout), SIZE, PS);
      expect(tail.nyquist).toBeLessThan(1e-28);
      expect(tail.beyond).toBeLessThan(1e-28);
    }
    // On axis on the exit layout the rim falls on lattice nodes, the pupil spans
    // pupilSamples + 1 of them, and at size = 2·pupilSamples the image reaches
    // the Nyquist bin — small, and not round-off. Hence the strict inequality.
    const atTwo = spectralTail(plane(550, 0, 0, 32, 16, "exit"), 32, 16);
    expect(atTwo.nyquist).toBeGreaterThan(1e-22);
    expect(() =>
      renderedBestFocus(FOUR, 550, 0, { ...sweep("exit", "band-limited", 0.005), size: 32, pupilSamples: 16 }),
    ).toThrow(/needs size > 2·pupilSamples/);
  });

  it("the sample § 2q's flip refused is step-invariant and sharp, where the pixel readout swung past 1", () => {
    const at = (peak: "pixel" | "band-limited", step: number) =>
      renderedBestFocus(FOUR, 430, 0.825, { ...sweep("exit", peak, step), aboutMm: 0.169 }).plateauDepths;
    const band = STEPS.map((s) => at("band-limited", s));
    expect(band[1]).toBeCloseTo(0.7323, 4);
    expect(spread(band)).toBeLessThan(0.002);
    for (const p of band) expect(p).toBeLessThan(1);
    // The same sweep read off the brightest pixel: the corner at the vertex.
    expect(at("pixel", 0.005)).toBeCloseTo(1.1869, 4);
  });

  it("§ 6bf.5's ragged exception was the same corner: read off the image it is regular", () => {
    const band = STEPS.map(
      (s) =>
        renderedBestFocus(FOUR, 430, 1.1, { ...sweep("aim", "band-limited", s), aboutMm: 0.1313 })
          .plateauDepths,
    );
    // 23.5% on the brightest pixel (§ 6bf.5); 0.3% here.
    expect(spread(band)).toBeLessThan(0.004);
    expect(band[1]).toBeCloseTo(0.6567, 4);
  });

  it("and the genuine plateau is still refused, on both layouts", () => {
    const two = build(2, 0.1);
    for (const layout of ["aim", "exit"] as const) {
      expect(() =>
        renderedBestFocus(two, 430, 0.7, {
          ...sweep(layout, "band-limited", 0.005),
          aboutMm: 0.5036,
          maxPlateauDepths: 1,
        }),
      ).toThrow(/is a plateau/);
    }
  });
});
