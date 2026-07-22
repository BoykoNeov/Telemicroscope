import { WavelengthSample } from "../trace/system";
import { Xyz, xBar, yBar, zBar } from "./cmf";

/**
 * Turning a continuous spectrum into the handful of wavelengths the engine
 * actually traces.
 *
 * Every ray trace, OPD map and PSF is monochromatic. A spectrum reaches the
 * engine as `WavelengthSample[]` — 7–15 of them, per ARCHITECTURE — and the
 * cost of a render is linear in how many, so this is a quadrature problem with
 * an unusually expensive integrand.
 *
 * ## What `weight` must and must not contain
 *
 * `WavelengthSample.weight` is documented as "source spectrum × detector
 * response", which is right for a *monochrome* detector and wrong for colour.
 * The colour observer is three responses, not one, and they are applied per
 * channel in `spectralXyzBasis` below. Folding ȳ(λ) into the weight as well
 * would apply the luminance response twice and, worse, erase the distinction
 * between the channels — the image would come back grey.
 *
 * So for a colour render `weight` is **source spectrum × Δλ and nothing else**,
 * which is what `spectralSamples` produces. A monochrome detector's own
 * response belongs in the SED handed to it.
 *
 * ## Why the observer is integrated over each bin, not sampled at its centre
 *
 * Nine samples across the visible put 33 nm between them, and the CMFs have
 * real structure on that scale — x̄ alone has three lobes. Point-sampling them
 * aliases: an equal-energy spectrum, which is white by definition, comes back
 * at chromaticity (0.3382, 0.3405) instead of (0.3335, 0.3341). That is a
 * visible tint, it changes with sample count in a way that looks like physics,
 * and it is pure quadrature error.
 *
 * Integrating the observer across each sample's bin removes it: the same
 * equal-energy spectrum then lands within 10⁻⁵ of the converged value at
 * **any** count from 5 upward, because the approximation being made is only
 * that the *image* varies slowly across a bin — which it does — rather than
 * that the observer does, which it does not. The bins cost nothing per pixel:
 * they are folded into the basis once.
 */

/** Default sampling band: where the standard observer has essentially all of
 *  its response, and where an achromat's designers were aiming. */
export const VISIBLE_MIN_NM = 400;
export const VISIBLE_MAX_NM = 700;

export interface SpectralSamplingOptions {
  /** Number of wavelengths. Default 9 (ARCHITECTURE's 7–15 band). */
  readonly count?: number;
  readonly fromNm?: number;
  readonly toNm?: number;
}

/**
 * Sample a spectral power distribution into engine wavelengths.
 *
 * Midpoint rule: samples sit at bin centres rather than at the band edges, so
 * the bins tile the band exactly and no sample is wasted where the observer's
 * response has fallen to nothing. `weight` is SED(λ)·Δλ — see above for what
 * must NOT be in it.
 */
export function spectralSamples(
  spectralPower: (nm: number) => number,
  options: SpectralSamplingOptions = {},
): WavelengthSample[] {
  const count = options.count ?? 9;
  const from = options.fromNm ?? VISIBLE_MIN_NM;
  const to = options.toNm ?? VISIBLE_MAX_NM;
  if (!Number.isInteger(count) || count < 1) {
    throw new Error(`count must be a positive integer, got ${count}`);
  }
  if (!(to > from)) throw new Error(`empty band: ${from}…${to} nm`);

  const step = (to - from) / count;
  const out: WavelengthSample[] = [];
  for (let i = 0; i < count; i++) {
    const nm = from + (i + 0.5) * step;
    out.push({ nm, weight: spectralPower(nm) * step });
  }
  return out;
}

/**
 * Bin edges implied by a set of samples: midway between neighbours, with the
 * outer edges reflected out by half of the adjacent spacing.
 *
 * Derived from the sample positions rather than carried on the samples, so any
 * `WavelengthSample[]` works — including one a caller wrote by hand — and a
 * uniform grid from `spectralSamples` reproduces its own bins exactly.
 */
function binEdges(samples: readonly WavelengthSample[]): number[] {
  const n = samples.length;
  const edges = new Array<number>(n + 1);
  for (let i = 1; i < n; i++) edges[i] = (samples[i - 1]!.nm + samples[i]!.nm) / 2;
  if (n === 1) {
    // One sample carries no width information. Its bin is a point, which makes
    // the average a point sample — correct, and the only honest reading.
    edges[0] = samples[0]!.nm;
    edges[1] = samples[0]!.nm;
  } else {
    edges[0] = samples[0]!.nm - (edges[1]! - samples[0]!.nm);
    edges[n] = samples[n - 1]! .nm + (samples[n - 1]!.nm - edges[n - 1]!);
  }
  return edges;
}

/** Mean of `f` over [a, b] by the trapezoidal rule; a point sample if a == b. */
function meanOver(f: (nm: number) => number, a: number, b: number, steps: number): number {
  if (!(b > a)) return f(a);
  let acc = 0;
  for (let i = 0; i <= steps; i++) {
    acc += (i === 0 || i === steps ? 0.5 : 1) * f(a + (i * (b - a)) / steps);
  }
  return acc / steps;
}

export interface XyzBasis {
  /** Per-sample X weight: sample weight × the observer averaged over its bin. */
  readonly x: Float64Array;
  readonly y: Float64Array;
  readonly z: Float64Array;
}

/**
 * Precompute the per-wavelength XYZ weights for a spectrum.
 *
 * This is the join between the wave layer and colour, and it is what makes a
 * full-image colour render affordable: the observer, the bin integration and
 * the source spectrum all collapse into three numbers per wavelength, so the
 * per-pixel cost is a dot product of length `samples.length` and nothing else.
 */
export function spectralXyzBasis(
  samples: readonly WavelengthSample[],
  binSteps = 16,
): XyzBasis {
  const n = samples.length;
  const edges = binEdges(samples);
  const x = new Float64Array(n);
  const y = new Float64Array(n);
  const z = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const a = edges[i]!;
    const b = edges[i + 1]!;
    const w = samples[i]!.weight;
    x[i] = w * meanOver(xBar, a, b, binSteps);
    y[i] = w * meanOver(yBar, a, b, binSteps);
    z[i] = w * meanOver(zBar, a, b, binSteps);
  }
  return { x, y, z };
}

/**
 * Per-wavelength intensities at one point → XYZ.
 *
 *     X = Σ_λ I_λ · weight(λ) · x̄(λ)
 *
 * The per-λ form is not an optimisation, it is the whole point: a monochrome
 * stack has already summed the wavelengths away, and tinting that by its mean
 * λ produces a uniformly coloured image with no chromatic structure in it at
 * all — precisely erasing the effect the render exists to show.
 *
 * `intensities[i]` is the image value at `samples[i].nm`, and all of them must
 * already be on a common physical grid: pixel scale is ∝ λ, so combining
 * λ-dependent grids bin-for-bin rescales each instead of stacking it (see
 * wave/polychromatic).
 */
export function spectralXyz(
  samples: readonly WavelengthSample[],
  intensities: readonly number[],
  basis?: XyzBasis,
): Xyz {
  if (samples.length !== intensities.length) {
    throw new Error(
      `need one intensity per wavelength: ${samples.length} samples, ${intensities.length} intensities`,
    );
  }
  const b = basis ?? spectralXyzBasis(samples);
  let x = 0;
  let y = 0;
  let z = 0;
  for (let i = 0; i < intensities.length; i++) {
    const v = intensities[i]!;
    x += v * b.x[i]!;
    y += v * b.y[i]!;
    z += v * b.z[i]!;
  }
  return { x, y, z };
}
