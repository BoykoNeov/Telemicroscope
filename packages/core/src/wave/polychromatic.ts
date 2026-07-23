import { OpticalSystem, WavelengthSample } from "../trace/system";
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
 * So each wavelength is **resampled onto a common physical grid** before
 * anything else happens to it. The resampling carries the Jacobian
 * (Δ_out/Δ_src)², because `intensity` is energy per pixel rather than a
 * density: change the pixel size and the energy each one holds changes with
 * its area.
 *
 * ## Why the stack is a type, and not just a step inside the sum
 *
 * `spectralStack` stops one move short of summing: it hands back the
 * per-wavelength images, already on the common grid, with their weights beside
 * them rather than multiplied in. Two consumers need exactly that and disagree
 * about the last step.
 *
 * - `polychromaticPsf` collapses it with a **scalar** weight per wavelength,
 *   giving the monochrome PSF.
 * - Colour collapses it with **three** weights per wavelength — the observer's
 *   x̄, ȳ, z̄ — giving an image with chromatic structure in it.
 *
 * Colour cannot be recovered from the monochrome result: the wavelengths have
 * already been summed away, and tinting that by the mean λ produces a
 * uniformly coloured image with no fringing anywhere in it. Sharing the stack
 * rather than the sum is what keeps both honest about the common grid, instead
 * of the colour path growing a second resampler that could drift from this one.
 *
 * ## Seeing rides through untouched, and that is the point
 *
 * A `seeing` phase screen on the options threads to every wavelength's
 * `adaptivePsf` as the same object — so the stack applies ONE atmosphere to the
 * whole spectrum, and because the screen is stored as OPD the bluer colours pick
 * up proportionally more waves of it (r₀ ∝ λ^(6/5)) with no special case here.
 * The under-resolution guard follows for free: `maxGridPhaseStepWaves` below is
 * the max across wavelengths, so it keys on the bluest, worst-resolved plane.
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

/**
 * One wavelength's image, already on the stack's common physical grid.
 *
 * `intensity` is NOT pre-multiplied by `weight`. That is the whole reason this
 * type exists — a caller applying a three-channel observer needs the image and
 * the weight separately.
 */
export interface SpectralPlane extends PolychromaticComponent {
  readonly intensity: Float64Array;
  /** The aberration-free counterpart, when it was requested and exists. */
  readonly diffractionLimited?: Float64Array;
}

export interface SpectralStack {
  readonly size: number;
  readonly pixelScaleMm: number;
  readonly pupilSamples: number;
  /** Weighted-mean wavelength (nm) — what `pixelScaleMm` refers to. */
  readonly meanWavelengthNm: number;
  readonly planes: readonly SpectralPlane[];
  readonly maxGridPhaseStepWaves: number;
  readonly fieldValue: number;
  /** Σ weight·energy — what the stack would integrate to with no truncation. */
  readonly energy: number;
  /**
   * Fraction of the summed energy that fell outside the common grid. Nonzero
   * when a long wavelength's PSF is physically wider than the grid chosen for
   * the mean — reported rather than hidden, because silently renormalizing it
   * away would turn truncation into a brightness error nobody could see.
   */
  readonly truncatedFraction: number;
  /** The normalized samples, for building an observer basis against. */
  readonly samples: readonly WavelengthSample[];
}

export interface PolychromaticPsf extends Psf {
  readonly components: readonly PolychromaticComponent[];
  readonly meanWavelengthNm: number;
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
  return resampleGrid(p.intensity, p.size, p.pixelScaleMm, targetPixelScaleMm, size);
}

function resampleGrid(
  src: Float64Array,
  srcSize: number,
  srcPixelScaleMm: number,
  targetPixelScaleMm: number,
  size: number,
): Float64Array {
  const out = new Float64Array(size * size);
  const k = targetPixelScaleMm / srcPixelScaleMm;
  const cs = srcSize / 2;
  const co = size / 2;
  const n = srcSize;

  for (let y = 0; y < size; y++) {
    const sy = cs + (y - co) * k;
    const y0 = Math.floor(sy);
    const fy = sy - y0;
    for (let x = 0; x < size; x++) {
      const sx = cs + (x - co) * k;
      const x0 = Math.floor(sx);
      const fx = sx - x0;
      if (x0 < 0 || y0 < 0 || x0 + 1 >= n || y0 + 1 >= n) continue;
      const i00 = src[y0 * n + x0]!;
      const i10 = src[y0 * n + x0 + 1]!;
      const i01 = src[(y0 + 1) * n + x0]!;
      const i11 = src[(y0 + 1) * n + x0 + 1]!;
      const top = i00 * (1 - fx) + i10 * fx;
      const bottom = i01 * (1 - fx) + i11 * fx;
      out[y * size + x] = (top * (1 - fy) + bottom * fy) * k * k;
    }
  }
  return out;
}

/**
 * Trace every wavelength and put them all on one physical grid.
 *
 * Each runs through the full pipeline independently — including the fidelity
 * switch, because a system can be diffraction-limited in red and aliasing in
 * blue.
 */
export function spectralStack(
  system: OpticalSystem,
  fieldValue: number,
  options: PolychromaticOptions = {},
): SpectralStack {
  const samples = system.wavelengths;
  if (samples.length === 0) throw new Error("system has no wavelengths");
  let totalWeight = 0;
  for (const w of samples) {
    if (w.weight < 0) throw new Error(`wavelength weight must be ≥ 0, got ${w.weight}`);
    totalWeight += w.weight;
  }
  if (totalWeight <= 0) throw new Error("wavelength weights sum to zero");

  const meanWavelengthNm = samples.reduce((acc, w) => acc + w.nm * w.weight, 0) / totalWeight;

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

  let energy = 0;
  let placed = 0;
  const planes: SpectralPlane[] = each.map((e) => {
    const intensity = resamplePsf(e.psf, pixelScaleMm, size);
    let kept = 0;
    for (let i = 0; i < intensity.length; i++) kept += intensity[i]!;
    placed += e.weight * kept;
    energy += e.weight * e.psf.energy;
    const flat = e.psf.diffractionLimitedIntensity;
    return {
      nm: e.sample.nm,
      weight: e.weight,
      energy: e.psf.energy,
      geometricWeight: e.psf.geometricWeight,
      intensity,
      ...(flat === undefined
        ? {}
        : {
            diffractionLimited: resampleGrid(
              flat,
              e.psf.size,
              e.psf.pixelScaleMm,
              pixelScaleMm,
              size,
            ),
          }),
    };
  });

  return {
    size,
    pixelScaleMm,
    pupilSamples: first.psf.pupilSamples,
    meanWavelengthNm,
    planes,
    maxGridPhaseStepWaves: Math.max(...each.map((e) => e.psf.maxGridPhaseStepWaves)),
    fieldValue,
    energy,
    truncatedFraction: energy > 0 ? Math.max(0, 1 - placed / energy) : 0,
    samples: planes.map((p) => ({ nm: p.nm, weight: p.weight })),
  };
}

/**
 * The PSF of a system over its whole spectrum, at one field point.
 *
 * The scalar collapse of `spectralStack`: one weight per wavelength, summed
 * into a single monochrome image.
 */
export function polychromaticPsf(
  system: OpticalSystem,
  fieldValue: number,
  options: PolychromaticOptions = {},
): PolychromaticPsf {
  const stack = spectralStack(system, fieldValue, { ...options, keepDiffractionLimited: true });
  const size = stack.size;

  const intensity = new Float64Array(size * size);
  // A Strehl ratio for a spectrum compares the stacked peak against the peak
  // of an aberration-free stack BUILT THE SAME WAY. Averaging the components'
  // Strehls instead would assume every wavelength puts its peak on the same
  // pixel — false exactly when there is chromatic defocus or lateral colour,
  // which is the case the achromat story exists to show. And the components'
  // aberration-free peaks cannot simply be summed either: each lives on its
  // own λ-dependent grid, so they are energies-per-pixel in different units.
  const reference = stack.planes.every((p) => p.diffractionLimited !== undefined)
    ? new Float64Array(size * size)
    : null;

  for (const p of stack.planes) {
    for (let i = 0; i < intensity.length; i++) {
      intensity[i] = intensity[i]! + p.intensity[i]! * p.weight;
    }
    if (reference !== null) {
      const flat = p.diffractionLimited!;
      for (let i = 0; i < reference.length; i++) {
        reference[i] = reference[i]! + flat[i]! * p.weight;
      }
    }
  }

  let peak = 0;
  for (let i = 0; i < intensity.length; i++) if (intensity[i]! > peak) peak = intensity[i]!;

  // Zero when any component fell to the geometric branch: a ray histogram has
  // no aberration-free counterpart, so there is no honest denominator.
  let referencePeak = 0;
  if (reference !== null) {
    for (let i = 0; i < reference.length; i++) {
      if (reference[i]! > referencePeak) referencePeak = reference[i]!;
    }
  }

  return {
    size,
    pupilSamples: stack.pupilSamples,
    intensity,
    pixelScaleMm: stack.pixelScaleMm,
    energy: stack.energy,
    peak,
    diffractionLimitedPeak: referencePeak,
    strehl: referencePeak > 0 ? peak / referencePeak : 0,
    ...(reference === null ? {} : { diffractionLimitedIntensity: reference }),
    maxGridPhaseStepWaves: stack.maxGridPhaseStepWaves,
    wavelengthNm: stack.meanWavelengthNm,
    fieldValue,
    components: stack.planes.map((p) => ({
      nm: p.nm,
      weight: p.weight,
      energy: p.energy,
      geometricWeight: p.geometricWeight,
    })),
    meanWavelengthNm: stack.meanWavelengthNm,
    truncatedFraction: stack.truncatedFraction,
  };
}
