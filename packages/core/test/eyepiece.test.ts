import { describe, it, expect } from "vitest";
import { Prescription } from "../src/trace/prescription";
import { systemProperties } from "../src/trace/paraxial";
import { afocalTelescope } from "../src/trace/compose";
import { afocalProperties } from "../src/pupil/afocal";
import { plosslEyepiece } from "../src/designs/eyepiece";
import { achromaticObjective } from "../src/designs/achromat";
import { getMedium } from "../src/materials/catalog";
import { LINE_D, LINE_F, LINE_C } from "../src/materials/dispersion";

/**
 * Rungs for the computed Plössl eyepiece — the eyepiece library's lead member
 * (docs/VALIDATION.md § 5m).
 *
 * The Plössl is two of § 5j's achromatic doublets mirrored across a central gap,
 * so its behaviour is a *theorem*, not a fit: achromatic by inheritance, and
 * (by symmetry) an odd-aberration canceller. These rungs pin what composition
 * and the doublet solve predict; the symmetry dividend on coma/distortion/
 * lateral colour needs the real-ray afocal trace and is pinned with it.
 */

/** A thin equiconvex singlet of focal length f — the achromatism negative control. */
const thinSinglet = (fMm: number, glass = "N-BK7"): Prescription => {
  const n = getMedium(glass).n(LINE_D);
  const C = 1 / (2 * (n - 1) * fMm);
  return {
    surfaces: [
      { kind: "refract", curvature: C, semiAperture: fMm, thickness: 1e-3, medium: glass },
      { kind: "refract", curvature: -C, semiAperture: fMm, thickness: fMm, medium: "AIR" },
    ],
  };
};

/** Fractional F–C focal spread of a lens, the lateral/longitudinal colour scale. */
const fcSpread = (p: Prescription): number => {
  const fF = systemProperties(p, LINE_F).efl;
  const fC = systemProperties(p, LINE_C).efl;
  const fD = systemProperties(p, LINE_D).efl;
  return Math.abs(fF - fC) / fD;
};

describe("Plössl eyepiece — computed from two achromatic doublets", () => {
  const ep = plosslEyepiece({ focalLengthMm: 25 });

  it("hits the requested focal length", () => {
    expect(ep.focalLengthMm).toBeCloseTo(25, 6);
  });

  it("EFL = the thick two-group Gaussian combination of its doublets", () => {
    // 1/f_e = 2/f_d − d/f_d², with d the separation between the rear principal
    // plane of the first doublet and the front principal plane of the second:
    // d = gap + 2(f_d − BFD_d). f_d and BFD come from achromaticObjective, so
    // this is the composed 6-surface trace checked against the analytic
    // reduction of its independently-computed parts — exact, not a fit.
    const fd = ep.doubletFocalLengthMm;
    const d = ep.airGapMm + 2 * (fd - ep.doublet.backFocusMm);
    const feClosed = 1 / (2 / fd - d / (fd * fd));
    expect(ep.focalLengthMm).toBeCloseTo(feClosed, 8);
  });

  it("is symmetric by construction: surface i's curvature is −(surface 5−i)'s", () => {
    const c = ep.curvatures;
    expect(c).toHaveLength(6);
    for (let i = 0; i < 3; i++) {
      expect(c[i]!).toBeCloseTo(-c[5 - i]!, 14);
    }
  });

  it("inherits the doublets' achromatism — F–C spread orders below a singlet's", () => {
    const plosslSpread = fcSpread(ep.prescription);
    const singletSpread = fcSpread(thinSinglet(25)); // ≈ 1/V_d ≈ 0.016
    expect(plosslSpread).toBeLessThan(1e-3); // secondary-spectrum level
    expect(plosslSpread).toBeLessThan(singletSpread / 10);
  });
});

describe("Plössl eyepiece — composes into a telescope (§ 5l machinery on a real eyepiece)", () => {
  const apRadius = 40; // 80 mm objective
  const obj = achromaticObjective({ apertureMm: 80, focalRatio: 11.25 }); // f_o ≈ 900
  const ep = plosslEyepiece({ focalLengthMm: 25 });
  const scope = afocalTelescope({ objective: obj.prescription, eyepiece: ep.prescription, wavelengthNm: LINE_D });
  const props = afocalProperties(scope, LINE_D, apRadius);

  it("angular magnification = −f_o/f_e and it inverts", () => {
    expect(props.magnification).toBeLessThan(0);
    expect(props.magnification).toBeCloseTo(-scope.objectiveEflMm / scope.eyepieceEflMm, 9);
    expect(Math.abs(props.magnification)).toBeCloseTo(scope.objectiveEflMm / ep.focalLengthMm, 1); // ≈ 36
  });

  it("exit-pupil diameter = EPD/|M|, and eye relief sits behind the eye lens", () => {
    expect(props.exitPupilRadiusMm).toBeCloseTo(apRadius / Math.abs(props.magnification), 3);
    expect(props.eyeReliefMm).toBeGreaterThan(0);
  });
});
