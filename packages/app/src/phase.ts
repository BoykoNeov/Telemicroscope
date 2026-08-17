import {
  annularSource,
  apertureCarriesHarmonic,
  coherentSource,
  defocusedPupil,
  diskSource,
  harmonicSupportWeight,
  idealPupil,
  imageHarmonic,
  phaseGratingObject,
  weakObjectTransfer,
  weakPhaseTransfer,
  type CondenserSource,
} from "@telemicroscope/core/illumination";
import { renderBrightfield, type PatchPupil } from "@telemicroscope/core/imaging";
import { besselJ1 } from "@telemicroscope/core/math";
import type { PupilFunction } from "@telemicroscope/core/wave";

/**
 * The phase null — APP.md's A3, as pure functions.
 *
 * A specimen that absorbs nothing. |t| = 1 everywhere, so a photographic plate
 * at the object plane sees a blank sheet, and § 6f's headline says a brightfield
 * microscope sees the same blank sheet: the two sidebands a phase grating
 * diffracts arrive in quadrature with the direct beam and 180° apart from each
 * other, so they cancel **identically**. It is the reason unstained cells are
 * invisible, the reason stains exist, and the reason Zernike got a Nobel prize
 * for putting a quarter-wave plate in the pupil.
 *
 * ## The panel is ideal-pupil on purpose, and that is not a shortcut
 *
 * Everything here runs on `idealPupil()`, never on a traced objective. APP.md is
 * explicit — *"this one is stronger on ideal pupils than traced ones, because
 * the null is exact there. Do not 'improve' it by tracing"* — and the reason is
 * that the null's precondition is a **real** pupil (no aberration) under a
 * **centro-symmetric** source. A traced objective has residual aberration, so
 * its null is not a null, it is a small number, and a small number cannot be
 * told from a bug. Since there is no objective there is also no honest µm scale,
 * so this module works in grid units and ν throughout and quotes no specimen
 * span; `abbeImage`'s `scale` is deliberately not supplied.
 *
 * ## What is actually on the screen, and it is not a blank canvas
 *
 * `phaseGratingObject` is **exact** — every Bessel order, not the weak-object
 * truncation — so the image is not empty. Writing t = Σ iⁿJₙ(φ)e^{inu} and
 * squaring, the ν bin (the 0×±1 beat) cancels and the **2ν bin (the +1×−1 beat)
 * does not**. So the honest statement is not "a phase object is invisible" but:
 *
 *   - the **linear** term at ν is identically zero — measured at **2.7e-15**,
 *     worst case over φ ∈ [0.1, 3.0], ν ∈ [0.25, 1.0], S ∈ [0, 1] and darkfield;
 *   - the **second-order** term at 2ν is O(φ²) and plainly visible;
 *   - `weakPhaseTransfer` — the linear term, which is what the plot draws —
 *     returns **bit-exact 0**, not a small number, over every S and ν sampled.
 *
 * That is a stronger claim than APP.md scoped ("no contrast at any S and any
 * frequency"), and a different one: what is null is the linear response, and the
 * panel shows the non-null that sits beside it at twice the frequency.
 *
 * ## The null does not care how strong the phase is
 *
 * The textbook statement is about a *weak* phase object. Measured, the ν bin
 * stays at f64 noise out to **φ = 3 radians**, where the object is nothing like
 * weak and the 2ν contrast has run up to 0.77. The φ slider is that experiment:
 * it is not a brightness dial, it is the control that fails to break the null.
 * φ = 0 is the clear field, which is also where darkfield reads exactly 0.
 *
 * ## And it does not care about darkfield either
 *
 * `weakPhaseTransfer`'s precondition is a source symmetric under s → −s, and an
 * annulus is symmetric too. So darkfield changes the *background* — the
 * undiffracted beam misses the objective entirely and a clear field goes to a
 * hard 0 — while the ν null survives it untouched. Only breaking the pupil's
 * realness breaks the null, and defocus is the cheapest way to do that.
 */

export type Illumination = "brightfield" | "darkfield";

/** The darkfield annulus, entirely outside the objective's pupil. */
export const DARKFIELD_OUTER = 1.4;
export const DARKFIELD_INNER = 1.1;

export interface PhaseRequest {
  /** Grid size, a power of two. Also the headroom the shifted pupil needs. */
  readonly size: number;
  /** Frequency bins across the pupil diameter — the scale, as in `wave/psf`. */
  readonly pupilSamples: number;
  /** Condenser lattice points across the source DIAMETER. */
  readonly sourceSamples: number;
  readonly illumination: Illumination;
  /** S = NA_cond / NA_obj. Brightfield only; darkfield uses the annulus. */
  readonly coherenceParameter: number;
  /** Grating periods across the grid. ν = 2·cycles/pupilSamples. */
  readonly cycles: number;
  /** Peak phase excursion φ, radians. 0 is the clear field. */
  readonly amplitudeRadians: number;
  /** w₂₀ in waves, for the second canvas. The first is always in focus. */
  readonly defocusWaves: number;
}

/**
 * The `sourceSamples` values the panel's own control offers.
 *
 * Exported and consumed by `panels/phase.tsx` rather than written out twice,
 * because `SamplingSpread` below is a claim about **this list** — an exhaustive
 * enumeration of what the reader can make the panel show, not a sample of some
 * continuum — and a copy that drifted from the control would turn it into a
 * sample without anyone noticing.
 */
export const PANEL_SOURCE_SAMPLES = [7, 11, 15, 21] as const;

/**
 * The 2ν reading at every source sampling this panel offers.
 *
 * § 6ab.10 found the panel printing a 2ν contrast to four significant figures
 * that is not converged, and left what to print about it open. This is the
 * answer, and the reason it can be answered without pinning a new number is the
 * scope: it does **not** estimate how far the reading is from the continuum. It
 * states what moving the panel's own source-samples control does to it. That
 * enumeration is complete — four options, all four rendered — so there is no
 * sampling error in it to bound.
 *
 * Two things that were measured and are why nothing here is a threshold:
 *
 * - **The bad region is not a band in S.** At ν = 1 exactly the reading is 9.4×
 *   uncertain at *every* S from 0.25 up, because the ±1 orders land on the pupil
 *   rim where the lattice's own in-or-out decision moves them (the same rim
 *   `threeOrderCheck` excludes ν = 1 for). At ν = 1.94 it is inside 1.05× at
 *   S = 1.5. And φ moves it as hard as either: at φ = 0.1, S = 1.5 spreads 838×
 *   where φ = 3 spreads 1.37×, since the 2ν signal grows as φ² and what
 *   disagrees does not. Any rule in S alone would refuse readings that are fine
 *   and print four digits on ones that are 9× out.
 * - **A cheaper probe lies.** Two samplings agreeing bounds nothing: 7-against-11
 *   reads 1.3× at S = 1 where 11-against-21 reads 9.7×, and at S = 1.25 the two
 *   swap (7.6× against 1.1×). Every three-of-four subset tried under-reports the
 *   four-way spread somewhere.
 *
 * `ratio` is `max/min` and is **exactly 1**, with no render at all, wherever
 * `sourceFor` ignores the count — see `samplingsThatMatter`. Nothing is
 * suppressed when the readings are f64 noise: at φ = 0 all four sit near 6e-17
 * and the range says so, in the same voice `worstNull` is printed in exponential
 * rather than as "0.0000".
 */
export interface SamplingSpread {
  /** One reading per option that the frequency grid could carry. */
  readonly readings: readonly { readonly samples: number; readonly value: number }[];
  readonly min: number;
  readonly max: number;
  /** `max/min`. Exactly 1 when the source does not depend on the count. */
  readonly ratio: number;
  /**
   * Options `abbeImage` would have refused, and why they are dropped rather than
   * clamped: the panel's S ceiling is computed from the count in force, and a
   * coarser lattice reaches further in S than a finer one (S·(1 − 1/N) is the
   * binding sample), so a reader at N = 7 can be at an S that N = 21 cannot
   * render. Dropping is the only honest option — a truncated pupil reads as a
   * smaller aperture, which would look like physics.
   */
  readonly skipped: readonly number[];
  /** Frames rendered for this, over and above the one the panel already had. */
  readonly extraFrames: number;
}

/** One canvas: an image formed at one defocus, and everything read off it. */
export interface PhaseFrame {
  readonly defocusWaves: number;
  /** Greyscale, RGBA, `size`×`size`. */
  readonly rgba: Uint8ClampedArray;
  /** Modulation at the grating's own bin — the null, when in focus. */
  readonly contrast: number;
  /** Modulation at 2ν — the second-order term, which is not null. */
  readonly secondHarmonic: number;
  /**
   * What `secondHarmonic` does across the panel's own source samplings. `null`
   * only when there is no reading to spread — 2ν off the grid.
   *
   * Per frame rather than once for the pair, because the two frames are not the
   * same quantity under an extended source. The module's "2ν is the same at
   * every defocus" is derived at S = 0, where one on-axis point puts the ±1
   * orders at equal pupil radius so the defocus phase cancels; off axis the beat
   * picks up w₂₀(|s + ν|² − |s − ν|²) = 4·w₂₀·(s·ν), which vanishes for no
   * off-axis point. Measured at S = 0.9, ν = 0.75: 5.87e-3 in focus against
   * 6.64e-4 at w₂₀ = 1 and 1.57e-2 at 6, where S = 0 holds 7.691302e-2 at every
   * one of them. The spreads differ with it — 1.2× in focus at S = 0.5 against
   * 13.4× at w₂₀ = 3 — so one probe could not have covered both.
   */
  readonly secondHarmonicSpread: SamplingSpread | null;
  /** `NaN` when 2ν does not fit the grid; never an aliased reading. */
  readonly meanIntensity: number;
  /** `weakPhaseTransfer` at ν through this frame's own pupil. */
  readonly phaseTransfer: number;
  /** 2·φ·T — the weak-phase prediction for `contrast`. */
  readonly weakPrediction: number;
  /**
   * `contrast(2ν)·mean` against 2·J₁(φ)², in the coherent three-order regime —
   * `null` outside it, never a comparison that does not apply. See
   * `threeOrderCheck`.
   *
   * `residual` is carried rather than left for the reader to diff two 9-digit
   * numbers by eye, and it is not decoration: the agreement is **not** the flat
   * ~1e-14 the middle of the regime suggests. Measured over every (cycles, φ)
   * the panel's own sliders can reach, it is 1e-16..1e-14 almost everywhere and
   * reaches **6.1e-10** at ν = 0.8125 with φ = 3 — and it is not monotone in ν
   * either, since ν = 0.9375 at the same φ reads 2.6e-15. Which lattice samples
   * the ±1 orders land on is what moves it. A panel that printed "~1e-14" in
   * prose and left the check to the eye would be overclaiming by four orders at
   * a setting two slider drags away, so the number is on screen instead.
   */
  readonly besselCheck: {
    readonly measured: number;
    readonly closed: number;
    readonly residual: number;
  } | null;
  readonly verdict: "valid" | "unknown" | "no-honest-image";
  readonly verdictReason: string;
  readonly contributingPoints: number;
  /** The guard the defocus slider walks into: half a wave and the grid is lost. */
  readonly maxGridPhaseStepWaves: number;
}

export interface PhaseReadout {
  readonly size: number;
  /** ν = 2·cycles/pupilSamples, in units of NA/λ. */
  readonly nu: number;
  readonly sourcePoints: number;
  /**
   * The intensity that maps to white, shared by BOTH frames — so the pair is one
   * comparison and not two independently stretched pictures. Printed, because a
   * darkfield frame's own mean is ~50× below a brightfield one's and normalizing
   * to it would silently apply 50× of gain to a picture whose whole content is
   * that it is dark.
   */
  readonly displayWhite: number;
  /**
   * Whether either frame's 2ν reading is a reading of anything.
   *
   * On the readout and not on the frame, which is the whole difference between
   * this and `secondHarmonicSpread`: support is geometry, so one answer covers
   * both frames, where the spread needed a probe per frame because the beat is
   * not defocus-invariant off axis.
   */
  readonly secondHarmonicSupport: HarmonicSupport;
  readonly focused: PhaseFrame;
  readonly defocused: PhaseFrame;
  /** The pair, and the convergence probes below — everything this call did. */
  readonly elapsedMs: number;
  /**
   * The `SamplingSpread` share of `elapsedMs`, split out rather than folded in
   * silently: the panel used to print one number labelled "for the pair", and a
   * label that stayed while extra renders were added underneath it would be the
   * same kind of quiet overclaim this whole change is about. Zero at S = 0
   * brightfield, where the probe needs no render.
   */
  readonly checkMs: number;
  /** Frames rendered for the probes, across both frames of the pair. */
  readonly checkFrames: number;
}

export type PhaseResult =
  | { readonly ok: true; readonly readout: PhaseReadout }
  | { readonly ok: false; readonly error: string };

export interface PhaseJob {
  readonly seq: number;
  readonly request: PhaseRequest;
}

export interface PhaseDone {
  readonly seq: number;
  readonly result: PhaseResult;
}

/** ν = 2·cycles/pupilSamples — `phaseGratingObject`'s bridge into NA/λ. */
export function frequencyOf(cycles: number, pupilSamples: number): number {
  return (2 * cycles) / pupilSamples;
}

/**
 * The largest |s| component the frequency grid can carry a shifted pupil to.
 *
 * `abbeImage` throws rather than truncate — a clipped pupil reads as a smaller
 * aperture, which would look like physics — so callers have to know where the
 * wall is. A2 derives the same wall as a formula in S; here the source is
 * checked point by point against it instead, because a darkfield annulus's
 * outermost lattice point is at a radius no formula in S describes.
 */
export function gridReach(size: number, pupilSamples: number): number {
  return (size - 2) / pupilSamples - 1;
}

/** Does every direction this source holds still fit the frequency grid? */
export function sourceFits(source: CondenserSource, size: number, pupilSamples: number): boolean {
  const reach = gridReach(size, pupilSamples);
  for (const p of source.points) {
    if (Math.max(Math.abs(p.sx), Math.abs(p.sy)) > reach) return false;
  }
  return true;
}

/** The darkfield annulus at this sampling — built once so it can be measured. */
export function darkfieldSource(samples: number): CondenserSource {
  return annularSource(DARKFIELD_OUTER, DARKFIELD_INNER, samples);
}

/**
 * The condenser this request asks for.
 *
 * S = 0 takes `coherentSource` rather than `diskSource(0, N)`, which would
 * collapse every lattice point onto the origin and pay N² transforms for the
 * one-point coherent limit — and the coherent limit is exactly where the closed
 * form below applies, so this panel reaches it often.
 */
export function sourceFor(
  request: Pick<PhaseRequest, "illumination" | "coherenceParameter" | "sourceSamples">,
): CondenserSource {
  if (request.illumination === "darkfield") return darkfieldSource(request.sourceSamples);
  return request.coherenceParameter === 0
    ? coherentSource()
    : diskSource(request.coherenceParameter, request.sourceSamples);
}

/**
 * Which of the panel's source samplings are distinct sources here.
 *
 * At S = 0 in brightfield `sourceFor` returns `coherentSource()` whatever the
 * count, so the four options are one source and the spread is exactly 1 — not
 * approximately, and not after three renders. Verified bit-identical rather than
 * assumed: 0.07691301586554729 from both the 7 and the 21 branch. This is a read
 * of `sourceFor`'s own condition rather than a second copy of it, so the two
 * cannot drift apart, and it is why the panel's default state pays nothing.
 *
 * Darkfield gets no such shortcut: `annularSource` masks the same lattice, so
 * the ring's point count and placement both move with the count — 16 points at
 * N = 7 against 128 at 21 — and that turns out to matter more here than anywhere
 * in brightfield.
 */
export function samplingsThatMatter(
  request: Pick<PhaseRequest, "illumination" | "coherenceParameter" | "sourceSamples">,
): readonly number[] {
  return request.illumination === "brightfield" && request.coherenceParameter === 0
    ? [request.sourceSamples]
    : PANEL_SOURCE_SAMPLES;
}

/**
 * Whether the 2ν reading is a reading of anything — the gate § 6ab.12 added.
 *
 * `SamplingSpread` below reports what the source-samples control does to the
 * number. It cannot report that there is no number: four readings of nothing
 * agree, and at ν = 1.9375 they agreed to **1.031×**, the tightest agreement
 * anywhere in this panel. So the prior question is asked separately, and it is
 * geometry rather than a probe — the 2ν term is a beat between grating orders
 * two apart, which sit 2ν apart in the pupil, so it exists only if some
 * illuminated direction puts both of them inside it.
 *
 * Both legs are carried rather than collapsed to a verdict, because the two
 * failures are different stories and the numbers are the interesting part: at
 * ν = 1 the lattice has ~1% of its weight on a set the aperture has no *area* of
 * and reads 8e-4, where at ν = 1.9375 both legs are zero and the reading is f64
 * roundoff. `besselCheck` is the precedent — a measured number, not a ruling.
 */
export interface HarmonicSupport {
  /**
   * Does the *aperture* carry 2ν, on a set of directions of positive area?
   * `null` at S = 0, where the source is one direction and not a discretization
   * of an aperture — there `latticeWeight` is the whole truth.
   */
  readonly apertureCarries: boolean | null;
  /** Fraction of the *sampled* source's weight whose orders can carry 2ν. */
  readonly latticeWeight: number;
  /** Both legs agree there is something to read. The gate. */
  readonly exists: boolean;
  /** Why not, when it does not. Empty when it does. */
  readonly reason: string;
}

/**
 * The support of this request's 2ν reading — one computation for both frames.
 *
 * Defocus-free on purpose, and that is the contrast with `SamplingSpread`, which
 * needed a probe per frame: `idealPupil` and `defocusedPupil` are the same disc,
 * so *existence* is the same question in and out of focus even though the
 * *magnitude* is not (§ 6ab.11 measured the beat picking up 4·w₂₀·(s·ν) off
 * axis). Geometry does not care about the wavefront; the reading does.
 */
export function secondHarmonicSupport(request: PhaseRequest): HarmonicSupport {
  const nu = frequencyOf(request.cycles, request.pupilSamples);
  const source = sourceFor(request);
  const orders = { cycles: request.cycles, pupilSamples: request.pupilSamples, harmonic: 2 };
  const latticeWeight = harmonicSupportWeight(idealPupil(), source, orders);
  // S = 0 in brightfield is `coherentSource`'s single direction, which is not a
  // sampling of anything — `apertureCarriesHarmonic` refuses it rather than
  // answering, so the aperture leg is skipped instead of being given a radius it
  // does not have.
  const extended = request.illumination === "darkfield" || request.coherenceParameter > 0;
  const apertureCarries = extended
    ? apertureCarriesHarmonic(
        request.illumination === "darkfield" ? DARKFIELD_INNER : 0,
        request.illumination === "darkfield" ? DARKFIELD_OUTER : request.coherenceParameter,
        nu,
      )
    : null;

  if (apertureCarries === false) {
    // The condenser itself has no 2ν to give. Brightfield stops at ν = 1 because
    // 2ν must clear the incoherent cutoff 2; the darkfield ring stops at
    // (1 + outer)/3 = 0.8, three slider stops earlier, which is the part a reader
    // has no way to guess.
    const cutoff =
      request.illumination === "darkfield" ? (1 + DARKFIELD_OUTER) / 3 : 1;
    return {
      apertureCarries,
      latticeWeight,
      exists: false,
      reason:
        `no 2ν at ν = ${nu.toFixed(4)}: two orders 2ν apart cannot both be inside the pupil from ` +
        `anywhere in this condenser, which carries 2ν only below ν = ${cutoff.toFixed(4)}` +
        (request.illumination === "darkfield"
          ? ` — (1 + ${DARKFIELD_OUTER})/3 for this annulus, below brightfield's 1`
          : " — where 2ν reaches the incoherent cutoff 2"),
    };
  }
  if (latticeWeight === 0) {
    return {
      apertureCarries,
      latticeWeight,
      exists: false,
      reason:
        `no direction in this ${source.points.length}-point source can carry 2ν, though the ` +
        `aperture it samples does — raise source samples`,
    };
  }
  return { apertureCarries, latticeWeight, exists: true, reason: "" };
}

/**
 * Is this configuration in the regime where the 2ν term has a closed form?
 *
 * Under **one** on-axis plane wave, exactly three diffracted orders reach the
 * image when 0.5 < ν < 1 — order 0 and ±1, with ±2 already outside the pupil.
 * Squaring iJ₀ + iJ₁(e^{iu} + e^{-iu}) gives an image whose mean is J₀² + 2J₁²
 * and whose 2ν amplitude is 2J₁², so
 *
 *     contrast(2ν) · mean = 2·J₁(φ)²
 *
 * with **no free parameter** — and no J₀, which matters because the engine has
 * `besselJ1` (pinned in § 6g.2) and no J₀ at all. Multiplying by the measured
 * mean instead of dividing by a computed one is what keeps this a check against
 * an external number rather than a fit.
 *
 * Measured, it holds to **~1e-14** across φ ∈ [0.2, 3.0], and — the striking
 * part — **at every defocus**, because defocus is a pure phase and orders +1 and
 * −1 sit at the same pupil radius, so the beat that makes 2ν picks up no phase
 * difference at all. The ν term meanwhile swings from 0 to 0.74. One slider,
 * two terms, and only one of them moves.
 *
 * The regime ends where the algebra says: at ν ≤ 0.5 order ±2 gets through
 * (measured error 99%), and at S ≥ 0.2 the source is no longer one plane wave
 * (25% at S = 0.2, 70% at S = 0.4). ν = 1 exactly is excluded too — the ±1
 * orders land on the pupil rim, where the lattice's own in-or-out decision
 * shows up as 2.6e-8 rising to 1.5e-2 at φ = 3.
 */
export function threeOrderCheck(request: PhaseRequest, nu: number): boolean {
  return (
    request.illumination === "brightfield" &&
    request.coherenceParameter === 0 &&
    nu > 0.5 &&
    nu < 1
  );
}

/**
 * Greyscale on a scale the CALLER fixes, so a pair shares one.
 *
 * A2 normalizes each frame to its own mean, which is right for a panel showing
 * one image. Here two images are the claim, and per-frame normalization would
 * quietly rescale them against each other — worst for darkfield, whose mean is
 * ~50× below brightfield's and whose whole content is that it is dark.
 */
function toGrey(intensity: Float64Array, size: number, white: number): Uint8ClampedArray {
  const rgba = new Uint8ClampedArray(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    const v = Math.round((255 * intensity[i]!) / white);
    rgba[i * 4] = v;
    rgba[i * 4 + 1] = v;
    rgba[i * 4 + 2] = v;
    rgba[i * 4 + 3] = 255;
  }
  return rgba;
}

/** The 2ν bin, or `NaN` when it is off the grid. Shared by frame and probe. */
function secondHarmonicOf(intensity: Float64Array, request: PhaseRequest): number {
  const secondBin = 2 * request.cycles;
  return secondBin < request.size / 2
    ? imageHarmonic(intensity, request.size, secondBin).contrast
    : Number.NaN;
}

/**
 * Render one probe frame — the 2ν bin and nothing else.
 *
 * Deliberately not `formFrame`: the probe needs one number off one image, and
 * the transfer, the weak-phase prediction and the Bessel comparison are all
 * about the frame the panel is actually showing. Computing them for a sampling
 * the reader did not select would be work spent on numbers with nowhere to go.
 */
function probeSecondHarmonic(
  request: PhaseRequest,
  source: CondenserSource,
  defocusWaves: number,
): number {
  const object = phaseGratingObject({
    size: request.size,
    cycles: request.cycles,
    amplitudeRadians: request.amplitudeRadians,
  });
  const pupil: PupilFunction = defocusWaves === 0 ? idealPupil() : defocusedPupil(defocusWaves);
  const out = renderBrightfield(object, (): PatchPupil => ({ pupil }), source, {
    pupilSamples: request.pupilSamples,
    patches: 1,
  });
  return secondHarmonicOf(out.intensity, request);
}

/**
 * The 2ν reading across every source sampling the panel offers, at one defocus.
 *
 * `shipped` is the reading the panel already has, passed in rather than
 * re-rendered — the shipped sampling is always one of the four, so the probe is
 * three frames and not four.
 */
export function samplingSpread(
  request: PhaseRequest,
  defocusWaves: number,
  shipped: number,
): SamplingSpread | null {
  if (!Number.isFinite(shipped)) return null;
  // No spread over a quantity that does not exist — § 6ab.12. This is the one
  // place the gate is applied rather than at the call sites, because the probe is
  // the misleading part: at ν = 1.9375 the four readings agree to 1.031× and that
  // is the tightest number this panel ever prints. It also saves the three
  // renders, which were being spent comparing roundoff.
  if (!secondHarmonicSupport(request).exists) return null;

  const readings: { samples: number; value: number }[] = [];
  const skipped: number[] = [];
  let extraFrames = 0;

  for (const samples of samplingsThatMatter(request)) {
    if (samples === request.sourceSamples) {
      readings.push({ samples, value: shipped });
      continue;
    }
    const source = sourceFor({ ...request, sourceSamples: samples });
    if (!sourceFits(source, request.size, request.pupilSamples)) {
      skipped.push(samples);
      continue;
    }
    readings.push({ samples, value: probeSecondHarmonic(request, source, defocusWaves) });
    extraFrames++;
  }

  const values = readings.map((r) => r.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  // `max === min` first, and not as an optimization: `imageHarmonic` returns a
  // hard 0 when the mean is 0, which is darkfield on a clear field — every
  // sampling agreeing on exactly zero. Testing `min === 0` first would call that
  // an infinite disagreement, which is the opposite of what happened.
  const ratio = max === min ? 1 : min === 0 ? Number.POSITIVE_INFINITY : max / min;
  return { readings, min, max, ratio, skipped, extraFrames };
}

/**
 * Form one image at one defocus and read the two harmonics off it.
 *
 * `renderBrightfield` at `patches` = 1 rather than `abbeImage` directly: it is
 * the same single transform per source point, and it carries § 6f.9's verdict
 * and the two sampling counts, which A2 already shows and this panel should not
 * re-derive by hand.
 */
function formFrame(
  request: PhaseRequest,
  source: CondenserSource,
  defocusWaves: number,
): { frame: Omit<PhaseFrame, "rgba" | "secondHarmonicSpread">; intensity: Float64Array } {
  const object = phaseGratingObject({
    size: request.size,
    cycles: request.cycles,
    amplitudeRadians: request.amplitudeRadians,
  });
  const pupil: PupilFunction =
    defocusWaves === 0 ? idealPupil() : defocusedPupil(defocusWaves);
  const patch = (): PatchPupil => ({ pupil });

  const out = renderBrightfield(object, patch, source, {
    pupilSamples: request.pupilSamples,
    patches: 1,
  });

  const nu = frequencyOf(request.cycles, request.pupilSamples);
  const fundamental = imageHarmonic(out.intensity, request.size, request.cycles);
  // 2ν only exists on the grid while it fits inside it. `maxCycles` in the panel
  // keeps it there, and this stays as the second line of defence: an aliased
  // reading reported as the second-order term would be inventing the exact thing
  // the panel claims to have measured.
  const second = secondHarmonicOf(out.intensity, request);

  const phaseTransfer = weakPhaseTransfer(pupil, source, nu);
  // The nine decimals below need no spread of their own and are not being
  // overlooked: `threeOrderCheck` requires `coherenceParameter === 0`, which is
  // the one source point where every sampling gives the same image bit for bit.
  // Where this comparison exists there is nothing for the count to move.
  const besselCheck = (() => {
    if (!threeOrderCheck(request, nu) || !Number.isFinite(second)) return null;
    const measured = second * fundamental.dc;
    const closed = 2 * besselJ1(request.amplitudeRadians) ** 2;
    return { measured, closed, residual: Math.abs(measured - closed) };
  })();

  return {
    intensity: out.intensity,
    frame: {
      defocusWaves,
      contrast: fundamental.contrast,
      secondHarmonic: second,
      meanIntensity: fundamental.dc,
      phaseTransfer,
      weakPrediction: 2 * request.amplitudeRadians * phaseTransfer,
      besselCheck,
      verdict: out.fidelity.verdict,
      verdictReason: out.fidelity.reason,
      contributingPoints: out.contributingPoints,
      maxGridPhaseStepWaves: out.maxGridPhaseStepWaves,
    },
  };
}

/** Display convention: white is twice the in-focus frame's own mean. */
export const WHITE_OVER_MEAN = 2;

/**
 * Both images of the pair, in one call.
 *
 * One job rather than two, and not for speed: the panel's claim is a
 * *comparison*, and two independently scheduled renders can transiently show an
 * in-focus frame at one φ beside a defocused one at another while a slider is
 * moving. A pair that disagrees about its own object is a picture of nothing.
 *
 * Measured under `vite-node` at pupilSamples 32, grid 128 and an 11-point
 * condenser: **146 ms for the pair**, rising to 503 ms at 21 points and 827 ms
 * at grid 256 with pupilSamples 64. A2's browser figure ran ~2.8× its node
 * figure, so the default here is the 146 ms corner.
 *
 * ## The convergence probes, and what they cost
 *
 * Each frame's 2ν reading is also taken at every *other* source sampling the
 * panel offers, so the panel can say what its own control does to the number
 * rather than printing four digits of it — see `SamplingSpread`. The cost is
 * near enough **fixed**, since the probe always renders the three options the
 * reader did not pick: ~660 source points minus whichever one is already on
 * screen, doubled when the defocused frame is a distinct image.
 *
 * It is **free in the panel's default state** — S = 0 puts every sampling on the
 * same one-point source, so `samplingsThatMatter` returns a single entry and no
 * probe frame is rendered at all.
 */
export function renderPhaseScene(request: PhaseRequest): PhaseResult {
  const started = performance.now();
  try {
    const source = sourceFor(request);
    const focused = formFrame(request, source, 0);
    const defocused =
      request.defocusWaves === 0
        ? focused
        : formFrame(request, source, request.defocusWaves);

    const support = secondHarmonicSupport(request);
    const checkStarted = performance.now();
    const focusedSpread = samplingSpread(request, 0, focused.frame.secondHarmonic);
    // Reused rather than re-probed when the pair is one image, for the same
    // reason `defocused` is: it would be the identical render.
    const defocusedSpread =
      request.defocusWaves === 0
        ? focusedSpread
        : samplingSpread(request, request.defocusWaves, defocused.frame.secondHarmonic);
    const checkMs = performance.now() - checkStarted;

    // One scale for both frames, taken from the in-focus mean. The fallback
    // matters: darkfield on a clear object has a mean of exactly 0, and dividing
    // by it would turn a hard zero into NaN and paint the null white.
    const mean = focused.frame.meanIntensity;
    const displayWhite = mean > 0 ? WHITE_OVER_MEAN * mean : 1;

    return {
      ok: true,
      readout: {
        size: request.size,
        nu: frequencyOf(request.cycles, request.pupilSamples),
        sourcePoints: source.points.length,
        displayWhite,
        secondHarmonicSupport: support,
        focused: {
          ...focused.frame,
          secondHarmonicSpread: focusedSpread,
          rgba: toGrey(focused.intensity, request.size, displayWhite),
        },
        defocused: {
          ...defocused.frame,
          secondHarmonicSpread: defocusedSpread,
          rgba: toGrey(defocused.intensity, request.size, displayWhite),
        },
        elapsedMs: performance.now() - started,
        checkMs,
        checkFrames:
          (focusedSpread?.extraFrames ?? 0) +
          (defocusedSpread === focusedSpread ? 0 : (defocusedSpread?.extraFrames ?? 0)),
      },
    };
  } catch (cause) {
    // `abbeImage`'s frequency-grid wall lands here, and it names the grid size
    // that would fix it. The panel clamps ahead of it and still shows this,
    // because a clamp derived from a formula is a claim and the engine's own
    // refusal is the check on it.
    return { ok: false, error: (cause as Error).message };
  }
}

export interface TransferPoint {
  readonly nu: number;
  /** `weakPhaseTransfer` on an unaberrated pupil — the null. */
  readonly phaseFocused: number;
  /** The same, defocused by w₂₀ — the null broken. */
  readonly phaseDefocused: number;
  /** `weakObjectTransfer` in focus — what an *absorbing* object would get. */
  readonly absorption: number;
}

/**
 * The share of the source's weight that lands *inside* the objective's pupil —
 * Σw·|P(s)|², which is the denominator every transfer function in
 * `illumination/transfer` normalizes by.
 *
 * **Zero in darkfield**, by construction: the annulus lies wholly outside the
 * pupil, so no illuminating beam enters it. That is not a detail. Both
 * `weakObjectTransfer` and `weakPhaseTransfer` guard the division and return 0
 * when it happens, so in darkfield **all three curves of A3's plot read flat
 * zero** — including the absorption one, which is emphatically not a statement
 * that darkfield transfers no contrast. It transfers plenty; the image has
 * structure at 2ν and the panel measures it. What has gone to zero is the
 * quantity the transfer is a ratio *to*.
 *
 * So the plot is a picture of 0/0 there and the panel must say so rather than
 * draw three flat lines beside a paragraph about a null. A2's `latticeReach`
 * called this case out in advance — *"`annularSource` with an inner radius past
 * 1 is exactly that set, it is how darkfield works, and A3 is the panel that
 * asks for it"* — and named the same failure: printing 0 for a quantity that is
 * undefined states something false with more conviction than printing nothing.
 */
export function directBeamFraction(pupil: PupilFunction, source: CondenserSource): number {
  let sum = 0;
  for (const s of source.points) {
    const a = pupil.amplitude(s.sx, s.sy);
    sum += s.weight * a * a;
  }
  return sum;
}

export interface TransferSweep {
  readonly points: readonly TransferPoint[];
  /**
   * `directBeamFraction` for this source. When it is 0 the three curves below
   * are 0/0 and the caller must not draw them as measurements.
   */
  readonly directBeam: number;
  /**
   * Largest `phaseFocused` over the sweep. The null, as one number, in the
   * notation it deserves — printing it as "0.0000" would be a rounding, and
   * autoscaling a plot to it would draw f64 noise as a signal.
   */
  readonly worstNull: number;
  readonly elapsedMs: number;
}

export type TransferResult =
  | { readonly ok: true; readonly sweep: TransferSweep }
  | { readonly ok: false; readonly error: string };

/** The frequency axis the sweep runs over: 0 to just past the incoherent cutoff. */
const NU_MAX = 2.2;

/** Samples per lobe of the defocused transfer's oscillation, at its finest. */
const SAMPLES_PER_LOBE = 8;

/**
 * How many frequencies the sweep needs, given how hard the pupil is oscillating.
 *
 * At S = 0 the defocused phase transfer is exactly |sin(2π·w₂₀·ν²)| for ν ≤ 1
 * (measured to 1e-14), so its lobes get *narrower* with both w₂₀ and ν, and the
 * tightest are at ν = 1 with width 1/(4·w₂₀). A fixed 111 samples over
 * [0, 2.2] is 50 per lobe at a quarter wave and **2.08 at six**, which is where
 * the defocus slider ends — so the rightmost lobes would be drawn from two
 * points each and the picture would be of the sampling rather than of the
 * transfer.
 *
 * `plot.tsx` is the argument against shipping that: it refuses to interpolate
 * or fit *because* a smoothed curve through measured points draws a claim
 * rather than the claim. Joining an undersampled oscillation with straight
 * lines is the same error facing the other way, and the grid-step guard does
 * not cover it — that one is about the image's pupil sampling, a different
 * quantity from the plot's ν sampling.
 *
 * So the sample count follows the defocus. Measured cost at 441 samples: 0.2 ms
 * at S = 0 (where the fine sampling is actually needed, since one source point
 * means one pupil evaluation) and 20.7 ms at S = 1 with a 349-point condenser.
 * Both are far inside the deferral this runs behind.
 */
export function sweepSamples(defocusWaves: number): number {
  const perLobe = NU_MAX * 4 * SAMPLES_PER_LOBE * defocusWaves;
  return Math.max(111, Math.min(1201, Math.ceil(perLobe)));
}

/**
 * The transfer against ν — the plot half of the pair.
 *
 * Three curves and the point is the flat one. Cheap enough for the main thread
 * behind a deferral, as A2's sweep is: three pupil evaluations per source point
 * per sample, no transform anywhere.
 */
export function transferSweep(
  request: Pick<
    PhaseRequest,
    | "size"
    | "pupilSamples"
    | "sourceSamples"
    | "illumination"
    | "coherenceParameter"
    | "defocusWaves"
  >,
  points = sweepSamples(request.defocusWaves),
): TransferResult {
  const started = performance.now();
  try {
    const source = sourceFor(request);
    const flat = idealPupil();
    const blurred =
      request.defocusWaves === 0 ? flat : defocusedPupil(request.defocusWaves);

    const out: TransferPoint[] = [];
    let worstNull = 0;
    for (let i = 0; i < points; i++) {
      const nu = (i / (points - 1)) * NU_MAX;
      const phaseFocused = weakPhaseTransfer(flat, source, nu);
      worstNull = Math.max(worstNull, phaseFocused);
      out.push({
        nu,
        phaseFocused,
        phaseDefocused: weakPhaseTransfer(blurred, source, nu),
        absorption: weakObjectTransfer(flat, source, nu),
      });
    }
    return {
      ok: true,
      sweep: {
        points: out,
        worstNull,
        directBeam: directBeamFraction(flat, source),
        elapsedMs: performance.now() - started,
      },
    };
  } catch (cause) {
    return { ok: false, error: (cause as Error).message };
  }
}
