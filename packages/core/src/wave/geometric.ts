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
  imagePixelScaleMm,
  psfFromSystemPupil,
  pupilFunctionFromOpd,
  spiderObscures,
  systemPupil,
  transmittedEnergy,
} from "./psf";
import { opdSampling, phaseStepPerSample, PHASE_STEP_LIMIT } from "./fidelity";
import { screenTiltWaves, type PhaseScreen } from "./seeing";

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
  /**
   * An atmospheric phase screen (see `wave/seeing`), applied here as the ray
   * deflection it is rather than as the phase this branch cannot hold.
   *
   * The same field the FFT branch adds to the pupil, read through its gradient
   * instead of its value: a ray crossing the pupil where the optical path is
   * tilted leaves tilted, and lands displaced. § 5d deferred this and § 5d.2
   * built it, so `adaptivePsf({seeing})` now carries the atmosphere across the
   * whole fidelity band instead of losing it exactly where the system's own
   * aberration takes over.
   *
   * REFUSED when the exit pupil is at infinity — see `rayDeflectionScaleMm`.
   */
  readonly seeing?: PhaseScreen;
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
 * Largest screen slope over a pupil-full of points, waves per unit radius.
 *
 * A coarse max on the TRACE grid, and it under-reads the bilinear surface's true
 * maximum by however much falls between its samples. That is the right amount of
 * effort: the number is only ever a ray BUDGET, so under-reading it costs some
 * histogram density and over-reading it costs trace time, and neither is a
 * physical claim. Nothing downstream of `rayGrid` sees it.
 */
function maxTiltWavesPerRadius(
  tilt: (px: number, py: number) => { readonly dx: number; readonly dy: number },
  points: readonly { readonly px: number; readonly py: number }[],
): number {
  let max = 0;
  for (const p of points) {
    const g = tilt(p.px, p.py);
    const m = Math.hypot(g.dx, g.dy);
    if (m > max) max = m;
  }
  return max;
}

/**
 * Image-plane millimetres a ray moves per wave of pupil slope, signed.
 *
 * The transverse ray aberration, and nothing more exotic: an extra optical path
 * W (mm) laid across the exit pupil coordinate x lands its ray at
 *
 *     Δx = +(R / n′) · ∂W/∂x
 *
 * with R the reference-sphere radius — exit pupil to image — and n′ the image
 * index. A slope quoted the way `screenTiltWaves` quotes it, in WAVES per unit
 * NORMALIZED pupil radius, converts by W = λ·φ and x = px·r_exit, which gives
 * the single factor returned here.
 *
 * **The plus sign is the one thing here worth an anchor**, because the textbook
 * form of this relation is written with a minus and the difference is which way
 * its W points. The anchor is a prism: a wedge thicker at +x delays the light
 * there, and a prism deviates its beam toward the BASE — toward +x. So a
 * positive gradient of extra optical path moves the image the same way, and this
 * engine's OPD is signed as extra optical path (`opdMap` records
 * `opl − opl_chief`), which makes the sign positive here. Measured both ways
 * round before it was written: on a paraboloid off axis (image-space index −1)
 * and on an achromat off axis (+1), the traced ray centroid lands on the same
 * side as `+R/|n′|` times the traced wavefront's own mean gradient — and the FFT
 * branch puts its coma on the same side as the rays do (§ 5d.2). |n′| rather
 * than the signed index, for the same reason `imagePixelScaleMm` takes it: the
 * mirror convention's sign lives in the fold, not in the ruler.
 *
 * **It is written in millimetres on purpose.** Cancelling it against
 * `imagePixelScaleMm` gives the much shorter Δx = +2·padFactor·φ′ PIXELS — the
 * same identity `defaultRayGrid` above is built on — and writing THAT here would
 * put `padFactor` and `pupilSamples` inside a physics term, which is the
 * duplicated-ruler mistake § 6aj.6 had to repair one floor up in this same
 * function. So the deflection is computed from the pupil's own geometry and the
 * pixel identity is asserted as a rung instead of assumed (§ 5d.2).
 *
 * An exit pupil at INFINITY is refused rather than answered. The mm form needs a
 * finite r_exit; the telecentric spelling would have to come through
 * `slopeRadius`, as `imagePixelScaleMm`'s own infinite branch does, and no
 * atmosphere has ever been asked for through an image-space telecentric
 * objective. Refusing keeps that from silently reading as a zero deflection —
 * a screen quietly doing nothing is the failure mode worth throwing over.
 */
export function rayDeflectionScaleMm(
  referenceRadius: number,
  exitRadius: number,
  nImage: number,
  wavelengthNm: number,
): number {
  if (!Number.isFinite(exitRadius)) {
    throw new Error(
      "geometricPsf cannot deflect rays by a phase screen through an exit pupil at infinity: " +
        "the transverse ray aberration needs a finite exit-pupil radius, and this system carries " +
        "a slope aperture instead (PupilPlane's radius-XOR-slope invariant)",
    );
  }
  const lambdaMm = wavelengthNm * 1e-6;
  return (lambdaMm * referenceRadius) / (Math.abs(nImage) * exitRadius);
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

  // The shared reader, not a fourth copy of its arithmetic. This inline
  // duplicate is what § 6aj.6 had to name as a SECOND repair site: the formula
  // lives in `imagePixelScaleMm` precisely so two transforms landing on one grid
  // cannot disagree about the ruler, and a copy here meant the telecentric
  // branch would have had to be written twice or `geometricPsf` would have gone
  // on reporting zero with the shared reader already fixed. Bitwise identical on
  // a finite pupil — the same expression in the same association, moved.
  const pixelScaleMm = imagePixelScaleMm(
    {
      referenceRadius: map.referenceRadius,
      exitRadius: map.pupil.exit.radius,
      wavelengthNm,
      nImage: map.pupil.exit.n,
      slopeRadius: map.pupil.exit.slopeRadius,
    },
    size,
    pupilSamples,
  );

  // The atmosphere, as the deflection a ray histogram can actually carry. The
  // screen is the same object the FFT branch composes onto the pupil, read
  // through its gradient instead of its value (§ 5d.2).
  const tilt = options.seeing ? screenTiltWaves(options.seeing, wavelengthNm) : null;
  const tiltToMm =
    tilt === null
      ? 0
      : rayDeflectionScaleMm(
          map.referenceRadius,
          map.pupil.exit.radius,
          map.pupil.exit.n,
          wavelengthNm,
        );

  // Measured before the bundle is traced, because the blur it reports is what
  // sizes the bundle. This is the same number the fidelity switch runs on.
  const sampling = opdSampling(map, fit);
  // Sizing only, and deliberately NOT folded into `sampling`: the fidelity
  // criterion is screen-blind by design (§ 5d), and the number this branch
  // reports has to stay the one the switch was decided on. But the ray COUNT is
  // a different question — it is "how many rays does this blur need", and a
  // screen that widens the blur and does not widen the grid quietly turns the
  // histogram into speckle. The two gradients are summed rather than added in
  // quadrature because they can line up, and this is a bound on the blur radius.
  const screenGradient =
    tilt === null ? 0 : maxTiltWavesPerRadius(tilt, pupilGrid(options.traceSamples ?? 21));
  const rayGrid =
    options.rayGrid ??
    defaultRayGrid(sampling.maxGradientWavesPerRadius + screenGradient, padFactor, size);

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
    let x = o.x + d.x * t - map.imagePoint.x;
    let y = o.y + d.y * t - map.imagePoint.y;
    if (tilt !== null) {
      // Applied at the image plane, not by re-aiming the ray into the system.
      // That is the SAME approximation the FFT branch already makes — the
      // screen belongs at the entrance pupil and its phase is added at the exit
      // one — and § 5d owns it. Giving one branch a better treatment than the
      // other would make them disagree for a reason that is not physics.
      const g = tilt(r.px, r.py);
      x += tiltToMm * g.dx;
      y += tiltToMm * g.dy;
    }
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
 *
 * ## The criterion is read before the transform, not after it
 *
 * `systemPupil` and not `psf`, because the criterion is measured on the TRACED
 * samples (see `wave/fidelity`) and is therefore known as soon as the trace is
 * done. Asking `psf` for it means forming the transform first — and at weight 1
 * that transform is discarded whole, which is not merely waste: the criterion
 * has just ruled that an FFT on this pupil grid is noise rather than
 * diffraction, so the discarded array is a calculation this module says is not
 * valid here. § 3c.3 pins the identity that makes skipping it safe and measures
 * what it buys.
 */
export function adaptivePsf(
  system: OpticalSystem,
  fieldValue: number,
  wavelengthNm: number,
  options: SystemPsfOptions & GeometricPsfOptions = {},
): AdaptivePsf {
  const pupilSamples = options.pupilSamples ?? 64;
  const pupil = systemPupil(system, fieldValue, wavelengthNm, options);
  const step = phaseStepPerSample(pupil.sampling, pupilSamples);
  const weight = geometricWeight(step);

  // `psfFromSystemPupil` reads `options.seeing` and adds the screen as phase;
  // `geometricPsf` is handed the same options and reads the same screen as a ray
  // deflection (§ 5d.2). Both branches therefore carry the atmosphere, so the
  // blend below mixes two images of the SAME sky and weight 1 shows seeing
  // rather than losing it — which is what § 5d deferred and what a user dragging
  // a defocus slider under a fixed atmosphere would otherwise watch evaporate.
  // The two are not the same picture: the FFT branch has the speckle, the ray
  // branch has a blur whose fine structure the screen's grid sets. They agree on
  // the centroid, which is the part Fried's angle of arrival pins.
  if (weight === 1) {
    // The geometric branch traces and fits its own OPD map, so the pupil work
    // above is repeated inside it. Measured at 2.0 ms against the branch's own
    // 378–481, and left alone: threading a traced map through a public
    // signature to recover 0.5% is a worse trade than the duplicate (§ 3c.3).
    const geometric = geometricPsf(system, fieldValue, wavelengthNm, options);
    return { ...geometric, geometricWeight: 1, phaseStepWaves: step };
  }

  const diffraction = psfFromSystemPupil(pupil, fieldValue, options);
  if (weight === 0) {
    return { ...diffraction, geometricWeight: 0, phaseStepWaves: step };
  }
  const geometric = geometricPsf(system, fieldValue, wavelengthNm, options);
  return { ...blendPsf(diffraction, geometric, weight), geometricWeight: weight, phaseStepWaves: step };
}
