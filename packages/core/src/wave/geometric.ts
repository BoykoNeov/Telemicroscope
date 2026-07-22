import { asCompiled } from "../trace/compile";
import { OpticalSystem } from "../trace/system";
import { AimOptions, pupilGrid } from "../pupil/aiming";
import { opdMap } from "../pupil/opd";
import { imagePlaneZ } from "../pupil/pupils";
import { exitBundle } from "../analysis/spot";
import { fitZernike } from "./zernike";
import {
  Psf,
  PsfOptions,
  SystemPsfOptions,
  psf,
  pupilFunctionFromOpd,
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
  /** Rays across the pupil diameter. Default 151 — the histogram wants many. */
  readonly rayGrid?: number;
  /** Pupil grid resolution for the OPD map that fixes the scale. Default 21. */
  readonly traceSamples?: number;
  readonly zernikeTerms?: number;
  readonly aim?: AimOptions;
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
  const pupil = pupilFunctionFromOpd(map, fit, {
    ...(options.obstruction === undefined ? {} : { obstruction: options.obstruction }),
  });
  const energy = transmittedEnergy(pupil, pupilSamples, size);

  const lambdaMm = wavelengthNm * 1e-6;
  const deltaPupil = (2 * map.pupil.exit.radius) / pupilSamples;
  const pixelScaleMm = Math.abs(
    (lambdaMm * map.referenceRadius) / (Math.abs(map.pupil.exit.n) * size * deltaPupil),
  );

  const bundle = exitBundle(
    system,
    fieldValue,
    wavelengthNm,
    pupilGrid(options.rayGrid ?? 151),
    options.aim ?? {},
  );
  const planeZ = imagePlaneZ(asCompiled(system.prescription), system);

  const obstruction = options.obstruction ?? 0;
  const ob2 = obstruction * obstruction;
  const intensity = new Float64Array(size * size);
  const half = size / 2;
  let binned = 0;

  for (const r of bundle.rays) {
    // The obstruction is a property of the aperture, so it blocks rays here
    // exactly as it zeroes amplitude in the pupil function.
    if (r.px * r.px + r.py * r.py < ob2) continue;
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
    sampling: opdSampling(map, fit),
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
  return {
    ...diffraction,
    intensity,
    peak,
    energy: (1 - w) * diffraction.energy + w * geometric.energy,
    strehl: (1 - w) * diffraction.strehl,
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
