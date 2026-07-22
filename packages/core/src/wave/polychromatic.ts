import { OpticalSystem } from "../trace/system";
import { Psf, SystemPsfOptions } from "./psf";
import { GeometricPsfOptions, adaptivePsf } from "./geometric";

/**
 * Polychromatic PSF — stacking wavelengths onto one image.
 *
 * Polychromatic is the normal case, not a refinement: a star, a lamp and a
 * fluorophore all emit a spectrum, and the whole point of the achromat story
 * (roadmap step 4) is that colours focus differently.
 *
 * ## The one thing that makes this non-trivial
 *
 * **Pixel scale is proportional to λ.** From the pupil→image scale,
 *
 *     Δx = λ·R / (n·N·Δ_pupil)
 *
 * so every wavelength's PSF comes back on a grid of a DIFFERENT physical size.
 * A red pixel is a bigger piece of the image than a blue one. Summing the
 * arrays bin-for-bin therefore does not stack the wavelengths — it silently
 * rescales each one, which flattens exactly the chromatic differences the
 * calculation exists to show, and does it in a way that looks entirely
 * plausible.
 *
 * So each wavelength is **resampled onto a common physical grid** before the
 * weighted sum. The resampling carries the Jacobian (Δ_out/Δ_src)², because
 * `intensity` is energy per pixel rather than a density: change the pixel size
 * and the energy each one holds changes with its area.
 *
 * ## Weights and energy
 *
 * `WavelengthSample.weight` is source spectrum × detector response and need
 * not be normalized, so the weights are normalized here to sum to 1 — the
 * result is a weighted *average* over the spectrum. Each wavelength's own
 * energy is kept separate from its weight, because they mean different things:
 * the weight is how much of the spectrum this sample stands for, the energy is
 * how much of it the glass actually transmits at that λ. Both are reported.
 */

export interface PolychromaticOptions extends SystemPsfOptions, GeometricPsfOptions {
  /**
   * Image-plane sampling of the output grid (mm/pixel). Defaults to the
   * weighted-mean wavelength's own scale, which keeps the common grid inside
   * the range the individual grids span rather than extrapolating past either
   * end of it.
   */
  readonly pixelScaleMm?: number;
}

export interface PolychromaticComponent {
  readonly nm: number;
  /** Normalized weight actually used (the weights sum to 1). */
  readonly weight: number;
  /** Transmitted pupil energy at this wavelength. */
  readonly energy: number;
  /** Geometric share the fidelity switch chose for this wavelength. */
  readonly geometricWeight: number;
}

export interface PolychromaticPsf extends Psf {
  readonly components: readonly PolychromaticComponent[];
  /** Weighted-mean wavelength (nm) — what `pixelScaleMm` refers to. */
  readonly meanWavelengthNm: number;
  /**
   * Fraction of the summed energy that fell outside the common grid. Nonzero
   * when a long wavelength's PSF is physically wider than the grid chosen for
   * the mean — reported rather than hidden, because silently renormalizing it
   * away would turn truncation into a brightness error nobody could see.
   */
  readonly truncatedFraction: number;
}

/**
 * Resample a PSF onto a grid of a different pixel scale, bilinearly.
 *
 * The Jacobian `k²` is what makes this energy-correct: `intensity` holds
 * energy per pixel, so an output pixel covering k² times the area of a source
 * pixel holds k² times the energy.
 */
export function resamplePsf(p: Psf, targetPixelScaleMm: number, size = p.size): Float64Array {
  const out = new Float64Array(size * size);
  const k = targetPixelScaleMm / p.pixelScaleMm;
  const cs = p.size / 2;
  const co = size / 2;
  const n = p.size;

  for (let y = 0; y < size; y++) {
    const sy = cs + (y - co) * k;
    const y0 = Math.floor(sy);
    const fy = sy - y0;
    for (let x = 0; x < size; x++) {
      const sx = cs + (x - co) * k;
      const x0 = Math.floor(sx);
      const fx = sx - x0;
      if (x0 < 0 || y0 < 0 || x0 + 1 >= n || y0 + 1 >= n) continue;
      const i00 = p.intensity[y0 * n + x0]!;
      const i10 = p.intensity[y0 * n + x0 + 1]!;
      const i01 = p.intensity[(y0 + 1) * n + x0]!;
      const i11 = p.intensity[(y0 + 1) * n + x0 + 1]!;
      const top = i00 * (1 - fx) + i10 * fx;
      const bottom = i01 * (1 - fx) + i11 * fx;
      out[y * size + x] = (top * (1 - fy) + bottom * fy) * k * k;
    }
  }
  return out;
}

/**
 * The PSF of a system over its whole spectrum, at one field point.
 *
 * Each wavelength runs through the full pipeline independently — including the
 * fidelity switch, because a system can be diffraction-limited in red and
 * aliasing in blue — and the results are combined on a common physical grid.
 */
export function polychromaticPsf(
  system: OpticalSystem,
  fieldValue: number,
  options: PolychromaticOptions = {},
): PolychromaticPsf {
  const samples = system.wavelengths;
  if (samples.length === 0) throw new Error("system has no wavelengths");
  let totalWeight = 0;
  for (const w of samples) {
    if (w.weight < 0) throw new Error(`wavelength weight must be ≥ 0, got ${w.weight}`);
    totalWeight += w.weight;
  }
  if (totalWeight <= 0) throw new Error("wavelength weights sum to zero");

  const meanWavelengthNm =
    samples.reduce((acc, w) => acc + w.nm * w.weight, 0) / totalWeight;

  const each = samples.map((w) => ({
    sample: w,
    weight: w.weight / totalWeight,
    psf: adaptivePsf(system, fieldValue, w.nm, options),
  }));

  const first = each[0]!;
  const size = first.psf.size;
  // Pixel scale is ∝ λ, so the mean wavelength's scale follows from any one of
  // them without recomputing the pupil geometry.
  const pixelScaleMm =
    options.pixelScaleMm ?? first.psf.pixelScaleMm * (meanWavelengthNm / first.sample.nm);

  const intensity = new Float64Array(size * size);
  let energy = 0;
  let placed = 0;

  for (const e of each) {
    const resampled = resamplePsf(e.psf, pixelScaleMm, size);
    for (let i = 0; i < intensity.length; i++) {
      const v = resampled[i]! * e.weight;
      intensity[i] = intensity[i]! + v;
      placed += v;
    }
    energy += e.weight * e.psf.energy;
  }

  let peak = 0;
  for (let i = 0; i < intensity.length; i++) if (intensity[i]! > peak) peak = intensity[i]!;

  return {
    size,
    pupilSamples: first.psf.pupilSamples,
    intensity,
    pixelScaleMm,
    energy,
    peak,
    diffractionLimitedPeak: each.reduce(
      (acc, e) => acc + e.weight * e.psf.diffractionLimitedPeak,
      0,
    ),
    strehl: each.reduce((acc, e) => acc + e.weight * e.psf.strehl, 0),
    maxGridPhaseStepWaves: Math.max(...each.map((e) => e.psf.maxGridPhaseStepWaves)),
    wavelengthNm: meanWavelengthNm,
    fieldValue,
    components: each.map((e) => ({
      nm: e.sample.nm,
      weight: e.weight,
      energy: e.psf.energy,
      geometricWeight: e.psf.geometricWeight,
    })),
    meanWavelengthNm,
    truncatedFraction: energy > 0 ? Math.max(0, 1 - placed / energy) : 0,
  };
}
