import { fft2d, fftShift2d } from "../math/fft";
import { Psf } from "./psf";

/**
 * MTF — how much contrast survives, as a function of detail.
 *
 * The PSF answers "what does a star look like"; the MTF answers "can this
 * instrument separate these two things", which is the question users actually
 * ask. It is the modulus of the optical transfer function, and the OTF is the
 * Fourier transform of the PSF:
 *
 *     OTF = FFT{ PSF },      MTF = |OTF| / OTF(0)
 *
 * Equivalently — and this is the useful identity for reasoning about it — the
 * OTF is the autocorrelation of the pupil function, because the PSF is a
 * squared magnitude. Two consequences the code below relies on:
 *
 *  - **The cutoff is geometric, not aberrational.** Autocorrelating a pupil of
 *    diameter D gives support of diameter 2D, so the MTF reaches exactly zero
 *    at f_c = n·D/(λ·R) = 2·NA/λ and no further. Aberrations move contrast
 *    around below the cutoff; they never extend it. On the array that lands at
 *    exactly `psf.pupilSamples` frequency bins, which is a strong internal
 *    check on the whole pupil→image scale.
 *  - **Normalizing by OTF(0) divides out energy**, so an MTF is comparable
 *    between systems of different throughput — and is unaffected by which PSF
 *    branch produced it.
 *
 * Taking the transform of the PSF rather than autocorrelating the pupil
 * directly is deliberate: it means the MTF is a readout of whatever PSF it was
 * handed, so the geometric branch and the blend band (still to come) get an
 * MTF for free and cannot drift from their own PSF.
 */

export interface Mtf {
  /** Grid size; `modulation` is `size`×`size`, row-major. */
  readonly size: number;
  /** |OTF|/OTF(0), fftshifted so zero frequency is at (size/2, size/2). */
  readonly modulation: Float64Array;
  /** Cycles per mm per frequency bin. */
  readonly frequencyScale: number;
  /** Diffraction cutoff 2·NA/λ (cycles/mm) — where the MTF reaches zero. */
  readonly cutoffCyclesPerMm: number;
  readonly wavelengthNm: number;
  readonly fieldValue: number;
}

export function mtf(p: Psf): Mtf {
  const n = p.size;
  // The PSF is stored fftshifted. A circular shift multiplies the transform by
  // (−1)^(kx+ky), which is a phase — and MTF is a magnitude, so it drops out.
  // Transforming the shifted array directly is therefore exact, not sloppy.
  const re = Float64Array.from(p.intensity);
  const im = new Float64Array(n * n);
  fft2d(re, im, n);

  const dc = Math.hypot(re[0]!, im[0]!);
  const modulation = new Float64Array(n * n);
  if (dc > 0) {
    for (let i = 0; i < n * n; i++) modulation[i] = Math.hypot(re[i]!, im[i]!) / dc;
  }
  fftShift2d(modulation, n);

  const frequencyScale = 1 / (n * p.pixelScaleMm);
  return {
    size: n,
    modulation,
    frequencyScale,
    cutoffCyclesPerMm: p.pupilSamples * frequencyScale,
    wavelengthNm: p.wavelengthNm,
    fieldValue: p.fieldValue,
  };
}

/**
 * Diffraction-limited MTF of an unobstructed circular pupil, at normalized
 * frequency ν = f/f_c:
 *
 *     MTF(ν) = (2/π)·[ arccos ν − ν·√(1 − ν²) ],   0 ≤ ν ≤ 1
 *
 * The normalized area of overlap of two circles displaced by ν·D — i.e. the
 * pupil autocorrelation, evaluated in closed form. Standard result (Goodman,
 * *Introduction to Fourier Optics*); reproduced here because the UI wants to
 * draw the perfect-system curve behind the real one, and the validation ladder
 * pins the engine's MTF against it.
 */
export function diffractionLimitedMtf(nu: number): number {
  if (nu >= 1) return 0;
  const v = Math.max(0, nu);
  return (2 / Math.PI) * (Math.acos(v) - v * Math.sqrt(1 - v * v));
}

export interface MtfProfile {
  /** Normalized frequency ν = f/f_c. */
  readonly nu: Float64Array;
  readonly frequencyCyclesPerMm: Float64Array;
  readonly modulation: Float64Array;
}

/**
 * Azimuthally-averaged MTF out to the cutoff.
 *
 * Rotationally symmetric for an on-axis system, so the average is exact there
 * and merely a summary off axis — where tangential and sagittal MTF genuinely
 * differ and a directional readout is the honest one. That split is a separate
 * function when field curvature work arrives; this is the radial summary.
 */
export function mtfProfile(m: Mtf, bins: number, cutoffBins: number): MtfProfile {
  const n = m.size;
  const c = n / 2;
  const sums = new Float64Array(bins);
  const counts = new Float64Array(bins);

  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const r = Math.hypot(x - c, y - c);
      if (r > cutoffBins) continue;
      const b = Math.min(bins - 1, Math.floor((r / cutoffBins) * bins));
      sums[b] = sums[b]! + m.modulation[y * n + x]!;
      counts[b] = counts[b]! + 1;
    }
  }

  const nu = new Float64Array(bins);
  const frequencyCyclesPerMm = new Float64Array(bins);
  const modulation = new Float64Array(bins);
  for (let b = 0; b < bins; b++) {
    nu[b] = (b + 0.5) / bins;
    frequencyCyclesPerMm[b] = nu[b]! * m.cutoffCyclesPerMm;
    modulation[b] = counts[b]! > 0 ? sums[b]! / counts[b]! : 0;
  }
  return { nu, frequencyCyclesPerMm, modulation };
}

/** MTF at a normalized frequency ν, by bilinear sampling along +x. */
export function mtfAt(m: Mtf, nu: number, cutoffBins: number): number {
  const n = m.size;
  const c = n / 2;
  const x = c + nu * cutoffBins;
  const i = Math.floor(x);
  if (i < 0 || i + 1 >= n) return 0;
  const t = x - i;
  const a = m.modulation[c * n + i]!;
  const b = m.modulation[c * n + i + 1]!;
  return a * (1 - t) + b * t;
}
