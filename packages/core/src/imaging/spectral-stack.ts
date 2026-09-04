import { resampleEnergyGrid, resampleIrradianceGrid } from "../wave/polychromatic";
import type { WavelengthSample } from "../trace/system";

/**
 * Putting per-wavelength images on one physical grid — the geometry both
 * spectral branches need, and the one choice on which they disagree.
 *
 * § 6r built this for brightfield and its header carries the argument: pixel
 * scale is ∝ λ, so at fixed `size` every wavelength's image comes back on a grid
 * of a different physical size, and adding the arrays bin for bin rescales each
 * one instead of stacking it. The common grid is the **bluest** plane's — the
 * smallest scale, so every resample reads strictly inside its own source and a
 * λ-dependent black border (which is a coloured vignette, and reads as optics)
 * is impossible by construction rather than reported.
 *
 * § 6ba needed the identical geometry for an emitter density and found exactly
 * one thing different, so this module is that geometry once, with the difference
 * as a parameter.
 *
 * ## The difference is `quantity`, and it is decided by the RASTERIZER
 *
 * `resampleIrradianceGrid` and `resampleEnergyGrid` differ by a factor `k²`, and
 * which is right is not a property of the branch — it is a property of what the
 * rasterizer put in the pixel.
 *
 *  - **Brightfield planes are an irradiance**, a value *at* a point. § 6n's
 *    `rasterizeSpecimen` warps an amplitude transmittance, which is a property
 *    of a point, so it carries no Jacobian; a uniform specimen images to exactly
 *    1 at every `size` (§ 6r.1). Warping a point property is coordinate
 *    substitution — no `k²`.
 *  - **Emitter planes are a flux**, the light landing in each pixel. § 6as's
 *    `rasterizeEmitterDensity` multiplies a density by the object area the pixel
 *    covers, and `incoherentPsf` sums to 1, so the convolution hands that unit
 *    through unchanged. Change the pixel size and each one holds more — `k²` is
 *    mandatory.
 *
 * So the Jacobian's presence at **authoring** time settles the resampler at
 * **stacking** time, and the two are separated by the whole imaging chain. That
 * is worth stating because the failure is symmetric, silent, and coloured both
 * ways: applying `k²` to an irradiance tilts the spectrum as 1/λ² and turns a
 * neutral specimen blue (§ 6r's finding), and *omitting* it from an energy stack
 * tilts as λ² and turns the same specimen red — § 6ba.3 measures the second at
 * 2.5008× on a 680 nm plane against a 430 nm ruler, which is `1/k²` exactly.
 * Neither is visible to an energy check: nothing is lost on either branch, only
 * rescaled.
 *
 * ## The ruler plane is copied, not interpolated
 *
 * At the plane that *sets* the scale, `k` is exactly 1, every destination lands
 * on a lattice point and the bilinear weights collapse, so that plane passes
 * through **bit for bit**. § 6r.3 pins it for irradiance and § 6ba.2 for energy —
 * which is what makes "the ruler is the bluest plane's" a statement about
 * arithmetic and not a rounding. It is also why the drop must be EVEN: an odd
 * difference would put the common grid's centre half a pixel off the source's,
 * the identity would turn into an interpolation, and every plane would shift
 * with it.
 */

/** Which physical quantity the planes hold — see the header. */
export type SpectralQuantity =
  /** Light landing in each pixel. Resampled with `k²`. An emitter plane. */
  | "energy"
  /** A value per unit area. Resampled with no Jacobian. A brightfield plane. */
  | "irradiance";

/** One wavelength's image, on its own grid, before stacking. */
export interface SpectralPlaneInput {
  readonly nm: number;
  /** Relative weight. Pure quadrature (Δλ) plus whatever the path applies once. */
  readonly weight: number;
  readonly size: number;
  readonly pixelScaleMm: number;
  /** In the object's own coordinates (NOT fftshifted). */
  readonly intensity: Float64Array;
}

/** One wavelength's plane, already on the stack's common physical grid. */
export interface StackedSpectralPlane {
  readonly nm: number;
  /** Normalized weight actually used (the weights sum to 1). */
  readonly weight: number;
  /** On the common grid. NOT pre-multiplied by `weight`. */
  readonly intensity: Float64Array;
  /** This plane's own grid scale, before resampling — the ruler it arrived on. */
  readonly sourcePixelScaleMm: number;
  /** `commonPixelScaleMm / sourcePixelScaleMm`; exactly 1 for the bluest plane. */
  readonly resampleRatio: number;
}

export interface StackedSpectralPlanes {
  /** Side of the common grid, in pixels — the input `size` less the crop. */
  readonly size: number;
  /** Image-plane millimetres per pixel of the common grid. */
  readonly pixelScaleMm: number;
  /** Weighted-mean wavelength (nm). Reported, NOT what the grid refers to. */
  readonly meanWavelengthNm: number;
  /** The wavelength whose own grid the common one is — the smallest scale. */
  readonly rulerWavelengthNm: number;
  readonly planes: readonly StackedSpectralPlane[];
  /** Pixels dropped from each side. See the header: the crop replaces truncation. */
  readonly croppedPixels: number;
  /** The normalized samples, for `spectralXyzBasis` to build an observer against. */
  readonly samples: readonly WavelengthSample[];
}

export interface StackSpectralOptions {
  /**
   * Side of the common grid. Defaults to `size − 2·croppedPixels`.
   *
   * Refused rather than clamped when it is large enough for a resample to reach
   * outside a source grid: the failure is a black border, and a black border is
   * a colour the caller would read as physics.
   *
   * Must leave an EVEN number of pixels to drop. An odd difference would put the
   * common grid's centre half a pixel off the source's, so the ruler plane would
   * be interpolated rather than copied and every plane would shift by half a
   * pixel — § 6n's own class of bug, and invisible in the picture.
   */
  readonly size?: number;
  /**
   * Pixels dropped from each side. Default 1 — the bilinear stencil's reach.
   *
   * A knob on the default `size` and nothing more, so passing both is refused
   * unless they agree rather than one silently winning.
   */
  readonly croppedPixels?: number;
}

/**
 * Put per-wavelength images on one common physical grid.
 *
 * `who` names the caller in every refusal, so a message stays about the function
 * the caller actually invoked rather than about this one.
 */
export function stackSpectralPlanes(
  input: readonly SpectralPlaneInput[],
  quantity: SpectralQuantity,
  options: StackSpectralOptions = {},
  who = "stackSpectralPlanes",
): StackedSpectralPlanes {
  if (input.length === 0) throw new Error(`${who}: no wavelengths`);
  const srcSize = input[0]!.size;
  let totalWeight = 0;
  for (const p of input) {
    if (p.size !== srcSize) {
      throw new Error(
        `${who}: every plane must share one grid size — ${p.nm} nm is ` +
          `${p.size} against ${srcSize}. The grids differ in physical SCALE, which is what ` +
          `this function exists to reconcile; differing in pixel COUNT is a caller error`,
      );
    }
    if (p.intensity.length !== p.size * p.size) {
      throw new Error(`${who}: ${p.nm} nm holds ${p.intensity.length} pixels`);
    }
    if (!(p.pixelScaleMm > 0)) {
      throw new Error(`${who}: ${p.nm} nm has pixel scale ${p.pixelScaleMm}`);
    }
    if (p.weight < 0) throw new Error(`${who}: ${p.nm} nm has weight ${p.weight}`);
    totalWeight += p.weight;
  }
  if (!(totalWeight > 0)) throw new Error(`${who}: weights sum to zero`);

  const croppedPixels = options.croppedPixels ?? 1;
  if (!Number.isInteger(croppedPixels) || croppedPixels < 0) {
    throw new Error(`${who}: croppedPixels must be ≥ 0, got ${croppedPixels}`);
  }
  const size = options.size ?? srcSize - 2 * croppedPixels;
  if (!Number.isInteger(size) || size < 1) {
    throw new Error(`${who}: common grid size must be ≥ 1, got ${size}`);
  }
  if (options.size !== undefined && options.croppedPixels !== undefined) {
    if (srcSize - 2 * options.croppedPixels !== options.size) {
      throw new Error(
        `${who}: size ${options.size} and croppedPixels ${options.croppedPixels} ` +
          `disagree on a ${srcSize} px source — croppedPixels is a knob on the default size, so ` +
          `pass one or the other rather than letting one silently win`,
      );
    }
  }
  // An odd difference would centre the common grid half a pixel off the source's:
  // `resample` maps destination x to srcSize/2 + (x − size/2)·k, so the ruler
  // plane's k = 1 identity turns into a half-pixel interpolation and every plane
  // shifts with it. Refused, for § 6n.2's reason — half a pixel of
  // misregistration is exactly the class of error a picture cannot show.
  if ((srcSize - size) % 2 !== 0) {
    throw new Error(
      `${who}: a ${size} px common grid on a ${srcSize} px source drops an odd ` +
        `${srcSize - size} pixels, so the two grids cannot share a centre — the ruler plane would ` +
        `be interpolated instead of copied and every plane would shift by half a pixel`,
    );
  }

  // The smallest scale, not the mean — see the header. Taken over the planes as
  // measured rather than assumed to be the shortest wavelength's, because the
  // reference sphere and the exit pupil are traced per λ too and a pathological
  // system could order them differently.
  let ruler = input[0]!;
  for (const p of input) if (p.pixelScaleMm < ruler.pixelScaleMm) ruler = p;
  const pixelScaleMm = ruler.pixelScaleMm;

  // Whether a destination can be sourced at all, checked once against the
  // WIDEST reach rather than discovered as zeros in the output. k ≤ 1 for every
  // plane by the choice above, so this is a statement about the crop. Since
  // § 8c the resampler needs slightly LESS margin than this — a destination cell
  // of width k ≤ 1 centred inside the source is covered where a bilinear stencil
  // still wanted `x0 + 1` — so the guard is conservative rather than exact, and
  // is left where it is: one pixel of crop is cheap and a wavelength-dependent
  // black border is not.
  const reach = size / 2;
  const hi = srcSize / 2 + (reach - 1);
  const lo = srcSize / 2 - reach;
  if (lo < 0 || hi + 1 > srcSize - 1) {
    throw new Error(
      `${who}: a common grid of ${size} px reaches outside a ${srcSize} px ` +
        `source — one pixel of margin is kept beyond the last destination, so the ` +
        `common grid must be at most ${srcSize - 2} px. Raising it would fill the border with ` +
        `zeros, which is a wavelength-dependent black frame and reads as a coloured vignette`,
    );
  }

  const resample = quantity === "energy" ? resampleEnergyGrid : resampleIrradianceGrid;
  const planes: StackedSpectralPlane[] = input.map((p) => ({
    nm: p.nm,
    weight: p.weight / totalWeight,
    intensity: resample(p.intensity, p.size, p.pixelScaleMm, pixelScaleMm, size),
    sourcePixelScaleMm: p.pixelScaleMm,
    resampleRatio: pixelScaleMm / p.pixelScaleMm,
  }));

  return {
    size,
    pixelScaleMm,
    meanWavelengthNm: input.reduce((a, p) => a + p.nm * p.weight, 0) / totalWeight,
    rulerWavelengthNm: ruler.nm,
    planes,
    croppedPixels: (srcSize - size) / 2,
    samples: planes.map((p) => ({ nm: p.nm, weight: p.weight })),
  };
}
