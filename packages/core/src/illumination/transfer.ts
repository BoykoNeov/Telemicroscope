import { diffractionLimitedMtf } from "../wave/mtf";
import type { PupilFunction } from "../wave/psf";
import type { CondenserSource } from "./source";

/**
 * What a brightfield microscope transmits, as a function of detail — and the
 * three laws § 6f pins.
 *
 * `wave/mtf` answers this for a self-luminous object with one curve. Partial
 * coherence has no such curve: the image is nonlinear in the object, so
 * "the MTF" is not defined and any single number sold as one is a fiction. What
 * *is* defined, and what this file computes, is the image of a **sinusoidal
 * grating** — the object whose spectrum is three lines, and the one Abbe used.
 * Three lines is not a simplification of the sum in `abbe.ts`; it is that sum
 * with the transform done in closed form, because a three-line spectrum makes
 * the inverse transform three terms:
 *
 *     E_s(x) = o₋·P(s−ν)·e^(−iθ) + o₀·P(s) + o₊·P(s+ν)·e^(+iθ),   θ = 2πνx
 *
 * and |E_s|² then has a mean, a term at ν and a term at 2ν whose coefficients
 * are products of three pupil samples. Summing those over the source is the
 * whole calculation, at three pupil evaluations per source point instead of a
 * transform — which is what makes sweeping ν × S × sampling affordable. The
 * FFT path in `abbe.ts` and this one are pinned against each other (§ 6f).
 *
 * ## Frequency units: ν = f·λ/NA, so 1 is coherent and 2 is incoherent
 *
 * Frequency is measured in units of NA/λ — the pupil's own radius — throughout
 * this file. Two cutoffs live in that scale and both are pinned:
 * **ν = 1** is where a single on-axis beam stops resolving, and **ν = 2** is
 * `wave/mtf`'s incoherent cutoff 2·NA/λ. `wave/mtf` normalizes to the latter,
 * so its ν is half of this one; the bridge is stated rather than left to be
 * rediscovered.
 *
 * ## The three laws
 *
 * For a **weak absorbing** object — one whose transmittance is 1 − a(x) with a
 * small — the image *is* linear, and there is an honest transfer function. For
 * a uniformly filled circular condenser of coherence parameter S and an
 * aberration-free circular pupil it has a closed form, `weakObjectTransferDisk`
 * below: the normalized area in which the source disc, the pupil, and the pupil
 * displaced by ν all overlap. Three consequences, and they are the rungs:
 *
 *  - **S → 0 is coherent.** The transfer is exactly **1** out to ν = 1 and
 *    exactly **0** past it: a flat plateau and a cliff. Nothing is attenuated
 *    before the cutoff, which is why coherent images ring at edges.
 *  - **S ≥ 1 is incoherent** — and *exactly*, not asymptotically. Once the
 *    source disc covers the pupil, enlarging it further changes nothing, and
 *    the transfer equals `diffractionLimitedMtf`. The same closed form § 2b
 *    already pins; this file mints no second number for it.
 *  - **In between, the cutoff is (1 + S).** Which is the textbook
 *    d_min = λ/(NA_obj + NA_cond) — arrived at by measuring where the sum goes
 *    to zero, not by writing it down. It is also why the law stops at S = 1:
 *    the support of the sum is set by the pupil's autocorrelation, so it cannot
 *    exceed 2 however far the condenser opens.
 *
 * And one null, which is the reason stains exist: a **weak phase** object is
 * invisible. Its two sidebands enter the intensity with opposite signs, so for
 * a real pupil they cancel exactly, at every ν and every S. Aberrate the pupil
 * — defocus is enough — and it appears. Brightfield does not see phase; that is
 * a property of the sum, not a limitation of this model.
 */

/** Frequency in units of NA/λ at which the linear transfer reaches zero. */
export function intensityCutoff(coherenceParameter: number): number {
  if (!(coherenceParameter >= 0)) {
    throw new Error(`coherenceParameter must be >= 0, got ${coherenceParameter}`);
  }
  // Capped at 2: source points beyond the pupil rim cannot pair an undiffracted
  // beam with a diffracted one, so they add no linear transfer at all.
  return 1 + Math.min(coherenceParameter, 1);
}

/**
 * Area of intersection of two circles of radii `r` and `R` whose centres are
 * `d` apart. The lens-shaped overlap, in closed form.
 */
export function circleOverlapArea(d: number, r: number, R: number): number {
  const a = Math.abs(d);
  if (a >= r + R) return 0;
  if (a <= Math.abs(R - r)) return Math.PI * Math.min(r, R) ** 2;
  const c1 = Math.acos(clampUnit((a * a + r * r - R * R) / (2 * a * r)));
  const c2 = Math.acos(clampUnit((a * a + R * R - r * r) / (2 * a * R)));
  const tri = Math.sqrt((-a + r + R) * (a + r - R) * (a - r + R) * (a + r + R));
  return r * r * c1 + R * R * c2 - 0.5 * tri;
}

function clampUnit(x: number): number {
  return x < -1 ? -1 : x > 1 ? 1 : x;
}

/**
 * The weak-absorbing-object transfer of an aberration-free circular pupil under
 * a uniformly filled circular condenser — closed form, and the thing the
 * measured sum is pinned against.
 *
 *     T(ν) = area( disc(0, S) ∩ disc(ν, 1) ) / (π·S²)
 *
 * The numerator is the source's overlap with the pupil displaced by ν, which is
 * the set of illumination directions for which the undiffracted beam AND the
 * order at ν both get through — the pairs that can interfere and so the only
 * ones that carry contrast at ν. The denominator is the light that reaches the
 * image at all.
 *
 * S above 1 uses S = 1: source points outside the pupil contribute nothing to
 * the numerator and nothing to the denominator either, so the ratio stops
 * moving. That is why the same expression covers the incoherent limit, and why
 * `diffractionLimitedMtf` is a *check* on this rather than a second branch of
 * it.
 */
export function weakObjectTransferDisk(coherenceParameter: number, nu: number): number {
  if (!(coherenceParameter >= 0)) {
    throw new Error(`coherenceParameter must be >= 0, got ${coherenceParameter}`);
  }
  const S = Math.min(coherenceParameter, 1);
  if (S === 0) return Math.abs(nu) < 1 ? 1 : 0;
  return circleOverlapArea(nu, S, 1) / (Math.PI * S * S);
}

interface Complex {
  re: number;
  im: number;
}

function evalPupil(p: PupilFunction, px: number, py: number, out: Complex): void {
  const a = p.amplitude(px, py);
  if (a <= 0) {
    out.re = 0;
    out.im = 0;
    return;
  }
  const ang = 2 * Math.PI * p.phaseWaves(px, py);
  out.re = a * Math.cos(ang);
  out.im = a * Math.sin(ang);
}

/** The three pupil sums every readout in this file is built from. */
interface OrderSums {
  /** Σ w·|P(s)|² — the undiffracted light, and the image's mean. */
  readonly zero: number;
  /** Σ w·P(s+ν)·P̄(s) — the +1 order beating against the direct beam. */
  readonly plus: Complex;
  /** Σ w·P(s)·P̄(s−ν) — the direct beam beating against the −1 order. */
  readonly minus: Complex;
  /** Σ w·P(s+ν)·P̄(s−ν) — the two orders beating with each other, at 2ν. */
  readonly cross: Complex;
}

function orderSums(pupil: PupilFunction, source: CondenserSource, nu: number): OrderSums {
  const p0: Complex = { re: 0, im: 0 };
  const pp: Complex = { re: 0, im: 0 };
  const pm: Complex = { re: 0, im: 0 };
  let zero = 0;
  const plus: Complex = { re: 0, im: 0 };
  const minus: Complex = { re: 0, im: 0 };
  const cross: Complex = { re: 0, im: 0 };

  for (const s of source.points) {
    evalPupil(pupil, s.sx, s.sy, p0);
    evalPupil(pupil, s.sx + nu, s.sy, pp);
    evalPupil(pupil, s.sx - nu, s.sy, pm);
    const w = s.weight;
    zero += w * (p0.re * p0.re + p0.im * p0.im);
    // P(s+ν)·conj(P(s))
    plus.re += w * (pp.re * p0.re + pp.im * p0.im);
    plus.im += w * (pp.im * p0.re - pp.re * p0.im);
    // P(s)·conj(P(s−ν))
    minus.re += w * (p0.re * pm.re + p0.im * pm.im);
    minus.im += w * (p0.im * pm.re - p0.re * pm.im);
    // P(s+ν)·conj(P(s−ν))
    cross.re += w * (pp.re * pm.re + pp.im * pm.im);
    cross.im += w * (pp.im * pm.re - pp.re * pm.im);
  }
  return { zero, plus, minus, cross };
}

export interface GratingImage {
  /** Mean intensity, with a clear field under a fully transmitted source = 1. */
  readonly dc: number;
  /** Peak amplitude of the component at ν. */
  readonly fundamental: number;
  /**
   * Peak amplitude of the component at 2ν — a frequency a *linear* imager could
   * not put there from a single-frequency object, and the visible signature of
   * partial coherence's nonlinearity.
   */
  readonly secondHarmonic: number;
  /** fundamental / dc. */
  readonly contrast: number;
}

/**
 * The image of a sinusoidal absorption grating, t = 1 + m·cos(2πνx), at finite
 * modulation — the exact three-order Abbe sum, no weak-object assumption.
 */
export function gratingImage(
  pupil: PupilFunction,
  source: CondenserSource,
  nu: number,
  modulation: number,
): GratingImage {
  const sums = orderSums(pupil, source, nu);
  const h = modulation / 2;
  // |a₀|² + |a₊|² + |a₋|², with a± = (m/2)·P(s±ν): the m² terms are the
  // sidebands' own intensity, and dropping them is what "weak" would mean.
  const sidebands = sideBandPower(pupil, source, nu);
  const dc = sums.zero + h * h * sidebands;
  const c1re = h * (sums.plus.re + sums.minus.re);
  const c1im = h * (sums.plus.im + sums.minus.im);
  const fundamental = 2 * Math.hypot(c1re, c1im);
  const secondHarmonic = 2 * h * h * Math.hypot(sums.cross.re, sums.cross.im);
  return { dc, fundamental, secondHarmonic, contrast: dc > 0 ? fundamental / dc : 0 };
}

function sideBandPower(pupil: PupilFunction, source: CondenserSource, nu: number): number {
  const pp: Complex = { re: 0, im: 0 };
  const pm: Complex = { re: 0, im: 0 };
  let acc = 0;
  for (const s of source.points) {
    evalPupil(pupil, s.sx + nu, s.sy, pp);
    evalPupil(pupil, s.sx - nu, s.sy, pm);
    acc += s.weight * (pp.re * pp.re + pp.im * pp.im + pm.re * pm.re + pm.im * pm.im);
  }
  return acc;
}

/**
 * Transfer for a weak **absorbing** object: the m → 0 limit of
 * `gratingImage(...).contrast / (2m)`, evaluated exactly rather than by taking
 * a small m and hoping.
 *
 *     T(ν) = |Σ w·[ P(s+ν)P̄(s) + P(s)P̄(s−ν) ]| / (2·Σ w·|P(s)|²)
 *
 * For an aberration-free pupil and a uniform disc source this is
 * `weakObjectTransferDisk` — which is the § 6f pin. For a *traced* objective's
 * pupil it is the same expression with the aberration in it, which is the point
 * of computing it this way rather than reading the closed form.
 */
export function weakObjectTransfer(
  pupil: PupilFunction,
  source: CondenserSource,
  nu: number,
): number {
  const { zero, plus, minus } = orderSums(pupil, source, nu);
  if (!(zero > 0)) return 0;
  return Math.hypot(plus.re + minus.re, plus.im + minus.im) / (2 * zero);
}

/**
 * Transfer for a weak **phase** object, t = exp(i·φ·cos 2πνx) with φ small —
 * normalized so that image contrast = 2·φ·T, matching `weakObjectTransfer`'s
 * convention.
 *
 *     T(ν) = |Σ w·[ P(s+ν)P̄(s) − P(s)P̄(s−ν) ]| / (2·Σ w·|P(s)|²)
 *
 * The minus sign is the whole story. A phase object's two sidebands are in
 * quadrature with the direct beam and 180° apart from each other, so for a real
 * (aberration-free) pupil the two terms are equal and this is **identically
 * zero** — a hard null, at every frequency, every S, and every φ. Give the
 * pupil an even aberration and the two terms pick up different phases and stop
 * cancelling: that is why a defocused brightfield image of an unstained cell
 * shows something and a focused one shows nothing, and it is the whole
 * motivation for phase contrast (v2) and for staining (§ 6f's scenes).
 */
export function weakPhaseTransfer(
  pupil: PupilFunction,
  source: CondenserSource,
  nu: number,
): number {
  const { zero, plus, minus } = orderSums(pupil, source, nu);
  if (!(zero > 0)) return 0;
  return Math.hypot(plus.re - minus.re, plus.im - minus.im) / (2 * zero);
}

/**
 * An unaberrated circular pupil — the ideal objective the closed forms describe.
 *
 * Its radius is 1 by construction: normalized pupil coordinates *are* the
 * frequency scale this module works in, so there is no separate NA to carry.
 */
export function idealPupil(): PupilFunction {
  return {
    amplitude: (px, py) => (px * px + py * py <= 1 ? 1 : 0),
    phaseWaves: () => 0,
  };
}

/**
 * The same disc with a defocus wavefront W = w₂₀·(x²+y²) in waves — the one
 * aberration needed to make a phase object visible, and the cheapest way to
 * show that the transfer above is reading the pupil rather than a formula.
 */
export function defocusedPupil(defocusWaves: number): PupilFunction {
  return {
    amplitude: (px, py) => (px * px + py * py <= 1 ? 1 : 0),
    phaseWaves: (px, py) => defocusWaves * (px * px + py * py),
  };
}

/** The incoherent transfer in this file's frequency units (ν = 1 ↔ NA/λ). */
export function incoherentTransfer(nu: number): number {
  return diffractionLimitedMtf(Math.abs(nu) / 2);
}

/**
 * Abbe's brightfield resolution limit — the finest grating period a condenser
 * of NA_c and an objective of NA_o still transmit:
 *
 *     d = λ / (NA_objective + NA_condenser)
 *
 * The number on every microscopy course's first slide, and the reason the
 * condenser diaphragm is not a brightness control. It is `abbeResolutionMm`'s
 * λ/(2·NA) when the condenser is opened to match the objective, and λ/NA — half
 * the resolution — when it is stopped down to a pinhole. That is a factor of
 * two available for free at the cost of contrast, which is the trade the S dial
 * makes.
 *
 * Beyond NA_c = NA_o it stops improving; see `intensityCutoff`.
 */
export function brightfieldResolutionMm(
  wavelengthNm: number,
  objectiveNA: number,
  condenserNA: number,
): number {
  if (!(objectiveNA > 0)) throw new Error("brightfieldResolutionMm: objective NA must be positive");
  if (!(condenserNA >= 0)) throw new Error("brightfieldResolutionMm: condenser NA must be >= 0");
  const na = objectiveNA * intensityCutoff(condenserNA / objectiveNA);
  return (wavelengthNm * 1e-6) / na;
}
