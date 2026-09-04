import { OpticalSystem, WavelengthSample } from "../trace/system";
import { Psf, SystemPsfOptions } from "./psf";
import { GeometricPsfOptions, adaptivePsf } from "./geometric";

/**
 * Polychromatic PSF — stacking wavelengths onto one image.
 *
 * Polychromatic is the normal case, not a refinement: a star, a lamp and a
 * fluorophore all emit a spectrum, and the whole point of the achromat story
 * (roadmap step 4) is that colours focus differently.
 *
 * ## The one thing that makes this non-trivial
 *
 * **Pixel scale is proportional to λ.** From the pupil→image scale,
 *
 *     Δx = λ·R / (n·N·Δ_pupil)
 *
 * so every wavelength's PSF comes back on a grid of a DIFFERENT physical size.
 * A red pixel is a bigger piece of the image than a blue one. Summing the
 * arrays bin-for-bin therefore does not stack the wavelengths — it silently
 * rescales each one, which flattens exactly the chromatic differences the
 * calculation exists to show, and does it in a way that looks entirely
 * plausible.
 *
 * So each wavelength is **resampled onto a common physical grid** before
 * anything else happens to it. The resampling carries the Jacobian
 * (Δ_out/Δ_src)², because `intensity` is energy per pixel rather than a
 * density: change the pixel size and the energy each one holds changes with
 * its area.
 *
 * **The Jacobian is conditional on that, and this module is not the only
 * caller.** The λ-dependent grid is a property of the pupil→image transform and
 * not of the PSF, so `illumination/abbe`'s partially coherent image hits it too
 * — and that one holds an *irradiance*, a value per unit area, which resamples
 * with no Jacobian at all. Hence the two named siblings below,
 * `resampleEnergyGrid` and `resampleIrradianceGrid`: everything else in this
 * file is about a PSF, and those two are not. § 6r pins the difference, and its
 * witness is a colour cast rather than a missing photon.
 *
 * ## Why the stack is a type, and not just a step inside the sum
 *
 * `spectralStack` stops one move short of summing: it hands back the
 * per-wavelength images, already on the common grid, with their weights beside
 * them rather than multiplied in. Two consumers need exactly that and disagree
 * about the last step.
 *
 * - `polychromaticPsf` collapses it with a **scalar** weight per wavelength,
 *   giving the monochrome PSF.
 * - Colour collapses it with **three** weights per wavelength — the observer's
 *   x̄, ȳ, z̄ — giving an image with chromatic structure in it.
 *
 * Colour cannot be recovered from the monochrome result: the wavelengths have
 * already been summed away, and tinting that by the mean λ produces a
 * uniformly coloured image with no fringing anywhere in it. Sharing the stack
 * rather than the sum is what keeps both honest about the common grid, instead
 * of the colour path growing a second resampler that could drift from this one.
 *
 * ## Seeing rides through untouched, and that is the point
 *
 * A `seeing` phase screen on the options threads to every wavelength's
 * `adaptivePsf` as the same object — so the stack applies ONE atmosphere to the
 * whole spectrum, and because the screen is stored as OPD the bluer colours pick
 * up proportionally more waves of it (r₀ ∝ λ^(6/5)) with no special case here.
 * The under-resolution guard follows for free: `maxGridPhaseStepWaves` below is
 * the max across wavelengths, so it keys on the bluest, worst-resolved plane.
 */

export interface PolychromaticOptions extends SystemPsfOptions, GeometricPsfOptions {
  /**
   * Image-plane sampling of the output grid (mm/pixel). Defaults to the
   * weighted-mean wavelength's own scale, which keeps the common grid inside
   * the range the individual grids span rather than extrapolating past either
   * end of it.
   */
  readonly pixelScaleMm?: number;
}

export interface PolychromaticComponent {
  readonly nm: number;
  /** Normalized weight actually used (the weights sum to 1). */
  readonly weight: number;
  /** Transmitted pupil energy at this wavelength. */
  readonly energy: number;
  /** Geometric share the fidelity switch chose for this wavelength. */
  readonly geometricWeight: number;
}

/**
 * One wavelength's image, already on the stack's common physical grid.
 *
 * `intensity` is NOT pre-multiplied by `weight`. That is the whole reason this
 * type exists — a caller applying a three-channel observer needs the image and
 * the weight separately.
 */
export interface SpectralPlane extends PolychromaticComponent {
  readonly intensity: Float64Array;
  /** The aberration-free counterpart, when it was requested and exists. */
  readonly diffractionLimited?: Float64Array;
}

export interface SpectralStack {
  readonly size: number;
  readonly pixelScaleMm: number;
  readonly pupilSamples: number;
  /** Weighted-mean wavelength (nm) — what `pixelScaleMm` refers to. */
  readonly meanWavelengthNm: number;
  readonly planes: readonly SpectralPlane[];
  readonly maxGridPhaseStepWaves: number;
  readonly fieldValue: number;
  /** Σ weight·energy — what the stack would integrate to with no truncation. */
  readonly energy: number;
  /**
   * Fraction of the summed energy that fell outside the common grid. Nonzero
   * when a long wavelength's PSF is physically wider than the grid chosen for
   * the mean — reported rather than hidden, because silently renormalizing it
   * away would turn truncation into a brightness error nobody could see.
   */
  readonly truncatedFraction: number;
  /** The normalized samples, for building an observer basis against. */
  readonly samples: readonly WavelengthSample[];
}

export interface PolychromaticPsf extends Psf {
  readonly components: readonly PolychromaticComponent[];
  readonly meanWavelengthNm: number;
  readonly truncatedFraction: number;
}

/**
 * Resample a PSF onto a grid of a different pixel scale, conservatively.
 *
 * `intensity` holds energy per pixel, so this integrates the source's irradiance
 * over each destination pixel rather than sampling it at the centre: the energy
 * is carried across exactly. `resample` below says why the difference is
 * percent-sized on a function with rings in it.
 */
export function resamplePsf(p: Psf, targetPixelScaleMm: number, size = p.size): Float64Array {
  return resampleEnergyGrid(p.intensity, p.size, p.pixelScaleMm, targetPixelScaleMm, size);
}

/**
 * Resample an **energy-per-pixel** grid onto a different pixel scale — the
 * destination pixel's INTEGRAL of the source.
 *
 * Exported because `imaging/emission` stacks a band of incoherent PSFs and hits
 * exactly the failure this module exists to prevent — pixelScaleMm is ∝ λ, so a
 * bin-for-bin sum silently rescales each component instead of stacking it. One
 * resampler, so the two paths cannot drift.
 *
 * The Jacobian is no longer a factor applied on top; it is what integrating
 * rather than averaging MEANS. That is the whole difference from
 * `resampleIrradianceGrid` below, which averages, and the two therefore still
 * differ by exactly `k²` cell for cell. Which one a caller wants is set by what
 * its array holds, not by taste. See that function for the witness that tells
 * them apart — and note that it is **not energy**.
 */
export function resampleEnergyGrid(
  src: Float64Array,
  srcSize: number,
  srcPixelScaleMm: number,
  targetPixelScaleMm: number,
  size: number,
): Float64Array {
  return resample(src, srcSize, srcPixelScaleMm, targetPixelScaleMm, size, true);
}

/**
 * Resample an **irradiance** grid — a value *per unit area* — onto a different
 * pixel scale: the destination pixel's AVERAGE of the source, not its integral.
 *
 * `illumination/abbe`'s image is this one, and it is a different physical
 * quantity from a PSF's `intensity` even though both are `Float64Array` of
 * squared moduli. A PSF holds the energy landing in each pixel: change the pixel
 * size and each one holds more, so the integral is mandatory. An Abbe image
 * holds the irradiance *at* a point — a uniform specimen images to exactly 1
 * whatever the grid is, which § 6r measured rather than derived — so it is a
 * point property, and warping it is pure coordinate substitution. Applying `k²`
 * to it multiplies every wavelength by (λ_target/λ_src)².
 *
 * **The witness for getting this wrong is not energy — it is a colour cast.** An
 * energy check on a stack of extended images is satisfied by construction on
 * either branch, because nothing has been lost, only rescaled; what the wrong
 * Jacobian does is tilt the spectrum by 1/λ², which reads as physics and turns a
 * neutral specimen blue. That is § 6r's finding, and it belongs here rather than
 * only in the ladder.
 */
export function resampleIrradianceGrid(
  src: Float64Array,
  srcSize: number,
  srcPixelScaleMm: number,
  targetPixelScaleMm: number,
  size: number,
): Float64Array {
  return resample(src, srcSize, srcPixelScaleMm, targetPixelScaleMm, size, false);
}

/**
 * The one implementation both siblings share: conservative regridding of a
 * slope-limited reconstruction.
 *
 * ## Why not the bilinear one this replaced
 *
 * The obvious resampler interpolates the source bilinearly at each destination
 * CENTRE and multiplies by `k²`. That is a one-point quadrature of the integral
 * the operation actually is, and on a function with rings in it the destination
 * lattice beats against the ring structure instead of averaging over it:
 * § 8a.11 measured the hero's planes coming back **+0.3% to +3.0% heavy**,
 * non-monotone in `k`, while `truncatedFraction` read exactly 0 because no light
 * had left the grid. Σ intensity ≡ energy is `psf.ts`'s "by construction" and
 * the raw transform meets it to the bit; a resampler that breaks it biases every
 * polychromatic render's brightness and, being per-plane, its colour.
 *
 * ## What replaces it
 *
 * Source cell `i` covers `[i − ½, i + ½]` and holds `src[i]` as its MEAN.
 * Across it the source is reconstructed as a straight line through that mean,
 * `src[i] + si(ξ − i)`. Destination cell `x` covers `[c − k/2, c + k/2]` about
 * its own centre and takes that reconstruction's integral over the overlap.
 * Destination cells tile the line exactly — width `k`, pitch `k`, no gaps and no
 * overlaps — so each source cell's content is PARTITIONED among them and none is
 * created: the total can only fall, and only by what the destination grid does
 * not cover, which is what `truncatedFraction` is for.
 *
 * ## The slope is limited, and that is what makes it safe
 *
 * `si` is the **minmod** of the two one-sided differences: the smaller of them
 * when they agree in sign, and zero at a turning point. An unlimited slope (the
 * centred difference) is more accurate on a smooth field and puts NEGATIVE cells
 * in the trough between Airy rings — twenty of them on a ringed spot at k = 0.8
 * — which `imaging/noise` refuses outright. Minmod cannot: `|si|` never exceeds
 * the smaller one-sided difference, and one of those two is always at most
 * `src[i]` itself on non-negative data, so the reconstruction stays at or above
 * half the cell mean everywhere. Measured across the same sweep: zero negative
 * cells at every `k`.
 *
 * ## What it is worth, against the bilinear it replaced
 *
 * Not a trade — better on every axis measured. On a band-limited tone the rms
 * departure from the true field is 6.9e-4 against bilinear's 1.9e-3 at 32 px per
 * period, 1.7e-2 against 3.1e-2 at 8, and 3.6e-2 against 1.17e-1 at 4. On a
 * ringed spot the total lands within 1.8e-3 of exact at every `k` and bilinear
 * within 4.0e-2 to 1.0e-1. And where a plain area average (the piecewise-CONSTANT
 * version of this same scheme) would have been three to four times WORSE than
 * bilinear pointwise, the limited slope is what buys conservation without paying
 * for it in resolution.
 *
 * ## Three properties the callers depend on
 *
 * The weights are **separable** — the scale change is isotropic and both grids
 * are centred the same way — so this is two one-dimensional passes over one
 * geometry table, one carrying each cell's mean and one its slope.
 *
 * When `k` is exactly 1 and the grid centres differ by a whole number of pixels,
 * every destination interval IS a source cell; a straight line integrated over
 * its own cell returns that cell's mean whatever its slope, so the mean's weight
 * is exactly 1, the slope's is exactly 0, and the array is copied **bit for
 * bit**. `imaging/spectral-stack`'s ruler plane (§ 6r.3) and `imaging/emission`'s
 * already-on-the-grid component both need that, and the bilinear version could
 * give it to neither because its stencil dropped the last row and column.
 *
 * The overlap lengths are computed **relative to the first source cell** rather
 * than in grid coordinates. `Math.floor` puts `i0` within half a cell of the
 * interval's start, so `a − i0` is exact, and every length below is then a
 * difference of numbers of order 1 instead of order `srcSize` — worth about a
 * factor of thirty on a 128 px grid, which is the difference between a flat
 * field reproducing to 3e-16 and to 3e-14.
 *
 * Destinations not COMPLETELY covered by the source are left at zero rather than
 * partly filled. A partly-filled cell would read low and invent an edge the
 * optics do not have, and `resampleIrradianceGrid`'s "a uniform specimen images
 * to exactly 1" has to hold on every cell this writes, not on most of them.
 */
function resample(
  src: Float64Array,
  srcSize: number,
  srcPixelScaleMm: number,
  targetPixelScaleMm: number,
  size: number,
  jacobian: boolean,
): Float64Array {
  const out = new Float64Array(size * size);
  const k = targetPixelScaleMm / srcPixelScaleMm;
  const cs = srcSize / 2;
  const co = size / 2;
  const n = srcSize;

  // The geometry, once, for both axes: same `k`, same centring, so the overlap a
  // destination row has with a source row is the one the matching column has
  // with the matching column. `mean[t]` is the length of that overlap — what
  // multiplies the source cell's mean — and `tilt[t]` is the same interval's
  // first moment about the cell centre, what multiplies its slope. A destination
  // interval of length `k` reaches at most ⌈k⌉ + 1 cells and never more.
  const half = k / 2;
  const stride = Math.floor(k) + 2;
  const first = new Int32Array(size);
  const span = new Int32Array(size);
  const mean = new Float64Array(size * stride);
  const tilt = new Float64Array(size * stride);
  // Destination centres are monotonic in `x`, so the ones completely inside the
  // source are a contiguous run — found once here rather than tested per element
  // in the passes below. Everything outside it stays zero.
  let xLo = size;
  let xHi = -1;
  for (let x = 0; x < size; x++) {
    const c = cs + (x - co) * k;
    const a = c - half;
    const b = c + half;
    // Not completely inside the source: left at zero, and its whole row and
    // column with it.
    if (!(a >= -0.5 && b <= n - 0.5)) continue;
    if (x < xLo) xLo = x;
    xHi = x;
    const i0 = Math.floor(a + 0.5);
    const i1 = Math.min(n - 1, Math.floor(b + 0.5));
    // `i0` is within half a cell of `a`, so this subtraction is exact and the
    // lengths below are differences of numbers of order 1. See the header.
    const da = a - i0;
    const db = da + k;
    first[x] = i0;
    span[x] = i1 - i0 + 1;
    for (let j = 0; j <= i1 - i0; j++) {
      const lo = da > j - 0.5 ? da : j - 0.5;
      const hi = db < j + 0.5 ? db : j + 0.5;
      if (hi <= lo) continue;
      const u = hi - j;
      const v = lo - j;
      mean[x * stride + j] = hi - lo;
      // Exactly 0 on a cell the destination covers whole, where u = ½ and
      // v = −½ — which is what makes k = 1 a bit-for-bit copy.
      tilt[x * stride + j] = (u * u - v * v) / 2;
    }
  }

  if (xHi < xLo) return out;

  // Both passes run x-innermost so every read walks memory forwards: pass one
  // resamples each source ROW along x into a full-height scratch, pass two
  // resamples that scratch along y a source row at a time, accumulating into the
  // destinations. Gathering pass two's columns instead — the obvious way to
  // write it, one destination at a time — strides the scratch by a whole row per
  // element and costs a cache miss on each; it measured about five times slower
  // over the suite, on identical arithmetic.
  //
  // Both also keep ONE source line's slopes rather than recomputing them per
  // destination. Neighbouring destinations overlap, so the source index walks
  // 0,1, 1,2, 2,3 — every repeat is consecutive, and a one-entry memo catches
  // all of them and halves the limiter's work.
  //
  // A cell whose overlap carries neither weight is skipped, which is what keeps
  // k = 1 a bit-for-bit copy: the single covering cell contributes `v * 1`, and
  // the neighbour that touches it with zero length contributes nothing at all
  // rather than `v * 0`. The slope is zero at either end of a line, where a cell
  // has only one neighbour.
  // Pass two reads scratch rows `first[xLo] .. first[xHi] + span - 1`, and one
  // either side of those for the slopes. Building the whole source height
  // instead is wasted work whenever the destination grid is smaller than the
  // source, which is every cropped frame `imaging/spectral-stack` asks for.
  const jLo = Math.max(0, first[xLo]! - 1);
  const jHi = Math.min(n - 1, first[xHi]! + span[xHi]! - 1 + 1);
  const tmp = scratch((jHi - jLo + 1) * size);
  for (let y = jLo; y <= jHi; y++) {
    const rs = y * n;
    const rt = (y - jLo) * size;
    let memoI = -1;
    let memoS = 0;
    for (let x = xLo; x <= xHi; x++) {
      const sp = span[x]!;
      const i0 = first[x]!;
      const w = x * stride;
      let acc = 0;
      for (let t = 0; t < sp; t++) {
        const m = mean[w + t]!;
        const q = tilt[w + t]!;
        if (m === 0 && q === 0) continue;
        const i = i0 + t;
        const v = src[rs + i]!;
        if (i !== memoI) {
          memoI = i;
          memoS = i > 0 && i < n - 1 ? minmod(v - src[rs + i - 1]!, src[rs + i + 1]! - v) : 0;
        }
        acc += v * m + memoS * q;
      }
      tmp[rt + x] = acc;
    }
  }
  const slope = new Float64Array(size);
  let slopeJ = -1;
  for (let y = xLo; y <= xHi; y++) {
    const sp = span[y]!;
    const j0 = first[y]!;
    const w = y * stride;
    const ro = y * size;
    for (let t = 0; t < sp; t++) {
      const m = mean[w + t]!;
      const q = tilt[w + t]!;
      if (m === 0 && q === 0) continue;
      const j = j0 + t;
      const rj = (j - jLo) * size;
      if (q === 0) {
        // A whole-cell overlap: the slope cannot reach the answer, so it is not
        // worth a line of it. This is every cell at k = 1.
        for (let x = xLo; x <= xHi; x++) out[ro + x] = out[ro + x]! + tmp[rj + x]! * m;
        continue;
      }
      if (j !== slopeJ) {
        slopeJ = j;
        if (j > jLo && j < jHi) {
          const rp = rj - size;
          const rn = rj + size;
          for (let x = xLo; x <= xHi; x++) {
            const v = tmp[rj + x]!;
            slope[x] = minmod(v - tmp[rp + x]!, tmp[rn + x]! - v);
          }
        } else {
          slope.fill(0, xLo, xHi + 1);
        }
      }
      for (let x = xLo; x <= xHi; x++) {
        out[ro + x] = out[ro + x]! + tmp[rj + x]! * m + slope[x]! * q;
      }
    }
  }

  // The integral is what the two passes already computed; the average is that
  // over the destination cell's own area. `k === 1` leaves the copy bit for bit
  // on both branches, because the divisor is then exactly 1.
  if (!jacobian) {
    const inv = 1 / (k * k);
    for (let i = 0; i < out.length; i++) out[i] = out[i]! * inv;
  }
  return out;
}

/**
 * The scratch `resample` puts its first pass in, grown as needed and kept
 * between calls.
 *
 * A render resamples one plane per wavelength per frame and a mosaic does that
 * per tile, so a fresh `Float64Array` per call is megabytes of garbage a second
 * — it measured as most of the cost, well above the arithmetic. `resample` is
 * never re-entered (no recursion, no await, one thread per vitest worker), and
 * it writes every element it later reads, so nothing carries between calls but
 * the allocation.
 */
let scratchBuffer = new Float64Array(0);

function scratch(length: number): Float64Array {
  if (scratchBuffer.length < length) scratchBuffer = new Float64Array(length);
  return scratchBuffer;
}

/**
 * The smaller of two differences when they agree in sign, and zero otherwise.
 *
 * Van Leer's limiter, and here it is a non-negativity guarantee rather than a
 * taste in reconstructions: see `resample` above.
 */
function minmod(a: number, b: number): number {
  if (a > 0) return b > 0 ? (a < b ? a : b) : 0;
  if (a < 0) return b < 0 ? (a > b ? a : b) : 0;
  return 0;
}

/**
 * Trace every wavelength and put them all on one physical grid.
 *
 * Each runs through the full pipeline independently — including the fidelity
 * switch, because a system can be diffraction-limited in red and aliasing in
 * blue.
 */
export function spectralStack(
  system: OpticalSystem,
  fieldValue: number,
  options: PolychromaticOptions = {},
): SpectralStack {
  const samples = system.wavelengths;
  if (samples.length === 0) throw new Error("system has no wavelengths");
  let totalWeight = 0;
  for (const w of samples) {
    if (w.weight < 0) throw new Error(`wavelength weight must be ≥ 0, got ${w.weight}`);
    totalWeight += w.weight;
  }
  if (totalWeight <= 0) throw new Error("wavelength weights sum to zero");

  const meanWavelengthNm = samples.reduce((acc, w) => acc + w.nm * w.weight, 0) / totalWeight;

  // Sequential on purpose, and not only because `adaptivePsf` is synchronous:
  // the resampler below keeps ONE scratch buffer between calls (§ 8c, and
  // ARCHITECTURE's precision section), so two of these running interleaved would
  // overwrite each other's first pass and return wrong pixels rather than
  // throwing. Parallelising this loop means giving `resample` a per-call or
  // per-worker buffer first.
  const each = samples.map((w) => ({
    sample: w,
    weight: w.weight / totalWeight,
    psf: adaptivePsf(system, fieldValue, w.nm, options),
  }));

  const first = each[0]!;
  const size = first.psf.size;
  // Pixel scale is ∝ λ, so the mean wavelength's scale follows from any one of
  // them without recomputing the pupil geometry.
  const pixelScaleMm =
    options.pixelScaleMm ?? first.psf.pixelScaleMm * (meanWavelengthNm / first.sample.nm);

  let energy = 0;
  let placed = 0;
  const planes: SpectralPlane[] = each.map((e) => {
    const intensity = resamplePsf(e.psf, pixelScaleMm, size);
    let kept = 0;
    for (let i = 0; i < intensity.length; i++) kept += intensity[i]!;
    placed += e.weight * kept;
    energy += e.weight * e.psf.energy;
    const flat = e.psf.diffractionLimitedIntensity;
    return {
      nm: e.sample.nm,
      weight: e.weight,
      energy: e.psf.energy,
      geometricWeight: e.psf.geometricWeight,
      intensity,
      ...(flat === undefined
        ? {}
        : {
            diffractionLimited: resampleEnergyGrid(
              flat,
              e.psf.size,
              e.psf.pixelScaleMm,
              pixelScaleMm,
              size,
            ),
          }),
    };
  });

  return {
    size,
    pixelScaleMm,
    pupilSamples: first.psf.pupilSamples,
    meanWavelengthNm,
    planes,
    maxGridPhaseStepWaves: Math.max(...each.map((e) => e.psf.maxGridPhaseStepWaves)),
    fieldValue,
    energy,
    truncatedFraction: energy > 0 ? Math.max(0, 1 - placed / energy) : 0,
    samples: planes.map((p) => ({ nm: p.nm, weight: p.weight })),
  };
}

/**
 * The PSF of a system over its whole spectrum, at one field point.
 *
 * The scalar collapse of `spectralStack`: one weight per wavelength, summed
 * into a single monochrome image.
 */
export function polychromaticPsf(
  system: OpticalSystem,
  fieldValue: number,
  options: PolychromaticOptions = {},
): PolychromaticPsf {
  const stack = spectralStack(system, fieldValue, { ...options, keepDiffractionLimited: true });
  const size = stack.size;

  const intensity = new Float64Array(size * size);
  // A Strehl ratio for a spectrum compares the stacked peak against the peak
  // of an aberration-free stack BUILT THE SAME WAY. Averaging the components'
  // Strehls instead would assume every wavelength puts its peak on the same
  // pixel — false exactly when there is chromatic defocus or lateral colour,
  // which is the case the achromat story exists to show. And the components'
  // aberration-free peaks cannot simply be summed either: each lives on its
  // own λ-dependent grid, so they are energies-per-pixel in different units.
  const reference = stack.planes.every((p) => p.diffractionLimited !== undefined)
    ? new Float64Array(size * size)
    : null;

  for (const p of stack.planes) {
    for (let i = 0; i < intensity.length; i++) {
      intensity[i] = intensity[i]! + p.intensity[i]! * p.weight;
    }
    if (reference !== null) {
      const flat = p.diffractionLimited!;
      for (let i = 0; i < reference.length; i++) {
        reference[i] = reference[i]! + flat[i]! * p.weight;
      }
    }
  }

  let peak = 0;
  for (let i = 0; i < intensity.length; i++) if (intensity[i]! > peak) peak = intensity[i]!;

  // Zero when any component fell to the geometric branch: a ray histogram has
  // no aberration-free counterpart, so there is no honest denominator.
  let referencePeak = 0;
  if (reference !== null) {
    for (let i = 0; i < reference.length; i++) {
      if (reference[i]! > referencePeak) referencePeak = reference[i]!;
    }
  }

  return {
    size,
    pupilSamples: stack.pupilSamples,
    intensity,
    pixelScaleMm: stack.pixelScaleMm,
    energy: stack.energy,
    peak,
    diffractionLimitedPeak: referencePeak,
    strehl: referencePeak > 0 ? peak / referencePeak : 0,
    ...(reference === null ? {} : { diffractionLimitedIntensity: reference }),
    maxGridPhaseStepWaves: stack.maxGridPhaseStepWaves,
    wavelengthNm: stack.meanWavelengthNm,
    fieldValue,
    components: stack.planes.map((p) => ({
      nm: p.nm,
      weight: p.weight,
      energy: p.energy,
      geometricWeight: p.geometricWeight,
    })),
    meanWavelengthNm: stack.meanWavelengthNm,
    truncatedFraction: stack.truncatedFraction,
  };
}
