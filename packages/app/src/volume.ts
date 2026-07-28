import {
  axialSpectrum,
  axialTransfer,
  defocusing,
  depthKernels,
  depthOfFocusMm,
  fieldPupilAt,
  incoherentPsf,
  missingConeEdge,
  rasterizeEmitters,
  renderVolume,
  withDefocus,
  type EmitterSlice,
  type PointEmitter,
} from "@telemicroscope/core/imaging";
import { getMedium } from "@telemicroscope/core/materials";
import { mulberry32 } from "@telemicroscope/core/math";
import { abbeResolutionMm, objectNumericalAperture } from "@telemicroscope/core/pupil";
import type { OpticalSystem } from "@telemicroscope/core/trace";
import { buildFrame, LAMBDA_NM, type MicroscopeKind } from "./microscope";

/**
 * Out-of-focus haze and the focus stack — APP.md's A5, as pure functions.
 *
 * `microscope.ts`'s commitment kept for the fifth time: numbers in, numbers out,
 * no DOM and no React, so both halves drop into workers unchanged. It sits on
 * A1's `buildFrame` and reuses A4's bead scene, one depth at a time.
 *
 * ## The one fact, stated twice
 *
 * A defocus is a **pure phase**. It moves no pupil amplitude, so Σ|P|² does not
 * move, so — by Parseval, through the engine's own FFT — the kernel's total does
 * not either. **Every plane of a thick specimen delivers its whole flux to the
 * image however far out of focus it is**, which is why a slab three times thicker
 * is exactly three times hazier and why refocusing cannot help: it changes which
 * plane is sharp and nothing else. Transform that constant along the depth axis
 * and it is the **missing cone** — zero axial transfer at zero lateral frequency,
 * so widefield carries no axial information about the specimen's total brightness
 * and deconvolution is ill-posed structurally rather than numerically.
 *
 * Both halves are measured here rather than asserted: `inFocusFraction` against
 * the specimen's own emitted share, and `axialSpectrum` at lateral bin 0.
 *
 * ## Why the object-space medium is read off the prescription
 *
 * `renderVolume` takes an **object-side** NA and index — `defocusWaves` is
 * δ·NA²/(2·n·λ) and the depth of focus is n·λ/(2·NA²), so both carry n. The
 * immersion rows do not sit in air: `objectMedium` for the 100× oil objectives is
 * the **cover glass** (D263, n = 1.5233 at the d line), because § 6e puts the
 * specimen under the slip. Reading it from `system.prescription.objectMedium`
 * rather than typing a literal is what keeps a depth in this panel the same
 * millimetre the engine solved the objective for.
 *
 * ## One pupil for the whole frame
 *
 * `renderVolume` takes a `DepthPupils` callback keyed on defocus, not a
 * field-varying pupil map — there is no patch decomposition in it. So this
 * surface images one isoplanatic patch through the **on-axis** traced pupil, and
 * A4's corner-versus-axis comparison has no analogue here. That is a property of
 * the operator, stated rather than worked around: § 6k is about the depth axis,
 * and mixing a field decomposition into it would put two approximations in one
 * picture with no way to tell which moved.
 *
 * ## What is deliberately absent
 *
 * **Depth-dependent spherical aberration.** Focusing into a specimen whose index
 * does not match the immersion adds spherical aberration that grows with depth —
 * the dominant real defect of deep widefield imaging and the reason correction
 * collars exist. § 6c solves the plate to all orders and § 6e the N-layer stack,
 * so the physics is in the engine, but wiring focal depth into that stack is
 * § 6l's own step with its own rungs. `DepthPupils` is the hook and this module
 * deliberately passes `defocusing`, which varies **phase only**.
 *
 * **No `hazeKernel`.** It collapses a stack into one kernel and is exact only for
 * a specimen uniform in z. A bead field is not one, so quoting it beside these
 * numbers would be a category error — § 6k.6's whole content is that over z the
 * sum does not factor.
 */

/** Every bead emits the same power, A4's convention — so a difference is optics. */
export const BEAD_FLUX = 1;

/**
 * ## The defocus axis has a lattice period, and it sets the stack's window
 *
 * A finding this surface had to make before it could draw the second plot, and it
 * is not in § 6k. The pupil is point-sampled on a lattice, so the phase a defocus
 * w₂₀ puts between two points separated by ν takes only the values
 * 4·w·ν·k/`pupilSamples` — and the axial transfer at ν is therefore **exactly
 * periodic in w₂₀**, with
 *
 *     P(ν) = pupilSamples / (4·ν)   waves
 *
 * measured to 1e-14 at six (pupilSamples, ν) combinations. It is the axial
 * analogue of § 6i.3's "the transfer is a point count": a consequence of the
 * lattice, not of the optics.
 *
 * The consequence for a *plot* is sharp. § 6k.4's own stack runs to ±8 waves at
 * 32 bins, which is **two** periods at ν = 1 and 3 at ν = 1.5 — so the DFT of
 * that sequence is a comb, nonzero only at every second or third bin. The rung
 * survives it because it reads the support edge off the envelope with a 2%
 * threshold, and the envelope is right; a curve drawn through the bins is a
 * picket fence oscillating between 0 and 1, which is a drawing of the lattice
 * rather than of the transfer.
 *
 * So the window is **derived**, not chosen: it must not exceed one period at the
 * highest ν plotted. At 64 bins and ν = 1.5 that period is 10.67 waves, so ±4
 * (a window of 8) clears it with margin — and the bin it gives, 1/8, happens to
 * represent every edge the law predicts (0.75, 1.00, 0.75) exactly, so the check
 * on screen is an equality rather than a rounding. Measured: all three edges land
 * on their law to 0.00 bins, and the second difference of the curve falls from
 * 1.375 at § 6k.4's sampling to 0.086.
 */
export const CONE_PUPIL_SAMPLES = 64;
export const CONE_SIZE = 128;
export const CONE_HALF_WAVES = 4;
const CONE_STEP = 0.25;
const CONE_STACK = Array.from(
  { length: Math.round((2 * CONE_HALF_WAVES) / CONE_STEP) },
  (_, i) => -CONE_HALF_WAVES + i * CONE_STEP,
);

/**
 * The axial-response sweep — fine in w₂₀, and deliberately coarse elsewhere.
 *
 * It reads one number per kernel, the value at the DC pixel, and that number is
 * `|Σ P|²` over the pupil lattice divided by a normalization that defocus cannot
 * move. **The grid is therefore free**: measured, the whole response curve at
 * grid 64 matches grid 128 to 1e-14, and so does the ν = 1 spectrum. So this
 * sweep runs on the smallest grid a 32-bin pupil fits (64²) and spends what it
 * saves on w₂₀ resolution instead — 1/32 of a wave, which is what makes the peak
 * offset below a measurement rather than a bracket. The peak position is
 * identical at 32 and 64 bins for every objective in the catalogue.
 */
export const AXIAL_PUPIL_SAMPLES = 32;
export const AXIAL_SIZE = 64;
const RESPONSE_STEP = 1 / 32;
const RESPONSE_HALF_WAVES = 2;

/**
 * [sin(πw)/(πw)]² — the on-axis intensity of a defocused circular pupil.
 *
 * The **closed form**, drawn as the reference curve; the engine's own series is
 * measured beside it. § 6k.1 pins that an ideal pupil reproduces this to
 * 7.6e-3 at 32 bins across the pupil and 2.0e-3 at 64, so the ideal control is a
 * quoted ladder number rather than a third curve — A4's posture with § 6i.3's
 * lattice residual, kept.
 *
 * Worth two things beyond itself: 8/π² = 0.8106 at the quarter wave IS the
 * Rayleigh criterion and § 2b's Maréchal Strehl seen from the axial side, and it
 * is **exactly zero at every integer wave** — all the light in the rings, and the
 * total unmoved.
 */
export function axialSincSq(waves: number): number {
  if (waves === 0) return 1;
  const a = Math.PI * waves;
  return (Math.sin(a) / a) ** 2;
}

/** The object-space medium the specimen's millimetres are measured in. */
export function objectMediumOf(system: OpticalSystem): { name: string; index: number } {
  const name = system.prescription.objectMedium ?? "AIR";
  return { name, index: getMedium(name).n(LAMBDA_NM) };
}

export interface VolumeRequest {
  readonly kind: MicroscopeKind;
  /** Frequency bins across the pupil diameter — also the crop, in cells (§ 6h). */
  readonly pupilSamples: number;
  /** Grid size, a power of two. Buys PSF sampling, NOT field. */
  readonly size: number;
  /** Planes in the slab, odd. They step by exactly one depth of focus. */
  readonly planes: number;
  /** Which plane the objective is focused on, in planes from the middle. */
  readonly focusPlane: number;
  /** Beads on every plane, so each one emits the same flux before rasterizing. */
  readonly beadsPerPlane: number;
  readonly seed: number;
}

export interface VolumeReadout {
  readonly size: number;
  /** Intensity in the object's own coordinates — the panel maps it to grey. */
  readonly intensity: Float64Array;
  readonly peak: number;
  readonly meanIntensity: number;
  /**
   * peak ÷ mean — signal against haze, as one number.
   *
   * The in-focus bead is the peak and the haze is what everything else spread
   * into, so this falls as the slab thickens and it is the panel's headline
   * reading. Measured on the DIN 4×: 33.0 at one plane, 7.9 at nine, 3.3 at
   * twenty-seven.
   */
  readonly peakOverMean: number;

  /** The lateral crop, across the whole frame, on the specimen (µm) — A1's number. */
  readonly objectSpanUm: number;
  /** The AXIAL crop: planes × depth of focus (µm). Its neglected companion. */
  readonly slabThicknessUm: number;
  readonly depthOfFocusUm: number;
  readonly objectPixelNm: number;
  readonly tracedNA: number;
  readonly abbeResolutionNm: number;
  /** Where the specimen's millimetres are measured — air, or the cover glass. */
  readonly objectMedium: string;
  readonly objectMediumIndex: number;

  /** Beads that landed on the grid, per plane, and in total. */
  readonly placedTotal: number;
  readonly placedMin: number;
  readonly placedMax: number;
  readonly requestedTotal: number;

  /**
   * The image's in-focus share, and the specimen's own emitted share of the same
   * planes — § 6k.2 as a live identity rather than a claim.
   *
   * They agree to ~1e-16 **because** every plane delivers its whole flux: the
   * image's in-focus fraction is then the specimen's, and the instrument does not
   * enter. `equalFluxIdeal` is 1/planes, what the two would be if every plane
   * held the same landed bead count; the gap between it and the emitted share is
   * beads lost off the grid edge, which is the scene and not the optics.
   *
   * **`null` when nothing landed** — a ratio to zero, and A3's rule (a readout
   * whose value is undefined must be refused, not printed as zero) cuts here
   * exactly as it did on A4's conservation residual. `renderVolume` returns a
   * guarded 0 in that case, and a guarded 0 beside "the haze law holds" would be
   * a false claim rather than a missing one.
   */
  readonly inFocusFraction: number | null;
  readonly emittedInFocusShare: number | null;
  readonly equalFluxIdeal: number;

  /**
   * Worst drift of (slice flux ÷ slice emitted) from the first plane's.
   *
   * § 6k.1's invariance, measured on the render the panel is showing: the ratio
   * is each plane's own throughput, and under pure defocus it is the same number
   * for every plane. Reads ~1e-14. It is deliberately NOT read off the kernels'
   * own totals — those are normalized to 1 and would report the identity by
   * arithmetic, which is the trap `formedSum` exists to avoid.
   */
  readonly throughputDrift: number;
  /** Total light in the image. Does not move when the focus slider does. */
  readonly totalLight: number;

  /**
   * The worst-defocused slice's kernel energy outside the frame's inscribed
   * circle — what crossing the grid guard actually looks like.
   *
   * A pupil sampled on a lattice has a **periodic** PSF, so once the true kernel
   * is wider than one period its tails fold back in and the frame fills with a
   * false uniform glow. Measured on an ideal pupil at 32 bins: 4.5e-3 in focus
   * (the Airy wings, a fixed cost), 4.6e-2 at four waves, 0.30 at six — and a
   * kernel that has completely filled the grid reads the geometric 1 − π/4 =
   * 0.2146, which is why the number stops rising rather than running to 1.
   * Raising the **grid** does not help (measured identical at 128 and 256); only
   * raising `pupilSamples` does.
   */
  readonly worstSliceOutsideFraction: number;
  /** The defocus of the worst slice, in waves — (planes−1)·DOF at an end focus. */
  readonly worstSliceWaves: number;

  /** The guard: `abbeImage`'s DFT-lattice criterion, worst over the slices. */
  readonly maxGridPhaseStepWaves: number;
  /** RMS OPD on axis, straight from the trace — A1's convention, no focus solve. */
  readonly axisRmsWaves: number;
  readonly elapsedMs: number;
}

export type VolumeResult =
  | { readonly ok: true; readonly readout: VolumeReadout }
  | { readonly ok: false; readonly error: string };

export interface VolumeJob {
  readonly seq: number;
  readonly request: VolumeRequest;
}
export interface VolumeDone {
  readonly seq: number;
  readonly result: VolumeResult;
}

/**
 * Beads scattered over the frame, the same count on every plane.
 *
 * Equal counts per plane so that the slab's flux is uniform in z before
 * rasterizing — which is what makes `inFocusFraction` land on 1/planes and lets
 * the departure from it be attributed to beads lost at the grid edge. The RNG
 * runs straight through the planes, so plane k's beads are fixed once the seed
 * is: adding planes adds specimen around what is already there rather than
 * reshuffling it.
 */
function beadSlices(
  system: OpticalSystem,
  frame: ReturnType<typeof buildFrame>["frame"],
  planes: number,
  beadsPerPlane: number,
  seed: number,
  depthStepMm: number,
): EmitterSlice[] {
  const rng = mulberry32(seed);
  const half = frame.objectHalfExtentMm;
  const slices: EmitterSlice[] = [];
  for (let k = 0; k < planes; k++) {
    const emitters: PointEmitter[] = [];
    for (let i = 0; i < beadsPerPlane; i++) {
      emitters.push({
        xMm: (2 * rng.next() - 1) * half,
        yMm: (2 * rng.next() - 1) * half,
        flux: BEAD_FLUX,
      });
    }
    slices.push({
      zMm: (k - (planes - 1) / 2) * depthStepMm,
      field: rasterizeEmitters(system, frame, emitters),
    });
  }
  return slices;
}

/** Fraction of a DC-at-0 kernel outside the grid's inscribed circle. */
function outsideInscribedCircle(values: Float64Array, n: number): number {
  const r2 = (n / 2) * (n / 2);
  let outside = 0;
  for (let y = 0; y < n; y++) {
    const dy = y < n / 2 ? y : y - n;
    for (let x = 0; x < n; x++) {
      const dx = x < n / 2 ? x : x - n;
      if (dx * dx + dy * dy > r2) outside += values[y * n + x]!;
    }
  }
  return outside;
}

/**
 * Render one focus stack and read everything off it.
 *
 * The slices step by exactly **one depth of focus** and the focus does too, so
 * exactly one plane lies inside the ±½ DOF window at every setting — which is
 * what makes "the in-focus fraction does not move while you scrub" a real
 * invariant rather than an approximate one. Half-DOF focus steps would tie two
 * planes on the window's `<=` boundary and the fraction would flicker between
 * 1/N and 2/N for a reason that is about the window and not about the specimen.
 *
 * Rasterizing every plane is measured at 1–3 ms against 130–700 ms of rendering,
 * so the scene is rebuilt per job and not memoized: a cache keyed on the scene
 * would save under 1% and would have to be invalidated on six controls.
 */
export function renderVolumeScene(request: VolumeRequest): VolumeResult {
  const started = performance.now();
  try {
    const { system, frame } = buildFrame({
      kind: request.kind,
      pupilSamples: request.pupilSamples,
      size: request.size,
    });
    const tracedNA = objectNumericalAperture(system, LAMBDA_NM);
    const medium = objectMediumOf(system);
    const dofMm = depthOfFocusMm(LAMBDA_NM, tracedNA, medium.index);
    const axis = fieldPupilAt(system, frame, 0.5, 0.5);

    const slices = beadSlices(
      system,
      frame,
      request.planes,
      request.beadsPerPlane,
      request.seed,
      dofMm,
    );
    const emitted = slices.map((s) => {
      let t = 0;
      for (let i = 0; i < s.field.values.length; i++) t += s.field.values[i]!;
      return t;
    });
    const emittedTotal = emitted.reduce((a, b) => a + b, 0);

    const image = renderVolume({ size: request.size, slices }, defocusing(axis.pupil), {
      pupilSamples: request.pupilSamples,
      numericalAperture: tracedNA,
      wavelengthNm: LAMBDA_NM,
      refractiveIndex: medium.index,
      focusMm: request.focusPlane * dofMm,
      scale: frame.scale,
    });

    let peak = 0;
    let totalLight = 0;
    for (let i = 0; i < image.intensity.length; i++) {
      const v = image.intensity[i]!;
      totalLight += v;
      if (v > peak) peak = v;
    }

    // Each plane's own throughput, which pure defocus may not move. Read as
    // flux ÷ emitted rather than off the kernels, whose totals are normalized.
    let throughputDrift = 0;
    const reference = emitted[0]! > 0 ? image.sliceFlux[0]! / emitted[0]! : Number.NaN;
    for (let i = 0; i < slices.length; i++) {
      if (!(emitted[i]! > 0) || !Number.isFinite(reference) || reference === 0) continue;
      throughputDrift = Math.max(
        throughputDrift,
        Math.abs(image.sliceFlux[i]! / emitted[i]! / reference - 1),
      );
    }

    // The specimen's own in-focus share, against which the image's is checked.
    const focusIndex = Math.round(request.focusPlane + (request.planes - 1) / 2);
    const emittedInFocus =
      focusIndex >= 0 && focusIndex < emitted.length ? emitted[focusIndex]! : 0;

    // What the worst-defocused plane's kernel does to the grid. One extra
    // transform, and it is the concrete symptom the guard beside it predicts.
    const worstOffsetMm =
      Math.max(
        ...slices.map((s) => Math.abs(s.zMm - request.focusPlane * dofMm)),
      );
    const worstSliceWaves =
      (worstOffsetMm * tracedNA * tracedNA) / (2 * medium.index * LAMBDA_NM * 1e-6);
    const worstKernel = incoherentPsf(withDefocus(axis.pupil, worstSliceWaves), {
      pupilSamples: request.pupilSamples,
      size: request.size,
    });

    const placed = emitted.map((e) => Math.round(e / BEAD_FLUX));
    const placedTotal = placed.reduce((a, b) => a + b, 0);
    const objectSpanUm = 2 * frame.objectHalfExtentMm * 1000;

    return {
      ok: true,
      readout: {
        size: request.size,
        intensity: image.intensity,
        peak,
        meanIntensity: totalLight / (request.size * request.size),
        peakOverMean: totalLight > 0 ? (peak * request.size * request.size) / totalLight : 0,
        objectSpanUm,
        slabThicknessUm: request.planes * dofMm * 1000,
        depthOfFocusUm: dofMm * 1000,
        objectPixelNm: frame.objectPixelScaleMm * 1e6,
        tracedNA,
        abbeResolutionNm: abbeResolutionMm(LAMBDA_NM, tracedNA) * 1e6,
        objectMedium: medium.name,
        objectMediumIndex: medium.index,
        placedTotal,
        placedMin: Math.min(...placed),
        placedMax: Math.max(...placed),
        requestedTotal: request.planes * request.beadsPerPlane,
        inFocusFraction: emittedTotal > 0 ? image.inFocusFraction : null,
        emittedInFocusShare: emittedTotal > 0 ? emittedInFocus / emittedTotal : null,
        equalFluxIdeal: 1 / request.planes,
        throughputDrift,
        totalLight,
        worstSliceOutsideFraction: outsideInscribedCircle(worstKernel.values, request.size),
        worstSliceWaves,
        maxGridPhaseStepWaves: image.maxGridPhaseStepWaves,
        axisRmsWaves: axis.rmsWaves,
        elapsedMs: performance.now() - started,
      },
    };
  } catch (cause) {
    // § 6b's and § 6d's design ceilings arrive here as the engine's own words,
    // exactly as they do in A1, A2 and A4.
    return { ok: false, error: (cause as Error).message };
  }
}

/**
 * Grey from the image's own peak — A4's convention, and for A4's reason.
 *
 * A bead field is sparse, so white at twice the mean would clip every blob into a
 * flat disc. It matters slightly less here (the haze lifts the mean, and
 * `peakOverMean` runs 33 down to 3 as the slab thickens) and the convention is
 * kept anyway, because the panel's claim is a *comparison across thickness* and a
 * scale that moved with the mean would hide the very change being measured.
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

/** One lateral frequency's axial spectrum, ready to draw. */
export interface ConeCurve {
  readonly nu: number;
  /** Axial frequency, cycles per wave of defocus. */
  readonly cyclesPerWave: readonly number[];
  /** Magnitude, each curve normalized to its OWN peak — see `axialResponse`. */
  readonly magnitude: readonly number[];
  /** ν·(2 − ν), the closed-form support boundary. */
  readonly edgeLaw: number;
  /** Where the measured magnitude last exceeds 2% of its peak. */
  readonly edgeMeasured: number;
  /**
   * |measured − law| in axial bins, which is the unit the comparison lives in.
   *
   * § 6k.4 pins the edge to **within one bin** and says why the tolerance is not
   * free: a finite stack convolves the sharp support boundary with its own
   * window transform, so the edge leaks. Printing the raw pair alone makes a
   * one-bin agreement read as a miss — the well-corrected rows land on their law
   * exactly at this sampling and the DIN 4×/0.10, carrying 0.14 waves of
   * spherical, is one bin wide at ν = 0.5.
   */
  readonly edgeBins: number;
  /** Worst non-DC bin ÷ DC bin. At ν = 0 this is the missing cone itself. */
  readonly worstNonDc: number;
}

export interface AxialSweep {
  /** Defocus in waves, and the measured on-axis intensity ÷ its value at w = 0. */
  readonly waves: readonly number[];
  readonly measured: readonly number[];
  /**
   * Where the measured axial response peaks, and how much brighter it is than
   * the plane the system calls its image plane.
   *
   * **Not zero on a traced pupil**, and that is this surface's own finding rather
   * than a caveat. A1 reports σ as traced, about the pupil's own mean at the
   * system's own image plane with no best-focus solve, and a residual defocus is
   * exactly what that convention leaves in. The axial response locates it:
   * measured at 32 bins, the DIN 4×/0.10 peaks 0.430 waves away and is 1.79×
   * brighter there, while the infinity 20×/0.10 peaks 0.023 waves away and is
   * 1.002× brighter.
   */
  readonly peakWaves: number;
  readonly peakRatio: number;
  /** True when the peak sits at the sweep's edge, so it is a bound not a value. */
  readonly peakAtEdge: boolean;
  /**
   * |peakWaves| / (2√3) — the RMS a defocus of that size carries on its own.
   *
   * A pure defocus W = w·ρ² has σ = w/(2√3) over the unit circle. Comparing it
   * with the traced σ says how much of A1's number is *focus* rather than
   * aberration, which is what A1's caption claims in words ("red ⇒ not at this
   * focus, not not-correctable") and cannot check.
   *
   * The comparison is worth most exactly where A1's number is worst. For the
   * three objectives whose traced σ exceeds λ/14 it accounts for **90%, 92% and
   * 100%** (DIN 4×/0.10, oil 100×/1.25, oil 100×/1.40): their red is focus and
   * almost nothing else. For the well-corrected rows the offset is one or two of
   * the sweep's own 1/32-wave steps, so the share there is quantized by the
   * sweep rather than measured — the Lister reads 64% off a single step — and
   * the panel does not pretend otherwise.
   */
  readonly defocusSigmaWaves: number;
}

export interface AxialReadout {
  readonly kind: MicroscopeKind;
  readonly sweep: AxialSweep;
  readonly cones: readonly ConeCurve[];
  /** The traced σ this objective carries on axis, for the sweep's comparison. */
  readonly axisRmsWaves: number;
  /** Worst |relativeThroughput − 1| over the axial stack. § 6k.1, on a trace. */
  readonly throughputDrift: number;
  /**
   * The cone stack's OWN grid guard, which is not the picture's.
   *
   * A different quantity answering a different question: the picture's says
   * whether the frame it is drawing is honest, this one whether the pupil is
   * carried at the stack's worst-defocused member. They are shown separately for
   * the same reason A3 keeps its plot's ν sampling apart from its image's pupil
   * sampling. Note that the window is set by the period law above and not by this
   * guard — § 6k.4's ±8 at 32 bins would read 1.10 here, and it is the comb
   * rather than the phase step that rules the window out.
   */
  readonly stackGridPhaseStepWaves: number;
  /** The window the cone stack spans, and the period that bounded it. */
  readonly coneWindowWaves: number;
  readonly conePeriodWaves: number;
  readonly elapsedMs: number;
}

export type AxialResult =
  | { readonly ok: true; readonly readout: AxialReadout }
  | { readonly ok: false; readonly error: string };

/** The axial job depends on the objective alone — not the scene, not the focus. */
export type AxialRequest = Pick<VolumeRequest, "kind">;

export interface AxialJob {
  readonly seq: number;
  readonly request: AxialRequest;
}
export interface AxialDone {
  readonly seq: number;
  readonly result: AxialResult;
}

/** ν = 2·bin/pupilSamples — `illumination/transfer`'s own frequency scale. */
const CONE_BINS = [0, CONE_PUPIL_SAMPLES / 4, CONE_PUPIL_SAMPLES / 2, (3 * CONE_PUPIL_SAMPLES) / 4];
/** The highest ν drawn, which is what bounds the window through P = ps/(4ν). */
const CONE_TOP_NU = (2 * CONE_BINS[CONE_BINS.length - 1]!) / CONE_PUPIL_SAMPLES;

/**
 * The two curves — the axial response, and the missing cone.
 *
 * Both are read off the **traced** on-axis pupil, and for the cone that is the
 * point: the ν = 0 null is a statement about `relativeThroughput` alone, so it
 * holds for any pupil whose amplitude does not vary with depth, aberrated or not.
 * Measured on the traced DIN 4×/0.10 it reads **1.17e-15**. The missing cone is
 * not an artifact of an ideal lens, and a panel that only ever showed it on
 * `idealPupil` would leave that open.
 *
 * Each cone curve is normalized to its **own peak** rather than to its DC bin,
 * because away from ν = 0 the peak is not at DC — the OTF oscillates with
 * defocus, so its axial transform concentrates at nonzero μ (measured 1.005 ×
 * DC at ν = 0.25). Normalizing by DC would push curves past 1 for a reason that
 * is about where the peak sits, not about how much is transmitted.
 *
 * The two halves run at **different samplings**, each derived from what it needs:
 * the response wants w₂₀ resolution and is indifferent to the grid, the cone
 * wants a lattice period longer than its window. Measured at 518–545 ms for the
 * whole job under `vite-node` across the catalogue, and ~1.2 s in the browser —
 * A4's ~2.3× again, and well past what a `setTimeout` deferral would cover.
 */
export function axialResponse(request: AxialRequest): AxialResult {
  const started = performance.now();
  try {
    const response0 = buildFrame({
      kind: request.kind,
      pupilSamples: AXIAL_PUPIL_SAMPLES,
      size: AXIAL_SIZE,
    });
    const axis = fieldPupilAt(response0.system, response0.frame, 0.5, 0.5);
    const options = { pupilSamples: AXIAL_PUPIL_SAMPLES, size: AXIAL_SIZE };

    const steps = Math.round((2 * RESPONSE_HALF_WAVES) / RESPONSE_STEP);
    const waves = Array.from({ length: steps + 1 }, (_, i) => -RESPONSE_HALF_WAVES + i * RESPONSE_STEP);
    const response = depthKernels(defocusing(axis.pupil), waves, options);
    const atFocus = response[steps / 2]!.values[0]!;
    const measured = response.map((k) => k.values[0]! / atFocus);
    let peakRatio = 0;
    let peakIndex = 0;
    measured.forEach((v, i) => {
      if (v > peakRatio) {
        peakRatio = v;
        peakIndex = i;
      }
    });
    const peakWaves = waves[peakIndex]!;

    const cone0 = buildFrame({
      kind: request.kind,
      pupilSamples: CONE_PUPIL_SAMPLES,
      size: CONE_SIZE,
    });
    const conePupil = fieldPupilAt(cone0.system, cone0.frame, 0.5, 0.5).pupil;
    const kernels = depthKernels(defocusing(conePupil), CONE_STACK, {
      pupilSamples: CONE_PUPIL_SAMPLES,
      size: CONE_SIZE,
    });
    let throughputDrift = 0;
    let stackGridPhaseStepWaves = 0;
    for (const k of kernels) {
      throughputDrift = Math.max(throughputDrift, Math.abs(k.relativeThroughput - 1));
      stackGridPhaseStepWaves = Math.max(stackGridPhaseStepWaves, k.maxGridPhaseStepWaves);
    }

    const cones: ConeCurve[] = CONE_BINS.map((bin) => {
      const nu = (2 * bin) / CONE_PUPIL_SAMPLES;
      const spectrum = axialSpectrum(axialTransfer(kernels, bin));
      let peak = 0;
      for (const m of spectrum.magnitude) peak = Math.max(peak, m);
      let edgeMeasured = 0;
      let worstNonDc = 0;
      for (let b = 0; b < spectrum.magnitude.length; b++) {
        // 2% of the peak, which is what the finite window costs: a truncated
        // stack convolves the sharp support edge with the window's own
        // transform and leaks past it. § 6k.4 states the same threshold for the
        // same reason rather than tightening it and reading one bin high.
        if (spectrum.magnitude[b]! > 0.02 * peak) edgeMeasured = spectrum.cyclesPerWave[b]!;
        if (b > 0) worstNonDc = Math.max(worstNonDc, spectrum.magnitude[b]! / spectrum.magnitude[0]!);
      }
      const binWidth = 1 / (CONE_STEP * CONE_STACK.length);
      return {
        nu,
        cyclesPerWave: Array.from(spectrum.cyclesPerWave),
        magnitude: Array.from(spectrum.magnitude, (m) => (peak > 0 ? m / peak : 0)),
        edgeLaw: missingConeEdge(nu),
        edgeMeasured,
        edgeBins: Math.abs(edgeMeasured - missingConeEdge(nu)) / binWidth,
        worstNonDc,
      };
    });

    return {
      ok: true,
      readout: {
        kind: request.kind,
        sweep: {
          waves,
          measured,
          peakWaves,
          peakRatio,
          peakAtEdge: peakIndex === 0 || peakIndex === measured.length - 1,
          defocusSigmaWaves: Math.abs(peakWaves) / (2 * Math.sqrt(3)),
        },
        cones,
        axisRmsWaves: axis.rmsWaves,
        throughputDrift,
        stackGridPhaseStepWaves,
        coneWindowWaves: 2 * CONE_HALF_WAVES,
        conePeriodWaves: CONE_PUPIL_SAMPLES / (4 * CONE_TOP_NU),
        elapsedMs: performance.now() - started,
      },
    };
  } catch (cause) {
    return { ok: false, error: (cause as Error).message };
  }
}
