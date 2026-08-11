import { cosineGratingObject, imageHarmonic } from "@telemicroscope/core/illumination";
import {
  coherentSource,
  diskSource,
  idealPupil,
  weakObjectTransfer,
  type CondenserSource,
} from "@telemicroscope/core/illumination";
import { renderBrightfield, tracedFieldPupils, type PatchPupil } from "@telemicroscope/core/imaging";
import { fieldPupilAt } from "@telemicroscope/core/imaging";
import { objectNumericalAperture } from "@telemicroscope/core/pupil";
import type { PupilFunction } from "@telemicroscope/core/wave";
import { buildFrame, LAMBDA_NM } from "./microscope";
import type { BuildSpec } from "./builder";
import { refused, type Refused } from "./refusal";

/**
 * Brightfield through a traced objective, with the condenser on a dial —
 * APP.md's A2, as pure functions.
 *
 * `microscope.ts`'s commitment kept: numbers in, numbers out, no DOM and no
 * React, so the expensive half drops into a worker unchanged (and does —
 * `brightfield.worker.ts`). It sits on A1's `buildFrame`, which is the whole
 * reason this file has no opinion about how wide the specimen crop is.
 *
 * ## The picture and the plot are one claim, split in two
 *
 * A2 is a **pair** because its headline is a cutoff, and a cutoff is a place
 * where something stops being visible — a picture alone cannot distinguish "the
 * grating is past the cutoff" from "the render is broken". So the same
 * (objective, condenser, sampling) produces both: an image of a cosine grating
 * at frequency ν, and the curve of where the cutoff actually lands as S opens.
 * The reader sets ν with one slider, S with another, and watches the grating
 * appear exactly as the marker crosses the curve.
 *
 * That crossing is measured, not staged. At ν = 1.3125 through a traced DIN
 * 4×/0.10 with an 11-point condenser lattice, the image's contrast at the
 * grating's own bin reads **identically 0** for S ≤ 0.3 and lifts off at
 * S = 0.35 — and 1 + S·(1 − 1/11) crosses 1.3125 at S = 0.344.
 *
 * ## Three curves, and the third one is the honest one
 *
 * The plot carries the textbook law, the measured cutoff, and the lattice term
 * between them:
 *
 *  - **textbook** — 1 + min(S, 1), i.e. d = λ/(NA_obj + NA_cond), capped where
 *    the pupil's autocorrelation runs out.
 *  - **measured** — `weakObjectTransfer` on the pupil the picture was formed
 *    through, bisected for its last non-zero frequency. § 6f's own measurement,
 *    re-run here on whichever objective is selected.
 *  - **lattice** — `latticeReach` below: the outermost illumination direction
 *    the sampled condenser actually *has* and the pupil actually admits.
 *
 * Measured lands on lattice to ~1e-12 — at every S, for every objective in the
 * catalogue including the 1.40 oil, and for even sample counts as well as odd.
 * It does **not** land on the textbook curve, and the gap is not error: it is
 * the finite condenser lattice, which is a thing this engine has and a real
 * condenser does not.
 *
 * ## Which is why the plot does something APP.md did not predict
 *
 * A2 was scoped with "opening past S = 1 changes nothing, visibly". In the
 * continuum that is exactly right. On the lattice it is not: past S = 1 the
 * sampled directions keep marching outward, the outermost ones leave the pupil
 * entirely, and the measured cutoff **steps back down** — at N = 11 it falls
 * from 1.909 at S = 1 to 1.818 at S = 1.5 and 1.727 at S = 2. That is
 * discretization, not physics, and raising `sourceSamples` walks it back up
 * (N = 33 reaches exactly 2.000 at S = 1.5). The panel shows it and says which
 * of the two it is; hiding it behind a coarser plot would be showing the demo
 * instead of the engine.
 */

/** Display convention: mid-grey is the frame's own mean, white is twice it. */
export const WHITE_OVER_MEAN = 2;

export type PupilMode = "traced" | "ideal";

export interface BrightfieldRequest {
  readonly spec: BuildSpec;
  /** Frequency bins across the pupil diameter — also the crop, in cells (§ 6h). */
  readonly pupilSamples: number;
  /** Grid size, a power of two. Also the headroom the shifted pupil needs. */
  readonly size: number;
  /** Condenser lattice points across the source DIAMETER. */
  readonly sourceSamples: number;
  /** S = NA_cond / NA_obj — the dial on the front of a real microscope. */
  readonly coherenceParameter: number;
  /** Grating periods across the grid. ν = 2·cycles/pupilSamples. */
  readonly cycles: number;
  /** Grating modulation m, in t = 1 + m·cos. */
  readonly modulation: number;
  /**
   * Which pupil forms the image.
   *
   * `traced` is the real objective and the one A2 is about. `ideal` is the
   * unaberrated disc the closed forms describe — 3× cheaper, and the only way
   * this panel can reach `illumination/fidelity`'s **`unknown`** verdict, since
   * a bare `PupilFunction` carries no memory of the trace that produced it.
   * That state is not decoration: it is what the engine says when it cannot
   * rule, and A2 is required not to round it to green.
   */
  readonly pupil: PupilMode;
}

export interface BrightfieldReadout {
  /** Greyscale image, RGBA, `size`×`size`. */
  readonly rgba: Uint8ClampedArray;
  readonly size: number;
  /** ν = 2·cycles/pupilSamples, in units of NA/λ. 1 is coherent, 2 incoherent. */
  readonly nu: number;
  /** The grating's period on the specimen (nm) — ν, in something touchable. */
  readonly periodNm: number;
  /** The crop, across the whole frame, on the specimen (µm). A1's number. */
  readonly objectSpanUm: number;
  readonly tracedNA: number;
  /**
   * Where the sampled condenser puts the cutoff — `latticeReach`, so **`NaN`**
   * when no illumination direction enters the pupil at all. A caption must
   * spend that case rather than compare against it.
   */
  readonly cutoff: number;
  /** 1 + min(S, 1): the textbook λ/(NA_obj + NA_cond), for comparison. */
  readonly textbookCutoff: number;
  /**
   * Modulation depth measured off the rendered image at the grating's own bin.
   * The number that goes to zero past the cutoff.
   */
  readonly contrast: number;
  /** Mean intensity — a clear field under a fully transmitted source is 1. */
  readonly meanIntensity: number;
  /**
   * The same measurement at **2ν**, where a linear imager could put nothing at
   * all from a single-frequency object. Partial coherence's nonlinearity, as a
   * number rather than an assertion: it is the m² cross term in `gratingImage`.
   */
  readonly secondHarmonic: number;
  /**
   * `weakObjectTransfer` at ν through the same pupil and source — the closed
   * three-order sum. The image's contrast should be 2·m·T where the weak-object
   * limit holds, and the residual is the finite modulation, not an error.
   */
  readonly weakTransfer: number;
  /** 2·m·T — what the image's contrast would be if the object were weak. */
  readonly weakPrediction: number;
  readonly verdict: "valid" | "unknown" | "no-honest-image";
  readonly verdictReason: string;
  readonly phaseStepWaves: number | null;
  readonly geometricShare: number | null;
  /** Min over patches: how well the worst patch's source was sampled. */
  readonly contributingPoints: number;
  /** Directions the condenser lattice actually holds at this S. */
  readonly sourcePoints: number;
  /** Max over patches — the DFT lattice's ability to carry the pupil it saw. */
  readonly maxGridPhaseStepWaves: number;
  readonly elapsedMs: number;
}

export type BrightfieldResult =
  | { readonly ok: true; readonly readout: BrightfieldReadout }
  | Refused;

/** A render asked of the worker; `seq` lets the caller discard stale replies. */
export interface BrightfieldJob {
  readonly seq: number;
  readonly request: BrightfieldRequest;
}

export interface BrightfieldDone {
  readonly seq: number;
  readonly result: BrightfieldResult;
}

/** ν = 2·cycles/pupilSamples — `cosineGratingObject`'s own bridge into NA/λ. */
export function frequencyOf(cycles: number, pupilSamples: number): number {
  return (2 * cycles) / pupilSamples;
}

/**
 * The largest S whose shifted pupil still fits the frequency grid.
 *
 * `abbeImage` **throws** rather than clamp — a truncated pupil looks exactly
 * like a smaller aperture, which would read as physics — so the caller has to
 * know where the wall is. The binding sample is the lattice's outermost one,
 * at radius S·(1 − 1/N), and it needs (1 + |s|)·pupilSamples/2 bins either side
 * of centre with one to spare: |s| ≤ (size − 2)/pupilSamples − 1.
 *
 * Measured against the engine at pupilSamples 64, size 128, N 11: this returns
 * 1.0656 and `abbeImage` throws at 1.1. Clamped to the slider's own step below
 * that, so the panel cannot walk the user into the wall — and the throw is
 * still caught and shown, because a clamp derived from a formula is a claim and
 * the engine's message is the check on it.
 */
export function maxCoherenceParameter(
  size: number,
  pupilSamples: number,
  sourceSamples: number,
): number {
  const reach = (size - 2) / pupilSamples - 1;
  return Math.max(0, reach / (1 - 1 / sourceSamples));
}

/**
 * The outermost illumination direction the sampled condenser has AND the
 * objective admits, as a cutoff frequency.
 *
 * A direction s carries contrast at ν only if the undiffracted beam and the
 * order at ν both get through: |s| ≤ 1 and |s − ν| ≤ 1, so that direction's own
 * ceiling is |s_x| + √(1 − s_y²). The lattice's cutoff is the largest of those
 * over the directions it actually holds — which is `1 + S·(1 − 1/N)` while the
 * whole source is inside the pupil, and stops tracking it once it is not.
 *
 * This is a property of the source and the unit pupil, so it is computed rather
 * than measured; `cutoffSweep` measures the same thing off the pupil sum and the
 * plot shows the two together. They agree to ~1e-12.
 *
 * **`NaN` when the pupil admits no direction at all**, which is not the same
 * statement as a cutoff of zero and must not be printed as one. A `diskSource`
 * always holds a point near the origin so A2's own controls cannot reach it —
 * but `annularSource` with an inner radius past 1 is exactly that set, it is
 * how darkfield works, and A3 is the panel that asks for it. A caller reading
 * 0 here would show "cutoff 0.0000, past the cutoff" for a configuration whose
 * actual content is "the undiffracted beam never enters the objective".
 */
export function latticeReach(source: CondenserSource): number {
  let best = Number.NaN;
  for (const s of source.points) {
    const r2 = s.sx * s.sx + s.sy * s.sy;
    if (r2 > 1) continue;
    const ceiling = Math.abs(s.sx) + Math.sqrt(1 - s.sy * s.sy);
    if (!(ceiling <= best)) best = ceiling;
  }
  return best;
}

/**
 * The condenser at S.
 *
 * S = 0 takes `coherentSource` rather than `diskSource(0, N)`: the latter
 * collapses every lattice point onto the origin and would pay for N² identical
 * transforms to compute the one-point coherent limit.
 */
export function sourceAt(coherenceParameter: number, samples: number): CondenserSource {
  return coherenceParameter === 0 ? coherentSource() : diskSource(coherenceParameter, samples);
}

/** Greyscale, mid-grey at the frame's own mean. Linear; nothing is stretched. */
function toGrey(intensity: Float64Array, size: number, mean: number): Uint8ClampedArray {
  const rgba = new Uint8ClampedArray(size * size * 4);
  const white = mean > 0 ? WHITE_OVER_MEAN * mean : 1;
  for (let i = 0; i < size * size; i++) {
    const v = Math.round((255 * intensity[i]!) / white);
    rgba[i * 4] = v;
    rgba[i * 4 + 1] = v;
    rgba[i * 4 + 2] = v;
    rgba[i * 4 + 3] = 255;
  }
  return rgba;
}

/** The ideal disc, wearing `PatchPupil`'s shape but carrying no sampling. */
const idealPatch = (): PatchPupil => ({ pupil: idealPupil() });

/**
 * Form one brightfield image and read everything off it.
 *
 * Measured at pupilSamples 32, size 128, an 11-point condenser and one patch:
 * **~245 ms traced, ~82 ms ideal**, which is live under APP.md's ~800 ms line.
 * `patches` is fixed at 1 and not exposed: ≥ 2 is compute-once, and progressive
 * refinement over patches does not exist yet (`renderBrightfield`'s `onPatch`
 * reports within one grid, not across grids).
 */
export function renderBrightfieldScene(request: BrightfieldRequest): BrightfieldResult {
  const started = performance.now();
  try {
    const { system, frame } = buildFrame({
      spec: request.spec,
      pupilSamples: request.pupilSamples,
      size: request.size,
    });
    const object = cosineGratingObject({
      size: request.size,
      cycles: request.cycles,
      modulation: request.modulation,
    });
    const source = sourceAt(request.coherenceParameter, request.sourceSamples);
    const pupils =
      request.pupil === "traced" ? tracedFieldPupils(system, frame) : idealPatch;

    const out = renderBrightfield(object, pupils, source, {
      pupilSamples: request.pupilSamples,
      patches: 1,
      scale: frame.scale,
    });

    const nu = frequencyOf(request.cycles, request.pupilSamples);
    const fundamental = imageHarmonic(out.intensity, request.size, request.cycles);
    // 2ν only exists on the grid while it fits inside it; past the Nyquist bin
    // the measurement would alias, and reporting an aliased number as the
    // nonlinearity would be inventing the very thing it claims to detect.
    const secondBin = 2 * request.cycles;
    const secondHarmonic =
      secondBin < request.size / 2
        ? imageHarmonic(out.intensity, request.size, secondBin).contrast
        : Number.NaN;

    // The same pupil the image was formed through, on axis — which is the one
    // patch a `patches` = 1 render used.
    const pupil: PupilFunction =
      request.pupil === "traced"
        ? fieldPupilAt(system, frame, 0.5, 0.5).pupil
        : idealPupil();
    const weakTransfer = weakObjectTransfer(pupil, source, nu);

    return {
      ok: true,
      readout: {
        rgba: toGrey(out.intensity, request.size, fundamental.dc),
        size: request.size,
        nu,
        periodNm: nu > 0 ? (frame.objectPixelScaleMm * 1e6 * request.size) / request.cycles : 0,
        objectSpanUm: 2 * frame.objectHalfExtentMm * 1000,
        tracedNA: objectNumericalAperture(system, LAMBDA_NM),
        cutoff: latticeReach(source),
        textbookCutoff: 1 + Math.min(request.coherenceParameter, 1),
        contrast: fundamental.contrast,
        meanIntensity: fundamental.dc,
        secondHarmonic,
        weakTransfer,
        weakPrediction: 2 * request.modulation * weakTransfer,
        verdict: out.fidelity.verdict,
        verdictReason: out.fidelity.reason,
        phaseStepWaves: out.fidelity.phaseStepWaves,
        geometricShare: out.fidelity.geometricShare,
        contributingPoints: out.contributingPoints,
        sourcePoints: source.points.length,
        maxGridPhaseStepWaves: out.maxGridPhaseStepWaves,
        elapsedMs: performance.now() - started,
      },
    };
  } catch (cause) {
    // Two kinds of refusal land here and both are readouts: § 6b's and § 6d's
    // design ceilings, and `abbeImage`'s frequency-grid wall — which carries the
    // grid size that would fix it.
    return refused(cause);
  }
}

/** Largest ν at which the transfer is still non-zero, by bisection. */
function measuredCutoff(transfer: (nu: number) => number): number {
  let lo = 0.4;
  let hi = 2.6;
  // 40 halvings of 2.2 is ~2e-12 — far past what the plot resolves, but the
  // claim being checked is that measured MEETS lattice, and a bisection stopped
  // early would be reporting its own step size instead.
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (transfer(mid) > 1e-9) lo = mid;
    else hi = mid;
  }
  return lo;
}

export interface CutoffPoint {
  readonly coherenceParameter: number;
  /** Bisected off `weakObjectTransfer` through the panel's own pupil. */
  readonly measured: number;
  /** 1 + min(S, 1) — the textbook law. */
  readonly textbook: number;
  /** `latticeReach` — the sampled condenser's own last direction. */
  readonly lattice: number;
}

export interface CutoffSweep {
  readonly points: readonly CutoffPoint[];
  /** Worst |measured − lattice| across the sweep. The claim, as one number. */
  readonly worstResidual: number;
  readonly elapsedMs: number;
}

export type CutoffResult =
  | { readonly ok: true; readonly sweep: CutoffSweep }
  | Refused;

/**
 * The cutoff against S — the plot half of the pair.
 *
 * Runs on the main thread behind a deferral, as `MicroscopeTable` does and for
 * the same reason: it does not move with the S slider, only with the objective
 * and the sampling, so it is a select-change cost rather than a drag cost.
 * ~190 ms at 21 points through a traced pupil with an 11-point condenser.
 *
 * No `abbeImage` here — this is the three-pupil-evaluation sum, so the
 * frequency-grid wall does not apply and the sweep may legitimately run past
 * where the picture can go.
 */
export function cutoffSweep(
  request: Omit<BrightfieldRequest, "coherenceParameter" | "cycles" | "modulation">,
  maxS: number,
  points = 21,
): CutoffResult {
  const started = performance.now();
  try {
    const pupil: PupilFunction =
      request.pupil === "traced"
        ? (() => {
            const { system, frame } = buildFrame({
              spec: request.spec,
              pupilSamples: request.pupilSamples,
              size: request.size,
            });
            return fieldPupilAt(system, frame, 0.5, 0.5).pupil;
          })()
        : idealPupil();

    const out: CutoffPoint[] = [];
    let worstResidual = 0;
    for (let i = 0; i < points; i++) {
      const S = (i / (points - 1)) * maxS;
      const source = sourceAt(S, request.sourceSamples);
      const measured = measuredCutoff((nu) => weakObjectTransfer(pupil, source, nu));
      const lattice = latticeReach(source);
      worstResidual = Math.max(worstResidual, Math.abs(measured - lattice));
      out.push({
        coherenceParameter: S,
        measured,
        textbook: 1 + Math.min(S, 1),
        lattice,
      });
    }
    return {
      ok: true,
      sweep: { points: out, worstResidual, elapsedMs: performance.now() - started },
    };
  } catch (cause) {
    return refused(cause);
  }
}
