import { describe, it, expect } from "vitest";
import { spotDiagram } from "@telemicroscope/core/analysis";
import { pupilGrid } from "@telemicroscope/core/pupil";
import { spectralStack } from "@telemicroscope/core/wave";
import { rayFan, type RayFanSpec } from "../src/rayfan";
import { buildSystem, type RenderRequest } from "../src/render";

/**
 * The ray fan panel — APP.md Part H, as invariants rather than as prose.
 *
 * **No engine capability was added for it, so no validation-ladder rung was**:
 * `exitBundle`, `pupilFan` and `spotAt` are steps 1–2, called from the app. Part
 * B's, D10's and the collimation panel's convention. What is pinned here is the
 * wiring plus the claims the panel makes on screen that no rung states — chiefly
 * that coma is the EVEN half of the tangential fan, that on axis it is not small
 * but absent, and which way the flare points, which the app had wrong in print
 * until this file measured it.
 */

const SPEC: RayFanSpec = {
  lens: "achromat",
  focalLengthMm: 100,
  apertureMm: 10,
  sourceTemperatureK: 5800,
  wavelengths: 9,
  fieldDeg: 1.131371,
  rays: 41,
};

const fan = (patch: Partial<RayFanSpec> = {}) => rayFan({ ...SPEC, ...patch });
/** The d line — the middle of the three drawn curves. */
const D = 1;

describe("the ray fan panel", () => {
  it("measures every ray from the chief ray, so the field height is not the subject", () => {
    const curve = fan().curves[D]!;
    const centre = curve.tangential.find(([rho]) => rho === 0)!;
    expect(centre[1]).toBe(0);
    expect(curve.sagittal.find(([rho]) => rho === 0)![1]).toBe(0);
  });

  it("refuses an even ray count, which would have no chief ray to measure from", () => {
    expect(() => fan({ rays: 40 })).toThrow(/odd/);
  });

  /**
   * The strongest claim on the panel, and the first draft of this test made it
   * one notch too strong.
   *
   * An axially symmetric lens cannot tell +ρ from −ρ on its own axis, so on axis
   * coma is not a small quantity to be tolerated, it is an absent one. What is
   * NOT exact is the sampler: `pupilFan` builds ρ as `(i/(n−1))·2 − 1`, which
   * spells the pair either side of centre +0.10000000000000009 and
   * −0.09999999999999998. Those two rays are not mirror images, they are rays at
   * two slightly different heights, and they land ~1e-16 mm apart. So the number
   * on screen is the arithmetic's own floor and not zero, and the panel says
   * that instead of "exactly".
   *
   * Thirteen orders under the Airy radius, which is the statement that matters.
   */
  it("has an even half on axis only at the f64 floor", () => {
    for (const lens of ["singlet", "achromat"] as const) {
      for (const apertureMm of [6, 10, 20]) {
        const result = fan({ lens, apertureMm, fieldDeg: 0 });
        for (const curve of result.curves) {
          expect(curve.evenPeakMm, `${lens} at ${apertureMm} mm`).toBeLessThan(1e-14);
          expect(curve.evenPeakMm / result.airyRadiusMm).toBeLessThan(1e-11);
        }
      }
    }
  });

  /**
   * And where the sampling IS exactly symmetric, the physics is exactly
   * symmetric — which separates the two claims above rather than leaving the
   * floor to stand for both. The rim pair, ±1, comes out of `pupilFan` as exact
   * negatives at every odd count.
   */
  it("cancels bitwise on axis wherever the two rays are true mirrors", () => {
    const curve = fan({ fieldDeg: 0 }).curves[D]!;
    const rim = curve.tangential.find(([rho]) => rho === 1)!;
    const rimNeg = curve.tangential.find(([rho]) => rho === -1)!;
    expect(rim[1] + rimNeg[1]).toBe(0);
    const half = curve.tangential.find(([rho]) => rho === 0.5)!;
    const halfNeg = curve.tangential.find(([rho]) => rho === -0.5)!;
    expect(half[1] + halfNeg[1]).toBe(0);
  });

  /**
   * And the odd half is not zero there — otherwise the test above would be
   * passing because nothing was traced.
   */
  it("still has an odd half on axis, which is the spherical aberration", () => {
    const curve = fan({ fieldDeg: 0 }).curves[D]!;
    expect(curve.oddPeakMm).toBeGreaterThan(1e-5);
    expect(curve.oddPeakMm * 1000).toBeCloseTo(0.664, 2);
  });

  /**
   * The sagittal fan stays even-free at EVERY field, which is the other half of
   * a comet's shape: it is stretched along the direction it sits from the axis
   * and not across it. Same symmetry argument, so the same exact zero — the
   * system is still mirror-symmetric about the plane the field lies in.
   */
  it("has no even half across the field at any field angle", () => {
    for (const fieldDeg of [0, 0.4, 0.8, 1.131371]) {
      const curve = fan({ fieldDeg }).curves[D]!;
      let pairs = 0;
      for (const [rho, value] of curve.sagittal) {
        if (rho <= 0) continue;
        // Paired by nearest ρ and not by `get(-rho)`: `pupilFan`'s coordinates
        // are not exact negatives of each other — see MIRROR_TOLERANCE in the
        // adapter, where believing they were had cost the split its inner pairs.
        const mirror = curve.sagittal.reduce((best, candidate) =>
          Math.abs(candidate[0] + rho) < Math.abs(best[0] + rho) ? candidate : best,
        );
        expect(Math.abs(mirror[0] + rho)).toBeLessThan(1e-9);
        expect(Math.abs((value + mirror[1]) / 2), `ρ ${rho} at ${fieldDeg}°`).toBeLessThan(1e-14);
        pairs++;
      }
      expect(pairs).toBe((SPEC.rays - 1) / 2);
    }
  });

  /**
   * The pairing itself, on the coordinates that caught it: at 41 rays not every
   * sample has an exact mirror, and an exact-match split silently drops the ones
   * that do not. Pinned because the symptom of getting it wrong is a
   * slightly-too-small coma number, which looks like a lens rather than a bug.
   */
  it("pairs every ray with its mirror, including the ones f64 spells unevenly", () => {
    const tangential = fan({ fieldDeg: 0.8 }).curves[D]!.tangential;
    const positive = tangential.filter(([rho]) => rho > 0);
    const exact = positive.filter(([rho]) => tangential.some(([o]) => o === -rho));
    const tolerant = positive.filter(([rho]) =>
      tangential.some(([o]) => Math.abs(o + rho) < 1e-9),
    );
    expect(tolerant.length).toBe(positive.length);
    // The gap between the two IS the defect: those pairs were being skipped.
    expect(exact.length).toBeLessThan(positive.length);
  });

  it("grows an even half off axis, in proportion to the field angle", () => {
    const half = fan({ fieldDeg: 0.4 }).curves[D]!.evenPeakMm;
    const whole = fan({ fieldDeg: 0.8 }).curves[D]!.evenPeakMm;
    expect(half).toBeGreaterThan(0);
    // Third-order coma is linear in field, and the ratio says so within a
    // percent — the fifth-order part has not arrived at these angles.
    expect(whole / half).toBeCloseTo(2, 1);
  });

  it("puts the corner star's coma above the diffraction limit, so it is visible", () => {
    const result = fan();
    const curve = result.curves[D]!;
    expect(curve.evenPeakMm * 1000).toBeCloseTo(7.674, 2);
    expect(curve.evenPeakMm / result.airyRadiusMm).toBeGreaterThan(1);
    // And it is the larger half at the corner: this star is a comet, not a
    // slightly spread disc.
    expect(curve.evenPeakMm).toBeGreaterThan(curve.oddPeakMm);
  });

  it("reads the same at any sampling, because the fan's extreme is at the rim", () => {
    const peaks = [21, 41, 81].map((rays) => fan({ rays }).curves[D]!.evenPeakMm);
    expect(peaks[1]).toBe(peaks[0]);
    expect(peaks[2]).toBe(peaks[0]);
  });

  /**
   * ## Which way the flare points, and why this test exists
   *
   * `telescope.tsx` said in print that the tails "point radially outward" —
   * recited from the textbook picture of coma rather than measured on this lens.
   * It is wrong here, and the correction is only worth trusting because three
   * independent things agree on it, two of which are checked below.
   *
   * The chief ray of a positive field angle lands at +x, so a NEGATIVE even half
   * means both rim rays miss toward the axis and the tail points inward.
   */
  it("says the flare piles toward the axis, and the sign is checked not assumed", () => {
    const request: RenderRequest = {
      lens: SPEC.lens,
      focalLengthMm: SPEC.focalLengthMm,
      apertureMm: SPEC.apertureMm,
      sourceTemperatureK: SPEC.sourceTemperatureK,
      wavelengths: SPEC.wavelengths,
      pupilSamples: 64,
      whiteFraction: 1,
      seeingDOverR0: 0,
    };
    const system = buildSystem(request);
    const spot = spotDiagram(system, SPEC.fieldDeg, 587.5618, pupilGrid(33));
    // The chief ray is at +x, so "toward the axis" is the −x direction.
    expect(spot.centroidX).toBeGreaterThan(0);

    const curve = fan().curves[D]!;
    expect(curve.evenRimSign).toBe(-1);

    // Where the light actually sits, against where the chief ray put the star.
    const chief = spotDiagram(system, SPEC.fieldDeg, 587.5618, [{ px: 0, py: 0 }]);
    const geometricPull = spot.centroidX - chief.centroidX;
    expect(geometricPull).toBeLessThan(0);
    expect(geometricPull * 1000).toBeCloseTo(-2.51, 1);
  });

  /**
   * The second of the three, and the one that makes the correction stick: the
   * wave-optics PSF — a different module, a different physics, and the thing the
   * field render actually convolves with — puts its centre of light in the same
   * place to better than a percent. Geometry and diffraction agreeing on an
   * asymmetry is what a printed sentence could not do.
   */
  it("agrees with the traced wavefront's own centre of light", () => {
    const system = buildSystem({
      lens: SPEC.lens,
      focalLengthMm: SPEC.focalLengthMm,
      apertureMm: SPEC.apertureMm,
      sourceTemperatureK: SPEC.sourceTemperatureK,
      wavelengths: 5,
      pupilSamples: 64,
      whiteFraction: 1,
      seeingDOverR0: 0,
    });
    const centroidOf = (fieldDeg: number) => {
      const stack = spectralStack(system, fieldDeg, {
        pupilSamples: 64,
        padFactor: 4,
        traceSamples: 21,
      });
      const n = stack.size;
      let sx = 0;
      let sum = 0;
      for (const plane of stack.planes) {
        for (let i = 0; i < plane.intensity.length; i++) {
          const v = plane.intensity[i]!;
          if (v === 0) continue;
          sx += v * ((i % n) - n / 2);
          sum += v;
        }
      }
      return (sx / sum) * stack.pixelScaleMm * 1000;
    };

    // On axis the PSF is symmetric, which is the control: without it, "the
    // centroid is negative off axis" could be an offset in this measurement.
    expect(Math.abs(centroidOf(0))).toBeLessThan(0.01);

    const corner = centroidOf(SPEC.fieldDeg);
    expect(corner).toBeCloseTo(-2.524, 1);
    // Linear in field, like the fan's even half — and it is the same aberration
    // seen twice, so they had better run together.
    expect(centroidOf(0.4) / corner).toBeCloseTo(0.4 / SPEC.fieldDeg, 2);
  });

  it("loses no rays on a refractor whose stop is its own front rim", () => {
    for (const curve of fan().curves) expect(curve.lost).toBe(0);
  });
});
