import { besselJ } from "../math/bessel";
import { fft1d, fft2d, fftShift2d, isPowerOfTwo, shiftedRowBand } from "../math/fft";
import { imagePixelScaleMm, type PupilFunction, type PupilScale } from "../wave/psf";
import type { CondenserSource } from "./source";

/**
 * Abbe imaging — how a brightfield microscope actually forms an image.
 *
 * Everything the wave layer has done so far assumes the object *emits*: a star,
 * a fluorescent bead. Then the object is incoherent, intensities add, and the
 * image is a convolution with |PSF|². A brightfield specimen emits nothing. It
 * sits in a beam and modulates it, so the field leaving it is the illuminating
 * field times a transmittance — and whether two neighbouring points of the
 * specimen interfere depends on whether the light hitting them came from the
 * same place. That is **partial coherence**, and it makes the image
 * *nonlinear* in the object's intensity: brightfield has no single MTF, and a
 * "condenser factor" multiplying the incoherent one would be a fiction.
 *
 * Abbe's construction is the honest version, and it is a sum, not a fudge:
 *
 *  1. The condenser aperture is a set of illumination directions (`source.ts`).
 *  2. Each direction is one plane wave, so under it the imaging is **coherent**
 *     — the field is a linear filter of the object's spectrum.
 *  3. Different directions come from different points of the lamp, which are
 *     mutually incoherent, so their **intensities** add.
 *
 *     I(x) = Σ_s w_s · | F⁻¹{ T(u) · P(u + s) } |²
 *
 * with T the object's spectrum, P the complex pupil, and s the illumination
 * direction in normalized pupil units. The whole of partial coherence is that
 * one line: the modulus-squared is inside the sum over s, not outside.
 *
 * ## The one move that makes this cheap here: the tilt shifts the *pupil*
 *
 * Illuminating from direction s multiplies the object by exp(2πi·s·x), which
 * slides its spectrum by s. Changing variables slides the pupil the other way
 * instead and leaves a global phase that the modulus discards — so an
 * illumination direction is a **translated pupil**, `shiftPupil` below, and
 * nothing about the transform changes. That is the same lever the spider
 * (§ 5c) and the seeing screen (§ 5d) pulled: a new optical effect arrives as a
 * `PupilFunction` and the machinery below it never learns its name. The
 * aberration slides with the support, which is correct and not an
 * approximation — each diffracted order really does cross the pupil at a
 * different place and pick up the wavefront error *there*.
 *
 * ## Coordinates, and why the object is given in image-plane units
 *
 * The grid is the same one `wave/psf` builds: `size`×`size` samples with the
 * pupil spanning `pupilSamples` frequency bins across its diameter, so
 * frequency bin k maps to normalized pupil coordinate 2k/pupilSamples and the
 * incoherent cutoff sits at exactly `pupilSamples` bins — the identity
 * `wave/mtf` already rests on. The object is therefore supplied as its
 * *geometric image*: the specimen scaled by the magnification, the standard
 * reduced-coordinate convention. The sine condition is what makes this exact
 * rather than paraxial bookkeeping — NA_obj·h_obj = NA_img·h_img — and it is
 * also why the coherence parameter S, a ratio of object-side apertures, needs
 * no conversion to be used here.
 *
 * ## One deliberate difference from `wave/psf`: the pupil is point-sampled
 *
 * `pupilSampling` area-averages cells the aperture rim cuts, because there it
 * is approximating a continuous integral over the aperture. Here the pupil
 * multiplies a *sampled* spectrum on the DFT lattice, so the midpoint rule is
 * the discretization, and each spectral sample is either transmitted or not.
 * Averaging the rim would apodize the object's spectrum instead of the
 * aperture — a different approximation, and the wrong one exactly at the
 * cutoff, which is where every § 6f rung lives.
 *
 * It also makes this module's transmitting set a strict SUBSET of `wave/psf`'s:
 * a lattice point inside the disc always lies in a cell the disc overlaps, but
 * not conversely. `maxGridPhaseStepWaves` is a maximum over neighbour pairs, so
 * the subset relation makes this one exactly ≤ the PSF's — the PSF's rim ring
 * sits further out, where the wavefront is steeper. That is an exact
 * inequality, not a tolerance, and § 6f.9 pins it as such.
 *
 * ## The two fidelity questions, and which one is answered here
 *
 * `maxGridPhaseStepWaves` below answers "did this grid carry the pupil it was
 * handed?". It does NOT answer "is a coherent sum the right physics for this
 * system at all?" — that one is measured on raw traced samples and ruled on by
 * `illumination/fidelity`, because the geometric PSF branch the engine falls
 * back to has no notion of coherence and so cannot stand in for this sum. A
 * pupil function arriving here carries no memory of what traced it, which is
 * exactly why the verdict lives one level up.
 */

/**
 * The same pupil, seen from an illumination direction: P_s(u) = P(u + s).
 *
 * Amplitude and phase both slide, which is what carries "this diffracted order
 * crosses the pupil off-centre and picks up the aberration there".
 */
export function shiftPupil(pupil: PupilFunction, sx: number, sy: number): PupilFunction {
  return {
    amplitude: (px, py) => pupil.amplitude(px + sx, py + sy),
    phaseWaves: (px, py) => pupil.phaseWaves(px + sx, py + sy),
  };
}

/**
 * A complex amplitude transmittance sampled on the image-plane grid.
 *
 * Amplitude, not intensity: a specimen that absorbs half the light has
 * transmittance √0.5, and one that only retards the phase has |t| = 1 — which
 * is precisely why it is invisible in brightfield (§ 6f).
 */
export interface ObjectField {
  /** Grid size; `re`/`im` are `size`×`size`, row-major. Power of two. */
  readonly size: number;
  readonly re: Float64Array;
  readonly im: Float64Array;
  /**
   * Present when the object's own spectrum did not fit the grid and had to be
   * cut to it (`phaseGratingObject`). Absent means nothing was lost — a
   * constructor whose spectrum is finite, like `cosineGratingObject`'s three
   * lines, has nothing to report.
   */
  readonly truncation?: SpectrumTruncation;
}

/** A perfectly clear field of view — transmittance 1 everywhere. */
export function uniformObject(size: number): ObjectField {
  requireGrid(size);
  const re = new Float64Array(size * size);
  re.fill(1);
  return { size, re, im: new Float64Array(size * size) };
}

/**
 * A sinusoidal **absorption** grating, t = 1 + m·cos(2π·k·x/size).
 *
 * `cycles` is an integer so the grating is exactly periodic on the grid and its
 * spectrum is exactly three lattice lines — no leakage to disentangle from the
 * optics. Its frequency in the units this module works in is
 * ν = 2·cycles/pupilSamples, in which the coherent cutoff is 1 and the
 * incoherent cutoff is 2.
 */
export function cosineGratingObject(options: {
  size: number;
  cycles: number;
  modulation: number;
}): ObjectField {
  const { size, cycles, modulation } = options;
  requireGrid(size);
  requireCycles(cycles);
  if (!(modulation >= 0) || modulation > 1) {
    throw new Error(`grating modulation must lie in [0, 1], got ${modulation}`);
  }
  const re = new Float64Array(size * size);
  for (let x = 0; x < size; x++) {
    const t = 1 + modulation * Math.cos((2 * Math.PI * cycles * x) / size);
    for (let y = 0; y < size; y++) re[y * size + x] = t;
  }
  return { size, re, im: new Float64Array(size * size) };
}

/**
 * What a finite grid costs an object whose spectrum is infinite.
 *
 * A phase grating's orders do not stop. `maxOrder` is how many of them the grid
 * can hold in their own places; the two numbers say how much of the object was
 * left out, so a caller can print the error instead of discovering it.
 */
export interface SpectrumTruncation {
  /**
   * Highest diffraction order |m| whose bin m·cycles still lies inside the
   * grid. `Infinity` at zero cycles, where every order lands on DC and the sum
   * is exact.
   */
  readonly maxOrder: number;
  /**
   * Bound on ||t| − 1|, the amplitude ripple the truncation leaves behind:
   * 2·Σ_{|m|>maxOrder} |Jₘ(φ)|, since each dropped order can add at most its
   * own modulus. A band-limited phase object is not *quite* a pure phase
   * object, and this is by how much.
   */
  readonly modulusBound: number;
  /**
   * Fraction of the transmitted light in the orders that were dropped,
   * 2·Σ_{|m|>maxOrder} Jₘ(φ)² — exact, not a bound, because Σₘ Jₘ² = 1.
   */
  readonly droppedEnergy: number;
}

/**
 * A sinusoidal **phase** grating, t = exp(i·φ·cos(2π·k·x/size)) — band-limited
 * to the orders this grid can actually carry.
 *
 * ## Why this is not the pointwise formula
 *
 * Jacobi–Anger: exp(i·φ·cos θ) = Σₘ iᵐ Jₘ(φ) e^{imθ}, a sum over **every**
 * integer order, with the m-th sitting at bin m·cycles. Evaluating the
 * exponential sample by sample writes all of them onto a grid that has room for
 * |m·cycles| < size/2, and the rest do not vanish — they **fold**, landing on
 * bins that are not m·cycles. `abbeImage` then reads those bins as the object's
 * angular spectrum, because that is what a DFT bin means to it, and admits the
 * folded orders through the pupil as though they were diffracted into those
 * directions. They are not; nothing about the object sends light there.
 *
 * The damage is not confined to one readout. A folded pair 2·cycles apart in
 * *bin* space beats into the 2ν bin whatever the pupil looks like, so at φ = 3,
 * 13 cycles and 128 bins a darkfield cell that can carry no second harmonic at
 * all still reads 1.2e-7 — small enough to pass for signal (§ 6ab.12). But the
 * same folded orders are in the image everywhere else too, and there they are
 * hidden under a real one.
 *
 * So this constructor synthesizes the object **from its spectrum**: the orders
 * that fit are placed in their bins, the rest are left out, and the field is the
 * inverse transform. Then the DFT bins of the object *are* its angular
 * spectrum — the thing `abbeImage` already assumes — and no order is ever in a
 * place the object did not put it.
 *
 * ## The price, and it is reported rather than hidden
 *
 * A truncated series is no longer exactly unit modulus: dropping orders leaves
 * an amplitude ripple of up to 2·Σ|Jₘ| over the dropped tail, so the object
 * absorbs a little. This is physics, not an artefact — a strictly band-limited
 * object *cannot* be pure phase — and it is returned in `truncation` so a panel
 * can quote it. It falls off superexponentially past m ≈ φ, so over almost all
 * of the panel it is invisible: at φ = 0.4 on a 128-grid at 12 cycles the ripple
 * is 1.8e-7 and the light lost is 1.6e-14.
 *
 * At the corner of both sliders it is not small. 31 cycles on 128 bins leaves
 * room for |m| ≤ 2, and dropping J₃(3) = 0.31 onward loses **23% of the light**.
 * That is the honest reading of a grating this fine at a phase this deep on a
 * grid this coarse, and the pointwise construction does not avoid it — it keeps
 * the same 23% and puts it in directions the object diffracts nothing into,
 * where it becomes image detail indistinguishable from the real thing. Missing
 * light is a number a panel can print; misplaced light is not.
 *
 * Refusing instead would need a threshold on "how much ripple is too much", and
 * there is no such number here. A bound the caller can read is the honest
 * version of the same warning.
 *
 * `pointwisePhaseGratingObject` keeps the old sample-by-sample construction,
 * for the rung that measures what this fixes.
 *
 * One behaviour changed besides the spectrum: φ past `BESSEL_SERIES_LIMIT` now
 * throws, where the pointwise formula accepted any φ. Building from orders means
 * evaluating Jₘ(φ), and past 25 radians the series returns noise — a grating
 * whose orders are noise is worse than a refusal. The panel's slider stops at 3.
 */
export function phaseGratingObject(options: {
  size: number;
  cycles: number;
  /** Peak phase excursion in radians. */
  amplitudeRadians: number;
}): ObjectField {
  const { size, cycles, amplitudeRadians } = options;
  requireGrid(size);
  requireCycles(cycles);
  const truncation = phaseGratingTruncation(options);

  // Zero cycles is not a grating: every order lands on DC and Σₘ iᵐJₘ(φ) is
  // exp(iφ) exactly. Synthesizing it as a spectrum would put the whole series
  // in one bin and lose digits summing it.
  if (cycles === 0) {
    const re = new Float64Array(size * size).fill(Math.cos(amplitudeRadians));
    const im = new Float64Array(size * size).fill(Math.sin(amplitudeRadians));
    return { size, re, im, truncation };
  }

  // One row's spectrum: c_m = iᵐ Jₘ(φ) at bin (m·cycles mod size), and
  // c₋ₘ = c_m because J₋ₘ = (−1)ᵐJₘ cancels i^{−m} against iᵐ. Scaled by `size`
  // because `fft1d`'s inverse carries the 1/N.
  const rowRe = new Float64Array(size);
  const rowIm = new Float64Array(size);
  const put = (bin: number, cRe: number, cIm: number): void => {
    const k = ((bin % size) + size) % size;
    rowRe[k] = size * cRe;
    rowIm[k] = size * cIm;
  };
  put(0, besselJ(0, amplitudeRadians), 0);
  for (let m = 1; m <= truncation.maxOrder; m++) {
    const j = besselJ(m, amplitudeRadians);
    // iᵐ cycles 1, i, −1, −i.
    const cRe = m % 2 === 0 ? (m % 4 === 0 ? j : -j) : 0;
    const cIm = m % 2 === 0 ? 0 : m % 4 === 1 ? j : -j;
    put(m * cycles, cRe, cIm);
    put(-m * cycles, cRe, cIm);
  }
  fft1d(rowRe, rowIm, true);

  // The grating runs along x, so every row of the object is that same row.
  const re = new Float64Array(size * size);
  const im = new Float64Array(size * size);
  for (let x = 0; x < size; x++) {
    const c = rowRe[x]!;
    const s = rowIm[x]!;
    for (let y = 0; y < size; y++) {
      re[y * size + x] = c;
      im[y * size + x] = s;
    }
  }
  return { size, re, im, truncation };
}

/**
 * How much of `phaseGratingObject`'s spectrum this grid cannot hold.
 *
 * Pure arithmetic on (size, cycles, φ) — no field is built, so a panel can quote
 * the bound beside a slider without paying for a render.
 */
export function phaseGratingTruncation(options: {
  size: number;
  cycles: number;
  amplitudeRadians: number;
}): SpectrumTruncation {
  const { size, cycles, amplitudeRadians } = options;
  requireGrid(size);
  requireCycles(cycles);
  if (cycles === 0) {
    return { maxOrder: Number.POSITIVE_INFINITY, modulusBound: 0, droppedEnergy: 0 };
  }
  // size/2 is the Nyquist bin, which is its own alias; the last bin that is
  // unambiguously a positive frequency is size/2 − 1.
  const maxOrder = Math.floor((size / 2 - 1) / cycles);

  // The dropped tail. Jₘ(φ) decays superexponentially once m > φ, so the sum
  // converges after a handful of terms — but only past the hump, which is why
  // the early-out waits for m to clear |φ|.
  const ax = Math.abs(amplitudeRadians);
  let modulusBound = 0;
  let droppedEnergy = 0;
  for (let m = maxOrder + 1; m <= maxOrder + 1 + 400; m++) {
    const j = Math.abs(besselJ(m, amplitudeRadians));
    modulusBound += 2 * j;
    droppedEnergy += 2 * j * j;
    if (m > ax && j < 1e-20) break;
  }
  return { maxOrder, modulusBound, droppedEnergy };
}

/**
 * The pointwise construction — the one that aliases, kept as the control.
 *
 * Sampling exp(i·φ·cos θ) at the grid points is the obvious way to build this
 * object and it is what the engine did until § 6ab.12. Nothing is wrong with the
 * *samples*: they are the continuous object's values to f64. What is wrong is
 * reading their DFT as an angular spectrum, which is exactly what `abbeImage`
 * does, because the orders past |m| = (size/2 − 1)/cycles have folded into bins
 * that belong to other directions.
 *
 * It stays exported so the rung can render both objects through the same imaging
 * path and show the difference, rather than asserting that a fix worked from the
 * inside. Not for forming images anyone believes.
 */
export function pointwisePhaseGratingObject(options: {
  size: number;
  cycles: number;
  amplitudeRadians: number;
}): ObjectField {
  const { size, cycles, amplitudeRadians } = options;
  requireGrid(size);
  requireCycles(cycles);
  const re = new Float64Array(size * size);
  const im = new Float64Array(size * size);
  for (let x = 0; x < size; x++) {
    const phi = amplitudeRadians * Math.cos((2 * Math.PI * cycles * x) / size);
    const c = Math.cos(phi);
    const s = Math.sin(phi);
    for (let y = 0; y < size; y++) {
      re[y * size + x] = c;
      im[y * size + x] = s;
    }
  }
  return { size, re, im };
}

function requireCycles(cycles: number): void {
  if (!Number.isInteger(cycles) || cycles < 0) {
    throw new Error(`grating cycles must be a non-negative integer, got ${cycles}`);
  }
}

function requireGrid(size: number): void {
  if (!isPowerOfTwo(size)) throw new Error(`object grid size must be a power of two, got ${size}`);
}

export interface AbbeOptions {
  /** Frequency bins across the pupil DIAMETER — the scale, as in `wave/psf`. */
  readonly pupilSamples: number;
  /** Supply to get a physical `pixelScaleMm` back; omit for grid units. */
  readonly scale?: PupilScale;
}

export interface AbbeImage {
  readonly size: number;
  readonly pupilSamples: number;
  /** Intensity, in the object's own coordinates (NOT fftshifted). */
  readonly intensity: Float64Array;
  /** Source points that contributed at all — i.e. whose shifted pupil was
   * non-empty over the grid. A darkfield annulus outside the pupil still
   * contributes (its diffracted orders do); a source point whose entire pupil
   * falls off the frequency grid does not, and that is a sampling failure
   * rather than physics, so it is reported. */
  readonly contributingPoints: number;
  /**
   * Largest |Δphase| in waves between adjacent transmitting samples OF THE DFT
   * LATTICE this sum evaluated on — i.e. whether the grid carried the pupil it
   * was handed. `wave/psf` reports the same number for the same reason, and
   * the same caveat applies: it is NOT the fidelity criterion. That one is
   * measured on raw traced samples and lives in `wave/fidelity`; the
   * brightfield verdict built on it is `illumination/fidelity`.
   *
   * Maximized over source points, not measured at s = 0, and that is
   * load-bearing rather than tidy. Illuminating from direction s slides the
   * sampled pupil coordinates to (ix − n/2)·Δ + s, so every direction reads the
   * pupil on its own offset sub-lattice. For a smooth rim-peaked wavefront the
   * sub-lattices barely differ — defocus spreads them by O(Δ²) and the on-axis
   * one happens to be the largest. But nothing makes that general: a pupil
   * carrying structure at the lattice period is **invisible** to the on-axis
   * sub-lattice and full-strength to one offset by half a step. A ripple of
   * amplitude A at exactly that period reads 0 at s = 0 and 2A·|sin(π·s/Δ)|
   * elsewhere (§ 6f.9 pins both), which is the difference between a silent pass
   * and a flag. Taking the maximum is what makes the number mean "some
   * direction could not carry this pupil".
   *
   * It is still a maximum over the directions the condenser actually has, not
   * over all offsets — a source whose points happen to land near multiples of
   * Δ will under-report. Sampling the source is § 6f.2's convergence knob and
   * this rides on it.
   *
   * Reported, never thrown on. The throw above is for a sampling failure a
   * caller fixes with a parameter; an aberrated pupil is physics a caller may
   * legitimately want to look at.
   */
  readonly maxGridPhaseStepWaves: number;
  /**
   * How many times `pupil.amplitude` was called — the cost of this sum in the
   * only currency that varies, since a traced `PupilFunction` re-traces rays on
   * every call and the transforms underneath do not care what produced them.
   *
   * Without a commensurate source it is one pass over the shifted-pupil box per
   * contributing direction. With one (§ 6p) it is a **single** pass, so the
   * ratio between the two is exactly `contributingPoints` — which is the speed
   * claim stated as an integer a test can assert rather than as a wall clock.
   * It is also how a caller learns the cache was taken: nothing is silent.
   */
  readonly pupilEvaluations: number;
  readonly pixelScaleMm?: number;
}

/**
 * Form the partially coherent image of `object` through `pupil` under `source`.
 *
 * Cost is one inverse transform per source point, so it scales with the
 * condenser's sampling exactly the way `renderField`'s cost scales with patches
 * — and, like that one, the sampling count is a knob whose convergence is
 * pinned rather than assumed (§ 6f).
 */
export function abbeImage(
  object: ObjectField,
  pupil: PupilFunction,
  source: CondenserSource,
  options: AbbeOptions,
): AbbeImage {
  const n = object.size;
  requireGrid(n);
  const pupilSamples = options.pupilSamples;
  if (!(pupilSamples > 0)) throw new Error(`pupilSamples must be positive, got ${pupilSamples}`);
  if (object.re.length !== n * n || object.im.length !== n * n) {
    throw new Error(`object arrays must hold ${n * n} elements`);
  }

  // Object spectrum, once, in centred layout so it lines up with the pupil's
  // own coordinates (bin ix ↔ normalized pupil 2(ix − n/2)/pupilSamples).
  const specRe = Float64Array.from(object.re);
  const specIm = Float64Array.from(object.im);
  fft2d(specRe, specIm, n);
  fftShift2d(specRe, n);
  fftShift2d(specIm, n);

  const half = n / 2;
  const step = 2 / pupilSamples;
  const cache = buildPupilLatticeCache(pupil, pupilSamples, source);
  let pupilEvaluations = cache === undefined ? 0 : cache.evaluations;
  const intensity = new Float64Array(n * n);
  const workRe = new Float64Array(n * n);
  const workIm = new Float64Array(n * n);
  let contributingPoints = 0;
  // The lattice guard rides along inside the loop below rather than in a second
  // pass: `pupil.phaseWaves` may re-trace rays, so asking it again per
  // neighbour pair would be the expensive way to learn the same number. One
  // row of previous-row phases plus the previous column is all the state a
  // 4-neighbour difference needs.
  const rowPhase = new Float64Array(n);
  const rowIn = new Uint8Array(n);
  let maxGridPhaseStepWaves = 0;

  for (const s of source.points) {
    workRe.fill(0);
    workIm.fill(0);
    // The shifted pupil is supported on |u + s| <= 1, so only that box needs
    // visiting — which also keeps a pupil function that re-traces rays from
    // being asked about frequencies it could never transmit.
    const ixLo = Math.ceil(half + (-1 - s.sx) / step);
    const ixHi = Math.floor(half + (1 - s.sx) / step);
    const iyLo = Math.ceil(half + (-1 - s.sy) / step);
    const iyHi = Math.floor(half + (1 - s.sy) / step);
    // Clamping instead would truncate the pupil silently, and a truncated
    // pupil looks exactly like a smaller aperture — a coverage cap that would
    // read as physics. It throws.
    if (ixLo < 0 || iyLo < 0 || ixHi > n - 1 || iyHi > n - 1) {
      const reach = Math.max(Math.abs(s.sx), Math.abs(s.sy));
      throw new Error(
        `abbeImage: the pupil shifted to (${s.sx.toFixed(3)}, ${s.sy.toFixed(3)}) runs off a ` +
          `${n}-bin frequency grid at pupilSamples ${pupilSamples} — raise size to at least ` +
          `${Math.ceil(pupilSamples * (1 + reach)) + 2}, or lower pupilSamples`,
      );
    }

    // Where this direction's samples land on the shared lattice, when there is
    // one. `baseX` turns a grid index straight into a cache column, so the loop
    // below differs from the uncached one in exactly one expression: where the
    // pupil's two numbers come from.
    let baseX = 0;
    let baseY = 0;
    if (cache !== undefined) {
      baseX = latticeOffset(s.sx, pupilSamples, cache.parity, "sx") - half - cache.lo;
      baseY = latticeOffset(s.sy, pupilSamples, cache.parity, "sy") - half - cache.lo;
      // The box above was derived by dividing and rounding in floating point;
      // this one is integer arithmetic on the same lattice. They agree because
      // 2/pupilSamples is a power of two and every `s` is a whole number of
      // half-steps — which is precisely the precondition `commensurateSource`
      // enforces, so a disagreement means the source lied about its lattice.
      if (
        ixLo + baseX !== 0 ||
        ixHi + baseX !== cache.width - 1 ||
        iyLo + baseY !== 0 ||
        iyHi + baseY !== cache.width - 1
      ) {
        throw new Error(
          `abbeImage: the source point (${s.sx}, ${s.sy}) claims a lattice commensurate with ` +
            `pupilSamples ${pupilSamples}, but its shifted-pupil box does not land on that ` +
            `lattice — the cached sum would not be the uncached one`,
        );
      }
    }

    let transmitting = 0;
    // The hull of the rows this direction actually wrote, recorded as it writes
    // rather than derived from `iyLo`/`iyHi` afterwards — see `fft2d`'s
    // `writtenRows`, where the two directions of being wrong are not symmetric.
    // It is usually tighter than the box: a direction whose shifted pupil is
    // clipped by the aperture leaves whole rows of the box blocked.
    let firstRow = -1;
    let lastRow = -1;
    rowIn.fill(0, ixLo, ixHi + 1);
    for (let iy = iyLo; iy <= iyHi; iy++) {
      const py = (iy - half) * step + s.sy;
      const cacheRow = cache === undefined ? 0 : (iy + baseY) * cache.width + baseX;
      let prevIn = false;
      let prevPhase = 0;
      for (let ix = ixLo; ix <= ixHi; ix++) {
        const px = (ix - half) * step + s.sx;
        let a: number;
        if (cache === undefined) {
          a = pupil.amplitude(px, py);
          pupilEvaluations++;
        } else {
          a = cache.amplitude[cacheRow + ix]!;
        }
        if (a <= 0) {
          // A blocked sample breaks the chain in both directions: a step across
          // the aperture rim is not a wavefront step, and counting it would make
          // an obstruction look like an unresolved wavefront.
          prevIn = false;
          rowIn[ix] = 0;
          continue;
        }
        const w = cache === undefined ? pupil.phaseWaves(px, py) : cache.phaseWaves[cacheRow + ix]!;
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
        const pr = a * Math.cos(ang);
        const pi = a * Math.sin(ang);
        const idx = iy * n + ix;
        const tr = specRe[idx]!;
        const ti = specIm[idx]!;
        workRe[idx] = tr * pr - ti * pi;
        workIm[idx] = tr * pi + ti * pr;
        if (firstRow < 0) firstRow = iy;
        lastRow = iy;
        transmitting++;
      }
    }
    // Also what keeps an empty band out of `fft2d`: `transmitting > 0` is
    // exactly `firstRow >= 0`, because the same write sets both.
    if (transmitting === 0) continue;
    contributingPoints++;

    fftShift2d(workRe, n);
    fftShift2d(workIm, n);
    fft2d(workRe, workIm, n, true, shiftedRowBand(firstRow, lastRow, n));
    const w = s.weight;
    for (let i = 0; i < n * n; i++) {
      intensity[i] = intensity[i]! + w * (workRe[i]! * workRe[i]! + workIm[i]! * workIm[i]!);
    }
  }

  return {
    size: n,
    pupilSamples,
    intensity,
    contributingPoints,
    maxGridPhaseStepWaves,
    pupilEvaluations,
    ...(options.scale === undefined
      ? {}
      : { pixelScaleMm: imagePixelScaleMm(options.scale, n, pupilSamples) }),
  };
}

/**
 * The pupil, evaluated once over its support, for a source that reads it on one
 * lattice (§ 6p).
 *
 * Held per call and never module-level: `renderBrightfield` gives every patch
 * its own `PupilFunction`, so a cache that outlived the call would be a
 * correctness hazard rather than a saving.
 */
interface PupilLatticeCache {
  readonly amplitude: Float64Array;
  readonly phaseWaves: Float64Array;
  /** Lowest lattice index on each axis; the arrays are `width`×`width`. */
  readonly lo: number;
  readonly width: number;
  /** 1 when every source point sits half a step off the lattice, else 0. */
  readonly parity: number;
  readonly evaluations: number;
}

/**
 * The lattice index a source coordinate shifts the pupil by.
 *
 * `commensurateSource` builds every coordinate as a whole number of half-steps,
 * so multiplying by `pupilSamples` recovers that integer exactly rather than
 * approximately — and if it does not, the source is not what it says it is and
 * this throws instead of rounding.
 */
function latticeOffset(s: number, pupilSamples: number, parity: number, axis: string): number {
  const halfSteps = s * pupilSamples;
  if (!Number.isInteger(halfSteps) || (halfSteps - parity) % 2 !== 0) {
    throw new Error(
      `abbeImage: source ${axis} = ${s} is not ${parity === 1 ? "half a step off" : "on"} the ` +
        `pupil lattice at pupilSamples ${pupilSamples} — a source may only declare ` +
        `\`pupilLattice\` if every one of its points sits on it`,
    );
  }
  return (halfSteps - parity) / 2;
}

function buildPupilLatticeCache(
  pupil: PupilFunction,
  pupilSamples: number,
  source: CondenserSource,
): PupilLatticeCache | undefined {
  const lattice = source.pupilLattice;
  if (lattice === undefined || lattice.pupilSamples !== pupilSamples) return undefined;
  // s = (2i + 1 − samples)·m·(step/2), so every coordinate is a whole number of
  // half-steps and they all share ONE parity: odd exactly when the source grid
  // has no point on the axis and the multiple is odd. An odd parity is not a
  // corner case — S = 0.5 at pupilSamples 64 with stepMultiple 2 has 16 points
  // across and lands there.
  const parity = source.samples % 2 === 0 && lattice.stepMultiple % 2 === 1 ? 1 : 0;
  const step = 2 / pupilSamples;
  // The shifted pupil is supported on |u| ≤ 1 whichever direction it came from,
  // so the union over source points is one box — and it is the same box each
  // point visits, which is why the saving is exactly the point count.
  const lo = -pupilSamples / 2;
  const hi = pupilSamples / 2 - parity;
  const width = hi - lo + 1;
  const amplitude = new Float64Array(width * width);
  const phaseWaves = new Float64Array(width * width);
  const halfParity = 0.5 * parity;
  for (let jy = lo; jy <= hi; jy++) {
    const py = (jy + halfParity) * step;
    const row = (jy - lo) * width;
    for (let jx = lo; jx <= hi; jx++) {
      const px = (jx + halfParity) * step;
      const a = pupil.amplitude(px, py);
      amplitude[row + (jx - lo)] = a;
      // Asked only where the pupil transmits, exactly as the sum asks it: a
      // blocked sample's phase never enters the image or the lattice guard.
      if (a > 0) phaseWaves[row + (jx - lo)] = pupil.phaseWaves(px, py);
    }
  }
  return { amplitude, phaseWaves, lo, width, parity, evaluations: width * width };
}

export interface ImageHarmonic {
  /** Mean intensity. */
  readonly dc: number;
  /** Peak amplitude of the cos component at this frequency. */
  readonly amplitude: number;
  /** amplitude / dc — the modulation depth a contrast readout wants. */
  readonly contrast: number;
}

/**
 * One Fourier component of an image, by direct evaluation at a single bin.
 *
 * The measurement every § 6f rung is made with: how much of the object's
 * periodicity survived. Evaluating one bin directly rather than transforming
 * the whole image keeps it exact for a grating whose period divides the grid,
 * which is the only case the rungs use.
 */
export function imageHarmonic(
  intensity: Float64Array,
  size: number,
  kx: number,
  ky = 0,
): ImageHarmonic {
  const n = size;
  let dc = 0;
  let re = 0;
  let im = 0;
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const v = intensity[y * n + x]!;
      dc += v;
      const ang = (-2 * Math.PI * (kx * x + ky * y)) / n;
      re += v * Math.cos(ang);
      im += v * Math.sin(ang);
    }
  }
  const cells = n * n;
  const mean = dc / cells;
  // A real image splits its energy between the ±k bins, so the cosine amplitude
  // is twice one of them — at every bin that HAS a partner. A bin is its own
  // conjugate when (−kx, −ky) ≡ (kx, ky) on the grid, which is exactly 2k ≡ 0 in
  // each axis: k = 0 and k = N/2, and the four corners they make in 2-D. There
  // the one bin already carries the whole component, and doubling it reports
  // twice the modulation that is in the image. The test is modular, so an
  // argument that aliases (kx = N is bin 0) is classified by the bin it lands on.
  const selfConjugate =
    Number.isInteger(kx) && Number.isInteger(ky) && (2 * kx) % n === 0 && (2 * ky) % n === 0;
  // Still a modulus, so the sign is not reported: at Nyquist the alternating
  // −A and +A patterns read alike, as at every other bin.
  const amplitude = ((selfConjugate ? 1 : 2) * Math.hypot(re, im)) / cells;
  return { dc: mean, amplitude, contrast: mean > 0 ? amplitude / mean : 0 };
}
