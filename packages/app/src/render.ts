import { refractorPair } from "@telemicroscope/core/designs";
import { bestFocus, withFocus } from "@telemicroscope/core/analysis";
import type { OpticalSystem } from "@telemicroscope/core/trace";
import { blackbodySpectrum, quadratureSamples, spectralSamples } from "@telemicroscope/core/photometry";
import { spectralStack } from "@telemicroscope/core/wave";
import {
  colorImageFromStack,
  integratedXyz,
  radialColorProfile,
  rasterizePointSources,
  renderField,
  toSrgbBytes,
  type ColorImage,
  type PointSource,
} from "@telemicroscope/core/imaging";

/**
 * The whole optical pipeline, as one pure function.
 *
 * Deliberately free of DOM and of React: it takes numbers and returns pixels,
 * so running it in a web worker (`render.worker.ts`) was a change of *caller*
 * rather than of code. That is the only architectural commitment this ugly
 * first UI makes, and it is the one worth making — everything else here is
 * disposable.
 */

export type LensKind = "singlet" | "achromat";

export interface RenderRequest {
  readonly lens: LensKind;
  readonly focalLengthMm: number;
  readonly apertureMm: number;
  readonly sourceTemperatureK: number;
  readonly wavelengths: number;
  readonly pupilSamples: number;
  /** Display gain: white is a pixel holding 1/`whiteFraction` of the frame. */
  readonly whiteFraction: number;
}

export interface RenderResult {
  readonly rgba: Uint8ClampedArray;
  readonly size: number;
  readonly pixelScaleMm: number;
  readonly image: ColorImage;
  /** Milliseconds spent in the optical pipeline, excluding display encoding. */
  readonly elapsedMs: number;
  /** Chromatic spread of the halo, in Airy radii — the fringing, as a number. */
  readonly fringeAiryRadii: number;
  readonly airyRadiusMm: number;
  readonly fNumber: number;
  /**
   * Fraction of the light that fell outside the PSF grid, and the geometric
   * share the fidelity switch chose.
   *
   * Both are surfaced rather than swallowed. An FFT PSF grid spans only
   * `pupilSamples`/2.44 Airy radii, while the chromatic blur grows as f·NA², so
   * opening a singlet up past about f/7 pushes its violet skirt off the grid —
   * where it does not vanish, it WRAPS, and the result is a vivid, detailed,
   * entirely wrong picture. An app that showed that silently would be lying
   * with more conviction than one that showed nothing.
   */
  readonly truncatedFraction: number;
  readonly geometricWeight: number;
}

/** A render asked of the worker; `seq` lets the caller discard stale replies. */
export interface RenderJob {
  readonly seq: number;
  readonly request: RenderRequest;
}

/** The worker's reply, tagged with the `seq` of the job it answers. */
export interface RenderDone {
  readonly seq: number;
  readonly result: RenderResult;
}

const FOCUS_NM = 550;

export function buildSystem(request: RenderRequest): OpticalSystem {
  const pair = refractorPair(request.focalLengthMm, request.apertureMm, request.focalLengthMm);
  const base: OpticalSystem = {
    prescription: request.lens === "singlet" ? pair.singlet : pair.achromat,
    aperture: { kind: "EPD", value: request.apertureMm },
    field: { kind: "angle", values: [0] },
    wavelengths: spectralSamples(blackbodySpectrum(request.sourceTemperatureK), {
      count: request.wavelengths,
    }),
    conjugate: { kind: "infinite" },
  };
  // Both lenses focused by the SAME criterion at the SAME wavelength, or the
  // comparison measures the focus difference instead of the chromatism.
  const focus = bestFocus(base, "minRmsWavefront", { wavelengthNm: FOCUS_NM });
  return withFocus(base, focus.offsetFromLastVertex);
}

export function renderStar(request: RenderRequest): RenderResult {
  const started = performance.now();
  const system = buildSystem(request);
  // No rayGrid override: the geometric branch now sizes its own bundle to the
  // blur area (wave/geometric defaultRayGrid), which replaced this app's
  // aperture-keyed stopgap. Wide open costs more rays because it genuinely
  // needs them; the elapsed-ms readout is where that cost stays visible.
  const stack = spectralStack(system, 0, {
    pupilSamples: request.pupilSamples,
    padFactor: 4,
    traceSamples: 21,
  });
  const image = colorImageFromStack(stack);
  const elapsedMs = performance.now() - started;

  const naImage = request.apertureMm / (2 * request.focalLengthMm);
  const airyRadiusMm = (1.22 * FOCUS_NM * 1e-6) / (2 * naImage);

  // Energy-weighted mean radius per wavelength; its spread across the spectrum
  // is the fringing. Same measure the milestone rungs use.
  const radii = stack.planes.map((plane) => {
    const c = stack.size / 2;
    let acc = 0;
    let total = 0;
    for (let y = 0; y < stack.size; y++) {
      for (let x = 0; x < stack.size; x++) {
        const v = plane.intensity[y * stack.size + x]!;
        if (v === 0) continue;
        acc += v * Math.hypot(x - c, y - c);
        total += v;
      }
    }
    return total > 0 ? (acc / total) * stack.pixelScaleMm : 0;
  });

  const totalY = integratedXyz(image).y;
  return {
    rgba: toSrgbBytes(image, { exposure: 1 / (totalY * request.whiteFraction) }),
    size: image.width,
    pixelScaleMm: image.pixelScaleMm,
    image,
    elapsedMs,
    fringeAiryRadii: (Math.max(...radii) - Math.min(...radii)) / airyRadiusMm,
    airyRadiusMm,
    fNumber: request.focalLengthMm / request.apertureMm,
    truncatedFraction: stack.truncatedFraction,
    geometricWeight: Math.max(...stack.planes.map((p) => p.geometricWeight)),
  };
}

/**
 * The multi-star field render, as one pure function.
 *
 * Where `renderStar` traces one on-axis PSF, this convolves a whole star field
 * against a PSF that *varies across the frame* (`renderField`, `patches` > 1),
 * so off-axis aberration — coma growing radially outward, field curvature —
 * appears the way it actually does: the same star is a tight Airy disk on axis
 * and a comet toward the corners, because that is what the optics does to it.
 *
 * ## Why this cannot reuse `buildSystem`
 *
 * A scene render must be handed **pure quadrature** weights with each source
 * carrying its own spectrum — never the SED-weighted samples the single-source
 * path uses. Baking the blackbody into `system.wavelengths[i].weight` *and* into
 * each source applies the spectrum twice: a perfectly plausible image of the
 * wrong colour, which no symmetry or energy check would catch. `core/imaging`
 * has a rung pinned to exactly this trap. So this builds its own system with
 * `quadratureSamples` and puts the SED on the stars.
 */
export interface FieldRequest {
  readonly lens: LensKind;
  readonly focalLengthMm: number;
  readonly apertureMm: number;
  readonly sourceTemperatureK: number;
  /** Quadrature nodes across the band — NOT SED weights; the star carries the SED. */
  readonly wavelengths: number;
  readonly pupilSamples: number;
  /** Field subdivisions per axis. 1 is shift-invariant and pointless; use ≥ 2. */
  readonly patches: number;
  /** Stars per axis in the field grid. */
  readonly starGrid: number;
  /** Display gain: white is a pixel holding 1/`whiteFraction` of one star. */
  readonly whiteFraction: number;
}

export interface FieldResult {
  readonly rgba: Uint8ClampedArray;
  readonly size: number;
  readonly pixelScaleMm: number;
  /** Patch grid of THIS frame — coarser than `finestPatches` while refining. */
  readonly patches: number;
  readonly finestPatches: number;
  /** PSFs evaluated to reach this frame; only meaningful on the final one. */
  readonly psfEvaluations: number;
  readonly elapsedMs: number;
  readonly fNumber: number;
  readonly starCount: number;
}

/** A field render asked of the worker; `seq` lets the caller discard stale replies. */
export interface FieldJob {
  readonly seq: number;
  readonly request: FieldRequest;
}

/**
 * One frame of a field render. Refinement emits several per job, coarsest
 * first, each complete at its own patch grid; `done` marks the finest.
 */
export interface FieldFrame {
  readonly seq: number;
  readonly result: FieldResult;
  readonly done: boolean;
}

// Half-field of the frame, per axis, in degrees. The outer grid stars sit near
// ±this, so the corners reach √2× it — chosen so the achromat's off-axis coma
// and field curvature are visibly several pixels, not the fraction of a degree
// where the field is effectively shift-invariant and `patches` buys nothing.
const FIELD_HALF_DEG = 0.8;
// Outer grid stars land at this fraction of the half-frame in each axis, leaving
// a margin so nothing is clipped by the frame edge.
const FIELD_FILL = 0.9;

export function renderFieldScene(
  request: FieldRequest,
  onLevel?: (result: FieldResult, done: boolean) => void,
): FieldResult {
  const started = performance.now();
  const pair = refractorPair(request.focalLengthMm, request.apertureMm, request.focalLengthMm);
  const psfOptions = {
    pupilSamples: request.pupilSamples,
    padFactor: 4,
    traceSamples: 21,
  } as const;

  // Pure quadrature — the SED lives on each star below, not here. See the header.
  const samples = quadratureSamples({ count: request.wavelengths });
  const base: OpticalSystem = {
    prescription: request.lens === "singlet" ? pair.singlet : pair.achromat,
    aperture: { kind: "EPD", value: request.apertureMm },
    field: { kind: "angle", values: [0] },
    wavelengths: samples,
    conjugate: { kind: "infinite" },
  };
  const focus = bestFocus(base, "minRmsWavefront", { wavelengthNm: FOCUS_NM });
  const system = withFocus(base, focus.offsetFromLastVertex);

  // The PSF grid is `pupilSamples`×`padFactor` on a side; the scene must be the
  // same size for the convolution. Probe the on-axis stack to read it rather
  // than reconstruct the padding rule here.
  const size = spectralStack(system, 0, psfOptions).size;

  // Frame the field, don't inherit the native PSF pixel scale. That scale packs
  // the frame into ~0.06°, where every star is on-axis and the field-varying PSF
  // is wasted. Instead size the pixel so the outer grid stars land at
  // FIELD_FILL of the half-frame: `renderField` resamples each patch's PSF onto
  // this coarser grid, trading sub-pixel Airy detail — which a field view is not
  // about — for a frame wide enough to show coma grow toward the corners.
  const edgeImageMm = request.focalLengthMm * Math.tan((FIELD_HALF_DEG * Math.PI) / 180);
  const pixelScaleMm = edgeImageMm / (FIELD_FILL * (size / 2));

  // A square grid of identical stars in field angle. Identical on purpose: the
  // only thing that varies star-to-star is field position, so every difference
  // in the image is the optics, not the source.
  const spectrum = blackbodySpectrum(request.sourceTemperatureK);
  const sources: PointSource[] = [];
  const g = request.starGrid;
  for (let iy = 0; iy < g; iy++) {
    for (let ix = 0; ix < g; ix++) {
      const fx = g === 1 ? 0 : ((ix / (g - 1)) * 2 - 1) * FIELD_HALF_DEG;
      const fy = g === 1 ? 0 : ((iy / (g - 1)) * 2 - 1) * FIELD_HALF_DEG;
      sources.push({ fieldXDeg: fx, fieldYDeg: fy, flux: 1, spectrum });
    }
  }
  const scene = rasterizePointSources(system, sources, samples, { size, pixelScaleMm });

  const fNumber = request.focalLengthMm / request.apertureMm;
  const encode = (image: ColorImage, patches: number, psfEvaluations: number): FieldResult => {
    // Auto-expose so each star sits near the single-star panels' brightness
    // rather than dimming as 1/starCount when the frame's total light is spread
    // across the grid — the ×starCount undoes exactly that spreading.
    const totalY = integratedXyz(image).y;
    return {
      rgba: toSrgbBytes(image, { exposure: sources.length / (totalY * request.whiteFraction) }),
      size: image.width,
      pixelScaleMm: image.pixelScaleMm,
      patches,
      finestPatches: request.patches,
      psfEvaluations,
      elapsedMs: performance.now() - started,
      fNumber,
      starCount: sources.length,
    };
  };

  const out = renderField(system, scene, {
    ...psfOptions,
    patches: request.patches,
    onRefinement: (image, patches) => onLevel?.(encode(image, patches, 0), false),
  });
  const final = encode(out.image, out.patches, out.psfEvaluations);
  onLevel?.(final, true);
  return final;
}

/** Radial hue, as chromaticity x per annulus — what "the halo is blue" means. */
export function hueProfile(image: ColorImage, bins = 24): Array<{ radiusMm: number; x: number }> {
  const profile = radialColorProfile(image, bins);
  const out: Array<{ radiusMm: number; x: number }> = [];
  for (let b = 0; b < bins; b++) {
    const X = profile.xyz[b * 3]!;
    const Y = profile.xyz[b * 3 + 1]!;
    const Z = profile.xyz[b * 3 + 2]!;
    const sum = X + Y + Z;
    if (sum <= 0) continue;
    out.push({ radiusMm: profile.radiusMm[b]!, x: X / sum });
  }
  return out;
}
