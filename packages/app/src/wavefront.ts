import { opdMap, pupilGrid } from "@telemicroscope/core/pupil";
import {
  balancedRms,
  fitRms,
  fitZernike,
  nollIndex,
  nollName,
  psf,
} from "@telemicroscope/core/wave";
import { buildSystem, type LensKind } from "./render";

/**
 * The Zernike readout — the traced wavefront broken into named aberrations, and
 * the three different numbers people mean by "RMS wavefront error".
 *
 * ROADMAP's v1 analyses line, second of the four entries that had no surface.
 * No DOM, no React. **No engine capability is added**: `opdMap` is step 2's
 * traced wavefront, `fitZernike`/`fitRms`/`balancedRms`/`nollName` are step 3's
 * basis, and `psf` is step 3's transform. So no validation-ladder rung, and this
 * file's tests pin the wiring plus the claims the panel makes that no rung
 * states.
 *
 * ## Four claims
 *
 * 1. **"RMS wavefront error" is not one number.** `fitRms` removes piston and
 *    keeps tilt, deliberately — off axis a tilt is a real chief-ray displacement
 *    and hiding it reports distortion as perfection. `balancedRms` removes
 *    piston, tilt AND defocus, which is the currency a misaligned system has to
 *    be compared in. The two are the same on axis and part company off it, and a
 *    page that printed one of them as "the" wavefront error would be picking a
 *    convention silently. There is a third, and it is the one that matters most
 *    — see claim 2.
 * 2. **Only ONE of those conventions predicts the Strehl, and picking another
 *    misses by 6×.** Strehl ≈ exp(−(2πσ)²) is an approximation; `psf().strehl`
 *    is peak over diffraction-limited peak on the actual FFT. This is the
 *    panel's one genuine two-method comparison — different physics reached by
 *    different code, unlike the spot page's parabola — and running it against
 *    all three σ settles which convention means what:
 *
 *    - σ over **j ≥ 4** (piston and tilt out, **defocus kept**) is the one that
 *      works. Achromat f/10 on axis: 0.9962 predicted against 0.9962 traced.
 *    - σ over j ≥ 2 (`fitRms`, tilt kept) is wrong off axis and badly — at f/5
 *      and 0.8° it predicts **0.0003** where the transform says **0.4002**,
 *      because a tilt SHIFTS a PSF and does not dim it.
 *    - σ over j ≥ 5 (`balancedRms`, defocus removed) is wrong wherever defocus
 *      is genuinely present — singlet at f/10 on axis it predicts **0.9633**
 *      against a traced **0.1523**, a factor of 6.3, because it is answering
 *      "how good could this be if you refocused" and the PSF is at the plane
 *      the image actually has.
 *
 *    Neither engine helper computes the middle one; it is `Math.hypot` over the
 *    coefficients from j = 4, which is composition and not new physics.
 * 3. **And where even the right convention fails is the classical Maréchal
 *    limit, measured rather than recited.** Four digits below σ ≈ 0.05, 32% out
 *    at σ = 0.20, and at σ = 0.93 it returns **0.0000** where the transform
 *    still finds **0.0886** — an approximation predicting a dead image for a
 *    lens that has a ninth of its light in the core.
 * 4. **What the basis could not represent.** `fitResidualWaves` is the part of
 *    the traced wavefront 28 Zernike terms cannot express. `wave/fidelity` states
 *    why it is normally tiny — spherical aberration is exactly a low-order
 *    rotationally-symmetric term — and a residual that grows is the signal that
 *    the fitted wavefront the PSF is built from has stopped being the wavefront
 *    that was traced.
 *
 * ## The fit leaks, and it is worth naming rather than hiding
 *
 * On axis an axially symmetric lens can excite only the rotationally symmetric
 * terms (j = 1, 4, 11, 22). Everything else comes back at **~1e-7 waves** rather
 * than at the f64 floor — tilt, astigmatism, coma, trefoil and several mid-order
 * terms together. Two measurements say it is the least-squares fit over a
 * discrete pupil and not a lens with an asymmetry in it: the **x and y partners
 * are equal in magnitude** (a real asymmetry has a direction; a square grid
 * clipped to a circle has four-fold symmetry), and it grows as roughly the CUBE
 * of the wavefront — 4.5e-12, 7.1e-9, 2.2e-6 as the achromat's peak-to-valley
 * goes 0.0060, 0.0334, 0.1619 — where a rounding floor would track it linearly.
 *
 * Nothing on screen depends on it: the leak stays six orders under the terms
 * that are really there (1e-7 against a 0.50-wave spherical). It is pinned so
 * that a future change which makes it grow is a failing test rather than a
 * plausible-looking astigmatism appearing on a symmetric lens.
 */

/** Wavelengths a wavefront is conventionally quoted at, matching `rayfan.ts`. */
export const WAVEFRONT_LINES: readonly { readonly nm: number; readonly name: string }[] = [
  { nm: 486.1327, name: "F (blue)" },
  { nm: 587.5618, name: "d (yellow)" },
  { nm: 656.2725, name: "C (red)" },
];

export interface WavefrontSpec {
  readonly lens: LensKind;
  readonly focalLengthMm: number;
  readonly apertureMm: number;
  readonly sourceTemperatureK: number;
  /** Spectral sample count of the system — see `buildSystem`; geometry-neutral. */
  readonly wavelengths: number;
  readonly fieldDeg: number;
  readonly wavelengthNm: number;
  /** Pupil samples across the diameter for the trace the fit runs on. */
  readonly traceSamples: number;
  /** Noll terms fitted. */
  readonly zernikeTerms: number;
}

export interface WavefrontTerm {
  /** Noll index. */
  readonly j: number;
  /** The engine's own name for it — this file does not keep a second table. */
  readonly name: string;
  readonly n: number;
  readonly m: number;
  /** Coefficient in waves. The basis is orthonormal, so this IS an RMS share. */
  readonly waves: number;
}

export interface WavefrontResult {
  readonly terms: readonly WavefrontTerm[];
  /** Piston removed, tilt KEPT — `fitRms`'s convention and its reasons. */
  readonly rmsWaves: number;
  /**
   * Piston and tilt removed, **defocus kept** — the σ that predicts the Strehl
   * at the plane the image is actually on. See claim 2: the other two do not,
   * and neither engine helper computes this one.
   */
  readonly strehlRmsWaves: number;
  /** Piston, tilt and defocus removed — the balanced wavefront. */
  readonly balancedWaves: number;
  /** Peak-to-valley of the RAW traced samples, not of the fit. */
  readonly ptvWaves: number;
  /** RMS the 28 terms could not represent (waves). */
  readonly residualWaves: number;
  /** exp(−(2πσ)²) on `strehlRmsWaves` — the approximation, correctly fed. */
  readonly marechalStrehl: number;
  /** The same formula on the other two σ, so the panel can show them failing. */
  readonly marechalFromRms: number;
  readonly marechalFromBalanced: number;
  /** peak / diffraction-limited peak on the actual transform — the measurement. */
  readonly tracedStrehl: number;
  /** Rays the trace lost in the pupil. This IS vignetting. */
  readonly lost: number;
  readonly samplesUsed: number;
  readonly elapsedMs: number;
}

/** Terms below this are not drawn: at 28 terms most of them are numerical dust. */
export const TERM_FLOOR_WAVES = 1e-6;

export function wavefront(spec: WavefrontSpec): WavefrontResult {
  const started = performance.now();

  // The SAME system the star image is made from, for `rayfan.ts`'s reason.
  const system = buildSystem({
    lens: spec.lens,
    focalLengthMm: spec.focalLengthMm,
    apertureMm: spec.apertureMm,
    sourceTemperatureK: spec.sourceTemperatureK,
    wavelengths: spec.wavelengths,
    pupilSamples: 64,
    whiteFraction: 1,
    seeingDOverR0: 0,
  });

  const map = opdMap(
    system,
    spec.fieldDeg,
    spec.wavelengthNm,
    pupilGrid(spec.traceSamples),
    {},
  );
  const fit = fitZernike(map.samples, spec.zernikeTerms);

  const terms: WavefrontTerm[] = [];
  for (let j = 1; j <= fit.terms; j++) {
    const { n, m } = nollIndex(j);
    terms.push({ j, name: nollName(j), n, m, waves: fit.coefficients[j - 1]! });
  }

  // Peak-to-valley off the RAW samples rather than the fit: P-V is the classic
  // quoted number and it is a statement about the wavefront that was traced, not
  // about the band-limited thing fitted to it. `wave/fidelity` makes the same
  // choice for the same reason.
  let lo = Infinity;
  let hi = -Infinity;
  for (const s of map.samples) {
    if (s.waves < lo) lo = s.waves;
    if (s.waves > hi) hi = s.waves;
  }

  const balancedWaves = balancedRms(fit);
  // Piston and tilt out, defocus in. Not `fitRms` and not `balancedRms`: see
  // claim 2 — this is the only one of the three that tracks the transform.
  let acc = 0;
  for (let j = 4; j <= fit.terms; j++) acc += fit.coefficients[j - 1]! ** 2;
  const strehlRmsWaves = Math.sqrt(acc);
  const marechal = (sigma: number) => Math.exp(-((2 * Math.PI * sigma) ** 2));
  // The transform's own answer, on the same field and wavelength. `psf` re-traces
  // rather than being handed this map — one definition of a system's pupil lives
  // in `systemPupil`, and reaching around it to save a trace would let this page
  // and the renderer disagree about what they are looking at.
  const transformed = psf(system, spec.fieldDeg, spec.wavelengthNm, {
    pupilSamples: 64,
    padFactor: 4,
    traceSamples: spec.traceSamples,
    zernikeTerms: spec.zernikeTerms,
  });

  const rmsWaves = fitRms(fit);
  return {
    terms,
    rmsWaves,
    strehlRmsWaves,
    balancedWaves,
    ptvWaves: map.samples.length > 0 ? hi - lo : 0,
    residualWaves: fit.rmsResidualWaves,
    marechalStrehl: marechal(strehlRmsWaves),
    marechalFromRms: marechal(rmsWaves),
    marechalFromBalanced: marechal(balancedWaves),
    tracedStrehl: transformed.strehl,
    lost: map.lost,
    samplesUsed: fit.samplesUsed,
    elapsedMs: performance.now() - started,
  };
}
