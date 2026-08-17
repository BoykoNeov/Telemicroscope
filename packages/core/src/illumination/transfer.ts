import { adaptiveIntegral } from "../math/quadrature";
import { diffractionLimitedMtf } from "../wave/mtf";
import type { PupilFunction, PupilScale } from "../wave/psf";
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

/**
 * The numerical aperture a `PupilScale` describes: n′·(exit semi-diameter) over
 * the reference-sphere radius.
 *
 * The tangent form, which is what `wave/mtf`'s cutoff identity 2·NA/λ is built
 * on — so using it here is what makes the two modules' frequency axes the same
 * axis rather than two that happen to look alike.
 */
export function pupilNumericalAperture(scale: PupilScale): number {
  return Math.abs((scale.nImage * scale.exitRadius) / scale.referenceRadius);
}

/**
 * The bridge out of this file's units and into the engine's: ν → cycles/mm.
 *
 *     f = ν · NA / λ
 *
 * A claim in a doc comment that "ν = 2 is the incoherent cutoff" is worth
 * nothing if nothing computes it, so it is a function and § 6f pins it both
 * ways: against `imagePixelScaleMm`'s own grid arithmetic, and against a PSF of
 * the same pupil pushed through `wave/mtf`.
 */
export function spatialFrequencyCyclesPerMm(nu: number, scale: PupilScale): number {
  return (nu * pupilNumericalAperture(scale)) / (scale.wavelengthNm * 1e-6);
}

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
 * (aberration-free) pupil **and a source symmetric under s → −s** the two terms
 * are equal and this is **identically zero** — a hard null, at every frequency,
 * every S, and every φ. Both conditions are load-bearing: every source this
 * module builds is centro-symmetric, and a deliberately lopsided one would
 * break the null without any aberration at all. Give the
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

/**
 * ## Which harmonic of a grating exists at all, and the two legs of the question
 *
 * Everything above computes *how much* of a frequency gets through. This pair
 * answers the prior question — **whether there is anything there to compute** —
 * and it exists because § 6ab.12 found a panel printing four significant figures
 * of a quantity that is identically zero.
 *
 * A grating of frequency ν diffracts into orders at s + m·ν for integer m. The
 * image is |Σ orders|², so its harmonic at h·ν is a sum of beats between order
 * pairs **h apart** — which sit h·ν apart in the pupil. So the harmonic exists
 * only if some illuminated direction puts *both* members of such a pair inside
 * the objective pupil, and that is pure geometry: no wavefront, no φ, no
 * defocus. Two facts fall straight out of it and both are rungs:
 *
 *  - **h·ν < 2 is necessary**, because two points h·ν apart cannot both lie in a
 *    pupil of radius 1 once their separation reaches the diameter. At h = 1 this
 *    is `intensityCutoff` — the (1 + S) law above, *recovered* from the order
 *    geometry rather than evaluated — and at h = 2 it caps ν at **1**, so a
 *    second harmonic beyond the coherent cutoff does not exist at any S.
 *  - **A darkfield annulus has its own, lower cutoff.** Necessary is not
 *    sufficient: the direction has to be in the aperture too, and an annulus that
 *    starts outside the pupil can only reach a pair by borrowing a whole number
 *    of orders. For the ring `inner ≤ |s| ≤ outer` the second harmonic stops at
 *    **(1 + outer)/3** — 0.8 for A3's own 1.1–1.4 ring, against 1 in brightfield.
 *
 * ## Why two functions and not one
 *
 * `apertureCarriesHarmonic` asks it of the **aperture**, in closed form and on a
 * set of positive area. `harmonicSupportWeight` asks it of the **sampled** source
 * an image was actually formed from. They disagree in both directions, and each
 * disagreement is a way for a readout to lie:
 *
 *  - *aperture yes, sampling no* — the lattice is blind. A3's darkfield ring at
 *    7 samples holds 16 points and none of them is in the band that carries 2ν at
 *    ν = 0.75, so the image says "no second harmonic" where the ring has one.
 *  - *aperture no, sampling yes* — the lattice invented it. At ν = 1 exactly the
 *    carrying set is the single on-axis direction: zero area, so nothing, but a
 *    lattice with a point at the origin gives it finite weight and reads 8e-4.
 *
 * A readout may be printed only when both agree, and § 6ab.12 measures that the
 * gate is not conservative: wherever the weight is zero the rendered harmonic is
 * f64 roundoff, and wherever it is positive the reading is ten or more orders
 * larger. There is no threshold anywhere in it, which is the whole point —
 * § 6ab.11 looked for one over ν, S and φ and there is none to find.
 */
export interface GratingOrders {
  /** Grating periods across the object field — the order spacing, in bins. */
  readonly cycles: number;
  /** Frequency bins across the pupil DIAMETER, as everywhere in `abbe.ts`. */
  readonly pupilSamples: number;
  /** Which image harmonic. 2 is the +1×−1 beat; 1 is the grating's own line. */
  readonly harmonic?: number;
}

/**
 * Fraction of the illumination weight whose orders can carry `harmonic`·ν.
 *
 * The pupil is asked, never re-derived: `pupil.amplitude` is called at exactly
 * the coordinates `abbeImage` would evaluate it at — (m·cycles)·(2/pupilSamples)
 * offset by the direction — so an apodized or aberrated pupil answers for
 * itself and a rim decision cannot differ between this and the render. Writing
 * `|p| ≤ 1` here instead would put the gate one lattice cell away from the
 * image it is gating, and A3's ring at 11 samples has **two** carrying points
 * out of 36: one cell is the difference between a verdict and its opposite.
 *
 * Assumes a grating along x, which is `phaseGratingObject`'s geometry — its
 * spectrum lives on the u_y = 0 row, so both members of a pair are read at the
 * direction's own s_y.
 */
export function harmonicSupportWeight(
  pupil: PupilFunction,
  source: CondenserSource,
  orders: GratingOrders,
): number {
  const { cycles, pupilSamples } = orders;
  const harmonic = orders.harmonic ?? 2;
  if (!Number.isInteger(cycles) || cycles < 1) {
    throw new Error(`harmonicSupportWeight: cycles must be a positive integer, got ${cycles}`);
  }
  if (!Number.isInteger(pupilSamples) || pupilSamples < 1) {
    throw new Error(
      `harmonicSupportWeight: pupilSamples must be a positive integer, got ${pupilSamples}`,
    );
  }
  if (!Number.isInteger(harmonic) || harmonic < 1) {
    throw new Error(`harmonicSupportWeight: harmonic must be a positive integer, got ${harmonic}`);
  }
  const step = 2 / pupilSamples;
  const nu = cycles * step;
  let weight = 0;
  for (const s of source.points) {
    // An order past the pupil rim in the worst direction cannot be inside it, so
    // the search is bounded by geometry rather than by a cap: one past each end,
    // because the bound is on the coordinate and the loop counts orders.
    const span = (1 + Math.hypot(s.sx, s.sy)) / nu;
    const lo = Math.ceil(-span) - 1;
    const hi = Math.floor(span) + 1;
    for (let m = lo; m <= hi; m++) {
      const near = m * cycles * step + s.sx;
      const far = (m + harmonic) * cycles * step + s.sx;
      if (pupil.amplitude(near, s.sy) !== 0 && pupil.amplitude(far, s.sy) !== 0) {
        weight += s.weight;
        break;
      }
    }
  }
  return weight;
}

/**
 * Does a circular or annular aperture carry `harmonic`·ν on a set of directions
 * of **positive area**? Closed form, exact.
 *
 * With the pair at s + m·ν and s + (m+h)·ν both inside the unit pupil, and the
 * best case s_y = 0 (any other row has less room in x), the near member must
 * satisfy s_x + m·ν ∈ [−1, 1 − h·ν] with s_x ∈ [inner, outer]. So the whole
 * question is whether one integer m makes those two intervals overlap in more
 * than a point — a handful of m to try, since m·ν is bounded by 1 + outer.
 *
 * **Positive area rather than merely nonempty, and that distinction is the
 * ν = 1 defect.** There the interval collapses to the single point s_x = 0: a
 * real aperture carries no energy on a set of measure zero, but the sampled
 * lattice has a point sitting on it, and § 6ab.11 recorded the resulting 8e-4
 * and its 9.4× disagreement as a *structural* property of the rim. It is an
 * artifact of area zero given finite weight.
 *
 * The coherent limit is excluded rather than special-cased: `outer > inner` is
 * required, because a single direction is not a discretization of an aperture
 * and there is nothing for this leg to check against `harmonicSupportWeight`.
 */
export function apertureCarriesHarmonic(
  inner: number,
  outer: number,
  nu: number,
  harmonic = 2,
): boolean {
  apertureGuards(inner, outer, nu, harmonic, "apertureCarriesHarmonic");
  const gap = harmonic * nu;
  // Two points `gap` apart in a pupil of DIAMETER 2. The h = 1 case of this is
  // `intensityCutoff`'s own cap, reached from the other side.
  if (!(gap < 2)) return false;
  const lo = Math.ceil(-(1 + outer) / nu) - 1;
  const hi = Math.floor((1 - gap - inner) / nu) + 1;
  for (let m = lo; m <= hi; m++) {
    if (Math.max(inner, -1 - m * nu) < Math.min(outer, 1 - gap - m * nu)) return true;
  }
  return false;
}

function apertureGuards(inner: number, outer: number, nu: number, harmonic: number, who: string) {
  if (!(inner >= 0)) throw new Error(`${who}: inner must be >= 0, got ${inner}`);
  if (!(outer > inner)) {
    throw new Error(
      `${who}: needs an aperture of positive area — outer must exceed inner, got inner ` +
        `${inner} and outer ${outer}. A single direction is not one; ask ` +
        `harmonicSupportWeight instead.`,
    );
  }
  if (!(nu > 0)) throw new Error(`${who}: nu must be > 0, got ${nu}`);
  if (!Number.isInteger(harmonic) || harmonic < 1) {
    throw new Error(`${who}: harmonic must be a positive integer, got ${harmonic}`);
  }
}

/**
 * How much of ONE row of the aperture carries `harmonic`·ν — exactly, and with
 * no quadrature anywhere in it.
 *
 * The grating runs along x, so its orders differ only in s_x and the whole
 * criterion decomposes by row: at fixed s_y a direction s_x carries the harmonic
 * iff some integer m puts s_x + m·ν and s_x + (m+h)·ν both inside the pupil,
 * which for a hard unit pupil means both within ±R of the axis, R = √(1 − s_y²).
 * That is the interval
 *
 *     s_x ∈ [−R − m·ν, R − (m+h)·ν],   length 2R − h·ν, one per m, spaced ν
 *
 * so the carrying set of the row is a union of equal intervals on a lattice of
 * step ν, and the row's answer is the length of that union inside the aperture's
 * own chord. Both are finite unions of intervals, so the intersection is exact
 * arithmetic — `harmonicCarryingArea` is a quadrature *of this*, and every claim
 * that has to be sharp is made here rather than there.
 *
 * Three consequences are visible in the interval form and all three are rungs:
 *
 *  - **2R ≤ h·ν kills the row.** The intervals are empty, so rows past
 *    |s_y| = √(1 − (h·ν/2)²) carry nothing — and a darkfield ring at |s_y| > 1
 *    carries nothing at any ν, while still counting in the denominator.
 *  - **2R ≥ (h+1)·ν closes the gaps.** Consecutive intervals then overlap and
 *    the union is the whole line, so the row carries everywhere the aperture
 *    reaches, whatever the chord looks like.
 *  - **Between them the row is striped**, carrying (2R − h·ν) out of every ν,
 *    and which stripes the chord lands on is what makes the sampled lattice's
 *    answer jump around (§ 6ab.14).
 *
 * Preconditions, both different from `harmonicSupportWeight`: the pupil is the
 * hard unit disc, **closed** — which is what makes the ν = 1 carrying set the
 * single axial point rather than nothing — where the sampled leg asks a
 * `PupilFunction` and so answers for an apodized or aberrated one; and the
 * grating is along x.
 */
export function harmonicCarryingChord(
  inner: number,
  outer: number,
  nu: number,
  sy: number,
  harmonic = 2,
): number {
  apertureGuards(inner, outer, nu, harmonic, "harmonicCarryingChord");
  if (!Number.isFinite(sy)) throw new Error(`harmonicCarryingChord: sy must be finite, got ${sy}`);
  const across = outer * outer - sy * sy;
  if (across <= 0) return 0;
  const half = Math.sqrt(across);
  const hole = inner * inner - sy * sy;
  // Above the hole the chord is one interval through the axis; inside it, two.
  const chord: [number, number][] =
    hole <= 0
      ? [[-half, half]]
      : [
          [-half, -Math.sqrt(hole)],
          [Math.sqrt(hole), half],
        ];
  const radial = 1 - sy * sy;
  if (radial <= 0) return 0;
  const reach = Math.sqrt(radial);
  // Only the m whose interval can meet the chord at all — the rest are empty
  // work, and the count is O((1 + outer)/ν) rather than a cap someone chose.
  const first = Math.floor((-reach - outer) / nu) - 1;
  const last = Math.ceil((reach + outer) / nu) + 1;
  let carried = 0;
  for (let m = first; m <= last; m++) {
    const lo = -reach - m * nu;
    const hi = reach - (m + harmonic) * nu;
    if (!(hi > lo)) continue;
    for (const [c0, c1] of chord) {
      const from = Math.max(c0, lo);
      const to = Math.min(c1, hi);
      if (to > from) carried += to - from;
    }
  }
  // The intervals for consecutive m overlap once (h+1)·ν ≤ 2R, so the sum above
  // can double-count; the union is then the whole line and the row is full.
  const chordLength = chord.reduce((sum, [c0, c1]) => sum + (c1 - c0), 0);
  return Math.min(carried, chordLength);
}

/**
 * Every row where the row's description changes, so that no panel straddles one.
 *
 * Four of them are the ones a reader would name: |s_y| = inner, where the chord
 * stops being one interval; |s_y| = 1, where the pupil runs out (which is inside
 * a darkfield ring, not at its edge); and the two radii where the order
 * intervals empty (2R = h·ν) and where they close their gaps (2R = (h+1)·ν).
 *
 * **Those are not enough, and the failure is quiet.** The rest are the rows
 * where an order-interval endpoint crosses a chord endpoint — a stripe entering
 * or leaving the aperture. Between two of those the integrand is a fixed
 * algebraic expression and Gauss–Kronrod is exact on it to roundoff; across one,
 * the pair can agree on a value they have both missed, because a stripe narrower
 * than the node spacing contributes nothing at any of the fifteen nodes and the
 * error estimate is then **zero**. Measured on a 0.999–1.001 ring: 0.11700
 * against a true 0.11656, 2.4e-4 high, with the quadrature reporting
 * convergence. Adaptivity cannot rescue that — it refines where it sees
 * disagreement, and there is none to see.
 *
 * The crossings are not a search. An interval endpoint is ±R − m·ν with
 * R = √(1 − s_y²) and a chord endpoint is ±√(a − s_y²) with a = outer² or
 * inner², so in y = s_y² each crossing solves ±√(1 − y) + c = ±√(a − y) for the
 * offset c the order index contributes. Squaring twice gives
 *
 *     y = (4a − K²) / (4c²),   K = 1 + a − c²
 *
 * — one root per (radius, m, endpoint), independent of both signs, which is why
 * the sign pairs are not enumerated. Roots outside the aperture are dropped and
 * spurious ones cost only an extra panel boundary, so the list is allowed to be
 * generous.
 */
function carryingRowEdges(inner: number, outer: number, nu: number, harmonic: number): number[] {
  const edges = new Set<number>([0, outer]);
  const add = (value: number) => {
    if (Number.isFinite(value) && value > 0 && value < outer) edges.add(value);
  };
  add(inner);
  add(1);
  for (const gap of [harmonic * nu, (harmonic + 1) * nu]) {
    const squared = 1 - (gap / 2) * (gap / 2);
    if (squared > 0) add(Math.sqrt(squared));
  }
  for (const radius of inner > 0 ? [outer, inner] : [outer]) {
    const a = radius * radius;
    const last = Math.ceil((1 + radius) / nu) + 2;
    for (let m = -last; m <= last; m++) {
      for (const c of [-m * nu, -(m + harmonic) * nu]) {
        if (c === 0) continue;
        const k = 1 + a - c * c;
        const y = (4 * a - k * k) / (4 * c * c);
        if (y >= 0 && y <= a) add(Math.sqrt(y));
      }
    }
  }
  return [...edges].sort((first, second) => first - second);
}

/**
 * The rows between two radii, integrated in the angle that flattens the square
 * root at whichever edge is in play.
 *
 * `scale` is the radius whose edge this piece runs into: s_y = scale·sin φ, so
 * the chord's √(scale² − s_y²) becomes scale·cos φ and the Jacobian supplies the
 * other factor of cos. Both edges of an annulus are square-root **cusps** in s_y
 * — the outer one at the aperture's rim, the inner one where the hole's edge
 * enters the chord — and bisection converges on a cusp more slowly than the error
 * budget shrinks, so neither can be left in. Split at |s_y| = inner and each
 * piece has exactly one, at its own end, where its own substitution removes it.
 */
function carryingRowsBetween(
  inner: number,
  outer: number,
  nu: number,
  harmonic: number,
  rows: number[],
  scale: number,
): number {
  const angles = [...new Set(rows.map((sy) => Math.asin(Math.min(1, sy / scale))))].sort(
    (first, second) => first - second,
  );
  let total = 0;
  for (let i = 0; i + 1 < angles.length; i++) {
    total += adaptiveIntegral(
      (angle) =>
        harmonicCarryingChord(inner, outer, nu, scale * Math.sin(angle), harmonic) *
        scale *
        Math.cos(angle),
      angles[i]!,
      angles[i + 1]!,
      { tolerance: 1e-12 },
    );
  }
  return total;
}

/** What `harmonicCarryingArea` reports: an area, and the fraction it is of. */
export interface HarmonicCarryingArea {
  /** Carrying area, in the s² units the aperture radii are given in. */
  readonly area: number;
  /** That area over the aperture's own — what the sampled weight estimates. */
  readonly fraction: number;
}

/**
 * The **area** of the aperture that carries `harmonic`·ν, and its fraction of
 * the whole — the quantitative form of `apertureCarriesHarmonic`.
 *
 * `harmonicSupportWeight` returns the fraction of a *sampled* source's weight
 * that carries the harmonic, and `annularSource`/`diskSource` weight their
 * points equally over equal-area cells, so that weight is a midpoint estimate of
 * exactly this number. Until § 6ab.14 there was nothing to compare it against:
 * § 6ab.12 could say the gate was not conservative (positive weight and zero
 * weight are thirteen orders apart in the rendered harmonic) but not whether a
 * given lattice *resolves* the carrying set, which is the difference between
 * "there is a second harmonic" and "this reading of it is worth its digits".
 *
 * Integrated row by row over `harmonicCarryingChord`, which is where the
 * exactness lives. The rows are even in s_y, so half the range is integrated and
 * doubled; every row where the row's description changes is split at rather than
 * discovered (`carryingRowEdges`, and the four such rows a reader would name are
 * *not* enough); and the two pieces either side of |s_y| = inner are each
 * integrated in their own angle (`carryingRowsBetween`), because both edges of
 * an annulus are square-root cusps and a cusp is what this quadrature cannot
 * afford. The annulus 0.3–0.5 at ν = 0.4 — an aperture that carries everywhere,
 * the easiest case there is — ran out of bisections before that split; after it,
 * nothing in a 1 345-case sweep bisects more than twice.
 *
 * **Zero is exact and 1 is not.** Where no row carries, every integrand
 * evaluation is exactly 0 and so is the sum — so this agrees with
 * `apertureCarriesHarmonic` as a predicate rather than approximately (measured
 * over 3 200 aperture/ν combinations, no disagreement, and the smallest nonzero
 * fraction anywhere in that sweep is 2.9e-4 — there is no ambiguous band). A
 * full aperture instead reads 1 to the tolerance, because the integral is then
 * the aperture's own area and has to be got by quadrature like anything else.
 */
export function harmonicCarryingArea(
  inner: number,
  outer: number,
  nu: number,
  harmonic = 2,
): HarmonicCarryingArea {
  apertureGuards(inner, outer, nu, harmonic, "harmonicCarryingArea");
  const rows = carryingRowEdges(inner, outer, nu, harmonic);
  const half =
    (inner > 0
      ? carryingRowsBetween(
          inner,
          outer,
          nu,
          harmonic,
          rows.filter((sy) => sy <= inner),
          inner,
        )
      : 0) +
    carryingRowsBetween(
      inner,
      outer,
      nu,
      harmonic,
      rows.filter((sy) => sy >= inner),
      outer,
    );
  const area = 2 * half;
  return { area, fraction: area / (Math.PI * (outer * outer - inner * inner)) };
}
