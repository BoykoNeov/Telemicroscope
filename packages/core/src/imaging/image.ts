import { Xyz } from "../photometry/cmf";
import { Rgb, encodeGamma, xyzToLinearRgb } from "../photometry/srgb";
import { XyzBasis, spectralXyzBasis } from "../photometry/spectrum";
import { SpectralStack } from "../wave/polychromatic";

/**
 * The rendered image, and the one place wavelengths become colour.
 *
 * ## Why this is a per-wavelength operation and cannot be anything else
 *
 * The temptation is to render the monochrome polychromatic PSF and tint it.
 * That produces a uniformly coloured image with no chromatic structure
 * anywhere in it, because `polychromaticPsf` has already collapsed the
 * wavelengths with a scalar weight — the information the tint would need was
 * summed away one step earlier. Colour has to be integrated *while* the
 * wavelengths are still separate:
 *
 *     X(pixel) = Σ_λ I_λ(pixel) · weight(λ) · x̄(λ)
 *
 * and likewise Y and Z. That is exactly what `SpectralStack` exists to make
 * possible, and the reason it stops one move short of summing.
 *
 * The other half is that every `I_λ` must already sit on a **common physical
 * grid** — pixel scale is ∝ λ, so a red pixel is a bigger piece of the image
 * than a blue one and combining them by index rescales rather than stacks. The
 * stack has done that; nothing here resamples again.
 *
 * ## Linear light, everywhere until the last line
 *
 * `ColorImage` holds CIE XYZ, which is linear in energy. Every operation this
 * layer performs — stacking, convolution, exposure, white balance — is a
 * weighted sum of intensities, and a weighted sum of gamma-encoded values is
 * not the encoding of the sum. Gamma is applied exactly once, in `toSrgbBytes`,
 * on the way out to a screen.
 */

export interface ColorImage {
  readonly width: number;
  readonly height: number;
  /** Image-plane millimetres per pixel. */
  readonly pixelScaleMm: number;
  /**
   * CIE XYZ per pixel, interleaved X,Y,Z. A typed array rather than an object
   * graph because analysis outputs cross the worker boundary (ARCHITECTURE §
   * Data model).
   */
  readonly xyz: Float64Array;
}

export function emptyColorImage(width: number, height: number, pixelScaleMm: number): ColorImage {
  return { width, height, pixelScaleMm, xyz: new Float64Array(width * height * 3) };
}

/** XYZ at one pixel. */
export function pixelXyz(image: ColorImage, x: number, y: number): Xyz {
  const i = (y * image.width + x) * 3;
  return { x: image.xyz[i]!, y: image.xyz[i + 1]!, z: image.xyz[i + 2]! };
}

/**
 * Collapse a spectral stack into colour.
 *
 * The observer, the bin integration and the source spectrum collapse into
 * three numbers per wavelength once (`spectralXyzBasis`), so the per-pixel work
 * is a dot product of length `planes.length` — which is what keeps a full-field
 * render affordable.
 */
export function colorImageFromStack(stack: SpectralStack, basis?: XyzBasis): ColorImage {
  const n = stack.size;
  const b = basis ?? spectralXyzBasis(stack.samples);
  if (b.x.length !== stack.planes.length) {
    throw new Error(
      `basis has ${b.x.length} wavelengths but the stack has ${stack.planes.length}`,
    );
  }
  const xyz = new Float64Array(n * n * 3);

  // Plane-major: each plane's array is walked once, contiguously, instead of
  // striding across every plane per pixel.
  for (let p = 0; p < stack.planes.length; p++) {
    const src = stack.planes[p]!.intensity;
    const bx = b.x[p]!;
    const by = b.y[p]!;
    const bz = b.z[p]!;
    for (let i = 0, o = 0; i < src.length; i++, o += 3) {
      const v = src[i]!;
      if (v === 0) continue;
      xyz[o] = xyz[o]! + v * bx;
      xyz[o + 1] = xyz[o + 1]! + v * by;
      xyz[o + 2] = xyz[o + 2]! + v * bz;
    }
  }

  return { width: n, height: n, pixelScaleMm: stack.pixelScaleMm, xyz };
}

/** Total XYZ over the whole image — the colour of all its light together. */
export function integratedXyz(image: ColorImage): Xyz {
  let x = 0;
  let y = 0;
  let z = 0;
  for (let i = 0; i < image.xyz.length; i += 3) {
    x += image.xyz[i]!;
    y += image.xyz[i + 1]!;
    z += image.xyz[i + 2]!;
  }
  return { x, y, z };
}

/** Integrated XYZ over an annulus about the image centre, in pixels. */
export function annulusXyz(image: ColorImage, innerPx: number, outerPx: number): Xyz {
  const cx = image.width / 2;
  const cy = image.height / 2;
  const r2lo = innerPx * innerPx;
  const r2hi = outerPx * outerPx;
  let x = 0;
  let y = 0;
  let z = 0;
  for (let iy = 0; iy < image.height; iy++) {
    const dy = iy - cy;
    for (let ix = 0; ix < image.width; ix++) {
      const dx = ix - cx;
      const r2 = dx * dx + dy * dy;
      if (r2 < r2lo || r2 >= r2hi) continue;
      const i = (iy * image.width + ix) * 3;
      x += image.xyz[i]!;
      y += image.xyz[i + 1]!;
      z += image.xyz[i + 2]!;
    }
  }
  return { x, y, z };
}

export interface RadialColorProfile {
  /** Bin centre radius in pixels, and the same in image-plane mm. */
  readonly radiusPx: Float64Array;
  readonly radiusMm: Float64Array;
  /** Integrated XYZ per annulus, interleaved X,Y,Z. */
  readonly xyz: Float64Array;
}

/**
 * Integrated colour as a function of radius — how the colour of a point
 * source's image changes from its core outward.
 *
 * This is the readout the milestone is actually about. "Purple fringing" is
 * the statement that this profile's *hue* moves toward blue with radius, and
 * an achromat's does not; a single average colour over the whole image cannot
 * say it, because the core dominates and the halo is what changed.
 */
export function radialColorProfile(image: ColorImage, bins: number): RadialColorProfile {
  if (!Number.isInteger(bins) || bins < 1) {
    throw new Error(`bins must be a positive integer, got ${bins}`);
  }
  const cx = image.width / 2;
  const cy = image.height / 2;
  const maxR = Math.min(cx, cy);
  const xyz = new Float64Array(bins * 3);

  for (let iy = 0; iy < image.height; iy++) {
    const dy = iy - cy;
    for (let ix = 0; ix < image.width; ix++) {
      const dx = ix - cx;
      const r = Math.hypot(dx, dy);
      if (r >= maxR) continue;
      const b = Math.min(bins - 1, Math.floor((r / maxR) * bins)) * 3;
      const i = (iy * image.width + ix) * 3;
      xyz[b] = xyz[b]! + image.xyz[i]!;
      xyz[b + 1] = xyz[b + 1]! + image.xyz[i + 1]!;
      xyz[b + 2] = xyz[b + 2]! + image.xyz[i + 2]!;
    }
  }

  const radiusPx = new Float64Array(bins);
  const radiusMm = new Float64Array(bins);
  for (let b = 0; b < bins; b++) {
    radiusPx[b] = ((b + 0.5) / bins) * maxR;
    radiusMm[b] = radiusPx[b]! * image.pixelScaleMm;
  }
  return { radiusPx, radiusMm, xyz };
}

export interface SrgbOptions {
  /** Linear scale applied before encoding. Default 1. */
  readonly exposure?: number;
  /**
   * Render this XYZ as neutral grey (von Kries scaling in linear sRGB).
   *
   * Off by default, because a star's colour is real information and hiding it
   * is a choice. On, when the question is "what shape and colour is the
   * *artifact*" — the fringe reads as itself once the core is white rather
   * than as the source's own tint plus the fringe.
   */
  readonly whitePoint?: Xyz;
}

/**
 * Per-channel gains that map `white` to neutral, normalized to leave luminance
 * alone. Separated out so a render can compute them once from a reference and
 * reuse them across frames instead of re-deriving them per image.
 */
export function whiteBalanceGains(white: Xyz): Rgb {
  const w = xyzToLinearRgb(white);
  const g = { r: w.r, g: w.g, b: w.b };
  if (!(g.r > 0) || !(g.g > 0) || !(g.b > 0)) {
    throw new Error("white balance reference has a non-positive channel");
  }
  // Geometric mean keeps overall brightness where it was, so white balance is
  // a hue correction and exposure stays the only brightness control.
  const scale = Math.cbrt(g.r * g.g * g.b);
  return { r: scale / g.r, g: scale / g.g, b: scale / g.b };
}

/**
 * Exposure that puts the given quantile of non-black luminance at full scale.
 *
 * A star image is almost entirely black with an extremely bright core, so
 * scaling by the mean would render nothing and scaling by the max would render
 * a single lit pixel. Quantile over lit pixels is what makes the faint
 * structure — which is where the fringing lives — actually visible.
 */
export function autoExposure(image: ColorImage, quantile = 0.999): number {
  const lit: number[] = [];
  for (let i = 1; i < image.xyz.length; i += 3) if (image.xyz[i]! > 0) lit.push(image.xyz[i]!);
  if (lit.length === 0) return 1;
  lit.sort((a, b) => a - b);
  const y = lit[Math.min(lit.length - 1, Math.floor(quantile * lit.length))]!;
  return y > 0 ? 1 / y : 1;
}

/**
 * Encode to 8-bit RGBA for a canvas.
 *
 * The only place gamma is applied, and the only place values are clamped.
 */
export function toSrgbBytes(image: ColorImage, options: SrgbOptions = {}): Uint8ClampedArray {
  const exposure = options.exposure ?? 1;
  const gains =
    options.whitePoint === undefined ? { r: 1, g: 1, b: 1 } : whiteBalanceGains(options.whitePoint);
  const out = new Uint8ClampedArray(image.width * image.height * 4);

  for (let i = 0, o = 0; i < image.xyz.length; i += 3, o += 4) {
    const lin = xyzToLinearRgb({
      x: image.xyz[i]! * exposure,
      y: image.xyz[i + 1]! * exposure,
      z: image.xyz[i + 2]! * exposure,
    });
    out[o] = 255 * encodeGamma(lin.r * gains.r);
    out[o + 1] = 255 * encodeGamma(lin.g * gains.g);
    out[o + 2] = 255 * encodeGamma(lin.b * gains.b);
    out[o + 3] = 255;
  }
  return out;
}
