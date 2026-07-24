import { describe, it, expect } from "vitest";
import {
  ARCSEC_PER_RAD,
  Sensor,
  criticalPitchMm,
  fieldOfView,
  plateScale,
  resampleGridToSensor,
  resampleToSensor,
  samplingRegime,
} from "../src/imaging/camera";
import { emptyColorImage } from "../src/imaging/image";
import { imagePointOf } from "../src/imaging/scene";
import { fft1d } from "../src/math/fft";
import { systemProperties } from "../src/trace/paraxial";
import { psf } from "../src/wave/psf";
import { mtf } from "../src/wave/mtf";
import { bestFocus, withFocus } from "../src/analysis/focus";
import { EPD_MM, FOCAL_MM, FOCUS_NM, PSF_OPTIONS, heroPair, heroSystem } from "./support/heroScene";

/**
 * Camera mode, part 1: the sensor and its sampling.
 *
 * Two independent capabilities, pinned apart. **Pixel scale** (plate scale and
 * field of view) is optical geometry through the traced EFL and chief ray.
 * **Sensor sampling** (`resampleToSensor`) is what a pixel physically does —
 * integrate over its area — which is a box filter, so it carries a
 * detector-footprint MTF and aliases when it undersamples. Those two are
 * properties of the rebin alone, so they are pinned on synthetic targets with
 * no optical system in the way.
 *
 * Exposure is a separate unit (VALIDATION § 5s); nothing here scales brightness
 * by anything but geometry.
 */

const focused = (() => {
  const base = heroSystem(heroPair().achromat);
  const focus = bestFocus(base, "minRmsWavefront", { wavelengthNm: FOCUS_NM });
  return withFocus(base, focus.offsetFromLastVertex);
})();

/**
 * A fine cosine target 1 + m·cos(2π·f·x), constant along y, on a grid that
 * extends `marginPix` sensor-pixels past the sensor on every side so every
 * sensor pixel is fully covered — no edge leakage to contaminate the spectrum.
 * `f` is a physical frequency (cycles/mm); pick f = k/(cols·pitch) to land the
 * FFT peak on integer bin k.
 */
function cosineSource(
  sensor: Sensor,
  freqPerMm: number,
  m: number,
  os: number,
  marginPix: number,
): { grid: Float64Array; cols: number; rows: number; pitch: number } {
  const cols = (sensor.cols + 2 * marginPix) * os;
  const rows = (sensor.rows + 2 * marginPix) * os;
  const pitch = sensor.pixelPitchMm / os;
  const origin = cols / 2;
  const grid = new Float64Array(cols * rows);
  for (let x = 0; x < cols; x++) {
    const v = 1 + m * Math.cos(2 * Math.PI * freqPerMm * (x - origin) * pitch);
    for (let y = 0; y < rows; y++) grid[y * cols + x] = v;
  }
  return { grid, cols, rows, pitch };
}

/** Modulation depth and dominant frequency bin of one sensor row, via FFT. */
function spectrum(row: Float64Array): { dc: number; peakBin: number; peakMag: number } {
  const n = row.length;
  const re = Float64Array.from(row);
  const im = new Float64Array(n);
  fft1d(re, im);
  const dc = Math.hypot(re[0]!, im[0]!);
  let peakBin = 0;
  let peakMag = 0;
  for (let k = 1; k <= n / 2; k++) {
    const mag = Math.hypot(re[k]!, im[k]!);
    if (mag > peakMag) {
      peakMag = mag;
      peakBin = k;
    }
  }
  return { dc, peakBin, peakMag };
}

describe("plate scale and field of view — the pixel's angle on the sky", () => {
  it("plate scale = 206265 · pitch / EFL, with EFL from the trace", () => {
    // The only non-trivial input is EFL, and it comes from the paraxial trace.
    // Pinned here to the design's 100 mm and the external 206265″/rad, so the
    // rung reddens if the trace drifts, the ratio inverts, or the constant is
    // wrong. ARCSEC_PER_RAD is asserted against its closed form first.
    expect(ARCSEC_PER_RAD).toBeCloseTo(206264.806, 2);

    const efl = systemProperties(focused.prescription, FOCUS_NM).efl;
    expect(efl).toBeCloseTo(FOCAL_MM, 0); // 100 mm, traced

    const sensor: Sensor = { pixelPitchMm: 0.005, cols: 1024, rows: 1024 };
    const ps = plateScale(focused, sensor, FOCUS_NM);
    expect(ps.arcsecPerPixel).toBeCloseTo((ARCSEC_PER_RAD * sensor.pixelPitchMm) / FOCAL_MM, 1);
    expect(ps.radPerPixel).toBeCloseTo(sensor.pixelPitchMm / efl, 10);
  });

  it("field of view is the exact inverse of the traced chief-ray map", () => {
    // FOV is found by asking which field angle's chief ray lands at the sensor
    // edge — the inverse of `imagePointOf`, not EFL·tan θ. The strong pin is the
    // round trip: feeding the reported half-FOV back through the forward map
    // must land exactly on the sensor edge. That is what makes it carry the
    // distortion `EFL·tan θ` is defined to have none of (mechanism § 3c).
    const sensor: Sensor = { pixelPitchMm: 0.005, cols: 1600, rows: 1200 };
    const fov = fieldOfView(focused, sensor, FOCUS_NM);

    const halfWidthMm = (sensor.cols * sensor.pixelPitchMm) / 2;
    const halfHeightMm = (sensor.rows * sensor.pixelPitchMm) / 2;
    const landedW = imagePointOf(focused, fov.widthDeg / 2, 0, FOCUS_NM);
    const landedH = imagePointOf(focused, fov.heightDeg / 2, 0, FOCUS_NM);
    expect(Math.hypot(landedW.x, landedW.y)).toBeCloseTo(halfWidthMm, 6);
    expect(Math.hypot(landedH.x, landedH.y)).toBeCloseTo(halfHeightMm, 6);

    // Sanity: near the paraxial pinhole angle, since this achromat's distortion
    // is small at a couple of degrees.
    const paraxialDeg = 2 * Math.atan(halfWidthMm / FOCAL_MM) * (180 / Math.PI);
    expect(fov.widthDeg).toBeCloseTo(paraxialDeg, 1);
  });
});

describe("the sensor pixel is a box integrator, not a point sampler", () => {
  it("rebinning sums footprint energy — it does not average", () => {
    // `intensity` is energy per pixel, so a sensor pixel covering 16 native
    // pixels collects 16× the energy, exactly as a larger photosite does. The
    // failure mode this guards is dividing by the footprint (an average), which
    // would silently dim every camera-mode render by the pixel-area ratio.
    const srcCols = 64;
    const srcRows = 64;
    const srcPitch = 0.001;
    const sensor: Sensor = { pixelPitchMm: 0.004, cols: 16, rows: 16 }; // 4× pitch → 16 native/pixel
    const uniform = new Float64Array(srcCols * srcRows).fill(1);
    const out = resampleGridToSensor(uniform, srcCols, srcRows, srcPitch, sensor);
    // Interior sensor pixels each gather the full 4×4 footprint.
    expect(out[8 * 16 + 8]!).toBeCloseTo(16, 9);
  });

  it("conserves total energy when the sensor covers the whole image", () => {
    // A partition of the plane: every native pixel's energy lands somewhere on
    // the sensor. Consistency check (both sides are the engine's own sums), not
    // an external pin — labelled as such.
    const srcCols = 96;
    const srcRows = 96;
    const srcPitch = 0.001;
    // Sensor extent ≥ native extent so nothing falls off the edge.
    const sensor: Sensor = { pixelPitchMm: 0.003, cols: 40, rows: 40 };
    const src = new Float64Array(srcCols * srcRows);
    for (let i = 0; i < src.length; i++) src[i] = ((i * 37) % 100) / 100; // arbitrary texture
    let srcSum = 0;
    for (const v of src) srcSum += v;
    const out = resampleGridToSensor(src, srcCols, srcRows, srcPitch, sensor);
    let outSum = 0;
    for (const v of out) outSum += v;
    expect(outSum).toBeCloseTo(srcSum, 9);
  });

  it("keeps a centred feature centred — no half-pixel registration drift", () => {
    // The one rung the energy / frequency / symmetric-field rungs are all blind
    // to: a shift. Both grids are sample-at-centre (a star at index N/2 sits at
    // x=0, as scene.ts places it), so a source symmetric about N/2 must rebin to
    // a sensor image whose centroid is 0. A half-pixel cell/sample confusion —
    // invisible to every other rung here — lands it ~½ a pixel off, which is the
    // golden-image drift § 3b warns of, on a module whose headline is sub-pixel
    // plate scale.
    const srcN = 256;
    const srcPitch = 0.001;
    const src = new Float64Array(srcN);
    for (let i = 0; i < srcN; i++) {
      const k = i - srcN / 2;
      src[i] = Math.exp(-(k * k) / (2 * 20 * 20)); // centred Gaussian
    }
    const sensor: Sensor = { pixelPitchMm: 0.004, cols: 64, rows: 1 };
    const out = resampleGridToSensor(src, srcN, 1, srcPitch, sensor);
    let num = 0;
    let den = 0;
    for (let j = 0; j < sensor.cols; j++) {
      num += out[j]! * (j - sensor.cols / 2); // sample-at-centre index
      den += out[j]!;
    }
    expect(num / den).toBeCloseTo(0, 6);
  });

  it("applies the detector-footprint MTF sinc(π·f·pitch) below Nyquist", () => {
    // Box-integrating over a pixel of width `pitch` convolves the image with a
    // box, whose transfer is sinc(π·f·pitch) — the textbook detector MTF. Two
    // sub-Nyquist frequencies pin the *shape*: a flat response would pass both
    // at 1. The native grid is 16× finer than the sensor so its own sinc is
    // negligible (< 0.1%).
    const cols = 128;
    const pitch = 0.01;
    const sensor: Sensor = { pixelPitchMm: pitch, cols, rows: 8 };
    const L = cols * pitch; // sensor field width (mm)
    const m = 0.5;

    for (const k of [20, 40]) {
      const freqPerMm = k / L; // integer bin k, below Nyquist (64)
      const { grid, cols: sc, rows: sr, pitch: sp } = cosineSource(sensor, freqPerMm, m, 16, 4);
      const out = resampleGridToSensor(grid, sc, sr, sp, sensor);
      const midRow = Math.floor(sensor.rows / 2) * sensor.cols;
      const { dc, peakBin, peakMag } = spectrum(out.slice(midRow, midRow + cols));
      expect(peakBin).toBe(k); // transferred, not aliased
      const measuredModulation = (2 * peakMag) / dc; // = m · transfer
      const sinc = (a: number) => (a === 0 ? 1 : Math.sin(a) / a);
      const expected = m * sinc(Math.PI * freqPerMm * pitch);
      expect(measuredModulation).toBeCloseTo(expected, 2);
    }
  });

  it("aliases a target above Nyquist to |f_s − f|", () => {
    // The frequency, not the amplitude — the footprint sinc has already
    // attenuated the amplitude near the cutoff, but the aliased *frequency* is
    // fixed by the sampling rate alone. A target at k above the sensor Nyquist
    // (cols/2) folds to bin cols − k.
    const cols = 128;
    const pitch = 0.01;
    const sensor: Sensor = { pixelPitchMm: pitch, cols, rows: 8 };
    const L = cols * pitch;

    const kIn = 88; // above Nyquist bin 64
    const { grid, cols: sc, rows: sr, pitch: sp } = cosineSource(sensor, kIn / L, 0.5, 16, 4);
    const out = resampleGridToSensor(grid, sc, sr, sp, sensor);
    const midRow = Math.floor(sensor.rows / 2) * sensor.cols;
    const { peakBin } = spectrum(out.slice(midRow, midRow + cols));
    expect(peakBin).toBe(cols - kIn); // 40 = |f_s − f| in cycles/field
  });
});

describe("critical sampling ties the pitch to the diffraction cutoff", () => {
  it("λ/(4·NA) matches the traced MTF cutoff by an independent route", () => {
    // criticalPitchMm is a scalar closed form from λ and NA. The MTF cutoff is
    // built from the pupil autocorrelation on the FFT grid — a different
    // computation entirely. That they agree (pitch · 2 · cutoff = 1) is physics,
    // not construction.
    const efl = systemProperties(focused.prescription, FOCUS_NM).efl;
    const naImage = EPD_MM / (2 * efl);
    const pc = criticalPitchMm(FOCUS_NM, naImage);

    const m = mtf(psf(focused, 0, FOCUS_NM, PSF_OPTIONS));
    expect(pc * 2 * m.cutoffCyclesPerMm).toBeCloseTo(1, 1);

    // Regime classifier: half the critical pitch oversamples, twice undersamples.
    expect(samplingRegime(pc, pc)).toBe("critical");
    expect(samplingRegime(pc / 2, pc)).toBe("oversampled");
    expect(samplingRegime(pc * 2, pc)).toBe("undersampled");
  });
});

describe("resampleToSensor rebins a colour image", () => {
  it("carries the sensor pitch and conserves each channel's energy", () => {
    const src = emptyColorImage(64, 64, 0.001);
    for (let i = 0; i < src.xyz.length; i++) src.xyz[i] = (i % 7) / 7;
    // Sensor extent (0.088 mm) exceeds the source's (0.064 mm), so all the
    // source energy lands on it — energy conservation is only meaningful when
    // nothing falls off the edge.
    const sensor: Sensor = { pixelPitchMm: 0.004, cols: 22, rows: 22 };
    const out = resampleToSensor(src, sensor);
    expect(out.pixelScaleMm).toBe(0.004);
    expect(out.width).toBe(22);
    for (let c = 0; c < 3; c++) {
      let a = 0;
      let b = 0;
      for (let i = c; i < src.xyz.length; i += 3) a += src.xyz[i]!;
      for (let i = c; i < out.xyz.length; i += 3) b += out.xyz[i]!;
      expect(b).toBeCloseTo(a, 9);
    }
  });
});
