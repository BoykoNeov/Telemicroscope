import { describe, it, expect } from "vitest";
import { OpticalSystem } from "../src/trace/system";
import { Prescription } from "../src/trace/prescription";
import { LINE_D, LINE_F, LINE_C } from "../src/materials/dispersion";
import { psf, encircledEnergy, radialProfile, Psf } from "../src/wave/psf";
import { polychromaticPsf } from "../src/wave/polychromatic";

/**
 * Rungs for polychromatic stacking.
 *
 * The failure this guards against is specific and would be invisible: pixel
 * scale is ∝ λ, so summing per-wavelength PSF arrays bin-for-bin silently
 * rescales each one instead of stacking them. The result looks like a
 * perfectly reasonable PSF while having flattened exactly the chromatic
 * differences the calculation exists to show.
 */

const R = -200;
const APERTURE = 10;
const NA = APERTURE / Math.abs(R / 2);

function mirror(wavelengths: readonly { nm: number; weight: number }[]): OpticalSystem {
  const prescription: Prescription = {
    surfaces: [
      {
        kind: "reflect",
        curvature: 1 / R,
        conic: -1,
        semiAperture: APERTURE,
        thickness: R / 2,
        isStop: true,
      },
    ],
  };
  return {
    prescription,
    aperture: { kind: "stopRadius", value: APERTURE },
    field: { kind: "angle", values: [0] },
    wavelengths,
    conjugate: { kind: "infinite" },
  };
}

const GRID = { pupilSamples: 64, padFactor: 8 } as const;

/**
 * Rung: the Airy radius is proportional to λ.
 *
 * This is the closed form that MAKES resampling necessary — 1.22·λ/(2·NA) is
 * linear in λ, so two wavelengths' patterns genuinely live at different
 * physical sizes. Asserted on the physical scale rather than in pixels,
 * because in pixels the two are identical, which is precisely the trap.
 */
describe("the diffraction pattern scales with wavelength", () => {
  it("pixel scale is proportional to λ", () => {
    const blue = psf(mirror([{ nm: LINE_F, weight: 1 }]), 0, LINE_F, GRID);
    const red = psf(mirror([{ nm: LINE_C, weight: 1 }]), 0, LINE_C, GRID);
    expect(red.pixelScaleMm / blue.pixelScaleMm).toBeCloseTo(LINE_C / LINE_F, 9);
  });

  it("the physical Airy radius is proportional to λ, though the pixel one is not", () => {
    const blue = psf(mirror([{ nm: LINE_F, weight: 1 }]), 0, LINE_F, GRID);
    const red = psf(mirror([{ nm: LINE_C, weight: 1 }]), 0, LINE_C, GRID);
    const radiusMm = (p: Psf, c: number) => (c * p.wavelengthNm * 1e-6) / (2 * NA);

    // Same encircled-energy fraction at each one's OWN Airy radius. Asserted
    // as blue-against-red rather than each against 0.838: both carry the same
    // O(1/N) aperture-boundary bias at the same pupil sampling (see the
    // convergence rungs in psf.test.ts), so requiring them to AGREE is the
    // scale-invariance claim this rung is about — and it is 30× tighter than
    // comparing either one to the textbook value.
    const blueEnclosed = encircledEnergy(blue, radiusMm(blue, 1.22) / blue.pixelScaleMm);
    const redEnclosed = encircledEnergy(red, radiusMm(red, 1.22) / red.pixelScaleMm);
    expect(blueEnclosed).toBeCloseTo(redEnclosed, 3);
    expect(blueEnclosed).toBeGreaterThan(0.83);
    expect(blueEnclosed).toBeLessThan(0.85);
    // ...but red's disc is physically larger, by exactly the wavelength ratio.
    expect(radiusMm(red, 1.22) / radiusMm(blue, 1.22)).toBeCloseTo(LINE_C / LINE_F, 9);
  });
});

describe("stacking respects physical scale, not bin indices", () => {
  const spectrum = [
    { nm: LINE_F, weight: 1 },
    { nm: LINE_D, weight: 2 },
    { nm: LINE_C, weight: 1 },
  ];

  /**
   * Rung: the stack's encircled energy at a PHYSICAL radius equals the
   * weighted sum of each wavelength's encircled energy at that same physical
   * radius. That identity is what "stacking on a common grid" means, and it is
   * exactly what a bin-for-bin sum violates — each component would contribute
   * its energy at the wrong radius.
   */
  it("encircled energy is the weighted sum of the components', at a common physical radius", () => {
    const stack = polychromaticPsf(mirror(spectrum), 0, GRID);
    const total = spectrum.reduce((a, w) => a + w.weight, 0);

    for (const coefficient of [1.0, 1.22, 2.0, 3.0]) {
      const radiusMm = (coefficient * LINE_D * 1e-6) / (2 * NA);
      const measured = encircledEnergy(stack, radiusMm / stack.pixelScaleMm);

      let expected = 0;
      for (const w of spectrum) {
        const mono = psf(mirror([{ nm: w.nm, weight: 1 }]), 0, w.nm, GRID);
        expected += (w.weight / total) * encircledEnergy(mono, radiusMm / mono.pixelScaleMm);
      }
      expect(Math.abs(measured - expected)).toBeLessThan(0.01);
    }
  });

  /**
   * The negative control: a bin-for-bin sum would put every component's Airy
   * disc at the SAME pixel radius, so the stack's ring structure would be as
   * sharp as a monochromatic one. Real stacking washes the rings out, because
   * blue's first dark ring falls where red still has light.
   */
  it("the rings wash out — a bin-for-bin sum would leave them sharp", () => {
    const stack = polychromaticPsf(mirror(spectrum), 0, GRID);
    const mono = psf(mirror([{ nm: LINE_D, weight: 1 }]), 0, LINE_D, GRID);

    // Azimuthal mean at the d-line's first dark ring, relative to the peak.
    // Averaged over angle rather than sampled at one pixel: the ring is a
    // near-zero one pixel wide, so a single sample measures rounding.
    const ringRadius = (1.22 * LINE_D * 1e-6) / (2 * NA);
    const floorAt = (p: Psf) => {
      const { radius, mean } = radialProfile(p, p.size / 2);
      const target = ringRadius / p.pixelScaleMm;
      let best = 0;
      for (let i = 0; i < radius.length; i++) {
        if (Math.abs(radius[i]! - target) < Math.abs(radius[best]! - target)) best = i;
      }
      return mean[best]! / p.peak;
    };

    // At d-line the ring is a deep minimum. In the stack it is filled in, by
    // 5× here, because F's first ring falls inside it and C's outside — the
    // wavelengths genuinely disagree about where the dark ring is. A
    // bin-for-bin sum would place all three minima on the same pixel and
    // leave the ring as deep as the monochromatic one.
    expect(floorAt(mono)).toBeLessThan(0.005);
    expect(floorAt(stack) / floorAt(mono)).toBeGreaterThan(3);
  });

  it("a single-wavelength spectrum reproduces the monochromatic PSF exactly", () => {
    const stack = polychromaticPsf(mirror([{ nm: LINE_D, weight: 3 }]), 0, GRID);
    const mono = psf(mirror([{ nm: LINE_D, weight: 1 }]), 0, LINE_D, GRID);
    expect(stack.pixelScaleMm).toBeCloseTo(mono.pixelScaleMm, 12);
    for (let i = 0; i < mono.intensity.length; i += 1013) {
      expect(stack.intensity[i]!).toBeCloseTo(mono.intensity[i]!, 10);
    }
  });
});

describe("polychromatic bookkeeping", () => {
  const spectrum = [
    { nm: LINE_F, weight: 1 },
    { nm: LINE_D, weight: 2 },
    { nm: LINE_C, weight: 1 },
  ];

  it("weights are normalized and the mean wavelength is their weighted mean", () => {
    const stack = polychromaticPsf(mirror(spectrum), 0, GRID);
    const total = spectrum.reduce((a, w) => a + w.weight, 0);
    expect(stack.components.reduce((a, c) => a + c.weight, 0)).toBeCloseTo(1, 12);
    expect(stack.meanWavelengthNm).toBeCloseTo(
      spectrum.reduce((a, w) => a + w.nm * w.weight, 0) / total,
      9,
    );
    expect(stack.components.map((c) => c.nm)).toEqual(spectrum.map((w) => w.nm));
  });

  it("integrates to the weighted-mean transmitted energy", () => {
    const stack = polychromaticPsf(mirror(spectrum), 0, GRID);
    let sum = 0;
    for (let i = 0; i < stack.intensity.length; i++) sum += stack.intensity[i]!;
    expect(sum / stack.energy).toBeGreaterThan(0.99);
    expect(stack.truncatedFraction).toBeLessThan(0.01);
  });

  it("rejects a spectrum that carries no weight", () => {
    expect(() => polychromaticPsf(mirror([{ nm: LINE_D, weight: 0 }]), 0, GRID)).toThrow(
      /sum to zero/,
    );
    expect(() => polychromaticPsf(mirror([]), 0, GRID)).toThrow(/no wavelengths/);
  });
});

/**
 * Rung: the polychromatic Strehl is COHERENT with the peaks it is built from.
 *
 * A Strehl ratio for a spectrum has to compare the stacked peak against the
 * peak of an aberration-free stack assembled the same way. Two shortcuts look
 * reasonable and are both wrong:
 *
 *  - averaging the components' Strehls assumes every wavelength puts its peak
 *    on the same pixel, which is false exactly when there is chromatic
 *    defocus — the case the achromat story exists to show;
 *  - summing the components' aberration-free peaks adds numbers that live on
 *    different λ-dependent grids, i.e. energies-per-pixel in different units.
 *
 * A singlet has real axial colour, so its wavelengths focus at genuinely
 * different planes. Measured against the weighted-mean-of-Strehls shortcut,
 * these disagree by ~18% here — small enough to pass unnoticed, large enough
 * to be wrong.
 */
describe("polychromatic Strehl is internally consistent", () => {
  const singlet: Prescription = {
    surfaces: [
      {
        kind: "refract",
        curvature: 1 / 51.68,
        semiAperture: 10,
        thickness: 4,
        medium: "N-BK7",
        isStop: true,
      },
      { kind: "refract", curvature: 0, semiAperture: 10, thickness: 97.9, medium: "AIR" },
    ],
  };
  const spectrum = [
    { nm: LINE_F, weight: 1 },
    { nm: LINE_D, weight: 2 },
    { nm: LINE_C, weight: 1 },
  ];
  const chromatic: OpticalSystem = {
    prescription: singlet,
    aperture: { kind: "stopRadius", value: 6 },
    field: { kind: "angle", values: [0] },
    wavelengths: spectrum,
    conjugate: { kind: "infinite" },
  };

  // 128 samples across the pupil keeps all three wavelengths on the
  // diffraction branch; at 64 the F line aliases, which the next rung covers.
  const FINE = { pupilSamples: 128, padFactor: 4 } as const;

  it("strehl equals peak / diffractionLimitedPeak, on a system with real axial colour", () => {
    const stack = polychromaticPsf(chromatic, 0, FINE);
    expect(stack.components.every((c) => c.geometricWeight === 0)).toBe(true);
    expect(stack.diffractionLimitedPeak).toBeGreaterThan(0);
    expect(stack.strehl).toBeCloseTo(stack.peak / stack.diffractionLimitedPeak, 12);
  });

  it("and is NOT the weighted mean of the components' Strehls", () => {
    const stack = polychromaticPsf(chromatic, 0, FINE);
    const naive = stack.components.reduce(
      (acc, c) => acc + c.weight * psf(chromatic, 0, c.nm, FINE).strehl,
      0,
    );
    // 0.0344 against 0.0440 here — a 28% error, small enough to pass
    // unnoticed and large enough to be wrong. They differ because the
    // components' peaks land on different pixels; if this ever becomes an
    // equality, the resampling has stopped working.
    expect(Math.abs(stack.strehl - naive) / stack.strehl).toBeGreaterThan(0.05);
  });

  it("is a converged number, not an artifact of the pupil sampling", () => {
    const values = [128, 256].map(
      (pupilSamples) => polychromaticPsf(chromatic, 0, { pupilSamples, padFactor: 4 }).strehl,
    );
    expect(Math.abs(values[0]! / values[1]! - 1)).toBeLessThan(0.01);
  });

  /**
   * When any wavelength falls to the geometric branch there is no honest
   * denominator — a ray histogram has no aberration-free counterpart — so the
   * Strehl is reported as 0 rather than as a plausible-looking number built
   * from a sampling artifact. Same discipline as `geometricPsf` and
   * `blendPsf`.
   */
  it("reports 0 rather than a fabricated ratio when a component goes geometric", () => {
    const coarse = polychromaticPsf(chromatic, 0, { pupilSamples: 64, padFactor: 4 });
    expect(coarse.components.some((c) => c.geometricWeight > 0)).toBe(true);
    expect(coarse.strehl).toBe(0);
    expect(coarse.diffractionLimitedPeak).toBe(0);
  });

  it("a perfect system still reads Strehl 1", () => {
    const stack = polychromaticPsf(mirror(spectrum), 0, GRID);
    expect(stack.strehl).toBeGreaterThan(0.999);
    expect(stack.strehl).toBeCloseTo(stack.peak / stack.diffractionLimitedPeak, 12);
  });
});
