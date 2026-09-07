import { fft2d, isPowerOfTwo } from "../math/fft";
import { imagePixelScaleMm, type PupilScale } from "../wave/psf";
import type { ObjectField } from "./abbe";
import { pupilNumericalAperture } from "./transfer";

/**
 * Brightfield's geometric branch: rays refracted by the specimen's own phase
 * gradient, which is transport-of-intensity (§ 6f.10).
 *
 * ## What this is, and what it deliberately is not
 *
 * § 6f.9 recorded that brightfield has ONE branch and cannot have two: every
 * term of the Abbe sum is a coherent field, a ray histogram has no phase, so a
 * geometric fallback would answer a different question rather than degrade
 * gracefully. That is still true and `brightfieldFidelity`'s cliff still
 * stands. This module is not that fallback.
 *
 * What it is, is the OTHER half of the same deferral, which § 6f.9's own note
 * separated out and *Later rungs* carried beside the seeing analog: a phase
 * object is invisible in focus and visible out of focus (§ 6f.5), and in the
 * geometric limit that visibility has a ray explanation owing nothing to
 * interference. A ray crossing a region where the optical path is tilted leaves
 * tilted; a defocused plane is a lever arm; so the rays pile up where the phase
 * is curved and thin out where it is curved the other way. That is exactly
 * Teague's transport-of-intensity equation,
 *
 *     ∂I/∂z = −(λ/2π)·∇·(I·∇φ)
 *
 * and it is what this module computes — not by discretizing that equation, but
 * by moving the rays and letting the divergence be what the moving does.
 *
 * ## The blocker the register named was not the blocker
 *
 * `OPEN-PROBLEMS.md` A6 said this "needs rays that start at a transmittance,
 * which `exitBundle` does not do". It does not need them. A ray leaving object
 * point x with the local deflection and landing on a plane a fixed lever away
 * is the map
 *
 *     x′ = x + δ·∇φ(x)
 *
 * and the image is that map's own push-forward of the object's intensity. There
 * is no bundle to trace, no aim to solve, and no Monte Carlo: the map is
 * analytic and the deposition below is deterministic. What `exitBundle` would
 * add is the objective's own aberration between the specimen and the plane,
 * which is a *different* rung, is not what makes a phase object visible, and is
 * still open (OPEN-PROBLEMS A6, closed as physics with that half named).
 *
 * ## Two spellings of the same map, and why both are here
 *
 * `transportImage` PUSHES: each object sample carries its flux to x′ and is
 * split between the cells it lands between. That is conservative to the bit
 * (the split weights sum to 1), it survives rays crossing, and it is the answer
 * a histogram converges to without a histogram's noise.
 *
 * `transportJacobian` DIFFERENTIATES: the same map's Jacobian
 * J = I + δ·H(φ), whose determinant gives the density I/|det J| directly. It is
 * where the Laplacian in the equation above comes FROM — expand 1/|det J| in δ
 * and the leading term is 1 − δ∇²φ, which is TIE with a uniform beam — so
 * having it computed is what makes the derivation checkable instead of quoted.
 * It also diverges exactly where the push does not: det J ≤ 0 is a caustic, the
 * point past which ray optics stops having one answer per place, and it is
 * reported rather than smoothed.
 *
 * ## Units: this module lives in `abbeImage`'s currency, not in millimetres
 *
 * The external form of the pin is written in metres and cycles per metre —
 * contrast ∝ sin(π·λ·z·f²). Everything here is in the grid units § 6f works in:
 * ν in units of NA/λ (ν = 1 is the coherent cutoff), defocus as w₂₀ waves at
 * the pupil rim, position in object pixels. `defocusDeflectionPixels` is the
 * whole bridge between them and is pinned on its own, because a factor of two
 * or an NA² lost here would surface as a contrast ratio of 2 and be hunted for
 * in the ray launch, where it would not be.
 */

/** Object samples per pupil-diameter bin count — `size / pupilSamples`. */
function padFactorOf(size: number, pupilSamples: number): number {
  if (!isPowerOfTwo(size)) throw new Error(`object grid size must be a power of two, got ${size}`);
  if (!(pupilSamples > 0)) throw new Error(`pupilSamples must be positive, got ${pupilSamples}`);
  return size / pupilSamples;
}

/**
 * Object pixels a ray moves per radian-per-pixel of phase gradient, signed.
 *
 *     δ = −4·w₂₀·padFactor² / π
 *
 * ## Where it comes from
 *
 * A ray leaving a thin phase screen is deflected by the gradient of the extra
 * optical path it crossed, θ = (λ/2π)·∂φ/∂x — `wave/geometric`'s
 * `rayDeflectionScaleMm` one surface further out, and the same prism anchor
 * fixes the same sign there. Over a propagation z that is a displacement
 * (λz/2π)·∂φ/∂x, so in pixels of side Δx the whole thing collapses to the
 * single number δ = λz/(2π·Δx²).
 *
 * Both of those are then engine quantities rather than free ones. § 6f.8's own
 * frequency bridge fixes the pixel: bin k is ν = 2k/pupilSamples and also
 * f = ν·NA/λ, which forces Δx = λ/(2·NA·padFactor). And the defocus this branch
 * is asked for is the same w₂₀ `defocusedPupil` takes, which is a pupil phase
 * 2π·w₂₀·ν² — a free-space propagation z = 2·λ·w₂₀/NA² wearing the pupil's
 * clothes. Substituting both leaves λ and NA nowhere:
 *
 *     δ = λz/(2π·Δx²) = λ·(2λw₂₀/NA²)·(4NA²·padFactor²)/(2π·λ²)
 *       = 4·w₂₀·padFactor²/π      (in magnitude)
 *
 * ## The sign is measured, not argued
 *
 * There are two independent signs here and only one of them has an anchor. The
 * DEFLECTION's sign is the prism: a wedge thicker at +x delays the light there
 * and deviates the beam toward its base, so a positive gradient of extra
 * optical path moves the ray to +x, exactly as `rayDeflectionScaleMm` records.
 * The DEFOCUS's sign is a separate question — whether `defocusedPupil(+w₂₀)` is
 * the plane before the focus or after it — and nothing in this file's
 * conventions answers it.
 *
 * So it was read off the engine's own wave branch instead of derived. An
 * `abbeImage` of a phase grating through `defocusedPupil(+0.05)` under a single
 * on-axis source point comes back **darker where φ is largest**
 * (I = 0.999215 against 1.000786 at the trough, on a φ = 0.02 grating at
 * ν = 0.25), matching 1 − 2φ·sin(2π·w₂₀·ν²) to six figures. A φ peaked in the
 * middle is a converging lens — extra optical path is greatest at the centre —
 * so light gathers at that peak DOWNSTREAM of it, and a plane that reads dark
 * there is on the other side. Positive w₂₀ is therefore a negative propagation,
 * which is the minus above. § 6f.10 pins it as a signed image rather than as a
 * transfer magnitude, because a magnitude cannot see it.
 */
export function defocusDeflectionPixels(
  defocusWaves: number,
  size: number,
  pupilSamples: number,
): number {
  const p = padFactorOf(size, pupilSamples);
  return (-4 * defocusWaves * p * p) / Math.PI;
}

/**
 * The free-space propagation `defocusedPupil(w₂₀)` stands for: z = 2·λ·w₂₀/NA²,
 * in millimetres, signed the way a distance past the object is.
 *
 * Exported because the paragraph above asserts it and an assertion no function
 * computes is worth nothing — § 6f.8 made exactly this argument about ν → f and
 * answered it the same way. The minus is the measurement recorded in
 * `defocusDeflectionPixels`: positive w₂₀ is the plane short of the focus.
 *
 * The NA comes from `pupilNumericalAperture` rather than from an exit-radius
 * ratio spelled again here, for the reason `imagePixelScaleMm` gives one floor
 * up: two spellings of one ruler is how the telecentric branch got written
 * twice, and this one would have had the same infinite-pupil hole.
 */
export function defocusPropagationMm(defocusWaves: number, scale: PupilScale): number {
  const lambdaMm = scale.wavelengthNm * 1e-6;
  const na = pupilNumericalAperture(scale);
  return (-2 * lambdaMm * defocusWaves) / (na * na);
}

/**
 * The specimen's own intensity and phase gradient — what the ray map reads.
 *
 * ## The phase is never unwrapped, because it is never formed
 *
 * φ = arg(t) wraps, and a wrapped array differentiates into spikes. Nothing
 * here forms it. With u = ln t the derivatives of the phase are
 *
 *     ∂φ = Im(∂t / t)        ∂²φ = Im(∂²t/t − (∂t/t)²)
 *
 * so a complex field's own derivatives are all that is needed and the branch cut
 * never enters. The field's derivatives are taken **spectrally** — the grid is
 * periodic and `abbeImage` already reads it as an angular spectrum, so a
 * band-limited object is differentiated exactly rather than to a stencil's
 * order. The Nyquist bin is zeroed on the way, as it must be: its derivative is
 * the one the sampling cannot sign.
 *
 * ## Where |t| is small, this is honest about not knowing
 *
 * arg(t) is undefined at t = 0 and ill-conditioned near it, so `minModulus` is
 * reported and a caller can decide. It is not thrown on: an absorbing specimen
 * with a genuinely black region is a legitimate object, and the rays that leave
 * a black region carry no flux, so a wrong direction there moves nothing. What
 * a small-but-nonzero modulus does is amplify the gradient, which is why the
 * number is on the readout rather than in a comment.
 */
export interface PhaseGradient {
  readonly size: number;
  /** |t|² — the flux each ray carries. */
  readonly intensity: Float64Array;
  /** ∂φ/∂x and ∂φ/∂y, radians per object pixel. */
  readonly dx: Float64Array;
  readonly dy: Float64Array;
  /** Smallest |t| on the grid — see the note above. */
  readonly minModulus: number;
}

/** The gradient, plus the Hessian the map's Jacobian needs. */
export interface PhaseDerivatives extends PhaseGradient {
  /** The Hessian of φ, radians per pixel². */
  readonly dxx: Float64Array;
  readonly dyy: Float64Array;
  readonly dxy: Float64Array;
}

/**
 * Spectral derivatives of a complex field: the two first ones always, the three
 * second ones only when asked.
 *
 * Split because `transportImage` needs the gradient and nothing else, and each
 * derivative is its own inverse transform — six of them where three will do is
 * a doubling of the cost of the branch's main entry point, at the grid sizes
 * supersampling reaches (a 1024² ray grid is seconds, not milliseconds).
 */
function spectralDerivatives(
  object: ObjectField,
  hessian: boolean,
): {
  readonly dxRe: Float64Array;
  readonly dxIm: Float64Array;
  readonly dyRe: Float64Array;
  readonly dyIm: Float64Array;
  readonly dxxRe?: Float64Array;
  readonly dxxIm?: Float64Array;
  readonly dyyRe?: Float64Array;
  readonly dyyIm?: Float64Array;
  readonly dxyRe?: Float64Array;
  readonly dxyIm?: Float64Array;
} {
  const n = object.size;
  const specRe = Float64Array.from(object.re);
  const specIm = Float64Array.from(object.im);
  fft2d(specRe, specIm, n);

  // Signed frequency index per bin, with Nyquist zeroed: the inverse transform
  // synthesizes exp(+2πi·k·x/n), so ∂/∂x multiplies bin k by (2πi·k/n), and bin
  // n/2 is its own alias — the sampling cannot tell +n/2 from −n/2, so its
  // derivative has no sign and is dropped rather than guessed.
  const w = new Float64Array(n);
  for (let k = 0; k < n; k++) {
    const signed = k === n / 2 ? 0 : k < n / 2 ? k : k - n;
    w[k] = (2 * Math.PI * signed) / n;
  }

  const make = (
    factorRe: (wx: number, wy: number) => number,
    factorIm: (wx: number, wy: number) => number,
  ): { re: Float64Array; im: Float64Array } => {
    const re = new Float64Array(n * n);
    const im = new Float64Array(n * n);
    for (let y = 0; y < n; y++) {
      const wy = w[y]!;
      for (let x = 0; x < n; x++) {
        const i = y * n + x;
        const wx = w[x]!;
        const fr = factorRe(wx, wy);
        const fi = factorIm(wx, wy);
        re[i] = specRe[i]! * fr - specIm[i]! * fi;
        im[i] = specRe[i]! * fi + specIm[i]! * fr;
      }
    }
    fft2d(re, im, n, true);
    return { re, im };
  };

  const zero = (): number => 0;
  // Multipliers: (i·wx), (i·wy), (i·wx)² = −wx², likewise −wy², and −wx·wy.
  const dx = make(zero, (wx) => wx);
  const dy = make(zero, (_wx, wy) => wy);
  if (!hessian) {
    return { dxRe: dx.re, dxIm: dx.im, dyRe: dy.re, dyIm: dy.im };
  }
  const dxx = make((wx) => -wx * wx, zero);
  const dyy = make((_wx, wy) => -wy * wy, zero);
  const dxy = make((wx, wy) => -wx * wy, zero);
  return {
    dxRe: dx.re,
    dxIm: dx.im,
    dyRe: dy.re,
    dyIm: dy.im,
    dxxRe: dxx.re,
    dxxIm: dxx.im,
    dyyRe: dyy.re,
    dyyIm: dyy.im,
    dxyRe: dxy.re,
    dxyIm: dxy.im,
  };
}

/** The specimen's intensity and phase gradient — what the ray map needs. */
export function phaseGradient(object: ObjectField): PhaseGradient {
  return derivatives(object, false);
}

/** The same, with the phase Hessian the Jacobian needs. */
export function phaseDerivatives(object: ObjectField): PhaseDerivatives {
  return derivatives(object, true) as PhaseDerivatives;
}

function derivatives(object: ObjectField, hessian: boolean): PhaseDerivatives {
  const n = object.size;
  if (object.re.length !== n * n || object.im.length !== n * n) {
    throw new Error(`object arrays must hold ${n * n} elements`);
  }
  const d = spectralDerivatives(object, hessian);
  const intensity = new Float64Array(n * n);
  const dx = new Float64Array(n * n);
  const dy = new Float64Array(n * n);
  const dxx = new Float64Array(hessian ? n * n : 0);
  const dyy = new Float64Array(hessian ? n * n : 0);
  const dxy = new Float64Array(hessian ? n * n : 0);
  let minModulus = Number.POSITIVE_INFINITY;

  for (let i = 0; i < n * n; i++) {
    const tr = object.re[i]!;
    const ti = object.im[i]!;
    const m2 = tr * tr + ti * ti;
    intensity[i] = m2;
    const m = Math.sqrt(m2);
    if (m < minModulus) minModulus = m;
    if (m2 === 0) continue;

    // q = ∂t/t = (∂t · conj t)/|t|², per axis. Im q is ∂φ.
    const qxRe = (d.dxRe[i]! * tr + d.dxIm[i]! * ti) / m2;
    const qxIm = (d.dxIm[i]! * tr - d.dxRe[i]! * ti) / m2;
    const qyRe = (d.dyRe[i]! * tr + d.dyIm[i]! * ti) / m2;
    const qyIm = (d.dyIm[i]! * tr - d.dyRe[i]! * ti) / m2;
    dx[i] = qxIm;
    dy[i] = qyIm;
    if (!hessian) continue;

    // ∂²φ = Im(∂²t/t) − Im(q_a·q_b), the second term being the product rule's
    // own correction — it is what keeps a pure phase RAMP's Hessian at zero
    // even though ∂²t of exp(iax) is not.
    const rxxIm = (d.dxxIm![i]! * tr - d.dxxRe![i]! * ti) / m2;
    const ryyIm = (d.dyyIm![i]! * tr - d.dyyRe![i]! * ti) / m2;
    const rxyIm = (d.dxyIm![i]! * tr - d.dxyRe![i]! * ti) / m2;
    dxx[i] = rxxIm - 2 * qxRe * qxIm;
    dyy[i] = ryyIm - 2 * qyRe * qyIm;
    dxy[i] = rxyIm - (qxRe * qyIm + qyRe * qxIm);
  }

  return { size: n, intensity, dx, dy, dxx, dyy, dxy, minModulus };
}

export interface TransportOptions {
  /** Frequency bins across the pupil DIAMETER — the scale, as in `AbbeOptions`. */
  readonly pupilSamples: number;
  /**
   * Defocus in waves at the pupil rim, meaning exactly what `defocusedPupil`'s
   * argument means, so the two branches can be handed the same number.
   */
  readonly defocusWaves: number;
  /**
   * Rays per object pixel, per axis. A power of two, default 1 — one ray per
   * sample, which is the cheapest honest reading.
   *
   * A ray carries its whole cell's flux to one place, so at M = 1 the *stretch*
   * inside a cell is not represented, and the image comes back carrying the
   * deposition window TWICE rather than once — the specimen is sampled through
   * the same triangle it is deposited by. Raising M subdivides the specimen
   * (`subSamples`) and leaves the image grid alone, so the window stops being
   * squared and then stays put.
   *
   * This is the branch's convergence knob and § 6f.10 pins its RATE rather than
   * asserting a tolerance: past M = 1 the residual QUARTERS at every doubling —
   * measured 4.00084, 4.00021, 4.00005 — so it is a discretization and not a
   * physics error. Cost is the transforms of an (M·size)² grid.
   *
   * The interpolation is only as good as the object's own spectrum, which is
   * why `phaseGratingObject` (band-limited, and it reports what it cut) and
   * `pointwisePhaseGratingObject` (exact pointwise, not band-limited) are not
   * interchangeable here — § 6f.10 measures the difference rather than picking
   * one and hoping.
   */
  readonly raysPerPixel?: number;
  /** Supply to get a physical `pixelScaleMm` back; omit for grid units. */
  readonly scale?: PupilScale;
}

export interface TransportImage {
  readonly size: number;
  readonly pupilSamples: number;
  /** Intensity, in the object's own coordinates — the same layout `abbeImage` returns. */
  readonly intensity: Float64Array;
  /** The δ this image was formed with — `defocusDeflectionPixels`, echoed. */
  readonly deflectionPixels: number;
  /** Largest ray displacement on the grid, in object pixels. */
  readonly maxDisplacementPixels: number;
  /**
   * Largest |χ| = |2π·w₂₀·ν²| over the frequencies the OBJECT actually carries
   * — the branch's own validity guard, and the direct analog of
   * `AbbeImage.maxGridPhaseStepWaves`.
   *
   * This branch is the small-χ limit of the wave answer: contrast goes as χ
   * where the truth goes as sin χ, so the error is χ²/6 in relative terms and
   * the sign is wrong altogether past χ = π. Reported, never thrown on — a
   * caller may legitimately want the geometric answer at large χ precisely
   * because the coherent sum has stopped being computable there (§ 6f.9), and a
   * throw would take that away.
   */
  readonly maxDefocusPhaseRadians: number;
  /** Σ intensity. Bitwise the object's own sum — the deposition conserves. */
  readonly energy: number;
  /** Smallest |t| the phase gradient was read at — see `PhaseDerivatives`. */
  readonly minModulus: number;
  /** Rays per object pixel per axis this image was formed with. */
  readonly raysPerPixel: number;
  readonly pixelScaleMm?: number;
}

/**
 * Form the geometric image of `object` at `defocusWaves`, by moving its rays.
 *
 * ## Why the deposition is the physics rather than a rendering choice
 *
 * Each object sample is one ray carrying flux |t|², landing at x + δ·∇φ. It
 * lands between grid cells, and it is split between them by area — the bilinear
 * weights, which sum to 1 exactly, so **no flux is created or destroyed at any
 * displacement**. That is not a nicety: an energy error here would be
 * indistinguishable from the contrast the module exists to measure, which is
 * the same trap § 8c found in the spectral stack's resampler.
 *
 * And the split is not an approximation of the answer, it IS the answer to
 * first order: depositing I(x) at x + s(x) with those weights gives back
 * I − ∂ₓ(I·sₓ) − ∂_y(I·s_y) exactly, which with s = δ∇φ is
 * I − δ·∇·(I∇φ) — Teague's equation, arrived at by moving rays rather than by
 * discretizing a PDE. § 6f.10 pins that identity against the closed form.
 *
 * Rays that cross simply add, which is what incoherent ray flux does and what
 * makes this survive a caustic that `transportJacobian`'s density cannot.
 *
 * Wrapping is periodic, matching the transform the object's spectrum is read by
 * — a ray that leaves the frame re-enters it, exactly as `abbeImage`'s
 * convolution wraps. On a specimen filling the frame that is the same edge
 * assumption both branches already make.
 */
export function transportImage(object: ObjectField, options: TransportOptions): TransportImage {
  const n = object.size;
  const { pupilSamples, defocusWaves } = options;
  const m = options.raysPerPixel ?? 1;
  const delta = defocusDeflectionPixels(defocusWaves, n, pupilSamples);

  // The rays and the image are on DIFFERENT grids on purpose. Raising `m`
  // subdivides the specimen — more rays, each carrying less — and leaves the
  // image where it is, so the deposition window below does not move when the
  // sampling does. Forming a finer image and binning it down instead would have
  // shrunk that window with m, which is a second thing changing at once.
  const rays = subSamples(object, m);
  const nf = rays.size;
  const d = phaseGradient(rays);

  const fluxPerRay = 1 / (m * m);
  const intensity = new Float64Array(n * n);
  let maxDisplacementPixels = 0;

  for (let y = 0; y < nf; y++) {
    for (let x = 0; x < nf; x++) {
      const i = y * nf + x;
      const flux = d.intensity[i]! * fluxPerRay;
      // The gradient came back per RAY pixel and δ is per OBJECT pixel, so the
      // m between them is the whole conversion — one factor, stated once.
      const sx = delta * m * d.dx[i]!;
      const sy = delta * m * d.dy[i]!;
      const r = Math.hypot(sx, sy);
      if (r > maxDisplacementPixels) maxDisplacementPixels = r;
      if (flux === 0) continue;

      const tx = subSampleCentre(x, m) + sx;
      const ty = subSampleCentre(y, m) + sy;
      const fx = Math.floor(tx);
      const fy = Math.floor(ty);
      const ax = tx - fx;
      const ay = ty - fy;
      const x0 = wrap(fx, n);
      const y0 = wrap(fy, n);
      const x1 = x0 + 1 === n ? 0 : x0 + 1;
      const y1 = y0 + 1 === n ? 0 : y0 + 1;
      intensity[y0 * n + x0]! += flux * (1 - ax) * (1 - ay);
      intensity[y0 * n + x1]! += flux * ax * (1 - ay);
      intensity[y1 * n + x0]! += flux * (1 - ax) * ay;
      intensity[y1 * n + x1]! += flux * ax * ay;
    }
  }

  let energy = 0;
  for (let i = 0; i < n * n; i++) energy += intensity[i]!;

  return {
    size: n,
    pupilSamples,
    intensity,
    deflectionPixels: delta,
    maxDisplacementPixels,
    maxDefocusPhaseRadians: maxDefocusPhase(object, pupilSamples, defocusWaves),
    energy,
    minModulus: d.minModulus,
    raysPerPixel: m,
    ...(options.scale === undefined
      ? {}
      : { pixelScaleMm: imagePixelScaleMm(options.scale, n, pupilSamples) }),
  };
}

/** Object-grid coordinate of ray index `q` — see `subSamples`. */
function subSampleCentre(q: number, m: number): number {
  return (q + 0.5) / m - 0.5;
}

/**
 * The transfer the deposition itself has: sinc²(π·ν/(2·padFactor)).
 *
 * A ray is a point and the image is a grid, so a ray landing between two cells
 * has to be shared between them, and sharing it by area is a convolution with a
 * triangle one object pixel wide. That triangle is IN the answer — it is what
 * "the rays, on this grid" means — and its transfer is a closed form, so
 * § 6f.10 divides it out rather than absorbing it into a tolerance.
 *
 * It does not shrink with `raysPerPixel`, deliberately: more rays sample the
 * specimen better, they do not make the image's own pixels smaller. What DOES
 * shrink it is a larger `padFactor`, which is the same knob § 6f.9 found the
 * pupil grid's own guard riding on.
 *
 * ν is this file's frequency (ν = 1 at the coherent cutoff), so the frequency
 * per object pixel is ν/(2·padFactor) — § 6f.8's bridge, read backwards.
 */
export function depositionWindow(nu: number, size: number, pupilSamples: number): number {
  const p = padFactorOf(size, pupilSamples);
  const a = (Math.PI * nu) / (2 * p);
  if (a === 0) return 1;
  const sinc = Math.sin(a) / a;
  return sinc * sinc;
}

/**
 * `m`×`m` rays per object cell, at the cell's own sub-sample points.
 *
 * Zero-padding the spectrum interpolates the object exactly — the band-limited
 * interpolation of its own samples, not a kernel chosen here; `specimen.ts`
 * makes the same argument from the other side (a callback evaluated at the
 * warped point, so there is nothing to interpolate) and this is the version
 * available when the object arrives as an array.
 *
 * **A half-cell shift rides along with it.** Plain padding puts the m
 * sub-samples of cell j at j, j+1/m, … j+(m−1)/m — a set whose centre is
 * (m−1)/(2m) PAST the cell they belong to. Left alone that is a rigid
 * translation of the image approaching half a pixel, which reads as a contrast
 * error at every frequency and does not shrink with m. It is corrected as a
 * phase ramp on the object's own spectrum, so the sub-samples land at
 * (q + ½)/m − ½ and their centre is the cell's centre. Measured before it was
 * written: without it the image of a defocused phase grating comes back with
 * its extremum on the wrong sample and no amount of m repairs it.
 *
 * The Nyquist row and column are dropped rather than split: for an even grid
 * that bin is its own alias, so no placement of it in the finer spectrum is
 * more right than another, and an object with anything there is one whose
 * sampling has already failed.
 */
export function subSamples(object: ObjectField, m: number): ObjectField {
  const n = object.size;
  if (!isPowerOfTwo(m)) {
    throw new Error(`raysPerPixel must be a power of two, got ${m}`);
  }
  if (m === 1) return object;
  const nf = n * m;
  const specRe = Float64Array.from(object.re);
  const specIm = Float64Array.from(object.im);
  fft2d(specRe, specIm, n);

  const re = new Float64Array(nf * nf);
  const im = new Float64Array(nf * nf);
  // The inverse transform divides by nf², where the forward one that produced
  // these bins did not divide by n² — so the amplitudes carry m² to come back
  // at the object's own level.
  const gain = m * m;
  const shift = (m - 1) / (2 * m);
  const half = n / 2;
  for (let y = 0; y < n; y++) {
    if (y === half) continue;
    const ky = y < half ? y : y - n;
    const ty = y < half ? y : y + nf - n;
    for (let x = 0; x < n; x++) {
      if (x === half) continue;
      const kx = x < half ? x : x - n;
      const tx = x < half ? x : x + nf - n;
      // f(u − shift) per axis: bin k picks up exp(−2πi·k·shift/n).
      const ang = (-2 * Math.PI * (kx + ky) * shift) / n;
      const c = Math.cos(ang);
      const sn = Math.sin(ang);
      const src = y * n + x;
      const dst = ty * nf + tx;
      re[dst] = gain * (specRe[src]! * c - specIm[src]! * sn);
      im[dst] = gain * (specRe[src]! * sn + specIm[src]! * c);
    }
  }
  fft2d(re, im, nf, true);
  return { size: nf, re, im };
}

function wrap(i: number, n: number): number {
  const m = i % n;
  return m < 0 ? m + n : m;
}

/**
 * |χ| at the highest frequency the object carries anything at.
 *
 * "Carries anything" is a threshold on the object's own power spectrum relative
 * to its largest bin, and it has to be one: a pointwise-sampled `exp(iφ)` has
 * f64 dust in every bin, so a literal maximum over nonzero bins would return
 * the Nyquist χ for every object and mean nothing. The default cuts at 1e-12 of
 * the peak — below the level any contrast in this file is read at, and far above
 * the dust.
 */
export function maxDefocusPhase(
  object: ObjectField,
  pupilSamples: number,
  defocusWaves: number,
  powerFloor = 1e-12,
): number {
  const n = object.size;
  const re = Float64Array.from(object.re);
  const im = Float64Array.from(object.im);
  fft2d(re, im, n);
  let peak = 0;
  for (let i = 0; i < n * n; i++) {
    const p = re[i]! * re[i]! + im[i]! * im[i]!;
    if (p > peak) peak = p;
  }
  if (peak === 0) return 0;
  const cut = peak * powerFloor;
  // ν = 2·k/pupilSamples per axis, with k the signed bin index.
  let maxNu2 = 0;
  for (let y = 0; y < n; y++) {
    const ky = y < n / 2 ? y : y - n;
    for (let x = 0; x < n; x++) {
      const i = y * n + x;
      const p = re[i]! * re[i]! + im[i]! * im[i]!;
      if (p < cut) continue;
      const kx = x < n / 2 ? x : x - n;
      const nu2 = (4 * (kx * kx + ky * ky)) / (pupilSamples * pupilSamples);
      if (nu2 > maxNu2) maxNu2 = nu2;
    }
  }
  return Math.abs(2 * Math.PI * defocusWaves * maxNu2);
}

export interface TransportJacobian {
  readonly size: number;
  /** det(I + δ·H(φ)) at every object sample. */
  readonly determinant: Float64Array;
  /** I/|det J| — the differential density, infinite on a caustic. */
  readonly density: Float64Array;
  readonly minDeterminant: number;
  /** True where the map has folded: some ray has crossed its neighbour. */
  readonly caustic: boolean;
  readonly deflectionPixels: number;
}

/**
 * The same map, differentiated instead of pushed — and the reason the equation
 * at the top of this file has a Laplacian in it.
 *
 * The map x′ = x + δ∇φ has Jacobian J = I + δ·H(φ), and a map takes a patch of
 * area A to one of area A·|det J|, so a beam of intensity I arrives at density
 * I/|det J|. Expanding for small δ,
 *
 *     det J = 1 + δ·(φ_xx + φ_yy) + δ²·(φ_xx·φ_yy − φ_xy²)
 *     1/det J = 1 − δ·∇²φ + O(δ²)
 *
 * so the Laplacian is not put in by hand — it is the trace of the Hessian
 * falling out of a determinant, which is the same shape of derivation § 5j.3
 * used to get ΔS_IV = 0 out of an expansion rather than by assertion.
 *
 * **det J ≤ 0 is a caustic**, and it is the honest edge of this whole branch:
 * two rays have crossed, so there is no longer one object point per image point
 * and the density is not a function. `transportImage` keeps working there
 * because flux still adds; this readout goes to infinity, which is the correct
 * report and not a defect. The threshold is δ·(the map's most negative
 * curvature) = −1, which on a grating of phase amplitude φ₁ at ν is a closed
 * form § 6f.10 pins.
 */
export function transportJacobian(
  object: ObjectField,
  options: TransportOptions,
): TransportJacobian {
  const n = object.size;
  const delta = defocusDeflectionPixels(options.defocusWaves, n, options.pupilSamples);
  const d = phaseDerivatives(object);
  const determinant = new Float64Array(n * n);
  const density = new Float64Array(n * n);
  let minDeterminant = Number.POSITIVE_INFINITY;

  for (let i = 0; i < n * n; i++) {
    const a = 1 + delta * d.dxx[i]!;
    const b = 1 + delta * d.dyy[i]!;
    const c = delta * d.dxy[i]!;
    const det = a * b - c * c;
    determinant[i] = det;
    if (det < minDeterminant) minDeterminant = det;
    density[i] = det === 0 ? Number.POSITIVE_INFINITY : d.intensity[i]! / Math.abs(det);
  }

  return {
    size: n,
    determinant,
    density,
    minDeterminant,
    caustic: minDeterminant <= 0,
    deflectionPixels: delta,
  };
}

/**
 * The wave branch's own answer for a weak phase grating, in closed form:
 * contrast = 2·φ₁·|sin(2π·w₂₀·ν²)|, and this returns the signed inner factor.
 *
 * External, and the reason this module can be pinned at all — it is the
 * weak-phase defocus transfer (Teague 1983; the same sin(π·λ·z·f²) that phase
 * contrast transfer functions are written with), which owes nothing to this
 * engine. `weakPhaseTransfer(defocusedPupil(w₂₀), coherentSource(), ν)` is the
 * engine's own computation of its modulus and § 6f.10 pins the two together, so
 * neither is taken on trust.
 *
 * This branch computes the ARGUMENT where the truth is the sine of it. That is
 * not a defect to be tolerated, it is what the geometric limit *is*, and
 * `maxDefocusPhaseRadians` is how a caller learns how far the two have parted.
 */
export function weakPhaseDefocusTransfer(defocusWaves: number, nu: number): number {
  return Math.sin(2 * Math.PI * defocusWaves * nu * nu);
}

/** The same in the geometric limit — the argument, not its sine. */
export function weakPhaseTransportTransfer(defocusWaves: number, nu: number): number {
  return 2 * Math.PI * defocusWaves * nu * nu;
}
