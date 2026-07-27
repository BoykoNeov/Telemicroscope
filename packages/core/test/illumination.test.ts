import { describe, it, expect } from "vitest";
import {
  abbeImage,
  annularSource,
  brightfieldFidelity,
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
  spatialFrequencyCyclesPerMm,
  weakObjectTransferDisk,
  weakPhaseTransfer,
  type ObjectField,
} from "../src/illumination";
import { diffractionLimitedMtf, mtf, mtfAt } from "../src/wave/mtf";
import {
  imagePixelScaleMm,
  psf,
  psfFromPupilFunction,
  pupilFunctionFromOpd,
  type PupilFunction,
  type PupilScale,
} from "../src/wave/psf";
import { adaptivePsf, geometricWeight } from "../src/wave/geometric";
import { PHASE_STEP_LIMIT } from "../src/wave/fidelity";
import type { Prescription } from "../src/trace/prescription";
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

  it("refuses a grid too small to hold the shifted pupil", () => {
    // Clamping the box instead would truncate the pupil, and a truncated pupil
    // is indistinguishable from a smaller aperture — a silent coverage cap that
    // would read as physics. Needs size ≥ pupilSamples·(1 + S): 64 × 1.7 = 109.
    expect(() =>
      abbeImage(uniformObject(64), pupil, diskSource(0.7, 5), { pupilSamples: 64 }),
    ).toThrow(/runs off a 64-bin frequency grid/);
    // ...and the same call on a grid that fits does not throw.
    expect(() =>
      abbeImage(uniformObject(128), pupil, diskSource(0.7, 5), { pupilSamples: 64 }),
    ).not.toThrow();
  });
});

describe("partial coherence is nonlinear, and the image says so (§ 6f.7)", () => {
  const pupil = idealPupil();
  const source = diskSource(0.5, 33);
  const nu = 0.8;

  /** Modulation of |t|² for t = 1 + m·cos: the object's OWN intensity contrast. */
  const objectIntensityContrast = (m: number) => (2 * m) / (1 + (m * m) / 2);

  it("the transfer is a limit, not a description", () => {
    const T = weakObjectTransfer(pupil, source, nu);
    // Dividing by the object's own intensity contrast rather than by 2m, so
    // what is left is optics and not arithmetic: 1 + m²/2 is computable
    // without knowing anything about a pupil.
    const ratio = (m: number) => gratingImage(pupil, source, nu, m).contrast / objectIntensityContrast(m);
    expect(ratio(1e-4)).toBeCloseTo(T, 6);
    // It then walks AWAY from T as the object strengthens — 11% above it at
    // full modulation. There is no function to multiply the object by, which
    // is exactly why a condenser factor on the incoherent MTF would be a lie.
    expect(ratio(0.3) / T).toBeCloseTo(1.013, 3);
    expect(ratio(1) / T).toBeCloseTo(1.112, 3);
  });

  it("a single-frequency object images with a second harmonic, growing as m²", () => {
    const a = gratingImage(pupil, source, nu, 1e-4).secondHarmonic;
    const b = gratingImage(pupil, source, nu, 1e-2).secondHarmonic;
    expect(a).toBeGreaterThan(0);
    expect(b / a).toBeCloseTo(1e4, -2);
    expect(b / a / 1e4).toBeCloseTo(1, 9);
  });

  it("and that harmonic lands ABOVE the linear cutoff — spurious resolution", () => {
    // S = 0.5, so nothing is linearly transferred past ν = 1.5. A grating at
    // ν = 0.8125 nevertheless puts a component at 1.625 into the image, where
    // the linear transfer is exactly zero. Detail above the cutoff, and not
    // detail that was in the object at that frequency: the classic false
    // resolution of a partially coherent microscope.
    const nuHigh = 0.8125;
    expect(intensityCutoff(0.5)).toBe(1.5);
    expect(weakObjectTransfer(pupil, source, 2 * nuHigh)).toBe(0);
    expect(gratingImage(pupil, source, nuHigh, 1).secondHarmonic).toBeGreaterThan(0.15);

    // The full FFT imager puts it in a real image at the same strength — the
    // two paths agree on the artifact, not just on the physics they were
    // designed for.
    const size = 128;
    const pupilSamples = 32;
    const cycles = 13; // ν = 26/32 = 0.8125
    const image = abbeImage(
      cosineGratingObject({ size, cycles, modulation: 1 }),
      pupil,
      diskSource(0.5, 11),
      { pupilSamples },
    );
    const closed = gratingImage(pupil, diskSource(0.5, 11), (2 * cycles) / pupilSamples, 1);
    expect(imageHarmonic(image.intensity, size, 2 * cycles).amplitude).toBeCloseTo(
      closed.secondHarmonic,
      12,
    );

    // It does NOT reach past 2, though: the harmonic needs both orders inside
    // the pupil, which is the same autocorrelation ceiling everything else in
    // this step runs into.
    expect(gratingImage(pupil, source, 1.05, 1).secondHarmonic).toBe(0);
  });
});

describe("the frequency axis is the engine's, not this module's (§ 6f.11)", () => {
  // ν is defined here in units of NA/λ, and the whole step's meaning rests on
  // that being the SAME axis wave/mtf measures cycles/mm on. Nothing above
  // touches cycles/mm — both computation paths share the ν convention, so a
  // factor-of-two error in it would leave every closed-form comparison
  // passing. These two rungs are the bridge, and they exist because § 3c's
  // kernel-orientation drift was exactly this shape.
  const scale: PupilScale = { referenceRadius: 100, exitRadius: 5, wavelengthNm: 550, nImage: 1 };

  it("bin pupilSamples on an Abbe grid IS 2·NA/λ, exactly", () => {
    for (const pupilSamples of [32, 64]) {
      for (const padFactor of [2, 4]) {
        const size = pupilSamples * padFactor;
        const perBin = 1 / (size * imagePixelScaleMm(scale, size, pupilSamples));
        expect(pupilSamples * perBin).toBeCloseTo(spatialFrequencyCyclesPerMm(2, scale), 9);
        // ...and that is the number wave/mtf reports as its own cutoff.
        const p = psfFromPupilFunction(idealPupil(), scale, 0, { pupilSamples, padFactor });
        expect(mtf(p).cutoffCyclesPerMm).toBeCloseTo(spatialFrequencyCyclesPerMm(2, scale), 9);
      }
    }
  });

  it("the same pupil, through the PSF and through the sum, gives one curve", () => {
    // ONE PupilFunction object goes into wave/psf → wave/mtf and into the Abbe
    // sum at S = 1. Independent implementations, independent grids; a mislabeled
    // ν would show up here as a curve of the wrong shape, not a small offset.
    const pupil = idealPupil();
    const psfMtf = mtf(psfFromPupilFunction(pupil, scale, 0, { pupilSamples: 64, padFactor: 4 }));
    const source = diskSource(1, 129);
    let worst = 0;
    for (const nuMtf of [0.1, 0.2, 0.4, 0.6, 0.8, 0.9]) {
      const viaPsf = mtfAt(psfMtf, nuMtf, 64);
      const viaAbbe = weakObjectTransfer(pupil, source, 2 * nuMtf);
      worst = Math.max(worst, Math.abs(viaPsf - viaAbbe));
      // Each also sits on the closed form from its own side, which is what
      // says the residual is two discretizations and not a convention.
      expect(viaAbbe).toBeCloseTo(diffractionLimitedMtf(nuMtf), 3);
    }
    expect(worst).toBeLessThan(1e-2);
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

/**
 * A spherical mirror, opened until its own aberration outruns the pupil grid.
 * The same shape `test/fidelity.ts` uses, and for the same reason: spherical
 * aberration is the cheapest way to drive the phase step across the criterion
 * without inventing a wavefront by hand.
 */
const MIRROR_R = -200;
function sphericalMirror(semiAperture: number): OpticalSystem {
  const prescription: Prescription = {
    surfaces: [
      {
        kind: "reflect",
        curvature: 1 / MIRROR_R,
        conic: 0,
        semiAperture,
        thickness: MIRROR_R / 2,
        isStop: true,
      },
    ],
  };
  return {
    prescription,
    aperture: { kind: "stopRadius", value: semiAperture },
    field: { kind: "angle", values: [0] },
    wavelengths: [{ nm: LINE_D, weight: 1 }],
    conjugate: { kind: "infinite" },
  };
}

describe("the geometric branch has no coherence, so brightfield rules instead of blending (§ 6f.12)", () => {
  /**
   * Every PSF in the engine has two branches and a cross-fade between them.
   * Brightfield has one branch and cannot have two: a ray histogram carries no
   * phase, so it cannot represent the interference the Abbe sum exists to
   * represent. Falling back to it would not degrade partial coherence, it would
   * silently answer a different question.
   *
   * So the deferral stands — there is no partially coherent geometric branch —
   * and what lands here is the detection that stops it being missed, exactly as
   * § 5d left the seeing ∇φ ray-tilt unbuilt and pinned the guard that catches
   * the trap it springs.
   */

  it("absent sampling is unknown, and never quietly valid", () => {
    const bare = brightfieldFidelity(undefined, 64);
    expect(bare.verdict).toBe("unknown");
    expect(bare.verdict).not.toBe("valid");
    expect(bare.phaseStepWaves).toBeNull();
    expect(bare.geometricShare).toBeNull();

    // This is not a hypothetical branch. `psfFromPupilFunction` is handed a
    // pupil with no memory of what traced it, and that is precisely the shape
    // `abbeImage` is called in — so the case the deferral is about is the
    // DEFAULT case, not an edge one. `adaptivePsf` reads a missing sampling as
    // a phase step of zero, which is right there (it is only ever reached from
    // a fresh trace) and would be the whole bug here.
    const scale: PupilScale = { referenceRadius: 100, exitRadius: 5, wavelengthNm: 550, nImage: 1 };
    const fromPupil = psfFromPupilFunction(idealPupil(), scale, 0, { pupilSamples: 64 });
    expect(fromPupil.sampling).toBeUndefined();
    expect(brightfieldFidelity(fromPupil.sampling, 64).verdict).toBe("unknown");
  });

  it("a well-corrected objective passes, and § 6f.10's rungs keep standing", () => {
    // The 4×/0.10 whose traced pupil the block above images through: 0.015
    // waves per pupil sample, thirty times inside the criterion. Every § 6f
    // number measured on a traced pupil is on the FFT branch by a wide margin,
    // which is what makes this deferral a named gap rather than a live wound.
    const sys = infinityCorrectedMicroscope({
      objective: microscopeObjective({ magnification: 4, numericalAperture: 0.1 }),
      tubeLens: tubeLens(),
    }).system;
    const focused = withFocus(sys, bestFocus(sys, "minRmsWavefront", { wavelengthNm: LINE_D }).offsetFromLastVertex);
    const verdict = brightfieldFidelity(psf(focused, 0, LINE_D, { pupilSamples: 64 }).sampling, 64);
    expect(verdict.verdict).toBe("valid");
    expect(verdict.geometricShare).toBe(0);
    expect(verdict.phaseStepWaves!).toBeLessThan(0.02);
  });

  it("it is adaptivePsf's own switch read a second time, not a second switch", () => {
    // One criterion, two callers. If these ever disagreed, a brightfield image
    // could be declared honest on a wavefront the PSF had already given to the
    // ray branch — which is the exact failure the deferral names.
    for (const semiAperture of [10, 20]) {
      const system = sphericalMirror(semiAperture);
      const verdict = brightfieldFidelity(psf(system, 0, LINE_D, { pupilSamples: 64 }).sampling, 64);
      const adaptive = adaptivePsf(system, 0, LINE_D, { pupilSamples: 64 });
      expect(verdict.phaseStepWaves).toBe(adaptive.phaseStepWaves);
      expect(verdict.geometricShare).toBe(adaptive.geometricWeight);
    }
    // 10 mm of semi-aperture is 0.057 waves per sample and images; 20 mm is
    // 0.908, which is past the far edge of the blend band, so the PSF is a pure
    // ray histogram and brightfield has nothing at all to say.
    const easy = brightfieldFidelity(psf(sphericalMirror(10), 0, LINE_D, { pupilSamples: 64 }).sampling, 64);
    const hard = brightfieldFidelity(psf(sphericalMirror(20), 0, LINE_D, { pupilSamples: 64 }).sampling, 64);
    expect(easy.verdict).toBe("valid");
    expect(easy.phaseStepWaves!).toBeCloseTo(0.0570608, 6);
    expect(hard.verdict).toBe("no-honest-image");
    expect(hard.geometricShare).toBe(1);
  });

  it("inside the blend band the PSF degrades and brightfield falls off a cliff", () => {
    // The band is the whole point of the asymmetry. At 0.454 waves per sample
    // `adaptivePsf` mixes 27.8% ray histogram into a still-mostly-diffraction
    // image and stays honest, because both its branches compute the same
    // intensity. There is no 27.8%-coherent sum to mix, so ANY share above zero
    // is a refusal here — the verdict is a cliff exactly where the PSF's is a
    // ramp, and that difference IS the missing capability, made visible.
    const sampling = psf(sphericalMirror(20), 0, LINE_D, { pupilSamples: 128 }).sampling;
    const banded = brightfieldFidelity(sampling, 128);
    expect(banded.phaseStepWaves!).toBeGreaterThan(PHASE_STEP_LIMIT - 0.15);
    expect(banded.phaseStepWaves!).toBeLessThan(PHASE_STEP_LIMIT + 0.15);
    expect(banded.geometricShare).toBe(geometricWeight(banded.phaseStepWaves!));
    expect(banded.geometricShare!).toBeCloseTo(0.2778, 4);
    expect(banded.geometricShare!).toBeGreaterThan(0);
    expect(banded.verdict).toBe("no-honest-image");
  });

  it("and a denser pupil grid genuinely rescues the same system", () => {
    // The criterion is phase per pupil SAMPLE, so it is a statement about the
    // grid as much as the glass — `wave/fidelity` is insistent that a metric
    // phrased in total waves would deny this. One traced wavefront, six grids:
    // the step falls exactly as 1/pupilSamples and the verdict follows it.
    const sampling = psf(sphericalMirror(20), 0, LINE_D, { pupilSamples: 64 }).sampling;
    const at = (p: number) => brightfieldFidelity(sampling, p);
    expect(at(64).verdict).toBe("no-honest-image");
    expect(at(128).verdict).toBe("no-honest-image");
    expect(at(256).verdict).toBe("valid");
    expect(at(512).verdict).toBe("valid");
    expect(at(128).phaseStepWaves! / at(64).phaseStepWaves!).toBeCloseTo(0.5, 12);
    expect(at(512).phaseStepWaves! / at(64).phaseStepWaves!).toBeCloseTo(0.125, 12);
  });
});

/** Opaque field with one clear pixel at the centre — a pinhole, spectrally flat. */
function pinholeObject(size: number): ObjectField {
  const re = new Float64Array(size * size);
  re[(size / 2) * size + size / 2] = 1;
  return { size, re, im: new Float64Array(size * size) };
}

/** Opaque field with a clear bar `width` px wide, centred. Broadband. */
function clearBarObject(size: number, width: number): ObjectField {
  const re = new Float64Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = size / 2 - width / 2; x < size / 2 + width / 2; x++) re[y * size + x] = 1;
  }
  return { size, re, im: new Float64Array(size * size) };
}

/** Fraction of the image's energy inside radius `r` of the grid centre. */
function encircledFraction(intensity: Float64Array, size: number, r: number): number {
  const c = size / 2;
  let inside = 0;
  let total = 0;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const v = intensity[y * size + x]!;
      total += v;
      if (Math.hypot(x - c, y - c) <= r) inside += v;
    }
  }
  return inside / total;
}

describe("and the sum's own lattice reports whether it carried the pupil (§ 6f.13)", () => {
  /**
   * The companion question, and a different one: not "is a coherent sum the
   * right physics here" (§ 6f.12) but "did this grid resolve the pupil it was
   * handed". `wave/psf` reports the same number for its own grid; this is it
   * measured on the lattice the Abbe sum actually evaluates, which every source
   * point reads at its own offset.
   *
   * Lattice step in normalized pupil radii is h = 2/pupilSamples, so a defocus
   * W·ρ² steps by W·((ρ+h)² − ρ²) = W·h·(2ρ + h) between neighbours. Both ends
   * must transmit, and because 1/h is an integer the outermost transmitting
   * pair on the row through ρ_y = 0 is exactly (1 − h, 1). So
   *
   *     max step = W·h·(2 − h) = (4W/pupilSamples)·(1 − 1/pupilSamples)
   *
   * exactly — not a bound. The (1 − 1/pupilSamples) is a difference quotient
   * estimating a derivative at the MIDPOINT of its pair, half a lattice step
   * inside the rim: the same finite-difference factor § 5d's gradient rung
   * carries, arriving here from the same cause.
   */

  const guardClosedForm = (W: number, pupilSamples: number): number => {
    const h = 2 / pupilSamples;
    return W * h * (2 - h);
  };

  it("an unaberrated pupil steps nowhere", () => {
    const img = abbeImage(uniformObject(256), idealPupil(), diskSource(0.7, 9), {
      pupilSamples: 64,
    });
    expect(img.maxGridPhaseStepWaves).toBe(0);
  });

  it("defocus lands on the closed form exactly, at every grid and every strength", () => {
    for (const pupilSamples of [16, 32, 64, 128]) {
      for (const W of [0.5, 3, 12]) {
        const img = abbeImage(uniformObject(256), defocusedPupil(W), coherentSource(), {
          pupilSamples,
        });
        expect(img.maxGridPhaseStepWaves).toBeCloseTo(guardClosedForm(W, pupilSamples), 12);
        // The naive derivative 4W/pupilSamples is approached from BELOW, and by
        // exactly the midpoint factor — an identity, so it is pinned as one.
        expect(img.maxGridPhaseStepWaves / ((4 * W) / pupilSamples)).toBeCloseTo(
          1 - 1 / pupilSamples,
          12,
        );
      }
    }
  });

  it("and crosses the half-wave criterion where the closed form says", () => {
    // W·h·(2 − h) = ½ solves to W = pupilSamples²/(8·(pupilSamples − 1)).
    for (const pupilSamples of [32, 64, 128]) {
      const critical = pupilSamples ** 2 / (8 * (pupilSamples - 1));
      const at = (W: number) =>
        abbeImage(uniformObject(512), defocusedPupil(W), coherentSource(), { pupilSamples })
          .maxGridPhaseStepWaves;
      expect(at(critical)).toBeCloseTo(PHASE_STEP_LIMIT, 12);
      expect(at(critical * 0.99)).toBeLessThan(PHASE_STEP_LIMIT);
      expect(at(critical * 1.01)).toBeGreaterThan(PHASE_STEP_LIMIT);
    }
  });

  it("every source point reads the pupil on its own sub-lattice", () => {
    // Illuminating from s samples the pupil at (ix − n/2)·h + s, so each
    // direction registers differently against the rim where the max lives.
    // Reporting the max over the source is therefore a choice, and this bounds
    // what it costs: px_max ∈ (1 − 2h, 1 − h], so the spread across directions
    // is at most W·h·(2h) = 2W·h². Nothing here claims a DIRECTION — the
    // registration is not monotone in |s|, and for this pupil the on-axis point
    // happens to be the maximum.
    const pupilSamples = 64;
    const W = 3;
    const h = 2 / pupilSamples;
    const disk = diskSource(0.8, 9);
    const single = disk.points.map(
      (p) =>
        abbeImage(
          uniformObject(256),
          defocusedPupil(W),
          { points: [{ sx: p.sx, sy: p.sy, weight: 1 }], coherenceParameter: 0, samples: 1 },
          { pupilSamples },
        ).maxGridPhaseStepWaves,
    );
    const whole = abbeImage(uniformObject(256), defocusedPupil(W), disk, { pupilSamples })
      .maxGridPhaseStepWaves;
    expect(whole).toBe(Math.max(...single));
    expect(Math.max(...single) - Math.min(...single)).toBeLessThan(2 * W * h * h);
    // Measured spread is 0.38 of that bound — comfortably inside, not against it.
    expect(Math.max(...single) - Math.min(...single)).toBeCloseTo(0.00221354, 8);
  });

  it("the same pupil through two modules gives one number", () => {
    // `wave/psf` area-averages the cells the rim cuts; this module point-samples
    // them (its header says why). So this module's transmitting set is a strict
    // SUBSET of the PSF's, and a maximum over a subset can only be smaller: the
    // inequality is exact, not a tolerance. That the two coincide here is a
    // measured fact and not the theorem — the PSF's extra rim ring has no pair
    // of its own on the row through the centre, because 1/h being an integer
    // already put a lattice point on ρ = 1.
    const scale: PupilScale = { referenceRadius: 100, exitRadius: 5, wavelengthNm: 550, nImage: 1 };
    for (const pupilSamples of [16, 32, 64, 128]) {
      const pupil = defocusedPupil(3);
      const viaAbbe = abbeImage(uniformObject(pupilSamples * 4), pupil, coherentSource(), {
        pupilSamples,
      }).maxGridPhaseStepWaves;
      const viaPsf = psfFromPupilFunction(pupil, scale, 0, {
        pupilSamples,
        padFactor: 4,
      }).maxGridPhaseStepWaves;
      expect(viaAbbe).toBeLessThanOrEqual(viaPsf);
      expect(viaAbbe).toBeCloseTo(viaPsf, 12);
    }
  });

  it("half a wave per sample IS the point where the spread reaches the grid edge", () => {
    // The criterion's physical content, pinned rather than asserted. A slope of
    // s waves per pupil sample displaces a ray by s·size pixels (`defaultRayGrid`
    // rests on the same identity), so s = ½ puts it at size/2 — the edge. The
    // geometric radius of a defocused spot is R = 4W·size/pupilSamples pixels,
    // and the guard predicts it short by the midpoint factor.
    const W = 12;
    for (const pupilSamples of [64, 128, 256]) {
      const size = 2 * pupilSamples;
      const img = abbeImage(pinholeObject(size), defocusedPupil(W), coherentSource(), {
        pupilSamples,
      });
      const geometricRadiusPx = (4 * W * size) / pupilSamples;
      expect(geometricRadiusPx).toBe(96); // same physical blur on all three grids
      expect(img.maxGridPhaseStepWaves * size).toBeCloseTo(
        geometricRadiusPx * (1 - 1 / pupilSamples),
        12,
      );
    }
  });

  it("...and a broadband object is right on one side of it and wrong on the other", () => {
    // A pinhole has a flat spectrum, so this is the coherent point-spread
    // itself. Far from focus it is a uniform disc, and a uniform disc puts
    // exactly ¼ of its energy inside half its radius — a closed form owing
    // nothing to the engine. Where the disc fits the grid the sum finds it; where
    // it does not, the wrap folds the outside back onto the middle and the same
    // measurement reads 30% high.
    const W = 12;
    const halfRadius = 48; // half of the 96 px geometric radius, on every grid
    const measured = [64, 128, 256].map((pupilSamples) => {
      const size = 2 * pupilSamples;
      const img = abbeImage(pinholeObject(size), defocusedPupil(W), coherentSource(), {
        pupilSamples,
      });
      return { pupilSamples, size, img, e: encircledFraction(img.intensity, size, halfRadius) };
    });

    for (const m of measured) {
      // The wrap threshold in the guard's own terms, carrying the same midpoint
      // factor: R > size/2 ⟺ guard > ½·(1 − 1/pupilSamples).
      const fits = m.img.maxGridPhaseStepWaves <= PHASE_STEP_LIMIT * (1 - 1 / m.pupilSamples);
      expect(fits).toBe(96 <= m.size / 2);
      if (fits) {
        expect(m.e).toBeCloseTo(0.25, 2); // the geometric disc, to 2%
      } else {
        expect(m.e).toBeGreaterThan(0.32); // 0.330 — the folded-back energy
      }
    }
    // And the two grids that resolve it agree with each other far better than
    // either agrees with the one that does not.
    const [bad, ok, better] = measured.map((m) => m.e) as [number, number, number];
    expect(Math.abs(better - ok) / ok).toBeLessThan(2e-3);
    expect(Math.abs(bad - better) / better).toBeGreaterThan(0.29);
  });

  it("a partially coherent image converges only once the guard is under a half", () => {
    // The same statement with a condenser and a real specimen: a clear bar, S =
    // 0.5, twelve waves of defocus. Physical pixel scale is held fixed (size =
    // 2·pupilSamples throughout), ν is not in play because the object is
    // broadband, and the source is identical at every grid — so the only thing
    // moving is whether the lattice carries the pupil.
    const W = 12;
    const source = diskSource(0.5, 5);
    const offsets = [0, 8, 16, 32, 48, 60];
    const profile = (pupilSamples: number): { guard: number; values: number[] } => {
      const size = 2 * pupilSamples;
      const img = abbeImage(clearBarObject(size, 16), defocusedPupil(W), source, { pupilSamples });
      const c = size / 2;
      return {
        guard: img.maxGridPhaseStepWaves,
        values: offsets.map((d) => img.intensity[c * size + c + d]!),
      };
    };
    const coarse = profile(64); // guard 0.738 — over
    const fine = profile(128); // guard 0.372 — under
    const finest = profile(256); // guard 0.187 — well under
    expect(coarse.guard).toBeGreaterThan(PHASE_STEP_LIMIT);
    expect(fine.guard).toBeLessThan(PHASE_STEP_LIMIT);

    // Converged: the two resolved grids agree everywhere across the profile.
    for (let i = 0; i < offsets.length; i++) {
      expect(Math.abs(fine.values[i]! - finest.values[i]!) / finest.values[i]!).toBeLessThan(5e-3);
    }
    // Not converged: the unresolved grid is 13% out in the bar's skirt and 57%
    // out in its tail — the error grows with distance from the object, which is
    // what wrap-around does and what a mere loss of resolution does not.
    expect(Math.abs(coarse.values[4]! - finest.values[4]!) / finest.values[4]!).toBeGreaterThan(0.12);
    expect(Math.abs(coarse.values[5]! - finest.values[5]!) / finest.values[5]!).toBeGreaterThan(0.5);
  });

  it("and it is the guard deciding, not the grid being small", () => {
    // The control the rung above needs. One wave of defocus on the SAME grids,
    // including the 64-pixel one that failed catastrophically at twelve: every
    // grid now agrees to 3·10⁻³, because every guard is far under the criterion.
    // A rung that only ever showed coarse grids doing worse would be measuring
    // sampling, not fidelity.
    const source = diskSource(0.5, 5);
    const at = (pupilSamples: number) => {
      const size = 2 * pupilSamples;
      const img = abbeImage(clearBarObject(size, 16), defocusedPupil(1), source, { pupilSamples });
      const c = size / 2;
      return { guard: img.maxGridPhaseStepWaves, centre: img.intensity[c * size + c]!, skirt: img.intensity[c * size + c + 8]! };
    };
    const all = [32, 64, 128, 256].map(at);
    const reference = all[3]!;
    for (const m of all) {
      expect(m.guard).toBeLessThan(0.13);
      expect(Math.abs(m.centre - reference.centre) / reference.centre).toBeLessThan(3e-3);
      expect(Math.abs(m.skirt - reference.skirt) / reference.skirt).toBeLessThan(3e-3);
    }
  });

  it("a three-line object never trips it, and that is not a hole in the guard", () => {
    // Worth pinning because it says what the number does NOT mean, and because
    // every other § 6f rung is a grating. A cosine grating's spectrum is three
    // lattice lines, so the sum only ever evaluates the pupil at three points
    // per source direction — there is nothing between them to alias. Twelve
    // waves of defocus, a guard running 1.45 → 0.19, and the contrast is the
    // same to nine places at every grid.
    const W = 12;
    const source = diskSource(0.5, 5);
    const contrasts = [32, 64, 128, 256].map((pupilSamples) => {
      const size = 2 * pupilSamples;
      const cycles = pupilSamples / 4; // ν = 2·cycles/pupilSamples = 0.5, fixed
      const img = abbeImage(
        cosineGratingObject({ size, cycles, modulation: 0.5 }),
        defocusedPupil(W),
        source,
        { pupilSamples },
      );
      return { guard: img.maxGridPhaseStepWaves, contrast: imageHarmonic(img.intensity, size, cycles).contrast };
    });
    expect(contrasts[0]!.guard).toBeGreaterThan(1.4);
    expect(contrasts[3]!.guard).toBeLessThan(0.19);
    for (const c of contrasts) expect(c.contrast).toBeCloseTo(contrasts[3]!.contrast, 9);
    // So § 6f's grating ladder is untouched by any of this: the guard is a
    // statement about broadband objects, which is exactly the class the scenes
    // (diatoms, tissue) will belong to and the gratings never did.
  });
});
