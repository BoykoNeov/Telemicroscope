import {
  annularSource,
  coherentSource,
  defocusedPupil,
  diskSource,
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

/** One canvas: an image formed at one defocus, and everything read off it. */
export interface PhaseFrame {
  readonly defocusWaves: number;
  /** Greyscale, RGBA, `size`×`size`. */
  readonly rgba: Uint8ClampedArray;
  /** Modulation at the grating's own bin — the null, when in focus. */
  readonly contrast: number;
  /** Modulation at 2ν — the second-order term, which is not null. */
  readonly secondHarmonic: number;
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
   */
  readonly besselCheck: { readonly measured: number; readonly closed: number } | null;
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
  readonly focused: PhaseFrame;
  readonly defocused: PhaseFrame;
  readonly elapsedMs: number;
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
): { frame: Omit<PhaseFrame, "rgba">; intensity: Float64Array } {
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
  const secondBin = 2 * request.cycles;
  const second =
    secondBin < request.size / 2
      ? imageHarmonic(out.intensity, request.size, secondBin).contrast
      : Number.NaN;

  const phaseTransfer = weakPhaseTransfer(pupil, source, nu);
  const besselCheck =
    threeOrderCheck(request, nu) && Number.isFinite(second)
      ? {
          measured: second * fundamental.dc,
          closed: 2 * besselJ1(request.amplitudeRadians) ** 2,
        }
      : null;

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
        focused: {
          ...focused.frame,
          rgba: toGrey(focused.intensity, request.size, displayWhite),
        },
        defocused: {
          ...defocused.frame,
          rgba: toGrey(defocused.intensity, request.size, displayWhite),
        },
        elapsedMs: performance.now() - started,
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
  points = 111,
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
      const nu = (i / (points - 1)) * 2.2;
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
