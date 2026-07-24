import { describe, expect, test } from "vitest";
import { OpticalSystem, stopIndex } from "../src/trace/system";
import { Prescription } from "../src/trace/prescription";
import { limitingStop, effectiveStopIndex } from "../src/pupil/aperture-stop";
import { pupils } from "../src/pupil/pupils";
import { systemProperties } from "../src/trace/paraxial";
import {
  achromaticObjective,
  cassegrain,
  ritcheyChretien,
  schmidt,
  schmidtCassegrain,
  commercialSct,
  newtonian,
  plosslEyepiece,
  huygensEyepiece,
} from "../src/designs";
import { afocalTelescope } from "../src/trace/compose";

const LAM = 587.56;

/**
 * The aperture stop is a MEASUREMENT — the surface the axial cone fills first —
 * not the surface a prescription happens to flag. `limitingStop` finds it; these
 * rungs pin it against closed forms and prove `pupils()` actually moves to it.
 * (VALIDATION § 5p.)
 */

function infiniteSystem(p: Prescription, apertureRadiusMm: number): OpticalSystem {
  return {
    prescription: p,
    aperture: { kind: "stopRadius", value: apertureRadiusMm },
    field: { kind: "angle", values: [0] },
    wavelengths: [{ nm: LAM, weight: 1 }],
    conjugate: { kind: "infinite" },
  };
}

describe("aperture-stop selection", () => {
  // ── R1: NON-REGRESSION ────────────────────────────────────────────────────
  // Every existing preset's limiting aperture IS its declared stop. This proves
  // two things at once: the presets are honestly declared (no surface secretly
  // limits the beam more than the flagged one), and flipping the default to
  // `limiting` would change nothing for any of them — the safety gate the
  // opt-in policy rests on. It could fail: a preset whose rear element is
  // fractionally smaller than its front stop would select the rear here.
  test("the limiting aperture equals the declared stop for every preset", () => {
    const D = 100;
    const obj = achromaticObjective({ apertureMm: 80, focalRatio: 11.25 });
    const presets: Array<[string, Prescription, number]> = [
      ["achromat", achromaticObjective({ apertureMm: D, focalRatio: 10 }).prescription, D],
      ["ED", achromaticObjective({ apertureMm: D, focalRatio: 10, crownMedium: "CAF2", flintMedium: "N-BK7" }).prescription, D],
      ["newtonian", newtonian({ apertureMm: D, focalRatio: 5, focusOffsetMm: 200 }).prescription, D],
      ["cassegrain", cassegrain({ apertureMm: D, focalRatio: 12, primaryFocalRatio: 4, backFocusMm: 250 }).prescription, D],
      ["ritchey", ritcheyChretien({ apertureMm: D, focalRatio: 12, primaryFocalRatio: 4, backFocusMm: 250 }).prescription, D],
      ["schmidt", schmidt({ apertureMm: D, focalRatio: 4 }).prescription, D],
      ["schmidt-cass", schmidtCassegrain({ apertureMm: D, focalRatio: 12, primaryFocalRatio: 4, backFocusMm: 250 }).prescription, D],
      ["sct", commercialSct({ apertureMm: D, focalRatio: 12, primaryFocalRatio: 4, backFocusMm: 250 }).prescription, D],
      ["plossl-scope", afocalTelescope({ objective: obj.prescription, eyepiece: plosslEyepiece({ focalLengthMm: 25 }).prescription, wavelengthNm: LAM }).prescription, 80],
      ["huygens-scope", afocalTelescope({ objective: obj.prescription, eyepiece: huygensEyepiece({ focalLengthMm: 25 }).prescription, wavelengthNm: LAM }).prescription, 80],
    ];
    for (const [name, p, d] of presets) {
      const s = infiniteSystem(p, d);
      expect.soft(limitingStop(s, LAM).index, name).toBe(stopIndex(p));
    }
  });

  // ── R2: THE CROSSOVER IS A CLOSED FORM ────────────────────────────────────
  // Two bare aperture planes and a point source — no power, no glass, pure
  // geometry. The aperture stop is the one subtending the SMALLEST angle at the
  // object, a_i/(L+z_i); the two are equal at a2* = a1·(L+t)/L, and the
  // selection flips there exactly.
  const L = 100; // object distance to the first plane
  const t = 100; // plane separation
  const a1 = 10; // first plane's semi-aperture
  const crossover = (a2: number): OpticalSystem => ({
    prescription: {
      surfaces: [
        { kind: "refract", curvature: 0, semiAperture: a1, thickness: t, medium: "AIR", isStop: true },
        { kind: "refract", curvature: 0, semiAperture: a2, thickness: 50, medium: "AIR" },
      ],
    },
    aperture: { kind: "stopRadius", value: a1 },
    field: { kind: "angle", values: [0] },
    wavelengths: [{ nm: LAM, weight: 1 }],
    conjugate: { kind: "finite", distance: L },
  });
  const a2Star = (a1 * (L + t)) / L; // = 20

  test("selects the smaller aperture as the stop and flips at the closed-form crossover", () => {
    // Well clear of the boundary, the correct plane wins.
    expect(limitingStop(crossover(25), LAM).index).toBe(0); // plane 1 subtends more → plane 0 stops
    expect(limitingStop(crossover(15), LAM).index).toBe(1); // plane 1 subtends less → plane 1 stops

    // The flip is AT a2* = 20 and nowhere else: brackets it to 0.01 mm.
    expect(a2Star).toBeCloseTo(20, 12);
    expect(limitingStop(crossover(a2Star + 0.01), LAM).index).toBe(0);
    expect(limitingStop(crossover(a2Star - 0.01), LAM).index).toBe(1);
  });

  test("the selected stop is the one subtending the smallest angle (convention-free)", () => {
    for (const a2 of [3, 8, 15, 25, 40]) {
      const idx = limitingStop(crossover(a2), LAM).index;
      const angle0 = a1 / (L + 0);
      const angle1 = a2 / (L + t);
      const expected = angle0 <= angle1 ? 0 : 1;
      expect(idx, `a2=${a2}`).toBe(expected);
    }
  });

  // ── R3: THE WIRING IS THE FEATURE ─────────────────────────────────────────
  // `pupils()` must RESPECT the selected index — otherwise the selector is a
  // number nothing reads. A converging lens (declared stop) with a smaller iris
  // downstream: under `declared` the exit pupil is the lens; under `limiting` it
  // moves to the iris and the effective (entrance-pupil) aperture shrinks.
  test("pupils() moves the exit pupil and effective aperture to the limiting iris", () => {
    // Equi-convex N-BK7 lens; its power comes from the trace, not an assumption.
    const R = 103.0;
    const lensStop = 15; // lens clear semi-aperture and declared stop
    const irisRadius = 2; // a small iris downstream — the real limiter
    const efl = systemProperties(
      { surfaces: [
        { kind: "refract", curvature: 1 / R, semiAperture: lensStop, thickness: 2, medium: "N-BK7" },
        { kind: "refract", curvature: -1 / R, semiAperture: lensStop, thickness: 40, medium: "AIR" },
      ] },
      LAM,
    ).efl;
    const p: Prescription = {
      surfaces: [
        { kind: "refract", curvature: 1 / R, semiAperture: lensStop, thickness: 2, medium: "N-BK7", isStop: true },
        { kind: "refract", curvature: -1 / R, semiAperture: lensStop, thickness: 40, medium: "AIR" },
        // Iris 40 mm past the lens — well inside the f≈100 focus, so the beam
        // there is far wider than 2 mm and the iris is the true stop.
        { kind: "refract", curvature: 0, semiAperture: irisRadius, thickness: efl, medium: "AIR" },
      ],
    };
    const base = infiniteSystem(p, lensStop);

    const declared = pupils({ ...base, apertureStop: { kind: "declared" } }, LAM);
    const limiting = pupils({ ...base, apertureStop: { kind: "limiting" } }, LAM);

    // The selector routes through to the actual stop the machinery uses.
    expect(effectiveStopIndex({ ...base, apertureStop: { kind: "limiting" } }, LAM)).toBe(2);
    expect(limiting.stopIndex).toBe(2);
    expect(declared.stopIndex).toBe(0);

    // The stop is now the iris rim, and the reference (exit pupil) has moved.
    expect(limiting.stopRadius).toBeCloseTo(irisRadius, 12);
    expect(limiting.exit.z).not.toBeCloseTo(declared.exit.z, 3);

    // The effective aperture (entrance pupil) collapses to what the iris admits —
    // far below the 15 mm the declared stop reported.
    expect(limiting.entrance.radius).toBeLessThan(declared.entrance.radius);
    expect(limiting.entrance.radius).toBeLessThan(lensStop);
  });

  // ── R4: SURFACE PINNING + FIELD-STOP NEGATIVE CONTROL ─────────────────────
  test("the `surface` policy pins a chosen index", () => {
    expect(effectiveStopIndex({ ...crossover(25), apertureStop: { kind: "surface", index: 1 } }, LAM)).toBe(1);
    expect(effectiveStopIndex({ ...crossover(25), apertureStop: { kind: "surface", index: 0 } }, LAM)).toBe(0);
  });

  test("a tiny aperture at the internal focus is NOT mistaken for the stop", () => {
    // Marginal ray height ≈ 0 at the focus, so fill ≈ 0 there however small the
    // rim — a field stop can never be selected as the aperture stop.
    const R = 103.0;
    // Back focal distance: last vertex → paraxial focus (independent of the
    // trailing thickness). Placing the field stop there puts the marginal ray
    // exactly on the axis.
    const bfd = systemProperties(
      { surfaces: [
        { kind: "refract", curvature: 1 / R, semiAperture: 15, thickness: 2, medium: "N-BK7" },
        { kind: "refract", curvature: -1 / R, semiAperture: 15, thickness: 2, medium: "AIR" },
      ] },
      LAM,
    ).bfd;
    const p: Prescription = {
      surfaces: [
        { kind: "refract", curvature: 1 / R, semiAperture: 15, thickness: 2, medium: "N-BK7", isStop: true },
        { kind: "refract", curvature: -1 / R, semiAperture: 15, thickness: bfd, medium: "AIR" },
        // A pinhole field stop exactly at the focus — a demanding 0.5 mm rim.
        { kind: "refract", curvature: 0, semiAperture: 0.5, thickness: 20, medium: "AIR" },
      ],
    };
    const idx = limitingStop(infiniteSystem(p, 15), LAM).index;
    expect(idx).not.toBe(2);
    expect(idx).toBe(0);
  });
});
