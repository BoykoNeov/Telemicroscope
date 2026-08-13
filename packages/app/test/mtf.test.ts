import { describe, it, expect } from "vitest";
import { mtfCurves, MODULATION_FLOOR, type MtfSpec } from "../src/mtf";

/**
 * The optical MTF panel — ROADMAP's v1 analyses line, its last surfaceless entry,
 * as invariants.
 *
 * The engine half of this landed as VALIDATION § 6ad and carries its own rungs;
 * this file pins the WIRING and the three things the panel says on screen that no
 * ladder rung states, because they are statements about the lens the app ships
 * rather than about the physics:
 *
 *  1. the two sections are one curve on axis and two off it,
 *  2. the azimuthal average misstates a section by 0.0852 while sitting between
 *     them — it is wrong by HIDING the band, not by leaving it, which is the
 *     opposite of what this file first asserted, and
 *  3. the ν axis is scaled by a cutoff this lens does not reach, and the panel
 *     measures the one it does — by two routes that must agree.
 *
 * The specs below are the panel's own defaults, so a change that makes the
 * default view wrong fails here rather than being found by opening the page.
 */

const SPEC: MtfSpec = {
  lens: "achromat",
  focalLengthMm: 1000,
  apertureMm: 100,
  sourceTemperatureK: 5800,
  wavelengths: 5,
  fieldDeg: 0.8,
  wavelengthNm: 587.5618,
  traceSamples: 31,
  bins: 81,
};

const run = (patch: Partial<MtfSpec> = {}) => mtfCurves({ ...SPEC, ...patch });

describe("the MTF panel — the curves themselves", () => {
  it("starts both sections at exactly 1 and ends both at the floor", () => {
    for (const fieldDeg of [0, 0.8, 1.6]) {
      const r = run({ fieldDeg });
      expect(r.curves.nu[0]).toBe(0);
      expect(r.curves.tangential[0]!).toBeCloseTo(1, 10);
      expect(r.curves.sagittal[0]!).toBeCloseTo(1, 10);
      expect(r.curves.nu[r.curves.nu.length - 1]).toBe(1);
    }
  });

  /**
   * The panel's first claim. On axis a round pupil has no meridional plane, so
   * "the two sections" is one curve; off axis it is two. Both halves matter — a
   * panel that split on axis would be drawing an asymmetry the lens does not
   * have, which is the more embarrassing of the two failures.
   */
  it("is one curve on axis and two off it", () => {
    expect(run({ fieldDeg: 0 }).largestSplit).toBeLessThan(1e-12);
    // 0.226 on the shipped achromat at 0.8°, i.e. one orientation of a bar
    // target keeps 1.5× the contrast of the other.
    const off = run({ fieldDeg: 0.8 });
    expect(off.largestSplit).toBeGreaterThan(0.1);
  });

  /**
   * The panel's second claim, in the corrected form. The average's problem is
   * that it reports ONE number where there are two: at 0.8° it misstates a
   * section by 0.0852 while sitting neatly between them.
   *
   * The excursion BELOW both — the 45° azimuths, which on a comatic pupil are
   * worse than either axis — is real and is three orders smaller: 3e-5 here. The
   * first draft of this file asserted the opposite ordering, having measured the
   * excursion through a profile binned so coarsely that the binning WAS the
   * signal. Both numbers are pinned now so that a future change cannot restore
   * the wrong story quietly.
   */
  it("has an average that misstates a section far more than it leaves the band", () => {
    const on = run({ fieldDeg: 0 });
    expect(on.averageMisstatesBy).toBeLessThan(0.01);
    expect(on.averageBelowBoth).toBeLessThan(1e-5);

    const off = run({ fieldDeg: 0.8 });
    expect(off.averageMisstatesBy).toBeGreaterThan(0.05);
    expect(off.averageBelowBoth).toBeLessThan(1e-3);
    expect(off.averageMisstatesBy / Math.max(off.averageBelowBoth, 1e-12)).toBeGreaterThan(100);
  });

  /**
   * The engine refusal this panel found: `mtfProfile` bins by annulus, so past
   * `pupilSamples` bins the annuli come back empty and used to read as zero
   * contrast. The adapter now caps the profile's bin count independently of the
   * sections', and asking for a very fine curve must not reintroduce it.
   */
  it("keeps the average honest at every curve resolution the panel can ask for", () => {
    for (const bins of [41, 81, 161]) {
      const r = run({ bins, fieldDeg: 0 });
      expect(r.averageBelowBoth, `bins=${bins}`).toBeLessThan(0.05);
      for (const v of r.curves.radial) expect(v, `bins=${bins}`).toBeGreaterThan(0);
    }
  });

  /**
   * A lens cannot beat its own aperture, so the measured curve exceeding the
   * closed form is a sampling artefact and is bounded, not zero: the pupil is 64
   * samples across a circle and its rim is a staircase. Pinned because the panel
   * prints this number and calls it small — 0.009 measured on axis, inside the
   * 0.01 § 2b's own rung allows.
   */
  it("never beats the closed form by more than the discrete pupil can explain", () => {
    for (const fieldDeg of [0, 0.8]) {
      for (const lens of ["singlet", "achromat"] as const) {
        expect(run({ lens, fieldDeg }).overshoot, `${lens} at ${fieldDeg}`).toBeLessThan(0.012);
      }
    }
  });
});

describe("the MTF panel — the cutoff that is two numbers", () => {
  /**
   * The panel's third claim, and its whole reason for a second cutoff readout.
   * The nominal cutoff is 2·NA/λ off the exit pupil radius and moves only with
   * the focal ratio; the transmitted one is where the curve stops, and on the
   * shipped doublet it is short because the crown closes on itself.
   */
  it("reports the full 2·NA/λ regardless of what transmitted", () => {
    for (const focalLengthMm of [500, 1000, 2000]) {
      const r = run({ focalLengthMm });
      const nominal = (2 * (100 / (2 * focalLengthMm))) / (587.5618 * 1e-6);
      expect(Math.abs(r.nominalCutoffCyclesPerMm / nominal - 1)).toBeLessThan(0.01);
    }
  });

  /**
   * Two routes to the same truncation: the trace's surviving pupil radius, and
   * the frequency at which the transform runs out of contrast. They are computed
   * from different things — a ray count and an array of moduli — and the panel
   * prints both so a reader can see them agreeing. If they ever disagreed, the
   * short cutoff would be aberration rather than aperture and the panel's
   * sentence about the aperture wall would be wrong.
   */
  it("agrees with the trace about how much of the pupil there is", () => {
    // f/20 keeps the whole pupil; f/10 and f/5 do not. Part B's wall, going as √f.
    for (const [focalLengthMm, expected] of [
      [2000, 1.0],
      [1000, 0.728],
      [500, 0.515],
    ] as const) {
      const r = run({ focalLengthMm, fieldDeg: 0 });
      expect(Math.abs(r.tracedRadiusFraction / expected - 1), `f=${focalLengthMm}`).toBeLessThan(
        0.03,
      );
      expect(
        Math.abs(r.transmittedCutoffFraction / r.tracedRadiusFraction - 1),
        `f=${focalLengthMm}`,
      ).toBeLessThan(0.06);
    }
  });

  /**
   * The control, and it is the same glass pair: the singlet's 5 mm centre never
   * closes inside this aperture, so it transmits everything at every focal length
   * the achromat loses a rim at. Without it, "the cutoff is short" would be
   * consistent with a tracer that had simply started dropping rays.
   */
  it("shows the singlet of the same pair keeping its whole pupil", () => {
    for (const focalLengthMm of [500, 1000, 2000]) {
      const r = run({ lens: "singlet", focalLengthMm, fieldDeg: 0 });
      expect(r.lost, `f=${focalLengthMm}`).toBe(0);
      expect(r.tracedRadiusFraction, `f=${focalLengthMm}`).toBeCloseTo(1, 6);
      expect(r.transmittedCutoffFraction, `f=${focalLengthMm}`).toBeGreaterThan(0.97);
    }
  });

  /**
   * Found by opening the page: the traced-radius readout is a LATTICE point, not
   * the wall.
   *
   * Changing the ray count moves it — 0.7280 / 0.7211 / 0.7280 at 21 / 31 / 41 —
   * without the lens changing at all, and not monotonically: it is whichever grid
   * point happens to fall just inside the wall, which a finer grid can miss. The
   * wall itself is at ρ = 0.7326, where the crown's two sags meet, and no grid
   * sits on it. The transform's own cutoff does NOT move, because it runs on a
   * fixed 64-wide pupil grid.
   *
   * Pinned because the panel prints both numbers next to each other and calls
   * their agreement evidence. It is evidence — but to the ray grid's resolution,
   * and a reader who took the traced radius for a property of the lens would be
   * reading a property of the sampling.
   */
  it("has a traced radius that is quantized by the ray grid, and a cutoff that is not", () => {
    const wall = 0.7326;
    const seen = [21, 31, 41].map((traceSamples) => run({ traceSamples, fieldDeg: 0 }));
    for (const r of seen) {
      expect(r.tracedRadiusFraction).toBeLessThan(wall);
      // Within one grid step of the wall: it is the outermost sample inside it.
      expect(r.tracedRadiusFraction).toBeGreaterThan(wall - 0.05);
    }
    // It moves, and NOT monotonically in the ray count.
    expect(seen[0]!.tracedRadiusFraction).not.toBeCloseTo(seen[1]!.tracedRadiusFraction, 3);
    expect(seen[2]!.tracedRadiusFraction).toBeCloseTo(seen[0]!.tracedRadiusFraction, 3);
    // …while the transform's cutoff is unmoved by a control that does not reach it.
    for (const r of seen) {
      expect(r.transmittedCutoffFraction).toBeCloseTo(seen[0]!.transmittedCutoffFraction, 10);
    }
  });

  /**
   * The scan runs from the top down, so a mid-band dip to the floor — which a
   * badly aberrated lens genuinely has — is not mistaken for the cutoff. The
   * singlet wide open is the case that has one.
   */
  it("does not mistake a mid-band null for the end of the band", () => {
    const r = run({ lens: "singlet", focalLengthMm: 1000, fieldDeg: 0 });
    const dips = r.curves.tangential.filter(
      (v, i) => r.curves.nu[i]! > 0.1 && r.curves.nu[i]! < 0.9 && v < MODULATION_FLOOR,
    );
    expect(dips.length).toBeGreaterThan(0);
    expect(r.transmittedCutoffFraction).toBeGreaterThan(0.9);
  });
});
