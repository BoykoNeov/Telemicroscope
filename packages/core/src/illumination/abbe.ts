import { fft2d, fftShift2d, isPowerOfTwo } from "../math/fft";
import { imagePixelScaleMm, type PupilFunction, type PupilScale } from "../wave/psf";
import type { CondenserSource } from "./source";

/**
 * Abbe imaging — how a brightfield microscope actually forms an image.
 *
 * Everything the wave layer has done so far assumes the object *emits*: a star,
 * a fluorescent bead. Then the object is incoherent, intensities add, and the
 * image is a convolution with |PSF|². A brightfield specimen emits nothing. It
 * sits in a beam and modulates it, so the field leaving it is the illuminating
 * field times a transmittance — and whether two neighbouring points of the
 * specimen interfere depends on whether the light hitting them came from the
 * same place. That is **partial coherence**, and it makes the image
 * *nonlinear* in the object's intensity: brightfield has no single MTF, and a
 * "condenser factor" multiplying the incoherent one would be a fiction.
 *
 * Abbe's construction is the honest version, and it is a sum, not a fudge:
 *
 *  1. The condenser aperture is a set of illumination directions (`source.ts`).
 *  2. Each direction is one plane wave, so under it the imaging is **coherent**
 *     — the field is a linear filter of the object's spectrum.
 *  3. Different directions come from different points of the lamp, which are
 *     mutually incoherent, so their **intensities** add.
 *
 *     I(x) = Σ_s w_s · | F⁻¹{ T(u) · P(u + s) } |²
 *
 * with T the object's spectrum, P the complex pupil, and s the illumination
 * direction in normalized pupil units. The whole of partial coherence is that
 * one line: the modulus-squared is inside the sum over s, not outside.
 *
 * ## The one move that makes this cheap here: the tilt shifts the *pupil*
 *
 * Illuminating from direction s multiplies the object by exp(2πi·s·x), which
 * slides its spectrum by s. Changing variables slides the pupil the other way
 * instead and leaves a global phase that the modulus discards — so an
 * illumination direction is a **translated pupil**, `shiftPupil` below, and
 * nothing about the transform changes. That is the same lever the spider
 * (§ 5c) and the seeing screen (§ 5d) pulled: a new optical effect arrives as a
 * `PupilFunction` and the machinery below it never learns its name. The
 * aberration slides with the support, which is correct and not an
 * approximation — each diffracted order really does cross the pupil at a
 * different place and pick up the wavefront error *there*.
 *
 * ## Coordinates, and why the object is given in image-plane units
 *
 * The grid is the same one `wave/psf` builds: `size`×`size` samples with the
 * pupil spanning `pupilSamples` frequency bins across its diameter, so
 * frequency bin k maps to normalized pupil coordinate 2k/pupilSamples and the
 * incoherent cutoff sits at exactly `pupilSamples` bins — the identity
 * `wave/mtf` already rests on. The object is therefore supplied as its
 * *geometric image*: the specimen scaled by the magnification, the standard
 * reduced-coordinate convention. The sine condition is what makes this exact
 * rather than paraxial bookkeeping — NA_obj·h_obj = NA_img·h_img — and it is
 * also why the coherence parameter S, a ratio of object-side apertures, needs
 * no conversion to be used here.
 *
 * ## One deliberate difference from `wave/psf`: the pupil is point-sampled
 *
 * `pupilSampling` area-averages cells the aperture rim cuts, because there it
 * is approximating a continuous integral over the aperture. Here the pupil
 * multiplies a *sampled* spectrum on the DFT lattice, so the midpoint rule is
 * the discretization, and each spectral sample is either transmitted or not.
 * Averaging the rim would apodize the object's spectrum instead of the
 * aperture — a different approximation, and the wrong one exactly at the
 * cutoff, which is where every § 6f rung lives.
 */

/**
 * The same pupil, seen from an illumination direction: P_s(u) = P(u + s).
 *
 * Amplitude and phase both slide, which is what carries "this diffracted order
 * crosses the pupil off-centre and picks up the aberration there".
 */
export function shiftPupil(pupil: PupilFunction, sx: number, sy: number): PupilFunction {
  return {
    amplitude: (px, py) => pupil.amplitude(px + sx, py + sy),
    phaseWaves: (px, py) => pupil.phaseWaves(px + sx, py + sy),
  };
}

/**
 * A complex amplitude transmittance sampled on the image-plane grid.
 *
 * Amplitude, not intensity: a specimen that absorbs half the light has
 * transmittance √0.5, and one that only retards the phase has |t| = 1 — which
 * is precisely why it is invisible in brightfield (§ 6f).
 */
export interface ObjectField {
  /** Grid size; `re`/`im` are `size`×`size`, row-major. Power of two. */
  readonly size: number;
  readonly re: Float64Array;
  readonly im: Float64Array;
}

/** A perfectly clear field of view — transmittance 1 everywhere. */
export function uniformObject(size: number): ObjectField {
  requireGrid(size);
  const re = new Float64Array(size * size);
  re.fill(1);
  return { size, re, im: new Float64Array(size * size) };
}

/**
 * A sinusoidal **absorption** grating, t = 1 + m·cos(2π·k·x/size).
 *
 * `cycles` is an integer so the grating is exactly periodic on the grid and its
 * spectrum is exactly three lattice lines — no leakage to disentangle from the
 * optics. Its frequency in the units this module works in is
 * ν = 2·cycles/pupilSamples, in which the coherent cutoff is 1 and the
 * incoherent cutoff is 2.
 */
export function cosineGratingObject(options: {
  size: number;
  cycles: number;
  modulation: number;
}): ObjectField {
  const { size, cycles, modulation } = options;
  requireGrid(size);
  if (!Number.isInteger(cycles) || cycles < 0) {
    throw new Error(`grating cycles must be a non-negative integer, got ${cycles}`);
  }
  if (!(modulation >= 0) || modulation > 1) {
    throw new Error(`grating modulation must lie in [0, 1], got ${modulation}`);
  }
  const re = new Float64Array(size * size);
  for (let x = 0; x < size; x++) {
    const t = 1 + modulation * Math.cos((2 * Math.PI * cycles * x) / size);
    for (let y = 0; y < size; y++) re[y * size + x] = t;
  }
  return { size, re, im: new Float64Array(size * size) };
}

/**
 * A sinusoidal **phase** grating, t = exp(i·φ·cos(2π·k·x/size)).
 *
 * |t| = 1 everywhere: it absorbs nothing, and a photographic plate at the
 * object plane would see nothing. Exact — all Bessel orders are present, not
 * the weak-object truncation `transfer.ts` uses.
 */
export function phaseGratingObject(options: {
  size: number;
  cycles: number;
  /** Peak phase excursion in radians. */
  amplitudeRadians: number;
}): ObjectField {
  const { size, cycles, amplitudeRadians } = options;
  requireGrid(size);
  if (!Number.isInteger(cycles) || cycles < 0) {
    throw new Error(`grating cycles must be a non-negative integer, got ${cycles}`);
  }
  const re = new Float64Array(size * size);
  const im = new Float64Array(size * size);
  for (let x = 0; x < size; x++) {
    const phi = amplitudeRadians * Math.cos((2 * Math.PI * cycles * x) / size);
    const c = Math.cos(phi);
    const s = Math.sin(phi);
    for (let y = 0; y < size; y++) {
      re[y * size + x] = c;
      im[y * size + x] = s;
    }
  }
  return { size, re, im };
}

function requireGrid(size: number): void {
  if (!isPowerOfTwo(size)) throw new Error(`object grid size must be a power of two, got ${size}`);
}

export interface AbbeOptions {
  /** Frequency bins across the pupil DIAMETER — the scale, as in `wave/psf`. */
  readonly pupilSamples: number;
  /** Supply to get a physical `pixelScaleMm` back; omit for grid units. */
  readonly scale?: PupilScale;
}

export interface AbbeImage {
  readonly size: number;
  readonly pupilSamples: number;
  /** Intensity, in the object's own coordinates (NOT fftshifted). */
  readonly intensity: Float64Array;
  /** Source points that contributed at all — i.e. whose shifted pupil was
   * non-empty over the grid. A darkfield annulus outside the pupil still
   * contributes (its diffracted orders do); a source point whose entire pupil
   * falls off the frequency grid does not, and that is a sampling failure
   * rather than physics, so it is reported. */
  readonly contributingPoints: number;
  readonly pixelScaleMm?: number;
}

/**
 * Form the partially coherent image of `object` through `pupil` under `source`.
 *
 * Cost is one inverse transform per source point, so it scales with the
 * condenser's sampling exactly the way `renderField`'s cost scales with patches
 * — and, like that one, the sampling count is a knob whose convergence is
 * pinned rather than assumed (§ 6f).
 */
export function abbeImage(
  object: ObjectField,
  pupil: PupilFunction,
  source: CondenserSource,
  options: AbbeOptions,
): AbbeImage {
  const n = object.size;
  requireGrid(n);
  const pupilSamples = options.pupilSamples;
  if (!(pupilSamples > 0)) throw new Error(`pupilSamples must be positive, got ${pupilSamples}`);
  if (object.re.length !== n * n || object.im.length !== n * n) {
    throw new Error(`object arrays must hold ${n * n} elements`);
  }

  // Object spectrum, once, in centred layout so it lines up with the pupil's
  // own coordinates (bin ix ↔ normalized pupil 2(ix − n/2)/pupilSamples).
  const specRe = Float64Array.from(object.re);
  const specIm = Float64Array.from(object.im);
  fft2d(specRe, specIm, n);
  fftShift2d(specRe, n);
  fftShift2d(specIm, n);

  const half = n / 2;
  const step = 2 / pupilSamples;
  const intensity = new Float64Array(n * n);
  const workRe = new Float64Array(n * n);
  const workIm = new Float64Array(n * n);
  let contributingPoints = 0;

  for (const s of source.points) {
    workRe.fill(0);
    workIm.fill(0);
    // The shifted pupil is supported on |u + s| <= 1, so only that box needs
    // visiting — which also keeps a pupil function that re-traces rays from
    // being asked about frequencies it could never transmit.
    const ixLo = Math.max(0, Math.ceil(half + (-1 - s.sx) / step));
    const ixHi = Math.min(n - 1, Math.floor(half + (1 - s.sx) / step));
    const iyLo = Math.max(0, Math.ceil(half + (-1 - s.sy) / step));
    const iyHi = Math.min(n - 1, Math.floor(half + (1 - s.sy) / step));

    let transmitting = 0;
    for (let iy = iyLo; iy <= iyHi; iy++) {
      const py = (iy - half) * step + s.sy;
      for (let ix = ixLo; ix <= ixHi; ix++) {
        const px = (ix - half) * step + s.sx;
        const a = pupil.amplitude(px, py);
        if (a <= 0) continue;
        const ang = 2 * Math.PI * pupil.phaseWaves(px, py);
        const pr = a * Math.cos(ang);
        const pi = a * Math.sin(ang);
        const idx = iy * n + ix;
        const tr = specRe[idx]!;
        const ti = specIm[idx]!;
        workRe[idx] = tr * pr - ti * pi;
        workIm[idx] = tr * pi + ti * pr;
        transmitting++;
      }
    }
    if (transmitting === 0) continue;
    contributingPoints++;

    fftShift2d(workRe, n);
    fftShift2d(workIm, n);
    fft2d(workRe, workIm, n, true);
    const w = s.weight;
    for (let i = 0; i < n * n; i++) {
      intensity[i] = intensity[i]! + w * (workRe[i]! * workRe[i]! + workIm[i]! * workIm[i]!);
    }
  }

  return {
    size: n,
    pupilSamples,
    intensity,
    contributingPoints,
    ...(options.scale === undefined
      ? {}
      : { pixelScaleMm: imagePixelScaleMm(options.scale, n, pupilSamples) }),
  };
}

export interface ImageHarmonic {
  /** Mean intensity. */
  readonly dc: number;
  /** Peak amplitude of the cos component at this frequency. */
  readonly amplitude: number;
  /** amplitude / dc — the modulation depth a contrast readout wants. */
  readonly contrast: number;
}

/**
 * One Fourier component of an image, by direct evaluation at a single bin.
 *
 * The measurement every § 6f rung is made with: how much of the object's
 * periodicity survived. Evaluating one bin directly rather than transforming
 * the whole image keeps it exact for a grating whose period divides the grid,
 * which is the only case the rungs use.
 */
export function imageHarmonic(
  intensity: Float64Array,
  size: number,
  kx: number,
  ky = 0,
): ImageHarmonic {
  const n = size;
  let dc = 0;
  let re = 0;
  let im = 0;
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const v = intensity[y * n + x]!;
      dc += v;
      const ang = (-2 * Math.PI * (kx * x + ky * y)) / n;
      re += v * Math.cos(ang);
      im += v * Math.sin(ang);
    }
  }
  const cells = n * n;
  const mean = dc / cells;
  // A real image splits its energy between the ±k bins, so the cosine
  // amplitude is twice one of them.
  const amplitude = (2 * Math.hypot(re, im)) / cells;
  return { dc: mean, amplitude, contrast: mean > 0 ? amplitude / mean : 0 };
}
