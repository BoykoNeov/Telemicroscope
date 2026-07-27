import { describe, it, expect } from "vitest";
import {
  boxcarBand,
  chromaticFocusShiftMm,
  depthOfFocusMm,
  emissionKernel,
  emissionSamples,
  tracedEmissionPupils,
} from "../src/imaging/emission";
import { incoherentPsf } from "../src/imaging/fluorescence";
import { idealPupil } from "../src/illumination/transfer";
import {
  finiteConjugateMicroscope,
  finiteConjugateObjective,
  infinityCorrectedMicroscope,
  tubeLens,
} from "../src/designs/microscope";
import { oilImmersionObjective } from "../src/designs/immersion";
import { imageNumericalAperture, objectNumericalAperture } from "../src/pupil/microscope";
import { bestFocus, withFocus } from "../src/analysis/focus";
import { opdMap } from "../src/pupil/opd";
import { pupilGrid } from "../src/pupil/aiming";
import { spectralSamples } from "../src/photometry/spectrum";
import type { PupilScale } from "../src/wave/psf";

/**
 * § 6j — the Stokes shift, and the band the image is formed in.
 *
 * § 6i's operator is monochromatic and never sees an excitation wavelength.
 * That IS the architecture — the emission filter blocks the excitation, so it
 * cannot reach the image — and the two things left to measure are what the
 * shift between the bands costs in focus, and what a band of finite width costs
 * in the kernel. Both are ratios against numbers the ladder already owns: the
 * quarter-wave depth of focus derived from § 1.5's own defocus wavefront, and
 * § 2e's common-physical-grid discipline.
 */

const SIZE = 64;
const PUPIL_SAMPLES = 32;
const LAMBDA = 550;

const din4x = () =>
  finiteConjugateMicroscope({
    objective: finiteConjugateObjective({ magnification: 4, numericalAperture: 0.1 }),
  }).system;

const oil100x = (NA = 1.4) =>
  infinityCorrectedMicroscope({
    objective: oilImmersionObjective({
      magnification: 100,
      numericalAperture: NA,
      tubeFocalLengthMm: 200,
    }),
    tubeLens: tubeLens({ focalLengthMm: 200 }),
    objectHeightsMm: [0, 0.002],
  }).system;

/** A wavelength-independent ideal pupil, with the scale a caller would supply. */
const idealPupils = (scaleAt: (nm: number) => PupilScale) => (nm: number) => ({
  pupil: idealPupil(),
  scale: scaleAt(nm),
});

/** A scale whose pixel size is ∝ λ, as every real one is. */
const scaleOf = (nm: number): PupilScale => ({
  referenceRadius: 100,
  exitRadius: 5,
  wavelengthNm: nm,
  nImage: 1,
});

function peakOf(values: Float64Array): number {
  let peak = 0;
  for (let i = 0; i < values.length; i++) peak = Math.max(peak, values[i]!);
  return peak;
}

/**
 * Energy within `radiusPx` of the kernel's origin, which sits at index 0.
 *
 * The kernel is in DC-at-0 layout, so the core wraps into the four corners and
 * the distance has to wrap with it — measuring from the middle of the array
 * would report the tails and call them the core.
 */
function encircledFraction(values: Float64Array, size: number, radiusPx: number): number {
  let inside = 0;
  let total = 0;
  for (let y = 0; y < size; y++) {
    const dy = Math.min(y, size - y);
    for (let x = 0; x < size; x++) {
      const dx = Math.min(x, size - x);
      const v = values[y * size + x]!;
      total += v;
      if (dx * dx + dy * dy <= radiusPx * radiusPx) inside += v;
    }
  }
  return inside / total;
}

describe("§ 6j.1 — the band's weights are the source's, and they enter exactly once", () => {
  it("a band's samples are normalized, so widening a filter does not brighten by arithmetic", () => {
    for (const width of [10, 40, 120]) {
      const samples = emissionSamples(boxcarBand(520, width), {
        count: 21,
        fromNm: 440,
        toNm: 600,
      });
      expect(samples.reduce((a, s) => a + s.weight, 0)).toBeCloseTo(1, 12);
      // Only wavelengths inside the passband carry any weight.
      for (const s of samples) {
        if (Math.abs(s.nm - 520) > width / 2) expect(s.weight).toBe(0);
      }
    }
  });

  it("the band multiplies quadrature ONCE — it is `spectralSamples`, renormalized", () => {
    // `imaging/scene` warns that applying an SED twice gives a plausible image
    // of the wrong colour. The guard is that this constructor is the engine's
    // own one-source constructor with nothing added but a normalization: a
    // second application would show up here as the band squared.
    const band = boxcarBand(520, 40);
    const mine = emissionSamples(band, { count: 21, fromNm: 440, toNm: 600 });
    const raw = spectralSamples(band, { count: 21, fromNm: 440, toNm: 600 });
    const total = raw.reduce((a, s) => a + s.weight, 0);
    for (let i = 0; i < mine.length; i++) {
      expect(mine[i]!.nm).toBe(raw[i]!.nm);
      expect(mine[i]!.weight).toBeCloseTo(raw[i]!.weight / total, 15);
    }
    // A band with no light in the sampled range throws rather than dividing by
    // zero into a silently black image.
    expect(() => emissionSamples(boxcarBand(900, 5), { fromNm: 440, toNm: 600 })).toThrow(
      /no light reaches the image/,
    );
  });

  it("a one-line band reproduces the monochromatic kernel exactly", () => {
    // The degenerate case has to be the identity, or every broadband number
    // below is measured against a moving zero.
    const samples = [{ nm: LAMBDA, weight: 1 }];
    const stacked = emissionKernel(idealPupils(scaleOf), samples, {
      size: SIZE,
      pupilSamples: PUPIL_SAMPLES,
    });
    const mono = incoherentPsf(idealPupil(), {
      size: SIZE,
      pupilSamples: PUPIL_SAMPLES,
      scale: scaleOf(LAMBDA),
    });
    for (let i = 0; i < stacked.values.length; i++) {
      expect(stacked.values[i]!).toBeCloseTo(mono.values[i]!, 12);
    }
    expect(stacked.meanWavelengthNm).toBe(LAMBDA);
    expect(stacked.pixelScaleMm).toBeCloseTo(mono.pixelScaleMm!, 12);
    expect(stacked.truncatedFraction).toBeLessThan(1e-12);
  });
});

describe("§ 6j.2 — one physical grid, because the pixel scale is ∝ λ", () => {
  const band = (width: number) =>
    emissionSamples(boxcarBand(LAMBDA, width), { count: 9, fromNm: 450, toNm: 650 });

  it("the components genuinely live on different grids — that is why it resamples", () => {
    // `imagePixelScaleMm` is ∝ λ, so a 200 nm band spans a 44% range of pixel
    // sizes. A bin-for-bin sum would rescale each component instead of stacking
    // it: § 2e's founding failure mode, restated where it recurs.
    const blue = incoherentPsf(idealPupil(), {
      size: SIZE,
      pupilSamples: PUPIL_SAMPLES,
      scale: scaleOf(450),
    });
    const red = incoherentPsf(idealPupil(), {
      size: SIZE,
      pupilSamples: PUPIL_SAMPLES,
      scale: scaleOf(650),
    });
    expect(red.pixelScaleMm! / blue.pixelScaleMm!).toBeCloseTo(650 / 450, 12);
  });

  it("the stacked kernel keeps unit sum, and reports what resampling lost", () => {
    const stacked = emissionKernel(idealPupils(scaleOf), band(200), {
      size: SIZE,
      pupilSamples: PUPIL_SAMPLES,
    });
    expect(stacked.values.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12);
    // Zero here, and that is a measurement rather than a guarantee: these
    // kernels are compact and stay on the grid across a 200 nm band. The field
    // exists so a caller who pushes the band or shrinks the grid until they do
    // not is told, instead of receiving a renormalized image that is quietly
    // missing light — `wave/polychromatic`'s `truncatedFraction`, for its reason.
    expect(stacked.truncatedFraction).toBeLessThan(1e-9);
  });

  it("with the scale held fixed, band width does NOTHING — so λ enters only there", () => {
    // The isolation that says what this module's resampling is for. Hand every
    // component the SAME scale and the stack reproduces the monochromatic kernel
    // exactly at any width, because the components are then identical arrays.
    // Everything a band does to an aberration-free kernel therefore comes from
    // pixelScaleMm ∝ λ and from nothing else.
    const fixed = idealPupils(() => scaleOf(LAMBDA));
    const mono = incoherentPsf(idealPupil(), {
      size: SIZE,
      pupilSamples: PUPIL_SAMPLES,
      scale: scaleOf(LAMBDA),
    });
    for (const width of [40, 200]) {
      const stacked = emissionKernel(fixed, band(width), {
        size: SIZE,
        pupilSamples: PUPIL_SAMPLES,
      });
      for (let i = 0; i < stacked.values.length; i++) {
        expect(stacked.values[i]!).toBeCloseTo(mono.values[i]!, 12);
      }
    }
  });

  it("every band shares one grid, so a fixed pixel radius is a fixed physical one", () => {
    // What makes any comparison between bands legitimate. All of these are
    // centred on 550, so their weighted-mean wavelengths agree and the common
    // grid is the same grid — which is the precondition § 6j.5's traced
    // comparison relies on.
    //
    // Deliberately NOT pinned here: whether widening an aberration-free band
    // spreads the kernel or concentrates it. Both candidate readouts (peak
    // pixel, core energy) change sign somewhere across 0 → 200 nm, and the
    // effect competes with the resampler's own bilinear smoothing, which itself
    // grows with |k − 1|. The physics is genuinely two-sided — the blue
    // components are narrower and really do concentrate — so calling either
    // direction "the band blurring" would be picking the metric that flattered
    // the claim. § 6j.5 measures blur where an objective supplies it, comparing
    // two bands that are BOTH resampled so the smoothing cancels.
    const kernels = [40, 100, 200].map((width) =>
      emissionKernel(idealPupils(scaleOf), band(width), {
        size: SIZE,
        pupilSamples: PUPIL_SAMPLES,
      }),
    );
    for (const k of kernels) {
      expect(k.meanWavelengthNm).toBeCloseTo(LAMBDA, 9);
      expect(k.pixelScaleMm).toBeCloseTo(kernels[0]!.pixelScaleMm!, 12);
      expect(encircledFraction(k.values, SIZE, 3)).toBeGreaterThan(0.8);
    }
  });

  it("the mean wavelength is the weighted one, and the grid is its own", () => {
    const samples = band(100);
    const stacked = emissionKernel(idealPupils(scaleOf), samples, {
      size: SIZE,
      pupilSamples: PUPIL_SAMPLES,
    });
    const mean = samples.reduce((a, s) => a + s.weight * s.nm, 0);
    expect(stacked.meanWavelengthNm).toBeCloseTo(mean, 12);
    // pixelScaleMm is ∝ λ and the weights sum to 1, so the weighted mean of the
    // components' scales IS the mean wavelength's scale — an identity, and the
    // reason the common grid never extrapolates past either end of the band.
    const atMean = incoherentPsf(idealPupil(), {
      size: SIZE,
      pupilSamples: PUPIL_SAMPLES,
      scale: scaleOf(mean),
    });
    expect(stacked.pixelScaleMm).toBeCloseTo(atMean.pixelScaleMm!, 12);
  });
});

describe("§ 6j.3 — the depth of focus, derived from the engine's own defocus", () => {
  it("half a depth of focus IS a quarter wave on the traced wavefront", () => {
    // The formula is held to the tracer, not to a textbook. § 1.5 pins
    // W(ρ) = ½·δ·NA²·ρ²; defocus a real system by DOF/2 and the traced RMS must
    // be that of a quarter-wave defocus, which for W = A·ρ² is A/(2√3).
    const system = din4x();
    const naImg = imageNumericalAperture(system, LAMBDA);
    const dof = depthOfFocusMm(LAMBDA, naImg);
    const focus = bestFocus(system, "minRmsWavefront", {
      wavelengthNm: LAMBDA,
      pupilSamples: 21,
    });
    const at = (offset: number): number =>
      opdMap(withFocus(system, focus.offsetFromLastVertex + offset), 0, LAMBDA, pupilGrid(21))
        .rmsWaves;
    const base = at(0);
    const defocused = at(dof / 2);
    // The quarter-wave rim excursion, as an RMS: 0.25/(2√3) = 0.0722 waves. The
    // system's own residual adds in quadrature and is subtracted the same way.
    const expected = 0.25 / (2 * Math.sqrt(3));
    expect(Math.sqrt(Math.max(0, defocused * defocused - base * base))).toBeCloseTo(expected, 2);
  });

  it("and it scales as n/NA² — the two dependencies, separately", () => {
    expect(depthOfFocusMm(LAMBDA, 0.2)).toBeCloseTo(depthOfFocusMm(LAMBDA, 0.1) / 4, 12);
    expect(depthOfFocusMm(2 * LAMBDA, 0.1)).toBeCloseTo(2 * depthOfFocusMm(LAMBDA, 0.1), 12);
    expect(depthOfFocusMm(LAMBDA, 0.1, 1.515)).toBeCloseTo(1.515 * depthOfFocusMm(LAMBDA, 0.1), 12);
    expect(() => depthOfFocusMm(LAMBDA, 0)).toThrow(/NA must be positive/);
  });

  it("the object-side and image-side depths differ by the longitudinal magnification", () => {
    // Which is why the RATIO below may be measured where `bestFocus` lives and
    // quoted where a microscopist works. NA′ = NA/|M| by the sine condition, so
    // DOF′/DOF = M²·n′/n — the longitudinal magnification, exactly.
    const system = din4x();
    const naObj = objectNumericalAperture(system, LAMBDA);
    const naImg = imageNumericalAperture(system, LAMBDA);
    const M = naObj / naImg;
    const objectSide = depthOfFocusMm(LAMBDA, naObj);
    const imageSide = depthOfFocusMm(LAMBDA, naImg);
    expect(imageSide / objectSide).toBeCloseTo(M * M, 9);
  });
});

describe("§ 6j.4 — what the Stokes shift costs, on the ladder's own two objectives", () => {
  const FROM = 500;
  const TO = 520;

  const costIn = (system: ReturnType<typeof din4x>, pupilSamples = 21): number => {
    const naImg = imageNumericalAperture(system, LAMBDA);
    const shift = chromaticFocusShiftMm(system, FROM, TO, { pupilSamples });
    return Math.abs(shift) / depthOfFocusMm(LAMBDA, naImg);
  };

  it("a 20 nm shift is a third of a depth of focus at 4×/0.10", () => {
    expect(costIn(din4x())).toBeCloseTo(0.32, 2);
  });

  it("and nearly four depths of focus at 100×/1.40 — a refocus between channels", () => {
    // Part of the 12× is NA (DOF ∝ 1/NA²) and part is the objective's own colour
    // correction. § 6e is explicit that the aplanatic front group is exact at ONE
    // wavelength and that "the chromatic half" is its open item, so this number
    // is partly the cost of that deferral arriving where it bites — NOT a claim
    // about a real apochromatic 100×/1.40.
    expect(costIn(oil100x())).toBeCloseTo(3.77, 1);
    expect(costIn(oil100x()) / costIn(din4x())).toBeGreaterThan(10);
  });

  it("the DIFFERENCE is well conditioned where the endpoints are not", () => {
    // The absolute best-focus offset moves by ~5e-2 mm with the trace's pupil
    // sampling on this objective, which is 5% of a depth of focus and would sink
    // the ratio above. The difference between two wavelengths holds to 3% over
    // the same sweep, and to 0.1% at NA 1.40 — measured, because a ratio built
    // on bisection noise would look exactly like this one.
    const spread = (system: ReturnType<typeof din4x>): number => {
      const costs = [11, 17, 21, 25, 31].map((ps) => costIn(system, ps));
      return (Math.max(...costs) - Math.min(...costs)) / Math.min(...costs);
    };
    expect(spread(din4x())).toBeLessThan(0.04);
    expect(spread(oil100x())).toBeLessThan(0.005);
  });

  it("the shift is a real chromatic focal shift: it reverses with the band", () => {
    // Sign, not just size — and the negative control that it is the wavelengths
    // doing this rather than the solver: swapping the endpoints negates it.
    const system = din4x();
    const forward = chromaticFocusShiftMm(system, FROM, TO);
    const backward = chromaticFocusShiftMm(system, TO, FROM);
    expect(forward).toBeCloseTo(-backward, 12);
    expect(Math.abs(chromaticFocusShiftMm(system, LAMBDA, LAMBDA))).toBe(0);
  });
});

describe("§ 6j.5 — a traced objective through a real band", () => {
  it("a wide band IS broader than a narrow one — where the objective is chromatic", () => {
    // § 6j.2 could not show this and says why. Here the objective focuses the
    // colours in different planes, so widening the band mixes defocused
    // components and the core genuinely empties.
    //
    // Both bands are compared through the SAME number of samples and both are
    // resampled, so the resampler's own bilinear smoothing is present on both
    // sides and cancels. Comparing against an unresampled single line would have
    // measured that smoothing and called it secondary spectrum.
    const system = din4x();
    const pupils = tracedEmissionPupils(system, 0);
    const kernelFor = (width: number) =>
      emissionKernel(
        pupils,
        emissionSamples(boxcarBand(LAMBDA, width), {
          count: 7,
          fromNm: LAMBDA - width / 2,
          toNm: LAMBDA + width / 2,
        }),
        { size: SIZE, pupilSamples: PUPIL_SAMPLES },
      );
    const narrow = kernelFor(10);
    const wide = kernelFor(160);
    expect(encircledFraction(wide.values, SIZE, 3)).toBeLessThan(
      encircledFraction(narrow.values, SIZE, 3),
    );
    expect(wide.values.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12);
    // Every component was traced, so the stack carries a real wavefront: the
    // grid guard is nonzero where the ideal-pupil fixture's is identically zero.
    expect(wide.maxGridPhaseStepWaves).toBeGreaterThan(0);
    expect(wide.maxGridPhaseStepWaves).toBeLessThan(0.5);
  });

  it("the excitation band is not an input to any of this", () => {
    // The structural null. There is no λ_ex parameter anywhere in the imaging
    // path — the emission filter blocks it — so "resolution is set by λ_em" is
    // not a measurement here, it is the shape of the API. What IS measurable is
    // that the kernel's scale follows the emission band alone.
    const system = din4x();
    const pupils = tracedEmissionPupils(system, 0);
    const at = (centre: number) =>
      emissionKernel(pupils, [{ nm: centre, weight: 1 }], {
        size: SIZE,
        pupilSamples: PUPIL_SAMPLES,
      }).pixelScaleMm!;
    // 1.2001 rather than 1.2000, and the 1.4e-4 is physics: `pixelScaleMm` is
    // λ·R/(n′·size·Δpupil), and R and the exit-pupil radius come from a trace
    // that is itself chromatic. So the scale follows the emission wavelength to
    // within the exit pupil's own dispersion, which is the honest statement.
    expect(at(600) / at(500)).toBeCloseTo(600 / 500, 3);
    expect(Math.abs(at(600) / at(500) / 1.2 - 1)).toBeLessThan(2e-4);
  });
});
