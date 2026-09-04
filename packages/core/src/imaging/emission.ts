import {
  spectralSamples,
  VISIBLE_MAX_NM,
  VISIBLE_MIN_NM,
  type SpectralSamplingOptions,
} from "../photometry/spectrum";
import { resampleEnergyGrid } from "../wave/polychromatic";
import { fftShift2d } from "../math/fft";
import type { WavelengthSample } from "../trace/system";
import type { OpticalSystem } from "../trace/system";
import { bestFocus } from "../analysis/focus";
import { tracedPupil, type FieldPupilOptions } from "./object-field";
import { incoherentPsf, type IncoherentPsf } from "./fluorescence";

/**
 * The Stokes shift, and the band the image is actually formed in.
 *
 * § 6i's operator is monochromatic and takes no excitation wavelength at all.
 * That is not an omission — it is the architecture, and it is the first thing
 * this module has to say. A fluorophore absorbs at λ_ex and emits at λ_em > λ_ex
 * (the Stokes shift), and the **emission filter blocks the excitation**, so the
 * excitation light never reaches the image. Resolution is therefore set by λ_em
 * and the excitation cannot appear in the imaging path however it is chosen.
 * The null is structural rather than measured, which is why § 6j pins the two
 * things that ARE measurable and lets that one be an argument.
 *
 * ## What the Stokes shift costs: focus
 *
 * Excitation and emission are different colours through the same glass, so they
 * come to focus in different planes. Whether that matters is a **ratio**, not a
 * distance: the shift against the depth of focus.
 *
 *     Δz / DOF,     DOF = n·λ / NA²
 *
 * and DOF here is *derived*, not transcribed. § 1.5 pins the engine's own
 * defocus wavefront, W(ρ) = ½·δ·NA²·ρ²; setting the rim value W(1) to the
 * quarter wave of the Rayleigh criterion gives δ = λ/(2·NA²) each side, so the
 * full range is λ/NA² in air and n·λ/NA² in a medium. `depthOfFocusMm` writes
 * exactly that, and § 6j.3 checks it by defocusing a real system by half the
 * range and reading a quarter wave off the *traced* wavefront — so the formula
 * is held to the tracer rather than to a textbook.
 *
 * The ratio is **invariant between object and image space**, which is what makes
 * it safe to measure where `bestFocus` lives (image side) and quote where a
 * microscopist works (object side): longitudinal magnification is M²·n′/n and
 * NA′ = NA/|M| by the sine condition, so DOF and Δz scale by the same factor and
 * it cancels. Measured on the ladder's own two objectives, a 20 nm shift costs
 * **0.32 depths of focus at 4×/0.10 and 3.77 at 100×/1.40** — free at low NA,
 * and a refocus between channels at high NA.
 *
 * Part of that 12× is NA (DOF ∝ 1/NA²) and part is the objective's own colour
 * correction, and § 6e says which: the aplanatic front group is exact at ONE
 * wavelength and "the chromatic half" is its named open item. So the second
 * number is partly the cost of that deferral, arriving where it bites. It is
 * NOT a claim about what a real apochromatic 100×/1.40 does.
 *
 * ## What the band costs: the same grid problem § 2e already solved
 *
 * An emission band is not a line. Each wavelength in it forms its own incoherent
 * PSF, and `imagePixelScaleMm` is ∝ λ — so the components live on *different
 * physical grids*, and summing them bin for bin would silently rescale each one
 * instead of stacking it. That is `wave/polychromatic`'s founding failure mode,
 * and this module reuses its resampler rather than growing a second one.
 *
 * The stack is over **kernels, not images**, and that is exact rather than an
 * economy. A single-label specimen emits with one spectrum, so the emitter
 * density factors as E(x)·w(λ) and linearity gives
 *
 *     I = Σ_λ w_λ · (h_λ ⊛ E) = (Σ_λ w_λ h_λ) ⊛ E
 *
 * — one convolution instead of one per wavelength, with the whole band carried
 * in the kernel. A two-label specimen does not factor that way, and that is the
 * colour deferral § 6i already recorded rather than a limit discovered here.
 *
 * **A band is not automatically a blur, and that surprised this step.** With an
 * aberration-free pupil the only thing λ changes is the scale, and a band
 * symmetric in λ is two-sided about it: the blue components are physically
 * narrower and genuinely concentrate more energy inside a fixed radius, while
 * the red ones spread. Neither the peak pixel nor the core energy moves
 * monotonically with band width across 0 → 200 nm, so § 6j.2 pins the isolation
 * instead — hold the scale fixed and band width does *nothing at all*, exactly —
 * and leaves the direction unpinned rather than choosing whichever readout
 * happened to fall. Blur needs an objective that focuses the colours in
 * different planes, and § 6j.5 measures it on one, comparing two bands that are
 * both resampled so the resampler's own smoothing cancels.
 *
 * ## The band's weights are the SOURCE's, and they may be applied exactly once
 *
 * `imaging/scene` carries an explicit warning that a scene render must be given
 * *pure quadrature* samples with each source's spectrum kept on the source,
 * because handing it SED-weighted samples applies the spectrum twice and
 * produces a perfectly plausible image of the wrong colour. `emissionSamples`
 * builds SED-weighted samples on purpose — the band IS the source spectrum and
 * there is exactly one source class here — so they belong to *this* path and
 * must not be handed to `renderField` alongside per-source spectra. § 6j.1 pins
 * that the band enters once.
 *
 * ## No fluorophore is named
 *
 * Real excitation/emission curves are measured data, and transcribing a dye's
 * from memory is what the hard rule forbids. What is offered is `boxcarBand`,
 * which is a statement about an **interference filter** — those really are
 * approximately rectangular — and a caller-supplied `(nm) => number` for
 * anything else, exactly as `PointSource.spectrum` already works.
 */

/** Relative emitted power per wavelength. The caller's, as a scene's SED is. */
export type EmissionSpectrum = (nm: number) => number;

/**
 * A rectangular passband — the emission FILTER, not a fluorophore's lineshape.
 *
 * Named for what it models. An interference filter's transmission really is
 * close to rectangular; a dye's emission is not, and inventing a lineshape for
 * one would be minting data.
 */
export function boxcarBand(centreNm: number, widthNm: number): EmissionSpectrum {
  if (!(widthNm >= 0)) throw new Error(`band width must be >= 0, got ${widthNm}`);
  const lo = centreNm - widthNm / 2;
  const hi = centreNm + widthNm / 2;
  return (nm) => (nm >= lo && nm <= hi ? 1 : 0);
}

/**
 * The band as weighted wavelength samples, normalized to sum 1.
 *
 * `spectralSamples` is the right constructor and is used unchanged: its own
 * documentation splits the world into "one source, no scene — the SED goes in
 * the weights" and "a scene — the SED belongs to each source and the weights
 * are pure quadrature", and a single-label fluorescent specimen is squarely the
 * first. Normalizing on top is what keeps a kernel stacked on these carrying the
 * band's *shape* rather than its area, so widening a filter does not brighten
 * the image by arithmetic.
 */
export function emissionSamples(
  band: EmissionSpectrum,
  options: SpectralSamplingOptions = {},
): WavelengthSample[] {
  const weighted = spectralSamples(band, options);
  const total = weighted.reduce((a, s) => a + s.weight, 0);
  if (!(total > 0)) {
    throw new Error(
      `emissionSamples: the band is zero over [${options.fromNm ?? VISIBLE_MIN_NM}, ` +
        `${options.toNm ?? VISIBLE_MAX_NM}] nm — no light reaches the image`,
    );
  }
  return weighted.map((s) => ({ nm: s.nm, weight: s.weight / total }));
}

export interface EmissionKernel extends IncoherentPsf {
  /** The samples actually stacked, weights normalized to sum 1. */
  readonly samples: readonly WavelengthSample[];
  /** Weighted-mean wavelength (nm) — what `pixelScaleMm` refers to. */
  readonly meanWavelengthNm: number;
  /**
   * Fraction of the stacked energy that fell off the common grid in resampling.
   *
   * Reported rather than renormalized away, `wave/polychromatic`'s discipline:
   * silently rescaling truncation turns it into a brightness error nobody can
   * see. It is the long-wavelength components that lose, their kernels being
   * physically wider than the grid chosen for the mean.
   */
  readonly truncatedFraction: number;
}

/** What one wavelength of the band looks through. */
export type EmissionPupils = (nm: number) => {
  readonly pupil: Parameters<typeof incoherentPsf>[0];
  readonly scale: NonNullable<Parameters<typeof incoherentPsf>[1]["scale"]>;
};

/**
 * Stack a band of incoherent PSFs onto one physical grid.
 *
 * Every component is built by `incoherentPsf` — the Abbe lattice, § 6i.1's
 * reason — resampled to the mean wavelength's pixel scale, weighted and summed.
 * The result is renormalized to unit sum so it stays a kernel a caller may
 * convolve with directly.
 */
export function emissionKernel(
  pupils: EmissionPupils,
  samples: readonly WavelengthSample[],
  options: { readonly size: number; readonly pupilSamples: number },
): EmissionKernel {
  if (samples.length === 0) throw new Error("emissionKernel: no wavelength samples");
  const { size, pupilSamples } = options;
  const total = samples.reduce((a, s) => a + s.weight, 0);
  if (!(total > 0)) throw new Error("emissionKernel: sample weights must sum to a positive number");
  const meanWavelengthNm = samples.reduce((a, s) => a + (s.weight / total) * s.nm, 0);

  const built = samples.map((sample) => {
    const { pupil, scale } = pupils(sample.nm);
    return { sample, kernel: incoherentPsf(pupil, { size, pupilSamples, scale }) };
  });
  // The common grid is the mean wavelength's own, which keeps it inside the
  // range the components span rather than extrapolating past either end —
  // `wave/polychromatic`'s choice, for its reason.
  let targetPixelScaleMm = 0;
  for (const { sample, kernel } of built) {
    targetPixelScaleMm += (sample.weight / total) * kernel.pixelScaleMm!;
  }

  const values = new Float64Array(size * size);
  let transmittingSamples = 0;
  let energy = 0;
  let maxGridPhaseStepWaves = 0;
  let carried = 0;
  for (const { sample, kernel } of built) {
    const w = sample.weight / total;
    // `incoherentPsf` hands back DC-at-index-0 so a convolution is a plain
    // multiply, and `resampleEnergyGrid` scales about the grid's CENTRE. Resampling
    // the unshifted array would rescale a kernel wrapped into the four corners —
    // which is not a subtle error (it moved the peak by 60% and threw away 74%
    // of the light) but is completely invisible to a "does it still sum to 1"
    // check, since the sum is renormalized afterwards either way. So the stack
    // is done centred and shifted back once at the end.
    const centred = Float64Array.from(kernel.values);
    fftShift2d(centred, size);
    // A component already on the common grid is left alone. Since § 8c that is an
    // optimization and no longer a correction: the conservative resampler copies
    // an exactly-matching grid bit for bit, last row and column included, where
    // the bilinear one dropped them and lost 2.6e-4 of the light — which, after
    // renormalization, moved the peak by the same amount. The skip stays because
    // the comparison below is a TOLERANCE and this path must be exact: a
    // one-line band must be the monochromatic kernel EXACTLY, or every broadband
    // number is measured against a moving zero (§ 6j.1).
    // Compared within f64 rounding rather than bit-exactly: the target is a
    // WEIGHTED MEAN, so a component that is the mean can miss it by an ulp and
    // whether it does depends on summation order. A bit-exact test would make
    // the identity above hold or fail for reasons that have nothing to do with
    // optics.
    const resampled =
      Math.abs(kernel.pixelScaleMm! - targetPixelScaleMm) <= 1e-12 * targetPixelScaleMm
        ? centred
        : resampleEnergyGrid(centred, size, kernel.pixelScaleMm!, targetPixelScaleMm, size);
    let kept = 0;
    for (let i = 0; i < values.length; i++) {
      values[i] = values[i]! + w * resampled[i]!;
      kept += resampled[i]!;
    }
    carried += w * kept;
    transmittingSamples = Math.max(transmittingSamples, kernel.transmittingSamples);
    energy += w * kernel.energy;
    maxGridPhaseStepWaves = Math.max(maxGridPhaseStepWaves, kernel.maxGridPhaseStepWaves);
  }

  // Each component arrived with unit sum, so what is missing is what resampling
  // pushed off the grid — measured before the stack is renormalized, or the
  // measurement would be of nothing.
  const truncatedFraction = Math.max(0, 1 - carried);
  let sum = 0;
  for (let i = 0; i < values.length; i++) sum += values[i]!;
  for (let i = 0; i < values.length; i++) values[i] = values[i]! / sum;
  // Back to `incoherentPsf`'s layout, so the result is interchangeable with a
  // monochromatic kernel everywhere a caller might use one.
  fftShift2d(values, size);

  return {
    size,
    pupilSamples,
    values,
    transmittingSamples,
    energy,
    // What the stack summed to before its own normalization. Each component
    // arrived already normalized, so this is `carried` — the light resampling
    // kept — and not a transmitted power the way a monochromatic kernel's is.
    formedSum: sum,
    maxGridPhaseStepWaves,
    pixelScaleMm: targetPixelScaleMm,
    samples: samples.map((s) => ({ nm: s.nm, weight: s.weight / total })),
    meanWavelengthNm,
    truncatedFraction,
  };
}

/**
 * The band's pupils, traced — the callback `emissionKernel` asks for.
 *
 * Conjugate-agnostic, because `tracedPupil` is: `fieldValue` is degrees at
 * infinity and object millimetres at a finite conjugate, whichever the system
 * has. Each wavelength gets its own trace and therefore its own ruler, which is
 * the whole reason the stack has to resample.
 */
export function tracedEmissionPupils(
  system: OpticalSystem,
  fieldValue = 0,
  options: FieldPupilOptions = {},
): EmissionPupils {
  return (nm) => {
    const traced = tracedPupil(system, fieldValue, nm, options);
    return { pupil: traced.pupil, scale: traced.scale };
  };
}

/**
 * Depth of focus (full range, mm) at the quarter-wave criterion.
 *
 *     DOF = n·λ / NA²
 *
 * Derived rather than transcribed: § 1.5 pins the engine's defocus wavefront as
 * W(ρ) = ½·δ·NA²·ρ², so the rim reaches a quarter wave at δ = λ/(2·NA²) on each
 * side of focus and the full range is twice that. § 6j.3 defocuses a traced
 * system by half this and reads a quarter wave back off the wavefront, which
 * holds the formula to the tracer instead of to a textbook.
 *
 * `refractiveIndex` is the medium the cone is IN — the immersion fluid on the
 * object side, air on the image side of every system in the ladder. Getting it
 * wrong is a factor of 1.515 at NA 1.40, which is exactly the size of thing that
 * reads as a finding.
 */
export function depthOfFocusMm(
  wavelengthNm: number,
  numericalAperture: number,
  refractiveIndex = 1,
): number {
  if (!(numericalAperture > 0)) {
    throw new Error(`depthOfFocusMm: NA must be positive, got ${numericalAperture}`);
  }
  return (refractiveIndex * wavelengthNm * 1e-6) / (numericalAperture * numericalAperture);
}

/**
 * How far best focus moves between two wavelengths (mm, image side).
 *
 * The Stokes shift's cost, before it is referred to anything. `minRmsWavefront`
 * is the criterion because the depth of focus it is compared against is itself a
 * wavefront statement — § 1.6 pins that the three focus criteria genuinely
 * disagree, so mixing a geometric shift with a wave-optical tolerance would be
 * comparing two different definitions of focus.
 *
 * A *difference* is far better conditioned than either endpoint: the absolute
 * offset moves by ~5e-2 mm with the trace's pupil sampling on a 4×/0.10, while
 * this difference holds to 3% over the same sweep, and to 0.1% at NA 1.40.
 * § 6j.3 pins that stability rather than assuming it.
 */
export function chromaticFocusShiftMm(
  system: OpticalSystem,
  fromNm: number,
  toNm: number,
  options: { readonly fieldValue?: number; readonly pupilSamples?: number } = {},
): number {
  const at = (nm: number): number =>
    bestFocus(system, "minRmsWavefront", {
      wavelengthNm: nm,
      fieldValue: options.fieldValue ?? 0,
      pupilSamples: options.pupilSamples ?? 21,
    }).offsetFromLastVertex;
  return at(toNm) - at(fromNm);
}
