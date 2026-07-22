import { refractorPair } from "@telemicroscope/core/designs";
import { bestFocus, withFocus } from "@telemicroscope/core/analysis";
import type { OpticalSystem } from "@telemicroscope/core/trace";
import { blackbodySpectrum, spectralSamples } from "@telemicroscope/core/photometry";
import { spectralStack } from "@telemicroscope/core/wave";
import {
  colorImageFromStack,
  integratedXyz,
  radialColorProfile,
  toSrgbBytes,
  type ColorImage,
} from "@telemicroscope/core/imaging";

/**
 * The whole optical pipeline, as one pure function.
 *
 * Deliberately free of DOM and of React: it takes numbers and returns pixels,
 * so moving it into a web worker later is a change of *caller* rather than of
 * code. That is the only architectural commitment this ugly first UI makes,
 * and it is the one worth making now — everything else here is disposable.
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
