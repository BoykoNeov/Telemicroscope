import { fft2d, fftShift2d, isPowerOfTwo } from "../math/fft";
import { OpticalSystem } from "../trace/system";
import { AimOptions, pupilGrid } from "../pupil/aiming";
import { OpdMap, opdMap } from "../pupil/opd";
import { ZernikeFit, fitZernike, wavefrontSampler } from "./zernike";
import { OpdSampling, opdSampling } from "./fidelity";

/**
 * Point spread function — where the diffraction lives.
 *
 * The ray trace says every ray from a perfect paraboloid crosses one point; a
 * real telescope shows an Airy disc instead. The difference is not a
 * correction bolted onto the rays, it is what the pupil's finite size does to
 * a wave, and it appears here:
 *
 *     PSF(x) = |FFT{ A(ξ)·exp(2πi·W(ξ)) }|²
 *
 * with A the pupil amplitude and W the wavefront error in waves. Airy rings,
 * coma flares and (later) diffraction spikes all emerge from that one line —
 * nothing in this file knows their names.
 *
 * ## Three things that are easy to get wrong, and how they are handled
 *
 * **1. The phase is exactly 2π·W, with nothing added.** `opdMap` already
 * measures to a reference sphere centred on the image point
 * (ARCHITECTURE § Wavefront reference), so the quadratic term that converts a
 * plane to a sphere is ALREADY in the data. Adding a defocus phase for the
 * exit-pupil distance here would count it twice.
 *
 * **2. Two grids, not one.** The trace samples the pupil coarsely, a Zernike
 * fit turns that into a continuous function, and the fit is evaluated on the
 * fine FFT grid. Tracing at FFT resolution would be wasteful by two orders of
 * magnitude, and would make the atmospheric-seeing case (256²–512²)
 * impossible. `pupilSamples` and `padFactor` are therefore explicit knobs, not
 * constants: `padFactor` buys image-plane sampling without buying rays.
 *
 * **3. Energy is defined once.** `energy` is the transmitted pupil energy
 * Σ A², and the PSF is scaled so it integrates to exactly that. The geometric
 * PSF branch (still to come) must normalize to the SAME number or the fidelity
 * switch would change image brightness — which ARCHITECTURE forbids. Pinning
 * that here, before there is a second branch to disagree with, is the point.
 *
 * ## Scope
 *
 * Vignetting is reported (`OpdMap.lost`) but not yet carved out of the pupil
 * support: the aperture is modelled as the full disc, minus an optional
 * central obstruction. Partially-vignetted pupils and spider diffraction are
 * step 5, and they arrive as a different `PupilFunction`, not as a change
 * here — which is why the pupil is an interface rather than an array.
 */

/**
 * A complex pupil, sampled on demand. The seam between "what the aperture
 * looks like" and "what the FFT does with it": obstructions, spiders,
 * apodization and atmospheric phase screens all arrive as implementations of
 * this without the transform below changing at all.
 */
export interface PupilFunction {
  /** Amplitude at a normalized pupil point; 0 outside the aperture. */
  readonly amplitude: (px: number, py: number) => number;
  /** Wavefront error in waves. Only meaningful where amplitude > 0. */
  readonly phaseWaves: (px: number, py: number) => number;
}

/** What the pupil→image scale needs to know, independent of the pupil's shape. */
export interface PupilScale {
  /** Exit-pupil-to-image distance (mm) — the reference sphere's radius. */
  readonly referenceRadius: number;
  /** Exit pupil semi-diameter (mm). */
  readonly exitRadius: number;
  readonly wavelengthNm: number;
  /** Refractive index of image space (1 in air, ~1.515 for oil immersion). */
  readonly nImage: number;
}

export interface PsfOptions {
  /** Samples across the pupil DIAMETER on the FFT grid. Default 64. */
  readonly pupilSamples?: number;
  /** FFT size / pupilSamples. Buys image sampling, not rays. Default 4. */
  readonly padFactor?: number;
  /** Central obstruction as a fraction of pupil radius. Default 0. */
  readonly obstruction?: number;
  /**
   * Also return the aberration-free PSF array, not just its peak.
   *
   * Off by default: it doubles the memory a PSF carries across the worker
   * boundary, and only one caller needs it. The polychromatic stack does,
   * because a Strehl ratio for a spectrum has to compare a stacked peak
   * against a stack of aberration-free PSFs built the same way — the
   * per-wavelength peaks live on λ-dependent grids and cannot be summed.
   */
  readonly keepDiffractionLimited?: boolean;
  /**
   * Sub-samples per axis in cells that straddle an aperture edge. Default 4;
   * 1 disables edge resolution and restores plain point sampling. See
   * `amplitudeGrid` for what this buys and what it cannot.
   */
  readonly edgeSamples?: number;
}

export interface Psf {
  /** FFT grid size; the intensity array is `size`×`size`, row-major. */
  readonly size: number;
  /**
   * Samples across the pupil diameter that produced it. Kept because it sets
   * both scales that matter downstream: the Airy zero sits at
   * 1.22·size/pupilSamples pixels, and the MTF cutoff at exactly
   * `pupilSamples` frequency bins.
   */
  readonly pupilSamples: number;
  /** Intensity, fftshifted so the axis lands at (size/2, size/2). */
  readonly intensity: Float64Array;
  /** Image-plane millimetres per pixel. */
  readonly pixelScaleMm: number;
  /** Σ intensity — the transmitted pupil energy, by construction. */
  readonly energy: number;
  /** Peak intensity. */
  readonly peak: number;
  /** Peak of the same pupil with its phase zeroed — the Strehl denominator. */
  readonly diffractionLimitedPeak: number;
  /** peak / diffractionLimitedPeak. 1 for a perfect system. */
  readonly strehl: number;
  /**
   * The aberration-free PSF itself, present only when `keepDiffractionLimited`
   * was requested. Same grid and normalization as `intensity`.
   */
  readonly diffractionLimitedIntensity?: Float64Array;
  /**
   * Largest wavefront step between adjacent in-pupil samples OF THE FFT GRID
   * (waves) — i.e. whether this grid resolves the pupil function it was
   * handed.
   *
   * This is NOT the fidelity criterion, and must not be used as one. When the
   * pupil function came from a Zernike fit it is band-limited by construction,
   * so this number stays comfortably small even for a wavefront the fit could
   * not represent — it would report "valid" exactly when the geometric
   * fallback is needed. The criterion measured on the raw traced samples lives
   * in `wave/fidelity`, and `sampling` below carries it.
   */
  readonly maxGridPhaseStepWaves: number;
  /**
   * Sampling quality of the trace this PSF came from — the real fidelity
   * signal. Present only on the `psf()` path, which is the only one that has
   * the traced samples; `psfFromPupilFunction` is handed a pupil function and
   * cannot know what produced it.
   */
  readonly sampling?: OpdSampling;
  /**
   * Rays across the pupil diameter actually traced — present only on the
   * geometric branch. Reported so a caller can see what the blur-scaled
   * default chose, and in particular when its runtime cap has bound and the
   * histogram is running below its density target.
   */
  readonly rayGrid?: number;
  readonly wavelengthNm: number;
  readonly fieldValue: number;
}

/**
 * Build a pupil function from a traced OPD map.
 *
 * Phase comes from the Zernike fit — that is the resampling step. Amplitude
 * comes from a low-order fit of √throughput, so Fresnel apodization survives
 * (it is smooth and genuinely low-order); a system with uniform throughput
 * fits to a constant and nothing is invented.
 */
export function pupilFunctionFromOpd(
  map: OpdMap,
  fit: ZernikeFit,
  options: { obstruction?: number; amplitudeTerms?: number } = {},
): PupilFunction {
  const obstruction = options.obstruction ?? 0;
  if (obstruction < 0 || obstruction >= 1) {
    throw new Error(`obstruction must be in [0, 1), got ${obstruction}`);
  }
  const phase = wavefrontSampler(fit);

  let lo = Infinity;
  let hi = -Infinity;
  for (const s of map.samples) {
    if (s.throughput < lo) lo = s.throughput;
    if (s.throughput > hi) hi = s.throughput;
  }
  const uniform = !(hi - lo > 1e-12);
  const constantAmplitude = Math.sqrt(map.samples.length > 0 ? hi : 1);

  const amplitudeFit = uniform
    ? null
    : fitZernike(
        map.samples.map((s) => ({ px: s.px, py: s.py, waves: Math.sqrt(s.throughput) })),
        options.amplitudeTerms ?? 6,
      );
  const amplitudeSampler = amplitudeFit === null ? null : wavefrontSampler(amplitudeFit);

  const ob2 = obstruction * obstruction;
  return {
    amplitude: (px, py) => {
      const r2 = px * px + py * py;
      if (r2 > 1 || r2 < ob2) return 0;
      if (amplitudeSampler === null) return constantAmplitude;
      // A fit can dip below zero in a corner it was never constrained in;
      // amplitude cannot.
      return Math.max(0, amplitudeSampler(px, py));
    },
    phaseWaves: phase,
  };
}

/** Default sub-samples per axis in cells that straddle an aperture edge. */
export const DEFAULT_EDGE_SAMPLES = 4;

/**
 * Sample the pupil amplitude onto the FFT grid, resolving the aperture edge.
 *
 * ## Why the edge cannot just be point-sampled
 *
 * A circular aperture on a square grid is a staircase, and the staircase is not
 * rotationally symmetric — so its transform is not either. An unaberrated
 * circular pupil, whose PSF must be a perfectly circular Airy pattern, instead
 * comes back with **radial spokes**: at 64 samples across the pupil the
 * azimuthal variation at a fixed radius reaches 1.6·10⁻⁵ of the peak, where the
 * true answer is exactly zero.
 *
 * That number is small and the artifact is not. It looks like diffraction
 * spikes, which is a real optical effect this engine will later produce for
 * real reasons (spiders, step 5) — so leaving it in means a refractor renders
 * as though it had a spider in it. Physics is never faked, and neither is it
 * accidentally invented.
 *
 * ## What is done, and what remains
 *
 * Cells whose corners disagree about being inside the aperture are subdivided
 * and their amplitude is area-averaged; every other cell keeps its centre
 * value, so interior sampling is unchanged. The edge set is dilated by one cell
 * so a boundary that cuts a corner off without crossing any lattice point is
 * still caught. Only ~π·pupilSamples cells qualify — 256 of 65536 on a typical
 * grid — so the cost is negligible and it is generic: obstructions, and later
 * spiders and vignetted pupils, get it for free because it keys on the pupil
 * function's own zeros rather than on a circle.
 *
 * This removes the spokes and drops the spurious floor about 4×. It does not
 * reach zero, and cannot: representing an aperture as piecewise-constant on a
 * square grid carries an O(Δ²) boundary error however exactly each cell's mean
 * is computed. The residue is a faint plaid at ~4·10⁻⁶ of the peak, which is
 * the same level a pupil grid of twice the density reaches without this — so
 * the honest summary is that edge sampling buys a factor of two in pupil
 * resolution, not exactness.
 */
export interface PupilSampling {
  /**
   * Cell-averaged amplitude ⟨A⟩ — what the transform must use, because the
   * field a cell contributes is its average field.
   */
  readonly amplitude: Float64Array;
  /**
   * Cell-averaged POWER ⟨A²⟩ — what the energy must use, because the light a
   * cell passes is its average power.
   *
   * These are the same number everywhere except in a cell the aperture edge
   * cuts, and there they differ by exactly the discretization: a half-covered
   * cell of a hard aperture has ⟨A⟩ = ½ but ⟨A²⟩ = ½, not ¼. Normalizing the
   * PSF to Σ⟨A⟩² instead would shrink the transmitted energy by ~1% on a
   * 64-sample pupil — which is not a subtle bug, because that number is the
   * denominator of every encircled-energy figure and the value the geometric
   * branch matches itself to.
   */
  readonly power: Float64Array;
}

export function pupilSampling(
  pupil: PupilFunction,
  pupilSamples: number,
  size: number,
  edgeSamples: number = DEFAULT_EDGE_SAMPLES,
): PupilSampling {
  const half = size / 2;
  const step = 2 / pupilSamples;
  const out = new Float64Array(size * size);
  const power = new Float64Array(size * size);

  if (edgeSamples <= 1) {
    for (let iy = 0; iy < size; iy++) {
      const py = (iy - half) * step;
      for (let ix = 0; ix < size; ix++) {
        const a = pupil.amplitude((ix - half) * step, py);
        out[iy * size + ix] = a;
        power[iy * size + ix] = a * a;
      }
    }
    return { amplitude: out, power };
  }

  // Corner lattice: whether each cell corner transmits at all.
  const stride = size + 1;
  const inside = new Uint8Array(stride * stride);
  for (let iy = 0; iy <= size; iy++) {
    const py = (iy - half - 0.5) * step;
    for (let ix = 0; ix <= size; ix++) {
      inside[iy * stride + ix] = pupil.amplitude((ix - half - 0.5) * step, py) > 0 ? 1 : 0;
    }
  }

  const straddles = new Uint8Array(size * size);
  for (let iy = 0; iy < size; iy++) {
    for (let ix = 0; ix < size; ix++) {
      const a = inside[iy * stride + ix]!;
      if (
        a !== inside[iy * stride + ix + 1]! ||
        a !== inside[(iy + 1) * stride + ix]! ||
        a !== inside[(iy + 1) * stride + ix + 1]!
      ) {
        straddles[iy * size + ix] = 1;
      }
    }
  }
  // Dilate by one: a boundary can clip a cell without crossing a corner.
  const refine = new Uint8Array(size * size);
  for (let iy = 0; iy < size; iy++) {
    for (let ix = 0; ix < size; ix++) {
      if (straddles[iy * size + ix] === 0) continue;
      for (let dy = -1; dy <= 1; dy++) {
        const y = iy + dy;
        if (y < 0 || y >= size) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const x = ix + dx;
          if (x < 0 || x >= size) continue;
          refine[y * size + x] = 1;
        }
      }
    }
  }

  const sub = edgeSamples * edgeSamples;
  for (let iy = 0; iy < size; iy++) {
    const py = (iy - half) * step;
    for (let ix = 0; ix < size; ix++) {
      const px = (ix - half) * step;
      const idx = iy * size + ix;
      if (refine[idx] === 0) {
        // Interior or fully outside: the corner lattice already agrees, so the
        // centre value is the whole story and ⟨A²⟩ = ⟨A⟩².
        const a = inside[iy * stride + ix] === 1 ? pupil.amplitude(px, py) : 0;
        out[idx] = a;
        power[idx] = a * a;
        continue;
      }
      let acc = 0;
      let accSquared = 0;
      for (let sy = 0; sy < edgeSamples; sy++) {
        const qy = py + ((sy + 0.5) / edgeSamples - 0.5) * step;
        for (let sx = 0; sx < edgeSamples; sx++) {
          const a = pupil.amplitude(px + ((sx + 0.5) / edgeSamples - 0.5) * step, qy);
          acc += a;
          accSquared += a * a;
        }
      }
      out[idx] = acc / sub;
      power[idx] = accSquared / sub;
    }
  }
  return { amplitude: out, power };
}

/**
 * Transmitted pupil energy Σ A² on the FFT grid.
 *
 * Factored out because it is THE normalization both PSF branches must share.
 * The geometric branch has no pupil array of its own — it has rays — so it
 * scales its histogram to this number rather than inventing a second
 * definition of "how bright". One definition, computed one way, used twice.
 *
 * It reads the same edge-resolved grid the transform does, so the two branches
 * cannot end up disagreeing about how much of the aperture is open.
 */
export function transmittedEnergy(
  pupil: PupilFunction,
  pupilSamples: number,
  size: number,
  edgeSamples: number = DEFAULT_EDGE_SAMPLES,
): number {
  const { power } = pupilSampling(pupil, pupilSamples, size, edgeSamples);
  let energy = 0;
  for (let i = 0; i < power.length; i++) energy += power[i]!;
  return energy;
}

/**
 * Transform a pupil function into a PSF.
 *
 * The pupil is embedded in the centre of an `n`×`n` array with `pupilSamples`
 * across its diameter, so pupil sample spacing is Δ = D/pupilSamples and the
 * FFT's bin spacing maps to image-plane distance
 *
 *     Δx = λ·R / (n_image · n · Δ)
 *
 * — which is why the Airy first zero at 1.22·λR/D lands at 1.22·n/pupilSamples
 * pixels regardless of the system's actual scale. `padFactor` raises n without
 * touching Δ, so it refines the image sampling and leaves the physics alone.
 */
export function psfFromPupilFunction(
  pupil: PupilFunction,
  scale: PupilScale,
  fieldValue: number,
  options: PsfOptions = {},
): Psf {
  const pupilSamples = options.pupilSamples ?? 64;
  const padFactor = options.padFactor ?? 4;
  const n = pupilSamples * padFactor;
  if (!isPowerOfTwo(n)) {
    throw new Error(
      `pupilSamples × padFactor must be a power of two, got ${pupilSamples} × ${padFactor} = ${n}`,
    );
  }
  if (!Number.isFinite(scale.referenceRadius) || !Number.isFinite(scale.exitRadius)) {
    throw new Error("PSF needs a finite exit pupil: telecentric image space is not supported yet");
  }

  const re = new Float64Array(n * n);
  const im = new Float64Array(n * n);
  // Amplitude-only copy: the Strehl denominator has to come from the SAME
  // grid, aperture and energy, or the ratio measures the grid instead of the
  // aberration.
  const flatRe = new Float64Array(n * n);
  const flatIm = new Float64Array(n * n);

  const half = n / 2;
  const step = 2 / pupilSamples; // normalized pupil units per grid sample
  const phaseGrid = new Float64Array(n * n);
  const inside = new Uint8Array(n * n);
  // Amplitude comes from the edge-resolving sampler, so a circular aperture on
  // a square grid stops radiating spokes it does not have.
  const sampled = pupilSampling(pupil, pupilSamples, n, options.edgeSamples);
  const amplitude = sampled.amplitude;

  let energy = 0; // Σ⟨A²⟩ — the light that physically gets through
  let fieldPower = 0; // Σ⟨A⟩² — what Parseval will hand back
  for (let iy = 0; iy < n; iy++) {
    const py = (iy - half) * step;
    for (let ix = 0; ix < n; ix++) {
      const px = (ix - half) * step;
      const idx = iy * n + ix;
      energy += sampled.power[idx]!;
      const a = amplitude[idx]!;
      if (a <= 0) continue;
      const w = pupil.phaseWaves(px, py);
      const ang = 2 * Math.PI * w;
      re[idx] = a * Math.cos(ang);
      im[idx] = a * Math.sin(ang);
      flatRe[idx] = a;
      phaseGrid[idx] = w;
      inside[idx] = 1;
      fieldPower += a * a;
    }
  }
  if (energy === 0) throw new Error("pupil is empty: no transmitting samples on the FFT grid");

  // Largest wavefront step between neighbouring transmitting samples.
  let maxStep = 0;
  for (let iy = 0; iy < n; iy++) {
    for (let ix = 0; ix < n; ix++) {
      const idx = iy * n + ix;
      if (inside[idx] === 0) continue;
      if (ix + 1 < n && inside[idx + 1] === 1) {
        const d = Math.abs(phaseGrid[idx + 1]! - phaseGrid[idx]!);
        if (d > maxStep) maxStep = d;
      }
      if (iy + 1 < n && inside[idx + n] === 1) {
        const d = Math.abs(phaseGrid[idx + n]! - phaseGrid[idx]!);
        if (d > maxStep) maxStep = d;
      }
    }
  }

  fft2d(re, im, n);
  fft2d(flatRe, flatIm, n);

  // Parseval in this convention is Σ|X|² = n²·Σ|x|², so dividing by n² makes
  // the intensity integrate to Σ⟨A⟩². The second factor carries it the rest of
  // the way to Σ⟨A²⟩ — the light that actually got through the aperture, which
  // is what the PSF has to integrate to and what the geometric branch matches.
  // The two agree exactly wherever no cell straddles the edge, so this is the
  // identity for a point-sampled pupil and a boundary correction otherwise.
  const norm = energy / (fieldPower * n * n);
  const intensity = new Float64Array(n * n);
  const keepFlat = options.keepDiffractionLimited === true;
  const flatIntensity = keepFlat ? new Float64Array(n * n) : null;
  let peak = 0;
  let flatPeak = 0;
  for (let i = 0; i < n * n; i++) {
    const v = (re[i]! * re[i]! + im[i]! * im[i]!) * norm;
    intensity[i] = v;
    if (v > peak) peak = v;
    const f = (flatRe[i]! * flatRe[i]! + flatIm[i]! * flatIm[i]!) * norm;
    if (f > flatPeak) flatPeak = f;
    if (flatIntensity !== null) flatIntensity[i] = f;
  }
  fftShift2d(intensity, n);
  if (flatIntensity !== null) fftShift2d(flatIntensity, n);

  const lambdaMm = scale.wavelengthNm * 1e-6;
  const deltaPupil = (2 * scale.exitRadius) / pupilSamples;
  const pixelScaleMm =
    (lambdaMm * scale.referenceRadius) / (Math.abs(scale.nImage) * n * deltaPupil);

  return {
    size: n,
    pupilSamples,
    intensity,
    pixelScaleMm: Math.abs(pixelScaleMm),
    energy,
    peak,
    diffractionLimitedPeak: flatPeak,
    strehl: flatPeak > 0 ? peak / flatPeak : 0,
    ...(flatIntensity === null ? {} : { diffractionLimitedIntensity: flatIntensity }),
    maxGridPhaseStepWaves: maxStep,
    wavelengthNm: scale.wavelengthNm,
    fieldValue,
  };
}

export interface SystemPsfOptions extends PsfOptions {
  /** Pupil grid resolution for the TRACE (not the FFT). Default 21. */
  readonly traceSamples?: number;
  /** Zernike terms fitted to the traced OPD. Default 28 (radial order 6). */
  readonly zernikeTerms?: number;
  readonly aim?: AimOptions;
}

/** Trace, fit, transform — the whole pipeline for one field and wavelength. */
export function psf(
  system: OpticalSystem,
  fieldValue: number,
  wavelengthNm: number,
  options: SystemPsfOptions = {},
): Psf {
  const map = opdMap(
    system,
    fieldValue,
    wavelengthNm,
    pupilGrid(options.traceSamples ?? 21),
    options.aim ?? {},
  );
  const fit = fitZernike(map.samples, options.zernikeTerms ?? 28);
  const pupil = pupilFunctionFromOpd(map, fit, {
    ...(options.obstruction === undefined ? {} : { obstruction: options.obstruction }),
  });
  const transformed = psfFromPupilFunction(
    pupil,
    {
      referenceRadius: map.referenceRadius,
      exitRadius: map.pupil.exit.radius,
      wavelengthNm,
      nImage: map.pupil.exit.n,
    },
    fieldValue,
    options,
  );
  // Measured on the RAW traced samples, which is the only place the criterion
  // means anything — see wave/fidelity.
  return { ...transformed, sampling: opdSampling(map, fit) };
}

/**
 * Azimuthally-averaged radial profile, in pixels from the centre.
 *
 * Averaging over angle is what lets a rung ask "where is the first minimum?"
 * without picking a direction — and for a rotationally symmetric PSF it also
 * suppresses the sampling noise a single cut would show.
 */
export function radialProfile(p: Psf, bins: number): { radius: Float64Array; mean: Float64Array } {
  const n = p.size;
  const c = n / 2;
  const maxR = c;
  const sums = new Float64Array(bins);
  const counts = new Float64Array(bins);

  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const r = Math.hypot(x - c, y - c);
      if (r >= maxR) continue;
      const b = Math.min(bins - 1, Math.floor((r / maxR) * bins));
      sums[b] = sums[b]! + p.intensity[y * n + x]!;
      counts[b] = counts[b]! + 1;
    }
  }

  const radius = new Float64Array(bins);
  const mean = new Float64Array(bins);
  for (let b = 0; b < bins; b++) {
    radius[b] = ((b + 0.5) / bins) * maxR;
    mean[b] = counts[b]! > 0 ? sums[b]! / counts[b]! : 0;
  }
  return { radius, mean };
}

/** Encircled energy within `radiusPixels` of the PSF centre, as a fraction. */
export function encircledEnergy(p: Psf, radiusPixels: number): number {
  const n = p.size;
  const c = n / 2;
  const r2 = radiusPixels * radiusPixels;
  let acc = 0;
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      if ((x - c) ** 2 + (y - c) ** 2 <= r2) acc += p.intensity[y * n + x]!;
    }
  }
  return acc / p.energy;
}
