import { describe, it, expect } from "vitest";
import { Prescription, SurfaceSpec } from "../src/trace/prescription";
import { systemProperties } from "../src/trace/paraxial";
import { afocalTelescope } from "../src/trace/compose";
import { afocalProperties, apparentFieldAngleRad } from "../src/pupil/afocal";
import { plosslEyepiece, huygensEyepiece } from "../src/designs/eyepiece";
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

describe("Huygens eyepiece — achromatism by spacing (§ 5o)", () => {
  const ep = huygensEyepiece({ focalLengthMm: 25 });
  const n = getMedium(ep.glass).n(LINE_D);

  /** Fractional F–C focal spread of a prescription. */
  const fc = (p: Prescription): number => {
    const fF = systemProperties(p, LINE_F).efl;
    const fC = systemProperties(p, LINE_C).efl;
    return (fF - fC) / systemProperties(p, LINE_D).efl;
  };
  /** A Huygens built at an ARBITRARY separation d (the negative control). */
  const huygensAt = (f1: number, f2: number, d: number): Prescription => {
    const t = 0.75;
    const pcx = (f: number, last: number): SurfaceSpec[] => [
      { kind: "refract", curvature: 1 / ((n - 1) * f), semiAperture: 12, thickness: t, medium: ep.glass },
      { kind: "refract", curvature: 0, semiAperture: 12, thickness: last, medium: "AIR" },
    ];
    return { surfaces: [...pcx(f1, d), ...pcx(f2, 0)] };
  };

  it("hits the requested focal length, and it is one glass throughout (no flint)", () => {
    expect(ep.focalLengthMm).toBeCloseTo(25, 6);
    expect(ep.prescription.surfaces).toHaveLength(4);
    for (const s of ep.prescription.surfaces) {
      expect(s.medium === ep.glass || s.medium === "AIR").toBe(true);
    }
  });

  it("EFL = 2·f₁·f₂/(f₁+f₂) to the thick-lens residual", () => {
    const closed = (2 * ep.fieldLensFocalMm * ep.eyeLensFocalMm) / (ep.fieldLensFocalMm + ep.eyeLensFocalMm);
    expect(ep.focalLengthMm).toBeCloseTo(closed, 0); // ~1.5% thick residual on a 25 mm EFL
    expect(Math.abs(ep.focalLengthMm - closed) / ep.focalLengthMm).toBeLessThan(0.03);
  });

  it("is achromatic at d = (f₁+f₂)/2, ≥ 10× below an equal-power singlet", () => {
    const f1 = ep.fieldLensFocalMm;
    const f2 = ep.eyeLensFocalMm;
    expect(ep.separationMm).toBeCloseTo((f1 + f2) / 2, 10);
    // A genuine single plano-convex lens of the same power (f = 25), carrying the
    // primary ~1/V colour the spacing corrects — the honest equal-power control.
    const singlet: Prescription = {
      surfaces: [
        { kind: "refract", curvature: 1 / ((n - 1) * 25), semiAperture: 12, thickness: 0.75, medium: ep.glass },
        { kind: "refract", curvature: 0, semiAperture: 12, thickness: 0, medium: "AIR" },
      ],
    };
    const singletSpread = Math.abs(fc(singlet));
    expect(singletSpread).toBeGreaterThan(0.01); // ≈ 1/V_d, sanity on the control
    expect(Math.abs(fc(ep.prescription))).toBeLessThan(singletSpread / 10);
  });

  it("the achromatism is a ZERO CROSSING in the spacing — under below, over above", () => {
    // The theorem's falsifiable content: too close under-corrects lateral colour,
    // too far over-corrects, and only at (f₁+f₂)/2 do F and C agree. So the F–C
    // spread must change sign across the design spacing, with the design near zero.
    const f1 = ep.fieldLensFocalMm;
    const f2 = ep.eyeLensFocalMm;
    const d = ep.separationMm;
    const below = fc(huygensAt(f1, f2, 0.7 * d));
    const above = fc(huygensAt(f1, f2, 1.3 * d));
    const atDesign = fc(ep.prescription);
    expect(Math.sign(below)).toBe(-Math.sign(above)); // opposite signs bracket the zero
    expect(Math.abs(atDesign)).toBeLessThan(Math.abs(below));
    expect(Math.abs(atDesign)).toBeLessThan(Math.abs(above));
  });

  it("composes into a telescope with the § 5l first-order numbers", () => {
    const apR = 20;
    const obj = achromaticObjective({ apertureMm: 40, focalRatio: 7.5 });
    const scope = afocalTelescope({ objective: obj.prescription, eyepiece: ep.prescription, wavelengthNm: LINE_D });
    const props = afocalProperties(scope, LINE_D, apR);
    expect(props.magnification).toBeCloseTo(-scope.objectiveEflMm / scope.eyepieceEflMm, 9);
    expect(props.exitPupilRadiusMm).toBeCloseTo(apR / Math.abs(props.magnification), 3);
    expect(props.eyeReliefMm).toBeGreaterThan(0);
  });
});

describe("real-ray afocal — apparent field of view and distortion (§ 5n)", () => {
  const RAD2DEG = 180 / Math.PI;
  const apR = 20;
  const objSpec = { apertureMm: 40, focalRatio: 7.5 }; // f_o ≈ 300 mm
  const buildScope = (ep: Prescription) =>
    afocalTelescope({ objective: achromaticObjective(objSpec).prescription, eyepiece: ep, wavelengthNm: LINE_D });
  const outDeg = (scope: ReturnType<typeof buildScope>, deg: number, wl = LINE_D) =>
    apparentFieldAngleRad(scope, deg, wl, apR) * RAD2DEG;

  const scope = buildScope(plosslEyepiece({ focalLengthMm: 25 }).prescription);
  const M = afocalProperties(scope, LINE_D, apR).magnification;
  const resid = (deg: number) => outDeg(scope, deg) - M * deg;

  it("θ_out = M·θ + O(θ³): the linear coefficient is the paraxial M (real trace vs paraxial)", () => {
    // The near-axis slope of the REAL chief-ray angle equals the first-order
    // angular magnification — a second, independent route to M.
    expect(outDeg(scope, 0.05) / 0.05 / M).toBeCloseTo(1, 3);
  });

  it("the leading nonlinearity is cubic, and the ratio converges to 8 as the field halves", () => {
    const ratio = (a: number, b: number) => resid(b) / resid(a);
    // Doubling the field octuples the distortion residual — third-order distortion.
    expect(ratio(0.1, 0.2)).toBeCloseTo(8, 0); // 8.02, within the fifth-order bound
    // ...and it is fifth-order-bounded: halving the field moves the ratio toward 8.
    expect(Math.abs(ratio(0.1, 0.2) - 8)).toBeLessThan(Math.abs(ratio(0.2, 0.4) - 8));
  });

  it("pincushion, convention-independent: local angular magnification grows with field", () => {
    const localMag = (deg: number) => Math.abs(outDeg(scope, deg) / deg);
    expect(localMag(0.2)).toBeGreaterThan(Math.abs(M)); // already above the paraxial value
    expect(localMag(0.2)).toBeLessThan(localMag(0.6));
    expect(localMag(0.6)).toBeLessThan(localMag(1.0));
  });
});

describe("Plössl dividend — lateral colour, NOT distortion (§ 5n)", () => {
  const RAD2DEG = 180 / Math.PI;
  const apR = 20;
  const objSpec = { apertureMm: 40, focalRatio: 7.5 };
  const buildScope = (ep: Prescription) =>
    afocalTelescope({ objective: achromaticObjective(objSpec).prescription, eyepiece: ep, wavelengthNm: LINE_D });
  const outDeg = (scope: ReturnType<typeof buildScope>, deg: number, wl = LINE_D) =>
    apparentFieldAngleRad(scope, deg, wl, apR) * RAD2DEG;

  // Equal-power (f = 25) SINGLE-element eyepiece: carries primary lateral colour.
  const n = getMedium("N-BK7").n(LINE_D);
  const C = 1 / (2 * (n - 1) * 25);
  const singlet: Prescription = {
    surfaces: [
      { kind: "refract", curvature: C, semiAperture: 12, thickness: 3, medium: "N-BK7" },
      { kind: "refract", curvature: -C, semiAperture: 12, thickness: 25, medium: "AIR" },
    ],
  };
  const plosslScope = buildScope(plosslEyepiece({ focalLengthMm: 25 }).prescription);
  const singletScope = buildScope(singlet);
  const Mp = afocalProperties(plosslScope, LINE_D, apR).magnification;
  const Ms = afocalProperties(singletScope, LINE_D, apR).magnification;

  const latColor = (s: ReturnType<typeof buildScope>, deg: number) =>
    Math.abs(outDeg(s, deg, LINE_F) - outDeg(s, deg, LINE_C));
  const distortion = (s: ReturnType<typeof buildScope>, M: number, deg: number) =>
    Math.abs(outDeg(s, deg) - M * deg);

  it("lateral colour: the Plössl's is ≥ 20× below an equal-power singlet eyepiece's", () => {
    // The doublets unite F and C, so the Plössl's F–C chief-ray split is at the
    // trace floor (~arcsec, sign-varying); the singlet carries primary ~1/V colour.
    expect(latColor(singletScope, 0.6)).toBeGreaterThan(20 * latColor(plosslScope, 0.6));
  });

  it("distortion is NOT the dividend — comparable to the singlet's", () => {
    // Symmetry cancels the odd aberrations only about the eyepiece's own centre at
    // unit magnification; in a telescope the stop is the objective and the
    // conjugates are infinite:finite, so the cancellation does not transfer.
    const dp = distortion(plosslScope, Mp, 0.6);
    const ds = distortion(singletScope, Ms, 0.6);
    expect(dp).toBeGreaterThan(0.5 * ds);
    expect(dp).toBeLessThan(1.5 * ds);
  });
});
