import type { CondenserSource } from "../illumination/source";
import type { BrightfieldFidelity } from "../illumination/fidelity";
import type { OpticalSystem, WavelengthSample } from "../trace/system";
import { resampleIrradianceGrid } from "../wave/polychromatic";
import { renderBrightfield } from "./brightfield";
import {
  objectFieldTile,
  tracedFieldPupils,
  type FieldPupilOptions,
  type ObjectFieldFrame,
} from "./object-field";
import {
  atWavelength,
  rasterizeSpecimen,
  type SpecimenMap,
  type SpectralSpecimen,
} from "./specimen";
import { radialMapCovering, type RadialMap } from "./radial-map";

/**
 * Polychromatic brightfield — § 6r, and the last of the Part D line.
 *
 * Every brightfield number the engine has produced is monochromatic: one
 * wavelength, one pupil, one grid. A real lamp is a spectrum and a stained
 * section is a specimen that absorbs *some* of it, so colour is not a finish
 * applied to a grey image — it is the thing the image is made of. This module is
 * the Abbe sum run per wavelength, and the one move that makes stacking those
 * runs legal.
 *
 * ## The ruler is the whole difficulty, and S is not part of it
 *
 * Two quantities cross a wavelength boundary here and they behave oppositely.
 *
 * **S needs no conversion.** The coherence parameter is NA_cond/NA_obj, a ratio
 * of numerical apertures, and `illumination/abbe`'s own header says why the
 * object may be supplied in reduced coordinates because of it. So a single
 * `CondenserSource` is handed to every wavelength, unchanged — including a
 * commensurate one (§ 6p), whose lattice is tied to `pupilSamples` and not to λ.
 *
 * **`pupilSamples` does.** It is a count of frequency bins across the pupil
 * *diameter*, and the physical frequency a bin represents is set by the pupil's
 * own size in wavelengths. `imagePixelScaleMm` is ∝ λ, so at fixed `size` and
 * `pupilSamples` every wavelength's image comes back on a grid of a different
 * physical size — a red pixel is a bigger piece of the image than a blue one,
 * and the frame's half-extent is proportionally wider. Adding the arrays
 * bin-for-bin is § 2e's error committed again, one branch over: it rescales each
 * wavelength instead of stacking it, and it does so invisibly.
 *
 * So each wavelength gets **its own frame** — `objectFieldTile` at that λ — and
 * the planes are resampled onto one common physical grid before anything else
 * touches them.
 *
 * ## Why there is no Jacobian here, and what the witness is
 *
 * `wave/polychromatic` resamples with `k²` because a PSF's `intensity` holds
 * energy per pixel. An Abbe image does not: it is an irradiance, a value *at* a
 * point, and § 6r.1 measures rather than derives it — a uniform specimen images
 * to exactly 1 at every `size` and every `pupilSamples`. Warping a point
 * property is coordinate substitution and carries no Jacobian, exactly as
 * `imaging/specimen` argues for the amplitude transmittance one layer earlier.
 *
 * The reason this is worth a paragraph is that **energy is not the witness**.
 * Neither branch loses light; the wrong one merely multiplies each wavelength by
 * (λ_common/λ)², which tilts the spectrum as 1/λ² and turns a neutral specimen
 * blue. An energy check passes either way. The witness is chromaticity, and the
 * negative control is one line of test.
 *
 * ## The common grid is the BLUEST plane's, and strictly interior
 *
 * `wave/polychromatic` centres its common grid on the mean wavelength and
 * reports what falls off the edge, which is right for a PSF: the energy is
 * compact, near the centre, and truncating its skirt is a number a caller can
 * weigh. An extended brightfield image has no skirt — it fills the frame — so
 * anything the resampler cannot source is a **black border**, and since the
 * frames' extents go as λ that border's width goes as λ too. A λ-dependent black
 * border is a coloured vignette that is pure resampling artifact, and it is
 * indistinguishable, by eye or by any energy check, from optics.
 *
 * The fix is to make truncation impossible instead of reporting it. The common
 * scale is the **smallest** of the planes' — the bluest, the physically smallest
 * frame — so every resample reads inside its own source, and the output is
 * cropped by one pixel on each side because a bilinear stencil needs `x0 + 1`
 * and `resampleIrradianceGrid` leaves what it cannot source at zero. The crop is
 * reported (`croppedPixels`); the truncation is zero by construction.
 *
 * One consequence is worth having: at the plane that *sets* the scale, k is
 * exactly 1, every sample lands on a lattice point and the bilinear weights
 * collapse, so that plane is copied **bit for bit** rather than interpolated.
 * § 6r.3 pins it, which is what makes "the ruler is the bluest plane's" a
 * statement about arithmetic and not a rounding.
 *
 * ## What comes out for free, because the frames are concentric
 *
 * The per-λ frames share a λ-independent `centreMm`, and everything inside
 * `objectFieldTile` is traced at its own wavelength: the chief-ray inversion
 * (`objectHeightForImageRadius`), the reference sphere, the exit pupil. So the
 * object point a given *image* pixel looks at is wavelength-dependent, which is
 * **lateral colour**, and the departure of the traced map from the paraxial one
 * is wavelength-dependent, which is chromatic distortion. Neither is coded for.
 * § 6r.6 measures the first on the DIN 4× rather than claiming it.
 *
 * ## Cost, and the scope this step deliberately keeps
 *
 * Everything multiplies by the wavelength count: one `objectFieldTile`, one
 * `rasterizeSpecimen` (§ 6n measured 0.12 ms/px — the dominant term) and one
 * `renderBrightfield` per λ. Nine wavelengths at 64² is minutes, not seconds.
 *
 * **A tile, not a mosaic.** `halfExtentMm` is ∝ λ, so a mosaic's pitch and guard
 * band — which § 6o pins against a closed form at one wavelength — would have to
 * be fixed by one reference λ with every other λ cropped to it. That is a real
 * design question and not this one; § 6f's "one field point, on axis, like the
 * rest of § 6" is the precedent, and the deferral is recorded in the ladder.
 */

/** One wavelength's brightfield image, on its own grid, before stacking. */
export interface BrightfieldPlaneInput {
  readonly nm: number;
  /** Relative weight. Pure quadrature (Δλ) plus the lamp's SED; see below. */
  readonly weight: number;
  readonly size: number;
  readonly pixelScaleMm: number;
  /** Irradiance, in the object's own coordinates (NOT fftshifted). */
  readonly intensity: Float64Array;
}

/** One wavelength's plane, already on the stack's common physical grid. */
export interface BrightfieldPlane {
  readonly nm: number;
  /** Normalized weight actually used (the weights sum to 1). */
  readonly weight: number;
  /** Irradiance on the common grid. NOT pre-multiplied by `weight`. */
  readonly intensity: Float64Array;
  /** This plane's own grid scale, before resampling — the ruler it arrived on. */
  readonly sourcePixelScaleMm: number;
  /** `commonPixelScaleMm / sourcePixelScaleMm`; exactly 1 for the bluest plane. */
  readonly resampleRatio: number;
  /** Present only for a traced stack. */
  readonly frame?: ObjectFieldFrame;
  readonly fidelity?: BrightfieldFidelity;
  readonly maxGridPhaseStepWaves?: number;
  readonly contributingPoints?: number;
}

export interface BrightfieldSpectralStack {
  /** Side of the common grid, in pixels — the input `size` less the crop. */
  readonly size: number;
  /** Image-plane millimetres per pixel of the common grid. */
  readonly pixelScaleMm: number;
  /** Weighted-mean wavelength (nm). Reported, NOT what the grid refers to. */
  readonly meanWavelengthNm: number;
  /** The wavelength whose own grid the common one is — the smallest scale. */
  readonly rulerWavelengthNm: number;
  readonly planes: readonly BrightfieldPlane[];
  /** Pixels dropped from each side. See the header: the crop replaces truncation. */
  readonly croppedPixels: number;
  /** The normalized samples, for `spectralXyzBasis` to build an observer against. */
  readonly samples: readonly WavelengthSample[];
  /** Worst verdict across every wavelength, when the planes were traced. */
  readonly fidelity?: BrightfieldFidelity;
  /** Max over wavelengths — keyed on the bluest, worst-resolved plane. */
  readonly maxGridPhaseStepWaves?: number;
  /** Min over wavelengths: the plane whose source was worst represented. */
  readonly contributingPoints?: number;
}

export interface StackBrightfieldOptions {
  /**
   * Side of the common grid. Defaults to `size − 2·croppedPixels`.
   *
   * Refused rather than clamped when it is large enough for a resample to reach
   * outside a source grid: the failure is a black border, and a black border is
   * a colour the caller would read as physics.
   *
   * Must leave an EVEN number of pixels to drop. An odd difference would put the
   * common grid's centre half a pixel off the source's, so the ruler plane would
   * be interpolated rather than copied and every plane would shift by half a
   * pixel — § 6n's own class of bug, and invisible in the picture.
   */
  readonly size?: number;
  /**
   * Pixels dropped from each side. Default 1 — the bilinear stencil's reach.
   *
   * A knob on the default `size` and nothing more, so passing both is refused
   * unless they agree rather than one silently winning.
   */
  readonly croppedPixels?: number;
}

/**
 * Put per-wavelength brightfield images on one common physical grid.
 *
 * Separated from the tracing driver below on purpose: the ruler is the whole of
 * § 6r's difficulty, and it is pinnable in milliseconds against ideal pupils
 * where a traced stack costs minutes. § 6r.1–§ 6r.4 run here.
 */
export function stackBrightfieldPlanes(
  input: readonly BrightfieldPlaneInput[],
  options: StackBrightfieldOptions = {},
): BrightfieldSpectralStack {
  if (input.length === 0) throw new Error("stackBrightfieldPlanes: no wavelengths");
  const srcSize = input[0]!.size;
  let totalWeight = 0;
  for (const p of input) {
    if (p.size !== srcSize) {
      throw new Error(
        `stackBrightfieldPlanes: every plane must share one grid size — ${p.nm} nm is ` +
          `${p.size} against ${srcSize}. The grids differ in physical SCALE, which is what ` +
          `this function exists to reconcile; differing in pixel COUNT is a caller error`,
      );
    }
    if (p.intensity.length !== p.size * p.size) {
      throw new Error(`stackBrightfieldPlanes: ${p.nm} nm holds ${p.intensity.length} pixels`);
    }
    if (!(p.pixelScaleMm > 0)) {
      throw new Error(`stackBrightfieldPlanes: ${p.nm} nm has pixel scale ${p.pixelScaleMm}`);
    }
    if (p.weight < 0) throw new Error(`stackBrightfieldPlanes: ${p.nm} nm has weight ${p.weight}`);
    totalWeight += p.weight;
  }
  if (!(totalWeight > 0)) throw new Error("stackBrightfieldPlanes: weights sum to zero");

  const croppedPixels = options.croppedPixels ?? 1;
  if (!Number.isInteger(croppedPixels) || croppedPixels < 0) {
    throw new Error(`stackBrightfieldPlanes: croppedPixels must be ≥ 0, got ${croppedPixels}`);
  }
  const size = options.size ?? srcSize - 2 * croppedPixels;
  if (!Number.isInteger(size) || size < 1) {
    throw new Error(`stackBrightfieldPlanes: common grid size must be ≥ 1, got ${size}`);
  }
  if (options.size !== undefined && options.croppedPixels !== undefined) {
    if (srcSize - 2 * options.croppedPixels !== options.size) {
      throw new Error(
        `stackBrightfieldPlanes: size ${options.size} and croppedPixels ${options.croppedPixels} ` +
          `disagree on a ${srcSize} px source — croppedPixels is a knob on the default size, so ` +
          `pass one or the other rather than letting one silently win`,
      );
    }
  }
  // An odd difference would centre the common grid half a pixel off the source's:
  // `resample` maps destination x to srcSize/2 + (x − size/2)·k, so the ruler
  // plane's k = 1 identity turns into a half-pixel interpolation and every plane
  // shifts with it. Refused, for § 6n.2's reason — half a pixel of
  // misregistration is exactly the class of error a picture cannot show.
  if ((srcSize - size) % 2 !== 0) {
    throw new Error(
      `stackBrightfieldPlanes: a ${size} px common grid on a ${srcSize} px source drops an odd ` +
        `${srcSize - size} pixels, so the two grids cannot share a centre — the ruler plane would ` +
        `be interpolated instead of copied and every plane would shift by half a pixel`,
    );
  }

  // The smallest scale, not the mean — see the header. Taken over the planes as
  // measured rather than assumed to be the shortest wavelength's, because the
  // reference sphere and the exit pupil are traced per λ too and a pathological
  // system could order them differently.
  let ruler = input[0]!;
  for (const p of input) if (p.pixelScaleMm < ruler.pixelScaleMm) ruler = p;
  const pixelScaleMm = ruler.pixelScaleMm;

  // Whether a destination can be sourced at all, checked once against the
  // WIDEST stencil reach rather than discovered as zeros in the output. k ≤ 1
  // for every plane by the choice above, so this is a statement about the crop.
  const reach = size / 2;
  const hi = srcSize / 2 + (reach - 1);
  const lo = srcSize / 2 - reach;
  if (lo < 0 || hi + 1 > srcSize - 1) {
    throw new Error(
      `stackBrightfieldPlanes: a common grid of ${size} px reaches outside a ${srcSize} px ` +
        `source — the bilinear stencil needs one pixel beyond the last destination, so the ` +
        `common grid must be at most ${srcSize - 2} px. Raising it would fill the border with ` +
        `zeros, which is a wavelength-dependent black frame and reads as a coloured vignette`,
    );
  }

  const planes: BrightfieldPlane[] = input.map((p) => {
    const ratio = pixelScaleMm / p.pixelScaleMm;
    return {
      nm: p.nm,
      weight: p.weight / totalWeight,
      intensity: resampleIrradianceGrid(p.intensity, p.size, p.pixelScaleMm, pixelScaleMm, size),
      sourcePixelScaleMm: p.pixelScaleMm,
      resampleRatio: ratio,
    };
  });

  return {
    size,
    pixelScaleMm,
    meanWavelengthNm: input.reduce((a, p) => a + p.nm * p.weight, 0) / totalWeight,
    rulerWavelengthNm: ruler.nm,
    planes,
    croppedPixels: (srcSize - size) / 2,
    samples: planes.map((p) => ({ nm: p.nm, weight: p.weight })),
  };
}

export interface BrightfieldSpectrumOptions extends FieldPupilOptions {
  /** Grid size for every wavelength's own frame, a power of two. */
  readonly size: number;
  /** Frequency bins across the pupil diameter, as in `abbeImage`. */
  readonly pupilSamples: number;
  /**
   * The lamp, sampled. `weight` is the source SED × Δλ and **nothing else** —
   * `photometry/spectrum`'s contract, because the observer's three responses are
   * applied per channel in `spectralXyzBasis` and folding ȳ(λ) in here would
   * apply the luminance response twice and return a grey image.
   */
  readonly samples: readonly WavelengthSample[];
  /** Image-plane centre of the tile (mm). Wavelength-independent; default axis. */
  readonly centreMm?: { readonly x: number; readonly y: number };
  /** Patches across the tile, per axis — `renderBrightfield`'s knob. */
  readonly patches?: number;
  readonly requireHonest?: boolean;
  readonly probeHeightMm?: number;
  /** Which map the specimen is rasterized on, per `imaging/specimen`. */
  readonly map?: SpecimenMap;
  /**
   * Rasterize each wavelength's plane through a tabulated radial map (§ 6s) with
   * this many intervals, instead of bisecting a chief ray per pixel.
   *
   * **One table per wavelength, never one for the stack.** Each plane has its
   * own frame at its own λ and the inverse chief-ray map is λ-dependent, so the
   * saving is per plane and the tables are not interchangeable —
   * `radialMapCovering` refuses to build one across them for exactly that
   * reason. Omitted, every pixel of every plane bisects, which is what § 6r's
   * rungs run on.
   */
  readonly radialMapNodes?: number;
  readonly stack?: StackBrightfieldOptions;
  /** Called once per wavelength finished, for progress against a cost in minutes. */
  readonly onWavelength?: (done: number, total: number, nm: number) => void;
}

/** `no-honest-image` ≻ `unknown` ≻ `valid` — `imaging/brightfield`'s order. */
const VERDICT_RANK = { valid: 0, unknown: 1, "no-honest-image": 2 } as const;

/** One wavelength's plane, formed — everything a stack needs from it. */
export interface FormedBrightfieldPlane {
  readonly frame: ObjectFieldFrame;
  readonly input: BrightfieldPlaneInput;
  readonly fidelity: BrightfieldFidelity;
  readonly maxGridPhaseStepWaves: number;
  readonly contributingPoints: number;
}

/**
 * Form ONE wavelength's brightfield plane: its own frame, its own raster, its
 * own traced pupils, its own Abbe sum.
 *
 * Factored out of `brightfieldSpectralStack` for the **spectral mosaic** (§ 6t),
 * which needs the same plane and then crops a guard band off it before stacking.
 * Shared rather than reimplemented for `mosaicTileAt`'s reason: a second
 * expression that merely agreed numerically would be free to drift, and § 6t.1
 * pins a spectral tile's plane **bitwise** against `renderMosaicTile` at the same
 * wavelength — an identity that only holds while there is one expression.
 *
 * `radialMap` overrides `options.radialMapNodes`: a mosaic builds one table per
 * wavelength over ALL its tiles' frames (the saving that grows with the field),
 * where a lone stack builds one per plane over its single frame.
 */
export function formBrightfieldPlane(
  system: OpticalSystem,
  specimen: SpectralSpecimen,
  source: CondenserSource,
  options: BrightfieldSpectrumOptions,
  sample: WavelengthSample,
  centreMm: { readonly x: number; readonly y: number },
  radialMap?: RadialMap,
): FormedBrightfieldPlane {
  const frame = objectFieldTile(system, {
    ...options,
    centreMm,
    wavelengthNm: sample.nm,
  });
  const table =
    radialMap ??
    (options.radialMapNodes === undefined
      ? undefined
      : radialMapCovering(system, [frame], {
          nodes: options.radialMapNodes,
          ...(options.aim === undefined ? {} : { aim: options.aim }),
        }));
  const object = rasterizeSpecimen(system, frame, atWavelength(specimen, sample.nm), {
    ...(options.aim === undefined ? {} : { aim: options.aim }),
    ...(options.map === undefined ? {} : { map: options.map }),
    ...(table === undefined ? {} : { radialMap: table }),
  });
  const formed = renderBrightfield(object, tracedFieldPupils(system, frame, options), source, {
    pupilSamples: options.pupilSamples,
    scale: frame.scale,
    ...(options.patches === undefined ? {} : { patches: options.patches }),
    ...(options.requireHonest === undefined ? {} : { requireHonest: options.requireHonest }),
  });
  return {
    frame,
    input: {
      nm: sample.nm,
      weight: sample.weight,
      size: frame.size,
      pixelScaleMm: frame.pixelScaleMm,
      intensity: formed.intensity,
    },
    fidelity: formed.fidelity,
    maxGridPhaseStepWaves: formed.maxGridPhaseStepWaves,
    contributingPoints: formed.contributingPoints,
  };
}

/**
 * The polychromatic brightfield image of a specimen, through a traced system.
 *
 * One `objectFieldTile` per wavelength about a common `centreMm`, the specimen
 * rasterized on each one through *its own* traced map, `renderBrightfield` on
 * each, and the planes stacked on the bluest one's ruler. Hand the result to
 * `colorImageFromStack` for colour.
 */
export function brightfieldSpectralStack(
  system: OpticalSystem,
  specimen: SpectralSpecimen,
  source: CondenserSource,
  options: BrightfieldSpectrumOptions,
): BrightfieldSpectralStack {
  const { samples } = options;
  if (samples.length === 0) throw new Error("brightfieldSpectralStack: no wavelengths");
  const centreMm = options.centreMm ?? { x: 0, y: 0 };

  const frames: ObjectFieldFrame[] = [];
  const fidelities: BrightfieldFidelity[] = [];
  const perPlane: { grid: number; points: number }[] = [];
  const input: BrightfieldPlaneInput[] = samples.map((sample, i) => {
    const plane = formBrightfieldPlane(system, specimen, source, options, sample, centreMm);
    frames.push(plane.frame);
    fidelities.push(plane.fidelity);
    perPlane.push({
      grid: plane.maxGridPhaseStepWaves,
      points: plane.contributingPoints,
    });
    options.onWavelength?.(i + 1, samples.length, sample.nm);
    return plane.input;
  });

  const stacked = stackBrightfieldPlanes(input, options.stack ?? {});
  let worst = fidelities[0]!;
  let maxGridPhaseStepWaves = 0;
  let contributingPoints = Infinity;
  for (let i = 0; i < fidelities.length; i++) {
    if (VERDICT_RANK[fidelities[i]!.verdict] > VERDICT_RANK[worst.verdict]) worst = fidelities[i]!;
    maxGridPhaseStepWaves = Math.max(maxGridPhaseStepWaves, perPlane[i]!.grid);
    contributingPoints = Math.min(contributingPoints, perPlane[i]!.points);
  }

  return {
    ...stacked,
    planes: stacked.planes.map((p, i) => ({
      ...p,
      frame: frames[i]!,
      fidelity: fidelities[i]!,
      maxGridPhaseStepWaves: perPlane[i]!.grid,
      contributingPoints: perPlane[i]!.points,
    })),
    fidelity: worst,
    maxGridPhaseStepWaves,
    contributingPoints,
  };
}
