import { fft2d, isPowerOfTwo } from "../math/fft";
import { imagePixelScaleMm, type PupilFunction, type PupilScale } from "../wave/psf";
import { incoherentPsf, type EmitterField, type IncoherentPsf } from "./fluorescence";

/**
 * Out-of-focus haze — the 3-D specimen, and why widefield cannot escape it.
 *
 * § 6i images one plane. A real specimen is a volume, and a real widefield
 * fluorescence image is dominated by light from emitters that are *not* in the
 * focal plane. That is not a small correction to be added later: it is the
 * single largest difference between what § 6i forms and what a microscope
 * shows, and it is the reason deconvolution and confocal exist at all.
 *
 * The operator is § 6i's, summed over depth. Emitters are incoherent by nature
 * whatever plane they sit in, so intensities still add and each plane still
 * images by a plain convolution — with the kernel of the pupil **as that plane
 * sees it**, which is the in-focus pupil plus a defocus wavefront:
 *
 *     I(x) = Σ_z T(z) · [ h_z ⊛ E_z ](x),      h_z = |F⁻¹{P·e^{2πi·w(z)·ρ²}}|²
 *
 * ## The finding: defocus does not dim, it only spreads
 *
 * A defocus is a **pure phase**. It changes no amplitude anywhere in the pupil,
 * so Σ|P|² is untouched and — by Parseval, through the engine's own FFT — the
 * kernel's total is untouched with it. `IncoherentPsf.formedSum` exists for this
 * module and reports it: it is identical across 0 → 8 waves of defocus to f64
 * noise, and it is identical for a reason no amount of grid refinement can
 * change. **Every plane of a thick specimen delivers its entire flux to the
 * image, however far out of focus it is.**
 *
 * What defocus does instead is redistribute. The on-axis intensity follows
 *
 *     h_w(0) / h_0(0)  =  sinc²(π·w₂₀)  =  [ sin(π·w₂₀) / (π·w₂₀) ]²
 *
 * — a closed form the engine reproduces and converges to (§ 6k.1), worth two
 * things beyond itself. At a quarter wave it is **8/π² = 0.8106**, which is the
 * Rayleigh quarter-wave criterion and § 2b's Maréchal Strehl arriving from the
 * axial side; and § 6j's depth of focus is *defined* as half a wave across the
 * full range, so "half a depth of focus" and "a quarter wave" and "Strehl 0.81"
 * are one statement. At **every integer wave it is exactly zero** — all the
 * light is in the rings, none of it on axis, and the total has not moved.
 *
 * So the light from an out-of-focus plane is neither lost nor dimmed. It is
 * spread into a background that carries no detail, and that background IS the
 * haze. A thick specimen's in-focus fraction is set by how much of the specimen
 * is in focus and by nothing else — not by the objective, not by the exposure,
 * and not by refocusing (§ 6k.2).
 *
 * ## The same fact, transformed: the missing cone
 *
 * Stack the kernels over defocus and transform along that axis and the statement
 * above becomes the one every deconvolution paper opens with. At zero lateral
 * frequency the transfer of each plane is its own total, which is constant, and
 * the transform of a constant sequence is **exactly zero at every axial
 * frequency but DC**. The 3-D widefield OTF has no support on the axial axis:
 * the instrument transmits no axial information whatever about the specimen's
 * total brightness, so no inversion can recover it and deconvolution is
 * ill-posed for a reason that is structural rather than numerical.
 *
 * `axialSpectrum` returns that null at 1e-12 (§ 6k.3), and it is worth being
 * precise about why the number is not an artifact of the normalizer. § 6i's
 * kernels are scaled to sum 1, so the ratio of two of THEM would read 1 whatever
 * the pupils did — the same shape of trap as § 6j.2's "the stack still summed to
 * 1 afterwards". The weight this module stacks with is `formedSum`, which the
 * kernel had before normalization, and the null therefore has a negative
 * control: give the stack pupils whose **amplitude** varies with depth and it
 * breaks immediately (§ 6k.3). Defocus alone cannot break it, and that is the
 * physics rather than the arithmetic.
 *
 * Away from the axis the support opens up, and its boundary is derivable from
 * the same quadratic wavefront § 1.5 pins. The phase difference a defocus w₂₀
 * puts between two pupil points separated by ν is 2·w₂₀·(u·ν) waves — linear in
 * u — so transforming over w₂₀ maps each axial frequency onto one *line* of the
 * two discs' overlap, and the 3-D OTF is that overlap's own chord profile:
 *
 *     OTF₃(ν, μ) = g( μ/(2ν) ) / (2ν),   g(t) = 2·√(1 − (|t| + ν/2)²)
 *
 * supported on **|μ| ≤ ν·(2 − ν)** cycles per wave of w₂₀, which in physical
 * units is ν_z ≤ NA·ν_r − λ·ν_r²/2. It closes at ν = 0 (the missing cone) and
 * again at ν = 2 (the lateral cutoff), and peaks at the pupil edge. § 6k.4
 * measures the edge on the engine's own stacked kernels and § 6k.5 pins the
 * defocused OTF itself against an independent quadrature of g.
 *
 * The 1/(2ν) in front is why deconvolution amplifies noise near the cone rather
 * than merely failing inside it: the transfer does not fall to zero at the
 * boundary and then stop, it concentrates into an ever-narrower band of axial
 * frequencies as ν → 0.
 *
 * ## § 6j's machinery, pointed at z — and the half of it that does not survive
 *
 * This is deliberately the same shape as `imaging/emission`: a callback that
 * hands back a pupil per stack coordinate, a stack of `incoherentPsf` kernels,
 * and a weighted sum. One thing does not carry over, and it is the interesting
 * one.
 *
 * § 6j stacks over **kernels rather than images** and calls it exact rather than
 * an economy: a single-label specimen emits with one spectrum, so E(x)·w(λ)
 * factors and Σ_λ w_λ(h_λ ⊛ E) = (Σ_λ w_λ h_λ) ⊛ E — one convolution with the
 * whole band inside the kernel. **Over z it does not factor**, because every
 * plane has its own emitter field and there is no common E to pull out. A volume
 * costs one convolution per slice, and that is the price of the third dimension
 * rather than an implementation that has not been optimized yet.
 *
 * The exception is exact and is worth having, because it is what "haze" means: a
 * specimen **uniform in z** puts the same E on every plane, factors again, and
 * collapses to a single convolution with Σ_z T(z)·h_z. That is `hazeKernel` —
 * the kernel of a thick uniform label, the closest thing to a picture of the
 * haze itself — and § 6k.6 pins that a slice-by-slice render of a z-uniform
 * volume equals it to 1e-12 while a z-varying one does not.
 *
 * ## Waves, not millimetres — and which conjugate they are measured in
 *
 * Depth enters through `defocusWaves`, δ·NA²/(2·n·λ), which is § 1.5's own
 * wavefront W(ρ) = ½·δ·NA²·ρ² read at the rim. That number is **the same on both
 * sides of the objective**, exactly: δ′ = δ·M²·n′/n by the longitudinal
 * magnification § 6j pins, and NA′ = NA/|M| by the sine condition, so the M²
 * cancels against the NA² and the n against the n′. So a caller may author a
 * specimen in object-space millimetres with the objective's object-side NA and
 * the immersion index — which is how a specimen is actually described — and the
 * pupil the engine defocuses is the image-side one, with no conversion between
 * them to get backwards. § 6k.7 pins the invariance rather than assuming it.
 *
 * ## What is deliberately not here
 *
 * **Depth-dependent spherical aberration.** Focusing into a specimen whose index
 * does not match the immersion adds spherical aberration that *grows with depth*
 * — the dominant real-world defect of deep widefield and confocal imaging, and
 * the reason correction collars exist. § 6c already solves the plate to all
 * orders and § 6e the N-layer stack, so the physics is in the engine; wiring the
 * focal depth into that stack is its own step. Until it lands, `DepthPupils` is
 * a callback precisely so a caller can supply it, and the negative control in
 * § 6k.3 is a first user of that freedom.
 *
 * **No deconvolution, and no confocal.** Both are named by the missing cone
 * rather than built. Confocal is not a post-process at all — it needs a detection
 * pinhole and an excitation PSF, which is the excitation path § 6j left open.
 *
 * **No axial sampling verdict.** A stack whose slices step by more than the
 * kernel can resolve is undersampled in z exactly as a grid can be in x, but the
 * criterion is § 6f.9's shape of problem and would want its own rung. What is
 * reported instead is `maxGridPhaseStepWaves` per slice, unchanged from § 6i:
 * a badly defocused kernel outgrows the grid long before the stack undersamples,
 * and that guard already exists.
 */

/** One plane of a 3-D specimen: an emitter field at a depth. */
export interface EmitterSlice {
  /**
   * Depth from the focal plane, in **object-space millimetres**, positive away
   * from the objective. Object space because that is where a specimen is
   * described; see the header for why no conversion is needed.
   */
  readonly zMm: number;
  readonly field: EmitterField;
}

/** A 3-D specimen — § 6i's `EmitterField` given a third dimension. */
export interface EmitterVolume {
  /** Grid size; every slice must match. Power of two. */
  readonly size: number;
  readonly slices: readonly EmitterSlice[];
}

/**
 * The wavefront error a depth costs, in waves at the pupil rim.
 *
 * § 1.5 pins W(ρ) = ½·δ·NA²·ρ², so the rim value in waves is δ·NA²/(2·n·λ).
 * Conjugate-invariant — see the header — so `numericalAperture` and
 * `refractiveIndex` must simply describe the same side of the objective as `δ`.
 *
 * Half of § 6j's depth of focus lands on exactly ¼ by construction, which is
 * what ties this module's axial readouts to that step's tolerance.
 */
export function defocusWaves(
  offsetMm: number,
  numericalAperture: number,
  wavelengthNm: number,
  refractiveIndex = 1,
): number {
  if (!(numericalAperture > 0)) {
    throw new Error(`defocusWaves: NA must be positive, got ${numericalAperture}`);
  }
  if (!(wavelengthNm > 0)) {
    throw new Error(`defocusWaves: wavelength must be positive, got ${wavelengthNm}`);
  }
  if (!(refractiveIndex > 0)) {
    throw new Error(`defocusWaves: refractive index must be positive, got ${refractiveIndex}`);
  }
  return (offsetMm * numericalAperture * numericalAperture) / (2 * refractiveIndex * wavelengthNm * 1e-6);
}

/**
 * Add a defocus wavefront to a pupil — the one aberration a depth introduces.
 *
 * A pure phase, and that is the whole of § 6k.1: `amplitude` is passed through
 * untouched, so whatever the pupil transmitted it still transmits. Composes onto
 * a *traced* pupil as readily as onto `idealPupil`, which is what lets a volume
 * be rendered through a real objective.
 */
export function withDefocus(pupil: PupilFunction, waves: number): PupilFunction {
  if (waves === 0) return pupil;
  return {
    amplitude: (px, py) => pupil.amplitude(px, py),
    phaseWaves: (px, py) => pupil.phaseWaves(px, py) + waves * (px * px + py * py),
  };
}

/**
 * What one depth looks through — `imaging/emission`'s `EmissionPupils`, keyed on
 * defocus instead of wavelength.
 *
 * A callback rather than a single pupil so that a caller can vary more than the
 * defocus with depth. § 6k.3's negative control was the first user of that
 * freedom, and two things in the engine now are: § 6l's `mountPupils`, which
 * varies the aberration with depth, and § 6bd's `FieldDepthPupils`, which is
 * this type keyed on the field position as well — `(u, v) => DepthPupils`, so a
 * patched depth stack composes with everything here and needs no adapter.
 */
export type DepthPupils = (defocusWaves: number) => PupilFunction;

/** The ordinary case: one pupil, defocused. */
export function defocusing(pupil: PupilFunction): DepthPupils {
  return (waves) => withDefocus(pupil, waves);
}

export interface DepthKernel extends IncoherentPsf {
  readonly defocusWaves: number;
  /**
   * This slice's `formedSum` against that of the stack's least-defocused member.
   *
   * **Exactly 1 for every slice** when the pupils differ only by defocus, which
   * is § 6k.1 — and the reason it is computed from `formedSum` rather than from
   * the kernel's own (normalized) values is that the latter would read 1 by
   * arithmetic. See the header.
   */
  readonly relativeThroughput: number;
}

export interface DepthKernelOptions {
  /** Frequency bins across the pupil diameter, as in `abbeImage`. */
  readonly pupilSamples: number;
  readonly size: number;
  /** Supply to get a physical `pixelScaleMm` back; omit for grid units. */
  readonly scale?: PupilScale;
}

/**
 * The focus stack — one `incoherentPsf` per defocus, each carrying its weight.
 *
 * § 6j's `emissionKernel` builds the same stack over wavelength and immediately
 * collapses it, because there it factors. Here the stack is the deliverable:
 * only a z-uniform specimen may collapse it (`hazeKernel`), and the readouts
 * that make the missing cone visible need every member.
 */
export function depthKernels(
  pupils: DepthPupils,
  defocus: readonly number[],
  options: DepthKernelOptions,
): DepthKernel[] {
  if (defocus.length === 0) throw new Error("depthKernels: no defocus samples");
  const built = defocus.map((waves) => ({
    waves,
    kernel: incoherentPsf(pupils(waves), {
      pupilSamples: options.pupilSamples,
      size: options.size,
      ...(options.scale === undefined ? {} : { scale: options.scale }),
    }),
  }));
  // The reference is the least-defocused member rather than index 0, so a stack
  // authored from -N to +N is measured against its own focal plane and not
  // against its far edge.
  let reference = built[0]!;
  for (const entry of built) {
    if (Math.abs(entry.waves) < Math.abs(reference.waves)) reference = entry;
  }
  return built.map(({ waves, kernel }) => ({
    ...kernel,
    defocusWaves: waves,
    relativeThroughput: kernel.formedSum / reference.kernel.formedSum,
  }));
}

export interface HazeKernel {
  readonly size: number;
  readonly pupilSamples: number;
  /** Normalized to sum 1, DC-at-index-0 — interchangeable with `incoherentPsf`. */
  readonly values: Float64Array;
  /** Σ of the members' own weights, before normalization: the light stacked. */
  readonly formedSum: number;
  /** Max over members — the grid's ability to carry the worst kernel it saw. */
  readonly maxGridPhaseStepWaves: number;
  readonly pixelScaleMm?: number;
}

/**
 * Collapse a focus stack into one kernel — legal **only** for a specimen that is
 * uniform in z, and the closest thing to a picture of the haze.
 *
 * The header's exception: Σ_z T(z)·(h_z ⊛ E) = (Σ_z T(z)·h_z) ⊛ E holds when E
 * is the same on every plane. A thick uniform label is that specimen, and it is
 * also the worst case a widefield microscope faces, so this kernel is what a
 * fluorescent background actually does to an image.
 *
 * `weights` is the slice thickness or relative label density, defaulting to 1 —
 * a Riemann sum over depth, so a stack that samples z more finely does not
 * brighten by arithmetic (§ 6j's own discipline with the band).
 */
export function hazeKernel(
  kernels: readonly DepthKernel[],
  weights?: readonly number[],
): HazeKernel {
  if (kernels.length === 0) throw new Error("hazeKernel: no kernels to stack");
  if (weights !== undefined && weights.length !== kernels.length) {
    throw new Error(
      `hazeKernel: ${weights.length} weights for ${kernels.length} kernels — they must match`,
    );
  }
  const n = kernels[0]!.size;
  const values = new Float64Array(n * n);
  let formedSum = 0;
  let maxGridPhaseStepWaves = 0;
  for (let k = 0; k < kernels.length; k++) {
    const kernel = kernels[k]!;
    if (kernel.size !== n) {
      throw new Error(`hazeKernel: kernel ${k} is ${kernel.size} where the first is ${n}`);
    }
    const w = (weights?.[k] ?? 1) * kernel.relativeThroughput;
    for (let i = 0; i < n * n; i++) values[i] = values[i]! + w * kernel.values[i]!;
    formedSum += w;
    maxGridPhaseStepWaves = Math.max(maxGridPhaseStepWaves, kernel.maxGridPhaseStepWaves);
  }
  let sum = 0;
  for (let i = 0; i < n * n; i++) sum += values[i]!;
  if (!(sum > 0)) throw new Error("hazeKernel: the stack carries no light");
  for (let i = 0; i < n * n; i++) values[i] = values[i]! / sum;
  const first = kernels[0]!;
  return {
    size: n,
    pupilSamples: first.pupilSamples,
    values,
    formedSum,
    maxGridPhaseStepWaves,
    ...(first.pixelScaleMm === undefined ? {} : { pixelScaleMm: first.pixelScaleMm }),
  };
}

export interface VolumeImageOptions {
  /** Frequency bins across the pupil diameter, as in `abbeImage`. */
  readonly pupilSamples: number;
  /** Object-side NA — the same side `EmitterSlice.zMm` is measured in. */
  readonly numericalAperture: number;
  readonly wavelengthNm: number;
  /** The immersion medium the object-side cone is in. */
  readonly refractiveIndex?: number;
  /** Which depth the objective is focused on (object mm). Defaults to 0. */
  readonly focusMm?: number;
  /** Supply to get a physical `pixelScaleMm` back; omit for grid units. */
  readonly scale?: PupilScale;
  /** Called once per slice imaged, for progress and cost accounting. */
  readonly onSlice?: (done: number, total: number) => void;
}

export interface VolumeImage {
  readonly size: number;
  /** Intensity, in the object's own coordinates (NOT fftshifted). */
  readonly intensity: Float64Array;
  /** Each slice's contribution to the total image flux, in input order. */
  readonly sliceFlux: readonly number[];
  /**
   * The fraction of the image's light emitted within ± half a depth of focus.
   *
   * The haze statement as one number, and § 6k.2 pins that it is a property of
   * the SPECIMEN and not of the instrument: since each plane delivers its whole
   * flux, this is the in-focus emitters' share of the total emitted flux, and
   * refocusing moves which emitters are counted without changing the arithmetic.
   */
  readonly inFocusFraction: number;
  /** Max over slices — the grid's ability to carry the worst kernel it saw. */
  readonly maxGridPhaseStepWaves: number;
  readonly pixelScaleMm?: number;
}

/**
 * Image a 3-D specimen — one convolution per slice, because z does not factor.
 *
 * The header says why this cannot be a single transform the way § 6j's band can,
 * and `hazeKernel` is the one case where it can.
 */
export function renderVolume(
  volume: EmitterVolume,
  pupils: DepthPupils,
  options: VolumeImageOptions,
): VolumeImage {
  const n = volume.size;
  if (!isPowerOfTwo(n)) throw new Error(`grid size must be a power of two, got ${n}`);
  if (volume.slices.length === 0) throw new Error("renderVolume: the volume has no slices");
  const focusMm = options.focusMm ?? 0;
  const nMedium = options.refractiveIndex ?? 1;
  const halfDepthMm =
    (nMedium * options.wavelengthNm * 1e-6) /
    (2 * options.numericalAperture * options.numericalAperture);

  const intensity = new Float64Array(n * n);
  const sliceFlux: number[] = [];
  let maxGridPhaseStepWaves = 0;
  let inFocusFlux = 0;
  let totalFlux = 0;

  for (let s = 0; s < volume.slices.length; s++) {
    const slice = volume.slices[s]!;
    if (slice.field.size !== n) {
      throw new Error(`renderVolume: slice ${s} is ${slice.field.size} where the volume is ${n}`);
    }
    if (slice.field.values.length !== n * n) {
      throw new Error(`renderVolume: slice ${s} must hold ${n * n} values`);
    }
    const offsetMm = slice.zMm - focusMm;
    const waves = defocusWaves(offsetMm, options.numericalAperture, options.wavelengthNm, nMedium);
    const kernel = incoherentPsf(pupils(waves), {
      pupilSamples: options.pupilSamples,
      size: n,
      ...(options.scale === undefined ? {} : { scale: options.scale }),
    });
    maxGridPhaseStepWaves = Math.max(maxGridPhaseStepWaves, kernel.maxGridPhaseStepWaves);

    // The kernel sums to 1, so its convolution carries exactly the slice's own
    // emitted flux times whatever the pupil actually transmitted. That second
    // factor is where a depth-varying pupil would show up, and where a pure
    // defocus provably does not.
    const throughput = kernel.formedSum;
    let emitted = 0;
    for (let i = 0; i < n * n; i++) emitted += slice.field.values[i]!;
    const formed = convolveCircular(slice.field.values, kernel.values, n);
    for (let i = 0; i < n * n; i++) intensity[i] = intensity[i]! + throughput * formed[i]!;

    const flux = throughput * emitted;
    sliceFlux.push(flux);
    totalFlux += flux;
    if (Math.abs(offsetMm) <= halfDepthMm) inFocusFlux += flux;
    options.onSlice?.(s + 1, volume.slices.length);
  }

  const first = volume.slices[0]!;
  const pixelScaleMm =
    options.scale === undefined
      ? undefined
      : imagePixelScaleMm(options.scale, first.field.size, options.pupilSamples);

  return {
    size: n,
    intensity,
    sliceFlux,
    inFocusFraction: totalFlux > 0 ? inFocusFlux / totalFlux : 0,
    maxGridPhaseStepWaves,
    ...(pixelScaleMm === undefined ? {} : { pixelScaleMm }),
  };
}

/** One lateral frequency's transfer, read across a focus stack. */
export interface AxialTransfer {
  /** The stack's defocus coordinate, in waves — uniformly spaced. */
  readonly defocusWaves: readonly number[];
  /** Frequency bin the transfer was read at; 0 is DC. */
  readonly lateralBin: number;
  readonly re: Float64Array;
  readonly im: Float64Array;
}

/**
 * The OTF at one lateral frequency, as a function of depth.
 *
 * Weighted by `relativeThroughput`, so the sequence carries how much light each
 * plane actually delivered and not merely how it was shaped. At `lateralBin` 0
 * that makes the sequence the plane's own flux — constant under pure defocus,
 * which is the whole of § 6k.3.
 *
 * Read along the grid's x axis. The kernels are circularly symmetric whenever
 * the pupil is, and when it is not, a caller who needs another azimuth wants a
 * rotated pupil rather than another argument here — `rotatePupil` already does
 * that, exactly, and § 6h pins it.
 */
export function axialTransfer(
  kernels: readonly DepthKernel[],
  lateralBin: number,
): AxialTransfer {
  if (kernels.length === 0) throw new Error("axialTransfer: no kernels");
  const n = kernels[0]!.size;
  if (!Number.isInteger(lateralBin) || lateralBin < 0 || lateralBin >= n) {
    throw new Error(`axialTransfer: lateral bin must lie in [0, ${n}), got ${lateralBin}`);
  }
  const re = new Float64Array(kernels.length);
  const im = new Float64Array(kernels.length);
  // Precomputed once: the same row of phase factors serves every kernel.
  const cos = new Float64Array(n);
  const sin = new Float64Array(n);
  for (let x = 0; x < n; x++) {
    const ang = (-2 * Math.PI * lateralBin * x) / n;
    cos[x] = Math.cos(ang);
    sin[x] = Math.sin(ang);
  }
  for (let k = 0; k < kernels.length; k++) {
    const kernel = kernels[k]!;
    if (kernel.size !== n) {
      throw new Error(`axialTransfer: kernel ${k} is ${kernel.size} where the first is ${n}`);
    }
    let sumRe = 0;
    let sumIm = 0;
    for (let y = 0; y < n; y++) {
      const row = y * n;
      for (let x = 0; x < n; x++) {
        const v = kernel.values[row + x]!;
        sumRe += v * cos[x]!;
        sumIm += v * sin[x]!;
      }
    }
    re[k] = kernel.relativeThroughput * sumRe;
    im[k] = kernel.relativeThroughput * sumIm;
  }
  return { defocusWaves: kernels.map((k) => k.defocusWaves), lateralBin, re, im };
}

export interface AxialSpectrum {
  /** Axial frequency of each bin, in **cycles per wave of defocus**. */
  readonly cyclesPerWave: Float64Array;
  readonly magnitude: Float64Array;
}

/**
 * Transform a focus stack's transfer along the depth axis — the 3-D OTF, one
 * lateral frequency at a time.
 *
 * The defocus samples must be uniformly spaced, and that is enforced rather than
 * assumed: a DFT of a non-uniform sequence produces a perfectly plausible
 * spectrum of the wrong thing, and the missing cone would still look like a
 * missing cone in it.
 *
 * Bins run 0 … N/2 (the real half), since the magnitude is symmetric. The DFT is
 * scaled by the sample step so the result is a Riemann sum over depth and does
 * not change with how finely the stack was sampled.
 */
export function axialSpectrum(transfer: AxialTransfer): AxialSpectrum {
  const m = transfer.re.length;
  if (m < 2) throw new Error("axialSpectrum: a spectrum needs at least two slices");
  const step = transfer.defocusWaves[1]! - transfer.defocusWaves[0]!;
  if (!(Math.abs(step) > 0)) {
    throw new Error("axialSpectrum: the stack's defocus samples must be distinct");
  }
  for (let i = 1; i < m; i++) {
    const d = transfer.defocusWaves[i]! - transfer.defocusWaves[i - 1]!;
    if (Math.abs(d - step) > 1e-9 * Math.abs(step)) {
      throw new Error(
        `axialSpectrum: the stack must be uniformly spaced in defocus — step ${d} at slice ${i} ` +
          `where the first was ${step}`,
      );
    }
  }

  const bins = Math.floor(m / 2) + 1;
  const cyclesPerWave = new Float64Array(bins);
  const magnitude = new Float64Array(bins);
  const span = Math.abs(step) * m;
  for (let b = 0; b < bins; b++) {
    let re = 0;
    let im = 0;
    for (let i = 0; i < m; i++) {
      const ang = (-2 * Math.PI * b * i) / m;
      const c = Math.cos(ang);
      const s = Math.sin(ang);
      re += transfer.re[i]! * c - transfer.im[i]! * s;
      im += transfer.re[i]! * s + transfer.im[i]! * c;
    }
    cyclesPerWave[b] = b / span;
    magnitude[b] = Math.hypot(re, im) * Math.abs(step);
  }
  return { cyclesPerWave, magnitude };
}

/**
 * The 3-D OTF's support boundary, in cycles per wave of defocus.
 *
 *     μ_max(ν) = ν · (2 − ν)
 *
 * derived in the header from the quadratic defocus wavefront and measured in
 * § 6k.4. Zero at ν = 0 — the missing cone — and again at the ν = 2 lateral
 * cutoff, peaking at the pupil edge where μ_max = 1.
 *
 * `nu` is in pupil-radius units, `illumination/transfer`'s own frequency scale
 * (ν = 1 ↔ NA/λ), so `axialTransfer`'s bin b on a `pupilSamples`-bin pupil is
 * ν = 2·b/pupilSamples.
 */
export function missingConeEdge(nu: number): number {
  if (!(nu >= 0)) throw new Error(`missingConeEdge: ν must be non-negative, got ${nu}`);
  return nu >= 2 ? 0 : nu * (2 - nu);
}

/**
 * `imaging/fluorescence`'s convolution, which is not exported from there.
 *
 * Both grids are in DC-at-0 layout, so there is nothing to roll — see that
 * module's note on why a half-grid roll is invisible to every energy check and
 * obvious in a picture.
 */
function convolveCircular(object: Float64Array, kernel: Float64Array, n: number): Float64Array {
  const objRe = Float64Array.from(object);
  const objIm = new Float64Array(n * n);
  const kerRe = Float64Array.from(kernel);
  const kerIm = new Float64Array(n * n);
  fft2d(objRe, objIm, n);
  fft2d(kerRe, kerIm, n);
  for (let i = 0; i < n * n; i++) {
    const ar = objRe[i]!;
    const ai = objIm[i]!;
    const br = kerRe[i]!;
    const bi = kerIm[i]!;
    objRe[i] = ar * br - ai * bi;
    objIm[i] = ar * bi + ai * br;
  }
  fft2d(objRe, objIm, n, true);
  return objRe;
}
