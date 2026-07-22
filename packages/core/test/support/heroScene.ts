import { refractorPair } from "../../src/designs/refractor";
import { OpticalSystem } from "../../src/trace/system";
import { systemProperties } from "../../src/trace/paraxial";
import { blackbodySpectrum } from "../../src/photometry/blackbody";
import { spectralSamples } from "../../src/photometry/spectrum";
import { bestFocus, withFocus } from "../../src/analysis/focus";
import { SpectralStack, spectralStack } from "../../src/wave/polychromatic";

/**
 * The step-4 hero scene: one sun-like star, on axis, through a 100 mm f/10
 * refractor — first as an uncorrected singlet, then as an achromat of the same
 * power.
 *
 * Shared by the milestone rungs and the golden-image harness so both look at
 * the same picture. Both lenses are focused by the **same criterion at the same
 * wavelength**: a fringing metric on two differently-focused systems measures
 * the focus difference, not the chromatism.
 *
 * The aperture is f/10 for a reason worth recording. The chromatic blur is
 * f·NA²·2/(1.22·λ·V) Airy radii across, while an FFT PSF grid spans only
 * `pupilSamples`/2.44 of them — so opening up past about f/7 puts the singlet's
 * violet skirt outside the grid entirely, and the truncation shows up as
 * missing energy rather than as an error. f/10 leaves the whole halo on the
 * grid with room to spare (12 Airy radii of halo in 26 of grid).
 */

export const FOCAL_MM = 100;
export const SEMI_APERTURE_MM = 15;
export const EPD_MM = 10;
export const FOCUS_NM = 550;
export const SOURCE_TEMPERATURE_K = 5800;

export const PSF_OPTIONS = { pupilSamples: 64, padFactor: 4, traceSamples: 21 } as const;

export interface HeroRender {
  readonly system: OpticalSystem;
  readonly focusOffset: number;
  readonly stack: SpectralStack;
  /** Image-space numerical aperture. */
  readonly naImage: number;
  readonly airyRadiusMm: number;
}

export function heroSystem(prescription: OpticalSystem["prescription"]): OpticalSystem {
  return {
    prescription,
    aperture: { kind: "EPD", value: EPD_MM },
    field: { kind: "angle", values: [0] },
    wavelengths: spectralSamples(blackbodySpectrum(SOURCE_TEMPERATURE_K), { count: 9 }),
    conjugate: { kind: "infinite" },
  };
}

export function renderHero(prescription: OpticalSystem["prescription"]): HeroRender {
  const system = heroSystem(prescription);
  const focus = bestFocus(system, "minRmsWavefront", { wavelengthNm: FOCUS_NM });
  const focused = withFocus(system, focus.offsetFromLastVertex);
  const naImage = EPD_MM / (2 * systemProperties(prescription, FOCUS_NM).efl);
  return {
    system: focused,
    focusOffset: focus.offsetFromLastVertex,
    stack: spectralStack(focused, 0, PSF_OPTIONS),
    naImage,
    airyRadiusMm: (1.22 * FOCUS_NM * 1e-6) / (2 * naImage),
  };
}

export const heroPair = () => refractorPair(FOCAL_MM, SEMI_APERTURE_MM, FOCAL_MM);

/** Energy-weighted mean radius of one wavelength's image, in mm. */
export function meanRadiusMm(
  intensity: Float64Array,
  size: number,
  pixelScaleMm: number,
): number {
  const c = size / 2;
  let acc = 0;
  let total = 0;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const v = intensity[y * size + x]!;
      if (v === 0) continue;
      acc += v * Math.hypot(x - c, y - c);
      total += v;
    }
  }
  return total > 0 ? (acc / total) * pixelScaleMm : 0;
}

/** Paraxial defocus of a wavelength relative to where the image plane sits. */
export function defocusMm(r: HeroRender, nm: number): number {
  return systemProperties(r.system.prescription, nm).bfd - r.focusOffset;
}
