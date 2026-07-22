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

    // Same encircled-energy fraction at each one's OWN Airy radius...
    expect(encircledEnergy(blue, radiusMm(blue, 1.22) / blue.pixelScaleMm)).toBeCloseTo(0.838, 2);
    expect(encircledEnergy(red, radiusMm(red, 1.22) / red.pixelScaleMm)).toBeCloseTo(0.838, 2);
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
