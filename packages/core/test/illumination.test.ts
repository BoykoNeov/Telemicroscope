import { describe, it, expect } from "vitest";
import {
  abbeImage,
  annularSource,
  brightfieldResolutionMm,
  circleOverlapArea,
  coherentSource,
  cosineGratingObject,
  defocusedPupil,
  diskSource,
  gratingImage,
  idealPupil,
  imageHarmonic,
  incoherentTransfer,
  intensityCutoff,
  phaseGratingObject,
  uniformObject,
  weakObjectTransfer,
  weakObjectTransferDisk,
  weakPhaseTransfer,
} from "../src/illumination";
import { diffractionLimitedMtf } from "../src/wave/mtf";
import { pupilFunctionFromOpd, type PupilFunction } from "../src/wave/psf";
import { fitZernike } from "../src/wave/zernike";
import { opdMap } from "../src/pupil/opd";
import { pupilGrid } from "../src/pupil/aiming";
import { abbeResolutionMm } from "../src/pupil/microscope";
import { bestFocus, withFocus } from "../src/analysis/focus";
import { infinityCorrectedMicroscope, microscopeObjective, tubeLens } from "../src/designs/microscope";
import { listerObjective } from "../src/designs/lister";
import { LINE_D } from "../src/materials/dispersion";
import type { OpticalSystem } from "../src/trace/system";

/**
 * Rungs for brightfield illumination — docs/VALIDATION.md § 6f.
 *
 * The branch's first non-self-luminous imaging. Everything here is measured off
 * the Abbe source-point sum; the closed forms it is pinned to are the pupil's
 * own geometry (circle overlaps), never a coherence fudge factor.
 *
 * Frequency ν is in units of NA/λ throughout: ν = 1 is the coherent cutoff and
 * ν = 2 is `wave/mtf`'s incoherent cutoff 2·NA/λ.
 */

/** Largest ν at which the transfer is still non-zero, by bisection. */
function measuredCutoff(transfer: (nu: number) => number): number {
  let lo = 0.4;
  let hi = 2.6;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (transfer(mid) > 1e-9) lo = mid;
    else hi = mid;
  }
  return lo;
}

function maxTransferError(
  pupil: PupilFunction,
  S: number,
  samples: number,
  reference: (nu: number) => number,
  points = 40,
  span = 2,
): number {
  const source = diskSource(S, samples);
  let worst = 0;
  for (let k = 1; k <= points; k++) {
    const nu = (k / points) * span;
    worst = Math.max(worst, Math.abs(weakObjectTransfer(pupil, source, nu) - reference(nu)));
  }
  return worst;
}

function tracedPupil(system: OpticalSystem): { pupil: PupilFunction; rmsWaves: number } {
  const focus = bestFocus(system, "minRmsWavefront", { wavelengthNm: LINE_D });
  const map = opdMap(withFocus(system, focus.offsetFromLastVertex), 0, LINE_D, pupilGrid(21));
  const fit = fitZernike(map.samples, 28);
  return { pupil: pupilFunctionFromOpd(map, fit), rmsWaves: map.rmsWaves };
}

describe("the condenser as a set of directions (§ 6f.0)", () => {
  it("weights are a partition of the illumination", () => {
    for (const S of [0.25, 0.7, 1, 1.5]) {
      for (const N of [5, 16, 33]) {
        const total = diskSource(S, N).points.reduce((a, p) => a + p.weight, 0);
        expect(total).toBeCloseTo(1, 12);
      }
    }
  });

  it("one sample is the coherent limit, whatever S says", () => {
    const one = diskSource(0.8, 1);
    expect(one.points).toHaveLength(1);
    expect(one.points[0]!.sx).toBe(0);
    expect(one.points[0]!.sy).toBe(0);
    // Cell centres put the single sample on axis, so the degenerate case needs
    // no branch in the code and coherentSource() is the same object.
    expect(coherentSource().points[0]!.weight).toBe(1);
  });

  it("the lattice fills the disc — count → (π/4)·N²", () => {
    for (const N of [33, 65, 129]) {
      const fraction = diskSource(1, N).points.length / (N * N);
      expect(Math.abs(fraction - Math.PI / 4)).toBeLessThan(6e-3);
    }
    // The rim is the only place the count can be wrong, so the error is the
    // perimeter's share of the area and falls off like 1/N.
    expect(Math.abs(diskSource(1, 257).points.length / (257 * 257) - Math.PI / 4)).toBeLessThan(
      5e-4,
    );
  });

  it("rejects a source it cannot resolve", () => {
    expect(() => diskSource(-0.1)).toThrow(/coherenceParameter/);
    expect(() => diskSource(1, 0)).toThrow(/positive integer/);
    expect(() => annularSource(1.001, 1.0, 5)).toThrow(/no samples/);
  });
});

describe("the coherent limit: a plateau and a cliff (§ 6f.1)", () => {
  const pupil = idealPupil();
  const source = coherentSource();

  it("transfers everything below ν = 1 and nothing above", () => {
    for (const nu of [0.01, 0.25, 0.5, 0.75, 0.99]) {
      expect(weakObjectTransfer(pupil, source, nu)).toBeCloseTo(1, 12);
    }
    for (const nu of [1.001, 1.25, 1.9, 2.5]) {
      expect(weakObjectTransfer(pupil, source, nu)).toBe(0);
    }
  });

  it("cuts off at exactly NA/λ", () => {
    expect(measuredCutoff((nu) => weakObjectTransfer(pupil, source, nu))).toBeCloseTo(1, 9);
    expect(intensityCutoff(0)).toBe(1);
  });

  it("the plateau is the trade the diaphragm makes", () => {
    // Closing the condenser is not merely a loss. Just under the coherent
    // cutoff the plateau still delivers full contrast where a matched
    // condenser has already spent 60% of it — 2.5× the contrast, bought by
    // giving up everything between ν = 1 and ν = 2.
    expect(weakObjectTransfer(pupil, source, 0.99)).toBeCloseTo(1, 12);
    expect(incoherentTransfer(0.99)).toBeCloseTo(0.3965, 4);
    expect(weakObjectTransfer(pupil, source, 1.5)).toBe(0);
    expect(incoherentTransfer(1.5)).toBeGreaterThan(0.14);
  });
});

describe("the incoherent limit, reached exactly at S = 1 (§ 6f.2)", () => {
  const pupil = idealPupil();

  it("S = 1 reproduces § 2b's diffraction-limited MTF", () => {
    // The SAME closed form wave/mtf is pinned to — no second number is minted
    // for the incoherent end of this ladder. 129 source samples across the
    // diameter; the residual is the source's own discretization (§ 6f.5).
    expect(maxTransferError(pupil, 1, 129, incoherentTransfer, 20, 1.95)).toBeLessThan(1.1e-3);
  });

  it("and incoherentTransfer is diffractionLimitedMtf at half the frequency", () => {
    for (const nu of [0.1, 0.5, 1, 1.5, 1.9]) {
      expect(incoherentTransfer(nu)).toBe(diffractionLimitedMtf(nu / 2));
    }
  });

  it("opening the condenser past the objective buys nothing", () => {
    // Source points outside the pupil have no undiffracted beam to interfere
    // with, so they add no linear transfer at all.
    expect(maxTransferError(pupil, 1.5, 129, incoherentTransfer, 20, 1.95)).toBeLessThan(2.0e-3);
    expect(maxTransferError(pupil, 3, 129, incoherentTransfer, 20, 1.95)).toBeLessThan(4.5e-3);
    for (const S of [1.25, 1.5, 2, 3]) {
      const cutoff = measuredCutoff((nu) => weakObjectTransfer(pupil, diskSource(S, 65), nu));
      expect(cutoff).toBeLessThanOrEqual(2 + 1e-9);
      expect(cutoff).toBeGreaterThan(1.9);
    }
    expect(intensityCutoff(1.5)).toBe(2);
    expect(intensityCutoff(10)).toBe(2);
  });
});

describe("the whole curve, against the three-circle closed form (§ 6f.3)", () => {
  const pupil = idealPupil();

  it("circleOverlapArea is the lens area, with both degenerate ends", () => {
    expect(circleOverlapArea(0, 1, 1)).toBeCloseTo(Math.PI, 12);
    expect(circleOverlapArea(2, 1, 1)).toBe(0);
    expect(circleOverlapArea(0.2, 0.3, 1)).toBeCloseTo(Math.PI * 0.09, 12); // small circle swallowed
    // Two unit circles: the overlap IS the pupil autocorrelation, so dividing
    // by π has to give the diffraction-limited MTF.
    for (const d of [0.3, 0.9, 1.4, 1.8]) {
      expect(circleOverlapArea(d, 1, 1) / Math.PI).toBeCloseTo(diffractionLimitedMtf(d / 2), 12);
    }
  });

  it("the measured sum matches the closed form at every S", () => {
    // T(ν) = area(disc(0,S) ∩ disc(ν,1)) / πS² — the illumination directions
    // for which the direct beam and the order at ν both get through.
    for (const S of [0.25, 0.5, 0.75]) {
      const err = maxTransferError(pupil, S, 129, (nu) => weakObjectTransferDisk(S, nu), 40, 2);
      expect(err).toBeLessThan(1e-3);
    }
  });

  it("the closed form itself collapses to the two limits", () => {
    for (const nu of [0.1, 0.6, 1.2, 1.8]) {
      expect(weakObjectTransferDisk(0, nu)).toBe(nu < 1 ? 1 : 0);
      expect(weakObjectTransferDisk(1, nu)).toBeCloseTo(incoherentTransfer(nu), 12);
      expect(weakObjectTransferDisk(4, nu)).toBeCloseTo(incoherentTransfer(nu), 12);
    }
  });

  it("a plateau survives at finite S, out to ν = 1 − S — and it is exact", () => {
    // Below 1 − S every source point sees both orders, so nothing is lost and
    // the discretization cannot bite: this is 1, not approximately 1.
    for (const S of [0.2, 0.5, 0.8]) {
      const source = diskSource(S, 33);
      for (const f of [0.1, 0.5, 0.95]) {
        expect(weakObjectTransfer(pupil, source, f * (1 - S))).toBeCloseTo(1, 12);
      }
      // ...and past it, contrast is genuinely being spent.
      expect(weakObjectTransfer(pupil, source, 1 + S / 2)).toBeLessThan(0.5);
    }
  });
});

describe("the (NA_obj + NA_cond) law, measured (§ 6f.4)", () => {
  const pupil = idealPupil();

  it("the cutoff is 1 + S, to the source lattice's own last point", () => {
    // An odd sample count puts a row on the axis, so the outermost usable
    // direction is exactly S·(1 − 1/N) and the measured cutoff is
    // 1 + S·(1 − 1/N) — the law with its discretization written down rather
    // than absorbed into a tolerance. Extrapolating N → ∞ gives exactly 1 + S.
    for (const N of [17, 33, 65]) {
      for (const S of [0.25, 0.5, 0.75, 1]) {
        const cutoff = measuredCutoff((nu) => weakObjectTransfer(pupil, diskSource(S, N), nu));
        expect(cutoff).toBeCloseTo(1 + S * (1 - 1 / N), 9);
      }
    }
  });

  it("the cutoff is linear in S with unit slope", () => {
    const N = 65;
    const at = (S: number) => measuredCutoff((nu) => weakObjectTransfer(pupil, diskSource(S, N), nu));
    const lo = at(0.2);
    const hi = at(0.8);
    expect((hi - lo) / 0.6).toBeCloseTo(1 - 1 / N, 6);
  });

  it("d = λ/(NA_obj + NA_cond) reduces to the two textbook limits", () => {
    const lambda = 550;
    const NA = 0.65;
    // Condenser matched: Abbe's λ/(2·NA), the number pupil/microscope already
    // carries for a self-luminous specimen.
    expect(brightfieldResolutionMm(lambda, NA, NA)).toBeCloseTo(abbeResolutionMm(lambda, NA), 15);
    // Condenser closed to a pinhole: λ/NA — exactly twice as coarse. That
    // factor of two is what the diaphragm trades against contrast.
    expect(brightfieldResolutionMm(lambda, NA, 0)).toBeCloseTo(
      2 * abbeResolutionMm(lambda, NA),
      15,
    );
    expect(brightfieldResolutionMm(lambda, NA, 0.325)).toBeCloseTo(
      (lambda * 1e-6) / (NA + 0.325),
      15,
    );
    // And past a matched condenser it stops improving.
    expect(brightfieldResolutionMm(lambda, NA, 2 * NA)).toBeCloseTo(
      abbeResolutionMm(lambda, NA),
      15,
    );
  });
});

describe("the source is a sampling parameter, and it converges (§ 6f.5)", () => {
  const pupil = idealPupil();

  it("error against the closed form falls with the sample count", () => {
    // Only cells the pupil's rim cuts can be wrong, so the error is a
    // perimeter effect and the measured rate is around N^-1.3 — faster than
    // the O(1/N) a discontinuous integrand guarantees, because midpoint errors
    // of opposite sign partly cancel around the rim. It is NOT monotone
    // doubling-by-doubling (ratios run 1.85–4.7), so the rung pins the rate
    // over two doublings and the total, which is what converging means here.
    for (const S of [0.25, 0.5, 0.75]) {
      const errors = [8, 16, 32, 64, 128].map((N) =>
        maxTransferError(pupil, S, N, (nu) => weakObjectTransferDisk(S, nu), 20, 2),
      );
      for (let i = 1; i < errors.length; i++) {
        expect(errors[i]!).toBeLessThan(errors[i - 1]!);
      }
      for (let i = 2; i < errors.length; i++) {
        expect(errors[i]!).toBeLessThan(errors[i - 2]! / 3);
      }
      expect(errors[0]! / errors[4]!).toBeGreaterThan(30);
      expect(errors[4]!).toBeLessThan(1.5e-3);
    }
  });

  it("a coarse source is wrong by enough to notice", () => {
    // The failure mode this rung exists for: too few directions produce
    // structure in the transfer that looks like physics. At 5 across the
    // diameter it is a 4% error, which would pass unnoticed as "aberration".
    const err = maxTransferError(pupil, 0.5, 5, (nu) => weakObjectTransferDisk(0.5, nu), 20, 2);
    expect(err).toBeGreaterThan(0.03);
  });
});

describe("the FFT imager and the three-order sum are the same calculation (§ 6f.6)", () => {
  const pupil = idealPupil();
  const pupilSamples = 32;
  const size = 128;
  const source = diskSource(0.5, 11);

  it("image harmonics match the closed three-order evaluation", () => {
    const m = 0.02;
    for (const cycles of [4, 8, 12, 16, 20, 24]) {
      const nu = (2 * cycles) / pupilSamples;
      const image = abbeImage(cosineGratingObject({ size, cycles, modulation: m }), pupil, source, {
        pupilSamples,
      });
      const measured = imageHarmonic(image.intensity, size, cycles);
      const closed = gratingImage(pupil, source, nu, m);
      expect(measured.dc).toBeCloseTo(closed.dc, 12);
      expect(measured.amplitude).toBeCloseTo(closed.fundamental, 12);
    }
  });

  it("a clear field images as a clear field — exactly 1, not nearly", () => {
    const image = abbeImage(uniformObject(size), pupil, diskSource(0.7, 9), { pupilSamples });
    for (const v of image.intensity) expect(v).toBeCloseTo(1, 12);
  });

  it("a grating past the cutoff images as a blank field", () => {
    // 24 cycles at pupilSamples 32 is ν = 1.5, which is exactly (1 + S) here.
    const image = abbeImage(
      cosineGratingObject({ size, cycles: 24, modulation: 0.2 }),
      pupil,
      diskSource(0.5, 11),
      { pupilSamples },
    );
    const h = imageHarmonic(image.intensity, size, 24);
    expect(h.dc).toBeCloseTo(1, 6);
    expect(h.amplitude).toBeLessThan(1e-12);
  });
});

describe("partial coherence is nonlinear, and the image says so (§ 6f.7)", () => {
  const pupil = idealPupil();
  const source = diskSource(0.5, 33);
  const nu = 0.8;

  it("contrast/(2m) → the weak-object transfer as m → 0, and leaves it as m grows", () => {
    const T = weakObjectTransfer(pupil, source, nu);
    expect(gratingImage(pupil, source, nu, 1e-4).contrast / 2e-4).toBeCloseTo(T, 4);
    // At full modulation the ratio is 26% below it. There is no transfer
    // function here to multiply the object by: that is what partial coherence
    // costs, and why a "condenser factor" on the incoherent MTF would be a lie.
    const strong = gratingImage(pupil, source, nu, 1).contrast / 2;
    expect(strong).toBeLessThan(0.78 * T);
    expect(strong).toBeGreaterThan(0.7 * T);
  });

  it("a single-frequency object images with a second harmonic, growing as m²", () => {
    const a = gratingImage(pupil, source, nu, 1e-4).secondHarmonic;
    const b = gratingImage(pupil, source, nu, 1e-2).secondHarmonic;
    expect(a).toBeGreaterThan(0);
    expect(b / a).toBeCloseTo(1e4, -2);
    expect(b / a / 1e4).toBeCloseTo(1, 9);
  });
});

describe("a phase object is invisible, and that is the sum's doing (§ 6f.8)", () => {
  const source = diskSource(0.5, 33);

  it("an aberration-free pupil transfers no phase at all — a hard zero", () => {
    for (const S of [0, 0.3, 0.7, 1, 2]) {
      const src = S === 0 ? coherentSource() : diskSource(S, 21);
      for (const nu of [0.2, 0.6, 1.0, 1.4, 1.8]) {
        expect(Math.abs(weakPhaseTransfer(idealPupil(), src, nu))).toBeLessThan(1e-14);
      }
    }
  });

  it("defocus makes it appear, and refocusing makes it vanish again", () => {
    const nu = 0.6;
    const visible = weakPhaseTransfer(defocusedPupil(0.25), source, nu);
    expect(visible).toBeGreaterThan(0.3);
    // Continuous in the aberration, so it is the pupil being read and not a
    // switch: a tenth of the defocus leaves a tenth of the signal.
    const faint = weakPhaseTransfer(defocusedPupil(0.025), source, nu);
    expect(faint).toBeGreaterThan(0);
    expect(faint).toBeLessThan(visible / 5);
    expect(weakPhaseTransfer(defocusedPupil(0), source, nu)).toBeLessThan(1e-14);
  });

  it("and the full FFT image of a real phase grating agrees", () => {
    const size = 128;
    const pupilSamples = 32;
    const cycles = 6;
    const object = phaseGratingObject({ size, cycles, amplitudeRadians: 0.3 });
    const src = diskSource(0.5, 9);
    const focused = abbeImage(object, idealPupil(), src, { pupilSamples });
    expect(imageHarmonic(focused.intensity, size, cycles).amplitude).toBeLessThan(1e-12);
    const defocused = abbeImage(object, defocusedPupil(0.25), src, { pupilSamples });
    expect(imageHarmonic(defocused.intensity, size, cycles).amplitude).toBeGreaterThan(0.02);
    // In focus it is not *entirely* absent: the two orders still beat with each
    // other, so a pure phase grating leaves a residue at TWICE its frequency.
    // Nonlinear, weak, and real — it is what makes an unstained cell show faint
    // doubled edges rather than nothing at all.
    expect(imageHarmonic(focused.intensity, size, 2 * cycles).amplitude).toBeGreaterThan(1e-3);
  });
});

describe("darkfield falls out of the same sum (§ 6f.9)", () => {
  const size = 64;
  const pupilSamples = 16;
  const ring = annularSource(1.4, 1.2, 21);

  it("an annulus outside the pupil images a clear field as black", () => {
    // Every illuminating beam misses the objective, so an object that
    // diffracts nothing delivers nothing. Exactly zero, at every pixel.
    const image = abbeImage(uniformObject(size), idealPupil(), ring, { pupilSamples });
    expect(image.contributingPoints).toBe(ring.points.length);
    for (const v of image.intensity) expect(v).toBe(0);
  });

  it("and the phase object brightfield could not see is visible against it", () => {
    const object = phaseGratingObject({ size, cycles: 4, amplitudeRadians: 0.3 });
    const dark = abbeImage(object, idealPupil(), ring, { pupilSamples });
    const bright = abbeImage(object, idealPupil(), diskSource(0.7, 9), { pupilSamples });
    const darkMean = imageHarmonic(dark.intensity, size, 4).dc;
    const brightMean = imageHarmonic(bright.intensity, size, 4).dc;
    // Faint in absolute terms — 1% of the brightfield mean — but it sits on a
    // black background, which is the whole trick.
    expect(darkMean).toBeGreaterThan(1e-3);
    expect(darkMean).toBeLessThan(0.05 * brightMean);
  });
});

describe("a traced objective, through its own pupil (§ 6f.10)", () => {
  const source = diskSource(0.6, 33);
  const predictedCutoff = 1 + 0.6 * (1 - 1 / 33);

  const low = tracedPupil(
    infinityCorrectedMicroscope({
      objective: microscopeObjective({ magnification: 4, numericalAperture: 0.1 }),
      tubeLens: tubeLens(),
    }).system,
  );
  const lister = tracedPupil(
    infinityCorrectedMicroscope({
      objective: listerObjective({ magnification: 20, numericalAperture: 0.25 }),
      tubeLens: tubeLens(),
    }).system,
  );

  it("the cutoff is geometric — aberration does not move it", () => {
    // Same lattice-exact 1 + S·(1 − 1/N) as the ideal pupil. Aberrations move
    // contrast around below the cutoff; they never extend or shorten it, which
    // is wave/mtf's statement arriving in the partially coherent case.
    for (const p of [low.pupil, lister.pupil]) {
      expect(measuredCutoff((nu) => weakObjectTransfer(p, source, nu))).toBeCloseTo(
        predictedCutoff,
        9,
      );
    }
  });

  it("contrast falls below the ideal pupil, and in wavefront order", () => {
    const ideal = idealPupil();
    expect(low.rmsWaves).toBeLessThan(lister.rmsWaves); // 0.031 vs 0.070 waves
    for (const nu of [0.2, 0.5, 0.9, 1.2]) {
      const perfect = weakObjectTransfer(ideal, source, nu);
      const a = weakObjectTransfer(low.pupil, source, nu);
      const b = weakObjectTransfer(lister.pupil, source, nu);
      expect(a).toBeLessThan(perfect);
      expect(b).toBeLessThan(a);
      expect(b).toBeGreaterThan(0);
    }
  });

  it("and the condenser still buys resolution on a real lens", () => {
    const closed = coherentSource();
    const open = diskSource(1, 33);
    for (const p of [low.pupil, lister.pupil]) {
      expect(measuredCutoff((nu) => weakObjectTransfer(p, closed, nu))).toBeCloseTo(1, 9);
      expect(measuredCutoff((nu) => weakObjectTransfer(p, open, nu))).toBeGreaterThan(1.9);
    }
  });
});
