import { kolmogorovScreen, withPhaseScreen, SeeingSpec } from "./seeing";
import {
  psfFromPupilFunction,
  type Psf,
  type PsfOptions,
  type PupilFunction,
  type PupilScale,
} from "./psf";
import { mtf } from "./mtf";

/**
 * The long exposure — the ensemble average § 5d pinned and did not export.
 *
 * § 5d's physics has been pinned since roadmap step 5: Fried's atmospheric OTF
 * exp(−3.44·(ρ/r₀)^(5/3)) and the seeing-limited FWHM ≈ 0.98·λ/r₀, both of them
 * **ensemble** quantities, because one screen is a speckle pattern and only the
 * mean over many is the smooth seeing disc. What did *not* exist was an API: the
 * averaging lived in a helper inside `seeing.test.ts`, closed over that file's
 * own aperture, grid and flat pupil, so nothing outside the test could ask for a
 * long exposure at all. This is that helper promoted, and § 5d.1 is the rung on
 * the promotion (docs/VALIDATION.md).
 *
 * ## Why it is a separate module from `seeing.ts`
 *
 * `psf.ts` imports `withPhaseScreen` from `seeing.ts` as a *value*, and
 * `seeing.ts` imports from `psf.ts` as a **type only** — a deliberate back-edge
 * that erases at runtime, stated in `seeing.ts`'s own header. The ensemble needs
 * `psfFromPupilFunction` as a value, so putting it in `seeing.ts` would close
 * that cycle for real. It lives here instead, above both.
 *
 * ## The trace happens once, and that is the whole cost argument
 *
 * A long exposure is many atmospheres over **one** instrument. Going through
 * `psf({seeing})` per screen would re-trace, re-fit Zernikes and rebuild any
 * vignette mask every time for a result that cannot change, so a caller passes
 * the pupil — from `systemPupil()` for a real system, or a hand-built one for a
 * bare aperture — and only the transform repeats.
 *
 * It is still expensive, and irreducibly so: the low-order wander converges as
 * 1/√N, so the § 5d rungs run 120 screens and take 14–20 s. **This is a
 * compute-once quantity and never a live dial.** An app that put it under a
 * slider would be lying about what it costs; the one that draws it (APP.md C6)
 * has an explicit button and shows a single screen beside the mean, which is the
 * difference the physics is about.
 */

export interface LongExposureSpec {
  /**
   * The instrument's own pupil, **screen-free** — every atmosphere composes onto
   * this one. `systemPupil()` produces it for a traced system.
   */
  readonly pupil: PupilFunction;
  readonly scale: PupilScale;
  /** Field value the transform is labelled with. Default 0. */
  readonly fieldValue?: number;
  /**
   * The atmosphere to average over. Its `seed` is the **first** screen's; screen
   * s uses `seed + s`, so an ensemble replays exactly and two ensembles that
   * must be independent are given seeds further apart than their screen counts.
   */
  readonly seeing: SeeingSpec;
  /** Wavelength the screen's OPD is converted to waves at (nm). */
  readonly wavelengthNm: number;
  /** How many screens to average. § 5d measures convergence at 120. */
  readonly screens: number;
  readonly psfOptions?: PsfOptions;
}

export interface LongExposure {
  /**
   * The ensemble mean, as a `Psf` — the seeing disc. Every field but `intensity`
   * is the screen-free transform's, because a mean of intensities has no
   * wavefront of its own: `strehl` and `peak` on it would be the last screen's
   * denominators, so they are the CLEAN system's and the honest readouts are
   * `fwhmPixels` and the transfer function below.
   */
  readonly psf: Psf;
  /** The same instrument with no atmosphere — the denominator of every ratio. */
  readonly clean: Psf;
  readonly screens: number;
  /**
   * Worst `maxGridPhaseStepWaves` over the ensemble.
   *
   * The under-resolution guard § 5d exists on: the fidelity criterion runs on
   * traced samples and is **blind to the screen**, so this is the only thing
   * that catches an atmosphere the FFT grid cannot represent. Past ½ the mean is
   * not a seeing disc, it is aliasing averaged.
   */
  readonly maxGridPhaseStepWaves: number;
  /** FWHM of the azimuthally-averaged mean, in pixels. */
  readonly fwhmPixels: number;
  /** FWHM of the same instrument with no atmosphere, in pixels. */
  readonly cleanFwhmPixels: number;
  /**
   * Azimuthally-averaged MTF of the mean, one bin per pixel of the transform
   * grid — so bin `b` IS `b` cycles across the pupil and ν = b/pupilSamples
   * exactly. Length `pupilSamples + 1`, i.e. DC out to the cutoff inclusive.
   */
  readonly modulation: Float64Array;
  /** The same for the atmosphere-free instrument. */
  readonly cleanModulation: Float64Array;
  /**
   * The atmospheric transfer function alone: long-exposure MTF / diffraction
   * MTF, bin for bin. Fried says this is exp(−3.44·(ν·D/r₀)^(5/3)).
   */
  readonly atmosphericModulation: Float64Array;
  /**
   * r₀_eff/r₀ recovered from `atmosphericModulation` at each bin — Fried's form
   * inverted per frequency.
   *
   * The discriminator, and the reason § 5d's tolerance is earned rather than
   * asserted: a finite screen truncates the largest turbulent scales, and if
   * that error were a *shape* distortion this curve would slope. It does not; it
   * comes back flat at a few percent above 1, which is a pure r₀ shift. `NaN`
   * where the inversion has no answer (bin 0, and any bin whose atmospheric
   * modulation has reached the noise floor at or above 1).
   */
  readonly effectiveFriedRatio: Float64Array;
}

/** Fried's long-exposure atmospheric OTF at normalized frequency ν = f/f_cutoff. */
export function friedAtmosphericMtf(dOverR0: number, nu: number): number {
  return Math.exp(-3.44 * Math.pow(nu * dOverR0, 5 / 3));
}

/**
 * Average many atmospheres over one instrument.
 *
 * The accumulation is deliberately the plainest thing that works — screen s
 * built from `seed + s`, transformed, added into a running sum, divided at the
 * end — because § 5d's rungs are pinned on the *numbers this produces* at
 * specific seeds, and any cleverness about ordering (parallel partial sums,
 * pairwise summation) would move them in the last bits for no physics.
 */
export function longExposurePsf(spec: LongExposureSpec): LongExposure {
  if (!Number.isInteger(spec.screens) || spec.screens < 1) {
    throw new Error(`longExposurePsf: screens must be a positive integer, got ${spec.screens}`);
  }
  const fieldValue = spec.fieldValue ?? 0;
  const options = spec.psfOptions ?? {};
  const seed0 = spec.seeing.seed ?? 1;

  const clean = psfFromPupilFunction(spec.pupil, spec.scale, fieldValue, options);
  const n = clean.size;
  const mean = new Float64Array(n * n);
  let maxGridPhaseStepWaves = 0;

  for (let s = 0; s < spec.screens; s++) {
    const screen = kolmogorovScreen({ ...spec.seeing, seed: seed0 + s });
    const one = psfFromPupilFunction(
      withPhaseScreen(spec.pupil, screen, spec.wavelengthNm),
      spec.scale,
      fieldValue,
      options,
    );
    for (let i = 0; i < n * n; i++) mean[i] = mean[i]! + one.intensity[i]!;
    if (one.maxGridPhaseStepWaves > maxGridPhaseStepWaves) {
      maxGridPhaseStepWaves = one.maxGridPhaseStepWaves;
    }
  }
  for (let i = 0; i < n * n; i++) mean[i] = mean[i]! / spec.screens;

  // Everything but the intensity is the clean transform's — see the field doc.
  const meanPsf: Psf = { ...clean, intensity: mean };
  const bins = clean.pupilSamples + 1;
  const modulation = radialByPixel(mtf(meanPsf).modulation, n, bins);
  const cleanModulation = radialByPixel(mtf(clean).modulation, n, bins);

  const dOverR0 = spec.seeing.apertureDiameterMm / spec.seeing.friedParamMm;
  const atmosphericModulation = new Float64Array(bins);
  const effectiveFriedRatio = new Float64Array(bins);
  for (let b = 0; b < bins; b++) {
    const atm = cleanModulation[b]! > 0 ? modulation[b]! / cleanModulation[b]! : NaN;
    atmosphericModulation[b] = atm;
    const nu = b / clean.pupilSamples;
    // Invert exp(−3.44·(ν·D/r₀_eff)^(5/3)) for D/r₀_eff, then report r₀_eff/r₀.
    // Undefined at DC (ν = 0 carries no information about r₀) and wherever the
    // ratio has run into the noise floor at or above 1, which is a measurement
    // that has stopped meaning anything rather than an infinite r₀.
    effectiveFriedRatio[b] =
      b === 0 || !(atm > 0) || !(atm < 1)
        ? NaN
        : dOverR0 / Math.pow(-Math.log(atm) / (3.44 * Math.pow(nu, 5 / 3)), 3 / 5);
  }

  return {
    psf: meanPsf,
    clean,
    screens: spec.screens,
    maxGridPhaseStepWaves,
    fwhmPixels: fwhmPixels(mean, n),
    cleanFwhmPixels: fwhmPixels(clean.intensity, n),
    modulation,
    cleanModulation,
    atmosphericModulation,
    effectiveFriedRatio,
  };
}

/**
 * Azimuthal average on **integer-pixel** bins, so bin index and radius in pixels
 * are the same number.
 *
 * `mtfProfile` in `wave/mtf` bins fractionally into an arbitrary count and
 * reports ν at bin centres, which is right for drawing a curve and wrong here:
 * Fried's inversion is per frequency, and the frequency it wants is ν =
 * b/pupilSamples **exactly**, not b + ½ of a bin whose width depends on how many
 * were asked for. Two summaries of one transform, and this one exists because
 * the arithmetic downstream is a log rather than a plot.
 */
function radialByPixel(values: Float64Array, n: number, bins: number): Float64Array {
  const c = n / 2;
  const sums = new Float64Array(bins);
  const counts = new Float64Array(bins);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const b = Math.round(Math.hypot(x - c, y - c));
      if (b >= bins) continue;
      sums[b] = sums[b]! + values[y * n + x]!;
      counts[b] = counts[b]! + 1;
    }
  }
  const out = new Float64Array(bins);
  for (let b = 0; b < bins; b++) out[b] = counts[b]! > 0 ? sums[b]! / counts[b]! : 0;
  return out;
}

/**
 * FWHM (px) of the azimuthally-averaged intensity, peak to half-max crossing,
 * linearly interpolated between the two bins that straddle it.
 *
 * The noisy estimator of the pair, and § 5d says so: it is one geometric
 * measurement on a still-lumpy mean, the slowest-converging feature in the
 * ensemble, and its finite-screen narrow bias grows with D/r₀. It is reported
 * because 0.98·λ/r₀ is the number anyone quotes, and pinned by a wide band while
 * the OTF's r₀_eff does the tight work.
 */
function fwhmPixels(intensity: Float64Array, n: number): number {
  const c = n / 2;
  const sums = new Float64Array(n);
  const counts = new Float64Array(n);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const b = Math.floor(Math.hypot(x - c, y - c));
      if (b >= n) continue;
      sums[b] = sums[b]! + intensity[y * n + x]!;
      counts[b] = counts[b]! + 1;
    }
  }
  const profile = new Float64Array(n);
  for (let b = 0; b < n; b++) profile[b] = counts[b]! > 0 ? sums[b]! / counts[b]! : 0;
  const half = profile[0]! / 2;
  for (let b = 1; b < n; b++) {
    if (profile[b]! <= half) {
      const t = (profile[b - 1]! - half) / (profile[b - 1]! - profile[b]!);
      return 2 * (b - 1 + t);
    }
  }
  return NaN;
}
