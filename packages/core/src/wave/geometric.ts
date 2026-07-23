import { asCompiled } from "../trace/compile";
import { OpticalSystem } from "../trace/system";
import { AimOptions, pupilGrid } from "../pupil/aiming";
import { opdMap, vignetteMask } from "../pupil/opd";
import { imagePlaneZ } from "../pupil/pupils";
import { exitBundle } from "../analysis/spot";
import { fitZernike } from "./zernike";
import {
  Psf,
  PsfOptions,
  SystemPsfOptions,
  psf,
  pupilFunctionFromOpd,
  spiderObscures,
  transmittedEnergy,
} from "./psf";
import { opdSampling, phaseStepPerSample, PHASE_STEP_LIMIT } from "./fidelity";

/**
 * The geometric PSF, and the switch between it and the diffraction PSF.
 *
 * When the wavefront is steep enough to alias on the pupil grid, the FFT stops
 * being a diffraction calculation and starts being noise (ARCHITECTURE §
 * fidelity switch). What is *actually* true in that regime is the ray answer:
 * far from the diffraction limit, the image of a point IS the spot diagram.
 * So the fallback is not an approximation of the FFT — it is the correct
 * physics in the regime where the FFT has failed, and the FFT is the correct
 * physics where the rays under-describe. Each covers the other's blind spot.
 *
 * Two obligations come with having two branches, and both are enforced here
 * rather than left as conventions:
 *
 * **Matched energy.** Both integrate to the same `transmittedEnergy`, so
 * crossing the switch cannot change how bright the image is. The geometric
 * branch scales its ray histogram to the number the pupil grid produced,
 * instead of defining brightness a second way.
 *
 * **A blend band, not a threshold.** A hard switch pops visibly when a user
 * drags a defocus or seeing slider across it. The branches are cross-faded
 * over a band around the criterion with a smoothstep, which is C¹ at both
 * edges — so the image is not merely continuous across the transition, its
 * rate of change is too. Because both branches carry the same energy, every
 * convex combination of them does as well: the blend cannot alter brightness
 * no matter where in the band it sits.
 */

export interface GeometricPsfOptions extends PsfOptions {
  /**
   * Rays across the pupil diameter. Defaults to a count scaled to the blur
   * area — see `defaultRayGrid` — because a fixed count is wrong at every
   * aperture but one: the histogram needs more rays than the blur covers
   * pixels, or the image is shot-noise speckle wearing the shape of a spot.
   */
  readonly rayGrid?: number;
  /** Pupil grid resolution for the OPD map that fixes the scale. Default 21. */
  readonly traceSamples?: number;
  readonly zernikeTerms?: number;
  readonly aim?: AimOptions;
}

/** Mean rays per blur-disc pixel the default ray grid aims for (≈1/CV²). */
export const TARGET_RAYS_PER_BLUR_PIXEL = 9;
/** The old fixed default, kept as the floor so small blurs stay cheap. */
const RAY_GRID_MIN = 151;
/** Runtime ceiling; beyond it density degrades rather than cost exploding. */
const RAY_GRID_MAX = 1023;

/**
 * Rays across the pupil diameter needed to fill this wavefront's blur.
 *
 * The blur radius in PIXELS has a closed form in quantities the fidelity
 * criterion already measures: a wavefront slope of s waves per pupil sample
 * displaces a ray by s·size pixels (at the Nyquist step s = ½ the ray lands at
 * the grid edge — the same identity that makes the FFT alias there), so the
 * largest traced gradient g waves-per-pupil-radius puts the outermost ray at
 *
 *     r_blur = 2 · padFactor · g   pixels.
 *
 * The grid is then sized so the ~(π/4)·rayGrid² rays inside the pupil land
 * `TARGET_RAYS_PER_BLUR_PIXEL` deep over the blur disc's π·r_blur² pixels,
 * which gives per-pixel fluctuations of ~1/√target. Two honest limits, both
 * deliberate: the blur radius is capped at the half-grid (light past the edge
 * is off the histogram no matter how many rays chase it — `truncatedFraction`
 * is what reports that), and the grid is capped at `RAY_GRID_MAX`, past which
 * the density target quietly degrades as (size/2r)² instead of the trace cost
 * growing without bound. The chosen grid is reported on the returned Psf as
 * `rayGrid`, so a caller can see when a cap has bound.
 */
export function defaultRayGrid(
  maxGradientWavesPerRadius: number,
  padFactor: number,
  size: number,
): number {
  const blurRadiusPx = Math.min(2 * padFactor * maxGradientWavesPerRadius, size / 2);
  const grid = Math.ceil(2 * blurRadiusPx * Math.sqrt(TARGET_RAYS_PER_BLUR_PIXEL));
  // Odd, so the pupil grid keeps its centre ray.
  return Math.min(RAY_GRID_MAX, Math.max(RAY_GRID_MIN, grid)) | 1;
}

/**
 * PSF by ray histogram: trace a dense pupil, bin where the rays land.
 *
 * Binning is on the SAME grid the FFT branch uses — same size, same
 * `pixelScaleMm`, same centre (the chief ray's image point, which is also the
 * reference sphere's centre). That is what makes the two branches
 * pixel-comparable, and it is why the scale still comes from an OPD map even
 * though no wavefront is used: the map is what defines where "the image point"
 * is.
 */
export function geometricPsf(
  system: OpticalSystem,
  fieldValue: number,
  wavelengthNm: number,
  options: GeometricPsfOptions = {},
): Psf {
  const pupilSamples = options.pupilSamples ?? 64;
  const padFactor = options.padFactor ?? 4;
  const size = pupilSamples * padFactor;

  const map = opdMap(
    system,
    fieldValue,
    wavelengthNm,
    pupilGrid(options.traceSamples ?? 21),
    options.aim ?? {},
  );
  const fit = fitZernike(map.samples, options.zernikeTerms ?? 28);
  // The same mask the FFT branch uses, so `energy` below counts only the light
  // that clears the downstream apertures. The ray loop already drops those rays
  // (`exitBundle`), so this is what keeps the histogram's normalization target
  // honest instead of rescaling the survivors up to the full-disc energy (§ 2f).
  const vignette =
    map.lost > 0
      ? vignetteMask(system, map.pupil, fieldValue, wavelengthNm, options.aim ?? {})
      : undefined;
  const pupil = pupilFunctionFromOpd(map, fit, {
    ...(options.obstruction === undefined ? {} : { obstruction: options.obstruction }),
    ...(options.spider === undefined ? {} : { spider: options.spider }),
    ...(vignette === undefined ? {} : { vignette }),
  });
  const energy = transmittedEnergy(pupil, pupilSamples, size);

  const lambdaMm = wavelengthNm * 1e-6;
  const deltaPupil = (2 * map.pupil.exit.radius) / pupilSamples;
  const pixelScaleMm = Math.abs(
    (lambdaMm * map.referenceRadius) / (Math.abs(map.pupil.exit.n) * size * deltaPupil),
  );

  // Measured before the bundle is traced, because the blur it reports is what
  // sizes the bundle. This is the same number the fidelity switch runs on.
  const sampling = opdSampling(map, fit);
  const rayGrid =
    options.rayGrid ?? defaultRayGrid(sampling.maxGradientWavesPerRadius, padFactor, size);

  const bundle = exitBundle(system, fieldValue, wavelengthNm, pupilGrid(rayGrid), options.aim ?? {});
  const planeZ = imagePlaneZ(asCompiled(system.prescription), system);

  const obstruction = options.obstruction ?? 0;
  const ob2 = obstruction * obstruction;
  // The SAME predicate the FFT branch masks with, so the two branches cannot
  // disagree about how much of the aperture the vanes block.
  const spiderTest = options.spider ? spiderObscures(options.spider) : null;
  const intensity = new Float64Array(size * size);
  const half = size / 2;
  let binned = 0;

  for (const r of bundle.rays) {
    // The obstruction is a property of the aperture, so it blocks rays here
    // exactly as it zeroes amplitude in the pupil function.
    if (r.px * r.px + r.py * r.py < ob2) continue;
    // Vanes block rays for the same reason — but produce no spikes here: a ray
    // histogram has no phase, so a spider only removes energy from the
    // geometric branch. The streaks are an FFT phenomenon, and correctly so —
    // they wash out far from focus, which is exactly where this branch rules.
    if (spiderTest !== null && spiderTest(r.px, r.py)) continue;
    const { origin: o, dir: d } = r.ray;
    const t = (planeZ - o.z) / d.z;
    const x = o.x + d.x * t - map.imagePoint.x;
    const y = o.y + d.y * t - map.imagePoint.y;
    const ix = Math.round(half + x / pixelScaleMm);
    const iy = Math.round(half + y / pixelScaleMm);
    if (ix < 0 || ix >= size || iy < 0 || iy >= size) continue;
    intensity[iy * size + ix] = intensity[iy * size + ix]! + r.throughput;
    binned += r.throughput;
  }

  // Scale the histogram to the pupil-grid energy — the shared definition.
  if (binned > 0) {
    const k = energy / binned;
    for (let i = 0; i < intensity.length; i++) intensity[i] = intensity[i]! * k;
  }

  let peak = 0;
  for (let i = 0; i < intensity.length; i++) if (intensity[i]! > peak) peak = intensity[i]!;

  return {
    size,
    pupilSamples,
    intensity,
    pixelScaleMm,
    energy,
    peak,
    // A ray histogram has no diffraction-limited counterpart: rays through a
    // perfect system pile into a single bin, so the "peak" it would report is
    // a sampling artifact, not a Strehl denominator. Reporting 0 rather than a
    // plausible-looking number keeps callers from dividing by it.
    diffractionLimitedPeak: 0,
    strehl: 0,
    maxGridPhaseStepWaves: 0,
    sampling,
    rayGrid,
    wavelengthNm,
    fieldValue,
  };
}

/**
 * Convex blend of two PSFs on the same grid. `weight` is the geometric share.
 *
 * Energy is preserved exactly for any weight, because both inputs carry the
 * same energy and (1−w)·E + w·E = E. That identity is the reason the fidelity
 * switch can never change image brightness, and it holds mid-band, not just at
 * the ends.
 */
export function blendPsf(diffraction: Psf, geometric: Psf, weight: number): Psf {
  if (diffraction.size !== geometric.size) {
    throw new Error("cannot blend PSFs computed on different grids");
  }
  const w = Math.min(1, Math.max(0, weight));
  const n = diffraction.size;
  const intensity = new Float64Array(n * n);
  let peak = 0;
  for (let i = 0; i < n * n; i++) {
    const v = (1 - w) * diffraction.intensity[i]! + w * geometric.intensity[i]!;
    intensity[i] = v;
    if (v > peak) peak = v;
  }
  // Strehl is dropped once any geometric share is mixed in, rather than scaled
  // by (1−w). A blended peak has no single aberration-free reference: the
  // geometric branch has none at all (rays through a perfect system pile into
  // one bin), so any ratio built from it would be a sampling artifact wearing
  // a physical name. Same discipline as `geometricPsf` itself.
  const { diffractionLimitedIntensity: _unused, ...rest } = diffraction;
  return {
    ...rest,
    intensity,
    peak,
    energy: (1 - w) * diffraction.energy + w * geometric.energy,
    diffractionLimitedPeak: 0,
    strehl: 0,
  };
}

/** Half-width of the cross-fade band around the criterion, in phase step. */
export const BLEND_HALF_WIDTH = 0.15;

/**
 * Geometric share for a given phase step per pupil sample.
 *
 * Smoothstep rather than a linear ramp: it is C¹ at both edges of the band, so
 * dragging a slider through the transition changes neither the image nor the
 * rate at which the image is changing. A linear ramp is continuous but kinked,
 * and the kink is visible in an animated preview.
 */
export function geometricWeight(phaseStep: number): number {
  const lo = PHASE_STEP_LIMIT - BLEND_HALF_WIDTH;
  const hi = PHASE_STEP_LIMIT + BLEND_HALF_WIDTH;
  if (phaseStep <= lo) return 0;
  if (phaseStep >= hi) return 1;
  const t = (phaseStep - lo) / (hi - lo);
  return t * t * (3 - 2 * t);
}

export interface AdaptivePsf extends Psf {
  /** Geometric share actually used, 0…1. */
  readonly geometricWeight: number;
  /** Phase change per pupil sample that decided it (waves). */
  readonly phaseStepWaves: number;
}

/**
 * The PSF a caller should normally ask for: whichever branch is honest here,
 * cross-faded where neither is clearly better.
 *
 * The switch is invisible by design — a user dragging a defocus or seeing
 * slider should see the image degrade smoothly, not jump when an internal
 * threshold trips.
 */
export function adaptivePsf(
  system: OpticalSystem,
  fieldValue: number,
  wavelengthNm: number,
  options: SystemPsfOptions & GeometricPsfOptions = {},
): AdaptivePsf {
  const pupilSamples = options.pupilSamples ?? 64;
  // `psf` reads `options.seeing` and adds the screen; `geometricPsf` below is
  // handed the same options and ignores it — a ray histogram has no phase to add
  // it to. So seeing rides the diffraction branch alone and fades out with it as
  // the system's own aberration takes over (docs/VALIDATION § 5d).
  const diffraction = psf(system, fieldValue, wavelengthNm, options);
  const sampling = diffraction.sampling;
  const step = sampling ? phaseStepPerSample(sampling, pupilSamples) : 0;
  const weight = geometricWeight(step);

  if (weight === 0) {
    return { ...diffraction, geometricWeight: 0, phaseStepWaves: step };
  }
  const geometric = geometricPsf(system, fieldValue, wavelengthNm, options);
  const blended = weight === 1 ? geometric : blendPsf(diffraction, geometric, weight);
  return { ...blended, geometricWeight: weight, phaseStepWaves: step };
}
