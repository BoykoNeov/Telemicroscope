import { fft2d, isPowerOfTwo } from "../math/fft";
import { mulberry32, Rng } from "../math/random";
import { PupilFunction } from "./psf";

/**
 * Atmospheric seeing — the one part of the image that is a random draw.
 *
 * A telescope on the ground looks through kilometres of turbulent air, and the
 * turbulence stamps a random optical-path error across the pupil. That error is
 * not a lens defect and does not belong to the instrument; it is a sample from a
 * known statistical law, and it arrives exactly the way ARCHITECTURE promised —
 * **as a `PupilFunction` phase**, added onto whatever the optics already did,
 * with the transform in `wave/psf` never changing. `withPhaseScreen` is that
 * addition; everything else here builds the screen it adds.
 *
 * ## The physics, and the one closed form the whole file is pinned to
 *
 * Kolmogorov turbulence has a phase power spectrum Φ(κ) = 0.023·r₀^(−5/3)·κ^(−11/3),
 * and the single number that characterises "how bad the seeing is" is the Fried
 * parameter **r₀** — the pupil diameter over which the RMS wavefront error is
 * about one radian. Everything observable follows from r₀ through one relation,
 * the phase **structure function**
 *
 *     D_φ(r) = ⟨|φ(x+r) − φ(x)|²⟩ = 6.88·(r/r₀)^(5/3)   [rad²]
 *
 * which is what `phaseStructureFunction` measures and the first rung pins. From
 * it come the long-exposure results the downstream rungs check: the seeing-
 * limited FWHM ≈ 0.98·λ/r₀ and the atmospheric OTF exp(−3.44·(λf/r₀)^(5/3)),
 * both *ensemble averages* — one screen is a speckle pattern, and only the mean
 * over many screens is the smooth seeing disc. Nothing here imposes that disc;
 * it emerges from averaging the transform of many random pupils, which is the
 * difference between simulating seeing and drawing it.
 *
 * ## r₀, wavelength, and why the screen is stored in length, not waves
 *
 * The atmosphere delays light by a physical optical path, the same path for
 * every colour — so the screen is generated and stored as **OPD in mm**, and a
 * caller converts to waves per wavelength (phase = 2π·OPD/λ). That is what makes
 * the polychromatic stack honest for free: a bluer wavelength sees more waves of
 * the same bump, which is exactly the r₀ ∝ λ^(6/5) scaling of seeing, recovered
 * without a special case. Generating in waves would nail the screen to one
 * colour.
 *
 * ## Generation: an FFT screen, with subharmonics for the large scales
 *
 * The screen is white Gaussian noise coloured by √Φ in the Fourier plane and
 * transformed back (McGlamery / Schmidt). That method has one well-known flaw:
 * the lowest frequency an N×N grid holds is 1/L, so turbulent scales larger than
 * the screen are missing, and the structure function then *undershoots* at large
 * separations — the tip/tilt-ish part of seeing is under-represented. The
 * standard fix (Lane, Johansson) is a handful of **subharmonic** modes added
 * below the grid's fundamental; `subharmonics` levels of them are what let
 * D_φ(r) hold out to the pupil edge rather than sagging. It is the seeing
 * counterpart of the edge-resolving trick in `pupilSampling`: a known
 * discretisation error, corrected where it bites and documented where it does
 * not.
 *
 * ## What is deferred, and why it is honest to defer it
 *
 * The screen is **pure phase**, so it lives only in the FFT PSF branch — the
 * geometric ray-histogram branch has no phase and so shows no seeing (the
 * analogous move, deflecting each ray by ∇φ, is a separate capability, the way
 * the spider's spike is an FFT-branch phenomenon and its shadow a geometric
 * one; see docs/VALIDATION § 5d). This matters only when the *system's own*
 * aberration is bad enough to trip the fidelity fallback; a well-corrected
 * telescope on axis, which is where seeing is actually watched, stays on the
 * FFT branch and images correctly. What must not slip through is a screen the
 * FFT grid cannot resolve — the fidelity criterion is measured on the raw traced
 * samples and is blind to the screen — so a caller checks `maxGridPhaseStepWaves`
 * on the final pupil instead.
 */
export interface SeeingSpec {
  /** Fried parameter r₀ at `refWavelengthNm`, in mm (an entrance-pupil length). */
  readonly friedParamMm: number;
  /** Aperture (entrance-pupil) diameter in mm — with r₀ it sets D/r₀. */
  readonly apertureDiameterMm: number;
  /** Wavelength r₀ is quoted at, nm. Default 500. r₀ ∝ λ^(6/5) away from it. */
  readonly refWavelengthNm?: number;
  /** Screen grid samples per axis (power of two). Default 256. */
  readonly screenSamples?: number;
  /** Screen physical size as a multiple of the aperture diameter. Default 2. */
  readonly oversize?: number;
  /** Subharmonic levels added below the grid fundamental. Default 3; 0 disables. */
  readonly subharmonics?: number;
  /** RNG seed — the same seed gives the same screen. Default 1. */
  readonly seed?: number;
}

/**
 * A generated turbulent wavefront over a square patch that contains the pupil.
 *
 * The optical path is stored, not the phase: `opdMm` is wavelength-free, and
 * `screenPhaseWaves` divides by λ to get the waves a given colour sees. The
 * pupil of diameter `apertureDiameterMm` sits centred in a patch of side
 * `physicalSizeMm`, so a normalized pupil point maps to the screen by
 * `screenPhaseWaves`.
 */
export interface PhaseScreen {
  /** Screen grid samples per axis. */
  readonly samples: number;
  /** Physical side length of the square screen, mm. */
  readonly physicalSizeMm: number;
  /** Aperture diameter the pupil coords are normalized to, mm. */
  readonly apertureDiameterMm: number;
  /** Optical-path error, row-major `samples`×`samples`, mm. Colour-independent. */
  readonly opdMm: Float64Array;
  /** Fried parameter r₀ at `refWavelengthNm`, mm. */
  readonly friedParamMm: number;
  readonly refWavelengthNm: number;
}

/** Kolmogorov phase power spectrum coefficient: Φ(f) = c·f^(−11/3), c below. */
function psdCoeff(r0: number): number {
  return 0.023 * Math.pow(r0, -5 / 3);
}

/**
 * Generate a Kolmogorov OPD screen for a pupil of `apertureDiameterMm`.
 *
 * The screen is scale-free in its statistics — only D/r₀ matters — so it is
 * built in units of the aperture diameter (D = 1) and then given physical size,
 * which keeps the FFT normalization independent of the caller's millimetres.
 */
export function kolmogorovScreen(spec: SeeingSpec): PhaseScreen {
  const N = spec.screenSamples ?? 256;
  if (!isPowerOfTwo(N)) throw new Error(`screenSamples must be a power of two, got ${N}`);
  const oversize = spec.oversize ?? 2;
  if (!(oversize >= 1)) throw new Error(`oversize must be ≥ 1, got ${oversize}`);
  if (!(spec.friedParamMm > 0)) throw new Error(`friedParamMm must be > 0, got ${spec.friedParamMm}`);
  if (!(spec.apertureDiameterMm > 0)) {
    throw new Error(`apertureDiameterMm must be > 0, got ${spec.apertureDiameterMm}`);
  }
  const refWavelengthNm = spec.refWavelengthNm ?? 500;
  const subharmonics = spec.subharmonics ?? 3;
  const rng = mulberry32(spec.seed ?? 1);

  // Work in aperture-diameter units: D = 1, screen side L = oversize.
  const r0 = spec.friedParamMm / spec.apertureDiameterMm; // r₀ in D units
  const L = oversize;
  const df = 1 / L; // cyclic frequency spacing, 1/D
  const c = psdCoeff(r0);

  // High-frequency part: colour white noise by √Φ and inverse-transform.
  const re = new Float64Array(N * N);
  const im = new Float64Array(N * N);
  for (let ky = 0; ky < N; ky++) {
    const fy = (ky < N / 2 ? ky : ky - N) * df;
    for (let kx = 0; kx < N; kx++) {
      const fx = (kx < N / 2 ? kx : kx - N) * df;
      const f = Math.hypot(fx, fy);
      // DC (f = 0) → 0: piston has no meaning, and Φ diverges there anyway.
      const amp = f === 0 ? 0 : Math.sqrt(c * Math.pow(f, -11 / 3)) * df;
      const idx = ky * N + kx;
      re[idx] = rng.nextGaussian() * amp;
      im[idx] = rng.nextGaussian() * amp;
    }
  }
  // My inverse FFT carries a 1/N²; the screen recipe is a plain inverse-DFT
  // sum, so undo it. Result is phase in radians at the reference wavelength.
  fft2d(re, im, N, true);
  const phaseRad = new Float64Array(N * N);
  for (let i = 0; i < N * N; i++) phaseRad[i] = re[i]! * (N * N);

  if (subharmonics > 0) {
    addSubharmonics(phaseRad, N, L, c, subharmonics, rng);
  }

  // Radians at ref λ → optical path in mm: OPD = φ·λ_ref/(2π).
  const lambdaRefMm = refWavelengthNm * 1e-6;
  const opdMm = new Float64Array(N * N);
  const k = lambdaRefMm / (2 * Math.PI);
  for (let i = 0; i < N * N; i++) opdMm[i] = phaseRad[i]! * k;

  return {
    samples: N,
    physicalSizeMm: L * spec.apertureDiameterMm,
    apertureDiameterMm: spec.apertureDiameterMm,
    opdMm,
    friedParamMm: spec.friedParamMm,
    refWavelengthNm,
  };
}

/**
 * Add subharmonic modes below the FFT grid's fundamental (Lane/Johansson).
 *
 * The FFT screen misses every scale larger than the screen itself. Each level
 * `p` refines the frequency spacing to 1/(3^p·L) and lays down a 3×3 patch of
 * plane waves around DC (the centre excluded — that is the piston the FFT part
 * already dropped), evaluated directly in space because there are only a handful.
 * Three levels are enough to hold the structure function out to the pupil edge.
 */
function addSubharmonics(
  phaseRad: Float64Array,
  N: number,
  L: number,
  c: number,
  levels: number,
  rng: Rng,
): void {
  const delta = L / N; // spatial spacing, D units
  const lo = new Float64Array(N * N);
  for (let p = 1; p <= levels; p++) {
    const df = 1 / (Math.pow(3, p) * L);
    for (let sy = -1; sy <= 1; sy++) {
      const fy = sy * df;
      for (let sx = -1; sx <= 1; sx++) {
        if (sx === 0 && sy === 0) continue; // piston
        const fx = sx * df;
        const f = Math.hypot(fx, fy);
        const amp = Math.sqrt(c * Math.pow(f, -11 / 3)) * df;
        const cr = rng.nextGaussian() * amp;
        const ci = rng.nextGaussian() * amp;
        // Re{ (cr + i·ci)·exp(i·2π·f·x) } = cr·cos − ci·sin, summed over the grid.
        const w = 2 * Math.PI;
        for (let iy = 0; iy < N; iy++) {
          const y = (iy - N / 2) * delta;
          for (let ix = 0; ix < N; ix++) {
            const x = (ix - N / 2) * delta;
            const ph = w * (fx * x + fy * y);
            lo[iy * N + ix] = lo[iy * N + ix]! + cr * Math.cos(ph) - ci * Math.sin(ph);
          }
        }
      }
    }
  }
  // Remove the mean the low-frequency modes introduce — it is piston.
  let mean = 0;
  for (let i = 0; i < N * N; i++) mean += lo[i]!;
  mean /= N * N;
  for (let i = 0; i < N * N; i++) phaseRad[i] = phaseRad[i]! + lo[i]! - mean;
}

/**
 * Sample the screen's phase, in waves, at a normalized pupil point.
 *
 * The pupil radius maps to `apertureDiameterMm/2`; the screen is centred, so
 * pupil (0,0) is the screen centre. Bilinear interpolation between the four
 * surrounding grid nodes — the screen is smooth on the scale of a cell, so
 * linear is faithful and avoids the ringing a higher-order interpolant would
 * add to a random field.
 */
export function screenPhaseWaves(
  screen: PhaseScreen,
  wavelengthNm: number,
): (px: number, py: number) => number {
  const N = screen.samples;
  const lambdaMm = wavelengthNm * 1e-6;
  // Normalized pupil (radius 1) spans ± (apertureDiameter/2) mm, i.e. a fraction
  // (D/2)/L of the screen half-width; in grid cells that is a half-span of
  // (N/2)·(D/L). With L = oversize·D this is N/(2·oversize).
  const halfSpanCells = ((screen.apertureDiameterMm / 2) / screen.physicalSizeMm) * N;
  const opd = screen.opdMm;
  return (px, py) => {
    // Grid coordinates: centre at N/2, pupil edge at N/2 ± halfSpanCells.
    const gx = N / 2 + px * halfSpanCells;
    const gy = N / 2 + py * halfSpanCells;
    let x0 = Math.floor(gx);
    let y0 = Math.floor(gy);
    // Clamp so the +1 neighbour is always in range; the pupil is well inside the
    // screen for oversize > 1, so this only guards the exact edge.
    if (x0 < 0) x0 = 0;
    if (y0 < 0) y0 = 0;
    if (x0 > N - 2) x0 = N - 2;
    if (y0 > N - 2) y0 = N - 2;
    const tx = gx - x0;
    const ty = gy - y0;
    const i00 = y0 * N + x0;
    const v00 = opd[i00]!;
    const v10 = opd[i00 + 1]!;
    const v01 = opd[i00 + N]!;
    const v11 = opd[i00 + N + 1]!;
    const top = v00 + (v10 - v00) * tx;
    const bot = v01 + (v11 - v01) * tx;
    const opdMm = top + (bot - top) * ty;
    return opdMm / lambdaMm;
  };
}

/**
 * Add a phase screen onto an existing pupil — the whole point of the file.
 *
 * Amplitude is untouched (turbulence dims nothing, it only delays), so the
 * aperture, obstruction and any spider carry through unchanged; the screen's
 * waves add to the system's own wavefront error. This is the `PupilFunction`
 * composition the spider proved and ARCHITECTURE named: a new optical effect
 * arrives as a wrapper, and `psfFromPupilFunction` never learns its name.
 */
export function withPhaseScreen(
  base: PupilFunction,
  screen: PhaseScreen,
  wavelengthNm: number,
): PupilFunction {
  const screenWaves = screenPhaseWaves(screen, wavelengthNm);
  return {
    amplitude: base.amplitude,
    phaseWaves: (px, py) => base.phaseWaves(px, py) + screenWaves(px, py),
  };
}

/**
 * Measure the phase structure function D_φ(r) on a screen, in rad² at the
 * reference wavelength — the direct check on the generator, before any FFT.
 *
 * For each separation (in aperture-diameter units) it averages [φ(x+r) − φ(x)]²
 * over the grid and over the x̂ and ŷ directions, sampling only pairs that stay
 * inside the central pupil-sized region so the screen's periodic wrap never
 * enters. The closed form it is pinned to is 6.88·(r/r₀)^(5/3).
 */
export function phaseStructureFunction(
  screen: PhaseScreen,
  separationsInDiameters: readonly number[],
): Float64Array {
  const N = screen.samples;
  const opd = screen.opdMm;
  // rad at ref λ = 2π·OPD/λ_ref.
  const toRad = (2 * Math.PI) / (screen.refWavelengthNm * 1e-6);
  const cellsPerDiameter = (screen.apertureDiameterMm / screen.physicalSizeMm) * N;
  // Confine sampling to the central aperture-sized window.
  const halfWin = Math.floor((cellsPerDiameter / 2) * 0.9);
  const lo = N / 2 - halfWin;
  const hi = N / 2 + halfWin;
  const out = new Float64Array(separationsInDiameters.length);
  for (let s = 0; s < separationsInDiameters.length; s++) {
    const d = Math.round(separationsInDiameters[s]! * cellsPerDiameter);
    let acc = 0;
    let count = 0;
    for (let iy = lo; iy < hi; iy++) {
      for (let ix = lo; ix < hi; ix++) {
        // +x neighbour
        if (ix + d < hi) {
          const dphi = (opd[iy * N + ix + d]! - opd[iy * N + ix]!) * toRad;
          acc += dphi * dphi;
          count++;
        }
        // +y neighbour
        if (iy + d < hi) {
          const dphi = (opd[(iy + d) * N + ix]! - opd[iy * N + ix]!) * toRad;
          acc += dphi * dphi;
          count++;
        }
      }
    }
    out[s] = count > 0 ? acc / count : 0;
  }
  return out;
}
