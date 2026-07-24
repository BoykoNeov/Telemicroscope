import { describe, it, expect } from "vitest";
import { Prescription } from "../src/trace/prescription";
import { systemProperties } from "../src/trace/paraxial";
import { afocalTelescope, spliceModules } from "../src/trace/compose";
import { paraxialTrace } from "../src/trace/paraxial";
import { afocalProperties } from "../src/pupil/afocal";
import { achromaticObjective } from "../src/designs/achromat";
import { getMedium } from "../src/materials/catalog";
import { LINE_D } from "../src/materials/dispersion";

/**
 * Rungs for module composition and afocal (telescope) evaluation
 * (docs/VALIDATION.md § 5l).
 *
 * The eyepiece prescription is input data; the pinnable capability is the
 * afocal composed system, which the engine could not express before this — a
 * collimated-in/collimated-out chain has no finite focus, so `systemProperties`
 * throws on it. Every number below is a closed form the trace can refuse:
 *
 *  - the afocal spacing → f_o + f_e in the thin-lens limit;
 *  - angular magnification → −f_o/f_e, measured from the beam compression, so it
 *    is NOT the ratio of the two EFLs by definition but a second route to it;
 *  - exit-pupil diameter → EPD/|M|, computed by imaging the stop through the
 *    eyepiece, a third independent route;
 *  - eye relief → f_e·(f_o+f_e)/f_o.
 */

/** A near-thin equiconvex lens: φ = 2(n−1)C = 1/f, so C = 1/(2(n−1)f). */
const thinLens = (fMm: number, semiApMm: number, isStop = false, glass = "N-BK7"): Prescription => {
  const n = getMedium(glass).n(LINE_D);
  const C = 1 / (2 * (n - 1) * fMm);
  return {
    surfaces: [
      { kind: "refract", curvature: C, semiAperture: semiApMm, thickness: 1e-3, medium: glass, isStop },
      { kind: "refract", curvature: -C, semiAperture: semiApMm, thickness: fMm, medium: "AIR" },
    ],
  };
};

describe("module composition — the splice", () => {
  it("concatenates modules, overwriting each module's trailing thickness with the gap", () => {
    const a = thinLens(100, 20, true);
    const b = thinLens(50, 10);
    const chain = spliceModules([
      { surfaces: a.surfaces, gapAfterMm: 42 },
      { surfaces: b.surfaces, gapAfterMm: 7 },
    ]);
    expect(chain.surfaces).toHaveLength(4);
    // Module A's internal thickness survives; only its trailing one is replaced.
    expect(chain.surfaces[0]!.thickness).toBeCloseTo(1e-3, 12);
    expect(chain.surfaces[1]!.thickness).toBe(42);
    expect(chain.surfaces[2]!.thickness).toBeCloseTo(1e-3, 12);
    expect(chain.surfaces[3]!.thickness).toBe(7);
    // The stop flag rides along on the surface it belongs to.
    expect(chain.surfaces[0]!.isStop).toBe(true);
  });
});

describe("afocal telescope — thin-lens Keplerian, closed forms", () => {
  const fO = 900;
  const fE = 25;
  const apRadius = 40; // 80 mm objective
  const objective = thinLens(fO, apRadius * 1.02, true);
  const eyepiece = thinLens(fE, 10);
  const scope = afocalTelescope({ objective, eyepiece, wavelengthNm: LINE_D });
  const props = afocalProperties(scope, LINE_D, apRadius);

  it("solves the afocal spacing to f_o + f_e", () => {
    // Thin lenses: vertices ARE the principal planes, so the separation that
    // zeroes the combined power is exactly f_o + f_e.
    expect(scope.gapMm).toBeCloseTo(fO + fE, 1); // 925 mm, to 0.05 mm
  });

  it("the composed chain is genuinely afocal — a parallel ray exits collimated", () => {
    // The afocal condition itself: a ray parallel to the axis in exits parallel
    // out. Measured against the objective's own bend (1/f_o ≈ 1.1e-3 rad), the
    // residual output angle is ~10 orders down — the solve zeroes the combined
    // power to the trace's floating-point floor, not merely reduces it.
    const uOut = paraxialTrace(scope.prescription, LINE_D, { y: 1, u: 0 }).u;
    expect(Math.abs(uOut) / (1 / fO)).toBeLessThan(1e-9);
    // (systemProperties' own afocal guard is 1e-15 rad, just below the ~1e-14 a
    // two-point numeric solve floors at, so it is not the right instrument here.)
  });

  it("angular magnification = −f_o/f_e, and it inverts", () => {
    expect(props.magnification).toBeLessThan(0); // Keplerian pair inverts
    expect(Math.abs(props.magnification)).toBeCloseTo(fO / fE, 2); // |M| ≈ 36
    // Route independence: the beam-compression M equals the ratio of the two
    // separately-traced group EFLs to solver precision — not true by construction.
    expect(props.magnification).toBeCloseTo(-scope.objectiveEflMm / scope.eyepieceEflMm, 9);
  });

  it("exit-pupil diameter = EPD/|M|, via a third route (stop imaged through the eyepiece)", () => {
    const predicted = apRadius / Math.abs(props.magnification);
    expect(props.exitPupilRadiusMm).toBeCloseTo(predicted, 4);
    // ...and equivalently EPD·f_e/f_o.
    expect(props.exitPupilRadiusMm).toBeCloseTo(apRadius * (fE / fO), 2);
  });

  it("eye relief = f_e·(f_o+f_e)/f_o", () => {
    const predicted = (fE * (fO + fE)) / fO; // 25.694 mm
    expect(props.eyeReliefMm).toBeCloseTo(predicted, 1);
    expect(props.eyeReliefMm).toBeGreaterThan(0); // behind the eye lens
  });
});

describe("afocal telescope — negative controls and thick correctness", () => {
  const fO = 900;
  const fE = 25;
  const apRadius = 40;

  it("a wrong separation is NOT afocal — the afocal condition is a real constraint", () => {
    const objective = thinLens(fO, apRadius * 1.02, true);
    const eyepiece = thinLens(fE, 10);
    // Splice at the objective's BFD instead of f_o+f_e: the eyepiece then sees a
    // focus at its own front vertex, not its front FOCUS, so the pair has power.
    const wrong = spliceModules([
      { surfaces: objective.surfaces, gapAfterMm: fO },
      { surfaces: eyepiece.surfaces, gapAfterMm: 0 },
    ]);
    expect(() => systemProperties(wrong, LINE_D)).not.toThrow();
  });

  it("the spacing solve is thick-correct: a real achromat objective still gives M = −f_o/f_e", () => {
    // f = 900 mm, D = 80 mm → f/11.25. A thick two-element group, so gap ≠ f_o+f_e.
    const obj = achromaticObjective({ apertureMm: 80, focalRatio: 11.25 });
    const eyepiece = thinLens(fE, 10);
    const scope = afocalTelescope({ objective: obj.prescription, eyepiece, wavelengthNm: LINE_D });
    const props = afocalProperties(scope, LINE_D, apRadius);
    // The gap is BFD_o + FFD_e, not the thin-lens f_o+f_e — but M is still the
    // ratio of the two traced EFLs, which is what the affine solve buys.
    expect(props.magnification).toBeCloseTo(-scope.objectiveEflMm / scope.eyepieceEflMm, 9);
    expect(Math.abs(props.magnification)).toBeCloseTo(scope.objectiveEflMm / fE, 1);
  });
});
