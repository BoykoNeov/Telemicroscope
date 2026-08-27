import {
  coherentSource,
  idealPupil,
  imageHarmonic,
  incoherentTransfer,
  weakObjectTransfer,
} from "@telemicroscope/core/illumination";
import {
  cosineGratingEmitters,
  fieldPupilAt,
  incoherentImage,
  incoherentPsf,
  rasterizeEmitters,
  renderFluorescence,
  tracedFieldPupils,
  type PointEmitter,
} from "@telemicroscope/core/imaging";
import { mulberry32 } from "@telemicroscope/core/math";
import { abbeResolutionMm, objectNumericalAperture } from "@telemicroscope/core/pupil";
import { buildFrame, LAMBDA_NM } from "./microscope";
import type { BuildSpec } from "./builder";
import { refused, type Refused } from "./refusal";

/**
 * Fluorescent beads through a traced objective — APP.md's A4, as pure functions.
 *
 * `microscope.ts`'s commitment kept, as A2 and A3 keep it: numbers in, numbers
 * out, no DOM and no React, so the expensive half drops into a worker unchanged
 * (and does — `fluorescence.worker.ts`). It sits on A1's `buildFrame`, which is
 * why nothing here has an opinion about how wide the specimen crop is.
 *
 * ## The first surface that is a photograph rather than a chart
 *
 * A2's cosine grating and A3's phase grating are instruments pointed at the
 * transfer function: their whole content is a number at one frequency. A bead
 * field is the other thing a microscope produces. Every blob on the canvas is
 * **one point emitter convolved with the objective's own incoherent PSF**, so
 * the picture is a direct drawing of the kernel — as many independent copies of
 * it as there are beads, laid across the field at positions the trace chose.
 *
 * Two consequences are worth stating before anything is drawn:
 *
 *  - **Every bead emits exactly the same power** (`flux` = 1, no jitter). That
 *    is not a simplification, it is the measurement: any difference between two
 *    blobs on the screen is then the *objective*, since the specimen has none.
 *    A random brightness would look more like a photograph and would delete the
 *    only comparison the picture supports.
 *  - **Each bead is placed through its own traced chief ray**
 *    (`rasterizeEmitters`), so the objective's distortion is carried in the
 *    placement. § 6h left the warped-grid rasterizer unbuilt and a stained
 *    tissue field would need it; a scene made of points does not, because every
 *    point is mapped on its own. That is § 6i.5's reason beads are the branch's
 *    first specimen, and it is an engine reason rather than a biological one.
 *
 * ## No condenser, and the cutoff that follows from that
 *
 * A2's headline is a cutoff that depends on the condenser: λ/(NA_obj + NA_cond),
 * ν = 1 with the diaphragm closed and ν = 2 only with it fully open. There is no
 * condenser in this module at all — a fluorophore absorbs a photon and emits a
 * new one with no phase memory of the exciting field or of its neighbours, so
 * the emitters are mutually incoherent by nature, their intensities add, and the
 * image is a plain convolution. § 6i.3's finding is that this reaches **ν = 2 —
 * `wave/mtf`'s own cutoff — with no condenser in the instrument**, and
 * `transferSweep` below measures it on the same ν axis A2 and A3 plot.
 *
 * ## What this panel deliberately does not have
 *
 * **No verdict.** § 6f.9 had to rule for brightfield because a ray histogram has
 * no phase to interfere with, so there is no geometric branch to fall back to.
 * Incoherent imaging has one — `adaptivePsf`, cross-faded since § 2d — so § 6i
 * mints no verdict, and APP.md is explicit that this panel must not invent one.
 * The only guard is `maxGridPhaseStepWaves`, which is `abbeImage`'s own.
 *
 * **No background, no noise, no haze.** Shot noise, photobleaching and quantum
 * yield are all blocked on an absolute photon count (§ 3a's standing deferral),
 * and out-of-focus haze is `imaging/volume` — A5's panel, not this one. A
 * cosmetic floor would make the picture look more like a photograph by faking
 * the one thing this panel exists to show honestly.
 */

/** Every bead emits the same power, so a difference on screen is the optics. */
export const BEAD_FLUX = 1;

export interface FluorescenceRequest {
  readonly spec: BuildSpec;
  /** Frequency bins across the pupil diameter — also the crop, in cells (§ 6h). */
  readonly pupilSamples: number;
  /** Grid size, a power of two. Buys sampling, NOT field. */
  readonly size: number;
  /** Patches across the field, per axis. > 1 lets the pupil vary with position. */
  readonly patches: number;
  /** Beads asked for; how many land in the frame is a readout, not this. */
  readonly beadCount: number;
  /** Same seed, same field — so a slider changes the optics and not the scene. */
  readonly seed: number;
}

/**
 * Beads scattered over the frame's own specimen extent.
 *
 * Uniform over the square the frame covers, in **object** millimetres, because
 * `rasterizeEmitters` takes specimen coordinates and maps each one forward
 * through the trace. Beads near the corners may therefore land outside the grid
 * — distortion moves them and the frame is a square inscribed in nothing in
 * particular — and `rasterizeEmitters` drops those silently. The count that
 * actually landed is measured off the field below rather than assumed.
 *
 * Seeded (`mulberry32`, § 4's own generator) so the scene is fixed while the
 * optics move: a bead field that reshuffled on every slider drag would make
 * every comparison this panel offers impossible to see.
 */
export function beadField(
  halfExtentMm: number,
  count: number,
  seed: number,
): readonly PointEmitter[] {
  const rng = mulberry32(seed);
  const out: PointEmitter[] = [];
  for (let i = 0; i < count; i++) {
    out.push({
      xMm: (2 * rng.next() - 1) * halfExtentMm,
      yMm: (2 * rng.next() - 1) * halfExtentMm,
      flux: BEAD_FLUX,
    });
  }
  return out;
}

export interface FluorescenceReadout {
  readonly size: number;
  /** Intensity in the object's own coordinates — the panel maps it to grey. */
  readonly intensity: Float64Array;
  /** The brightest pixel. White is set from this, never from the mean. */
  readonly peak: number;
  readonly meanIntensity: number;

  /** The crop, across the whole frame, on the specimen (µm) — A1's number. */
  readonly objectSpanUm: number;
  readonly objectPixelNm: number;
  readonly imagePixelUm: number;
  readonly tracedNA: number;
  /** λ/(2·NA) at the traced NA (nm) — what one blob's width is measured in. */
  readonly abbeResolutionNm: number;

  /** Beads that landed on the grid, of the number asked for. */
  readonly placed: number;
  readonly requested: number;
  /** Beads per 100 µm² of specimen — the density the count really means. */
  readonly densityPer100Um2: number;

  /**
   * |Σ image − Σ emitters| / Σ emitters — § 6i.4's conservation identity, live.
   *
   * The kernel sums to 1 and the patch windows sum to 1, so neither the optics
   * nor the patch decomposition may invent or lose a photon; circular
   * convolution is what makes that exact rather than edge-limited. Measured
   * against the **rasterized** emitter field rather than the requested flux:
   * `rasterizeEmitters` drops beads whose splat falls off the grid, and summing
   * what was asked for would print those as a conservation failure that is
   * nothing of the kind.
   *
   * **`null` when no bead landed at all**, which is a ratio to zero and not a
   * conservation of zero. APP.md's A3-derived rule — *a readout whose value is
   * undefined must be refused, not printed as zero* — cuts exactly here: a
   * guarded 0 beside a green tick would report a perfect identity for a frame
   * with nothing in it. No seed the panel's slider offers reaches this at the
   * smallest bead count (checked over all sixteen), so the refusal is
   * precautionary rather than observed — but the alternative is a false claim
   * rather than a missing one.
   */
  readonly lightResidual: number | null;

  /**
   * Σ image / Σ emitted — the share of the beads' light the objective put on
   * the sensor.
   *
   * Since § 6bc. It was 1 by construction while the render divided the pupil's
   * own transmission out of every patch, and `lightResidual` beside it is now
   * quoted against the flux those weights allow rather than against the
   * emitted flux, so the identity it checks is still exact and no longer
   * checks the normalizer.
   */
  readonly throughput: number | null;

  /**
   * Peak of the unit-sum incoherent PSF on axis and at the frame corner.
   *
   * The kernel has unit sum, so its peak is a Strehl-like readout, and § 6i.5's
   * finding is that the corner's traced pupil gives a **lower-peaked** kernel
   * than the axis's — § 6h.5's corner coma showing up in an image. The drop is
   * small (it is a fraction of a percent over a frame this narrow), so it is
   * printed with enough digits to be read rather than rounded into nothing.
   */
  readonly axisKernelPeak: number;
  readonly cornerKernelPeak: number;
  /** Lattice points the axial pupil transmitted — the aperture, counted. */
  readonly transmittingSamples: number;

  /** Rays the corner field point lost to vignetting. NOT a verdict. */
  readonly cornerLost: number;
  /**
   * RMS OPD (waves) on axis and at the corner, straight from the trace, about
   * each pupil's own mean at the system's **own image plane** — A1's convention,
   * no best-focus solve. These are the numbers that explain how far below the
   * closed-form MTF the measured curve sits, and they are printed as what they
   * are: a wavefront error. They are **not** dressed as a fidelity verdict,
   * because § 6i mints none and this panel may not invent one.
   */
  readonly axisRmsWaves: number;
  readonly cornerRmsWaves: number;

  /** The one guard here: `abbeImage`'s own DFT-lattice criterion. */
  readonly maxGridPhaseStepWaves: number;
  readonly elapsedMs: number;
}

export type FluorescenceResult =
  | { readonly ok: true; readonly readout: FluorescenceReadout }
  | Refused;

export interface FluorescenceJob {
  readonly seq: number;
  readonly request: FluorescenceRequest;
}

export interface FluorescenceDone {
  readonly seq: number;
  readonly result: FluorescenceResult;
}

/**
 * Grey on a scale the CALLER fixes, from the image's own **peak**.
 *
 * A2 and A3 put white at twice the frame's mean, which is right for a grating
 * filling every pixel. A bead field is sparse — measured on the default scene, a
 * single bead's peak runs ~20× the frame mean — so white = 2·mean would clip
 * every bead into a flat white disc and the panel whose whole claim is *"each
 * blob is the PSF"* would show discs with no PSF in them.
 *
 * `stretch` divides that: 1 puts white at the peak, 4 and 16 lift the wings so
 * the first ring becomes visible (it is ~1.7% of the peak for a clear circular
 * pupil, which is black on a peak-white scale). It is a display choice, so the
 * factor is printed rather than absorbed — A3's rule — and it deliberately does
 * NOT re-run the optics: the readout carries intensity and the panel maps it.
 * Linear throughout; nothing here applies a gamma.
 */
export function toGrey(
  intensity: Float64Array,
  size: number,
  white: number,
): Uint8ClampedArray {
  const rgba = new Uint8ClampedArray(size * size * 4);
  const scale = white > 0 ? 255 / white : 0;
  for (let i = 0; i < size * size; i++) {
    const v = Math.round(scale * intensity[i]!);
    rgba[i * 4] = v;
    rgba[i * 4 + 1] = v;
    rgba[i * 4 + 2] = v;
    rgba[i * 4 + 3] = 255;
  }
  return rgba;
}

/**
 * How many beads actually landed, counted off the rasterized field.
 *
 * Bilinear splatting puts (1−fx)(1−fy) + fx(1−fy) + (1−fx)fy + fx·fy = 1 of a
 * bead's flux on the grid, and a bead whose footprint falls off the edge
 * contributes nothing at all — `rasterizeEmitters` drops it. So the field's own
 * sum divided by the per-bead flux **is** the count, exactly, and no bounds
 * check has to be duplicated out of the engine to get it. Rounded because the
 * four weights sum to 1 in f64 rather than in exact arithmetic.
 */
function countPlaced(emitted: number): number {
  return Math.round(emitted / BEAD_FLUX);
}

/**
 * Form one bead field and read everything off it.
 *
 * Measured under `vite-node` on a traced DIN 4×/0.10 with 60 beads — see the
 * panel for the browser figures, which is where the live/compute-once line is
 * actually drawn.
 */
export function renderFluorescenceScene(
  request: FluorescenceRequest,
): FluorescenceResult {
  const started = performance.now();
  try {
    const { system, frame } = buildFrame({
      spec: request.spec,
      pupilSamples: request.pupilSamples,
      size: request.size,
    });
    const emitters = beadField(frame.objectHalfExtentMm, request.beadCount, request.seed);
    const object = rasterizeEmitters(system, frame, emitters);

    let emitted = 0;
    for (let i = 0; i < object.values.length; i++) emitted += object.values[i]!;

    // § 6bc, as in `emitter.ts`: `patches` is a user control and each patch
    // has its own pupil, so the light each one passes is a difference between
    // them and never a constant.
    const out = renderFluorescence(object, tracedFieldPupils(system, frame), {
      pupilSamples: request.pupilSamples,
      patches: request.patches,
      scale: frame.scale,
      throughput: { kind: "transmitted" },
    });

    let formed = 0;
    let peak = 0;
    for (let i = 0; i < out.intensity.length; i++) {
      const v = out.intensity[i]!;
      formed += v;
      if (v > peak) peak = v;
    }

    // The same two pupils A1's table reads its σ off, here turned into kernels:
    // the axial one is the pupil a `patches` = 1 render used, and the corner one
    // is § 6i.5's comparison.
    const psfOptions = { pupilSamples: request.pupilSamples, size: request.size };
    const axis = fieldPupilAt(system, frame, 0.5, 0.5);
    const axisKernel = incoherentPsf(axis.pupil, psfOptions);
    const corner = fieldPupilAt(system, frame, 1, 1);
    const cornerKernel = incoherentPsf(corner.pupil, psfOptions);
    const peakOf = (values: Float64Array): number => {
      let best = 0;
      for (let i = 0; i < values.length; i++) if (values[i]! > best) best = values[i]!;
      return best;
    };

    const tracedNA = objectNumericalAperture(system, LAMBDA_NM);
    const objectSpanUm = 2 * frame.objectHalfExtentMm * 1000;
    const placed = countPlaced(emitted);

    return {
      ok: true,
      readout: {
        size: request.size,
        intensity: out.intensity,
        peak,
        meanIntensity: formed / (request.size * request.size),
        objectSpanUm,
        objectPixelNm: frame.objectPixelScaleMm * 1e6,
        imagePixelUm: frame.pixelScaleMm * 1000,
        tracedNA,
        abbeResolutionNm: abbeResolutionMm(LAMBDA_NM, tracedNA) * 1e6,
        placed,
        requested: request.beadCount,
        densityPer100Um2: (100 * placed) / (objectSpanUm * objectSpanUm),
        lightResidual:
          out.weightedEmittedFlux > 0
            ? Math.abs(formed - out.weightedEmittedFlux) / out.weightedEmittedFlux
            : null,
        throughput: emitted > 0 ? formed / emitted : null,
        axisKernelPeak: peakOf(axisKernel.values),
        cornerKernelPeak: peakOf(cornerKernel.values),
        transmittingSamples: axisKernel.transmittingSamples,
        cornerLost: corner.lost,
        axisRmsWaves: axis.rmsWaves,
        cornerRmsWaves: corner.rmsWaves,
        maxGridPhaseStepWaves: out.maxGridPhaseStepWaves,
        elapsedMs: performance.now() - started,
      },
    };
  } catch (cause) {
    // § 6b's and § 6d's design ceilings arrive here as the engine's own words,
    // exactly as they do in A1 and A2, and so does `incoherentPsf`'s refusal to
    // truncate a pupil that does not fit the grid.
    return refused(cause);
  }
}

export interface TransferPoint {
  readonly nu: number;
  /**
   * Read off a rendered image of `cosineGratingEmitters` at this ν, through the
   * same on-axis traced pupil the picture was formed with.
   *
   * **T = contrast, with no factor of 2.** A2's brightfield object is an
   * *amplitude*, t = 1 + m·cos, and squaring it puts 2·m·T in the image. A
   * fluorescent object emits, so E = 1 + m·cos is already an intensity and the
   * convolution is linear in it: I = 1 + m·T·cos. Carrying A2's 2 across would
   * have doubled every point on this curve.
   */
  readonly measured: number;
  /** `incoherentTransfer` — § 2b's closed-form circular MTF, nothing new minted. */
  readonly closed: number;
  /**
   * `weakObjectTransfer` under one on-axis plane wave — brightfield with the
   * condenser diaphragm shut, which is A2's ν = 1 cliff on the same axis.
   */
  readonly brightfieldCoherent: number;
}

export interface TransferSweep {
  readonly points: readonly TransferPoint[];
  /**
   * Worst |measured − closed| below ν = 1.9, which holds two things at once:
   * the objective's own aberration, and § 6i.3's lattice discretization. The
   * latter is bounded near 1e-3 (measured there at pupilSamples 16/32/64, and
   * *not* monotone in it — the Gauss circle problem), so a residual far above
   * that is the objective and one near it is the grid.
   */
  readonly worstResidual: number;
  /** Measured transfer exactly at ν = 2, where the closed form reads 0. */
  readonly atCutoff: number;
  /** 1/`transmittingSamples` — what the tangency point costs, as a count. */
  readonly tangencyShare: number;
  /** Cycle counts actually rendered, of the ones the grid could carry. */
  readonly rendered: number;
  readonly available: number;
  readonly elapsedMs: number;
}

export type TransferResult =
  | { readonly ok: true; readonly sweep: TransferSweep }
  | Refused;

/** What the sweep depends on — not the scene, and not the patch count. */
export type TransferRequest = Pick<FluorescenceRequest, "spec" | "pupilSamples" | "size">;

export interface TransferJob {
  readonly seq: number;
  readonly request: TransferRequest;
}

export interface TransferDone {
  readonly seq: number;
  readonly result: TransferResult;
}

/** Where the sweep stops: a little past the ν = 2 cutoff, so flatness shows. */
const CYCLE_HEADROOM = 3;

/** Points the plot gets. Enough to draw the closed form, few enough to be quick. */
const TARGET_POINTS = 28;

/**
 * The transfer against ν — A4's plot half, and its second job.
 *
 * `cosineGratingEmitters` at integer `cycles`, so ν = 2·cycles/pupilSamples is
 * **exactly A2's and A3's axis** and the three panels can be read against each
 * other. Each point is one `incoherentImage` — one transform pair, against
 * `abbeImage`'s one per source point, which is the whole cost difference
 * between emitting and modulating.
 *
 * Depends only on (objective, pupilSamples, size), never on the scene or the
 * patch count, so it is a select-change cost rather than a drag cost. It runs in
 * **its own worker** all the same, and that is a departure from A2 and A3 with a
 * measured reason: their sweeps are pupil-evaluation sums costing 190 ms and
 * 20 ms, cheap enough for a `setTimeout` deferral, and this one renders an image
 * per frequency — measured in the browser at **1.3 s at pupil samples 64 and
 * 2.0 s at 128**. On the main thread that is two seconds of frozen page on every
 * objective change, which was observed rather than predicted: driving the panel
 * blocked the renderer hard enough that a screenshot timed out.
 *
 * The cycle list is **decimated** when the grid can carry more frequencies than
 * `TARGET_POINTS`, and both counts are reported: at pupilSamples 128 the grid
 * carries 131 of them and rendering all of them would cost seconds. A silent cap
 * would read as full coverage, which is the failure A2 avoids by printing its
 * own sample counts.
 */
export function transferSweep(request: TransferRequest): TransferResult {
  const started = performance.now();
  try {
    const { system, frame } = buildFrame({
      spec: request.spec,
      pupilSamples: request.pupilSamples,
      size: request.size,
    });
    const pupil = fieldPupilAt(system, frame, 0.5, 0.5).pupil;
    const kernel = incoherentPsf(pupil, {
      pupilSamples: request.pupilSamples,
      size: request.size,
    });

    // ν = 2 lands exactly on cycles = pupilSamples, and the bin must stay inside
    // the grid's own Nyquist — beyond it `imageHarmonic` would read an alias and
    // report it as transfer.
    const top = Math.min(request.pupilSamples + CYCLE_HEADROOM, Math.floor(request.size / 2) - 1);
    const stride = Math.max(1, Math.ceil(top / TARGET_POINTS));
    const cycles: number[] = [];
    for (let c = stride; c <= top; c += stride) cycles.push(c);
    // The cutoff itself is never decimated away: ν = 2 is the frequency this
    // whole sweep exists to reach, and § 6i.3's tangency reading lives there.
    if (!cycles.includes(request.pupilSamples) && request.pupilSamples <= top) {
      cycles.push(request.pupilSamples);
      cycles.sort((a, b) => a - b);
    }

    const source = coherentSource();
    const flat = idealPupil();
    const points: TransferPoint[] = [];
    let worstResidual = 0;
    let atCutoff = Number.NaN;

    for (const c of cycles) {
      const nu = (2 * c) / request.pupilSamples;
      // m = 1, and that is not a stress test: § 6i.1's identity leaves nothing
      // for the modulation to enter, where § 6f.4 measured brightfield's
      // transfer walking 11.2% away from the weak-object limit at m = 1. E = 1 +
      // cos is non-negative, so it is a physical emitter density.
      const object = cosineGratingEmitters({ size: request.size, cycles: c, modulation: 1 });
      // One pupil for every cycle of the sweep and a CONTRAST read off each,
      // so the weight cancels — `transmitted` rather than a reference it would
      // then divide straight back out.
      const image = incoherentImage(object, pupil, {
        pupilSamples: request.pupilSamples,
        throughput: { kind: "transmitted" },
      });
      const measured = imageHarmonic(image.intensity, request.size, c).contrast;
      const closed = incoherentTransfer(nu);
      if (nu < 1.9) worstResidual = Math.max(worstResidual, Math.abs(measured - closed));
      if (c === request.pupilSamples) atCutoff = measured;
      points.push({
        nu,
        measured,
        closed,
        brightfieldCoherent: weakObjectTransfer(flat, source, nu),
      });
    }

    return {
      ok: true,
      sweep: {
        points,
        worstResidual,
        atCutoff,
        tangencyShare: 1 / kernel.transmittingSamples,
        rendered: cycles.length,
        available: top,
        elapsedMs: performance.now() - started,
      },
    };
  } catch (cause) {
    return refused(cause);
  }
}
