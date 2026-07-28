import { describe, it, expect } from "vitest";
import {
  abbeImage,
  coherentSource,
  diskSource,
  idealPupil,
  uniformObject,
  type ObjectField,
} from "../src/illumination";
import { imagePixelScaleMm, type PupilScale } from "../src/wave/psf";
import { resampleEnergyGrid, resampleIrradianceGrid } from "../src/wave/polychromatic";
import {
  brightfieldSpectralStack,
  stackBrightfieldPlanes,
  type BrightfieldPlaneInput,
} from "../src/imaging/brightfield-spectrum";
import { colorImageFromStack, pixelXyz } from "../src/imaging/image";
import { chromaticity, spectrumToXyz, type Chromaticity } from "../src/photometry/cmf";
import { spectralSamples, spectralXyz } from "../src/photometry/spectrum";
import { fieldPupilAt, objectFieldFrame, objectFieldTile, objectPointAt } from "../src/imaging/object-field";
import { neutralSpecimen, type SpecimenValue } from "../src/imaging/specimen";
import {
  finiteConjugateMicroscope,
  finiteConjugateObjective,
  infinityCorrectedMicroscope,
  tubeLens,
} from "../src/designs/microscope";
import { imageNumericalAperture, objectNumericalAperture } from "../src/pupil/microscope";
import { paraxialImageOffset, withFocus } from "../src/analysis/focus";
import { defocusWaves } from "../src/imaging/volume";
import { brightfieldFidelity } from "../src/illumination/fidelity";
import { oilImmersionObjective } from "../src/designs/immersion";
import { LINE_D } from "../src/materials/dispersion";
import type { OpticalSystem, WavelengthSample } from "../src/trace/system";

/**
 * § 6r — polychromatic brightfield.
 *
 * Every brightfield rung before this one is monochromatic. A lamp is a spectrum
 * and a stain is a specimen that absorbs part of it, so this step is the Abbe
 * sum run per wavelength — and the whole of its difficulty is the **ruler**.
 * `pupilSamples` counts frequency bins across the pupil diameter, and the
 * physical frequency a bin carries is set by the pupil's size in wavelengths, so
 * every wavelength's image comes back on a grid of a different physical size.
 * Stacking them bin-for-bin is § 2e's error committed one branch over.
 *
 * The rungs are split the way the module is. § 6r.1–§ 6r.5 run against ideal
 * pupils, where the ruler is the only variable and a stack costs milliseconds;
 * § 6r.6–§ 6r.9 run on § 6b's traced DIN 4×/0.10, where a stack costs minutes
 * and the grids are kept small on purpose.
 */

/** § 3a's band, and its own equal-energy reference — no second number minted. */
const FROM_NM = 400;
const TO_NM = 700;
const equalEnergy = () => 1;
const NEUTRAL: Chromaticity = chromaticity(
  spectrumToXyz(equalEnergy, { fromNm: FROM_NM, toNm: TO_NM }),
);

/**
 * A fixed pupil geometry, so `imagePixelScaleMm` varies with λ and nothing else.
 *
 * The numbers are a plausible image-side cone (f/5 in air) and are never pinned
 * to: every rung below reads a RATIO of scales, in which they cancel.
 */
const scaleAt = (nm: number): PupilScale => ({
  referenceRadius: 100,
  exitRadius: 10,
  wavelengthNm: nm,
  nImage: 1,
});

const SIZE = 32;
const PUPIL_SAMPLES = 16;
const pixelScaleAt = (nm: number, size = SIZE): number =>
  imagePixelScaleMm(scaleAt(nm), size, PUPIL_SAMPLES);

/** Nine wavelengths of an equal-energy lamp — § 3a's own default sampling. */
const LAMP: readonly WavelengthSample[] = spectralSamples(equalEnergy, {
  count: 9,
  fromNm: FROM_NM,
  toNm: TO_NM,
});

/** A clear field at one wavelength, on that wavelength's own grid. */
const uniformPlane = (sample: WavelengthSample, size = SIZE): BrightfieldPlaneInput => {
  const formed = abbeImage(uniformObject(size), idealPupil(), coherentSource(), {
    pupilSamples: PUPIL_SAMPLES,
    scale: scaleAt(sample.nm),
  });
  return {
    nm: sample.nm,
    weight: sample.weight,
    size,
    pixelScaleMm: formed.pixelScaleMm!,
    intensity: formed.intensity,
  };
};

const chromaticityAt = (
  image: ReturnType<typeof colorImageFromStack>,
  x: number,
  y: number,
): Chromaticity => chromaticity(pixelXyz(image, x, y));

const distance = (a: Chromaticity, b: Chromaticity): number => Math.hypot(a.x - b.x, a.y - b.y);

describe("§ 6r.1 — the Abbe image is an irradiance, and that is measured", () => {
  it("a clear field images to exactly 1 at every grid and every pupilSamples", () => {
    // The premise the whole step rests on, and the reason it is a rung rather
    // than a paragraph: `wave/polychromatic`'s `intensity` holds energy per
    // pixel, so its resampler carries a Jacobian. This one does not, and the
    // difference is not visible in the type. A value that is the same constant
    // however many pixels the grid has is a value per unit AREA.
    const values: number[] = [];
    for (const [size, pupilSamples] of [
      [32, 16],
      [64, 16],
      [64, 32],
      [128, 64],
    ] as const) {
      const formed = abbeImage(uniformObject(size), idealPupil(), coherentSource(), {
        pupilSamples,
      });
      values.push(formed.intensity[size / 2 * size + size / 2]!);
    }
    for (const v of values) expect(v).toBeCloseTo(1, 12);
    // Not merely close to each other — the same number. A density that drifted
    // with the grid would be an energy in disguise.
    for (const v of values) expect(v).toBe(values[0]);
  });

  it("the two resamplers differ by exactly k², and only one leaves a density alone", () => {
    const src = new Float64Array(SIZE * SIZE).fill(1);
    const k = 0.6;
    const irradiance = resampleIrradianceGrid(src, SIZE, 1, k, SIZE - 2);
    const energy = resampleEnergyGrid(src, SIZE, 1, k, SIZE - 2);
    const centre = (SIZE - 2) / 2 * (SIZE - 2) + (SIZE - 2) / 2;
    expect(irradiance[centre]).toBeCloseTo(1, 14);
    expect(energy[centre]).toBeCloseTo(k * k, 14);
  });
});

describe("§ 6r.2 — neutral in, neutral out", () => {
  /**
   * APP.md's first rung for this step, and the one the ruler can silently break.
   * A clear specimen under an equal-energy lamp must come back at the SAME
   * chromaticity § 3a pins for that lamp — at every pixel, after nine
   * wavelengths have each been imaged on their own physical grid and resampled
   * onto one.
   */
  it("a clear field under an equal-energy lamp is § 3a's own white, at every pixel", () => {
    const stack = stackBrightfieldPlanes(LAMP.map((s) => uniformPlane(s)));
    const image = colorImageFromStack(stack);
    for (let y = 0; y < image.height; y += 3) {
      for (let x = 0; x < image.width; x += 3) {
        const c = chromaticityAt(image, x, y);
        expect(Math.abs(c.x - NEUTRAL.x)).toBeLessThan(1e-4);
        expect(Math.abs(c.y - NEUTRAL.y)).toBeLessThan(1e-4);
      }
    }
  });

  it("the ruler really is the variable: the planes' scales span λ exactly", () => {
    const stack = stackBrightfieldPlanes(LAMP.map((s) => uniformPlane(s)));
    // pixelScaleMm ∝ λ with the pupil held fixed, so the ratio the resampler
    // applies is λ_ruler/λ and the ruler is the bluest sample.
    expect(stack.rulerWavelengthNm).toBe(LAMP[0]!.nm);
    for (const p of stack.planes) {
      expect(p.resampleRatio).toBeCloseTo(LAMP[0]!.nm / p.nm, 12);
    }
    expect(stack.planes[0]!.resampleRatio).toBe(1);
    // The mean is reported but is NOT what the grid refers to — the departure
    // between the two is the whole of § 6r.4.
    expect(stack.meanWavelengthNm).toBeCloseTo(550, 9);
    expect(stack.pixelScaleMm).toBeLessThan(pixelScaleAt(stack.meanWavelengthNm));
  });
});

describe("§ 6r.3 — the negative control that tilts the spectrum as 1/λ²", () => {
  /**
   * The load-bearing rung. Resampling with `wave/polychromatic`'s Jacobian is
   * the architecturally tempting move — one resampler, already written, already
   * pinned — and it multiplies each plane by (λ_ruler/λ)². Energy cannot see it:
   * nothing is lost, only rescaled. Chromaticity can, and the artifact has a
   * closed form, so this is pinned as an identity rather than as "different".
   */
  it("the Jacobian branch reproduces an SED tilted by 1/λ², exactly", () => {
    const input = LAMP.map((s) => uniformPlane(s));
    const ruler = Math.min(...input.map((p) => p.pixelScaleMm));
    const size = SIZE - 2;
    const wrong = input.map((p) => ({
      ...p,
      intensity: resampleEnergyGrid(p.intensity, p.size, p.pixelScaleMm, ruler, size),
    }));
    const total = wrong.reduce((a, p) => a + p.weight, 0);
    const stack = {
      size,
      pixelScaleMm: ruler,
      planes: wrong,
      samples: wrong.map((p) => ({ nm: p.nm, weight: p.weight / total })),
    };
    const measured = chromaticityAt(colorImageFromStack(stack), size / 2, size / 2);

    // What a 1/λ² tilt of the same lamp is, computed from the observer alone.
    const ratios = input.map((p) => (ruler / p.pixelScaleMm) ** 2);
    const predicted = chromaticity(spectralXyz(LAMP, ratios));
    expect(measured.x).toBeCloseTo(predicted.x, 10);
    expect(measured.y).toBeCloseTo(predicted.y, 10);

    // And it is nowhere near neutral: the tilt is a visible blue cast, an order
    // of magnitude past the 1e-4 § 6r.2 holds the honest path to.
    expect(distance(measured, NEUTRAL)).toBeGreaterThan(0.02);
    expect(measured.x).toBeLessThan(NEUTRAL.x);
  });

  it("energy is not the witness — the wrong branch loses none of it", () => {
    // Stated as a rung because it is the reason the mistake survives review:
    // every plane is rescaled by a constant, so an energy-conservation check
    // that does not know what the constant should be is satisfied by both.
    const p = uniformPlane(LAMP[8]!);
    const ruler = pixelScaleAt(LAMP[0]!.nm);
    const size = SIZE - 2;
    const k = ruler / p.pixelScaleMm;
    const energy = resampleEnergyGrid(p.intensity, p.size, p.pixelScaleMm, ruler, size);
    const irradiance = resampleIrradianceGrid(p.intensity, p.size, p.pixelScaleMm, ruler, size);
    const sum = (a: Float64Array): number => a.reduce((acc, v) => acc + v, 0);
    // Same field, same optics, two readings that differ by a factor of 2.9 —
    // and neither is "missing" light. Which one is right is a question about
    // what the array HOLDS, and no check on the array can answer it.
    expect(sum(energy) / sum(irradiance)).toBeCloseTo(k * k, 12);
    expect(k * k).toBeLessThan(0.4);
  });
});

describe("§ 6r.4 — the common grid is the bluest plane's, and strictly interior", () => {
  it("the plane that sets the ruler is copied bit for bit, not interpolated", () => {
    // k = 1 exactly, so every destination lands on a lattice point and the
    // bilinear weights collapse. Asserted bitwise, in § 6o.8's currency: if this
    // were merely close, "the ruler is the bluest plane's" would be a rounding.
    const input = LAMP.map((s) => stripedPlane(s));
    const stack = stackBrightfieldPlanes(input);
    const src = input[0]!;
    const out = stack.planes[0]!.intensity;
    const crop = stack.croppedPixels;
    expect(crop).toBe(1);
    for (let y = 0; y < stack.size; y++) {
      for (let x = 0; x < stack.size; x++) {
        expect(out[y * stack.size + x]).toBe(src.intensity[(y + crop) * src.size + (x + crop)]);
      }
    }
  });

  it("a common grid that would reach outside a source is refused, not filled with zeros", () => {
    const input = LAMP.map((s) => uniformPlane(s));
    expect(() => stackBrightfieldPlanes(input, { size: SIZE })).toThrow(/black frame/);
    expect(() => stackBrightfieldPlanes(input, { size: SIZE - 2 })).not.toThrow();
  });

  it("a crop that cannot be shared centrally is refused too, at any size", () => {
    // An odd difference puts the two grids' centres half a pixel apart, which
    // turns the ruler plane's k = 1 identity into an interpolation and shifts
    // every plane with it. Checked away from the reach bound as well, so it is
    // the centring being refused and not the stencil running off the edge.
    const input = LAMP.map((s) => uniformPlane(s));
    expect(() => stackBrightfieldPlanes(input, { size: SIZE - 1 })).toThrow(/half a pixel/);
    expect(() => stackBrightfieldPlanes(input, { size: SIZE - 7 })).toThrow(/half a pixel/);
    // And an even one well inside the bound still crops centrally and copies the
    // ruler plane, which is what says the refusal is about parity and not size.
    const stack = stackBrightfieldPlanes(input, { size: SIZE - 8 });
    expect(stack.croppedPixels).toBe(4);
    const src = input[0]!;
    for (let y = 0; y < stack.size; y++) {
      for (let x = 0; x < stack.size; x++) {
        expect(stack.planes[0]!.intensity[y * stack.size + x]).toBe(
          src.intensity[(y + 4) * src.size + (x + 4)],
        );
      }
    }
  });

  it("size and croppedPixels are one knob, so disagreeing about it is refused", () => {
    const input = LAMP.map((s) => uniformPlane(s));
    expect(() =>
      stackBrightfieldPlanes(input, { size: SIZE - 2, croppedPixels: 3 }),
    ).toThrow(/disagree/);
    expect(() =>
      stackBrightfieldPlanes(input, { size: SIZE - 6, croppedPixels: 3 }),
    ).not.toThrow();
  });

  it("choosing the MEAN scale instead puts a coloured vignette on a neutral field", () => {
    /**
     * `wave/polychromatic` centres its common grid on the mean wavelength and
     * reports what falls off, which is right for a PSF: the energy is compact
     * and the skirt is a number a caller can weigh. An extended image has no
     * skirt, so what falls off is a black BORDER — and the border's width goes
     * as λ, which makes it a coloured vignette on a specimen that has no
     * colour. Measured here rather than argued.
     */
    const input = LAMP.map((s) => uniformPlane(s));
    const mean = pixelScaleAt(550);
    const size = SIZE - 2;
    const planes = input.map((p) => ({
      ...p,
      intensity: resampleIrradianceGrid(p.intensity, p.size, p.pixelScaleMm, mean, size),
    }));
    const total = planes.reduce((a, p) => a + p.weight, 0);
    const image = colorImageFromStack({
      size,
      pixelScaleMm: mean,
      planes,
      samples: planes.map((p) => ({ nm: p.nm, weight: p.weight / total })),
    });
    const centre = chromaticityAt(image, size / 2, size / 2);
    const corner = chromaticityAt(image, 0, 0);
    expect(distance(centre, NEUTRAL)).toBeLessThan(1e-4);
    // The corner has lost the blue planes entirely and is a different colour
    // from the middle of the same clear field.
    expect(distance(corner, centre)).toBeGreaterThan(0.05);
    expect(corner.x).toBeGreaterThan(centre.x);

    // The step's own stack, on the same planes, is neutral in the corner too.
    const honest = colorImageFromStack(stackBrightfieldPlanes(input));
    expect(distance(chromaticityAt(honest, 0, 0), NEUTRAL)).toBeLessThan(1e-4);
  });
});

/** A grating, so a plane has structure a resampler could smear. */
const stripedPlane = (sample: WavelengthSample, size = SIZE): BrightfieldPlaneInput => {
  const intensity = new Float64Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      intensity[y * size + x] = 1 + 0.5 * Math.cos((2 * Math.PI * 4 * x) / size);
    }
  }
  return {
    nm: sample.nm,
    weight: sample.weight,
    size,
    pixelScaleMm: pixelScaleAt(sample.nm, size),
    intensity,
  };
};

describe("§ 6r.5 — a stain is the specimen, and not the display", () => {
  /**
   * § 3b's milestone in the brightfield branch's own currency. There, the
   * tempting wrong implementation renders the monochrome stack and tints it, and
   * it produces a plausible coloured image with the chromatic structure already
   * summed away. Here it produces a plausible *stained* section in which the
   * stain and the clear field around it are the same hue — which is exactly what
   * a stain is not.
   */
  const RADIUS_MM = 6 * pixelScaleAt(FROM_NM);
  /** Intensity transmittance of a dye absorbing the middle of the band. */
  const dye = (nm: number): number => 1 - 0.95 * Math.exp(-(((nm - 550) / 45) ** 2));
  const stained = (xMm: number, yMm: number, nm: number): SpecimenValue =>
    Math.hypot(xMm, yMm) <= RADIUS_MM ? { re: Math.sqrt(dye(nm)), im: 0 } : { re: 1, im: 0 };

  /** The specimen laid on one wavelength's own grid — `rasterizeSpecimen`'s map,
   *  without a system, since this rung is about colour and not the field map. */
  const rasterize = (nm: number, size: number): ObjectField => {
    const p = pixelScaleAt(nm, size);
    const re = new Float64Array(size * size);
    const im = new Float64Array(size * size);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const t = stained((x - size / 2) * p, (y - size / 2) * p, nm);
        re[y * size + x] = t.re;
        im[y * size + x] = t.im;
      }
    }
    return { size, re, im };
  };

  const stainedStack = () =>
    stackBrightfieldPlanes(
      LAMP.map((s) => {
        const formed = abbeImage(rasterize(s.nm, SIZE), idealPupil(), diskSource(0.5, 5), {
          pupilSamples: PUPIL_SAMPLES,
          scale: scaleAt(s.nm),
        });
        return {
          nm: s.nm,
          weight: s.weight,
          size: SIZE,
          pixelScaleMm: formed.pixelScaleMm!,
          intensity: formed.intensity,
        };
      }),
    );

  it("a dye absorbing the middle of the band images magenta on a neutral field", () => {
    const stack = stainedStack();
    const image = colorImageFromStack(stack);
    const inside = chromaticityAt(image, stack.size / 2, stack.size / 2);
    const outside = chromaticityAt(image, 1, 1);
    // The field the stain sits in is still § 3a's white.
    expect(distance(outside, NEUTRAL)).toBeLessThan(2e-3);
    // The stain is not, and it is on the magenta side: a dye that removes the
    // middle of the band leaves both ends, which is the purple line's direction
    // — away from the spectral locus's green, so BOTH x and y cannot rise.
    expect(distance(inside, outside)).toBeGreaterThan(0.05);
    expect(inside.y).toBeLessThan(outside.y - 0.05);
  });

  it("tinting the monochrome image gives the stain and the field the SAME hue", () => {
    // The negative control, and the reason `SpectralStack` and this stack both
    // stop one move short of summing. A grey image multiplied by one colour has
    // identical chromaticity at every pixel by construction, so the difference
    // that IS the milestone reads zero — on the very specimen that stains most.
    const stack = stainedStack();
    const n = stack.size;
    const mono = new Float64Array(n * n);
    for (const p of stack.planes) {
      for (let i = 0; i < mono.length; i++) mono[i] = mono[i]! + p.weight * p.intensity[i]!;
    }
    const tint = spectralXyz(stack.samples, stack.samples.map(() => 1));
    const inside = chromaticity({
      x: mono[(n / 2) * n + n / 2]! * tint.x,
      y: mono[(n / 2) * n + n / 2]! * tint.y,
      z: mono[(n / 2) * n + n / 2]! * tint.z,
    });
    const outside = chromaticity({
      x: mono[n + 1]! * tint.x,
      y: mono[n + 1]! * tint.y,
      z: mono[n + 1]! * tint.z,
    });
    expect(distance(inside, outside)).toBeLessThan(1e-12);
  });
});

/** § 6b's DIN 4×/0.10, solved once — the traced rungs are the expensive half. */
const DIN_4X: OpticalSystem = finiteConjugateMicroscope({
  objective: finiteConjugateObjective({ magnification: 4, numericalAperture: 0.1 }),
}).system;

/** 450, 550 and 650 nm — § 3a's band at three samples, which is what a traced
 *  stack can afford. The blue one is the whole story of § 6r.7. */
const THREE: readonly WavelengthSample[] = spectralSamples(equalEnergy, {
  count: 3,
  fromNm: FROM_NM,
  toNm: TO_NM,
});

describe("§ 6r.6 — the traced path, and what concentric frames carry for free", () => {
  const TRACED_SIZE = 128;
  const TRACED_PUPIL_SAMPLES = 64;

  it("each wavelength's frame is its own size, and the extents go as λ", () => {
    const tiles = THREE.map((s) =>
      objectFieldTile(DIN_4X, {
        size: TRACED_SIZE,
        pupilSamples: TRACED_PUPIL_SAMPLES,
        wavelengthNm: s.nm,
        centreMm: { x: 0, y: 0 },
      }),
    );
    // § 6h.2's closed form is ∝ λ with the pupil fixed; what the trace adds is
    // the reference sphere and the exit pupil moving with λ too, so the ratio is
    // λ's to within the dispersion of the objective's own geometry.
    for (let i = 1; i < tiles.length; i++) {
      const ratio = tiles[i]!.halfExtentMm / tiles[0]!.halfExtentMm;
      expect(ratio / (THREE[i]!.nm / THREE[0]!.nm)).toBeCloseTo(1, 3);
    }
  });

  it("a neutral specimen stays neutral through the whole traced path", () => {
    const clear = neutralSpecimen(() => ({ re: 1, im: 0 }));
    const stack = brightfieldSpectralStack(DIN_4X, clear, coherentSource(), {
      size: TRACED_SIZE,
      pupilSamples: TRACED_PUPIL_SAMPLES,
      samples: THREE,
      map: "uniform",
    });
    const reference = chromaticity(spectralXyz(THREE, THREE.map(() => 1)));
    const image = colorImageFromStack(stack);
    for (let y = 0; y < image.height; y += 2) {
      for (let x = 0; x < image.width; x += 2) {
        expect(distance(chromaticityAt(image, x, y), reference)).toBeLessThan(2e-3);
      }
    }
    // Every wavelength ruled on its own trace, and the stack carries the worst.
    // `valid` here is a consequence of § 6r.7's finding, not an accident: at 64
    // bins the blue plane clears the criterion and at 32 it does not.
    expect(stack.fidelity!.verdict).toBe("valid");
  });
});

describe("§ 6r.7 — axial colour, in the wavefront the Abbe sum actually uses", () => {
  /**
   * APP.md's second rung for this step: a doublet objective's axial colour has
   * to show up as the focal shift § 6b's own design implies. It does, and the
   * measurement joins two things already on the ladder rather than minting a
   * third — § 1's chromatic focal shift (where each colour focuses) and § 1.5's
   * defocus wavefront W = ½·δ·NA²·ρ² (what a focus error costs in waves). What
   * § 6r adds is the third: the wavefront the brightfield sum is *formed with*.
   *
   * Read as a DIFFERENCE, refocused minus as-built, and that is what makes it a
   * measurement rather than a fit. The DIN 4×/0.10's traced pupil carries ~0.44
   * waves of residual at its own design wavelength, so the absolute defocus
   * coefficient is not the chromatic shift and never was. Moving the image plane
   * to each wavelength's own paraxial focus removes exactly the chromatic part
   * and leaves the residual alone.
   */
  const w20At = (system: OpticalSystem, nm: number): number => {
    const frame = objectFieldFrame(system, { size: 128, pupilSamples: 64, wavelengthNm: nm });
    // Noll j = 4 is defocus, orthonormal, so Z₄ = √3(2ρ²−1) and the rim value of
    // w₂₀·ρ² is 2√3 times the coefficient.
    return 2 * Math.sqrt(3) * fieldPupilAt(system, frame, 0.5, 0.5).fit.coefficients[3]!;
  };
  const DESIGN_NM = LINE_D;
  const basePlane = paraxialImageOffset(DIN_4X, DESIGN_NM);

  it("refocusing to a wavelength's own paraxial plane removes exactly its chromatic defocus", () => {
    // Six wavelengths across the band, including the achromat's own crossing.
    // The tolerance is 8% either way, and the measured excess is systematic:
    // 6.6% at 450 nm falling monotonically to 2.9% at 700 nm. A wrong pupil→image
    // scale, NA or pixel size would bias every wavelength the SAME way; a
    // residual that shrinks with λ is chromatic, which is the objective's own
    // spherochromatism and not a calibration error. § 3b makes the identical
    // argument about its 30%.
    //
    // Two-sided on purpose. The excess sits above 1 on THIS glass pair at THESE
    // conjugates, and its sign is a property of the residual rather than of the
    // measurement — a one-sided bound would fail a different objective for a
    // reason that is not a regression.
    for (const nm of [450, 480, 500, 550, 650, 700]) {
      const shiftMm = paraxialImageOffset(DIN_4X, nm) - basePlane;
      const predicted = defocusWaves(shiftMm, imageNumericalAperture(DIN_4X, nm), nm, 1);
      const measured = w20At(DIN_4X, nm) - w20At(withFocus(DIN_4X, basePlane + shiftMm), nm);
      expect(Math.abs(measured / predicted - 1)).toBeLessThan(0.08);
    }
  });

  it("the achromat's own crossing and its sign flip both survive the trace", () => {
    // The diagnostic, and the reason this is not a fit. Between the two zeros of
    // an achromat's focal-shift curve the shift changes SIGN — the paraxial
    // focus falls in front of the design plane rather than behind it — and the
    // measured defocus has to change sign with it. At 500 nm the curve is
    // crossing, and both numbers collapse to a few thousandths of a wave
    // together rather than one of them staying put.
    const at = (nm: number) => {
      const shiftMm = paraxialImageOffset(DIN_4X, nm) - basePlane;
      return {
        predicted: defocusWaves(shiftMm, imageNumericalAperture(DIN_4X, nm), nm, 1),
        measured: w20At(DIN_4X, nm) - w20At(withFocus(DIN_4X, basePlane + shiftMm), nm),
      };
    };
    const crossing = at(500);
    expect(Math.abs(crossing.predicted)).toBeLessThan(0.005);
    expect(Math.abs(crossing.measured)).toBeLessThan(0.005);

    const inside = at(550);
    expect(inside.predicted).toBeLessThan(0);
    expect(inside.measured).toBeLessThan(0);
    const outside = at(700);
    expect(outside.predicted).toBeGreaterThan(0);
    expect(outside.measured).toBeGreaterThan(0);
  });

  it("the bluest plane is the worst-resolved, by MORE than λ — and that sets pupilSamples", () => {
    /**
     * The practical consequence, and the one a caller has to act on. § 6f's
     * lattice criterion is phase per pupil sample, so a monochromatic stack
     * sized at the design wavelength is under-sampled in the blue by the ratio
     * of wavelengths — 1.22 here — and that much would be unremarkable. It is
     * not 1.22. The axial colour above puts a whole extra wavefront on the blue
     * plane, and the measured ratio is 2.56.
     *
     * So a polychromatic brightfield stack's `pupilSamples` is set by the BLUE
     * END, not by the design wavelength, and the verdict is what says so: at 32
     * bins the blue plane has no honest brightfield image while the other two
     * do, and at 64 all three are valid.
     */
    const stepAt = (nm: number, pupilSamples: number): number => {
      const frame = objectFieldFrame(DIN_4X, { size: 128, pupilSamples, wavelengthNm: nm });
      return brightfieldFidelity(fieldPupilAt(DIN_4X, frame, 0.5, 0.5).sampling, pupilSamples)
        .phaseStepWaves!;
    };
    const excess = stepAt(450, 32) / stepAt(550, 32) / (550 / 450);
    expect(stepAt(450, 32) / stepAt(550, 32)).toBeGreaterThan(2.5);
    expect(excess).toBeGreaterThan(2);

    const verdictAt = (nm: number, pupilSamples: number) => {
      const frame = objectFieldFrame(DIN_4X, { size: 128, pupilSamples, wavelengthNm: nm });
      return brightfieldFidelity(fieldPupilAt(DIN_4X, frame, 0.5, 0.5).sampling, pupilSamples)
        .verdict;
    };
    expect(verdictAt(450, 32)).toBe("no-honest-image");
    expect(verdictAt(550, 32)).toBe("valid");
    expect(verdictAt(650, 32)).toBe("valid");
    for (const s of THREE) expect(verdictAt(s.nm, 64)).toBe("valid");
  });
});

describe("§ 6r.8 — lateral colour, which nothing here coded for", () => {
  /**
   * The per-λ frames share a wavelength-independent `centreMm` and everything
   * inside them is traced at their own wavelength: the chief-ray inversion, the
   * reference sphere, the exit pupil. So the object point a given IMAGE position
   * looks at moves with λ — transverse chromatic aberration, arriving because
   * the frames are concentric and for no other reason.
   *
   * Pinned to the law rather than to the engine's own number: primary lateral
   * colour is **linear in field height**, so doubling the field must double the
   * separation. A bug in the inversion or the ruler would not be linear.
   */
  const TRACED_SIZE = 32;
  const TRACED_PUPIL_SAMPLES = 16;
  const BLUE = 450;
  const RED = 650;

  const objectPointOf = (nm: number, fieldMm: number): number => {
    const tile = objectFieldTile(DIN_4X, {
      size: TRACED_SIZE,
      pupilSamples: TRACED_PUPIL_SAMPLES,
      wavelengthNm: nm,
      centreMm: { x: fieldMm, y: 0 },
    });
    return objectPointAt(DIN_4X, tile, 0.5, 0.5).x;
  };
  const separationUm = (fieldMm: number): number =>
    Math.abs(objectPointOf(RED, fieldMm) - objectPointOf(BLUE, fieldMm)) * 1000;

  it("is exactly zero on the axis and grows linearly with field", () => {
    // On the axis there is no field height for it to be proportional to, and the
    // two maps agree to the last bit — the control that says the separation
    // below is the field's doing and not the inversion's.
    expect(separationUm(0)).toBeLessThan(1e-12);

    const one = separationUm(1);
    const two = separationUm(2);
    const four = separationUm(4);
    expect(one).toBeGreaterThan(0);
    // Linear in field: each doubling doubles it. Third-order terms are what the
    // 1% allows for, and they are the reason this is not asserted exactly.
    expect(two / one).toBeCloseTo(2, 1);
    expect(four / two).toBeCloseTo(2, 1);
    expect(Math.abs(two / one - 2)).toBeLessThan(0.01);
    expect(Math.abs(four / two - 2)).toBeLessThan(0.01);
  });
});

describe("§ 6r.9 — one condenser for every wavelength, and what that chooses", () => {
  /**
   * The step reuses a single `CondenserSource` across the band, which is right
   * because S is a ratio of numerical apertures and needs no wavelength
   * conversion — `illumination/abbe`'s own note, and what lets a commensurate
   * source (§ 6p), whose lattice is tied to `pupilSamples`, be built once.
   *
   * What it does NOT say is that the diaphragm is fixed. Holding S constant is a
   * condenser that TRACKS the objective's own NA across the band; a physically
   * fixed diaphragm holds NA_cond and lets S drift with the objective's
   * dispersion. Both are defensible, this implements the first, and the gap
   * between them is measured here rather than assumed negligible — § 6q's move
   * for the exit pupil, in the condenser's currency.
   */
  it("on a DRY front-stopped objective the two conventions are the SAME, exactly", () => {
    // Not "close" — identical to the last bit, and the reason is geometry rather
    // than luck. A DIN objective carries its stop on its own front vertex, so
    // the entrance pupil IS the stop, sitting in object space with no glass
    // between it and the specimen; the marginal ray's launch angle is then a
    // pure ratio of distances, and n = 1 in air carries no dispersion either.
    // There is nothing for λ to act on, so on this objective a fixed diaphragm
    // and a fixed S are the same condenser and the choice costs nothing.
    const blue = objectNumericalAperture(DIN_4X, 450);
    const red = objectNumericalAperture(DIN_4X, 650);
    expect(blue).toBe(red);
    expect(blue).toBeCloseTo(0.1, 12);
  });

  it("on an OIL objective they part company, because the medium disperses", () => {
    // Where the exactness above comes from is visible in what breaks it. NA is
    // n·sin u and the immersion oil's n is a Cauchy series (§ 1), so the same
    // geometric cone is a different numerical aperture at each wavelength — and
    // S = NA_cond/NA_obj drifts across the band for a diaphragm that never
    // moved. Measured on § 6e's 100×/1.40, it is 0.85% from 450 to 650 nm.
    const oil = infinityCorrectedMicroscope({
      objective: oilImmersionObjective({
        magnification: 100,
        numericalAperture: 1.4,
        tubeFocalLengthMm: 200,
      }),
      tubeLens: tubeLens({ focalLengthMm: 200 }),
      objectHeightsMm: [0, 0.002],
    }).system;
    const blue = objectNumericalAperture(oil, 450);
    const red = objectNumericalAperture(oil, 650);
    // Bluer is a higher index, so a bluer NA — the oil's own dispersion sign.
    expect(blue).toBeGreaterThan(red);
    const spread = (blue - red) / ((blue + red) / 2);
    expect(spread).toBeCloseTo(0.0085, 3);
    // Under § 6f.2's own convergence floor, so this step reuses one source and
    // says which convention that is rather than carrying two.
    expect(spread).toBeLessThan(0.04);
  });
});
