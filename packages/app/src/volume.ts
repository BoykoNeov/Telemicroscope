import {
  axialSpectrum,
  axialTransfer,
  defocusing,
  depthKernels,
  depthOfFocusMm,
  fieldPupilAt,
  incoherentPsf,
  missingConeEdge,
  mountAperture,
  mountDefocusWaves,
  mountPupils,
  mountVolumeOptions,
  mountWavefrontWaves,
  rasterizeEmitters,
  renderVolume,
  withDefocus,
  withMountAberration,
  type EmitterSlice,
  type MountSpec,
  type PointEmitter,
} from "@telemicroscope/core/imaging";
import { mountDepthTolerance } from "@telemicroscope/core/designs";
import { idealPupil } from "@telemicroscope/core/illumination";
import { getMedium } from "@telemicroscope/core/materials";
import { mulberry32 } from "@telemicroscope/core/math";
import { abbeResolutionMm, objectNumericalAperture } from "@telemicroscope/core/pupil";
import type { OpticalSystem } from "@telemicroscope/core/trace";
import type { PupilFunction } from "@telemicroscope/core/wave";
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
 * ## The mount — § 6l, and the stack stops being symmetric
 *
 * A5's stated omission, filled at D10. A specimen is mounted in something whose
 * index is not the one the objective was corrected for, so focusing d below the
 * slip drags the cone through d of the wrong medium and adds spherical aberration
 * **that grows with d**. `mountPupils` is the `DepthPupils` this module used to
 * fill with `defocusing`, and the two questions § 6l refuses to blur appear here
 * as two different jobs:
 *
 *  - **the SA tracks the slice** — the picture and the cone, `mountPupils`, each
 *    plane looking through its own thickness of mount;
 *  - **the SA is fixed and the focus sweeps** — the axial response and the Strehl
 *    curve, `defocusing(withMountAberration(...))`, one emitter at a known depth.
 *
 * The four coupled numbers `renderVolume` needs are **not passed by this module**.
 * `mountVolumeOptions` emits NA, λ, the index and the focus from the same
 * `MountSpec` the pupils were built from, because W = ½·δ·NA²/n and the n there
 * is the *mount* — get it wrong and every slice is aberrated for a depth 14% off,
 * silently, with nothing in the image to show it (§ 6l.9).
 *
 * A **matched** mount returns the pupil object itself — no arithmetic at all, an
 * explicit (n_s²−n_i²) factor and not a small residual — so every § 6k result
 * this module ever printed survives unchanged. That is § 6l.9's identity rung
 * showing up as a UI invariant rather than as a claim.
 *
 * ## One rule the engine had no reason to state
 *
 * **No plane may sit above the coverslip.** The volume's z origin is the slip's
 * underside, and a plane at negative z crosses only the slip and the immersion —
 * exactly what the objective was corrected for — so its aberration is zero. The
 * stack is linear in depth and would instead continue through negative thickness
 * and sign the mismatch backwards. Nothing in § 6l is wrong about that; it is
 * simply not a question that arises until a panel has to *place* a slab. Both
 * places one gets placed here are anchored at their shallowest member, so
 * negative depth is unreachable rather than clamped.
 *
 * ## What is deliberately absent
 *
 * **No `hazeKernel`.** It collapses a stack into one kernel and is exact only for
 * a specimen uniform in z. A bead field is not one, so quoting it beside these
 * numbers would be a category error — § 6k.6's whole content is that over z the
 * sum does not factor.
 */

/** Every bead emits the same power, A4's convention — so a difference is optics. */
export const BEAD_FLUX = 1;

/**
 * Where the "wavefront at the rim" readouts are actually evaluated, as a fraction
 * of the delivered aperture — and 1 is the wrong answer, for § 6l.9's reason.
 *
 * The delivered NA is a **supremum and not a maximum**: q = n_s·sinθ_s is
 * strictly below n_s, and `mountWavefrontWaves` returns 0 outside the delivered
 * aperture, boundary included, because beyond it the pupil is dark. Asking it for
 * the wavefront *at* a truncating ceiling therefore reads a clean 0 for the most
 * aberrated configuration on the panel — the same trap `mountDepthTolerance`
 * refuses outright rather than answering. So the readout is quoted just inside,
 * at a stated fraction, and says so. Where the mount carries the whole pupil
 * (every matched row, and every dry objective) nothing is truncated and this is
 * simply 0.99 of the objective's own rim.
 */
export const WAVEFRONT_RHO = 0.99;

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

/**
 * What the specimen is mounted in — `"matched"` being the objective's own object
 * medium, which aberrates a hard zero at every depth and every aperture.
 *
 * A sentinel rather than a medium name because the matched medium **is not the
 * same medium on every row**: `objectMedium` is AIR for the dry objectives and
 * the cover glass D263 for the oil ones (§ 6e puts the specimen under the slip),
 * so a fixed default would be matched on some rows and mismatched on others while
 * reading identically. `AIR` is offered separately anyway, since a dry specimen
 * under an oil cone is both a real mistake and the sharpest demonstration of
 * § 6l.3's wall: an objective engraved 1.40 collects **1.0** from it.
 */
export const MOUNT_MEDIA = ["matched", "WATER", "IMMERSION-OIL", "AIR"] as const;
export type MountChoice = (typeof MOUNT_MEDIA)[number];

export interface ResolvedMount {
  readonly name: string;
  readonly index: number;
  /** The index the objective was corrected for — `objectMedium`, not the oil. */
  readonly immersionName: string;
  readonly immersionIndex: number;
  /** Identical indices: § 6l.2's hard zero, at every depth and aperture. */
  readonly matched: boolean;
}

export function resolveMount(system: OpticalSystem, choice: MountChoice): ResolvedMount {
  const medium = objectMediumOf(system);
  const name = choice === "matched" ? medium.name : choice;
  const index = choice === "matched" ? medium.index : getMedium(name).n(LAMBDA_NM);
  return {
    name,
    index,
    immersionName: medium.name,
    immersionIndex: medium.index,
    // Compared on the index and not on the name: `matched` resolves to the
    // object medium, and picking that same medium off the list must reach the
    // identical branch rather than a near-miss that looks like physics.
    matched: index === medium.index,
  };
}

/**
 * The spec every job here is built from — one place, so the four coupled numbers
 * cannot drift between the picture, the axial sweep and the depth curve.
 *
 * `numericalAperture` is the objective's own traced NA and **not** the delivered
 * one: it is the pupil's coordinate scale (q = NA·ρ), and `mountAperture` is what
 * turns the mount's ceiling into an amplitude. Passing the delivered NA here
 * would rescale the pupil instead of masking it.
 */
export function mountSpecFor(
  mount: ResolvedMount,
  numericalAperture: number,
  focusDepthMm: number,
): MountSpec {
  return {
    mountIndex: mount.index,
    immersionIndex: mount.immersionIndex,
    numericalAperture,
    wavelengthNm: LAMBDA_NM,
    focusDepthMm,
  };
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
  /** What the specimen sits in — `"matched"` is the objective's own medium. */
  readonly mount: MountChoice;
  /**
   * How deep below the slip the **shallowest** plane of the slab sits (µm).
   *
   * The top face and not the middle, and the choice is physics rather than
   * taste. The volume's z origin is the slip's underside, so a slice's `zMm` IS
   * its depth in the mount — and a plane at negative z is *above* the slip,
   * where there is no mount to look through: its light crosses the slip and the
   * immersion, which is exactly what the objective was corrected for, so its
   * aberration is zero. The stack is linear in depth and would happily continue
   * through negative thickness and hand such a plane the aberration of a
   * mismatch with the **wrong sign**. Anchoring the control to the top face puts
   * every plane at z ≥ 0 for every setting, so the question never arises and no
   * clamp has to hide it.
   */
  readonly depthUm: number;
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
   * twenty-seven. **`null` for an empty frame**, where it is 0/0 — the same
   * refusal as the two above, since a printed 0 would read as "no signal at all"
   * for a frame that has no specimen in it either.
   */
  readonly peakOverMean: number | null;

  /** The lateral crop, across the whole frame, on the specimen (µm) — A1's number. */
  readonly objectSpanUm: number;
  /** The AXIAL crop: planes × depth of focus (µm). Its neglected companion. */
  readonly slabThicknessUm: number;
  readonly depthOfFocusUm: number;
  readonly objectPixelNm: number;
  readonly tracedNA: number;
  /**
   * min(NA, n_s) — what the mount actually delivers into this objective.
   *
   * § 6l.3, and it is **not an aberration**: a ray inside the specimen carries
   * q = n_s·sinθ_s < n_s, so an objective engraved 1.40 collects 1.3334 from a
   * water mount and the outer annulus of its pupil is simply dark. A readout
   * rather than a blur, and the resolution below is quoted at it.
   */
  readonly deliveredNA: number;
  /** λ/(2·NA) at the **delivered** NA — the cell the mount leaves, not the rim's. */
  readonly abbeResolutionNm: number;
  /** Where the specimen's millimetres are measured — air, or the cover glass. */
  readonly objectMedium: string;
  readonly objectMediumIndex: number;
  /** The mount, and its index at this wavelength. Matched ⇒ a hard zero. */
  readonly mountMedium: string;
  readonly mountIndex: number;
  readonly mountMatched: boolean;
  /** Depth of the slab's top face, and of the plane the objective is focused on. */
  readonly slabDepthUm: number;
  readonly focusDepthUm: number;
  /**
   * The depth aberration at the focused plane, in waves at the delivered rim —
   * `mountWavefrontWaves`, referenced to that plane's own paraxial image.
   *
   * Zero for a matched mount at every depth, which is the identity and not a
   * small residual. It carries the sign: a mount **rarer** than the immersion
   * gives a negative wavefront, and the compensating defocus is positive.
   */
  readonly focusDepthWaves: number;

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
   * Worst drift of (slice flux ÷ slice emitted) across the planes that emitted.
   *
   * § 6k.1's invariance, measured on the render the panel is showing: the ratio
   * is each plane's own throughput, and under pure defocus it is the same number
   * for every plane. Reads ~1e-14. It is deliberately NOT read off the kernels'
   * own totals — those are normalized to 1 and would report the identity by
   * arithmetic, which is the trap `formedSum` exists to avoid.
   *
   * **`null` when fewer than two planes carry light**, which is A3's rule again
   * and it bites harder here than it looks: a drift accumulated over nothing at
   * all is 0 by initialization, and 0 is exactly the value that means "the
   * invariance holds perfectly". Printing it green beside that sentence would be
   * a false claim rather than a missing one. Reachable rather than
   * precautionary — at one bead per plane on the oil 100×/1.40's 2.65 µm crop
   * some 3% of beads fall off the grid, so an empty plane is a seed away — and
   * `planes` = 1 reaches it by construction, with one plane and nothing to
   * compare it to.
   */
  readonly throughputDrift: number | null;
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
  baseDepthMm: number,
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
      // Absolute depth below the slip, counted from the slab's top face: the
      // volume's z origin IS the slip's underside, so `mountPupils` can invert
      // `renderVolume`'s defocus back to the depth this plane sits at, and every
      // plane is at z >= 0 where the mount actually exists.
      zMm: baseDepthMm + k * depthStepMm,
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
    const mount = resolveMount(system, request.mount);
    // The geometry is in the MOUNT — `renderVolume` turns millimetres into waves
    // with W = ½·δ·NA²/n and that n is the medium the slices are measured in, so
    // the depth of focus that makes one plane step half a wave must carry the
    // same index. The step in MICRONS therefore moves when the mount does; the
    // step in waves does not, which is what `WAVES_PER_PLANE` depends on.
    const dofMm = depthOfFocusMm(LAMBDA_NM, tracedNA, mount.index);
    const axis = fieldPupilAt(system, frame, 0.5, 0.5);
    const slabDepthMm = request.depthUm * 1e-3;
    // The focus slider counts from the middle, the slab from its top face, so
    // the focused plane is `focusPlane` planes past the middle one.
    const focusDepthMm = slabDepthMm + (request.focusPlane + (request.planes - 1) / 2) * dofMm;
    const spec = mountSpecFor(mount, tracedNA, focusDepthMm);

    const slices = beadSlices(
      system,
      frame,
      request.planes,
      request.beadsPerPlane,
      request.seed,
      dofMm,
      slabDepthMm,
    );
    const emitted = slices.map((s) => {
      let t = 0;
      for (let i = 0; i < s.field.values.length; i++) t += s.field.values[i]!;
      return t;
    });
    const emittedTotal = emitted.reduce((a, b) => a + b, 0);

    // The four coupled numbers come from the spec, not from here — § 6l.9. The
    // type refuses to accept them and the runtime refuses them again, because a
    // volume rendered with an index its pupils were not built for aberrates every
    // slice for the wrong depth and looks entirely normal doing it.
    const image = renderVolume(
      { size: request.size, slices },
      mountPupils(axis.pupil, spec),
      mountVolumeOptions(spec, {
        pupilSamples: request.pupilSamples,
        scale: frame.scale,
      }),
    );

    let peak = 0;
    let totalLight = 0;
    for (let i = 0; i < image.intensity.length; i++) {
      const v = image.intensity[i]!;
      totalLight += v;
      if (v > peak) peak = v;
    }

    // Each plane's own throughput, which pure defocus may not move. Read as
    // flux ÷ emitted rather than off the kernels, whose totals are normalized.
    // The reference is the first plane that actually emitted, not plane 0: an
    // empty plane there would poison every comparison with a NaN and leave the
    // drift at its initialized 0, which is the value that means "exact".
    const ratios: number[] = [];
    for (let i = 0; i < slices.length; i++) {
      if (emitted[i]! > 0) ratios.push(image.sliceFlux[i]! / emitted[i]!);
    }
    let throughputDrift: number | null = null;
    if (ratios.length >= 2) {
      let worst = 0;
      for (const r of ratios) worst = Math.max(worst, Math.abs(r / ratios[0]! - 1));
      throughputDrift = worst;
    }

    // The specimen's own in-focus share, against which the image's is checked.
    const focusIndex = Math.round(request.focusPlane + (request.planes - 1) / 2);
    const emittedInFocus =
      focusIndex >= 0 && focusIndex < emitted.length ? emitted[focusIndex]! : 0;

    // What the worst-defocused plane's kernel does to the grid. One extra
    // transform, and it is the concrete symptom the guard beside it predicts.
    //
    // The defocus comes from `mountDefocusWaves` rather than from the map written
    // out here, and the kernel from `mountPupils` rather than from a bare
    // `withDefocus`: both are the § 6l.9 coupling, and a spill measured on an
    // unaberrated kernel printed beside an aberrated picture would be a reading
    // of a frame nobody is looking at.
    let worstSlice = slices[0]!;
    for (const s of slices) {
      if (Math.abs(s.zMm - focusDepthMm) > Math.abs(worstSlice.zMm - focusDepthMm)) worstSlice = s;
    }
    const worstSliceWaves = mountDefocusWaves(spec, worstSlice.zMm);
    const worstKernel = incoherentPsf(mountPupils(axis.pupil, spec)(worstSliceWaves), {
      pupilSamples: request.pupilSamples,
      size: request.size,
    });

    const rhoDelivered = mountAperture(spec) / tracedNA;
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
        peakOverMean:
          totalLight > 0 ? (peak * request.size * request.size) / totalLight : null,
        objectSpanUm,
        slabThicknessUm: request.planes * dofMm * 1000,
        depthOfFocusUm: dofMm * 1000,
        objectPixelNm: frame.objectPixelScaleMm * 1e6,
        tracedNA,
        deliveredNA: mountAperture(spec),
        abbeResolutionNm: abbeResolutionMm(LAMBDA_NM, mountAperture(spec)) * 1e6,
        objectMedium: medium.name,
        objectMediumIndex: medium.index,
        mountMedium: mount.name,
        mountIndex: mount.index,
        mountMatched: mount.matched,
        slabDepthUm: request.depthUm,
        focusDepthUm: focusDepthMm * 1000,
        focusDepthWaves: mountWavefrontWaves(spec, focusDepthMm, WAVEFRONT_RHO * rhoDelivered),
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
   * The response one wave **past** focus divided by one wave **before** it —
   * § 6l.7's asymmetry, read off this sweep rather than quoted.
   *
   * sinc²(π·w₂₀) is even, so an unaberrated pupil reads exactly 1 and a mount
   * makes it not. ±1 wave lands on this sweep's own 1/32 lattice exactly, so the
   * ratio is a pair of samples and not an interpolation. It carries the sign of
   * the mismatch: a mount rarer than the immersion (water under oil) aberrates
   * negative and the ratio runs **above** 1.
   *
   * **`null` when either sample is zero** — an integer wave is where the closed
   * form has its null, so the ratio is 0/0 territory on a well-corrected row, and
   * A3's rule says refuse rather than print. Reached in practice: the divisor is
   * the deep side of the response and a matched pupil puts it within 1e-3 of its
   * own null.
   */
  readonly asymmetry: number | null;
  /**
   * The same ratio on an **ideal** pupil through the same mount and depth, and on
   * the **traced** pupil with the depth taken back out.
   *
   * The confound this pair exists to remove is real and this panel already
   * measured it: A1 traces to the system's own image plane, so a row like the DIN
   * 4×/0.10 carries a residual defocus that moves its axial peak 0.44 waves —
   * which is an asymmetry about w₂₀ = 0 with no mount in it at all. `bare` is
   * that share (the mount's truncation only, depth zero), `ideal` is the mount's
   * own share with the objective removed, and the three together say which of the
   * two the curve on screen is showing. A matched mount makes all three equal by
   * construction rather than by rounding.
   */
  readonly asymmetryIdeal: number | null;
  readonly asymmetryBare: number | null;
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
  readonly mountMedium: string;
  readonly mountIndex: number;
  readonly mountMatched: boolean;
  readonly objectMedium: string;
  readonly objectMediumIndex: number;
  readonly tracedNA: number;
  readonly deliveredNA: number;
  /** The fixed depth the sweep's emitter sits at, and its wavefront (§ 6l.7). */
  readonly depthUm: number;
  readonly depthWaves: number;
  /**
   * The depths the cone stack's own slices span — it asks the volume question, so
   * it has a thickness of specimen behind it and this is what that is in µm.
   *
   * Its shallowest slice is the depth control and its deepest is
   * `coneWindowWaves` further, which moves with the mount's index because a wave
   * of defocus is four depths of focus and a depth of focus carries n.
   */
  readonly coneTopDepthUm: number;
  readonly coneBottomDepthUm: number;
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

/**
 * The axial job depends on the objective and the mount — not the scene, not the
 * focus slider.
 *
 * `depthUm` is the picture's slab depth read as **one emitter's** depth, which is
 * the second of § 6l's two questions: the aberration is fixed by that depth and
 * only the focus moves. The picture asks the first (each slice through its own
 * thickness), and the two give different curves, which is why the engine made a
 * caller compose the second rather than offering a flag.
 */
export type AxialRequest = Pick<VolumeRequest, "kind" | "mount" | "depthUm">;

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
    const tracedNA = objectNumericalAperture(response0.system, LAMBDA_NM);
    const mount = resolveMount(response0.system, request.mount);
    const depthMm = request.depthUm * 1e-3;
    // The focus is what sweeps, so the spec's own focus depth is the slip: the
    // emitter's depth enters through `withMountAberration` and nothing else.
    const spec = mountSpecFor(mount, tracedNA, 0);
    const fixedDepth = withMountAberration(axis.pupil, spec, depthMm);
    const dofMm = depthOfFocusMm(LAMBDA_NM, tracedNA, mount.index);

    const steps = Math.round((2 * RESPONSE_HALF_WAVES) / RESPONSE_STEP);
    const waves = Array.from({ length: steps + 1 }, (_, i) => -RESPONSE_HALF_WAVES + i * RESPONSE_STEP);
    const response = depthKernels(defocusing(fixedDepth), waves, options);
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

    // ±1 wave, which lands on this sweep's own 1/32 lattice exactly — so the
    // ratio is two samples and not an interpolation. `at` reads the same pair off
    // any pupil, which is what makes the two controls beside it comparable.
    const ratioAt = (pupil: PupilFunction): number | null => {
      const up = incoherentPsf(withDefocus(pupil, 1), options).values[0]!;
      const down = incoherentPsf(withDefocus(pupil, -1), options).values[0]!;
      return down > 0 ? up / down : null;
    };
    const oneWave = Math.round((1 + RESPONSE_HALF_WAVES) / RESPONSE_STEP);
    const minusOneWave = Math.round((-1 + RESPONSE_HALF_WAVES) / RESPONSE_STEP);
    const asymmetry =
      measured[minusOneWave]! > 0 ? measured[oneWave]! / measured[minusOneWave]! : null;

    const cone0 = buildFrame({
      kind: request.kind,
      pupilSamples: CONE_PUPIL_SAMPLES,
      size: CONE_SIZE,
    });
    const conePupil = fieldPupilAt(cone0.system, cone0.frame, 0.5, 0.5).pupil;
    // The cone asks the OTHER question — each plane of a volume through its own
    // thickness of mount — so it is `mountPupils` and not the fixed-depth pupil
    // above. § 6l.6 is the result to watch: the SA is a pure phase and the
    // truncation does not vary with depth, so the ν = 0 null survives it.
    //
    // Its focus is set so the SHALLOWEST slice of the stack lands on the depth
    // control, for the picture's reason: the stack spans ±CONE_HALF_WAVES about
    // the focus, and a slice above the slip has no mount to look through while
    // the layer, being linear in depth, would hand it a mismatch of the wrong
    // sign. One wave of defocus is four depths of focus by § 6j's definition
    // (half a wave each), so the offset is read off `depthOfFocusMm` rather than
    // by inverting `mountPupils`' own map by hand — which is the coupling § 6l.9
    // exists to keep out of a caller.
    const coneSpec = mountSpecFor(mount, tracedNA, depthMm + CONE_HALF_WAVES * 4 * dofMm);
    const kernels = depthKernels(mountPupils(conePupil, coneSpec), CONE_STACK, {
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
          asymmetry,
          asymmetryIdeal: ratioAt(withMountAberration(idealPupil(), spec, depthMm)),
          asymmetryBare: ratioAt(withMountAberration(axis.pupil, spec, 0)),
        },
        cones,
        mountMedium: mount.name,
        mountIndex: mount.index,
        mountMatched: mount.matched,
        objectMedium: mount.immersionName,
        objectMediumIndex: mount.immersionIndex,
        tracedNA,
        deliveredNA: mountAperture(spec),
        depthUm: request.depthUm,
        coneTopDepthUm: request.depthUm,
        coneBottomDepthUm: request.depthUm + 2 * CONE_HALF_WAVES * 4 * dofMm * 1000,
        depthWaves: mountWavefrontWaves(
          spec,
          depthMm,
          (WAVEFRONT_RHO * mountAperture(spec)) / tracedNA,
        ),
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

/**
 * Strehl against depth, and the gap between what the budget says and what the
 * bisection finds — § 6l.4 run per objective instead of quoted at NA 1.2.
 *
 * ## Why this is a third job and not part of the axial one
 *
 * It is a sweep **over** depth, so the depth slider must not move it. Keyed on
 * the objective and the mount alone, it recomputes when either changes and stays
 * put while the reader drags anything else — which is what "compute-once overlay"
 * has to mean for a control that is itself a depth.
 *
 * ## Two curves, because the budget is a statement about one of them
 *
 * `mountDepthTolerance` is the depth term's own budget: it knows nothing about
 * the objective in front of it. So the curve the quoted number may be compared
 * with is the **ideal** pupil at this NA through this mount, and comparing the
 * quoted budget with the traced curve instead would charge the depth for the
 * objective's own aberration. Both are drawn: the traced one is what the panel's
 * picture is actually made of, the gap between them is the objective, and on the
 * well-corrected rows they lie on top of each other.
 *
 * Each point is that pupil's peak intensity **at its own best focus**, divided by
 * the same quantity at zero depth. Referencing to depth zero rather than to an
 * unaberrated pupil is what isolates the depth: it divides out both the
 * objective's residual and the mount's aperture truncation, and it is legitimate
 * precisely because § 6l.6 pins the truncation as depth-**independent** — the
 * amplitude support is identical at every point on these curves.
 *
 * ## The floor is 0.950 and it is not the third-order form failing
 *
 * Maréchal's λ/14 is an *approximation* to Strehl 0.8: exp(−(2πσ)²) at
 * σ = λ/14 is 0.8177, and the σ that actually gives 0.8 is √(−ln 0.8)/(2π) =
 * 0.075181 waves. The wavefront is linear in depth, so a bisection at Strehl 0.8
 * runs 1.0525× deeper than the λ/14 coefficient allows whatever the aperture, and
 * the quoted-over-bisected ratio therefore floors at **0.9501** rather than at 1.
 * Measured: 0.95 at every dry row in the catalogue, where the third-order form
 * has nothing left to be wrong about. Everything above that floor is § 6l.4's
 * departure — the exact wavefront outrunning its own leading term as the aperture
 * approaches the *mount's* index, which is the smallest number in the stack.
 *
 * ## It reproduces the rung
 *
 * Run on an ideal pupil at § 6l.4's own probe (NA 1.2, water under IMMERSION-OIL)
 * this job returns **4.735 µm** against a quoted 21.34 µm — the rung's 4.74 µm and
 * **4.51×** — and it does so at grid 64 in 0.2 s where the ladder's brute-force
 * focus scan takes minutes. Two things buy that and neither touches the physics:
 * the golden section below, and `memoizedPupil`.
 */
export interface DepthRequest {
  readonly kind: MicroscopeKind;
  readonly mount: MountChoice;
}

export interface DepthPoint {
  readonly depthUm: number;
  /** Peak at best focus ÷ the same at zero depth — ideal pupil, and traced. */
  readonly ideal: number;
  readonly traced: number;
}

export interface DepthReadout {
  readonly kind: MicroscopeKind;
  readonly mountMedium: string;
  readonly mountIndex: number;
  readonly mountMatched: boolean;
  readonly objectMedium: string;
  readonly objectMediumIndex: number;
  readonly tracedNA: number;
  readonly deliveredNA: number;
  readonly curve: readonly DepthPoint[];
  /**
   * `mountDepthTolerance`'s Maréchal and quarter-wave depths (µm), or the
   * engine's own refusal — which is the readout on two of the panel's rows.
   *
   * A matched mount is refused because there is no budget to report on a hard
   * zero; an objective whose engraved NA the mount cannot deliver is refused
   * because the ceiling is **open** (q = n_s·sinθ_s is strictly below n_s), so
   * even the delivered aperture is not a value the budget may be quoted at. Both
   * are § 6l.9's supremum-and-not-maximum asymmetry, and the panel prints the
   * engine's sentence rather than an app paraphrase.
   */
  readonly quotedMarechalUm: number | null;
  readonly quotedQuarterUm: number | null;
  readonly quotedRefusal: string | null;
  /** Where the traced/ideal Strehl crosses 0.8, bisected. `null` = never here. */
  readonly bisectedIdealUm: number | null;
  readonly bisectedTracedUm: number | null;
  /** quoted ÷ bisected on the ideal curve — § 6l.4's over-report, for this NA. */
  readonly overReport: number | null;
  /** The 0.9501 the ratio floors at, and why it is not 1. See the header. */
  readonly marechalFloor: number;
  readonly elapsedMs: number;
}

export type DepthResult =
  | { readonly ok: true; readonly readout: DepthReadout }
  | { readonly ok: false; readonly error: string };

export interface DepthJob {
  readonly seq: number;
  readonly request: DepthRequest;
}
export interface DepthDone {
  readonly seq: number;
  readonly result: DepthResult;
}

/** Strehl 0.8, the criterion both `mountDepthTolerance` currencies aim at. */
const MARECHAL_STREHL = 0.8;

/**
 * (λ/14) ÷ the σ that actually gives Strehl 0.8 — the floor the over-report
 * cannot go below. Written as the arithmetic rather than as 0.9501, so it stays
 * a derivation.
 */
export const MARECHAL_FLOOR = 1 / 14 / (Math.sqrt(-Math.log(MARECHAL_STREHL)) / (2 * Math.PI));

/**
 * The curve's sampling, and it is deliberately **not** uniform.
 *
 * Two things have to be on one pair of axes and they are a factor of five apart
 * at an immersion aperture: the crossing, which the curve has to resolve, and the
 * quoted budget, which is the whole point of drawing it. A uniform grid wide
 * enough to reach the second puts two points on the first, and a grid tight
 * enough for the first leaves the second off the plot — where a marker cannot be
 * clamped to the edge without printing a wrong number, which is the rule this
 * panel already keeps for its "worst plane" marker.
 *
 * So the depths are dense out to `DEPTH_SPAN_FACTOR` × the crossing and sparse
 * from there to just past the quoted budget. The points are drawn as dots, so the
 * sampling is on the page rather than hidden in it.
 */
const DEPTH_POINTS = 16;
const DEPTH_TAIL_POINTS = 8;
const DEPTH_SPAN_FACTOR = 2.5;
/** A little past the quoted budget, so its rule is not on the frame's edge. */
const DEPTH_QUOTED_MARGIN = 1.1;
/** Where the curve stops when there is no crossing to scale it to (µm). */
const DEPTH_SPAN_MATCHED_UM = 20;

/**
 * An **exact** memo of a pupil over the points it is asked about — no
 * interpolation, no lattice arithmetic, no assumption about where the samples
 * fall.
 *
 * The job below evaluates one pupil at the same lattice ten times over while only
 * the defocus changes, and both halves of that pupil are expensive: a traced
 * pupil is a 28-term Zernike sum per sample, and `withMountAberration`'s phase is
 * a `stackWavefrontErrorMm` per sample. Measured, they are 1.9 ms and 4.0 ms of a
 * 5.8 ms transform at 64²/32 bins — the FFT itself is 0.23 ms. Caching the *first*
 * evaluation at each point takes the sweep from 5.8 ms per kernel to 0.5 ms.
 *
 * This is memoization of a pure function and not a model of one: a point that has
 * not been seen is computed by the engine, and a point that has is returned
 * bit-identically. It deliberately knows nothing about `incoherentPsf`'s sampling
 * — a wrapper that reconstructed the lattice would be a second copy of a
 * convention that lives in the engine, and § 6s's radial map is a *cache with a
 * measured error* precisely because it could not be exact. This one can be.
 */
export function memoizedPupil(pupil: PupilFunction): PupilFunction {
  const cache = (f: (px: number, py: number) => number) => {
    const rows = new Map<number, Map<number, number>>();
    return (px: number, py: number): number => {
      let row = rows.get(px);
      if (row === undefined) {
        row = new Map();
        rows.set(px, row);
      }
      const hit = row.get(py);
      if (hit !== undefined) return hit;
      const value = f(px, py);
      row.set(py, value);
      return value;
    };
  };
  return { amplitude: cache(pupil.amplitude), phaseWaves: cache(pupil.phaseWaves) };
}

/**
 * The defocus that balances a depth's wavefront in the least-squares sense — the
 * search's *starting bracket*, and nothing more.
 *
 * Maréchal's own construction (W₀₄₀ against its best-fit defocus), integrated on
 * the disc over the delivered aperture. It is not the answer: the peak of the
 * intensity and the minimum of the variance are close but not identical once the
 * aberration is large, and § 6l.4's bisection is on the *traced Strehl*. So this
 * only says where to look, and the golden section below finds the peak.
 */
function balancedDefocusWaves(spec: MountSpec, depthMm: number): number {
  const rhoMax = mountAperture(spec) / spec.numericalAperture;
  let num = 0;
  let den = 0;
  const bins = 64;
  for (let i = 0; i < bins; i++) {
    const rho = ((i + 0.5) / bins) * rhoMax;
    // ∫W·ρ²·ρdρ over ∫ρ⁴·ρdρ — the ρ² projection, with the disc's own weight.
    num += mountWavefrontWaves(spec, depthMm, rho) * rho ** 3;
    den += rho ** 5;
  }
  return den > 0 ? -num / den : 0;
}

const GOLDEN = (Math.sqrt(5) - 1) / 2;
/** Half-width of the focus search, in waves, about the balanced defocus. */
const FOCUS_BRACKET = 0.6;
/** Golden-section steps: 1.2·0.618⁸ = 0.026 waves, which costs 1e-4 of Strehl. */
const FOCUS_STEPS = 8;

/**
 * Peak intensity at best focus — a golden section on the defocus, seeded at the
 * balanced value.
 *
 * Unimodal within the bracket because the balanced defocus is already inside the
 * central lobe of the axial response; the sidelobes a wider scan would find are
 * lower, which is what the ladder's own coarse-then-fine scan relied on. Ten
 * transforms where the ladder's brute force takes 162, and it reproduces the
 * rung's bisected depth to the printed digit — see the header.
 */
function bestPeak(base: PupilFunction, spec: MountSpec, depthMm: number, options: {
  readonly size: number;
  readonly pupilSamples: number;
}): number {
  const pupil = memoizedPupil(withMountAberration(base, spec, depthMm));
  const at = (w: number) => incoherentPsf(withDefocus(pupil, w), options).values[0]!;
  const center = balancedDefocusWaves(spec, depthMm);
  let lo = center - FOCUS_BRACKET;
  let hi = center + FOCUS_BRACKET;
  let c = hi - GOLDEN * (hi - lo);
  let d = lo + GOLDEN * (hi - lo);
  let fc = at(c);
  let fd = at(d);
  for (let i = 0; i < FOCUS_STEPS; i++) {
    if (fc > fd) {
      hi = d;
      d = c;
      fd = fc;
      c = hi - GOLDEN * (hi - lo);
      fc = at(c);
    } else {
      lo = c;
      c = d;
      fc = fd;
      d = lo + GOLDEN * (hi - lo);
      fd = at(d);
    }
  }
  return Math.max(fc, fd);
}

export function depthStrehl(request: DepthRequest): DepthResult {
  const started = performance.now();
  try {
    const { system, frame } = buildFrame({
      kind: request.kind,
      pupilSamples: AXIAL_PUPIL_SAMPLES,
      size: AXIAL_SIZE,
    });
    const options = { pupilSamples: AXIAL_PUPIL_SAMPLES, size: AXIAL_SIZE };
    const tracedNA = objectNumericalAperture(system, LAMBDA_NM);
    const mount = resolveMount(system, request.mount);
    const spec = mountSpecFor(mount, tracedNA, 0);
    const traced = fieldPupilAt(system, frame, 0.5, 0.5).pupil;
    const ideal = idealPupil();

    let quoted: { marechalMm: number; quarterWaveMm: number } | null = null;
    let quotedRefusal: string | null = null;
    try {
      quoted = mountDepthTolerance(tracedNA, LAMBDA_NM, mount.index, mount.immersionIndex);
    } catch (cause) {
      quotedRefusal = (cause as Error).message;
    }

    /**
     * The 0.8 crossing, bracketed by doubling and then bisected.
     *
     * The bracket starts at the quoted budget where there is one, which is within
     * a factor of a few of the answer on every row; where the engine refused to
     * quote, it starts at a micron and doubles. `null` rather than the bracket's
     * own edge when nothing crosses — a matched mount never falls below 1 at any
     * depth, and reporting the edge would turn "there is no such depth" into a
     * measurement of the search.
     */
    const bisect = (base: PupilFunction): number | null => {
      const reference = bestPeak(base, spec, 0, options);
      if (!(reference > 0)) return null;
      const strehl = (d: number) => bestPeak(base, spec, d, options) / reference;
      const start = quoted?.marechalMm ?? 1e-3;
      let hi = start;
      while (strehl(hi) >= MARECHAL_STREHL) {
        hi *= 2;
        if (hi > start * 512) return null;
      }
      let lo = 0;
      for (let i = 0; i < 12; i++) {
        const mid = 0.5 * (lo + hi);
        if (strehl(mid) >= MARECHAL_STREHL) lo = mid;
        else hi = mid;
      }
      return 0.5 * (lo + hi);
    };

    const bisectedIdeal = bisect(ideal);
    const bisectedTraced = bisect(traced);
    const crossingMm = bisectedIdeal ?? bisectedTraced;
    const nearMm =
      crossingMm === null
        ? DEPTH_SPAN_MATCHED_UM * 1e-3
        : crossingMm * DEPTH_SPAN_FACTOR;
    const farMm =
      quoted === null ? nearMm : Math.max(nearMm, quoted.marechalMm * DEPTH_QUOTED_MARGIN);

    const depths: number[] = [];
    for (let i = 0; i <= DEPTH_POINTS; i++) depths.push((i / DEPTH_POINTS) * nearMm);
    if (farMm > nearMm) {
      for (let j = 1; j <= DEPTH_TAIL_POINTS; j++) {
        depths.push(nearMm + (j / DEPTH_TAIL_POINTS) * (farMm - nearMm));
      }
    }

    const idealReference = bestPeak(ideal, spec, 0, options);
    const tracedReference = bestPeak(traced, spec, 0, options);
    const curve: DepthPoint[] = depths.map((depthMm) => ({
      depthUm: depthMm * 1000,
      ideal: bestPeak(ideal, spec, depthMm, options) / idealReference,
      traced: bestPeak(traced, spec, depthMm, options) / tracedReference,
    }));

    return {
      ok: true,
      readout: {
        kind: request.kind,
        mountMedium: mount.name,
        mountIndex: mount.index,
        mountMatched: mount.matched,
        objectMedium: mount.immersionName,
        objectMediumIndex: mount.immersionIndex,
        tracedNA,
        deliveredNA: mountAperture(spec),
        curve,
        quotedMarechalUm: quoted === null ? null : quoted.marechalMm * 1000,
        quotedQuarterUm: quoted === null ? null : quoted.quarterWaveMm * 1000,
        quotedRefusal,
        bisectedIdealUm: bisectedIdeal === null ? null : bisectedIdeal * 1000,
        bisectedTracedUm: bisectedTraced === null ? null : bisectedTraced * 1000,
        overReport:
          quoted !== null && bisectedIdeal !== null ? quoted.marechalMm / bisectedIdeal : null,
        marechalFloor: MARECHAL_FLOOR,
        elapsedMs: performance.now() - started,
      },
    };
  } catch (cause) {
    return { ok: false, error: (cause as Error).message };
  }
}
