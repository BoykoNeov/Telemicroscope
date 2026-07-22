import { Xyz } from "./cmf";

/**
 * sRGB — the last step, and the only one that is a convention rather than
 * physics (IEC 61966-2-1: ITU-R BT.709 primaries, D65 white, the piecewise
 * transfer curve).
 *
 * Two rules keep the physics from leaking away here:
 *
 * **All optics happens in linear light.** Convolution, wavelength stacking and
 * energy normalization are sums of intensities, and a sum of gamma-encoded
 * values is not the encoding of the sum. `encodeGamma` is therefore the very
 * last operation before pixels leave for a screen, applied once.
 *
 * **Out-of-gamut is reported, not hidden.** A saturated spectral colour — the
 * violet edge of a fringe is exactly this — falls outside the sRGB triangle
 * and produces a negative channel. Clipping is the only thing a screen can do,
 * but silently clipping is how a rendering pipeline starts telling comfortable
 * lies, so `toSrgb` hands back the clipped flag with the colour.
 */

export interface Rgb {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

/** XYZ → linear sRGB (BT.709 primaries, D65). Rows of the standard matrix. */
export function xyzToLinearRgb(c: Xyz): Rgb {
  return {
    r: 3.2406 * c.x - 1.5372 * c.y - 0.4986 * c.z,
    g: -0.9689 * c.x + 1.8758 * c.y + 0.0415 * c.z,
    b: 0.0557 * c.x - 0.204 * c.y + 1.057 * c.z,
  };
}

/** Linear sRGB → XYZ. The inverse of the above, to the standard's precision. */
export function linearRgbToXyz(c: Rgb): Xyz {
  return {
    x: 0.4124 * c.r + 0.3576 * c.g + 0.1805 * c.b,
    y: 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b,
    z: 0.0193 * c.r + 0.1192 * c.g + 0.9505 * c.b,
  };
}

/** D65 white point, normalized to Y = 1 — what linear RGB (1,1,1) means. */
export const D65_WHITE: Xyz = { x: 0.95047, y: 1.0, z: 1.08883 };

/**
 * Slack in the gamut test, set by the standard's own precision.
 *
 * The conversion matrices are published to four decimals, so they are not
 * exact inverses and white itself comes back at g = 1.00005 rather than 1. A
 * tolerance tighter than that would flag every correctly-exposed white pixel
 * as clipped, which is the opposite of what the flag is for.
 */
const GAMUT_EPSILON = 1e-3;

/** Relative luminance of a linear sRGB colour (the Y row of the matrix). */
export function luminance(c: Rgb): number {
  return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
}

/** sRGB transfer function, linear [0,1] → encoded [0,1]. */
export function encodeGamma(linear: number): number {
  const v = Math.min(1, Math.max(0, linear));
  return v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
}

/** Inverse sRGB transfer function, encoded [0,1] → linear [0,1]. */
export function decodeGamma(encoded: number): number {
  const v = Math.min(1, Math.max(0, encoded));
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

export interface SrgbResult extends Rgb {
  /**
   * True when the colour lay outside the sRGB gamut (a negative channel) or
   * above white, and was clipped to fit. The violet skirt of a chromatic
   * fringe genuinely does this — it is a real spectral colour a screen cannot
   * make — so a renderer that never reports it is not showing the whole image.
   */
  readonly clipped: boolean;
}

/**
 * XYZ → display-ready sRGB in [0, 1], gamma encoded.
 *
 * `exposure` scales linear light before encoding; it is the renderer's only
 * brightness control and is applied in linear space, where it belongs.
 */
export function toSrgb(c: Xyz, exposure = 1): SrgbResult {
  const lin = xyzToLinearRgb({ x: c.x * exposure, y: c.y * exposure, z: c.z * exposure });
  const lo = -GAMUT_EPSILON;
  const hi = 1 + GAMUT_EPSILON;
  const clipped =
    lin.r < lo || lin.g < lo || lin.b < lo || lin.r > hi || lin.g > hi || lin.b > hi;
  return {
    r: encodeGamma(lin.r),
    g: encodeGamma(lin.g),
    b: encodeGamma(lin.b),
    clipped,
  };
}
