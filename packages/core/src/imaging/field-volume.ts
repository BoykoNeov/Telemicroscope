import { imagePixelScaleMm, type PupilScale } from "../wave/psf";
import { incoherentImage, type EmitterField } from "./fluorescence";
import type { PatchPupil } from "./brightfield";
import { patchWeight } from "./render";
import { defocusing, defocusWaves, type DepthPupils, type EmitterVolume } from "./volume";

/**
 * The field and the depth on one callback — § 6k's stack through § 6i's patches.
 *
 * § 6k images a volume through a pupil that varies with **depth**; § 6i images a
 * plane through a pupil that varies across the **field**. Every module since has
 * had one axis or the other and none has had both, and the reason was not that
 * nobody wanted it. It was that the two renderers disagreed about brightness:
 * `renderVolume` weighs each slice by the light its pupil transmitted and
 * `renderFluorescence` divided the same factor out, so a patched depth stack had
 * two answers and no way to choose. § 6bc chose — the weight is the physics and
 * normalizing is a choice of units, legal once per composition and not once per
 * contribution — and this module is what that decision was for.
 *
 * No physics arrives here. The operator is § 6i's, summed over patches and over
 * depth, with each contribution carrying its own pupil's weight:
 *
 *     I(x) = Σ_p Σ_z T_{p,z} · [ h_{p,z} ⊛ (w_p · E_z) ](x)
 *
 * What arrives is the measurement of a coupling nobody had priced, and four of
 * the five things it says were not what the deferral expected.
 *
 * ## The field varies fastest where § 6bc did not read it
 *
 * § 6bc.4 swept the objective's throughput along a radius — 0.227% down at
 * 2.25 mm, 10.7% at 6 mm — and concluded that the variation *within* one frame
 * is nothing, on the strength of an on-axis probe that came back at 1.9e-8. The
 * probe was right and the conclusion does not follow. Throughput is an **even**
 * function of field radius, so its gradient vanishes at the axis exactly; the
 * on-axis frame is the one frame in the field across which the pupil does not
 * change. Move the frame out and its own patches spread over a range where the
 * profile is steep: **0.686% across a frame centred at 2.25 mm and 1.699% at
 * 4.5 mm** (§ 6bd.3), on patch centres that themselves span 2.152–2.351 mm and
 * 4.402–4.600 mm of radius. Those are not the same interval § 6bc.4 measured and
 * they do not contradict it — they are the local slope where § 6bc read the
 * value, and a frame at the field edge is the case a single centre pupil
 * represents worst.
 *
 * ## Which is why the error of one pupil has no fixed sign
 *
 * A frame rendered through its centre's pupil alone holds a different total flux
 * than the same frame patched, and **which way is a property of the radius**:
 * 0.99999999 on axis, 0.99917570 at 2.25 mm, 1.00112776 at 4.5 mm (§ 6bd.4).
 * The profile is concave where the aperture has not begun to clip and convex
 * once it has, so the centre value sits above its own frame average in one place
 * and below it in another. A correction factor fitted at one field radius has
 * the wrong sign at another, which is the reason this is a renderer and not a
 * scalar.
 *
 * ## What the patches buy is the PHASE, not the clip
 *
 * Split the traced field pupil into its two halves and render each against a
 * frozen other half. At 4.5 mm, on a five-slice stack, one patch against
 * sixteen moves the image by 4.1055e-2 in relative RMS; the patches' own
 * **phase** with the centre's amplitude accounts for 3.9219e-2 of it and their
 * own **amplitude** with the centre's phase for 8.9971e-3 (§ 6bd.6). So a patched
 * render is bought for the aberration and gets the vignetting as change. On the
 * axis the amplitude half vanishes outright — 2.8e-7 against 1.8e-2 — which is
 * the even function above seen a third way. A caller who has only a throughput
 * profile and no traced wavefront has the small half of the effect everywhere,
 * and none of it on axis.
 *
 * ## Out-of-focus light dilutes the field variation
 *
 * The same one-against-sixteen comparison on a single in-focus plane moves
 * 5.5543e-2 at 4.5 mm where the five-slice stack moves 4.1055e-2 (§ 6bd.5). Haze
 * is the part of the image that carries no detail, and it is also the part that
 * is nearly insensitive to which patch's kernel formed it, so it enters both
 * renders alike and enlarges the denominator of every relative error.
 *
 * **The corollary is not "a thick specimen needs fewer patches".** The patch
 * count is set by the in-focus content's share of the frame, not by the stack's
 * depth: the same absolute error is being divided by a larger total. A caller
 * holding a fixed *relative* target may spend fewer patches on a hazy frame; a
 * caller who intends to deconvolve the haze away later may not.
 *
 * ## The haze fraction is a property of the specimen only if the specimen
 * ## SEPARATES
 *
 * § 6k.2 pins that the in-focus share of the light is the specimen's own and not
 * the instrument's, because every plane delivers its whole flux however far out
 * of focus it is (§ 6k.1, and § 6bc.2 re-measured it: 0.25 → 4 waves leave
 * `formedSum` identical to 1e-14). A field-varying pupil puts a second weight on
 * that sum, and the flux of patch p at depth z is T_p·F_{p,z}. The T cancels out
 * of the ratio if and only if F factors as a field pattern times a depth
 * pattern. It does for a uniform slab, which is exactly the specimen a lazy
 * check would use, and the cancellation there is exact to 4e-16. It does not for
 * a specimen whose in-focus material and whose haze sit at different field
 * positions, and there the fraction moves **0.363% on a 1.699% throughput span**
 * (§ 6bd.7). § 6k.2 keeps its statement and gains a condition.
 *
 * ## The two grid limits are one limit, and the readout already reported it
 *
 * A defocused kernel is wide, and `convolveCircular` is periodic: light that
 * leaves one edge of the frame re-enters at the other, under — in this module,
 * for the first time — a *different pupil's* patch. It is worth knowing exactly
 * when that starts, and the answer is already on every result.
 *
 * On an unaberrated pupil the two candidate limits coincide to the digit. The
 * geometric blur radius is 4·n·|w|·size/pupilSamples pixels against a half-frame
 * of size/2, and the pupil's phase step between adjacent lattice samples is
 * 4·|w|/pupilSamples waves against a Nyquist of ½. Both give
 *
 *     |w| = pupilSamples / 8
 *
 * and they are the same statement twice: the shift theorem reads a phase ramp of
 * half a wave per sample as a displacement of half a grid. Measured, the escape
 * past the frame is 7.19 / 5.45 / 4.53% at that defocus for pupilSamples 16 / 24
 * / 32 and about 16% at 1.25× it, for all three (§ 6bd.8).
 *
 * **On a traced pupil the identity is not exact, and the readout survives it
 * anyway.** An aberrated pupil has spent part of the same budget before any
 * defocus is applied — 0.245 waves of step on the shipped 4×/0.10 on axis — so
 * `pupilSamples/8` is no longer where the knee is. Read against
 * `maxGridPhaseStepWaves` instead of against the defocus, five pupils spanning
 * the ideal disc, the traced axis, 4.5 mm, 6 mm and a frame corner collapse onto
 * one curve: **3.67–6.49% escaped at a half-wave step**, over defocus values
 * spanning 1.60 to 3.13 waves — a 2× spread in the cause collapsing to a 1.8×
 * spread in the effect, and diverging only past it.
 * So the guard `incoherentPsf` has reported since § 6i is the containment guard
 * too, and `containedDefocusWaves` names the unaberrated form of it.
 *
 * No `escapedFraction` is reported, because this module cannot measure one: it
 * takes a grid of double the extent, which is a second render. A readout that
 * quoted the estimate as a measurement would be § 6k.3's trap in a third place.
 *
 * ## What is deliberately not here
 *
 * **No wavelength.** § 6bb runs a spectrum through a depth stack and this runs a
 * field through one; the three axes together are their own step, and its cost is
 * `N_λ × patches² × N_z` convolutions. `spectral-volume`'s "`patches` is not
 * supported" is now a scope line rather than a blocked one — the reconciliation
 * it named has happened — and moving it is deferred rather than smuggled in.
 *
 * **No economy from shared radii.** `imaging/render` caches its PSF stacks on
 * the patch radius, since a p×p grid has far fewer distinct radii than patches,
 * and turns the reused kernel by the patch azimuth. That is available here and
 * is not taken: `rotateKernel` is bilinear, so a cached stack would be *nearly*
 * the stack that would have been formed, and § 6bd.1's two bitwise reductions
 * are worth more than the 3× than they would cost. Cost is `patches² × slices`
 * convolutions, and it is named rather than hidden.
 *
 * **No verdict from `PatchPupil.sampling`**, following `renderFluorescence` —
 * which is why the callback returns `DepthPupils` and not a patch: an emitting
 * specimen has no geometric branch to fall back to and mints nothing.
 */

/**
 * What one field position looks through, at every depth — `DepthPupils` given
 * the field coordinate `renderFluorescence` keys its patches on.
 *
 * Deliberately `(u, v) => DepthPupils` rather than `(u, v, waves) => Pupil`.
 * The curried form is the one the renderer can call once per patch instead of
 * once per patch and slice, so a callback that *traces* is not asked to re-trace
 * the same field point for every depth — and it composes with everything § 6k
 * and § 6l already built, `defocusing` and `mountPupils` alike, with no adapter.
 *
 * `u` and `v` are normalized frame positions, `renderFluorescence`'s own
 * convention and for its reason: keying on the patch index would make "patch 2
 * of 4" and "patch 2 of 8" different field points, so refining the
 * discretization would change the physics.
 */
export type FieldDepthPupils = (u: number, v: number) => DepthPupils;

/**
 * The ordinary composition: trace the field once, defocus it per slice.
 *
 * `tracedFieldPupils(system, frame)` goes straight in, which is the whole of the
 * wiring this step was deferred for. A mount whose index is not the immersion's
 * wants `mountPupils` in place of `defocusing` and is § 6l's business, not this
 * function's.
 */
export function fieldDefocusing(
  pupilAt: (u: number, v: number) => PatchPupil,
): FieldDepthPupils {
  return (u, v) => defocusing(pupilAt(u, v).pupil);
}

/**
 * The defocus at which a kernel stops fitting the frame it is formed on.
 *
 * `pupilSamples/8`, derived twice in the header and measured in § 6bd.8. Exact
 * for a pure defocus on an unaberrated pupil; on a traced one the aberration has
 * already spent part of the same budget, and the honest reading is then
 * `maxGridPhaseStepWaves` against ½ rather than the defocus against this.
 */
export function containedDefocusWaves(pupilSamples: number): number {
  if (!(pupilSamples > 0)) {
    throw new Error(`containedDefocusWaves: pupilSamples must be positive, got ${pupilSamples}`);
  }
  return pupilSamples / 8;
}

export interface FieldVolumeOptions {
  /** Patches across the field, per axis. 1 is plain `renderVolume`. */
  readonly patches?: number;
  /** Frequency bins across the pupil diameter, as in `abbeImage`. */
  readonly pupilSamples: number;
  /** Object-side NA — the same side `EmitterSlice.zMm` is measured in. */
  readonly numericalAperture: number;
  readonly wavelengthNm: number;
  /** The immersion medium the object-side cone is in. */
  readonly refractiveIndex?: number;
  /** Which depth the objective is focused on (object mm). Defaults to 0. */
  readonly focusMm?: number;
  /** Supply to get a physical `pixelScaleMm` back; omit for grid units. */
  readonly scale?: PupilScale;
  /** Called once per patch finished, for progress and cost accounting. */
  readonly onPatch?: (done: number, total: number) => void;
  /**
   * Called once per slice imaged, **within each patch** — so it fires
   * `patches²` times for each slice index, not once.
   *
   * `renderVolume`'s callback with the outer loop this module added, and it
   * reports the slice's own index rather than a running total so that at one
   * patch it is `renderVolume`'s exactly. A caller wanting a single monotone
   * progress count wants `onPatch`, which is the loop that actually bounds the
   * cost (§ 6bd's header: `patches² × slices` convolutions).
   */
  readonly onSlice?: (done: number, total: number) => void;
}

export interface FieldVolumeImage {
  readonly size: number;
  readonly patches: number;
  /** Intensity, in the object's own coordinates (NOT fftshifted). */
  readonly intensity: Float64Array;
  /** Each slice's contribution to the image flux, summed over patches. */
  readonly sliceFlux: readonly number[];
  /**
   * What each patch's pupil transmitted at the slice **nearest focus**, in the
   * order the patches were imaged (row-major over the patch grid).
   *
   * The frame's own throughput profile, and the quantity § 6bd.3 reads a span
   * off. Quoted at one slice rather than summed over the stack because under a
   * pure defocus it is the same at every slice to 1e-14 (§ 6bc.2), and a caller
   * whose pupils vary in *amplitude* with depth wants the per-slice numbers,
   * which no single readout could carry. The reference slice is chosen the way
   * `depthKernels` chooses its own — least defocused, not first — so a stack
   * authored from −N to +N reports its focal plane and not its far edge.
   */
  readonly patchThroughput: readonly number[];
  /**
   * The flux this render must hold: Σ over patches and slices of the light that
   * window carried, each times the weight its own pupil gave it.
   *
   * `renderFluorescence`'s readout with the depth axis added, and for its
   * reason: "equals Σ over the object" was only ever true where the weight had
   * been divided out, and a conservation check that passes through an objective
   * transmitting a fifth of the light is reporting the normalizer (§ 6bc.5).
   */
  readonly weightedEmittedFlux: number;
  /**
   * The fraction of the image's light emitted within ± half a depth of focus.
   *
   * § 6k.2's haze number, and it is **no longer a property of the specimen
   * alone**. Each patch's throughput multiplies that patch's whole column, so it
   * cancels from the ratio exactly when the specimen separates into a field
   * pattern times a depth pattern — for a uniform slab to 4e-16, and not for a
   * specimen whose in-focus material and whose haze sit at different field
   * positions (§ 6bd.7).
   */
  readonly inFocusFraction: number;
  /**
   * Max over every patch and slice — the grid's ability to carry the worst
   * kernel it saw, and by § 6bd.8 the frame's ability to contain it: past ½ a
   * wave the kernel is wrapping, and in this module it wraps into a patch with a
   * different pupil.
   */
  readonly maxGridPhaseStepWaves: number;
  readonly pixelScaleMm?: number;
}

/**
 * Image a 3-D specimen across a field whose pupil is not constant.
 *
 * `renderVolume` and `renderFluorescence` at once, and it reduces to each of
 * them **bitwise** rather than to within a tolerance (§ 6bd.1) — one patch is
 * the first, one in-focus slice in `transmitted` units is the second. That is
 * the point of the loop order below (patch rows outermost, slices innermost)
 * and of leaving the arithmetic to `incoherentImage` rather than restating it.
 *
 * The units are `transmitted`, unconditionally and with no option, exactly as in
 * `renderVolume`. A patched stack is built from `patches² × slices` pupils by
 * construction, so § 6bc's "legal once per composition" has no per-render form
 * here; offering a reference would let every stack normalize to itself, which is
 * the defect § 6bc removed wearing a third name. A caller quoting this frame
 * against another divides the finished image by one weight they name — it is a
 * scalar on the result and needs no argument.
 *
 * The emitters are windowed, not the intensities, following `renderFluorescence`
 * for the specimen's own reason: fluorescence is linear in the emitter density,
 * so splitting the emitters splits the light and every photon is convolved with
 * the kernel nearest to where it was emitted. § 6g.2's brightfield case has to
 * window the output instead because splitting an *amplitude* deletes the
 * interference (89% of it), which an emitting specimen does not have to lose.
 * That is why the split here stays exact at any patch count and at any defocus —
 * 3e-16 out to 4.09 waves, where 24.4% of the kernel has left the frame, because
 * the wrap is the same wrap in both renders (§ 6bd.2).
 */
export function renderFieldVolume(
  volume: EmitterVolume,
  pupils: FieldDepthPupils,
  options: FieldVolumeOptions,
): FieldVolumeImage {
  const patches = options.patches ?? 1;
  if (!Number.isInteger(patches) || patches < 1) {
    throw new Error(`patches must be a positive integer, got ${patches}`);
  }
  const n = volume.size;
  if (volume.slices.length === 0) {
    throw new Error("renderFieldVolume: the volume has no slices");
  }
  for (let s = 0; s < volume.slices.length; s++) {
    const field: EmitterField = volume.slices[s]!.field;
    if (field.size !== n) {
      throw new Error(`renderFieldVolume: slice ${s} is ${field.size} where the volume is ${n}`);
    }
    if (field.values.length !== n * n) {
      throw new Error(`renderFieldVolume: slice ${s} must hold ${n * n} values`);
    }
  }

  const focusMm = options.focusMm ?? 0;
  const nMedium = options.refractiveIndex ?? 1;
  const halfDepthMm =
    (nMedium * options.wavelengthNm * 1e-6) /
    (2 * options.numericalAperture * options.numericalAperture);

  // Precomputed rather than recomputed per patch: the defocus a slice sits at is
  // a property of the stack, not of the field position, and `renderVolume`
  // derives it from the same three numbers in the same order.
  const waves = volume.slices.map((slice) =>
    defocusWaves(slice.zMm - focusMm, options.numericalAperture, options.wavelengthNm, nMedium),
  );
  // The reference slice `patchThroughput` is read at — least defocused rather
  // than first, `depthKernels`' own choice.
  let reference = 0;
  for (let s = 1; s < waves.length; s++) {
    if (Math.abs(waves[s]!) < Math.abs(waves[reference]!)) reference = s;
  }

  const intensity = new Float64Array(n * n);
  const windowed = new Float64Array(n * n);
  const sliceFlux = new Array<number>(volume.slices.length).fill(0);
  const patchThroughput: number[] = [];
  let weightedEmittedFlux = 0;
  let maxGridPhaseStepWaves = 0;
  let inFocusFlux = 0;
  let totalFlux = 0;
  let done = 0;

  for (let py = 0; py < patches; py++) {
    for (let px = 0; px < patches; px++) {
      // Once per patch, never per slice — the reason `FieldDepthPupils` is
      // curried, and the difference between 16 traces and 144 of them.
      const depthPupils = pupils((px + 0.5) / patches, (py + 0.5) / patches);
      let referenceSum = 0;

      for (let s = 0; s < volume.slices.length; s++) {
        const values = volume.slices[s]!.field.values;
        windowed.fill(0);
        for (let y = 0; y < n; y++) {
          const wy = patchWeight((y + 0.5) / n, py, patches);
          if (wy === 0) continue;
          for (let x = 0; x < n; x++) {
            const value = values[y * n + x]!;
            if (value === 0) continue;
            const wx = patchWeight((x + 0.5) / n, px, patches);
            if (wx === 0) continue;
            windowed[y * n + x] = value * wx * wy;
          }
        }
        let windowedFlux = 0;
        for (let i = 0; i < n * n; i++) windowedFlux += windowed[i]!;

        const formed = incoherentImage({ size: n, values: windowed }, depthPupils(waves[s]!), {
          pupilSamples: options.pupilSamples,
          throughput: { kind: "transmitted" },
          ...(options.scale === undefined ? {} : { scale: options.scale }),
        });
        maxGridPhaseStepWaves = Math.max(maxGridPhaseStepWaves, formed.maxGridPhaseStepWaves);
        if (s === reference) referenceSum = formed.formedSum;
        for (let i = 0; i < n * n; i++) intensity[i] = intensity[i]! + formed.intensity[i]!;

        // `transmitted` units, so the weight IS what the pupil passed — the same
        // product `renderVolume` forms, in the same order.
        const flux = formed.formedSum * windowedFlux;
        sliceFlux[s] = sliceFlux[s]! + flux;
        weightedEmittedFlux += flux;
        totalFlux += flux;
        if (Math.abs(volume.slices[s]!.zMm - focusMm) <= halfDepthMm) inFocusFlux += flux;
        options.onSlice?.(s + 1, volume.slices.length);
      }

      patchThroughput.push(referenceSum);
      options.onPatch?.(++done, patches * patches);
    }
  }

  const pixelScaleMm =
    options.scale === undefined
      ? undefined
      : imagePixelScaleMm(options.scale, n, options.pupilSamples);

  return {
    size: n,
    patches,
    intensity,
    sliceFlux,
    patchThroughput,
    weightedEmittedFlux,
    inFocusFraction: totalFlux > 0 ? inFocusFlux / totalFlux : 0,
    maxGridPhaseStepWaves,
    ...(pixelScaleMm === undefined ? {} : { pixelScaleMm }),
  };
}
