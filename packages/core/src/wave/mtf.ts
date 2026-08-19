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
 *    exactly `psf.pupilSamples` frequency bins — **when the whole pupil
 *    transmits**, which is the clause this comment used to leave out. It called
 *    the coincidence "a strong internal check on the whole pupil→image scale"
 *    and it is not one: D here is the aperture that was ASKED FOR, read off the
 *    exit pupil radius, while the array's real support is the aperture that
 *    actually traced. On the app's own f/10 doublet those differ by 27% — the
 *    crown element closes on itself at 73% of its semi-diameter (APP.md Part B's
 *    aperture wall) and every ray past that is a `miss`, so the modulation
 *    reaches zero at ν = 0.73 while `cutoffCyclesPerMm` still reports the full
 *    170.27 c/mm. The aberration-free PSF cuts off in the same place, which is
 *    what says this is aperture and not aberration. See VALIDATION § 6ad.
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
  /**
   * Diffraction cutoff 2·NA/λ (cycles/mm), off the EXIT PUPIL RADIUS — i.e. the
   * cutoff of the aperture the system was asked for. Where `modulation` actually
   * reaches zero is the cutoff of the aperture that transmitted, and a truncated
   * pupil parts the two. See the header.
   */
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
 * differ and a directional readout is the honest one. That split is `mtfSections`
 * below; this is the radial summary, and off axis it is not bracketed by the two
 * sections it summarizes — the azimuths between them can be worse than either.
 */
export function mtfProfile(m: Mtf, bins: number, cutoffBins: number): MtfProfile {
  // An annulus narrower than a pixel can contain no pixels, and an empty bin
  // here used to fall through to `modulation = 0` — indistinguishable on a plot
  // from a frequency at which the lens transmits no contrast. Asking for 161
  // bins across a 64-bin band turned the summary curve into a comb of zeros and
  // read 0.51 of modulation below the sections it summarizes, which is how this
  // was found. Refused rather than documented: § 6ac's rule, and the caller has
  // no way to notice from the returned array. See VALIDATION § 6ad.
  if (!Number.isInteger(bins) || bins < 2) {
    throw new Error(`mtfProfile: bins must be an integer ≥ 2, got ${bins}`);
  }
  if (bins > cutoffBins) {
    throw new Error(
      `mtfProfile: ${bins} bins across ${cutoffBins} frequency bins leaves annuli with no pixels ` +
        `in them, which would read as zero contrast. Ask for at most ${cutoffBins}.`,
    );
  }
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

/**
 * MTF at a normalized frequency ν along one axis of the shifted array, by
 * linear interpolation between the two straddling bins.
 *
 * `axis` is a direction in FREQUENCY space, not a direction in the image: "x"
 * means the modulation of a pattern whose bars run along y and whose contrast
 * therefore varies along x.
 */
function sampleAlong(m: Mtf, nu: number, cutoffBins: number, axis: "x" | "y"): number {
  const n = m.size;
  const c = n / 2;
  const t = c + nu * cutoffBins;
  const i = Math.floor(t);
  if (i < 0 || i + 1 >= n) return 0;
  const f = t - i;
  const a = axis === "x" ? m.modulation[c * n + i]! : m.modulation[i * n + c]!;
  const b = axis === "x" ? m.modulation[c * n + i + 1]! : m.modulation[(i + 1) * n + c]!;
  return a * (1 - f) + b * f;
}

/**
 * MTF at a normalized frequency ν, sampled along +x — linearly between the two
 * straddling bins, as `sampleAlong` says. Two values of the MODULUS, blended:
 * off a bin the result is therefore not the modulus of anything, which is the
 * boundary VALIDATION § 1.8.14 measures (16% at ν = 0.15 on a 32-sample pupil).
 *
 * On axis that is *the* MTF, the pattern being rotationally symmetric. Off axis
 * +x is the meridional direction — a field point is displaced along x in this
 * engine (`objectPoint`/`fieldDirection`, the same convention `analysis/field`
 * states) — so this has always returned the TANGENTIAL section specifically,
 * which is what `mtfSections` now says out loud rather than leaving to be
 * rediscovered.
 */
export function mtfAt(m: Mtf, nu: number, cutoffBins: number): number {
  return sampleAlong(m, nu, cutoffBins, "x");
}

export interface MtfSections {
  /** Normalized frequency ν = f/f_c, spanning [0, 1] inclusive. */
  readonly nu: Float64Array;
  readonly frequencyCyclesPerMm: Float64Array;
  /**
   * Contrast varying along **x** — the meridional plane, the one containing the
   * axis and the field point. This is the section coma and tangential
   * astigmatism degrade.
   */
  readonly tangential: Float64Array;
  /** Contrast varying along **y**, perpendicular to the meridional plane. */
  readonly sagittal: Float64Array;
}

/**
 * The two directional MTF sections — the readout `mtfProfile` promised and did
 * not have until `analysis/field` gave the two focal surfaces a meaning.
 *
 * An azimuthal average is exact on axis and a *summary* off it, and the thing it
 * summarizes away is the whole content of an off-axis MTF: a comatic or
 * astigmatic image is blurred more in one direction than the other, and "the
 * MTF" of such a system is two curves. Measured on the § 5j achromat at 0.8°,
 * the two part company by 1.5× at ν = 0.1 and stay apart to the cutoff.
 *
 * **Which is which is a convention, and it is the one `analysis/field` already
 * chose:** a field point is displaced along x, so the meridional (tangential)
 * plane is the x–z plane, and the tangential section is the one whose contrast
 * varies along x. What checks the convention is not this comment — it is that
 * three separate machineries agree about which direction the blur lies in (the
 * ray spot's second moments, the PSF's, and this split), and that a system with
 * no off-axis asymmetry at all produces no split. See VALIDATION § 6ad.
 *
 * `bins` samples span [0, 1] inclusive, unlike `mtfProfile`'s bin centres: a
 * section is a point sample rather than an average over an annulus, so it can
 * sit on the endpoints — and ν = 0 is worth having, because both sections must
 * be exactly 1 there whatever the aberration.
 */
export function mtfSections(m: Mtf, bins: number, cutoffBins: number): MtfSections {
  if (!Number.isInteger(bins) || bins < 2) {
    throw new Error(`mtfSections: bins must be an integer ≥ 2, got ${bins}`);
  }
  const nu = new Float64Array(bins);
  const frequencyCyclesPerMm = new Float64Array(bins);
  const tangential = new Float64Array(bins);
  const sagittal = new Float64Array(bins);
  for (let b = 0; b < bins; b++) {
    const v = b / (bins - 1);
    nu[b] = v;
    frequencyCyclesPerMm[b] = v * m.cutoffCyclesPerMm;
    tangential[b] = sampleAlong(m, v, cutoffBins, "x");
    sagittal[b] = sampleAlong(m, v, cutoffBins, "y");
  }
  return { nu, frequencyCyclesPerMm, tangential, sagittal };
}
