import { OpdMap } from "../pupil/opd";
import { ZernikeFit } from "./zernike";

/**
 * Is the FFT-based PSF trustworthy for this wavefront?
 *
 * ARCHITECTURE § fidelity switch is specific about the criterion, and the
 * specificity matters: it is **phase change per pupil sample**, not total wave
 * error. The FFT is valid while |∇(OPD)|·Δ_pupil < λ/2 — less than π of phase
 * between adjacent samples. "A few waves of aberration" is a *consequence* of
 * that at a typical sampling, not the rule; a denser pupil grid genuinely
 * extends the FFT's validity, and a metric phrased in total waves would deny
 * that.
 *
 * ## Why this is measured on the RAW traced samples
 *
 * The obvious place to measure a gradient is the fitted wavefront on the FFT
 * grid, and it is the wrong place. A Zernike fit is band-limited by
 * construction, so it is smooth *whatever* it was fitted to: evaluated on a
 * fine grid it reports "gentle, FFT valid" exactly when the true wavefront had
 * content the basis discarded. A safety switch keyed on it would be blindest
 * when the fallback is most needed. So the gradient here comes from
 * differences between neighbouring TRACED samples, which is also literally the
 * quantity the architecture names.
 *
 * ## Two failure modes, two numbers
 *
 * They are independent, and measurement showed neither one subsumes the other:
 *
 *  - **`maxGradientWavesPerRadius`** — the wavefront is too steep for the
 *    pupil sampling. This is the primary signal. Across a spherical mirror
 *    opened from NA 0.05 to NA 0.6 it runs from 0.011 to 222 waves per traced
 *    step, crossing the half-wave criterion in between.
 *  - **`fitResidualWaves`** — the wavefront has a SHAPE the basis cannot
 *    represent (a turbulence screen, a vignetted edge). Note this does *not*
 *    trip on the case above: spherical aberration is exactly representable by
 *    low-order rotationally-symmetric terms, so over that same NA sweep the
 *    residual stays below 3·10⁻⁵ of the wavefront even as the gradient
 *    explodes. A switch keyed on the residual alone would sail straight
 *    through an aliasing wavefront.
 */

export interface OpdSampling {
  /** Largest |ΔOPD| between neighbouring traced samples (waves). */
  readonly maxStepWaves: number;
  /** Median nearest-neighbour spacing, in normalized pupil radii. */
  readonly spacing: number;
  /** Largest |∇OPD|, in waves per unit normalized pupil radius. */
  readonly maxGradientWavesPerRadius: number;
  /** RMS of what the Zernike basis could not represent (waves). */
  readonly fitResidualWaves: number;
}

/**
 * Sampling quality of a traced OPD map.
 *
 * O(N²) in the sample count, which is affordable precisely because this runs
 * on the COARSE trace grid (a few hundred points) and never on the FFT grid.
 * Neighbours are taken as all pairs within 1.6× the median nearest-neighbour
 * spacing, rather than the single nearest: on a square grid the single nearest
 * neighbour can sit along the shallow direction and miss the steep one.
 */
export function opdSampling(map: OpdMap, fit?: ZernikeFit): OpdSampling {
  const s = map.samples;
  const n = s.length;
  if (n < 2) {
    return {
      maxStepWaves: 0,
      spacing: 0,
      maxGradientWavesPerRadius: 0,
      fitResidualWaves: fit?.rmsResidualWaves ?? 0,
    };
  }

  const nearest = new Float64Array(n).fill(Infinity);
  for (let i = 0; i < n; i++) {
    const a = s[i]!;
    for (let j = i + 1; j < n; j++) {
      const b = s[j]!;
      const d2 = (a.px - b.px) ** 2 + (a.py - b.py) ** 2;
      if (d2 < nearest[i]!) nearest[i] = d2;
      if (d2 < nearest[j]!) nearest[j] = d2;
    }
  }
  const sorted = Array.from(nearest, Math.sqrt).sort((x, y) => x - y);
  const spacing = sorted[Math.floor(sorted.length / 2)]!;

  const cutoff = spacing * 1.6;
  const cutoff2 = cutoff * cutoff;
  let maxStep = 0;
  let maxGradient = 0;
  for (let i = 0; i < n; i++) {
    const a = s[i]!;
    for (let j = i + 1; j < n; j++) {
      const b = s[j]!;
      const d2 = (a.px - b.px) ** 2 + (a.py - b.py) ** 2;
      if (d2 > cutoff2 || d2 === 0) continue;
      const step = Math.abs(a.waves - b.waves);
      if (step > maxStep) maxStep = step;
      const g = step / Math.sqrt(d2);
      if (g > maxGradient) maxGradient = g;
    }
  }

  return {
    maxStepWaves: maxStep,
    spacing,
    maxGradientWavesPerRadius: maxGradient,
    fitResidualWaves: fit?.rmsResidualWaves ?? 0,
  };
}

/**
 * Phase change per pupil sample if the pupil is gridded with `pupilSamples`
 * across its diameter — i.e. |∇OPD|·Δ_pupil, in waves.
 *
 * Δ_pupil is 2/pupilSamples in normalized radii, because `pupilSamples` spans
 * the DIAMETER and the gradient is per unit RADIUS.
 */
export function phaseStepPerSample(sampling: OpdSampling, pupilSamples: number): number {
  return (sampling.maxGradientWavesPerRadius * 2) / pupilSamples;
}

/**
 * The half-wave criterion: below this the FFT branch is sound, above it the
 * wavefront aliases on the grid and the geometric PSF is the honest answer.
 */
export const PHASE_STEP_LIMIT = 0.5;

/** Does the FFT branch resolve this wavefront at this pupil sampling? */
export function fftBranchIsValid(sampling: OpdSampling, pupilSamples: number): boolean {
  return phaseStepPerSample(sampling, pupilSamples) < PHASE_STEP_LIMIT;
}
