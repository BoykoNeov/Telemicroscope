import type { OpticalSystem } from "../trace/system";
import { objectNumericalAperture } from "../pupil/microscope";
import type { EmitterSlabs, VolumeEmitterDensity } from "./emitter-volume";
import { imageRadiusForObjectHeight, objectFieldTile } from "./object-field";
import { radialMapCovering } from "./radial-map";
import { focusDepthMm, formVolumePlane, neutralVolumeEmitterDensity } from "./spectral-volume";

/**
 * § 6bf — where a stage has to be, per colour and per field point.
 *
 * A depth stack is rendered at ONE stage position, so a channel is sharp only
 * where its own best focus happens to be. § 6bb.6 measured that against
 * wavelength on the axis; § 6be measured it against field height as well and
 * found the two SEPARATE — best focus is a colour term plus a field term, their
 * interaction at the estimator's own floor. It said in as many words that a
 * focus correction therefore wants two one-dimensional curves rather than a
 * two-dimensional map, and then returned neither. This is the readout.
 *
 * **What it measures is a rendered stage sweep, not a wavefront.** The engine
 * already has `analysis/focus`'s `bestFocus`, which minimises an image-side
 * wavefront merit, and it is a DIFFERENT quantity: the plane a wavefront is
 * flattest at is not the stage position a picture is sharpest at once the
 * rasterizer's own field-dependent map and depth rescale are in the path.
 * § 6bb.7 pins the two apart by 50% on the default objective, and a pupil-Strehl
 * proxy for this sweep drifted 14% on the axis and 2.3× off it. So this sweeps
 * what it claims to measure — the formed image — and pays the renders.
 *
 * **A coefficient is not the field curve.** § 6be read the field term as `h²`
 * and found one curve serving every wavelength to 2.3%. That reading is true of
 * the ladder's own 4×/0.10 at its own design wavelength — 3.9% across the whole
 * field — and of nothing else measured since. The same objective at 430 nm
 * drifts 11.1%, monotonely, and § 6be reported 1.04% because it read the outer
 * third, where the drift is already spent. A 10× from the same solver drifts
 * 48.7% over the same field on sweeps conditioned as well as the 4×'s own, and
 * the edge coefficient across three objectives goes as f^-0.60 where a form that
 * merely scaled would give f^-1. So the sampled curve is the readout and any
 * coefficient is a fit a caller may take from it — which is why `fieldDropMm`
 * is points and not a number.
 *
 * **Every sample carries its own conditioning**, because a stage sweep can stop
 * resolving before it stops returning. On a 2×/0.10 at 430 nm — 12 depths of
 * focus from nominal, and past this doublet's Maréchal reach — the axial
 * response is a PLATEAU, and two object heights 0.35 mm apart returned best-focus
 * values 5e-4 mm apart, which is nothing. The parabola still fits. So each
 * sample reports the half-width at which its peak falls 5%, in depths of focus,
 * and `maxPlateauDepths` refuses the sweep rather than printing a vertex read
 * off a plateau — `analysis/focus`'s rule, that this engine refuses an undefined
 * readout instead of returning one.
 *
 * Units: `focusMm` is a specimen depth in `EmitterSlice.zMm`'s direction —
 * positive away from the objective, so a positive figure means the stage racks
 * to make a deeper plane the sharp one. It is the same coordinate `focusDepthMm`
 * answers in, which is what makes that function usable as this one's seed.
 */

/** The probe object, placed at a tile's own object centre. */
export type FocusProbe = (centreMm: {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}) => VolumeEmitterDensity;

/**
 * How the inverse chief-ray map's bracket is opened — see `RadialMapOptions`.
 *
 * `"none"` is what every caller had before the option existed, and is bitwise
 * the § 6bb/§ 6be path. `"magnification"` seeds it with the frame's own on-axis
 * reading, which costs 3.9e-16 of the table and 1.6e-12 of a rendered pixel and
 * is the difference between a 10× rendering and a 10× THROWING: unseeded, the
 * bracket opens at the image radius, which is `M` object heights out and past
 * the field the chief ray survives.
 */
export type RadialMapSeed = "none" | "magnification";

export interface FocusSweepOptions {
  /** Frame size in pixels, a power of two. */
  readonly size: number;
  readonly pupilSamples: number;
  /** The depth slabs the probe is rasterized into. */
  readonly slabs: EmitterSlabs;
  /** The probe object. Required: a default here would choose the answer. */
  readonly probe: FocusProbe;
  /** Fine-sweep spacing (mm) and half-width — stage positions `about + i·step`. */
  readonly stepMm: number;
  readonly halfMm: number;
  /**
   * Centre of the fine sweep. Omit and a coarse pass finds it, seeded from
   * `focusDepthMm` — which is the paraxial catalogue shift and 50% away from
   * this answer (§ 6bb.7), so it opens the bracket and does not choose it.
   *
   * Supplied, the sweep is exactly `about + i·stepMm` and nothing else, which
   * is what lets a caller reproduce a pinned sweep to the last bit.
   */
  readonly aboutMm?: number;
  /** Coarse-pass spacing (mm). Default: one depth of focus at this wavelength. */
  readonly coarseStepMm?: number;
  /** Coarse-pass half-width (mm). Default: 14 coarse steps. Doubles until interior. */
  readonly coarseHalfMm?: number;
  /** Doublings the coarse pass may spend before refusing. Default 4. */
  readonly maxWidenings?: number;
  /**
   * Refuse a sample whose `plateauDepths` exceeds this. Required: the threshold
   * is the readout's own resolution claim, and a default would make the refusal
   * look like the engine's opinion rather than the caller's.
   *
   * It is a threshold on the OPTICS — see `plateauDepths` on why the sweep step
   * cancels out of it. 1 refuses the 2×/0.10 at 430 nm and passes every other
   * configuration § 6bf measured, whose samples read 0.32 to 0.90.
   */
  readonly maxPlateauDepths: number;
  /** Default `"none"` — bitwise the pre-§ 6bf path. */
  readonly radialMapSeed?: RadialMapSeed;
  readonly radialMapNodes?: number;
}

export interface FocusSweepPoint {
  readonly wavelengthNm: number;
  readonly objectHeightMm: number;
  /** Stage position of best focus (mm), the parabola's vertex. */
  readonly focusMm: number;
  /** The peak there, and the two beside it the vertex was read from. */
  readonly peak: number;
  /**
   * The parabola's relative second difference, `(y₋ − 2y₀ + y₊)/y₀` — negative
   * at a maximum, and the raw material of `plateauDepths`.
   */
  readonly curvature: number;
  /** Depth of focus at this wavelength (mm): `λ/NA²`, § 6k's. */
  readonly depthOfFocusMm: number;
  /**
   * Half-width (mm) over which the peak falls 5%, from the fitted parabola,
   * divided by the depth of focus. Under ~0.5 the vertex is a measurement;
   * approaching 1 the sweep is reading a plateau.
   *
   * **It is a property of the optics and not of the sweep grid**, though the
   * expression carries `stepMm`: the second difference goes as step², the square
   * root turns that into 1/step, and the multiply cancels it. § 6bf.5 measures
   * the cancellation at 0.08% on the plateau it exists to catch and 0.34% on a
   * sharp sample, over a 4× range of step — and pins the exception, a sample
   * whose local shape is not parabolic, which moves 23%, seventy times the sharp
   * sample beside it. So compare it against `maxPlateauDepths`; do not do
   * arithmetic with it.
   */
  readonly plateauDepths: number;
  /** Whether the maximum was strictly inside the swept window. */
  readonly interior: boolean;
}

export interface FocusSurfaceOptions extends FocusSweepOptions {
  readonly wavelengthsNm: readonly number[];
  /** Object heights (mm). The first must be 0 — the field curve is read against it. */
  readonly objectHeightsMm: readonly number[];
}

export interface FocusSurface {
  readonly wavelengthsNm: readonly number[];
  readonly objectHeightsMm: readonly number[];
  /** `[wavelength][height]`. */
  readonly samples: readonly (readonly FocusSweepPoint[])[];
  /** The colour curve: best focus on the axis, one per wavelength (mm). */
  readonly colourMm: readonly number[];
  /** The field curve per wavelength: `focus(h) − focus(0)` (mm). */
  readonly fieldDropMm: readonly (readonly number[])[];
  /**
   * The largest departure from separability over the grid (mm): at each height,
   * how far apart the wavelengths' field drops are.
   *
   * § 6be measured 1.2e-3 mm on the default objective and showed it to be the
   * estimator's floor rather than a coupling — it changed sign between heights
   * and its wavelength ordering scrambled. A caller reading this figure is
   * reading an upper bound on the coupling, not a coupling.
   */
  readonly interactionMm: number;
  /** …over the depth of focus at the bluest wavelength swept. */
  readonly interactionDepths: number;
}

/**
 * Best focus at one wavelength and one object height, by rendered stage sweep.
 *
 * The probe is placed at the tile's OWN object centre, never on the axis:
 * § 6be.1 lost four rungs to an axis-centred specimen that fell outside every
 * off-axis tile, so the two grids being compared were both zeros.
 */
export function renderedBestFocus(
  system: OpticalSystem,
  wavelengthNm: number,
  objectHeightMm: number,
  options: FocusSweepOptions,
): FocusSweepPoint {
  if (!(options.stepMm > 0)) {
    throw new Error(`renderedBestFocus: stepMm must be positive, got ${options.stepMm}`);
  }
  if (!(options.halfMm > options.stepMm)) {
    throw new Error(
      `renderedBestFocus: halfMm must exceed stepMm — a sweep of three points has no ` +
        `interior, got half ${options.halfMm} against step ${options.stepMm}`,
    );
  }
  if (!(options.maxPlateauDepths > 0)) {
    throw new Error(
      `renderedBestFocus: maxPlateauDepths must be positive, got ${options.maxPlateauDepths}`,
    );
  }

  const numericalAperture = objectNumericalAperture(system, wavelengthNm);
  const depthOfFocusMm = (wavelengthNm * 1e-6) / (numericalAperture * numericalAperture);

  const peakAt = (focusMm: number): number => {
    const frame = objectFieldTile(system, {
      size: options.size,
      pupilSamples: options.pupilSamples,
      wavelengthNm,
      centreMm: {
        x: imageRadiusForObjectHeight(system, objectHeightMm, wavelengthNm),
        y: 0,
      },
    });
    const density = options.probe({
      x: frame.centreObjectMm.x,
      y: frame.centreObjectMm.y,
      z: 0,
    });
    const seeded =
      options.radialMapSeed === "magnification"
        ? radialMapCovering(system, [frame], {
            nodes: options.radialMapNodes ?? 128,
            magnification: frame.magnification,
          })
        : undefined;
    const image = formVolumePlane(
      system,
      neutralVolumeEmitterDensity(density),
      {
        size: options.size,
        pupilSamples: options.pupilSamples,
        samples: [],
        slabs: options.slabs,
        focusMm,
        ...(options.radialMapNodes === undefined
          ? {}
          : { radialMapNodes: options.radialMapNodes }),
      },
      { nm: wavelengthNm, weight: 1 },
      frame.centreMm,
      seeded,
    ).image.intensity;
    let peak = 0;
    for (const v of image) if (v > peak) peak = v;
    return peak;
  };

  // The parabola through the sampled maximum and its two neighbours. Returned
  // whole, because `curvature` is what says whether the vertex means anything.
  const vertex = (about: number, step: number, half: number) => {
    const xs: number[] = [];
    const ys: number[] = [];
    const n = Math.round(half / step);
    for (let i = -n; i <= n; i++) {
      xs.push(about + i * step);
      ys.push(peakAt(about + i * step));
    }
    let best = 1;
    for (let i = 1; i < ys.length - 1; i++) if (ys[i]! > ys[best]!) best = i;
    const y0 = ys[best - 1]!;
    const y1 = ys[best]!;
    const y2 = ys[best + 1]!;
    const second = y0 - 2 * y1 + y2;
    return {
      mm: xs[best]! + ((0.5 * (y0 - y2)) / second) * step,
      peak: y1,
      curvature: second / y1,
      interior: best > 1 && best < ys.length - 2,
    };
  };

  let about = options.aboutMm;
  if (about === undefined) {
    // The seed opens the bracket; § 6bb.7 says it is 50% away from the answer,
    // so it must never be mistaken for one — and the coarse pass WIDENS rather
    // than returning the edge it happened to stop against.
    const seed = focusDepthMm(system, wavelengthNm);
    const coarseStep = options.coarseStepMm ?? depthOfFocusMm;
    let coarseHalf = options.coarseHalfMm ?? 14 * coarseStep;
    const widenings = options.maxWidenings ?? 4;
    let found: ReturnType<typeof vertex> | undefined;
    for (let widening = 0; ; widening++) {
      const coarse = vertex(seed, coarseStep, coarseHalf);
      if (coarse.interior) {
        found = coarse;
        break;
      }
      if (widening >= widenings) {
        throw new Error(
          `renderedBestFocus: the coarse pass never bracketed a maximum at ${wavelengthNm} nm, ` +
            `object height ${objectHeightMm} mm — the peak still rises at the edge of ` +
            `[${seed - coarseHalf}, ${seed + coarseHalf}] mm after ${widenings} doublings of the ` +
            `initial ±${options.coarseHalfMm ?? 14 * coarseStep} mm. Pass aboutMm if the sweep ` +
            `should be centred somewhere the paraxial seed does not reach.`,
        );
      }
      coarseHalf *= 2;
    }
    about = found.mm;
  }

  const fine = vertex(about, options.stepMm, options.halfMm);
  if (!(fine.curvature < 0)) {
    throw new Error(
      `renderedBestFocus: the sweep at ${wavelengthNm} nm, object height ${objectHeightMm} mm ` +
        `is not concave at its maximum (second difference ${fine.curvature}) — there is no ` +
        `vertex to report`,
    );
  }
  // Where the fitted parabola has fallen 5%: y = y₀(1 + (c/2)(Δ/step)²).
  const plateauDepths = (options.stepMm * Math.sqrt(0.1 / Math.abs(fine.curvature))) / depthOfFocusMm;
  if (plateauDepths > options.maxPlateauDepths) {
    throw new Error(
      `renderedBestFocus: the axial response at ${wavelengthNm} nm, object height ` +
        `${objectHeightMm} mm is a plateau — its peak falls 5% only after ${plateauDepths} ` +
        `depths of focus, against the ${options.maxPlateauDepths} asked for. The vertex ` +
        `${fine.mm} mm fits, and it is not a measurement.`,
    );
  }

  return {
    wavelengthNm,
    objectHeightMm,
    focusMm: fine.mm,
    peak: fine.peak,
    curvature: fine.curvature,
    depthOfFocusMm,
    plateauDepths,
    interior: fine.interior,
  };
}

/**
 * The whole surface: a colour curve, a field curve per colour, and how far the
 * two are from separating.
 *
 * `aboutMm` applies to every point when supplied, which is rarely what a caller
 * wants across a grid the colour term walks 0.17 mm over — so the usual use is
 * to omit it and let each point find its own bracket. The option exists for
 * reproducing a pinned sweep.
 */
export function focusSurface(
  system: OpticalSystem,
  options: FocusSurfaceOptions,
): FocusSurface {
  const { wavelengthsNm, objectHeightsMm } = options;
  if (wavelengthsNm.length === 0) {
    throw new Error("focusSurface: no wavelengths to sweep");
  }
  if (objectHeightsMm.length === 0 || objectHeightsMm[0] !== 0) {
    throw new Error(
      `focusSurface: the first object height must be 0 — the field curve is read as a drop ` +
        `against the axis, got ${objectHeightsMm[0]}`,
    );
  }

  const samples: FocusSweepPoint[][] = [];
  for (const nm of wavelengthsNm) {
    const row: FocusSweepPoint[] = [];
    for (const h of objectHeightsMm) {
      row.push(renderedBestFocus(system, nm, h, options));
    }
    samples.push(row);
  }

  const colourMm = samples.map((row) => row[0]!.focusMm);
  const fieldDropMm = samples.map((row) => row.map((p) => p.focusMm - row[0]!.focusMm));

  let interactionMm = 0;
  for (let j = 0; j < objectHeightsMm.length; j++) {
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = 0; i < wavelengthsNm.length; i++) {
      const d = fieldDropMm[i]![j]!;
      if (d < lo) lo = d;
      if (d > hi) hi = d;
    }
    interactionMm = Math.max(interactionMm, hi - lo);
  }
  const bluest = Math.min(...wavelengthsNm);
  const naBluest = objectNumericalAperture(system, bluest);
  const interactionDepths = interactionMm / ((bluest * 1e-6) / (naBluest * naBluest));

  return {
    wavelengthsNm,
    objectHeightsMm,
    samples,
    colourMm,
    fieldDropMm,
    interactionMm,
    interactionDepths,
  };
}

/**
 * The separated prediction: the colour term at `i` plus the field term at `j`,
 * the field term averaged over the wavelengths that were swept.
 *
 * This is the two-curve correction § 6be.2 said a caller wants. It is worth
 * exactly what `interactionMm` says it is: on a surface whose wavelengths
 * disagree about the field drop, the average is a compromise and the readout
 * reports how big a one.
 */
export function separatedFocusMm(surface: FocusSurface, i: number, j: number): number {
  const colour = surface.colourMm[i];
  if (colour === undefined) {
    throw new Error(`separatedFocusMm: no wavelength ${i} on this surface`);
  }
  let sum = 0;
  for (const row of surface.fieldDropMm) {
    const d = row[j];
    if (d === undefined) {
      throw new Error(`separatedFocusMm: no object height ${j} on this surface`);
    }
    sum += d;
  }
  return colour + sum / surface.fieldDropMm.length;
}
