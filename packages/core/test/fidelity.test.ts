import { describe, it, expect } from "vitest";
import { OpticalSystem } from "../src/trace/system";
import { Prescription } from "../src/trace/prescription";
import { opdMap } from "../src/pupil/opd";
import { pupilGrid } from "../src/pupil/aiming";
import { fitZernike } from "../src/wave/zernike";
import { opdSampling, phaseStepPerSample, fftBranchIsValid } from "../src/wave/fidelity";
import { LINE_D } from "../src/materials/dispersion";

/**
 * Rungs for the fidelity criterion — the quantity that will decide, per field
 * point, whether the FFT PSF or the geometric PSF is the honest answer.
 *
 * Worth pinning carefully rather than eyeballing, because a switch that fails
 * silently fails in the direction of *looking fine*: it would hand back a
 * confidently-wrong diffraction pattern instead of falling back.
 */

const R = -200;

function mirror(semiAperture: number, conic: number, imageOffset?: number): OpticalSystem {
  const prescription: Prescription = {
    surfaces: [
      {
        kind: "reflect",
        curvature: 1 / R,
        conic,
        semiAperture,
        thickness: R / 2,
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
    ...(imageOffset === undefined ? {} : { imageSurface: { offsetFromLastVertex: imageOffset } }),
  };
}

const APERTURE = 10;
const NA = APERTURE / Math.abs(R / 2);

/**
 * Rung: the measured wavefront gradient matches the closed form.
 *
 * Defocus by δ gives W(ρ) = a·ρ² waves with a = ½·δ·NA²/λ, so |dW/dρ| = 2a at
 * the rim. The engine measures that by differencing neighbouring traced
 * samples, and a difference quotient over a span of `spacing` estimates the
 * derivative at the MIDPOINT of the pair — half a spacing inside the rim. So
 * the closed form to compare against is
 *
 *     measured ≈ 2a·(1 − spacing/2)
 *
 * and the residual after that correction is second order in the spacing. This
 * is a real property of a finite-difference estimator, not a fudge: the
 * companion rung below shows the correction vanishing as the grid refines.
 */
describe("the wavefront gradient matches the closed form for defocus", () => {
  for (const delta of [0.02, 0.05, 0.1]) {
    it(`δ = ${delta} mm gives |∇W| = 2a·(1 − spacing/2)`, () => {
      const map = opdMap(mirror(APERTURE, -1, R / 2 - delta), 0, LINE_D, pupilGrid(21));
      const s = opdSampling(map);
      const a = (0.5 * delta * NA * NA) / (LINE_D * 1e-6);
      const expected = 2 * a * (1 - s.spacing / 2);
      expect(s.maxGradientWavesPerRadius / expected).toBeGreaterThan(0.99);
      expect(s.maxGradientWavesPerRadius / expected).toBeLessThan(1.01);
    });
  }

  it("the finite-difference bias vanishes as the trace grid refines", () => {
    const delta = 0.05;
    const a = (0.5 * delta * NA * NA) / (LINE_D * 1e-6);
    const ratios = [21, 31, 41, 61].map((n) => {
      const s = opdSampling(opdMap(mirror(APERTURE, -1, R / 2 - delta), 0, LINE_D, pupilGrid(n)));
      return s.maxGradientWavesPerRadius / (2 * a);
    });
    // Monotone approach to 1 from below — the signature of a midpoint offset
    // rather than a wrong scale, which would sit at a constant ratio.
    for (let i = 1; i < ratios.length; i++) {
      expect(ratios[i]!).toBeGreaterThan(ratios[i - 1]!);
      expect(ratios[i]!).toBeLessThan(1);
    }
    expect(ratios[ratios.length - 1]!).toBeGreaterThan(0.97);
  });
});

/**
 * Rung: the criterion is phase change PER SAMPLE, so it depends on sampling
 * density — the claim ARCHITECTURE makes and that nothing pinned until now.
 *
 * The consequence is concrete and is exactly why the criterion is not written
 * in total waves: the SAME wavefront can be beyond the FFT branch at one pupil
 * sampling and comfortably inside it at another. A criterion phrased as "a few
 * waves of aberration" would deny that and would fall back to the geometric
 * branch on systems the FFT handles perfectly well.
 */
describe("the criterion depends on sampling density, not total wave error", () => {
  it("the same wavefront aliases at 64 pupil samples and resolves at 256", () => {
    const s = opdSampling(opdMap(mirror(20, 0), 0, LINE_D, pupilGrid(21)));
    expect(fftBranchIsValid(s, 64)).toBe(false);
    expect(fftBranchIsValid(s, 256)).toBe(true);
  });

  it("the phase step scales exactly as 1/pupilSamples", () => {
    const s = opdSampling(opdMap(mirror(20, 0), 0, LINE_D, pupilGrid(21)));
    expect(phaseStepPerSample(s, 128) / phaseStepPerSample(s, 64)).toBeCloseTo(0.5, 12);
    expect(phaseStepPerSample(s, 256) / phaseStepPerSample(s, 64)).toBeCloseTo(0.25, 12);
  });

  it("a gentle wavefront is valid at every sampling, a violent one at none", () => {
    const gentle = opdSampling(opdMap(mirror(5, 0), 0, LINE_D, pupilGrid(21)));
    expect(fftBranchIsValid(gentle, 32)).toBe(true);

    const violent = opdSampling(opdMap(mirror(30, 0), 0, LINE_D, pupilGrid(21)));
    expect(fftBranchIsValid(violent, 64)).toBe(false);
    expect(fftBranchIsValid(violent, 256)).toBe(false);
  });
});

/**
 * Rung: the two failure modes are INDEPENDENT, which is why both are reported.
 *
 * This is the measurement that decided the design. Spherical aberration is
 * exactly representable by low-order rotationally-symmetric Zernikes, so
 * opening a spherical mirror from NA 0.05 to NA 0.3 sends the gradient up by
 * three orders of magnitude while the fit residual stays negligible against
 * the wavefront. A fidelity switch keyed on the residual alone — the intuitive
 * choice, since the residual is what "the fit failed" sounds like — would sail
 * straight through a wavefront that aliases badly on the FFT grid.
 */
describe("gradient and fit residual are independent signals", () => {
  it("spherical aberration explodes the gradient while the fit stays perfect", () => {
    const measure = (semiAperture: number) => {
      const map = opdMap(mirror(semiAperture, 0), 0, LINE_D, pupilGrid(21));
      const fit = fitZernike(map.samples, 28);
      const s = opdSampling(map, fit);
      return { gradient: s.maxGradientWavesPerRadius, relResidual: s.fitResidualWaves / map.rmsWaves };
    };

    const small = measure(5);
    const large = measure(30);

    expect(large.gradient / small.gradient).toBeGreaterThan(100);
    // ...and yet the basis represents both essentially exactly.
    expect(small.relResidual).toBeLessThan(1e-6);
    expect(large.relResidual).toBeLessThan(1e-4);
  });

  it("reports the fit residual only when given a fit", () => {
    const map = opdMap(mirror(APERTURE, 0), 0, LINE_D, pupilGrid(21));
    expect(opdSampling(map).fitResidualWaves).toBe(0);
    expect(opdSampling(map, fitZernike(map.samples, 28)).fitResidualWaves).toBeGreaterThan(0);
  });
});
