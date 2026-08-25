import { fft2d, fftShift2d, isPowerOfTwo, shiftedRowBand } from "../math/fft";
import { imagePixelScaleMm, type PupilFunction, type PupilScale } from "../wave/psf";
import { commensurateSource, type CondenserSource } from "../illumination/source";
import { imageRadiusForObjectHeight, type ObjectFieldFrame } from "./object-field";
import type { PatchPupil } from "./brightfield";
import type { OpticalSystem } from "../trace/system";
import type { AimOptions } from "../pupil/aiming";
import { patchWeight } from "./render";

/**
 * Fluorescence — the specimen that **emits**, and what that costs and buys.
 *
 * § 6f's brightfield specimen emits nothing: it sits in a beam and modulates
 * it, so whether two of its points interfere depends on where their light came
 * from, and the image is nonlinear in the object's intensity. A fluorophore is
 * the opposite in every one of those clauses. It absorbs a photon and emits a
 * new one, spontaneously, with no phase memory of the exciting field and none
 * of its neighbours — so the emitters are **mutually incoherent by nature**,
 * their intensities add, and the image is a plain convolution:
 *
 *     I(x) = h(x) ⊛ E(x),      h = |F⁻¹{P}|²
 *
 * with E the emitter density and h the incoherent PSF. There is no condenser in
 * that line, and no S. That is not a simplification of brightfield — it is a
 * different object class, and it is the class every image the engine formed
 * before § 6f already belonged to (a star, `imaging/render`).
 *
 * ## So why does this module exist at all, if the operator is the old one?
 *
 * Because the operator has to be stated on **`illumination/abbe`'s own
 * lattice**, or the one comparison worth making cannot be made.
 *
 * `wave/psf` builds its pupil by area-averaging the cells the aperture rim cuts
 * (`pupilSampling`); `abbeImage` point-samples the pupil on the DFT lattice,
 * because there the pupil multiplies a *sampled* spectrum and the midpoint rule
 * is the discretization (§ 6f). The two transmitting sets differ at the rim by
 * construction. Convolving with a `wave/psf` kernel and comparing that against
 * an Abbe sum would therefore measure the rim mismatch, not the physics — a
 * residual around 1e-3 that looks exactly like a real disagreement about
 * coherence and is nothing of the kind.
 *
 * `incoherentPsf` below samples the pupil the way `abbeImage` samples it, so
 * the **only** difference between the two modules is the sum over source
 * points. That is what makes § 6i.1 a 1e-12 identity instead of an argument.
 *
 * ## The identity, and the condition it is exact under
 *
 * Expanding the Abbe sum over object-spectrum pairs (u₁, u₂) leaves each pair
 * weighted by Σ_s P(u₁+s)·P*(u₂+s) — a sum over the source's own points. The
 * image is a convolution exactly when that bracket depends only on the
 * difference u₁ − u₂, because only then does it factor out of the double sum as
 * a transfer function. Two conditions make it do so, and both are geometric:
 *
 *  1. **The source must reach past 1 + B**, where B is the object spectrum's
 *     outer radius in pupil-radius units. Every s that contributes at all
 *     satisfies |s| ≤ 1 + B, so a source disc of that radius already contains
 *     the whole of every pair's overlap region, and masking it larger adds
 *     nothing but zeros.
 *  2. **The source lattice must step by the pupil's own frequency step**,
 *     2/pupilSamples. Then translating s by u₁ − u₂ — a whole number of
 *     frequency bins — maps the lattice onto itself, and the bracket becomes a
 *     genuine discrete autocorrelation of the sampled pupil. By the discrete
 *     Wiener–Khinchin theorem that autocorrelation is the DFT of |F⁻¹{P}|²,
 *     which is h. The offset of the lattice is free; only its step matters.
 *
 * Under both, `abbeImage` and `incoherentImage` agree to f64 noise **at any
 * modulation** — not merely for a weak object. That is the strong half of the
 * statement: § 6f.4's nonlinearity (11.2% at m = 1) does not shrink here, it
 * *vanishes*, because every order pair now sees the same transfer.
 *
 * A condenser that does not satisfy condition 2 is not wrong, it is discretized
 * — the residual is the source lattice's rim error, § 6f.2's own convergence
 * knob, and § 6i.2 measures it falling rather than asserting a count is enough.
 *
 * ## The window goes back on the INPUT, and that is the whole contrast
 *
 * `imaging/render` windows the scene and says why; `imaging/brightfield`
 * windows the output and says why it must. This module windows the **input**,
 * like `render.ts`, and for exactly `render.ts`'s reason: the imaging is linear
 * in the emitter density, so splitting the emitters between patches splits the
 * light, and every photon is convolved with the kernel nearest to where it was
 * actually emitted. The partition of unity then makes the decomposition exact
 * wherever h is locally constant, with no interference to delete —
 * `illumination/coherence`'s C = Σ_p √(w_p(x₁)w_p(x₂)) factor is the factor
 * multiplying an interference term, and a fluorescent object has none.
 *
 * So the two microscope renders differ in which side they window, and the
 * reason is a property of the specimen rather than of the optics. § 6i.4 pins
 * both halves of that: the input split is exact here (to 1e-12, at any patch
 * count, for a shift-invariant pupil) where § 6g.2 measured it *deleting* 89%
 * of the interference in the brightfield case.
 *
 * ## What is deliberately not here
 *
 * **No fidelity verdict is minted.** § 6f.9 had to rule instead of blending
 * because a ray histogram has no phase to interfere with, so brightfield has no
 * geometric branch to fall back to. Incoherent imaging does — `adaptivePsf` is
 * that branch, and it has been cross-faded since § 2d. A caller who needs the
 * fallback renders point emitters through `imaging/render`; this operator is
 * the FFT branch stated on the Abbe lattice, and the grid guard it reports
 * (`maxGridPhaseStepWaves`) is the same one `abbeImage` reports.
 *
 * **No fluorophore is named.** Real excitation/emission spectra are measured
 * data, and transcribing a dye's curve from memory is what the hard rule
 * forbids. The band is an input parameter, following § 5s's precedent with the
 * photometric zero point: pin the ratios, not an invented absolute.
 *
 * **No out-of-focus haze — this module images one plane, and `imaging/volume`
 * images the stack.** A real widefield fluorescence image is dominated by light
 * from emitters *outside* the focal plane, which is why deconvolution and
 * confocal exist. § 6k built the unit named here: a defocused pupil per z slice
 * over a stack of emitter planes, `renderVolume`. What it found is worth
 * carrying back to this header, because it is a statement about the operator
 * above rather than about the new one — defocus is a pure phase, so it leaves
 * `formedSum` **exactly** unchanged and only redistributes the kernel. Every
 * plane of a thick specimen therefore delivers its whole flux to the image no
 * matter how far out of focus it is, and the haze cannot be focused away.
 *
 * Also absent, and each for the same reason (an absolute photon count, § 3a's
 * standing deferral): photobleaching, saturation, quantum yield, and shot
 * noise. Emitter flux here is relative, exactly as `PointSource.flux` is.
 */

/**
 * Emitter density on the image-plane grid — fluorescence's object.
 *
 * An **intensity**, where `illumination/abbe`'s `ObjectField` is an amplitude,
 * and the difference is the physics rather than a convention: a fluorophore has
 * no phase to carry. Supplied in the same reduced coordinates `abbeImage` uses
 * (the specimen scaled by the magnification), so the two modules' grids are the
 * same grid and § 6i.1 can compare them pixel for pixel.
 */
export interface EmitterField {
  /** Grid size; `values` is `size`×`size`, row-major. Power of two. */
  readonly size: number;
  /** Emitted power per pixel. Non-negative — it is an intensity. */
  readonly values: Float64Array;
}

export interface IncoherentPsfOptions {
  /** Frequency bins across the pupil DIAMETER — the scale, as in `abbeImage`. */
  readonly pupilSamples: number;
  /** Grid size; must match the object it will be convolved with. */
  readonly size: number;
  /** Supply to get a physical `pixelScaleMm` back; omit for grid units. */
  readonly scale?: PupilScale;
}

export interface IncoherentPsf {
  readonly size: number;
  readonly pupilSamples: number;
  /**
   * The kernel, **normalized to sum 1** and in DC-at-index-0 layout (not
   * fftshifted), so a circular convolution with it is a plain multiply in the
   * transform domain and a uniform emitter field images as itself.
   */
  readonly values: Float64Array;
  /** Lattice points the pupil transmitted — the aperture, counted. */
  readonly transmittingSamples: number;
  /** Σ|P|² before normalization: the transmitted energy on this lattice. */
  readonly energy: number;
  /**
   * What the kernel summed to **before** it was normalized.
   *
   * Parseval's image of `energy` — `size²` times smaller, by this FFT's
   * convention — and the only honest weight for a STACK of kernels. § 6i
   * normalized it away because one plane has nothing to be weighed against;
   * § 6k stacks planes and immediately needs it back, since a kernel scaled to
   * sum 1 carries no record of how much light reached it. Reading the ratio of
   * two `values` arrays would report 1 whatever the pupils did.
   */
  readonly formedSum: number;
  /** Largest |Δphase| in waves between adjacent transmitting lattice samples. */
  readonly maxGridPhaseStepWaves: number;
  readonly pixelScaleMm?: number;
}

/**
 * The incoherent PSF of a pupil, on `abbeImage`'s lattice.
 *
 * h = |F⁻¹{P}|², with P point-sampled at the same frequency bins the Abbe sum
 * multiplies its object spectrum by. See the header for why it may not be
 * `wave/psf`'s kernel: that one area-averages the rim, and the rim is exactly
 * where a comparison between the two modules would land.
 */
export function incoherentPsf(pupil: PupilFunction, options: IncoherentPsfOptions): IncoherentPsf {
  const n = options.size;
  requireGrid(n);
  const pupilSamples = options.pupilSamples;
  if (!(pupilSamples > 0)) throw new Error(`pupilSamples must be positive, got ${pupilSamples}`);
  // The pupil spans pupilSamples bins across its diameter and must sit inside
  // the grid with the lattice's outermost ring included. Clamping to the grid
  // instead would truncate it, and a truncated pupil is indistinguishable from
  // a smaller aperture — `abbeImage`'s own reason for throwing here, and the
  // same coverage cap that would read as physics.
  if (pupilSamples > n - 2) {
    throw new Error(
      `incoherentPsf: a pupil of ${pupilSamples} bins does not fit a ${n}-bin grid — raise size ` +
        `to at least ${pupilSamples + 2}, or lower pupilSamples`,
    );
  }

  const half = n / 2;
  const step = 2 / pupilSamples;
  const re = new Float64Array(n * n);
  const im = new Float64Array(n * n);
  // The pupil's support is |u| <= 1, so only that box is visited — which also
  // keeps a pupil function that re-traces rays from being asked about
  // frequencies it could never transmit (`abbeImage`'s own reason).
  const lo = Math.max(0, Math.ceil(half - 1 / step));
  const hi = Math.min(n - 1, Math.floor(half + 1 / step));
  const rowPhase = new Float64Array(n);
  const rowIn = new Uint8Array(n);
  let transmittingSamples = 0;
  let energy = 0;
  let maxGridPhaseStepWaves = 0;
  // The hull of the rows actually written, recorded as they are written — see
  // `fft2d`'s `writtenRows`. `lo`/`hi` above bound the pupil's box; this bounds
  // what the pupil put in it, which for an obstructed aperture is less.
  let firstRow = -1;
  let lastRow = -1;

  for (let iy = lo; iy <= hi; iy++) {
    const py = (iy - half) * step;
    let prevIn = false;
    let prevPhase = 0;
    for (let ix = lo; ix <= hi; ix++) {
      const px = (ix - half) * step;
      const a = pupil.amplitude(px, py);
      if (a <= 0) {
        // A blocked sample breaks the neighbour chain in both directions: a step
        // across the aperture rim is not a wavefront step, and counting it would
        // make an obstruction look like an unresolved wavefront.
        prevIn = false;
        rowIn[ix] = 0;
        continue;
      }
      const w = pupil.phaseWaves(px, py);
      if (prevIn) {
        const d = Math.abs(w - prevPhase);
        if (d > maxGridPhaseStepWaves) maxGridPhaseStepWaves = d;
      }
      if (rowIn[ix] === 1) {
        const d = Math.abs(w - rowPhase[ix]!);
        if (d > maxGridPhaseStepWaves) maxGridPhaseStepWaves = d;
      }
      prevIn = true;
      prevPhase = w;
      rowIn[ix] = 1;
      rowPhase[ix] = w;
      const ang = 2 * Math.PI * w;
      re[iy * n + ix] = a * Math.cos(ang);
      im[iy * n + ix] = a * Math.sin(ang);
      if (firstRow < 0) firstRow = iy;
      lastRow = iy;
      transmittingSamples++;
      energy += a * a;
    }
  }

  if (transmittingSamples === 0) {
    throw new Error(
      `incoherentPsf: the pupil transmits nothing on a ${n}-bin grid at pupilSamples ` +
        `${pupilSamples} — there is no image to form`,
    );
  }

  // Centred layout in, object coordinates out — `abbeImage`'s own convention,
  // so the kernel lands in the same frame as the images it will convolve.
  fftShift2d(re, n);
  fftShift2d(im, n);
  // The throw above is also what makes this band non-empty: `transmittingSamples
  // > 0` is exactly `firstRow >= 0`, set by the same write.
  fft2d(re, im, n, true, shiftedRowBand(firstRow, lastRow, n));
  const values = new Float64Array(n * n);
  let sum = 0;
  for (let i = 0; i < n * n; i++) {
    const v = re[i]! * re[i]! + im[i]! * im[i]!;
    values[i] = v;
    sum += v;
  }
  // Normalized to unit sum, so a uniform emitter field images as itself and the
  // kernel carries no brightness of its own. The energy it was built from is
  // reported separately rather than folded in — a caller comparing two
  // apertures needs it, and a caller convolving does not.
  for (let i = 0; i < n * n; i++) values[i] = values[i]! / sum;

  return {
    size: n,
    pupilSamples,
    values,
    transmittingSamples,
    energy,
    formedSum: sum,
    maxGridPhaseStepWaves,
    ...(options.scale === undefined
      ? {}
      : { pixelScaleMm: imagePixelScaleMm(options.scale, n, pupilSamples) }),
  };
}

export interface FluorescenceImage {
  readonly size: number;
  readonly pupilSamples: number;
  /** Intensity, in the object's own coordinates (NOT fftshifted). */
  readonly intensity: Float64Array;
  /** Lattice points the pupil transmitted, from the kernel. */
  readonly transmittingSamples: number;
  /** Largest |Δphase| in waves between adjacent transmitting lattice samples. */
  readonly maxGridPhaseStepWaves: number;
  readonly pixelScaleMm?: number;
}

/**
 * Form the fluorescence image of an emitter field through one pupil.
 *
 * One transform pair, against `abbeImage`'s one per source point — the cost of
 * emitting rather than modulating, and it is the reason a fluorescence render
 * can afford field sampling a brightfield render cannot.
 */
export function incoherentImage(
  object: EmitterField,
  pupil: PupilFunction,
  options: { readonly pupilSamples: number; readonly scale?: PupilScale },
): FluorescenceImage {
  const n = object.size;
  requireGrid(n);
  if (object.values.length !== n * n) {
    throw new Error(`emitter field must hold ${n * n} values`);
  }
  const kernel = incoherentPsf(pupil, {
    pupilSamples: options.pupilSamples,
    size: n,
    ...(options.scale === undefined ? {} : { scale: options.scale }),
  });
  return {
    size: n,
    pupilSamples: options.pupilSamples,
    intensity: convolveCircular(object.values, kernel.values, n),
    transmittingSamples: kernel.transmittingSamples,
    maxGridPhaseStepWaves: kernel.maxGridPhaseStepWaves,
    ...(kernel.pixelScaleMm === undefined ? {} : { pixelScaleMm: kernel.pixelScaleMm }),
  };
}

/**
 * Circular convolution of two same-size real grids, both in DC-at-0 layout.
 *
 * `imaging/render`'s `convolveCentred` rolls its kernel by half a grid because
 * a PSF from `wave/psf` arrives fftshifted. `incoherentPsf` does not shift, so
 * there is nothing to roll back — and a roll applied anyway would translate
 * every image by half a frame, which is invisible to every energy check and
 * obvious in a picture (§ 3c's own lesson).
 */
function convolveCircular(object: Float64Array, kernel: Float64Array, n: number): Float64Array {
  const objRe = Float64Array.from(object);
  const objIm = new Float64Array(n * n);
  const kerRe = Float64Array.from(kernel);
  const kerIm = new Float64Array(n * n);
  fft2d(objRe, objIm, n);
  fft2d(kerRe, kerIm, n);
  for (let i = 0; i < n * n; i++) {
    const ar = objRe[i]!;
    const ai = objIm[i]!;
    const br = kerRe[i]!;
    const bi = kerIm[i]!;
    objRe[i] = ar * br - ai * bi;
    objIm[i] = ar * bi + ai * br;
  }
  fft2d(objRe, objIm, n, true);
  return objRe;
}

export interface FluorescenceFieldOptions {
  /** Patches across the field, per axis. 1 is plain isoplanatic imaging. */
  readonly patches?: number;
  /** Frequency bins across the pupil diameter, as in `abbeImage`. */
  readonly pupilSamples: number;
  /** Supply to get a physical `pixelScaleMm` back; omit for grid units. */
  readonly scale?: PupilScale;
  /** Called once per patch imaged, for progress and cost accounting. */
  readonly onPatch?: (done: number, total: number) => void;
}

export interface FluorescenceFieldResult {
  readonly size: number;
  readonly patches: number;
  readonly pupilSamples: number;
  readonly intensity: Float64Array;
  /** Max over patches — the grid's ability to carry the worst pupil it saw. */
  readonly maxGridPhaseStepWaves: number;
  readonly pixelScaleMm?: number;
}

/**
 * Form the fluorescence image across a field whose pupil is not constant.
 *
 * `renderBrightfield`'s twin, with two differences and both are the specimen's
 * doing: there is no `CondenserSource`, and the partition of unity is applied
 * to the **emitters** rather than to the finished intensities. See the header
 * for why the input side is available here and unavailable there.
 *
 * The pupil arrives by normalized position, `pupilAt(u, v)`, for
 * `imaging/brightfield`'s reason: keying on the patch index would make "patch 2
 * of 4" and "patch 2 of 8" different field points, so refining the
 * discretization would change the physics. `imaging/object-field`'s
 * `tracedFieldPupils` is the callback for a traced system, unchanged — a
 * `PatchPupil`'s `sampling` is simply unused here, since no verdict is minted.
 */
export function renderFluorescence(
  object: EmitterField,
  pupilAt: (u: number, v: number) => PatchPupil,
  options: FluorescenceFieldOptions,
): FluorescenceFieldResult {
  const patches = options.patches ?? 1;
  if (!Number.isInteger(patches) || patches < 1) {
    throw new Error(`patches must be a positive integer, got ${patches}`);
  }
  const n = object.size;
  requireGrid(n);
  const intensity = new Float64Array(n * n);
  const windowed = new Float64Array(n * n);
  let maxGridPhaseStepWaves = 0;
  let done = 0;

  for (let py = 0; py < patches; py++) {
    for (let px = 0; px < patches; px++) {
      const patch = pupilAt((px + 0.5) / patches, (py + 0.5) / patches);
      windowed.fill(0);
      for (let y = 0; y < n; y++) {
        const wy = patchWeight((y + 0.5) / n, py, patches);
        if (wy === 0) continue;
        for (let x = 0; x < n; x++) {
          const value = object.values[y * n + x]!;
          if (value === 0) continue;
          const wx = patchWeight((x + 0.5) / n, px, patches);
          if (wx === 0) continue;
          windowed[y * n + x] = value * wx * wy;
        }
      }

      const formed = incoherentImage({ size: n, values: windowed }, patch.pupil, {
        pupilSamples: options.pupilSamples,
        ...(options.scale === undefined ? {} : { scale: options.scale }),
      });
      maxGridPhaseStepWaves = Math.max(maxGridPhaseStepWaves, formed.maxGridPhaseStepWaves);
      for (let i = 0; i < n * n; i++) intensity[i] = intensity[i]! + formed.intensity[i]!;
      options.onPatch?.(++done, patches * patches);
    }
  }

  return {
    size: n,
    patches,
    pupilSamples: options.pupilSamples,
    intensity,
    maxGridPhaseStepWaves,
    ...(options.scale === undefined
      ? {}
      : { pixelScaleMm: imagePixelScaleMm(options.scale, n, options.pupilSamples) }),
  };
}

/** A point emitter, positioned on the **specimen** in millimetres. */
export interface PointEmitter {
  /** Object-plane coordinates (mm from the axis). */
  readonly xMm: number;
  readonly yMm: number;
  /** Relative emitted power. Dimensionless until photometric zero points land. */
  readonly flux: number;
}

/**
 * Rasterize point emitters onto the frame's emitter grid — the beads scene.
 *
 * Beads are the branch's first specimen for a reason that is about the engine
 * and not about biology: a point emitter is placed **individually, through the
 * traced chief ray**, so the distortion of the objective is carried in the
 * placement. § 6h left the grid itself unwarped, and a scene made of points did
 * not need the rasterizer that was missing, because each point is mapped on its
 * own. A stained-tissue field would have needed it, which is why it was not
 * this one.
 *
 * That rasterizer is now `imaging/specimen` (§ 6n), and the distinction it
 * draws is the reason this one stays: it warps an amplitude **transmittance**,
 * which is a property of a point and needs no Jacobian. Emitters are a
 * **density**, so an extended emitter field needs det J — § 6n named it and
 * § 6as built it, in `imaging/emitter-density`. Placing points through their own
 * chief rays is how *this* function avoids ever having to, which is why it stays
 * rather than being replaced by the general one. § 6n.1 pins the first two
 * rasterizers to one pixel convention and § 6as.6 pins the third to them — on
 * centroid, because a bilinear splat and a point sample cannot agree pixel for
 * pixel without one of them being measured instead of the optics.
 *
 * Bilinear splatting, `imaging/scene`'s convention and for its reason: a bead
 * between pixels must land between pixels, or moving one produces a brightness
 * jitter that looks exactly like the scintillation the engine models for real.
 */
export function rasterizeEmitters(
  system: OpticalSystem,
  frame: ObjectFieldFrame,
  emitters: readonly PointEmitter[],
  options: { readonly aim?: AimOptions } = {},
): EmitterField {
  const n = frame.size;
  const values = new Float64Array(n * n);
  const centre = n / 2;
  const aim = options.aim ?? {};

  for (const emitter of emitters) {
    const heightMm = Math.hypot(emitter.xMm, emitter.yMm);
    const imageRadiusMm = imageRadiusForObjectHeight(system, heightMm, frame.wavelengthNm, aim);
    const azimuth = heightMm > 0 ? Math.atan2(emitter.yMm, emitter.xMm) : 0;
    // Relative to the frame's own centre, so a § 6m tile places its beads where
    // it is looking rather than where the axis is. Exact for the axial frame.
    const px =
      centre + (imageRadiusMm * Math.cos(azimuth) - frame.centreMm.x) / frame.pixelScaleMm;
    const py =
      centre + (imageRadiusMm * Math.sin(azimuth) - frame.centreMm.y) / frame.pixelScaleMm;
    const x0 = Math.floor(px);
    const y0 = Math.floor(py);
    if (x0 < 0 || y0 < 0 || x0 + 1 >= n || y0 + 1 >= n) continue;
    const fx = px - x0;
    const fy = py - y0;
    values[y0 * n + x0] = values[y0 * n + x0]! + emitter.flux * (1 - fx) * (1 - fy);
    values[y0 * n + x0 + 1] = values[y0 * n + x0 + 1]! + emitter.flux * fx * (1 - fy);
    values[(y0 + 1) * n + x0] = values[(y0 + 1) * n + x0]! + emitter.flux * (1 - fx) * fy;
    values[(y0 + 1) * n + x0 + 1] = values[(y0 + 1) * n + x0 + 1]! + emitter.flux * fx * fy;
  }

  return { size: n, values };
}

/** A uniformly fluorescing field — the negative control. */
export function uniformEmitters(size: number, level = 1): EmitterField {
  requireGrid(size);
  const values = new Float64Array(size * size);
  values.fill(level);
  return { size, values };
}

/**
 * A sinusoidal emitter grating, E = 1 + m·cos(2π·k·x/size).
 *
 * The intensity twin of `cosineGratingObject`: that one modulates an amplitude
 * and this one modulates emitted power, which is why brightfield's transfer
 * depends on the modulation (§ 6f.4) and this one's cannot. `cycles` is an
 * integer so the grating is exactly periodic on the grid and its spectrum is
 * exactly three lattice lines — the same discipline, for the same reason.
 */
export function cosineGratingEmitters(options: {
  size: number;
  cycles: number;
  modulation: number;
}): EmitterField {
  const { size, cycles, modulation } = options;
  requireGrid(size);
  if (!Number.isInteger(cycles) || cycles < 0) {
    throw new Error(`grating cycles must be a non-negative integer, got ${cycles}`);
  }
  if (!(modulation >= 0) || modulation > 1) {
    throw new Error(`grating modulation must lie in [0, 1], got ${modulation}`);
  }
  const values = new Float64Array(size * size);
  for (let x = 0; x < size; x++) {
    const e = 1 + modulation * Math.cos((2 * Math.PI * cycles * x) / size);
    for (let y = 0; y < size; y++) values[y * size + x] = e;
  }
  return { size, values };
}

/**
 * The condenser that makes `abbeImage` exactly incoherent — the header's
 * condition 2, constructed rather than approximated.
 *
 * `diskSource` spaces its points by 2·S/samples; setting that equal to the
 * pupil's own frequency step 2/pupilSamples fixes the count at S·pupilSamples,
 * and the lattice then maps onto itself under a translation by any whole number
 * of frequency bins — which is what turns the order-pair bracket into a
 * discrete autocorrelation. An **odd** count additionally puts a point at
 * s = 0, so the source samples the pupil on the same sub-lattice
 * `incoherentPsf` does; an even one is the same lattice offset by half a step,
 * which satisfies the condition for the convolution but reads the pupil
 * slightly differently. § 6i.1 pins both statements.
 *
 * Throws rather than rounding: a count rounded to the nearest integer would
 * still produce a perfectly plausible image, one whose disagreement with the
 * incoherent limit would look like physics.
 *
 * **It enforces condition 2 only.** Condition 1 — that S reaches past 1 + B —
 * depends on the object, which this constructor never sees, and it stays the
 * caller's to satisfy. It deliberately may not throw on it: § 6i.1's negative
 * control is a lattice-matched source at S = 0.5 and S = 1, which is exactly a
 * source satisfying one condition and not the other, and it must be
 * constructible for the identity to have a control at all.
 *
 * § 6p generalized it: `commensurateSource(S, pupilSamples, m)` steps by m times
 * the pupil's frequency step, and this is the m = 1 case, which is the only one
 * that makes the sum *incoherent*. It inherits that constructor's requirement
 * that `pupilSamples` be a power of two — the exactness argument above is
 * algebraic, but the cache § 6p builds on it is arithmetic, and 2/N is exactly
 * representable only there.
 */
export function latticeMatchedSource(
  coherenceParameter: number,
  pupilSamples: number,
): CondenserSource {
  const samples = coherenceParameter * pupilSamples;
  if (!Number.isInteger(samples) || samples < 1) {
    throw new Error(
      `latticeMatchedSource: S·pupilSamples must be a positive integer for the source lattice ` +
        `to step by the pupil's own frequency step — got ${coherenceParameter} × ${pupilSamples} ` +
        `= ${samples}`,
    );
  }
  return commensurateSource(coherenceParameter, pupilSamples, 1);
}

function requireGrid(size: number): void {
  if (!isPowerOfTwo(size)) throw new Error(`grid size must be a power of two, got ${size}`);
}
